import { civilDate, type CivilDate } from "../../../../../time/index.js";
import { type Money, USD } from "../../../../../values/index.js";
import { evaluateIraConversionYear, type IraOriginalReturnProvenance, type IraRules, type IraSource,
  type IraYearInput } from "../index.js";

export interface IraHistoryQuery {
  readonly personId: string;
  readonly taxYear: number;
  readonly knownAt: CivilDate;
  readonly asOf: CivilDate;
}
export interface IraReturnRevision {
  readonly personId: string;
  readonly taxYear: number;
  readonly filingId: string;
  readonly filingVersion: string;
  readonly filingStatus: string;
  readonly filingKind: "amended" | "corrected" | "superseding" | "unknown";
  readonly revisesFilingId: string;
  readonly status: "filed" | "withdrawn" | "revoked" | "unknown";
  readonly filedAt: CivilDate;
  readonly publishedAt: CivilDate;
  readonly knownAt: CivilDate;
  readonly source: IraSource;
}
export interface IraOriginalReturnHistory {
  readonly query: IraHistoryQuery;
  readonly publisherId: string;
  readonly publisherVersion: string;
  readonly sourcePublication: string;
  readonly authority: "verified_filing_history" | "unverified";
  readonly status: "active" | "withdrawn" | "revoked";
  readonly source: IraSource;
  readonly original?: IraOriginalReturnProvenance;
  readonly originalStatus: "filed" | "withdrawn" | "revoked" | "unknown";
  readonly revisionInventory: {
    readonly completeness: "complete" | "unknown";
    /** Inclusive knowledge cutoff; must equal the requested cutoff. */
    readonly completeThrough: CivilDate;
    readonly checkedAt: CivilDate;
    readonly revisions: readonly IraReturnRevision[];
  };
}
/** Trusted application dependency, supplied separately from authored annual
 * inputs. Its implementation must consult authenticated filing/publisher history,
 * including withdrawals and revisions, as known at query. Do not implement this
 * by echoing an input's original flag, source tag, or digest. This pure consumer
 * does not ingest/authenticate return documents or persist basis. */
export interface IraOriginalReturnProvider {
  readonly publisherId: string;
  readonly publisherVersion: string;
  readonly sourcePublication: string;
  lookupOriginalReturn(query: IraHistoryQuery): IraOriginalReturnHistory | undefined;
}
export interface IraYearChainInput {
  readonly personId: string;
  readonly knownAt: CivilDate;
  readonly asOf: CivilDate;
  readonly years: readonly IraYearInput[];
}
export type IraChainReason = "INVALID_CHAIN_CONTEXT" | "NONCONSECUTIVE_OR_DUPLICATE_YEAR" |
  "DEPENDENT_YEAR_INCOMPLETE" | "DUPLICATE_CROSS_YEAR_OPERATION" | "MISSING_ORIGINAL_PROVENANCE" |
  "MISSING_HISTORY_PROVIDER" | "HISTORY_LOOKUP_FAILED" | "UNQUALIFIED_HISTORY_AUTHORITY" |
  "INCOMPLETE_OR_STALE_REVISION_HISTORY" | "KNOWN_RETURN_REVISION" | "UNQUALIFIED_ORIGINAL_FILING" |
  "ORIGINAL_FILING_MISMATCH" | "BASIS_CONTINUITY_MISMATCH" | "ANNUAL_INCOMPLETE";
