// Re-checks the run log: every run chains onto the one before it, settings
// still match their hash, and saved results still match their seal.
// Usage: pnpm runs:verify
import { verifyRunLog, db, closeDb } from "../src/index.js";

const { rows } = await db().query(
  `SELECT seq, agent, mode, status, config->>'start' AS start, config->>'end' AS end,
          (summary->>'totalReturn')::float AS ret, left(hash, 12) AS hash
     FROM runs ORDER BY seq`,
);
console.table(rows.map((r) => ({
  "#": Number(r.seq), agent: r.agent, mode: r.mode, status: r.status,
  window: `${r.start} to ${r.end}`,
  return: r.ret == null ? "" : `${(r.ret * 100).toFixed(2)}%`,
  hash: r.hash,
})));

const check = await verifyRunLog();
await closeDb();
if (check.ok) {
  console.log(`Run log verified: ${check.runs} runs, chain intact.`);
} else {
  console.log(`Run log has problems:\n  ${check.problems.join("\n  ")}`);
  process.exit(1);
}
