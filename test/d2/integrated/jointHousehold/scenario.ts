import { readFileSync } from "node:fs";
import { domainId } from "../../../../src/identity/index.js";
import { createFundingPolicy, fundingPolicyId } from "../../../../src/funding/index.js";
import { calculationTraceId, calculationTraceRef } from "../../../../src/lineage/index.js";
import { createAuthoritativeState } from "../../../../src/state/index.js";
import { civilDate, instant, utcMonthlyPeriods } from "../../../../src/time/index.js";
import { USD, Rate, RoundingPolicy, decimal, money, rateConvention } from "../../../../src/values/index.js";
import { compileHouseholdKernel, runHouseholdKernel } from "../../../../src/simulation/householdExecution.js";
import { createPrimitiveRuntimeStateStore } from "../../../../src/simulation/period.js";
import { createRunContext, runId, scenarioId } from "../../../../src/simulation/run.js";
import { proposePremiums, type PremiumCoverage, type PremiumRequest, type PremiumSource } from "../../../../src/simulation/d2/health/premiums/index.js";
import { attachAftertaxPremiums, type AftertaxPremiumInput, type ConfirmedPremium } from "../../../../src/simulation/d2/integration/aftertaxPremiums/index.js";
import type { FixedAmortizingLoan } from "../../../../src/simulation/verticalSlice4.js";
import { catalogSchema } from "../../../fixtures/d2/schema.js";

export const catalog = catalogSchema.parse(JSON.parse(readFileSync(new URL("../../../fixtures/d2/catalog.json", import.meta.url), "utf8")));
export const anchor = (id: string) => catalog.cases.find(c => c.id === id)!;
const fromCents = (value: string) => money(value).times(decimal("0.01"));
export const trace = (id: string) => calculationTraceRef(calculationTraceId(id));
export const start = instant("2026-01-01T00:00:00.000Z");
export const asOf = civilDate("2025-12-31");
export const source = (label: string): PremiumSource => ({
  start: civilDate("2025-01-01"), endExclusive: civilDate("2028-01-01"), asOf,
  ruleSnapshotId: `synthetic:#149:${label}`, jurisdiction: "US", ruleFamily: "authored_premium_quote",
  sourcePublication: `#149 S8-1 synthetic ${label} terms; see jointHousehold/README.md`,
  version: "1", projectionStatus: "verified",
});

