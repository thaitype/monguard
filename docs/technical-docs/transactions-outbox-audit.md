# Transactions, Outbox Pattern, and Audit Logging in Monguard

## Overview

Monguard provides a flexible audit logging system that supports both **in-transaction** and **outbox pattern** approaches for handling audit logs in distributed systems. This document explains how to implement and use these patterns effectively.

## Quick Start

```typescript
import { MonguardCollection, MonguardAuditLogger } from 'monguard';

// Basic setup with transaction-aware audit control
const collection = new MonguardCollection<User>(db, 'users', {
  auditLogger: new MonguardAuditLogger(db, 'audit_logs'),
  concurrency: { transactionsEnabled: true },
  auditControl: {
    mode: 'inTransaction',        // or 'outbox'
    failOnError: false,           // or true for strict compliance
    logFailedAttempts: true       // for debugging
  }
});
```

## Audit Control Modes

### 1. In-Transaction Mode (`mode: 'inTransaction'`)

**Best for**: Strong consistency requirements, ACID compliance scenarios

In this mode, audit logs are created within the same transaction as the main operation, ensuring atomicity.

```typescript
const collection = new MonguardCollection<Order>(db, 'orders', {
  auditLogger: new MonguardAuditLogger(db, 'order_audit_logs'),
  concurrency: { transactionsEnabled: true },
  auditControl: {
    mode: 'inTransaction',
    failOnError: true,  // Rollback on audit failures
    logFailedAttempts: false
  }
});

// Both order creation and audit log happen in same transaction
await collection.create(orderData, { userContext: { userId: 'user123' } });
```

**Benefits:**
- ✅ Strong consistency - audit logs and data changes are atomic
- ✅ Immediate audit availability
- ✅ No risk of orphaned operations

**Considerations:**
- ⚠️ Higher transaction overhead
- ⚠️ Audit failures can block business operations (if `failOnError: true`)

### 2. Outbox Mode (`mode: 'outbox'`)

**Best for**: High-throughput systems, eventual consistency scenarios, decoupled audit processing

In this mode, audit events are queued for later processing, allowing business operations to proceed independently.

```typescript
const collection = new MonguardCollection<Product>(db, 'products', {
  auditLogger: new MonguardAuditLogger(db, 'product_audit_logs'),
  concurrency: { transactionsEnabled: true },
  auditControl: {
    mode: 'outbox',
    failOnError: false,  // Don't block on audit issues
    logFailedAttempts: true  // Track failures for monitoring
  }
});

// Product creation succeeds even if audit processing fails
await collection.create(productData, { userContext: { userId: 'admin' } });
```

**Benefits:**
- ✅ Higher performance - no audit overhead in critical path
- ✅ Resilient to audit system failures
- ✅ Better scalability for high-volume operations

**Considerations:**
- ⚠️ Eventual consistency for audit logs
- ⚠️ Requires outbox processor implementation
- ⚠️ More complex error handling and monitoring

## Implementation Patterns

### Pattern 1: Financial System (Strict Compliance)

```typescript
// Financial transactions require strict audit compliance
const accountCollection = new MonguardCollection<Account>(db, 'accounts', {
  auditLogger: new MonguardAuditLogger(db, 'financial_audit_logs'),
  concurrency: { transactionsEnabled: true },
  auditControl: {
    mode: 'inTransaction',
    failOnError: true,        // Critical: must not lose audit trails
    logFailedAttempts: true   // For compliance monitoring
  }
});

try {
  await accountCollection.update(
    { accountId: 'ACC123' },
    { $inc: { balance: -1000 } },
    { 
      userContext: { 
        userId: 'trader456',
        sessionId: 'session789',
        ipAddress: '192.168.1.100'
      }
    }
  );
} catch (error) {
  // Transaction rolled back - both balance update AND audit log failed
  console.error('Financial operation failed:', error);
  // Implement alerting/escalation
}
```

### Pattern 2: E-commerce System (High Performance)

