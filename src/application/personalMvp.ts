import { domainId } from "../identity/index.js";
import type { ValidationIssue } from "../diagnostics/index.js";
import {
  CURRENT_MODEL_FORMAT_VERSION,
  type JsonValue,
  type PortableModelEnvelope,
  type PortableModelObjects,
} from "../model/modelVersion.js";
import { CURRENT_RUN_VERSIONS } from "../model/version.js";
import {
  assumptionId,
  scenarioId as canonicalScenarioId,
} from "../model/scenario.js";
import { createRunContext, runId, scenarioId } from "../simulation/run.js";
import { compareVerticalSlice2Scenarios } from "../simulation/scenario.js";
import { runVerticalSlice2 } from "../simulation/verticalSlice2.js";
import {
  instant,
  utcMonthDifference,
  utcMonthlyPeriods,
} from "../time/index.js";
import {
  Currency,
  Money,
  Rate,
  RoundingPolicy,
  formatMoney,
  rateConvention,
} from "../values/index.js";
import {
  compileCashFlow,
  compileCurrentPosition,
  type CapabilityDiagnostic,
} from "./compiler/index.js";
import { PERSONAL_EDITOR_DESCRIPTOR } from "./editorDescriptor.generated.js";
export {
  exportPersonalModelJson,
  importPersonalModelJson,
  migratePersonalModelVersion,
  validatePersonalModelJson,
} from "./modelPortability.js";

export const PERSONAL_OBJECT_TYPES = Object.freeze([
  "Household",
  "Person",
  "Account",
  "Income",
  "Expense",
  "Asset",
  "Liability",
  "Investment",
  "Assumption",
  "Scenario",
] as const);
export type PersonalObjectType = (typeof PERSONAL_OBJECT_TYPES)[number];
export type PersonalDraft = PortableModelEnvelope;
export type JsonObject = Readonly<Record<string, JsonValue>>;

export interface EditorIssue {
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly objectType?: PersonalObjectType;
  readonly objectId?: string;
  readonly field?: string;
}
export interface DeleteResult {
  readonly draft: PersonalDraft;
  readonly deleted: boolean;
  readonly references: readonly string[];
}
export interface MoneyReadModel {
  readonly exact: string;
  readonly display: string;
  readonly currency: string;
}
export interface CurrentPositionReadModel {
  readonly netWorth?: MoneyReadModel;
  readonly cash?: MoneyReadModel;
  readonly assets?: MoneyReadModel;
  readonly liabilities?: MoneyReadModel;
  readonly monthlyIncome?: MoneyReadModel;
  readonly monthlySpending?: MoneyReadModel;
  readonly monthlyCashFlow?: MoneyReadModel;
  readonly unavailable: readonly string[];
}
export interface ForecastPoint {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly income: MoneyReadModel;
  readonly spending: MoneyReadModel;
  readonly netCashFlow: MoneyReadModel;
  readonly endingCash: MoneyReadModel;
  readonly traceIds: readonly string[];
}
export interface ShortfallReadModel {
  readonly period: string;
  readonly entityId: string;
  readonly required: MoneyReadModel;
  readonly available: MoneyReadModel;
  readonly unfunded: MoneyReadModel;
  readonly diagnostic: string;
}
export interface PersonalForecastReadModel {
  readonly scope: "cash_flow" | "investments" | "liabilities";
  readonly status: "completed" | "incomplete" | "unavailable";
  readonly message?: string;
  readonly asOf: string;
  readonly dataCutoff: string;
  readonly simulationStart: string;
  readonly simulationEnd: string;
  readonly actualHistoryAvailable: false;
  readonly points: readonly ForecastPoint[];
  readonly shortfalls: readonly ShortfallReadModel[];
  readonly diagnostics: readonly (ValidationIssue | CapabilityDiagnostic)[];
}
export interface ForecastRequest {
  readonly scope: "cash_flow" | "investments" | "liabilities";
  readonly baseCurrency: string;
  readonly asOf: string;
  readonly dataCutoff: string;
  readonly simulationStart: string;
  readonly simulationEnd: string;
  readonly months: number;
  readonly sameInstantCashFlowOrder:
    | "income_before_expense"
    | "expense_before_income";
}
export interface PersonalSessionSettings {
  readonly baseCurrency: string;
  readonly asOf: string;
  readonly dataCutoff: string;
  readonly simulationStart: string;
  readonly simulationEnd: string;
  readonly sameInstantCashFlowOrder:
    | "income_before_expense"
    | "expense_before_income";
}
export interface PersonalSessionSettingsResolution {
  readonly settings?: PersonalSessionSettings;
  readonly request?: ForecastRequest;
  readonly error?: string;
}
export interface GuidedSetupInput {
  readonly modelId: string;
  readonly householdId: string;
  readonly personId: string;
  readonly accountId: string;
  readonly incomeId: string;
  readonly assetId: string;
  readonly liabilityId: string;
  readonly expenseId: string;
  readonly householdName: string;
  readonly monthlyIncome: string;
  readonly openingCash: string;
  readonly assetValue: string;
  readonly debt: string;
  readonly monthlySpending: string;
  readonly startDate: string;
}
export interface ScenarioComparisonPoint {
  readonly period: string;
  readonly baseline: MoneyReadModel;
  readonly alternative: MoneyReadModel;
  readonly delta: MoneyReadModel;
  readonly traceIds: readonly string[];
  readonly relatedDifferenceIds: readonly string[];
}
export interface PersonalScenarioComparisonReadModel {
  readonly status: "completed" | "unavailable";
  readonly message?: string;
  readonly scope: "cash_flow";
  readonly baselineName: string;
  readonly alternativeName: string;
  readonly points: readonly ScenarioComparisonPoint[];
  readonly configurationDifferences: readonly Readonly<{
    target: string;
    kind: string;
    assumptionIds: readonly string[];
  }>[];
  readonly appliedRuleDifferences: Readonly<{
    baselineOnly: readonly string[];
    alternativeOnly: readonly string[];
  }>;
}

