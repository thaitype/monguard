export interface MonguardConcurrencyConfig {
  transactionsEnabled: boolean;
  retryAttempts?: number;
  retryDelayMs?: number;
}

export interface BaseDocument {
  _id: any; // Can be string, ObjectId, or any other ID type
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  version?: number;
}

export interface AuditableDocument extends BaseDocument {
  createdBy?: any; // Can be string, ObjectId, or any other ID type
  updatedBy?: any;
  deletedBy?: any;
}

export type AuditAction = 'create' | 'update' | 'delete';

export interface AuditLogDocument extends BaseDocument {
  ref: {
    collection: string;
    id: any; // Can be string, ObjectId, or any other ID type
  };
  action: AuditAction;
  userId?: any; // Can be string, ObjectId, or any other ID type
  timestamp: Date;
  metadata?: {
    before?: any;
    after?: any;
    changes?: string[];
    softDelete?: boolean;
    hardDelete?: boolean;
  };
}

export interface UserContext {
  userId: any; // Can be string, ObjectId, or any other ID type - user's choice
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

export interface MonguardFindOptions {
  includeSoftDeleted?: boolean;
  limit?: number;
  skip?: number;
  sort?: { [key: string]: 1 | -1 };
}

export type Result<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface BulkWriteResult {
  insertedCount: number;
  matchedCount: number;
  modifiedCount: number;
  deletedCount: number;
  upsertedCount: number;
}
