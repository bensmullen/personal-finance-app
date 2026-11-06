import { beforeEach, describe, expect, it } from "vitest";
import { accountingTransactionId, createAccountingLeg, createAccountingTransaction } from "../../../../src/accounting/index.js";
import { domainId, generatedOccurrenceKey } from "../../../../src/identity/index.js";
import { calculationTraceId, calculationTraceRef } from "../../../../src/lineage/index.js";
import { createAuthoritativeState, registerHouseholdEconomicOriginalAuthority, type HouseholdBankEventContext,
  type NativeHouseholdPostingAttachment } from "../../../../src/state/index.js";
import { attachSsaMedicare, createSsaMedicareParticipant, type ConfirmedSsaMedicarePayment } from "../../../../src/simulation/d2/integration/ssaMedicare/index.js";
import { registerHouseholdBankOriginalProvider, qualifyHouseholdBankRoute } from "../../../../src/simulation/d2/integration/householdBank/index.js";
import { compileHouseholdKernel, runHouseholdKernel } from "../../../../src/simulation/householdExecution.js";
import { householdWageOriginalDigest, registerHouseholdWageOriginalProvider, type HouseholdWageOriginal } from "../../../../src/simulation/d2/integration/householdWages/index.js";
import type { RecurringIncomeStream, VerticalSlice2Input } from "../../../../src/simulation/verticalSlice2.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { instant } from "../../../../src/time/index.js";
import { money, Rate, rateConvention, USD } from "../../../../src/values/index.js";
import { fixture, ids, input } from "../ssaMedicare/scenario.js";
import { originalPayment, register, resetSources, control } from "../ssaMedicare/originalScenario.js";

register();
const observed = fixture().context;
const known = instant("2025-12-01T00:00:00.000Z");
let missing = false;
const journal = () => {
  const q = originalPayment();
  return createAccountingTransaction({ id: accountingTransactionId(`ssa-medicare:${q.payable.paymentId}`), date: q.payable.paymentAt,
    type: "ssa_medicare_same_event", legs: [
      createAccountingLeg({ type: "cash", posting: "debit", amount: money("1300"), accountId: ids.bank, cashFlowClass: "operating" }),
      createAccountingLeg({ type: "expense", posting: "debit", amount: money("200") }),
      createAccountingLeg({ type: "income", posting: "credit", amount: money("1500") })] });
};
const event = (): HouseholdBankEventContext => ({ runId: observed.runId, asOf: observed.asOf, dataCutoff: observed.dataCutoff,
  eventId: "independent-ssa-installment:2026-06", eventAt: originalPayment().payable.paymentAt,
  householdId: domainId("household", ids.household), personId: domainId("person", ids.person), bankAccountId: ids.bank, direction: "credit" });
registerHouseholdBankOriginalProvider({ publisherId: "ssa-household-bank", readOriginals: query => {
  const base = { revisionId: "1", publishedAt: known, knownAt: known, effectiveFrom: known,
    effectiveUntil: instant("2028-01-01T00:00:00.000Z"), status: "active" as const };
  if (query.context.personId !== ids.person || query.context.householdId !== ids.household || query.context.bankAccountId !== ids.bank) return undefined;
  return { version: "household-bank-original-inventory/v1", publisherId: "ssa-household-bank", query,
    checkedAt: query.context.asOf, completeThrough: query.context.dataCutoff, completeness: "complete", originals: [
      { ...base, kind: "account", sourceId: "deed", bankAccountId: ids.bank, owner: { kind: "household", id: ids.household }, accountKind: "checking" },
      { ...base, kind: "household", sourceId: "hh", householdId: ids.household },
      { ...base, kind: "membership", sourceId: "member", householdId: ids.household, personId: domainId("person", ids.person) },
      { ...base, kind: "permission", sourceId: "permission", householdId: ids.household, personId: domainId("person", ids.person), bankAccountId: ids.bank, direction: "credit" }] };
} });
const witnesses = () => (["ssa", "medicare"] as const).map(family => ({ original: { version: "household-economic-original/v1" as const,
  family, publisherId: "ssa-household-originals", sourceId: `independent:${family}:2026-06`, revisionId: "1", digest: `synthetic-original:${family}` },
  source: { kind: "organization" as const, id: family === "ssa" ? "SSA" : "CMS" },
  payer: { kind: "organization" as const, id: "SSA" }, beneficiary: domainId("person", ids.person) }));
