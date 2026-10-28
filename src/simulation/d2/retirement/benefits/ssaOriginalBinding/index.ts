import { sha256 } from "../../../../../rules/tax/t1b/contentIdentity.js";
import { civilDate, type CivilDate } from "../../../../../time/index.js";
import { immutableConfiguration } from "../../../../r3/compiledHousehold.js";
import { canonicalSerialize } from "../../../../run.js";
import { coordinateSocialSecurity, type Evidence } from "../coordination/index.js";
import type { BenefitPeriod, BenefitSource } from "../index.js";
import type { SsaBindingCode, SsaBindingResult, SsaConditionalInstallment, SsaOriginalHistory,
  SsaOriginalPin, SsaOriginalProvider, SsaOriginalPublication, SsaOriginalReference } from "./types.js";
export type * from "./types.js";

const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const id = (v: string): boolean => typeof v === "string" && v.trim().length > 0 && v.length <= 256;
const key = (v: unknown): string => canonicalSerialize(v);
const same = (a: unknown, b: unknown): boolean => key(a) === key(b);
const unique = (v: readonly string[]): string[] => [...new Set(v)].sort(compare);
const setEqual = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === new Set(a).size && same([...a].sort(compare), unique(b));
const overlap = (a: BenefitPeriod, b: BenefitPeriod): boolean => a.start < b.endExclusive && b.start < a.endExclusive;
class Refused extends Error {
  constructor(readonly code: SsaBindingCode) { super(code); }
}
function need(ok: boolean, code: SsaBindingCode): asserts ok { if (!ok) throw new Refused(code); }
const period = (p: BenefitPeriod): void => {
  civilDate(p.start); civilDate(p.endExclusive); need(p.start < p.endExclusive, "INVALID_PIN");
};
const monthIndex = (s: CivilDate): number => Number(s.slice(0, 4)) * 12 + Number(s.slice(5, 7)) - 1;
// Publication arrays are evidence sets. Retain duplicates; never select a winner.
function normalized(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalized).sort((a, b) => compare(key(a), key(b)));
  if (v && Object.getPrototypeOf(v) === Object.prototype)
    return Object.fromEntries(Object.entries(v).map(([k, item]) => [k, normalized(item)]));
  return v;
}
/** Full-publication SHA-256 change witness, never publisher authentication. */
export const ssaOriginalDigest = (p: SsaOriginalPublication): string =>
  `ssa-original/v1:sha256:${sha256(key(normalized(p)))}`;

function read(pin: SsaOriginalPin, knownAt: CivilDate, provider: SsaOriginalProvider | undefined): SsaOriginalPublication {
  need(Boolean(provider), "MISSING_PROVIDER");
  need(provider!.publisherId === pin.publisherId, "UNQUALIFIED_INVENTORY");
  const query = immutableConfiguration({ sourceId: pin.sourceId, householdId: pin.householdId,
    recipientPersonId: pin.recipientPersonId, knownAt, dataCutoff: pin.dataCutoff });
  let fetched: SsaOriginalHistory | undefined;
  try { fetched = provider!.readOriginals(query); } catch { throw new Refused("ORIGINAL_UNAVAILABLE"); }
  need(Boolean(fetched), "ORIGINAL_UNAVAILABLE");
  const h = immutableConfiguration(fetched!);
  need(h.publisherId === pin.publisherId && h.authority === "verified_original_inventory" &&
    h.completeness === "complete" && h.completeThrough === pin.dataCutoff && h.checkedAt === knownAt &&
    same(h.query, query) && h.revisions.length <= 1200, "UNQUALIFIED_INVENTORY");
  for (const revision of h.revisions) {
    civilDate(revision.knownAt); civilDate(revision.publishedAt);
    need(id(revision.originalId) && id(revision.revisionId) && revision.publishedAt <= revision.knownAt, "UNQUALIFIED_INVENTORY");
    // Delayed amendments known at replay invalidate the original-only floor.
    need(revision.knownAt > knownAt || revision.publishedAt > pin.dataCutoff, "KNOWN_REVISION");
  }
  need(h.originals.length > 0 && h.originals.length <= 64, "ORIGINAL_UNAVAILABLE");
  for (const o of h.originals) {
    period(o.eventPeriod); civilDate(o.publishedAt); civilDate(o.asOf); civilDate(o.knownAt);
    need(o.publisherId === pin.publisherId && id(o.sourceId) && o.householdId === pin.householdId &&
      o.recipient.recipientPersonId === pin.recipientPersonId, "IDENTITY_MISMATCH");
  }
  const competing = h.originals.filter(o => overlap(o.eventPeriod, pin.eventPeriod));
  need(competing.length === 1, "COMPETING_ORIGINALS");
  const o = competing[0]!;
  need(o.sourceId === pin.sourceId && o.originalId === pin.originalId && o.version === pin.sourceVersion &&
    ssaOriginalDigest(o) === pin.digest, "ORIGINAL_CHANGED");
  need(o.kind === "original" && o.revisesOriginalId === null && o.status === "active", "ORIGINAL_UNAVAILABLE");
  need(same(o.eventPeriod, pin.eventPeriod), "IDENTITY_MISMATCH");
  need(o.publishedAt <= o.asOf && o.asOf <= o.knownAt && o.knownAt <= pin.dataCutoff && o.knownAt <= knownAt,
    "UNAVAILABLE_EVIDENCE");
  return o;
}

