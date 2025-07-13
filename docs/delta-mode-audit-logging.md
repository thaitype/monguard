[>> Table of Contents](/docs/README.md)

## Delta Mode Audit Logging

Delta mode is a highly efficient audit logging strategy that stores only the field-level changes instead of full document snapshots, providing **70-90% storage reduction** while maintaining complete audit trail functionality.

### Overview

Traditional audit logging stores complete "before" and "after" document states for every change. Delta mode intelligently tracks only the fields that actually changed, dramatically reducing storage requirements while preserving full audit capabilities.

**Key Benefits:**
- **70-90% storage reduction** for typical update operations
- **Zero breaking changes** - seamlessly upgrade existing installations
- **Smart fallbacks** for complex nested structures
- **Per-operation control** - mix delta and full modes as needed
- **Production-ready** with comprehensive error handling

### Operation-Specific Storage Modes

**IMPORTANT**: Not all operations respect the delta mode setting. MonGuard uses different storage strategies based on the logical requirements of each operation type:

| Operation | Storage Mode | Rationale | Fields Stored |
|-----------|--------------|-----------|---------------|
| **CREATE** | Always **Full** | Only has new document state | `after` (complete document) |
| **UPDATE** | Respects delta/full setting | Has before/after states | `deltaChanges` (delta) or `before`+`after` (full) |
| **DELETE** | Always **Full** | Only has previous document state | `before` (complete document) |

#### Why CREATE and DELETE Always Use Full Mode

```typescript
// ✅ CREATE: Only the new document exists
const newUser = await users.create({
  name: 'John Doe',
  email: 'john@example.com'
}, { userContext });

// Audit log will ALWAYS contain:
{
  action: 'create',
  metadata: {
    storageMode: 'full',        // Always full, regardless of global setting
    after: { /* complete new document */ }
    // No "before" - document didn't exist
    // No "deltaChanges" - nothing to compare against
  }
}

// ✅ DELETE: Only the old document exists  
await users.deleteById(userId, { 
  userContext,
  hardDelete: true 
});

// Audit log will ALWAYS contain:
{
  action: 'delete',
  metadata: {
    storageMode: 'full',        // Always full, regardless of global setting
    before: { /* complete deleted document */ }
    // No "after" - document no longer exists
    // No "deltaChanges" - nothing to compare to
  }
}

// ⚙️ UPDATE: Respects your delta/full mode setting
await users.updateById(userId, { 
  $set: { name: 'Jane Doe' } 
}, { userContext });

// Delta mode audit log:
{
  action: 'update', 
  metadata: {
    storageMode: 'delta',
    deltaChanges: {
      'name': { old: 'John Doe', new: 'Jane Doe' }
    }
    // No before/after in delta mode for storage efficiency
  }
}
```

#### Configuration Override Behavior

```typescript
// ⚠️ storageMode overrides are IGNORED for CREATE and DELETE
await users.create(document, {
  userContext,
  auditControl: { storageMode: 'delta' } // ❌ IGNORED - CREATE always uses full
});

await users.deleteById(id, {
  userContext, 
  hardDelete: true,
  auditControl: { storageMode: 'delta' } // ❌ IGNORED - DELETE always uses full
});

// ✅ storageMode overrides work for UPDATE operations
await users.updateById(id, update, {
  userContext,
  auditControl: { storageMode: 'full' }  // ✅ RESPECTED - Override delta to full
});
```

### Delta Change Semantics: Understanding Undefined vs Null

Delta mode preserves important semantic distinctions between different types of field changes. Understanding these semantics is crucial for correctly interpreting audit logs and building reliable restoration logic.

#### Field Change Types

| Change Type | Example | Delta Structure | Meaning |
|-------------|---------|-----------------|---------|
| **Field Added** | Field didn't exist → Field has value | `{ new: "value" }` | Property omitted means "didn't exist" |
| **Field Removed** | Field had value → Field deleted | `{ old: "value" }` | Property omitted means "no longer exists" |
| **Field Set to Null** | Field had value → Field explicitly nulled | `{ old: "value", new: null }` | Explicit `null` means "intentionally empty" |
| **Field Changed** | Value A → Value B | `{ old: "A", new: "B" }` | Standard value change |

#### Important: MonGuard Undefined Value Handling

