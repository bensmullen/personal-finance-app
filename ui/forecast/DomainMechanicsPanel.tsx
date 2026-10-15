"use client";
import { useState } from "react";
import { authorDomainOperation, authorOpeningInvestmentLot, authorMortgageRefinance, authorMortgageExtra, type AuthoredDomainOperation, type PersonalDraft, type JsonObject } from "../../src/application/personalMvp.js";
import { objectEntries, objectId, objectLabel } from "../entityPresentation.js";
import { PercentageInput, FieldHelp } from "./PercentageInput.js";

import { GuidedFields } from "../authoring/GuidedFields.js";
import { authoringFailure } from "../authoring/contributionChoices.js";
import { OPERATION_OWNERS, ownedField, operationBindings } from "../authoring/activityOwnership.js";
import { fieldProblem } from "../authoring/fieldContract.js";
import { callExerciseAmount, domainActivities, holdingDomainActivities } from "../../src/application/investmentActivity.js";

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
export function DomainMechanicsPanel({ draft, setDraft, scope, holdingId }: { readonly draft: PersonalDraft; readonly setDraft: (draft: PersonalDraft) => void; readonly scope: "investment" | "mortgage"; readonly holdingId?: string }) {
  const holding = objectEntries(draft, "Investment").find(item => item.investment_id === holdingId);
  const account = objectEntries(draft, "Account").find(item => item.account_id === holding?.account_id);
  const fixedIncome = ["treasury_bill", "treasury_note", "treasury_bond", "cd"].includes(String(holding?.instrument_subtype));
  const available = choices.filter(([value]) => {
    if (scope === "mortgage") return ["mortgage_extra", "refinance"].includes(value);
    if (!holding || fixedIncome || ["mortgage_extra", "refinance"].includes(value)) return false;
    if (account?.account_type === "taxable_brokerage") {
      if (["conversion", "direct_rollover", "mixed_rollover", "indirect_distribution", "indirect_deposit"].includes(value)) return false;
      if (value === "purchase") return holding.investment_type === "crypto" || holding.instrument_subtype === "long_equity_call";
      if (value === "call_exercise") return holding.instrument_subtype === "long_equity_call";
      if (["ordinary_dividend", "qualified_dividend", "reinvest_dividend"].includes(value)) return ["equity", "fund"].includes(String(holding.investment_type));
      return value === "sale" || value === "interest";
    }
    return account?.account_type === "traditional_401k" ? ["conversion", "direct_rollover", "mixed_rollover", "indirect_distribution", "indirect_deposit"].includes(value)
      : ["traditional_ira", "roth_401k"].includes(String(account?.account_type)) && value === "direct_rollover";
  });
  const [kind, setKind] = useState<string>(available[0]?.[0] ?? "sale"), [fields, setFields] = useState<Record<string, string>>({ holdingId: holdingId ?? "", lotHolding: holdingId ?? "", amount: "", order: "10", replacementAmount: "0", totalPayments: "360", dividendCharacter: "ordinary" }), [message, setMessage] = useState("");
  const [editingEvent, setEditingEvent] = useState<string>();
  const change = (key: string, value: string) => setFields(prior => ({ ...prior, [key]: value, ...(kind === "call_exercise" && key === "quantity" ? { amount: callExerciseAmount(draft, holdingId ?? "", value) ?? "" } : {}) }));
  const text = (key: string, label: string, type = "text") => <label key={key}>{label}<input aria-label={label} type={type} readOnly={kind === "call_exercise" && key === "amount"} value={fields[key] ?? ""} onChange={event => change(key, event.target.value)} /></label>;
  const select = (key: string, label: string, items: readonly { id: string; label: string }[]) => <label key={key}>{label}<select aria-label={label} disabled={scope === "investment" && ["holdingId", "lotHolding"].includes(key)} value={fields[key] ?? ""} onChange={event => change(key, event.target.value)}><option value="">Choose {label.toLowerCase()}</option>{items.filter(item => !["holdingId", "lotHolding"].includes(key) || scope === "mortgage" || item.id === holdingId).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>;
  const investments = objectEntries(draft, "Investment").filter(item => kind !== "purchase" || item.investment_type === "crypto" || item.instrument_subtype === "long_equity_call").map(item => ({ id: objectId("Investment", item), label: objectLabel("Investment", item) }));
  const banks = objectEntries(draft, "Account").filter(item => ["checking", "savings"].includes(String(item.account_type)) && (scope === "mortgage" || item.owner_id === account?.owner_id && item.currency === account.currency)).map(item => ({ id: objectId("Account", item), label: objectLabel("Account", item) }));
  const destinations = investments.filter(item => {
    const investment = objectEntries(draft, "Investment").find(value => value.investment_id === item.id);
    const destination = objectEntries(draft, "Account").find(value => value.account_id === investment?.account_id);
    if (item.id === holdingId || destination?.owner_id !== account?.owner_id || destination?.currency !== account?.currency) return false;
    const type = String(destination?.account_type);
    return kind === "conversion" ? type === "roth_401k" : kind === "direct_rollover" ? account?.account_type === "roth_401k" ? type === "roth_ira" : ["traditional_ira", ...(account?.account_type === "traditional_401k" ? ["traditional_401k"] : [])].includes(type) : type === "traditional_ira";
  });
  const rothDestinations = investments.filter(item => { const target = objectEntries(draft, "Investment").find(value => value.investment_id === item.id); return objectEntries(draft, "Account").some(value => value.account_id === target?.account_id && value.account_type === "roth_ira" && value.owner_id === account?.owner_id && value.currency === account?.currency); });
  const retirement = ["conversion", "direct_rollover", "mixed_rollover", "indirect_distribution", "indirect_deposit"].includes(kind);
  const events = (draft.objects.Event ?? []).filter(record);
  const savedRows = scope === "investment" ? holdingDomainActivities(draft, holdingId ?? "") : domainActivities(draft).filter(row => ["d1_refinance", "d1_mortgage_extra"].includes(String(row.effect.operation)));
  const save = () => {
    try {
      const previous = savedRows.find(row => row.event.event_id === editingEvent);
      const ids = previous ? { eventId: String(previous.event.event_id), effectId: String(previous.effect.event_effect_id), primitiveId: String(previous.primitive.primitive_instance_id) } : { eventId: crypto.randomUUID(), effectId: crypto.randomUUID(), primitiveId: crypto.randomUUID() };
      if (kind === "mortgage_extra") {
        setDraft(authorMortgageExtra(draft, { ...ids, liabilityId: fields.liabilityId ?? "", date: fields.date ?? "", amount: fields.amount ?? "", fundingAccountId: fields.cashAccountId ?? "" }));
      } else if (kind === "refinance") {
        setDraft(authorMortgageRefinance(draft, { ...ids, liabilityId: fields.liabilityId ?? "", date: fields.date ?? "", annualRate: fields.annualRate ?? "", totalPayments: Number(fields.totalPayments) }));
      } else {
        const plan: AuthoredDomainOperation = { ...ids, name: typeof previous?.event.name === "string" ? previous.event.name : choices.find(item => item[0] === kind)?.[1] ?? kind, date: fields.date ?? "", kind: kind as AuthoredDomainOperation["kind"], amount: fields.amount ?? "0", order: Number(fields.order),
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
      setMessage("Activity saved. Update the forecast to check eligibility, funding and timing.");
    } catch (error) { setMessage(authoringFailure(error)); }
  };
  const required = ["operation", "operationDate", ...(kind === "refinance" ? ["operationMortgage", "totalPayments"] : ["operationAmount", "operationOrder"]), ...(kind === "mortgage_extra" ? ["operationMortgage", "operationFunding"] : kind !== "refinance" && kind !== "indirect_deposit" ? ["operationHolding"] : []), ...(["purchase", "sale", "reinvest_dividend", "call_exercise"].includes(kind) ? ["operationUnits"] : []), ...(["purchase", "call_exercise", "indirect_distribution"].includes(kind) ? ["operationFunding"] : []), ...(retirement ? ["operationAcceptance"] : []), ...(retirement && kind !== "indirect_distribution" ? ["operationDestination"] : [])];
  const family = OPERATION_OWNERS[kind as keyof typeof OPERATION_OWNERS];
  const activityScope = JSON.stringify({ holdingId, accountId: account?.account_id, eventId: editingEvent ?? "new", date: fields.date, scenarioIds: objectEntries(draft, "Scenario").filter(item => item.enabled === true && item.base_scenario_id == null).map(item => item.scenario_id) });
  const bindings = operationBindings(kind as keyof typeof OPERATION_OWNERS);
  const presentations = Object.fromEntries(Object.entries(bindings).map(([key, binding]) => [key, ownedField(key, family, binding, activityScope, "Saved D1 scheduled activity in the current plan")]));
  if (scope === "investment") presentations.operationHolding = { ...presentations.operationHolding!, state: "read-only" };
  if (kind === "call_exercise") presentations.operationAmount = { ...presentations.operationAmount!, state: "derived", semanticBinding: "strikeFromHolding", description: "Exercise cash calculated from this call's strike, contract multiplier and chosen contracts.", source: "Recorded option terms and chosen whole contracts", dependencies: ["operationUnits", "strike_price", "contract_multiplier"] };
  for (const key of ["lotHolding", "lotDate", "lotUnits", "lotBasis"]) presentations[key] = ownedField(key, "investment.holding", ({ lotHolding: "holdingId", lotDate: "acquired", lotUnits: "quantity", lotBasis: "basis" } as Record<string, string>)[key]!, holdingId ?? "", "This holding's recorded opening tax lots");
  presentations.lotHolding = { ...presentations.lotHolding!, state: "read-only" };
  const labelKeys: Record<string, string> = { date: "operationDate", amount: "operationAmount", quantity: "operationUnits", holdingId: "operationHolding", cashAccountId: "operationFunding", order: "operationOrder", destinationHoldingId: "operationDestination", rothHoldingId: "rothDestination", linkedOperationId: "linkedDistribution", replacementAmount: "replacementCash", totalPayments: "totalPayments", liabilityId: "operationMortgage" };
  const draftProblems = Object.entries(labelKeys).filter(([, key]) => required.includes(key)).map(([name, key]) => fieldProblem(presentations[key]!, fields[name], true)).filter(Boolean);
  const selectionProblems = {
    operation: available.some(([value]) => value === kind) ? undefined : "Choose an activity supported by this account and holding.",
    operationUnits: kind === "call_exercise" && !callExerciseAmount(draft, holdingId ?? "", fields.quantity ?? "") ? "Enter positive whole call contracts with established strike and multiplier terms." : undefined,
    operationDestination: retirement && kind !== "indirect_distribution" && fields.destinationHoldingId && !destinations.some(item => item.id === fields.destinationHoldingId) ? "Choose a compatible destination owned by the same person." : undefined,
    operationFunding: ["purchase", "call_exercise", "indirect_distribution", "mortgage_extra"].includes(kind) && fields.cashAccountId && !banks.some(item => item.id === fields.cashAccountId) ? "Choose a compatible checking or savings account." : kind === "indirect_deposit" && fields.sourceAccountId && !banks.some(item => item.id === fields.sourceAccountId) ? "Choose compatible replacement funding." : undefined,
  };
  if (scope === "investment" && !available.length) return <p role="note">{fixedIncome ? "Use this holding's instrument terms for acquisition, interest and maturity; additional transactions are not supported." : "Activity for this account type is not supported yet."}</p>;
  return <GuidedFields scope="scheduled-activity" required={required} presentations={presentations} errors={selectionProblems}><section className="panel" aria-label={scope === "mortgage" ? "Mortgage operations" : "Investment and retirement operations"} data-source-holding={holdingId}><h2>{scope === "mortgage" ? "Extra principal & refinancing" : "Activity & transfers"}</h2>
    {scope === "investment" && <p>{objectLabel("Investment", holding!)} · {objectLabel("Account", account!)}. Saved activity uses this holding's funds and recorded basis.</p>}
    <label>Activity type<select aria-label="Activity type" value={kind} disabled={!!editingEvent} onChange={event => { setKind(event.target.value); setFields(prior => ({ holdingId: holdingId ?? "", lotHolding: holdingId ?? "", order: prior.order ?? "10", replacementAmount: "0", totalPayments: "360", dividendCharacter: "ordinary" })); setMessage(""); }}>{available.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    {text("date", "Operation date", "date")}
    {kind === "refinance" ? <>{select("liabilityId", "Mortgage to replace", objectEntries(draft, "Liability").filter(item => item.liability_type === "mortgage").map(item => ({ id: objectId("Liability", item), label: objectLabel("Liability", item) })))}<PercentageInput label="Replacement nominal annual rate" required value={fields.annualRate ?? ""} onChange={value => change("annualRate", value)} />{text("totalPayments", "Replacement monthly payments", "number")}<p>Non-cash-out, no fees or escrow. Choose a scheduled payment date with no extra principal at that occurrence. The new loan starts a full-month schedule.</p></> : <>
      {kind !== "indirect_deposit" && kind !== "mortgage_extra" && select("holdingId", "Source / target holding", investments)}
      {kind === "mortgage_extra" && <>{select("liabilityId", "Mortgage for extra principal", objectEntries(draft, "Liability").filter(item => item.liability_type === "mortgage").map(item => ({ id: objectId("Liability", item), label: objectLabel("Liability", item) })))}{select("cashAccountId", "Extra principal checking / savings account", banks)}<p>Choose a scheduled payment date. Required debt service settles before extra principal; this choice is saved in the plan.</p></>}
      {text("amount", "Operation cash amount")}<details><summary>Advanced same-day operation ordering</summary>{text("order", "Same-date operation priority", "number")}<FieldHelp label="Same-date operation priority">Enter a whole number; lower numbers run first for competing operations on the same day. For example order 10 runs before order 20. The forecast needs an explicit order when operations share funding; this cannot create extra cash.</FieldHelp></details>
      {["purchase", "sale", "reinvest_dividend", "call_exercise"].includes(kind) && text("quantity", "Units / call contracts")}
      {["purchase", "call_exercise", "indirect_distribution"].includes(kind) && select("cashAccountId", kind === "indirect_distribution" ? "Received proceeds account" : "Purchase / exercise funding account", banks)}
      {retirement && <><label><input type="checkbox" checked={fields.acceptance === "yes"} onChange={event => change("acceptance", event.target.checked ? "yes" : "no")} />I have established owned/vested eligibility and destination/plan acceptance for this supported path.</label><p>RMD, hardship, inherited accounts, loan offsets and waiver cases are unavailable. Rollover and conversion amounts do not consume annual contribution limits.</p></>}
      {retirement && kind !== "indirect_distribution" && select("destinationHoldingId", "Retirement destination holding", destinations)}
      {kind === "conversion" && <label><input type="checkbox" checked={fields.samePlan === "yes"} onChange={event => change("samePlan", event.target.checked ? "yes" : "no")} />Source and Roth destination are compartments of the same employer plan.</label>}
      {kind === "mixed_rollover" && select("rothHoldingId", "After-tax Roth IRA destination", rothDestinations)}
      {kind === "indirect_deposit" && <>{select("linkedOperationId", "Original participant distribution", savedRows.filter(row => row.terms.kind === "indirect_distribution" && row.event.enabled === true).map(row => ({ id: String(row.event.event_id), label: String(row.event.name) + " · " + String(row.event.start_date) })))}{text("replacementAmount", "Withholding replacement cash")}{select("sourceAccountId", "Replacement funding account", banks)}</>}
      {kind === "reinvest_dividend" && select("dividendCharacter", "Reinvested dividend character", [{ id: "ordinary", label: "Ordinary" }, { id: "qualified", label: "Qualified eligibility established" }])}
      {["sale", "call_exercise"].includes(kind) && <p>Lots use FIFO within this holding/account unless selected below.</p>}
      {["sale", "call_exercise"].includes(kind) && select("lotIds", "Specific opening lot (optional)", (draft.objects.Investment ?? []).filter(record).filter(item => item.investment_id === fields.holdingId).flatMap(item => Array.isArray(item.tax_lots) ? item.tax_lots.filter(record).map(lot => ({ id: String(lot.id), label: String(lot.acquired) + " · " + String(lot.quantity) + " units · basis " + String(lot.basis) })) : item.acquisition_date != null ? [{ id: String(item.investment_id) + ":opening", label: String(item.acquisition_date) + " · opening lot" }] : []))}
    </>}
    <button className="primary" disabled={draftProblems.length > 0 || Object.values(selectionProblems).some(Boolean) || retirement && fields.acceptance !== "yes" || kind === "conversion" && fields.samePlan !== "yes" || kind === "mixed_rollover" && !fields.rothHoldingId || kind === "indirect_deposit" && !fields.linkedOperationId} onClick={save}>Save activity</button>{message && <p role="status">{message}</p>}
    {editingEvent && <button onClick={() => { setEditingEvent(undefined); setMessage(""); setFields({ holdingId: holdingId ?? "", lotHolding: holdingId ?? "", amount: "", order: "10", replacementAmount: "0", totalPayments: "360", dividendCharacter: "ordinary" }); }}>Finish editing / new activity</button>}
    <ul>{savedRows.map(row => <li key={String(row.event.event_id)}>{String(row.event.name)} · {String(row.event.start_date)}
      {scope === "investment" && available.some(([value]) => value === row.terms.kind) && <button onClick={() => {
        setEditingEvent(String(row.event.event_id)); setKind(String(row.terms.kind));
        setFields({ ...Object.fromEntries(Object.entries(row.terms).filter(([, value]) => typeof value === "string" || typeof value === "number").map(([key, value]) => [key, String(value)])), holdingId: holdingId ?? "", lotHolding: holdingId ?? "", date: String(row.event.start_date), acceptance: row.terms.destinationAcceptance === true ? "yes" : "no", samePlan: row.terms.samePlanConfirmed === true ? "yes" : "no", lotIds: Array.isArray(row.terms.lotIds) ? row.terms.lotIds.join(",") : "" }); setMessage("");
      }}>Edit activity</button>}
      <button onClick={() => setDraft({ ...draft, objects: { ...draft.objects, Event: events.map(item => item === row.event ? { ...item, enabled: item.enabled !== true } : item) } })}>{row.event.enabled === true ? "Disable" : "Enable"}</button></li>)}</ul>
    {scope === "investment" && <details><summary>Opening investment lots</summary><p>Enter each opening purchase lot with its actual acquisition date and economic cost basis. The lot units must reconcile to the investment's opening quantity; prior contribution usage is separate.</p>
      {select("lotHolding", "Opening lot investment", investments)}{text("lotAcquired", "Lot acquisition date", "date")}{text("lotQuantity", "Opening lot units")}{text("lotBasis", "Opening lot cost basis")}
      <button onClick={() => { try { setDraft(authorOpeningInvestmentLot(draft, holdingId ?? "", { id: crypto.randomUUID(), acquired: fields.lotAcquired ?? "", quantity: fields.lotQuantity ?? "", basis: fields.lotBasis ?? "" })); setMessage("Opening lot saved. Complete all lots before forecasting."); } catch (error) { setMessage(authoringFailure(error)); } }}>Add opening lot</button>
      <ul>{(draft.objects.Investment ?? []).filter(record).filter(item => item.investment_id === fields.lotHolding).flatMap(item => Array.isArray(item.tax_lots) ? item.tax_lots.filter(record).map(lot => <li key={String(lot.id)}>{String(lot.acquired)} · {String(lot.quantity)} units · basis {String(lot.basis)} <button onClick={() => setDraft({ ...draft, objects: { ...draft.objects, Investment: (draft.objects.Investment ?? []).filter(record).map(investment => investment === item ? { ...investment, tax_lots: (item.tax_lots as readonly JsonObject[]).filter(prior => prior !== lot) } : investment) } })}>Remove lot</button></li>) : [])}</ul>
    </details>}
  </section></GuidedFields>;
}
