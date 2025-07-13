[>> Table of Contents](/docs/README.md)


## Multi-Phase Operations

Multi-phase operations are workflows where a single business process requires multiple sequential database updates, often involving different users, departments, or systems. Monguard's `__v` feature enables safe, conflict-free multi-phase operations using version-based optimistic locking.

### Basic Version-Safe Chaining

```typescript
// Safe multi-phase operation using __v
async function processOrder(orders: MonguardCollection, orderId: ObjectId) {
  const customerService = { userId: 'cs-001' };
  const warehouse = { userId: 'warehouse-001' };
  
  // Phase 1: Customer service validates
  const validation = await orders.update(
    { _id: orderId, status: 'pending' },
    { $set: { status: 'processing' } },
    { userContext: customerService }
  );
  
  if (!validation.__v) {
    throw new Error('Validation failed or version conflict');
  }
  
  // Phase 2: Warehouse processes using __v from Phase 1
  const processing = await orders.update(
    { _id: orderId, __v: validation.__v }, // Use __v for safety
    { $set: { status: 'shipped' } },
    { userContext: warehouse }
  );
  
  return processing.__v;
}
```

### When `__v` is Available

| Condition | `__v` Value | Safe to Chain? |
|-----------|-------------------|----------------|
| Single document modified | `currentVersion + 1` | ✅ Yes |
| No documents modified | `undefined` | ❌ Operation failed |
| Multi-document operation | `undefined` | ❌ Ambiguous state |
| Hard delete operation | `undefined` | ❌ Document removed |

### Conflict Detection and Recovery

```typescript
async function retryableUpdate(collection: MonguardCollection, docId: ObjectId) {
  let retryCount = 0;
  const maxRetries = 3;
  
  while (retryCount < maxRetries) {
    try {
      // Get current document state
      const currentDoc = await collection.findById(docId);
      if (!currentDoc) throw new Error('Document not found');
      
      // Attempt version-safe update
      const result = await collection.update(
        { _id: docId, __v: currentDoc.__v },
        { $set: { processed: true } },
        { userContext: { userId: 'processor' } }
      );
      
      if (result.modifiedCount > 0) {
        return result.__v; // Success!
      }
      
      // Version conflict - retry
      retryCount++;
      await new Promise(resolve => setTimeout(resolve, 100 * retryCount));
      
    } catch (error) {
      retryCount++;
      if (retryCount >= maxRetries) throw error;
    }
  }
}
```

### Real-World Use Cases

**Document Approval Workflow:**
```typescript
// Author → Reviewer → Approver → Publisher
const submission = await docs.update(
  { _id: docId, __v: 1 },
  { $set: { status: 'submitted' } },
  { userContext: author }
);

const review = await docs.update(
  { _id: docId, __v: submission.__v },
  { $set: { status: 'reviewed' } },
  { userContext: reviewer }
);

const approval = await docs.update(
  { _id: docId, __v: review.__v },
  { $set: { status: 'approved' } },
  { userContext: approver }
);
```

**E-Commerce Order Fulfillment:**
```typescript
// Validation → Packing → Billing → Completion
const phases = [
  { status: 'processing', user: customerService },
  { status: 'shipped', user: warehouse },
  { status: 'completed', user: billing }
];

let currentVersion = order.__v;
for (const phase of phases) {
  const result = await orders.update(
    { _id: orderId, __v: currentVersion },
    { $set: { status: phase.status } },
    { userContext: phase.user }
  );
  
  if (!result.__v) {
    throw new Error(`Phase failed: ${phase.status}`);
  }
  
  currentVersion = result.__v;
}
```

For comprehensive documentation on multi-phase operations, including error handling patterns, performance considerations, and advanced use cases, see: [Multi-Phase Operations Guide](./docs/multi-phase-operations.md).


#### __v Field Behavior

The `__v` field indicates the document version after update and provides insight into the operation type:

**With Optimistic Locking Strategy (`transactionsEnabled: false`):**
- ✅ **Single document update**: Returns `__v` (e.g., `3`)
- ❌ **Multi-document update**: Returns `__v: undefined`

**With Transaction Strategy (`transactionsEnabled: true`):**
- ❌ **All updates**: Returns `__v: undefined` (no version tracking)

