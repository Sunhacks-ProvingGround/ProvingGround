import type { Run } from "./api";

export const pct = (x: number | null | undefined, digits = 1) =>
  x == null || Number.isNaN(x) ? "–" : `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(digits)}%`;

/** Percentage points, for differences between two returns. */
export const pts = (x: number | null | undefined, digits = 1) =>
  x == null ? "–" : `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(digits)} pts`;

export const usd = (x: number | null | undefined, signed = false) => {
  if (x == null) return "–";
  const s = `$${Math.abs(x).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return signed ? `${x >= 0 ? "+" : "−"}${s}` : x < 0 ? `−${s}` : s;
};

export const shortDate = (d: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};

export const longDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function agentLabel(r: Pick<Run, "agent" | "mode" | "posts">): string {
  if (r.agent === "llm") {
    if (r.mode === "blind") return r.posts === false ? "AI agent · blind, prices only" : "AI agent · blind";
    return "AI agent · normal";
  }
  return r.agent === "buy_and_hold" ? "Buy and hold" : "Moving-average crossover";
}

export function windowLabel(start: string, end: string) {
  return `${longDate(start)} – ${longDate(end)}`;
}

export const navigate = (hash: string) => {
  window.location.hash = hash;
};
