import { useEffect, useState } from "react";
import { api, type Run } from "../api";
import { agentLabel, pct, navigate, shortDate } from "../format";
import { Section, ExpandAll } from "../section";

export function Runs() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [check, setCheck] = useState<{ ok: boolean; runs: number; problems: string[] } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.runs().then((d) => setRuns(d.runs), (e) => setError(e.message));
    api.verify().then(setCheck, () => setCheck(null));
  }, []);

  return (
    <>
      <section>
        <h1>Run log</h1>
        <p className="lede">
          Every test ever started, in order, including failed ones. Each entry stores a hash of its settings chained to the entry
          before it, so a deleted or edited run would break the chain.
        </p>
      </section>

      <ExpandAll />
      <Section id="runs-integrity" title="Integrity check" subtitle="Recomputes every settings hash and results seal from what is stored right now"
        meta={check ? (check.ok ? `✓ Chain intact · ${check.runs} runs` : `✗ ${check.problems.length} problem${check.problems.length === 1 ? "" : "s"}`) : "checking…"}
        defaultOpen={!!check && !check.ok}>
        {check && !check.ok ? <ul className="small" style={{ margin: 0 }}>{check.problems.map((p) => <li key={p}>{p}</li>)}</ul>
          : <p className="small" style={{ margin: 0 }}>Every run chains onto the one before it, its settings still match the hash registered before it ran, and its saved results still match their seal.</p>}
      </Section>

      {error && <div className="error">{error}</div>}
      <Section id="runs-all" title="All runs" subtitle="Every test ever started, newest first. Click one for its report card."
        meta={runs ? `${runs.length} run${runs.length === 1 ? "" : "s"}` : undefined}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>#</th><th>Strategy</th><th>Window</th><th>Status</th><th className="num">Return</th><th className="num">Trades</th><th>Settings hash</th><th>Started</th></tr>
            </thead>
            <tbody>
              {runs?.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => navigate(`#/run/${r.id}`)}>
                  <td className="num"><a href={`#/run/${r.id}`} onClick={(e) => e.stopPropagation()}>{r.position}</a></td>
                  <td>{agentLabel(r)}</td>
                  <td className="small" style={{ whiteSpace: "nowrap" }}>{shortDate(r.start)} {r.start.slice(0, 4)} – {shortDate(r.end)} {r.end.slice(0, 4)}<div className="mono muted">{r.tickers?.join(" ")}</div></td>
                  <td><span className={`pill ${r.status}`}>{r.status}</span></td>
                  <td className="num">{r.summary?.totalReturn != null ? pct(r.summary.totalReturn) : "–"}</td>
                  <td className="num">{r.summary?.trades ?? "–"}</td>
                  <td className="hash">{r.hash.slice(0, 12)}</td>
                  <td className="small muted">{new Date(r.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                </tr>
              ))}
              {runs && !runs.length && <tr><td colSpan={8} className="muted">No runs yet. <a href="#/new">Run a test</a>.</td></tr>}
            </tbody>
          </table>
        </div>
        {!runs && !error && <p className="muted">Loading…</p>}
      </Section>
    </>
  );
}
