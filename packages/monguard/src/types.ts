/**
 * @fileoverview Type definitions and interfaces for the Monguard package.
 */

import { DeleteResult, FindOptions as MongoFindOptions, UpdateResult } from './mongodb-types';

/**
 * Configuration interface for handling concurrency in Monguard operations.
 * Determines whether to use MongoDB transactions or optimistic locking strategy.
 */
export interface MonguardConcurrencyConfig {
  /** Whether transactions are enabled (true for MongoDB, false for Cosmos DB) */
  transactionsEnabled: boolean;
  /** Number of retry attempts for optimistic locking conflicts */
  retryAttempts?: number;
  /** Delay in milliseconds between retry attempts */
  retryDelayMs?: number;
}

/**
 * Generic reference ID type that can be string, ObjectId, or any other ID type.
 * The ID type should be consistent across the application for proper type safety.
 * @example
 * ```typescript
 * // Using ObjectId
 * type MyReferenceId = ObjectId;
 *
 * // Using string
 * type MyReferenceId = string;
 * ```
 */
export type ReferenceId = any;

/**
 * Default reference ID type used when no specific type is provided.
 * Uses ReferenceId to maintain backward compatibility.
 */
export type DefaultReferenceId = ReferenceId;

/**
 * Base document interface that all Monguard-managed documents should extend.
 * Provides standard timestamp fields and soft delete functionality.
 * @template TId - The type of the document's ID field
 */
export interface BaseDocument<TId = DefaultReferenceId> {
  /** Document unique identifier */
  _id: TId;
  /** Timestamp when the document was created */
  createdAt: Date;
  /** Timestamp when the document was last updated */
  updatedAt: Date;
  /** Timestamp when the document was soft deleted (undefined if not deleted) */
  deletedAt?: Date;
  /** Version number for optimistic locking (used when transactions are disabled) */
  __v?: number;
}

/**
 * Extends BaseDocument with audit trail fields to track which user performed each action.
 * @template TId - The type of the document's ID field and user ID field
 */
export interface AuditableDocument<TId = DefaultReferenceId> extends BaseDocument<TId> {
  /** ID of the user who created the document */
  createdBy?: TId;
  /** ID of the user who last updated the document */
  updatedBy?: TId;
  /** ID of the user who deleted the document */
  deletedBy?: TId;
}

/**
 * Enumeration of possible audit actions that can be logged.
 */
export type AuditAction = 'create' | 'update' | 'delete' | 'restore' | 'custom';

/**
 * Base interface for audit log documents that only includes essential audit-specific fields.
 * Unlike BaseDocument, this doesn't include redundant timestamp fields since audit logs are immutable.
 * @template TId - The type of the document's ID field and user ID field
 */
export interface AuditLogBase<TId = DefaultReferenceId> {
  /** Document unique identifier */
  _id: TId;
  /** Version number for potential audit log versioning (optional for future use) */
  __v?: number;
}

/**
 * Document structure for audit log entries that track all changes to documents.
 * Uses AuditLogBase instead of BaseDocument to avoid redundant timestamp fields.
 * @template TId - The type of the document's ID field and user ID field
 */
export interface AuditLogDocument<TId = DefaultReferenceId> extends AuditLogBase<TId> {
  /** Reference to the document that was modified */
  ref: {
    /** Name of the collection containing the modified document */
    collection: string;
    /** ID of the modified document */
    id: TId;
  };
  /** Type of action performed (create, update, delete) */
  action: AuditAction;
  /** ID of the user who performed the action */
  userId?: TId;
  /** Timestamp when the action occurred */
  timestamp: Date;
  /** Additional metadata about the change */
  metadata?: {
    /** Document state before the change */
    before?: any;
    /** Document state after the change */
    after?: any;
    /** List of field names that were changed */
    changes?: string[];
    /** Delta changes with field-level granularity */
    deltaChanges?: {
      [fieldPath: string]: {
        old: any;
        new: any;
        /** Present if this is a full subdoc/array replacement due to maxDepth or array size limit */
        fullDocument?: true;
      };
    };
    /** Storage mode used for this audit log */
    storageMode?: 'full' | 'delta';
    /** Whether this was a soft delete operation */
    softDelete?: boolean;
    /** Whether this was a hard delete operation */
    hardDelete?: boolean;
    /** Custom data for manual audit logs */
    customData?: Record<string, any>;
  };
}

/**
 * Context information about the user performing an operation.
 * Used for audit trails and user-based field updates.
 * @template TUserId - The type of the user ID
 */
export interface UserContext<TUserId = DefaultReferenceId> {
  /** ID of the user performing the operation */
  userId: TUserId;
}

/**
 * Options for document creation operations.
 * @template TUserId - The type of the user ID
 */
export interface CreateOptions<TUserId = DefaultReferenceId> {
  /** Whether to skip creating an audit log entry for this operation */
  skipAudit?: boolean;
  /** User context for audit trails and user-based fields */
  userContext?: UserContext<TUserId>;
  /** Per-operation audit control options (overrides collection-level settings) */
  auditControl?: Partial<AuditControlOptions>;
}

/**
 * Type utility that represents a document for creation by omitting system-managed fields.
 * These fields (_id, timestamps, user fields) are automatically added by Monguard.
 * @template T - The document type extending BaseDocument
 */
export type CreateDocument<T extends BaseDocument> = Omit<
  T,
  '_id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'createdBy' | 'updatedBy' | 'deletedBy'
>;

/**
 * Options for document update operations.
 * @template TUserId - The type of the user ID
 */
