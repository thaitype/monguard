/**
 * @fileoverview Optimistic locking strategy implementation for handling concurrent document modifications.
 */

import type { ObjectId, Filter, UpdateFilter, UpdateResult, DeleteResult } from '../mongodb-types';
import {
  BaseDocument,
  CreateOptions,
  UpdateOptions,
  DeleteOptions,
  HardOrSoftDeleteResult,
  DefaultReferenceId,
  UserContext,
  ExtendedUpdateResult,
  ExtendedHardOrSoftDeleteResult,
} from '../types';
import { OperationStrategy, OperationStrategyContext } from './operation-strategy';
import type { AuditLogMetadata } from '../audit-logger';

/**
 * OptimisticLockingStrategy uses version numbers to detect and handle concurrent modifications.
 * When transactions are not available (e.g., Cosmos DB), this strategy prevents race conditions
 * by checking document versions before applying updates.
 *
 * @template T - The document type extending BaseDocument
 * @template TRefId - The type used for document reference IDs in audit logs
 */
export class OptimisticLockingStrategy<T extends BaseDocument, TRefId = DefaultReferenceId>
  implements OperationStrategy<T, TRefId>
{
  /**
   * Creates a new OptimisticLockingStrategy instance.
   *
   * @param context - The operation strategy context providing shared resources
   */
  constructor(private context: OperationStrategyContext<T, TRefId>) {}

  /**
   * Gets the default number of retry attempts for version conflicts.
   *
   * @private
   * @returns The configured retry attempts or default of 3
   */
  private get defaultRetryAttempts(): number {
    return this.context.config.retryAttempts || 3;
  }

  /**
   * Gets the default delay between retry attempts in milliseconds.
   *
   * @private
   * @returns The configured retry delay or default of 100ms
   */
  private get defaultRetryDelay(): number {
    return this.context.config.retryDelayMs || 100;
  }

  /**
   * Utility function to pause execution for a specified duration.
   *
   * @private
   * @param ms - Number of milliseconds to wait
   * @returns Promise that resolves after the specified delay
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Executes an operation with exponential backoff retry logic for version conflicts.
   *
   * @private
   * @template R - The return type of the operation
   * @param operation - The operation function to execute with retry logic
   * @param attempts - Number of retry attempts (defaults to configured value)
   * @returns Promise resolving to the operation result
   * @throws {Error} When all retry attempts are exhausted
   */
  private async retryWithBackoff<R>(
    operation: () => Promise<R>,
    attempts: number = this.defaultRetryAttempts
  ): Promise<R> {
    let lastError: Error;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        // Check if it's a version conflict (modified count = 0 when expecting modification)
        const isVersionConflict =
          error instanceof Error && (error.message.includes('version') || error.message.includes('modified'));

        if (isVersionConflict && attempt < attempts) {
          const delay = this.defaultRetryDelay * Math.pow(2, attempt - 1); // Exponential backoff
          await this.sleep(delay);
          continue;
        }

        throw error;
      }
    }

    throw lastError!;
  }

  /**
   * Creates a versioned filter that handles documents with or without __v field.
   * For version 1, supports both documents with __v: 1 and documents without __v field.
   * For versions > 1, requires exact version match.
   *
   * @private
   * @param baseFilter - The base filter to apply (includes original filter and soft delete filter)
   * @param currentVersion - The current version number
   * @returns Filter object for version-safe operations
   */
  private createVersionedFilter(baseFilter: Filter<T>, currentVersion: number): Filter<T> {
    if (currentVersion === 0) {
      // For documents without __v field (currentVersion = 0)
      return {
        ...baseFilter,
        __v: { $exists: false },
      } as Filter<T>;
    } else {
      // For documents with existing __v field
      return {
        ...baseFilter,
        __v: currentVersion,
      } as Filter<T>;
    }
  }

  /**
   * Creates a new document with version 1 and automatic timestamps.
   *
   * @param document - The document data to create
   * @param options - Options for the create operation
   * @returns Promise resolving to the created document
   * @throws Error if the operation fails
   */
  async create(document: any, options: CreateOptions<TRefId> = {}): Promise<T & { _id: ObjectId }> {
    // Add __v field and timestamps for new documents
    const versionedDoc = {
      ...document,
      __v: 1, // Start with version 1 for new documents
    };

    const timestampedDoc = this.context.addTimestamps(versionedDoc, false, options.userContext);
    const result = await this.context.collection.insertOne(timestampedDoc);

    const createdDoc = { ...timestampedDoc, _id: result.insertedId } as T & { _id: ObjectId };

    // Create audit log after successful creation
    if (this.context.shouldAudit(options.skipAudit)) {
      try {
        const metadata: AuditLogMetadata = { after: createdDoc };
        await this.context.auditLogger.logOperation(
          'create',
          this.context.collectionName,
          result.insertedId as TRefId,
          options.userContext,
          metadata,
          {
            mode: this.context.auditControl.mode,
            failOnError: this.context.auditControl.failOnError,
            logFailedAttempts: this.context.auditControl.logFailedAttempts,
            storageMode: options.auditControl?.storageMode,
          }
        );
      } catch (auditError) {
        // Log audit error but don't fail the operation
        this.context.logger.error('Failed to create audit log for create operation:', auditError);
      }
    }

    return createdDoc;
  }

  /**
   * Updates documents with optimistic locking by checking version numbers.
   * Automatically increments version numbers and handles version conflicts with retry logic.
   *
   * @param filter - MongoDB filter criteria
   * @param update - Update operations to apply
   * @param options - Options for the update operation
   * @returns Promise resolving to update result information with __v when applicable
   * @throws Error if the operation fails
   */
  async update(
    filter: Filter<T>,
    update: UpdateFilter<T>,
    options: UpdateOptions<TRefId> = {}
  ): Promise<ExtendedUpdateResult> {
    const result = await this.retryWithBackoff(async () => {
      // Get all matching documents to determine if this is a single or multi-document operation
      const beforeDocs = await this.context.collection.find(this.context.mergeSoftDeleteFilter(filter)).toArray();

      if (beforeDocs.length === 0) {
        if (options.upsert) {
          // For upsert, create with version 1
          const timestampedUpdate = {
            ...update,
            $set: {
              ...((update as any).$set || {}),
              __v: 1,
              createdAt: new Date(),
              updatedAt: new Date(),
              ...(options.userContext && {
                createdBy: options.userContext.userId,
                updatedBy: options.userContext.userId,
              }),
            },
          };

          const updateResult = await this.context.collection.updateMany(filter, timestampedUpdate, { upsert: true });
          // For upsert that creates a new document, return version 1
          return { ...updateResult, __v: updateResult.upsertedCount > 0 ? 1 : undefined };
        }

        // No document to update
        return {
          acknowledged: true,
          modifiedCount: 0,
          upsertedCount: 0,
          upsertedId: null,
          matchedCount: 0,
          __v: undefined,
        };
      }

      // Handle single document update with optimistic locking
      if (beforeDocs.length === 1) {
        const beforeDoc = beforeDocs[0]!;
        const currentVersion = beforeDoc.__v || 0;
        const __v = currentVersion + 1;

        // Create version-controlled update
        const timestampedUpdate = {
          ...update,
          $set: {
            ...((update as any).$set || {}),
            __v: __v, // Explicitly set the new version
            updatedAt: new Date(),
            ...(options.userContext && { updatedBy: options.userContext.userId }),
          },
          $inc: {
            ...((update as any).$inc || {}),
          },
        };

        // Use version in filter for optimistic locking
        const baseFilter = this.context.mergeSoftDeleteFilter(filter);
        const versionedFilter = this.createVersionedFilter(baseFilter, currentVersion);

        const updateResult = await this.context.collection.updateMany(versionedFilter, timestampedUpdate);

        // Check if update succeeded (version conflict if modifiedCount = 0)
        if (updateResult.modifiedCount === 0) {
          throw new Error('Version conflict: Document was modified by another operation');
        }

        // Create audit log after successful update
        if (this.context.shouldAudit(options.skipAudit) && updateResult.modifiedCount > 0) {
          try {
            const afterDoc = await this.context.collection.findOne({ _id: beforeDoc._id });
            if (afterDoc) {
              const changes = this.context.getChangedFields(beforeDoc, afterDoc);
              const metadata: AuditLogMetadata = {
                before: beforeDoc,
                after: afterDoc,
                changes,
              };
              await this.context.auditLogger.logOperation(
                'update',
                this.context.collectionName,
                beforeDoc._id,
                options.userContext,
                metadata,
                {
                  mode: this.context.auditControl.mode,
                  failOnError: this.context.auditControl.failOnError,
                  logFailedAttempts: this.context.auditControl.logFailedAttempts,
                  storageMode: options.auditControl?.storageMode,
                }
              );
            }
          } catch (auditError) {
            this.context.logger.error('Failed to create audit log for update operation:', auditError);
          }
        }

        // Return result with __v only for single document updates
        return { ...updateResult, __v: updateResult.modifiedCount > 0 ? __v : undefined };
      }

      // Handle multi-document update without version control (no optimistic locking)
      const timestampedUpdate = {
        ...update,
        $set: {
          ...((update as any).$set || {}),
          updatedAt: new Date(),
          ...(options.userContext && { updatedBy: options.userContext.userId }),
        },
        $inc: {
          ...((update as any).$inc || {}),
          __v: 1,
        },
      };

      const updateResult = await this.context.collection.updateMany(
        this.context.mergeSoftDeleteFilter(filter),
        timestampedUpdate
      );

      // Create audit logs for multi-document updates (basic logging without detailed change tracking)
      if (this.context.shouldAudit(options.skipAudit) && updateResult.modifiedCount > 0) {
        try {
          // For multi-document updates, we log a summary audit entry
          const metadata: AuditLogMetadata = {
            multiDocumentUpdate: true,
            documentsModified: updateResult.modifiedCount,
            filter: filter,
          };

          // Use the first document's ID as reference, or generate a summary entry
          const referenceId = beforeDocs[0]!._id;
          await this.context.auditLogger.logOperation(
            'update',
            this.context.collectionName,
            referenceId,
            options.userContext,
            metadata,
            {
              mode: this.context.auditControl.mode,
              failOnError: this.context.auditControl.failOnError,
              logFailedAttempts: this.context.auditControl.logFailedAttempts,
              storageMode: options.auditControl?.storageMode,
            }
          );
        } catch (auditError) {
          this.context.logger.error('Failed to create audit log for multi-document update operation:', auditError);
        }
      }

      // For multi-document updates, __v is always undefined
      return { ...updateResult, __v: undefined };
    });

    return result;
  }

  /**
   * Updates a single document by ID with optimistic locking.
   *
   * @param id - The document ID to update
   * @param update - Update operations to apply
   * @param options - Options for the update operation
   * @returns Promise resolving to update result information with __v when applicable
   * @throws Error if the operation fails
   */
  async updateById(
    id: ObjectId,
    update: UpdateFilter<T>,
    options: UpdateOptions<TRefId> = {}
  ): Promise<ExtendedUpdateResult> {
    return this.update({ _id: id } as Filter<T>, update, options);
  }

  /**
   * Deletes documents with optimistic locking (soft delete by default).
   * For soft deletes, uses version control to prevent concurrent modifications.
   *
   * @param filter - MongoDB filter criteria
   * @param options - Options for the delete operation
   * @returns Promise resolving to delete/update result information with __v for soft deletes
   * @throws Error if the operation fails
   */
  async delete<THardDelete extends boolean = false>(
    filter: Filter<T>,
    options: DeleteOptions<THardDelete, TRefId> = {}
  ): Promise<ExtendedHardOrSoftDeleteResult<THardDelete>> {
    const result = await this.retryWithBackoff(async () => {
      if (options.hardDelete) {
        // Get documents to delete for audit logging
        const docsToDelete = this.context.shouldAudit(options.skipAudit)
          ? await this.context.collection.find(filter).toArray()
          : [];

        const deleteResult = await this.context.collection.deleteMany(filter);

        // Create audit logs after successful deletion
        if (this.context.shouldAudit(options.skipAudit) && deleteResult.deletedCount > 0) {
          try {
            for (const doc of docsToDelete) {
              const metadata: AuditLogMetadata = {
                hardDelete: true,
                before: doc,
              };
              await this.context.auditLogger.logOperation(
                'delete',
                this.context.collectionName,
                doc._id,
                options.userContext,
                metadata,
                {
                  mode: this.context.auditControl.mode,
                  failOnError: this.context.auditControl.failOnError,
                  logFailedAttempts: this.context.auditControl.logFailedAttempts,
                  storageMode: options.auditControl?.storageMode,
                }
              );
            }
          } catch (auditError) {
            this.context.logger.error('Failed to create audit log for hard delete operation:', auditError);
          }
        }

        return deleteResult;
      } else {
        // Soft delete with version control - handle multiple documents
        const beforeDocs = await this.context.collection.find(this.context.mergeSoftDeleteFilter(filter)).toArray();

        if (beforeDocs.length === 0) {
          return { acknowledged: true, modifiedCount: 0, upsertedCount: 0, upsertedId: null, matchedCount: 0 };
        }

        let totalModified = 0;
        let __v: number | undefined;

        // Process each document individually for version control
        for (const beforeDoc of beforeDocs) {
          const currentVersion = beforeDoc.__v || 0;
          const newVersion = currentVersion + 1;

          const softDeleteUpdate = {
            $set: {
              __v: newVersion, // Explicitly set the new version
              deletedAt: new Date(),
              updatedAt: new Date(),
              ...(options.userContext && { deletedBy: options.userContext.userId }),
            },
          };

          // Use version in filter for optimistic locking
          const baseFilter = {
            _id: beforeDoc._id,
            deletedAt: { $exists: false },
          };
          const versionedFilter = this.createVersionedFilter(baseFilter as Filter<T>, currentVersion);

          const updateResult = await this.context.collection.updateOne(
            versionedFilter as Filter<T>,
            softDeleteUpdate as UpdateFilter<T>
          );

          if (updateResult.modifiedCount > 0) {
            totalModified += updateResult.modifiedCount;
            // For single document operation, track the new version
            if (beforeDocs.length === 1) {
              __v = newVersion;
            }

            // Create audit log after successful soft delete
            if (this.context.shouldAudit(options.skipAudit)) {
              try {
                const metadata: AuditLogMetadata = {
                  softDelete: true,
                  before: beforeDoc,
                };
                await this.context.auditLogger.logOperation(
                  'delete',
                  this.context.collectionName,
                  beforeDoc._id,
                  options.userContext,
                  metadata,
                  {
                    mode: this.context.auditControl.mode,
                    failOnError: this.context.auditControl.failOnError,
                    logFailedAttempts: this.context.auditControl.logFailedAttempts,
                    storageMode: options.auditControl?.storageMode,
                  }
                );
              } catch (auditError) {
                this.context.logger.error('Failed to create audit log for soft delete operation:', auditError);
              }
            }
          }
        }

        return {
          acknowledged: true,
          modifiedCount: totalModified,
          upsertedCount: 0,
          upsertedId: null,
          matchedCount: beforeDocs.length,
          // Only return __v for single document soft deletes
          __v: totalModified > 0 && beforeDocs.length === 1 ? __v : undefined,
        };
      }
    });

    return result as ExtendedHardOrSoftDeleteResult<THardDelete>;
  }

  /**
   * Deletes a single document by ID with optimistic locking.
   *
   * @param id - The document ID to delete
   * @param options - Options for the delete operation
   * @returns Promise resolving to delete/update result information with __v for soft deletes
   * @throws Error if the operation fails
   */
  async deleteById<THardDelete extends boolean = false>(
    id: ObjectId,
    options: DeleteOptions<THardDelete, TRefId> = {}
  ): Promise<ExtendedHardOrSoftDeleteResult<THardDelete>> {
    return this.delete({ _id: id } as Filter<T>, options);
  }

  /**
   * Restores soft-deleted documents with optimistic locking.
   * Uses version control to ensure consistent restore operations.
   *
   * @param filter - MongoDB filter criteria for documents to restore
   * @param userContext - Optional user context for audit trails
   * @returns Promise resolving to update result information with __v when applicable
   * @throws Error if the operation fails
   */
  async restore(filter: Filter<T>, userContext?: UserContext<TRefId>): Promise<ExtendedUpdateResult> {
    const result = await this.retryWithBackoff(async () => {
      // Find deleted documents to restore
      const deletedDocs = await this.context.collection
        .find({
          ...filter,
          deletedAt: { $exists: true },
        })
        .toArray();

      if (deletedDocs.length === 0) {
        return { acknowledged: true, modifiedCount: 0, upsertedCount: 0, upsertedId: null, matchedCount: 0 };
      }

      // Restore each document with version control
      let totalModified = 0;
      let __v: number | undefined;

      for (const doc of deletedDocs) {
        const currentVersion = doc.__v || 0;
        const newVersion = currentVersion + 1;

        const restoreUpdate = {
          $unset: { deletedAt: 1, deletedBy: 1 },
          $set: {
            __v: newVersion, // Explicitly set the new version
            updatedAt: new Date(),
            ...(userContext && { updatedBy: userContext.userId }),
          },
        } as unknown as UpdateFilter<T>;

        const baseFilter = {
          _id: doc._id,
          deletedAt: { $exists: true },
        };
        const versionedFilter = this.createVersionedFilter(baseFilter as Filter<T>, currentVersion);

        const updateResult = await this.context.collection.updateOne(versionedFilter as Filter<T>, restoreUpdate);

        if (updateResult.modifiedCount === 0) {
          throw new Error('Version conflict: Document was modified by another operation');
        }

        totalModified += updateResult.modifiedCount;
        // For single document operation, track the new version
        if (deletedDocs.length === 1) {
          __v = newVersion;
        }
      }

      return {
        acknowledged: true,
        modifiedCount: totalModified,
        upsertedCount: 0,
        upsertedId: null,
        matchedCount: deletedDocs.length,
        // Only return __v for single document restores
        __v: totalModified > 0 && deletedDocs.length === 1 ? __v : undefined,
      };
    });

    return result;
  }
}
