# Multi-Phase Operations with Monguard

## Overview

Multi-phase operations are workflows where a single business process requires multiple sequential database updates, often involving different users, departments, or systems. Monguard's `__v` feature enables safe, conflict-free multi-phase operations by providing version-based optimistic locking that prevents race conditions and ensures data consistency.

### Why Multi-Phase Operations Matter

In real-world applications, business processes rarely consist of a single database update. Consider these common scenarios:

- **Order Processing**: Customer service validates → Warehouse packs → Billing processes payment
- **Document Approval**: Author submits → Reviewer approves → Manager publishes
- **User Onboarding**: Registration → Email verification → Profile completion → Access provisioning
- **Content Publishing**: Draft creation → Editorial review → SEO optimization → Publication

Traditional approaches often suffer from:
- **Race conditions** when multiple users modify the same document
- **Data inconsistency** when operations fail midway through the process
- **Lost updates** when concurrent modifications overwrite each other
- **Complex recovery** scenarios when errors occur

## Core Concepts

### Version-Based Optimistic Locking

Monguard uses document versioning to prevent conflicts during multi-phase operations:

```typescript
interface VersionedDocument {
  _id: ObjectId;
  __v: number;       // Automatically incremented on each update
  createdAt: Date;
  updatedAt: Date;
  // ... your business fields
}
```

### The `__v` Feature

When operations succeed, Monguard returns the updated version number:

```typescript
interface ExtendedUpdateResult extends UpdateResult {
  __v?: number;    // Present when document was modified
}

// Example: Safe operation chaining
const phase1Result = await collection.updateById(
  documentId,
  { $set: { status: 'processing' } },
  { userContext }
);

// Use __v for subsequent operations
if (phase1Result.__v) {
  await collection.update(
    { _id: documentId, __v: phase1Result.__v },
    { $set: { processed: true } },
    { userContext }
  );
}
```

### When `__v` is Available

| Condition | `__v` Value | Use Case |
|-----------|-------------------|----------|
| Single document modified | `currentVersion + 1` | Safe for chaining operations |
| No documents modified | `undefined` | Operation failed or no matching documents |
| Multi-document operation | `undefined` | Ambiguous which version to use |
| Hard delete operation | `undefined` | Document no longer exists |
| Transaction strategy | `undefined` | Uses different concurrency model |

## Core Patterns

### Pattern 1: Basic Version-Safe Chaining

The fundamental pattern for safe multi-phase operations:

```typescript
async function safeMultiPhaseUpdate(collection: MonguardCollection, documentId: ObjectId) {
  const userContext = { userId: 'processor-001' };
  
  // Phase 1: Initial update
  const phase1 = await collection.update(
    { _id: documentId, __v: expectedVersion },
    { $set: { status: 'processing', phase: 1 } },
    { userContext }
  );
  
  if (!phase1.__v) {
    throw new Error('Phase 1 failed: Version conflict or document not found');
  }
  
  // Phase 2: Use __v from phase 1
  const phase2 = await collection.update(
    { _id: documentId, version: phase1.__v },
    { $set: { status: 'completed', phase: 2 } },
    { userContext }
  );
  
  return phase2.__v;
}
```

### Pattern 2: Conditional Operation Flow

Handle conditional logic based on operation success:

```typescript
async function conditionalWorkflow(collection: MonguardCollection, documentId: ObjectId) {
  const result = await collection.updateById(
    documentId,
    { $set: { status: 'validated' } },
    { userContext: { userId: 'validator' } }
  );
  
  if (result.__v) {
    // Validation succeeded - proceed to next phase
    const processingResult = await collection.update(
      { _id: documentId, __v: result.__v },
      { $set: { status: 'processing' } },
      { userContext: { userId: 'processor' } }
    );
    
    return processingResult;
  } else {
    // Validation failed - handle appropriately
    console.log('Document validation failed or version conflict occurred');
    return null;
  }
}
```

### Pattern 3: Retry with Version Recovery

