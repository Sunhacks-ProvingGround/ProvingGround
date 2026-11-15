import { Worker } from "node:worker_threads";

/**
 * Runs user-written model code (plain JavaScript) away from the app:
 *  - in its own worker thread with a memory cap,
 *  - inside a fresh V8 context with no require, process, file or network access,
 *  - with a time limit on every call,
 *  - exchanging only JSON strings with the app.
 * This is a reasonable guard for a demo. It is not a hardened sandbox for
 * untrusted code on a public server: set CUSTOM_CODE=off there.
 */

/** Helpers available to user code as `pg`. Plain JS, evaluated inside the sandbox. */
export const SANDBOX_PRELUDE = `
const __logs = [];
function log(...a) { if (__logs.length < 200) __logs.push(a.map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(" ")); }
const pg = {
  mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; },
  std(a) { const m = pg.mean(a); return Math.sqrt(pg.mean(a.map((x) => (x - m) ** 2))); },
  sum(a) { return a.reduce((s, x) => s + x, 0); },
  last(a, n = 1) { return n === 1 ? a[a.length - 1] : a.slice(-n); },
  /** Simple returns: r[i] = p[i] / p[i-1] - 1 (length n-1). */
  returns(p) { const r = []; for (let i = 1; i < p.length; i++) r.push(p[i] / p[i - 1] - 1); return r; },
  /** Return over the last n days ending at index i (default: the end). */
  change(p, n, i = p.length - 1) { return i - n >= 0 ? p[i] / p[i - n] - 1 : 0; },
  /** Moving average of the last n values ending at index i. */
  sma(p, n, i = p.length - 1) { return i - n + 1 >= 0 ? pg.mean(p.slice(i - n + 1, i + 1)) : NaN; },
  clip(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); },
  /** Ridge regression: weights w (with intercept first) minimising |Xw - y|^2 + lambda|w|^2. */
  ridge(X, y, lambda = 1e-3) {
    const n = X.length, k = X[0].length + 1;
    const A = Array.from({ length: k }, () => new Array(k).fill(0)), b = new Array(k).fill(0);
    for (let r = 0; r < n; r++) {
      const x = [1, ...X[r]];
      for (let i = 0; i < k; i++) { b[i] += x[i] * y[r]; for (let j = 0; j < k; j++) A[i][j] += x[i] * x[j]; }
    }
    for (let i = 1; i < k; i++) A[i][i] += lambda * n;
    for (let c = 0; c < k; c++) {
      let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
      const d = A[c][c] || 1e-12;
      for (let r = 0; r < k; r++) if (r !== c) { const f = A[r][c] / d; for (let j = c; j < k; j++) A[r][j] -= f * A[c][j]; b[r] -= f * b[c]; }
    }
    return b.map((v, i) => v / (A[i][i] || 1e-12));
  },
  /** Prediction from ridge() weights. */
  predict(w, x) { return w[0] + x.reduce((s, v, i) => s + v * w[i + 1], 0); },
};
`;

const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const vm = require("node:vm");
let ctx = null;
const reply = (m) => parentPort.postMessage(m);
parentPort.on("message", (m) => {
  try {
    if (m.cmd === "load") {
      ctx = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
      vm.runInContext(workerData.prelude, ctx, { timeout: 1000, filename: "pg.js" });
      vm.runInContext(m.code, ctx, { timeout: 5000, filename: "model.js" });
      const hasTrain = vm.runInContext("typeof train === 'function'", ctx);
      const hasDecide = vm.runInContext("typeof decide === 'function'", ctx);
      reply({ id: m.id, ok: true, result: JSON.stringify({ hasTrain, hasDecide }) });
    } else if (m.cmd === "call") {
      ctx.__in = m.input;
      const out = vm.runInContext("JSON.stringify(" + m.fn + "(...JSON.parse(__in)) ?? null)", ctx, { timeout: m.timeout, filename: "model.js" });
      const logs = vm.runInContext("JSON.stringify(__logs.splice(0))", ctx);
      reply({ id: m.id, ok: true, result: out, logs });
    }
  } catch (e) {
    let logs = "[]";
    try { logs = vm.runInContext("JSON.stringify(__logs.splice(0))", ctx); } catch {}
    const msg = e && e.code === "ERR_SCRIPT_EXECUTION_TIMEOUT" ? "Timed out" : String((e && e.message) || e);
    const where = e && e.stack ? (String(e.stack).match(/model\\.js:(\\d+)/) || [])[1] : null;
    reply({ id: m.id, ok: false, error: where ? msg + " (line " + where + ")" : msg, logs });
  }
});
`;

export class ModelCodeError extends Error {
  constructor(message: string, readonly logs: string[] = []) {
    super(message);
  }
}

export class ModelSandbox {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; timer: NodeJS.Timeout }>();
  readonly logs: string[] = [];

  private constructor() {
    this.worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { prelude: SANDBOX_PRELUDE },
      resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 },
    });
    this.worker.on("message", (m) => {
      const p = this.pending.get(m.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(m.id);
      p.resolve(m);
    });
    this.worker.on("error", (err: Error) => this.failAll(err.message));
    this.worker.on("exit", () => this.failAll("The model's sandbox stopped (it may have used too much memory)."));
  }

  private failAll(message: string) {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve({ id, ok: false, error: message });
    }
    this.pending.clear();
  }

  private send(msg: object, timeoutMs: number): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      // Backstop for anything the in-sandbox timeout can't stop.
      const timer = setTimeout(() => {
        this.pending.delete(id);
        void this.worker.terminate();
        resolve({ id, ok: false, error: "Timed out" });
      }, timeoutMs + 3000);
      this.pending.set(id, { resolve, timer });
      this.worker.postMessage({ ...msg, id });
    });
  }

  static async load(code: string): Promise<ModelSandbox> {
    if (process.env.CUSTOM_CODE === "off") throw new ModelCodeError("Custom model code is turned off on this server.");
    if (code.length > 100_000) throw new ModelCodeError("Model code is too long (100 KB max).");
    const sb = new ModelSandbox();
    const res = await sb.send({ cmd: "load", code }, 5000);
    if (!res.ok) {
      await sb.close();
      throw new ModelCodeError(`Your code didn't load: ${res.error}`);
    }
    const { hasTrain, hasDecide } = JSON.parse(res.result);
    if (!hasTrain || !hasDecide) {
      await sb.close();
      throw new ModelCodeError(`Your code must define ${[!hasTrain && "function train(data)", !hasDecide && "function decide(state, history, portfolio)"].filter(Boolean).join(" and ")}.`);
    }
    return sb;
  }

  /** Calls a function defined by the user's code with JSON-serialisable arguments. */
  async call<T = unknown>(fn: "train" | "decide", args: unknown[], timeoutMs: number): Promise<T> {
    const res = await this.send({ cmd: "call", fn, input: JSON.stringify(args), timeout: timeoutMs }, timeoutMs);
    const logs: string[] = res.logs ? JSON.parse(res.logs) : [];
    this.logs.push(...logs);
    if (this.logs.length > 500) this.logs.splice(0, this.logs.length - 500);
    if (!res.ok) throw new ModelCodeError(`${fn}() failed: ${res.error}`, logs);
    return JSON.parse(res.result) as T;
  }

  async close(): Promise<void> {
    await this.worker.terminate().catch(() => {});
  }
}
