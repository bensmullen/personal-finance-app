import { ValidationError } from "../../../../diagnostics/index.js";
import { createFundingPolicy, fundingPolicyId } from "../../../../funding/index.js";
import { domainId } from "../../../../identity/index.js";
import { calculationTraceId, calculationTraceRef } from "../../../../lineage/index.js";
import { civilDate, instant, type CivilDate } from "../../../../time/index.js";
import { Money, Rate, USD, rateConvention } from "../../../../values/index.js";
import { applyHouseholdExecutionOverlay, type CompiledHouseholdKernel, type HouseholdKernelParticipant } from "../../../householdExecution.js";
import { immutableConfiguration } from "../../../r3/compiledHousehold.js";
import { registerHouseholdParticipantCodec } from "../../../r3/participantCodec.js";
import { canonicalSerialize } from "../../../run.js";
import { taxDiagnostic, taxOutputCapabilities } from "../../../tax/contracts.js";
import type { RecurringExpenseStream } from "../../../verticalSlice2.js";
import { composeMedicareObligations, type MedicareCoordinationRequest, type MedicareObligation } from "../../health/medicare/coordination/index.js";
import type { EffectivePeriod, PremiumSource } from "../../health/premiums/index.js";
import type { PremiumRepresentation } from "../aftertaxPremiums/index.js";
import type { SsaMedicareInput } from "../ssaMedicare/index.js";

/** Confirmation is not posting authority: the raw C1/C2 request is re-derived. */
export interface ConfirmedMedicareBankPremium {
  readonly obligation: MedicareObligation;
  readonly expenseId: RecurringExpenseStream["id"];
  readonly primitiveIds: RecurringExpenseStream["primitiveIds"];
  readonly settlementPriority: number;
  readonly bank: { readonly accountId: RecurringExpenseStream["paymentAccountId"];
    readonly householdId: string; readonly payerId: string; readonly classification: "BANK"; readonly evidence: PremiumSource };
  readonly payable: { readonly liabilityId: RecurringExpenseStream["payableLiabilityId"];
    readonly householdId: string; readonly payerId: string; readonly coverageId: string;
    readonly personId: string; readonly part: "part_b" | "part_d"; readonly recipientId: string;
    readonly quoteId: string; readonly period: EffectivePeriod; readonly evidence: PremiumSource };
}
interface SourceBinding {
  readonly request: MedicareCoordinationRequest;
  readonly asOf: CivilDate;
  readonly confirmed: readonly ConfirmedMedicareBankPremium[];
}
export interface MedicareBankInput extends SourceBinding {
  readonly kernel: CompiledHouseholdKernel;
  readonly representations: readonly PremiumRepresentation[];
}
const at = (s: string) => instant(`${s}T00:00:00.000Z`);
const same = (a: unknown, b: unknown) => canonicalSerialize(a) === canonicalSerialize(b);
const text = (s: string) => typeof s === "string" && s.trim().length > 0;
const prefix = "d2:medicare-bank-key:";
const bindingPrefix = "d2:medicare-bank-binding:";
const participantPrefix = "d2_medicare_bank:";
const exact = (m: Money) => m instanceof Money && m.currency.equals(USD) && m.amount.fitsScale(2) && !m.isNegative();
function fail(code: string, message: string): never {
  throw new ValidationError({ severity: "error", code, message, entityType: "medicare_bank" });
}
// Domain input collections are sets of source facts, never execution priority.
const ordered = <T>(value: T): T => {
  if (value === null || typeof value !== "object" || value instanceof Money) return value;
  if (Array.isArray(value)) return value.map(v => ordered(v)).sort((a, b) => canonicalSerialize(a).localeCompare(canonicalSerialize(b))) as T;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, ordered(v)])) as T;
};
const knownBy = (value: unknown, date: string): boolean => {
  if (value === null || typeof value !== "object" || value instanceof Money) return true;
  return Object.entries(value).every(([key, v]) => key === "asOf" && typeof v === "string"
    ? v <= date.slice(0, 10) : knownBy(v, date));
};
const qualified = (s: PremiumSource, cutoff: CivilDate, period: EffectivePeriod) => {
  civilDate(s.start); civilDate(s.endExclusive); civilDate(s.asOf);
  return s.projectionStatus === "verified" && s.jurisdiction === "US" && s.asOf <= cutoff
    && s.start <= period.start && s.endExclusive >= period.endExclusive
    && [s.ruleSnapshotId, s.ruleFamily, s.sourcePublication, s.version].every(text);
};
const identities = (v: unknown, found = new Set<string>()): Set<string> => {
  if (typeof v === "string") found.add(v);
  else if (v !== null && typeof v === "object") for (const x of Object.values(v)) identities(x, found);
  return found;
};

