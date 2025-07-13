
## Transactions with Outbox Pattern

Monguard provides advanced audit control modes that support both **in-transaction** and **outbox pattern** approaches for handling audit logs in distributed systems. This enables you to choose the right consistency and performance trade-offs for your application.

### Audit Control Modes

#### In-Transaction Mode (Strong Consistency)

Best for financial systems, compliance scenarios, and applications requiring strict audit trails:

```typescript
const collection = new MonguardCollection<Order>(db, 'orders', {
  auditLogger: new MonguardAuditLogger(db, 'order_audit_logs'),
  concurrency: { transactionsEnabled: true },
  auditControl: {
    mode: 'inTransaction',        // Audit logs in same transaction
    failOnError: true,            // Rollback on audit failures
    logFailedAttempts: true       // Monitor audit health
  }
});

// Both order creation and audit log happen atomically
await collection.create(orderData, { userContext: { userId: 'user123' } });
```

**Benefits:**
- ✅ Strong consistency - audit logs and data changes are atomic
- ✅ Immediate audit availability
- ✅ No risk of orphaned operations

**Considerations:**
- ⚠️ Higher transaction overhead
- ⚠️ Audit failures can block business operations

#### Outbox Mode (High Performance)

Best for high-throughput systems, eventual consistency scenarios, and decoupled audit processing:

```typescript
import { MongoOutboxTransport } from 'monguard';

// Setup outbox transport
const outboxTransport = new MongoOutboxTransport(db, {
  outboxCollectionName: 'audit_outbox',
  deadLetterCollectionName: 'audit_dead_letter',
  maxRetryAttempts: 3
});

// Create audit logger with outbox transport
const auditLogger = new MonguardAuditLogger(db, 'product_audit_logs', {
  outboxTransport
});

const collection = new MonguardCollection<Product>(db, 'products', {
  auditLogger,
  concurrency: { transactionsEnabled: true },
  auditControl: {
    mode: 'outbox',               // Queue audit events for later processing
    failOnError: false,           // Don't block on audit issues
    logFailedAttempts: true       // Track failures for monitoring
  }
});

// Product creation succeeds even if audit processing fails
await collection.create(productData, { userContext: { userId: 'admin' } });

// Audit events are now queued in the outbox collection for processing
const queueDepth = await outboxTransport.getQueueDepth();
console.log(`${queueDepth} audit events queued for processing`);
```

**Benefits:**
- ✅ Higher performance - no audit overhead in critical path
- ✅ Resilient to audit system failures
- ✅ Better scalability for high-volume operations

**Considerations:**
- ⚠️ Eventual consistency for audit logs
- ⚠️ Requires outbox processor implementation
- ⚠️ More complex error handling and monitoring

### Error Handling Strategies

#### Fail-Fast Strategy (Financial/Compliance)

```typescript
const collection = new MonguardCollection<CriticalData>(db, 'critical_data', {
  auditLogger: new MonguardAuditLogger(db, 'critical_audit'),
  concurrency: { transactionsEnabled: true },
  auditControl: {
    mode: 'inTransaction',
    failOnError: true,    // Fail immediately on audit issues
    logFailedAttempts: false
  }
});

try {
  await collection.create(criticalData, { userContext });
  // Success: both data and audit are committed
} catch (error) {
  // Failure: entire transaction rolled back
  await notifyComplianceTeam(error);
  throw error;
}
```

#### Resilient Strategy (High-Throughput)

```typescript
// Setup outbox transport for high-throughput scenarios
const outboxTransport = new MongoOutboxTransport(db, {
  outboxCollectionName: 'user_actions_outbox'
});

const collection = new MonguardCollection<UserAction>(db, 'user_actions', {
  auditLogger: new MonguardAuditLogger(db, 'action_audit', { outboxTransport }),
  concurrency: { transactionsEnabled: false },
  auditControl: {
    mode: 'outbox',
    failOnError: false,   // Continue despite audit issues
    logFailedAttempts: true
  }
});

// Operation succeeds, audit queued for later processing
await collection.create(userAction, { userContext });
```

### Hybrid Context-Aware Configuration

```typescript
class OrderService {
  private financialCollection: MonguardCollection<FinancialRecord>;
  private inventoryCollection: MonguardCollection<InventoryItem>;

  constructor(db: Db) {
    // Financial operations: strict audit compliance
    this.financialCollection = new MonguardCollection(db, 'financial_records', {
      auditLogger: new MonguardAuditLogger(db, 'financial_audit'),
      concurrency: { transactionsEnabled: true },
      auditControl: {
        mode: 'inTransaction',
        failOnError: true,
        logFailedAttempts: true
      }
    });

    // Inventory operations: eventual consistency acceptable
    this.inventoryCollection = new MonguardCollection(db, 'inventory', {
      auditLogger: new MonguardAuditLogger(db, 'inventory_audit'),
      concurrency: { transactionsEnabled: true },
      auditControl: {
        mode: 'outbox',
        failOnError: false,
        logFailedAttempts: true
      }
    });
  }

  async processOrder(order: Order) {
    const userContext = { userId: order.userId, orderId: order.id };

    // Financial charge: must have audit trail
    await this.financialCollection.create({
      type: 'charge',
      amount: order.total,
      orderId: order.id
    }, { userContext });

    // Inventory update: can be eventually consistent
    await this.inventoryCollection.update(
      { productId: order.productId },
      { $inc: { quantity: -order.quantity } },
      { userContext }
    );
  }
}
```

### Configuration Guide

| Use Case | Mode | failOnError | Reasoning |
|----------|------|-------------|-----------|
| Financial transactions | `inTransaction` | `true` | Regulatory compliance requires audit atomicity |
| User authentication | `inTransaction` | `true` | Security events must be audited |
| Content management | `outbox` | `false` | High volume, eventual consistency acceptable |
| System metrics | `outbox` | `false` | Performance over perfect audit coverage |

### Monitoring and Health Checks

```typescript
// Monitor audit system health
interface AuditMetrics {
  auditLatency: number;           // Time to write audit logs
  outboxQueueDepth: number;       // Pending audit events
  processingRate: number;         // Events processed per second
  auditFailureRate: number;       // % of failed audit attempts
  retryCount: number;             // Failed events being retried
  deadLetterCount: number;        // Permanently failed events
}

// Health check implementation
async function checkAuditHealth() {
  const metrics = await getAuditMetrics();
  
  return {
    status: metrics.auditFailureRate < 0.01 ? 'healthy' : 'degraded',
    details: {
      latency: `${metrics.auditLatency}ms`,
      queueDepth: metrics.outboxQueueDepth,
      failureRate: `${(metrics.auditFailureRate * 100).toFixed(2)}%`
    }
  };
}
```

For comprehensive implementation details, outbox pattern examples, and monitoring strategies, see: [**Transactions, Outbox Pattern, and Audit Logging Guide**](./docs/transactions-outbox-audit.md).

### Querying Audit Logs

```typescript
// Get audit collection
const auditCollection = users.getAuditCollection();

// Find all audit logs for a specific document
const documentAudits = await auditCollection.find({
  'ref.collection': 'users',
  'ref.id': userId
}).toArray();

// Find all actions by a specific user
const userActions = await auditCollection.find({
  userId: 'admin-123'
}).toArray();

// Find recent changes
const recentChanges = await auditCollection.find({
  timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
}).sort({ timestamp: -1 }).toArray();
```

### Skip audit for specific operation

```typescript
try {
  const user = await collection.create(userData, {
    skipAudit: true,
    userContext: { userId: 'admin' }
  });
} catch (error) {
  console.error('Create failed:', error.message);
}
```



