import { type AccountId } from "../../../../accounting/index.js";
import { ValidationError } from "../../../../diagnostics/index.js";
import { domainId } from "../../../../identity/index.js";
import { calculationTraceId, calculationTraceRef } from "../../../../lineage/index.js";
import { createObligation, createRight } from "../../../../semantics/claim.js";
import { claimId, recognitionId, settlementId } from "../../../../semantics/identity.js";
import { prepareSsaMedicareDeductionProposals, type SsaDeductionSource, type SsaMedicareDeductionTerms,
  type SsaPayableEvidence, type SettlementDraft } from "../../../../semantics/settlement.js";
import { applySsaMedicarePaymentAtomically, cloneAuthoritativeState, createIndexedRecognitionFact,
  registerSsaMedicareSourceAuthority, validateAuthoritativeState, type AuthoritativeState, type SsaMedicarePaymentInput } from "../../../../state/index.js";
import { civilDate, instant } from "../../../../time/index.js";
import { Money, USD } from "../../../../values/index.js";
import { applyHouseholdExecutionOverlay, runHouseholdKernel, type CompiledHouseholdKernel,
  type HouseholdKernelParticipant } from "../../../householdExecution.js";
import { immutableConfiguration } from "../../../r3/compiledHousehold.js";
import { registerHouseholdParticipantCodec } from "../../../r3/participantCodec.js";
import { SummaryOperationSink } from "../../../r3/summarySink.js";
import { taxDiagnostic, taxOutputCapabilities } from "../../../tax/contracts.js";
import { canonicalSerialize, type RunContext } from "../../../run.js";
import { composeMedicareObligations, type MedicareCoordinationRequest } from "../../health/medicare/coordination/index.js";
import { coordinateSocialSecurity, type CoordinatedPayableAward } from "../../retirement/benefits/coordination/index.js";
import { reviewSsaMedicareOriginals, type SsaMedicareOriginalSources } from "./originalSources.js";
export { registerSsaMedicareOriginalSources, type SsaMedicareOriginalAdapter, type SsaMedicareOriginalSources } from "./originalSources.js";

/** Verified external source evidence is the trust boundary, as in A1/C2. These
 * inputs are immutable and portable; no publisher signature is inferred here.
 * A caller's complete flag or conditional proposal is never posting authority.
 */
export interface ConfirmedSsaMedicarePayment {
  readonly originalSources?: SsaMedicareOriginalSources;
  readonly a1: Parameters<typeof coordinateSocialSecurity>[0];
  readonly award: CoordinatedPayableAward;
  readonly c2: MedicareCoordinationRequest;
  readonly payable: SsaPayableEvidence;
  readonly deductions: readonly { readonly draft: SettlementDraft; readonly terms: SsaMedicareDeductionTerms }[];
  readonly rightSettlementId: string;
  readonly bank: { readonly classification: "BANK"; readonly accountId: AccountId;
    readonly householdId: string; readonly personId: string; readonly evidence: SsaDeductionSource };
  readonly bankCashBefore: Money;
}
export interface SsaMedicareInput {
  readonly householdId: string;
  readonly personId: string;
  /** Explicit additional recipients; each payment still has one owned BANK. */
  readonly memberIds?: readonly string[];
  readonly payments: readonly ConfirmedSsaMedicarePayment[];
}
const id = "d2_ssa_medicare";
const at = (date: string) => instant(`${date}T00:00:00.000Z`);
const same = (a: unknown, b: unknown): boolean => canonicalSerialize(a) === canonicalSerialize(b);
const orderedPayment = (q: ConfirmedSsaMedicarePayment): ConfirmedSsaMedicarePayment => ({ ...q,
  deductions: [...q.deductions].sort((a, b) => a.terms.premium.part.localeCompare(b.terms.premium.part)) });
const exact = (v: Money): boolean => v instanceof Money && v.currency.equals(USD) && v.amount.fitsScale(2) && !v.isNegative();
function fail(code: string, message: string): never {
  throw new ValidationError({ severity: "error", code, entityType: "ssa_medicare_payment", message });
}
const taxDiagnostics = [taxDiagnostic("ssa_provisional_income",
  "Gross SSA and Medicare cash execution is recorded. Social Security provisional income, deductibility and projected tax remain unsupported.")];
