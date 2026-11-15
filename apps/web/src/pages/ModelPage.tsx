import { useEffect, useMemo, useState } from "react";
import { modelsApi, type Model, type ModelInput, type Run, type Templates, type TickerInfo } from "../api";
import { EquityChart } from "../charts";
import { LiveProgress, useJobEvents } from "../live";
import { longDate, navigate, pct, usd } from "../format";

const DEFAULT: ModelInput = {
  name: "", kind: "code", code: "", prompt: "",
  tickers: ["AAPL", "MSFT", "NVDA", "GOOGL"], trainStart: "2015-01-02", trainEnd: "2019-12-31",
};

/** One calendar day after `d` (YYYY-MM-DD). */
const nextDay = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

export function ModelPage({ id }: { id: string }) {
  const isNew = id === "new";
  const [form, setForm] = useState<ModelInput>(DEFAULT);
  const [model, setModel] = useState<Model | null>(null);
  const [tests, setTests] = useState<Run[]>([]);
  const [tickers, setTickers] = useState<TickerInfo[]>([]);
  const [tpl, setTpl] = useState<Templates | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [trainJob, setTrainJob] = useState<string | null>(null);
  const [testJob, setTestJob] = useState<string | null>(null);
  const [test, setTest] = useState({ start: "2020-01-02", end: "2020-12-31", mode: "normal" as "normal" | "blind" });

  const train = useJobEvents(trainJob);
  const tst = useJobEvents(testJob);

  async function load(mid: string) {
    const d = await modelsApi.get(mid);
    setModel(d.model);
    setTests(d.tests);
    setForm({ name: d.model.name, kind: d.model.kind, code: d.model.code ?? "", prompt: d.model.prompt ?? "", tickers: d.model.tickers, trainStart: d.model.trainStart, trainEnd: d.model.trainEnd });
    if (d.trainJobId) setTrainJob(d.trainJobId);
    setTest((t) => (t.start <= d.model.trainEnd ? { ...t, start: nextDay(d.model.trainEnd), end: addDays(d.model.trainEnd, 365) } : t));
  }

  useEffect(() => {
    modelsApi.tickers().then((d) => setTickers(d.tickers), () => {});
    modelsApi.templates().then((t) => {
      setTpl(t);
      if (isNew) setForm((f) => ({ ...f, code: f.code || t.code[0].code, name: f.name || t.code[0].name }));
    }, () => {});
    if (!isNew) load(id).catch((e) => setError(e.message));
    else { setModel(null); setTests([]); setForm(DEFAULT); }
  }, [id]);

  // Reload the model when training or a test finishes.
  useEffect(() => { if (model && (train.status === "done" || train.status === "failed")) load(model.id).catch(() => {}); }, [train.status]);
  useEffect(() => { if (model && (tst.status === "done" || tst.status === "failed")) load(model.id).catch(() => {}); }, [tst.status]);

  const dirty = useMemo(() => {
    if (!model) return true;
    return form.name !== model.name || form.kind !== model.kind || (form.code ?? "") !== (model.code ?? "") || (form.prompt ?? "") !== (model.prompt ?? "")
      || form.tickers.join() !== model.tickers.join() || form.trainStart !== model.trainStart || form.trainEnd !== model.trainEnd;
  }, [form, model]);

  async function save(andTrain: boolean) {
    setError("");
    setSaving(true);
    try {
      let m = model;
      if (!m) m = await modelsApi.create(form);
      else if (dirty) m = await modelsApi.update(m.id, form);
      setModel(m);
      // Start training before moving to the model's own address, so the page there finds the running job.
      if (andTrain) {
        const { jobId } = await modelsApi.train(m.id);
        setTrainJob(jobId);
        setModel({ ...m, status: "training" });
      }
      if (isNew) navigate(`#/model/${m.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    if (!model) return;
    setError("");
    try {
      const { jobId } = await modelsApi.test(model.id, test.start, test.end, test.mode);
      setTestJob(jobId);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const toggleTicker = (t: string) => setForm((f) => ({
    ...f, tickers: f.tickers.includes(t) ? f.tickers.filter((x) => x !== t) : f.tickers.length >= 8 ? f.tickers : [...f.tickers, t],
  }));
  const training = model?.status === "training" || (trainJob && (train.status === "queued" || train.status === "running"));
  const testing = testJob && (tst.status === "queued" || tst.status === "running");
  const latestStart = form.tickers.map((t) => tickers.find((x) => x.ticker === t)?.first ?? "").sort().at(-1);
  const m = model?.metrics;
  const canTest = model?.status === "trained" && !dirty;

  return (
    <>
      <section>
        <div className="row small muted"><a href="#/models">Your models</a><span>/</span><span>{isNew ? "New model" : model?.name ?? "…"}</span></div>
        <div className="row" style={{ marginTop: 8, gap: 10 }}>
          <input id="model-name" className="title-input" value={form.name} placeholder="Name your model" aria-label="Model name"
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          {model && <span className={`pill ${model.status === "trained" ? "done" : model.status === "failed" ? "failed" : model.status === "training" ? "running" : "neutral"}`}>{dirty && model.status === "trained" ? "edited, needs training" : model.status}</span>}
        </div>
      </section>

      {error && <div className="error">{error}</div>}

      <section className="panel">
        <div className="panel-head"><h2>1. Data</h2><span className="muted small">Pick up to 8 tickers and the period to train on</span></div>
        <div className="chips" role="group" aria-label="Tickers">
          {tickers.map((t) => (
            <button key={t.ticker} type="button" className="chip" aria-pressed={form.tickers.includes(t.ticker)} onClick={() => toggleTicker(t.ticker)}
              title={`${t.name} · data from ${t.first}${t.posts ? " · has investor posts (2020)" : ""}`}>
              <b className="mono">{t.ticker}</b><span>{t.kind === "etf" ? "ETF" : t.name}</span>
            </button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <label className="field small"><span>Training starts</span>
            <input id="train-start" type="date" value={form.trainStart} min={latestStart} max="2026-11-12" onChange={(e) => setForm({ ...form, trainStart: e.target.value })} /></label>
          <label className="field small"><span>Training ends</span>
            <input id="train-end" type="date" value={form.trainEnd} min={form.trainStart} max="2026-11-12" onChange={(e) => setForm({ ...form, trainEnd: e.target.value })} /></label>
          <span className="hint" style={{ alignSelf: "end" }}>
            {form.tickers.length} ticker{form.tickers.length === 1 ? "" : "s"} selected{latestStart ? ` · all have data from ${longDate(latestStart)}` : ""}. Tests must start after training ends.
          </span>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>2. Model</h2>
          <div className="seg" role="group" aria-label="Model type">
            <button type="button" aria-pressed={form.kind === "code"} onClick={() => setForm({ ...form, kind: "code" })}>Code</button>
            <button type="button" aria-pressed={form.kind === "prompt"} onClick={() => setForm({ ...form, kind: "prompt", prompt: form.prompt || tpl?.promptExample || "" })}>Prompt</button>
          </div>
        </div>
        {form.kind === "code" ? (
          <div style={{ display: "grid", gap: 10 }}>
            {tpl && !tpl.customCode && <div className="note">Custom code is turned off on this server.</div>}
            <div className="row">
              <label className="small" htmlFor="template">Start from a template</label>
              <select id="template" defaultValue="" onChange={(e) => {
                const t = tpl?.code.find((x) => x.id === e.target.value);
                if (t) setForm({ ...form, code: t.code, name: form.name && form.name !== DEFAULT.name ? form.name : t.name });
                e.target.value = "";
              }}>
                <option value="" disabled>Choose…</option>
                {tpl?.code.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <span className="hint">Replaces the code below.</span>
            </div>
            <textarea id="code" className="code" spellCheck={false} value={form.code} aria-label="Model code"
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              onKeyDown={(e) => {
                if (e.key !== "Tab") return;
                e.preventDefault();
                const el = e.currentTarget, s = el.selectionStart, end = el.selectionEnd;
                const v = el.value.slice(0, s) + "  " + el.value.slice(end);
                setForm({ ...form, code: v });
                requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2; });
              }} />
            <details>
              <summary className="small">Input and output format</summary>
              <pre className="briefing" style={{ marginTop: 8 }}>{tpl?.formatDoc}</pre>
            </details>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            <p className="small muted" style={{ margin: 0 }}>
              Describe your strategy in plain English. Gemini trades it each day with only that day's prices{form.tickers.some((t) => tickers.find((x) => x.ticker === t)?.posts) ? " and investor posts" : ""}.
              Training is a graded practice run on the last {tpl?.practiceDays ?? 30} trading days of the training period; the lessons go into every test.
            </p>
            <textarea id="prompt" className="code prose" value={form.prompt} aria-label="Strategy prompt" onChange={(e) => setForm({ ...form, prompt: e.target.value })} />
          </div>
        )}
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn" disabled={saving || !!training} onClick={() => save(true)}>{training ? "Training…" : model?.status === "trained" && !dirty ? "Train again" : "Save and train"}</button>
          <button className="btn secondary" disabled={saving || !!training || !dirty} onClick={() => save(false)}>Save</button>
          {model?.status === "trained" && dirty && <span className="hint">Edits make a new version; train it before testing.</span>}
        </div>
      </section>

      {(trainJob || m || model?.status === "failed") && (
        <section className="panel">
          <div className="panel-head"><h2>3. Training results</h2>{model?.trainedAt && <span className="muted small">Trained {new Date(model.trainedAt).toLocaleString()}</span>}</div>
          {trainJob && (train.status === "queued" || train.status === "running") ? (
            <LiveProgress events={train.events} status={train.status} title="Training" />
          ) : model?.status === "failed" ? (
            <div style={{ display: "grid", gap: 10 }}>
              <div className="error">{model.error}</div>
              {!!model.logs?.length && <pre className="briefing">{model.logs.join("\n")}</pre>}
            </div>
          ) : m ? (
            <TrainingResults model={model!} />
          ) : null}
        </section>
      )}

      {model && (
        <section className="panel">
          <div className="panel-head"><h2>4. Test on a later period</h2><span className="muted small">Same tickers, $100,000 portfolio, graded trade by trade</span></div>
          <div className="row">
            <label className="field small"><span>Test starts</span>
              <input id="test-start" type="date" value={test.start} min={nextDay(model.trainEnd)} max="2026-11-12" onChange={(e) => setTest({ ...test, start: e.target.value })} /></label>
            <label className="field small"><span>Test ends</span>
              <input id="test-end" type="date" value={test.end} min={test.start} max="2026-11-12" onChange={(e) => setTest({ ...test, end: e.target.value })} /></label>
            {model.kind === "prompt" && (
              <div className="field small"><span>What the agent sees</span>
                <div className="seg" role="group" aria-label="Mode">
                  <button type="button" aria-pressed={test.mode === "normal"} onClick={() => setTest({ ...test, mode: "normal" })}>Real names</button>
                  <button type="button" aria-pressed={test.mode === "blind"} onClick={() => setTest({ ...test, mode: "blind" })}>Blind</button>
                </div>
              </div>
            )}
            <button className="btn" style={{ alignSelf: "end" }} disabled={!canTest || !!testing} onClick={runTest}>{testing ? "Testing…" : "Run test"}</button>
          </div>
          <p className="hint" style={{ margin: "8px 0 0" }}>
            {!canTest ? "Train the current version first." : `Starts after training ends (${longDate(model.trainEnd)}), so the model is never tested on days it learned from.`}
            {model.kind === "prompt" && canTest && " Each trading day is one Gemini call."}
          </p>
          {testJob && <div style={{ marginTop: 16 }}><LiveProgress events={tst.events} status={tst.status} title="Testing" /></div>}
          {tests.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 16 }}>
              <table>
                <thead><tr><th>Run</th><th>Test period</th><th>Status</th><th className="num">Return</th><th className="num">SPY</th><th>Version</th></tr></thead>
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
          )}
        </section>
      )}
    </>
  );
}

function TrainingResults({ model }: { model: Model }) {
  const m = model.metrics!;
  const curve = m.curve ?? [];
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <p className="small muted" style={{ margin: 0 }}>
        {model.kind === "code"
          ? `train() saw ${m.trainDays} trading days. decide() was then scored day by day on the training period from ${longDate(m.scoredFrom!)}, with fees.`
          : `Practice run from ${longDate(m.practiceFrom!)} to ${longDate(model.trainEnd)}, graded like a test.`}
        {" "}These are in-sample numbers: a test on later dates is the real exam.
      </p>
      <div className="stats">
        <Stat k="Return" v={pct(m.totalReturn)} />
        <Stat k="Buy and hold" v={pct(m.buyHoldReturn)} />
        <Stat k="Sharpe" v={m.sharpe.toFixed(2)} />
        <Stat k="Worst drop" v={pct(m.maxDrawdown)} />
        <Stat k="Good trades" v={m.hitRate == null ? "–" : `${Math.round(m.hitRate * 100)}%`} />
        <Stat k="Invested" v={`${Math.round(m.exposure * 100)}%`} />
      </div>
      {m.model && Object.keys(m.model).length > 0 && (
        <div className="row small">
          <span className="muted">Reported by train():</span>
          {Object.entries(m.model).map(([k, v]) => <span className="tag" key={k}>{k} {Math.abs(v) < 10 ? v.toFixed(3) : v.toFixed(0)}</span>)}
        </div>
      )}
      {curve.length > 1 && (
        <EquityChart
          baseline={curve[0].model}
          series={[
            { key: "model", label: model.name || "Model", color: "var(--s1)", width: 2.5, points: curve.map((p) => ({ day: p.day, value: p.model })) },
            { key: "bh", label: "Buy and hold, same tickers", color: "var(--s-bench)", dashed: true, points: curve.filter((p) => p.buyHold != null).map((p) => ({ day: p.day, value: p.buyHold! })) },
          ]}
        />
      )}
      {model.lessons && (
        <div>
          <h3>Lessons it carries into tests</h3>
          <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>{model.lessons.split("\n").map((l) => l.replace(/^-\s*/, "")).filter(Boolean).map((l) => <li key={l}>{l}</li>)}</ul>
        </div>
      )}
      {!!model.logs?.length && (
        <details><summary className="small">Output from log() ({model.logs.length})</summary><pre className="briefing" style={{ marginTop: 8 }}>{model.logs.join("\n")}</pre></details>
      )}
      <div className="small muted">{m.trades} trades · {usd(100_000 * (1 + m.totalReturn))} from $100,000 · version <span className="hash">{model.versionHash?.slice(0, 12)}</span></div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return <div className="stat"><div className="k">{k}</div><div className="v">{v}</div></div>;
}
