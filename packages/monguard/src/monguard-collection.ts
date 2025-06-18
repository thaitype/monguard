import type {
  Collection,
  Db,
  ObjectId,
  Filter,
  UpdateFilter,
  InsertOneResult,
  UpdateResult,
  DeleteResult,
  FindOptions,
  WithoutId
} from './mongodb-types';
import { merge } from 'lodash-es';

import type {
  BaseDocument,
  AuditableDocument,
  AuditLogDocument,
  AuditAction,
  CreateOptions,
  UpdateOptions,
  DeleteOptions,
  MonguardFindOptions,
  WrapperResult,
  UserContext,
  CreateDocument,
  MonguardConcurrencyConfig
} from './types';
import { OperationStrategy, OperationStrategyContext } from './strategies/operation-strategy';
import { StrategyFactory } from './strategies/strategy-factory';

export interface MonguardCollectionOptions {
  /**
   * Audit collection name.
   * If not provided, defaults to 'audit_logs'.
   */
  auditCollectionName?: string;
  /**
   * Globally disable audit logging for this collection.
   * When true, no audit logs will be created regardless of skipAudit options.
   * If not provided, defaults to false.
   */
  disableAudit?: boolean;
  /**
   * Monguard configuration for concurrency handling.
   * Required - must explicitly set transactionsEnabled to true or false.
   */
  concurrency: MonguardConcurrencyConfig;
}

const defaultOptions: Partial<MonguardCollectionOptions> = {
  auditCollectionName: 'audit_logs',
  disableAudit: false
};

export class MonguardCollection<T extends BaseDocument> {
  private collection: Collection<T>;
  private auditCollection: Collection<AuditLogDocument>;
  private collectionName: string;
  private options: MonguardCollectionOptions;
  private strategy: OperationStrategy<T>;

  constructor(
    db: Db,
    collectionName: string,
    options: MonguardCollectionOptions
  ) {
    // Validate that config is provided
    if (!options.concurrency) {
      throw new Error(
        'MonguardCollectionOptions.config is required. ' +
        'Must specify { transactionsEnabled: true } for MongoDB or { transactionsEnabled: false } for Cosmos DB.'
      );
    }

    // Validate configuration
    StrategyFactory.validateConfig(options.concurrency);

    this.options = merge({}, defaultOptions, options) as MonguardCollectionOptions;
    this.collection = db.collection<T>(collectionName);
    this.auditCollection = db.collection<AuditLogDocument>(this.options.auditCollectionName!); // Set by default value
    this.collectionName = collectionName;

    // Create strategy context
    const strategyContext: OperationStrategyContext<T> = {
      collection: this.collection,
      auditCollection: this.auditCollection,
      collectionName: this.collectionName,
      config: this.options.concurrency,
      disableAudit: this.options.disableAudit || false,
      createAuditLog: this.createAuditLog.bind(this),
      addTimestamps: this.addTimestamps.bind(this),
      mergeSoftDeleteFilter: this.mergeSoftDeleteFilter.bind(this),
      getChangedFields: this.getChangedFields.bind(this)
    };

    // Create strategy based on configuration
    this.strategy = StrategyFactory.create(strategyContext);
  }

  private async createAuditLog(
    action: AuditAction,
    documentId: ObjectId,
    userContext?: UserContext,
    metadata?: Record<string, any>
  ): Promise<void> {
    // Return early if audit logging is globally disabled
    if (this.options.disableAudit) {
      return;
    }

    try {
      const auditLog: WithoutId<AuditLogDocument> = {
        ref: {
          collection: this.collectionName,
          id: documentId
        },
        action,
        userId: userContext?.userId,
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
        (timestamped as any).createdBy = userContext.userId;
      }
    }

    (timestamped as any).updatedAt = now;
    if (userContext && 'updatedBy' in timestamped) {
      (timestamped as any).updatedBy = userContext.userId;
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
    return this.strategy.create(document, options);
  }

  async findById(
    id: ObjectId,
    options: MonguardFindOptions = {}
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
    options: MonguardFindOptions = {}
  ): Promise<WrapperResult<T[]>> {
    try {
      const finalFilter = options.includeSoftDeleted
        ? filter
        : this.mergeSoftDeleteFilter(filter);

      const mongoOptions: FindOptions = {};
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
    options: MonguardFindOptions = {}
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
    return this.strategy.update(filter, update, options);
  }

  async updateById(
    id: ObjectId,
    update: UpdateFilter<T>,
    options: UpdateOptions = {}
  ): Promise<WrapperResult<UpdateResult>> {
    return this.strategy.updateById(id, update, options);
  }

  async delete(
    filter: Filter<T>,
    options: DeleteOptions = {}
  ): Promise<WrapperResult<UpdateResult | DeleteResult>> {
    return this.strategy.delete(filter, options);
  }

  async deleteById(
    id: ObjectId,
    options: DeleteOptions = {}
  ): Promise<WrapperResult<UpdateResult | DeleteResult>> {
    return this.strategy.deleteById(id, options);
  }

  async restore(
    filter: Filter<T>,
    userContext?: UserContext
  ): Promise<WrapperResult<UpdateResult>> {
    return this.strategy.restore(filter, userContext);
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