import { describe, expect, it } from "vitest";
import { money } from "../../../../../src/values/index.js";
import { civilDate } from "../../../../../src/time/index.js";
import { annual, five, scenario } from "./fixtures.js";

describe("independent A2 original qualification: conditional economics", () => {
  it("preserves all five families, shared 403(b)/TSP/SIMPLE deferrals and separate 457 capacity", () => {
    const s = scenario(), result = s.run();
    expect(result.diagnostics).toEqual([]);
    expect(result.coverage.every(c => c.coverage === "conditional")).toBe(true);
    expect(result.candidates.map(c => c.family)).toEqual(five.map(r => r.family));
    expect(result.candidates.every(c => c.amount.equals(money("1.01")))).toBe(true);
    const shared = result.capacityProposals.find(c => c.limitScope.kind === "aggregate_deferral")!;
    expect(shared.priorUsage.equals(money("17.25"))).toBe(true);
    expect(shared.proposedIncrement.equals(money("3.03"))).toBe(true);
    expect(shared.proposedUsage.equals(money("20.28"))).toBe(true);
    const separate = result.capacityProposals.find(c => c.limitScope.kind === "governmental_457")!;
    expect(separate.proposedUsage.equals(money("1.01"))).toBe(true);
    const sep = result.candidates.find(c => c.family === "sep_ira")!;
    expect(sep.payer).toBe("employer");
    expect(sep.fundingIntent.kind).toBe("employer_owned_asset_intent");
    expect(result).toMatchObject({ committed: false, postable: false, funding: "incomplete", tax: "incomplete", settlement: "incomplete" });
    expect(Object.isFrozen(result.originals)).toBe(true);
    expect(result.originals.every(o => o.environment === "simulation" && Object.isFrozen(o))).toBe(true);
  });

  it("keeps two people's shared scopes independent", () => {
    const s = scenario([{ family: "403b", person: "one" }, { family: "federal_tsp", person: "two" }]);
    const result = s.run();
    expect(result.diagnostics).toEqual([]);
    const scopes = result.capacityProposals.filter(c => c.limitScope.kind === "aggregate_deferral");
    expect(scopes).toHaveLength(2);
    expect(scopes.every(c => c.proposedUsage.equals(money("18.26")))).toBe(true);
    expect(new Set(scopes.map(c => c.personId)).size).toBe(2);
  });

  it("admits source-funded employer SIMPLE additions independently of employee deferrals", () => {
    const result = scenario([{ family: "simple_ira", payer: "employer" }, { family: "simple_ira" }]).run();
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]!.contributionType).toBe("employer_addition");
    expect(result.capacityProposals.filter(c => c.limitScope.kind === "employer")).toHaveLength(1);
    expect(result.capacityProposals.filter(c => c.limitScope.kind === "simple_deferral")).toHaveLength(1);
  });

  it("is pure on replay of unchanged originals; request order and horizon extension preserve identity", () => {
    const s = scenario(), request = s.request();
    const short = s.run({ ...request, period: { start: annual.start, endExclusive: civilDate("2026-03-01") } });
    const long = s.run({ ...request, operationIds: [...request.operationIds].reverse() });
    expect(short.candidates).toEqual(long.candidates);
    expect(short.capacityProposals).toEqual(long.capacityProposals);
    expect(s.run()).toEqual(long);
    expect(s.run(request, [...s.providers].reverse())).toEqual(long);
    expect(s.request()).toEqual(request);
  });

  it("rejects exhausted aggregate capacity atomically instead of choosing a first input", () => {
    const s = scenario();
    s.edit("legal", o => ({ ...o, payload: { ...o.payload, capacities: o.payload.capacities.map(c =>
      c.limitScope.kind === "aggregate_deferral" ? { ...c, maximum: money("19.00") } : c) } }));
    const a = s.run(), b = s.run({ ...s.request(), operationIds: [...s.request().operationIds].reverse() });
    expect(a.candidates).toEqual([]);
    expect(a.capacityProposals).toEqual([]);
    expect(a).toEqual(b);
    expect(a.coverage.some(c => c.diagnosticCodes.includes("CAPACITY_EXCEEDED"))).toBe(true);
  });

  it("does not accept a proposal as funding authority", () => {
    const s = scenario(), request = s.request();
    expect(s.run({ ...request, operationIds: ["caller-invented-operation"] }).candidates).toEqual([]);
    expect(s.run(request, s.providers.filter(p => p.role !== "funding")).candidates).toEqual([]);
  });

  it("admits explicitly authorized 403(b) after-tax cents without borrowing deferral capacity", () => {
    const s = scenario([{ family: "403b" }]);
    s.edit("plan", o => ({ ...o, payload: { members: o.payload.members.map(m => ({ ...m,
      permissions: m.permissions.map(p => ({ ...p, taxBucket: "non_roth_after_tax", contributionType: "employee_after_tax" })) })) } }));
    s.edit("legal", o => ({ ...o, payload: { ...o.payload, permissions: o.payload.permissions.map(p => ({ ...p,
      permission: { ...p.permission, taxBucket: "non_roth_after_tax", contributionType: "employee_after_tax" },
      capacities: p.capacities.filter(c => c.limitScope.kind !== "aggregate_deferral") })) } }));
    s.edit("funding", o => ({ ...o, payload: { authorizations: o.payload.authorizations.map(a => ({ ...a,
      taxBucket: "non_roth_after_tax", contributionType: "employee_after_tax" })) } }));
    const result = s.run();
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.taxCharacter).toBe("employee_after_tax_basis");
    expect(result.capacityProposals.some(c => c.limitScope.kind === "aggregate_deferral")).toBe(false);
  });
});
