/**
 * @fileoverview Transaction-based strategy implementation for handling concurrent document modifications.
 */

import type { ObjectId, Filter, UpdateFilter, UpdateResult, DeleteResult } from '../mongodb-types';
import {
  BaseDocument,
  CreateOptions,
  UpdateOptions,
  DeleteOptions,
  HardOrSoftDeleteResult,
  UserContext,
  DefaultReferenceId,
  ExtendedUpdateResult,
  ExtendedHardOrSoftDeleteResult,
} from '../types';
import { OperationStrategy, OperationStrategyContext } from './operation-strategy';
import type { AuditLogMetadata } from '../audit-logger';

/**
 * TransactionStrategy uses MongoDB transactions to ensure ACID properties for operations.
 * When transactions are not supported, it gracefully falls back to non-transactional operations.
 *
 * @template T - The document type extending BaseDocument
 * @template TRefId - The type used for document reference IDs in audit logs
 */
export class TransactionStrategy<T extends BaseDocument, TRefId = DefaultReferenceId>
  implements OperationStrategy<T, TRefId>
{
  /**
   * Creates a new TransactionStrategy instance.
   *
   * @param context - The operation strategy context providing shared resources
   */
  constructor(private context: OperationStrategyContext<T, TRefId>) {}

  /**
   * Creates a new document within a transaction when possible.
   * Falls back to non-transactional operation if transactions are not supported.
   *
   * @param document - The document data to create
   * @param options - Options for the create operation
   * @returns Promise resolving to the created document
   * @throws Error if the operation fails
   */
  async create(document: any, options: CreateOptions<TRefId> = {}): Promise<T & { _id: ObjectId }> {
    const session = (this.context.collection.db as any).client.startSession();

    try {
      let result: T & { _id: ObjectId };

      // Try to use transactions, fall back to non-transactional if not supported
      try {
        await session.withTransaction(async () => {
          const timestampedDoc = this.context.addTimestamps(document, false, options.userContext);
          const insertResult = await this.context.collection.insertOne(timestampedDoc, { session });

          result = { ...timestampedDoc, _id: insertResult.insertedId } as T & { _id: ObjectId };

          // Create audit log within the same transaction
          if (this.context.shouldAudit(options.skipAudit)) {
            const metadata: AuditLogMetadata = {
              after: result,
            };
            await this.context.auditLogger.logOperation(
              'create',
              this.context.collectionName,
              insertResult.insertedId as TRefId,
              options.userContext,
              metadata
            );
          }
        });
      } catch (transactionError: any) {
        // If transaction fails due to lack of replica set support, fall back to non-transactional
        if (transactionError.message?.includes('replica set') || transactionError.message?.includes('Transaction')) {
          const timestampedDoc = this.context.addTimestamps(document, false, options.userContext);
          const insertResult = await this.context.collection.insertOne(timestampedDoc);

          result = { ...timestampedDoc, _id: insertResult.insertedId } as T & { _id: ObjectId };

          // Create audit log separately (non-transactional)
          if (this.context.shouldAudit(options.skipAudit)) {
            const metadata: AuditLogMetadata = {
              after: result,
            };
            await this.context.auditLogger.logOperation(
              'create',
              this.context.collectionName,
              insertResult.insertedId as TRefId,
              options.userContext,
              metadata
            );
          }
        } else {
          throw transactionError;
        }
      }

      return result!;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Create operation failed');
    } finally {
      await session.endSession();
    }
  }

  /**
   * Updates documents within a transaction when possible.
   * Falls back to non-transactional operation if transactions are not supported.
   *
   * @param filter - MongoDB filter criteria
   * @param update - Update operations to apply
   * @param options - Options for the update operation
   * @returns Promise resolving to update result information
   * @throws Error if the operation fails
   */
  async update(
    filter: Filter<T>,
    update: UpdateFilter<T>,
    options: UpdateOptions<TRefId> = {}
  ): Promise<ExtendedUpdateResult> {
    const session = (this.context.collection.db as any).client.startSession();

    try {
      let result: UpdateResult;

      // Try to use transactions, fall back to non-transactional if not supported
      try {
        await session.withTransaction(async () => {
          let beforeDoc: T | null = null;

          // Get before state if auditing
          if (this.context.shouldAudit(options.skipAudit)) {
            beforeDoc = await this.context.collection.findOne(filter, { session });
          }

          const timestampedUpdate = {
            ...update,
            $set: {
              ...((update as any).$set || {}),
              updatedAt: new Date(),
              ...(options.userContext && { updatedBy: options.userContext.userId }),
            },
          };

          const finalFilter = this.context.mergeSoftDeleteFilter(filter);
          result = await this.context.collection.updateMany(finalFilter, timestampedUpdate, {
            upsert: options.upsert,
            session,
          });

          // Create audit log if document was modified
          if (
            !options.skipAudit &&
            this.context.auditLogger.isEnabled() &&
            'modifiedCount' in result &&
            result.modifiedCount > 0 &&
            beforeDoc
          ) {
            const afterDoc = await this.context.collection.findOne({ _id: beforeDoc._id }, { session });

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
                beforeDoc._id as TRefId,
                options.userContext,
                metadata
              );
            }
          }
        });
      } catch (transactionError: any) {
        // If transaction fails due to lack of replica set support, fall back to non-transactional
        if (transactionError.message?.includes('replica set') || transactionError.message?.includes('Transaction')) {
          let beforeDoc: T | null = null;

          // Get before state if auditing
          if (this.context.shouldAudit(options.skipAudit)) {
            beforeDoc = await this.context.collection.findOne(filter);
          }

          const timestampedUpdate = {
            ...update,
            $set: {
              ...((update as any).$set || {}),
              updatedAt: new Date(),
              ...(options.userContext && { updatedBy: options.userContext.userId }),
            },
          };

          const finalFilter = this.context.mergeSoftDeleteFilter(filter);
          result = await this.context.collection.updateMany(finalFilter, timestampedUpdate, { upsert: options.upsert });

          // Create audit log if document was modified (non-transactional)
          if (
            !options.skipAudit &&
            this.context.auditLogger.isEnabled() &&
            'modifiedCount' in result &&
            result.modifiedCount > 0 &&
            beforeDoc
          ) {
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
                beforeDoc._id as TRefId,
                options.userContext,
                metadata
              );
            }
          }
        } else {
          throw transactionError;
        }
      }

      // TransactionStrategy doesn't currently track versions, so newVersion is undefined
      return { ...result!, newVersion: undefined };
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Update operation failed');
    } finally {
      await session.endSession();
    }
  }

  /**
   * Updates a single document by ID within a transaction when possible.
   *
   * @param id - The document ID to update
   * @param update - Update operations to apply
   * @param options - Options for the update operation
   * @returns Promise resolving to update result information
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
   * Deletes documents within a transaction when possible (soft delete by default).
   * Falls back to non-transactional operation if transactions are not supported.
   *
   * @param filter - MongoDB filter criteria
   * @param options - Options for the delete operation
   * @returns Promise resolving to delete/update result information
   * @throws Error if the operation fails
   */
  async delete<THardDelete extends boolean = false>(
    filter: Filter<T>,
    options: DeleteOptions<THardDelete, TRefId> = {}
  ): Promise<ExtendedHardOrSoftDeleteResult<THardDelete>> {
    const session = (this.context.collection.db as any).client.startSession();

    try {
      let result: UpdateResult | DeleteResult;

      // Try to use transactions, fall back to non-transactional if not supported
      try {
        await session.withTransaction(async () => {
          if (options.hardDelete) {
            // Get documents to delete for audit logging
            const docsToDelete = this.context.shouldAudit(options.skipAudit)
              ? await this.context.collection.find(filter, { session }).toArray()
              : [];

            result = await this.context.collection.deleteMany(filter, { session });

            // Create audit logs for deleted documents
            if (this.context.shouldAudit(options.skipAudit)) {
              for (const doc of docsToDelete) {
                const metadata: AuditLogMetadata = {
                  hardDelete: true,
                  before: doc,
                };
                await this.context.auditLogger.logOperation(
                  'delete',
                  this.context.collectionName,
                  doc._id as TRefId,
                  options.userContext,
                  metadata
                );
              }
            }
          } else {
            // Soft delete
            let beforeDoc: T | null = null;
            if (this.context.shouldAudit(options.skipAudit)) {
              beforeDoc = await this.context.collection.findOne(this.context.mergeSoftDeleteFilter(filter), {
                session,
              });
            }

            const softDeleteUpdate = {
              $set: {
                deletedAt: new Date(),
                updatedAt: new Date(),
                ...(options.userContext && { deletedBy: options.userContext.userId }),
              },
            };

            const finalFilter = this.context.mergeSoftDeleteFilter(filter);
            result = await this.context.collection.updateMany(finalFilter, softDeleteUpdate as UpdateFilter<T>, {
              session,
            });

            // Create audit log for soft delete
            if (
              !options.skipAudit &&
              this.context.auditLogger.isEnabled() &&
              beforeDoc &&
              'modifiedCount' in result &&
              result.modifiedCount > 0
            ) {
              const metadata: AuditLogMetadata = {
                softDelete: true,
                before: beforeDoc,
              };
              await this.context.auditLogger.logOperation(
                'delete',
                this.context.collectionName,
                beforeDoc._id as TRefId,
                options.userContext,
                metadata
              );
            }
          }
        });
      } catch (transactionError: any) {
        // If transaction fails due to lack of replica set support, fall back to non-transactional
        if (transactionError.message?.includes('replica set') || transactionError.message?.includes('Transaction')) {
          if (options.hardDelete) {
            // Get documents to delete for audit logging
            const docsToDelete = this.context.shouldAudit(options.skipAudit)
              ? await this.context.collection.find(filter).toArray()
              : [];

            result = await this.context.collection.deleteMany(filter);

            // Create audit logs for deleted documents (non-transactional)
            if (this.context.shouldAudit(options.skipAudit)) {
              for (const doc of docsToDelete) {
                const metadata: AuditLogMetadata = {
                  hardDelete: true,
                  before: doc,
                };
                await this.context.auditLogger.logOperation(
                  'delete',
                  this.context.collectionName,
                  doc._id as TRefId,
                  options.userContext,
                  metadata
                );
              }
            }
          } else {
            // Soft delete
            let beforeDoc: T | null = null;
            if (this.context.shouldAudit(options.skipAudit)) {
              beforeDoc = await this.context.collection.findOne(this.context.mergeSoftDeleteFilter(filter));
            }

            const softDeleteUpdate = {
              $set: {
                deletedAt: new Date(),
                updatedAt: new Date(),
                ...(options.userContext && { deletedBy: options.userContext.userId }),
              },
            };

            const finalFilter = this.context.mergeSoftDeleteFilter(filter);
            result = await this.context.collection.updateMany(finalFilter, softDeleteUpdate as UpdateFilter<T>);

            // Create audit log for soft delete (non-transactional)
            if (
              !options.skipAudit &&
              this.context.auditLogger.isEnabled() &&
              beforeDoc &&
              'modifiedCount' in result &&
              result.modifiedCount > 0
            ) {
              const metadata: AuditLogMetadata = {
                softDelete: true,
                before: beforeDoc,
              };
              await this.context.auditLogger.logOperation(
                'delete',
                this.context.collectionName,
                beforeDoc._id as TRefId,
                options.userContext,
                metadata
              );
            }
          }
        } else {
          throw transactionError;
        }
      }

      // TransactionStrategy doesn't currently track versions, so newVersion is undefined
      // For hard deletes, return standard DeleteResult; for soft deletes, return with newVersion undefined
      return { ...result!, newVersion: undefined } as ExtendedHardOrSoftDeleteResult<THardDelete>;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Delete operation failed');
    } finally {
      await session.endSession();
    }
  }

  /**
   * Deletes a single document by ID within a transaction when possible.
   *
   * @param id - The document ID to delete
   * @param options - Options for the delete operation
   * @returns Promise resolving to delete/update result information
   * @throws Error if the operation fails
   */
  async deleteById<THardDelete extends boolean = false>(
    id: ObjectId,
    options: DeleteOptions<THardDelete, TRefId> = {}
  ): Promise<ExtendedHardOrSoftDeleteResult<THardDelete>> {
    return this.delete({ _id: id } as Filter<T>, options);
  }

  /**
   * Restores soft-deleted documents within a transaction when possible.
   * Falls back to non-transactional operation if transactions are not supported.
   *
   * @param filter - MongoDB filter criteria for documents to restore
   * @param userContext - Optional user context for audit trails
   * @returns Promise resolving to update result information
   * @throws Error if the operation fails
   */
  async restore(filter: Filter<T>, userContext?: UserContext<TRefId>): Promise<ExtendedUpdateResult> {
    const session = (this.context.collection.db as any).client.startSession();

    try {
      let result: UpdateResult;

      // Try to use transactions, fall back to non-transactional if not supported
      try {
        await session.withTransaction(async () => {
          const restoreUpdate = {
            $unset: { deletedAt: 1, deletedBy: 1 },
            $set: {
              updatedAt: new Date(),
              ...(userContext && { updatedBy: userContext.userId }),
            },
          };

          result = await this.context.collection.updateMany(
            { ...filter, deletedAt: { $exists: true } } as Filter<T>,
            restoreUpdate as unknown as UpdateFilter<T>,
            { session }
          );
        });
      } catch (transactionError: any) {
        // If transaction fails due to lack of replica set support, fall back to non-transactional
        if (transactionError.message?.includes('replica set') || transactionError.message?.includes('Transaction')) {
          const restoreUpdate = {
            $unset: { deletedAt: 1, deletedBy: 1 },
            $set: {
              updatedAt: new Date(),
              ...(userContext && { updatedBy: userContext.userId }),
            },
          };

          result = await this.context.collection.updateMany(
            { ...filter, deletedAt: { $exists: true } } as Filter<T>,
            restoreUpdate as unknown as UpdateFilter<T>
          );
        } else {
          throw transactionError;
        }
      }

      // TransactionStrategy doesn't currently track versions, so newVersion is undefined
      return { ...result!, newVersion: undefined };
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Restore operation failed');
    } finally {
      await session.endSession();
    }
  }
}
