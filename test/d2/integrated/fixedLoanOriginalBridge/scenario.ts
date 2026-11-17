import { domainId } from "../../../../src/identity/index.js";
import { createFundingPolicy, fundingPolicyId } from "../../../../src/funding/index.js";
import { registerHouseholdBankOriginalProvider } from "../../../../src/simulation/d2/integration/householdBank/index.js";
import { registerFixedLoanOriginalProvider, type FixedLoanContractOriginal, type FixedLoanPaymentOriginal } from "../../../../src/simulation/d2/integration/fixedLoanOriginalBridge/source.js";
import { createPrimitiveRuntimeStateStore } from "../../../../src/simulation/period.js";
import { createAuthoritativeState } from "../../../../src/state/index.js";
import { instant, type Instant } from "../../../../src/time/index.js";
import { money, Rate, rateConvention, RoundingPolicy, USD } from "../../../../src/values/index.js";
import { ids, originalFacts } from "../householdBankAuthority/scenario.js";
import { createRunContext, runId, scenarioId } from "../../../../src/simulation/run.js";
import type { ExecutableHouseholdProjection } from "../../../../src/simulation/householdExecution.js";
import type { DebtFamily, FixedAmortizingLoan } from "../../../../src/simulation/verticalSlice4.js";

const fixtureId = (suffix: number) => `58f21d59-0077-4ee2-8593-${String(suffix).padStart(12, "0")}`;
const primitive = (suffix: number) => domainId("primitive-instance", fixtureId(suffix));
export const start = instant("2026-01-01T00:00:00.000Z"), at = instant("2026-01-15T00:00:00.000Z");
const asOf = instant("2025-12-31T00:00:00.000Z"), first = instant("2025-01-01T00:00:00.000Z");
export const principal = domainId("liability", fixtureId(1)), interest = domainId("liability", fixtureId(2));
const payable = domainId("liability", fixtureId(3));
const funding = createFundingPolicy({ id: fundingPolicyId("fixed-loan:fixture"), orderedSources: [{ kind: "cash_account", accountId: ids.bank }],
  allowPartial: false, insufficientFundsBehavior: "unfunded" });
const recurrence = { kind: "utc_monthly", anchor: at, invalidDayPolicy: "skip" } as const;
const extraId = domainId("extra-principal-payment", fixtureId(9));
const publisherId = "synthetic-fixed-loan-publisher", bankPublisherId = "synthetic-fixed-loan-bank";
const bankSource = { publisherId: bankPublisherId, sourceId: "household-member-route", accountId: ids.bank };
const revision = { status: "active", publishedAt: first, knownAt: first, effectiveFrom: first,
  effectiveUntil: instant("2030-01-01T00:00:00.000Z") } as const;
const archive = new Map<string, { contract: FixedLoanContractOriginal; payment: Omit<FixedLoanPaymentOriginal, "eventAt" | "sourceId" | "taxYear"> }>();
export const control = { permission: "debit" as "debit" | "credit" | "revoked", lenderAvailable: true,
  withheldEvent: undefined as Instant | undefined, revokeLenderOnBankRead: false, lenderReads: 0, bankReads: 0 };
registerFixedLoanOriginalProvider({ publisherId, readOriginals(query) {
  control.lenderReads++;
  const original = archive.get(query.reference.contractSourceId);
  if (!control.lenderAvailable || control.withheldEvent === query.eventAt || !original || query.asOf !== asOf || query.dataCutoff !== asOf) return undefined;
  return { version: "fixed-loan-original-inventory/v1", query, checkedAt: asOf, completeThrough: asOf, completeness: "complete",
    contractHistory: [{ ...revision, revisionId: "lender-contract-1", original: original.contract }],
    paymentHistory: [{ ...revision, revisionId: "lender-payment-1", original: { ...original.payment,
      eventAt: query.eventAt, sourceId: `lender-installment:${query.eventAt}`, taxYear: Number(query.eventAt.slice(0, 4)) } }] };
} });
registerHouseholdBankOriginalProvider({ publisherId: bankPublisherId, readOriginals(query) {
  control.bankReads++;
  if (control.revokeLenderOnBankRead) control.lenderAvailable = false;
  if (query.sourceId !== bankSource.sourceId || query.context.personId !== ids.alice || query.context.asOf !== asOf) return undefined;
  return { version: "household-bank-original-inventory/v1", publisherId: bankPublisherId, query, checkedAt: asOf,
    completeThrough: asOf, completeness: "complete", originals: originalFacts(query).map(original => original.kind !== "permission"
      ? original : { ...original, direction: control.permission === "credit" ? "credit" : "debit", status: control.permission === "revoked" ? "revoked" : "active" }) };
} });
export function reset() {
  control.permission = "debit";
  control.lenderAvailable = true;
  control.withheldEvent = undefined;
  control.revokeLenderOnBankRead = false;
  control.lenderReads = 0;
  control.bankReads = 0;
  archive.clear();
}

