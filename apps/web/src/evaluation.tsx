import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Legend } from "recharts";
import type { ClassMetrics, Evaluation } from "./api";
import { EquityChart } from "./charts";
import { longDate } from "./format";

const p1 = (x: number | null | undefined) => (x == null ? "–" : `${(x * 100).toFixed(1)}%`);
const signed = (x: number | null | undefined) => (x == null ? "–" : `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`);

/** "How well it learned": verdict, metric table, charts and confusion matrices. */
export function ModelEvaluation({ ev, curve, name }: {
  ev: Evaluation;
  curve: { day: string; model: number; buyHold: number | null }[];
  name: string;
}) {
  const f = ev.fit;
  const v = ev.validation;
  const hasVal = !!v;
  const segA = hasVal ? "Training days" : "Practice days";

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div>
        <h3>How well it learned</h3>
        <p className="small muted" style={{ margin: "4px 0 0" }}>
          Each day, holding a stock counts as predicting it will rise over the next {ev.horizon} trading days; not holding it predicts it
          won't. {hasVal
            ? <>train() saw only the first {ev.fitDays} trading days. The last {ev.validationDays} (from {longDate(ev.validationStart!)}) were held out, so they show how the model does on days it never learned from.</>
            : <>Prompt models aren't fitted to data, so there is no held-out check; these numbers show how its practice decisions lined up with what happened next.</>}
        </p>
      </div>

      {ev.verdict && (
        <div className={`verdict ${ev.verdict.level}`} role="status">
          <b>{ev.verdict.level === "generalises" ? "✓ " : ev.verdict.level === "some-overfit" ? "! " : "✗ "}{ev.verdict.title}</b>
          <span className="small">{ev.verdict.detail}</span>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Metric</th><th className="num">{segA}</th>{hasVal && <th className="num">Held-out days</th>}<th>What it means</th></tr>
          </thead>
          <tbody>
            <Row label="Balanced accuracy" a={f.balancedAccuracy} b={v?.balancedAccuracy} fmt={p1} higher
              note="Average of rises it held and falls it avoided. 50% is a coin flip; this is the fair skill score." />
            <Row label="Accuracy" a={f.accuracy} b={v?.accuracy} fmt={p1} higher
              note={`Calls that were right. Compare with always guessing "up": ${p1(f.baselineAccuracy)}${v ? ` and ${p1(v.baselineAccuracy)}` : ""}.`} />
            <Row label="Precision" a={f.precision} b={v?.precision} fmt={p1} higher note="When it held a stock, how often the stock rose." />
            <Row label="Recall" a={f.recall} b={v?.recall} fmt={p1} higher note="Of all the rises, how many it was holding." />
            <Row label="F1 score" a={f.f1} b={v?.f1} fmt={p1} higher note="Balance of precision and recall (0 to 100%)." />
            <Row label="Information coefficient" a={f.ic} b={v?.ic} fmt={(x) => (x == null ? "–" : x.toFixed(3))} higher
              note="Correlation between position size and the next 5-day return. Above 0.05 is a useful signal." />
            <Row label="Sharpe ratio" a={f.sharpe} b={v?.sharpe} fmt={(x) => (x == null ? "–" : x.toFixed(2))} higher
              note="Return per unit of risk, per year. Rises with the market, so it isn't used for the verdict." />
            <Row label="Return" a={f.totalReturn} b={v?.totalReturn} fmt={signed} higher note="With fees, from the start of each part." />
            <Row label="Buy and hold, same tickers" a={f.buyHoldReturn} b={v?.buyHoldReturn} fmt={signed} note="What simply holding all of them returned." />
          </tbody>
        </table>
      </div>

      <div className="eval-grid">
        <div>
          <h3 style={{ marginBottom: 8 }}>Classification scores</h3>
          <ScoreBars f={f} v={v} />
        </div>
        <div>
          <h3 style={{ marginBottom: 8 }}>Balanced accuracy over time</h3>
          <EquityChart
            height={240}
            percent
            baseline={0.5}
            domain={[0.3, 0.7]}
            markers={ev.validationStart ? [{ day: ev.validationStart, label: "held out →" }] : []}
            series={[{ key: "acc", label: "Rolling balanced accuracy", color: "var(--s1)", points: ev.rolling.map((r) => ({ day: r.day, value: r.accuracy })) }]}
          />
          <p className="small muted" style={{ margin: "4px 0 0" }}>Over the previous {hasVal ? 40 : 10} trading days. Dotted line: coin flip. A drop after the split is overfitting.</p>
        </div>
      </div>

      <div className="cm-pair">
        <Confusion title={segA} m={f} horizon={ev.horizon} />
        {v && <Confusion title="Held-out days" m={v} horizon={ev.horizon} />}
      </div>

      <div className="eval-grid">
        <div>
          <h3 style={{ marginBottom: 8 }}>Does a bigger position mean a better outcome?</h3>
          <BucketBars ev={ev} />
          <p className="small muted" style={{ margin: "4px 0 0" }}>Average {ev.horizon}-day return after each decision, grouped by how much of the portfolio the model put in the stock.</p>
        </div>
        <div>
          <h3 style={{ marginBottom: 8 }}>Portfolio value</h3>
          <EquityChart
            height={240}
            baseline={curve[0]?.model}
            markers={ev.validationStart ? [{ day: ev.validationStart, label: "held out →" }] : []}
            series={[
              { key: "model", label: name || "Model", color: "var(--s1)", width: 2.5, points: curve.map((p) => ({ day: p.day, value: p.model })) },
              { key: "bh", label: "Buy and hold, same tickers", color: "var(--s-bench)", dashed: true, points: curve.filter((p) => p.buyHold != null).map((p) => ({ day: p.day, value: p.buyHold! })) },
            ]}
          />
        </div>
      </div>
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
    <div style={{ width: "100%", height: 240 }}>
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
    <div style={{ width: "100%", height: 240 }}>
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

function Confusion({ title, m, horizon }: { title: string; m: ClassMetrics; horizon: number }) {
  const pc = (x: number) => (m.n ? `${Math.round((x / m.n) * 100)}%` : "–");
  return (
    <div>
      <h3 style={{ marginBottom: 8 }}>Confusion matrix · {title}</h3>
      <div className="cm" role="table" aria-label={`Confusion matrix, ${title}`}>
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