/** Authored synthetic terms; all postings are made by the production executor. */
export function scenario({ cash = "2000", months = 1, namespace = 1, wageDay = "05" } = {}) {
  const uuid = (n: number) => `14910000-0000-4000-8000-${String(namespace * 10000 + n).padStart(12, "0")}`;
  const ids = {
    household: domainId("household", uuid(1)), member: domainId("person", uuid(2)),
    bank: domainId("account", uuid(3)), payable: domainId("liability", uuid(4)),
    principal: domainId("liability", uuid(5)), interest: domainId("liability", uuid(6)),
    loan: domainId("loan-contract", uuid(7)), wage: domainId("income", uuid(8)), scenario: scenarioId(uuid(9)),
  };
  const primitive = (n: number) => domainId("primitive-instance", uuid(n));
  const periods = utcMonthlyPeriods(start, months);
  const end = periods.at(-1)!.end;
  const payday = instant(`2026-01-${wageDay}T00:00:00.000Z`);
  const due = instant("2026-01-15T00:00:00.000Z");
  const fixed = anchor("auto_final_interest");
  const health = anchor("health_after_tax");
  const funding = createFundingPolicy({ id: fundingPolicyId(`synthetic:#149:${ids.loan}:checking-only`),
    orderedSources: [{ kind: "cash_account", accountId: ids.bank }], allowPartial: false, insufficientFundsBehavior: "unfunded" });
  const loan: FixedAmortizingLoan = {
    id: ids.loan, debtFamily: "auto", ownerId: ids.member,
    principalLiabilityId: ids.principal, interestPayableLiabilityId: ids.interest,
    originalPrincipal: money("5000"), annualRate: Rate.fromDecimal(fixed.input.terms.annualRate!, rateConvention.nominalAnnual(12)),
    totalPayments: 12, rateType: "fixed", paymentFrequency: "monthly", interestConvention: "nominal_annual_12",
    amortization: "fully_amortizing", paymentResetPolicy: "fixed_no_recast", interestCapitalization: "none",
    partialPaymentPolicy: "all_or_nothing", paymentSchedule: { kind: "utc_monthly", anchor: due, invalidDayPolicy: "skip" },
    fundingPolicy: funding, settlementPriority: 1, postingRounding: RoundingPolicy.currency(2, "half_up"),
    primitiveIds: { schedule: primitive(20), amortization: primitive(21), accrual: primitive(22) },
    sourceTraceRefs: [trace("fixture:auto_final_interest"), trace(`synthetic:#149:${ids.loan}:12-month-contract`)],
    // $444.24 required + $55.76 explicitly optional principal, not a $500 required payment.
    extraPrincipalPayments: periods.slice(0, 12).map((p, i) => ({
      id: domainId("extra-principal-payment", uuid(100 + i)),
      scheduledAt: instant(`${p.start.slice(0, 7)}-15T00:00:00.000Z`), amount: money("55.76"),
      fundingPolicy: funding, primitiveInstanceId: primitive(200 + i),
      sourceTraceRefs: [trace(`synthetic:#149:${ids.loan}:optional-55.76`)],
    })),
  };
  const opening = createAuthoritativeState({
    accounts: { [ids.bank]: { id: ids.bank, ownerId: ids.member, kind: "checking", cash: money(cash) } }, positions: {},
    liabilities: {
      [ids.payable]: { id: ids.payable, balance: money("0") },
      [ids.principal]: { id: ids.principal, balance: money("5000") },
      [ids.interest]: { id: ids.interest, balance: money("0") },
    },
  });
  const base = compileHouseholdKernel({
    cashFlowInput: { householdId: ids.household, ownerId: ids.member, cashAccountId: ids.bank,
      expensePayableLiabilityId: ids.payable, baseCurrency: USD, expenses: [], events: [],
      incomes: [{ id: ids.wage, ownerId: ids.member, baseMonthlyAmount: money("1000"), start: payday,
        recurrence: { kind: "utc_monthly", anchor: payday, invalidDayPolicy: "skip" }, depositAccountId: ids.bank,
        growthRate: Rate.fromDecimal("0", rateConvention.effectiveAnnual()), growthBaseAt: payday,
        primitiveIds: { growth: primitive(30), recurrence: primitive(31) }, sourceTraceRefs: [trace("synthetic:#149:wage-deposit-1000")] }] },
    liabilityInput: { householdId: ids.household, ownerId: ids.member, baseCurrency: USD, loans: [loan] },
    reconciledOpeningState: opening, reconciledPrimitiveState: createPrimitiveRuntimeStateStore(),
    scenarioIdentity: ids.scenario, executionMonths: months, scenarioBindings: { source: "#149 S8-1" },
    contentionPolicy: { id: "synthetic:#149:no-cross-domain-priority", version: "1", rules: [] },
  }, start);
  const memberAmount = fromCents(health.input.amounts.householdShareCents!);
  const coverage: PremiumCoverage = {
    id: `health:${ids.household}`, planId: `plan:${ids.household}`, householdId: ids.household, memberIds: [ids.member],
    sponsorId: "synthetic-employer", recipientId: "synthetic-insurer", planFamily: "health_insurance",
    start: civilDate(start.slice(0, 10)), endExclusive: civilDate(end.slice(0, 10)),
    route: { kind: "aftertax_bank", payerId: ids.member, sourceAccountId: ids.bank, evidence: source("bank-route") },
    eligibility: [{ memberId: ids.member, householdId: ids.household, planId: `plan:${ids.household}`, eligible: true, evidence: source("eligibility") }],
    quote: { quoteId: `quote:${ids.household}`, source: source("health-quote"), member: memberAmount,
      employer: money("100"), gross: memberAmount.plus(money("100")),
      schedule: { anchor: civilDate("2026-01-15"), frequency: "monthly", interval: 1, invalidDay: "skip", amountBasis: "per_occurrence_no_proration" } },
  };
  const request: PremiumRequest = { householdId: ids.household, memberIds: [ids.member], period: {
    start: coverage.start, endExclusive: coverage.endExclusive }, coverages: [coverage], coordination: [] };
  const confirmed: readonly ConfirmedPremium[] = proposePremiums(request).proposals.map((proposal, i) => ({
    proposal, expenseId: domainId("expense", uuid(300 + i)), settlementPriority: 1,
    primitiveIds: { indexGrowth: primitive(400 + i * 3), inflationLink: primitive(401 + i * 3), recurrence: primitive(402 + i * 3) },
    bank: { accountId: ids.bank, householdId: ids.household, payerId: ids.member, classification: "BANK", evidence: source("bank-route") },
    payable: { liabilityId: ids.payable, householdId: ids.household, payerId: ids.member, coverageId: coverage.id, evidence: source("premium-payable") },
  }));
  const input: AftertaxPremiumInput = { kernel: base, request, asOf, confirmed, representations: [] };
  const attached = attachAftertaxPremiums(input);
  const context = createRunContext({ runId: runId(uuid(10)), scenarioId: ids.scenario,
    asOf: instant(`${asOf}T00:00:00.000Z`), dataCutoff: instant(`${asOf}T00:00:00.000Z`),
    simulationStart: start, simulationEnd: end, baseCurrency: USD });
  return { ids, opening, loan, coverage, input, attached, context,
    run: () => runHouseholdKernel({ kernel: attached.kernel, runContext: context, resultTier: "detail" }) };
}
