import { accountingTransactionId, type AccountingTransaction } from "../../../../accounting/index.js";
import { ValidationError } from "../../../../diagnostics/index.js";
import { idempotencyKey } from "../../../../identity/index.js";
import { applyD2HelocOriginalAtomically, applyD2SettlementAtomically, d2SettlementPostingRegistration,
  requalifyD2SettlementReceiptHistory, type AuthoritativeState, type D2HelocSettlementReceipt, type D2SettlementSourceContext } from "../../../../state/index.js";
import { applyHouseholdExecutionOverlay, type CompiledHouseholdKernel, type HouseholdKernelParticipant } from "../../../householdExecution.js";
import type { HouseholdWorkDescriptor } from "../../../intraperiodScheduler.js";
import { immutableConfiguration } from "../../../r3/compiledHousehold.js";
import type { HouseholdOperationFacts } from "../../../r3/domainOperations.js";
import { registerHouseholdParticipantCodec } from "../../../r3/participantCodec.js";
import { SummaryOperationSink } from "../../../r3/summarySink.js";
import { canonicalSerialize } from "../../../run.js";
import { proposeHeloc } from "../../debt/heloc/index.js";
import { qualifyHelocServicingSource, same, serviceInstant, type QualifiedHelocService } from "./source.js";
export { qualifyHelocServicingSource, registerHelocServicingSourcePorts } from "./source.js";
export type { HelocServiceDocument, HelocBankDebit, HelocSourceWitness, HelocServicingSourcePorts, HelocServicingIncomplete } from "./source.js";

export interface HelocServicingInput { readonly sourceIds: readonly string[] }
const participantId = "d2_heloc_servicing", codec = "d2-heloc-servicing/v1";
function fail(message: string, code = "HELOC_SERVICING_S7_INCOMPLETE"): never {
  throw new ValidationError({ severity: "error", code, message: `S7 incomplete: ${message}`, entityType: "heloc_servicing" });
}
function resources(state: AuthoritativeState, r: D2HelocSettlementReceipt): void {
  const bank = state.accounts[r.bankAccountId], principal = state.liabilities[r.liabilityId];
  if (!bank || bank.id !== r.bankAccountId || bank.ownerId !== r.source.personId || !["checking", "savings"].includes(bank.kind)
    || !principal || principal.id !== r.liabilityId || !bank.cash.currency.equals(r.amount.currency)
    || !principal.balance.currency.equals(r.amount.currency)
    || (r.chargeLiabilityId !== null && (!state.liabilities[r.chargeLiabilityId]
      || !state.liabilities[r.chargeLiabilityId]!.balance.currency.equals(r.amount.currency))))
    fail("Exact existing owned BANK, original principal and separate source-owned temporary payable required");
}
function posted(state: AuthoritativeState, r: D2HelocSettlementReceipt, role: "original" | "settlement"): boolean {
  const tx = role === "original" ? r.originalTransaction : r.paymentTransaction, proof = state.d2PostedTransactions?.[tx.id];
  const id = state.identities.postedTransactionIds.includes(tx.id);
  if (id !== (proof !== undefined) || proof && (!same(proof.transaction, tx)
    || !same(proof.registration, d2SettlementPostingRegistration(r, role)))) fail("Canonical journal/registration differs from independently rebuilt original");
  return id;
}

/** B1's history is a conditional input. Check every included original against
 * actual canonical postings; also reject omission of any committed repayment. */
