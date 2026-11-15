import { useEffect, useState } from "react";
import { modelsApi, type Model } from "../api";
import { navigate, pct, longDate } from "../format";

export function Models() {
  const [models, setModels] = useState<Model[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { modelsApi.list().then((d) => setModels(d.models), (e) => setError(e.message)); }, []);

  return (
    <>
      <section className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1>Your models</h1>
          <p className="lede">
            Build a trading model from code or a prompt, train it on the stocks and dates you choose, then test it on a later period it
            has never seen. Every trade gets graded, and you get a summary of what the model missed.
          </p>
        </div>
        <button className="btn" onClick={() => navigate("#/model/new")}>New model</button>
      </section>

      <section className="steps">
        <div className="step"><b>1. Build</b><span>Pick tickers and a training period. Write JavaScript with <span className="mono">train()</span> and <span className="mono">decide()</span>, or describe a strategy in plain English for Gemini.</span></div>
        <div className="step"><b>2. Train</b><span>Your code learns from the training period only; the database refuses anything later. Prompt models do a graded practice run and keep the lessons.</span></div>
        <div className="step"><b>3. Test</b><span>Run it on a later period with a $100,000 portfolio. Registered in the run log first, graded trade by trade afterwards.</span></div>
      </section>

      {error && <div className="error">{error}</div>}
      <section className="panel">
        {!models ? <p className="muted">Loading…</p> : !models.length ? (
          <div>
            <h2>No models yet</h2>
            <p className="lede">Start from a template: momentum, ridge regression or mean reversion, or write a strategy prompt.</p>
            <button className="btn" style={{ marginTop: 12 }} onClick={() => navigate("#/model/new")}>Build your first model</button>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Model</th><th>Type</th><th>Tickers</th><th>Trained on</th><th>Status</th><th className="num">Training return</th><th className="num">Buy and hold</th></tr></thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m.id} className="clickable" onClick={() => navigate(`#/model/${m.id}`)}>
                    <td className="name"><a href={`#/model/${m.id}`} onClick={(e) => e.stopPropagation()}>{m.name}</a></td>
                    <td>{m.kind === "code" ? "Code" : "Prompt"}</td>
                    <td className="mono small">{m.tickers.join(" ")}</td>
                    <td className="small">{longDate(m.trainStart)} – {longDate(m.trainEnd)}</td>
                    <td><span className={`pill ${m.status === "trained" ? "done" : m.status === "failed" ? "failed" : m.status === "training" ? "running" : "neutral"}`}>{m.status}</span></td>
                    <td className="num">{m.metrics ? pct(m.metrics.totalReturn) : "–"}</td>
                    <td className="num">{m.metrics ? pct(m.metrics.buyHoldReturn) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
