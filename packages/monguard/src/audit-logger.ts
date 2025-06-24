/**
 * @fileoverview Audit logging interfaces and implementations for tracking document changes.
 */

import type { Collection, WithoutId, Db, ObjectId } from './mongodb-types';
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
 * Logger interface for configurable error and warning handling.
 */
export interface Logger {
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}

/**
 * Default console-based logger implementation.
 */
export const ConsoleLogger: Logger = {
  warn: (message: string, ...args: any[]) => console.warn(message, ...args),
  error: (message: string, ...args: any[]) => console.error(message, ...args)
};

/**
 * Configuration for reference ID validation and conversion.
 * @template TRefId - The type used for document reference IDs
 */
export interface RefIdConfig<TRefId = any> {
  /** Function to validate if a value is of the expected reference ID type */
  validateRefId?: (refId: any) => refId is TRefId;
  /** Human-readable type name for error messages */
  typeName?: string;
  /** Function to convert document IDs to reference ID type (user-controlled) */
  convertRefId?: (documentId: any) => TRefId;
}

/**
 * Pre-configured RefIdConfig instances for common types.
 */
export const RefIdConfigs = {
  /**
   * Configuration for ObjectId reference IDs with validation-only approach.
   * Does not perform conversion - users must handle conversion themselves.
   */
  objectId: (): RefIdConfig<ObjectId> => ({
    validateRefId: (refId: any): refId is any => {
      // Validate ObjectId without importing mongodb driver
      // Check for ObjectId-like structure: 12-byte hex string or object with toHexString method
      if (typeof refId === 'string' && /^[0-9a-fA-F]{24}$/.test(refId)) {
        return true;
      }
      if (refId && typeof refId === 'object' && typeof refId.toHexString === 'function') {
        return true;
      }
      return false;
    },
    typeName: 'ObjectId'
  }),

  /**
   * Configuration for string reference IDs.
   */
  string: (): RefIdConfig<string> => ({
    validateRefId: (refId: any): refId is string => typeof refId === 'string',
    typeName: 'string'
  }),

  /**
   * Configuration for number reference IDs.
   */
  number: (): RefIdConfig<number> => ({
    validateRefId: (refId: any): refId is number => typeof refId === 'number',
    typeName: 'number'
  })
};

/**
 * Options for configuring a MonguardAuditLogger instance.
 * @template TRefId - The type used for document reference IDs
 */
export interface MonguardAuditLoggerOptions<TRefId = any> {
  /** Configuration for reference ID validation and conversion */
  refIdConfig?: RefIdConfig<TRefId>;
  /** Custom logger for error and warning messages */
  logger?: Logger;
  /** If true, validation failures throw errors; if false, they warn (default: false) */
  strictValidation?: boolean;
  // Reserved for future extensibility
  // Could include options like:
  // - Custom timestamp field names
  // - Custom metadata handling
  // - Batch logging configuration
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
  private refIdConfig?: RefIdConfig<TRefId>;
  private logger: Logger;
  private strictValidation: boolean;

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
    this.refIdConfig = options?.refIdConfig;
    this.logger = options?.logger || ConsoleLogger;
    this.strictValidation = options?.strictValidation ?? false;
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
      // Process reference ID through config if available
      let processedRefId = documentId;
      if (this.refIdConfig?.convertRefId) {
        processedRefId = this.refIdConfig.convertRefId(documentId);
      }

      // Validate reference ID if validation is configured
      if (this.refIdConfig?.validateRefId && !this.refIdConfig.validateRefId(processedRefId)) {
        const errorMessage = `Invalid reference ID type for audit log. Expected ${this.refIdConfig.typeName || 'valid type'}, got: ${typeof processedRefId}`;

        if (this.strictValidation) {
          throw new Error(errorMessage);
        } else {
          this.logger.warn(errorMessage, processedRefId);
        }
      }

      const auditLog: WithoutId<AuditLogDocument<TRefId>> = {
        ref: {
          collection: collectionName,
          id: processedRefId,
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
      // Only catch database errors, not validation errors
      if (error instanceof Error && error.message.includes('Invalid reference ID type')) {
        throw error; // Re-throw validation errors
      }
      // Log error but don't throw to avoid breaking the main operation
      this.logger.error('Failed to create audit log:', error);
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
      this.logger.error('Failed to retrieve audit logs:', error);
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
  async logOperation(
    action: AuditAction,
    collectionName: string,
    documentId: any,
    userContext?: UserContext<any>,
    metadata?: AuditLogMetadata
  ): Promise<void> {
    // Intentionally empty - no audit logging performed
  }

  /**
   * Returns empty array since no audit logs are stored.
   */
  async getAuditLogs(
    collectionName: string,
    documentId: any
  ): Promise<AuditLogDocument<any>[]> {
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