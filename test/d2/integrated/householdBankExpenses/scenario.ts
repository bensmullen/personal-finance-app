import { accountingTransactionId, createAccountingLeg, createAccountingTransaction, type AccountingLegDraft } from "../../../../src/accounting/index.js";
import { createFundingPolicy, fundingPolicyId } from "../../../../src/funding/index.js";
import { domainId, generatedOccurrenceKey } from "../../../../src/identity/index.js";
import { calculationTraceId, calculationTraceRef, freezeTraceRefs } from "../../../../src/lineage/index.js";
import { createAuthoritativeState } from "../../../../src/state/index.js";
import { createRunContext, runId, scenarioId } from "../../../../src/simulation/run.js";
import { registerHouseholdBankOriginalProvider, type HouseholdBankOriginalInventory } from "../../../../src/simulation/d2/integration/householdBank/index.js";
import { registerHouseholdExpenseOriginalProvider, type HouseholdExpenseOriginal, type HouseholdExpenseSourceRef } from "../../../../src/simulation/d2/integration/householdBank/expenses.js";
import { instant, utcCalendarMonthDifference, utcMonthlyPeriods, type Instant } from "../../../../src/time/index.js";
import { money, Rate, rateConvention, USD } from "../../../../src/values/index.js";
import type { RecurringExpenseStream, VerticalSlice2Input } from "../../../../src/simulation/verticalSlice2.js";

