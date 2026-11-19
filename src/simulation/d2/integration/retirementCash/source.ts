import { accountingTransactionId, createAccountingLeg, createAccountingTransaction } from "../../../../accounting/index.js";
import { domainId } from "../../../../identity/index.js";
import { calculationTraceId } from "../../../../lineage/index.js";
import { registerHouseholdEconomicOriginalAuthority, registerRetirementDistributionSourceAuthority, retirementDistributionSourceFingerprint,
  type AuthoritativeState, type D2SettlementSourceContext, type RetirementDistributionRecord, type RetirementSourceQualification } from "../../../../state/index.js";
import { civilDate, instant, type Instant } from "../../../../time/index.js";
import { DecimalAmount, Money, USD } from "../../../../values/index.js";
import { sha256 } from "../../../../rules/tax/t1b/contentIdentity.js";
import { immutableConfiguration } from "../../../r3/compiledHousehold.js";
import { canonicalSerialize } from "../../../run.js";
import { evaluateWithdrawals } from "../../retirement/withdrawals/index.js";
import { evaluateWithdrawalRmd, type WithdrawalRmdInput } from "../../retirement/withdrawalRmd/index.js";
import type { RetirementCashInput } from "./index.js";
import { qualifyHouseholdBankRoute } from "../householdBank/index.js";

export interface RetirementSourceReference {
  readonly sourceId: string;
  readonly sourceVersion: string;
  readonly contentDigest?: string;
}
/** Independently published raw inputs; no posted_funded flag or journal input. */
export interface RetirementRawSource extends RetirementSourceReference {
  readonly cash: RetirementCashInput;
  readonly binding: WithdrawalRmdInput;
  readonly availability: readonly { readonly operationId: string; readonly publishedAt: Instant; readonly knownAt: Instant }[];
  readonly priorOperationIds: readonly string[];
}
export interface RetirementRawSourcePort {
  readonly read: (reference: RetirementSourceReference, context: D2SettlementSourceContext) => RetirementRawSource | undefined;
}
let provider: RetirementRawSourcePort | undefined;
const same = (a: unknown, b: unknown) => canonicalSerialize(a) === canonicalSerialize(b);
const at = (date: string) => instant(`${date}T00:00:00.000Z`);
const canonicalRaw = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(item => {
    const normalized = canonicalRaw(item);
    return { normalized, key: canonicalSerialize(normalized) };
  }).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0).map(item => item.normalized);
  if (value && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null))
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, canonicalRaw(item)]));
  return value;
};

// Publisher objects can be mutable, even when the lookup returns the same
// identity. Walk the latest response before sharing its detached snapshot.
// Compare ordered inputs as observed; the digest's set normalization is only
// a change witness. Unknown value types take the uncached path.
function matchesObservedValue(value: unknown, snapshot: unknown): boolean {
  if (!value || typeof value !== "object" || !snapshot || typeof snapshot !== "object")
    return typeof value !== "function" && Object.is(value, snapshot);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.getPrototypeOf(snapshot)) return false;
  if (prototype === Money.prototype) {
    if (value !== snapshot || !Object.isFrozen(value) || Reflect.ownKeys(value).length !== 2) return false;
    const amount: unknown = Object.getOwnPropertyDescriptor(value, "amount")?.value;
    return Object.getOwnPropertyDescriptor(value, "currency")?.value === USD && amount instanceof DecimalAmount
      && Object.getPrototypeOf(amount) === DecimalAmount.prototype && Object.isFrozen(amount)
      && Reflect.ownKeys(amount).length === 0;
  }
  if (value === USD) return snapshot === USD;
  if (prototype === Array.prototype) {
    const left = value as readonly unknown[], right = snapshot as readonly unknown[];
    if (left.length !== right.length || Reflect.ownKeys(left).length !== left.length + 1) return false;
    for (let i = 0; i < left.length; i++) {
      if (!Object.hasOwn(left, i) || !matchesObservedValue(left[i], right[i])) return false;
    }
    return true;
  }
  if (prototype !== Object.prototype) return false;
  const left = value as Record<string, unknown>, right = snapshot as Record<string, unknown>;
  const keys = Object.keys(left), expected = Object.keys(right);
  return keys.length === expected.length && keys.every((key, index) =>
    key === expected[index] && matchesObservedValue(left[key], right[key]));
}

