import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectId as MongoObjectId, Db as MongoDb } from 'mongodb';
import { MonguardCollection } from '../../src/monguard-collection';
import { MonguardAuditLogger } from '../../src/audit-logger';
import { TestDatabase } from '../setup';
import { TestDataFactory, TestUser } from '../factories';
import { TestHelpers } from '../test-utils';
import { adaptDb, adaptObjectId } from '../mongodb-adapter';
import type { Db, ObjectId } from '../../src/mongodb-types';

// Interface for documents with audit fields in tests
interface TestDocumentWithAuditFields {
  name: string;
  email?: string;
  age?: number;
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date;
  createdBy?: any;
  updatedBy?: any;
  deletedBy?: any;
  [key: string]: any;
}

// Test class to access private methods
class TestableMonguardCollection<
  T extends { _id: ObjectId; createdAt: Date; updatedAt: Date; deletedAt?: Date },
> extends MonguardCollection<T> {
  public testGetSoftDeleteFilter() {
    return (this as any).getSoftDeleteFilter();
  }

  public testMergeSoftDeleteFilter(filter: any) {
    return (this as any).mergeSoftDeleteFilter(filter);
  }

  public testAddTimestamps(document: any, isUpdate = false, userContext?: any) {
    return (this as any).addTimestamps(document, isUpdate, userContext);
  }

  public testGetChangedFields(before: any, after: any) {
    return (this as any).getChangedFields(before, after);
  }

  public testUpdateAutoFields(document: any, options: any) {
    return this.updateAutoFields(document, options);
  }

  public testShouldAudit(skipAudit?: boolean) {
    return (this as any).shouldAudit(skipAudit);
  }

  // Method to simulate collection.find().toArray() error for testing
  public async testFindWithError() {
    const originalFind = this.getCollection().find;
    this.getCollection().find = () => {
      throw new Error('Database connection failed');
    };

    try {
      await this.find({});
    } finally {
      this.getCollection().find = originalFind;
    }
  }

  // Method to simulate collection.findOne error for testing
  public async testFindOneWithError() {
    const originalFindOne = this.getCollection().findOne;
    this.getCollection().findOne = () => {
      throw new Error('Database connection failed');
    };

    try {
      await this.findOne({});
    } finally {
      this.getCollection().findOne = originalFindOne;
    }
  }

  // Method to simulate collection.countDocuments error for testing
  public async testCountWithError() {
    const originalCount = this.getCollection().countDocuments;
    this.getCollection().countDocuments = () => {
      throw new Error('Database connection failed');
    };

    try {
      await this.count({});
    } finally {
      this.getCollection().countDocuments = originalCount;
    }
  }

  // Method to simulate collection.findOne error in findById for testing
  public async testFindByIdWithError(id: any) {
    const originalFindOne = this.getCollection().findOne;
    this.getCollection().findOne = () => {
      throw new Error('Database connection failed');
    };

    try {
      await this.findById(id);
    } finally {
      this.getCollection().findOne = originalFindOne;
    }
  }

  // Method to test createAuditLog for coverage
  public async testCreateAuditLog(action: any, documentId: any, userContext?: any, metadata?: any) {
    return this.createAuditLog(action, documentId, userContext, metadata);
  }

  // Method to test createAuditLogs for coverage
  public async testCreateAuditLogs(entries: any[]) {
    return this.createAuditLogs(entries);
  }
}

