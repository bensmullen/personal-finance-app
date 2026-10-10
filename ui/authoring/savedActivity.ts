import { getPersonalPurchasePlans, getPayrollContributionPlans, getPersonalRetirementPlans, type JsonObject, type PersonalDraft } from "../../src/application/personalMvp.js";
import { formatExactMoney, formatRate, objectEntries, objectLabel, referenceLabel } from "../entityPresentation.js";

interface Activity { key: string; title: string; target: string; detail: string; schedule: string; status: string; investmentId?: string; relatedInvestmentIds?: readonly string[]; liabilityId?: string; contributionKind?: "personal" | "payroll"; }
const record = (value: unknown): value is JsonObject => !!value && typeof value === "object" && !Array.isArray(value);
/** Read existing authoring contracts; recorded activity is not a claim of executable funding. */
export function savedActivity(draft: PersonalDraft): readonly Activity[] {
  const rows: Activity[] = [];
  for (const plan of getPersonalPurchasePlans(draft)) {
    const holding = objectEntries(draft, "Investment").find(item => item.investment_id === plan.investmentId);
    const account = objectEntries(draft, "Account").find(item => item.account_id === holding?.account_id);
    rows.push({ key: plan.id, title: "Investment purchase", target: referenceLabel(draft, "Investment", plan.investmentId), investmentId: plan.investmentId, contributionKind: "personal",
      detail: `${formatExactMoney(plan.amount, account?.currency)} from ${referenceLabel(draft, "Account", plan.sourceCashAccountId)}`,
      schedule: plan.schedule.kind === "utc_monthly" ? `Monthly from ${plan.schedule.anchor.slice(0, 10)}` : `One time on ${plan.schedule.dates[0]?.slice(0, 10) ?? "date unavailable"}`,
      status: "Recorded · funding and eligibility checked by forecast" });
  }
  for (const plan of getPayrollContributionPlans(draft)) {
    const allocation = plan.allocation;
    const calculation = allocation.calculation;
    rows.push({ key: allocation.id, title: allocation.policy.character.replaceAll("_", " ") + " contribution", target: referenceLabel(draft, "Investment", allocation.positionId), investmentId: String(allocation.positionId), contributionKind: "payroll",
      detail: `${calculation.kind === "fixed" ? formatExactMoney(calculation.amount.amount.toString(), calculation.amount.currency.code) : formatRate(calculation.rate)} from ${referenceLabel(draft, "Income", plan.incomeId)}`,
      schedule: "Each eligible payroll occurrence", status: "Recorded · annual eligibility checked by forecast" });
    for (const event of plan.events) rows.push({ key: String(event.eventId), title: event.kind === "vest" ? "Employer units become owned" : "Unvested employer units forfeited", target: referenceLabel(draft, "Investment", allocation.positionId), investmentId: String(allocation.positionId), detail: "Uses the recorded workplace ownership policy", schedule: `One time on ${event.at.slice(0, 10)}`, status: "Recorded · execution checked by forecast" });
  }
  for (const plan of getPersonalRetirementPlans(draft)) rows.push({ key: `retirement:${plan.incomeId}`, title: "Retirement", target: referenceLabel(draft, "Income", plan.incomeId), detail: "Ends the linked salary; distributions require separately supported activity", schedule: `On ${plan.date}`, status: "Recorded" });
  const effects = (draft.objects.EventEffect ?? []).filter(record), primitives = (draft.objects.PrimitiveInstance ?? []).filter(record);
  for (const event of (draft.objects.Event ?? []).filter(record)) {
    for (const effect of effects.filter(item => Array.isArray(event.effect_ids) && event.effect_ids.includes(String(item.event_effect_id)))) {
      const primitive = primitives.find(item => item.primitive_instance_id === effect.primitive_instance_id);
      const terms = primitive?.parameters;
      if (!record(terms) || !["d1-domain-operation/v1", "d1-mortgage-extra/v1", "d1-refinance/v1"].includes(String(terms.adapter))) continue;
      const investmentId = typeof terms.holdingId === "string" ? terms.holdingId : typeof terms.destinationHoldingId === "string" ? terms.destinationHoldingId : undefined;
      const liabilityId = typeof terms.liabilityId === "string" ? terms.liabilityId : undefined;
      const account = objectEntries(draft, "Account").find(item => item.account_id === (terms.cashAccountId ?? terms.fundingAccountId));
      const relatedInvestmentIds = [terms.holdingId, terms.destinationHoldingId, terms.rothHoldingId].filter((id): id is string => typeof id === "string");
      const title = terms.adapter === "d1-mortgage-extra/v1" ? "Extra mortgage principal" : terms.adapter === "d1-refinance/v1" ? "Mortgage refinance" : ({ purchase: "Investment purchase", sale: "Investment sale", ordinary_dividend: "Ordinary dividend", qualified_dividend: "Qualified dividend", interest: "Investment interest", reinvest_dividend: "Dividend reinvestment", call_exercise: "Call exercise", conversion: "Roth conversion", direct_rollover: "Direct retirement rollover", mixed_rollover: "Split retirement rollover", indirect_distribution: "Participant distribution", indirect_deposit: "Indirect rollover deposit" } as Record<string, string>)[String(terms.kind)] ?? "Saved financial activity";
      rows.push({ key: String(event.event_id) + String(effect.event_effect_id), title, target: relatedInvestmentIds.length ? relatedInvestmentIds.map(id => referenceLabel(draft, "Investment", id)).join(" → ") : liabilityId ? referenceLabel(draft, "Liability", liabilityId) : "Plan activity", relatedInvestmentIds,
        ...(investmentId ? { investmentId } : {}), ...(liabilityId ? { liabilityId } : {}),
        detail: [terms.amount == null ? undefined : formatExactMoney(terms.amount, account?.currency ?? "USD"), terms.quantity == null ? undefined : `${terms.quantity} units`, account ? `from ${objectLabel("Account", account)}` : undefined, terms.annualRate == null ? undefined : `${formatRate(terms.annualRate)} annual rate`, terms.totalPayments == null ? undefined : `${terms.totalPayments} monthly payments`].filter(Boolean).join(" · "),
        schedule: `One time on ${String(event.start_date ?? "date unavailable")}`,
        status: event.enabled === true && primitive?.enabled === true ? "Recorded · execution checked by forecast" : "Disabled" });
    }
  }
  return rows;
}
