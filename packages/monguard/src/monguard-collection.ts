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
  HardOrSoftDeleteResult,
  DefaultReferenceId,
  AutoFieldControlOptions,
  AuditControlOptions,
  AutoFieldUpdateOptions,
  ManualAuditOptions,
  BatchAuditEntry,
  ExtendedUpdateResult,
  ExtendedHardOrSoftDeleteResult,
} from './types';
import { OperationStrategy, OperationStrategyContext } from './strategies/operation-strategy';
import { StrategyFactory } from './strategies/strategy-factory';
import { AuditLogger, NoOpAuditLogger, MonguardAuditLogger } from './audit-logger';

/**
 * Configuration options for MonguardCollection initialization.
 * @template TRefId - The type used for document reference IDs in audit logs
 */
export interface MonguardCollectionOptions<TRefId = DefaultReferenceId> {
  /**
   * Audit logger instance for tracking document changes.
   * If not provided, audit logging will be disabled (uses NoOpAuditLogger).
   */
  auditLogger?: AuditLogger<TRefId>;
  /**
   * Monguard configuration for concurrency handling.
   * Required - must explicitly set transactionsEnabled to true or false.
   */
  concurrency: MonguardConcurrencyConfig;
  /**
   * Configuration options for controlling automatic field management.
   * Allows external applications to control when and how auto-fields are populated.
   */
  autoFieldControl?: AutoFieldControlOptions<TRefId>;
  /**
   * Configuration options for controlling audit logging behavior.
   * Allows external applications to control when audit logs are created.
   */
  auditControl?: AuditControlOptions;
}

/**
 * Default configuration options for MonguardCollection.
 */
const defaultOptions: Partial<MonguardCollectionOptions> = {
  autoFieldControl: {
    enableAutoTimestamps: true,
    enableAutoUserTracking: true,
  },
  auditControl: {
    enableAutoAudit: true,
    auditCustomOperations: false,
    mode: 'inTransaction',
    failOnError: false,
    logFailedAttempts: false,
  },
};

/**
 * MonguardCollection provides enhanced MongoDB collection operations with built-in
 * audit logging, soft delete functionality, and concurrency control.
 *
 * @template T - The document type that extends BaseDocument
 * @template TRefId - The type used for document reference IDs in audit logs
 *
 * @example
 * ```typescript
 * interface User extends BaseDocument {
 *   name: string;
 *   email: string;
 * }
 *
 * // With audit logging disabled (default - no auditLogger provided)
 * const users = new MonguardCollection<User>(db, 'users', {
 *   concurrency: { transactionsEnabled: true }
 * });
 *
 * // With audit logging enabled
 * const auditLogger = new MonguardAuditLogger(db, 'audit_logs');
 * const usersWithAudit = new MonguardCollection<User>(db, 'users', {
 *   concurrency: { transactionsEnabled: true },
 *   auditLogger
 * });
 *
 * const result = await users.create({ name: 'John', email: 'john@example.com' });
 * ```
 */
export class MonguardCollection<T extends BaseDocument, TRefId = DefaultReferenceId> {
  private collection: Collection<T>;
  private collectionName: string;
  private options: MonguardCollectionOptions<TRefId>;
  private strategy: OperationStrategy<T, TRefId>;
  private auditLogger: AuditLogger<TRefId>;