Handle version conflicts gracefully with retry logic:

```typescript
async function retryableUpdate(
  collection: MonguardCollection, 
  documentId: ObjectId, 
  update: any,
  maxRetries: number = 3
) {
  let retryCount = 0;
  
  while (retryCount < maxRetries) {
    try {
      // Get current document state
      const currentDoc = await collection.findById(documentId);
      if (!currentDoc) {
        throw new Error('Document not found');
      }
      
      // Attempt version-safe update
      const result = await collection.update(
        { _id: documentId, __v: currentDoc.__v },
        update,
        { userContext: { userId: 'retrying-processor' } }
      );
      
      if (result.modifiedCount > 0) {
        return result; // Success!
      }
      
      // Version conflict - retry
      retryCount++;
      console.log(`Retry ${retryCount} due to version conflict`);
      
      // Exponential backoff
      await new Promise(resolve => 
        setTimeout(resolve, Math.pow(2, retryCount) * 100)
      );
      
    } catch (error) {
      retryCount++;
      if (retryCount >= maxRetries) {
        throw error;
      }
    }
  }
  
  throw new Error(`Failed after ${maxRetries} retries`);
}
```

## Real-World Use Cases

### E-Commerce Order Fulfillment

A complete order processing workflow with department handoffs:

```typescript
interface Order extends AuditableDocument {
  orderNumber: string;
  status: 'pending' | 'processing' | 'shipped' | 'completed';
  amount: number;
  metadata?: {
    customerId?: string;
    validatedBy?: string;
    validatedAt?: Date;
    packedBy?: string;
    packedAt?: Date;
    trackingNumber?: string;
    billedBy?: string;
    billedAt?: Date;
    paymentProcessed?: boolean;
  };
}

async function processECommerceOrder(
  orders: MonguardCollection<Order>, 
  orderId: ObjectId
) {
  const customerService = { userId: 'cs-001' };
  const warehouse = { userId: 'warehouse-001' };
  const billing = { userId: 'billing-001' };
  
  // Phase 1: Customer service validates order
  const validation = await orders.update(
    { _id: orderId, status: 'pending' },
    {
      $set: {
        status: 'processing',
        metadata: {
          validatedBy: customerService.userId,
          validatedAt: new Date(),
        }
      }
    },
    { userContext: customerService }
  );
  
  if (!validation.__v) {
    throw new Error('Order validation failed');
  }
  
  // Phase 2: Warehouse picks and packs
  const packing = await orders.update(
    { _id: orderId, __v: validation.__v },
    {
      $set: {
        metadata: {
          validatedBy: customerService.userId,
          validatedAt: new Date(),
          packedBy: warehouse.userId,
          packedAt: new Date(),
          trackingNumber: `TRK-${Date.now()}`,
        }
      }
    },
    { userContext: warehouse }
  );
  
  if (!packing.__v) {
    throw new Error('Order packing failed - possible concurrent modification');
  }
  
  // Phase 3: Billing processes payment
  const completion = await orders.update(
    { _id: orderId, __v: packing.__v },
    {
      $set: {
        status: 'completed',
        completedAt: new Date(),
        metadata: {
          validatedBy: customerService.userId,
          validatedAt: new Date(),
          packedBy: warehouse.userId,
          packedAt: new Date(),
          trackingNumber: `TRK-${Date.now()}`,
          billedBy: billing.userId,
          billedAt: new Date(),
          paymentProcessed: true,
        }
      }
    },
    { userContext: billing }
  );
  
  return completion.__v;
}
```

### Document Approval Workflow

Multi-step approval process with role-based transitions:

