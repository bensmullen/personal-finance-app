import { vi } from "vitest";
import { civilDate as date } from "../../../../../src/time/index.js";
import { money } from "../../../../../src/values/index.js";
import type { BenefitPeriod, QuotedBenefit } from "../../../../../src/simulation/d2/retirement/benefits/index.js";
import type { Determination, EntitlementQuote, Evidence, Recipient } from "../../../../../src/simulation/d2/retirement/benefits/coordination/index.js";
import { ssaOriginalDigest, type SsaOriginalHistory, type SsaOriginalPin, type SsaOriginalProvider,
  type SsaOriginalPublication, type SsaOriginalQuery } from "../../../../../src/simulation/d2/retirement/benefits/ssaOriginalBinding/index.js";

export const period = (start = "2026-01-01", endExclusive = "2036-01-01"): BenefitPeriod => ({ start: date(start), endExclusive: date(endExclusive) });
export const cutoff = date("2025-12-01");
export const evidence = (id: string, effective = period()): Evidence => ({ evidenceId: id, coverageSetId: "synthetic:coverage",
  knownAt: cutoff, publishedAt: date("2025-11-01"), effective,
  source: { ruleSnapshotId: `synthetic:${id}`, jurisdiction: "US", ruleFamily: "synthetic_ssa_original",
    sourcePublication: "Synthetic award/legal fixture; NOT SSA evidence", asOf: date("2025-11-01"), version: "1", projectionStatus: "verified" } });
