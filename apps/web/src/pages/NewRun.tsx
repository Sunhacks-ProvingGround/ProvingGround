import { useEffect, useMemo, useState } from "react";
import { api, modelsApi, type Model, type Run } from "../api";
import { LiveProgress, useJobEvents } from "../live";
import { longDate, navigate, pct } from "../format";

const nextDay = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const LAST_DAY = "2026-11-12";
const minDate = (a: string, b: string) => (a < b ? a : b);

const BUILT_IN = [
  { id: "llm", label: "AI agent (Gemini)", hint: "Trades AAPL and NVDA from a daily briefing of prices and investor posts." },
  { id: "buy_and_hold", label: "Buy and hold", hint: "Splits the money evenly on day one and never trades again." },
  { id: "sma_crossover", label: "Moving-average crossover", hint: "Holds a stock while its 10-day average is above its 30-day average." },
];

/** Run a test: a built-in strategy on a preset window, or one of your trained models on dates you choose. */
export function NewRun({ modelId }: { modelId?: string }) {
  const [models, setModels] = useState<Model[]>([]);
  const [choice, setChoice] = useState<string>(modelId ? `model:${modelId}` : "llm");
  const [mode, setMode] = useState<"normal" | "blind">("normal");
  const [posts, setPosts] = useState(true);
  const [windowKey, setWindowKey] = useState("demo");
  const [dates, setDates] = useState({ start: "", end: "" });
  const [tests, setTests] = useState<Run[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const job = useJobEvents(jobId);

  useEffect(() => { modelsApi.list().then((d) => setModels(d.models), () => {}); }, []);
  useEffect(() => { if (modelId) setChoice(`model:${modelId}`); }, [modelId]);

  const selectedModel = useMemo(
    () => (choice.startsWith("model:") ? models.find((m) => m.id === choice.slice(6)) ?? null : null),
    [choice, models],
  );
  const builtIn = BUILT_IN.find((b) => b.id === choice);

  // A model's test starts the first day after its training ends, for about a year by default.
  useEffect(() => {
    if (!selectedModel) return;
    const start = nextDay(selectedModel.trainEnd);
    setDates({ start, end: minDate(addDays(start, 364), LAST_DAY) });
    setMode("normal");
    modelsApi.get(selectedModel.id).then((d) => setTests(d.tests), () => setTests([]));
  }, [selectedModel?.id]);
  useEffect(() => {
    if (selectedModel && (job.status === "done" || job.status === "failed")) {
      modelsApi.get(selectedModel.id).then((d) => setTests(d.tests), () => {});
    }
  }, [job.status]);

  const busy = !!jobId && (job.status === "queued" || job.status === "running");
  const trainedModels = models.filter((m) => m.status === "trained");
  const untrained = selectedModel && selectedModel.status !== "trained";

  async function start() {
    setError("");
    setStarting(true);
    try {
      const res = selectedModel
        ? await modelsApi.test(selectedModel.id, dates.start, dates.end, mode)
        : await api.start({ strategy: choice, mode, posts, window: windowKey });
      setJobId(res.jobId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  return (
    <>
      <section>
        <h1>Run a test</h1>
        <p className="lede">
          Every run is registered in the run log with a hash of its settings before it starts, then sealed with a hash of its results.
          Good or bad, it stays there.
        </p>
      </section>

      <div className="test-layout">
        <section className="panel">
          <div className="form">
            <label className="field">
              <span>What to test</span>
              <select id="strategy" value={choice} disabled={busy} onChange={(e) => { setChoice(e.target.value); setJobId(null); setError(""); }}>
                {trainedModels.length > 0 && (
                  <optgroup label="Your models">
                    {trainedModels.map((m) => <option key={m.id} value={`model:${m.id}`}>{m.name}</option>)}
                  </optgroup>
                )}
                {selectedModel && selectedModel.status !== "trained" && (
                  <optgroup label="Not trained yet"><option value={`model:${selectedModel.id}`}>{selectedModel.name}</option></optgroup>
                )}
                <optgroup label="Built in">
                  {BUILT_IN.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                </optgroup>
              </select>
              {builtIn && <span className="hint">{builtIn.hint}</span>}
            </label>

            {selectedModel ? (
              <>
                <ModelSummary m={selectedModel} />
                {untrained ? (
                  <div className="note">This model isn't trained yet. <a href={`#/model/${selectedModel.id}`}>Train it first</a>.</div>
                ) : (
                  <>
                    <div className="row">
                      <label className="field small"><span>Test starts</span>
                        <input id="test-start" type="date" value={dates.start} min={nextDay(selectedModel.trainEnd)} max={LAST_DAY} disabled={busy}
                          onChange={(e) => setDates({ ...dates, start: e.target.value })} /></label>
                      <label className="field small"><span>Test ends</span>
                        <input id="test-end" type="date" value={dates.end} min={dates.start} max={LAST_DAY} disabled={busy}
                          onChange={(e) => setDates({ ...dates, end: e.target.value })} /></label>
                    </div>
                    <span className="hint">Starts after training ends ({longDate(selectedModel.trainEnd)}), so it is never tested on days it learned from.</span>
                    {selectedModel.kind === "prompt" && (
                      <div className="field">
                        <span>What the agent sees</span>
                        <div className="seg" role="group" aria-label="Mode">
                          <button type="button" aria-pressed={mode === "normal"} disabled={busy} onClick={() => setMode("normal")}>Real names and dates</button>
                          <button type="button" aria-pressed={mode === "blind"} disabled={busy} onClick={() => setMode("blind")}>Blind (disguised)</button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            ) : (
              <>
                {choice === "llm" && (
                  <>
                    <div className="field">
                      <span>What the agent sees</span>
                      <div className="seg" role="group" aria-label="Mode">
                        <button type="button" aria-pressed={mode === "normal"} disabled={busy} onClick={() => setMode("normal")}>Real names and dates</button>
                        <button type="button" aria-pressed={mode === "blind"} disabled={busy} onClick={() => setMode("blind")}>Blind (disguised)</button>
                      </div>
                      <span className="hint">Blind renames the stocks, rescales prices to 100, swaps dates for day numbers and redacts posts.</span>
                    </div>
                    <label className="check">
                      <input id="posts" type="checkbox" checked={posts} disabled={busy} onChange={(e) => setPosts(e.target.checked)} />
                      Include investor posts (StockTwits, 2020 only)
                    </label>
                  </>
                )}
                <div className="field">
                  <span>Test window</span>
                  <div className="seg" role="group" aria-label="Window">
                    <button type="button" aria-pressed={windowKey === "demo"} disabled={busy} onClick={() => setWindowKey("demo")}>2020 COVID crash</button>
                    <button type="button" aria-pressed={windowKey === "control"} disabled={busy} onClick={() => setWindowKey("control")}>2026 control</button>
                  </div>
                  <span className="hint">
                    {windowKey === "demo" ? "Jan 24 – Apr 20, 2020. The crash bottom (Mar 23) is two thirds of the way in." : "Jul 1 – Sep 24, 2026, after the model's training data ends."}
                  </span>
                </div>
              </>
            )}

            <div className="row">
              <button className="btn" onClick={start} disabled={starting || busy || !!untrained}>{busy ? "Running…" : "Start test"}</button>
              {(choice === "llm" || selectedModel?.kind === "prompt") && <span className="hint">One Gemini call per trading day: a few minutes on a free key.</span>}
            </div>
            {error && <div className="error">{error}</div>}
          </div>
        </section>

        <section className="panel">
          {jobId ? (
            <LiveProgress events={job.events} status={job.status} title="Running" />
          ) : (
            <div className="empty-state">
              <h2>Live progress</h2>
              <p className="muted">Start a test to watch it day by day: portfolio value, each trade, and the reasoning as it goes. When it finishes, open the report card.</p>
            </div>
          )}
        </section>
      </div>

      {selectedModel && tests.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h2>Earlier tests of {selectedModel.name}</h2><span className="muted small">{tests.length} run{tests.length === 1 ? "" : "s"}</span></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Run</th><th>Test period</th><th>Status</th><th className="num">Return</th><th className="num">SPY</th><th>Model version</th></tr></thead>
              <tbody>
                {tests.map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => navigate(`#/run/${r.id}`)}>
                    <td><a href={`#/run/${r.id}`} onClick={(e) => e.stopPropagation()}>#{r.position}</a>{r.mode === "blind" ? " · blind" : ""}</td>
                    <td className="small">{longDate(r.start)} – {longDate(r.end)}</td>
                    <td><span className={`pill ${r.status}`}>{r.status}</span></td>
                    <td className="num">{r.summary?.totalReturn != null ? pct(r.summary.totalReturn) : "–"}</td>
                    <td className="num">{r.summary?.benchmarkReturn != null ? pct(r.summary.benchmarkReturn) : "–"}</td>
                    <td className="hash">{String((r.config as any)?.params?.versionHash ?? "").slice(0, 8)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

function ModelSummary({ m }: { m: Model }) {
  const v = m.metrics?.evaluation?.verdict;
  return (
    <div className="model-summary">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>{m.name}</b>
        <a className="small" href={`#/model/${m.id}`}>Open model</a>
      </div>
      <div className="small muted">
        {m.kind === "code" ? "Code model" : "Prompt model"} · <span className="mono">{m.tickers.join(" ")}</span>
      </div>
      <div className="small muted">Trained on {longDate(m.trainStart)} – {longDate(m.trainEnd)}</div>
      {v && <span className={`pill verdict-pill ${v.level}`}>{v.title}</span>}
    </div>
  );
}
