import type { ObjectId, Filter, UpdateFilter, UpdateResult, DeleteResult } from '../mongodb-types';
import { 
  BaseDocument, 
  CreateOptions, 
  UpdateOptions, 
  DeleteOptions, 
  WrapperResult
} from '../types';
import { toObjectId } from '../types';
import { OperationStrategy, OperationStrategyContext } from './operation-strategy';

export class OptimisticLockingStrategy<T extends BaseDocument> implements OperationStrategy<T> {
  constructor(private context: OperationStrategyContext<T>) {}

  private get defaultRetryAttempts(): number {
    return this.context.config.retryAttempts || 3;
  }

  private get defaultRetryDelay(): number {
    return this.context.config.retryDelayMs || 100;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

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
        const isVersionConflict = error instanceof Error && 
          (error.message.includes('version') || error.message.includes('modified'));
        
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

  async create(
    document: any, 
    options: CreateOptions = {}
  ): Promise<WrapperResult<T & { _id: ObjectId }>> {
    try {
      // Add version field and timestamps for new documents
      const versionedDoc = {
        ...document,
        version: 1 // Start with version 1 for new documents
      };
      
      const timestampedDoc = this.context.addTimestamps(versionedDoc, false, options.userContext);
      const result = await this.context.collection.insertOne(timestampedDoc);
      
      const createdDoc = { ...timestampedDoc, _id: result.insertedId } as T & { _id: ObjectId };
      
      // Create audit log after successful creation
      if (!options.skipAudit && !this.context.disableAudit) {
        try {
          await this.context.createAuditLog(
            'create',
            result.insertedId,
            options.userContext,
            { after: createdDoc }
          );
        } catch (auditError) {
          // Log audit error but don't fail the operation
          console.error('Failed to create audit log for create operation:', auditError);
        }
      }
      
      return {
        success: true,
        data: createdDoc
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Create operation failed'
      };
    }
  }

  async update(
    filter: Filter<T>, 
    update: UpdateFilter<T>, 
    options: UpdateOptions = {}
  ): Promise<WrapperResult<UpdateResult>> {
    try {
      const result = await this.retryWithBackoff(async () => {
        // Get current document with version
        const beforeDoc = await this.context.collection.findOne(
          this.context.mergeSoftDeleteFilter(filter)
        );
        
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
                  createdBy: toObjectId(options.userContext.userId),
                  updatedBy: toObjectId(options.userContext.userId)
                })
              }
            };
            
            return await this.context.collection.updateMany(
              filter,
              timestampedUpdate,
              { upsert: true }
            );
          }
          
