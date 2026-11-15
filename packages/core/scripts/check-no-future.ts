// Proves the database blocks the future: as of a simulated day, even a query
// with no date filter cannot see any later price or post.
// Usage: pnpm db:check [YYYY-MM-DD]
import { asOf, db, closeDb, MarketView, DEFAULT_TICKERS } from "../src/index.js";

const simDate = process.argv[2] ?? "2020-03-16";
let failed = false;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failed = true;
};

for (const table of ["prices", "posts"]) {
  const { rows: [all] } = await db().query(
    `SELECT count(*)::int AS n, max(day)::text AS last FROM ${table}`,
  );
  const seen = await asOf(simDate, async (c) => {
    const { rows } = await c.query(`SELECT count(*)::int AS n, max(day)::text AS last FROM ${table}`);
    return rows[0];
  });
  const sneaky = await asOf(simDate, async (c) => {
    const { rows } = await c.query(`SELECT count(*)::int AS n FROM ${table} WHERE day > $1`, [simDate]);
    return rows[0].n as number;
  });
  console.log(`\n${table}: full table ${all.n} rows (last ${all.last}); agent as of ${simDate}: ${seen.n} rows (last ${seen.last})`);
  check(seen.last !== null && seen.last <= simDate, `${table}: agent sees nothing after the simulated day`);
  check(seen.n < all.n, `${table}: agent sees fewer rows than the full table`);
  check(sneaky === 0, `${table}: explicitly asking for rows after ${simDate} returns ${sneaky}`);
}

const blockedWrite = await asOf(simDate, async (c) =>
  c.query("UPDATE prices SET close = 0 WHERE false").then(() => false, () => true),
).catch(() => true);
console.log();
check(blockedWrite, "agent connection cannot write");

const blockedDateChange = await asOf(simDate, async (c) => {
  await c.query("SELECT set_config('app.sim_date', '2026-01-01', true)");
  return false;
}).catch(() => true);
console.log(
  `INFO  changing app.sim_date ${blockedDateChange ? "is blocked" : "is possible from SQL"}; ` +
    "this is why the agent never gets a SQL connection, only MarketView tools",
);

const view = new MarketView(simDate, DEFAULT_TICKERS);
const bars = await view.getPrices("AAPL", 5);
check(bars.length > 0 && bars.at(-1)!.day <= simDate, `MarketView AAPL last bar: ${bars.at(-1)?.day}`);
const posts = await view.getPosts("AAPL", 3, 5);
check(posts.every((p) => p.day <= simDate), `MarketView AAPL latest post: ${posts[0]?.day ?? "none"}`);

await closeDb();
if (failed) process.exit(1);
console.log("\nThe future is blocked.");
