import { describe, expect, it } from "vitest";
import { civilDate as date } from "../../../../src/time/index.js";
import { Currency, Money, money, USD } from "../../../../src/values/index.js";
import { evaluateRothOrder, type RothOrderInput, type RothRequest, type RothSource, type RothTerms, type RothUse, type RothVintage } from "../../../../src/simulation/d2/retirement/rothOrder/index.js";

// Synthetic evidence only; these fixtures supply no official law or age table.
const source = (id: string, resourceId = "person"): RothSource => ({
  id, resourceId, personId: "person", householdId: "home", ruleSnapshotId: "synthetic-rule",
  jurisdiction: "US:synthetic", ruleFamily: "roth_ira_ordering", sourcePublication: "Synthetic evidence", version: "v1",
  publishedAt: date("2025-01-01"), asOf: date("2025-12-31"), effectiveFrom: date("2010-01-01"), endExclusive: date("2030-01-01"), projectionStatus: "verified",
});
function request(amount = "100", id = "one", sequence = 0, at = "2026-01-01", account = "roth"): RothRequest {
  const terms: RothTerms = { operationId: `op:${id}`, withdrawalId: `withdrawal:${id}`, authorizationId: `auth:${id}`, personId: "person",
    sourceAccountId: account, effectiveAt: date(at), sequence, gross: money(amount), route: "ordinary_cash" };
  return { ...terms, source: source(`request:${id}`, account), authorization: { permission: "yes", terms, source: source(`auth:${id}`, account) },
    qualification: { qualifyingCondition: "no", earlyDistribution: "yes", exceptions: "verified_none", source: source(`qualification:${id}`) } };
}
function vintage(id: string, year: number, amount: string, component: "taxable" | "nontaxable", kind: "conversion" | "rollover" = "conversion"): RothVintage {
  return { id, transactionId: `tx:${id}`, accountId: "roth", kind, taxYear: year, originatedAt: date(`${year}-06-01`), component,
    recaptureStart: date(`${year}-01-01`), recaptureEndExclusive: date(`${year + 5}-01-01`), legalCharacter: "verified_roth_ira_vintage",
    original: money(amount), available: money(amount), source: source(`vintage:${id}`, "roth") };
}
function fixture(amount = "100"): RothOrderInput {
  return { householdId: "home", personId: "person", taxYear: 2026, knownAt: date("2027-01-01"), snapshotAt: date("2025-12-31"),
    accounts: [{ accountId: "roth", ownerId: "person", family: "roth_ira", taxBucket: "roth", beneficiaryId: null, source: source("account", "roth"),
      cash: { available: money("1000"), source: source("cash", "roth") } }],
    contributions: { original: money("100"), available: money("100"), source: source("contributions") },
    earnings: { original: money("50"), available: money("50"), source: source("earnings") },
    vintages: [vintage("old", 2020, "40", "taxable"), vintage("new-tax", 2024, "30", "taxable"), vintage("new-basis", 2024, "20", "nontaxable")],
    history: [], requests: [request(amount)],
    rules: { source: source("rule"), model: "contributions_then_year_fifo_taxable_first_then_earnings", clocks: "independent_five_tax_years",
      qualifiedStart: date("2018-01-01"), qualifiedEndExclusive: date("2023-01-01"), vintageOrder: ["old", "new-tax", "new-basis"] },
    completeness: { source: source("complete"), status: "verified_exhaustive_owner_history", accountIds: ["roth"], vintageIds: ["old", "new-tax", "new-basis"],
      historicalOperationIds: [], historicalWithdrawalIds: [], historicalAuthorizationIds: [], contributions: "verified_actual_regular_basis", earnings: "verified_actual",
      priorConsumption: "verified_complete", cashReservations: "verified_complete", unchangedUntilExclusive: date("2027-01-01"), interveningActivity: "verified_none" } };
}
const denied = (f: RothOrderInput, code: string): void => {
  const result = evaluateRothOrder(f);
  expect(result.coverage).toBe("incomplete"); expect(result.proposals).toEqual([]);
  expect(result.diagnostics[0]?.diagnosticCode).toBe(code);
  expect(result.diagnostics[0]?.seam).toBe("S7");
  expect(result.physicalTransfer).toBe("not_applied"); expect(result.taxSettlement).toBe("incomplete");
};
function historical(f: RothOrderInput, used: string): RothOrderInput {
  const h: RothUse = { operationId: "past-op", withdrawalId: "past-withdrawal", authorizationId: "past-auth", accountId: "roth",
    effectiveAt: date("2025-03-01"), gross: money(used), contributions: money(used), earnings: money("0"), vintages: [], source: source("history", "roth") };
  return { ...f, contributions: { ...f.contributions, available: f.contributions.original.minus(money(used)) }, history: [h],
    completeness: { ...f.completeness!, historicalOperationIds: [h.operationId], historicalWithdrawalIds: [h.withdrawalId], historicalAuthorizationIds: [h.authorizationId] } };
}

