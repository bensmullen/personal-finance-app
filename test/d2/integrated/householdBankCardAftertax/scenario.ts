import { accountingTransactionId, createAccountingLeg, createAccountingTransaction, type AccountingLegDraft } from "../../../../src/accounting/index.js";
import { domainId, generatedOccurrenceKey } from "../../../../src/identity/index.js";
import { calculationTraceId, calculationTraceRef, freezeTraceRefs } from "../../../../src/lineage/index.js";
import { createAuthoritativeState, type HouseholdBankEventContext } from "../../../../src/state/index.js";
import { civilDate, instant, utcMonthlyPeriods } from "../../../../src/time/index.js";
import { money, USD } from "../../../../src/values/index.js";
import { attachCardBank, registerCardBankSourcePort, type CardBankDocument } from "../../../../src/simulation/d2/integration/cardBank/index.js";
import { aftertaxPremiumOriginalDigest, attachAftertaxPremiums, registerAftertaxPremiumSourcePort,
  type AftertaxPremiumOriginal, type ConfirmedPremium } from "../../../../src/simulation/d2/integration/aftertaxPremiums/index.js";
import { registerHouseholdBankOriginalProvider, type HouseholdBankOriginalInventory } from "../../../../src/simulation/d2/integration/householdBank/index.js";
import type { HouseholdExpenseSourceRef } from "../../../../src/simulation/d2/integration/householdBank/expenses.js";
import { proposePremiums, type PremiumRequest, type PremiumSource } from "../../../../src/simulation/d2/health/premiums/index.js";
import { compileHouseholdKernel } from "../../../../src/simulation/householdExecution.js";
import { createPrimitiveRuntimeStateStore } from "../../../../src/simulation/period.js";
import { canonicalSerialize, createRunContext, runId, scenarioId } from "../../../../src/simulation/run.js";
import { document, ids, sourceId, opening as cardOpening } from "../cardBank/scenario.js";
export { ids, sourceId };
const uuid = (n: number) => `28000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const payable = domainId("liability", uuid(1));
export const control: { card?: (d: CardBankDocument) => CardBankDocument | undefined;
  premium?: (d: AftertaxPremiumOriginal) => AftertaxPremiumOriginal | undefined;
  bank?: (d: HouseholdBankOriginalInventory) => HouseholdBankOriginalInventory | undefined;
  premiumReads: number; bankReads: number; legacy: boolean } = { premiumReads: 0, bankReads: 0, legacy: false };
export const reset = () => { delete control.card; delete control.premium; delete control.bank;
  control.premiumReads = 0; control.bankReads = 0; control.legacy = false; };
export const context = (months = 2) => createRunContext({ runId: runId("203a0000-0000-4000-8000-000000000006"),
  scenarioId: scenarioId("203a0000-0000-4000-8000-000000000007"), asOf: instant("2026-03-02T00:00:00.000Z"),
  dataCutoff: instant("2026-03-02T00:00:00.000Z"), simulationStart: instant("2026-01-01T00:00:00.000Z"),
  simulationEnd: utcMonthlyPeriods(instant("2026-01-01T00:00:00.000Z"), months).at(-1)!.end, baseCurrency: USD });
export const cardDocument = (): CardBankDocument => ({ ...document(), ...(control.legacy ? {} : {
  householdBank: { runId: context().runId, bank: { publisherId: "stage-e-bank", sourceId: "shared" } },
  payment: { ...document().payment, bankCashBefore: money("1000") },
}) });
const monthStart = (n: number) => utcMonthlyPeriods(instant("2026-02-01T00:00:00.000Z"), n + 1)[n]!;
const premiumSource = (): PremiumSource => ({ start: civilDate("2026-01-01"), endExclusive: civilDate("2030-01-01"),
  asOf: civilDate("2026-01-01"), ruleSnapshotId: "elected-health-plan", jurisdiction: "US", ruleFamily: "premium_quote",
  sourcePublication: "Synthetic elected coverage original", version: "1", projectionStatus: "verified" });
export function request(n = 0): PremiumRequest {
  const period = monthStart(n), start = civilDate(period.start.slice(0, 10)), endExclusive = civilDate(period.end.slice(0, 10));
  return { householdId: ids.household, memberIds: [ids.other], period: { start, endExclusive }, coordination: [], coverages: [{
    id: "elected-coverage", householdId: ids.household, memberIds: [ids.other], planId: "health-plan", planFamily: "health_insurance",
    sponsorId: "employer", recipientId: "insurer", start, endExclusive,
    route: { kind: "aftertax_bank", payerId: ids.other, sourceAccountId: ids.bank, evidence: premiumSource() },
    eligibility: [{ memberId: ids.other, householdId: ids.household, planId: "health-plan", eligible: true, evidence: premiumSource() }],
    quote: { quoteId: `elected-quote:${n}`, gross: money("400.37"), employer: money("100"), member: money("300.37"), source: premiumSource(),
      schedule: { anchor: civilDate(`${period.start.slice(0, 7)}-20`), frequency: "monthly", interval: 1, invalidDay: "skip", amountBasis: "per_occurrence_no_proration" } },
  }] };
}
export function confirmation(n = 0): Omit<ConfirmedPremium, "householdExpenseSource"> {
  return { proposal: proposePremiums(request(n)).proposals[0]!, expenseId: domainId("expense", uuid(10 + n * 4)),
    primitiveIds: { indexGrowth: domainId("primitive-instance", uuid(11 + n * 4)), inflationLink: domainId("primitive-instance", uuid(12 + n * 4)),
      recurrence: domainId("primitive-instance", uuid(13 + n * 4)) }, settlementPriority: n,
    bank: { accountId: ids.bank, householdId: ids.household, payerId: ids.other, classification: "BANK", evidence: premiumSource() },
    payable: { liabilityId: payable, householdId: ids.household, payerId: ids.other, coverageId: "elected-coverage", evidence: premiumSource() } };
}
const raw = (n: number) => ({ version: "1", publishedAt: instant("2026-01-01T12:00:00.000Z"),
  knownAt: instant("2026-01-01T13:00:00.000Z"), request: request(n), confirmation: confirmation(n) });
export const source = (n = 0): HouseholdExpenseSourceRef => ({ version: "household-expense-source/v1",
  bank: { publisherId: "stage-e-bank", sourceId: "shared" }, beneficiary: ids.other,
  original: { version: "household-economic-original/v1", family: "health_premium", publisherId: "stage-e-coverage",
    sourceId: `premium:${n}`, revisionId: "1", digest: aftertaxPremiumOriginalDigest(raw(n)) } });
/** Publisher reconstructs from its own raw elected plan and physical IDs. */
export function premiumOriginal(n = 0): AftertaxPremiumOriginal {
  const d = raw(n), b = d.confirmation, p = b.proposal, at = instant(`${p.effectiveAt}T00:00:00.000Z`), c = context();
  const claimId = `obligation:recognition:expense:${b.expenseId}:${at}`, eventId = `settlement:${claimId}`;
  const premiumTrace = `d2:aftertax-premium:${canonicalSerialize([p.householdId, p.payerId, p.coverageId, p.planId, p.quoteId, p.effectiveAt, p.source, p.memberIds])}`;
  const traces = freezeTraceRefs([premiumTrace, ...p.traceRefs, b.bank.evidence.ruleSnapshotId, b.payable.evidence.ruleSnapshotId,
    ...["base", "inflation-assumption", "inflation-index:0", "inflation-linked", "recurrence"].map(s => `vs2:expense:${b.expenseId}:${s}`)]
    .map(s => calculationTraceRef(calculationTraceId(s))))!;
  const tx = (id: string, type: string, legs: AccountingLegDraft[]) => createAccountingTransaction({ id: accountingTransactionId(id),
    date: at, type, traceRefs: traces, legs: legs.map(l => createAccountingLeg({ ...l, traceRefs: traces })) });
  const eventContext: HouseholdBankEventContext = { runId: c.runId, asOf: c.asOf, dataCutoff: c.dataCutoff,
    householdId: ids.household, personId: ids.other, bankAccountId: ids.bank, direction: "debit", eventId, eventAt: at };
  return { ...d, original: { version: "household-expense-original/v1", context: eventContext, checkedAt: c.asOf, completeThrough: c.dataCutoff,
    completeness: "complete", expenseId: b.expenseId, claimId, period: monthStart(n),
    occurrenceId: generatedOccurrenceKey({ scenarioId: c.scenarioId, primitiveInstanceId: b.primitiveIds.recurrence,
      scheduledAt: at, semanticEffectType: "expense-recognition", economicTargetId: b.expenseId }),
    witness: { original: source(n).original, source: { kind: "organization", id: "insurer" }, payer: { kind: "person", id: ids.other }, beneficiary: ids.other },
    recognition: tx(`tx:recognition:recognition:expense:${b.expenseId}:${at}`, "expense_recognition", [
      { type: "expense", posting: "debit", amount: p.memberAmount }, { type: "liability", posting: "credit", amount: p.memberAmount, entityId: payable }]),
    settlement: tx(`tx:${eventId}`, "expense_settlement", [
      { type: "liability", posting: "debit", amount: p.memberAmount, entityId: payable },
      { type: "cash", posting: "credit", amount: p.memberAmount, accountId: ids.bank, cashFlowClass: "operating" }]),
  } };
}
export function install(): void {
  registerCardBankSourcePort({ householdPublisherId: "stage-e-issuer", read: id => id === sourceId
    ? control.card ? control.card(cardDocument()) : cardDocument() : undefined });
  registerAftertaxPremiumSourcePort({ publisherId: "stage-e-coverage", readOriginal: ref => {
    control.premiumReads++;
    if (!/^premium:\d+$/.test(ref.sourceId)) return undefined;
    const d = premiumOriginal(Number(ref.sourceId.split(":")[1]));
    return control.premium ? control.premium(d) : d;
  } });
  registerHouseholdBankOriginalProvider({ publisherId: "stage-e-bank", readOriginals: query => {
    control.bankReads++;
    const c = context(), personId = query.context.personId;
    if (query.sourceId !== "shared" || ![ids.person, ids.other].includes(personId) || query.context.runId !== c.runId) return undefined;
    const base = { revisionId: "1", publishedAt: instant("2026-01-01T00:00:00.000Z"), knownAt: instant("2026-01-01T00:00:00.000Z"),
      effectiveFrom: instant("2026-01-01T00:00:00.000Z"), effectiveUntil: instant("2030-01-01T00:00:00.000Z"), status: "active" as const };
    const value: HouseholdBankOriginalInventory = { version: "household-bank-original-inventory/v1", publisherId: "stage-e-bank", query,
      checkedAt: c.asOf, completeThrough: c.dataCutoff, completeness: "complete", originals: [
        { ...base, kind: "account", sourceId: "deed", bankAccountId: ids.bank, owner: { kind: "household", id: ids.household }, accountKind: "checking" },
        { ...base, kind: "household", sourceId: "household", householdId: ids.household },
        { ...base, kind: "membership", sourceId: `member:${personId}`, householdId: ids.household, personId },
        { ...base, kind: "permission", sourceId: `permission:${personId}`, householdId: ids.household, personId, bankAccountId: ids.bank, direction: "debit" },
      ] };
    return control.bank ? control.bank(value) : value;
  } });
}
export function opening(cash = "1000") {
  const s = cardOpening(cash);
  s.accounts[ids.bank] = { ...s.accounts[ids.bank]!, ownerId: ids.household };
  s.liabilities[payable] = { id: payable, balance: money("0") };
  return s;
}
export function fixture(options: { card?: boolean; premium?: boolean; months?: number; cash?: string } = {}) {
  const months = options.months ?? 2, state = opening(options.cash), c = context(months);
  let kernel = compileHouseholdKernel({ reconciledOpeningState: state, reconciledPrimitiveState: createPrimitiveRuntimeStateStore(),
    scenarioIdentity: c.scenarioId, executionMonths: months, scenarioBindings: {},
    cashFlowInput: { householdId: ids.household, ownerId: ids.other, cashAccountId: ids.bank, expensePayableLiabilityId: payable,
      baseCurrency: USD, incomes: [], expenses: [], events: [] },
  }, c.simulationStart);
  const admissions = [];
  if (options.premium !== false) for (let n = 0; n < months - 1; n++) {
    const attached = attachAftertaxPremiums({ kernel, request: request(n), asOf: civilDate(c.asOf.slice(0, 10)), runContext: c,
      confirmed: [{ ...confirmation(n), householdExpenseSource: source(n) }], representations: [] });
    admissions.push(attached); kernel = attached.kernel;
  }
  if (options.card !== false) kernel = attachCardBank(kernel, { sourceIds: [sourceId] });
  return { kernel, context: c, state, admissions };
}
