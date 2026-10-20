import { applyAccountingTransactionAtomically, applyD2SettlementAtomically, requalifyD2SettlementReceiptHistory,
  type AuthoritativeState, type D2FsaSettlementReceipt } from "../../../../state/index.js";
import type { AccountingTransaction } from "../../../../accounting/index.js";
import { applyHouseholdExecutionOverlay, type CompiledHouseholdKernel, type HouseholdKernelParticipant } from "../../../householdExecution.js";
import { immutableConfiguration } from "../../../r3/compiledHousehold.js";
import { registerHouseholdParticipantCodec } from "../../../r3/participantCodec.js";
import { SummaryOperationSink } from "../../../r3/summarySink.js";
import type { HouseholdOperationFacts } from "../../../r3/domainOperations.js";
import { evaluateFsa } from "../../health/fsa/index.js";
import { FsaCashIncomplete, depositOperationId, originalOperationId, originalRegistration, originalTransaction,
  qualifyFsaCashOriginal, qualifyFsaCashSource, readFsaCashSource, same,
  type FsaCashReference, type FsaCashSource, type FsaCashOrder } from "./source.js";

export { FsaCashIncomplete, fsaCashSourceFingerprint, registerFsaCashSourceProvider } from "./source.js";
export type { FsaCashSource, FsaCashSourceProvider, FsaCashReference, FsaCashOriginal, FsaCashDeposit, FsaCashStamp } from "./source.js";
export interface FsaCashInput { readonly sources: readonly FsaCashReference[] }
const participantId = "d2_fsa_cash";
const codec = "d2-fsa-cash/v1";
function incomplete(detail: string): never { throw new FsaCashIncomplete("source_not_qualified", detail); }

function checkArchive(state: AuthoritativeState, s: FsaCashSource, required: boolean): boolean {
  const tx = originalTransaction(s), proof = state.d2PostedTransactions?.[tx.id];
  const posted = state.identities.postedTransactionIds.includes(tx.id);
  if (posted && proof && same(proof.transaction, tx)) {
    // Canonical shared matching permits an earlier original operation ID.
    const { operationId: _actual, ...actual } = proof.registration;
    const { operationId: _expected, ...expected } = originalRegistration(s);
    if (same(actual, expected)) return true;
  }
  if (posted || proof || required) throw new FsaCashIncomplete("original_journal_unavailable", s.original.medicalReceiptId);
  return false;
}
function checkHistory(state: AuthoritativeState, s: FsaCashSource, sources: readonly FsaCashSource[]): void {
  const result = evaluateFsa(s.request);
  const history = Object.values(state.d2SettlementReceipts ?? {}).filter((r): r is D2FsaSettlementReceipt => r.kind === "fsa_paid_reimbursement"
    && r.source.householdId === s.original.householdId && r.source.personId === s.original.personId
    && r.source.planId === s.original.planId && r.source.planYearId === s.original.planYearId
    && r.effectiveAt <= s.deposit.settledAt);
  for (const r of s.request.receipts) {
    const h = r.reimbursement;
    if (r.proofId === s.original.proofId || h?.status !== "settled") continue;
    // Another independently sourced deposit can be later in the same period.
    // Its documentary flag must not demand or fabricate a posting ahead of its event.
    const later = sources.find(other => other.original.proofId === r.proofId
      && other.original.medicalReceiptId === r.receiptId && other.request.plan.planId === s.request.plan.planId);
    if (later && (later.deposit.settledAt > s.deposit.settledAt
      || (later.deposit.settledAt === s.deposit.settledAt && precedes(eventsFor(s)[1]!, eventsFor(later)[1]!)))) continue;
    const c = result.claims.find(c => c.proofId === r.proofId);
    if (!c || !history.some(p => p.claimId === c.claimId && p.settlementId === h.settlementId
      && p.amount.equals(h.approvedAmount) && p.source.medicalReceiptId === r.receiptId
      && p.source.memberId === r.memberId && p.source.payeeId === r.payeeId))
      throw new FsaCashIncomplete("posted_journal_unavailable", "Historical settled claim lacks matching canonical receipt");
  }
  for (const prior of history) {
    if (!result.claims.some(c => c.claimId === prior.claimId && c.settlementId === prior.settlementId
      && c.grossAmount.equals(prior.amount))) incomplete("Full source history omitted or changed a committed reimbursement");
  }
}
function coverage(sources: readonly FsaCashSource[], through: string): HouseholdOperationFacts {
  const partial = sources.filter(s => s.deposit.settledAt < through && s.deposit.amount.compare(s.original.amount) < 0);
  const diagnostics = [
    { severity: "warning" as const, code: "FSA_PAYROLL_TAX_INCOMPLETE", entityType: "fsa_cash",
      message: "S7: No payroll, wage-base or medical-deduction tax effect is inferred from reimbursement." },
    ...partial.map(s => ({ severity: "warning" as const, code: "entitlement_installment_port_required", entityType: "fsa_cash",
      message: `S7: ${s.original.amount.minus(s.deposit.amount).amount.toString()} USD unreimbursed; a separately approved later-claim allocation port is required.` })),
  ];
  return { diagnostics, outputCapabilities: {
    fsaCashSettlement: { dependency: "tax_independent", status: partial.length ? "incomplete" : "complete", diagnostics: [] },
    fsaPayrollTax: { dependency: "tax_affected", status: "incomplete", diagnostics: [] },
  } };
}
interface Event {
  readonly source: FsaCashSource;
  readonly id: string;
  readonly at: string;
  readonly role: "original" | "deposit";
  readonly order?: FsaCashOrder;
}
const eventsFor = (s: FsaCashSource): readonly Event[] => [
  { source: s, id: originalOperationId(s), at: s.original.paidAt, role: "original",
    ...(s.original.executionOrder ? { order: s.original.executionOrder } : {}) },
  { source: s, id: depositOperationId(s), at: s.deposit.settledAt, role: "deposit",
    ...(s.deposit.executionOrder ? { order: s.deposit.executionOrder } : {}) },
];
const precedes = (a: Event, b: Event): boolean => !!a.order && !!b.order
  && a.order.sequenceId === b.order.sequenceId && a.order.position < b.order.position;