  /**
   * Creates a new MonguardCollection instance.
   *
   * @param db - MongoDB database instance
   * @param collectionName - Name of the collection to manage
   * @param options - Configuration options for the collection
   * @throws {Error} When concurrency configuration is missing or invalid
   */
  constructor(db: Db, collectionName: string, options: MonguardCollectionOptions<TRefId>) {
    // Validate that config is provided
    if (!options.concurrency) {
      throw new Error(
        'MonguardCollectionOptions.config is required. ' +
          'Must specify { transactionsEnabled: true } for MongoDB or { transactionsEnabled: false } for Cosmos DB.'
      );
    }

    // Validate configuration
    StrategyFactory.validateConfig(options.concurrency);

    this.options = merge({}, defaultOptions, options) as MonguardCollectionOptions<TRefId>;
    this.collection = db.collection<T>(collectionName) as Collection<T>;
    this.collectionName = collectionName;

    // Initialize audit logger - use provided auditLogger or disable by default
    if (options.auditLogger) {
      this.auditLogger = options.auditLogger;
    } else {
      // No audit logger provided - disable audit logging
      this.auditLogger = new NoOpAuditLogger();
    }

    // Validate outbox configuration if outbox mode is requested
    const finalAuditControl = this.options.auditControl || defaultOptions.auditControl!;
    if (finalAuditControl.mode === 'outbox') {
      // Check if audit logger is MonguardAuditLogger and has outbox transport
      if (this.auditLogger instanceof MonguardAuditLogger) {
        const hasOutboxTransport = (this.auditLogger as any).outboxTransport;
        if (!hasOutboxTransport) {
          // Only throw error if failOnError is true (strict mode)
          if (finalAuditControl.failOnError) {
            throw new Error(
              'Outbox transport is required when audit control mode is "outbox". ' +
                'Please provide an outboxTransport option when creating the MonguardAuditLogger.'
            );
          } else {
            // Warn about missing outbox transport but allow fallback
            console.warn(
              'Outbox transport is missing for outbox mode. ' + 'Audit logger will fall back to in-transaction mode.'
            );
          }
        }
      } else if (!(this.auditLogger instanceof NoOpAuditLogger)) {
        // For custom audit loggers, we can't validate but should warn
        console.warn(
          'Using custom audit logger with outbox mode. ' +
            'Please ensure your audit logger implementation supports outbox mode.'
        );
      } else {
        // NoOpAuditLogger with outbox mode - this is fine, auditing is disabled
      }
    }

    // Create strategy context
    const strategyContext: OperationStrategyContext<T, TRefId> = {
      collection: this.collection,
      auditLogger: this.auditLogger,
      collectionName: this.collectionName,
      config: this.options.concurrency,
      auditControl: this.options.auditControl || defaultOptions.auditControl!,
      addTimestamps: this.addTimestamps.bind(this),
      mergeSoftDeleteFilter: this.mergeSoftDeleteFilter.bind(this),
      getChangedFields: this.getChangedFields.bind(this),
      shouldAudit: this.shouldAudit.bind(this),
    };

    // Create strategy based on configuration
    this.strategy = StrategyFactory.create(strategyContext);
  }

