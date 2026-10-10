"use client";
import { type PersonalDraft } from "../../src/application/personalMvp.js";
import { objectEntries } from "../entityPresentation.js";
import { savedActivity } from "./savedActivity.js";
export function ScheduledActivity({ draft, accountId, investmentId, liabilityId, onContributions }: { draft: PersonalDraft; accountId?: string; investmentId?: string; liabilityId?: string; onContributions?: (id: string, kind: "personal" | "payroll") => void }) {
  try {
    const holdings = objectEntries(draft, "Investment");
    const rows = savedActivity(draft).filter(row => investmentId ? row.investmentId === investmentId || row.relatedInvestmentIds?.includes(investmentId) : liabilityId ? row.liabilityId === liabilityId : accountId ? holdings.some(item => item.account_id === accountId && (item.investment_id === row.investmentId || row.relatedInvestmentIds?.includes(String(item.investment_id)))) : true);
    if (!rows.length) return <small>No scheduled activity recorded.</small>;
    return <details className="financial-section"><summary>Scheduled activity · {rows.length}</summary><ul>{rows.map(row => <li key={row.key}><strong>{row.title} · {row.target}</strong><p>{row.detail} · {row.schedule}</p><small>{row.status}</small>{row.investmentId && row.contributionKind && onContributions && <button type="button" onClick={() => onContributions(row.investmentId!, row.contributionKind!)}>Review contribution plan</button>}</li>)}</ul><small>Recorded operations are read-only here. Use the contribution editor for supported contribution changes; imported or managed events require a corrected model.</small></details>;
  } catch { return <p role="note">Saved activity needs review in Current Plan. Import corrected activity if its authoring contract is unavailable.</p>; }
}
