import { describe, expect, it } from "vitest";
import { domainId } from "../src/identity/index.js";
import { recognitionId } from "../src/semantics/identity.js";
import { instant } from "../src/time/index.js";
import { createAuthoritativeState } from "../src/state/index.js";
import { createPrimitiveRuntimeStateStore } from "../src/simulation/period.js";
import { buildHouseholdScheduledPlan, canonicalHouseholdWorkPlan, type HouseholdWorkDescriptor } from "../src/simulation/intraperiodScheduler.js";
import { createHouseholdProjectionFingerprint, deriveHouseholdClosingMetrics, reconcileHouseholdOpeningState, reconcileHouseholdPrimitiveState } from "../src/simulation/householdProjection.js";
import { ValidationError } from "../src/diagnostics/index.js";
import { createRunContext, runId, scenarioId } from "../src/simulation/run.js";
import { runHouseholdProjection } from "../src/simulation/householdRunner.js";
import { money, quantity, SHARE, USD } from "../src/values/index.js";
import { compileHouseholdProjection } from "../src/application/compiler/householdProjection.js";
import type { PortableModelEnvelope } from "../src/model/modelVersion.js";

const account = domainId("account", "91000000-0000-4000-8000-000000000001");
const owner = domainId("person", "91000000-0000-4000-8000-000000000002");
const at = instant("2026-01-15T00:00:00.000Z");
const state = (cash = "10") => createAuthoritativeState({ accounts: { [account]: { id: account, kind: "checking", ownerId: owner, cash: money(cash) } } });
const descriptor = (id: string, domain: HouseholdWorkDescriptor["domain"], operationClass: NonNullable<HouseholdWorkDescriptor["operationClass"]>, mode: "produce" | "consume"): HouseholdWorkDescriptor => ({ id, domain, operationClass, sequencingInstant: at, dependsOn: [], resourceAccesses: [{ kind: "account_cash", accountId: account, mode }], traceRefs: [] });

