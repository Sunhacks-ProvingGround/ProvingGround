import { useEffect, useState } from "react";
import { api, type Overview as OverviewData, type Series } from "../api";
import { EquityChart, type LineSeries } from "../charts";
import { pct, pts, usd, windowLabel, navigate } from "../format";

const SERIES_STYLE: Record<string, { color: string; dashed?: boolean; width?: number }> = {
  normal: { color: "var(--s1)", width: 2.5 },
  blind: { color: "var(--s2)", width: 2.5 },
  blindPricesOnly: { color: "var(--s3)" },
  buyAndHold: { color: "var(--s4)" },
  sma: { color: "var(--s5)" },
  spy: { color: "var(--s-bench)", dashed: true },
};

export function Overview({ windowKey, setWindowKey }: { windowKey: string; setWindowKey: (w: string) => void }) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setData(null);
    setError("");
    api.overview(windowKey).then(setData, (e) => setError(e.message));
  }, [windowKey]);

  const lines: LineSeries[] = (data?.series ?? []).map((s) => ({ key: s.key, label: s.label, points: s.points, ...SERIES_STYLE[s.key] }));
  const g = data?.gap;
  const isControl = windowKey === "control";

  return (
    <>
      <section>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <h1>Same agent, same days. Could it see the future?</h1>
            <p className="lede">
              We replay the market one day at a time and the database refuses to show anything after the simulated day.
              Then we run the same AI agent again on a disguised copy of the market, with names, dates and prices hidden, so it can't
              recognise the period from memory. The difference in returns is the <b>Leakage Gap</b>.
            </p>
          </div>
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <div className="seg" role="group" aria-label="Test window">
            <button aria-pressed={windowKey === "demo"} onClick={() => setWindowKey("demo")}>2020 COVID crash</button>
            <button aria-pressed={windowKey === "control"} onClick={() => setWindowKey("control")}>2026 control</button>
          </div>
          {data && <span className="muted small mono">{windowLabel(data.window.start, data.window.end)} · 60 trading days</span>}
        </div>
      </section>

      {error && <div className="error">{error}</div>}
      {!data && !error && <div className="panel muted">Loading results…</div>}

      {data && (
        <>
          <section className="panel">
            {g ? (
              <div className="gap-hero">
                <div>
                  <div className="gap-label">Leakage Gap</div>
                  <div className="gap-number" style={{ color: g.gap > 0.01 ? "var(--bad-ink)" : "var(--ink)" }}>{pts(g.gap)}</div>
                  <p className="small muted" style={{ marginBottom: 0 }}>
                    {isControl
                      ? "After the model's training data ends it has nothing to remember, so this gap is what the disguise alone costs."
                      : "How much better the agent did, on average, when it could see real names and dates."}
                  </p>
                </div>
                <GapBars data={data} />
              </div>
            ) : null}
            {g && !isControl && data.controlGap && data.memoryEffect != null ? (
              <div className="memory">
                <div>
                  <div className="gap-label">Memory effect</div>
                  <div className="num" style={{ fontSize: 30, fontWeight: 600 }}>{pts(data.memoryEffect)}</div>
                </div>
                <p className="small" style={{ margin: 0 }}>
                  The disguise itself costs something: on the 2026 control window, where the model has nothing to remember, the blind
                  agent still trailed by <b className="num">{pts(data.controlGap.gap)}</b>. Subtracting that from the 2020 gap
                  (<b className="num">{pts(g.gap)}</b>) leaves the part that comes from recognising the period.
                </p>
              </div>
            ) : null}
            {g ? null : (

              <div>
                <h2>No Leakage Gap yet for this window</h2>
                <p className="lede">It needs one finished AI run in normal mode and one in blind mode on these dates.</p>
                <button className="btn" style={{ marginTop: 12 }} onClick={() => navigate("#/new")}>Run a test</button>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Portfolio value over the test (latest run of each)</h2>
              <span className="muted small">Each strategy starts with $100,000. SPY is scaled to the same start.</span>
            </div>
            {lines.length ? <EquityChart series={lines} baseline={100_000} /> : <p className="muted">No finished runs for this window yet.</p>}
            <ResultsTable series={data.series} />
          </section>

          <p className="small muted">
            The Leakage Gap averages every finished AI run of each kind; the chart and table show the latest run of each. AI agents don't
            answer the same way every time, so repeat runs to firm the numbers up. Every attempt stays in the <a href="#/runs">run log</a>.
          </p>
        </>
      )}
    </>
  );
}

function GapBars({ data }: { data: OverviewData }) {
  const spy = data.series.find((s) => s.key === "spy");
  const avg = (n: number) => (n === 1 ? "1 run" : `average of ${n} runs`);
  const rows: { key: string; label: string; sub: string; r: number; color: string }[] = [];
  if (data.gap) {
    rows.push({ key: "n", label: "Real names and dates", sub: avg(data.gap.normal.n), r: data.gap.normal.totalReturn, color: "var(--s1)" });
    rows.push({ key: "b", label: "Blind, with posts", sub: avg(data.gap.blind.n), r: data.gap.blind.totalReturn, color: "var(--s2)" });
  }
  if (data.gapPricesOnly) {
    rows.push({ key: "bp", label: "Blind, prices only", sub: avg(data.gapPricesOnly.blind.n), r: data.gapPricesOnly.blind.totalReturn, color: "var(--s3)" });
  }
  if (spy) rows.push({ key: "spy", label: "S&P 500 (SPY)", sub: "benchmark", r: spy.points.at(-1)!.value / 100_000 - 1, color: "var(--s-bench)" });
  const max = Math.max(0.05, ...rows.map((x) => Math.abs(x.r)));
  const zero = 50; // percent across the track

  return (
    <div className="gap-compare" aria-label="Returns compared">
      {rows.map(({ key, label, sub, r, color }) => {
        const w = (Math.abs(r) / max) * 50;
        return (
          <div className="gap-bar" key={key}>
            <span>{label}<span className="muted small"> · {sub}</span></span>
            <div className="track">
              <div className="zero" style={{ left: `${zero}%` }} />
              <div className="fill" style={{ background: color, left: r >= 0 ? `${zero}%` : `${zero - w}%`, width: `${w}%` }} />
            </div>
            <b className="num" style={{ textAlign: "right" }}>{pct(r)}</b>
          </div>
        );
      })}
      {data.gap && data.gap.normal.n + data.gap.blind.n > 2 && (
        <p className="small muted" style={{ margin: 0 }}>
          Individual runs: real names {data.gap.normal.runs.map((x) => pct(x.totalReturn)).join(", ")}; blind {data.gap.blind.runs.map((x) => pct(x.totalReturn)).join(", ")}.
          The agent answers differently every time, so more runs give a steadier number.
        </p>
      )}
      {data.gapPricesOnly && (
        <p className="small muted" style={{ margin: 0 }}>
          Against prices-only blind runs the gap is <b className="num">{pts(data.gapPricesOnly.gap)}</b>. Posts can hint at the period
          even after redaction, so that is the more conservative reading.
        </p>
      )}
    </div>
  );
}

function ResultsTable({ series }: { series: Series[] }) {
  return (
    <div className="table-wrap" style={{ marginTop: 16 }}>
      <table>
        <thead>
          <tr><th>Strategy</th><th className="num">End value</th><th className="num">Return</th><th className="num">Trades</th><th>Run</th></tr>
        </thead>
        <tbody>
          {series.map((s) => {
            const end = s.points.at(-1)?.value ?? 100_000;
            return (
              <tr key={s.key} className={s.run ? "clickable" : ""} onClick={() => s.run && navigate(`#/run/${s.run.id}`)}>
                <td className="name"><span style={{ display: "inline-block", width: 10, height: 3, background: SERIES_STYLE[s.key]?.color, marginRight: 8, verticalAlign: "middle" }} />{s.label}</td>
                <td className="num">{usd(end)}</td>
                <td className="num">{pct(end / 100_000 - 1)}</td>
                <td className="num">{s.run?.summary?.trades ?? "–"}</td>
                <td>{s.run ? <a href={`#/run/${s.run.id}`} onClick={(e) => e.stopPropagation()}>#{s.run.position}</a> : <span className="muted">benchmark</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
