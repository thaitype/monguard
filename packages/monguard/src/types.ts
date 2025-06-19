import { FindOptions as MongoFindOptions } from "./mongodb-types";

export interface MonguardConcurrencyConfig {
  transactionsEnabled: boolean;
  retryAttempts?: number;
  retryDelayMs?: number;
}

/**
 * Can be string, ObjectId, or any other ID type
 * Id should be same type across the application.
 */
export type ReferenceId = any;

export interface BaseDocument<TId = ReferenceId> {
  _id: TId;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  version?: number;
}

export interface AuditableDocument<TId = ReferenceId> extends BaseDocument<TId> {
  createdBy?: TId;
  updatedBy?: TId;
  deletedBy?: TId;
}

export type AuditAction = 'create' | 'update' | 'delete';

export interface AuditLogDocument<TId = ReferenceId> extends BaseDocument<TId> {
  ref: {
    collection: string;
    id: TId;
  };
  action: AuditAction;
  userId?: TId;
  timestamp: Date;
  metadata?: {
    before?: any;
    after?: any;
    changes?: string[];
    softDelete?: boolean;
    hardDelete?: boolean;
  };
}

export interface UserContext<TUserId = ReferenceId> {
  userId: TUserId;
}

export interface CreateOptions {
  skipAudit?: boolean;
  userContext?: UserContext;
}

export type CreateDocument<T extends BaseDocument> = Omit<
  T,
  '_id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'createdBy' | 'updatedBy' | 'deletedBy'
>;

export interface UpdateOptions {
  skipAudit?: boolean;
  userContext?: UserContext;
  upsert?: boolean;
}

export interface DeleteOptions {
  skipAudit?: boolean;
  userContext?: UserContext;
  hardDelete?: boolean;
}

/**
 * Extends MongoDB FindOptions
 * Allows for additional options like including soft-deleted documents.
 */
export interface FindOptions extends MongoFindOptions {
  // Include soft-deleted documents in queries
  includeSoftDeleted?: boolean;
}

/**
 * Result type for operations
 * Represents either a successful operation with data or an error.
 * @template T - The type of data returned on success.
 */
export type Result<T> =
  | { success: true; data: T }
  | { success: false; error: string };