const asObject = (value: JsonValue | undefined): JsonObject | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
const entries = (
  draft: PersonalDraft,
  type: PersonalObjectType,
): readonly JsonObject[] =>
  (draft.objects[type] ?? [])
    .map(asObject)
    .filter((value): value is JsonObject => value !== undefined);
const deepFreeze = <T>(value: T): T => {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};
const withObjects = (
  draft: PersonalDraft,
  objects: PortableModelObjects,
): PersonalDraft => deepFreeze({ ...draft, objects });
const idKind = (type: PersonalObjectType) => type.toLowerCase();
const descriptorFor = (type: PersonalObjectType) =>
  PERSONAL_EDITOR_DESCRIPTOR[type];
const literalDefault = (value: unknown): value is JsonValue =>
  value === null ||
  typeof value === "boolean" ||
  typeof value === "number" ||
  Array.isArray(value) ||
  typeof value === "string";

export const getPersonalEditorMetadata = () => PERSONAL_EDITOR_DESCRIPTOR;

export const createEmptyPersonalDraft = (modelId: string): PersonalDraft =>
  deepFreeze({
    modelFormatVersion: CURRENT_MODEL_FORMAT_VERSION,
    financialSpecificationVersion:
      CURRENT_RUN_VERSIONS.financialSpecificationVersion,
    modelId: domainId("model", modelId),
    objects: Object.fromEntries(
      PERSONAL_OBJECT_TYPES.map((type) => [type, []]),
    ) as PortableModelObjects,
  });

/**
 * Creates only the canonical objects directly represented by guided-setup
 * inputs. Required fields the short wizard does not collect intentionally
 * remain incomplete and are surfaced through draft validation.
 */
export const createGuidedSetupDraft = (
  input: GuidedSetupInput,
): PersonalDraft => {
  let draft = createEmptyPersonalDraft(input.modelId);
  draft = addPersonalObject(draft, "Household", input.householdId, {
    name: input.householdName,
    members: [input.personId],
  });
  draft = addPersonalObject(draft, "Person", input.personId, {
    household_id: input.householdId,
  });
  draft = addPersonalObject(draft, "Account", input.accountId, {
    name: "Cash account",
    account_type: "checking",
    owner_id: input.personId,
    opening_date: input.startDate,
    opening_balance: input.openingCash,
  });
  draft = addPersonalObject(draft, "Income", input.incomeId, {
    owner_id: input.personId,
    amount: input.monthlyIncome,
    frequency: "monthly",
    start_date: input.startDate,
  });
  draft = addPersonalObject(draft, "Expense", input.expenseId, {
    owner_id: input.householdId,
    category: "Spending",
    amount: input.monthlySpending,
    frequency: "monthly",
    start_date: input.startDate,
    payment_account_id: input.accountId,
  });
  draft = addPersonalObject(draft, "Asset", input.assetId, {
    name: "Other asset",
    owner_id: input.householdId,
    acquisition_cost: input.assetValue,
  });
  return addPersonalObject(draft, "Liability", input.liabilityId, {
    name: "Debt",
    owner_id: input.householdId,
    principal: input.debt,
    current_balance: input.debt,
  });
};

