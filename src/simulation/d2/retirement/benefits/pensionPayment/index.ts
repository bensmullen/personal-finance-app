import { civilDate, type CivilDate } from "../../../../../time/index.js";
import { DecimalAmount, Money, Ratio } from "../../../../../values/index.js";
import { calculateQuotedBenefits, type BenefitPeriod, type BenefitSource, type QuotedBenefit } from "../index.js";

/** Private source-boundary types; #149 owns canonical integration. */
export interface PensionEvidence {
  readonly evidenceId: string;
  readonly publishedAt: CivilDate;
  readonly knownAt: CivilDate;
  readonly effective: BenefitPeriod;
  readonly source: BenefitSource;
  /** External documentary verifier's finding; never inferred from a deposit. */
  readonly verified: boolean;
}
export interface OriginalPension {
  readonly pensionId: string;
  readonly planId: string;
  readonly sponsorId: string;
  readonly entitlementId: string;
  readonly evidence: PensionEvidence;
  readonly award: QuotedBenefit;
  readonly employeeBasis: "none" | "unresolved";
  readonly paymentMethod: "quoted_whole_installment" | "unsupported";
}
export interface PensionBankConfirmation {
  readonly confirmationId: string;
  readonly paymentId: string;
  readonly receiptId: string;
  readonly pensionId: string;
  readonly planId: string;
  readonly sponsorId: string;
  readonly entitlementId: string;
  readonly recipientPersonId: string;
  readonly effectiveAt: CivilDate;
  readonly authorizedAt: CivilDate;
  readonly fundedAt: CivilDate;
  readonly authorizationId: string;
  readonly fundingId: string;
  readonly instructionId: string;
  readonly electionId: string;
  readonly electedForm: string;
  readonly status: "posted" | "pending" | "unverified";
  readonly gross: Money;
  readonly net: Money;
  readonly withholding?: readonly { readonly jurisdiction: string; readonly amount: Money }[];
  readonly route: {
    readonly kind: "bank" | "unmapped";
    readonly institutionId: string;
    readonly destinationAccountId: string;
    readonly accountKind: "checking" | "savings";
    readonly householdId: string;
    readonly ownerPersonIds: readonly string[];
  };
  readonly evidence: PensionEvidence;
}
export interface PensionInstruction {
  readonly instructionId: string;
  readonly pensionId: string;
  readonly planId: string;
  readonly sponsorId: string;
  readonly entitlementId: string;
  readonly recipientPersonId: string;
  readonly electionId: string;
  readonly electedForm: string;
  readonly institutionId: string;
  readonly destinationAccountId: string;
  readonly accountKind: "checking" | "savings";
  readonly evidence: PensionEvidence;
}
export interface PensionHistory {
  readonly entitlementId: string;
  readonly exhaustive: boolean;
  readonly covered: BenefitPeriod;
  readonly evidence: PensionEvidence;
  /** Every earlier due installment, including unpaid, must be accounted for. */
  readonly installments: readonly {
    readonly effectiveAt: CivilDate;
    readonly recipientPersonId: string;
    readonly claimId: string;
    readonly status: "unpaid" | "paid" | "exhausted";
    readonly paymentId?: string;
    readonly receiptId?: string;
  }[];
}
export type PensionDiagnosticCode = "INVALID_IDENTITY" | "UNAVAILABLE_EVIDENCE" | "SOURCE_CONFLICT"
  | "UNSUPPORTED_PENSION" | "A1_INCOMPLETE" | "NO_DUE_INSTALLMENT" | "MISSING_CONFIRMATION"
  | "COMPETING_CONFIRMATIONS" | "REUSED_PAYMENT_IDENTITY" | "WRONG_RECIPIENT" | "WRONG_AMOUNT"
  | "WRONG_DATE" | "MISSING_LEGAL_INSTRUCTION" | "UNMAPPED_BANK_ROUTE" | "OWNERSHIP_MISMATCH"
  | "UNSUPPORTED_WITHHOLDING" | "INCOMPLETE_HISTORY" | "EXHAUSTED_CLAIM";