function principalHistory(state: AuthoritativeState, q: QualifiedHelocService, context: D2SettlementSourceContext): void {
  const c = q.document.request.checkpoint, r = q.receipt, history = c.history;
  const repayments = Object.values(state.d2SettlementReceipts ?? {}).filter((x): x is D2HelocSettlementReceipt =>
    x.kind === "heloc_phase_service" && x.liabilityId === r.liabilityId && x.effectiveAt <= serviceInstant(c.closingAt));
  for (const old of repayments) {
    const original = qualifyHelocServicingSource(old.source.sourceId, context);
    if (original.status !== "qualified" || !same(original.receipt, old)) fail("Prior repayment publisher no longer qualifies");
    const prior = original.document.request.checkpoint;
    if (prior.originalAt !== c.originalAt || !prior.originalPrincipal.equals(c.originalPrincipal) || !same(prior.originalSource, c.originalSource)
      || prior.history.some(h => !history.some(current => current.postingId === h.postingId && same(current, h))))
      fail("Original principal or already posted historical evidence changed between installments");
    if (old.source.issuerId !== r.source.issuerId || old.source.lineId !== r.source.lineId
      || old.source.personId !== r.source.personId || old.source.householdId !== r.source.householdId
      || !history.some(h => h.kind === "principal_repayment" && h.postingId === old.paymentTransaction.id))
      fail("Checkpoint omits or changes an actual prior principal repayment");
  }
  for (const h of history) {
    if (h.kind === "principal_repayment") {
      const old = repayments.find(x => x.paymentTransaction.id === h.postingId);
      if (!old || !posted(state, old, "settlement") || old.operationId !== h.operationId || old.authorizationId !== h.authorizationId
        || old.claimId !== h.claimId || old.source.fundingId !== h.fundingId || old.effectiveAt !== serviceInstant(h.effectiveAt)
        || !old.principalPaid.equals(h.principal) || !old.interest.equals(h.interest)
        || !old.principalPaid.plus(old.interest).equals(h.cash)) fail("Proposed or altered history is not posted principal authority");
      continue;
    }
    const draws = q.document.priorDraws.filter(d => d.proposal.movements.some(m => m.operationId === h.operationId));
    if (draws.length !== 1) fail("Complete original draw quote required for actual principal history");
    const d = draws[0]!, result = proposeHeloc(d.request), rebuilt = result.proposals[0];
    const m = rebuilt?.movements.find(m => m.operationId === h.operationId);
    if (result.coverage !== "complete" || !same(rebuilt, d.proposal) || !m || m.kind !== "draw"
      || d.request.lineId !== r.source.lineId || d.request.liabilityAccountId !== r.liabilityId
      || d.request.householdId !== r.source.householdId || d.request.borrowerId !== r.source.personId
      || h.postingId !== accountingTransactionId(m.operationId) || h.authorizationId !== m.authorizationId
      || h.effectiveAt !== m.effectiveAt || !h.principal.equals(m.liabilityDelta) || !h.cash.equals(m.cashDelta) || !h.interest.isZero())
      fail("Original posted draw identity, source and amount mismatch");
    const keys = [idempotencyKey("d2:source-operation", m.operationId), idempotencyKey("d2:authorization", m.authorizationId),
      idempotencyKey("d2:heloc-draw-receipt", canonicalSerialize({ quote: { ...d, request: d.proposal.evidence }, operationId: m.operationId }))];
    if (!state.identities.postedTransactionIds.includes(accountingTransactionId(m.operationId))
      || !keys.every(k => state.identities.externalIdempotencyKeys.includes(k))) fail("Draw has no exact canonical posting/authorization/quote receipt");
  }
}
const coverage: HouseholdOperationFacts = immutableConfiguration({ outputCapabilities: {
  helocFutureServicing: { dependency: "tax_independent", status: "incomplete", diagnostics: [] },
  helocTax: { dependency: "tax_affected", status: "incomplete", diagnostics: [] },
}, diagnostics: [{ severity: "warning", code: "HELOC_SERVICING_S7_INCOMPLETE", entityType: "heloc_servicing",
  message: "Only independently sourced dated installments execute; future/reset/payoff and tax-law coverage remains incomplete." }] });
function journalFacts(tx: AccountingTransaction | undefined, tier: "summary" | "detail", currency: D2HelocSettlementReceipt["amount"]["currency"]): HouseholdOperationFacts {
  if (tier === "summary") {
    const sink = new SummaryOperationSink(currency);
    if (tx) sink.transaction(tx);
    return { summary: { evidence: sink.snapshot() } };
  }
  return { transactions: tx ? [tx] : [] };
}