for (const family of ["ssa", "medicare"] as const) registerHouseholdEconomicOriginalAuthority(family, "ssa-household-originals", {
  qualify: (ref, context) => {
    const witness = witnesses().find(w => w.original.family === family)!;
    if (missing || canonicalSerialize(ref) !== canonicalSerialize(witness.original) || canonicalSerialize(context) !== canonicalSerialize(event())) return undefined;
    return { witness, context: event(), transaction: journal(), requiredFamilies: ["ssa", "medicare"] };
  },
});
const payment = (): ConfirmedSsaMedicarePayment => {
  const nativeHousehold: NativeHouseholdPostingAttachment = { version: "native-household-posting/v1", family: "ssa", cashRole: "bank",
    transactionId: journal().id, context: event(), route: qualifyHouseholdBankRoute("ssa-household-bank", "shared-bank", event()), originals: witnesses() };
  return { ...originalPayment(), nativeHousehold };
};
const wage: RecurringIncomeStream = { id: domainId("income", "27700000-0000-4000-8000-000000000100"), ownerId: domainId("person", ids.person),
  depositAccountId: ids.bank, baseMonthlyAmount: money("100"), start: observed.simulationStart,
  recurrence: { kind: "utc_monthly", anchor: instant("2026-06-20T00:00:00.000Z"), invalidDayPolicy: "skip" },
  growthBaseAt: observed.simulationStart, growthRate: Rate.fromDecimal("0", rateConvention.effectiveAnnual()),
  primitiveIds: { growth: domainId("primitive-instance", "27700000-0000-4000-8000-000000000101"),
    recurrence: domainId("primitive-instance", "27700000-0000-4000-8000-000000000102") } };
function wageOriginal(): HouseholdWageOriginal {
  const at = wage.recurrence.anchor;
  const traceRefs = ["base", "salary-growth-assumption", "growth:0", "recurrence"]
    .map(label => calculationTraceRef(calculationTraceId(`vs2:income:${wage.id}:${label}`)));
  return { stream: wage, sourceId: "employer-wage", revisionId: "1", publishedAt: known, knownAt: known, effectiveFrom: known,
    effectiveUntil: instant("2027-01-01T00:00:00.000Z"), status: "active", employerId: "independent-employer",
    householdId: ids.household, personId: ids.person, bankAccountId: ids.bank, incomeId: wage.id, gross: money("100"),
    period: { start: observed.simulationStart, end: observed.simulationEnd }, occurrenceId: generatedOccurrenceKey({ scenarioId: observed.scenarioId,
      primitiveInstanceId: wage.primitiveIds.recurrence, scheduledAt: at, semanticEffectType: "income-recognition", economicTargetId: wage.id }),
    transaction: createAccountingTransaction({ id: accountingTransactionId(`tx:recognition:income:${wage.id}:${at}`), date: at, type: "income", traceRefs,
      legs: [createAccountingLeg({ type: "cash", posting: "debit", amount: money("100"), accountId: ids.bank, cashFlowClass: "operating", traceRefs }),
        createAccountingLeg({ type: "income", posting: "credit", amount: money("100"), traceRefs })] }) };
}
registerHouseholdWageOriginalProvider({ publisherId: "ssa-distinct-employer", readOriginals: query => query.sourceId !== "employer-wage" ? undefined : {
  version: "household-wage-inventory/v1", publisherId: "ssa-distinct-employer", sourceId: query.sourceId, context: query.context,
  checkedAt: query.context.asOf, completeThrough: query.context.dataCutoff, completeness: "complete", originals: [wageOriginal()] } });
const qualifiedWage = (): RecurringIncomeStream => ({ ...wage, householdWageSource: { version: "household-wage-source/v1",
  bank: { publisherId: "ssa-household-bank", sourceId: "shared-bank" }, original: { version: "household-economic-original/v1", family: "wage",
    publisherId: "ssa-distinct-employer", sourceId: "employer-wage", revisionId: "1", digest: householdWageOriginalDigest(wageOriginal()) } } });
