import { describe, expect, it } from "vitest";
import { accountingTransactionId } from "../../../../../src/accounting/index.js";
import { domainId } from "../../../../../src/identity/index.js";
import { qualifyPayrollHealthSource } from "../../../../../src/state/index.js";
import { civilDate, instant } from "../../../../../src/time/index.js";
import { money } from "../../../../../src/values/index.js";
import { canonicalSerialize } from "../../../../../src/simulation/run.js";
import { proposePremiums } from "../../../../../src/simulation/d2/health/premiums/index.js";
import { proposePayrollPremiumBindings as propose, type OriginalPayrollPremiumFacts } from "../../../../../src/simulation/d2/health/premiums/payrollBinding/index.js";
import { bank, context, coverage, payroll, person, scenario, source } from "./fixtures.js";

const codes = (r: ReturnType<typeof propose>) => r.diagnostics.map(d => d.diagnosticCode);
const change = (f: ReturnType<typeof scenario>, update: (row: OriginalPayrollPremiumFacts) => OriginalPayrollPremiumFacts) => {
  const s = f.input.bindings[0]!;
  f.payrolls.set(s.sourceId, update(f.payrolls.get(s.sourceId)!));
};

describe("C1-2 conditional original-payroll premium binder", () => {
  it("binds a family share once to the original midday paycheck with sourced legal bases and no posting", () => {
    const f = scenario(), before = canonicalSerialize([f.request, [...f.payrolls], [...f.legal]]);
    const r = propose(f.input), i = r.intents[0]!;
    expect(r.intents).toHaveLength(1);
    expect(i.source.transactionId).toBe(`tx:recognition:income:salary:employer-A:2024-01-15T17:00:00.000Z`);
    expect(i.memberIds).toEqual([person, "child"].sort());
    expect(i.proposedCashPayDeduction.amount.equals(money("200"))).toBe(true);
    expect(i.proposedHealthcareExpense?.amount.equals(money("200"))).toBe(true);
    expect(i.employerSubsidy.equals(money("100"))).toBe(true);
    expect(i.legalBaseCandidate.status).toBe("documented_conditional");
    expect(i.legalBaseCandidate.appliedBases).toHaveLength(4);
    expect(i.legalBaseCandidate.appliedBases.every(b => b.after.equals(money("750")))).toBe(true);
    for (const effect of [r, i, i.proposedCashPayDeduction, i.proposedHealthcareExpense, i.legalBaseCandidate]) {
      expect(effect).toMatchObject({ committed: false, postable: false });
      expect(Object.isFrozen(effect)).toBe(true);
    }
    for (const key of ["sourceAuthorityCoverage", "bankCoverage", "taxCoverage", "netPayCoverage", "recognitionCoverage", "settlementCoverage"] as const)
      expect(i[key]).toBe("incomplete");
    expect(r.diagnostics.map(d => d.affectedOutput).sort()).toEqual(["bank", "net_pay", "recognition", "settlement", "tax"]);
    for (const key of ["transactions", "state", "taxCredit", "netPay"]) expect(Object.keys(r)).not.toContain(key);
    expect(canonicalSerialize([f.request, [...f.payrolls], [...f.legal]])).toBe(before);
    expect(qualifyPayrollHealthSource(i.source, context)).toEqual({ status: "incomplete", reason: "source_unavailable" });
  });

  it("admits two independently quoted paycheck claims in one month without splitting a monthly quote", () => {
    const a = coverage("first", "2024-01-01", "2024-01-16", "2024-01-15");
    const b = coverage("second", "2024-01-16", "2024-02-01", "2024-01-31");
    const f = scenario([a, b], [payroll(a), payroll(b, instant("2024-01-31T17:00:00.000Z"))]);
    const r = propose(f.input);
    expect(r.intents).toHaveLength(2);
    expect(r.intents.map(i => i.source.dueAt.slice(0, 10))).toEqual(["2024-01-15", "2024-01-31"]);
    expect(r.intents.reduce((sum, i) => sum.plus(i.proposedCashPayDeduction.amount), money("0")).equals(money("400"))).toBe(true);
    expect(new Set(r.intents.map(i => i.source.claimId)).size).toBe(2);
    expect(propose({ ...f.input, proposals: [...f.input.proposals].reverse(), bindings: [...f.input.bindings].reverse() })).toEqual(r);
    const one = scenario();
    change(one, row => ({ ...row, quote: { ...row.quote, employeeAmount: money("100") } }));
    expect(propose(one.input).intents).toEqual([]);
    expect(codes(propose(one.input))).toContain("SOURCED_FULL_QUOTE_ALLOCATION_REQUIRED");
  });

  it("uses authored employment termination and new-job facts, keeping same-person employers distinct", () => {
    const a = coverage("old", "2024-01-01", "2024-01-16"), b = coverage("new", "2024-01-16", "2024-02-01", "2024-01-31", "employer-B");
    const ar = payroll(a), br = payroll(b, instant("2024-01-31T17:00:00.000Z"));
    const f = scenario([a, b], [ar, br]);
    f.payrolls.set(ar.facts.source.sourceId, { ...ar.facts, employment: { ...ar.facts.employment, effectiveUntil: instant("2024-01-16T00:00:00.000Z") } });
    f.payrolls.set(br.facts.source.sourceId, { ...br.facts, employment: { ...br.facts.employment, effectiveFrom: instant("2024-01-16T00:00:00.000Z") } });
    expect(propose(f.input).intents.map(i => i.source.employerId)).toEqual(["employer-A", "employer-B"]);
    f.payrolls.set(ar.facts.source.sourceId, { ...ar.facts, employment: { ...ar.facts.employment, effectiveUntil: ar.facts.source.dueAt } });
    expect(propose(f.input).intents).toHaveLength(1);
    expect(codes(propose(f.input))).toContain("PAYROLL_SOURCE_WINDOW_REQUIRED");
  });

  it("requires sourced coordination for overlapping jobs and does not net their independent claims", () => {
    const a = coverage("A"), b = coverage("B", "2024-01-01", "2024-02-01", "2024-01-31", "employer-B");
    const f = scenario([a, b], [payroll(a), payroll(b, instant("2024-01-31T17:00:00.000Z"))]);
    expect(propose(f.input).intents).toEqual([]);
    const request = { ...f.request, coordination: [person, "child"].map(memberId => ({ memberId, coverageIds: [a.id, b.id], admitsDistinctPremiums: true as const, evidence: source })) };
    const input = { ...f.input, proposals: proposePremiums(request).proposals, originals: { ...f.input.originals, premiumRequest: () => request } };
    expect(propose(input).intents).toHaveLength(2);
    expect(propose(input).intents.map(i => i.proposedHealthcareExpense!.amount)).toEqual([money("200"), money("200")]);
    // A shared election ID across jobs cannot acquire different owners by iteration order.
    const s = input.bindings[1]!, rebound = { ...s, electionId: input.bindings[0]!.electionId };
    f.payrolls.set(s.sourceId, { ...f.payrolls.get(s.sourceId)!, source: rebound,
      election: { ...f.payrolls.get(s.sourceId)!.election, id: rebound.electionId } });
    expect(propose({ ...input, bindings: [input.bindings[0]!, rebound] }).intents).toEqual([]);
  });

  it.each(["none", "partial", "zero_employee"] as const)("preserves %s subsidy without fabricated household employer cash", kind => {
    const c = coverage(), employer = kind === "none" ? money("0") : kind === "partial" ? money("100") : money("300");
    const item = { ...c, quote: { ...c.quote, employer, member: c.quote.gross.minus(employer) } };
    const r = propose(scenario([item]).input), i = r.intents[0]!;
    expect(i.employerSubsidy.equals(employer)).toBe(true);
    expect(i.proposedCashPayDeduction.amount.equals(item.quote.member)).toBe(true);
    expect(i.proposedHealthcareExpense === null).toBe(kind === "zero_employee");
    expect(i.electionRef.electionId).toBeTruthy();
    expect(Object.keys(i)).not.toContain("employerCashFlow");
  });

  it("rejects two otherwise admitted claims on the same original wage and a full monthly quote reused at another paycheck", () => {
    const a = coverage("A"), b = coverage("B");
    const f = scenario([a, b]);
    const request = { ...f.request, coordination: [person, "child"].map(memberId => ({ memberId, coverageIds: [a.id, b.id], admitsDistinctPremiums: true as const, evidence: source })) };
    const r = propose({ ...f.input, proposals: proposePremiums(request).proposals, originals: { ...f.input.originals, premiumRequest: () => request } });
    expect(r.intents).toEqual([]);
    expect(codes(r)).toContain("DUPLICATE_PREMIUM_PAYROLL_CLAIM");
    const c = coverage();
    const v = scenario([c], [payroll(c), payroll(c, instant("2024-01-31T17:00:00.000Z"), civilDate("2024-01-15"))]);
    expect(propose(v.input).intents).toEqual([]);
    expect(codes(propose(v.input))).toContain("DUPLICATE_PREMIUM_PAYROLL_CLAIM");
  });

  it("rejects forged proposal amount, publication, membership or cadence despite matching operation IDs", () => {
    const f = scenario(), p = f.input.proposals[0]!;
    for (const bad of [
      { ...p, memberAmount: money("200.01") }, { ...p, source: { ...p.source, asOf: civilDate("2023-11-01") } },
      { ...p, memberIds: [person, person] }, { ...p, expectedSettlementRoute: { ...p.expectedSettlementRoute, sponsorId: "other" } },
    ]) expect(propose({ ...f.input, proposals: [bad] }).intents).toEqual([]);
    change(f, row => ({ ...row, quote: { ...row.quote, schedule: { ...row.quote.schedule, frequency: "annual" } } }));
    expect(codes(propose(f.input))).toContain("SOURCED_FULL_QUOTE_ALLOCATION_REQUIRED");
    expect(codes(propose({ ...f.input, originals: { ...f.input.originals, premiumRequest: () => undefined } }))).toContain("C1_ORIGINAL_INPUTS_REQUIRED");
  });

  it("fails closed on annual quote division, fractional cents, reimbursement and reversal", () => {
    const c = coverage(), annual = { ...c, quote: { ...c.quote, schedule: { ...c.quote.schedule, frequency: "annual" as const } } };
    const f = scenario([annual]);
    change(f, row => ({ ...row, quote: { ...row.quote, employeeAmount: money("16.67") } }));
    expect(propose(f.input).intents).toEqual([]);
    for (const employeeAmount of [money("199.99"), money("200.001"), money("-200")]) {
      const v = scenario(); change(v, row => ({ ...row, quote: { ...row.quote, employeeAmount } }));
      expect(propose(v.input).intents).toEqual([]);
    }
    for (const type of ["reimbursement", "reversal"]) {
      const v = scenario(); change(v, row => ({ ...row, transaction: { ...row.transaction, type } }));
      expect(codes(propose(v.input))).toContain("SIGNED_ORIGINAL_PAYROLL_MISMATCH");
    }
  });

  it.each(["ownerId", "employerId", "incomeId", "occurrenceId", "bankAccountId", "transactionId"] as const)("rejects rebound original %s", field => {
    const f = scenario(), s = f.input.bindings[0]!;
    const rebound = { ...s, [field]: field === "bankAccountId" ? bank : "wrong" };
    if (field === "bankAccountId") rebound.bankAccountId = domainId("account", "14800000-0000-4000-8000-000000000099");
    expect(propose({ ...f.input, bindings: [rebound] }).intents).toEqual([]);
    const v = scenario();
    change(v, row => ({ ...row, transaction: { ...row.transaction, id: accountingTransactionId("premium-operation") } }));
    expect(codes(propose(v.input))).toContain("SIGNED_ORIGINAL_PAYROLL_MISMATCH");
  });

  it("rejects wrong signed journal and incomplete inventory, overdraw and previously allocated charges", () => {
    const updates: readonly ((r: OriginalPayrollPremiumFacts) => OriginalPayrollPremiumFacts)[] = [
      r => ({ ...r, transaction: { ...r.transaction, legs: r.transaction.legs.map(l => l.type === "income" ? { ...l, posting: "debit" as const } : l) } }),
      r => ({ ...r, bankOwnerId: "wrong" }), r => ({ ...r, inventoryComplete: false }), r => ({ ...r, deductionInventory: [] }),
      r => ({ ...r, contributions: [] }), r => ({ ...r, withholding: r.withholding.slice(1) }), r => ({ ...r, alreadyAllocated: true }),
      r => ({ ...r, withholding: r.withholding.map(w => ({ ...w, election: { ...w.election, employerId: "wrong" } })) }),
      r => ({ ...r, election: { ...r.election, planId: "wrong" } }),
    ];
    for (const update of updates) { const f = scenario(); change(f, update); expect(propose(f.input).intents).toEqual([]); }
    const c = coverage(), expensive = { ...c, quote: { ...c.quote, gross: money("1000"), member: money("900") } };
    const overdraw = scenario([expensive]);
    expect(codes(propose(overdraw.input))).toContain("PREMIUM_EXCEEDS_GROSS_CAPACITY");
  });

  it("rejects duplicate quote, coverage, member, claim and payroll occurrence without selecting a winner", () => {
    const f = scenario(), p = f.input.proposals[0]!, s = f.input.bindings[0]!;
    expect(propose({ ...f.input, proposals: [p, p] }).intents).toEqual([]);
    expect(propose({ ...f.input, bindings: [s, s] }).intents).toEqual([]);
    const duplicateRequest = { ...f.request, coverages: [coverage(), coverage()] };
    expect(codes(propose({ ...f.input, originals: { ...f.input.originals, premiumRequest: () => duplicateRequest } }))).toContain("C1_ORIGINAL_INPUTS_INVALID");
    const c = coverage(), duplicateMember = { ...c, memberIds: [person, person] };
    expect(propose(scenario([duplicateMember]).input).intents).toEqual([]);
    const a = coverage("A", "2024-01-01", "2024-01-16"), b = coverage("B", "2024-01-16", "2024-02-01", "2024-01-31");
    for (const collision of ["claimId", "transactionId"] as const) {
      const ar = payroll(a), br = payroll(b, instant("2024-01-31T17:00:00.000Z"));
      if (collision === "claimId") {
        const changed = { ...br.facts, source: { ...br.facts.source, claimId: ar.facts.source.claimId }, deductionInventory: [ar.facts.source.claimId] };
        const v = scenario([a, b], [ar, { ...br, facts: changed }]);
        expect(codes(propose(v.input))).toContain("DUPLICATE_PREMIUM_PAYROLL_CLAIM");
        expect(propose(v.input).intents).toEqual([]);
      } else {
        const v = scenario([a, b], [ar, { ...br, facts: { ...br.facts, source: { ...br.facts.source, transactionId: ar.facts.source.transactionId } } }]);
        expect(propose(v.input).intents).toHaveLength(1); // Rebound date/operation rejected before admission.
        expect(codes(propose(v.input))).toContain("ORIGINAL_PAYROLL_IDENTITY_MISMATCH");
      }
    }
  });

  it("keeps unknown Section 125, missing law/jurisdiction and bad legal windows explicitly tax-incomplete", () => {
    const updates: readonly ((r: OriginalPayrollPremiumFacts) => OriginalPayrollPremiumFacts)[] = [
      r => ({ ...r, requiredBases: [] }), r => ({ ...r, legalInventoryComplete: false }),
      r => ({ ...r, election: { ...r.election, section125Qualified: false } }),
      r => ({ ...r, election: { ...r.election, taxCharacter: "unknown" } }),
    ];
    for (const update of updates) {
      const f = scenario(); change(f, update);
      expect(propose(f.input).intents[0]!.legalBaseCandidate.status).toBe("incomplete");
      expect(codes(propose(f.input))).toContain("LEGAL_WAGE_BASES_INCOMPLETE");
    }
    for (const variant of ["missing", "local", "window", "rule", "jurisdiction", "cents", "published", "observed", "amount"] as const) {
      const f = scenario(), id = f.input.bindings[0]!.sourceId, rows = f.legal.get(id)!;
      if (variant === "missing") f.legal.delete(id);
      else if (variant === "local") f.legal.set(id, rows.filter(b => b.jurisdiction !== "US:LOCAL"));
      else f.legal.set(id, rows.map((b, n) => n !== 0 ? b : variant === "window" ? { ...b, effectiveUntil: f.input.bindings[0]!.dueAt }
        : variant === "rule" ? { ...b, ruleVersion: "wrong" } : variant === "jurisdiction" ? { ...b, jurisdiction: "unknown" }
        : variant === "cents" ? { ...b, after: money("750.001") } : variant === "published" ? { ...b, publishedAt: instant("2024-01-01T00:00:00.000Z") }
        : variant === "observed" ? { ...b, knownAt: instant("2024-01-01T00:00:00.000Z") } : { ...b, exclusion: money("201"), after: money("749") }));
      const r = propose(f.input);
      expect(r.intents[0]!.legalBaseCandidate.status).toBe("incomplete");
      expect(r.intents[0]!.taxCoverage).toBe("incomplete");
      expect(codes(r)).toContain("LEGAL_WAGE_BASES_INCOMPLETE");
    }
  });

  it("gates source publication, knowledge, election and employment boundaries precisely", () => {
    const cases: readonly ((r: OriginalPayrollPremiumFacts) => OriginalPayrollPremiumFacts)[] = [
      r => ({ ...r, employment: { ...r.employment, effectiveUntil: r.source.dueAt } }),
      r => ({ ...r, election: { ...r.election, window: { ...r.election.window, effectiveFrom: instant("2024-01-15T17:00:00.001Z") } } }),
      r => ({ ...r, employment: { ...r.employment, knownAt: instant("2024-01-01T00:00:00.000Z") } }),
    ];
    for (const update of cases) { const f = scenario(); change(f, update); expect(propose(f.input).intents).toEqual([]); }
    const f = scenario(), s = f.input.bindings[0]!, late = { ...s, publishedAt: instant("2024-01-01T00:00:00.000Z"), knownAt: instant("2024-01-01T00:00:00.000Z") };
    change(f, row => ({ ...row, source: late }));
    expect(codes(propose({ ...f.input, bindings: [late] }))).toContain("PAYROLL_SOURCE_WINDOW_REQUIRED");
    const c = coverage(), future = { ...c, quote: { ...c.quote, source: { ...source, asOf: civilDate("2024-01-01") } } };
    expect(codes(propose(scenario([future]).input))).toContain("C1_SOURCE_AS_OF_REQUIRED");
  });

  it("leaves no-health and aftertax-bank proposals untouched, with no fallback for absent worker route", () => {
    const f = scenario();
    expect(propose({ ...f.input, proposals: [], bindings: [] }).intents).toEqual([]);
    const c = coverage(), aftertax = { ...c, route: { kind: "aftertax_bank" as const, payerId: person, sourceAccountId: bank, evidence: source } };
    const v = scenario([aftertax]), before = canonicalSerialize(v.input.proposals);
    expect(propose({ ...v.input, bindings: [] }).diagnostics).toEqual([]);
    expect(canonicalSerialize(v.input.proposals)).toBe(before);
    expect(codes(propose(v.input))).toContain("PRETAX_EMPLOYER_ROUTE_REQUIRED");
    const missing = { ...c, route: { kind: "pretax_payroll" as const, payerId: person, sponsorId: c.sponsorId, employmentId: "", evidence: source } };
    expect(propose(scenario([missing]).input).intents).toEqual([]);
  });

  it("keeps 1/12/120 preview references proportional, immutable and independent of source histories", () => {
    const sizes: number[] = [];
    for (const n of [1, 12, 120]) {
      const basic = coverage("growth", "2024-01-01", "2034-01-01");
      const c = { ...basic, quote: { ...basic.quote, source: { ...source, sourcePublication: "Original source document ".repeat(4096) } } };
      const rows = Array.from({ length: n }, (_, j) => payroll(c, instant(`${2024 + Math.floor(j / 12)}-${String(j % 12 + 1).padStart(2, "0")}-15T17:00:00.000Z`)));
      const f = scenario([c], rows);
      const input = { ...f.input, proposals: f.input.proposals.slice(0, n) };
      const r = propose(input), encoded = canonicalSerialize(r);
      expect(r.intents).toHaveLength(n);
      expect(encoded).not.toContain("sourcePublication");
      expect(encoded).not.toContain("Original source document");
      expect(encoded).not.toContain('"transaction":');
      expect(encoded).not.toContain('"coverages":');
      expect(new Set(r.intents.flatMap(i => i.claimKeys))).toHaveProperty("size", n * 5);
      expect(propose({ ...input, bindings: [...input.bindings].reverse(), proposals: [...input.proposals].reverse() })).toEqual(r);
      const first = rows[0]!.facts;
      f.payrolls.set(first.source.sourceId, { ...first, requiredBases: [...first.requiredBases].reverse() });
      f.legal.set(first.source.sourceId, [...rows[0]!.bases].reverse());
      expect(propose(input)).toEqual(r);
      sizes.push(encoded.length);
      expect(Object.isFrozen(r.intents[0]!.legalBaseCandidate.appliedBases[0])).toBe(true);
      expect(Object.isFrozen(first)).toBe(false);
    }
    expect(sizes[1]!).toBeLessThan(sizes[0]! * 13);
    expect(sizes[2]!).toBeLessThan(sizes[0]! * 130);
  });
});
