import { describe, expect, it } from "vitest";
import { createFundingPolicy, fundingPolicyId, isAcceptedFundingResolution, resolveFunding } from "../src/funding/index.js";
import { domainId } from "../src/identity/index.js";
import { createRecognitionFact } from "../src/semantics/recognition.js";
import { createObligation, createRight } from "../src/semantics/claim.js";
import { claimId, recognitionId, settlementId, settlementProposalId } from "../src/semantics/identity.js";
import { createSettlementProposal } from "../src/semantics/settlementProposal.js";
import {
  applySettlement, createSettlement, createSsaBenefitDeductionSettlement, createZeroMedicareCoverageEvidence,
  type MedicarePremiumEvidence, type SsaCommittedConsumption, type SsaDeductionReceipt,
  type SsaDeductionRequest, type SsaDeductionSource, type SsaPayableEvidence,
} from "../src/semantics/settlement.js";
import { civilDate, instant } from "../src/time/index.js";
import { Currency, money } from "../src/values/index.js";

// Synthetic source attestations only; these constants assert no SSA/CMS rules.
const owner = domainId("person", "11111111-1111-4111-8111-111111111111");
const otherOwner = domainId("person", "22222222-2222-4222-8222-222222222222");
const at = instant("2026-06-15T12:00:00.000Z");
const recognizedAt = instant("2026-06-01T00:00:00.000Z");
const known = instant("2026-05-01T00:00:00.000Z");
const start = civilDate("2026-06-01"), end = civilDate("2026-07-01");
const source = (scopeId: string, ruleFamily: string): SsaDeductionSource => ({
  scopeId, ruleFamily, ruleSnapshotId: `synthetic:${scopeId}`, version: "synthetic-v1",
  sourcePublication: "synthetic verified record", jurisdiction: "US", status: "verified",
  effectiveStart: start, effectiveEndExclusive: end, asOf: known, publishedAt: known, knownAt: known,
});
const payable = (): SsaPayableEvidence => {
  const id = claimId(JSON.stringify(["d2-quoted-benefit/v1", "household", "entitlement", owner, "2026-06-15"]));
  return { kind: "coordinated_ssa_payable", benefitKind: "ss_retirement", eligibility: "eligible",
    householdId: "household", recipientId: owner, workerRecordId: "worker", awardId: "coordinated-award",
    entitlementId: "entitlement", paymentId: id, rightClaimId: id, rightRecognitionId: "gross-recognition",
    paymentAt: at, grossPayable: money("1500"), source: source(id, "ssa_coordinated_payable") };
};
const makeRight = (p = payable(), outstanding = p.grossPayable, settlements: readonly SsaDeductionReceipt[] = []) => {
  const fact = createRecognitionFact({ id: recognitionId(p.rightRecognitionId), category: "ssa_gross_income",
    amount: p.grossPayable, recognizedAt });
  return createRight({ id: p.rightClaimId, originatingRecognitionId: fact.id, category: "ssa_benefit_payable",
    economicOwnerId: owner, originalAmount: fact.amount, outstandingAmount: outstanding,
    recognizedAt, dueAt: at, settlementIds: settlements.map(r => r.settlement.id) });
};
const premium = (part: MedicarePremiumEvidence["part"], amount: string): MedicarePremiumEvidence => ({
  evidenceId: `premium:${part}`, householdId: "household", beneficiaryId: owner, part,
  coverageId: `coverage:${part}`, providerId: `provider:${part}`, periodStart: start, periodEndExclusive: end,
  status: "complete", base: money(amount), irmaa: money("0"), source: source(`premium:${part}`, "medicare_premium"),
});
const request = (part: MedicarePremiumEvidence["part"], amount: string, p = payable()): SsaDeductionRequest => {
  const id = claimId(JSON.stringify(["medicare", "household", owner, part, start]));
  const fact = createRecognitionFact({ id: recognitionId(`recognition:${part}`), category: "medicare_expense",
    amount: money(amount), recognizedAt });
  const claim = createObligation({ id, originatingRecognitionId: fact.id, category: "medicare_premium",
    economicOwnerId: owner, originalAmount: fact.amount, recognizedAt, dueAt: at });
  return { draft: { id: settlementId(`settlement:${part}`), settledAt: at }, claim,
    terms: { authorizationId: `authorization:${part}`, receiptId: `receipt:${part}`, traceId: `trace:${part}`,
      route: "ssa_payable_deduction", payable: p, premium: premium(part, amount), premiumScope: {
        evidenceId: `premium:${part}`, householdId: "household", beneficiaryId: owner, part,
        coverageId: `coverage:${part}`, providerId: `provider:${part}`, periodStart: start, periodEndExclusive: end,
      }, obligationId: claim.id,
      obligationRecognitionId: claim.originatingRecognitionId, amount: money(amount), partialDeduction: "forbidden",
      source: source(`authorization:${part}`, "ssa_medicare_deduction") } };
};
const committed = (p = payable(), receipts: readonly SsaDeductionReceipt[] = []): SsaCommittedConsumption => ({
  stateId: "verified-state-version", complete: true, paymentId: p.paymentId, asOf: at,
  committedReceiptIds: receipts.map(r => r.terms.receiptId), receipts,
  source: source("verified-state-version", "ssa_committed_consumption"),
});
const group = (requests: readonly SsaDeductionRequest[], p = payable(), state = committed(p), right = makeRight(p), ids: readonly string[] = []) =>
  createSsaBenefitDeductionSettlement(p, right, requests, state, ids);

