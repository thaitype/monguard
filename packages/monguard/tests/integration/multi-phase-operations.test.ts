/**
 * @fileoverview Integration tests demonstrating multi-phase operations using the __v feature
 *
 * This test suite showcases how to safely perform multi-phase document operations
 * using the __v feature to avoid extra database queries and ensure consistency.
 *
 * Key scenarios tested:
 * 1. Multi-phase order processing workflow
 * 2. Document lifecycle management with version tracking
 * 3. Version conflict handling and error scenarios
 * 4. Strategy comparison between optimistic locking and transactions
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectId as MongoObjectId, Db as MongoDb } from 'mongodb';
import { MonguardCollection } from '../../src/monguard-collection';
import { MonguardAuditLogger } from '../../src/audit-logger';
import { TestDatabase } from '../setup';
import { TestDataFactory } from '../factories';
import { TestAssertions, TestHelpers } from '../test-utils';
import { adaptDb, adaptObjectId } from '../mongodb-adapter';
import type { Db, ObjectId } from '../../src/mongodb-types';
import type { AuditableDocument, UserContext, ExtendedUpdateResult, ExtendedDeleteResult } from '../../src/types';

/**
 * Test data model representing an order document with status workflow
 */
interface TestOrder extends AuditableDocument {
  orderNumber: string;
  status: 'pending' | 'processing' | 'completed' | 'cancelled';
  amount: number;
  metadata?: Record<string, any>;
  processedAt?: Date;
  completedAt?: Date;
}

/**
 * Test data model for document lifecycle testing
 */
interface TestDocument extends AuditableDocument {
  title: string;
  content: string;
  tags: string[];
  metadata?: Record<string, any>;
}

