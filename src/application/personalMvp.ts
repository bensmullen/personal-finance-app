import { createFundingPolicy, fundingPolicyId } from "../funding/index.js";
import { domainId } from "../identity/index.js";
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
import {
  runVerticalSlice2,
  type VerticalSlice2Input,
} from "../simulation/verticalSlice2.js";
import { createAuthoritativeState } from "../state/index.js";
import { deriveStatements } from "../statements/index.js";
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
  money,
  rateConvention,
  sumMoney,
} from "../values/index.js";
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
  readonly diagnostics: readonly string[];
}
export interface ForecastRequest {
  readonly scope: "cash_flow" | "investments" | "liabilities";
  readonly baseCurrency: string;
  readonly asOf: string;
  readonly dataCutoff: string;
  readonly simulationStart: string;
  readonly simulationEnd: string;
  readonly months: number;
}
export interface PersonalSessionSettings {
  readonly baseCurrency: string;
  readonly asOf: string;
  readonly dataCutoff: string;
  readonly simulationStart: string;
  readonly simulationEnd: string;
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
const readMoney = (
  value: JsonValue | undefined,
  currency: Currency,
): Money | undefined =>
  typeof value === "string" && EXACT_DECIMAL.test(value)
    ? money(value, currency)
    : undefined;
const sumField = (
  objects: readonly JsonObject[],
  field: string,
  currency: Currency,
): Money | undefined => {
  const values = objects.map((object) => readMoney(object[field], currency));
  return values.some((value) => value === undefined)
    ? undefined
    : sumMoney(values as Money[], currency);
};

export const getCurrentPosition = (
  draft: PersonalDraft,
  currencyCode = "USD",
): CurrentPositionReadModel => {
  const currency = Currency.of(currencyCode);
  const accountObjects = entries(draft, "Account");
  const liabilityObjects = entries(draft, "Liability");
  const monthlyIncome = sumField(
    entries(draft, "Income").filter((value) => value.frequency === "monthly"),
    "amount",
    currency,
  );
  const monthlySpending = sumField(
    entries(draft, "Expense").filter((value) => value.frequency === "monthly"),
    "amount",
    currency,
  );
  const unavailable: string[] = [];
  const hasIncompatibleAccountCurrency = accountObjects.some(
    (item) => item.currency !== currency.code,
  );
  const hasIncompatibleLiabilityCurrency = liabilityObjects.some((item) =>
    ["currency", "current_balance_currency"].some(
      (field) =>
        typeof item[field] === "string" && item[field] !== currency.code,
    ),
  );
  const hasMixedCurrencyCurrentPosition =
    hasIncompatibleAccountCurrency || hasIncompatibleLiabilityCurrency;
  if (hasMixedCurrencyCurrentPosition)
    unavailable.push(
      "Mixed-currency current position requires FX semantics not implemented in PR 14.",
    );
  const exactStateInputs =
    !hasMixedCurrencyCurrentPosition &&
    accountObjects.every((item) => readMoney(item.opening_balance, currency)) &&
    liabilityObjects.every((item) => readMoney(item.current_balance, currency));
  const state = exactStateInputs
    ? createAuthoritativeState({
        accounts: Object.fromEntries(
          accountObjects.map((item) => {
            const id = domainId("account", String(item.account_id));
            const canonicalKinds = [
              "checking",
              "savings",
              "cash",
              "brokerage",
              "retirement",
            ];
            const kind = canonicalKinds.includes(String(item.account_type))
              ? (String(item.account_type) as
                  | "checking"
                  | "savings"
                  | "cash"
                  | "brokerage"
                  | "retirement")
              : "other";
            return [
              id,
              { id, kind, cash: readMoney(item.opening_balance, currency)! },
            ];
          }),
        ),
        liabilities: Object.fromEntries(
          liabilityObjects.map((item) => {
            const id = domainId("liability", String(item.liability_id));
            return [
              id,
              { id, balance: readMoney(item.current_balance, currency)! },
            ];
          }),
        ),
      })
    : undefined;
  const statements = state ? deriveStatements(state, [], currency) : undefined;
  const hasUntranslatedHoldings =
    entries(draft, "Asset").length > 0 ||
    entries(draft, "Investment").length > 0;
  const cash = statements?.assets;
  const liabilities = statements?.liabilities;
  const assets = hasUntranslatedHoldings ? undefined : statements?.assets;
  const netWorth = hasUntranslatedHoldings ? undefined : statements?.netWorth;
  const monthlyCashFlow =
    monthlyIncome && monthlySpending
      ? monthlyIncome.minus(monthlySpending)
      : undefined;
  if (!netWorth)
    unavailable.push(
      "Net worth needs exact current values in one supported currency.",
    );
  if (!monthlyCashFlow)
    unavailable.push(
      "Monthly cash flow needs monthly income and spending values.",
    );
  return deepFreeze({
    ...(netWorth ? { netWorth: moneyDto(netWorth) } : {}),
    ...(cash ? { cash: moneyDto(cash) } : {}),
    ...(assets ? { assets: moneyDto(assets) } : {}),
    ...(liabilities ? { liabilities: moneyDto(liabilities) } : {}),
    ...(monthlyIncome ? { monthlyIncome: moneyDto(monthlyIncome) } : {}),
    ...(monthlySpending ? { monthlySpending: moneyDto(monthlySpending) } : {}),
    ...(monthlyCashFlow ? { monthlyCashFlow: moneyDto(monthlyCashFlow) } : {}),
    unavailable,
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
  });
};

const hasReference = (value: JsonValue | undefined): boolean =>
  value !== undefined && value !== null && value !== "";
const portableObjectLabel = (type: "Income" | "Expense", item: JsonObject) =>
  String(item.source ?? item.category ?? item[`${type.toLowerCase()}_id`]);
const unsupportedCashFlowSemantics = (
  incomes: readonly JsonObject[],
  expenses: readonly JsonObject[],
): string | undefined => {
  const incomeField = [
    "growth_model_id",
    "probability_model_id",
    "related_event_id",
  ] as const;
  for (const income of incomes) {
    const field = incomeField.find((name) => hasReference(income[name]));
    if (field)
      return `Income \"${portableObjectLabel("Income", income)}\" references ${field}; this cash-flow forecast cannot interpret that authored behavior.`;
  }
  const expenseField = ["growth_model_id", "event_trigger_id"] as const;
  for (const expense of expenses) {
    const field = expenseField.find((name) => hasReference(expense[name]));
    if (field)
      return `Expense \"${portableObjectLabel("Expense", expense)}\" references ${field}; this cash-flow forecast cannot interpret that authored behavior.`;
  }
  return undefined;
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
  const households = entries(draft, "Household");
  const people = entries(draft, "Person");
  const accounts = entries(draft, "Account");
  const incomes = entries(draft, "Income");
  const expenses = entries(draft, "Expense");
  const cashAccount = accounts.find((account) =>
    ["cash", "checking", "savings"].includes(String(account.account_type)),
  );
  if (
    !households[0] ||
    !people[0] ||
    !cashAccount ||
    incomes.length === 0 ||
    expenses.length === 0
  )
    return unavailableForecast(
      request,
      "Cash-flow forecast needs a household, person, cash account, income, and spending item.",
    );
  if ([...incomes, ...expenses].some((item) => item.frequency !== "monthly"))
    return unavailableForecast(
      request,
      "Only monthly portable income and spending can be translated without guessing timing.",
    );
  const unsupportedSemantics = unsupportedCashFlowSemantics(incomes, expenses);
  if (unsupportedSemantics)
    return unavailableForecast(request, unsupportedSemantics);
  if (
    expenses.some(
      (expense) => expense.payment_account_id !== cashAccount.account_id,
    )
  )
    return unavailableForecast(
      request,
      "Every spending item needs the selected cash account as its funding account.",
    );
  try {
    if (cashAccount.currency !== request.baseCurrency)
      return unavailableForecast(
        request,
        "Cash-flow forecast requires the selected cash account currency to match the session base currency.",
      );
    const currency = Currency.of(request.baseCurrency);
    const householdId = domainId(
      "household",
      String(households[0].household_id),
    );
    const personId = domainId("person", String(people[0].person_id));
    const cashId = domainId("account", String(cashAccount.account_id));
    const payableId = domainId(
      "liability",
      "ffffffff-ffff-4fff-8fff-fffffffffff1",
    );
    const start = iso(request.simulationStart);
    const periods = utcMonthlyPeriods(start, request.months);
    const runContext = createRunContext({
      runId: runId(cryptoSafeRunId(draft.modelId)),
      scenarioId: scenarioId("ffffffff-ffff-4fff-8fff-fffffffffff2"),
      asOf: iso(request.asOf),
      dataCutoff: iso(request.dataCutoff),
      simulationStart: start,
      simulationEnd: iso(request.simulationEnd),
      baseCurrency: currency,
    });
    const primitive = (index: number) =>
      domainId(
        "primitive-instance",
        `eeeeeeee-eeee-4eee-8eee-${index.toString().padStart(12, "0")}`,
      );
    const funding = createFundingPolicy({
      id: fundingPolicyId(`personal-mvp:${cashId}`),
      orderedSources: [{ kind: "cash_account", accountId: cashId }],
      allowPartial: false,
      insufficientFundsBehavior: "unfunded",
    });
    const input: VerticalSlice2Input = {
      householdId,
      ownerId: personId,
      cashAccountId: cashId,
      expensePayableLiabilityId: payableId,
      baseCurrency: currency,
      sameInstantCashFlowOrder: "income_before_expense",
      events: [],
      incomes: incomes.map((item, index) => ({
        id: domainId("income", String(item.income_id)),
        ownerId:
          String(item.owner_id) === householdId
            ? householdId
            : domainId("person", String(item.owner_id)),
        depositAccountId: cashId,
        baseMonthlyAmount: money(String(item.amount), currency),
        start: iso(String(item.start_date)),
        ...(typeof item.end_date === "string"
          ? { end: iso(item.end_date) }
          : {}),
        recurrence: {
          kind: "utc_monthly",
          anchor: iso(String(item.start_date)),
          invalidDayPolicy: "skip",
        },
        growthRate: Rate.fromDecimal("0", rateConvention.effectiveAnnual()),
        growthBaseAt: iso(String(item.start_date)),
        primitiveIds: {
          growth: primitive(index * 4 + 1),
          recurrence: primitive(index * 4 + 2),
        },
      })),
      expenses: expenses.map((item, index) => ({
        id: domainId("expense", String(item.expense_id)),
        ownerId:
          String(item.owner_id) === householdId
            ? householdId
            : domainId("person", String(item.owner_id)),
        paymentAccountId: cashId,
        payableLiabilityId: payableId,
        baseMonthlyAmount: money(String(item.amount), currency),
        start: iso(String(item.start_date)),
        ...(typeof item.end_date === "string"
          ? { end: iso(item.end_date) }
          : {}),
        recurrence: {
          kind: "utc_monthly",
          anchor: iso(String(item.start_date)),
          invalidDayPolicy: "skip",
        },
        inflationRate: Rate.fromDecimal("0", rateConvention.effectiveAnnual()),
        inflationBaseAt: iso(String(item.start_date)),
        fundingPolicy: funding,
        settlementPriority: index + 1,
        primitiveIds: {
          indexGrowth: primitive(500 + index * 4 + 1),
          inflationLink: primitive(500 + index * 4 + 2),
          recurrence: primitive(500 + index * 4 + 3),
        },
      })),
    };
    const opening = createAuthoritativeState({
      accounts: {
        [cashId]: {
          id: cashId,
          kind: "checking",
          ownerId: personId,
          cash: money(String(cashAccount.opening_balance), currency),
        },
      },
      liabilities: {
        [payableId]: { id: payableId, balance: money("0", currency) },
      },
    });
    const result = runVerticalSlice2({
      runContext,
      openingState: opening,
      input,
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
      diagnostics: result.diagnostics.map((issue) => issue.message),
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
  const household = entries(draft, "Household")[0];
  const person = entries(draft, "Person")[0];
  const accounts = entries(draft, "Account");
  const incomes = entries(draft, "Income");
  const expenses = entries(draft, "Expense");
  const cashAccount = accounts.find((account) =>
    ["cash", "checking", "savings"].includes(String(account.account_type)),
  );
  if (
    !household ||
    !person ||
    !cashAccount ||
    !incomes[0] ||
    expenses.length === 0
  )
    return unavailable(
      "A household, person, cash account, income, and spending item are required.",
    );
  if ([...incomes, ...expenses].some((item) => item.frequency !== "monthly"))
    return unavailable(
      "Only monthly cash-flow inputs can be compared without guessing timing.",
    );
  const unsupportedSemantics = unsupportedCashFlowSemantics(incomes, expenses);
  if (unsupportedSemantics) return unavailable(unsupportedSemantics);
  if (
    expenses.some((item) => item.payment_account_id !== cashAccount.account_id)
  )
    return unavailable(
      "Spending funding must identify the selected cash account.",
    );
  try {
    if (cashAccount.currency !== request.baseCurrency)
      return unavailable(
        "Plan comparison requires the selected cash account currency to match the session base currency.",
      );
    const currency = Currency.of(request.baseCurrency);
    const householdId = domainId("household", String(household.household_id));
    const personId = domainId("person", String(person.person_id));
    const cashId = domainId("account", String(cashAccount.account_id));
    const payableId = domainId(
      "liability",
      "ffffffff-ffff-4fff-8fff-fffffffffff1",
    );
    const primitive = (index: number) =>
      domainId(
        "primitive-instance",
        `dddddddd-dddd-4ddd-8ddd-${index.toString().padStart(12, "0")}`,
      );
    const funding = createFundingPolicy({
      id: fundingPolicyId(`personal-mvp:${cashId}`),
      orderedSources: [{ kind: "cash_account", accountId: cashId }],
      allowPartial: false,
      insufficientFundsBehavior: "unfunded",
    });
    const input: VerticalSlice2Input = {
      householdId,
      ownerId: personId,
      cashAccountId: cashId,
      expensePayableLiabilityId: payableId,
      baseCurrency: currency,
      sameInstantCashFlowOrder: "income_before_expense",
      events: [],
      incomes: incomes.map((item, index) => ({
        id: domainId("income", String(item.income_id)),
        ownerId:
          String(item.owner_id) === householdId
            ? householdId
            : domainId("person", String(item.owner_id)),
        depositAccountId: cashId,
        baseMonthlyAmount: money(String(item.amount), currency),
        start: iso(String(item.start_date)),
        ...(typeof item.end_date === "string"
          ? { end: iso(item.end_date) }
          : {}),
        recurrence: {
          kind: "utc_monthly",
          anchor: iso(String(item.start_date)),
          invalidDayPolicy: "skip",
        },
        growthRate: Rate.fromDecimal("0", rateConvention.effectiveAnnual()),
        growthBaseAt: iso(String(item.start_date)),
        primitiveIds: {
          growth: primitive(index * 4 + 1),
          recurrence: primitive(index * 4 + 2),
        },
      })),
      expenses: expenses.map((item, index) => ({
        id: domainId("expense", String(item.expense_id)),
        ownerId:
          String(item.owner_id) === householdId
            ? householdId
            : domainId("person", String(item.owner_id)),
        paymentAccountId: cashId,
        payableLiabilityId: payableId,
        baseMonthlyAmount: money(String(item.amount), currency),
        start: iso(String(item.start_date)),
        ...(typeof item.end_date === "string"
          ? { end: iso(item.end_date) }
          : {}),
        recurrence: {
          kind: "utc_monthly",
          anchor: iso(String(item.start_date)),
          invalidDayPolicy: "skip",
        },
        inflationRate: Rate.fromDecimal("0", rateConvention.effectiveAnnual()),
        inflationBaseAt: iso(String(item.start_date)),
        fundingPolicy: funding,
        settlementPriority: index + 1,
        primitiveIds: {
          indexGrowth: primitive(500 + index * 4 + 1),
          inflationLink: primitive(500 + index * 4 + 2),
          recurrence: primitive(500 + index * 4 + 3),
        },
      })),
    };
    const openingState = createAuthoritativeState({
      accounts: {
        [cashId]: {
          id: cashId,
          kind: "checking",
          ownerId: personId,
          cash: money(String(cashAccount.opening_balance), currency),
        },
      },
      liabilities: {
        [payableId]: { id: payableId, balance: money("0", currency) },
      },
    });
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
              incomeId: input.incomes[0]!.id,
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
  });
  draft = addPersonalObject(draft, "Assumption", ids.assumption, {
    name: "Salary growth",
    category: "salary_growth",
    value: "0.03",
    unit: "effective annual rate",
    scenario_id: ids.scenario,
  });
  return draft;
};
