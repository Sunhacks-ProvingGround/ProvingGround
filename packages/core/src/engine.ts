import { db } from "./db.js";
import { MarketView } from "./market-view.js";
import { BENCHMARK } from "./universe.js";
import type { BacktestResult, DayRecord, Decision, Portfolio, Strategy, Trade } from "./types.js";

export interface BacktestOptions {
  strategy: Strategy;
  /** Tickers the strategy may hold. */
  tradeable: string[];
  /** First and last simulated day (inclusive, YYYY-MM-DD). */
  start: string;
  end: string;
  benchmark?: string;
  initialCash?: number;
  /** Fee per trade as a fraction of the amount traded. 0.001 = 0.1%. */
  feeRate?: number;
  /**
   * Skip a trade smaller than this fraction of equity, so tiny drifts
   * don't cost fees every day. 0.01 = 1%.
   */
  minTradeFraction?: number;
  /** Called after each simulated day, for live progress. */
  onDay?: (day: DayRecord, tradesToday: Trade[], index: number, total: number) => void | Promise<void>;
}

type Bar = { open: number; close: number };

/**
 * Replays the market one trading day at a time.
 *
 * Timing on each day D:
 *   1. At D's open, fill the orders decided after the previous close.
 *   2. At D's close, value the portfolio.
 *   3. After D's close, the strategy decides, seeing only data up to D.
 * Orders decided on the last day are never filled.
 */
export async function runBacktest(opts: BacktestOptions): Promise<BacktestResult> {
  const benchmark = opts.benchmark ?? BENCHMARK;
  const feeRate = opts.feeRate ?? 0.001;
  const initialCash = opts.initialCash ?? 100_000;
  const minTrade = opts.minTradeFraction ?? 0.01;
  const tradeable = [...new Set(opts.tradeable)];
  const tickers = [...new Set([...tradeable, benchmark])];

  // The engine itself sees all data (it needs tomorrow's open to fill orders).
  // The strategy never gets this connection, only a MarketView.
  const { rows } = await db().query(
    `SELECT ticker, to_char(day, 'YYYY-MM-DD') AS day, open, close
       FROM prices WHERE ticker = ANY($1) AND day BETWEEN $2 AND $3
      ORDER BY day`,
    [tickers, opts.start, opts.end],
  );
  const bars = new Map<string, Map<string, Bar>>(); // day -> ticker -> bar
  for (const r of rows) {
    if (!bars.has(r.day)) bars.set(r.day, new Map());
    bars.get(r.day)!.set(r.ticker, { open: Number(r.open), close: Number(r.close) });
  }
  const calendar = [...bars.keys()].filter((d) => bars.get(d)!.has(benchmark));
  if (calendar.length < 2) throw new Error(`Not enough trading days between ${opts.start} and ${opts.end}`);
  for (const d of calendar) {
    for (const t of tickers) {
      if (!bars.get(d)!.has(t)) throw new Error(`No price for ${t} on ${d}`);
    }
  }

  let cash = initialCash;
  const positions: Record<string, number> = Object.fromEntries(tradeable.map((t) => [t, 0]));
  const days: DayRecord[] = [];
  const trades: Trade[] = [];
  let pending: { decision: Decision; decidedOn: string } | null = null;

  for (let i = 0; i < calendar.length; i++) {
    const day = calendar[i];
    const today = bars.get(day)!;
    const tradesToday: Trade[] = [];

    // 1. Fill yesterday's decision at today's open.
    if (pending) {
      const open = (t: string) => today.get(t)!.open;
      const equityAtOpen = cash + tradeable.reduce((s, t) => s + positions[t] * open(t), 0);
      const targets = cleanTargets(pending.decision.targets, tradeable);
      const deltas = tradeable
        .map((t) => ({ t, value: targets[t] * equityAtOpen - positions[t] * open(t) }))
        .filter((d) => Math.abs(d.value) >= minTrade * equityAtOpen);

      // Sells first, so their cash can pay for buys.
      for (const { t, value } of deltas.filter((d) => d.value < 0)) {
        const qty = Math.min(positions[t], -value / open(t));
        const amount = qty * open(t);
        const fee = amount * feeRate;
        positions[t] -= qty;
        cash += amount - fee;
        tradesToday.push({ decidedOn: pending.decidedOn, filledOn: day, ticker: t, side: "sell", qty, price: open(t), fee, reason: pending.decision.reason });
      }
      // Buys, scaled down if fees would push cash below zero.
      const buys = deltas.filter((d) => d.value > 0);
      const cost = buys.reduce((s, d) => s + d.value * (1 + feeRate), 0);
      const scale = cost > cash ? cash / cost : 1;
      for (const { t, value } of buys) {
        const amount = value * scale;
        if (amount <= 0) continue;
        const fee = amount * feeRate;
        const qty = amount / open(t);
        positions[t] += qty;
        cash -= amount + fee;
        tradesToday.push({ decidedOn: pending.decidedOn, filledOn: day, ticker: t, side: "buy", qty, price: open(t), fee, reason: pending.decision.reason });
      }
      if (cash < 0 && cash > -1e-6) cash = 0; // floating-point dust
      trades.push(...tradesToday);
      pending = null;
    }

    // 2. Value the portfolio at today's close.
    const close = (t: string) => today.get(t)!.close;
    const equity = cash + tradeable.reduce((s, t) => s + positions[t] * close(t), 0);
    const record: DayRecord = { day, cash, equity, positions: { ...positions } };
    days.push(record);
    await opts.onDay?.(record, tradesToday, i, calendar.length);

    // 3. Decide after the close (not on the last day: nothing would fill).
    if (i < calendar.length - 1) {
      const portfolio: Portfolio = {
        cash,
        positions: { ...positions },
        equity,
        weights: Object.fromEntries(tradeable.map((t) => [t, equity > 0 ? (positions[t] * close(t)) / equity : 0])),
      };
      const view = new MarketView(day, tickers);
      const decision = await opts.strategy.decide({ day, dayIndex: i, tradeable, view, portfolio });
      if (decision) pending = { decision, decidedOn: day };
    }
  }

  const first = bars.get(calendar[0])!.get(benchmark)!.close;
  const last = bars.get(calendar.at(-1)!)!.get(benchmark)!.close;
  return {
    days,
    trades,
    summary: {
      startEquity: initialCash,
      endEquity: days.at(-1)!.equity,
      totalReturn: days.at(-1)!.equity / initialCash - 1,
      maxDrawdown: maxDrawdown(days.map((d) => d.equity)),
      benchmarkReturn: last / first - 1,
      trades: trades.length,
      feesPaid: trades.reduce((s, t) => s + t.fee, 0),
      days: days.length,
    },
  };
}

/** Drops unknown tickers and negative weights; scales down if the total is over 1. */
export function cleanTargets(targets: Record<string, number>, tradeable: string[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(tradeable.map((t) => [t, 0]));
  for (const t of tradeable) {
    const w = Number(targets?.[t]);
    out[t] = Number.isFinite(w) && w > 0 ? w : 0;
  }
  const total = Object.values(out).reduce((s, w) => s + w, 0);
  if (total > 1) for (const t of tradeable) out[t] /= total;
  return out;
}

export function maxDrawdown(equity: number[]): number {
  let peak = -Infinity;
  let worst = 0;
  for (const e of equity) {
    peak = Math.max(peak, e);
    worst = Math.min(worst, e / peak - 1);
  }
  return worst;
}
