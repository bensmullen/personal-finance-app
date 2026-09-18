import { domainId } from "../identity/index.js";
import { ValidationError, type ValidationIssue } from "../diagnostics/index.js";
import {
  CURRENT_MODEL_FORMAT_VERSION,
  type JsonValue,
  type PortableModelEnvelope,
  type PortableModelObjects,
} from "../model/modelVersion.js";
import { CURRENT_RUN_VERSIONS } from "../model/version.js";
import { createRunContext, runId, scenarioId } from "../simulation/run.js";
import {
  compareVerticalSlice2Scenarios,
  compareVerticalSlice3Scenarios,
  compareVerticalSlice4Scenarios,
  type ScenarioComparisonResult,
} from "../simulation/scenario.js";
import { runVerticalSlice2 } from "../simulation/verticalSlice2.js";
import { runVerticalSlice3 } from "../simulation/verticalSlice3.js";
import { runVerticalSlice4 } from "../simulation/verticalSlice4.js";
import type { ConstraintOutcome } from "../funding/index.js";
import {
  instant,
  utcDateOnlyInstant,
  utcMonthDifference,
  utcMonthlyPeriods,
} from "../time/index.js";
import {
  Currency,
  Money,
  RoundingPolicy,
  formatMoney,
} from "../values/index.js";
import {
  compileCashFlow,
  compileCurrentPosition,
  compileInvestments,
  compileLiabilities,
  compileExecutableScenario,
  capability,
  type CapabilityDiagnostic,
  type InvestmentPurchaseExecutionInstruction,
  type InvestmentTransferExecutionInstruction,
  type LiabilityExecutionProfile,
  type ExecutableScenarioIntent,
  type RetirementTerminationBinding,
} from "./compiler/index.js";
import { PERSONAL_EDITOR_DESCRIPTOR } from "./editorDescriptor.generated.js";
export {
  exportPersonalModelJson,
  importPersonalModelJson,
  migratePersonalModelVersion,
  validatePersonalModelJson,
} from "./modelPortability.js";
export {
  deletePersistedPersonalModel,
  inspectPersistedPersonalModel,
  migratePersistedPersonalModel,
  readPersistedPersonalModelBackup,
  savePersonalModel,
  type PersistedPersonalModelState,
  type PersonalModelPersistencePort,
} from "./personalPersistence.js";

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
  readonly diagnostics: readonly (ValidationIssue | CapabilityDiagnostic)[];
}
export interface CurrentPositionRequest {
  readonly baseCurrency: string;
  readonly asOf: string;
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
  /** Present for VS4 liability liquidity outcomes; cash-flow obligations have no debt origin. */
  readonly origin?: "required_debt_service" | "extra_principal";
  readonly diagnostic: string;
}
export interface LiabilityOccurrenceReadModel {
  readonly liabilityId: string;
  readonly loanId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly scheduledAt: string;
  readonly openingPrincipal: MoneyReadModel;
  readonly contractualPayment: MoneyReadModel;
  readonly currentInterestExpense: MoneyReadModel;
  readonly scheduledPayment: MoneyReadModel;
  readonly scheduledPrincipalPaid: MoneyReadModel;
  readonly extraPrincipalPaid: MoneyReadModel;
  readonly endingPrincipal: MoneyReadModel;
  readonly outstandingInterest: MoneyReadModel;
  readonly scheduledFundingStatus: ConstraintOutcome["status"];
  readonly extraFundingStatus?: ConstraintOutcome["status"];
  readonly traceIds: readonly string[];
}
export interface LiabilityPeriodTotalReadModel {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly interestExpense: MoneyReadModel;
  readonly principalReduction: MoneyReadModel;
  readonly endingPrincipal: MoneyReadModel;
  readonly outstandingInterest: MoneyReadModel;
}
export interface LiabilityPayoffReadModel {
  readonly liabilityId: string;
  readonly loanId: string;
  readonly scheduledAt: string;
}
interface ForecastBoundary {
  readonly scope: "cash_flow" | "investments" | "liabilities";
  readonly asOf: string;
  readonly dataCutoff: string;
  readonly simulationStart: string;
  readonly simulationEnd: string;
  readonly actualHistoryAvailable: false;
  readonly diagnostics: readonly (ValidationIssue | CapabilityDiagnostic)[];
}
export interface UnavailablePersonalForecastReadModel extends ForecastBoundary {
  readonly status: "unavailable";
  readonly message: string;
}
export interface CashPersonalForecastReadModel extends ForecastBoundary {
  readonly scope: "cash_flow";
  readonly status: "completed" | "incomplete";
  readonly points: readonly ForecastPoint[];
  readonly shortfalls: readonly ShortfallReadModel[];
}
export interface LiabilityPersonalForecastReadModel extends ForecastBoundary {
  readonly scope: "liabilities";
  readonly status: "completed" | "incomplete";
  readonly shortfalls: readonly ShortfallReadModel[];
  readonly liabilityOccurrences: readonly LiabilityOccurrenceReadModel[];
  readonly liabilityPeriodTotals: readonly LiabilityPeriodTotalReadModel[];
  readonly liabilityPayoffs: readonly LiabilityPayoffReadModel[];
  readonly inactiveLiabilityIds: readonly string[];
}
export interface InvestmentAccountValueReadModel {
  readonly accountId: string;
  readonly value: MoneyReadModel;
}
export interface InvestmentForecastPoint {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly portfolioValue: MoneyReadModel;
  readonly contributionPrincipal: MoneyReadModel;
  readonly fees: MoneyReadModel;
  readonly unrealizedGain: MoneyReadModel;
  readonly realizedGain: MoneyReadModel;
  readonly cashInvestmentIncome: MoneyReadModel;
  readonly accountValues: readonly InvestmentAccountValueReadModel[];
  readonly traceIds: readonly string[];
}
export interface InvestmentPersonalForecastReadModel extends ForecastBoundary {
  readonly scope: "investments";
  readonly status: "completed" | "incomplete";
  readonly points: readonly InvestmentForecastPoint[];
}
export type PersonalForecastReadModel =
  | UnavailablePersonalForecastReadModel
  | CashPersonalForecastReadModel
  | LiabilityPersonalForecastReadModel
  | InvestmentPersonalForecastReadModel;
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
  readonly executionOwnerId?: string;
  readonly liabilityExecutionProfiles?: readonly LiabilityExecutionProfile[];
  readonly investmentTransferInstructions?: readonly InvestmentTransferExecutionInstruction[];
  readonly investmentPurchaseInstructions?: readonly InvestmentPurchaseExecutionInstruction[];
  readonly scenarioId?: string;
  readonly retirementBindings?: readonly RetirementTerminationBinding[];
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
  readonly metrics?: Readonly<
    Record<
      string,
      Readonly<{
        baseline: MoneyReadModel;
        alternative: MoneyReadModel;
        delta: MoneyReadModel;
      }>
    >
  >;
}
export interface PersonalScenarioComparisonReadModel {
  readonly status: "completed" | "incomplete" | "unavailable";
  readonly message?: string;
  readonly scope: "cash_flow" | "investments" | "liabilities";
  readonly baselineName: string;
  readonly alternativeName: string;
  readonly points: readonly ScenarioComparisonPoint[];
  readonly configurationDifferences: readonly Readonly<{
    target: string;
    kind: string;
    scenarioLayerId: string;
    assumptionIds: readonly string[];
    eventIds: readonly string[];
    configuredRuleIds: readonly string[];
    before: unknown;
    after: unknown;
  }>[];
  readonly appliedRuleDifferences: Readonly<{
    baselineOnly: readonly string[];
    alternativeOnly: readonly string[];
  }>;
  readonly diagnostics: readonly (ValidationIssue | CapabilityDiagnostic)[];
  readonly baselineScenarioId?: string;
  readonly alternativeScenarioId?: string;
  readonly comparedThrough?: string;
  readonly alternatives?: readonly Readonly<{
    scenarioId: string;
    name: string;
    status: "completed" | "incomplete";
    comparedThrough?: string;
    points: readonly ScenarioComparisonPoint[];
    configurationDifferences: readonly Readonly<Record<string, unknown>>[];
    appliedRuleDifferences: Readonly<{
      baselineOnly: readonly string[];
      alternativeOnly: readonly string[];
    }>;
  }>[];
}

