import {
  Collection,
  Db,
  ObjectId
} from 'mongodb';
import type {
  Filter,
  UpdateFilter,
  InsertOneResult,
  UpdateResult,
  DeleteResult,
  FindOptions as MongoFindOptions,
  WithoutId
} from 'mongodb';
import { merge } from 'lodash-es';

import type {
  BaseDocument,
  AuditableDocument,
  AuditLogDocument,
  AuditAction,
  CreateOptions,
  UpdateOptions,
  DeleteOptions,
  FindOptions,
  WrapperResult,
  UserContext,
  CreateDocument
} from './types';
import { toObjectId } from './types';

export interface MonguardCollectionOptions {
  /**
   * Audit collection name.
   * If not provided, defaults to 'audit_logs'.
   */
  auditCollectionName: string;
}

const defaultOptions: MonguardCollectionOptions = {
  auditCollectionName: 'audit_logs'
};

export class MonguardCollection<T extends BaseDocument> {
  private collection: Collection<T>;
  private auditCollection: Collection<AuditLogDocument>;
  private collectionName: string;
  private options: MonguardCollectionOptions;

  constructor(
    db: Db,
    collectionName: string,
    options?: Partial<MonguardCollectionOptions>,
  ) {
    this.options = merge({}, defaultOptions, options);
    this.collection = db.collection<T>(collectionName);
    this.auditCollection = db.collection<AuditLogDocument>(this.options.auditCollectionName);
    this.collectionName = collectionName;
  }

