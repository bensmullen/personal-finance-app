"use client";
import { useState } from "react";
import { authorDomainOperation, authorOpeningInvestmentLot, authorMortgageRefinance, authorMortgageExtra, type AuthoredDomainOperation, type PersonalDraft, type JsonObject } from "../../src/application/personalMvp.js";
import { objectEntries, objectId, objectLabel } from "../entityPresentation.js";

const choices = [
  ["purchase", "Buy spot crypto / long call"], ["sale", "Sell investment"],
  ["ordinary_dividend", "Ordinary dividend"], ["qualified_dividend", "Qualified dividend (eligibility established)"],
  ["interest", "Investment interest distribution"], ["reinvest_dividend", "Reinvest dividend"], ["call_exercise", "Exercise long equity call"],
  ["conversion", "Direct in-plan Roth conversion"], ["direct_rollover", "Direct rollover / trustee transfer"],
  ["mixed_rollover", "Split pre-tax / after-tax direct rollover"], ["indirect_distribution", "Receive eligible plan distribution (20% withholding)"],
  ["indirect_deposit", "Complete 60-day plan-to-IRA rollover"], ["refinance", "Refinance fixed mortgage"],
  ["mortgage_extra", "Schedule mortgage extra principal"],
] as const;
const record = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);
export function DomainMechanicsPanel({ draft, setDraft }: { readonly draft: PersonalDraft; readonly setDraft: (draft: PersonalDraft) => void }) {
  const [kind, setKind] = useState<string>("sale"), [fields, setFields] = useState<Record<string, string>>({ amount: "0", order: "10", replacementAmount: "0", totalPayments: "360", dividendCharacter: "ordinary" }), [message, setMessage] = useState("");
  const change = (key: string, value: string) => setFields(prior => ({ ...prior, [key]: value }));
  const text = (key: string, label: string, type = "text") => <label key={key}>{label}<input aria-label={label} type={type} value={fields[key] ?? ""} onChange={event => change(key, event.target.value)} /></label>;
  const select = (key: string, label: string, items: readonly { id: string; label: string }[]) => <label key={key}>{label}<select aria-label={label} value={fields[key] ?? ""} onChange={event => change(key, event.target.value)}><option value="">Choose {label.toLowerCase()}</option>{items.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>;
  const investments = objectEntries(draft, "Investment").filter(item => kind !== "purchase" || item.investment_type === "crypto" || item.instrument_subtype === "long_equity_call").map(item => ({ id: objectId("Investment", item), label: objectLabel("Investment", item) }));
  const banks = objectEntries(draft, "Account").filter(item => ["checking", "savings"].includes(String(item.account_type))).map(item => ({ id: objectId("Account", item), label: objectLabel("Account", item) }));
  const retirement = ["conversion", "direct_rollover", "mixed_rollover", "indirect_distribution", "indirect_deposit"].includes(kind);
  const events = (draft.objects.Event ?? []).filter(record);
  const saved = events.filter(event => Array.isArray(event.effect_ids) && event.effect_ids.some(id => (draft.objects.EventEffect ?? []).filter(record).some(effect => effect.event_effect_id === id && ["d1_domain", "d1_refinance", "d1_mortgage_extra"].includes(String(effect.operation)))));
  const save = () => {
    try {
      const ids = { eventId: crypto.randomUUID(), effectId: crypto.randomUUID(), primitiveId: crypto.randomUUID() };
      if (kind === "mortgage_extra") {
        setDraft(authorMortgageExtra(draft, { ...ids, liabilityId: fields.liabilityId ?? "", date: fields.date ?? "", amount: fields.amount ?? "", fundingAccountId: fields.cashAccountId ?? "" }));
      } else if (kind === "refinance") {
        setDraft(authorMortgageRefinance(draft, { ...ids, liabilityId: fields.liabilityId ?? "", date: fields.date ?? "", annualRate: fields.annualRate ?? "", totalPayments: Number(fields.totalPayments) }));
      } else {
        const plan: AuthoredDomainOperation = { ...ids, name: choices.find(item => item[0] === kind)?.[1] ?? kind, date: fields.date ?? "", kind: kind as AuthoredDomainOperation["kind"], amount: fields.amount ?? "0", order: Number(fields.order),
          ...(kind === "indirect_deposit" ? {} : { holdingId: fields.holdingId ?? "" }),
          ...(["purchase", "call_exercise", "indirect_distribution"].includes(kind) ? { cashAccountId: fields.cashAccountId ?? "" } : {}),
          ...(["purchase", "sale", "reinvest_dividend", "call_exercise"].includes(kind) ? { quantity: fields.quantity ?? "" } : {}),
          ...(retirement ? { eligibility: kind === "indirect_distribution" || kind === "indirect_deposit" ? "eligible_owned_participant" : "eligible_owned_direct", destinationAcceptance: fields.acceptance === "yes" } : {}),
          ...(retirement && kind !== "indirect_distribution" ? { destinationHoldingId: fields.destinationHoldingId ?? "" } : {}),
          ...(kind === "mixed_rollover" ? { rothHoldingId: fields.rothHoldingId ?? "" } : {}),
          ...(kind === "conversion" ? { samePlanConfirmed: fields.samePlan === "yes" } : {}),
          ...(kind === "indirect_deposit" ? { linkedOperationId: fields.linkedOperationId ?? "", sourceAccountId: fields.sourceAccountId ?? "", replacementAmount: fields.replacementAmount ?? "0" } : {}),
          ...(kind === "reinvest_dividend" ? { dividendCharacter: fields.dividendCharacter as "ordinary" | "qualified" } : {}),
          ...(fields.lotIds && ["sale", "call_exercise"].includes(kind) ? { lotIds: fields.lotIds.split(",").map(id => id.trim()).filter(Boolean) } : {}),
        };
        setDraft(authorDomainOperation(draft, plan));
      }
      setMessage("Operation saved in the plan. Forecast compilation will check eligibility, funding and timing.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Operation could not be saved."); }
  };
  return <section className="panel" aria-label="Investment and retirement operations"><h2>Investment, retirement and mortgage operations</h2>
    <p>Sales and investment income remain in investment account cash. Reinvestment uses that income. Spot crypto and call premiums require checking or savings. Use Investment purchases for ordinary equity/fund purchases. Unsupported products are diagnosed before forecast use.</p>
    <label>Operation<select aria-label="Domain operation" value={kind} onChange={event => { setKind(event.target.value); setMessage(""); }}>{choices.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    {text("date", "Operation date", "date")}
    {kind === "refinance" ? <>{select("liabilityId", "Mortgage to replace", objectEntries(draft, "Liability").filter(item => item.liability_type === "mortgage").map(item => ({ id: objectId("Liability", item), label: objectLabel("Liability", item) })))}{text("annualRate", "Replacement nominal annual rate")}{text("totalPayments", "Replacement monthly payments", "number")}<p>Non-cash-out, no fees or escrow. Choose a scheduled payment date with no extra principal at that occurrence. The new loan starts a full-month schedule.</p></> : <>
      {kind !== "indirect_deposit" && kind !== "mortgage_extra" && select("holdingId", "Source / target holding", investments)}
      {kind === "mortgage_extra" && <>{select("liabilityId", "Mortgage for extra principal", objectEntries(draft, "Liability").filter(item => item.liability_type === "mortgage").map(item => ({ id: objectId("Liability", item), label: objectLabel("Liability", item) })))}{select("cashAccountId", "Extra principal checking / savings account", banks)}<p>Choose a scheduled payment date. Required debt service settles before extra principal; this choice is saved in the plan.</p></>}
      {text("amount", "Operation cash amount")}{text("order", "Same-date operation priority", "number")}
      {["purchase", "sale", "reinvest_dividend", "call_exercise"].includes(kind) && text("quantity", "Units / call contracts")}
      {["purchase", "call_exercise", "indirect_distribution"].includes(kind) && select("cashAccountId", kind === "indirect_distribution" ? "Received proceeds account" : "Purchase / exercise funding account", banks)}
      {retirement && <><label><input type="checkbox" checked={fields.acceptance === "yes"} onChange={event => change("acceptance", event.target.checked ? "yes" : "no")} />I have established owned/vested eligibility and destination/plan acceptance for this supported path.</label><p>RMD, hardship, inherited accounts, loan offsets and waiver cases are unavailable. Rollover and conversion amounts do not consume annual contribution limits.</p></>}
      {retirement && kind !== "indirect_distribution" && select("destinationHoldingId", "Retirement destination holding", investments)}
      {kind === "conversion" && <label><input type="checkbox" checked={fields.samePlan === "yes"} onChange={event => change("samePlan", event.target.checked ? "yes" : "no")} />Source and Roth destination are compartments of the same employer plan.</label>}
      {kind === "mixed_rollover" && select("rothHoldingId", "After-tax Roth IRA destination", investments)}
      {kind === "indirect_deposit" && <>{select("linkedOperationId", "Original participant distribution", saved.filter(event => (draft.objects.EventEffect ?? []).filter(record).some(effect => Array.isArray(event.effect_ids) && event.effect_ids.includes(effect.event_effect_id!) && (draft.objects.PrimitiveInstance ?? []).filter(record).some(primitive => primitive.primitive_instance_id === effect.primitive_instance_id && record(primitive.parameters) && primitive.parameters.kind === "indirect_distribution"))).map(event => ({ id: String(event.event_id), label: String(event.name) + " · " + String(event.start_date) })))}{text("replacementAmount", "Withholding replacement cash")}{select("sourceAccountId", "Replacement funding account", banks)}</>}
      {kind === "reinvest_dividend" && select("dividendCharacter", "Reinvested dividend character", [{ id: "ordinary", label: "Ordinary" }, { id: "qualified", label: "Qualified eligibility established" }])}
      {["sale", "call_exercise"].includes(kind) && <p>Lots use FIFO within this holding/account unless selected below.</p>}
      {["sale", "call_exercise"].includes(kind) && select("lotIds", "Specific opening lot (optional)", (draft.objects.Investment ?? []).filter(record).filter(item => item.investment_id === fields.holdingId).flatMap(item => Array.isArray(item.tax_lots) ? item.tax_lots.filter(record).map(lot => ({ id: String(lot.id), label: String(lot.acquired) + " · " + String(lot.quantity) + " units · basis " + String(lot.basis) })) : item.acquisition_date != null ? [{ id: String(item.investment_id) + ":opening", label: String(item.acquisition_date) + " · opening lot" }] : []))}
    </>}
    <button className="primary" onClick={save}>Save domain operation</button>{message && <p role="status">{message}</p>}
    <ul>{saved.map(event => <li key={String(event.event_id)}>{String(event.name)} · {String(event.start_date)} <button onClick={() => setDraft({ ...draft, objects: { ...draft.objects, Event: events.map(item => item === event ? { ...item, enabled: item.enabled !== true } : item) } })}>{event.enabled === true ? "Disable" : "Enable"}</button></li>)}</ul>
    <details><summary>Opening investment lots</summary><p>Enter each opening purchase lot with its actual acquisition date and economic cost basis. The lot units must reconcile to the investment's opening quantity; prior contribution usage is separate.</p>
      {select("lotHolding", "Opening lot investment", investments)}{text("lotAcquired", "Lot acquisition date", "date")}{text("lotQuantity", "Opening lot units")}{text("lotBasis", "Opening lot cost basis")}
      <button onClick={() => { try { setDraft(authorOpeningInvestmentLot(draft, fields.lotHolding ?? "", { id: crypto.randomUUID(), acquired: fields.lotAcquired ?? "", quantity: fields.lotQuantity ?? "", basis: fields.lotBasis ?? "" })); setMessage("Opening lot saved. Complete all lots before forecasting."); } catch (error) { setMessage(error instanceof Error ? error.message : "Lot could not be saved."); } }}>Add opening lot</button>
      <ul>{(draft.objects.Investment ?? []).filter(record).filter(item => item.investment_id === fields.lotHolding).flatMap(item => Array.isArray(item.tax_lots) ? item.tax_lots.filter(record).map(lot => <li key={String(lot.id)}>{String(lot.acquired)} · {String(lot.quantity)} units · basis {String(lot.basis)} <button onClick={() => setDraft({ ...draft, objects: { ...draft.objects, Investment: (draft.objects.Investment ?? []).filter(record).map(investment => investment === item ? { ...investment, tax_lots: (item.tax_lots as readonly JsonObject[]).filter(prior => prior !== lot) } : investment) } })}>Remove lot</button></li>) : [])}</ul>
    </details>
    <TermLifeEditor draft={draft} setDraft={setDraft} />
  </section>;
}

function TermLifeEditor({ draft, setDraft }: { readonly draft: PersonalDraft; readonly setDraft: (draft: PersonalDraft) => void }) {
  const [fields, setFields] = useState<Record<string, string>>({}), [message, setMessage] = useState("");
  const control = (key: string, label: string, options?: readonly { id: string; label: string }[], type = "text") => <label key={key}>{label}{options ? <select aria-label={label} value={fields[key] ?? ""} onChange={event => setFields({ ...fields, [key]: event.target.value })}><option value="">Choose {label.toLowerCase()}</option>{options.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select> : <input aria-label={label} type={type} value={fields[key] ?? ""} onChange={event => setFields({ ...fields, [key]: event.target.value })} />}</label>;
  const people = objectEntries(draft, "Person").map(item => ({ id: objectId("Person", item), label: objectLabel("Person", item) }));
  const banks = objectEntries(draft, "Account").filter(item => ["checking", "savings"].includes(String(item.account_type))).map(item => ({ id: objectId("Account", item), label: objectLabel("Account", item) }));
  const save = () => {
    const root = objectEntries(draft, "Scenario").filter(item => item.enabled === true && item.base_scenario_id == null);
    if (root.length !== 1 || Object.values(fields).some(value => !value) || ["owner", "insured", "beneficiary", "premiumAccount", "benefitAccount", "start", "end", "death", "premium", "benefit"].some(key => !fields[key])) return setMessage("Complete all policy identities, amounts and dates.");
    const insuranceId = crypto.randomUUID(), deathId = crypto.randomUUID();
    setDraft({ ...draft, objects: { ...draft.objects,
      Insurance: [...(draft.objects.Insurance ?? []), { insurance_id: insuranceId, owner_id: fields.owner!, insurance_type: "life", policy_family: "term_life_lump_sum", insured_person_id: fields.insured!, beneficiary_id: fields.beneficiary!, premium_account_id: fields.premiumAccount!, benefit_account_id: fields.benefitAccount!, premium: fields.premium!, premium_frequency: "monthly", coverage_amount: fields.benefit!, start_date: fields.start!, end_date: fields.end!, death_event_id: deathId }],
      Event: [...(draft.objects.Event ?? []), { event_id: deathId, name: "Scheduled insured death", event_type: "death", start_date: fields.death!, trigger_type: "scheduled", effect_ids: [], dependencies: [], precedence: 0, scenario_id: String(root[0]!.scenario_id), enabled: true }],
      Scenario: objectEntries(draft, "Scenario").map(item => item === root[0] ? { ...item, event_ids: [...(Array.isArray(item.event_ids) ? item.event_ids : []), deathId] } : item),
    } }); setMessage("Term-life policy and scheduled death event saved. Coverage and beneficiary ownership are checked before forecast use.");
  };
  return <details><summary>Term life insurance</summary><p>Personally owned term life, monthly premiums and one lump-sum death benefit. Cash-value policies, transfer-for-value and installment interest are unavailable.</p>
    {control("owner", "Policy owner", people)}{control("insured", "Insured person", people)}{control("beneficiary", "Benefit beneficiary", [...people, ...objectEntries(draft, "Household").map(item => ({ id: objectId("Household", item), label: objectLabel("Household", item) }))])}
    {control("premiumAccount", "Premium checking / savings account", banks)}{control("benefitAccount", "Benefit checking / savings account", banks)}{control("premium", "Monthly premium")}{control("benefit", "Lump-sum benefit")}
    {control("start", "Policy start", undefined, "date")}{control("end", "Policy end (exclusive)", undefined, "date")}{control("death", "Scheduled insured death date", undefined, "date")}
    <button onClick={save}>Save term-life policy</button>{message && <p role="status">{message}</p>}
    <ul>{(draft.objects.Insurance ?? []).filter(record).map(policy => <li key={String(policy.insurance_id)}>Term life · premium {String(policy.premium)} · benefit {String(policy.coverage_amount)} · {String(policy.start_date)}–{String(policy.end_date)} <button onClick={() => setDraft({ ...draft, objects: { ...draft.objects, Insurance: (draft.objects.Insurance ?? []).filter(item => item !== policy) } })}>Remove policy</button></li>)}</ul>
  </details>;
}
