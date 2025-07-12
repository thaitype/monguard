/**
 * @fileoverview Audit logging interfaces and implementations for tracking document changes.
 */

import type { Collection, WithoutId, Db, ObjectId } from './mongodb-types';
import type { AuditLogDocument, AuditAction, UserContext, AuditControlOptions } from './types';
import type { OutboxTransport, AuditEvent } from './outbox-transport';
import { computeDelta, DEFAULT_DELTA_OPTIONS, type DeltaOptions } from './utils/delta-calculator';

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
  error: (message: string, ...args: any[]) => console.error(message, ...args),
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
    typeName: 'ObjectId',
  }),

  /**
   * Configuration for string reference IDs.
   */
  string: (): RefIdConfig<string> => ({
    validateRefId: (refId: any): refId is string => typeof refId === 'string',
    typeName: 'string',
  }),

  /**
   * Configuration for number reference IDs.
   */
  number: (): RefIdConfig<number> => ({
    validateRefId: (refId: any): refId is number => typeof refId === 'number',
    typeName: 'number',
  }),
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
  /** Outbox transport for handling 'outbox' mode audit logging */
  outboxTransport?: OutboxTransport<TRefId>;
  /** Storage mode configuration (default: 'delta') */
  storageMode?: 'full' | 'delta';
  /** Maximum depth for nested object diffing (default: 3) */
  maxDepth?: number;
  /** Array handling strategy (default: 'diff') */
  arrayHandling?: 'diff' | 'replace';
  /** Max array size for element-wise diffing (default: 20) */
  arrayDiffMaxSize?: number;
  /** Fields to exclude from delta computation */
  blacklist?: string[];
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
    metadata?: AuditLogMetadata,
    auditControl?: Pick<AuditControlOptions, 'mode' | 'failOnError' | 'logFailedAttempts' | 'storageMode'>
  ): Promise<void>;

  /**
   * Retrieves audit logs for a specific document.
   *
   * @param collectionName - Name of the collection containing the document
   * @param documentId - ID of the document to get audit logs for
   * @returns Promise resolving to array of audit log entries
   */
  abstract getAuditLogs(collectionName: string, documentId: TRefId): Promise<AuditLogDocument<TRefId>[]>;

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
  private outboxTransport?: OutboxTransport<TRefId>;
  private deltaOptions: Required<DeltaOptions>;
  private defaultStorageMode: 'full' | 'delta';

  /**
   * Creates a new MonguardAuditLogger instance.
   *
   * @param db - MongoDB database instance
   * @param collectionName - Name of the collection to store audit logs
   * @param options - Optional configuration for the audit logger
   */
  constructor(db: Db, collectionName: string, options?: MonguardAuditLoggerOptions<TRefId>) {
    super();
    this.auditCollection = db.collection<AuditLogDocument<TRefId>>(collectionName) as Collection<
      AuditLogDocument<TRefId>
    >;
    this.refIdConfig = options?.refIdConfig;
    this.logger = options?.logger || ConsoleLogger;
    this.strictValidation = options?.strictValidation ?? false;
    this.outboxTransport = options?.outboxTransport;
    this.defaultStorageMode = options?.storageMode ?? 'full';

    // Configure delta computation options
    this.deltaOptions = {
      ...DEFAULT_DELTA_OPTIONS,
      maxDepth: options?.maxDepth ?? DEFAULT_DELTA_OPTIONS.maxDepth,
      arrayHandling: options?.arrayHandling ?? DEFAULT_DELTA_OPTIONS.arrayHandling,
      arrayDiffMaxSize: options?.arrayDiffMaxSize ?? DEFAULT_DELTA_OPTIONS.arrayDiffMaxSize,
      blacklist: options?.blacklist ?? DEFAULT_DELTA_OPTIONS.blacklist,
    };
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
    metadata?: AuditLogMetadata,
    auditControl?: Pick<AuditControlOptions, 'mode' | 'failOnError' | 'logFailedAttempts' | 'storageMode'>
  ): Promise<void> {
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

    // Determine audit mode - default to 'inTransaction' if not specified
    const auditMode = auditControl?.mode || 'inTransaction';

    // Validate outbox transport is available when using outbox mode
    if (auditMode === 'outbox' && !this.outboxTransport) {
      const errorMessage = 'Outbox transport is required when audit control mode is "outbox"';

      if (auditControl?.logFailedAttempts) {
        this.logger.warn('Audit configuration error:', {
          action,
          collectionName,
          documentId: processedRefId,
          error: errorMessage,
        });
      }

      if (auditControl?.failOnError) {
        throw new Error(errorMessage);
      }

      // Fallback to in-transaction mode if outbox transport is not available
      this.logger.warn('Falling back to in-transaction mode due to missing outbox transport');
    }

    // Determine storage mode and process metadata
    const storageMode = auditControl?.storageMode ?? this.defaultStorageMode;
    const processedMetadata = this.processMetadata(metadata, action, storageMode);

    // Skip logging if processMetadata returned undefined (no meaningful changes in delta mode)
    if (processedMetadata === undefined) {
      return;
    }

    try {
      if (auditMode === 'outbox' && this.outboxTransport) {
        // Outbox mode: enqueue audit event for later processing
        const auditEvent: AuditEvent<TRefId> = {
          id: this.generateEventId(),
          action,
          collectionName,
          documentId: processedRefId,
          userContext,
          metadata: processedMetadata,
          timestamp: new Date(),
          retryCount: 0,
        };

        await this.outboxTransport.enqueue(auditEvent);
      } else {
        // In-transaction mode: write audit log directly to collection
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
          metadata: processedMetadata,
        };

        await this.auditCollection.insertOne(auditLog as any);
      }
    } catch (error) {
      // Log the error for debugging
      this.logger.error(`Failed to ${auditMode === 'outbox' ? 'enqueue audit event' : 'create audit log'}:`, error);

      // Log failed attempts if requested
      if (auditControl?.logFailedAttempts) {
        this.logger.warn('Audit failure logged for investigation:', {
          action,
          collectionName,
          documentId: processedRefId,
          mode: auditMode,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Respect failOnError setting - if true, re-throw to cause transaction rollback
      if (auditControl?.failOnError) {
        throw error;
      }

      // Default behavior: swallow error to avoid breaking main operation
    }
  }

  /**
   * Processes metadata based on storage mode and action type.
   *
   * @private
   * @param metadata - Original metadata
   * @param action - The audit action being performed
   * @param storageMode - Storage mode to use
   * @returns Processed metadata with delta computation if applicable
   */
  private processMetadata(
    metadata: AuditLogMetadata | undefined,
    action: AuditAction,
    storageMode: 'full' | 'delta'
  ): AuditLogMetadata | undefined {
    // If no metadata provided, start with empty metadata object
    const workingMetadata = metadata || {};

    // For CREATE and DELETE actions, always use full document storage
    if (action === 'create' || action === 'delete') {
      return {
        ...workingMetadata,
        storageMode: 'full',
      };
    }

    // For UPDATE actions, apply storage mode logic
    if (action === 'update' && storageMode === 'delta') {
      const { before, after } = workingMetadata;

      if (before !== undefined && after !== undefined) {
        // We have full metadata - compute delta changes
        const deltaResult = computeDelta(before, after, this.deltaOptions);

        if (deltaResult.hasChanges) {
          return {
            deltaChanges: deltaResult.changes,
            storageMode: 'delta',
            // Only store delta changes in delta mode - exclude before/after/changes for storage optimization
          };
        } else {
          // No meaningful changes when we have full metadata - skip audit logging entirely
          return undefined;
        }
      }

      // If before/after are undefined in delta mode, fall through to normal full mode logging
      // This handles direct API calls, unit tests, or cases where metadata is minimal
    }

    // For non-delta modes, use full storage mode
    return {
      ...workingMetadata,
      storageMode: 'full',
    };
  }

  /**
   * Generates a unique event ID for outbox audit events.
   *
   * @private
   * @returns A unique string identifier
   */
  private generateEventId(): string {
    // Use timestamp + random string for uniqueness
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 15);
    return `${timestamp}-${random}`;
  }

  /**
   * Retrieves audit logs for a specific document from the MongoDB collection.
   *
   * @param collectionName - Name of the collection containing the document
   * @param documentId - ID of the document to get audit logs for
   * @returns Promise resolving to array of audit log entries
   */
  async getAuditLogs(collectionName: string, documentId: TRefId): Promise<AuditLogDocument<TRefId>[]> {
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
    metadata?: AuditLogMetadata,
    auditControl?: Pick<AuditControlOptions, 'mode' | 'failOnError' | 'logFailedAttempts' | 'storageMode'>
  ): Promise<void> {
    // Intentionally empty - no audit logging performed
  }

  /**
   * Returns empty array since no audit logs are stored.
   */
  async getAuditLogs(collectionName: string, documentId: any): Promise<AuditLogDocument<any>[]> {
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
