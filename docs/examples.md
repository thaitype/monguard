[>> Table of Contents](/docs/README.md)

## Examples

### Mixed Storage Mode Examples

These examples demonstrate how CREATE, UPDATE, and DELETE operations use different storage modes in audit logs:

#### Global Delta Mode with Operation-Specific Behavior

```typescript
import { MonguardAuditLogger, MonguardCollection } from 'monguard';

// Configure global delta mode
const auditLogger = new MonguardAuditLogger(db, 'audit_logs', {
  storageMode: 'delta'  // Global delta mode setting
});

const users = new MonguardCollection<User>(db, 'users', {
  auditLogger,
  concurrency: { transactionsEnabled: false }
});

const userContext = { userId: 'admin123' };

// 1. CREATE - Always uses FULL mode (ignores global delta setting)
const newUser = await users.create({
  name: 'John Doe',
  email: 'john@example.com'
}, { userContext });

// Audit log structure for CREATE:
// {
//   action: 'create',
//   metadata: {
//     storageMode: 'full',                    // ✅ Always full
//     after: { name: 'John Doe', email: '...', _id: '...' }
//   }
// }

// 2. UPDATE - Respects global delta setting
await users.updateById(newUser._id, {
  $set: { name: 'Jane Doe' }
}, { userContext });

// Audit log structure for UPDATE (delta mode):
// {
//   action: 'update',
//   metadata: {
//     storageMode: 'delta',                   // ✅ Uses delta mode
//     deltaChanges: {
//       'name': { old: 'John Doe', new: 'Jane Doe' }
//     }
//   }
// }

// 3. DELETE - Always uses FULL mode (ignores global delta setting)
await users.deleteById(newUser._id, {
  userContext,
  hardDelete: true
});

// Audit log structure for DELETE:
// {
//   action: 'delete',
//   metadata: {
//     storageMode: 'full',                    // ✅ Always full
//     before: { name: 'Jane Doe', email: '...', _id: '...' }
//   }
// }
```

#### Per-Operation Storage Mode Overrides

```typescript
// Global full mode with selective delta overrides
const fullModeLogger = new MonguardAuditLogger(db, 'audit_logs', {
  storageMode: 'full'  // Global full mode
});

const collection = new MonguardCollection<Document>(db, 'documents', {
  auditLogger: fullModeLogger,
  concurrency: { transactionsEnabled: true }
});

// CREATE - Always full (override ignored)
await collection.create(document, {
  userContext,
  auditControl: { storageMode: 'delta' }  // ❌ Ignored
});
// Result: Full mode audit log

// UPDATE - Override to delta mode
await collection.updateById(docId, update, {
  userContext,
  auditControl: { storageMode: 'delta' }  // ✅ Respected
});
// Result: Delta mode audit log

// DELETE - Always full (override ignored)
await collection.deleteById(docId, {
  userContext,
  hardDelete: true,
  auditControl: { storageMode: 'delta' }  // ❌ Ignored
});
// Result: Full mode audit log
```

#### Storage Efficiency Comparison

```typescript
// Demonstrating storage differences between modes
async function demonstrateStorageEfficiency() {
  const user = { 
    _id: new ObjectId(),
    name: 'John Doe',
    email: 'john@example.com',
    profile: {
      address: { city: 'Bangkok', country: 'Thailand' },
      preferences: { theme: 'dark', language: 'en' },
      settings: { notifications: true, privacy: 'public' }
    },
    tags: ['user', 'editor', 'active'],
    metadata: { /* 50+ fields */ }
  };

  // Update only the name field
  await users.updateById(user._id, {
    $set: { name: 'Jane Doe' }
  }, { userContext });

  // Full mode audit log size: ~2KB (entire before + after documents)
  // {
  //   metadata: {
  //     storageMode: 'full',
  //     before: { /* entire 2KB document */ },
  //     after: { /* entire 2KB document */ }
  //   }
  // }

  // Delta mode audit log size: ~50 bytes (only the change)
  // {
  //   metadata: {
  //     storageMode: 'delta',
  //     deltaChanges: {
  //       'name': { old: 'John Doe', new: 'Jane Doe' }
  //     }
  //   }
  // }
  
  console.log('Storage reduction: ~97% (50 bytes vs 4KB)');
}
```

#### Mixed Mode Audit Analysis

```typescript
// Analyzing audit logs with mixed storage modes
async function analyzeAuditLogs(userId: ObjectId) {
  const auditCollection = users.getAuditCollection();
  const logs = await auditCollection.find({
    'ref.id': userId
  }).sort({ timestamp: 1 }).toArray();

  logs.forEach((log, index) => {
    const mode = log.metadata?.storageMode;
    console.log(`${index + 1}. ${log.action} - ${mode} mode`);
    
    if (mode === 'delta' && log.metadata?.deltaChanges) {
      const changedFields = Object.keys(log.metadata.deltaChanges);
      console.log(`   Changed fields: ${changedFields.join(', ')}`);
    } else if (mode === 'full') {
      if (log.action === 'create') {
        console.log(`   New document created`);
      } else if (log.action === 'delete') {
        console.log(`   Document deleted`);
      } else {
        console.log(`   Full document comparison available`);
      }
    }
  });
}

// Example output:
// 1. create - full mode
//    New document created
// 2. update - delta mode
//    Changed fields: name, updatedAt
// 3. update - delta mode
//    Changed fields: email
// 4. delete - full mode
//    Document deleted
```

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

---

[>> Table of Contents](/docs/README.md)