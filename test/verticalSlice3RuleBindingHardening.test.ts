import { describe, expect, it } from "vitest";
import { ValidationError, issueCodes } from "../src/diagnostics/index.js";
import { domainId } from "../src/identity/index.js";
import { createAuthoritativeState } from "../src/state/index.js";
import { createRunContext, runId, scenarioId } from "../src/simulation/run.js";
import { instant, utcMonth } from "../src/time/index.js";
import { Currency, USD, money } from "../src/values/index.js";
import { runVerticalSlice3, type InvestmentFee, type VerticalSlice3Input } from "../src/verticalSlice3.js";

const householdId = domainId("household", "58000000-0000-4000-8000-000000000001");
const ownerId = domainId("person", "58000000-0000-4000-8000-000000000002");
const checkingAccountId = domainId("account", "58000000-0000-4000-8000-000000000003");
const ruleId = (suffix: number) => domainId("tax-rule", `58000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`);
const period = utcMonth(2026, 1);

const runContext = createRunContext({
  runId: runId("58000000-0000-4000-8000-000000000010"),
  scenarioId: scenarioId("58000000-0000-4000-8000-000000000011"),
  asOf: instant("2025-12-31T00:00:00.000Z"),
  dataCutoff: instant("2025-12-31T00:00:00.000Z"),
  simulationStart: period.start,
  simulationEnd: period.end,
  baseCurrency: USD,
});

const openingState = () => createAuthoritativeState({
  accounts: {
    [checkingAccountId]: { id: checkingAccountId, ownerId, kind: "checking", cash: money("100") },
  },
  positions: {},
  liabilities: {},
});

const dormantFee = (feeRuleIds: InvestmentFee["feeRuleIds"]): InvestmentFee => ({
  id: domainId("investment-fee", "58000000-0000-4000-8000-000000000020"),
  cashAccountId: checkingAccountId,
  feeRuleIds,
  eligibilitySchedule: { kind: "explicit_instants", instants: [instant("2027-01-20T00:00:00.000Z")] },
  executionTiming: "end_of_period",
  order: 1,
  schedulePrimitiveId: domainId("primitive-instance", "58000000-0000-4000-8000-000000000021"),
});

const input = (ruleCatalog: VerticalSlice3Input["ruleCatalog"], fee: InvestmentFee): VerticalSlice3Input => ({
  householdId,
  ownerId,
  baseCurrency: USD,
  valuationAccountingPolicy: "economic_only",
  ruleCatalog,
  transfers: [],
  purchases: [],
  fees: [fee],
  returns: [],
});

const validationCode = (action: () => unknown): string => {
  try {
    action();
  } catch (error) {
    if (error instanceof ValidationError) return error.issues[0]!.code;
    throw error;
  }
  throw new Error("Expected ValidationError");
};

describe("Vertical Slice 3 rule-binding structural validation", () => {
  it("rejects an empty required fee binding even when the fee is dormant", () => {
    expect(validationCode(() => runVerticalSlice3({
      runContext,
      openingState: openingState(),
      input: input([], dormantFee([])),
    }))).toBe(issueCodes.ruleDefinitionInvalid);
  });

  it("rejects dormant fee candidates with incompatible currency or posting precision", () => {
    const wrongCurrency = {
      id: ruleId(30),
      kind: "fixed_fee" as const,
      target: { targetType: "account" as const, targetId: checkingAccountId },
      effectiveFrom: instant("2027-01-01T00:00:00.000Z"),
      amount: money("1", Currency.of("EUR")),
    };
    expect(validationCode(() => runVerticalSlice3({
      runContext,
      openingState: openingState(),
      input: input([wrongCurrency], dormantFee([wrongCurrency.id])),
    }))).toBe(issueCodes.verticalSlice3InputInvalid);

    const excessPrecision = {
      id: ruleId(31),
      kind: "fixed_fee" as const,
      target: { targetType: "account" as const, targetId: checkingAccountId },
      effectiveFrom: instant("2027-01-01T00:00:00.000Z"),
      amount: money("1.001"),
    };
    expect(validationCode(() => runVerticalSlice3({
      runContext,
      openingState: openingState(),
      input: input([excessPrecision], dormantFee([excessPrecision.id])),
    }))).toBe(issueCodes.verticalSlice3InputInvalid);
  });
});
