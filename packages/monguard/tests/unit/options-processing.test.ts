import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Db as MongoDb } from 'mongodb';
import { MonguardCollection } from '../../src/monguard-collection';
import { TestDatabase } from '../setup';
import { TestDataFactory, TestUser } from '../factories';
import { adaptDb } from '../mongodb-adapter';
import { TestAssertions } from '../test-utils';
import type { Db } from '../../src/mongodb-types';

describe('Options Processing and Edge Cases', () => {
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

  describe('MonguardCollectionOptions', () => {
    it('should use default options with explicit config', () => {
      const collection = new MonguardCollection<TestUser>(db, 'test_users', {
        auditCollectionName: 'audit_logs',
        concurrency: { transactionsEnabled: false },
      });

      expect(collection.getAuditCollection().collectionName).toBe('audit_logs');
    });

    it('should use custom audit collection name', () => {
      const collection = new MonguardCollection<TestUser>(db, 'test_users', {
        auditCollectionName: 'custom_audit',
        concurrency: { transactionsEnabled: false },
      });

      expect(collection.getAuditCollection().collectionName).toBe('custom_audit');
    });

    it('should handle disableAudit option', () => {
      const collection = new MonguardCollection<TestUser>(db, 'test_users', {
        auditCollectionName: 'audit_logs',
        disableAudit: true,
        concurrency: { transactionsEnabled: false },
      });

      // We can't directly test the private options, but we can test the behavior
      expect(collection).toBeInstanceOf(MonguardCollection);
    });

    it('should merge partial options with defaults', () => {
      const collection = new MonguardCollection<TestUser>(db, 'test_users', {
        auditCollectionName: 'my_audit',
        concurrency: { transactionsEnabled: false },
        // disableAudit should default to false
      });

      expect(collection.getAuditCollection().collectionName).toBe('my_audit');
    });

    it('should require config in options', () => {
      expect(() => {
        // @ts-expect-error Testing invalid config
        new MonguardCollection<TestUser>(db, 'test_users', {
          auditCollectionName: 'audit_logs',
        });
      }).toThrow('MonguardCollectionOptions.config is required');
    });

    it('should validate transactionsEnabled is explicitly set', () => {
      expect(() => {
        new MonguardCollection<TestUser>(db, 'test_users', {
          auditCollectionName: 'audit_logs',
          // @ts-expect-error Testing invalid config
          concurrency: {},
        });
      }).toThrow('transactionsEnabled must be explicitly set to true or false');
    });

    it('should accept transaction-enabled config', () => {
      expect(() => {
        new MonguardCollection<TestUser>(db, 'test_users', {
          auditCollectionName: 'audit_logs',
          concurrency: { transactionsEnabled: true },
        });
      }).not.toThrow();
    });

    it('should accept transaction-disabled config', () => {
      expect(() => {
        new MonguardCollection<TestUser>(db, 'test_users', {
          auditCollectionName: 'audit_logs',
          concurrency: { transactionsEnabled: false },
        });
      }).not.toThrow();
    });
  });

  describe('Operation Options Edge Cases', () => {
    let collection: MonguardCollection<TestUser>;

    beforeEach(() => {
      collection = new MonguardCollection<TestUser>(db, 'test_users', {
        auditCollectionName: 'audit_logs',
        concurrency: { transactionsEnabled: false },
      });
    });

    describe('CreateOptions', () => {
      it('should handle undefined options', async () => {
        const userData = TestDataFactory.createUser();

        const result = await collection.create(userData);

        expect(result._id).toBeDefined();
      });

      it('should handle empty options object', async () => {
        const userData = TestDataFactory.createUser();

        const result = await collection.create(userData, {});

        expect(result._id).toBeDefined();
      });

      it('should handle skipAudit option', async () => {
        const userData = TestDataFactory.createUser();

        const result = await collection.create(userData, { skipAudit: true });

        expect(result._id).toBeDefined();

        // Verify no audit log was created
        const auditLogs = await collection.getAuditCollection().find({}).toArray();
        expect(auditLogs).toHaveLength(0);
      });

      it('should handle userContext with ObjectId', async () => {
        const userData = TestDataFactory.createUser();
        const userContext = TestDataFactory.createUserContext();

        const result = await collection.create(userData, { userContext });

        expect(result._id).toBeDefined();
        expect(result.createdBy).toEqual(expect.any(Object));
      });

      it('should handle userContext with string ID', async () => {
        const userData = TestDataFactory.createUser();
        const userContext = { userId: '507f1f77bcf86cd799439011' };

        const result = await collection.create(userData, { userContext });

        expect(result._id).toBeDefined();
        expect(result.createdBy).toEqual('507f1f77bcf86cd799439011');
      });
    });

    describe('UpdateOptions', () => {
      it('should handle upsert option', async () => {
        const userData = TestDataFactory.createUser();
        const nonExistentId = TestDataFactory.createObjectId();

        const result = await collection.updateById(nonExistentId, { $set: { name: 'Updated Name' } }, { upsert: true });

        expect((result as any).upsertedCount).toBe(1);
      });

      it('should handle combination of skipAudit and userContext', async () => {
        const createdDoc = await collection.create(TestDataFactory.createUser());

        const userContext = TestDataFactory.createUserContext();
        await collection.updateById(createdDoc._id, { $set: { name: 'Updated' } }, { skipAudit: true, userContext });

        // Verify only create audit log exists (not update)
        const auditLogs = await collection.getAuditCollection().find({}).toArray();
        expect(auditLogs).toHaveLength(1);
        expect(auditLogs[0]!.action).toBe('create');
      });
    });

    describe('DeleteOptions', () => {
      it('should handle hardDelete option', async () => {
        const createdDoc = await collection.create(TestDataFactory.createUser());

        await collection.deleteById(createdDoc._id, { hardDelete: true });

        // Verify document is completely removed
        const findResult = await collection.findById(createdDoc._id, { includeSoftDeleted: true });
        expect(findResult).toBeNull();
      });

      it('should handle combination of hardDelete and skipAudit', async () => {
        const createdDoc = await collection.create(TestDataFactory.createUser());

        await collection.deleteById(createdDoc._id, {
          hardDelete: true,
          skipAudit: true,
        });

        // Verify only create audit log exists (not delete)
        const auditLogs = await collection.getAuditCollection().find({}).toArray();
        expect(auditLogs).toHaveLength(1);
        expect(auditLogs[0]!.action).toBe('create');
      });
    });

    describe('FindOptions', () => {
      it('should handle includeSoftDeleted option', async () => {
        const createdDoc = await collection.create(TestDataFactory.createUser());

        await collection.deleteById(createdDoc._id); // Soft delete

        const findResult = await collection.findById(createdDoc._id, { includeSoftDeleted: true });

        expect(findResult).not.toBeNull();
        expect(findResult!.deletedAt).toBeInstanceOf(Date);
      });

      it('should handle pagination options', async () => {
        const users = TestDataFactory.createMultipleUsers(5);
        for (const user of users) {
          await collection.create(user);
        }

        const result = await collection.find({}, { limit: 2, skip: 1 });

        expect(result).toHaveLength(2);
      });

      it('should handle sort options', async () => {
        await collection.create(TestDataFactory.createUser({ name: 'Alice', age: 25 }));
        await collection.create(TestDataFactory.createUser({ name: 'Bob', age: 30 }));
        await collection.create(TestDataFactory.createUser({ name: 'Charlie', age: 20 }));

        const result = await collection.find({}, { sort: { age: 1 } });

        expect(result[0]!.name).toBe('Charlie');
        expect(result[1]!.name).toBe('Alice');
        expect(result[2]!.name).toBe('Bob');
      });
    });
  });

  describe('Global Audit Disable', () => {
    it('should not create audit logs when globally disabled', async () => {
      const collection = new MonguardCollection<TestUser>(db, 'test_users', {
        auditCollectionName: 'audit_logs',
        disableAudit: true,
        concurrency: { transactionsEnabled: false },
      });

      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      // Perform operations that normally create audit logs
      const createdDoc = await collection.create(userData, { userContext });

      await collection.updateById(createdDoc._id, { $set: { name: 'Updated' } }, { userContext });
      await collection.deleteById(createdDoc._id, { userContext });

      // Verify no audit logs were created
      const auditLogs = await collection.getAuditCollection().find({}).toArray();
      expect(auditLogs).toHaveLength(0);
    });

    it('should ignore skipAudit when globally disabled', async () => {
      const collection = new MonguardCollection<TestUser>(db, 'test_users', {
        auditCollectionName: 'audit_logs',
        disableAudit: true,
        concurrency: { transactionsEnabled: false },
      });

      const userData = TestDataFactory.createUser();

      // skipAudit: false should be ignored due to global disable
      await collection.create(userData, { skipAudit: false });

      // Verify no audit logs were created despite skipAudit: false
      const auditLogs = await collection.getAuditCollection().find({}).toArray();
      expect(auditLogs).toHaveLength(0);
    });
  });

  describe('Error Handling Edge Cases', () => {
    let collection: MonguardCollection<TestUser>;

    beforeEach(() => {
      collection = new MonguardCollection<TestUser>(db, 'test_users', {
        auditCollectionName: 'audit_logs',
        concurrency: { transactionsEnabled: false },
      });
    });

    it('should handle empty document creation', async () => {
      // @ts-expect-error Testing invalid input
      const result = await collection.create({});

      // MongoDB allows empty documents, so this should succeed
      expect(result._id).toBeDefined();
    });

    it('should handle null document gracefully', async () => {
      // @ts-expect-error Testing invalid input
      const result = await collection.create(null);

      // MongoDB driver converts null to empty object and succeeds
      expect(result._id).toBeDefined();
    });
  });
});
