// Loads data/prices.csv into the prices table. Safe to run again (it updates existing rows).
// Usage: pnpm db:load
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db, closeDb, repoRoot } from "../src/index.js";

const csv = await readFile(resolve(repoRoot, "data/prices.csv"), "utf8");
const rows = csv.trim().split("\n").slice(1).map((l) => l.split(","));

const BATCH = 500;
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  const params: unknown[] = [];
  const values = batch.map((r, j) => {
    params.push(r[0], r[1], +r[2], +r[3], +r[4], +r[5], +r[6]);
    const b = j * 7;
    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`;
  });
  await db().query(
    `INSERT INTO prices (ticker, day, open, high, low, close, volume) VALUES ${values.join(",")}
     ON CONFLICT (ticker, day) DO UPDATE SET open=EXCLUDED.open, high=EXCLUDED.high,
       low=EXCLUDED.low, close=EXCLUDED.close, volume=EXCLUDED.volume`,
    params,
  );
}

const { rows: summary } = await db().query(
  `SELECT ticker, count(*)::int AS days, min(day)::text AS first, max(day)::text AS last
     FROM prices GROUP BY ticker ORDER BY ticker`,
);
console.table(summary);
await closeDb();
