import { describe, expect, it } from "vitest";
import { evaluateIraBasisYearChain, type IraChainReason, type IraOriginalReturnHistory,
  type IraReturnRevision, type IraYearChainInput } from "../../../../../src/simulation/d2/retirement/conversions/yearChain/index.js";
import { type IraOriginalReturnProvenance, type IraYearInput } from "../../../../../src/simulation/d2/retirement/conversions/index.js";
import { civilDate } from "../../../../../src/time/index.js";
import { Currency, money } from "../../../../../src/values/index.js";
import { annual, cutoff, filing, fixture, history, provider, source } from "./fixtures.js";

const freeze = (x: unknown): void => {
  if (x === null || typeof x !== "object" || Object.isFrozen(x)) return;
  Object.values(x).forEach(freeze); Object.freeze(x);
};
const replaceYear = (input: IraYearChainInput, index: number, f: (y: IraYearInput) => IraYearInput): IraYearChainInput =>
  ({ ...input, years: input.years.map((y, i) => i === index ? f(y) : y) });
const denied = (input: IraYearChainInput, facts: readonly IraOriginalReturnHistory[], index: number, reason: IraChainReason): void => {
  const before = JSON.stringify({ input, facts });
  const result = evaluateIraBasisYearChain(input, provider(facts));
  expect(result.coverage).toBe("incomplete");
  expect(result.years[index]!.reasons).toContain(reason);
  expect(result.years[index]!.details).toBeNull();
  for (const y of result.years.slice(index + 1)) {
    expect(y.coverage).toBe("incomplete"); expect(y.details).toBeNull();
  }
  expect(JSON.stringify({ input, facts })).toBe(before);
};
const revision = (year: number): IraReturnRevision => ({
  personId: "person", taxYear: year, filingId: `amendment:${year}`, filingVersion: "2", filingStatus: "synthetic_single",
  filingKind: "amended", revisesFilingId: `original:${year}`, status: "filed", filedAt: civilDate("2035-01-01"),
  publishedAt: civilDate("2035-01-01"), knownAt: civilDate("2035-01-01"), source: source(`amendment:${year}`, year),
});