// One detached snapshot per observation context. This also handles providers
// that return a new envelope on each call without retaining their old objects.
const recentOriginals = new WeakMap<D2SettlementSourceContext, RetirementRawSource>();
interface OriginalComputation {
  digest?: string;
  legacy?: string;
  a4?: ReturnType<typeof evaluateA4>;
}
const originalComputations = new WeakMap<RetirementRawSource, OriginalComputation>();
const serializeOriginal = (raw: RetirementRawSource): string => canonicalSerialize(canonicalRaw(raw));

/** Full original evidence, including identity, cash, approvals and prior usage.
 * Evidence arrays are sets; explicit ordering edges retain economic precedence.
 * This version is a change witness, never publisher authentication. */
export function retirementRawSourceDigest(raw: RetirementRawSource): string {
  const computation = originalComputations.get(raw);
  if (computation?.digest !== undefined) return computation.digest;
  const digest = `retirement-raw/v2:sha256:${sha256(serializeOriginal(raw))}`;
  if (computation) computation.digest = digest;
  return digest;
}

function legacyWitness(raw: RetirementRawSource): string {
  const computation = originalComputations.get(raw);
  return computation ? computation.legacy ??= serializeOriginal(raw) : serializeOriginal(raw);
}

/** Regenerate old witnesses from the live original; never echo archived bytes. */
export function qualifyRetirementRecordedSource(raw: RetirementRawSource, operationId: string,
  context: D2SettlementSourceContext, ruleVersion: string): RetirementSourceQualification {
  const legacy = typeof ruleVersion === "string" && ruleVersion.startsWith("{");
  if (ruleVersion !== (legacy ? legacyWitness(raw) : retirementRawSourceDigest(raw)))
    return { status: "incomplete", reason: "source_not_qualified" };
  return qualifyRetirementRawSource(raw, operationId, context, legacy);
}

/** Called by the embedding composition root, including in every restore process.
 * Portable configuration contains addresses, never the publisher callback. */
export function registerRetirementRawSourcePort(port: RetirementRawSourcePort): void {
  if (provider) throw new Error("RETIREMENT_RAW_SOURCE_PORT_DUPLICATE");
  registerRetirementDistributionSourceAuthority({ qualify: (source, context) => {
    try {
    const raw = readRetirementRawSource(source, context);
    const confirmation = raw?.cash.confirmations.find(q => q.source.id === source.sourceApprovalId);
    const qualification = raw && confirmation && qualifyRetirementRecordedSource(raw, confirmation.operationId, context, source.ruleVersion);
    return qualification?.status === "qualified" && same(qualification.distribution.source, source)
      ? qualification : { status: "incomplete", reason: "source_not_qualified" };
    } catch { return { status: "incomplete", reason: "source_not_qualified" }; }
  } });
  provider = Object.freeze({ read: port.read });
  registerHouseholdEconomicOriginalAuthority("retirement", "d2-retirement-original", { qualify: (ref, context) => {
    try {
      const raw = readRetirementRawSource({ sourceId: ref.sourceId, sourceVersion: ref.revisionId,
        contentDigest: ref.digest }, context);
      const result = raw && qualifyRetirementRawSource(raw, context.eventId, context);
      if (!result || result.status !== "qualified") return undefined;
      const d = result.distribution, attachment = d.nativeHousehold;
      if (!attachment || !same(attachment.context, context) || !same(attachment.originals[0]!.original, ref)) return undefined;
      return { witness: attachment.originals[0]!, context, requiredFamilies: ["retirement"],
        transaction: createAccountingTransaction({ id: d.transactionId, type: "retirement_cash_transfer", date: d.effectiveAt,
          legs: [createAccountingLeg({ type: "cash", posting: "debit", amount: d.netBank, accountId: d.destinationAccountId, cashFlowClass: "investing" }),
            createAccountingLeg({ type: "cash", posting: "credit", amount: d.gross, accountId: d.sourceAccountId, cashFlowClass: "investing" })] }) };
    } catch { return undefined; }
  } });
}

