import { describe, expect, it } from "vitest";
import { civilDate, instant } from "../../../../../src/time/index.js";
import { money } from "../../../../../src/values/index.js";
import type { PremiumSource } from "../../../../../src/simulation/d2/health/premiums/index.js";
import { irmaaOriginalDigest, proposeOriginalIrmaa, type IrmaaOriginals, type Original,
  type OriginalDetermination, type OriginalEnrollment, type OriginalInventory, type OriginalLifeEvent,
  type OriginalQuery, type OriginalReturn, type OriginalRule } from "../../../../../src/simulation/d2/health/medicare/originalBinding/index.js";

const span = (start = "2026-01-01", endExclusive = "2027-01-01") => ({ start: civilDate(start), endExclusive: civilDate(endExclusive) });
const query = (patch: Partial<OriginalQuery> = {}): OriginalQuery => ({ householdId: "h", personId: "alice",
  birthDate: civilDate("1950-05-09"), coverageId: "coverage", part: "part_b", premiumTaxYear: 2026,
  period: span("2026-01-01", "2026-02-01"), eventAt: instant("2026-01-01T00:00:00.000Z"),
  knownAt: instant("2026-01-01T00:00:00.000Z"), ...patch });
const source = (id: string, family: string, period = span()): PremiumSource => ({ ...period, ruleSnapshotId: id,
  jurisdiction: "US", ruleFamily: family, sourcePublication: "synthetic original only; NOT current CMS law",
  asOf: civilDate("2025-11-01"), version: "v1", projectionStatus: "verified" });
const doc = <T>(id: string, issuer: Original<T>["issuer"], value: T): Original<T> => ({ sourceId: id, issuer,
  version: "v1", claimId: `${id}-claim`, publishedAt: instant("2025-11-01T00:00:00.000Z"),
  knownAt: instant("2025-11-02T00:00:00.000Z"), value, supersedes: [], publication: `raw original ${id} ${"x".repeat(1024)}` });
const rule = (): Original<OriginalRule> => doc("rule", "CMS", { permittedLifeEvents: ["retirement"], rule: {
  source: source("rule", "cms_irmaa"), taxYear: 2026, lookbackTaxYear: 2024, currency: "USD", monthlyConvention: "whole_month_only",
  tables: [{ filingStatus: "single", maritalState: "unmarried", tiers: [
    { id: "low", lower: null, lowerInclusive: false, upper: money("170"), upperInclusive: true,
      partBMonthly: money("0"), partDMonthly: money("0") },
    { id: "middle", lower: money("170"), lowerInclusive: false, upper: money("410"), upperInclusive: false,
      partBMonthly: money("17.13"), partDMonthly: money("3.27") },
    { id: "high", lower: money("410"), lowerInclusive: true, upper: null, upperInclusive: false,
      partBMonthly: money("49.81"), partDMonthly: money("9.06") },
  ] }] } });
const enrolled = (q = query()): Original<OriginalEnrollment> => doc("enrollment", "CMS", {
  birthDate: q.birthDate, eligible: true, eligibility: span(), enrollment: { ...span(), householdId: q.householdId,
    personId: q.personId, coverageId: q.coverageId, part: q.part, planId: "plan", elected: [q.part],
    source: source("enrollment", "medicare_enrollment") } });
const taxReturn = (magi = "250", q = query()): Original<OriginalReturn> => doc("return", "IRS", {
  status: "filed", filedAt: instant("2025-04-01T00:00:00.000Z"), income: {
    householdId: q.householdId, personId: q.personId, taxYear: 2024, taxReturnRef: "filed-return-2024",
    filingStatus: "single", maritalState: "unmarried", magi: money(magi),
    source: source("return", "historical_tax_return", span("2024-01-01", "2025-01-01")) } });
const grant = (): Original<OriginalDetermination> => doc("grant", "SSA", { granted: true,
  legalBasis: "synthetic independently published grant under test law", lifeEventClaimId: "event-claim", override: {
    ...span(), householdId: "h", personId: "alice", taxYear: 2025, premiumTaxYear: 2026, incomeReference: "approved-income",
    determinationId: "ssa-grant", authority: "SSA", qualification: "unqualified", applicableRuleSnapshotId: "rule",
    lifeEventRef: "event-claim", magi: money("410"), filingStatus: "single", maritalState: "unmarried",
    source: source("grant", "irmaa_override") } });
const life = (): Original<OriginalLifeEvent> => doc("event", "SSA", { householdId: "h", personId: "alice", kind: "retirement",
  occurredAt: instant("2025-10-01T00:00:00.000Z"), legalEvidence: "original retirement legal evidence" });
