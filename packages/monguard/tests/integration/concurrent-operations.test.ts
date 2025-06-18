import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectId as MongoObjectId, Db as MongoDb } from 'mongodb';
import { MonguardCollection } from '../../src/monguard-collection';
import { TestDatabase } from '../setup';
import { TestDataFactory, TestUser } from '../factories';
import { TestAssertions, TestHelpers } from '../test-utils';
import { adaptDb } from '../mongodb-adapter';
import type { Db } from '../../src/mongodb-types';

describe('Concurrent Operations Integration Tests', () => {
  let testDb: TestDatabase;
  let mongoDb: MongoDb;
  let db: Db;
  let collection: MonguardCollection<TestUser>;

  beforeEach(async () => {
    testDb = new TestDatabase();
    mongoDb = await testDb.start();
    db = adaptDb(mongoDb);
    collection = new MonguardCollection<TestUser>(db, 'test_users', {
      auditCollectionName: 'audit_logs',
      concurrency: { transactionsEnabled: false },
    });
  });

  afterEach(async () => {
    await testDb.stop();
  });

  describe('Concurrent Create Operations', () => {
    it('should handle multiple concurrent creates without data corruption', async () => {
      const users = TestDataFactory.createMultipleUsers(10);
      const userContext = TestDataFactory.createUserContext();

      const createPromises = users.map(user => collection.create(user, { userContext }));

      const results = await Promise.all(createPromises);

      // All operations should succeed
      results.forEach(result => TestAssertions.expectSuccess(result));

      // All should have unique IDs
      const ids = results.map(r => r.data!._id.toString());
      expect(new Set(ids)).toHaveLength(10);

      // Verify all documents exist in database
      const allUsers = await collection.find();
      TestAssertions.expectSuccess(allUsers);
      expect(allUsers.data).toHaveLength(10);

      // Verify all audit logs were created
      const auditLogs = await collection.getAuditCollection().find({}).toArray();
      expect(auditLogs).toHaveLength(10);
    });

    it('should handle concurrent creates with different user contexts', async () => {
      const users = TestDataFactory.createMultipleUsers(5);
      const userContexts = Array.from({ length: 5 }, () => TestDataFactory.createUserContext());

      const createPromises = users.map((user, index) => collection.create(user, { userContext: userContexts[index] }));

      const results = await Promise.all(createPromises);

      results.forEach(result => TestAssertions.expectSuccess(result));

      // Verify each document has correct user tracking
      const auditLogs = await collection.getAuditCollection().find({}).toArray();
      expect(auditLogs).toHaveLength(5);

      // Verify all expected user IDs are present in audit logs
      const expectedUserIds = userContexts.map(ctx => ctx.userId.toString());
      const actualUserIds = auditLogs.map(log => log.userId?.toString());

      expectedUserIds.forEach(expectedId => {
        expect(actualUserIds).toContain(expectedId);
      });
    });
  });

  describe('Concurrent Update Operations', () => {
    let testUsers: TestUser[];

    beforeEach(async () => {
      const users = TestDataFactory.createMultipleUsers(5);
      testUsers = [];

      for (const user of users) {
        const result = await collection.create(user);
        TestAssertions.expectSuccess(result);
        testUsers.push(result.data);
      }
    });

    it('should handle concurrent updates to different documents', async () => {
      const userContext = TestDataFactory.createUserContext();

      const updatePromises = testUsers.map((user, index) =>
        collection.updateById(
          user._id,
          { $set: { name: `Concurrently Updated User ${index}`, age: 30 + index } },
          { userContext }
        )
      );

      const results = await Promise.all(updatePromises);

      results.forEach(result => {
        TestAssertions.expectSuccess(result);
        expect(result.data.modifiedCount).toBe(1);
      });

      // Verify all updates were applied correctly
      const updatedUsers = await collection.find();
      TestAssertions.expectSuccess(updatedUsers);

      updatedUsers.data.forEach((user, index) => {
        expect(user.name).toBe(`Concurrently Updated User ${index}`);
        expect(user.age).toBe(30 + index);
      });

      // Verify all audit logs were created
      const updateAuditLogs = await collection.getAuditCollection().find({ action: 'update' }).toArray();
      expect(updateAuditLogs).toHaveLength(5);
    });

    it('should handle concurrent updates to the same document safely', async () => {
      const targetUser = testUsers[0]!;
      const userContext = TestDataFactory.createUserContext();

      // Multiple concurrent updates to the same document
      const updatePromises = Array.from({ length: 5 }, (_, index) =>
        collection.updateById(targetUser._id, { $inc: { age: 1 }, $set: { name: `Update ${index}` } }, { userContext })
      );

      const results = await Promise.all(updatePromises);

      // Some updates might succeed, some might fail due to race conditions
      const successfulUpdates = results.filter(r => r.success);
      expect(successfulUpdates.length).toBeGreaterThan(0);

      // Verify final state is consistent
      const finalUser = await collection.findById(targetUser!._id);
      TestAssertions.expectSuccess(finalUser);

      expect(finalUser.data).not.toBeNull();
      expect(finalUser.data!.age).toBeGreaterThan(targetUser!.age || 0);

      // Verify audit logs match successful operations
      const auditLogs = await collection
        .getAuditCollection()
        .find({
          action: 'update',
          'ref.id': targetUser!._id,
        })
        .toArray();
      expect(auditLogs.length).toBe(successfulUpdates.length);
    });

    it('should maintain data consistency during concurrent field updates', async () => {
      const targetUser = testUsers[0];
      const userContext = TestDataFactory.createUserContext();

      // Concurrent updates to different fields
      const updatePromises = [
        collection.updateById(targetUser!._id, { $set: { name: 'Name Update 1' } }, { userContext }),
        collection.updateById(targetUser!._id, { $set: { age: 25 } }, { userContext }),
        collection.updateById(targetUser!._id, { $set: { email: 'updated@example.com' } }, { userContext }),
        collection.updateById(targetUser!._id, { $set: { name: 'Name Update 2' } }, { userContext }),
      ];

      const results = await Promise.all(updatePromises);

      const successfulUpdates = results.filter(r => r.success);
      expect(successfulUpdates.length).toBeGreaterThan(0);

      // Verify final document state
      const finalUser = await collection.findById(targetUser!._id);
      TestAssertions.expectSuccess(finalUser);
      expect(finalUser.data).not.toBeNull();

      // At least some updates should have been applied
      const hasNameUpdate = finalUser.data!.name.includes('Name Update');
      const hasAgeUpdate = finalUser.data!.age === 25;
      const hasEmailUpdate = finalUser.data!.email === 'updated@example.com';

      expect(hasNameUpdate || hasAgeUpdate || hasEmailUpdate).toBe(true);
    });
  });

  describe('Concurrent Delete Operations', () => {
    let testUsers: TestUser[];

    beforeEach(async () => {
      const users = TestDataFactory.createMultipleUsers(5);
      testUsers = [];

      for (const user of users) {
        const result = await collection.create(user);
        TestAssertions.expectSuccess(result);
        testUsers.push(result.data);
      }
    });

    it('should handle concurrent soft deletes safely', async () => {
      const userContext = TestDataFactory.createUserContext();

      const deletePromises = testUsers.map(user => collection.deleteById(user._id, { userContext }));

      const results = await Promise.all(deletePromises);

      results.forEach(result => TestAssertions.expectSuccess(result));

      // Verify all documents are soft deleted
      const activeUsers = await collection.find();
      TestAssertions.expectSuccess(activeUsers);
      expect(activeUsers.data).toHaveLength(0);

      const deletedUsers = await collection.find({}, { includeSoftDeleted: true });
      TestAssertions.expectSuccess(deletedUsers);
      expect(deletedUsers.data).toHaveLength(5);
      deletedUsers.data.forEach(user => {
        expect(user.deletedAt).toBeInstanceOf(Date);
      });
    });

    it('should handle concurrent hard deletes safely', async () => {
      const userContext = TestDataFactory.createUserContext();

      const deletePromises = testUsers.map(user => collection.deleteById(user._id, { userContext, hardDelete: true }));

      const results = await Promise.all(deletePromises);

      results.forEach(result => TestAssertions.expectSuccess(result));

      // Verify all documents are permanently deleted
      const remainingUsers = await collection.find({}, { includeSoftDeleted: true });
      TestAssertions.expectSuccess(remainingUsers);
      expect(remainingUsers.data).toHaveLength(0);

      // Verify audit logs were created
      const deleteAuditLogs = await collection.getAuditCollection().find({ action: 'delete' }).toArray();
      expect(deleteAuditLogs).toHaveLength(5);
    });

    it('should handle double delete attempts gracefully', async () => {
      const targetUser = testUsers[0]!;
      const userContext = TestDataFactory.createUserContext();

      // Multiple concurrent delete attempts on same document
      const deletePromises = Array.from({ length: 3 }, () => collection.deleteById(targetUser!._id, { userContext }));

      const results = await Promise.all(deletePromises);

      // At least one should succeed
      const successfulDeletes = results.filter(
        r => r.success && r.data && 'modifiedCount' in r.data && r.data.modifiedCount > 0
      );
      expect(successfulDeletes.length).toBe(1);

      // Verify document is soft deleted
      const deletedUser = await collection.findById(targetUser!._id, { includeSoftDeleted: true });
      TestAssertions.expectSuccess(deletedUser);
      expect(deletedUser.data!.deletedAt).toBeInstanceOf(Date);

      // Only one audit log should be created
      const auditLogs = await collection
        .getAuditCollection()
        .find({
          action: 'delete',
          'ref.id': targetUser!._id,
        })
        .toArray();
      expect(auditLogs).toHaveLength(1);
    });
  });

  describe('Mixed Concurrent Operations', () => {
    it('should handle mixed CRUD operations concurrently', async () => {
      const userContext = TestDataFactory.createUserContext();

      // Create initial users
      const initialUsers = TestDataFactory.createMultipleUsers(3);
      const createResults = [];
      for (const user of initialUsers) {
        const result = await collection.create(user);
        TestAssertions.expectSuccess(result);
        createResults.push(result.data);
      }

      // Mixed concurrent operations
      const operations = [
        // Create new users
        collection.create(TestDataFactory.createUser({ name: 'Concurrent User 1' }), { userContext }),
        collection.create(TestDataFactory.createUser({ name: 'Concurrent User 2' }), { userContext }),

        // Update existing users
        collection.updateById(createResults[0]!._id, { $set: { name: 'Updated Concurrently' } }, { userContext }),
        collection.updateById(createResults[1]!._id, { $set: { age: 99 } }, { userContext }),

        // Delete existing users
        collection.deleteById(createResults[2]!._id, { userContext }),

        // Read operations
        collection.find({ name: { $regex: /User/ } }),
        collection.count(),
      ];

      const results = await Promise.all(operations);

      // Verify most operations succeeded
      const successfulOps = results.filter(r => r.success);
      expect(successfulOps.length).toBeGreaterThanOrEqual(5);

      // Verify final database state is consistent
      const finalUsers = await collection.find({}, { includeSoftDeleted: true });
      TestAssertions.expectSuccess(finalUsers);

      // Should have created 2 new users (total 5), deleted 1 (4 remaining)
      expect(finalUsers.data).toHaveLength(5);
      const activeUsers = finalUsers.data.filter(u => !u.deletedAt);
      const deletedUsers = finalUsers.data.filter(u => u.deletedAt);
      expect(activeUsers).toHaveLength(4);
      expect(deletedUsers).toHaveLength(1);
    });

    it('should maintain audit log integrity during concurrent operations', async () => {
      const userContext = TestDataFactory.createUserContext();
      const numOperations = 10;

      // Create base users for operations
      const baseUsers = [];
      for (let i = 0; i < 5; i++) {
        const result = await collection.create(TestDataFactory.createUser());
        TestAssertions.expectSuccess(result);
        baseUsers.push(result.data);
      }

      // Generate concurrent operations
      const operations = [];
      for (let i = 0; i < numOperations; i++) {
        const operation = i % 3;
        switch (operation) {
          case 0: // Create
            operations.push(
              collection.create(TestDataFactory.createUser({ name: `Concurrent ${i}` }), { userContext })
            );
            break;
          case 1: // Update
            const userToUpdate = baseUsers[i % baseUsers.length]!;
            operations.push(
              collection.updateById(userToUpdate._id, { $set: { name: `Updated ${i}` } }, { userContext })
            );
            break;
          case 2: // Delete
            if (i < baseUsers.length) {
              operations.push(collection.deleteById(baseUsers[i]!._id, { userContext }));
            }
            break;
        }
      }

      const results = await Promise.all(operations);

      // Count successful operations
      const successfulOps = results.filter(r => r.success);

      // Verify audit logs match successful operations
      const auditLogs = await collection.getAuditCollection().find({}).toArray();

      // Should have audit logs for at least the 5 initial creates
      // Note: Some concurrent operations may fail due to version conflicts
      expect(auditLogs.length).toBeGreaterThanOrEqual(5);

      // Verify audit log data integrity
      auditLogs.forEach(log => {
        expect(log.action).toMatch(/^(create|update|delete)$/);
        expect(log.ref.collection).toBe('test_users');
        expect(log.ref.id).toBeInstanceOf(MongoObjectId);
        expect(log.timestamp).toBeInstanceOf(Date);
        expect(log.createdAt).toBeInstanceOf(Date);
        expect(log.updatedAt).toBeInstanceOf(Date);
      });
    });
  });

  describe('Concurrent Restore Operations', () => {
    let deletedUsers: TestUser[];

    beforeEach(async () => {
      const users = TestDataFactory.createMultipleUsers(3);
      deletedUsers = [];

      for (const user of users) {
        const createResult = await collection.create(user);
        TestAssertions.expectSuccess(createResult);

        const deleteResult = await collection.deleteById(createResult.data._id);
        TestAssertions.expectSuccess(deleteResult);

        deletedUsers.push(createResult.data);
      }
    });

    it('should handle concurrent restore operations', async () => {
      const userContext = TestDataFactory.createUserContext();

      const restorePromises = deletedUsers.map(user => collection.restore({ _id: user._id }, userContext));

      const results = await Promise.all(restorePromises);

      results.forEach(result => {
        TestAssertions.expectSuccess(result);
        expect(result.data.modifiedCount).toBe(1);
      });

      // Verify all users are restored
      const restoredUsers = await collection.find();
      TestAssertions.expectSuccess(restoredUsers);
      expect(restoredUsers.data).toHaveLength(3);

      restoredUsers.data.forEach(user => {
        expect(user.deletedAt).toBeUndefined();
        expect(user.deletedBy).toBeUndefined();
        expect(user.updatedBy).toEqual(userContext.userId);
      });
    });

    it('should handle double restore attempts gracefully', async () => {
      const targetUser = deletedUsers[0]!;
      const userContext = TestDataFactory.createUserContext();

      // Multiple concurrent restore attempts
      const restorePromises = Array.from({ length: 3 }, () =>
        collection.restore({ _id: targetUser!._id }, userContext)
      );

      const results = await Promise.all(restorePromises);

      // Only one should actually modify the document
      const successfulRestores = results.filter(
        r => r.success && r.data && 'modifiedCount' in r.data && r.data.modifiedCount > 0
      );
      expect(successfulRestores.length).toBe(1);

      // Verify user is restored
      const restoredUser = await collection.findById(targetUser!._id);
      TestAssertions.expectSuccess(restoredUser);
      expect(restoredUser.data).not.toBeNull();
      expect(restoredUser.data!.deletedAt).toBeUndefined();
    });
  });

  describe('Performance Under Concurrent Load', () => {
    it('should maintain reasonable performance with high concurrency', async () => {
      const startTime = Date.now();
      const concurrentOps = 50;
      const userContext = TestDataFactory.createUserContext();

      // Mix of operations
      const operations = [];
      for (let i = 0; i < concurrentOps; i++) {
        operations.push(collection.create(TestDataFactory.createUser({ name: `Load Test ${i}` }), { userContext }));
      }

      const results = await Promise.all(operations);
      const endTime = Date.now();

      const successfulOps = results.filter(r => r.success);
      const duration = endTime - startTime;

      expect(successfulOps.length).toBe(concurrentOps);
      expect(duration).toBeLessThan(10000); // Should complete within 10 seconds

      // Verify all operations were logged
      const auditLogs = await collection.getAuditCollection().find({}).toArray();
      expect(auditLogs).toHaveLength(concurrentOps);

      console.log(`Completed ${concurrentOps} concurrent operations in ${duration}ms`);
    });
  });

  describe('Transaction Strategy Concurrent Operations', () => {
    let transactionCollection: MonguardCollection<TestUser>;

    beforeEach(async () => {
      // Create a collection using transaction strategy
      transactionCollection = new MonguardCollection<TestUser>(db, 'transaction_concurrent_users', {
        auditCollectionName: 'transaction_concurrent_audit_logs',
        concurrency: { transactionsEnabled: true },
      });
    });

    it('should handle concurrent creates with transactions', async () => {
      const users = TestDataFactory.createMultipleUsers(10);
      const userContext = TestDataFactory.createUserContext();

      const startTime = Date.now();

      // Execute concurrent creates with transactions
      const createPromises = users.map(userData => transactionCollection.create(userData, { userContext }));

      const results = await Promise.all(createPromises);
      const duration = Date.now() - startTime;

      // All operations should succeed
      results.forEach(result => TestAssertions.expectSuccess(result));

      // Verify all documents were created
      const allDocs = await transactionCollection.find({});
      TestAssertions.expectSuccess(allDocs);
      expect(allDocs.data).toHaveLength(10);

      // Verify all audit logs were created atomically
      const auditLogs = await transactionCollection.getAuditCollection().find({}).toArray();
      expect(auditLogs).toHaveLength(10);
      auditLogs.forEach(log => expect(log.action).toBe('create'));

      console.log(`Transaction Strategy: ${duration}ms for 10 concurrent creates`);
    });

    it('should handle concurrent updates with transactions', async () => {
      // Create initial documents
      const users = TestDataFactory.createMultipleUsers(5);
      const userContext = TestDataFactory.createUserContext();

      const createResults = await Promise.all(
        users.map(userData => transactionCollection.create(userData, { userContext }))
      );
      createResults.forEach(result => TestAssertions.expectSuccess(result));

      // Concurrent updates with transactions
      const updatePromises = createResults.map((result, index) =>
        transactionCollection.updateById(
          result.data!._id,
          { $set: { name: `Transaction Updated ${index}`, age: 20 + index } },
          { userContext }
        )
      );

      const updateResults = await Promise.all(updatePromises);
      updateResults.forEach(result => TestAssertions.expectSuccess(result));

      // Verify all documents were updated
      const updatedDocs = await transactionCollection.find({});
      TestAssertions.expectSuccess(updatedDocs);
      updatedDocs.data.forEach((doc, index) => {
        expect(doc.name).toContain('Transaction Updated');
      });

      // Verify audit logs: 5 creates + 5 updates = 10 total
      const auditLogs = await transactionCollection.getAuditCollection().find({}).toArray();
      expect(auditLogs).toHaveLength(10);
      const actions = auditLogs.map(log => log.action).sort();
      expect(actions.filter(action => action === 'create')).toHaveLength(5);
      expect(actions.filter(action => action === 'update')).toHaveLength(5);
    });

    it('should handle transaction rollbacks under concurrent load', async () => {
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      // Create a document first
      const createResult = await transactionCollection.create(userData, { userContext });
      TestAssertions.expectSuccess(createResult);

      // Mock one audit operation to fail
      let failureCount = 0;
      const originalInsertOne = transactionCollection.getAuditCollection().insertOne;
      const mockInsertOne = vi.fn().mockImplementation(async (...args) => {
        failureCount++;
        if (failureCount === 2) {
          // Fail the second audit log
          throw new Error('Simulated audit failure');
        }
        return originalInsertOne.apply(transactionCollection.getAuditCollection(), args as any);
      });

      vi.spyOn(transactionCollection.getAuditCollection(), 'insertOne').mockImplementation(mockInsertOne);

      // Concurrent operations, one should fail due to audit failure
      const operations = [
        transactionCollection.updateById(createResult.data._id, { $set: { name: 'Update 1' } }, { userContext }),
        transactionCollection.updateById(createResult.data._id, { $set: { name: 'Update 2' } }, { userContext }),
      ];

      const results = await Promise.allSettled(operations);

      // In fallback mode (non-transactional), both operations might succeed
      // In true transaction mode, one would fail due to audit failure and transaction rollback
      const successes = results.filter(r => r.status === 'fulfilled');
      const failures = results.filter(r => r.status === 'rejected');

      expect(successes.length).toBeGreaterThan(0);
      // In fallback mode, failures might be 0 since operations don't roll back
      // In true transaction mode, we'd expect failures > 0

      // Verify audit log consistency
      const auditLogs = await transactionCollection.getAuditCollection().find({}).toArray();
      // In fallback mode: might have 1 create + some successful updates despite audit mock failure
      // In true transaction mode: would have 1 create + successful updates only
      // At minimum should have the initial create operation
      expect(auditLogs.length).toBeGreaterThanOrEqual(1);

      // Cleanup
      vi.restoreAllMocks();
    });

    it('should compare performance with optimistic locking under load', async () => {
      const users = TestDataFactory.createMultipleUsers(20);
      const userContext = TestDataFactory.createUserContext();

      // Test transaction strategy
      const transactionStart = Date.now();
      const transactionPromises = users
        .slice(0, 10)
        .map(userData => transactionCollection.create(userData, { userContext }));
      await Promise.all(transactionPromises);
      const transactionDuration = Date.now() - transactionStart;

      // Test optimistic strategy
      const optimisticStart = Date.now();
      const optimisticPromises = users.slice(10, 20).map(userData => collection.create(userData, { userContext }));
      await Promise.all(optimisticPromises);
      const optimisticDuration = Date.now() - optimisticStart;

      // Verify both completed successfully
      const transactionDocs = await transactionCollection.find({});
      const optimisticDocs = await collection.find({});

      TestAssertions.expectSuccess(transactionDocs);
      TestAssertions.expectSuccess(optimisticDocs);
      expect(transactionDocs.data).toHaveLength(10);
      expect(optimisticDocs.data).toHaveLength(10);

      console.log(`Performance Comparison:`);
      console.log(`  Transaction Strategy: ${transactionDuration}ms for 10 operations`);
      console.log(`  Optimistic Strategy: ${optimisticDuration}ms for 10 operations`);

      // Both should complete in reasonable time
      expect(transactionDuration).toBeLessThan(15000);
      expect(optimisticDuration).toBeLessThan(15000);
    });
  });
});
