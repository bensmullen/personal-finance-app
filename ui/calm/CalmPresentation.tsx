import * as React from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/** Small disclosures retain labels/IDs, never forecast payloads. */
export function ContextDisclosure({ title, children, className = "" }: { title: ReactNode; children: ReactNode; className?: string }) {
  const ref = React.useRef<HTMLDetailsElement>(null);
  React.useEffect(() => {
    const close = (event: PointerEvent | KeyboardEvent) => {
      const root = ref.current;
      if (!root?.open) return;
      if (event instanceof KeyboardEvent) {
        // Use the original key event target: a dialog may restore focus into this\n        // disclosure while its own Escape event bubbles to document.\n        if (event.key !== "Escape" || !root.contains(event.target as Node)) return;
        event.preventDefault();
        root.open = false;
        root.querySelector("summary")?.focus();
      } else if (!root.contains(event.target as Node)) root.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, []);
  return <details ref={ref} className={`context-disclosure ${className}`}><summary>{title}</summary><div className="context-popover" onClick={event => {
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

export function SharedContextRibbon({ household, people, plan, modelStatus, modelDetails, forecast, save, saveLabel, storage, onPerson, onPeople }: {
  household: string; people: readonly { id: string; label: string }[]; plan: string;
  modelStatus: string; modelDetails: ReactNode; forecast: ReactNode;
  save: () => void; saveLabel: string; storage: string;
  onPerson: (id: string) => void; onPeople: () => void;
}) {
  const choose = (event: React.MouseEvent<HTMLButtonElement>, action: () => void) => {
    const details = event.currentTarget.closest("details");
    if (details) { details.open = false; details.querySelector("summary")?.focus(); }
    action();
  };
  return <section className="shared-context" aria-label="Household & status">
    <ContextDisclosure title={<><span className="context-household">{household}</span><span className="context-menu-hint"> · People</span></>} className="context-people">
      <h2>Household &amp; People</h2>
      <p>One household · member links open recorded people. Forecast scope stays household-wide.</p>
      {people.length ? people.map(person => <button key={person.id} type="button" onClick={event => choose(event, () => onPerson(person.id))}>{person.label}</button>) : <p>No people recorded.</p>}
      <button type="button" onClick={event => choose(event, onPeople)}>Add / edit household &amp; people</button>
    </ContextDisclosure>
    <div className="context-plan"><span>{plan}</span><small>Household forecast</small></div>
    <ContextDisclosure title={`Model: ${modelStatus}`} className="context-model">{modelDetails}</ContextDisclosure>
    {forecast}
    <div className="context-save-actions">
      <button className="context-save" type="button" onClick={save}>{saveLabel}</button>
      <small className="context-save-cue">Manual save · edits in memory.<br />Forecasts do not save.</small>
    </div>
    <ContextDisclosure title="Storage & privacy" className="context-storage"><p>Save or export explicitly to keep changes. Completing a forecast does not save your model.</p><p>{storage}</p></ContextDisclosure>
  </section>;
}

/** Targets are scoped to one chart, never to the Cash page. */
const CashDetailsTarget = React.createContext<HTMLElement | null | undefined>(undefined);
export function CashDetailsContent({ children }: { children: ReactNode }) {
  const target = React.useContext(CashDetailsTarget);
  return target === undefined ? <>{children}</> : target ? createPortal(children, target) : null;
}

export function CashChartDetails({ title, children }: { title: string; children: ReactNode }) {
  return <details className="calm-disclosure cash-chart-details" aria-label={`${title} Chart Details`}><summary>Chart Details</summary><div>{children}</div></details>;
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
