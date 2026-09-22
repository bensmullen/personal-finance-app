import { describe, expect, it } from "vitest";
import { domainId } from "../src/identity/index.js";
import { recognitionId } from "../src/semantics/identity.js";
import { instant } from "../src/time/index.js";
import { createAuthoritativeState } from "../src/state/index.js";
import { createPrimitiveRuntimeStateStore } from "../src/simulation/period.js";
import { buildHouseholdScheduledPlan, canonicalHouseholdWorkPlan, type HouseholdWorkDescriptor } from "../src/simulation/intraperiodScheduler.js";
import { createHouseholdProjectionFingerprint, deriveHouseholdClosingMetrics, reconcileHouseholdOpeningState, reconcileHouseholdPrimitiveState } from "../src/simulation/householdProjection.js";
import { createRunContext, runId, scenarioId } from "../src/simulation/run.js";
import { money, quantity, SHARE, USD } from "../src/values/index.js";
import { compileHouseholdProjection } from "../src/application/compiler/householdProjection.js";
import type { PortableModelEnvelope } from "../src/model/modelVersion.js";

const account = domainId("account", "91000000-0000-4000-8000-000000000001");
const owner = domainId("person", "91000000-0000-4000-8000-000000000002");
const at = instant("2026-01-15T00:00:00.000Z");
const state = (cash = "10") => createAuthoritativeState({ accounts: { [account]: { id: account, kind: "checking", ownerId: owner, cash: money(cash) } } });
const descriptor = (id: string, domain: HouseholdWorkDescriptor["domain"], operationClass: NonNullable<HouseholdWorkDescriptor["operationClass"]>, mode: "produce" | "consume"): HouseholdWorkDescriptor => ({ id, domain, operationClass, sequencingInstant: at, dependsOn: [], resourceAccesses: [{ kind: "account_cash", accountId: account, mode }], traceRefs: [] });

