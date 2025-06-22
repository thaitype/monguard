/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  ObjectId as MongoObjectId,
  UpdateResult as MongoUpdateResult,
  DeleteResult as MongoDeleteResult,
  Db as MongoDb,
} from 'mongodb';
import { ObjectId, UpdateResult, Db } from '../../src/mongodb-types';
import { MonguardCollection } from '../../src';

export function testDb() {
  const fn = (db: Db) => {};
  fn({} as MongoDb);
}

export function testObjectId() {
  const fn = (objectId: ObjectId) => {};
  fn(new MongoObjectId());
}

export function testUpdateResult() {
  const fn = (updateResult: MongoUpdateResult) => {};
  fn({} as UpdateResult);
}

export async function hardDeleteResult() {
  const user = new MonguardCollection({} as any, 'users', {} as any);
  // Soft delete result
  const defaultValue: MongoUpdateResult = await user.delete({ _id: new MongoObjectId() });
  // Hard delete result
  const hardDeleteValue: MongoDeleteResult = await user.delete({ _id: new MongoObjectId() }, { hardDelete: true });
  // Soft delete result
  const softDeleteValue: MongoUpdateResult = await user.delete({ _id: new MongoObjectId() }, { hardDelete: false });
}
