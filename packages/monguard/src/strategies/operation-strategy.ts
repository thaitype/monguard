/**
 * @fileoverview Operation strategy interfaces and types for different concurrency control approaches.
 */

import type { ObjectId, Filter, UpdateFilter, UpdateResult, DeleteResult, Collection } from '../mongodb-types';
import { BaseDocument, CreateOptions, UpdateOptions, DeleteOptions, MonguardConcurrencyConfig, HardOrSoftDeleteResult } from '../types';

/**
 * Interface defining the operations that different concurrency strategies must implement.
 * Strategies can include transaction-based or optimistic locking approaches.
 *
 * @template T - The document type extending BaseDocument
 */
export interface OperationStrategy<T extends BaseDocument> {
  /**
   * Creates a new document with the strategy's concurrency control approach.
   *
   * @param document - The document data to create
   * @param options - Options for the create operation
   * @returns Promise resolving to the created document
   * @throws Error if the operation fails
   */
  create(document: any, options: CreateOptions): Promise<T & { _id: ObjectId }>;

  /**
   * Updates documents matching the filter with the strategy's concurrency control approach.
   *
   * @param filter - MongoDB filter criteria
   * @param update - Update operations to apply
   * @param options - Options for the update operation
   * @returns Promise resolving to update result information
   * @throws Error if the operation fails
   */
  update(filter: Filter<T>, update: UpdateFilter<T>, options: UpdateOptions): Promise<UpdateResult>;

  /**
   * Updates a single document by ID with the strategy's concurrency control approach.
   *
   * @param id - The document ID to update
   * @param update - Update operations to apply
   * @param options - Options for the update operation
   * @returns Promise resolving to update result information
   * @throws Error if the operation fails
   */
  updateById(id: ObjectId, update: UpdateFilter<T>, options: UpdateOptions): Promise<UpdateResult>;

  /**
   * Deletes documents matching the filter with the strategy's concurrency control approach.
   *
   * @param filter - MongoDB filter criteria
   * @param options - Options for the delete operation
   * @returns Promise resolving to delete/update result information
   * @throws Error if the operation fails
   */
  delete<THardDelete extends boolean>(filter: Filter<T>, options: DeleteOptions<THardDelete>): Promise<HardOrSoftDeleteResult<THardDelete>>;

  /**
   * Deletes a single document by ID with the strategy's concurrency control approach.
   *
   * @param id - The document ID to delete
   * @param options - Options for the delete operation
   * @returns Promise resolving to delete/update result information
   * @throws Error if the operation fails
   */
  deleteById<THardDelete extends boolean = false>(id: ObjectId, options: DeleteOptions<THardDelete>): Promise<HardOrSoftDeleteResult<THardDelete>>;

  /**
   * Restores soft-deleted documents with the strategy's concurrency control approach.
   *
   * @param filter - MongoDB filter criteria
   * @param userContext - Optional user context for audit trails
   * @returns Promise resolving to update result information
   * @throws Error if the operation fails
   */
  restore(filter: Filter<T>, userContext?: any): Promise<UpdateResult>;
}

/**
 * Context object providing shared resources and helper functions to operation strategies.
 * Contains collections, configuration, and utility functions needed by all strategies.
 *
 * @template T - The document type extending BaseDocument
 */
export interface OperationStrategyContext<T extends BaseDocument> {
  /** The main MongoDB collection being managed */
  collection: Collection<T>;
  /** The audit log collection for tracking changes */
  auditCollection: Collection<any>;
  /** Name of the collection being managed */
  collectionName: string;
  /** Concurrency configuration determining strategy behavior */
  config: MonguardConcurrencyConfig;
  /** Whether audit logging is globally disabled */
  disableAudit: boolean;
  /** Function to create audit log entries */
  createAuditLog: (action: any, documentId: ObjectId, userContext?: any, metadata?: any) => Promise<void>;
  /** Function to add timestamp fields to documents */
  addTimestamps: (document: any, isUpdate?: boolean, userContext?: any) => any;
  /** Function to merge user filter with soft delete exclusion */
  mergeSoftDeleteFilter: (filter: Filter<T>) => Filter<T>;
  /** Function to detect changed fields between document states */
  getChangedFields: (before: any, after: any) => string[];
}