  /**
   * Updates auto-managed fields on a document based on the operation type and configuration.
   * This method provides external applications with control over when and how auto-fields are populated.
   *
   * @param document - The document to update with auto-fields
   * @param options - Configuration options for the auto-field update
   * @returns The document with updated auto-fields
   *
   * @example
   * ```typescript
   * const doc = { name: 'John', email: 'john@example.com' };
   * collection.updateAutoFields(doc, {
   *   operation: 'create',
   *   userContext: { userId: 'user123' }
   * });
   * ```
   */
  public updateAutoFields<D extends Record<string, any>>(document: D, options: AutoFieldUpdateOptions<TRefId>): D {
    const timestamped = { ...document };
    const autoFieldConfig = this.options.autoFieldControl || defaultOptions.autoFieldControl!;

    const timestamp =
      options.customTimestamp ||
      (autoFieldConfig.customTimestampProvider ? autoFieldConfig.customTimestampProvider() : new Date());

    const shouldSetTimestamps = autoFieldConfig.enableAutoTimestamps !== false;
    const shouldSetUserFields = autoFieldConfig.enableAutoUserTracking !== false && options.userContext;

    const fields = options.fields || {};

    switch (options.operation) {
      case 'create':
        if (shouldSetTimestamps && fields.createdAt !== false) {
          (timestamped as any).createdAt = timestamp;
        }
        if (shouldSetTimestamps && fields.updatedAt !== false) {
          (timestamped as any).updatedAt = timestamp;
        }
        if (shouldSetUserFields && fields.createdBy !== false) {
          (timestamped as any).createdBy = options.userContext!.userId;
        }
        if (shouldSetUserFields && fields.updatedBy !== false) {
          (timestamped as any).updatedBy = options.userContext!.userId;
        }
        break;

      case 'update':
        if (shouldSetTimestamps && fields.updatedAt !== false) {
          (timestamped as any).updatedAt = timestamp;
        }
        if (shouldSetUserFields && fields.updatedBy !== false) {
          (timestamped as any).updatedBy = options.userContext!.userId;
        }
        break;

      case 'delete':
        if (shouldSetTimestamps && fields.deletedAt !== false) {
          (timestamped as any).deletedAt = timestamp;
        }
        if (shouldSetTimestamps && fields.updatedAt !== false) {
          (timestamped as any).updatedAt = timestamp;
        }
        if (shouldSetUserFields && fields.deletedBy !== false) {
          (timestamped as any).deletedBy = options.userContext!.userId;
        }
        if (shouldSetUserFields && fields.updatedBy !== false) {
          (timestamped as any).updatedBy = options.userContext!.userId;
        }
        break;

      case 'restore':
        if (shouldSetTimestamps && fields.updatedAt !== false) {
          (timestamped as any).updatedAt = timestamp;
        }
        if (shouldSetUserFields && fields.updatedBy !== false) {
          (timestamped as any).updatedBy = options.userContext!.userId;
        }
        delete (timestamped as any).deletedAt;
        delete (timestamped as any).deletedBy;
        break;

      case 'custom':
        if (fields.createdAt === true && shouldSetTimestamps) {
          (timestamped as any).createdAt = timestamp;
        }
        if (fields.updatedAt === true && shouldSetTimestamps) {
          (timestamped as any).updatedAt = timestamp;
        }
        if (fields.deletedAt === true && shouldSetTimestamps) {
          (timestamped as any).deletedAt = timestamp;
        }
        if (fields.createdBy === true && shouldSetUserFields) {
          (timestamped as any).createdBy = options.userContext!.userId;
        }
        if (fields.updatedBy === true && shouldSetUserFields) {
          (timestamped as any).updatedBy = options.userContext!.userId;
        }
        if (fields.deletedBy === true && shouldSetUserFields) {
          (timestamped as any).deletedBy = options.userContext!.userId;
        }
        break;
    }

    return timestamped;
  }

  /**
   * Sets creation-related auto-fields (createdAt, createdBy) on a document.
   * Provides granular control for external applications.
   *
   * @param document - The document to update
   * @param userContext - Optional user context for createdBy field
   * @param timestamp - Optional custom timestamp (defaults to current time)
   */
  public setCreatedFields(document: any, userContext?: UserContext<TRefId>, timestamp?: Date): void {
    const autoFieldConfig = this.options.autoFieldControl || defaultOptions.autoFieldControl!;
    const finalTimestamp =
      timestamp || (autoFieldConfig.customTimestampProvider ? autoFieldConfig.customTimestampProvider() : new Date());

    if (autoFieldConfig.enableAutoTimestamps !== false) {
      document.createdAt = finalTimestamp;
    }

    if (autoFieldConfig.enableAutoUserTracking !== false && userContext) {
      document.createdBy = userContext.userId;
    }
  }

  /**
   * Sets update-related auto-fields (updatedAt, updatedBy) on a document.
   * Provides granular control for external applications.
   *
   * @param document - The document to update
   * @param userContext - Optional user context for updatedBy field
   * @param timestamp - Optional custom timestamp (defaults to current time)
   */
  public setUpdatedFields(document: any, userContext?: UserContext<TRefId>, timestamp?: Date): void {
    const autoFieldConfig = this.options.autoFieldControl || defaultOptions.autoFieldControl!;
    const finalTimestamp =
      timestamp || (autoFieldConfig.customTimestampProvider ? autoFieldConfig.customTimestampProvider() : new Date());

    if (autoFieldConfig.enableAutoTimestamps !== false) {
      document.updatedAt = finalTimestamp;
    }

    if (autoFieldConfig.enableAutoUserTracking !== false && userContext) {
      document.updatedBy = userContext.userId;
    }
  }

