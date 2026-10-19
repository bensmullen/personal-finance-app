import { domainId } from "../../../../src/identity/index.js";
import { createAuthoritativeState, type AuthoritativeState } from "../../../../src/state/index.js";
import { civilDate, instant, utcMonthlyPeriods } from "../../../../src/time/index.js";
import { money, USD } from "../../../../src/values/index.js";
import { compileHouseholdKernel } from "../../../../src/simulation/householdExecution.js";
import { createPrimitiveRuntimeStateStore } from "../../../../src/simulation/period.js";
import { createRunContext, runId, scenarioId } from "../../../../src/simulation/run.js";
import type { RetirementCashInput } from "../../../../src/simulation/d2/integration/retirementCash/index.js";
import type { WithdrawalSource } from "../../../../src/simulation/d2/retirement/withdrawals/index.js";
import { rmdObligationId, type RmdRequest, type RmdSource } from "../../../../src/simulation/d2/retirement/distributions/index.js";
import type { AllocationTerms, WithdrawalRmdInput } from "../../../../src/simulation/d2/retirement/withdrawalRmd/index.js";

export const uuid = (n: number) => `149f0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const ids = { household: domainId("household", uuid(1)), person: domainId("person", uuid(2)),
  ira: domainId("account", uuid(3)), bank: domainId("account", uuid(4)), other: domainId("person", uuid(5)) };
export const d = civilDate;
export const source = (resourceId: string, personId: string = ids.person, date = "2026-06-15", label = resourceId): WithdrawalSource => ({
  id: `source:${label}`, resourceId, personId, householdId: ids.household,
  ruleSnapshotId: `synthetic:${label}`, jurisdiction: "US:synthetic", ruleFamily: "synthetic_cash",
  sourcePublication: "Synthetic evidence only; not statutory law", version: "v1", projectionStatus: "verified",
  publishedAt: d("2025-01-01"), asOf: d(date), effectiveFrom: d("2025-01-01"), endExclusive: d("2030-01-01"),
});
export function fixture(months = 1, opening?: AuthoritativeState, month = "2026-06") {
  const start = instant(`${month}-01T00:00:00.000Z`), period = utcMonthlyPeriods(start, 1)[0]!;
  const state = opening ?? createAuthoritativeState({ accounts: {
    [ids.ira]: { id: ids.ira, ownerId: ids.person, kind: "retirement", cash: money("1000") },
    [ids.bank]: { id: ids.bank, ownerId: ids.person, kind: "checking", cash: money("200") },
  } });
  const context = createRunContext({ runId: runId(uuid(6)), scenarioId: scenarioId(uuid(7)),
    asOf: instant(`${month}-28T00:00:00.000Z`), dataCutoff: instant(`${month}-28T00:00:00.000Z`),
    simulationStart: start, simulationEnd: utcMonthlyPeriods(start, months).at(-1)!.end, baseCurrency: USD });
  const kernel = compileHouseholdKernel({ reconciledOpeningState: state, reconciledPrimitiveState: createPrimitiveRuntimeStateStore(),
    scenarioIdentity: context.scenarioId, executionMonths: months, scenarioBindings: { synthetic: "#149 retirement CASH only" } }, start);
  return { kernel, state, context, period };
}
export function input(f = fixture(), label = "one", person: string = ids.person,
  account: string = ids.ira, bank: string = ids.bank): RetirementCashInput {
  const date = `${f.period.start.slice(0, 7)}-15`, s = (id: string, tag = id) => source(id, person, date, `${label}:${tag}`);
  const op = `withdraw:${label}`, auth = `authorize:${label}`, withholding = `withholding:${label}`;
  return { withdrawals: { householdId: ids.household, knownAt: d(date), cash: [{ accountId: account, ownerId: person,
    householdId: ids.household, instrumentFamily: "traditional_ira", taxBucket: "pretax", beneficiaryId: null,
    eligibility: "eligible_ordinary_cash", unsupportedRules: [], eligibilitySource: s(account, "eligibility"),
    liquidity: { kind: "available_unencumbered_account_cash", available: money("1000"), at: d(date), settledAt: d(date),
      contention: "complete_external_reservations", source: s(account, "liquidity") } }],
    requests: [{ operationId: op, withdrawalId: `distribution:${label}`, householdId: ids.household, personId: person,
      sourceAccountId: account, taxBucket: "pretax", kind: "ordinary", effectiveAt: d(date), grossAmount: money("500"), targetObligationIds: [],
      bank: { id: bank, ownerId: person, householdId: ids.household, kind: "checking", source: s(bank, "bank") },
      withholding: { id: withholding, completeness: "verified_complete", source: s(withholding),
        instructions: ["federal", "state"].map(j => ({ id: `${label}:${j}`, jurisdiction: `US:${j}`, amount: money("0"),
          authorizationId: `remit:${label}:${j}`, authorizationSource: { ...s(`remit:${label}:${j}`), jurisdiction: `US:${j}` },
          destinationId: `tax:${j}`, beneficiaryPersonId: person, route: "qualified_tax_payment", source: { ...s(`${label}:${j}`), jurisdiction: `US:${j}` } })) },
      authorization: { id: auth, operationId: op, withdrawalId: `distribution:${label}`, sourceAccountId: account, bankId: bank,
        withholdingId: withholding, grossAmount: money("500"), effectiveAt: d(date), routing: "cash_only_all_or_none", source: s(auth) } }],
    usage: { status: "verified_complete", operationIds: [], withdrawalIds: [], authorizationIds: [], source: source(ids.household, "*", date, "usage") } },
    members: [{ personId: person, source: s(person) }], confirmations: [{ operationId: op, runId: f.context.runId, period: f.period,
      sourceCashBefore: money("1000"), bankCashBefore: money("200"), source: s(account, "cash-confirmation"), bankSource: s(bank, "bank-confirmation"),
      reservations: [], ordering: { after: [], source: s(op) } }] };
}

export function rmdInput(i = input()): WithdrawalRmdInput {
  const w = i.withdrawals.requests[0]!, at = w.effectiveAt;
  const rs = (id: string, accountId: string | null = null): RmdSource => ({ id: `rmd:${id}`, accountId,
    personId: w.personId, publication: "Synthetic only", version: "v1", status: "verified", publishedAt: d("2025-01-01"),
    asOf: at, effectiveFrom: d("1900-01-01"), effectiveUntil: d("2030-01-01") });
  const annual: RmdRequest = { personId: w.personId, birthDate: d("1956-01-01"), personSource: rs("person"), taxYear: 2026,
    accounts: [{ id: w.sourceAccountId, ownerId: w.personId, beneficiaryId: null, family: "traditional_ira", bucket: "pretax",
      source: rs("account", w.sourceAccountId), priorValue: { at: d("2025-12-31"), amount: money("1400"), source: rs("value", w.sourceAccountId) } }],
    rule: { snapshotId: "synthetic:2026", jurisdiction: "US:synthetic", source: rs("rule"), family: "traditional_ira", bucket: "pretax",
      model: "owner_balance_divisor", bornFrom: d("1950-01-01"), bornUntil: d("1960-01-01"), startAge: 70,
      ageConvention: "age_at_year_end", rounding: "half_even", aggregationCalculation: "sum_account_rounded_amounts",
      factors: [{ ruleSnapshotId: "synthetic:2026", age: 70, beneficiaryStatus: "owner_no_spouse", spouseId: null,
        spouseBirthDate: null, divisor: "2", source: rs("factor") }], originalDue: d("2026-12-31"), deferredDue: d("2027-04-01"),
      earliestSatisfaction: d("2026-01-01"), stillWorkingException: "not_permitted" },
    beneficiary: { status: "owner_no_spouse", spouseId: null, spouseBirthDate: null, source: rs("beneficiary") },
    election: "original", electionSource: rs("election"), stillWorking: null, aggregation: null };
  const terms: AllocationTerms = { withdrawalId: w.withdrawalId, authorizationId: w.authorization!.id, allocationId: "allocation:one",
    rmdObligationId: rmdObligationId(annual), householdId: ids.household, personId: w.personId, taxYear: 2026,
    sourceAccountId: w.sourceAccountId, effectiveAt: at, amount: money("500"), ruleSnapshotId: "synthetic:2026" };
  return { withdrawals: { ...i.withdrawals, requests: [{ ...w, targetObligationIds: [terms.rmdObligationId] }] },
    rmd: { currency: USD, asOf: at, knownAt: at, requests: [annual], distributions: [] },
    allocations: [{ ...terms, approval: { id: "approval:one", terms,
      source: source("approval:one", w.personId, at), rmdSource: rs("approval", w.sourceAccountId) } }],
    usage: { status: "verified_complete", allocationIds: [], approvalIds: [], source: source(ids.household, "*", at, "rmd-usage") } };
}
