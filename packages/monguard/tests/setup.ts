import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient, Db } from 'mongodb';
// Import adapter to setup global ObjectId
import './mongodb-adapter';

// Singleton instance to avoid concurrency issues
let globalMongod: MongoMemoryReplSet | null = null;
let globalClient: MongoClient | null = null;

export class TestDatabase {
  private db: Db | null = null;
  private databaseName: string;

  constructor() {
    // Use unique database name for each test instance
    this.databaseName = `test_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  async start(): Promise<Db> {
    // Initialize global MongoDB replica set instance if not already running
    if (!globalMongod) {
      globalMongod = await MongoMemoryReplSet.create({
        replSet: {
          count: 1, // Single node replica set for simplicity
          storageEngine: 'wiredTiger', // Required for transactions
        },
      });
    }

    if (!globalClient) {
      const uri = globalMongod.getUri();
      globalClient = new MongoClient(uri);
      await globalClient.connect();
    }

    this.db = globalClient.db(this.databaseName);
    return this.db;
  }

  async stop(): Promise<void> {
    // Only cleanup the database, don't stop the global instance
    if (this.db) {
      try {
        await this.db.dropDatabase();
      } catch (error) {
        // Ignore errors during cleanup in replica set environment
        console.warn('Database cleanup warning:', (error as Error).message);
      }
      this.db = null;
    }
  }

  async cleanup(): Promise<void> {
    if (this.db) {
      try {
        const collections = await this.db.listCollections().toArray();
        for (const collection of collections) {
          await this.db.collection(collection.name).deleteMany({});
        }
      } catch (error) {
        // Ignore errors during cleanup in replica set environment
        console.warn('Collection cleanup warning:', (error as Error).message);
      }
    }
  }

  getDb(): Db {
    if (!this.db) {
      throw new Error('Database not initialized. Call start() first.');
    }
    return this.db;
  }

  // Global cleanup method for test teardown
  static async globalTeardown(): Promise<void> {
    if (globalClient) {
      await globalClient.close();
      globalClient = null;
    }
    if (globalMongod) {
      await globalMongod.stop();
      globalMongod = null;
    }
  }
}