MonGuard explicitly removes `undefined` `old` and `new` properties from delta changes before storing in MongoDB. This **intentional cleaning** maintains semantic correctness and ensures clear field change meanings:

```typescript
// ✅ Field added (before: didn't exist, after: has value)
{
  action: 'update',
  metadata: {
    deltaChanges: {
      'email': { new: 'john@example.com' }
      // No 'old' property = field was added
    }
  }
}

// ✅ Field removed (before: had value, after: doesn't exist)  
{
  action: 'update',
  metadata: {
    deltaChanges: {
      'email': { old: 'john@example.com' }
      // No 'new' property = field was removed
    }
  }
}

// ✅ Field explicitly set to null (before: had value, after: intentionally null)
{
  action: 'update', 
  metadata: {
    deltaChanges: {
      'email': { old: 'john@example.com', new: null }
      // Both properties present = intentional null assignment
    }
  }
}
```

#### How MonGuard Processes Delta Changes

MonGuard uses a focused approach to handle undefined values in delta changes:

```typescript
// Internal processing: MonGuard's cleanDeltaChanges method
// Input from delta calculator:
const rawDeltaChanges = {
  'email': { old: undefined, new: 'john@example.com' },
  'name': { old: 'John', new: 'Jane' },
  'phone': { old: '123-456', new: undefined }
};

// After MonGuard cleaning (before MongoDB storage):
const cleanedDeltaChanges = {
  'email': { new: 'john@example.com' },        // 'old' removed
  'name': { old: 'John', new: 'Jane' },        // unchanged
  'phone': { old: '123-456' }                  // 'new' removed
};
```

**Key Implementation Details:**

- **Scope**: Only cleans top-level `old`/`new` properties in delta changes
- **Method**: Uses `cleanDeltaChanges()` method in the audit logger
- **Timing**: Cleaning happens before sending to MongoDB
- **Nested Objects**: MongoDB handles nested object serialization naturally
- **Performance**: Simple, non-recursive approach for better performance

#### Restoration Logic Examples

```typescript
// Correctly interpret delta changes for restoration
function applyDeltaChange(document: any, fieldPath: string, change: any) {
  if ('old' in change && !('new' in change)) {
    // Field was removed - restore by adding it back
    setNestedField(document, fieldPath, change.old);
  } else if (!('old' in change) && 'new' in change) {
    // Field was added - restore by removing it
    deleteNestedField(document, fieldPath);
  } else if ('old' in change && 'new' in change) {
    if (change.new === null) {
      // Field was set to null - restore original value
      setNestedField(document, fieldPath, change.old);
    } else {
      // Field was changed - restore old value
      setNestedField(document, fieldPath, change.old);
    }
  }
}
```

#### Array Element Semantics

Arrays follow the same semantic principles:

```typescript
// Array element added: tags[2] didn't exist → now has value
{
  'tags.2': { new: 'verified' }
  // No 'old' property = element was added at index 2
}

// Array element removed: tags[2] had value → now doesn't exist
{
  'tags.2': { old: 'editor' }
  // No 'new' property = element at index 2 was removed  
}

// Array element changed: tags[1] changed value
{
  'tags.1': { old: 'editor', new: 'premium' }
  // Both properties = element value changed
}
```

### Configuration

#### Global Delta Mode Configuration

```typescript
import { MonguardAuditLogger } from 'monguard';

const auditLogger = new MonguardAuditLogger(db, 'audit_logs', {
  // Core delta mode settings
  storageMode: 'delta',         // 'full' | 'delta' (default: 'full')
  
  // Delta computation options
  maxDepth: 3,                  // Max nesting depth for field-wise diff (default: 3)
  arrayHandling: 'diff',        // 'diff' | 'replace' (default: 'diff')
  arrayDiffMaxSize: 20,         // Max array size for element-wise diff (default: 20)
  
  // Fields to exclude from delta computation
  blacklist: [
    'createdAt', 'updatedAt', 'createdBy', 'updatedBy', '__v',
    'meta.*',                   // Wildcard patterns supported
    'internal.cache'            // Exact field paths
  ]
});

const users = new MonguardCollection<User>(db, 'users', {
  auditLogger,
  concurrency: { transactionsEnabled: true }
});
```

#### Per-Operation Mode Override