const inv = <T>(q: OriginalQuery, originals: readonly Original<T>[]): OriginalInventory<T> => ({ query: q, originals, complete: true });
const provider = (magi = "250", patch: Partial<IrmaaOriginals> = {}): IrmaaOriginals => ({
  rules: q => inv(q, [rule()]), enrollments: q => inv(q, [enrolled(q)]), returns: (q, year) => {
    expect(year).toBe(2024); return inv(q, [taxReturn(magi, q)]);
  }, determinations: q => inv(q, []), lifeEvents: q => inv(q, [life()]), ...patch });
const run = (originals = provider(), events = [query()]) => proposeOriginalIrmaa({ originals, events, deaths: [] });
const blocked = (p: IrmaaOriginals, code: string, events = [query()]) => {
  const result = run(p, events);
  expect(result.candidates).toEqual([]);
  expect(result.coverage).toBe("incomplete");
  expect(result.diagnostics.map(d => d.diagnosticCode)).toContain(code);
};

describe("independently admitted original Medicare IRMAA", () => {
  // Fixed amounts authored independently of the unchanged evaluator or any catalog.
  it.each([
    ["-0.01", "low", "0", "0"], ["169.99", "low", "0", "0"], ["170", "low", "0", "0"],
    ["170.01", "middle", "17.13", "3.27"], ["409.99", "middle", "17.13", "3.27"],
    ["410", "high", "49.81", "9.06"], ["410.01", "high", "49.81", "9.06"],
  ])("uses exact historical MAGI %s at equality/adjacent cents", (magi, tier, b, d) => {
    for (const [part, expected] of [["part_b", b], ["part_d", d]] as const) {
      const result = run(provider(magi), [query({ part })]);
      expect(result.coverage).toBe("conditional"); expect(result.candidates).toHaveLength(1);
      const c = result.candidates[0]!;
      expect(c.monthlySurcharge.equals(money(expected))).toBe(true);
      expect(c.tierRef).toEqual({ ruleSnapshotId: "rule", tierId: tier });
      expect(c.incomeTaxYear).toBe(2024); expect(c.legalLookbackTaxYear).toBe(2024);
      expect(c.determination).toBe("historical_return");
      expect(c).toMatchObject({ committed: false, postable: false, cashSettlement: "incomplete", taxLiability: "incomplete" });
      expect(c.sources.map(s => s.issuer).sort()).toEqual(["CMS", "CMS", "IRS"]);
      expect(c.sources.every(s => /^sha256:[a-f0-9]{64}$/.test(s.digest))).toBe(true);
    }
  });

  it("derives alternate qualification only from the independent grant and lawful life event", () => {
    const p = provider("0", { determinations: q => inv(q, [grant()]), returns: () => { throw new Error("not needed"); } });
    const c = run(p).candidates[0]!;
    expect(c.monthlySurcharge.equals(money("49.81"))).toBe(true);
    expect(c.incomeTaxYear).toBe(2025); expect(c.legalLookbackTaxYear).toBe(2024);
    expect(c.determination).toBe("qualified_override");
    expect(c.sources.map(s => s.claimId)).toContain("event-claim");
    for (const bad of [
      { ...grant(), value: { ...grant().value, granted: false, override: { ...grant().value.override, qualification: "verified_legal_determination" as const } } },
      { ...grant(), value: { ...grant().value, legalBasis: "" } },
      { ...grant(), issuer: "IRS" as const },
      { ...grant(), value: { ...grant().value, override: { ...grant().value.override, applicableRuleSnapshotId: "other" } } },
    ]) blocked(provider("0", { determinations: q => inv(q, [bad]) }), "OVERRIDE_NOT_ADMITTED");
    blocked(provider("0", { determinations: q => inv(q, [grant()]), lifeEvents: () => undefined }), "LIFE_EVENT_REQUIRED");
    blocked(provider("0", { determinations: q => inv(q, [grant()]), lifeEvents: q => inv(q, [
      { ...life(), value: { ...life().value, kind: "self_attested_income_decline" } },
    ]) }), "OVERRIDE_NOT_ADMITTED");
  });

  it("rejects birth/eligibility/coverage/member mismatches independently of caller attestation", () => {
    for (const bad of [
      { ...enrolled(), value: { ...enrolled().value, birthDate: civilDate("1951-05-09") } },
      { ...enrolled(), value: { ...enrolled().value, eligible: false } },
      { ...enrolled(), value: { ...enrolled().value, eligibility: span("2026-02-01") } },
      { ...enrolled(), value: { ...enrolled().value, enrollment: { ...enrolled().value.enrollment, coverageId: "other" } } },
      { ...enrolled(), value: { ...enrolled().value, enrollment: { ...enrolled().value.enrollment, personId: "bob" } } },
    ]) blocked(provider("250", { enrollments: q => inv(q, [bad]) }), "ENROLLMENT_NOT_ADMITTED");
    for (const income of [
      { ...taxReturn().value.income, personId: "bob" }, { ...taxReturn().value.income, householdId: "other" },
    ]) blocked(provider("250", { returns: q => inv(q, [{ ...taxReturn(), value: { ...taxReturn().value, income } }]) }), "INCOME_NOT_ADMITTED");
    blocked(provider("250", { returns: q => inv(q, [{ ...taxReturn(), value: { ...taxReturn().value,
      income: { ...taxReturn().value.income, filingStatus: "joint" } } }]) }), "TIER_TABLE_REQUIRED");
  });

  it("preserves missing rules, MAGI and enrollment reasons; never projects later law", () => {
    blocked(provider("250", { rules: () => undefined }), "RULE_REQUIRED");
    blocked(provider("250", { rules: q => inv(q, []) }), "RULE_REQUIRED");
    blocked(provider("250", { returns: () => undefined }), "HISTORICAL_INCOME_REQUIRED");
    blocked(provider("250", { enrollments: () => undefined }), "ENROLLMENT_NOT_ADMITTED");
    blocked(provider("250", { determinations: () => undefined }), "OVERRIDE_NOT_ADMITTED");
    const projected = { ...rule(), value: { ...rule().value, rule: { ...rule().value.rule,
      source: { ...rule().value.rule.source, projectionStatus: "explicit_projected" as const } } } };
    blocked(provider("250", { rules: q => inv(q, [projected]) }), "RULE_NOT_ADMITTED");
    blocked(provider("250", { rules: q => inv(q, [{ ...rule(), knownAt: instant("2026-02-01T00:00:00.000Z") }]) }), "RULE_REQUIRED");
  });

  it("rejects competing brackets and overlapping partitions without an order-dependent winner", () => {
    const other = { ...rule(), claimId: "competitor", sourceId: "other" };
    for (const docs of [[rule(), other], [other, rule()]]) blocked(provider("250", { rules: q => inv(q, docs) }), "RULE_CONFLICT");
    const r = rule(), table = r.value.rule.tables[0]!;
    const broken = { ...r, value: { ...r.value, rule: { ...r.value.rule, tables: [{ ...table, tiers: table.tiers.map(t =>
      t.id === "middle" ? { ...t, lowerInclusive: true } : t) }] } } };
    blocked(provider("250", { rules: q => inv(q, [broken]) }), "TIER_TABLE_REQUIRED");
  });

  it("rejects drafts, late returns, incomplete revision inventory and known competing returns", () => {
    blocked(provider("250", { returns: q => inv(q, [{ ...taxReturn(), value: { ...taxReturn().value, status: "draft" } }]) }), "INCOME_NOT_ADMITTED");
    blocked(provider("250", { returns: q => inv(q, [{ ...taxReturn(), knownAt: instant("2026-01-02T00:00:00.000Z") }]) }), "HISTORICAL_INCOME_REQUIRED");
    blocked(provider("250", { returns: q => ({ ...inv(q, [taxReturn()]), complete: false }) }), "HISTORICAL_INCOME_REQUIRED");
    blocked(provider("250", { returns: q => inv(q, [taxReturn(), { ...taxReturn("410"), claimId: "amendment" }]) }), "INCOME_CONFLICT");
  });

  it("uses an earlier return until an explicitly superseding amendment becomes known", () => {
    const amended: Original<OriginalReturn> = { ...taxReturn("410"), claimId: "amended", version: "v2",
      publishedAt: instant("2026-02-01T00:00:00.000Z"), knownAt: instant("2026-02-01T00:00:00.000Z"),
      supersedes: [taxReturn().claimId], value: { ...taxReturn("410").value, income: { ...taxReturn("410").value.income,
        source: { ...taxReturn().value.income.source, version: "v2", asOf: civilDate("2026-02-01") } } } };
    const p = provider("250", { returns: q => inv(q, [amended, taxReturn()]) });
    expect(run(p).candidates[0]!.monthlySurcharge.equals(money("17.13"))).toBe(true);
    const later = query({ period: span("2026-02-01", "2026-03-01"), eventAt: amended.knownAt, knownAt: amended.knownAt });
    expect(run(p, [later]).candidates[0]!.monthlySurcharge.equals(money("49.81"))).toBe(true);
    expect(run(p, [query({ knownAt: amended.knownAt })]).candidates[0]!.monthlySurcharge.equals(money("17.13"))).toBe(true);
  });

  it("re-reads every mandatory inventory after evaluation, detecting withdrawal and full-content changes", () => {
    for (const change of ["withdraw", "publication", "magi"] as const) {
      let ruleReads = 0, enrollmentReads = 0, determinationReads = 0, returnReads = 0;
      const p = provider("250", {
        rules: q => { ruleReads++; return inv(q, [rule()]); },
        enrollments: q => { enrollmentReads++; return inv(q, [enrolled(q)]); },
        determinations: q => { determinationReads++; return inv(q, []); },
        returns: q => {
          returnReads++;
          if (returnReads === 2 && change === "withdraw") return undefined;
          const r = taxReturn(returnReads === 2 && change === "magi" ? "410" : "250", q);
          return inv(q, [{ ...r, publication: returnReads === 2 && change === "publication" ? "amended original text" : r.publication }]);
        },
      });
      blocked(p, "ORIGINAL_CHANGED");
      expect([ruleReads, enrollmentReads, determinationReads, returnReads]).toEqual([2, 2, 2, 2]);
    }
    let count = 0;
    blocked(provider("250", { rules: q => ++count === 1 ? inv(q, [rule()]) : undefined }), "ORIGINAL_CHANGED");
    let reads = 0;
    blocked(provider("250", { determinations: q => inv(q, ++reads === 1 ? [] : [grant()]) }), "ORIGINAL_CHANGED");
  });

  it("rechecks separate legal-event and determination authorities after alternative evaluation", () => {
    let grants = 0, events = 0;
    blocked(provider("250", {
      determinations: q => { grants++; return inv(q, [grant()]); },
      lifeEvents: q => ++events === 1 ? inv(q, [life()]) : undefined,
    }), "ORIGINAL_CHANGED");
    expect(grants).toBe(2); expect(events).toBe(2);
    let calls = 0;
    blocked(provider("250", { determinations: q => inv(q, [{ ...grant(),
      publication: ++calls === 1 ? grant().publication : "grant withdrawn and replaced" }]) }), "ORIGINAL_CHANGED");
  });

  it("pins queries, original versions, as-of dates and full SHA-256 original content", () => {
    blocked(provider("250", { rules: q => ({ ...inv(q, [rule()]), query: { ...q, personId: "other" } }) }), "RULE_REQUIRED");
    blocked(provider("250", { rules: q => inv(q, [{ ...rule(), version: "unrelated-version" }]) }), "RULE_NOT_ADMITTED");
    blocked(provider("250", { rules: q => inv(q, [{ ...rule(), value: { ...rule().value,
      rule: { ...rule().value.rule, source: { ...rule().value.rule.source, asOf: civilDate("2026-01-02") } } } }]) }), "RULE_NOT_ADMITTED");
    expect(irmaaOriginalDigest(rule())).not.toBe(irmaaOriginalDigest({ ...rule(), publication: "changed original" }));
    expect(irmaaOriginalDigest(taxReturn())).not.toBe(irmaaOriginalDigest(taxReturn("250.01")));
    // The normal two-year convention is not an algorithm in the binder.
    const income = taxReturn().value.income;
    const p: IrmaaOriginals = { ...provider(),
      rules: q => inv(q, [{ ...rule(), value: { ...rule().value, rule: { ...rule().value.rule, lookbackTaxYear: 2023 } } }]),
      returns: (q, year) => {
        expect(year).toBe(2023);
        return inv(q, [{ ...taxReturn(), value: { ...taxReturn().value,
          income: { ...income, taxYear: 2023, source: source("return", "historical_tax_return", span("2023-01-01", "2024-01-01")) } } }]);
      },
    };
    expect(run(p).candidates[0]!.legalLookbackTaxYear).toBe(2023);
  });

  it("never uses later-known changed CMS tiers for an earlier economic event", () => {
    const old = rule(), t = old.value.rule.tables[0]!;
    const amendment: Original<OriginalRule> = { ...old, claimId: "rule-v2", version: "v2", supersedes: [old.claimId],
      publishedAt: instant("2026-02-01T00:00:00.000Z"), knownAt: instant("2026-02-01T00:00:00.000Z"),
      value: { ...old.value, rule: { ...old.value.rule, source: { ...old.value.rule.source, version: "v2" },
        tables: [{ ...t, tiers: t.tiers.map(tier => ({ ...tier, partBMonthly: money("91.07") })) }] } } };
    for (const originals of [[old, amendment], [amendment, old]]) {
      const r = run(provider("250", { rules: q => inv(q, originals) }));
      expect(r.candidates[0]!.monthlySurcharge.equals(money("17.13"))).toBe(true);
      expect(r.candidates[0]!.sources.find(s => s.sourceId === "rule")!.version).toBe("v1");
    }
  });

  it("rejects duplicate applicable B/D claims across providers, revisions and event identities", () => {
    for (const part of ["part_b", "part_d"] as const) {
      const q = query({ part });
      blocked(provider("250", { enrollments: x => inv(x, [enrolled(x), { ...enrolled(x), claimId: "second", sourceId: "second" }]) }), "DUPLICATE_SURCHARGE", [q]);
      blocked(provider("250", { enrollments: x => inv(x, [enrolled(x), { ...enrolled(x), claimId: "revision", version: "v2" }]) }), "DUPLICATE_SURCHARGE", [q]);
      blocked(provider(), "DUPLICATE_SURCHARGE", [q, { ...q, coverageId: "other" }]);
    }
  });

  it("leaves unsupported partial/death months incomplete and isolates independent members", () => {
    blocked(provider(), "PRORATION_REQUIRED", [query({ period: span("2026-01-01", "2026-01-15") })]);
    const result = proposeOriginalIrmaa({ originals: provider(), events: [query(), query({ personId: "bob" })],
      deaths: [{ personId: "alice", effectiveAt: civilDate("2026-01-15"), source: source("death", "death_record") }] });
    expect(result.candidates.map(c => c.personId)).toEqual(["bob"]);
    expect(result.diagnostics.map(d => d.diagnosticCode)).toContain("DEATH_SOURCE_REQUIRED");
    const mixed = run(provider(), [query(), query(), query({ personId: "bob" })]);
    expect(mixed.candidates.map(c => c.personId)).toEqual(["bob"]);
  });

  it("freezes compact results, normalizes provider order, and preserves identities under horizon extension", () => {
    const r = rule(), table = r.value.rule.tables[0]!;
    const reversed = { ...r, value: { ...r.value, rule: { ...r.value.rule, tables: [{ ...table, tiers: [...table.tiers].reverse() }] } } };
    const p = provider("250", { rules: q => inv(q, [reversed]) });
    expect(run(p)).toEqual(run());
    expect(irmaaOriginalDigest(r)).toBe(irmaaOriginalDigest(reversed));
    const first = query(), second = query({ period: span("2026-02-01", "2026-03-01"),
      eventAt: instant("2026-02-01T00:00:00.000Z"), knownAt: instant("2026-02-01T00:00:00.000Z") });
    expect(run(provider(), [second, first])).toEqual(run(provider(), [first, second]));
    expect(run(provider(), [first, second]).candidates[0]).toEqual(run().candidates[0]);
    expect(Object.isFrozen(run().candidates[0]!.sources[0])).toBe(true);
    expect(Object.isFrozen(r.value.rule.tables)).toBe(false);
  });

  it("bounds serialized 1/12/120 event output and lookup work without raw repeated originals", () => {
    const sizes: number[] = [];
    for (const n of [1, 12, 120]) {
      let reads = 0;
      const base = provider();
      const p: IrmaaOriginals = {
        rules: q => { reads++; return base.rules(q); }, enrollments: q => { reads++; return base.enrollments(q); },
        returns: (q, year) => { reads++; return base.returns(q, year); },
        determinations: q => { reads++; return base.determinations(q); }, lifeEvents: base.lifeEvents,
      };
      const events = Array.from({ length: n }, (_, i) => query({ personId: `member-${i}` }));
      const result = run(p, events), serialized = JSON.stringify(result);
      expect(result.candidates).toHaveLength(n); expect(reads).toBe(n * 8);
      for (const raw of ["raw original", "publication", "tables", "magi", "taxReturnRef", "partBMonthly", "lowerInclusive"]) expect(serialized).not.toContain(raw);
      sizes.push(serialized.length);
    }
    expect(sizes[1]!).toBeLessThan(sizes[0]! * 12 * 1.05);
    expect(sizes[2]!).toBeLessThan(sizes[0]! * 120 * 1.05);
  });
});