export const addPersonalObject = (
  draft: PersonalDraft,
  type: PersonalObjectType,
  id: string,
  initial: Readonly<Record<string, JsonValue>> = {},
): PersonalDraft => {
  const descriptor = descriptorFor(type);
  const canonicalId = domainId(idKind(type), id);
  const value: Record<string, JsonValue> = {
    [descriptor.idField]: canonicalId,
  };
  for (const [fieldName, field] of Object.entries(descriptor.fields)) {
    if (fieldName === descriptor.idField || field.derived) continue;
    if (field.default !== null && literalDefault(field.default))
      value[fieldName] = field.default;
  }
  for (const [fieldName, fieldValue] of Object.entries(initial)) {
    const field = descriptor.fields[
      fieldName as keyof typeof descriptor.fields
    ] as { readonly derived: boolean } | undefined;
    if (
      field === undefined ||
      field.derived ||
      fieldName === descriptor.idField
    )
      continue;
    value[fieldName] = fieldValue;
  }
  const collection = [...(draft.objects[type] ?? []), deepFreeze(value)];
  return withObjects(draft, {
    ...draft.objects,
    [type]: Object.freeze(collection),
  });
};

export const patchPersonalObject = (
  draft: PersonalDraft,
  type: PersonalObjectType,
  id: string,
  patch: Readonly<Record<string, JsonValue>>,
): PersonalDraft => {
  const descriptor = descriptorFor(type);
  const canonicalId = domainId(idKind(type), id);
  const collection = draft.objects[type] ?? [];
  let found = false;
  const next = collection.map((candidate) => {
    const object = asObject(candidate);
    if (object?.[descriptor.idField] !== canonicalId) return candidate;
    found = true;
    const applied: Record<string, JsonValue> = { ...object };
    for (const [fieldName, fieldValue] of Object.entries(patch)) {
      const field = descriptor.fields[
        fieldName as keyof typeof descriptor.fields
      ] as { readonly mutable: boolean; readonly derived: boolean } | undefined;
      // Immutable canonical fields may be supplied once while a newly-created
      // object is being completed, but can never be overwritten afterward.
      if (
        field !== undefined &&
        (field.mutable || object[fieldName] === undefined) &&
        !field.derived &&
        fieldName !== descriptor.idField
      )
        applied[fieldName] = fieldValue;
    }
    return deepFreeze(applied);
  });
  if (!found) throw new Error(`${type} ${canonicalId} was not found`);
  return withObjects(draft, { ...draft.objects, [type]: Object.freeze(next) });
};

const findReferences = (
  draft: PersonalDraft,
  id: string,
  omitted: JsonValue,
): readonly string[] => {
  const references: string[] = [];
  const visit = (value: JsonValue, path: string): void => {
    if (value === omitted) return;
    if (value === id) references.push(path);
    else if (Array.isArray(value))
      value.forEach((child, index) => visit(child, `${path}.${index}`));
    else if (typeof value === "object" && value !== null)
      Object.entries(value).forEach(([key, child]) =>
        visit(child, `${path}.${key}`),
      );
  };
  Object.entries(draft.objects).forEach(([collection, values]) =>
    values.forEach((value, index) =>
      visit(value, `objects.${collection}.${index}`),
    ),
  );
  return Object.freeze(references);
};

