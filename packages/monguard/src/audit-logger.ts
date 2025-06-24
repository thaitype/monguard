/**
 * @fileoverview Audit logging interfaces and implementations for tracking document changes.
 */

import type { Collection, WithoutId, Db } from './mongodb-types';
import type { AuditLogDocument, AuditAction, UserContext } from './types';

/**
 * Options for configuring an audit logger instance.
 * @template TRefId - The type used for document reference IDs
 */
export interface AuditLoggerOptions<TRefId = any> {
  /** Name of the collection to store audit logs */
  auditCollectionName?: string;
  /** Custom audit log collection instance */
  auditCollection?: Collection<AuditLogDocument<TRefId>>;
}

/**
 * Options for configuring a MonguardAuditLogger instance.
 * @template TRefId - The type used for document reference IDs
 */
export interface MonguardAuditLoggerOptions<TRefId = any> {
  // Reserved for future extensibility
  // Could include options like:
  // - Custom timestamp field names
  // - Custom metadata handling
  // - Batch logging configuration
  // - Error handling strategies
}

/**
 * Metadata that can be attached to audit log entries.
 */
export interface AuditLogMetadata {
  /** Document state before the change */
  before?: any;
  /** Document state after the change */
  after?: any;
  /** List of field names that were changed */
  changes?: string[];
  /** Whether this was a soft delete operation */
  softDelete?: boolean;
  /** Whether this was a hard delete operation */
  hardDelete?: boolean;
  /** Additional custom metadata */
  [key: string]: any;
}

/**
 * Abstract base class for audit logging implementations.
 * Provides a consistent interface for tracking document changes with type-safe reference IDs.
 * 
 * @template TRefId - The type used for document reference IDs (e.g., ObjectId, string)
 */
export abstract class AuditLogger<TRefId = any> {
  /**
   * Creates an audit log entry for a document operation.
   * 
   * @param action - The type of action performed (create, update, delete)
   * @param collectionName - Name of the collection containing the modified document
   * @param documentId - ID of the document that was modified
   * @param userContext - Optional user context for the operation
   * @param metadata - Additional metadata about the operation
   * @returns Promise that resolves when the audit log is created
   */
  abstract logOperation(
    action: AuditAction,
    collectionName: string,
    documentId: TRefId,
    userContext?: UserContext<TRefId>,
    metadata?: AuditLogMetadata
  ): Promise<void>;

  /**
   * Retrieves audit logs for a specific document.
   * 
   * @param collectionName - Name of the collection containing the document
   * @param documentId - ID of the document to get audit logs for
   * @returns Promise resolving to array of audit log entries
   */
  abstract getAuditLogs(
    collectionName: string,
    documentId: TRefId
  ): Promise<AuditLogDocument<TRefId>[]>;

  /**
   * Retrieves the audit collection instance.
   * Used for advanced queries and maintenance operations.
   * 
   * @returns The audit collection instance or null if not applicable
   */
  abstract getAuditCollection(): Collection<AuditLogDocument<TRefId>> | null;

  /**
   * Checks if audit logging is enabled for this logger instance.
   * 
   * @returns True if audit logging is enabled, false otherwise
   */
  abstract isEnabled(): boolean;
}

/**
 * MongoDB-based audit logger implementation.
 * Stores audit logs in a MongoDB collection with type-safe reference IDs.
 * 
 * @template TRefId - The type used for document reference IDs (e.g., ObjectId, string)
 */
export class MonguardAuditLogger<TRefId = any> extends AuditLogger<TRefId> {
  private auditCollection: Collection<AuditLogDocument<TRefId>>;

  /**
   * Creates a new MonguardAuditLogger instance.
   * 
   * @param db - MongoDB database instance
   * @param collectionName - Name of the collection to store audit logs
   * @param options - Optional configuration for the audit logger
   */
  constructor(
    db: Db, 
    collectionName: string, 
    options?: MonguardAuditLoggerOptions<TRefId>
  ) {
    super();
    this.auditCollection = db.collection<AuditLogDocument<TRefId>>(collectionName) as Collection<AuditLogDocument<TRefId>>;
    // Future: Handle options if provided
  }

  /**
   * Creates an audit log entry in the MongoDB collection.
   * Handles errors gracefully to ensure operations continue even if audit logging fails.
   * 
   * @param action - The type of action performed (create, update, delete)
   * @param collectionName - Name of the collection containing the modified document
   * @param documentId - ID of the document that was modified
   * @param userContext - Optional user context for the operation
   * @param metadata - Additional metadata about the operation
   */
  async logOperation(
    action: AuditAction,
    collectionName: string,
    documentId: TRefId,
    userContext?: UserContext<TRefId>,
    metadata?: AuditLogMetadata
  ): Promise<void> {
    try {
      const auditLog: WithoutId<AuditLogDocument<TRefId>> = {
        ref: {
          collection: collectionName,
          id: documentId,
        },
        action,
        userId: userContext?.userId,
        timestamp: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata,
      };

      await this.auditCollection.insertOne(auditLog as any);
    } catch (error) {
      // Log error but don't throw to avoid breaking the main operation
      console.error('Failed to create audit log:', error);
    }
  }

  /**
   * Retrieves audit logs for a specific document from the MongoDB collection.
   * 
   * @param collectionName - Name of the collection containing the document
   * @param documentId - ID of the document to get audit logs for
   * @returns Promise resolving to array of audit log entries
   */
  async getAuditLogs(
    collectionName: string,
    documentId: TRefId
  ): Promise<AuditLogDocument<TRefId>[]> {
    try {
      const auditLogs = await this.auditCollection
        .find({
          'ref.collection': collectionName,
          'ref.id': documentId,
        } as any)
        .sort({ timestamp: 1 })
        .toArray();

      return auditLogs as AuditLogDocument<TRefId>[];
    } catch (error) {
      console.error('Failed to retrieve audit logs:', error);
      return [];
    }
  }

  /**
   * Returns the MongoDB audit collection instance.
   * 
   * @returns The audit collection instance
   */
  getAuditCollection(): Collection<AuditLogDocument<TRefId>> {
    return this.auditCollection;
  }

  /**
   * Always returns true since this logger performs audit logging.
   * 
   * @returns True indicating audit logging is enabled
   */
  isEnabled(): boolean {
    return true;
  }
}

/**
 * No-operation audit logger that disables all audit functionality.
 * Uses the null object pattern to provide a consistent interface when auditing is disabled.
 */
export class NoOpAuditLogger extends AuditLogger<any> {
  /**
   * No-op implementation that does nothing.
   */
  async logOperation(): Promise<void> {
    // Intentionally empty - no audit logging performed
  }

  /**
   * Returns empty array since no audit logs are stored.
   */
  async getAuditLogs(): Promise<AuditLogDocument<any>[]> {
    return [];
  }

  /**
   * Returns null since there is no audit collection.
   */
  getAuditCollection(): null {
    return null;
  }

  /**
   * Always returns false since auditing is disabled.
   */
  isEnabled(): boolean {
    return false;
  }
}