function qualify(binding: SourceBinding) {
  civilDate(binding.asOf);
  const result = composeMedicareObligations(binding.request);
  if (result.medicareTotalCoverage !== "complete" || result.diagnostics.length)
    fail("MEDICARE_SOURCE_INCOMPLETE", "Complete event-known C1/C2 inventory, base quote, CMS lookback and IRMAA required");
  if (!knownBy(binding.request, binding.asOf)) fail("MEDICARE_SOURCE_AFTER_CUTOFF", "All supplied sources must be known by run asOf");
  const positive = result.obligations.filter(o => o.memberObligation.isPositive());
  if (result.obligations.some(o => o.intendedRoute.kind !== "aftertax_bank"
    || (!["part_b", "part_d"].includes(o.part) && !(o.part === "part_a" && o.memberObligation.isZero())))
    || positive.length !== binding.confirmed.length
    || new Set(binding.confirmed.map(b => b.obligation.claimId)).size !== binding.confirmed.length)
    fail("MEDICARE_BANK_ROUTE_REQUIRED", "Exclusive BANK B/D and sourced-zero A only; exact positive confirmation set required");
  for (const o of positive) {
    const b = binding.confirmed.find(c => c.obligation.claimId === o.claimId);
    if (!b || !same(ordered(b.obligation), ordered(o))) fail("MEDICARE_CONFIRMATION_MISMATCH", "Exact regenerated member/Part/month/base/IRMAA confirmation required");
    if (![o.memberBase, o.surcharge, o.memberObligation].every(exact)
      || !o.memberBase.plus(o.surcharge).equals(o.memberObligation)) fail("MEDICARE_CENTS_REQUIRED", "Exact USD member base plus Part-specific monthly IRMAA once");
    const p = b.payable, bank = b.bank;
    if (o.intendedRoute.kind !== "aftertax_bank" || bank.classification !== "BANK"
      || bank.accountId !== o.intendedRoute.sourceAccountId || bank.householdId !== o.householdId || bank.payerId !== o.payerId
      || p.householdId !== o.householdId || p.payerId !== o.payerId || p.personId !== o.personId
      || p.part !== o.part || p.coverageId !== o.coverageId || p.recipientId !== o.recipientId
      || p.quoteId !== o.quoteId || !same(p.period, o.period)
      || ![bank.evidence, p.evidence].every(s => qualified(s, o.effectiveAt < binding.asOf ? o.effectiveAt : binding.asOf, o.period)))
      fail("MEDICARE_BANK_PAYABLE_MISMATCH", "Event-known owned BANK and exact member/Part/provider/quote/month payable evidence required");
    if (!Number.isSafeInteger(b.settlementPriority) || b.settlementPriority < 0)
      fail("MEDICARE_PRIORITY_REQUIRED", "Explicit nonnegative VS2 settlement priority required");
    const ids = [domainId("expense", b.expenseId), ...Object.values(b.primitiveIds).map(id => domainId("primitive-instance", id))];
    if (ids.length !== 4 || new Set(ids).size !== 4
      || !Object.keys(b.primitiveIds).every(k => ["indexGrowth", "inflationLink", "recurrence"].includes(k)))
      fail("MEDICARE_IDENTITY_COLLISION", "Distinct expense and three primitive identities required");
    if (binding.confirmed.some(c => c !== b && c.bank.accountId === bank.accountId
      && c.obligation.effectiveAt === o.effectiveAt && c.settlementPriority === b.settlementPriority))
      fail("MEDICARE_PRIORITY_REQUIRED", "Same BANK/date Parts need distinct authored priorities");
  }
  return result;
}

