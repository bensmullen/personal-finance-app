import { afterEach, describe, expect, it, vi } from "vitest";
import * as evaluator from "../../../../../src/simulation/d2/education/529/index.js";
import { bind529DistributionOriginals as bind, distributionOriginalDigest, type BindingCode,
  type DistributionOriginalPorts, type OriginalRole } from "../../../../../src/simulation/d2/education/529/distributionOriginalBinding/index.js";
import { civilDate } from "../../../../../src/time/index.js";
import { money } from "../../../../../src/values/index.js";
import { allRoles, at, fixture, pin, replace, type Fixture } from "./fixtures.js";

afterEach(() => vi.restoreAllMocks());
const evaluate = (f: Fixture) => bind([f.binding], f.ports);
const refused = (f: Fixture, code: BindingCode) => {
  const result = evaluate(f);
  expect(result.occurrences.every(o => o.economics === null)).toBe(true);
  expect(result.diagnostics.map(d => d.code)).toContain(code);
  return result;
};
const economics = (f: Fixture) => {
  const result = evaluate(f);
  expect(result.diagnostics).toEqual([]);
  expect(result.occurrences).toHaveLength(1);
  expect(result.occurrences[0]!.economics).not.toBeNull();
  return result.occurrences[0]!.economics!;
};

describe("synthetic original distribution economics — PFA-DET §5.7/§5.11", () => {
  it("independently observes $1000.03 tuition: $600.02 basis/$400.01 earnings, exactly one unchanged evaluator call", () => {
    const f = fixture(), before = JSON.stringify(f.originals);
    const spy = vi.spyOn(evaluator, "propose529Distribution");
    const result = evaluate(f), o = result.occurrences[0]!, p = o.economics!;
    expect(result.diagnostics).toEqual([]); expect(spy).toHaveBeenCalledTimes(1);
    expect(p.grossAmount.equals(money("1000.03"))).toBe(true);
    expect(p.basisRecovered.equals(money("600.02"))).toBe(true);
    expect(p.earnings.equals(money("400.01"))).toBe(true);
    expect(p.taxFacts.taxable.equals(money("0"))).toBe(true);
    expect(p.taxFacts.incomeCharacter).toBe("qualified_529_earnings_excluded");
    expect(p.planAssetDelta.equals(money("-1000.03"))).toBe(true);
    expect(p.ownedBankCashDelta.equals(money("1000.03"))).toBe(true);
    expect(p.planAssetDelta.plus(p.ownedBankCashDelta).isZero()).toBe(true);
    expect(p.movementNetWorthDelta.isZero()).toBe(true);
    expect(p.bankReceiptCharacter).toBe("owned_transfer");
    expect(p.expense!.recognize).toBe(false);
    expect(p.expense!.economicExpenseId).toBe("economic-expense-000");
    expect(o).toMatchObject({ committed: false, postable: false, physicalDistribution: "not_applied", settlement: "incomplete",
      taxLiability: "incomplete", penalty: "incomplete" });
    for (const output of ["penalty", "state_tax", "local_tax", "contribution_deduction", "settlement"])
      expect(o.coverage.find(c => c.affectedOutput === output)!.coverage).toBe("incomplete");
    expect(Object.isFrozen(o)).toBe(true); expect(Object.isFrozen(p)).toBe(true);
    expect(JSON.stringify(f.originals)).toBe(before);
    expect([...f.counts.values()]).toEqual(allRoles.map(() => 2));
  });
  it("requires no tuition originals for a nonqualified transfer and retains earnings income with incomplete penalty", () => {
    const f = fixture("000", "nonqualified_distribution");
    const { tuition: _tuition, adjustments: _adjustments, payment: _payment, ...ports } = f.ports;
    f.ports = ports;
    const p = economics(f);
    expect(p.grossAmount.equals(money("1000.03"))).toBe(true);
    expect(p.basisRecovered.equals(money("600.02"))).toBe(true);
    expect(p.earnings.equals(money("400.01"))).toBe(true);
    expect(p.taxFacts.taxable.equals(money("400.01"))).toBe(true);
    expect(p.taxFacts.incomeCharacter).toBe("nonqualified_529_earnings");
    expect(p.expense).toBeNull(); expect(f.counts.size).toBe(6);
    expect([...f.counts.values()]).toEqual(Array(6).fill(2));
  });
  it("settles an independently sourced institution claim while proposing separate expense recognition", () => {
    const p = economics(fixture("000", "qualified_distribution", true));
    expect(p.ownedBankCashDelta.equals(money("0"))).toBe(true);
    expect(p.institutionPaymentAmount.equals(money("1000.03"))).toBe(true);
    expect(p.institutionClaimLiabilityDelta.equals(money("-1000.03"))).toBe(true);
    expect(p.planAssetDelta.minus(p.institutionClaimLiabilityDelta).isZero()).toBe(true);
    expect(p.expense).toMatchObject({ recognize: true, institutionClaimId: "institution-claim-000" });
    expect(p.expense!.amount.equals(money("2000.09"))).toBe(true);
    expect(p.bankReceiptCharacter).toBe("not_applicable");
  });
  it.each([false, true])("preserves prior expense recognition for institution route %s", direct => {
    const f = fixture("000", "qualified_distribution", direct);
    replace(f, "payment", o => ({ ...o, payload: { ...o.payload, entries: o.payload.entries.map(entry => ({
      ...entry, recognition: { ...entry.recognition, status: "already_recognized" as const },
    })) } }));
    const p = economics(f);
    expect(p.expense!.recognize).toBe(false);
    expect(p.expense!.economicExpenseId).toBe("economic-expense-000");
    expect(p.expense!.amount.equals(money("2000.09"))).toBe(true);
    expect(p.movementNetWorthDelta.isZero()).toBe(true);
  });
  it("retains separate recognition of a paid but unrecognized expense without calling the distribution income", () => {
    const f = fixture();
    replace(f, "payment", o => ({ ...o, payload: { ...o.payload, entries: o.payload.entries.map(entry => ({
      ...entry, recognition: { ...entry.recognition, status: "unrecognized" as const },
    })) } }));
    const p = economics(f);
    expect(p.expense!.recognize).toBe(true);
    expect(p.expense!.economicExpenseId).toBe("economic-expense-000");
    expect(p.bankReceiptCharacter).toBe("owned_transfer");
    expect(p.planAssetDelta.plus(p.ownedBankCashDelta).isZero()).toBe(true);
  });
  it("uses independent scholarship/credit/other-529 adjustments and prior cross-provider use, down to the last cent", () => {
    const f = fixture();
    replace(f, "adjustments", o => ({ ...o, payload: { ...o.payload, entries: [{ ...o.payload.entries[0]!, adjustedEligible: money("1400.03"),
      adjustments: [
        { allocationId: "scholarship", kind: "scholarship", amount: money("200.01"), source: f.source("scholarship") },
        { allocationId: "credit", kind: "tax_credit", amount: money("300.02"), source: f.source("credit") },
        { allocationId: "other529", kind: "other_529", amount: money("100.03"), source: f.source("other529") },
      ] }] } }));
    replace(f, "usage", o => ({ ...o, payload: { ...o.payload, entries: [{ householdId: "household", economicExpenseId: "economic-expense-000",
      usage: { operationId: "previous", claimId: "previous-claim", planId: "other-plan", providerId: "other-custodian",
        paidExpenseId: "paid-expense-000", beneficiaryId: "child", taxYear: 2026, amount: money("400"), effectiveAt: at,
        state: "pending_authorized", source: f.source("prior-usage") } }] } }));
    const p = economics(f);
    expect(p.grossAmount.equals(money("1000.03"))).toBe(true);
    expect(p.basisRecovered.equals(money("600.02"))).toBe(true);
    expect(p.earnings.equals(money("400.01"))).toBe(true);
    // One cent more exceeds the independent adjusted remaining expense.
    f.binding = { ...f.binding, event: { ...f.binding.event, gross: money("1000.04") } };
    for (const role of allRoles) replace(f, role, o => ({ ...o, event: f.binding.event }));
    replace(f, "trustee", o => ({ ...o, payload: { authorization: { ...o.payload.authorization, gross: money("1000.04") } } }));
    const result = refused(f, "EVALUATION_INCOMPLETE");
    expect(result.occurrences[0]!.coverage.some(c => c.diagnosticCode === "ADJUSTED_EXPENSE_EXHAUSTED")).toBe(true);
  });
});

