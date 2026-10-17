import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertBalanced } from "../../../src/accounting/index.js";
import { comparePersonalScenarios, createSyntheticPersonalDraft, runPersonalForecast, type PersonalDraft } from "../../../src/application/index.js";
import { compileLiabilities, type LiabilityExecutionProfile } from "../../../src/application/compiler/index.js";
import { mortgageFundingContext } from "../../../src/application/compiler/mortgageFundingPresentation.js";
import { authorMortgageExtra, authorMortgageRefinance } from "../../../src/application/compiler/mortgageLifecycle.js";
import { createRunContext, runId, scenarioId } from "../../../src/simulation/run.js";
import { runVerticalSlice4 } from "../../../src/simulation/verticalSlice4.js";
import { instant, utcMonthlyPeriods } from "../../../src/time/index.js";
import { USD, money, sumMoney } from "../../../src/values/index.js";
import { catalogSchema } from "../../fixtures/d2/schema.js";

const catalog = catalogSchema.parse(JSON.parse(readFileSync(new URL("../../fixtures/d2/catalog.json", import.meta.url), "utf8")));
const ids = {
  household: "90000000-0000-4000-8000-000000000002",
  person: "90000000-0000-4000-8000-000000000003",
  cash: "90000000-0000-4000-8000-000000000004",
  debt: "90000000-0000-4000-8000-000000000008",
  scenario: "90000000-0000-4000-8000-000000000011",
};
const uuid = (n: number) => `73000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
type MutableModel = { objects: Record<string, Record<string, unknown>[]> };
const edit = (model: PersonalDraft, change: (draft: MutableModel) => void): PersonalDraft => {
  const draft = structuredClone(model);
  change(draft as unknown as MutableModel);
  return draft;
};
const model = (family = "auto", principal = "1000", rate = "0", cash = "2000") => edit(createSyntheticPersonalDraft(), draft => {
  const debt = draft.objects.Liability![0]!;
  Object.assign(debt, { liability_type: family, principal, current_balance: principal, interest_rate: rate, origination_date: "2026-01-01" });
  delete debt.maturity_date;
  delete debt.collateral_id;
  draft.objects.Account![0]!.opening_balance = cash;
});
const profile = (changes: Partial<LiabilityExecutionProfile> = {}): LiabilityExecutionProfile => ({
  liabilityId: ids.debt, kind: "vs4_fixed_monthly_fully_amortizing", paymentAnchor: "2026-01-15",
  totalPayments: 2, fundingAccountId: ids.cash, settlementPriority: 1, openingContractStatus: "current", ...changes,
});
const request = (profiles = [profile()], months = 1) => ({
  baseCurrency: "USD", asOf: "2026-01-01", simulationStart: "2026-01-01",
  simulationEnd: utcMonthlyPeriods(instant("2026-01-01T00:00:00.000Z"), months).at(-1)!.end.slice(0, 10),
  executionOwnerId: ids.person, executionProfiles: profiles,
});
const forecastRequest = (profiles = [profile()], months = 1) => ({
  ...request(profiles, months), scope: "liabilities" as const, dataCutoff: "2026-01-01",
  sameInstantCashFlowOrder: "income_before_expense" as const, liabilityExecutionProfiles: profiles,
});
const compile = (draft = model(), profiles = [profile()], months = 1) => {
  const result = compileLiabilities(draft, request(profiles, months));
  if (result.status !== "compiled") throw new Error(JSON.stringify(result));
  return result.value;
};
const context = (months = 1) => createRunContext({
  runId: runId(uuid(90)), scenarioId: scenarioId(ids.scenario), baseCurrency: USD,
  asOf: instant("2026-01-01T00:00:00.000Z"), dataCutoff: instant("2026-01-01T00:00:00.000Z"),
  simulationStart: instant("2026-01-01T00:00:00.000Z"),
  simulationEnd: utcMonthlyPeriods(instant("2026-01-01T00:00:00.000Z"), months).at(-1)!.end,
});
const run = (compiled: ReturnType<typeof compile>, months = 1) => runVerticalSlice4({
  runContext: context(months), input: compiled.input, openingState: compiled.openingState, primitiveState: compiled.primitiveState,
});
const extra = (amount = "500", fundingAccountId = ids.cash) => ({ id: uuid(80), scheduledAt: "2026-01-15", amount, fundingAccountId });
const fromCents = (cents: string) => {
  const negative = cents.startsWith("-");
  const digits = (negative ? cents.slice(1) : cents).padStart(3, "0");
  return money(`${negative ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`);
};
const expectGate = (draft: PersonalDraft, code: string, profiles = [profile()]) => {
  const result = compileLiabilities(draft, request(profiles));
  expect(result.status).toBe("unsupported");
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code, entityId: ids.debt }));
};

describe("D2-B phase 1 canonical fixed consumer-loan admission", () => {
  it.each(["auto_zero_rate", "student_standard", "auto_final_interest", "consumer_extra_payoff"])("matches independent %s accounting for identical terms", id => {
    const fixture = catalog.cases.find(item => item.id === id)!;
    const { amounts, terms } = fixture.input;
    const effects = fixture.expected.effects!;
    const family = fixture.family === "student_loan" ? "student" : "auto";
    const draft = model(family, fromCents(amounts.principalCents!).amount.toString(), terms.annualRate!, fromCents(amounts.cashCents!).amount.toString());
    const p = profile({ totalPayments: Number(terms.remainingPayments), ...(amounts.extraCents === undefined ? {} : { extraPrincipalPayments: [extra(fromCents(amounts.extraCents).amount.toString())] }) });
    const compiled = compile(draft, [p]);
    const before = JSON.stringify({ draft, compiled });
    const result = run(compiled);
    const loan = compiled.input.loans[0]!;
    expect(loan.debtFamily).toBe(family);
    expect(result.status).toBe("completed");
    const period = result.periods[0]!;
    expect(period.principalReduction.equals(fromCents(effects.facts.principalPaidCents!))).toBe(true);
    expect(period.interestExpense.equals(fromCents(effects.recognition.expenseCents))).toBe(true);
    expect(result.state.accounts[ids.cash]!.cash.equals(fromCents(effects.closingCents.cash!))).toBe(true);
    expect(result.state.liabilities[ids.debt]!.balance.equals(fromCents(effects.closingCents.principal!))).toBe(true);
    expect(result.state.liabilities[loan.interestPayableLiabilityId]!.balance.isZero()).toBe(true);
    expect(period.statements.netWorth.minus(money("1000")).equals(fromCents(effects.netWorthDeltaCents))).toBe(true);
    expect(period.recognitions.every(fact => fact.category === `${family}_loan_interest_expense`)).toBe(true);
    for (const tx of period.transactions) assertBalanced(tx);
    expect(run(compiled)).toEqual(result);
    expect(compile(draft, [p])).toEqual(compiled);
    expect(JSON.stringify({ draft, compiled })).toBe(before);
    // These remain conditional preparation fixtures; this proves only the
    // canonical standalone path, not combined household or editor support.
    expect(fixture.expected.integratedRuntimeEvidence).toBe(false);
  });

  it.each(["auto", "student"])("settles %s final cents and replays an early payoff without new postings", family => {
    const cents = compile(model(family, "1.01", "0.12", "2"), [profile()], 2);
    const result = run(cents, 2);
    expect(result.status).toBe("completed");
    expect(result.periods.map(p => p.liabilities[0]!.scheduledPrincipalPaid.amount.toString())).toEqual(["0.5", "0.51"]);
    expect(sumMoney(result.periods.map(p => p.interestExpense)).equals(money("0.02"))).toBe(true);
    expect(result.state.accounts[ids.cash]!.cash.equals(money("0.97"))).toBe(true);
    const compiled = compile(model(family), [profile({ extraPrincipalPayments: [extra()] })]);
    const paid = run(compiled);
    const replay = runVerticalSlice4({ runContext: context(), input: compiled.input, openingState: paid.state, primitiveState: paid.primitiveState });
    expect(replay.state).toEqual(paid.state);
    expect(replay.primitiveState).toEqual(paid.primitiveState);
    expect(replay.periods.flatMap(p => p.transactions)).toHaveLength(0);
    expect(paid.state.liabilities[ids.debt]!.balance.isZero()).toBe(true);
  });

  it("uses original terms and elapsed progress for a compatible historical opening", () => {
    const draft = edit(model("student"), d => {
      Object.assign(d.objects.Liability![0]!, { origination_date: "2025-11-01", current_balance: "500" });
    });
    const historical = compile(draft, [profile({ paymentAnchor: "2025-12-15" })]);
    const result = run(historical);
    expect(result.status).toBe("completed");
    expect(result.periods[0]!.liabilities[0]!.contractualPayment.equals(money("500"))).toBe(true);
    expect(result.state.liabilities[ids.debt]!.balance.isZero()).toBe(true);
    expectGate(edit(draft, d => { d.objects.Liability![0]!.current_balance = "500.01"; }), "LIABILITY_OPENING_HISTORY_UNSUPPORTED", [profile({ paymentAnchor: "2025-12-15" })]);
    const misdated = compileLiabilities(draft, { ...request([profile({ paymentAnchor: "2025-12-15" })]), asOf: "2025-12-01" });
    expect(misdated.diagnostics).toContainEqual(expect.objectContaining({ code: "LIABILITY_OPENING_BOUNDARY_UNSUPPORTED", entityId: ids.debt }));
  });

  it("distinguishes missing, incorrect, inconsistent and unpaid execution profiles", () => {
    expectGate(model(), "LIABILITY_EXECUTION_PROFILE_REQUIRED", []);
    expectGate(model(), "LIABILITY_RATE_CONVENTION_UNSUPPORTED", [profile({ kind: "income_driven" as LiabilityExecutionProfile["kind"] })]);
    for (const field of ["scheduled_payment", "minimum_payment"])
      expectGate(edit(model(), d => { d.objects.Liability![0]![field] = "501"; }), "LIABILITY_PAYMENT_PROFILE_MISMATCH");
    expect(compile(edit(model(), d => { Object.assign(d.objects.Liability![0]!, { scheduled_payment: "500", minimum_payment: "0" }); })).input.loans).toHaveLength(1);
    const invalid = compileLiabilities(model(), request([profile({ openingContractStatus: "delinquent" as "current" })]));
    expect(invalid).toMatchObject({ status: "invalid_model", diagnostics: [expect.objectContaining({ code: "LIABILITY_PROFILE_STATUS_INVALID", entityId: ids.debt })] });
    expectGate(edit(model(), d => { d.objects.Liability![0]!.origination_date = "2026-02-01"; }), "LIABILITY_FUTURE_ORIGINATION_UNSUPPORTED");
    expectGate(edit(model(), d => { d.objects.Liability![0]!.maturity_date = "2026-03-15"; }), "LIABILITY_MATURITY_SCHEDULE_MISMATCH");
    expectGate(edit(model(), d => { d.objects.Liability![0]!.current_balance = "999"; }), "LIABILITY_UNEXPLAINED_HISTORY_UNSUPPORTED");
  });

  it("gates variable, revolving and authored special-program/capitalization rules", () => {
    for (const family of ["credit_card", "heloc", "personal"]) expectGate(model(family), "LIABILITY_TYPE_UNSUPPORTED");
    expectGate(edit(model(), d => { d.objects.Liability![0]!.rate_type = "variable"; }), "LIABILITY_RATE_STRUCTURE_UNSUPPORTED");
    expectGate(edit(model(), d => { d.objects.Liability![0]!.extra_payment = "1"; }), "LIABILITY_CONDITIONAL_EXTRA_PAYMENT_UNSUPPORTED");
    for (const parameters of [{ program: "IDR" }, { forgiveness: true }, { interestCapitalization: "monthly" }]) {
      const draft = edit(model("student"), d => {
        d.objects.PrimitiveInstance!.push({ primitive_instance_id: uuid(10), primitive_id: "P22", scenario_id: ids.scenario, enabled: true, input_bindings: {}, parameters });
        d.objects.Liability![0]!.amortization_model_id = uuid(10);
      });
      expectGate(draft, "LIABILITY_AMORTIZATION_CONFIGURATION_UNSUPPORTED");
    }
    const unknown = { ...profile(), interestCapitalization: "monthly" };
    expectGate(model(), "LIABILITY_PROFILE_CONFIGURATION_UNSUPPORTED", [unknown]);
    expectGate(model(), "LIABILITY_PROFILE_CONFIGURATION_UNSUPPORTED", [profile({ extraPrincipalPayments: [{ ...extra(), fee: "1" } as ReturnType<typeof extra>] })]);
    for (const field of ["fee_rule_id", "prepayment_rule_id"]) {
      const draft = edit(model(), d => {
        d.objects.TaxRule!.push({ tax_rule_id: uuid(11) });
        d.objects.Liability![0]![field] = uuid(11);
      });
      expectGate(draft, field === "fee_rule_id" ? "LIABILITY_FEE_RULE_UNSUPPORTED" : "LIABILITY_PREPAYMENT_RULE_UNSUPPORTED");
    }
  });

  it.each(["auto", "student"])("rejects mortgage lifecycle extras/refinance on %s and retains source IDs", family => {
    const plan = { eventId: uuid(20), effectId: uuid(21), primitiveId: uuid(22), liabilityId: ids.debt, date: "2026-01-15", amount: "100", fundingAccountId: ids.cash, annualRate: "0.03", totalPayments: 12 };
    for (const authored of [authorMortgageExtra(model(family), plan), authorMortgageRefinance(model(family), plan)]) {
      const result = compileLiabilities(authored, request());
      expect(result.status).toBe("unsupported");
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "LIABILITY_AUTHORED_OPERATION_UNSUPPORTED", entityId: ids.debt, relatedIds: [plan.eventId, plan.effectId] }));
    }
    const unknown = edit(authorMortgageRefinance(model(family), plan), d => { d.objects.EventEffect!.find(effect => effect.event_effect_id === plan.effectId)!.operation = "forgive_student_debt"; });
    expectGate(unknown, "LIABILITY_AUTHORED_OPERATION_UNSUPPORTED");
    const incomplete = edit(authorMortgageExtra(model(family), plan), d => { d.objects.PrimitiveInstance!.find(primitive => primitive.primitive_instance_id === plan.primitiveId)!.enabled = false; });
    expectGate(incomplete, "LIABILITY_AUTHORED_OPERATION_UNSUPPORTED");
    expectGate(model(family), "EXTRA_PRINCIPAL_OCCURRENCE_UNSUPPORTED", [profile({ extraPrincipalPayments: [{ ...extra(), scheduledAt: "2026-01-16" }] })]);
  });

  it("validates authenticated owners and funding sources without inferring household cash", () => {
    const unowned = edit(model(), d => { d.objects.Liability![0]!.owner_id = uuid(30); });
    expect(compileLiabilities(unowned, request()).status).toBe("invalid_model");
    const anotherMember = edit(model(), d => {
      d.objects.Person!.push({ ...d.objects.Person![0]!, person_id: uuid(30) });
      d.objects.Household![0]!.members = [ids.person, uuid(30)];
      d.objects.Liability![0]!.owner_id = uuid(30);
    });
    expectGate(anotherMember, "LIABILITY_OWNER_UNSUPPORTED");
    const missingSource = compileLiabilities(model(), request([profile({ fundingAccountId: uuid(31) })]));
    expect(missingSource).toMatchObject({ status: "invalid_model", diagnostics: [expect.objectContaining({ code: "LIABILITY_FUNDING_ACCOUNT_NOT_FOUND" })] });
    const missingExtraSource = compileLiabilities(model(), request([profile({ extraPrincipalPayments: [extra("1", uuid(31))] })]));
    expect(missingExtraSource).toMatchObject({ status: "invalid_model", diagnostics: [expect.objectContaining({ code: "LIABILITY_FUNDING_ACCOUNT_INVALID" })] });
    const ineligible = compileLiabilities(edit(model(), d => { d.objects.Account![0]!.account_type = "traditional_ira"; }), request());
    expect(ineligible.diagnostics).toContainEqual(expect.objectContaining({ code: "LIABILITY_FUNDING_ACCOUNT_TYPE_UNSUPPORTED", relatedIds: [ids.debt] }));
    const extraIneligible = edit(model(), d => { d.objects.Account!.push({ ...d.objects.Account![0]!, account_id: uuid(31), currency: "EUR" }); });
    const extraRejected = compileLiabilities(extraIneligible, request([profile({ extraPrincipalPayments: [extra("1", uuid(31))] })]));
    expect(extraRejected).toMatchObject({ status: "unsupported" });
    expect(extraRejected.diagnostics).toContainEqual(expect.objectContaining({ code: "LIABILITY_EXTRA_FUNDING_ACCOUNT_UNSUPPORTED", entityId: uuid(31), relatedIds: [uuid(80)] }));
    const noCash = run(compile(model("student", "1000", "0", "0")));
    expect(noCash.periods[0]!.liabilities[0]!.scheduledFundingStatus).toBe("unfunded");
    expect(noCash.state.accounts[ids.cash]!.cash.isZero()).toBe(true);
    expect(noCash.state.liabilities[ids.debt]!.balance.equals(money("1000"))).toBe(true);
  });

  it("keeps mandatory shortfalls exact and optional extra failure distinct in the real read model", () => {
    for (const [cash, amount, origin, missing] of [["100", "10", "required_debt_service", "400"], ["600", "500", "extra_principal", "500"]] as const) {
      const draft = model("auto", "1000", "0", cash);
      const before = JSON.stringify(draft);
      const result = runPersonalForecast(draft, forecastRequest([profile({ extraPrincipalPayments: [extra(amount)] })]));
      expect(result.status).toBe("completed");
      if (result.scope !== "liabilities" || result.status === "unavailable") throw new Error("expected standalone liabilities");
      expect(result.shortfalls).toContainEqual(expect.objectContaining({ origin, unfunded: expect.objectContaining({ exact: missing }) }));
      expect(result.shortfalls.every(shortfall => shortfall.mortgageFunding === undefined)).toBe(true);
      expect(result.liabilityOccurrences[0]!.scheduledPrincipalPaid.exact).toBe(cash === "100" ? "0" : "500");
      expect(result.liabilityOccurrences[0]!.extraPrincipalPaid.exact).toBe("0");
      expect(JSON.stringify(draft)).toBe(before);
    }
    for (const family of ["mortgage", "auto", "student"]) {
      const compiled = compile(model(family), [profile({ extraPrincipalPayments: [extra()] })]);
      const loan = compiled.input.loans[0]!;
      for (const policy of [loan.fundingPolicy, loan.extraPrincipalPayments![0]!.fundingPolicy])
        expect(mortgageFundingContext(compiled.input, String(policy.id))?.liabilityId).toBe(family === "mortgage" ? ids.debt : undefined);
    }
  });

  it("uses explicit mixed-family settlement priorities independently of collection order", () => {
    const draft = edit(model("mortgage", "1000", "0", "1000"), d => {
      d.objects.Liability!.push(...["auto", "student"].map((family, i) => ({ ...d.objects.Liability![0]!, liability_id: uuid(i + 1), liability_type: family })));
    });
    const profiles = [profile(), profile({ liabilityId: uuid(1), settlementPriority: 2 }), profile({ liabilityId: uuid(2), settlementPriority: 3 })];
    const compiled = compile(draft, profiles);
    const result = run(compiled);
    expect(result.status).toBe("completed");
    expect(result.state.accounts[ids.cash]!.cash.isZero()).toBe(true);
    expect(result.state.liabilities[ids.debt]!.balance.equals(money("1000"))).toBe(true);
    for (const id of [uuid(1), uuid(2)]) expect(result.state.liabilities[id]!.balance.equals(money("500"))).toBe(true);
    const reversed = compile(edit(draft, d => { d.objects.Liability!.reverse(); }), [...profiles].reverse());
    expect(reversed).toEqual(compiled);
    expect(run(reversed)).toEqual(result);
    const conflicts = compileLiabilities(draft, request(profiles.map(p => ({ ...p, settlementPriority: 1 }))));
    expect(conflicts.status).toBe("unsupported");
    expect(conflicts.diagnostics).toContainEqual(expect.objectContaining({ code: "LIABILITY_SETTLEMENT_PRIORITY_CONFLICT" }));
  });

  it("resolves required service before extra and honors an independent household-owned source", () => {
    const draft = edit(model("auto", "1000", "0", "500"), d => {
      d.objects.Account!.push({ ...d.objects.Account![0]!, account_id: uuid(40), owner_id: ids.household, opening_balance: "500" });
      d.objects.Liability!.push({ ...d.objects.Liability![0]!, liability_id: uuid(1), liability_type: "student" });
    });
    const compiled = compile(draft, [profile({ settlementPriority: 3, extraPrincipalPayments: [extra("500", uuid(40))] }), profile({ liabilityId: uuid(1), fundingAccountId: uuid(40), settlementPriority: 2 })]);
    const result = run(compiled);
    expect(result.status).toBe("completed");
    expect(result.state.accounts[uuid(40)]!.cash.isZero()).toBe(true);
    expect(result.state.liabilities[ids.debt]!.balance.equals(money("500"))).toBe(true);
    expect(result.state.liabilities[uuid(1)]!.balance.equals(money("500"))).toBe(true);
    expect(result.periods[0]!.liquidityShortfalls[0]!.origin).toBe("extra_principal");
    const independent = edit(draft, d => { d.objects.Liability = [d.objects.Liability![0]!]; });
    const payoff = run(compile(independent, [profile({ extraPrincipalPayments: [extra("500", uuid(40))] })]));
    expect(payoff.state.accounts[ids.cash]!.cash.isZero()).toBe(true);
    expect(payoff.state.accounts[uuid(40)]!.cash.isZero()).toBe(true);
    expect(payoff.state.liabilities[ids.debt]!.balance.isZero()).toBe(true);
  });

  it("keeps paid-off loans dormant and partial capability omissions visible", () => {
    const paid = edit(model("student"), d => { d.objects.Liability![0]!.current_balance = "0"; });
    expect(compile(paid, []).inactiveLiabilityIds).toEqual([ids.debt]);
    const result = runPersonalForecast(paid, forecastRequest([]));
    expect(result).toMatchObject({ status: "completed", scope: "liabilities", liabilityOccurrences: [], inactiveLiabilityIds: [ids.debt] });
    const partial = edit(model(), d => { d.objects.Liability!.push({ ...d.objects.Liability![0]!, liability_id: uuid(1), liability_type: "heloc" }); });
    const compiled = compile(partial);
    expect(compiled.input.loans.map(loan => String(loan.principalLiabilityId))).toEqual([ids.debt]);
    expect(compiled.capabilityDiagnostics).toContainEqual(expect.objectContaining({ code: "LIABILITY_TYPE_UNSUPPORTED", entityId: uuid(1) }));
    const forecast = runPersonalForecast(partial, forecastRequest());
    // Preserve the application's existing return contract: execution status
    // describes the admitted slice; capability diagnostics disclose omissions.
    expect(forecast.scope).toBe("liabilities");
    expect(forecast.diagnostics).toContainEqual(expect.objectContaining({ code: "LIABILITY_TYPE_UNSUPPORTED", entityId: uuid(1) }));
  });

  it.each(["auto", "student"])("compares %s standalone funding scenarios deterministically", family => {
    const draft = model(family);
    const comparison = { scope: "liabilities" as const, alternatives: [{ scenarioId: uuid(60), name: "Explicit same source", changes: [{ kind: "loan_funding_policy" as const, liabilityId: ids.debt, policy: { id: "explicit", orderedAccountIds: [ids.cash], allowPartial: false, insufficientFundsBehavior: "unfunded" as const } }] }] };
    const first = comparePersonalScenarios(draft, forecastRequest(), comparison);
    expect(first.status).toBe("completed");
    expect(first.points.length).toBeGreaterThan(0);
    expect(comparePersonalScenarios(draft, forecastRequest(), comparison)).toEqual(first);
  });
});
