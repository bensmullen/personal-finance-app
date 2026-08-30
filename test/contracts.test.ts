import { describe, expect, expectTypeOf, it } from "vitest";
import {
  accountingTransactionId,
  cashFlowClasses,
  createAccountingLeg,
  createAccountingTransaction,
  summarizeCashFlowClass,
  type AccountingLegDraft,
  type AssetLegDraft,
  type LiabilityLegDraft,
  type PositionId,
  type LiabilityId,
} from "../src/accounting.js";
import { ValidationError, issueCodes } from "../src/diagnostics.js";
import {
  createFundingPolicy,
  fundingPolicyId,
  isAcceptedFundingResolution,
  resolveFunding,
  type ConstraintOutcomeStatus,
  type FundingResolution,
} from "../src/funding.js";
import { domainId, generatedOccurrenceKey } from "../src/identity.js";
import { createFactProvenance } from "../src/provenance.js";
import { calculationTraceId, calculationTraceRef } from "../src/lineage.js";
import {
  applySettlement,
  claimId,
  claimStatus,
  createObligation,
  createRecognitionFact,
  createSemanticEffect,
  createSettlement,
  createSettlementProposal,
  recognitionId,
  semanticEffectId,
  settlementId,
  settlementProposalId,
} from "../src/semantics.js";
import { instant } from "../src/time.js";
import { Currency, money } from "../src/values.js";

const OWNER = domainId("person", "11111111-1111-4111-8111-111111111111");
const CASH_A = domainId("account", "22222222-2222-4222-8222-222222222222");
const CASH_B = domainId("account", "33333333-3333-4333-8333-333333333333");
const LIABILITY = domainId("liability", "44444444-4444-4444-8444-444444444444");
const RECOGNIZED_AT = instant("2026-01-31T12:00:00.000Z");
const REQUESTED_AT = instant("2026-02-15T12:00:00.000Z");

const validationCode = (operation: () => unknown): string => {
  try {
    operation();
  } catch (error) {
    if (error instanceof ValidationError) return error.issues[0]!.code;
    throw error;
  }
  throw new Error("Expected ValidationError");
};

const recognition = () => createRecognitionFact({
  id: recognitionId("recognition:tax:2026-01"),
  category: "tax_expense",
  amount: money("2000"),
  recognizedAt: RECOGNIZED_AT,
  traceRefs: [calculationTraceRef(calculationTraceId("trace:tax:2026-01"))],
});

const obligation = () => {
  const fact = recognition();
  return createObligation({
    id: claimId(`obligation:${fact.id}`),
    category: "tax_payable",
    originatingRecognitionId: fact.id,
    economicOwnerId: OWNER,
    balanceEntityId: LIABILITY,
    originalAmount: fact.amount,
    recognizedAt: fact.recognizedAt,
  });
};

const proposal = (amount = "2000") => {
  const claim = obligation();
  return { claim, proposal: createSettlementProposal({
    id: settlementProposalId(`proposal:${amount}`),
    claimId: claim.id,
    requestedAmount: money(amount),
    requestedAt: REQUESTED_AT,
  }, claim) };
};

const cashPolicy = (
  allowPartial: boolean,
  sources = [CASH_A, CASH_B],
  insufficientFundsBehavior: "unfunded" | "deferred" | "contract_default" = "unfunded",
) => createFundingPolicy({
  id: fundingPolicyId(`funding:${allowPartial}:${insufficientFundsBehavior}:${sources.join(":")}`),
  orderedSources: sources.map((accountId) => ({ kind: "cash_account" as const, accountId })),
  allowPartial,
  insufficientFundsBehavior,
});

const acceptedFunding = (candidate: ReturnType<typeof proposal>, amount: string) => {
  const funding = resolveFunding(candidate.proposal, candidate.claim, cashPolicy(false, [CASH_A]), {
    [CASH_A]: money(amount),
  });
  if (!isAcceptedFundingResolution(funding)) throw new Error("Expected accepted funding");
  return funding;
};