function streamFor(b: ConfirmedMedicareBankPremium): RecurringExpenseStream {
  const o = b.obligation, trace = `${bindingPrefix}${canonicalSerialize(b)}`;
  return {
    id: b.expenseId, ownerId: domainId("person", o.personId), paymentAccountId: b.bank.accountId,
    payableLiabilityId: b.payable.liabilityId, baseMonthlyAmount: o.memberObligation,
    start: at(o.period.start), end: at(o.period.endExclusive),
    recurrence: { kind: "utc_monthly", anchor: at(o.effectiveAt), invalidDayPolicy: "skip" },
    inflationRate: Rate.fromDecimal("0", rateConvention.effectiveAnnual()), inflationBaseAt: at(o.effectiveAt),
    fundingPolicy: createFundingPolicy({ id: fundingPolicyId(trace), orderedSources: [{ kind: "cash_account", accountId: b.bank.accountId }],
      allowPartial: false, insufficientFundsBehavior: "unfunded" }),
    primitiveIds: { ...b.primitiveIds }, settlementPriority: b.settlementPriority,
    sourceTraceRefs: [...new Set([`${prefix}${o.claimId}`, trace, ...o.traceRefs, o.claimId,
      b.bank.evidence.ruleSnapshotId, b.payable.evidence.ruleSnapshotId])].sort().map(s => calculationTraceRef(calculationTraceId(s))),
  };
}

