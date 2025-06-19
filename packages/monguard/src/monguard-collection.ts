/**
 * @fileoverview MonguardCollection class providing MongoDB document management with audit trails, soft delete, and concurrency control.
 */

import type {
  Collection,
  Db,
  ObjectId,
  Filter,
  UpdateFilter,
  InsertOneResult,
  UpdateResult,
  DeleteResult,
  WithoutId,
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
  FindOptions,
  UserContext,
  CreateDocument,
  MonguardConcurrencyConfig,
} from './types';
import { OperationStrategy, OperationStrategyContext } from './strategies/operation-strategy';
import { StrategyFactory } from './strategies/strategy-factory';

/**
 * Configuration options for MonguardCollection initialization.
 */
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

/**
 * Default configuration options for MonguardCollection.
 */
const defaultOptions: Partial<MonguardCollectionOptions> = {
  auditCollectionName: 'audit_logs',
  disableAudit: false,
};

/**
 * MonguardCollection provides enhanced MongoDB collection operations with built-in
 * audit logging, soft delete functionality, and concurrency control.
 *
 * @template T - The document type that extends BaseDocument
 *
 * @example
 * ```typescript
 * interface User extends BaseDocument {
 *   name: string;
 *   email: string;
 * }
 *
 * const users = new MonguardCollection<User>(db, 'users', {
 *   concurrency: { transactionsEnabled: true }
 * });
 *
 * const result = await users.create({ name: 'John', email: 'john@example.com' });
 * ```
 */
export class MonguardCollection<T extends BaseDocument> {
  private collection: Collection<T>;
  private auditCollection: Collection<AuditLogDocument>;
  private collectionName: string;
  private options: MonguardCollectionOptions;
  private strategy: OperationStrategy<T>;

  /**
   * Creates a new MonguardCollection instance.
   *
   * @param db - MongoDB database instance
   * @param collectionName - Name of the collection to manage
   * @param options - Configuration options for the collection
   * @throws {Error} When concurrency configuration is missing or invalid
   */
  constructor(db: Db, collectionName: string, options: MonguardCollectionOptions) {
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
      getChangedFields: this.getChangedFields.bind(this),
    };

