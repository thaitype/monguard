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
      auditControl: { 
        enableAutoAudit: true,
        failOnError: false,
        logFailedAttempts: false
      },
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

  describe('transaction execution paths', () => {
    it('should execute create operation within transaction (lines 58-72)', async () => {
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();
      const insertedId = adaptObjectId(TestDataFactory.createObjectId());

      // Mock successful transaction execution
      const mockSession = {
        withTransaction: vi.fn().mockImplementation(async (callback) => {
          await callback();
        }),
        endSession: vi.fn().mockResolvedValue(undefined)
      };

      const mockClient = {
        startSession: vi.fn().mockReturnValue(mockSession)
      };

      // Mock collection operations
      const mockInsertResult = { insertedId };
      const mockCollection = {
        ...collection,
        insertOne: vi.fn().mockResolvedValue(mockInsertResult),
        db: { client: mockClient }
      };

      // Mock audit logger
      const mockAuditLogger = {
        ...auditLogger,
        logOperation: vi.fn().mockResolvedValue(undefined),
        isEnabled: () => true
      };

      // Create strategy with mocked dependencies
      const context: OperationStrategyContext<TestUser> = {
        collection: mockCollection as any,
        auditLogger: mockAuditLogger as any,
        collectionName: 'test_users',
        config: { transactionsEnabled: true },
        auditControl: { 
          enableAutoAudit: true,
          failOnError: false,
          logFailedAttempts: false
        },
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

      const mockedStrategy = new TransactionStrategy(context);

      // Execute create operation
      const result = await mockedStrategy.create(userData, { userContext });

      // Verify transaction was used
      expect(mockSession.withTransaction).toHaveBeenCalled();
      expect(mockCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          ...userData,
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
          createdBy: userContext.userId,
          updatedBy: userContext.userId
        }),
        { session: mockSession }
      );
      expect(mockAuditLogger.logOperation).toHaveBeenCalledWith(
        'create',
        'test_users',
        insertedId,
        userContext,
        expect.objectContaining({ after: expect.any(Object) }),
        expect.objectContaining({
          failOnError: expect.any(Boolean),
          logFailedAttempts: expect.any(Boolean)
        })
      );
      expect(mockSession.endSession).toHaveBeenCalled();
      expect(result._id).toBe(insertedId);
    });

    it('should execute update operation within transaction (lines 138-178)', async () => {
      const filter = { name: 'Test User' };
      const update = { $set: { email: 'updated@example.com' } };
      const userContext = TestDataFactory.createUserContext();
      const beforeDoc = { _id: adaptObjectId(TestDataFactory.createObjectId()), name: 'Test User', email: 'old@example.com' };
      const afterDoc = { ...beforeDoc, email: 'updated@example.com', updatedAt: new Date() };

      // Mock successful transaction execution
      const mockSession = {
        withTransaction: vi.fn().mockImplementation(async (callback) => {
          await callback();
        }),
        endSession: vi.fn().mockResolvedValue(undefined)
      };

      const mockClient = {
        startSession: vi.fn().mockReturnValue(mockSession)
      };

      const mockUpdateResult = { acknowledged: true, modifiedCount: 1, upsertedCount: 0, upsertedId: null, matchedCount: 1 };
      const mockCollection = {
        ...collection,
        findOne: vi.fn()
          .mockResolvedValueOnce(beforeDoc) // First call for before state
          .mockResolvedValueOnce(afterDoc), // Second call for after state
        updateMany: vi.fn().mockResolvedValue(mockUpdateResult),
        db: { client: mockClient }
      };

      const mockAuditLogger = {
        ...auditLogger,
        logOperation: vi.fn().mockResolvedValue(undefined),
        isEnabled: () => true
      };

      const context: OperationStrategyContext<TestUser> = {
        collection: mockCollection as any,
        auditLogger: mockAuditLogger as any,
        collectionName: 'test_users',
        config: { transactionsEnabled: true },
        auditControl: { 
          enableAutoAudit: true,
          failOnError: false,
          logFailedAttempts: false
        },
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

      const mockedStrategy = new TransactionStrategy(context);

      // Execute update operation
      const result = await mockedStrategy.update(filter, update, { userContext });

      // Verify transaction was used
      expect(mockSession.withTransaction).toHaveBeenCalled();
      expect(mockCollection.findOne).toHaveBeenNthCalledWith(1, filter, { session: mockSession });
      expect(mockCollection.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ ...filter, deletedAt: { $exists: false } }),
        expect.objectContaining({
          $set: expect.objectContaining({
            email: 'updated@example.com',
            updatedAt: expect.any(Date),
            updatedBy: userContext.userId
          })
        }),
        { upsert: undefined, session: mockSession }
      );
      expect(mockAuditLogger.logOperation).toHaveBeenCalledWith(
        'update',
        'test_users',
        beforeDoc._id,
        userContext,
        expect.objectContaining({
          before: beforeDoc,
          after: afterDoc,
          changes: expect.any(Array)
        }),
        expect.objectContaining({
          failOnError: expect.any(Boolean),
          logFailedAttempts: expect.any(Boolean)
        })
      );
      expect(result.modifiedCount).toBe(1);
    });

    it('should execute hard delete operation within transaction (lines 286-303)', async () => {
      const filter = { name: 'Test User' };
      const userContext = TestDataFactory.createUserContext();
      const docToDelete = { _id: adaptObjectId(TestDataFactory.createObjectId()), name: 'Test User' };

      const mockSession = {
        withTransaction: vi.fn().mockImplementation(async (callback) => {
          await callback();
        }),
        endSession: vi.fn().mockResolvedValue(undefined)
      };

      const mockClient = {
        startSession: vi.fn().mockReturnValue(mockSession)
      };

      const mockDeleteResult = { acknowledged: true, deletedCount: 1 };
      const mockCollection = {
        ...collection,
        find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([docToDelete]) }),
        deleteMany: vi.fn().mockResolvedValue(mockDeleteResult),
        db: { client: mockClient }
      };

      const mockAuditLogger = {
        ...auditLogger,
        logOperation: vi.fn().mockResolvedValue(undefined),
        isEnabled: () => true
      };

      const context: OperationStrategyContext<TestUser> = {
        collection: mockCollection as any,
        auditLogger: mockAuditLogger as any,
        collectionName: 'test_users',
        config: { transactionsEnabled: true },
        auditControl: { 
          enableAutoAudit: true,
          failOnError: false,
          logFailedAttempts: false
        },
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

      const mockedStrategy = new TransactionStrategy(context);

      // Execute hard delete operation
      const result = await mockedStrategy.delete(filter, { hardDelete: true, userContext });

      // Verify transaction was used
      expect(mockSession.withTransaction).toHaveBeenCalled();
      expect(mockCollection.find).toHaveBeenCalledWith(filter, { session: mockSession });
      expect(mockCollection.deleteMany).toHaveBeenCalledWith(filter, { session: mockSession });
      expect(mockAuditLogger.logOperation).toHaveBeenCalledWith(
        'delete',
        'test_users',
        docToDelete._id,
        userContext,
        expect.objectContaining({
          hardDelete: true,
          before: docToDelete
        }),
        expect.objectContaining({
          failOnError: expect.any(Boolean),
          logFailedAttempts: expect.any(Boolean)
        })
      );
      expect(result.deletedCount).toBe(1);
    });

    it('should execute soft delete operation within transaction (lines 313-345)', async () => {
      const filter = { name: 'Test User' };
      const userContext = TestDataFactory.createUserContext();
      const beforeDoc = { _id: adaptObjectId(TestDataFactory.createObjectId()), name: 'Test User' };

      const mockSession = {
        withTransaction: vi.fn().mockImplementation(async (callback) => {
          await callback();
        }),
        endSession: vi.fn().mockResolvedValue(undefined)
      };

      const mockClient = {
        startSession: vi.fn().mockReturnValue(mockSession)
      };

      const mockUpdateResult = { acknowledged: true, modifiedCount: 1, upsertedCount: 0, upsertedId: null, matchedCount: 1 };
      const mockCollection = {
        ...collection,
        findOne: vi.fn().mockResolvedValue(beforeDoc),
        updateMany: vi.fn().mockResolvedValue(mockUpdateResult),
        db: { client: mockClient }
      };

      const mockAuditLogger = {
        ...auditLogger,
        logOperation: vi.fn().mockResolvedValue(undefined),
        isEnabled: () => true
      };

      const context: OperationStrategyContext<TestUser> = {
        collection: mockCollection as any,
        auditLogger: mockAuditLogger as any,
        collectionName: 'test_users',
        config: { transactionsEnabled: true },
        auditControl: { 
          enableAutoAudit: true,
          failOnError: false,
          logFailedAttempts: false
        },
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

      const mockedStrategy = new TransactionStrategy(context);

      // Execute soft delete operation
      const result = await mockedStrategy.delete(filter, { hardDelete: false, userContext });

      // Verify transaction was used
      expect(mockSession.withTransaction).toHaveBeenCalled();
      expect(mockCollection.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ ...filter, deletedAt: { $exists: false } }),
        { session: mockSession }
      );
      expect(mockCollection.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ ...filter, deletedAt: { $exists: false } }),
        expect.objectContaining({
          $set: expect.objectContaining({
            deletedAt: expect.any(Date),
            updatedAt: expect.any(Date),
            deletedBy: userContext.userId
          })
        }),
        { session: mockSession }
      );
      expect(mockAuditLogger.logOperation).toHaveBeenCalledWith(
        'delete',
        'test_users',
        beforeDoc._id,
        userContext,
        expect.objectContaining({
          softDelete: true,
          before: beforeDoc
        }),
        expect.objectContaining({
          failOnError: expect.any(Boolean),
          logFailedAttempts: expect.any(Boolean)
        })
      );
      expect(result.modifiedCount).toBe(1);
    });

    it('should handle transaction errors and throw them (lines 229, 415)', async () => {
      const userData = TestDataFactory.createUser();
      
      // Mock transaction that throws a non-replica set error
      const mockSession = {
        withTransaction: vi.fn().mockRejectedValue(new Error('Connection timeout')),
        endSession: vi.fn().mockResolvedValue(undefined)
      };

      const mockClient = {
        startSession: vi.fn().mockReturnValue(mockSession)
      };

      const mockCollection = {
        ...collection,
        db: { client: mockClient }
      };

      const context: OperationStrategyContext<TestUser> = {
        collection: mockCollection as any,
        auditLogger,
        collectionName: 'test_users',
        config: { transactionsEnabled: true },
        auditControl: { enableAutoAudit: true },
        addTimestamps: (doc, isUpdate, userContext) => ({ ...doc }),
        mergeSoftDeleteFilter: (filter) => filter,
        getChangedFields: (before, after) => [],
        shouldAudit: (skipAudit) => !skipAudit,
      };

      const mockedStrategy = new TransactionStrategy(context);

      // Should throw the transaction error (line 229 for update, line 415 for delete)
      await expect(mockedStrategy.update({}, { $set: { name: 'test' } })).rejects.toThrow('Connection timeout');
      await expect(mockedStrategy.delete({}, { hardDelete: true })).rejects.toThrow('Connection timeout');
    });

    it('should handle operation errors and wrap them (lines 236, 423, 499)', async () => {
      const userData = TestDataFactory.createUser();
      
      // Mock session that works but collection operation fails
      const mockSession = {
        withTransaction: vi.fn().mockImplementation(async (callback) => {
          await callback();
        }),
        endSession: vi.fn().mockResolvedValue(undefined)
      };

      const mockClient = {
        startSession: vi.fn().mockReturnValue(mockSession)
      };

      const mockCollection = {
        ...collection,
        insertOne: vi.fn().mockRejectedValue(new Error('Insert failed')),
        findOne: vi.fn().mockRejectedValue(new Error('Find failed')),
        find: vi.fn().mockReturnValue({ 
          toArray: vi.fn().mockRejectedValue(new Error('Find failed'))
        }),
        updateMany: vi.fn().mockRejectedValue(new Error('Update failed')),
        deleteMany: vi.fn().mockRejectedValue(new Error('Delete failed')),
        updateOne: vi.fn().mockRejectedValue(new Error('Restore failed')),
        db: { client: mockClient }
      };

      const context: OperationStrategyContext<TestUser> = {
        collection: mockCollection as any,
        auditLogger,
        collectionName: 'test_users',
        config: { transactionsEnabled: true },
        auditControl: { enableAutoAudit: true },
        addTimestamps: (doc, isUpdate, userContext) => ({ ...doc }),
        mergeSoftDeleteFilter: (filter) => filter,
        getChangedFields: (before, after) => [],
        shouldAudit: (skipAudit) => !skipAudit,
      };

      const mockedStrategy = new TransactionStrategy(context);

      // Should preserve original error messages (lines 102, 236, 423, 499)
      await expect(mockedStrategy.create(userData)).rejects.toThrow('Insert failed');
      await expect(mockedStrategy.update({}, { $set: { name: 'test' } })).rejects.toThrow('Find failed');
      await expect(mockedStrategy.delete({}, { hardDelete: true })).rejects.toThrow('Find failed');
      await expect(mockedStrategy.restore({})).rejects.toThrow('Update failed'); // restore uses updateMany
    });
  });

});