// Runs one backtest, registers it in the run log first, and saves the results.
// Usage:
//   pnpm backtest                                   buy-and-hold on the 2020 window
//   pnpm backtest --strategy sma_crossover --window control
//   pnpm backtest --no-save                         dry run, nothing written
import { parseArgs } from "node:util";
import {
  runBacktest, registerRun, saveRunResults, failRun, closeDb,
  buyAndHold, smaCrossover, TRADE_TICKERS, BENCHMARK, DEMO_WINDOW, CONTROL_WINDOW,
  type Strategy, type RunConfig,
} from "../src/index.js";

const { values: args } = parseArgs({
  options: {
    strategy: { type: "string", default: "buy_and_hold" },
    window: { type: "string", default: "demo" },
    start: { type: "string" },
    end: { type: "string" },
    "no-save": { type: "boolean", default: false },
  },
});

const strategies: Record<string, () => Strategy> = {
  buy_and_hold: buyAndHold,
  sma_crossover: () => smaCrossover(10, 30),
};
const make = strategies[args.strategy!];
if (!make) throw new Error(`Unknown strategy "${args.strategy}". Choose: ${Object.keys(strategies).join(", ")}`);
const strategy = make();

const window = args.window === "control" ? CONTROL_WINDOW : DEMO_WINDOW;
const start = args.start ?? window.start;
const end = args.end ?? window.end;

const config: RunConfig = {
  agent: strategy.id,
  mode: "normal",
  params: strategy.params ?? {},
  tradeable: TRADE_TICKERS,
  benchmark: BENCHMARK,
  start,
  end,
  initialCash: 100_000,
  feeRate: 0.001,
  minTradeFraction: 0.01,
};

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;
const usd = (x: number) => `$${x.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

const save = !args["no-save"];
const reg = save ? await registerRun(config) : null;
if (reg) console.log(`Registered run #${reg.seq} (${reg.id})\n  hash ${reg.hash}\n`);

try {
  const result = await runBacktest({
    strategy,
    tradeable: config.tradeable as string[],
    start,
    end,
    initialCash: config.initialCash as number,
    feeRate: config.feeRate as number,
    minTradeFraction: config.minTradeFraction as number,
    onDay: (d, trades) => {
      for (const t of trades) {
        console.log(`  ${t.filledOn}  ${t.side.toUpperCase().padEnd(4)} ${t.ticker.padEnd(5)} ${t.qty.toFixed(2).padStart(9)} @ ${t.price.toFixed(2)}`);
      }
    },
  });

  const s = result.summary;
  console.log(`\n${strategy.id}, ${start} to ${end} (${s.days} trading days)`);
  console.table({
    "Start value": usd(s.startEquity),
    "End value": usd(s.endEquity),
    "Return": pct(s.totalReturn),
    "SPY return": pct(s.benchmarkReturn),
    "Worst drop from a high": pct(s.maxDrawdown),
    "Trades": s.trades,
    "Fees paid": usd(s.feesPaid),
  });

  if (reg) {
    const hash = await saveRunResults(reg.id, result);
    console.log(`Saved and sealed run #${reg.seq}\n  result hash ${hash}`);
  }
} catch (err) {
  if (reg) await failRun(reg.id, err);
  throw err;
} finally {
  await closeDb();
}