describe("shared accounting authority", () => {
  it("uses narrow semantic identities for cash, asset, and liability targets", () => {
    expectTypeOf<Extract<AccountingLegDraft, { type: "cash" }>["accountId"]>().toEqualTypeOf<typeof CASH_A>();
    expectTypeOf<AssetLegDraft["entityId"]>().toEqualTypeOf<PositionId>();
    expectTypeOf<LiabilityLegDraft["entityId"]>().toEqualTypeOf<LiabilityId>();
  });
  it("creates frozen balanced transactions and derives cash-flow class from cash legs", () => {
    const transaction = createAccountingTransaction({
      id: accountingTransactionId("tx:salary"),
      type: "salary",
      date: RECOGNIZED_AT,
      legs: [
        createAccountingLeg({ posting: "debit", type: "cash", amount: money("1000"), accountId: CASH_A, cashFlowClass: "operating" }),
        createAccountingLeg({ posting: "credit", type: "income", amount: money("1000") }),
      ],
    });
    expect(Object.isFrozen(transaction)).toBe(true);
    expect(Object.isFrozen(transaction.legs[0])).toBe(true);
    expect(cashFlowClasses(transaction)).toEqual(["operating"]);
    expect(summarizeCashFlowClass(transaction)).toBe("operating");
  });

  it("rejects unbalanced, negative, over-precision, and missing-target drafts with stable issues", () => {
    expect(validationCode(() => createAccountingTransaction({
      id: accountingTransactionId("tx:bad-balance"), type: "bad", date: RECOGNIZED_AT,
      legs: [
        createAccountingLeg({ posting: "debit", type: "expense", amount: money("10") }),
        createAccountingLeg({ posting: "credit", type: "income", amount: money("9") }),
      ],
    }))).toBe(issueCodes.accountingUnbalanced);
    expect(validationCode(() => createAccountingLeg({ posting: "debit", type: "expense", amount: money("-1") }))).toBe(issueCodes.accountingNegativeLegAmount);
    expect(validationCode(() => createAccountingTransaction({
      id: accountingTransactionId("tx:precision"), type: "bad", date: RECOGNIZED_AT,
      legs: [
        createAccountingLeg({ posting: "debit", type: "expense", amount: money("1.001") }),
        createAccountingLeg({ posting: "credit", type: "income", amount: money("1.001") }),
      ],
    }))).toBe(issueCodes.accountingPrecisionInvalid);
    expect(validationCode(() => createAccountingLeg({ posting: "debit", type: "cash", amount: money("1"), cashFlowClass: "operating" } as unknown as AccountingLegDraft))).toBe(issueCodes.accountingTargetMissing);
    expect(validationCode(() => createAccountingLeg({ posting: "debit", type: "liability", amount: money("1") } as unknown as AccountingLegDraft))).toBe(issueCodes.accountingTargetMissing);
    expect(validationCode(() => createAccountingLeg({ posting: "debit", type: "asset", amount: money("1") } as unknown as AccountingLegDraft))).toBe(issueCodes.accountingTargetMissing);
  });

  it("balances every currency group independently", () => {
    const eur = Currency.of("EUR");
    const transaction = createAccountingTransaction({
      id: accountingTransactionId("tx:multi-currency"), type: "multi_currency", date: RECOGNIZED_AT,
      legs: [
        createAccountingLeg({ posting: "debit", type: "expense", amount: money("10") }),
        createAccountingLeg({ posting: "credit", type: "income", amount: money("10") }),
        createAccountingLeg({ posting: "debit", type: "expense", amount: money("20", eur) }),
        createAccountingLeg({ posting: "credit", type: "income", amount: money("20", eur) }),
      ],
    });
    expect(transaction.legs).toHaveLength(4);
    expect(validationCode(() => createAccountingTransaction({
      id: accountingTransactionId("tx:multi-currency-bad"), type: "multi_currency", date: RECOGNIZED_AT,
      legs: [
        createAccountingLeg({ posting: "debit", type: "expense", amount: money("10") }),
        createAccountingLeg({ posting: "credit", type: "income", amount: money("9") }),
        createAccountingLeg({ posting: "debit", type: "expense", amount: money("20", eur) }),
        createAccountingLeg({ posting: "credit", type: "income", amount: money("21", eur) }),
      ],
    }))).toBe(issueCodes.accountingUnbalanced);
  });

  it("classifies household transfers as non-cash and keeps mixed as presentation-only", () => {
    const transfer = createAccountingTransaction({
      id: accountingTransactionId("tx:transfer"), type: "internal_transfer", date: RECOGNIZED_AT,
      legs: [
        createAccountingLeg({ posting: "debit", type: "cash", amount: money("500"), accountId: CASH_B, cashFlowClass: "non_cash" }),
        createAccountingLeg({ posting: "credit", type: "cash", amount: money("500"), accountId: CASH_A, cashFlowClass: "non_cash" }),
      ],
    });
    expect(summarizeCashFlowClass(transfer)).toBe("non_cash");
    const mixed = createAccountingTransaction({
      id: accountingTransactionId("tx:mixed"), type: "mixed_payment", date: RECOGNIZED_AT,
      legs: [
        createAccountingLeg({ posting: "debit", type: "cash", amount: money("100"), accountId: CASH_A, cashFlowClass: "operating" }),
        createAccountingLeg({ posting: "credit", type: "cash", amount: money("100"), accountId: CASH_B, cashFlowClass: "financing" }),
      ],
    });
    expect(summarizeCashFlowClass(mixed)).toBe("mixed");
  });
});

