import { randomUUID } from "node:crypto";
import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { db } from "./db.js";
import { loadBars, sliceBars, tickerCoverage, type Bars } from "./dataset.js";
import { classify, rollingAccuracy, signalBuckets, verdict, sharpeOf, EVAL_HORIZON, HOLD_THRESHOLD, VALIDATION_SHARE, MIN_VALIDATION_DAYS, type Sample } from "./evaluation.js";
import { ModelSandbox } from "./sandbox.js";
import { codeModel } from "./strategies/code-model.js";
import { llmAgent, type LlmDecisionLog } from "./strategies/llm-agent.js";
import { runBacktest } from "./engine.js";
import { gradeTrades, type GradedTrade } from "./grade.js";
import { performance, downsample } from "./metrics.js";
import { canonicalJson, sha256 } from "./runs.js";
import { gemini, paceGeminiCall } from "./llm.js";
import { TICKER_INFO } from "./universe.js";
import type { DayRecord } from "./types.js";

export type ModelKind = "code" | "prompt";

export interface Model {
  id: string;
  name: string;
  kind: ModelKind;
  code: string | null;
  prompt: string | null;
  tickers: string[];
  trainStart: string;
  trainEnd: string;
  status: "draft" | "training" | "trained" | "failed";
  state: unknown;
  lessons: string | null;
  metrics: any;
  logs: string[] | null;
  error: string | null;
  versionHash: string | null;
  createdAt: string;
  updatedAt: string;
  trainedAt: string | null;
}

export interface ModelInput {
  name: string;
  kind: ModelKind;
  code?: string;
  prompt?: string;
  tickers: string[];
  trainStart: string;
  trainEnd: string;
}

/** Trading days a prompt model practises on (the end of its training period). Each day is one model call. */
export const PRACTICE_DAYS = 30;
/** Code models need at least this many trading days (some are held out for validation). */
export const MIN_TRAIN_DAYS = 120;

const COLS = `id, name, kind, code, prompt, tickers, to_char(train_start,'YYYY-MM-DD') AS train_start,
  to_char(train_end,'YYYY-MM-DD') AS train_end, status, state, lessons, metrics, logs, error, version_hash,
  created_at, updated_at, trained_at`;

function shape(r: any): Model {
  return {
    id: r.id, name: r.name, kind: r.kind, code: r.code, prompt: r.prompt, tickers: r.tickers,
    trainStart: r.train_start, trainEnd: r.train_end, status: r.status, state: r.state, lessons: r.lessons,
    metrics: r.metrics, logs: r.logs, error: r.error, versionHash: r.version_hash,
    createdAt: r.created_at, updatedAt: r.updated_at, trainedAt: r.trained_at,
  };
}

export async function validateModelInput(m: ModelInput): Promise<ModelInput> {
  const name = (m.name ?? "").trim();
  if (!name || name.length > 80) throw new Error("Give the model a name (up to 80 characters).");
  if (m.kind !== "code" && m.kind !== "prompt") throw new Error("Model type must be code or prompt.");
  const known = new Set(TICKER_INFO.map((t) => t.ticker));
  const tickers = [...new Set((m.tickers ?? []).map((t) => String(t).toUpperCase()))];
  if (!tickers.length) throw new Error("Pick at least one ticker.");
  if (tickers.length > 8) throw new Error("Pick at most 8 tickers.");
  const unknown = tickers.filter((t) => !known.has(t));
  if (unknown.length) throw new Error(`Unknown ticker: ${unknown.join(", ")}`);
  const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? "");
  if (!isDate(m.trainStart) || !isDate(m.trainEnd) || m.trainStart >= m.trainEnd) {
    throw new Error("Training dates must be YYYY-MM-DD, with the start before the end.");
  }
  const cov = await tickerCoverage(tickers);
  for (const t of tickers) {
    if (!cov[t]) throw new Error(`No price data for ${t}.`);
    if (cov[t].first > m.trainStart) throw new Error(`${t} only has data from ${cov[t].first}. Start training on or after that date.`);
    if (cov[t].last < m.trainEnd) throw new Error(`${t} only has data until ${cov[t].last}.`);
  }
  if (m.kind === "code" && !(m.code ?? "").trim()) throw new Error("Write the model's code (or start from a template).");
  if (m.kind === "prompt" && !(m.prompt ?? "").trim()) throw new Error("Describe the strategy in the prompt.");
  if ((m.prompt ?? "").length > 4000) throw new Error("Keep the prompt under 4,000 characters.");
  return { ...m, name, tickers };
}

