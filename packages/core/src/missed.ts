import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { db } from "./db.js";
import { gemini, paceGeminiCall } from "./llm.js";
import { GRADE_HORIZON_DAYS } from "./universe.js";
import { buyHoldCurve } from "./metrics.js";

export interface MissedMove {
  ticker: string;
  day: string;
  /** Price move over the next few trading days. */
  move: number;
  /** Share of the portfolio in this stock that day. */
  weight: number;
  /** Dollars gained or lost versus doing the opposite (approximate). */
  dollars: number;
}

export interface RunMisses {
  totalReturn: number;
  buyHoldReturn: number;
  exposure: number;
  /** Big rises it sat out (little or nothing held). */
  missedRallies: MissedMove[];
  /** Big drops it held through. */
  heldDrops: MissedMove[];
  counts: { good: number; bad: number; neutral: number };
  summary: string;
  missed: string[];
  tryNext: string[];
}

/** Picks the largest moves, at most one per ticker in any `gap`-day stretch. */
function topMoves(cands: MissedMove[], cmp: (a: MissedMove, b: MissedMove) => number, n = 3, gap = 5): MissedMove[] {
  const out: MissedMove[] = [];
  for (const c of [...cands].sort(cmp)) {
    if (out.some((o) => o.ticker === c.ticker && Math.abs(Date.parse(o.day) - Date.parse(c.day)) < gap * 1.6 * 86400000)) continue;
    if (out.filter((o) => o.ticker === c.ticker).length >= 2) continue; // keep the list from being one stock
    out.push(c);
    if (out.length === n) break;
  }
  return out;
}

/**
 * After a run: what did the model miss? Finds the biggest rallies it sat out
 * and the biggest drops it held through (judged on the following trading
 * days, which it could not see), compares it with buy-and-hold, and asks the
 * model for a short plain-English summary. Saved in run_reviews.
 */
