import { ObjectId } from 'mongodb';
import { BaseDocument, AuditableDocument, UserContext } from '../types';

export interface TestUser extends AuditableDocument {
  name: string;
  email: string;
  age?: number;
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
      ...overrides
    };
  }

  static createProduct(overrides: Partial<TestProduct> = {}): Omit<TestProduct, '_id' | 'createdAt' | 'updatedAt'> {
    return {
      name: 'Test Product',
      price: 99.99,
      category: 'electronics',
      ...overrides
    };
  }

  static createUserContext(userId?: ObjectId | string): UserContext {
    return {
      userId: userId || new ObjectId()
    };
  }

  static createObjectId(): ObjectId {
    return new ObjectId();
  }

  static createMultipleUsers(count: number): Array<Omit<TestUser, '_id' | 'createdAt' | 'updatedAt'>> {
    return Array.from({ length: count }, (_, i) => 
      this.createUser({ 
        name: `User ${i + 1}`, 
        email: `user${i + 1}@example.com`,
        age: 20 + i 
      })
    );
  }
}