import { accountingTransactionId, createAccountingLeg, createAccountingTransaction, type AccountingTransaction } from "../../../../accounting/index.js";
import { ValidationError } from "../../../../diagnostics/index.js";
import { domainId } from "../../../../identity/index.js";
import { calculationTraceId, calculationTraceRef } from "../../../../lineage/index.js";
import { claimId, recognitionId, settlementId } from "../../../../semantics/identity.js";
import { applyAccountingTransactionAtomically, applyD2SettlementAtomically, d2SettlementPostingRegistration,
  d2SettlementSourceFingerprint, registerD2SettlementSourceAuthority, requalifyD2SettlementReceiptHistory,
  registerAuthoritativeIdentity,
  type AuthoritativeState, type D2CardSettlementReceipt, type D2PostingRegistration,
  type D2SettlementSourceContext } from "../../../../state/index.js";
import { instant, type Instant } from "../../../../time/index.js";
import { Money } from "../../../../values/index.js";
import { applyHouseholdExecutionOverlay, type CompiledHouseholdKernel, type HouseholdKernelParticipant } from "../../../householdExecution.js";
import type { HouseholdWorkDescriptor } from "../../../intraperiodScheduler.js";
import { immutableConfiguration } from "../../../r3/compiledHousehold.js";
import { registerHouseholdParticipantCodec } from "../../../r3/participantCodec.js";
import { SummaryOperationSink } from "../../../r3/summarySink.js";
import type { HouseholdOperationFacts } from "../../../r3/domainOperations.js";
import { canonicalSerialize } from "../../../run.js";
import { proposeCreditCardStatements, type IssuerSource, type PaymentSplit, type RevolvingRequest } from "../../debt/revolving/index.js";
import { reconcileCreditCardCycles, type CreditCardContinuityRequest } from "../../debt/revolving/cycles/index.js";

/** Publisher provenance, independently supplied, never synthesized from civil
 * asOf or human-readable publication text. */
export interface CardSourceInstant {
  readonly source: IssuerSource;
  readonly publishedAt: Instant;
  readonly knownAt: Instant;
}
export interface CardBankDocument {
  readonly sourceId: string;
  readonly version: string;
  readonly statementId: string;
  readonly quoteId: string;
  readonly sourceApprovalId: string;
  readonly request: RevolvingRequest;
  readonly provenance: readonly CardSourceInstant[];
  readonly charge: { readonly evidenceId: string; readonly postingIds: readonly string[];
    readonly effectiveAt: Instant; readonly operationId: string };
  /** Independent signed issuer allocation and payer authorization; documentary
   * BANK posted flags do not authorize engine cash movement. */
  readonly payment: {
    readonly approvalId: string;
    readonly authorizationId: string;
    readonly paymentId: string;
    readonly settlementId: string;
    readonly effectiveAt: Instant;
    readonly authorizedAt: Instant;
    readonly publishedAt: Instant;
    readonly knownAt: Instant;
    readonly expiresAt: Instant;
    readonly householdId: string;
    readonly personId: string;
    readonly issuerId: string;
    readonly cardAccountId: string;
    readonly bankAccountId: string;
    readonly amount: Money;
    readonly allocation: PaymentSplit;
    readonly bankCashBefore: Money;
    readonly executionOrder?: { readonly sequenceId: string; readonly position: number };
  };
  readonly continuity?: CreditCardContinuityRequest;
  readonly continuityProvenance?: { readonly publishedAt: Instant; readonly knownAt: Instant };
}
export interface CardBankSourcePort {
  /** Read independently authenticated raw issuer/payer documents. Must not echo
   * portable inputs, copied receipts, observed balances or a supplied hash. */
  readonly read: (sourceId: string) => CardBankDocument | undefined;
}
export interface CardBankInput { readonly sourceIds: readonly string[]; }
export type CardBankIncomplete = { readonly status: "incomplete"; readonly diagnosticSeam: "S7";
  readonly reason: "source_unavailable" | "source_not_qualified" | "minimum_unpaid" };
type Qualified = { readonly status: "qualified"; readonly document: CardBankDocument; readonly receipt: D2CardSettlementReceipt };
let sourcePort: CardBankSourcePort | undefined;
const participantId = "d2_card_bank", codec = "d2-card-bank/v1";
const same = (a: unknown, b: unknown): boolean => canonicalSerialize(a) === canonicalSerialize(b);
const incomplete = (reason: CardBankIncomplete["reason"]): CardBankIncomplete => ({ status: "incomplete", diagnosticSeam: "S7", reason });
function fail(message: string): never {
  throw new ValidationError({ severity: "error", code: "CARD_BANK_SOURCE_CONFLICT", entityType: "card_bank", message });
}
const text = (s: string): boolean => typeof s === "string" && s.trim().length > 0;
const dated = (at: Instant): boolean => { try { return instant(at) === at; } catch { return false; } };
const total = (split: PaymentSplit): Money => split.principal.plus(split.interest).plus(split.fees);

