import { describe, expect, it } from "vitest";
import { accountingTransactionId, createAccountingLeg, createAccountingTransaction } from "../../../../../src/accounting/index.js";
import { civilDate, instant } from "../../../../../src/time/index.js";
import { money } from "../../../../../src/values/index.js";
import { evaluateFsa } from "../../../../../src/simulation/d2/health/fsa/index.js";
import { fsaPayrollDigest, proposeFsaPayrollBindings, type FsaOriginalContribution, type FsaOriginalPaycheck } from "../../../../../src/simulation/d2/health/fsa/payrollBinding/index.js";
import { bank, employee, grant, paidReceipt, scenario } from "./fixtures.js";

const run = (s: ReturnType<typeof scenario>) => proposeFsaPayrollBindings(s.input);
const codes = (s: ReturnType<typeof scenario>) => run(s).diagnostics.map(d => d.diagnosticCode);
const change = (s: ReturnType<typeof scenario>, fn: (r: FsaOriginalContribution) => FsaOriginalContribution, id = "employee-1") => {
  const r = fn(s.rows.get(id)!); s.rows.set(id, r);
  s.setRequest({ ...s.request, payroll: s.request.payroll.map(c => c.contributionId === id ? r.contribution : c) });
};
const paycheck = (s: ReturnType<typeof scenario>, fn: (w: FsaOriginalPaycheck) => FsaOriginalPaycheck, id = "employee-1") =>
  change(s, r => { if (r.funding.kind !== "employee") throw new Error("fixture employee required");
    return { ...r, funding: { kind: "employee", paycheck: fn(r.funding.paycheck) } }; }, id);
const rejects = (s: ReturnType<typeof scenario>) => { expect(run(s).coverage).toBe("incomplete"); expect(run(s).bindings).toEqual([]); };

