import { accountingTransactionId, createAccountingLeg, createAccountingTransaction } from "../../../../accounting/index.js";
import { ValidationError } from "../../../../diagnostics/index.js";
import { idempotencyKey } from "../../../../identity/index.js";
import { calculationTraceId, calculationTraceRef } from "../../../../lineage/index.js";
import { applyAccountingTransactionAtomically, applyRetirementDistributionAtomically, registerAuthoritativeIdentity } from "../../../../state/index.js";
import { civilDate, instant, type Period } from "../../../../time/index.js";
import { Money, USD } from "../../../../values/index.js";
import { applyHouseholdExecutionOverlay, type CompiledHouseholdKernel, type HouseholdKernelParticipant } from "../../../householdExecution.js";
import { immutableConfiguration } from "../../../r3/compiledHousehold.js";
import { registerHouseholdParticipantCodec } from "../../../r3/participantCodec.js";
import { SummaryOperationSink } from "../../../r3/summarySink.js";
import { canonicalSerialize, type RunContext } from "../../../run.js";
import { evaluateWithdrawals, type WithdrawalInput, type WithdrawalSource } from "../../retirement/withdrawals/index.js";
import { evaluateWithdrawalRmd, type AuthorizationBundle, type WithdrawalRmdInput } from "../../retirement/withdrawalRmd/index.js";
import { readRetirementRawSource, qualifyRetirementRawSource, qualifyRetirementPriorHistory, type RetirementSourceReference } from "./source.js";
import { evaluateFundedRmdSatisfaction } from "./satisfaction.js";
export { registerRetirementRawSourcePort, type RetirementRawSourcePort, type RetirementRawSource } from "./source.js";
export { evaluateFundedRmdSatisfaction } from "./satisfaction.js";

/** Independent event confirmations, never balances maintained by this adapter. */
export interface RetirementCashConfirmation {
  readonly operationId: string;
  readonly runId: RunContext["runId"];
  readonly period: Period;
  readonly sourceCashBefore: Money;
  readonly bankCashBefore: Money;
  readonly source: WithdrawalSource;
  readonly bankSource: WithdrawalSource;
  readonly reservations: readonly { readonly id: string; readonly amount: Money; readonly source: WithdrawalSource }[];
  readonly ordering: { readonly after: readonly string[]; readonly source: WithdrawalSource };
}
export interface RetirementCashInput {
  readonly withdrawals: WithdrawalInput;
  readonly members: readonly { readonly personId: string; readonly source: WithdrawalSource }[];
  readonly confirmations: readonly RetirementCashConfirmation[];
  readonly rmd?: { readonly input: WithdrawalRmdInput; readonly bundle: AuthorizationBundle };
  readonly fundedRmd?: RetirementSourceReference & { readonly horizon: Period };
}
export interface RetirementCashDiagnostic {
  readonly seam: "S7";
  readonly sourceEntityPath: string;
  readonly affectedOutput: "retirement_tax" | "rmd_satisfaction";
  readonly coverage: "incomplete";
  readonly diagnosticCode: "RETIREMENT_TAX_INCOMPLETE" | "RETIREMENT_RMD_HISTORY_UNAVAILABLE";
  readonly missingFacts: readonly string[];
}
const participantId = "d2_retirement_cash";
const same = (a: unknown, b: unknown): boolean => canonicalSerialize(a) === canonicalSerialize(b);
const ordered = <T>(values: readonly T[]): readonly T[] => [...values].sort((a, b) => {
  const left = canonicalSerialize(a), right = canonicalSerialize(b);
  return left < right ? -1 : left > right ? 1 : 0;
});
/** Unordered evidence is canonicalized for identity, never used as priority. */
function snapshot(configuration: RetirementCashInput): RetirementCashInput {
  const raw = configuration.withdrawals;
  return immutableConfiguration({ ...configuration, withdrawals: { ...raw, cash: ordered(raw.cash),
    usage: { ...raw.usage, operationIds: ordered(raw.usage.operationIds), withdrawalIds: ordered(raw.usage.withdrawalIds),
      authorizationIds: ordered(raw.usage.authorizationIds) },
    requests: ordered(raw.requests.map(r => ({ ...r, targetObligationIds: ordered(r.targetObligationIds),
      ...(r.withholding ? { withholding: { ...r.withholding, instructions: ordered(r.withholding.instructions) } } : {}) }))) },
    members: ordered(configuration.members), confirmations: ordered(configuration.confirmations.map(q => ({ ...q,
      reservations: ordered(q.reservations), ordering: { ...q.ordering, after: ordered(q.ordering.after) } }))) });
}
const at = (date: string) => instant(`${date}T00:00:00.000Z`);
const exact = (m: Money): boolean => m instanceof Money && m.currency.equals(USD) && m.amount.fitsScale(2) && !m.isNegative();
const unique = (ids: readonly string[]): boolean => ids.every(id => id.trim().length > 0) && new Set(ids).size === ids.length;
function fail(code: string, message: string): never {
  throw new ValidationError({ severity: "error", code, message, entityType: "retirement_cash" });
}
const outputCapabilities = immutableConfiguration({
  retirementCashTransfer: { dependency: "tax_independent" as const, status: "complete" as const, diagnostics: [] },
  ...Object.fromEntries(["retirementTax", "rmdSatisfaction", "cash", "netWorth"].map(field =>
    [field, { dependency: "tax_affected" as const, status: "incomplete" as const, diagnostics: [] }])),
});
const coverageFacts = () => ({ outputCapabilities, diagnostics: [{ severity: "warning" as const,
  code: "RETIREMENT_TAX_INCOMPLETE", entityType: "retirement_cash",
  message: "Pretax cash transfer only; distribution tax characterization remains incomplete." },
  { severity: "warning" as const, code: "RETIREMENT_RMD_HISTORY_UNAVAILABLE", entityType: "retirement_cash",
    message: "S7: Conditional allocations and unsupported history cannot authenticate funded RMD satisfaction; no allocation is applied." }] });

