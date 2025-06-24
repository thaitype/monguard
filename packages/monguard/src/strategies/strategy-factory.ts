/**
 * @fileoverview Factory class for creating appropriate operation strategies based on configuration.
 */

import { BaseDocument, MonguardConcurrencyConfig, DefaultReferenceId } from '../types';
import { OperationStrategy, OperationStrategyContext } from './operation-strategy';
import { TransactionStrategy } from './transaction-strategy';
import { OptimisticLockingStrategy } from './optimistic-locking-strategy';

/**
 * Factory class responsible for creating the appropriate operation strategy
 * based on the concurrency configuration and database capabilities.
 */
export class StrategyFactory {
  /**
   * Creates an operation strategy based on the configuration.
   *
   * @template T - The document type extending BaseDocument
   * @template TRefId - The type used for document reference IDs in audit logs
   * @param context - The operation strategy context containing configuration and resources
   * @returns TransactionStrategy if transactions are enabled, OptimisticLockingStrategy otherwise
   *
   * @example
   * ```typescript
   * // For MongoDB with transactions
   * const strategy = StrategyFactory.create({
   *   config: { transactionsEnabled: true },
   *   // ... other context properties
   * });
   *
   * // For Cosmos DB without transactions
   * const strategy = StrategyFactory.create({
   *   config: { transactionsEnabled: false },
   *   // ... other context properties
   * });
   * ```
   */
  static create<T extends BaseDocument, TRefId = DefaultReferenceId>(
    context: OperationStrategyContext<T, TRefId>
  ): OperationStrategy<T, TRefId> {
    if (context.config.transactionsEnabled) {
      return new TransactionStrategy<T, TRefId>(context);
    } else {
      return new OptimisticLockingStrategy<T, TRefId>(context);
    }
  }

  /**
   * Validates the concurrency configuration to ensure it contains required settings.
   *
   * @param config - The concurrency configuration to validate
   * @throws {Error} When configuration is invalid or missing required properties
   *
   * @example
   * ```typescript
   * // Valid configurations
   * StrategyFactory.validateConfig({ transactionsEnabled: true });
   * StrategyFactory.validateConfig({
   *   transactionsEnabled: false,
   *   retryAttempts: 5,
   *   retryDelayMs: 200
   * });
   *
   * // Invalid - will throw error
   * StrategyFactory.validateConfig({ retryAttempts: -1 });
   * ```
   */
  static validateConfig(config: MonguardConcurrencyConfig): void {
    if (config.transactionsEnabled === undefined) {
      throw new Error(
        'transactionsEnabled must be explicitly set to true or false. ' +
          'For MongoDB Atlas/native use true, for Cosmos DB use false.'
      );
    }

    if (config.retryAttempts !== undefined && config.retryAttempts < 1) {
      throw new Error('retryAttempts must be at least 1');
    }

    if (config.retryDelayMs !== undefined && config.retryDelayMs < 0) {
      throw new Error('retryDelayMs must be non-negative');
    }
  }
}
