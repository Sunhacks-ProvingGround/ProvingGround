import type { Strategy } from "../types.js";

/** Splits cash equally across the tradeable stocks on day one, then never trades again. */
export function buyAndHold(): Strategy {
  return {
    id: "buy_and_hold",
    async decide({ dayIndex, tradeable }) {
      if (dayIndex > 0) return null;
      const w = 1 / tradeable.length;
      return {
        targets: Object.fromEntries(tradeable.map((t) => [t, w])),
        reason: "Buy equal amounts of each stock and hold.",
      };
    },
  };
}