describe("independently runnable source negatives", () => {
  it.each(allRoles)("requires independent mandatory %s producer", role => {
    const f = fixture(); f.ports = { ...f.ports, [role]: undefined } as DistributionOriginalPorts;
    expect(refused(f, "ORIGINAL_UNAVAILABLE").diagnostics[0]!.missingPort).toBe(role);
  });
  it("rejects self-authenticated provider identity even with correct SHA-256", () => {
    const f = fixture();
    replace(f, "funding", o => ({ ...o, producerId: f.originals.plan.producerId }));
    refused(f, "INDEPENDENT_PRODUCER_REQUIRED");
  });
  it("does not treat a receipt marked paid as payment proof", () => {
    const f = fixture();
    replace(f, "payment", o => ({ ...o, payload: { ...o.payload, entries: [{ ...o.payload.entries[0]!, payment: null }] } }));
    refused(f, "TUITION_NOT_RECONCILED");
  });
  it("rejects incurred-only tuition despite a matching debit", () => {
    const f = fixture();
    replace(f, "tuition", o => ({ ...o, payload: { ...o.payload, bills: [{ ...o.payload.bills[0]!, paidAt: null }] } }));
    refused(f, "TUITION_NOT_RECONCILED");
  });
  it.each(["beneficiaryId", "institutionId", "termId", "studentId"] as const)("rejects contradictory legal %s", key => {
    const f = fixture();
    replace(f, "law", o => ({ ...o, payload: { ...o.payload, qualification: { ...o.payload.qualification!, [key]: "other" } } }));
    refused(f, "EVALUATION_INCOMPLETE");
    expect([...f.counts.values()]).toEqual(allRoles.map(() => 2));
  });
  it("rejects missing legal qualification without deriving eligibility from a bill", () => {
    const f = fixture(); replace(f, "law", o => ({ ...o, payload: { ...o.payload, qualification: null } }));
    refused(f, "EVALUATION_INCOMPLETE");
  });
  it("rejects a bank owned by another person despite trustee permission", () => {
    const f = fixture();
    replace(f, "route", o => ({ ...o, payload: { ...o.payload, route: { ...o.payload.route,
      kind: "owned_bank", ownerId: "other", householdId: "household", observedAt: at, openingCash: money("50.01") } } }));
    refused(f, "EVALUATION_INCOMPLETE");
  });
  it("rejects a non-BANK destination even when the account ID matches", () => {
    const f = fixture(); replace(f, "route", o => ({ ...o, payload: { ...o.payload, accountKind: "institution" } }));
    refused(f, "ORIGINAL_SCOPE_MISMATCH");
  });
  it("rejects an independently sourced wrong institution payee", () => {
    const f = fixture("000", "qualified_distribution", true);
    replace(f, "route", o => ({ ...o, payload: { ...o.payload, payeeId: "other-bursar" } }));
    refused(f, "ORIGINAL_SCOPE_MISMATCH");
  });
  it("requires affirmative trustee permission", () => {
    const f = fixture(); replace(f, "trustee", o => ({ ...o, payload: { authorization: { ...o.payload.authorization, permitted: "unknown" } } }));
    refused(f, "EVALUATION_INCOMPLETE");
  });
  it.each(["funding", "plan", "tuition", "adjustments", "payment", "usage"] as const)("requires exhaustive %s inventory", role => {
    const f = fixture(); replace(f, role, o => ({ ...o, payload: { ...o.payload, complete: "unknown" } }));
    refused(f, "COMPLETE_INVENTORY_REQUIRED");
  });
  it.each(["bankDebit", "planCredit"] as const)("rejects a one-cent funded %s mismatch", key => {
    const f = fixture(); replace(f, "funding", o => ({ ...o, payload: { ...o.payload,
      entries: [{ ...o.payload.entries[0]!, [key]: money("5999.99") }] } }));
    refused(f, "FUNDING_NOT_RECONCILED");
  });
  it("rejects a current lot basis penny inconsistent with snapshot", () => {
    const f = fixture(); replace(f, "plan", o => ({ ...o, payload: { ...o.payload,
      lots: [{ ...o.payload.lots[0]!, basis: money("5999.99") }] } }));
    refused(f, "FUNDING_NOT_RECONCILED");
  });
  it("rejects pending contribution credit as funded history", () => {
    const f = fixture(); replace(f, "funding", o => ({ ...o, payload: { ...o.payload,
      entries: [{ ...o.payload.entries[0]!, status: "pending" }] } }));
    refused(f, "FUNDING_NOT_RECONCILED");
  });
  it("rejects one penny of contradictory original payment", () => {
    const f = fixture(); replace(f, "payment", o => ({ ...o, payload: { ...o.payload, entries: [{ ...o.payload.entries[0]!,
      payment: { ...o.payload.entries[0]!.payment!, amount: money("2000.08") } }] } }));
    refused(f, "TUITION_NOT_RECONCILED");
  });
  it("rejects later-known law even if its original pin is reissued", () => {
    const f = fixture(); replace(f, "law", o => ({ ...o, knownAt: civilDate("2026-01-16") }));
    refused(f, "ORIGINAL_CHRONOLOGY_INVALID");
  });
  it.each(["issuedAt", "publishedAt", "asOf", "start", "endExclusive"] as const)("checks original %s chronology", key => {
    const f = fixture(); replace(f, "law", o => ({ ...o, [key]: key === "endExclusive" ? at : civilDate("2026-01-16") }));
    refused(f, "ORIGINAL_CHRONOLOGY_INVALID");
  });
  it("rejects a later-known embedded law source rather than accepting the outer envelope alone", () => {
    const f = fixture(); replace(f, "law", o => ({ ...o, payload: { ...o.payload, rules: { ...o.payload.rules,
      source: { ...o.payload.rules.source, publishedAt: civilDate("2026-01-16"), asOf: civilDate("2026-01-16") } } } }));
    refused(f, "ORIGINAL_CHRONOLOGY_INVALID");
  });
  it("full digest includes arbitrary publisher extensions", () => {
    const f = fixture();
    expect(distributionOriginalDigest({ ...f.originals.tuition, extra: "amendment" } as typeof f.originals.tuition))
      .not.toBe(distributionOriginalDigest(f.originals.tuition));
    expect(f.binding.originals.tuition!.digest).toMatch(/:sha256:[a-f0-9]{64}$/);
  });
});