const withWages = (incomes: readonly RecurringIncomeStream[]) => {
  const state = createAuthoritativeState({ accounts: { [ids.bank]: { id: ids.bank, kind: "checking", ownerId: ids.household, cash: money("2000") } },
    liabilities: { [domainId("liability", "27700000-0000-4000-8000-000000000103")]: { id: domainId("liability", "27700000-0000-4000-8000-000000000103"), balance: money("0") } } });
  const cashFlowInput: VerticalSlice2Input = { householdId: domainId("household", ids.household), ownerId: domainId("person", ids.person),
    cashAccountId: ids.bank, expensePayableLiabilityId: domainId("liability", "27700000-0000-4000-8000-000000000103"),
    baseCurrency: USD, incomes, expenses: [], events: [] };
  return compileHouseholdKernel({ reconciledOpeningState: state, reconciledPrimitiveState: {}, scenarioIdentity: observed.scenarioId,
    executionMonths: 1, scenarioBindings: {}, cashFlowInput }, observed.simulationStart);
};
const execute = (q = payment()) => {
  const state = createAuthoritativeState({ accounts: { [ids.bank]: { id: ids.bank, kind: "checking", ownerId: ids.household, cash: money("2000") } } });
  const f = fixture(1, state);
  return runHouseholdKernel({ kernel: attachSsaMedicare(f.kernel, input([q])), runContext: f.context, resultTier: "detail" });
};
beforeEach(() => { missing = false; resetSources(); });
describe("actual household SSA participant", () => {
  it("fails closed on same-instant BANK contention without an explicit dependency", () => {
    const q = payment(), participant = createSsaMedicareParticipant(input([q]));
    const state = createAuthoritativeState({ accounts: { [ids.bank]: { id: ids.bank, kind: "checking", ownerId: ids.household, cash: money("2000") } } });
    expect(() => participant.prepare(observed, { start: observed.simulationStart, end: observed.simulationEnd }, { state, primitiveState: {} }, [{
      id: "competing-bank-work", domain: "cash_flow", operationClass: "cash_flow:income", sequencingInstant: q.payable.paymentAt,
      dependsOn: [], resourceAccesses: [{ kind: "account_cash", accountId: ids.bank, mode: "produce" }], traceRefs: [],
    }])).toThrow("Same-instant BANK work");
    expect(state.accounts[ids.bank]!.cash.equals(money("2000"))).toBe(true);
    expect(state.d2PostedTransactions).toBeUndefined();
  });
  it("posts independently authenticated wages and SSA to the same actual BANK", () => {
    const kernel = attachSsaMedicare(withWages([qualifiedWage()]), input([payment()]));
    const result = runHouseholdKernel({ kernel, runContext: observed, resultTier: "detail" });
    expect(result.periods, JSON.stringify(result.diagnostics)).toHaveLength(1);
    expect(result.state.accounts[ids.bank]!.cash.equals(money("3400"))).toBe(true);
    expect(Object.values(result.state.d2PostedTransactions!)).toHaveLength(2);
    expect(result.periods[0]!.transactions).toEqual([journal(), wageOriginal().transaction]);
  });
  it("rejects generic and duplicated overlapping wage representations", () => {
    expect(() => attachSsaMedicare(withWages([wage]), input([payment()]))).toThrow("Overlapping generic income");
    expect(() => attachSsaMedicare(withWages([qualifiedWage(), qualifiedWage()]), input([payment()]))).toThrow();
  });
  it("uses native v3, gross recognition, premium expense and one canonical net deposit", () => {
    const result = execute();
    expect(result.periods, JSON.stringify(result.diagnostics)).toHaveLength(1);
    expect(result.state.accounts[ids.bank]!.cash.equals(money("3300"))).toBe(true);
    expect(result.periods[0]!.transactions).toEqual([journal()]);
    expect(Object.values(result.state.ssaMedicarePayments!)[0]!.version).toBe("ssa-medicare-payment/v3");
    expect(Object.values(result.state.d2PostedTransactions!)).toHaveLength(1);
    expect(Object.values(result.state.obligations)).toHaveLength(3);
  });
  it("rejects missing native originals and true-run mismatches", () => {
    const q = payment();
    missing = true;
    expect(execute(q).periods).toHaveLength(0);
    missing = false;
    const wrong = { ...q, nativeHousehold: { ...q.nativeHousehold!, context: { ...q.nativeHousehold!.context, runId: "invented-run" } } };
    expect(execute(wrong).periods).toHaveLength(0);
  });
  it("keeps independent A1/C2 source admission mandatory", () => {
    const q = payment();
    control.missing = true;
    expect(() => execute(q)).toThrow();
  });
});