/** Register once at composition, also in each independent replay process. The
 * portable participant codec cannot install this source qualification port. */
export function registerCardBankSourcePort(port: CardBankSourcePort): void {
  if (sourcePort !== undefined) throw new Error("CARD_BANK_SOURCE_PORT_DUPLICATE");
  registerD2SettlementSourceAuthority("card_interest_payment", { qualify: (binding, context) => {
    if (binding.kind !== "card_interest_payment") return { status: "incomplete", reason: "source_not_qualified" };
    const q = qualifyCardBankSource(binding.sourceId, context);
    return q.status === "qualified" ? { status: "qualified", receipt: q.receipt }
      : { status: "incomplete", reason: q.reason === "source_unavailable" ? "source_unavailable" : "source_not_qualified" };
  } });
  sourcePort = Object.freeze({ read: port.read });
}

/** The complete raw B1 request is re-evaluated; a receipt is never an input. */
export function qualifyCardBankSource(sourceId: string, context: D2SettlementSourceContext): Qualified | CardBankIncomplete {
  let raw: CardBankDocument | undefined;
  try { raw = sourcePort?.read(sourceId); }
  catch { return incomplete("source_unavailable"); }
  if (!raw) return incomplete("source_unavailable");
  try {
    const d = immutableConfiguration(raw);
    if (d.sourceId !== sourceId || ![d.sourceId, d.version, d.quoteId, d.sourceApprovalId, d.charge.evidenceId,
      d.charge.operationId, d.payment.approvalId, d.payment.authorizationId, d.payment.paymentId, d.payment.settlementId].every(text))
      return incomplete("source_not_qualified");
    if (![context.asOf, context.dataCutoff, d.charge.effectiveAt, d.payment.effectiveAt, d.payment.authorizedAt,
      d.payment.publishedAt, d.payment.knownAt, d.payment.expiresAt].every(dated)) return incomplete("source_not_qualified");
    if (context.dataCutoff > context.asOf) return incomplete("source_not_qualified");
    const result = proposeCreditCardStatements(d.request);
    if (result.statementCoverage !== "complete") return incomplete("source_not_qualified");
    const p = result.proposals.find(p => p.statementId === d.statementId);
    const cards = d.request.cards.filter(c => c.statementId === d.statementId);
    if (!p || cards.length !== 1) return incomplete("source_not_qualified");
    const c = cards[0]!, a = d.payment;
    // Single issuer-approved charge event: never combine different effective
    // events or hide purchases/prior payments inside an opening balance.
    if (c.transactions.length !== 0 || c.charges.length === 0 ||
      !same([...d.charge.postingIds].sort(), c.charges.map(x => x.postingId).sort()) ||
      new Set(d.charge.postingIds).size !== d.charge.postingIds.length ||
      c.charges.some(x => x.effectiveAt !== d.charge.effectiveAt.slice(0, 10)) ||
      d.charge.effectiveAt > a.effectiveAt || a.effectiveAt.slice(0, 10) !== c.payment.effectiveAt ||
      a.householdId !== c.householdId || a.personId !== c.personId || a.issuerId !== c.issuerId ||
      a.cardAccountId !== c.cardAccountId || a.bankAccountId !== c.payment.sourceAccountId ||
      !a.amount.equals(p.potentialPayment) || !same(a.allocation, p.potentialAllocation) || !total(a.allocation).equals(a.amount) ||
      a.authorizedAt > a.knownAt || a.publishedAt > a.knownAt || a.knownAt > a.effectiveAt ||
      a.knownAt > context.dataCutoff || a.publishedAt > context.asOf || a.effectiveAt >= a.expiresAt)
      return incomplete("source_not_qualified");
    const sources = [c.statementSource, c.minimum.source, c.postingPolicy.source, c.allocationPolicy.source,
      c.payment.source, ...c.charges.map(x => x.source)];
    if (d.continuity) {
      const evidence = d.continuityProvenance;
      if (!evidence || ![evidence.publishedAt, evidence.knownAt].every(dated) || evidence.publishedAt > evidence.knownAt ||
        evidence.knownAt > context.dataCutoff || evidence.publishedAt > context.asOf ||
        d.continuity.knownAt > evidence.knownAt.slice(0, 10)) return incomplete("source_not_qualified");
      for (const cycle of d.continuity.cycles) {
        for (const card of cycle.request.cards) sources.push(card.statementSource, card.minimum.source,
          card.postingPolicy.source, card.allocationPolicy.source, card.payment.source,
          ...[...card.transactions, ...card.charges].map(x => x.source));
        for (const register of cycle.registers) {
          sources.push(register.source, register.opening.source, register.boundary.source);
          for (const posting of [...register.activity, ...register.boundary.payments]) {
            sources.push(posting.event.source);
            if (posting.issuerPayment) sources.push(posting.issuerPayment.allocationSource);
          }
        }
      }
    }
    if (new Set(d.provenance.map(w => w.source.ruleSnapshotId)).size !== d.provenance.length)
      return incomplete("source_not_qualified");
    for (const s of sources) {
      const witnesses = d.provenance.filter(w => same(w.source, s));
      if (witnesses.length !== 1) return incomplete("source_not_qualified");
      const w = witnesses[0]!;
      if (![w.publishedAt, w.knownAt].every(dated) || w.publishedAt > w.knownAt || w.knownAt > context.dataCutoff ||
        w.publishedAt > context.asOf || s.asOf > w.knownAt.slice(0, 10) ||
        (sources.slice(0, 5 + c.charges.length).includes(s) && w.knownAt > a.effectiveAt) ||
        (c.charges.some(x => same(x.source, s)) && w.knownAt > d.charge.effectiveAt))
        return incomplete("source_not_qualified");
    }
    if (d.continuity) {
      const cycle = reconcileCreditCardCycles(d.continuity).records.find(r => r.cardAccountId === c.cardAccountId);
      const original = d.continuity.cycles.flatMap(x => x.request.cards).filter(x => x.statementId === c.statementId);
      if (!cycle || cycle.status !== "conditional_continuity" || cycle.statementContinuityCoverage !== "complete" ||
        original.length !== 1 || !same(original[0], c)) return incomplete("source_not_qualified");
      const paymentProofs = cycle.cycles.find(x => x.statementId === c.statementId)?.observedBoundaryPayments;
      if (!paymentProofs || paymentProofs.length !== 1) return incomplete("source_not_qualified");
      const bankProof = paymentProofs[0]!.bankConfirmation;
      if (!bankProof || bankProof.settlementId !== a.settlementId || bankProof.authorization.authorizationId !== a.authorizationId ||
        bankProof.authorization.effectiveAt !== a.authorizedAt.slice(0, 10) || !bankProof.authorization.amount.equals(a.amount))
        return incomplete("source_not_qualified");
    }
    const exact = (m: Money): boolean => m instanceof Money && !m.isNegative() && m.currency.equals(c.currency) && m.amount.fitsScale(c.currency.minorUnitScale);
    if (![a.bankCashBefore, a.amount, ...Object.values(a.allocation)].every(exact)) return incomplete("source_not_qualified");
    if (!a.amount.isPositive() || !p.minimumUnfunded.isZero()) return incomplete("minimum_unpaid");
    const order = a.executionOrder;
    if (order && (!text(order.sequenceId) || !Number.isSafeInteger(order.position) || order.position < 0)) return incomplete("source_not_qualified");
    const liabilityId = domainId("liability", c.cardAccountId), bankAccountId = domainId("account", a.bankAccountId);
    const sourceVersions = sources.slice(0, 5 + c.charges.length).map(s => JSON.stringify([s.ruleSnapshotId, s.version]));
    const traceIds = [...new Set([...p.traceRefs, d.sourceId, d.quoteId,
      JSON.stringify(["card-bank-source", d.sourceId, d.version, d.sourceApprovalId]), ...sourceVersions])].sort().map(calculationTraceId);
    const traceRefs = traceIds.map(id => calculationTraceRef(id));
    const charges = c.statementInterest.plus(c.statementFees);
    if (!charges.isPositive()) return incomplete("source_not_qualified");
    const originalTransaction = createAccountingTransaction({ id: accountingTransactionId(d.charge.operationId),
      type: "issuer_card_charge", date: d.charge.effectiveAt, traceRefs,
      legs: [createAccountingLeg({ type: "expense", posting: "debit", amount: charges }),
        createAccountingLeg({ type: "liability", posting: "credit", entityId: liabilityId, amount: charges })] });
    const paymentTransaction = createAccountingTransaction({ id: accountingTransactionId(c.payment.operationId),
      type: "funded_card_payment", date: a.effectiveAt, traceRefs,
      legs: [createAccountingLeg({ type: "liability", posting: "debit", entityId: liabilityId, amount: a.amount }),
        createAccountingLeg({ type: "cash", posting: "credit", accountId: bankAccountId, amount: a.amount, cashFlowClass: "operating" })] });
    const source = { kind: "card_interest_payment" as const, sourceId, sourceVersion: d.version,
      ruleVersion: c.allocationPolicy.source.version, publishedAt: a.publishedAt, knownAt: a.knownAt,
      householdId: domainId("household", c.householdId), personId: domainId("person", c.personId),
      sourceApprovalId: d.sourceApprovalId, paymentApprovalId: a.approvalId,
      issuerId: c.issuerId, statementId: c.statementId, chargeId: d.charge.evidenceId, quoteId: d.quoteId,
      minimum: p.requiredService, ...(order === undefined ? {} : { executionOrder: order }) };
    const receipt: D2CardSettlementReceipt = { schemaVersion: "d2-shared/settlement-receipt/v1", kind: "card_interest_payment",
      id: `card-bank:${a.paymentId}`, operationId: c.payment.operationId, authorizationId: a.authorizationId,
      claimId: claimId(p.claim.claimId), paymentId: a.paymentId, recognitionId: recognitionId(d.charge.operationId),
      settlementId: settlementId(a.settlementId), effectiveAt: a.effectiveAt, bankAccountId,
      bankCashBefore: a.bankCashBefore, amount: a.amount, traceIds, sourceEvidenceFingerprint: d2SettlementSourceFingerprint(source), source,
      liabilityId, liabilityBefore: c.openingPrincipal, postedInterest: c.statementInterest, postedFee: c.statementFees,
      interestAllocation: a.allocation.interest, principalAllocation: a.allocation.principal, feeAllocation: a.allocation.fees,
      originalTransaction, paymentTransaction };
    return { status: "qualified", document: d, receipt };
  } catch { return incomplete("source_not_qualified"); }
}

