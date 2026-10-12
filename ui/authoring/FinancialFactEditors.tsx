"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { annualFieldOwners, annualFieldsFor, resolveAnnualFinancialFact, recordAnnualFinancialFact, contributionFactSources, type AnnualField } from "../../src/application/financialFacts.js";
import type { FactScope } from "../../src/application/factResolution.js";
import type { PersonalDraft } from "../../src/application/personalMvp.js";
import { FieldShell, focusRepair } from "./FieldShell.js";
import { financialField, fieldProblem } from "./fieldContract.js";
import { referenceLabel, objectEntries } from "../entityPresentation.js";
import { authoringFailure } from "./contributionChoices.js";
const OwnerEditor = createContext<(field: AnnualField, scope: FactScope) => void>(() => {});
const choices: Partial<Record<AnnualField, readonly string[]>> = {
  filingStatus: ["single", "married_joint", "married_separate", "head_of_household", "qualifying_surviving_spouse"],
  hsaCoverage: ["self", "family"], planHasRoth: ["true", "false"], hsaFullYearEligible: ["true", "false"],
  workplacePlanCovered: ["true", "false"], spouseWorkplacePlanCovered: ["true", "false"], livesWithSpouse: ["true", "false"],
};
export function FinancialFactEditors({ draft, setDraft, children }: { draft: PersonalDraft; setDraft: (draft: PersonalDraft) => void; children: ReactNode }) {
  const [target, setTarget] = useState<{ field: AnnualField; scope: FactScope }>();
  return <OwnerEditor.Provider value={(field, scope) => setTarget({ field, scope })}>{children}
    {target && <AnnualFactDialog key={`${target.field}:${JSON.stringify(target.scope)}`} draft={draft} setDraft={setDraft} {...target} close={() => setTarget(undefined)} />}
  </OwnerEditor.Provider>;
}
function AnnualFactDialog({ draft, setDraft, field, scope, close }: { draft: PersonalDraft; setDraft: (draft: PersonalDraft) => void; field: AnnualField; scope: FactScope; close: () => void }) {
  const resolved = resolveAnnualFinancialFact(draft, field, scope);
  const meta = financialField(annualFieldOwners[field].fieldKey);
  const original = resolved.value === undefined ? "" : String(resolved.value);
  const [value, setValue] = useState(original), [error, setError] = useState(""), [discard, setDiscard] = useState(false);
  const root = useRef<HTMLElement>(null);
  const dismiss = () => value === original ? close() : setDiscard(true);
  const problem = choices[field] ? !choices[field]!.includes(value) ? "Choose an established value for this year." : undefined : fieldProblem(meta, value, true);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    focusRepair(root.current?.querySelector<HTMLElement>("input, select, button"));
    return () => { document.body.style.overflow = overflow; if (opener?.isConnected) opener.focus(); };
  }, []);
  return <div className="drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) dismiss(); }}>
    <aside className="drawer" ref={root} role="dialog" aria-modal="true" aria-label={`Edit ${meta.label}`} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); dismiss(); }
      if (event.key === "Tab") {
        const controls = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, summary') ?? []).filter(control => control.getClientRects().length);
        if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
        if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
      }
    }}>
      <div className="panel-head"><h2>{meta.label}</h2><button type="button" onClick={dismiss}>Close editor</button></div>
      <p>{referenceLabel(draft, "Person", scope.personId)} · {scope.taxYear}{scope.sponsorId && ` · ${scope.sponsorId}`}</p>
      <small>Saved once · {resolved.repair.owner}</small>
      {field === "filingStatus" && <p role="note">This dated fact currently governs contribution eligibility. Household tax calculations still use the separately recorded filing status. Unified year-by-year tax filing is awaiting engine support.</p>}
      {resolved.status === "true_conflict" && <p role="alert">Recorded sources disagree on this fact for {scope.taxYear}. Confirm the correct value below to reconcile the listed sources.</p>}
      {!!resolved.sources.length && <details open={resolved.status === "true_conflict"}><summary>Recorded sources</summary><ul>{resolved.sources.map(source => <li key={source.id}>{source.label}: {String(source.value)}</li>)}</ul></details>}
      {field === "ageAtYearEnd" ? <><p>Age on December 31: {original || "Date of birth needed"}. This is calculated from the person's recorded birth date.</p><p>Update the person's date of birth in Household & People; annual age has no independent edit.</p></> :
        <form onSubmit={event => {
          event.preventDefault(); if (problem) return;
          try { setDraft(recordAnnualFinancialFact(draft, { id: crypto.randomUUID(), field, scope,
            value: value === "true" ? true : value === "false" ? false : value, reconciledSources: resolved.sources.map(source => source.id) })); close(); }
          catch (failure) { setError(authoringFailure(failure)); }
        }}>
          <FieldShell fieldKey={annualFieldOwners[field].fieldKey} required error={problem} repairKey={`annual:${field}`}>
            {choices[field] ? <select aria-label={meta.label} value={value} onChange={event => setValue(event.target.value)}><option value="">Not established</option>{choices[field]!.map(option => <option key={option} value={option}>{option === "true" ? "Yes" : option === "false" ? "No" : option.replaceAll("_", " ")}</option>)}</select>
              : <input aria-label={meta.label} inputMode="decimal" placeholder={meta.example} value={value} onChange={event => setValue(event.target.value)} />}
          </FieldShell>
          <small>Save confirms this year and these named sources only. Original evidence and prior contribution totals are preserved.</small>
          {error && <p role="alert">{error}</p>}
          <button className="primary" type="submit" disabled={!!problem}>Confirm & save fact</button>
        </form>}
      {discard && <section role="alert"><p>Discard unsaved changes?</p><button onClick={close}>Discard changes</button><button autoFocus onClick={() => setDiscard(false)}>Continue editing</button></section>}
    </aside>
  </div>;
}
export function AnnualFactsReview({ draft, character, scope }: { draft: PersonalDraft; character: string; scope: FactScope }) {
  const open = useContext(OwnerEditor);
  if (!scope.personId || !Number.isSafeInteger(scope.taxYear)) return <p>Choose an account and contribution year to review eligibility.</p>;
  return <details className="financial-section"><summary>Annual eligibility · {scope.taxYear}</summary><dl>{annualFieldsFor(character).map(field => {
    const resolved = resolveAnnualFinancialFact(draft, field, scope), meta = financialField(annualFieldOwners[field].fieldKey);
    return <div key={field} data-semantic-fact={resolved.semanticId}><dt>{meta.label}</dt><dd>{resolved.status === "true_conflict" ? "Conflicting sources" : resolved.value === undefined ? "Not established" : String(resolved.value)}
      {field !== "ageAtYearEnd" && <button type="button" onClick={() => open(field, scope)}>{resolved.status === "true_conflict" ? "Reconcile" : "Review"} {meta.label.toLowerCase()}</button>}
      {field === "ageAtYearEnd" && <small>From date of birth · Household & People</small>}
    </dd></div>;
  })}</dl><small>Each value belongs to its named source editor; this summary does not edit a second copy. Later years need their own dated facts.</small></details>;
}
export function AnnualFactsOwner({ draft, owner }: { draft: PersonalDraft; owner: "people" | "income" | "investment" }) {
  const open = useContext(OwnerEditor);
  const people = objectEntries(draft, "Person"), sources = contributionFactSources(draft);
  const [personId, setPersonId] = useState(""), [year, setYear] = useState("2026"), [sponsorId, setSponsorId] = useState("");
  const person = people.find(item => item.person_id === personId) ?? people[0];
  const scope: FactScope = { personId: String(person?.person_id ?? ""), householdId: String(person?.household_id ?? ""), taxYear: Number(year), ...(sponsorId ? { sponsorId } : {}) };
  return <details className="financial-section" data-fact-owner={owner}><summary>{owner === "people" ? "Tax & health coverage by year" : owner === "income" ? "Annual earned pay & prior employer wages" : "Employer plan eligibility by year"}</summary>
    <FieldShell fieldKey="owner"><select aria-label="Annual facts person" value={scope.personId} onChange={event => setPersonId(event.target.value)}>{people.map(item => <option key={String(item.person_id)} value={String(item.person_id)}>{referenceLabel(draft, "Person", item.person_id)}</option>)}</select></FieldShell>
    <FieldShell fieldKey="taxYear" required><input aria-label="Annual facts year" type="number" min="2026" max="9998" value={year} onChange={event => setYear(event.target.value)} /></FieldShell>
    {owner !== "people" && <FieldShell fieldKey="planKey"><select aria-label="Annual facts employer plan" value={sponsorId} onChange={event => setSponsorId(event.target.value)}><option value="">Choose employer plan</option>{[...new Set(sources.flatMap(source => source.scope.personId === scope.personId && source.scope.sponsorId ? [source.scope.sponsorId] : []))].map(id => <option key={id} value={id}>{id}</option>)}</select></FieldShell>}
    <dl>{(Object.keys(annualFieldOwners) as AnnualField[]).filter(field => annualFieldOwners[field].owner === owner && field !== "ageAtYearEnd").map(field => {
      const resolved = resolveAnnualFinancialFact(draft, field, scope), meta = financialField(annualFieldOwners[field].fieldKey);
      return <div key={field}><dt>{meta.label}</dt><dd>{resolved.status === "true_conflict" ? "Conflicting sources" : resolved.value === undefined ? "Not established" : String(resolved.value)} <button type="button" disabled={!scope.personId || !year || Number(year) < 2026 || !!annualFieldOwners[field].sponsor && !sponsorId} onClick={() => open(field, scope)}>Review {meta.label.toLowerCase()}</button></dd></div>;
    })}</dl>
  </details>;
}