describe("independently qualified original-only IRA basis year chain", () => {
  it("uses literal three-year arithmetic, including exhausted basis and a closed zero SEP", () => {
    const { input, facts } = fixture(); freeze(input); freeze(facts);
    const calls: number[] = [], p = provider(facts), before = JSON.stringify(input);
    const result = evaluateIraBasisYearChain(input, { ...p, lookupOriginalReturn(q) { calls.push(q.taxYear); return p.lookupOriginalReturn(q); } });
    expect(result.coverage).toBe("conditional");
    expect(calls).toEqual([2025, 2026, 2027, 2028]);
    // 200 * 100 / 1000 = 20; 180 * 100 / 1000 = 18;
    // min(162, 200) * 200 / 200 = 162, exhausting basis.
    expect(result.years.map(y => {
      const d = y.details!;
      return [d.gross.amount.toString(), d.taxable.amount.toString(), d.basisRecovered.amount.toString(), d.remainingBasis.amount.toString()];
    })).toEqual([["100", "80", "20", "180"], ["100", "82", "18", "162"], ["200", "38", "162", "0"]]);
    expect(result).toMatchObject({ committed: false, postable: false, taxLiability: "incomplete", funding: "incomplete", basisPersistence: "incomplete" });
    expect(result.years.every(y => y.committed === false && y.postable === false && y.taxLiability === "incomplete" &&
      y.funding === "incomplete" && y.basisPersistence === "incomplete")).toBe(true);
    expect(result.years.map(y => y.originalFilingId)).toEqual(["original:2026", "original:2027", "original:2028"]);
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(result.years[0]!.details!.operations[0])).toBe(true);
    expect(Object.isFrozen(result.years[0]!.details!.operations)).toBe(true);
    expect(Object.isFrozen(result.years[0]!.details)).toBe(true);
    expect(Object.isFrozen(result.years[0])).toBe(true);
    expect(Object.isFrozen(result.years)).toBe(true); expect(Object.isFrozen(result)).toBe(true);
  });

  it("is deterministic under annual, account, register and provider-result reordering", () => {
    const { input, facts } = fixture();
    const reversed = { ...input, years: [...input.years].reverse().map(y => ({ ...y, accounts: [...y.accounts].reverse(),
      requests: [...y.requests].reverse(), distributions: [...y.distributions].reverse(), basisAdditions: [...y.basisAdditions].reverse(),
      closeout: { ...y.closeout!, eligibleAccountIds: [...y.closeout!.eligibleAccountIds].reverse() } })) };
    expect(evaluateIraBasisYearChain(reversed, provider([...facts].reverse()))).toEqual(evaluateIraBasisYearChain(input, provider(facts)));
  });

  it("requires independent history and explicit provenance even for zero basis", () => {
    const { input, facts } = fixture();
    expect(evaluateIraBasisYearChain(input).years[0]!.reasons).toEqual(["MISSING_HISTORY_PROVIDER"]);
    denied(input, facts.slice(1), 0, "HISTORY_LOOKUP_FAILED");
    const throwing = { ...provider(facts), lookupOriginalReturn(): never { throw new Error("provider unavailable"); } };
    expect(evaluateIraBasisYearChain(input, throwing).years[0]!.reasons).toEqual(["HISTORY_LOOKUP_FAILED"]);
    denied(replaceYear(input, 0, y => {
      const { originalReturn: _p, ...opening } = y.openingBasis!;
      return { ...y, openingBasis: opening };
    }), facts, 0, "MISSING_ORIGINAL_PROVENANCE");
    const zero = { ...input, years: [annual(2026, "0", "0")] };
    denied(zero, [history(filing(2026, "0"))], 0, "HISTORY_LOOKUP_FAILED");
  });

  it("requires the FIRST previous-year original and the LAST current-year original", () => {
    const { input, facts } = fixture();
    denied(input, facts.filter(h => h.query.taxYear !== 2025), 0, "HISTORY_LOOKUP_FAILED");
    denied(input, facts.filter(h => h.query.taxYear !== 2028), 2, "HISTORY_LOOKUP_FAILED");
    const result = evaluateIraBasisYearChain(input, provider(facts.slice(0, 3)));
    const complete = evaluateIraBasisYearChain(input, provider(facts));
    expect(result.years.slice(0, 2)).toEqual(complete.years.slice(0, 2));
  });

  it("rejects original/amended/unknown and revision relationships independently of user flags", () => {
    const { input, facts } = fixture();
    for (const filingKind of ["amended", "unknown"] as const) {
      denied(input, facts.map((h, i) => i === 1 ? { ...h, original: { ...h.original!, filingKind } } : h), 0, "UNQUALIFIED_ORIGINAL_FILING");
    }
    denied(input, facts.map((h, i) => i === 1 ? { ...h, original: { ...h.original!, revisesFilingId: "earlier" } } : h), 0, "UNQUALIFIED_ORIGINAL_FILING");
    for (const status of ["withdrawn", "revoked", "unknown"] as const)
      denied(input, facts.map((h, i) => i === 1 ? { ...h, originalStatus: status } : h), 0, "UNQUALIFIED_ORIGINAL_FILING");
  });

  it("gates all known amendments/corrections/supersessions, including withdrawn revisions", () => {
    const { input, facts } = fixture();
    for (const filingKind of ["amended", "corrected", "superseding", "unknown"] as const) {
      for (const status of ["filed", "withdrawn", "revoked", "unknown"] as const) {
        denied(input, facts.map((h, i) => i === 2 ? { ...h, revisionInventory: { ...h.revisionInventory,
          revisions: [{ ...revision(2027), filingKind, status }] } } : h), 1, "KNOWN_RETURN_REVISION");
      }
    }
  });

  it("excludes later-known amendments from an earlier cutoff, but rejects future-known originals", () => {
    const { input, facts } = fixture(), future = civilDate("2041-01-01");
    const amendedLater = facts.map(h => ({ ...h, revisionInventory: { ...h.revisionInventory,
      revisions: [{ ...revision(h.query.taxYear), knownAt: future, filedAt: future, publishedAt: future }] } }));
    expect(evaluateIraBasisYearChain(input, provider(amendedLater))).toEqual(evaluateIraBasisYearChain(input, provider(facts)));
    denied(input, facts.map((h, i) => i === 1 ? { ...h, original: { ...h.original!, knownAt: future } } : h), 0, "UNQUALIFIED_ORIGINAL_FILING");
    denied(input, facts.map((h, i) => i === 1 ? { ...h, original: { ...h.original!, source: { ...h.original!.source, asOf: future } } } : h), 0, "UNQUALIFIED_ORIGINAL_FILING");
  });

  it("rejects missing, incomplete and stale revision inventories", () => {
    const { input, facts } = fixture();
    for (const change of [{ completeness: "unknown" as const }, { completeThrough: civilDate("2040-05-31") }, { checkedAt: civilDate("2040-05-31") }])
      denied(input, facts.map((h, i) => i === 1 ? { ...h, revisionInventory: { ...h.revisionInventory, ...change } } : h), 0, "INCOMPLETE_OR_STALE_REVISION_HISTORY");
    // Runtime provider boundaries may lack required data despite static types.
    denied(input, facts.map((h, i) => i === 1 ? { ...h, revisionInventory: undefined } as unknown as IraOriginalReturnHistory : h),
      0, "INCOMPLETE_OR_STALE_REVISION_HISTORY");
    denied(input, facts.map((h, i) => i === 1 ? { ...h, revisionInventory: { ...h.revisionInventory,
      revisions: undefined } } as unknown as IraOriginalReturnHistory : h), 0, "INCOMPLETE_OR_STALE_REVISION_HISTORY");
  });

  it("rejects missing, changed, unverified, future, revoked or withdrawn publisher evidence", () => {
    const { input, facts } = fixture();
    const changes: Partial<IraOriginalReturnHistory>[] = [
      { publisherId: "" }, { publisherId: "other" }, { publisherVersion: "v2" }, { sourcePublication: "changed" },
      { authority: "unverified" }, { status: "withdrawn" }, { status: "revoked" },
      { source: { ...facts[1]!.source, verification: "unverified" } },
      { source: { ...facts[1]!.source, asOf: civilDate("2041-01-01") } },
      { source: { ...facts[1]!.source, asOf: civilDate("2040-05-31") } },
      { source: { ...facts[1]!.source, sourcePublication: "" } },
      { query: { ...facts[1]!.query, knownAt: civilDate("2040-05-31") } },
    ];
    for (const change of changes)
      denied(input, facts.map((h, i) => i === 1 ? { ...h, ...change } : h), 0, "UNQUALIFIED_HISTORY_AUTHORITY");
  });

  it("checks identity, version, owner, tax year, filing status, source, exact amount and legal snapshot", () => {
    const { input, facts } = fixture();
    const changes: Partial<IraOriginalReturnProvenance>[] = [
      { filingId: "different" }, { filingVersion: "2" }, { filingStatus: "joint" }, { carryForwardBasis: money("179.99") },
      { source: { ...facts[1]!.original!.source, sourceId: "another" } },
      { legalSnapshot: { ...facts[1]!.original!.legalSnapshot, version: "other" } },
    ];
    for (const change of changes)
      denied(input, facts.map((h, i) => i === 1 ? { ...h, original: { ...h.original!, ...change } } : h), 0, "ORIGINAL_FILING_MISMATCH");
    for (const change of [{ personId: "spouse" }, { taxYear: 2027 }])
      denied(input, facts.map((h, i) => i === 1 ? { ...h, original: { ...h.original!, ...change } } : h), 0, "UNQUALIFIED_ORIGINAL_FILING");
    denied(input, facts.map((h, i) => i === 1 ? { ...h,
      source: { ...h.source, ruleSnapshotId: "wrong" } } : h), 0, "UNQUALIFIED_ORIGINAL_FILING");
  });

  it("checks closeout against its own original even when a following opening agrees with the altered calculation", () => {
    const { input, facts } = fixture();
    const changed = replaceYear(input, 0, y => ({ ...y, accounts: y.accounts.map(a => a.accountId === "traditional" ?
      { ...a, december31Value: { ...a.december31Value!, amount: money("1900") } } : a) }));
    denied(changed, facts, 0, "ANNUAL_INCOMPLETE");
    const result = evaluateIraBasisYearChain(changed, provider(facts));
    expect(result.years[0]!.annualDiagnosticCodes).toEqual(["UNQUALIFIED_ORIGINAL_RETURN"]);
    denied(replaceYear(input, 1, y => ({ ...y, openingBasis: { ...y.openingBasis!, amount: money("181") } })), facts, 1, "BASIS_CONTINUITY_MISMATCH");
    denied(replaceYear(input, 1, y => ({ ...y, openingBasis: { ...y.openingBasis!, priorTaxYear: 2025 } })), facts, 1, "BASIS_CONTINUITY_MISMATCH");
  });

  it("gates missing years, duplicate years and cross-year operation/transaction reuse", () => {
    const { input, facts } = fixture();
    denied({ ...input, years: [input.years[0]!, input.years[2]!] }, facts, 1, "NONCONSECUTIVE_OR_DUPLICATE_YEAR");
    denied({ ...input, years: [input.years[0]!, input.years[0]!] }, facts, 0, "NONCONSECUTIVE_OR_DUPLICATE_YEAR");
    for (const key of ["operationId", "transactionId"] as const) {
      const old = input.years[0]!.distributions[0]!;
      const changed = replaceYear(input, 1, y => ({ ...y,
        requests: y.requests.map(r => ({ ...r, [key]: old[key] })), distributions: y.distributions.map(d => ({ ...d, [key]: old[key] })) }));
      denied(changed, facts, 1, "DUPLICATE_CROSS_YEAR_OPERATION");
    }
  });

  it("preserves annual gates for complete closed/zero inventories, unsupported years and bad rules", () => {
    const { input, facts } = fixture();
    const changes: ((y: IraYearInput) => IraYearInput)[] = [
      y => ({ ...y, accounts: y.accounts.filter(a => a.accountId !== "closed-sep") }),
      y => ({ ...y, accounts: y.accounts.map(a => {
        if (a.accountId !== "closed-sep") return a;
        const { december31Value: _v, ...rest } = a; return rest;
      }) }),
      y => { const { rules: _r, ...rest } = y; return rest; },
      y => ({ ...y, rules: { ...y.rules!, model: "unsupported" } }),
      y => ({ ...y, rules: { ...y.rules!, source: { ...y.rules!.source, ruleSnapshotId: "wrong" } } }),
      y => ({ ...y, requests: y.requests.map(r => ({ ...r, source: { ...r.source, asOf: civilDate("2041-01-01") } })) }),
    ];
    for (const change of changes) denied(replaceYear(input, 1, change), facts, 1, "ANNUAL_INCOMPLETE");
    denied(replaceYear(input, 0, y => ({ ...y, currency: Currency.of("EUR") })), facts, 0, "INVALID_CHAIN_CONTEXT");
    expect(evaluateIraBasisYearChain({ ...input, years: [] }, provider(facts)).coverage).toBe("incomplete");
    expect(evaluateIraBasisYearChain({ ...input, asOf: civilDate("2041-01-01") }, provider(facts)).coverage).toBe("incomplete");
  });

  it("keeps 1/3/12-year serialized output linear and excludes source catalogs and authored annual plans", () => {
    const lengths: number[] = [];
    for (const count of [1, 3, 12]) {
      const years = Array.from({ length: count }, (_, i) => annual(2026 + i, "0", "0"));
      const facts = Array.from({ length: count + 1 }, (_, i) => history(filing(2025 + i, "0")));
      const input = { personId: "person", knownAt: cutoff, asOf: cutoff, years };
      const result = evaluateIraBasisYearChain(input, provider(facts)), serialized = JSON.stringify(result);
      expect(result.coverage).toBe("conditional");
      for (const forbidden of ["legalSnapshot", "sourcePublication", "revisionInventory", "accounts", "eligibleAccountIds", "effectivePeriod"])
        expect(serialized).not.toContain(`"${forbidden}"`);
      const huge = facts.map(h => ({ ...h, sourcePublication: "catalog".repeat(10000),
        source: { ...h.source, sourcePublication: "catalog".repeat(10000) }, original: { ...h.original!,
          source: { ...h.original!.source, sourcePublication: "catalog".repeat(10000) } } }));
      // Large evidence on a rejected source still cannot amplify diagnostics.
      expect(JSON.stringify(evaluateIraBasisYearChain(input, provider(huge))).length).toBeLessThan(serialized.length);
      const qualifyLarge = (p: IraOriginalReturnProvenance): IraOriginalReturnProvenance => ({ ...p,
        source: { ...p.source, sourcePublication: "catalog".repeat(10000) } });
      const largeInput = { ...input, years: years.map(y => ({ ...y,
        openingBasis: { ...y.openingBasis!, source: qualifyLarge(y.openingBasis!.originalReturn!).source,
          originalReturn: qualifyLarge(y.openingBasis!.originalReturn!) },
        closeout: { ...y.closeout!, source: qualifyLarge(y.closeout!.originalReturn!).source,
          originalReturn: qualifyLarge(y.closeout!.originalReturn!) } })) };
      const largeProvider = { ...provider(huge), sourcePublication: "catalog".repeat(10000) };
      // Even accepted, large immutable source evidence stays exclusively in input/provider storage.
      expect(evaluateIraBasisYearChain(largeInput, largeProvider)).toEqual(result);
      lengths.push(serialized.length);
    }
    expect((lengths[2]! - lengths[1]!) / 9).toBe((lengths[1]! - lengths[0]!) / 2);
  });
});
