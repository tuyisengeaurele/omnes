/**
 * The one Prisma client instance the process uses. Lazily constructed for
 * the same reason config and the logger are: importing this module must not
 * open a database connection as a side effect, since unit tests for
 * unrelated code import from sibling files in the same directory tree and
 * must not need a live database to run.
 */

import { PrismaClient } from '../generated/prisma/index.js';

let cached: PrismaClient | undefined;

export function getDb(): PrismaClient {
  cached ??= new PrismaClient();
  return cached;
}

export async function disconnectDb(): Promise<void> {
  if (cached) {
    await cached.$disconnect();
    cached = undefined;
  }
}