export interface IraChainYear {
  readonly personId: string;
  readonly taxYear: number;
  readonly committed: false;
  readonly postable: false;
  readonly coverage: "conditional" | "incomplete";
  readonly reasons: readonly IraChainReason[];
  readonly annualDiagnosticCodes: readonly string[];
  readonly taxLiability: "incomplete";
  readonly funding: "incomplete";
  readonly basisPersistence: "incomplete";
  readonly priorFilingId: string | null;
  readonly priorFilingVersion: string | null;
  readonly priorSourceId: string | null;
  readonly originalFilingId: string | null;
  readonly originalFilingVersion: string | null;
  readonly originalSourceId: string | null;
  readonly ruleSnapshotId: string | null;
  readonly details: null | {
    readonly gross: Money;
    readonly taxable: Money;
    readonly basisRecovered: Money;
    readonly remainingBasis: Money;
    readonly operations: readonly {
      readonly operationId: string;
      readonly transactionId: string;
      readonly gross: Money;
      readonly taxable: Money;
      readonly basisRecovered: Money;
    }[];
  };
}
export interface IraYearChainEvaluation {
  readonly contract: "ira-original-year-chain/v1";
  readonly personId: string;
  readonly knownAt: CivilDate;
  readonly asOf: CivilDate;
  readonly committed: false;
  readonly postable: false;
  readonly coverage: "conditional" | "incomplete";
  readonly reasons: readonly IraChainReason[];
  readonly taxLiability: "incomplete";
  readonly funding: "incomplete";
  readonly basisPersistence: "incomplete";
  readonly years: readonly IraChainYear[];
}

const text = (s: string): boolean => typeof s === "string" && s.trim().length > 0;
const validDate = (d: CivilDate): boolean => { try { civilDate(d); return true; } catch { return false; } };
const sourceKey = (s: IraSource): string => JSON.stringify([s.sourceId, s.sourcePublication, s.personId, s.accountId,
  s.taxYear, s.asOf, s.ruleSnapshotId, s.verification, s.projectionStatus]);
const ruleKey = (r: IraRules): string => JSON.stringify([sourceKey(r.source), r.jurisdiction, r.version, r.ruleFamily,
  r.effectivePeriod.start, r.effectivePeriod.endExclusive, r.filingStatus, r.model, r.ratio, r.annualRounding, r.allocation]);
const filingKey = (p: IraOriginalReturnProvenance): string => JSON.stringify([p.personId, p.taxYear, p.filingId,
  p.filingVersion, p.filingKind, p.filingStatus, p.filedAt, p.publishedAt, p.knownAt, p.revisesFilingId,
  sourceKey(p.source), ruleKey(p.legalSnapshot)]);
const observed = (s: IraSource, q: IraHistoryQuery): boolean => Boolean(s) &&
  [s.sourceId, s.sourcePublication, s.ruleSnapshotId].every(text) && s.personId === q.personId && s.accountId === null &&
  s.taxYear === q.taxYear && s.verification === "verified" && s.projectionStatus === "observed" &&
  validDate(s.asOf) && s.asOf <= q.asOf && s.asOf <= q.knownAt;

class ChainIncomplete extends Error {
  constructor(readonly reason: IraChainReason) { super(reason); }
}
const need = (ok: boolean, reason: IraChainReason): void => { if (!ok) throw new ChainIncomplete(reason); };

