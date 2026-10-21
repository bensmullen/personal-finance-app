import { describe, expect, it } from "vitest";
import { provePensionPayments, type PensionBankConfirmation, type PensionEvidence,
  type PensionPaymentRequest, type PensionDiagnosticCode } from "../../../../../src/simulation/d2/retirement/benefits/pensionPayment/index.js";
import { type BenefitSource, type QuotedBenefit } from "../../../../../src/simulation/d2/retirement/benefits/index.js";
import { civilDate as date } from "../../../../../src/time/index.js";
import { Currency, money, Ratio, RoundingPolicy } from "../../../../../src/values/index.js";

// S8 synthetic isolated oracles: original plan award and separate payer bank
// documents independently state 120000 cents, not expectations derived from A1.
const horizon = { start: date("2026-01-01"), endExclusive: date("2026-03-01") };
const source: BenefitSource = { ruleSnapshotId: "synthetic-plan/v1", jurisdiction: "US",
  ruleFamily: "pension-plan", sourcePublication: "Synthetic original plan award",
  asOf: date("2026-01-01"), version: "1", projectionStatus: "verified" };
const evidence = (id: string, publication = id): PensionEvidence => ({ evidenceId: id,
  publishedAt: date("2026-01-01"), knownAt: date("2026-01-01"), effective: horizon,
  source: { ...source, ruleSnapshotId: id, sourcePublication: publication }, verified: true });
const claim = (at: string, person = "participant") => JSON.stringify(["d2-quoted-benefit/v1", "household", "entitlement", person, at]);
const confirmation = (at: string, recipient = "participant", amount = "1200"): PensionBankConfirmation => ({
  confirmationId: `confirmation:${at}`, paymentId: `payer-payment:${at}`, receiptId: `receipt:${at}`,
  pensionId: "pension", planId: "plan", sponsorId: "employer", entitlementId: "entitlement",
  recipientPersonId: recipient, effectiveAt: date(at), authorizedAt: date("2026-01-01"), fundedAt: date(at),
  authorizationId: `authorization:${at}`, fundingId: `funding:${at}`, instructionId: `instruction:${recipient}`,
  electionId: "election", electedForm: "joint 50%", status: "posted", gross: money(amount), net: money(amount),
  withholding: [{ jurisdiction: "US-federal", amount: money("0.00") }, { jurisdiction: "US-state-synthetic", amount: money("0.00") }],
  route: { kind: "bank", institutionId: "bank", destinationAccountId: `account:${recipient}`,
    accountKind: "checking", householdId: "household", ownerPersonIds: [recipient] },
  evidence: evidence(`bank-document:${at}`, "Synthetic independent payer BANK register"),
});
function fixture(survivor = false): PensionPaymentRequest {
  const award: QuotedBenefit = { awardId: "quote/v1", entitlementId: "entitlement", householdId: "household",
    recipientPersonId: "participant", workerRecordPersonId: "participant", sponsorId: "employer", beneficiaryId: "survivor",
    benefitKind: "pension", claimingMonth: date("2026-01-01"), commencement: date("2026-01-15"),
    frequency: "monthly", invalidDayPolicy: "skip", calendarSource: source,
    quote: { recipientPersonId: "participant", workerRecordPersonId: "participant", claimingMonth: date("2026-01-01"),
      electionId: "election", adjustmentOrder: "claiming_then_cola_then_continuation", grossAmount: money("1200.00"),
      asOf: source.asOf, dollarBasisAt: source.asOf, basis: "post_election", source, coveredHorizon: horizon },
    cola: { source, coveredHorizon: horizon, changes: [] }, election: { electionId: "election", form: "joint 50%",
      beneficiaryId: "survivor", source, continuation: { beneficiaryId: "survivor", factor: Ratio.parse("0.5"),
        rounding: new RoundingPolicy(2, "half_even"), source, effectiveAt: date("2026-02-01"), coversDeathBeforeCommencement: false } },
    ...(survivor ? { participantDeathDate: date("2026-02-01") } : {}) };
  const confirmations = [confirmation("2026-01-15"), confirmation("2026-02-15", survivor ? "survivor" : "participant", survivor ? "600.00" : "1200.00")];
  return { householdId: "household", knownAt: date("2026-03-01"), horizon, awards: [award],
    originals: [{ pensionId: "pension", planId: "plan", sponsorId: "employer", entitlementId: "entitlement",
      evidence: evidence("original-payer-award"), award, employeeBasis: "none", paymentMethod: "quoted_whole_installment" }],
    confirmations, instructions: ["participant", "survivor"].map(person => ({ instructionId: `instruction:${person}`,
      pensionId: "pension", planId: "plan", sponsorId: "employer", entitlementId: "entitlement", recipientPersonId: person,
      electionId: "election", electedForm: "joint 50%", institutionId: "bank", destinationAccountId: `account:${person}`,
      accountKind: "checking", evidence: evidence(`legal-instruction:${person}`) })),
    history: [{ entitlementId: "entitlement", exhaustive: true, covered: horizon, evidence: evidence("exhaustive-history"),
      installments: [{ effectiveAt: date("2026-01-15"), recipientPersonId: "participant", claimId: claim("2026-01-15"), status: "unpaid" }] }] };
}
const changeJanuary = (r: PensionPaymentRequest, change: Partial<PensionBankConfirmation>): PensionPaymentRequest => ({
  ...r, confirmations: [{ ...r.confirmations[0]!, ...change }, r.confirmations[1]!] });
