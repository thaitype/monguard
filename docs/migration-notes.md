## Migration Notes

### Breaking Changes: Manual Audit Logging API (v0.13.0)

**What Changed**: The `createAuditLog` method now uses an options object instead of individual parameters, and introduces `traceId` support for request tracing.

**Why**: This change provides a cleaner API, supports new request tracing capabilities, and prevents unwieldy parameter lists as more features are added.

**Impact**: 
- **Manual audit logging** calls using the old parameter-based API will break
- **New `traceId` field** is now available in audit logs for request correlation
- **CRUD operations** can now attach custom metadata including `traceId`
- **Enhanced audit metadata** support for better traceability

**Migration Steps**:

1. **Update manual audit logging calls** to use the new options object:
```typescript
// Before
await collection.createAuditLog(
  'custom',
  docId,
  { userId: 'user123' },
  { 
    beforeDocument: oldDoc,
    afterDocument: newDoc,
    customData: { reason: 'bulk_import' }
  },
  { failOnError: true }
);

// After
await collection.createAuditLog({
  action: 'custom',
  documentId: docId,
  userContext: { userId: 'user123' },
  metadata: {
    beforeDocument: oldDoc,
    afterDocument: newDoc,
    customData: { reason: 'bulk_import' },
    traceId: 'trace-12345' // New: Request tracing support
  }
});
```

2. **Use new audit metadata in CRUD operations** for automatic tracing:
```typescript
// New: Attach traceId and custom data to automatic audit logs
const result = await collection.create(document, {
  userContext: { userId: 'user123' },
  auditMetadata: {
    traceId: 'request-trace-456',
    customData: { source: 'api', version: '1.2' }
  }
});

// Works with all operations
await collection.updateById(id, { $set: { status: 'processed' } }, {
  userContext: { userId: 'user123' },
  auditMetadata: {
    traceId: 'request-trace-456',
    customData: { reason: 'scheduled_job' }
  }
});
```

3. **Update TypeScript types** if you were extending manual audit interfaces:
```typescript
// Before
interface CustomManualAudit {
  action: string;
  userId: string;
  // ... individual properties
}

// After - use the new structured options
interface CustomManualAudit extends CreateAuditLogOptions {
  // Your additional custom properties
}
```

**New Features Available**:
- **Request Tracing**: Use `traceId` to correlate audit logs across distributed operations
- **Enhanced Metadata**: Attach custom data to both manual and automatic audit logs
- **Structured API**: Cleaner, more maintainable options object pattern

**Compatibility**: The internal audit logging system remains unchanged - only the public manual audit API has been updated.

---

### Breaking Changes: Audit Log Date Fields (v0.12.0)

**What Changed**: Audit logs now only store a single `timestamp` field instead of redundant `createdAt`, `updatedAt`, and `deletedAt` fields.

**Why**: This change reduces audit log storage by ~40% and eliminates conceptual confusion since audit logs are immutable historical records.

**Impact**: 
- **AuditLogDocument interface** no longer extends BaseDocument
- **Existing audit logs** in your database will have legacy `createdAt`/`updatedAt` fields
- **Code reading audit logs** should use `timestamp` instead of `createdAt`

**Migration Steps**:

1. **Update your code** to use `timestamp` instead of `createdAt`/`updatedAt`:
```typescript
// Before
const auditLog = await auditLogger.getAuditLogs('users', userId);
console.log('Created at:', auditLog[0].createdAt); // ❌ No longer available

// After  
console.log('Action occurred at:', auditLog[0].timestamp); // ✅ Use timestamp
```

2. **Database cleanup** (optional): Remove legacy fields from existing audit logs:
```javascript
// MongoDB shell script to clean up existing audit logs
db.audit_logs.updateMany(
  { createdAt: { $exists: true } },
  { $unset: { createdAt: 1, updatedAt: 1, deletedAt: 1 } }
);
```

3. **Update TypeScript types** if you were explicitly typing audit logs:
```typescript
// Before
interface CustomAuditLog extends AuditLogDocument {
  createdAt: Date; // ❌ No longer available
}

// After
interface CustomAuditLog extends AuditLogDocument {
  timestamp: Date; // ✅ Use timestamp
}
```

**Compatibility**: Legacy audit logs with extra fields will continue to work - only new audit logs will use the streamlined format.

---

For more examples and advanced usage patterns, see the test files in the repository. For issues and feature requests, please visit the GitHub repository.