describe("conditional SSA payable deduction authority", () => {
  it("authorizes 8000 + 12000 cents from 150000 cents with no cash or postings", () => {
    const b = request("part_b", "80"), d = request("part_d", "120"), right = makeRight();
    const result = group([d, b], payable(), committed(), right);
    expect(result.deductionAmount.equals(money("200"))).toBe(true);
    expect(result.conditionalNetPayable.equals(money("1300"))).toBe(true);
    expect(result.committed).toBe(false);
    expect(result.receipts.map(r => r.terms.premium.part)).toEqual(["part_b", "part_d"]);
    for (const [index, candidate] of [b, d].entries()) {
      const receipt = result.receipts[index]!;
      expect(receipt.kind).toBe("ssa_payable_deduction");
      expect(receipt.settlement.fundingAllocations).toEqual([]);
      expect(receipt.terms.amount.equals(candidate.claim.originalAmount)).toBe(true);
      expect(applySettlement(candidate.claim, receipt.settlement).outstandingAmount.isZero()).toBe(true);
      expect(candidate.claim.outstandingAmount.equals(candidate.claim.originalAmount)).toBe(true);
      expect(receipt.sourceState.committedReceiptIds).toEqual([]);
      expect(receipt).not.toHaveProperty("transaction");
    }
    expect(right.outstandingAmount.equals(money("1500"))).toBe(true);
  });

  it("is immutable and deterministic under input reversal and pure replay", () => {
    const b = request("part_b", "80"), d = request("part_d", "120");
    const forward = group([b, d]);
    expect(group([d, b])).toEqual(forward);
    expect(group([b, d])).toEqual(forward);
    const receipt = forward.receipts[0]!;
    for (const value of [forward, forward.receipts, receipt, receipt.settlement, receipt.settlement.fundingAllocations,
      receipt.payable, receipt.payable.source, receipt.terms, receipt.terms.premium, receipt.sourceState,
      receipt.sourceState.committedReceiptIds]) expect(Object.isFrozen(value)).toBe(true);
    expect(Reflect.set(b.terms.premium.source, "version", "changed-input")).toBe(true);
    expect(receipt.terms.premium.source.version).toBe("synthetic-v1");
    expect(() => applySettlement(b.claim, { ...receipt.settlement })).toThrow();
    const settled = applySettlement(b.claim, receipt.settlement);
    expect(() => applySettlement(settled, receipt.settlement)).toThrow();
    expect(() => applySettlement({ ...b.claim, category: "unrelated_expense" }, receipt.settlement)).toThrow();
  });

  it("matches full base plus IRMAA and canonicalizes committed inventory order", () => {
    const b = request("part_b", "80"), d = request("part_d", "120");
    const withIrmaa = { ...b, terms: { ...b.terms, premium: { ...b.terms.premium,
      base: money("50"), irmaa: money("30") } } };
    const first = group([withIrmaa, d]), p = payable();
    const right = makeRight(p, money("1300"), first.receipts), a = request("part_a", "10");
    const forward = group([a], p, committed(p, first.receipts), right);
    expect(group([a], p, committed(p, [...first.receipts].reverse()), right)).toEqual(forward);
    expect(forward.conditionalNetPayable.equals(money("1290"))).toBe(true);
    const revised = { ...p, source: { ...p.source, version: "competing-version" } };
    expect(() => group([a], revised, committed(revised, first.receipts), right)).toThrow();
  });

  it("uses actual committed receipt identities and rejects repeated $200, competing versions and missing inventory", () => {
    const p = payable(), b = request("part_b", "200", p);
    const first = group([b], p);
    // Synthetic authoritative-state import, not an assertion of an actual commit.
    const state = committed(p, first.receipts), right = makeRight(p, money("1300"), first.receipts);
    const d = request("part_d", "120", p);
    const next = group([d], p, state, right, first.receipts.map(r => r.settlement.id));
    expect(next.deductionAmount.equals(money("120"))).toBe(true);
    expect(next.conditionalNetPayable.equals(money("1180"))).toBe(true);
    expect(() => group([b], p, state, right)).toThrow();
    const competing = { ...b, draft: { ...b.draft, id: settlementId("competing") }, terms: {
      ...b.terms, authorizationId: "revision", source: source("revision", "ssa_medicare_deduction") } };
    expect(() => group([competing], p, state, right)).toThrow();
    expect(() => group([d], p, { ...state, receipts: [] }, right)).toThrow();
    expect(() => group([d], p, { ...state, committedReceiptIds: [] }, right)).toThrow();
    expect(() => group([d], p, { ...state, receipts: [{ ...first.receipts[0]! }] }, right)).toThrow();
    expect(() => group([d], p, { ...state, receipts: [...first.receipts, ...first.receipts] }, right)).toThrow();
    expect(() => group([d], p, committed(p), right)).toThrow();
    expect(() => createSsaBenefitDeductionSettlement(p, right, [d], undefined as unknown as SsaCommittedConsumption, [])).toThrow();
    expect(() => group([d], p, { ...state, complete: false } as unknown as SsaCommittedConsumption, right)).toThrow();
  });

  it("enforces the exact unconsumed source cap and exposes no invalid batch output", () => {
    expect(group([request("part_b", "1500")]).conditionalNetPayable.isZero()).toBe(true);
    expect(() => group([request("part_b", "1501")])).toThrow();
    expect(() => group([request("part_b", "800"), request("part_d", "701")])).toThrow();
    const p = payable(), first = group([request("part_b", "200")]);
    const state = committed(p, first.receipts), right = makeRight(p, money("1300"), first.receipts);
    expect(group([request("part_d", "1300")], p, state, right).conditionalNetPayable.isZero()).toBe(true);
    expect(() => group([request("part_d", "1300.01")], p, state, right)).toThrow();
    const exhausted = group([request("part_b", "1500")]);
    expect(() => group([request("part_d", "1")], p, committed(p, exhausted.receipts),
      makeRight(p, money("0"), exhausted.receipts))).toThrow();
    let output: ReturnType<typeof group> | undefined;
    expect(() => { output = group([request("part_b", "80"), request("part_d", "1500")]); }).toThrow();
    expect(output).toBeUndefined();
    expect(group([request("part_b", "80"), request("part_d", "120")]).deductionAmount.equals(money("200"))).toBe(true);
  });

  it("rejects duplicate settlement/authorization/receipt IDs and duplicate Part allocations", () => {
    const b = request("part_b", "80"), d = request("part_d", "120");
    expect(() => group([b, b])).toThrow();
    expect(() => group([b], payable(), committed(), makeRight(), [b.draft.id])).toThrow();
    expect(() => group([b, { ...d, draft: b.draft }])).toThrow();
    expect(() => group([b, { ...d, terms: { ...d.terms, receiptId: b.terms.receiptId } }])).toThrow();
    expect(() => group([b, { ...d, terms: { ...d.terms, authorizationId: b.terms.authorizationId,
      source: b.terms.source } }])).toThrow();
    expect(() => group([b, { ...b, draft: { ...b.draft, id: settlementId("second") },
      terms: { ...b.terms, receiptId: "second-receipt", authorizationId: "second-authorization",
        source: source("second-authorization", "ssa_medicare_deduction") } }])).toThrow();
  });

  const mismatches: readonly [string, (r: SsaDeductionRequest) => SsaDeductionRequest][] = [
    ["beneficiary", r => ({ ...r, terms: { ...r.terms, premium: { ...r.terms.premium, beneficiaryId: otherOwner } } })],
    ["household", r => ({ ...r, terms: { ...r.terms, payable: { ...r.terms.payable, householdId: "other" } } })],
    ["worker", r => ({ ...r, terms: { ...r.terms, payable: { ...r.terms.payable, workerRecordId: "other" } } })],
    ["award", r => ({ ...r, terms: { ...r.terms, payable: { ...r.terms.payable, awardId: "other" } } })],
    ["entitlement", r => ({ ...r, terms: { ...r.terms, payable: { ...r.terms.payable, entitlementId: "other" } } })],
    ["payable right", r => ({ ...r, terms: { ...r.terms, payable: { ...r.terms.payable, rightClaimId: claimId("other") } } })],
    ["premium month", r => ({ ...r, terms: { ...r.terms, premium: { ...r.terms.premium,
      periodStart: civilDate("2026-05-01"), periodEndExclusive: start } } })],
    ["part", r => ({ ...r, terms: { ...r.terms, premium: { ...r.terms.premium, part: "part_d" } } })],
    ["provider missing", r => ({ ...r, terms: { ...r.terms, premium: { ...r.terms.premium, providerId: "" } } })],
    ["provider mismatch", r => ({ ...r, terms: { ...r.terms, premium: { ...r.terms.premium, providerId: "other" } } })],
    ["coverage mismatch", r => ({ ...r, terms: { ...r.terms, premium: { ...r.terms.premium, coverageId: "other" } } })],
    ["coverage missing", r => ({ ...r, terms: { ...r.terms, premium: { ...r.terms.premium, coverageId: "" } } })],
    ["claim owner", r => ({ ...r, claim: { ...r.claim, economicOwnerId: otherOwner } })],
    ["unrelated expense", r => ({ ...r, claim: { ...r.claim, category: "rent_payable" } })],
    ["right instead of obligation", r => ({ ...r, claim: { ...r.claim, kind: "right" } })],
    ["obligation identity", r => ({ ...r, terms: { ...r.terms, obligationId: claimId("other") } })],
    ["recognition identity", r => ({ ...r, terms: { ...r.terms, obligationRecognitionId: "other" } })],
    ["payment event", r => ({ ...r, draft: { ...r.draft, settledAt: instant("2026-06-16T12:00:00.000Z") } })],
    ["unknown premium", r => ({ ...r, terms: { ...r.terms, premium: { ...r.terms.premium, status: "unknown" } } })],
    ["unknown terms", r => ({ ...r, terms: { ...r.terms, source: { ...r.terms.source, status: "unknown" } } })],
    ["fractional cent", r => ({ ...r, terms: { ...r.terms, amount: money("80.001") } })],
    ["currency", r => ({ ...r, terms: { ...r.terms, amount: money("80", Currency.of("EUR")) } })],
    ["partial premium", r => ({ ...r, terms: { ...r.terms, amount: money("79") } })],
    ["cash route", r => ({ ...r, terms: { ...r.terms, route: "aftertax_bank" } } as unknown as SsaDeductionRequest)],
    ["unsupported partial terms", r => ({ ...r, terms: { ...r.terms, partialDeduction: "unknown" } } as unknown as SsaDeductionRequest)],
    ["already settled claim", r => ({ ...r, claim: { ...r.claim, settlementIds: [settlementId("prior")] } })],
  ];
  it.each(mismatches)("rejects %s", (_name, change) => {
    expect(() => group([change(request("part_b", "80"))])).toThrow();
  });

  it("rejects pensions, generic income, arbitrary rights and unverified source balances", () => {
    const p = payable(), b = request("part_b", "80");
    expect(() => group([b], { ...p, benefitKind: "pension" } as unknown as SsaPayableEvidence)).toThrow();
    expect(() => group([b], { ...p, eligibility: "unknown" })).toThrow();
    expect(() => group([b], { ...p, source: { ...p.source, status: "unknown" } })).toThrow();
    expect(() => group([b], { ...p, grossPayable: money("1500.001") })).toThrow();
    expect(() => group([b], p, committed(), { ...makeRight(), category: "generic_income" })).toThrow();
    expect(() => group([b], p, committed(), { ...makeRight(), id: claimId("arbitrary") })).toThrow();
    expect(() => group([b], p, committed(), { ...makeRight(), economicOwnerId: otherOwner })).toThrow();
    expect(() => group([b], p, { ...committed(), source: { ...committed().source, status: "unknown" } })).toThrow();
  });

  it("rejects future publication, knowledge, as-of, wrong source scope and uncovered dates", () => {
    const b = request("part_b", "80"), future = instant("2026-06-16T00:00:00.000Z");
    for (const s of [
      { ...b.terms.source, publishedAt: future }, { ...b.terms.source, knownAt: future },
      { ...b.terms.source, asOf: future }, { ...b.terms.source, scopeId: "other" },
      { ...b.terms.source, effectiveEndExclusive: civilDate("2026-06-15") },
    ]) expect(() => group([{ ...b, terms: { ...b.terms, source: s } }])).toThrow();
    const p = payable();
    expect(() => group([b], { ...p, source: { ...p.source, publishedAt: future, knownAt: future } })).toThrow();
  });
});

