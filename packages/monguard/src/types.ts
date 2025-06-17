import { ObjectId } from 'mongodb';

export function toObjectId(id: ObjectId | string): ObjectId {
  return typeof id === 'string' ? new ObjectId(id) : id;
}

export interface MonguardConfig {
  transactionsEnabled: boolean;
  retryAttempts?: number;
  retryDelayMs?: number;
}

export interface BaseDocument {
  _id: ObjectId;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  version?: number;
}

export interface AuditableDocument extends BaseDocument {
  createdBy?: ObjectId;
  updatedBy?: ObjectId;
  deletedBy?: ObjectId;
}

export type AuditAction = "create" | "update" | "delete";

export interface AuditLogDocument extends BaseDocument {
  ref: {
    collection: string;
    id: ObjectId;
  };
  action: AuditAction;
  userId?: ObjectId;
  timestamp: Date;
  metadata?: {
    before?: any;
    after?: any;
    changes?: string[];
  };
}

export interface UserContext {
  userId: ObjectId | string;
}

export interface CreateOptions {
  skipAudit?: boolean;
  userContext?: UserContext;
}

export type CreateDocument<T extends BaseDocument> = Omit<T, '_id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'createdBy' | 'updatedBy' | 'deletedBy'>;

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

export interface FindOptions {
  includeSoftDeleted?: boolean;
  limit?: number;
  skip?: number;
  sort?: { [key: string]: 1 | -1 };
}

export interface WrapperResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface BulkWriteResult {
  insertedCount: number;
  matchedCount: number;
  modifiedCount: number;
  deletedCount: number;
  upsertedCount: number;
}