function qualify(q: IraHistoryQuery, authored: IraOriginalReturnProvenance,
  provider: IraOriginalReturnProvider | undefined): IraOriginalReturnProvenance {
  need(Boolean(provider), "MISSING_HISTORY_PROVIDER");
  let h: IraOriginalReturnHistory | undefined;
  try { h = provider!.lookupOriginalReturn(Object.freeze({ ...q })); }
  catch { throw new ChainIncomplete("HISTORY_LOOKUP_FAILED"); }
  need(Boolean(h), "HISTORY_LOOKUP_FAILED");
  const history = h!;
  need([provider!.publisherId, provider!.publisherVersion, provider!.sourcePublication].every(text) &&
    history.publisherId === provider!.publisherId && history.publisherVersion === provider!.publisherVersion &&
    history.sourcePublication === provider!.sourcePublication && history.source?.sourcePublication === history.sourcePublication &&
    history.authority === "verified_filing_history" && history.status === "active" && observed(history.source, q) && history.source.asOf === q.asOf &&
    Boolean(history.query) &&
    history.query.personId === q.personId && history.query.taxYear === q.taxYear &&
    history.query.knownAt === q.knownAt && history.query.asOf === q.asOf, "UNQUALIFIED_HISTORY_AUTHORITY");
  const inventory = history.revisionInventory;
  need(Boolean(inventory) && inventory.completeness === "complete" && inventory.completeThrough === q.knownAt &&
    inventory.checkedAt === q.knownAt && validDate(inventory.checkedAt) && Array.isArray(inventory.revisions), "INCOMPLETE_OR_STALE_REVISION_HISTORY");
  // A known revision (including withdrawn/corrected records) is outside the
  // original-only model. Later-known revisions cannot rewrite an earlier run.
  for (const revision of inventory.revisions) {
    need(Boolean(revision) && validDate(revision.knownAt), "INCOMPLETE_OR_STALE_REVISION_HISTORY");
    if (revision.knownAt > q.knownAt) continue;
    throw new ChainIncomplete("KNOWN_RETURN_REVISION");
  }
  const p = history.original;
  need(Boolean(p), "UNQUALIFIED_ORIGINAL_FILING");
  const original = p!;
  need(history.originalStatus === "filed" && original.personId === q.personId && original.taxYear === q.taxYear &&
    original.filingKind === "original" && original.revisesFilingId === null &&
    [original.filingId, original.filingVersion, original.filingStatus].every(text) &&
    [original.filedAt, original.publishedAt, original.knownAt].every(validDate) &&
    original.filedAt >= `${q.taxYear + 1}-01-01` && original.filedAt <= original.publishedAt &&
    original.publishedAt <= original.knownAt && original.knownAt <= q.knownAt && original.publishedAt <= q.asOf &&
    observed(original.source, q) && original.source.sourcePublication === history.sourcePublication &&
    original.source.asOf >= original.publishedAt && history.source.asOf >= original.source.asOf &&
    history.source.ruleSnapshotId === original.source.ruleSnapshotId &&
    Boolean(original.legalSnapshot) && observed(original.legalSnapshot.source, q) &&
    original.legalSnapshot.source.asOf <= original.filedAt &&
    original.carryForwardBasis.currency.equals(USD) && !original.carryForwardBasis.isNegative() &&
    original.carryForwardBasis.amount.fitsScale(USD.minorUnitScale), "UNQUALIFIED_ORIGINAL_FILING");
  need(Boolean(authored.legalSnapshot) && filingKey(original) === filingKey(authored) &&
    original.carryForwardBasis.equals(authored.carryForwardBasis), "ORIGINAL_FILING_MISMATCH");
  return original;
}

/** One person, consecutive annual inputs, independent original-only evidence.
 * Each qualifying year invokes the existing calculator exactly once. No computed
 * carryforward is injected into any annual input or promoted into filing evidence. */