```typescript
// Product catalog updates need high throughput
const productCollection = new MonguardCollection<Product>(db, 'products', {
  auditLogger: new MonguardAuditLogger(db, 'product_audit_logs'),
  concurrency: { transactionsEnabled: false }, // Optimistic locking
  auditControl: {
    mode: 'outbox',
    failOnError: false,       // Don't block product updates
    logFailedAttempts: true   // Monitor audit health
  }
});

// High-volume product updates proceed regardless of audit status
await Promise.all([
  productCollection.update({ sku: 'PROD1' }, { $set: { price: 99.99 } }),
  productCollection.update({ sku: 'PROD2' }, { $set: { stock: 50 } }),
  productCollection.update({ sku: 'PROD3' }, { $set: { status: 'active' } })
]);

// Audit events are processed asynchronously by outbox processor
```

### Pattern 3: Hybrid System (Context-Aware)

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

## Error Handling Strategies

### Strategy 1: Fail-Fast (Financial/Compliance)

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
  throw error; // Propagate to caller
}
```

### Strategy 2: Resilient (High-Throughput)

```typescript
const collection = new MonguardCollection<UserAction>(db, 'user_actions', {
  auditLogger: new MonguardAuditLogger(db, 'action_audit'),
  concurrency: { transactionsEnabled: false },
  auditControl: {
    mode: 'outbox',
    failOnError: false,   // Continue despite audit issues
    logFailedAttempts: true
  }
});

try {
  await collection.create(userAction, { userContext });
  // Success: operation completed, audit queued
} catch (error) {
  // Only fails if main operation fails
  // Audit failures are logged but don't block operation
  console.error('Operation failed:', error);
}
```

## Outbox Pattern Implementation

### Basic Outbox Transport Interface

```typescript
interface OutboxTransport<TRefId = any> {
  /**
   * Queue an audit event for later processing
   */
  enqueue(event: AuditEvent<TRefId>): Promise<void>;
  
  /**
   * Process queued audit events
   */
  processEvents(): Promise<void>;
  
  /**
   * Handle failed audit events
   */
  handleFailures(events: AuditEvent<TRefId>[]): Promise<void>;
}

interface AuditEvent<TRefId = any> {
  id: string;
  action: AuditAction;
  collectionName: string;
  documentId: TRefId;
  userContext?: UserContext<TRefId>;
  metadata?: AuditLogMetadata;
  timestamp: Date;
  retryCount?: number;
}
```

### Example Outbox Implementation

```typescript
class MongoOutboxTransport implements OutboxTransport {
  private outboxCollection: Collection<AuditEvent>;
  private auditCollection: Collection<AuditLogDocument>;

  constructor(db: Db) {
    this.outboxCollection = db.collection('audit_outbox');
    this.auditCollection = db.collection('audit_logs');
  }

  async enqueue(event: AuditEvent): Promise<void> {
    await this.outboxCollection.insertOne({
      ...event,
      id: new ObjectId().toString(),
      timestamp: new Date(),
      retryCount: 0
    });
  }

  async processEvents(): Promise<void> {
    const events = await this.outboxCollection
      .find({ retryCount: { $lt: 3 } })
      .limit(100)
      .toArray();

    for (const event of events) {
      try {
        // Convert outbox event to audit log
        const auditLog = {
          ref: {
            collection: event.collectionName,
            id: event.documentId
          },
          action: event.action,
          userId: event.userContext?.userId,
          timestamp: event.timestamp,
          createdAt: new Date(),
          updatedAt: new Date(),
          metadata: event.metadata
        };

        await this.auditCollection.insertOne(auditLog);
        await this.outboxCollection.deleteOne({ _id: event._id });
      } catch (error) {
        // Increment retry count
        await this.outboxCollection.updateOne(
          { _id: event._id },
          { $inc: { retryCount: 1 } }
        );
      }
    }
  }

