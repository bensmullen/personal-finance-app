"use client";
import { useState } from "react";
import { authorTermLifePolicy, authorInsuredDeathScenario, unlinkPolicyDeathScenario, termLifeProblems, type TermLifeTerms } from "../../src/application/insuranceAuthoring.js";
import type { PersonalDraft, JsonObject } from "../../src/application/personalMvp.js";
import { objectEntries, objectLabel, referenceLabel, formatExactMoney } from "../entityPresentation.js";
import { FieldShell, RepairSummary, focusRepair } from "./FieldShell.js";
import { TERM_BINDINGS, ownedField } from "./activityOwnership.js";
import { fieldProblem } from "./fieldContract.js";

type Props = { readonly draft: PersonalDraft; readonly setDraft: (draft: PersonalDraft) => void };
const termsOf = (policy?: JsonObject): TermLifeTerms => ({
  owner: String(policy?.owner_id ?? ""), insured: String(policy?.insured_person_id ?? ""), beneficiary: String(policy?.beneficiary_id ?? ""),
  premiumAccount: String(policy?.premium_account_id ?? ""), benefitAccount: String(policy?.benefit_account_id ?? ""),
  premium: String(policy?.premium ?? ""), benefit: String(policy?.coverage_amount ?? ""), start: String(policy?.start_date ?? ""), end: String(policy?.end_date ?? ""),
});
const supported = (policy: JsonObject) => policy.insurance_type === "life" && policy.policy_family === "term_life_lump_sum" && policy.premium_frequency === "monthly" && policy.claim_probability_model_id == null;

export function InsuranceSection({ draft, setDraft }: Props) {
  const [editing, setEditing] = useState<string>(), [lifePolicy, setLifePolicy] = useState<string>();
  const policies = objectEntries(draft, "Insurance");
  return <section aria-label="Insurance & coverage" className="panel">
    <div className="page-head compact"><div><h1>Insurance & coverage</h1><p>Term-life protection, monthly premiums and a conditional benefit.</p></div><button className="primary" onClick={() => setEditing("new")}>Add term-life policy</button></div>
    {!policies.length && !editing && <p>No saved policies.</p>}
    <div className="object-grid">{policies.map(policy => {
      const id = String(policy.insurance_id), death = objectEntries(draft, "Event").find(item => item.event_id === policy.death_event_id);
      return <article className="object-card" key={id} aria-label={`Policy for ${referenceLabel(draft, "Person", policy.insured_person_id)}`}>
        <h2>Term life · {referenceLabel(draft, "Person", policy.insured_person_id)}</h2>
        <p>{formatExactMoney(policy.coverage_amount, "USD")} protection · {formatExactMoney(policy.premium, "USD")} monthly premium</p>
        <small>{String(policy.start_date)}–{String(policy.end_date)} (end excluded)</small>
        <p>Beneficiary: {referenceLabel(draft, "Person|Household", policy.beneficiary_id)}</p>
        {supported(policy) ? <button onClick={() => setEditing(id)}>Edit policy</button> : <p role="note">This policy type is not modeled by this editor. Import corrected supported terms; the saved record is preserved.</p>}
        <details><summary>Payment & scenario details</summary>
          <p>Premiums: {referenceLabel(draft, "Account", policy.premium_account_id)}. Conditional benefit deposit: {referenceLabel(draft, "Account", policy.benefit_account_id)}.</p>
          <p>{death ? `${objectLabel("Event", death)} · ${String(death.start_date)} · ${death.enabled === true ? "Enabled" : "Disabled"}` : policy.death_event_id != null ? "The linked life event is missing. Review or unlink the scenario." : "No death scenario. The face amount is protection, not a forecast cash receipt."}</p>
          {supported(policy) && <button onClick={() => setLifePolicy(id)}>{death ? "Review life event" : "Add optional death scenario"}</button>}
          {policy.death_event_id != null && <button onClick={() => setDraft(unlinkPolicyDeathScenario(draft, id))}>Unlink death scenario</button>}
          <details><summary>Technical details / Entity IDs</summary><pre>{JSON.stringify(policy, null, 2)}</pre></details>
        </details>
      </article>;
    })}</div>
    {editing && <PolicyEditor key={editing} {...{ draft, setDraft }} policyId={editing === "new" ? undefined : editing} close={() => setEditing(undefined)} />}
    {lifePolicy && <InsuredDeathEditor key={lifePolicy} {...{ draft, setDraft }} policyId={lifePolicy} close={() => setLifePolicy(undefined)} />}
    <p className="muted">Cash-value policies, transfer-for-value and installment benefits are not supported.</p>
  </section>;
}

