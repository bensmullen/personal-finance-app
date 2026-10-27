import * as React from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/** Small disclosures retain labels/IDs, never forecast payloads. */
export function ContextDisclosure({ title, children, className = "", accessibleLabel }: { title: ReactNode; children: ReactNode; className?: string; accessibleLabel?: string }) {
  const ref = React.useRef<HTMLDetailsElement>(null);
  const id = React.useId();
  const [expanded, setExpanded] = React.useState(false);
  React.useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const measure = () => {
      const box = root.getBoundingClientRect();
      root.style.setProperty("--context-room", `${Math.max(0, className.includes("context-plan") ? box.right - 12 : window.innerWidth - box.left - 12)}px`);
      if (root.closest(".context-actions")) {
        // Desktop details live beside the rail, never over its destinations.
        // Bound them below the header even after scrolling or enlarging text.
        const headerBottom = document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0;
        const railRight = root.closest(".primary-nav")?.getBoundingClientRect().right ?? box.right;
        const left = Math.max(box.right, railRight) + 12;
        const bottom = Math.max(12, window.innerHeight - box.bottom);
        root.style.setProperty("--status-panel-left", `${left}px`);
        root.style.setProperty("--status-panel-bottom", `${bottom}px`);
        root.style.setProperty("--status-panel-height", `${Math.max(0, window.innerHeight - bottom - Math.max(12, headerBottom + 12))}px`);
        root.style.setProperty("--status-panel-width", `${Math.max(0, window.innerWidth - left - 12)}px`);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [className, expanded]);
  React.useEffect(() => {
    const close = (event: PointerEvent | KeyboardEvent) => {
      const root = ref.current;
      if (!root?.open) return;
      // Owner dialogs are outside the ribbon DOM. Their keys and pointer
      // interactions belong to the editor, including its dismissal event.
      if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('[role="dialog"], .drawer-backdrop'))) return;
      if (event instanceof KeyboardEvent) {
        // Focus can return to the opener before this event reaches document.
        if (event.key !== "Escape" || !root.contains(event.target as Node)) return;
        event.preventDefault();
        root.open = false;
        root.querySelector("summary")?.focus();
      } else if (!root.contains(event.target as Node)) { root.open = false; root.querySelector("summary")?.focus(); }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, []);
  return <details ref={ref} onToggle={event => setExpanded(event.currentTarget.open)} className={`context-disclosure ${className}`} onKeyDown={event => {
    if (!className.includes("context-people") && !className.includes("context-plan")) return;
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || !(event.target instanceof Element) || !event.target.matches("summary, button")) return;
    const root = event.currentTarget;
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>(".context-popover button:not(:disabled)"));
    if (!buttons.length) return;
    event.preventDefault(); root.open = true;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : index < 0 ? event.key === "ArrowUp" ? buttons.length - 1 : 0
        : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }}><summary aria-label={accessibleLabel} aria-expanded={expanded} aria-controls={id}>{title}</summary><div id={id} className="context-popover" onClick={event => {
    if (!(event.target as Element).closest("[data-context-route]")) return;
    if (ref.current) ref.current.open = false;
  }}>{children}</div></details>;
}

export function forecastContextLabel(state: { pending: boolean; stale: boolean; lifecycle: string }, setupChanged = false) {
  if (state.pending) return "Running";
  if (state.lifecycle === "error") return "Failed";
  if (state.lifecycle === "cancelled") return "Cancelled";
  if (state.stale || setupChanged) return "Out of date";
  return ({ completed: "Ready", incomplete: "Partial", unsupported: "Unsupported", idle: "Needs setup" } as Record<string, string>)[state.lifecycle] ?? "Unavailable";
}

/** Only navigation labels live in the header; financial scope remains household-wide. */
export function SharedContextRibbon({ people, membershipReview, plan, activePerson, onPerson, onPeople, onHousehold, onPlan }: {
  household: string; people: readonly { id: string; label: string; shortLabel: string }[]; plan: string;
  membershipReview?: string; activePerson?: string;
  onPerson: (id: string) => void; onPeople: () => void; onHousehold: () => void; onPlan: (compare: boolean) => void;
}) {
  const choose = (event: React.MouseEvent<HTMLButtonElement>, action: () => void) => {
    const details = event.currentTarget.closest("details");
    if (details) { details.open = false; details.querySelector("summary")?.focus(); }
    action();
  };
  return <section className="shared-context" aria-label="Household & status">
    <ContextDisclosure accessibleLabel={`Person / Household: ${people.find(person => person.id === activePerson)?.shortLabel ?? "Household"}`} title={<><span className="context-household">{people.find(person => person.id === activePerson)?.shortLabel ?? "Household"}</span><span aria-hidden="true">⌄</span></>} className="context-people">
      <h2>Household &amp; People</h2>
      <p>People open recorded profiles. Financial results stay household-wide.</p>
      <button type="button" aria-pressed={!activePerson} onClick={event => choose(event, onHousehold)}>Household</button>
      {membershipReview && <p role="status">Needs review: {membershipReview}</p>}
      {people.length ? people.map(person => <button key={person.id} type="button" aria-pressed={person.id === activePerson} onClick={event => choose(event, () => onPerson(person.id))}>{person.label}</button>) : <p>No verified household members.</p>}
      <button type="button" onClick={event => choose(event, onPeople)}>Add / edit household &amp; people</button>
    </ContextDisclosure>
    <ContextDisclosure accessibleLabel={`Plan: ${plan}`} title={<><span className="context-plan-label">{plan}</span><span aria-hidden="true">⌄</span></>} className="context-plan">
      <h2>Plan</h2><p>{plan}. Saved means execution is not selected. Plan links open existing workflows; they do not switch execution.</p>
      <button type="button" onClick={event => choose(event, () => onPlan(false))}>Current Plan</button>
      <button type="button" onClick={event => choose(event, () => onPlan(true))}>Compare Plans</button>
    </ContextDisclosure>
  </section>;
}

