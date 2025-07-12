import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestDatabase } from '../setup';
import { MongoOutboxTransport, type AuditEvent } from '../../src/outbox-transport';
import { adaptDb } from '../mongodb-adapter';
import type { Db } from '../../src/mongodb-types';

describe('MongoOutboxTransport', () => {
  let testDb: TestDatabase;
  let db: Db;
  let transport: MongoOutboxTransport;

  beforeEach(async () => {
    testDb = new TestDatabase();
    const mongoDb = await testDb.start();
    db = adaptDb(mongoDb);
    transport = new MongoOutboxTransport(db);
  });

  afterEach(async () => {
    await testDb.stop();
  });

  describe('Basic Outbox Operations', () => {
    it('should enqueue an audit event', async () => {
      const event: AuditEvent = {
        id: 'test-event-1',
        action: 'create',
        collectionName: 'test_users',
        documentId: '507f1f77bcf86cd799439011',
        userContext: { userId: 'user123' },
        metadata: { after: { name: 'Test User' } },
        timestamp: new Date(),
        retryCount: 0,
      };

      await transport.enqueue(event);

      // Verify event was stored
      const queueDepth = await transport.getQueueDepth();
      expect(queueDepth).toBe(1);
    });

    it('should dequeue audit events', async () => {
      const events: AuditEvent[] = [
        {
          id: 'test-event-1',
          action: 'create',
          collectionName: 'test_users',
          documentId: '507f1f77bcf86cd799439011',
          timestamp: new Date(),
          retryCount: 0,
        },
        {
          id: 'test-event-2',
          action: 'update',
          collectionName: 'test_users',
          documentId: '507f1f77bcf86cd799439012',
          timestamp: new Date(),
          retryCount: 0,
        },
      ];

      // Enqueue events
      for (const event of events) {
        await transport.enqueue(event);
      }

      // Dequeue events
      const dequeuedEvents = await transport.dequeue(5);
      expect(dequeuedEvents).toHaveLength(2);
      expect(dequeuedEvents[0]!.id).toBe('test-event-1');
      expect(dequeuedEvents[1]!.id).toBe('test-event-2');
    });

    it('should acknowledge processed events', async () => {
      const event: AuditEvent = {
        id: 'test-event-1',
        action: 'create',
        collectionName: 'test_users',
        documentId: '507f1f77bcf86cd799439011',
        timestamp: new Date(),
        retryCount: 0,
      };

      await transport.enqueue(event);
      expect(await transport.getQueueDepth()).toBe(1);

      await transport.ack('test-event-1');
      expect(await transport.getQueueDepth()).toBe(0);
    });

    it('should handle event failures with retry logic', async () => {
      const event: AuditEvent = {
        id: 'test-event-1',
        action: 'create',
        collectionName: 'test_users',
        documentId: '507f1f77bcf86cd799439011',
        timestamp: new Date(),
        retryCount: 0,
      };

      await transport.enqueue(event);

      // Simulate failure
      await transport.fail('test-event-1', new Error('Processing failed'));

      // Event should still be in queue with incremented retry count
      const events = await transport.dequeue(5);
      expect(events).toHaveLength(1);
      expect(events[0]!.retryCount).toBe(1);
    });

    it('should move events to dead letter queue after max retries', async () => {
      // Create transport with max 2 retries for testing
      const testTransport = new MongoOutboxTransport(db, { maxRetryAttempts: 2 });

      const event: AuditEvent = {
        id: 'test-event-1',
        action: 'create',
        collectionName: 'test_users',
        documentId: '507f1f77bcf86cd799439011',
        timestamp: new Date(),
        retryCount: 0,
      };

      await testTransport.enqueue(event);

      // Fail event twice (to reach max retries)
      await testTransport.fail('test-event-1', new Error('First failure'));
      await testTransport.fail('test-event-1', new Error('Second failure'));

      // Event should now be in dead letter queue
      expect(await testTransport.getQueueDepth()).toBe(0);

      // Check dead letter collection has the event
      const deadLetterEvents = await testTransport.getDeadLetterCollection().find({}).toArray();
      expect(deadLetterEvents).toHaveLength(1);
      expect(deadLetterEvents[0]!.id).toBe('test-event-1');
      expect(deadLetterEvents[0]!.retryCount).toBe(2);
    });

    it('should respect dequeue limit parameter', async () => {
      // Enqueue 5 events
      for (let i = 1; i <= 5; i++) {
        await transport.enqueue({
          id: `test-event-${i}`,
          action: 'create',
          collectionName: 'test_users',
          documentId: `507f1f77bcf86cd79943901${i}`,
          timestamp: new Date(),
          retryCount: 0,
        });
      }

      // Dequeue only 3 events
      const events = await transport.dequeue(3);
      expect(events).toHaveLength(3);
      expect(await transport.getQueueDepth()).toBe(5); // All events still in queue until acked
    });

    it('should process events in FIFO order', async () => {
      const timestamps = [
        new Date('2023-01-01T10:00:00Z'),
        new Date('2023-01-01T10:01:00Z'),
        new Date('2023-01-01T10:02:00Z'),
      ];

      // Enqueue events with different timestamps
      for (let i = 0; i < 3; i++) {
        await transport.enqueue({
          id: `test-event-${i + 1}`,
          action: 'create',
          collectionName: 'test_users',
          documentId: `507f1f77bcf86cd79943901${i + 1}`,
          timestamp: timestamps[i]!,
          retryCount: 0,
        });
      }

      const events = await transport.dequeue(3);
      expect(events[0]!.id).toBe('test-event-1'); // Oldest timestamp
      expect(events[1]!.id).toBe('test-event-2');
      expect(events[2]!.id).toBe('test-event-3');
    });

    it('should handle fail operation for non-existent event', async () => {
      // Try to fail an event that doesn't exist
      await expect(transport.fail('non-existent-event-id', new Error('Some error'))).resolves.toBeUndefined();

      // Should not affect queue depth
      expect(await transport.getQueueDepth()).toBe(0);

      // Should not create any dead letter entries
      const deadLetterEvents = await transport.getDeadLetterCollection().find({}).toArray();
      expect(deadLetterEvents).toHaveLength(0);
    });
  });

  describe('Collection Access', () => {
    it('should provide access to outbox collection', () => {
      const outboxCollection = transport.getOutboxCollection();
      expect(outboxCollection).toBeDefined();
      expect(typeof outboxCollection.insertOne).toBe('function');
    });

    it('should provide access to dead letter collection', () => {
      const deadLetterCollection = transport.getDeadLetterCollection();
      expect(deadLetterCollection).toBeDefined();
      expect(typeof deadLetterCollection.insertOne).toBe('function');
    });
  });
});