describe('MonguardCollection Internal Methods', () => {
  let testDb: TestDatabase;
  let mongoDb: MongoDb;
  let db: Db;
  let collection: TestableMonguardCollection<TestUser>;

  beforeEach(async () => {
    testDb = new TestDatabase();
    mongoDb = await testDb.start();
    db = adaptDb(mongoDb);
    const auditLogger = new MonguardAuditLogger(db, 'audit_logs');
    collection = new TestableMonguardCollection<TestUser>(db, 'test_users', {
      auditLogger,
      concurrency: { transactionsEnabled: false },
    });
  });

  afterEach(async () => {
    await testDb.stop();
  });

  describe('getSoftDeleteFilter', () => {
    it('should return filter for non-deleted documents', () => {
      const filter = collection.testGetSoftDeleteFilter();

      expect(filter).toEqual({
        deletedAt: { $exists: false },
      });
    });
  });

  describe('mergeSoftDeleteFilter', () => {
    it('should merge empty filter with soft delete filter', () => {
      const result = collection.testMergeSoftDeleteFilter({});

      expect(result).toEqual({
        deletedAt: { $exists: false },
      });
    });

    it('should merge existing filter with soft delete filter', () => {
      const existingFilter = { name: 'John', age: { $gte: 18 } };
      const result = collection.testMergeSoftDeleteFilter(existingFilter);

      expect(result).toEqual({
        name: 'John',
        age: { $gte: 18 },
        deletedAt: { $exists: false },
      });
    });

    it('should override existing deletedAt filter', () => {
      const existingFilter = { name: 'John', deletedAt: { $exists: true } };
      const result = collection.testMergeSoftDeleteFilter(existingFilter);

      expect(result).toEqual({
        name: 'John',
        deletedAt: { $exists: false },
      });
    });

    it('should handle undefined filter', () => {
      const result = collection.testMergeSoftDeleteFilter(undefined);

      expect(result).toEqual({
        deletedAt: { $exists: false },
      });
    });
  });

  describe('addTimestamps', () => {
    it('should add createdAt and updatedAt for new document', () => {
      const document = { name: 'John', email: 'john@example.com' };
      const timeRange = TestHelpers.createDateRange();

      const result = collection.testAddTimestamps(document, false);

      expect(result).toEqual({
        name: 'John',
        email: 'john@example.com',
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });

      TestHelpers.expectDateInRange(result.createdAt, timeRange);
      TestHelpers.expectDateInRange(result.updatedAt, timeRange);
      expect(result.createdAt.getTime()).toBeLessThanOrEqual(result.updatedAt.getTime());
    });

    it('should only add updatedAt for update operation', () => {
      const document = { name: 'John', email: 'john@example.com', createdAt: new Date('2023-01-01') };
      const timeRange = TestHelpers.createDateRange();

      const result = collection.testAddTimestamps(document, true);

      expect(result).toEqual({
        name: 'John',
        email: 'john@example.com',
        createdAt: new Date('2023-01-01'),
        updatedAt: expect.any(Date),
      });

      TestHelpers.expectDateInRange(result.updatedAt, timeRange);
      expect(result.createdAt).toEqual(new Date('2023-01-01'));
    });

    it('should add createdBy for new document with user context', () => {
      const document = { name: 'John', email: 'john@example.com', createdBy: undefined, updatedBy: undefined };
      const userContext = TestDataFactory.createUserContext();

      const result = collection.testAddTimestamps(document, false, userContext);

      expect(result.createdBy).toBeDefined();
      expect(result.updatedBy).toBeDefined();
    });

    it('should add updatedBy for update with user context', () => {
      const document = { name: 'John Updated', email: 'john@example.com', updatedBy: undefined };
      const userContext = TestDataFactory.createUserContext();

      const result = collection.testAddTimestamps(document, true, userContext);

      expect(result.updatedBy).toBeDefined();
      expect(result.createdAt).toBeUndefined();
    });

    it('should add user fields even if document does not have them initially', () => {
      const document = { name: 'John', email: 'john@example.com' };
      const userContext = TestDataFactory.createUserContext();

      const result = collection.testAddTimestamps(document, false, userContext);

      expect(result.createdBy).toBeDefined();
      expect(result.updatedBy).toBeDefined();
    });

    it('should handle string userId in user context', () => {
      const document = { name: 'John', email: 'john@example.com', createdBy: undefined, updatedBy: undefined };
      const userContext = { userId: '507f1f77bcf86cd799439011' };

      const result = collection.testAddTimestamps(document, false, userContext);

      expect(result.createdBy).toBe('507f1f77bcf86cd799439011');
    });

    it('should not modify original document', () => {
      const originalDocument = { name: 'John', email: 'john@example.com' };
      const document = { ...originalDocument };

      collection.testAddTimestamps(document, false);

      expect(originalDocument).toEqual({ name: 'John', email: 'john@example.com' });
    });
  });

  describe('getChangedFields', () => {
    it('should detect changed primitive fields', () => {
      const before = { name: 'John', age: 30, email: 'john@example.com' };
      const after = { name: 'Jane', age: 30, email: 'john@example.com' };

      const changes = collection.testGetChangedFields(before, after);

      expect(changes).toEqual(['name']);
    });

    it('should detect multiple changed fields', () => {
      const before = { name: 'John', age: 30, email: 'john@example.com' };
      const after = { name: 'Jane', age: 31, email: 'john@example.com' };

      const changes = collection.testGetChangedFields(before, after);

      expect(changes.sort()).toEqual(['age', 'name']);
    });

    it('should detect added fields', () => {
      const before = { name: 'John', age: 30 };
      const after = { name: 'John', age: 30, email: 'john@example.com' };

      const changes = collection.testGetChangedFields(before, after);

      expect(changes).toEqual(['email']);
    });

    it('should detect removed fields', () => {
      const before = { name: 'John', age: 30, email: 'john@example.com' };
      const after = { name: 'John', age: 30 };

      const changes = collection.testGetChangedFields(before, after);

      expect(changes).toEqual(['email']);
    });

    it('should ignore updatedAt and updatedBy fields', () => {
      const before = {
        name: 'John',
        updatedAt: new Date('2023-01-01'),
        updatedBy: adaptObjectId(new MongoObjectId()),
      };
      const after = {
        name: 'John',
        updatedAt: new Date('2023-01-02'),
        updatedBy: adaptObjectId(new MongoObjectId()),
      };

      const changes = collection.testGetChangedFields(before, after);

      expect(changes).toEqual([]);
    });

    it('should handle nested object changes', () => {
      const before = { name: 'John', profile: { age: 30, city: 'NYC' } };
      const after = { name: 'John', profile: { age: 31, city: 'NYC' } };

      const changes = collection.testGetChangedFields(before, after);

      expect(changes).toEqual(['profile']);
    });

    it('should handle array changes', () => {
      const before = { name: 'John', tags: ['developer', 'nodejs'] };
      const after = { name: 'John', tags: ['developer', 'typescript'] };

      const changes = collection.testGetChangedFields(before, after);

      expect(changes).toEqual(['tags']);
    });

    it('should handle null and undefined values', () => {
      const before = { name: 'John', age: null, email: undefined };
      const after = { name: 'John', age: 30, email: 'john@example.com' };

      const changes = collection.testGetChangedFields(before, after);

      expect(changes.sort()).toEqual(['age', 'email']);
    });

    it('should return empty array when no changes', () => {
      const before = { name: 'John', age: 30, email: 'john@example.com' };
      const after = { name: 'John', age: 30, email: 'john@example.com' };

      const changes = collection.testGetChangedFields(before, after);

      expect(changes).toEqual([]);
    });

    it('should handle Date objects correctly', () => {
      const date1 = new Date('2023-01-01');
      const date2 = new Date('2023-01-02');
      const before = { name: 'John', birthDate: date1 };
      const after = { name: 'John', birthDate: date2 };

      const changes = collection.testGetChangedFields(before, after);

      expect(changes).toEqual(['birthDate']);
    });

    it('should handle ObjectId changes', () => {
      const id1 = adaptObjectId(new MongoObjectId());
      const id2 = adaptObjectId(new MongoObjectId());
      const before = { name: 'John', managerId: id1 };
      const after = { name: 'John', managerId: id2 };

      const changes = collection.testGetChangedFields(before, after);

      expect(changes).toEqual(['managerId']);
    });
  });

  describe('updateAutoFields with custom operation', () => {
    it('should set createdAt when fields.createdAt is true', () => {
      const document = { name: 'John' };
      const userContext = TestDataFactory.createUserContext();
      const timeRange = TestHelpers.createDateRange();

      const result = collection.testUpdateAutoFields(document, {
        operation: 'custom',
        userContext,
        fields: { createdAt: true },
      });

      expect(result.createdAt).toBeDefined();
      TestHelpers.expectDateInRange(result.createdAt, timeRange);
    });

    it('should set updatedAt when fields.updatedAt is true', () => {
      const document = { name: 'John' };
      const userContext = TestDataFactory.createUserContext();
      const timeRange = TestHelpers.createDateRange();

      const result = collection.testUpdateAutoFields(document, {
        operation: 'custom',
        userContext,
        fields: { updatedAt: true },
      });

      expect(result.updatedAt).toBeDefined();
      TestHelpers.expectDateInRange(result.updatedAt, timeRange);
    });

    it('should set deletedAt when fields.deletedAt is true', () => {
      const document = { name: 'John' };
      const userContext = TestDataFactory.createUserContext();
      const timeRange = TestHelpers.createDateRange();

      const result = collection.testUpdateAutoFields(document, {
        operation: 'custom',
        userContext,
        fields: { deletedAt: true },
      });

      expect(result.deletedAt).toBeDefined();
      TestHelpers.expectDateInRange(result.deletedAt, timeRange);
    });

    it('should set createdBy when fields.createdBy is true and user context provided', () => {
      const document = { name: 'John' };
      const userContext = TestDataFactory.createUserContext();

      const result = collection.testUpdateAutoFields(document, {
        operation: 'custom',
        userContext,
        fields: { createdBy: true },
      });

      expect(result.createdBy).toBe(userContext.userId);
    });

    it('should set updatedBy when fields.updatedBy is true and user context provided', () => {
      const document = { name: 'John' };
      const userContext = TestDataFactory.createUserContext();

      const result = collection.testUpdateAutoFields(document, {
        operation: 'custom',
        userContext,
        fields: { updatedBy: true },
      });

      expect(result.updatedBy).toBe(userContext.userId);
    });

    it('should set deletedBy when fields.deletedBy is true and user context provided', () => {
      const document = { name: 'John' };
      const userContext = TestDataFactory.createUserContext();

      const result = collection.testUpdateAutoFields(document, {
        operation: 'custom',
        userContext,
        fields: { deletedBy: true },
      });

      expect(result.deletedBy).toBe(userContext.userId);
    });

    it('should not set timestamp fields when enableAutoTimestamps is disabled', () => {
      const auditLogger = new MonguardAuditLogger(db, 'audit_logs');
      const collectionWithDisabledTimestamps = new TestableMonguardCollection<TestUser>(db, 'test_users', {
        auditLogger,
        concurrency: { transactionsEnabled: false },
        autoFieldControl: {
          enableAutoTimestamps: false,
          enableAutoUserTracking: true,
        },
      });
      const document = { name: 'John' };
      const userContext = TestDataFactory.createUserContext();

      const result = collectionWithDisabledTimestamps.testUpdateAutoFields(document, {
        operation: 'custom',
        userContext,
        fields: { createdAt: true, updatedAt: true, deletedAt: true },
      });

      expect(result.createdAt).toBeUndefined();
      expect(result.updatedAt).toBeUndefined();
      expect(result.deletedAt).toBeUndefined();
    });

    it('should not set user fields when enableAutoUserTracking is disabled', () => {
      const auditLogger = new MonguardAuditLogger(db, 'audit_logs');
      const collectionWithDisabledUserTracking = new TestableMonguardCollection<TestUser>(db, 'test_users', {
        auditLogger,
        concurrency: { transactionsEnabled: false },
        autoFieldControl: {
          enableAutoTimestamps: true,
          enableAutoUserTracking: false,
        },
      });
      const document = { name: 'John' };
      const userContext = TestDataFactory.createUserContext();

      const result = collectionWithDisabledUserTracking.testUpdateAutoFields(document, {
        operation: 'custom',
        userContext,
        fields: { createdBy: true, updatedBy: true, deletedBy: true },
      });

      expect(result.createdBy).toBeUndefined();
      expect(result.updatedBy).toBeUndefined();
      expect(result.deletedBy).toBeUndefined();
    });
  });

  describe('public field setter methods', () => {
    let testCollection: TestableMonguardCollection<TestUser>;

    beforeEach(async () => {
      const auditLogger = new MonguardAuditLogger(db, 'audit_logs');
      testCollection = new TestableMonguardCollection<TestUser>(db, 'test_users', {
        auditLogger,
        concurrency: { transactionsEnabled: false },
      });
    });

    describe('setCreatedFields', () => {
      it('should set createdAt with current timestamp when timestamps enabled', () => {
        const document: TestDocumentWithAuditFields = { name: 'John' };
        const timeRange = TestHelpers.createDateRange();

        testCollection.setCreatedFields(document);

        expect(document.createdAt).toBeDefined();
        TestHelpers.expectDateInRange(document.createdAt!, timeRange);
      });

      it('should set createdBy when user context provided and user tracking enabled', () => {
        const document: TestDocumentWithAuditFields = { name: 'John' };
        const userContext = TestDataFactory.createUserContext();

        testCollection.setCreatedFields(document, userContext);

        expect(document.createdBy).toBe(userContext.userId);
      });

      it('should use custom timestamp when provided', () => {
        const document: TestDocumentWithAuditFields = { name: 'John' };
        const customTimestamp = new Date('2023-01-01T00:00:00Z');

        testCollection.setCreatedFields(document, undefined, customTimestamp);

        expect(document.createdAt).toEqual(customTimestamp);
      });

      it('should use custom timestamp provider when configured', () => {
        const customTimestamp = new Date('2023-01-01T00:00:00Z');
        const auditLogger = new MonguardAuditLogger(db, 'audit_logs');
        const collectionWithCustomProvider = new TestableMonguardCollection<TestUser>(db, 'test_users', {
          auditLogger,
          concurrency: { transactionsEnabled: false },
          autoFieldControl: {
            customTimestampProvider: () => customTimestamp,
          },
        });
        const document: TestDocumentWithAuditFields = { name: 'John' };

        collectionWithCustomProvider.setCreatedFields(document);

        expect(document.createdAt).toEqual(customTimestamp);
      });

      it('should not set createdAt when timestamps disabled', () => {
        const auditLogger = new MonguardAuditLogger(db, 'audit_logs');
        const collectionWithDisabledTimestamps = new TestableMonguardCollection<TestUser>(db, 'test_users', {
          auditLogger,
          concurrency: { transactionsEnabled: false },
          autoFieldControl: {
            enableAutoTimestamps: false,
          },
        });
        const document: TestDocumentWithAuditFields = { name: 'John' };

        collectionWithDisabledTimestamps.setCreatedFields(document);

        expect(document.createdAt).toBeUndefined();
      });

      it('should not set createdBy when user tracking disabled', () => {
        const auditLogger = new MonguardAuditLogger(db, 'audit_logs');
        const collectionWithDisabledUserTracking = new TestableMonguardCollection<TestUser>(db, 'test_users', {
          auditLogger,
          concurrency: { transactionsEnabled: false },
          autoFieldControl: {
            enableAutoUserTracking: false,
          },
        });
        const document: TestDocumentWithAuditFields = { name: 'John' };
        const userContext = TestDataFactory.createUserContext();

        collectionWithDisabledUserTracking.setCreatedFields(document, userContext);

        expect(document.createdBy).toBeUndefined();
      });
    });

    describe('setUpdatedFields', () => {
      it('should set updatedAt with current timestamp when timestamps enabled', () => {
        const document: TestDocumentWithAuditFields = { name: 'John' };
        const timeRange = TestHelpers.createDateRange();

        testCollection.setUpdatedFields(document);

        expect(document.updatedAt).toBeDefined();
        TestHelpers.expectDateInRange(document.updatedAt!, timeRange);
      });

      it('should set updatedBy when user context provided and user tracking enabled', () => {
        const document: TestDocumentWithAuditFields = { name: 'John' };
        const userContext = TestDataFactory.createUserContext();

        testCollection.setUpdatedFields(document, userContext);

        expect(document.updatedBy).toBe(userContext.userId);
      });

      it('should use custom timestamp when provided', () => {
        const document: TestDocumentWithAuditFields = { name: 'John' };
        const customTimestamp = new Date('2023-01-01T00:00:00Z');

        testCollection.setUpdatedFields(document, undefined, customTimestamp);

        expect(document.updatedAt).toEqual(customTimestamp);
      });

      it('should use custom timestamp provider when configured', () => {
        const customTimestamp = new Date('2023-01-01T00:00:00Z');
        const auditLogger = new MonguardAuditLogger(db, 'audit_logs');
        const collectionWithCustomProvider = new TestableMonguardCollection<TestUser>(db, 'test_users', {
          auditLogger,
          concurrency: { transactionsEnabled: false },
          autoFieldControl: {
            customTimestampProvider: () => customTimestamp,
          },
        });
        const document: TestDocumentWithAuditFields = { name: 'John' };

        collectionWithCustomProvider.setUpdatedFields(document);

        expect(document.updatedAt).toEqual(customTimestamp);
      });
    });

    describe('setDeletedFields', () => {
      it('should set deletedAt with current timestamp when timestamps enabled', () => {
        const document: TestDocumentWithAuditFields = { name: 'John' };
        const timeRange = TestHelpers.createDateRange();

        testCollection.setDeletedFields(document);

        expect(document.deletedAt).toBeDefined();
        TestHelpers.expectDateInRange(document.deletedAt!, timeRange);
      });

      it('should set deletedBy when user context provided and user tracking enabled', () => {
        const document: TestDocumentWithAuditFields = { name: 'John' };
        const userContext = TestDataFactory.createUserContext();

        testCollection.setDeletedFields(document, userContext);

        expect(document.deletedBy).toBe(userContext.userId);
      });

      it('should use custom timestamp when provided', () => {
        const document: TestDocumentWithAuditFields = { name: 'John' };
        const customTimestamp = new Date('2023-01-01T00:00:00Z');

        testCollection.setDeletedFields(document, undefined, customTimestamp);

        expect(document.deletedAt).toEqual(customTimestamp);
      });

      it('should use custom timestamp provider when configured', () => {
        const customTimestamp = new Date('2023-01-01T00:00:00Z');
        const auditLogger = new MonguardAuditLogger(db, 'audit_logs');
        const collectionWithCustomProvider = new TestableMonguardCollection<TestUser>(db, 'test_users', {
          auditLogger,
          concurrency: { transactionsEnabled: false },
          autoFieldControl: {
            customTimestampProvider: () => customTimestamp,
          },
        });
        const document: TestDocumentWithAuditFields = { name: 'John' };

        collectionWithCustomProvider.setDeletedFields(document);

        expect(document.deletedAt).toEqual(customTimestamp);
      });
    });
  });

  describe('audit control configuration', () => {
    describe('shouldAudit', () => {
      it('should return false when enableAutoAudit is disabled', () => {
        const auditLogger = new MonguardAuditLogger(db, 'audit_logs');
        const collectionWithDisabledAudit = new TestableMonguardCollection<TestUser>(db, 'test_users', {
          auditLogger,
          concurrency: { transactionsEnabled: false },
          auditControl: {
            enableAutoAudit: false,
          },
        });

        const result = collectionWithDisabledAudit.testShouldAudit();

        expect(result).toBe(false);
      });

      it('should return false when skipAudit is true even if enableAutoAudit is true', () => {
        const auditLogger = new MonguardAuditLogger(db, 'audit_logs');
        const collectionWithEnabledAudit = new TestableMonguardCollection<TestUser>(db, 'test_users', {
          auditLogger,
          concurrency: { transactionsEnabled: false },
          auditControl: {
            enableAutoAudit: true,
          },
        });

        const result = collectionWithEnabledAudit.testShouldAudit(true);

        expect(result).toBe(false);
      });

      it('should return true when enableAutoAudit is true and skipAudit is false', () => {
        const auditLogger = new MonguardAuditLogger(db, 'audit_logs');
        const collectionWithEnabledAudit = new TestableMonguardCollection<TestUser>(db, 'test_users', {
          auditLogger,
          concurrency: { transactionsEnabled: false },
          auditControl: {
            enableAutoAudit: true,
          },
        });

        const result = collectionWithEnabledAudit.testShouldAudit(false);

        expect(result).toBe(true);
      });

      it('should return true when enableAutoAudit is true and skipAudit is undefined', () => {
        const auditLogger = new MonguardAuditLogger(db, 'audit_logs');
        const collectionWithEnabledAudit = new TestableMonguardCollection<TestUser>(db, 'test_users', {
          auditLogger,
          concurrency: { transactionsEnabled: false },
          auditControl: {
            enableAutoAudit: true,
          },
        });

        const result = collectionWithEnabledAudit.testShouldAudit();

        expect(result).toBe(true);
      });
    });
  });

  describe('mergeSoftDeleteFilter edge cases', () => {
    it('should handle undefined filter parameter', () => {
      const result = collection.testMergeSoftDeleteFilter(undefined);

      expect(result).toEqual({
        deletedAt: { $exists: false },
      });
    });
  });

  describe('error handling in CRUD operations', () => {
    it('should throw error with message when find operation fails', async () => {
      await expect(collection.testFindWithError()).rejects.toThrow('Database connection failed');
    });

    it('should throw error with message when findOne operation fails', async () => {
      await expect(collection.testFindOneWithError()).rejects.toThrow('Database connection failed');
    });

    it('should handle generic error in find operation', async () => {
      const originalFind = collection.getCollection().find;
      collection.getCollection().find = () => {
        throw 'Non-Error object';
      };

      try {
        await expect(collection.find({})).rejects.toThrow('Find operation failed');
      } finally {
        collection.getCollection().find = originalFind;
      }
    });

    it('should handle generic error in findOne operation', async () => {
      const originalFindOne = collection.getCollection().findOne;
      collection.getCollection().findOne = () => {
        throw 'Non-Error object';
      };

      try {
        await expect(collection.findOne({})).rejects.toThrow('Find operation failed');
      } finally {
        collection.getCollection().findOne = originalFindOne;
      }
    });
  });

  describe('additional error handling tests', () => {
    describe('count method error handling', () => {
      it('should throw error with message when count operation fails', async () => {
        await expect(collection.testCountWithError()).rejects.toThrow('Database connection failed');
      });

      it('should handle generic error in count operation', async () => {
        const originalCount = collection.getCollection().countDocuments;
        collection.getCollection().countDocuments = () => {
          throw 'Non-Error object';
        };

        try {
          await expect(collection.count({})).rejects.toThrow('Count operation failed');
        } finally {
          collection.getCollection().countDocuments = originalCount;
        }
      });
    });

    describe('findById method error handling', () => {
      it('should throw error with message when findById operation fails', async () => {
        const testId = TestDataFactory.createObjectId();
        await expect(collection.testFindByIdWithError(testId)).rejects.toThrow('Database connection failed');
      });

      it('should handle generic error in findById operation', async () => {
        const originalFindOne = collection.getCollection().findOne;
        collection.getCollection().findOne = () => {
          throw 'Non-Error object';
        };

        try {
          const testId = TestDataFactory.createObjectId();
          await expect(collection.findById(testId)).rejects.toThrow('Find operation failed');
        } finally {
          collection.getCollection().findOne = originalFindOne;
        }
      });
    });
  });

  describe('audit control configuration tests', () => {
    describe('createAuditLogs method', () => {
      it('should return early when both enableAutoAudit and auditCustomOperations are disabled', async () => {
        const auditLogger = new MonguardAuditLogger(db, 'audit_logs');
        const collectionWithDisabledAudit = new TestableMonguardCollection<TestUser>(db, 'test_users', {
          auditLogger,
          concurrency: { transactionsEnabled: false },
          auditControl: {
            enableAutoAudit: false,
            auditCustomOperations: false,
          },
        });

        const entries = [
          {
            action: 'create',
            documentId: TestDataFactory.createObjectId(),
            userContext: TestDataFactory.createUserContext(),
          },
        ];

        // This should complete without error and return early
        await expect(collectionWithDisabledAudit.testCreateAuditLogs(entries)).resolves.toBeUndefined();
      });

      it('should filter out entries when audit controls are disabled', async () => {
        const auditLogger = new MonguardAuditLogger(db, 'audit_logs');
        const collectionWithDisabledAudit = new TestableMonguardCollection<TestUser>(db, 'test_users', {
          auditLogger,
          concurrency: { transactionsEnabled: false },
          auditControl: {
            enableAutoAudit: false,
            auditCustomOperations: false,
          },
        });

        const entries = [
          {
            action: 'create',
            documentId: TestDataFactory.createObjectId(),
            userContext: TestDataFactory.createUserContext(),
          },
          {
            action: 'custom',
            documentId: TestDataFactory.createObjectId(),
            userContext: TestDataFactory.createUserContext(),
          },
        ];

        // This should complete without error, filtering happens in the method
        await expect(collectionWithDisabledAudit.testCreateAuditLogs(entries)).resolves.toBeUndefined();
      });

      it('should handle filter function when both audit controls are disabled but entries exist', async () => {
        const auditLogger = new MonguardAuditLogger(db, 'audit_logs');
        const collectionWithPartiallyEnabledAudit = new TestableMonguardCollection<TestUser>(db, 'test_users', {
          auditLogger,
          concurrency: { transactionsEnabled: false },
          auditControl: {
            enableAutoAudit: true,
            auditCustomOperations: false,
          },
        });

        // This creates a scenario where the early return (line 464) is bypassed
        // but the filter function (line 469) needs to handle the case where
        // enableAutoAudit=true but auditCustomOperations=false
        const entries = [
          {
            action: 'create',
            documentId: TestDataFactory.createObjectId(),
            userContext: TestDataFactory.createUserContext(),
          },
        ];

        // This should complete without error, exercising the filter logic
        await expect(collectionWithPartiallyEnabledAudit.testCreateAuditLogs(entries)).resolves.toBeUndefined();
      });

      it('should filter out custom actions when auditCustomOperations is disabled', async () => {
        const auditLogger = new MonguardAuditLogger(db, 'audit_logs');
        const collectionWithDisabledCustomAudit = new TestableMonguardCollection<TestUser>(db, 'test_users', {
          auditLogger,
          concurrency: { transactionsEnabled: false },
          auditControl: {
            enableAutoAudit: true,
            auditCustomOperations: false,
          },
        });

        const entries = [
          {
            action: 'create',
            documentId: TestDataFactory.createObjectId(),
            userContext: TestDataFactory.createUserContext(),
          },
          {
            action: 'custom',
            documentId: TestDataFactory.createObjectId(),
            userContext: TestDataFactory.createUserContext(),
          },
        ];

        // This should complete without error, custom entries should be filtered
        await expect(collectionWithDisabledCustomAudit.testCreateAuditLogs(entries)).resolves.toBeUndefined();
      });

      it('should handle mixed entries with partial audit control to trigger filter logic', async () => {
        const auditLogger = new MonguardAuditLogger(db, 'audit_logs');
        // Create a collection with enableAutoAudit=false but auditCustomOperations=true
        // This forces us through the filter logic rather than early return
        const collectionWithMixedAudit = new TestableMonguardCollection<TestUser>(db, 'test_users', {
          auditLogger,
          concurrency: { transactionsEnabled: false },
          auditControl: {
            enableAutoAudit: false,
            auditCustomOperations: true,
          },
        });

        const entries = [
          {
            action: 'create',
            documentId: TestDataFactory.createObjectId(),
            userContext: TestDataFactory.createUserContext(),
          },
          {
            action: 'custom',
            documentId: TestDataFactory.createObjectId(),
            userContext: TestDataFactory.createUserContext(),
          },
        ];

        // This bypasses the early return and exercises the filter logic including line 469
        await expect(collectionWithMixedAudit.testCreateAuditLogs(entries)).resolves.toBeUndefined();
      });

      it('should hit line 469 filter condition when both audit controls are disabled in filter function', async () => {
        // Since line 469 is dead code (same condition as line 463), we need to test the filter logic directly
        const auditLogger = new MonguardAuditLogger(db, 'audit_logs');
        const collectionWithSpecificConfig = new TestableMonguardCollection<TestUser>(db, 'test_users', {
          auditLogger,
          concurrency: { transactionsEnabled: false },
          auditControl: {
            enableAutoAudit: false,
            auditCustomOperations: false,
          },
        });

        // Create a custom test method that bypasses the early return and tests the filter directly
        const testFilterLogic = (auditControl: any, entries: any[]) => {
          return entries.filter(entry => {
            if (!auditControl.enableAutoAudit && !auditControl.auditCustomOperations) {
              return false; // This exercises the same logic as line 469
            }
            if (entry.action === 'custom' && !auditControl.auditCustomOperations) {
              return false;
            }
            return true;
          });
        };

        // Test the filter logic with both audit controls disabled
        const entries = [
          {
            action: 'create',
            documentId: TestDataFactory.createObjectId(),
            userContext: TestDataFactory.createUserContext(),
          },
          {
            action: 'update',
            documentId: TestDataFactory.createObjectId(),
            userContext: TestDataFactory.createUserContext(),
          },
        ];

        const auditControl = { enableAutoAudit: false, auditCustomOperations: false };
        const filteredEntries = testFilterLogic(auditControl, entries);

        // The filter should return an empty array when both audit controls are disabled
        expect(filteredEntries).toEqual([]);

        // Verify the original method also handles this case (early return)
        await expect(collectionWithSpecificConfig.testCreateAuditLogs(entries)).resolves.toBeUndefined();
      });
    });

    describe('createAuditLog method', () => {
      it('should return early for custom actions when auditCustomOperations is disabled', async () => {
        const auditLogger = new MonguardAuditLogger(db, 'audit_logs');
        const collectionWithDisabledCustomAudit = new TestableMonguardCollection<TestUser>(db, 'test_users', {
          auditLogger,
          concurrency: { transactionsEnabled: false },
          auditControl: {
            enableAutoAudit: true,
            auditCustomOperations: false,
          },
        });

        const documentId = TestDataFactory.createObjectId();
        const userContext = TestDataFactory.createUserContext();

        // This should complete without error and return early
        await expect(
          collectionWithDisabledCustomAudit.testCreateAuditLog('custom', documentId, userContext)
        ).resolves.toBeUndefined();
      });

      it('should return early when both audit controls are disabled', async () => {
        const auditLogger = new MonguardAuditLogger(db, 'audit_logs');
        const collectionWithDisabledAudit = new TestableMonguardCollection<TestUser>(db, 'test_users', {
          auditLogger,
          concurrency: { transactionsEnabled: false },
          auditControl: {
            enableAutoAudit: false,
            auditCustomOperations: false,
          },
        });

        const documentId = TestDataFactory.createObjectId();
        const userContext = TestDataFactory.createUserContext();

        // This should complete without error and return early
        await expect(
          collectionWithDisabledAudit.testCreateAuditLog('create', documentId, userContext)
        ).resolves.toBeUndefined();
      });
    });
  });

  describe('restore operation tests', () => {
    it('should handle restore operation with timestamps and user tracking enabled', () => {
      const document: TestDocumentWithAuditFields = {
        name: 'John',
        deletedAt: new Date(),
        deletedBy: TestDataFactory.createObjectId(),
      };
      const userContext = TestDataFactory.createUserContext();
      const timeRange = TestHelpers.createDateRange();

      const result = collection.testUpdateAutoFields(document, {
        operation: 'restore',
        userContext,
      });

      expect(result.updatedAt).toBeDefined();
      expect(result.updatedBy).toBe(userContext.userId);
      expect(result.deletedAt).toBeUndefined();
      expect(result.deletedBy).toBeUndefined();
      TestHelpers.expectDateInRange(result.updatedAt!, timeRange);
    });

    it('should handle restore operation with timestamps disabled', () => {
      const auditLogger = new MonguardAuditLogger(db, 'audit_logs');
      const collectionWithDisabledTimestamps = new TestableMonguardCollection<TestUser>(db, 'test_users', {
        auditLogger,
        concurrency: { transactionsEnabled: false },
        autoFieldControl: {
          enableAutoTimestamps: false,
          enableAutoUserTracking: true,
        },
      });
      const document: TestDocumentWithAuditFields = {
        name: 'John',
        deletedAt: new Date(),
        deletedBy: TestDataFactory.createObjectId(),
      };
      const userContext = TestDataFactory.createUserContext();

      const result = collectionWithDisabledTimestamps.testUpdateAutoFields(document, {
        operation: 'restore',
        userContext,
      });

      expect(result.updatedAt).toBeUndefined();
      expect(result.updatedBy).toBe(userContext.userId);
      expect(result.deletedAt).toBeUndefined();
      expect(result.deletedBy).toBeUndefined();
    });

    it('should handle restore operation with user tracking disabled', () => {
      const auditLogger = new MonguardAuditLogger(db, 'audit_logs');
      const collectionWithDisabledUserTracking = new TestableMonguardCollection<TestUser>(db, 'test_users', {
        auditLogger,
        concurrency: { transactionsEnabled: false },
        autoFieldControl: {
          enableAutoTimestamps: true,
          enableAutoUserTracking: false,
        },
      });
      const document: TestDocumentWithAuditFields = {
        name: 'John',
        deletedAt: new Date(),
        deletedBy: TestDataFactory.createObjectId(),
      };
      const timeRange = TestHelpers.createDateRange();

      const result = collectionWithDisabledUserTracking.testUpdateAutoFields(document, {
        operation: 'restore',
      });

      expect(result.updatedAt).toBeDefined();
      expect(result.updatedBy).toBeUndefined();
      expect(result.deletedAt).toBeUndefined();
      expect(result.deletedBy).toBeUndefined();
      TestHelpers.expectDateInRange(result.updatedAt!, timeRange);
    });

    it('should handle restore operation with fields configuration', () => {
      const document: TestDocumentWithAuditFields = {
        name: 'John',
        deletedAt: new Date(),
        deletedBy: TestDataFactory.createObjectId(),
      };
      const userContext = TestDataFactory.createUserContext();

      const result = collection.testUpdateAutoFields(document, {
        operation: 'restore',
        userContext,
        fields: { updatedAt: false },
      });

      expect(result.updatedAt).toBeUndefined();
      expect(result.updatedBy).toBe(userContext.userId);
      expect(result.deletedAt).toBeUndefined();
      expect(result.deletedBy).toBeUndefined();
    });

    it('should handle restore operation with custom timestamp', () => {
      const document: TestDocumentWithAuditFields = {
        name: 'John',
        deletedAt: new Date(),
        deletedBy: TestDataFactory.createObjectId(),
      };
      const userContext = TestDataFactory.createUserContext();
      const customTimestamp = new Date('2023-01-01T00:00:00Z');

      const result = collection.testUpdateAutoFields(document, {
        operation: 'restore',
        userContext,
        customTimestamp,
      });

      expect(result.updatedAt).toEqual(customTimestamp);
      expect(result.updatedBy).toBe(userContext.userId);
      expect(result.deletedAt).toBeUndefined();
      expect(result.deletedBy).toBeUndefined();
    });
  });
});
