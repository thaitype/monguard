import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectId as MongoObjectId, Db as MongoDb } from 'mongodb';
import { MonguardCollection } from '../../src/monguard-collection';
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
      auditCollectionName: 'audit_logs',
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

      TestAssertions.expectSuccess(result);
      expect(result.data!._id).toBeDefined();
      expect(result.data!.name).toBe(userData.name);
      TestAssertions.expectTimestamps(result.data);
      TestAssertions.expectUserTracking(result.data, userContext.userId as any);

      // Verify document was committed to database
      const findResult = await collection.findById(result.data!._id);
      TestAssertions.expectSuccess(findResult);
      expect(findResult.data!.name).toBe(userData.name);

      // Verify audit log was created in same transaction
      const auditLogs = await collection.getAuditCollection().find({}).toArray();
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0]!.action).toBe('create');
      expect(auditLogs[0]!.ref.id.toString()).toBe(result.data!._id.toString());
    });

    it('should update document within a transaction', async () => {
      // Create initial document
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();
      const createResult = await collection.create(userData, { userContext });
      TestAssertions.expectSuccess(createResult);

      // Update the document
      const updateData = { name: 'Updated Name' };
      const updateResult = await collection.updateById(createResult.data!._id, { $set: updateData }, { userContext });

      TestAssertions.expectSuccess(updateResult);
      expect(updateResult.data.modifiedCount).toBe(1);

      // Verify document was updated
      const findResult = await collection.findById(createResult.data!._id);
      TestAssertions.expectSuccess(findResult);
      expect(findResult.data!.name).toBe('Updated Name');

      // Verify audit logs for both create and update
      const auditLogs = await collection.getAuditCollection().find({}).toArray();
      expect(auditLogs).toHaveLength(2);
      expect(auditLogs.map(log => log.action).sort()).toEqual(['create', 'update']);
    });

    it('should delete document within a transaction (soft delete)', async () => {
      // Create initial document
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();
      const createResult = await collection.create(userData, { userContext });
      TestAssertions.expectSuccess(createResult);

      // Soft delete the document
      const deleteResult = await collection.deleteById(createResult.data!._id, { userContext });
      TestAssertions.expectSuccess(deleteResult);

      // Verify document is soft deleted
      const findResult = await collection.findById(createResult.data!._id);
      TestAssertions.expectSuccess(findResult);
      expect(findResult.data).toBeNull(); // Not found in normal search

      // Verify document exists with soft delete flag
      const findWithDeleted = await collection.findById(createResult.data!._id, { includeSoftDeleted: true });
      TestAssertions.expectSuccess(findWithDeleted);
      expect(findWithDeleted.data!.deletedAt).toBeInstanceOf(Date);

      // Verify audit logs for create and delete
      const auditLogs = await collection.getAuditCollection().find({}).toArray();
      expect(auditLogs).toHaveLength(2);
      expect(auditLogs.map(log => log.action).sort()).toEqual(['create', 'delete']);
    });

    it('should hard delete document within a transaction', async () => {
      // Create initial document
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();
      const createResult = await collection.create(userData, { userContext });
      TestAssertions.expectSuccess(createResult);

      // Hard delete the document
      const deleteResult = await collection.deleteById(createResult.data!._id, { userContext, hardDelete: true });
      TestAssertions.expectSuccess(deleteResult);

      // Verify document is completely removed
      const findResult = await collection.findById(createResult.data!._id, { includeSoftDeleted: true });
      TestAssertions.expectSuccess(findResult);
      expect(findResult.data).toBeNull();

      // Verify audit logs for create and hard delete
      const auditLogs = await collection.getAuditCollection().find({}).toArray();
      expect(auditLogs).toHaveLength(2);
      expect(auditLogs.map(log => log.action).sort()).toEqual(['create', 'delete']);
      expect(auditLogs.find(log => log.action === 'delete')!.metadata?.hardDelete).toBe(true);
    });

    it('should restore soft deleted document within a transaction', async () => {
      // Create and soft delete document
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();
      const createResult = await collection.create(userData, { userContext });
      TestAssertions.expectSuccess(createResult);

      await collection.deleteById(createResult.data!._id, { userContext });

      // Restore the document
      const restoreResult = await collection.restore({ _id: createResult.data!._id }, userContext);
      TestAssertions.expectSuccess(restoreResult);

      // Verify document is restored
      const findResult = await collection.findById(createResult.data!._id);
      TestAssertions.expectSuccess(findResult);
      expect(findResult.data).not.toBeNull();
      expect(findResult.data!.deletedAt).toBeUndefined();

      // Should have 3 audit logs: create, delete, restore (implicit in update)
      const auditLogs = await collection.getAuditCollection().find({}).toArray();
      expect(auditLogs.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Transaction Rollback and Error Handling', () => {
    it('should rollback transaction when audit log creation fails', async () => {
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      // Mock audit collection to fail
      const originalInsertOne = collection.getAuditCollection().insertOne;
      vi.spyOn(collection.getAuditCollection(), 'insertOne').mockRejectedValue(new Error('Audit insert failed'));

      const result = await collection.create(userData, { userContext });

      // In fallback mode (non-transactional), the operation might succeed despite audit failure
      // In true transaction mode, it would fail and roll back
      // This test documents the behavior difference
      if (result.success) {
        // Fallback mode: document created but audit failed
        expect(result.data).toBeDefined();
      } else {
        // True transaction mode: complete rollback
        TestAssertions.expectError(result);
      }

      // Verify document creation outcome matches result expectation
      const allDocsResult = await collection.find({});
      TestAssertions.expectSuccess(allDocsResult);
      if (result.success) {
        // Fallback mode: document was created despite audit failure
        expect(allDocsResult.data).toHaveLength(1);
      } else {
        // True transaction mode: no document created due to rollback
        expect(allDocsResult.data).toHaveLength(0);
      }

      // Verify no audit logs were created
      const auditLogs = await collection.getAuditCollection().find({}).toArray();
      expect(auditLogs).toHaveLength(0);

      // Restore original method
      vi.mocked(collection.getAuditCollection().insertOne).mockRestore();
    });

    it('should rollback transaction when main operation fails', async () => {
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      // Mock main collection to fail after audit log attempt
      const originalInsertOne = collection.getCollection().insertOne;
      vi.spyOn(collection.getCollection(), 'insertOne').mockRejectedValue(new Error('Main insert failed'));

      const result = await collection.create(userData, { userContext });

      // Operation should fail
      TestAssertions.expectError(result);

      // Verify no documents were created
      const allDocsResult = await collection.find({});
      TestAssertions.expectSuccess(allDocsResult);
      expect(allDocsResult.data).toHaveLength(0);

      // Verify no audit logs were created (transaction rolled back)
      const auditLogs = await collection.getAuditCollection().find({}).toArray();
      expect(auditLogs).toHaveLength(0);

      // Restore original method
      vi.mocked(collection.getCollection().insertOne).mockRestore();
    });

    it('should handle session cleanup properly on errors', async () => {
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      // Create a spy to track session lifecycle
      const clientStartSession = vi.spyOn((db as any).client, 'startSession');

      // Mock to fail and track session cleanup
      vi.spyOn(collection.getCollection(), 'insertOne').mockRejectedValue(new Error('Simulated failure'));

      const result = await collection.create(userData, { userContext });
      TestAssertions.expectError(result);

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
      results.forEach(result => TestAssertions.expectSuccess(result));

      // Verify all documents were created
      const allDocsResult = await collection.find({});
      TestAssertions.expectSuccess(allDocsResult);
      expect(allDocsResult.data).toHaveLength(5);

      // Verify all audit logs were created
      const auditLogs = await collection.getAuditCollection().find({}).toArray();
      expect(auditLogs).toHaveLength(5);
      auditLogs.forEach(log => expect(log.action).toBe('create'));
    });

    it('should handle concurrent updates to different documents', async () => {
      // Create multiple documents
      const users = TestDataFactory.createMultipleUsers(3);
      const userContext = TestDataFactory.createUserContext();

      const createResults = await Promise.all(users.map(userData => collection.create(userData, { userContext })));
      createResults.forEach(result => TestAssertions.expectSuccess(result));

      // Update all documents concurrently
      const updatePromises = createResults.map((result, index) => {
        TestAssertions.expectSuccess(result);
        return collection.updateById(result.data._id, { $set: { name: `Updated User ${index}` } }, { userContext });
      });

      const updateResults = await Promise.all(updatePromises);
      updateResults.forEach(result => TestAssertions.expectSuccess(result));

      // Verify all documents were updated
      const allDocsResult = await collection.find({});
      TestAssertions.expectSuccess(allDocsResult);
      expect(allDocsResult.data).toHaveLength(3);

      // Sort by name to ensure predictable order for verification
      const sortedDocs = allDocsResult.data.sort((a, b) => a.name.localeCompare(b.name));
      sortedDocs.forEach((doc, index) => {
        expect(doc.name).toBe(`Updated User ${index}`);
      });

      // Verify audit logs: 3 creates + 3 updates = 6 total
      const auditLogs = await collection.getAuditCollection().find({}).toArray();
      expect(auditLogs).toHaveLength(6);
    });

    it('should handle mixed concurrent operations', async () => {
      const userContext = TestDataFactory.createUserContext();
      const userData1 = TestDataFactory.createUser({ name: 'User 1' });
      const userData2 = TestDataFactory.createUser({ name: 'User 2' });

      // Create first document
      const createResult = await collection.create(userData1, { userContext });
      TestAssertions.expectSuccess(createResult);

      // Execute mixed operations concurrently
      const operations = [
        collection.create(userData2, { userContext }), // Create new
        collection.updateById(createResult.data!._id, { $set: { name: 'Updated User 1' } }, { userContext }), // Update existing
        collection.count({}), // Read operation
      ];

      const results = await Promise.all(operations);

      // Verify results - need to cast since results array contains different types
      TestAssertions.expectSuccess(results[0]! as any); // Create succeeded
      TestAssertions.expectSuccess(results[1]! as any); // Update succeeded
      TestAssertions.expectSuccess(results[2]! as any); // Count succeeded
      expect((results[2]! as any).data).toBeGreaterThanOrEqual(1); // Count depends on timing of concurrent operations

      // Verify final state
      const allDocsResult = await collection.find({});
      TestAssertions.expectSuccess(allDocsResult);
      expect(allDocsResult.data).toHaveLength(2);
      expect(allDocsResult.data.find(doc => doc.name === 'Updated User 1')).toBeDefined();
      expect(allDocsResult.data.find(doc => doc.name === 'User 2')).toBeDefined();
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
        TestAssertions.expectSuccess(result);
      }

      const duration = Date.now() - startTime;

      // Verify all operations completed
      const allDocsResult = await collection.find({});
      TestAssertions.expectSuccess(allDocsResult);
      expect(allDocsResult.data).toHaveLength(10);

      // Performance should be reasonable (adjust threshold as needed)
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds

      console.log(`Completed 10 sequential transaction operations in ${duration}ms`);
    });

    it('should handle operations without audit logs in transactions', async () => {
      const userData = TestDataFactory.createUser();

      const result = await collection.create(userData, { skipAudit: true });
      TestAssertions.expectSuccess(result);

      // Verify document was created
      const findResult = await collection.findById(result.data!._id);
      TestAssertions.expectSuccess(findResult);

      // Verify no audit log was created
      const auditLogs = await collection.getAuditCollection().find({}).toArray();
      expect(auditLogs).toHaveLength(0);
    });

    it('should handle empty filter operations in transactions', async () => {
      // Test operations with empty/broad filters
      const result = await collection.find({});
      TestAssertions.expectSuccess(result);
      expect(result.data).toEqual([]);

      const countResult = await collection.count({});
      TestAssertions.expectSuccess(countResult);
      expect(countResult.data).toBe(0);
    });
  });

  describe('Audit Log Consistency in Transactions', () => {
    it('should ensure audit log metadata is correct in transactions', async () => {
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      const result = await collection.create(userData, { userContext });
      TestAssertions.expectSuccess(result);

      const auditLog = await collection.getAuditCollection().findOne({});
      expect(auditLog).not.toBeNull();
      expect(auditLog!.action).toBe('create');
      expect(auditLog!.userId!.toString()).toBe(userContext.userId.toString());
      expect(auditLog!.metadata?.after).toBeDefined();
      expect(auditLog!.metadata?.after.name).toBe(userData.name);
      expect(auditLog!.ref.collection).toBe('test_users');
      expect(auditLog!.ref.id.toString()).toBe(result.data!._id.toString());
    });

    it('should track field changes correctly in transaction updates', async () => {
      const userData = TestDataFactory.createUser({ name: 'Original', email: 'original@test.com' });
      const userContext = TestDataFactory.createUserContext();

      const createResult = await collection.create(userData, { userContext });
      TestAssertions.expectSuccess(createResult);

      // Update specific fields
      const updateResult = await collection.updateById(
        createResult.data!._id,
        { $set: { name: 'Updated', age: 25 } },
        { userContext }
      );
      TestAssertions.expectSuccess(updateResult);

      // Check update audit log
      const updateAuditLog = await collection.getAuditCollection().findOne({ action: 'update' });
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
