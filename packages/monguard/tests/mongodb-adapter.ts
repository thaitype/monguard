/**
 * Test adapter to bridge between MongoDB types and our custom types
 * This allows tests to use actual MongoDB while main library uses custom types
 */

import { ObjectId as MongoObjectIdConstructor } from 'mongodb';
import type { Db as MongoDb, ObjectId as MongoObjectId } from 'mongodb';
import type { Db, ObjectId } from '../src/mongodb-types';

// ObjectId is no longer exposed globally - users should import it themselves

/**
 * Adapt MongoDB Db to our custom Db type
 */
export function adaptDb(mongoDb: MongoDb): Db {
  // Ensure client is properly exposed for transaction strategy
  const adaptedDb = mongoDb as any as Db;
  (adaptedDb as any).client = (mongoDb as any).client;

  // Override collection method to ensure proper db reference
  const originalCollection = adaptedDb.collection.bind(adaptedDb);
  adaptedDb.collection = function <T = any>(name: string) {
    const collection = originalCollection(name);
    // Ensure collection.db points to the adapted database
    (collection as any).db = adaptedDb;
    return collection;
  };

  return adaptedDb;
}

/**
 * Adapt MongoDB ObjectId to our custom ObjectId type
 */
export function adaptObjectId(mongoId: MongoObjectId): ObjectId {
  return mongoId as any as ObjectId;
}

/**
 * Adapt our custom ObjectId to MongoDB ObjectId
 */
export function toMongoObjectId(id: ObjectId): MongoObjectId {
  return id as any as MongoObjectId;
}