export interface UpdateOptions<TUserId = DefaultReferenceId> {
  /** Whether to skip creating an audit log entry for this operation */
  skipAudit?: boolean;
  /** User context for audit trails and user-based fields */
  userContext?: UserContext<TUserId>;
  /** Whether to create the document if it doesn't exist */
  upsert?: boolean;
  /** Per-operation audit control options (overrides collection-level settings) */
  auditControl?: Partial<AuditControlOptions>;
}

export type HardOrSoftDeleteResult<THardDelete extends boolean> = THardDelete extends true
  ? DeleteResult
  : UpdateResult;

/**
 * Options for document deletion operations.
 * @template THardDelete - Whether this is a hard delete operation
 * @template TUserId - The type of the user ID
 */
export interface DeleteOptions<THardDelete extends boolean, TUserId = DefaultReferenceId> {
  /** Whether to skip creating an audit log entry for this operation */
  skipAudit?: boolean;
  /** User context for audit trails and user-based fields */
  userContext?: UserContext<TUserId>;
  /** Whether to permanently delete the document (true) or soft delete (false) */
  hardDelete?: THardDelete;
  /** Per-operation audit control options (overrides collection-level settings) */
  auditControl?: Partial<AuditControlOptions>;
}

/**
 * Extends MongoDB FindOptions with Monguard-specific query options.
 * Allows for additional options like including soft-deleted documents.
 */
export interface FindOptions extends MongoFindOptions {
  /** Whether to include soft-deleted documents in query results */
  includeSoftDeleted?: boolean;
}

/**
 * Configuration options for controlling automatic field management.
 * @template TRefId - The type used for document reference IDs
 */
export interface AutoFieldControlOptions<TRefId = DefaultReferenceId> {
  /** Whether to automatically set timestamp fields (createdAt, updatedAt, deletedAt) */
  enableAutoTimestamps?: boolean;
  /** Whether to automatically set user tracking fields (createdBy, updatedBy, deletedBy) */
  enableAutoUserTracking?: boolean;
  /** Custom function to provide timestamps instead of using new Date() */
  customTimestampProvider?: () => Date;
}

/**
 * Configuration options for controlling audit logging behavior.
 */
export interface AuditControlOptions {
  /** Whether to automatically create audit logs for CRUD operations */
  enableAutoAudit?: boolean;
  /** Whether to create audit logs for custom operations */
  auditCustomOperations?: boolean;

  // Transaction-aware audit control options
  /** Audit logging mode - 'inTransaction' writes audit in same TX, 'outbox' queues for later processing */
  mode?: 'inTransaction' | 'outbox';
  /** Whether audit logging failures should cause transaction rollback (default: false) */
  failOnError?: boolean;
  /** Whether to log failed audit attempts for debugging (default: false) */
  logFailedAttempts?: boolean;
  /** Override storage mode for this specific operation */
  storageMode?: 'full' | 'delta';
}

/**
 * Options for manually updating auto-managed fields on documents.
 * @template TRefId - The type used for document reference IDs
 */
export interface AutoFieldUpdateOptions<TRefId = DefaultReferenceId> {
  /** The type of operation being performed */
  operation: 'create' | 'update' | 'delete' | 'restore' | 'custom';
  /** User context for populating user tracking fields */
  userContext?: UserContext<TRefId>;
  /** Custom timestamp to use instead of current date/time */
  customTimestamp?: Date;
  /** Specific fields to update (if not provided, updates based on operation type) */
  fields?: Partial<{
    createdAt: boolean;
    updatedAt: boolean;
    deletedAt: boolean;
    createdBy: boolean;
    updatedBy: boolean;
    deletedBy: boolean;
  }>;
}

/**
 * Options for manually creating audit log entries.
 * @template TRefId - The type used for document reference IDs
 */
export interface ManualAuditOptions<TRefId = DefaultReferenceId> {
  /** Document state before the operation */
  beforeDocument?: any;
  /** Document state after the operation */
  afterDocument?: any;
  /** Custom data to include in the audit log */
  customData?: Record<string, any>;
  /** Whether to skip updating auto-managed fields in the audit log document */
  skipAutoFields?: boolean;
}

/**
 * Entry for batch audit log creation.
 * @template TRefId - The type used for document reference IDs
 */
export interface BatchAuditEntry<TRefId = DefaultReferenceId> {
  /** The action that was performed */
  action: AuditAction;
  /** ID of the document that was affected */
  documentId: TRefId;
  /** User context for the operation */
  userContext?: UserContext<TRefId>;
  /** Additional metadata for the audit log */
  metadata?: ManualAuditOptions<TRefId>;
}

/**
 * Extended UpdateResult that includes the new version number for version-aware operations.
 * This enables safe multi-phase workflows by providing the updated version without requiring additional queries.
 */
export interface ExtendedUpdateResult extends UpdateResult {
  /** The new version number after the update operation, only present when document was modified and version was incremented */
  __v?: number;
}

/**
 * Extended DeleteResult that includes the new version number for soft delete operations.
 * This enables safe multi-phase workflows by providing the updated version without requiring additional queries.
 */
export interface ExtendedDeleteResult extends UpdateResult {
  /** The new version number after the soft delete operation, only present when document was modified and version was incremented */
  __v?: number;
}

/**
 * Conditional type that determines the result type based on whether it's a hard delete or soft delete operation.
 * For hard deletes, returns standard DeleteResult. For soft deletes, returns ExtendedDeleteResult with __v.
 */
export type ExtendedHardOrSoftDeleteResult<THardDelete extends boolean> = THardDelete extends true
  ? DeleteResult
  : ExtendedDeleteResult;