          // No document to update
          return { acknowledged: true, modifiedCount: 0, upsertedCount: 0, upsertedId: null, matchedCount: 0 };
        }
        
        const currentVersion = beforeDoc.version || 1;
        
        // Create version-controlled update
        const timestampedUpdate = {
          ...update,
          $set: {
            ...((update as any).$set || {}),
            updatedAt: new Date(),
            ...(options.userContext && { updatedBy: toObjectId(options.userContext.userId) })
          },
          $inc: {
            ...((update as any).$inc || {}),
            version: 1
          }
        };
        
        // Use version in filter for optimistic locking
        const versionedFilter = {
          ...this.context.mergeSoftDeleteFilter(filter),
          version: currentVersion
        };
        
        const updateResult = await this.context.collection.updateMany(
          versionedFilter,
          timestampedUpdate
        );
        
        // Check if update succeeded (version conflict if modifiedCount = 0)
        if (updateResult.modifiedCount === 0 && beforeDoc) {
          throw new Error('Version conflict: Document was modified by another operation');
        }
        
        // Create audit log after successful update
        if (!options.skipAudit && !this.context.disableAudit && updateResult.modifiedCount > 0) {
          try {
            const afterDoc = await this.context.collection.findOne({ _id: beforeDoc._id });
            if (afterDoc) {
              const changes = this.context.getChangedFields(beforeDoc, afterDoc);
              await this.context.createAuditLog(
                'update',
                beforeDoc._id,
                options.userContext,
                {
                  before: beforeDoc,
                  after: afterDoc,
                  changes
                }
              );
            }
          } catch (auditError) {
            console.error('Failed to create audit log for update operation:', auditError);
          }
        }
        
        return updateResult;
      });
      
      return {
        success: true,
        data: result
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Update operation failed'
      };
    }
  }

  async updateById(
    id: ObjectId, 
    update: UpdateFilter<T>, 
    options: UpdateOptions = {}
  ): Promise<WrapperResult<UpdateResult>> {
    return this.update({ _id: id } as Filter<T>, update, options);
  }

  async delete(
    filter: Filter<T>, 
    options: DeleteOptions = {}
  ): Promise<WrapperResult<UpdateResult | DeleteResult>> {
    try {
      const result = await this.retryWithBackoff(async () => {
        if (options.hardDelete) {
          // Get documents to delete for audit logging
          const docsToDelete = (!options.skipAudit && !this.context.disableAudit)
            ? await this.context.collection.find(filter).toArray()
            : [];
          
          const deleteResult = await this.context.collection.deleteMany(filter);
          
          // Create audit logs after successful deletion
          if (!options.skipAudit && !this.context.disableAudit && deleteResult.deletedCount > 0) {
            try {
              for (const doc of docsToDelete) {
                await this.context.createAuditLog(
                  'delete',
                  doc._id,
                  options.userContext,
                  { hardDelete: true, before: doc }
                );
              }
            } catch (auditError) {
              console.error('Failed to create audit log for hard delete operation:', auditError);
            }
          }
          
          return deleteResult;
        } else {
          // Soft delete with version control - handle multiple documents
          const beforeDocs = await this.context.collection.find(
            this.context.mergeSoftDeleteFilter(filter)
          ).toArray();
          
          if (beforeDocs.length === 0) {
            return { acknowledged: true, modifiedCount: 0, upsertedCount: 0, upsertedId: null, matchedCount: 0 };
          }
          
          let totalModified = 0;
          
          // Process each document individually for version control
          for (const beforeDoc of beforeDocs) {
            const currentVersion = beforeDoc.version || 1;
            
            const softDeleteUpdate = {
              $set: {
                deletedAt: new Date(),
                updatedAt: new Date(),
                ...(options.userContext && { deletedBy: toObjectId(options.userContext.userId) })
              },
              $inc: { version: 1 }
            };
            
            // Use version in filter for optimistic locking
            const versionedFilter = {
              _id: beforeDoc._id,
              version: currentVersion,
              deletedAt: { $exists: false }
            };
            
            const updateResult = await this.context.collection.updateOne(
              versionedFilter as Filter<T>,
              softDeleteUpdate as UpdateFilter<T>
            );
            
            if (updateResult.modifiedCount > 0) {
              totalModified += updateResult.modifiedCount;
              
              // Create audit log after successful soft delete
              if (!options.skipAudit && !this.context.disableAudit) {
                try {
                  await this.context.createAuditLog(
                    'delete',
                    beforeDoc._id,
                    options.userContext,
                    { softDelete: true, before: beforeDoc }
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
            matchedCount: beforeDocs.length 
          };
        }
      });
      
      return {
        success: true,
        data: result
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Delete operation failed'
      };
    }
  }

  async deleteById(
    id: ObjectId, 
    options: DeleteOptions = {}
  ): Promise<WrapperResult<UpdateResult | DeleteResult>> {
    return this.delete({ _id: id } as Filter<T>, options);
  }

  async restore(
    filter: Filter<T>, 
    userContext?: any
  ): Promise<WrapperResult<UpdateResult>> {
    try {
      const result = await this.retryWithBackoff(async () => {
        // Find deleted documents to restore
        const deletedDocs = await this.context.collection.find({
          ...filter,
          deletedAt: { $exists: true }
        }).toArray();
        
        if (deletedDocs.length === 0) {
          return { acknowledged: true, modifiedCount: 0, upsertedCount: 0, upsertedId: null, matchedCount: 0 };
        }
        
        // Restore each document with version control
        let totalModified = 0;
        
        for (const doc of deletedDocs) {
          const currentVersion = doc.version || 1;
          
          const restoreUpdate = {
            $unset: { deletedAt: 1, deletedBy: 1 },
            $set: {
              updatedAt: new Date(),
              ...(userContext && { updatedBy: toObjectId(userContext.userId) })
            },
            $inc: { version: 1 }
          };
          
          const versionedFilter = {
            _id: doc._id,
            version: currentVersion,
            deletedAt: { $exists: true }
          };
          
          const updateResult = await this.context.collection.updateOne(
            versionedFilter as Filter<T>,
            restoreUpdate as UpdateFilter<T>
          );
          
          if (updateResult.modifiedCount === 0) {
            throw new Error('Version conflict: Document was modified by another operation');
          }
          
          totalModified += updateResult.modifiedCount;
        }
        
        return { 
          acknowledged: true, 
          modifiedCount: totalModified, 
          upsertedCount: 0, 
          upsertedId: null, 
          matchedCount: deletedDocs.length 
        };
      });
      
      return {
        success: true,
        data: result
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Restore operation failed'
      };
    }
  }
}