export interface PensionDiagnostic {
  readonly sourceEntityPath: string;
  readonly period: BenefitPeriod;
  readonly effectiveAt?: CivilDate;
  readonly affectedOutput: "pension_payment_proof";
  readonly coverage: "incomplete";
  readonly diagnosticCode: PensionDiagnosticCode;
  readonly missingFacts: readonly string[];
  readonly ruleSnapshotId: string;
  readonly traceRefs: readonly string[];
}
export interface PensionPaymentIntent {
  readonly kind: "conditional_pension_cash_recognition_intent";
  readonly committed: false;
  readonly postable: false;
  readonly tax: "incomplete";
  readonly bankSettlement: "incomplete";
  readonly instrumentFamily: "defined_benefit_pension";
  readonly operationId: string;
  readonly claimId: string;
  readonly paymentId: string;
  readonly receiptId: string;
  readonly householdId: string;
  readonly actorId: string;
  readonly workerRecordId: string;
  readonly sponsorId: string;
  readonly planId: string;
  readonly pensionId: string;
  readonly entitlementId: string;
  readonly effectiveAt: CivilDate;
  readonly taxYear: number;
  readonly grossAmount: Money;
  readonly netAmount: Money;
  readonly destinationAccountId: string;
  readonly institutionId: string;
  readonly ruleSnapshotId: string;
  readonly source: PensionEvidence;
  readonly traceRefs: readonly string[];
  readonly dependsOn: readonly string[];
}
export interface PensionPaymentRequest {
  readonly householdId: string;
  readonly knownAt: CivilDate;
  readonly horizon: BenefitPeriod;
  readonly awards: readonly QuotedBenefit[];
  readonly originals: readonly OriginalPension[];
  readonly confirmations: readonly PensionBankConfirmation[];
  readonly instructions: readonly PensionInstruction[];
  readonly history: readonly PensionHistory[];
}
export interface PensionPaymentResult {
  readonly contract: "d2-shared/v1";
  readonly intents: readonly PensionPaymentIntent[];
  readonly diagnostics: readonly PensionDiagnostic[];
  readonly coverage: { readonly proof: "complete" | "incomplete"; readonly tax: "incomplete"; readonly bankSettlement: "incomplete" };
}
class Incomplete extends Error {
  constructor(readonly code: PensionDiagnosticCode, detail: string = code) { super(detail); }
}
function need(ok: boolean, code: PensionDiagnosticCode, detail?: string): asserts ok {
  if (!ok) throw new Incomplete(code, detail);
}
const ids = (...values: string[]): boolean => values.every(v => Boolean(v?.trim()));
const key = (parts: readonly string[]): string => JSON.stringify(parts);
const inside = (at: CivilDate, p: BenefitPeriod): boolean => at >= p.start && at < p.endExclusive;
const sorted = (values: readonly string[]): string[] => [...new Set(values)].sort();
function period(p: BenefitPeriod): void {
  civilDate(p.start); civilDate(p.endExclusive);
  if (p.start >= p.endExclusive) throw new Error("INVALID_PERIOD");
}
function immutable<T>(v: T): T {
  if (v === null || typeof v !== "object" || v instanceof Money) return v;
  if (Array.isArray(v)) return Object.freeze(v.map(x => immutable(x))) as T;
  return Object.freeze(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, immutable(x)]))) as T;
}
/** Exact structural comparison; DecimalAmount has private coefficient storage. */
function canonical(v: unknown): string {
  if (v instanceof Money) return key(["money", v.currency.code, v.amount.toString()]);
  if (v instanceof Ratio) return key(["ratio", v.value.toString()]);
  if (v instanceof DecimalAmount) return key(["decimal", v.toString()]);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object") return `{${Object.entries(v).filter(([, x]) => x !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(",")}}`;
  return JSON.stringify(v) ?? "undefined";
}
const terms = (a: QuotedBenefit): string => { const { awardId: _id, ...rest } = a; return canonical(rest); };
function evidence(e: PensionEvidence, at: CivilDate, cutoff: CivilDate, refs: string[]): void {
  refs.push(e.evidenceId, e.source.ruleSnapshotId);
  period(e.effective); civilDate(e.knownAt); civilDate(e.publishedAt); civilDate(e.source.asOf);
  need(ids(e.evidenceId, e.source.ruleSnapshotId, e.source.sourcePublication, e.source.version,
    e.source.jurisdiction, e.source.ruleFamily), "INVALID_IDENTITY");
  need(e.verified && e.source.projectionStatus === "verified" && e.publishedAt <= e.knownAt &&
    e.source.asOf <= e.knownAt && e.knownAt <= at && e.knownAt <= cutoff && inside(at, e.effective), "UNAVAILABLE_EVIDENCE");
}