```typescript
// Force full mode for a specific operation
await users.update(filter, update, {
  userContext,
  auditControl: { storageMode: 'full' }  // Override global delta mode
});

// Use delta mode even when global default is 'full'
await users.update(filter, update, {
  userContext,
  auditControl: { storageMode: 'delta' } // Override global full mode
});

// Note: CREATE and DELETE operations always use full mode (logical requirement)
await users.create(document, {
  userContext,
  auditControl: { storageMode: 'delta' } // Will be ignored - CREATE always uses full
});
```

### Data Structure Comparison

#### Traditional Full Mode Audit Log
```typescript
{
  _id: ObjectId,
  action: 'UPDATE',
  ref: { collection: 'users', id: ObjectId },
  userId: ObjectId,
  timestamp: Date,
  metadata: {
    storageMode: 'full',
    before: {
      _id: ObjectId,
      name: 'John Doe',
      email: 'john@example.com',
      profile: {
        address: { city: 'Bangkok', country: 'Thailand' },
        preferences: { theme: 'dark', language: 'en' }
      },
      tags: ['user', 'editor', 'active'],
      // ... potentially hundreds of other fields
    },
    after: {
      _id: ObjectId,
      name: 'Jane Doe',        // Only this changed
      email: 'john@example.com',
      profile: {
        address: { city: 'Bangkok', country: 'Thailand' },
        preferences: { theme: 'dark', language: 'en' }
      },
      tags: ['user', 'editor', 'active'],
      // ... same hundreds of other fields
    }
  }
}
```

#### Delta Mode Audit Log (70-90% smaller)
```typescript
{
  _id: ObjectId,
  action: 'UPDATE', 
  ref: { collection: 'users', id: ObjectId },
  userId: ObjectId,
  timestamp: Date,
  metadata: {
    storageMode: 'delta',
    deltaChanges: {
      'name': { old: 'John Doe', new: 'Jane Doe' }  // Only the changed field!
    }
    // Optional: keep before/after for debugging (can be removed for maximum savings)
  }
}
```

### Advanced Delta Features

#### Nested Object Changes
```typescript
// Document update
await users.update(filter, {
  $set: { 
    'profile.address.city': 'Chiang Mai',
    'profile.preferences.theme': 'light'
  }
});

// Resulting delta audit log
{
  metadata: {
    storageMode: 'delta',
    deltaChanges: {
      'profile.address.city': { old: 'Bangkok', new: 'Chiang Mai' },
      'profile.preferences.theme': { old: 'dark', new: 'light' }
    }
  }
}
```

#### Smart Array Handling
```typescript
// Small arrays: element-wise diff
{
  deltaChanges: {
    'tags.1': { old: 'editor', new: 'premium' },     // Array index changes
    'tags.3': { old: undefined, new: 'verified' }    // New array element
  }
}

// Large arrays: full replacement with indicator
{
  deltaChanges: {
    'hobbies': { 
      old: [...], 
      new: [...], 
      fullDocument: true    // Array too large for element-wise diff
    }
  }
}
```

#### Automatic Fallbacks

Delta mode includes smart fallbacks to ensure audit reliability:

```typescript
// Configuration with fallback triggers
const auditLogger = new MonguardAuditLogger(db, 'audit_logs', {
  storageMode: 'delta',
  maxDepth: 3,              // Fallback to full mode beyond 3 levels deep
  arrayDiffMaxSize: 20,     // Fallback to full array replacement for arrays > 20 elements
  blacklist: ['meta.*']     // Skip complex metadata fields
});
```

**Fallback scenarios:**
- **Deep nesting exceeds maxDepth** → Full document mode for that field
- **Arrays exceed arrayDiffMaxSize** → Full array replacement with `fullDocument: true`
- **Computation errors** → Graceful fallback to full mode
- **Circular references** → Automatic detection and fallback

### Migration from Full Mode

#### Zero-Downtime Migration

```typescript
// Step 1: Enable delta mode (backward compatible)
const auditLogger = new MonguardAuditLogger(db, 'audit_logs', {
  storageMode: 'delta'  // Existing full mode logs remain intact
});

// Step 2: Mixed mode operation (optional transition period)
await users.update(filter, update, {
  userContext,
  auditControl: { storageMode: 'full' }  // Still use full mode for critical operations
});

// Step 3: Full delta mode (when ready)
// All new audit logs use delta mode automatically
```

