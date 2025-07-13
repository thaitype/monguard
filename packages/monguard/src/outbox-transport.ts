/**
 * @fileoverview Outbox transport interfaces and implementations for audit logging patterns.
 */

import type { Collection, Db, WithoutId } from './mongodb-types';
import type { AuditAction, UserContext, DefaultReferenceId } from './types';
import type { AuditLogMetadata } from './audit-logger';

/**
 * Represents an audit event that can be queued in an outbox for later processing.
 * @template TRefId - The type used for document reference IDs
 */
export interface AuditEvent<TRefId = DefaultReferenceId> {
  /** Unique identifier for this audit event */
  id: string;
  /** The type of action performed (create, update, delete, etc.) */
  action: AuditAction;
  /** Name of the collection containing the modified document */
  collectionName: string;
  /** ID of the document that was modified */
  documentId: TRefId;
  /** Optional user context for the operation */
  userContext?: UserContext<TRefId>;
  /** Additional metadata about the operation */
  metadata?: AuditLogMetadata;
  /** Timestamp when the event was created */
  timestamp: Date;
  /** Optional trace ID for request tracking */
  traceId?: string;
  /** Number of processing attempts (for retry logic) */
  retryCount?: number;
  /** Timestamp when the event was last processed */
  lastProcessedAt?: Date;
}

/**
 * Interface for outbox transport implementations that handle queuing and processing of audit events.
 * This interface allows applications to implement their own outbox patterns using different storage
 * backends (MongoDB, Redis, cloud storage, etc.).
 *
 * @template TRefId - The type used for document reference IDs
 */
export interface OutboxTransport<TRefId = DefaultReferenceId> {
  /**
   * Enqueues an audit event for later processing.
   * This method is always required and should be atomic with the main operation.
   *
   * @param event - The audit event to enqueue
   * @returns Promise that resolves when the event is successfully enqueued
   * @throws Error if the enqueue operation fails
   */
  enqueue(event: AuditEvent<TRefId>): Promise<void>;

  /**
   * Dequeues a batch of audit events for processing.
   * This method is optional and intended for application-level workers.
   *
   * @param limit - Maximum number of events to dequeue (default: 10)
   * @returns Promise resolving to array of events ready for processing
   */
  dequeue?(limit?: number): Promise<AuditEvent<TRefId>[]>;

  /**
   * Acknowledges that an audit event has been successfully processed.
   * This method is optional and intended for application-level workers.
   *
   * @param eventId - ID of the event to acknowledge
   * @returns Promise that resolves when the event is acknowledged
   */
  ack?(eventId: string): Promise<void>;

  /**
   * Marks an audit event as failed and optionally moves it to a dead letter queue.
   * This method is optional and intended for application-level workers.
   *
   * @param eventId - ID of the event that failed
   * @param error - The error that caused the failure
   * @returns Promise that resolves when the failure is recorded
   */
  fail?(eventId: string, error: Error): Promise<void>;

  /**
   * Gets the current queue depth (number of pending events).
   * This method is optional and intended for monitoring purposes.
   *
   * @returns Promise resolving to the number of pending events
   */
  getQueueDepth?(): Promise<number>;
}

/**
 * Configuration options for the MongoDB outbox transport.
 */
export interface MongoOutboxTransportOptions {
  /** Name of the outbox collection (default: 'audit_outbox') */
  outboxCollectionName?: string;
  /** Name of the dead letter collection (default: 'audit_dead_letter') */
  deadLetterCollectionName?: string;
  /** Maximum number of retry attempts before moving to dead letter (default: 3) */
  maxRetryAttempts?: number;
}

/**
 * MongoDB-based implementation of the outbox transport pattern.
 * Stores audit events in a MongoDB collection for later processing by application workers.
 *
 * @template TRefId - The type used for document reference IDs
 */
export class MongoOutboxTransport<TRefId = DefaultReferenceId> implements OutboxTransport<TRefId> {
  private outboxCollection: Collection<AuditEvent<TRefId>>;
  private deadLetterCollection: Collection<AuditEvent<TRefId>>;
  private maxRetryAttempts: number;

