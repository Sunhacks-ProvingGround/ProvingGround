// Creates tables, the "no future data" rule, and the append-only run log.
// Usage: pnpm db:migrate
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db, closeDb, repoRoot } from "../src/index.js";

const sql = await readFile(resolve(repoRoot, "db/schema.sql"), "utf8");
await db().query(sql);
console.log("Schema applied.");
await closeDb();
