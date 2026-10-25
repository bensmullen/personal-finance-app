import { accountingTransactionId } from "../../../../accounting/index.js";
import { domainId } from "../../../../identity/index.js";
import { calculationTraceId } from "../../../../lineage/index.js";
import { registerRetirementDistributionSourceAuthority, retirementDistributionSourceFingerprint,
  type AuthoritativeState, type D2SettlementSourceContext, type RetirementDistributionRecord, type RetirementSourceQualification } from "../../../../state/index.js";
import { civilDate, instant, type Instant } from "../../../../time/index.js";
import { Money, USD } from "../../../../values/index.js";
import { sha256 } from "../../../../rules/tax/t1b/contentIdentity.js";
import { immutableConfiguration } from "../../../r3/compiledHousehold.js";
import { canonicalSerialize } from "../../../run.js";
import { evaluateWithdrawals } from "../../retirement/withdrawals/index.js";
import { evaluateWithdrawalRmd, type WithdrawalRmdInput } from "../../retirement/withdrawalRmd/index.js";
import type { RetirementCashInput } from "./index.js";

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
  if (Array.isArray(value)) return value.map(canonicalRaw).sort((a, b) => {
    const left = canonicalSerialize(a), right = canonicalSerialize(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  if (value && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null))
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, canonicalRaw(item)]));
  return value;
};

/** Full original evidence, including identity, cash, approvals and prior usage.
 * Evidence arrays are sets; explicit ordering edges retain economic precedence.
 * This version is a change witness, never publisher authentication. */
export const retirementRawSourceDigest = (raw: RetirementRawSource): string =>
  `retirement-raw/v2:sha256:${sha256(canonicalSerialize(canonicalRaw(raw)))}`;

/** Regenerate old witnesses from the live original; never echo archived bytes. */
export function qualifyRetirementRecordedSource(raw: RetirementRawSource, operationId: string,
  context: D2SettlementSourceContext, ruleVersion: string): RetirementSourceQualification {
  const legacy = canonicalSerialize(canonicalRaw(raw));
  if (ruleVersion !== legacy && ruleVersion !== retirementRawSourceDigest(raw))
    return { status: "incomplete", reason: "source_not_qualified" };
  return qualifyRetirementRawSource(raw, operationId, context, ruleVersion === legacy);
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
}

export function readRetirementRawSource(reference: RetirementSourceReference, context: D2SettlementSourceContext): RetirementRawSource | undefined {
  try {
    const raw = provider?.read(reference, context);
    if (!raw || raw.sourceId !== reference.sourceId || raw.sourceVersion !== reference.sourceVersion
      || (reference.contentDigest !== undefined && reference.contentDigest !== retirementRawSourceDigest(raw))) return undefined;
    return immutableConfiguration(raw);
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

function rebuildRetirementDistribution(raw: RetirementRawSource, operationId: string,
  context: D2SettlementSourceContext, legacy: boolean): RetirementSourceQualification {
  const incomplete = { status: "incomplete", reason: "source_not_qualified" } as const;
  const evaluation = evaluateWithdrawals(raw.cash.withdrawals), binding = evaluateWithdrawalRmd(raw.binding);
  if (!binding.bundle || evaluation.coverage !== "complete" || !same(raw.binding.withdrawals, raw.cash.withdrawals)
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
  const rows = binding.bundle.allocations.filter(a => a.withdrawalId === c.claimId);
  const allocations: RetirementDistributionRecord["allocations"] = rows.map(row => {
    const o = binding.rmd.obligations.find(o => o.id === row.rmdObligationId)!;
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
    ruleVersion: legacy ? canonicalSerialize(canonicalRaw(raw)) : retirementRawSourceDigest(raw), publishedAt: clock.publishedAt, knownAt: clock.knownAt,
    householdId: domainId("household", c.householdId), personId: domainId("person", c.actorId),
    sourceApprovalId: q.source.id, paymentApprovalId: q.ordering.source.id,
    executionOrder: { sequenceId: raw.sourceId, position: ancestors(c.operationId).size - 1 } };
  return { status: "qualified", distribution: immutableConfiguration<RetirementDistributionRecord>({ version: "retirement-distribution/v1",
    transactionId: accountingTransactionId(operationId), originalPostingProofId: accountingTransactionId(operationId),
    operationId, withdrawalId: c.claimId, authorizationId: c.authorizationId, householdId: source.householdId, personId: source.personId,
    sourceAccountId: domainId("account", c.sourceAccountId), destinationAccountId: domainId("account", c.destinationAccountId),
    effectiveAt: at(c.effectiveAt), taxYear: Number(c.effectiveAt.slice(0, 4)), gross: c.grossAmount,
    netBank: c.netAmount, withholding: c.withholdingAmount, instrumentFamily: account.instrumentFamily, taxBucket: "pretax", beneficiaryId: null,
    distributionKind: "ordinary_cash", source, sourceEvidenceFingerprint: retirementDistributionSourceFingerprint(source),
    traceIds: [...new Set([...c.traceRefs, ...rows.flatMap(row => row.traceRefs), q.source.id, q.bankSource.id, q.ordering.source.id,
      ...raw.cash.members.map(m => m.source.id)])].sort().map(calculationTraceId), allocations, rmdSatisfaction: "not_applied", tax: "incomplete" }) };
}
