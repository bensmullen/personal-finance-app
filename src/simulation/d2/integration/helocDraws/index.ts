import { accountingTransactionId, createAccountingLeg, createAccountingTransaction } from "../../../../accounting/index.js";
import { ValidationError } from "../../../../diagnostics/index.js";
import { idempotencyKey } from "../../../../identity/index.js";
import { calculationTraceId, calculationTraceRef } from "../../../../lineage/index.js";
import { applyAccountingTransactionAtomically, registerAuthoritativeIdentity } from "../../../../state/index.js";
import { instant } from "../../../../time/index.js";
import { Money, USD } from "../../../../values/index.js";
import { applyHouseholdExecutionOverlay, runHouseholdKernel, type CompiledHouseholdKernel,
  type HouseholdKernelParticipant } from "../../../householdExecution.js";
import { immutableConfiguration } from "../../../r3/compiledHousehold.js";
import { registerHouseholdParticipantCodec } from "../../../r3/participantCodec.js";
import { SummaryOperationSink } from "../../../r3/summarySink.js";
import { canonicalSerialize, type RunContext } from "../../../run.js";
import { proposeHeloc, type HelocProposal, type HelocRequest, type Source, type Window } from "../../debt/heloc/index.js";

/** Confirmations bind the source quote to existing resources, never create them. */
export interface ConfirmedHelocDraws {
  readonly request: HelocRequest;
  readonly proposal: HelocProposal;
  readonly bank: { readonly classification: "BANK"; readonly accountId: string;
    readonly householdId: string; readonly personId: string; readonly evidence: Source };
  readonly openingBankCash: Money;
  /** Quoted cash immediately before each draw; intervening cash is not invented. */
  readonly bankCashBeforeDraw: Readonly<Record<string, Money>>;
}
export interface HelocDrawInput {
  readonly householdId: string;
  readonly personId: string;
  readonly quotes: readonly ConfirmedHelocDraws[];
}
export interface HelocDrawDiagnostic {
  readonly sourceEntityPath: string;
  readonly period: Window;
  readonly affectedOutput: "heloc_interest" | "heloc_interest_payment" | "heloc_principal_repayment";
  readonly coverage: "incomplete";
  readonly diagnosticCode: "HELOC_EXECUTION_NOT_IMPLEMENTED";
  readonly missingFacts: readonly string[];
  readonly ruleSnapshotId: string;
  readonly traceRefs: readonly string[];
}
const participantId = "d2_heloc_draws";
const at = (date: string) => instant(`${date}T00:00:00.000Z`);
const same = (a: unknown, b: unknown) => canonicalSerialize(a) === canonicalSerialize(b);
// The household portable replay wire format admits exact Money and rule values,
// but not primitive bigint. Preserve all B1 rate millionths losslessly as
// tagged decimal strings in PARTICIPANT CONFIGURATION ONLY. Execution still
// uses the original bigint-based B1 contract and its sole rate evaluator.
const bigintTag = "__d2HelocBigint";
const plain = (value: object): boolean => {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};
const portableRates = (value: unknown): unknown => {
  if (typeof value === "bigint") return { [bigintTag]: value.toString() };
  if (Array.isArray(value)) return value.map(portableRates);
  if (value !== null && typeof value === "object" && plain(value))
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, portableRates(child)]));
  return value;
};
const restoreRates = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(restoreRates);
  if (value !== null && typeof value === "object" && plain(value)) {
    const entries = Object.entries(value);
    if (entries.length === 1 && entries[0]![0] === bigintTag) {
      const raw = entries[0]![1];
      if (typeof raw !== "string" || !/^-?\d+$/.test(raw))
        return fail("HELOC_PORTABLE_RATE_INVALID", "Invalid portable HELOC rate representation");
      return BigInt(raw);
    }
    return Object.fromEntries(entries.map(([key, child]) => [key, restoreRates(child)]));
  }
  return value;
};
const exact = (value: Money) => value instanceof Money && value.currency.equals(USD) && value.amount.fitsScale(2);
const outputCapabilities = immutableConfiguration({
  helocPrincipalTransfer: { dependency: "tax_independent" as const, status: "complete" as const, diagnostics: [] },
  ...Object.fromEntries(["helocInterest", "helocInterestPayment", "helocPrincipalRepayment", "cash", "liabilities", "netWorth", "interestExpense"].map(field =>
    [field, { dependency: "tax_affected" as const, status: "incomplete" as const, diagnostics: [] }])),
});
function fail(code: string, message: string, ids: readonly string[] = []): never {
  throw new ValidationError({ severity: "error", code, message, entityType: "heloc_draw", relatedIds: ids });
}
const quote = (request: HelocRequest) => {
  try { return proposeHeloc(request); }
  catch { return fail("HELOC_QUOTE_INCOMPLETE", "Valid source, rate, issuer and exact-money B1 request required"); }
};
const unposted = (input: HelocDrawInput): readonly HelocDrawDiagnostic[] => Object.freeze(input.quotes.flatMap(q =>
  (["heloc_interest", "heloc_interest_payment", "heloc_principal_repayment"] as const).map(affectedOutput => Object.freeze({
    sourceEntityPath: `heloc/${q.request.lineId}`, period: q.request.period, affectedOutput, coverage: "incomplete" as const,
    diagnosticCode: "HELOC_EXECUTION_NOT_IMPLEMENTED" as const,
    missingFacts: ["Only authorized principal draws execute; accrual, repricing, claims, repayment and balloon remain unposted"],
    ruleSnapshotId: q.request.source?.ruleSnapshotId ?? "unavailable", traceRefs: q.proposal?.traceRefs ?? [],
  }))));

