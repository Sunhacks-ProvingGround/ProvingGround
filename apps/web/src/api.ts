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
  agent: "llm" | "buy_and_hold" | "sma_crossover";
  mode: "normal" | "blind";
  status: "queued" | "running" | "done" | "failed";
  start: string;
  end: string;
  model: string | null;
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