export function fixture(family: DebtFamily, mode: "extra" | "contention" | "growth", term: number, months = 1) {
  const [openingPrincipal, interestDue, principalDue, payment]: [string, string, string, string] = mode === "extra" ? ["100", "1", "49.75", "50.75"] :
    mode === "contention" ? ["99.01", "0.99", "99.01", "100"] : [String(term), "0", "1", "1"];
  const originalSource = { version: "fixed-loan-original-reference/v1", publisherId,
    lenderId: "original-lender", lenderAccountId: "original-account", contractSourceId: `${family}:${mode}:${term}` } as const;
  const contract: FixedLoanContractOriginal = { reference: originalSource, householdId: ids.household, borrowerId: ids.alice,
    loanId: domainId("loan-contract", fixtureId(4)), legalOwnerId: ids.alice, principalLiabilityId: principal, interestPayableLiabilityId: interest,
    debtFamily: family, originalPrincipal: money(openingPrincipal), annualRate: Rate.fromDecimal(mode === "growth" ? "0" : "0.12", rateConvention.nominalAnnual(12)),
    totalPayments: term, paymentSchedule: recurrence };
  archive.set(originalSource.contractSourceId, { contract, payment: { contractSourceId: originalSource.contractSourceId,
    contractualPayment: money(payment), currentInterest: money(interestDue), interestDue: money(interestDue), principalDue: money(principalDue), bank: bankSource,
    ...(mode === "extra" ? { extra: { instructionId: extraId, authorizedAmount: money("0.01") } } : {}) } });
  const loan: FixedAmortizingLoan = { originalSource, id: contract.loanId, ownerId: contract.legalOwnerId, debtFamily: family,
    principalLiabilityId: principal, interestPayableLiabilityId: interest, originalPrincipal: contract.originalPrincipal,
    annualRate: contract.annualRate, totalPayments: term, paymentSchedule: recurrence, fundingPolicy: funding, settlementPriority: 1,
    rateType: "fixed", paymentFrequency: "monthly", interestConvention: "nominal_annual_12", amortization: "fully_amortizing",
    paymentResetPolicy: "fixed_no_recast", interestCapitalization: "none", partialPaymentPolicy: "all_or_nothing",
    postingRounding: RoundingPolicy.currency(2, "half_up"), primitiveIds: { schedule: primitive(5), amortization: primitive(6), accrual: primitive(7) },
    ...(mode === "extra" ? { extraPrincipalPayments: [{ id: extraId, amount: money("0.01"), scheduledAt: at, fundingPolicy: funding,
      primitiveInstanceId: primitive(8) }] } : {}) };
  const context = createRunContext({ runId: runId(fixtureId(10)), scenarioId: scenarioId(fixtureId(11)), asOf, dataCutoff: asOf,
    simulationStart: start, simulationEnd: instant(new Date(Date.UTC(2026, months, 1)).toISOString()), baseCurrency: USD });
  const openingState = createAuthoritativeState({ accounts: { [ids.bank]: { id: ids.bank, ownerId: ids.household, kind: "checking", cash: money("100") } },
    liabilities: { [principal]: { id: principal, balance: money(openingPrincipal) }, [interest]: { id: interest, balance: money("0") },
      [payable]: { id: payable, balance: money("0") } } });
  const input = { householdId: ids.household, ownerId: ids.alice, baseCurrency: USD, loans: [loan] };
  const compiled: ExecutableHouseholdProjection = { liabilityInput: input, reconciledOpeningState: openingState,
    reconciledPrimitiveState: createPrimitiveRuntimeStateStore(), scenarioIdentity: context.scenarioId, executionMonths: months, scenarioBindings: {},
    ...(mode === "contention" ? { cashFlowInput: { householdId: ids.household, ownerId: ids.alice, cashAccountId: ids.bank,
      expensePayableLiabilityId: payable, baseCurrency: USD, sameInstantCashFlowOrder: "income_before_expense", incomes: [], events: [],
      expenses: [{ id: domainId("expense", fixtureId(12)), ownerId: ids.household, paymentAccountId: ids.bank,
        payableLiabilityId: payable, baseMonthlyAmount: money("100"), start, recurrence, inflationRate: Rate.fromDecimal("0", rateConvention.effectiveAnnual()),
        inflationBaseAt: at, fundingPolicy: funding, settlementPriority: 1,
        primitiveIds: { indexGrowth: primitive(13), inflationLink: primitive(14), recurrence: primitive(15) } }] } } : {}) };
  return { runContext: context, compiled, openingState, input, months };
}
