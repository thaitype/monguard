# 📐 **Design Specification: Audit-Safe MongoDB Wrapper Without Transactions**

## 📌 Overview

This module defines a MongoDB data access wrapper (e.g., `MonguardCollection`) specifically optimized for environments like **Cosmos DB with Mongo API**, where **multi-collection transactions are not available**.

The system is designed to maintain **data integrity**, **audit consistency**, and **safe concurrent operations** (e.g., soft delete, update) without relying on transactional guarantees.

---

## ✅ Key Guarantees

* **No duplicate audit logs**, even in concurrent environments
* **No race-condition-related inconsistencies** (phantom updates or deletes)
* **Idempotent and safe soft delete operations**
* **Safe concurrent updates using optimistic locking**
* **Audit logs always match actual document state transitions**

---

## ⚙️ Core Concepts

### 1. **Optimistic Locking**

Each document must include a `version: number` field.

All `update` and `delete` operations must use the version field in their filter condition. On success, the `version` is incremented:

```ts
{
  _id: ObjectId,
  version: 3,
  ...
}
```

Update condition:

```ts
{ _id, version: 3 }
→
$set: ..., $inc: { version: 1 }
```

This prevents stale writes and ensures only the latest version can be modified.

---

### 2. **Audit Logging**

Audit logs are written **after** each successful operation. They include:

* `action`: "create" | "update" | "delete"
* `before` and/or `after` snapshots (if applicable)
* `changes`: List of fields that changed (on updates)
* `userId`, `timestamp`, and related metadata

Audit logs are **not part of a transaction**, but since they are written last, data always takes precedence. Missing audit logs are acceptable; incorrect ones are not.

---

### 3. **Idempotent Operations**

The wrapper supports an optional `idempotentKey`, especially useful for `create` operations. A unique index can be created on `idempotentKey` to ensure deduplication.

This enables safe retries from clients or services in case of partial failures or network issues.

---

### 4. **Safe Retry Logic**

The client/service should follow a **retry-on-version-mismatch** strategy:

1. Fetch document (read version)
2. Attempt update or delete using current version
3. If update fails due to version mismatch:

   * Re-fetch latest document
   * Re-apply changes
   * Retry with updated version

This approach avoids race conditions while maintaining a stateless, transaction-free backend.