const codes = (r: PensionPaymentRequest) => provePensionPayments(r).diagnostics.map(d => d.diagnosticCode);

describe("#146 pension original-source payment proof; PFA-DET-016 / PFA-TAX-015", () => {
  it("admits two genuine monthly whole installments with independently documented exact cents", () => {
    const r = provePensionPayments(fixture());
    expect(r.diagnostics).toEqual([]);
    expect(r.intents.map(p => [p.effectiveAt, p.grossAmount.amount.toString(), p.netAmount.amount.toString()]))
      .toEqual([["2026-01-15", "1200", "1200"], ["2026-02-15", "1200", "1200"]]);
    expect(r.intents.map(p => p.paymentId)).toEqual(["payer-payment:2026-01-15", "payer-payment:2026-02-15"]);
    for (const p of r.intents) {
      expect(p).toMatchObject({ committed: false, postable: false, tax: "incomplete", bankSettlement: "incomplete" });
      expect(p).not.toHaveProperty("cashDelta"); expect(p).not.toHaveProperty("withholdingCredit");
      expect(p).not.toHaveProperty("taxable"); expect(p).not.toHaveProperty("priority");
    }
  });
  it("lets unchanged A1 apply the sourced 50% survivor once to the post-election amount", () => {
    const r = provePensionPayments(fixture(true));
    expect(r.diagnostics).toEqual([]);
    expect(r.intents.map(p => [p.actorId, p.grossAmount.amount.toString(), p.destinationAccountId]))
      .toEqual([["participant", "1200", "account:participant"], ["survivor", "600", "account:survivor"]]);
    const f = fixture(true);
    expect(codes({ ...f, confirmations: [f.confirmations[0]!, { ...f.confirmations[1]!, recipientPersonId: "participant" }] })).toContain("WRONG_RECIPIENT");
  });
  it("keeps original payment and operation identities on quote-record revision", () => {
    const f = fixture(), before = provePensionPayments(f);
    const revised = provePensionPayments({ ...f, awards: [{ ...f.awards[0]!, awardId: "quote/v2" }] });
    expect(revised).toEqual(before);
    const history = { ...f.history[0]!, installments: [{ ...f.history[0]!.installments[0]!, status: "paid" as const,
      paymentId: "payer-payment:2026-01-15", receiptId: "receipt:2026-01-15" }] };
    const replay = provePensionPayments({ ...f, awards: [{ ...f.awards[0]!, awardId: "quote/v3" }], history: [history] });
    expect(replay.intents.map(p => p.effectiveAt)).toEqual(["2026-02-15"]);
    expect(replay.diagnostics.map(d => d.diagnosticCode)).toContain("REUSED_PAYMENT_IDENTITY");
  });
  it("preserves claim/payment identities when a source revision is independently reconciled", () => {
    const f = fixture(), original = provePensionPayments(f), a = f.awards[0]!;
    const revisedAward = { ...a, awardId: "quote/v2", quote: { ...a.quote!, source: { ...source,
      ruleSnapshotId: "synthetic-plan/quote-v2", version: "2" } } };
    // Updating only a quote would conflict. Here the external original verifier
    // explicitly reconciles the same payable terms to that revised source.
    const revised = provePensionPayments({ ...f, awards: [revisedAward],
      originals: [{ ...f.originals[0]!, award: revisedAward, evidence: evidence("reconciled-original/v2") }] });
    expect(revised.diagnostics).toEqual([]);
    expect(revised.intents.map(p => [p.claimId, p.operationId, p.paymentId, p.receiptId]))
      .toEqual(original.intents.map(p => [p.claimId, p.operationId, p.paymentId, p.receiptId]));
  });
  const rejected: readonly [string, Partial<PensionBankConfirmation>, PensionDiagnosticCode][] = [
    ["pending", { status: "pending" }, "UNAVAILABLE_EVIDENCE"],
    ["unverified", { evidence: { ...evidence("forged"), verified: false } }, "UNAVAILABLE_EVIDENCE"],
    ["late known", { evidence: { ...evidence("late"), knownAt: date("2026-01-16") } }, "UNAVAILABLE_EVIDENCE"],
    ["late publication", { evidence: { ...evidence("late"), publishedAt: date("2026-01-16") } }, "UNAVAILABLE_EVIDENCE"],
    ["wrong recipient", { recipientPersonId: "stranger" }, "WRONG_RECIPIENT"],
    ["wrong amount", { gross: money("1200.01") }, "WRONG_AMOUNT"],
    ["wrong currency", { net: money("1200", Currency.of("EUR")) }, "WRONG_AMOUNT"],
    ["wrong funding date", { fundedAt: date("2026-01-16") }, "WRONG_DATE"],
    ["positive withholding", { withholding: [{ jurisdiction: "US", amount: money("1.00") }] }, "UNSUPPORTED_WITHHOLDING"],
    ["missing jurisdiction", { withholding: [{ jurisdiction: "", amount: money("0") }] }, "UNSUPPORTED_WITHHOLDING"],
    ["empty withholding", { withholding: [] }, "UNSUPPORTED_WITHHOLDING"],
    ["missing legal election", { electionId: "" }, "MISSING_LEGAL_INSTRUCTION"],
    ["missing instruction", { instructionId: "unknown" }, "MISSING_LEGAL_INSTRUCTION"],
    ["forged sponsor", { sponsorId: "other" }, "INVALID_IDENTITY"],
  ];
  it.each(rejected)("rejects %s while retaining the other valid month", (_label, change, code) => {
    const r = provePensionPayments(changeJanuary(fixture(), change));
    expect(r.diagnostics.map(d => d.diagnosticCode)).toContain(code);
    expect(r.intents.map(p => p.effectiveAt)).toEqual(["2026-02-15"]);
    expect(r.diagnostics[0]!.effectiveAt).toBe("2026-01-15");
  });
  it("never treats omitted withholding as zero", () => {
    const f = fixture(), { withholding: _w, ...missing } = f.confirmations[0]!;
    expect(codes({ ...f, confirmations: [missing, f.confirmations[1]!] })).toContain("UNSUPPORTED_WITHHOLDING");
  });
  it("rejects duplicate and reused documentary identities without selecting an array winner", () => {
    const f = fixture(), duplicate = { ...f, confirmations: [...f.confirmations, { ...f.confirmations[0]!, confirmationId: "competing" }] };
    expect(codes(duplicate)).toContain("COMPETING_CONFIRMATIONS");
    expect(provePensionPayments(duplicate).intents.map(p => p.effectiveAt)).toEqual(["2026-02-15"]);
    const reused = changeJanuary(f, { paymentId: f.confirmations[1]!.paymentId });
    expect(provePensionPayments(reused).intents).toEqual([]);
    expect(codes(reused)).toEqual(["REUSED_PAYMENT_IDENTITY", "REUSED_PAYMENT_IDENTITY"]);
    expect(provePensionPayments({ ...duplicate, confirmations: [...duplicate.confirmations].reverse() })).toEqual(provePensionPayments(duplicate));
  });
  it("rejects missing or ambiguous original authority even when net matches", () => {
    const f = fixture();
    expect(codes({ ...f, originals: [] })).toContain("SOURCE_CONFLICT");
    expect(codes({ ...f, originals: [f.originals[0]!, f.originals[0]!] })).toContain("SOURCE_CONFLICT");
    expect(codes({ ...f, originals: [{ ...f.originals[0]!, evidence: { ...f.originals[0]!.evidence, verified: false } }] })).toContain("UNAVAILABLE_EVIDENCE");
    const sameSource = changeJanuary(f, { evidence: { ...f.confirmations[0]!.evidence, source } });
    expect(codes(sameSource)).toContain("SOURCE_CONFLICT");
  });
  it("gates amended sponsor/COLA terms and missing A1 legal elections", () => {
    const f = fixture(), a = f.awards[0]!;
    expect(codes({ ...f, awards: [{ ...a, sponsorId: "new-employer" }] })).toContain("INVALID_IDENTITY");
    const changed = { ...a, cola: { ...a.cola!, changes: [{ year: 2026, effectiveAt: date("2026-02-01"),
      factor: Ratio.parse("1.01"), rounding: new RoundingPolicy(2, "half_even"), source }] } };
    expect(codes({ ...f, awards: [changed] })).toContain("SOURCE_CONFLICT");
    const { election: _e, ...missing } = a;
    expect(provePensionPayments({ ...f, awards: [missing] }).intents).toEqual([]);
    expect(codes({ ...f, awards: [missing] })).toContain("A1_INCOMPLETE");
  });
  it("requires exhaustive earlier history and rejects an already exhausted claim", () => {
    const f = fixture(), h = f.history[0]!;
    const missing = provePensionPayments({ ...f, history: [{ ...h, installments: [] }] });
    expect(missing.intents.map(p => p.effectiveAt)).toEqual(["2026-01-15"]);
    expect(missing.diagnostics.map(d => d.diagnosticCode)).toContain("INCOMPLETE_HISTORY");
    expect(codes({ ...f, history: [{ ...h, exhaustive: false }] })).toContain("INCOMPLETE_HISTORY");
    const exhausted = { ...h.installments[0]!, status: "exhausted" as const, paymentId: "old-payment", receiptId: "old-receipt" };
    const result = provePensionPayments({ ...f, history: [{ ...h, installments: [exhausted] }] });
    expect(result.intents.map(p => p.effectiveAt)).toEqual(["2026-02-15"]);
    expect(result.diagnostics.map(d => d.diagnosticCode)).toContain("EXHAUSTED_CLAIM");
    expect(codes({ ...f, history: [{ ...h, installments: [{ ...h.installments[0]!, recipientPersonId: "substitute" }] }] })).toContain("INCOMPLETE_HISTORY");
  });
  it("rejects duplicate/off-calendar history and an incomplete earlier covered period", () => {
    const f = fixture(), h = f.history[0]!, row = h.installments[0]!;
    expect(codes({ ...f, history: [{ ...h, installments: [row, row] }] })).toContain("INCOMPLETE_HISTORY");
    const extra = { ...row, effectiveAt: date("2026-01-14"), claimId: claim("2026-01-14") };
    expect(codes({ ...f, history: [{ ...h, installments: [extra, row] }] })).toContain("INCOMPLETE_HISTORY");
    expect(codes({ ...f, history: [{ ...h, covered: { ...h.covered, start: date("2026-02-01") } }] })).toContain("INCOMPLETE_HISTORY");
  });
  it("requires an owned mapped bank route and gates basis/formula work", () => {
    const f = fixture(), c = f.confirmations[0]!;
    expect(codes(changeJanuary(f, { route: { ...c.route, ownerPersonIds: ["other"] } }))).toContain("OWNERSHIP_MISMATCH");
    expect(codes(changeJanuary(f, { route: { ...c.route, kind: "unmapped" } }))).toContain("UNMAPPED_BANK_ROUTE");
    expect(codes({ ...f, originals: [{ ...f.originals[0]!, employeeBasis: "unresolved" }] })).toContain("UNSUPPORTED_PENSION");
    expect(codes({ ...f, originals: [{ ...f.originals[0]!, paymentMethod: "unsupported" }] })).toContain("UNSUPPORTED_PENSION");
  });
  it("does not use expiry at the later run cutoff to disqualify original event evidence", () => {
    const f = fixture(), c = f.confirmations[0]!;
    const r = provePensionPayments(changeJanuary(f, { evidence: { ...c.evidence,
      effective: { start: date("2026-01-01"), endExclusive: date("2026-01-16") } } }));
    expect(r.intents).toHaveLength(2);
    expect(codes({ ...f, knownAt: date("2026-01-14") })).toContain("UNAVAILABLE_EVIDENCE");
  });
  it("cannot authorize off-cadence dates or reinterpret SSA as a pension", () => {
    const f = fixture();
    const wrongDate = changeJanuary(f, { effectiveAt: date("2026-01-16"), fundedAt: date("2026-01-16") });
    expect(codes(wrongDate)).toContain("NO_DUE_INSTALLMENT");
    expect(provePensionPayments(wrongDate).intents.map(p => p.effectiveAt)).toEqual(["2026-02-15"]);
    const ss = { ...f.awards[0]!, benefitKind: "ss_retirement" as const };
    expect(provePensionPayments({ ...f, awards: [ss] }).intents).toEqual([]);
    expect(codes({ ...f, awards: [ss] })).toContain("UNSUPPORTED_PENSION");
  });
  it("preserves the same result when two independent pensions and all input arrays reverse", () => {
    const f = fixture(), a = f.awards[0]!;
    const otherAward = { ...a, awardId: "other-quote", entitlementId: "other-entitlement", sponsorId: "other-sponsor" };
    const other = { ...f.originals[0]!, pensionId: "other-pension", planId: "other-plan", sponsorId: "other-sponsor",
      entitlementId: "other-entitlement", award: otherAward };
    const r: PensionPaymentRequest = { ...f, awards: [a, otherAward], originals: [f.originals[0]!, other],
      confirmations: [...f.confirmations, ...f.confirmations.map(c => ({ ...c, pensionId: "other-pension", planId: "other-plan",
        sponsorId: "other-sponsor", entitlementId: "other-entitlement", confirmationId: `other:${c.confirmationId}`,
        paymentId: `other:${c.paymentId}`, receiptId: `other:${c.receiptId}`, fundingId: `other:${c.fundingId}`,
        instructionId: `other:${c.instructionId}` }))],
      instructions: [...f.instructions, ...f.instructions.map(i => ({ ...i, pensionId: "other-pension", planId: "other-plan",
        sponsorId: "other-sponsor", entitlementId: "other-entitlement", instructionId: `other:${i.instructionId}` }))],
      history: [...f.history, { ...f.history[0]!, entitlementId: "other-entitlement", installments: f.history[0]!.installments.map(row => ({
        ...row, claimId: JSON.stringify(["d2-quoted-benefit/v1", "household", "other-entitlement", "participant", row.effectiveAt]) })) }] };
    const result = provePensionPayments(r);
    expect(result.diagnostics).toEqual([]); expect(result.intents).toHaveLength(4);
    expect(provePensionPayments({ ...r, awards: [...r.awards].reverse(), originals: [...r.originals].reverse(),
      confirmations: [...r.confirmations].reverse(), instructions: [...r.instructions].reverse(), history: [...r.history].reverse() })).toEqual(result);
  });
  it("returns deep immutable copies, replays identically, and never mutates evidence", () => {
    const f = fixture(true), before = JSON.stringify(f), r = provePensionPayments(f);
    expect(provePensionPayments(f)).toEqual(r);
    expect(provePensionPayments({ ...f, awards: [...f.awards].reverse(), originals: [...f.originals].reverse(),
      confirmations: [...f.confirmations].reverse(), instructions: [...f.instructions].reverse(), history: [...f.history].reverse() })).toEqual(r);
    expect(Object.isFrozen(r)).toBe(true); expect(Object.isFrozen(r.intents)).toBe(true);
    expect(Object.isFrozen(r.intents[0]!.source.source)).toBe(true); expect(Object.isFrozen(r.intents[0]!.traceRefs)).toBe(true);
    expect(Object.isFrozen(f.confirmations[0]!.evidence)).toBe(false);
    expect(JSON.stringify(f)).toBe(before);
  });
});
