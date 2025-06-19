/* eslint-disable @typescript-eslint/no-unused-vars */
import { ObjectId as MongoObjectId } from 'mongodb';
import { ObjectId } from '../../src/mongodb-types';

export function testObjectId() {
  const fn = (objectId: ObjectId) => {};
  fn(new MongoObjectId());
}