  /**
   * Sets deletion-related auto-fields (deletedAt, deletedBy) on a document for soft delete.
   * Provides granular control for external applications.
   *
   * @param document - The document to update
   * @param userContext - Optional user context for deletedBy field
   * @param timestamp - Optional custom timestamp (defaults to current time)
   */
  public setDeletedFields(document: any, userContext?: UserContext<TRefId>, timestamp?: Date): void {
    const autoFieldConfig = this.options.autoFieldControl || defaultOptions.autoFieldControl!;
    const finalTimestamp =
      timestamp || (autoFieldConfig.customTimestampProvider ? autoFieldConfig.customTimestampProvider() : new Date());

    if (autoFieldConfig.enableAutoTimestamps !== false) {
      document.deletedAt = finalTimestamp;
      document.updatedAt = finalTimestamp;
    }

    if (autoFieldConfig.enableAutoUserTracking !== false && userContext) {
      document.deletedBy = userContext.userId;
      document.updatedBy = userContext.userId;
    }
  }

  /**
   * Clears deletion-related auto-fields (deletedAt, deletedBy) on a document for restore operations.
   * Also updates the updatedAt and updatedBy fields to reflect the restore operation.
   * Provides granular control for external applications.
   *
   * @param document - The document to update
   * @param userContext - Optional user context for updatedBy field
   * @param timestamp - Optional custom timestamp (defaults to current time)
   */
  public clearDeletedFields(document: any, userContext?: UserContext<TRefId>, timestamp?: Date): void {
    const autoFieldConfig = this.options.autoFieldControl || defaultOptions.autoFieldControl!;
    const finalTimestamp =
      timestamp || (autoFieldConfig.customTimestampProvider ? autoFieldConfig.customTimestampProvider() : new Date());

    delete document.deletedAt;
    delete document.deletedBy;

    if (autoFieldConfig.enableAutoTimestamps !== false) {
      document.updatedAt = finalTimestamp;
    }

    if (autoFieldConfig.enableAutoUserTracking !== false && userContext) {
      document.updatedBy = userContext.userId;
    }
  }

  /**
   * Legacy method for backward compatibility. Uses the new updateAutoFields method internally.
   * @private
   * @deprecated Use updateAutoFields instead
   */
  private addTimestamps<D extends Record<string, any>>(
    document: D,
    isUpdate: boolean = false,
    userContext?: UserContext<TRefId>
  ): D {
    return this.updateAutoFields(document, {
      operation: isUpdate ? 'update' : 'create',
      userContext,
    });
  }

  /**
   * Manually creates an audit log entry for a document operation.
   * This allows external applications to create audit logs for custom operations or bypass automatic logging.
   *
   * @param action - The type of action performed
   * @param documentId - ID of the document that was affected
   * @param userContext - Optional user context for the operation
   * @param metadata - Optional metadata for the audit log entry
   * @returns Promise that resolves when the audit log is created
   *
   * @example
   * ```typescript
   * await collection.createAuditLog(
   *   'custom',
   *   docId,
   *   { userId: 'user123' },
   *   {
   *     beforeDocument: oldDoc,
   *     afterDocument: newDoc,
   *     customData: { reason: 'bulk_import' }
   *   }
   * );
   * ```
   */
  public async createAuditLog(
    action: AuditAction,
    documentId: ObjectId,
    userContext?: UserContext<TRefId>,
    metadata?: ManualAuditOptions<TRefId>
  ): Promise<void> {
    const auditControl = this.options.auditControl || defaultOptions.auditControl!;

    if (!auditControl.enableAutoAudit && !auditControl.auditCustomOperations) {
      return;
    }

    if (action === 'custom' && !auditControl.auditCustomOperations) {
      return;
    }

    const auditMetadata = {
      before: metadata?.beforeDocument,
      after: metadata?.afterDocument,
      ...(metadata?.customData && { customData: metadata.customData }),
    };

    await this.auditLogger.logOperation(action, this.collectionName, documentId as TRefId, userContext, auditMetadata);
  }