describe("source re-read, replay and unrelated members", () => {
  it.each(allRoles)("re-reads all originals and suppresses withdrawal of %s", role => {
    const f = fixture(); let reads = 0;
    f.ports = { ...f.ports, [role]: () => { f.counts.set(role, ++reads);
      return reads === 1 ? f.originals[role] : { ...f.originals[role], status: "withdrawn" }; } };
    const result = refused(f, "ORIGINAL_UNAVAILABLE");
    expect(result.occurrences).toEqual([]);
    for (const r of allRoles) expect(f.counts.get(r)).toBe(2);
  });
  it.each(allRoles)("rejects second-read %s version amendment", role => {
    const f = fixture(); let reads = 0;
    f.ports = { ...f.ports, [role]: () => ++reads === 1 ? f.originals[role] : { ...f.originals[role], version: "v2" } };
    expect(refused(f, "ORIGINAL_CHANGED").occurrences).toEqual([]);
  });
  it.each(["penny", "basis", "beneficiary", "school", "eligibility", "later-known"] as const)(
    "rejects second-read %s amendment even when the source ID and version remain unchanged", change => {
      const f = fixture();
      const amended = (() => {
        switch (change) {
          case "penny": return { ...f.originals.payment, payload: { ...f.originals.payment.payload,
            entries: f.originals.payment.payload.entries.map(entry => ({ ...entry,
              payment: { ...entry.payment!, amount: money("2000.08") } })) } };
          case "basis": return { ...f.originals.plan, payload: { ...f.originals.plan.payload,
            lots: f.originals.plan.payload.lots.map(lot => ({ ...lot, basis: money("5999.99") })) } };
          case "beneficiary": return { ...f.originals.plan, payload: { ...f.originals.plan.payload,
            plan: { ...f.originals.plan.payload.plan, beneficiaryId: "other-child" } } };
          case "school": return { ...f.originals.tuition, payload: { ...f.originals.tuition.payload,
            bills: f.originals.tuition.payload.bills.map(bill => ({ ...bill, institutionId: "other-school" })) } };
          case "eligibility": return { ...f.originals.law, payload: { ...f.originals.law.payload,
            qualification: { ...f.originals.law.payload.qualification!, categoryEligible: "no" as const } } };
          case "later-known": return { ...f.originals.law, knownAt: civilDate("2026-01-16") };
        }
      })();
      let reads = 0;
      // Change a producer-owned original during evaluation; the adapter must
      // inspect content again rather than trusting an unchanged version token.
      vi.spyOn(evaluator, "propose529Distribution").mockImplementationOnce(() => {
        const role = amended.role;
        const originalPort = f.ports[role]!;
        Object.assign(f.ports, { [role]: (p: Parameters<typeof originalPort>[0], cutoff: typeof at) => {
          originalPort(p, cutoff); reads++;
          return amended;
        } });
        return { proposals: [], coverage: [] };
      });
      const result = refused(f, "ORIGINAL_CHANGED");
      expect(result.occurrences).toEqual([]);
      expect(reads).toBe(1);
      for (const role of allRoles) expect(f.counts.get(role)).toBe(2);
    });
  it("re-reads every source even when the evaluator rejects the expense", () => {
    const f = fixture(); replace(f, "law", o => ({ ...o, payload: { ...o.payload, qualification: null } }));
    refused(f, "EVALUATION_INCOMPLETE");
    for (const role of allRoles) expect(f.counts.get(role)).toBe(2);
  });
  it("detects an amendment to an unused competing receipt in the second inventory read", () => {
    const f = fixture();
    replace(f, "tuition", o => ({ ...o, payload: { ...o.payload, bills: [...o.payload.bills,
      { ...o.payload.bills[0]!, paidExpenseId: "competing-receipt", expenseId: "competing-bill" }] } }));
    replace(f, "adjustments", o => ({ ...o, payload: { ...o.payload, entries: [...o.payload.entries,
      { ...o.payload.entries[0]!, paidExpenseId: "competing-receipt" }] } }));
    replace(f, "payment", o => ({ ...o, payload: { ...o.payload, entries: [...o.payload.entries,
      { ...o.payload.entries[0]!, paidExpenseId: "competing-receipt", economicExpenseId: "competing-economic",
        payment: { ...o.payload.entries[0]!.payment!, operationId: "competing-payment" },
        recognition: { ...o.payload.entries[0]!.recognition, economicExpenseId: "competing-economic" } }] } }));
    let reads = 0;
    f.ports = { ...f.ports, tuition: () => ++reads === 1 ? f.originals.tuition : { ...f.originals.tuition,
      payload: { ...f.originals.tuition.payload, bills: f.originals.tuition.payload.bills.slice(0, 1) } } };
    expect(refused(f, "ORIGINAL_CHANGED").occurrences).toEqual([]);
    expect(reads).toBe(2);
  });
  it("rejects a duplicate paid identity inside the original receipt inventory", () => {
    const f = fixture(); replace(f, "tuition", o => ({ ...o, payload: { ...o.payload, bills: [...o.payload.bills, o.payload.bills[0]!] } }));
    // Omitted accompanying independent inventory is itself incomplete.
    refused(f, "COMPLETE_INVENTORY_REQUIRED");
  });
  it.each(["paidExpenseId", "economicExpenseId"] as const)("rejects renamed cross-plan events sharing %s even when a source is unavailable", key => {
    const a = fixture("000"), b = fixture("001");
    b.binding = { ...b.binding, identity: { ...b.binding.identity, tuition: { ...b.binding.identity.tuition!,
      [key]: a.binding.identity.tuition![key] } } };
    // Deliberately unavailable B must not allow A to win by enumeration order.
    const ports = { ...a.ports, tuition: () => undefined };
    const first = bind([a.binding, b.binding], ports), reversed = bind([b.binding, a.binding], ports);
    expect(first).toEqual(reversed); expect(first.occurrences).toEqual([]);
    expect(first.diagnostics.map(d => d.code)).toEqual(["CONTESTED_CLAIM", "CONTESTED_CLAIM"]);
  });
  it("rejects shared claim identity across providers without source-order precedence", () => {
    const a = fixture("000"), b = fixture("001"); b.binding = { ...b.binding, event: { ...b.binding.event, claimId: a.binding.event.claimId } };
    const result = bind([a.binding, b.binding], {});
    expect(result.occurrences).toEqual([]); expect(result.diagnostics.every(d => d.code === "CONTESTED_CLAIM")).toBe(true);
  });
  it("rejects an operation replay from the exhaustive cross-provider usage register", () => {
    const f = fixture(); replace(f, "usage", o => ({ ...o, payload: { ...o.payload, entries: [{ householdId: "household", economicExpenseId: "economic-expense-000",
      usage: { operationId: f.binding.event.operationId, claimId: "different-claim", planId: "other-plan", providerId: "other-provider",
        paidExpenseId: "paid-expense-000", beneficiaryId: "child", taxYear: 2026, amount: money("1"), effectiveAt: at,
        state: "posted", source: f.source("usage-replay") } }] } }));
    refused(f, "CONTESTED_CLAIM");
  });
  it("keeps unrelated sibling usage out of the evaluator's beneficiary scope", () => {
    const f = fixture(); replace(f, "usage", o => ({ ...o, payload: { ...o.payload, entries: [{ householdId: "household", economicExpenseId: "sibling-economic",
      usage: { operationId: "sibling-op", claimId: "sibling-claim", planId: "sibling-plan", providerId: "sibling-provider",
        paidExpenseId: "sibling-paid", beneficiaryId: "sibling", taxYear: 2026, amount: money("9999"), effectiveAt: at,
        state: "posted", source: f.source("sibling-use") } }] } }));
    expect(economics(f).earnings.equals(money("400.01"))).toBe(true);
  });
  it("does not let a failed unrelated household suppress a valid household occurrence", () => {
    const a = fixture(), b = fixture("001");
    b.binding = { ...b.binding, identity: { ...b.binding.identity, householdId: "other-household" } };
    const result = bind([a.binding, b.binding], a.ports);
    expect(result.occurrences).toHaveLength(1);
    expect(result.occurrences[0]!.event.eventId).toBe(a.binding.event.eventId);
    expect(result.occurrences[0]!.economics!.grossAmount.equals(money("1000.03"))).toBe(true);
  });
});

