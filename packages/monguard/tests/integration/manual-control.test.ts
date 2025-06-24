/**
 * @fileoverview Integration tests for manual auto-field and audit control functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectId as MongoObjectId, Db as MongoDb } from 'mongodb';
import { MonguardCollection } from '../../src/monguard-collection';
import { MonguardAuditLogger } from '../../src/audit-logger';
import { TestDatabase } from '../setup';
import { adaptDb } from '../mongodb-adapter';
import type { TestUser, TestUserReference } from '../factories';
import type { AuditableDocument, AutoFieldUpdateOptions, ManualAuditOptions } from '../../src/types';
import type { Db } from '../../src/mongodb-types';

interface TestDocument extends AuditableDocument<TestUserReference> {
  name: string;
  email: string;
}

describe('Manual Control Functionality', () => {
  let testDb: TestDatabase;
  let mongoDb: MongoDb;
  let db: Db;
  let collection: MonguardCollection<TestDocument, TestUserReference>;
  let auditLogger: MonguardAuditLogger<TestUserReference>;

  beforeEach(async () => {
    testDb = new TestDatabase();
    mongoDb = await testDb.start();
    db = adaptDb(mongoDb);
    
    // Clean up collections
    await db.collection('test_documents').deleteMany({});
    await db.collection('audit_logs').deleteMany({});
    
    auditLogger = new MonguardAuditLogger<TestUserReference>(db, 'audit_logs');
    
    collection = new MonguardCollection<TestDocument, TestUserReference>(
      db,
      'test_documents',
      {
        auditLogger,
        concurrency: { transactionsEnabled: false },
        autoFieldControl: {
          enableAutoTimestamps: true,
          enableAutoUserTracking: true,
        },
        auditControl: {
          enableAutoAudit: true,
          auditCustomOperations: true,
        },
      }
    );
  });

  afterEach(async () => {
    await testDb.stop();
  });

  describe('updateAutoFields', () => {
    it('should manually set create fields', () => {
      const doc: any = { 
        name: 'John', 
        email: 'john@example.com',
        createdBy: undefined, // Add fields that will be populated
        updatedBy: undefined,
      };
      const userContext = { userId: 'user123' };
      
      const result = collection.updateAutoFields(doc, {
        operation: 'create',
        userContext,
      });

      expect(result.name).toBe('John');
      expect(result.email).toBe('john@example.com');
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
      expect(result.createdBy).toBe('user123');
      expect(result.updatedBy).toBe('user123');
    });

    it('should manually set update fields', () => {
      const doc: any = { 
        name: 'John Updated', 
        email: 'john.updated@example.com',
        createdAt: new Date('2023-01-01'),
        createdBy: 'original_user',
        updatedBy: undefined, // Add field that will be populated
      };
      const userContext = { userId: 'user456' };
      
      const result = collection.updateAutoFields(doc, {
        operation: 'update',
        userContext,
      });

      expect(result.name).toBe('John Updated');
      expect(result.createdAt).toEqual(new Date('2023-01-01')); // Should not change
      expect(result.createdBy).toBe('original_user'); // Should not change
      expect(result.updatedAt).toBeInstanceOf(Date);
      expect(result.updatedBy).toBe('user456');
    });

    it('should manually set delete fields', () => {
      const doc: any = { 
        name: 'John', 
        email: 'john@example.com',
        createdAt: new Date('2023-01-01'),
        updatedAt: new Date('2023-06-01'),
        deletedBy: undefined, // Add fields that will be populated
        updatedBy: undefined,
      };
      const userContext = { userId: 'admin789' };
      
      const result = collection.updateAutoFields(doc, {
        operation: 'delete',
        userContext,
      });

      expect(result.deletedAt).toBeInstanceOf(Date);
      expect(result.deletedBy).toBe('admin789');
      expect(result.updatedAt).toBeInstanceOf(Date);
      expect(result.updatedBy).toBe('admin789');
    });

    it('should respect custom timestamp', () => {
      const customTime = new Date('2023-12-25T10:00:00Z');
      const doc: any = { name: 'John', email: 'john@example.com' };
      
      const result = collection.updateAutoFields(doc, {
        operation: 'create',
        customTimestamp: customTime,
      });

      expect(result.createdAt).toEqual(customTime);
      expect(result.updatedAt).toEqual(customTime);
    });

    it('should respect field-specific control', () => {
      const doc: any = { 
        name: 'John', 
        email: 'john@example.com',
        createdBy: undefined, // Add fields that might be populated
        updatedBy: undefined,
      };
      const userContext = { userId: 'user123' };
      
      const result = collection.updateAutoFields(doc, {
        operation: 'custom',
        userContext,
        fields: {
          createdAt: true,
          createdBy: true,
          updatedAt: false, // Should not be set
          updatedBy: false, // Should not be set
        },
      });

      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.createdBy).toBe('user123');
      expect(result.updatedAt).toBeUndefined();
      expect(result.updatedBy).toBeUndefined();
    });
  });

  describe('Individual Field Setters', () => {
    it('should set created fields', () => {
      const doc: any = { 
        name: 'John', 
        email: 'john@example.com',
        createdBy: undefined, // Add field that will be populated
      };
      const userContext = { userId: 'user123' };
      const customTime = new Date('2023-01-01');
      
      collection.setCreatedFields(doc, userContext, customTime);

      expect(doc.createdAt).toEqual(customTime);
      expect(doc.createdBy).toBe('user123');
    });

    it('should set updated fields', () => {
      const doc: any = { 
        name: 'John Updated',
        createdAt: new Date('2023-01-01'),
        createdBy: 'original_user',
        updatedBy: undefined, // Add field that will be populated
      };
      const userContext = { userId: 'user456' };
      
      collection.setUpdatedFields(doc, userContext);

      expect(doc.updatedAt).toBeInstanceOf(Date);
      expect(doc.updatedBy).toBe('user456');
      expect(doc.createdAt).toEqual(new Date('2023-01-01')); // Should not change
      expect(doc.createdBy).toBe('original_user'); // Should not change
    });

    it('should set deleted fields', () => {
      const doc: any = { 
        name: 'John', 
        email: 'john@example.com',
        deletedBy: undefined, // Add fields that will be populated
        updatedBy: undefined,
      };
      const userContext = { userId: 'admin789' };
      
      collection.setDeletedFields(doc, userContext);

      expect(doc.deletedAt).toBeInstanceOf(Date);
      expect(doc.deletedBy).toBe('admin789');
      expect(doc.updatedAt).toBeInstanceOf(Date);
      expect(doc.updatedBy).toBe('admin789');
    });

    it('should clear deleted fields', () => {
      const doc: any = { 
        name: 'John',
        deletedAt: new Date('2023-06-01'),
        deletedBy: 'admin123',
        updatedBy: undefined, // Add field that will be populated
      };
      const userContext = { userId: 'admin456' };
      
      collection.clearDeletedFields(doc, userContext);

      expect(doc.deletedAt).toBeUndefined();
      expect(doc.deletedBy).toBeUndefined();
      expect(doc.updatedAt).toBeInstanceOf(Date);
      expect(doc.updatedBy).toBe('admin456');
    });
  });

  describe('Manual Audit Logging', () => {
    it('should create manual audit log', async () => {
      const docId = new MongoObjectId();
      const userContext = { userId: 'user123' };
      const beforeDoc = { name: 'John', email: 'john@example.com' };
      const afterDoc = { name: 'John Updated', email: 'john.updated@example.com' };
      
      await collection.createAuditLog(
        'custom',
        docId,
        userContext,
        {
          beforeDocument: beforeDoc,
          afterDocument: afterDoc,
          customData: { reason: 'manual_update' },
        }
      );

      const auditLogs = await auditLogger.getAuditLogs('test_documents', docId);
      expect(auditLogs).toHaveLength(1);
      
      const auditLog = auditLogs[0];
      expect(auditLog).toBeDefined();
      if (auditLog) {
        expect(auditLog.action).toBe('custom');
        expect(auditLog.userId).toBe('user123');
        expect(auditLog.metadata?.before).toEqual(beforeDoc);
        expect(auditLog.metadata?.after).toEqual(afterDoc);
        expect(auditLog.metadata?.customData).toEqual({ reason: 'manual_update' });
      }
    });

    it('should create batch audit logs', async () => {
      const doc1Id = new MongoObjectId();
      const doc2Id = new MongoObjectId();
      const userContext = { userId: 'user123' };
      
      await collection.createAuditLogs([
        {
          action: 'create',
          documentId: doc1Id,
          userContext,
          metadata: { afterDocument: { name: 'Doc1' } },
        },
        {
          action: 'update',
          documentId: doc2Id,
          userContext,
          metadata: { 
            beforeDocument: { name: 'Doc2 Old' },
            afterDocument: { name: 'Doc2 New' },
          },
        },
      ]);

      const audit1 = await auditLogger.getAuditLogs('test_documents', doc1Id);
      const audit2 = await auditLogger.getAuditLogs('test_documents', doc2Id);
      
      expect(audit1).toHaveLength(1);
      expect(audit1[0]).toBeDefined();
      if (audit1[0]) {
        expect(audit1[0].action).toBe('create');
      }
      expect(audit2).toHaveLength(1);
      expect(audit2[0]).toBeDefined();
      if (audit2[0]) {
        expect(audit2[0].action).toBe('update');
      }
    });

    it('should respect audit control configuration', async () => {
      // Create collection with audit disabled
      const disabledCollection = new MonguardCollection<TestDocument, TestUserReference>(
        db,
        'test_documents',
        {
          auditLogger,
          concurrency: { transactionsEnabled: false },
          auditControl: {
            enableAutoAudit: false,
            auditCustomOperations: false,
          },
        }
      );

      const docId = new MongoObjectId();
      
      // Should not create audit log when disabled
      await disabledCollection.createAuditLog('custom', docId, { userId: 'user123' });
      
      const auditLogs = await auditLogger.getAuditLogs('test_documents', docId);
      expect(auditLogs).toHaveLength(0);
    });
  });

  describe('Configuration Respect', () => {
    it('should respect disabled auto timestamps', () => {
      const disabledCollection = new MonguardCollection<TestDocument, TestUserReference>(
        db,
        'test_documents',
        {
          auditLogger,
          concurrency: { transactionsEnabled: false },
          autoFieldControl: {
            enableAutoTimestamps: false,
            enableAutoUserTracking: true,
          },
        }
      );

      const doc: any = { 
        name: 'John', 
        email: 'john@example.com',
        createdBy: undefined, // Add field that will be populated
      };
      const result = disabledCollection.updateAutoFields(doc, {
        operation: 'create',
        userContext: { userId: 'user123' },
      });

      expect(result.createdAt).toBeUndefined();
      expect(result.updatedAt).toBeUndefined();
      expect(result.createdBy).toBe('user123'); // User fields should still work
    });

    it('should respect disabled auto user tracking', () => {
      const disabledCollection = new MonguardCollection<TestDocument, TestUserReference>(
        db,
        'test_documents',
        {
          auditLogger,
          concurrency: { transactionsEnabled: false },
          autoFieldControl: {
            enableAutoTimestamps: true,
            enableAutoUserTracking: false,
          },
        }
      );

      const doc: any = { name: 'John', email: 'john@example.com' };
      const result = disabledCollection.updateAutoFields(doc, {
        operation: 'create',
        userContext: { userId: 'user123' },
      });

      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
      expect(result.createdBy).toBeUndefined();
      expect(result.updatedBy).toBeUndefined();
    });

    it('should use custom timestamp provider', () => {
      const customTime = new Date('2023-12-25T10:00:00Z');
      const customCollection = new MonguardCollection<TestDocument, TestUserReference>(
        db,
        'test_documents',
        {
          auditLogger,
          concurrency: { transactionsEnabled: false },
          autoFieldControl: {
            enableAutoTimestamps: true,
            enableAutoUserTracking: true,
            customTimestampProvider: () => customTime,
          },
        }
      );

      const doc: any = { name: 'John', email: 'john@example.com' };
      const result = customCollection.updateAutoFields(doc, {
        operation: 'create',
        userContext: { userId: 'user123' },
      });

      expect(result.createdAt).toEqual(customTime);
      expect(result.updatedAt).toEqual(customTime);
    });
  });
});