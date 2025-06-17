import { BaseDocument, MonguardConfig } from '../types';
import { OperationStrategy, OperationStrategyContext } from './operation-strategy';
import { TransactionStrategy } from './transaction-strategy';
import { OptimisticLockingStrategy } from './optimistic-locking-strategy';

export class StrategyFactory {
  static create<T extends BaseDocument>(
    context: OperationStrategyContext<T>
  ): OperationStrategy<T> {
    if (context.config.transactionsEnabled) {
      return new TransactionStrategy(context);
    } else {
      return new OptimisticLockingStrategy(context);
    }
  }
  
  static validateConfig(config: MonguardConfig): void {
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