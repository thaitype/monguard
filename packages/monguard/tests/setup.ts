import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, Db } from 'mongodb';
// Import adapter to setup global ObjectId
import './mongodb-adapter';

// Singleton instance to avoid concurrency issues
let globalMongod: MongoMemoryServer | null = null;
let globalClient: MongoClient | null = null;

export class TestDatabase {
  private db: Db | null = null;
  private databaseName: string;

  constructor() {
    // Use unique database name for each test instance
    this.databaseName = `test_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  async start(): Promise<Db> {
    // Initialize global MongoDB instance if not already running
    if (!globalMongod) {
      globalMongod = await MongoMemoryServer.create({
        instance: {
          // Use a single port to avoid conflicts
          port: 27017 + Math.floor(Math.random() * 1000),
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
      await this.db.dropDatabase();
      this.db = null;
    }
  }

  async cleanup(): Promise<void> {
    if (this.db) {
      const collections = await this.db.listCollections().toArray();
      for (const collection of collections) {
        await this.db.collection(collection.name).deleteMany({});
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
