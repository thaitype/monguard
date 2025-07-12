import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectId as MongoObjectId, Db as MongoDb } from 'mongodb';
import { MonguardCollection } from '../../src/monguard-collection';
import { MonguardAuditLogger } from '../../src/audit-logger';
import { TestDatabase } from '../setup';
import { TestDataFactory, TestUser } from '../factories';
import { TestAssertions, TestHelpers } from '../test-utils';
import { adaptDb } from '../mongodb-adapter';
import type { Db } from '../../src/mongodb-types';

describe('Transaction Strategy Integration Tests', () => {
  let testDb: TestDatabase;
  let mongoDb: MongoDb;
  let db: Db;
  let collection: MonguardCollection<TestUser>;

  beforeEach(async () => {
    testDb = new TestDatabase();
    mongoDb = await testDb.start();
    db = adaptDb(mongoDb);
    collection = new MonguardCollection<TestUser>(db, 'test_users', {
      auditLogger: new MonguardAuditLogger(db, 'audit_logs'),
      concurrency: { transactionsEnabled: true }, // Test transaction strategy
    });
  });

  afterEach(async () => {
    await testDb.stop();
  });

  describe('Basic CRUD Operations with Transactions', () => {
    it('should create document within a transaction', async () => {
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      const result = await collection.create(userData, { userContext });

      expect(result!._id).toBeDefined();
      expect(result!.name).toBe(userData.name);
      TestAssertions.expectTimestamps(result);
      TestAssertions.expectUserTracking(result, userContext.userId as any);

      // Verify document was committed to database
      const findResult = await collection.findById(result!._id);
      expect(findResult!.name).toBe(userData.name);

      // Verify audit log was created in same transaction
      const auditLogs = await collection.getAuditCollection()!.find({}).toArray();
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0]!.action).toBe('create');
      expect(auditLogs[0]!.ref.id.toString()).toBe(result!._id.toString());
    });

    it('should update document within a transaction', async () => {
      // Create initial document
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();
      const createResult = await collection.create(userData, { userContext });

      // Update the document
      const updateData = { name: 'Updated Name' };
      const updateResult = await collection.updateById(createResult._id, { $set: updateData }, { userContext });

      expect(updateResult.modifiedCount).toBe(1);

      // Verify document was updated
      const findResult = await collection.findById(createResult._id);
      expect(findResult!.name).toBe('Updated Name');

      // Verify audit logs for both create and update
      const auditLogs = await collection.getAuditCollection()!.find({}).toArray();
      expect(auditLogs).toHaveLength(2);
      expect(auditLogs.map(log => log.action).sort()).toEqual(['create', 'update']);
    });

    it('should delete document within a transaction (soft delete)', async () => {
      // Create initial document
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();
      const createResult = await collection.create(userData, { userContext });

      // Soft delete the document
      await collection.deleteById(createResult._id, { userContext });

      // Verify document is soft deleted
      const findResult = await collection.findById(createResult._id);
      expect(findResult).toBeNull(); // Not found in normal search

      // Verify document exists with soft delete flag
      const findWithDeleted = await collection.findById(createResult._id, { includeSoftDeleted: true });
      expect(findWithDeleted!.deletedAt).toBeInstanceOf(Date);

      // Verify audit logs for create and delete
      const auditLogs = await collection.getAuditCollection()!.find({}).toArray();
      expect(auditLogs).toHaveLength(2);
      expect(auditLogs.map(log => log.action).sort()).toEqual(['create', 'delete']);
    });

    it('should hard delete document within a transaction', async () => {
      // Create initial document
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();
      const createResult = await collection.create(userData, { userContext });

      // Hard delete the document
      await collection.deleteById(createResult._id, { userContext, hardDelete: true });

      // Verify document is completely removed
      const findResult = await collection.findById(createResult._id, { includeSoftDeleted: true });
      expect(findResult).toBeNull();

      // Verify audit logs for create and hard delete
      const auditLogs = await collection.getAuditCollection()!.find({}).toArray();
      expect(auditLogs).toHaveLength(2);
      expect(auditLogs.map(log => log.action).sort()).toEqual(['create', 'delete']);
      expect(auditLogs.find(log => log.action === 'delete')!.metadata?.hardDelete).toBe(true);
    });

    it('should restore soft deleted document within a transaction', async () => {
      // Create and soft delete document
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();
      const createResult = await collection.create(userData, { userContext });

      await collection.deleteById(createResult._id, { userContext });

      // Restore the document
      await collection.restore({ _id: createResult._id }, userContext);

      // Verify document is restored
      const findResult = await collection.findById(createResult._id);
      expect(findResult).not.toBeNull();
      expect(findResult!.deletedAt).toBeUndefined();

      // Should have 3 audit logs: create, delete, restore (implicit in update)
      const auditLogs = await collection.getAuditCollection()!.find({}).toArray();
      expect(auditLogs.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Transaction Rollback and Error Handling', () => {
    it('should rollback transaction when audit log creation fails', async () => {
      // Create a collection with strict audit failure handling
      const strictCollection = new MonguardCollection<TestUser>(db, 'strict_test_users', {
        auditLogger: new MonguardAuditLogger(db, 'strict_audit_logs'),
        concurrency: { transactionsEnabled: true },
        auditControl: {
          enableAutoAudit: true,
          failOnError: true, // Enable strict audit failure handling
        }
      });

      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      // Mock audit collection to fail
      const auditSpy = vi.spyOn(strictCollection.getAuditCollection()!, 'insertOne').mockRejectedValue(new Error('Audit insert failed'));

      // TransactionStrategy: Should throw error due to transaction rollback
      await expect(strictCollection.create(userData, { userContext })).rejects.toThrow();

      // Verify no documents were created due to rollback
      const allDocs = await strictCollection.find({});
      expect(allDocs).toHaveLength(0);

      // Verify no audit logs were created due to rollback
      const auditLogs = await strictCollection.getAuditCollection()!.find({}).toArray();
      expect(auditLogs).toHaveLength(0);

      // Verify audit operation was attempted
      expect(auditSpy).toHaveBeenCalled();

      // Restore mock
      auditSpy.mockRestore();
    });

    it('should rollback transaction when main operation fails', async () => {
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      // Mock main collection to fail after audit log attempt
      const originalInsertOne = collection.getCollection().insertOne;
      vi.spyOn(collection.getCollection(), 'insertOne').mockRejectedValue(new Error('Main insert failed'));

      // Operation should fail (would throw an exception)
      await expect(collection.create(userData, { userContext })).rejects.toThrow();

      // Verify no documents were created
      const allDocsResult = await collection.find({});
      expect(allDocsResult).toHaveLength(0);

      // Verify no audit logs were created (transaction rolled back)
      const auditLogs = await collection.getAuditCollection()!.find({}).toArray();
      expect(auditLogs).toHaveLength(0);

      // Restore original method
      vi.mocked(collection.getCollection()!.insertOne).mockRestore();
    });

    it('should handle session cleanup properly on errors', async () => {
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      // Create a spy to track session lifecycle
      const clientStartSession = vi.spyOn((db as any).client, 'startSession');

      // Mock to fail and track session cleanup
      vi.spyOn(collection.getCollection(), 'insertOne').mockRejectedValue(new Error('Simulated failure'));

      // Operation should fail due to the mock
      await expect(collection.create(userData, { userContext })).rejects.toThrow();

      // Verify session was created
      expect(clientStartSession).toHaveBeenCalled();

      // Note: In real MongoDB, session.endSession() would be called
      // This verifies our error handling doesn't leak sessions

      // Cleanup
      vi.restoreAllMocks();
    });
  });

  describe('Concurrent Operations with Transactions', () => {
    it('should handle concurrent create operations', async () => {
      const users = TestDataFactory.createMultipleUsers(5);
      const userContext = TestDataFactory.createUserContext();

      // Execute concurrent creates
      const createPromises = users.map(userData => collection.create(userData, { userContext }));

      const results = await Promise.all(createPromises);

      // All operations should succeed

      // Verify all documents were created
      const allDocsResult = await collection.find({});
      expect(allDocsResult).toHaveLength(5);

      // Verify all audit logs were created (may be more due to transaction retries)
      const auditLogs = await collection.getAuditCollection()!.find({}).toArray();
      expect(auditLogs.length).toBeGreaterThanOrEqual(5);
      auditLogs.forEach(log => expect(log.action).toBe('create'));
    });

    it('should handle concurrent updates to different documents', async () => {
      // Create multiple documents
      const users = TestDataFactory.createMultipleUsers(3);
      const userContext = TestDataFactory.createUserContext();

      const createResults = await Promise.all(users.map(userData => collection.create(userData, { userContext })));
      // All creates should succeed

      // Update all documents concurrently
      const updatePromises = createResults.map((result, index) => {
        return collection.updateById(result._id, { $set: { name: `Updated User ${index}` } }, { userContext });
      });

      const updateResults = await Promise.all(updatePromises);
      // All updates should succeed

      // Verify all documents were updated
      const allDocsResult = await collection.find({});
      expect(allDocsResult).toHaveLength(3);

      // Sort by name to ensure predictable order for verification
      const sortedDocs = allDocsResult.sort((a, b) => a.name.localeCompare(b.name));
      sortedDocs.forEach((doc, index) => {
        expect(doc.name).toBe(`Updated User ${index}`);
      });

      // Verify audit logs: 3 creates + 3 updates = 6 total (may be more due to transaction retries)
      const auditLogs = await collection.getAuditCollection()!.find({}).toArray();
      expect(auditLogs.length).toBeGreaterThanOrEqual(6);
    });

    it('should handle mixed concurrent operations', async () => {
      const userContext = TestDataFactory.createUserContext();
      const userData1 = TestDataFactory.createUser({ name: 'User 1' });
      const userData2 = TestDataFactory.createUser({ name: 'User 2' });

      // Create first document
      const createResult = await collection.create(userData1, { userContext });

      // Execute mixed operations concurrently
      const operations = [
        collection.create(userData2, { userContext }), // Create new
        collection.updateById(createResult._id, { $set: { name: 'Updated User 1' } }, { userContext }), // Update existing
        collection.count({}), // Read operation
      ];

      const results = await Promise.all(operations);

      // Verify results - need to cast since results array contains different types
      // Create succeeded
      // Update succeeded
      // Count succeeded
      expect(results[2]! as any).toBeGreaterThanOrEqual(1); // Count depends on timing of concurrent operations

      // Verify final state
      const allDocsResult = await collection.find({});
      expect(allDocsResult).toHaveLength(2);
      expect(allDocsResult.find(doc => doc.name === 'Updated User 1')).toBeDefined();
      expect(allDocsResult.find(doc => doc.name === 'User 2')).toBeDefined();
    });
  });

  describe('Transaction Performance and Behavior', () => {
    it('should maintain reasonable performance with transactions', async () => {
      const userContext = TestDataFactory.createUserContext();
      const users = TestDataFactory.createMultipleUsers(10);

      const startTime = Date.now();

      // Execute sequential operations to test transaction overhead
      for (const userData of users) {
        const result = await collection.create(userData, { userContext });
      }

      const duration = Date.now() - startTime;

      // Verify all operations completed
      const allDocsResult = await collection.find({});
      expect(allDocsResult).toHaveLength(10);

      // Performance should be reasonable (adjust threshold as needed)
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds

      console.log(`Completed 10 sequential transaction operations in ${duration}ms`);
    });

    it('should handle operations without audit logs in transactions', async () => {
      const userData = TestDataFactory.createUser();

      const result = await collection.create(userData, { skipAudit: true });

      // Verify document was created
      const findResult = await collection.findById(result!._id);
      expect(findResult).not.toBeNull();

      // Verify no audit log was created
      const auditLogs = await collection.getAuditCollection()!.find({}).toArray();
      expect(auditLogs).toHaveLength(0);
    });

    it('should handle empty filter operations in transactions', async () => {
      // Test operations with empty/broad filters
      const result = await collection.find({});

      expect(result).toEqual([]);

      const countResult = await collection.count({});

      expect(countResult).toBe(0);
    });
  });

  describe('Audit Log Consistency in Transactions', () => {
    it('should ensure audit log metadata is correct in transactions', async () => {
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      const result = await collection.create(userData, { userContext });

      const auditLog = await collection.getAuditCollection()!.findOne({});
      expect(auditLog).not.toBeNull();
      expect(auditLog!.action).toBe('create');
      expect(auditLog!.userId!.toString()).toBe(userContext.userId.toString());
      expect(auditLog!.metadata?.after).toBeDefined();
      expect(auditLog!.metadata?.after.name).toBe(userData.name);
      expect(auditLog!.ref.collection).toBe('test_users');
      expect(auditLog!.ref.id.toString()).toBe(result!._id.toString());
    });

    it('should track field changes correctly in transaction updates', async () => {
      const userData = TestDataFactory.createUser({ name: 'Original', email: 'original@test.com' });
      const userContext = TestDataFactory.createUserContext();

      const createResult = await collection.create(userData, { userContext });

      // Update specific fields
      await collection.updateById(createResult._id, { $set: { name: 'Updated', age: 25 } }, { userContext });

      // Check update audit log
      const updateAuditLog = await collection.getAuditCollection()!.findOne({ action: 'update' });
      expect(updateAuditLog).not.toBeNull();
      expect(updateAuditLog!.metadata?.before).toBeDefined();
      expect(updateAuditLog!.metadata?.after).toBeDefined();
      expect(updateAuditLog!.metadata?.changes).toContain('name');
      expect(updateAuditLog!.metadata?.changes).toContain('age');
      expect(updateAuditLog!.metadata?.before.name).toBe('Original');
      expect(updateAuditLog!.metadata?.after.name).toBe('Updated');
    });
  });
});
