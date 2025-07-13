/**
 * @fileoverview Unit tests for audit logger implementations and configuration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId as MongoObjectId } from 'mongodb';
import {
  MonguardAuditLogger,
  NoOpAuditLogger,
  RefIdConfigs,
  type Logger,
  type RefIdConfig,
  ConsoleLogger,
} from '../../src/audit-logger';
import type { Db, Collection } from '../../src/mongodb-types';
import type { AuditLogDocument } from '../../src/types';

// Mock database and collection
const createMockDb = (): Db => {
  const mockCollection = {
    insertOne: vi.fn().mockResolvedValue({ insertedId: new MongoObjectId() }),
    find: vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    }),
  } as any;

  return {
    collection: vi.fn().mockReturnValue(mockCollection),
  } as any;
};

// Mock logger for testing
const createMockLogger = (): Logger => ({
  warn: vi.fn(),
  error: vi.fn(),
});

describe('RefIdConfigs', () => {
  describe('objectId', () => {
    it('should validate ObjectId strings', () => {
      const config = RefIdConfigs.objectId();

      expect(config.validateRefId?.('507f1f77bcf86cd799439011')).toBe(true);
      expect(config.validateRefId?.('invalid-id')).toBe(false);
      expect(config.validateRefId?.('')).toBe(false);
      expect(config.validateRefId?.(null)).toBe(false);
      expect(config.validateRefId?.(undefined)).toBe(false);
    });

    it('should validate ObjectId objects', () => {
      const config = RefIdConfigs.objectId();
      const objectId = new MongoObjectId();

      expect(config.validateRefId?.(objectId)).toBe(true);
    });

    it('should have correct type name', () => {
      const config = RefIdConfigs.objectId();

      expect(config.typeName).toBe('ObjectId');
    });

    it('should not include logger or onValidationFailure properties', () => {
      const config = RefIdConfigs.objectId();

      expect(config).not.toHaveProperty('logger');
      expect(config).not.toHaveProperty('onValidationFailure');
    });
  });

  describe('string', () => {
    it('should validate string values', () => {
      const config = RefIdConfigs.string();

      expect(config.validateRefId?.('test-string')).toBe(true);
      expect(config.validateRefId?.('')).toBe(true);
      expect(config.validateRefId?.(123)).toBe(false);
      expect(config.validateRefId?.(null)).toBe(false);
      expect(config.validateRefId?.(undefined)).toBe(false);
      expect(config.validateRefId?.({})).toBe(false);
    });

    it('should have correct type name', () => {
      const config = RefIdConfigs.string();

      expect(config.typeName).toBe('string');
    });
  });

  describe('number', () => {
    it('should validate number values', () => {
      const config = RefIdConfigs.number();

      expect(config.validateRefId?.(123)).toBe(true);
      expect(config.validateRefId?.(0)).toBe(true);
      expect(config.validateRefId?.(-456)).toBe(true);
      expect(config.validateRefId?.(12.34)).toBe(true);
      expect(config.validateRefId?.('123')).toBe(false);
      expect(config.validateRefId?.(null)).toBe(false);
      expect(config.validateRefId?.(undefined)).toBe(false);
      expect(config.validateRefId?.({})).toBe(false);
    });

    it('should have correct type name', () => {
      const config = RefIdConfigs.number();

      expect(config.typeName).toBe('number');
    });
  });
});

describe('MonguardAuditLogger', () => {
  let mockDb: Db;
  let mockCollection: Collection<AuditLogDocument>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockCollection = mockDb.collection('audit_logs') as Collection<AuditLogDocument>;
  });

  describe('constructor', () => {
    it('should create logger with default options', () => {
      const logger = new MonguardAuditLogger(mockDb, 'audit_logs');

      expect(logger.isEnabled()).toBe(true);
      expect(logger.getAuditCollection()).toBe(mockCollection);
    });

    it('should accept custom logger', () => {
      const customLogger = createMockLogger();
      const logger = new MonguardAuditLogger(mockDb, 'audit_logs', {
        logger: customLogger,
      });

      expect(logger.isEnabled()).toBe(true);
    });

    it('should accept refIdConfig', () => {
      const logger = new MonguardAuditLogger(mockDb, 'audit_logs', {
        refIdConfig: RefIdConfigs.string(),
      });

      expect(logger.isEnabled()).toBe(true);
    });

    it('should accept strictValidation setting', () => {
      const logger = new MonguardAuditLogger(mockDb, 'audit_logs', {
        strictValidation: true,
      });

      expect(logger.isEnabled()).toBe(true);
    });
  });

  describe('logOperation', () => {
    it('should create audit log without validation', async () => {
      const logger = new MonguardAuditLogger(mockDb, 'audit_logs');
      const documentId = new MongoObjectId();

      await logger.logOperation('create', 'users', documentId);

      expect(mockCollection.insertOne).toHaveBeenCalledWith({
        ref: {
          collection: 'users',
          id: documentId,
        },
        action: 'create',
        userId: undefined,
        timestamp: expect.any(Date),
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
        metadata: { storageMode: 'full' },
      });
    });

    it('should include userContext when provided', async () => {
      const logger = new MonguardAuditLogger(mockDb, 'audit_logs');
      const documentId = new MongoObjectId();
      const userId = new MongoObjectId();

      await logger.logOperation('update', 'users', documentId, { userId });

      expect(mockCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: userId,
        })
      );
    });

    it('should include metadata when provided', async () => {
      const logger = new MonguardAuditLogger(mockDb, 'audit_logs');
      const documentId = new MongoObjectId();
      const metadata = { before: { name: 'old' }, after: { name: 'new' } };

      await logger.logOperation('update', 'users', documentId, undefined, metadata);

      expect(mockCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            before: { name: 'old' },
            after: { name: 'new' },
            storageMode: 'full', // Audit logger adds storage mode to metadata
          }),
        })
      );
    });

    it('should handle database errors gracefully', async () => {
      const customLogger = createMockLogger();
      const logger = new MonguardAuditLogger(mockDb, 'audit_logs', {
        logger: customLogger,
      });

      const error = new Error('Database connection failed');
      mockCollection.insertOne = vi.fn().mockRejectedValue(error);

      // Should not throw error
      await expect(logger.logOperation('create', 'users', new MongoObjectId())).resolves.toBeUndefined();

      // Should log error
      expect(customLogger.error).toHaveBeenCalledWith('Failed to create audit log:', error);
    });
  });

  describe('validation with strictValidation=false (default)', () => {
    it('should warn on validation failure', async () => {
      const customLogger = createMockLogger();
      const logger = new MonguardAuditLogger(mockDb, 'audit_logs', {
        refIdConfig: RefIdConfigs.objectId(),
        logger: customLogger,
        strictValidation: false,
      });

      const invalidId = 'invalid-objectid';

      await logger.logOperation('create', 'users', invalidId as any);

      expect(customLogger.warn).toHaveBeenCalledWith(
        'Invalid reference ID type for audit log. Expected ObjectId, got: string',
        invalidId
      );

      // Should still create audit log
      expect(mockCollection.insertOne).toHaveBeenCalled();
    });

    it('should not warn on valid reference ID', async () => {
      const customLogger = createMockLogger();
      const logger = new MonguardAuditLogger(mockDb, 'audit_logs', {
        refIdConfig: RefIdConfigs.objectId(),
        logger: customLogger,
        strictValidation: false,
      });

      const validId = new MongoObjectId();

      await logger.logOperation('create', 'users', validId);

      expect(customLogger.warn).not.toHaveBeenCalled();
      expect(mockCollection.insertOne).toHaveBeenCalled();
    });
  });

  describe('validation with strictValidation=true', () => {
    it('should throw error on validation failure', async () => {
      const logger = new MonguardAuditLogger(mockDb, 'audit_logs', {
        refIdConfig: RefIdConfigs.objectId(),
        strictValidation: true,
      });

      const invalidId = 'invalid-objectid';

      await expect(logger.logOperation('create', 'users', invalidId as any)).rejects.toThrow(
        'Invalid reference ID type for audit log. Expected ObjectId, got: string'
      );

      // Should not create audit log
      expect(mockCollection.insertOne).not.toHaveBeenCalled();
    });

    it('should succeed with valid reference ID', async () => {
      const logger = new MonguardAuditLogger(mockDb, 'audit_logs', {
        refIdConfig: RefIdConfigs.objectId(),
        strictValidation: true,
      });

      const validId = new MongoObjectId();

      await expect(logger.logOperation('create', 'users', validId)).resolves.toBeUndefined();

      expect(mockCollection.insertOne).toHaveBeenCalled();
    });
  });

  describe('convertRefId functionality', () => {
    it('should use convertRefId when provided', async () => {
      const customConfig: RefIdConfig<string> = {
        validateRefId: (refId: any): refId is string => typeof refId === 'string',
        typeName: 'string',
        convertRefId: (documentId: any) => documentId.toString(),
      };

      const logger = new MonguardAuditLogger(mockDb, 'audit_logs', {
        refIdConfig: customConfig,
        strictValidation: false,
      });

      const objectId = new MongoObjectId();

      await logger.logOperation('create', 'users', objectId as any);

      expect(mockCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          ref: {
            collection: 'users',
            id: objectId.toString(), // Should be converted to string
          },
        })
      );
    });
  });

  describe('getAuditLogs', () => {
    it('should retrieve audit logs for document', async () => {
      const logger = new MonguardAuditLogger(mockDb, 'audit_logs');
      const documentId = new MongoObjectId();

      const mockAuditLogs = [
        { action: 'create', ref: { collection: 'users', id: documentId } },
        { action: 'update', ref: { collection: 'users', id: documentId } },
      ];

      mockCollection.find = vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue(mockAuditLogs),
        }),
      });

      const result = await logger.getAuditLogs('users', documentId);

      expect(result).toEqual(mockAuditLogs);
      expect(mockCollection.find).toHaveBeenCalledWith({
        'ref.collection': 'users',
        'ref.id': documentId,
      });
    });

    it('should handle query errors gracefully', async () => {
      const customLogger = createMockLogger();
      const logger = new MonguardAuditLogger(mockDb, 'audit_logs', {
        logger: customLogger,
      });

      const error = new Error('Query failed');
      mockCollection.find = vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockRejectedValue(error),
        }),
      });

      const result = await logger.getAuditLogs('users', new MongoObjectId());

      expect(result).toEqual([]);
      expect(customLogger.error).toHaveBeenCalledWith('Failed to retrieve audit logs:', error);
    });
  });
});

describe('NoOpAuditLogger', () => {
  let logger: NoOpAuditLogger;

  beforeEach(() => {
    logger = new NoOpAuditLogger();
  });

  it('should indicate auditing is disabled', () => {
    expect(logger.isEnabled()).toBe(false);
  });

  it('should return null for audit collection', () => {
    expect(logger.getAuditCollection()).toBe(null);
  });

  it('should perform no-op for logOperation', async () => {
    await expect(logger.logOperation('create', 'users', 'test-id')).resolves.toBeUndefined();
  });

  it('should return empty array for getAuditLogs', async () => {
    const result = await logger.getAuditLogs('users', 'test-id');
    expect(result).toEqual([]);
  });
});

describe('cleanDeltaChanges', () => {
  let mockDb: Db;
  let logger: MonguardAuditLogger;

  beforeEach(() => {
    mockDb = createMockDb();
    logger = new MonguardAuditLogger(mockDb, 'audit_logs');
  });

  // Access private method for testing
  const cleanDeltaChanges = (deltaChanges: Record<string, any>) => {
    return (logger as any).cleanDeltaChanges(deltaChanges);
  };

  const testCases = [
    {
      description: 'should remove undefined old property (field added)',
      input: { 'email': { old: undefined, new: 'john@example.com' } },
      expected: { 'email': { new: 'john@example.com' } }
    },
    {
      description: 'should remove undefined new property (field removed)',
      input: { 'email': { old: 'john@example.com', new: undefined } },
      expected: { 'email': { old: 'john@example.com' } }
    },
    {
      description: 'should preserve null values',
      input: { 'email': { old: 'john@example.com', new: null } },
      expected: { 'email': { old: 'john@example.com', new: null } }
    },
    {
      description: 'should preserve both old and new when neither is undefined',
      input: { 'name': { old: 'John', new: 'Jane' } },
      expected: { 'name': { old: 'John', new: 'Jane' } }
    },
    {
      description: 'should preserve fullDocument flag',
      input: { 'tags': { old: ['a'], new: ['b'], fullDocument: true } },
      expected: { 'tags': { old: ['a'], new: ['b'], fullDocument: true } }
    },
    {
      description: 'should handle multiple field changes',
      input: {
        'name': { old: undefined, new: 'John' },
        'email': { old: 'old@example.com', new: undefined },
        'age': { old: 25, new: 26 }
      },
      expected: {
        'name': { new: 'John' },
        'email': { old: 'old@example.com' },
        'age': { old: 25, new: 26 }
      }
    }
  ];

  it.each(testCases)('$description', ({ input, expected }) => {
    const result = cleanDeltaChanges(input);
    expect(result).toEqual(expected);
  });
});

describe('ConsoleLogger', () => {
  it('should use console methods', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    ConsoleLogger.warn('Test warning', { data: 'test' });
    ConsoleLogger.error('Test error', new Error('test'));

    expect(consoleSpy).toHaveBeenCalledWith('Test warning', { data: 'test' });
    expect(errorSpy).toHaveBeenCalledWith('Test error', new Error('test'));

    consoleSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
