import { domainId } from "../../../../identity/index.js";
import { sha256 } from "../../../../rules/tax/t1b/contentIdentity.js";
import type { HouseholdBankEventContext, HouseholdEconomicOriginalReference, PayrollHealthSourceBinding } from "../../../../state/index.js";
import { createFundingPolicy, fundingPolicyId } from "../../../../funding/index.js";
import { calculationTraceId, calculationTraceRef } from "../../../../lineage/index.js";
import { civilDate, instant, type CivilDate } from "../../../../time/index.js";
import { Currency, Money, Rate, rateConvention } from "../../../../values/index.js";
import { applyHouseholdExecutionOverlay, type CompiledHouseholdKernel } from "../../../r3/compiledHousehold.js";
import { canonicalSerialize, type RunContext } from "../../../run.js";
import { immutableConfiguration } from "../../../r3/compiledHousehold.js";
import type { HouseholdKernelParticipant } from "../../../householdExecution.js";
import { registerHouseholdParticipantCodec } from "../../../r3/participantCodec.js";
import { qualifyHouseholdExpense, registerHouseholdExpenseOriginalProvider,
  type HouseholdExpenseOriginal, type HouseholdExpenseSourceRef } from "../householdBank/expenses.js";
import type { RecurringExpenseStream } from "../../../verticalSlice2.js";
import { proposePremiums, type PremiumDiagnostic, type PremiumProposal, type PremiumRequest, type PremiumSource } from "../../health/premiums/index.js";

/** Confirmation binds an exact C1 occurrence to explicit engine identities. No account discovery. */
export interface ConfirmedPremium {
  readonly householdExpenseSource?: HouseholdExpenseSourceRef;
  readonly proposal: PremiumProposal;
  readonly expenseId: RecurringExpenseStream["id"];
  readonly primitiveIds: RecurringExpenseStream["primitiveIds"];
  readonly settlementPriority: number;
  readonly bank: {
    readonly accountId: RecurringExpenseStream["paymentAccountId"];
    readonly householdId: string;
    readonly payerId: string;
    readonly classification: "BANK";
    readonly evidence: PremiumSource;
  };
  readonly payable: {
    readonly liabilityId: RecurringExpenseStream["payableLiabilityId"];
    readonly householdId: string;
    readonly payerId: string;
    readonly coverageId: string;
    readonly evidence: PremiumSource;
  };
}

/** Source declarations cover every overlapping generic stream; opaque booleans are insufficient. */
export interface PremiumRepresentation {
  readonly operationId: string;
  readonly streamId: string;
  readonly relationship: "equivalent_expense" | "distinct_obligation";
  readonly quoteId: string;
  readonly evidence: PremiumSource;
  readonly streamSourceTraceId: string;
}
export interface AftertaxPremiumInput {
  /** Required for source-qualified Household BANK admission. */
  readonly runContext?: RunContext;
  readonly kernel: CompiledHouseholdKernel;
  readonly request: PremiumRequest;
  readonly asOf: CivilDate;
  readonly confirmed: readonly ConfirmedPremium[];
  readonly representations: readonly PremiumRepresentation[];
}

const at = (date: string) => instant(`${date}T00:00:00.000Z`);
const nonempty = (value: string) => typeof value === "string" && value.trim().length > 0;
const same = (a: unknown, b: unknown) => canonicalSerialize(a) === canonicalSerialize(b);
const identityStrings = (value: unknown, seen = new Set<object>(), found = new Set<string>()): Set<string> => {
  if (typeof value === "string") found.add(value);
  else if (value !== null && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    for (const item of Object.values(value)) identityStrings(item, seen, found);
  }
  return found;
};
const monthEnd = (date: CivilDate): CivilDate => {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return civilDate(`${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, "0")}-01`);
};
const qualified = (source: PremiumSource, asOf: CivilDate, start: CivilDate, end: CivilDate) => {
  civilDate(source.start); civilDate(source.endExclusive); civilDate(source.asOf);
  return [source.ruleSnapshotId, source.sourcePublication, source.ruleFamily, source.jurisdiction, source.version].every(nonempty)
    && source.projectionStatus === "verified" && source.asOf <= asOf
    && source.start <= start && source.endExclusive >= end;
};

/** Independently controlled coverage/plan archive. Neither portable streams nor
 * caller confirmations install a publisher or supply its originals. */
