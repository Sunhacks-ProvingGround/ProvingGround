import { asOf } from "./db.js";

/**
 * The data format user models receive (documented on the website).
 * Columnar: one array per field per ticker, aligned with `dates`.
 *
 *   data.dates[i]          "2019-03-04"
 *   data.close.AAPL[i]     adjusted close on that date
 *   data.open / high / low / volume, same shape
 *
 * Only dates where every ticker traded are included, oldest first.
 */
export interface Bars {
  tickers: string[];
  dates: string[];
  open: Record<string, number[]>;
  high: Record<string, number[]>;
  low: Record<string, number[]>;
  close: Record<string, number[]>;
  volume: Record<string, number[]>;
}

function toBars(tickers: string[], rows: any[]): Bars {
  const byDay = new Map<string, Map<string, any>>();
  for (const r of rows) {
    if (!byDay.has(r.day)) byDay.set(r.day, new Map());
    byDay.get(r.day)!.set(r.ticker, r);
  }
  const dates = [...byDay.keys()].filter((d) => tickers.every((t) => byDay.get(d)!.has(t))).sort();
  const field = (f: string) => Object.fromEntries(tickers.map((t) => [t, dates.map((d) => Number(byDay.get(d)!.get(t)[f]))]));
  return { tickers, dates, open: field("open"), high: field("high"), low: field("low"), close: field("close"), volume: field("volume") };
}

/**
 * Bars from `start` to `end`, read with the "no future" rule set to `end`:
 * the database itself refuses anything later, whatever the query asks.
 */
export async function loadBars(tickers: string[], start: string, end: string): Promise<Bars> {
  const rows = await asOf(end, async (c) => {
    const { rows } = await c.query(
      `SELECT ticker, to_char(day,'YYYY-MM-DD') AS day, open, high, low, close, volume
         FROM prices WHERE ticker = ANY($1) AND day >= $2 ORDER BY day`,
      [tickers, start],
    );
    return rows;
  });
  return toBars(tickers, rows);
}

/** The last `lookback` trading days up to and including `day`, read under the "no future" rule. */
export async function loadHistory(tickers: string[], day: string, lookback: number): Promise<Bars> {
  const rows = await asOf(day, async (c) => {
    const { rows } = await c.query(
      `WITH d AS (
         SELECT day FROM prices WHERE ticker = $1 ORDER BY day DESC LIMIT $3
       )
       SELECT ticker, to_char(day,'YYYY-MM-DD') AS day, open, high, low, close, volume
         FROM prices WHERE ticker = ANY($2) AND day >= (SELECT min(day) FROM d) ORDER BY day`,
      [tickers[0], tickers, lookback],
    );
    return rows;
  });
  return toBars(tickers, rows);
}

/** Bars from index `from` up to and including `to`. */
export function sliceBars(b: Bars, from: number, to: number): Bars {
  const s = Math.max(0, from);
  const e = to + 1;
  const cut = (x: Record<string, number[]>) => Object.fromEntries(Object.entries(x).map(([t, v]) => [t, v.slice(s, e)]));
  return { tickers: b.tickers, dates: b.dates.slice(s, e), open: cut(b.open), high: cut(b.high), low: cut(b.low), close: cut(b.close), volume: cut(b.volume) };
}

/** First and last date each ticker has data, for validating a chosen window. */
export async function tickerCoverage(tickers: string[]): Promise<Record<string, { first: string; last: string }>> {
  const { db } = await import("./db.js");
  const { rows } = await db().query(
    `SELECT ticker, min(day)::text AS first, max(day)::text AS last FROM prices WHERE ticker = ANY($1) GROUP BY ticker`,
    [tickers],
  );
  return Object.fromEntries(rows.map((r) => [r.ticker, { first: r.first, last: r.last }]));
}
