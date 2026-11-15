import { createHash, randomUUID } from "node:crypto";
import { db } from "./db.js";
import type { BacktestResult, DayRecord, Trade } from "./types.js";

/** JSON with object keys sorted at every level, so the same data always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const GENESIS = "0".repeat(64);

export interface RunConfig {
  agent: string;
  mode: "normal" | "blind";
  [key: string]: unknown;
}

export interface RegisteredRun {
  id: string;
  seq: number;
  hash: string;
  prevHash: string;
}

/** The hash that registers a run: it covers the previous run's hash and this run's full settings. */
export function runHash(prevHash: string, config: RunConfig): string {
  return sha256(`${prevHash}\n${canonicalJson(config)}`);
}

/** The hash that seals a run's results. */
export function resultHash(result: { days: DayRecord[]; trades: Trade[] }): string {
  return sha256(canonicalJson({ days: result.days, trades: result.trades }));
}

/**
 * Adds a run to the log BEFORE it executes. Once registered it can't be
 * deleted or edited, so every attempt shows up, good or bad.
 */
export async function registerRun(config: RunConfig): Promise<RegisteredRun> {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    // One registration at a time, so two runs can't both chain onto the same previous run.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('provingground_run_log'))");
    const { rows: prev } = await client.query("SELECT hash FROM runs ORDER BY seq DESC LIMIT 1");
    const prevHash: string = prev[0]?.hash ?? GENESIS;
    const hash = runHash(prevHash, config);
    const id = randomUUID();
    const { rows } = await client.query(
      `INSERT INTO runs (id, agent, mode, config, prev_hash, hash, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'running') RETURNING seq`,
      [id, config.agent, config.mode, JSON.stringify(config), prevHash, hash],
    );
    await client.query("COMMIT");
    return { id, seq: Number(rows[0].seq), hash, prevHash };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Saves a finished run's days and trades, then seals it with a hash of those results. */
export async function saveRunResults(runId: string, result: BacktestResult): Promise<string> {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    await insertMany(client, "run_days", ["run_id", "day", "cash", "equity", "positions"],
      result.days.map((d) => [runId, d.day, d.cash, d.equity, JSON.stringify(d.positions)]));
    await insertMany(client, "trades", ["run_id", "decided_on", "filled_on", "ticker", "side", "qty", "price", "fee", "reason"],
      result.trades.map((t) => [runId, t.decidedOn, t.filledOn, t.ticker, t.side, t.qty, t.price, t.fee, t.reason ?? null]));
    const hash = resultHash(result);
    await client.query(
      `UPDATE runs SET status = 'done', summary = $2, result_hash = $3, finished_at = now() WHERE id = $1`,
      [runId, JSON.stringify(result.summary), hash],
    );
    await client.query("COMMIT");
    return hash;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Marks a run as failed. It stays in the log. */
export async function failRun(runId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await db().query(
    `UPDATE runs SET status = 'failed', summary = $2, finished_at = now() WHERE id = $1`,
    [runId, JSON.stringify({ error: message.slice(0, 1000) })],
  );
}

/** Loads a run's saved days and trades, in the same shape the engine produced. */
export async function loadRunResults(runId: string): Promise<{ days: DayRecord[]; trades: Trade[] }> {
  const { rows: d } = await db().query(
    `SELECT to_char(day,'YYYY-MM-DD') AS day, cash, equity, positions FROM run_days WHERE run_id = $1 ORDER BY day`,
    [runId],
  );
  const { rows: t } = await db().query(
    `SELECT to_char(decided_on,'YYYY-MM-DD') AS decided_on, to_char(filled_on,'YYYY-MM-DD') AS filled_on,
            ticker, side, qty, price, fee, reason
       FROM trades WHERE run_id = $1 ORDER BY id`,
    [runId],
  );
  return {
    days: d.map((r) => ({ day: r.day, cash: Number(r.cash), equity: Number(r.equity), positions: r.positions })),
    trades: t.map((r) => ({
      decidedOn: r.decided_on, filledOn: r.filled_on, ticker: r.ticker, side: r.side,
      qty: Number(r.qty), price: Number(r.price), fee: Number(r.fee), reason: r.reason ?? undefined,
    })),
  };
}

export interface ChainCheck {
  ok: boolean;
  runs: number;
  problems: string[];
}

/**
 * Re-checks the whole run log: every run must chain onto the one before it,
 * its settings must still match its hash, and finished runs' saved results
 * must still match their results hash.
 */
export async function verifyRunLog(): Promise<ChainCheck> {
  const { rows } = await db().query(
    "SELECT id, seq, agent, mode, config, prev_hash, hash, status, result_hash FROM runs ORDER BY seq",
  );
  const problems: string[] = [];
  let prev = GENESIS;
  for (const r of rows) {
    if (r.prev_hash !== prev) problems.push(`run #${r.seq}: does not chain onto the run before it`);
    if (runHash(r.prev_hash, r.config) !== r.hash) problems.push(`run #${r.seq}: settings no longer match its hash`);
    if (r.status === "done" && r.result_hash) {
      const saved = await loadRunResults(r.id);
      if (resultHash(saved) !== r.result_hash) problems.push(`run #${r.seq}: saved results no longer match their hash`);
    }
    prev = r.hash;
  }
  return { ok: problems.length === 0, runs: rows.length, problems };
}

async function insertMany(client: { query: (q: string, p: unknown[]) => Promise<unknown> }, table: string, cols: string[], rows: unknown[][]) {
  const BATCH = 400;
  for (let i = 0; i < rows.length; i += BATCH) {
    const params: unknown[] = [];
    const values = rows.slice(i, i + BATCH).map((r) => `(${r.map((v) => (params.push(v), `$${params.length}`)).join(",")})`);
    await client.query(`INSERT INTO ${table} (${cols.join(",")}) VALUES ${values.join(",")}`, params);
  }
}