export interface AftertaxPremiumOriginal {
  readonly version: string;
  readonly publishedAt: RunContext["asOf"];
  readonly knownAt: RunContext["dataCutoff"];
  readonly request: PremiumRequest;
  readonly confirmation: Omit<ConfirmedPremium, "householdExpenseSource">;
  readonly original: HouseholdExpenseOriginal;
}
export interface AftertaxPremiumSourcePort {
  readonly publisherId: string;
  readonly readOriginal: (reference: HouseholdEconomicOriginalReference,
    context: HouseholdBankEventContext) => AftertaxPremiumOriginal | undefined;
}
const premiumPublishers = new Map<string, AftertaxPremiumSourcePort>();
export const aftertaxPremiumOriginalDigest = (d: Omit<AftertaxPremiumOriginal, "original">): string =>
  `sha256:${sha256(canonicalSerialize({ version: d.version, publishedAt: d.publishedAt, knownAt: d.knownAt,
    request: d.request, confirmation: d.confirmation }))}`;

function readPremiumOriginal(ref: HouseholdEconomicOriginalReference, context: HouseholdBankEventContext): AftertaxPremiumOriginal {
  const raw = premiumPublishers.get(ref.publisherId)?.readOriginal(Object.freeze({ ...ref }), Object.freeze({ ...context }));
  if (!raw) throw new Error("PREMIUM_ORIGINAL_UNAVAILABLE");
  const d = immutableConfiguration(raw), b = d.confirmation, p = b.proposal, o = d.original;
  const coverage = d.request.coverages.find(c => c.id === p.coverageId);
  const start = civilDate(`${p.effectiveAt.slice(0, 7)}-01`), end = monthEnd(p.effectiveAt);
  const regenerated = proposePremiums(d.request);
  if (ref.family !== "health_premium" || ref.revisionId !== d.version || ref.digest !== aftertaxPremiumOriginalDigest(d)
    || !same(o.witness.original, ref) || !same(o.context, context)
    || instant(d.publishedAt) > instant(d.knownAt) || d.knownAt > context.dataCutoff || d.publishedAt > context.asOf
    || d.knownAt > context.eventAt || context.dataCutoff > context.asOf
    || !coverage || coverage.planFamily !== "health_insurance" || coverage.medicare || coverage.route.kind !== "aftertax_bank"
    || coverage.quote.schedule.frequency !== "monthly" || coverage.quote.schedule.interval !== 1
    || [coverage.start, coverage.endExclusive, d.request.period.start, d.request.period.endExclusive].some(date => !date.endsWith("-01"))
    || regenerated.proposals.filter(q => q.operationId === p.operationId && same(q, p)).length !== 1
    || regenerated.diagnostics.some(q => q.affectedOutput === "quoted_premium")
    || !d.request.memberIds.includes(p.payerId) || !p.memberIds.includes(o.witness.beneficiary)
    || context.householdId !== p.householdId || context.personId !== p.payerId || context.bankAccountId !== b.bank.accountId
    || context.direction !== "debit" || context.eventAt !== at(p.effectiveAt)
    || b.bank.accountId !== coverage.route.sourceAccountId || b.bank.householdId !== p.householdId || b.bank.payerId !== p.payerId
    || b.bank.classification !== "BANK" || b.payable.householdId !== p.householdId || b.payable.payerId !== p.payerId
    || b.payable.coverageId !== p.coverageId || o.expenseId !== b.expenseId
    || o.period.start !== at(start) || o.period.end !== at(end)
    || o.witness.source.kind !== "organization" || o.witness.source.id !== p.recipientId
    || o.witness.payer.kind !== "person" || o.witness.payer.id !== p.payerId
    || ![p.source, coverage.route.evidence, ...coverage.eligibility.map(e => e.evidence),
      ...p.coordinationEvidence.map(e => e.evidence), b.bank.evidence, b.payable.evidence]
      .every(s => qualified(s, civilDate((context.dataCutoff < context.eventAt ? context.dataCutoff : context.eventAt).slice(0, 10)), start, end))
    || !p.memberAmount.isPositive() || ![o.recognition, o.settlement].every(tx => tx.legs.every(l => l.amount.equals(p.memberAmount)))
    || o.recognition.legs[1]?.type !== "liability" || o.recognition.legs[1].entityId !== b.payable.liabilityId)
    throw new Error("PREMIUM_ORIGINAL_NOT_QUALIFIED");
  return d;
}

