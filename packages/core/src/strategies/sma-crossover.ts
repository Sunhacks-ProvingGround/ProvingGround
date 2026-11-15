import type { Strategy } from "../types.js";

/**
 * Classic trend-following rule, per stock: hold it while its short moving
 * average is above its long one, sell it when it drops below.
 * Each stock gets an equal slice of equity when held.
 */
export function smaCrossover(short = 10, long = 30): Strategy {
  return {
    id: "sma_crossover",
    params: { short, long },
    async decide({ tradeable, view, portfolio }) {
      const targets: Record<string, number> = {};
      const notes: string[] = [];
      for (const t of tradeable) {
        const bars = await view.getPrices(t, long);
        if (bars.length < long) {
          targets[t] = portfolio.weights[t] ?? 0;
          continue;
        }
        const closes = bars.map((b) => b.close);
        const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
        const s = avg(closes.slice(-short));
        const l = avg(closes);
        const inTrend = s > l;
        targets[t] = inTrend ? 1 / tradeable.length : 0;
        notes.push(`${t} ${short}-day avg ${s.toFixed(2)} ${inTrend ? ">" : "<="} ${long}-day avg ${l.toFixed(2)}`);
      }
      // Only send a decision when something should change, so trades carry a real reason.
      const changes = tradeable.some((t) => (targets[t] > 0) !== ((portfolio.weights[t] ?? 0) > 0.001));
      return changes ? { targets, reason: notes.join("; ") } : null;
    },
  };
}
