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

#### Legacy Document Issues

**Problem**: "Document was modified by another operation" errors on existing documents

**Symptoms**:
- Errors when updating documents that existed before Monguard implementation
- Version conflict errors on documents without `__v` field
- Unexpected behavior when migrating existing collections

**Solution**: These errors occur when documents don't have the `__v` version field. Monguard now handles this automatically:

```typescript
// ✅ Works automatically - no configuration needed
const users = new MonguardCollection<User>(db, 'existing_collection', {
  concurrency: { transactionsEnabled: false } // Use optimistic locking
});

// These operations now work seamlessly on legacy documents
await users.updateById(legacyDocId, { $set: { status: 'active' } });
await users.deleteById(legacyDocId, { userContext });
```

**Problem**: Documents get incorrect initial version (2 instead of 1)

**Solution**: Fixed in recent versions. Legacy documents now correctly start at version 1:

```typescript
// ✅ Legacy document → version 1 (correct)
const result = await users.updateById(legacyDocId, update);
console.log('First version:', result.__v); // 1 (not 2)
```

**Problem**: Delta mode unexpectedly falls back to full mode

**Symptoms**:
- Delta audit logs showing `storageMode: 'full'` instead of `storageMode: 'delta'`
- Larger than expected audit log storage
- Inconsistent delta mode behavior

**Solution**: Recent fixes ensure delta mode works consistently:

```typescript
// ✅ Delta mode now works for both legacy and versioned documents
const auditLogger = new MonguardAuditLogger(db, 'audit_logs', {
  storageMode: 'delta'
});

// Both create delta audit logs consistently
await users.updateById(legacyDocId, update);    // Legacy doc → delta log
await users.updateById(versionedDocId, update); // Versioned doc → delta log
```

**Problem**: Unnecessary audit logs for empty changes

**Symptoms**:
- Audit logs created when no meaningful data changes
- Storage bloat from infrastructure-only changes (timestamps, version increments)
- Audit logs for no-op operations

**Solution**: Smart change detection now skips empty changes in delta mode:

```typescript
// ✅ No audit log created for same-value updates
await users.updateById(docId, { $set: { name: existingName } });
// Result: No audit log (optimization)

// ✅ Audit log created only for meaningful changes  
await users.updateById(docId, { $set: { name: newName } });
// Result: Delta audit log with actual changes
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

