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

type Route = { page: "overview" | "new" | "runs" | "run" | "preview" | "models" | "model"; id?: string };

function parse(hash: string): Route {
  const h = hash.replace(/^#\/?/, "");
  if (h.startsWith("run/")) return { page: "run", id: h.slice(4) };
  if (h.startsWith("model/")) return { page: "model", id: h.slice(6) };
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

  const nav = [
    { href: "#/", page: "overview", label: "Leakage Gap" },
    { href: "#/models", page: "models", label: "Your models" },
    { href: "#/new", page: "new", label: "Run a test" },
    { href: "#/runs", page: "runs", label: "Run log" },
    { href: "#/preview", page: "preview", label: "What the agent sees" },
  ];

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="wordmark" href="#/">
            <svg viewBox="0 0 32 32" aria-hidden><path d="M5 23l7-8 6 5 9-12" stroke="currentColor" strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            ProvingGround
          </a>
          <nav className="nav" aria-label="Main">
            {nav.map((n) => (
              <a key={n.page} href={n.href} aria-current={route.page === n.page || (route.page === "run" && n.page === "runs") || (route.page === "model" && n.page === "models") ? "page" : undefined}>{n.label}</a>
            ))}
          </nav>
        </div>
      </header>
      <main>
        {route.page === "overview" && <Overview windowKey={windowKey} setWindowKey={setWindowKey} />}
        {route.page === "new" && <NewRun />}
        {route.page === "runs" && <Runs />}
        {route.page === "run" && route.id && <RunDetail id={route.id} />}
        {route.page === "preview" && <Preview />}
        {route.page === "models" && <Models />}
        {route.page === "model" && route.id && <ModelPage key={route.id} id={route.id} />}
      </main>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
