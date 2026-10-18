import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { domainId } from "../../../../src/identity/index.js";
import { calculationTraceId, calculationTraceRef } from "../../../../src/lineage/index.js";
import { createAuthoritativeState } from "../../../../src/state/index.js";
import { civilDate, instant } from "../../../../src/time/index.js";
import { Currency, Money, USD, decimal, money } from "../../../../src/values/index.js";
import { compileHouseholdKernel, applyHouseholdExecutionOverlay, runHouseholdKernel, replayHouseholdForecastWindow } from "../../../../src/simulation/householdExecution.js";
import { createPrimitiveRuntimeStateStore } from "../../../../src/simulation/period.js";
import { canonicalSerialize, createRunContext, runId, scenarioId } from "../../../../src/simulation/run.js";
import { proposePremiums, type PremiumCoverage, type PremiumRequest, type PremiumSource } from "../../../../src/simulation/d2/health/premiums/index.js";
import { attachAftertaxPremiums, type AftertaxPremiumInput, type ConfirmedPremium, type PremiumRepresentation } from "../../../../src/simulation/d2/integration/aftertaxPremiums/index.js";
import { catalogSchema } from "../../../fixtures/d2/schema.js";

const catalog = catalogSchema.parse(JSON.parse(readFileSync(new URL("../../../fixtures/d2/catalog.json", import.meta.url), "utf8")));
const fixture = (id: string) => catalog.cases.find(c => c.id === id)!;
const cents = (value: string) => money(value).times(decimal("0.01"));
// Malformed transport boundary: supported Currency.of intentionally cannot construct this.
const unknownCurrency: Currency = Object.create(USD, { code: { value: "ZZZ" } });
const uuid = (n: number) => `14900000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const household = domainId("household", uuid(1));
const payer = domainId("person", uuid(2));
const bank = domainId("account", uuid(3));
const payable = domainId("liability", uuid(4));
const scenario = scenarioId(uuid(5));
const start = instant("2026-01-01T00:00:00.000Z");
const asOf = civilDate("2025-12-31");
const span = (start = "2026-01-01", end = "2026-02-01") => ({ start: civilDate(start), endExclusive: civilDate(end) });
const source = (id = "plan-1"): PremiumSource => ({ ...span("2025-01-01", "2027-01-01"), asOf: civilDate("2025-12-01"),
  ruleSnapshotId: `source:${id}`, jurisdiction: "US", ruleFamily: "authored_premium_quote",
  sourcePublication: `synthetic plan terms ${id}`, version: "1", projectionStatus: "verified" });
const coverage = (id = "plan-1"): PremiumCoverage => ({ ...span(), id, planId: id, householdId: household,
  memberIds: [payer], sponsorId: "sponsor", recipientId: `insurer:${id}`, planFamily: "health_insurance",
  route: { kind: "aftertax_bank", payerId: payer, sourceAccountId: bank, evidence: source(id) },
  eligibility: [{ memberId: payer, householdId: household, planId: id, eligible: true, evidence: source(id) }],
  quote: { quoteId: `quote:${id}`, source: source(id), gross: money("300"), employer: money("0"), member: money("300"),
    schedule: { anchor: civilDate("2026-01-15"), frequency: "monthly", interval: 1, invalidDay: "skip", amountBasis: "per_occurrence_no_proration" } },
});
const request = (coverages: readonly PremiumCoverage[] = [coverage()], end = "2026-02-01"): PremiumRequest => ({
  householdId: household, memberIds: [payer], period: span("2026-01-01", end), coverages, coordination: [],
});
const kernel = (cash = "1000", months = 1) => compileHouseholdKernel({
  cashFlowInput: { householdId: household, ownerId: payer, cashAccountId: bank, expensePayableLiabilityId: payable,
    baseCurrency: USD, incomes: [], expenses: [], events: [] },
  reconciledOpeningState: createAuthoritativeState({ accounts: { [bank]: { id: bank, ownerId: payer, kind: "checking", cash: money(cash) } },
    positions: {}, liabilities: { [payable]: { id: payable, balance: money("0") } } }),
  reconciledPrimitiveState: createPrimitiveRuntimeStateStore(), scenarioIdentity: scenario, executionMonths: months,
  scenarioBindings: {}, contentionPolicy: { id: "synthetic-policy", version: "1", rules: [] },
}, start);
const confirmations = (r: PremiumRequest): readonly ConfirmedPremium[] => proposePremiums(r).proposals.map(p => {
  const n = Number(p.coverageId.split("-").at(-1)) * 1000 + Number(p.effectiveAt.slice(5, 7)) * 10;
  return { proposal: p, expenseId: domainId("expense", uuid(n)), settlementPriority: Number(p.coverageId.split("-").at(-1)),
    primitiveIds: { indexGrowth: domainId("primitive-instance", uuid(n + 1)), inflationLink: domainId("primitive-instance", uuid(n + 2)), recurrence: domainId("primitive-instance", uuid(n + 3)) },
    bank: { accountId: bank, householdId: household, payerId: payer, classification: "BANK", evidence: source(p.coverageId) },
    payable: { liabilityId: payable, householdId: household, payerId: payer, coverageId: p.coverageId, evidence: source(p.coverageId) } };
});
const input = (r = request(), k = kernel()): AftertaxPremiumInput => ({ kernel: k, request: r, asOf, confirmed: confirmations(r), representations: [] });
const context = (months = 1) => createRunContext({ runId: runId(uuid(6)), scenarioId: scenario,
  asOf: instant(`${asOf}T00:00:00.000Z`), dataCutoff: instant(`${asOf}T00:00:00.000Z`), simulationStart: start,
  simulationEnd: instant(months === 1 ? "2026-02-01T00:00:00.000Z" : "2026-03-01T00:00:00.000Z"), baseCurrency: USD });
const run = (k: ReturnType<typeof kernel>, months = 1) => runHouseholdKernel({ kernel: k, runContext: context(months), resultTier: "detail" });
const ref = (s: string) => calculationTraceRef(calculationTraceId(s));
const withExpense = (k: ReturnType<typeof kernel>, expense: NonNullable<typeof k.cash>["input"]["expenses"][number]) =>
  applyHouseholdExecutionOverlay(k, { cashFlowInput: { ...k.cash!.input, expenses: [expense] } });

describe("#149 bounded physical C1 after-tax premium integration", () => {
  it("health_after_tax executes real recognition, claim and conditional settlement exactly once", () => {
    const f = fixture("health_after_tax");
    const c = coverage();
    const r = request([{ ...c, ...span(f.input.terms.effectiveStart!, f.input.terms.effectiveEndExclusive!), quote: { ...c.quote,
      gross: cents(f.input.amounts.grossPremiumCents!), employer: cents(f.input.amounts.employerShareCents!), member: cents(f.input.amounts.householdShareCents!) } }]);
    const k = kernel(cents(f.input.accounts.find(a => a.id === "cash")!.openingCents).amount.toString());
    const before = canonicalSerialize({ k: k.canonicalInputs, opening: k.executable.reconciledOpeningState, r });
    const attached = attachAftertaxPremiums(input(r, k));
    expect(attached.diagnostics).toEqual([]);
    expect(attached.admittedOperationIds).toHaveLength(1);
    const result = run(attached.kernel);
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("completed");
    const period = result.periods[0]!;
    expect(period.cash.equals(money("700"))).toBe(true);
    expect(period.netWorth.minus(money("1000")).equals(money("-300"))).toBe(true);
    expect(period.statements.income.isZero()).toBe(true);
    expect(period.cashFlow!.recurringExpenseRecognized.equals(money("300"))).toBe(true);
    expect(period.statements.expenses.equals(money("300"))).toBe(true);
    expect(period.transactions.map(t => t.type)).toEqual(["expense_recognition", "expense_settlement"]);
    expect(period.transactions.map(t => t.legs.map(l => [l.posting, l.type, l.amount.amount.toString()]))).toEqual([
      [["debit", "expense", "300"], ["credit", "liability", "300"]],
      [["debit", "liability", "300"], ["credit", "cash", "300"]],
    ]);
    const cashLeg = period.transactions[1]!.legs.find(l => l.type === "cash")!;
    expect(cashLeg.type === "cash" && cashLeg.accountId).toBe(bank);
    expect(Object.values(result.state.obligations)).toHaveLength(1);
    expect(result.state.liabilities[payable]!.balance.isZero()).toBe(true);
    expect(result.state.identities.recognitionIds).toHaveLength(1);
    expect(result.state.identities.settlementIds).toHaveLength(1);
    expect(period.traceRefs.some(t => t.traceId === c.quote.quoteId)).toBe(true);
    expect(canonicalSerialize({ k: k.canonicalInputs, opening: k.executable.reconciledOpeningState, r })).toBe(before);
    expect(f.expected.integratedRuntimeEvidence).toBe(false);
    expect(f.expected.capability).toBe("not_yet_executable");
    const again = attachAftertaxPremiums({ ...input(r, k), kernel: attached.kernel });
    expect(again.kernel).toBe(attached.kernel);
    expect(run(again.kernel)).toEqual(result);
    const summary = runHouseholdKernel({ kernel: attached.kernel, runContext: context() });
    expect(summary.status).toBe("completed");
    expect(summary.state.accounts[bank]!.cash.equals(money("700"))).toBe(true);
  });

  it("does not turn the employer subsidy into household expense or cash income", () => {
    const c = coverage();
    const attached = attachAftertaxPremiums(input(request([{ ...c, quote: { ...c.quote, gross: money("400"), employer: money("100") } }])));
    const result = run(attached.kernel);
    expect(result.periods[0]!.cash.equals(money("700"))).toBe(true);
    expect(result.periods[0]!.cashFlow!.recurringExpenseRecognized.equals(money("300"))).toBe(true);
    expect(result.periods[0]!.statements.income.isZero()).toBe(true);
  });

  it("insufficient bank cash preserves the full actual claim and posts no settlement or overdraft", () => {
    const attached = attachAftertaxPremiums(input(request(), kernel("100")));
    const result = run(attached.kernel);
    expect(result.status).toBe("completed");
    const p = result.periods[0]!;
    expect(p.cash.equals(money("100"))).toBe(true);
    expect(p.netWorth.equals(money("-200"))).toBe(true);
    expect(p.cashFlow!.recurringExpenseRecognized.equals(money("300"))).toBe(true);
    expect(p.cashFlow!.expenseCashSettlement.isZero()).toBe(true);
    expect(p.cashFlow!.outstandingExpenseObligations.equals(money("300"))).toBe(true);
    expect(p.liquidityShortfalls).toHaveLength(1);
    expect(p.transactions.map(t => t.type)).toEqual(["expense_recognition"]);
    expect(result.state.liabilities[payable]!.balance.equals(money("300"))).toBe(true);
    expect(Object.values(result.state.obligations)).toHaveLength(1);
    expect(result.state.identities.settlementIds).toEqual([]);
    expect(run(attached.kernel)).toEqual(result);
  });

  it("replays exact cross-month ledger, claims, provenance and cash with stable split-request identities", () => {
    const c = { ...coverage(), ...span("2026-01-01", "2026-03-01") };
    const r = request([c], "2026-03-01");
    const k = kernel("1000", 2);
    const attached = attachAftertaxPremiums(input(r, k));
    expect(attached.diagnostics).toEqual([]);
    expect(attached.kernel.cash!.input.expenses).toHaveLength(2);
    const result = run(attached.kernel, 2);
    expect(result.status).toBe("completed");
    expect(result.periods.map(p => p.cash.amount.toString())).toEqual(["700", "400"]);
    expect(result.periods.map(p => p.transactions.length)).toEqual([2, 2]);
    expect(Object.values(result.state.obligations)).toHaveLength(2);
    expect(result.state.identities.recognitionIds).toHaveLength(2);
    expect(run(attached.kernel, 2)).toEqual(result);
    const forecast = runHouseholdKernel({ kernel: attached.kernel, runContext: context(2) });
    const replay = replayHouseholdForecastWindow(forecast, result.periods[1]!.period);
    expect(replay.periods).toEqual([result.periods[1]!]);
    expect(replay.state).toEqual(result.state);
    expect(replayHouseholdForecastWindow(forecast, result.periods[1]!.period)).toEqual(replay);
    const january = attachAftertaxPremiums(input({ ...r, period: span() }, k));
    const february = attachAftertaxPremiums(input({ ...r, period: span("2026-02-01", "2026-03-01") }, january.kernel));
    expect(february.diagnostics).toEqual([]);
    expect(run(february.kernel, 2)).toEqual(result);
    expect(run(attachAftertaxPremiums({ ...input(r, k), kernel: attached.kernel }).kernel, 2)).toEqual(result);
  });

  it("premium_end_exclusive has no quote, expense, claim or cash movement", () => {
    const f = fixture("premium_end_exclusive");
    const c = { ...coverage(), ...span(f.input.terms.effectiveStart!, f.input.terms.effectiveEndExclusive!) };
    const i = input(request([c]));
    const attached = attachAftertaxPremiums(i);
    expect(attached.admittedOperationIds).toEqual([]);
    expect(attached.kernel).toBe(i.kernel);
    const result = run(attached.kernel);
    expect(result.periods[0]!.transactions).toEqual([]);
    expect(result.state.accounts[bank]!.cash.equals(money("1000"))).toBe(true);
    expect(Object.values(result.state.obligations)).toEqual([]);
    expect(f.expected.integratedRuntimeEvidence).toBe(false);
  });

  it("keeps the unchanged health_pretax_employer prep case source-sourced but unsupported", () => {
    const f = fixture("health_pretax_employer");
    const c = coverage();
    const r = request([{ ...c, route: { kind: "pretax_payroll", payerId: payer, sponsorId: c.sponsorId, employmentId: "job", evidence: source() },
      quote: { ...c.quote, gross: cents(f.input.amounts.grossPremiumCents!), employer: cents(f.input.amounts.employerShareCents!), member: cents(f.input.amounts.employeeShareCents!) } }]);
    const i = input(r);
    const attached = attachAftertaxPremiums(i);
    expect(attached.kernel).toBe(i.kernel);
    expect(attached.diagnostics[0]!.coverage).toBe("incomplete");
    expect(attached.diagnostics[0]!.missingFacts.join()).toContain("UNSUPPORTED_PREMIUM_ROUTE");
    expect(run(attached.kernel).periods[0]!.transactions).toEqual([]);
    expect(f.expected.capability).toBe("decision_required");
    expect(f.expected.integratedRuntimeEvidence).toBe(false);
  });

  it("replaces an exactly equivalent source-qualified generic expense without a second expense", () => {
    const i = input();
    const stream = attachAftertaxPremiums(i).kernel.cash!.input.expenses[0]!;
    const generic = { ...stream, id: domainId("expense", uuid(9000)), sourceTraceRefs: [ref(source().ruleSnapshotId)] };
    const k = withExpense(i.kernel, generic);
    expect(attachAftertaxPremiums({ ...i, kernel: k }).kernel).toBe(k);
    const proof: PremiumRepresentation = { operationId: i.confirmed[0]!.proposal.operationId, quoteId: coverage().quote.quoteId,
      streamId: generic.id, relationship: "equivalent_expense", evidence: source(), streamSourceTraceId: source().ruleSnapshotId };
    const attached = attachAftertaxPremiums({ ...i, kernel: k, representations: [proof] });
    expect(attached.diagnostics).toEqual([]);
    expect(attached.kernel.cash!.input.expenses).toHaveLength(1);
    expect(run(attached.kernel).periods[0]!.cash.equals(money("700"))).toBe(true);
    const bad = withExpense(i.kernel, { ...generic, baseMonthlyAmount: money("301") });
    expect(attachAftertaxPremiums({ ...i, kernel: bad, representations: [proof] }).kernel).toBe(bad);
  });

  it("uses VS2 authored competing-expense priority and real shortfalls, with no fallback", () => {
    const i = input(request(), kernel("400"));
    const stream = attachAftertaxPremiums(i).kernel.cash!.input.expenses[0]!;
    const generic = { ...stream, id: domainId("expense", uuid(9000)), settlementPriority: 0,
      primitiveIds: { indexGrowth: domainId("primitive-instance", uuid(9001)), inflationLink: domainId("primitive-instance", uuid(9002)), recurrence: domainId("primitive-instance", uuid(9003)) },
      sourceTraceRefs: [ref("source:rent")] };
    const proof: PremiumRepresentation = { operationId: i.confirmed[0]!.proposal.operationId, quoteId: coverage().quote.quoteId,
      streamId: generic.id, relationship: "distinct_obligation", evidence: source("rent"), streamSourceTraceId: "source:rent" };
    const attached = attachAftertaxPremiums({ ...i, kernel: withExpense(i.kernel, generic), representations: [proof] });
    expect(attached.diagnostics).toEqual([]);
    const result = run(attached.kernel);
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("completed");
    expect(result.periods[0]!.cash.equals(money("100"))).toBe(true);
    expect(result.periods[0]!.cashFlow!.recurringExpenseRecognized.equals(money("600"))).toBe(true);
    expect(result.periods[0]!.cashFlow!.outstandingExpenseObligations.equals(money("300"))).toBe(true);
    expect(result.periods[0]!.liquidityShortfalls).toHaveLength(1);
    expect(result.state.identities.settlementIds).toHaveLength(1);
    expect(result.state.identities.settlementIds[0]).toContain(generic.id);
    expect(run(attached.kernel)).toEqual(result);
  });

  it("admits two separately sourced coordinated providers and preserves distinct stream identities", () => {
    const a = coverage(); const b = coverage("plan-2");
    const r = { ...request([a, b]), coordination: [{ memberId: payer, coverageIds: [a.id, b.id], admitsDistinctPremiums: true as const, evidence: source("coordination") }] };
    const i = input(r);
    const proofs: PremiumRepresentation[] = i.confirmed.flatMap(c => i.confirmed.filter(other => other !== c).map(other => ({
      operationId: c.proposal.operationId, streamId: other.expenseId, quoteId: c.proposal.quoteId,
      relationship: "distinct_obligation" as const, evidence: other.proposal.source, streamSourceTraceId: other.proposal.source.ruleSnapshotId,
    })));
    const attached = attachAftertaxPremiums({ ...i, representations: proofs });
    expect(attached.diagnostics).toEqual([]);
    expect(attached.kernel.cash!.input.expenses).toHaveLength(2);
    const result = run(attached.kernel);
    expect(result.status).toBe("completed");
    expect(result.periods[0]!.cash.equals(money("400"))).toBe(true);
    expect(result.periods[0]!.cashFlow!.recurringExpenseRecognized.equals(money("600"))).toBe(true);
    expect(result.state.identities.recognitionIds).toHaveLength(2);
    const replay = attachAftertaxPremiums({ ...i, kernel: attached.kernel, representations: proofs });
    expect(replay.diagnostics).toEqual([]);
    expect(run(replay.kernel)).toEqual(result);
  });

  it("does not permit renamed quotes or expense identities to duplicate an existing premium", () => {
    const i = input();
    const first = attachAftertaxPremiums(i);
    const c = coverage();
    const renamed = { ...c, id: "plan-2", quote: { ...c.quote, quoteId: "renamed-quote" } };
    const next = attachAftertaxPremiums(input(request([renamed]), first.kernel));
    expect(next.kernel).toBe(first.kernel);
    expect(next.diagnostics[0]!.missingFacts.join()).toContain("DUPLICATE_PREMIUM");
    expect(run(next.kernel).periods[0]!.cash.equals(money("700"))).toBe(true);
  });

  it("rejects an opening-state claim already recognized from this quote instead of recognizing it again", () => {
    const i = input();
    const executed = run(attachAftertaxPremiums(i).kernel);
    const k = applyHouseholdExecutionOverlay(i.kernel, { reconciledOpeningState: executed.state });
    const attached = attachAftertaxPremiums({ ...i, kernel: k });
    expect(attached.kernel).toBe(k);
    expect(attached.diagnostics[0]!.missingFacts.join()).toContain("ALREADY_RECOGNIZED_PREMIUM");
  });

  it("does not treat a brokerage cash balance as a sourced BANK or infer an alternative account", () => {
    const i = input();
    const k = applyHouseholdExecutionOverlay(i.kernel, { reconciledOpeningState: createAuthoritativeState({
      ...i.kernel.executable.reconciledOpeningState,
      accounts: { [bank]: { id: bank, ownerId: payer, kind: "brokerage", cash: money("1000") } },
    }) });
    const attached = attachAftertaxPremiums({ ...i, kernel: k });
    expect(attached.kernel).toBe(k);
    expect(attached.netCashCoverage).toBe("incomplete");
    expect(run(attached.kernel).periods[0]!.transactions).toEqual([]);
  });

  it("keeps missing quote and missing run asOf source-linked and incomplete", () => {
    const k = kernel();
    const withoutQuote = { ...coverage(), quote: undefined as unknown as PremiumCoverage["quote"] };
    const missing = attachAftertaxPremiums({ kernel: k, request: request([withoutQuote]), confirmed: [], representations: [], asOf });
    expect(missing.kernel).toBe(k);
    expect(missing.netCashCoverage).toBe("incomplete");
    expect(missing.diagnostics[0]!.sourceEntityPath).toBe("coverages/plan-1");
    const missingAsOf = attachAftertaxPremiums({ ...input(request(), k), asOf: undefined as unknown as typeof asOf });
    expect(missingAsOf.kernel).toBe(k);
    expect(missingAsOf.netCashCoverage).toBe("incomplete");
  });

  it.each(["missing_confirmation", "future_quote", "missing_bank_source", "wrong_payer", "missing_payable", "forged_amount", "identity_collision"])("gates %s with source-linked incomplete diagnostics", failure => {
    const i = input(); const b = i.confirmed[0]!;
    const replacements: Record<string, Partial<AftertaxPremiumInput>> = {
      missing_confirmation: { confirmed: [] },
      future_quote: { asOf: civilDate("2025-11-01") },
      missing_bank_source: { confirmed: [{ ...b, bank: { ...b.bank, evidence: { ...source(), sourcePublication: "" } } }] },
      wrong_payer: { confirmed: [{ ...b, bank: { ...b.bank, payerId: "someone-else" } }] },
      missing_payable: { confirmed: [{ ...b, payable: { ...b.payable, liabilityId: domainId("liability", uuid(9999)) } }] },
      forged_amount: { confirmed: [{ ...b, proposal: { ...b.proposal, memberAmount: money("299") } }] },
      identity_collision: { confirmed: [{ ...b, expenseId: domainId("expense", bank) }] },
    };
    const attached = attachAftertaxPremiums({ ...i, ...replacements[failure] });
    expect(attached.kernel).toBe(i.kernel);
    expect(attached.netCashCoverage).toBe("incomplete");
    expect(attached.diagnostics[0]!.traceRefs).toContain(coverage().quote.quoteId);
    expect(run(attached.kernel).periods[0]!.transactions).toEqual([]);
  });

  it.each(["annual", "partial_month", "medicare", "ssa", "mixed_route", "noncent", "mixed_currency", "unknown_currency", "bad_shares", "overlap"])("gates unsupported %s", failure => {
    const c = coverage();
    const medicare: PremiumCoverage = { ...c, planFamily: "medicare", medicare: { premiumFor: "part_b", elected: ["part_b"], enrollmentEvidence: source(), compatibilityEvidence: source() } };
    const variants: Record<string, PremiumCoverage> = {
      annual: { ...c, quote: { ...c.quote, schedule: { ...c.quote.schedule, frequency: "annual" } } },
      partial_month: { ...c, start: civilDate("2026-01-15") },
      medicare,
      ssa: { ...medicare, route: { kind: "ssa_benefit_deduction_pending", payerId: payer, benefitId: "ssa", evidence: source() } },
      mixed_route: { ...c, route: { ...c.route, employmentId: "job" } as PremiumCoverage["route"] },
      noncent: { ...c, quote: { ...c.quote, gross: money("300.001"), member: money("300.001") } },
      mixed_currency: { ...c, quote: { ...c.quote, member: Money.parse("300", Currency.of("EUR")) } },
      unknown_currency: { ...c, quote: { ...c.quote, gross: Money.parse("300", unknownCurrency), member: Money.parse("300", unknownCurrency), employer: Money.parse("0", unknownCurrency) } },
      bad_shares: { ...c, quote: { ...c.quote, employer: money("1") } },
      overlap: c,
    };
    const r = request(failure === "overlap" ? [c, coverage("plan-2")] : [variants[failure]!]);
    // Invalid quotes are intentionally sent without calling the confirmation helper.
    const i: AftertaxPremiumInput = { kernel: kernel(), request: r,
      confirmed: ["annual", "partial_month", "medicare", "ssa", "unknown_currency"].includes(failure) ? confirmations(r) : [], representations: [], asOf };
    const attached = attachAftertaxPremiums(i);
    expect(attached.kernel).toBe(i.kernel);
    expect(attached.netCashCoverage).toBe("incomplete");
    expect(run(attached.kernel).periods[0]!.transactions).toEqual([]);
  });

  it("is an identity overlay with no premiums supplied", () => {
    const i = input(request([]));
    expect(attachAftertaxPremiums(i).kernel).toBe(i.kernel);
    expect(run(attachAftertaxPremiums(i).kernel)).toEqual(run(i.kernel));
  });
});