export interface PersonalScenarioComparisonRequest {
  readonly scope: "cash_flow" | "investments" | "liabilities";
  readonly baselineScenarioId?: string;
  readonly baselineName?: string;
  readonly alternatives: readonly ExecutableScenarioIntent[];
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
    valuation_method: "cost",
  });
  return addPersonalObject(draft, "Liability", input.liabilityId, {
    name: "Debt",
    owner_id: input.householdId,
    principal: input.debt,
    current_balance: input.debt,
    origination_date: input.startDate,
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
  request: CurrentPositionRequest,
): CurrentPositionReadModel => {
  const result = compileCurrentPosition(draft, {
    baseCurrency: request.baseCurrency,
    asOf: request.asOf,
  });
  if (result.status !== "compiled")
    return deepFreeze({
      unavailable: result.diagnostics.map((diagnostic) => diagnostic.message),
      diagnostics: result.diagnostics,
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
    diagnostics: value.diagnostics,
  });
};

const forecastBoundary = (request: ForecastRequest): ForecastBoundary => ({
  scope: request.scope,
  asOf: request.asOf,
  dataCutoff: request.dataCutoff,
  simulationStart: request.simulationStart,
  simulationEnd: request.simulationEnd,
  actualHistoryAvailable: false,
  diagnostics: [],
});
const unavailableForecast = (
  request: ForecastRequest,
  message: string,
  diagnostics: readonly (ValidationIssue | CapabilityDiagnostic)[] = [],
): PersonalForecastReadModel =>
  deepFreeze({
    ...forecastBoundary(request),
    status: "unavailable" as const,
    message,
    diagnostics,
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

/** Guided setup must provide a canonical UTC month boundary to VS2. */
export const isForecastStartDate = (value: string): boolean =>
  utcDateOnlyInstant(value) !== undefined && value.endsWith("-01");

export const runPersonalForecast = (
  draft: PersonalDraft,
  request: ForecastRequest,
): PersonalForecastReadModel => {
  if (request.scope === "investments") {
    if (!request.executionOwnerId)
      return unavailableForecast(
        request,
        "Investment forecast requires an explicit executionOwnerId.",
        [
          capability(
            "INVESTMENT_EXECUTION_OWNER_REQUIRED",
            "Investment forecast requires an explicit Household-member execution owner.",
            "investment_forecast",
            "InvestmentCompilerRequest",
            undefined,
            "executionOwnerId",
          ),
        ],
      );
    try {
      const compilation = compileInvestments(draft, {
        baseCurrency: request.baseCurrency,
        asOf: request.asOf,
        simulationStart: request.simulationStart,
        simulationEnd: request.simulationEnd,
        months: request.months,
        executionOwnerId: request.executionOwnerId,
        transferInstructions: request.investmentTransferInstructions ?? [],
        purchaseInstructions: request.investmentPurchaseInstructions ?? [],
        ...(request.scenarioId === undefined
          ? {}
          : { scenarioId: request.scenarioId }),
      });
      if (compilation.status !== "compiled")
        return unavailableForecast(
          request,
          compilation.diagnostics.map((value) => value.message).join("; "),
          compilation.diagnostics,
        );
      const compiled = compilation.value;
      const runContext = createRunContext({
        runId: runId(cryptoSafeRunId(draft.modelId)),
        scenarioId: scenarioId(compiled.scenarioIdentity),
        asOf: iso(request.asOf),
        dataCutoff: iso(request.dataCutoff),
        simulationStart: iso(request.simulationStart),
        simulationEnd: iso(request.simulationEnd),
        baseCurrency: Currency.of(request.baseCurrency),
      });
      const result = runVerticalSlice3({
        runContext,
        input: compiled.input,
        openingState: compiled.openingState,
        primitiveState: compiled.primitiveState,
        months: compiled.executionMonths,
      });
      return deepFreeze({
        ...forecastBoundary(request),
        scope: "investments" as const,
        status: result.status,
        asOf: runContext.asOf,
        points: result.periods.map((period) => ({
          periodStart: period.period.start,
          periodEnd: period.period.end,
          portfolioValue: moneyDto(period.portfolioValue),
          contributionPrincipal: moneyDto(period.contributionPrincipal),
          fees: moneyDto(period.fees),
          unrealizedGain: moneyDto(period.unrealizedGain),
          realizedGain: moneyDto(period.realizedGain),
          cashInvestmentIncome: moneyDto(period.cashInvestmentIncome),
          accountValues: Object.entries(period.accountValues)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([accountId, value]) => ({
              accountId,
              value: moneyDto(value),
            })),
          traceIds: Object.freeze(
            [
              ...new Set((period.traceRefs ?? []).map((ref) => ref.traceId)),
            ].sort(),
          ),
        })),
        diagnostics: result.diagnostics,
      });
    } catch (error) {
      if (error instanceof ValidationError)
        return unavailableForecast(
          request,
          error.issues.map((value) => value.message).join("; "),
          error.issues,
        );
      return unavailableForecast(
        request,
        "Investment model could not be translated safely.",
      );
    }
  }
  if (request.scope === "liabilities") {
    if (!request.executionOwnerId)
      return unavailableForecast(
        request,
        "Liability forecast requires an explicit executionOwnerId.",
        [
          capability(
            "LIABILITY_EXECUTION_OWNER_REQUIRED",
            "Liability forecast requires an explicit Household-member execution owner.",
            "liability_forecast",
            "LiabilityExecutionProfile",
            undefined,
            "executionOwnerId",
          ),
        ],
      );
    try {
      const compilation = compileLiabilities(draft, {
        baseCurrency: request.baseCurrency,
        asOf: request.asOf,
        simulationStart: request.simulationStart,
        simulationEnd: request.simulationEnd,
        months: request.months,
        executionOwnerId: request.executionOwnerId,
        executionProfiles: request.liabilityExecutionProfiles ?? [],
        ...(request.scenarioId === undefined
          ? {}
          : { scenarioId: request.scenarioId }),
      });
      if (compilation.status !== "compiled")
        return unavailableForecast(
          request,
          compilation.diagnostics.map((value) => value.message).join("; "),
          compilation.diagnostics,
        );
      const compiled = compilation.value;
      if (compiled.input.loans.length === 0)
        return deepFreeze({
          ...forecastBoundary(request),
          scope: "liabilities" as const,
          status: "completed" as const,
          asOf: iso(request.asOf),
          actualHistoryAvailable: false as const,
          shortfalls: [],
          liabilityOccurrences: [],
          liabilityPeriodTotals: [],
          liabilityPayoffs: [],
          inactiveLiabilityIds: compiled.inactiveLiabilityIds,
          diagnostics: compiled.capabilityDiagnostics,
        });
      const currency = Currency.of(request.baseCurrency);
      const runContext = createRunContext({
        runId: runId(cryptoSafeRunId(draft.modelId)),
        scenarioId: scenarioId(compiled.scenarioIdentity),
        asOf: iso(request.asOf),
        dataCutoff: iso(request.dataCutoff),
        simulationStart: iso(request.simulationStart),
        simulationEnd: iso(request.simulationEnd),
        baseCurrency: currency,
      });
      const result = runVerticalSlice4({
        runContext,
        input: compiled.input,
        openingState: compiled.openingState,
        primitiveState: compiled.primitiveState,
        months: compiled.executionMonths,
      });
      const occurrences = result.periods.flatMap((period) =>
        period.liabilities.map((value) => {
          return {
            liabilityId: compiled.input.loans.find(
              (loan) => loan.id === value.loanId,
            )!.principalLiabilityId,
            loanId: value.loanId,
            periodStart: period.period.start,
            periodEnd: period.period.end,
            scheduledAt: value.scheduledAt,
            openingPrincipal: moneyDto(value.openingPrincipal),
            contractualPayment: moneyDto(value.contractualPayment),
            currentInterestExpense: moneyDto(value.currentInterest),
            scheduledPayment: moneyDto(value.scheduledPayment),
            scheduledPrincipalPaid: moneyDto(value.scheduledPrincipalPaid),
            extraPrincipalPaid: moneyDto(value.extraPrincipalPaid),
            endingPrincipal: moneyDto(value.endingPrincipal),
            outstandingInterest: moneyDto(value.outstandingInterest),
            scheduledFundingStatus: value.scheduledFundingStatus,
            ...(value.extraFundingStatus === undefined ? {} : { extraFundingStatus: value.extraFundingStatus }),
            traceIds: Object.freeze(value.traceRefs.map((ref) => ref.traceId).sort()),
          };
        }),
      );
      const payoffs = compiled.input.loans.flatMap((loan) => {
        const point = result.periods.flatMap((period) => period.liabilities).find((value) => value.loanId === loan.id && value.endingPrincipal.isZero() && value.outstandingInterest.isZero());
        return point === undefined ? [] : [{ liabilityId: loan.principalLiabilityId, loanId: loan.id, scheduledAt: point.scheduledAt }];
      });
      const shortfalls = result.periods.flatMap((period) => period.liquidityShortfalls.map((shortfall) => ({
        period: period.period.start,
        entityId: "claimId" in shortfall ? shortfall.claimId : shortfall.claimIds.join(","),
        required: moneyDto(shortfall.requestedAmount),
        available: moneyDto(shortfall.fundedAmount),
        unfunded: moneyDto(shortfall.shortfallAmount),
        origin: shortfall.origin,
        diagnostic: shortfall.origin === "required_debt_service"
          ? "Insufficient modeled liquidity; required contractual debt service was not funded."
          : "Insufficient modeled liquidity; optional extra principal was not funded. This is not a missed contractual payment.",
      })));
      return deepFreeze({
        ...forecastBoundary(request),
        scope: "liabilities" as const,
        status: result.status,
        asOf: runContext.asOf,
        shortfalls,
        liabilityOccurrences: occurrences,
        liabilityPeriodTotals: result.periods.map((period) => ({
          periodStart: period.period.start,
          periodEnd: period.period.end,
          interestExpense: moneyDto(period.interestExpense),
          principalReduction: moneyDto(period.principalReduction),
          endingPrincipal: moneyDto(period.endingPrincipal),
          outstandingInterest: moneyDto(period.outstandingInterest),
        })),
        liabilityPayoffs: payoffs,
        inactiveLiabilityIds: compiled.inactiveLiabilityIds,
        diagnostics: Object.freeze([
          ...compiled.capabilityDiagnostics,
          ...result.diagnostics,
        ]),
      });
    } catch (error) {
      if (error instanceof ValidationError)
        return unavailableForecast(
          request,
          error.issues.map((value) => value.message).join("; "),
          error.issues,
        );
      return unavailableForecast(
        request,
        "Liability model could not be translated safely.",
      );
    }
  }
  try {
    const currency = Currency.of(request.baseCurrency);
    const start = iso(request.simulationStart);
    const compilation = compileCashFlow(draft, {
      baseCurrency: request.baseCurrency,
      simulationStart: request.simulationStart,
      simulationEnd: request.simulationEnd,
      sameInstantCashFlowOrder: request.sameInstantCashFlowOrder,
      months: request.months,
      ...(request.scenarioId === undefined
        ? {}
        : { scenarioId: request.scenarioId }),
      ...(request.retirementBindings === undefined ? {} : { retirementBindings: request.retirementBindings }),
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
      months: compilation.value.executionMonths,
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

/** Generic, scope-specific scenario comparison. It never composes slice results. */
export const comparePersonalScenarios = (
  draft: PersonalDraft,
  request: ForecastRequest,
  comparisonRequest: PersonalScenarioComparisonRequest,
): PersonalScenarioComparisonReadModel => {
  const unavailable = (
    message: string,
    diagnostics: readonly (ValidationIssue | CapabilityDiagnostic)[] = [],
  ): PersonalScenarioComparisonReadModel =>
    deepFreeze({
      status: "unavailable",
      message,
      scope: comparisonRequest.scope,
      baselineName: comparisonRequest.baselineName ?? "Current plan",
      alternativeName: comparisonRequest.alternatives[0]?.name ?? "Alternative",
      points: [],
      configurationDifferences: [],
      appliedRuleDifferences: { baselineOnly: [], alternativeOnly: [] },
      diagnostics,
    });
  if (request.scope !== comparisonRequest.scope)
    return unavailable("Forecast and comparison scopes must match.", [
      capability(
        "SCENARIO_SCOPE_UNSUPPORTED",
        "Forecast and comparison scopes must match.",
        "scenario_comparison",
      ),
    ]);
  if (comparisonRequest.alternatives.length === 0)
    return unavailable("At least one explicit alternative is required.");
  try {
    const common = {
      baseCurrency: request.baseCurrency,
      simulationStart: request.simulationStart,
      simulationEnd: request.simulationEnd,
      months: request.months,
      ...(comparisonRequest.baselineScenarioId === undefined
        ? {}
        : { scenarioId: comparisonRequest.baselineScenarioId }),
    };
    let base: Parameters<typeof compileExecutableScenario>[1];
    let comparison: ScenarioComparisonResult;
    let executionMonths: number;
    let compilerCapabilityDiagnostics: readonly CapabilityDiagnostic[] = Object.freeze([]);
    const horizon = {
      start: iso(request.simulationStart),
      end: iso(request.simulationEnd),
    };
    const currency = Currency.of(request.baseCurrency);
    const context = {
      asOf: iso(request.asOf),
      dataCutoff: iso(request.dataCutoff),
      simulationStart: horizon.start,
      simulationEnd: horizon.end,
      baseCurrency: currency,
      versions: CURRENT_RUN_VERSIONS,
    };
    const compileCatalog = (scenarioIdentity: string) => {
      const root = compileExecutableScenario(draft, base, horizon, {
        scenarioId: scenarioIdentity,
        name: comparisonRequest.baselineName ?? "Current plan",
        changes: [],
      });
      if (root.status !== "compiled") return root;
      const availableParents = new Set([
        scenarioIdentity,
        ...comparisonRequest.alternatives.map((item) => item.scenarioId),
      ].map((id) => id.toLowerCase()));
      const alternatives = comparisonRequest.alternatives.map((alternative) => {
        const normalizedAlternative = alternative.baseScenarioId === undefined
          ? { ...alternative, baseScenarioId: scenarioIdentity }
          : alternative;
        if (
          !availableParents.has(normalizedAlternative.baseScenarioId!.toLowerCase())
        )
          return {
            status: "unsupported" as const,
            diagnostics: Object.freeze([
              capability(
                "SCENARIO_BASE_BINDING_MISMATCH",
                `Alternative ${alternative.scenarioId} must explicitly inherit from the root or another supplied alternative.`,
                `${comparisonRequest.scope}_scenario_comparison`,
                "Scenario",
                alternative.scenarioId,
                "baseScenarioId",
              ),
            ]),
          };
        return compileExecutableScenario(draft, base, horizon, normalizedAlternative);
      });
      const failed = alternatives.find((item) => item.status !== "compiled");
      return (
        failed ?? {
          status: "compiled" as const,
          value: [
            root.value,
            ...alternatives.map((item) =>
              item.status === "compiled" ? item.value : root.value,
            ),
          ],
          diagnostics: Object.freeze([]),
        }
      );
    };
    if (comparisonRequest.scope === "cash_flow") {
      const compiled = compileCashFlow(draft, {
        ...common,
        sameInstantCashFlowOrder: request.sameInstantCashFlowOrder,
        ...(request.retirementBindings === undefined
          ? {}
          : { retirementBindings: request.retirementBindings }),
      });
      if (compiled.status !== "compiled")
        return unavailable(
          compiled.diagnostics.map((item) => item.message).join("; "),
          compiled.diagnostics,
        );
      base = { scope: "cash_flow", compiled: compiled.value };
      executionMonths = compiled.value.executionMonths;
      const catalog = compileCatalog(compiled.value.scenarioIdentity);
      if (catalog.status !== "compiled")
        return unavailable(
          catalog.diagnostics.map((item) => item.message).join("; "),
          catalog.diagnostics,
        );
      const runIds = Object.fromEntries(
        catalog.value.map((scenario, index) => [
          scenario.scenarioId,
          runId(
            `d1900000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          ),
        ]),
      );
      comparison = compareVerticalSlice2Scenarios({
        scenarios: catalog.value,
        baselineScenarioId: catalog.value[0]!.scenarioId,
        alternativeScenarioIds: catalog.value
          .slice(1)
          .map((item) => item.scenarioId),
        runIds,
        runContext: context,
        openingState: compiled.value.openingState,
        input: compiled.value.input,
        months: executionMonths,
      });
    } else if (comparisonRequest.scope === "investments") {
      if (!request.executionOwnerId)
        return unavailable(
          "Investment comparison requires an explicit execution owner.",
        );
      const compilerRequest = {
        ...common,
        asOf: request.asOf,
        executionOwnerId: request.executionOwnerId,
        transferInstructions: request.investmentTransferInstructions ?? [],
        purchaseInstructions: request.investmentPurchaseInstructions ?? [],
      };
      const compiled = compileInvestments(draft, compilerRequest);
      if (compiled.status !== "compiled")
        return unavailable(
          compiled.diagnostics.map((item) => item.message).join("; "),
          compiled.diagnostics,
        );
      base = {
        scope: "investments",
        compiled: compiled.value,
        compilerRequest,
      };
      executionMonths = compiled.value.executionMonths;
      const catalog = compileCatalog(compiled.value.scenarioIdentity);
      if (catalog.status !== "compiled")
        return unavailable(
          catalog.diagnostics.map((item) => item.message).join("; "),
          catalog.diagnostics,
        );
      const runIds = Object.fromEntries(
        catalog.value.map((scenario, index) => [
          scenario.scenarioId,
          runId(
            `d1910000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          ),
        ]),
      );
      comparison = compareVerticalSlice3Scenarios({
        scenarios: catalog.value,
        baselineScenarioId: catalog.value[0]!.scenarioId,
        alternativeScenarioIds: catalog.value
          .slice(1)
          .map((item) => item.scenarioId),
        runIds,
        runContext: context,
        openingState: compiled.value.openingState,
        input: compiled.value.input,
        months: executionMonths,
        primitiveState: compiled.value.primitiveState,
      });
    } else {
      if (!request.executionOwnerId)
        return unavailable(
          "Liability comparison requires an explicit execution owner.",
        );
      const compilerRequest = {
        ...common,
        asOf: request.asOf,
        executionOwnerId: request.executionOwnerId,
        executionProfiles: request.liabilityExecutionProfiles ?? [],
      };
      const compiled = compileLiabilities(draft, compilerRequest);
      if (compiled.status !== "compiled")
        return unavailable(
          compiled.diagnostics.map((item) => item.message).join("; "),
          compiled.diagnostics,
        );
      base = {
        scope: "liabilities",
        compiled: compiled.value,
        compilerRequest,
      };
      compilerCapabilityDiagnostics = compiled.value.capabilityDiagnostics;
      executionMonths = compiled.value.executionMonths;
      const catalog = compileCatalog(compiled.value.scenarioIdentity);
      if (catalog.status !== "compiled")
        return unavailable(
          catalog.diagnostics.map((item) => item.message).join("; "),
          catalog.diagnostics,
        );
      const runIds = Object.fromEntries(
        catalog.value.map((scenario, index) => [
          scenario.scenarioId,
          runId(
            `d1920000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          ),
        ]),
      );
      comparison = compareVerticalSlice4Scenarios({
        scenarios: catalog.value,
        baselineScenarioId: catalog.value[0]!.scenarioId,
        alternativeScenarioIds: catalog.value
          .slice(1)
          .map((item) => item.scenarioId),
        runIds,
        runContext: context,
        openingState: compiled.value.openingState,
        input: compiled.value.input,
        months: executionMonths,
        primitiveState: compiled.value.primitiveState,
      });
    }
    const preferredMetric =
      comparisonRequest.scope === "cash_flow"
        ? "endingCash"
        : comparisonRequest.scope === "investments"
          ? "portfolioValue"
          : "endingPrincipal";
    const alternatives = comparison.alternatives.map(
      (alternative, alternativeIndex) => {
        const points = comparison.baseline.points
          .slice(0, alternative.deltas.length)
          .map((baselinePoint, index) => {
            const alternativePoint = alternative.scenario.points[index]!;
            const deltaPoint = alternative.deltas[index]!;
            const keys = [
              ...new Set([
                ...Object.keys(baselinePoint.metrics),
                ...Object.keys(alternativePoint.metrics),
              ]),
            ].sort();
            const metrics = Object.fromEntries(
              keys.map((key) => [
                key,
                {
                  baseline: moneyDto(baselinePoint.metrics[key]!),
                  alternative: moneyDto(alternativePoint.metrics[key]!),
                  delta: moneyDto(
                    alternativePoint.metrics[key]!.minus(
                      baselinePoint.metrics[key]!,
                    ),
                  ),
                },
              ]),
            );
            return {
              period: baselinePoint.period.start,
              baseline: metrics[preferredMetric]!.baseline,
              alternative: metrics[preferredMetric]!.alternative,
              delta: metrics[preferredMetric]!.delta,
              metrics: Object.freeze(metrics),
              traceIds: Object.freeze(
                deltaPoint.traceRefs.map((ref) => ref.traceId),
              ),
              relatedDifferenceIds: deltaPoint.relatedDifferenceIds,
            };
          });
        return {
          scenarioId: alternative.scenario.scenarioId,
          name: comparisonRequest.alternatives[alternativeIndex]!.name,
          status: alternative.scenario.status,
          ...(alternative.comparedThrough === undefined
            ? {}
            : { comparedThrough: alternative.comparedThrough }),
          points,
          configurationDifferences: alternative.differences.map(
            (difference) => ({
              target: difference.semanticTarget,
              kind: difference.changeKind,
              scenarioLayerId: difference.scenarioLayerId,
              assumptionIds: difference.assumptionIds,
              eventIds: difference.eventIds,
              configuredRuleIds: difference.configuredRuleIds,
              before: difference.before,
              after: difference.after,
            }),
          ),
          appliedRuleDifferences: alternative.appliedRuleDifferences,
        };
      },
    );
    const first = alternatives[0]!;
    return deepFreeze({
      status:
        comparison.baseline.status === "completed" &&
        alternatives.every((item) => item.status === "completed")
          ? "completed"
          : "incomplete",
      scope: comparisonRequest.scope,
      baselineName: comparisonRequest.baselineName ?? "Current plan",
      alternativeName: first.name,
      baselineScenarioId: comparison.baseline.scenarioId,
      alternativeScenarioId: first.scenarioId,
      ...(first.comparedThrough === undefined
        ? {}
        : { comparedThrough: first.comparedThrough }),
      points: first.points,
      configurationDifferences: first.configurationDifferences,
      appliedRuleDifferences: first.appliedRuleDifferences,
      alternatives,
      diagnostics: Object.freeze([
        ...compilerCapabilityDiagnostics,
        ...comparison.baseline.diagnostics,
        ...comparison.alternatives.flatMap((item) => item.scenario.diagnostics),
      ]),
    });
  } catch (error) {
    if (error instanceof ValidationError)
      return unavailable(
        error.issues.map((item) => item.message).join("; "),
        error.issues,
      );
    return unavailable(
      error instanceof Error
        ? error.message
        : "Scenario comparison could not be executed safely.",
    );
  }
};

/** Compatibility wrapper for the original cash-flow income-growth starter. */
export const comparePersonalCashFlowPlans = (
  draft: PersonalDraft,
  request: ForecastRequest,
  annualIncomeGrowth: string,
  incomeId?: string,
): PersonalScenarioComparisonReadModel => {
  const unavailable = (message: string, diagnostics: readonly CapabilityDiagnostic[] = []): PersonalScenarioComparisonReadModel => deepFreeze({ status: "unavailable", message, scope: "cash_flow", baselineName: "Current plan", alternativeName: "Income growth alternative", points: [], configurationDifferences: [], appliedRuleDifferences: { baselineOnly: [], alternativeOnly: [] }, diagnostics });
  if (!EXACT_DECIMAL.test(annualIncomeGrowth)) return unavailable("Income growth must be an exact decimal string.");
  const incomes = entries(draft, "Income");
  if (incomeId === undefined) return unavailable("Plan comparison requires an explicit Income target.", [capability("SCENARIO_TARGET_MISSING", "Plan comparison requires an explicit Income target.", "cash_flow_comparison", "Income")]);
  const income = incomes.find((item) => typeof item.income_id === "string" && item.income_id.toLowerCase() === incomeId.toLowerCase());
  if (!income) return unavailable(`Income ${incomeId} is outside the compiled scope.`, [capability("SCENARIO_TARGET_UNEXECUTABLE", `Income ${incomeId} is outside the compiled scope.`, "cash_flow_comparison", "Income", incomeId)]);
  return comparePersonalScenarios(draft, request, {
    scope: "cash_flow",
    alternatives: [
      {
        scenarioId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
        name: `Income grows ${annualIncomeGrowth}`,
        changes: [
          {
            kind: "income_growth",
            incomeId: String(income.income_id),
            annualRate: annualIncomeGrowth,
          },
        ],
      },
    ],
  });
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
    // Matches the no-recast P22/VS4 balance at the synthetic opening boundary.
    current_balance: "225669.71",
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