```typescript
interface Document extends AuditableDocument {
  title: string;
  content: string;
  tags: string[];
  metadata?: {
    department?: string;
    priority?: string;
    status?: string;
    submittedBy?: string;
    submittedAt?: Date;
    reviewedBy?: string;
    reviewedAt?: Date;
    reviewComments?: string;
    approvedBy?: string;
    approvedAt?: Date;
    publishedBy?: string;
    publishedAt?: Date;
    publicUrl?: string;
  };
}

async function processDocumentApproval(
  documents: MonguardCollection<Document>,
  docId: ObjectId
) {
  const author = { userId: 'author-001' };
  const reviewer = { userId: 'reviewer-001' };
  const approver = { userId: 'approver-001' };
  const publisher = { userId: 'publisher-001' };
  
  // Get initial document
  const doc = await documents.findById(docId);
  if (!doc) throw new Error('Document not found');
  
  let currentVersion = doc.__v;
  
  // Phase 1: Author submits for review
  const submission = await documents.update(
    { _id: docId, __v: currentVersion },
    {
      $set: {
        tags: ['policy', 'pending-review'],
        metadata: {
          ...doc.metadata,
          status: 'submitted',
          submittedBy: author.userId,
          submittedAt: new Date(),
        }
      }
    },
    { userContext: author }
  );
  
  if (!submission.__v) throw new Error('Submission failed');
  currentVersion = submission.__v;
  
  // Phase 2: Reviewer reviews
  const review = await documents.update(
    { _id: docId, __v: currentVersion },
    {
      $set: {
        tags: ['policy', 'reviewed'],
        metadata: {
          ...doc.metadata,
          status: 'reviewed',
          submittedBy: author.userId,
          submittedAt: new Date(),
          reviewedBy: reviewer.userId,
          reviewedAt: new Date(),
          reviewComments: 'Document looks good, ready for approval',
        }
      }
    },
    { userContext: reviewer }
  );
  
  if (!review.__v) throw new Error('Review failed');
  currentVersion = review.__v;
  
  // Phase 3: Approver approves
  const approval = await documents.update(
    { _id: docId, __v: currentVersion },
    {
      $set: {
        tags: ['policy', 'approved'],
        metadata: {
          ...doc.metadata,
          status: 'approved',
          submittedBy: author.userId,
          submittedAt: new Date(),
          reviewedBy: reviewer.userId,
          reviewedAt: new Date(),
          reviewComments: 'Document looks good, ready for approval',
          approvedBy: approver.userId,
          approvedAt: new Date(),
        }
      }
    },
    { userContext: approver }
  );
  
  if (!approval.__v) throw new Error('Approval failed');
  currentVersion = approval.__v;
  
  // Phase 4: Publisher publishes
  const publication = await documents.update(
    { _id: docId, __v: currentVersion },
    {
      $set: {
        tags: ['policy', 'published'],
        metadata: {
          ...doc.metadata,
          status: 'published',
          submittedBy: author.userId,
          submittedAt: new Date(),
          reviewedBy: reviewer.userId,
          reviewedAt: new Date(),
          reviewComments: 'Document looks good, ready for approval',
          approvedBy: approver.userId,
          approvedAt: new Date(),
          publishedBy: publisher.userId,
          publishedAt: new Date(),
          publicUrl: 'https://company.com/policies/important-policy'
        }
      }
    },
    { userContext: publisher }
  );
  
  return publication.__v;
}
```

### User Onboarding Pipeline

Progressive user setup with checkpoint validation:

