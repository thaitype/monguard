import { expect } from 'vitest';
import { ObjectId as MongoObjectId } from 'mongodb';
import { AuditLogDocument } from '../src/types';
import type { ObjectId } from '../src/mongodb-types';

export class TestAssertions {
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
    expect(auditLog.ref.id.toString()).toEqual(documentId.toString());
    expect(auditLog.timestamp).toBeInstanceOf(Date);
    // Note: createdAt and updatedAt are no longer included in audit logs since they're redundant with timestamp
  }
}

export class TestHelpers {
  static waitMs(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static isObjectId(value: any): value is MongoObjectId {
    return value instanceof MongoObjectId;
  }

  static createDateRange(startMs: number = Date.now() - 5000, endMs: number = Date.now() + 5000) {
    return {
      start: new Date(startMs),
      end: new Date(endMs),
    };
  }

  static expectDateInRange(date: Date, range: { start: Date; end: Date }): void {
    expect(date.getTime()).toBeGreaterThanOrEqual(range.start.getTime());
    expect(date.getTime()).toBeLessThanOrEqual(range.end.getTime());
  }
}
