/**
 * Machine-learning style evaluation of a trained model.
 *
 * Every daily decision is read as a prediction per stock: holding it (weight
 * at or above HOLD_THRESHOLD) predicts it will rise over the next HORIZON
 * trading days; not holding it predicts it won't. Comparing that with what
 * happened gives a confusion matrix, accuracy, precision, recall and F1 for
 * any model, without the model having to report anything.
 *
 * The training period is split: train() sees only the first part ("fit"),
 * the rest is held out ("validation"). Similar scores on both means the model
 * generalises; much better scores on the fit part means it overfit.
 */

export const EVAL_HORIZON = 5;
export const HOLD_THRESHOLD = 0.02;
/** Share of the training period held out for validation (at least MIN_VALIDATION_DAYS). */
export const VALIDATION_SHARE = 0.2;
export const MIN_VALIDATION_DAYS = 40;

export interface Sample {
  day: string;
  ticker: string;
  /** Target weight decided after this day's close. */
  weight: number;
  /** Price change over the next EVAL_HORIZON trading days. */
  fwd: number;
}

export interface ClassMetrics {
  n: number;
  tp: number; fp: number; fn: number; tn: number;
  accuracy: number;
  /**
   * Average of the share of rises it held and the share of falls it avoided.
   * 50% is a coin flip whatever the market did, so it is fair across periods
   * with different numbers of up days. This is what the verdict uses.
   */
  balancedAccuracy: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  /** Share of samples where the stock went up. */
  upRate: number;
  /** Accuracy of always guessing the more common outcome: the bar to beat. */
  baselineAccuracy: number;
  /** Correlation between position size and the next-5-day return (information coefficient). */
  ic: number | null;
  /** Average next-5-day return when held, and when not held. */
  avgFwdHeld: number | null;
  avgFwdNotHeld: number | null;
}

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);

