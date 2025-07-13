[>> Table of Contents](/docs/README.md)

## Configuration

### MonguardCollectionOptions

```typescript
interface MonguardCollectionOptions {
  // Optional: Custom audit logger instance
  auditLogger?: AuditLogger;

  // Required: Concurrency configuration
  concurrency: MonguardConcurrencyConfig;

  // Optional: Auto-field control configuration
  autoFieldControl?: AutoFieldControlOptions;

  // Optional: Audit control configuration
  auditControl?: AuditControlOptions;
}

interface MonguardConcurrencyConfig {
  transactionsEnabled: boolean;
  retryAttempts?: number; // Default: 3 (optimistic strategy only)
  retryDelayMs?: number;  // Default: 100ms (optimistic strategy only)
}

interface AutoFieldControlOptions {
  enableAutoTimestamps?: boolean;        // Default: true
  enableAutoUserTracking?: boolean;      // Default: true
  customTimestampProvider?: () => Date;  // Default: () => new Date()
}

interface AuditControlOptions {
  enableAutoAudit?: boolean;        // Default: true
  auditCustomOperations?: boolean;  // Default: false
  
  // Transaction-aware audit control options
  mode?: 'inTransaction' | 'outbox';  // Default: 'inTransaction'
  failOnError?: boolean;              // Default: false
  logFailedAttempts?: boolean;        // Default: false
}
```

### Configuration Examples

#### MongoDB Replica Set/Atlas
```typescript
const collection = new MonguardCollection<User>(db, 'users', {
  concurrency: { transactionsEnabled: true }
});
```

#### MongoDB Standalone/Cosmos DB
```typescript
const collection = new MonguardCollection<User>(db, 'users', {
  concurrency: { 
    transactionsEnabled: false,
    retryAttempts: 5,
    retryDelayMs: 200
  }
});
```

#### With Manual Control Options
```typescript
const collection = new MonguardCollection<User>(db, 'users', {
  concurrency: { transactionsEnabled: true },
  autoFieldControl: {
    enableAutoTimestamps: true,
    enableAutoUserTracking: true,
    customTimestampProvider: () => new Date()
  },
  auditControl: {
    enableAutoAudit: true,
    auditCustomOperations: true,
    mode: 'inTransaction',        // Strong consistency
    failOnError: false,           // Graceful degradation
    logFailedAttempts: true       // Monitor audit health
  }
});
```

#### External System Integration Setup
```typescript
// Configuration for external system integration
const collection = new MonguardCollection<User>(db, 'users', {
  concurrency: { transactionsEnabled: true },
  autoFieldControl: {
    enableAutoTimestamps: false,  // Manual control over timestamps
    enableAutoUserTracking: true
  },
  auditControl: {
    enableAutoAudit: false,       // Manual audit logging only
    auditCustomOperations: true
  }
});
```

#### Migration-Friendly Configuration
```typescript
// Configuration for data migration scenarios
const collection = new MonguardCollection<User>(db, 'users', {
  concurrency: { transactionsEnabled: true },
  autoFieldControl: {
    enableAutoTimestamps: false,  // Preserve original timestamps
    enableAutoUserTracking: false // Preserve original user fields
  },
  auditControl: {
    enableAutoAudit: false,       // Create custom audit logs
    auditCustomOperations: true
  }
});
```







---

[>> Table of Contents](/docs/README.md)
