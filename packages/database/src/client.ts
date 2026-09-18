import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import * as schema from "./schema/index.js";

export type Database = ReturnType<typeof createDatabase>;

/** The transaction handle passed to `db.transaction(async (tx) => ...)`. */
export type Tx = PgTransaction<PostgresJsQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;

/** Repositories accept either a live Database or an in-flight transaction. */
export type DbClient = Database | Tx;

export function createDatabase(connectionString: string) {
  const client = postgres(connectionString, { max: 10 });
  return drizzle(client, { schema });
}

let sharedDb: Database | undefined;

/** Lazily-created singleton for process-lifetime reuse (apps/api, apps/worker). */
export function getDatabase(): Database {
  if (!sharedDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    sharedDb = createDatabase(url);
  }
  return sharedDb;
}

export { schema };