const uuid = (n: number) => `28600000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const ids = { household: domainId("household", uuid(1)), alice: domainId("person", uuid(2)),
  bob: domainId("person", uuid(3)), bank: domainId("account", uuid(4)), payable: domainId("liability", uuid(5)) };
export const start = instant("2026-01-01T00:00:00.000Z");
const cutoff = instant("2025-12-01T00:00:00.000Z");
export const context = (months = 1) => createRunContext({ runId: runId(uuid(6)), scenarioId: scenarioId(uuid(7)),
  asOf: cutoff, dataCutoff: cutoff, simulationStart: start, simulationEnd: utcMonthlyPeriods(start, months).at(-1)!.end, baseCurrency: USD });
export const source = (n = 0): HouseholdExpenseSourceRef => ({ version: "household-expense-source/v1",
  bank: { publisherId: "expense-bank", sourceId: "shared-bank" }, beneficiary: n === 0 ? ids.alice : ids.bob,
  original: { version: "household-economic-original/v1", family: "education", publisherId: "synthetic-expense-archive",
    sourceId: `independent-obligation:${n}`, revisionId: "revision/1", digest: `synthetic-contract:${n}` } });
// Synthetic generic obligations, deliberately not fabricated medical originals.
export const stream = (n = 0, day = n === 0 ? "15" : "20"): RecurringExpenseStream => ({
  id: domainId("expense", uuid(10 + n)), ownerId: n === 0 ? ids.alice : ids.bob,
  paymentAccountId: ids.bank, payableLiabilityId: ids.payable, baseMonthlyAmount: money("25.37"), start,
  recurrence: { kind: "utc_monthly", anchor: instant(`2026-01-${day}T00:00:00.000Z`), invalidDayPolicy: "skip" },
  inflationBaseAt: instant(`2026-01-${day}T00:00:00.000Z`), inflationRate: Rate.fromDecimal("0", rateConvention.effectiveAnnual()),
  fundingPolicy: createFundingPolicy({ id: fundingPolicyId(`expense-policy:${n}`), orderedSources: [{ kind: "cash_account", accountId: ids.bank }],
    allowPartial: false, insufficientFundsBehavior: "unfunded" }), settlementPriority: n,
  primitiveIds: { indexGrowth: domainId("primitive-instance", uuid(20 + n * 3)), inflationLink: domainId("primitive-instance", uuid(21 + n * 3)),
    recurrence: domainId("primitive-instance", uuid(22 + n * 3)) }, householdExpenseSource: source(n),
});
export const input = (expenses = [stream()]): VerticalSlice2Input => ({ householdId: ids.household, ownerId: ids.alice,
  cashAccountId: ids.bank, expensePayableLiabilityId: ids.payable, baseCurrency: USD, incomes: [], expenses, events: [] });
export const opening = (cash = "100") => createAuthoritativeState({ accounts: { [ids.bank]: {
  id: ids.bank, ownerId: ids.household, kind: "checking", cash: money(cash) } }, liabilities: { [ids.payable]: { id: ids.payable, balance: money("0") } } });

export const control: { reads: number; bankReads: number; day?: string;
  economic?: (v: HouseholdExpenseOriginal) => HouseholdExpenseOriginal | undefined;
  bank?: (v: HouseholdBankOriginalInventory) => HouseholdBankOriginalInventory | undefined } = { reads: 0, bankReads: 0 };
export function reset(): void { control.reads = 0; control.bankReads = 0; delete control.economic; delete control.bank; delete control.day; }

/** Original archive reconstructs from its own schedule, parties and cents. It
 * receives only an address and event context, never the candidate's journals. */
export function reconstruct(n: number, at: Instant): HouseholdExpenseOriginal {
  const s = stream(n, control.day ?? (n === 0 ? "15" : "20")), c = context();
  const month = utcCalendarMonthDifference(s.inflationBaseAt, at), period = utcMonthlyPeriods(start, month + 1)[month]!;
  const traceRefs = freezeTraceRefs(["base", "inflation-assumption", `inflation-index:${month}`, "inflation-linked", "recurrence"]
    .map(label => calculationTraceRef(calculationTraceId(`vs2:expense:${s.id}:${label}`))))!;
  const occurrenceId = generatedOccurrenceKey({ scenarioId: c.scenarioId, primitiveInstanceId: s.primitiveIds.recurrence,
    scheduledAt: at, semanticEffectType: "expense-recognition", economicTargetId: s.id });
  const claimId = `obligation:recognition:expense:${s.id}:${at}`, eventId = `settlement:${claimId}`;
  const tx = (id: string, type: string, legs: AccountingLegDraft[]) => createAccountingTransaction({ id: accountingTransactionId(id),
    type, date: at, traceRefs, legs: legs.map(leg => createAccountingLeg({ ...leg, traceRefs })) });
  const amount = money("25.37");
  return { version: "household-expense-original/v1", context: { runId: c.runId, asOf: c.asOf, dataCutoff: c.dataCutoff,
    eventAt: at, eventId, householdId: ids.household, personId: n === 0 ? ids.alice : ids.bob, bankAccountId: ids.bank, direction: "debit" },
    checkedAt: cutoff, completeThrough: cutoff, completeness: "complete", expenseId: s.id, occurrenceId, claimId, period,
    witness: { original: source(n).original, source: { kind: "organization", id: "synthetic-service" },
      payer: { kind: "person", id: n === 0 ? ids.alice : ids.bob }, beneficiary: n === 0 ? ids.alice : ids.bob },
    recognition: tx(`tx:recognition:recognition:expense:${s.id}:${at}`, "expense_recognition", [
      { type: "expense", posting: "debit", amount }, { type: "liability", posting: "credit", entityId: ids.payable, amount }]),
    settlement: tx(`tx:${eventId}`, "expense_settlement", [
      { type: "liability", posting: "debit", entityId: ids.payable, amount },
      { type: "cash", posting: "credit", accountId: ids.bank, amount, cashFlowClass: "operating" }]) };
}
export function install(): void {
  registerHouseholdBankOriginalProvider({ publisherId: "expense-bank", readOriginals: query => {
    control.bankReads++;
    const base = { revisionId: "original/1", publishedAt: cutoff, knownAt: cutoff, effectiveFrom: cutoff,
      effectiveUntil: instant("2040-01-01T00:00:00.000Z"), status: "active" as const };
    const personId = query.context.personId;
    if (![ids.alice, ids.bob].includes(personId) || query.sourceId !== "shared-bank") return undefined;
    const value: HouseholdBankOriginalInventory = { version: "household-bank-original-inventory/v1", publisherId: "expense-bank",
      query, checkedAt: cutoff, completeThrough: cutoff, completeness: "complete", originals: [
        { ...base, kind: "account", sourceId: "bank-deed", bankAccountId: ids.bank, owner: { kind: "household", id: ids.household }, accountKind: "checking" },
        { ...base, kind: "household", sourceId: "household", householdId: ids.household },
        { ...base, kind: "membership", sourceId: `member:${personId}`, householdId: ids.household, personId },
        { ...base, kind: "permission", sourceId: `permission:${personId}`, householdId: ids.household, personId, bankAccountId: ids.bank, direction: "debit" }] };
    return control.bank ? control.bank(value) : value;
  } });
  registerHouseholdExpenseOriginalProvider({ family: "education", publisherId: "synthetic-expense-archive", readOriginal: (ref, c) => {
    control.reads++;
    const n = ref.sourceId === "independent-obligation:0" ? 0 : ref.sourceId === "independent-obligation:1" ? 1 : undefined;
    if (n === undefined || c.eventAt.slice(8, 10) !== (control.day ?? (n === 0 ? "15" : "20"))) return undefined;
    const value = reconstruct(n, c.eventAt);
    return control.economic ? control.economic(value) : value;
  } });
}
