import type { ObjectId, Filter, UpdateFilter, UpdateResult, DeleteResult, Collection } from '../mongodb-types';
import { 
  BaseDocument, 
  CreateOptions, 
  UpdateOptions, 
  DeleteOptions, 
  WrapperResult,
  MonguardConcurrencyConfig
} from '../types';

export interface OperationStrategy<T extends BaseDocument> {
  create(document: any, options: CreateOptions): Promise<WrapperResult<T & { _id: ObjectId }>>;
  
  update(filter: Filter<T>, update: UpdateFilter<T>, options: UpdateOptions): Promise<WrapperResult<UpdateResult>>;
  
  updateById(id: ObjectId, update: UpdateFilter<T>, options: UpdateOptions): Promise<WrapperResult<UpdateResult>>;
  
  delete(filter: Filter<T>, options: DeleteOptions): Promise<WrapperResult<UpdateResult | DeleteResult>>;
  
  deleteById(id: ObjectId, options: DeleteOptions): Promise<WrapperResult<UpdateResult | DeleteResult>>;
  
  restore(filter: Filter<T>, userContext?: any): Promise<WrapperResult<UpdateResult>>;
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