  /**
   * Creates a new MongoDB outbox transport instance.
   *
   * @param db - MongoDB database instance
   * @param options - Configuration options for the transport
   */
  constructor(db: Db, options: MongoOutboxTransportOptions = {}) {
    const outboxCollectionName = options.outboxCollectionName || 'audit_outbox';
    const deadLetterCollectionName = options.deadLetterCollectionName || 'audit_dead_letter';

    this.outboxCollection = db.collection<AuditEvent<TRefId>>(outboxCollectionName) as Collection<AuditEvent<TRefId>>;
    this.deadLetterCollection = db.collection<AuditEvent<TRefId>>(deadLetterCollectionName) as Collection<
      AuditEvent<TRefId>
    >;
    this.maxRetryAttempts = options.maxRetryAttempts || 3;
  }

  /**
   * Enqueues an audit event in the MongoDB outbox collection.
   *
   * @param event - The audit event to enqueue
   * @returns Promise that resolves when the event is successfully stored
   */
  async enqueue(event: AuditEvent<TRefId>): Promise<void> {
    const outboxEvent: WithoutId<AuditEvent<TRefId>> = {
      ...event,
      retryCount: 0,
      timestamp: event.timestamp || new Date(),
    };

    await this.outboxCollection.insertOne(outboxEvent as any);
  }

  /**
   * Dequeues a batch of audit events from the outbox for processing.
   * Only returns events that haven't exceeded the maximum retry attempts.
   *
   * @param limit - Maximum number of events to return (default: 10)
   * @returns Promise resolving to array of events ready for processing
   */
  async dequeue(limit: number = 10): Promise<AuditEvent<TRefId>[]> {
    const events = await this.outboxCollection
      .find({
        $or: [{ retryCount: { $exists: false } }, { retryCount: { $lt: this.maxRetryAttempts } }],
      })
      .sort({ timestamp: 1 }) // Process oldest events first
      .limit(limit)
      .toArray();

    return events as AuditEvent<TRefId>[];
  }

  /**
   * Acknowledges successful processing of an audit event by removing it from the outbox.
   *
   * @param eventId - ID of the event to acknowledge
   * @returns Promise that resolves when the event is removed
   */
  async ack(eventId: string): Promise<void> {
    await this.outboxCollection.deleteOne({ id: eventId } as any);
  }

  /**
   * Marks an audit event as failed and increments its retry count.
   * If the event has exceeded maximum retry attempts, moves it to the dead letter collection.
   *
   * @param eventId - ID of the event that failed
   * @param error - The error that caused the failure
   * @returns Promise that resolves when the failure is recorded
   */
  async fail(eventId: string, error: Error): Promise<void> {
    const event = await this.outboxCollection.findOne({ id: eventId } as any);

    if (!event) {
      return; // Event doesn't exist, nothing to do
    }

    const currentRetryCount = (event.retryCount || 0) + 1;

    if (currentRetryCount >= this.maxRetryAttempts) {
      // Move to dead letter collection
      const deadLetterEvent = {
        ...event,
        retryCount: currentRetryCount,
        lastProcessedAt: new Date(),
        error: {
          message: error.message,
          stack: error.stack,
          timestamp: new Date(),
        },
      };

      await this.deadLetterCollection.insertOne(deadLetterEvent as any);
      await this.outboxCollection.deleteOne({ id: eventId } as any);
    } else {
      // Increment retry count
      await this.outboxCollection.updateOne({ id: eventId } as any, {
        $set: {
          retryCount: currentRetryCount,
          lastProcessedAt: new Date(),
        },
      });
    }
  }

  /**
   * Gets the current number of pending events in the outbox.
   *
   * @returns Promise resolving to the count of pending events
   */
  async getQueueDepth(): Promise<number> {
    return await this.outboxCollection.countDocuments({
      $or: [{ retryCount: { $exists: false } }, { retryCount: { $lt: this.maxRetryAttempts } }],
    });
  }

  /**
   * Gets the underlying outbox collection for advanced operations.
   *
   * @returns The MongoDB collection storing outbox events
   */
  getOutboxCollection(): Collection<AuditEvent<TRefId>> {
    return this.outboxCollection;
  }

  /**
   * Gets the underlying dead letter collection for monitoring failed events.
   *
   * @returns The MongoDB collection storing failed events
   */
  getDeadLetterCollection(): Collection<AuditEvent<TRefId>> {
    return this.deadLetterCollection;
  }
}