describe("semantic provenance authority", () => {
  const occurrence = generatedOccurrenceKey({
    scenarioId: domainId("scenario", "55555555-5555-4555-8555-555555555555"),
    primitiveInstanceId: domainId("primitive-instance", "66666666-6666-4666-8666-666666666666"),
    scheduledAt: RECOGNIZED_AT,
    semanticEffectType: "recognition",
    economicTargetId: OWNER,
  });
  const otherOccurrence = generatedOccurrenceKey({
    scenarioId: domainId("scenario", "55555555-5555-4555-8555-555555555555"),
    primitiveInstanceId: domainId("primitive-instance", "77777777-7777-4777-8777-777777777777"),
    scheduledAt: RECOGNIZED_AT,
    semanticEffectType: "recognition",
    economicTargetId: OWNER,
  });
  const provenance = createFactProvenance({ factKind: "model_generated", sourceType: "model", sourceId: "primitive:test", effectiveAt: RECOGNIZED_AT, generatedOccurrenceKey: occurrence });

  it("normalizes matching generated occurrence identity through semantic factories", () => {
    const fact = createRecognitionFact({ id: recognitionId("recognition:provenance"), category: "test", amount: money("1"), recognizedAt: RECOGNIZED_AT, sourceOccurrenceKey: occurrence, provenance });
    const effect = createSemanticEffect({ id: semanticEffectId("effect:provenance"), kind: "recognition", category: "test", sourceOccurrenceKey: occurrence, provenance });
    expect(fact.sourceOccurrenceKey).toBe(occurrence);
    expect(effect.sourceOccurrenceKey).toBe(occurrence);
    expect(effect.provenance).toEqual(provenance);
  });

  it("rejects malformed supplied provenance and contradictory occurrence keys", () => {
    expect(validationCode(() => createRecognitionFact({ id: recognitionId("recognition:bad-provenance"), category: "test", amount: money("1"), recognizedAt: RECOGNIZED_AT, provenance: { factKind: "authoritative_input", sourceType: "model", sourceId: "bad", effectiveAt: RECOGNIZED_AT } as never }))).toBe(issueCodes.invalidProvenance);
    expect(validationCode(() => createRecognitionFact({ id: recognitionId("recognition:bad-occurrence"), category: "test", amount: money("1"), recognizedAt: RECOGNIZED_AT, sourceOccurrenceKey: otherOccurrence, provenance }))).toBe(issueCodes.invalidProvenance);
  });
});

