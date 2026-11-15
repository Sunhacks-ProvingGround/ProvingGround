// Runs one backtest end to end: registers it in the run log, replays the
// market, saves and seals the results, grades every trade and writes a
// one-line review of each.
// Usage:
//   pnpm backtest                                          buy-and-hold on the 2020 window
//   pnpm backtest --strategy sma_crossover --window control
//   pnpm backtest --strategy llm --mode blind              the AI agent (normal or blind)
//   pnpm backtest --strategy llm --mode blind --no-posts   blind, prices only
//   pnpm backtest --start 2020-02-01 --end 2020-03-31      any dates
//   pnpm backtest --no-review                              skip the AI trade reviews
import { parseArgs } from "node:util";
import { executeRun, closeDb, type StrategyId, type RunEvent } from "../src/index.js";

const { values: args } = parseArgs({
  options: {
    strategy: { type: "string", default: "buy_and_hold" },
    window: { type: "string", default: "demo" },
    start: { type: "string" },
    end: { type: "string" },
    mode: { type: "string", default: "normal" },
    "no-posts": { type: "boolean", default: false },
    "no-review": { type: "boolean", default: false },
    model: { type: "string" },
  },
});

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;
const usd = (x: number) => `$${x.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const short = (w: number) => `${Math.round(w * 100)}%`;

const log = (e: RunEvent) => {
  switch (e.type) {
    case "registered":
      console.log(`Registered run #${e.seq} (${e.runId})\n  hash ${e.hash}\n`);
      break;
    case "decision": {
      const d = e.decision;
      const w = Object.entries(d.targets).map(([t, x]) => `${t} ${short(x)}`).join(", ");
      console.log(`  ${d.day} (${d.shownAs.padEnd(8)}) ${w.padEnd(20)} ${(d.ms / 1000).toFixed(1)}s ${d.error ? "ERROR " + d.error : d.reason.slice(0, 110)}`);
      break;
    }
    case "day":
      for (const t of e.trades) {
        console.log(`  ${t.filledOn}  ${t.side.toUpperCase().padEnd(4)} ${t.ticker.padEnd(5)} ${t.qty.toFixed(2).padStart(9)} @ ${t.price.toFixed(2)}`);
      }
      break;
    case "graded":
      console.log(`\nGraded: ${e.counts.good} good, ${e.counts.bad} bad, ${e.counts.neutral} about even`);
      break;
    case "reviewed":
      console.log(`Reviewed: ${e.count} trades got a one-line AI review`);
      break;
    case "done": {
      const s = e.summary;
      console.table({
        "Start value": usd(s.startEquity),
        "End value": usd(s.endEquity),
        "Return": pct(s.totalReturn),
        "SPY return": pct(s.benchmarkReturn),
        "Worst drop from a high": pct(s.maxDrawdown),
        "Trades": s.trades,
        "Fees paid": usd(s.feesPaid),
      });
      console.log(`Saved and sealed\n  result hash ${e.resultHash}`);
      break;
    }
    case "failed":
      console.log(`Run failed: ${e.error}`);
      break;
  }
};

try {
  await executeRun(
    {
      strategy: args.strategy as StrategyId,
      mode: args.mode === "blind" ? "blind" : "normal",
      posts: !args["no-posts"],
      window: args.window === "control" ? "control" : "demo",
      start: args.start,
      end: args.end,
      model: args.model,
      review: !args["no-review"],
    },
    log,
  );
} finally {
  await closeDb();
}