function identities(pin: SsaOriginalPin, o: SsaOriginalPublication): void {
  const r = o.recipient, ds = r.determinations;
  need(r.quotes.length > 0 && r.quotes.length <= 64 && ds.length > 0 && ds.length <= 64, "INVALID_ORIGINAL");
  need(setEqual(pin.workerRecordPersonIds, [...r.quotes.map(q => q.award.workerRecordPersonId), ...ds.map(d => d.paymentWorkerRecordPersonId)]) &&
    setEqual(pin.entitlementIds, [...r.quotes.map(q => q.award.entitlementId), ...ds.map(d => d.paymentEntitlementId)]) &&
    setEqual(pin.awardIds, [...r.quotes.map(q => q.award.awardId), ...ds.map(d => d.paymentAwardId)]) &&
    setEqual(pin.electionIds, ds.map(d => d.electionId)) && setEqual(pin.claimingMonths, ds.map(d => d.claimingMonth)), "IDENTITY_MISMATCH");
  need(new Set(r.quotes.map(q => q.quoteId)).size === r.quotes.length &&
    new Set(ds.map(d => d.determinationId)).size === ds.length, "INVALID_ORIGINAL");
  for (const q of r.quotes) {
    const a = q.award;
    need(a.householdId === pin.householdId && a.recipientPersonId === pin.recipientPersonId &&
      id(a.workerRecordPersonId) && id(a.entitlementId) && a.quote?.basis === "at_claim", "IDENTITY_MISMATCH");
    need(a.cola!.changes.length <= 1200, "INVALID_ORIGINAL");
    for (const identity of [a.quote!, a.verifiedAward!]) {
      need(identity.recipientPersonId === a.recipientPersonId && identity.workerRecordPersonId === a.workerRecordPersonId &&
        identity.claimingMonth === a.claimingMonth, "IDENTITY_MISMATCH");
    }
  }
  for (const d of ds) {
    period(d.evidence.effective);
    need(d.inventoryComplete && setEqual(d.inventoryQuoteIds, r.quotes.map(q => q.quoteId)), "INVALID_ORIGINAL");
    if (d.survivor) {
      civilDate(d.survivor.workerDeathDate);
      need(d.survivor.evidence.publishedAt >= d.survivor.workerDeathDate &&
        d.claimingMonth.slice(0, 7) >= d.survivor.workerDeathDate.slice(0, 7), "INVALID_ORIGINAL");
    }
  }
}

/** Qualify the complete inventory once at cutoff, then validate only temporal
 * references per installment. Never rescan full calendars/COLA documents per row. */