describe("PR20 household boundaries", () => {
  it("retains identical shared state once and rejects a conflicting economic representation", () => {
    expect(reconcileHouseholdOpeningState([state(), state()])).toMatchObject({ status: "compiled", value: { accounts: { [account]: { cash: money("10") } } } });
    expect(reconcileHouseholdOpeningState([state(), state("11")])).toMatchObject({ status: "invalid_model", diagnostics: [{ code: "HOUSEHOLD_OPENING_STATE_CONFLICT" }] });
  });

  it("unions identity registries and rejects duplicate positions, liabilities, and obligations only when their exact values conflict", () => {
    const first = createAuthoritativeState({ accounts: state().accounts, liabilities: { [domainId("liability", "91000000-0000-4000-8000-000000000006")]: { id: domainId("liability", "91000000-0000-4000-8000-000000000006"), balance: money("1") } }, identities: { recognitionIds: [recognitionId("recognition:one")] } });
    const equalSecond = createAuthoritativeState({ accounts: state().accounts, liabilities: { [domainId("liability", "91000000-0000-4000-8000-000000000006")]: { id: domainId("liability", "91000000-0000-4000-8000-000000000006"), balance: money("1") } }, identities: { recognitionIds: [recognitionId("recognition:two"), recognitionId("recognition:one")] } });
    const conflictingSecond = createAuthoritativeState({ accounts: state().accounts, liabilities: { [domainId("liability", "91000000-0000-4000-8000-000000000006")]: { id: domainId("liability", "91000000-0000-4000-8000-000000000006"), balance: money("2") } } });
    expect(reconcileHouseholdOpeningState([first, equalSecond])).toMatchObject({ status: "compiled", value: { identities: { recognitionIds: [recognitionId("recognition:one"), recognitionId("recognition:two")] } } });
    expect(reconcileHouseholdOpeningState([first, conflictingSecond])).toMatchObject({ status: "invalid_model", diagnostics: [{ code: "HOUSEHOLD_OPENING_STATE_CONFLICT" }] });
  });

  it("merges primitive state exactly", () => {
    const same = createPrimitiveRuntimeStateStore({ p: { primitiveId: "P23", state: { evaluations: 0 } } });
    const different = createPrimitiveRuntimeStateStore({ p: { primitiveId: "P23", state: { evaluations: 1, lastClosingValue: money("1") } } });
    expect(reconcileHouseholdPrimitiveState([same, same]).status).toBe("compiled");
    expect(reconcileHouseholdPrimitiveState([same, different])).toMatchObject({ status: "invalid_model", diagnostics: [{ code: "HOUSEHOLD_PRIMITIVE_STATE_CONFLICT" }] });
  });

  it("requires policy precedence for cross-domain consumer contention and canonicalizes rule order", () => {
    const expense = descriptor("expense", "cash_flow", "cash_expense_settlement", "consume");
    const debt = descriptor("debt", "liabilities", "liability_required_service", "consume");
    const missing = buildHouseholdScheduledPlan([expense, debt], { id: "household-v1", version: "1", rules: [] });
    expect(missing).toMatchObject({ status: "invalid_model", diagnostics: [{ code: "HOUSEHOLD_CONTENTION_UNRESOLVED" }] });
    const policy = { id: "household-v1", version: "1" as const, rules: [{ before: "cash_expense_settlement" as const, after: "liability_required_service" as const }] };
    expect(buildHouseholdScheduledPlan([debt, expense], policy)).toMatchObject({ status: "compiled", value: { dependencies: [{ before: "expense", after: "debt", source: "policy" }] } });
    expect(canonicalHouseholdWorkPlan([expense, debt], policy)).toEqual(canonicalHouseholdWorkPlan([debt, expense], { ...policy, rules: [...policy.rules].reverse() }));
  });

  it("does not treat two cash producers as contention", () => {
    expect(buildHouseholdScheduledPlan([
      descriptor("income", "cash_flow", "cash_income_settlement", "produce"),
      descriptor("transfer", "investments", "investment_transfer", "produce"),
    ], { id: "household-v1", version: "1", rules: [] }).status).toBe("compiled");
  });

  it("accepts transitive policy precedence, records its identity, and rejects cycles or conflicts", () => {
    const expense = descriptor("expense", "cash_flow", "cash_expense_settlement", "consume");
    const debt = descriptor("debt", "liabilities", "liability_required_service", "consume");
    const transitive = { id: "policy-transitive", version: "1" as const, rules: [
      { before: "cash_expense_settlement" as const, after: "investment_purchase" as const },
      { before: "investment_purchase" as const, after: "liability_required_service" as const },
    ] };
    expect(buildHouseholdScheduledPlan([expense, debt], transitive)).toMatchObject({ status: "compiled", value: { dependencies: [{ before: "expense", after: "debt", source: "policy", policyId: "policy-transitive", policyVersion: "1" }] } });
    expect(buildHouseholdScheduledPlan([expense, debt], { ...transitive, rules: [...transitive.rules, { before: "liability_required_service", after: "cash_expense_settlement" }] })).toMatchObject({ status: "invalid_model", diagnostics: [{ code: "HOUSEHOLD_CONTENTION_POLICY_CYCLE" }] });
    expect(buildHouseholdScheduledPlan([{ ...expense, dependsOn: ["debt"] }, debt], { id: "reverse", version: "1", rules: [{ before: "cash_expense_settlement", after: "liability_required_service" }] })).toMatchObject({ status: "invalid_model", diagnostics: [{ code: "HOUSEHOLD_POLICY_DEPENDENCY_CONTRADICTION" }] });
  });

  it("preflights malformed household contention policy before domain compilation", () => {
    const compiled = compileHouseholdProjection({} as PortableModelEnvelope, {
      contentionPolicy: { id: "bad", version: "1", rules: [{ before: "cash_expense_settlement", after: "cash_expense_settlement" }] },
    });
    expect(compiled).toMatchObject({ status: "invalid_model", diagnostics: [{ code: "HOUSEHOLD_CONTENTION_POLICY_INVALID" }] });
  });

  it("makes policy identity and semantics, but not run identity or request order, material to fingerprints", () => {
    const context = (id: string) => createRunContext({ runId: runId(id), scenarioId: scenarioId("91000000-0000-4000-8000-000000000003"), asOf: instant("2026-01-01T00:00:00.000Z"), dataCutoff: instant("2026-01-01T00:00:00.000Z"), simulationStart: instant("2026-01-01T00:00:00.000Z"), simulationEnd: instant("2026-02-01T00:00:00.000Z"), baseCurrency: USD });
    const expense = descriptor("expense", "cash_flow", "cash_expense_settlement", "consume");
    const debt = descriptor("debt", "liabilities", "liability_required_service", "consume");
    const policy = { id: "first", version: "1" as const, rules: [{ before: "cash_expense_settlement" as const, after: "liability_required_service" as const }] };
    const fingerprint = (run: ReturnType<typeof context>, selected = policy) => createHouseholdProjectionFingerprint({ runContext: run, openingState: state(), primitiveState: createPrimitiveRuntimeStateStore(), descriptors: [debt, expense], contentionPolicy: selected });
    expect(fingerprint(context("91000000-0000-4000-8000-000000000004"))).toBe(fingerprint(context("91000000-0000-4000-8000-000000000005")));
    expect(fingerprint(context("91000000-0000-4000-8000-000000000004"))).not.toBe(fingerprint(context("91000000-0000-4000-8000-000000000004"), { ...policy, id: "second" }));
  });

  it("executes one chronological candidate stream and rolls back the whole failed period", () => {
    const context = createRunContext({ runId: runId("91000000-0000-4000-8000-000000000006"), scenarioId: scenarioId("91000000-0000-4000-8000-000000000007"), asOf: instant("2026-01-01T00:00:00.000Z"), dataCutoff: instant("2026-01-01T00:00:00.000Z"), simulationStart: instant("2026-01-01T00:00:00.000Z"), simulationEnd: instant("2026-02-01T00:00:00.000Z"), baseCurrency: USD });
    const income = { ...descriptor("income", "cash_flow", "cash_income_settlement", "produce"), sequencingInstant: instant("2026-01-05T00:00:00.000Z") };
    const expense = { ...descriptor("expense", "cash_flow", "cash_expense_settlement", "consume"), sequencingInstant: instant("2026-01-15T00:00:00.000Z") };
    const run = (fail: boolean) => runHouseholdProjection({ runContext: context, openingState: state(), contentionPolicy: { id: "empty", version: "1", rules: [] }, periodPlans: [{ period: { start: context.simulationStart, end: context.simulationEnd }, descriptors: [income, expense], executors: {
      income: ({ state: candidate }) => { candidate.accounts[account]!.cash = candidate.accounts[account]!.cash.plus(money("10")); },
      expense: ({ state: candidate }) => { if (fail) throw new ValidationError([{ severity: "error", code: "EXPECTED_FINANCIAL_FAILURE", message: "late failure", entityType: "household_projection" }]); candidate.accounts[account]!.cash = candidate.accounts[account]!.cash.minus(money("5")); },
    } }] });
    expect(run(false)).toMatchObject({ status: "completed", state: { accounts: { [account]: { cash: money("15") } } }, periods: [{ executedWorkIds: ["income", "expense"] }] });
    expect(run(true)).toMatchObject({ status: "incomplete", stoppedAt: context.simulationStart, state: { accounts: { [account]: { cash: money("10") } } }, periods: [] });
  });

  it("executes policy-derived dependencies, not only descriptor dependencies", () => {
    const context = createRunContext({ runId: runId("91000000-0000-4000-8000-000000000016"), scenarioId: scenarioId("91000000-0000-4000-8000-000000000017"), asOf: instant("2026-01-01T00:00:00.000Z"), dataCutoff: instant("2026-01-01T00:00:00.000Z"), simulationStart: instant("2026-01-01T00:00:00.000Z"), simulationEnd: instant("2026-02-01T00:00:00.000Z"), baseCurrency: USD });
    const expense = descriptor("expense", "cash_flow", "cash_expense_settlement", "consume");
    const debt = descriptor("debt", "liabilities", "liability_required_service", "consume");
    const run = (rules: readonly { readonly before: "cash_expense_settlement" | "liability_required_service"; readonly after: "cash_expense_settlement" | "liability_required_service" }[]) => runHouseholdProjection({ runContext: context, openingState: state(), contentionPolicy: { id: "ordering", version: "1", rules }, periodPlans: [{ period: { start: context.simulationStart, end: context.simulationEnd }, descriptors: [expense, debt], executors: {
      expense: ({ state: candidate }) => { if (!candidate.accounts[account]!.cash.isZero()) candidate.accounts[account]!.cash = candidate.accounts[account]!.cash.minus(money("10")); },
      debt: ({ state: candidate }) => { if (!candidate.accounts[account]!.cash.isZero()) candidate.accounts[account]!.cash = candidate.accounts[account]!.cash.minus(money("10")); },
    } }] });
    expect(run([{ before: "cash_expense_settlement", after: "liability_required_service" }])).toMatchObject({ status: "completed", periods: [{ executedWorkIds: ["expense", "debt"], orderingLineage: [{ before: "expense", after: "debt", source: "policy", policyId: "ordering", policyVersion: "1" }] }] });
    expect(run([{ before: "liability_required_service", after: "cash_expense_settlement" }])).toMatchObject({ status: "completed", periods: [{ executedWorkIds: ["debt", "expense"] }] });
  });

  it("uses position market value, not carrying value, in household metrics", () => {
    const position = domainId("position", "91000000-0000-4000-8000-000000000019");
    const closing = createAuthoritativeState({ accounts: state().accounts, positions: { [position]: { id: position, accountId: account, quantity: quantity("2", SHARE), price: money("10"), carryingValue: money("3") } } });
    expect(deriveHouseholdClosingMetrics(closing, USD)).toMatchObject({ investmentValue: money("20"), totalAssets: money("30"), netWorth: money("30") });
  });

  it("propagates unexpected executor bugs", () => {
    const context = createRunContext({ runId: runId("91000000-0000-4000-8000-000000000020"), scenarioId: scenarioId("91000000-0000-4000-8000-000000000021"), asOf: instant("2026-01-01T00:00:00.000Z"), dataCutoff: instant("2026-01-01T00:00:00.000Z"), simulationStart: instant("2026-01-01T00:00:00.000Z"), simulationEnd: instant("2026-02-01T00:00:00.000Z"), baseCurrency: USD });
    const income = descriptor("income", "cash_flow", "cash_income_settlement", "produce");
    expect(() => runHouseholdProjection({ runContext: context, openingState: state(), contentionPolicy: { id: "empty", version: "1", rules: [] }, periodPlans: [{ period: { start: context.simulationStart, end: context.simulationEnd }, descriptors: [income], executors: { income: () => { throw new Error("programming bug"); } } }] })).toThrow("programming bug");
  });
});
