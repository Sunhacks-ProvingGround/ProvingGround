import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { Overview } from "./pages/Overview";
import { NewRun } from "./pages/NewRun";
import { Runs } from "./pages/Runs";
import { RunDetail } from "./pages/RunDetail";
import { Preview } from "./pages/Preview";
import { Models } from "./pages/Models";
import { ModelPage } from "./pages/ModelPage";

type Route = { page: "overview" | "new" | "runs" | "run" | "preview" | "models" | "model" | "test"; id?: string };

function parse(hash: string): Route {
  const h = hash.replace(/^#\/?/, "");
  if (h.startsWith("run/")) return { page: "run", id: h.slice(4) };
  if (h.startsWith("model/")) return { page: "model", id: h.slice(6) };
  if (h.startsWith("test/")) return { page: "test", id: h.slice(5) };
  if (h === "models") return { page: "models" };
  if (h === "new" || h === "runs" || h === "preview") return { page: h };
  return { page: "overview" };
}

function App() {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  const [windowKey, setWindowKey] = useState("demo");

  useEffect(() => {
    const on = () => {
      setRoute(parse(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  const icon = (d: string) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
  );
  const nav = [
    { href: "#/", page: "overview", label: "Leakage Gap", icon: icon("M3 17l5-5 4 4 8-9M14 7h6v6") },
    { href: "#/models", page: "models", label: "Your models", icon: icon("M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM12 12l8-4.5M12 12v9M12 12L4 7.5") },
    { href: "#/new", page: "new", label: "Run a test", icon: icon("M12 21a9 9 0 100-18 9 9 0 000 18zM10 8.5l5.5 3.5-5.5 3.5v-7z") },
    { href: "#/runs", page: "runs", label: "Run log", icon: icon("M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01") },
    { href: "#/preview", page: "preview", label: "What the agent sees", icon: icon("M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z") },
  ];
  const current = (p: string) =>
    route.page === p || (route.page === "run" && p === "runs") || (route.page === "model" && p === "models") || (route.page === "test" && p === "new");

  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="wordmark" href="#/">
          <span className="logo" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 16l5-5 4 3.5L20 7" /></svg>
          </span>
          <span className="wm-text">ProvingGround</span>
        </a>
        <nav className="side-nav" aria-label="Main">
          {nav.map((n) => (
            <a key={n.page} href={n.href} aria-current={current(n.page) ? "page" : undefined}>{n.icon}{n.label}</a>
          ))}
        </nav>
        <div className="side-foot">
          <div className="side-card">
            <b>A fair exam for trading agents</b>
            <span>The database hides the future. Every run is registered before it starts.</span>
          </div>
        </div>
      </aside>
      <div className="content">
      <main>
        {route.page === "overview" && <Overview windowKey={windowKey} setWindowKey={setWindowKey} />}
        {route.page === "new" && <NewRun />}
        {route.page === "test" && route.id && <NewRun key={route.id} modelId={route.id} />}
        {route.page === "runs" && <Runs />}
        {route.page === "run" && route.id && <RunDetail id={route.id} />}
        {route.page === "preview" && <Preview />}
        {route.page === "models" && <Models />}
        {route.page === "model" && route.id && <ModelPage key={route.id} id={route.id} />}
      </main>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