  /**
   * Manually creates multiple audit log entries in a batch operation.
   * This allows external applications to efficiently create multiple audit logs at once.
   *
   * @param entries - Array of audit log entries to create
   * @returns Promise that resolves when all audit logs are created
   *
   * @example
   * ```typescript
   * await collection.createAuditLogs([
   *   {
   *     action: 'create',
   *     documentId: doc1Id,
   *     userContext: { userId: 'user123' },
   *     metadata: { afterDocument: doc1 }
   *   },
   *   {
   *     action: 'update',
   *     documentId: doc2Id,
   *     userContext: { userId: 'user123' },
   *     metadata: { beforeDocument: oldDoc2, afterDocument: newDoc2 }
   *   }
   * ]);
   * ```
   */
  public async createAuditLogs(entries: BatchAuditEntry<TRefId>[]): Promise<void> {
    const auditControl = this.options.auditControl || defaultOptions.auditControl!;

    if (!auditControl.enableAutoAudit && !auditControl.auditCustomOperations) {
      return;
    }

    const filteredEntries = entries.filter(entry => {
      if (!auditControl.enableAutoAudit && !auditControl.auditCustomOperations) {
        return false;
      }
      if (entry.action === 'custom' && !auditControl.auditCustomOperations) {
        return false;
      }
      return true;
    });

    const auditPromises = filteredEntries.map(entry => {
      const auditMetadata = {
        before: entry.metadata?.beforeDocument,
        after: entry.metadata?.afterDocument,
        ...(entry.metadata?.customData && { customData: entry.metadata.customData }),
      };

      return this.auditLogger.logOperation(
        entry.action,
        this.collectionName,
        entry.documentId,
        entry.userContext,
        auditMetadata
      );
    });

    await Promise.all(auditPromises);
  }

