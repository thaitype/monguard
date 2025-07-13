[>> Table of Contents](/docs/README.md)


## Audit Logging

Monguard provides comprehensive audit logging with two storage modes:
- **Full Mode** (default): Stores complete before/after document states
- **Delta Mode**: Stores only field-level changes, providing 70-90% storage reduction

> 💡 **Tip**: For high-efficiency audit logging, see [Delta Mode Audit Logging](#delta-mode-audit-logging) section below.

### Audit Log Structure

```typescript
interface AuditLogDocument {
  _id: any;
  ref: {
    collection: string;
    id: any; // ID of the affected document
  };
  action: 'create' | 'update' | 'delete';
  userId?: any; // User who performed the action
  timestamp: Date;
  createdAt: Date;
  updatedAt: Date;
  metadata?: {
    before?: any;      // Document state before change (update/delete)
    after?: any;       // Document state after change (create/update)
    changes?: string[]; // Changed field names (update)
    softDelete?: boolean;
    hardDelete?: boolean;
  };
}
```

### Custom Audit Logger Configuration

Monguard supports advanced audit logger configuration for custom logging and reference ID validation:

```typescript
import { MonguardAuditLogger, RefIdConfigs } from 'monguard';

// Custom logger interface
interface Logger {
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}

// Custom logger implementation
const customLogger: Logger = {
  warn: (message, ...args) => {
    // Send to your logging service
    myLoggingService.warn(message, ...args);
  },
  error: (message, ...args) => {
    // Send to your error tracking service
    myErrorTracker.error(message, ...args);
  }
};

// Create audit logger with custom configuration
const auditLogger = new MonguardAuditLogger(db, 'audit_logs', {
  refIdConfig: RefIdConfigs.objectId(), // Validate ObjectId types
  logger: customLogger,                  // Use custom logger
  strictValidation: true                 // Throw errors on validation failures
});

// Use with MonguardCollection
const users = new MonguardCollection<User>(db, 'users', {
  auditLogger: auditLogger,
  concurrency: { transactionsEnabled: true }
});
```

### Reference ID Validation

Ensure consistent reference ID types in audit logs:

```typescript
// Pre-configured reference ID validators
const configs = {
  objectId: RefIdConfigs.objectId(),  // MongoDB ObjectId validation
  string: RefIdConfigs.string(),      // String ID validation  
  number: RefIdConfigs.number()       // Numeric ID validation
};

// Custom reference ID configuration
const customRefIdConfig = {
  validateRefId: (refId: any): refId is string => {
    return typeof refId === 'string' && refId.length > 0;
  },
  typeName: 'non-empty-string',
  convertRefId: (documentId: any) => documentId.toString()
};

const auditLogger = new MonguardAuditLogger(db, 'audit_logs', {
  refIdConfig: customRefIdConfig,
  strictValidation: false,  // Warn instead of throwing
  logger: customLogger
});
```

### Strict Validation Modes

Control how reference ID validation failures are handled:

```typescript
// Strict mode: Throw errors on validation failures
const strictLogger = new MonguardAuditLogger(db, 'audit_logs', {
  refIdConfig: RefIdConfigs.objectId(),
  strictValidation: true,  // Throws errors
  logger: customLogger
});

// Lenient mode: Warn on validation failures but continue
const lenientLogger = new MonguardAuditLogger(db, 'audit_logs', {
  refIdConfig: RefIdConfigs.objectId(), 
  strictValidation: false, // Logs warnings (default)
  logger: customLogger
});

try {
  // This will throw an error in strict mode if ID is wrong type
  await strictLogger.logOperation('create', 'users', 'invalid-objectid');
} catch (error) {
  console.error('Validation failed:', error.message);
  // Error: Invalid reference ID type for audit log. Expected ObjectId, got: string
}
```

### Disable audit logging

By default, will not log any audit logs

```typescript
const users = new MonguardCollection<User>(db, 'users', {
  concurrency: { transactionsEnabled: true }
});

// All operations will skip audit logging
await users.create(userData); // No audit log created
```

---
[>> Table of Contents](/docs/README.md)
