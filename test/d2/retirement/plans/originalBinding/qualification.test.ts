import { describe, expect, it } from "vitest";
import { civilDate } from "../../../../../src/time/index.js";
import { money } from "../../../../../src/values/index.js";
import { planOriginalPin, type BindingResult, type OriginalRole } from "../../../../../src/simulation/d2/retirement/plans/originalBinding/index.js";
import { scenario } from "./fixtures.js";

function rejected(result: BindingResult, code?: string): void {
  expect(result.candidates).toEqual([]);
  expect(result.capacityProposals).toEqual([]);
  expect(result.coverage.every(c => c.coverage === "incomplete")).toBe(true);
  if (code) expect(result.coverage.some(c => c.diagnosticCodes.includes(code))).toBe(true);
}

describe("source qualification and hostile originals", () => {
  it.each(["personId", "sponsorId", "destinationAccountId", "planId"] as const)("rejects a wrong funding %s", field => {
    const s = scenario();
    s.edit("funding", o => ({ ...o, payload: { authorizations: o.payload.authorizations.map((a, i) => i ? a : { ...a, [field]: "wrong" }) } }));
    rejected(s.run(), "IDENTITY_CONFLICT");
  });
  it("requires owned enrollment destinations", () => {
    const s = scenario();
    s.edit("plan", o => ({ ...o, payload: { members: o.payload.members.map((m, i) => i ? m : { ...m, ownerPersonId: "other-person" }) } }));
    rejected(s.run(), "IDENTITY_CONFLICT");
  });
  it.each(["plan", "funding", "legal", "history"] as OriginalRole[])("re-reads all roles after missing %s", role => {
    const s = scenario();
    rejected(s.run(s.request(), s.providers.filter(p => p.role !== role)), "MISSING_PROVIDER");
    for (const [r, count] of Object.entries(s.readCounts)) expect(count).toBe(r === role ? 0 : 2);
  });
  it("rejects transport tampering even with a newly computed full-original witness", () => {
    const s = scenario();
    const funding = s.originals.find(o => o.role === "funding")!;
    const forged = { ...funding, version: "caller-self-signed-v2" };
    s.transportChanges.set("funding", b => ({ ...b, originals: [forged] }));
    rejected(s.run({ ...s.request(), pins: s.request().pins.map(p => p.role === "funding" ? planOriginalPin(forged) : p) }), "UNAUTHENTICATED_SOURCE");
  });
  it("rejects source races that withdraw the second-read original", () => {
    const s = scenario();
    s.sourceChanges.set("history", (b, read) => read === 1 ? b : ({ ...b, originals: b.originals.map(o => ({ ...o, status: "withdrawn" })) }));
    rejected(s.run(), "SOURCE_RACE");
    expect(Object.values(s.readCounts)).toEqual([2, 2, 2, 2]);
  });
  it("re-reads disputed and unused records after an independent qualification failure", () => {
    const s = scenario();
    s.sourceChanges.set("plan", b => ({ ...b, originals: [...b.originals, ...b.originals] }));
    s.sourceChanges.set("funding", (b, read) => read === 1 ? b : ({ ...b, revisions: [{ originalId: "unused", revisionId: "withdrawn-unused",
      knownAt: civilDate("2026-01-31"), effective: b.originals[0]!.effective, kind: "withdrawal" }] }));
    rejected(s.run({ ...s.request(), operationIds: [s.request().operationIds[0]!] }), "COMPETING_ORIGINALS");
    expect(s.readCounts).toEqual({ plan: 2, funding: 2, legal: 2, history: 2 });
  });
  it.each(["legal", "funding"] as const)("rejects future-known %s evidence", role => {
    const s = scenario();
    s.edit(role, o => ({ ...o, knownAt: civilDate("2026-02-02") }));
    rejected(s.run(), "UNAVAILABLE_SOURCE");
  });
  it("rejects a known amendment, even if effective after the display horizon", () => {
    const s = scenario();
    s.sourceChanges.set("legal", b => ({ ...b, revisions: [{ originalId: "law", revisionId: "correction",
      knownAt: civilDate("2026-01-31"), effective: { start: civilDate("2026-12-01"), endExclusive: civilDate("2027-01-01") }, kind: "amendment" }] }));
    rejected(s.run(), "KNOWN_REVISION");
  });
  it("rejects partial inventory and incomplete cross-employer/family usage", () => {
    for (const kind of ["inventory", "employer", "family", "prior", "empty"] as const) {
      const s = scenario();
      if (kind === "inventory") s.sourceChanges.set("history", b => ({ ...b, coverage: "partial" }));
      else s.edit("history", o => ({ ...o, payload: { ...o.payload,
        people: o.payload.people.map(p => ({ ...p,
          sponsorIds: kind === "employer" ? [] : p.sponsorIds,
          families: kind === "family" ? p.families.filter(f => f !== "401k") : p.families })),
        capacities: kind === "prior" || kind === "empty" ? [] : o.payload.capacities,
        operations: kind === "empty" ? [] : o.payload.operations } }));
      rejected(s.run());
    }
  });
  it("cannot remove consumed operations while retaining their authoritative usage", () => {
    const s = scenario();
    s.edit("history", o => ({ ...o, payload: { ...o.payload, operations: [] } }));
    rejected(s.run(), "INCOMPLETE_HISTORY");
  });
  it("requires an explicit authenticated zero declaration for unused capacities", () => {
    const s = scenario();
    s.edit("history", o => ({ ...o, payload: { ...o.payload, capacities: o.payload.capacities.map(c =>
      c.evidence === "confirmed_zero" ? { ...c, evidence: "itemized_consumption" as const } : c) } }));
    rejected(s.run(), "INCOMPLETE_HISTORY");
  });
  it.each(["operationId", "claimId", "sourceReferenceId"] as const)("rejects historical %s replay across plan identities", field => {
    const s = scenario();
    s.edit("funding", o => ({ ...o, payload: { authorizations: o.payload.authorizations.map((a, i) => i ? a :
      { ...a, [field]: field === "operationId" ? "prior-401k:member-a" : `prior-401k:member-a:${field === "claimId" ? "claim" : "item"}` }) } }));
    // Select a different operation: unused disputed originals still cannot win.
    rejected(s.run({ ...s.request(), operationIds: [s.request().operationIds[1]!] }), "REPLAYED_CLAIM");
  });
  it("rejects duplicate claims and operation proposals", () => {
    const s = scenario();
    rejected(s.run({ ...s.request(), operationIds: [s.request().operationIds[0]!, s.request().operationIds[0]!] }), "INVALID_ORIGINAL");
    s.edit("funding", o => ({ ...o, payload: { authorizations: o.payload.authorizations.map((a, i, rows) => i === 1 ? { ...a, claimId: rows[0]!.claimId } : a) } }));
    rejected(s.run(), "REPLAYED_CLAIM");
  });
  it("rejects competing legal scope versions", () => {
    const s = scenario();
    s.edit("legal", o => ({ ...o, payload: { ...o.payload, capacities: [...o.payload.capacities,
      { ...o.payload.capacities[0]!, ruleSnapshotId: "competing-version" }] } }));
    rejected(s.run(), "IDENTITY_CONFLICT");
  });
  it("requires both employer plan permission and employer funding character", () => {
    const s = scenario([{ family: "sep_ira" }]);
    s.edit("plan", o => ({ ...o, payload: { members: o.payload.members.map(m => ({ ...m, permissions: [] })) } }));
    rejected(s.run(), "INCOMPLETE_INVENTORY");
    const t = scenario([{ family: "sep_ira" }]);
    t.edit("funding", o => ({ ...o, payload: { authorizations: o.payload.authorizations.map(a => ({ ...a, kind: "payroll" })) } }));
    rejected(t.run(), "FUNDING_IDENTITY_MISMATCH");
  });
  it("requires signed funding authority and same-person eligible compensation", () => {
    const s = scenario();
    s.edit("funding", o => ({ ...o, payload: { authorizations: o.payload.authorizations.map(a => ({ ...a, signedBy: "caller" })) } }));
    rejected(s.run(), "IDENTITY_CONFLICT");
    const t = scenario();
    t.edit("funding", o => ({ ...o, payload: { authorizations: o.payload.authorizations.map(a => ({ ...a,
      compensation: { ...a.compensation, personId: "other-person" } })) } }));
    rejected(t.run(), "IDENTITY_CONFLICT");
  });
  it("rejects future-effective legal capacity without inventing a covered rule", () => {
    const s = scenario();
    s.edit("legal", o => ({ ...o, payload: { ...o.payload, capacities: o.payload.capacities.map(c => ({ ...c,
      effective: { ...c.effective, start: civilDate("2026-03-01") } })) } }));
    rejected(s.run(), "UNCOVERED_RULE_YEAR_OR_DATE");
  });
  it("rejects incomplete history whose scope usage has a fabricated zero total", () => {
    const s = scenario();
    s.edit("history", o => ({ ...o, payload: { ...o.payload, capacities: o.payload.capacities.map(c => ({ ...c,
      used: money("0") })) } }));
    rejected(s.run(), "INCOMPLETE_HISTORY");
  });
  it("preserves the exact source-funded amount and rejects fractional cents", () => {
    const s = scenario([{ family: "403b" }]);
    s.edit("funding", o => ({ ...o, payload: { authorizations: o.payload.authorizations.map(a => ({ ...a, amount: money("1.001") })) } }));
    rejected(s.run(), "INVALID_ORIGINAL");
  });
  it("does not infer non-Roth after-tax permission or support catch-ups/rollovers", () => {
    for (const contributionType of ["employee_after_tax", "catch_up", "rollover"] as const) {
      const s = scenario([{ family: "403b" }]);
      s.edit("funding", o => ({ ...o, payload: { authorizations: o.payload.authorizations.map(a => ({ ...a, contributionType,
        taxBucket: contributionType === "employee_after_tax" ? "non_roth_after_tax" : "pretax" })) } }));
      rejected(s.run(), "INCOMPLETE_INVENTORY");
    }
  });
});
