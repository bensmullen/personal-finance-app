import { describe, expect, it } from "vitest";
import { money } from "../../../../../src/values/index.js";
import { scenario } from "./fixtures.js";

describe("bounded 1/12/120 event evidence without immutable-book amplification", () => {
  it.each([1, 12, 120])("qualifies and requalifies four source books for %i exact-cent events", n => {
    const s = scenario([{ family: "403b" }], n), result = s.run();
    expect(result.diagnostics).toEqual([]);
    expect(result.candidates).toHaveLength(n);
    expect(result.originals).toHaveLength(4);
    expect(s.readCounts).toEqual({ plan: 2, funding: 2, legal: 2, history: 2 });
    expect(s.authCounts).toEqual({ plan: 2, funding: 2, legal: 2, history: 2 });
    const increment = result.candidates.reduce((sum, c) => sum.plus(c.amount), money("0"));
    const expected = n === 1 ? "1.01" : n === 12 ? "12.12" : "121.20";
    expect(increment.equals(money(expected))).toBe(true);
    expect(result.capacityProposals.every(p => p.proposedIncrement.equals(money(expected)))).toBe(true);
    const references = new Set(result.originals.map(o => o.referenceId));
    for (const c of result.candidates) expect(c.sourceRefs.every(r => references.has(r))).toBe(true);
    const serialized = JSON.stringify(result);
    for (const forbidden of ["authorizations", "eligibleAmount", "originals\":{", "confirmed_zero", "itemized_consumption", "signedBy"])
      expect(serialized).not.toContain(forbidden);
    // Witnesses appear once per source, never once per occurrence.
    for (const o of result.originals) expect(serialized.split(o.digest)).toHaveLength(2);
  });
  it("grows near-linearly and preserves earlier operation identities as the event set grows", () => {
    const outputs = [1, 12, 120].map(n => scenario([{ family: "403b" }], n).run());
    const sizes = outputs.map(o => JSON.stringify(o).length);
    const perEvent12 = (sizes[1]! - sizes[0]!) / 11;
    const perEvent120 = (sizes[2]! - sizes[0]!) / 119;
    expect(perEvent120).toBeLessThanOrEqual(perEvent12 * 1.1);
    expect(perEvent120).toBeGreaterThan(perEvent12 * 0.9);
    expect(outputs[0]!.candidates[0]!.operationId).toBe(outputs[2]!.candidates[0]!.operationId);
  });
  it.each([1, 12, 120])("withholds %i events after a second-read unused-source change", n => {
    const s = scenario([{ family: "403b" }], n);
    s.sourceChanges.set("plan", (book, read) => read === 1 ? book : ({ ...book,
      originals: book.originals.map(o => ({ ...o, version: "withdrawn-before-return", status: "withdrawn" })) }));
    const result = s.run();
    expect(result.candidates).toEqual([]);
    expect(result.capacityProposals).toEqual([]);
    expect(result.diagnostics).toContainEqual({ code: "SOURCE_RACE", role: "plan" });
    expect(Object.values(s.readCounts)).toEqual([2, 2, 2, 2]);
  });
});
