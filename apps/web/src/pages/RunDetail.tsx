import { useEffect, useMemo, useState } from "react";
import { api, type RunDetail as Detail, type Trade, type RunReview } from "../api";
import { EquityChart, PriceWithTrades, TradeLegend, GradePill } from "../charts";
import { Section, ExpandAll } from "../section";
import { agentLabel, pct, usd, shortDate, windowLabel } from "../format";

type Filter = "all" | "good" | "bad" | "neutral";
/** Trades shown before "Show all". */
const ROWS = 12;

export function RunDetail({ id }: { id: string }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [showAll, setShowAll] = useState(false);

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

  const { run, days, trades, decisions, prices, review } = d;
  const s = run.summary;
  const spy = prices.SPY ?? [];
  const tickers = Object.keys(prices).filter((t) => t !== "SPY");
  const shown = trades.filter((t) => filter === "all" || t.grade === filter);
  const biggest = [...trades].filter((t) => t.edgeDollars != null).sort((a, b) => Math.abs(b.edgeDollars!) - Math.abs(a.edgeDollars!)).slice(0, 3);

  const signedPct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`;
  return (
    <>
      <section className="page-intro">
        <div className="row small muted"><a href="#/runs">Run log</a><span>/</span><span>Run #{run.position}</span></div>
        <h1>{agentLabel(run)}</h1>
        <p className="lede" style={{ margin: 0 }}>
          {run.agent === "model" && run.modelId && <><a href={`#/model/${run.modelId}`}>Model page</a> · </>}
          <span className="mono">{run.tickers?.join(" ")}</span> · {windowLabel(run.start, run.end)}
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

      <ExpandAll />

      {review && (
        <Section id="run-missed" title="What the model missed" subtitle="Judged on the days after each decision, which the model could not see"
          meta={`${signedPct(review.totalReturn - review.buyHoldReturn)} vs buy and hold`}>
          <MissedPanel review={review} />
        </Section>
      )}

      {trades.length > 0 && (
        <Section id="run-short" title="The short version" meta={`${usd(counts.goodDollars + counts.badDollars, true)} net from trading`}>
          <p style={{ margin: 0 }}>
            {counts.good} good trades added <b className="num">{usd(counts.goodDollars, true)}</b> compared with not trading;
            {" "}{counts.bad} bad trades cost <b className="num">{usd(counts.badDollars, true)}</b>.
            {biggest.length > 0 && <> The trade that mattered most: <b>{biggest[0].side} {biggest[0].ticker} on {shortDate(biggest[0].filledOn)}</b> ({biggest[0].grade}, {usd(biggest[0].edgeDollars, true)}).</>}
          </p>
        </Section>
      )}

      {days.length > 0 && (
        <Section id="run-portfolio" title="Portfolio value" subtitle="Against the S&P 500 (SPY) from the same start"
          meta={s?.totalReturn != null ? `${pct(s.totalReturn)} · SPY ${pct(s.benchmarkReturn)}` : undefined}>
          <EquityChart
            baseline={100_000}
            series={[
              { key: "run", label: "This run", color: "var(--s1)", width: 2.5, points: days.map((x) => ({ day: x.day, value: x.equity })) },
              ...(spy.length ? [{ key: "spy", label: "S&P 500 (SPY)", color: "var(--s-bench)", dashed: true, points: spy.map((p) => ({ day: p.day, value: (100_000 * p.close) / spy[0].close })) }] : []),
            ]}
          />
        </Section>
      )}

      {trades.length > 0 && (
        <Section id="run-prices" title="Prices and trades" subtitle="Every trade on the day it filled, colored by its grade"
          meta={`${tickers.length} ticker${tickers.length === 1 ? "" : "s"}`} defaultOpen={false}>
          <div className="grid-2">
            {tickers.map((t) => (
              <div key={t} className="chart-card">
                <div className="panel-head"><h3>{t}</h3><span className="muted small">{trades.filter((x) => x.ticker === t).length} trades</span></div>
                <PriceWithTrades ticker={t} prices={prices[t]} trades={trades} />
                <TradeLegend />
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section id="run-report" title="Report card" subtitle={`Each trade judged on the ${d.horizonDays} trading days after it filled. More than 1% either way counts as good or bad.`}
        meta={trades.length ? `${counts.good} good · ${counts.bad} bad · ${counts.neutral} even` : "no trades"}>
        {trades.length === 0 ? <p className="muted" style={{ margin: 0 }}>This run made no trades.</p> : (
          <>
            <div className="seg" role="group" aria-label="Show trades" style={{ justifySelf: "start" }}>
              {(["all", "good", "bad", "neutral"] as Filter[]).map((f) => (
                <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {f === "all" ? `All ${trades.length}` : f === "neutral" ? `Even ${counts.neutral}` : `${f[0].toUpperCase()}${f.slice(1)} ${counts[f]}`}
                </button>
              ))}
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Filled</th><th>Trade</th><th>Grade</th><th className="num">vs not trading</th><th>What happened, and why it traded</th></tr>
                </thead>
                <tbody>
                  {(showAll ? shown : shown.slice(0, ROWS)).map((t) => <TradeRow t={t} key={t.id} />)}
                </tbody>
              </table>
            </div>
            {shown.length > ROWS && (
              <button type="button" className="btn secondary" style={{ justifySelf: "center" }} onClick={() => setShowAll(!showAll)}>
                {showAll ? "Show fewer" : `Show all ${shown.length} trades`}
              </button>
            )}
          </>
        )}
      </Section>

      {decisions.length > 0 && (
        <Section id="run-decisions" title="Every daily decision" subtitle="What the agent chose after each close, and why" meta={`${decisions.length} days`} defaultOpen={false}>
          <div className="feed" style={{ maxHeight: 480 }}>
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
        </Section>
      )}

      <Section id="run-proof" title="Proof" subtitle="Hashes that show this run was registered before it ran and hasn't changed since"
        meta={run.resultHash ? "sealed" : "not sealed"} defaultOpen={false}>
        <div className="small" style={{ display: "grid", gap: 6 }}>
          <div>Settings hash (registered before the run): <span className="hash">{run.hash}</span></div>
          <div>Previous run's hash: <span className="hash">{run.prevHash}</span></div>
          <div>Results seal: <span className="hash">{run.resultHash ?? "not sealed"}</span></div>
        </div>
      </Section>
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

function MissedPanel({ review }: { review: RunReview }) {
  const r = review;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <p style={{ margin: 0, fontSize: 16 }}>{r.summary}</p>
      <div className="stats">
        <Stat k="Model" v={pct(r.totalReturn)} />
        <Stat k="Buy and hold, same tickers" v={pct(r.buyHoldReturn)} />
        <Stat k="Difference" v={pct(r.totalReturn - r.buyHoldReturn)} />
        <Stat k="Invested on average" v={`${Math.round(r.exposure * 100)}%`} />
      </div>
      <div className="missed-grid">
        <div>
          <h3>Rallies it sat out</h3>
          {r.missedRallies.length ? <ul className="small">{r.missedRallies.map((m) => <li key={m.ticker + m.day}><b>{m.ticker}</b> {pct(m.move)} in the 5 days from {shortDate(m.day)}, holding {Math.round(m.weight * 100)}%</li>)}</ul> : <p className="small muted">None worth noting.</p>}
        </div>
        <div>
          <h3>Drops it held through</h3>
          {r.heldDrops.length ? <ul className="small">{r.heldDrops.map((m) => <li key={m.ticker + m.day}><b>{m.ticker}</b> {pct(m.move)} from {shortDate(m.day)} with {Math.round(m.weight * 100)}% of the portfolio <span className="nowrap">({usd(m.dollars, true)})</span></li>)}</ul> : <p className="small muted">None worth noting.</p>}
        </div>
        {r.missed.length > 0 && <div><h3>What it missed</h3><ul className="small">{r.missed.map((x) => <li key={x}>{x}</li>)}</ul></div>}
        {r.tryNext.length > 0 && <div><h3>Try next</h3><ul className="small">{r.tryNext.map((x) => <li key={x}>{x}</li>)}</ul></div>}
      </div>
    </div>
  );
}