const capabilities = immutableConfiguration({ ...taxOutputCapabilities(taxDiagnostics),
  ssaMedicareExecution: { dependency: "tax_independent" as const, status: "complete" as const, diagnostics: [] },
  verifiedZeroSsaWithholding: { dependency: "tax_independent" as const, status: "complete" as const, diagnostics: [] } });

// Match every source field shared by the domain quote and the independently
// scoped legal evidence; source families/scope IDs retain their own contracts.
const lineage = (s: SsaDeductionSource, q: { readonly ruleSnapshotId: string; readonly version: string;
  readonly sourcePublication: string; readonly asOf: string; readonly jurisdiction: string; readonly projectionStatus: string }): boolean =>
  s.status === "verified" && q.projectionStatus === "verified" && s.jurisdiction === q.jurisdiction
  && s.ruleSnapshotId === q.ruleSnapshotId && s.version === q.version && s.sourcePublication === q.sourcePublication
  && s.asOf.slice(0, 10) === q.asOf;
const knownBy = (value: unknown, cutoff: string): boolean => {
  if (value === null || typeof value !== "object" || value instanceof Money) return true;
  if (Array.isArray(value)) return value.every(v => knownBy(v, cutoff));
  return Object.entries(value).every(([key, v]) =>
    ["asOf", "knownAt", "publishedAt"].includes(key) && typeof v === "string"
      ? (v.length === 10 ? at(v) : v) <= cutoff : knownBy(v, cutoff));
};

/** Recalculate both source owners and bind the complete exact deduction set. */
function qualifyPayment(q: ConfirmedSsaMedicarePayment, householdId: string, personId: string): SsaMedicarePaymentInput {
  const p = q.payable, award = q.award;
  const result = coordinateSocialSecurity(q.a1);
  const matches = result.proposals.filter(a => a.claimId === award.claimId);
  if (result.diagnostics.length || result.proposals.length !== 1 || matches.length !== 1 || !same(matches[0], award)
    || q.a1.householdId !== householdId || award.recipientPersonId !== personId
    || p.householdId !== householdId || p.recipientId !== personId || p.paymentId !== award.claimId
    || p.rightClaimId !== award.claimId || p.workerRecordId !== award.quotedAward.workerRecordPersonId
    || p.awardId !== award.quotedAward.awardId || p.entitlementId !== award.quotedAward.entitlementId
    || p.benefitKind !== award.quotedAward.benefitKind || !p.grossPayable.equals(award.grossAmount)
    || p.paymentAt !== at(award.effectiveAt) || !lineage(p.source, award.quotedAward.quote!.source))
    fail("SSA_SOURCE_NOT_ADMITTED", "Exact actual coordinated A1 recipient/worker/award/entitlement/installment and source required");
  const c = composeMedicareObligations(q.c2);
  if (q.c2.premiums.householdId !== householdId || q.c2.premiums.memberIds.length !== 1
    || q.c2.premiums.memberIds[0] !== personId || c.medicareTotalCoverage !== "complete"
    || q.c2.awards.length !== 1 || !same(q.c2.awards[0], award.quotedAward))
    fail("MEDICARE_SOURCE_NOT_ADMITTED", "Actual complete same-recipient C2 source result and A1 quoted award required");
  const positive = c.obligations.filter(o => o.memberObligation.isPositive());
  if (!positive.length || positive.length !== q.deductions.length || positive.some(o => !["part_b", "part_d"].includes(o.part))
    || q.deductions.some(d => !["part_b", "part_d"].includes(d.terms.premium.part))
    || c.obligations.some(o => o.personId !== personId || o.period.start.slice(0, 7) !== award.effectiveAt.slice(0, 7))
    || positive.some(o => o.intendedRoute.kind !== "ssa_benefit_deduction_pending" || o.intendedRoute.benefitId !== p.awardId))
    fail("SSA_MEDICARE_UNSUPPORTED_COVERAGE", "Only complete monthly B/D SSA deductions and explicit sourced-zero other Parts supported");
  const rightFact = createIndexedRecognitionFact({ id: recognitionId(p.rightRecognitionId), category: "ssa_gross_income",
    amount: p.grossPayable, recognizedAt: p.paymentAt });
  const right = createRight({ id: claimId(award.claimId), category: "ssa_benefit_payable", originatingRecognitionId: rightFact.id,
    economicOwnerId: domainId("person", personId), originalAmount: rightFact.amount, recognizedAt: p.paymentAt, dueAt: p.paymentAt });
  const requests = [...q.deductions].sort((a, b) => a.terms.premium.part.localeCompare(b.terms.premium.part)).map(({ draft, terms }) => {
    const e = terms.premium, rows = positive.filter(o => o.part === e.part), row = rows[0];
    const legal = q.c2.deductionTerms.filter(t => t.part === e.part && t.personId === personId
      && t.start <= e.periodStart && t.endExclusive >= e.periodEndExclusive);
    if (rows.length !== 1 || !row || legal.length !== 1 || !lineage(terms.source, legal[0]!.source)
      || !lineage(e.source, row.base.source) || e.householdId !== householdId || e.beneficiaryId !== personId
      || e.coverageId !== row.coverageId || e.providerId !== row.recipientId || terms.obligationId !== row.claimId
      || e.periodStart !== row.period.start || e.periodEndExclusive !== row.period.endExclusive
      || !e.base.equals(row.memberBase) || !e.irmaa.equals(row.surcharge) || !terms.amount.equals(row.memberObligation))
      fail("MEDICARE_SOURCE_NOT_ADMITTED", "Exact C2 Part/provider/coverage/month/base/IRMAA and legal source lineage required");
    const fact = createIndexedRecognitionFact({ id: recognitionId(terms.obligationRecognitionId), category: "medicare_expense",
      amount: row.memberObligation, recognizedAt: p.paymentAt });
    const claim = createObligation({ id: claimId(row.claimId), category: "medicare_premium", originatingRecognitionId: fact.id,
      economicOwnerId: domainId("person", personId), originalAmount: fact.amount, recognizedAt: p.paymentAt, dueAt: p.paymentAt });
    return { draft, terms, claim };
  });
  prepareSsaMedicareDeductionProposals(p, right, requests);
  const bank = q.bank, s = bank.evidence;
  const date = civilDate(p.paymentAt.slice(0, 10));
  civilDate(s.effectiveStart); civilDate(s.effectiveEndExclusive); instant(s.asOf); instant(s.publishedAt); instant(s.knownAt);
  if (bank.classification !== "BANK" || bank.householdId !== householdId || bank.personId !== personId
    || s.status !== "verified" || s.jurisdiction !== "US" || s.ruleFamily !== "bank_ownership" || s.scopeId !== bank.accountId
    || ![s.ruleSnapshotId, s.version, s.sourcePublication].every(v => typeof v === "string" && v.trim().length > 0)
    || s.effectiveStart > date || s.effectiveEndExclusive <= date || s.asOf > s.knownAt || s.publishedAt > s.knownAt
    || s.knownAt > p.paymentAt || !exact(q.bankCashBefore))
    fail("SSA_BANK_NOT_ADMITTED", "Explicit source-known existing recipient-owned USD BANK and exact cash required");
  return immutableConfiguration({ payable: p, right, requests, bankAccountId: bank.accountId, bankCashBefore: q.bankCashBefore,
    rightSettlementId: settlementId(q.rightSettlementId), sourceInputs: orderedPayment(q) });
}

