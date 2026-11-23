import { MongoClient, type Db } from "mongodb";

import { env } from "./env.js";
import { logger } from "../utils/logger.js";

let client: MongoClient | null = null;
let database: Db | null = null;

export async function connectDatabase(
  uri: string = env.MONGODB_URI,
  dbName: string = env.MONGODB_DB_NAME,
): Promise<Db> {
  if (database) {
    return database;
  }

  const nextClient = new MongoClient(uri, {
    serverSelectionTimeoutMS: 10_000,
    appName: "mentorlagbe-server",
  });

  try {
    await nextClient.connect();
    const nextDb = nextClient.db(dbName);
    await nextDb.command({ ping: 1 });

    client = nextClient;
    database = nextDb;
    logger.info("MongoDB connected", { dbName });
    return nextDb;
  } catch (error) {
    await nextClient.close().catch(() => undefined);
    throw new Error(
      `Could not connect to MongoDB: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

export function getDb(): Db {
  if (!database) {
    throw new Error("Database is not connected. Call connectDatabase() first.");
  }

  return database;
}

export function getMongoClient(): MongoClient {
  if (!client) {
    throw new Error("Database is not connected. Call connectDatabase() first.");
  }

  return client;
}

export async function pingDatabase(): Promise<boolean> {
  try {
    await getDb().command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

export async function disconnectDatabase(): Promise<void> {
  if (client) {
    await client.close();
  }

  client = null;
  database = null;
}
