import { describe, expect, it } from "vitest";
import { domainId } from "../../../../src/identity/index.js";
import { calculationTraceId, calculationTraceRef } from "../../../../src/lineage/index.js";
import { createAuthoritativeState } from "../../../../src/state/index.js";
import { civilDate, instant, utcMonthlyPeriods } from "../../../../src/time/index.js";
import { money, Rate, rateConvention } from "../../../../src/values/index.js";
import { applyHouseholdExecutionOverlay, exportHouseholdReplayCheckpoints, replayHouseholdForecastWindow,
  runHouseholdKernel } from "../../../../src/simulation/householdExecution.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { composeMedicareObligations } from "../../../../src/simulation/d2/health/medicare/coordination/index.js";
import type { PremiumRepresentation } from "../../../../src/simulation/d2/integration/aftertaxPremiums/index.js";
import { attachMedicareBank, type MedicareBankInput } from "../../../../src/simulation/d2/integration/medicareBank/index.js";
import { createSsaMedicareParticipant } from "../../../../src/simulation/d2/integration/ssaMedicare/index.js";
import { payment as ssaPayment } from "../ssaMedicare/scenario.js";
import { bank, fixture, input, payable, person, request, source, span, uuid } from "./scenario.js";

const ref = (s: string) => calculationTraceRef(calculationTraceId(s));
const run = (i = input(), f = fixture()) => runHouseholdKernel({ kernel: attachMedicareBank(i).kernel, runContext: f.context, resultTier: "detail" });
const rejected = (i: MedicareBankInput) => {
  const before = canonicalSerialize({ opening: i.kernel.executable.reconciledOpeningState, inputs: i.kernel.canonicalInputs, request: i.request });
  const attached = attachMedicareBank(i);
  expect(attached.kernel).toBe(i.kernel);
  expect(attached.netCashCoverage).toBe("incomplete");
  expect(attached.admittedOperationIds).toEqual([]);
  expect(attached.diagnostics).not.toEqual([]);
  expect(canonicalSerialize({ opening: i.kernel.executable.reconciledOpeningState, inputs: i.kernel.canonicalInputs, request: i.request })).toBe(before);
  return attached;
};

