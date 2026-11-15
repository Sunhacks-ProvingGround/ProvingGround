// Proves the database blocks the future: as of a simulated day, even a query
// with no date filter cannot see any later row.
// Usage: pnpm db:check [YYYY-MM-DD]
import { asOf, db, closeDb, MarketView, DEFAULT_TICKERS } from "../src/index.js";

const simDate = process.argv[2] ?? "2020-03-02";
let failed = false;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failed = true;
};

const { rows: [all] } = await db().query(
  "SELECT count(*)::int AS n, max(day)::text AS last FROM prices",
);
console.log(`Full table (app connection): ${all.n} rows, last day ${all.last}`);

const seen = await asOf(simDate, async (c) => {
  const { rows } = await c.query("SELECT count(*)::int AS n, max(day)::text AS last FROM prices");
  return rows[0];
});
console.log(`Agent view as of ${simDate}: ${seen.n} rows, last day ${seen.last}`);
check(seen.last !== null && seen.last <= simDate, "agent sees nothing after the simulated day");
check(seen.n < all.n, "agent sees fewer rows than the full table");

const sneaky = await asOf(simDate, async (c) => {
  const { rows } = await c.query("SELECT count(*)::int AS n FROM prices WHERE day > $1", [simDate]);
  return rows[0].n;
});
check(sneaky === 0, `explicitly asking for rows after ${simDate} returns ${sneaky}`);

const blockedWrite = await asOf(simDate, async (c) =>
  c.query("UPDATE prices SET close = 0 WHERE false").then(() => false, () => true),
).catch(() => true);
check(blockedWrite, "agent connection cannot write");

const view = new MarketView(simDate, DEFAULT_TICKERS);
const bars = await view.getPrices("AAPL", 5);
check(bars.length > 0 && bars.at(-1)!.day <= simDate, `MarketView AAPL last bar: ${bars.at(-1)?.day}`);

await closeDb();
if (failed) process.exit(1);
console.log("\nThe future is blocked.");
