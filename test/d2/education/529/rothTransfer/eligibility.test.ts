import { describe, expect, it } from "vitest";
import { propose529RothTransfers, type IraCapacity, type RothTransferRequest, type RothUsage } from "../../../../../src/simulation/d2/education/529/rothTransfer/index.js";
import type { EducationSource } from "../../../../../src/simulation/d2/education/529/types.js";
import { civilDate } from "../../../../../src/time/index.js";
import { Currency, Money, money } from "../../../../../src/values/index.js";

// Independently authored synthetic law, not statutory values or real personal data.
const at = civilDate("2026-01-15"), opened = civilDate("2000-01-15");
const source = (sourceId: string, patch: Partial<EducationSource> = {}): EducationSource => ({
  sourceId, sourcePublication: "Synthetic independent source; no actual law", publishedAt: civilDate("1999-01-01"),
  asOf: at, start: civilDate("1999-01-01"), endExclusive: civilDate("2030-01-01"),
  ruleSnapshotId: "synthetic-529-roth", ruleFamily: "education_529", jurisdiction: "US", version: "synthetic-v1",
  verification: "verified", projectionStatus: "verified", householdId: "hh", ownerId: "parent", beneficiaryId: "child",
  planId: "plan", providerId: "provider", currency: Currency.of("USD"), ...patch,
});
const capacity = (kind: IraCapacity["limitScope"]["kind"], maximum: string): IraCapacity => ({
  personId: "child", taxYear: 2026, limitScope: { kind, aggregationId: "person" }, ruleSnapshotId: kind,
  maximum: money(maximum), used: money("100.02"), asOf: at, completeness: "complete",
  source: source(kind, { ruleSnapshotId: kind, start: civilDate("2026-01-01"), endExclusive: civilDate("2027-01-01") }),
  usageSource: source(`${kind}-usage`),
});
const previous = (): RothUsage => ({ operationId: "previous-transfer", claimId: "previous-claim", kind: "529_roth_transfer",
  beneficiaryId: "child", ownerId: "other-owner", planId: "other-plan", providerId: "other-provider", destinationAccountId: "other-roth",
  taxYear: 2025, effectiveAt: civilDate("2025-01-01"), state: "posted", amount: money("600.04"), basis: money("400"), earnings: money("200.04"),
  source: source("other-plan-usage", { ownerId: "other-owner", planId: "other-plan", providerId: "other-provider" }),
});
const regular = (): RothUsage => ({ operationId: "regular-ira", claimId: "regular-claim", kind: "regular_ira_contribution",
  beneficiaryId: "child", ownerId: "child", planId: "ira", providerId: "ira-provider", destinationAccountId: "roth",
  taxYear: 2026, effectiveAt: civilDate("2026-01-05"), state: "posted", amount: money("100.02"), basis: money("0"), earnings: money("0"),
  source: source("regular-usage", { ownerId: "child", planId: "ira", providerId: "ira-provider" }),
});
const request = (): RothTransferRequest => ({
  operationId: "transfer", claimId: "claim", kind: "529_beneficiary_roth_direct_trustee_transfer", effectiveAt: at, knownAt: at,
  taxYear: 2026, currency: Currency.of("USD"), amount: money("350.01"),
  plan: { householdId: "hh", ownerId: "parent", beneficiaryId: "child", planId: "plan", providerId: "provider",
    accountId: "container", cashAccountId: "cash", taxBucket: "education_529", treatment: "ordinary_original_owner",
    stateJurisdiction: "US:synthetic", localJurisdiction: "US:synthetic:local", source: source("plan"),
    contributions: [
      { lotId: "old", basisId: "old-basis", fundingOperationId: "old-funding", fundedAt: opened, principal: money("600.03"), source: source("old-funding") },
      { lotId: "recent", basisId: "recent-basis", fundingOperationId: "recent-funding", fundedAt: civilDate("2025-01-01"), principal: money("200.02"), source: source("recent-funding") },
    ], distributions: [], snapshot: { at, taxYear: 2026, history: "complete_since_inception", currentValue: money("1000.05"),
      contributionBasis: money("800.05"), earnings: money("200"), unencumberedCash: money("900"), source: source("snapshot") } },
  history: { openedAt: opened, beneficiarySince: opened, ageStart: opened, complete: "complete_since_inception", changes: [], source: source("history") },
  rules: { source: source("law"), treatment: "direct_trustee_beneficiary_roth", minimumPlanAgeYears: 10, ageStartPermission: "original_opening",
    recentFrom: civilDate("2021-01-15"), recentTreatment: "exclude_contributions_and_allocable_earnings", lifetimeMaximum: money("1000"),
    annualCapacityRuleSnapshotId: "ira_annual", compensationRuleSnapshotId: "ira_compensation" },
  holdings: { holdingId: "holding", complete: "all_current_lots", source: source("holdings"), lots: [
    { lotId: "old", basisId: "old-basis", basis: money("600.03"), earnings: money("150.02"), source: source("old-current") },
    { lotId: "recent", basisId: "recent-basis", basis: money("200.02"), earnings: money("49.98"), source: source("recent-current") },
  ] },
  destination: { accountId: "roth", ownerId: "child", householdId: "hh", taxBucket: "roth_ira", trusteeId: "trustee",
    receivingTrusteeId: "trustee", route: "direct_trustee", source: source("destination") },
  authorization: { permitted: "yes", operationId: "transfer", claimId: "claim", holdingId: "holding", sourceAccountId: "cash",
    destinationAccountId: "roth", receivingTrusteeId: "trustee", amount: money("350.01"), source: source("authorization") },
  usage: { at, completeness: "all_beneficiary_lifetime_transfers_and_annual_ira_including_pending", source: source("usage"), entries: [previous(), regular()] },
  annualCapacity: capacity("ira_annual", "500.07"), compensationCapacity: capacity("ira_compensation", "450.03"),
});
const amount = (r: RothTransferRequest, value: string): RothTransferRequest => ({ ...r, amount: money(value), authorization: { ...r.authorization, amount: money(value) } });
const blocked = (r: RothTransferRequest, code: string): ReturnType<typeof propose529RothTransfers> => {
  const result = propose529RothTransfers([r]);
  expect(result.proposals).toEqual([]);
  expect(result.coverage).toHaveLength(9);
  expect(result.coverage.every(c => c.coverage === "incomplete" && c.diagnosticCode === code)).toBe(true);
  return result;
};

