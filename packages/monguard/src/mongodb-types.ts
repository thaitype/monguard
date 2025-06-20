/**
 * Custom MongoDB-compatible types to avoid direct dependency on mongodb package.
 * These types have identical names and interfaces to MongoDB driver types for compatibility.
 */

/** @public */
export interface Document {
  [key: string]: any;
}

/** Given an object shaped type, return the type of the _id field or default to ObjectId @public */
export declare type InferIdType<TSchema> = TSchema extends {
  _id: infer IdType;
} ? Record<any, never> extends IdType ? never : IdType : TSchema extends {
  _id?: infer IdType;
} ? unknown extends IdType ? ObjectId : IdType : ObjectId;


export type InspectFn = (x: unknown, options?: unknown) => string;
/**
 * MongoDB ObjectId interface - identical to mongodb package ObjectId
 * @example
 * ```typescript
 * const id = new ObjectId();
 * const idFromString = new ObjectId('507f1f77bcf86cd799439011');
 * ```
 */
export interface ObjectId {
  get _bsontype(): 'ObjectId';
  get id(): Uint8Array;
  /** Convert ObjectId to string representation */
  toString(): string;
  toJSON(): string;
  /** Convert ObjectId to hex string (same as toString) */
  toHexString(): string;
  /** Check if this ObjectId equals another ObjectId or string */
  equals(other: ObjectId | string): boolean;
  /** Get the timestamp portion of the ObjectId as a Date */
  getTimestamp(): Date;
  /**
 * Converts to a string representation of this Id.
 *
 * @returns return the 24 character hex string representation.
 */
  inspect(depth?: number, options?: unknown, inspect?: InspectFn): string;
}

/**
 * Constructor interface for ObjectId - identical to mongodb package
 */
export interface ObjectIdConstructor {
  new(): ObjectId;
  new(id: string | ObjectId | Buffer): ObjectId;
  /** Check if a value is a valid ObjectId */
  isValid(id: string | ObjectId | Buffer): boolean;
  /** Create ObjectId from hex string */
  createFromHexString(hex: string): ObjectId;
  /** Create ObjectId from timestamp */
  createFromTime(timestamp: number): ObjectId;
}

/**
 * MongoDB filter operators - identical to mongodb package
 */
export interface FilterOperators<TValue> {
  $eq?: TValue;
  $ne?: TValue;
  $gt?: TValue;
  $gte?: TValue;
  $lt?: TValue;
  $lte?: TValue;
  $in?: TValue[];
  $nin?: TValue[];
  $exists?: boolean;
  $regex?: RegExp | string;
  $options?: string;
  $size?: number;
  $all?: TValue[];
  $elemMatch?: TValue extends ReadonlyArray<infer U> ? Filter<U> : never;
  [key: string]: any;
}

/**
 * Root filter operators - identical to mongodb package
 */
export interface RootFilterOperators<TSchema> {
  $and?: Filter<TSchema>[];
  $or?: Filter<TSchema>[];
  $nor?: Filter<TSchema>[];
  $not?: Filter<TSchema>;
  $text?: {
    $search: string;
    $language?: string;
    $caseSensitive?: boolean;
    $diacriticSensitive?: boolean;
  };
  $where?: string | ((this: TSchema) => boolean);
  $comment?: string;
  [key: string]: any;
}

/**
 * MongoDB filter type - identical to mongodb package Filter<T>
 */
export type Filter<TSchema> = {
  [P in keyof TSchema]?: TSchema[P] | FilterOperators<TSchema[P]>;
} & RootFilterOperators<TSchema> & {
  [key: string]: any;
};

/**
 * MongoDB update operators - identical to mongodb package
 */
export interface UpdateFilter<TSchema> {
  /** Update operators */
  $currentDate?:
  | { [P in keyof TSchema]?: true | { $type: 'date' | 'timestamp' } }
  | { [key: string]: true | { $type: 'date' | 'timestamp' } };
  $inc?: { [P in keyof TSchema]?: number } | { [key: string]: number };
  $min?: Partial<TSchema>;
  $max?: Partial<TSchema>;
  $mul?: { [P in keyof TSchema]?: number } | { [key: string]: number };
  $rename?: { [P in keyof TSchema]?: string } | { [key: string]: string };
  $set?: Partial<TSchema> & { [key: string]: any };
  $setOnInsert?: Partial<TSchema>;
  $unset?: { [P in keyof TSchema]?: '' | 1 | true } | { [key: string]: '' | 1 | true };

  /** Array update operators */
  $addToSet?: { [P in keyof TSchema]?: any } | { [key: string]: any };
  $pop?: { [P in keyof TSchema]?: 1 | -1 } | { [key: string]: 1 | -1 };
  $pull?: { [P in keyof TSchema]?: any } | { [key: string]: any };
  $push?: { [P in keyof TSchema]?: any } | { [key: string]: any };
  $pullAll?: { [P in keyof TSchema]?: any[] } | { [key: string]: any[] };

  [key: string]: any;
}

/**
 * MongoDB find options - identical to mongodb package FindOptions
 */
export interface FindOptions {
  /** Limit the number of documents returned */
  limit?: number;
  /** Skip a number of documents */
  skip?: number;
  /** Sort order specification */
  sort?: { [key: string]: 1 | -1 } | Array<[string, 1 | -1]>;
  /** Project specific fields */
  projection?: { [key: string]: 0 | 1 };
  /** Add a comment to the query */
  comment?: string;
  /** Maximum time to allow the query to run */
  maxTimeMS?: number;
  [key: string]: any;
}

/**
 * Result of an insert operation - identical to mongodb package
 */