function PolicyEditor({ draft, setDraft, policyId, close }: Props & { policyId: string | undefined; close: () => void }) {
  const original = objectEntries(draft, "Insurance").find(item => item.insurance_id === policyId);
  const [terms, setTerms] = useState(() => termsOf(original)), [message, setMessage] = useState(""), [discard, setDiscard] = useState(false);
  const problems = termLifeProblems(draft, terms), identity = policyId ?? "new-policy";
  const people = objectEntries(draft, "Person"), owner = people.find(item => item.person_id === terms.owner);
  const personChoices = people.filter(item => !owner || item.household_id === owner.household_id).map(item => ({ id: String(item.person_id), label: objectLabel("Person", item) }));
  const beneficiaries = [...personChoices, ...objectEntries(draft, "Household").filter(item => !owner || item.household_id === owner.household_id).map(item => ({ id: String(item.household_id), label: objectLabel("Household", item) }))];
  const banks = objectEntries(draft, "Account").filter(item => ["checking", "savings"].includes(String(item.account_type)) && item.currency === "USD");
  const options: Partial<Record<keyof TermLifeTerms, readonly { id: string; label: string }[]>> = {
    owner: personChoices, insured: personChoices, beneficiary: beneficiaries,
    premiumAccount: banks.filter(item => item.owner_id === terms.owner).map(item => ({ id: String(item.account_id), label: objectLabel("Account", item) })),
    benefitAccount: banks.filter(item => item.owner_id === terms.beneficiary || objectEntries(draft, "Household").some(household => household.household_id === terms.beneficiary) && people.some(person => person.person_id === item.owner_id && person.household_id === terms.beneficiary)).map(item => ({ id: String(item.account_id), label: objectLabel("Account", item) })),
  };
  const control = (key: keyof TermLifeTerms) => {
    const [fieldKey, family, binding] = TERM_BINDINGS[key], choices = options[key];
    return <FieldShell key={key} fieldKey={fieldKey} required error={problems[key]} repairKey={`policy:${identity}:${key}`} presentation={ownedField(fieldKey, family, binding, identity, "This saved Insurance policy's contract terms")}>
      {choices ? <select value={terms[key]} onChange={event => setTerms(prior => ({ ...prior, [key]: event.target.value }))}><option value="">Choose</option>{choices.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        : <input type={key === "start" || key === "end" ? "date" : "text"} inputMode={key === "premium" || key === "benefit" ? "decimal" : undefined} value={terms[key]} onChange={event => setTerms(prior => ({ ...prior, [key]: event.target.value }))} />}
    </FieldShell>;
  };
  const cancel = () => { if (JSON.stringify(terms) !== JSON.stringify(termsOf(original))) setDiscard(true); else close(); };
  return <section className="panel" aria-label="Edit term-life policy" data-authoring-scope="term-life-policy">
    <h2>{original ? "Edit term-life policy" : "New term-life policy"}</h2>
    <form onSubmit={event => { event.preventDefault(); try { setDraft(authorTermLifePolicy(draft, policyId ?? crypto.randomUUID(), terms)); close(); } catch (failure) { setMessage(failure instanceof Error ? failure.message : "Policy could not be saved. Review the terms and retry."); } }}>
      <RepairSummary errors={Object.entries(problems).map(([key, message]) => ({ target: `policy:${identity}:${key}`, message }))} />
      <div className="form-grid">{(["owner", "insured", "beneficiary", "benefit", "start", "end"] as const).map(control)}</div>
      <h3>Premiums & benefit deposit</h3><div className="form-grid">{(["premium", "premiumAccount", "benefitAccount"] as const).map(control)}</div>
      <button type="submit" className="primary" disabled={Object.keys(problems).length > 0}>Save term-life policy</button><button type="button" onClick={cancel}>Cancel policy edit</button>
      {message && <p role="alert">{message}</p>}
      {discard && <div role="alert"><p>There are unsaved policy changes.</p><button type="button" onClick={close}>Discard changes</button><button type="button" onClick={() => setDiscard(false)}>Continue editing</button></div>}
    </form>
  </section>;
}

/** One Life Events editor is mounted by either entry route, never a policy field. */
export function InsuredDeathEditor({ draft, setDraft, policyId, close }: Props & { policyId: string; close: () => void }) {
  const policy = objectEntries(draft, "Insurance").find(item => item.insurance_id === policyId)!;
  const prior = objectEntries(draft, "Event").find(item => item.event_id === policy.death_event_id);
  const scenarios = objectEntries(draft, "Scenario").filter(item => item.enabled === true && item.base_scenario_id == null);
  const [date, setDate] = useState(String(prior?.start_date ?? "")), [scenario, setScenario] = useState(String(prior?.scenario_id ?? (scenarios.length === 1 ? scenarios[0]!.scenario_id : ""))), [enabled, setEnabled] = useState(prior?.enabled !== false), [message, setMessage] = useState(""), [discard, setDiscard] = useState(false);
  const problem = fieldProblem(ownedField("deathDate", "life.death_event", "eventDate", policyId, "Scheduled Event in the selected plan"), date, true) ?? (date < String(policy.start_date) || date >= String(policy.end_date) ? "Choose a date within this policy's coverage interval." : undefined);
  const cancel = () => { if (date !== String(prior?.start_date ?? "") || scenario !== String(prior?.scenario_id ?? (scenarios.length === 1 ? scenarios[0]!.scenario_id : "")) || enabled !== (prior?.enabled !== false)) setDiscard(true); else close(); };
  return <section className="panel" aria-label="Edit insured death scenario" data-authoring-scope="life-death-event">
    <h2>Optional life event</h2><p>{referenceLabel(draft, "Person", policy.insured_person_id)} · This scenario changes the forecast; it is separate from the policy contract.</p>
    <form onSubmit={event => { event.preventDefault(); try { setDraft(authorInsuredDeathScenario(draft, { policyId, eventId: String(prior?.event_id ?? crypto.randomUUID()), scenarioId: scenario, date, enabled })); close(); } catch (failure) { setMessage(failure instanceof Error ? failure.message : "Life event could not be saved. Review the scenario and retry."); } }}>
      <FieldShell fieldKey="deathPlan" required presentation={ownedField("deathPlan", "life.death_event", "scenarioId", policyId, "Selected canonical Scenario")}><select value={scenario} onChange={event => setScenario(event.target.value)}><option value="">Choose plan</option>{scenarios.map(item => <option key={String(item.scenario_id)} value={String(item.scenario_id)}>{objectLabel("Scenario", item)}</option>)}</select></FieldShell>
      <FieldShell fieldKey="deathDate" required error={problem} presentation={ownedField("deathDate", "life.death_event", "eventDate", policyId, "Scheduled canonical Event")}><input autoFocus type="date" value={date} onChange={event => setDate(event.target.value)} /></FieldShell>
      <FieldShell fieldKey="deathEnabled" presentation={ownedField("deathEnabled", "life.death_event", "enabled", policyId, "Scheduled canonical Event")}><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /></FieldShell>
      <button className="primary" type="submit" disabled={!!problem || !scenario}>Save life event</button><button type="button" onClick={cancel}>Cancel life event edit</button>
      {message && <p role="alert">{message}</p>}
      {discard && <div role="alert"><p>There are unsaved life-event changes.</p><button type="button" onClick={close}>Discard changes</button><button type="button" onClick={() => setDiscard(false)}>Continue editing</button></div>}
    </form>
  </section>;
}
export function InsuredLifeEvents({ draft, setDraft }: Props) {
  const [policyId, setPolicyId] = useState<string>();
  return <section className="panel" aria-label="Insured life events"><h2>Insurance life events</h2><p>A death scenario is optional. Policy contracts are managed in Money → Insurance & coverage.</p>
    {objectEntries(draft, "Insurance").filter(supported).map(policy => <p key={String(policy.insurance_id)}>{referenceLabel(draft, "Person", policy.insured_person_id)} <button onClick={() => { setPolicyId(String(policy.insurance_id)); requestAnimationFrame(() => focusRepair(document.querySelector<HTMLElement>('[data-authoring-scope="life-death-event"] input'))); }}>{policy.death_event_id != null ? "Review life event" : "Add optional death scenario"}</button></p>)}
    {policyId && <InsuredDeathEditor key={policyId} {...{ draft, setDraft }} policyId={policyId} close={() => setPolicyId(undefined)} />}
  </section>;
}