export async function analyzeRun(runId: string, modelDescription = ""): Promise<RunMisses> {
  const { rows: [run] } = await db().query("SELECT config, summary FROM runs WHERE id = $1", [runId]);
  if (!run) throw new Error("Run not found");
  const tickers: string[] = run.config.tradeable;
  const { rows: days } = await db().query(
    `SELECT to_char(day,'YYYY-MM-DD') AS day, cash, equity, positions FROM run_days WHERE run_id = $1 ORDER BY day`, [runId]);
  const { rows: px } = await db().query(
    `SELECT ticker, to_char(day,'YYYY-MM-DD') AS day, close FROM prices
      WHERE ticker = ANY($1) AND day >= $2 ORDER BY day LIMIT $3`,
    [tickers, run.config.start, tickers.length * (days.length + GRADE_HORIZON_DAYS + 5)],
  );
  const series = new Map<string, { day: string; close: number }[]>();
  for (const r of px) (series.get(r.ticker) ?? series.set(r.ticker, []).get(r.ticker)!).push({ day: r.day, close: Number(r.close) });

  const rallies: MissedMove[] = [];
  const drops: MissedMove[] = [];
  let exposure = 0;
  for (const d of days) {
    const equity = Number(d.equity);
    exposure += equity > 0 ? 1 - Number(d.cash) / equity : 0;
    for (const t of tickers) {
      const s = series.get(t) ?? [];
      const i = s.findIndex((p) => p.day === d.day);
      if (i < 0 || i + GRADE_HORIZON_DAYS >= s.length) continue;
      const move = s[i + GRADE_HORIZON_DAYS].close / s[i].close - 1;
      const weight = (Number(d.positions?.[t] ?? 0) * s[i].close) / equity;
      const fair = equity / tickers.length; // an equal share, for sizing the miss
      if (weight < 0.05 && move > 0.03) rallies.push({ ticker: t, day: d.day, move, weight, dollars: move * fair });
      if (weight > 0.15 && move < -0.03) drops.push({ ticker: t, day: d.day, move, weight, dollars: move * weight * equity });
    }
  }
  const missedRallies = topMoves(rallies, (a, b) => b.move - a.move);
  const heldDrops = topMoves(drops, (a, b) => a.dollars - b.dollars);

  const { rows: g } = await db().query(
    `SELECT grade, count(*)::int AS n FROM trades WHERE run_id = $1 GROUP BY grade`, [runId]);
  const counts = { good: 0, bad: 0, neutral: 0 };
  for (const r of g) if (r.grade in counts) counts[r.grade as keyof typeof counts] = r.n;

  const bh = await buyHoldCurve(tickers, days.map((d) => d.day), Number(days[0]?.equity ?? 100_000));
  const totalReturn = Number(run.summary?.totalReturn ?? 0);
  const buyHoldReturn = bh.length ? bh.at(-1)!.value / bh[0].value - 1 : 0;
  const result: RunMisses = {
    totalReturn, buyHoldReturn, exposure: days.length ? exposure / days.length : 0,
    missedRallies, heldDrops, counts, summary: "", missed: [], tryNext: [],
  };

  const p = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
  const facts = [
    `Tickers: ${tickers.join(", ")}. Period ${run.config.start} to ${run.config.end}.`,
    `Model return ${p(totalReturn)}; equal-weight buy-and-hold of the same tickers ${p(buyHoldReturn)}.`,
    `Average share of the portfolio invested: ${(result.exposure * 100).toFixed(0)}%.`,
    `Trades: ${counts.good} good, ${counts.bad} bad, ${counts.neutral} about even (judged on the ${GRADE_HORIZON_DAYS} trading days after each).`,
    `Biggest rallies it sat out: ${missedRallies.map((m) => `${m.ticker} ${p(m.move)} from ${m.day}`).join("; ") || "none"}.`,
    `Biggest drops it held through: ${heldDrops.map((m) => `${m.ticker} ${p(m.move)} from ${m.day} with ${(m.weight * 100).toFixed(0)}% of the portfolio`).join("; ") || "none"}.`,
  ].join("\n");

  // Plain fallback, used if the model call fails.
  result.summary = `${totalReturn >= buyHoldReturn ? "Beat" : "Trailed"} buy-and-hold of the same stocks by ${p(Math.abs(totalReturn - buyHoldReturn)).slice(1)}, `
    + `with ${(result.exposure * 100).toFixed(0)}% of the portfolio invested on average. ${counts.good} trades helped and ${counts.bad} hurt.`;
  result.missed = [
    ...missedRallies.slice(0, 2).map((m) => `Sat out ${m.ticker}'s ${p(m.move)} rise from ${m.day}.`),
    ...heldDrops.slice(0, 2).map((m) => `Held ${m.ticker} through a ${p(m.move)} drop from ${m.day}.`),
  ];

  try {
    const agent = new Agent({
      id: "provingground-analyst", name: "ProvingGround analyst", model: gemini(),
      instructions: "You review a trading model's test after the fact. Be specific and plain: no jargon, no hedging, no emojis. Say what it got right, what it missed, and what to try in the next version. Base everything on the facts given.",
    });
    const schema = z.object({ summary: z.string(), missed: z.array(z.string()), tryNext: z.array(z.string()) });
    await paceGeminiCall();
    const out = await agent.generate(
      `${modelDescription ? `The model:\n${modelDescription.slice(0, 2500)}\n\n` : ""}Test results:\n${facts}\n\nWrite: summary (at most 70 words), missed (2-3 one-sentence points on what it missed), tryNext (2-3 one-sentence, concrete changes to try).`,
      { structuredOutput: { schema } },
    );
    const o = out.object as z.infer<typeof schema> | undefined;
    if (o?.summary) {
      result.summary = o.summary.trim();
      result.missed = o.missed.filter(Boolean).slice(0, 3);
      result.tryNext = o.tryNext.filter(Boolean).slice(0, 3);
    }
  } catch {
    // Keep the plain fallback.
  }

  await db().query(
    `INSERT INTO run_reviews (run_id, summary, missed) VALUES ($1, $2, $3)
     ON CONFLICT (run_id) DO UPDATE SET summary = EXCLUDED.summary, missed = EXCLUDED.missed, created_at = now()`,
    [runId, result.summary, JSON.stringify(result)],
  );
  return result;
}
