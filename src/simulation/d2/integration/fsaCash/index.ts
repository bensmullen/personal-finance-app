import { applyAccountingTransactionAtomically, applyD2SettlementAtomically, applyNativeHouseholdOriginalAtomically,
  authoritativeFsaPlanReceipts, requalifyD2SettlementReceiptHistory,
  type AuthoritativeState } from "../../../../state/index.js";
import type { AccountingTransaction } from "../../../../accounting/index.js";
import { applyHouseholdExecutionOverlay, householdPreparationAttempt, type CompiledHouseholdKernel, type HouseholdKernelParticipant } from "../../../householdExecution.js";
import { immutableConfiguration } from "../../../r3/compiledHousehold.js";
import { registerHouseholdParticipantCodec } from "../../../r3/participantCodec.js";
import { SummaryOperationSink } from "../../../r3/summarySink.js";
import type { HouseholdOperationFacts } from "../../../r3/domainOperations.js";
import { evaluateFsa } from "../../health/fsa/index.js";
import { FsaCashIncomplete, depositOperationId, originalOperationId, originalRegistration, originalTransaction,
  qualifyFsaCashOriginal, qualifyFsaCashSource, readFsaCashSource, same,
  type FsaCashReference, type FsaCashSource, type FsaCashOrder, type FsaCashSourceFormat } from "./source.js";

