import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectId as MongoObjectId, Db as MongoDb } from 'mongodb';
import { MonguardCollection } from '../../src/monguard-collection';
import { MonguardAuditLogger } from '../../src/audit-logger';
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
      auditLogger: new MonguardAuditLogger(db, 'transaction_audit_logs'),
      concurrency: { transactionsEnabled: true },
      auditControl: {
        enableAutoAudit: true,
        failOnError: true, // Enable strict audit failure handling for transaction tests
      },
    });

    optimisticCollection = new MonguardCollection<TestUser>(db, 'optimistic_users', {
      auditLogger: new MonguardAuditLogger(db, 'optimistic_audit_logs'),
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

      // Both should have similar structure (excluding _id)
      expect(transactionResult.name).toBe(userData1.name);
      expect(optimisticResult.name).toBe(userData2.name);

      TestAssertions.expectTimestamps(transactionResult);
      TestAssertions.expectTimestamps(optimisticResult);

      TestAssertions.expectUserTracking(transactionResult, userContext.userId as any);
      TestAssertions.expectUserTracking(optimisticResult, userContext.userId as any);

      // Both should create audit logs
      const transactionAuditLogs = await transactionCollection.getAuditCollection()!.find({}).toArray();
      const optimisticAuditLogs = await optimisticCollection.getAuditCollection()!.find({}).toArray();

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

      // Update both documents
      const updateData = { $set: { name: 'Updated Name', age: 30 } };

      const transactionUpdate = await transactionCollection.updateById(transactionCreate._id, updateData, {
        userContext,
      });

      const optimisticUpdate = await optimisticCollection.updateById(optimisticCreate._id, updateData, {
        userContext,
      });

      // Both updates should succeed

      expect(transactionUpdate.modifiedCount).toBe(1);
      expect(optimisticUpdate.modifiedCount).toBe(1);

      // Verify updated documents
      const transactionDoc = await transactionCollection.findById(transactionCreate._id);
      const optimisticDoc = await optimisticCollection.findById(optimisticCreate._id);

      expect(transactionDoc!.name).toBe('Updated Name');
      expect(optimisticDoc!.name).toBe('Updated Name');
      expect(transactionDoc!.age).toBe(30);
      expect(optimisticDoc!.age).toBe(30);

      // Both should have create + update audit logs
      const transactionAuditLogs = await transactionCollection.getAuditCollection()!.find({}).toArray();
      const optimisticAuditLogs = await optimisticCollection.getAuditCollection()!.find({}).toArray();

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

      const transactionDelete = await transactionCollection.deleteById(transactionCreate._id, { userContext });

      const optimisticDelete = await optimisticCollection.deleteById(optimisticCreate._id, { userContext });

      // Both deletes should succeed

      // Both documents should not be found in normal search
      const transactionFind = await transactionCollection.findById(transactionCreate._id);
      const optimisticFind = await optimisticCollection.findById(optimisticCreate._id);

      expect(transactionFind).toBeNull();
      expect(optimisticFind).toBeNull();

      // Both should be found with includeSoftDeleted
      const transactionDeleted = await transactionCollection.findById(transactionCreate._id, {
        includeSoftDeleted: true,
      });
      const optimisticDeleted = await optimisticCollection.findById(optimisticCreate._id, {
        includeSoftDeleted: true,
      });

      expect(transactionDeleted!.deletedAt).toBeInstanceOf(Date);
      expect(optimisticDeleted!.deletedAt).toBeInstanceOf(Date);
    });

    it('should produce equivalent results for hard delete operations', async () => {
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      // Create documents in both collections
      const transactionCreate = await transactionCollection.create(userData, { userContext });
      const optimisticCreate = await optimisticCollection.create(userData, { userContext });

      // Hard delete both documents

      const transactionDelete = await transactionCollection.deleteById(transactionCreate._id, {
        userContext,
        hardDelete: true,
      });

      const optimisticDelete = await optimisticCollection.deleteById(optimisticCreate._id, {
        userContext,
        hardDelete: true,
      });

      // Both deletes should succeed

      // Both documents should be completely gone
      const transactionFind = await transactionCollection.findById(transactionCreate._id, {
        includeSoftDeleted: true,
      });
      const optimisticFind = await optimisticCollection.findById(optimisticCreate._id, {
        includeSoftDeleted: true,
      });

      expect(transactionFind).toBeNull();
      expect(optimisticFind).toBeNull();
    });
  });

  describe('Version Handling Differences', () => {
    it('should handle version field differently between strategies', async () => {
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      // Create documents in both collections
      const transactionCreate = await transactionCollection.create(userData, { userContext });
      const optimisticCreate = await optimisticCollection.create(userData, { userContext });

      // Transaction strategy doesn't use version field
      expect(transactionCreate.__v).toBeUndefined();

      // Optimistic strategy should add version field
      expect(optimisticCreate.__v).toBe(1);

      // Update both documents
      const transactionUpdate = await transactionCollection.updateById(
        transactionCreate._id,
        { $set: { name: 'Updated' } },
        { userContext }
      );

      const optimisticUpdate = await optimisticCollection.updateById(
        optimisticCreate._id,
        { $set: { name: 'Updated' } },
        { userContext }
      );

      // Check version handling after update
      const transactionDoc = await transactionCollection.findById(transactionCreate._id);
      const optimisticDoc = await optimisticCollection.findById(optimisticCreate._id);

      // Transaction strategy still doesn't use version
      expect(transactionDoc!.__v).toBeUndefined();

      // Optimistic strategy should increment version
      expect(optimisticDoc!.__v).toBe(2);
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
      }
      const transactionDuration = Date.now() - transactionStart;

      // Test optimistic strategy performance
      const optimisticStart = Date.now();
      for (const userData of users.slice(10, 20)) {
        const result = await optimisticCollection.create(userData, { userContext });
      }
      const optimisticDuration = Date.now() - optimisticStart;

      // Verify both completed
      const transactionCount = await transactionCollection.count({});
      const optimisticCount = await optimisticCollection.count({});

      expect(transactionCount).toBe(10);
      expect(optimisticCount).toBe(10);

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

      // Verify final counts
      const transactionCount = await transactionCollection.count({});
      const optimisticCount = await optimisticCollection.count({});

      expect(transactionCount).toBe(5);
      expect(optimisticCount).toBe(5);
    });

    it('should handle concurrent updates to same document differently', async () => {
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      // Create documents in both collections
      const transactionCreate = await transactionCollection.create(userData, { userContext });
      const optimisticCreate = await optimisticCollection.create(userData, { userContext });

      // Concurrent updates to the same document
      const transactionPromises = [
        transactionCollection.updateById(transactionCreate._id, { $set: { name: 'Update 1' } }, { userContext }),
        transactionCollection.updateById(transactionCreate._id, { $set: { name: 'Update 2' } }, { userContext }),
      ];

      const optimisticPromises = [
        optimisticCollection.updateById(optimisticCreate._id, { $set: { name: 'Update 1' } }, { userContext }),
        optimisticCollection.updateById(optimisticCreate._id, { $set: { name: 'Update 2' } }, { userContext }),
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
      const transactionDoc = await transactionCollection.findById(transactionCreate._id);
      const optimisticDoc = await optimisticCollection.findById(optimisticCreate._id);

      // Both should have been updated to one of the values
      expect(['Update 1', 'Update 2']).toContain(transactionDoc!.name);
      expect(['Update 1', 'Update 2']).toContain(optimisticDoc!.name);
    });
  });

  describe('Error Handling Comparison', () => {
    it('should handle audit failures differently between strategies', async () => {
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      // Mock audit failures for both strategies
      const transactionAuditSpy = vi
        .spyOn(transactionCollection.getAuditCollection()!, 'insertOne')
        .mockRejectedValue(new Error('Transaction audit failed'));

      const optimisticAuditSpy = vi
        .spyOn(optimisticCollection.getAuditCollection()!, 'insertOne')
        .mockRejectedValue(new Error('Optimistic audit failed'));

      // TransactionStrategy: Should fail completely due to transaction rollback
      await expect(transactionCollection.create(userData, { userContext })).rejects.toThrow();

      // OptimisticLockingStrategy: Should succeed despite audit failure
      const optimisticResult = await optimisticCollection.create(userData, { userContext });
      expect(optimisticResult).toBeDefined();
      expect(optimisticResult.name).toBe(userData.name);

      // Verify document creation outcomes
      const transactionDocs = await transactionCollection.find({});
      const optimisticDocs = await optimisticCollection.find({});

      // Transaction strategy: No documents created due to rollback
      expect(transactionDocs).toHaveLength(0);

      // Optimistic strategy: Document created despite audit failure
      expect(optimisticDocs).toHaveLength(1);

      // Verify audit operations were attempted
      expect(transactionAuditSpy).toHaveBeenCalled();
      expect(optimisticAuditSpy).toHaveBeenCalled();

      // Cleanup
      transactionAuditSpy.mockRestore();
      optimisticAuditSpy.mockRestore();
    });
  });
});