/** Lookup IDs only cross checkpoints. Preparation, execution, canonical writer
 * and cold replay each independently requalify the original publishers. */
export function createHelocServicingParticipant(configuration: HelocServicingInput): HouseholdKernelParticipant {
  const input = immutableConfiguration({ sourceIds: [...configuration.sourceIds].sort() });
  if (input.sourceIds.some(s => typeof s !== "string" || !s.trim()) || new Set(input.sourceIds).size !== input.sourceIds.length)
    fail("Unique nonempty source lookup IDs required");
  return Object.freeze({ id: participantId, version: "1", portableCodec: codec, economicInputs: input,
    prepare: (context, period, opening, work = [], tier = "detail") => {
      try { requalifyD2SettlementReceiptHistory(opening.state, context); }
      catch { fail("Historical source or signed journal no longer qualifies"); }
      const qualified: QualifiedHelocService[] = [];
      for (const id of input.sourceIds) {
        const q = qualifyHelocServicingSource(id, context);
        if (q.status !== "qualified") fail(`${id}: ${q.reason}`);
        qualified.push(q);
      }
      const used = new Set<string>();
      for (const { receipt: r } of qualified) {
        const keys = [r.id, r.operationId, r.authorizationId, r.paymentId, r.source.sourceApprovalId,
          r.source.paymentApprovalId, r.source.fundingId, r.claimId, r.recognitionId, r.settlementId,
          r.originalTransaction.id, r.paymentTransaction.id,
          canonicalSerialize([r.source.issuerId, r.source.lineId, r.source.periodStart, r.source.periodEnd])];
        // Identity domains may intentionally coincide within ONE receipt (notably
        // the principal-only original/payment journal); never across sources.
        const local = new Set<string>();
        for (const [index, key] of keys.entries()) {
          // Only canonical journal aliases are expected: charge journal equals
          // its B1 recognition ID, or principal-only has one journal in both slots.
          const journalAlias = index === 10 && r.originalProof === "recognized_charge" && key === r.recognitionId
            || index === 11 && r.originalProof === "principal_only" && key === r.originalTransaction.id;
          if (used.has(key) || local.has(key) && !journalAlias) fail("Duplicate source, installment, approval or posting identity");
          local.add(key);
        }
        for (const key of local) used.add(key);
        resources(opening.state, r);
        if (opening.state.d2SettlementReceipts?.[r.id] && !same(opening.state.d2SettlementReceipts[r.id], r))
          fail("Committed receipt differs from current independent source");
      }
      for (const proof of Object.values(opening.state.d2PostedTransactions ?? {})) {
        if (proof.registration.kind !== "heloc_phase_service") continue;
        // Ownership is by source receipt ID, never by a caller's transaction hash.
        const owner = qualified.find(q => q.receipt.id === (proof.registration.kind === "heloc_phase_service" ? proof.registration.service.id : ""));
        if (!owner) fail("Archived HELOC journal lacks configured independent source coverage");
        const r = owner.receipt;
        const role = proof.registration.role;
        if (r.originalProof === "principal_only" && role === "original") fail("Principal-only journal has a fabricated charge registration");
        posted(opening.state, r, role);
      }
      const operations: ReturnType<HouseholdKernelParticipant["prepare"]>["operations"][number][] = [];
      if (input.sourceIds.length) operations.push({ descriptor: { id: `heloc-service:coverage:${period.start}`, domain: "liabilities",
        operationClass: "liabilities:heloc_coverage", sequencingInstant: period.start, dependsOn: [], resourceAccesses: [], traceRefs: [] },
      execute: candidate => ({ ...candidate, facts: coverage }) });
      const events = qualified.flatMap(q => (q.receipt.originalProof === "principal_only" ? ["settlement"] as const
        : ["original", "settlement"] as const).map(role => ({ q, role, tx: role === "original" ? q.receipt.originalTransaction : q.receipt.paymentTransaction })));
      for (const event of events) {
        const { q, role, tx } = event, r = q.receipt;
        if (tx.date < period.start || tx.date >= period.end) continue;
        const dependsOn: string[] = role === "settlement" && r.originalProof === "recognized_charge" ? [r.originalTransaction.id] : [];
        if (role === "settlement") {
          if (work.some(w => w.sequencingInstant === tx.date && w.resourceAccesses.some(a => a.accountId === r.bankAccountId)))
            fail("Same-instant external BANK work lacks cross-source ordering authority", "HOUSEHOLD_CONTENTION_UNRESOLVED");
          for (const other of events.filter(e => e !== event && e.role === "settlement" && e.tx.date === tx.date)) {
            const o = other.q.receipt;
            if (o.liabilityId === r.liabilityId || o.chargeLiabilityId !== null && o.chargeLiabilityId === r.chargeLiabilityId)
              fail("Same-instant principal/payable writer conflict", "HOUSEHOLD_CONTENTION_UNRESOLVED");
            if (o.bankAccountId !== r.bankAccountId) continue;
            const before = o.source.executionOrder, current = r.source.executionOrder;
            if (!before || !current || before.sequenceId !== current.sequenceId || before.position === current.position)
              fail("Same-instant BANK installments require independently approved distinct order positions", "HOUSEHOLD_CONTENTION_UNRESOLVED");
            if (before.position < current.position) dependsOn.push(o.paymentTransaction.id);
          }
        }
        const descriptor: HouseholdWorkDescriptor = { id: tx.id, domain: "liabilities", operationClass: `liabilities:heloc_${role}`,
          sequencingInstant: tx.date, dependsOn, traceRefs: tx.traceRefs ?? [],
          resourceAccesses: role === "settlement" ? [{ kind: "account_cash", accountId: r.bankAccountId, mode: "consume" }] : [] };
        operations.push({ descriptor, execute: candidate => {
          const current = qualifyHelocServicingSource(r.source.sourceId, context);
          if (current.status !== "qualified" || !same(current.receipt, r)) fail("Issuer or BANK source changed after preparation");
          resources(candidate.state, r);
          principalHistory(candidate.state, q, context);
          const existing = candidate.state.d2SettlementReceipts?.[r.id];
          if (existing && !same(existing, r)) fail("Committed receipt changed");
          try {
            if (role === "original") {
              if (posted(candidate.state, r, "original")) return { ...candidate, facts: journalFacts(undefined, tier, context.baseCurrency) };
              const admitted = applyD2HelocOriginalAtomically(candidate.state, r, context);
              if (admitted.status !== "qualified") fail(`Original source admission failed: ${admitted.reason}`);
              return { ...candidate, facts: journalFacts(tx, tier, context.baseCurrency) };
            }
            const admitted = applyD2SettlementAtomically(candidate.state, r, context);
            if (admitted.status === "incomplete") fail(`Settlement admission failed: ${admitted.reason}`);
            return { ...candidate, facts: journalFacts(admitted.status === "committed" ? tx : undefined, tier, context.baseCurrency) };
          } catch (error) {
            if (error instanceof ValidationError) throw error;
            fail("Canonical HELOC source, journal, funding or balance validation failed");
          }
        } });
      }
      return { id: participantId, operations };
    },
  } satisfies HouseholdKernelParticipant);
}
registerHouseholdParticipantCodec({ codec, restore: input => createHelocServicingParticipant(input as HelocServicingInput) });

export function attachHelocServicing(kernel: CompiledHouseholdKernel, input: HelocServicingInput): CompiledHouseholdKernel {
  const participant = createHelocServicingParticipant(input), existing = kernel.executable.participants ?? [];
  const prior = existing.find(p => p.id === participantId);
  if (prior && !same(prior.economicInputs, participant.economicInputs)) fail("Cannot replace attached source configuration");
  return prior ? kernel : applyHouseholdExecutionOverlay(kernel, { participants: [...existing, participant] });
}
