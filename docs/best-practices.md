## Best Practices

### 1. Error Handling

```typescript
// Always use try-catch for error handling
try {
  const user = await users.create(userData, { userContext });
  // Handle success
  console.log('User created:', user._id);
} catch (error) {
  // Handle error
  console.error('Failed to create user:', error.message);
  // Log for debugging, show user-friendly message
}
```

### 2. User Context

```typescript
// Always provide user context for audit trails
const userContext = { userId: getCurrentUser().id };

await users.create(userData, { userContext });
await users.updateById(userId, updateData, { userContext });
await users.deleteById(userId, { userContext });
```

### 3. Queries with Soft Deletes

```typescript
// Be explicit about soft delete behavior
try {
  const activeUsers = await users.find({}); // Default: excludes deleted
  const allUsers = await users.find({}, { includeSoftDeleted: true });
  const deletedUsers = await users.find({ 
    deletedAt: { $exists: true } 
  }, { includeSoftDeleted: true });
} catch (error) {
  console.error('Query failed:', error.message);
}
```

### 4. Concurrency Configuration

```typescript
// Choose appropriate strategy for your environment
const config = process.env.NODE_ENV === 'production' 
  ? { transactionsEnabled: true }  // Atlas/Replica Set
  : { transactionsEnabled: false }; // Local development

const collection = new MonguardCollection<User>(db, 'users', {
  auditCollectionName: 'audit_logs',
  concurrency: config
});
```

### 5. Audit Logger Configuration

```typescript
// Use strict validation in production for data integrity
const auditLogger = new MonguardAuditLogger(db, 'audit_logs', {
  refIdConfig: RefIdConfigs.objectId(),
  strictValidation: process.env.NODE_ENV === 'production', // Strict in production
  logger: customLogger  // Always use custom logger for better observability
});

// Custom logger for production monitoring
const productionLogger = {
  warn: (message: string, ...args: any[]) => {
    logger.warn({ message, args, service: 'monguard' });
    metrics.increment('monguard.validation.warning');
  },
  error: (message: string, ...args: any[]) => {
    logger.error({ message, args, service: 'monguard' });
    metrics.increment('monguard.audit.error');
    alerting.notify('audit_logging_failure', { message, args });
  }
};
```