```typescript
interface User extends AuditableDocument {
  email: string;
  name?: string;
  status: 'pending' | 'email-verified' | 'profile-complete' | 'active';
  profile?: {
    firstName?: string;
    lastName?: string;
    department?: string;
    role?: string;
  };
  permissions?: string[];
  onboardingSteps?: {
    emailVerified?: boolean;
    profileCompleted?: boolean;
    permissionsAssigned?: boolean;
    trainingCompleted?: boolean;
  };
}

async function processUserOnboarding(
  users: MonguardCollection<User>,
  userId: ObjectId,
  verificationToken: string,
  profileData: any,
  rolePermissions: string[]
) {
  const system = { userId: 'system' };
  const hr = { userId: 'hr-admin' };
  const itAdmin = { userId: 'it-admin' };
  
  // Phase 1: Email verification
  const emailVerification = await users.update(
    { _id: userId, status: 'pending' },
    {
      $set: {
        status: 'email-verified',
        'onboardingSteps.emailVerified': true,
      }
    },
    { userContext: system }
  );
  
  if (!emailVerification.__v) {
    throw new Error('Email verification failed');
  }
  
  // Phase 2: Profile completion
  const profileCompletion = await users.update(
    { _id: userId, __v: emailVerification.__v },
    {
      $set: {
        status: 'profile-complete',
        profile: profileData,
        'onboardingSteps.profileCompleted': true,
      }
    },
    { userContext: hr }
  );
  
  if (!profileCompletion.__v) {
    throw new Error('Profile completion failed');
  }
  
  // Phase 3: Permission assignment and activation
  const activation = await users.update(
    { _id: userId, __v: profileCompletion.__v },
    {
      $set: {
        status: 'active',
        permissions: rolePermissions,
        'onboardingSteps.permissionsAssigned': true,
      }
    },
    { userContext: itAdmin }
  );
  
  return activation.__v;
}
```

## Error Handling & Recovery

### Conflict Detection and Prevention

Version conflicts occur when multiple operations attempt to modify the same document concurrently:

```typescript
async function handleVersionConflicts(
  collection: MonguardCollection,
  documentId: ObjectId
) {
  const user1 = { userId: 'user-001' };
  const user2 = { userId: 'user-002' };
  
  // Both users try to update the same document
  const [result1, result2] = await Promise.allSettled([
    collection.update(
      { _id: documentId, __v: 1 },
      { $set: { status: 'processing-by-user1' } },
      { userContext: user1 }
    ),
    collection.update(
      { _id: documentId, __v: 1 }, // Same version!
      { $set: { status: 'processing-by-user2' } },
      { userContext: user2 }
    )
  ]);
  
  // Only one update will succeed
  if (result1.status === 'fulfilled' && result1.value.__v) {
    console.log('User 1 won the race');
    
    // User 2 can retry with the new version
    const currentDoc = await collection.findById(documentId);
    const retryResult = await collection.update(
      { _id: documentId, __v: currentDoc!.__v },
      { $set: { reviewedBy: user2.userId } },
      { userContext: user2 }
    );
    
    return retryResult.__v;
  }
}
```

### Rollback Strategies

When multi-phase operations fail partway through:

```typescript
async function rollbackableWorkflow(
  collection: MonguardCollection,
  documentId: ObjectId
) {
  const userContext = { userId: 'workflow-processor' };
  let checkpoints: number[] = [];
  
  try {
    // Phase 1
    const phase1 = await collection.update(
      { _id: documentId },
      { $set: { status: 'phase1-complete', phase1Data: 'some data' } },
      { userContext }
    );
    if (!phase1.__v) throw new Error('Phase 1 failed');
    checkpoints.push(phase1.__v);
    
    // Phase 2
    const phase2 = await collection.update(
      { _id: documentId, __v: phase1.__v },
      { $set: { status: 'phase2-complete', phase2Data: 'more data' } },
      { userContext }
    );
    if (!phase2.__v) throw new Error('Phase 2 failed');
    checkpoints.push(phase2.__v);
    
    // Phase 3 (risky operation)
    const riskyOperation = await performRiskyBusinessLogic();
    if (!riskyOperation.success) {
      throw new Error('Business logic validation failed');
    }
    
    // Phase 3 update
    const phase3 = await collection.update(
      { _id: documentId, __v: phase2.__v },
      { $set: { status: 'completed', finalData: riskyOperation.data } },
      { userContext }
    );
    
    return phase3.__v;
    
  } catch (error) {
    // Rollback to last known good state
    console.log('Workflow failed, rolling back...');
    
    const rollbackResult = await collection.update(
      { _id: documentId },
      {
        $set: {
          status: 'failed',
          errorMessage: error.message,
          rolledBackAt: new Date(),
        },
        $unset: {
          phase1Data: '',
          phase2Data: '',
          finalData: ''
        }
      },
      { userContext }
    );
    
    throw new Error(`Workflow failed and rolled back: ${error.message}`);
  }
}

async function performRiskyBusinessLogic() {
  // Simulate external service call or complex validation
  return { success: Math.random() > 0.3, data: 'processed data' };
}
```

