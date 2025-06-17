import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectId, Db } from 'mongodb';
import { MonguardCollection } from '../../monguard-collection';
import { AuditLogDocument } from '../../types';
import { TestDatabase } from '../setup';
import { TestDataFactory, TestUser } from '../factories';
import { TestAssertions, TestHelpers } from '../test-utils';

describe('Audit Logging Integration Tests', () => {
  let testDb: TestDatabase;
  let db: Db;
  let collection: MonguardCollection<TestUser>;

  beforeEach(async () => {
    testDb = new TestDatabase();
    db = await testDb.start();
    collection = new MonguardCollection<TestUser>(db, 'test_users', {
      auditCollectionName: 'audit_logs',
      config: { transactionsEnabled: false }
    });
  });

  afterEach(async () => {
    await testDb.stop();
  });

  describe('Audit Log Creation', () => {
    it('should create audit log for create operation', async () => {
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();
      const timeRange = TestHelpers.createDateRange();
      
      const result = await collection.create(userData, { userContext });
      TestAssertions.expectSuccess(result);
      
      const auditLogs = await collection.getAuditCollection().find({}).toArray();
      expect(auditLogs).toHaveLength(1);
      
      const auditLog = auditLogs[0];
      expect(auditLog).toBeDefined();
      TestAssertions.expectAuditLog(auditLog!, 'create', result.data!._id);
      expect(auditLog!.userId).toEqual(userContext.userId);
      expect(auditLog!.ref.collection).toBe('test_users');
      expect(auditLog!.metadata?.after).toBeDefined();
      expect(auditLog!.metadata?.after.name).toBe(userData.name);
      TestHelpers.expectDateInRange(auditLog!.timestamp, timeRange);
    });

    it('should create audit log for update operation', async () => {
      const createResult = await collection.create(TestDataFactory.createUser({ name: 'Original Name' }));
      TestAssertions.expectSuccess(createResult);
      
      const userContext = TestDataFactory.createUserContext();
      const timeRange = TestHelpers.createDateRange();
      
      const updateResult = await collection.updateById(
        createResult.data._id,
        { $set: { name: 'Updated Name', age: 35 } },
        { userContext }
      );
      TestAssertions.expectSuccess(updateResult);
      
      const auditLogs = await collection.getAuditCollection().find({ action: 'update' }).toArray();
      expect(auditLogs).toHaveLength(1);
      
      const auditLog = auditLogs[0];
      expect(auditLog).toBeDefined();
      TestAssertions.expectAuditLog(auditLog!, 'update', createResult.data!._id);
      expect(auditLog!.userId).toEqual(userContext.userId);
      expect(auditLog!.metadata?.before.name).toBe('Original Name');
      expect(auditLog!.metadata?.after.name).toBe('Updated Name');
      expect(auditLog!.metadata?.changes).toContain('name');
      expect(auditLog!.metadata?.changes).toContain('age');
      TestHelpers.expectDateInRange(auditLog!.timestamp, timeRange);
    });

    it('should create audit log for soft delete operation', async () => {
      const createResult = await collection.create(TestDataFactory.createUser());
      TestAssertions.expectSuccess(createResult);
      
      const userContext = TestDataFactory.createUserContext();
      const timeRange = TestHelpers.createDateRange();
      
      const deleteResult = await collection.deleteById(createResult.data._id, { userContext });
      TestAssertions.expectSuccess(deleteResult);
      
      const auditLogs = await collection.getAuditCollection().find({ action: 'delete' }).toArray();
      expect(auditLogs).toHaveLength(1);
      
      const auditLog = auditLogs[0];
      expect(auditLog).toBeDefined();
      TestAssertions.expectAuditLog(auditLog!, 'delete', createResult.data!._id);
      expect(auditLog!.userId).toEqual(userContext.userId);
      expect(auditLog!.metadata?.softDelete).toBe(true);
      expect(auditLog!.metadata?.before).toBeDefined();
      TestHelpers.expectDateInRange(auditLog!.timestamp, timeRange);
    });

    it('should create audit log for hard delete operation', async () => {
      const createResult = await collection.create(TestDataFactory.createUser());
      TestAssertions.expectSuccess(createResult);
      
      const userContext = TestDataFactory.createUserContext();
      const timeRange = TestHelpers.createDateRange();
      
      const deleteResult = await collection.deleteById(createResult.data._id, { userContext, hardDelete: true });
      TestAssertions.expectSuccess(deleteResult);
      
      const auditLogs = await collection.getAuditCollection().find({ action: 'delete' }).toArray();
      expect(auditLogs).toHaveLength(1);
      
      const auditLog = auditLogs[0];
      expect(auditLog).toBeDefined();
      TestAssertions.expectAuditLog(auditLog!, 'delete', createResult.data!._id);
      expect(auditLog!.userId).toEqual(userContext.userId);
      expect(auditLog!.metadata?.hardDelete).toBe(true);
      expect(auditLog!.metadata?.before).toBeDefined();
      TestHelpers.expectDateInRange(auditLog!.timestamp, timeRange);
    });

    it('should not create audit log when skipAudit is true', async () => {
      const userData = TestDataFactory.createUser();
      
      const result = await collection.create(userData, { skipAudit: true });
      TestAssertions.expectSuccess(result);
      
      const auditLogs = await collection.getAuditCollection().find({}).toArray();
      expect(auditLogs).toHaveLength(0);
    });

    it('should not create audit logs when globally disabled', async () => {
      const disabledCollection = new MonguardCollection<TestUser>(db, 'test_users_disabled', {
        auditCollectionName: 'audit_logs',
        disableAudit: true,
        config: { transactionsEnabled: false }
      });
      
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();
      
      const createResult = await disabledCollection.create(userData, { userContext });
      TestAssertions.expectSuccess(createResult);
      
      const updateResult = await disabledCollection.updateById(
        createResult.data._id,
        { $set: { name: 'Updated' } },
        { userContext }
      );
      TestAssertions.expectSuccess(updateResult);
      
      await disabledCollection.deleteById(createResult.data._id, { userContext });
      
      const auditLogs = await disabledCollection.getAuditCollection().find({}).toArray();
      expect(auditLogs).toHaveLength(0);
    });

    it('should handle audit log creation failure gracefully', async () => {
      // Mock the audit collection to throw an error
      const originalInsertOne = collection.getAuditCollection().insertOne;
      vi.spyOn(collection.getAuditCollection(), 'insertOne').mockRejectedValue(new Error('Audit insert failed'));
      
      const userData = TestDataFactory.createUser();
      
      // Operation should still succeed despite audit failure
      const result = await collection.create(userData);
      TestAssertions.expectSuccess(result);
      
      // Restore original method
      collection.getAuditCollection().insertOne = originalInsertOne;
    });
  });

  describe('Audit Log Data Integrity', () => {
    it('should convert string userId to ObjectId in audit logs', async () => {
      const userData = TestDataFactory.createUser();
      const userContext = { userId: '507f1f77bcf86cd799439011' };
      
      const result = await collection.create(userData, { userContext });
      TestAssertions.expectSuccess(result);
      
      const auditLog = await collection.getAuditCollection().findOne({});
      expect(auditLog).not.toBeNull();
      expect(auditLog!.userId).toBeInstanceOf(ObjectId);
      expect(auditLog!.userId!.toString()).toBe('507f1f77bcf86cd799439011');
    });

    it('should handle ObjectId userId in audit logs', async () => {
      const userData = TestDataFactory.createUser();
      const userId = new ObjectId();
      const userContext = { userId };
      
      const result = await collection.create(userData, { userContext });
      TestAssertions.expectSuccess(result);
      
      const auditLog = await collection.getAuditCollection().findOne({});
      expect(auditLog).not.toBeNull();
      expect(auditLog!.userId).toEqual(userId);
    });

    it('should store complete before and after state for updates', async () => {
      const createResult = await collection.create(TestDataFactory.createUser({
        name: 'John Doe',
        email: 'john@example.com',
        age: 30
      }));
      TestAssertions.expectSuccess(createResult);
      
      const updateResult = await collection.updateById(
        createResult.data._id,
        { $set: { name: 'Jane Doe', age: 31 } }
      );
      TestAssertions.expectSuccess(updateResult);
      
      const auditLog = await collection.getAuditCollection().findOne({ action: 'update' });
      expect(auditLog).not.toBeNull();
      
      // Check before state
      expect(auditLog!.metadata?.before.name).toBe('John Doe');
      expect(auditLog!.metadata?.before.email).toBe('john@example.com');
      expect(auditLog!.metadata?.before.age).toBe(30);
      
      // Check after state
      expect(auditLog!.metadata?.after.name).toBe('Jane Doe');
      expect(auditLog!.metadata?.after.email).toBe('john@example.com');
      expect(auditLog!.metadata?.after.age).toBe(31);
      
      // Check changes tracking
      expect(auditLog!.metadata?.changes).toEqual(expect.arrayContaining(['name', 'age']));
      expect(auditLog!.metadata?.changes).not.toContain('email');
    });

    it('should track nested object changes correctly', async () => {
      const userWithProfile = {
        ...TestDataFactory.createUser(),
        profile: { bio: 'Original bio', preferences: { theme: 'light' } }
      };
      
      const createResult = await collection.create(userWithProfile as any);
      TestAssertions.expectSuccess(createResult);
      
      const updateResult = await collection.updateById(
        createResult.data._id,
        { $set: { 'profile.preferences.theme': 'dark' } }
      );
      TestAssertions.expectSuccess(updateResult);
      
      const auditLog = await collection.getAuditCollection().findOne({ action: 'update' });
      expect(auditLog).not.toBeNull();
      
      expect(auditLog!.metadata?.before.profile.preferences.theme).toBe('light');
      expect(auditLog!.metadata?.after.profile.preferences.theme).toBe('dark');
      expect(auditLog!.metadata?.changes).toContain('profile');
    });
  });

  describe('Audit Log Consistency', () => {
    it('should maintain audit log sequence for multiple operations', async () => {
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();
      
      // Create
      const createResult = await collection.create(userData, { userContext });
      TestAssertions.expectSuccess(createResult);
      
      // Update
      await collection.updateById(
        createResult.data._id,
        { $set: { name: 'Updated Name' } },
        { userContext }
      );
      
      // Soft Delete
      await collection.deleteById(createResult.data._id, { userContext });
      
      // Restore
      await collection.restore({ _id: createResult.data._id }, userContext);
      
      // Hard Delete
      await collection.deleteById(createResult.data._id, { userContext, hardDelete: true });
      
      const auditLogs = await collection.getAuditCollection()
        .find({ 'ref.id': createResult.data._id })
        .sort({ timestamp: 1 })
        .toArray();
      
      expect(auditLogs).toHaveLength(4);
      expect(auditLogs[0]!.action).toBe('create');
      expect(auditLogs[1]!.action).toBe('update');
      expect(auditLogs[2]!.action).toBe('delete');
      expect(auditLogs[3]!.action).toBe('delete');
      
      // Verify timestamps are in order
      for (let i = 1; i < auditLogs.length; i++) {
        expect(auditLogs[i]!.timestamp.getTime()).toBeGreaterThanOrEqual(
          auditLogs[i - 1]!.timestamp.getTime()
        );
      }
    });

    it('should handle concurrent operations without audit log corruption', async () => {
      const users = TestDataFactory.createMultipleUsers(5);
      const userContext = TestDataFactory.createUserContext();
      
      // Create multiple users concurrently
      const createPromises = users.map(user => 
        collection.create(user, { userContext })
      );
      const createResults = await Promise.all(createPromises);
      
      // Update all users concurrently
      const updatePromises = createResults.map((result, index) => {
        TestAssertions.expectSuccess(result);
        return collection.updateById(
          result.data._id,
          { $set: { name: `Updated User ${index}` } },
          { userContext }
        );
      });
      await Promise.all(updatePromises);
      
      // Verify all audit logs were created correctly
      const auditLogs = await collection.getAuditCollection().find({}).toArray();
      expect(auditLogs).toHaveLength(10); // 5 creates + 5 updates
      
      const createLogs = auditLogs.filter(log => log.action === 'create');
      const updateLogs = auditLogs.filter(log => log.action === 'update');
      
      expect(createLogs).toHaveLength(5);
      expect(updateLogs).toHaveLength(5);
      
      // Verify each user has corresponding audit logs
      for (const createResult of createResults) {
        const userAuditLogs = auditLogs.filter(log => 
          log.ref.id.equals(createResult.data._id)
        );
        expect(userAuditLogs).toHaveLength(2); // 1 create + 1 update
      }
    });

    it('should handle bulk operations audit logging', async () => {
      const users = TestDataFactory.createMultipleUsers(3);
      const userContext = TestDataFactory.createUserContext();
      
      // Create users
      const createResults = [];
      for (const user of users) {
        const result = await collection.create(user, { userContext });
        TestAssertions.expectSuccess(result);
        createResults.push(result.data);
      }
      
      // Bulk delete (soft delete)
      const deleteResult = await collection.delete({ name: { $regex: /^User / } }, { userContext });
      TestAssertions.expectSuccess(deleteResult);
      
      const auditLogs = await collection.getAuditCollection().find({}).sort({ timestamp: 1 }).toArray();
      expect(auditLogs).toHaveLength(6); // 3 creates + 3 deletes
      
      const deleteLogs = auditLogs.filter(log => log.action === 'delete');
      expect(deleteLogs).toHaveLength(3);
      
      // Verify each delete log corresponds to a created user
      for (const deleteLog of deleteLogs) {
        const correspondingUser = createResults.find(user => 
          user._id.equals(deleteLog.ref.id)
        );
        expect(correspondingUser).toBeDefined();
      }
    });
  });

  describe('Custom Audit Collection', () => {
    it('should use custom audit collection name', async () => {
      const customCollection = new MonguardCollection<TestUser>(db, 'test_users', {
        auditCollectionName: 'custom_audit_logs',
        config: { transactionsEnabled: false }
      });
      
      const userData = TestDataFactory.createUser();
      const result = await customCollection.create(userData);
      TestAssertions.expectSuccess(result);
      
      // Verify audit log was created in custom collection
      const auditLogs = await db.collection('custom_audit_logs').find({}).toArray();
      expect(auditLogs).toHaveLength(1);
      
      // Verify no logs in default collection
      const defaultAuditLogs = await db.collection('audit_logs').find({}).toArray();
      expect(defaultAuditLogs).toHaveLength(0);
    });

    it('should isolate audit logs between different collection instances', async () => {
      const collection1 = new MonguardCollection<TestUser>(db, 'users1', {
        auditCollectionName: 'audit1',
        config: { transactionsEnabled: false }
      });
      const collection2 = new MonguardCollection<TestUser>(db, 'users2', {
        auditCollectionName: 'audit2',
        config: { transactionsEnabled: false }
      });
      
      const userData1 = TestDataFactory.createUser({ name: 'User 1' });
      const userData2 = TestDataFactory.createUser({ name: 'User 2' });
      
      await collection1.create(userData1);
      await collection2.create(userData2);
      
      const audit1Logs = await db.collection('audit1').find({}).toArray();
      const audit2Logs = await db.collection('audit2').find({}).toArray();
      
      expect(audit1Logs).toHaveLength(1);
      expect(audit2Logs).toHaveLength(1);
      expect(audit1Logs[0].ref.collection).toBe('users1');
      expect(audit2Logs[0].ref.collection).toBe('users2');
    });
  });

  describe('Error Scenarios', () => {
    it('should handle missing before document gracefully', async () => {
      const nonExistentId = new ObjectId();
      
      // Attempt to update a non-existent document
      const result = await collection.updateById(
        nonExistentId,
        { $set: { name: 'Updated' } }
      );
      
      TestAssertions.expectSuccess(result);
      expect(result.data.modifiedCount).toBe(0);
      
      // No audit log should be created since no document was modified
      const auditLogs = await collection.getAuditCollection().find({}).toArray();
      expect(auditLogs).toHaveLength(0);
    });

    it('should handle corrupted audit collection gracefully', async () => {
      // Insert invalid audit log document
      await collection.getAuditCollection().insertOne({
        invalid: 'document'
      } as any);
      
      const userData = TestDataFactory.createUser();
      
      // Normal operations should still work
      const result = await collection.create(userData);
      TestAssertions.expectSuccess(result);
      
      const validAuditLogs = await collection.getAuditCollection().find({
        action: { $exists: true }
      }).toArray();
      expect(validAuditLogs).toHaveLength(1);
    });
  });
});