describe("#148 conditional original-source FSA payroll binder", () => {
  it("keeps two independent $100 paychecks and a separate $25 grant conditional and immutable", () => {
    const s = scenario(), before = fsaPayrollDigest(s.request), r = run(s);
    expect(r.coverage).toBe("conditional"); expect(r.diagnostics).toEqual([]); expect(r.bindings).toHaveLength(3);
    const employees = r.bindings.filter(b => b.contributionSource === "employee_salary_reduction");
    expect(employees.map(b => b.authorizedEmployee.toJSON())).toEqual([money("100").toJSON(), money("100").toJSON()]);
    expect(new Set(employees.map(b => b.payroll!.transactionId)).size).toBe(2);
    expect(employees.every(b => b.authorizedEmployer.isZero())).toBe(true);
    const employer = r.bindings.find(b => b.contributionSource === "employer")!;
    expect(employer.authorizedEmployer.equals(money("25"))).toBe(true); expect(employer.authorizedEmployee.isZero()).toBe(true);
    expect(employer.payroll).toBeNull(); expect(employer.householdIncome).toBe(false);
    for (const b of r.bindings) {
      expect(b).toMatchObject({ committed: false, postable: false, funding: "incomplete", payrollEffect: "incomplete", tax: "incomplete",
        entitlementSettlement: "incomplete", medicalExpense: false, netWorthTreatment: "excluded_restricted_entitlement" });
      expect(Object.isFrozen(b)).toBe(true); expect(Object.isFrozen(b.sourceRef)).toBe(true);
      expect(b.inputDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
    expect(Object.isFrozen(r.bindings)).toBe(true); expect(fsaPayrollDigest(s.request)).toBe(before);
  });

  it("does not claim physical payroll from full elected entitlement or repeat paid medical reimbursement", () => {
    const s = scenario(); s.setRequest({ ...s.request, receipts: [paidReceipt()] });
    const e = evaluateFsa(s.request);
    expect(e.entitlement!.annualElection.equals(money("1000"))).toBe(true);
    expect(e.entitlement!.remaining.equals(money("1300"))).toBe(true);
    expect(e.entitlement!.employeePayrollToDate.isZero()).toBe(true);
    expect(e.entitlement!.employerPayrollToDate.isZero()).toBe(true);
    expect(e.claims[0]!.settlementRequired).toBe(false);
    expect(run(s).bindings).toHaveLength(3);
    expect(JSON.stringify(run(s))).not.toContain("medical-settlement");
    const empty = scenario([], []);
    expect(evaluateFsa(empty.request).entitlement!.availableForNewClaims.equals(money("1500"))).toBe(true);
    expect(run(empty).bindings).toEqual([]);
  });

  it("admits zero employee and employer-only elections without inventing wage cash", () => {
    const z = scenario([employee("employee-1", "2026-01-15", "0")], []);
    expect(run(z).bindings[0]!.authorizedEmployee.isZero()).toBe(true);
    const s = scenario([], [grant()]);
    s.setRequest({ ...s.request, plan: { ...s.request.plan, annualElection: money("0") } });
    change(s, r => ({ ...r, election: { ...r.election, annualEmployee: money("0") } }), "grant-1");
    expect(run(s).bindings).toHaveLength(1); expect(run(s).bindings[0]!.payroll).toBeNull();
  });

  it("checks posted and pending inventory but emits only pending rows", () => {
    const s = scenario();
    change(s, r => ({ ...r, alreadyAllocated: true, contribution: { ...r.contribution, status: "previously_posted", postingRef: "actual-old-payroll-posting" } }));
    expect(run(s).bindings).toHaveLength(2);
    expect(run(s).bindings.some(b => b.contributionId === "employee-1")).toBe(false);
    s.rows.delete("employee-1"); rejects(s);
  });

  it("includes posted and pending amounts in the same annual limit", () => {
    const s = scenario([employee("employee-1", "2026-01-15", "800"), employee("employee-2", "2026-01-30", "200.01")], []);
    change(s, r => ({ ...r, alreadyAllocated: true, contribution: { ...r.contribution, status: "previously_posted", postingRef: "old-payroll-post" } }));
    rejects(s); expect(codes(s)).toContain("FSA_EVALUATION_INCOMPLETE");
  });

  it("admits the last covered day but never silently extends employment or coverage", () => {
    const s = scenario([employee("employee-1", "2026-12-31")], []);
    expect(run(s).bindings).toHaveLength(1);
    paycheck(s, w => ({ ...w, employment: { ...w.employment, effectiveUntil: w.dueAt } }));
    rejects(s);
  });

  it.each(["owner", "amount", "permission"])("requires separate employer funding %s", kind => {
    const s = scenario([], [grant()]);
    change(s, r => ({ ...r, funding: r.funding.kind === "employer_grant" ? { ...r.funding,
      ...(kind === "owner" ? { fundingOwnerId: "employee" } : kind === "amount" ? { authorizedAmount: money("24.99") } : { planPermits: false }) } : r.funding }), "grant-1");
    rejects(s); expect(codes(s)).toContain("FSA_EMPLOYER_GRANT_REQUIRED");
  });

  it.each(["employee-2", "grant-1"])("requires independent original history for %s", id => {
    const s = scenario(); s.rows.delete(id); rejects(s);
    expect(codes(s)).toContain("FSA_ORIGINAL_CONTRIBUTION_REQUIRED");
  });

  it.each(["claim", "authorization", "paycheck", "occurrence", "grant"])("rejects duplicate %s without choosing an order winner", kind => {
    const s = scenario(); const first = s.rows.get("employee-1")!;
    if (kind === "claim") change(s, r => ({ ...r, claimId: first.claimId }), "employee-2");
    if (kind === "authorization") change(s, r => ({ ...r, authorizationId: first.authorizationId }), "employee-2");
    if (kind === "paycheck" && first.funding.kind === "employee") {
      const w = first.funding.paycheck;
      change(s, r => ({ ...r, effectiveAt: first.effectiveAt, contribution: { ...r.contribution, effectiveAt: first.contribution.effectiveAt }, funding: { kind: "employee", paycheck: w } }), "employee-2");
    }
    if (kind === "occurrence" && first.funding.kind === "employee") {
      const occurrenceId = first.funding.paycheck.occurrenceId;
      paycheck(s, w => ({ ...w, occurrenceId }), "employee-2");
    }
    if (kind === "grant") {
      const g = grant("grant-2");
      s.rows.set("grant-2", { ...g, funding: { ...grant().funding } });
      s.setRequest({ ...s.request, payroll: [...s.request.payroll, g.contribution] });
    }
    rejects(s);
    const forward = run(s); s.setRequest({ ...s.request, payroll: [...s.request.payroll].reverse() });
    expect(run(s)).toEqual(forward);
  });

  it("rejects duplicate contribution identities even when unchanged evaluateFsa deduplicates them", () => {
    const s = scenario(); s.setRequest({ ...s.request, payroll: [...s.request.payroll, s.request.payroll[0]!] }); rejects(s);
  });

  it.each(["proof", "receipt", "medical-payment", "medical-settlement"])("rejects payroll reuse of reimbursed expense %s", id => {
    const s = scenario(); s.setRequest({ ...s.request, receipts: [paidReceipt()] });
    change(s, r => ({ ...r, claimId: id })); rejects(s); expect(codes(s)).toContain("FSA_CROSS_CLAIM_REUSE");
  });

  it("rejects a contribution one cent beyond actual gross capacity", () => {
    const s = scenario([employee("employee-1", "2026-01-15", "815.01")], []); rejects(s);
    expect(codes(s)).toContain("FSA_ORIGINAL_PAYCHECK_INVALID");
    const exact = scenario([employee("employee-1", "2026-01-15", "815")], []);
    expect(run(exact).bindings).toHaveLength(1);
  });

  it.each(["bank-owner", "bank-kind", "employer", "job", "income", "already-fsa", "inventory", "asset-target"])("rejects wrong original wage %s", kind => {
    const s = scenario();
    if (kind === "bank-owner") paycheck(s, w => ({ ...w, bank: { ...w.bank, ownerId: "someone-else" } }));
    if (kind === "bank-kind") paycheck(s, w => ({ ...w, bank: { ...w.bank, kind: "HSA" as "BANK" } }));
    if (kind === "employer") paycheck(s, w => ({ ...w, employerId: "new-employer" }));
    if (kind === "job") paycheck(s, w => ({ ...w, employmentId: "second-job" }), "employee-2");
    if (kind === "income") paycheck(s, w => ({ ...w, incomeId: "second-income" }), "employee-2");
    if (kind === "already-fsa") paycheck(s, w => ({ ...w, fsaClaimIds: ["another-FSA-claim"] }));
    if (kind === "inventory") paycheck(s, w => ({ ...w, inventoryComplete: false }));
    if (kind === "asset-target") paycheck(s, w => ({ ...w, contributions: w.contributions.map(c => ({ ...c, positionId: "unsourced-position" })) }));
    rejects(s);
  });

  it("rejects changed signed original journal even if new legs still balance", () => {
    const s = scenario(); const [id, tx] = [...s.journals][0]!;
    s.journals.set(id, createAccountingTransaction({ id: tx.id, date: tx.date, type: tx.type, legs: [
      createAccountingLeg({ type: "cash", posting: "debit", accountId: bank, cashFlowClass: "operating", amount: money("1000") }),
      createAccountingLeg({ type: "income", posting: "credit", amount: money("1000") }),
    ] })); rejects(s);
  });

  it.each(["hsa", "dependent-care", "unconfirmed", "not-permitted", "wrong-member", "wrong-year", "wrong-limit", "termination", "history", "year-boundary", "unsupported-year-end"])("fails closed for %s", kind => {
    const s = scenario(), p = s.request.plan;
    if (kind === "hsa" || kind === "dependent-care") change(s, r => ({ ...r, election: { ...r.election,
      instrumentFamily: (kind === "hsa" ? "hsa" : "dependent_care_fsa") as "health_fsa" } }));
    if (kind === "unconfirmed") change(s, r => ({ ...r, election: { ...r.election, userConfirmed: false } }));
    if (kind === "not-permitted") change(s, r => ({ ...r, election: { ...r.election, planPermits: false } }));
    if (kind === "wrong-member") change(s, r => ({ ...r, election: { ...r.election, memberId: "other-member" } }));
    if (kind === "wrong-year") s.setRequest({ ...s.request, plan: { ...p, law: { ...p.law!, planYearId: "2027" } } });
    if (kind === "wrong-limit") s.setRequest({ ...s.request, plan: { ...p, law: { ...p.law!, electionLimit: money("999.99") } } });
    if (kind === "termination") s.setRequest({ ...s.request, plan: { ...p, termination: { kind: "terminated", incurredEndExclusive: civilDate("2026-01-16"),
      submitEndExclusive: civilDate("2027-04-01"), disposition: "forfeit_after_runout" } } });
    if (kind === "history") s.setRequest({ ...s.request, historyEvidence: null });
    if (kind === "year-boundary") change(s, r => ({ ...r, contribution: { ...r.contribution, effectiveAt: civilDate("2027-01-01") } }));
    if (kind === "unsupported-year-end") s.setRequest({ ...s.request, plan: { ...p, yearEnd: null } });
    rejects(s);
  });

  it.each(["withdrawal", "late-contribution", "late-law", "late-plan", "future-election"])("rejects %s original source", kind => {
    const s = scenario();
    if (kind === "withdrawal") { s.journals.clear(); }
    if (kind === "late-contribution") change(s, r => ({ ...r, ref: { ...r.ref, knownAt: instant("2026-02-01T00:00:00.000Z"), publishedAt: instant("2026-02-01T00:00:00.000Z") } }));
    if (kind === "future-election") change(s, r => ({ ...r, election: { ...r.election, electedAt: instant("2026-02-01T00:00:00.000Z") } }));
    if (kind === "late-law" || kind === "late-plan") {
      const original = s.input.originals.request;
      s.input.originals = { ...s.input.originals, request: scope => {
        const f = original(scope)!; const key = kind === "late-law" ? "lawRef" : "planRef";
        return { ...f, [key]: { ...f[key], knownAt: instant("2026-02-01T00:00:00.000Z"), publishedAt: instant("2026-02-01T00:00:00.000Z") } };
      } };
    }
    rejects(s);
  });

  it("does not replace a withdrawn original plan/year source with a caller reconstruction", () => {
    const s = scenario();
    s.input.originals = { ...s.input.originals, request: () => undefined };
    rejects(s); expect(codes(s)).toContain("FSA_ORIGINAL_REQUEST_REQUIRED");
  });

  it("keeps missing local wage facts explicitly incomplete without computing exemptions", () => {
    const s = scenario(); change(s, r => ({ ...r, wageBases: { ...r.wageBases, complete: false,
      facts: r.wageBases.facts.filter(b => b.jurisdiction !== "US:LOCAL") } }));
    expect(run(s).bindings).toHaveLength(3); expect(codes(s)).toContain("FSA_WAGE_BASE_FACTS_INCOMPLETE");
    expect(run(s).bindings.every(b => b.tax === "incomplete")).toBe(true);
  });

  it("preserves results under independent evidence reordering", () => {
    const s = scenario(), before = run(s);
    s.setRequest({ ...s.request, payroll: [...s.request.payroll].reverse() });
    for (const [id, r] of s.rows) {
      s.rows.set(id, { ...r, wageBases: { ...r.wageBases, required: [...r.wageBases.required].reverse(), facts: [...r.wageBases.facts].reverse() },
        funding: r.funding.kind === "employee" ? { ...r.funding, paycheck: { ...r.funding.paycheck,
          contributions: [...r.funding.paycheck.contributions].reverse(), withholding: [...r.funding.paycheck.withholding].reverse() } } : r.funding });
    }
    for (const [id, tx] of s.journals) s.journals.set(id, createAccountingTransaction({ ...tx, legs: [...tx.legs].reverse() }));
    expect(run(s)).toEqual(before);
  });

  it("bounds 1/12/120-occurrence serialized growth without copying annual evidence", () => {
    const sizes = [1, 12, 120].map(n => {
      const authored = Array.from({ length: n }, (_, i) => {
        const e = employee(`e-${String(i).padStart(3, "0")}`, "2026-01-15", "1");
        const at = instant(`2026-01-15T17:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.000Z`);
        const tx = createAccountingTransaction({ ...e.transaction, id: accountingTransactionId(`tx:recognition:income:synthetic-salary:${at}`), date: at });
        const w = e.row.funding.kind === "employee" ? e.row.funding.paycheck : null;
        if (!w) throw new Error("fixture paycheck");
        return { transaction: tx, row: { ...e.row, effectiveAt: at, funding: { kind: "employee" as const,
          paycheck: { ...w, dueAt: at, transactionId: tx.id, signedJournalDigest: fsaPayrollDigest(tx) } } } };
      });
      const s = scenario(authored, []), r = run(s); expect(r.bindings).toHaveLength(n);
      const json = JSON.stringify(r);
      expect(json).not.toContain("sourcePublication"); expect(json).not.toContain("\"legs\"");
      expect(json).not.toContain("\"receipts\""); expect(json).not.toContain("\"withholding\"");
      return json.length;
    });
    expect(sizes[1]!).toBeLessThan(sizes[0]! * 12);
    expect(sizes[2]!).toBeLessThan(sizes[0]! * 120);
    expect(sizes[2]! - sizes[1]!).toBeLessThan(108 * 4000);
  });
});