### Dead Letter Queue Pattern

Handle failed operations systematically:

```typescript
interface FailedOperation {
  documentId: ObjectId;
  operation: string;
  error: string;
  retryCount: number;
  lastAttempt: Date;
  originalData: any;
}

async function processWithDeadLetterQueue(
  collection: MonguardCollection,
  failedOps: MonguardCollection<FailedOperation>,
  documentId: ObjectId,
  operation: any
) {
  const maxRetries = 3;
  
  try {
    return await performOperation(collection, documentId, operation);
  } catch (error) {
    // Check if this operation has been retried before
    const existingFailure = await failedOps.findOne({ 
      documentId,
      operation: operation.type 
    });
    
    if (existingFailure && existingFailure.retryCount >= maxRetries) {
      // Send to dead letter queue
      await failedOps.update(
        { _id: existingFailure._id },
        {
          $set: {
            error: error.message,
            lastAttempt: new Date(),
          }
        },
        { userContext: { userId: 'system' } }
      );
      
      throw new Error(`Operation failed permanently after ${maxRetries} retries`);
    } else {
      // Record or update failure for retry
      const retryCount = existingFailure ? existingFailure.retryCount + 1 : 1;
      
      if (existingFailure) {
        await failedOps.update(
          { _id: existingFailure._id },
          {
            $set: {
              error: error.message,
              retryCount,
              lastAttempt: new Date(),
            }
          },
          { userContext: { userId: 'system' } }
        );
      } else {
        await failedOps.create({
          documentId,
          operation: operation.type,
          error: error.message,
          retryCount,
          lastAttempt: new Date(),
          originalData: operation.data,
        }, { userContext: { userId: 'system' } });
      }
      
      throw error; // Re-throw for immediate handling
    }
  }
}

async function performOperation(
  collection: MonguardCollection, 
  documentId: ObjectId, 
  operation: any
) {
  // Actual operation implementation
  return collection.updateById(documentId, operation.data);
}
```

## Performance Considerations

### Batch Operations vs. Multi-Phase

For high-throughput scenarios, consider whether multi-phase operations are necessary:

```typescript
// ❌ Inefficient: Multiple individual updates
async function inefficientBulkUpdate(collection: MonguardCollection, documentIds: ObjectId[]) {
  const results = [];
  for (const id of documentIds) {
    const result = await collection.updateById(id, { $set: { processed: true } });
    results.push(result);
  }
  return results;
}

// ✅ Efficient: Bulk update when version tracking isn't critical
async function efficientBulkUpdate(collection: MonguardCollection, filter: any) {
  return collection.update(filter, { $set: { processed: true } });
}

// ✅ Efficient: Multi-phase only when necessary
async function smartBulkUpdate(
  collection: MonguardCollection, 
  documentIds: ObjectId[],
  requiresVersionTracking: boolean
) {
  if (requiresVersionTracking) {
    // Use multi-phase for critical operations
    const results = [];
    for (const id of documentIds) {
      const doc = await collection.findById(id);
      if (doc) {
        const result = await collection.update(
          { _id: id, __v: doc.__v },
          { $set: { processed: true } }
        );
        results.push(result);
      }
    }
    return results;
  } else {
    // Use bulk update for non-critical operations
    return collection.update(
      { _id: { $in: documentIds } },
      { $set: { processed: true } }
    );
  }
}
```

### Optimizing Retry Logic

Implement efficient retry patterns:

