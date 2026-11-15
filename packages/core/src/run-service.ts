import { runBacktest } from "./engine.js";
import { registerRun, saveRunResults, failRun, type RunConfig } from "./runs.js";
import { gradeRun, type ReportCard } from "./grade.js";
import { reviewTrades } from "./review.js";
import { analyzeRun } from "./missed.js";
import { getModel, type Model } from "./models.js";
import { tickerCoverage } from "./dataset.js";
import { ModelSandbox } from "./sandbox.js";
import { buyAndHold } from "./strategies/buy-and-hold.js";
import { smaCrossover } from "./strategies/sma-crossover.js";
import { llmAgent, type LlmDecisionLog } from "./strategies/llm-agent.js";
import { codeModel } from "./strategies/code-model.js";
import { TRADE_TICKERS, BENCHMARK, DEMO_WINDOW, CONTROL_WINDOW, TICKER_INFO } from "./universe.js";
import type { DayRecord, RunSummary, Strategy, Trade } from "./types.js";

export type StrategyId = "llm" | "buy_and_hold" | "sma_crossover" | "model";
export const STRATEGIES: { id: StrategyId; label: string }[] = [
  { id: "llm", label: "AI agent (Gemini)" },
  { id: "buy_and_hold", label: "Buy and hold" },
  { id: "sma_crossover", label: "Moving-average crossover" },
  { id: "model", label: "Your model" },
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
  /** Tickers to trade (baselines and the AI agent). Models always use their own. */
  tickers?: string[];
  /** strategy "model": which trained model to test. */
  modelId?: string;
  /** Write a one-line AI review of each trade after grading (default true). */
  review?: boolean;
}

export type RunEvent =
  | { type: "registered"; runId: string; seq: number; hash: string; config: RunConfig }
  | { type: "decision"; decision: LlmDecisionLog }
  | { type: "day"; index: number; total: number; day: DayRecord; trades: Trade[] }
  | { type: "graded"; counts: ReportCard["counts"] }
  | { type: "reviewed"; count: number }
  | { type: "analyzed"; summary: string }
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
  if (mode === "blind" && strategy !== "llm" && strategy !== "model") throw new Error("Blind mode only applies to AI agents");
  const w = WINDOWS[req.window ?? "demo"];
  if (!w) throw new Error(`Unknown window "${req.window}"`);
  const start = req.start ?? w.start;
  const end = req.end ?? w.end;
  const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (!isDate(start) || !isDate(end) || start >= end) throw new Error("Dates must be YYYY-MM-DD with start before end");
  if (strategy === "model" && !req.modelId) throw new Error("Choose a model to test");
  const known = new Set(TICKER_INFO.map((t) => t.ticker));
  const tickers = req.tickers?.length ? [...new Set(req.tickers.map((t) => t.toUpperCase()))] : TRADE_TICKERS;
  if (tickers.some((t) => !known.has(t))) throw new Error(`Unknown ticker in ${tickers.join(", ")}`);
  return { strategy, mode, posts: req.posts ?? true, start, end, model: req.model, review: req.review ?? true, tickers, modelId: req.modelId } as const;
}

function describeModel(m: Model): string {
  return m.kind === "prompt"
    ? `A Gemini agent following this strategy: ${m.prompt}${m.lessons ? `\nLessons from practice:\n${m.lessons}` : ""}`
    : `Code model:\n${m.code}`;
}

/**
 * Runs one test end to end: register in the run log, replay the market, save
 * and seal the results, grade every trade, add one-line reviews, and (for
 * your models) summarise what the model missed.
 * `emit` receives progress events; the returned promise resolves when done.
 */
export async function executeRun(req: RunRequest, emit: (e: RunEvent) => void = () => {}): Promise<{ runId: string; summary: RunSummary }> {
  const r = normalizeRequest(req);
  let tickers = r.tickers;
  let model: Model | null = null;
  let sandbox: ModelSandbox | null = null;
  let strategy: Strategy & { decisions?: LlmDecisionLog[] };

  if (r.strategy === "model") {
    model = await getModel(r.modelId!);
    if (!model) throw new Error("Model not found");
    if (model.status !== "trained") throw new Error("Train the model before testing it.");
    if (r.start <= model.trainEnd) {
      throw new Error(`The test must start after the training period ends (${model.trainEnd}), so the model is never tested on days it learned from.`);
    }
    if (model.kind === "code" && r.mode === "blind") throw new Error("Blind mode applies to prompt models only; code models never see names or dates anyway.");
    tickers = model.tickers;
  }
  const cov = await tickerCoverage([...tickers, BENCHMARK]);
  for (const t of tickers) {
    if (!cov[t] || cov[t].first > r.start) throw new Error(`${t} has no data on ${r.start}${cov[t] ? ` (starts ${cov[t].first})` : ""}.`);
    if (cov[t].last < r.end) throw new Error(`${t} only has data until ${cov[t].last}.`);
  }

  if (model?.kind === "code") {
    sandbox = await ModelSandbox.load(model.code ?? "");
    strategy = codeModel({
      id: "model", sandbox, state: model.state, tickers,
      params: { modelId: model.id, modelName: model.name, kind: model.kind, versionHash: model.versionHash, trainStart: model.trainStart, trainEnd: model.trainEnd },
    });
  } else if (model?.kind === "prompt") {
    strategy = llmAgent({
      mode: r.mode, start: r.start, model: r.model, includePosts: r.posts, id: "model",
      strategyPrompt: model.prompt ?? "", lessons: model.lessons ?? "",
      extraParams: { modelId: model.id, modelName: model.name, kind: model.kind, versionHash: model.versionHash, trainStart: model.trainStart, trainEnd: model.trainEnd },
      onDecision: (decision) => emit({ type: "decision", decision }),
    });
  } else if (r.strategy === "llm") {
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
    tradeable: tickers,
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
      tradeable: tickers,
      start: r.start,
      end: r.end,
      initialCash: 100_000,
      feeRate: 0.001,
      minTradeFraction: 0.01,
      onDay: (day, trades, index, total) => emit({ type: "day", index, total, day, trades }),
    });
    if (strategy.decisions) result.summary.decisions = strategy.decisions;
    const resultHash = await saveRunResults(reg.id, result);

    // After the seal: grading, reviews and the "missed" summary use prices the agent never saw.
    const card = await gradeRun(reg.id);
    emit({ type: "graded", counts: card.counts });
    if (r.review) {
      const reviews = await reviewTrades(card, r.mode === "blind" ? { aliases: blindAliases(tickers) } : {});
      emit({ type: "reviewed", count: Object.keys(reviews).length });
    }
    if (model) {
      const misses = await analyzeRun(reg.id, describeModel(model));
      emit({ type: "analyzed", summary: misses.summary });
    }
    emit({ type: "done", runId: reg.id, summary: result.summary, resultHash });
    return { runId: reg.id, summary: result.summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failRun(reg.id, err).catch(() => {});
    emit({ type: "failed", runId: reg.id, error: message });
    throw err;
  } finally {
    await sandbox?.close();
  }
}
