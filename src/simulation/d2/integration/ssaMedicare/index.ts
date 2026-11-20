import { accountingTransactionId, type AccountId } from "../../../../accounting/index.js";
import { ValidationError } from "../../../../diagnostics/index.js";
import { domainId, idempotencyKey } from "../../../../identity/index.js";
import { calculationTraceId, calculationTraceRef } from "../../../../lineage/index.js";
import type { SsaDeductionSource, SsaMedicareDeductionTerms, SsaPayableEvidence, SettlementDraft } from "../../../../semantics/settlement.js";
import { applySsaMedicarePaymentAtomically, cloneAuthoritativeState, isNativeSsaMedicareOriginalInput,
  registerSsaMedicareSourceAuthority, ssaMedicarePaymentJournal, validateAuthoritativeState, type AuthoritativeState,
  type SsaMedicarePaymentInput, type SsaMedicarePaymentRecord } from "../../../../state/index.js";
import { instant, type Instant } from "../../../../time/index.js";
import { Money, USD } from "../../../../values/index.js";
import { applyHouseholdExecutionOverlay, householdPreparationAttempt, runHouseholdKernel, type CompiledHouseholdKernel,
  type HouseholdKernelParticipant } from "../../../householdExecution.js";
import { immutableConfiguration } from "../../../r3/compiledHousehold.js";
import { registerHouseholdParticipantCodec } from "../../../r3/participantCodec.js";
import { SummaryOperationSink } from "../../../r3/summarySink.js";
import { taxDiagnostic, taxOutputCapabilities } from "../../../tax/contracts.js";
import { canonicalSerialize, type RunContext } from "../../../run.js";
import type { MedicareCoordinationRequest } from "../../health/medicare/coordination/index.js";
import type { coordinateSocialSecurity, CoordinatedPayableAward } from "../../retirement/benefits/coordination/index.js";
import type { SsaMedicareOriginalSources } from "./originalSources.js";
import { qualifyDistinctWage, wageStreamOriginal } from "../householdWages/index.js";
import type { ConfirmedMedicareBankPremium } from "../medicareBank/index.js";
import type { RecurringIncomeStream, VerticalSlice2Input } from "../../../verticalSlice2.js";
import { qualifyNativeSsaMedicareInput, type NativeSsaMedicareOriginalInput } from "./nativeHouseholdOriginalBridge/index.js";
import { at, exact, fail, knownBy, orderedPayment, qualifyRawPayment, same } from "./nativeHouseholdOriginalBridge/qualification.js";
export { registerSsaMedicareOriginalSources, type SsaMedicareOriginalAdapter, type SsaMedicareOriginalSources } from "./originalSources.js";
export { registerNativeSsaMedicareOriginalProviders } from "./nativeHouseholdOriginalBridge/index.js";

export type NativeSsaMedicareOccurrence = Pick<NativeSsaMedicareOriginalInput, "ssaPublisherId" | "medicarePublisherId"> &
  Pick<NativeSsaMedicareOriginalInput["context"], "eventId" | "eventAt" | "personId" | "bankAccountId">;

/** Verified external source evidence is the trust boundary, as in A1/C2. These
 * inputs are immutable and portable; no publisher signature is inferred here.
 * A caller's complete flag or conditional proposal is never posting authority.
 */