#### Querying Mixed Mode Audit Logs

```typescript
// Query works for both delta and full mode logs
const auditLogs = await auditLogger.getAuditLogs('users', userId);

auditLogs.forEach(log => {
  if (log.metadata?.storageMode === 'delta') {
    // Access field-level changes
    const changes = log.metadata.deltaChanges;
    console.log('Changed fields:', Object.keys(changes));
  } else {
    // Traditional full mode access
    const changes = log.metadata?.changes || [];
    console.log('Changed fields:', changes);
  }
});
```

### Performance Characteristics

#### Storage Efficiency
- **70-90% reduction** in audit log size for typical update operations
- **Minimal overhead** for CREATE/DELETE (always use full mode)
- **Smart memory usage** with no document caching during computation

#### Computational Performance
- **1-2ms overhead** per operation for delta computation
- **Optimized for high-throughput** scenarios with many small updates
- **Configurable limits** prevent performance degradation on complex documents

#### Scalability Benefits
```typescript
// High-frequency updates scenario
for (let i = 0; i < 10000; i++) {
  await users.updateById(userId, { 
    $set: { lastActive: new Date() }    // Only timestamps change
  });
  // Delta mode: ~50 bytes per audit log vs ~5KB in full mode
  // Result: 500KB total vs 50MB total storage
}
```

### Best Practices

#### Storage Mode Selection Guide

| Scenario | Recommended Mode | Reasoning | Expected Reduction |
|----------|------------------|-----------|-------------------|
| **E-commerce products** | `delta` | Frequent price/inventory updates | 85-95% |
| **User profiles** | `delta` | Occasional field updates | 70-90% |
| **Financial records** | `full` | Regulatory compliance needs | N/A (audit completeness) |
| **System logs** | `delta` | High volume, small changes | 90-98% |
| **Document management** | `full` | Complete version history needed | N/A (business requirement) |
| **IoT sensor data** | `delta` | Continuous small updates | 95-99% |
| **Configuration files** | `full` | Infrequent but critical changes | N/A (change significance) |

#### Configuration Matrix

| Use Case | Storage Mode | Max Depth | Array Handling | Array Max Size | Blacklist Strategy |
|----------|-------------|-----------|----------------|----------------|--------------------|
| **High Performance** | `delta` | `2` | `replace` | `10` | Aggressive |
| **Balanced** | `delta` | `3` | `diff` | `20` | Moderate |
| **Maximum Detail** | `delta` | `5` | `diff` | `50` | Minimal |
| **Compliance/Audit** | `full` | N/A | N/A | N/A | None |

#### Environment-Specific Configurations

```typescript
// High-throughput production (e-commerce, social media)
const highThroughputConfig = {
  storageMode: 'delta' as const,
  maxDepth: 2,                    // Fast processing
  arrayHandling: 'replace' as const, // Avoid expensive array diffs
  arrayDiffMaxSize: 10,           // Small threshold for arrays
  blacklist: [
    'lastAccessed', 'viewCount', 'hitCounter', 'sessionData',
    'cache.*', 'temp.*', 'meta.analytics.*'
  ]
};

// Balanced production (most applications)
const balancedConfig = {
  storageMode: 'delta' as const,
  maxDepth: 3,                    // Good detail vs performance
  arrayHandling: 'diff' as const,   // Track array changes
  arrayDiffMaxSize: 20,           // Reasonable array threshold
  blacklist: [
    'updatedAt', 'createdAt', '__v',
    'meta.internal.*', 'cache.*'
  ]
};

// Compliance/financial (detailed audit trails)
const complianceConfig = {
  storageMode: 'full' as const,   // Complete audit records
  maxDepth: 10,                   // Deep inspection (not used in full mode)
  arrayHandling: 'diff' as const,   // Not used in full mode
  arrayDiffMaxSize: 100,          // Not used in full mode
  blacklist: []                   // Track everything
};

// Development/testing
const devConfig = {
  storageMode: 'delta' as const,
  maxDepth: 5,                    // Detailed for debugging
  arrayHandling: 'diff' as const,
  arrayDiffMaxSize: 50,
  blacklist: ['meta.debug.*']     // Minimal exclusions
};
```

#### Per-Operation Strategy Patterns

