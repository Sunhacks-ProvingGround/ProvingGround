import { useEffect, useMemo, useState } from "react";
import { modelsApi, type Model, type ModelInput, type Templates, type TickerInfo } from "../api";
import { EquityChart } from "../charts";
import { LiveProgress, useJobEvents } from "../live";
import { ModelEvaluation } from "../evaluation";
import { Section, ExpandAll } from "../section";
import { longDate, navigate, pct, usd } from "../format";

const DEFAULT: ModelInput = {
  name: "", kind: "code", code: "", prompt: "",
  tickers: ["AAPL", "MSFT", "NVDA", "GOOGL"], trainStart: "2015-01-02", trainEnd: "2019-12-31",
};
const LAST_DAY = "2026-11-12";

/** Roughly where the held-out 20% starts, by calendar time (the server splits by trading days). */
function approxSplit(start: string, end: string) {
  const a = Date.parse(`${start}T12:00:00Z`), b = Date.parse(`${end}T12:00:00Z`);
  if (!(b > a)) return null;
  return new Date(a + (b - a) * 0.8).toISOString().slice(0, 10);
}

type Tab = "setup" | "results";
const monthYear = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

export function ModelPage({ id }: { id: string }) {
  const isNew = id === "new";
  const [form, setForm] = useState<ModelInput>(DEFAULT);
  const [model, setModel] = useState<Model | null>(null);
  const [tickers, setTickers] = useState<TickerInfo[]>([]);
  const [tpl, setTpl] = useState<Templates | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [trainJob, setTrainJob] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("setup");
  const [showFormat, setShowFormat] = useState(false);
  const train = useJobEvents(trainJob);

  async function load(mid: string, openResults = false) {
    const d = await modelsApi.get(mid);
    setModel(d.model);
    setForm({ name: d.model.name, kind: d.model.kind, code: d.model.code ?? "", prompt: d.model.prompt ?? "", tickers: d.model.tickers, trainStart: d.model.trainStart, trainEnd: d.model.trainEnd });
    if (d.trainJobId) { setTrainJob(d.trainJobId); setTab("results"); }
    else if (openResults && (d.model.status === "trained" || d.model.status === "failed")) setTab("results");
  }

  useEffect(() => {
    modelsApi.tickers().then((d) => setTickers(d.tickers), () => {});
    modelsApi.templates().then((t) => {
      setTpl(t);
      if (isNew) setForm((f) => ({ ...f, code: f.code || t.code[0].code, name: f.name || t.code[0].name }));
    }, () => {});
    if (!isNew) load(id, true).catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (model && (train.status === "done" || train.status === "failed")) load(model.id).catch(() => {});
  }, [train.status]);

  const dirty = useMemo(() => {
    if (!model) return true;
    return form.name !== model.name || form.kind !== model.kind || (form.code ?? "") !== (model.code ?? "") || (form.prompt ?? "") !== (model.prompt ?? "")
      || form.tickers.join() !== model.tickers.join() || form.trainStart !== model.trainStart || form.trainEnd !== model.trainEnd;
  }, [form, model]);

  const training = model?.status === "training" || (!!trainJob && (train.status === "queued" || train.status === "running"));
  const canTest = model?.status === "trained" && !dirty && !training;

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
        setTab("results");
      }
      if (isNew) navigate(`#/model/${m.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const status = model ? (dirty && model.status === "trained" ? "edited" : model.status) : "draft";
  const statusLabel: Record<string, string> = { draft: "Not trained", training: "Training", trained: "Trained", failed: "Training failed", edited: "Edited · train again" };
  const statusClass: Record<string, string> = { draft: "neutral", training: "running", trained: "done", failed: "failed", edited: "running" };
  const verdict = model?.metrics?.evaluation?.verdict;

  return (
    <>
      <section className="page-head">
        <div className="row small muted"><a href="#/models">Your models</a><span>/</span><span>{isNew ? "New model" : model?.name ?? "…"}</span></div>
        <div className="page-head-row">
          <div className="page-title">
            <input id="model-name" className="title-input" value={form.name} placeholder="Name your model" aria-label="Model name"
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <span className={`pill ${statusClass[status]}`}>{statusLabel[status]}</span>
          </div>
          <div className="actions">
            <button className="btn secondary" disabled={saving || training || (!dirty && !!model)} onClick={() => save(false)}>Save</button>
            <button className="btn secondary" disabled={saving || training} onClick={() => save(true)}>
              {training ? "Training…" : model?.status === "trained" && !dirty ? "Train again" : "Train"}
            </button>
            <button className="btn" disabled={!canTest} title={canTest ? "" : "Train the current version first"}
              onClick={() => model && navigate(`#/test/${model.id}`)}>Test this model →</button>
          </div>
        </div>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "setup"} onClick={() => setTab("setup")}>Setup</button>
          <button role="tab" aria-selected={tab === "results"} onClick={() => setTab("results")} disabled={!model}>
            Training results
            {training ? <span className="tab-dot running" /> : verdict && !dirty ? <span className={`tab-badge ${verdict.level}`}>{verdict.title}</span> : null}
          </button>
        </div>
      </section>

      {error && <div className="error">{error}</div>}

      {tab === "setup" ? (
        <Setup form={form} setForm={setForm} tickers={tickers} tpl={tpl} showFormat={showFormat} setShowFormat={setShowFormat} />
      ) : (
        <Results model={model} trainJob={trainJob} train={train} training={training} dirty={dirty} canTest={canTest} onTrain={() => save(true)} />
      )}
    </>
  );
}