export function readRetirementRawSource(reference: RetirementSourceReference, context: D2SettlementSourceContext): RetirementRawSource | undefined {
  try {
    const observed = provider?.read(reference, context);
    if (!observed) return undefined;
    const previous = recentOriginals.get(context);
    let raw: RetirementRawSource;
    if (previous && matchesObservedValue(observed, previous)) raw = previous;
    else {
      raw = immutableConfiguration(observed);
      if (matchesObservedValue(raw, raw)) {
        recentOriginals.set(context, raw);
        if (!originalComputations.has(raw)) originalComputations.set(raw, {});
      } else recentOriginals.delete(context);
    }
    if (raw.sourceId !== reference.sourceId || raw.sourceVersion !== reference.sourceVersion
      || (reference.contentDigest !== undefined && reference.contentDigest !== retirementRawSourceDigest(raw))) return undefined;
    return raw;
  } catch { return undefined; }
}

/** Admission needs the exhaustive prior archive and its independently qualified
 * one-time usage, not merely a caller's 'verified_complete' string. */
export function qualifyRetirementPriorHistory(raw: RetirementRawSource, state: AuthoritativeState, context: D2SettlementSourceContext): boolean {
  const planned = new Set(raw.cash.withdrawals.requests.map(r => r.operationId));
  const records = Object.values(state.retirementDistributionAllocations ?? {}).filter(d => d.householdId === raw.cash.withdrawals.householdId);
  if (new Set(raw.priorOperationIds).size !== raw.priorOperationIds.length
    || !same([...raw.priorOperationIds].sort(), records.filter(d => !planned.has(d.operationId)).map(d => d.operationId).sort())) return false;
  for (const record of records) {
    const original = readRetirementRawSource(record.source, context);
    const qualification = original && qualifyRetirementRecordedSource(original, record.operationId, context, record.source.ruleVersion);
    if (qualification?.status !== "qualified" || !same(qualification.distribution, record)) return false;
    if (!planned.has(record.operationId) && (!raw.cash.withdrawals.usage.operationIds.includes(record.operationId)
      || !raw.cash.withdrawals.usage.withdrawalIds.includes(record.withdrawalId)
      || !raw.cash.withdrawals.usage.authorizationIds.includes(record.authorizationId)
      || record.allocations.some(a => !raw.binding.usage.allocationIds.includes(a.allocationId) || !raw.binding.usage.approvalIds.includes(a.approvalId)))) return false;
    if (!planned.has(record.operationId) && original!.cash.withdrawals.requests.find(r => r.operationId === record.operationId)
      ?.withholding?.instructions.some(i => !raw.cash.withdrawals.usage.authorizationIds.includes(i.authorizationId))) return false;
  }
  return true;
}

/** Rebuild from raw A4 inputs, never from the caller's record or bundle. */
export function qualifyRetirementRawSource(raw: RetirementRawSource, operationId: string,
  context: D2SettlementSourceContext, legacy = false): RetirementSourceQualification {
  try { return rebuildRetirementDistribution(raw, operationId, context, legacy); }
  catch { return { status: "incomplete", reason: "source_not_qualified" }; }
}

function evaluateA4(raw: RetirementRawSource) {
  const evaluation = evaluateWithdrawals(raw.cash.withdrawals), binding = evaluateWithdrawalRmd(raw.binding);
  return { evaluation, allocations: binding.bundle?.allocations, obligations: binding.rmd.obligations,
    sameWithdrawals: same(raw.binding.withdrawals, raw.cash.withdrawals) };
}