// Do not latch a period-local shortfall into the monotonic aggregate capability.
// Only the full-horizon closing operation publishes funded RMD coverage.
const fundedCoverageFacts = () => ({ outputCapabilities: Object.fromEntries(Object.entries(outputCapabilities)
  .filter(([key]) => key !== "rmdSatisfaction")), diagnostics: [coverageFacts().diagnostics[0]!] });

function stamp(s: WithdrawalSource, householdId: string, personId: string, resourceId: string, date: string, context: RunContext): void {
  try { [s.publishedAt, s.asOf, s.effectiveFrom, s.endExclusive].forEach(civilDate); }
  catch { fail("RETIREMENT_SOURCE_UNAVAILABLE", "Valid source dates required"); }
  if (![s.id, s.ruleSnapshotId, s.jurisdiction, s.ruleFamily, s.sourcePublication, s.version].every(v => v.trim().length > 0)
    || s.projectionStatus !== "verified" || s.householdId !== householdId || s.personId !== personId || s.resourceId !== resourceId
    || s.publishedAt > s.asOf || s.asOf > date || s.asOf > context.dataCutoff.slice(0, 10)
    || s.effectiveFrom > date || date >= s.endExclusive)
    fail("RETIREMENT_SOURCE_UNAVAILABLE", "Verified source scope, event range and run cutoff required");
}

