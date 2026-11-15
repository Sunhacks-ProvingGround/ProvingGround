import { useEffect, useMemo, useState } from "react";
import type { Decision } from "./api";
import { EquityChart } from "./charts";
import { navigate, pct, shortDate, usd } from "./format";

/** Follows a job's server-sent events (training or a test run). Replays everything so far. */
export function useJobEvents(jobId: string | null) {
  const [events, setEvents] = useState<any[]>([]);
  const [status, setStatus] = useState<string>("queued");
  useEffect(() => {
    setEvents([]);
    if (!jobId) return;
    setStatus("queued");
    const es = new EventSource(`/api/jobs/${jobId}/stream`);
    es.onmessage = (m) => {
      const e = JSON.parse(m.data);
      if (e.type === "status") {
        setStatus(e.status);
        if (e.status === "done" || e.status === "failed") es.close();
        return;
      }
      setEvents((prev) => (prev.length > 3000 ? [...prev.slice(-2000), e] : [...prev, e]));
    };
    return () => es.close();
  }, [jobId]);
  return { events, status };
}

/** Live view of a training job or test run, built from its events. */
export function LiveProgress({ events, status, title }: { events: any[]; status: string; title: string }) {
  const v = useMemo(() => {
    const points: { day: string; value: number }[] = [];
    const decisions: Decision[] = [];
    const messages: string[] = [];
    let total = 0, index = -1, runId: string | undefined, hash: string | undefined, error: string | undefined;
    let graded: any, reviewed: number | undefined, analyzed: string | undefined, summary: any;
    for (const e of events) {
      if (e.type === "day") { points.push({ day: e.day.day, value: e.day.equity }); total = e.total; index = e.index; }
      else if (e.type === "train-progress") { points.push({ day: e.day, value: e.equity }); total = e.total; index = e.index; }
      else if (e.type === "decision") decisions.unshift(e.decision);
      else if (e.type === "train-status") messages.push(e.message);
      else if (e.type === "registered") { runId = e.runId; hash = e.hash; }
      else if (e.type === "graded") graded = e.counts;
      else if (e.type === "reviewed") reviewed = e.count;
      else if (e.type === "analyzed") analyzed = e.summary;
      else if (e.type === "done") summary = e.summary;
      else if (e.type === "failed" || e.type === "train-failed") error = e.error;
    }
    return { points, decisions: decisions.slice(0, 60), messages, total, index, runId, hash, error, graded, reviewed, analyzed, summary };
  }, [events]);
  const progress = v.total ? Math.round(((v.index + 1) / v.total) * 100) : 0;
  const label = status === "done" ? "Finished" : status === "failed" ? "Failed" : status === "queued" ? "Waiting for the job before it" : title;

  return (
    <div style={{ display: "grid", gap: 12 }} aria-live="polite">
      <div className="panel-head" style={{ margin: 0 }}>
        <h3>{label}</h3>
        <span className={`pill ${status}`}>{status}</span>
      </div>
      {v.messages.length > 0 && (
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {v.messages.map((m, i) => <li key={i}>{m}</li>)}
        </ul>
      )}
      {v.hash && <div className="small">Registered in the run log before it ran · <span className="hash">{v.hash.slice(0, 24)}…</span></div>}
      {v.total > 0 && (
        <div>
          <div className="row small muted" style={{ justifyContent: "space-between" }}>
            <span>Day {v.index + 1} of {v.total}{v.points.length ? ` · ${shortDate(v.points.at(-1)!.day)}` : ""}</span>
            <span className="num">{v.points.length ? usd(v.points.at(-1)!.value) : ""}</span>
          </div>
          <div className="progress"><i style={{ width: `${progress}%` }} /></div>
        </div>
      )}
      {v.points.length > 1 && <EquityChart series={[{ key: "v", label: "Portfolio", color: "var(--s1)", points: v.points }]} height={150} baseline={v.points[0].value} />}
      {v.graded && (
        <div className="small">
          Graded: <b className="ok">{v.graded.good} good</b>, <b style={{ color: "var(--bad-ink)" }}>{v.graded.bad} bad</b>, {v.graded.neutral} about even
          {v.reviewed != null && (v.reviewed > 0 ? <> · {v.reviewed} trade reviews</> : <> · <span className="muted">AI reviews unavailable (check GEMINI_API_KEY and the rate limit)</span></>)}
        </div>
      )}
      {v.analyzed && <div className="small"><b>What it missed:</b> {v.analyzed}</div>}
      {v.summary && (
        <div className="row">
          <span>Return <b className="num">{pct(v.summary.totalReturn)}</b> (SPY {pct(v.summary.benchmarkReturn)})</span>
          {v.runId && <button className="btn secondary" onClick={() => navigate(`#/run/${v.runId}`)}>Open report card</button>}
        </div>
      )}
      {v.error && <div className="error">{v.error}</div>}
      {v.decisions.length > 0 && (
        <details open={status !== "done"}>
          <summary className="small">The agent's reasoning ({v.decisions.length})</summary>
          <div className="feed" style={{ marginTop: 8, maxHeight: 240 }}>
            {v.decisions.map((d) => (
              <div className="feed-item" key={d.day}>
                <span className="d">{d.shownAs.startsWith("Day") ? d.shownAs : shortDate(d.day)}</span>
                <span>
                  <span className="mono small">{Object.entries(d.targets).map(([t, w]) => `${t} ${Math.round(w * 100)}%`).join(" · ")}</span>
                  <br />{d.error ? <span style={{ color: "var(--bad-ink)" }}>No decision: {d.error}</span> : d.reason}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