/** One scheduler and the canonical state writer own both economic events. */
export function createFsaCashParticipant(configuration: FsaCashInput): HouseholdKernelParticipant {
  const input = immutableConfiguration({ sources: [...configuration.sources].sort((a, b) => a.sourceId.localeCompare(b.sourceId)) });
  if (!input.sources.length || new Set(input.sources.map(s => s.sourceId)).size !== input.sources.length)
    incomplete("Distinct source references required");
  // Codec restore re-reads independent source facts instead of treating portable bytes as authority.
  input.sources.forEach(r => readFsaCashSource(r.sourceId, r.expectedSource));
  return Object.freeze({ id: participantId, version: "paid-expense-reimbursement/v1", portableCodec: codec, economicInputs: input,
    prepare: (context, period, opening, work = [], tier = "detail") => {
      const sources = input.sources.map(r => readFsaCashSource(r.sourceId, r.expectedSource));
      try { requalifyD2SettlementReceiptHistory(opening.state, context); }
      catch (error) {
        if (error instanceof FsaCashIncomplete) throw error;
        throw new FsaCashIncomplete("source_not_qualified", error instanceof Error ? error.message : "Canonical history unavailable");
      }
      const all = sources.flatMap(eventsFor);
      const operations: ReturnType<HouseholdKernelParticipant["prepare"]>["operations"][number][] = [];
      const posted = new Set<string>();
      for (const s of sources) {
        if (s.original.paidAt < period.end) {
          qualifyFsaCashOriginal(s, context);
          if (checkArchive(opening.state, s, s.original.paidAt < period.start)) posted.add(originalOperationId(s));
        }
        if (s.deposit.settledAt < period.end) {
          const receipt = qualifyFsaCashSource(s, context);
          const prior = opening.state.d2SettlementReceipts?.[receipt.id];
          if (prior) {
            if (!same(prior, receipt)) incomplete("Committed receipt differs from re-derived source");
            checkArchive(opening.state, s, true); posted.add(depositOperationId(s));
          } else if (s.deposit.settledAt < period.start)
            throw new FsaCashIncomplete("posted_journal_unavailable", "Past deposit is not canonically committed");
        }
      }
      const active = all.filter(e => e.at >= period.start && e.at < period.end);
      for (const e of active) {
        for (const other of active) if (other !== e && other.at === e.at
          && other.source.original.bankAccountId === e.source.original.bankAccountId
          && !precedes(other, e) && !precedes(e, other))
          incomplete("Unordered same-instant BANK use requires an authenticated source sequence");
        if (work.some(w => w.sequencingInstant === e.at
          && w.resourceAccesses.some(a => a.accountId === e.source.original.bankAccountId)))
          incomplete("Unrelated same-instant BANK work lacks a cross-source authenticated sequence");
        if (posted.has(e.id)) continue;
        const s = e.source, tx = e.role === "original" ? originalTransaction(s) : qualifyFsaCashSource(s, context).paymentTransaction;
        const traceRefs = tx.traceRefs ?? [];
        const dependencies = active.filter(other => other.at === e.at && precedes(other, e)
          && other.source.original.bankAccountId === s.original.bankAccountId && !posted.has(other.id)).map(other => other.id);
        if (e.role === "deposit" && !posted.has(originalOperationId(s))) dependencies.push(originalOperationId(s));
        operations.push({ descriptor: { id: e.id, domain: "fsa", operationClass: `fsa:${e.role}`,
          sequencingInstant: tx.date, dependsOn: [...new Set(dependencies)],
          resourceAccesses: [{ kind: "account_cash", accountId: s.original.bankAccountId, mode: e.role === "original" ? "consume" : "produce" }], traceRefs },
          execute: candidate => {
            const ref = input.sources.find(r => r.sourceId === s.sourceId)!;
            const current = readFsaCashSource(ref.sourceId, ref.expectedSource);
            const bank = candidate.state.accounts[s.original.bankAccountId];
            if (!bank || bank.ownerId !== s.original.personId || !["checking", "savings"].includes(bank.kind))
              incomplete("Exact source-owned checking/savings BANK required");
            let transaction: AccountingTransaction;
            if (e.role === "original") {
              qualifyFsaCashOriginal(current, context);
              if (checkArchive(candidate.state, current, false)) incomplete("Original became committed during this operation");
              if (!bank.cash.equals(current.original.bankCashBefore) || bank.cash.compare(current.original.amount) < 0)
                incomplete("Original expense must be funded at its actual payment time");
              transaction = originalTransaction(current);
              applyAccountingTransactionAtomically(candidate.state, transaction, originalRegistration(current));
            } else {
              checkArchive(candidate.state, current, true); checkHistory(candidate.state, current, sources);
              const receipt = qualifyFsaCashSource(current, context);
              const result = applyD2SettlementAtomically(candidate.state, receipt, context);
              if (result.status === "incomplete") throw new FsaCashIncomplete(result.reason, current.sourceId);
              if (result.status !== "committed") incomplete("Unexpected concurrent deposit replay");
              transaction = receipt.paymentTransaction;
            }
            // Loss/amendment during posting fails the surrounding period candidate as well.
            readFsaCashSource(ref.sourceId, ref.expectedSource);
            const facts = coverage(sources, period.end);
            if (tier === "summary") {
              const sink = new SummaryOperationSink(transaction.legs[0]!.amount.currency); sink.transaction(transaction);
              return { ...candidate, facts: { ...facts, summary: { evidence: sink.snapshot() } } };
            }
            return { ...candidate, facts: { ...facts, transactions: [transaction], traceRefs } };
          } });
      }
      operations.push({ descriptor: { id: `fsa-cash:coverage:${period.start}`, domain: "fsa", operationClass: "fsa:coverage",
        sequencingInstant: period.start, dependsOn: [], resourceAccesses: [], traceRefs: [] },
        execute: candidate => ({ ...candidate, facts: coverage(sources, period.end) }) });
      return { id: participantId, operations };
    },
    observe: (descriptor, _facts, runtime) => {
      const events = input.sources.flatMap(r => eventsFor(readFsaCashSource(r.sourceId, r.expectedSource)));
      if (!events.some(e => e.id === descriptor.id) && events.some(e => e.at === descriptor.sequencingInstant
        && descriptor.resourceAccesses.some(a => a.accountId === e.source.original.bankAccountId)))
        incomplete("Another participant used BANK at an unordered FSA instant");
      return runtime;
    },
  } satisfies HouseholdKernelParticipant);
}
registerHouseholdParticipantCodec({ codec, restore: value => createFsaCashParticipant(value as FsaCashInput) });

export function attachFsaCash(kernel: CompiledHouseholdKernel, input: FsaCashInput): CompiledHouseholdKernel {
  const participant = createFsaCashParticipant(input), existing = kernel.executable.participants ?? [];
  const prior = existing.find(p => p.id === participant.id);
  if (prior && (prior.version !== participant.version || !same(prior.economicInputs, participant.economicInputs)))
    incomplete("Changed source references cannot replace an attached participant");
  return prior ? kernel : applyHouseholdExecutionOverlay(kernel, { participants: [...existing, participant] });
}
