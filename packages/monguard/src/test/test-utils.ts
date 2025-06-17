import { expect } from 'vitest';
import { ObjectId } from 'mongodb';
import { WrapperResult, AuditLogDocument } from '../types';

export class TestAssertions {
  static expectSuccess<T>(result: WrapperResult<T>): asserts result is WrapperResult<T> & { success: true; data: T } {
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.error).toBeUndefined();
  }

  static expectError<T>(result: WrapperResult<T>): asserts result is WrapperResult<T> & { success: false; error: string } {
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.data).toBeUndefined();
  }

  static expectTimestamps(document: any): void {
    expect(document.createdAt).toBeInstanceOf(Date);
    expect(document.updatedAt).toBeInstanceOf(Date);
    expect(document.createdAt.getTime()).toBeLessThanOrEqual(document.updatedAt.getTime());
  }

  static expectUserTracking(document: any, userId: ObjectId): void {
    expect(document.createdBy).toEqual(userId);
    expect(document.updatedBy).toEqual(userId);
  }

  static expectSoftDeleted(document: any, userId?: ObjectId): void {
    expect(document.deletedAt).toBeInstanceOf(Date);
    if (userId) {
      expect(document.deletedBy).toEqual(userId);
    }
  }

  static expectAuditLog(auditLog: AuditLogDocument, expectedAction: string, documentId: ObjectId): void {
    expect(auditLog.action).toBe(expectedAction);
    expect(auditLog.ref.id).toEqual(documentId);
    expect(auditLog.timestamp).toBeInstanceOf(Date);
    expect(auditLog.createdAt).toBeInstanceOf(Date);
    expect(auditLog.updatedAt).toBeInstanceOf(Date);
  }
}

export class TestHelpers {
  static waitMs(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static isObjectId(value: any): value is ObjectId {
    return value instanceof ObjectId;
  }

  static createDateRange(startMs: number = Date.now() - 1000, endMs: number = Date.now() + 1000) {
    return {
      start: new Date(startMs),
      end: new Date(endMs)
    };
  }

  static expectDateInRange(date: Date, range: { start: Date; end: Date }): void {
    expect(date.getTime()).toBeGreaterThanOrEqual(range.start.getTime());
    expect(date.getTime()).toBeLessThanOrEqual(range.end.getTime());
  }
}