```typescript
class RetryManager {
  private static readonly DEFAULT_BACKOFF_MS = 100;
  private static readonly MAX_BACKOFF_MS = 5000;
  
  static async withExponentialBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelayMs: number = RetryManager.DEFAULT_BACKOFF_MS
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt === maxRetries) {
          break; // Don't wait after the last attempt
        }
        
        // Calculate delay with exponential backoff and jitter
        const baseDelay = Math.min(
          baseDelayMs * Math.pow(2, attempt),
          RetryManager.MAX_BACKOFF_MS
        );
        const jitter = Math.random() * 0.1 * baseDelay;
        const delay = baseDelay + jitter;
        
        console.log(`Attempt ${attempt + 1} failed, retrying in ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError;
  }
  
  static async withLinearBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    delayMs: number = 1000
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }
    
    throw lastError;
  }
}

// Usage example
async function reliableMultiPhaseOperation(
  collection: MonguardCollection,
  documentId: ObjectId
) {
  return RetryManager.withExponentialBackoff(async () => {
    const doc = await collection.findById(documentId);
    if (!doc) throw new Error('Document not found');
    
    return collection.update(
      { _id: documentId, __v: doc.__v },
      { $set: { status: 'processed' } },
      { userContext: { userId: 'processor' } }
    );
  }, 3, 100);
}
```

### Monitoring and Metrics

Track performance and failure patterns:

```typescript
class OperationMetrics {
  private static metrics = new Map<string, {
    total: number;
    successful: number;
    failed: number;
    totalDuration: number;
    conflicts: number;
  }>();
  
  static async trackOperation<T>(
    operationType: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();
    
    try {
      const result = await operation();
      this.recordSuccess(operationType, Date.now() - startTime);
      return result;
    } catch (error) {
      const isConflict = error.message?.includes('Version conflict') ||
                        error.message?.includes('modified');
      
      if (isConflict) {
        this.recordConflict(operationType, Date.now() - startTime);
      } else {
        this.recordFailure(operationType, Date.now() - startTime);
      }
      
      throw error;
    }
  }
  
  private static recordSuccess(operationType: string, duration: number) {
    const metric = this.getOrCreateMetric(operationType);
    metric.total++;
    metric.successful++;
    metric.totalDuration += duration;
  }
  
  private static recordFailure(operationType: string, duration: number) {
    const metric = this.getOrCreateMetric(operationType);
    metric.total++;
    metric.failed++;
    metric.totalDuration += duration;
  }
  
  private static recordConflict(operationType: string, duration: number) {
    const metric = this.getOrCreateMetric(operationType);
    metric.total++;
    metric.failed++;
    metric.conflicts++;
    metric.totalDuration += duration;
  }
  
  private static getOrCreateMetric(operationType: string) {
    if (!this.metrics.has(operationType)) {
      this.metrics.set(operationType, {
        total: 0,
        successful: 0,
        failed: 0,
        totalDuration: 0,
        conflicts: 0,
      });
    }
    return this.metrics.get(operationType)!;
  }
  
  static getReport(): Record<string, any> {
    const report: Record<string, any> = {};
    
    for (const [operationType, metric] of this.metrics) {
      report[operationType] = {
        ...metric,
        successRate: metric.total > 0 ? metric.successful / metric.total : 0,
        conflictRate: metric.total > 0 ? metric.conflicts / metric.total : 0,
        averageDuration: metric.total > 0 ? metric.totalDuration / metric.total : 0,
      };
    }
    
    return report;
  }
}