/** Opt-in physical CASH only. A4 remains the sole withdrawal admission evaluator. */
export function createRetirementCashParticipant(configuration: RetirementCashInput): HouseholdKernelParticipant {
  const input = snapshot(configuration);
  return Object.freeze({ id: participantId, version: input.fundedRmd ? "funded-account-rmd/v1" : "cash-zero-withholding/v1", portableCodec: "d2-retirement-cash/v1", economicInputs: input,
    prepare: (context, period, opening, work = [], tier = "detail") => {
      const raw = input.withdrawals;
      const reference = input.fundedRmd;
      const published = reference && readRetirementRawSource(reference, context);
      const hasNewPosting = raw.requests.some(r => at(r.effectiveAt) >= period.start && at(r.effectiveAt) < period.end
        && !opening.state.identities.postedTransactionIds.includes(accountingTransactionId(r.operationId)));
      if (reference && !published && hasNewPosting)
        fail("RETIREMENT_SOURCE_UNAVAILABLE", "New RMD posting requires the independent raw publisher");
      if (hasNewPosting && published?.binding.rmd.requests.some(r => r.aggregation || r.accounts.length !== 1))
        fail("RETIREMENT_RMD_UNSUPPORTED_GROUP_JOURNAL", "incomplete/unsupported_group_journal: account-scoped J1 journal required");
      if (published && hasNewPosting) {
        const { fundedRmd: _funded, rmd: _rmd, ...cash } = input;
        const { fundedRmd: _sourceFunded, rmd: _sourceRmd, ...sourceCash } = snapshot(published.cash);
        if (!same(cash, sourceCash)) fail("RETIREMENT_SOURCE_CHANGED", "Participant inputs must match the independently published cash plan");
      }
      const evaluation = evaluateWithdrawals(raw);
      if (evaluation.coverage !== "complete")
        fail("RETIREMENT_AUTHORIZATION_INCOMPLETE", `S7: ${evaluation.diagnostics.map(d => `${d.diagnosticCode}:${d.missingFacts.join(",")}`).join(";")}`);
      if (raw.knownAt > context.dataCutoff.slice(0, 10) || !context.baseCurrency.equals(USD))
        fail("RETIREMENT_SOURCE_UNAVAILABLE", "Raw authorization must be known by the run cutoff in USD");
      // RMD evidence never authorizes cash or invalidates independently sourced
      // cash settlement. The attachment reports its conditional status.
      if (!unique(input.members.map(m => m.personId)) || !unique(input.confirmations.map(c => c.operationId))
        || input.confirmations.length !== raw.requests.length
        || input.confirmations.some(c => !raw.requests.some(r => r.operationId === c.operationId))
        || !unique(raw.usage.operationIds) || !unique(raw.usage.withdrawalIds) || !unique(raw.usage.authorizationIds))
        fail("RETIREMENT_IDENTITY_INVALID", "Unique members, exact confirmations and independent usage identities required");
      const sources = new Map<string, string>();
      const visit = (value: unknown): void => {
        if (!value || typeof value !== "object" || value instanceof Money) return;
        if ("projectionStatus" in value && "id" in value && typeof value.id === "string") {
          const encoded = canonicalSerialize(value);
          if (sources.has(value.id) && sources.get(value.id) !== encoded)
            fail("RETIREMENT_SOURCE_CHANGED", "One source identity cannot describe conflicting facts");
          sources.set(value.id, encoded);
        }
        Object.values(value).forEach(visit);
      };
      visit({ withdrawals: raw, members: input.members, confirmations: input.confirmations });
      const operations: ReturnType<HouseholdKernelParticipant["prepare"]>["operations"][number][] = [];
      if (raw.requests.some(r => at(r.effectiveAt) < period.end)) operations.push({
        descriptor: { id: `d2:retirement-coverage:${period.start}`, domain: "retirement", operationClass: "retirement:coverage",
          sequencingInstant: period.start, dependsOn: [], resourceAccesses: [], traceRefs: [] },
        execute: candidate => ({ ...candidate, facts: reference ? fundedCoverageFacts() : coverageFacts() }),
      });
      const active = evaluation.candidates.filter(c => at(c.effectiveAt) >= period.start && at(c.effectiveAt) < period.end);
      const postedIds = new Set(active.filter(c => opening.state.identities.postedTransactionIds.includes(accountingTransactionId(c.operationId))).map(c => c.operationId));
      const reaches = (from: string, target: string, seen = new Set<string>()): boolean => {
        if (seen.has(from)) return false;
        seen.add(from);
        const prior = input.confirmations.find(q => q.operationId === from)?.ordering.after ?? [];
        return prior.includes(target) || prior.some(id => reaches(id, target, seen));
      };
      for (const c of active) {
        const r = raw.requests.find(r => r.operationId === c.operationId)!;
        const q = input.confirmations.find(q => q.operationId === c.operationId)!;
        const a = raw.cash.find(a => a.accountId === c.sourceAccountId)!;
        const member = input.members.find(m => m.personId === c.actorId);
        if (!member) fail("RETIREMENT_IDENTITY_INVALID", "Distribution owner must be a sourced household member");
        stamp(member.source, raw.householdId, c.actorId, c.actorId, c.effectiveAt, context);
        stamp(q.source, raw.householdId, c.actorId, c.sourceAccountId, c.effectiveAt, context);
        stamp(q.bankSource, raw.householdId, c.actorId, c.destinationAccountId, c.effectiveAt, context);
        stamp(q.ordering.source, raw.householdId, c.actorId, c.operationId, c.effectiveAt, context);
        if (q.runId !== context.runId || !same(q.period, period) || q.source.asOf !== c.effectiveAt || q.bankSource.asOf !== c.effectiveAt)
          fail("RETIREMENT_SOURCE_UNAVAILABLE", "Exact original run, period and event cash confirmations required");
        if (!c.withholdingAmount.isZero() || !c.netAmount.equals(c.grossAmount) || r.withholding!.instructions.some(i => !i.amount.isZero()))
          fail("RETIREMENT_WITHHOLDING_UNSUPPORTED", "Only explicitly complete jurisdictional zero withholding can physically post");
        if (!unique(q.reservations.map(p => p.id)) || !unique(q.ordering.after)
          || ![q.sourceCashBefore, q.bankCashBefore, ...q.reservations.map(p => p.amount)].every(exact))
          fail("RETIREMENT_LIQUIDITY_INVALID", "Exact nonnegative cash and independent unique reservations required");
        for (const p of q.reservations) stamp(p.source, raw.householdId, c.actorId, p.id, c.effectiveAt, context);
        const reserved = q.reservations.reduce((sum, p) => sum.plus(p.amount), Money.zero(USD));
        const priorGross = evaluation.candidates.filter(other => other.sourceAccountId === c.sourceAccountId
          && (other.effectiveAt < c.effectiveAt || reaches(c.operationId, other.operationId)))
          .reduce((sum, other) => sum.plus(other.grossAmount), Money.zero(USD));
        const availableBefore = a.liquidity!.available.minus(priorGross);
        if (!q.sourceCashBefore.minus(reserved).equals(availableBefore) || availableBefore.compare(c.grossAmount) < 0)
          fail("RETIREMENT_LIQUIDITY_INVALID", "Current CASH less all independent reservations must equal sourced available cash");
        const source = opening.state.accounts[c.sourceAccountId], bank = opening.state.accounts[c.destinationAccountId];
        if (!source || source.id !== c.sourceAccountId || source.ownerId !== c.actorId || source.kind !== "retirement"
          || !bank || bank.id !== c.destinationAccountId || bank.ownerId !== c.actorId || bank.kind !== r.bank.kind
          || !["checking", "savings"].includes(bank.kind) || !exact(source.cash) || !exact(bank.cash))
          fail("RETIREMENT_RESOURCE_INVALID", "Existing owner retirement CASH and exact owned checking/savings required");
        const txId = accountingTransactionId(c.operationId);
        const keys = [idempotencyKey("d2:source-operation", c.operationId), idempotencyKey("d2:authorization", c.authorizationId),
          idempotencyKey("d2:retirement-withdrawal", c.claimId),
          ...r.withholding!.instructions.map(i => idempotencyKey("d2:authorization", i.authorizationId)),
          idempotencyKey("d2:retirement-cash-receipt", canonicalSerialize({ raw, members: input.members, confirmations: input.confirmations, operationId: c.operationId }))];
        const registry = opening.state.identities;
        const posted = postedIds.has(c.operationId);
        if ((posted || keys.some(key => registry.externalIdempotencyKeys.includes(key)))
          && (!posted || !keys.every(key => registry.externalIdempotencyKeys.includes(key))))
          fail("RETIREMENT_STALE_OR_DUPLICATE", "Posted transaction and exact source receipt must agree; identities cannot be reused");
        if (q.ordering.after.some(id => {
          const prior = active.find(other => other.operationId === id);
          return !prior || prior.effectiveAt > c.effectiveAt || (posted && !postedIds.has(id));
        }) || reaches(c.operationId, c.operationId))
          fail("RETIREMENT_ORDER_INVALID", "Order must be acyclic, temporal and preserve a posted prefix");
        if (active.some(other => other !== c && other.effectiveAt === c.effectiveAt
          && [other.sourceAccountId, other.destinationAccountId].some(id => id === source.id || id === bank.id)
          && !reaches(c.operationId, other.operationId) && !reaches(other.operationId, c.operationId)))
          fail("HOUSEHOLD_CONTENTION_UNRESOLVED", "Shared same-date cash requires explicit source authorization order");
        if (work.some(w => w.sequencingInstant === at(c.effectiveAt)
          && w.resourceAccesses.some(access => access.accountId === source.id || access.accountId === bank.id)))
          fail("HOUSEHOLD_CONTENTION_UNRESOLVED", "Same-date unrelated cash work needs a cross-source reservation/order contract");
        if (posted) {
          if (reference && !opening.state.retirementDistributionAllocations?.[txId])
            fail("RETIREMENT_RMD_HISTORY_UNAVAILABLE", "A legacy cash-only ID cannot be converted into J1 RMD credit");
          // Check the final posted prefix frontier for each touched account.
          // IDs alone never license a changed event balance as an identical replay.
          for (const [account, expected] of [[source, q.sourceCashBefore.minus(c.grossAmount)],
            [bank, q.bankCashBefore.plus(c.grossAmount)]] as const) {
            const laterPosted = active.some(other => postedIds.has(other.operationId) && other !== c
              && [other.sourceAccountId, other.destinationAccountId].includes(account.id)
              && (other.effectiveAt > c.effectiveAt || reaches(other.operationId, c.operationId)));
            if (!laterPosted && !account.cash.equals(expected))
              fail("RETIREMENT_STALE_BALANCE", "Posted prefix cash must match the exact confirmed transaction frontier");
          }
          continue;
        }
        const traceRefs = [...new Set([...c.traceRefs, q.source.id, q.bankSource.id, q.ordering.source.id, member.source.id,
          ...q.reservations.map(p => p.source.id), c.operationId, c.authorizationId])].sort().map(id => calculationTraceRef(calculationTraceId(id)));
        operations.push({ descriptor: { id: c.operationId, domain: "investments", operationClass: "investment_transfer",
          sequencingInstant: at(c.effectiveAt), dependsOn: q.ordering.after.filter(id => !postedIds.has(id)),
          resourceAccesses: [{ kind: "account_cash", accountId: source.id, mode: "consume" }, { kind: "account_cash", accountId: bank.id, mode: "produce" }], traceRefs },
        execute: candidate => {
          const current = candidate.state.accounts[source.id], destination = candidate.state.accounts[bank.id];
          if (!current || current.kind !== "retirement" || current.ownerId !== c.actorId || !destination
            || destination.kind !== r.bank.kind || destination.ownerId !== c.actorId
            || !current.cash.equals(q.sourceCashBefore) || !destination.cash.equals(q.bankCashBefore)
            || current.cash.minus(reserved).compare(c.grossAmount) < 0)
            fail("RETIREMENT_STALE_BALANCE", "Execution cash must equal event confirmations and preserve pending reservations");
          if (candidate.state.identities.postedTransactionIds.includes(txId) || keys.some(key => candidate.state.identities.externalIdempotencyKeys.includes(key)))
            fail("RETIREMENT_STALE_OR_DUPLICATE", "Withdrawal identity or authorization already consumed");
          let transaction = createAccountingTransaction({ id: txId, type: "retirement_cash_transfer", date: at(c.effectiveAt), traceRefs,
            legs: [createAccountingLeg({ type: "cash", posting: "debit", amount: c.grossAmount, accountId: bank.id, cashFlowClass: "investing" }),
              createAccountingLeg({ type: "cash", posting: "credit", amount: c.grossAmount, accountId: source.id, cashFlowClass: "investing" })] });
          if (reference) {
            const currentSource = readRetirementRawSource(reference, context);
            const qualification = currentSource && qualifyRetirementRawSource(currentSource, c.operationId, context);
            if (!qualification || qualification.status !== "qualified")
              fail("RETIREMENT_AUTHORIZATION_INCOMPLETE", "Independent raw A4 source does not qualify this distribution");
            if (!qualifyRetirementPriorHistory(currentSource!, candidate.state, context))
              fail("RETIREMENT_RMD_HISTORY_UNAVAILABLE", "Exhaustive qualified prior archive and usage are required for a new RMD allocation");
            const result = applyRetirementDistributionAtomically(candidate.state, qualification.distribution, context);
            if (result.status !== "qualified") fail("RETIREMENT_SOURCE_UNAVAILABLE", "Publisher withdrew authorization before atomic commit");
            transaction = candidate.state.d2PostedTransactions![txId]!.transaction;
            const reconciliation = evaluateFundedRmdSatisfaction(reference, candidate.state, context, period.end);
            if (reconciliation.annual?.diagnostics.some(d => ["obligation_overallocated", "transaction_overallocated"].includes(d.sourceEntityPath)))
              fail("RETIREMENT_RMD_OVERALLOCATED", "Actual historical plus new allocations exceed authenticated RMD capacity");
          } else applyAccountingTransactionAtomically(candidate.state, transaction);
          for (const key of keys) registerAuthoritativeIdentity(candidate.state.identities, "externalIdempotencyKeys", key);
          if (tier === "summary") {
            const sink = new SummaryOperationSink(USD); sink.transaction(transaction);
            return { ...candidate, facts: { ...(reference ? fundedCoverageFacts() : coverageFacts()), summary: { evidence: sink.snapshot() } } };
          }
          return { ...candidate, facts: { ...(reference ? fundedCoverageFacts() : coverageFacts()), transactions: [transaction], traceRefs } };
        } });
      }
      if (reference && period.end === reference.horizon.end) operations.push({
        descriptor: { id: `d2:retirement-rmd:${period.end}`, domain: "retirement", operationClass: "retirement:coverage",
          sequencingInstant: instant(new Date(Date.parse(period.end) - 1).toISOString()),
          dependsOn: active.filter(c => !postedIds.has(c.operationId)).map(c => c.operationId), resourceAccesses: [], traceRefs: [] },
        execute: candidate => {
          const result = evaluateFundedRmdSatisfaction(reference, candidate.state, context, period.end);
          return { ...candidate, facts: { outputCapabilities: { rmdSatisfaction: { dependency: "tax_independent",
            status: result.coverage, diagnostics: [] } }, diagnostics: result.coverage === "complete" ? [] : [{ severity: "warning",
            code: "RETIREMENT_RMD_HISTORY_UNAVAILABLE", entityType: "retirement_cash", message: `S7: ${result.reason ?? "Unfunded annual RMD obligation"}` }] } };
        } });
      return { id: participantId, operations };
    },
    observe: (descriptor, _facts, runtime) => {
      if (!input.withdrawals.requests.some(r => r.operationId === descriptor.id)
        && input.withdrawals.requests.some(r => at(r.effectiveAt) === descriptor.sequencingInstant
          && descriptor.resourceAccesses.some(a => a.accountId === r.sourceAccountId || a.accountId === r.bank.id)))
        fail("HOUSEHOLD_CONTENTION_UNRESOLVED", "Another participant touched retirement/BANK cash on the withdrawal date without a shared order contract");
      return runtime;
    },
  } satisfies HouseholdKernelParticipant);
}
registerHouseholdParticipantCodec({ codec: "d2-retirement-cash/v1", restore: value => createRetirementCashParticipant(value as RetirementCashInput) });