describe("shared recognition, claim, and settlement lifecycle", () => {
  it("creates a valid obligation and derives lifecycle status without mutable status", () => {
    const claim = obligation();
    expect(claimStatus(claim)).toBe("outstanding");
    expect("status" in claim).toBe(false);
    expect(Object.isFrozen(claim)).toBe(true);
  });

  it("applies full and explicitly requested partial settlements immutably", () => {
    const full = proposal();
    const settled = createSettlement({
      id: settlementId("settlement:full"), settledAt: REQUESTED_AT,
    }, acceptedFunding(full, "2000"), full.claim);
    expect(claimStatus(applySettlement(full.claim, settled))).toBe("settled");
    expect(claimStatus(full.claim)).toBe("outstanding");

    const partial = proposal("500");
    const partialSettlement = createSettlement({
      id: settlementId("settlement:partial"), settledAt: REQUESTED_AT,
    }, acceptedFunding(partial, "500"), partial.claim);
    expect(claimStatus(applySettlement(partial.claim, partialSettlement))).toBe("partially_settled");
  });

  it("rejects invalid proposals and duplicate stable identities", () => {
    const claim = obligation();
    expect(validationCode(() => createSettlementProposal({ id: settlementProposalId("proposal:over"), claimId: claim.id, requestedAmount: money("2000.01"), requestedAt: REQUESTED_AT }, claim))).toBe(issueCodes.settlementExceedsOutstanding);
    for (const amount of ["0", "-1"]) {
      expect(validationCode(() => createSettlementProposal({ id: settlementProposalId(`proposal:${amount}`), claimId: claim.id, requestedAmount: money(amount), requestedAt: REQUESTED_AT }, claim))).toBe(issueCodes.settlementAmountInvalid);
    }
    expect(validationCode(() => createSettlementProposal({ id: settlementProposalId("proposal:eur"), claimId: claim.id, requestedAmount: money("1", Currency.of("EUR")), requestedAt: REQUESTED_AT }, claim))).toBe(issueCodes.settlementCurrencyMismatch);
    expect(validationCode(() => createSettlementProposal({ id: settlementProposalId("proposal:early"), claimId: claim.id, requestedAmount: money("1"), requestedAt: instant("2025-12-31T00:00:00.000Z") }, claim))).toBe(issueCodes.settlementBeforeRecognition);
    expect(validationCode(() => createRecognitionFact(recognition(), [recognition().id]))).toBe(issueCodes.duplicateRecognition);
    expect(validationCode(() => createObligation({ ...claim, settlementIds: undefined } as never, [claim]))).toBe(issueCodes.duplicateRecognition);

    const partial = proposal("500");
    const draft = {
      id: settlementId("settlement:duplicate"), settledAt: REQUESTED_AT,
    };
    const funding = acceptedFunding(partial, "500");
    createSettlement(draft, funding, partial.claim);
    expect(validationCode(() => createSettlement(draft, funding, partial.claim, [draft.id]))).toBe(issueCodes.duplicateSettlement);
  });

  it("derives settlement economics only from accepted funding authority", () => {
    const candidate = proposal("500");
    const funding = acceptedFunding(candidate, "500");
    const callerDraft = {
      id: settlementId("settlement:derived"),
      settledAt: REQUESTED_AT,
      amount: money("1"),
      fundingAllocations: [{ kind: "cash_account" as const, accountId: CASH_B, amount: money("1") }],
    };
    const settlement = createSettlement(callerDraft, funding, candidate.claim);
    expect(settlement.amount.equals(money("500"))).toBe(true);
    expect(settlement.fundingAllocations).toEqual(funding.fundingAllocations);
    expect(settlement.proposalId).toBe(candidate.proposal.id);
    expect(settlement.claimId).toBe(candidate.claim.id);
  });

  it("rejects a spread-cloned authoritative proposal", () => {
    const candidate = proposal("500");
    const clonedProposal = { ...candidate.proposal };
    const beforeClaim = JSON.stringify(candidate.claim);
    expect(validationCode(() => resolveFunding(
      clonedProposal,
      candidate.claim,
      cashPolicy(false, [CASH_A]),
      { [CASH_A]: money("500") },
    ))).toBe(issueCodes.settlementProposalNotAuthoritative);
    expect(JSON.stringify(candidate.claim)).toBe(beforeClaim);
  });

  it("rejects a coherently altered spread clone of accepted funding", () => {
    const candidate = proposal();
    const funding = resolveFunding(candidate.proposal, candidate.claim, cashPolicy(true, [CASH_A]), {
      [CASH_A]: money("500"),
    });
    if (!isAcceptedFundingResolution(funding)) throw new Error("Expected accepted funding");
    const alteredAmount = money("2000");
    const clonedFunding = {
      ...funding,
      acceptedAmount: alteredAmount,
      outcome: Object.freeze({ ...funding.outcome, status: "fully_satisfied" as const, acceptedAmount: alteredAmount }),
      fundingAllocations: Object.freeze([{ kind: "cash_account" as const, accountId: CASH_A, amount: alteredAmount }]),
    };
    expect(validationCode(() => createSettlement({
      id: settlementId("settlement:cloned-funding"),
      settledAt: REQUESTED_AT,
    }, clonedFunding, candidate.claim))).toBe(issueCodes.fundingNotAuthoritative);
  });

  it("rejects a spread-cloned settlement while the exact settlement still applies", () => {
    const candidate = proposal("500");
    const settlement = createSettlement({
      id: settlementId("settlement:clone-test"),
      settledAt: REQUESTED_AT,
    }, acceptedFunding(candidate, "500"), candidate.claim);
    const clonedSettlement = { ...settlement, amount: money("100") };
    const beforeClaim = JSON.stringify(candidate.claim);
    expect(validationCode(() => applySettlement(candidate.claim, clonedSettlement))).toBe(issueCodes.settlementNotAuthoritative);
    expect(JSON.stringify(candidate.claim)).toBe(beforeClaim);
    expect(claimStatus(applySettlement(candidate.claim, settlement))).toBe("partially_settled");
  });

  it("cannot construct a settlement from unfunded, deferred, default, or zero funding", () => {
    for (const behavior of ["unfunded", "deferred", "contract_default"] as const) {
      const candidate = proposal();
      const funding = resolveFunding(candidate.proposal, candidate.claim, cashPolicy(false, [CASH_A], behavior), {
        [CASH_A]: money("0"),
      });
      expect(funding.outcome.status).toBe(behavior);
      expect(funding.acceptedAmount.isZero()).toBe(true);
      expect(isAcceptedFundingResolution(funding)).toBe(false);
      expect(validationCode(() => createSettlement({
        id: settlementId(`settlement:${behavior}`),
        settledAt: REQUESTED_AT,
      }, funding as never, candidate.claim))).toBe(issueCodes.fundingNotAuthoritative);
    }
  });

  it("uses the exact partial acceptance and enforces proposal, funding, and claim bounds", () => {
    const candidate = proposal();
    const funding = resolveFunding(candidate.proposal, candidate.claim, cashPolicy(true, [CASH_A]), {
      [CASH_A]: money("500"),
    });
    if (!isAcceptedFundingResolution(funding)) throw new Error("Expected partial acceptance");
    const settlement = createSettlement({ id: settlementId("settlement:exact-partial"), settledAt: REQUESTED_AT }, funding, candidate.claim);
    expect(settlement.amount.equals(money("500"))).toBe(true);
    expect(claimStatus(applySettlement(candidate.claim, settlement))).toBe("partially_settled");

    const reducedClaim = applySettlement(candidate.claim, settlement);
    expect(validationCode(() => createSettlement({
      id: settlementId("settlement:stale-funding"),
      settledAt: REQUESTED_AT,
    }, acceptedFunding(candidate, "2000"), reducedClaim))).toBe(issueCodes.settlementExceedsOutstanding);
  });

  it("rejects funding before proposal time and settlements before proposal or evaluation time", () => {
    const candidate = proposal("500");
    expect(validationCode(() => resolveFunding(
      candidate.proposal,
      candidate.claim,
      cashPolicy(false, [CASH_A]),
      { [CASH_A]: money("500") },
      instant("2026-02-14T12:00:00.000Z"),
    ))).toBe(issueCodes.fundingBeforeProposal);

    const atRequest = acceptedFunding(candidate, "500");
    expect(validationCode(() => createSettlement({
      id: settlementId("settlement:before-proposal"),
      settledAt: instant("2026-02-14T12:00:00.000Z"),
    }, atRequest, candidate.claim))).toBe(issueCodes.settlementBeforeProposal);

    const evaluatedLater = resolveFunding(
      candidate.proposal,
      candidate.claim,
      cashPolicy(false, [CASH_A]),
      { [CASH_A]: money("500") },
      instant("2026-02-16T12:00:00.000Z"),
    );
    if (!isAcceptedFundingResolution(evaluatedLater)) throw new Error("Expected accepted funding");
    expect(validationCode(() => createSettlement({
      id: settlementId("settlement:before-funding"),
      settledAt: REQUESTED_AT,
    }, evaluatedLater, candidate.claim))).toBe(issueCodes.settlementBeforeFunding);
  });
});