```typescript
// Pattern 1: Operation-specific overrides
async function handleCriticalUserUpdate(userId: ObjectId, changes: any) {
  return await users.updateById(userId, changes, {
    userContext,
    auditControl: { storageMode: 'full' }  // Override delta for critical ops
  });
}

// Pattern 2: Data sensitivity-based routing
async function updateUserData(userId: ObjectId, changes: any, isSensitive: boolean) {
  const auditControl = isSensitive 
    ? { storageMode: 'full' as const }     // Sensitive: full audit
    : { storageMode: 'delta' as const };   // Regular: efficient delta
    
  return await users.updateById(userId, changes, { userContext, auditControl });
}

// Pattern 3: Bulk operation optimization
async function performBulkUpdates(updates: BulkUpdate[]) {
  return Promise.all(updates.map(update => 
    users.updateById(update.id, update.changes, {
      userContext,
      auditControl: { storageMode: 'delta' }  // Optimize bulk operations
    })
  ));
}

// Pattern 4: Migration-friendly approach
async function migrationSafeUpdate(docId: ObjectId, changes: any) {
  // Use full mode during migrations for complete audit trail
  const auditMode = process.env.MIGRATION_MODE === 'true' ? 'full' : 'delta';
  
  return await collection.updateById(docId, changes, {
    userContext,
    auditControl: { storageMode: auditMode }
  });
}
```

#### Performance Optimization Table

| Optimization | Setting | Impact | Use When |
|-------------|---------|--------|----------|
| **Shallow Diffing** | `maxDepth: 1-2` | 🚀 Fastest | Flat document structures |
| **Array Replacement** | `arrayHandling: 'replace'` | ⚡ Fast for large arrays | Arrays change completely |
| **Small Array Threshold** | `arrayDiffMaxSize: 5-10` | 🏃 Quick processing | Small arrays only |
| **Aggressive Blacklist** | Many excluded fields | 💨 Skip irrelevant fields | High-frequency updates |
| **Conservative Blacklist** | Few excluded fields | 🔍 Detailed tracking | Important business data |

#### Monitoring and Alerting

```typescript
// Monitor delta mode effectiveness
interface DeltaModeMetrics {
  avgStorageReduction: number;    // % reduction vs full mode
  avgProcessingTime: number;      // ms per operation
  fallbackRate: number;           // % falling back to full mode
  changeComplexity: number;       // avg fields changed per operation
}

// Alert on unexpected patterns
function monitorDeltaMode(logs: AuditLogDocument[]) {
  const deltaLogs = logs.filter(log => log.metadata?.storageMode === 'delta');
  const fullLogs = logs.filter(log => log.metadata?.storageMode === 'full');
  
  if (deltaLogs.length / logs.length < 0.7) {
    console.warn('⚠️ Low delta mode usage - check configuration');
  }
  
  if (fullLogs.some(log => log.action === 'update')) {
    console.warn('⚠️ UPDATE operations using full mode - investigate');
  }
}
```

### Troubleshooting

#### Common Issues

**Q: Delta changes not appearing in audit logs**
```typescript
// Check configuration
const auditLogger = new MonguardAuditLogger(db, 'audit_logs', {
  storageMode: 'delta',  // ✅ Ensure delta mode is enabled
  blacklist: []          // ✅ Check blacklist doesn't exclude your fields
});
```

**Q: Unexpected full mode fallbacks**
```typescript
// Check depth and array size limits
{
  maxDepth: 5,           // ✅ Increase if you have deep nesting
  arrayDiffMaxSize: 50   // ✅ Increase for larger arrays
}
```

**Q: Performance issues with delta computation**
```typescript
// Optimize configuration for your use case
{
  maxDepth: 2,           // ✅ Reduce for faster computation
  blacklist: [           // ✅ Exclude expensive fields
    'complexMetadata.*',
    'largeArrayField'
  ]
}
```

#### Monitoring Delta Mode Performance

```typescript
// Log delta vs full mode usage
auditLogger.on('audit-logged', (log) => {
  const mode = log.metadata?.storageMode || 'full';
  metrics.increment(`audit.mode.${mode}`);
  
  if (mode === 'delta') {
    const changeCount = Object.keys(log.metadata.deltaChanges || {}).length;
    metrics.histogram('audit.delta.changes', changeCount);
  }
});
```

---

[>> Table of Contents](/docs/README.md)