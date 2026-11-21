import { accountingTransactionId, createAccountingLeg, createAccountingTransaction, type AccountingLegDraft } from "../../../../../src/accounting/index.js";
import { domainId, generatedOccurrenceKey, type DomainId } from "../../../../../src/identity/index.js";
import { calculationTraceId, calculationTraceRef, freezeTraceRefs } from "../../../../../src/lineage/index.js";
import { sha256 } from "../../../../../src/rules/tax/t1b/contentIdentity.js";
import { canonicalSerialize } from "../../../../../src/simulation/run.js";
import { aftertaxPremiumOriginalDigest, registerAftertaxPremiumSourcePort, type AftertaxPremiumOriginal } from "../../../../../src/simulation/d2/integration/aftertaxPremiums/index.js";
import { registerHouseholdExpenseOriginalProvider, type HouseholdExpenseOriginal, type HouseholdExpenseSourceRef } from "../../../../../src/simulation/d2/integration/householdBank/expenses.js";
import { registerRetirementRawSourcePort, type RetirementRawSource } from "../../../../../src/simulation/d2/integration/retirementCash/index.js";
import { retirementRawSourceDigest } from "../../../../../src/simulation/d2/integration/retirementCash/source.js";
import { proposePremiums } from "../../../../../src/simulation/d2/health/premiums/index.js";
import { instant, utcMonthlyPeriods } from "../../../../../src/time/index.js";
import { money } from "../../../../../src/values/index.js";
import { request as premiumRequest, confirmation as premiumConfirmation, ids as premiumIds } from "../../householdBankCardAftertax/scenario.js";
import { retirementOriginal, ids as retirementIds } from "../../householdBankRetirementMedicare/scenario.js";
import { request as medicareRequest, confirmations as medicareConfirmations, person, household, bank as cmsAccount } from "../../medicareBank/scenario.js";
import { bank, bankEvent, context, ids, openingMonth, sameObservation, seenAt, start } from "./bank.js";
import { cents } from "./cashSources.js";
import { mapDocument, observe } from "./sourceMeter.js";

const premiumPublisher = "s8-five-health-insurer";
const cmsPublisher = "s8-five-standalone-CMS";
export const healthFault: { premium?: boolean; cms?: boolean; retirement?: boolean } = {};
let premium: AftertaxPremiumOriginal | undefined;
let cms: HouseholdExpenseOriginal | undefined;
let retirement: RetirementRawSource | undefined;

export function installHealthAndRetirement(): void {
  registerAftertaxPremiumSourcePort({ publisherId: premiumPublisher, readOriginal(ref, event) {
    return observe("premium", !healthFault.premium && sameObservation(event) &&
      ref.sourceId === premium?.original.witness.original.sourceId ? premium : undefined);
  } });
  registerHouseholdExpenseOriginalProvider({ family: "medicare", publisherId: cmsPublisher, readOriginal(ref, event) {
    return observe("cmsExpense", !healthFault.cms && sameObservation(event) &&
      ref.sourceId === cms?.witness.original.sourceId ? cms : undefined);
  } });
  registerRetirementRawSourcePort({ read(ref) {
    return observe("retirement", !healthFault.retirement && ref.sourceId === retirement?.sourceId ? retirement : undefined);
  } });
}

function expenseOriginal(details: {
  readonly ref: HouseholdExpenseSourceRef;
  readonly expenseId: string;
  readonly recurrence: string;
  readonly effectiveAt: string;
  readonly period: ReturnType<typeof utcMonthlyPeriods>[number];
  readonly payer: typeof ids.alice;
  readonly recipient: string;
  readonly payable: DomainId<"liability">;
  readonly amount: string;
  readonly trace: readonly string[];
}): HouseholdExpenseOriginal {
  const { ref, expenseId, recurrence, effectiveAt, period, payer, recipient, payable, amount, trace } = details;
  const at = instant(`${effectiveAt}T00:00:00.000Z`);
  const claimId = `obligation:recognition:expense:${expenseId}:${at}`;
  const event = bankEvent(payer, `settlement:${claimId}`, at, "debit");
  const traceRefs = freezeTraceRefs(trace.map(value => calculationTraceRef(calculationTraceId(value))))!;
  const tx = (id: string, type: string, legs: AccountingLegDraft[]) => createAccountingTransaction({
    id: accountingTransactionId(id), date: at, type, traceRefs, legs: legs.map(l => createAccountingLeg({ ...l, traceRefs })),
  });
  return { version: "household-expense-original/v1", context: event, checkedAt: seenAt, completeThrough: seenAt, completeness: "complete",
    expenseId, claimId, period, occurrenceId: generatedOccurrenceKey({ scenarioId: context(1).scenarioId, scheduledAt: at,
      primitiveInstanceId: domainId("primitive-instance", recurrence), semanticEffectType: "expense-recognition",
      economicTargetId: domainId("expense", expenseId) }),
    witness: { original: ref.original, source: { kind: "organization", id: recipient }, payer: { kind: "person", id: payer }, beneficiary: payer },
    recognition: tx(`tx:recognition:recognition:expense:${expenseId}:${at}`, "expense_recognition", [
      { type: "expense", posting: "debit", amount: money(amount) },
      { type: "liability", posting: "credit", amount: money(amount), entityId: payable }]),
    settlement: tx(`tx:${event.eventId}`, "expense_settlement", [
      { type: "liability", posting: "debit", entityId: payable, amount: money(amount) },
      { type: "cash", posting: "credit", accountId: ids.bank, amount: money(amount), cashFlowClass: "operating" }]),
  };
}

