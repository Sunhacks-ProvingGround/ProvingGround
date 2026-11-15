import {
  db, leakageGap, verifyRunLog, agentBriefing, NormalView, BlindView, Disguise, MarketView,
  TRADE_TICKERS, BENCHMARK, GRADE_HORIZON_DAYS, WINDOWS, STRATEGIES, geminiModelId,
  type DecisionContext,
} from "@pg/core";

/** Position in the run log (1, 2, 3...), independent of database sequence gaps. */
const RUN_FIELDS = `
  r.id, r.seq, row_number() OVER (ORDER BY r.seq) AS position, r.agent, r.mode, r.status,
  r.config, r.summary - 'decisions' AS summary, r.prev_hash, r.hash, r.result_hash,
  r.created_at, r.finished_at`;

function shapeRun(r: any) {
  return {
    id: r.id,
    position: Number(r.position),
    agent: r.agent,
    mode: r.mode,
    status: r.status,
    start: r.config?.start,
    end: r.config?.end,
    model: r.config?.params?.model ?? null,
    posts: r.agent === "llm" ? (r.config?.params?.posts ?? true) : null,
    config: r.config,
    summary: r.summary,
    hash: r.hash,
    prevHash: r.prev_hash,
    resultHash: r.result_hash,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
  };
}

export async function listRuns() {
  const { rows } = await db().query(`SELECT ${RUN_FIELDS} FROM runs r ORDER BY r.seq DESC`);
  return rows.map(shapeRun);
}

export async function getRun(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { rows } = await db().query(
    `SELECT * FROM (SELECT ${RUN_FIELDS}, r.summary->'decisions' AS decisions FROM runs r) x WHERE id = $1`,
    [id],
  );
  if (!rows.length) return null;
  const run = shapeRun(rows[0]);

  const { rows: days } = await db().query(
    `SELECT to_char(day,'YYYY-MM-DD') AS day, equity, cash FROM run_days WHERE run_id = $1 ORDER BY day`, [id]);
  const { rows: trades } = await db().query(
    `SELECT id, to_char(decided_on,'YYYY-MM-DD') AS decided_on, to_char(filled_on,'YYYY-MM-DD') AS filled_on,
            ticker, side, qty, price, fee, reason, fwd_return, edge_vs_cash, grade, explanation, ai_review
       FROM trades WHERE run_id = $1 ORDER BY id`, [id]);
  const prices = await windowPrices(run.start, run.end);

  return {
    run,
    days: days.map((d) => ({ day: d.day, equity: Number(d.equity), cash: Number(d.cash) })),
    trades: trades.map((t) => {
      const amount = Number(t.qty) * Number(t.price);
      const edge = t.edge_vs_cash == null ? null : Number(t.edge_vs_cash);
      return {
        id: Number(t.id), decidedOn: t.decided_on, filledOn: t.filled_on, ticker: t.ticker, side: t.side,
        qty: Number(t.qty), price: Number(t.price), fee: Number(t.fee), amount, reason: t.reason,
        fwdReturn: t.fwd_return == null ? null : Number(t.fwd_return), edge,
        edgeDollars: edge == null ? null : edge * amount,
        grade: t.grade ?? "ungraded", explanation: t.explanation, aiReview: t.ai_review,
      };
    }),
    decisions: rows[0].decisions ?? [],
    prices,
    horizonDays: GRADE_HORIZON_DAYS,
  };
}

/** Daily closes for every ticker over a window (for charts). */
export async function windowPrices(start: string, end: string) {
  const { rows } = await db().query(
    `SELECT ticker, to_char(day,'YYYY-MM-DD') AS day, close FROM prices
      WHERE ticker = ANY($1) AND day BETWEEN $2 AND $3 ORDER BY day`,
    [[...TRADE_TICKERS, BENCHMARK], start, end],
  );
  const out: Record<string, { day: string; close: number }[]> = {};
  for (const r of rows) (out[r.ticker] ??= []).push({ day: r.day, close: Number(r.close) });
  return out;
}