export function quote(person: string, role: EntitlementQuote["role"], amount: string,
  kind: QuotedBenefit["benefitKind"] = role === "own" ? "ss_retirement" : "ss_spousal"): EntitlementQuote {
  const e = evidence(`${person}:${role}`), worker = kind === "ss_retirement" ? person : `${person}:spouse`;
  return { quoteId: `${person}:${role}`, role, evidence: e, award: {
    awardId: `${person}:${role}:award`, entitlementId: `${person}:${role}:entitlement`, householdId: "household",
    recipientPersonId: person, workerRecordPersonId: worker, benefitKind: kind, claimingMonth: date("2026-01-01"),
    commencement: date("2026-01-15"), frequency: "monthly", invalidDayPolicy: "skip", calendarSource: e.source,
    quote: { recipientPersonId: person, workerRecordPersonId: worker, claimingMonth: date("2026-01-01"),
      grossAmount: money(amount), basis: "at_claim", adjustmentOrder: "claiming_then_cola_then_continuation", asOf: e.source.asOf,
      dollarBasisAt: date("2026-01-01"), source: e.source, coveredHorizon: period() },
    cola: { source: e.source, coveredHorizon: period(), changes: [] },
    verifiedAward: { recipientPersonId: person, workerRecordPersonId: worker, claimingMonth: date("2026-01-01"),
      source: e.source, coveredHorizon: period(), eligibility: "eligible",
      coordination: role === "excess" ? "unknown" : "total_payable_award", unsupportedRules: [] },
  } };
}
export function publication(person = "alice", strategy: "own" | "own_plus_excess" = "own"): SsaOriginalPublication {
  const own = quote(person, "own", "1500.37"), excess = quote(person, "excess", "200.12");
  const quotes = strategy === "own" ? [own] : [own, excess];
  const d: Determination = { determinationId: `${person}:legal`, electionId: `${person}:election`, versionId: "v1",
    evidence: evidence(`${person}:legal`), inventoryComplete: true, inventoryQuoteIds: quotes.map(q => q.quoteId),
    strategy, benefitKind: strategy === "own" ? "ss_retirement" : "ss_spousal", ownQuoteId: own.quoteId,
    ...(strategy === "own_plus_excess" ? { excessQuoteId: excess.quoteId,
      excessUnderOwn: { ownQuoteId: own.quoteId, claimedOwnAmount: money("1500.37"), evidence: evidence(`${person}:excess-attestation`) } } : {}),
    paymentAwardId: `${person}:payment`, paymentEntitlementId: `${person}:ssa`,
    paymentWorkerRecordPersonId: strategy === "own" ? person : `${person}:spouse`, claimingMonth: date("2026-01-01"),
    installmentDay: "15", eligibility: "eligible", relationship: strategy === "own" ? "self" : "married",
    ...(strategy === "own_plus_excess" ? { relationshipEvidence: evidence(`${person}:marriage`) } : {}), unsupportedRules: [] };
  return { publisherId: "synthetic:publisher", sourceId: `synthetic:${person}:source`, version: "1", originalId: `${person}:original`,
    householdId: "household", kind: "original", revisesOriginalId: null, status: "active", publishedAt: date("2025-11-01"),
    asOf: date("2025-11-01"), knownAt: cutoff, eventPeriod: period(),
    recipient: { recipientPersonId: person, enabled: true, quotes, determinations: [d] } };
}
export function survivorPublication(): SsaOriginalPublication {
  const o = publication(), own = o.recipient.quotes[0]!, raw = quote("alice", "total", "2100.89", "ss_survivor");
  const afterDeath = (id: string, effective = period()): Evidence => ({ ...evidence(id, effective),
    publishedAt: date("2026-02-11"), knownAt: date("2026-02-12"),
    source: { ...evidence(id).source, asOf: date("2026-02-11") } });
  const totalEvidence = afterDeath("alice:total");
  const total: EntitlementQuote = { ...raw, evidence: totalEvidence, award: { ...raw.award,
    calendarSource: totalEvidence.source, claimingMonth: date("2026-03-01"),
    quote: { ...raw.award.quote!, claimingMonth: date("2026-03-01"), dollarBasisAt: date("2026-03-01"), source: totalEvidence.source, asOf: totalEvidence.source.asOf },
    cola: { ...raw.award.cola!, source: totalEvidence.source }, commencement: date("2026-03-15"), workerDeathDate: date("2026-02-10"),
    verifiedAward: { ...raw.award.verifiedAward!, claimingMonth: date("2026-03-01"), source: totalEvidence.source, workerDeathDate: date("2026-02-10") } } };
  const inventoryQuoteIds = [own.quoteId, total.quoteId], base = o.recipient.determinations[0]!;
  const prior: Determination = { ...base, inventoryQuoteIds, evidence: evidence("own-before-death", period("2026-01-01", "2026-02-01")) };
  const { ownQuoteId: _own, ...rest } = base;
  const next: Determination = { ...rest, determinationId: "survivor:legal", electionId: "survivor:election", inventoryQuoteIds,
    evidence: afterDeath("survivor:legal", period("2026-03-01")), strategy: "replacement", benefitKind: "ss_survivor",
    totalQuoteId: total.quoteId, paymentWorkerRecordPersonId: "alice:spouse", relationship: "widowed",
    claimingMonth: date("2026-03-01"),
    relationshipEvidence: afterDeath("widow:relationship"),
    survivor: { workerRecordPersonId: "alice:spouse", workerDeathDate: date("2026-02-10"), effectiveAt: date("2026-03-15"),
      deathMonthRuleId: "synthetic:death-month-gap", overlapRuleId: "synthetic:replacement", partialMonthTerms: "whole_installment",
      evidence: afterDeath("death:determination") } };
  return { ...o, originalId: "alice:survivor-original", publishedAt: date("2026-02-11"), asOf: date("2026-02-11"),
    knownAt: date("2026-02-12"), eventPeriod: period("2026-03-01"),
    recipient: { ...o.recipient, quotes: [own, total], determinations: [prior, next] } };
}
const unique = (s: readonly string[]): string[] => [...new Set(s)].sort();
export function pin(o: SsaOriginalPublication): SsaOriginalPin {
  const r = o.recipient;
  return { publisherId: o.publisherId, sourceId: o.sourceId, sourceVersion: o.version, originalId: o.originalId,
    digest: ssaOriginalDigest(o), householdId: o.householdId, recipientPersonId: r.recipientPersonId,
    workerRecordPersonIds: unique([...r.quotes.map(q => q.award.workerRecordPersonId), ...r.determinations.map(d => d.paymentWorkerRecordPersonId)]),
    entitlementIds: unique([...r.quotes.map(q => q.award.entitlementId), ...r.determinations.map(d => d.paymentEntitlementId)]),
    awardIds: unique([...r.quotes.map(q => q.award.awardId), ...r.determinations.map(d => d.paymentAwardId)]),
    electionIds: unique(r.determinations.map(d => d.electionId)), claimingMonths: [...new Set(r.determinations.map(d => d.claimingMonth))].sort(),
    eventPeriod: o.eventPeriod, dataCutoff: cutoff };
}
/** Independent fixture book, never built from the consumer pin or its flags.
 * Simulates the port contract only; supplies no real SSA authentication. */
export function provider(book: readonly SsaOriginalPublication[], change: (h: SsaOriginalHistory, call: number) => SsaOriginalHistory | undefined = h => h) {
  let calls = 0;
  const publisherId = book[0]?.publisherId ?? "synthetic:publisher";
  const readOriginals = vi.fn((query: SsaOriginalQuery) => {
    const history: SsaOriginalHistory = { query, publisherId, authority: "verified_original_inventory", completeness: "complete",
      completeThrough: query.dataCutoff, checkedAt: query.knownAt,
      originals: book.filter(o => o.publisherId === publisherId && o.householdId === query.householdId &&
        o.recipient.recipientPersonId === query.recipientPersonId), revisions: [] };
    return change(history, ++calls);
  });
  return { publisherId, readOriginals } satisfies SsaOriginalProvider;
}
export const recipientChange = (o: SsaOriginalPublication, change: Partial<Recipient>): SsaOriginalPublication =>
  ({ ...o, recipient: { ...o.recipient, ...change } });
export const legalChange = (o: SsaOriginalPublication, change: Partial<Determination>): SsaOriginalPublication =>
  recipientChange(o, { determinations: [{ ...o.recipient.determinations[0]!, ...change }] });