/** Source/order guard only. Financial execution stays in unchanged VS2. */
function sourceGuard(configuration: SourceBinding): HouseholdKernelParticipant {
  const binding = immutableConfiguration(ordered(configuration)), rows = qualify(binding).obligations;
  const id = `${participantPrefix}${canonicalSerialize(rows.map(o => o.claimId).sort())}`;
  const taxDiagnostics = [taxDiagnostic("medicare_bank_tax_characterization", "Medicare BANK payments are recorded; medical deductibility and projected tax remain unsupported.")];
  const inspect = (descriptor: Parameters<NonNullable<HouseholdKernelParticipant["observe"]>>[0]) => {
    // The SSA adapter's published operation identity contains the source-owned
    // recipient installment key. Observe it even when attached after this guard,
    // on another payment day/account, or under renamed coverage/quote IDs.
    if (descriptor.operationClass === "cash_flow:ssa_medicare") {
      let identity: unknown;
      try { identity = JSON.parse(descriptor.id.slice("ssa-medicare:".length)); } catch { /* Unknown source identity fails below. */ }
      if (!Array.isArray(identity) || identity[0] !== "d2-quoted-benefit/v1")
        fail("MEDICARE_DOUBLE_ROUTE", "SSA Medicare work requires an inspectable source-owned recipient identity");
      const installment = identity;
      if (rows.some(o => o.personId === installment[3] && o.householdId === installment[1]
        && descriptor.sequencingInstant >= at(o.period.start) && descriptor.sequencingInstant < at(o.period.endExclusive)))
        fail("MEDICARE_DOUBLE_ROUTE", "A source-bound BANK Medicare month cannot concurrently execute an SSA Medicare participant");
    }
    for (const b of binding.confirmed) {
      if (descriptor.sequencingInstant !== at(b.obligation.effectiveAt)
        || !descriptor.resourceAccesses.some(a => a.accountId === b.bank.accountId)) continue;
      const isPart = binding.confirmed.some(c => descriptor.id.startsWith(`cash-expense:${c.expenseId}:`));
      // A VS2 expense priority cannot manufacture order against another source.
      if (!isPart) fail("HOUSEHOLD_CONTENTION_UNRESOLVED", "Medicare and unrelated same-instant BANK work need proven source ordering");
    }
  };
  return Object.freeze({ id, version: "medicare-bank/v1", portableCodec: "d2-medicare-bank/v1", economicInputs: binding,
    prepare: (context, period, opening, work = []) => {
      if (!rows.some(o => at(o.period.start) < period.end && at(o.period.endExclusive) > period.start)) return { id, operations: [] };
      qualify(binding);
      if (!context.baseCurrency.equals(USD) || !knownBy(binding, context.dataCutoff))
        fail("MEDICARE_SOURCE_AFTER_CUTOFF", "Source-bound Medicare execution requires USD and event/run-known sources");
      for (const b of binding.confirmed.filter(b => at(b.obligation.effectiveAt) >= period.start && at(b.obligation.effectiveAt) < period.end)) {
        const account = opening.state.accounts[b.bank.accountId];
        if (opening.state.obligations[b.obligation.claimId]) fail("MEDICARE_DOUBLE_ROUTE", "An existing SSA premium claim already owns this member/Part/month");
        if (!account || account.ownerId !== b.obligation.payerId || !["checking", "savings"].includes(account.kind) || !exact(account.cash)
          || !opening.state.liabilities[b.payable.liabilityId]
          || work.filter(w => w.id.startsWith(`cash-expense:${b.expenseId}:`) && w.sequencingInstant === at(b.obligation.effectiveAt)
            && w.primitiveInstanceId === b.primitiveIds.recurrence && w.resourceAccesses.length === 1
            && w.resourceAccesses[0]!.accountId === b.bank.accountId && w.resourceAccesses[0]!.mode === "consume").length !== 1)
          fail("MEDICARE_EXECUTION_BINDING_MISMATCH", "Original owned BANK, payable and exactly one bound VS2 occurrence required");
      }
      for (const descriptor of work) inspect(descriptor);
      return { id, operations: [{ descriptor: { id: `${id}:tax:${period.start}`, domain: "cash_flow", operationClass: "cash_flow:medicare_bank_coverage",
        sequencingInstant: period.start, dependsOn: [], resourceAccesses: [], traceRefs: [] },
        execute: candidate => ({ ...candidate, facts: { taxDiagnostics, outputCapabilities: taxOutputCapabilities(taxDiagnostics) } }) }] };
    },
    observe: (descriptor, facts, runtime) => {
      inspect(descriptor);
      const b = binding.confirmed.find(c => descriptor.id.startsWith(`cash-expense:${c.expenseId}:`));
      if (b) {
        const cash = facts.cash ?? facts.summary?.cash;
        if (!cash || !cash.recurringExpenseRecognized.equals(b.obligation.memberObligation)
          || !(cash.expenseCashSettlement.isZero() || cash.expenseCashSettlement.equals(b.obligation.memberObligation)))
          fail("MEDICARE_EXECUTION_BINDING_MISMATCH", "Executed expense and all-or-none payment must match source-confirmed Medicare amount");
      }
      return runtime;
    },
  } satisfies HouseholdKernelParticipant);
}
registerHouseholdParticipantCodec({ codec: "d2-medicare-bank/v1", restore: value => sourceGuard(value as SourceBinding) });

