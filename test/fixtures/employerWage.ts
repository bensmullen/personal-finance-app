import { accountingTransactionId, createAccountingLeg, createAccountingTransaction } from "../../src/accounting/index.js";
import { domainId, generatedOccurrenceKey } from "../../src/identity/index.js";
import { calculationTraceId, calculationTraceRef, freezeTraceRefs } from "../../src/lineage/index.js";
import { sha256 } from "../../src/rules/tax/t1b/contentIdentity.js";
import { registerHouseholdBankOriginalProvider, type HouseholdBankOriginal } from "../../src/simulation/d2/integration/householdBank/index.js";
import { householdWageOriginalDigest, registerHouseholdWageOriginalProvider, type HouseholdWageOriginal, type WageStreamOriginal } from "../../src/simulation/d2/integration/householdWages/index.js";
import { canonicalSerialize, type RunContext } from "../../src/simulation/run.js";
import { taxBalanceIds } from "../../src/simulation/tax/contracts.js";
import type { PayrollWithholdingElection } from "../../src/simulation/tax/contracts.js";
import type { RecurringIncomeStream } from "../../src/simulation/verticalSlice2.js";
import { instant, utcCalendarMonthDifference, utcMonthlyPeriods, type Period } from "../../src/time/index.js";
import { money, Quantity, Rate, rateConvention, Unit } from "../../src/values/index.js";

export type EmployerWageSourceMode = "available" | "missing" | "withdrawn" | "changed" | "duplicate" | "late" |
  "bank_owner" | "bank_other_person" | "bank_missing" | "bank_permission";
type FixedWithholding = PayrollWithholdingElection & { readonly calculation: { readonly kind: "fixed"; readonly amount: ReturnType<typeof money> } };