  private async createAuditLog(
    action: AuditAction,
    documentId: ObjectId,
    userContext?: UserContext,
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      const auditLog: WithoutId<AuditLogDocument> = {
        ref: {
          collection: this.collectionName,
          id: documentId
        },
        action,
        userId: userContext?.userId ? toObjectId(userContext.userId) : undefined,
        timestamp: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata
      };

      await this.auditCollection.insertOne(auditLog as any);
    } catch (error) {
      console.error('Failed to create audit log:', error);
    }
  }

  private addTimestamps<D extends Record<string, any>>(
    document: D,
    isUpdate: boolean = false,
    userContext?: UserContext
  ): D {
    const now = new Date();
    const timestamped = { ...document };

    if (!isUpdate) {
      (timestamped as any).createdAt = now;
      if (userContext && 'createdBy' in timestamped) {
        (timestamped as any).createdBy = toObjectId(userContext.userId);
      }
    }

    (timestamped as any).updatedAt = now;
    if (userContext && 'updatedBy' in timestamped) {
      (timestamped as any).updatedBy = toObjectId(userContext.userId);
    }

    return timestamped;
  }

  private getSoftDeleteFilter(): Filter<T> {
    return { deletedAt: { $exists: false } } as Filter<T>;
  }

  private mergeSoftDeleteFilter(filter: Filter<T> = {}): Filter<T> {
    return {
      ...filter,
      ...this.getSoftDeleteFilter()
    };
  }

  async create(
    document: CreateDocument<T>,
    options: CreateOptions = {}
  ): Promise<WrapperResult<T & { _id: ObjectId }>> {
    try {
      const timestampedDoc = this.addTimestamps(document, false, options.userContext);
      const result: InsertOneResult<T> = await this.collection.insertOne(timestampedDoc as any);

      if (!options.skipAudit) {
        await this.createAuditLog(
          'create',
          result.insertedId,
          options.userContext,
          { after: timestampedDoc }
        );
      }

      return {
        success: true,
        data: { ...timestampedDoc, _id: result.insertedId } as any
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Create operation failed'
      };
    }
  }

  async findById(
    id: ObjectId,
    options: FindOptions = {}
  ): Promise<WrapperResult<T | null>> {
    try {
      const filter = options.includeSoftDeleted
        ? { _id: id } as Filter<T>
        : this.mergeSoftDeleteFilter({ _id: id } as Filter<T>);

      const document = await this.collection.findOne(filter);

      return {
        success: true,
        data: document as T | null
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Find operation failed'
      };
    }
  }

  async find(
    filter: Filter<T> = {},
    options: FindOptions = {}
  ): Promise<WrapperResult<T[]>> {
    try {
      const finalFilter = options.includeSoftDeleted
        ? filter
        : this.mergeSoftDeleteFilter(filter);

      const mongoOptions: MongoFindOptions = {};
      if (options.limit) mongoOptions.limit = options.limit;
      if (options.skip) mongoOptions.skip = options.skip;
      if (options.sort) mongoOptions.sort = options.sort;

      const documents = await this.collection
        .find(finalFilter, mongoOptions)
        .toArray();

      return {
        success: true,
        data: documents as T[]
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Find operation failed'
      };
    }
  }

  async findOne(
    filter: Filter<T>,
    options: FindOptions = {}
  ): Promise<WrapperResult<T | null>> {
    try {
      const finalFilter = options.includeSoftDeleted
        ? filter
        : this.mergeSoftDeleteFilter(filter);

      const document = await this.collection.findOne(finalFilter);

      return {
        success: true,
        data: document as T | null
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Find operation failed'
      };
    }
  }

  async update(
    filter: Filter<T>,
    update: UpdateFilter<T>,
    options: UpdateOptions = {}
  ): Promise<WrapperResult<UpdateResult>> {
    try {
      let beforeDoc: T | null = null;

      if (!options.skipAudit) {
        const beforeResult = await this.findOne(filter, { includeSoftDeleted: true });
        beforeDoc = beforeResult.data || null;
      }

      const timestampedUpdate = {
        ...update,
        $set: {
          ...((update as any).$set || {}),
          updatedAt: new Date(),
          ...(options.userContext && { updatedBy: toObjectId(options.userContext.userId) })
        }
      };

      const finalFilter = this.mergeSoftDeleteFilter(filter);
      const result = await this.collection.updateOne(
        finalFilter,
        timestampedUpdate,
        { upsert: options.upsert }
      );

      if (!options.skipAudit && result.modifiedCount > 0) {
        const afterResult = await this.findOne(filter, { includeSoftDeleted: true });
        const afterDoc = afterResult.data;

        if (beforeDoc && afterDoc) {
          const changes = this.getChangedFields(beforeDoc, afterDoc);
          await this.createAuditLog(
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
      if (options.hardDelete) {
        // 1. Get documents to delete
        const docsToDelete = !options.skipAudit
          ? await this.collection.find(filter).toArray()
          : [];

        // 2. Actually delete the documents
        const result = await this.collection.deleteMany(filter);

        // 3. Create audit logs for hard delete
        if (!options.skipAudit) {
          for (const doc of docsToDelete) {
            await this.createAuditLog(
              'delete',
              doc._id,
              options.userContext,
              {
                hardDelete: true,
                before: doc
              }
            );
          }
        }
        return {
          success: true,
          data: result
        };
      } else {
        // Soft delete
        const finalFilter = this.mergeSoftDeleteFilter(filter);
        const softDeleteUpdate: UpdateFilter<T> = {
          $set: {
            deletedAt: new Date(),
            updatedAt: new Date(),
            ...(options.userContext && { deletedBy: toObjectId(options.userContext.userId) })
          } as any
        };

        let beforeDoc: T | null = null;
        if (!options.skipAudit) {
          const beforeResult = await this.findOne(filter);
          beforeDoc = beforeResult.data || null;
        }

        const result = await this.collection.updateMany(finalFilter, softDeleteUpdate);

        if (!options.skipAudit && beforeDoc) {
          await this.createAuditLog(
            'delete',
            beforeDoc._id,
            options.userContext,
            { softDelete: true, before: beforeDoc }
          );
        }

        return {
          success: true,
          data: result
        };
      }
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
    userContext?: UserContext
  ): Promise<WrapperResult<UpdateResult>> {
    try {
      const restoreUpdate: UpdateFilter<T> = {
        $unset: { deletedAt: "", deletedBy: "" },
        $set: {
          updatedAt: new Date(),
          ...(userContext && { updatedBy: toObjectId(userContext.userId) })
        }
      } as any;

      const result = await this.collection.updateMany(
        { ...filter, deletedAt: { $exists: true } } as Filter<T>,
        restoreUpdate
      );

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

  async count(
    filter: Filter<T> = {},
    includeSoftDeleted: boolean = false
  ): Promise<WrapperResult<number>> {
    try {
      const finalFilter = includeSoftDeleted
        ? filter
        : this.mergeSoftDeleteFilter(filter);

      const count = await this.collection.countDocuments(finalFilter);

      return {
        success: true,
        data: count
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Count operation failed'
      };
    }
  }

  private getChangedFields(before: any, after: any): string[] {
    const changes: string[] = [];
    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

    for (const key of allKeys) {
      if (key === 'updatedAt' || key === 'updatedBy') continue;

      const beforeValue = before[key];
      const afterValue = after[key];

      if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
        changes.push(key);
      }
    }

    return changes;
  }

  getCollection(): Collection<T> {
    return this.collection;
  }

  getAuditCollection(): Collection<AuditLogDocument> {
    return this.auditCollection;
  }
}