describe("source-qualified Roth ordering proposals", () => {
  it.each(["0", "25.01", "100"])("accepts %s contribution use with exact decomposition", amount => {
    const result = evaluateRothOrder(fixture(amount)), p = result.proposals[0]!;
    expect(result.coverage).toBe("conditional"); expect(p.gross.equals(money(amount))).toBe(true);
    expect(p.components.reduce((sum, c) => sum.plus(c.amount), Money.zero(USD)).equals(p.gross)).toBe(true);
    expect(p.components.every(c => c.character === "regular_contribution_basis")).toBe(true);
    expect(p).toMatchObject({ committed: false, postable: false, physicalTransfer: "not_applied", taxSettlement: "incomplete", taxYear: 2026 });
  });
  it("orders years and taxable/nontaxable subcomponents before earnings without retaxing principal", () => {
    const result = evaluateRothOrder(fixture("210.01")), p = result.proposals[0]!;
    expect(result.coverage).toBe("conditional");
    expect(p.components.map(c => [c.character, c.amount.amount.toString()])).toEqual([
      ["regular_contribution_basis", "100"], ["conversion_taxable_basis", "40"], ["conversion_taxable_basis", "30"], ["conversion_nontaxable_basis", "20"], ["earnings", "20.01"],
    ]);
    expect(p.components.map(c => c.conversionRecaptureCandidate.amount.toString())).toEqual(["0", "0", "30", "0", "0"]);
    expect(p.components.map(c => c.incomeCandidate.amount.toString())).toEqual(["0", "0", "0", "0", "20.01"]);
    expect(p.components[4]!.earlyDistributionCandidate.equals(money("20.01"))).toBe(true);
  });
  it.each(["0", "25", "100"])("reconciles verified prior consumption %s independently of gross", used => {
    const f = historical(fixture("101"), used), p = evaluateRothOrder(f).proposals[0]!;
    expect(p.components.filter(c => c.character === "regular_contribution_basis").reduce((a, c) => a.plus(c.amount), money("0")).equals(money("100").minus(money(used)))).toBe(true);
  });
  it("requires history, including explicit zero usage, and detects corrupted consumption", () => {
    const f = historical(fixture(), "25");
    denied({ ...f, history: [] }, "NONEXHAUSTIVE_REGISTER");
    denied({ ...f, contributions: { ...f.contributions, available: money("100") } }, "UNRECONCILED_PRIOR_CONSUMPTION");
    denied(historical(fixture(), "101"), "INVALID_EXACT_USD_CENTS");
    denied({ ...f, completeness: { ...f.completeness!, priorConsumption: "unknown" } }, "UNKNOWN_BASIS_HISTORY_OR_ACTIVITY");
    const { completeness: _proof, ...missing } = f;
    denied(missing, "MISSING_EXHAUSTIVENESS_PROOF");
  });
  it("reconciles prior vintage and earnings consumption without spending it again", () => {
    const f = historical(fixture("35"), "100"), h = f.history[0]!;
    const adjusted: RothOrderInput = { ...f, history: [{ ...h, gross: money("205"), vintages: [
      { vintageId: "old", amount: money("40") }, { vintageId: "new-tax", amount: money("30") }, { vintageId: "new-basis", amount: money("20") },
    ], earnings: money("15") }], vintages: f.vintages.map(v => ({ ...v, available: money("0") })), earnings: { ...f.earnings, available: money("35") } };
    const p = evaluateRothOrder(adjusted).proposals[0]!;
    expect(p.components.map(c => c.amount.amount.toString())).toEqual(["35"]);
    denied({ ...adjusted, requests: [request("35.01")] }, "INSUFFICIENT_ATTESTED_BASIS_VINTAGES_EARNINGS");
  });
  it("rejects repeated historical component spending and false historical totals", () => {
    const f = historical(fixture(), "100"), h = f.history[0]!;
    denied({ ...f, history: [{ ...h, gross: money("101") }] }, "HISTORY_DECOMPOSITION");
    denied({ ...f, history: [{ ...h, contributions: money("101"), gross: money("101") }] }, "HISTORY_OR_BATCH_OVERSPEND");
    denied({ ...f, history: [{ ...h, vintages: [{ vintageId: "old", amount: money("1") }, { vintageId: "old", amount: money("1") }] }] }, "DUPLICATE_HISTORY_COMPONENT");
    denied({ ...f, history: [{ ...h, vintages: [{ vintageId: "unknown", amount: money("1") }] }] }, "UNKNOWN_OR_FUTURE_HISTORY_VINTAGE");
  });
  it("conserves batch cash and aggregate owner basis with explicit request precedence", () => {
    const f = fixture(), a = f.accounts[0]!;
    const g: RothOrderInput = { ...f, accounts: [a, { ...a, accountId: "other", source: source("other", "other"), cash: { available: money("50"), source: source("other-cash", "other") } }],
      completeness: { ...f.completeness!, accountIds: ["roth", "other"] }, requests: [request("80", "first", 0), request("50", "second", 1, "2026-01-01", "other")] };
    const result = evaluateRothOrder(g);
    expect(result.coverage).toBe("conditional");
    expect(result.proposals[1]!.components.map(c => c.amount.amount.toString())).toEqual(["20", "30"]);
    expect(evaluateRothOrder({ ...g, accounts: [...g.accounts].reverse(), vintages: [...g.vintages].reverse(), requests: [...g.requests].reverse(),
      completeness: { ...g.completeness!, accountIds: ["other", "roth"], vintageIds: [...g.completeness!.vintageIds].reverse() } })).toEqual(result);
    denied({ ...g, requests: [request("80", "first", 0), request("50.01", "second", 1, "2026-01-01", "other")] }, "HISTORY_OR_BATCH_OVERSPEND");
    denied({ ...g, requests: [request("200", "first", 0), request("41", "second", 1)] }, "INSUFFICIENT_ATTESTED_BASIS_VINTAGES_EARNINGS");
  });
  it("keeps persons and spouses isolated and rejects unsupported containers", () => {
    const f = fixture(), a = f.accounts[0]!;
    denied({ ...f, accounts: [{ ...a, ownerId: "spouse" }] }, "UNSUPPORTED_ACCOUNT_OR_OWNER");
    denied({ ...f, contributions: { ...f.contributions, source: { ...f.contributions.source, personId: "spouse" } } }, "SOURCE_OWNER_OR_RESOURCE");
    for (const patch of [{ family: "workplace_plan" as const }, { taxBucket: "mixed" as const }, { beneficiaryId: "heir" }]) {
      denied({ ...f, accounts: [{ ...a, ...patch }] }, "UNSUPPORTED_ACCOUNT_OR_OWNER");
    }
    denied({ ...f, accounts: [...f.accounts, a] }, "NONEXHAUSTIVE_REGISTER");
    denied({ ...f, completeness: { ...f.completeness!, accountIds: ["roth", "omitted"] } }, "NONEXHAUSTIVE_REGISTER");
    const personInput: RothOrderInput = { ...f, personId: "spouse", accounts: [{ ...a, ownerId: "spouse" }] };
    denied(personInput, "SOURCE_OWNER_OR_RESOURCE");
  });
  it("evaluates independently sourced spouses with separate pools and trace identities", () => {
    const own = (value: unknown): unknown => {
      if (value instanceof Money || value instanceof Currency) return value;
      if (Array.isArray(value)) return value.map(own);
      if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, own(v)]));
      return value === "person" ? "spouse" : value;
    };
    const f = fixture(), spouse = own(f) as RothOrderInput;
    const a = evaluateRothOrder(f), b = evaluateRothOrder(spouse);
    expect(a.coverage).toBe("conditional"); expect(b.coverage).toBe("conditional");
    expect(b.proposals[0]!.components[0]!.amount.equals(money("100"))).toBe(true);
    expect(b.proposals[0]!.traceId).not.toBe(a.proposals[0]!.traceId);
    expect(evaluateRothOrder(f)).toEqual(a);
  });
  it("rejects negative, fractional-cent, foreign and counterfeit money", () => {
    for (const value of [money("-1"), money("0.001"), money("1", Currency.of("EUR")), {} as Money]) {
      denied({ ...fixture(), requests: [{ ...request(), gross: value }] }, "INVALID_EXACT_USD_CENTS");
    }
    const f = fixture();
    denied({ ...f, contributions: { ...f.contributions, available: money("101") } }, "CORRUPTED_POOL");
    denied({ ...f, accounts: [{ ...f.accounts[0]!, cash: { ...f.accounts[0]!.cash, available: money("99.99") } }] }, "HISTORY_OR_BATCH_OVERSPEND");
  });
  it("rejects duplicated historical or batch identities and reused authorizations", () => {
    const f = historical(fixture(), "25"), h = f.history[0]!;
    denied({ ...f, history: [h, h] }, "NONEXHAUSTIVE_REGISTER");
    for (const patch of [{ operationId: h.operationId }, { withdrawalId: h.withdrawalId }, { authorizationId: h.authorizationId }]) {
      denied({ ...f, requests: [{ ...request(), ...patch }] }, "REUSED_OPERATION_WITHDRAWAL_OR_AUTHORIZATION");
    }
    denied({ ...f, requests: [request(), { ...request("1", "two", 1), authorizationId: "auth:one" }] }, "REUSED_OPERATION_WITHDRAWAL_OR_AUTHORIZATION");
    denied({ ...f, requests: [request(), { ...request("1", "two", 1), withdrawalId: "withdrawal:one" }] }, "REUSED_OPERATION_WITHDRAWAL_OR_AUTHORIZATION");
    denied({ ...f, requests: [request(), request("1", "two")] }, "UNPROVEN_BATCH_ORDER");
    denied({ ...f, requests: [{ ...request(), gross: money("99") }] }, "AUTHORIZATION_TERMS_MISMATCH");
    const { authorization: _auth, ...missing } = request();
    denied({ ...f, requests: [missing] }, "MISSING_AUTHORIZATION");
  });
  it("distinguishes conversion from regular contribution and requires admitted rollover character", () => {
    const f = fixture("150"), roll = vintage("roll", 2022, "20", "taxable", "rollover");
    const g: RothOrderInput = { ...f, vintages: [roll, ...f.vintages], rules: { ...f.rules!, vintageOrder: ["old", "roll", "new-tax", "new-basis"] },
      completeness: { ...f.completeness!, vintageIds: ["old", "roll", "new-tax", "new-basis"] } };
    expect(evaluateRothOrder(g).proposals[0]!.components[2]!.character).toBe("rollover_taxable_basis");
    denied({ ...g, vintages: [{ ...roll, legalCharacter: "unknown" }, ...f.vintages] }, "UNQUALIFIED_VINTAGE");
    denied({ ...f, vintages: f.vintages.map(v => ({ ...v, kind: "regular_contribution" })) } as unknown as RothOrderInput, "UNQUALIFIED_VINTAGE");
    denied({ ...f, rules: { ...f.rules!, vintageOrder: ["new-basis", "new-tax", "old"] } }, "NONSTATUTORY_VINTAGE_ORDER");
    denied({ ...f, vintages: f.vintages.map(v => v.id === "new-tax" ? { ...v, transactionId: "tx:old" } : v) }, "DUPLICATE_VINTAGE_TRANSACTION");
  });
  it("accepts taxable and nontaxable components of one conversion without duplicate principal", () => {
    const f = fixture("190"), g = { ...f, vintages: f.vintages.map(v => v.id === "new-basis" ? { ...v, transactionId: "tx:new-tax" } : v) };
    expect(evaluateRothOrder(g).coverage).toBe("conditional");
    denied({ ...g, vintages: g.vintages.map(v => v.id === "new-basis" ? { ...v, originatedAt: date("2024-07-01") } : v) }, "CONFLICTING_VINTAGE_TRANSACTION");
  });
  it("returns source-specific diagnostics for late, projected, conflicting and missing evidence", () => {
    const f = fixture(), r = f.requests[0]!;
    const { rules: _rules, ...missing } = f; denied(missing, "MISSING_APPLICABLE_RULE");
    for (const patch of [{ asOf: date("2026-01-02") }, { projectionStatus: "explicit_projected" as const }, { publishedAt: date("2026-01-02") }]) {
      denied({ ...f, requests: [{ ...r, source: { ...r.source, ...patch } }] }, "UNVERIFIED_LATE_OR_INEFFECTIVE_SOURCE");
    }
    denied({ ...f, knownAt: date("2025-12-31") }, "UNCOVERED_EVENT_WINDOW");
    denied({ ...f, requests: [{ ...r, source: { ...r.source, ruleSnapshotId: "other" } }] }, "CONFLICTING_RULE_SNAPSHOT");
    denied({ ...f, requests: [{ ...r, source: { ...r.source, id: "account", sourcePublication: "Contradiction" } }] }, "CONFLICTING_SOURCE_ID");
    const bad = evaluateRothOrder({ ...f, requests: [{ ...r, source: { ...r.source, resourceId: "wrong" } }] }).diagnostics[0]!;
    expect(bad.affectedAccountId).toBe("roth"); expect(bad.traceRefs).toContain("request:one"); expect(bad.sourceEntityPath).toBe("requests.op:one");
    denied({ ...f, requests: [{ ...r, source: undefined }] } as unknown as RothOrderInput, "MISSING_SOURCE");
  });
  it.each(["inherited", "qcd", "rollover", "unknown"] as const)("keeps %s routes incomplete", route => {
    denied({ ...fixture(), requests: [{ ...request(), route }] }, "UNSUPPORTED_ROUTE_OR_OWNER");
  });
  it("keeps unknown conditions and exceptions incomplete even when only basis is requested", () => {
    const f = fixture(), r = request();
    for (const patch of [{ qualifyingCondition: "unknown" as const }, { earlyDistribution: "unknown" as const }, { exceptions: "unknown" as const }]) {
      denied({ ...f, requests: [{ ...r, qualification: { ...r.qualification, ...patch } }] }, "UNKNOWN_QUALIFICATION_OR_EXCEPTION");
    }
  });
  it.each([["2025-12-31", true], ["2026-01-01", false]] as const)("uses independent recapture boundary at %s", (at, open) => {
    const f = fixture("141"), old = vintage("old", 2021, "40", "taxable");
    const g: RothOrderInput = { ...f, taxYear: Number(at.slice(0, 4)), requests: [request("141", "one", 0, at)], vintages: [old, ...f.vintages.slice(1)] };
    const p = evaluateRothOrder(g).proposals[0]!;
    expect(p.components[1]!.clock).toBe(open ? "open" : "elapsed");
    expect(p.components[1]!.conversionRecaptureCandidate.equals(money(open ? "40" : "0"))).toBe(true);
    expect(p.components[2]!.conversionRecaptureCandidate.equals(money("1"))).toBe(true);
  });
  it.each([["2025-12-31", false], ["2026-01-01", true]] as const)("requires both qualification predicates at %s", (at, qualified) => {
    const f = fixture("200"), r = request("200", "one", 0, at);
    const g: RothOrderInput = { ...f, taxYear: Number(at.slice(0, 4)), vintages: f.vintages.filter(v => v.id !== "old"),
      rules: { ...f.rules!, qualifiedStart: date("2021-01-01"), qualifiedEndExclusive: date("2026-01-01"), vintageOrder: ["new-tax", "new-basis"] },
      completeness: { ...f.completeness!, vintageIds: ["new-tax", "new-basis"] }, requests: [{ ...r, qualification: { ...r.qualification, qualifyingCondition: "yes" } }] };
    const p = evaluateRothOrder(g).proposals[0]!;
    expect(p.qualified).toBe(qualified);
    expect(p.components.at(-1)!.incomeCandidate.equals(money(qualified ? "0" : "50"))).toBe(true);
    expect(p.components[1]!.conversionRecaptureCandidate.equals(money(qualified ? "0" : "30"))).toBe(true);
  });
  it("uses half-open source windows and validates supplied clock starts", () => {
    const f = fixture();
    denied({ ...f, completeness: { ...f.completeness!, unchangedUntilExclusive: date("2026-01-01") } }, "UNCOVERED_EVENT_WINDOW");
    denied({ ...f, rules: { ...f.rules!, qualifiedEndExclusive: date("2023-01-02") } }, "UNSUPPORTED_FIVE_YEAR_CLOCK");
    denied({ ...f, rules: { ...f.rules!, source: { ...f.rules!.source, endExclusive: date("2026-01-01") } } }, "UNCOVERED_EVENT_WINDOW");
    denied({ ...f, contributions: { ...f.contributions, source: { ...f.contributions.source, asOf: date("2025-12-30") } } }, "STALE_POOL");
    denied({ ...f, completeness: { ...f.completeness!, source: { ...f.completeness!.source, asOf: date("2025-12-30") } } }, "STALE_INVENTORY_PROOF");
    denied({ ...f, vintages: f.vintages.map(v => v.id === "new-tax" ? { ...v, recaptureStart: date("2023-01-01"), recaptureEndExclusive: date("2028-01-01") } : v) }, "UNQUALIFIED_VINTAGE");
  });
  it("preserves arbitrary-size cents without rounding away a remainder", () => {
    const f = fixture(), large = money("900719925474099312345.67"), r = request();
    const g: RothOrderInput = { ...f, contributions: { ...f.contributions, original: large, available: large },
      accounts: [{ ...f.accounts[0]!, cash: { ...f.accounts[0]!.cash, available: large.plus(money("0.01")) } }],
      requests: [{ ...r, gross: large.plus(money("0.01")), authorization: { ...r.authorization!, terms: { ...r.authorization!.terms, gross: large.plus(money("0.01")) } } }] };
    const p = evaluateRothOrder(g).proposals[0]!;
    expect(p.components.map(c => c.amount.amount.toString())).toEqual(["900719925474099312345.67", "0.01"]);
    expect(p.components.reduce((sum, c) => sum.plus(c.amount), money("0")).equals(p.gross)).toBe(true);
  });
  it("is deeply immutable and deterministic on repeated evaluation without mutating input", () => {
    const f = fixture("240"), before = JSON.stringify(f), result = evaluateRothOrder(f);
    expect(result.coverage).toBe("conditional"); expect(evaluateRothOrder(f)).toEqual(result); expect(JSON.stringify(f)).toBe(before);
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.proposals)).toBe(true);
    expect(Object.isFrozen(result.proposals[0]!.components[0])).toBe(true); expect(Object.isFrozen(result.proposals[0]!.traceRefs)).toBe(true);
    expect(Object.isFrozen(f)).toBe(false); expect(Object.isFrozen(f.requests)).toBe(false);
  });
});
