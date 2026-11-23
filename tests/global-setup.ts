import { MongoMemoryServer } from "mongodb-memory-server";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

let mongo: MongoMemoryServer | undefined;

/** One in-memory MongoDB for the whole run; each test file uses its own database. */
export async function setup(project: TestProject) {
  mongo = await MongoMemoryServer.create();
  project.provide("mongoUri", mongo.getUri());
}

export async function teardown() {
  await mongo?.stop();
}
