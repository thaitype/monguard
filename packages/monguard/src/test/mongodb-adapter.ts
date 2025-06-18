/**
 * Test adapter to bridge between MongoDB types and our custom types
 * This allows tests to use actual MongoDB while main library uses custom types
 */

import { ObjectId as MongoObjectIdConstructor } from 'mongodb';
import type { Db as MongoDb, ObjectId as MongoObjectId } from 'mongodb';
import type { Db, ObjectId } from '../mongodb-types';

// Make ObjectId available globally for the main library
(global as any).ObjectId = MongoObjectIdConstructor;

/**
 * Adapt MongoDB Db to our custom Db type
 */
export function adaptDb(mongoDb: MongoDb): Db {
  return mongoDb as any as Db;
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