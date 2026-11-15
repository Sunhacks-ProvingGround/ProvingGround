import { db } from "./db.js";
import { GRADE_HORIZON_DAYS } from "./universe.js";

/**
 * Trade report card.
 *
 * Each trade is compared with doing nothing over the next few trading days:
 *  - A buy is good if the stock rose more than the fee: it beat holding cash.
 *  - A sell is good if the stock fell more than the fee: it avoided a loss.
 * "edge" is how much better (or worse) the trade did than not trading, as a
 * fraction of the amount traded. Grading happens after the run and uses
 * prices the agent never saw.
 */
export const GOOD_THRESHOLD = 0.01; // +1% or better = good, -1% or worse = bad

export interface GradedTrade {
  id: number;
  decidedOn: string;
  filledOn: string;
  ticker: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  fee: number;
  amount: number;
  reason: string | null;
  laterDay: string | null;
  laterPrice: number | null;
  fwdReturn: number | null;
  edge: number | null;
  /** edge × amount: dollars gained (or lost) versus not trading. */
  edgeDollars: number | null;
  grade: "good" | "bad" | "neutral" | "ungraded";
  explanation: string;
}

export interface ReportCard {
  runId: string;
  horizonDays: number;
  trades: GradedTrade[];
  counts: { good: number; bad: number; neutral: number; ungraded: number };
  /** Sum of edgeDollars over good trades, and over bad trades. */
  goodDollars: number;
  badDollars: number;
  /** The few trades that mattered most, by absolute dollar edge. */
  biggest: GradedTrade[];
}

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
const fmtDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Grades every trade of a run, saves the grades on the trades, and returns the report card. */
export async function gradeRun(runId: string, horizon = GRADE_HORIZON_DAYS): Promise<ReportCard> {
  const { rows } = await db().query(
    `SELECT id, to_char(decided_on,'YYYY-MM-DD') AS decided_on, to_char(filled_on,'YYYY-MM-DD') AS filled_on,
            ticker, side, qty, price, fee, reason
       FROM trades WHERE run_id = $1 ORDER BY id`,
    [runId],
  );

  const trades: GradedTrade[] = [];
  for (const r of rows) {
    // The close `horizon` trading days after the fill (the fill day counts as day 0).
    const { rows: later } = await db().query(
      `SELECT to_char(day,'YYYY-MM-DD') AS day, close FROM prices
        WHERE ticker = $1 AND day > $2 ORDER BY day OFFSET $3 LIMIT 1`,
      [r.ticker, r.filled_on, horizon - 1],
    );
    const price = Number(r.price);
    const qty = Number(r.qty);
    const fee = Number(r.fee);
    const amount = qty * price;
    const feeRate = amount > 0 ? fee / amount : 0;
    const base = {
      id: Number(r.id), decidedOn: r.decided_on, filledOn: r.filled_on, ticker: r.ticker, side: r.side,
      qty, price, fee, amount, reason: r.reason,
    };

    if (!later.length) {
      trades.push({ ...base, laterDay: null, laterPrice: null, fwdReturn: null, edge: null, edgeDollars: null, grade: "ungraded",
        explanation: `Not enough later prices to grade this ${r.side}.` });
      continue;
    }
    const laterPrice = Number(later[0].close);
    const fwd = laterPrice / price - 1;
    const edge = (r.side === "buy" ? fwd : -fwd) - feeRate;
    const grade = edge >= GOOD_THRESHOLD ? "good" : edge <= -GOOD_THRESHOLD ? "bad" : "neutral";
    const move = `${horizon} trading days later it was ${laterPrice.toFixed(2)} (${pct(fwd)})`;
    const verb = r.side === "buy" ? "Bought" : "Sold";
    let verdict: string;
    if (r.side === "buy") {
      verdict = grade === "good" ? `The buy beat holding cash by ${pct(edge)}.`
        : grade === "bad" ? `Holding cash would have been ${pct(-edge).slice(1)} better.`
        : "About the same as holding cash.";
    } else {
      verdict = grade === "good" ? `Selling avoided a ${pct(-fwd).slice(1)} drop.`
        : grade === "bad" ? `Sold into a dip: holding would have been ${pct(-edge).slice(1)} better.`
        : "About the same as holding.";
    }
    trades.push({
      ...base, laterDay: later[0].day, laterPrice, fwdReturn: fwd, edge, edgeDollars: edge * amount, grade,
      explanation: `${verb} ${r.ticker} at ${price.toFixed(2)} on ${fmtDate(r.filled_on)}; ${move}. ${verdict}`,
    });
  }

  // Save the grades. (The run's seal covers what the agent did, not the grades, so this doesn't break it.)
  for (const t of trades) {
    await db().query(
      `UPDATE trades SET fwd_return = $2, edge_vs_cash = $3, grade = $4, explanation = $5 WHERE id = $1`,
      [t.id, t.fwdReturn, t.edge, t.grade, t.explanation],
    );
  }

  const count = (g: GradedTrade["grade"]) => trades.filter((t) => t.grade === g).length;
  const sum = (g: GradedTrade["grade"]) => trades.filter((t) => t.grade === g).reduce((s, t) => s + (t.edgeDollars ?? 0), 0);
  return {
    runId,
    horizonDays: horizon,
    trades,
    counts: { good: count("good"), bad: count("bad"), neutral: count("neutral"), ungraded: count("ungraded") },
    goodDollars: sum("good"),
    badDollars: sum("bad"),
    biggest: [...trades].filter((t) => t.edgeDollars != null).sort((a, b) => Math.abs(b.edgeDollars!) - Math.abs(a.edgeDollars!)).slice(0, 5),
  };
}

export interface LeakageGap {
  window: { start: string; end: string };
  model: string | null;
  normal: { runId: string; seq: number; totalReturn: number };
  blind: { runId: string; seq: number; totalReturn: number; posts: boolean };
  /** normal return minus blind return. Positive = the agent did better when it could recognise the period. */
  gap: number;
}

/**
 * The Leakage Gap for a window: the latest finished AI run in normal mode
 * against the latest finished blind run on the same window. By default both
 * runs saw investor posts (like for like); pass {posts: false} to compare
 * against the prices-only blind run instead.
 */
export async function leakageGap(start: string, end: string, opts: { posts?: boolean } = {}): Promise<LeakageGap | null> {
  const latest = async (mode: "normal" | "blind", posts?: boolean) => {
    const { rows } = await db().query(
      `SELECT id, seq, config, summary FROM runs
        WHERE agent = 'llm' AND status = 'done' AND mode = $1
          AND config->>'start' = $2 AND config->>'end' = $3
          AND ($4::boolean IS NULL OR coalesce((config->'params'->>'posts')::boolean, true) = $4)
        ORDER BY seq DESC LIMIT 1`,
      [mode, start, end, posts ?? null],
    );
    return rows[0];
  };
  const n = await latest("normal", true);
  const b = await latest("blind", opts.posts ?? true);
  if (!n || !b) return null;
  const nr = Number(n.summary.totalReturn);
  const br = Number(b.summary.totalReturn);
  return {
    window: { start, end },
    model: n.config?.params?.model ?? null,
    normal: { runId: n.id, seq: Number(n.seq), totalReturn: nr },
    blind: { runId: b.id, seq: Number(b.seq), totalReturn: br, posts: b.config?.params?.posts ?? true },
    gap: nr - br,
  };
}