// Usage in production
async function monitoredMultiPhaseOperation(
  collection: MonguardCollection,
  documentId: ObjectId
) {
  return OperationMetrics.trackOperation('multi-phase-update', async () => {
    return performMultiPhaseUpdate(collection, documentId);
  });
}
```

## Strategy Comparison

### Optimistic Locking Strategy (Default)

**Use when:**
- Running on standalone MongoDB or Cosmos DB
- High-throughput scenarios with acceptable retry overhead
- Version-based conflict detection is preferred
- Eventually consistent requirements are acceptable

**Characteristics:**
- Returns `__v` for single-document operations
- Uses document versioning for conflict detection
- Automatic retry logic for version conflicts
- Lower latency for non-conflicting operations

```typescript
const collection = new MonguardCollection(db, 'documents', {
  auditLogger: new MonguardAuditLogger(db, 'audit_logs'),
  concurrency: { transactionsEnabled: false }, // Optimistic locking
});
```

### Transaction Strategy

**Use when:**
- Running on MongoDB Atlas or replica sets
- ACID compliance is required
- Audit trail integrity is paramount
- Strong consistency requirements

**Characteristics:**
- Returns `__v: undefined` (doesn't use version-based concurrency)
- Uses MongoDB transactions for atomicity
- No retry logic needed for conflicts
- Higher latency due to transaction overhead

```typescript
const collection = new MonguardCollection(db, 'documents', {
  auditLogger: new MonguardAuditLogger(db, 'audit_logs'),
  concurrency: { transactionsEnabled: true }, // Transaction strategy
});
```

### Strategy Selection Guide

```typescript
function selectStrategy(environment: {
  mongoDbType: 'standalone' | 'replicaSet' | 'atlas' | 'cosmosDb';
  consistencyRequirement: 'eventual' | 'strong';
  throughputRequirement: 'high' | 'moderate' | 'low';
  auditIntegrity: 'critical' | 'important' | 'basic';
}): boolean {
  // Returns true for transaction strategy, false for optimistic
  
  if (environment.mongoDbType === 'standalone' || environment.mongoDbType === 'cosmosDb') {
    return false; // Optimistic locking only
  }
  
  if (environment.consistencyRequirement === 'strong' && 
      environment.auditIntegrity === 'critical') {
    return true; // Transaction strategy
  }
  
  if (environment.throughputRequirement === 'high') {
    return false; // Optimistic locking for performance
  }
  
  return true; // Default to transaction strategy for replica sets/Atlas
}
```

## Best Practices

### 1. Design for Idempotency

Make operations safe to retry:

```typescript
async function idempotentStatusUpdate(
  collection: MonguardCollection,
  documentId: ObjectId,
  targetStatus: string
) {
  const doc = await collection.findById(documentId);
  if (!doc) throw new Error('Document not found');
  
  // Check if already in target state
  if (doc.status === targetStatus) {
    return { __v: doc.__v, alreadyInState: true };
  }
  
  // Perform update only if needed
  return collection.update(
    { _id: documentId, __v: doc.__v },
    { $set: { status: targetStatus } },
    { userContext: { userId: 'system' } }
  );
}
```

### 2. Use Descriptive Error Messages

Help developers debug version conflicts:

```typescript
async function updateWithDescriptiveErrors(
  collection: MonguardCollection,
  documentId: ObjectId,
  update: any,
  expectedVersion?: number
) {
  try {
    const filter = expectedVersion 
      ? { _id: documentId, __v: expectedVersion }
      : { _id: documentId };
      
    const result = await collection.update(filter, update);
    
    if (result.modifiedCount === 0) {
      const currentDoc = await collection.findById(documentId);
      if (!currentDoc) {
        throw new Error(`Document ${documentId} not found`);
      }
      
      if (expectedVersion && currentDoc.__v !== expectedVersion) {
        throw new Error(
          `Version conflict: expected ${expectedVersion}, ` +
          `but document is at __v ${currentDoc.__v}`
        );
      }
      
      throw new Error(`Update failed for unknown reason`);
    }
    
    return result;
  } catch (error) {
    throw new Error(`Multi-phase update failed: ${error.message}`);
  }
}
```

### 3. Implement Circuit Breakers

Prevent cascade failures during high conflict scenarios:

```typescript
class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private readonly threshold: number;
  private readonly timeout: number;
  
  constructor(threshold = 5, timeoutMs = 30000) {
    this.threshold = threshold;
    this.timeout = timeoutMs;
  }
  
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.isOpen()) {
      throw new Error('Circuit breaker is open');
    }
    
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  private isOpen(): boolean {
    return this.failures >= this.threshold &&
           (Date.now() - this.lastFailureTime) < this.timeout;
  }
  
  private onSuccess() {
    this.failures = 0;
  }
  
  private onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
  }
}

