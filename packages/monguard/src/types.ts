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
 * Base document interface that all Monguard-managed documents should extend.
 * Provides standard timestamp fields and soft delete functionality.
 * @template TId - The type of the document's ID field
 */
export interface BaseDocument<TId = ReferenceId> {
  /** Document unique identifier */
  _id: TId;
  /** Timestamp when the document was created */
  createdAt: Date;
  /** Timestamp when the document was last updated */
  updatedAt: Date;
  /** Timestamp when the document was soft deleted (undefined if not deleted) */
  deletedAt?: Date;
  /** Version number for optimistic locking (used when transactions are disabled) */
  version?: number;
}

/**
 * Extends BaseDocument with audit trail fields to track which user performed each action.
 * @template TId - The type of the document's ID field and user ID field
 */
export interface AuditableDocument<TId = ReferenceId> extends BaseDocument<TId> {
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
export type AuditAction = 'create' | 'update' | 'delete';

/**
 * Document structure for audit log entries that track all changes to documents.
 * @template TId - The type of the document's ID field and user ID field
 */
export interface AuditLogDocument<TId = ReferenceId> extends BaseDocument<TId> {
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
    /** Whether this was a soft delete operation */
    softDelete?: boolean;
    /** Whether this was a hard delete operation */
    hardDelete?: boolean;
  };
}

/**
 * Context information about the user performing an operation.
 * Used for audit trails and user-based field updates.
 * @template TUserId - The type of the user ID
 */
export interface UserContext<TUserId = ReferenceId> {
  /** ID of the user performing the operation */
  userId: TUserId;
}

/**
 * Options for document creation operations.
 */
export interface CreateOptions {
  /** Whether to skip creating an audit log entry for this operation */
  skipAudit?: boolean;
  /** User context for audit trails and user-based fields */
  userContext?: UserContext;
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
 */
export interface UpdateOptions {
  /** Whether to skip creating an audit log entry for this operation */
  skipAudit?: boolean;
  /** User context for audit trails and user-based fields */
  userContext?: UserContext;
  /** Whether to create the document if it doesn't exist */
  upsert?: boolean;
}

export type HardOrSoftDeleteResult<THardDelete extends boolean> = THardDelete extends true
  ? DeleteResult
  : UpdateResult;

/**
 * Options for document deletion operations.
 */
export interface DeleteOptions<THardDelete extends boolean> {
  /** Whether to skip creating an audit log entry for this operation */
  skipAudit?: boolean;
  /** User context for audit trails and user-based fields */
  userContext?: UserContext;
  /** Whether to permanently delete the document (true) or soft delete (false) */
  hardDelete?: THardDelete;
}

/**
 * Extends MongoDB FindOptions with Monguard-specific query options.
 * Allows for additional options like including soft-deleted documents.
 */
export interface FindOptions extends MongoFindOptions {
  /** Whether to include soft-deleted documents in query results */
  includeSoftDeleted?: boolean;
}