describe("pure explicit cash-account funding", () => {
  const policy = (allowPartial: boolean, sources = [CASH_A, CASH_B]) => cashPolicy(allowPartial, sources);

  it("fully funds one or several explicitly ordered sources", () => {
    const full = proposal();
    const single = resolveFunding(full.proposal, full.claim, policy(false, [CASH_A]), { [CASH_A]: money("2500") });
    expect(single.outcome.status).toBe("fully_satisfied");
    expect(single.acceptedAmount.equals(money("2000"))).toBe(true);
    const multiple = resolveFunding(full.proposal, full.claim, policy(false), { [CASH_A]: money("500"), [CASH_B]: money("1500") });
    expect(multiple.outcome.status).toBe("fully_satisfied");
    expect(multiple.fundingAllocations.map((allocation) => [allocation.accountId, allocation.amount.amount.toString()])).toEqual([[CASH_A, "500"], [CASH_B, "1500"]]);
  });

  it("does not infer undeclared fallbacks and accepts zero when partial funding is forbidden", () => {
    const full = proposal();
    const result = resolveFunding(full.proposal, full.claim, policy(false, [CASH_A]), { [CASH_A]: money("500"), [CASH_B]: money("5000") });
    expect(result.outcome.status).toBe("unfunded");
    expect(result.acceptedAmount.isZero()).toBe(true);
    expect(result.fundingAllocations).toHaveLength(0);
    expect(result.liquidityShortfall?.fundedAmount.equals(money("500"))).toBe(true);
    expect(result.liquidityShortfall?.shortfallAmount.equals(money("1500"))).toBe(true);
    expect(result.issues[0]).toMatchObject({ severity: "warning", code: issueCodes.liquidityShortfall });
  });

  it("accepts available liquidity only when explicit partial funding is allowed", () => {
    const full = proposal();
    const result = resolveFunding(full.proposal, full.claim, policy(true, [CASH_A]), { [CASH_A]: money("500") });
    expect(result.outcome.status).toBe("partially_satisfied");
    expect(result.acceptedAmount.equals(money("500"))).toBe(true);
    expect(result.liquidityShortfall?.shortfallAmount.equals(money("1500"))).toBe(true);
  });

  it("models zero liquidity, rejects currency mismatch, and does not mutate inputs", () => {
    const full = proposal();
    const balances = { [CASH_A]: money("0") };
    const beforeBalances = JSON.stringify(balances);
    const beforeClaim = JSON.stringify(full.claim);
    const result = resolveFunding(full.proposal, full.claim, policy(true, [CASH_A]), balances);
    expect(result.outcome.status).toBe("unfunded");
    expect(result.liquidityShortfall?.fundedAmount.isZero()).toBe(true);
    expect(JSON.stringify(balances)).toBe(beforeBalances);
    expect(JSON.stringify(full.claim)).toBe(beforeClaim);
    expect(validationCode(() => resolveFunding(full.proposal, full.claim, policy(false, [CASH_A]), { [CASH_A]: money("2000", Currency.of("EUR")) }))).toBe(issueCodes.fundingCurrencyMismatch);
    expect(validationCode(() => resolveFunding(full.proposal, full.claim, policy(false, [CASH_A]), {}))).toBe(issueCodes.fundingSourceNotFound);
  });

  it("exposes exact shared statuses while the generic cash resolver excludes rejected", () => {
    expectTypeOf<ConstraintOutcomeStatus>().toEqualTypeOf<
      "fully_satisfied" | "partially_satisfied" | "deferred" | "unfunded" | "rejected" | "contract_default"
    >();
    expectTypeOf<FundingResolution["outcome"]["status"]>().toEqualTypeOf<
      "fully_satisfied" | "partially_satisfied" | "deferred" | "unfunded" | "contract_default"
    >();
  });

  it.each(["deferred", "contract_default"] as const)("returns exact %s status for an unfunded policy", (behavior) => {
    const candidate = proposal();
    const result = resolveFunding(candidate.proposal, candidate.claim, cashPolicy(false, [CASH_A], behavior), {
      [CASH_A]: money("0"),
    });
    expect(result.outcome.status).toBe(behavior);
    expect(result.acceptedAmount.isZero()).toBe(true);
  });
});