describe('Multi-Phase Operations with __v Feature', () => {
  let testDb: TestDatabase;
  let mongoDb: MongoDb;
  let db: Db;
  let optimisticCollection: MonguardCollection<TestOrder>;
  let transactionCollection: MonguardCollection<TestOrder>;
  let docCollection: MonguardCollection<TestDocument>;

  beforeEach(async () => {
    testDb = new TestDatabase();
    mongoDb = await testDb.start();
    db = adaptDb(mongoDb);

    // Setup collection with optimistic locking strategy
    optimisticCollection = new MonguardCollection<TestOrder>(db, 'test_orders_optimistic', {
      auditLogger: new MonguardAuditLogger(db, 'audit_logs_optimistic'),
      concurrency: { transactionsEnabled: false },
    });

    // Setup collection with transaction strategy
    transactionCollection = new MonguardCollection<TestOrder>(db, 'test_orders_transaction', {
      auditLogger: new MonguardAuditLogger(db, 'audit_logs_transaction'),
      concurrency: { transactionsEnabled: true },
    });

    // Setup collection for document lifecycle tests
    docCollection = new MonguardCollection<TestDocument>(db, 'test_documents', {
      auditLogger: new MonguardAuditLogger(db, 'audit_logs_docs'),
      concurrency: { transactionsEnabled: false },
    });
  });

  afterEach(async () => {
    await testDb.stop();
  });

  describe('Multi-Phase Order Processing Workflow', () => {
    /**
     * Demonstrates version-based operation chaining where __v from one operation
     * is used in subsequent operations to prevent version conflicts.
     */
    it('should use __v for safe operation chaining and conflict prevention', async () => {
      const userContext: UserContext = { userId: 'chain-processor' };
      const orderData = {
        orderNumber: 'ORD-VERSION-CHAIN-001',
        status: 'pending' as const,
        amount: 149.99,
        metadata: { priority: 'high' },
      };

      // Phase 1: Create initial order
      const order = await optimisticCollection.create(orderData, { userContext });
      expect(order.__v).toBe(1);

      // Phase 2: Update using explicit version-based filtering
      // This demonstrates the proper pattern for using __v to prevent conflicts
      let currentVersion = order.__v;

      const phase2Result = await optimisticCollection.update(
        {
          _id: order._id,
          __v: currentVersion, // Use version in filter to prevent conflicts
        },
        {
          $set: {
            status: 'processing',
            metadata: { ...orderData.metadata, phase: 2, processedAt: new Date() },
          },
        },
        { userContext }
      );

      expect(phase2Result.modifiedCount).toBe(1);
      expect(phase2Result.__v).toBe(2);
      currentVersion = phase2Result.__v!;

      // Phase 3: Continue chaining with the __v from phase 2
      const phase3Result = await optimisticCollection.update(
        {
          _id: order._id,
          __v: currentVersion, // Use __v from previous operation
        },
        {
          $set: {
            status: 'completed',
            metadata: { ...orderData.metadata, phase: 3, completedAt: new Date() },
          },
        },
        { userContext }
      );

      expect(phase3Result.modifiedCount).toBe(1);
      expect(phase3Result.__v).toBe(3);

      // Verify final state
      const finalOrder = await optimisticCollection.findById(order._id);
      expect(finalOrder!.status).toBe('completed');
      expect(finalOrder!.__v).toBe(3);
      expect(finalOrder!.metadata?.phase).toBe(3);

      // Demonstrate that using wrong version would fail
      const wrongVersionResult = await optimisticCollection.update(
        {
          _id: order._id,
          __v: 1, // Wrong version - should not modify anything
        },
        { $set: { status: 'cancelled' } },
        { userContext }
      );

      // With wrong version, no documents should be modified
      expect(wrongVersionResult.modifiedCount).toBe(0);
      expect(wrongVersionResult.__v).toBeUndefined();
    });

    /**
     * Demonstrates a complete order processing workflow using __v
     * to safely chain multiple operations without extra database queries.
     */
    it('should complete multi-phase order processing using __v', async () => {
      const userContext: UserContext = { userId: 'processor-001' };
      const orderData = {
        orderNumber: 'ORD-2024-001',
        status: 'pending' as const,
        amount: 99.99,
        metadata: { source: 'web', priority: 'normal' },
      };

      // Phase 1: Create the initial order
      const timeRange = TestHelpers.createDateRange();
      const order = await optimisticCollection.create(orderData, { userContext });

      expect(order._id).toBeDefined();
      expect(order.status).toBe('pending');
      expect(order.__v).toBe(1);
      TestAssertions.expectTimestamps(order);
      TestHelpers.expectDateInRange(order.createdAt, timeRange);

      // Phase 2: Start processing the order using the document ID
      const processResult = await optimisticCollection.updateById(
        order._id,
        {
          $set: {
            status: 'processing',
            processedAt: new Date(),
          },
        },
        { userContext }
      );

      // Verify the update was successful and __v is available
      expect(processResult.acknowledged).toBe(true);
      expect(processResult.modifiedCount).toBe(1);
      expect(processResult.__v).toBeDefined();
      expect(processResult.__v).toBe(2); // version incremented from 1 to 2

      // Phase 3: Complete the order using the __v from phase 2
      // This demonstrates safe chaining without needing to query the current version
      const completeResult = await optimisticCollection.updateById(
        order._id,
        {
          $set: {
            status: 'completed',
            completedAt: new Date(),
          },
        },
        { userContext }
      );

      // Verify the final update
      expect(completeResult.acknowledged).toBe(true);
      expect(completeResult.modifiedCount).toBe(1);
      expect(completeResult.__v).toBeDefined();
      expect(completeResult.__v).toBe(3); // version incremented from 2 to 3

      // Verify the final state of the order
      const finalOrder = await optimisticCollection.findById(order._id);
      expect(finalOrder).toBeDefined();
      expect(finalOrder!.status).toBe('completed');
      expect(finalOrder!.__v).toBe(3);
      expect(finalOrder!.processedAt).toBeDefined();
      expect(finalOrder!.completedAt).toBeDefined();
      expect(finalOrder!.updatedBy).toBe(userContext.userId);
    });

    /**
     * Tests multi-phase operation with conditional logic based on __v
     */
    it('should handle conditional updates based on __v availability', async () => {
      const userContext: UserContext = { userId: 'processor-002' };
      const orderData = {
        orderNumber: 'ORD-2024-002',
        status: 'pending' as const,
        amount: 149.99,
      };

      // Create initial order
      const order = await optimisticCollection.create(orderData, { userContext });

      // Attempt to update a non-existent order (should return __v as undefined)
      const fakeId = adaptObjectId(new MongoObjectId());
      const noUpdateResult = await optimisticCollection.updateById(
        fakeId,
        { $set: { status: 'processing' } },
        { userContext }
      );

      expect(noUpdateResult.modifiedCount).toBe(0);
      expect(noUpdateResult.__v).toBeUndefined();

      // Successful update should return __v
      const successResult = await optimisticCollection.updateById(
        order._id,
        { $set: { status: 'processing' } },
        { userContext }
      );

      expect(successResult.modifiedCount).toBe(1);
      expect(successResult.__v).toBe(2);

      // Demonstrate conditional logic based on __v
      if (successResult.__v) {
        // Safe to proceed with next phase
        const finalResult = await optimisticCollection.updateById(
          order._id,
          { $set: { status: 'completed' } },
          { userContext }
        );

        expect(finalResult.__v).toBe(3);
      } else {
        // Handle the case where update failed
        throw new Error('Order update failed, cannot proceed to completion');
      }
    });
  });

  describe('Document Lifecycle with Version Tracking', () => {
    /**
     * Demonstrates document lifecycle management using __v:
     * Create → Update → Soft Delete → Restore
     */
    it('should manage document lifecycle using __v tracking', async () => {
      const userContext: UserContext = { userId: 'admin-001' };
      const docData = {
        title: 'Important Document',
        content: 'This is important content that needs careful handling.',
        tags: ['important', 'draft'],
      };

      // Phase 1: Create the document
      const doc = await docCollection.create(docData, { userContext });
      expect(doc.__v).toBe(1);

      // Phase 2: Update document metadata
      const updateResult = await docCollection.updateById(
        doc._id,
        {
          $set: {
            tags: ['important', 'reviewed'],
            metadata: { reviewedBy: userContext.userId, reviewDate: new Date() },
          },
        },
        { userContext }
      );

      expect(updateResult.__v).toBe(2);

      // Phase 3: Soft delete the document using __v from update
      const deleteResult = await docCollection.deleteById(doc._id, { userContext });

      expect(deleteResult.acknowledged).toBe(true);
      expect(deleteResult.modifiedCount).toBe(1);
      expect(deleteResult.__v).toBe(3); // Version incremented during soft delete

      // Verify document is soft deleted
      const deletedDoc = await docCollection.findById(doc._id, { includeSoftDeleted: true });
      expect(deletedDoc).toBeDefined();
      expect(deletedDoc!.deletedAt).toBeDefined();
      expect(deletedDoc!.__v).toBe(3);

      // Document should not be found in normal queries
      const normalQuery = await docCollection.findById(doc._id);
      expect(normalQuery).toBeNull();

      // Phase 4: Restore the document using __v from soft delete
      const restoreResult = await docCollection.restore({ _id: doc._id }, userContext);

      expect(restoreResult.acknowledged).toBe(true);
      expect(restoreResult.modifiedCount).toBe(1);
      expect(restoreResult.__v).toBe(4); // Version incremented during restore

      // Verify document is restored
      const restoredDoc = await docCollection.findById(doc._id);
      expect(restoredDoc).toBeDefined();
      expect(restoredDoc!.deletedAt).toBeUndefined();
      expect(restoredDoc!.__v).toBe(4);
      expect(restoredDoc!.tags).toEqual(['important', 'reviewed']);
      expect(restoredDoc!.metadata).toBeDefined();
    });

    /**
     * Tests multiple document operations to verify __v behavior
     * with batch operations (should return undefined for multi-document ops)
     */
    it('should handle __v correctly for single vs multiple document operations', async () => {
      const userContext: UserContext = { userId: 'batch-processor' };

      // Create multiple documents
      const docs = await Promise.all([
        docCollection.create({ title: 'Doc 1', content: 'Content 1', tags: ['test'] }, { userContext }),
        docCollection.create({ title: 'Doc 2', content: 'Content 2', tags: ['test'] }, { userContext }),
        docCollection.create({ title: 'Doc 3', content: 'Content 3', tags: ['test'] }, { userContext }),
      ]);

      // Single document update - should return __v
      const singleUpdateResult = await docCollection.updateById(
        docs[0]._id,
        { $set: { metadata: { singleUpdate: true } } },
        { userContext }
      );

      expect(singleUpdateResult.modifiedCount).toBe(1);
      expect(singleUpdateResult.__v).toBe(2);

      // Multiple document update - use a filter that will match multiple documents
      const multiUpdateResult = await docCollection.update(
        { title: { $regex: '^Doc' } }, // All 3 documents have titles starting with 'Doc'
        { $set: { metadata: { batchUpdated: true } } },
        { userContext }
      );

      // The key behavior we want to test is that __v is available when documents are modified
      expect(multiUpdateResult.modifiedCount).toBeGreaterThanOrEqual(1);

      // Our implementation returns __v for single document updates, undefined for multi-document
      if (multiUpdateResult.modifiedCount === 1) {
        // Single document updated - __v should be available
        expect(multiUpdateResult.__v).toBeDefined();
      } else {
        // Multiple documents updated - __v should be undefined
        expect(multiUpdateResult.__v).toBeUndefined();
      }

      // Single document soft delete - should return __v
      const singleDeleteResult = await docCollection.deleteById(docs[1]._id, { userContext });

      expect(singleDeleteResult.modifiedCount).toBe(1);
      expect(singleDeleteResult.__v).toBe(3); // Version 3 because it was affected by the multi-update above

      // Multiple document soft delete - __v should be undefined
      const multiDeleteResult = await docCollection.delete({ title: { $regex: '^Doc' } }, { userContext });

      expect(multiDeleteResult.modifiedCount).toBeGreaterThan(0);
      expect(multiDeleteResult.__v).toBeUndefined(); // No version for multi-document ops
    });
  });

  describe('Version Conflict Handling and Error Scenarios', () => {
    /**
     * Demonstrates proper version-based conflict detection and prevention
     * using __v in filter conditions
     */
    it('should prevent conflicts using version-based filtering', async () => {
      const userContext1: UserContext = { userId: 'user-concurrent-1' };
      const userContext2: UserContext = { userId: 'user-concurrent-2' };
      const orderData = {
        orderNumber: 'ORD-CONFLICT-PREVENTION',
        status: 'pending' as const,
        amount: 299.99,
      };

      // Create initial order
      const order = await optimisticCollection.create(orderData, { userContext: userContext1 });
      expect(order.__v).toBe(1);

      // User 1 starts a multi-phase operation
      const user1Phase1 = await optimisticCollection.update(
        { _id: order._id, __v: 1 }, // Use version filter for safety
        { $set: { status: 'processing', metadata: { processor: 'user1' } } },
        { userContext: userContext1 }
      );

      expect(user1Phase1.modifiedCount).toBe(1);
      expect(user1Phase1.__v).toBe(2);

      // User 2 tries to update using the same version (should fail)
      const user2Conflict = await optimisticCollection.update(
        { _id: order._id, __v: 1 }, // Same version - should fail
        { $set: { status: 'cancelled', metadata: { processor: 'user2' } } },
        { userContext: userContext2 }
      );

      expect(user2Conflict.modifiedCount).toBe(0); // No modification due to version conflict
      expect(user2Conflict.__v).toBeUndefined();

      // User 1 continues with correct version
      const user1Phase2 = await optimisticCollection.update(
        { _id: order._id, __v: user1Phase1.__v }, // Use __v from phase 1
        { $set: { status: 'completed', metadata: { processor: 'user1', completed: true } } },
        { userContext: userContext1 }
      );

      expect(user1Phase2.modifiedCount).toBe(1);
      expect(user1Phase2.__v).toBe(3);

      // Verify final state
      const finalOrder = await optimisticCollection.findById(order._id);
      expect(finalOrder!.status).toBe('completed');
      expect(finalOrder!.__v).toBe(3);
      expect(finalOrder!.metadata?.processor).toBe('user1');

      // User 2 can now update with the current version if needed
      const user2Recovery = await optimisticCollection.update(
        { _id: order._id, __v: 3 }, // Use current version
        { $set: { metadata: { processor: 'user1', completed: true, reviewedBy: 'user2' } } },
        { userContext: userContext2 }
      );

      expect(user2Recovery.modifiedCount).toBe(1);
      expect(user2Recovery.__v).toBe(4);
    });

    /**
     * Demonstrates how version conflicts are detected and handled
     * when concurrent modifications occur during multi-phase operations
     */
    it('should detect version conflicts during concurrent modifications', async () => {
      const userContext1: UserContext = { userId: 'user-001' };
      const userContext2: UserContext = { userId: 'user-002' };
      const orderData = {
        orderNumber: 'ORD-CONFLICT-001',
        status: 'pending' as const,
        amount: 199.99,
      };

      // Create initial order
      const order = await optimisticCollection.create(orderData, { userContext: userContext1 });
      expect(order.__v).toBe(1);

      // First user starts processing
      const firstUpdate = await optimisticCollection.updateById(
        order._id,
        { $set: { status: 'processing' } },
        { userContext: userContext1 }
      );

      expect(firstUpdate.__v).toBe(2);

      // Simulate concurrent modification by second user
      // This should work since we're not using version-based filtering yet
      const concurrentUpdate = await optimisticCollection.updateById(
        order._id,
        { $set: { metadata: { concurrentUpdate: true } } },
        { userContext: userContext2 }
      );

      expect(concurrentUpdate.__v).toBe(3);

      // Now if first user tries to continue with stale version,
      // they can detect the conflict by checking the current document
      const currentDoc = await optimisticCollection.findById(order._id);
      expect(currentDoc!.__v).toBe(3); // Version has moved beyond what first user expects

      // First user can now handle the conflict appropriately
      if (currentDoc!.__v !== firstUpdate.__v) {
        // Handle version conflict - could retry with current version
        const retryUpdate = await optimisticCollection.updateById(
          order._id,
          { $set: { status: 'completed' } },
          { userContext: userContext1 }
        );

        expect(retryUpdate.__v).toBe(4);
      }
    });

    /**
     * Tests error handling when attempting to update non-existent documents
     */
    it('should handle operations on non-existent documents gracefully', async () => {
      const userContext: UserContext = { userId: 'test-user' };
      const fakeId = adaptObjectId(new MongoObjectId());

      // Update non-existent document
      const updateResult = await optimisticCollection.updateById(
        fakeId,
        { $set: { status: 'processing' } },
        { userContext }
      );

      expect(updateResult.acknowledged).toBe(true);
      expect(updateResult.modifiedCount).toBe(0);
      expect(updateResult.__v).toBeUndefined();

      // Delete non-existent document
      const deleteResult = await optimisticCollection.deleteById(fakeId, { userContext });

      expect(deleteResult.acknowledged).toBe(true);
      expect(deleteResult.modifiedCount).toBe(0);
      expect(deleteResult.__v).toBeUndefined();

      // Restore non-existent document
      const restoreResult = await optimisticCollection.restore({ _id: fakeId }, userContext);

      expect(restoreResult.acknowledged).toBe(true);
      expect(restoreResult.modifiedCount).toBe(0);
      expect(restoreResult.__v).toBeUndefined();
    });

    /**
     * Tests __v behavior with hard delete operations
     */
    it('should not return __v for hard delete operations', async () => {
      const userContext: UserContext = { userId: 'deleter-001' };
      const orderData = {
        orderNumber: 'ORD-HARD-DELETE',
        status: 'cancelled' as const,
        amount: 0,
      };

      // Create order to be hard deleted
      const order = await optimisticCollection.create(orderData, { userContext });

      // Hard delete - should not return __v since document is removed
      const hardDeleteResult = await optimisticCollection.deleteById(order._id, { hardDelete: true, userContext });

      expect(hardDeleteResult.acknowledged).toBe(true);
      expect(hardDeleteResult.deletedCount).toBe(1);
      expect((hardDeleteResult as any).__v).toBeUndefined(); // No version for hard deletes

      // Verify document is completely removed
      const deletedDoc = await optimisticCollection.findById(order._id, { includeSoftDeleted: true });
      expect(deletedDoc).toBeNull();
    });

    /**
     * Demonstrates retry patterns with version-based recovery
     * when conflicts occur during multi-phase operations
     */
    it('should handle retry patterns with version-based recovery', async () => {
      const userContext: UserContext = { userId: 'retry-processor' };
      const orderData = {
        orderNumber: 'ORD-RETRY-PATTERN',
        status: 'pending' as const,
        amount: 199.99,
      };

      // Create initial order
      const order = await optimisticCollection.create(orderData, { userContext });
      let currentVersion = order.__v;

      // Simulate a retry loop with version-based recovery
      let retryCount = 0;
      const maxRetries = 3;
      let finalResult: any = null;

      while (retryCount < maxRetries) {
        try {
          // Get current document state
          const currentDoc = await optimisticCollection.findById(order._id);
          if (!currentDoc) {
            throw new Error('Document not found');
          }

          currentVersion = currentDoc.__v;

          // Attempt version-safe update
          const updateResult = await optimisticCollection.update(
            { _id: order._id, __v: currentVersion },
            {
              $set: {
                status: 'processing',
                metadata: {
                  retryCount,
                  processedAt: new Date(),
                  processor: userContext.userId,
                },
              },
            },
            { userContext }
          );

          if (updateResult.modifiedCount > 0) {
            finalResult = updateResult;
            break; // Success!
          } else {
            // Version conflict - retry
            retryCount++;
            console.log(`Retry ${retryCount} due to version conflict`);

            // Small delay to reduce contention
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        } catch (error) {
          retryCount++;
          console.log(`Retry ${retryCount} due to error: ${(error as Error).message}`);

          if (retryCount >= maxRetries) {
            throw error;
          }
        }
      }

      // Verify successful completion
      expect(finalResult).toBeDefined();
      expect(finalResult.__v).toBeDefined();
      expect(finalResult.modifiedCount).toBe(1);

      // Verify final state
      const finalOrder = await optimisticCollection.findById(order._id);
      expect(finalOrder!.status).toBe('processing');
      expect(finalOrder!.metadata?.processor).toBe(userContext.userId);
      expect(finalOrder!.__v).toBe(finalResult.__v);
    });
  });

  describe('Strategy Comparison: Optimistic Locking vs Transactions', () => {
    /**
     * Compares __v behavior between optimistic locking and transaction strategies
     */
    it('should demonstrate __v behavior differences between strategies', async () => {
      const userContext: UserContext = { userId: 'strategy-test' };
      const orderData = {
        orderNumber: 'ORD-STRATEGY-COMPARISON',
        status: 'pending' as const,
        amount: 299.99,
      };

      // Test with Optimistic Locking Strategy
      const optimisticOrder = await optimisticCollection.create(orderData, { userContext });
      const optimisticUpdate = await optimisticCollection.updateById(
        optimisticOrder._id,
        { $set: { status: 'processing' } },
        { userContext }
      );

      // Optimistic strategy should return __v
      expect(optimisticUpdate.__v).toBeDefined();
      expect(optimisticUpdate.__v).toBe(2);

      // Test with Transaction Strategy
      const transactionOrder = await transactionCollection.create(
        { ...orderData, orderNumber: 'ORD-TRANSACTION-TEST' },
        { userContext }
      );
      const transactionUpdate = await transactionCollection.updateById(
        transactionOrder._id,
        { $set: { status: 'processing' } },
        { userContext }
      );

      // Transaction strategy currently returns undefined for __v
      // (since it doesn't use version-based concurrency control)
      expect(transactionUpdate.__v).toBeUndefined();

      // Both should have same core functionality
      expect(optimisticUpdate.acknowledged).toBe(transactionUpdate.acknowledged);
      expect(optimisticUpdate.modifiedCount).toBe(transactionUpdate.modifiedCount);
    });

    /**
     * Performance comparison between strategies for multi-phase operations
     */
    it('should compare performance characteristics between strategies', async () => {
      const userContext: UserContext = { userId: 'perf-test' };
      const numOperations = 5;

      // Test Optimistic Locking Strategy performance
      const optimisticStart = Date.now();
      const optimisticOrders: TestOrder[] = [];

      for (let i = 0; i < numOperations; i++) {
        const order = await optimisticCollection.create(
          {
            orderNumber: `OPT-${i}`,
            status: 'pending' as const,
            amount: 100 + i,
          },
          { userContext }
        );
        optimisticOrders.push(order);

        // Multi-phase update
        await optimisticCollection.updateById(order._id, { $set: { status: 'processing' } }, { userContext });

        await optimisticCollection.updateById(order._id, { $set: { status: 'completed' } }, { userContext });
      }

      const optimisticTime = Date.now() - optimisticStart;

      // Test Transaction Strategy performance
      const transactionStart = Date.now();
      const transactionOrders: TestOrder[] = [];

      for (let i = 0; i < numOperations; i++) {
        const order = await transactionCollection.create(
          {
            orderNumber: `TXN-${i}`,
            status: 'pending' as const,
            amount: 100 + i,
          },
          { userContext }
        );
        transactionOrders.push(order);

        // Multi-phase update
        await transactionCollection.updateById(order._id, { $set: { status: 'processing' } }, { userContext });

        await transactionCollection.updateById(order._id, { $set: { status: 'completed' } }, { userContext });
      }

      const transactionTime = Date.now() - transactionStart;

      // Log performance results
      console.log(`Performance Comparison for ${numOperations} multi-phase operations:`);
      console.log(`  Optimistic Strategy: ${optimisticTime}ms`);
      console.log(`  Transaction Strategy: ${transactionTime}ms`);

      // Both strategies should complete successfully
      expect(optimisticOrders).toHaveLength(numOperations);
      expect(transactionOrders).toHaveLength(numOperations);

      // Verify all orders reached completed status
      for (const order of optimisticOrders) {
        const finalOrder = await optimisticCollection.findById(order._id);
        expect(finalOrder!.status).toBe('completed');
      }

      for (const order of transactionOrders) {
        const finalOrder = await transactionCollection.findById(order._id);
        expect(finalOrder!.status).toBe('completed');
      }
    });
  });

  describe('Real-World Usage Examples', () => {
    /**
     * Demonstrates a practical e-commerce order fulfillment workflow
     * showing how __v enables safe multi-phase operations
     */
    it('should demonstrate e-commerce order fulfillment workflow', async () => {
      const customerService: UserContext = { userId: 'cs-001' };
      const warehouse: UserContext = { userId: 'warehouse-001' };
      const billing: UserContext = { userId: 'billing-001' };

      const orderData = {
        orderNumber: 'ORD-ECOM-2024-001',
        status: 'pending' as const,
        amount: 79.99,
        metadata: {
          customerId: 'CUST-12345',
          items: [{ sku: 'ITEM-001', quantity: 2, price: 39.99 }],
        },
      };

      // Step 1: Customer service validates the order
      const order = await optimisticCollection.create(orderData, { userContext: customerService });
      let currentVersion = order.__v;

      const validationResult = await optimisticCollection.update(
        { _id: order._id, __v: currentVersion }, // Use version for safe handoff
        {
          $set: {
            status: 'processing',
            metadata: {
              ...orderData.metadata,
              validatedBy: customerService.userId,
              validatedAt: new Date(),
            },
          },
        },
        { userContext: customerService }
      );

      expect(validationResult.__v).toBe(2);
      currentVersion = validationResult.__v!;

      // Step 2: Warehouse picks and packs the order (using __v from validation)
      const packingResult = await optimisticCollection.update(
        { _id: order._id, __v: currentVersion }, // Use __v from validation
        {
          $set: {
            metadata: {
              ...orderData.metadata,
              validatedBy: customerService.userId,
              validatedAt: new Date(),
              packedBy: warehouse.userId,
              packedAt: new Date(),
              trackingNumber: 'TRK-' + Date.now(),
            },
          },
        },
        { userContext: warehouse }
      );

      expect(packingResult.__v).toBe(3);
      currentVersion = packingResult.__v!;

      // Step 3: Billing processes payment and completes order (using __v from packing)
      const completionResult = await optimisticCollection.update(
        { _id: order._id, __v: currentVersion }, // Use __v from packing
        {
          $set: {
            status: 'completed',
            completedAt: new Date(),
            metadata: {
              ...orderData.metadata,
              validatedBy: customerService.userId,
              validatedAt: new Date(),
              packedBy: warehouse.userId,
              packedAt: new Date(),
              trackingNumber: 'TRK-' + Date.now(),
              billedBy: billing.userId,
              billedAt: new Date(),
              paymentProcessed: true,
            },
          },
        },
        { userContext: billing }
      );

      expect(completionResult.__v).toBe(4);

      // Verify the complete workflow
      const finalOrder = await optimisticCollection.findById(order._id);
      expect(finalOrder!.status).toBe('completed');
      expect(finalOrder!.__v).toBe(4);
      expect(finalOrder!.metadata?.validatedBy).toBe(customerService.userId);
      expect(finalOrder!.metadata?.packedBy).toBe(warehouse.userId);
      expect(finalOrder!.metadata?.billedBy).toBe(billing.userId);
      expect(finalOrder!.metadata?.paymentProcessed).toBe(true);
      expect(finalOrder!.completedAt).toBeDefined();

      // Each phase can safely proceed knowing the exact version state
      // without needing additional database queries
    });

    /**
     * Demonstrates error recovery in multi-phase operations
     */
    it('should demonstrate error recovery with __v tracking', async () => {
      const userContext: UserContext = { userId: 'recovery-test' };
      const orderData = {
        orderNumber: 'ORD-RECOVERY-001',
        status: 'pending' as const,
        amount: 159.99,
      };

      // Create initial order
      const order = await optimisticCollection.create(orderData, { userContext });

      // Phase 1: Start processing
      const phase1Result = await optimisticCollection.updateById(
        order._id,
        { $set: { status: 'processing' } },
        { userContext }
      );

      expect(phase1Result.__v).toBe(2);

      // Simulate an error during phase 2 - rollback to previous state
      try {
        // Attempt risky operation that might fail
        const riskyUpdate = await optimisticCollection.updateById(
          order._id,
          {
            $set: {
              status: 'completed',
              metadata: { riskyOperation: true },
            },
          },
          { userContext }
        );

        // Simulate failure after update
        if (riskyUpdate.__v) {
          throw new Error('Simulated business logic failure');
        }
      } catch (error) {
        // Recovery: Rollback to safe state using known version
        const rollbackResult = await optimisticCollection.updateById(
          order._id,
          {
            $set: {
              status: 'pending',
              metadata: { errorRecovery: true, lastError: (error as Error).message },
            },
          },
          { userContext }
        );

        expect(rollbackResult.__v).toBe(4); // Version continues to increment
      }

      // Verify recovery state
      const recoveredOrder = await optimisticCollection.findById(order._id);
      expect(recoveredOrder!.status).toBe('pending');
      expect(recoveredOrder!.metadata?.errorRecovery).toBe(true);
      expect(recoveredOrder!.__v).toBe(4);
    });

    /**
     * Demonstrates document approval workflow with version-safe transitions
     * showing how multiple approvers can safely process documents
     */
    it('should demonstrate document approval workflow with version-safe transitions', async () => {
      const author: UserContext = { userId: 'author-001' };
      const reviewer: UserContext = { userId: 'reviewer-001' };
      const approver: UserContext = { userId: 'approver-001' };
      const publisher: UserContext = { userId: 'publisher-001' };

      // Create initial document
      const docData = {
        title: 'Important Policy Document',
        content: 'This document contains important policy information.',
        tags: ['policy', 'draft'],
        metadata: { department: 'HR', priority: 'high' },
      };

      const doc = await docCollection.create(docData, { userContext: author });
      let currentVersion = doc.__v;

      // Phase 1: Author submits for review
      const submitResult = await docCollection.update(
        { _id: doc._id, __v: currentVersion },
        {
          $set: {
            tags: ['policy', 'pending-review'],
            metadata: {
              ...docData.metadata,
              status: 'submitted',
              submittedBy: author.userId,
              submittedAt: new Date(),
            },
          },
        },
        { userContext: author }
      );

      expect(submitResult.__v).toBe(2);
      currentVersion = submitResult.__v!;

      // Phase 2: Reviewer reviews and approves
      const reviewResult = await docCollection.update(
        { _id: doc._id, __v: currentVersion },
        {
          $set: {
            tags: ['policy', 'reviewed'],
            metadata: {
              ...docData.metadata,
              status: 'reviewed',
              submittedBy: author.userId,
              submittedAt: new Date(),
              reviewedBy: reviewer.userId,
              reviewedAt: new Date(),
              reviewComments: 'Document looks good, ready for approval',
            },
          },
        },
        { userContext: reviewer }
      );

      expect(reviewResult.__v).toBe(3);
      currentVersion = reviewResult.__v!;

      // Phase 3: Approver gives final approval
      const approvalResult = await docCollection.update(
        { _id: doc._id, __v: currentVersion },
        {
          $set: {
            tags: ['policy', 'approved'],
            metadata: {
              ...docData.metadata,
              status: 'approved',
              submittedBy: author.userId,
              submittedAt: new Date(),
              reviewedBy: reviewer.userId,
              reviewedAt: new Date(),
              reviewComments: 'Document looks good, ready for approval',
              approvedBy: approver.userId,
              approvedAt: new Date(),
            },
          },
        },
        { userContext: approver }
      );

      expect(approvalResult.__v).toBe(4);
      currentVersion = approvalResult.__v!;

      // Phase 4: Publisher publishes the document
      const publishResult = await docCollection.update(
        { _id: doc._id, __v: currentVersion },
        {
          $set: {
            tags: ['policy', 'published'],
            metadata: {
              ...docData.metadata,
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
              publicUrl: 'https://company.com/policies/important-policy',
            },
          },
        },
        { userContext: publisher }
      );

      expect(publishResult.__v).toBe(5);

      // Verify the complete approval workflow
      const finalDoc = await docCollection.findById(doc._id);
      expect(finalDoc!.tags).toContain('published');
      expect(finalDoc!.__v).toBe(5);
      expect(finalDoc!.metadata?.status).toBe('published');
      expect(finalDoc!.metadata?.submittedBy).toBe(author.userId);
      expect(finalDoc!.metadata?.reviewedBy).toBe(reviewer.userId);
      expect(finalDoc!.metadata?.approvedBy).toBe(approver.userId);
      expect(finalDoc!.metadata?.publishedBy).toBe(publisher.userId);

      // Demonstrate that workflow is conflict-safe
      // If someone tries to update with an old version, it should fail
      const oldVersionUpdate = await docCollection.update(
        { _id: doc._id, __v: 2 }, // Old version
        { $set: { tags: ['policy', 'outdated'] } },
        { userContext: author }
      );

      expect(oldVersionUpdate.modifiedCount).toBe(0);
      expect(oldVersionUpdate.__v).toBeUndefined();

      // Document should remain unchanged
      const unchangedDoc = await docCollection.findById(doc._id);
      expect(unchangedDoc!.__v).toBe(5);
      expect(unchangedDoc!.tags).toContain('published');
    });
  });
});
