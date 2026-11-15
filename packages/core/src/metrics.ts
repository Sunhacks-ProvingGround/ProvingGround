import { db } from "./db.js";
import { maxDrawdown } from "./engine.js";
import type { DayRecord } from "./types.js";

export interface PerformanceMetrics {
  /** Total return over the period. */
  totalReturn: number;
  /** Equal-weight buy-and-hold of the same tickers over the same days. */
  buyHoldReturn: number;
  /** totalReturn minus buyHoldReturn. */
  vsBuyHold: number;
  /** Annualised Sharpe ratio of daily returns (no risk-free rate). */
  sharpe: number;
  maxDrawdown: number;
  /** Average fraction of the portfolio held in stocks. */
  exposure: number;
  trades: number;
  /** Share of graded trades that were good (good / (good + bad)). */
  hitRate: number | null;
  days: number;
}

/** Equal-weight buy-and-hold of `tickers` from the first close of `days`, scaled to `start` dollars. */
export async function buyHoldCurve(tickers: string[], days: string[], start = 100_000): Promise<{ day: string; value: number }[]> {
  if (!days.length) return [];
  const { rows } = await db().query(
    `SELECT ticker, to_char(day,'YYYY-MM-DD') AS day, close FROM prices
      WHERE ticker = ANY($1) AND day BETWEEN $2 AND $3`,
    [tickers, days[0], days.at(-1)],
  );
  const px = new Map<string, number>();
  for (const r of rows) px.set(`${r.ticker}|${r.day}`, Number(r.close));
  const base = Object.fromEntries(tickers.map((t) => [t, px.get(`${t}|${days[0]}`) ?? NaN]));
  return days.map((d) => ({
    day: d,
    value: (start / tickers.length) * tickers.reduce((s, t) => s + (px.get(`${t}|${d}`) ?? base[t]) / base[t], 0),
  }));
}

export async function performance(days: DayRecord[], tickers: string[], trades: number, graded?: { good: number; bad: number }): Promise<PerformanceMetrics & { buyHold: { day: string; value: number }[] }> {
  const eq = days.map((d) => d.equity);
  const rets = eq.slice(1).map((v, i) => v / eq[i] - 1);
  const mean = rets.reduce((s, r) => s + r, 0) / Math.max(1, rets.length);
  const sd = Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, rets.length));
  const bh = await buyHoldCurve(tickers, days.map((d) => d.day), eq[0]);
  const totalReturn = eq.at(-1)! / eq[0] - 1;
  const buyHoldReturn = bh.length ? bh.at(-1)!.value / bh[0].value - 1 : 0;
  return {
    totalReturn,
    buyHoldReturn,
    vsBuyHold: totalReturn - buyHoldReturn,
    sharpe: sd > 0 ? (mean / sd) * Math.sqrt(252) : 0,
    maxDrawdown: maxDrawdown(eq),
    exposure: days.reduce((s, d) => s + (d.equity > 0 ? 1 - d.cash / d.equity : 0), 0) / days.length,
    trades,
    hitRate: graded && graded.good + graded.bad > 0 ? graded.good / (graded.good + graded.bad) : null,
    days: days.length,
    buyHold: bh,
  };
}

/** Keeps at most `max` points (always the first and last) so long curves stay light. */
export function downsample<T>(points: T[], max = 400): T[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]);
}