const circuitBreaker = new CircuitBreaker(5, 30000);

async function protectedMultiPhaseOperation(
  collection: MonguardCollection,
  documentId: ObjectId
) {
  return circuitBreaker.execute(async () => {
    return performMultiPhaseUpdate(collection, documentId);
  });
}
```

### 4. Log Multi-Phase Operations

Maintain visibility into complex workflows:

```typescript
interface WorkflowStep {
  phase: string;
  startTime: Date;
  endTime?: Date;
  __v?: number;
  error?: string;
  userId: string;
}

class WorkflowLogger {
  private steps: WorkflowStep[] = [];
  
  startPhase(phase: string, userId: string): void {
    this.steps.push({
      phase,
      startTime: new Date(),
      userId,
    });
  }
  
  completePhase(__v?: number): void {
    const currentStep = this.steps[this.steps.length - 1];
    if (currentStep) {
      currentStep.endTime = new Date();
      currentStep.__v = __v;
    }
  }
  
  failPhase(error: string): void {
    const currentStep = this.steps[this.steps.length - 1];
    if (currentStep) {
      currentStep.endTime = new Date();
      currentStep.error = error;
    }
  }
  
  getLog(): WorkflowStep[] {
    return [...this.steps];
  }
  
  getDuration(): number {
    const firstStep = this.steps[0];
    const lastStep = this.steps[this.steps.length - 1];
    
    if (!firstStep || !lastStep?.endTime) return 0;
    
    return lastStep.endTime.getTime() - firstStep.startTime.getTime();
  }
}

async function loggedMultiPhaseOperation(
  collection: MonguardCollection,
  documentId: ObjectId
) {
  const logger = new WorkflowLogger();
  
  try {
    // Phase 1
    logger.startPhase('validation', 'validator-001');
    const validation = await collection.update(
      { _id: documentId },
      { $set: { status: 'validated' } }
    );
    logger.completePhase(validation.__v);
    
    // Phase 2
    logger.startPhase('processing', 'processor-001');
    const processing = await collection.update(
      { _id: documentId, __v: validation.__v },
      { $set: { status: 'processed' } }
    );
    logger.completePhase(processing.__v);
    
    console.log('Workflow completed:', {
      documentId,
      duration: logger.getDuration(),
      steps: logger.getLog(),
    });
    
    return processing.__v;
    
  } catch (error) {
    logger.failPhase(error.message);
    
    console.error('Workflow failed:', {
      documentId,
      duration: logger.getDuration(),
      steps: logger.getLog(),
      error: error.message,
    });
    
    throw error;
  }
}
```

## Conclusion

Multi-phase operations with Monguard's `__v` feature enable safe, conflict-free workflows in complex business scenarios. By following the patterns and best practices outlined in this guide, you can build robust systems that handle concurrent modifications, recover from failures, and maintain data consistency throughout multi-step processes.

Key takeaways:

- **Always use version-based filtering** when chaining operations
- **Handle `__v: undefined`** as a signal of failure or conflict
- **Implement proper retry logic** with exponential backoff
- **Design for idempotency** to make operations safe to retry
- **Choose the right strategy** based on your MongoDB environment and requirements
- **Monitor and log** complex workflows for observability
- **Test concurrent scenarios** to validate conflict handling

For more information, see:
- [Transaction Strategy Testing Documentation](./transaction-strategy-testing.md)
- [Dual Mode Concurrency Design](../memory-bank/DUAL_MODE_CONCURRENCY_DESIGN.md)
- [Monguard Collection API Reference](../packages/monguard/src/monguard-collection.ts)