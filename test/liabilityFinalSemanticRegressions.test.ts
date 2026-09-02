import { describe, expect, it } from "vitest";
import {
  createFundingPolicy,
  fundingConstraintId,
  fundingPolicyId,
  resolveAllOrNothingFunding,
} from "../src/funding/index.js";
import { domainId } from "../src/identity/index.js";
import {
  claimId,
  createObligation,
  createSettlementProposal,
  recognitionId,
  settlementProposalId,
} from "../src/semantics/index.js";
import { createRunContext, runId, scenarioId } from "../src/simulation/run.js";
import { createAuthoritativeState } from "../src/state/index.js";
import { instant, utcMonthlyPeriods } from "../src/time/index.js";
import { Rate, RoundingPolicy, USD, money, rateConvention } from "../src/values/index.js";
import { runVerticalSlice4, type FixedAmortizingLoan, type VerticalSlice4Input } from "../src/verticalSlice4.js";

const owner = domainId("person", "71000000-0000-4000-8000-000000000001");
const household = domainId("household", "71000000-0000-4000-8000-000000000002");
const cash = domainId("account", "71000000-0000-4000-8000-000000000003");
const principal = domainId("liability", "71000000-0000-4000-8000-000000000004");
const interest = domainId("liability", "71000000-0000-4000-8000-000000000005");
const loanId = domainId("loan-contract", "71000000-0000-4000-8000-000000000006");
const primitive = (n: number) => domainId("primitive-instance", `71000000-0000-4000-8000-${n.toString().padStart(12, "0")}`);
const rounding = RoundingPolicy.currency(2, "half_up");
const annual = (value: string) => Rate.fromDecimal(value, rateConvention.nominalAnnual(12));
const policy = () => createFundingPolicy({ id: fundingPolicyId("policy:final-liability-regression"), orderedSources: [{ kind: "cash_account", accountId: cash }], allowPartial: false, insufficientFundsBehavior: "unfunded" });
const opening = (principalAmount = "100", cashAmount = "1000") => createAuthoritativeState({ accounts: { [cash]: { id: cash, ownerId: owner, kind: "checking", cash: money(cashAmount) } }, liabilities: { [principal]: { id: principal, balance: money(principalAmount) }, [interest]: { id: interest, balance: money("0") } } });
const contextAt = (start: ReturnType<typeof instant>, months: number, suffix: number) => { const periods = utcMonthlyPeriods(start, months); return createRunContext({ runId: runId(`72000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`), scenarioId: scenarioId("72000000-0000-4000-8000-000000000999"), asOf: instant("2025-12-31T00:00:00.000Z"), dataCutoff: instant("2025-12-31T00:00:00.000Z"), simulationStart: start, simulationEnd: periods[periods.length - 1]!.end, baseCurrency: USD }); };
const loan = (anchor: ReturnType<typeof instant>, totalPayments: number, extras: FixedAmortizingLoan["extraPrincipalPayments"] = []): FixedAmortizingLoan => ({ id: loanId, ownerId: owner, principalLiabilityId: principal, interestPayableLiabilityId: interest, originalPrincipal: money("100"), annualRate: annual("0"), totalPayments, rateType: "fixed", paymentFrequency: "monthly", interestConvention: "nominal_annual_12", amortization: "fully_amortizing", paymentResetPolicy: "fixed_no_recast", interestCapitalization: "none", partialPaymentPolicy: "all_or_nothing", paymentSchedule: { kind: "utc_monthly", anchor, invalidDayPolicy: "skip" }, fundingPolicy: policy(), settlementPriority: 1, extraPrincipalPayments: extras, postingRounding: rounding, primitiveIds: { schedule: primitive(1), amortization: primitive(2), accrual: primitive(3) } });
const input = (item: FixedAmortizingLoan): VerticalSlice4Input => ({ householdId: household, ownerId: owner, baseCurrency: USD, loans: [item] });

const extra = (n: number, scheduledAt: ReturnType<typeof instant>) => ({ id: domainId("extra-principal-payment", `73000000-0000-4000-8000-${n.toString().padStart(12, "0")}`), scheduledAt, amount: money("1"), fundingPolicy: policy(), primitiveInstanceId: primitive(100 + n) });
const skipScheduleCases = [
  [instant("2026-01-29T00:00:00.000Z"), 24, instant("2028-02-29T00:00:00.000Z")],
  [instant("2026-01-30T00:00:00.000Z"), 24, instant("2028-03-30T00:00:00.000Z")],
  [instant("2026-01-31T00:00:00.000Z"), 24, instant("2029-05-31T00:00:00.000Z")],
] as const;