describe("zero Medicare coverage and ordinary bank compatibility", () => {
  it("keeps verified zero as immutable conditional coverage with no monetary lifecycle", () => {
    const p = premium("part_a", "0"), result = createZeroMedicareCoverageEvidence(p, at);
    expect(result.status).toBe("complete");
    if (result.status !== "complete") throw new Error("Expected explicit zero coverage");
    expect(result.premium).toEqual(p);
    expect(Object.isFrozen(result.premium.source)).toBe(true);
    expect(result).not.toHaveProperty("claim");
    expect(result).not.toHaveProperty("settlement");
    expect(result).not.toHaveProperty("recognition");
    expect(result).not.toHaveProperty("fundingAllocations");
    expect(result).not.toHaveProperty("transaction");
    expect(() => request("part_a", "0")).toThrow();
    expect(createZeroMedicareCoverageEvidence(undefined, at)).toEqual({ status: "incomplete" });
    for (const bad of [ { ...p, status: "unknown" as const }, { ...p, status: "unsupported" as const },
      { ...p, irmaa: undefined } as unknown as MedicarePremiumEvidence,
      { ...p, base: money("0.001") }, { ...p, irmaa: money("1") },
      { ...p, source: { ...p.source, status: "unknown" as const } },
      { ...p, periodEndExclusive: civilDate("2026-06-15") },
    ]) expect(createZeroMedicareCoverageEvidence(bad, at)).toEqual({ status: "incomplete" });
  });

  it("preserves positive generic claim/proposal/settlement checks and real bank funding", () => {
    const candidate = request("part_b", "80"), account = domainId("account", "33333333-3333-4333-8333-333333333333");
    const proposal = createSettlementProposal({ id: settlementProposalId("ordinary-bank"),
      claimId: candidate.claim.id, requestedAmount: money("80"), requestedAt: at }, candidate.claim);
    const policy = createFundingPolicy({ id: fundingPolicyId("bank"), allowPartial: false,
      insufficientFundsBehavior: "unfunded", orderedSources: [{ kind: "cash_account", accountId: account }] });
    const funded = resolveFunding(proposal, candidate.claim, policy, { [account]: money("80") });
    expect(isAcceptedFundingResolution(funded)).toBe(true);
    if (!isAcceptedFundingResolution(funded)) throw new Error("Expected real bank funding");
    const settlement = createSettlement({ id: settlementId("ordinary-bank"), settledAt: at }, funded, candidate.claim);
    expect(settlement.fundingAllocations).toHaveLength(1);
    expect(applySettlement(candidate.claim, settlement).outstandingAmount.isZero()).toBe(true);
    expect(() => createSettlementProposal({ id: settlementProposalId("zero"), claimId: candidate.claim.id,
      requestedAmount: money("0"), requestedAt: at }, candidate.claim)).toThrow();
    expect(() => createSettlement({ id: settlementId("fake"), settledAt: at },
      { ...funded, acceptedAmount: money("0") }, candidate.claim)).toThrow();
    const unfunded = resolveFunding(proposal, candidate.claim, policy, { [account]: money("0") });
    expect(isAcceptedFundingResolution(unfunded)).toBe(false);
    expect(() => createFundingPolicy({ ...policy, orderedSources: [{ kind: "ssa_payable_deduction",
      paymentId: payable().paymentId }] } as unknown as Parameters<typeof createFundingPolicy>[0])).toThrow();
  });
});
