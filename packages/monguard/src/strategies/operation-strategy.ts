import type { ObjectId, Filter, UpdateFilter, UpdateResult, DeleteResult, Collection } from '../mongodb-types';
import {
  BaseDocument,
  CreateOptions,
  UpdateOptions,
  DeleteOptions,
  Result,
  MonguardConcurrencyConfig,
} from '../types';

export interface OperationStrategy<T extends BaseDocument> {
  create(document: any, options: CreateOptions): Promise<Result<T & { _id: ObjectId }>>;

  update(filter: Filter<T>, update: UpdateFilter<T>, options: UpdateOptions): Promise<Result<UpdateResult>>;

  updateById(id: ObjectId, update: UpdateFilter<T>, options: UpdateOptions): Promise<Result<UpdateResult>>;

  delete(filter: Filter<T>, options: DeleteOptions): Promise<Result<UpdateResult | DeleteResult>>;

  deleteById(id: ObjectId, options: DeleteOptions): Promise<Result<UpdateResult | DeleteResult>>;

  restore(filter: Filter<T>, userContext?: any): Promise<Result<UpdateResult>>;
}

export interface OperationStrategyContext<T extends BaseDocument> {
  collection: Collection<T>;
  auditCollection: Collection<any>;
  collectionName: string;
  config: MonguardConcurrencyConfig;
  disableAudit: boolean;
  createAuditLog: (action: any, documentId: ObjectId, userContext?: any, metadata?: any) => Promise<void>;
  addTimestamps: (document: any, isUpdate?: boolean, userContext?: any) => any;
  mergeSoftDeleteFilter: (filter: Filter<T>) => Filter<T>;
  getChangedFields: (before: any, after: any) => string[];
}
