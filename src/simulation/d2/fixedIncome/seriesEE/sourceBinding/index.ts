import { sha256 } from "../../../../../rules/tax/t1b/contentIdentity.js";
import { canonicalSerialize } from "../../../../run.js";
import { immutableConfiguration } from "../../../../r3/compiledHousehold.js";
import { proposeSeriesEE, type EECoverage, type EELot, type EEProposal, type EERequest, type EETaxFact } from "../index.js";

/** Publisher boundary supplied independently of consumer bindings, never serialized. */
export interface EEOriginal {
  readonly sourceId: string;
  readonly version: string;
  readonly status: "active" | "withdrawn";
  readonly request: EERequest;
}
export type EELookup = (sourceId: string) => EEOriginal | undefined;
export type EEOriginalIdentity = Omit<EELot, "source" | "opening">;
export interface EEBinding {
  readonly occurrenceId: string;
  readonly sourceId: string;
  readonly sourceVersion: string;
  readonly digest: string;
  readonly identity: EEOriginalIdentity;
  readonly action: EERequest["action"];
  readonly effectiveAt: EERequest["effectiveAt"];
  readonly knownAt: EERequest["knownAt"];
  readonly period: EERequest["period"];
}
export type EEBindingCode = "INVALID_BINDING" | "ORIGINAL_UNAVAILABLE" | "ORIGINAL_CHANGED"
  | "IDENTITY_MISMATCH" | "EVENT_MISMATCH" | "EVALUATION_INCOMPLETE" | "DUPLICATE_OCCURRENCE" | "DUPLICATE_CLAIM";
export interface EEBindingDiagnostic {
  readonly seam: "S7";
  readonly occurrenceId: string;
  readonly sourceId: string;
  readonly coverage: "incomplete";
  readonly code: EEBindingCode;
  readonly outputs?: readonly EEBoundCoverage[];
}
/** Trace IDs are shared once on the containing occurrence, not per output. */
export type EEBoundCoverage = Pick<EECoverage, "affectedOutput" | "coverage" | "diagnosticCode" | "missingFacts" | "ruleSnapshotId">;
export type EEBoundTaxCharacter = Omit<EETaxFact, "source">;
export interface EEConditionalOccurrence {
  readonly contractVersion: "ee-source-binding/v1";
  readonly occurrenceId: string;
  readonly sourceId: string;
  readonly sourceVersion: string;
  readonly digest: string;
  readonly committed: false;
  readonly postable: false;
  readonly funding: "incomplete";
  readonly physicalRedemption: "incomplete";
  readonly operationId: string;
  /** Conditional exclusive lot claim; #149 must enforce durable exclusivity. */
  readonly claimId: string;
  readonly kind: EEProposal["kind"];
  readonly eventDate: EERequest["effectiveAt"];
  readonly summary: Pick<EEProposal, "grossAmount" | "cashDelta" | "assetDelta" | "basisDelta" | "netWorthDelta" | "redeemedPrincipal" | "recognitionFacts" | "values">;
  readonly taxCharacter: readonly EEBoundTaxCharacter[];
  readonly traceRefs: readonly string[];
  readonly coverage: readonly EEBoundCoverage[];
}
export interface EEBindingResult {
  readonly occurrences: readonly EEConditionalOccurrence[];
  readonly diagnostics: readonly EEBindingDiagnostic[];
}

/** Complete original content evidence, not publisher authentication or legal approval. */
export const eeRequestDigest = (original: EERequest): string =>
  `ee-request/v1:sha256:${sha256(canonicalSerialize(original))}`;
const digestPattern = /^ee-request\/v1:sha256:[a-f0-9]{64}$/;
const same = (a: unknown, b: unknown): boolean => canonicalSerialize(a) === canonicalSerialize(b);
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const nonblank = (s: string): boolean => typeof s === "string" && s.trim().length > 0;
const compactCoverage = (rows: readonly EECoverage[]): EEBoundCoverage[] => rows.map(
  ({ affectedOutput, coverage, diagnosticCode, missingFacts, ruleSnapshotId }) =>
    ({ affectedOutput, coverage, diagnosticCode, missingFacts, ruleSnapshotId }));
export const eeOriginalIdentity = (lot: EELot): EEOriginalIdentity => {
  const { source: _source, opening: _opening, ...identity } = lot;
  return immutableConfiguration(identity);
};
class BindingFailure extends Error {
  constructor(readonly code: EEBindingCode) { super(code); }
}
const requireBinding = (ok: boolean, code: EEBindingCode): void => { if (!ok) throw new BindingFailure(code); };