function assertResources(state: AuthoritativeState, r: D2CardSettlementReceipt): void {
  const bank = state.accounts[r.bankAccountId], card = state.liabilities[r.liabilityId];
  if (!bank || bank.id !== r.bankAccountId || bank.ownerId !== r.source.personId || !["checking", "savings"].includes(bank.kind) ||
    !card || card.id !== r.liabilityId || !bank.cash.currency.equals(r.amount.currency) || !card.balance.currency.equals(r.amount.currency))
    fail("Exact issuer liability and owned checking/savings BANK required");
}
function registration(r: D2CardSettlementReceipt): D2PostingRegistration {
  return { ...d2SettlementPostingRegistration(r, "original"), operationId: r.originalTransaction.id };
}
function hasOriginal(state: AuthoritativeState, r: D2CardSettlementReceipt): boolean {
  const archive = state.d2PostedTransactions?.[r.originalTransaction.id];
  const posted = state.identities.postedTransactionIds.includes(r.originalTransaction.id);
  if (archive !== undefined && (!posted || !same(archive.transaction, r.originalTransaction) || !same(archive.registration, registration(r))))
    fail("Immutable canonical charge archive or first-posting registration differs from issuer authority");
  return posted && archive !== undefined;
}
function journalFacts(tx: AccountingTransaction | undefined, tier: "summary" | "detail", currency: Money["currency"]): HouseholdOperationFacts {
  if (tier === "summary") {
    const sink = new SummaryOperationSink(currency);
    if (tx) sink.transaction(tx);
    return { summary: { evidence: sink.snapshot() } };
  }
  return { transactions: tx ? [tx] : [] };
}
const warning = (reason: string) => ({
  outputCapabilities: { cardFutureCycles: { dependency: "tax_independent" as const, status: "incomplete" as const, diagnostics: [] } },
  diagnostics: [{ severity: "warning" as const, code: "CARD_BANK_S7_INCOMPLETE",
    entityType: "card_bank", message: `S7 incomplete: ${reason}; future-cycle coverage remains unavailable.` }] });