  async handleFailures(events: AuditEvent[]): Promise<void> {
    // Move failed events to dead letter queue
    const deadLetterCollection = this.outboxCollection.db.collection('audit_dead_letter');
    await deadLetterCollection.insertMany(events);
    
    // Remove from outbox
    const eventIds = events.map(e => e.id);
    await this.outboxCollection.deleteMany({ id: { $in: eventIds } });
  }
}
```

### Outbox Processor Service

```typescript
class AuditOutboxProcessor {
  private transport: OutboxTransport;
  private isRunning = false;

  constructor(transport: OutboxTransport) {
    this.transport = transport;
  }

  start(intervalMs = 5000): void {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.processLoop(intervalMs);
  }

  stop(): void {
    this.isRunning = false;
  }

  private async processLoop(intervalMs: number): Promise<void> {
    while (this.isRunning) {
      try {
        await this.transport.processEvents();
      } catch (error) {
        console.error('Outbox processing error:', error);
      }
      
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }
}

// Usage
const transport = new MongoOutboxTransport(db);
const processor = new AuditOutboxProcessor(transport);

// Start background processing
processor.start(5000); // Process every 5 seconds

// Graceful shutdown
process.on('SIGTERM', () => {
  processor.stop();
});
```

## Monitoring and Observability

### Key Metrics to Track

```typescript
interface AuditMetrics {
  // Performance metrics
  auditLatency: number;           // Time to write audit logs
  outboxQueueDepth: number;       // Pending audit events
  processingRate: number;         // Events processed per second
  
  // Reliability metrics
  auditFailureRate: number;       // % of failed audit attempts
  retryCount: number;             // Failed events being retried
  deadLetterCount: number;        // Permanently failed events
  
  // Business metrics
  auditCoverage: number;          // % of operations with audit logs
  complianceGap: number;          // Missing audit trails
}
```

### Health Check Implementation

```typescript
class AuditHealthCheck {
  async checkAuditSystem(): Promise<HealthStatus> {
    const checks = await Promise.allSettled([
      this.checkAuditLogLatency(),
      this.checkOutboxHealth(),
      this.checkComplianceCoverage()
    ]);

    const failures = checks.filter(c => c.status === 'rejected');
    
    return {
      status: failures.length === 0 ? 'healthy' : 'degraded',
      checks: checks.map(c => ({
        name: c.status === 'fulfilled' ? c.value.name : 'unknown',
        status: c.status === 'fulfilled' ? 'pass' : 'fail',
        details: c.status === 'fulfilled' ? c.value.details : c.reason
      }))
    };
  }

  private async checkAuditLogLatency(): Promise<CheckResult> {
    const start = Date.now();
    // Perform test audit operation
    const latency = Date.now() - start;
    
    return {
      name: 'audit_latency',
      status: latency < 100 ? 'pass' : 'fail',
      details: `Audit latency: ${latency}ms`
    };
  }