  /**
   * Determines whether audit logging should be performed based on configuration and operation options.
   *
   * @private
   * @param skipAudit - Whether the operation explicitly requests to skip audit logging
   * @returns True if audit logging should be performed, false otherwise
   */
  private shouldAudit(skipAudit?: boolean): boolean {
    const auditControl = this.options.auditControl || defaultOptions.auditControl!;

    // If audit logging is globally disabled, never audit
    if (!auditControl.enableAutoAudit) {
      return false;
    }

    // If the operation explicitly requests to skip audit, respect that
    if (skipAudit) {
      return false;
    }

    return true;
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
  async create(document: CreateDocument<T>, options: CreateOptions<TRefId> = {}): Promise<T & { _id: ObjectId }> {
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
   * @returns Promise resolving to update result information with __v when applicable
   * @throws Error if the operation fails
   *
   * @example
   * ```typescript
   * const result = await collection.update(
   *   { status: 'pending' },
   *   { $set: { status: 'active' } },
   *   { userContext: { userId: 'user123' } }
   * );
   *
   * // For version-aware operations, use the __v for subsequent updates
   * if (result.__v) {
   *   await collection.update(
   *     { _id: documentId, __v: result.__v },
   *     { $set: { processed: true } }
   *   );
   * }
   * ```
   */
  async update(
    filter: Filter<T>,
    update: UpdateFilter<T>,
    options: UpdateOptions<TRefId> = {}
  ): Promise<ExtendedUpdateResult> {
    return this.strategy.update(filter, update, options);
  }

  /**
   * Updates a single document by ID with automatic audit logging.
   *
   * @param id - The document ID to update
   * @param update - Update operations to apply
   * @param options - Options for the update operation
   * @returns Promise resolving to update result information with __v when applicable
   * @throws Error if the operation fails
   *
   * @example
   * ```typescript
   * const result = await collection.updateById(
   *   documentId,
   *   { $set: { name: 'Jane' } },
   *   { userContext: { userId: 'user123' } }
   * );
   *
   * // Use the __v for safe multi-phase operations
   * if (result.__v) {
   *   await collection.updateById(
   *     documentId,
   *     { $set: { status: 'processed' } },
   *     { userContext: { userId: 'user123' } }
   *   );
   * }
   * ```
   */
  async updateById(
    id: ObjectId,
    update: UpdateFilter<T>,
    options: UpdateOptions<TRefId> = {}
  ): Promise<ExtendedUpdateResult> {
    return this.strategy.updateById(id, update, options);
  }

  /**
   * Deletes multiple documents matching the filter (soft delete by default).
   *
   * @param filter - MongoDB filter criteria to select documents
   * @param options - Options for the delete operation
   * @returns Promise resolving to delete/update result information with __v for soft deletes
   * @throws Error if the operation fails
   *
   * @example
   * ```typescript
   * // Soft delete with __v tracking
   * const result = await collection.delete(
   *   { status: 'inactive' },
   *   { userContext: { userId: 'user123' } }
   * );
   *
   * // For single document soft deletes, use __v for subsequent operations
   * if (result.__v) {
   *   console.log(`Document soft deleted with version ${result.__v}`);
   * }
   *
   * // Hard delete (no version tracking)
   * const hardResult = await collection.delete(
   *   { status: 'inactive' },
   *   { hardDelete: true }
   * );
   * ```
   */
  async delete<THardDelete extends boolean = false>(
    filter: Filter<T>,
    options: DeleteOptions<THardDelete, TRefId> = {}
  ): Promise<ExtendedHardOrSoftDeleteResult<THardDelete>> {
    return this.strategy.delete(filter, options);
  }

  /**
   * Deletes a single document by ID (soft delete by default).
   *
   * @param id - The document ID to delete
   * @param options - Options for the delete operation
   * @returns Promise resolving to delete/update result information with __v for soft deletes
   * @throws Error if the operation fails
   *
   * @example
   * ```typescript
   * const result = await collection.deleteById(
   *   documentId,
   *   { userContext: { userId: 'user123' } }
   * );
   *
   * // For soft deletes, use the __v for subsequent operations
   * if (result.__v) {
   *   console.log(`Document soft deleted with version ${result.__v}`);
   *   // This document can now be safely restored using the known version
   * }
   * ```
   */
  async deleteById<THardDelete extends boolean = false>(
    id: ObjectId,
    options: DeleteOptions<THardDelete, TRefId> = {}
  ): Promise<ExtendedHardOrSoftDeleteResult<THardDelete>> {
    return this.strategy.deleteById(id, options);
  }

  /**
   * Restores soft-deleted documents by removing the deletedAt field.
   *
   * @param filter - MongoDB filter criteria to select documents to restore
   * @param userContext - Optional user context for audit trails
   * @returns Promise resolving to update result information with __v when applicable
   * @throws Error if the operation fails
   *
   * @example
   * ```typescript
   * const result = await collection.restore(
   *   { _id: documentId },
   *   { userId: 'user123' }
   * );
   *
   * // For single document restores, use the __v for subsequent operations
   * if (result.__v) {
   *   console.log(`Document restored with version ${result.__v}`);
   *   // Safe to perform additional updates with known version
   * }
   * ```
   */
  async restore(filter: Filter<T>, userContext?: UserContext<TRefId>): Promise<ExtendedUpdateResult> {
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
   * @returns The MongoDB collection instance for audit logs, or null if audit logging is disabled
   */
  getAuditCollection(): Collection<AuditLogDocument<TRefId>> | null {
    return this.auditLogger.getAuditCollection();
  }

  /**
   * Gets the audit logger instance used by this collection.
   *
   * @returns The audit logger instance
   */
  getAuditLogger(): AuditLogger<TRefId> {
    return this.auditLogger;
  }
}