export function qualifySsaMedicarePayment(q: ConfirmedSsaMedicarePayment, householdId: string, personId: string, cutoff?: string): SsaMedicarePaymentInput {
  try {
    const frozen = immutableConfiguration(q);
    const finish = reviewSsaMedicareOriginals(frozen, cutoff);
    const qualified = qualifyPayment(frozen, householdId, personId);
    finish();
    return qualified;
  }
  catch (error) {
    if (error instanceof ValidationError) throw error;
    return fail("SSA_MEDICARE_SOURCE_INCOMPLETE", "Valid complete source-owned A1/C2 and withholding evidence required");
  }
}

export function createSsaMedicareParticipant(configuration: SsaMedicareInput): HouseholdKernelParticipant {
  const members = configuration.memberIds ?? [configuration.personId];
  if (!members.includes(configuration.personId) || new Set(members).size !== members.length)
    fail("SSA_SOURCE_NOT_ADMITTED", "Every payment requires an explicitly admitted household recipient");
  const input = immutableConfiguration({ ...configuration, payments: configuration.payments.map(orderedPayment).sort((a, b) =>
    a.payable.paymentAt.localeCompare(b.payable.paymentAt) || a.payable.paymentId.localeCompare(b.payable.paymentId)) });
  return Object.freeze({ id, version: "ssa-medicare/v1", portableCodec: "d2-ssa-medicare/v1", economicInputs: input,
    prepare: (context, period, opening, work = [], tier = "detail") => {
      const seen = new Set<string>();
      const operations: ReturnType<HouseholdKernelParticipant["prepare"]>["operations"][number][] = [];
      validateSsaMedicareSourceHistory(opening.state, context.dataCutoff);
      for (const q of input.payments) {
        if (seen.has(q.payable.paymentId)) fail("SSA_DUPLICATE_PAYMENT", "Duplicate SSA payment identity in input");
        seen.add(q.payable.paymentId);
        const prior = Object.values(opening.state.ssaMedicarePayments ?? {}).find(r => r.payable.paymentId === q.payable.paymentId);
        if (prior && !same(prior.sourceInputs, q)) fail("SSA_CHANGED_PAYMENT", "Committed payment source/amount/version/account cannot change");
        if (q.payable.paymentAt < period.start || q.payable.paymentAt >= period.end) continue;
        if (!members.includes(q.payable.recipientId)) fail("SSA_SOURCE_NOT_ADMITTED", "Recipient absent from explicit household roster");
        const bound = qualifySsaMedicarePayment(q, input.householdId, q.payable.recipientId, context.dataCutoff);
        if (!context.baseCurrency.equals(USD) || !knownBy(q, context.dataCutoff))
          fail("SSA_SOURCE_NOT_ADMITTED", "All source facts must be known by the run data cutoff");
        validateAuthoritativeState(opening.state);
        if (prior) continue;
        const bank = opening.state.accounts[q.bank.accountId];
        if (!bank || bank.ownerId !== q.payable.recipientId || !["checking", "savings"].includes(bank.kind) || !exact(bank.cash))
          fail("SSA_BANK_NOT_ADMITTED", "Existing exact recipient-owned checking/savings account required");
        const operationId = `ssa-medicare:${q.payable.paymentId}`;
        const traceRefs = [...new Set([...q.award.traceRefs, ...q.c2.inventories.flatMap(i => [i.source.ruleSnapshotId]),
          ...q.deductions.flatMap(d => [d.terms.traceId, d.terms.receiptId]), q.bank.evidence.ruleSnapshotId])]
          .sort().map(ref => calculationTraceRef(calculationTraceId(ref)));
        if (work.some(w => w.sequencingInstant === q.payable.paymentAt && w.resourceAccesses.some(a => a.accountId === q.bank.accountId)
          && !w.dependsOn.includes(operationId))
          || input.payments.some(other => other !== q && other.payable.paymentAt === q.payable.paymentAt && other.bank.accountId === q.bank.accountId))
          fail("HOUSEHOLD_CONTENTION_UNRESOLVED", "Same-instant BANK work requires proven cross-source dependencies");
        operations.push({ descriptor: { id: operationId, domain: "cash_flow", operationClass: "cash_flow:ssa_medicare",
          sequencingInstant: q.payable.paymentAt, dependsOn: [],
          resourceAccesses: [{ kind: "account_cash", accountId: q.bank.accountId, mode: "produce" }], traceRefs },
          execute: candidate => {
            const state = cloneAuthoritativeState(candidate.state);
            const receipt = applySsaMedicarePaymentAtomically(state, bound);
            const facts = { outputCapabilities: capabilities, taxDiagnostics, traceRefs };
            if (tier === "summary") {
              const sink = new SummaryOperationSink(USD); sink.transaction(receipt.transaction);
              return { ...candidate, state, facts: { ...facts, summary: { evidence: sink.snapshot() } } };
            }
            return { ...candidate, state, facts: { ...facts, transactions: [receipt.transaction] } };
          } });
      }
      if (input.payments.some(q => q.payable.paymentAt < period.end)) operations.push({
        descriptor: { id: `ssa-medicare:tax-coverage:${period.start}`, domain: "cash_flow", operationClass: "cash_flow:ssa_tax_coverage",
          sequencingInstant: input.payments.some(q => q.payable.paymentAt < period.start) ? period.start
            : input.payments.find(q => q.payable.paymentAt >= period.start && q.payable.paymentAt < period.end)!.payable.paymentAt,
          dependsOn: [], resourceAccesses: [], traceRefs: [] },
        execute: candidate => ({ ...candidate, facts: { outputCapabilities: capabilities, taxDiagnostics } }),
      });
      return { id, operations };
    },
    // prepare receives built-in work only. Observe the existing scheduler's
    // isolated candidate stream as well, so another opt-in participant cannot
    // slip through an unproven same-instant BANK overlap. A direct successor
    // edge after this payment is an explicit, reviewable ordering proof.
    observe: (descriptor, _facts, runtime) => {
      for (const q of input.payments) {
        const own = `ssa-medicare:${q.payable.paymentId}`;
        if (descriptor.id !== own && descriptor.sequencingInstant === q.payable.paymentAt
          && descriptor.resourceAccesses.some(a => a.accountId === q.bank.accountId)
          && !descriptor.dependsOn.includes(own))
          fail("HOUSEHOLD_CONTENTION_UNRESOLVED", "SSA and other participant BANK work lack a proven dependency");
      }
      return runtime;
    },
  } satisfies HouseholdKernelParticipant);
}
registerHouseholdParticipantCodec({ codec: "d2-ssa-medicare/v1", restore: value => {
  const input = value as SsaMedicareInput;
  for (const q of input.payments) qualifySsaMedicarePayment(q, input.householdId, q.payable.recipientId);
  return createSsaMedicareParticipant(input);
} });
registerSsaMedicareSourceAuthority(value => {
  const q = value as ConfirmedSsaMedicarePayment;
  if (!q?.payable) return fail("SSA_MEDICARE_SOURCE_INCOMPLETE", "Raw coordinated source inputs required; a receipt is not source authority");
  return qualifySsaMedicarePayment(q, q.payable.householdId, q.payable.recipientId);
});

