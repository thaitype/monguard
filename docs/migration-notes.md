## Migration Notes

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

