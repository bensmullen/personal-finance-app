import { domainId } from "../../../../src/identity/index.js";
import { createAuthoritativeState } from "../../../../src/state/index.js";
import { civilDate, instant, utcMonthlyPeriods } from "../../../../src/time/index.js";
import { money, USD } from "../../../../src/values/index.js";
import { compileHouseholdKernel } from "../../../../src/simulation/householdExecution.js";
import { createPrimitiveRuntimeStateStore } from "../../../../src/simulation/period.js";
import { createRunContext, runId, scenarioId } from "../../../../src/simulation/run.js";
import { composeMedicareObligations, type MedicareCoordinationRequest } from "../../../../src/simulation/d2/health/medicare/coordination/index.js";
import type { MedicareElection, PremiumSource } from "../../../../src/simulation/d2/health/premiums/index.js";
import type { ConfirmedMedicareBankPremium, MedicareBankInput } from "../../../../src/simulation/d2/integration/medicareBank/index.js";

export const uuid = (n: number) => `149b0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const household = domainId("household", uuid(1));
export const person = (n = 0) => domainId("person", uuid(10 + n));
export const bank = (n = 0) => domainId("account", uuid(20 + n));
export const payable = (part: string, n = 0) => domainId("liability", uuid(100 + n * 10 + (part === "part_b" ? 1 : 2)));
export const span = (start: string, end: string) => ({ start: civilDate(start), endExclusive: civilDate(end) });
export const source = (family: string, year = 2026): PremiumSource => ({ ...span(`${year}-01-01`, `${year + 1}-01-01`),
  ruleSnapshotId: `synthetic:${family}:${year}`, ruleFamily: family, jurisdiction: "US", asOf: civilDate("2025-12-01"),
  sourcePublication: `Synthetic ${family} ${year}; not real CMS law`, version: "synthetic-v1", projectionStatus: "verified" });
export function request(month = "2026-06", elected: readonly MedicareElection[] = ["part_b", "part_d"], n = 0,
  surcharge = { b: "0", d: "0" }): MedicareCoordinationRequest {
  const start = `${month}-01`, year = Number(month.slice(0, 4)), m = Number(month.slice(5));
  const end = m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, "0")}-01`;
  const period = span(start, end), s = (f: string) => source(f, year), member = person(n);
  const coverages = elected.map(part => ({ ...period, id: `coverage:${n}:${part}:${month}`, planId: `plan:${n}:${part}`,
    householdId: household, memberIds: [member], sponsorId: `sponsor:${n}`, recipientId: `provider:${part}`, planFamily: "medicare" as const,
    route: { kind: "aftertax_bank" as const, payerId: member, sourceAccountId: bank(n), evidence: s("bank_route") },
    eligibility: [{ memberId: member, householdId: household, planId: `plan:${n}:${part}`, eligible: true, evidence: s("eligibility") }],
    medicare: { premiumFor: part, elected, enrollmentEvidence: s("medicare_enrollment"), compatibilityEvidence: s("coordination") },
    quote: { quoteId: `quote:${n}:${part}:${month}`, source: s(`quote:${n}:${part}:${month}`),
      gross: money(part === "part_b" ? "80" : part === "part_a" ? "0" : "120"), employer: money("0"),
      member: money(part === "part_b" ? "80" : part === "part_a" ? "0" : "120"),
      schedule: { anchor: civilDate(start), frequency: "monthly" as const, interval: 1, invalidDay: "skip" as const,
        amountBasis: "per_occurrence_no_proration" as const } } }));
  const parts: readonly MedicareElection[] = ["part_a", "part_b", "part_d", "advantage", "medigap", "supplement"];
  return {
    premiums: { householdId: household, memberIds: [member], period, coverages,
      coordination: [{ memberId: member, coverageIds: coverages.map(c => c.id), admitsDistinctPremiums: true, evidence: s("coordination") }] },
    irmaa: { householdId: household, personIds: [member], period, taxYear: year,
      enrollments: coverages.filter(c => c.medicare.premiumFor === "part_b" || c.medicare.premiumFor === "part_d").map(c => ({ ...period,
        personId: member, householdId: household, coverageId: c.id, planId: c.planId,
        part: c.medicare.premiumFor as "part_b" | "part_d", elected, source: s("medicare_enrollment") })),
      deaths: [], overrides: [], histories: [{ personId: member, householdId: household, taxYear: year - 2,
        taxReturnRef: `return:${n}:${year - 2}`, filingStatus: "single", maritalState: "unmarried", magi: money("100"),
        source: { ...s("historical_tax_return"), ...span(`${year - 2}-01-01`, `${year - 1}-01-01`) } }],
      rules: [{ source: s("cms_irmaa"), taxYear: year, lookbackTaxYear: year - 2, currency: "USD", monthlyConvention: "whole_month_only",
        tables: [{ filingStatus: "single", maritalState: "unmarried", tiers: [{ id: "sourced-synthetic-tier", lower: null, upper: null,
          lowerInclusive: false, upperInclusive: false, partBMonthly: money(surcharge.b), partDMonthly: money(surcharge.d) }] }] }] },
    inventories: [{ ...period, householdId: household, personId: member, eventAt: civilDate(start), source: s("medicare_inventory"),
      parts: parts.map(part => elected.includes(part) ? { part, status: "elected" as const, coverageId: `coverage:${n}:${part}:${month}`, source: s("election") }
        : { part, status: "excluded" as const, reason: "source-excluded", source: s("election") }),
      surcharges: (["part_b", "part_d"] as const).map(part => ({ part, status: elected.includes(part) ? "applicable" as const : "not_applicable" as const,
        reason: "explicit sourced applicability", source: s("cms_coverage") })) }],
    banks: [{ ...period, householdId: household, accountId: bank(n), accountKind: "BANK", ownerIds: [member], source: s("bank_ownership") }],
    awards: [], deductionTerms: [],
  };
}
export function confirmations(r = request()): readonly ConfirmedMedicareBankPremium[] {
  return composeMedicareObligations(r).obligations.filter(o => o.memberObligation.isPositive()).map(o => {
    const n = Number(o.personId.slice(-12)) - 10;
    const offset = Number(o.effectiveAt.slice(0, 4)) * 10000 + Number(o.effectiveAt.slice(5, 7)) * 100 + n * 10 + (o.part === "part_b" ? 0 : 4);
    return { obligation: o, expenseId: domainId("expense", uuid(offset)),
      primitiveIds: { indexGrowth: domainId("primitive-instance", uuid(offset + 1)), inflationLink: domainId("primitive-instance", uuid(offset + 2)),
        recurrence: domainId("primitive-instance", uuid(offset + 3)) }, settlementPriority: n * 10 + (o.part === "part_b" ? 1 : 2),
      bank: { accountId: bank(n), householdId: household, payerId: person(n), classification: "BANK", evidence: source("bank_ownership", Number(o.effectiveAt.slice(0, 4))) },
      payable: { liabilityId: payable(o.part, n), householdId: household, payerId: person(n), coverageId: o.coverageId,
        personId: person(n), part: o.part as "part_b" | "part_d", recipientId: o.recipientId, quoteId: o.quoteId, period: o.period,
        evidence: source(`payable:${o.part}`, Number(o.effectiveAt.slice(0, 4))) } };
  });
}
export function fixture(months = 1, cash = "2000", recipients = 1, startMonth = "2026-06") {
  const start = instant(`${startMonth}-01T00:00:00.000Z`);
  const state = createAuthoritativeState({
    accounts: Object.fromEntries(Array.from({ length: recipients }, (_, n) => [bank(n), { id: bank(n), ownerId: person(n), kind: "checking" as const, cash: money(cash) }])),
    liabilities: Object.fromEntries(Array.from({ length: recipients }, (_, n) => ["part_b", "part_d"].map(part =>
      [payable(part, n), { id: payable(part, n), balance: money("0") }])).flat()),
  });
  const context = createRunContext({ runId: runId(uuid(5)), scenarioId: scenarioId(uuid(6)), asOf: instant("2026-01-01T00:00:00.000Z"),
    dataCutoff: instant("2026-01-01T00:00:00.000Z"), simulationStart: start,
    simulationEnd: utcMonthlyPeriods(start, months).at(-1)!.end, baseCurrency: USD });
  const kernel = compileHouseholdKernel({ reconciledOpeningState: state, reconciledPrimitiveState: createPrimitiveRuntimeStateStore(),
    cashFlowInput: { householdId: household, ownerId: person(), baseCurrency: USD, cashAccountId: bank(), expensePayableLiabilityId: payable("part_b"),
      incomes: [], expenses: [], events: [] }, scenarioIdentity: context.scenarioId, executionMonths: months, scenarioBindings: {},
    contentionPolicy: { id: "synthetic-medicare-bank", version: "1", rules: [] } }, start);
  return { state, context, kernel };
}
export const input = (r = request(), kernel = fixture().kernel): MedicareBankInput => ({ request: r, kernel,
  asOf: civilDate("2026-01-01"), confirmed: confirmations(r), representations: [] });