function availability(o: SsaOriginalPublication, pin: SsaOriginalPin): (at: CivilDate) => void {
  let availableAt = o.knownAt;
  const source = (s: BenefitSource): void => {
    civilDate(s.asOf);
    need(s.projectionStatus === "verified" && s.asOf <= pin.dataCutoff &&
      [s.ruleSnapshotId, s.jurisdiction, s.ruleFamily, s.sourcePublication, s.version].every(id), "UNAVAILABLE_EVIDENCE");
    if (s.asOf > availableAt) availableAt = s.asOf;
  };
  const evidence = (e: Evidence): void => {
    civilDate(e.knownAt); civilDate(e.publishedAt); period(e.effective); source(e.source);
    need(e.publishedAt <= e.knownAt && e.source.asOf <= e.knownAt && e.knownAt <= pin.dataCutoff, "UNAVAILABLE_EVIDENCE");
    if (e.knownAt > availableAt) availableAt = e.knownAt;
  };
  for (const q of o.recipient.quotes) {
    evidence(q.evidence);
    const a = q.award;
    for (const s of [a.calendarSource, a.quote!.source, a.cola!.source, a.verifiedAward!.source,
      ...a.cola!.changes.map(c => c.source), ...(a.claimingAdjustment ? [a.claimingAdjustment.source] : [])]) source(s);
    civilDate(a.quote!.asOf);
    need(a.quote!.asOf === a.quote!.source.asOf, "UNAVAILABLE_EVIDENCE");
  }
  for (const d of o.recipient.determinations) {
    evidence(d.evidence);
    if (d.relationshipEvidence) evidence(d.relationshipEvidence);
    if (d.excessUnderOwn) evidence(d.excessUnderOwn.evidence);
    if (d.survivor) evidence(d.survivor.evidence);
  }
  // The unchanged coordinator owns effective-period checks for the active
  // legal/quote/relationship/death evidence at every economic installment.
  return at => need(availableAt <= at, "UNAVAILABLE_EVIDENCE");
}

/** One bounded evaluator invocation and two independent reads per publication.
 * No formulas, tax/Medicare deductions, cash effects or settlement authority. */
