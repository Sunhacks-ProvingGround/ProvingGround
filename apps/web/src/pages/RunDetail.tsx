import { useEffect, useMemo, useState } from "react";
import { api, type RunDetail as Detail, type Trade } from "../api";
import { EquityChart, PriceWithTrades, TradeLegend, GradePill } from "../charts";
import { agentLabel, pct, usd, shortDate, windowLabel } from "../format";

type Filter = "all" | "good" | "bad" | "neutral";

export function RunDetail({ id }: { id: string }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    setD(null);
    api.run(id).then(setD, (e) => setError(e.message));
  }, [id]);

  const counts = useMemo(() => {
    const c = { good: 0, bad: 0, neutral: 0, goodDollars: 0, badDollars: 0 };
    for (const t of d?.trades ?? []) {
      if (t.grade === "good") { c.good++; c.goodDollars += t.edgeDollars ?? 0; }
      else if (t.grade === "bad") { c.bad++; c.badDollars += t.edgeDollars ?? 0; }
      else if (t.grade === "neutral") c.neutral++;
    }
    return c;
  }, [d]);

  if (error) return <div className="error">{error}</div>;
  if (!d) return <div className="panel muted">Loading run…</div>;

  const { run, days, trades, decisions, prices } = d;
  const s = run.summary;
  const spy = prices.SPY ?? [];
  const tickers = Object.keys(prices).filter((t) => t !== "SPY");
  const shown = trades.filter((t) => filter === "all" || t.grade === filter);
  const biggest = [...trades].filter((t) => t.edgeDollars != null).sort((a, b) => Math.abs(b.edgeDollars!) - Math.abs(a.edgeDollars!)).slice(0, 3);

  return (
    <>
      <section>
        <div className="row small muted"><a href="#/runs">Run log</a><span>/</span><span>Run #{run.position}</span></div>
        <h1 style={{ marginTop: 6 }}>{agentLabel(run)}</h1>
        <p className="lede">
          {windowLabel(run.start, run.end)}
          {run.model && <> · <span className="mono">{run.model}</span></>}
          {" · "}<span className={`pill ${run.status}`}>{run.status}</span>
        </p>
        {run.status === "failed" && s?.error && <div className="error" style={{ marginTop: 12 }}>{s.error}</div>}
      </section>

      {s && s.totalReturn != null && (
        <section className="stats" aria-label="Summary">
          <Stat k="Return" v={pct(s.totalReturn)} />
          <Stat k="SPY, same days" v={pct(s.benchmarkReturn)} />
          <Stat k="Worst drop" v={pct(s.maxDrawdown)} />
          <Stat k="Trades" v={String(s.trades)} />
          <Stat k="Fees paid" v={usd(s.feesPaid)} />
          <Stat k="Good / bad" v={`${counts.good} / ${counts.bad}`} />
        </section>
      )}

      {trades.length > 0 && (
        <section className="panel">
          <h2>The short version</h2>
          <p style={{ margin: "8px 0 0" }}>
            {counts.good} good trades added <b className="num">{usd(counts.goodDollars, true)}</b> compared with not trading;
            {" "}{counts.bad} bad trades cost <b className="num">{usd(counts.badDollars, true)}</b>.
            {biggest.length > 0 && <> The trade that mattered most: <b>{biggest[0].side} {biggest[0].ticker} on {shortDate(biggest[0].filledOn)}</b> ({biggest[0].grade}, {usd(biggest[0].edgeDollars, true)}).</>}
          </p>
        </section>
      )}

      {days.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h2>Portfolio value</h2><span className="muted small">vs the S&P 500 (SPY) from the same start</span></div>
          <EquityChart
            baseline={100_000}
            series={[
              { key: "run", label: "This run", color: "var(--s1)", width: 2.5, points: days.map((x) => ({ day: x.day, value: x.equity })) },
              ...(spy.length ? [{ key: "spy", label: "S&P 500 (SPY)", color: "var(--s-bench)", dashed: true, points: spy.map((p) => ({ day: p.day, value: (100_000 * p.close) / spy[0].close })) }] : []),
            ]}
          />
        </section>
      )}

      {trades.length > 0 && (
        <section className="grid-2">
          {tickers.map((t) => (
            <div className="panel" key={t}>
              <div className="panel-head"><h2>{t}</h2><span className="muted small">{trades.filter((x) => x.ticker === t).length} trades</span></div>
              <PriceWithTrades ticker={t} prices={prices[t]} trades={trades} />
              <TradeLegend />
            </div>
          ))}
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Report card</h2>
            <p className="small muted" style={{ margin: "4px 0 0" }}>
              Each trade judged on the {d.horizonDays} trading days after it filled: a buy against holding cash, a sell against holding on.
              More than 1% either way counts as good or bad.
            </p>
          </div>
          <div className="seg" role="group" aria-label="Show trades">
            {(["all", "good", "bad", "neutral"] as Filter[]).map((f) => (
              <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === "all" ? `All ${trades.length}` : f === "neutral" ? `Even ${counts.neutral}` : `${f[0].toUpperCase()}${f.slice(1)} ${counts[f]}`}
              </button>
            ))}
          </div>
        </div>
        {trades.length === 0 ? <p className="muted">This run made no trades.</p> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Filled</th><th>Trade</th><th>Grade</th><th className="num">vs not trading</th><th>What happened, and why it traded</th></tr>
              </thead>
              <tbody>
                {shown.map((t) => <TradeRow t={t} key={t.id} />)}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {decisions.length > 0 && (
        <section className="panel">
          <details>
            <summary>Every daily decision ({decisions.length})</summary>
            <div className="feed" style={{ maxHeight: 480, marginTop: 12 }}>
              {decisions.map((x) => (
                <div className="feed-item" key={x.day}>
                  <span className="d">{shortDate(x.day)}{x.shownAs.startsWith("Day") ? <><br />{x.shownAs}</> : null}</span>
                  <span>
                    <span className="mono small">{Object.entries(x.targets).map(([k, w]) => `${k} ${Math.round(w * 100)}%`).join(" · ")}</span>
                    <br />{x.error ? <span style={{ color: "var(--bad-ink)" }}>No decision: {x.error}</span> : x.reason}
                  </span>
                </div>
              ))}
            </div>
          </details>
        </section>
      )}

      <section className="panel">
        <h2>Proof</h2>
        <div className="small" style={{ display: "grid", gap: 6, marginTop: 10 }}>
          <div>Settings hash (registered before the run): <span className="hash">{run.hash}</span></div>
          <div>Previous run's hash: <span className="hash">{run.prevHash}</span></div>
          <div>Results seal: <span className="hash">{run.resultHash ?? "not sealed"}</span></div>
        </div>
      </section>
    </>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return <div className="stat"><div className="k">{k}</div><div className="v">{v}</div></div>;
}

function TradeRow({ t }: { t: Trade }) {
  return (
    <tr>
      <td className="mono small" style={{ whiteSpace: "nowrap" }}>{shortDate(t.filledOn)}</td>
      <td style={{ whiteSpace: "nowrap" }}>
        <b>{t.side === "buy" ? "Buy" : "Sell"} {t.ticker}</b>
        <div className="small muted num">{usd(t.amount)} at {t.price.toFixed(2)}</div>
      </td>
      <td><GradePill grade={t.grade} /></td>
      <td className="num" style={{ color: t.grade === "good" ? "var(--good-ink)" : t.grade === "bad" ? "var(--bad-ink)" : undefined }}>
        {t.edgeDollars != null ? usd(t.edgeDollars, true) : "–"}
      </td>
      <td style={{ minWidth: 280 }}>
        <div>{t.explanation}</div>
        {t.aiReview && <div className="small" style={{ marginTop: 4 }}><b>Lesson:</b> {t.aiReview}</div>}
        {t.reason && <div className="small muted" style={{ marginTop: 4 }}><b>Agent's reason:</b> {t.reason.length > 220 ? `${t.reason.slice(0, 220)}…` : t.reason}</div>}
      </td>
    </tr>
  );
}
