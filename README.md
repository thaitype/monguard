# 🛡️ monguard – The Guardian of Your MongoDB Records

[![CI](https://github.com/thaitype/monguard/actions/workflows/main.yml/badge.svg)](https://github.com/thaitype/monguard/actions/workflows/main.yml) [![codecov](https://codecov.io/gh/thaitype/monguard/graph/badge.svg?token=B7MCHM57BH)](https://codecov.io/gh/thaitype/monguard) [![NPM Version](https://img.shields.io/npm/v/monguard) ](https://www.npmjs.com/package/monguard)[![npm downloads](https://img.shields.io/npm/dt/monguard)](https://www.npmjs.com/package/monguard) 

> 🛡️ Soft delete, auto fields, and full audit logging – all in one TypeScript-friendly MongoDB toolkit.

A lightweight, zero-boilerplate toolkit designed to enhance MongoDB models with production-ready features

### ✅ Overview

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
- [Document ID Types](#document-id-types)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Concurrency Strategies](#concurrency-strategies)
- [Audit Logging](#audit-logging)
- [Soft Deletes](#soft-deletes)
- [User Tracking](#user-tracking)
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
  // auditCollectionName: 'audit_logs', // Optional: custom audit collection name
  concurrency: { transactionsEnabled: true }
});

// Create a user with audit logging
const result = await users.create({
  name: 'John Doe',
  email: 'john@example.com'
}, {
  userContext: { userId: 'admin-123' }
});

if (result.success) {
  console.log('User created:', result.data);
}
```

## Core Features

### 🔍 **Audit Logging**
- Automatic tracking of all create, update, and delete operations
- Customizable audit collection names
- Rich metadata including before/after states and field changes

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
  // Optional: Audit collection name
  auditCollectionName?: string;
  
  // Optional: Disable audit logging globally for this collection
  disableAudit?: boolean; // Default: false
  
  // Required: Concurrency configuration
  concurrency: MonguardConcurrencyConfig;
}

interface MonguardConcurrencyConfig {
  transactionsEnabled: boolean;
  retryAttempts?: number; // Default: 3 (optimistic strategy only)
  retryDelayMs?: number;  // Default: 100ms (optimistic strategy only)
}
```

### Configuration Examples

#### MongoDB Replica Set/Atlas
```typescript
const collection = new MonguardCollection<User>(db, 'users', {
  auditCollectionName: 'user_audit_logs',
  concurrency: { transactionsEnabled: true }
});
```

#### MongoDB Standalone/Cosmos DB
```typescript
const collection = new MonguardCollection<User>(db, 'users', {
  auditCollectionName: 'user_audit_logs',
  concurrency: { 
    transactionsEnabled: false,
    retryAttempts: 5,
    retryDelayMs: 200
  }
});
```

#### Audit Disabled
```typescript
const collection = new MonguardCollection<User>(db, 'users', {
  auditCollectionName: 'audit_logs',
  disableAudit: true,
  concurrency: { transactionsEnabled: true }
});
```

## API Reference

### Creating Documents

```typescript
async create(
  document: CreateDocument<T>,
  options?: CreateOptions
): Promise<WrapperResult<T & { _id: ObjectId }>>

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
  options?: MonguardFindOptions
): Promise<WrapperResult<T | null>>

// Find multiple documents
async find(
  filter?: Filter<T>,
  options?: MonguardFindOptions
): Promise<WrapperResult<T[]>>

// Find one document
async findOne(
  filter: Filter<T>,
  options?: MonguardFindOptions
): Promise<WrapperResult<T | null>>

// Count documents
async count(
  filter?: Filter<T>,
  includeSoftDeleted?: boolean
): Promise<WrapperResult<number>>

interface MonguardFindOptions {
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
): Promise<WrapperResult<UpdateResult>>

// Update by ID
async updateById(
  id: ObjectId,
  update: UpdateFilter<T>,
  options?: UpdateOptions
): Promise<WrapperResult<UpdateResult>>

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
): Promise<WrapperResult<UpdateResult | DeleteResult>>

// Delete by ID
async deleteById(
  id: ObjectId,
  options?: DeleteOptions
): Promise<WrapperResult<UpdateResult | DeleteResult>>

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
): Promise<WrapperResult<UpdateResult>>
```

### Result Type

All operations return a `WrapperResult`:

```typescript
interface WrapperResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Usage
const result = await collection.create(userData);
if (result.success) {
  console.log('Created:', result.data);
} else {
  console.error('Error:', result.error);
}
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

### Disabling Audit Logging

```typescript
// Globally disable for collection
const collection = new MonguardCollection<User>(db, 'users', {
  auditCollectionName: 'audit_logs',
  disableAudit: true,
  concurrency: { transactionsEnabled: true }
});

// Skip audit for specific operation
const result = await collection.create(userData, {
  skipAudit: true,
  userContext: { userId: 'admin' }
});
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
const result = await users.restore(
  { _id: userId },
  { userId: 'admin' }
);

// Restore multiple documents
const result = await users.restore(
  { deletedBy: 'old-admin' },
  { userId: 'current-admin' }
);
```

### Hard Deletes

```typescript
// Permanently delete document
const result = await users.deleteById(userId, {
  userContext: { userId: 'admin' },
  hardDelete: true
});
// Document is completely removed from database
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
const result = await users.create({
  name: 'John Doe',
  email: 'john@example.com'
}, {
  userContext: { userId: 'admin-123' }
});

// Result includes user tracking:
// {
//   name: 'John Doe',
//   email: 'john@example.com',
//   createdBy: 'admin-123',
//   updatedBy: 'admin-123',
//   createdAt: Date,
//   updatedAt: Date
// }
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

## Best Practices

### 1. Error Handling

```typescript
// Always check results
const result = await users.create(userData, { userContext });

if (result.success) {
  // Handle success
  console.log('User created:', result.data._id);
} else {
  // Handle error
  console.error('Failed to create user:', result.error);
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
const activeUsers = await users.find({}); // Default: excludes deleted
const allUsers = await users.find({}, { includeSoftDeleted: true });
const deletedUsers = await users.find({ 
  deletedAt: { $exists: true } 
}, { includeSoftDeleted: true });
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
    this.users = new MonguardCollection<User>(db, 'users', {
      auditCollectionName: 'user_audit_logs',
      concurrency: { transactionsEnabled: true }
    });
  }

  async createUser(userData: Omit<User, '_id' | 'createdAt' | 'updatedAt'>, adminId: string) {
    return await this.users.create(userData, {
      userContext: { userId: adminId }
    });
  }

  async deactivateUser(userId: ObjectId, adminId: string) {
    return await this.users.updateById(userId, {
      $set: { isActive: false }
    }, {
      userContext: { userId: adminId }
    });
  }

  async deleteUser(userId: ObjectId, adminId: string, permanent = false) {
    return await this.users.deleteById(userId, {
      userContext: { userId: adminId },
      hardDelete: permanent
    });
  }

  async getActiveUsers() {
    return await this.users.find({ isActive: true });
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
    return await this.users.create({
      ...userData,
      tenantId
    }, {
      userContext: { userId }
    });
  }

  async getTenantUsers(tenantId: string) {
    return await this.users.find({ tenantId });
  }

  async getTenantAuditLogs(tenantId: string) {
    const auditCollection = this.users.getAuditCollection();
    
    // Get all user IDs for the tenant first
    const tenantUsersResult = await this.users.find({ tenantId });
    if (!tenantUsersResult.success) return tenantUsersResult;
    
    const userIds = tenantUsersResult.data.map(user => user._id);
    
    return await auditCollection.find({
      'ref.collection': 'users',
      'ref.id': { $in: userIds }
    }).sort({ timestamp: -1 }).toArray();
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

**Solution**: Ensure consistent id type across collections sharing audit collection:

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
const result = await users.find({}, { 
  limit: 100,
  skip: page * 100,
  sort: { createdAt: -1 }
});
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
    const batchPromises = batch.map(id => 
      users.updateById(id, updateData, { userContext })
    );
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
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
const result = await users.create(userData, { userContext });
if (!result.success) {
  console.error('Operation failed:', {
    error: result.error,
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