/** Pure bounded proof. No ledger effects, priority, receipt consumption or cash. */
export function provePensionPayments(request: PensionPaymentRequest): PensionPaymentResult {
  period(request.horizon); civilDate(request.knownAt);
  if (!ids(request.householdId) || request.awards.length > 64 || request.originals.length > 64 ||
    request.history.length > 64 || request.confirmations.length > 76800 || request.instructions.length > 76800 ||
    request.history.some(h => h.installments.length > 1200)) throw new Error("REQUEST_LIMIT");
  const a1 = calculateQuotedBenefits({ householdId: request.householdId, horizon: request.horizon, awards: request.awards });
  const intents: PensionPaymentIntent[] = [], diagnostics: PensionDiagnostic[] = [];
  const diagnose = (a: QuotedBenefit, at: CivilDate | undefined, code: PensionDiagnosticCode, detail: string, refs: string[]): void => {
    diagnostics.push({ sourceEntityPath: key(["awards", a.awardId]), period: { ...request.horizon },
      ...(at ? { effectiveAt: at } : {}), affectedOutput: "pension_payment_proof", coverage: "incomplete",
      diagnosticCode: code, missingFacts: [detail], ruleSnapshotId: a.quote?.source.ruleSnapshotId ?? "unavailable",
      traceRefs: sorted(refs) });
  };
  for (const d of a1.diagnostics) {
    const a = request.awards.find(x => key(["awards", x.awardId]) === d.sourceEntityPath)!;
    const rejected = a1.recipientMonths.filter(row => row.awardId === a.awardId && row.coverage === "incomplete");
    if (rejected.length) for (const row of rejected) diagnose(a, row.effectiveAt, "A1_INCOMPLETE", d.diagnosticCode, [...d.traceRefs]);
    else diagnose(a, undefined, "A1_INCOMPLETE", d.diagnosticCode, [...d.traceRefs]);
  }
  for (const a of [...request.awards].sort((x, y) => x.awardId < y.awardId ? -1 : x.awardId > y.awardId ? 1 : 0)) {
    if (a.benefitKind !== "pension") { diagnose(a, undefined, "UNSUPPORTED_PENSION", "Pension proof cannot authorize SSA", []); continue; }
    const due = a1.proposals.filter(p => p.benefitKind === "pension" && p.claimId === key([
      "d2-quoted-benefit/v1", request.householdId, a.entitlementId, p.actorId, p.effectiveAt]) &&
      a1.recipientMonths.some(row => row.awardId === a.awardId && row.effectiveAt === p.effectiveAt && row.coverage === "complete"));
    for (const p of due) {
      const at = p.effectiveAt, refs = [...p.traceRefs];
      try {
        need(at <= request.knownAt, "UNAVAILABLE_EVIDENCE");
        const originals = request.originals.filter(o => o.entitlementId === a.entitlementId);
        need(originals.length === 1, "SOURCE_CONFLICT"); const o = originals[0]!;
        evidence(o.evidence, at, request.knownAt, refs);
        need(ids(o.pensionId, o.planId, o.sponsorId, o.entitlementId) && o.sponsorId === a.sponsorId &&
          o.entitlementId === o.award.entitlementId && o.sponsorId === o.award.sponsorId, "INVALID_IDENTITY");
        need(terms(o.award) === terms(a), "SOURCE_CONFLICT");
        need(o.employeeBasis === "none" && o.paymentMethod === "quoted_whole_installment" &&
          !a.medicareDeduction && !a.claimingAdjustment, "UNSUPPORTED_PENSION");
        const sources = [a.calendarSource, a.quote!.source, a.cola!.source, a.election!.source,
          ...a.cola!.changes.map(c => c.source), ...(a.election!.continuation ? [a.election!.continuation.source] : []),
          ...(a.withholding ? [a.withholding.source] : [])];
        need(sources.every(s => s.asOf <= o.evidence.knownAt), "UNAVAILABLE_EVIDENCE");
        const matches = request.confirmations.filter(c => c.effectiveAt === at &&
          (c.entitlementId === a.entitlementId || (c.pensionId === o.pensionId && c.planId === o.planId)));
        need(matches.length > 0, "MISSING_CONFIRMATION");
        need(matches.length === 1, "COMPETING_CONFIRMATIONS"); const c = matches[0]!;
        evidence(c.evidence, at, request.knownAt, refs);
        need(c.status === "posted", "UNAVAILABLE_EVIDENCE");
        need(c.evidence.source.sourcePublication !== a.quote!.source.sourcePublication &&
          c.evidence.evidenceId !== o.evidence.evidenceId, "SOURCE_CONFLICT", "Independent original payer BANK confirmation required");
        need(ids(c.confirmationId, c.paymentId, c.receiptId, c.authorizationId, c.fundingId, c.instructionId) &&
          c.pensionId === o.pensionId && c.planId === o.planId && c.sponsorId === o.sponsorId &&
          c.entitlementId === a.entitlementId, "INVALID_IDENTITY");
        need(c.recipientPersonId === p.actorId, "WRONG_RECIPIENT");
        civilDate(c.authorizedAt); civilDate(c.fundedAt);
        need(c.authorizedAt <= c.fundedAt && c.fundedAt === at, "WRONG_DATE");
        need(request.confirmations.filter(x => x.paymentId === c.paymentId || x.receiptId === c.receiptId ||
          x.confirmationId === c.confirmationId || x.fundingId === c.fundingId).length === 1, "REUSED_PAYMENT_IDENTITY");
        need(c.gross.equals(p.grossAmount) && c.net.equals(p.grossAmount), "WRONG_AMOUNT");
        need(Boolean(c.withholding?.length) && c.withholding!.every(w => ids(w.jurisdiction) &&
          w.amount.currency.equals(p.grossAmount.currency) && w.amount.isZero()) &&
          sorted(c.withholding!.map(w => w.jurisdiction)).length === c.withholding!.length &&
          (!p.withholdingInstruction || p.withholdingInstruction.isZero()), "UNSUPPORTED_WITHHOLDING");
        const instructions = request.instructions.filter(i => i.instructionId === c.instructionId);
        need(instructions.length === 1, "MISSING_LEGAL_INSTRUCTION"); const i = instructions[0]!;
        evidence(i.evidence, at, request.knownAt, refs);
        need(i.pensionId === o.pensionId && i.planId === o.planId && i.sponsorId === o.sponsorId &&
          i.entitlementId === a.entitlementId && i.recipientPersonId === p.actorId &&
          i.electionId === a.election!.electionId && i.electedForm === a.election!.form &&
          c.electionId === i.electionId && c.electedForm === i.electedForm, "MISSING_LEGAL_INSTRUCTION");
        need(c.route.kind === "bank" && ids(c.route.institutionId, c.route.destinationAccountId) &&
          ["checking", "savings"].includes(c.route.accountKind) && i.institutionId === c.route.institutionId &&
          i.destinationAccountId === c.route.destinationAccountId && i.accountKind === c.route.accountKind, "UNMAPPED_BANK_ROUTE");
        need(c.route.householdId === request.householdId && c.route.ownerPersonIds.includes(p.actorId), "OWNERSHIP_MISMATCH");
        const histories = request.history.filter(h => h.entitlementId === a.entitlementId);
        need(histories.length === 1, "INCOMPLETE_HISTORY"); const h = histories[0]!;
        evidence(h.evidence, at, request.knownAt, refs); period(h.covered);
        need(h.exhaustive && h.covered.start <= a.commencement && inside(at, h.covered), "INCOMPLETE_HISTORY");
        need(!request.history.some(x => x.installments.some(row => row.paymentId === c.paymentId || row.receiptId === c.receiptId)), "REUSED_PAYMENT_IDENTITY");
        need(!h.installments.some(row => row.effectiveAt === at && row.status !== "unpaid"), "EXHAUSTED_CLAIM");
        const past = at > a.commencement ? calculateQuotedBenefits({ householdId: request.householdId,
          horizon: { start: a.commencement, endExclusive: at }, awards: [a] }) : undefined;
        need(!past || past.diagnostics.length === 0, "INCOMPLETE_HISTORY");
        for (const prev of past?.proposals ?? []) {
          const rows = h.installments.filter(row => row.effectiveAt === prev.effectiveAt);
          need(rows.length === 1, "INCOMPLETE_HISTORY"); const row = rows[0]!;
          need(row.claimId === prev.claimId && row.recipientPersonId === prev.actorId &&
            ["unpaid", "paid", "exhausted"].includes(row.status) &&
            (row.status === "unpaid" ? !row.paymentId && !row.receiptId : ids(row.paymentId ?? "", row.receiptId ?? "")), "INCOMPLETE_HISTORY");
        }
        // Extra or substituted rows cannot make a history inventory exhaustive.
        // Future rows are assessed only when their own installment is evaluated.
        for (const row of h.installments.filter(row => row.effectiveAt <= at)) {
          civilDate(row.effectiveAt);
          const scheduled = row.effectiveAt === at ? p : past?.proposals.find(prev => prev.effectiveAt === row.effectiveAt);
          need(Boolean(scheduled) && row.claimId === scheduled!.claimId && row.recipientPersonId === scheduled!.actorId &&
            h.installments.filter(other => other.effectiveAt === row.effectiveAt).length === 1 &&
            ["unpaid", "paid", "exhausted"].includes(row.status) &&
            (row.status === "unpaid" ? !row.paymentId && !row.receiptId : ids(row.paymentId ?? "", row.receiptId ?? "")), "INCOMPLETE_HISTORY");
          if (row.status !== "unpaid") need(request.history.flatMap(other => other.installments)
            .filter(other => other.paymentId === row.paymentId || other.receiptId === row.receiptId).length === 1, "INCOMPLETE_HISTORY");
        }
        refs.push(c.confirmationId, c.paymentId, c.receiptId, c.authorizationId, c.fundingId, i.instructionId);
        intents.push({ kind: "conditional_pension_cash_recognition_intent", committed: false, postable: false,
          tax: "incomplete", bankSettlement: "incomplete", instrumentFamily: "defined_benefit_pension",
          operationId: key(["d2-pension-payment-proof/v1", p.claimId]), claimId: p.claimId,
          paymentId: c.paymentId, receiptId: c.receiptId, householdId: request.householdId, actorId: p.actorId,
          workerRecordId: p.workerRecordId, sponsorId: o.sponsorId, planId: o.planId, pensionId: o.pensionId,
          entitlementId: a.entitlementId, effectiveAt: at, taxYear: Number(at.slice(0, 4)), grossAmount: p.grossAmount,
          netAmount: c.net, destinationAccountId: c.route.destinationAccountId, institutionId: c.route.institutionId,
          ruleSnapshotId: p.ruleSnapshotId, source: c.evidence, traceRefs: sorted(refs), dependsOn: [p.operationId] });
      } catch (error) {
        diagnose(a, at, error instanceof Incomplete ? error.code : "UNAVAILABLE_EVIDENCE",
          error instanceof Error ? error.message : "Malformed documentary evidence", refs);
      }
    }
    for (const c of request.confirmations.filter(c => c.entitlementId === a.entitlementId && inside(c.effectiveAt, request.horizon))) {
      if (!due.some(p => p.effectiveAt === c.effectiveAt)) diagnose(a, c.effectiveAt, "NO_DUE_INSTALLMENT",
        "Confirmation cannot override A1 eligibility, cadence or ordering", [c.confirmationId]);
    }
  }
  for (const c of request.confirmations.filter(c => inside(c.effectiveAt, request.horizon) &&
    !request.awards.some(a => a.entitlementId === c.entitlementId))) {
    diagnostics.push({ sourceEntityPath: key(["confirmations", c.confirmationId]), period: { ...request.horizon },
      effectiveAt: c.effectiveAt, affectedOutput: "pension_payment_proof", coverage: "incomplete",
      diagnosticCode: "NO_DUE_INSTALLMENT", missingFacts: ["No matching A1 entitlement"],
      ruleSnapshotId: c.evidence.source.ruleSnapshotId, traceRefs: sorted([c.confirmationId, c.evidence.evidenceId]) });
  }
  intents.sort((a, b) => a.operationId < b.operationId ? -1 : a.operationId > b.operationId ? 1 : 0);
  diagnostics.sort((a, b) => canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0);
  return immutable({ contract: "d2-shared/v1", intents, diagnostics,
    coverage: { proof: diagnostics.length ? "incomplete" : "complete", tax: "incomplete", bankSettlement: "incomplete" } });
}
