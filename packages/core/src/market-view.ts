import { asOf } from "./db.js";

export interface Bar {
  ticker: string;
  day: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Post {
  day: string; // YYYY-MM-DD
  ticker: string;
  text: string;
  sentiment: "bullish" | "bearish" | null;
}

/**
 * Everything an agent is allowed to know on one simulated day.
 * Every query goes through asOf(), so the database itself refuses
 * to return anything after `simDate`.
 */
export class MarketView {
  constructor(
    readonly simDate: string,
    readonly tickers: string[],
  ) {}

  /** The last `lookbackDays` trading days for one ticker, oldest first, ending on simDate. */
  async getPrices(ticker: string, lookbackDays = 30): Promise<Bar[]> {
    if (!this.tickers.includes(ticker)) throw new Error(`Unknown ticker: ${ticker}`);
    return asOf(this.simDate, async (c) => {
      const { rows } = await c.query(
        `SELECT ticker, to_char(day, 'YYYY-MM-DD') AS day, open, high, low, close, volume
           FROM prices WHERE ticker = $1
          ORDER BY day DESC LIMIT $2`,
        [ticker, lookbackDays],
      );
      return rows.map(toBar).reverse();
    });
  }

  /** Posts about one ticker from the last `days` calendar days, newest first, up to and including simDate. */
  async getPosts(ticker: string, days = 3, limit = 30): Promise<Post[]> {
    if (!this.tickers.includes(ticker)) throw new Error(`Unknown ticker: ${ticker}`);
    return asOf(this.simDate, async (c) => {
      const { rows } = await c.query(
        `SELECT to_char(day, 'YYYY-MM-DD') AS day, ticker, text, sentiment
           FROM posts
          WHERE ticker = $1 AND day > current_setting('app.sim_date')::date - $2::int
          ORDER BY day DESC, id DESC LIMIT $3`,
        [ticker, days, limit],
      );
      return rows as Post[];
    });
  }

  /** Latest close for every ticker in the universe, as of simDate. */
  async latestCloses(): Promise<Record<string, number>> {
    return asOf(this.simDate, async (c) => {
      const { rows } = await c.query(
        `SELECT DISTINCT ON (ticker) ticker, close
           FROM prices WHERE ticker = ANY($1)
          ORDER BY ticker, day DESC`,
        [this.tickers],
      );
      return Object.fromEntries(rows.map((r) => [r.ticker, Number(r.close)]));
    });
  }
}

function toBar(r: any): Bar {
  return {
    ticker: r.ticker,
    day: r.day,
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume),
  };
}
