import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectId as MongoObjectId, Db as MongoDb } from 'mongodb';
import { MonguardCollection } from '../../src/monguard-collection';
import { TestDatabase } from '../setup';
import { TestDataFactory, TestUser } from '../factories';
import { TestAssertions } from '../test-utils';
import { adaptDb } from '../mongodb-adapter';
import type { Db } from '../../src/mongodb-types';

describe('Document ID Types Integration Tests', () => {
  let testDb: TestDatabase;
  let mongoDb: MongoDb;
  let db: Db;

  beforeEach(async () => {
    testDb = new TestDatabase();
    mongoDb = await testDb.start();
    db = adaptDb(mongoDb);
  });

  afterEach(async () => {
    await testDb.stop();
  });

  describe('ObjectId Mode (Default)', () => {
    let collection: MonguardCollection<TestUser>;

    beforeEach(() => {
      collection = new MonguardCollection<TestUser>(db, 'objectid_users', {
        auditCollectionName: 'objectid_audit_logs',
        documentIdType: 'objectId', // explicit for clarity
        concurrency: { transactionsEnabled: false }
      });
    });

    it('should handle ObjectId user context in create operations', async () => {
      const userData = TestDataFactory.createUser();
      const objectIdUser = new MongoObjectId();
      const userContext = { userId: objectIdUser };

      const result = await collection.create(userData, { userContext });
      TestAssertions.expectSuccess(result);

      // User tracking fields should store ObjectId as-is
      expect(result.data.createdBy).toEqual(objectIdUser);
      expect(result.data.updatedBy).toEqual(objectIdUser);

      // Verify audit log
      const auditLogs = await collection.getAuditCollection().find({}).toArray();
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].userId).toEqual(objectIdUser);
      expect(auditLogs[0].action).toBe('create');
    });

    it('should handle string user context in create operations', async () => {
      const userData = TestDataFactory.createUser();
      const stringUserId = 'user-123';
      const userContext = { userId: stringUserId };

      const result = await collection.create(userData, { userContext });
      TestAssertions.expectSuccess(result);

      // User tracking fields should store string as-is
      expect(result.data.createdBy).toBe(stringUserId);
      expect(result.data.updatedBy).toBe(stringUserId);

      // Verify audit log
      const auditLogs = await collection.getAuditCollection().find({}).toArray();
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].userId).toBe(stringUserId);
      expect(auditLogs[0].action).toBe('create');
    });

    it('should handle mixed ID types in update operations', async () => {
      const userData = TestDataFactory.createUser();
      const createResult = await collection.create(userData);
      TestAssertions.expectSuccess(createResult);

      const objectIdUser = new MongoObjectId();
      const updateResult = await collection.updateById(
        createResult.data._id,
        { $set: { name: 'Updated Name' } },
        { userContext: { userId: objectIdUser } }
      );
      TestAssertions.expectSuccess(updateResult);

      // Verify document was updated with ObjectId
      const updatedDoc = await collection.findById(createResult.data._id);
      TestAssertions.expectSuccess(updatedDoc);
      expect(updatedDoc.data!.updatedBy).toEqual(objectIdUser);

      // Verify audit log
      const auditLogs = await collection.getAuditCollection().find({ action: 'update' }).toArray();
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].userId).toEqual(objectIdUser);
    });

    it('should handle deletion with different ID types', async () => {
      const userData = TestDataFactory.createUser();
      const createResult = await collection.create(userData);
      TestAssertions.expectSuccess(createResult);

      const stringUserId = 'deleter-456';
      const deleteResult = await collection.deleteById(
        createResult.data._id,
        { userContext: { userId: stringUserId } }
      );
      TestAssertions.expectSuccess(deleteResult);

      // Verify soft delete with string user ID
      const deletedDoc = await collection.findById(createResult.data._id, { includeSoftDeleted: true });
      TestAssertions.expectSuccess(deletedDoc);
      expect(deletedDoc.data!.deletedBy).toBe(stringUserId);

      // Verify audit log
      const auditLogs = await collection.getAuditCollection().find({ action: 'delete' }).toArray();
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].userId).toBe(stringUserId);
    });
  });

  describe('String Mode', () => {
    let collection: MonguardCollection<TestUser>;

    beforeEach(() => {
      collection = new MonguardCollection<TestUser>(db, 'string_users', {
        auditCollectionName: 'string_audit_logs',
        documentIdType: 'string',
        concurrency: { transactionsEnabled: false }
      });
    });

    it('should handle string user context in create operations', async () => {
      const userData = TestDataFactory.createUser();
      const stringUserId = 'user-abc-123';
      const userContext = { userId: stringUserId };

      const result = await collection.create(userData, { userContext });
      TestAssertions.expectSuccess(result);

      // User tracking fields should store string as-is
      expect(result.data.createdBy).toBe(stringUserId);
      expect(result.data.updatedBy).toBe(stringUserId);

      // Verify audit log
      const auditLogs = await collection.getAuditCollection().find({}).toArray();
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].userId).toBe(stringUserId);
      expect(auditLogs[0].action).toBe('create');
    });

    it('should handle ObjectId user context in create operations', async () => {
      const userData = TestDataFactory.createUser();
      const objectIdUser = new MongoObjectId();
      const userContext = { userId: objectIdUser };

      const result = await collection.create(userData, { userContext });
      TestAssertions.expectSuccess(result);

      // User tracking fields should store ObjectId as-is (no conversion)
      expect(result.data.createdBy).toEqual(objectIdUser);
      expect(result.data.updatedBy).toEqual(objectIdUser);

      // Verify audit log
      const auditLogs = await collection.getAuditCollection().find({}).toArray();
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].userId).toEqual(objectIdUser);
      expect(auditLogs[0].action).toBe('create');
    });

    it('should handle custom ID types in operations', async () => {
      const userData = TestDataFactory.createUser();
      const customUserId = { type: 'custom', id: 12345 };
      const userContext = { userId: customUserId };

      const result = await collection.create(userData, { userContext });
      TestAssertions.expectSuccess(result);

      // User tracking fields should store custom object as-is
      expect(result.data.createdBy).toEqual(customUserId);
      expect(result.data.updatedBy).toEqual(customUserId);

      // Verify audit log
      const auditLogs = await collection.getAuditCollection().find({}).toArray();
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].userId).toEqual(customUserId);
      expect(auditLogs[0].action).toBe('create');
    });

    it('should handle null user context values', async () => {
      // Test with null userId in userContext
      const userData = { 
        ...TestDataFactory.createUser(),
        createdBy: undefined,
        updatedBy: undefined
      };

      const result = await collection.create(userData, { userContext: { userId: null } });
      TestAssertions.expectSuccess(result);
      expect(result.data.createdBy).toBeNull();
      expect(result.data.updatedBy).toBeNull();

      // Verify audit log stores null userId as-is
      const auditLogs = await collection.getAuditCollection().find({}).toArray();
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].userId).toBeNull();
      expect(auditLogs[0].action).toBe('create');
    });
  });

  describe('Default Mode (Backward Compatibility)', () => {
    let collection: MonguardCollection<TestUser>;

    beforeEach(() => {
      // Don't specify documentIdType - should default to 'objectId'
      collection = new MonguardCollection<TestUser>(db, 'default_users', {
        auditCollectionName: 'default_audit_logs',
        concurrency: { transactionsEnabled: false }
      });
    });

    it('should default to objectId mode for backward compatibility', async () => {
      const userData = TestDataFactory.createUser();
      const objectIdUser = new MongoObjectId();
      const userContext = { userId: objectIdUser };

      const result = await collection.create(userData, { userContext });
      TestAssertions.expectSuccess(result);

      // Should behave exactly like objectId mode
      expect(result.data.createdBy).toEqual(objectIdUser);
      expect(result.data.updatedBy).toEqual(objectIdUser);

      // Verify audit log
      const auditLogs = await collection.getAuditCollection().find({}).toArray();
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].userId).toEqual(objectIdUser);
    });

    it('should handle string IDs in default mode', async () => {
      const userData = TestDataFactory.createUser();
      const stringUserId = 'default-user-789';
      const userContext = { userId: stringUserId };

      const result = await collection.create(userData, { userContext });
      TestAssertions.expectSuccess(result);

      // Should store string as-is (no conversion)
      expect(result.data.createdBy).toBe(stringUserId);
      expect(result.data.updatedBy).toBe(stringUserId);

      // Verify audit log
      const auditLogs = await collection.getAuditCollection().find({}).toArray();
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].userId).toBe(stringUserId);
    });
  });

  describe('Cross-Mode Compatibility', () => {
    it('should allow different collections to use different modes with separate audit collections', async () => {
      const objectIdCollection = new MonguardCollection<TestUser>(db, 'objectid_users', {
        auditCollectionName: 'objectid_only_audit',
        documentIdType: 'objectId',
        concurrency: { transactionsEnabled: false }
      });

      const stringCollection = new MonguardCollection<TestUser>(db, 'string_users', {
        auditCollectionName: 'string_only_audit',
        documentIdType: 'string',
        concurrency: { transactionsEnabled: false }
      });

      const userData = TestDataFactory.createUser();
      const objectIdUser = new MongoObjectId();
      const stringUserId = 'cross-mode-user';

      // Create in ObjectId collection
      const objectIdResult = await objectIdCollection.create(userData, { 
        userContext: { userId: objectIdUser } 
      });
      TestAssertions.expectSuccess(objectIdResult);

      // Create in String collection
      const stringResult = await stringCollection.create(userData, { 
        userContext: { userId: stringUserId } 
      });
      TestAssertions.expectSuccess(stringResult);

      // Verify separate audit collections
      const objectIdAuditLogs = await objectIdCollection.getAuditCollection().find({}).toArray();
      const stringAuditLogs = await stringCollection.getAuditCollection().find({}).toArray();

      expect(objectIdAuditLogs).toHaveLength(1);
      expect(stringAuditLogs).toHaveLength(1);

      expect(objectIdAuditLogs[0].userId).toEqual(objectIdUser);
      expect(stringAuditLogs[0].userId).toBe(stringUserId);
    });

    it('should demonstrate why sharing audit collections requires same documentIdType', async () => {
      // This test documents the behavior when using shared audit collections
      // (Users should ensure consistency themselves as per the design)
      
      const sharedAuditName = 'shared_audit_logs';
      
      const objectIdCollection = new MonguardCollection<TestUser>(db, 'shared_objectid_users', {
        auditCollectionName: sharedAuditName,
        documentIdType: 'objectId',
        concurrency: { transactionsEnabled: false }
      });

      const stringCollection = new MonguardCollection<TestUser>(db, 'shared_string_users', {
        auditCollectionName: sharedAuditName,
        documentIdType: 'string',
        concurrency: { transactionsEnabled: false }
      });

      const userData = TestDataFactory.createUser();
      const objectIdUser = new MongoObjectId();
      const stringUserId = 'shared-audit-user';

      // Both collections will write to the same audit collection
      await objectIdCollection.create(userData, { userContext: { userId: objectIdUser } });
      await stringCollection.create(userData, { userContext: { userId: stringUserId } });

      // Check shared audit collection - will contain mixed ID types
      const sharedAuditLogs = await objectIdCollection.getAuditCollection().find({}).toArray();
      expect(sharedAuditLogs).toHaveLength(2);

      // This demonstrates mixed types in audit logs (user responsibility to avoid)
      const objectIdLog = sharedAuditLogs.find(log => log.userId instanceof MongoObjectId);
      const stringLog = sharedAuditLogs.find(log => typeof log.userId === 'string');

      expect(objectIdLog).toBeDefined();
      expect(stringLog).toBeDefined();
      expect(objectIdLog!.userId).toEqual(objectIdUser);
      expect(stringLog!.userId).toBe(stringUserId);
    });
  });
});