export const deletePersonalObject = (
  draft: PersonalDraft,
  type: PersonalObjectType,
  id: string,
): DeleteResult => {
  const descriptor = descriptorFor(type);
  const canonicalId = domainId(idKind(type), id);
  const collection = draft.objects[type] ?? [];
  const target = collection.find(
    (value) => asObject(value)?.[descriptor.idField] === canonicalId,
  );
  if (target === undefined)
    throw new Error(`${type} ${canonicalId} was not found`);
  const references = findReferences(draft, canonicalId, target);
  if (references.length > 0)
    return deepFreeze({ draft, deleted: false, references });
  return deepFreeze({
    draft: withObjects(draft, {
      ...draft.objects,
      [type]: collection.filter((value) => value !== target),
    }),
    deleted: true,
    references: [],
  });
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXACT_DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
export const validatePersonalDraft = (
  draft: PersonalDraft,
): readonly EditorIssue[] => {
  const issues: EditorIssue[] = [];
  for (const type of PERSONAL_OBJECT_TYPES) {
    const descriptor = descriptorFor(type);
    for (const object of entries(draft, type)) {
      const rawObjectId = object[descriptor.idField];
      const objectId =
        typeof rawObjectId === "string" ? rawObjectId : undefined;
      for (const [fieldName, field] of Object.entries(descriptor.fields)) {
        const value = object[fieldName];
        if (
          field.required &&
          !field.derived &&
          (value === undefined || value === null || value === "")
        )
          issues.push({
            severity: "error",
            message: `${fieldName.replaceAll("_", " ")} is required`,
            objectType: type,
            ...(objectId ? { objectId } : {}),
            field: fieldName,
          });
        if (
          value !== undefined &&
          value !== null &&
          (field.type === "money" ||
            field.type === "rate" ||
            field.type === "decimal") &&
          (typeof value !== "string" || !EXACT_DECIMAL.test(value))
        )
          issues.push({
            severity: "error",
            message: `${fieldName.replaceAll("_", " ")} must be an exact decimal string`,
            objectType: type,
            ...(objectId ? { objectId } : {}),
            field: fieldName,
          });
        if (
          value !== undefined &&
          value !== null &&
          field.type === "uuid" &&
          (typeof value !== "string" || !UUID.test(value))
        )
          issues.push({
            severity: "error",
            message: `${fieldName.replaceAll("_", " ")} must be a UUID`,
            objectType: type,
            ...(objectId ? { objectId } : {}),
            field: fieldName,
          });
      }
    }
  }
  return deepFreeze(issues);
};

const displayPolicy = RoundingPolicy.currency(2, "half_even");
const moneyDto = (value: Money): MoneyReadModel =>
  deepFreeze({
    exact: value.amount.toString(),
    display: formatMoney(value, displayPolicy),
    currency: value.currency.code,
  });

export const getCurrentPosition = (
  draft: PersonalDraft,
  currencyCode = "USD",
  asOf = "2026-01-01",
): CurrentPositionReadModel => {
  const result = compileCurrentPosition(draft, {
    baseCurrency: currencyCode,
    asOf,
  });
  if (result.status !== "compiled")
    return deepFreeze({
      unavailable: result.diagnostics.map((diagnostic) => diagnostic.message),
    });
  const value = result.value;
  return deepFreeze({
    ...(value.netWorth ? { netWorth: moneyDto(value.netWorth) } : {}),
    ...(value.cash ? { cash: moneyDto(value.cash) } : {}),
    ...(value.assets ? { assets: moneyDto(value.assets) } : {}),
    ...(value.liabilities ? { liabilities: moneyDto(value.liabilities) } : {}),
    ...(value.monthlyIncome
      ? { monthlyIncome: moneyDto(value.monthlyIncome) }
      : {}),
    ...(value.monthlySpending
      ? { monthlySpending: moneyDto(value.monthlySpending) }
      : {}),
    ...(value.monthlyCashFlow
      ? { monthlyCashFlow: moneyDto(value.monthlyCashFlow) }
      : {}),
    unavailable: value.diagnostics.map((diagnostic) => diagnostic.message),
  });
};

const unavailableForecast = (
  request: ForecastRequest,
  message: string,
): PersonalForecastReadModel =>
  deepFreeze({
    ...request,
    actualHistoryAvailable: false as const,
    status: "unavailable" as const,
    message,
    points: [],
    shortfalls: [],
    diagnostics: [],
  });
const iso = (date: string) => instant(`${date}T00:00:00.000Z`);

/** Creates a deterministic session-only run request without using wall clock time. */
export const resolvePersonalSessionSettings = (
  settings: PersonalSessionSettings,
  scope: ForecastRequest["scope"],
): PersonalSessionSettingsResolution => {
  try {
    const asOf = iso(settings.asOf);
    const dataCutoff = iso(settings.dataCutoff);
    const simulationStart = iso(settings.simulationStart);
    const simulationEnd = iso(settings.simulationEnd);
    Currency.of(settings.baseCurrency);
    if (dataCutoff > asOf)
      return deepFreeze({
        error: "Data cutoff must not be later than as of.",
      });
    if (simulationStart >= simulationEnd)
      return deepFreeze({
        error: "Simulation start must be before simulation end.",
      });
    const months = utcMonthDifference(simulationStart, simulationEnd);
    if (months <= 0)
      return deepFreeze({ error: "Simulation horizon must include a month." });
    return deepFreeze({
      settings: deepFreeze({ ...settings }),
      request: {
        scope,
        baseCurrency: settings.baseCurrency,
        asOf: settings.asOf,
        dataCutoff: settings.dataCutoff,
        simulationStart: settings.simulationStart,
        simulationEnd: settings.simulationEnd,
        months,
        sameInstantCashFlowOrder: settings.sameInstantCashFlowOrder,
      },
    });
  } catch (error) {
    return deepFreeze({
      error:
        error instanceof Error ? error.message : "Run settings are not valid.",
    });
  }
};

export const sessionSettingsFromHorizon = (
  startDate: string,
  horizonMonths: number,
  baseCurrency = "USD",
): PersonalSessionSettings => {
  const periods = utcMonthlyPeriods(iso(startDate), horizonMonths);
  return deepFreeze({
    baseCurrency,
    asOf: startDate,
    dataCutoff: startDate,
    simulationStart: startDate,
    simulationEnd: periods[periods.length - 1]!.end.slice(0, 10),
    sameInstantCashFlowOrder: "income_before_expense",
  });
};

export const runPersonalForecast = (
  draft: PersonalDraft,
  request: ForecastRequest,
): PersonalForecastReadModel => {
  if (request.scope !== "cash_flow")
    return unavailableForecast(
      request,
      `${request.scope === "investments" ? "Investment" : "Liability"} execution requires complete engine-specific configuration; this portable model is preserved but is not automatically executable.`,
    );
  try {
    const currency = Currency.of(request.baseCurrency);
    const start = iso(request.simulationStart);
    const compilation = compileCashFlow(draft, {
      baseCurrency: request.baseCurrency,
      simulationStart: request.simulationStart,
      simulationEnd: request.simulationEnd,
      sameInstantCashFlowOrder: request.sameInstantCashFlowOrder,
    });
    if (compilation.status !== "compiled") {
      const message = compilation.diagnostics
        .map((value) => value.message)
        .join("; ");
      return deepFreeze({
        ...unavailableForecast(request, message),
        diagnostics: compilation.diagnostics,
      });
    }
    const runContext = createRunContext({
      runId: runId(cryptoSafeRunId(draft.modelId)),
      scenarioId: scenarioId(compilation.value.scenarioIdentity),
      asOf: iso(request.asOf),
      dataCutoff: iso(request.dataCutoff),
      simulationStart: start,
      simulationEnd: iso(request.simulationEnd),
      baseCurrency: currency,
    });
    const result = runVerticalSlice2({
      runContext,
      openingState: compilation.value.openingState,
      input: compilation.value.input,
      months: request.months,
    });
    const points = result.periods.map((period) => ({
      periodStart: period.period.start,
      periodEnd: period.period.end,
      income: moneyDto(period.recurringIncomeRecognized),
      spending: moneyDto(period.recurringExpenseRecognized),
      netCashFlow: moneyDto(
        period.recurringIncomeRecognized.minus(
          period.recurringExpenseRecognized,
        ),
      ),
      endingCash: moneyDto(period.endingCash),
      traceIds: Object.freeze(period.traceRefs.map((ref) => ref.traceId)),
    }));
    const shortfalls = result.periods.flatMap((period) =>
      period.liquidityShortfalls.map((shortfall) => ({
        period: period.period.start,
        entityId: shortfall.claimId,
        required: moneyDto(shortfall.requestedAmount),
        available: moneyDto(shortfall.fundedAmount),
        unfunded: moneyDto(shortfall.shortfallAmount),
        diagnostic:
          "Insufficient modeled liquidity; the engine left the obligation unfunded.",
      })),
    );
    return deepFreeze({
      scope: "cash_flow",
      status: result.status,
      asOf: result.displayInputs.asOf,
      dataCutoff: result.displayInputs.dataCutoff,
      simulationStart: request.simulationStart,
      simulationEnd: request.simulationEnd,
      actualHistoryAvailable: false,
      points,
      shortfalls,
      diagnostics: Object.freeze([
        ...compilation.diagnostics,
        ...result.diagnostics,
      ]),
    });
  } catch (error) {
    return unavailableForecast(
      request,
      error instanceof Error
        ? error.message
        : "Cash-flow model could not be translated safely.",
    );
  }
};

const cryptoSafeRunId = (modelId: string) => modelId;

/** Runs a deterministic VS2 comparison; it never combines independent slices. */
export const comparePersonalCashFlowPlans = (
  draft: PersonalDraft,
  request: ForecastRequest,
  annualIncomeGrowth: string,
): PersonalScenarioComparisonReadModel => {
  const unavailable = (message: string): PersonalScenarioComparisonReadModel =>
    deepFreeze({
      status: "unavailable",
      message,
      scope: "cash_flow",
      baselineName: "Current plan",
      alternativeName: "Income grows faster",
      points: [],
      configurationDifferences: [],
      appliedRuleDifferences: { baselineOnly: [], alternativeOnly: [] },
    });
  if (request.scope !== "cash_flow")
    return unavailable(
      "Plan comparison is available only for the selected cash-flow scope.",
    );
  if (!EXACT_DECIMAL.test(annualIncomeGrowth))
    return unavailable("Income growth must be an exact decimal string.");
  try {
    const currency = Currency.of(request.baseCurrency);
    const compilation = compileCashFlow(draft, {
      baseCurrency: request.baseCurrency,
      simulationStart: request.simulationStart,
      simulationEnd: request.simulationEnd,
      sameInstantCashFlowOrder: request.sameInstantCashFlowOrder,
    });
    if (compilation.status !== "compiled")
      return unavailable(
        compilation.diagnostics.map((value) => value.message).join("; "),
      );
    const input = compilation.value.input;
    if (input.incomes.length !== 1)
      return unavailable(
        `Plan comparison requires exactly one compiled Income target; found ${input.incomes.length}.`,
      );
    const [comparisonIncome] = input.incomes;
    const openingState = compilation.value.openingState;
    const baselineId = canonicalScenarioId(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    );
    const alternativeId = canonicalScenarioId(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
    );
    const horizon = {
      start: iso(request.simulationStart),
      end: iso(request.simulationEnd),
    };
    const result = compareVerticalSlice2Scenarios({
      scenarios: [
        {
          scenarioId: baselineId,
          name: "Current plan",
          horizon,
          timestep: "monthly",
          enabled: true,
          stochastic: false,
          simulationCount: 1,
          changes: [],
        },
        {
          scenarioId: alternativeId,
          baseScenarioId: baselineId,
          name: "Income grows faster",
          horizon,
          timestep: "monthly",
          enabled: true,
          stochastic: false,
          simulationCount: 1,
          changes: [
            {
              kind: "income_growth",
              incomeId: comparisonIncome!.id,
              rate: Rate.fromDecimal(
                annualIncomeGrowth,
                rateConvention.effectiveAnnual(),
              ),
              assumptionId: assumptionId(
                "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
              ),
            },
          ],
        },
      ],
      baselineScenarioId: baselineId,
      alternativeScenarioIds: [alternativeId],
      runIds: {
        [baselineId]: runId("cccccccc-cccc-4ccc-8ccc-ccccccccccc1"),
        [alternativeId]: runId("cccccccc-cccc-4ccc-8ccc-ccccccccccc2"),
      },
      runContext: {
        asOf: iso(request.asOf),
        dataCutoff: iso(request.dataCutoff),
        simulationStart: horizon.start,
        simulationEnd: horizon.end,
        baseCurrency: currency,
        versions: CURRENT_RUN_VERSIONS,
      },
      openingState,
      input,
      months: request.months,
    });
    const alternative = result.alternatives[0]!;
    const points = result.baseline.points.map((baseline, index) => {
      const other = alternative.scenario.points[index]!;
      const delta = alternative.deltas[index]!;
      const baselineCash = baseline.metrics.endingCash!;
      const alternativeCash = other.metrics.endingCash!;
      return {
        period: baseline.period.start,
        baseline: moneyDto(baselineCash),
        alternative: moneyDto(alternativeCash),
        delta: moneyDto(alternativeCash.minus(baselineCash)),
        traceIds: Object.freeze(other.traceRefs.map((ref) => ref.traceId)),
        relatedDifferenceIds: delta.relatedDifferenceIds,
      };
    });
    return deepFreeze({
      status: "completed",
      scope: "cash_flow",
      baselineName: "Current plan",
      alternativeName: "Income grows faster",
      points,
      configurationDifferences: alternative.differences.map((difference) => ({
        target: difference.semanticTarget,
        kind: difference.changeKind,
        assumptionIds: difference.assumptionIds,
      })),
      appliedRuleDifferences: alternative.appliedRuleDifferences,
    });
  } catch (error) {
    return unavailable(
      error instanceof Error
        ? error.message
        : "The cash-flow plans could not be compared safely.",
    );
  }
};

export const createSyntheticPersonalDraft = (): PersonalDraft => {
  const ids = {
    model: "90000000-0000-4000-8000-000000000001",
    household: "90000000-0000-4000-8000-000000000002",
    person: "90000000-0000-4000-8000-000000000003",
    account: "90000000-0000-4000-8000-000000000004",
    income: "90000000-0000-4000-8000-000000000005",
    expense: "90000000-0000-4000-8000-000000000006",
    asset: "90000000-0000-4000-8000-000000000007",
    liability: "90000000-0000-4000-8000-000000000008",
    investment: "90000000-0000-4000-8000-000000000009",
    assumption: "90000000-0000-4000-8000-000000000010",
    scenario: "90000000-0000-4000-8000-000000000011",
    primitive: "90000000-0000-4000-8000-000000000012",
  };
  let draft = createEmptyPersonalDraft(ids.model);
  draft = addPersonalObject(draft, "Household", ids.household, {
    name: "Example household",
    household_type: "individual",
    formation_date: "2020-01-01",
    members: [ids.person],
    primary_jurisdiction: "US-NY",
  });
  draft = addPersonalObject(draft, "Person", ids.person, {
    first_name: "Taylor",
    last_name: "Example",
    date_of_birth: "1990-01-01",
    household_id: ids.household,
    residence_jurisdiction: "US-NY",
  });
  draft = addPersonalObject(draft, "Account", ids.account, {
    name: "Everyday checking",
    account_type: "checking",
    owner_id: ids.person,
    opening_date: "2026-01-01",
    opening_balance: "5000.00",
  });
  draft = addPersonalObject(draft, "Income", ids.income, {
    owner_id: ids.person,
    source: "Example salary",
    amount: "6000.00",
    frequency: "monthly",
    start_date: "2026-01-01",
    gross_or_net: "gross",
    growth_model_id: ids.primitive,
  });
  draft = addPersonalObject(draft, "Expense", ids.expense, {
    owner_id: ids.household,
    category: "Living costs",
    amount: "4200.00",
    frequency: "monthly",
    start_date: "2026-01-01",
    payment_account_id: ids.account,
  });
  draft = addPersonalObject(draft, "Asset", ids.asset, {
    name: "Example home",
    asset_type: "real_estate",
    owner_id: ids.household,
    acquisition_date: "2022-01-01",
    acquisition_cost: "350000.00",
    valuation_method: "cost",
  });
  draft = addPersonalObject(draft, "Liability", ids.liability, {
    name: "Example mortgage",
    liability_type: "mortgage",
    owner_id: ids.household,
    principal: "240000.00",
    current_balance: "235000.00",
    interest_rate: "0.0525",
    origination_date: "2022-01-01",
    maturity_date: "2052-01-01",
    collateral_id: ids.asset,
  });
  draft = addPersonalObject(draft, "Investment", ids.investment, {
    account_id: ids.account,
    investment_type: "fund",
    symbol: "DEMO",
    quantity: "0.0000",
  });
  draft = addPersonalObject(draft, "Scenario", ids.scenario, {
    name: "Current plan",
    start_date: "2026-01-01",
    end_date: "2036-01-01",
    timestep: "monthly",
    enabled: true,
    stochastic: false,
    simulation_count: 1,
    assumption_ids: [ids.assumption],
    event_ids: [],
  });
  draft = addPersonalObject(draft, "Assumption", ids.assumption, {
    name: "Salary growth",
    category: "salary_growth",
    value: "0.03",
    unit: "effective annual rate",
    scenario_id: ids.scenario,
  });
  return withObjects(draft, {
    ...draft.objects,
    PrimitiveInstance: Object.freeze([
      Object.freeze({
        primitive_instance_id: ids.primitive,
        primitive_id: "P08",
        input_bindings: Object.freeze({ rate: ids.assumption }),
        parameters: Object.freeze({}),
        scenario_id: ids.scenario,
        enabled: true,
      }),
    ]),
  });
};