export function attachSsaMedicare(kernel: CompiledHouseholdKernel, input: SsaMedicareInput) {
  const participant = createSsaMedicareParticipant(input);
  const existing = kernel.executable.participants ?? [], prior = existing.find(p => p.id === id);
  if (prior && (prior.version !== participant.version || !same(prior.economicInputs, participant.economicInputs)))
    fail("SSA_CHANGED_PARTICIPANT", "Cannot replace an attached source-bound SSA participant");
  // Generic income has no SSA lineage contract: overlapping recipient streams
  // cannot be proved exclusive, even when they use another BANK/date.
  for (const q of input.payments) {
    if (q.originalSources !== undefined) qualifySsaMedicarePayment(q, input.householdId, q.payable.recipientId);
    const cash = kernel.executable.cashFlowInput;
    if (cash?.incomes.some(s => (s.ownerId === q.payable.recipientId || s.ownerId === input.householdId)
      && s.start <= q.payable.paymentAt && (!s.end || s.end > q.payable.paymentAt))
      || cash?.expenses.some(s => s.start <= q.payable.paymentAt && (!s.end || s.end > q.payable.paymentAt)
        && (s.sourceTraceRefs ?? []).some(ref => q.c2.premiums.coverages.some(c => ref.traceId === c.id || ref.traceId === c.quote.quoteId))))
      fail("SSA_EXCLUSIVE_REPRESENTATION_REQUIRED", "Overlapping generic income or premium stream lacks proven exclusive source representation");
  }
  return prior ? kernel : applyHouseholdExecutionOverlay(kernel, { participants: [...existing, participant] });
}
export function runSsaMedicare(request: { readonly kernel: CompiledHouseholdKernel; readonly input: SsaMedicareInput; readonly runContext: RunContext }) {
  return runHouseholdKernel({ kernel: attachSsaMedicare(request.kernel, request.input), runContext: request.runContext, resultTier: "detail" });
}

/** Replay/import consumers can requalify private receipt inputs independently. */
export function validateSsaMedicareSourceHistory(state: AuthoritativeState, cutoff?: string): void {
  for (const receipt of Object.values(state.ssaMedicarePayments ?? {})) {
    const q = receipt.sourceInputs as ConfirmedSsaMedicarePayment;
    if (cutoff !== undefined && !knownBy(q, cutoff)) fail("SSA_SOURCE_NOT_ADMITTED", "Committed payment contains facts after the run data cutoff");
    const bound = qualifySsaMedicarePayment(q, receipt.payable.householdId, receipt.payable.recipientId, cutoff);
    if (!same(bound.payable, receipt.payable) || !same(bound.requests, receipt.requests) || !same(bound.right, receipt.right)
      || bound.bankAccountId !== receipt.bankAccountId || !bound.bankCashBefore.equals(receipt.bankCashBefore)
      || bound.rightSettlementId !== receipt.rightSettlementId)
      fail("SSA_CHANGED_PAYMENT", "Committed receipt differs from requalified portable economic inputs");
  }
}
