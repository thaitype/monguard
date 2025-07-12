import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectId as MongoObjectId, Db as MongoDb } from 'mongodb';
import { MonguardCollection } from '../../src/monguard-collection';
import { MonguardAuditLogger } from '../../src/audit-logger';
import { AuditLogDocument } from '../../src/types';
import { TestDatabase } from '../setup';
import { TestDataFactory, TestUser } from '../factories';
import { TestAssertions, TestHelpers } from '../test-utils';
import { adaptDb, adaptObjectId } from '../mongodb-adapter';
import type { Db, ObjectId } from '../../src/mongodb-types';

describe('Delta Audit Logging Integration Tests', () => {
  let testDb: TestDatabase;
  let mongoDb: MongoDb;
  let db: Db;
  let collection: MonguardCollection<TestUser>;
  let auditLogger: MonguardAuditLogger<ObjectId>;

  beforeEach(async () => {
    testDb = new TestDatabase();
    mongoDb = await testDb.start();
    db = adaptDb(mongoDb);

    auditLogger = new MonguardAuditLogger(db, 'audit_logs', {
      storageMode: 'delta', // Explicitly enable delta mode for these tests
      maxDepth: 3,
      arrayHandling: 'diff',
      arrayDiffMaxSize: 20,
      blacklist: ['createdAt', 'updatedAt', 'createdBy', 'updatedBy', '__v'],
    });

    collection = new MonguardCollection<TestUser>(db, 'test_users', {
      auditLogger,
      concurrency: { transactionsEnabled: false },
    });
  });

  afterEach(async () => {
    await testDb.stop();
  });

  describe('Basic Delta Functionality', () => {
    it('should create delta audit log for simple field update', async () => {
      const userData = TestDataFactory.createUser({ name: 'John Doe', age: 30 });
      const userContext = TestDataFactory.createUserContext();

      const doc = await collection.create(userData, { userContext });

      // Update a single field
      await collection.updateById(doc._id, { $set: { name: 'Jane Doe' } }, { userContext });

      const auditLogs = await collection.getAuditCollection()!.find({}).toArray();
      const updateLog = auditLogs.find(log => log.action === 'update');

      expect(updateLog).toBeDefined();
      expect(updateLog!.metadata?.storageMode).toBe('delta');
      expect(updateLog!.metadata?.deltaChanges).toBeDefined();
      expect(updateLog!.metadata?.deltaChanges!['name']).toEqual({
        old: 'John Doe',
        new: 'Jane Doe',
      });
      expect(updateLog!.metadata?.deltaChanges!['age']).toBeUndefined();
    });

    it('should create delta audit log for multiple field updates', async () => {
      const userData = TestDataFactory.createUser({
        name: 'John Doe',
        age: 30,
        email: 'john@example.com',
      });
      const userContext = TestDataFactory.createUserContext();

      const doc = await collection.create(userData, { userContext });

      // Update multiple fields
      await collection.update({ _id: doc._id }, { $set: { name: 'Jane Doe', age: 31 } }, { userContext });

      const auditLogs = await collection.getAuditCollection()!.find({}).toArray();
      const updateLog = auditLogs.find(log => log.action === 'update');

      expect(updateLog).toBeDefined();
      expect(updateLog!.metadata?.storageMode).toBe('delta');
      expect(updateLog!.metadata?.deltaChanges).toBeDefined();

      const deltaChanges = updateLog!.metadata?.deltaChanges!;
      expect(deltaChanges['name']).toEqual({
        old: 'John Doe',
        new: 'Jane Doe',
      });
      expect(deltaChanges['age']).toEqual({
        old: 30,
        new: 31,
      });
      expect(deltaChanges['email']).toBeUndefined();
    });

    it('should only store deltaChanges in delta mode (no before/after/changes fields)', async () => {
      const userData = TestDataFactory.createUser({ name: 'John Doe', age: 30 });
      const userContext = TestDataFactory.createUserContext();

      const doc = await collection.create(userData, { userContext });

      // Update to trigger delta mode
      await collection.updateById(doc._id, { $set: { name: 'Jane Doe' } }, { userContext });

      const auditLogs = await collection.getAuditCollection()!.find({}).toArray();
      const updateLog = auditLogs.find(log => log.action === 'update');

      expect(updateLog).toBeDefined();
      expect(updateLog!.metadata?.storageMode).toBe('delta');

      // Should have deltaChanges
      expect(updateLog!.metadata?.deltaChanges).toBeDefined();
      expect(updateLog!.metadata?.deltaChanges!['name']).toEqual({
        old: 'John Doe',
        new: 'Jane Doe',
      });

      // Should NOT have before, after, or changes fields in delta mode
      expect(updateLog!.metadata?.before).toBeUndefined();
      expect(updateLog!.metadata?.after).toBeUndefined();
      expect(updateLog!.metadata?.changes).toBeUndefined();
    });

    it('should create full document audit log for CREATE action', async () => {
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      await collection.create(userData, { userContext });

      const auditLogs = await collection.getAuditCollection()!.find({}).toArray();
      const createLog = auditLogs.find(log => log.action === 'create');

      expect(createLog).toBeDefined();
      expect(createLog!.metadata?.storageMode).toBe('full');
      expect(createLog!.metadata?.after).toBeDefined();
      expect(createLog!.metadata?.deltaChanges).toBeUndefined();
    });

    it('should create full document audit log for DELETE action', async () => {
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      const doc = await collection.create(userData, { userContext });
      await collection.deleteById(doc._id, { userContext });

      const auditLogs = await collection.getAuditCollection()!.find({}).toArray();
      const deleteLog = auditLogs.find(log => log.action === 'delete');

      expect(deleteLog).toBeDefined();
      expect(deleteLog!.metadata?.storageMode).toBe('full');
      expect(deleteLog!.metadata?.before).toBeDefined();
      expect(deleteLog!.metadata?.deltaChanges).toBeUndefined();
    });
  });

  describe('Nested Object Delta Tracking', () => {
    it('should track changes in nested objects', async () => {
      const userData = TestDataFactory.createUser({
        profile: {
          address: {
            city: 'Bangkok',
            country: 'Thailand',
          },
          preferences: {
            theme: 'dark',
            language: 'en',
          },
        },
      });
      const userContext = TestDataFactory.createUserContext();

      const doc = await collection.create(userData, { userContext });

      // Update nested field
      await collection.update({ _id: doc._id }, { $set: { 'profile.address.city': 'Chiang Mai' } }, { userContext });

      const auditLogs = await collection.getAuditCollection()!.find({}).toArray();
      const updateLog = auditLogs.find(log => log.action === 'update');

      expect(updateLog).toBeDefined();
      expect(updateLog!.metadata?.storageMode).toBe('delta');
      expect(updateLog!.metadata?.deltaChanges).toBeDefined();
      expect(updateLog!.metadata?.deltaChanges!['profile.address.city']).toEqual({
        old: 'Bangkok',
        new: 'Chiang Mai',
      });
      expect(updateLog!.metadata?.deltaChanges!['profile.preferences.theme']).toBeUndefined();
    });

    it('should track multiple changes in nested objects', async () => {
      const userData = TestDataFactory.createUser({
        profile: {
          address: {
            city: 'Bangkok',
            country: 'Thailand',
          },
          preferences: {
            theme: 'dark',
            language: 'en',
          },
        },
      });
      const userContext = TestDataFactory.createUserContext();

      const doc = await collection.create(userData, { userContext });

      // Update multiple nested fields
      await collection.update(
        { _id: doc._id },
        {
          $set: {
            'profile.address.city': 'Chiang Mai',
            'profile.preferences.theme': 'light',
          },
        },
        { userContext }
      );

      const auditLogs = await collection.getAuditCollection()!.find({}).toArray();
      const updateLog = auditLogs.find(log => log.action === 'update');

      expect(updateLog).toBeDefined();
      expect(updateLog!.metadata?.storageMode).toBe('delta');

      const deltaChanges = updateLog!.metadata?.deltaChanges!;
      expect(deltaChanges['profile.address.city']).toEqual({
        old: 'Bangkok',
        new: 'Chiang Mai',
      });
      expect(deltaChanges['profile.preferences.theme']).toEqual({
        old: 'dark',
        new: 'light',
      });
    });
  });

  describe('Array Delta Tracking', () => {
    it('should track array element changes with small arrays', async () => {
      const userData = TestDataFactory.createUser({
        tags: ['user', 'editor', 'active'],
      });
      const userContext = TestDataFactory.createUserContext();

      const doc = await collection.create(userData, { userContext });

      // Update array element
      await collection.update({ _id: doc._id }, { $set: { 'tags.1': 'premium' } }, { userContext });

      const auditLogs = await collection.getAuditCollection()!.find({}).toArray();
      const updateLog = auditLogs.find(log => log.action === 'update');

      expect(updateLog).toBeDefined();
      expect(updateLog!.metadata?.storageMode).toBe('delta');
      expect(updateLog!.metadata?.deltaChanges).toBeDefined();
      expect(updateLog!.metadata?.deltaChanges!['tags.1']).toEqual({
        old: 'editor',
        new: 'premium',
      });
    });

    it('should track array additions and removals', async () => {
      const userData = TestDataFactory.createUser({
        tags: ['user', 'editor'],
      });
      const userContext = TestDataFactory.createUserContext();

      const doc = await collection.create(userData, { userContext });

      // Add element to array
      await collection.update({ _id: doc._id }, { $push: { tags: 'verified' } }, { userContext });

      const auditLogs = await collection.getAuditCollection()!.find({}).toArray();
      const updateLog = auditLogs.find(log => log.action === 'update');

      expect(updateLog).toBeDefined();
      expect(updateLog!.metadata?.storageMode).toBe('delta');
      expect(updateLog!.metadata?.deltaChanges).toBeDefined();
      expect(updateLog!.metadata?.deltaChanges!['tags.2']).toEqual({
        old: null,
        new: 'verified',
      });
    });

    it('should use full array replacement for large arrays', async () => {
      // Create a large array that exceeds arrayDiffMaxSize (20)
      const largeTags = Array.from({ length: 25 }, (_, i) => `tag${i}`);
      const userData = TestDataFactory.createUser({
        tags: largeTags,
      });
      const userContext = TestDataFactory.createUserContext();

      const doc = await collection.create(userData, { userContext });

      // Update large array
      const updatedTags = [...largeTags];
      updatedTags[0] = 'updated-tag0';

      await collection.update({ _id: doc._id }, { $set: { tags: updatedTags } }, { userContext });

      const auditLogs = await collection.getAuditCollection()!.find({}).toArray();
      const updateLog = auditLogs.find(log => log.action === 'update');

      expect(updateLog).toBeDefined();
      expect(updateLog!.metadata?.storageMode).toBe('delta');
      expect(updateLog!.metadata?.deltaChanges).toBeDefined();
      expect(updateLog!.metadata?.deltaChanges!['tags']).toBeDefined();
      expect(updateLog!.metadata?.deltaChanges!['tags']!.fullDocument).toBe(true);
      expect(updateLog!.metadata?.deltaChanges!['tags']!.old).toEqual(largeTags);
      expect(updateLog!.metadata?.deltaChanges!['tags']!.new).toEqual(updatedTags);
    });
  });

  describe('Blacklist Functionality', () => {
    it('should not track changes to blacklisted fields', async () => {
      const userData = TestDataFactory.createUser({ name: 'John Doe' });
      const userContext = TestDataFactory.createUserContext();

      const doc = await collection.create(userData, { userContext });

      // The collection automatically updates these fields, but they should be blacklisted
      await collection.update({ _id: doc._id }, { $set: { name: 'Jane Doe', updatedAt: new Date() } }, { userContext });

      const auditLogs = await collection.getAuditCollection()!.find({}).toArray();
      const updateLog = auditLogs.find(log => log.action === 'update');

      expect(updateLog).toBeDefined();
      expect(updateLog!.metadata?.deltaChanges).toBeDefined();
      expect(updateLog!.metadata?.deltaChanges!['name']).toBeDefined();
      expect(updateLog!.metadata?.deltaChanges!['updatedAt']).toBeUndefined();
      expect(updateLog!.metadata?.deltaChanges!['updatedBy']).toBeUndefined();
    });

    it('should always track soft delete fields even if in blacklist', async () => {
      const userData = TestDataFactory.createUser({ name: 'John Doe' });
      const userContext = TestDataFactory.createUserContext();

      const doc = await collection.create(userData, { userContext });

      // Perform soft delete
      await collection.deleteById(doc._id, { userContext, hardDelete: false });

      const auditLogs = await collection.getAuditCollection()!.find({}).toArray();
      const deleteLog = auditLogs.find(log => log.action === 'delete');

      expect(deleteLog).toBeDefined();
      expect(deleteLog!.metadata?.softDelete).toBe(true);
      // Should track deletedAt and deletedBy even if they were in blacklist
    });
  });

  describe('Configuration Options', () => {
    it('should respect maxDepth configuration', async () => {
      // Create logger with very shallow maxDepth
      const shallowLogger = new MonguardAuditLogger(db, 'audit_logs', {
        storageMode: 'delta',
        maxDepth: 1,
      });

      const shallowCollection = new MonguardCollection<TestUser>(db, 'test_users_shallow', {
        auditLogger: shallowLogger,
        concurrency: { transactionsEnabled: false },
      });

      const userData = TestDataFactory.createUser({
        profile: {
          address: {
            city: 'Bangkok',
            country: 'Thailand',
          },
        },
      });
      const userContext = TestDataFactory.createUserContext();

      const doc = await shallowCollection.create(userData, { userContext });

      // Update deeply nested field
      await shallowCollection.update(
        { _id: doc._id },
        { $set: { 'profile.address.city': 'Chiang Mai' } },
        { userContext }
      );

      const auditLogs = await shallowCollection.getAuditCollection()!.find({}).toArray();
      const updateLog = auditLogs.find(log => log.action === 'update');

      expect(updateLog).toBeDefined();
      expect(updateLog!.metadata?.deltaChanges).toBeDefined();

      // Should have fullDocument flag due to maxDepth limit
      const profileChange = updateLog!.metadata?.deltaChanges!['profile'];
      expect(profileChange?.fullDocument).toBe(true);
    });

    it('should allow per-operation storage mode override', async () => {
      const userData = TestDataFactory.createUser({ name: 'John Doe' });
      const userContext = TestDataFactory.createUserContext();

      const doc = await collection.create(userData, { userContext });

      // Override to full mode for this specific operation
      await collection.update(
        { _id: doc._id },
        { $set: { name: 'Jane Doe' } },
        { userContext, auditControl: { storageMode: 'full' } }
      );

      const auditLogs = await collection.getAuditCollection()!.find({}).toArray();
      const updateLog = auditLogs.find(log => log.action === 'update');

      expect(updateLog).toBeDefined();
      expect(updateLog!.metadata?.storageMode).toBe('full');
      expect(updateLog!.metadata?.deltaChanges).toBeUndefined();
      expect(updateLog!.metadata?.before).toBeDefined();
      expect(updateLog!.metadata?.after).toBeDefined();
    });
  });

  describe('Full Mode Compatibility', () => {
    it('should support full mode when explicitly configured', async () => {
      const fullLogger = new MonguardAuditLogger(db, 'audit_logs', {
        storageMode: 'full',
      });

      const fullCollection = new MonguardCollection<TestUser>(db, 'test_users_full', {
        auditLogger: fullLogger,
        concurrency: { transactionsEnabled: false },
      });

      const userData = TestDataFactory.createUser({ name: 'John Doe' });
      const userContext = TestDataFactory.createUserContext();

      const doc = await fullCollection.create(userData, { userContext });

      await fullCollection.update({ _id: doc._id }, { $set: { name: 'Jane Doe' } }, { userContext });

      const auditLogs = await fullCollection.getAuditCollection()!.find({}).toArray();
      const updateLog = auditLogs.find(log => log.action === 'update');

      expect(updateLog).toBeDefined();
      expect(updateLog!.metadata?.storageMode).toBe('full');
      expect(updateLog!.metadata?.deltaChanges).toBeUndefined();
      expect(updateLog!.metadata?.before).toBeDefined();
      expect(updateLog!.metadata?.after).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should skip audit logging for empty update operations (no meaningful changes)', async () => {
      const userData = TestDataFactory.createUser({ name: 'John Doe' });
      const userContext = TestDataFactory.createUserContext();

      const doc = await collection.create(userData, { userContext });

      // Update with same value (no actual change)
      await collection.update({ _id: doc._id }, { $set: { name: 'John Doe' } }, { userContext });

      const auditLogs = await collection.getAuditCollection()!.find({}).toArray();
      const updateLogs = auditLogs.filter(log => log.action === 'update');

      // Should NOT create audit log when no meaningful changes in delta mode
      expect(updateLogs).toHaveLength(0);

      // Should only have create audit log
      const createLogs = auditLogs.filter(log => log.action === 'create');
      expect(createLogs).toHaveLength(1);
    });

    it('should skip audit logging when only infrastructure fields (__v, updatedAt, etc.) change', async () => {
      const userData = TestDataFactory.createUser({ name: 'John Doe' });
      const userContext = TestDataFactory.createUserContext();

      // Create a document without __v field (simulating legacy data)
      const legacyDoc = {
        ...userData,
        _id: TestDataFactory.createObjectId(),
        createdAt: new Date(),
        updatedAt: new Date(),
        // Note: no __v field
      };

      await collection.getCollection().insertOne(legacyDoc);

      // Update using MonGuard - this will add __v field but only change infrastructure fields
      await collection.updateById(legacyDoc._id, { $set: { name: 'John Doe' } }, { userContext });

      const auditLogs = await collection.getAuditCollection()!.find({}).toArray();
      const updateLogs = auditLogs.filter(log => log.action === 'update');

      // Should NOT create audit log when only infrastructure fields change
      expect(updateLogs).toHaveLength(0);
    });

    it('should handle null and undefined values correctly', async () => {
      const userData = TestDataFactory.createUser({
        name: 'John Doe',
        email: 'john@example.com',
      });
      const userContext = TestDataFactory.createUserContext();

      const doc = await collection.create(userData, { userContext });

      // Set field to null
      await collection.update({ _id: doc._id }, { $unset: { email: '' } }, { userContext });

      const auditLogs = await collection.getAuditCollection()!.find({}).toArray();
      const updateLog = auditLogs.find(log => log.action === 'update');

      expect(updateLog).toBeDefined();
      expect(updateLog!.metadata?.deltaChanges).toBeDefined();
      expect(updateLog!.metadata?.deltaChanges!['email']).toEqual({
        old: 'john@example.com',
        new: null,
      });
    });
  });
});
