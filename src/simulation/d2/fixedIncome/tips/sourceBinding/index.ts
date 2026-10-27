import { sha256 } from "../../../../../rules/tax/t1b/contentIdentity.js";
import { civilDate } from "../../../../../time/index.js";
import { canonicalSerialize } from "../../../../run.js";
import { immutableConfiguration } from "../../../../r3/compiledHousehold.js";
import { proposeTips, type TipsCoverage, type TipsLot, type TipsProposal, type TipsRequest, type TipsSource, type TipsTaxFact } from "../index.js";

/** Publisher-owned full evidence; a consumer digest cannot authenticate this port. */
export interface TipsOriginal {
  readonly sourceId: string;
  readonly version: string;
  readonly status: "active" | "withdrawn";
  readonly openingCommit: { readonly checkpointId: string; readonly status: "committed" };
  readonly request: TipsRequest;
}
export type TipsLookup = (sourceId: string, eventCutoff: TipsRequest["effectiveAt"]) => TipsOriginal | undefined;
export type TipsIdentity = Pick<TipsLot, "householdId" | "personId" | "wrapperId" | "securityId" | "issueId" | "holdingId" | "lotId" | "basisId">;
export interface TipsBinding {
  readonly occurrenceId: string;
  readonly sourceId: string;
  readonly sourceVersion: string;
  readonly digest: string;
  readonly identity: TipsIdentity;
  readonly period: TipsRequest["period"];
  readonly effectiveAt: TipsRequest["effectiveAt"];
  readonly knownAt: TipsRequest["knownAt"];
  readonly action: TipsRequest["action"];
}
export type TipsBindingCode = "INVALID_BINDING" | "ORIGINAL_UNAVAILABLE" | "ORIGINAL_CHANGED" | "IDENTITY_MISMATCH"
  | "EVENT_MISMATCH" | "EVIDENCE_AFTER_EVENT" | "OPENING_CONFLICT" | "QUOTE_CONFLICT" | "EVALUATION_INCOMPLETE"
  | "DUPLICATE_OCCURRENCE" | "DUPLICATE_CLAIM";
export type TipsBoundCoverage = Pick<TipsCoverage, "affectedOutput" | "coverage" | "diagnosticCode" | "missingFacts" | "ruleSnapshotId">;
export interface TipsBindingDiagnostic {
  readonly occurrenceId: string;
  readonly sourceId: string;
  readonly code: TipsBindingCode;
  readonly coverage: "incomplete";
  readonly outputs?: readonly TipsBoundCoverage[];
}
export interface TipsConditionalOccurrence {
  readonly contractVersion: "tips-source-binding/v1";
  readonly status: "conditional";
  readonly occurrenceId: string;
  readonly identity: TipsIdentity;
  readonly original: { readonly sourceId: string; readonly version: string; readonly digest: string; readonly checkpointId: string };
  readonly period: TipsRequest["period"];
  readonly eventDate: TipsRequest["effectiveAt"];
  readonly action: TipsRequest["action"];
  readonly committed: false;
  readonly postable: false;
  readonly funding: "incomplete";
  readonly physicalSettlement: "incomplete";
  readonly taxLiability: "incomplete";
  readonly economics: readonly (Pick<TipsProposal, "kind" | "grossAmount" | "originalPrincipal" | "adjustedPrincipal" | "referenceCpi" | "indexRatio"
    | "cashDelta" | "assetDelta" | "basisDelta" | "netWorthDelta" | "recognitionFacts"> & {
      readonly operationId: string;
      readonly claimId: string;
      readonly dependsOn: readonly string[];
      readonly taxCharacter: readonly Omit<TipsTaxFact, "source">[];
    })[];
  readonly traceRefs: readonly string[];
  readonly coverage: readonly TipsBoundCoverage[];
}
export interface TipsBindingResult {
  readonly occurrences: readonly TipsConditionalOccurrence[];
  readonly diagnostics: readonly TipsBindingDiagnostic[];
}
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const same = (a: unknown, b: unknown): boolean => canonicalSerialize(a) === canonicalSerialize(b);
const id = (s: string): boolean => typeof s === "string" && s.trim().length > 0 && s.length <= 200;
const hash = (value: unknown): string => sha256(canonicalSerialize(value));
const sorted = <T>(rows: readonly T[]): T[] => [...rows].sort((a, b) => compare(canonicalSerialize(a), canonicalSerialize(b)));
/** Sort evidence sets without eliminating conflicting duplicate observations. */
const normalized = (r: TipsRequest): TipsRequest => ({ ...r,
  observations: sorted(r.observations), taxRules: sorted(r.taxRules), lot: { ...r.lot, couponDates: sorted(r.lot.couponDates) },
  ...(r.rule ? { rule: { ...r.rule, couponPeriods: sorted(r.rule.couponPeriods) } } : {}),
});
export const tipsOriginalDigest = (o: TipsOriginal): string =>
  `tips-original/v1:sha256:${hash({ ...o, request: normalized(o.request) })}`;
