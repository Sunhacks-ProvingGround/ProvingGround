// The Leakage Gap: the AI agent's return when it could see real names and
// dates, minus its return on the same days in disguise.
// Usage:
//   pnpm gap                  2020 demo window
//   pnpm gap --window control 2026 control window
//   pnpm gap --no-posts       compare against the prices-only blind run
import { parseArgs } from "node:util";
import { leakageGap, closeDb, DEMO_WINDOW, CONTROL_WINDOW } from "../src/index.js";

const { values: args } = parseArgs({
  options: { window: { type: "string", default: "demo" }, "no-posts": { type: "boolean", default: false } },
});
const w = args.window === "control" ? CONTROL_WINDOW : DEMO_WINDOW;
const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;

const g = await leakageGap(w.start, w.end, args["no-posts"] ? { posts: false } : {});
if (!g) {
  console.log(`Need a finished normal run and a blind run of the AI agent for ${w.start} to ${w.end}.`);
  console.log(`Run: pnpm backtest --strategy llm${args.window === "control" ? " --window control" : ""} --mode normal  (and --mode blind)`);
  await closeDb();
  process.exit(1);
}
console.log(`\nLeakage Gap, ${g.window.start} to ${g.window.end}${g.model ? `, model ${g.model}` : ""}`);
console.table({
  "Normal mode (real names and dates)": { runs: g.normal.n, "average return": pct(g.normal.totalReturn), each: g.normal.runs.map((r) => pct(r.totalReturn)).join(", ") },
  [`Blind mode (${g.blind.posts ? "disguised, with posts" : "disguised, prices only"})`]: { runs: g.blind.n, "average return": pct(g.blind.totalReturn), each: g.blind.runs.map((r) => pct(r.totalReturn)).join(", ") },
});
console.log(`Leakage Gap: ${pct(g.gap)} (normal minus blind, in percentage points)`);
if (args.window !== "control") {
  const c = await leakageGap(CONTROL_WINDOW.start, CONTROL_WINDOW.end);
  if (c) {
    console.log(`Control gap (2026, nothing to remember): ${pct(c.gap)}`);
    console.log(`Memory effect (2020 gap minus control gap): ${pct(g.gap - c.gap)}`);
  }
}
await closeDb();