  private async checkOutboxHealth(): Promise<CheckResult> {
    const queueDepth = await this.getOutboxQueueDepth();
    
    return {
      name: 'outbox_health',
      status: queueDepth < 1000 ? 'pass' : 'fail',
      details: `Queue depth: ${queueDepth} events`
    };
  }
}
```

## Best Practices

### 1. Choose the Right Mode

| Use Case | Recommended Mode | failOnError | Reasoning |
|----------|------------------|-------------|-----------|
| Financial transactions | `inTransaction` | `true` | Regulatory compliance requires audit atomicity |
| User authentication | `inTransaction` | `true` | Security events must be audited |
| Content management | `outbox` | `false` | High volume, eventual consistency acceptable |
| System metrics | `outbox` | `false` | Performance over perfect audit coverage |

### 2. Error Handling Guidelines

```typescript
// ✅ Good: Context-aware error handling
async function handleCriticalOperation() {
  try {
    await criticalCollection.create(data, { userContext });
  } catch (error) {
    if (error.message.includes('audit')) {
      // Audit-specific error handling
      await alertComplianceTeam(error);
    }
    // Re-throw to maintain transaction semantics
    throw error;
  }
}

// ❌ Bad: Swallowing audit errors in critical systems
async function handleCriticalOperationBad() {
  try {
    await criticalCollection.create(data, { userContext });
  } catch (error) {
    console.log('Ignoring error:', error); // Never do this!
    return; // Data inconsistency risk
  }
}
```

### 3. Performance Optimization

```typescript
// ✅ Good: Batch operations for better performance
const results = await Promise.all([
  collection.create(doc1, { userContext }),
  collection.create(doc2, { userContext }),
  collection.create(doc3, { userContext })
]);

// ✅ Good: Use manual audit for bulk operations
await collection.createAuditLogs([
  { action: 'create', documentId: doc1._id, userContext, metadata: { after: doc1 } },
  { action: 'create', documentId: doc2._id, userContext, metadata: { after: doc2 } },
  { action: 'create', documentId: doc3._id, userContext, metadata: { after: doc3 } }
]);
```

### 4. Testing Strategies

```typescript
// Test audit control behavior
describe('Audit Control', () => {
  it('should rollback on audit failure when failOnError is true', async () => {
    const collection = new MonguardCollection(db, 'test', {
      auditLogger: new MockAuditLogger(),
      concurrency: { transactionsEnabled: true },
      auditControl: { mode: 'inTransaction', failOnError: true }
    });

    // Mock audit failure
    jest.spyOn(collection.getAuditLogger(), 'logOperation')
      .mockRejectedValue(new Error('Audit failure'));

    await expect(collection.create(testData)).rejects.toThrow();
    
    // Verify no data was created
    const docs = await collection.find({});
    expect(docs).toHaveLength(0);
  });
});
```

## Migration Guide

### From Basic Audit to Transaction-Aware

```typescript
// Before: Basic audit configuration
const collection = new MonguardCollection(db, 'users', {
  auditLogger: new MonguardAuditLogger(db, 'audit_logs'),
  concurrency: { transactionsEnabled: true }
});

// After: Transaction-aware audit control
const collection = new MonguardCollection(db, 'users', {
  auditLogger: new MonguardAuditLogger(db, 'audit_logs'),
  concurrency: { transactionsEnabled: true },
  auditControl: {
    mode: 'inTransaction',     // NEW: explicit mode
    failOnError: false,        // NEW: error handling strategy
    logFailedAttempts: true    // NEW: monitoring capability
  }
});
```

### Gradual Outbox Migration

```typescript
// Phase 1: Enable outbox mode with fallback
const collection = new MonguardCollection(db, 'products', {
  auditLogger: new MonguardAuditLogger(db, 'audit_logs'),
  concurrency: { transactionsEnabled: true },
  auditControl: {
    mode: 'outbox',           // Switch to outbox
    failOnError: false,       // Graceful degradation
    logFailedAttempts: true   // Monitor migration
  }
});

// Phase 2: Deploy outbox processor
const processor = new AuditOutboxProcessor(transport);
processor.start();

// Phase 3: Monitor and tune performance
// Phase 4: Gradually increase outbox usage
```

## Troubleshooting

### Common Issues

1. **High Audit Latency**
   ```typescript
   // Check audit collection indexes
   await db.collection('audit_logs').createIndex({ 'ref.collection': 1, 'ref.id': 1 });
   await db.collection('audit_logs').createIndex({ timestamp: -1 });
   ```

2. **Outbox Queue Buildup**
   ```typescript
   // Scale outbox processing
   const processor1 = new AuditOutboxProcessor(transport);
   const processor2 = new AuditOutboxProcessor(transport);
   processor1.start(2500); // More frequent processing
   processor2.start(2500);
   ```

3. **Transaction Rollback Storms**
   ```typescript
   // Use circuit breaker pattern
   if (auditFailureRate > 0.1) {
     // Temporarily switch to resilient mode
     auditControl.failOnError = false;
   }
   ```

This comprehensive guide provides the foundation for implementing robust, scalable audit logging with transaction support and outbox patterns in Monguard applications.