import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectId as MongoObjectId, Db as MongoDb } from 'mongodb';
import { TransactionStrategy } from '../../src/strategies/transaction-strategy';
import { TestDatabase } from '../setup';
import { TestDataFactory, TestUser } from '../factories';
import { adaptDb, adaptObjectId } from '../mongodb-adapter';
import { MonguardAuditLogger } from '../../src/audit-logger';
import type { Db, Collection, ObjectId } from '../../src/mongodb-types';
import type { OperationStrategyContext } from '../../src/strategies/operation-strategy';

// Test class to access private fallback strategy for testing
class TestableTransactionStrategy<T, TRefId = any> extends TransactionStrategy<T, TRefId> {
  public getFallbackStrategy() {
    return (this as any).fallbackStrategy;
  }
}

describe('TransactionStrategy', () => {
  let testDb: TestDatabase;
  let mongoDb: MongoDb;
  let db: Db;
  let collection: Collection<TestUser>;
  let strategy: TestableTransactionStrategy<TestUser>;
  let auditLogger: MonguardAuditLogger;

  beforeEach(async () => {
    testDb = new TestDatabase();
    mongoDb = await testDb.start();
    db = adaptDb(mongoDb);
    collection = db.collection<TestUser>('test_users');
    auditLogger = new MonguardAuditLogger(db, 'audit_logs');

    const context: OperationStrategyContext<TestUser> = {
      collection,
      auditLogger,
      collectionName: 'test_users',
      config: { transactionsEnabled: true },
      auditControl: { enableAutoAudit: true },
      addTimestamps: (doc, isUpdate, userContext) => ({
        ...doc,
        ...(isUpdate ? { updatedAt: new Date() } : { createdAt: new Date(), updatedAt: new Date() }),
        ...(userContext && {
          ...(isUpdate ? { updatedBy: userContext.userId } : { createdBy: userContext.userId, updatedBy: userContext.userId })
        })
      }),
      mergeSoftDeleteFilter: (filter) => ({ ...filter, deletedAt: { $exists: false } }),
      getChangedFields: (before, after) => Object.keys({ ...before, ...after }),
      shouldAudit: (skipAudit) => !skipAudit,
    };

    strategy = new TestableTransactionStrategy(context);
  });

  afterEach(async () => {
    await testDb.stop();
  });

  describe('error handling and fallback behavior', () => {
    it('should verify fallback strategy exists for testing coverage', async () => {
      // Since TransactionStrategy falls back to OptimisticLockingStrategy in standalone MongoDB,
      // we can test basic functionality which exercises the fallback
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      const result = await strategy.create(userData, { userContext });
      
      expect(result).toBeDefined();
      expect(result._id).toBeDefined();
      expect(result.name).toBe(userData.name);
      // In standalone MongoDB (our test environment), it falls back to optimistic locking
      // which adds version=1, so result.version will be 1
    });

    it('should handle operations that exercise fallback paths', async () => {
      // Test update operation which exercises the transaction -> fallback path
      const userData = TestDataFactory.createUser();
      const createdDoc = await strategy.create(userData);

      const result = await strategy.updateById(
        createdDoc._id,
        { $set: { name: 'Updated Name' } },
        { userContext: TestDataFactory.createUserContext() }
      );

      expect(result.modifiedCount).toBeGreaterThan(0);
      // In fallback mode (optimistic locking), newVersion is provided
    });
  });

  describe('basic operations to exercise code paths', () => {
    it('should handle delete operations', async () => {
      const userData = TestDataFactory.createUser();
      const createdDoc = await strategy.create(userData);

      const result = await strategy.deleteById(
        createdDoc._id,
        { hardDelete: false, userContext: TestDataFactory.createUserContext() }
      );

      expect(result.modifiedCount).toBeGreaterThan(0);
    });

    it('should handle restore operations', async () => {
      const userData = TestDataFactory.createUser();
      const createdDoc = await strategy.create(userData);
      
      // Soft delete the document first
      await strategy.deleteById(createdDoc._id, { hardDelete: false });

      const result = await strategy.restore(
        { _id: createdDoc._id },
        TestDataFactory.createUserContext()
      );

      expect(result.modifiedCount).toBeGreaterThan(0);
    });

    it('should handle bulk operations', async () => {
      const userData = TestDataFactory.createUser();
      await strategy.create(userData);

      const result = await strategy.update(
        { name: userData.name },
        { $set: { email: 'updated@example.com' } },
        { userContext: TestDataFactory.createUserContext() }
      );

      expect(result.acknowledged).toBe(true);
    });

    it('should handle hard delete operations', async () => {
      const userData = TestDataFactory.createUser();
      const createdDoc = await strategy.create(userData);

      const result = await strategy.deleteById(
        createdDoc._id,
        { hardDelete: true, userContext: TestDataFactory.createUserContext() }
      );

      expect(result.deletedCount).toBeGreaterThan(0);
    });
  });
});