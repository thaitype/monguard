import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectId as MongoObjectId, Db as MongoDb } from 'mongodb';
import { MonguardCollection } from '../../src/monguard-collection';
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
      auditCollectionName: 'audit_logs',
      concurrency: { transactionsEnabled: false }
    });
  });

  afterEach(async () => {
    await testDb.stop();
  });

  describe('Create Operations', () => {
    it('should create a document with timestamps', async () => {
      const userData = TestDataFactory.createUser();
      const timeRange = TestHelpers.createDateRange();
      
      const result = await collection.create(userData);
      
      TestAssertions.expectSuccess(result);
      expect(result.data._id).toBeDefined();
      expect(result.data.name).toBe(userData.name);
      expect(result.data.email).toBe(userData.email);
      TestAssertions.expectTimestamps(result.data);
      TestHelpers.expectDateInRange(result.data.createdAt, timeRange);
    });

    it('should create a document with user context', async () => {
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();
      
      const result = await collection.create(userData, { userContext });
      
      TestAssertions.expectSuccess(result);
      TestAssertions.expectUserTracking(result.data, userContext.userId as any);
    });

    it('should create multiple documents independently', async () => {
      const users = TestDataFactory.createMultipleUsers(3);
      const results = [];
      
      for (const user of users) {
        const result = await collection.create(user);
        TestAssertions.expectSuccess(result);
        results.push(result.data);
      }
      
      expect(results).toHaveLength(3);
      expect(new Set(results.map(u => u._id.toString()))).toHaveLength(3);
    });

    it('should handle duplicate creation attempts', async () => {
      const userData = TestDataFactory.createUser({ email: 'unique@example.com' });
      
      const result1 = await collection.create(userData);
      const result2 = await collection.create(userData);
      
      TestAssertions.expectSuccess(result1);
      TestAssertions.expectSuccess(result2);
      expect(result1.data._id.toString()).not.toBe(result2.data._id.toString());
    });
  });

  describe('Find Operations', () => {
    let createdUsers: TestUser[];

    beforeEach(async () => {
      const users = TestDataFactory.createMultipleUsers(5);
      createdUsers = [];
      
      for (const user of users) {
        const result = await collection.create(user);
        TestAssertions.expectSuccess(result);
        createdUsers.push(result.data);
      }
    });

    it('should find document by ID', async () => {
      const targetUser = createdUsers[0]!;
      
      const result = await collection.findById(targetUser._id);
      
      TestAssertions.expectSuccess(result);
      expect(result.data).not.toBeNull();
      expect(result.data!._id).toEqual(targetUser!._id);
      expect(result.data!.name).toBe(targetUser!.name);
    });

    it('should return null for non-existent ID', async () => {
      const nonExistentId = TestDataFactory.createObjectId();
      
      const result = await collection.findById(nonExistentId);
      
      TestAssertions.expectSuccess(result);
      expect(result.data).toBeNull();
    });

    it('should find all documents', async () => {
      const result = await collection.find();
      
      TestAssertions.expectSuccess(result);
      expect(result.data).toHaveLength(5);
    });

    it('should find documents with filter', async () => {
      const result = await collection.find({ name: 'User 1' });
      
      TestAssertions.expectSuccess(result);
      expect(result.data).toHaveLength(1);
      expect(result.data![0]!.name).toBe('User 1');
    });

    it('should find one document with filter', async () => {
      const result = await collection.findOne({ name: 'User 2' });
      
      TestAssertions.expectSuccess(result);
      expect(result.data).not.toBeNull();
      expect(result.data!.name).toBe('User 2');
    });

    it('should handle pagination', async () => {
      const page1 = await collection.find({}, { limit: 2, skip: 0 });
      const page2 = await collection.find({}, { limit: 2, skip: 2 });
      
      TestAssertions.expectSuccess(page1);
      TestAssertions.expectSuccess(page2);
      expect(page1.data).toHaveLength(2);
      expect(page2.data).toHaveLength(2);
      
      const allIds = [...page1.data, ...page2.data].map(u => u._id.toString());
      expect(new Set(allIds)).toHaveLength(4);
    });

    it('should handle sorting', async () => {
      const result = await collection.find({}, { sort: { name: -1 } });
      
      TestAssertions.expectSuccess(result);
      expect(result.data![0]!.name).toBe('User 5');
      expect(result.data![4]!.name).toBe('User 1');
    });

    it('should exclude soft deleted documents by default', async () => {
      const targetUser = createdUsers[0]!;
      await collection.deleteById(targetUser._id); // Soft delete
      
      const result = await collection.find();
      
      TestAssertions.expectSuccess(result);
      expect(result.data).toHaveLength(4);
      expect(result.data!.find(u => u._id.equals(targetUser!._id))).toBeUndefined();
    });

    it('should include soft deleted documents when requested', async () => {
      const targetUser = createdUsers[0]!;
      await collection.deleteById(targetUser._id); // Soft delete
      
      const result = await collection.find({}, { includeSoftDeleted: true });
      
      TestAssertions.expectSuccess(result);
      expect(result.data).toHaveLength(5);
      const deletedUser = result.data!.find(u => u._id.equals(targetUser!._id));
      expect(deletedUser).toBeDefined();
      expect(deletedUser!.deletedAt).toBeInstanceOf(Date);
    });
  });

  describe('Update Operations', () => {
    let testUser: TestUser;

    beforeEach(async () => {
      const result = await collection.create(TestDataFactory.createUser());
      TestAssertions.expectSuccess(result);
      testUser = result.data;
    });

    it('should update document by ID', async () => {
      const timeRange = TestHelpers.createDateRange();
      
      const result = await collection.updateById(
        testUser._id,
        { $set: { name: 'Updated Name', age: 35 } }
      );
      
      TestAssertions.expectSuccess(result);
      expect(result.data.modifiedCount).toBe(1);
      
      const updatedUser = await collection.findById(testUser._id);
      TestAssertions.expectSuccess(updatedUser);
      expect(updatedUser.data!.name).toBe('Updated Name');
      expect(updatedUser.data!.age).toBe(35);
      TestHelpers.expectDateInRange(updatedUser.data!.updatedAt, timeRange);
    });

    it('should update document with user context', async () => {
      const userContext = TestDataFactory.createUserContext();
      
      const result = await collection.updateById(
        testUser._id,
        { $set: { name: 'Updated Name' } },
        { userContext }
      );
      
      TestAssertions.expectSuccess(result);
      
      const updatedUser = await collection.findById(testUser._id);
      TestAssertions.expectSuccess(updatedUser);
      expect(updatedUser.data!.updatedBy).toEqual(userContext.userId);
    });

    it('should update multiple documents with filter', async () => {
      await collection.create(TestDataFactory.createUser({ name: 'Batch User', age: 25 }));
      await collection.create(TestDataFactory.createUser({ name: 'Batch User', age: 30 }));
      
      const result = await collection.update(
        { name: 'Batch User' },
        { $set: { age: 40 } }
      );
      
      TestAssertions.expectSuccess(result);
      expect(result.data.modifiedCount).toBe(2);
      
      const updatedUsers = await collection.find({ name: 'Batch User' });
      TestAssertions.expectSuccess(updatedUsers);
      expect(updatedUsers.data.every(u => u.age === 40)).toBe(true);
    });

    it('should handle upsert when document does not exist', async () => {
      const nonExistentId = TestDataFactory.createObjectId();
      
      const result = await collection.updateById(
        nonExistentId,
        { $set: { name: 'Upserted User', email: 'upsert@example.com' } },
        { upsert: true }
      );
      
      TestAssertions.expectSuccess(result);
      expect(result.data.upsertedCount).toBe(1);
      
      const upsertedUser = await collection.findById(nonExistentId);
      TestAssertions.expectSuccess(upsertedUser);
      expect(upsertedUser.data!.name).toBe('Upserted User');
    });

    it('should not update soft deleted documents', async () => {
      await collection.deleteById(testUser._id); // Soft delete
      
      const result = await collection.updateById(
        testUser._id,
        { $set: { name: 'Should Not Update' } }
      );
      
      TestAssertions.expectSuccess(result);
      expect(result.data.modifiedCount).toBe(0);
    });
  });

  describe('Delete Operations', () => {
    let testUser: TestUser;

    beforeEach(async () => {
      const result = await collection.create(TestDataFactory.createUser());
      TestAssertions.expectSuccess(result);
      testUser = result.data;
    });

    it('should soft delete document by default', async () => {
      const timeRange = TestHelpers.createDateRange();
      
      const result = await collection.deleteById(testUser._id);
      
      TestAssertions.expectSuccess(result);
      expect((result.data as any).modifiedCount).toBe(1);
      
      // Document should not be found in normal queries
      const findResult = await collection.findById(testUser._id);
      TestAssertions.expectSuccess(findResult);
      expect(findResult.data).toBeNull();
      
      // But should be found when including soft deleted
      const findDeletedResult = await collection.findById(testUser._id, { includeSoftDeleted: true });
      TestAssertions.expectSuccess(findDeletedResult);
      expect(findDeletedResult.data).not.toBeNull();
      TestAssertions.expectSoftDeleted(findDeletedResult.data!);
      TestHelpers.expectDateInRange(findDeletedResult.data!.deletedAt!, timeRange);
    });

    it('should soft delete with user context', async () => {
      const userContext = TestDataFactory.createUserContext();
      
      const result = await collection.deleteById(testUser._id, { userContext });
      
      TestAssertions.expectSuccess(result);
      
      const deletedUser = await collection.findById(testUser._id, { includeSoftDeleted: true });
      TestAssertions.expectSuccess(deletedUser);
      TestAssertions.expectSoftDeleted(deletedUser.data!, userContext.userId as any);
    });

    it('should hard delete when specified', async () => {
      const result = await collection.deleteById(testUser._id, { hardDelete: true });
      
      TestAssertions.expectSuccess(result);
      expect((result.data as any).deletedCount).toBe(1);
      
      // Document should not exist at all
      const findResult = await collection.findById(testUser._id, { includeSoftDeleted: true });
      TestAssertions.expectSuccess(findResult);
      expect(findResult.data).toBeNull();
    });

    it('should delete multiple documents with filter', async () => {
      await collection.create(TestDataFactory.createUser({ name: 'Batch Delete', age: 25 }));
      await collection.create(TestDataFactory.createUser({ name: 'Batch Delete', age: 30 }));
      
      const result = await collection.delete({ name: 'Batch Delete' });
      
      TestAssertions.expectSuccess(result);
      expect((result.data as any).modifiedCount).toBe(2);
      
      const remainingUsers = await collection.find({ name: 'Batch Delete' });
      TestAssertions.expectSuccess(remainingUsers);
      expect(remainingUsers.data).toHaveLength(0);
    });

    it('should not soft delete already soft deleted documents', async () => {
      await collection.deleteById(testUser._id); // First soft delete
      
      const result = await collection.deleteById(testUser._id); // Second soft delete attempt
      
      TestAssertions.expectSuccess(result);
      expect((result.data as any).modifiedCount).toBe(0);
    });
  });

  describe('Restore Operations', () => {
    let testUser: TestUser;

    beforeEach(async () => {
      const result = await collection.create(TestDataFactory.createUser());
      TestAssertions.expectSuccess(result);
      testUser = result.data;
      
      // Soft delete the user
      await collection.deleteById(testUser._id);
    });

    it('should restore soft deleted document', async () => {
      const timeRange = TestHelpers.createDateRange();
      
      const result = await collection.restore({ _id: testUser._id });
      
      TestAssertions.expectSuccess(result);
      expect(result.data.modifiedCount).toBe(1);
      
      // Document should be found in normal queries again
      const restoredUser = await collection.findById(testUser._id);
      TestAssertions.expectSuccess(restoredUser);
      expect(restoredUser.data).not.toBeNull();
      expect(restoredUser.data!.deletedAt).toBeUndefined();
      expect(restoredUser.data!.deletedBy).toBeUndefined();
      TestHelpers.expectDateInRange(restoredUser.data!.updatedAt, timeRange);
    });

    it('should restore with user context', async () => {
      const userContext = TestDataFactory.createUserContext();
      
      const result = await collection.restore({ _id: testUser._id }, userContext);
      
      TestAssertions.expectSuccess(result);
      
      const restoredUser = await collection.findById(testUser._id);
      TestAssertions.expectSuccess(restoredUser);
      expect(restoredUser.data!.updatedBy).toEqual(userContext.userId);
    });

    it('should restore multiple documents with filter', async () => {
      const user2Result = await collection.create(TestDataFactory.createUser({ name: 'Batch Restore' }));
      const user3Result = await collection.create(TestDataFactory.createUser({ name: 'Batch Restore' }));
      TestAssertions.expectSuccess(user2Result);
      TestAssertions.expectSuccess(user3Result);
      
      // Soft delete multiple users
      await collection.delete({ name: 'Batch Restore' });
      
      const result = await collection.restore({ name: 'Batch Restore' });
      
      TestAssertions.expectSuccess(result);
      expect(result.data.modifiedCount).toBe(2);
      
      const restoredUsers = await collection.find({ name: 'Batch Restore' });
      TestAssertions.expectSuccess(restoredUsers);
      expect(restoredUsers.data).toHaveLength(2);
    });

    it('should not restore non-deleted documents', async () => {
      const activeUserResult = await collection.create(TestDataFactory.createUser());
      TestAssertions.expectSuccess(activeUserResult);
      
      const result = await collection.restore({ _id: activeUserResult.data._id });
      
      TestAssertions.expectSuccess(result);
      expect(result.data.modifiedCount).toBe(0);
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
      TestAssertions.expectSuccess(allUsers);
      for (let i = 0; i < 3; i++) {
        await collection.deleteById(allUsers.data![i]!._id);
      }
    });

    it('should count active documents by default', async () => {
      const result = await collection.count();
      
      TestAssertions.expectSuccess(result);
      expect(result.data).toBe(7); // 10 - 3 deleted
    });

    it('should count all documents including soft deleted', async () => {
      const result = await collection.count({}, true);
      
      TestAssertions.expectSuccess(result);
      expect(result.data).toBe(10);
    });

    it('should count with filter', async () => {
      const result = await collection.count({ name: 'User 5' }); // User 5 should not be deleted (only first 3 are deleted)
      
      TestAssertions.expectSuccess(result);
      expect(result.data).toBe(1);
    });

    it('should count deleted documents with filter', async () => {
      const result = await collection.count({ deletedAt: { $exists: true } }, true);
      
      TestAssertions.expectSuccess(result);
      expect(result.data).toBe(3);
    });
  });

  describe('Transaction Strategy Variants', () => {
    let transactionCollection: MonguardCollection<TestUser>;

    beforeEach(async () => {
      // Create a collection using transaction strategy
      transactionCollection = new MonguardCollection<TestUser>(db, 'transaction_test_users', {
        auditCollectionName: 'transaction_audit_logs',
        concurrency: { transactionsEnabled: true }
      });
    });

    it('should perform basic CRUD operations with transactions', async () => {
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      // Create
      const createResult = await transactionCollection.create(userData, { userContext });
      TestAssertions.expectSuccess(createResult);
      TestAssertions.expectTimestamps(createResult.data);
      TestAssertions.expectUserTracking(createResult.data, userContext.userId as any);

      // Read
      const findResult = await transactionCollection.findById(createResult.data._id);
      TestAssertions.expectSuccess(findResult);
      expect(findResult.data!.name).toBe(userData.name);

      // Update
      const updateResult = await transactionCollection.updateById(
        createResult.data._id,
        { $set: { name: 'Updated via Transaction' } },
        { userContext }
      );
      TestAssertions.expectSuccess(updateResult);

      // Verify update
      const updatedDoc = await transactionCollection.findById(createResult.data._id);
      TestAssertions.expectSuccess(updatedDoc);
      expect(updatedDoc.data!.name).toBe('Updated via Transaction');

      // Delete
      const deleteResult = await transactionCollection.deleteById(createResult.data._id, { userContext });
      TestAssertions.expectSuccess(deleteResult);

      // Verify soft delete
      const deletedDoc = await transactionCollection.findById(createResult.data._id);
      TestAssertions.expectSuccess(deletedDoc);
      expect(deletedDoc.data).toBeNull();
    });

    it('should handle batch operations within transactions', async () => {
      const users = TestDataFactory.createMultipleUsers(5);
      const userContext = TestDataFactory.createUserContext();

      // Create multiple users
      const createPromises = users.map(userData => 
        transactionCollection.create(userData, { userContext })
      );
      const createResults = await Promise.all(createPromises);

      createResults.forEach(result => TestAssertions.expectSuccess(result));

      // Verify all were created
      const allUsers = await transactionCollection.find({});
      TestAssertions.expectSuccess(allUsers);
      expect(allUsers.data).toHaveLength(5);

      // Update all users
      const updatePromises = createResults.map(result => 
        transactionCollection.updateById(
          result.data!._id,
          { $set: { age: 25 } },
          { userContext }
        )
      );
      const updateResults = await Promise.all(updatePromises);

      updateResults.forEach(result => TestAssertions.expectSuccess(result));

      // Verify all updates
      const updatedUsers = await transactionCollection.find({});
      TestAssertions.expectSuccess(updatedUsers);
      updatedUsers.data.forEach(user => expect(user.age).toBe(25));
    });

    it('should maintain audit log consistency in transactions', async () => {
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      const result = await transactionCollection.create(userData, { userContext });
      TestAssertions.expectSuccess(result);

      // Verify audit log was created
      const auditLogs = await transactionCollection.getAuditCollection().find({}).toArray();
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0]!.action).toBe('create');
      expect(auditLogs[0]!.ref.id.toString()).toBe(result.data!._id.toString());

      // Update and check audit consistency
      await transactionCollection.updateById(
        result.data._id,
        { $set: { name: 'Updated' } },
        { userContext }
      );

      const updatedAuditLogs = await transactionCollection.getAuditCollection().find({}).toArray();
      expect(updatedAuditLogs).toHaveLength(2);
      expect(updatedAuditLogs.map(log => log.action).sort()).toEqual(['create', 'update']);
    });
  });
});