    // Create strategy based on configuration
    this.strategy = StrategyFactory.create(strategyContext);
  }

  /**
   * Creates an audit log entry for a document operation.
   *
   * @private
   * @param action - The type of action performed (create, update, delete)
   * @param documentId - ID of the document that was modified
   * @param userContext - Optional user context for the operation
   * @param metadata - Additional metadata about the operation
   */
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
          id: documentId,
        },
        action,
        userId: userContext?.userId,
        timestamp: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata,
      };

      await this.auditCollection.insertOne(auditLog as any);
    } catch (error) {
      console.error('Failed to create audit log:', error);
    }
  }

  /**
   * Adds timestamp fields to a document.
   *
   * @private
   * @template D - The document type
   * @param document - The document to add timestamps to
   * @param isUpdate - Whether this is an update operation (false for create)
   * @param userContext - Optional user context for audit fields
   * @returns The document with added timestamp fields
   */
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

  /**
   * Gets a filter that excludes soft-deleted documents.
   *
   * @private
   * @returns Filter object that excludes documents with deletedAt field
   */
  private getSoftDeleteFilter(): Filter<T> {
    return { deletedAt: { $exists: false } } as Filter<T>;
  }

  /**
   * Merges a user-provided filter with the soft delete filter.
   *
   * @private
   * @param filter - User-provided filter to merge
   * @returns Combined filter that excludes soft-deleted documents
   */
  private mergeSoftDeleteFilter(filter: Filter<T> = {}): Filter<T> {
    return {
      ...filter,
      ...this.getSoftDeleteFilter(),
    };
  }

  /**
   * Creates a new document in the collection with automatic timestamps and audit logging.
   *
   * @param document - The document data to create (without system fields)
   * @param options - Options for the create operation
   * @returns Promise resolving to the created document
   * @throws Error if the operation fails
   *
   * @example
   * ```typescript
   * const doc = await collection.create(
   *   { name: 'John', email: 'john@example.com' },
   *   { userContext: { userId: 'user123' } }
   * );
   * ```
   */
  async create(document: CreateDocument<T>, options: CreateOptions = {}): Promise<T & { _id: ObjectId }> {
    return this.strategy.create(document, options);
  }

  /**
   * Finds a document by its ID, excluding soft-deleted documents by default.
   *
   * @param id - The document ID to search for
   * @param options - Options for the find operation
   * @returns Promise resolving to the found document or null
   * @throws Error if the operation fails
   *
   * @example
   * ```typescript
   * const doc = await collection.findById(documentId, {
   *   includeSoftDeleted: true
   * });
   * ```
   */
  async findById(id: ObjectId, options: FindOptions = {}): Promise<T | null> {
    try {
      const filter = options.includeSoftDeleted
        ? ({ _id: id } as Filter<T>)
        : this.mergeSoftDeleteFilter({ _id: id } as Filter<T>);

      const document = await this.collection.findOne(filter);
      return document as T | null;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Find operation failed');
    }
  }

  /**
   * Finds multiple documents matching the filter, excluding soft-deleted documents by default.
   *
   * @param filter - MongoDB filter criteria
   * @param options - Options for the find operation including pagination
   * @returns Promise resolving to an array of matching documents
   * @throws Error if the operation fails
   *
   * @example
   * ```typescript
   * const docs = await collection.find(
   *   { status: 'active' },
   *   { limit: 10, skip: 20, sort: { createdAt: -1 } }
   * );
   * ```
   */
  async find(filter: Filter<T> = {}, options: FindOptions = {}): Promise<T[]> {
    try {
      const finalFilter = options.includeSoftDeleted ? filter : this.mergeSoftDeleteFilter(filter);

      const mongoOptions: FindOptions = {};
      if (options.limit) mongoOptions.limit = options.limit;
      if (options.skip) mongoOptions.skip = options.skip;
      if (options.sort) mongoOptions.sort = options.sort;

      const documents = await this.collection.find(finalFilter, mongoOptions).toArray();
      return documents as T[];
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Find operation failed');
    }
  }

  /**
   * Finds a single document matching the filter, excluding soft-deleted documents by default.
   *
   * @param filter - MongoDB filter criteria
   * @param options - Options for the find operation
   * @returns Promise resolving to the first matching document or null
   * @throws Error if the operation fails
   *
   * @example
   * ```typescript
   * const doc = await collection.findOne({ email: 'john@example.com' });
   * ```
   */
  async findOne(filter: Filter<T>, options: FindOptions = {}): Promise<T | null> {
    try {
      const finalFilter = options.includeSoftDeleted ? filter : this.mergeSoftDeleteFilter(filter);

      const document = await this.collection.findOne(finalFilter);
      return document as T | null;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Find operation failed');
    }
  }

  /**
   * Updates multiple documents matching the filter with automatic audit logging.
   *
   * @param filter - MongoDB filter criteria to select documents
   * @param update - Update operations to apply
   * @param options - Options for the update operation
   * @returns Promise resolving to update result information
   * @throws Error if the operation fails
   *
   * @example
   * ```typescript
   * const result = await collection.update(
   *   { status: 'pending' },
   *   { $set: { status: 'active' } },
   *   { userContext: { userId: 'user123' } }
   * );
   * ```
   */
  async update(filter: Filter<T>, update: UpdateFilter<T>, options: UpdateOptions = {}): Promise<UpdateResult> {
    return this.strategy.update(filter, update, options);
  }

  /**
   * Updates a single document by ID with automatic audit logging.
   *
   * @param id - The document ID to update
   * @param update - Update operations to apply
   * @param options - Options for the update operation
   * @returns Promise resolving to update result information
   * @throws Error if the operation fails
   *
   * @example
   * ```typescript
   * const result = await collection.updateById(
   *   documentId,
   *   { $set: { name: 'Jane' } },
   *   { userContext: { userId: 'user123' } }
   * );
   * ```
   */
  async updateById(id: ObjectId, update: UpdateFilter<T>, options: UpdateOptions = {}): Promise<UpdateResult> {
    return this.strategy.updateById(id, update, options);
  }

  /**
   * Deletes multiple documents matching the filter (soft delete by default).
   *
   * @param filter - MongoDB filter criteria to select documents
   * @param options - Options for the delete operation
   * @returns Promise resolving to delete/update result information
   * @throws Error if the operation fails
   *
   * @example
   * ```typescript
   * // Soft delete
   * const result = await collection.delete(
   *   { status: 'inactive' },
   *   { userContext: { userId: 'user123' } }
   * );
   *
   * // Hard delete
   * const result = await collection.delete(
   *   { status: 'inactive' },
   *   { hardDelete: true }
   * );
   * ```
   */
  async delete(filter: Filter<T>, options: DeleteOptions = {}): Promise<UpdateResult | DeleteResult> {
    return this.strategy.delete(filter, options);
  }

  /**
   * Deletes a single document by ID (soft delete by default).
   *
   * @param id - The document ID to delete
   * @param options - Options for the delete operation
   * @returns Promise resolving to delete/update result information
   * @throws Error if the operation fails
   *
   * @example
   * ```typescript
   * const result = await collection.deleteById(
   *   documentId,
   *   { userContext: { userId: 'user123' } }
   * );
   * ```
   */
  async deleteById(id: ObjectId, options: DeleteOptions = {}): Promise<UpdateResult | DeleteResult> {
    return this.strategy.deleteById(id, options);
  }

  /**
   * Restores soft-deleted documents by removing the deletedAt field.
   *
   * @param filter - MongoDB filter criteria to select documents to restore
   * @param userContext - Optional user context for audit trails
   * @returns Promise resolving to update result information
   * @throws Error if the operation fails
   *
   * @example
   * ```typescript
   * const result = await collection.restore(
   *   { _id: documentId },
   *   { userId: 'user123' }
   * );
   * ```
   */
  async restore(filter: Filter<T>, userContext?: UserContext): Promise<UpdateResult> {
    return this.strategy.restore(filter, userContext);
  }

  /**
   * Counts documents matching the filter, excluding soft-deleted documents by default.
   *
   * @param filter - MongoDB filter criteria
   * @param includeSoftDeleted - Whether to include soft-deleted documents in the count
   * @returns Promise resolving to the count of matching documents
   * @throws Error if the operation fails
   *
   * @example
   * ```typescript
   * const count = await collection.count({ status: 'active' });
   * const totalCount = await collection.count({}, true); // Include soft-deleted
   * ```
   */
  async count(filter: Filter<T> = {}, includeSoftDeleted: boolean = false): Promise<number> {
    try {
      const finalFilter = includeSoftDeleted ? filter : this.mergeSoftDeleteFilter(filter);

      const count = await this.collection.countDocuments(finalFilter);
      return count;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Count operation failed');
    }
  }

  /**
   * Compares two document states and returns the names of changed fields.
   *
   * @private
   * @param before - Document state before changes
   * @param after - Document state after changes
   * @returns Array of field names that were changed
   */
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

  /**
   * Gets the underlying MongoDB collection instance.
   *
   * @returns The MongoDB collection instance
   */
  getCollection(): Collection<T> {
    return this.collection;
  }

  /**
   * Gets the audit log collection instance.
   *
   * @returns The MongoDB collection instance for audit logs
   */
  getAuditCollection(): Collection<AuditLogDocument> {
    return this.auditCollection;
  }
}
