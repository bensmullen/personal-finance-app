import { accountingTransactionId, createAccountingLeg, createAccountingTransaction } from "../../../../../src/accounting/index.js";
import { domainId, generatedOccurrenceKey } from "../../../../../src/identity/index.js";
import { calculationTraceId, calculationTraceRef } from "../../../../../src/lineage/index.js";
import { registerHouseholdPayrollHealthProvider, type HouseholdPayrollHealthOriginal } from "../../../../../src/simulation/d2/health/premiums/payrollBinding/index.js";
import { householdWageOriginalDigest, registerHouseholdWageOriginalProvider, type HouseholdWageOriginal } from "../../../../../src/simulation/d2/integration/householdWages/index.js";
import { taxBalanceIds } from "../../../../../src/simulation/tax/participant.js";
import type { RecurringIncomeStream } from "../../../../../src/simulation/verticalSlice2.js";
import { instant, utcMonthlyPeriods } from "../../../../../src/time/index.js";
import { money, Quantity, Rate, rateConvention, Unit } from "../../../../../src/values/index.js";
import { bank as templateBank, coverage, household, payroll, person, scenario } from "../../../health/premiums/payrollBinding/fixtures.js";
import { context as wageContext, document, ids as wageIds } from "../../householdBankIncome/scenario.js";
import { bank, context, ids, revision, sameObservation, seenAt, start } from "./bank.js";
import { mapDocument, observe, testId } from "./sourceMeter.js";

const publisherId = "s8-five-wage-originals";
const healthPublisher = "s8-five-section125-originals";
const noElectionId = "employer-contract:1";
const compositeId = "elected-paycheck";
const first = utcMonthlyPeriods(start, 1)[0]!;
const payday = instant("2026-01-05T17:00:00.000Z");
const incomeId = domainId("income", testId(201));
export const payrollExpense = domainId("expense", testId(202));
export const payrollCredit = taxBalanceIds("US:FEDERAL", "2026").creditPositionId;
const recurrence = domainId("primitive-instance", testId(203));
const wages = new Map<string, HouseholdWageOriginal>();
let health: HouseholdPayrollHealthOriginal | undefined;
export const wageFault: { event?: string; mode?: "missing" | "late" | "employer" | "member" | "duplicate" | "withdrawn" | "health" } = {};

export function installWages(): void {
  registerHouseholdWageOriginalProvider({ publisherId, readOriginals({ sourceId, context: event }) {
    if (!sameObservation(event)) return undefined;
    const wage = wages.get(event.eventAt);
    if (!wage || wage.sourceId !== sourceId) return undefined;
    const fault = wageFault.event === event.eventAt ? wageFault.mode : undefined;
    if (fault === "missing") return undefined;
    const row: HouseholdWageOriginal = fault === "late" ? { ...wage, knownAt: instant("2029-02-01T00:00:00.000Z") }
      : fault === "employer" ? { ...wage, employerId: "different-employer" }
      : fault === "member" ? { ...wage, personId: ids.bob }
      : fault === "withdrawn" ? { ...wage, status: "withdrawn" }
      : wage;
    return observe("wage", { version: "household-wage-inventory/v1", publisherId, sourceId, context: event,
      checkedAt: seenAt, completeThrough: seenAt, completeness: "complete", originals: fault === "duplicate" ? [row, row] : [row] } as const);
  } });
  registerHouseholdPayrollHealthProvider({ publisherId: healthPublisher, readActiveOriginal(query) {
    if (!health || query.sourceId !== health.payroll.source.sourceId || !sameObservation(query.context) || wageFault.mode === "health") return undefined;
    return observe("payrollHealth", { context: query.context, completeThrough: seenAt, original: health });
  } });
}

