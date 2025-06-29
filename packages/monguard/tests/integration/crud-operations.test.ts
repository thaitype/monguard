import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectId as MongoObjectId, Db as MongoDb } from 'mongodb';
import { MonguardCollection } from '../../src/monguard-collection';
import { MonguardAuditLogger } from '../../src/audit-logger';
import { TestDatabase } from '../setup';
import { TestDataFactory, TestUser } from '../factories';
import { TestAssertions, TestHelpers } from '../test-utils';
import { adaptDb } from '../mongodb-adapter';
import type { Db } from '../../src/mongodb-types';

describe('CRUD Operations Integration Tests', () => {
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
      concurrency: { transactionsEnabled: false },
    });
  });

  afterEach(async () => {
    await testDb.stop();
  });

  describe('Create Operations', () => {
    it('should create a document with timestamps', async () => {
      const userData = TestDataFactory.createUser();
      const timeRange = TestHelpers.createDateRange();

      const doc = await collection.create(userData);

      expect(doc._id).toBeDefined();
      expect(doc.name).toBe(userData.name);
      expect(doc.email).toBe(userData.email);
      TestAssertions.expectTimestamps(doc);
      TestHelpers.expectDateInRange(doc.createdAt, timeRange);
    });

    it('should create a document with user context', async () => {
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      const doc = await collection.create(userData, { userContext });

      TestAssertions.expectUserTracking(doc, userContext.userId as any);
    });

    it('should create multiple documents independently', async () => {
      const users = TestDataFactory.createMultipleUsers(3);
      const results = [];

      for (const user of users) {
        const doc = await collection.create(user);
        results.push(doc);
      }

      expect(results).toHaveLength(3);
      expect(new Set(results.map(u => u._id.toString()))).toHaveLength(3);
    });

    it('should handle duplicate creation attempts', async () => {
      const userData = TestDataFactory.createUser({ email: 'unique@example.com' });

      const doc1 = await collection.create(userData);
      const doc2 = await collection.create(userData);

      expect(doc1._id.toString()).not.toBe(doc2._id.toString());
    });
  });

  describe('Find Operations', () => {
    let createdUsers: TestUser[];

    beforeEach(async () => {
      const users = TestDataFactory.createMultipleUsers(5);
      createdUsers = [];

      for (const user of users) {
        const doc = await collection.create(user);
        createdUsers.push(doc);
      }
    });

    it('should find document by ID', async () => {
      const targetUser = createdUsers[0]!;

      const doc = await collection.findById(targetUser._id);

      expect(doc).not.toBeNull();
      expect(doc!._id).toEqual(targetUser!._id);
      expect(doc!.name).toBe(targetUser!.name);
    });

    it('should return null for non-existent ID', async () => {
      const nonExistentId = TestDataFactory.createObjectId();

      const doc = await collection.findById(nonExistentId);

      expect(doc).toBeNull();
    });

    it('should find all documents', async () => {
      const docs = await collection.find();

      expect(docs).toHaveLength(5);
    });

    it('should find documents with filter', async () => {
      const docs = await collection.find({ name: 'User 1' });

      expect(docs).toHaveLength(1);
      expect(docs[0]!.name).toBe('User 1');
    });

    it('should find one document with filter', async () => {
      const doc = await collection.findOne({ name: 'User 2' });

      expect(doc).not.toBeNull();
      expect(doc!.name).toBe('User 2');
    });

    it('should handle pagination', async () => {
      const page1 = await collection.find({}, { limit: 2, skip: 0 });
      const page2 = await collection.find({}, { limit: 2, skip: 2 });

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);

      const allIds = [...page1, ...page2].map(u => u._id.toString());
      expect(new Set(allIds)).toHaveLength(4);
    });

    it('should handle sorting', async () => {
      const docs = await collection.find({}, { sort: { name: -1 } });

      expect(docs[0]!.name).toBe('User 5');
      expect(docs[4]!.name).toBe('User 1');
    });

    it('should exclude soft deleted documents by default', async () => {
      const targetUser = createdUsers[0]!;
      await collection.deleteById(targetUser._id); // Soft delete

      const docs = await collection.find();

      expect(docs).toHaveLength(4);
      expect(docs.find(u => u._id.equals(targetUser!._id))).toBeUndefined();
    });

    it('should include soft deleted documents when requested', async () => {
      const targetUser = createdUsers[0]!;
      await collection.deleteById(targetUser._id); // Soft delete

      const docs = await collection.find({}, { includeSoftDeleted: true });

      expect(docs).toHaveLength(5);
      const deletedUser = docs.find(u => u._id.equals(targetUser!._id));
      expect(deletedUser).toBeDefined();
      expect(deletedUser!.deletedAt).toBeInstanceOf(Date);
    });
  });

  describe('Update Operations', () => {
    let testUser: TestUser;

    beforeEach(async () => {
      testUser = await collection.create(TestDataFactory.createUser());
    });

    it('should update document by ID', async () => {
      const timeRange = TestHelpers.createDateRange();

      const result = await collection.updateById(testUser._id, { $set: { name: 'Updated Name', age: 35 } });

      expect(result.modifiedCount).toBe(1);

      const updatedUser = await collection.findById(testUser._id);
      expect(updatedUser!.name).toBe('Updated Name');
      expect(updatedUser!.age).toBe(35);
      TestHelpers.expectDateInRange(updatedUser!.updatedAt, timeRange);
    });

    it('should update document with user context', async () => {
      const userContext = TestDataFactory.createUserContext();

      await collection.updateById(testUser._id, { $set: { name: 'Updated Name' } }, { userContext });

      const updatedUser = await collection.findById(testUser._id);
      expect(updatedUser!.updatedBy).toEqual(userContext.userId);
    });

    it('should update multiple documents with filter', async () => {
      await collection.create(TestDataFactory.createUser({ name: 'Batch User', age: 25 }));
      await collection.create(TestDataFactory.createUser({ name: 'Batch User', age: 30 }));

      const result = await collection.update({ name: 'Batch User' }, { $set: { age: 40 } });

      expect(result.modifiedCount).toBe(2);

      const updatedUsers = await collection.find({ name: 'Batch User' });
      expect(updatedUsers.every(u => u.age === 40)).toBe(true);
    });

    it('should handle upsert when document does not exist', async () => {
      const nonExistentId = TestDataFactory.createObjectId();

      const result = await collection.updateById(
        nonExistentId,
        { $set: { name: 'Upserted User', email: 'upsert@example.com' } },
        { upsert: true }
      );

      expect(result.upsertedCount).toBe(1);

      const upsertedUser = await collection.findById(nonExistentId);
      expect(upsertedUser!.name).toBe('Upserted User');
    });

    it('should not update soft deleted documents', async () => {
      await collection.deleteById(testUser._id); // Soft delete

      const result = await collection.updateById(testUser._id, { $set: { name: 'Should Not Update' } });

      expect(result.modifiedCount).toBe(0);
    });
  });

  describe('Delete Operations', () => {
    let testUser: TestUser;

    beforeEach(async () => {
      testUser = await collection.create(TestDataFactory.createUser());
    });

    it('should soft delete document by default', async () => {
      const timeRange = TestHelpers.createDateRange();

      const result = await collection.deleteById(testUser._id);

      expect((result as any).modifiedCount).toBe(1);

      // Document should not be found in normal queries
      const findResult = await collection.findById(testUser._id);
      expect(findResult).toBeNull();

      // But should be found when including soft deleted
      const findDeletedResult = await collection.findById(testUser._id, { includeSoftDeleted: true });
      expect(findDeletedResult).not.toBeNull();
      TestAssertions.expectSoftDeleted(findDeletedResult!);
      TestHelpers.expectDateInRange(findDeletedResult!.deletedAt!, timeRange);
    });

    it('should soft delete with user context', async () => {
      const userContext = TestDataFactory.createUserContext();

      const result = await collection.deleteById(testUser._id, { userContext });

      const deletedUser = await collection.findById(testUser._id, { includeSoftDeleted: true });
      TestAssertions.expectSoftDeleted(deletedUser!, userContext.userId as any);
    });

    it('should hard delete when specified', async () => {
      const result = await collection.deleteById(testUser._id, { hardDelete: true });

      expect((result as any).deletedCount).toBe(1);

      // Document should not exist at all
      const findResult = await collection.findById(testUser._id, { includeSoftDeleted: true });
      expect(findResult).toBeNull();
    });

    it('should delete multiple documents with filter', async () => {
      await collection.create(TestDataFactory.createUser({ name: 'Batch Delete', age: 25 }));
      await collection.create(TestDataFactory.createUser({ name: 'Batch Delete', age: 30 }));

      const result = await collection.delete({ name: 'Batch Delete' });

      expect((result as any).modifiedCount).toBe(2);

      const remainingUsers = await collection.find({ name: 'Batch Delete' });
      expect(remainingUsers).toHaveLength(0);
    });

    it('should not soft delete already soft deleted documents', async () => {
      await collection.deleteById(testUser._id); // First soft delete

      const result = await collection.deleteById(testUser._id); // Second soft delete attempt

      expect((result as any).modifiedCount).toBe(0);
    });
  });

  describe('Restore Operations', () => {
    let testUser: TestUser;

    beforeEach(async () => {
      testUser = await collection.create(TestDataFactory.createUser());

      // Soft delete the user
      await collection.deleteById(testUser._id);
    });

    it('should restore soft deleted document', async () => {
      const timeRange = TestHelpers.createDateRange();

      const result = await collection.restore({ _id: testUser._id });

      expect(result.modifiedCount).toBe(1);

      // Document should be found in normal queries again
      const restoredUser = await collection.findById(testUser._id);
      expect(restoredUser).not.toBeNull();
      expect(restoredUser!.deletedAt).toBeUndefined();
      expect(restoredUser!.deletedBy).toBeUndefined();
      TestHelpers.expectDateInRange(restoredUser!.updatedAt, timeRange);
    });

    it('should restore with user context', async () => {
      const userContext = TestDataFactory.createUserContext();

      const result = await collection.restore({ _id: testUser._id }, userContext);

      const restoredUser = await collection.findById(testUser._id);
      expect(restoredUser!.updatedBy).toEqual(userContext.userId);
    });

    it('should restore multiple documents with filter', async () => {
      await collection.create(TestDataFactory.createUser({ name: 'Batch Restore' }));
      await collection.create(TestDataFactory.createUser({ name: 'Batch Restore' }));

      // Soft delete multiple users
      await collection.delete({ name: 'Batch Restore' });

      const result = await collection.restore({ name: 'Batch Restore' });

      expect(result.modifiedCount).toBe(2);

      const restoredUsers = await collection.find({ name: 'Batch Restore' });
      expect(restoredUsers).toHaveLength(2);
    });

    it('should not restore non-deleted documents', async () => {
      const activeUser = await collection.create(TestDataFactory.createUser());

      const result = await collection.restore({ _id: activeUser._id });

      expect(result.modifiedCount).toBe(0);
    });
  });

  describe('Count Operations', () => {
    beforeEach(async () => {
      const users = TestDataFactory.createMultipleUsers(10);
      for (const user of users) {
        await collection.create(user);
      }

      // Soft delete some users
      const allUsers = await collection.find();
      for (let i = 0; i < 3; i++) {
        await collection.deleteById(allUsers[i]!._id);
      }
    });

    it('should count active documents by default', async () => {
      const result = await collection.count();
      expect(result).toBe(7); // 10 - 3 deleted
    });

    it('should count all documents including soft deleted', async () => {
      const result = await collection.count({}, true);
      expect(result).toBe(10);
    });

    it('should count with filter', async () => {
      const result = await collection.count({ name: 'User 5' }); // User 5 should not be deleted (only first 3 are deleted)
      expect(result).toBe(1);
    });

    it('should count deleted documents with filter', async () => {
      const result = await collection.count({ deletedAt: { $exists: true } }, true);
      expect(result).toBe(3);
    });
  });

  describe('Transaction Strategy Variants', () => {
    let transactionCollection: MonguardCollection<TestUser>;

    beforeEach(async () => {
      // Create a collection using transaction strategy
      transactionCollection = new MonguardCollection<TestUser>(db, 'transaction_test_users', {
        auditLogger: new MonguardAuditLogger(db, 'transaction_audit_logs'),
        concurrency: { transactionsEnabled: true },
      });
    });

    it('should perform basic CRUD operations with transactions', async () => {
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      // Create
      const createResult = await transactionCollection.create(userData, { userContext });
      TestAssertions.expectTimestamps(createResult);
      TestAssertions.expectUserTracking(createResult, userContext.userId as any);

      // Read
      const findResult = await transactionCollection.findById(createResult._id);
      expect(findResult!.name).toBe(userData.name);

      // Update
      const updateResult = await transactionCollection.updateById(
        createResult._id,
        { $set: { name: 'Updated via Transaction' } },
        { userContext }
      );

      // Verify update
      const updatedDoc = await transactionCollection.findById(createResult._id);
      expect(updatedDoc!.name).toBe('Updated via Transaction');

      // Delete
      const deleteResult = await transactionCollection.deleteById(createResult._id, { userContext });

      // Verify soft delete
      const deletedDoc = await transactionCollection.findById(createResult._id);
      expect(deletedDoc).toBeNull();
    });

    it('should handle batch operations within transactions', async () => {
      const users = TestDataFactory.createMultipleUsers(5);
      const userContext = TestDataFactory.createUserContext();

      // Create multiple users
      const createPromises = users.map(userData => transactionCollection.create(userData, { userContext }));
      const createResults = await Promise.all(createPromises);

      // Verify all were created
      const allUsers = await transactionCollection.find({});
      expect(allUsers).toHaveLength(5);

      // Update all users
      const updatePromises = createResults.map(result => {
        return transactionCollection.updateById(result._id, { $set: { age: 25 } }, { userContext });
      });
      await Promise.all(updatePromises);

      // Verify all updates
      const updatedUsers = await transactionCollection.find({});
      updatedUsers.forEach(user => expect(user.age).toBe(25));
    });

    it('should maintain audit log consistency in transactions', async () => {
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      const result = await transactionCollection.create(userData, { userContext });

      // Verify audit log was created
      const auditLogs = await transactionCollection.getAuditCollection()!.find({}).toArray();
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0]!.action).toBe('create');
      expect(auditLogs[0]!.ref.id.toString()).toBe(result._id.toString());

      // Update and check audit consistency
      await transactionCollection.updateById(result._id, { $set: { name: 'Updated' } }, { userContext });

      const updatedAuditLogs = await transactionCollection.getAuditCollection()!.find({}).toArray();
      expect(updatedAuditLogs).toHaveLength(2);
      expect(updatedAuditLogs.map(log => log.action).sort()).toEqual(['create', 'update']);
    });
  });
});