/** A4 intentionally admits one account CASH snapshot per event date. Separate
 * dated plans preserve that contract instead of reusing a stale earlier balance. */
export interface FundedRetirementCashSchedule {
  readonly plans: readonly RetirementCashInput[];
  readonly annualSource: RetirementSourceReference;
  readonly horizon: Period;
}
export function createFundedRetirementCashSchedule(configuration: FundedRetirementCashSchedule): HouseholdKernelParticipant {
  const input = immutableConfiguration(configuration);
  if (!input.plans.length || input.plans.some(p => !p.fundedRmd || !same(p.fundedRmd.horizon, input.horizon))
    || !unique(input.plans.flatMap(p => p.withdrawals.requests.map(r => r.operationId))))
    fail("RETIREMENT_IDENTITY_INVALID", "Distinct source-qualified dated plans and a common full horizon are required");
  const participants = input.plans.map(createRetirementCashParticipant);
  return Object.freeze({ id: participantId, version: "funded-account-rmd/v2", portableCodec: "d2-retirement-cash/v2", economicInputs: input,
    prepare: (context, period, opening, work, tier) => {
      const operations = participants.flatMap(p => p.prepare(context, period, opening, work, tier).operations)
        .filter(o => !o.descriptor.id.startsWith("d2:retirement-rmd:"));
      // Coverage operations are identical; never deduplicate financial work.
      const seenCoverage = new Set<string>();
      const prepared = operations.filter(o => !o.descriptor.id.startsWith("d2:retirement-coverage:")
        || (!seenCoverage.has(o.descriptor.id) && !!seenCoverage.add(o.descriptor.id)));
      if (period.end === input.horizon.end) prepared.push({
        descriptor: { id: `d2:retirement-rmd:${period.end}`, domain: "retirement", operationClass: "retirement:coverage",
          sequencingInstant: instant(new Date(Date.parse(period.end) - 1).toISOString()),
          dependsOn: prepared.filter(o => !o.descriptor.id.startsWith("d2:retirement-coverage:")).map(o => o.descriptor.id), resourceAccesses: [], traceRefs: [] },
        execute: candidate => {
          const result = evaluateFundedRmdSatisfaction({ ...input.annualSource, horizon: input.horizon }, candidate.state, context, period.end);
          return { ...candidate, facts: { outputCapabilities: { rmdSatisfaction: {
            dependency: "tax_independent", status: result.coverage, diagnostics: [] } } } };
        } });
      return { id: participantId, operations: prepared };
    },
    observe: (descriptor, facts, runtime) => participants.reduce((next, p) => p.observe!(descriptor, facts, next), runtime),
  } satisfies HouseholdKernelParticipant);
}
registerHouseholdParticipantCodec({ codec: "d2-retirement-cash/v2", restore: value => createFundedRetirementCashSchedule(value as FundedRetirementCashSchedule) });