export function registerAftertaxPremiumSourcePort(port: AftertaxPremiumSourcePort): void {
  if (!nonempty(port.publisherId) || premiumPublishers.has(port.publisherId)) throw new Error("PREMIUM_PUBLISHER_DUPLICATE");
  premiumPublishers.set(port.publisherId, Object.freeze({ publisherId: port.publisherId, readOriginal: port.readOriginal.bind(port) }));
  registerHouseholdExpenseOriginalProvider({ family: "health_premium", publisherId: port.publisherId,
    readOriginal: (ref, context) => { try { return readPremiumOriginal(ref, context).original; } catch { return undefined; } } });
}

interface PremiumGuardBinding { readonly source: HouseholdExpenseSourceRef; readonly context: HouseholdBankEventContext; }
/** Observe the real payroll proof, regardless of which route executes first.
 * A conflict rolls back the period; this guard never posts money. */
function premiumGuard(input: PremiumGuardBinding): HouseholdKernelParticipant {
  const binding = immutableConfiguration(input), id = `aftertax-source:${canonicalSerialize(binding.source.original)}`;
  const inspect = (s: PayrollHealthSourceBinding) => {
    const d = readPremiumOriginal(binding.source.original, binding.context), p = d.confirmation.proposal;
    if (s.householdId === p.householdId && (s.planId === p.planId || s.coverageId === p.coverageId)
      && (s.ownerId === p.payerId || p.memberIds.includes(s.ownerId))
      && s.periodStart < d.original.period.end && s.periodEnd > d.original.period.start)
      throw new Error("DUPLICATE_PREMIUM_PAYROLL_ROUTE");
  };
  return Object.freeze({ id, version: "1", portableCodec: "d2-aftertax-source/v1", economicInputs: binding,
    prepare: (context, period, opening) => {
      if (binding.context.eventAt >= period.start && binding.context.eventAt < period.end) {
        if (context.runId !== binding.context.runId || context.asOf !== binding.context.asOf || context.dataCutoff !== binding.context.dataCutoff)
          throw new Error("PREMIUM_RUN_CONTEXT_CHANGED");
        readPremiumOriginal(binding.source.original, binding.context);
        for (const proof of Object.values(opening.state.d2PostedTransactions ?? {}))
          if (proof.registration.kind === "payroll_health_deduction") inspect(proof.registration.deduction.source);
      }
      return { id, operations: [] };
    },
    observe: (_descriptor, facts, runtime) => {
      for (const row of facts.cash?.payrollWithholding ?? facts.summary?.cash?.payrollWithholding ?? [])
        if (row.healthDeduction) inspect(row.healthDeduction.source);
      return runtime;
    },
  } satisfies HouseholdKernelParticipant);
}
registerHouseholdParticipantCodec({ codec: "d2-aftertax-source/v1", restore: value => premiumGuard(value as PremiumGuardBinding) });

/** Optional physical adapter: all money is executed by VS2. Each confirmed occurrence gets
 * one month-bounded recurring stream, preserving identities across split requests/replay.
 * Exact reattachment replaces the stream; changed or renamed sources must qualify again.
 */
