import * as React from "react";
import type { ReactNode } from "react";

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