describe("#149 opt-in physical Medicare B/D BANK execution", () => {
  it("recognizes 80 B plus 120 D once, pays each claim once and ends BANK at 1800 without SSA or tax credits", () => {
    const i = input(), before = canonicalSerialize(i.kernel.executable.reconciledOpeningState);
    const attached = attachMedicareBank(i);
    expect(attached.diagnostics).toEqual([]);
    expect(attached.admittedOperationIds).toHaveLength(2);
    const result = run(i), p = result.periods[0]!;
    expect(result.periods, JSON.stringify(result.diagnostics)).toHaveLength(1);
    expect([p.cash, p.statements.expenses, p.netWorth.minus(money("2000")), p.statements.income].map(m => m.amount.toString()))
      .toEqual(["1800", "200", "-200", "0"]);
    expect(p.cashFlow!.recurringExpenseRecognized.equals(money("200"))).toBe(true);
    expect(p.cashFlow!.expenseCashSettlement.equals(money("200"))).toBe(true);
    // The engine may interleave distinct premiums, but for EACH liability
    // recognition must precede its one settlement and the legs must balance.
    const required = [
      { amount: "80", liability: payable("part_b") },
      { amount: "120", liability: payable("part_d") },
    ];
    expect(p.transactions).toHaveLength(4);
    for (const item of required) {
      const recognition = p.transactions.findIndex(t => t.type === "expense_recognition"
        && t.legs.some(l => l.type === "liability" && l.entityId === item.liability));
      const settlement = p.transactions.findIndex(t => t.type === "expense_settlement"
        && t.legs.some(l => l.type === "liability" && l.entityId === item.liability));
      expect(recognition).toBeGreaterThanOrEqual(0);
      expect(settlement).toBeGreaterThan(recognition);
      expect(p.transactions[recognition]!.legs.map(l => [l.posting, l.type, l.amount.amount.toString()])).toEqual([
        ["debit", "expense", item.amount], ["credit", "liability", item.amount],
      ]);
      expect(p.transactions[settlement]!.legs.map(l => [l.posting, l.type, l.amount.amount.toString()])).toEqual([
        ["debit", "liability", item.amount], ["credit", "cash", item.amount],
      ]);
    }
    const claims = Object.values(result.state.obligations);
    expect(claims).toHaveLength(2);
    expect(claims.every(c => c.kind === "obligation" && c.outstandingAmount.isZero() && c.settlementIds.length === 1)).toBe(true);
    expect(result.state.identities.recognitionIds).toHaveLength(2);
    expect(result.state.identities.settlementIds).toHaveLength(2);
    expect(result.state.ssaMedicarePayments).toBeUndefined();
    expect(p.transactions.flatMap(t => t.legs).some(l => l.type === "tax" || l.type === "income")).toBe(false);
    expect(p.transactions.flatMap(t => t.legs).filter(l => l.type === "cash").every(l => l.type === "cash" && l.accountId === bank())).toBe(true);
    for (const b of i.confirmed) {
      const claim = claims.find(c => c.balanceEntityId === b.payable.liabilityId)!;
      expect(claim.originalAmount.equals(b.obligation.memberObligation)).toBe(true);
      expect(claim.economicOwnerId).toBe(person());
      const trace = canonicalSerialize(claim.traceRefs);
      for (const identity of [b.obligation.part, b.obligation.personId, b.obligation.coverageId, b.obligation.planId,
        b.obligation.recipientId, b.obligation.quoteId, b.obligation.period.start, b.obligation.irmaa!.ruleSnapshotId]) expect(trace).toContain(identity);
      expect(result.state.liabilities[b.payable.liabilityId]!.balance.isZero()).toBe(true);
    }
    expect(result.status).toBe("incomplete");
    expect(result.outputCapabilities?.recurringExpenseRecognized?.status).toBe("complete");
    expect(result.outputCapabilities?.netWorth?.status).toBe("incomplete");
    expect(result.diagnostics.some(d => d.entityType === "tax_capability")).toBe(true);
    expect(canonicalSerialize(i.kernel.executable.reconciledOpeningState)).toBe(before);
    expect(runHouseholdKernel({ kernel: i.kernel, runContext: fixture().context, resultTier: "detail" }).periods[0]!.transactions).toEqual([]);
  });

  it.each(["part_b", "part_d"] as const)("settles %s without an SSA award or the other Part", part => {
    const r = request("2026-06", [part]);
    const result = run(input(r));
    expect(result.periods[0]!.cash.equals(money(part === "part_b" ? "1920" : "1880"))).toBe(true);
    expect(result.state.identities.recognitionIds).toHaveLength(1);
    expect(result.state.identities.settlementIds).toHaveLength(1);
    expect(r.awards).toEqual([]);
  });

  it("adds exact Part-specific nonzero IRMAA once and treats sourced-zero A as coverage evidence", () => {
    const r = request("2026-06", ["part_a", "part_b", "part_d"], 0, { b: "13.25", d: "7.50" });
    const i = input(r), attached = attachMedicareBank(i), result = run(i);
    expect(attached.diagnostics).toEqual([]);
    expect(attached.kernel.cash!.input.expenses).toHaveLength(2);
    expect(composeMedicareObligations(r).obligations).toHaveLength(3);
    expect(result.periods[0]!.cash.equals(money("1779.25"))).toBe(true);
    expect(result.periods[0]!.statements.expenses.equals(money("220.75"))).toBe(true);
    expect(Object.values(result.state.obligations).map(c => c.originalAmount.amount.toString()).sort()).toEqual(["127.5", "93.25"]);
    expect(result.state.identities.recognitionIds).toHaveLength(2);
  });

  it("emits no expense, claim or BANK debit for a sourced-zero Part A alone", () => {
    const i = input(request("2026-06", ["part_a"])), attached = attachMedicareBank(i);
    expect(attached.diagnostics).toEqual([]);
    expect(attached.kernel.cash!.input.expenses).toEqual([]);
    const result = run(i);
    expect(result.periods[0]!.transactions).toEqual([]);
    expect(Object.values(result.state.obligations)).toEqual([]);
    expect(result.state.accounts[bank()]!.cash.equals(money("2000"))).toBe(true);
  });

  it.each(["advantage", "medigap", "supplement"] as const)("keeps elected %s outside the bounded bank adapter", part => {
    const r = request("2026-06", [part]);
    rejected(input(r));
  });

  it("reattaches as a no-op and preserves results under reversed source and confirmation ordering", () => {
    const i = input(), first = attachMedicareBank(i);
    expect(attachMedicareBank({ ...i, kernel: first.kernel }).kernel).toBe(first.kernel);
    const r = { ...i.request, premiums: { ...i.request.premiums, coverages: [...i.request.premiums.coverages].reverse() },
      irmaa: { ...i.request.irmaa, enrollments: [...i.request.irmaa.enrollments].reverse() } };
    const reversed = { ...input(r), confirmed: [...i.confirmed].reverse() };
    expect(run(reversed)).toEqual(run(i));
    expect(attachMedicareBank({ ...reversed, kernel: first.kernel }).kernel).toBe(first.kernel);
    const changed = { ...i, confirmed: i.confirmed.map((b, n) => n ? b : { ...b, settlementPriority: 3 }), kernel: first.kernel };
    rejected(changed);
  });

  it("leaves a full unpaid D claim and a truthful shortfall after prioritized B exhausts available funding", () => {
    const f = fixture(1, "100"), i = input(request(), f.kernel), result = run(i, f), p = result.periods[0]!;
    expect(p.cash.equals(money("20"))).toBe(true);
    expect(p.statements.expenses.equals(money("200"))).toBe(true);
    expect(p.cashFlow!.expenseCashSettlement.equals(money("80"))).toBe(true);
    expect(p.cashFlow!.outstandingExpenseObligations.equals(money("120"))).toBe(true);
    expect(p.liquidityShortfalls).toHaveLength(1);
    expect(result.state.identities.settlementIds).toHaveLength(1);
    const unpaid = Object.values(result.state.obligations).find(c => c.balanceEntityId === payable("part_d"))!;
    expect(unpaid.outstandingAmount.equals(money("120"))).toBe(true);
    expect(unpaid.settlementIds).toEqual([]);
    expect(result.state.liabilities[payable("part_d")]!.balance.equals(money("120"))).toBe(true);
    expect(result.status).toBe("incomplete");
    expect(run(i, f)).toEqual(result);
  });

  it("executes 13 exact source-known monthly requests across years and restores the v3 checkpoint via existing replay API", () => {
    const f = fixture(13, "5000"), months = utcMonthlyPeriods(f.context.simulationStart, 13);
    let kernel = f.kernel;
    for (const month of months) {
      const attached = attachMedicareBank(input(request(month.start.slice(0, 7)), kernel));
      expect(attached.diagnostics).toEqual([]); kernel = attached.kernel;
    }
    const detail = runHouseholdKernel({ kernel, runContext: f.context, resultTier: "detail" });
    const summary = runHouseholdKernel({ kernel, runContext: f.context });
    expect(detail.periods, JSON.stringify(detail.diagnostics)).toHaveLength(13);
    expect(detail.state.accounts[bank()]!.cash.equals(money("2400"))).toBe(true);
    expect(detail.state.identities.recognitionIds).toHaveLength(26);
    expect(detail.state.identities.settlementIds).toHaveLength(26);
    expect(detail.periods.every(p => p.statements.expenses.equals(money("200")) && p.transactions.length === 4)).toBe(true);
    expect(summary.state).toEqual(detail.state);
    expect(summary.periods.map(p => p.statements)).toEqual(detail.periods.map(p => p.statements));
    const artifact = createPortableHouseholdReplayArtifact(summary);
    expect(artifact.version).toBe("household-replay/v3");
    const restored = restorePortableHouseholdReplayArtifact(JSON.parse(JSON.stringify(artifact)));
    expect(exportHouseholdReplayCheckpoints(restored)).toEqual(exportHouseholdReplayCheckpoints(summary));
    expect(exportHouseholdReplayCheckpoints(restored)).toHaveLength(1);
    const replay = replayHouseholdForecastWindow(restored, detail.periods[12]!.period);
    expect(replay.periods).toEqual(detail.periods.slice(12));
    expect(replay.state).toEqual(detail.state);
  });

  it("preserves second-recipient identity and savings ownership across the year boundary", () => {
    const f = fixture(2, "2000", 2, "2026-12");
    let kernel = applyHouseholdExecutionOverlay(f.kernel, { reconciledOpeningState: createAuthoritativeState({ ...f.state,
      accounts: { ...f.state.accounts, [bank(1)]: { ...f.state.accounts[bank(1)]!, kind: "savings" } } }) });
    for (const month of ["2026-12", "2027-01"]) for (const n of [1, 0]) {
      const attached = attachMedicareBank(input(request(month, ["part_b", "part_d"], n), kernel));
      expect(attached.diagnostics).toEqual([]); kernel = attached.kernel;
    }
    const result = runHouseholdKernel({ kernel, runContext: f.context, resultTier: "detail" });
    expect(result.periods, JSON.stringify(result.diagnostics)).toHaveLength(2);
    expect([bank(), bank(1)].every(id => result.state.accounts[id]!.cash.equals(money("1600")))).toBe(true);
    expect(result.state.identities.recognitionIds).toHaveLength(8);
    expect(new Set(Object.values(result.state.obligations).map(c => c.economicOwnerId))).toEqual(new Set([person(), person(1)]));
  });

  it.each(["late_quote", "missing_cms", "missing_history", "projected_law", "mixed_route", "ssa_route", "duplicate_part", "cancelled_plan", "partial_month"])("rejects %s before changing the kernel", kind => {
    const i = input(), r = i.request, c = r.premiums.coverages[0]!;
    const variants: Record<string, MedicareBankInput["request"]> = {
      late_quote: { ...r, premiums: { ...r.premiums, coverages: [{ ...c, quote: { ...c.quote, source: { ...c.quote.source, asOf: civilDate("2026-06-02") } } }, r.premiums.coverages[1]!] } },
      missing_cms: { ...r, irmaa: { ...r.irmaa, rules: [] } },
      missing_history: { ...r, irmaa: { ...r.irmaa, histories: [] } },
      projected_law: { ...r, irmaa: { ...r.irmaa, rules: r.irmaa.rules.map(rule => ({ ...rule, source: { ...rule.source, projectionStatus: "explicit_projected" } })) } },
      mixed_route: { ...r, premiums: { ...r.premiums, coverages: [{ ...c, route: { ...c.route, benefitId: "ssa" } as typeof c.route }, r.premiums.coverages[1]!] } },
      ssa_route: { ...r, premiums: { ...r.premiums, coverages: [{ ...c, route: { kind: "ssa_benefit_deduction_pending", payerId: person(), benefitId: "ssa", evidence: source("route") } }, r.premiums.coverages[1]!] } },
      duplicate_part: { ...r, premiums: { ...r.premiums, coverages: [...r.premiums.coverages, { ...c, id: "renamed", planId: "renamed" }] } },
      cancelled_plan: { ...r, premiums: { ...r.premiums, coverages: [{ ...c, endExclusive: civilDate("2026-06-01") }, r.premiums.coverages[1]!] } },
      partial_month: { ...r, premiums: { ...r.premiums, period: span("2026-06-02", "2026-07-01") }, irmaa: { ...r.irmaa, period: span("2026-06-02", "2026-07-01") } },
    };
    rejected({ ...i, request: variants[kind]!, asOf: civilDate("2026-12-31") });
  });

  it.each(["confirmation_amount", "confirmation_source", "bank_owner", "bank_household", "bank_class", "missing_payable", "wrong_provider", "wrong_part", "late_payable", "identity", "priority", "duplicate_statement"])("rejects binding failure %s atomically", kind => {
    const i = input(), b = i.confirmed[0]!, rest = i.confirmed.slice(1);
    const variants: Record<string, Partial<MedicareBankInput>> = {
      confirmation_amount: { confirmed: [{ ...b, obligation: { ...b.obligation, memberObligation: money("1") } }, ...rest] },
      confirmation_source: { confirmed: [{ ...b, obligation: { ...b.obligation, base: { ...b.obligation.base, source: { ...b.obligation.base.source, version: "tampered" } } } }, ...rest] },
      bank_owner: { confirmed: [{ ...b, bank: { ...b.bank, payerId: person(1) } }, ...rest] },
      bank_household: { confirmed: [{ ...b, bank: { ...b.bank, householdId: "other" } }, ...rest] },
      bank_class: { kernel: applyHouseholdExecutionOverlay(i.kernel, { reconciledOpeningState: createAuthoritativeState({ ...i.kernel.executable.reconciledOpeningState,
        accounts: { [bank()]: { id: bank(), ownerId: person(), kind: "brokerage", cash: money("2000") } } }) }) },
      missing_payable: { confirmed: [{ ...b, payable: { ...b.payable, liabilityId: domainId("liability", uuid(999)) } }, ...rest] },
      wrong_provider: { confirmed: [{ ...b, payable: { ...b.payable, recipientId: "wrong" } }, ...rest] },
      wrong_part: { confirmed: [{ ...b, payable: { ...b.payable, part: "part_d" } }, ...rest] },
      late_payable: { confirmed: [{ ...b, payable: { ...b.payable, evidence: { ...b.payable.evidence, asOf: civilDate("2026-06-02") } } }, ...rest] },
      identity: { confirmed: [{ ...b, expenseId: domainId("expense", bank()) }, ...rest] },
      priority: { confirmed: i.confirmed.map(c => ({ ...c, settlementPriority: 1 })) },
      duplicate_statement: { confirmed: [...i.confirmed, b] },
    };
    rejected({ ...i, ...variants[kind] });
  });

  it("rejects changed/cancelled source bindings, renamed plan and existing posted claims", () => {
    const i = input(), first = attachMedicareBank(i), r = i.request;
    const changed = { ...r, premiums: { ...r.premiums, coverages: r.premiums.coverages.map(c => ({ ...c, recipientId: "renamed-provider" })) } };
    rejected({ ...input(changed, first.kernel) });
    const c = r.premiums.coverages[0]!;
    const renamed = { ...r, premiums: { ...r.premiums, coverages: [{ ...c, planId: "new-plan", quote: { ...c.quote, quoteId: "new-quote" },
      eligibility: c.eligibility.map(e => ({ ...e, planId: "new-plan" })) }, r.premiums.coverages[1]!] },
      irmaa: { ...r.irmaa, enrollments: r.irmaa.enrollments.map(e => e.part === "part_b" ? { ...e, planId: "new-plan" } : e) } };
    rejected(input(renamed, first.kernel));
    const executed = run(i);
    const withClaims = applyHouseholdExecutionOverlay(i.kernel, { reconciledOpeningState: executed.state });
    rejected({ ...i, kernel: withClaims });
  });

  it("rejects a borrowed Medicare trace marker on a different generic expense", () => {
    const first = attachMedicareBank(input(request("2026-06", ["part_b"])));
    expect(first.diagnostics).toEqual([]);
    const original = first.kernel.cash!.input.expenses[0]!;
    const copiedMarker = { ...original, id: domainId("expense", uuid(980)),
      baseMonthlyAmount: money("77"),
      primitiveIds: { indexGrowth: domainId("primitive-instance", uuid(981)),
        inflationLink: domainId("primitive-instance", uuid(982)),
        recurrence: domainId("primitive-instance", uuid(983)) } };
    // Copied source refs do not make a financially different stream another
    // authorized Part B payment or a proven independent Part D obligation.
    const kernel = applyHouseholdExecutionOverlay(first.kernel, {
      cashFlowInput: { ...first.kernel.cash!.input,
        expenses: [...first.kernel.cash!.input.expenses, copiedMarker] },
    });
    const next = input(request("2026-06", ["part_d"]), kernel);
    expect(rejected(next).diagnostics.some(d => d.diagnosticCode === "MEDICARE_DUPLICATE_PART")).toBe(true);
  });

  it("does not admit BANK over an already attached SSA-deducted member/Part/month", () => {
    const i = input(), q = ssaPayment();
    const r = { ...q.c2, awards: [], deductionTerms: [], premiums: { ...q.c2.premiums,
      coverages: q.c2.premiums.coverages.map(c => ({ ...c,
        route: { kind: "aftertax_bank" as const, payerId: q.payable.recipientId, sourceAccountId: q.bank.accountId, evidence: source("route") },
      })) },
      banks: [{ ...i.request.banks[0]!, householdId: q.c2.premiums.householdId, ownerIds: [q.payable.recipientId], accountId: q.bank.accountId }] };
    const kernel = applyHouseholdExecutionOverlay(i.kernel, { cashFlowInput: { ...i.kernel.cash!.input, householdId: domainId("household", q.c2.premiums.householdId) },
      participants: [createSsaMedicareParticipant({ householdId: q.c2.premiums.householdId, personId: q.payable.recipientId, payments: [q] })] });
    const rows = composeMedicareObligations(r).obligations;
    expect(rows).toHaveLength(2);
    const confirmed = i.confirmed.map(b => {
      const obligation = rows.find(o => o.part === b.obligation.part)!;
      return { ...b, obligation,
        bank: { ...b.bank, householdId: q.c2.premiums.householdId, payerId: q.payable.recipientId, accountId: q.bank.accountId },
        payable: { ...b.payable, householdId: q.c2.premiums.householdId, payerId: q.payable.recipientId, personId: q.payable.recipientId,
          coverageId: obligation.coverageId, quoteId: obligation.quoteId, recipientId: obligation.recipientId } };
    });
    expect(rejected({ ...i, request: r, kernel, confirmed }).diagnostics[0]!.missingFacts.join()).toContain("Existing SSA participant");
    const bankOnly = applyHouseholdExecutionOverlay(kernel, { participants: [],
      cashFlowInput: { ...kernel.cash!.input, ownerId: domainId("person", q.payable.recipientId), cashAccountId: q.bank.accountId },
      reconciledOpeningState: createAuthoritativeState({ ...i.kernel.executable.reconciledOpeningState,
        accounts: { [q.bank.accountId]: { id: q.bank.accountId, ownerId: domainId("person", q.payable.recipientId), kind: "checking", cash: money("2000") } } }) });
    const attached = attachMedicareBank({ ...i, request: r, kernel: bankOnly, confirmed });
    expect(attached.diagnostics).toEqual([]);
    const lateSsa = createSsaMedicareParticipant({ householdId: q.c2.premiums.householdId, personId: q.payable.recipientId,
      payments: [{ ...q, bankCashBefore: money("1800") }] });
    const concurrent = applyHouseholdExecutionOverlay(attached.kernel, { participants: [...attached.kernel.executable.participants!, lateSsa] });
    const result = runHouseholdKernel({ kernel: concurrent, runContext: fixture().context, resultTier: "detail" });
    expect(result.diagnostics.map(d => d.code)).toContain("MEDICARE_DOUBLE_ROUTE");
    expect(result.periods).toEqual([]);
    expect(result.state).toEqual(bankOnly.executable.reconciledOpeningState);
  });

  it("replaces only an exactly equivalent generic VS2 premium and preserves a distinct unrelated expense", () => {
    const r = request("2026-06", ["part_b"]), i = input(r), stream = attachMedicareBank(i).kernel.cash!.input.expenses[0]!;
    const generic = { ...stream, id: domainId("expense", uuid(900)), sourceTraceRefs: [ref(r.premiums.coverages[0]!.quote.source.ruleSnapshotId)] };
    const rent = { ...stream, id: domainId("expense", uuid(910)), baseMonthlyAmount: money("10"), start: instant("2026-06-02T00:00:00.000Z"),
      inflationBaseAt: instant("2026-06-02T00:00:00.000Z"),
      recurrence: { ...stream.recurrence, anchor: instant("2026-06-02T00:00:00.000Z") }, settlementPriority: 5,
      primitiveIds: { indexGrowth: domainId("primitive-instance", uuid(911)), inflationLink: domainId("primitive-instance", uuid(912)), recurrence: domainId("primitive-instance", uuid(913)) },
      sourceTraceRefs: [ref(source("rent").ruleSnapshotId)] };
    const kernel = applyHouseholdExecutionOverlay(i.kernel, { cashFlowInput: { ...i.kernel.cash!.input, expenses: [generic, rent] } });
    rejected({ ...i, kernel });
    const representations: PremiumRepresentation[] = [
      { operationId: i.confirmed[0]!.obligation.operationId, streamId: generic.id, relationship: "equivalent_expense", quoteId: i.confirmed[0]!.obligation.quoteId,
        evidence: r.premiums.coverages[0]!.quote.source, streamSourceTraceId: r.premiums.coverages[0]!.quote.source.ruleSnapshotId },
      { operationId: i.confirmed[0]!.obligation.operationId, streamId: rent.id, relationship: "distinct_obligation", quoteId: i.confirmed[0]!.obligation.quoteId,
        evidence: source("rent"), streamSourceTraceId: source("rent").ruleSnapshotId },
    ];
    const admitted = attachMedicareBank({ ...i, kernel, representations });
    expect(admitted.diagnostics).toEqual([]);
    expect(admitted.kernel.cash!.input.expenses).toHaveLength(2);
    expect(admitted.kernel.cash!.input.expenses.find(e => e.id === rent.id)).toEqual(rent);
    expect(run({ ...i, kernel, representations }).periods[0]!.cash.equals(money("1910"))).toBe(true);
    const different = applyHouseholdExecutionOverlay(kernel, { cashFlowInput: { ...kernel.cash!.input, expenses: [{ ...generic, baseMonthlyAmount: money("81") }, rent] } });
    rejected({ ...i, kernel: different, representations });
    const changedPriority = applyHouseholdExecutionOverlay(kernel, { cashFlowInput: { ...kernel.cash!.input, expenses: [{ ...generic, settlementPriority: 8 }, rent] } });
    rejected({ ...i, kernel: changedPriority, representations });
  });

  it("fails unresolved unrelated same-day BANK contention without committing any period", () => {
    const i = input(request("2026-06", ["part_b"])), attached = attachMedicareBank(i), stream = attached.kernel.cash!.input.expenses[0]!;
    const other = { ...stream, id: domainId("expense", uuid(800)), settlementPriority: 5,
      primitiveIds: { indexGrowth: domainId("primitive-instance", uuid(801)), inflationLink: domainId("primitive-instance", uuid(802)), recurrence: domainId("primitive-instance", uuid(803)) },
      sourceTraceRefs: [ref("unrelated")] };
    const kernel = applyHouseholdExecutionOverlay(attached.kernel, { cashFlowInput: { ...attached.kernel.cash!.input, expenses: [stream, other] } });
    const result = runHouseholdKernel({ kernel, runContext: fixture().context, resultTier: "detail" });
    expect(result.status).toBe("incomplete");
    expect(result.diagnostics.map(d => d.code)).toContain("HOUSEHOLD_CONTENTION_UNRESOLVED");
    expect(result.periods).toEqual([]);
    expect(result.state).toEqual(i.kernel.executable.reconciledOpeningState);
  });

  it("rejects sources after the execution cutoff without mutating opening state", () => {
    const i = input(), attached = attachMedicareBank(i), f = fixture();
    const result = runHouseholdKernel({ kernel: attached.kernel, runContext: { ...f.context, dataCutoff: instant("2025-11-01T00:00:00.000Z") }, resultTier: "detail" });
    expect(result.periods).toEqual([]);
    expect(result.state).toEqual(i.kernel.executable.reconciledOpeningState);
    expect(result.status).toBe("incomplete");
  });

  it("retains independent wages and never treats employer subsidy as household income", () => {
    const i = input(), payday = instant("2026-06-05T00:00:00.000Z");
    const wage = { id: domainId("income", uuid(700)), ownerId: person(), baseMonthlyAmount: money("500"),
      start: payday, recurrence: { kind: "utc_monthly" as const, anchor: payday, invalidDayPolicy: "skip" as const },
      depositAccountId: bank(), growthRate: Rate.fromDecimal("0", rateConvention.effectiveAnnual()), growthBaseAt: payday,
      primitiveIds: { growth: domainId("primitive-instance", uuid(701)), recurrence: domainId("primitive-instance", uuid(702)) },
      sourceTraceRefs: [ref("source:unrelated-wage")] };
    const kernel = applyHouseholdExecutionOverlay(i.kernel, { cashFlowInput: { ...i.kernel.cash!.input, incomes: [wage] } });
    const r = { ...i.request, premiums: { ...i.request.premiums, coverages: i.request.premiums.coverages.map(c => ({ ...c,
      quote: { ...c.quote, gross: c.quote.member.plus(money("10")), employer: money("10") } })) } };
    const attached = attachMedicareBank(input(r, kernel));
    expect(attached.diagnostics).toEqual([]);
    expect(attached.kernel.cash!.input.incomes).toEqual([wage]);
    const result = run(input(r, kernel));
    expect(result.periods[0]!.statements.income.equals(money("500"))).toBe(true);
    expect(result.periods[0]!.statements.expenses.equals(money("200"))).toBe(true);
    expect(result.periods[0]!.cash.equals(money("2300"))).toBe(true);
  });

  it("rejects a request outside the compiled horizon and a changed actual VS2 amount", () => {
    rejected(input(request("2026-07")));
    const i = input(), attached = attachMedicareBank(i);
    const kernel = applyHouseholdExecutionOverlay(attached.kernel, { cashFlowInput: { ...attached.kernel.cash!.input,
      expenses: attached.kernel.cash!.input.expenses.map((s, n) => n ? s : { ...s, baseMonthlyAmount: money("81") }) } });
    const result = runHouseholdKernel({ kernel, runContext: fixture().context, resultTier: "detail" });
    expect(result.diagnostics.map(d => d.code)).toContain("MEDICARE_EXECUTION_BINDING_MISMATCH");
    expect(result.periods).toEqual([]);
    expect(result.state).toEqual(i.kernel.executable.reconciledOpeningState);
  });
});
