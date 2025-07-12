import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestDatabase } from '../setup';
import { MonguardCollection } from '../../src/monguard-collection';
import { MonguardAuditLogger } from '../../src/audit-logger';
import { MongoOutboxTransport } from '../../src/outbox-transport';
import { TestDataFactory, TestUser } from '../factories';
import { adaptDb } from '../mongodb-adapter';
import type { Db } from '../../src/mongodb-types';

describe('Outbox Audit Integration Tests', () => {
  let testDb: TestDatabase;
  let db: Db;
  let outboxTransport: MongoOutboxTransport;
  let auditLogger: MonguardAuditLogger;
  let collection: MonguardCollection<TestUser>;

  beforeEach(async () => {
    testDb = new TestDatabase();
    const mongoDb = await testDb.start();
    db = adaptDb(mongoDb);
    
    // Setup outbox transport
    outboxTransport = new MongoOutboxTransport(db, {
      outboxCollectionName: 'test_outbox',
      deadLetterCollectionName: 'test_dead_letter'
    });
    
    // Setup audit logger with outbox transport
    auditLogger = new MonguardAuditLogger(db, 'test_audit_logs', {
      outboxTransport
    });
    
    // Setup collection with outbox mode
    collection = new MonguardCollection<TestUser>(db, 'test_users', {
      auditLogger,
      concurrency: { transactionsEnabled: true },
      auditControl: {
        mode: 'outbox',
        failOnError: false,
        logFailedAttempts: true
      }
    });
  });

  afterEach(async () => {
    await testDb.stop();
  });

  describe('Outbox Mode Audit Logging', () => {
    it('should enqueue audit events instead of writing directly to audit collection', async () => {
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      // Create a document - should enqueue audit event
      const result = await collection.create(userData, { userContext });

      // Check that no audit logs were written directly
      const auditLogs = await auditLogger.getAuditCollection().find({}).toArray();
      expect(auditLogs).toHaveLength(0);

      // Check that audit event was enqueued
      const queueDepth = await outboxTransport.getQueueDepth();
      expect(queueDepth).toBe(1);

      // Verify the enqueued event content
      const enqueuedEvents = await outboxTransport.dequeue(5);
      expect(enqueuedEvents).toHaveLength(1);
      expect(enqueuedEvents[0].action).toBe('create');
      expect(enqueuedEvents[0].collectionName).toBe('test_users');
      expect(enqueuedEvents[0].documentId.toString()).toBe(result._id.toString());
      expect(enqueuedEvents[0].userContext?.userId.toString()).toBe(userContext.userId.toString());
      expect(enqueuedEvents[0].metadata?.after).toBeDefined();
    });

    it('should handle multiple operations with outbox queuing', async () => {
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      // Create document
      const createResult = await collection.create(userData, { userContext });

      // Update document
      await collection.updateById(createResult._id, { $set: { name: 'Updated Name' } }, { userContext });

      // Soft delete document
      await collection.deleteById(createResult._id, { userContext });

      // Check that no audit logs were written directly
      const auditLogs = await auditLogger.getAuditCollection().find({}).toArray();
      expect(auditLogs).toHaveLength(0);

      // Check that all 3 operations were enqueued
      const queueDepth = await outboxTransport.getQueueDepth();
      expect(queueDepth).toBe(3);

      // Verify the sequence of operations
      const enqueuedEvents = await outboxTransport.dequeue(5);
      expect(enqueuedEvents).toHaveLength(3);
      expect(enqueuedEvents[0].action).toBe('create');
      expect(enqueuedEvents[1].action).toBe('update');
      expect(enqueuedEvents[2].action).toBe('delete');
    });

    it('should fall back to in-transaction mode when outbox transport fails', async () => {
      // Create a collection without outbox transport but requesting outbox mode
      const collectionWithoutOutbox = new MonguardCollection<TestUser>(db, 'test_users_fallback', {
        auditLogger: new MonguardAuditLogger(db, 'fallback_audit_logs'), // No outbox transport
        concurrency: { transactionsEnabled: true },
        auditControl: {
          mode: 'outbox',
          failOnError: false,
          logFailedAttempts: true
        }
      });

      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      // This should succeed despite outbox mode, falling back to in-transaction
      const result = await collectionWithoutOutbox.create(userData, { userContext });
      expect(result._id).toBeDefined();

      // Check that audit log was written directly (fallback behavior)
      const auditLogs = await collectionWithoutOutbox.getAuditCollection()!.find({}).toArray();
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].action).toBe('create');
    });

    it('should process outbox events and create actual audit logs', async () => {
      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      // Create document - should enqueue audit event
      const result = await collection.create(userData, { userContext });

      // Verify event is in outbox
      expect(await outboxTransport.getQueueDepth()).toBe(1);

      // Simulate outbox processor: dequeue and process events
      const enqueuedEvents = await outboxTransport.dequeue(5);
      expect(enqueuedEvents).toHaveLength(1);

      // Process the event (simulate what an actual worker would do)
      const event = enqueuedEvents[0];
      const auditLogData = {
        ref: {
          collection: event.collectionName,
          id: event.documentId
        },
        action: event.action,
        userId: event.userContext?.userId,
        timestamp: event.timestamp,
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: event.metadata
      };

      // Write to audit collection
      await auditLogger.getAuditCollection().insertOne(auditLogData as any);

      // Acknowledge the event
      await outboxTransport.ack(event.id);

      // Verify audit log was created
      const auditLogs = await auditLogger.getAuditCollection().find({}).toArray();
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].action).toBe('create');
      expect(auditLogs[0].ref.id.toString()).toBe(result._id.toString());

      // Verify event was removed from outbox
      expect(await outboxTransport.getQueueDepth()).toBe(0);
    });

    it('should handle error scenarios in outbox mode', async () => {
      // Create a custom outbox transport that throws errors
      const faultyTransport = new (class extends MongoOutboxTransport {
        async enqueue(): Promise<void> {
          throw new Error('Outbox service unavailable');
        }
      })(db);

      const faultyAuditLogger = new MonguardAuditLogger(db, 'faulty_audit_logs', {
        outboxTransport: faultyTransport
      });

      const faultyCollection = new MonguardCollection<TestUser>(db, 'test_users_faulty', {
        auditLogger: faultyAuditLogger,
        concurrency: { transactionsEnabled: true },
        auditControl: {
          mode: 'outbox',
          failOnError: false, // Don't fail on audit errors
          logFailedAttempts: true
        }
      });

      const userData = TestDataFactory.createUser();
      const userContext = TestDataFactory.createUserContext();

      // This should succeed despite outbox failure because failOnError is false
      const result = await faultyCollection.create(userData, { userContext });
      expect(result._id).toBeDefined();

      // Document should be created even though audit failed
      const createdDoc = await faultyCollection.findById(result._id);
      expect(createdDoc).not.toBeNull();
      expect(createdDoc!.name).toBe(userData.name);
    });
  });

  describe('Configuration Validation', () => {
    it('should throw error when outbox mode is requested without outbox transport in strict mode', () => {
      expect(() => {
        new MonguardCollection<TestUser>(db, 'test_users_invalid', {
          auditLogger: new MonguardAuditLogger(db, 'invalid_audit_logs'), // No outbox transport
          concurrency: { transactionsEnabled: true },
          auditControl: {
            mode: 'outbox',
            failOnError: true // This should cause validation to fail
          }
        });
      }).toThrow('Outbox transport is required when audit control mode is "outbox"');
    });

    it('should allow outbox mode with NoOpAuditLogger', () => {
      expect(() => {
        new MonguardCollection<TestUser>(db, 'test_users_noop', {
          // No auditLogger provided - will use NoOpAuditLogger
          concurrency: { transactionsEnabled: true },
          auditControl: {
            mode: 'outbox' // This should be fine with NoOpAuditLogger
          }
        });
      }).not.toThrow();
    });
  });

  describe('Mode Switching', () => {
    it('should work correctly when switching from outbox to in-transaction mode', async () => {
      const userData1 = TestDataFactory.createUser({ name: 'User 1' });
      const userData2 = TestDataFactory.createUser({ name: 'User 2' });
      const userContext = TestDataFactory.createUserContext();

      // Create first document with outbox mode
      await collection.create(userData1, { userContext });
      expect(await outboxTransport.getQueueDepth()).toBe(1);

      // Create collection with in-transaction mode
      const inTransactionCollection = new MonguardCollection<TestUser>(db, 'test_users', {
        auditLogger: new MonguardAuditLogger(db, 'in_transaction_audit_logs'),
        concurrency: { transactionsEnabled: true },
        auditControl: {
          mode: 'inTransaction',
          failOnError: false
        }
      });

      // Create second document with in-transaction mode
      await inTransactionCollection.create(userData2, { userContext });

      // Check outbox queue unchanged
      expect(await outboxTransport.getQueueDepth()).toBe(1);

      // Check that second audit log was written directly
      const directAuditLogs = await inTransactionCollection.getAuditCollection()!.find({}).toArray();
      expect(directAuditLogs).toHaveLength(1);
      expect(directAuditLogs[0].action).toBe('create');
    });
  });
});