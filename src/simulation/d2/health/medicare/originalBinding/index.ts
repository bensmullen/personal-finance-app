import { sha256 } from "../../../../../rules/tax/t1b/contentIdentity.js";
import { civilDate, instant, type CivilDate, type Instant } from "../../../../../time/index.js";
import { Money } from "../../../../../values/index.js";
import type { EffectivePeriod, PremiumSource } from "../../premiums/index.js";
import { evaluateIrmaa, type HistoricalIncome, type IrmaaOverride, type IrmaaRule,
  type MedicareEnrollment, type MedicarePart } from "../index.js";

export interface OriginalQuery {
  readonly householdId: string;
  readonly personId: string;
  readonly birthDate: CivilDate;
  readonly coverageId: string;
  readonly part: MedicarePart;
  readonly premiumTaxYear: number;
  readonly period: EffectivePeriod;
  readonly eventAt: Instant;
  readonly knownAt: Instant;
}
export interface OriginalIdentity {
  readonly issuer: "CMS" | "SSA" | "IRS";
  readonly sourceId: string;
  readonly version: string;
  readonly claimId: string;
  readonly publishedAt: Instant;
  readonly knownAt: Instant;
}
/** Full original content is digested, never emitted. This is not authentication. */
export interface Original<T> extends OriginalIdentity {
  readonly value: T;
  readonly publication: string;
  readonly supersedes: readonly string[];
}
export interface OriginalInventory<T> {
  readonly query: OriginalQuery;
  readonly complete: boolean;
  readonly originals: readonly Original<T>[];
}
export interface OriginalRule {
  readonly rule: IrmaaRule;
  readonly permittedLifeEvents: readonly string[];
}
export interface OriginalEnrollment {
  readonly enrollment: MedicareEnrollment;
  readonly birthDate: CivilDate;
  readonly eligible: boolean;
  /** Source-owned legal eligibility dates, including non-age eligibility. */
  readonly eligibility: EffectivePeriod;
}
export interface OriginalReturn {
  readonly income: HistoricalIncome;
  readonly filedAt: Instant;
  readonly status: "filed" | "draft";
}
export interface OriginalDetermination {
  readonly override: IrmaaOverride;
  readonly granted: boolean;
  readonly legalBasis: string;
  readonly lifeEventClaimId: string;
}
export interface OriginalLifeEvent {
  readonly householdId: string;
  readonly personId: string;
  readonly kind: string;
  readonly occurredAt: Instant;
  readonly legalEvidence: string;
}
/** Independent exhaustive inventories include all publishers/revisions, even future-known
 * amendments. Withdrawal returns undefined; an amendment returns changed content.
 * Providers must not echo caller-authored proposals. No default provider. */
