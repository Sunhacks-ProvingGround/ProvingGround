import { loadHistory, sliceBars, type Bars } from "../dataset.js";
import type { ModelSandbox } from "../sandbox.js";
import type { Strategy } from "../types.js";

/** How much history decide() gets each day (trading days, today included). */
export const HISTORY_DAYS = 252;

export interface CodeModelOptions {
  id?: string;
  sandbox: ModelSandbox;
  state: unknown;
  tickers: string[];
  /**
   * Training only: bars already loaded for the training window, sliced per
   * day. Tests always read each day's history from the database under the
   * "no future" rule instead.
   */
  preloaded?: Bars;
  params?: Record<string, unknown>;
}

const pct = (w: number) => `${Math.round(w * 100)}%`;

/** A user's code model as a Strategy: each day after the close, decide(state, history, portfolio). */
export function codeModel(opts: CodeModelOptions): Strategy {
  return {
    id: opts.id ?? "model",
    params: opts.params,
    async decide(ctx) {
      let history: Bars;
      if (opts.preloaded) {
        const i = opts.preloaded.dates.lastIndexOf(ctx.day);
        if (i < 0) throw new Error(`No data for ${ctx.day}`);
        history = sliceBars(opts.preloaded, i - HISTORY_DAYS + 1, i);
      } else {
        history = await loadHistory(opts.tickers, ctx.day, HISTORY_DAYS);
      }
      const portfolio = { cash: ctx.portfolio.cash, equity: ctx.portfolio.equity, weights: ctx.portfolio.weights, day: ctx.day };
      const out = await opts.sandbox.call<any>("decide", [opts.state, history, portfolio], 2000);
      if (out == null) return null; // hold
      const raw = typeof out === "object" && out.weights && typeof out.weights === "object" ? out.weights : out;
      if (typeof raw !== "object") throw new Error("decide() must return an object of weights, e.g. { AAPL: 0.5 }");
      const targets: Record<string, number> = {};
      for (const t of opts.tickers) {
        const w = Number(raw[t] ?? 0);
        targets[t] = Number.isFinite(w) && w > 0 ? w : 0;
      }
      const reason = typeof out.reason === "string" && out.reason.trim()
        ? out.reason.slice(0, 300)
        : `Model target: ${opts.tickers.map((t) => `${t} ${pct(targets[t])}`).join(", ")}`;
      return { targets, reason };
    },
  };
}
