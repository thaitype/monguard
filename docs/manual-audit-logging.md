# Manual Audit Logging & Auto-Field Control

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
await collection.createAuditLog({
  action: 'custom',
  documentId: new ObjectId('60f1e2b3c4d5e6f7a8b9c0d1'),
  userContext: { userId: 'user123' },
  metadata: {
    beforeDocument: { name: 'Old Name', status: 'pending' },
    afterDocument: { name: 'New Name', status: 'approved' },
    customData: { 
      reason: 'bulk_approval',
      batchId: 'batch-001',
      externalSystemId: 'ext-12345'
    },
    traceId: 'trace-abc-123'
  }
});

// Create audit log for manual restore operation
await collection.createAuditLog({
  action: 'restore',
  documentId,
  userContext: { userId: 'admin456' },
  metadata: {
    beforeDocument: { name: 'John', deletedAt: new Date(), deletedBy: 'old-admin' },
    afterDocument: { name: 'John', deletedAt: undefined, deletedBy: undefined },
    customData: { reason: 'data_recovery', ticket: 'SUPPORT-123' },
    traceId: 'restore-def-456'
  }
});

// Simple audit log without metadata
await collection.createAuditLog({
  action: 'create',
  documentId,
  userContext: { userId: 'system' }
});
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
