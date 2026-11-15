import { useEffect, useId, useState, type ReactNode } from "react";

/**
 * A collapsible card: click the header to open or close it. The header keeps
 * a short summary on the right, so a closed section still says what is in it.
 * Open/closed state is remembered per section in this browser.
 */
const key = (id: string) => `pg-section:${id}`;
const EXPAND_EVENT = "pg-sections";

function remembered(id: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key(id));
    return v == null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

export function Section({ id, title, subtitle, meta, defaultOpen = true, children, flush = false }: {
  /** Stable id, used to remember whether it is open. */
  id: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Short summary shown on the right of the header, open or closed. */
  meta?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  /** Body without inner padding (for full-bleed tables). */
  flush?: boolean;
}) {
  const [open, setOpen] = useState(() => remembered(id, defaultOpen));
  const bodyId = useId();

  useEffect(() => {
    const on = (e: Event) => {
      const next = (e as CustomEvent<boolean>).detail;
      setOpen(next);
      try { localStorage.setItem(key(id), next ? "1" : "0"); } catch { /* storage unavailable */ }
    };
    window.addEventListener(EXPAND_EVENT, on);
    return () => window.removeEventListener(EXPAND_EVENT, on);
  }, []);

  const toggle = () => {
    setOpen((o) => {
      try { localStorage.setItem(key(id), o ? "0" : "1"); } catch { /* storage unavailable */ }
      return !o;
    });
  };

  return (
    <section className={`section ${open ? "open" : ""}`}>
      <button type="button" className="section-head" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
        <span className="section-titles">
          <span className="section-title">{title}</span>
          {subtitle && <span className="section-sub">{subtitle}</span>}
        </span>
        {meta != null && <span className="section-meta">{meta}</span>}
        <svg className="chevron" viewBox="0 0 20 20" aria-hidden><path d="M6 8l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <div className="section-body-wrap" id={bodyId} role="region" hidden={!open}>
        <div className={`section-body ${flush ? "flush" : ""}`}>{children}</div>
      </div>
    </section>
  );
}

/** "Expand all · Collapse all" for every Section on the page. */
export function ExpandAll() {
  const set = (open: boolean) => {
    window.dispatchEvent(new CustomEvent(EXPAND_EVENT, { detail: open }));
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k?.startsWith("pg-section:")) localStorage.setItem(k, open ? "1" : "0");
      }
    } catch { /* storage unavailable */ }
  };
  return (
    <div className="expand-all">
      <button type="button" onClick={() => set(true)}>Expand all</button>
      <span aria-hidden>·</span>
      <button type="button" onClick={() => set(false)}>Collapse all</button>
    </div>
  );
}