/** An employer contract and BANK roster authored separately from the R3 kernel. */
export function employerWage(context: RunContext, terms: {
  readonly householdId: string;
  readonly personId: string;
  readonly incomeId: string;
  readonly bankAccountId: string;
  readonly employerId: string;
  readonly firstPayday: string;
  readonly gross: string;
  readonly bankOwner?: "person";
  readonly withholding?: FixedWithholding;
  readonly elections?: readonly FixedWithholding[];
}) {
  const { householdId, personId, incomeId, bankAccountId, employerId, withholding } = terms;
  const elections = terms.elections ?? (withholding === undefined ? [] : [withholding]);
  const start = instant(`${terms.firstPayday}T00:00:00.000Z`);
  const gross = money(terms.gross);
  const archiveId = `fixture:employer:${sha256(canonicalSerialize({ context, terms }))}`;
  const installed = archives.get(archiveId);
  if (installed !== undefined) return installed;
  const bankId = `${archiveId}:bank`;
  const sourceId = "employer-pay-schedule", revisionId = "original/1";
  const primitiveId = (purpose: string) => {
    const hash = sha256(`${incomeId}:${purpose}`);
    return domainId("primitive-instance", `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`);
  };
  const stream: WageStreamOriginal = {
    id: domainId("income", incomeId), ownerId: domainId("person", personId),
    depositAccountId: domainId("account", bankAccountId), baseMonthlyAmount: gross, start,
    recurrence: { kind: "utc_monthly", anchor: start, invalidDayPolicy: "skip" },
    growthBaseAt: start, growthRate: Rate.fromDecimal("0", rateConvention.effectiveAnnual()),
    primitiveIds: {
      growth: primitiveId("employer-growth"),
      recurrence: primitiveId("employer-recurrence"),
    },
    ...(elections.length === 0 ? {} : { payrollWithholding: elections }),
  };
  const publication = {
    sourceId, revisionId, publishedAt: context.dataCutoff, knownAt: context.dataCutoff,
    effectiveFrom: start, effectiveUntil: context.simulationEnd, status: "active" as const,
  };
  const document = (period: Period): HouseholdWageOriginal => {
    const date = instant(`${period.start.slice(0, 7)}-${start.slice(8)}`);
    const month = utcCalendarMonthDifference(start, date);
    const occurrenceId = generatedOccurrenceKey({
      scenarioId: context.scenarioId, primitiveInstanceId: stream.primitiveIds.recurrence,
      scheduledAt: date, semanticEffectType: "income-recognition", economicTargetId: stream.id,
    });
    const id = accountingTransactionId(`tx:recognition:income:${incomeId}:${date}`);
    const year = date.slice(0, 4);
    const active = elections.filter(e => e.start <= date && (e.end === undefined || date < e.end));
    const traceRefs = elections.length === 0
      ? freezeTraceRefs(["base", "salary-growth-assumption", `growth:${month}`, "recurrence"]
        .map(label => calculationTraceRef(calculationTraceId(`vs2:income:${incomeId}:${label}`))))!
      : [calculationTraceRef(calculationTraceId(`payroll:${id}:gross:${incomeId}`), []),
        ...active.map(election => calculationTraceRef(calculationTraceId(
          `payroll:withholding:${election.id}:income:${incomeId}:owner:${personId}:employer:${employerId}:occurrence:${occurrenceId}:year:${year}:jurisdiction:${election.jurisdiction}:provenance:${election.provenance}`,
        )))];
    const withheld = active.reduce((sum, election) => sum.plus(election.calculation.amount), money("0"));
    const net = gross.minus(withheld);
    const legTraces = elections.length === 0 ? { traceRefs } : {};
    const transaction = createAccountingTransaction({ id, date, type: elections.length === 0 ? "income" : "payroll_income", traceRefs, legs: [
      ...active.filter(e => e.calculation.amount.isPositive()).map(election => createAccountingLeg({ type: "asset", posting: "debit",
        entityId: taxBalanceIds(election.jurisdiction, year).creditPositionId, amount: election.calculation.amount,
        quantity: Quantity.parse(election.calculation.amount.amount.toString(), Unit.of("usd_tax_credit")) })),
      ...(net.isPositive() ? [createAccountingLeg({ type: "cash", posting: "debit",
        accountId: stream.depositAccountId, cashFlowClass: "operating", amount: net, ...legTraces })] : []),
      createAccountingLeg({ type: "income", posting: "credit", amount: gross, ...legTraces }),
    ] });
    return { ...publication, stream, employerId, householdId, personId, incomeId, bankAccountId,
      period, occurrenceId, gross, transaction };
  };
  const months = utcCalendarMonthDifference(context.simulationStart, context.simulationEnd);
  const periods = utcMonthlyPeriods(context.simulationStart, months);
  const first = periods.find(period => period.end > start)!;
  const originals = new Map(periods.filter(period => period.end > start)
    .map(period => [period.start.slice(0, 7), document(period)]));
  const reads = { employer: 0, bank: 0 };
  const source = { mode: "available" as EmployerWageSourceMode };
  const matchesRun = (query: { readonly runId: string; readonly asOf: string; readonly dataCutoff: string }) =>
    query.runId === context.runId && query.asOf === context.asOf && query.dataCutoff === context.dataCutoff;
  registerHouseholdWageOriginalProvider({ publisherId: archiveId, readOriginals: query => {
    reads.employer++;
    const original = originals.get(query.context.eventAt.slice(0, 7));
    if (!matchesRun(query.context) || query.sourceId !== sourceId || original === undefined || source.mode === "missing") return undefined;
    const current = source.mode === "withdrawn" ? { ...original, status: "withdrawn" as const }
      : source.mode === "changed" ? { ...original, employerId: "amended-employer" }
      : source.mode === "late" ? { ...original, knownAt: context.simulationEnd }
      : original;
    return { version: "household-wage-inventory/v1", publisherId: archiveId, sourceId, context: query.context,
      checkedAt: context.asOf, completeThrough: context.dataCutoff, completeness: "complete",
      originals: source.mode === "duplicate" ? [current, current] : [current] };
  } });
  const bankOriginals: readonly HouseholdBankOriginal[] = [
    { ...publication, kind: "account", sourceId: "deed", bankAccountId,
      owner: terms.bankOwner === "person" ? { kind: "person", id: personId } : { kind: "household", id: householdId },
      accountKind: "checking" },
    { ...publication, kind: "household", sourceId: "roster", householdId },
    { ...publication, kind: "membership", sourceId: "member", householdId, personId },
    { ...publication, kind: "permission", sourceId: "payroll-deposit", householdId, personId, bankAccountId, direction: "credit" },
  ];
  registerHouseholdBankOriginalProvider({ publisherId: bankId, readOriginals: query => {
    reads.bank++;
    if (!matchesRun(query.context) || query.sourceId !== "receiving-account" || source.mode === "bank_missing") return undefined;
    const originals = bankOriginals.map(fact => {
      if (fact.kind === "account" && source.mode === "bank_owner")
        return { ...fact, owner: terms.bankOwner === "person"
          ? { kind: "household" as const, id: householdId } : { kind: "person" as const, id: personId } };
      if (fact.kind === "account" && source.mode === "bank_other_person")
        return { ...fact, owner: { kind: "person" as const, id: "different-bank-owner" } };
      if (fact.kind === "permission" && source.mode === "bank_permission")
        return { ...fact, status: "revoked" as const };
      return fact;
    });
    return { version: "household-bank-original-inventory/v1", publisherId: bankId, query,
      checkedAt: context.asOf, completeThrough: context.dataCutoff, completeness: "complete", originals };
  } });
  const income: RecurringIncomeStream = { ...stream, householdWageSource: {
    version: "household-wage-source/v1",
    bank: { publisherId: bankId, sourceId: "receiving-account" },
    original: { version: "household-economic-original/v1", family: "wage", publisherId: archiveId,
      sourceId, revisionId, digest: householdWageOriginalDigest(document(first)) },
  } };
  const fixture = { income, reads, source };
  archives.set(archiveId, fixture);
  return fixture;
}

const archives = new Map<string, {
  readonly income: RecurringIncomeStream;
  readonly reads: { employer: number; bank: number };
  readonly source: { mode: EmployerWageSourceMode };
}>();