export function StatusIndicator({ name, status }: { name: string; status: string }) {
  const tone = status === "Ready" ? "ready" : status === "Running" ? "pending" : status === "Failed" ? "error"
    : ["Needs setup", "Unavailable"].includes(status) ? "idle" : "review";
  return <><span aria-hidden="true" className={`status-marker status-${tone}`}>{tone === "ready" ? "✓" : tone === "error" ? "!" : tone === "review" ? "!" : ""}</span>{name}</>;
}

/** Only real worker/evidence pending boundaries mount this shared indicator. */
export function ForecastProgress({ pending, retained = false, label }: { pending: boolean; retained?: boolean; label?: string }) {
  return pending ? <p className="forecast-progress" role="status" aria-live="polite"><span aria-hidden="true" className="status-marker status-pending" />{label ?? (retained ? "Updating · retained results are out of date" : "Calculating forecast…")}</p> : null;
}

/** One mounted action owner, relocated into More on small screens. */
export function ResponsiveContextActions({ children }: { children: ReactNode }) {
  const [mobile, setMobile] = React.useState(false);
  React.useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const update = () => setMobile(query.matches);
    update(); query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const content = <section className="context-actions" aria-label="Status & Actions">{children}</section>;
  const target = mobile ? document.getElementById("mobile-status-actions") : null;
  return target ? createPortal(content, target) : content;
}

/** Targets are scoped to one chart, never to the Cash page. */
const CashDetailsTarget = React.createContext<HTMLElement | null | undefined>(undefined);
export function CashDetailsContent({ children }: { children: ReactNode }) {
  const target = React.useContext(CashDetailsTarget);
  return target === undefined ? <>{children}</> : target ? createPortal(children, target) : null;
}

export function CashChartDetails({ title, children }: { title: string; children: ReactNode }) {
  return <details className="calm-disclosure cash-chart-details chart-control-details" aria-label={`${title} Chart Details`}><summary>Chart Details</summary><div>{children}</div></details>;
}

/** Keep interspersed monthly evidence mounted once, even while collapsed. */
export function CashDetailsScope({ enabled, title, children }: { enabled: boolean; title: string; children: ReactNode }) {
  const [target, setTarget] = React.useState<HTMLDivElement | null>(null);
  if (!enabled) return <>{children}</>;
  return <CashDetailsTarget.Provider value={target}>{children}<CashChartDetails title={title}><div ref={setTarget} /></CashChartDetails></CashDetailsTarget.Provider>;
}

/** Presentation only: callers supply exact, sourced values and state language. */
export function CalmAction({ children, onClick, primary = false }: { children: ReactNode; onClick: () => void; primary?: boolean }) {
  return <button type="button" className={`calm-action${primary ? " calm-action-primary" : ""}`} onClick={onClick}>{children}</button>;
}

export function CalmPageHeader({ title, description, children, eyebrow = "Overview" }: { title: string; description: string; children: ReactNode; eyebrow?: string }) {
  return <header className="calm-page-header"><div><p className="calm-eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div><div className="calm-header-actions">{children}</div></header>;
}

export function CalmMetric({ label, value, source, explanation }: { label: string; value: string | undefined; source: string; explanation: string }) {
  return <article className="calm-metric" aria-label={label}><h3>{label}</h3><p className="calm-metric-value">{value ?? "Unavailable"}</p><p className="calm-metric-source">{source}</p><p>{explanation}</p></article>;
}

export function CalmPanel({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return <section className={`calm-panel ${className}`} aria-label={title}><h2>{title}</h2>{children}</section>;
}

export function CalmDisclosure({ title, children }: { title: string; children: ReactNode }) {
  return <details className="calm-disclosure"><summary>{title}</summary><div>{children}</div></details>;
}
