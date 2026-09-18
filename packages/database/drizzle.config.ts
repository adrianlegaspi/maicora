import { defineConfig } from "drizzle-kit";

export default defineConfig({
  // drizzle-kit's own TS loader does not follow this repo's NodeNext-style
  // explicit ".js" relative imports back to the ".ts" sources, so migration
  // generation runs against the compiled output (`pnpm run generate` builds
  // first) instead of the src/ files directly.
  schema: "./dist/schema/index.js",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://maicora:maicora@localhost:5432/maicora",
  },
  strict: true,
  verbose: true,
});
