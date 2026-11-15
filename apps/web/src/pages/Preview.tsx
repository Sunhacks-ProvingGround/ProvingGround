import { useEffect, useState } from "react";
import { api } from "../api";
import { Section } from "../section";

const WINDOWS = {
  demo: { min: "2020-01-24", max: "2020-04-20", start: "2020-03-16" },
  control: { min: "2026-07-01", max: "2026-09-24", start: "2026-08-14" },
};

export function Preview() {
  const [windowKey, setWindowKey] = useState<keyof typeof WINDOWS>("demo");
  const [day, setDay] = useState(WINDOWS.demo.start);
  const [data, setData] = useState<{ normal: string; blind: string } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    api.preview(day, windowKey).then(setData, (e) => setError(e.message));
  }, [day, windowKey]);

  return (
    <>
      <section>
        <h1>What the agent sees</h1>
        <p className="lede">
          The exact briefing the AI agent gets after the close on one day. On the left, the real market. On the right, the same
          information in disguise. Nothing after the chosen day is ever included: the database hides it.
        </p>
        <div className="row" style={{ marginTop: 16 }}>
          <div className="seg" role="group" aria-label="Test window">
            <button aria-pressed={windowKey === "demo"} onClick={() => { setWindowKey("demo"); setDay(WINDOWS.demo.start); }}>2020 COVID crash</button>
            <button aria-pressed={windowKey === "control"} onClick={() => { setWindowKey("control"); setDay(WINDOWS.control.start); }}>2026 control</button>
          </div>
          <label className="row small">
            Day
            <input id="preview-day" type="date" value={day} min={WINDOWS[windowKey].min} max={WINDOWS[windowKey].max} onChange={(e) => e.target.value && setDay(e.target.value)} />
          </label>
        </div>
      </section>
      {error && <div className="error">{error}</div>}
      <div className="grid-2">
        <Section id="preview-normal" title="Normal mode" subtitle="Real names, dates and prices" meta={data ? `${data.normal.split("\n").length} lines` : undefined}>
          <pre className="briefing">{data?.normal ?? "Loading…"}</pre>
        </Section>
        <Section id="preview-blind" title="Blind mode" subtitle="The same information in disguise" meta={data ? `${data.blind.split("\n").length} lines` : undefined}>
          <pre className="briefing">{data?.blind ?? "Loading…"}</pre>
        </Section>
      </div>
    </>
  );
}