export function attachFundedRetirementCashSchedule(kernel: CompiledHouseholdKernel, input: FundedRetirementCashSchedule): CompiledHouseholdKernel {
  if (!same(input.horizon, { start: kernel.horizon.start, end: kernel.horizon.periods.at(-1)!.end }))
    fail("RETIREMENT_HORIZON_INVALID", "Dated RMD plans must bind the full compiled forecast horizon");
  const participant = createFundedRetirementCashSchedule(input), existing = kernel.executable.participants ?? [];
  const prior = existing.find(p => p.id === participant.id);
  if (prior && (prior.version !== participant.version || !same(prior.economicInputs, participant.economicInputs)))
    fail("RETIREMENT_STALE_PARTICIPANT", "An attached retirement schedule cannot be replaced");
  return prior ? kernel : applyHouseholdExecutionOverlay(kernel, { participants: [...existing, participant] });
}

export function attachRetirementCash(kernel: CompiledHouseholdKernel, input: RetirementCashInput) {
  if (input.fundedRmd && !same(input.fundedRmd.horizon, { start: kernel.horizon.start, end: kernel.horizon.periods.at(-1)!.end }))
    fail("RETIREMENT_HORIZON_INVALID", "RMD horizon must equal the full compiled forecast horizon");
  const participant = createRetirementCashParticipant(input);
  const existing = kernel.executable.participants ?? [];
  const prior = existing.find(p => p.id === participant.id);
  if (prior && (prior.version !== participant.version || !same(prior.economicInputs, participant.economicInputs)))
    fail("RETIREMENT_STALE_PARTICIPANT", "Changed retirement source, amount, bank or authorization cannot replace an attached participant");
  const diagnostics: readonly RetirementCashDiagnostic[] = Object.freeze([
    { seam: "S7", sourceEntityPath: "retirementCash", affectedOutput: "retirement_tax", coverage: "incomplete",
      diagnosticCode: "RETIREMENT_TAX_INCOMPLETE", missingFacts: ["Pretax distribution tax characterization"] },
    { seam: "S7", sourceEntityPath: "retirementCash", affectedOutput: "rmd_satisfaction", coverage: "incomplete",
      diagnosticCode: "RETIREMENT_RMD_HISTORY_UNAVAILABLE", missingFacts: ["Canonical portable retirement transaction/allocation journal and source-authenticated annual reconciliation"] },
  ]);
  // Raw re-evaluation, never caller flags. Purported posted history is declined
  // by the binder; no conditional proposal becomes persisted satisfaction.
  const binding = input.rmd ? evaluateWithdrawalRmd(input.rmd.input) : undefined;
  const conditionalRmd = input.rmd && binding?.bundle
    && same(input.rmd.input.withdrawals, input.withdrawals) && same(binding.bundle, input.rmd.bundle)
    ? binding : null;
  return Object.freeze({ kernel: prior ? kernel : applyHouseholdExecutionOverlay(kernel, { participants: [...existing, participant] }),
    diagnosticSeam: "S7" as const, coverage: "incomplete" as const, rmdSatisfaction: "not_applied" as const,
    conditionalRmd, diagnostics });
}
