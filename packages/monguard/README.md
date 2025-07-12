# 🛡️ monguard – The Guardian of Your MongoDB Records

[![CI](https://github.com/thaitype/monguard/actions/workflows/main.yml/badge.svg)](https://github.com/thaitype/monguard/actions/workflows/main.yml) [![codecov](https://codecov.io/gh/thaitype/monguard/graph/badge.svg?token=B7MCHM57BH)](https://codecov.io/gh/thaitype/monguard) [![NPM Version](https://img.shields.io/npm/v/monguard) ](https://www.npmjs.com/package/monguard)[![npm downloads](https://img.shields.io/npm/dt/monguard)](https://www.npmjs.com/package/monguard) 

> Note: The API is subject to change, please follow the release note to migration document, please report any issues or suggestions. 

**`monguard`** is a lightweight, zero-boilerplate toolkit designed to enhance MongoDB models with production-ready features:

* 🗑️ **Soft Delete** — Mark records as deleted without removing them from the database
* ⏱️ **Auto Timestamps** — Automatically manage `createdAt` and `updatedAt` fields
* 🕵️ **Audit Logging** — Track every `create`, `update`, and `delete` action with detailed metadata
* 🚀 **Transaction-Aware Auditing** — In-transaction or outbox patterns for different consistency needs
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
* **Financial systems** requiring strict audit compliance
* **High-throughput applications** with eventual consistency needs
* Any app where "delete" doesn't really mean delete 😉

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
- [Multi-Phase Operations](#multi-phase-operations)
- [Concurrency Strategies](#concurrency-strategies)
- [Audit Logging](#audit-logging)
- [Delta Mode Audit Logging](#delta-mode-audit-logging)
- [Transactions with Outbox Pattern](#transactions-with-outbox-pattern)
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
  concurrency: { transactionsEnabled: true },
  auditControl: {
    mode: 'inTransaction',     // Strong audit consistency
    failOnError: false         // Graceful error handling
  }
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
- **Transaction-aware audit control** with in-transaction and outbox modes
- **Flexible error handling** with fail-fast or resilient strategies
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
  
  // Transaction-aware audit control options
  mode?: 'inTransaction' | 'outbox';  // Default: 'inTransaction'
  failOnError?: boolean;              // Default: false
  logFailedAttempts?: boolean;        // Default: false
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
    auditCustomOperations: true,
    mode: 'inTransaction',        // Strong consistency
    failOnError: false,           // Graceful degradation
    logFailedAttempts: true       // Monitor audit health
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

## Multi-Phase Operations

Multi-phase operations are workflows where a single business process requires multiple sequential database updates, often involving different users, departments, or systems. Monguard's `__v` feature enables safe, conflict-free multi-phase operations using version-based optimistic locking.

### Basic Version-Safe Chaining

```typescript
// Safe multi-phase operation using __v
async function processOrder(orders: MonguardCollection, orderId: ObjectId) {
  const customerService = { userId: 'cs-001' };
  const warehouse = { userId: 'warehouse-001' };
  
  // Phase 1: Customer service validates
  const validation = await orders.update(
    { _id: orderId, status: 'pending' },
    { $set: { status: 'processing' } },
    { userContext: customerService }
  );
  
  if (!validation.__v) {
    throw new Error('Validation failed or version conflict');
  }
  
  // Phase 2: Warehouse processes using __v from Phase 1
  const processing = await orders.update(
    { _id: orderId, __v: validation.__v }, // Use __v for safety
    { $set: { status: 'shipped' } },
    { userContext: warehouse }
  );
  
  return processing.__v;
}
```

### When `__v` is Available

| Condition | `__v` Value | Safe to Chain? |
|-----------|-------------------|----------------|
| Single document modified | `currentVersion + 1` | ✅ Yes |
| No documents modified | `undefined` | ❌ Operation failed |
| Multi-document operation | `undefined` | ❌ Ambiguous state |
| Hard delete operation | `undefined` | ❌ Document removed |

### Conflict Detection and Recovery

```typescript
async function retryableUpdate(collection: MonguardCollection, docId: ObjectId) {
  let retryCount = 0;
  const maxRetries = 3;
  
  while (retryCount < maxRetries) {
    try {
      // Get current document state
      const currentDoc = await collection.findById(docId);
      if (!currentDoc) throw new Error('Document not found');
      
      // Attempt version-safe update
      const result = await collection.update(
        { _id: docId, __v: currentDoc.__v },
        { $set: { processed: true } },
        { userContext: { userId: 'processor' } }
      );
      
      if (result.modifiedCount > 0) {
        return result.__v; // Success!
      }
      
      // Version conflict - retry
      retryCount++;
      await new Promise(resolve => setTimeout(resolve, 100 * retryCount));
      
    } catch (error) {
      retryCount++;
      if (retryCount >= maxRetries) throw error;
    }
  }
}
```

### Real-World Use Cases

**Document Approval Workflow:**
```typescript
// Author → Reviewer → Approver → Publisher
const submission = await docs.update(
  { _id: docId, __v: 1 },
  { $set: { status: 'submitted' } },
  { userContext: author }
);

const review = await docs.update(
  { _id: docId, __v: submission.__v },
  { $set: { status: 'reviewed' } },
  { userContext: reviewer }
);

const approval = await docs.update(
  { _id: docId, __v: review.__v },
  { $set: { status: 'approved' } },
  { userContext: approver }
);
```

**E-Commerce Order Fulfillment:**
```typescript
// Validation → Packing → Billing → Completion
const phases = [
  { status: 'processing', user: customerService },
  { status: 'shipped', user: warehouse },
  { status: 'completed', user: billing }
];

let currentVersion = order.__v;
for (const phase of phases) {
  const result = await orders.update(
    { _id: orderId, __v: currentVersion },
    { $set: { status: phase.status } },
    { userContext: phase.user }
  );
  
  if (!result.__v) {
    throw new Error(`Phase failed: ${phase.status}`);
  }
  
  currentVersion = result.__v;
}
```

For comprehensive documentation on multi-phase operations, including error handling patterns, performance considerations, and advanced use cases, see: [Multi-Phase Operations Guide](./docs/multi-phase-operations.md).

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
): Promise<ExtendedUpdateResult>

// Update by ID
async updateById(
  id: ObjectId,
  update: UpdateFilter<T>,
  options?: UpdateOptions
): Promise<ExtendedUpdateResult>

interface UpdateOptions {
  skipAudit?: boolean;
  userContext?: UserContext;
  upsert?: boolean;
}

interface ExtendedUpdateResult {
  acknowledged: boolean;
  modifiedCount: number;
  upsertedCount: number;
  upsertedId: any | null;
  matchedCount: number;
  __v?: number; // Available for single-document updates with Optimistic Locking
}
```

#### __v Field Behavior

The `__v` field indicates the document version after update and provides insight into the operation type:

**With Optimistic Locking Strategy (`transactionsEnabled: false`):**
- ✅ **Single document update**: Returns `__v` (e.g., `3`)
- ❌ **Multi-document update**: Returns `__v: undefined`

**With Transaction Strategy (`transactionsEnabled: true`):**
- ❌ **All updates**: Returns `__v: undefined` (no version tracking)

```typescript
// Example: Detecting operation type
const result = await collection.update(filter, update);

if (result.__v !== undefined) {
  console.log(`Single document updated to version ${result.__v}`);
  console.log('Concurrency protection was applied ✅');
} else {
  console.log(`${result.modifiedCount} documents updated`);
  console.log('Multi-document operation or Transaction strategy ⚡');
}
```

#### Single vs Multi-Document Updates

The Optimistic Locking Strategy behaves differently based on how many documents match your filter:

**🔒 Single Document Updates** (Full concurrency protection):
- **When**: Filter matches exactly 1 document
- **Behavior**: Uses version control for concurrency safety
- **Returns**: `__v` field for tracking document state
- **Retry**: Automatic retry on version conflicts
- **Examples**: 
  ```typescript
  // These get optimistic locking if they match 1 document:
  await collection.updateById(id, update)
  await collection.update({ email: "unique@example.com" }, update)
  await collection.update({ externalId: "EXT123" }, update)
  ```

**⚡ Multi-Document Updates** (No concurrency protection):
- **When**: Filter matches 2+ documents
- **Behavior**: Updates all matching documents without version control
- **Returns**: `__v: undefined`
- **Retry**: No automatic conflict resolution
- **Examples**:
  ```typescript
  // These lose optimistic locking:
  await collection.update({ status: "active" }, update)    // matches many
  await collection.update({ department: "eng" }, update)   // matches many
  ```

**Best Practices:**
- ✅ Use unique field filters (email, externalId) for concurrent safety
- ✅ Check `__v` field to confirm single-document operation
- ⚠️ Use multi-document updates only when you understand the concurrency trade-offs
- 🔄 For critical updates, prefer `updateById()` or unique field filters


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
- No __v fields required

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

Monguard provides comprehensive audit logging with two storage modes:
- **Full Mode** (default): Stores complete before/after document states
- **Delta Mode**: Stores only field-level changes, providing 70-90% storage reduction

> 💡 **Tip**: For high-efficiency audit logging, see [Delta Mode Audit Logging](#delta-mode-audit-logging) section below.

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

## Delta Mode Audit Logging

Delta mode is a highly efficient audit logging strategy that stores only the field-level changes instead of full document snapshots, providing **70-90% storage reduction** while maintaining complete audit trail functionality.

### Overview

Traditional audit logging stores complete "before" and "after" document states for every change. Delta mode intelligently tracks only the fields that actually changed, dramatically reducing storage requirements while preserving full audit capabilities.

**Key Benefits:**
- **70-90% storage reduction** for typical update operations
- **Zero breaking changes** - seamlessly upgrade existing installations
- **Smart fallbacks** for complex nested structures
- **Per-operation control** - mix delta and full modes as needed
- **Production-ready** with comprehensive error handling

### Configuration

#### Global Delta Mode Configuration

```typescript
import { MonguardAuditLogger } from 'monguard';

const auditLogger = new MonguardAuditLogger(db, 'audit_logs', {
  // Core delta mode settings
  storageMode: 'delta',         // 'full' | 'delta' (default: 'full')
  
  // Delta computation options
  maxDepth: 3,                  // Max nesting depth for field-wise diff (default: 3)
  arrayHandling: 'diff',        // 'diff' | 'replace' (default: 'diff')
  arrayDiffMaxSize: 20,         // Max array size for element-wise diff (default: 20)
  
  // Fields to exclude from delta computation
  blacklist: [
    'createdAt', 'updatedAt', 'createdBy', 'updatedBy', '__v',
    'meta.*',                   // Wildcard patterns supported
    'internal.cache'            // Exact field paths
  ]
});

const users = new MonguardCollection<User>(db, 'users', {
  auditLogger,
  concurrency: { transactionsEnabled: true }
});
```

#### Per-Operation Mode Override

```typescript
// Force full mode for a specific operation
await users.update(filter, update, {
  userContext,
  auditControl: { storageMode: 'full' }  // Override global delta mode
});

// Use delta mode even when global default is 'full'
await users.update(filter, update, {
  userContext,
  auditControl: { storageMode: 'delta' } // Override global full mode
});

// Note: CREATE and DELETE operations always use full mode (logical requirement)
await users.create(document, {
  userContext,
  auditControl: { storageMode: 'delta' } // Will be ignored - CREATE always uses full
});
```

### Data Structure Comparison

#### Traditional Full Mode Audit Log
```typescript
{
  _id: ObjectId,
  action: 'UPDATE',
  ref: { collection: 'users', id: ObjectId },
  userId: ObjectId,
  timestamp: Date,
  metadata: {
    storageMode: 'full',
    before: {
      _id: ObjectId,
      name: 'John Doe',
      email: 'john@example.com',
      profile: {
        address: { city: 'Bangkok', country: 'Thailand' },
        preferences: { theme: 'dark', language: 'en' }
      },
      tags: ['user', 'editor', 'active'],
      // ... potentially hundreds of other fields
    },
    after: {
      _id: ObjectId,
      name: 'Jane Doe',        // Only this changed
      email: 'john@example.com',
      profile: {
        address: { city: 'Bangkok', country: 'Thailand' },
        preferences: { theme: 'dark', language: 'en' }
      },
      tags: ['user', 'editor', 'active'],
      // ... same hundreds of other fields
    }
  }
}
```

#### Delta Mode Audit Log (70-90% smaller)
```typescript
{
  _id: ObjectId,
  action: 'UPDATE', 
  ref: { collection: 'users', id: ObjectId },
  userId: ObjectId,
  timestamp: Date,
  metadata: {
    storageMode: 'delta',
    deltaChanges: {
      'name': { old: 'John Doe', new: 'Jane Doe' }  // Only the changed field!
    }
    // Optional: keep before/after for debugging (can be removed for maximum savings)
  }
}
```

### Advanced Delta Features

#### Nested Object Changes
```typescript
// Document update
await users.update(filter, {
  $set: { 
    'profile.address.city': 'Chiang Mai',
    'profile.preferences.theme': 'light'
  }
});

// Resulting delta audit log
{
  metadata: {
    storageMode: 'delta',
    deltaChanges: {
      'profile.address.city': { old: 'Bangkok', new: 'Chiang Mai' },
      'profile.preferences.theme': { old: 'dark', new: 'light' }
    }
  }
}
```

#### Smart Array Handling
```typescript
// Small arrays: element-wise diff
{
  deltaChanges: {
    'tags.1': { old: 'editor', new: 'premium' },     // Array index changes
    'tags.3': { old: undefined, new: 'verified' }    // New array element
  }
}

// Large arrays: full replacement with indicator
{
  deltaChanges: {
    'hobbies': { 
      old: [...], 
      new: [...], 
      fullDocument: true    // Array too large for element-wise diff
    }
  }
}
```

#### Automatic Fallbacks

Delta mode includes smart fallbacks to ensure audit reliability:

```typescript
// Configuration with fallback triggers
const auditLogger = new MonguardAuditLogger(db, 'audit_logs', {
  storageMode: 'delta',
  maxDepth: 3,              // Fallback to full mode beyond 3 levels deep
  arrayDiffMaxSize: 20,     // Fallback to full array replacement for arrays > 20 elements
  blacklist: ['meta.*']     // Skip complex metadata fields
});
```

**Fallback scenarios:**
- **Deep nesting exceeds maxDepth** → Full document mode for that field
- **Arrays exceed arrayDiffMaxSize** → Full array replacement with `fullDocument: true`
- **Computation errors** → Graceful fallback to full mode
- **Circular references** → Automatic detection and fallback

### Migration from Full Mode

#### Zero-Downtime Migration

```typescript
// Step 1: Enable delta mode (backward compatible)
const auditLogger = new MonguardAuditLogger(db, 'audit_logs', {
  storageMode: 'delta'  // Existing full mode logs remain intact
});

// Step 2: Mixed mode operation (optional transition period)
await users.update(filter, update, {
  userContext,
  auditControl: { storageMode: 'full' }  // Still use full mode for critical operations
});

// Step 3: Full delta mode (when ready)
// All new audit logs use delta mode automatically
```

#### Querying Mixed Mode Audit Logs

```typescript
// Query works for both delta and full mode logs
const auditLogs = await auditLogger.getAuditLogs('users', userId);

auditLogs.forEach(log => {
  if (log.metadata?.storageMode === 'delta') {
    // Access field-level changes
    const changes = log.metadata.deltaChanges;
    console.log('Changed fields:', Object.keys(changes));
  } else {
    // Traditional full mode access
    const changes = log.metadata?.changes || [];
    console.log('Changed fields:', changes);
  }
});
```

### Performance Characteristics

#### Storage Efficiency
- **70-90% reduction** in audit log size for typical update operations
- **Minimal overhead** for CREATE/DELETE (always use full mode)
- **Smart memory usage** with no document caching during computation

#### Computational Performance
- **1-2ms overhead** per operation for delta computation
- **Optimized for high-throughput** scenarios with many small updates
- **Configurable limits** prevent performance degradation on complex documents

#### Scalability Benefits
```typescript
// High-frequency updates scenario
for (let i = 0; i < 10000; i++) {
  await users.updateById(userId, { 
    $set: { lastActive: new Date() }    // Only timestamps change
  });
  // Delta mode: ~50 bytes per audit log vs ~5KB in full mode
  // Result: 500KB total vs 50MB total storage
}
```

### Best Practices

#### When to Use Delta Mode
- ✅ **High-frequency updates** with small change sets
- ✅ **Large documents** where only a few fields typically change
- ✅ **Storage-constrained environments** requiring audit compliance
- ✅ **Cost-sensitive applications** with audit log storage costs

#### When to Consider Full Mode
- ⚠️ **Frequent complete document replacements**
- ⚠️ **Very small documents** where delta overhead isn't worthwhile
- ⚠️ **Legacy audit analysis tools** that expect full before/after states

#### Configuration Recommendations

```typescript
// Production-optimized configuration
const auditLogger = new MonguardAuditLogger(db, 'audit_logs', {
  storageMode: 'delta',
  maxDepth: 3,                    // Balance detail vs performance
  arrayHandling: 'diff',          // Preserve array change granularity
  arrayDiffMaxSize: 20,           // Optimize for typical array sizes
  blacklist: [
    // Exclude high-frequency, low-value fields
    'lastAccessed', 'viewCount', 'hitCounter',
    // Exclude complex metadata
    'meta.*', 'internal.*', 'cache.*',
    // Exclude framework fields
    '__v', 'updatedAt', 'createdAt'
  ]
});
```

#### Per-Operation Strategies

```typescript
// Critical operations: use full mode for maximum audit detail
await users.delete(criticalFilter, {
  userContext,
  auditControl: { storageMode: 'full' }  // Complete audit trail for deletions
});

// Bulk operations: use delta mode for efficiency
await users.updateMany(bulkFilter, bulkUpdate, {
  userContext,
  auditControl: { storageMode: 'delta' } // Efficient bulk change tracking
});
```

### Troubleshooting

#### Common Issues

**Q: Delta changes not appearing in audit logs**
```typescript
// Check configuration
const auditLogger = new MonguardAuditLogger(db, 'audit_logs', {
  storageMode: 'delta',  // ✅ Ensure delta mode is enabled
  blacklist: []          // ✅ Check blacklist doesn't exclude your fields
});
```

**Q: Unexpected full mode fallbacks**
```typescript
// Check depth and array size limits
{
  maxDepth: 5,           // ✅ Increase if you have deep nesting
  arrayDiffMaxSize: 50   // ✅ Increase for larger arrays
}
```

**Q: Performance issues with delta computation**
```typescript
// Optimize configuration for your use case
{
  maxDepth: 2,           // ✅ Reduce for faster computation
  blacklist: [           // ✅ Exclude expensive fields
    'complexMetadata.*',
    'largeArrayField'
  ]
}
```

#### Monitoring Delta Mode Performance

```typescript
// Log delta vs full mode usage
auditLogger.on('audit-logged', (log) => {
  const mode = log.metadata?.storageMode || 'full';
  metrics.increment(`audit.mode.${mode}`);
  
  if (mode === 'delta') {
    const changeCount = Object.keys(log.metadata.deltaChanges || {}).length;
    metrics.histogram('audit.delta.changes', changeCount);
  }
});
```

## Transactions with Outbox Pattern

Monguard provides advanced audit control modes that support both **in-transaction** and **outbox pattern** approaches for handling audit logs in distributed systems. This enables you to choose the right consistency and performance trade-offs for your application.

### Audit Control Modes

#### In-Transaction Mode (Strong Consistency)

Best for financial systems, compliance scenarios, and applications requiring strict audit trails:

```typescript
const collection = new MonguardCollection<Order>(db, 'orders', {
  auditLogger: new MonguardAuditLogger(db, 'order_audit_logs'),
  concurrency: { transactionsEnabled: true },
  auditControl: {
    mode: 'inTransaction',        // Audit logs in same transaction
    failOnError: true,            // Rollback on audit failures
    logFailedAttempts: true       // Monitor audit health
  }
});

// Both order creation and audit log happen atomically
await collection.create(orderData, { userContext: { userId: 'user123' } });
```

**Benefits:**
- ✅ Strong consistency - audit logs and data changes are atomic
- ✅ Immediate audit availability
- ✅ No risk of orphaned operations

**Considerations:**
- ⚠️ Higher transaction overhead
- ⚠️ Audit failures can block business operations

#### Outbox Mode (High Performance)

Best for high-throughput systems, eventual consistency scenarios, and decoupled audit processing:

```typescript
import { MongoOutboxTransport } from 'monguard';

// Setup outbox transport
const outboxTransport = new MongoOutboxTransport(db, {
  outboxCollectionName: 'audit_outbox',
  deadLetterCollectionName: 'audit_dead_letter',
  maxRetryAttempts: 3
});

// Create audit logger with outbox transport
const auditLogger = new MonguardAuditLogger(db, 'product_audit_logs', {
  outboxTransport
});

const collection = new MonguardCollection<Product>(db, 'products', {
  auditLogger,
  concurrency: { transactionsEnabled: true },
  auditControl: {
    mode: 'outbox',               // Queue audit events for later processing
    failOnError: false,           // Don't block on audit issues
    logFailedAttempts: true       // Track failures for monitoring
  }
});

// Product creation succeeds even if audit processing fails
await collection.create(productData, { userContext: { userId: 'admin' } });

// Audit events are now queued in the outbox collection for processing
const queueDepth = await outboxTransport.getQueueDepth();
console.log(`${queueDepth} audit events queued for processing`);
```

**Benefits:**
- ✅ Higher performance - no audit overhead in critical path
- ✅ Resilient to audit system failures
- ✅ Better scalability for high-volume operations

**Considerations:**
- ⚠️ Eventual consistency for audit logs
- ⚠️ Requires outbox processor implementation
- ⚠️ More complex error handling and monitoring

### Error Handling Strategies

#### Fail-Fast Strategy (Financial/Compliance)

```typescript
const collection = new MonguardCollection<CriticalData>(db, 'critical_data', {
  auditLogger: new MonguardAuditLogger(db, 'critical_audit'),
  concurrency: { transactionsEnabled: true },
  auditControl: {
    mode: 'inTransaction',
    failOnError: true,    // Fail immediately on audit issues
    logFailedAttempts: false
  }
});

try {
  await collection.create(criticalData, { userContext });
  // Success: both data and audit are committed
} catch (error) {
  // Failure: entire transaction rolled back
  await notifyComplianceTeam(error);
  throw error;
}
```

#### Resilient Strategy (High-Throughput)

```typescript
// Setup outbox transport for high-throughput scenarios
const outboxTransport = new MongoOutboxTransport(db, {
  outboxCollectionName: 'user_actions_outbox'
});

const collection = new MonguardCollection<UserAction>(db, 'user_actions', {
  auditLogger: new MonguardAuditLogger(db, 'action_audit', { outboxTransport }),
  concurrency: { transactionsEnabled: false },
  auditControl: {
    mode: 'outbox',
    failOnError: false,   // Continue despite audit issues
    logFailedAttempts: true
  }
});

// Operation succeeds, audit queued for later processing
await collection.create(userAction, { userContext });
```

### Hybrid Context-Aware Configuration

```typescript
class OrderService {
  private financialCollection: MonguardCollection<FinancialRecord>;
  private inventoryCollection: MonguardCollection<InventoryItem>;

  constructor(db: Db) {
    // Financial operations: strict audit compliance
    this.financialCollection = new MonguardCollection(db, 'financial_records', {
      auditLogger: new MonguardAuditLogger(db, 'financial_audit'),
      concurrency: { transactionsEnabled: true },
      auditControl: {
        mode: 'inTransaction',
        failOnError: true,
        logFailedAttempts: true
      }
    });

    // Inventory operations: eventual consistency acceptable
    this.inventoryCollection = new MonguardCollection(db, 'inventory', {
      auditLogger: new MonguardAuditLogger(db, 'inventory_audit'),
      concurrency: { transactionsEnabled: true },
      auditControl: {
        mode: 'outbox',
        failOnError: false,
        logFailedAttempts: true
      }
    });
  }

  async processOrder(order: Order) {
    const userContext = { userId: order.userId, orderId: order.id };

    // Financial charge: must have audit trail
    await this.financialCollection.create({
      type: 'charge',
      amount: order.total,
      orderId: order.id
    }, { userContext });

    // Inventory update: can be eventually consistent
    await this.inventoryCollection.update(
      { productId: order.productId },
      { $inc: { quantity: -order.quantity } },
      { userContext }
    );
  }
}
```

### Configuration Guide

| Use Case | Mode | failOnError | Reasoning |
|----------|------|-------------|-----------|
| Financial transactions | `inTransaction` | `true` | Regulatory compliance requires audit atomicity |
| User authentication | `inTransaction` | `true` | Security events must be audited |
| Content management | `outbox` | `false` | High volume, eventual consistency acceptable |
| System metrics | `outbox` | `false` | Performance over perfect audit coverage |

### Monitoring and Health Checks

```typescript
// Monitor audit system health
interface AuditMetrics {
  auditLatency: number;           // Time to write audit logs
  outboxQueueDepth: number;       // Pending audit events
  processingRate: number;         // Events processed per second
  auditFailureRate: number;       // % of failed audit attempts
  retryCount: number;             // Failed events being retried
  deadLetterCount: number;        // Permanently failed events
}

// Health check implementation
async function checkAuditHealth() {
  const metrics = await getAuditMetrics();
  
  return {
    status: metrics.auditFailureRate < 0.01 ? 'healthy' : 'degraded',
    details: {
      latency: `${metrics.auditLatency}ms`,
      queueDepth: metrics.outboxQueueDepth,
      failureRate: `${(metrics.auditFailureRate * 100).toFixed(2)}%`
    }
  };
}
```

For comprehensive implementation details, outbox pattern examples, and monitoring strategies, see: [**Transactions, Outbox Pattern, and Audit Logging Guide**](./docs/transactions-outbox-audit.md).

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
    __v: '1.0.0'
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

const collection = new MonguardCollection<User>(db, 'users', {
  auditCollectionName: 'audit_logs',
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

### Concurrency and Update Patterns

#### Single Document Updates with Optimistic Locking

```typescript
// ✅ Safe concurrent updates - Gets version control
const userContext = { userId: 'admin123' };

// Update by ID (always single document)
const result1 = await collection.updateById(
  userId, 
  { $set: { lastLogin: new Date() } },
  { userContext }
);
console.log('Version after update:', result1.__v); // e.g., 5

// Update by unique field (single document if email is unique)
const result2 = await collection.update(
  { email: 'user@example.com' },
  { $set: { name: 'John Doe Updated' } },
  { userContext }
);
console.log('Version after update:', result2.__v); // e.g., 6

// Update by external ID (single document if externalId is unique)
const result3 = await collection.update(
  { externalId: 'EXT123' },
  { $set: { status: 'verified' } },
  { userContext }
);
console.log('Version after update:', result3.__v); // e.g., 7
```

#### Multi-Document Updates (No Optimistic Locking)

```typescript
// ⚠️ Bulk updates - Loses version control for concurrency
const userContext = { userId: 'admin123' };

// Update all active users (multiple documents)
const bulkResult = await collection.update(
  { status: 'active' },
  { $set: { lastNotified: new Date() } },
  { userContext }
);
console.log('Documents updated:', bulkResult.modifiedCount); // e.g., 150
console.log('Version tracking:', bulkResult.__v);     // undefined

// Update all users in a department (multiple documents)
const deptResult = await collection.update(
  { department: 'engineering' },
  { $inc: { budget: 1000 } },
  { userContext }
);
console.log('Departments updated:', deptResult.modifiedCount); // e.g., 25
console.log('Version tracking:', deptResult.__v);       // undefined
```

#### Handling Mixed Scenarios

```typescript
// Function that handles both single and multi-document updates
async function updateUsersByFilter(filter: any, update: any) {
  const result = await collection.update(filter, update, { userContext });
  
  if (result.__v !== undefined) {
    console.log(`✅ Single document updated to version ${result.__v}`);
    console.log('✅ Concurrency protection was applied');
  } else {
    console.log(`⚡ ${result.modifiedCount} documents updated in bulk`);
    console.log('⚠️ No concurrency protection (multi-document operation)');
  }
  
  return result;
}

// Usage examples:
await updateUsersByFilter({ email: 'unique@example.com' }, update); // Single doc
await updateUsersByFilter({ department: 'sales' }, update);         // Multi doc
```

#### Error Handling and Retry Logic

```typescript
async function safeConcurrentUpdate(userId: string, updateData: any) {
  try {
    const result = await collection.updateById(userId, updateData, { userContext });
    
    if (result.__v) {
      console.log(`✅ Update successful, new version: ${result.__v}`);
      return result;
    } else {
      console.log('⚠️ Update completed but no version tracking');
      return result;
    }
  } catch (error) {
    if (error.message.includes('Version conflict')) {
      console.log('🔄 Version conflict detected, document was modified by another operation');
      // The optimistic locking strategy automatically retries, but you can add custom logic here
      throw error;
    } else {
      console.log('❌ Update failed:', error.message);
      throw error;
    }
  }
}
```

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
    this.users = new MonguardCollection<User>(db, 'users', {
      auditCollectionName: 'user_audit_logs',
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
    this.users = new MonguardCollection<User>(db, 'users', {
      auditCollectionName: 'tenant_audit_logs',
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
const collection = new MonguardCollection<User>(db, 'users', {
  auditCollectionName: 'audit_logs',
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
const collection = new MonguardCollection<User>(db, 'users', {
  auditCollectionName: 'debug_audit_logs',
  disableAudit: false, // Ensure auditing is enabled
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