export const tipsOriginalIdentity = (lot: TipsLot): TipsIdentity => immutableConfiguration({
  householdId: lot.householdId, personId: lot.personId, wrapperId: lot.wrapperId, securityId: lot.securityId,
  issueId: lot.issueId, holdingId: lot.holdingId, lotId: lot.lotId, basisId: lot.basisId,
});
const compact = (rows: readonly TipsCoverage[]): TipsBoundCoverage[] => rows.map(
  ({ affectedOutput, coverage, diagnosticCode, missingFacts, ruleSnapshotId }) =>
    ({ affectedOutput, coverage, diagnosticCode, missingFacts, ruleSnapshotId }));
class Refused extends Error {
  constructor(readonly code: TipsBindingCode) { super(code); }
}
const requireFact = (ok: boolean, code: TipsBindingCode): void => { if (!ok) throw new Refused(code); };
// A changed basis or security cannot turn the same holding/lot into an independent position.
const position = (i: TipsIdentity): unknown => [i.householdId, i.personId, i.wrapperId, i.holdingId, i.lotId];

/** Pure conditional batch; no durable claim reservation or physical posting authority. */
export const bindTipsSources = (bindings: readonly TipsBinding[], lookup: TipsLookup): TipsBindingResult => {
  const pins = immutableConfiguration(bindings);
  const diagnostics: TipsBindingDiagnostic[] = [];
  const candidates: { pin: TipsBinding; original: TipsOriginal; occurrence: TipsConditionalOccurrence }[] = [];
  const openingEvidence: { pin: TipsBinding; original: TipsOriginal }[] = [];
  const fail = (b: TipsBinding, code: TipsBindingCode, outputs?: readonly TipsBoundCoverage[]): void => {
    diagnostics.push({ occurrenceId: b.occurrenceId, sourceId: b.sourceId, code, coverage: "incomplete", ...(outputs ? { outputs } : {}) });
  };
  const occurrences = new Map<string, number>();
  const claims = new Map<string, number>();
  const eventKey = (b: TipsBinding): string => hash([position(b.identity), b.effectiveAt]);
  for (const b of pins) {
    occurrences.set(b.occurrenceId, (occurrences.get(b.occurrenceId) ?? 0) + 1);
    claims.set(eventKey(b), (claims.get(eventKey(b)) ?? 0) + 1);
  }
  for (const b of sorted(pins)) {
    try {
      requireFact([b.occurrenceId, b.sourceId, b.sourceVersion, ...Object.values(b.identity)].every(id)
        && /^tips-original\/v1:sha256:[a-f0-9]{64}$/.test(b.digest), "INVALID_BINDING");
      for (const d of [b.period.start, b.period.endExclusive, b.effectiveAt, b.knownAt]) civilDate(d);
      requireFact(b.period.start < b.effectiveAt && b.effectiveAt < b.period.endExclusive && b.effectiveAt <= b.knownAt, "INVALID_BINDING");
      requireFact(occurrences.get(b.occurrenceId) === 1, "DUPLICATE_OCCURRENCE");
      requireFact(claims.get(eventKey(b)) === 1, "DUPLICATE_CLAIM");
      const read = (): TipsOriginal => {
        let fetched: TipsOriginal | undefined;
        try { fetched = lookup(b.sourceId, b.effectiveAt); } catch { throw new Refused("ORIGINAL_UNAVAILABLE"); }
        requireFact(fetched !== undefined && fetched.status === "active", "ORIGINAL_UNAVAILABLE");
        const o = immutableConfiguration(fetched!);
        requireFact(o.sourceId === b.sourceId && o.version === b.sourceVersion && tipsOriginalDigest(o) === b.digest, "ORIGINAL_CHANGED");
        return o;
      };
      const original = read();
      const r = normalized(original.request);
      requireFact(same(tipsOriginalIdentity(r.lot), b.identity), "IDENTITY_MISMATCH");
      requireFact(r.action === b.action && r.effectiveAt === b.effectiveAt && r.knownAt === b.knownAt && same(r.period, b.period), "EVENT_MISMATCH");
      requireFact(original.openingCommit.status === "committed" && id(original.openingCommit.checkpointId), "OPENING_CONFLICT");
      const available = (s: TipsSource, at: TipsRequest["effectiveAt"]): boolean => s.publishedAt <= at && s.asOf <= at;
      requireFact(available(r.lot.source, b.effectiveAt) && available(r.lot.opening.source, r.lot.opening.at)
        && (!r.rule || (available(r.rule.source, r.lot.opening.at) && available(r.rule.base.source, r.lot.opening.at)))
        && (!r.couponQuote || available(r.couponQuote.source, b.effectiveAt)), "EVIDENCE_AFTER_EVENT");
      civilDate(r.lot.opening.at);
      openingEvidence.push({ pin: b, original });
      const evaluated = proposeTips({ ...r, knownAt: b.effectiveAt });
      read(); // Re-read even after incomplete evaluation.
      const coverage = compact(evaluated.coverage);
      if (evaluated.proposals.length === 0) {
        fail(b, "EVALUATION_INCOMPLETE", coverage); continue;
      }
      const coupon = evaluated.proposals.find(p => p.kind === "computed_coupon" || p.kind === "quoted_coupon");
      if (r.couponQuote) {
        const q = r.couponQuote;
        for (const d of [q.paymentDate, q.source.start, q.source.endExclusive, q.source.publishedAt, q.source.asOf]) civilDate(d);
        requireFact(coupon !== undefined && q.paymentDate === b.effectiveAt && id(q.quoteId)
          && q.source.projectionStatus === "verified" && q.source.ruleFamily === "tips"
          && [q.source.sourceId, q.source.version, q.source.ruleSnapshotId, q.source.sourcePublication, q.source.jurisdiction].every(s => typeof s === "string" && s.trim().length > 0)
          && q.source.start <= b.effectiveAt && b.effectiveAt < q.source.endExclusive
          && q.source.publishedAt <= q.source.asOf && q.amount.equals(coupon.grossAmount), "QUOTE_CONFLICT");
      }
      const economics: TipsConditionalOccurrence["economics"] = evaluated.proposals.map(p => {
        const { kind, grossAmount, originalPrincipal, adjustedPrincipal, referenceCpi, indexRatio, cashDelta, assetDelta, basisDelta, netWorthDelta, recognitionFacts } = p;
        return { kind: kind === "computed_coupon" && r.couponQuote ? "quoted_coupon" : kind,
          operationId: `tips-operation/v1:${hash(p.operationId)}`, claimId: `tips-claim/v1:${hash(p.claimId)}`,
          dependsOn: p.dependsOn.map(d => `tips-operation/v1:${hash(d)}`), grossAmount, originalPrincipal, adjustedPrincipal,
          referenceCpi, indexRatio, cashDelta, assetDelta, basisDelta, netWorthDelta, recognitionFacts,
          taxCharacter: p.taxFacts.map(({ source: _source, ...fact }) => fact) };
      });
      requireFact(economics.every(e => e.taxCharacter.every(t => [t.jurisdiction, t.lawVersion, t.ruleSnapshotId].every(id)))
        && coverage.every(c => c.ruleSnapshotId === null || id(c.ruleSnapshotId)), "INVALID_BINDING");
      if (r.couponQuote && coupon?.kind === "computed_coupon") {
        const i = coverage.findIndex(c => c.affectedOutput === "computed_coupon");
        coverage[i] = { ...coverage[i]!, coverage: "not_applicable" };
        const j = coverage.findIndex(c => c.affectedOutput === "quoted_coupon");
        coverage[j] = { ...coverage[j]!, coverage: "complete" };
      }
      const refs = new Set(evaluated.proposals.flatMap(p => p.traceRefs));
      if (r.couponQuote) { refs.add(r.couponQuote.quoteId); refs.add(r.couponQuote.source.sourceId); }
      requireFact(refs.size <= 32 && [...refs].every(id), "INVALID_BINDING");
      candidates.push({ pin: b, original, occurrence: {
        contractVersion: "tips-source-binding/v1", status: "conditional", occurrenceId: b.occurrenceId, identity: b.identity,
        original: { sourceId: b.sourceId, version: b.sourceVersion, digest: b.digest, checkpointId: original.openingCommit.checkpointId },
        period: b.period, eventDate: b.effectiveAt, action: b.action, committed: false, postable: false,
        funding: "incomplete", physicalSettlement: "incomplete", taxLiability: "incomplete", economics,
        traceRefs: [...refs].sort(compare), coverage,
      } });
    } catch (e) { fail(b, e instanceof Refused ? e.code : "INVALID_BINDING"); }
  }
  const openings = new Map<string, Set<string>>();
  for (const c of openingEvidence) {
    const l = c.original.request.lot;
    const key = hash([position(c.pin.identity), l.opening.at]);
    const values = openings.get(key) ?? new Set<string>();
    values.add(hash([c.pin.identity, c.original.openingCommit, l.opening])); openings.set(key, values);
  }
  return immutableConfiguration({ occurrences: candidates.filter(c => {
    const key = hash([position(c.pin.identity), c.original.request.lot.opening.at]);
    if (openings.get(key)!.size !== 1) { fail(c.pin, "OPENING_CONFLICT"); return false; }
    // Reusing an opening across overlapping economic intervals is not independent indexation.
    if (openingEvidence.some(other => other.pin !== c.pin && same(position(other.pin.identity), position(c.pin.identity))
      && other.original.request.lot.opening.at < c.pin.effectiveAt
      && c.original.request.lot.opening.at < other.pin.effectiveAt)) {
      fail(c.pin, "DUPLICATE_CLAIM"); return false;
    }
    return true;
  }).map(c => c.occurrence), diagnostics: sorted(diagnostics) });
};