/** Atomic admission: a rejected request returns the original immutable kernel. */
export function attachMedicareBank(input: MedicareBankInput) {
  const { kernel } = input;
  const diagnostics: { diagnosticCode: string; sourceEntityPath: string; period: EffectivePeriod;
    affectedOutput: "net_cash"; coverage: "incomplete"; missingFacts: readonly string[]; ruleSnapshotId: string | null; traceRefs: readonly string[] }[] = [];
  try {
    const binding = ordered({ request: input.request, asOf: input.asOf, confirmed: input.confirmed });
    const composed = qualify(binding), cash = kernel.cash?.input;
    if (!cash || !cash.baseCurrency.equals(USD) || cash.householdId !== input.request.premiums.householdId
      || at(input.request.premiums.period.start) < kernel.horizon.start
      || at(input.request.premiums.period.endExclusive) > kernel.horizon.periods.at(-1)!.end)
      fail("MEDICARE_KERNEL_REQUIRED", "Matching existing USD VS2 household and full-month request inside compiled horizon required");
    const guard = sourceGuard(binding), participants = kernel.executable.participants ?? [];
    const prior = participants.find(p => p.id === guard.id);
    if (prior && !same(prior.economicInputs, guard.economicInputs))
      fail("MEDICARE_CHANGED_BINDING", "Attached raw sources, identities and route cannot change");
    const admittedMedicareKeys = new Set<string>();
    for (const existing of participants.filter(p => p.id.startsWith(participantPrefix))) {
      const old = existing.economicInputs as SourceBinding;
      const verified = qualify(old);
      if (existing.id !== `${participantPrefix}${canonicalSerialize(verified.obligations.map(o => o.claimId).sort())}`
        || old.confirmed.some(b => !verified.obligations.some(o =>
          o.claimId === b.obligation.claimId && same(ordered(o), ordered(b.obligation)))))
        fail("MEDICARE_CHANGED_BINDING", "Previously attached Medicare proof must requalify to its original source-bound identity");
      for (const premium of old.confirmed) {
        if (existing !== prior && composed.obligations.some(o => o.claimId === premium.obligation.claimId))
          fail("MEDICARE_CHANGED_BINDING", "Overlapping source-bound Medicare requests must reattach their original exact binding");
        admittedMedicareKeys.add(`${prefix}${premium.obligation.claimId}`);
      }
    }
    for (const participant of participants.filter(p => p.id === "d2_ssa_medicare")) {
      const ssa = participant.economicInputs as SsaMedicareInput;
      if (ssa.payments.some(p => composeMedicareObligations(p.c2).obligations.some(o => composed.obligations.some(c => c.claimId === o.claimId))))
        fail("MEDICARE_DOUBLE_ROUTE", "Existing SSA participant already owns this member/Part/month");
    }
    const opening = kernel.executable.reconciledOpeningState;
    let candidate = [...cash.expenses];
    const streams = binding.confirmed.map(streamFor);
    for (const b of binding.confirmed) {
      const o = b.obligation, account = opening.accounts[b.bank.accountId], liability = opening.liabilities[b.payable.liabilityId];
      if (!account || account.id !== b.bank.accountId || account.ownerId !== o.payerId
        || !["checking", "savings"].includes(account.kind) || !exact(account.cash)
        || !liability || liability.id !== b.payable.liabilityId || !exact(liability.balance))
        fail("MEDICARE_BANK_PAYABLE_REQUIRED", "Existing owned checking/savings and exact USD payable required");
      if (Object.values(opening.obligations).some(c => c.id === o.claimId
        || (c.recognizedAt >= at(o.period.start) && c.recognizedAt < at(o.period.endExclusive)
          && (c.balanceEntityId === b.payable.liabilityId || c.traceRefs?.some(t => [o.claimId, o.quoteId, `${prefix}${o.claimId}`].includes(t.traceId))))))
        fail("MEDICARE_ALREADY_RECOGNIZED", "Existing committed claim/receipt cannot authorize another recognition");
      const stream = streamFor(b), existing = candidate.find(s => s.id === stream.id);
      if (existing && same(existing, stream)) candidate = candidate.filter(s => s.id !== stream.id);
      else if (existing) fail("MEDICARE_CHANGED_BINDING", "Expense identity already has different facts");
      const equivalent = new Set<string>();
      for (const other of [...cash.incomes, ...candidate]) {
        if (other.start >= at(o.period.endExclusive) || (other.end ?? kernel.horizon.periods.at(-1)!.end) <= at(o.period.start)) continue;
        if (streams.some(s => same(s, other))) continue;
        const refs = other.sourceTraceRefs?.map(r => r.traceId) ?? [];
        if (refs.includes(calculationTraceId(`${prefix}${o.claimId}`))) fail("MEDICARE_DUPLICATE_PART", "Renamed plan/provider/quote cannot duplicate member/Part/month");
        // A previously admitted C2 stream has a source-owned, stable
        // household/member/Part/month claim marker. Distinct markers cannot
        // be the same premium, including a different member at the same date.
        // A different or renamed plan for the SAME key was rejected above.
        const distinctMedicareKeys = refs.filter(ref => ref.startsWith(prefix));
        if (distinctMedicareKeys.length === 1 && admittedMedicareKeys.has(distinctMedicareKeys[0]!)) continue;
        if (distinctMedicareKeys.length > 0)
          fail("MEDICARE_DUPLICATE_PART", "Unknown or conflicting Medicare source marker cannot bypass duplicate recognition checks");
        if (!("paymentAccountId" in other) && !refs.some(r => [o.coverageId, o.quoteId, o.base.source.ruleSnapshotId].includes(r))) continue;
        const proofs = input.representations.filter(r => r.operationId === o.operationId && r.streamId === other.id), proof = proofs[0];
        if (proofs.length !== 1 || !proof || proof.quoteId !== o.quoteId || !refs.includes(calculationTraceId(proof.streamSourceTraceId))
          || !qualified(proof.evidence, o.effectiveAt < input.asOf ? o.effectiveAt : input.asOf, o.period))
          fail("MEDICARE_REPRESENTATION_REQUIRED", "Every overlapping generic expense needs source-linked equivalence or distinct-obligation proof");
        if (proof.relationship === "distinct_obligation") {
          if (proof.evidence.ruleSnapshotId !== proof.streamSourceTraceId
            || refs.some(r => [o.coverageId, o.quoteId, o.base.source.ruleSnapshotId].includes(r) || r.startsWith(bindingPrefix)))
            fail("MEDICARE_DUPLICATE_PART", "Distinct obligation needs independent source lineage");
        } else if (proof.relationship === "equivalent_expense") {
          if (!("paymentAccountId" in other) || proof.streamSourceTraceId !== o.base.source.ruleSnapshotId
            || !same(proof.evidence, o.base.source)
            || !same({ ...other, id: stream.id, primitiveIds: stream.primitiveIds, sourceTraceRefs: stream.sourceTraceRefs,
              fundingPolicy: stream.fundingPolicy }, stream)
            || !same(other.fundingPolicy.orderedSources, stream.fundingPolicy.orderedSources)
            || other.fundingPolicy.allowPartial || other.fundingPolicy.insufficientFundsBehavior !== "unfunded")
            fail("MEDICARE_EQUIVALENCE_MISMATCH", "Full bounded recurrence/amount/owner/BANK/payable/priority/funding semantics must match");
          equivalent.add(other.id);
        } else fail("MEDICARE_REPRESENTATION_REQUIRED", "Known explicit representation relationship required");
      }
      if (equivalent.size > 1) fail("MEDICARE_DUPLICATE_PART", "Multiple generic equivalents are ambiguous duplicate statements");
      candidate = candidate.filter(s => !equivalent.has(s.id));
      const occupied = identities({ ...kernel.executable, participants: [], cashFlowInput: { ...cash, expenses: candidate } });
      if ([b.expenseId, ...Object.values(b.primitiveIds)].some(id => occupied.has(id)))
        fail("MEDICARE_IDENTITY_COLLISION", "Expense/primitive identity already belongs to another operation");
      candidate.push(stream);
    }
    candidate.sort((a, b) => a.id.localeCompare(b.id));
    const next = same(candidate, cash.expenses) && prior ? kernel : applyHouseholdExecutionOverlay(kernel, {
      cashFlowInput: { ...cash, expenses: candidate }, participants: prior ? participants : [...participants, guard].sort((a, b) => a.id.localeCompare(b.id)),
    });
    return Object.freeze({ kernel: next, admittedOperationIds: Object.freeze(binding.confirmed.map(b => b.obligation.operationId)),
      diagnostics: Object.freeze(diagnostics), netCashCoverage: "complete" as const, taxEffectsCoverage: "incomplete" as const });
  } catch (error) {
    diagnostics.push({ diagnosticCode: error instanceof ValidationError ? error.issues[0]!.code : "MEDICARE_BANK_NOT_ADMITTED", sourceEntityPath: "medicareBank",
      period: input.request.premiums.period, affectedOutput: "net_cash", coverage: "incomplete",
      missingFacts: [error instanceof Error ? error.message : "Valid complete source-owned Medicare request required"],
      ruleSnapshotId: input.request.premiums.coverages[0]?.quote?.source?.ruleSnapshotId ?? null,
      traceRefs: input.request.premiums.coverages.map(c => c.id) });
    return Object.freeze({ kernel, admittedOperationIds: Object.freeze([] as string[]), diagnostics: Object.freeze(diagnostics),
      netCashCoverage: "incomplete" as const, taxEffectsCoverage: "incomplete" as const });
  }
}
