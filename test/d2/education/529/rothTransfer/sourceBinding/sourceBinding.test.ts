import { describe, expect, it } from "vitest";
import { bind529RothSources, rothOriginalDigest, type RothOriginalRole, type RothOriginalPorts, type RothSourceBinding } from "../../../../../../src/simulation/d2/education/529/rothTransfer/sourceBinding/index.js";
import type { RothTransferRequest as Request } from "../../../../../../src/simulation/d2/education/529/rothTransfer/index.js";
import { civilDate } from "../../../../../../src/time/index.js";
import { money } from "../../../../../../src/values/index.js";
import { at, fixture, request } from "./fixtures.js";

const run = (r: Request) => { const f = fixture(r); return bind529RothSources([f.binding], f.ports); };
const codes = (r: Request) => run(r).occurrences[0]!.coverage.map(c => c.diagnosticCode);
const roles = ["plan", "trustee", "law", "annual", "compensation"] as const;

describe("#147 conditional ORIGINAL 529→beneficiary Roth binding", () => {
  it("preserves the independently authored exact-cent oracle and never posts or reserves", () => {
    const f = fixture(), before = JSON.stringify(f), result = bind529RothSources([f.binding], f.ports);
    expect(result.diagnostics).toEqual([]);
    const o = result.occurrences[0]!, e = o.economics!;
    for (const [actual, expected] of [
      [e.grossAmount, "350.01"], [e.eligibleAmount, "750.05"], [e.excludedAmount, "250"],
      [e.eligibleBasis, "600.03"], [e.eligibleEarnings, "150.02"], [e.excludedBasis, "200.02"], [e.excludedEarnings, "49.98"],
      [e.availableAnnualRoom, "400.05"], [e.availableCompensationRoom, "350.01"], [e.availableLifetimeRoom, "399.96"],
    ] as const) expect(actual.equals(money(expected))).toBe(true);
    expect(o.bound!.permittedAmount.equals(money("350.01"))).toBe(true);
    expect(o).toMatchObject({ committed: false, postable: false, physicalTransfer: "not_applied",
      capacityReservation: "incomplete", taxLiability: "incomplete" });
    expect(o.coverage.filter(c => c.coverage === "complete")).toHaveLength(4);
    expect(JSON.stringify(f)).toBe(before);
    expect(Object.isFrozen(o.economics)).toBe(true); expect(Object.isFrozen(o.originals.plan)).toBe(true);
    expect(Object.isFrozen(f.binding)).toBe(false);
    for (const name of ["sources", "lots", "contributions", "planAssetDelta", "cashDelta", "taxFacts"]) expect(o).not.toHaveProperty(name);
  });

  it("requires independently retrieved annual AND compensation originals, regardless of complete flags or matching pins", () => {
    const f = fixture();
    for (const role of ["annual", "compensation"] as const) {
      const ports = { ...f.ports }; delete ports[role];
      const result = bind529RothSources([f.binding], ports);
      expect(result.occurrences).toEqual([]);
      expect(result.diagnostics[0]).toMatchObject({ code: "INDEPENDENT_CAPACITY_REQUIRED", missingPort: role });
    }
    const annual = { ...f.originals.annual, providerId: f.originals.plan.providerId };
    const b = { ...f.binding, originals: { ...f.binding.originals, annual: { ...f.binding.originals.annual,
      providerId: annual.providerId, digest: rothOriginalDigest(annual) } } };
    expect(bind529RothSources([b], { ...f.ports, annual: () => annual }).diagnostics[0]!.code).toBe("INDEPENDENT_CAPACITY_REQUIRED");
  });

  it.each(roles)("refuses unavailable, withdrawn, throwing or changed %s originals", role => {
    const f = fixture();
    for (const port of [() => undefined, () => { throw new Error("refused"); }, () => ({ ...f.originals[role], status: "withdrawn" as const })]) {
      const result = bind529RothSources([f.binding], { ...f.ports, [role]: port });
      expect(result.occurrences).toEqual([]); expect(result.diagnostics[0]!.code).toBe("ORIGINAL_UNAVAILABLE");
    }
    const result = bind529RothSources([f.binding], { ...f.ports, [role]: () => ({ ...f.originals[role], version: "v2" }) });
    expect(result.diagnostics[0]!.code).toBe("ORIGINAL_CHANGED");
  });

  it.each(roles)("re-reads %s after evaluation and detects withdrawal/amendment without emitting stale economics", role => {
    for (const amendment of [false, true]) {
      const f = fixture(), calls = new Map<RothOriginalRole, number>();
      const ports = Object.fromEntries(roles.map(k => [k, () => {
        const count = (calls.get(k) ?? 0) + 1; calls.set(k, count);
        return k === role && count === 2 ? { ...f.originals[k], ...(amendment ? { version: "v2" } : { status: "withdrawn" }) } : f.originals[k];
      }])) as RothOriginalPorts;
      const result = bind529RothSources([f.binding], ports);
      expect(result.occurrences).toEqual([]);
      expect(result.diagnostics[0]!.code).toBe(amendment ? "ORIGINAL_CHANGED" : "ORIGINAL_UNAVAILABLE");
      expect([...calls.values()]).toEqual([2, 2, 2, 2, 2]);
    }
  });

  it("detects one-cent full-record amendments, original account mismatches, late envelopes and conflicting current use", () => {
    const f = fixture();
    const amended = { ...f.originals.plan, payload: { ...f.originals.plan.payload, plan: { ...f.originals.plan.payload.plan,
      snapshot: { ...f.originals.plan.payload.plan.snapshot, earnings: money("200.01") } } } };
    expect(bind529RothSources([f.binding], { ...f.ports, plan: () => amended }).diagnostics[0]!.code).toBe("ORIGINAL_CHANGED");
    const wrong = { ...f.originals.plan, payload: { ...f.originals.plan.payload, plan: { ...f.originals.plan.payload.plan, accountId: "wrong-account" } } };
    const wrongBinding = { ...f.binding, originals: { ...f.binding.originals, plan: { ...f.binding.originals.plan, digest: rothOriginalDigest(wrong) } } };
    expect(bind529RothSources([wrongBinding], { ...f.ports, plan: () => wrong }).diagnostics[0]!.code).toBe("ORIGINAL_SCOPE_MISMATCH");
    const late = { ...f.originals.law, publishedAt: civilDate("2026-01-16") };
    const lateBinding = { ...f.binding, originals: { ...f.binding.originals, law: { ...f.binding.originals.law, digest: rothOriginalDigest(late) } } };
    expect(bind529RothSources([lateBinding], { ...f.ports, law: () => late }).diagnostics[0]!.code).toBe("ORIGINAL_AFTER_EVENT");
    const compensation = { ...f.originals.compensation, payload: { ...f.originals.compensation.payload,
      usage: { ...f.originals.compensation.payload.usage, entries: [] } } };
    const b = { ...f.binding, originals: { ...f.binding.originals, compensation: { ...f.binding.originals.compensation, digest: rothOriginalDigest(compensation) } } };
    expect(bind529RothSources([b], { ...f.ports, compensation: () => compensation }).diagnostics[0]!.code).toBe("CAPACITY_USAGE_CONFLICT");
    let reads = 0;
    expect(bind529RothSources([f.binding], { ...f.ports, plan: () => ++reads === 1 ? f.originals.plan : amended })
      .diagnostics[0]!.code).toBe("ORIGINAL_CHANGED");
  });

  it("still re-reads all originals after an oversized instruction returns incomplete", () => {
    const r = request(), f = fixture({ ...r, annualCapacity: { ...r.annualCapacity, maximum: money("101.03") } });
    let reads = 0;
    const result = bind529RothSources([f.binding], { ...f.ports, annual: () => ++reads === 1 ? f.originals.annual : undefined });
    expect(reads).toBe(2); expect(result.occurrences).toEqual([]);
    expect(result.diagnostics[0]!.code).toBe("ORIGINAL_UNAVAILABLE");
  });

  it("delegates age, lifecycle, complete history, destination, route and dated law checks", () => {
    const r = request();
    const cases: readonly [Request, string][] = [
      [{ ...r, rules: { ...r.rules!, minimumPlanAgeYears: 27 } }, "PLAN_AGE_NOT_MET"],
      [{ ...r, history: { ...r.history, complete: "unknown" } }, "AGED_HISTORY_REQUIRED"],
      [{ ...r, history: { ...r.history, beneficiarySince: civilDate("2020-01-01") } }, "BENEFICIARY_CONTINUITY_REQUIRED"],
      [{ ...r, holdings: { ...r.holdings, complete: "unknown" } }, "EXHAUSTIVE_HOLDINGS_REQUIRED"],
      [{ ...r, destination: { ...r.destination, ownerId: r.plan.ownerId } }, "BENEFICIARY_ROTH_TRUSTEE_REQUIRED"],
      [{ ...r, destination: { ...r.destination, ownerId: "other-child" } }, "BENEFICIARY_ROTH_TRUSTEE_REQUIRED"],
      [{ ...r, destination: { ...r.destination, route: "bank" } }, "BENEFICIARY_ROTH_TRUSTEE_REQUIRED"],
      [{ ...r, destination: { ...r.destination, trusteeId: "wrong-trustee" } }, "BENEFICIARY_ROTH_TRUSTEE_REQUIRED"],
      [{ ...r, authorization: { ...r.authorization, sourceAccountId: "wrong" } }, "EXACT_AUTHORIZATION_REQUIRED"],
      [{ ...r, rules: { ...r.rules!, source: { ...r.rules!.source, verification: "unverified" } } }, "SOURCE_UNVERIFIED_STALE_OR_UNAVAILABLE"],
      [{ ...r, knownAt: civilDate("2028-01-01"), rules: { ...r.rules!, source: { ...r.rules!.source,
        publishedAt: civilDate("2027-01-01"), asOf: civilDate("2027-01-01") } } }, "SOURCE_UNVERIFIED_STALE_OR_UNAVAILABLE"],
    ];
    for (const [candidate, code] of cases) expect(codes(candidate)).toEqual(Array(9).fill(code));
    const change = { changeId: "change", kind: "beneficiary_change" as const, at: civilDate("2020-01-01"),
      continuity: "unknown" as const, source: r.history.source };
    expect(codes({ ...r, rules: { ...r.rules!, ageStartPermission: "sourced_continuity" },
      history: { ...r.history, beneficiarySince: change.at, changes: [change] } })).toContain("LEGAL_CONTINUITY_REQUIRED");
    const preserved = { ...r, rules: { ...r.rules!, ageStartPermission: "sourced_continuity" as const },
      history: { ...r.history, beneficiarySince: change.at, changes: [{ ...change, continuity: "verified_preserved" as const }] } };
    expect(run(preserved).diagnostics).toEqual([]);
    expect(run({ ...r, rules: { ...r.rules!, minimumPlanAgeYears: 26 } }).diagnostics).toEqual([]);
    const atBoundary = run({ ...r, rules: { ...r.rules!, recentFrom: civilDate("2025-01-01") } });
    expect(atBoundary.occurrences[0]!.economics!.excludedAmount.equals(money("250"))).toBe(true);
  });

  it("keeps bounds without partial proposals when annual, compensation, lifetime or recent exclusions bind", () => {
    const r = request();
    for (const candidate of [
      { ...r, annualCapacity: { ...r.annualCapacity, maximum: money("101.03") } },
      { ...r, compensationCapacity: { ...r.compensationCapacity, maximum: money("101.03") } },
      { ...r, rules: { ...r.rules!, lifetimeMaximum: money("601.05") } },
    ]) {
      const result = run(candidate), o = result.occurrences[0]!;
      expect(o.economics).toBeNull(); expect(o.bound!.permittedAmount.equals(money("1.01"))).toBe(true);
      expect(result.diagnostics[0]!.code).toBe("EVALUATION_INCOMPLETE");
    }
    const result = run({ ...r, rules: { ...r.rules!, recentFrom: r.history.openedAt } });
    expect(result.occurrences[0]!.bound!.permittedAmount.isZero()).toBe(true);
    expect(result.occurrences[0]!.economics).toBeNull();
  });

  it("counts pending and posted IRA usage without recycling claims or stale capacity", () => {
    const r = request(), regular = r.usage.entries[1]!;
    const pending = { ...regular, state: "pending_authorized" as const, effectiveAt: civilDate("2026-12-01") };
    const accepted = run({ ...r, usage: { ...r.usage, entries: [r.usage.entries[0]!, pending] } });
    expect(accepted.diagnostics).toEqual([]);
    expect(accepted.occurrences[0]!.economics!.availableCompensationRoom.equals(money("350.01"))).toBe(true);
    for (const patch of [
      { usage: { ...r.usage, entries: [r.usage.entries[0]!, regular, pending] } },
      { usage: { ...r.usage, entries: [r.usage.entries[0]!, { ...regular, claimId: r.claimId }] } },
      { usage: { ...r.usage, completeness: "unknown" as const } },
      { annualCapacity: { ...r.annualCapacity, asOf: civilDate("2026-01-14") } },
      { compensationCapacity: { ...r.compensationCapacity, used: money("100.01") } },
    ]) expect(run({ ...r, ...patch }).occurrences[0]!.economics).toBeNull();
  });

  it("rejects every contested identity/source without a winner, preserving independent candidates and permutations", () => {
    const a = fixture(), independent = fixture(request("999"));
    const renamed = { ...a.binding, event: { ...a.binding.event, eventId: "reissued-event", operationId: "reissued-operation", claimId: "reissued-claim" } };
    const all = [a.binding, renamed, independent.binding];
    const ports: RothOriginalPorts = {
      plan: p => p.sourceId === a.originals.plan.sourceId ? a.originals.plan : independent.originals.plan,
      trustee: p => p.sourceId === a.originals.trustee.sourceId ? a.originals.trustee : independent.originals.trustee,
      law: p => p.sourceId === a.originals.law.sourceId ? a.originals.law : independent.originals.law,
      annual: p => p.sourceId === a.originals.annual.sourceId ? a.originals.annual : independent.originals.annual,
      compensation: p => p.sourceId === a.originals.compensation.sourceId ? a.originals.compensation : independent.originals.compensation,
    };
    const result = bind529RothSources(all, ports);
    expect(result.occurrences.map(o => o.event.eventId)).toEqual([independent.binding.event.eventId]);
    expect(result.diagnostics.map(d => d.code)).toEqual(["CONTESTED_CLAIM", "CONTESTED_CLAIM"]);
    expect(bind529RothSources([...all].reverse(), ports)).toEqual(result);
    for (const other of [a.binding, { ...independent.binding, event: { ...independent.binding.event, claimId: a.binding.event.claimId } },
      { ...independent.binding, identity: { ...independent.binding.identity, householdId: a.binding.identity.householdId,
        beneficiaryId: a.binding.identity.beneficiaryId } },
      { ...independent.binding, originals: { ...independent.binding.originals, annual: a.binding.originals.annual } },
    ]) {
      const contested = bind529RothSources([a.binding, other], ports);
      expect(contested.occurrences).toEqual([]); expect(contested.diagnostics.every(d => d.code === "CONTESTED_CLAIM")).toBe(true);
    }
  });

  it("emits proportional compact output for 1/12/120 events, with horizon-stable identities and no raw originals", () => {
    const fixtures = Array.from({ length: 120 }, (_, i) => fixture(request(String(i).padStart(3, "0"))));
    // Publishers may retain large shared law catalogs; these never travel in event outputs.
    const catalogs = { catalog: "RAW_CATALOG_MARKER".repeat(1000) };
    const records = fixtures.map(f => ({ ...f.originals,
      law: { ...f.originals.law, ...catalogs } }));
    const bindings: RothSourceBinding[] = fixtures.map((f, i) => ({ ...f.binding, originals: { ...f.binding.originals,
      law: { ...f.binding.originals.law, digest: rothOriginalDigest(records[i]!.law) } } }));
    const ports: RothOriginalPorts = {
      plan: p => records.find(r => r.plan.sourceId === p.sourceId)?.plan,
      trustee: p => records.find(r => r.trustee.sourceId === p.sourceId)?.trustee,
      law: p => records.find(r => r.law.sourceId === p.sourceId)?.law,
      annual: p => records.find(r => r.annual.sourceId === p.sourceId)?.annual,
      compensation: p => records.find(r => r.compensation.sourceId === p.sourceId)?.compensation,
    };
    const results = [1, 12, 120].map(n => bind529RothSources(bindings.slice(0, n), ports));
    for (const [i, n] of [1, 12, 120].entries()) {
      const result = results[i]!, serialized = JSON.stringify(result);
      expect(result.diagnostics).toEqual([]); expect(result.occurrences).toHaveLength(n);
      expect(serialized).not.toMatch(/RAW_ORIGINAL_MARKER|RAW_CATALOG_MARKER|sourcePublication|basisLotIds|contributions|"sources"/);
      expect(serialized.length).toBeLessThan(JSON.stringify(results[0]).length * n * 1.01);
      expect(result.occurrences[0]!.event).toEqual(results[0]!.occurrences[0]!.event);
    }
  });
});
