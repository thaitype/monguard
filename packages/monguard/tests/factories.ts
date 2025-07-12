import { ObjectId as MongoObjectId } from 'mongodb';
import { BaseDocument, AuditableDocument, UserContext } from '../src/types';
import { adaptObjectId } from './mongodb-adapter';

export type TestUserReference = any;

export interface TestUser extends AuditableDocument<TestUserReference> {
  name: string;
  email: string;
  age?: number;
  tags?: string[];
  profile?: {
    address?: {
      city?: string;
      country?: string;
    };
    preferences?: {
      theme?: string;
      language?: string;
    };
  };
}

export interface TestProduct extends BaseDocument {
  name: string;
  price: number;
  category: string;
}

export class TestDataFactory {
  static createUser(overrides: Partial<TestUser> = {}): Omit<TestUser, '_id' | 'createdAt' | 'updatedAt'> {
    return {
      name: 'John Doe',
      email: 'john.doe@example.com',
      age: 30,
      createdBy: undefined,
      updatedBy: undefined,
      deletedBy: undefined,
      ...overrides,
    };
  }

  static createProduct(overrides: Partial<TestProduct> = {}): Omit<TestProduct, '_id' | 'createdAt' | 'updatedAt'> {
    return {
      name: 'Test Product',
      price: 99.99,
      category: 'electronics',
      ...overrides,
    };
  }

  static createUserContext(userId?: MongoObjectId | string): UserContext {
    return {
      userId: userId
        ? typeof userId === 'string'
          ? userId
          : adaptObjectId(userId)
        : adaptObjectId(new MongoObjectId()),
    };
  }

  static createObjectId() {
    return adaptObjectId(new MongoObjectId());
  }

  static createMultipleUsers(count: number): Array<Omit<TestUser, '_id' | 'createdAt' | 'updatedAt'>> {
    return Array.from({ length: count }, (_, i) =>
      this.createUser({
        name: `User ${i + 1}`,
        email: `user${i + 1}@example.com`,
        age: 20 + i,
      })
    );
  }
}
