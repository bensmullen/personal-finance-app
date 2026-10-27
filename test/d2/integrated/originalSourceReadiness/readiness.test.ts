import { describe, expect, it } from "vitest";
import { createAccountingLeg, createAccountingTransaction } from "../../../../src/accounting/index.js";
import { civilDate, instant } from "../../../../src/time/index.js";
import { decimal, money } from "../../../../src/values/index.js";
import { evaluateIraBasisYearChain, type IraReturnRevision } from "../../../../src/simulation/d2/retirement/conversions/yearChain/index.js";
import { bindSeriesEESources, type EEOriginal } from "../../../../src/simulation/d2/fixedIncome/seriesEE/sourceBinding/index.js";
import { proposeFsaPayrollBindings, type FsaOriginalContribution } from "../../../../src/simulation/d2/health/fsa/payrollBinding/index.js";
import { evaluateFsa } from "../../../../src/simulation/d2/health/fsa/index.js";
import { fixture, provider, source } from "./iraOriginals.js";
import { original, pin } from "./eeOriginals.js";
import { bank, scenario } from "./fsaOriginals.js";
import { cutoff, cutoffInstant, freeze, householdId, personId, rawMarker } from "./household.js";

const household = () => {
  const ira = fixture(), fsa = scenario(), ee = original();
  return { ira, fsa, ee: ee as EEOriginal | undefined, pins: [pin(ee)] };
};
type Household = ReturnType<typeof household>;
const evaluate = (s: Household) => ({
  evidenceTier: "conditional" as const,
  ira: evaluateIraBasisYearChain(s.ira.input, provider(s.ira.facts)),
  ee: bindSeriesEESources(s.pins, id => s.ee?.sourceId === id ? s.ee : undefined),
  fsa: proposeFsaPayrollBindings(s.fsa.input),
});
const snapshot = (s: Household) => JSON.stringify({
  ira: s.ira, ee: s.ee, pins: s.pins, request: s.fsa.request,
  rows: [...s.fsa.rows], journals: [...s.fsa.journals],
});
const changeFsa = (s: Household, fn: (r: FsaOriginalContribution) => FsaOriginalContribution, id = "employee-1") => {
  const row = fn(s.fsa.rows.get(id)!);
  s.fsa.rows.set(id, row);
  s.fsa.setRequest({ ...s.fsa.request, payroll: s.fsa.request.payroll.map(c => c.contributionId === id ? row.contribution : c) });
};
// These checks observe original records only. No aggregate balance store or
// canonical posting writer is fabricated to make conditional proposals look funded.
const unchangedEvaluation = (s: Household) => {
  const before = snapshot(s), result = evaluate(s);
  expect(snapshot(s)).toBe(before);
  return result;
};
const revision = (knownAt = civilDate("2035-01-01")): IraReturnRevision => ({
  personId, taxYear: 2026, filingId: "amendment:2026", filingVersion: "2", filingStatus: "synthetic_single",
  filingKind: "amended", revisesFilingId: "original:2026", status: "filed", filedAt: knownAt,
  publishedAt: knownAt, knownAt, source: source("amendment:2026", 2026),
});