export interface ConfirmedSsaMedicarePayment {
  readonly nativeHousehold?: SsaMedicarePaymentInput["nativeHousehold"];
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
export type SsaMedicarePaymentFacts = Omit<ConfirmedSsaMedicarePayment, "bank"> & {
  readonly bank: Omit<ConfirmedSsaMedicarePayment["bank"], "evidence"> & { readonly evidence?: SsaDeductionSource };
};
export interface SsaMedicareInput {
  readonly exclusiveWages?: readonly RecurringIncomeStream[];
  readonly householdId: string;
  readonly personId: string;
  /** Explicit additional recipients; each payment still has one owned BANK. */
  readonly memberIds?: readonly string[];
  readonly payments: readonly ConfirmedSsaMedicarePayment[];
  readonly nativePayments?: readonly NativeSsaMedicareOccurrence[];
}
const id = "d2_ssa_medicare";
const ownedParticipants = new WeakSet<object>();
const boundToRun = (source: NativeSsaMedicareOriginalInput["context"], context: RunContext): boolean =>
  source.runId === context.runId && source.asOf === context.asOf && source.dataCutoff === context.dataCutoff;
function verifyDistinctWages(wages: readonly RecurringIncomeStream[], q: SsaMedicarePaymentFacts, context: RunContext): void {
  recheckDistinctWages(wages, q.payable, q.originalSources !== undefined, context);
}
function recheckDistinctWages(wages: readonly RecurringIncomeStream[], p: SsaPayableEvidence,
  hasOriginals: boolean, context: RunContext): void {
  for (const wage of wages) {
    if (wage.ownerId !== p.recipientId || wage.start > p.paymentAt || wage.end !== undefined && wage.end <= p.paymentAt) continue;
    if (!hasOriginals) fail("SSA_EXCLUSIVE_REPRESENTATION_REQUIRED", "Wage exclusivity requires independently authenticated SSA originals");
    if (wage.householdWageSource === undefined) fail("SSA_EXCLUSIVE_REPRESENTATION_REQUIRED", "Independent employer original required");
    try {
      qualifyDistinctWage(wage.householdWageSource!, wageStreamOriginal(wage), { runId: context.runId, asOf: context.asOf, dataCutoff: context.dataCutoff,
        householdId: domainId("household", p.householdId), personId: domainId("person", p.recipientId),
        bankAccountId: wage.depositAccountId, direction: "credit", eventAt: p.paymentAt, eventId: `ssa-exclusivity:${p.paymentId}` });
    } catch { fail("SSA_EXCLUSIVE_REPRESENTATION_REQUIRED", "Overlapping wage lacks independent current employer authority"); }
  }
}
function nativeInput(event: NativeSsaMedicareOccurrence, householdId: string, context: RunContext, bankCashBefore: Money): NativeSsaMedicareOriginalInput {
  const { ssaPublisherId, medicarePublisherId, eventId, eventAt, personId, bankAccountId } = event;
  return { mode: "ssa-medicare-originals/v2", ssaPublisherId, medicarePublisherId, bankCashBefore, context: {
    runId: context.runId, asOf: context.asOf, dataCutoff: context.dataCutoff, direction: "credit",
    householdId: domainId("household", householdId), eventId, eventAt, personId, bankAccountId,
  } };
}
function verifyExclusiveMedicareRoute(participants: readonly HouseholdKernelParticipant[], event: NativeSsaMedicareOccurrence, householdId: string) {
  for (const participant of participants) {
    if (participant.portableCodec !== "d2-medicare-bank/v1") continue;
    const input = participant.economicInputs as { readonly confirmed: readonly ConfirmedMedicareBankPremium[] };
    if (input.confirmed.some(({ obligation }) => obligation.householdId === householdId && obligation.personId === event.personId &&
      event.eventAt >= at(obligation.period.start) && event.eventAt < at(obligation.period.endExclusive)))
      fail("MEDICARE_DOUBLE_ROUTE", "A source-bound BANK Medicare month cannot also execute an SSA Medicare payment");
  }
}
const taxDiagnostics = [taxDiagnostic("ssa_provisional_income",
  "Gross SSA and Medicare cash execution is recorded. Social Security provisional income, deductibility and projected tax remain unsupported.")];
const capabilities = immutableConfiguration({ ...taxOutputCapabilities(taxDiagnostics),
  ssaMedicareExecution: { dependency: "tax_independent" as const, status: "complete" as const, diagnostics: [] },
  verifiedZeroSsaWithholding: { dependency: "tax_independent" as const, status: "complete" as const, diagnostics: [] } });

export function qualifySsaMedicarePayment(q: ConfirmedSsaMedicarePayment, householdId: string, personId: string, cutoff?: string): SsaMedicarePaymentInput {
  if (q.originalSources?.mode === "ssa-medicare-originals/v2")
    fail("SSA_SOURCE_NOT_ADMITTED", "Native SSA must enter through the independent original reader");
  return qualifyRawPayment(q, householdId, personId, cutoff);
}

export function createSsaMedicareParticipant(configuration: SsaMedicareInput): HouseholdKernelParticipant {
  const members = configuration.memberIds ?? [configuration.personId];
  if (!members.includes(configuration.personId) || new Set(members).size !== members.length)
    fail("SSA_SOURCE_NOT_ADMITTED", "Every payment requires an explicitly admitted household recipient");
  const input = immutableConfiguration({ ...configuration, payments: configuration.payments.map(orderedPayment).sort((a, b) =>
    a.payable.paymentAt.localeCompare(b.payable.paymentAt) || a.payable.paymentId.localeCompare(b.payable.paymentId)),
    ...(configuration.nativePayments === undefined ? {} : { nativePayments: [...configuration.nativePayments].sort((a, b) =>
      a.eventAt.localeCompare(b.eventAt) || a.eventId.localeCompare(b.eventId)) }) });
  const events = input.nativePayments ?? [];
  const firstPayment = input.payments[0]?.payable.paymentAt, firstNative = events[0]?.eventAt;
  const first = firstPayment === undefined || firstNative !== undefined && firstNative < firstPayment ? firstNative : firstPayment;
  const memberMonth = (personId: string, date: Instant) => JSON.stringify([personId, date.slice(0, 7)]);
  const legacyMonths = new Set(input.payments.map(q => memberMonth(q.payable.recipientId, q.payable.paymentAt)));
  if (events.some(event => !members.includes(event.personId)) || new Set(events.map(event => event.eventId)).size !== events.length ||
    new Set(events.map(event => memberMonth(event.personId, event.eventAt))).size !== events.length ||
    events.some(event => legacyMonths.has(memberMonth(event.personId, event.eventAt))))
    fail("SSA_DUPLICATE_PAYMENT", "Native events require distinct source identities and admitted recipients");
  const dueByMonth = new Map<string, NativeSsaMedicareOccurrence[]>();
  const liveSourceChecks = new WeakMap<SsaMedicarePaymentRecord, () => void>();
  const admittedOpenings = new WeakSet<object>();
  for (const event of events) {
    instant(event.eventAt);
    const month = event.eventAt.slice(0, 7);
    const due = dueByMonth.get(month) ?? [];
    due.push(event); dueByMonth.set(month, due);
  }
  const participant = Object.freeze({ id, version: "ssa-medicare/v1", portableCodec: "d2-ssa-medicare/v1", economicInputs: input,
    prepare: (context, period, opening, work = [], tier = "detail") => {
      const seen = new Set<string>();
      const operations: ReturnType<HouseholdKernelParticipant["prepare"]>["operations"][number][] = [];
      // The scheduler's context is period-scoped: simulationStart equals
      // period.start on EVERY prepare, not just at run admission. Use state's
      // fully validated indexed lineage for unchanged live receipts. Cold or
      // untracked roots still authenticate every original through that validator.
      // Replay's explicit source-history entry point remains exhaustive.
      validateAuthoritativeState(opening.state);
      const attempt = householdPreparationAttempt(opening);
      const indexedNativeHistory = attempt?.hasExternalParticipants === false && input.payments.length === 0 && admittedOpenings.has(attempt);
      const history = indexedNativeHistory ? [] : Object.values(opening.state.ssaMedicarePayments ?? {});
      const byPaymentId = new Map(history.map(receipt => [receipt.payable.paymentId, receipt]));
      for (const receipt of history) {
        if (isNativeSsaMedicareOriginalInput(receipt.sourceInputs)) {
          if (receipt.payable.paymentAt >= period.start)
            fail("SSA_CHANGED_PAYMENT", "Period opening contains a current or future native SSA installment");
          const source = receipt.sourceInputs as NativeSsaMedicareOriginalInput;
          const sameRun = boundToRun(source.context, context);
          // This run already admitted the posting and will reobserve it at
          // release. Independent direct preparation still reads originals.
          if (attempt !== undefined && sameRun) continue;
          const check = sameRun ? liveSourceChecks.get(receipt) : undefined;
          if (check) check();
          else validateNativeSsaMedicareReceipt(receipt, context, sameRun
            ? verify => liveSourceChecks.set(receipt, verify) : undefined);
          continue;
        }
        const q = receipt.sourceInputs as ConfirmedSsaMedicarePayment;
        if (!knownBy(q, context.dataCutoff) || q.originalSources !== undefined && q.originalSources.dataCutoff !== context.dataCutoff)
          fail("SSA_SOURCE_NOT_ADMITTED", "Committed payment source cutoff differs from the current run");
      }
      if (attempt !== undefined) admittedOpenings.add(attempt);
      const due = (dueByMonth.get(period.start.slice(0, 7)) ?? []).filter(event => event.eventAt >= period.start && event.eventAt < period.end);
      const planned: { q: SsaMedicarePaymentFacts; native?: SsaMedicarePaymentInput }[] = input.payments.map(q => ({ q }));
      for (const event of due) {
        const bank = opening.state.accounts[event.bankAccountId];
        if (!bank) fail("SSA_BANK_NOT_ADMITTED", "Recipient household BANK is missing");
        const qualified = qualifyNativeSsaMedicareInput(nativeInput(event, input.householdId, context, bank.cash));
        planned.push({ q: qualified.raw, native: qualified.payment });
      }
      for (const { q, native } of planned) {
        if (seen.has(q.payable.paymentId)) fail("SSA_DUPLICATE_PAYMENT", "Duplicate SSA payment identity in input");
        seen.add(q.payable.paymentId);
        const prior = byPaymentId.get(q.payable.paymentId);
        if (indexedNativeHistory && opening.state.identities.externalIdempotencyKeys.includes(idempotencyKey("ssa-medicare:payment", q.payable.paymentId)))
          fail("SSA_CHANGED_PAYMENT", "A native SSA installment cannot post twice");
        if (prior && (!same(prior.sourceInputs, native?.sourceInputs ?? q) || native !== undefined)) fail("SSA_CHANGED_PAYMENT", "Committed payment source/amount/version/account cannot change or post twice");
        if (q.payable.paymentAt < period.start || q.payable.paymentAt >= period.end) continue;
        if (!members.includes(q.payable.recipientId)) fail("SSA_SOURCE_NOT_ADMITTED", "Recipient absent from explicit household roster");
        const reviewWages = () => verifyDistinctWages(input.exclusiveWages ?? [], q, context);
        reviewWages();
        const bound = native ?? qualifySsaMedicarePayment(q as ConfirmedSsaMedicarePayment, input.householdId, q.payable.recipientId, context.dataCutoff);
        if (bound.nativeHousehold !== undefined && (q.originalSources === undefined ||
          bound.nativeHousehold.context.runId !== context.runId || bound.nativeHousehold.context.asOf !== context.asOf ||
          bound.nativeHousehold.context.dataCutoff !== context.dataCutoff))
          fail("SSA_SOURCE_NOT_ADMITTED", "Household SSA requires independent originals and the actual run observation boundary");
        if (!context.baseCurrency.equals(USD) || !knownBy(q, context.dataCutoff))
          fail("SSA_SOURCE_NOT_ADMITTED", "All source facts must be known by the run data cutoff");
        validateAuthoritativeState(opening.state);
        if (prior) continue;
        const bank = opening.state.accounts[q.bank.accountId];
        const bankOwner = native !== undefined ? bound.nativeHousehold?.route?.personOwnerId ?? input.householdId
          : bound.nativeHousehold ? input.householdId : q.payable.recipientId;
        if (!bank || bank.ownerId !== bankOwner || !["checking", "savings"].includes(bank.kind) || !exact(bank.cash))
          fail("SSA_BANK_NOT_ADMITTED", "Existing exact recipient-owned checking/savings account required");
        const operationId = `ssa-medicare:${q.payable.paymentId}`;
        if (native !== undefined && work.some(descriptor => descriptor.id.startsWith("cash-expense:") &&
          descriptor.traceRefs.some(ref => q.c2.premiums.coverages.some(coverage =>
            ref.traceId === coverage.id || ref.traceId === coverage.quote.quoteId))))
          fail("SSA_EXCLUSIVE_REPRESENTATION_REQUIRED", "A separate premium stream overlaps its SSA deduction");
        const traceRefs = [...new Set([...q.award.traceRefs, ...q.c2.inventories.flatMap(i => [i.source.ruleSnapshotId]),
          ...q.deductions.flatMap(d => [d.terms.traceId, d.terms.receiptId]), q.bank.evidence?.ruleSnapshotId ?? bound.nativeHousehold!.route!.digest])]
          .sort().map(ref => calculationTraceRef(calculationTraceId(ref)));
        if (work.some(w => w.sequencingInstant === q.payable.paymentAt && w.resourceAccesses.some(a => a.accountId === q.bank.accountId)
          && !w.dependsOn.includes(operationId))
          || planned.some(({ q: other }) => other !== q && other.payable.paymentAt === q.payable.paymentAt && other.bank.accountId === q.bank.accountId))
          fail("HOUSEHOLD_CONTENTION_UNRESOLVED", "Same-instant BANK work requires proven cross-source dependencies");
        operations.push({ descriptor: { id: operationId, domain: "cash_flow", operationClass: "cash_flow:ssa_medicare",
          sequencingInstant: q.payable.paymentAt, dependsOn: [],
          resourceAccesses: [{ kind: "account_cash", accountId: q.bank.accountId, mode: "produce" }], traceRefs },
          execute: candidate => {
            reviewWages();
            const state = cloneAuthoritativeState(candidate.state);
            const source = native === undefined ? bound : { ...bound, bankCashBefore: state.accounts[q.bank.accountId]!.cash,
              sourceInputs: { ...(bound.sourceInputs as NativeSsaMedicareOriginalInput), bankCashBefore: state.accounts[q.bank.accountId]!.cash } };
            const receipt = applySsaMedicarePaymentAtomically(state, source, context);
            reviewWages();
            const facts = { outputCapabilities: capabilities, taxDiagnostics, traceRefs };
            if (tier === "summary") {
              const sink = new SummaryOperationSink(USD); sink.transaction(receipt.transaction);
              return { ...candidate, state, facts: { ...facts, summary: { evidence: sink.snapshot() } } };
            }
            return { ...candidate, state, facts: { ...facts, transactions: [receipt.transaction] } };
          } });
      }
      if (first !== undefined && first < period.end) operations.push({
        descriptor: { id: `ssa-medicare:tax-coverage:${period.start}`, domain: "cash_flow", operationClass: "cash_flow:ssa_tax_coverage",
          sequencingInstant: first < period.start ? period.start : first,
          dependsOn: [], resourceAccesses: [], traceRefs: [] },
        execute: candidate => ({ ...candidate, facts: { outputCapabilities: capabilities, taxDiagnostics } }),
      });
      return { id, operations };
    },
    // prepare receives built-in work only. Observe the existing scheduler's
    // isolated candidate stream as well, so another opt-in participant cannot
    // slip through an unproven same-instant BANK overlap. A direct successor
    // edge after this payment is an explicit, reviewable ordering proof.
    observe: (descriptor, _facts, runtime, observation) => {
      for (const event of dueByMonth.get(descriptor.sequencingInstant.slice(0, 7)) ?? []) {
        if (descriptor.sequencingInstant !== event.eventAt) continue;
        if (descriptor.id === event.eventId) {
          const proof = observation?.postingProofs?.[accountingTransactionId(event.eventId)];
          const attachment = proof?.registration.nativeHousehold;
          if (!attachment || !observation || !boundToRun(attachment.context, observation.context))
            fail("SSA_SOURCE_NOT_ADMITTED", "Posted native SSA requires the actual run boundary");
          const checked = qualifyNativeSsaMedicareInput(nativeInput(event, input.householdId, observation.context, Money.zero(USD))).payment;
          if (!same(checked.nativeHousehold, attachment) || !same(ssaMedicarePaymentJournal(checked), proof!.transaction))
            fail("SSA_CHANGED_PAYMENT", "Posted SSA proof differs from current independent originals");
        } else if (descriptor.resourceAccesses.some(access => access.accountId === event.bankAccountId) &&
          !descriptor.dependsOn.includes(event.eventId))
          fail("HOUSEHOLD_CONTENTION_UNRESOLVED", "SSA and other participant BANK work lack a proven dependency");
      }
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
  ownedParticipants.add(participant);
  return participant;
}
registerHouseholdParticipantCodec({ codec: "d2-ssa-medicare/v1", restore: value => {
  const input = value as SsaMedicareInput;
  for (const q of input.payments) qualifySsaMedicarePayment(q, input.householdId, q.payable.recipientId);
  return createSsaMedicareParticipant(input);
} });
registerSsaMedicareSourceAuthority((value, observation) => {
  if (isNativeSsaMedicareOriginalInput(value)) return qualifyNativeSsaMedicareInput(value as NativeSsaMedicareOriginalInput, observation).payment;
  const q = value as ConfirmedSsaMedicarePayment;
  if (!q?.payable) return fail("SSA_MEDICARE_SOURCE_INCOMPLETE", "Raw coordinated source inputs required; a receipt is not source authority");
  return qualifySsaMedicarePayment(q, q.payable.householdId, q.payable.recipientId);
}, participant => ownedParticipants.has(participant));

export function attachSsaMedicare(kernel: CompiledHouseholdKernel, input: SsaMedicareInput) {
  const wages = kernel.executable.cashFlowInput?.incomes ?? [];
  const sources = wages.filter(w => w.householdWageSource !== undefined).map(w => canonicalSerialize(w.householdWageSource!.original));
  if (new Set(sources).size !== sources.length || new Set(wages.map(w => w.id)).size !== wages.length)
    fail("SSA_EXCLUSIVE_REPRESENTATION_REQUIRED", "Duplicated wage source or stream cannot establish exclusivity");
  const participant = createSsaMedicareParticipant({ ...input, ...(sources.length === 0 ? {} : { exclusiveWages: wages.filter(w => w.householdWageSource !== undefined) }) });
  const existing = kernel.executable.participants ?? [], prior = existing.find(p => p.id === id);
  if (prior && (prior.version !== participant.version || !same(prior.economicInputs, participant.economicInputs)))
    fail("SSA_CHANGED_PARTICIPANT", "Cannot replace an attached source-bound SSA participant");
  for (const event of input.nativePayments ?? []) {
    verifyExclusiveMedicareRoute(existing, event, input.householdId);
    if (wages.some(wage => (wage.ownerId === event.personId || wage.ownerId === input.householdId) &&
      wage.start <= event.eventAt && (wage.end === undefined || wage.end > event.eventAt) &&
      (wage.ownerId === input.householdId || wage.householdWageSource?.original.family !== "wage")))
      fail("SSA_EXCLUSIVE_REPRESENTATION_REQUIRED", "Overlapping income requires an independent distinct wage original");
  }
  // Generic income has no SSA lineage contract: overlapping recipient streams
  // cannot be proved exclusive, even when they use another BANK/date.
  for (const q of input.payments) {
    if (q.originalSources !== undefined) qualifySsaMedicarePayment(q, input.householdId, q.payable.recipientId);
    const cash = kernel.executable.cashFlowInput;
    if (cash?.incomes.some(s => (s.ownerId === q.payable.recipientId || s.ownerId === input.householdId)
      && s.start <= q.payable.paymentAt && (!s.end || s.end > q.payable.paymentAt)
      && (s.ownerId === input.householdId || s.householdWageSource?.original.family !== "wage"))
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
export function validateSsaMedicareSourceHistory(state: AuthoritativeState, cutoff?: string, current?: Pick<RunContext, "asOf" | "dataCutoff">): void {
  for (const receipt of Object.values(state.ssaMedicarePayments ?? {})) {
    if (isNativeSsaMedicareOriginalInput(receipt.sourceInputs)) {
      const source = receipt.sourceInputs as NativeSsaMedicareOriginalInput;
      const observation = current ?? source.context;
      if (cutoff !== undefined && observation.dataCutoff !== cutoff)
        fail("SSA_SOURCE_NOT_ADMITTED", "Native SSA source history requires its actual observation boundary");
      validateNativeSsaMedicareReceipt(receipt, observation);
      continue;
    }
    validateLegacySsaMedicareReceipt(receipt, cutoff);
  }
}

function validateLegacySsaMedicareReceipt(receipt: SsaMedicarePaymentRecord, cutoff?: string): void {
  const q = receipt.sourceInputs as ConfirmedSsaMedicarePayment;
  if (cutoff !== undefined && !knownBy(q, cutoff)) fail("SSA_SOURCE_NOT_ADMITTED", "Committed payment contains facts after the run data cutoff");
  const bound = qualifySsaMedicarePayment(q, receipt.payable.householdId, receipt.payable.recipientId, cutoff);
  if (!same(bound.payable, receipt.payable) || !same(bound.requests, receipt.requests) || !same(bound.right, receipt.right)
    || bound.bankAccountId !== receipt.bankAccountId || !bound.bankCashBefore.equals(receipt.bankCashBefore)
    || bound.rightSettlementId !== receipt.rightSettlementId)
    fail("SSA_CHANGED_PAYMENT", "Committed receipt differs from requalified portable economic inputs");
}

function assertNativeSsaMedicareReceipt(receipt: SsaMedicarePaymentRecord, qualified: SsaMedicarePaymentInput): void {
  const { version: _version, id: _id, netBank: _netBank, transaction, recognitions: _recognitions, ...input } = receipt;
  if (!same(qualified, input) || !same(ssaMedicarePaymentJournal(qualified), transaction))
    fail("SSA_CHANGED_PAYMENT", "Committed native SSA receipt no longer matches current originals");
}

function validateNativeSsaMedicareReceipt(receipt: SsaMedicarePaymentRecord, observation: Pick<RunContext, "asOf" | "dataCutoff">,
  retainSourceCheck?: (check: () => void) => void) {
  let checkSources: (() => void) | undefined;
  const qualified = qualifyNativeSsaMedicareInput(receipt.sourceInputs as NativeSsaMedicareOriginalInput, observation,
    retainSourceCheck === undefined ? undefined : check => { checkSources = check; }).payment;
  assertNativeSsaMedicareReceipt(receipt, qualified);
  if (checkSources !== undefined) retainSourceCheck?.(checkSources);
}

/** Requalify receipt history and reconcile independent occurrences against each
 * committed frontier. State owns validation of claims, proof and identities. */
export function validateSsaMedicareReplayHistory(
  participants: readonly HouseholdKernelParticipant[] | undefined, opening: AuthoritativeState,
  context: RunContext, checkpoints: readonly { readonly at: Instant; readonly state: AuthoritativeState }[],
  terminal: { readonly at: Instant; readonly state: AuthoritativeState }, cashFlow?: VerticalSlice2Input,
): () => void {
  const participant = participants?.find(p => p.id === id);
  const input = participant?.economicInputs as SsaMedicareInput | undefined;
  const events = input?.nativePayments ?? [];
  const inherited = new Map<string, SsaMedicarePaymentRecord>(), expected = new Set<string>();
  const wages = cashFlow?.incomes ?? [];
  const wageChecks: SsaPayableEvidence[] = [];
  const legacy: SsaMedicarePaymentRecord[] = [];
  for (const receipt of Object.values(opening.ssaMedicarePayments ?? {})) {
    if (!isNativeSsaMedicareOriginalInput(receipt.sourceInputs)) continue;
    if (receipt.payable.paymentAt >= context.simulationStart)
      fail("SSA_CHANGED_PAYMENT", "Opening SSA history contains a current or future installment");
    validateNativeSsaMedicareReceipt(receipt, context);
    const terminalReceipt = terminal.state.ssaMedicarePayments?.[receipt.id];
    if (receipt !== terminalReceipt && !same(receipt, terminalReceipt))
      fail("SSA_CHANGED_PAYMENT", "Committed native SSA opening history changed during replay");
    inherited.set(receipt.id, receipt);
  }
  let next = 0;
  for (const frontier of [...checkpoints, terminal]) {
    while (next < events.length && events[next]!.eventAt < frontier.at) {
      const event = events[next++]!;
      const paymentId = event.eventId.slice("ssa-medicare:".length);
      const key = JSON.stringify([input!.householdId, event.personId, paymentId]);
      const receipt = frontier.state.ssaMedicarePayments?.[key];
      if (event.eventAt < context.simulationStart) {
        const prior = inherited.get(key);
        const source = prior?.sourceInputs as NativeSsaMedicareOriginalInput | undefined;
        if (!source || source.context.eventAt !== event.eventAt || source.context.eventId !== event.eventId ||
          source.context.bankAccountId !== event.bankAccountId || source.ssaPublisherId !== event.ssaPublisherId ||
          source.medicarePublisherId !== event.medicarePublisherId || !same(prior, receipt))
          fail("SSA_CHANGED_PAYMENT", "Declared pre-run SSA installment is missing from opening history");
        continue;
      }
      // Requalify the source even when the entire receipt/proof was omitted.
      const source = nativeInput(event, input!.householdId, context, receipt?.bankCashBefore ?? Money.zero(USD));
      const { payment: qualified, raw } = qualifyNativeSsaMedicareInput(source);
      verifyExclusiveMedicareRoute(participants ?? [], event, input!.householdId);
      if (cashFlow?.incomes.some(wage => (wage.ownerId === event.personId || wage.ownerId === input!.householdId) &&
        wage.start <= event.eventAt && (wage.end === undefined || wage.end > event.eventAt) &&
        (wage.ownerId === input!.householdId || wage.householdWageSource?.original.family !== "wage")) ||
        cashFlow?.expenses.some(stream => stream.start < at(raw.c2.premiums.period.endExclusive) &&
          (stream.end === undefined || stream.end > at(raw.c2.premiums.period.start)) &&
          stream.sourceTraceRefs?.some(ref => raw.c2.premiums.coverages.some(coverage =>
            ref.traceId === coverage.id || ref.traceId === coverage.quote.quoteId))))
        fail("SSA_EXCLUSIVE_REPRESENTATION_REQUIRED", "Restored income or premium stream overlaps source-qualified SSA");
      verifyDistinctWages(wages, raw, context);
      if (wages.length > 0) wageChecks.push(qualified.payable);
      const proof = frontier.state.d2PostedTransactions?.[accountingTransactionId(event.eventId)];
      if (!receipt || receipt.version !== "ssa-medicare-payment/v3" || !same(receipt.sourceInputs, source) ||
        proof?.registration.kind !== "ssa_medicare_payment" || proof.registration.paymentKey !== key ||
        !same(proof.registration.nativeHousehold, qualified.nativeHousehold) || !same(proof.transaction, receipt.transaction))
        fail("SSA_CHANGED_PAYMENT", "Due native SSA installment is missing its exact receipt and dual-original proof");
      assertNativeSsaMedicareReceipt(receipt, qualified);
      const terminalReceipt = terminal.state.ssaMedicarePayments?.[key];
      if (receipt !== terminalReceipt && !same(receipt, terminalReceipt))
        fail("SSA_CHANGED_PAYMENT", "Committed native SSA installment changed after its first frontier");
      expected.add(key);
    }
  }
  for (const receipt of Object.values(terminal.state.ssaMedicarePayments ?? {})) {
    if (!isNativeSsaMedicareOriginalInput(receipt.sourceInputs)) {
      validateLegacySsaMedicareReceipt(receipt, context.dataCutoff);
      legacy.push(receipt);
    }
    else if (!expected.has(receipt.id) && !inherited.has(receipt.id))
      fail("SSA_CHANGED_PAYMENT", "Committed native SSA payment falls outside the qualified frontier");
  }
  // Valid only alongside a fresh observation of this same immutable terminal
  // journal. That observation rebuilds every admitted native receipt from its
  // current SSA, Medicare and BANK publishers. Due-event completeness and
  // stream overlap are structural once the exact receipts have been bound.
  return () => {
    for (const payable of wageChecks) recheckDistinctWages(wages, payable, true, context);
    for (const receipt of legacy) validateLegacySsaMedicareReceipt(receipt, context.dataCutoff);
  };
}
