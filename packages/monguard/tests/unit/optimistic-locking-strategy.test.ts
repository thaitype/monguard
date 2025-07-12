import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectId as MongoObjectId, Db as MongoDb } from 'mongodb';
import { OptimisticLockingStrategy } from '../../src/strategies/optimistic-locking-strategy';
import { TestDatabase } from '../setup';
import { TestDataFactory, TestUser } from '../factories';
import { adaptDb, adaptObjectId } from '../mongodb-adapter';
import { MonguardAuditLogger, NoOpAuditLogger, ConsoleLogger } from '../../src/audit-logger';
import type { Db, Collection, ObjectId } from '../../src/mongodb-types';
import type { OperationStrategyContext } from '../../src/strategies/operation-strategy';
import type { BaseDocument } from '../../src/types';

// Test class to access private methods for line coverage
class TestableOptimisticLockingStrategy<T extends BaseDocument, TRefId = any> extends OptimisticLockingStrategy<
  T,
  TRefId
> {
  public async testRetryWithBackoff<R>(operation: () => Promise<R>, attempts?: number): Promise<R> {
    return (this as any).retryWithBackoff(operation, attempts);
  }
}

describe('OptimisticLockingStrategy', () => {
  let testDb: TestDatabase;
  let mongoDb: MongoDb;
  let db: Db;
  let collection: Collection<TestUser>;
  let strategy: TestableOptimisticLockingStrategy<TestUser>;
  let auditLogger: MonguardAuditLogger;

  beforeEach(async () => {
    testDb = new TestDatabase();
    mongoDb = await testDb.start();
    db = adaptDb(mongoDb);
    collection = db.collection<TestUser>('test_users') as Collection<TestUser>;
    auditLogger = new MonguardAuditLogger(db, 'audit_logs');

    const context: OperationStrategyContext<TestUser> = {
      collection,
      auditLogger,
      logger: ConsoleLogger,
      collectionName: 'test_users',
      config: { transactionsEnabled: false, retryAttempts: 3, retryDelayMs: 10 },
      auditControl: { enableAutoAudit: true },
      addTimestamps: (doc, isUpdate, userContext) => ({
        ...doc,
        ...(isUpdate ? { updatedAt: new Date() } : { createdAt: new Date(), updatedAt: new Date() }),
        ...(userContext && {
          ...(isUpdate
            ? { updatedBy: userContext.userId }
            : { createdBy: userContext.userId, updatedBy: userContext.userId }),
        }),
      }),
      mergeSoftDeleteFilter: filter => ({ ...filter, deletedAt: { $exists: false } }),
      getChangedFields: (before, after) => Object.keys({ ...before, ...after }),
      shouldAudit: skipAudit => !skipAudit,
    };

    strategy = new TestableOptimisticLockingStrategy(context);
  });

  afterEach(async () => {
    await testDb.stop();
  });

  describe('retry logic error handling', () => {
    it('should throw lastError when all retry attempts are exhausted (line 105)', async () => {
      // Test the retryWithBackoff method directly to ensure line 105 is hit
      let attemptCount = 0;
      const mockOperation = vi.fn().mockImplementation(() => {
        attemptCount++;
        const error = new Error('version conflict detected'); // lowercase 'version' to match retry pattern
        throw error;
      });

      // Use the expect/rejects pattern correctly to ensure the error is thrown
      await expect(strategy.testRetryWithBackoff(mockOperation, 2)).rejects.toThrow('version conflict detected');
      expect(attemptCount).toBe(2); // Should attempt exactly 2 times
      expect(mockOperation).toHaveBeenCalledTimes(2);
    });

    it('should throw error immediately for non-version conflicts', async () => {
      const mockError = new Error('Database connection lost');

      const mockOperation = vi.fn().mockRejectedValue(mockError);

      await expect(strategy.testRetryWithBackoff(mockOperation, 3)).rejects.toThrow('Database connection lost');
      expect(mockOperation).toHaveBeenCalledTimes(1); // Should not retry for non-version errors
    });
  });

  describe('audit error handling', () => {
    it('should log audit error for create operation without failing main operation (line 141)', async () => {
      const mockLogger = { warn: vi.fn(), error: vi.fn() };

      // Mock audit logger to throw error
      const mockAuditLogger = {
        ...auditLogger,
        logOperation: vi.fn().mockRejectedValue(new Error('Audit logging failed')),
        isEnabled: () => true,
        getAuditCollection: () => null,
        getAuditLogs: vi.fn().mockResolvedValue([]),
      };

      const contextWithFailingAudit: OperationStrategyContext<TestUser> = {
        collection,
        auditLogger: mockAuditLogger,
        logger: mockLogger,
        collectionName: 'test_users',
        config: { transactionsEnabled: false },
        auditControl: { enableAutoAudit: true },
        addTimestamps: doc => ({ ...doc, createdAt: new Date(), updatedAt: new Date() }),
        mergeSoftDeleteFilter: filter => filter,
        getChangedFields: () => [],
        shouldAudit: () => true,
      };

      const strategyWithFailingAudit = new OptimisticLockingStrategy(contextWithFailingAudit);

      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      // Create operation should succeed despite audit failure
      const result = await strategyWithFailingAudit.create(userData, { userContext });

      expect(result).toBeDefined();
      expect(result._id).toBeDefined();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to create audit log for create operation:',
        expect.any(Error)
      );
    });

    it('should log audit error for update operation without failing main operation (line 243)', async () => {
      const mockLogger = { warn: vi.fn(), error: vi.fn() };

      // First create a document
      const userData = TestDataFactory.createUser();
      const createdDoc = await strategy.create(userData);

      // Mock audit logger to throw error for update operations
      const mockAuditLogger = {
        ...auditLogger,
        logOperation: vi.fn().mockRejectedValue(new Error('Update audit logging failed')),
        isEnabled: () => true,
        getAuditCollection: () => null,
        getAuditLogs: vi.fn().mockResolvedValue([]),
      };

      const contextWithFailingAudit: OperationStrategyContext<TestUser> = {
        collection,
        auditLogger: mockAuditLogger,
        logger: mockLogger,
        collectionName: 'test_users',
        config: { transactionsEnabled: false },
        auditControl: { enableAutoAudit: true },
        addTimestamps: (doc, isUpdate) => ({ ...doc, updatedAt: new Date() }),
        mergeSoftDeleteFilter: filter => filter,
        getChangedFields: () => ['name'],
        shouldAudit: () => true,
      };

      const strategyWithFailingAudit = new OptimisticLockingStrategy(contextWithFailingAudit);

      // Update operation should succeed despite audit failure
      const result = await strategyWithFailingAudit.updateById(
        createdDoc._id,
        { $set: { name: 'Updated Name' } },
        { userContext: TestDataFactory.createUserContext() }
      );

      expect(result.modifiedCount).toBeGreaterThan(0);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to create audit log for update operation:',
        expect.any(Error)
      );
    });

    it('should log audit error for hard delete operation without failing main operation (line 310)', async () => {
      const mockLogger = { warn: vi.fn(), error: vi.fn() };

      // First create a document
      const userData = TestDataFactory.createUser();
      const createdDoc = await strategy.create(userData);

      // Mock audit logger to throw error for delete operations
      const mockAuditLogger = {
        ...auditLogger,
        logOperation: vi.fn().mockRejectedValue(new Error('Delete audit logging failed')),
        isEnabled: () => true,
        getAuditCollection: () => null,
        getAuditLogs: vi.fn().mockResolvedValue([]),
      };

      const contextWithFailingAudit: OperationStrategyContext<TestUser> = {
        collection,
        auditLogger: mockAuditLogger,
        logger: mockLogger,
        collectionName: 'test_users',
        config: { transactionsEnabled: false },
        auditControl: { enableAutoAudit: true },
        addTimestamps: doc => doc,
        mergeSoftDeleteFilter: filter => filter,
        getChangedFields: () => [],
        shouldAudit: () => true,
      };

      const strategyWithFailingAudit = new OptimisticLockingStrategy(contextWithFailingAudit);

      // Hard delete operation should succeed despite audit failure
      const result = await strategyWithFailingAudit.deleteById(createdDoc._id, {
        hardDelete: true,
        userContext: TestDataFactory.createUserContext(),
      });

      expect(result.deletedCount).toBeGreaterThan(0);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to create audit log for hard delete operation:',
        expect.any(Error)
      );
    });

    it('should log audit error for soft delete operation without failing main operation (line 373)', async () => {
      const mockLogger = { warn: vi.fn(), error: vi.fn() };

      // First create a document
      const userData = TestDataFactory.createUser();
      const createdDoc = await strategy.create(userData);

      // Mock audit logger to throw error for soft delete operations
      const mockAuditLogger = {
        ...auditLogger,
        logOperation: vi.fn().mockRejectedValue(new Error('Soft delete audit logging failed')),
        isEnabled: () => true,
        getAuditCollection: () => null,
        getAuditLogs: vi.fn().mockResolvedValue([]),
      };

      const contextWithFailingAudit: OperationStrategyContext<TestUser> = {
        collection,
        auditLogger: mockAuditLogger,
        logger: mockLogger,
        collectionName: 'test_users',
        config: { transactionsEnabled: false },
        auditControl: { enableAutoAudit: true },
        addTimestamps: doc => ({ ...doc, updatedAt: new Date() }),
        mergeSoftDeleteFilter: filter => filter,
        getChangedFields: () => [],
        shouldAudit: () => true,
      };

      const strategyWithFailingAudit = new OptimisticLockingStrategy(contextWithFailingAudit);

      // Soft delete operation should succeed despite audit failure
      const result = await strategyWithFailingAudit.deleteById(createdDoc._id, {
        hardDelete: false,
        userContext: TestDataFactory.createUserContext(),
      });

      expect(result.modifiedCount).toBeGreaterThan(0);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to create audit log for soft delete operation:',
        expect.any(Error)
      );
    });
  });

  describe('version conflict scenarios', () => {
    it('should retry on version conflicts until success', async () => {
      let attemptCount = 0;
      const mockOperation = vi.fn().mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 3) {
          // Simulate version conflict for first 2 attempts
          const error = new Error('version conflict detected');
          throw error;
        }
        // Succeed on third attempt
        return { success: true };
      });

      const result = await strategy.testRetryWithBackoff(mockOperation, 5);

      expect(result).toEqual({ success: true });
      expect(attemptCount).toBe(3); // Should have tried 3 times
    });
  });

  describe('documents without __v field handling', () => {
    it('should handle update operations on documents without __v field', async () => {
      // Create a document without __v field (simulating legacy data)
      const userData = TestDataFactory.createUser();
      const legacyDoc = {
        ...userData,
        _id: adaptObjectId(TestDataFactory.createObjectId()),
        createdAt: new Date(),
        updatedAt: new Date(),
        // Note: no __v field
      };

      // Insert directly to collection to simulate legacy document
      await collection.insertOne(legacyDoc);

      // Update using MonGuard - should work without version conflict
      const updateResult = await strategy.updateById(
        legacyDoc._id,
        { $set: { name: 'Updated Name' } },
        { userContext: TestDataFactory.createUserContext() }
      );

      expect(updateResult.modifiedCount).toBe(1);
      expect(updateResult.__v).toBe(1); // Should be version 1 for first MonGuard update on legacy doc

      // Verify the document now has __v field
      const updatedDoc = await collection.findOne({ _id: legacyDoc._id });
      expect(updatedDoc!.__v).toBe(1);
      expect(updatedDoc!.name).toBe('Updated Name');
    });

    it('should handle delete operations on documents without __v field', async () => {
      // Create a document without __v field
      const userData = TestDataFactory.createUser();
      const legacyDoc = {
        ...userData,
        _id: adaptObjectId(TestDataFactory.createObjectId()),
        createdAt: new Date(),
        updatedAt: new Date(),
        // Note: no __v field
      };

      await collection.insertOne(legacyDoc);

      // Soft delete using MonGuard - should work without version conflict
      const deleteResult = await strategy.deleteById(legacyDoc._id, {
        userContext: TestDataFactory.createUserContext(),
      });

      expect(deleteResult.modifiedCount).toBe(1);
      expect(deleteResult.__v).toBe(1); // Should be version 1 for first MonGuard operation on legacy doc

      // Verify the document is soft deleted and has __v field
      const deletedDoc = await collection.findOne({ _id: legacyDoc._id });
      expect(deletedDoc!.__v).toBe(1);
      expect(deletedDoc!.deletedAt).toBeDefined();
    });

    it('should handle restore operations on soft-deleted documents without __v field', async () => {
      // Create a soft-deleted document without __v field
      const userData = TestDataFactory.createUser();
      const legacyDoc = {
        ...userData,
        _id: adaptObjectId(TestDataFactory.createObjectId()),
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: new Date(),
        deletedBy: TestDataFactory.createUserContext().userId,
        // Note: no __v field
      };

      await collection.insertOne(legacyDoc);

      // Restore using MonGuard - should work without version conflict
      const restoreResult = await strategy.restore({ _id: legacyDoc._id }, TestDataFactory.createUserContext());

      expect(restoreResult.modifiedCount).toBe(1);
      expect(restoreResult.__v).toBe(1); // Should be version 1 for first MonGuard operation on legacy doc

      // Verify the document is restored and has __v field
      const restoredDoc = await collection.findOne({ _id: legacyDoc._id });
      expect(restoredDoc!.__v).toBe(1);
      expect(restoredDoc!.deletedAt).toBeUndefined();
      expect(restoredDoc!.deletedBy).toBeUndefined();
    });

    it('should work correctly for subsequent operations after first MonGuard operation', async () => {
      // Create a document without __v field
      const userData = TestDataFactory.createUser();
      const legacyDoc = {
        ...userData,
        _id: adaptObjectId(TestDataFactory.createObjectId()),
        createdAt: new Date(),
        updatedAt: new Date(),
        // Note: no __v field
      };

      await collection.insertOne(legacyDoc);

      // First update - converts from no __v to __v: 1
      const firstUpdate = await strategy.updateById(
        legacyDoc._id,
        { $set: { name: 'First Update' } },
        { userContext: TestDataFactory.createUserContext() }
      );
      expect(firstUpdate.modifiedCount).toBe(1);
      expect(firstUpdate.__v).toBe(1);

      // Second update - should use regular version checking (not special logic for missing __v)
      const secondUpdate = await strategy.updateById(
        legacyDoc._id,
        { $set: { name: 'Second Update' } },
        { userContext: TestDataFactory.createUserContext() }
      );
      expect(secondUpdate.modifiedCount).toBe(1);
      expect(secondUpdate.__v).toBe(2);

      // Verify final state
      const finalDoc = await collection.findOne({ _id: legacyDoc._id });
      expect(finalDoc!.__v).toBe(2);
      expect(finalDoc!.name).toBe('Second Update');
    });

    it('should handle concurrent operations on documents without __v field gracefully', async () => {
      // Create a document without __v field
      const userData = TestDataFactory.createUser();
      const legacyDoc = {
        ...userData,
        _id: adaptObjectId(TestDataFactory.createObjectId()),
        createdAt: new Date(),
        updatedAt: new Date(),
        // Note: no __v field
      };

      await collection.insertOne(legacyDoc);

      // Simulate two concurrent updates
      const userContext1 = TestDataFactory.createUserContext();
      const userContext2 = TestDataFactory.createUserContext();

      const promise1 = strategy.updateById(
        legacyDoc._id,
        { $set: { name: 'Update 1' } },
        { userContext: userContext1 }
      );

      const promise2 = strategy.updateById(
        legacyDoc._id,
        { $set: { name: 'Update 2' } },
        { userContext: userContext2 }
      );

      // One should succeed, one might fail due to version conflict
      const results = await Promise.allSettled([promise1, promise2]);

      const successfulResults = results.filter(r => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
      const failedResults = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];

      // At least one should succeed
      expect(successfulResults.length).toBeGreaterThan(0);

      if (successfulResults.length > 0) {
        expect(successfulResults[0]!.value.modifiedCount).toBe(1);
        expect(successfulResults[0]!.value.__v).toBe(1);
      }

      // If there were conflicts, they should be version conflicts
      failedResults.forEach(result => {
        expect(result.reason.message).toContain('Version conflict');
      });
    });
  });
});