describe("bounded 1/12/120 event output", () => {
  it("observes every exact-cent proposal, stable identity, re-read count and proportional serialization without raw histories", () => {
    const fixtures = Array.from({ length: 120 }, (_, n) => fixture(String(n).padStart(3, "0"),
      n % 2 === 0 ? "qualified_distribution" : "nonqualified_distribution"));
    const find = (p: { sourceId: string }): Fixture => fixtures.find(f => Object.values(f.originals).some(o => o.sourceId === p.sourceId))!;
    const ports: DistributionOriginalPorts = {
      plan: p => find(p).ports.plan!(p, at), funding: p => find(p).ports.funding!(p, at),
      law: p => find(p).ports.law!(p, at), usage: p => find(p).ports.usage!(p, at), trustee: p => find(p).ports.trustee!(p, at),
      route: p => find(p).ports.route!(p, at), tuition: p => find(p).ports.tuition!(p, at),
      adjustments: p => find(p).ports.adjustments!(p, at), payment: p => find(p).ports.payment!(p, at),
    };
    const spy = vi.spyOn(evaluator, "propose529Distribution");
    const results = [1, 12, 120].map(n => bind(fixtures.slice(0, n).map(f => f.binding), ports));
    expect(spy).toHaveBeenCalledTimes(133);
    for (let index = 0; index < results.length; index++) {
      const n = [1, 12, 120][index]!, result = results[index]!;
      expect(result.diagnostics).toEqual([]); expect(result.occurrences).toHaveLength(n);
      for (const o of result.occurrences) {
        expect(o.economics!.grossAmount.equals(money("1000.03"))).toBe(true);
        expect(o.economics!.basisRecovered.equals(money("600.02"))).toBe(true);
        expect(o.economics!.earnings.equals(money("400.01"))).toBe(true);
        expect(o.economics!.taxFacts.taxable.equals(money(o.event.kind === "qualified_distribution" ? "0" : "400.01"))).toBe(true);
      }
      const serialized = JSON.stringify(result);
      for (const raw of ["RAW_ORIGINAL_MARKER", "fundingProof", "contributions", "lots", "sourcePublication", "bills", "adjustments"])
        // The compact adjustments *pin* is required; the raw adjustment array is not.
        if (raw !== "adjustments") expect(serialized).not.toContain(raw);
      expect(serialized).not.toContain('"adjustments":[');
      expect(serialized.length).toBeLessThan(n * 10500);
    }
    expect(results[1]!.occurrences[0]).toEqual(results[0]!.occurrences[0]);
    expect(results[2]!.occurrences.slice(0, 12)).toEqual(results[1]!.occurrences);
    const sizes = results.map(r => JSON.stringify(r).length);
    expect(sizes[2]! / sizes[1]!).toBeGreaterThan(9.9);
    expect(sizes[2]! / sizes[1]!).toBeLessThan(10.1);
    for (let n = 0; n < fixtures.length; n++) {
      const f = fixtures[n]!, runs = n === 0 ? 3 : n < 12 ? 2 : 1;
      for (const role of allRoles) expect(f.counts.get(role) ?? 0).toBe(
        f.binding.event.kind === "nonqualified_distribution" && ["tuition", "adjustments", "payment"].includes(role) ? 0 : 2 * runs);
    }
  });
});