/** Pure, bounded batch. No original catalogs, callback, or evaluator proposals escape. */
export const bindSeriesEESources = (bindings: readonly EEBinding[], lookup: EELookup): EEBindingResult => {
  const pins = immutableConfiguration(bindings);
  const candidates: EEConditionalOccurrence[] = [];
  const diagnostics: EEBindingDiagnostic[] = [];
  const fail = (b: Pick<EEBinding, "occurrenceId" | "sourceId">, code: EEBindingCode): void => {
    diagnostics.push({ seam: "S7", occurrenceId: b.occurrenceId, sourceId: b.sourceId, coverage: "incomplete", code });
  };
  const counts = new Map<string, number>();
  for (const b of pins) counts.set(b.occurrenceId, (counts.get(b.occurrenceId) ?? 0) + 1);
  for (const b of [...pins].sort((a, c) => compare(a.occurrenceId, c.occurrenceId) || compare(a.sourceId, c.sourceId))) {
    try {
      requireBinding([b.occurrenceId, b.sourceId, b.sourceVersion].every(nonblank) && digestPattern.test(b.digest), "INVALID_BINDING");
      requireBinding(counts.get(b.occurrenceId) === 1, "DUPLICATE_OCCURRENCE");
      const read = (): EEOriginal => {
        let fetched: EEOriginal | undefined;
        try { fetched = lookup(b.sourceId); } catch { throw new BindingFailure("ORIGINAL_UNAVAILABLE"); }
        requireBinding(fetched !== undefined && fetched.status === "active", "ORIGINAL_UNAVAILABLE");
        const original = immutableConfiguration(fetched!);
        requireBinding(original.sourceId === b.sourceId && original.version === b.sourceVersion
          && eeRequestDigest(original.request) === b.digest, "ORIGINAL_CHANGED");
        return original;
      };
      const request = read().request;
      requireBinding(same(eeOriginalIdentity(request.lot), b.identity), "IDENTITY_MISMATCH");
      requireBinding(request.action === b.action && request.effectiveAt === b.effectiveAt && request.knownAt === b.knownAt
        && same(request.period, b.period), "EVENT_MISMATCH");
      const evaluated = proposeSeriesEE(request);
      // Re-read even on incomplete evaluation: stale originals admit no event.
      read();
      const proposal = evaluated.proposals[0];
      if (!proposal) {
        diagnostics.push({ seam: "S7", occurrenceId: b.occurrenceId, sourceId: b.sourceId,
          coverage: "incomplete", code: "EVALUATION_INCOMPLETE", outputs: compactCoverage(evaluated.coverage) });
        continue;
      }
      const { grossAmount, cashDelta, assetDelta, basisDelta, netWorthDelta, redeemedPrincipal, recognitionFacts, values } = proposal;
      candidates.push({ contractVersion: "ee-source-binding/v1", occurrenceId: b.occurrenceId,
        sourceId: b.sourceId, sourceVersion: b.sourceVersion, digest: b.digest,
        committed: false, postable: false, funding: "incomplete", physicalRedemption: "incomplete",
        operationId: proposal.operationId, claimId: proposal.claimId, kind: proposal.kind, eventDate: proposal.effectiveAt,
        summary: { grossAmount, cashDelta, assetDelta, basisDelta, netWorthDelta, redeemedPrincipal, recognitionFacts, values },
        taxCharacter: proposal.taxFacts.map(({ source: _source, ...fact }) => fact), traceRefs: proposal.traceRefs,
        coverage: compactCoverage(evaluated.coverage) });
    } catch (e) { fail(b, e instanceof BindingFailure ? e.code : "INVALID_BINDING"); }
  }
  // Reject every colliding candidate; input order cannot select an economic winner.
  const claims = new Map<string, number>();
  for (const c of candidates) claims.set(c.claimId, (claims.get(c.claimId) ?? 0) + 1);
  const occurrences = candidates.filter(c => {
    if (claims.get(c.claimId) === 1) return true;
    fail(c, "DUPLICATE_CLAIM"); return false;
  });
  return immutableConfiguration({ occurrences,
    diagnostics: diagnostics.sort((a, b) => compare(canonicalSerialize(a), canonicalSerialize(b))) });
};
