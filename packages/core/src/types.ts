import type { MarketView } from "./market-view.js";

/** What the agent holds at the close of a day. */
export interface Portfolio {
  cash: number;
  /** Shares held per ticker. */
  positions: Record<string, number>;
  /** Cash plus positions valued at today's close. */
  equity: number;
  /** Fraction of equity in each ticker (0 to 1). */
  weights: Record<string, number>;
}

/** Everything a strategy is given on one simulated day. */
export interface DecisionContext {
  /** The simulated day (YYYY-MM-DD). The strategy decides after this day's close. */
  day: string;
  /** 0 for the first day of the test. */
  dayIndex: number;
  /** Tickers the strategy may hold. */
  tradeable: string[];
  /** The only way to see the market. The database hides everything after `day`. */
  view: MarketView;
  portfolio: Portfolio;
}

/**
 * A strategy's decision: the fraction of equity to hold in each ticker
 * from the next open. Missing tickers mean 0. The rest stays in cash.
 * Weights must be >= 0 and add up to at most 1 (no shorting, no leverage).
 * Return `null` to hold exactly what you have.
 */
export interface Decision {
  targets: Record<string, number>;
  /** Why, in a sentence or two. Saved with every trade this decision causes. */
  reason?: string;
}

export interface Strategy {
  /** Stable id saved with the run, e.g. "buy_and_hold". */
  id: string;
  /** Settings that change the strategy's behaviour; saved with the run and part of its hash. */
  params?: Record<string, unknown>;
  decide(ctx: DecisionContext): Promise<Decision | null>;
}

export interface Trade {
  decidedOn: string;
  filledOn: string;
  ticker: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  fee: number;
  reason?: string;
}

export interface DayRecord {
  day: string;
  cash: number;
  equity: number;
  positions: Record<string, number>;
}

export interface RunSummary {
  startEquity: number;
  endEquity: number;
  /** Total return over the window, e.g. 0.12 for +12%. */
  totalReturn: number;
  /** Largest fall from a previous high, e.g. -0.25 for -25%. */
  maxDrawdown: number;
  /** Buy-and-hold return of the benchmark (SPY) over the same days. */
  benchmarkReturn: number;
  trades: number;
  feesPaid: number;
  days: number;
}

export interface BacktestResult {
  days: DayRecord[];
  trades: Trade[];
  summary: RunSummary;
}
