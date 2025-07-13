[>> Table of Contents](/docs/README.md)

# Introduction

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

// Create a user with audit logging and traceId
try {
  const user = await users.create({
    name: 'John Doe',
    email: 'john@example.com'
  }, {
    userContext: { userId: 'admin-123' },
    auditMetadata: {
      traceId: 'req-abc-123',
      customData: { source: 'admin_panel', version: '2.1' }
    }
  });
  
  console.log('User created:', user);
} catch (error) {
  console.error('Failed to create user:', error.message);
}
```

## Core Features

### 🔍 **Audit Logging**
- Automatic tracking of all create, update, and delete operations
- **Request tracing support** with `traceId` for distributed systems
- **Transaction-aware audit control** with in-transaction and outbox modes
- **Flexible error handling** with fail-fast or resilient strategies
- Customizable audit collection names and logger interfaces
- Rich metadata including before/after states and field changes
- **Custom data attachment** for application-specific audit context
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

---
[>> Table of Contents](/docs/README.md)
