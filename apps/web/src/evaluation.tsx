import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Legend } from "recharts";
import type { ClassMetrics, Evaluation } from "./api";
import { EquityChart } from "./charts";
import { longDate } from "./format";

const p1 = (x: number | null | undefined) => (x == null ? "–" : `${(x * 100).toFixed(1)}%`);
const signed = (x: number | null | undefined) => (x == null ? "–" : `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`);

/** "How well it learned": verdict and key numbers first, then charts, then every metric. */
export function ModelEvaluation({ ev, curve, name }: {
  ev: Evaluation;
  curve: { day: string; model: number; buyHold: number | null }[];
  name: string;
}) {
  const f = ev.fit;
  const v = ev.validation;
  const hasVal = !!v;
  const segA = hasVal ? "Training days" : "Practice days";
  const ic = (x: number | null | undefined) => (x == null ? "–" : x.toFixed(3));
  const markers = ev.validationStart ? [{ day: ev.validationStart, label: "held out →" }] : [];

  return (
    <div className="eval">
      <div className={`eval-hero ${ev.verdict?.level ?? "practice"}`}>
        <div className="eval-hero-text">
          <span className="eyebrow">How well it learned</span>
          <h2>{ev.verdict ? ev.verdict.title : "Practice run scores"}</h2>
          <p>{ev.verdict ? ev.verdict.detail : "Prompt models aren't fitted to data, so there is no held-out check. These show how its practice decisions lined up with what happened next."}</p>
        </div>
        <div className="kpis">
          <Kpi label="Balanced accuracy" train={p1(f.balancedAccuracy)} held={v ? p1(v.balancedAccuracy) : null} trend={v ? v.balancedAccuracy - f.balancedAccuracy : 0} note="50% = coin flip" />
          <Kpi label="F1 score" train={p1(f.f1)} held={v ? p1(v.f1) : null} trend={v ? (v.f1 ?? 0) - (f.f1 ?? 0) : 0} note="precision × recall" />
          <Kpi label="Information coefficient" train={ic(f.ic)} held={v ? ic(v.ic) : null} trend={v ? (v.ic ?? 0) - (f.ic ?? 0) : 0} note="> 0.05 is useful" />
          <Kpi label="Return vs buy and hold" train={signed(f.totalReturn - f.buyHoldReturn)} held={v ? signed(v.totalReturn - v.buyHoldReturn) : null} trend={v ? (v.totalReturn - v.buyHoldReturn) - (f.totalReturn - f.buyHoldReturn) : 0} note="after fees" />
        </div>
      </div>

      <p className="small muted" style={{ margin: 0 }}>
        Each day, holding a stock counts as predicting it rises over the next {ev.horizon} trading days; not holding it predicts it won't.{" "}
        {hasVal
          ? <>train() learned from the first {ev.fitDays} trading days; the last {ev.validationDays} (from {longDate(ev.validationStart!)}) were held out.</>
          : <>Scored on the practice run.</>}
      </p>

      <div className="eval-grid">
        <figure className="chart-card">
          <figcaption>Classification scores<span>{hasVal ? "training vs held-out" : "practice run"}</span></figcaption>
          <ScoreBars f={f} v={v} />
        </figure>
        <figure className="chart-card">
          <figcaption>Balanced accuracy over time<span>rolling {hasVal ? 40 : 10} days · dotted = coin flip</span></figcaption>
          <EquityChart height={230} percent baseline={0.5} domain={[0.3, 0.7]} markers={markers}
            series={[{ key: "acc", label: "Rolling balanced accuracy", color: "var(--s1)", points: ev.rolling.map((r) => ({ day: r.day, value: r.accuracy })) }]} />
        </figure>
        <figure className="chart-card">
          <figcaption>Confusion matrix<span>{segA.toLowerCase()}</span></figcaption>
          <Confusion m={f} horizon={ev.horizon} />
        </figure>
        {v ? (
          <figure className="chart-card">
            <figcaption>Confusion matrix<span>held-out days</span></figcaption>
            <Confusion m={v} horizon={ev.horizon} />
          </figure>
        ) : (
          <figure className="chart-card">
            <figcaption>Bigger position, better outcome?<span>avg {ev.horizon}-day return by position size</span></figcaption>
            <BucketBars ev={ev} />
          </figure>
        )}
        {v && (
          <figure className="chart-card">
            <figcaption>Bigger position, better outcome?<span>avg {ev.horizon}-day return by position size</span></figcaption>
            <BucketBars ev={ev} />
          </figure>
        )}
        <figure className="chart-card">
          <figcaption>Portfolio value<span>with fees · dashed = buy and hold</span></figcaption>
          <EquityChart height={230} baseline={curve[0]?.model} markers={markers}
            series={[
              { key: "model", label: name || "Model", color: "var(--s1)", width: 2.5, points: curve.map((p) => ({ day: p.day, value: p.model })) },
              { key: "bh", label: "Buy and hold, same tickers", color: "var(--s-bench)", dashed: true, points: curve.filter((p) => p.buyHold != null).map((p) => ({ day: p.day, value: p.buyHold! })) },
            ]} />
        </figure>
      </div>

      <details className="all-metrics">
        <summary>All metrics</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Metric</th><th className="num">{segA}</th>{hasVal && <th className="num">Held-out days</th>}<th>What it means</th></tr>
            </thead>
            <tbody>
              <Row label="Balanced accuracy" a={f.balancedAccuracy} b={v?.balancedAccuracy} fmt={p1} higher
                note="Average of rises it held and falls it avoided. 50% is a coin flip; this is the fair skill score." />
              <Row label="Accuracy" a={f.accuracy} b={v?.accuracy} fmt={p1} higher
                note={`Calls that were right. Always guessing "up" scores ${p1(f.baselineAccuracy)}${v ? ` and ${p1(v.baselineAccuracy)}` : ""}.`} />
              <Row label="Precision" a={f.precision} b={v?.precision} fmt={p1} higher note="When it held a stock, how often the stock rose." />
              <Row label="Recall" a={f.recall} b={v?.recall} fmt={p1} higher note="Of all the rises, how many it was holding." />
              <Row label="F1 score" a={f.f1} b={v?.f1} fmt={p1} higher note="Balance of precision and recall." />
              <Row label="Information coefficient" a={f.ic} b={v?.ic} fmt={(x) => (x == null ? "–" : x.toFixed(3))} higher
                note="Correlation between position size and the next 5-day return." />
              <Row label="Sharpe ratio" a={f.sharpe} b={v?.sharpe} fmt={(x) => (x == null ? "–" : x.toFixed(2))} higher
                note="Return per unit of risk, per year. Rises with the market, so not used for the verdict." />
              <Row label="Return" a={f.totalReturn} b={v?.totalReturn} fmt={signed} higher note="With fees, from the start of each part." />
              <Row label="Buy and hold, same tickers" a={f.buyHoldReturn} b={v?.buyHoldReturn} fmt={signed} note="Holding all of them for the same days." />
              <Row label="Stock-days scored" a={f.n} b={v?.n} fmt={(x) => (x == null ? "–" : x.toLocaleString())} note="Days × tickers with a known outcome." />
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function Kpi({ label, train, held, trend, note }: { label: string; train: string; held: string | null; trend: number; note: string }) {
  const dir = held == null ? "" : trend < -0.02 ? "down" : trend > 0.02 ? "up" : "flat";
  return (
    <div className="kpi">
      <span className="kpi-label">{label}{held != null && <span className="kpi-tag">held-out</span>}</span>
      <span className="kpi-value">{held ?? train}</span>
      <span className="kpi-sub">
        {held != null ? <><span className={`trend ${dir}`}>{dir === "down" ? "▼" : dir === "up" ? "▲" : "●"}</span> from {train} in training</> : "practice run"}
      </span>
      <span className="kpi-note">{note}</span>
    </div>
  );
}

function Row({ label, a, b, fmt, note, higher }: { label: string; a: number | null; b?: number | null; fmt: (x: number | null) => string; note: string; higher?: boolean }) {
  const cls = higher && a != null && b != null ? (b < a - 0.03 * Math.max(1, Math.abs(a)) ? "worse" : b > a + 0.03 * Math.max(1, Math.abs(a)) ? "better" : "") : "";
  return (
    <tr>
      <td className="name">{label}</td>
      <td className="num">{fmt(a)}</td>
      {b !== undefined && <td className={`num ${cls}`}>{fmt(b)}</td>}
      <td className="small muted" style={{ minWidth: 220 }}>{note}</td>
    </tr>
  );
}

function ScoreBars({ f, v }: { f: ClassMetrics; v: ClassMetrics | null }) {
  const rows = [
    { metric: "Balanced acc.", fit: f.balancedAccuracy, val: v?.balancedAccuracy },
    { metric: "Accuracy", fit: f.accuracy, val: v?.accuracy },
    { metric: "Precision", fit: f.precision ?? 0, val: v?.precision ?? 0 },
    { metric: "Recall", fit: f.recall ?? 0, val: v?.recall ?? 0 },
    { metric: "F1", fit: f.f1 ?? 0, val: v?.f1 ?? 0 },
  ];
  return (
    <div style={{ width: "100%", height: 230 }}>
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 4 }} barGap={2} barCategoryGap="28%">
          <CartesianGrid vertical={false} />
          <XAxis dataKey="metric" tickLine={false} axisLine={{ stroke: "var(--line)" }} interval={0} />
          <YAxis domain={[0, 1]} tickFormatter={(x) => `${Math.round(x * 100)}%`} width={44} tickLine={false} axisLine={false} />
          <ReferenceLine y={0.5} stroke="var(--ink-3)" strokeDasharray="2 3" />
          <Tooltip cursor={{ fill: "var(--surface-2)" }} content={({ active, payload, label }) => active && payload?.length ? (
            <div className="tooltip"><div className="t">{label}</div>
              {payload.map((x) => <div className="r" key={String(x.dataKey)}><span>{x.dataKey === "fit" ? (v ? "Training days" : "Practice") : "Held-out"}</span><b>{p1(x.value as number)}</b></div>)}
            </div>) : null} />
          <Bar dataKey="fit" name={v ? "Training days" : "Practice days"} fill="var(--s1)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          {v && <Bar dataKey="val" name="Held-out days" fill="var(--s2)" radius={[4, 4, 0, 0]} isAnimationActive={false} />}
          {v && <Legend wrapperStyle={{ fontSize: 13 }} iconType="square" iconSize={10} formatter={(value) => <span style={{ color: "var(--ink-2)" }}>{value}</span>} />}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function BucketBars({ ev }: { ev: Evaluation }) {
  const rows = ev.buckets.fit.map((b, i) => ({
    label: b.label,
    fit: b.avgFwd, fitN: b.n,
    val: ev.buckets.validation?.[i]?.avgFwd ?? null, valN: ev.buckets.validation?.[i]?.n ?? 0,
  }));
  const hasVal = !!ev.buckets.validation;
  return (
    <div style={{ width: "100%", height: 230 }}>
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 4 }} barGap={2} barCategoryGap="28%">
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--line)" }} interval={0} />
          <YAxis tickFormatter={(x) => `${(x * 100).toFixed(1)}%`} width={52} tickLine={false} axisLine={false} />
          <ReferenceLine y={0} stroke="var(--ink-3)" />
          <Tooltip cursor={{ fill: "var(--surface-2)" }} content={({ active, payload, label }) => active && payload?.length ? (
            <div className="tooltip"><div className="t">Position {label}</div>
              {payload.map((x) => {
                const row: any = x.payload;
                const n = x.dataKey === "fit" ? row.fitN : row.valN;
                return <div className="r" key={String(x.dataKey)}><span>{x.dataKey === "fit" ? (hasVal ? "Training days" : "Practice") : "Held-out"} (n={n})</span><b>{signed(x.value as number)}</b></div>;
              })}
            </div>) : null} />
          <Bar dataKey="fit" name={hasVal ? "Training days" : "Practice days"} fill="var(--s1)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          {hasVal && <Bar dataKey="val" name="Held-out days" fill="var(--s2)" radius={[4, 4, 0, 0]} isAnimationActive={false} />}
          {hasVal && <Legend wrapperStyle={{ fontSize: 13 }} iconType="square" iconSize={10} formatter={(value) => <span style={{ color: "var(--ink-2)" }}>{value}</span>} />}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Confusion({ m, horizon }: { m: ClassMetrics; horizon: number }) {
  const pc = (x: number) => (m.n ? `${Math.round((x / m.n) * 100)}%` : "–");
  return (
    <div>
      <div className="cm" role="table" aria-label="Confusion matrix">
        <span />
        <span className="h">Rose over next {horizon} days</span>
        <span className="h">Fell</span>
        <span className="r">Held it</span>
        <span className="c right">{m.tp.toLocaleString()}<small>right · {pc(m.tp)}</small></span>
        <span className="c wrong">{m.fp.toLocaleString()}<small>wrong · {pc(m.fp)}</small></span>
        <span className="r">Didn't hold</span>
        <span className="c wrong">{m.fn.toLocaleString()}<small>missed · {pc(m.fn)}</small></span>
        <span className="c right">{m.tn.toLocaleString()}<small>avoided · {pc(m.tn)}</small></span>
      </div>
      <p className="small muted" style={{ margin: "6px 0 0" }}>{m.n.toLocaleString()} stock-days. Stocks rose on {p1(m.upRate)} of them.</p>
    </div>
  );
}
