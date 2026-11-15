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
  /** One-line after-the-fact review by the model, if one was written. */
  aiReview?: string | null;
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
            ticker, side, qty, price, fee, reason, ai_review
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
      qty, price, fee, amount, reason: r.reason, aiReview: r.ai_review,
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

export interface GapSide {
  /** Average return over every finished run of this kind. */
  totalReturn: number;
  /** How many runs the average is over, and each one. */
  n: number;
  runs: { runId: string; seq: number; totalReturn: number }[];
  /** The most recent run of this kind. */
  runId: string;
  seq: number;
}

export interface LeakageGap {
  window: { start: string; end: string };
  model: string | null;
  normal: GapSide;
  blind: GapSide & { posts: boolean };
  /** Average normal return minus average blind return, in fractions (0.05 = 5 points). */
  gap: number;
}

/**
 * The Leakage Gap for a window: the average return of every finished AI run
 * in normal mode minus the average of every finished blind run, same window
 * and same model. Averaging matters: the model answers differently each time,
 * so single runs swing a lot. By default both sides saw investor posts (like
 * for like); pass {posts: false} to compare against prices-only blind runs.
 */
export async function leakageGap(start: string, end: string, opts: { posts?: boolean } = {}): Promise<LeakageGap | null> {
  const runsOf = async (mode: "normal" | "blind", posts: boolean, model: string | null) => {
    const { rows } = await db().query(
      `SELECT id, seq, config, summary FROM runs
        WHERE agent = 'llm' AND status = 'done' AND mode = $1
          AND config->>'start' = $2 AND config->>'end' = $3
          AND coalesce((config->'params'->>'posts')::boolean, true) = $4
          AND ($5::text IS NULL OR config->'params'->>'model' = $5)
        ORDER BY seq DESC`,
      [mode, start, end, posts, model],
    );
    return rows;
  };
  const side = (rows: any[]): GapSide => {
    const runs = rows.map((r) => ({ runId: r.id, seq: Number(r.seq), totalReturn: Number(r.summary.totalReturn) }));
    return {
      totalReturn: runs.reduce((a, r) => a + r.totalReturn, 0) / runs.length,
      n: runs.length,
      runs,
      runId: runs[0].runId,
      seq: runs[0].seq,
    };
  };
  // Compare like with like: the model of the most recent normal run.
  const latestNormal = await runsOf("normal", true, null);
  if (!latestNormal.length) return null;
  const model: string | null = latestNormal[0].config?.params?.model ?? null;
  const n = await runsOf("normal", true, model);
  const b = await runsOf("blind", opts.posts ?? true, model);
  if (!n.length || !b.length) return null;
  const normal = side(n);
  const blind = { ...side(b), posts: opts.posts ?? true };
  return { window: { start, end }, model, normal, blind, gap: normal.totalReturn - blind.totalReturn };
}
