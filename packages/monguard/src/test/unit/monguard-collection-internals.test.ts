import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectId, Db } from 'mongodb';
import { MonguardCollection } from '../../monguard-collection';
import { TestDatabase } from '../setup';
import { TestDataFactory, TestUser } from '../factories';
import { TestHelpers } from '../test-utils';

// Test class to access private methods
class TestableMonguardCollection<T extends { _id: ObjectId; createdAt: Date; updatedAt: Date; deletedAt?: Date }> extends MonguardCollection<T> {
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
}

describe('MonguardCollection Internal Methods', () => {
  let testDb: TestDatabase;
  let db: Db;
  let collection: TestableMonguardCollection<TestUser>;

  beforeEach(async () => {
    testDb = new TestDatabase();
    db = await testDb.start();
    collection = new TestableMonguardCollection<TestUser>(db, 'test_users', {
      auditCollectionName: 'audit_logs',
      concurrency: { transactionsEnabled: false }
    });
  });

  afterEach(async () => {
    await testDb.stop();
  });

  describe('getSoftDeleteFilter', () => {
    it('should return filter for non-deleted documents', () => {
      const filter = collection.testGetSoftDeleteFilter();
      
      expect(filter).toEqual({
        deletedAt: { $exists: false }
      });
    });
  });

  describe('mergeSoftDeleteFilter', () => {
    it('should merge empty filter with soft delete filter', () => {
      const result = collection.testMergeSoftDeleteFilter({});
      
      expect(result).toEqual({
        deletedAt: { $exists: false }
      });
    });

    it('should merge existing filter with soft delete filter', () => {
      const existingFilter = { name: 'John', age: { $gte: 18 } };
      const result = collection.testMergeSoftDeleteFilter(existingFilter);
      
      expect(result).toEqual({
        name: 'John',
        age: { $gte: 18 },
        deletedAt: { $exists: false }
      });
    });

    it('should override existing deletedAt filter', () => {
      const existingFilter = { name: 'John', deletedAt: { $exists: true } };
      const result = collection.testMergeSoftDeleteFilter(existingFilter);
      
      expect(result).toEqual({
        name: 'John',
        deletedAt: { $exists: false }
      });
    });

    it('should handle undefined filter', () => {
      const result = collection.testMergeSoftDeleteFilter(undefined);
      
      expect(result).toEqual({
        deletedAt: { $exists: false }
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
        updatedAt: expect.any(Date)
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
        updatedAt: expect.any(Date)
      });
      
      TestHelpers.expectDateInRange(result.updatedAt, timeRange);
      expect(result.createdAt).toEqual(new Date('2023-01-01'));
    });

    it('should add createdBy for new document with user context', () => {
      const document = { name: 'John', email: 'john@example.com', createdBy: undefined, updatedBy: undefined };
      const userContext = TestDataFactory.createUserContext();
      
      const result = collection.testAddTimestamps(document, false, userContext);
      
      expect(result.createdBy).toEqual(expect.any(ObjectId));
      expect(result.updatedBy).toEqual(expect.any(ObjectId));
    });

    it('should add updatedBy for update with user context', () => {
      const document = { name: 'John Updated', email: 'john@example.com', updatedBy: undefined };
      const userContext = TestDataFactory.createUserContext();
      
      const result = collection.testAddTimestamps(document, true, userContext);
      
      expect(result.updatedBy).toEqual(expect.any(ObjectId));
      expect(result.createdAt).toBeUndefined();
    });

    it('should not add user fields if document does not have them', () => {
      const document = { name: 'John', email: 'john@example.com' };
      const userContext = TestDataFactory.createUserContext();
      
      const result = collection.testAddTimestamps(document, false, userContext);
      
      expect(result.createdBy).toBeUndefined();
      expect(result.updatedBy).toBeUndefined();
    });

    it('should handle string userId in user context', () => {
      const document = { name: 'John', email: 'john@example.com', createdBy: undefined, updatedBy: undefined };
      const userContext = { userId: '507f1f77bcf86cd799439011' };
      
      const result = collection.testAddTimestamps(document, false, userContext);
      
      expect(result.createdBy).toBeInstanceOf(ObjectId);
      expect(result.createdBy.toString()).toBe('507f1f77bcf86cd799439011');
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
        updatedBy: new ObjectId() 
      };
      const after = { 
        name: 'John', 
        updatedAt: new Date('2023-01-02'), 
        updatedBy: new ObjectId() 
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
      const id1 = new ObjectId();
      const id2 = new ObjectId();
      const before = { name: 'John', managerId: id1 };
      const after = { name: 'John', managerId: id2 };
      
      const changes = collection.testGetChangedFields(before, after);
      
      expect(changes).toEqual(['managerId']);
    });
  });
});