describe("PR20 household boundaries", () => {
  it("retains identical shared state once and rejects conflicts", () => {
    expect(reconcileHouseholdOpeningState([state(), state()])).toMatchObject({ status: "compiled", value: { accounts: { [account]: { cash: money("10") } } } });
    expect(reconcileHouseholdOpeningState([state(), state("11")])).toMatchObject({ status: "invalid_model", diagnostics: [{ code: "HOUSEHOLD_OPENING_STATE_CONFLICT" }] });
  });
  it("unions identities and merges primitive state", () => {
    const liability = domainId("liability", "91000000-0000-4000-8000-000000000006");
    const first = createAuthoritativeState({ accounts: state().accounts, liabilities: { [liability]: { id: liability, balance: money("1") } }, identities: { recognitionIds: [recognitionId("recognition:one")] } });
    const second = createAuthoritativeState({ accounts: state().accounts, liabilities: { [liability]: { id: liability, balance: money("1") } }, identities: { recognitionIds: [recognitionId("recognition:two")] } });
    expect(reconcileHouseholdOpeningState([first, second])).toMatchObject({ status: "compiled", value: { identities: { recognitionIds: [recognitionId("recognition:one"), recognitionId("recognition:two")] } } });
    const same = createPrimitiveRuntimeStateStore({ p: { primitiveId: "P23", state: { evaluations: 0 } } });
    expect(reconcileHouseholdPrimitiveState([same, same]).status).toBe("compiled");
  });
  it("canonicalizes policy rules without inferring static overlap", () => {
    const expense = descriptor("expense", "cash_flow", "cash_expense_settlement", "consume"); const debt = descriptor("debt", "liabilities", "liability_required_service", "consume");
    const policy = { id: "household-v1", version: "1" as const, rules: [{ before: "liability_required_service" as const, after: "cash_expense_settlement" as const }] };
    expect(buildHouseholdScheduledPlan([expense, debt], undefined)).toMatchObject({ status: "compiled", value: { dependencies: [] } });
    expect(canonicalHouseholdWorkPlan([expense, debt], policy)).toEqual(canonicalHouseholdWorkPlan([debt, expense], { ...policy, rules: [...policy.rules].reverse() }));
  });
  it("accepts transitive precedence and rejects cycles or later dependencies", () => {
    const expense = descriptor("expense", "cash_flow", "cash_expense_settlement", "consume"); const debt = descriptor("debt", "liabilities", "liability_required_service", "consume");
    const transitive = { id: "policy-transitive", version: "1" as const, rules: [{ before: "cash_expense_settlement" as const, after: "investment_purchase" as const }, { before: "investment_purchase" as const, after: "liability_required_service" as const }] };
    expect(buildHouseholdScheduledPlan([expense, debt], transitive).status).toBe("compiled");
    expect(buildHouseholdScheduledPlan([expense, debt], { ...transitive, rules: [...transitive.rules, { before: "liability_required_service", after: "cash_expense_settlement" }] })).toMatchObject({ status: "invalid_model", diagnostics: [{ code: "HOUSEHOLD_CONTENTION_POLICY_CYCLE" }] });
    const later = { ...descriptor("later", "cash_flow", "cash_income_settlement", "produce"), sequencingInstant: instant("2026-01-16T00:00:00.000Z") };
    expect(buildHouseholdScheduledPlan([{ ...expense, dependsOn: [later.id] }, later], undefined)).toMatchObject({ status: "invalid_model", diagnostics: [{ code: "HOUSEHOLD_TEMPORAL_DEPENDENCY_INVALID" }] });
  });
  it("preflights malformed policy before domain compilation", () => {
    expect(compileHouseholdProjection({} as PortableModelEnvelope, { contentionPolicy: { id: "bad", version: "1", rules: [{ before: "cash_expense_settlement", after: "cash_expense_settlement" }] } })).toMatchObject({ status: "invalid_model", diagnostics: [{ code: "HOUSEHOLD_CONTENTION_POLICY_INVALID" }] });
  });
  it("makes policy identity, but not run identity, fingerprint material", () => {
    const context = (id: string) => createRunContext({ runId: runId(id), scenarioId: scenarioId("91000000-0000-4000-8000-000000000003"), asOf: instant("2026-01-01T00:00:00.000Z"), dataCutoff: instant("2026-01-01T00:00:00.000Z"), simulationStart: instant("2026-01-01T00:00:00.000Z"), simulationEnd: instant("2026-02-01T00:00:00.000Z"), baseCurrency: USD });
    const expense = descriptor("expense", "cash_flow", "cash_expense_settlement", "consume"); const debt = descriptor("debt", "liabilities", "liability_required_service", "consume");
    const policy = { id: "first", version: "1" as const, rules: [{ before: "cash_expense_settlement" as const, after: "liability_required_service" as const }] };
    const fingerprint = (run: ReturnType<typeof context>, selected = policy) => createHouseholdProjectionFingerprint({ runContext: run, openingState: state(), primitiveState: createPrimitiveRuntimeStateStore(), descriptors: [debt, expense], contentionPolicy: selected });
    expect(fingerprint(context("91000000-0000-4000-8000-000000000004"))).toBe(fingerprint(context("91000000-0000-4000-8000-000000000005")));
    expect(fingerprint(context("91000000-0000-4000-8000-000000000004"))).not.toBe(fingerprint(context("91000000-0000-4000-8000-000000000004"), { ...policy, id: "second" }));
  });
  it("uses position market value, not carrying value, in household metrics", () => {
    const position = domainId("position", "91000000-0000-4000-8000-000000000019");
    const closing = createAuthoritativeState({ accounts: state().accounts, positions: { [position]: { id: position, accountId: account, quantity: quantity("2", SHARE), price: money("10"), carryingValue: money("3") } } });
    expect(deriveHouseholdClosingMetrics(closing, USD)).toMatchObject({ investmentValue: money("20"), totalAssets: money("30"), netWorth: money("30") });
  });
});
