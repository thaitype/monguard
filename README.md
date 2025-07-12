# 🛡️ monguard – The Guardian of Your MongoDB Records

[![CI](https://github.com/thaitype/monguard/actions/workflows/main.yml/badge.svg)](https://github.com/thaitype/monguard/actions/workflows/main.yml) [![codecov](https://codecov.io/gh/thaitype/monguard/graph/badge.svg?token=B7MCHM57BH)](https://codecov.io/gh/thaitype/monguard) [![NPM Version](https://img.shields.io/npm/v/monguard) ](https://www.npmjs.com/package/monguard)[![npm downloads](https://img.shields.io/npm/dt/monguard)](https://www.npmjs.com/package/monguard) 

> Note: This is early stage of development, the API is subject to change. Please report any issues or suggestions. 
> Don't use in production yet.

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


For more examples and advanced usage patterns, see the test files in the repository. For issues and feature requests, please visit the GitHub repository.

## Documentation

- [Monguard Full Documentation](packages/monguard/README.md)

## License

MIT License © 2025
Created by [@thaitype](https://github.com/thaitype)