export interface IrmaaOriginals {
  readonly rules: (query: OriginalQuery) => OriginalInventory<OriginalRule> | undefined;
  readonly enrollments: (query: OriginalQuery) => OriginalInventory<OriginalEnrollment> | undefined;
  readonly returns: (query: OriginalQuery, legalIncomeYear: number) => OriginalInventory<OriginalReturn> | undefined;
  readonly determinations: (query: OriginalQuery) => OriginalInventory<OriginalDetermination> | undefined;
  readonly lifeEvents: (query: OriginalQuery, claimId: string) => OriginalInventory<OriginalLifeEvent> | undefined;
}
export interface SourcePointer extends OriginalIdentity { readonly digest: string }
export interface SourcedIrmaaCandidate {
  readonly operationId: string;
  readonly claimId: string;
  readonly householdId: string;
  readonly personId: string;
  readonly coverageId: string;
  readonly planId: string;
  readonly part: MedicarePart;
  readonly period: EffectivePeriod;
  readonly eventAt: Instant;
  readonly knownAt: Instant;
  readonly taxYear: number;
  readonly incomeTaxYear: number;
  readonly legalLookbackTaxYear: number;
  readonly monthlySurcharge: Money;
  readonly tierRef: { readonly ruleSnapshotId: string; readonly tierId: string };
  readonly determination: "historical_return" | "qualified_override";
  readonly sources: readonly SourcePointer[];
  /** Compact commitments also retain empty inventories and amendment completeness. */
  readonly inventoryDigests: readonly string[];
  readonly coverage: "conditional";
  readonly committed: false;
  readonly postable: false;
  readonly cashSettlement: "incomplete";
  readonly taxLiability: "incomplete";
}
export interface OriginalDiagnostic {
  readonly operationId: string;
  readonly diagnosticCode: string;
  readonly coverage: "incomplete";
}
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const text = (s: string): boolean => typeof s === "string" && s.trim().length > 0;
// Source arrays are sets; ordering grants no precedence.
const canonical = (v: unknown): string => {
  if (v instanceof Money) return canonical(v.toJSON());
  if (Array.isArray(v)) return `[${v.map(canonical).sort(compare).join(",")}]`;
  if (v !== null && typeof v === "object") return `{${Object.entries(v).sort(([a], [b]) => compare(a, b))
    .map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
};
export const irmaaOriginalDigest = (v: unknown): string => `sha256:${sha256(canonical(v))}`;
const snapshot = <T>(v: T): T => {
  if (v === null || typeof v !== "object" || v instanceof Money) return v;
  if (Array.isArray(v)) return Object.freeze(v.map(snapshot)) as T;
  return Object.freeze(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, snapshot(x)]))) as T;
};
const contains = (a: EffectivePeriod, b: EffectivePeriod): boolean => a.start <= b.start && b.endExclusive <= a.endExclusive;
const validPeriod = (p: EffectivePeriod): boolean => {
  civilDate(p.start); civilDate(p.endExclusive); return p.start < p.endExclusive;
};
const operationId = (q: OriginalQuery): string => JSON.stringify(["original_irmaa", q.householdId, q.personId, q.part, q.period.start.slice(0, 7)]);
const visible = (d: OriginalIdentity, q: OriginalQuery): boolean => {
  instant(d.publishedAt); instant(d.knownAt);
  if (d.publishedAt > d.knownAt) throw new Error("Invalid original chronology");
  return d.knownAt <= q.knownAt && d.knownAt <= q.eventAt;
};
const sourceMatches = (d: OriginalIdentity, s: PremiumSource, q: OriginalQuery): boolean => {
  civilDate(s.asOf);
  return d.sourceId === s.ruleSnapshotId && d.version === s.version
    && s.projectionStatus === "verified" && s.jurisdiction === "US"
    && s.asOf <= q.eventAt.slice(0, 10) && s.asOf <= q.knownAt.slice(0, 10)
    && s.asOf <= d.knownAt.slice(0, 10) && text(s.sourcePublication);
};
const pointer = <T>(d: Original<T>): SourcePointer => ({ issuer: d.issuer, sourceId: d.sourceId,
  version: d.version, claimId: d.claimId, publishedAt: d.publishedAt, knownAt: d.knownAt, digest: irmaaOriginalDigest(d) });

/** Source admission only; unchanged evaluateIrmaa owns every financial calculation. */
export function proposeOriginalIrmaa(input: {
  readonly events: readonly OriginalQuery[];
  readonly originals: IrmaaOriginals;
  readonly deaths: readonly { readonly personId: string; readonly effectiveAt: CivilDate; readonly source: PremiumSource }[];
}) {
  const events = snapshot(input.events), deaths = snapshot(input.deaths);
  const candidates: SourcedIrmaaCandidate[] = [], diagnostics: OriginalDiagnostic[] = [];
  const counts = new Map<string, number>();
  const deathsByPerson = new Map<string, typeof deaths[number][]>();
  for (const d of deaths) {
    civilDate(d.effectiveAt);
    const records = deathsByPerson.get(d.personId) ?? []; records.push(d); deathsByPerson.set(d.personId, records);
  }
  for (const q of events) counts.set(operationId(q), (counts.get(operationId(q)) ?? 0) + 1);
  for (const q of [...events].sort((a, b) => compare(operationId(a), operationId(b)))) {
    const id = operationId(q), before = diagnostics.length;
    const fail = (diagnosticCode: string) => diagnostics.push({ operationId: id, diagnosticCode, coverage: "incomplete" });
    if (counts.get(id) !== 1) { fail("DUPLICATE_SURCHARGE"); continue; }
    const reads: { readonly read: () => unknown; readonly digest: string }[] = [];
    const used: SourcePointer[] = [];
    const inventory = <T>(read: () => OriginalInventory<T> | undefined, code: string): readonly Original<T>[] | undefined => {
      const raw = read();
      if (!raw) { fail(code); return undefined; }
      const inv = snapshot(raw);
      reads.push({ read, digest: irmaaOriginalDigest(inv) });
      if (!inv.complete || canonical(inv.query) !== canonical(q)
        || new Set(inv.originals.map(d => d.claimId)).size !== inv.originals.length
        || inv.originals.some(d => ![d.sourceId, d.version, d.claimId, d.publication].every(text)
          || !["CMS", "SSA", "IRS"].includes(d.issuer)
          || new Set(d.supersedes).size !== d.supersedes.length || d.supersedes.includes(d.claimId))) {
        fail(code); return undefined;
      }
      const known = inv.originals.filter(d => visible(d, q));
      const byClaim = new Map(known.map(d => [d.claimId, d]));
      const retired = new Set<string>();
      for (const d of known) for (const ref of d.supersedes) {
        const prior = byClaim.get(ref);
        if (!prior || prior.issuer !== d.issuer || prior.sourceId !== d.sourceId || prior.knownAt >= d.knownAt) {
          fail(code); return undefined;
        }
        retired.add(ref);
      }
      return known.filter(d => !retired.has(d.claimId));
    };
    const one = <T>(docs: readonly Original<T>[] | undefined, code: string): Original<T> | undefined => {
      if (!docs) return undefined;
      if (docs.length !== 1) { fail(docs.length ? code : code === "RULE_CONFLICT" ? "RULE_REQUIRED"
        : code === "INCOME_CONFLICT" ? "HISTORICAL_INCOME_REQUIRED" : code === "DUPLICATE_SURCHARGE" ? "ENROLLMENT_NOT_ADMITTED" : code); return undefined; }
      const doc = docs[0]!;
      if (used.some(p => p.claimId === doc.claimId)) { fail("SOURCE_IDENTITY_REUSE"); return undefined; }
      used.push(pointer(doc)); return doc;
    };
    try {
      [q.eventAt, q.knownAt].forEach(instant); civilDate(q.birthDate);
      if (![q.householdId, q.personId, q.coverageId].every(text) || !validPeriod(q.period)
        || !["part_b", "part_d"].includes(q.part) || !Number.isSafeInteger(q.premiumTaxYear)
        || q.premiumTaxYear < 1 || q.premiumTaxYear > 9998 || q.birthDate > q.eventAt.slice(0, 10)
        || q.eventAt.slice(0, 10) < q.period.start || q.eventAt.slice(0, 10) >= q.period.endExclusive
        || q.period.start.slice(0, 4) !== String(q.premiumTaxYear)
        || q.period.start.slice(0, 7) !== q.eventAt.slice(0, 7)) {
        fail("ORIGINAL_EVENT_INVALID"); continue;
      }
      const r = one(inventory(() => input.originals.rules(q), "RULE_REQUIRED"), "RULE_CONFLICT");
      const e = one(inventory(() => input.originals.enrollments(q), "ENROLLMENT_NOT_ADMITTED"), "DUPLICATE_SURCHARGE");
      const alternatives = inventory(() => input.originals.determinations(q), "OVERRIDE_NOT_ADMITTED");
      if (!r || !e || !alternatives) continue;
      const rule = r.value.rule, enrollment = e.value.enrollment;
      if (r.issuer !== "CMS" || rule.taxYear !== q.premiumTaxYear || !sourceMatches(r, rule.source, q)
        || !validPeriod(rule.source) || !contains(rule.source, q.period)) fail("RULE_NOT_ADMITTED");
      if (!["CMS", "SSA"].includes(e.issuer) || !sourceMatches(e, enrollment.source, q)
        || enrollment.householdId !== q.householdId || enrollment.personId !== q.personId
        || enrollment.coverageId !== q.coverageId || enrollment.part !== q.part
        || e.value.birthDate !== q.birthDate || !e.value.eligible || !validPeriod(e.value.eligibility)
        || !contains(e.value.eligibility, q.period)) fail("ENROLLMENT_NOT_ADMITTED");
      let histories: HistoricalIncome[] = [], overrides: IrmaaOverride[] = [];
      if (alternatives.length) {
        const a = one(alternatives, "OVERRIDE_CONFLICT");
        if (!a) continue;
        const grant = a.value, o = grant.override;
        const life = one(inventory(() => input.originals.lifeEvents(q, grant.lifeEventClaimId), "LIFE_EVENT_REQUIRED"), "LIFE_EVENT_REQUIRED");
        if (!life) continue;
        instant(life.value.occurredAt);
        if (!["SSA", "CMS"].includes(a.issuer) || a.issuer !== o.authority || !grant.granted || !text(grant.legalBasis)
          || !sourceMatches(a, o.source, q) || o.personId !== q.personId || o.householdId !== q.householdId
          || o.premiumTaxYear !== q.premiumTaxYear || o.applicableRuleSnapshotId !== rule.source.ruleSnapshotId
          || life.claimId !== grant.lifeEventClaimId || o.lifeEventRef !== life.claimId
          || !["SSA", "CMS"].includes(life.issuer) || life.value.personId !== q.personId
          || life.value.householdId !== q.householdId || !text(life.value.legalEvidence)
          || life.value.occurredAt > q.eventAt || !r.value.permittedLifeEvents.includes(life.value.kind)) fail("OVERRIDE_NOT_ADMITTED");
        overrides = [{ ...o, qualification: "verified_legal_determination" }];
      } else {
        const h = one(inventory(() => input.originals.returns(q, rule.lookbackTaxYear), "HISTORICAL_INCOME_REQUIRED"), "INCOME_CONFLICT");
        if (!h) continue;
        instant(h.value.filedAt);
        const income = h.value.income;
        if (h.issuer !== "IRS" || h.value.status !== "filed" || h.value.filedAt > h.publishedAt
          || !sourceMatches(h, income.source, q) || income.personId !== q.personId
          || income.householdId !== q.householdId || income.taxYear !== rule.lookbackTaxYear) fail("INCOME_NOT_ADMITTED");
        histories = [income];
      }
      if (diagnostics.length !== before) continue;
      const memberDeaths = deathsByPerson.get(q.personId) ?? [];
      const evaluated = evaluateIrmaa({ householdId: q.householdId, personIds: [q.personId], period: q.period,
        taxYear: q.premiumTaxYear, enrollments: [enrollment], rules: [rule], histories, overrides, deaths: memberDeaths });
      for (const code of new Set(evaluated.diagnostics.map(d => d.diagnosticCode)))
        if (code !== "TOTAL_AND_SETTLEMENT_OWNER_PENDING") fail(code);
      // The solver owns death/proration gating. This port cannot promote caller
      // death records into original legal evidence or claim not_applicable coverage.
      if (memberDeaths.some(d => d.effectiveAt < q.period.endExclusive)) fail("DEATH_SOURCE_REQUIRED");
      // Re-read all inventories, including empty alternatives and future revisions.
      for (const read of reads) {
        try { if (irmaaOriginalDigest(read.read()) !== read.digest) fail("ORIGINAL_CHANGED"); }
        catch { fail("ORIGINAL_CHANGED"); }
      }
      if (diagnostics.length !== before) continue;
      if (evaluated.candidates.length !== 1 || evaluated.surchargeCoverage !== "complete") { fail("SURCHARGE_REQUIRED"); continue; }
      const c = evaluated.candidates[0]!;
      candidates.push({ operationId: id, claimId: id, householdId: c.householdId, personId: c.personId,
        coverageId: c.coverageId, planId: c.planId, part: c.part, period: c.period, eventAt: q.eventAt, knownAt: q.knownAt,
        taxYear: c.taxYear, incomeTaxYear: c.incomeTaxYear, legalLookbackTaxYear: c.legalLookbackTaxYear,
        monthlySurcharge: c.monthlySurcharge, tierRef: { ruleSnapshotId: c.ruleSnapshotId, tierId: c.tier.id },
        determination: c.determination, sources: used.sort((a, b) => compare(canonical(a), canonical(b))),
        inventoryDigests: reads.map(read => read.digest).sort(compare),
        coverage: "conditional", committed: false, postable: false, cashSettlement: "incomplete", taxLiability: "incomplete" });
    } catch { fail("ORIGINAL_INPUT_INVALID"); }
  }
  return snapshot({ candidates, diagnostics: diagnostics.sort((a, b) => compare(canonical(a), canonical(b))),
    coverage: diagnostics.length ? "incomplete" as const : "conditional" as const,
    committed: false as const, postable: false as const, cashSettlement: "incomplete" as const, taxLiability: "incomplete" as const });
}
