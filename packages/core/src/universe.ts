/** Stocks the agent can trade. Both have StockTwits posts for 2020. */
export const TRADE_TICKERS = ["AAPL", "NVDA"];

/** Market benchmark. The agent can see its prices but it has no posts. */
export const BENCHMARK = "SPY";

/** Everything the agent can look at. */
export const DEFAULT_TICKERS = [...TRADE_TICKERS, BENCHMARK];

/** Main test: 60 trading days around the COVID crash (bottom on 2020-03-23). */
export const DEMO_WINDOW = { start: "2020-01-24", end: "2020-04-20" };

/**
 * Control test: 60 trading days after the AI model's training data ends,
 * so it cannot remember what happened. Prices only (posts end in 2020).
 * If the Leakage Gap is large in 2020 but near zero here, the gap is memory, not noise.
 */
export const CONTROL_WINDOW = { start: "2026-07-01", end: "2026-09-24" };

/** Trading days after a trade used to grade it. */
export const GRADE_HORIZON_DAYS = 5;
