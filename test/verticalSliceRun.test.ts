import { describe, expect, it } from "vitest";
import { ValidationError, issueCodes } from "../src/diagnostics.js";
import { idempotencyKey } from "../src/identity.js";
import { createFactProvenance } from "../src/provenance.js";
import {
  Percentage,
  canonicalOpeningState,
  createFundingPolicy,
  createRunContext,
  domainId,
  fundingPolicyId,
  instant,
  money,
  runId,
  runVerticalSlicePeriod,
  scenarioId,
  utcMonth,
  type VerticalSliceInput,
} from "../src/verticalSlice1.js";

const CHECKING = domainId("account", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const input: VerticalSliceInput = {
  householdId: domainId("household", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
  ownerId: domainId("person", "cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
  checkingAccountId: CHECKING,
  retirementAccountId: domainId("account", "dddddddd-dddd-4ddd-8ddd-dddddddddddd"),
  taxLiabilityId: domainId("liability", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
  monthlyGrossCompensation: money("10000"),
  taxRate: Percentage.parse("20").toRatio(),
  retirementContribution: money("2000"),
  monthlyLivingExpense: money("4000"),
  taxFundingPolicy: createFundingPolicy({
    id: fundingPolicyId("funding:test:checking"),
    orderedSources: [{ kind: "cash_account", accountId: CHECKING }],
    allowPartial: false,
    insufficientFundsBehavior: "unfunded",
  }),
};

const context = (month: number, id = "11111111-1111-4111-8111-111111111111") => {
  const horizon = utcMonth(2026, month);
  return createRunContext({
    runId: runId(id),
    scenarioId: scenarioId("22222222-2222-4222-8222-222222222222"),
    asOf: horizon.start,
    dataCutoff: horizon.start,
    simulationStart: horizon.start,
    simulationEnd: horizon.end,
    baseCurrency: money("0").currency,
  });
};

const validationCode = (operation: () => unknown): string => {
  try {
    operation();
  } catch (error) {
    if (error instanceof ValidationError) return error.issues[0]!.code;
    throw error;
  }
  throw new Error("Expected ValidationError");
};

describe("Vertical Slice 1 run/state integration", () => {
  it("preserves committed opening state on success while returning committed closing changes and metadata", () => {
    const opening = canonicalOpeningState(input);
    const before = JSON.stringify(opening);
    const result = runVerticalSlicePeriod({ period: utcMonth(2026, 1), input, openingState: opening, runContext: context(1) });
    expect(JSON.stringify(opening)).toBe(before);
    expect(result.status).toBe("completed");
    expect(result.reachedThrough).toBe(result.requestedHorizon.end);
    expect(result.state.accounts[CHECKING]!.cash.equals(money("2000"))).toBe(true);
    expect(result.state.identities.postedTransactionIds).toHaveLength(5);
    expect(result.state.identities.generatedOccurrenceKeys.length).toBeGreaterThan(0);
    expect(result.runMetadata).toEqual(expect.objectContaining({
      runId: context(1).runId,
      scenarioId: context(1).scenarioId,
      asOf: context(1).asOf,
      dataCutoff: context(1).dataCutoff,
      engineVersion: "0.1.0",
      resultSchemaVersion: "0.1.0",
      financialSpecificationVersion: "0.1.7-draft",
      modelFormatVersion: "0.2.0-draft",
    }));
    expect(result.recognitions.every((fact) => fact.provenance?.factKind === "model_generated")).toBe(true);
  });

  it("rejects replay of a previously committed generated occurrence after state rollover", () => {
    const first = runVerticalSlicePeriod({ period: utcMonth(2026, 1), input, openingState: canonicalOpeningState(input), runContext: context(1) });
    const before = JSON.stringify(first.state);
    expect(validationCode(() => runVerticalSlicePeriod({ period: utcMonth(2026, 1), input, openingState: first.state, runContext: context(1, "33333333-3333-4333-8333-333333333333") })))
      .toBe(issueCodes.duplicateGeneratedOccurrence);
    expect(JSON.stringify(first.state)).toBe(before);
  });

  it("keeps fingerprint and economics unchanged when only runId changes", () => {
    const opening = canonicalOpeningState(input);
    const first = runVerticalSlicePeriod({ period: utcMonth(2026, 1), input, openingState: opening, runContext: context(1) });
    const second = runVerticalSlicePeriod({ period: utcMonth(2026, 1), input, openingState: opening, runContext: context(1, "99999999-9999-4999-8999-999999999999") });
    expect(second.runMetadata.inputFingerprint).toBe(first.runMetadata.inputFingerprint);
    expect(second.state).toEqual(first.state);
    expect(second.transactions).toEqual(first.transactions);
    expect(second.statements).toEqual(first.statements);
  });

  it("keeps modeled liquidity stress completed rather than invalid_model", () => {
    const stressed = { ...input, monthlyGrossCompensation: money("0"), retirementContribution: money("0"), monthlyLivingExpense: money("0") };
    const opening = canonicalOpeningState(stressed);
    opening.accounts[CHECKING]!.cash = money("5");
    const result = runVerticalSlicePeriod({
      period: utcMonth(2026, 1),
      input: stressed,
      openingState: opening,
      runContext: context(1),
      taxSettlements: [],
    });
    expect(result.status).toBe("completed");
  });

  it("rejects observed settlement input beyond dataCutoff and preserves external identity metadata", () => {
    const january = runVerticalSlicePeriod({
      period: utcMonth(2026, 1),
      input: { ...input, settleCurrentTax: false },
      openingState: canonicalOpeningState(input),
      runContext: context(1),
    });
    const observed = createFactProvenance({
      factKind: "observed",
      sourceType: "financial_institution",
      sourceId: "institution:fixture",
      observedAt: instant("2026-02-15T00:00:00.000Z"),
      importedAt: instant("2026-02-16T00:00:00.000Z"),
      effectiveAt: instant("2026-02-15T00:00:00.000Z"),
      originalExternalId: "external-settlement-1",
      idempotencyKey: idempotencyKey("institution:fixture", "external-settlement-1"),
    });
    const before = JSON.stringify(january.state);
    expect(validationCode(() => runVerticalSlicePeriod({
      period: utcMonth(2026, 2),
      input: { ...input, monthlyGrossCompensation: money("0"), retirementContribution: money("0"), monthlyLivingExpense: money("0"), settleCurrentTax: false },
      openingState: january.state,
      runContext: context(2),
      taxSettlements: [{
        settlementId: "settlement:observed",
        obligationId: "obligation:recognition:tax:2026-01-01T00:00:00.000Z",
        amount: money("2000"),
        date: instant("2026-02-15T00:00:00.000Z"),
        provenance: observed,
      }],
    }))).toBe(issueCodes.observedFactAfterDataCutoff);
    expect(JSON.stringify(january.state)).toBe(before);
    expect(JSON.parse(JSON.stringify(observed))).toEqual(expect.objectContaining({
      originalExternalId: "external-settlement-1",
      idempotencyKey: idempotencyKey("institution:fixture", "external-settlement-1"),
    }));
  });

  it("retains accepted observed provenance and idempotency through result/state rollover", () => {
    const january = runVerticalSlicePeriod({
      period: utcMonth(2026, 1),
      input: { ...input, settleCurrentTax: false },
      openingState: canonicalOpeningState(input),
      runContext: context(1),
    });
    const effectiveAt = instant("2026-02-15T00:00:00.000Z");
    const externalKey = idempotencyKey("institution:fixture", "accepted-external-settlement");
    const provenance = createFactProvenance({
      factKind: "observed",
      sourceType: "financial_institution",
      sourceId: "institution:fixture",
      observedAt: effectiveAt,
      importedAt: instant("2026-02-16T00:00:00.000Z"),
      effectiveAt,
      originalExternalId: "accepted-external-settlement",
      idempotencyKey: externalKey,
    });
    const baseContext = context(2);
    const runContext = createRunContext({
      ...baseContext,
      asOf: instant("2026-02-20T00:00:00.000Z"),
      dataCutoff: instant("2026-02-20T00:00:00.000Z"),
    });
    const result = runVerticalSlicePeriod({
      period: utcMonth(2026, 2),
      input: { ...input, monthlyGrossCompensation: money("0"), retirementContribution: money("0"), monthlyLivingExpense: money("0"), settleCurrentTax: false },
      openingState: january.state,
      runContext,
      taxSettlements: [{
        settlementId: "settlement:accepted-observed",
        obligationId: "obligation:recognition:tax:2026-01-01T00:00:00.000Z",
        amount: money("2000"),
        date: effectiveAt,
        provenance,
      }],
    });
    expect(result.settlementProposals[0]?.provenance).toEqual(provenance);
    expect(result.settlements[0]?.provenance).toEqual(provenance);
    expect(result.state.identities.externalIdempotencyKeys).toContain(externalKey);
    expect(validationCode(() => runVerticalSlicePeriod({
      period: utcMonth(2026, 2),
      input: { ...input, monthlyGrossCompensation: money("0"), retirementContribution: money("0"), monthlyLivingExpense: money("0"), settleCurrentTax: false },
      openingState: result.state,
      runContext: createRunContext({ ...runContext, runId: runId("44444444-4444-4444-8444-444444444444") }),
      taxSettlements: [{ settlementId: "settlement:reimport", obligationId: "missing-on-purpose", amount: money("1"), date: effectiveAt, provenance }],
    }))).toBe(issueCodes.duplicateExternalIdempotencyKey);
  });
});
