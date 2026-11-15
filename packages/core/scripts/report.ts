// Grades every trade in a run and prints its report card.
// Usage:
//   pnpm report               the latest finished run
//   pnpm report --run 4       run #4 from the run log
import { parseArgs } from "node:util";
import { gradeRun, db, closeDb } from "../src/index.js";

const { values: args } = parseArgs({ options: { run: { type: "string" } } });

const { rows } = await db().query(
  args.run
    ? "SELECT id, seq, agent, mode, config, summary FROM runs WHERE seq = $1"
    : "SELECT id, seq, agent, mode, config, summary FROM runs WHERE status = 'done' ORDER BY seq DESC LIMIT 1",
  args.run ? [Number(args.run)] : [],
);
if (!rows.length) throw new Error(args.run ? `No run #${args.run}` : "No finished runs yet. Run pnpm backtest first.");
const run = rows[0];

const card = await gradeRun(run.id);
const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
const usd = (x: number) => `${x < 0 ? "-" : "+"}$${Math.abs(x).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

console.log(`\nReport card: run #${run.seq}, ${run.agent} (${run.mode}), ${run.config.start} to ${run.config.end}`);
console.log(`Return ${pct(run.summary.totalReturn)}; each trade judged on the ${card.horizonDays} trading days after it.\n`);

for (const t of card.trades) {
  const mark = { good: "GOOD", bad: "BAD ", neutral: " -- ", ungraded: " ?? " }[t.grade];
  const edge = t.edgeDollars == null ? "" : usd(t.edgeDollars).padStart(8);
  console.log(`${mark} ${edge}  ${t.explanation}`);
  if (t.reason && t.reason.length < 400) console.log(`              why: ${t.reason.slice(0, 150)}`);
}

const { good, bad, neutral, ungraded } = card.counts;
console.log(`\n${good} good, ${bad} bad, ${neutral} about even${ungraded ? `, ${ungraded} ungraded` : ""}.`);
console.log(`Good trades added ${usd(card.goodDollars)} versus not trading; bad trades cost ${usd(card.badDollars)}.`);
if (card.biggest.length) {
  console.log("\nThe trades that mattered most:");
  for (const t of card.biggest) console.log(`  ${usd(t.edgeDollars!).padStart(8)}  ${t.side} ${t.ticker} on ${t.filledOn} (${t.grade})`);
}
await closeDb();