const trace = (id: string, phase: string) => `vs2:expense:${id}:${phase}`;
const traceStart = (id: string) => ["base", "inflation-assumption", "inflation-index:0"].map(phase => trace(id, phase));
const traceEnd = (id: string) => ["inflation-linked", "recurrence"].map(phase => trace(id, phase));

export function publishPremium(overlap = false) {
  const transplant = <T>(value: T): T => mapDocument(value, field => field
    .replaceAll(premiumIds.household, ids.household).replaceAll(premiumIds.other, ids.bob)
    .replaceAll(premiumIds.bank, ids.bank).replace(/^2026-02-/, "2026-01-")
    .replace(/^2026-03-01$/, "2026-02-01")
    .replaceAll("elected-coverage", overlap ? "elected-coverage" : "independent-aftertax")
    .replaceAll("health-plan", overlap ? "plan:elected-coverage" : "individual-health-plan"));
  const request = transplant(premiumRequest());
  const proposal = proposePremiums(request).proposals[0]!;
  const confirmation = { ...transplant(premiumConfirmation()), proposal };
  const raw = { version: "1", publishedAt: instant("2026-01-01T12:00:00.000Z"), knownAt: instant("2026-01-01T13:00:00.000Z"),
    request, confirmation };
  const ref: HouseholdExpenseSourceRef = { version: "household-expense-source/v1", bank: bank("premiumBank"),
    beneficiary: ids.bob, original: { version: "household-economic-original/v1", family: "health_premium", publisherId: premiumPublisher,
      sourceId: "coverage:single", revisionId: "1", digest: aftertaxPremiumOriginalDigest(raw) } };
  const p = proposal, b = confirmation;
  const premiumTrace = `d2:aftertax-premium:${canonicalSerialize([p.householdId, p.payerId, p.coverageId, p.planId, p.quoteId, p.effectiveAt, p.source, p.memberIds])}`;
  premium = { ...raw, original: expenseOriginal({ ref, expenseId: b.expenseId, recurrence: b.primitiveIds.recurrence,
    effectiveAt: p.effectiveAt, period: utcMonthlyPeriods(start, 1)[0]!, payer: ids.bob, recipient: p.recipientId,
    payable: b.payable.liabilityId, amount: "300.37",
    trace: [...traceStart(b.expenseId), ...new Set([premiumTrace, ...p.traceRefs, b.bank.evidence.ruleSnapshotId,
      b.payable.evidence.ruleSnapshotId].sort()), ...traceEnd(b.expenseId)] }) };
  return { request, confirmed: [{ ...confirmation, householdExpenseSource: ref }], original: premium.original };
}

const sourceSet = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sourceSet).sort((a, b) => canonicalSerialize(a).localeCompare(canonicalSerialize(b)));
  if (value && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sourceSet(item)]));
  return value;
};

export function publishStandaloneMedicare() {
  const transplant = <T>(value: T): T => mapDocument(value, field => field.replaceAll(household, ids.household)
    .replaceAll(person(), ids.alice).replaceAll(cmsAccount(), ids.bank));
  const seed = medicareRequest("2025-12", ["part_d"]);
  const request = transplant(seed), part = transplant(medicareConfirmations(seed)[0]!);
  const ref: HouseholdExpenseSourceRef = { version: "household-expense-source/v1", bank: bank("cmsBank"),
    beneficiary: ids.alice, original: { version: "household-economic-original/v1", family: "medicare", publisherId: cmsPublisher,
      sourceId: "standalone-part-d-december", revisionId: "1", digest: "december-CMS-synthetic-v1" } };
  const confirmed = { ...part, householdExpenseSource: ref };
  const { obligation: o, expenseId, payable } = confirmed;
  const bindingTrace = `d2:medicare-bank-binding:sha256:${sha256(canonicalSerialize(sourceSet(confirmed)))}`;
  cms = expenseOriginal({ ref, expenseId, recurrence: part.primitiveIds.recurrence, effectiveAt: o.effectiveAt,
    period: utcMonthlyPeriods(openingMonth, 1)[0]!, payer: ids.alice, recipient: `CMS:${o.recipientId}`,
    payable: payable.liabilityId, amount: "120",
    trace: [...traceStart(expenseId), ...new Set([`d2:medicare-bank-key:${o.claimId}`, bindingTrace, ...o.traceRefs,
      o.claimId, part.bank.evidence.ruleSnapshotId, payable.evidence.ruleSnapshotId].sort()), ...traceEnd(expenseId)] });
  return { request, confirmed: [confirmed], original: cms };
}

export function publishRetirement(bankCashBefore: bigint, horizon: { start: typeof start; end: typeof start }) {
  const c = context(1);
  const raw = mapDocument(retirementOriginal(true, "2026-01"), field => field.replaceAll(retirementIds.household, ids.household)
    .replaceAll(retirementIds.person, ids.alice).replaceAll(retirementIds.bank, ids.bank)
    .replaceAll("2026-01-15", "2026-01-17"));
  const cash = { ...raw.cash, householdBank: bank("retirementBank"), confirmations: raw.cash.confirmations.map(row => ({
    ...row, bankCashBefore: money(cents(bankCashBefore)), runId: c.runId,
  })) };
  retirement = { ...raw, cash };
  const fundedRmd = { sourceId: raw.sourceId, sourceVersion: raw.sourceVersion,
    contentDigest: retirementRawSourceDigest(retirement), horizon };
  return { ...cash, fundedRmd };
}

export function resetHealthFaults() {
  delete healthFault.premium;
  delete healthFault.cms;
  delete healthFault.retirement;
}
