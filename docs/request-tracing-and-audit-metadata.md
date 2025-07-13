[>> Table of Contents](/docs/README.md)


## Request Tracing and Audit Metadata

Monguard supports request tracing and custom audit metadata for CRUD operations, enabling you to track operations across distributed systems and add application-specific context to audit logs.

### CRUD Operations with Audit Metadata

All CRUD operations accept an `auditMetadata` option that includes `traceId` and `customData`:

```typescript
// Create with traceId and custom data
const user = await collection.create({
  name: 'Alice Johnson',
  email: 'alice@example.com'
}, {
  userContext: { userId: 'api-user-123' },
  auditMetadata: {
    traceId: 'req-abc-123',
    customData: {
      source: 'mobile_app',
      version: '2.1.0',
      feature: 'user_registration'
    }
  }
});

// Update with traceId
await collection.updateById(userId, {
  lastLogin: new Date(),
  status: 'active'
}, {
  userContext: { userId: 'system' },
  auditMetadata: {
    traceId: 'req-def-456',
    customData: {
      trigger: 'login_event',
      ipAddress: '192.168.1.100',
      userAgent: 'Mozilla/5.0...'
    }
  }
});

// Delete with traceId
await collection.deleteById(userId, {
  userContext: { userId: 'admin-789' },
  auditMetadata: {
    traceId: 'req-ghi-789',
    customData: {
      reason: 'gdpr_request',
      ticketId: 'GDPR-2023-001',
      approvedBy: 'legal-team'
    }
  }
});
```

### Audit Log Structure with TraceId

When using `auditMetadata`, your audit logs will include the traceId at the top level and custom data in the metadata:

```typescript
// Example audit log document
{
  _id: ObjectId('...'),
  ref: {
    collection: 'users',
    id: ObjectId('...')
  },
  action: 'update',
  userId: 'api-user-123',
  timestamp: ISODate('2023-10-15T10:30:00Z'),
  traceId: 'req-def-456',  // 🎯 Top-level traceId for easy indexing
  metadata: {
    before: { name: 'Alice', status: 'pending' },
    after: { name: 'Alice', status: 'active' },
    changes: ['status'],
    customData: {             // 📝 Application-specific context
      trigger: 'login_event',
      ipAddress: '192.168.1.100',
      userAgent: 'Mozilla/5.0...'
    }
  }
}
```

### Request Tracing Best Practices

1. **Consistent TraceId Format**: Use a consistent format like `req-{service}-{timestamp}-{random}`
2. **Distributed Tracing**: Pass the same `traceId` across microservices 
3. **Indexing**: Create database indexes on `traceId` for fast query performance
4. **Custom Data**: Include relevant context like IP addresses, user agents, feature flags

```typescript
// Example: Consistent tracing across operations
const traceId = `req-userapi-${Date.now()}-${Math.random().toString(36)}`;

// Create user
const user = await userCollection.create(userData, {
  userContext: { userId: 'system' },
  auditMetadata: { traceId, customData: { operation: 'registration' } }
});

// Create profile  
await profileCollection.create(profileData, {
  userContext: { userId: user._id },
  auditMetadata: { traceId, customData: { operation: 'profile_setup' } }
});

// Update preferences
await preferenceCollection.create(preferences, {
  userContext: { userId: user._id },
  auditMetadata: { traceId, customData: { operation: 'preferences_init' } }
});
```

### Error Handling

All operations return data directly and throw exceptions on error:

```typescript
// Usage with try-catch
try {
  const user = await collection.create(userData);
  console.log('Created:', user);
} catch (error) {
  console.error('Error:', error.message);
}

// Or with async/await and .catch()
const user = await collection.create(userData)
  .catch(error => {
    console.error('Error:', error.message);
    throw error; // re-throw if needed
  });
```



---
[>> Table of Contents](/docs/README.md)
