[>> Table of Contents](/docs/README.md)


## Concurrency Strategies

Monguard automatically selects the appropriate concurrency strategy based on your configuration.

### Transaction Strategy

Used when `transactionsEnabled: true`. Provides ACID guarantees.

**Best for:**
- MongoDB replica sets
- MongoDB Atlas
- Applications requiring strict consistency

**Features:**
- Atomic operations with automatic rollback
- Consistent audit logging
- No __v fields required

**Automatic Fallback:**
If transactions fail (e.g., standalone MongoDB), automatically falls back to optimistic strategy behavior.

### Optimistic Locking Strategy

Used when `transactionsEnabled: false`. Uses document versioning for conflict detection.

**Best for:**
- MongoDB standalone instances
- Azure Cosmos DB
- High-throughput scenarios

**Features:**
- Document version tracking
- Retry logic with exponential backoff
- Conflict detection and resolution

---

[>> Table of Contents](/docs/README.md)