describe("B3-2 conditional 529 beneficiary Roth: PFA-DET §5.7 / S1–S8", () => {
  it("keeps exact-cent partitions and independent annual/compensation/lifetime room without posting", () => {
    const r = request(), before = JSON.stringify(r), result = propose529RothTransfers([r]), p = result.proposals[0]!;
    expect(result.proposals).toHaveLength(1);
    for (const [actual, expected] of [
      [p.grossAmount, "350.01"], [p.eligibleAmount, "750.05"], [p.excludedAmount, "250"],
      [p.eligibleBasis, "600.03"], [p.eligibleEarnings, "150.02"], [p.excludedBasis, "200.02"], [p.excludedEarnings, "49.98"],
      [p.availableAnnualRoom, "400.05"], [p.availableCompensationRoom, "350.01"], [p.availableLifetimeRoom, "399.96"],
    ] as const) expect(actual.equals(money(expected))).toBe(true);
    expect(result.bounds[0]!.permittedAmount.equals(money("350.01"))).toBe(true);
    expect(p.contractVersion).toBe("d2-shared/v1"); expect(p.committed).toBe(false); expect(p.postable).toBe(false);
    expect(p.physicalTransfer).toBe("not_applied"); expect(p.kind).toBe("529_beneficiary_roth_direct_trustee_transfer");
    expect(p.proposedCapacity.map(c => c.key)).toEqual([
      '["child",2026,"ira_annual","person","ira_annual"]', '["child",2026,"ira_compensation","person","ira_compensation"]',
    ]);
    expect(p.proposedCapacity.every(c => c.committed === false && c.proposedIncrement.equals(money("350.01")))).toBe(true);
    expect(p.proposedLifetimeIncrement.equals(money("350.01"))).toBe(true);
    expect(p.basisLotIds).toEqual([{ lotId: "old", basisId: "old-basis" }, { lotId: "recent", basisId: "recent-basis" }]);
    expect(p.traceRefs).toContain("other-plan-usage"); expect(p.receivingTrusteeId).toBe("trustee");
    expect(result.coverage.filter(c => c.coverage === "complete").map(c => c.affectedOutput)).toEqual(["eligibility", "basis_earnings", "annual_capacity", "lifetime_capacity"]);
    expect(result.coverage.filter(c => ["funding", "settlement", "federal_tax", "state_tax", "local_tax"].includes(c.affectedOutput)).every(c => c.coverage === "incomplete")).toBe(true);
    expect(JSON.stringify(r)).toBe(before); expect(Object.isFrozen(r.plan)).toBe(false);
    expect(Object.isFrozen(p)).toBe(true); expect(Object.isFrozen(p.sources[0])).toBe(true);
    expect(Object.isFrozen(p.proposedCapacity[0]!.legalLimitScope)).toBe(true);
    expect(p).not.toHaveProperty("planAssetDelta"); expect(p).not.toHaveProperty("taxFacts");
  });
  it("returns a bound without silently shrinking an oversized request", () => {
    const result = blocked(amount(request(), "350.02"), "REQUEST_EXCEEDS_PERMITTED_AMOUNT");
    expect(result.bounds[0]!.requestedAmount.equals(money("350.02"))).toBe(true);
    expect(result.bounds[0]!.permittedAmount.equals(money("350.01"))).toBe(true);
  });
  it("independently binds cash, annual room, lifetime room, eligible value and authorization", () => {
    const r = request();
    for (const [patch, expected] of [
      [{ plan: { ...r.plan, snapshot: { ...r.plan.snapshot, unencumberedCash: money("1.01") } } }, "1.01"],
      [{ annualCapacity: { ...r.annualCapacity, maximum: money("101.03") } }, "1.01"],
      [{ rules: { ...r.rules!, lifetimeMaximum: money("601.05") } }, "1.01"],
      [{ rules: { ...r.rules!, recentFrom: opened } }, "0"],
    ] as const) {
      const result = blocked({ ...r, ...patch }, "REQUEST_EXCEEDS_PERMITTED_AMOUNT");
      expect(result.bounds[0]!.permittedAmount.equals(money(expected))).toBe(true);
    }
    blocked({ ...r, authorization: { ...r.authorization, amount: money("350") } }, "EXACT_AUTHORIZATION_REQUIRED");
  });
  it("requires beneficiary-owned direct Roth trustee identity and the unique legal kind", () => {
    const r = request();
    for (const patch of [{ ownerId: "parent" }, { accountId: "cash" }, { taxBucket: "traditional_ira" as const },
      { route: "bank" as const }, { receivingTrusteeId: "wrong" }]) blocked({ ...r, destination: { ...r.destination, ...patch } }, "BENEFICIARY_ROTH_TRUSTEE_REQUIRED");
    for (const kind of ["regular_ira_contribution", "roth_conversion", "qualified_distribution"])
      blocked({ ...r, kind: kind as RothTransferRequest["kind"] }, "NOT_A_DIRECT_BENEFICIARY_TRANSFER");
  });
  it("admits no missing, stale, unverified, future or expired source law/facts", () => {
    const r = request();
    const { rules: _rules, ...withoutLaw } = r;
    blocked(withoutLaw, "SOURCED_LAW_REQUIRED");
    for (const patch of [{ verification: "unverified" as const }, { projectionStatus: "unavailable" as const },
      { publishedAt: civilDate("2026-01-16"), asOf: civilDate("2026-01-16") }, { endExclusive: at }])
      blocked({ ...r, rules: { ...r.rules!, source: source("bad-law", patch) } }, "SOURCE_UNVERIFIED_STALE_OR_UNAVAILABLE");
    blocked({ ...r, plan: { ...r.plan, source: source("stale", { asOf: civilDate("2026-01-14") }) } }, "SOURCE_UNVERIFIED_STALE_OR_UNAVAILABLE");
    blocked({ ...r, destination: { ...r.destination, source: source("bad", { beneficiaryId: "parent" }) } }, "SOURCE_SCOPE_MISMATCH");
    blocked({ ...r, authorization: { ...r.authorization, source: source("plan", { version: "conflict" }) } }, "CONFLICTING_SOURCE_ID");
  });
  it("requires plan and beneficiary history and sourced legal continuity", () => {
    const r = request();
    blocked({ ...r, rules: { ...r.rules!, minimumPlanAgeYears: 27 } }, "PLAN_AGE_NOT_MET");
    blocked({ ...r, history: { ...r.history, complete: "unknown" } }, "AGED_HISTORY_REQUIRED");
    blocked({ ...r, history: { ...r.history, beneficiarySince: civilDate("2020-01-01") } }, "BENEFICIARY_CONTINUITY_REQUIRED");
    const change = { changeId: "change", kind: "beneficiary_change" as const, at: civilDate("2020-01-01"), continuity: "verified_preserved" as const, source: source("continuity") };
    blocked({ ...r, history: { ...r.history, changes: [change] } }, "LEGAL_CONTINUITY_REQUIRED");
    const continuous: RothTransferRequest = { ...r, rules: { ...r.rules!, ageStartPermission: "sourced_continuity" },
      history: { ...r.history, beneficiarySince: change.at, changes: [change] } };
    expect(propose529RothTransfers([continuous]).proposals).toHaveLength(1);
    blocked({ ...continuous, history: { ...continuous.history, changes: [{ ...change, continuity: "unknown" }] } }, "LEGAL_CONTINUITY_REQUIRED");
  });
  it("tests exact age anniversary and inclusive recent-contribution boundary with earnings", () => {
    const r = request();
    expect(propose529RothTransfers([{ ...r, rules: { ...r.rules!, minimumPlanAgeYears: 26 } }]).proposals).toHaveLength(1);
    blocked({ ...r, history: { ...r.history, openedAt: civilDate("2000-01-16"), beneficiarySince: civilDate("2000-01-16"), ageStart: civilDate("2000-01-16") },
      rules: { ...r.rules!, minimumPlanAgeYears: 26 } }, "PLAN_AGE_NOT_MET");
    const atBoundary = { ...r, rules: { ...r.rules!, recentFrom: civilDate("2025-01-01") } };
    expect(propose529RothTransfers([atBoundary]).proposals[0]!.excludedAmount.equals(money("250"))).toBe(true);
    const afterBoundary = { ...r, rules: { ...r.rules!, recentFrom: civilDate("2025-01-02") } };
    expect(propose529RothTransfers([afterBoundary]).proposals[0]!.excludedAmount.isZero()).toBe(true);
  });
  it("rejects incomplete or duplicated global usage, mismatched annual identity, and replay", () => {
    const r = request();
    blocked({ ...r, usage: { ...r.usage, completeness: "unknown" } }, "EXHAUSTIVE_USAGE_REQUIRED");
    blocked({ ...r, usage: { ...r.usage, entries: [previous(), previous(), regular()] } }, "DUPLICATE_OR_MISSING_ID");
    blocked({ ...r, usage: { ...r.usage, entries: [previous()] } }, "IRA_CAPACITY_IDENTITY_OR_USAGE_MISMATCH");
    for (const patch of [{ personId: "parent" }, { taxYear: 2025 }, { completeness: "unknown" as const }, { ruleSnapshotId: "other" }])
      blocked({ ...r, annualCapacity: { ...r.annualCapacity, ...patch } }, "IRA_CAPACITY_IDENTITY_OR_USAGE_MISMATCH");
    blocked({ ...r, usage: { ...r.usage, entries: [{ ...previous(), operationId: r.operationId }, regular()] } }, "USAGE_IDENTITY_OR_DATE_INVALID");
    blocked({ ...r, taxYear: 2025 }, "EVENT_YEAR_REQUIRED");
  });
  it("counts independently authorized future same-year claims, including another owner", () => {
    const r = request(), pending: RothUsage = { ...previous(), operationId: "pending", claimId: "pending-claim", effectiveAt: civilDate("2026-12-31"),
      taxYear: 2026, state: "pending_authorized", amount: money("50.01"), basis: money("40"), earnings: money("10.01") };
    const result = blocked({ ...r, usage: { ...r.usage, entries: [...r.usage.entries, pending] },
      annualCapacity: { ...r.annualCapacity, used: money("150.03") }, compensationCapacity: { ...r.compensationCapacity, used: money("150.03") } }, "REQUEST_EXCEEDS_PERMITTED_AMOUNT");
    expect(result.bounds[0]!.permittedAmount.equals(money("300"))).toBe(true);
    blocked({ ...r, usage: { ...r.usage, entries: [{ ...regular(), effectiveAt: civilDate("2027-01-01") }, previous()] } }, "USAGE_IDENTITY_OR_DATE_INVALID");
  });
  it("requires exact currency/cents and reconciled basis, earnings and exhaustive holding identity", () => {
    const r = request();
    blocked(amount(r, "350.001"), "EXACT_MONEY_REQUIRED");
    blocked({ ...r, amount: money("350.01", Currency.of("EUR")) }, "EXACT_MONEY_REQUIRED");
    blocked({ ...r, plan: { ...r.plan, snapshot: { ...r.plan.snapshot, contributionBasis: money("800.04") } } }, "PLAN_BALANCES_NOT_RECONCILED");
    blocked({ ...r, plan: { ...r.plan, contributions: [] } }, "BASIS_HISTORY_NOT_RECONCILED");
    blocked({ ...r, holdings: { ...r.holdings, complete: "unknown" } }, "EXHAUSTIVE_HOLDINGS_REQUIRED");
    blocked({ ...r, holdings: { ...r.holdings, lots: r.holdings.lots.slice(0, 1) } }, "LOT_PARTITION_INCOMPLETE");
    blocked({ ...r, holdings: { ...r.holdings, lots: r.holdings.lots.map(l => ({ ...l, basisId: `wrong-${l.basisId}` })) } }, "LOT_BASIS_IDENTITY_INVALID");
    blocked({ ...r, holdings: { ...r.holdings, lots: r.holdings.lots.map(l => ({ ...l, earnings: money("0") })) } }, "LOT_PARTITION_NOT_RECONCILED");
  });
  it("is deterministic across lot/usage order and never freezes caller containers", () => {
    const r = request(), reversed: RothTransferRequest = { ...r, usage: { ...r.usage, entries: [...r.usage.entries].reverse() },
      holdings: { ...r.holdings, lots: [...r.holdings.lots].reverse() }, plan: { ...r.plan, contributions: [...r.plan.contributions].reverse() } };
    expect(propose529RothTransfers([r])).toEqual(propose529RothTransfers([reversed]));
    const shallowFrozen = { ...r, plan: { ...r.plan, source: Object.freeze({ ...r.plan.source }) } };
    const result = propose529RothTransfers([shallowFrozen]);
    expect(result.proposals[0]!.sources.find(s => s.sourceId === "plan")).not.toBe(shallowFrozen.plan.source);
    expect(Object.isFrozen(r.usage.entries)).toBe(false);
  });
  it("rejects duplicate IDs, repeated object references, and competing batch resources without a winner", () => {
    const r = request(), second: RothTransferRequest = { ...r, operationId: "second", claimId: "second-claim",
      authorization: { ...r.authorization, operationId: "second", claimId: "second-claim" } };
    for (const input of [[r, r], [r, { ...r }]]) {
      const result = propose529RothTransfers(input);
      expect(result.proposals).toEqual([]); expect(result.coverage.every(c => c.diagnosticCode === "BATCH_DUPLICATE_ID")).toBe(true);
    }
    const forward = propose529RothTransfers([r, second]), reverse = propose529RothTransfers([second, r]);
    expect(forward).toEqual(reverse); expect(forward.proposals).toEqual([]);
    expect(forward.coverage.every(c => c.diagnosticCode === "BATCH_SHARED_RESOURCE")).toBe(true);
  });
  it("sorts disjoint positive requests independently and diagnoses conflicting duplicate facts deterministically", () => {
    const r = request();
    // Rename only identity namespaces, preserving Money and literal scope kind.
    const rename = (v: unknown, field = ""): unknown => {
      if (v instanceof Money || v instanceof Currency) return v;
      if (Array.isArray(v)) return v.map(x => rename(x));
      if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, value]) => [k, rename(value, k)]));
      return typeof v === "string" && field.endsWith("Id") && field !== "aggregationId" ? `z-${v}` : v;
    };
    const other = rename(r) as RothTransferRequest;
    const result = propose529RothTransfers([other, r]);
    expect(result.proposals.map(p => p.operationId)).toEqual(["transfer", "z-transfer"]);
    expect(result).toEqual(propose529RothTransfers([r, other]));
    const duplicate = { ...r, taxYear: 2025 };
    expect(propose529RothTransfers([r, duplicate])).toEqual(propose529RothTransfers([duplicate, r]));
  });
  it("subtracts pending same-plan source once, and reconciles posted same-plan Roth basis without another cash debit", () => {
    const r = request();
    const samePlan = { ...previous(), ownerId: "parent", planId: "plan", providerId: "provider", source: source("same-plan-transfer") };
    const posted: RothTransferRequest = { ...r, usage: { ...r.usage, entries: [samePlan, regular()] },
      plan: { ...r.plan, contributions: r.plan.contributions.map(c => c.lotId === "old" ? { ...c, principal: money("1000.03") } : c) } };
    // Original basis 1,200.05 less prior Roth basis 400 = current 800.05.
    expect(propose529RothTransfers([posted]).proposals[0]!.originalLiquidCash.equals(money("900"))).toBe(true);
    const pending: RothUsage = { ...samePlan, operationId: "pending-local", claimId: "pending-local-claim", state: "pending_authorized",
      effectiveAt: civilDate("2026-12-31"), taxYear: 2026, amount: money("50.01"), basis: money("40"), earnings: money("10.01") };
    const pendingRequest: RothTransferRequest = { ...r, usage: { ...r.usage, entries: [...r.usage.entries, pending] },
      annualCapacity: { ...r.annualCapacity, used: money("150.03") }, compensationCapacity: { ...r.compensationCapacity, used: money("150.03") },
      plan: { ...r.plan, snapshot: { ...r.plan.snapshot, unencumberedCash: money("300.02") } } };
    const result = blocked(pendingRequest, "REQUEST_EXCEEDS_PERMITTED_AMOUNT");
    expect(result.bounds[0]!.permittedAmount.equals(money("250.01"))).toBe(true);
  });
});
