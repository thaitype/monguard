import { ObjectId, Filter, UpdateFilter, UpdateResult, DeleteResult, ClientSession } from 'mongodb';
import { 
  BaseDocument, 
  CreateOptions, 
  UpdateOptions, 
  DeleteOptions, 
  WrapperResult
} from '../types';
import { toObjectId } from '../types';
import { OperationStrategy, OperationStrategyContext } from './operation-strategy';

export class TransactionStrategy<T extends BaseDocument> implements OperationStrategy<T> {
  constructor(private context: OperationStrategyContext<T>) {}

  async create(
    document: any, 
    options: CreateOptions = {}
  ): Promise<WrapperResult<T & { _id: ObjectId }>> {
    const session = this.context.collection.db.client.startSession();
    
    try {
      let result: T & { _id: ObjectId };
      
      await session.withTransaction(async () => {
        const timestampedDoc = this.context.addTimestamps(document, false, options.userContext);
        const insertResult = await this.context.collection.insertOne(timestampedDoc, { session });
        
        result = { ...timestampedDoc, _id: insertResult.insertedId } as T & { _id: ObjectId };
        
        // Create audit log within the same transaction
        if (!options.skipAudit && !this.context.disableAudit) {
          await this.context.createAuditLog(
            'create',
            insertResult.insertedId,
            options.userContext,
            { after: result }
          );
        }
      });
      
      return {
        success: true,
        data: result!
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Create operation failed'
      };
    } finally {
      await session.endSession();
    }
  }

  async update(
    filter: Filter<T>, 
    update: UpdateFilter<T>, 
    options: UpdateOptions = {}
  ): Promise<WrapperResult<UpdateResult>> {
    const session = this.context.collection.db.client.startSession();
    
    try {
      let result: UpdateResult;
      
      await session.withTransaction(async () => {
        let beforeDoc: T | null = null;
        
        // Get before state if auditing
        if (!options.skipAudit && !this.context.disableAudit) {
          beforeDoc = await this.context.collection.findOne(filter, { session });
        }
        
        const timestampedUpdate = {
          ...update,
          $set: {
            ...((update as any).$set || {}),
            updatedAt: new Date(),
            ...(options.userContext && { updatedBy: toObjectId(options.userContext.userId) })
          }
        };
        
        const finalFilter = this.context.mergeSoftDeleteFilter(filter);
        result = await this.context.collection.updateMany(
          finalFilter,
          timestampedUpdate,
          { upsert: options.upsert, session }
        );
        
        // Create audit log if document was modified
        if (!options.skipAudit && !this.context.disableAudit && 'modifiedCount' in result && result.modifiedCount > 0 && beforeDoc) {
          const afterDoc = await this.context.collection.findOne({ _id: beforeDoc._id }, { session });
          
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
        }
      });
      
      return {
        success: true,
        data: result!
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Update operation failed'
      };
    } finally {
      await session.endSession();
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
    const session = this.context.collection.db.client.startSession();
    
    try {
      let result: UpdateResult | DeleteResult;
      
      await session.withTransaction(async () => {
        if (options.hardDelete) {
          // Get documents to delete for audit logging
          const docsToDelete = (!options.skipAudit && !this.context.disableAudit)
            ? await this.context.collection.find(filter, { session }).toArray()
            : [];
          
          result = await this.context.collection.deleteMany(filter, { session });
          
          // Create audit logs for deleted documents
          if (!options.skipAudit && !this.context.disableAudit) {
            for (const doc of docsToDelete) {
              await this.context.createAuditLog(
                'delete',
                doc._id,
                options.userContext,
                { hardDelete: true, before: doc }
              );
            }
          }
        } else {
          // Soft delete
          let beforeDoc: T | null = null;
          if (!options.skipAudit && !this.context.disableAudit) {
            beforeDoc = await this.context.collection.findOne(
              this.context.mergeSoftDeleteFilter(filter), 
              { session }
            );
          }
          
          const softDeleteUpdate = {
            $set: {
              deletedAt: new Date(),
              updatedAt: new Date(),
              ...(options.userContext && { deletedBy: toObjectId(options.userContext.userId) })
            }
          };
          
          const finalFilter = this.context.mergeSoftDeleteFilter(filter);
          result = await this.context.collection.updateMany(finalFilter, softDeleteUpdate, { session });
          
          // Create audit log for soft delete
          if (!options.skipAudit && !this.context.disableAudit && beforeDoc && 'modifiedCount' in result && result.modifiedCount > 0) {
            await this.context.createAuditLog(
              'delete',
              beforeDoc._id,
              options.userContext,
              { softDelete: true, before: beforeDoc }
            );
          }
        }
      });
      
      return {
        success: true,
        data: result!
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Delete operation failed'
      };
    } finally {
      await session.endSession();
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
    const session = this.context.collection.db.client.startSession();
    
    try {
      let result: UpdateResult;
      
      await session.withTransaction(async () => {
        const restoreUpdate = {
          $unset: { deletedAt: "", deletedBy: "" },
          $set: {
            updatedAt: new Date(),
            ...(userContext && { updatedBy: toObjectId(userContext.userId) })
          }
        };
        
        result = await this.context.collection.updateMany(
          { ...filter, deletedAt: { $exists: true } } as Filter<T>,
          restoreUpdate,
          { session }
        );
      });
      
      return {
        success: true,
        data: result!
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Restore operation failed'
      };
    } finally {
      await session.endSession();
    }
  }
}