import { accountingTransactionId, createAccountingLeg, createAccountingTransaction } from "../../../../src/accounting/index.js";
import { domainId, generatedOccurrenceKey, type DomainId } from "../../../../src/identity/index.js";
import { calculationTraceId, calculationTraceRef, freezeTraceRefs } from "../../../../src/lineage/index.js";
import { createAuthoritativeState } from "../../../../src/state/index.js";
import { createRunContext, runId, scenarioId } from "../../../../src/simulation/run.js";
import { registerHouseholdBankOriginalProvider } from "../../../../src/simulation/d2/integration/householdBank/index.js";
import { householdWageOriginalDigest, registerHouseholdWageOriginalProvider, type HouseholdWageOriginal,
  type HouseholdWageSourceRef } from "../../../../src/simulation/d2/integration/householdWages/index.js";
import type { RecurringIncomeStream, VerticalSlice2Input } from "../../../../src/simulation/verticalSlice2.js";
import { instant, utcCalendarMonthDifference, utcMonthlyPeriods } from "../../../../src/time/index.js";
import { money, Quantity, Unit, Rate, rateConvention, USD } from "../../../../src/values/index.js";
import { taxBalanceIds } from "../../../../src/simulation/tax/contracts.js";

const uuid = (n: number) => `27700000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const ids = { household: domainId("household", uuid(1)), alice: domainId("person", uuid(2)),
  bob: domainId("person", uuid(3)), bank: domainId("account", uuid(4)), payable: domainId("liability", uuid(5)) };
export const start = instant("2026-01-01T00:00:00.000Z"), cutoff = instant("2025-12-01T00:00:00.000Z");
export const context = (months = 1) => createRunContext({ runId: runId(uuid(6)), scenarioId: scenarioId(uuid(7)),
  asOf: cutoff, dataCutoff: cutoff, simulationStart: start, simulationEnd: utcMonthlyPeriods(start, months).at(-1)!.end, baseCurrency: USD });
export const bareStream = (n = 0): RecurringIncomeStream => ({ id: domainId("income", uuid(10 + n)), ownerId: n === 0 ? ids.alice : ids.bob,
  depositAccountId: ids.bank, baseMonthlyAmount: money("125.37"), start,
  recurrence: { kind: "utc_monthly", anchor: instant(`2026-01-${n === 0 ? "15" : "20"}T00:00:00.000Z`), invalidDayPolicy: "skip" },
  growthBaseAt: instant(`2026-01-${n === 0 ? "15" : "20"}T00:00:00.000Z`), growthRate: Rate.fromDecimal("0", rateConvention.effectiveAnnual()),
  primitiveIds: { growth: domainId("primitive-instance", uuid(20 + n * 2)), recurrence: domainId("primitive-instance", uuid(21 + n * 2)) } });
export function document(n = 0, month = 0): HouseholdWageOriginal {
  const s = bareStream(n);
  const rows = [utcMonthlyPeriods(start, month + 1)[month]!].map(period => {
    const date = instant(`${period.start.slice(0, 7)}-${n === 0 ? "15" : "20"}T00:00:00.000Z`);
    const traceRefs = freezeTraceRefs(["base", "salary-growth-assumption", `growth:${month}`, "recurrence"]
      .map(label => calculationTraceRef(calculationTraceId(`vs2:income:${s.id}:${label}`))))!;
    const amount = money("125.37");
    return { period, gross: amount, occurrenceId: generatedOccurrenceKey({ scenarioId: context().scenarioId,
      primitiveInstanceId: s.primitiveIds.recurrence, scheduledAt: date, semanticEffectType: "income-recognition", economicTargetId: s.id }),
      transaction: control.payroll ? createAccountingTransaction({ id: accountingTransactionId(`tx:recognition:income:${s.id}:${date}`), date, type: "payroll_income",
        traceRefs: [calculationTraceRef(calculationTraceId(`payroll:tx:recognition:income:${s.id}:${date}:gross:${s.id}`), []),
          calculationTraceRef(calculationTraceId(`payroll:withholding:election:${n}:income:${s.id}:owner:${s.ownerId}:employer:employer:${n}:occurrence:${generatedOccurrenceKey({ scenarioId: context().scenarioId, primitiveInstanceId: s.primitiveIds.recurrence, scheduledAt: date, semanticEffectType: "income-recognition", economicTargetId: s.id })}:year:${date.slice(0, 4)}:jurisdiction:US:provenance:synthetic-payroll`))],
        legs: [createAccountingLeg({ type: "asset", posting: "debit", entityId: taxBalanceIds("US", date.slice(0, 4)).creditPositionId,
          amount: money("10"), quantity: Quantity.parse("10", Unit.of("usd_tax_credit")) }),
          createAccountingLeg({ type: "cash", posting: "debit", amount: money("115.37"), accountId: ids.bank, cashFlowClass: "operating" }),
          createAccountingLeg({ type: "income", posting: "credit", amount })] }) : createAccountingTransaction({ id: accountingTransactionId(`tx:recognition:income:${s.id}:${date}`), date, type: "income", traceRefs,
        legs: [createAccountingLeg({ posting: "debit", type: "cash", accountId: ids.bank, amount, cashFlowClass: "operating", traceRefs }),
          createAccountingLeg({ posting: "credit", type: "income", amount, traceRefs })] }) };
  });
  return { stream: { ...s, ...(control.payroll ? withholding(n) : {}) }, sourceId: `employer-contract:${n}`, revisionId: "original/1", publishedAt: cutoff, knownAt: cutoff,
    effectiveFrom: cutoff, effectiveUntil: instant("2028-02-01T00:00:00.000Z"), status: "active", employerId: `employer:${n}`,
    householdId: ids.household, personId: s.ownerId, incomeId: s.id, bankAccountId: ids.bank, ...rows[0]! };
}
export const source = (n = 0): HouseholdWageSourceRef => ({ version: "household-wage-source/v1",
  bank: { publisherId: "wage-bank", sourceId: "shared-bank" }, original: { version: "household-economic-original/v1", family: "wage",
    publisherId: "employer-archive", sourceId: `employer-contract:${n}`, revisionId: "original/1", digest: householdWageOriginalDigest(document(n)) } });
const withholding = (n: number) => ({ payrollWithholding: [{ id: `election:${n}`, version: "payroll-withholding/v1" as const,
    incomeId: bareStream(n).id, ownerId: bareStream(n).ownerId, employerId: `employer:${n}`, depositAccountId: ids.bank,
    jurisdiction: "US", start, provenance: "synthetic-payroll", userConfirmed: true as const,
    calculation: { kind: "fixed" as const, amount: money("10") } }] });
export const stream = (n = 0): RecurringIncomeStream => ({ ...bareStream(n), householdWageSource: source(n), ...(control.payroll ? withholding(n) : {}) });
export const input = (incomes = [stream()]): VerticalSlice2Input => ({ householdId: ids.household, ownerId: ids.alice,
  cashAccountId: ids.bank, expensePayableLiabilityId: ids.payable, baseCurrency: USD, incomes, expenses: [], events: [] });
export const opening = (owner: DomainId<string> = ids.household) => createAuthoritativeState({ accounts: { [ids.bank]: {
  id: ids.bank, ownerId: owner, kind: "checking", cash: money("100") } }, liabilities: { [ids.payable]: { id: ids.payable, balance: money("0") } } });
export const control = { reads: 0, missing: false, withdrawAt: 0, rebound: false, payroll: false, revision: "", missingMonth: "" };
export const reset = () => Object.assign(control, { reads: 0, missing: false, withdrawAt: 0, rebound: false, payroll: false, revision: "", missingMonth: "" });
export function install() {
  registerHouseholdBankOriginalProvider({ publisherId: "wage-bank", readOriginals: query => {
    const c = query.context;
    if (query.sourceId !== "shared-bank" || ![ids.alice, ids.bob].includes(c.personId)) return undefined;
    const base = { revisionId: "original/1", publishedAt: cutoff, knownAt: cutoff, effectiveFrom: cutoff,
      effectiveUntil: instant("2028-02-01T00:00:00.000Z"), status: "active" as const };
    return { version: "household-bank-original-inventory/v1", publisherId: "wage-bank", query, checkedAt: c.asOf,
      completeThrough: c.dataCutoff, completeness: "complete", originals: [
        { ...base, kind: "account", sourceId: "deed", bankAccountId: ids.bank, owner: { kind: "household", id: control.rebound ? "different-household" : ids.household }, accountKind: "checking" },
        { ...base, kind: "household", sourceId: "household", householdId: ids.household },
        { ...base, kind: "membership", sourceId: `member:${c.personId}`, householdId: ids.household, personId: c.personId },
        { ...base, kind: "permission", sourceId: `permission:${c.personId}`, householdId: ids.household, personId: c.personId, bankAccountId: ids.bank, direction: "credit" }] };
  } });
  registerHouseholdWageOriginalProvider({ publisherId: "employer-archive", readOriginals: query => {
    control.reads++;
    if (control.missing || query.context.eventAt.slice(0, 7) === control.missingMonth ||
        control.withdrawAt > 0 && control.reads >= control.withdrawAt) return undefined;
    const n = query.sourceId === "employer-contract:0" ? 0 : query.sourceId === "employer-contract:1" ? 1 : undefined;
    if (n === undefined) return undefined;
    const doc = document(n, utcCalendarMonthDifference(start, query.context.eventAt));
    const changed = control.revision === "withdrawn" ? { ...doc, status: "withdrawn" as const }
      : control.revision === "late" ? { ...doc, knownAt: instant("2026-01-01T00:00:00.000Z") }
      : control.revision === "mismatch" ? { ...doc, personId: ids.bob }
      : doc;
    return { version: "household-wage-inventory/v1", publisherId: "employer-archive", sourceId: query.sourceId,
      context: query.context, checkedAt: query.context.asOf, completeThrough: query.context.dataCutoff, completeness: "complete",
      originals: control.revision === "duplicate" ? [doc, doc] : [changed] };
  } });
}