export function bindSsaOriginals(request: {
  readonly householdId: string;
  readonly knownAt: CivilDate;
  readonly dataCutoff: CivilDate;
  readonly horizon: BenefitPeriod;
  readonly pins: readonly SsaOriginalPin[];
}, providers: readonly SsaOriginalProvider[] = []): SsaBindingResult {
  civilDate(request.knownAt); civilDate(request.dataCutoff); period(request.horizon);
  need(id(request.householdId) && request.dataCutoff <= request.knownAt && request.pins.length <= 64 &&
    monthIndex(request.horizon.endExclusive) - monthIndex(request.horizon.start) <= 1200, "INVALID_PIN");
  const pins = immutableConfiguration(request.pins);
  const originals: SsaOriginalReference[] = [], installments: SsaConditionalInstallment[] = [];
  const coverage: SsaBindingResult["coverage"][number][] = [];
  const fail = (p: SsaOriginalPin, code: SsaBindingCode): void => {
    coverage.push({ sourceId: p.sourceId, originalId: p.originalId, recipientPersonId: p.recipientPersonId,
      period: overlap(p.eventPeriod, request.horizon) ? {
        start: p.eventPeriod.start > request.horizon.start ? p.eventPeriod.start : request.horizon.start,
        endExclusive: p.eventPeriod.endExclusive < request.horizon.endExclusive ? p.eventPeriod.endExclusive : request.horizon.endExclusive,
      } : request.horizon, affectedOutput: "gross_schedule", coverage: "incomplete", diagnosticCodes: [code] });
  };
  // Include rejected pins: an unavailable competitor cannot create a winner.
  const conflicts = new Set<SsaOriginalPin>();
  for (let i = 0; i < pins.length; i++) for (let j = i + 1; j < pins.length; j++) {
    const a = pins[i]!, b = pins[j]!;
    if (overlap(a.eventPeriod, b.eventPeriod) && (a.recipientPersonId === b.recipientPersonId ||
      a.entitlementIds.some(e => b.entitlementIds.includes(e)) || a.awardIds.some(e => b.awardIds.includes(e)) ||
      a.electionIds.some(e => b.electionIds.includes(e)))) { conflicts.add(a); conflicts.add(b); }
  }
  for (const pin of [...pins].sort((a, b) => compare(key(normalized(a)), key(normalized(b))))) {
    try {
      need([pin.publisherId, pin.sourceId, pin.sourceVersion, pin.originalId, pin.householdId, pin.recipientPersonId,
        ...pin.workerRecordPersonIds, ...pin.entitlementIds, ...pin.awardIds, ...pin.electionIds].every(id) &&
        /^ssa-original\/v1:sha256:[a-f0-9]{64}$/.test(pin.digest) && pin.householdId === request.householdId &&
        pin.dataCutoff === request.dataCutoff, "INVALID_PIN");
      period(pin.eventPeriod);
      for (const m of pin.claimingMonths) { civilDate(m); need(m.endsWith("-01"), "INVALID_PIN"); }
      need(!conflicts.has(pin), "COMPETING_ORIGINALS");
      const matches = providers.filter(p => p.publisherId === pin.publisherId);
      need(matches.length <= 1, "UNQUALIFIED_INVENTORY");
      const provider = matches[0];
      const original = read(pin, request.knownAt, provider);
      identities(pin, original);
      const available = availability(original, pin);
      const horizon = { start: request.horizon.start > pin.eventPeriod.start ? request.horizon.start : pin.eventPeriod.start,
        endExclusive: request.horizon.endExclusive < pin.eventPeriod.endExclusive ? request.horizon.endExclusive : pin.eventPeriod.endExclusive };
      if (horizon.start >= horizon.endExclusive) { read(pin, request.knownAt, provider); continue; }
      const result = coordinateSocialSecurity({ householdId: request.householdId, knownAt: request.knownAt,
        horizon, recipients: [original.recipient] });
      read(pin, request.knownAt, provider); // A source race invalidates the entire evaluation.
      const ref = `ssa-original-ref/v1:${sha256(key([pin.publisherId, pin.sourceId, pin.sourceVersion, pin.originalId, pin.digest]))}`;
      const proposals = new Map(result.proposals.map(p => [p.effectiveAt.slice(0, 7), p]));
      const diagnosticCodes = new Map<string, string[]>();
      for (const d of result.diagnostics) {
        const codes = diagnosticCodes.get(d.month) ?? []; codes.push(d.diagnosticCode); diagnosticCodes.set(d.month, codes);
      }
      const accepted: SsaConditionalInstallment[] = [];
      const rows: SsaBindingResult["coverage"][number][] = [];
      for (const row of result.recipientMonths) {
        const proposal = proposals.get(row.month), codes = diagnosticCodes.get(row.month) ?? [];
        if (proposal) {
          try {
            available(proposal.effectiveAt);
            accepted.push({ operationId: `ssa-original-operation/v1:${sha256(proposal.claimId)}`, claimId: proposal.claimId,
              originalRef: ref, recipientPersonId: proposal.recipientPersonId, effectiveAt: proposal.effectiveAt,
              grossAmount: proposal.grossAmount, committed: false, postable: false, bankSettlement: "incomplete",
              taxLiability: "incomplete", affectedOutput: "gross_schedule", coverage: "conditional" });
          } catch (e) { codes.push(e instanceof Refused ? e.code : "INVALID_ORIGINAL"); }
        }
        const start = civilDate(`${row.month}-01`), year = Number(row.month.slice(0, 4)), month = Number(row.month.slice(5, 7));
        const endExclusive = civilDate(`${String(month === 12 ? year + 1 : year).padStart(4, "0")}-${String(month === 12 ? 1 : month + 1).padStart(2, "0")}-01`);
        rows.push({ sourceId: pin.sourceId, originalId: pin.originalId, recipientPersonId: row.recipientPersonId,
          period: { start: start < horizon.start ? horizon.start : start, endExclusive: endExclusive > horizon.endExclusive ? horizon.endExclusive : endExclusive },
          affectedOutput: "gross_schedule", coverage: codes.length ? "incomplete" : row.coverage === "complete" ? "conditional" : row.coverage,
          diagnosticCodes: unique(codes) });
      }
      if (accepted.length) originals.push({ referenceId: ref, publisherId: pin.publisherId, sourceId: pin.sourceId,
        sourceVersion: pin.sourceVersion, originalId: pin.originalId, digest: pin.digest,
        traceRefs: unique(result.proposals.flatMap(p => p.traceRefs)) });
      installments.push(...accepted);
      coverage.push(...rows);
    } catch (e) { fail(pin, e instanceof Refused ? e.code : "INVALID_ORIGINAL"); }
  }
  // Publication order is not economic order. Sort the derived, locally-owned
  // rows by their economic dates so a later-known survivor original cannot
  // appear ahead of an earlier payable retirement installment. Tie-break by
  // identity, never by provider enumeration or forecast horizon.
  installments.sort((a, b) => compare(a.effectiveAt, b.effectiveAt)
    || compare(a.recipientPersonId, b.recipientPersonId) || compare(a.claimId, b.claimId));
  coverage.sort((a, b) => compare(a.period.start, b.period.start)
    || compare(a.recipientPersonId, b.recipientPersonId) || compare(a.sourceId, b.sourceId));
  return immutableConfiguration({ contract: "ssa-original-binding/v1", originals, installments, coverage });
}