function corr(x: number[], y: number[]): number | null {
  if (x.length < 3) return null;
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

export function classify(samples: Sample[]): ClassMetrics {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  const held: number[] = [], notHeld: number[] = [];
  for (const s of samples) {
    const predUp = s.weight >= HOLD_THRESHOLD;
    const up = s.fwd > 0;
    if (predUp && up) tp++; else if (predUp) fp++; else if (up) fn++; else tn++;
    (predUp ? held : notHeld).push(s.fwd);
  }
  const n = samples.length;
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  const f1 = precision != null && recall != null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;
  const upRate = n ? (tp + fn) / n : 0;
  return {
    n, tp, fp, fn, tn,
    accuracy: n ? (tp + tn) / n : 0,
    balancedAccuracy: ((tp + fn ? tp / (tp + fn) : 0.5) + (tn + fp ? tn / (tn + fp) : 0.5)) / 2,
    precision, recall, f1, upRate,
    baselineAccuracy: Math.max(upRate, 1 - upRate),
    ic: corr(samples.map((s) => s.weight), samples.map((s) => s.fwd)),
    avgFwdHeld: held.length ? mean(held) : null,
    avgFwdNotHeld: notHeld.length ? mean(notHeld) : null,
  };
}

/** Accuracy over a rolling window of trading days (all tickers pooled), one point per day. */
export function rollingAccuracy(samples: Sample[], windowDays = 60): { day: string; accuracy: number }[] {
  const days = [...new Set(samples.map((s) => s.day))].sort();
  const byDay = new Map<string, Sample[]>();
  for (const s of samples) (byDay.get(s.day) ?? byDay.set(s.day, []).get(s.day)!).push(s);
  // Balanced accuracy over the window, so 50% always means "coin flip".
  const out: { day: string; accuracy: number }[] = [];
  const c = { tp: 0, fp: 0, fn: 0, tn: 0 };
  const add = (s: Sample, k: 1 | -1) => {
    const p = s.weight >= HOLD_THRESHOLD, u = s.fwd > 0;
    if (p && u) c.tp += k; else if (p) c.fp += k; else if (u) c.fn += k; else c.tn += k;
  };
  for (let i = 0; i < days.length; i++) {
    for (const s of byDay.get(days[i])!) add(s, 1);
    if (i >= windowDays) for (const s of byDay.get(days[i - windowDays])!) add(s, -1);
    if (i >= Math.min(windowDays, days.length) - 1) {
      const tpr = c.tp + c.fn ? c.tp / (c.tp + c.fn) : 0.5;
      const tnr = c.tn + c.fp ? c.tn / (c.tn + c.fp) : 0.5;
      out.push({ day: days[i], accuracy: (tpr + tnr) / 2 });
    }
  }
  return out;
}

/** Average next-5-day return by position size: does a bigger bet mean a better outcome? */
export function signalBuckets(samples: Sample[]): { label: string; n: number; avgFwd: number | null }[] {
  const buckets = [
    { label: "Not held", lo: -Infinity, hi: HOLD_THRESHOLD },
    { label: "2–20%", lo: HOLD_THRESHOLD, hi: 0.2 },
    { label: "20–40%", lo: 0.2, hi: 0.4 },
    { label: "40%+", lo: 0.4, hi: Infinity },
  ];
  return buckets.map((b) => {
    const xs = samples.filter((s) => s.weight >= b.lo && s.weight < b.hi).map((s) => s.fwd);
    return { label: b.label, n: xs.length, avgFwd: xs.length ? mean(xs) : null };
  });
}

export interface Verdict {
  level: "generalises" | "some-overfit" | "overfit" | "no-edge";
  title: string;
  detail: string;
}

/**
 * Plain-English call on whether the model learned something that holds up on
 * held-out days. Judged on skill, not market luck: balanced accuracy (50% =
 * coin flip) and IC (does a bigger position mean a better outcome?). Sharpe
 * is shown elsewhere but not used here, because a rising market inflates it.
 */
export function verdict(fit: ClassMetrics, val: ClassMetrics): Verdict {
  const pts = (x: number) => `${(x * 100).toFixed(1)}%`;
  const fitEdge = fit.balancedAccuracy - 0.5;
  const valEdge = val.balancedAccuracy - 0.5;
  const fitIc = fit.ic ?? 0, valIc = val.ic ?? 0;
  const ba = `balanced accuracy ${pts(fit.balancedAccuracy)} on training days, ${pts(val.balancedAccuracy)} on held-out days (50% is a coin flip)`;
  if (fitEdge <= 0.02 && fitIc <= 0.05) {
    return { level: "no-edge", title: "Didn't learn a signal", detail: `Even on the days it trained on, its calls are close to a coin flip: ${ba}; IC ${fitIc.toFixed(3)}. Any profit came from the market, not from timing.` };
  }
  if (valEdge <= 0.01 && valIc <= 0.02) {
    return { level: "overfit", title: "Overfit", detail: `It found a pattern in the training days that disappears on days it never saw: ${ba}; IC ${fitIc.toFixed(3)} then ${valIc.toFixed(3)}.` };
  }
  if (fitEdge - valEdge > 0.04 || fitIc - valIc > 0.05) {
    return { level: "some-overfit", title: "Some overfitting", detail: `It keeps some skill on held-out days, but less: ${ba}; IC ${fitIc.toFixed(3)} then ${valIc.toFixed(3)}. Simplify the model or train on a longer period.` };
  }
  return { level: "generalises", title: "Generalises", detail: `Its skill holds up on days it never saw: ${ba}; IC ${fitIc.toFixed(3)} then ${valIc.toFixed(3)}.` };
}

export function sharpeOf(equity: number[]): number {
  const r = equity.slice(1).map((v, i) => v / equity[i] - 1);
  if (r.length < 2) return 0;
  const m = mean(r);
  const sd = Math.sqrt(mean(r.map((x) => (x - m) ** 2)));
  return sd > 0 ? (m / sd) * Math.sqrt(252) : 0;
}