function rebuildRetirementDistribution(raw: RetirementRawSource, operationId: string,
  context: D2SettlementSourceContext, legacy: boolean): RetirementSourceQualification {
  const incomplete = { status: "incomplete", reason: "source_not_qualified" } as const;
  const computation = originalComputations.get(raw);
  const { evaluation, allocations: boundAllocations, obligations, sameWithdrawals } = computation
    ? computation.a4 ??= evaluateA4(raw) : evaluateA4(raw);
  // Plain household transfers still use the native journal, with no invented RMD rows.
  const plainHousehold = raw.cash.withdrawals.requests.every(r => r.bank.householdDestination)
    && raw.binding.allocations.length === 0 && raw.binding.rmd.requests.length === 0;
  if ((!plainHousehold && !boundAllocations) || evaluation.coverage !== "complete" || !sameWithdrawals
    || raw.cash.withdrawals.knownAt > context.dataCutoff.slice(0, 10) || raw.cash.withdrawals.knownAt > context.asOf.slice(0, 10)
    || !plainHousehold && (raw.binding.rmd.knownAt > context.dataCutoff.slice(0, 10) || raw.binding.rmd.knownAt > context.asOf.slice(0, 10))
    || raw.binding.rmd.requests.some(r => r.aggregation || r.accounts.length !== 1)) return incomplete;
  const c = evaluation.candidates.find(c => c.operationId === operationId);
  const q = raw.cash.confirmations.find(q => q.operationId === operationId);
  const availability = raw.availability.filter(a => a.operationId === operationId);
  if (!c || !q || availability.length !== 1) return incomplete;
  const clock = availability[0]!;
  instant(clock.publishedAt); instant(clock.knownAt);
  if (clock.publishedAt > clock.knownAt || clock.knownAt > at(c.effectiveAt) || clock.knownAt > context.dataCutoff
    || clock.knownAt > context.asOf || !c.withholdingAmount.isZero() || !c.grossAmount.equals(c.netAmount)) return incomplete;
  const account = raw.cash.withdrawals.cash.find(a => a.accountId === c.sourceAccountId);
  if (!account || account.instrumentFamily === "roth_ira" || !account.liquidity) return incomplete;
  const member = raw.cash.members.filter(m => m.personId === c.actorId);
  const stamp = (s: typeof q.source, resourceId: string): boolean => {
    [s.publishedAt, s.asOf, s.effectiveFrom, s.endExclusive].forEach(civilDate);
    return [s.id, s.ruleSnapshotId, s.jurisdiction, s.ruleFamily, s.sourcePublication, s.version].every(v => !!v.trim())
    && s.projectionStatus === "verified" && s.householdId === c.householdId && s.personId === c.actorId
    && s.resourceId === resourceId && s.publishedAt <= s.asOf && s.asOf <= c.effectiveAt
    && `${s.asOf}T00:00:00.000Z` <= clock.knownAt && s.effectiveFrom <= c.effectiveAt && c.effectiveAt < s.endExclusive;
  };
  const exact = (m: Money) => m instanceof Money && m.currency.equals(USD) && m.amount.fitsScale(2) && !m.isNegative();
  if (member.length !== 1 || !stamp(member[0]!.source, c.actorId) || !stamp(q.source, c.sourceAccountId)
    || !stamp(q.bankSource, c.destinationAccountId) || !stamp(q.ordering.source, c.operationId)
    || q.source.asOf !== c.effectiveAt || q.bankSource.asOf !== c.effectiveAt
    || ![q.sourceCashBefore, q.bankCashBefore, ...q.reservations.map(r => r.amount)].every(exact)
    || q.reservations.some(r => !stamp(r.source, r.id))
    || new Set(q.reservations.map(r => r.id)).size !== q.reservations.length) return incomplete;
  const reserved = q.reservations.reduce((sum, r) => sum.plus(r.amount), Money.zero(USD));
  if (q.sourceCashBefore.minus(reserved).compare(c.grossAmount) < 0) return incomplete;
  const rows = plainHousehold ? [] : boundAllocations!.filter(a => a.withdrawalId === c.claimId);
  const allocations: RetirementDistributionRecord["allocations"] = rows.map(row => {
    const o = obligations.find(o => o.id === row.rmdObligationId)!;
    const r = raw.binding.rmd.requests.find(r => r.personId === o.personId && r.taxYear === o.taxYear
      && r.accounts[0]?.id === c.sourceAccountId)!;
    return { allocationId: row.allocationId, approvalId: row.approval!.id, obligationId: o.id,
      satisfiesRmdYear: o.taxYear, sourceAccountId: domainId("account", c.sourceAccountId), amount: row.amount,
      deadline: at(o.due), firstYear: o.taxYear - Number(r.birthDate.slice(0, 4)) === r.rule!.startAge,
      deferred: r.election === "defer", ruleVersion: o.ruleSnapshotId, sourceId: row.approval!.rmdSource.id,
      obligation: { personId: domainId("person", o.personId), accountId: domainId("account", c.sourceAccountId),
        taxYear: o.taxYear, ruleSnapshotId: o.ruleSnapshotId, required: o.required } };
  });
  const ancestors = (id: string, seen = new Set<string>()): Set<string> => {
    if (seen.has(id)) return seen;
    seen.add(id);
    for (const prior of raw.cash.confirmations.find(q => q.operationId === id)?.ordering.after ?? []) ancestors(prior, seen);
    return seen;
  };
  const source: RetirementDistributionRecord["source"] = { sourceId: raw.sourceId, sourceVersion: raw.sourceVersion,
    // Change witness only: publisher authentication always comes from read().
    ruleVersion: legacy ? legacyWitness(raw) : retirementRawSourceDigest(raw), publishedAt: clock.publishedAt, knownAt: clock.knownAt,
    householdId: domainId("household", c.householdId), personId: domainId("person", c.actorId),
    sourceApprovalId: q.source.id, paymentApprovalId: q.ordering.source.id,
    executionOrder: { sequenceId: raw.sourceId, position: ancestors(c.operationId).size - 1 } };
  const request = raw.cash.withdrawals.requests.find(r => r.operationId === operationId)!;
  const household = request.bank.householdDestination;
  const bank = raw.cash.householdBank;
  if (household && (!bank || legacy)) return incomplete;
  const eventContext = { asOf: context.asOf, dataCutoff: context.dataCutoff, runId: q.runId, eventId: operationId, eventAt: at(c.effectiveAt),
    householdId: source.householdId, personId: source.personId, bankAccountId: domainId("account", c.destinationAccountId), direction: "credit" as const };
  const nativeHousehold: RetirementDistributionRecord["nativeHousehold"] = household ? {
    version: "native-household-posting/v1", transactionId: accountingTransactionId(operationId), family: "retirement", cashRole: "bank",
    context: eventContext, route: qualifyHouseholdBankRoute(bank!.publisherId, bank!.sourceId, eventContext),
    originals: [{ original: { version: "household-economic-original/v1", family: "retirement", publisherId: "d2-retirement-original",
      sourceId: raw.sourceId, revisionId: raw.sourceVersion, digest: retirementRawSourceDigest(raw) },
      source: { kind: "account", id: domainId("account", c.sourceAccountId) }, payer: { kind: "person", id: source.personId }, beneficiary: source.personId }],
  } : undefined;
  return { status: "qualified", distribution: immutableConfiguration<RetirementDistributionRecord>({ version: household ? "retirement-distribution/v2" : "retirement-distribution/v1",
    ...(nativeHousehold ? { nativeHousehold } : {}),
    transactionId: accountingTransactionId(operationId), originalPostingProofId: accountingTransactionId(operationId),
    operationId, withdrawalId: c.claimId, authorizationId: c.authorizationId, householdId: source.householdId, personId: source.personId,
    sourceAccountId: domainId("account", c.sourceAccountId), destinationAccountId: domainId("account", c.destinationAccountId),
    effectiveAt: at(c.effectiveAt), taxYear: Number(c.effectiveAt.slice(0, 4)), gross: c.grossAmount,
    netBank: c.netAmount, withholding: c.withholdingAmount, instrumentFamily: account.instrumentFamily, taxBucket: "pretax", beneficiaryId: null,
    distributionKind: "ordinary_cash", source, sourceEvidenceFingerprint: retirementDistributionSourceFingerprint(source),
    traceIds: [...new Set([...c.traceRefs, ...rows.flatMap(row => row.traceRefs), q.source.id, q.bankSource.id, q.ordering.source.id,
      ...raw.cash.members.map(m => m.source.id)])].sort().map(calculationTraceId), allocations, rmdSatisfaction: "not_applied", tax: "incomplete" }) };
}
