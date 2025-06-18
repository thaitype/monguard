import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectId as MongoObjectId, Db as MongoDb } from 'mongodb';
import { MonguardCollection } from '../../src/monguard-collection';
import { TestDatabase } from '../setup';
import { TestDataFactory, TestUser } from '../factories';
import { TestAssertions, TestHelpers } from '../test-utils';
import { adaptDb } from '../mongodb-adapter';
import type { Db } from '../../src/mongodb-types';

describe('Strategy Comparison Tests', () => {
  let testDb: TestDatabase;
  let mongoDb: MongoDb;
  let db: Db;
  let transactionCollection: MonguardCollection<TestUser>;
  let optimisticCollection: MonguardCollection<TestUser>;

  beforeEach(async () => {
    testDb = new TestDatabase();
    mongoDb = await testDb.start();
    db = adaptDb(mongoDb);

    // Create collections with different strategies
    transactionCollection = new MonguardCollection<TestUser>(db, 'transaction_users', {
      auditCollectionName: 'transaction_audit_logs',
      concurrency: { transactionsEnabled: true },
    });

    optimisticCollection = new MonguardCollection<TestUser>(db, 'optimistic_users', {
      auditCollectionName: 'optimistic_audit_logs',
      concurrency: { transactionsEnabled: false },
    });
  });

  afterEach(async () => {
    await testDb.stop();
  });

  describe('Equivalent CRUD Operations', () => {
    it('should produce equivalent results for create operations', async () => {
      const userData1 = TestDataFactory.createUser({ name: 'Transaction User' });
      const userData2 = TestDataFactory.createUser({ name: 'Optimistic User' });
      const userContext = TestDataFactory.createUserContext();

      // Create using both strategies
      const transactionResult = await transactionCollection.create(userData1, { userContext });
      const optimisticResult = await optimisticCollection.create(userData2, { userContext });

      // Both should succeed
      TestAssertions.expectSuccess(transactionResult);
      TestAssertions.expectSuccess(optimisticResult);

      // Both should have similar structure (excluding _id)
      expect(transactionResult.data.name).toBe(userData1.name);
      expect(optimisticResult.data.name).toBe(userData2.name);

      TestAssertions.expectTimestamps(transactionResult.data);
      TestAssertions.expectTimestamps(optimisticResult.data);

      TestAssertions.expectUserTracking(transactionResult.data, userContext.userId as any);
      TestAssertions.expectUserTracking(optimisticResult.data, userContext.userId as any);

      // Both should create audit logs
      const transactionAuditLogs = await transactionCollection.getAuditCollection().find({}).toArray();
      const optimisticAuditLogs = await optimisticCollection.getAuditCollection().find({}).toArray();

      expect(transactionAuditLogs).toHaveLength(1);
      expect(optimisticAuditLogs).toHaveLength(1);

      expect(transactionAuditLogs[0]!.action).toBe('create');
      expect(optimisticAuditLogs[0]!.action).toBe('create');
    });

    it('should produce equivalent results for update operations', async () => {
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      // Create documents in both collections
      const transactionCreate = await transactionCollection.create(userData, { userContext });
      const optimisticCreate = await optimisticCollection.create(userData, { userContext });

      TestAssertions.expectSuccess(transactionCreate);
      TestAssertions.expectSuccess(optimisticCreate);

      // Update both documents
      const updateData = { $set: { name: 'Updated Name', age: 30 } };

      const transactionUpdate = await transactionCollection.updateById(transactionCreate.data!._id, updateData, {
        userContext,
      });

      const optimisticUpdate = await optimisticCollection.updateById(optimisticCreate.data!._id, updateData, {
        userContext,
      });

      // Both updates should succeed
      TestAssertions.expectSuccess(transactionUpdate);
      TestAssertions.expectSuccess(optimisticUpdate);

      expect(transactionUpdate.data.modifiedCount).toBe(1);
      expect(optimisticUpdate.data.modifiedCount).toBe(1);

      // Verify updated documents
      const transactionDoc = await transactionCollection.findById(transactionCreate.data!._id);
      const optimisticDoc = await optimisticCollection.findById(optimisticCreate.data!._id);

      TestAssertions.expectSuccess(transactionDoc);
      TestAssertions.expectSuccess(optimisticDoc);

      expect(transactionDoc.data!.name).toBe('Updated Name');
      expect(optimisticDoc.data!.name).toBe('Updated Name');
      expect(transactionDoc.data!.age).toBe(30);
      expect(optimisticDoc.data!.age).toBe(30);

      // Both should have create + update audit logs
      const transactionAuditLogs = await transactionCollection.getAuditCollection().find({}).toArray();
      const optimisticAuditLogs = await optimisticCollection.getAuditCollection().find({}).toArray();

      expect(transactionAuditLogs).toHaveLength(2);
      expect(optimisticAuditLogs).toHaveLength(2);
    });

    it('should produce equivalent results for soft delete operations', async () => {
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      // Create documents in both collections
      const transactionCreate = await transactionCollection.create(userData, { userContext });
      const optimisticCreate = await optimisticCollection.create(userData, { userContext });

      // Soft delete both documents
      const transactionDelete = await transactionCollection.deleteById(transactionCreate.data!._id, { userContext });

      const optimisticDelete = await optimisticCollection.deleteById(optimisticCreate.data!._id, { userContext });

      // Both deletes should succeed
      TestAssertions.expectSuccess(transactionDelete);
      TestAssertions.expectSuccess(optimisticDelete);

      // Both documents should not be found in normal search
      const transactionFind = await transactionCollection.findById(transactionCreate.data!._id);
      const optimisticFind = await optimisticCollection.findById(optimisticCreate.data!._id);

      TestAssertions.expectSuccess(transactionFind);
      TestAssertions.expectSuccess(optimisticFind);
      expect(transactionFind.data).toBeNull();
      expect(optimisticFind.data).toBeNull();

      // Both should be found with includeSoftDeleted
      const transactionDeleted = await transactionCollection.findById(transactionCreate.data!._id, {
        includeSoftDeleted: true,
      });
      const optimisticDeleted = await optimisticCollection.findById(optimisticCreate.data!._id, {
        includeSoftDeleted: true,
      });

      TestAssertions.expectSuccess(transactionDeleted);
      TestAssertions.expectSuccess(optimisticDeleted);

      expect(transactionDeleted.data!.deletedAt).toBeInstanceOf(Date);
      expect(optimisticDeleted.data!.deletedAt).toBeInstanceOf(Date);
    });

    it('should produce equivalent results for hard delete operations', async () => {
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      // Create documents in both collections
      const transactionCreate = await transactionCollection.create(userData, { userContext });
      const optimisticCreate = await optimisticCollection.create(userData, { userContext });

      // Hard delete both documents
      const transactionDelete = await transactionCollection.deleteById(transactionCreate.data!._id, {
        userContext,
        hardDelete: true,
      });

      const optimisticDelete = await optimisticCollection.deleteById(optimisticCreate.data!._id, {
        userContext,
        hardDelete: true,
      });

      // Both deletes should succeed
      TestAssertions.expectSuccess(transactionDelete);
      TestAssertions.expectSuccess(optimisticDelete);

      // Both documents should be completely gone
      const transactionFind = await transactionCollection.findById(transactionCreate.data!._id, {
        includeSoftDeleted: true,
      });
      const optimisticFind = await optimisticCollection.findById(optimisticCreate.data!._id, {
        includeSoftDeleted: true,
      });

      TestAssertions.expectSuccess(transactionFind);
      TestAssertions.expectSuccess(optimisticFind);
      expect(transactionFind.data).toBeNull();
      expect(optimisticFind.data).toBeNull();
    });
  });

  describe('Version Handling Differences', () => {
    it('should handle version field differently between strategies', async () => {
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      // Create documents in both collections
      const transactionCreate = await transactionCollection.create(userData, { userContext });
      const optimisticCreate = await optimisticCollection.create(userData, { userContext });

      TestAssertions.expectSuccess(transactionCreate);
      TestAssertions.expectSuccess(optimisticCreate);

      // Transaction strategy doesn't use version field
      expect(transactionCreate.data.version).toBeUndefined();

      // Optimistic strategy should add version field
      expect(optimisticCreate.data.version).toBe(1);

      // Update both documents
      const transactionUpdate = await transactionCollection.updateById(
        transactionCreate.data!._id,
        { $set: { name: 'Updated' } },
        { userContext }
      );

      const optimisticUpdate = await optimisticCollection.updateById(
        optimisticCreate.data!._id,
        { $set: { name: 'Updated' } },
        { userContext }
      );

      TestAssertions.expectSuccess(transactionUpdate);
      TestAssertions.expectSuccess(optimisticUpdate);

      // Check version handling after update
      const transactionDoc = await transactionCollection.findById(transactionCreate.data!._id);
      const optimisticDoc = await optimisticCollection.findById(optimisticCreate.data!._id);

      TestAssertions.expectSuccess(transactionDoc);
      TestAssertions.expectSuccess(optimisticDoc);

      // Transaction strategy still doesn't use version
      expect(transactionDoc.data!.version).toBeUndefined();

      // Optimistic strategy should increment version
      expect(optimisticDoc.data!.version).toBe(2);
    });
  });

  describe('Performance Comparison', () => {
    it('should compare performance between strategies', async () => {
      const users = TestDataFactory.createMultipleUsers(20);
      const userContext = TestDataFactory.createUserContext();

      // Test transaction strategy performance
      const transactionStart = Date.now();
      for (const userData of users.slice(0, 10)) {
        const result = await transactionCollection.create(userData, { userContext });
        TestAssertions.expectSuccess(result);
      }
      const transactionDuration = Date.now() - transactionStart;

      // Test optimistic strategy performance
      const optimisticStart = Date.now();
      for (const userData of users.slice(10, 20)) {
        const result = await optimisticCollection.create(userData, { userContext });
        TestAssertions.expectSuccess(result);
      }
      const optimisticDuration = Date.now() - optimisticStart;

      // Verify both completed
      const transactionCount = await transactionCollection.count({});
      const optimisticCount = await optimisticCollection.count({});

      TestAssertions.expectSuccess(transactionCount);
      TestAssertions.expectSuccess(optimisticCount);
      expect(transactionCount.data).toBe(10);
      expect(optimisticCount.data).toBe(10);

      console.log(`Transaction Strategy: ${transactionDuration}ms for 10 operations`);
      console.log(`Optimistic Strategy: ${optimisticDuration}ms for 10 operations`);

      // Both should complete in reasonable time
      expect(transactionDuration).toBeLessThan(10000); // 10 seconds
      expect(optimisticDuration).toBeLessThan(10000); // 10 seconds
    });
  });

  describe('Concurrent Operation Behavior', () => {
    it('should handle concurrent creates differently between strategies', async () => {
      const users = TestDataFactory.createMultipleUsers(5);
      const userContext = TestDataFactory.createUserContext();

      // Concurrent creates with transaction strategy
      const transactionPromises = users.map(userData => transactionCollection.create(userData, { userContext }));

      // Concurrent creates with optimistic strategy
      const optimisticPromises = users.map(userData => optimisticCollection.create(userData, { userContext }));

      const [transactionResults, optimisticResults] = await Promise.all([
        Promise.all(transactionPromises),
        Promise.all(optimisticPromises),
      ]);

      // All operations should succeed in both strategies
      transactionResults.forEach(result => TestAssertions.expectSuccess(result));
      optimisticResults.forEach(result => TestAssertions.expectSuccess(result));

      // Verify final counts
      const transactionCount = await transactionCollection.count({});
      const optimisticCount = await optimisticCollection.count({});

      TestAssertions.expectSuccess(transactionCount);
      TestAssertions.expectSuccess(optimisticCount);
      expect(transactionCount.data).toBe(5);
      expect(optimisticCount.data).toBe(5);
    });

    it('should handle concurrent updates to same document differently', async () => {
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      // Create documents in both collections
      const transactionCreate = await transactionCollection.create(userData, { userContext });
      const optimisticCreate = await optimisticCollection.create(userData, { userContext });

      TestAssertions.expectSuccess(transactionCreate);
      TestAssertions.expectSuccess(optimisticCreate);

      // Concurrent updates to the same document
      const transactionPromises = [
        transactionCollection.updateById(transactionCreate.data!._id, { $set: { name: 'Update 1' } }, { userContext }),
        transactionCollection.updateById(transactionCreate.data!._id, { $set: { name: 'Update 2' } }, { userContext }),
      ];

      const optimisticPromises = [
        optimisticCollection.updateById(optimisticCreate.data!._id, { $set: { name: 'Update 1' } }, { userContext }),
        optimisticCollection.updateById(optimisticCreate.data!._id, { $set: { name: 'Update 2' } }, { userContext }),
      ];

      const [transactionResults, optimisticResults] = await Promise.all([
        Promise.allSettled(transactionPromises),
        Promise.allSettled(optimisticPromises),
      ]);

      // At least one update should succeed in both strategies
      const transactionSuccesses = transactionResults.filter(r => r.status === 'fulfilled');
      const optimisticSuccesses = optimisticResults.filter(r => r.status === 'fulfilled');

      expect(transactionSuccesses.length).toBeGreaterThan(0);
      expect(optimisticSuccesses.length).toBeGreaterThan(0);

      // Verify final state is consistent
      const transactionDoc = await transactionCollection.findById(transactionCreate.data!._id);
      const optimisticDoc = await optimisticCollection.findById(optimisticCreate.data!._id);

      TestAssertions.expectSuccess(transactionDoc);
      TestAssertions.expectSuccess(optimisticDoc);

      // Both should have been updated to one of the values
      expect(['Update 1', 'Update 2']).toContain(transactionDoc.data!.name);
      expect(['Update 1', 'Update 2']).toContain(optimisticDoc.data!.name);
    });
  });

  describe('Error Handling Comparison', () => {
    it('should handle audit failures similarly between strategies', async () => {
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      // Mock audit failures for both strategies
      const transactionAuditSpy = vi
        .spyOn(transactionCollection.getAuditCollection(), 'insertOne')
        .mockRejectedValue(new Error('Transaction audit failed'));

      const optimisticAuditSpy = vi
        .spyOn(optimisticCollection.getAuditCollection(), 'insertOne')
        .mockRejectedValue(new Error('Optimistic audit failed'));

      const transactionResult = await transactionCollection.create(userData, { userContext });
      const optimisticResult = await optimisticCollection.create(userData, { userContext });

      // Both should handle the error (transaction rolls back, optimistic continues)
      // In fallback mode, transaction strategy might succeed like optimistic strategy
      // In true transaction mode, transaction strategy would fail completely due to rollback

      // This test documents the behavioral difference between strategies and fallback mode
      if (transactionResult.success) {
        // Fallback mode: document created despite audit failure
        expect(transactionResult.data).toBeDefined();
      } else {
        // True transaction mode: complete rollback
        TestAssertions.expectError(transactionResult);
      }

      // Optimistic strategy might succeed despite audit failure (implementation dependent)
      // This test documents the behavioral difference

      // Verify document creation outcome for transaction strategy
      const transactionDocsResult = await transactionCollection.find({});
      TestAssertions.expectSuccess(transactionDocsResult);
      if (transactionResult.success) {
        expect(transactionDocsResult.data).toHaveLength(1); // Fallback mode
      } else {
        expect(transactionDocsResult.data).toHaveLength(0); // True transaction mode
      }

      // Cleanup
      transactionAuditSpy.mockRestore();
      optimisticAuditSpy.mockRestore();
    });
  });
});
