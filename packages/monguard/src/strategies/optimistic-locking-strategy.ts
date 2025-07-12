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
   * Creates a new document with version 1 and automatic timestamps.
   *
   * @param document - The document data to create
   * @param options - Options for the create operation
   * @returns Promise resolving to the created document
   * @throws Error if the operation fails
   */
  async create(document: any, options: CreateOptions<TRefId> = {}): Promise<T & { _id: ObjectId }> {
    // Add version field and timestamps for new documents
    const versionedDoc = {
      ...document,
      version: 1, // Start with version 1 for new documents
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
            failOnError: this.context.auditControl.failOnError,
            logFailedAttempts: this.context.auditControl.logFailedAttempts
          }
        );
      } catch (auditError) {
        // Log audit error but don't fail the operation
        console.error('Failed to create audit log for create operation:', auditError);
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
   * @returns Promise resolving to update result information with newVersion when applicable
   * @throws Error if the operation fails
   */
  async update(
    filter: Filter<T>,
    update: UpdateFilter<T>,
    options: UpdateOptions<TRefId> = {}
  ): Promise<ExtendedUpdateResult> {
    const result = await this.retryWithBackoff(async () => {
      // Get current document with version
      const beforeDoc = await this.context.collection.findOne(this.context.mergeSoftDeleteFilter(filter));

      if (!beforeDoc) {
        if (options.upsert) {
          // For upsert, create with version 1
          const timestampedUpdate = {
            ...update,
            $set: {
              ...((update as any).$set || {}),
              version: 1,
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
          return { ...updateResult, newVersion: updateResult.upsertedCount > 0 ? 1 : undefined };
        }

        // No document to update
        return { acknowledged: true, modifiedCount: 0, upsertedCount: 0, upsertedId: null, matchedCount: 0 };
      }

      const currentVersion = beforeDoc.version || 1;
      const newVersion = currentVersion + 1;

      // Create version-controlled update
      const timestampedUpdate = {
        ...update,
        $set: {
          ...((update as any).$set || {}),
          updatedAt: new Date(),
          ...(options.userContext && { updatedBy: options.userContext.userId }),
        },
        $inc: {
          ...((update as any).$inc || {}),
          version: 1,
        },
      };

      // Use version in filter for optimistic locking
      const versionedFilter = {
        ...this.context.mergeSoftDeleteFilter(filter),
        version: currentVersion,
      };

      const updateResult = await this.context.collection.updateMany(versionedFilter, timestampedUpdate);

      // Check if update succeeded (version conflict if modifiedCount = 0)
      if (updateResult.modifiedCount === 0 && beforeDoc) {
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
                failOnError: this.context.auditControl.failOnError || false,
                logFailedAttempts: this.context.auditControl.logFailedAttempts
              }
            );
          }
        } catch (auditError) {
          console.error('Failed to create audit log for update operation:', auditError);
        }
      }

      // Return result with newVersion only if document was actually modified
      return { ...updateResult, newVersion: updateResult.modifiedCount > 0 ? newVersion : undefined };
    });

    return result;
  }

  /**
   * Updates a single document by ID with optimistic locking.
   *
   * @param id - The document ID to update
   * @param update - Update operations to apply
   * @param options - Options for the update operation
   * @returns Promise resolving to update result information with newVersion when applicable
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
   * @returns Promise resolving to delete/update result information with newVersion for soft deletes
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
                  failOnError: this.context.auditControl.failOnError || false,
                  logFailedAttempts: this.context.auditControl.logFailedAttempts
                }
              );
            }
          } catch (auditError) {
            console.error('Failed to create audit log for hard delete operation:', auditError);
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
        let newVersion: number | undefined;

        // Process each document individually for version control
        for (const beforeDoc of beforeDocs) {
          const currentVersion = beforeDoc.version || 1;

          const softDeleteUpdate = {
            $set: {
              deletedAt: new Date(),
              updatedAt: new Date(),
              ...(options.userContext && { deletedBy: options.userContext.userId }),
            },
            $inc: { version: 1 },
          };

          // Use version in filter for optimistic locking
          const versionedFilter = {
            _id: beforeDoc._id,
            version: currentVersion,
            deletedAt: { $exists: false },
          };

          const updateResult = await this.context.collection.updateOne(
            versionedFilter as Filter<T>,
            softDeleteUpdate as UpdateFilter<T>
          );

          if (updateResult.modifiedCount > 0) {
            totalModified += updateResult.modifiedCount;
            // For single document operation, track the new version
            if (beforeDocs.length === 1) {
              newVersion = currentVersion + 1;
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
                    failOnError: this.context.auditControl.failOnError || false,
                    logFailedAttempts: this.context.auditControl.logFailedAttempts
                  }
                );
              } catch (auditError) {
                console.error('Failed to create audit log for soft delete operation:', auditError);
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
          // Only return newVersion for single document soft deletes
          newVersion: totalModified > 0 && beforeDocs.length === 1 ? newVersion : undefined,
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
   * @returns Promise resolving to delete/update result information with newVersion for soft deletes
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
   * @returns Promise resolving to update result information with newVersion when applicable
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
      let newVersion: number | undefined;

      for (const doc of deletedDocs) {
        const currentVersion = doc.version || 1;

        const restoreUpdate = {
          $unset: { deletedAt: 1, deletedBy: 1 },
          $set: {
            updatedAt: new Date(),
            ...(userContext && { updatedBy: userContext.userId }),
          },
          $inc: { version: 1 },
        } as unknown as UpdateFilter<T>;

        const versionedFilter = {
          _id: doc._id,
          version: currentVersion,
          deletedAt: { $exists: true },
        };

        const updateResult = await this.context.collection.updateOne(versionedFilter as Filter<T>, restoreUpdate);

        if (updateResult.modifiedCount === 0) {
          throw new Error('Version conflict: Document was modified by another operation');
        }

        totalModified += updateResult.modifiedCount;
        // For single document operation, track the new version
        if (deletedDocs.length === 1) {
          newVersion = currentVersion + 1;
        }
      }

      return {
        acknowledged: true,
        modifiedCount: totalModified,
        upsertedCount: 0,
        upsertedId: null,
        matchedCount: deletedDocs.length,
        // Only return newVersion for single document restores
        newVersion: totalModified > 0 && deletedDocs.length === 1 ? newVersion : undefined,
      };
    });

    return result;
  }
}