export async function listModels(): Promise<Model[]> {
  const { rows } = await db().query(`SELECT ${COLS} FROM models ORDER BY updated_at DESC`);
  return rows.map(shape);
}

export async function getModel(id: string): Promise<Model | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { rows } = await db().query(`SELECT ${COLS} FROM models WHERE id = $1`, [id]);
  return rows[0] ? shape(rows[0]) : null;
}

export async function createModel(input: ModelInput): Promise<Model> {
  const m = await validateModelInput(input);
  const id = randomUUID();
  await db().query(
    `INSERT INTO models (id, name, kind, code, prompt, tickers, train_start, train_end) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, m.name, m.kind, m.kind === "code" ? m.code : null, m.kind === "prompt" ? m.prompt : null, m.tickers, m.trainStart, m.trainEnd],
  );
  return (await getModel(id))!;
}

/** Saves edits. Any change makes it a new, untrained version (earlier tests keep the old version's hash). */
export async function updateModel(id: string, input: ModelInput): Promise<Model> {
  const m = await validateModelInput(input);
  const { rowCount } = await db().query(
    `UPDATE models SET name=$2, kind=$3, code=$4, prompt=$5, tickers=$6, train_start=$7, train_end=$8,
            status='draft', state=NULL, lessons=NULL, metrics=NULL, logs=NULL, error=NULL, version_hash=NULL,
            trained_at=NULL, updated_at=now()
      WHERE id=$1 AND status <> 'training'`,
    [id, m.name, m.kind, m.kind === "code" ? m.code : null, m.kind === "prompt" ? m.prompt : null, m.tickers, m.trainStart, m.trainEnd],
  );
  if (!rowCount) throw new Error("Model not found, or it is training right now.");
  return (await getModel(id))!;
}

export type TrainEvent =
  | { type: "train-status"; message: string }
  | { type: "train-progress"; index: number; total: number; day: string; equity: number }
  | { type: "decision"; decision: LlmDecisionLog }
  | { type: "trained"; model: Model }
  | { type: "train-failed"; error: string; logs?: string[] };

/**
 * Trains a model on its training period only. Code models: train(data) in
 * the sandbox, then decide() is scored day by day on the same period.
 * Prompt models: a practice run on the end of the period, graded, then
 * turned into lessons the model carries into its tests.
 */
export async function trainModel(id: string, emit: (e: TrainEvent) => void = () => {}): Promise<Model> {
  const model = await getModel(id);
  if (!model) throw new Error("Model not found");
  await db().query(`UPDATE models SET status='training', error=NULL, updated_at=now() WHERE id=$1`, [id]);
  let sandbox: ModelSandbox | null = null;
  try {
    let result: { state: unknown; lessons: string | null; metrics: any; logs: string[]; versionHash: string };
    if (model.kind === "code") {
      emit({ type: "train-status", message: "Loading your code into the sandbox" });
      sandbox = await ModelSandbox.load(model.code ?? "");
      const data = await loadBars(model.tickers, model.trainStart, model.trainEnd);
      const n = data.dates.length;
      if (n < MIN_TRAIN_DAYS) {
        throw new Error(`Only ${n} trading days in the training period; pick at least ${MIN_TRAIN_DAYS} so some can be held out for validation.`);
      }
      // Hold out the last part of the training period: train() never sees it.
      const valDays = Math.max(MIN_VALIDATION_DAYS, Math.round(n * VALIDATION_SHARE));
      const split = n - valDays;
      const validationStart = data.dates[split];
      const fitData = sliceBars(data, 0, split - 1);
      emit({ type: "train-status", message: `Running train() on the first ${split} trading days (${data.dates[0]} to ${data.dates[split - 1]}); the last ${valDays} are held out for validation` });
      const out = await sandbox.call<any>("train", [fitData], 60_000);
      const state = out && typeof out === "object" && "state" in out ? out.state : out;
      const modelMetrics = out && typeof out === "object" && out.metrics && typeof out.metrics === "object"
        ? Object.fromEntries(Object.entries(out.metrics).filter(([, v]) => typeof v === "number" && Number.isFinite(v)).slice(0, 12))
        : {};

      // Score decide() day by day over the whole period (after a warm-up for history).
      // On each day it sees only the past, so held-out days stay unseen until they happen.
      const warmup = Math.min(60, Math.floor(split / 3));
      const from = data.dates[warmup];
      emit({ type: "train-status", message: `Scoring decide() from ${from}: training days, then the held-out days from ${validationStart}` });
      const targetsByDay = new Map<string, Record<string, number> | null>();
      const bt = await runBacktest({
        strategy: codeModel({ sandbox, state, tickers: model.tickers, preloaded: data, onTargets: (d, t) => targetsByDay.set(d, t) }),
        tradeable: model.tickers, start: from, end: model.trainEnd,
        onDay: (d, _t, index, total) => { if (index % 10 === 0 || index === total - 1) emit({ type: "train-progress", index, total, day: d.day, equity: d.equity }); },
      });
      const graded = await gradeTrades(bt.trades.map((t, i) => ({ id: i + 1, ...t })));
      const perf = await performance(bt.days, model.tickers, bt.trades.length, countGrades(graded));
      const evaluation = evaluate(buildSamples(targetsByDay, data, model.tickers), bt.days, perf.buyHold, validationStart, split, valDays, true);
      result = {
        state, lessons: null, logs: sandbox.logs.slice(-100),
        metrics: { ...stripCurve(perf), model: modelMetrics, scoredFrom: from, trainDays: n, curve: curve(bt.days, perf.buyHold), evaluation },
        versionHash: sha256(`code\n${model.code}\n${canonicalJson(state)}`),
      };
    } else {
      const { rows } = await db().query(
        `SELECT to_char(day,'YYYY-MM-DD') AS day FROM prices WHERE ticker = $1 AND day BETWEEN $2 AND $3 ORDER BY day`,
        [model.tickers[0], model.trainStart, model.trainEnd],
      );
      const days = rows.map((r) => r.day);
      if (days.length < 10) throw new Error("The training period needs at least 10 trading days.");
      const practice = days.slice(-PRACTICE_DAYS);
      emit({ type: "train-status", message: `Practice run on ${practice.length} trading days (${practice[0]} to ${practice.at(-1)}), one model call per day` });
      const agent = llmAgent({
        mode: "normal", start: practice[0], strategyPrompt: model.prompt ?? "", id: "model",
        onDecision: (decision) => emit({ type: "decision", decision }),
      });
      const bt = await runBacktest({
        strategy: agent, tradeable: model.tickers, start: practice[0], end: practice.at(-1)!,
        onDay: (d, _t, index, total) => emit({ type: "train-progress", index, total, day: d.day, equity: d.equity }),
      });
      const graded = await gradeTrades(bt.trades.map((t, i) => ({ id: i + 1, ...t })));
      emit({ type: "train-status", message: "Turning the practice run's mistakes into lessons" });
      const lessons = await writeLessons(model, graded, bt.days.at(-1)!.equity / bt.days[0].equity - 1);
      const perf = await performance(bt.days, model.tickers, bt.trades.length, countGrades(graded));
      const bars = await loadBars(model.tickers, practice[0], model.trainEnd);
      const targetsByDay = new Map<string, Record<string, number> | null>(agent.decisions.map((d) => [d.day, d.error ? null : d.targets]));
      const evaluation = evaluate(buildSamples(targetsByDay, bars, model.tickers), bt.days, perf.buyHold, null, practice.length, 0, false);
      result = {
        state: null, lessons, logs: [],
        metrics: { ...stripCurve(perf), practiceFrom: practice[0], trainDays: days.length, curve: curve(bt.days, perf.buyHold), errors: agent.decisions.filter((d) => d.error).length, evaluation },
        versionHash: sha256(`prompt\n${model.prompt}\n${lessons}`),
      };
    }
    await db().query(
      `UPDATE models SET status='trained', state=$2, lessons=$3, metrics=$4, logs=$5, version_hash=$6,
              trained_at=now(), updated_at=now(), error=NULL WHERE id=$1`,
      [id, JSON.stringify(result.state ?? null), result.lessons, JSON.stringify(result.metrics), JSON.stringify(result.logs), result.versionHash],
    );
    const trained = (await getModel(id))!;
    emit({ type: "trained", model: trained });
    return trained;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const logs = sandbox?.logs.slice(-100) ?? [];
    await db().query(`UPDATE models SET status='failed', error=$2, logs=$3, updated_at=now() WHERE id=$1`, [id, message.slice(0, 2000), JSON.stringify(logs)]);
    emit({ type: "train-failed", error: message, logs });
    throw err;
  } finally {
    await sandbox?.close();
  }
}

function countGrades(g: GradedTrade[]) {
  return { good: g.filter((t) => t.grade === "good").length, bad: g.filter((t) => t.grade === "bad").length };
}
function stripCurve<T extends { buyHold: unknown }>(p: T): Omit<T, "buyHold"> {
  const { buyHold, ...rest } = p;
  return rest;
}
function curve(days: { day: string; equity: number }[], bh: { day: string; value: number }[]) {
  const bhMap = new Map(bh.map((p) => [p.day, p.value]));
  return downsample(days.map((d) => ({ day: d.day, model: d.equity, buyHold: bhMap.get(d.day) ?? null })));
}

/** One model call: what should a prompt model do differently, given how its practice trades turned out? */
async function writeLessons(model: Model, graded: GradedTrade[], practiceReturn: number): Promise<string> {
  const bad = graded.filter((t) => t.grade === "bad").sort((a, b) => (a.edgeDollars ?? 0) - (b.edgeDollars ?? 0)).slice(0, 8);
  const good = graded.filter((t) => t.grade === "good").sort((a, b) => (b.edgeDollars ?? 0) - (a.edgeDollars ?? 0)).slice(0, 5);
  const fmt = (t: GradedTrade) => `${t.side} ${t.ticker} on ${t.filledOn}: ${t.explanation} Reason given: ${(t.reason ?? "").slice(0, 200)}`;
  const fallback = bad.length
    ? `- In practice, ${bad.length} of ${graded.length} trades lost against doing nothing. Trade less often and wait for clearer signals.`
    : "- The practice run had no losing trades worth changing.";
  if (!graded.length) return "- The practice run made no trades. If that wasn't intended, state when to buy more explicitly.";
  const agent = new Agent({
    id: "provingground-coach", name: "ProvingGround coach", model: gemini(),
    instructions: "You coach a trading agent after a practice period. Write 3 to 5 short, concrete lessons it should apply next time, based only on the trades shown. Each lesson is one sentence, an instruction, no hedging, no numbers it could not know in advance.",
  });
  const schema = z.object({ lessons: z.array(z.string()) });
  const prompt = `Strategy: ${model.prompt}\nPractice return: ${(practiceReturn * 100).toFixed(1)}%. ${graded.length} trades: ${countGrades(graded).good} good, ${countGrades(graded).bad} bad.\n\nWorst trades:\n${bad.map(fmt).join("\n") || "none"}\n\nBest trades:\n${good.map(fmt).join("\n") || "none"}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await paceGeminiCall();
      const out = await agent.generate(prompt, { structuredOutput: { schema } });
      const lessons = (out.object as z.infer<typeof schema> | undefined)?.lessons?.filter((l) => l.trim()).slice(0, 5) ?? [];
      if (lessons.length) return lessons.map((l) => `- ${l.trim()}`).join("\n");
    } catch {
      await new Promise((r) => setTimeout(r, [3000, 10000, 0][attempt]));
    }
  }
  return fallback;
}

