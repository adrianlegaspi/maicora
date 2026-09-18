import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import path from "node:path";

const url = process.env.DATABASE_URL ?? "postgres://maicora:maicora@localhost:5432/maicora";
const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

async function main() {
  const client = postgres(url, { max: 1 });
  const db = drizzle(client);
  console.log(`Running migrations from ${migrationsFolder} against ${url.replace(/:[^:@]*@/, ":***@")}`);
  await migrate(db, { migrationsFolder });
  await client.end();
  console.log("Migrations complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