function electedPaycheck(overlap: boolean): HouseholdWageOriginal {
  const template = coverage(overlap ? "elected-coverage" : "section125", "2026-01-01", "2026-02-01", "2026-01-05");
  const transplant = <T>(value: T): T => mapDocument(value, field => field.replaceAll(household, ids.household)
    .replaceAll(person, ids.alice).replaceAll(templateBank, ids.bank).replaceAll("child", ids.bob));
  const { facts, bases } = transplant(payroll(template, payday));
  const plan = transplant(scenario([template]).request);
  const gross = money("1000");
  const transactionId = accountingTransactionId(`tx:recognition:income:${incomeId}:${payday}`);
  const occurrenceId = generatedOccurrenceKey({ scenarioId: context(1).scenarioId, primitiveInstanceId: recurrence,
    scheduledAt: payday, semanticEffectType: "income-recognition", economicTargetId: incomeId });
  const signed = { ...facts.withholding[0]!.election, incomeId };
  const traces = [
    calculationTraceRef(calculationTraceId(`payroll:${transactionId}:gross:${incomeId}`), []),
    calculationTraceRef(calculationTraceId(`payroll:withholding:${signed.id}:income:${incomeId}:owner:${ids.alice}:employer:${signed.employerId}:occurrence:${occurrenceId}:year:2026:jurisdiction:${signed.jurisdiction}:provenance:${signed.provenance}`)),
  ];
  const stream: RecurringIncomeStream = { id: incomeId, ownerId: ids.alice, depositAccountId: ids.bank,
    baseMonthlyAmount: gross, start, end: first.end, growthBaseAt: payday, growthRate: Rate.fromDecimal("0", rateConvention.effectiveAnnual()),
    payrollWithholding: [signed], payrollTaxCreditAccountId: ids.bank,
    recurrence: { kind: "utc_monthly", anchor: payday, invalidDayPolicy: "skip" },
    primitiveIds: { recurrence, growth: domainId("primitive-instance", testId(204)) } };
  const draft = { id: transactionId, date: payday, type: "payroll_income", traceRefs: traces };
  const taxCredit = createAccountingLeg({ type: "asset", posting: "debit", entityId: payrollCredit,
    amount: money("100"), quantity: Quantity.parse("100", Unit.of("usd_tax_credit")) });
  const cash = (amount: string) => createAccountingLeg({ type: "cash", posting: "debit", accountId: ids.bank, amount: money(amount), cashFlowClass: "operating" });
  const income = createAccountingLeg({ type: "income", posting: "credit", amount: gross });
  const transaction = createAccountingTransaction({ ...draft, legs: [taxCredit,
    createAccountingLeg({ type: "expense", posting: "debit", entityId: payrollExpense, amount: money("200") }),
    cash("700"), income] });
  const source = { ...facts.source, incomeId, transactionId, occurrenceId };
  health = { revisionId: "1", status: "active", expenseId: payrollExpense, premiumRequest: plan, transaction,
    event: { runId: context(1).runId, eventId: transactionId, eventAt: payday, asOf: seenAt, dataCutoff: seenAt },
    legalBases: bases.map(base => ({ ...base, before: gross, after: money("800") })),
    payroll: { ...facts, source, bankOwnerId: ids.household, transaction: createAccountingTransaction({ ...draft, legs: [taxCredit, cash("900"), income] }),
      election: { ...facts.election, incomeId }, contributions: [], withholding: [{ election: signed, amount: money("100") }] } };
  return { ...revision, revisionId: "1", sourceId: compositeId,
    health: { version: "household-payroll-health-source/v1", publisherId: healthPublisher, sourceId: source.sourceId },
    stream, occurrenceId, period: first, gross, transaction, employerId: signed.employerId,
    householdId: ids.household, personId: ids.alice, incomeId, bankAccountId: ids.bank };
}

const scopedStream = (wage: HouseholdWageOriginal): RecurringIncomeStream => ({
  ...wage.stream, householdWageSource: { version: "household-wage-source/v1", bank: bank("wageBank"),
    original: { version: "household-economic-original/v1", family: "wage", publisherId, sourceId: wage.sourceId,
      revisionId: wage.revisionId, digest: householdWageOriginalDigest(wage) },
    ...(wage.health ? { health: wage.health } : {}) },
});

export function publishWages(count: number, overlap = false): readonly RecurringIncomeStream[] {
  wages.clear();
  delete wageFault.mode;
  delete wageFault.event;
  const elected = electedPaycheck(overlap);
  wages.set(payday, elected);
  let regular: HouseholdWageOriginal | undefined;
  for (let index = 0; index < count; index++) {
    const row = mapDocument(document(1, index), field => field.replaceAll(wageIds.household, ids.household)
      .replaceAll(wageIds.bob, ids.alice).replaceAll(wageIds.bank, ids.bank)
      .replaceAll(wageContext().scenarioId, context(1).scenarioId).replaceAll(/(\d{4}-\d{2})-20T/g, "$1-08T"));
    const last = utcMonthlyPeriods(start, count).at(-1)!;
    const wage = { ...row, stream: { ...row.stream, end: last.end }, sourceId: noElectionId };
    regular ??= wage;
    wages.set(wage.transaction.date, wage);
  }
  if (!regular) throw new Error("Expected at least one wage installment");
  return [scopedStream(elected), scopedStream(regular)];
}
