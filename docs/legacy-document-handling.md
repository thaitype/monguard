[>> Table of Contents](/docs/README.md)

## Legacy Document Handling & Recent Fixes

Monguard seamlessly handles documents created outside the Monguard system or before Monguard was implemented (legacy documents). Recent improvements ensure robust handling of various edge cases and migration scenarios.

### Legacy Documents Without `__v` Field

Documents created directly in MongoDB (outside Monguard) don't have the `__v` version field that Monguard uses for optimistic locking. Monguard now handles these gracefully:

```typescript
// Legacy document in your collection (created outside Monguard):
{
  _id: ObjectId("..."),
  name: "John Doe", 
  email: "john@example.com",
  createdAt: new Date("2023-01-01")
  // Note: No __v field
}

// ✅ Monguard operations now work seamlessly
const users = new MonguardCollection<User>(db, 'users', {
  concurrency: { transactionsEnabled: false } // Optimistic locking
});

// First Monguard operation correctly sets version to 1
const result = await users.updateById(legacyDocId, { 
  $set: { name: 'John Smith' } 
}, { userContext });

console.log('New version:', result.__v); // ✅ 1 (not 2!)

// Document now has proper version tracking:
{
  _id: ObjectId("..."),
  name: "John Smith",
  email: "john@example.com", 
  __v: 1,                    // ✅ Correctly starts at version 1
  updatedAt: new Date(),
  updatedBy: userId
}
```

### Fixed Issues (Recent Improvements)

#### 1. **Version Conflict Resolution**
**Problem**: Legacy documents without `__v` threw "Document was modified by another operation" errors.

**Solution**: Smart version filter that handles both versioned and unversioned documents:
```typescript
// ✅ Now works for both:
await users.updateById(legacyDocId, update);    // Document without __v
await users.updateById(versionedDocId, update); // Document with __v: 5
```

#### 2. **Correct Initial Versioning** 
**Problem**: Legacy documents got version 2 instead of 1 on first Monguard operation.

**Solution**: Fixed initial version calculation:
```typescript
// ❌ Before: Legacy doc → version 2 (incorrect)
// ✅ After:  Legacy doc → version 1 (correct)
```

#### 3. **Delta Mode Stability**
**Problem**: Delta mode unnecessarily fell back to full mode for documents without `__v`.

**Solution**: Delta mode now works consistently:
```typescript
const auditLogger = new MonguardAuditLogger(db, 'audit_logs', {
  storageMode: 'delta'
});

// ✅ Delta mode works for both legacy and versioned documents
await users.updateById(legacyDocId, { $set: { name: 'Updated' } });
// Result: Delta audit log (not fallback to full mode)
```

#### 4. **Empty Changes Optimization**
**Problem**: Audit logs created even when no meaningful changes occurred.

**Solution**: Smart change detection:
```typescript
// ❌ Before: Created audit log even for no-op updates
await users.updateById(docId, { $set: { name: 'Same Name' } });
// Creates audit log with no real changes

// ✅ After: Skips audit logging for empty changes in delta mode
await users.updateById(docId, { $set: { name: 'Same Name' } });
// No audit log created (storage optimization)
```

### Migration Compatibility

Monguard is designed for zero-downtime migration and works with existing MongoDB collections:

```typescript
// ✅ Drop-in replacement for existing MongoDB collections
const users = new MonguardCollection<User>(db, 'existing_users', {
  concurrency: { transactionsEnabled: false }
});

// Works immediately with your existing data:
// - Documents without __v: Start version tracking from 1
// - Documents with timestamps: Preserve existing timestamps  
// - Mixed collections: Handle both legacy and Monguard documents
// - Audit trail: Start logging from first Monguard operation
```

### Best Practices for Legacy Integration

#### Gradual Migration
```typescript
// 1. Start with read operations to verify compatibility
const existingUsers = await users.find({});

// 2. Begin with non-critical update operations
await users.updateById(testUserId, { $set: { lastLogin: new Date() } });

// 3. Gradually adopt full Monguard features
// - Soft deletes
// - User tracking  
// - Audit logging
// - Transaction support
```

#### Monitoring Version Tracking
```typescript
// Monitor version field adoption across your collection
const versionStats = await db.collection('users').aggregate([
  {
    $group: {
      _id: { 
        hasVersion: { $cond: [{ $exists: ["$__v"] }, "versioned", "legacy"] }
      },
      count: { $sum: 1 }
    }
  }
]).toArray();

console.log('Collection version status:', versionStats);
// Result: [
//   { _id: { hasVersion: "legacy" }, count: 1500 },
//   { _id: { hasVersion: "versioned" }, count: 300 }
// ]
```


---

[>> Table of Contents](/docs/README.md)