describe("VS4 finite contractual schedule and resume semantics", () => {
  it.each(skipScheduleCases)("accepts late contractual extras for skip schedules anchored at %s", (anchor, term, scheduledAt) => {
    const item = loan(anchor, term, [extra(term, scheduledAt)]);
    const result = runVerticalSlice4({ runContext: contextAt(instant("2026-01-01T00:00:00.000Z"), 1, term), openingState: opening(), input: input(item) });
    expect(result.status).toBe("completed");
  });

  it("accepts the 360th valid day-31 contractual occurrence rather than using a guessed month bound", () => {
    const anchor = instant("2026-01-31T00:00:00.000Z");
    const item = loan(anchor, 360, [extra(360, instant("2077-05-31T00:00:00.000Z"))]);
    const result = runVerticalSlice4({ runContext: contextAt(instant("2026-01-01T00:00:00.000Z"), 1, 360), openingState: opening(), input: input(item) });
    expect(result.status).toBe("completed");
  });

  it("rejects too little or too much primitive progress relative to the resume boundary", () => {
    const item = loan(instant("2026-01-15T00:00:00.000Z"), 12);
    const january = runVerticalSlice4({ runContext: contextAt(instant("2026-01-01T00:00:00.000Z"), 1, 501), openingState: opening(), input: input(item) });
    expect(january.status).toBe("completed");

    expect(() => runVerticalSlice4({ runContext: contextAt(instant("2026-03-01T00:00:00.000Z"), 1, 502), openingState: january.state, primitiveState: january.primitiveState, input: input(item) })).toThrow(/resume progress must reconcile exactly/);

    const p22 = january.primitiveState[primitive(2)];
    const p24 = january.primitiveState[primitive(3)];
    if (p22?.primitiveId !== "P22" || p24?.primitiveId !== "P24") throw new Error("Expected P22/P24 runtime state after January execution");
    const ahead = {
      ...january.primitiveState,
      [primitive(2)]: { primitiveId: "P22" as const, state: { ...p22.state, evaluations: 2 } },
      [primitive(3)]: { primitiveId: "P24" as const, state: { ...p24.state, evaluations: 2 } },
    };
    expect(() => runVerticalSlice4({ runContext: contextAt(instant("2026-02-01T00:00:00.000Z"), 1, 503), openingState: january.state, primitiveState: ahead, input: input(item) })).toThrow(/resume progress must reconcile exactly/);
  });

  it("counts skipped February correctly when resuming a day-31 schedule", () => {
    const item = loan(instant("2026-01-31T00:00:00.000Z"), 12);
    const january = runVerticalSlice4({ runContext: contextAt(instant("2026-01-01T00:00:00.000Z"), 1, 511), openingState: opening(), input: input(item) });
    const march = runVerticalSlice4({ runContext: contextAt(instant("2026-03-01T00:00:00.000Z"), 1, 512), openingState: january.state, primitiveState: january.primitiveState, input: input(item) });
    expect(march.status).toBe("completed");
    expect(march.primitiveState[primitive(2)]?.state).toMatchObject({ evaluations: 2 });
  });
});

describe("aggregate all-or-nothing funding invariants", () => {
  const at = instant("2026-01-15T00:00:00.000Z");
  const funding = policy();
  const makeClaim = (n: number, amount = "50") => createObligation({ id: claimId(`claim:aggregate:${n}`), category: "test_due", originatingRecognitionId: recognitionId(`recognition:aggregate:${n}`), economicOwnerId: owner, originalAmount: money(amount), outstandingAmount: money(amount), recognizedAt: at }, []);
  const makeProposal = (n: number, claim: ReturnType<typeof makeClaim>, amount = "50") => createSettlementProposal({ id: settlementProposalId(`proposal:aggregate:${n}`), claimId: claim.id, requestedAmount: money(amount), requestedAt: at, fundingPolicyId: funding.id }, claim);

  it("rejects group evaluation before any participating proposal exists", () => {
    const claim = makeClaim(1);
    const proposal = makeProposal(1, claim);
    expect(() => resolveAllOrNothingFunding(fundingConstraintId("constraint:before-proposal"), [{ proposal, claim }], funding, { [cash]: money("100") }, instant("2026-01-14T00:00:00.000Z"))).toThrow(/cannot be evaluated before the proposal/);
  });

  it("rejects multiple proposals for the same claim", () => {
    const claim = makeClaim(2, "100");
    const first = makeProposal(2, claim, "50");
    const second = makeProposal(3, claim, "50");
    expect(() => resolveAllOrNothingFunding(fundingConstraintId("constraint:duplicate-claim"), [{ proposal: first, claim }, { proposal: second, claim }], funding, { [cash]: money("100") }, at)).toThrow(/unique authoritative proposals and claims/);
  });

  it("still resolves a valid multi-claim group atomically", () => {
    const firstClaim = makeClaim(4, "40");
    const secondClaim = makeClaim(5, "60");
    const result = resolveAllOrNothingFunding(fundingConstraintId("constraint:valid-group"), [{ proposal: makeProposal(4, firstClaim, "40"), claim: firstClaim }, { proposal: makeProposal(5, secondClaim, "60"), claim: secondClaim }], funding, { [cash]: money("100") }, at);
    expect(result.outcome.status).toBe("fully_satisfied");
    expect(result.outcome.acceptedAmount.equals(money("100"))).toBe(true);
    expect(result.outcome.claimIds).toEqual([firstClaim.id, secondClaim.id]);
  });
});