```typescript
// Example: Detecting operation type
const result = await collection.update(filter, update);

if (result.__v !== undefined) {
  console.log(`Single document updated to version ${result.__v}`);
  console.log('Concurrency protection was applied ✅');
} else {
  console.log(`${result.modifiedCount} documents updated`);
  console.log('Multi-document operation or Transaction strategy ⚡');
}
```

#### Single vs Multi-Document Updates

The Optimistic Locking Strategy behaves differently based on how many documents match your filter:

**🔒 Single Document Updates** (Full concurrency protection):
- **When**: Filter matches exactly 1 document
- **Behavior**: Uses version control for concurrency safety
- **Returns**: `__v` field for tracking document state
- **Retry**: Automatic retry on version conflicts
- **Examples**: 
  ```typescript
  // These get optimistic locking if they match 1 document:
  await collection.updateById(id, update)
  await collection.update({ email: "unique@example.com" }, update)
  await collection.update({ externalId: "EXT123" }, update)
  ```

**⚡ Multi-Document Updates** (No concurrency protection):
- **When**: Filter matches 2+ documents
- **Behavior**: Updates all matching documents without version control
- **Returns**: `__v: undefined`
- **Retry**: No automatic conflict resolution
- **Examples**:
  ```typescript
  // These lose optimistic locking:
  await collection.update({ status: "active" }, update)    // matches many
  await collection.update({ department: "eng" }, update)   // matches many
  ```

**Best Practices:**
- ✅ Use unique field filters (email, externalId) for concurrent safety
- ✅ Check `__v` field to confirm single-document operation
- ⚠️ Use multi-document updates only when you understand the concurrency trade-offs
- 🔄 For critical updates, prefer `updateById()` or unique field filters


### Deleting Documents

```typescript
// Delete by filter
async delete(
  filter: Filter<T>,
  options?: DeleteOptions
): Promise<UpdateResult | DeleteResult>

// Delete by ID
async deleteById(
  id: ObjectId,
  options?: DeleteOptions
): Promise<UpdateResult | DeleteResult>

interface DeleteOptions {
  skipAudit?: boolean;
  userContext?: UserContext;
  hardDelete?: boolean; // Default: false (soft delete)
}
```


### Restoring Soft-Deleted Documents

```typescript
async restore(
  filter: Filter<T>,
  userContext?: UserContext
): Promise<UpdateResult>
```

### Manual Auto-Field Control

```typescript
// Comprehensive auto-field update
updateAutoFields<D extends Record<string, any>>(
  document: D,
  options: AutoFieldUpdateOptions
): D

interface AutoFieldUpdateOptions {
  operation: 'create' | 'update' | 'delete' | 'restore' | 'custom';
  userContext?: UserContext;
  customTimestamp?: Date;
  fields?: Partial<{
    createdAt: boolean;
    updatedAt: boolean;
    deletedAt: boolean;
    createdBy: boolean;
    updatedBy: boolean;
    deletedBy: boolean;
  }>;
}

// Individual field setters
setCreatedFields(
  document: any,
  userContext?: UserContext,
  timestamp?: Date
): void

setUpdatedFields(
  document: any,
  userContext?: UserContext,
  timestamp?: Date
): void

setDeletedFields(
  document: any,
  userContext?: UserContext,
  timestamp?: Date
): void

clearDeletedFields(
  document: any,
  userContext?: UserContext,
  timestamp?: Date
): void
```

### Manual Audit Logging

```typescript
// Create single audit log entry
async createAuditLog(
  options: CreateAuditLogOptions
): Promise<void>

// Create multiple audit log entries
async createAuditLogs(
  entries: BatchAuditEntry[]
): Promise<void>

interface CreateAuditLogOptions {
  action: AuditAction;
  documentId: any;
  userContext?: UserContext;
  metadata?: ManualAuditOptions;
}

interface ManualAuditOptions {
  beforeDocument?: any;
  afterDocument?: any;
  customData?: Record<string, any>;
  traceId?: string;
  skipAutoFields?: boolean;
}

interface AuditMetadataOptions {
  traceId?: string;
  customData?: Record<string, any>;
}

interface BatchAuditEntry {
  action: AuditAction;
  documentId: any;
  userContext?: UserContext;
  metadata?: ManualAuditOptions;
}

type AuditAction = 'create' | 'update' | 'delete' | 'restore' | 'custom';
```

---

[>> Table of Contents](/docs/README.md)