export function evaluateIraBasisYearChain(input: IraYearChainInput,
  provider?: IraOriginalReturnProvider): IraYearChainEvaluation {
  const years: IraChainYear[] = [];
  const contextOK = text(input.personId) && validDate(input.knownAt) && validDate(input.asOf) && input.asOf <= input.knownAt;
  const sorted = [...input.years].sort((a, b) => {
    const byYear = a.taxYear - b.taxYear;
    const aRule = a.rules?.source.ruleSnapshotId ?? "", bRule = b.rules?.source.ruleSnapshotId ?? "";
    return byYear || (aRule < bRule ? -1 : aRule > bRule ? 1 : 0);
  });
  const counts = new Map<number, number>();
  for (const y of sorted) counts.set(y.taxYear, (counts.get(y.taxYear) ?? 0) + 1);
  const operations = new Set<string>(), transactions = new Set<string>();
  // Cache one independent lookup per person/year/cutoff; never copy documents to output.
  const filings = new Map<number, IraOriginalReturnProvenance>();
  const original = (year: number, p: IraOriginalReturnProvenance): IraOriginalReturnProvenance => {
    const cached = filings.get(year);
    if (cached) {
      need(Boolean(p.legalSnapshot) && filingKey(cached) === filingKey(p) && cached.carryForwardBasis.equals(p.carryForwardBasis),
        "ORIGINAL_FILING_MISMATCH");
      return cached;
    }
    const fact = qualify({ personId: input.personId, taxYear: year, knownAt: input.knownAt, asOf: input.asOf }, p, provider);
    filings.set(year, fact);
    return fact;
  };
  let previous: IraChainYear | undefined;
  for (const annual of sorted) {
    let details: IraChainYear["details"] = null;
    const reasons: IraChainReason[] = [], annualDiagnosticCodes: string[] = [];
    let prior: IraOriginalReturnProvenance | undefined, current: IraOriginalReturnProvenance | undefined;
    try {
      need(contextOK && annual.personId === input.personId && annual.currency.equals(USD) &&
        Number.isSafeInteger(annual.taxYear) && annual.taxYear >= 1001 && annual.taxYear < 9999 &&
        annual.knownAt === input.knownAt && annual.asOf === input.asOf, "INVALID_CHAIN_CONTEXT");
      need(counts.get(annual.taxYear) === 1 && (!previous || annual.taxYear === previous.taxYear + 1), "NONCONSECUTIVE_OR_DUPLICATE_YEAR");
      need(!previous || previous.coverage === "conditional", "DEPENDENT_YEAR_INCOMPLETE");
      for (const op of [...annual.distributions, ...annual.basisAdditions]) {
        need(!operations.has(op.operationId) && !transactions.has(op.transactionId), "DUPLICATE_CROSS_YEAR_OPERATION");
      }
      for (const op of [...annual.distributions, ...annual.basisAdditions]) {
        operations.add(op.operationId); transactions.add(op.transactionId);
      }
      need(Boolean(annual.openingBasis?.originalReturn && annual.closeout?.originalReturn), "MISSING_ORIGINAL_PROVENANCE");
      prior = original(annual.taxYear - 1, annual.openingBasis!.originalReturn!);
      current = original(annual.taxYear, annual.closeout!.originalReturn!);
      need(annual.openingBasis!.priorTaxYear === annual.taxYear - 1 && prior.carryForwardBasis.equals(annual.openingBasis!.amount) &&
        (!previous || previous.details!.remainingBasis.equals(prior.carryForwardBasis)), "BASIS_CONTINUITY_MISMATCH");
      const result = evaluateIraConversionYear(annual);
      annualDiagnosticCodes.push(...result.diagnostics.map(d => d.diagnosticCode));
      need(result.yearStatus === "FINAL", "ANNUAL_INCOMPLETE");
      const basis = result.basisProposals[0]!;
      need(basis.carryForwardBasis.equals(current.carryForwardBasis), "BASIS_CONTINUITY_MISMATCH");
      details = Object.freeze({ gross: basis.annualDistributions,
        taxable: basis.annualDistributions.minus(basis.annualBasisRecovered), basisRecovered: basis.annualBasisRecovered,
        remainingBasis: basis.carryForwardBasis,
        operations: Object.freeze(basis.allocations.map(a => Object.freeze({ operationId: a.operationId,
          transactionId: annual.distributions.find(d => d.operationId === a.operationId)!.transactionId,
          gross: a.gross, taxable: a.taxable, basisRecovered: a.basisRecovered }))) });
    } catch (e) {
      if (!(e instanceof ChainIncomplete)) throw e;
      reasons.push(e.reason);
    }
    const row: IraChainYear = Object.freeze({ personId: input.personId, taxYear: annual.taxYear,
      committed: false, postable: false, coverage: reasons.length ? "incomplete" : "conditional",
      reasons: Object.freeze(reasons), annualDiagnosticCodes: Object.freeze(annualDiagnosticCodes),
      taxLiability: "incomplete", funding: "incomplete", basisPersistence: "incomplete",
      priorFilingId: prior?.filingId ?? null, originalFilingId: current?.filingId ?? null,
      priorFilingVersion: prior?.filingVersion ?? null, priorSourceId: prior?.source.sourceId ?? null,
      originalFilingVersion: current?.filingVersion ?? null,
      originalSourceId: current?.source.sourceId ?? null,
      ruleSnapshotId: annual.rules?.source.ruleSnapshotId ?? null, details });
    years.push(row); previous = row;
  }
  return Object.freeze({ contract: "ira-original-year-chain/v1", personId: input.personId,
    knownAt: input.knownAt, asOf: input.asOf, committed: false, postable: false,
    coverage: contextOK && years.length > 0 && years.every(y => y.coverage === "conditional") ? "conditional" : "incomplete",
    reasons: Object.freeze(!contextOK || !years.length ? ["INVALID_CHAIN_CONTEXT" as const] : []),
    taxLiability: "incomplete", funding: "incomplete", basisPersistence: "incomplete", years: Object.freeze(years) });
}