/**
 * Turns each day's decision into one prediction per stock: the weight it
 * chose, and what the price did over the next EVAL_HORIZON trading days.
 * A "hold" (null) keeps the previous targets. Only days whose outcome falls
 * inside the training period are used.
 */
function buildSamples(targetsByDay: Map<string, Record<string, number> | null>, bars: Bars, tickers: string[]): Sample[] {
  const out: Sample[] = [];
  let current: Record<string, number> = Object.fromEntries(tickers.map((t) => [t, 0]));
  for (let i = 0; i < bars.dates.length; i++) {
    const day = bars.dates[i];
    if (!targetsByDay.has(day)) continue;
    const t = targetsByDay.get(day);
    if (t) {
      const total = tickers.reduce((s, k) => s + Math.max(0, t[k] ?? 0), 0);
      current = Object.fromEntries(tickers.map((k) => [k, Math.max(0, t[k] ?? 0) / Math.max(1, total)]));
    }
    if (i + EVAL_HORIZON >= bars.dates.length) continue;
    for (const k of tickers) {
      out.push({ day, ticker: k, weight: current[k], fwd: bars.close[k][i + EVAL_HORIZON] / bars.close[k][i] - 1 });
    }
  }
  return out;
}

function segmentReturns(days: DayRecord[], bh: { day: string; value: number }[], inSeg: (d: string) => boolean) {
  const idx = days.map((d, i) => (inSeg(d.day) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return { totalReturn: 0, buyHoldReturn: 0, sharpe: 0 };
  // Measure from the close before the segment starts, so returns chain.
  const first = Math.max(0, idx[0] - 1), last = idx.at(-1)!;
  const eq = days.slice(first, last + 1).map((d) => d.equity);
  const bhv = bh.slice(first, last + 1).map((p) => p.value);
  return { totalReturn: eq.at(-1)! / eq[0] - 1, buyHoldReturn: bhv.at(-1)! / bhv[0] - 1, sharpe: sharpeOf(eq) };
}

function evaluate(samples: Sample[], days: DayRecord[], bh: { day: string; value: number }[], validationStart: string | null, fitDays: number, validationDays: number, canOverfit: boolean) {
  const isVal = (d: string) => validationStart != null && d >= validationStart;
  const fitS = samples.filter((s) => !isVal(s.day));
  const valS = samples.filter((s) => isVal(s.day));
  const fit = { ...classify(fitS), ...segmentReturns(days, bh, (d) => !isVal(d)) };
  const validation = validationStart ? { ...classify(valS), ...segmentReturns(days, bh, isVal) } : null;
  return {
    horizon: EVAL_HORIZON,
    holdThreshold: HOLD_THRESHOLD,
    validationShare: VALIDATION_SHARE,
    validationStart,
    fitDays,
    validationDays,
    fit,
    validation,
    rolling: downsample(rollingAccuracy(samples, canOverfit ? 40 : 10), 300),
    buckets: { fit: signalBuckets(fitS), validation: validation ? signalBuckets(valS) : null },
    verdict: canOverfit && validation && valS.length && fitS.length ? verdict(fit, validation) : null,
  };
}