/** Configuration contains lookup IDs only. Prepare and execute independently
 * requalify the publisher; canonical state is the only balance/journal writer. */
export function createCardBankParticipant(configuration: CardBankInput): HouseholdKernelParticipant {
  const input = immutableConfiguration({ sourceIds: [...configuration.sourceIds].sort() });
  if (input.sourceIds.some(id => !text(id)) || new Set(input.sourceIds).size !== input.sourceIds.length) fail("Unique source lookup IDs required");
  return Object.freeze({ id: participantId, version: "1", portableCodec: codec, economicInputs: input,
    prepare: (context, period, opening, work = [], tier = "detail") => {
      requalifyD2SettlementReceiptHistory(opening.state, context);
      const operations: ReturnType<HouseholdKernelParticipant["prepare"]>["operations"][number][] = [];
      if (input.sourceIds.length) operations.push({ descriptor: { id: `card-bank:coverage:${period.start}`,
        domain: "liabilities", operationClass: "liabilities:card_coverage", sequencingInstant: period.start,
        dependsOn: [], resourceAccesses: [], traceRefs: [] },
      execute: candidate => ({ ...candidate, facts: warning("future APR, grace, tax and future-cycle projection unavailable") }) });
      const qualified: Qualified[] = [];
      for (const sourceId of input.sourceIds) {
        const q = qualifyCardBankSource(sourceId, context);
        if (q.status === "incomplete") {
          if (Object.values(opening.state.d2PostedTransactions ?? {}).some(proof => proof.registration.kind === "card_interest_payment"))
            fail("Archived card posting cannot be admitted without its independently qualified source");
          operations.push({ descriptor: { id: `card-bank:unavailable:${sourceId}:${period.start}`, domain: "liabilities",
            operationClass: "liabilities:card_coverage", sequencingInstant: period.start, dependsOn: [], resourceAccesses: [], traceRefs: [] },
          execute: candidate => ({ ...candidate, facts: warning(q.reason) }) });
        } else qualified.push(q);
      }
      const used = new Set<string>();
      for (const { receipt: r } of qualified) {
        for (const prior of Object.values(opening.state.d2SettlementReceipts ?? {})) {
          if (prior.kind === "card_interest_payment" && prior.id !== r.id && prior.source.issuerId === r.source.issuerId &&
            (prior.source.quoteId === r.source.quoteId || prior.source.chargeId === r.source.chargeId || prior.source.statementId === r.source.statementId))
            fail("Issuer quote, charge or statement evidence already consumed by another payment");
        }
        for (const key of [`source:${r.source.sourceApprovalId}`, `quote:${r.source.issuerId}:${r.source.quoteId}`,
          `charge:${r.source.issuerId}:${r.source.chargeId}`, `posting:${r.originalTransaction.id}`, `payment:${r.paymentTransaction.id}`,
          `authorization:${r.authorizationId}`, `approval:${r.source.paymentApprovalId}`, `claim:${r.claimId}`]) {
          if (used.has(key)) fail("Duplicate issuer evidence, approval, claim or posting across source documents");
          used.add(key);
        }
        assertResources(opening.state, r);
        hasOriginal(opening.state, r);
      }
      for (const proof of Object.values(opening.state.d2PostedTransactions ?? {})) {
        if (proof.registration.kind !== "card_interest_payment") continue;
        const owner = qualified.find(q => (proof.registration.role === "original" ? q.receipt.originalTransaction.id
          : q.receipt.paymentTransaction.id) === proof.transaction.id);
        if (!owner) fail("Archived card journal lacks independent issuer source coverage");
        const r = owner.receipt, original = proof.registration.role === "original";
        if (!same(proof.transaction, original ? r.originalTransaction : r.paymentTransaction) ||
          !same(proof.registration, original ? registration(r) : d2SettlementPostingRegistration(r, "settlement")) ||
          (!original && !opening.state.d2SettlementReceipts?.[r.id]))
          fail("Archived card journal differs from independently approved posting or paid receipt");
      }
      const events = qualified.flatMap(q => (["original", "settlement"] as const).map(role => ({ q, role,
        tx: role === "original" ? q.receipt.originalTransaction : q.receipt.paymentTransaction })));
      for (const event of events) {
        const { q, role, tx } = event, r = q.receipt;
        if (tx.date < period.start || tx.date >= period.end) continue;
        const dependsOn: string[] = [];
        if (role === "settlement" && r.originalTransaction.date >= period.start) dependsOn.push(r.originalTransaction.id);
        if (role === "settlement") {
          if (work.some(w => w.sequencingInstant === tx.date && w.resourceAccesses.some(a => a.accountId === r.bankAccountId)))
            fail("Same-instant external BANK work requires independent cross-source ordering authority");
          for (const other of events.filter(e => e !== event && e.role === "settlement" && e.tx.date === tx.date &&
            e.q.receipt.bankAccountId === r.bankAccountId)) {
            const before = other.q.receipt.source.executionOrder, current = r.source.executionOrder;
            if (!before || !current || before.sequenceId !== current.sequenceId || before.position === current.position)
              fail("Same-instant BANK payments require distinct independently approved sequence positions");
            if (before.position < current.position) dependsOn.push(other.tx.id);
          }
        }
        if (events.some(e => e !== event && e.tx.date === tx.date && e.q.receipt.liabilityId === r.liabilityId && e.q !== q))
          fail("Concurrent operations on one card require a shared liability ordering contract");
        const descriptor: HouseholdWorkDescriptor = { id: tx.id, domain: "liabilities",
          operationClass: role === "original" ? "liabilities:issuer_card_charge" : "liabilities:issuer_card_payment",
          sequencingInstant: tx.date, dependsOn, traceRefs: tx.traceRefs ?? [],
          resourceAccesses: role === "original" ? [] : [{ kind: "account_cash", accountId: r.bankAccountId, mode: "consume" }] };
        operations.push({ descriptor, execute: candidate => {
          const current = qualifyCardBankSource(r.source.sourceId, context);
          if (current.status !== "qualified") fail("Issuer authority became unavailable during event execution");
          if (!same(current.receipt, r) || !same(current.document, q.document)) fail("Issuer source changed after preparation");
          assertResources(candidate.state, r);
          const original = hasOriginal(candidate.state, r);
          if (role === "original") {
            if (original) return { ...candidate, facts: journalFacts(undefined, tier, context.baseCurrency) };
            if (candidate.state.identities.postedTransactionIds.includes(tx.id) || q.document.request.cards
              .find(c => c.statementId === r.source.statementId)!.charges.some(c => c.recognition === "already_recognized"))
              return { ...candidate, facts: warning("original_journal_unavailable") };
            if (!candidate.state.liabilities[r.liabilityId]!.balance.equals(r.liabilityBefore)) fail("Issuer opening liability differs from canonical state");
            if (candidate.state.identities.recognitionIds.includes(r.recognitionId)) fail("Recognition identity already consumed without the canonical charge journal");
            applyAccountingTransactionAtomically(candidate.state, tx, registration(r));
            registerAuthoritativeIdentity(candidate.state.identities, "recognitionIds", r.recognitionId);
            return { ...candidate, facts: journalFacts(tx, tier, context.baseCurrency) };
          }
          if (!original) return { ...candidate, facts: warning("original_journal_unavailable") };
          const existing = candidate.state.d2SettlementReceipts?.[r.id];
          if (existing && !same(existing, r)) fail("Committed payment receipt differs from independent issuer source");
          if (!existing && (candidate.state.accounts[r.bankAccountId]!.cash.compare(r.amount) < 0 || r.bankCashBefore.compare(r.amount) < 0))
            return { ...candidate, facts: warning("minimum_unpaid: insufficient BANK cash") };
          const committed = applyD2SettlementAtomically(candidate.state, r, context);
          if (committed.status === "incomplete") fail(`Settlement source unavailable: ${committed.reason}`);
          return { ...candidate, facts: { ...journalFacts(committed.status === "committed" ? tx : undefined, tier, context.baseCurrency),
            ...warning("future APR, grace, tax and future-cycle projection unavailable") } };
        } });
      }
      return { id: participantId, operations };
    },
  } satisfies HouseholdKernelParticipant);
}
registerHouseholdParticipantCodec({ codec, restore: value => createCardBankParticipant(value as CardBankInput) });

export function attachCardBank(kernel: CompiledHouseholdKernel, input: CardBankInput): CompiledHouseholdKernel {
  const participant = createCardBankParticipant(input);
  for (const id of input.sourceIds) {
    const raw = sourcePort?.read(id);
    if (raw && kernel.executable.liabilityInput?.loans.some(loan => raw.request.cards.some(card =>
      card.cardAccountId === loan.principalLiabilityId || card.cardAccountId === loan.interestPayableLiabilityId)))
      fail("Card cannot also be registered as a VS4 fixed loan");
  }
  const existing = kernel.executable.participants ?? [], prior = existing.find(p => p.id === participantId);
  if (prior && !same(prior.economicInputs, participant.economicInputs)) fail("Cannot replace attached card source lookup configuration");
  return prior ? kernel : applyHouseholdExecutionOverlay(kernel, { participants: [...existing, participant] });
}
