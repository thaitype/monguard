import { describe, it, expect } from 'vitest';
import { StrategyFactory } from '../../src/strategies/strategy-factory';
import { TransactionStrategy } from '../../src/strategies/transaction-strategy';
import { OptimisticLockingStrategy } from '../../src/strategies/optimistic-locking-strategy';
import type { MonguardConcurrencyConfig } from '../../src/types';

describe('StrategyFactory', () => {
  describe('create', () => {
    it('should create TransactionStrategy when transactions are enabled', () => {
      const mockContext = {
        config: { transactionsEnabled: true },
        collection: {} as any,
        auditLogger: {} as any,
        collectionName: 'test',
        auditControl: { enableAutoAudit: true },
        addTimestamps: () => ({}),
        mergeSoftDeleteFilter: () => ({}),
        getChangedFields: () => [],
        shouldAudit: () => true,
      };

      const strategy = StrategyFactory.create(mockContext);
      expect(strategy).toBeInstanceOf(TransactionStrategy);
    });

    it('should create OptimisticLockingStrategy when transactions are disabled', () => {
      const mockContext = {
        config: { transactionsEnabled: false },
        collection: {} as any,
        auditLogger: {} as any,
        collectionName: 'test',
        auditControl: { enableAutoAudit: true },
        addTimestamps: () => ({}),
        mergeSoftDeleteFilter: () => ({}),
        getChangedFields: () => [],
        shouldAudit: () => true,
      };

      const strategy = StrategyFactory.create(mockContext);
      expect(strategy).toBeInstanceOf(OptimisticLockingStrategy);
    });
  });

  describe('validateConfig', () => {
    it('should accept valid configuration with transactions enabled', () => {
      const config: MonguardConcurrencyConfig = {
        transactionsEnabled: true,
      };

      expect(() => StrategyFactory.validateConfig(config)).not.toThrow();
    });

    it('should accept valid configuration with transactions disabled', () => {
      const config: MonguardConcurrencyConfig = {
        transactionsEnabled: false,
      };

      expect(() => StrategyFactory.validateConfig(config)).not.toThrow();
    });

    it('should accept valid configuration with optional retry settings', () => {
      const config: MonguardConcurrencyConfig = {
        transactionsEnabled: false,
        retryAttempts: 5,
        retryDelayMs: 200,
      };

      expect(() => StrategyFactory.validateConfig(config)).not.toThrow();
    });

    it('should throw error when transactionsEnabled is undefined', () => {
      const config = {} as MonguardConcurrencyConfig;

      expect(() => StrategyFactory.validateConfig(config)).toThrow(
        'transactionsEnabled must be explicitly set to true or false. ' +
        'For MongoDB Atlas/native use true, for Cosmos DB use false.'
      );
    });

    it('should throw error when retryAttempts is less than 1 (line 77)', () => {
      const config: MonguardConcurrencyConfig = {
        transactionsEnabled: false,
        retryAttempts: 0,
      };

      expect(() => StrategyFactory.validateConfig(config)).toThrow(
        'retryAttempts must be at least 1'
      );
    });

    it('should throw error when retryAttempts is negative (line 77)', () => {
      const config: MonguardConcurrencyConfig = {
        transactionsEnabled: false,
        retryAttempts: -1,
      };

      expect(() => StrategyFactory.validateConfig(config)).toThrow(
        'retryAttempts must be at least 1'
      );
    });

    it('should throw error when retryDelayMs is negative (line 81)', () => {
      const config: MonguardConcurrencyConfig = {
        transactionsEnabled: false,
        retryDelayMs: -100,
      };

      expect(() => StrategyFactory.validateConfig(config)).toThrow(
        'retryDelayMs must be non-negative'
      );
    });

    it('should accept retryDelayMs of zero', () => {
      const config: MonguardConcurrencyConfig = {
        transactionsEnabled: false,
        retryDelayMs: 0,
      };

      expect(() => StrategyFactory.validateConfig(config)).not.toThrow();
    });

    it('should accept valid positive retryDelayMs', () => {
      const config: MonguardConcurrencyConfig = {
        transactionsEnabled: false,
        retryDelayMs: 100,
      };

      expect(() => StrategyFactory.validateConfig(config)).not.toThrow();
    });
  });
});