/**
 * Everything the overview page needs for one window: the latest finished run
 * of each kind, their equity curves, SPY scaled to the same starting value,
 * and the Leakage Gap.
 */
export async function overview(windowKey: keyof typeof WINDOWS) {
  const w = WINDOWS[windowKey];
  const kinds = [
    { key: "normal", label: "AI agent, real names and dates", where: "agent = 'llm' AND mode = 'normal'" },
    { key: "blind", label: "AI agent, blind (with posts)", where: "agent = 'llm' AND mode = 'blind' AND coalesce((config->'params'->>'posts')::boolean, true)" },
    { key: "blindPricesOnly", label: "AI agent, blind (prices only)", where: "agent = 'llm' AND mode = 'blind' AND (config->'params'->>'posts')::boolean = false" },
    { key: "buyAndHold", label: "Buy and hold", where: "agent = 'buy_and_hold'" },
    { key: "sma", label: "Moving-average crossover", where: "agent = 'sma_crossover'" },
  ];
  const series: any[] = [];
  for (const k of kinds) {
    const { rows } = await db().query(
      `SELECT * FROM (SELECT ${RUN_FIELDS} FROM runs r) x
        WHERE status = 'done' AND config->>'start' = $1 AND config->>'end' = $2 AND ${k.where}
        ORDER BY seq DESC LIMIT 1`,
      [w.start, w.end],
    );
    if (!rows.length) continue;
    const run = shapeRun(rows[0]);
    const { rows: days } = await db().query(
      `SELECT to_char(day,'YYYY-MM-DD') AS day, equity FROM run_days WHERE run_id = $1 ORDER BY day`, [run.id]);
    series.push({ key: k.key, label: k.label, run, points: days.map((d) => ({ day: d.day, value: Number(d.equity) })) });
  }
  const prices = await windowPrices(w.start, w.end);
  const spy = prices[BENCHMARK] ?? [];
  if (spy.length) {
    series.push({
      key: "spy", label: "S&P 500 (SPY)", run: null,
      points: spy.map((p) => ({ day: p.day, value: (100_000 * p.close) / spy[0].close })),
    });
  }
  const gap = await leakageGap(w.start, w.end);
  const gapPricesOnly = await leakageGap(w.start, w.end, { posts: false });
  // The control window's gap measures what the disguise itself costs (there is
  // nothing to remember after the model's training data ends). Subtracting it
  // leaves the part of the gap that comes from memory.
  const c = WINDOWS.control;
  const controlGap = windowKey === "control" ? gap : await leakageGap(c.start, c.end);
  const memoryEffect = windowKey !== "control" && gap && controlGap ? gap.gap - controlGap.gap : null;
  return { window: { key: windowKey, ...w }, series, gap, gapPricesOnly, controlGap, memoryEffect };
}

export async function verify() {
  return verifyRunLog();
}

export function meta() {
  return {
    strategies: STRATEGIES,
    windows: Object.entries(WINDOWS).map(([key, w]) => ({ key, ...w })),
    tradeable: TRADE_TICKERS,
    benchmark: BENCHMARK,
    model: geminiModelId(),
    horizonDays: GRADE_HORIZON_DAYS,
  };
}

/** The exact briefing the agent gets on a day, in normal and blind mode. */
export async function agentPreview(day: string, windowKey: keyof typeof WINDOWS) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("day must be YYYY-MM-DD");
  const w = WINDOWS[windowKey];
  const market = new MarketView(day, [...TRADE_TICKERS, BENCHMARK]);
  const ctx: DecisionContext = {
    day, dayIndex: 0, tradeable: TRADE_TICKERS, view: market,
    portfolio: { cash: 100_000, positions: {}, equity: 100_000, weights: Object.fromEntries(TRADE_TICKERS.map((t) => [t, 0])) },
  };
  const disguise = await Disguise.create(w.start, TRADE_TICKERS, BENCHMARK);
  return {
    day,
    normal: await agentBriefing(ctx, new NormalView(market, TRADE_TICKERS, BENCHMARK)),
    blind: await agentBriefing(ctx, new BlindView(market, TRADE_TICKERS, BENCHMARK, disguise)),
  };
}
