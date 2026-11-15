import { runBacktest } from "./engine.js";
import { registerRun, saveRunResults, failRun, type RunConfig } from "./runs.js";
import { gradeRun, type ReportCard } from "./grade.js";
import { reviewTrades } from "./review.js";
import { buyAndHold } from "./strategies/buy-and-hold.js";
import { smaCrossover } from "./strategies/sma-crossover.js";
import { llmAgent, type LlmDecisionLog } from "./strategies/llm-agent.js";
import { TRADE_TICKERS, BENCHMARK, DEMO_WINDOW, CONTROL_WINDOW } from "./universe.js";
import type { DayRecord, RunSummary, Strategy, Trade } from "./types.js";

export type StrategyId = "llm" | "buy_and_hold" | "sma_crossover";
export const STRATEGIES: { id: StrategyId; label: string }[] = [
  { id: "llm", label: "AI agent (Gemini)" },
  { id: "buy_and_hold", label: "Buy and hold" },
  { id: "sma_crossover", label: "Moving-average crossover" },
];
export const WINDOWS = {
  demo: { ...DEMO_WINDOW, label: "2020 COVID crash" },
  control: { ...CONTROL_WINDOW, label: "2026 control (after the AI's training data)" },
} as const;

export interface RunRequest {
  strategy: StrategyId;
  mode?: "normal" | "blind";
  /** Show investor posts to the AI agent (default true). */
  posts?: boolean;
  window?: keyof typeof WINDOWS;
  start?: string;
  end?: string;
  model?: string;
  /** Write a one-line AI review of each trade after grading (default true). */
  review?: boolean;
}

export type RunEvent =
  | { type: "registered"; runId: string; seq: number; hash: string; config: RunConfig }
  | { type: "decision"; decision: LlmDecisionLog }
  | { type: "day"; index: number; total: number; day: DayRecord; trades: Trade[] }
  | { type: "graded"; counts: ReportCard["counts"] }
  | { type: "reviewed"; count: number }
  | { type: "done"; runId: string; summary: RunSummary; resultHash: string }
  | { type: "failed"; runId: string; error: string };

/** The names the agent saw in blind mode, real ticker -> alias. */
export function blindAliases(tradeable = TRADE_TICKERS, bench = BENCHMARK): Record<string, string> {
  return { ...Object.fromEntries(tradeable.map((t, i) => [t, `STOCK_${String.fromCharCode(65 + i)}`])), [bench]: "INDEX" };
}

/** Checks a request and fills in defaults. Throws a readable error if something is wrong. */
export function normalizeRequest(req: RunRequest) {
  const strategy = req.strategy;
  if (!STRATEGIES.some((s) => s.id === strategy)) throw new Error(`Unknown strategy "${strategy}"`);
  const mode = req.mode === "blind" ? "blind" : "normal";
  if (mode === "blind" && strategy !== "llm") throw new Error("Blind mode only applies to the AI agent");
  const w = WINDOWS[req.window ?? "demo"];
  if (!w) throw new Error(`Unknown window "${req.window}"`);
  const start = req.start ?? w.start;
  const end = req.end ?? w.end;
  const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (!isDate(start) || !isDate(end) || start >= end) throw new Error("Dates must be YYYY-MM-DD with start before end");
  return { strategy, mode, posts: req.posts ?? true, start, end, model: req.model, review: req.review ?? true } as const;
}

/**
 * Runs one test end to end: register in the run log, replay the market, save
 * and seal the results, grade every trade, then add one-line reviews.
 * `emit` receives progress events; the returned promise resolves when done.
 */
export async function executeRun(req: RunRequest, emit: (e: RunEvent) => void = () => {}): Promise<{ runId: string; summary: RunSummary }> {
  const r = normalizeRequest(req);

  let strategy: Strategy & { decisions?: LlmDecisionLog[] };
  if (r.strategy === "llm") {
    strategy = llmAgent({
      mode: r.mode, start: r.start, model: r.model, includePosts: r.posts,
      onDecision: (decision) => emit({ type: "decision", decision }),
    });
  } else if (r.strategy === "sma_crossover") {
    strategy = smaCrossover(10, 30);
  } else {
    strategy = buyAndHold();
  }

  const config: RunConfig = {
    agent: strategy.id,
    mode: r.mode,
    params: strategy.params ?? {},
    tradeable: TRADE_TICKERS,
    benchmark: BENCHMARK,
    start: r.start,
    end: r.end,
    initialCash: 100_000,
    feeRate: 0.001,
    minTradeFraction: 0.01,
  };

  const reg = await registerRun(config);
  emit({ type: "registered", runId: reg.id, seq: reg.seq, hash: reg.hash, config });

  try {
    const result = await runBacktest({
      strategy,
      tradeable: TRADE_TICKERS,
      start: r.start,
      end: r.end,
      initialCash: 100_000,
      feeRate: 0.001,
      minTradeFraction: 0.01,
      onDay: (day, trades, index, total) => emit({ type: "day", index, total, day, trades }),
    });
    if (strategy.decisions) result.summary.decisions = strategy.decisions;
    const resultHash = await saveRunResults(reg.id, result);

    // After the seal: grading and reviews use prices the agent never saw.
    const card = await gradeRun(reg.id);
    emit({ type: "graded", counts: card.counts });
    if (r.review) {
      const reviews = await reviewTrades(card, r.mode === "blind" ? { aliases: blindAliases() } : {});
      emit({ type: "reviewed", count: Object.keys(reviews).length });
    }
    emit({ type: "done", runId: reg.id, summary: result.summary, resultHash });
    return { runId: reg.id, summary: result.summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failRun(reg.id, err).catch(() => {});
    emit({ type: "failed", runId: reg.id, error: message });
    throw err;
  }
}
