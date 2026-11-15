export interface RunSummary {
  startEquity: number;
  endEquity: number;
  totalReturn: number;
  maxDrawdown: number;
  benchmarkReturn: number;
  trades: number;
  feesPaid: number;
  days: number;
  error?: string;
}
export interface Run {
  id: string;
  position: number;
  agent: "llm" | "buy_and_hold" | "sma_crossover" | "model";
  mode: "normal" | "blind";
  status: "queued" | "running" | "done" | "failed";
  start: string;
  end: string;
  model: string | null;
  modelId: string | null;
  modelName: string | null;
  modelKind: "code" | "prompt" | null;
  tickers: string[];
  posts: boolean | null;
  config: Record<string, unknown>;
  summary: RunSummary | null;
  hash: string;
  prevHash: string;
  resultHash: string | null;
  createdAt: string;
  finishedAt: string | null;
}
export interface Trade {
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
  fwdReturn: number | null;
  edge: number | null;
  edgeDollars: number | null;
  grade: "good" | "bad" | "neutral" | "ungraded";
  explanation: string | null;
  aiReview: string | null;
}
export interface Decision {
  day: string;
  shownAs: string;
  targets: Record<string, number>;
  reason: string;
  ms: number;
  error?: string;
}
export interface RunDetail {
  run: Run;
  days: { day: string; equity: number; cash: number }[];
  trades: Trade[];
  decisions: Decision[];
  prices: Record<string, { day: string; close: number }[]>;
  horizonDays: number;
  review: RunReview | null;
}
export interface GapSide {
  /** Average return over every finished run of this kind. */
  totalReturn: number;
  n: number;
  runs: { runId: string; seq: number; totalReturn: number }[];
  runId: string;
  seq: number;
}
export interface Gap {
  window: { start: string; end: string };
  model: string | null;
  normal: GapSide;
  blind: GapSide & { posts: boolean };
  gap: number;
}
export interface Series {
  key: string;
  label: string;
  run: Run | null;
  points: { day: string; value: number }[];
}
export interface Overview {
  window: { key: string; start: string; end: string; label: string };
  series: Series[];
  gap: Gap | null;
  gapPricesOnly: Gap | null;
  /** Gap on the 2026 control window: what the disguise costs with nothing to remember. */
  controlGap: Gap | null;
  /** Demo gap minus control gap: the part that comes from memory. */
  memoryEffect: number | null;
}
export interface Meta {
  strategies: { id: string; label: string }[];
  windows: { key: string; start: string; end: string; label: string }[];
  tradeable: string[];
  benchmark: string;
  model: string;
  horizonDays: number;
}
export interface RunRequest {
  strategy: string;
  mode: "normal" | "blind";
  posts: boolean;
  window: string;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  meta: () => get<Meta>("/api/meta"),
  overview: (window: string) => get<Overview>(`/api/overview?window=${encodeURIComponent(window)}`),
  runs: () => get<{ runs: Run[]; active: { id: string; status: string; seq?: number; request: RunRequest }[] }>("/api/runs"),
  run: (id: string) => get<RunDetail>(`/api/runs/${encodeURIComponent(id)}`),
  verify: () => get<{ ok: boolean; runs: number; problems: string[] }>("/api/verify"),
  preview: (day: string, window: string) => get<{ day: string; normal: string; blind: string }>(`/api/agent-preview?day=${day}&window=${window}`),
  async start(req: RunRequest): Promise<{ jobId: string }> {
    const res = await fetch("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `Couldn't start the run (${res.status})`);
    return body;
  },
};

export interface TickerInfo { ticker: string; name: string; kind: "stock" | "etf"; first: string; last: string; posts: boolean }
export interface ModelMetrics {
  totalReturn: number; buyHoldReturn: number; vsBuyHold: number; sharpe: number; maxDrawdown: number;
  exposure: number; trades: number; hitRate: number | null; days: number;
  model?: Record<string, number>; scoredFrom?: string; practiceFrom?: string; trainDays?: number; errors?: number;
  curve?: { day: string; model: number; buyHold: number | null }[];
  evaluation?: Evaluation;
}
export interface ClassMetrics {
  n: number; tp: number; fp: number; fn: number; tn: number;
  accuracy: number; balancedAccuracy: number; precision: number | null; recall: number | null; f1: number | null;
  upRate: number; baselineAccuracy: number; ic: number | null; avgFwdHeld: number | null; avgFwdNotHeld: number | null;
  totalReturn: number; buyHoldReturn: number; sharpe: number;
}
export interface Evaluation {
  horizon: number; holdThreshold: number; validationShare: number; validationStart: string | null;
  fitDays: number; validationDays: number;
  fit: ClassMetrics; validation: ClassMetrics | null;
  rolling: { day: string; accuracy: number }[];
  buckets: { fit: { label: string; n: number; avgFwd: number | null }[]; validation: { label: string; n: number; avgFwd: number | null }[] | null };
  verdict: { level: "generalises" | "some-overfit" | "overfit" | "no-edge"; title: string; detail: string } | null;
}
export interface Model {
  id: string; name: string; kind: "code" | "prompt"; code: string | null; prompt: string | null; tickers: string[];
  trainStart: string; trainEnd: string; status: "draft" | "training" | "trained" | "failed";
  lessons: string | null; metrics: ModelMetrics | null; logs: string[] | null; error: string | null;
  versionHash: string | null; createdAt: string; updatedAt: string; trainedAt: string | null;
}
export interface ModelInput { name: string; kind: "code" | "prompt"; code?: string; prompt?: string; tickers: string[]; trainStart: string; trainEnd: string }
export interface Templates {
  code: { id: string; name: string; description: string; code: string }[];
  formatDoc: string; promptExample: string; practiceDays: number; minTrainDays: number; customCode: boolean;
}
export interface RunReview {
  totalReturn: number; buyHoldReturn: number; exposure: number;
  missedRallies: { ticker: string; day: string; move: number; weight: number; dollars: number }[];
  heldDrops: { ticker: string; day: string; move: number; weight: number; dollars: number }[];
  counts: { good: number; bad: number; neutral: number };
  summary: string; missed: string[]; tryNext: string[];
}

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error ?? `Request failed (${res.status})`);
  return out as T;
}

export const modelsApi = {
  tickers: () => get<{ tickers: TickerInfo[] }>("/api/tickers"),
  templates: () => get<Templates>("/api/templates"),
  list: () => get<{ models: Model[] }>("/api/models"),
  get: (id: string) => get<{ model: Model; tests: Run[]; trainJobId: string | null }>(`/api/models/${id}`),
  create: (m: ModelInput) => send<Model>("POST", "/api/models", m),
  update: (id: string, m: ModelInput) => send<Model>("PUT", `/api/models/${id}`, m),
  train: (id: string) => send<{ jobId: string }>("POST", `/api/models/${id}/train`),
  test: (modelId: string, start: string, end: string, mode: "normal" | "blind") =>
    send<{ jobId: string }>("POST", "/api/runs", { strategy: "model", modelId, start, end, mode }),
};