/** Opt-in draw-only participant. B1 remains the sole source evaluator. */
export function createHelocDrawParticipant(configuration: HelocDrawInput): HouseholdKernelParticipant {
  const input = immutableConfiguration({ ...configuration, quotes: [...configuration.quotes].sort((a, b) =>
    canonicalSerialize([a.request.period.start, a.request.lineId]).localeCompare(canonicalSerialize([b.request.period.start, b.request.lineId]))) });
  return Object.freeze({ id: participantId, version: "d2-draw-only/v1", portableCodec: "d2-heloc-draws/v1", economicInputs: immutableConfiguration(portableRates(input)),
    prepare: (context, period, opening, work = [], tier = "detail") => {
      const active = input.quotes.filter(q => at(q.request.period.start) < period.end && at(q.request.period.endExclusive) > period.start);
      const operationIds = new Set<string>(); const authorizations = new Set<string>(); const lines = new Set<string>();
      const operations: ReturnType<HouseholdKernelParticipant["prepare"]>["operations"][number][] = [];
      // Coverage is a read fact, not a financial posting. Preserve it after the
      // draw period and when identical receipts suppress every posting on replay.
      if (input.quotes.some(q => at(q.request.period.start) < period.end)) operations.push({
        descriptor: { id: `d2:heloc-coverage:${period.start}`, domain: "liabilities", operationClass: "liabilities:heloc_coverage",
          sequencingInstant: period.start, dependsOn: [], resourceAccesses: [], traceRefs: [] },
        execute: candidate => ({ ...candidate, facts: { outputCapabilities, diagnostics: [{ severity: "warning",
          code: "HELOC_EXECUTION_NOT_IMPLEMENTED", entityType: "heloc_draw",
          message: "Principal draws only: interest, repricing, claims, payments and balloon are unposted; the forecast remains incomplete." }] } }),
      });
      for (const q of active) {
        const r = q.request;
        if (at(r.period.start) !== period.start || at(r.period.endExclusive) !== period.end)
          fail("HELOC_PERIOD_BOUNDARY_REQUIRED", "Source principal and cash must describe this exact household period boundary");
        if (lines.has(r.lineId) || active.some(other => other !== q && other.request.liabilityAccountId === r.liabilityAccountId))
          fail("HOUSEHOLD_CONTENTION_UNRESOLVED", "Overlapping line/liability quotes need an explicit shared reservation contract", [r.lineId]);
        lines.add(r.lineId);
        const cutoff = context.dataCutoff.slice(0, 10);
        if (r.evaluatedAsOf > cutoff || !context.baseCurrency.equals(USD))
          fail("HELOC_SOURCE_UNAVAILABLE", "Entire B1 quote must be known by the run data cutoff in USD");
        const regenerated = quote(r);
        if (regenerated.coverage !== "complete" || regenerated.proposals.length !== 1 || !same(regenerated.proposals[0], q.proposal))
          fail("HELOC_QUOTE_INCOMPLETE", "Exact fully source-qualified B1 quote required", regenerated.diagnostics.map(d => d.diagnosticCode));
        if (r.householdId !== input.householdId || r.borrowerId !== input.personId || r.ownerId !== input.personId
          || q.bank.classification !== "BANK" || q.bank.accountId !== r.bankAccountId
          || q.bank.householdId !== input.householdId || q.bank.personId !== input.personId)
          fail("HELOC_IDENTITY_MISMATCH", "Quote, borrower, household and BANK confirmation must agree");
        const bankEvidence = q.bank.evidence;
        // Reuse B1's source qualification for the independent BANK binding.
        const bound = quote({ ...r, source: bankEvidence });
        if (bound.coverage !== "complete") fail("HELOC_SOURCE_UNAVAILABLE", "Verified BANK binding covering this period and known by its opening required");
        const bank = opening.state.accounts[r.bankAccountId]; const liability = opening.state.liabilities[r.liabilityAccountId];
        if (!bank || bank.id !== r.bankAccountId || !["checking", "savings"].includes(bank.kind) || bank.ownerId !== input.personId
          || !liability || liability.id !== r.liabilityAccountId)
          fail("HELOC_RESOURCE_INVALID", "Exact existing liability and borrower-owned checking/savings required");
        const bankId = bank.id; const liabilityId = liability.id;
        if (![bank.cash, liability.balance, q.openingBankCash, r.openingPrincipal, r.creditLimit].every(exact))
          fail("HELOC_INVALID_MONEY", "USD exact-cent opening balances and credit limit required");
        if (q.proposal.movements.some(m => m.kind !== "draw") || !q.proposal.movements.length)
          fail("HELOC_DRAW_ONLY", "This participant admits only nonempty draw-only quotes");
        const firstDraw = q.proposal.movements[0]!.effectiveAt;
        const sources = [r.source, bankEvidence, r.interest.source, r.rate!.source,
          ...(r.rate!.legalMaximum ? [r.rate!.legalMaximum.source] : []), ...r.rate!.resets.map(s => s.source),
          ...r.rate!.observations.map(s => s.source), ...r.events.map(e => e.source)];
        if (sources.some(s => s.asOf > firstDraw || s.publishedAt > firstDraw))
          fail("HELOC_SOURCE_UNAVAILABLE", "Whole conditional quote must be known by the first admitted draw; no future index lookahead");
        let priorPrincipal = r.openingPrincipal;
        let postedCash = Money.zero(USD);
        const pending: (typeof q.proposal.movements)[number][] = [];
        for (const m of q.proposal.movements) {
          const event = r.events.find(e => e.operationId === m.operationId);
          if (operationIds.has(m.operationId) || authorizations.has(m.authorizationId))
            fail("HELOC_DUPLICATE_AUTHORIZATION", "Operation and authorization identities must be unique across all quotes");
          operationIds.add(m.operationId); authorizations.add(m.authorizationId);
          const cashBefore = q.bankCashBeforeDraw[m.operationId];
          if (!event || !event.authorized || !exact(m.cashDelta) || !m.cashDelta.isPositive()
            || !m.liabilityDelta.equals(m.cashDelta) || !m.income.isZero() || !m.expense.isZero() || !m.netWorthDelta.isZero()
            || m.sourceAccountId !== r.liabilityAccountId || m.destinationAccountId !== bankId || !cashBefore || !exact(cashBefore))
            fail("HELOC_MOVEMENT_INVALID", "Positive exact-cent authorized draw and quoted prior cash required");
          const txId = accountingTransactionId(m.operationId);
          const operationKey = idempotencyKey("d2:source-operation", m.operationId);
          const authKey = idempotencyKey("d2:authorization", m.authorizationId);
          const receiptKey = idempotencyKey("d2:heloc-draw-receipt", canonicalSerialize({
            quote: { ...q, request: q.proposal.evidence }, operationId: m.operationId,
          }));
          const registry = opening.state.identities;
          const posted = registry.postedTransactionIds.includes(txId);
          const keys = [operationKey, authKey, receiptKey];
          if (posted || keys.some(key => registry.externalIdempotencyKeys.includes(key))) {
            if (!posted || !keys.every(key => registry.externalIdempotencyKeys.includes(key)) || pending.length)
              fail("HELOC_STALE_OR_DUPLICATE", "Prior posting must be an identical source receipt and a contiguous quote prefix");
            postedCash = postedCash.plus(m.cashDelta);
          } else pending.push(m);
          const expectedPrincipal = priorPrincipal;
          priorPrincipal = priorPrincipal.plus(m.liabilityDelta);
          if (priorPrincipal.compare(r.creditLimit) > 0) fail("HELOC_CREDIT_LIMIT_EXCEEDED", "Cumulative draw exceeds quoted credit");
          if (posted) continue;
          const traceRefs = [...new Set([...q.proposal.traceRefs, bankEvidence.ruleSnapshotId, m.operationId, m.authorizationId])]
            .sort().map(id => calculationTraceRef(calculationTraceId(id)));
          const descriptor = { id: m.operationId, domain: "liabilities", operationClass: "liabilities:heloc_draw",
            sequencingInstant: at(m.effectiveAt), dependsOn: m.dependsOn.filter(id => pending.some(p => p.operationId === id)),
            resourceAccesses: [{ kind: "account_cash" as const, accountId: bankId, mode: "produce" as const }], traceRefs };
          // B1 supplies explicit within-line ordering. No new cash priority.
          if (work.some(w => w.sequencingInstant === descriptor.sequencingInstant && w.resourceAccesses.some(a => a.accountId === bankId))
            || active.some(other => other !== q && other.request.bankAccountId === bankId
              && other.proposal.movements.some(otherMove => otherMove.effectiveAt === m.effectiveAt)))
            fail("HOUSEHOLD_CONTENTION_UNRESOLVED", "Same-day shared BANK work requires an explicit cross-source ordering/reservation contract", [m.operationId, bankId]);
          operations.push({ descriptor, execute: candidate => {
            const currentBank = candidate.state.accounts[bankId]; const currentLoan = candidate.state.liabilities[liabilityId];
            if (!currentBank || currentBank.ownerId !== input.personId || !["checking", "savings"].includes(currentBank.kind)
              || !currentLoan || !currentBank.cash.equals(cashBefore) || !currentLoan.balance.equals(expectedPrincipal)
              || currentLoan.balance.plus(m.liabilityDelta).compare(r.creditLimit) > 0)
              fail("HELOC_STALE_BALANCE", "Current bank cash and principal/remaining credit must match the source quote before posting");
            if (candidate.state.identities.postedTransactionIds.includes(txId)
              || keys.some(key => candidate.state.identities.externalIdempotencyKeys.includes(key)))
              fail("HELOC_STALE_OR_DUPLICATE", "Draw or authorization already consumed");
            const transaction = createAccountingTransaction({ id: txId, type: "heloc_draw", date: descriptor.sequencingInstant, traceRefs,
              legs: [createAccountingLeg({ type: "cash", posting: "debit", amount: m.cashDelta, accountId: bankId, cashFlowClass: "financing" }),
                createAccountingLeg({ type: "liability", posting: "credit", amount: m.liabilityDelta, entityId: liabilityId })] });
            applyAccountingTransactionAtomically(candidate.state, transaction);
            for (const key of keys) registerAuthoritativeIdentity(candidate.state.identities, "externalIdempotencyKeys", key);
            if (tier === "summary") {
              const sink = new SummaryOperationSink(USD); sink.transaction(transaction);
              return { ...candidate, facts: { summary: { evidence: sink.snapshot() }, outputCapabilities } };
            }
            return { ...candidate, facts: { transactions: [transaction], traceRefs, outputCapabilities } };
          } });
        }
        if (!liability.balance.equals(r.openingPrincipal.plus(postedCash)) || !bank.cash.equals(q.openingBankCash.plus(postedCash)))
          fail("HELOC_STALE_BALANCE", "Authoritative period opening must match sourced principal and bank cash, including identical prior draws");
      }
      return { id: participantId, operations };
    },
  } satisfies HouseholdKernelParticipant);
}
registerHouseholdParticipantCodec({ codec: "d2-heloc-draws/v1", restore: value => createHelocDrawParticipant(restoreRates(value) as HelocDrawInput) });

export function attachHelocDraws(kernel: CompiledHouseholdKernel, input: HelocDrawInput) {
  const participant = createHelocDrawParticipant(input);
  const existing = kernel.executable.participants ?? [];
  const prior = existing.find(p => p.id === participant.id);
  if (prior && (prior.version !== participant.version || !same(prior.economicInputs, participant.economicInputs)))
    fail("HELOC_STALE_PARTICIPANT", "A different source version cannot replace an attached draw participant");
  const next = prior ? kernel : applyHouseholdExecutionOverlay(kernel, { participants: [...existing, participant] });
  return Object.freeze({ kernel: next, diagnosticSeam: "S7" as const, coverage: "incomplete" as const,
    diagnostics: unposted(input) });
}
export function runHelocDraws(request: { readonly kernel: CompiledHouseholdKernel; readonly input: HelocDrawInput; readonly runContext: RunContext }) {
  const attached = attachHelocDraws(request.kernel, request.input);
  return Object.freeze({ ...attached, result: runHouseholdKernel({ kernel: attached.kernel, runContext: request.runContext, resultTier: "detail" }) });
}
