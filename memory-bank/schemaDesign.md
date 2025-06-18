# Schema Design

```ts
import { ObjectId } from 'mongodb';

export interface BaseDocument {
  _id: ObjectId;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

export interface AuditableDocument extends BaseDocument {
  createdBy?: ObjectId;
  updatedBy?: ObjectId;
  deletedBy?: ObjectId;
}

export type AuditAction = "create" | "update" | "delete";


// Somehow user context should be ObjectId or string for compatibility with external systems
export interface UserContext {
  userId: ObjectId;
}


// ===========================
// 📜 audit_logs
// ===========================

/**
 * Captures system actions for traceability.
 */
export interface AuditLogDocument extends BaseDocument {
  ref: {
    collection: CollectionName;
    id: ObjectId;
  };
  action: AuditAction;
  userId: ObjectId;
  timestamp: Date;
  metadata?: {
    before?: any;
    after?: any;
    changes?: string[];
  };
}