export interface InsertOneResult {
  /** Whether the operation was acknowledged by MongoDB */
  acknowledged: boolean;
  /** The ObjectId of the inserted document */
  insertedId: ObjectId;
}

/**
 * Result of an update operation - identical to mongodb package
 */
export interface UpdateResult<TSchema extends Document = Document> {
  /** Whether the operation was acknowledged by MongoDB */
  acknowledged: boolean;
  /** Number of documents matched by the filter */
  matchedCount: number;
  /** Number of documents modified */
  modifiedCount: number;
  /** Number of documents upserted */
  upsertedCount: number;
  /** ObjectId of upserted document, if any */
  upsertedId: InferIdType<TSchema> | null;
}

/**
 * Result of a delete operation - identical to mongodb package
 */
export interface DeleteResult {
  /** Whether the operation was acknowledged by MongoDB */
  acknowledged: boolean;
  /** Number of documents deleted */
  deletedCount: number;
}

/**
 * MongoDB collection cursor - identical to mongodb package FindCursor
 */
export interface FindCursor<TSchema> {
  /** Convert cursor to array */
  toArray(): Promise<TSchema[]>;
  /** Limit the number of results */
  limit(value: number): FindCursor<TSchema>;
  /** Skip a number of documents */
  skip(value: number): FindCursor<TSchema>;
  /** Sort the results */
  sort(sort: { [key: string]: 1 | -1 }): FindCursor<TSchema>;
  /** Add a comment to the cursor */
  comment(value: string): FindCursor<TSchema>;
  /** Set maximum time for the cursor */
  maxTimeMS(value: number): FindCursor<TSchema>;
}

/**
 * MongoDB client session - identical to mongodb package ClientSession
 */
export interface ClientSession {
  /** End the session */
  endSession(): Promise<void>;
  /** Execute a function within a transaction */
  withTransaction<T>(fn: () => Promise<T>): Promise<T>;
  /** Start a new transaction */
  startTransaction(): void;
  /** Commit the current transaction */
  commitTransaction(): Promise<void>;
  /** Abort the current transaction */
  abortTransaction(): Promise<void>;
  /** Session ID */
  id: any;
  /** Whether session is in transaction */
  inTransaction(): boolean;
}

/**
 * Options for collection operations - identical to mongodb package
 */
export interface CollectionOperationOptions {
  /** MongoDB session for transactions */
  session?: ClientSession;
  /** Whether to perform an upsert */
  upsert?: boolean;
  /** Write concern */
  writeConcern?: {
    w?: number | string;
    j?: boolean;
    wtimeout?: number;
  };
  /** Comment to add to the operation */
  comment?: string;
  [key: string]: any;
}

/**
 * MongoDB collection interface - identical to mongodb package Collection<T>
 */
export interface Collection<TSchema = any> {
  /** Collection name */
  collectionName: string;

  /** Database reference */
  db: Db;

  /** Insert a single document */
  insertOne(document: TSchema, options?: CollectionOperationOptions): Promise<InsertOneResult>;

  /** Find a single document */
  findOne(filter: Filter<TSchema>, options?: FindOptions & CollectionOperationOptions): Promise<TSchema | null>;

  /** Find multiple documents */
  find(filter: Filter<TSchema>, options?: FindOptions & CollectionOperationOptions): FindCursor<TSchema>;

  /** Update multiple documents */
  updateMany(
    filter: Filter<TSchema>,
    update: UpdateFilter<TSchema>,
    options?: CollectionOperationOptions
  ): Promise<UpdateResult>;

  /** Update a single document */
  updateOne(
    filter: Filter<TSchema>,
    update: UpdateFilter<TSchema>,
    options?: CollectionOperationOptions
  ): Promise<UpdateResult>;

  /** Delete multiple documents */
  deleteMany(filter: Filter<TSchema>, options?: CollectionOperationOptions): Promise<DeleteResult>;

  /** Delete a single document */
  deleteOne(filter: Filter<TSchema>, options?: CollectionOperationOptions): Promise<DeleteResult>;

  /** Count documents matching filter */
  countDocuments(filter: Filter<TSchema>, options?: CollectionOperationOptions): Promise<number>;

  /** Replace a single document */
  replaceOne(
    filter: Filter<TSchema>,
    replacement: TSchema,
    options?: CollectionOperationOptions
  ): Promise<UpdateResult>;
}

/**
 * MongoDB client interface - identical to mongodb package MongoClient
 */
export interface MongoClient {
  /** Start a new session */
  startSession(): ClientSession;
  /** Close the client connection */
  close(): Promise<void>;
  /** Database reference */
  db(name?: string): Db;
}

/**
 * MongoDB database interface - identical to mongodb package Db
 */
export interface Db {
  /** Database name */
  databaseName: string;

  /** MongoDB client instance */
  client: MongoClient;

  /** Get a collection */
  collection<TSchema = any>(name: string): Collection<TSchema>;

  /** Create a collection */
  createCollection<TSchema = any>(name: string, options?: any): Promise<Collection<TSchema>>;

  /** Drop a collection */
  dropCollection(name: string): Promise<boolean>;

  /** List collections */
  listCollections(filter?: any, options?: any): any;
}

/**
 * Type utility to exclude _id from documents - identical to mongodb package
 */
export type WithoutId<T> = Omit<T, '_id'>;

/**
 * Type utility for documents with _id - identical to mongodb package
 */
export type WithId<T> = T & { _id: ObjectId };

/**
 * Note: Users should import ObjectId from their chosen MongoDB-compatible library
 * The ObjectIdConstructor interface is available for typing purposes
 */