export function attachAftertaxPremiums(input: AftertaxPremiumInput) {
  const { kernel, request } = input;
  const diagnostics: PremiumDiagnostic[] = [];
  const admitted: string[] = [];
  const diagnose = (coverageId: string, code: string, fact: string) => {
    const coverage = request.coverages.find(c => c.id === coverageId);
    diagnostics.push(Object.freeze({ diagnosticCode: code, sourceEntityPath: `coverages/${encodeURIComponent(coverageId)}`,
      period: Object.freeze({ ...request.period }), affectedOutput: "net_cash", coverage: "incomplete",
      missingFacts: Object.freeze([fact]), ruleSnapshotId: coverage?.quote?.source?.ruleSnapshotId ?? "unavailable",
      traceRefs: Object.freeze([coverageId, coverage?.quote?.quoteId ?? "unavailable"]) }));
  };
  const result = (next = kernel, domainDiagnostics: readonly PremiumDiagnostic[] = []) => Object.freeze({
    contractVersion: "d2-shared/v1" as const, diagnosticSeam: "S7" as const,
    kernel: next, admittedOperationIds: Object.freeze([...admitted]), diagnostics: Object.freeze([...diagnostics]),
    domainDiagnostics: Object.freeze([...domainDiagnostics]), netCashCoverage: diagnostics.length ? "incomplete" as const : "complete" as const,
  });
  if (request.coverages.length === 0 && input.confirmed.length === 0) return result();
  let quoted: ReturnType<typeof proposePremiums>;
  try { civilDate(input.asOf); quoted = proposePremiums(request); }
  catch {
    for (const coverage of request.coverages) diagnose(coverage.id, "PREMIUM_REQUEST_INVALID", "valid run asOf and reconciled source quote, currency, membership and recurrence");
    return result();
  }
  for (const diagnostic of quoted.diagnostics.filter(d => d.affectedOutput === "quoted_premium")) diagnostics.push(diagnostic);
  const cash = kernel.cash?.input;
  if (!cash || cash.householdId !== request.householdId
    || request.period.start < kernel.horizon.start.slice(0, 10)
    || request.period.endExclusive > (kernel.horizon.periods.at(-1)?.end.slice(0, 10) ?? "")) {
    for (const coverage of request.coverages) diagnose(coverage.id, "COMPILED_HOUSEHOLD_REQUIRED", "existing matching VS2 household and a request within its compiled horizon");
    return result(kernel, quoted.diagnostics);
  }
  let expenses = [...cash.expenses];
  let participants = [...(kernel.executable.participants ?? [])];
  for (const coverage of [...request.coverages].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    if (coverage.endExclusive <= request.period.start || coverage.start >= request.period.endExclusive) continue;
    const proposals = quoted.proposals.filter(p => p.coverageId === coverage.id);
    let candidate = [...expenses];
    const guards: HouseholdKernelParticipant[] = [];
    const accepted: string[] = [];
    try {
      if (coverage.planFamily !== "health_insurance" || coverage.medicare || coverage.route.kind !== "aftertax_bank")
        throw new Error("UNSUPPORTED_PREMIUM_ROUTE: non-Medicare aftertax_bank only; payroll, SSA and IRMAA need their integration owners");
      if (coverage.quote.schedule.frequency !== "monthly" || coverage.quote.schedule.interval !== 1
        || [coverage.start, coverage.endExclusive, request.period.start, request.period.endExclusive].some(d => !d.endsWith("-01")))
        throw new Error("UNSUPPORTED_PREMIUM_SCHEDULE: full calendar month coverage and monthly recurrence required");
      for (const p of proposals) {
        const start = civilDate(`${p.effectiveAt.slice(0, 7)}-01`);
        const end = monthEnd(p.effectiveAt);
        const confirmations = input.confirmed.filter(b => b.proposal.operationId === p.operationId);
        const b = confirmations[0];
        if (confirmations.length !== 1 || !b || !same(b.proposal, p)) throw new Error("CONFIRMED_QUOTE_REQUIRED: exact regenerated C1 proposal confirmation");
        const sources = [p.source, coverage.route.evidence, ...coverage.eligibility.map(e => e.evidence),
          ...p.coordinationEvidence.map(e => e.evidence), b.bank.evidence, b.payable.evidence];
        if (!sources.every(s => qualified(s, input.asOf, start, end))) throw new Error("SOURCE_ASOF_REQUIRED: verified effective sources known at run asOf");
        const account = kernel.executable.reconciledOpeningState.accounts[b.bank.accountId];
        const payable = kernel.executable.reconciledOpeningState.liabilities[b.payable.liabilityId];
        Currency.of(cash.baseCurrency.code);
        if (b.bank.classification !== "BANK" || b.bank.householdId !== p.householdId || b.bank.payerId !== p.payerId
          || b.bank.accountId !== coverage.route.sourceAccountId || !account || account.id !== b.bank.accountId
          || !["checking", "savings"].includes(account.kind) || account.ownerId !== (b.householdExpenseSource ? p.householdId : p.payerId)
          || !payable || payable.id !== b.payable.liabilityId || b.payable.householdId !== p.householdId
          || b.payable.payerId !== p.payerId || b.payable.coverageId !== p.coverageId)
          throw new Error("SOURCED_BANK_PAYABLE_REQUIRED: existing explicitly owned BANK and coverage-qualified payable liability");
        if (b.householdExpenseSource) {
          const ctx = input.runContext;
          if (!ctx || ctx.asOf.slice(0, 10) !== input.asOf) throw new Error("PREMIUM_RUN_CONTEXT_REQUIRED");
          const context: HouseholdBankEventContext = { runId: ctx.runId, asOf: ctx.asOf, dataCutoff: ctx.dataCutoff,
            householdId: cash.householdId, personId: domainId("person", p.payerId), bankAccountId: b.bank.accountId,
            direction: "debit", eventAt: at(p.effectiveAt), eventId: `settlement:obligation:recognition:expense:${b.expenseId}:${at(p.effectiveAt)}` };
          const d = readPremiumOriginal(b.householdExpenseSource.original, context);
          const { householdExpenseSource: _source, ...confirmation } = b;
          if (!same(d.request, request) || !same(d.confirmation, confirmation)) throw new Error("PREMIUM_ORIGINAL_BINDING_CHANGED");
          qualifyHouseholdExpense(b.householdExpenseSource, context, d.original);
          const guard = premiumGuard({ source: b.householdExpenseSource, context });
          const prior = participants.find(p => p.id === guard.id);
          if (prior && !same(prior.economicInputs, guard.economicInputs)) throw new Error("PREMIUM_SOURCE_BINDING_CHANGED");
          if (!prior) guards.push(guard);
        }
        if (cash.baseCurrency.minorUnitScale !== 2 || ![p.memberAmount, p.grossAmount, p.employerAmount, account.cash, payable.balance]
          .every(m => m instanceof Money && m.currency.equals(cash.baseCurrency) && m.amount.fitsScale(2)))
          throw new Error("CENT_CURRENCY_REQUIRED: one known compiled currency with exact cents");
        if (!Number.isSafeInteger(b.settlementPriority)) throw new Error("PRIORITY_REQUIRED: explicit VS2 settlement priority");
        if (Object.values(kernel.executable.reconciledOpeningState.obligations).some(claim =>
          claim.recognizedAt >= at(start) && claim.recognizedAt < at(end)
          && claim.traceRefs?.some(r => r.traceId === p.quoteId || r.traceId === p.source.ruleSnapshotId)))
          throw new Error("ALREADY_RECOGNIZED_PREMIUM: opening state already contains a source-linked claim for this month");
        const ids = [domainId("expense", b.expenseId), ...Object.values(b.primitiveIds).map(id => domainId("primitive-instance", id))];
        if (ids.length !== 4 || new Set(ids).size !== ids.length || b.primitiveIds.activation || b.primitiveIds.termination)
          throw new Error("IDENTITY_COLLISION: distinct expense and three primitive identities required");
        const trace = `d2:aftertax-premium:${canonicalSerialize([p.householdId, p.payerId, p.coverageId, p.planId, p.quoteId, p.effectiveAt, p.source, p.memberIds])}`;
        const stream: RecurringExpenseStream = {
          id: b.expenseId, ownerId: b.householdExpenseSource ? domainId("person", p.payerId) : cash.householdId,
          ...(b.householdExpenseSource === undefined ? {} : { householdExpenseSource: b.householdExpenseSource }), paymentAccountId: b.bank.accountId,
          payableLiabilityId: b.payable.liabilityId, baseMonthlyAmount: p.memberAmount, start: at(start), end: at(end),
          recurrence: { kind: "utc_monthly", anchor: at(p.effectiveAt), invalidDayPolicy: "skip" },
          inflationRate: Rate.fromDecimal("0", rateConvention.effectiveAnnual()), inflationBaseAt: at(p.effectiveAt),
          fundingPolicy: createFundingPolicy({ id: fundingPolicyId(trace), orderedSources: [{ kind: "cash_account", accountId: b.bank.accountId }],
            allowPartial: false, insufficientFundsBehavior: "unfunded" }),
          settlementPriority: b.settlementPriority, primitiveIds: { ...b.primitiveIds },
          sourceTraceRefs: [...new Set([trace, ...p.traceRefs, b.bank.evidence.ruleSnapshotId, b.payable.evidence.ruleSnapshotId])]
            .sort().map(id => calculationTraceRef(calculationTraceId(id))),
        };
        const prior = candidate.find(s => s.id === stream.id);
        if (prior && same(prior, stream)) candidate = candidate.filter(s => s.id !== stream.id);
        const equivalent = new Set<string>();
        for (const other of [...cash.incomes, ...candidate]) {
          if (other.start >= at(end) || (other.end ?? kernel.horizon.periods.at(-1)!.end) <= at(start)) continue;
          // A regular salary/income stream cannot itself be the member premium
          // expense. Demand representation proof only when an income is explicitly
          // linked to this quote/source; ordinary independent income remains valid.
          if (!("paymentAccountId" in other) && !(other.sourceTraceRefs ?? []).some(ref =>
            ref.traceId === p.quoteId || ref.traceId === p.source.ruleSnapshotId ||
            ref.traceId.startsWith("d2:aftertax-premium:"))) continue;
          for (const priorTrace of other.sourceTraceRefs ?? []) {
            if (!priorTrace.traceId.startsWith("d2:aftertax-premium:")) continue;
            const identity: unknown = JSON.parse(priorTrace.traceId.slice("d2:aftertax-premium:".length));
            if (!Array.isArray(identity) || !Array.isArray(identity[7])) throw new Error("REPRESENTATION_PROOF_REQUIRED: invalid prior premium provenance");
            if (identity[0] !== p.householdId) throw new Error("HOUSEHOLD_MISMATCH: prior premium provenance");
            if (identity[3] === p.planId) throw new Error("DUPLICATE_PREMIUM: existing plan/month obligation");
            const shared = p.memberIds.filter(member => identity[7].includes(member));
            if (shared.some(member => !p.coordinationEvidence.some(e => e.memberId === member && e.coverageIds.includes(String(identity[2])))))
              throw new Error("OVERLAP_COORDINATION_REQUIRED: existing premium needs explicit shared-member coordination");
          }
          const proofs = input.representations.filter(r => r.operationId === p.operationId && r.streamId === other.id);
          const proof = proofs[0];
          if (proofs.length !== 1 || !proof || proof.quoteId !== p.quoteId || !qualified(proof.evidence, input.asOf, start, end)
            || !other.sourceTraceRefs?.some(r => r.traceId === proof.streamSourceTraceId)
            || !nonempty(proof.streamSourceTraceId)) throw new Error("REPRESENTATION_PROOF_REQUIRED: source-linked equivalence or distinct-obligation evidence for overlapping generic streams");
          if (proof.relationship === "distinct_obligation") {
            if (proof.evidence.ruleSnapshotId !== proof.streamSourceTraceId
              || proof.streamSourceTraceId === p.source.ruleSnapshotId || proof.streamSourceTraceId === trace
              || other.sourceTraceRefs?.some(r => r.traceId === p.quoteId || r.traceId === p.source.ruleSnapshotId))
              throw new Error("DUPLICATE_PREMIUM: distinct obligation needs its own source, not a renamed premium quote");
          } else {
            if (!("paymentAccountId" in other) || proof.streamSourceTraceId !== p.source.ruleSnapshotId
              || !same({ ...other, id: stream.id, primitiveIds: stream.primitiveIds, sourceTraceRefs: stream.sourceTraceRefs,
                fundingPolicy: stream.fundingPolicy }, stream)
              || !same(other.fundingPolicy.orderedSources, stream.fundingPolicy.orderedSources)
              || other.fundingPolicy.allowPartial || other.fundingPolicy.insufficientFundsBehavior !== "unfunded")
              throw new Error("EQUIVALENCE_MISMATCH: complete bounded expense amount, dates, bank, payable and funding semantics must match");
            equivalent.add(other.id);
          }
        }
        candidate = candidate.filter(s => !equivalent.has(s.id));
        const occupied = identityStrings({ ...kernel.executable, cashFlowInput: { ...cash, expenses: candidate } });
        if (ids.some(id => occupied.has(id))) throw new Error("IDENTITY_COLLISION: identity already used by the compiled household");
        candidate.push(stream);
        accepted.push(p.operationId);
      }
      expenses = candidate;
      participants.push(...guards);
      admitted.push(...accepted);
    } catch (error) {
      diagnose(coverage.id, "AFTERTAX_PREMIUM_NOT_ADMITTED", error instanceof Error ? error.message : "source qualification failed");
    }
  }
  for (const b of input.confirmed) if (!quoted.proposals.some(p => p.operationId === b.proposal.operationId))
    diagnose(b.proposal.coverageId, "STALE_PREMIUM_CONFIRMATION", "confirmation must belong to the current effective request");
  if (admitted.length === 0) return result(kernel, quoted.diagnostics);
  expenses.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (same(expenses, cash.expenses) && participants.length === (kernel.executable.participants ?? []).length) return result(kernel, quoted.diagnostics);
  return result(applyHouseholdExecutionOverlay(kernel, { cashFlowInput: { ...cash, expenses }, participants }), quoted.diagnostics);
}