export { FsaCashIncomplete, fsaCashSourceFingerprint, registerFsaCashSourceProvider } from "./source.js";
export type { FsaCashSource, FsaCashSourceProvider, FsaCashReference, FsaCashOriginal, FsaCashDeposit, FsaCashStamp } from "./source.js";
export interface FsaCashInput { readonly sources: readonly FsaCashReference[]; readonly forecastEnd?: string }
const participantId = "d2_fsa_cash";
const codec = "d2-fsa-cash/v2";
const ownedParticipants = new WeakSet<HouseholdKernelParticipant>();
export const ownsFsaCashParticipant = (participant: HouseholdKernelParticipant): boolean => ownedParticipants.has(participant);
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
const medicalKey = (planId: string, proofId: string, receiptId: string) => JSON.stringify([planId, proofId, receiptId]);
function checkHistory(state: AuthoritativeState, s: FsaCashSource, receipts: ReadonlyMap<string, FsaCashSource>): void {
  const result = evaluateFsa(s.request);
  const history = authoritativeFsaPlanReceipts(state, s.original).filter(r => r.effectiveAt <= s.deposit.settledAt);
  for (const r of s.request.receipts) {
    const h = r.reimbursement;
    if (r.proofId === s.original.proofId || h?.status !== "settled") continue;
    // Another independently sourced deposit can be later in the same period.
    // Its documentary flag must not demand or fabricate a posting ahead of its event.
    const later = receipts.get(medicalKey(s.request.plan.planId, r.proofId, r.receiptId));
    const laterDeposit = later && eventsFor(later)[1];
    if (laterDeposit && (laterDeposit.at > s.deposit.settledAt ||
      laterDeposit.at === s.deposit.settledAt && precedes(eventsFor(s)[1]!, laterDeposit))) continue;
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
function coverage(sources: readonly FsaCashSource[], through: string, forecastEnd: string): HouseholdOperationFacts {
  const partial = sources.filter(s => s.deposit.settledAt < through && s.deposit.amount.compare(s.original.amount) < 0);
  // Missing the forecast horizon is incomplete; a well-sourced later
  // event *inside* the horizon is not missing coverage for the whole run.
  const pending = sources.filter(s => s.original.paidAt < through &&
    (s.deposit.settledAt >= forecastEnd || s.householdBank && s.deposit.status !== "posted"));
  const diagnostics = [
    { severity: "warning" as const, code: "FSA_PAYROLL_TAX_INCOMPLETE", entityType: "fsa_cash",
      message: "S7: No payroll, wage-base or medical-deduction tax effect is inferred from reimbursement." },
    ...pending.map(s => ({ severity: "warning" as const, code: "FSA_REIMBURSEMENT_PENDING", entityType: "fsa_cash",
      message: `S7: Medical expense ${s.original.medicalReceiptId} is posted; future plan reimbursement is not yet a committed BANK deposit.` })),
    ...partial.map(s => ({ severity: "warning" as const, code: "entitlement_installment_port_required", entityType: "fsa_cash",
      message: `S7: ${s.original.amount.minus(s.deposit.amount).amount.toString()} USD unreimbursed; a separately approved later-claim allocation port is required.` })),
  ];
  return { diagnostics, outputCapabilities: {
    // Capabilities are monotonic in the household engine. Before the actual forecast
    // boundary, do not label a still-pending reimbursement incomplete forever.
    ...(through >= forecastEnd ? { fsaCashSettlement: { dependency: "tax_independent" as const,
      status: partial.length || pending.length ? "incomplete" as const : "complete" as const, diagnostics: [] } } : {}),
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
  ...((s.householdBank && s.deposit.status !== "posted") ? [] : [{
    source: s, id: depositOperationId(s), at: s.deposit.settledAt, role: "deposit" as const,
    ...(s.deposit.executionOrder ? { order: s.deposit.executionOrder } : {}),
  }]),
];
const precedes = (a: Event, b: Event): boolean => !!a.order && !!b.order
  && a.order.sequenceId === b.order.sequenceId && a.order.position < b.order.position;

/** One scheduler and the canonical state writer own both economic events. */
export function createFsaCashParticipant(configuration: FsaCashInput): HouseholdKernelParticipant {
  return createParticipant(configuration, "v2");
}
/** v1 is restoration-only: retain the exact historical participant identity,
 * source version and journal proof after independent full-source agreement. */
function createParticipant(configuration: FsaCashInput, format: FsaCashSourceFormat): HouseholdKernelParticipant {
  const input = immutableConfiguration({ sources: [...configuration.sources].sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
    ...(configuration.forecastEnd === undefined ? {} : { forecastEnd: configuration.forecastEnd }) });
  if (!input.sources.length || input.sources.some(r => typeof r.expectedSource !== "string")
    || new Set(input.sources.map(s => s.sourceId)).size !== input.sources.length)
    incomplete("Distinct source references required");
  // Codec restore re-reads independent source facts instead of treating portable bytes as authority.
  input.sources.forEach(r => readFsaCashSource(r.sourceId, r.expectedSource, format));
  const catalogs = new WeakMap<object, { sources: readonly FsaCashSource[]; months: ReadonlyMap<string, readonly Event[]>;
    instants: ReadonlyMap<string, readonly Event[]>; receipts: ReadonlyMap<string, FsaCashSource>; coverageSources: readonly FsaCashSource[] }>();
  const references = new Map(input.sources.map(reference => [reference.sourceId, reference]));
  const participant = Object.freeze({ id: participantId, version: `paid-expense-reimbursement/${format}`,
    portableCodec: format === "v1" ? "d2-fsa-cash/v1" : codec, economicInputs: input,
    prepare: (context, period, opening, work = [], tier = "detail") => {
      const attempt = householdPreparationAttempt(opening);
      const cached = attempt === undefined ? undefined : catalogs.get(attempt);
      const sources = cached?.sources ?? input.sources.map(r => readFsaCashSource(r.sourceId, r.expectedSource, format, context));
      try { if (attempt === undefined) requalifyD2SettlementReceiptHistory(opening.state, context); }
      catch (error) {
        if (error instanceof FsaCashIncomplete) throw error;
        throw new FsaCashIncomplete("source_not_qualified", error instanceof Error ? error.message : "Canonical history unavailable");
      }
      // These references pin the entire dated FSA catalog. The selected
      // operation still reads the publisher on both sides of its writer.
      const events = cached === undefined ? sources.flatMap(eventsFor) : undefined;
      const catalog = cached ?? (() => {
        const months = new Map<string, Event[]>(), instants = new Map<string, Event[]>();
        for (const event of events!) {
          for (const [key, index] of [[event.at.slice(0, 7), months], [event.at, instants]] as const) {
            const sameTime = index.get(key) ?? [];
            sameTime.push(event);
            index.set(key, sameTime);
          }
        }
        const receipts = new Map<string, FsaCashSource>();
        for (const source of sources) {
          const key = medicalKey(source.request.plan.planId, source.original.proofId, source.original.medicalReceiptId);
          if (!receipts.has(key)) receipts.set(key, source);
        }
        const coverageSources = input.forecastEnd === undefined ? sources : sources.filter(source =>
          source.deposit.amount.compare(source.original.amount) < 0 || source.deposit.settledAt >= input.forecastEnd! ||
          source.householdBank && source.deposit.status !== "posted");
        return { sources, months, instants, receipts, coverageSources };
      })();
      const active = (attempt !== undefined ? catalog.months.get(period.start.slice(0, 7)) ?? [] : events!)
        .filter(event => event.at >= period.start && event.at < period.end);
      const operations: ReturnType<HouseholdKernelParticipant["prepare"]>["operations"][number][] = [];
      const posted = new Set<string>();
      for (const s of cached === undefined ? sources : new Set(active.map(event => event.source))) {
        if (s.original.paidAt < period.end) {
          qualifyFsaCashOriginal(s, context);
          if (checkArchive(opening.state, s, s.original.paidAt < period.start)) posted.add(originalOperationId(s));
        }
        if ((!s.householdBank || s.deposit.status === "posted") && s.deposit.settledAt < period.end) {
          const receipt = qualifyFsaCashSource(s, context, format);
          const prior = opening.state.d2SettlementReceipts?.[receipt.id];
          if (prior) {
            if (!same(prior, receipt)) incomplete("Committed receipt differs from re-derived source");
            checkArchive(opening.state, s, true); posted.add(depositOperationId(s));
          } else if (s.deposit.settledAt < period.start)
            throw new FsaCashIncomplete("posted_journal_unavailable", "Past deposit is not canonically committed");
        }
      }
      if (attempt !== undefined && cached === undefined) catalogs.set(attempt, catalog);
      for (const e of active) {
        for (const other of active) if (other !== e && other.at === e.at
          && other.source.original.bankAccountId === e.source.original.bankAccountId
          && !precedes(other, e) && !precedes(e, other))
          incomplete("Unordered same-instant BANK use requires an authenticated source sequence");
        if (work.some(w => w.sequencingInstant === e.at
          && w.resourceAccesses.some(a => a.accountId === e.source.original.bankAccountId)))
          incomplete("Unrelated same-instant BANK work lacks a cross-source authenticated sequence");
        if (posted.has(e.id)) continue;
        const s = e.source, tx = e.role === "original" ? originalTransaction(s) : qualifyFsaCashSource(s, context, format).paymentTransaction;
        const traceRefs = tx.traceRefs ?? [];
        const dependencies = active.filter(other => other.at === e.at && precedes(other, e)
          && other.source.original.bankAccountId === s.original.bankAccountId && !posted.has(other.id)).map(other => other.id);
        if (e.role === "deposit" && !posted.has(originalOperationId(s))) dependencies.push(originalOperationId(s));
        operations.push({ descriptor: { id: e.id, domain: "fsa", operationClass: `fsa:${e.role}`,
          sequencingInstant: tx.date, dependsOn: [...new Set(dependencies)],
          resourceAccesses: [{ kind: "account_cash", accountId: s.original.bankAccountId, mode: e.role === "original" ? "consume" : "produce" }], traceRefs },
          execute: candidate => {
            const ref = references.get(s.sourceId)!;
            const current = readFsaCashSource(ref.sourceId, ref.expectedSource, format, context);
            const bank = candidate.state.accounts[s.original.bankAccountId];
            if (!bank || bank.ownerId !== (current.householdBank ? current.original.householdId : current.original.personId) ||
                !["checking", "savings"].includes(bank.kind))
              incomplete("Exact source-owned checking/savings BANK required");
            const publication = current.householdBank && (e.role === "original"
              ? current.householdBank.originalContext : current.householdBank.settlementContext);
            if (current.householdBank && (!publication || publication.runId !== context.runId ||
                publication.asOf !== context.asOf || publication.dataCutoff !== context.dataCutoff))
              incomplete("Native FSA publication differs from the actual run context");
            let transaction: AccountingTransaction;
            if (e.role === "original") {
              qualifyFsaCashOriginal(current, context);
              if (checkArchive(candidate.state, current, false)) incomplete("Original became committed during this operation");
              if (!bank.cash.equals(current.original.bankCashBefore) || bank.cash.compare(current.original.amount) < 0)
                incomplete("Original expense must be funded at its actual payment time");
              transaction = originalTransaction(current);
              const registration = originalRegistration(current);
              if (registration.nativeHousehold) applyNativeHouseholdOriginalAtomically(candidate.state, transaction, registration, context);
              else applyAccountingTransactionAtomically(candidate.state, transaction, registration);
            } else {
              checkArchive(candidate.state, current, true); checkHistory(candidate.state, current, catalog.receipts);
              const receipt = qualifyFsaCashSource(current, context, format);
              const result = applyD2SettlementAtomically(candidate.state, receipt, context);
              if (result.status === "incomplete") throw new FsaCashIncomplete(result.reason, current.sourceId);
              if (result.status !== "committed") incomplete("Unexpected concurrent deposit replay");
              transaction = receipt.paymentTransaction;
            }
            // Loss/amendment during posting fails the surrounding period candidate as well.
            readFsaCashSource(ref.sourceId, ref.expectedSource, format, context);
            const facts = coverage(catalog.coverageSources, period.end, input.forecastEnd ?? context.simulationEnd);
            if (tier === "summary") {
              const sink = new SummaryOperationSink(transaction.legs[0]!.amount.currency); sink.transaction(transaction);
              return { ...candidate, facts: { ...facts, summary: { evidence: sink.snapshot() } } };
            }
            return { ...candidate, facts: { ...facts, transactions: [transaction], traceRefs } };
          } });
      }
      operations.push({ descriptor: { id: `fsa-cash:coverage:${period.start}`, domain: "fsa", operationClass: "fsa:coverage",
        sequencingInstant: period.start, dependsOn: [], resourceAccesses: [], traceRefs: [] },
        execute: candidate => ({ ...candidate, facts: coverage(catalog.coverageSources, period.end, input.forecastEnd ?? context.simulationEnd) }) });
      return { id: participantId, operations };
    },
    observe: (descriptor, _facts, runtime, observation) => {
      const attempt = observation === undefined ? undefined : householdPreparationAttempt(observation);
      const catalog = attempt === undefined ? undefined : catalogs.get(attempt);
      const events = catalog === undefined ? input.sources.flatMap(r => eventsFor(readFsaCashSource(r.sourceId, r.expectedSource, format)))
        : catalog.instants.get(descriptor.sequencingInstant) ?? [];
      if (!events.some(e => e.id === descriptor.id) && events.some(e => e.at === descriptor.sequencingInstant
        && descriptor.resourceAccesses.some(a => a.accountId === e.source.original.bankAccountId)))
        incomplete("Another participant used BANK at an unordered FSA instant");
      return runtime;
    },
  } satisfies HouseholdKernelParticipant);
  ownedParticipants.add(participant);
  return participant;
}
registerHouseholdParticipantCodec({ codec, restore: value => createFsaCashParticipant(value as FsaCashInput) });
registerHouseholdParticipantCodec({ codec: "d2-fsa-cash/v1", restore: value => createParticipant(value as FsaCashInput, "v1") });

export function attachFsaCash(kernel: CompiledHouseholdKernel, input: FsaCashInput): CompiledHouseholdKernel {
  const forecastEnd = kernel.horizon.periods.at(-1)?.end;
  if (forecastEnd === undefined) incomplete("FSA cash requires an explicit compiled forecast horizon");
  // The compiled kernel, never the caller, owns the true full forecast boundary.
  const participant = createFsaCashParticipant({ sources: input.sources, forecastEnd }), existing = kernel.executable.participants ?? [];
  const prior = existing.find(p => p.id === participant.id);
  if (prior && (prior.version !== participant.version || !same(prior.economicInputs, participant.economicInputs)))
    incomplete("Changed source references cannot replace an attached participant");
  return prior ? kernel : applyHouseholdExecutionOverlay(kernel, { participants: [...existing, participant] });
}
