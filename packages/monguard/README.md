# 🛡️ monguard – The Guardian of Your MongoDB Records

[![CI](https://github.com/thaitype/monguard/actions/workflows/main.yml/badge.svg)](https://github.com/thaitype/monguard/actions/workflows/main.yml) [![codecov](https://codecov.io/gh/thaitype/monguard/graph/badge.svg?token=B7MCHM57BH)](https://codecov.io/gh/thaitype/monguard) [![NPM Version](https://img.shields.io/npm/v/monguard) ](https://www.npmjs.com/package/monguard)[![npm downloads](https://img.shields.io/npm/dt/monguard)](https://www.npmjs.com/package/monguard) 

> Note: This is early stage of development, the API is subject to change. Please report any issues or suggestions. 
> Don't use in production yet.

**`monguard`** is a lightweight, zero-boilerplate toolkit designed to enhance MongoDB models with production-ready features:

* 🗑️ **Soft Delete** — Mark records as deleted without removing them from the database
* ⏱️ **Auto Timestamps** — Automatically manage `createdAt` and `updatedAt` fields
* 🕵️ **Audit Logging** — Track every `create`, `update`, and `delete` action with detailed metadata
* 🧠 **TypeScript First** — Fully typed for safety and great DX
* ⚙️ **Plug-and-Play** — Minimal setup, maximum control

### ✨ Why `monguard`?

In real-world apps, deleting data is rarely the end of the story. Whether it's rollback, audit compliance, or just better traceability — `monguard` has your back.

With just a single call, you can guard your collections against accidental data loss while keeping every change accountable.

### 📦 Installation

```bash
npm install monguard
```

### 🔐 Use-case Highlights

* CRM systems with user-deletable data
* E-commerce with order history tracking
* Admin dashboards needing full audit trail
* Any app where “delete” doesn’t really mean delete 😉

> Guard your data. Track the truth. Sleep better.
> — with **`monguard`** 🛡️

# Monguard User Manual

Monguard is an audit-safe MongoDB wrapper that provides automatic audit logging, soft deletes, user tracking, and concurrent operation handling with zero runtime MongoDB dependencies in your application code.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Features](#core-features)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Concurrency Strategies](#concurrency-strategies)
- [Audit Logging](#audit-logging)
- [Soft Deletes](#soft-deletes)
- [User Tracking](#user-tracking)
- [Manual Auto-Field Control](#manual-auto-field-control)
- [Manual Audit Logging](#manual-audit-logging)
- [Best Practices](#best-practices)
- [Examples](#examples)
- [Troubleshooting](#troubleshooting)

## Installation

```bash
npm install monguard
# or
yarn add monguard
# or
pnpm add monguard
```

**Important**: You must install a MongoDB driver separately, as Monguard has zero runtime dependencies:

```bash
npm install mongodb
# or any MongoDB-compatible driver
```

## Quick Start

```typescript
import { MongoClient } from 'mongodb';
import { MonguardCollection } from 'monguard';

// Define your document interface
interface User {
  _id?: any;
  name: string;
  email: string;
  age?: number;
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date;
  createdBy?: ObjectId;
  updatedBy?: ObjectId;
  deletedBy?: ObjectId;
}

// Connect to MongoDB
const client = new MongoClient('mongodb://localhost:27017');
await client.connect();
const db = client.db('myapp');

// Create a Monguard collection
const users = new MonguardCollection<User>(db, 'users', {
  concurrency: { transactionsEnabled: true }
});

// Create a user with audit logging
try {
  const user = await users.create({
    name: 'John Doe',
    email: 'john@example.com'
  }, {
    userContext: { userId: 'admin-123' }
  });
  
  console.log('User created:', user);
} catch (error) {
  console.error('Failed to create user:', error.message);
}
```

## Core Features

### 🔍 **Audit Logging**
- Automatic tracking of all create, update, and delete operations
- Customizable audit collection names and logger interfaces
- Rich metadata including before/after states and field changes
- Reference ID validation with configurable error handling
- Support for custom logging services (Winston, Pino, etc.)

### 🗑️ **Soft Deletes**
- Safe deletion that preserves data integrity
- Option for hard deletes when needed
- Automatic filtering of soft-deleted documents

### 👤 **User Tracking**
- Track who created, updated, or deleted each document
- Flexible user ID types (string, ObjectId, custom objects)
- Automatic timestamp management

### ⚡ **Concurrency Control**
- Transaction-based strategy for MongoDB replica sets
- Optimistic locking strategy for standalone/Cosmos DB
- Automatic fallback handling

### 🎯 **Type Safety**
- Full TypeScript support with strict typing
- MongoDB-compatible type definitions
- Zero runtime dependencies on MongoDB driver

## Configuration

### MonguardCollectionOptions

```typescript
interface MonguardCollectionOptions {
  // Optional: Custom audit logger instance
  auditLogger?: AuditLogger;

  // Required: Concurrency configuration
  concurrency: MonguardConcurrencyConfig;

  // Optional: Auto-field control configuration
  autoFieldControl?: AutoFieldControlOptions;

  // Optional: Audit control configuration
  auditControl?: AuditControlOptions;
}

interface MonguardConcurrencyConfig {
  transactionsEnabled: boolean;
  retryAttempts?: number; // Default: 3 (optimistic strategy only)
  retryDelayMs?: number;  // Default: 100ms (optimistic strategy only)
}

interface AutoFieldControlOptions {
  enableAutoTimestamps?: boolean;        // Default: true
  enableAutoUserTracking?: boolean;      // Default: true
  customTimestampProvider?: () => Date;  // Default: () => new Date()
}

interface AuditControlOptions {
  enableAutoAudit?: boolean;        // Default: true
  auditCustomOperations?: boolean;  // Default: false
}
```

### Configuration Examples

#### MongoDB Replica Set/Atlas
```typescript
const collection = new MonguardCollection<User>(db, 'users', {
  concurrency: { transactionsEnabled: true }
});
```

#### MongoDB Standalone/Cosmos DB
```typescript
const collection = new MonguardCollection<User>(db, 'users', {
  concurrency: { 
    transactionsEnabled: false,
    retryAttempts: 5,
    retryDelayMs: 200
  }
});
```

#### With Manual Control Options
```typescript
const collection = new MonguardCollection<User>(db, 'users', {
  concurrency: { transactionsEnabled: true },
  autoFieldControl: {
    enableAutoTimestamps: true,
    enableAutoUserTracking: true,
    customTimestampProvider: () => new Date()
  },
  auditControl: {
    enableAutoAudit: true,
    auditCustomOperations: true
  }
});
```

#### External System Integration Setup
```typescript
// Configuration for external system integration
const collection = new MonguardCollection<User>(db, 'users', {
  concurrency: { transactionsEnabled: true },
  autoFieldControl: {
    enableAutoTimestamps: false,  // Manual control over timestamps
    enableAutoUserTracking: true
  },
  auditControl: {
    enableAutoAudit: false,       // Manual audit logging only
    auditCustomOperations: true
  }
});
```

#### Migration-Friendly Configuration
```typescript
// Configuration for data migration scenarios
const collection = new MonguardCollection<User>(db, 'users', {
  concurrency: { transactionsEnabled: true },
  autoFieldControl: {
    enableAutoTimestamps: false,  // Preserve original timestamps
    enableAutoUserTracking: false // Preserve original user fields
  },
  auditControl: {
    enableAutoAudit: false,       // Create custom audit logs
    auditCustomOperations: true
  }
});
```

## API Reference

### Creating Documents

```typescript
async create(
  document: CreateDocument<T>,
  options?: CreateOptions
): Promise<T & { _id: ObjectId }>

interface CreateOptions {
  skipAudit?: boolean;
  userContext?: UserContext;
}

interface UserContext {
  userId: any; // Flexible type - string, ObjectId, custom object
}
```

### Reading Documents

```typescript
// Find by ID
async findById(
  id: ObjectId,
  options?: FindOptions
): Promise<T | null>

// Find multiple documents
async find(
  filter?: Filter<T>,
  options?: FindOptions
): Promise<T[]>

// Find one document
async findOne(
  filter: Filter<T>,
  options?: FindOptions
): Promise<T | null>

// Count documents
async count(
  filter?: Filter<T>,
  includeSoftDeleted?: boolean
): Promise<number>

interface FindOptions {
  includeSoftDeleted?: boolean;
  limit?: number;
  skip?: number;
  sort?: { [key: string]: 1 | -1 };
}
```

### Updating Documents

```typescript
// Update by filter
async update(
  filter: Filter<T>,
  update: UpdateFilter<T>,
  options?: UpdateOptions
): Promise<UpdateResult>

// Update by ID
async updateById(
  id: ObjectId,
  update: UpdateFilter<T>,
  options?: UpdateOptions
): Promise<UpdateResult>

interface UpdateOptions {
  skipAudit?: boolean;
  userContext?: UserContext;
  upsert?: boolean;
}
```

### Deleting Documents

```typescript
// Delete by filter
async delete(
  filter: Filter<T>,
  options?: DeleteOptions
): Promise<UpdateResult | DeleteResult>

// Delete by ID
async deleteById(
  id: ObjectId,
  options?: DeleteOptions
): Promise<UpdateResult | DeleteResult>

interface DeleteOptions {
  skipAudit?: boolean;
  userContext?: UserContext;
  hardDelete?: boolean; // Default: false (soft delete)
}
```

### Restoring Soft-Deleted Documents

```typescript
async restore(
  filter: Filter<T>,
  userContext?: UserContext
): Promise<UpdateResult>
```

### Manual Auto-Field Control

```typescript
// Comprehensive auto-field update
updateAutoFields<D extends Record<string, any>>(
  document: D,
  options: AutoFieldUpdateOptions
): D

interface AutoFieldUpdateOptions {
  operation: 'create' | 'update' | 'delete' | 'restore' | 'custom';
  userContext?: UserContext;
  customTimestamp?: Date;
  fields?: Partial<{
    createdAt: boolean;
    updatedAt: boolean;
    deletedAt: boolean;
    createdBy: boolean;
    updatedBy: boolean;
    deletedBy: boolean;
  }>;
}

// Individual field setters
setCreatedFields(
  document: any,
  userContext?: UserContext,
  timestamp?: Date
): void

setUpdatedFields(
  document: any,
  userContext?: UserContext,
  timestamp?: Date
): void

setDeletedFields(
  document: any,
  userContext?: UserContext,
  timestamp?: Date
): void

clearDeletedFields(
  document: any,
  userContext?: UserContext,
  timestamp?: Date
): void
```

### Manual Audit Logging

```typescript
// Create single audit log entry
async createAuditLog(
  action: AuditAction,
  documentId: ObjectId,
  userContext?: UserContext,
  metadata?: ManualAuditOptions
): Promise<void>

// Create multiple audit log entries
async createAuditLogs(
  entries: BatchAuditEntry[]
): Promise<void>

interface ManualAuditOptions {
  beforeDocument?: any;
  afterDocument?: any;
  customData?: Record<string, any>;
  skipAutoFields?: boolean;
}

interface BatchAuditEntry {
  action: AuditAction;
  documentId: any;
  userContext?: UserContext;
  metadata?: ManualAuditOptions;
}

type AuditAction = 'create' | 'update' | 'delete' | 'restore' | 'custom';
```

### Error Handling

All operations return data directly and throw exceptions on error:

```typescript
// Usage with try-catch
try {
  const user = await collection.create(userData);
  console.log('Created:', user);
} catch (error) {
  console.error('Error:', error.message);
}

// Or with async/await and .catch()
const user = await collection.create(userData)
  .catch(error => {
    console.error('Error:', error.message);
    throw error; // re-throw if needed
  });
```

## Concurrency Strategies

Monguard automatically selects the appropriate concurrency strategy based on your configuration.

### Transaction Strategy

Used when `transactionsEnabled: true`. Provides ACID guarantees.

**Best for:**
- MongoDB replica sets
- MongoDB Atlas
- Applications requiring strict consistency

**Features:**
- Atomic operations with automatic rollback
- Consistent audit logging
- No version fields required

**Automatic Fallback:**
If transactions fail (e.g., standalone MongoDB), automatically falls back to optimistic strategy behavior.

### Optimistic Locking Strategy

Used when `transactionsEnabled: false`. Uses document versioning for conflict detection.

**Best for:**
- MongoDB standalone instances
- Azure Cosmos DB
- High-throughput scenarios

**Features:**
- Document version tracking
- Retry logic with exponential backoff
- Conflict detection and resolution

## Audit Logging

### Audit Log Structure

```typescript
interface AuditLogDocument {
  _id: any;
  ref: {
    collection: string;
    id: any; // ID of the affected document
  };
  action: 'create' | 'update' | 'delete';
  userId?: any; // User who performed the action
  timestamp: Date;
  createdAt: Date;
  updatedAt: Date;
  metadata?: {
    before?: any;      // Document state before change (update/delete)
    after?: any;       // Document state after change (create/update)
    changes?: string[]; // Changed field names (update)
    softDelete?: boolean;
    hardDelete?: boolean;
  };
}
```

### Custom Audit Logger Configuration

Monguard supports advanced audit logger configuration for custom logging and reference ID validation:

```typescript
import { MonguardAuditLogger, RefIdConfigs } from 'monguard';

// Custom logger interface
interface Logger {
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}

// Custom logger implementation
const customLogger: Logger = {
  warn: (message, ...args) => {
    // Send to your logging service
    myLoggingService.warn(message, ...args);
  },
  error: (message, ...args) => {
    // Send to your error tracking service
    myErrorTracker.error(message, ...args);
  }
};

// Create audit logger with custom configuration
const auditLogger = new MonguardAuditLogger(db, 'audit_logs', {
  refIdConfig: RefIdConfigs.objectId(), // Validate ObjectId types
  logger: customLogger,                  // Use custom logger
  strictValidation: true                 // Throw errors on validation failures
});

// Use with MonguardCollection
const users = new MonguardCollection<User>(db, 'users', {
  auditLogger: auditLogger,
  concurrency: { transactionsEnabled: true }
});
```

### Reference ID Validation

Ensure consistent reference ID types in audit logs:

```typescript
// Pre-configured reference ID validators
const configs = {
  objectId: RefIdConfigs.objectId(),  // MongoDB ObjectId validation
  string: RefIdConfigs.string(),      // String ID validation  
  number: RefIdConfigs.number()       // Numeric ID validation
};

// Custom reference ID configuration
const customRefIdConfig = {
  validateRefId: (refId: any): refId is string => {
    return typeof refId === 'string' && refId.length > 0;
  },
  typeName: 'non-empty-string',
  convertRefId: (documentId: any) => documentId.toString()
};

const auditLogger = new MonguardAuditLogger(db, 'audit_logs', {
  refIdConfig: customRefIdConfig,
  strictValidation: false,  // Warn instead of throwing
  logger: customLogger
});
```

### Strict Validation Modes

Control how reference ID validation failures are handled:

```typescript
// Strict mode: Throw errors on validation failures
const strictLogger = new MonguardAuditLogger(db, 'audit_logs', {
  refIdConfig: RefIdConfigs.objectId(),
  strictValidation: true,  // Throws errors
  logger: customLogger
});

// Lenient mode: Warn on validation failures but continue
const lenientLogger = new MonguardAuditLogger(db, 'audit_logs', {
  refIdConfig: RefIdConfigs.objectId(), 
  strictValidation: false, // Logs warnings (default)
  logger: customLogger
});

try {
  // This will throw an error in strict mode if ID is wrong type
  await strictLogger.logOperation('create', 'users', 'invalid-objectid');
} catch (error) {
  console.error('Validation failed:', error.message);
  // Error: Invalid reference ID type for audit log. Expected ObjectId, got: string
}
```

### Disable audit logging

By default, will not log any audit logs

```typescript
const users = new MonguardCollection<User>(db, 'users', {
  concurrency: { transactionsEnabled: true }
});

// All operations will skip audit logging
await users.create(userData); // No audit log created
```

### Querying Audit Logs

```typescript
// Get audit collection
const auditCollection = users.getAuditCollection();

// Find all audit logs for a specific document
const documentAudits = await auditCollection.find({
  'ref.collection': 'users',
  'ref.id': userId
}).toArray();

// Find all actions by a specific user
const userActions = await auditCollection.find({
  userId: 'admin-123'
}).toArray();

// Find recent changes
const recentChanges = await auditCollection.find({
  timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
}).sort({ timestamp: -1 }).toArray();
```

### Skip audit for specific operation

```typescript
try {
  const user = await collection.create(userData, {
    skipAudit: true,
    userContext: { userId: 'admin' }
  });
} catch (error) {
  console.error('Create failed:', error.message);
}
```

## Soft Deletes

### How Soft Deletes Work

Soft deletes add a `deletedAt` timestamp instead of removing documents:

```typescript
// Soft delete (default)
await users.deleteById(userId, {
  userContext: { userId: 'admin' }
});

// Document now has deletedAt field
// { _id: ..., name: 'John', deletedAt: Date, deletedBy: 'admin' }
```

### Finding Soft-Deleted Documents

```typescript
// Normal queries exclude soft-deleted documents
const activeUsers = await users.find({}); // Only active users

// Include soft-deleted documents explicitly
const allUsers = await users.find({}, { 
  includeSoftDeleted: true 
});

// Find only soft-deleted documents
const deletedUsers = await users.find({
  deletedAt: { $exists: true }
}, { 
  includeSoftDeleted: true 
});
```

### Restoring Soft-Deleted Documents

```typescript
// Restore by ID
try {
  const result = await users.restore(
    { _id: userId },
    { userId: 'admin' }
  );
  console.log(`Restored ${result.modifiedCount} documents`);
} catch (error) {
  console.error('Restore failed:', error.message);
}

// Restore multiple documents
try {
  const result = await users.restore(
    { deletedBy: 'old-admin' },
    { userId: 'current-admin' }
  );
  console.log(`Restored ${result.modifiedCount} documents`);
} catch (error) {
  console.error('Restore failed:', error.message);
}
```

### Hard Deletes

```typescript
// Permanently delete document
try {
  const result = await users.deleteById(userId, {
    userContext: { userId: 'admin' },
    hardDelete: true
  });
  console.log(`Deleted ${result.deletedCount} documents permanently`);
  // Document is completely removed from database
} catch (error) {
  console.error('Hard delete failed:', error.message);
}
```

## User Tracking

### Automatic User Tracking

When documents extend `AuditableDocument`, Monguard automatically tracks user information:

```typescript
interface User extends AuditableDocument {
  name: string;
  email: string;
  // Inherited from AuditableDocument:
  // createdBy?: any;
  // updatedBy?: any;
  // deletedBy?: any;
}

// Create with user tracking
try {
  const user = await users.create({
    name: 'John Doe',
    email: 'john@example.com'
  }, {
    userContext: { userId: 'admin-123' }
  });

  // User includes user tracking:
  // {
  //   name: 'John Doe',
  //   email: 'john@example.com',
  //   createdBy: 'admin-123',
  //   updatedBy: 'admin-123',
  //   createdAt: Date,
  //   updatedAt: Date
  // }
} catch (error) {
  console.error('Create failed:', error.message);
}
```

### User Context Types

```typescript
// String user IDs
const userContext = { userId: 'admin-123' };

// ObjectId user IDs
import { ObjectId } from 'mongodb';
const userContext = { userId: new ObjectId() };

// Custom user objects
const userContext = { 
  userId: { 
    type: 'service',
    name: 'auth-service',
    version: '1.0.0'
  }
};
```

## Manual Auto-Field Control

Monguard provides methods that allow external applications to manually control when and how auto-managed fields (timestamps and user tracking) are populated. This is useful for data migration, bulk imports, or when you need precise control over field values.

### Manual Auto-Field Updates

The `updateAutoFields()` method provides comprehensive control over auto-field population:

```typescript
// Manual creation fields
const doc = { name: 'John', email: 'john@example.com' };
const result = collection.updateAutoFields(doc, {
  operation: 'create',
  userContext: { userId: 'user123' }
});
// Result includes: createdAt, updatedAt, createdBy, updatedBy

// Manual update fields
const existingDoc = { name: 'John Updated', createdAt: new Date('2023-01-01') };
const result = collection.updateAutoFields(existingDoc, {
  operation: 'update',
  userContext: { userId: 'user456' }
});
// Result includes: updatedAt, updatedBy (preserves createdAt, createdBy)

// Manual delete fields (soft delete)
const result = collection.updateAutoFields(doc, {
  operation: 'delete',
  userContext: { userId: 'admin789' }
});
// Result includes: deletedAt, deletedBy, updatedAt, updatedBy

// Manual restore fields
const result = collection.updateAutoFields(deletedDoc, {
  operation: 'restore',
  userContext: { userId: 'admin456' }
});
// Result removes: deletedAt, deletedBy and updates: updatedAt, updatedBy

// Custom field control
const result = collection.updateAutoFields(doc, {
  operation: 'custom',
  userContext: { userId: 'user123' },
  fields: {
    createdAt: true,
    createdBy: true,
    updatedAt: false,  // Won't be set
    updatedBy: false   // Won't be set
  }
});
```

### Custom Timestamps

```typescript
// Use custom timestamp instead of current time
const customTime = new Date('2023-12-25T10:00:00Z');
const result = collection.updateAutoFields(doc, {
  operation: 'create',
  customTimestamp: customTime,
  userContext: { userId: 'user123' }
});
// All timestamp fields will use customTime
```

### Individual Field Setters

For granular control, use individual field setter methods:

```typescript
// Set creation fields
collection.setCreatedFields(doc, { userId: 'user123' });
// Sets: createdAt, createdBy

// Set update fields
collection.setUpdatedFields(doc, { userId: 'user456' });
// Sets: updatedAt, updatedBy

// Set deletion fields (soft delete)
collection.setDeletedFields(doc, { userId: 'admin789' });
// Sets: deletedAt, deletedBy, updatedAt, updatedBy

// Clear deletion fields (restore)
collection.clearDeletedFields(doc, { userId: 'admin456' });
// Removes: deletedAt, deletedBy and sets: updatedAt, updatedBy

// With custom timestamp
const customTime = new Date('2023-01-01');
collection.setCreatedFields(doc, { userId: 'user123' }, customTime);
```

### Auto-Field Configuration

Control auto-field behavior through configuration:

```typescript
const collection = new MonguardCollection<User>(db, 'users', {
  concurrency: { transactionsEnabled: true },
  autoFieldControl: {
    enableAutoTimestamps: true,      // Enable automatic timestamps
    enableAutoUserTracking: true,    // Enable automatic user tracking
    customTimestampProvider: () => new Date('2023-01-01') // Custom timestamp function
  }
});

// Disable automatic timestamps
const collectionNoTimestamps = new MonguardCollection<User>(db, 'users', {
  concurrency: { transactionsEnabled: true },
  autoFieldControl: {
    enableAutoTimestamps: false,     // Disable timestamps
    enableAutoUserTracking: true     // Keep user tracking
  }
});

// Disable automatic user tracking
const collectionNoUserTracking = new MonguardCollection<User>(db, 'users', {
  concurrency: { transactionsEnabled: true },
  autoFieldControl: {
    enableAutoTimestamps: true,      // Keep timestamps
    enableAutoUserTracking: false    // Disable user tracking
  }
});
```

### Practical Use Cases

**Data Migration:**
```typescript
// Migrate data with preserved timestamps
const migratedDoc = { 
  name: 'Legacy User', 
  email: 'legacy@example.com' 
};

const result = collection.updateAutoFields(migratedDoc, {
  operation: 'create',
  customTimestamp: new Date('2020-01-01'),  // Preserve original date
  userContext: { userId: 'migration-script' }
});
```

**Bulk Import:**
```typescript
async function bulkImport(records: any[], importerId: string) {
  const importTime = new Date();
  
  for (const record of records) {
    const processedRecord = collection.updateAutoFields(record, {
      operation: 'create',
      customTimestamp: importTime,
      userContext: { userId: importerId }
    });
    
    // Now save the processed record to database
    await collection.create(processedRecord, { skipAudit: true });
  }
}
```

**External System Integration:**
```typescript
// When receiving data from external system
function processExternalUpdate(externalData: any, systemUserId: string) {
  const updatedDoc = collection.updateAutoFields(externalData, {
    operation: 'update',
    userContext: { userId: systemUserId },
    fields: {
      updatedAt: true,
      updatedBy: true,
      createdAt: false,  // Don't modify creation fields
      createdBy: false
    }
  });
  
  return updatedDoc;
}
```

## Manual Audit Logging

Monguard provides methods for external applications to manually create audit log entries, giving you complete control over audit trail creation for custom operations or external integrations.

### Manual Single Audit Log

The `createAuditLog()` method creates individual audit log entries:

```typescript
import { ObjectId } from 'mongodb';

// Create custom audit log entry
await collection.createAuditLog(
  'custom',                                    // Action type
  new ObjectId('60f1e2b3c4d5e6f7a8b9c0d1'), // Document ID
  { userId: 'user123' },                      // User context
  {
    beforeDocument: { name: 'Old Name', status: 'pending' },
    afterDocument: { name: 'New Name', status: 'approved' },
    customData: { 
      reason: 'bulk_approval',
      batchId: 'batch-001',
      externalSystemId: 'ext-12345'
    }
  }
);

// Create audit log for manual restore operation
await collection.createAuditLog(
  'restore',
  documentId,
  { userId: 'admin456' },
  {
    beforeDocument: { name: 'John', deletedAt: new Date(), deletedBy: 'old-admin' },
    afterDocument: { name: 'John', deletedAt: undefined, deletedBy: undefined },
    customData: { reason: 'data_recovery', ticket: 'SUPPORT-123' }
  }
);

// Simple audit log without metadata
await collection.createAuditLog('create', documentId, { userId: 'system' });
```

### Manual Batch Audit Logs

The `createAuditLogs()` method efficiently creates multiple audit entries:

```typescript
// Batch audit log creation
await collection.createAuditLogs([
  {
    action: 'create',
    documentId: doc1Id,
    userContext: { userId: 'importer' },
    metadata: {
      afterDocument: { name: 'User 1', email: 'user1@example.com' },
      customData: { source: 'csv_import', line: 1 }
    }
  },
  {
    action: 'create',
    documentId: doc2Id,
    userContext: { userId: 'importer' },
    metadata: {
      afterDocument: { name: 'User 2', email: 'user2@example.com' },
      customData: { source: 'csv_import', line: 2 }
    }
  },
  {
    action: 'update',
    documentId: doc3Id,
    userContext: { userId: 'admin' },
    metadata: {
      beforeDocument: { status: 'pending' },
      afterDocument: { status: 'approved' },
      customData: { approvalLevel: 'manager' }
    }
  }
]);
```

### Audit Control Configuration

Control audit logging behavior through configuration:

```typescript
const collection = new MonguardCollection<User>(db, 'users', {
  concurrency: { transactionsEnabled: true },
  auditControl: {
    enableAutoAudit: true,        // Enable automatic audit logs for CRUD operations
    auditCustomOperations: true   // Enable audit logs for custom operations
  }
});

// Disable automatic audit logging
const collectionNoAutoAudit = new MonguardCollection<User>(db, 'users', {
  concurrency: { transactionsEnabled: true },
  auditControl: {
    enableAutoAudit: false,       // Disable automatic audit logs
    auditCustomOperations: true   // Still allow manual custom audit logs
  }
});

// Disable all audit logging
const collectionNoAudit = new MonguardCollection<User>(db, 'users', {
  concurrency: { transactionsEnabled: true },
  auditControl: {
    enableAutoAudit: false,       // No automatic audit logs
    auditCustomOperations: false  // No custom audit logs
  }
});
```

### Practical Use Cases

**External System Integration:**
```typescript
// Audit external system changes
async function syncFromExternalSystem(externalChanges: any[]) {
  const auditEntries = externalChanges.map(change => ({
    action: change.operation as AuditAction,
    documentId: new ObjectId(change.documentId),
    userContext: { userId: change.externalUserId },
    metadata: {
      beforeDocument: change.before,
      afterDocument: change.after,
      customData: {
        externalSystemId: change.systemId,
        syncTimestamp: change.timestamp,
        externalTransactionId: change.transactionId
      }
    }
  }));
  
  await collection.createAuditLogs(auditEntries);
}
```

**Data Migration Audit Trail:**
```typescript
// Create audit trail for migrated data
async function createMigrationAuditTrail(migratedRecords: any[], migrationId: string) {
  const auditEntries = migratedRecords.map(record => ({
    action: 'create' as AuditAction,
    documentId: record._id,
    userContext: { userId: 'migration-system' },
    metadata: {
      afterDocument: record,
      customData: {
        migrationId,
        originalSystemId: record.legacyId,
        migrationDate: new Date(),
        dataSource: 'legacy_system'
      }
    }
  }));
  
  await collection.createAuditLogs(auditEntries);
}
```

**Approval Workflow Audit:**
```typescript
// Audit approval workflow steps
async function auditApprovalStep(
  documentId: ObjectId, 
  step: string, 
  approverId: string, 
  decision: 'approved' | 'rejected',
  comments?: string
) {
  await collection.createAuditLog(
    'custom',
    documentId,
    { userId: approverId },
    {
      customData: {
        workflowStep: step,
        decision,
        comments,
        timestamp: new Date(),
        approvalLevel: getApprovalLevel(approverId)
      }
    }
  );
}
```

**Bulk Operation Tracking:**
```typescript
// Track bulk operations with detailed audit
async function performBulkUpdate(
  filter: any, 
  updateData: any, 
  operatorId: string,
  reason: string
) {
  // Get documents before update
  const beforeDocs = await collection.find(filter);
  
  // Perform update
  const result = await collection.update(filter, updateData, {
    userContext: { userId: operatorId },
    skipAudit: true  // Skip automatic audit, we'll create custom ones
  });
  
  // Get documents after update
  const afterDocs = await collection.find(filter);
  
  // Create detailed audit logs
  const auditEntries = beforeDocs.map((beforeDoc, index) => ({
    action: 'update' as AuditAction,
    documentId: beforeDoc._id,
    userContext: { userId: operatorId },
    metadata: {
      beforeDocument: beforeDoc,
      afterDocument: afterDocs[index],
      customData: {
        operationType: 'bulk_update',
        reason,
        affectedCount: result.modifiedCount,
        batchSize: beforeDocs.length
      }
    }
  }));
  
  await collection.createAuditLogs(auditEntries);
  
  return result;
}
```

## Best Practices

### 1. Error Handling

```typescript
// Always use try-catch for error handling
try {
  const user = await users.create(userData, { userContext });
  // Handle success
  console.log('User created:', user._id);
} catch (error) {
  // Handle error
  console.error('Failed to create user:', error.message);
  // Log for debugging, show user-friendly message
}
```

### 2. User Context

```typescript
// Always provide user context for audit trails
const userContext = { userId: getCurrentUser().id };

await users.create(userData, { userContext });
await users.updateById(userId, updateData, { userContext });
await users.deleteById(userId, { userContext });
```

### 3. Queries with Soft Deletes

```typescript
// Be explicit about soft delete behavior
try {
  const activeUsers = await users.find({}); // Default: excludes deleted
  const allUsers = await users.find({}, { includeSoftDeleted: true });
  const deletedUsers = await users.find({ 
    deletedAt: { $exists: true } 
  }, { includeSoftDeleted: true });
} catch (error) {
  console.error('Query failed:', error.message);
}
```

### 4. Concurrency Configuration

```typescript
// Choose appropriate strategy for your environment
const config = process.env.NODE_ENV === 'production' 
  ? { transactionsEnabled: true }  // Atlas/Replica Set
  : { transactionsEnabled: false }; // Local development

// Enable audit logging
const auditLogger = new MonguardAuditLogger(db, 'audit_logs');
const collection = new MonguardCollection<User>(db, 'users', {
  auditLogger,
  concurrency: config
});
```

### 5. Audit Logger Configuration

```typescript
// Use strict validation in production for data integrity
const auditLogger = new MonguardAuditLogger(db, 'audit_logs', {
  refIdConfig: RefIdConfigs.objectId(),
  strictValidation: process.env.NODE_ENV === 'production', // Strict in production
  logger: customLogger  // Always use custom logger for better observability
});

// Custom logger for production monitoring
const productionLogger = {
  warn: (message: string, ...args: any[]) => {
    logger.warn({ message, args, service: 'monguard' });
    metrics.increment('monguard.validation.warning');
  },
  error: (message: string, ...args: any[]) => {
    logger.error({ message, args, service: 'monguard' });
    metrics.increment('monguard.audit.error');
    alerting.notify('audit_logging_failure', { message, args });
  }
};
```

## Examples

### E-commerce User Management

```typescript
import { ObjectId } from 'mongodb';

interface User {
  _id?: ObjectId;
  email: string;
  name: string;
  role: 'admin' | 'user';
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date;
  createdBy?: string;
  updatedBy?: string;
  deletedBy?: string;
}

class UserService {
  private users: MonguardCollection<User>;

  constructor(db: Db) {
    const auditLogger = new MonguardAuditLogger(db, 'user_audit_logs');
    this.users = new MonguardCollection<User>(db, 'users', {
      auditLogger,
      concurrency: { transactionsEnabled: true }
    });
  }

  async createUser(userData: Omit<User, '_id' | 'createdAt' | 'updatedAt'>, adminId: string) {
    try {
      return await this.users.create(userData, {
        userContext: { userId: adminId }
      });
    } catch (error) {
      throw new Error(`Failed to create user: ${error.message}`);
    }
  }

  async deactivateUser(userId: ObjectId, adminId: string) {
    try {
      return await this.users.updateById(userId, {
        $set: { isActive: false }
      }, {
        userContext: { userId: adminId }
      });
    } catch (error) {
      throw new Error(`Failed to deactivate user: ${error.message}`);
    }
  }

  async deleteUser(userId: ObjectId, adminId: string, permanent = false) {
    try {
      return await this.users.deleteById(userId, {
        userContext: { userId: adminId },
        hardDelete: permanent
      });
    } catch (error) {
      throw new Error(`Failed to delete user: ${error.message}`);
    }
  }

  async getActiveUsers() {
    try {
      return await this.users.find({ isActive: true });
    } catch (error) {
      throw new Error(`Failed to get active users: ${error.message}`);
    }
  }

  async getUserAuditTrail(userId: ObjectId) {
    const auditCollection = this.users.getAuditCollection();
    return await auditCollection.find({
      'ref.collection': 'users',
      'ref.id': userId
    }).sort({ timestamp: -1 }).toArray();
  }
}
```

### Multi-tenant Application

```typescript
interface TenantDocument {
  _id?: ObjectId;
  tenantId: string;
  // ... other fields
}

interface User extends TenantDocument {
  email: string;
  name: string;
}

class TenantUserService {
  private users: MonguardCollection<User>;

  constructor(db: Db) {
    const auditLogger = new MonguardAuditLogger(db, 'tenant_audit_logs');
    this.users = new MonguardCollection<User>(db, 'users', {
      auditLogger,
      concurrency: { transactionsEnabled: true }
    });
  }

  async createUser(tenantId: string, userData: Omit<User, '_id' | 'tenantId'>, userId: string) {
    try {
      return await this.users.create({
        ...userData,
        tenantId
      }, {
        userContext: { userId }
      });
    } catch (error) {
      throw new Error(`Failed to create tenant user: ${error.message}`);
    }
  }

  async getTenantUsers(tenantId: string) {
    try {
      return await this.users.find({ tenantId });
    } catch (error) {
      throw new Error(`Failed to get tenant users: ${error.message}`);
    }
  }

  async getTenantAuditLogs(tenantId: string) {
    try {
      const auditCollection = this.users.getAuditCollection();
      
      // Get all user IDs for the tenant first
      const tenantUsers = await this.users.find({ tenantId });
      const userIds = tenantUsers.map(user => user._id);
      
      return await auditCollection.find({
        'ref.collection': 'users',
        'ref.id': { $in: userIds }
      }).sort({ timestamp: -1 }).toArray();
    } catch (error) {
      throw new Error(`Failed to get tenant audit logs: ${error.message}`);
    }
  }
}
```

### External Application Control Examples

#### Data Migration with Manual Control

```typescript
import { ObjectId } from 'mongodb';
import { MonguardCollection } from 'monguard';

interface LegacyUser {
  id: string;
  name: string;
  email: string;
  created_date: string;
  modified_date: string;
  created_by_user: string;
  modified_by_user: string;
  is_deleted: boolean;
  deleted_date?: string;
  deleted_by_user?: string;
}

interface User extends AuditableDocument {
  name: string;
  email: string;
  legacyId: string;
}

class DataMigrationService {
  private users: MonguardCollection<User>;

  constructor(db: Db) {
    // Configure for migration - manual control over all fields
    this.users = new MonguardCollection<User>(db, 'users', {
      concurrency: { transactionsEnabled: true },
      autoFieldControl: {
        enableAutoTimestamps: false,   // Manual timestamp control
        enableAutoUserTracking: false  // Manual user tracking control
      },
      auditControl: {
        enableAutoAudit: false,        // Manual audit control
        auditCustomOperations: true
      }
    });
  }

  async migrateLegacyUsers(legacyUsers: LegacyUser[], migrationUserId: string) {
    const migrationStart = new Date();
    const migratedUsers = [];
    const auditEntries = [];

    for (const legacyUser of legacyUsers) {
      try {
        // Create new user document
        const userData = {
          name: legacyUser.name,
          email: legacyUser.email,
          legacyId: legacyUser.id
        };

        // Manually control auto-fields with preserved timestamps
        const processedUser = this.users.updateAutoFields(userData, {
          operation: 'create',
          customTimestamp: new Date(legacyUser.created_date),
          userContext: { userId: legacyUser.created_by_user }
        });

        // Handle soft-deleted legacy users
        if (legacyUser.is_deleted && legacyUser.deleted_date) {
          this.users.setDeletedFields(
            processedUser,
            { userId: legacyUser.deleted_by_user },
            new Date(legacyUser.deleted_date)
          );
        }

        // Save to database (skip automatic audit)
        const savedUser = await this.users.create(processedUser, { 
          skipAudit: true 
        });
        migratedUsers.push(savedUser);

        // Create custom audit log for migration
        auditEntries.push({
          action: 'create' as AuditAction,
          documentId: savedUser._id,
          userContext: { userId: migrationUserId },
          metadata: {
            afterDocument: savedUser,
            customData: {
              migrationType: 'legacy_migration',
              originalId: legacyUser.id,
              migrationTimestamp: migrationStart,
              preservedCreatedAt: new Date(legacyUser.created_date),
              preservedCreatedBy: legacyUser.created_by_user
            }
          }
        });

      } catch (error) {
        console.error(`Failed to migrate user ${legacyUser.id}:`, error.message);
      }
    }

    // Create batch audit logs for all migrations
    await this.users.createAuditLogs(auditEntries);

    return {
      migrated: migratedUsers.length,
      total: legacyUsers.length,
      auditTrail: auditEntries.length
    };
  }
}
```

#### External System Integration

```typescript
interface ExternalSystemEvent {
  eventId: string;
  operation: 'create' | 'update' | 'delete';
  entityId: string;
  userId: string;
  timestamp: string;
  data?: any;
  previousData?: any;
}

class ExternalSystemIntegration {
  private collection: MonguardCollection<any>;

  constructor(db: Db, collectionName: string) {
    // Configure for external system integration
    this.collection = new MonguardCollection(db, collectionName, {
      concurrency: { transactionsEnabled: true },
      autoFieldControl: {
        enableAutoTimestamps: false,   // External system provides timestamps
        enableAutoUserTracking: true   // Track integration user
      },
      auditControl: {
        enableAutoAudit: false,        // Manual audit for external events
        auditCustomOperations: true
      }
    });
  }

  async processExternalEvents(events: ExternalSystemEvent[], integrationUserId: string) {
    const processedEvents = [];
    const auditEntries = [];

    for (const event of events) {
      try {
        const eventTimestamp = new Date(event.timestamp);
        let result;

        switch (event.operation) {
          case 'create':
            // Manual auto-field control for external creation
            const createData = this.collection.updateAutoFields(event.data, {
              operation: 'create',
              customTimestamp: eventTimestamp,
              userContext: { userId: integrationUserId }
            });

            result = await this.collection.create(createData, { skipAudit: true });
            break;

          case 'update':
            // Manual auto-field control for external update
            const updateData = { 
              $set: this.collection.updateAutoFields(event.data, {
                operation: 'update',
                customTimestamp: eventTimestamp,
                userContext: { userId: integrationUserId }
              })
            };

            result = await this.collection.updateById(
              new ObjectId(event.entityId), 
              updateData, 
              { skipAudit: true }
            );
            break;

          case 'delete':
            result = await this.collection.deleteById(
              new ObjectId(event.entityId),
              { 
                userContext: { userId: integrationUserId },
                skipAudit: true 
              }
            );
            break;
        }

        processedEvents.push({ eventId: event.eventId, result });

        // Create custom audit log for external event
        auditEntries.push({
          action: event.operation as AuditAction,
          documentId: event.operation === 'create' ? result._id : new ObjectId(event.entityId),
          userContext: { userId: integrationUserId },
          metadata: {
            beforeDocument: event.previousData,
            afterDocument: event.data,
            customData: {
              externalEventId: event.eventId,
              externalUserId: event.userId,
              externalTimestamp: event.timestamp,
              integrationSystem: 'external-crm'
            }
          }
        });

      } catch (error) {
        console.error(`Failed to process event ${event.eventId}:`, error.message);
      }
    }

    // Create batch audit logs for all external events
    if (auditEntries.length > 0) {
      await this.collection.createAuditLogs(auditEntries);
    }

    return {
      processed: processedEvents.length,
      total: events.length,
      auditEntries: auditEntries.length
    };
  }
}
```

#### Bulk Import with Custom Audit

```typescript
interface ImportRecord {
  data: any;
  source: string;
  lineNumber: number;
  externalId?: string;
}

class BulkImportService {
  private collection: MonguardCollection<any>;

  constructor(db: Db, collectionName: string) {
    this.collection = new MonguardCollection(db, collectionName, {
      concurrency: { transactionsEnabled: true },
      autoFieldControl: {
        enableAutoTimestamps: true,
        enableAutoUserTracking: true
      },
      auditControl: {
        enableAutoAudit: false,        // Manual audit for import tracking
        auditCustomOperations: true
      }
    });
  }

  async performBulkImport(
    records: ImportRecord[], 
    importerId: string, 
    batchSize: number = 100
  ) {
    const importStart = new Date();
    const importId = `import-${Date.now()}`;
    const results = { successful: 0, failed: 0, errors: [] };
    const auditEntries = [];

    // Process in batches
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      
      for (const record of batch) {
        try {
          // Manual auto-field control for consistent import timestamps
          const importData = this.collection.updateAutoFields(record.data, {
            operation: 'create',
            customTimestamp: importStart,
            userContext: { userId: importerId }
          });

          // Create document (skip automatic audit)
          const created = await this.collection.create(importData, { skipAudit: true });
          results.successful++;

          // Prepare custom audit entry
          auditEntries.push({
            action: 'create' as AuditAction,
            documentId: created._id,
            userContext: { userId: importerId },
            metadata: {
              afterDocument: created,
              customData: {
                importId,
                importSource: record.source,
                lineNumber: record.lineNumber,
                externalId: record.externalId,
                batchNumber: Math.floor(i / batchSize) + 1,
                importTimestamp: importStart
              }
            }
          });

        } catch (error) {
          results.failed++;
          results.errors.push({
            lineNumber: record.lineNumber,
            error: error.message,
            data: record.data
          });
        }
      }

      // Create audit logs for this batch
      if (auditEntries.length >= batchSize) {
        await this.collection.createAuditLogs(auditEntries.splice(0, batchSize));
      }
    }

    // Create audit logs for remaining entries
    if (auditEntries.length > 0) {
      await this.collection.createAuditLogs(auditEntries);
    }

    // Create import summary audit log
    await this.collection.createAuditLog(
      'custom',
      new ObjectId(), // Summary entry, not tied to specific document
      { userId: importerId },
      {
        customData: {
          importId,
          importSummary: {
            totalRecords: records.length,
            successful: results.successful,
            failed: results.failed,
            startTime: importStart,
            endTime: new Date(),
            duration: Date.now() - importStart.getTime()
          }
        }
      }
    );

    return results;
  }
}
```

#### Scheduled Task Automation

```typescript
class ScheduledTaskService {
  private collection: MonguardCollection<any>;

  constructor(db: Db, collectionName: string) {
    this.collection = new MonguardCollection(db, collectionName, {
      concurrency: { transactionsEnabled: true },
      auditControl: {
        enableAutoAudit: true,
        auditCustomOperations: true
      }
    });
  }

  async performScheduledCleanup(taskId: string, systemUserId: string) {
    const taskStart = new Date();
    const cutoffDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days ago

    // Find old soft-deleted records
    const oldDeletedRecords = await this.collection.find({
      deletedAt: { $lt: cutoffDate }
    }, { includeSoftDeleted: true });

    const results = {
      processed: 0,
      permanentlyDeleted: 0,
      errors: []
    };

    for (const record of oldDeletedRecords) {
      try {
        // Perform permanent deletion
        await this.collection.deleteById(record._id, {
          userContext: { userId: systemUserId },
          hardDelete: true,
          skipAudit: true  // We'll create custom audit
        });

        results.permanentlyDeleted++;

        // Create custom audit log for scheduled cleanup
        await this.collection.createAuditLog(
          'delete',
          record._id,
          { userId: systemUserId },
          {
            beforeDocument: record,
            customData: {
              taskType: 'scheduled_cleanup',
              taskId,
              originalDeletedAt: record.deletedAt,
              originalDeletedBy: record.deletedBy,
              cleanupReason: 'retention_policy',
              retentionDays: 90
            }
          }
        );

      } catch (error) {
        results.errors.push({
          recordId: record._id,
          error: error.message
        });
      }

      results.processed++;
    }

    // Create task completion audit log
    await this.collection.createAuditLog(
      'custom',
      new ObjectId(), // Task summary
      { userId: systemUserId },
      {
        customData: {
          taskType: 'scheduled_cleanup_summary',
          taskId,
          startTime: taskStart,
          endTime: new Date(),
          results: {
            totalProcessed: results.processed,
            permanentlyDeleted: results.permanentlyDeleted,
            errors: results.errors.length
          }
        }
      }
    );

    return results;
  }
}
```

## Troubleshooting

### Common Issues

#### Transaction Errors in Standalone MongoDB

**Problem**: `Transaction numbers are only allowed on a replica set member or mongos`

**Solution**: Use optimistic locking strategy for standalone MongoDB:

```typescript
const auditLogger = new MonguardAuditLogger(db, 'audit_logs');
const collection = new MonguardCollection<User>(db, 'users', {
  auditLogger,
  concurrency: { transactionsEnabled: false } // Disable transactions
});
```

#### Type Errors with ObjectId

**Problem**: TypeScript errors about ObjectId imports

**Solution**: Import ObjectId from your chosen MongoDB driver:

```typescript
import { ObjectId } from 'mongodb'; // or your driver
import { MonguardCollection } from 'monguard';
```

#### Mixed ID Types in Audit Logs

**Problem**: Audit logs contain mixed ID types

**Solution**: Use strict validation with consistent RefIdConfig:

```typescript
// Use strict validation to prevent mixed ID types
const auditLogger = new MonguardAuditLogger(db, 'audit_logs', {
  refIdConfig: RefIdConfigs.objectId(),  // Enforce ObjectId consistency
  strictValidation: true,                // Throw errors on type mismatches
  logger: customLogger
});

const users = new MonguardCollection<User>(db, 'users', {
  auditLogger: auditLogger,
  concurrency: { transactionsEnabled: true }
});

// This will throw an error if document ID is not an ObjectId
try {
  await users.create(userData, { userContext: { userId: 'admin' } });
} catch (error) {
  console.error('ID validation failed:', error.message);
}
```

#### Custom Logger Integration Issues

**Problem**: Custom logging service not receiving audit messages

**Solution**: Ensure logger interface is correctly implemented:

```typescript
// Correct logger implementation
const logger = {
  warn: (message: string, ...args: any[]) => {
    // Make sure your logging service is properly called
    console.log('AUDIT WARNING:', message, ...args);
    myLoggingService.warn(message, ...args);
  },
  error: (message: string, ...args: any[]) => {
    console.log('AUDIT ERROR:', message, ...args);
    myErrorService.error(message, ...args);
  }
};

const auditLogger = new MonguardAuditLogger(db, 'audit_logs', {
  logger: logger,  // Use custom logger
  strictValidation: false
});
```

#### Performance Issues with Large Collections

**Problem**: Slow queries on large collections

**Solutions**:

1. **Index your collections**:
```typescript
// Add indexes for common queries
await db.collection('users').createIndex({ deletedAt: 1 });
await db.collection('audit_logs').createIndex({ 'ref.id': 1 });
await db.collection('audit_logs').createIndex({ timestamp: -1 });
```

2. **Use appropriate query options**:
```typescript
// Limit results for large datasets
try {
  const users = await users.find({}, { 
    limit: 100,
    skip: page * 100,
    sort: { createdAt: -1 }
  });
} catch (error) {
  console.error('Query failed:', error.message);
}
```

3. **Consider pagination for audit logs**:
```typescript
async function getAuditLogsPaginated(userId: ObjectId, page = 0, limit = 50) {
  const auditCollection = users.getAuditCollection();
  return await auditCollection
    .find({ 'ref.id': userId })
    .sort({ timestamp: -1 })
    .skip(page * limit)
    .limit(limit)
    .toArray();
}
```

#### Memory Issues with Large Updates

**Problem**: Memory exhaustion with bulk operations

**Solution**: Use batch processing:

```typescript
async function bulkUpdateUsers(userIds: ObjectId[], updateData: any, userContext: UserContext) {
  const batchSize = 100;
  const results = [];
  
  for (let i = 0; i < userIds.length; i += batchSize) {
    const batch = userIds.slice(i, i + batchSize);
    
    try {
      const batchPromises = batch.map(id => 
        users.updateById(id, updateData, { userContext })
      );
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    } catch (error) {
      console.error(`Batch update failed for batch ${i / batchSize}:`, error.message);
      throw error; // Re-throw to stop processing
    }
  }
  
  return results;
}
```

### Debug Tips

1. **Enable audit logging temporarily**:
```typescript
const auditLogger = new MonguardAuditLogger(db, 'debug_audit_logs');
const collection = new MonguardCollection<User>(db, 'users', {
  auditLogger, // Enable auditing with debug collection
  concurrency: { transactionsEnabled: true }
});
```

2. **Check audit logs for debugging**:
```typescript
// See what operations were performed
const recentAudits = await collection.getAuditCollection()
  .find({})
  .sort({ timestamp: -1 })
  .limit(10)
  .toArray();

console.log('Recent operations:', recentAudits);
```

3. **Use detailed error logging**:
```typescript
try {
  const user = await users.create(userData, { userContext });
  console.log('User created successfully:', user._id);
} catch (error) {
  console.error('Operation failed:', {
    error: error.message,
    userData,
    userContext,
    timestamp: new Date()
  });
}
```

---

For more examples and advanced usage patterns, see the test files in the repository. For issues and feature requests, please visit the GitHub repository.

## License

MIT License © 2025
Created by [@thaitype](https://github.com/thaitype)

