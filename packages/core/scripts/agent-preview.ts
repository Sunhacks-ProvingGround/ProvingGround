// Prints the exact briefing the AI agent gets on one day, in normal and blind
// mode, without calling Gemini. Use it to check the disguise.
// Usage: pnpm agent:preview [--day 2020-03-16] [--start 2020-01-24]
import { parseArgs } from "node:util";
import {
  agentBriefing, NormalView, BlindView, Disguise, MarketView, closeDb,
  TRADE_TICKERS, BENCHMARK, DEMO_WINDOW, type DecisionContext,
} from "../src/index.js";

const { values: args } = parseArgs({
  options: {
    day: { type: "string", default: "2020-03-16" },
    start: { type: "string", default: DEMO_WINDOW.start },
  },
});
const day = args.day!;
const market = new MarketView(day, [...TRADE_TICKERS, BENCHMARK]);
const ctx: DecisionContext = {
  day,
  dayIndex: 0,
  tradeable: TRADE_TICKERS,
  view: market,
  portfolio: { cash: 100_000, positions: {}, equity: 100_000, weights: { AAPL: 0, NVDA: 0 } },
};

const disguise = await Disguise.create(args.start!, TRADE_TICKERS, BENCHMARK);
const views = {
  NORMAL: new NormalView(market, TRADE_TICKERS, BENCHMARK),
  BLIND: new BlindView(market, TRADE_TICKERS, BENCHMARK, disguise),
};
for (const [label, v] of Object.entries(views)) {
  console.log(`\n========== ${label} MODE ==========\n`);
  console.log(await agentBriefing(ctx, v));
}
await closeDb();
