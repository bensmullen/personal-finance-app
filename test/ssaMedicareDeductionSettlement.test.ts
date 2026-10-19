import { describe, expect, it } from "vitest";
import { createFundingPolicy, fundingPolicyId, isAcceptedFundingResolution, resolveFunding } from "../src/funding/index.js";
import { domainId } from "../src/identity/index.js";
import { createRecognitionFact } from "../src/semantics/recognition.js";
import { createObligation, createRight } from "../src/semantics/claim.js";
import { claimId, recognitionId, settlementId, settlementProposalId } from "../src/semantics/identity.js";
import { createSettlementProposal } from "../src/semantics/settlementProposal.js";
import {
  applySettlement, createSettlement, prepareSsaMedicareDeductionProposals, createZeroMedicareCoverageEvidence,
  type MedicarePremiumEvidence,
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
  const identity = {
    householdId: "household", recipientId: owner, workerRecordId: "worker", awardId: "coordinated-award",
    entitlementId: "entitlement", paymentId: id, rightClaimId: id, rightRecognitionId: "gross-recognition",
    paymentAt: at,
  };
  return { ...identity, kind: "coordinated_ssa_payable", benefitKind: "ss_retirement", eligibility: "eligible",
    grossPayable: money("1500"), source: source(id, "ssa_coordinated_payable"),
    taxWithholding: { status: "verified_zero", payable: identity, amount: money("0"),
      source: source(id, "ssa_withholding") } };
};
const makeRight = (p = payable(), outstanding = p.grossPayable, settlements: readonly ReturnType<typeof settlementId>[] = []) => {
  const fact = createRecognitionFact({ id: recognitionId(p.rightRecognitionId), category: "ssa_gross_income",
    amount: p.grossPayable, recognizedAt });
  return createRight({ id: p.rightClaimId, originatingRecognitionId: fact.id, category: "ssa_benefit_payable",
    economicOwnerId: owner, originalAmount: fact.amount, outstandingAmount: outstanding,
    recognizedAt, dueAt: at, settlementIds: settlements });
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
const group = (requests: readonly SsaDeductionRequest[], p = payable(), right = makeRight(p), ids: readonly string[] = []) =>
  prepareSsaMedicareDeductionProposals(p, right, requests, ids);

describe("conditional SSA Medicare deduction proposals", () => {
  it("proposes 8000 + 12000 cents from 150000 cents with no settlement authority", () => {
    const b = request("part_b", "80"), d = request("part_d", "120"), right = makeRight();
    const result = group([d, b], payable(), right);
    expect(result.deductionAmount.equals(money("200"))).toBe(true);
    expect(result.conditionalNetPayable.equals(money("1300"))).toBe(true);
    expect(result.committed).toBe(false);
    expect(result.kind).toBe("conditional_ssa_medicare_deduction");
    expect(result.proposals.map(r => r.terms.premium.part)).toEqual(["part_b", "part_d"]);
    for (const [index, candidate] of [b, d].entries()) {
      const proposal = result.proposals[index]!;
      expect(proposal.kind).toBe("conditional_ssa_medicare_deduction");
      expect(proposal.committed).toBe(false);
      expect(proposal.terms.amount.equals(candidate.claim.originalAmount)).toBe(true);
      expect(candidate.claim.outstandingAmount.equals(candidate.claim.originalAmount)).toBe(true);
      expect(candidate.claim.settlementIds).toEqual([]);
      for (const key of ["settlement", "sourceState", "transaction", "fundingAllocations", "recognition"])
        expect(proposal).not.toHaveProperty(key);
      // Deliberate runtime misuse must fail without casting an opaque brand.
      expect(() => Reflect.apply(applySettlement, undefined, [candidate.claim, proposal])).toThrow();
      expect(() => Reflect.apply(applySettlement, undefined, [right, proposal])).toThrow();
    }
    expect(right.outstandingAmount.equals(money("1500"))).toBe(true);
    expect(right.settlementIds).toEqual([]);
    expect(Reflect.apply(isAcceptedFundingResolution, undefined, [result])).toBe(false);
    expect(() => Reflect.apply(createSettlement, undefined, [b.draft, result.proposals[0], b.claim])).toThrow();
  });

  it("is immutable and deterministic under input reversal and pure replay", () => {
    const b = request("part_b", "80"), d = request("part_d", "120");
    const forward = group([b, d]);
    expect(group([d, b])).toEqual(forward);
    expect(group([b, d])).toEqual(forward);
    const proposal = forward.proposals[0]!;
    for (const value of [forward, forward.proposals, proposal, proposal.claim, proposal.claim.settlementIds,
      forward.payable, forward.payable.source, forward.payable.taxWithholding,
      forward.payable.taxWithholding.payable, forward.payable.taxWithholding.source, proposal.terms, proposal.terms.premium,
      proposal.terms.premiumScope, proposal.terms.premium.source]) expect(Object.isFrozen(value)).toBe(true);
    expect(Reflect.set(b.terms.premium.source, "version", "changed-input")).toBe(true);
    expect(proposal.terms.premium.source.version).toBe("synthetic-v1");
    expect(() => Reflect.apply(applySettlement, undefined, [b.claim, { ...proposal }])).toThrow();
  });

  it("matches full base plus IRMAA without consuming source capacity", () => {
    const b = request("part_b", "80"), d = request("part_d", "120");
    const withIrmaa = { ...b, terms: { ...b.terms, premium: { ...b.terms.premium,
      base: money("50"), irmaa: money("30") } } };
    const first = group([withIrmaa, d]);
    expect(first.deductionAmount.equals(money("200"))).toBe(true);
    expect(group([d, withIrmaa])).toEqual(first);
    const separate = group([request("part_a", "10")]);
    expect(separate.conditionalNetPayable.equals(money("1490"))).toBe(true);
    expect(separate.committed).toBe(false);
  });

  it("rejects partial or settled source rights and caller-supplied historical consumption", () => {
    const p = payable(), b = request("part_b", "200", p);
    for (const amount of ["1300", "0"]) {
      expect(() => group([b], p, makeRight(p, money(amount)))).toThrow();
      expect(() => group([b], p, makeRight(p, money(amount), [settlementId("prior")]))).toThrow();
    }
    expect(() => group([b], p, makeRight(p, p.grossPayable, [settlementId("prior")]))).toThrow();
    const first = group([b]);
    expect(group([b])).toEqual(first);
    const fakeHistory = { complete: true, receipts: first.proposals, committedReceiptIds: [b.terms.receiptId] };
    expect(() => Reflect.apply(prepareSsaMedicareDeductionProposals, undefined,
      [p, makeRight(p), [b], fakeHistory])).toThrow();
  });

  it("enforces the single batch gross cap and exposes no invalid batch output", () => {
    expect(group([request("part_b", "1500")]).conditionalNetPayable.isZero()).toBe(true);
    expect(() => group([request("part_b", "1501")])).toThrow();
    expect(() => group([request("part_b", "800"), request("part_d", "701")])).toThrow();
    expect(() => group([])).toThrow();
    let output: ReturnType<typeof group> | undefined;
    const b = request("part_b", "80"), d = request("part_d", "1500"), right = makeRight();
    expect(() => { output = group([b, d], payable(), right); }).toThrow();
    expect(output).toBeUndefined();
    for (const claim of [b.claim, d.claim, right]) {
      expect(claim.outstandingAmount.equals(claim.originalAmount)).toBe(true);
      expect(claim.settlementIds).toEqual([]);
    }
    expect(group([request("part_b", "80"), request("part_d", "120")]).deductionAmount.equals(money("200"))).toBe(true);
  });

  it("rejects duplicate settlement/authorization/receipt IDs and duplicate Part allocations", () => {
    const b = request("part_b", "80"), d = request("part_d", "120");
    expect(() => group([b, b])).toThrow();
    expect(() => group([b], payable(), makeRight(), [b.draft.id])).toThrow();
    expect(() => group([b, { ...d, draft: b.draft }])).toThrow();
    expect(() => group([b, { ...d, terms: { ...d.terms, receiptId: b.terms.receiptId } }])).toThrow();
    expect(() => group([b, { ...d, terms: { ...d.terms, authorizationId: b.terms.authorizationId,
      source: b.terms.source } }])).toThrow();
    const sharedRecognition = { ...d, claim: Object.freeze({ ...d.claim,
      originatingRecognitionId: b.claim.originatingRecognitionId }), terms: { ...d.terms,
      obligationRecognitionId: b.terms.obligationRecognitionId } };
    expect(() => group([b, sharedRecognition])).toThrow();
    expect(() => group([b, { ...b, draft: { ...b.draft, id: settlementId("second") },
      terms: { ...b.terms, receiptId: "second-receipt", authorizationId: "second-authorization",
        source: source("second-authorization", "ssa_medicare_deduction") } }])).toThrow();
  });

  it("rejects mixed bank routes, partial obligations and incomplete premiums atomically", () => {
    const b = request("part_b", "80"), d = request("part_d", "120");
    const bank = { ...d, terms: { ...d.terms, route: "aftertax_bank" } };
    expect(() => Reflect.apply(prepareSsaMedicareDeductionProposals, undefined,
      [payable(), makeRight(), [b, bank]])).toThrow();
    for (const amount of ["119", "0"]) {
      const claim = Object.freeze({ ...d.claim, outstandingAmount: money(amount) });
      expect(() => group([b, { ...d, claim }])).toThrow();
    }
    for (const premium of [undefined, { ...d.terms.premium, irmaa: undefined },
      { ...d.terms.premium, base: money("120.001") }]) {
      expect(() => Reflect.apply(prepareSsaMedicareDeductionProposals, undefined,
        [payable(), makeRight(), [b, { ...d, terms: { ...d.terms, premium } }]])).toThrow();
    }
    expect(b.claim.settlementIds).toEqual([]);
    expect(group([b, d]).deductionAmount.equals(money("200"))).toBe(true);
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
    ["unsupported rules", r => ({ ...r, terms: { ...r.terms, source: { ...r.terms.source, status: "unsupported" } } })],
    ["wrong rule family", r => ({ ...r, terms: { ...r.terms, source: { ...r.terms.source, ruleFamily: "generic_income" } } })],
    ["zero deduction", r => ({ ...r, terms: { ...r.terms, amount: money("0") } })],
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
    expect(() => group([b], { ...p, kind: "generic_income" } as unknown as SsaPayableEvidence)).toThrow();
    expect(() => group([b], { ...p, grossPayable: money("0") })).toThrow();
    expect(() => group([b], { ...p, grossPayable: money("1500.001") })).toThrow();
    expect(() => group([b], p, { ...makeRight(), category: "generic_income" })).toThrow();
    expect(() => group([b], p, { ...makeRight(), id: claimId("arbitrary") })).toThrow();
    expect(() => group([b], p, { ...makeRight(), economicOwnerId: otherOwner })).toThrow();
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

  it.each(["payable", "premium", "authorization"] as const)(
    "rejects %s source as-of after knowledge but before the payment event", target => {
      const p = payable(), b = request("part_b", "80", p);
      const asOf = instant("2026-06-10T00:00:00.000Z");
      expect(group([b], p).conditionalNetPayable.equals(money("1420"))).toBe(true);
      if (target === "payable") {
        expect(() => group([b], { ...p, source: { ...p.source, asOf } })).toThrow();
      } else if (target === "premium") {
        expect(() => group([{ ...b, terms: { ...b.terms, premium: { ...b.terms.premium,
          source: { ...b.terms.premium.source, asOf } } } }], p)).toThrow();
      } else {
        expect(() => group([{ ...b, terms: { ...b.terms, source: { ...b.terms.source, asOf } } }], p)).toThrow();
      }
    });

  it("conditions the $1300 net on an explicit sourced zero tax instruction for the installment", () => {
    const p = payable(), result = group([request("part_b", "80", p), request("part_d", "120", p)], p);
    expect(result.payable.taxWithholding).toEqual(p.taxWithholding);
    expect(result.payable.taxWithholding.amount.isZero()).toBe(true);
    expect(result.conditionalNetPayable.equals(money("1300"))).toBe(true);
    expect(result.committed).toBe(false);
    expect(result).not.toHaveProperty("taxCredit");
    expect(result).not.toHaveProperty("transaction");
  });

  const invalidWithholding: readonly [string, (w: SsaPayableEvidence["taxWithholding"]) => unknown][] = [
    ["missing instruction", () => undefined],
    ["unknown instruction", w => ({ ...w, status: "unknown" })],
    ["positive amount", w => ({ ...w, amount: money("1") })],
    ["negative amount", w => ({ ...w, amount: money("-1") })],
    ["fractional cents", w => ({ ...w, amount: money("0.001") })],
    ["non-USD zero", w => ({ ...w, amount: money("0", Currency.of("EUR")) })],
    ["missing amount", w => ({ ...w, amount: undefined })],
    ["missing source", w => ({ ...w, source: undefined })],
    ["unknown source", w => ({ ...w, source: { ...w.source, status: "unknown" } })],
    ["unsupported source", w => ({ ...w, source: { ...w.source, status: "unsupported" } })],
    ["wrong source scope", w => ({ ...w, source: { ...w.source, scopeId: "other-payment" } })],
    ["wrong rule family", w => ({ ...w, source: { ...w.source, ruleFamily: "ssa_coordinated_payable" } })],
    ["stale effective period", w => ({ ...w, source: { ...w.source, effectiveEndExclusive: civilDate("2026-06-15") } })],
    ["future effective period", w => ({ ...w, source: { ...w.source, effectiveStart: civilDate("2026-06-16") } })],
    ["future publication", w => ({ ...w, source: { ...w.source, publishedAt: instant("2026-06-16T00:00:00.000Z") } })],
    ["future knowledge", w => ({ ...w, source: { ...w.source, knownAt: instant("2026-06-16T00:00:00.000Z") } })],
    ["future as-of", w => ({ ...w, source: { ...w.source, asOf: instant("2026-06-16T00:00:00.000Z") } })],
    ["as-of after knowledge before payment", w => ({ ...w, source: { ...w.source, asOf: instant("2026-06-10T00:00:00.000Z") } })],
    ["missing installment", w => ({ ...w, payable: undefined })],
    ["wrong household", w => ({ ...w, payable: { ...w.payable, householdId: "other" } })],
    ["wrong recipient", w => ({ ...w, payable: { ...w.payable, recipientId: otherOwner } })],
    ["wrong worker", w => ({ ...w, payable: { ...w.payable, workerRecordId: "other" } })],
    ["wrong award", w => ({ ...w, payable: { ...w.payable, awardId: "other" } })],
    ["wrong entitlement", w => ({ ...w, payable: { ...w.payable, entitlementId: "other" } })],
    ["wrong payment", w => ({ ...w, payable: { ...w.payable, paymentId: "other" } })],
    ["wrong right", w => ({ ...w, payable: { ...w.payable, rightClaimId: claimId("other") } })],
    ["wrong recognition", w => ({ ...w, payable: { ...w.payable, rightRecognitionId: "other" } })],
    ["wrong payment date", w => ({ ...w, payable: { ...w.payable, paymentAt: instant("2026-06-16T12:00:00.000Z") } })],
  ];
  it.each(invalidWithholding)("rejects withholding with %s without producing or mutating financial state", (_name, change) => {
    const p = payable(), b = request("part_b", "80", p), right = makeRight(p);
    let output: unknown;
    expect(() => {
      output = Reflect.apply(prepareSsaMedicareDeductionProposals, undefined,
        [{ ...p, taxWithholding: change(p.taxWithholding) }, right, [b]]);
    }).toThrow();
    expect(output).toBeUndefined();
    for (const claim of [right, b.claim]) {
      expect(claim.outstandingAmount.equals(claim.originalAmount)).toBe(true);
      expect(claim.settlementIds).toEqual([]);
    }
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
    const settled = applySettlement(candidate.claim, settlement);
    expect(settled.outstandingAmount.isZero()).toBe(true);
    expect(() => applySettlement(candidate.claim, { ...settlement })).toThrow();
    expect(() => applySettlement(settled, settlement)).toThrow();
    expect(() => applySettlement(request("part_d", "80").claim, settlement)).toThrow();
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