describe("#149 S8-4 same-household original-source readiness (conditional only)", () => {
  it("qualifies independently supplied originals with literal cents and no physical posting", () => {
    const s = household();
    freeze(s.ira); freeze(s.ee); freeze(s.fsa.request);
    for (const row of s.fsa.rows.values()) freeze(row);
    for (const journal of s.fsa.journals.values()) freeze(journal);
    const r = unchangedEvaluation(s);
    expect(r.evidenceTier).toBe("conditional");
    expect(s.ira.input.personId).toBe(personId);
    expect(s.ee!.request.lot).toMatchObject({ householdId, personId });
    expect(s.fsa.input.scope).toMatchObject({ householdId, personId });
    expect(s.ira.input).toMatchObject({ asOf: cutoff, knownAt: cutoff });
    expect(s.ee!.request.knownAt).toBe(cutoff);
    expect(s.fsa.input.context).toEqual({ asOf: cutoffInstant, dataCutoff: cutoffInstant });
    expect(r.ira).toMatchObject({ coverage: "conditional", committed: false, postable: false,
      funding: "incomplete", taxLiability: "incomplete", basisPersistence: "incomplete" });
    // Money values below are authored in cents, independent of proposal arithmetic.
    expect(s.ira.facts.map(h => h.original!.carryForwardBasis.amount.times(decimal("100")).toString())).toEqual(["20000", "18000", "16200", "0"]);
    expect(r.ira.years.map(y => [y.details!.basisRecovered, y.details!.taxable, y.details!.remainingBasis]
      .map(m => m.amount.times(decimal("100")).toString()))).toEqual([["2000", "8000", "18000"], ["1800", "8200", "16200"], ["16200", "3800", "0"]]);
    expect(r.ira.years.map(y => [y.priorSourceId, y.originalSourceId, y.originalFilingId])).toEqual([
      ["return:2025", "return:2026", "original:2026"], ["return:2026", "return:2027", "original:2027"],
      ["return:2027", "return:2028", "original:2028"],
    ]);
    for (const y of r.ira.years) expect(y).toMatchObject({ committed: false, postable: false,
      funding: "incomplete", taxLiability: "incomplete", basisPersistence: "incomplete", reasons: [], annualDiagnosticCodes: [] });

    expect(r.ee.diagnostics).toEqual([]); expect(r.ee.occurrences).toHaveLength(1);
    const ee = r.ee.occurrences[0]!;
    expect(ee).toMatchObject({ sourceId: "publisher:000", sourceVersion: "original-1", kind: "redemption",
      committed: false, postable: false, funding: "incomplete", physicalRedemption: "incomplete" });
    expect([ee.summary.cashDelta, ee.summary.redeemedPrincipal, ee.summary.basisDelta, ee.summary.netWorthDelta]
      .map(m => m.amount.times(decimal("100")).toString())).toEqual(["10303", "10000", "-10000", "303"]);
    expect(ee.taxCharacter.map(t => [t.jurisdiction, t.taxable.amount.times(decimal("100")).toString()]))
      .toEqual([["US", "303"], ["US:STATE", "0"], ["US:STATE:CITY", "0"]]);
    expect(ee.coverage.find(c => c.affectedOutput === "settlement")!.coverage).toBe("incomplete");

    expect(r.fsa).toMatchObject({ committed: false, postable: false, coverage: "conditional", diagnostics: [] });
    expect(r.fsa.bindings).toHaveLength(3);
    const employees = r.fsa.bindings.filter(b => b.contributionSource === "employee_salary_reduction");
    expect(employees.map(b => b.authorizedEmployee.amount.times(decimal("100")).toString())).toEqual(["10000", "10000"]);
    expect(employees.map(b => b.sourceRef.sourceId)).toEqual(["contribution:employee-1", "contribution:employee-2"]);
    expect(new Set(employees.map(b => b.payroll!.transactionId)).size).toBe(2);
    expect(employees.every(b => b.authorizedEmployer.isZero())).toBe(true);
    const grant = r.fsa.bindings.find(b => b.contributionSource === "employer")!;
    expect(grant.authorizedEmployer.amount.times(decimal("100")).toString()).toBe("2500");
    expect(grant.authorizedEmployee.isZero()).toBe(true); expect(grant.payroll).toBeNull();
    for (const b of r.fsa.bindings) expect(b).toMatchObject({ committed: false, postable: false, funding: "incomplete",
      payrollEffect: "incomplete", tax: "incomplete", entitlementSettlement: "incomplete", householdIncome: false,
      medicalExpense: false, netWorthTreatment: "excluded_restricted_entitlement" });
    const entitlement = evaluateFsa(s.fsa.request).entitlement!;
    expect(entitlement.annualElection.equals(money("1000"))).toBe(true);
    expect(entitlement.employeePayrollToDate.isZero()).toBe(true);
    expect(entitlement.employerPayrollToDate.isZero()).toBe(true);
    expect(s.ee!.request.lot.opening.redeemed).toBe(false);
    expect(s.ee!.request.lot.opening.purchaseBasis.equals(money("100"))).toBe(true);
    // Existing signed journal facts stay $815 bank, $70 assets and $115 credits;
    // no FSA salary reduction, EE proceeds or IRA taxable amount is posted here.
    for (const tx of s.fsa.journals.values()) {
      expect(tx.legs.filter(l => l.type === "cash").map(l => l.amount.amount.times(decimal("100")).toString())).toEqual(["81500"]);
      expect(tx.legs.filter(l => l.type === "asset").map(l => l.amount.amount.times(decimal("100")).toString())).toEqual(["5000", "2000", "10000", "1000", "500"]);
    }
    expect(s.fsa.request.payroll.every(c => c.status === "pending" && c.postingRef === null)).toBe(true);
    expect(unchangedEvaluation(s)).toEqual(r);
  });

  it.each(["withdrawn", "unavailable", "amended", "revision", "late", "wrong-person"])("isolates IRA %s after eligible evaluation", kind => {
    const s = household(), before = evaluate(s), h = s.ira.facts[1]!;
    if (kind === "unavailable") s.ira.facts.splice(1, 1);
    else s.ira.facts[1] = kind === "withdrawn" ? { ...h, status: "withdrawn" }
      : kind === "revision" ? { ...h, revisionInventory: { ...h.revisionInventory, revisions: [revision()] } }
      : { ...h, original: { ...h.original!, ...(kind === "amended" ? { filingKind: "amended" as const }
        : kind === "late" ? { knownAt: civilDate("2041-01-01") } : { personId: "other-person" }) } };
    const after = unchangedEvaluation(s);
    expect(after.ira.coverage).toBe("incomplete"); expect(after.ira.years.every(y => y.details === null)).toBe(true);
    expect(after.ira.years[0]!.reasons).toEqual([kind === "withdrawn" ? "UNQUALIFIED_HISTORY_AUTHORITY"
      : kind === "unavailable" ? "HISTORY_LOOKUP_FAILED" : kind === "revision" ? "KNOWN_RETURN_REVISION" : "UNQUALIFIED_ORIGINAL_FILING"]);
    expect(after.ee).toEqual(before.ee); expect(after.fsa).toEqual(before.fsa);
  });

  it("does not inherit later-known IRA revision provenance into an earlier cutoff replay", () => {
    const s = household(), before = evaluate(s), h = s.ira.facts[1]!;
    s.ira.facts[1] = { ...h, revisionInventory: { ...h.revisionInventory, revisions: [revision(civilDate("2041-01-01"))] } };
    expect(unchangedEvaluation(s)).toEqual(before);
  });

  it("keeps EE noncash accrual separate from the same household's source cash", () => {
    const s = household(), before = evaluate(s), o = s.ee!;
    s.ee = { ...o, request: { ...o.request, action: "valuation", effectiveAt: civilDate("2026-02-01") } };
    s.pins = [pin(s.ee)];
    const after = unchangedEvaluation(s);
    expect(after.ee.diagnostics).toEqual([]); expect(after.ee.occurrences).toHaveLength(1);
    expect(after.ee.occurrences[0]!.summary.assetDelta.equals(money("1"))).toBe(true);
    expect(after.ee.occurrences[0]!.summary.cashDelta.isZero()).toBe(true);
    expect(after.ee.occurrences[0]).toMatchObject({ committed: false, postable: false, physicalRedemption: "incomplete" });
    expect(after.ira).toEqual(before.ira); expect(after.fsa).toEqual(before.fsa);
  });

  it.each(["withdrawn", "unavailable", "vintage", "digest", "wrong-person", "wrong-household", "claim-reuse", "future-source"])("isolates EE %s after eligible evaluation", kind => {
    const s = household(), before = evaluate(s), o = s.ee!, p = s.pins[0]!;
    if (kind === "unavailable") s.ee = undefined;
    if (kind === "withdrawn") s.ee = { ...o, status: "withdrawn" };
    if (kind === "vintage") s.ee = { ...o, request: { ...o.request, lot: { ...o.request.lot, issueMonth: civilDate("2026-02-01") } } };
    if (kind === "digest") s.pins = [{ ...p, digest: p.digest.replace(/[a-f0-9]$/, p.digest.endsWith("0") ? "1" : "0") }];
    if (kind === "wrong-person" || kind === "wrong-household") s.pins = [{ ...p, identity: { ...p.identity,
      ...(kind === "wrong-person" ? { personId: "other-person" } : { householdId: "other-household" }) } }];
    if (kind === "claim-reuse") s.pins = [p, { ...p, occurrenceId: "second-claim-on-same-lot" }];
    if (kind === "future-source") {
      s.ee = { ...o, request: { ...o.request, rule: { ...o.request.rule!, source: { ...o.request.rule!.source, asOf: civilDate("2041-01-01") } } } };
      s.pins = [pin(s.ee)]; // New pin still cannot qualify later source knowledge.
    }
    const after = unchangedEvaluation(s);
    expect(after.ee.occurrences).toEqual([]);
    const code = kind === "withdrawn" || kind === "unavailable" ? "ORIGINAL_UNAVAILABLE"
      : kind === "vintage" || kind === "digest" ? "ORIGINAL_CHANGED"
      : kind === "claim-reuse" ? "DUPLICATE_CLAIM" : kind === "future-source" ? "EVALUATION_INCOMPLETE" : "IDENTITY_MISMATCH";
    expect(after.ee.diagnostics.length).toBeGreaterThan(0);
    expect(after.ee.diagnostics.every(d => d.code === code)).toBe(true);
    expect(after.ira).toEqual(before.ira); expect(after.fsa).toEqual(before.fsa);
  });

  it.each(["withdrawn", "journal", "duplicate-paycheck", "claim-reuse", "wrong-person", "wrong-household", "late"])("isolates FSA %s after eligible evaluation", kind => {
    const s = household(), before = evaluate(s);
    if (kind === "withdrawn") s.fsa.input.originals = { ...s.fsa.input.originals, request: () => undefined };
    if (kind === "journal") {
      const [id, tx] = [...s.fsa.journals][0]!;
      s.fsa.journals.set(id, createAccountingTransaction({ ...tx, legs: [
        createAccountingLeg({ type: "cash", posting: "debit", accountId: bank, cashFlowClass: "operating", amount: money("1000") }),
        createAccountingLeg({ type: "income", posting: "credit", amount: money("1000") }),
      ] }));
    }
    if (kind === "duplicate-paycheck") {
      const first = s.fsa.rows.get("employee-1")!;
      if (first.funding.kind !== "employee") throw new Error("expected original employee");
      const occurrenceId = first.funding.paycheck.occurrenceId;
      changeFsa(s, r => ({ ...r, funding: r.funding.kind === "employee" ? { kind: "employee",
        paycheck: { ...r.funding.paycheck, occurrenceId } } : r.funding }), "employee-2");
    }
    if (kind === "claim-reuse") changeFsa(s, r => ({ ...r, claimId: s.fsa.rows.get("employee-1")!.claimId }), "employee-2");
    if (kind === "wrong-person" || kind === "wrong-household") s.fsa.input.scope = { ...s.fsa.input.scope,
      ...(kind === "wrong-person" ? { personId: "other-person" } : { householdId: "other-household" }) };
    if (kind === "late") changeFsa(s, r => ({ ...r, ref: { ...r.ref,
      knownAt: instant("2041-01-01T00:00:00.000Z"), publishedAt: instant("2041-01-01T00:00:00.000Z") } }));
    const after = unchangedEvaluation(s);
    expect(after.fsa.coverage).toBe("incomplete"); expect(after.fsa.bindings).toEqual([]);
    expect(after.fsa.diagnostics.map(d => d.diagnosticCode)).toContain(kind === "withdrawn" ? "FSA_ORIGINAL_REQUEST_REQUIRED"
      : kind === "journal" ? "FSA_ORIGINAL_PAYCHECK_INVALID" : kind === "late" ? "FSA_ELECTION_OR_SOURCE_INVALID"
      : kind === "wrong-person" || kind === "wrong-household" ? "FSA_ORIGINAL_SCOPE_REQUIRED" : "FSA_DUPLICATE_OR_CROSS_JOB_AUTHORIZATION");
    expect(after.ira).toEqual(before.ira); expect(after.ee).toEqual(before.ee);
  });

  it("re-reads the independent EE original and records independent IRA/FSA lookup identities", () => {
    const s = household(), o = s.ee!, reads: string[] = [];
    const result = bindSeriesEESources(s.pins, id => { reads.push(id); return reads.length === 1 ? o : undefined; });
    expect(reads).toEqual(["publisher:000", "publisher:000"]);
    expect(result.occurrences).toEqual([]); expect(result.diagnostics[0]!.code).toBe("ORIGINAL_UNAVAILABLE");
    const years: number[] = [], p = provider(s.ira.facts);
    evaluateIraBasisYearChain(s.ira.input, { ...p, lookupOriginalReturn(q) {
      expect(q).toMatchObject({ personId, asOf: cutoff, knownAt: cutoff }); years.push(q.taxYear); return p.lookupOriginalReturn(q);
    } });
    expect(years).toEqual([2025, 2026, 2027, 2028]);
    const journals: string[] = [], originals = s.fsa.input.originals;
    proposeFsaPayrollBindings({ ...s.fsa.input, originals: { ...originals, journal(ref) {
      journals.push(ref.sourceId); return originals.journal(ref);
    } } });
    expect(journals).toEqual(["journal:employee-1", "journal:employee-2"]);
  });

  it("replays deterministically under independent source and contribution permutations", () => {
    const s = household(), before = unchangedEvaluation(s);
    s.ira.input = { ...s.ira.input, years: [...s.ira.input.years].reverse().map(y => ({ ...y, accounts: [...y.accounts].reverse() })) };
    s.ira.facts.reverse();
    s.fsa.setRequest({ ...s.fsa.request, payroll: [...s.fsa.request.payroll].reverse() });
    const entries = [...s.fsa.rows].reverse(); s.fsa.rows.clear();
    for (const [id, row] of entries) s.fsa.rows.set(id, { ...row, wageBases: { ...row.wageBases,
      facts: [...row.wageBases.facts].reverse(), required: [...row.wageBases.required].reverse() } });
    expect(unchangedEvaluation(s)).toEqual(before);
    expect(unchangedEvaluation(s)).toEqual(before);
  });

  it("bounds 1→2→4 distinct mixed conditional events without embedding raw originals", () => {
    const s = household(), r = unchangedEvaluation(s);
    const events = [r.ee.occurrences[0]!, ...r.fsa.bindings];
    const payload = JSON.stringify(r);
    for (const marker of [rawMarker, "ORIGINAL_DOCUMENT_APPENDIX_ONLY", '"schedule"', '"sourcePublication"', '"legs"', '"withholding"', '"revisionInventory"'])
      expect(payload).not.toContain(marker);
    const sizes = [1, 2, 4].map(n => {
      const selected = events.slice(0, n);
      expect(selected).toHaveLength(n);
      expect(new Set(selected.map(e => e.operationId)).size).toBe(n);
      const bytes = new TextEncoder().encode(JSON.stringify(selected)).length;
      expect(bytes).toBeLessThan(n * 6000 + 2);
      return bytes;
    });
    expect(sizes[1]!).toBeGreaterThan(sizes[0]!); expect(sizes[2]!).toBeGreaterThan(sizes[1]!);
    expect(sizes[1]! - sizes[0]!).toBeLessThan(6000);
    expect(sizes[2]! - sizes[1]!).toBeLessThan(2 * 6000);
    expect(r.ee.occurrences[0]!.digest).toMatch(/^ee-request\/v1:sha256:[a-f0-9]{64}$/);
    expect(r.fsa.bindings.every(b => /^sha256:[a-f0-9]{64}$/.test(b.inputDigest))).toBe(true);
  });
});
