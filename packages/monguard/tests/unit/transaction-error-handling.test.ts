import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TransactionStrategy } from '../../src/strategies/transaction-strategy';
import { TestDataFactory, TestUser } from '../factories';
import type { OperationStrategyContext } from '../../src/strategies/operation-strategy';
import { NoOpAuditLogger, ConsoleLogger } from '../../src/audit-logger';

describe('TransactionStrategy Error Handling', () => {
  let mockCollection: any;
  let mockSession: any;
  let mockClient: any;
  let strategy: TransactionStrategy<TestUser>;

  beforeEach(() => {
    // Mock session that fails with transaction-not-supported error
    mockSession = {
      withTransaction: vi
        .fn()
        .mockRejectedValue(new Error('Transaction numbers are only allowed on a replica set member or mongos')),
      endSession: vi.fn().mockResolvedValue(undefined),
    };

    // Mock client that returns failing session
    mockClient = {
      startSession: vi.fn().mockReturnValue(mockSession),
    };

    // Mock collection with failing client
    mockCollection = {
      db: { client: mockClient },
      insertOne: vi.fn(),
      updateMany: vi.fn(),
      findOne: vi.fn(),
      find: vi.fn(),
      deleteMany: vi.fn(),
      updateOne: vi.fn(),
    };

    const context: OperationStrategyContext<TestUser> = {
      collection: mockCollection,
      auditLogger: new NoOpAuditLogger(),
      logger: ConsoleLogger,
      collectionName: 'test_users',
      config: { transactionsEnabled: true },
      auditControl: { enableAutoAudit: true },
      addTimestamps: doc => ({ ...doc, createdAt: new Date(), updatedAt: new Date() }),
      mergeSoftDeleteFilter: filter => ({ ...filter, deletedAt: { $exists: false } }),
      getChangedFields: () => [],
      shouldAudit: () => false, // Disable audit for error testing
    };

    strategy = new TransactionStrategy(context);
  });

  describe('Transaction Not Supported Errors', () => {
    it('should throw original MongoDB error for create operation', async () => {
      const userData = TestDataFactory.createUser();

      await expect(strategy.create(userData)).rejects.toThrow(
        'Transaction numbers are only allowed on a replica set member or mongos'
      );

      // Verify session was started and ended
      expect(mockClient.startSession).toHaveBeenCalled();
      expect(mockSession.withTransaction).toHaveBeenCalled();
      expect(mockSession.endSession).toHaveBeenCalled();
    });

    it('should throw original MongoDB error for update operation', async () => {
      const filter = { name: 'Test User' };
      const update = { $set: { email: 'updated@example.com' } };

      await expect(strategy.update(filter, update)).rejects.toThrow(
        'Transaction numbers are only allowed on a replica set member or mongos'
      );

      expect(mockClient.startSession).toHaveBeenCalled();
      expect(mockSession.withTransaction).toHaveBeenCalled();
      expect(mockSession.endSession).toHaveBeenCalled();
    });

    it('should throw original MongoDB error for delete operation', async () => {
      const filter = { name: 'Test User' };

      await expect(strategy.delete(filter, { hardDelete: true })).rejects.toThrow(
        'Transaction numbers are only allowed on a replica set member or mongos'
      );

      expect(mockClient.startSession).toHaveBeenCalled();
      expect(mockSession.withTransaction).toHaveBeenCalled();
      expect(mockSession.endSession).toHaveBeenCalled();
    });

    it('should throw original MongoDB error for restore operation', async () => {
      const filter = { name: 'Test User' };

      await expect(strategy.restore(filter)).rejects.toThrow(
        'Transaction numbers are only allowed on a replica set member or mongos'
      );

      expect(mockClient.startSession).toHaveBeenCalled();
      expect(mockSession.withTransaction).toHaveBeenCalled();
      expect(mockSession.endSession).toHaveBeenCalled();
    });
  });

  describe('Other Transaction Errors', () => {
    beforeEach(() => {
      // Change mock to throw a different transaction error
      mockSession.withTransaction.mockRejectedValue(new Error('Connection timeout during transaction'));
    });

    it('should throw original error for connection timeouts', async () => {
      const userData = TestDataFactory.createUser();

      await expect(strategy.create(userData)).rejects.toThrow('Connection timeout during transaction');
    });

    it('should throw original error for write conflicts', async () => {
      mockSession.withTransaction.mockRejectedValue(new Error('WriteConflict error'));

      const filter = { name: 'Test User' };
      const update = { $set: { email: 'updated@example.com' } };

      await expect(strategy.update(filter, update)).rejects.toThrow('WriteConflict error');
    });
  });

  describe('Session Cleanup', () => {
    it('should always clean up session even when transaction fails', async () => {
      const userData = TestDataFactory.createUser();

      try {
        await strategy.create(userData);
      } catch (error) {
        // Expected to throw
      }

      // Verify session cleanup happened
      expect(mockSession.endSession).toHaveBeenCalled();
    });

    it('should clean up session when transaction succeeds', async () => {
      // Mock successful transaction
      mockSession.withTransaction.mockImplementation(async (callback: () => Promise<void>) => {
        await callback();
      });
      mockCollection.insertOne.mockResolvedValue({ insertedId: 'test-id' });

      const userData = TestDataFactory.createUser();
      await strategy.create(userData);

      // Verify session cleanup happened
      expect(mockSession.endSession).toHaveBeenCalled();
    });
  });
});
