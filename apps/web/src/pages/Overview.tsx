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
                      ? "After the model's training data ends, it has nothing to remember. A gap near zero here means the 2020 gap is memory, not noise."
                      : "Return the agent got from recognising the period instead of from skill."}
                  </p>
                </div>
                <GapBars data={data} />
              </div>
            ) : (
              <div>
                <h2>No Leakage Gap yet for this window</h2>
                <p className="lede">It needs one finished AI run in normal mode and one in blind mode on these dates.</p>
                <button className="btn" style={{ marginTop: 12 }} onClick={() => navigate("#/new")}>Run a test</button>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Portfolio value over the test</h2>
              <span className="muted small">Each strategy starts with $100,000. SPY is scaled to the same start.</span>
            </div>
            {lines.length ? <EquityChart series={lines} baseline={100_000} /> : <p className="muted">No finished runs for this window yet.</p>}
            <ResultsTable series={data.series} />
          </section>

          <p className="small muted">
            Each line is the latest finished run of its kind. AI agents don't answer the same way every time, so one run per mode is a
            first reading, not proof. Repeat runs to firm it up; every attempt stays in the <a href="#/runs">run log</a>.
          </p>
        </>
      )}
    </>
  );
}

function GapBars({ data }: { data: OverviewData }) {
  const get = (k: string) => data.series.find((s) => s.key === k);
  const rows = [
    { s: get("normal"), label: "Real names and dates", color: "var(--s1)" },
    { s: get("blind"), label: "Blind, with posts", color: "var(--s2)" },
    { s: get("blindPricesOnly"), label: "Blind, prices only", color: "var(--s3)" },
    { s: get("spy"), label: "S&P 500 (SPY)", color: "var(--s-bench)" },
  ].filter((r) => r.s) as { s: Series; label: string; color: string }[];
  const ret = (s: Series) => s.points.at(-1)!.value / 100_000 - 1;
  const max = Math.max(0.05, ...rows.map((r) => Math.abs(ret(r.s))));
  const zero = 50; // percent across the track

  return (
    <div className="gap-compare" aria-label="Returns compared">
      {rows.map(({ s, label, color }) => {
        const r = ret(s);
        const w = (Math.abs(r) / max) * 50;
        return (
          <div className="gap-bar" key={s.key}>
            <span>{label}</span>
            <div className="track">
              <div className="zero" style={{ left: `${zero}%` }} />
              <div className="fill" style={{ background: color, left: r >= 0 ? `${zero}%` : `${zero - w}%`, width: `${w}%` }} />
            </div>
            <b className="num" style={{ textAlign: "right" }}>{pct(r)}</b>
          </div>
        );
      })}
      {data.gapPricesOnly && (
        <p className="small muted" style={{ margin: 0 }}>
          Against the prices-only blind run the gap is <b className="num">{pts(data.gapPricesOnly.gap)}</b>. Posts can hint at the period
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