function Setup({ form, setForm, tickers, tpl, showFormat, setShowFormat }: {
  form: ModelInput; setForm: (f: ModelInput) => void; tickers: TickerInfo[]; tpl: Templates | null;
  showFormat: boolean; setShowFormat: (b: boolean) => void;
}) {
  const toggle = (t: string) => setForm({
    ...form, tickers: form.tickers.includes(t) ? form.tickers.filter((x) => x !== t) : form.tickers.length >= 8 ? form.tickers : [...form.tickers, t],
  });
  const latestStart = form.tickers.map((t) => tickers.find((x) => x.ticker === t)?.first ?? "").sort().at(-1);
  const split = approxSplit(form.trainStart, form.trainEnd);
  const groups: [string, TickerInfo[]][] = [["ETFs", tickers.filter((t) => t.kind === "etf")], ["Stocks", tickers.filter((t) => t.kind === "stock")]];

  return (
    <>
      <ExpandAll />
      <Section id="setup-data" title="Data" subtitle="The stocks your model trades and the period it learns from"
        meta={`${form.tickers.length} / 8 tickers · ${monthYear(form.trainStart)} – ${monthYear(form.trainEnd)}`}>
        {groups.map(([label, list]) => (
          <div key={label} className="ticker-group">
            <span className="group-label">{label}</span>
            <div className="chips" role="group" aria-label={label}>
              {list.map((t) => (
                <button key={t.ticker} type="button" className="chip" aria-pressed={form.tickers.includes(t.ticker)} onClick={() => toggle(t.ticker)}
                  title={`${t.name} · data from ${t.first}${t.posts ? " · has investor posts (2020)" : ""}`}>
                  <b className="mono">{t.ticker}</b>{t.kind === "stock" && <span>{t.name}</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="period">
          <label className="field small"><span>Training starts</span>
            <input id="train-start" type="date" value={form.trainStart} min={latestStart} max={LAST_DAY} onChange={(e) => setForm({ ...form, trainStart: e.target.value })} /></label>
          <span className="period-arrow" aria-hidden>→</span>
          <label className="field small"><span>Training ends</span>
            <input id="train-end" type="date" value={form.trainEnd} min={form.trainStart} max={LAST_DAY} onChange={(e) => setForm({ ...form, trainEnd: e.target.value })} /></label>
          {form.kind === "code" && split && (
            <div className="split-bar" aria-label="How the training period is used">
              <div className="split-fit"><span>Learns from (80%)</span><b>{monthYear(form.trainStart)} – ≈{monthYear(split)}</b></div>
              <div className="split-val"><span>Held out to check (20%)</span><b>≈{monthYear(split)} – {monthYear(form.trainEnd)}</b></div>
            </div>
          )}
        </div>
        {latestStart && <p className="hint" style={{ margin: 0 }}>All selected tickers have data from {longDate(latestStart)}. Tests run on dates after training ends.</p>}
      </Section>

      <Section id="setup-model" title="Model"
        subtitle={form.kind === "code" ? "JavaScript with train() and decide(). Runs in a sandbox." : "Your strategy in plain English. Gemini trades it day by day."}
        meta={form.kind === "code" ? `Code · ${(form.code ?? "").split("\n").length} lines` : `Prompt · ${(form.prompt ?? "").trim().split(/\s+/).filter(Boolean).length} words`}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="seg" role="group" aria-label="Model type">
            <button type="button" aria-pressed={form.kind === "code"} onClick={() => setForm({ ...form, kind: "code" })}>Code</button>
            <button type="button" aria-pressed={form.kind === "prompt"} onClick={() => setForm({ ...form, kind: "prompt", prompt: form.prompt || tpl?.promptExample || "" })}>Prompt</button>
          </div>
          {form.kind === "code" && (
            <select id="template" aria-label="Start from a template" defaultValue="" onChange={(e) => {
              const t = tpl?.code.find((x) => x.id === e.target.value);
              if (t) setForm({ ...form, code: t.code, name: form.name || t.name });
              e.target.value = "";
            }}>
              <option value="" disabled>Load a template…</option>
              {tpl?.code.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
        </div>
        {form.kind === "code" ? (
          <>
            {tpl && !tpl.customCode && <div className="note">Custom code is turned off on this server.</div>}
            <div className="editor-wrap">
              <textarea id="code" className="code" spellCheck={false} value={form.code} aria-label="Model code"
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key !== "Tab") return;
                  e.preventDefault();
                  const el = e.currentTarget, s = el.selectionStart, end = el.selectionEnd;
                  setForm({ ...form, code: el.value.slice(0, s) + "  " + el.value.slice(end) });
                  requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2; });
                }} />
            </div>
          </>
        ) : (
          <>
            <textarea id="prompt" className="code prose" value={form.prompt} aria-label="Strategy prompt" onChange={(e) => setForm({ ...form, prompt: e.target.value })} />
            <p className="hint" style={{ margin: 0 }}>
              Training is a graded practice run on the last {tpl?.practiceDays ?? 30} trading days of the training period; Gemini turns the mistakes into lessons the model keeps.
            </p>
          </>
        )}
      </Section>

      {form.kind === "code" && (
        <Section id="setup-format" title="Input and output format" subtitle="What train() and decide() receive and must return, plus the helpers you can use"
          meta="train() · decide() · pg helpers" defaultOpen={false}>
          <pre className="format-doc" style={{ maxHeight: "none" }}>{tpl?.formatDoc}</pre>
        </Section>
      )}
    </>
  );
}

function Results({ model, trainJob, train, training, dirty, canTest, onTrain }: {
  model: Model | null; trainJob: string | null; train: { events: any[]; status: string };
  training: boolean; dirty: boolean; canTest: boolean; onTrain: () => void;
}) {
  if (!model) return null;
  if (training && trainJob) {
    return <section className="panel"><LiveProgress events={train.events} status={train.status} title="Training" /></section>;
  }
  if (model.status === "failed") {
    return (
      <section className="panel" style={{ display: "grid", gap: 12 }}>
        <h2>Training failed</h2>
        <div className="error">{model.error}</div>
        {!!model.logs?.length && <pre className="briefing">{model.logs.join("\n")}</pre>}
        <div><button className="btn" onClick={onTrain}>Fix the code in Setup, then train again</button></div>
      </section>
    );
  }
  const m = model.metrics;
  if (!m) {
    return (
      <section className="panel empty-state">
        <h2>Not trained yet</h2>
        <p className="muted">Train the model to see how well it learned: accuracy, F1, a held-out check for overfitting, and its results on the training period.</p>
        <button className="btn" onClick={onTrain}>Train</button>
      </section>
    );
  }
  const ev = m.evaluation;
  const curve = m.curve ?? [];
  return (
    <>
      {dirty && <div className="note">You've edited the model since this training. These results are for the previous version; train again to update them.</div>}
      {ev ? <ModelEvaluation ev={ev} curve={curve} name={model.name} /> : (
        <section className="panel">
          <EquityChart baseline={curve[0]?.model} series={[
            { key: "model", label: model.name, color: "var(--s1)", width: 2.5, points: curve.map((p) => ({ day: p.day, value: p.model })) },
            { key: "bh", label: "Buy and hold, same tickers", color: "var(--s-bench)", dashed: true, points: curve.filter((p) => p.buyHold != null).map((p) => ({ day: p.day, value: p.buyHold! })) },
          ]} />
        </section>
      )}

      {model.lessons && (
        <Section id="train-lessons" title="Lessons it carries into tests" subtitle="Written from the practice run's mistakes"
          meta={`${model.lessons.split("\n").filter((l) => l.trim()).length} lessons`}>
          <ul className="lessons" style={{ margin: 0 }}>{model.lessons.split("\n").map((l) => l.replace(/^-\s*/, "")).filter(Boolean).map((l) => <li key={l}>{l}</li>)}</ul>
        </Section>
      )}

      <Section id="train-details" title="Training details" subtitle="Trades, version, and anything your code printed"
        meta={`${m.trades} trades · version ${model.versionHash?.slice(0, 8) ?? "–"}`} defaultOpen={false}>
          <div className="details-body" style={{ marginTop: 0 }}>
            <div className="row small">
              <span className="tag">{model.kind === "code" ? `${m.trainDays} trading days` : `practice from ${longDate(m.practiceFrom!)}`}</span>
              <span className="tag">{m.trades} trades</span>
              <span className="tag">{pct(m.totalReturn)} vs buy and hold {pct(m.buyHoldReturn)}</span>
              <span className="tag">worst drop {pct(m.maxDrawdown)}</span>
              <span className="tag">invested {Math.round(m.exposure * 100)}%</span>
              <span className="tag">{usd(100_000 * (1 + m.totalReturn))} from $100,000</span>
              <span className="tag">version {model.versionHash?.slice(0, 10)}</span>
            </div>
            {m.model && Object.keys(m.model).length > 0 && (
              <div className="row small"><span className="muted">Reported by train():</span>
                {Object.entries(m.model).map(([k, v]) => <span className="tag" key={k}>{k} {Math.abs(v) < 10 ? v.toFixed(3) : v.toFixed(0)}</span>)}
              </div>
            )}
            {!!model.logs?.length && <pre className="briefing">{model.logs.join("\n")}</pre>}
          </div>
      </Section>

      <section className="cta-bar">
        <div>
          <b>Ready for the real exam?</b>
          <span className="muted small"> Test it on dates after {longDate(model.trainEnd)} that it has never seen.</span>
        </div>
        <button className="btn" disabled={!canTest} onClick={() => navigate(`#/test/${model.id}`)}>Test this model →</button>
      </section>
    </>
  );
}
