// Loads data/prices.csv and data/posts.csv into the database.
// Safe to run again: existing rows are updated, not duplicated.
// Usage: pnpm db:load
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db, closeDb, repoRoot } from "../src/index.js";
import { parseCsv } from "../src/csv.js";

async function insertBatches(table: string, cols: string[], rows: unknown[][], onConflict: string) {
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const params: unknown[] = [];
    const values = batch.map((r) => {
      const ph = r.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `(${ph.join(",")})`;
    });
    await db().query(`INSERT INTO ${table} (${cols.join(",")}) VALUES ${values.join(",")} ${onConflict}`, params);
  }
}

// ---------- Prices ----------
const prices = parseCsv(await readFile(resolve(repoRoot, "data/prices.csv"), "utf8"));
await insertBatches(
  "prices",
  ["ticker", "day", "open", "high", "low", "close", "volume", "raw_close"],
  prices.map((r) => [
    r.ticker,
    (r.time ?? r.day).slice(0, 10),
    +r.open,
    +r.high,
    +r.low,
    +r.close,
    Math.round(+r.volume),
    r.raw_close ? +r.raw_close : null,
  ]),
  `ON CONFLICT (ticker, day) DO UPDATE SET open=EXCLUDED.open, high=EXCLUDED.high, low=EXCLUDED.low,
     close=EXCLUDED.close, volume=EXCLUDED.volume, raw_close=EXCLUDED.raw_close`,
);

// ---------- Posts (exact duplicates removed) ----------
const rawPosts = parseCsv(await readFile(resolve(repoRoot, "data/posts.csv"), "utf8"));
const seen = new Set<string>();
const posts = rawPosts.filter((p) => {
  const key = `${p.time}|${p.ticker}|${p.text.trim()}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
await insertBatches(
  "posts",
  ["id", "day", "ticker", "text", "sentiment"],
  posts.map((p) => [+p.id, (p.time ?? p.day).slice(0, 10), p.ticker, p.text.trim(), p.sentiment || null]),
  `ON CONFLICT (id) DO UPDATE SET day=EXCLUDED.day, ticker=EXCLUDED.ticker, text=EXCLUDED.text, sentiment=EXCLUDED.sentiment`,
);
console.log(`Posts: ${posts.length} loaded (${rawPosts.length - posts.length} duplicates skipped)`);

// ---------- Summary ----------
const { rows: p } = await db().query(
  `SELECT ticker, count(*)::int AS days, min(day)::text AS first, max(day)::text AS last
     FROM prices GROUP BY ticker ORDER BY ticker`,
);
console.log("Prices:");
console.table(p);
const { rows: s } = await db().query(
  `SELECT ticker, count(*)::int AS posts, min(day)::text AS first, max(day)::text AS last
     FROM posts GROUP BY ticker ORDER BY ticker`,
);
console.log("Posts:");
console.table(s);
await closeDb();
