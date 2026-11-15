import { useEffect, useRef, useState } from "react";
import { api, type Decision, type RunRequest } from "../api";
import { EquityChart } from "../charts";
import { pct, usd, navigate, shortDate } from "../format";

type Progress = {
  status: string;
  runId?: string;
  position?: number;
  hash?: string;
  total?: number;
  index?: number;
  points: { day: string; value: number }[];
  decisions: Decision[];
  trades: number;
  graded?: { good: number; bad: number; neutral: number };
  reviewed?: number;
  summary?: { totalReturn: number; endEquity: number; benchmarkReturn: number };
  error?: string;
};

export function NewRun() {
  const [req, setReq] = useState<RunRequest>({ strategy: "llm", mode: "normal", posts: true, window: "demo" });
  const [jobId, setJobId] = useState<string | null>(null);
  const [p, setP] = useState<Progress | null>(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const source = useRef<EventSource | null>(null);

  useEffect(() => () => source.current?.close(), []);

  async function start() {
    setError("");
    setStarting(true);
    try {
      const { jobId } = await api.start(req);
      setJobId(jobId);
      follow(jobId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  function follow(id: string) {
    source.current?.close();
    const init: Progress = { status: "queued", points: [], decisions: [], trades: 0 };
    setP(init);
    const es = new EventSource(`/api/jobs/${id}/stream`);
    source.current = es;
    es.onmessage = (m) => {
      const e = JSON.parse(m.data);
      setP((prev) => {
        const s: Progress = { ...(prev ?? init) };
        switch (e.type) {
          case "status": s.status = e.status; if (e.status === "done" || e.status === "failed") es.close(); break;
          case "registered": s.runId = e.runId; s.position = undefined; s.hash = e.hash; break;
          case "day": s.total = e.total; s.index = e.index; s.points = [...s.points, { day: e.day.day, value: e.day.equity }]; s.trades += e.trades.length; break;
          case "decision": s.decisions = [e.decision, ...s.decisions].slice(0, 80); break;
          case "graded": s.graded = e.counts; break;
          case "reviewed": s.reviewed = e.count; break;
          case "done": s.summary = e.summary; break;
          case "failed": s.error = e.error; break;
        }
        return s;
      });
    };
    es.onerror = () => {
      // The browser retries on its own; if the run already finished the server ends the stream.
    };
  }

  const busy = p && (p.status === "queued" || p.status === "running");
  const isAI = req.strategy === "llm";
  const progressPct = p?.total ? Math.round(((p.index ?? 0) + 1) / p.total * 100) : 0;

  return (
    <>
      <section>
        <h1>Run a test</h1>
        <p className="lede">
          Every run is registered in the run log with a hash of its settings before it starts, then sealed with a hash of its
          results. Good or bad, it stays there.
        </p>
      </section>

      <div className="grid-2">
        <section className="panel">
          <div className="form">
            <label className="field">
              <span>Strategy</span>
              <select id="strategy" value={req.strategy} disabled={!!busy} onChange={(e) => setReq({ ...req, strategy: e.target.value, mode: e.target.value === "llm" ? req.mode : "normal" })}>
                <option value="llm">AI agent (Gemini)</option>
                <option value="buy_and_hold">Buy and hold</option>
                <option value="sma_crossover">Moving-average crossover (10/30 day)</option>
              </select>
            </label>

            {isAI && (
              <div className="field">
                <span>What the agent sees</span>
                <div className="seg" role="group" aria-label="Mode">
                  <button type="button" aria-pressed={req.mode === "normal"} disabled={!!busy} onClick={() => setReq({ ...req, mode: "normal" })}>Real names and dates</button>
                  <button type="button" aria-pressed={req.mode === "blind"} disabled={!!busy} onClick={() => setReq({ ...req, mode: "blind" })}>Blind (disguised)</button>
                </div>
                <span className="hint">Blind renames the stocks, rescales prices to 100, swaps dates for day numbers and redacts posts.</span>
              </div>
            )}

            {isAI && (
              <label className="check">
                <input id="posts" type="checkbox" checked={req.posts} disabled={!!busy} onChange={(e) => setReq({ ...req, posts: e.target.checked })} />
                Include investor posts (StockTwits, 2020 only)
              </label>
            )}

            <div className="field">
              <span>Test window</span>
              <div className="seg" role="group" aria-label="Window">
                <button type="button" aria-pressed={req.window === "demo"} disabled={!!busy} onClick={() => setReq({ ...req, window: "demo" })}>2020 COVID crash</button>
                <button type="button" aria-pressed={req.window === "control"} disabled={!!busy} onClick={() => setReq({ ...req, window: "control" })}>2026 control</button>
              </div>
              <span className="hint">
                {req.window === "demo" ? "Jan 24 – Apr 20, 2020. The crash bottom (Mar 23) is two thirds of the way in." : "Jul 1 – Sep 24, 2026, after the model's training data ends."}
              </span>
            </div>

            <div className="row">
              <button className="btn" onClick={start} disabled={starting || !!busy}>{busy ? "Running…" : "Start run"}</button>
              {isAI && <span className="hint">About 5–15 minutes on a free Gemini key (15 requests a minute); faster on a paid key.</span>}
            </div>
            {error && <div className="error">{error}</div>}
          </div>
        </section>

        <section className="panel" aria-live="polite">
          {!p ? (
            <div className="muted">
              <h2 style={{ color: "var(--ink)" }}>Live progress</h2>
              <p>Start a run to watch it day by day: the portfolio value, each trade, and the agent's reasoning as it goes.</p>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
              <div className="panel-head" style={{ margin: 0 }}>
                <h2>{p.status === "done" ? "Finished" : p.status === "failed" ? "Failed" : p.status === "queued" ? "Waiting for the previous run" : "Running"}</h2>
                <span className={`pill ${p.status}`}>{p.status}</span>
              </div>
              {p.hash && <div className="small">Registered before it ran · <span className="hash">{p.hash.slice(0, 24)}…</span></div>}
              <div>
                <div className="row small muted" style={{ justifyContent: "space-between" }}>
                  <span>Day {p.index != null ? p.index + 1 : 0} of {p.total ?? "–"}</span>
                  <span className="num">{p.points.length ? usd(p.points.at(-1)!.value) : ""}</span>
                </div>
                <div className="progress"><i style={{ width: `${progressPct}%` }} /></div>
              </div>
              {p.points.length > 1 && <EquityChart series={[{ key: "v", label: "Portfolio", color: "var(--s1)", points: p.points }]} height={160} baseline={100_000} />}
              {p.graded && (
                <div className="small">
                  Graded: <b className="ok">{p.graded.good} good</b>, <b style={{ color: "var(--bad-ink)" }}>{p.graded.bad} bad</b>, {p.graded.neutral} about even
                  {p.reviewed != null && (p.reviewed > 0 ? <> · {p.reviewed} AI reviews written</> : <> · <span className="muted">AI reviews unavailable (check GEMINI_API_KEY and the rate limit)</span></>)}
                </div>
              )}
              {p.summary && (
                <div className="row">
                  <span>Return <b className="num">{pct(p.summary.totalReturn)}</b> (SPY {pct(p.summary.benchmarkReturn)})</span>
                  {p.runId && <button className="btn secondary" onClick={() => navigate(`#/run/${p.runId}`)}>Open report card</button>}
                </div>
              )}
              {p.error && <div className="error">{p.error}</div>}
              {p.decisions.length > 0 && (
                <div>
                  <h3 style={{ marginBottom: 8 }}>The agent's reasoning</h3>
                  <div className="feed">
                    {p.decisions.map((d) => (
                      <div className="feed-item" key={d.day}>
                        <span className="d">{d.shownAs.startsWith("Day") ? d.shownAs : shortDate(d.day)}</span>
                        <span>
                          <span className="mono small">{Object.entries(d.targets).map(([t, w]) => `${t} ${Math.round(w * 100)}%`).join(" · ")}</span>
                          <br />{d.error ? <span style={{ color: "var(--bad-ink)" }}>No decision: {d.error}</span> : d.reason}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {jobId && p.status === "done" && <span className="hint">Job {jobId.slice(0, 8)}</span>}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
