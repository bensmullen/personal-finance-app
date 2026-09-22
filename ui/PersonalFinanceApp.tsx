"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { z } from "zod";
import {
  PERSONAL_OBJECT_TYPES,
  addPersonalObject,
  createGoldenHouseholdDraft,
  createGuidedSetupDraft,
  createSyntheticPersonalDraft,
  deletePersistedPersonalModel,
  deletePersonalObject,
  exportPersonalModelJson,
  getCurrentPosition,
  getPersonalEditorMetadata,
  importPersonalModelJson,
  inspectPersistedPersonalModel,
  isForecastStartDate,
  migratePersonalModelVersion,
  migratePersistedPersonalModel,
  patchPersonalObject,
  comparePersonalScenarios,
  runPersonalForecast,
  resolvePersonalSessionSettings,
  savePersonalModel,
  sessionSettingsFromHorizon,
  validatePersonalDraft,
  validatePersonalModelJson,
  type ForecastRequest,
  type JsonObject,
  type PersonalDraft,
  type PersonalForecastReadModel,
  type PersonalObjectType,
  type PersonalScenarioComparisonReadModel,
  type PersonalSessionSettings,
  type PersistedPersonalModelState,
} from "../src/application/personalMvp.js";
import {
  comparePersonalHouseholdScenarioIntents,
  comparePersonalHouseholdMajorAssetDebtAddition,
  createHouseholdForecastRequest,
  resolveHouseholdExplanation,
  runPersonalHouseholdForecast,
  type PersonalHouseholdForecastReadModel,
  type PersonalHouseholdScenarioComparisonReadModel,
  type PersonalHouseholdSessionExecutionConfiguration,
} from "../src/application/householdProjection.js";
import {
  createGoldenHouseholdSessionConfiguration,
} from "../src/application/goldenHousehold.js";
import type { ScenarioChangeIntent } from "../src/application/compiler/scenarios.js";
import type { RetirementTerminationBinding } from "../src/application/compiler/cashFlow.js";
import {
  IndexedDbPersonalModelStore,
  isPersonalPersistenceEnabledOrigin,
} from "./persistence/indexedDbPersonalModelStore.js";

type Primary = "Overview" | "Money" | "Net Worth" | "Plan" | "Settings";
const NAV: readonly Primary[] = [
  "Overview",
  "Money",
  "Net Worth",
  "Plan",
  "Settings",
];
const SUBNAV: Record<Primary, readonly string[]> = {
  Overview: ["How am I doing?"],
  Money: ["Cash Flow", "Income", "Spending", "Accounts"],
  "Net Worth": ["Overview", "Cash", "Investments", "Property & Assets", "Debt"],
  Plan: [
    "Current Plan",
    "Life Events",
    "Assumptions",
    "What If?",
    "Compare Plans",
  ],
  Settings: [
    "Household & People",
    "Model Settings",
    "Import / Export",
    "Advanced",
  ],
};
const EDITORS: Record<string, readonly PersonalObjectType[]> = {
  Income: ["Income"],
  Spending: ["Expense"],
  Accounts: ["Account"],
  Cash: ["Account"],
  Investments: ["Investment"],
  "Property & Assets": ["Asset"],
  Debt: ["Liability"],
  Assumptions: ["Assumption"],
  "What If?": ["Scenario"],
  "Household & People": ["Household", "Person"],
};
const TITLES: Record<PersonalObjectType, string> = {
  Household: "Households",
  Person: "People",
  Account: "Accounts",
  Income: "Income",
  Expense: "Spending",
  Asset: "Property & assets",
  Liability: "Debt",
  Investment: "Investments",
  Assumption: "Assumptions",
  Scenario: "Plans & what-ifs",
};
const FIELD_LABELS: Record<string, string> = {
  source: "Source / name",
  owner_id: "Owner",
  income_type: "Income type",
  amount: "Amount",
  frequency: "Frequency",
  start_date: "Start",
  end_date: "End",
  category: "Description / category",
  essentiality: "Essential or discretionary",
  payment_account_id: "Funding account",
  name: "Name",
  account_type: "Account type",
  institution: "Institution",
  opening_balance: "Balance",
  currency: "Currency",
  liquidity_class: "Liquidity",
  tax_treatment: "Tax treatment",
  asset_type: "Asset type",
  acquisition_date: "Acquisition date",
  acquisition_cost: "Current value / acquisition cost",
  valuation_method: "Valuation method",
  principal: "Original principal",
  current_balance: "Current balance",
  interest_rate: "Interest rate",
  rate_type: "Rate type",
  extra_payment: "Extra payment",
  origination_date: "Origination",
  maturity_date: "Maturity",
  collateral_id: "Collateral",
  investment_type: "Investment type",
  symbol: "Symbol",
  quantity: "Quantity",
  expected_return: "Expected return",
  first_name: "First name",
  last_name: "Last name",
  date_of_birth: "Date of birth",
  residence_jurisdiction: "Residence jurisdiction",
  household_type: "Household type",
  formation_date: "Formation date",
  primary_jurisdiction: "Primary jurisdiction",
  value: "Value",
  unit: "Unit",
  description: "Description",
};
const PRIMARY_FIELDS: Record<PersonalObjectType, readonly string[]> = {
  Household: [
    "name",
    "household_type",
    "formation_date",
    "primary_jurisdiction",
  ],
  Person: [
    "first_name",
    "last_name",
    "date_of_birth",
    "residence_jurisdiction",
    "household_id",
  ],
  Account: [
    "name",
    "account_type",
    "owner_id",
    "institution",
    "opening_balance",
    "currency",
    "liquidity_class",
    "tax_treatment",
    "opening_date",
  ],
  Income: [
    "source",
    "owner_id",
    "income_type",
    "amount",
    "frequency",
    "start_date",
    "end_date",
  ],
  Expense: [
    "category",
    "owner_id",
    "amount",
    "frequency",
    "start_date",
    "end_date",
    "essentiality",
    "payment_account_id",
  ],
  Asset: [
    "name",
    "asset_type",
    "owner_id",
    "acquisition_cost",
    "acquisition_date",
    "valuation_method",
    "liquidity_class",
  ],
  Liability: [
    "name",
    "liability_type",
    "owner_id",
    "current_balance",
    "principal",
    "interest_rate",
    "rate_type",
    "payment_frequency",
    "extra_payment",
    "origination_date",
    "maturity_date",
    "collateral_id",
  ],
  Investment: [
    "investment_type",
    "account_id",
    "symbol",
    "quantity",
    "expected_return",
    "tax_treatment",
  ],
  Assumption: [
    "name",
    "category",
    "value",
    "unit",
    "start_date",
    "end_date",
    "scenario_id",
  ],
  Scenario: [
    "name",
    "description",
    "start_date",
    "end_date",
    "enabled",
    "stochastic",
  ],
};

const setupSchema = z.object({
  name: z.string().min(1, "Tell us what to call this household"),
  income: z.string().regex(/^\d+(\.\d+)?$/, "Use an exact decimal"),
  cash: z.string().regex(/^\d+(\.\d+)?$/),
  asset: z.string().regex(/^\d+(\.\d+)?$/),
  debt: z.string().regex(/^\d+(\.\d+)?$/),
  spending: z.string().regex(/^\d+(\.\d+)?$/),
  horizon: z.string().regex(/^(?:[1-9]|[1-3][0-9]|40)$/),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a start date")
    .refine(isForecastStartDate, {
      message: "Forecast start must be the first day of a month.",
    }),
});
type SetupValues = z.infer<typeof setupSchema>;
const randomId = () => crypto.randomUUID();
const objectEntries = (
  draft: PersonalDraft,
  type: PersonalObjectType,
): readonly JsonObject[] =>
  (draft.objects[type] ?? []).filter(
    (value): value is JsonObject =>
      typeof value === "object" && value !== null && !Array.isArray(value),
  ) as readonly JsonObject[];
const objectId = (type: PersonalObjectType, value: JsonObject) =>
  String(value[`${type.toLowerCase()}_id`]);
const objectLabel = (type: PersonalObjectType, value: JsonObject) =>
  String(
    value.name ??
      value.source ??
      value.category ??
      [value.first_name, value.last_name].filter(Boolean).join(" ") ??
      TITLES[type],
  );
const chartNumber = (exact: string) => Number(exact); // Disposable display coordinate only; never returned to application/engine.
const householdMoney = (
  value: { amount: string; currency: string } | undefined,
) =>
  value === undefined
    ? "Unavailable"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: value.currency,
        maximumFractionDigits: 2,
      }).format(Number(value.amount));
type LiabilitySessionProfile = Readonly<{
  paymentAnchor: string;
  totalPayments: string;
  fundingAccountId: string;
  settlementPriority: string;
}>;
type LiabilitySessionConfig = Readonly<{
  ownerId: string;
  profiles: Readonly<Record<string, LiabilitySessionProfile>>;
}>;
const EMPTY_LIABILITY_SESSION_PROFILE: LiabilitySessionProfile = Object.freeze({
  paymentAnchor: "",
  totalPayments: "",
  fundingAccountId: "",
  settlementPriority: "",
});
const emptyLiabilityConfig = (): LiabilitySessionConfig => ({
  ownerId: "",
  profiles: {},
});

export function PersonalFinanceApp() {
  const [draft, setDraft] = useState<PersonalDraft | undefined>();
  const [primary, setPrimary] = useState<Primary>("Overview");
  const [subnav, setSubnav] = useState("How am I doing?");
  const [setupStep, setSetupStep] = useState(0);
  const [forecastScope, setForecastScope] =
    useState<ForecastRequest["scope"]>("cash_flow");
  const [forecast, setForecast] = useState<PersonalForecastReadModel>();
  const [comparison, setComparison] =
    useState<PersonalScenarioComparisonReadModel>();
  const [householdForecast, setHouseholdForecast] =
    useState<PersonalHouseholdForecastReadModel>();
  const [householdComparison, setHouseholdComparison] =
    useState<PersonalHouseholdScenarioComparisonReadModel>();
  const [householdExecution, setHouseholdExecution] =
    useState<PersonalHouseholdSessionExecutionConfiguration>();
  const [sessionSettings, setSessionSettings] =
    useState<PersonalSessionSettings>(() =>
      sessionSettingsFromHorizon("2026-01-01", 12),
    );
  const [runSettingsError, setRunSettingsError] = useState("");
  const [liabilityConfig, setLiabilityConfig] =
    useState<LiabilitySessionConfig>(emptyLiabilityConfig);
  const [investmentOwnerId, setInvestmentOwnerId] = useState("");
  const [cashFlowExecutionAccountId, setCashFlowExecutionAccountId] =
    useState("");
  const [retirementBindings, setRetirementBindings] = useState<
    readonly RetirementTerminationBinding[]
  >([]);
  const [whatIfIds] = useState(() => ({
    terminationEventId: randomId(),
    extraPaymentId: randomId(),
    alternativeScenarioId: randomId(),
    majorAssetId: randomId(),
    majorLiabilityId: randomId(),
  }));
  const [fileReport, setFileReport] =
    useState<ReturnType<typeof validatePersonalModelJson>>();
  const [pendingJson, setPendingJson] = useState("");
  const [notice, setNotice] = useState("");
  const [persistenceMode, setPersistenceMode] = useState<
    "checking" | "enabled" | "disabled"
  >("checking");
  const [persistenceStore, setPersistenceStore] =
    useState<IndexedDbPersonalModelStore>();
  const [savedState, setSavedState] = useState<PersistedPersonalModelState>();
  const [persistenceError, setPersistenceError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const setup = useForm<SetupValues>({
    resolver: zodResolver(setupSchema),
    defaultValues: {
      name: "My household",
      income: "6000.00",
      cash: "5000.00",
      asset: "350000.00",
      debt: "235000.00",
      spending: "4200.00",
      horizon: "10",
      startDate: "2026-01-01",
    },
  });
  const metadata = getPersonalEditorMetadata();
  const position = useMemo(
    () =>
      draft
        ? getCurrentPosition(draft, {
            baseCurrency: sessionSettings.baseCurrency,
            asOf: sessionSettings.asOf,
          })
        : undefined,
    [draft, sessionSettings.baseCurrency, sessionSettings.asOf],
  );
  const issues = useMemo(
    () => (draft ? validatePersonalDraft(draft) : []),
    [draft],
  );

  const inspectSavedModel = async (store: IndexedDbPersonalModelStore) => {
    try {
      setSavedState(await inspectPersistedPersonalModel(store));
      setPersistenceError("");
    } catch {
      setPersistenceError("Local browser storage is currently unavailable.");
    }
  };

  useEffect(() => {
    if (!isPersonalPersistenceEnabledOrigin(window.location)) {
      setPersistenceMode("disabled");
      return;
    }
    const store = new IndexedDbPersonalModelStore(window.indexedDB);
    setPersistenceStore(store);
    setPersistenceMode("enabled");
    void inspectSavedModel(store);
  }, []);

  const invalidateResults = () => {
    setForecast(undefined);
    setComparison(undefined);
    setHouseholdForecast(undefined);
    setHouseholdComparison(undefined);
    setRunSettingsError("");
  };

  const updateCanonicalModel = (next: PersonalDraft) => {
    setDraft(next);
    invalidateResults();
  };

  const replaceCanonicalModel = (next: PersonalDraft, message: string) => {
    updateCanonicalModel(next);
    setLiabilityConfig(emptyLiabilityConfig());
    setInvestmentOwnerId("");
    setCashFlowExecutionAccountId("");
    setRetirementBindings([]);
    setHouseholdExecution(undefined);
    setNotice(message);
  };

  useEffect(() => {
    invalidateResults();
  }, [
    sessionSettings,
    liabilityConfig,
    investmentOwnerId,
    retirementBindings,
    householdExecution,
  ]);

  const loadSavedModel = () => {
    if (savedState?.status !== "ready") return;
    replaceCanonicalModel(
      savedState.model,
      "Saved model loaded into this session",
    );
  };

  const saveToBrowser = async () => {
    if (!draft || !persistenceStore) return;
    try {
      let result = await savePersonalModel(persistenceStore, draft);
      if (result.status === "different_model_confirmation_required") {
        if (
          !window.confirm(
            "Replace the different model currently saved in this browser?",
          )
        )
          return;
        result = await savePersonalModel(persistenceStore, draft, {
          confirmDifferentModel: true,
        });
      }
      if (result.status === "recovery_required") {
        setNotice(
          "Saved data is protected. Export its backup or delete it before saving this model.",
        );
        setSavedState(result.savedState);
        return;
      }
      setNotice("Canonical model saved to this browser");
      await inspectSavedModel(persistenceStore);
    } catch {
      setPersistenceError(
        "The model could not be saved; previously stored data was retained.",
      );
    }
  };

  const migrateSavedModel = async () => {
    if (!persistenceStore) return;
    try {
      const migrated = await migratePersistedPersonalModel(persistenceStore);
      setSavedState(migrated);
      replaceCanonicalModel(
        migrated.model,
        "Saved model migrated explicitly and loaded",
      );
    } catch {
      setPersistenceError(
        "Migration failed; the original saved data was retained.",
      );
    }
  };

  const deleteSavedModel = async () => {
    if (
      !persistenceStore ||
      !window.confirm(
        "Delete the saved local model from this browser? The open model and exported files will not be deleted.",
      )
    )
      return;
    try {
      await deletePersistedPersonalModel(persistenceStore);
      setSavedState({ status: "empty" });
      setPersistenceError("");
      setNotice("Saved local model deleted; the open model is unchanged");
    } catch {
      setPersistenceError("Saved local data could not be deleted.");
    }
  };

  const downloadJson = (contents: string, filename: string) => {
    const blob = new Blob([contents], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const exportSavedBackup = () => {
    if (!savedState || savedState.status === "empty") return;
    downloadJson(
      savedState.serializedModel,
      "personal-finance-model-backup.json",
    );
    setNotice("Exact saved bytes exported as a recovery backup");
  };

  const navigate = (next: Primary) => {
    setPrimary(next);
    setSubnav(SUBNAV[next][0]!);
  };
  const completeSetup = setup.handleSubmit((values) => {
    const next = createGuidedSetupDraft({
      modelId: randomId(),
      householdId: randomId(),
      personId: randomId(),
      accountId: randomId(),
      incomeId: randomId(),
      assetId: randomId(),
      liabilityId: randomId(),
      expenseId: randomId(),
      householdName: values.name,
      monthlyIncome: values.income,
      openingCash: values.cash,
      assetValue: values.asset,
      debt: values.debt,
      monthlySpending: values.spending,
      startDate: values.startDate,
    });
    replaceCanonicalModel(next, "Your starting financial picture is ready");
    setSessionSettings(
      sessionSettingsFromHorizon(values.startDate, Number(values.horizon) * 12),
    );
    navigate("Overview");
  });

  if (!draft)
    return (
      <SetupWizard
        form={setup}
        step={setupStep}
        setStep={setSetupStep}
        complete={completeSetup}
        persistenceMode={persistenceMode}
        savedState={savedState}
        persistenceError={persistenceError}
        loadSaved={loadSavedModel}
        migrateSaved={migrateSavedModel}
        exportSavedBackup={exportSavedBackup}
        deleteSaved={deleteSavedModel}
        loadExample={() => {
          replaceCanonicalModel(
            createGoldenHouseholdDraft(),
            "Golden Household loaded",
          );
          setSessionSettings(sessionSettingsFromHorizon("2026-01-01", 120));
          setHouseholdExecution(createGoldenHouseholdSessionConfiguration());
        }}
      />
    );

  const runForecast = (scope: ForecastRequest["scope"]) => {
    const resolved = resolvePersonalSessionSettings(sessionSettings, scope);
    if (!resolved.request) {
      setRunSettingsError(resolved.error ?? "Run settings are not valid.");
      return;
    }
    setRunSettingsError("");
    if (scope === "liabilities") {
      for (const [liabilityId, profile] of Object.entries(
        liabilityConfig.profiles,
      ) as [string, LiabilitySessionProfile][]) {
        if (
          !profile.paymentAnchor ||
          !profile.fundingAccountId ||
          !/^\d+$/.test(profile.totalPayments) ||
          !/^\d+$/.test(profile.settlementPriority)
        ) {
          setRunSettingsError(
            `Complete the execution profile for liability ${liabilityId}; payment count and priority must be whole numbers.`,
          );
          return;
        }
      }
    }
    const effectiveStandaloneRetirementBindings =
      retirementBindings.length > 0
        ? retirementBindings
        : (householdExecution?.retirementBindings ?? []);
    const request =
      scope === "investments"
        ? {
            ...resolved.request,
            ...(investmentOwnerId
              ? { executionOwnerId: investmentOwnerId }
              : {}),
          }
        : scope !== "liabilities"
          ? {
              ...resolved.request,
              ...(effectiveStandaloneRetirementBindings.length === 0
                ? {}
                : {
                    retirementBindings: effectiveStandaloneRetirementBindings,
                  }),
            }
          : {
              ...resolved.request,
              ...(liabilityConfig.ownerId
                ? { executionOwnerId: liabilityConfig.ownerId }
                : {}),
              liabilityExecutionProfiles: (
                Object.entries(liabilityConfig.profiles) as [
                  string,
                  LiabilitySessionProfile,
                ][]
              ).map(([liabilityId, profile]) => ({
                liabilityId,
                kind: "vs4_fixed_monthly_fully_amortizing" as const,
                paymentAnchor: profile.paymentAnchor,
                totalPayments: Number(profile.totalPayments),
                fundingAccountId: profile.fundingAccountId,
                settlementPriority: Number(profile.settlementPriority),
                openingContractStatus: "current" as const,
              })),
            };
    setForecast(
      runPersonalForecast(
        draft,
        scope === "cash_flow" && householdExecution?.cashFlowExecutionAccountId
          ? {
              ...request,
              cashFlowExecutionAccountId:
                householdExecution.cashFlowExecutionAccountId,
            }
          : request,
      ),
    );
  };
  const runComparison = (
    scope: "cash_flow" | "investments" | "liabilities",
    change: ScenarioChangeIntent,
    retirementBinding?: RetirementTerminationBinding,
  ) => {
    if (retirementBinding !== undefined) setRetirementBindings([retirementBinding]);
    const configuration = householdExecution;
    if (configuration === undefined) {
      setRunSettingsError(
        "Configure cash-flow account, investment owner, liability owner, and each mortgage profile in Current Plan before comparing a household what-if.",
      );
      return;
    }
    const bindings = retirementBinding === undefined
      ? configuration.retirementBindings
      : [retirementBinding];
    const configured = { ...effectiveHouseholdExecution!, retirementBindings: bindings };
    setHouseholdComparison(comparePersonalHouseholdScenarioIntents(
      draft,
      createHouseholdForecastRequest(configured, randomId()),
      [{ scenarioId: whatIfIds.alternativeScenarioId, name: "What-if alternative", changes: [change] }],
    ));
    navigate("Plan");
    setSubnav("Compare Plans");
  };
  const effectiveHouseholdExecution =
    householdExecution === undefined
      ? undefined
      : {
          ...householdExecution,
          baseCurrency: sessionSettings.baseCurrency,
          asOf: sessionSettings.asOf,
          dataCutoff: sessionSettings.dataCutoff,
          simulationStart: sessionSettings.simulationStart,
          simulationEnd: sessionSettings.simulationEnd,
          sameInstantCashFlowOrder: sessionSettings.sameInstantCashFlowOrder,
        };
  const runHouseholdForecast = () => {
    if (effectiveHouseholdExecution === undefined) {
      const message = "The household forecast requires explicit cash, investment, liability, and retirement session configuration.";
      setRunSettingsError(message);
      setHouseholdForecast({
        scope: "household",
        status: "unavailable",
        message,
        diagnostics: [{
          code: "HOUSEHOLD_EXECUTION_CONFIGURATION_REQUIRED",
          message,
          capability: "household_projection",
        }],
      });
      return;
    }
    setRunSettingsError("");
    setHouseholdForecast(
      runPersonalHouseholdForecast(
        draft,
        createHouseholdForecastRequest(effectiveHouseholdExecution, randomId()),
      ),
    );
  };
  const runHouseholdComparison = () => {
    if (effectiveHouseholdExecution === undefined) {
      setRunSettingsError(
        "Household comparison requires explicit session execution configuration.",
      );
      return;
    }
    setRunSettingsError("");
    setHouseholdComparison(
      comparePersonalHouseholdScenarioIntents(
        draft,
        createHouseholdForecastRequest(effectiveHouseholdExecution, randomId()),
        [],
      ),
    );
  };
  const runMajorAssetDebtComparison = (addition: Parameters<typeof comparePersonalHouseholdMajorAssetDebtAddition>[2]) => {
    if (effectiveHouseholdExecution === undefined) {
      setRunSettingsError("Configure reconciled household execution in Current Plan before comparing a major asset/debt addition.");
      return;
    }
    setHouseholdComparison(comparePersonalHouseholdMajorAssetDebtAddition(draft, createHouseholdForecastRequest(effectiveHouseholdExecution, randomId()), addition));
    navigate("Plan"); setSubnav("Compare Plans");
  };
  const exportModel = () => {
    downloadJson(exportPersonalModelJson(draft), "personal-finance-model.json");
    setNotice("Model exported to a local file");
  };
  const readImport = async (file: File) => {
    const json = await file.text();
    setPendingJson(json);
    setFileReport(validatePersonalModelJson(json));
  };
  const importModel = () => {
    replaceCanonicalModel(
      importPersonalModelJson(pendingJson),
      "Model imported into this session",
    );
    setFileReport(undefined);
  };
  const migrate = () => {
    const migrated = migratePersonalModelVersion(pendingJson);
    setPendingJson(migrated);
    setFileReport(validatePersonalModelJson(migrated));
    setNotice(
      "Migration prepared. Review compatibility, then import explicitly.",
    );
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => navigate("Overview")}>
          <span className="brand-mark">P</span>
          <span>Personal Finance</span>
        </button>
        <div className="session-banner" role="status">
          <strong>Manual save</strong> — edits stay in memory until saved.{" "}
          {persistenceMode === "enabled" ? (
            <>
              <button onClick={() => void saveToBrowser()}>Save</button> locally
              to this browser/origin; export remains the recommended backup.
            </>
          ) : (
            <>
              This public/demo origin does not store personal models.{" "}
              <button onClick={exportModel}>Export your model</button>.
            </>
          )}
        </div>
        <button className="avatar" aria-label="Model menu">
          ME
        </button>
      </header>
      <nav className="primary-nav" aria-label="Primary navigation">
        {NAV.map((item) => (
          <button
            key={item}
            className={primary === item ? "active" : ""}
            onClick={() => navigate(item)}
          >
            {item}
          </button>
        ))}
      </nav>
      <div className="workspace">
        <aside className="subnav">
          <p className="eyebrow">{primary}</p>
          {SUBNAV[primary].map((item) => (
            <button
              key={item}
              className={subnav === item ? "active" : ""}
              onClick={() => setSubnav(item)}
            >
              {item}
            </button>
          ))}
          <div className="model-health">
            <span>Model health</span>
            <strong className={issues.length ? "warn" : "ok"}>
              {issues.length ? `${issues.length} issues` : "Ready"}
            </strong>
          </div>
        </aside>
        <main id="main-content">
          {notice && (
            <div className="notice" role="status">
              {notice}
              <button aria-label="Dismiss" onClick={() => setNotice("")}>
                ×
              </button>
            </div>
          )}
          {primary === "Overview" && (
            <Overview
              position={position!}
              forecast={householdForecast}
              draft={draft}
              run={runHouseholdForecast}
              onPlan={() => {
                navigate("Plan");
                setSubnav("Current Plan");
              }}
            />
          )}
          {primary === "Money" && subnav === "Cash Flow" && (
            <CashFlow
              position={position!}
              forecast={householdForecast}
              draft={draft}
              run={runHouseholdForecast}
              error={runSettingsError}
            />
          )}
          {primary === "Net Worth" && subnav === "Overview" && (
            <NetWorthOverview
              position={position!}
              draft={draft}
              forecast={householdForecast}
              run={runHouseholdForecast}
            />
          )}
          {primary === "Net Worth" && subnav === "Debt" && (
            <>
              <EditorHub
                types={EDITORS.Debt!}
                draft={draft}
                setDraft={updateCanonicalModel}
                metadata={metadata}
                setNotice={setNotice}
              />
              <DebtExecutionPanel
                draft={draft}
                liabilityConfig={liabilityConfig}
                setLiabilityConfig={setLiabilityConfig}
                run={() => runForecast("liabilities")}
                forecast={forecast}
                error={runSettingsError}
              />
            </>
          )}
          {primary === "Plan" && subnav === "Current Plan" && (
            <>
              <HouseholdPlan
                draft={draft}
                forecast={householdForecast}
                run={runHouseholdForecast}
                error={runSettingsError}
                cashFlowExecutionAccountId={cashFlowExecutionAccountId}
                setCashFlowExecutionAccountId={setCashFlowExecutionAccountId}
                investmentOwnerId={investmentOwnerId}
                setInvestmentOwnerId={setInvestmentOwnerId}
                liabilityConfig={liabilityConfig}
                setLiabilityConfig={setLiabilityConfig}
                retirementBindings={retirementBindings}
                setHouseholdExecution={() => {
                  const mortgages = objectEntries(draft, "Liability").filter((item) => item.liability_type === "mortgage");
                  if (!cashFlowExecutionAccountId) return setRunSettingsError("Household execution configuration is missing the cash-flow execution account.");
                  if (!investmentOwnerId) return setRunSettingsError("Household execution configuration is missing the investment execution owner.");
                  if (!liabilityConfig.ownerId) return setRunSettingsError("Household execution configuration is missing the liability execution owner.");
                  for (const mortgage of mortgages) {
                    const id = objectId("Liability", mortgage);
                    const profile = liabilityConfig.profiles[id];
                    if (!profile?.paymentAnchor || !profile.fundingAccountId || !/^\\d+$/.test(profile.totalPayments) || !/^\\d+$/.test(profile.settlementPriority))
                      return setRunSettingsError(`Household execution configuration is missing an explicit complete profile for ${objectLabel("Liability", mortgage)}.`);
                  }
                  setHouseholdExecution({
                    baseCurrency: sessionSettings.baseCurrency, asOf: sessionSettings.asOf, dataCutoff: sessionSettings.dataCutoff,
                    simulationStart: sessionSettings.simulationStart, simulationEnd: sessionSettings.simulationEnd,
                    sameInstantCashFlowOrder: sessionSettings.sameInstantCashFlowOrder,
                    cashFlowExecutionAccountId, investmentExecutionOwnerId: investmentOwnerId,
                    investmentTransferInstructions: [], investmentPurchaseInstructions: [],
                    liabilityExecutionOwnerId: liabilityConfig.ownerId,
                    liabilityExecutionProfiles: mortgages.map((mortgage) => {
                      const id = objectId("Liability", mortgage); const profile = liabilityConfig.profiles[id]!;
                      return { liabilityId: id, kind: "vs4_fixed_monthly_fully_amortizing" as const, paymentAnchor: profile.paymentAnchor, totalPayments: Number(profile.totalPayments), fundingAccountId: profile.fundingAccountId, settlementPriority: Number(profile.settlementPriority), openingContractStatus: "current" as const };
                    }), retirementBindings,
                  });
                  setRunSettingsError("");
                }}
              />
              <section aria-label="Standalone forecast drill-down">
                <Plan
                  forecastScope={forecastScope}
                  setScope={setForecastScope}
                  run={() => runForecast(forecastScope)}
                  forecast={forecast}
                  settings={sessionSettings}
                  error={runSettingsError}
                  draft={draft}
                  liabilityConfig={liabilityConfig}
                  setLiabilityConfig={setLiabilityConfig}
                  investmentOwnerId={investmentOwnerId}
                  setInvestmentOwnerId={setInvestmentOwnerId}
                />
              </section>
            </>
          )}
          {primary === "Plan" && subnav === "Compare Plans" && (
            <ComparePlans
              comparison={householdComparison}
              legacyComparison={comparison}
              draft={draft}
              retirementBindings={
                effectiveHouseholdExecution?.retirementBindings ??
                retirementBindings
              }
              onRun={runHouseholdComparison}
            />
          )}
          {primary === "Settings" && subnav === "Model Settings" && (
            <ModelSettings
              settings={sessionSettings}
              setSettings={(value) => {
                invalidateResults();
                setSessionSettings(value);
              }}
              error={runSettingsError}
            />
          )}
          {primary === "Settings" && subnav === "Import / Export" && (
            <Portability
              report={fileReport}
              fileRef={fileRef}
              readImport={readImport}
              importModel={importModel}
              migrate={migrate}
              exportModel={exportModel}
              persistenceMode={persistenceMode}
              savedState={savedState}
              persistenceError={persistenceError}
              saveToBrowser={saveToBrowser}
              loadSaved={loadSavedModel}
              migrateSaved={migrateSavedModel}
              exportSavedBackup={exportSavedBackup}
              deleteSaved={deleteSavedModel}
            />
          )}
          {primary === "Settings" && subnav === "Advanced" && (
            <Advanced draft={draft} issues={issues} />
          )}
          {primary === "Plan" && subnav === "What If?" && (
            <WhatIfStarter
              draft={draft}
              investmentOwnerId={investmentOwnerId}
              liabilityConfig={liabilityConfig}
              runtimeIds={whatIfIds}
              onCompare={runComparison}
              onMajorAssetDebt={runMajorAssetDebtComparison}
            />
          )}
          {EDITORS[subnav] &&
            !(primary === "Net Worth" && subnav === "Debt") && (
              <EditorHub
                types={EDITORS[subnav]!}
                draft={draft}
                setDraft={updateCanonicalModel}
                metadata={metadata}
                setNotice={setNotice}
              />
            )}
          {primary === "Plan" &&
            subnav === "Life Events" &&
            !EDITORS[subnav] && (
              <Capability
                title="Life events"
                message="Retirement can execute only with an explicit binding to one income-termination event and changes that stop date only. Marriage, childbirth, home purchase, disability, and other event types are preserved but have no modeled consequences yet."
              />
            )}
        </main>
      </div>
    </div>
  );
}

function SetupWizard({
  form,
  step,
  setStep,
  complete,
  loadExample,
  persistenceMode,
  savedState,
  persistenceError,
  loadSaved,
  migrateSaved,
  exportSavedBackup,
  deleteSaved,
}: {
  form: UseFormReturn<SetupValues>;
  step: number;
  setStep: (value: number) => void;
  complete: () => void;
  loadExample: () => void;
  persistenceMode: "checking" | "enabled" | "disabled";
  savedState: PersistedPersonalModelState | undefined;
  persistenceError: string;
  loadSaved: () => void;
  migrateSaved: () => Promise<void>;
  exportSavedBackup: () => void;
  deleteSaved: () => Promise<void>;
}) {
  const steps = [
    { title: "About you", field: "name", label: "Household name" },
    { title: "Income", field: "income", label: "Monthly income" },
    {
      title: "Accounts & investments",
      field: "cash",
      label: "Opening cash balance",
    },
    {
      title: "Home & other assets",
      field: "asset",
      label: "Asset cost basis",
    },
    { title: "Debts", field: "debt", label: "Current debt" },
    { title: "Spending", field: "spending", label: "Monthly spending" },
    {
      title: "Your plan",
      field: "horizon",
      label: "Projection horizon (years)",
      extraField: "startDate",
      extraLabel: "Projection start date",
    },
  ] as const;
  const current = steps[step]!;
  const error = form.formState.errors[current.field]?.message;
  return (
    <main className="setup">
      <section className="setup-card">
        <div className="setup-brand">
          <span className="brand-mark">P</span>
          <span>Personal Finance</span>
        </div>
        <p className="eyebrow">
          Guided setup · {step + 1} of {steps.length}
        </p>
        <div className="progress">
          <span style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
        </div>
        <h1>{current.title}</h1>
        <p>
          Build your model in plain financial language. You can change every
          item later.
        </p>
        <label>
          {current.label}
          <input
            {...form.register(current.field)}
            inputMode={current.field === "name" ? undefined : "decimal"}
          />
        </label>
        {error && <p className="field-error">{String(error)}</p>}
        {"extraField" in current && (
          <label>
            {current.extraLabel}
            <input type="date" {...form.register(current.extraField)} />
            {form.formState.errors[current.extraField]?.message && (
              <p className="field-error">
                {String(form.formState.errors[current.extraField]?.message)}
              </p>
            )}
          </label>
        )}
        <div className="wizard-actions">
          <button className="secondary" onClick={loadExample}>
            Use synthetic example
          </button>
          <span />
          <button
            className="ghost"
            disabled={step === 0}
            onClick={() => setStep(step - 1)}
          >
            Back
          </button>
          {step < steps.length - 1 ? (
            <button className="primary" onClick={() => setStep(step + 1)}>
              Continue
            </button>
          ) : (
            <button className="primary" onClick={complete}>
              Finish setup
            </button>
          )}
        </div>
        {persistenceMode === "enabled" &&
          savedState &&
          savedState.status !== "empty" && (
            <div className="compatibility">
              <strong>
                {savedState.status === "ready"
                  ? "A saved model is available"
                  : `Saved model status: ${savedState.status.replaceAll("_", " ")}`}
              </strong>
              <div className="row">
                {savedState.status === "ready" && (
                  <button className="primary" onClick={loadSaved}>
                    Load saved model
                  </button>
                )}
                {savedState.status === "migration_required" && (
                  <button
                    className="secondary"
                    onClick={() => void migrateSaved()}
                  >
                    Migrate saved model explicitly
                  </button>
                )}
                <button className="secondary" onClick={exportSavedBackup}>
                  Export saved backup
                </button>
                <button className="ghost" onClick={() => void deleteSaved()}>
                  Delete saved local model
                </button>
              </div>
            </div>
          )}
        {persistenceError && (
          <p className="field-error" role="alert">
            {persistenceError}
          </p>
        )}
        <p className="privacy">
          {persistenceMode === "disabled"
            ? "Public/demo origin: local personal-data persistence is disabled. Do not enter real personal financial information here. Import/export remain available."
            : "Trusted origin: edits stay in memory until manual Save. Saved model bytes remain in this browser and are not encrypted by this app; exported JSON is plaintext and must be stored securely. No financial model is sent to a service."}
        </p>
      </section>
    </main>
  );
}

function Overview({
  position,
  forecast,
  draft,
  run,
  onPlan,
}: {
  position: NonNullable<ReturnType<typeof getCurrentPosition>>;
  forecast: PersonalHouseholdForecastReadModel | undefined;
  draft: PersonalDraft;
  run: () => void;
  onPlan: () => void;
}) {
  const opening =
    forecast?.status === "completed" || forecast?.status === "incomplete"
      ? forecast.openingSnapshot
      : undefined;
  const cards = [
    ["Net worth", opening?.netWorth],
    ["Cash", opening?.cash],
    ["Monthly cash flow", position.monthlyCashFlow],
    ["Debt", opening?.totalLiabilities],
  ] as const;
  return (
    <>
      <PageHead
        eyebrow="Overview"
        title="How am I doing?"
        text="A clear view of your current position and the modeled path ahead."
      />
      <section className="kpi-grid">
        {cards.map(([label, value]) => (
          <article className="kpi" key={label}>
            <span>{label}</span>
            <strong>
              {"amount" in (value ?? {})
                ? householdMoney(value as never)
                : ((value as any)?.display ?? "Unavailable")}
            </strong>
            {!value && <small>Needs supported model data</small>}
          </article>
        ))}
      </section>
      <section className="panel outlook">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Your financial outlook</p>
            <h2>Current position and supported forecasts</h2>
          </div>
          <button className="primary" onClick={onPlan}>
            Explore my plan
          </button>
        </div>
        {forecast?.status === "completed" ||
        forecast?.status === "incomplete" ? (
          <HouseholdForecastVisual forecast={forecast} draft={draft} />
        ) : (
          <div className="capability">
            <strong>
              {forecast?.status === "unavailable"
                ? "Household forecast unavailable"
                : "Run the reconciled household forecast"}
            </strong>
            {forecast?.status === "unavailable" ? (
              <DiagnosticList
                diagnostics={forecast.diagnostics}
                fallback={forecast.message}
              />
            ) : (
              <p>
                Assets, debt, cash, investments, and net worth will come from
                one authoritative reconciled run.
              </p>
            )}
            <button className="primary" onClick={run}>
              Run household forecast
            </button>
          </div>
        )}
      </section>
      <section className="insight-grid">
        <article className="panel">
          <h3>Next best action</h3>
          <p>
            {position.monthlyCashFlow
              ? `Your modeled monthly cash flow is ${position.monthlyCashFlow.display}. Review your plan to see its supported trajectory.`
              : "Add monthly income and spending to understand your cash flow."}
          </p>
        </article>
        <article className="panel">
          <h3>Model check</h3>
          <p>
            {position.unavailable.length
              ? position.unavailable[0]
              : "Your current-position inputs are ready."}
          </p>
        </article>
      </section>
      {opening && (
        <section className="panel">
          <h2>Where is my money?</h2>
          <ul>
            {opening.accounts.map((item) => <li key={item.accountId}>Account {objectLabel("Account", objectEntries(draft, "Account").find((value) => objectId("Account", value) === item.accountId)!)}: {householdMoney(item.cash)}</li>)}
            {opening.positions.map((item) => <li key={item.positionId}>Investment {objectLabel("Investment", objectEntries(draft, "Investment").find((value) => objectId("Investment", value) === item.positionId)!)}: {householdMoney(item.value)}</li>)}
            {opening.debts.map((item) => <li key={item.liabilityId}>Debt {objectLabel("Liability", objectEntries(draft, "Liability").find((value) => objectId("Liability", value) === item.liabilityId)!)}: {householdMoney(item.balance)}</li>)}
          </ul>
        </section>
      )}
    </>
  );
}
function CashFlow({
  position,
  forecast,
  run,
  draft,
  error,
}: {
  position: ReturnType<typeof getCurrentPosition>;
  forecast: PersonalHouseholdForecastReadModel | undefined;
  run: () => void;
  draft: PersonalDraft;
  error: string;
}) {
  return (
    <>
      <PageHead
        eyebrow="Money · Cash Flow"
        title="What comes in and goes out?"
        text="Follow monthly income, spending, and liquidity without losing the exact source values."
      />
      <section className="kpi-grid three">
        <Kpi label="Monthly income" value={position.monthlyIncome?.display} />
        <Kpi
          label="Monthly spending"
          value={position.monthlySpending?.display}
        />
        <Kpi label="Net cash flow" value={position.monthlyCashFlow?.display} />
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Income vs spending</h2>
          <button className="primary" onClick={run}>
            Run cash-flow forecast
          </button>
        </div>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        {forecast?.status === "completed" ||
        forecast?.status === "incomplete" ? (
          <HouseholdForecastVisual
            forecast={forecast}
            draft={draft}
            cashFlowOnly
          />
        ) : forecast?.status === "unavailable" ? (
          <DiagnosticList
            diagnostics={forecast.diagnostics}
            fallback={forecast.message}
          />
        ) : (
          <Empty text="Run the supported cash-flow scope to see a trend and detailed table." />
        )}
      </section>
    </>
  );
}
function NetWorthOverview({
  position,
  draft,
  forecast,
  run,
}: {
  position: ReturnType<typeof getCurrentPosition>;
  draft: PersonalDraft;
  forecast: PersonalHouseholdForecastReadModel | undefined;
  run: () => void;
}) {
  const opening =
    forecast?.status === "completed" || forecast?.status === "incomplete"
      ? forecast.openingSnapshot
      : undefined;
  const data = opening
    ? [
        { name: "Assets", value: chartNumber(opening.totalAssets.amount) },
        {
          name: "Liabilities",
          value: chartNumber(opening.totalLiabilities.amount),
        },
      ]
    : [];
  return (
    <>
      <PageHead
        eyebrow="Net Worth"
        title="What do I own and owe?"
        text="Current values only—no cross-slice projection is implied."
      />
      <section className="kpi-grid three">
        <Kpi label="Net worth" value={householdMoney(opening?.netWorth)} />
        <Kpi
          label="Total assets"
          value={householdMoney(opening?.totalAssets)}
        />
        <Kpi
          label="Total liabilities"
          value={householdMoney(opening?.totalLiabilities)}
        />
      </section>
      <section className="panel">
        <h2>Current assets vs liabilities</h2>
        {data.length ? (
          <div className="chart">
            <ResponsiveContainer>
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" fill="#3d7d6b" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="capability">
            <strong>
              Run the household forecast to reconcile current composition
            </strong>
            <button className="primary" onClick={run}>
              Run household forecast
            </button>
          </div>
        )}
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Exact amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Assets</td>
              <td>{opening?.totalAssets.amount ?? "Unavailable"}</td>
            </tr>
            <tr>
              <td>Liabilities</td>
              <td>{opening?.totalLiabilities.amount ?? "Unavailable"}</td>
            </tr>
          </tbody>
        </table>
        <p className="muted">
          {objectEntries(draft, "Asset").length} assets ·{" "}
          {objectEntries(draft, "Liability").length} debts
        </p>
        {(forecast?.status === "completed" ||
          forecast?.status === "incomplete") && (
          <HouseholdForecastVisual forecast={forecast} draft={draft} />
        )}
      </section>
    </>
  );
}
function Plan({
  forecastScope,
  setScope,
  run,
  forecast,
  settings,
  error,
  draft,
  liabilityConfig,
  setLiabilityConfig,
  investmentOwnerId,
  setInvestmentOwnerId,
}: {
  forecastScope: ForecastRequest["scope"];
  setScope: (scope: ForecastRequest["scope"]) => void;
  run: () => void;
  forecast: PersonalForecastReadModel | undefined;
  settings: PersonalSessionSettings;
  error: string;
  draft: PersonalDraft;
  liabilityConfig: LiabilitySessionConfig;
  setLiabilityConfig: React.Dispatch<
    React.SetStateAction<LiabilitySessionConfig>
  >;
  investmentOwnerId: string;
  setInvestmentOwnerId: (ownerId: string) => void;
}) {
  return (
    <>
      <PageHead
        eyebrow="Plan · Current Plan"
        title="Where am I going?"
        text="Choose one authoritative engine scope at a time."
      />
      <section className="panel controls">
        <label>
          Forecast scope
          <select
            value={forecastScope}
            onChange={(event) =>
              setScope(event.target.value as ForecastRequest["scope"])
            }
          >
            <option value="cash_flow">Cash Flow</option>
            <option value="investments">Investments</option>
            <option value="liabilities">Liabilities</option>
          </select>
        </label>
        <label>
          As of
          <input type="date" value={settings.asOf} readOnly />
        </label>
        <label>
          Simulation
          <input
            value={`${settings.simulationStart} → ${settings.simulationEnd}`}
            readOnly
          />
        </label>
        <button className="primary" onClick={run}>
          Run {forecastScope.replace("_", " ")} forecast
        </button>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </section>
      {forecastScope === "liabilities" && (
        <LiabilityExecutionControls
          draft={draft}
          liabilityConfig={liabilityConfig}
          setLiabilityConfig={setLiabilityConfig}
        />
      )}
      {forecastScope === "investments" && (
        <InvestmentExecutionControls
          draft={draft}
          ownerId={investmentOwnerId}
          setOwnerId={setInvestmentOwnerId}
        />
      )}
      <section className="panel">
        <div className="scope-badge">
          Active scope: {forecastScope.replace("_", " ")}
        </div>
        {forecast ? (
          <ForecastVisual forecast={forecast} />
        ) : (
          <Empty text="No forecast run yet." />
        )}
      </section>
    </>
  );
}
function InvestmentExecutionControls({
  draft,
  ownerId,
  setOwnerId,
}: {
  draft: PersonalDraft;
  ownerId: string;
  setOwnerId: (ownerId: string) => void;
}) {
  const people = objectEntries(draft, "Person");
  return (
    <section className="panel controls">
      <h2>Investment execution configuration</h2>
      <p className="muted">
        Session-only explicit configuration. Select the Person whose investment
        scope should execute.
      </p>
      <label>
        Execution owner
        <select
          value={ownerId}
          onChange={(event) => setOwnerId(event.target.value)}
        >
          <option value="">Select a household person</option>
          {people.map((person) => (
            <option
              key={objectId("Person", person)}
              value={objectId("Person", person)}
            >
              {objectLabel("Person", person)}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
function LiabilityExecutionControls({
  draft,
  liabilityConfig,
  setLiabilityConfig,
}: {
  draft: PersonalDraft;
  liabilityConfig: LiabilitySessionConfig;
  setLiabilityConfig: React.Dispatch<
    React.SetStateAction<LiabilitySessionConfig>
  >;
}) {
  const mortgages = objectEntries(draft, "Liability").filter(
    (item) => item.liability_type === "mortgage",
  );
  const people = objectEntries(draft, "Person");
  const accounts = objectEntries(draft, "Account");
  const updateProfile = (
    id: string,
    field: keyof LiabilitySessionProfile,
    value: string,
  ) =>
    setLiabilityConfig((prior) => {
      const existing = prior.profiles[id] ?? EMPTY_LIABILITY_SESSION_PROFILE;
      return {
        ...prior,
        profiles: { ...prior.profiles, [id]: { ...existing, [field]: value } },
      };
    });
  return (
    <section className="panel controls">
      <h2>Debt execution configuration</h2>
      <p className="muted">
        Session-only explicit configuration. Leave a profile absent to receive a
        capability diagnostic rather than inferred terms.
      </p>
      <label>
        Execution owner
        <select
          value={liabilityConfig.ownerId}
          onChange={(event) =>
            setLiabilityConfig((prior) => ({
              ...prior,
              ownerId: event.target.value,
            }))
          }
        >
          <option value="">Select a household person</option>
          {people.map((person) => (
            <option
              key={objectId("Person", person)}
              value={objectId("Person", person)}
            >
              {objectLabel("Person", person)}
            </option>
          ))}
        </select>
      </label>
      {mortgages.map((mortgage) => {
        const id = objectId("Liability", mortgage);
        const profile =
          liabilityConfig.profiles[id] ?? EMPTY_LIABILITY_SESSION_PROFILE;
        return (
          <fieldset key={id}>
            <legend>{objectLabel("Liability", mortgage)}</legend>
            <label>
              Payment anchor
              <input
                type="date"
                value={profile.paymentAnchor}
                onChange={(event) =>
                  updateProfile(id, "paymentAnchor", event.target.value)
                }
              />
            </label>
            <label>
              Total payment count
              <input
                type="number"
                min="1"
                step="1"
                value={profile.totalPayments}
                onChange={(event) =>
                  updateProfile(id, "totalPayments", event.target.value)
                }
              />
            </label>
            <label>
              Funding account
              <select
                value={profile.fundingAccountId}
                onChange={(event) =>
                  updateProfile(id, "fundingAccountId", event.target.value)
                }
              >
                <option value="">Select funding account</option>
                {accounts.map((account) => (
                  <option
                    key={objectId("Account", account)}
                    value={objectId("Account", account)}
                  >
                    {objectLabel("Account", account)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Settlement priority
              <input
                type="number"
                min="0"
                step="1"
                value={profile.settlementPriority}
                onChange={(event) =>
                  updateProfile(id, "settlementPriority", event.target.value)
                }
              />
            </label>
          </fieldset>
        );
      })}
    </section>
  );
}
function DebtExecutionPanel({
  draft,
  liabilityConfig,
  setLiabilityConfig,
  run,
  forecast,
  error,
}: {
  draft: PersonalDraft;
  liabilityConfig: LiabilitySessionConfig;
  setLiabilityConfig: React.Dispatch<
    React.SetStateAction<LiabilitySessionConfig>
  >;
  run: () => void;
  forecast: PersonalForecastReadModel | undefined;
  error: string;
}) {
  return (
    <>
      <PageHead
        eyebrow="Net Worth · Debt"
        title="Debt schedule and funding"
        text="Edit canonical debt records, then provide explicit session-only execution terms for supported mortgages."
      />
      <LiabilityExecutionControls
        draft={draft}
        liabilityConfig={liabilityConfig}
        setLiabilityConfig={setLiabilityConfig}
      />
      <section className="panel">
        <button className="primary" onClick={run}>
          Run liability forecast
        </button>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        {forecast?.scope === "liabilities" ? (
          <ForecastVisual forecast={forecast} />
        ) : (
          <Empty text="Enter explicit execution configuration and run the liability forecast." />
        )}
      </section>
    </>
  );
}
function WhatIfStarter({
  draft,
  investmentOwnerId,
  liabilityConfig,
  runtimeIds,
  onCompare,
  onMajorAssetDebt,
}: {
  draft: PersonalDraft;
  investmentOwnerId: string;
  liabilityConfig: LiabilitySessionConfig;
  runtimeIds: {
    terminationEventId: string;
    extraPaymentId: string;
    alternativeScenarioId: string;
    majorAssetId: string;
    majorLiabilityId: string;
  };
  onCompare: (
    scope: "cash_flow" | "investments" | "liabilities",
    change: ScenarioChangeIntent,
    retirementBinding?: RetirementTerminationBinding,
  ) => void;
  onMajorAssetDebt: (addition: Parameters<typeof comparePersonalHouseholdMajorAssetDebtAddition>[2]) => void;
}) {
  const [incomeId, setIncomeId] = useState("");
  const [expenseId, setExpenseId] = useState("");
  const [rate, setRate] = useState("0.05");
  const [investmentId, setInvestmentId] = useState("");
  const [retirementIncomeId, setRetirementIncomeId] = useState("");
  const [retirementEventId, setRetirementEventId] = useState("");
  const [baselineDate, setBaselineDate] = useState("");
  const [retirementDate, setRetirementDate] = useState("");
  const [liabilityId, setLiabilityId] = useState("");
  const [extraAmount, setExtraAmount] = useState("");
  const [extraDate, setExtraDate] = useState("");
  const [extraFundingId, setExtraFundingId] = useState("");
  const [fundingScope, setFundingScope] = useState<"expense" | "loan">(
    "expense",
  );
  const [fundingTargetId, setFundingTargetId] = useState("");
  const [fundingAccountIds, setFundingAccountIds] = useState<string[]>([]);
  const [fundingCandidateId, setFundingCandidateId] = useState("");
  const [majorOwnerId, setMajorOwnerId] = useState("");
  const [majorName, setMajorName] = useState("");
  const [majorValue, setMajorValue] = useState("");
  const [majorDebt, setMajorDebt] = useState("");
  const [majorRate, setMajorRate] = useState("");
  const [majorAnchor, setMajorAnchor] = useState("");
  const [majorPayments, setMajorPayments] = useState("");
  const [majorMaturity, setMajorMaturity] = useState("");
  const [majorFunding, setMajorFunding] = useState("");
  const [majorPriority, setMajorPriority] = useState("");
  const incomes = objectEntries(draft, "Income");
  const expenses = objectEntries(draft, "Expense");
  const investments = objectEntries(draft, "Investment");
  const liabilities = objectEntries(draft, "Liability").filter(
    (item) => item.liability_type === "mortgage",
  );
  const accounts = objectEntries(draft, "Account");
  const households = objectEntries(draft, "Household");
  const retirementEvents = (
    (draft.objects as Record<string, readonly JsonObject[]>).Event ?? []
  ).filter(
    (item) =>
      item.enabled === true &&
      item.event_type === "retirement" &&
      item.trigger_type === "scheduled",
  );
  const exactRate = /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(rate);
  const exactExtraAmount = /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(extraAmount);
  const chosenEvent = retirementEvents.find(
    (item) => item.event_id === retirementEventId,
  );
  const runRetirement = () => {
    const runtimeEventId = runtimeIds.terminationEventId;
    const baseline =
      typeof chosenEvent?.start_date === "string"
        ? chosenEvent.start_date
        : baselineDate;
    const binding = {
      incomeId: retirementIncomeId,
      terminationEventId: runtimeEventId,
      baselineDate: baseline,
      ...(retirementEventId ? { canonicalEventId: retirementEventId } : {}),
    };
    onCompare(
      "cash_flow",
      {
        kind: "retirement_date",
        incomeId: retirementIncomeId,
        targetEventId: runtimeEventId,
        baselineDate: baseline,
        newDate: retirementDate,
      },
      binding,
    );
  };
  return (
    <>
      <PageHead
        eyebrow="Plan · What If?"
        title="Explore a what-if"
        text="Start with a supported deterministic change. Technical scenario metadata stays below."
      />
      <section className="panel">
        <label>
          Income target
          <select
            value={incomeId}
            onChange={(event) => setIncomeId(event.target.value)}
          >
            <option value="">Select an income</option>
            {incomes.map((income) => (
              <option
                key={objectId("Income", income)}
                value={objectId("Income", income)}
              >
                {objectLabel("Income", income)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Expense target
          <select
            value={expenseId}
            onChange={(event) => setExpenseId(event.target.value)}
          >
            <option value="">Select an expense</option>
            {expenses.map((expense) => (
              <option
                key={objectId("Expense", expense)}
                value={objectId("Expense", expense)}
              >
                {objectLabel("Expense", expense)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Exact effective annual rate
          <input
            aria-label="Exact effective annual rate"
            inputMode="decimal"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
          />
        </label>
        {!exactRate && (
          <p className="field-error" role="alert">
            Enter an exact decimal rate, such as 0.05.
          </p>
        )}
        <div className="object-grid">
          <article className="object-card">
            <h2>Add major asset financed by fixed debt</h2>
            <p>Projection-start alternative only; it does not create a future acquisition event or edit your saved baseline.</p>
            <select aria-label="Major asset owner" value={majorOwnerId} onChange={(event) => setMajorOwnerId(event.target.value)}><option value="">Select household owner</option>{households.map((item) => <option key={objectId("Household", item)} value={objectId("Household", item)}>{objectLabel("Household", item)}</option>)}</select>
            <input aria-label="Major asset name" value={majorName} onChange={(event) => setMajorName(event.target.value)} />
            <input aria-label="Major asset value" inputMode="decimal" value={majorValue} onChange={(event) => setMajorValue(event.target.value)} />
            <input aria-label="Major debt amount" inputMode="decimal" value={majorDebt} onChange={(event) => setMajorDebt(event.target.value)} />
            <input aria-label="Major debt annual rate" inputMode="decimal" value={majorRate} onChange={(event) => setMajorRate(event.target.value)} />
            <input aria-label="Major debt payment anchor" type="date" value={majorAnchor} onChange={(event) => setMajorAnchor(event.target.value)} />
            <input aria-label="Major debt total payments" type="number" value={majorPayments} onChange={(event) => setMajorPayments(event.target.value)} />
            <input aria-label="Major debt maturity date" type="date" value={majorMaturity} onChange={(event) => setMajorMaturity(event.target.value)} />
            <select aria-label="Major debt funding account" value={majorFunding} onChange={(event) => setMajorFunding(event.target.value)}><option value="">Select funding account</option>{accounts.map((item) => <option key={objectId("Account", item)} value={objectId("Account", item)}>{objectLabel("Account", item)}</option>)}</select>
            <input aria-label="Major debt settlement priority" type="number" value={majorPriority} onChange={(event) => setMajorPriority(event.target.value)} />
            <button className="primary" disabled={!majorOwnerId || !majorName || !majorValue || !majorDebt || !majorRate || !majorAnchor || !majorPayments || !majorMaturity || !majorFunding || !majorPriority} onClick={() => onMajorAssetDebt({
              asset: { asset_id: runtimeIds.majorAssetId, name: majorName, asset_type: "real_estate", owner_id: majorOwnerId, acquisition_date: majorAnchor, acquisition_cost: majorValue, valuation_method: "cost" },
              liability: { liability_id: runtimeIds.majorLiabilityId, name: `${majorName} debt`, liability_type: "mortgage", owner_id: majorOwnerId, principal: majorDebt, current_balance: majorDebt, interest_rate: majorRate, origination_date: majorAnchor, maturity_date: majorMaturity, collateral_id: runtimeIds.majorAssetId },
              profile: { liabilityId: runtimeIds.majorLiabilityId, kind: "vs4_fixed_monthly_fully_amortizing", paymentAnchor: majorAnchor, totalPayments: Number(majorPayments), fundingAccountId: majorFunding, settlementPriority: Number(majorPriority), openingContractStatus: "current" },
            })}>Compare major asset/debt</button>
          </article>
          <article className="object-card">
            <h2>Retire earlier/later</h2>
            <p>Changes only one executable income stop date.</p>
            <select
              aria-label="Retirement income"
              value={retirementIncomeId}
              onChange={(event) => setRetirementIncomeId(event.target.value)}
            >
              <option value="">Select income</option>
              {incomes.map((item) => (
                <option
                  key={objectId("Income", item)}
                  value={objectId("Income", item)}
                >
                  {objectLabel("Income", item)}
                </option>
              ))}
            </select>
            <select
              aria-label="Canonical retirement event"
              value={retirementEventId}
              onChange={(event) => {
                setRetirementEventId(event.target.value);
                const selected = retirementEvents.find(
                  (item) => item.event_id === event.target.value,
                );
                if (typeof selected?.start_date === "string")
                  setBaselineDate(selected.start_date);
              }}
            >
              <option value="">Session-only explicit binding</option>
              {retirementEvents.map((item) => (
                <option
                  key={String(item.event_id)}
                  value={String(item.event_id)}
                >
                  {String(item.name ?? item.event_id)}
                </option>
              ))}
            </select>
            <input
              aria-label="Baseline retirement date"
              type="date"
              value={baselineDate}
              disabled={Boolean(retirementEventId)}
              onChange={(event) => setBaselineDate(event.target.value)}
            />
            <input
              aria-label="New retirement date"
              type="date"
              value={retirementDate}
              onChange={(event) => setRetirementDate(event.target.value)}
            />
            <button
              className="primary"
              disabled={!retirementIncomeId || !baselineDate || !retirementDate}
              onClick={runRetirement}
            >
              Compare retirement date
            </button>
          </article>
          <article className="object-card">
            <h2>Earn more/less</h2>
            <p>
              Replace one selected income&apos;s exact effective-annual growth
              rate.
            </p>
            <button
              className="primary"
              disabled={!incomeId || !exactRate}
              onClick={() =>
                onCompare("cash_flow", {
                  kind: "income_growth",
                  incomeId,
                  annualRate: rate,
                })
              }
            >
              Compare income growth
            </button>
          </article>
          <article className="object-card">
            <h2>Spend more/less</h2>
            <p>
              Replace one selected expense&apos;s exact effective-annual
              inflation rate.
            </p>
            <button
              className="primary"
              disabled={!expenseId || !exactRate}
              onClick={() =>
                onCompare("cash_flow", {
                  kind: "expense_inflation",
                  expenseId,
                  annualRate: rate,
                })
              }
            >
              Compare spending growth
            </button>
          </article>
          <article className="object-card">
            <h2>Change investment returns</h2>
            <p>
              Runs only the selected investment scope, not a household-wide
              projection.
            </p>
            <select
              aria-label="Investment target"
              value={investmentId}
              onChange={(event) => setInvestmentId(event.target.value)}
            >
              <option value="">Select investment</option>
              {investments.map((item) => (
                <option
                  key={objectId("Investment", item)}
                  value={objectId("Investment", item)}
                >
                  {objectLabel("Investment", item)}
                </option>
              ))}
            </select>
            <button
              className="primary"
              disabled={!investmentId || !investmentOwnerId || !exactRate}
              onClick={() =>
                onCompare("investments", {
                  kind: "investment_return",
                  investmentId,
                  annualRate: rate,
                })
              }
            >
              Compare investment return
            </button>
            {(!investmentOwnerId || investments.length === 0) && (
              <p className="capability">
                {investments.length === 0
                  ? "No executable investment target exists."
                  : "Select an investment execution owner first."}
              </p>
            )}
          </article>
          <article className="object-card">
            <h2>Pay debt faster</h2>
            <p>
              Creates one explicit extra-principal payment; no refinance or
              recast.
            </p>
            <select
              aria-label="Liability target"
              value={liabilityId}
              onChange={(event) => setLiabilityId(event.target.value)}
            >
              <option value="">Select liability</option>
              {liabilities.map((item) => (
                <option
                  key={objectId("Liability", item)}
                  value={objectId("Liability", item)}
                >
                  {objectLabel("Liability", item)}
                </option>
              ))}
            </select>
            <input
              aria-label="Extra principal amount"
              inputMode="decimal"
              value={extraAmount}
              onChange={(event) => setExtraAmount(event.target.value)}
            />
            {extraAmount && !exactExtraAmount && (
              <p className="field-error" role="alert">
                Enter an exact decimal amount, such as 100.00.
              </p>
            )}
            <input
              aria-label="Extra principal date"
              type="date"
              value={extraDate}
              onChange={(event) => setExtraDate(event.target.value)}
            />
            <select
              aria-label="Extra principal funding account"
              value={extraFundingId}
              onChange={(event) => setExtraFundingId(event.target.value)}
            >
              <option value="">Select funding account</option>
              {accounts.map((item) => (
                <option
                  key={objectId("Account", item)}
                  value={objectId("Account", item)}
                >
                  {objectLabel("Account", item)}
                </option>
              ))}
            </select>
            <button
              className="primary"
              disabled={
                !liabilityId ||
                !exactExtraAmount ||
                !extraDate ||
                !extraFundingId ||
                !liabilityConfig.ownerId ||
                !liabilityConfig.profiles[liabilityId]
              }
              onClick={() =>
                onCompare("liabilities", {
                  kind: "extra_principal_payment",
                  operation: "add",
                  liabilityId,
                  paymentId: runtimeIds.extraPaymentId,
                  instruction: {
                    id: runtimeIds.extraPaymentId,
                    scheduledAt: extraDate,
                    amount: extraAmount,
                    fundingAccountId: extraFundingId,
                  },
                })
              }
            >
              Compare extra principal
            </button>
            {(!liabilityConfig.ownerId ||
              !liabilityConfig.profiles[liabilityId]) && (
              <p className="capability">
                Complete the debt execution profile first.
              </p>
            )}
          </article>
          <article className="object-card">
            <h2>Change funding behavior</h2>
            <p>
              Choose a target and add cash accounts in explicit priority order.
            </p>
            <select
              aria-label="Funding scope"
              value={fundingScope}
              onChange={(event) => {
                setFundingScope(event.target.value as "expense" | "loan");
                setFundingTargetId("");
              }}
            >
              <option value="expense">Expense</option>
              <option value="loan">Loan</option>
            </select>
            <select
              aria-label="Funding target"
              value={fundingTargetId}
              onChange={(event) => setFundingTargetId(event.target.value)}
            >
              <option value="">Select target</option>
              {(fundingScope === "expense" ? expenses : liabilities).map(
                (item) => (
                  <option
                    key={objectId(
                      fundingScope === "expense" ? "Expense" : "Liability",
                      item,
                    )}
                    value={objectId(
                      fundingScope === "expense" ? "Expense" : "Liability",
                      item,
                    )}
                  >
                    {objectLabel(
                      fundingScope === "expense" ? "Expense" : "Liability",
                      item,
                    )}
                  </option>
                ),
              )}
            </select>
            <select
              aria-label="Funding account to add"
              value={fundingCandidateId}
              onChange={(event) => setFundingCandidateId(event.target.value)}
            >
              <option value="">Select account</option>
              {accounts
                .filter(
                  (item) =>
                    !fundingAccountIds.includes(objectId("Account", item)),
                )
                .map((item) => (
                  <option
                    key={objectId("Account", item)}
                    value={objectId("Account", item)}
                  >
                    {objectLabel("Account", item)}
                  </option>
                ))}
            </select>
            <button
              disabled={!fundingCandidateId}
              onClick={() => {
                setFundingAccountIds((prior) => [...prior, fundingCandidateId]);
                setFundingCandidateId("");
              }}
            >
              Add funding source
            </button>
            <ol aria-label="Ordered funding accounts">
              {fundingAccountIds.map((id, index) => (
                <li key={id}>
                  <span>
                    {objectLabel(
                      "Account",
                      accounts.find(
                        (item) => objectId("Account", item) === id,
                      )!,
                    )}
                  </span>
                  <button
                    aria-label={`Move ${id} up`}
                    disabled={index === 0}
                    onClick={() =>
                      setFundingAccountIds((prior) =>
                        prior.map((value, position) =>
                          position === index - 1
                            ? id
                            : position === index
                              ? prior[index - 1]!
                              : value,
                        ),
                      )
                    }
                  >
                    Move Up
                  </button>
                  <button
                    aria-label={`Move ${id} down`}
                    disabled={index === fundingAccountIds.length - 1}
                    onClick={() =>
                      setFundingAccountIds((prior) =>
                        prior.map((value, position) =>
                          position === index + 1
                            ? id
                            : position === index
                              ? prior[index + 1]!
                              : value,
                        ),
                      )
                    }
                  >
                    Move Down
                  </button>
                  <button
                    aria-label={`Remove ${id}`}
                    onClick={() =>
                      setFundingAccountIds((prior) =>
                        prior.filter((value) => value !== id),
                      )
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ol>
            <button
              className="primary"
              disabled={
                !fundingTargetId ||
                fundingAccountIds.length === 0 ||
                (fundingScope === "loan" &&
                  (!liabilityConfig.ownerId ||
                    !liabilityConfig.profiles[fundingTargetId]))
              }
              onClick={() =>
                onCompare(
                  fundingScope === "expense" ? "cash_flow" : "liabilities",
                  fundingScope === "expense"
                    ? {
                        kind: "expense_funding_policy",
                        expenseId: fundingTargetId,
                        policy: {
                          id: "what-if-expense-funding",
                          orderedAccountIds: fundingAccountIds,
                          allowPartial: false,
                          insufficientFundsBehavior: "unfunded",
                        },
                      }
                    : {
                        kind: "loan_funding_policy",
                        liabilityId: fundingTargetId,
                        policy: {
                          id: "what-if-loan-funding",
                          orderedAccountIds: fundingAccountIds,
                          allowPartial: false,
                          insufficientFundsBehavior: "unfunded",
                        },
                      },
                )
              }
            >
              Compare funding policy
            </button>
          </article>
        </div>
        <p className="muted">
          Comparisons are deterministic and scope-specific. Investment purchases
          mean modeled investment-position purchases only. Cross-slice household
          effects remain capability-gated.
        </p>
      </section>
    </>
  );
}

function ComparePlans({
  comparison,
  legacyComparison,
  onRun,
  draft,
  retirementBindings,
}: {
  comparison: PersonalHouseholdScenarioComparisonReadModel | undefined;
  legacyComparison: PersonalScenarioComparisonReadModel | undefined;
  onRun: () => void;
  draft: PersonalDraft;
  retirementBindings: readonly RetirementTerminationBinding[];
}) {
  const canonicalEvents =
    ((draft.objects as Record<string, readonly JsonObject[]>).Event ?? []);
  return (
    <>
      <PageHead
        eyebrow="Plan · Compare Plans"
        title="Compare household plans"
        text="Each supported alternative reruns the authoritative reconciled household projection; standalone detail remains available below."
      />
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Current plan vs alternatives</h2>
            <p>
              Cash, investments, assets, liabilities, and net worth share one
              reconciled state.
            </p>
          </div>
          <button className="primary" onClick={onRun}>
            Compare configured household alternatives
          </button>
        </div>
        {comparison?.status === "completed" ||
        comparison?.status === "incomplete" ? (
          <>
            {comparison.alternatives.map((alternative) => (
              <section key={alternative.name}>
                <h3>
                  {alternative.name} · {alternative.status}
                </h3>
                {alternative.declaredDifference && (
                  <p className="capability">Declared difference: {alternative.declaredDifference.replaceAll("_", " ")}</p>
                )}
                {alternative.points.some(
                  (point) => point.alternative.liquidityShortfalls.length > 0,
                ) && (
                  <div className="stress" role="alert">
                    <strong>
                      Financial outcome · Modeled liquidity stress
                    </strong>
                    <p>
                      This scenario contains a modeled shortfall. It is not an
                      application error.
                    </p>
                  </div>
                )}
                {alternative.configurationDifferences.map((difference) => {
                  const explicitBinding = retirementBindings.find((binding) =>
                    difference.semanticTarget.includes(
                      binding.terminationEventId,
                    ),
                  );
                  const referencedIds = [
                    ...difference.eventIds.map(String),
                    ...(explicitBinding?.canonicalEventId
                      ? [explicitBinding.canonicalEventId]
                      : []),
                  ];
                  return (
                    <p className="capability" key={difference.differenceId}>
                      {difference.changeKind.replaceAll("_", " ")} ·{" "}
                      {difference.semanticTarget} · layer{" "}
                      {difference.scenarioLayerId}
                      {referencedIds.length > 0
                        ? ` · events ${referencedIds
                            .map((id) => {
                              const event = canonicalEvents.find(
                                (candidate) =>
                              String(candidate.event_id) === id,
                              );
                            return event ? String(event.name ?? id) : id;
                            })
                            .join(", ")}`
                        : ""}
                    </p>
                  );
                })}
                <p className="muted">
                  Applied-rule differences: alternative-only{" "}
                  {alternative.appliedRuleDifferences.alternativeOnly.join(
                    ", ",
                  ) || "none"}
                  ; baseline-only{" "}
                  {alternative.appliedRuleDifferences.baselineOnly.join(", ") ||
                    "none"}
                  .
                </p>
                <div className="table-scroll">
                  <table
                    aria-label={`${alternative.name} household comparison`}
                  >
                    <thead>
                      <tr>
                        <th>Period</th>
                        <th>Cash Δ</th>
                        <th>Investment Δ</th>
                        <th>Assets Δ</th>
                        <th>Liabilities Δ</th>
                        <th>Net worth Δ</th>
                        <th>Why?</th>
                      </tr>
                    </thead>
                    <tbody>
                      {alternative.points.map((point) => {
                        const explanation = resolveHouseholdExplanation(
                          draft,
                          point.traceRefs,
                        );
                        return (
                          <tr key={point.periodStart}>
                            <td>{point.periodStart.slice(0, 10)}</td>
                            <td>{householdMoney(point.deltas.cash)}</td>
                            <td>
                              {householdMoney(point.deltas.investmentValue)}
                            </td>
                            <td>{householdMoney(point.deltas.totalAssets)}</td>
                            <td>
                              {householdMoney(point.deltas.totalLiabilities)}
                            </td>
                            <td>{householdMoney(point.deltas.netWorth)}</td>
                            <td>
                              <details>
                                <summary>Explain</summary>
                                <p>
                                  Scenario differences associated with this
                                  changed result:{" "}
                                  {point.relatedDifferenceIds.join(", ") ||
                                    "none"}
                                  .
                                </p>
                                <p>
                                  Source records carried by this result:{" "}
                                  {explanation.sources
                                    .map((item) => item.label)
                                    .join(", ") || "see raw trace metadata"}
                                  .
                                </p>
                                <p>
                                  Assumptions referenced by the calculation
                                  trace:{" "}
                                  {explanation.assumptions
                                    .map((item) => item.label)
                                    .join(", ") || "none"}
                                  .
                                </p>
                                <p>
                                  Rules referenced by the calculation trace:{" "}
                                  {explanation.rules
                                    .map((item) => item.label)
                                    .join(", ") || "none"}
                                  .
                                </p>
                                <p>
                                  Event references:{" "}
                                  {explanation.events
                                    .map((item) => item.label)
                                    .join(", ") || "none"}
                                  .
                                </p>
                                <code>
                                  {point.traceRefs
                                    .map((ref) => ref.traceId)
                                    .join("\n")}
                                </code>
                              </details>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </>
        ) : comparison?.status === "unavailable" ? (
          <DiagnosticList
            diagnostics={comparison.diagnostics}
            fallback={comparison.message}
          />
        ) : (
          <Empty text="No household comparison is available yet." />
        )}
      </section>
      {legacyComparison?.status === "completed" ||
      legacyComparison?.status === "incomplete" ? (
        <section className="panel">
          <h2>Scope-specific comparison detail</h2>
          <div className="scope-badge">
            Active scope: {legacyComparison.scope.replace("_", " ")} ·{" "}
            {legacyComparison.status}
          </div>
          <div className="table-scroll">
            <table>
              <caption>
                Current plan, alternative, and alternative-minus-current delta
              </caption>
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Metric</th>
                  <th>Current plan</th>
                  <th>Alternative</th>
                  <th>Delta</th>
                  <th>Why?</th>
                </tr>
              </thead>
              <tbody>
                {legacyComparison.points.flatMap((point) =>
                  Object.entries(
                    point.metrics ?? {
                      primary: {
                        baseline: point.baseline,
                        alternative: point.alternative,
                        delta: point.delta,
                      },
                    },
                  ).map(([metric, values]) => (
                    <tr key={`${point.period}:${metric}`}>
                      <td>{point.period.slice(0, 10)}</td>
                      <td>{metric.replaceAll(/([A-Z])/g, " $1")}</td>
                      <td>{values.baseline.display}</td>
                      <td>{values.alternative.display}</td>
                      <td>{values.delta.display}</td>
                      <td>
                        <details>
                          <summary>Explain</summary>
                          <code>
                            {[
                              ...point.relatedDifferenceIds,
                              ...point.traceIds,
                            ].join("\n")}
                          </code>
                        </details>
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
          <div className="capability">
            <strong>Configuration differences</strong>
            {legacyComparison.configurationDifferences.map((difference) => (
              <p key={difference.target}>
                {difference.kind.replaceAll("_", " ")} · {difference.target} ·
                layer {difference.scenarioLayerId}
              </p>
            ))}
          </div>
        </section>
      ) : (
        !comparison && (
          <section className="panel">
            <Empty
              text={
                legacyComparison?.message ??
                "No executable comparison is available yet."
              }
            />
          </section>
        )
      )}
    </>
  );
}
function ModelSettings({
  settings,
  setSettings,
  error,
}: {
  settings: PersonalSessionSettings;
  setSettings: Dispatch<SetStateAction<PersonalSessionSettings>>;
  error: string;
}) {
  const update = (field: keyof PersonalSessionSettings, value: string) =>
    setSettings((current) => ({ ...current, [field]: value }));
  const resolved = resolvePersonalSessionSettings(settings, "cash_flow");
  return (
    <>
      <PageHead
        eyebrow="Settings · Model Settings"
        title="Dates and conventions"
        text="Model dates are explicit; wall-clock today is never authoritative."
      />
      <section className="panel form-grid">
        <label>
          Base currency
          <input
            aria-label="Base currency"
            value={settings.baseCurrency}
            onChange={(event) => update("baseCurrency", event.target.value)}
          />
        </label>
        <label>
          As of
          <input
            type="date"
            value={settings.asOf}
            onChange={(event) => update("asOf", event.target.value)}
          />
        </label>
        <label>
          Data cutoff
          <input
            type="date"
            value={settings.dataCutoff}
            onChange={(event) => update("dataCutoff", event.target.value)}
          />
        </label>
        <label>
          Simulation start
          <input
            type="date"
            value={settings.simulationStart}
            onChange={(event) => update("simulationStart", event.target.value)}
          />
        </label>
        <label>
          Simulation end
          <input
            type="date"
            value={settings.simulationEnd}
            onChange={(event) => update("simulationEnd", event.target.value)}
          />
        </label>
        <label>
          Same-time cash-flow order
          <select
            aria-label="Same-time cash-flow order"
            value={settings.sameInstantCashFlowOrder}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                sameInstantCashFlowOrder: event.target.value as
                  | "income_before_expense"
                  | "expense_before_income",
              }))
            }
          >
            <option value="income_before_expense">Income before expense</option>
            <option value="expense_before_income">Expense before income</option>
          </select>
        </label>
        <label>
          Default horizon
          <input
            value={
              resolved.request ? `${resolved.request.months} months` : "Invalid"
            }
            readOnly
          />
        </label>
        {(error || resolved.error) && (
          <p className="field-error full" role="alert">
            {error || resolved.error}
          </p>
        )}
        <p className="muted full">
          These controls configure the current browser session. No persistence
          is introduced in PR 14.
        </p>
      </section>
    </>
  );
}

function EditorHub({
  types,
  draft,
  setDraft,
  metadata,
  setNotice,
}: {
  types: readonly PersonalObjectType[];
  draft: PersonalDraft;
  setDraft: (draft: PersonalDraft) => void;
  metadata: ReturnType<typeof getPersonalEditorMetadata>;
  setNotice: (message: string) => void;
}) {
  return (
    <>
      {types.map((type) => (
        <ObjectEditor
          key={type}
          type={type}
          draft={draft}
          setDraft={setDraft}
          metadata={metadata}
          setNotice={setNotice}
        />
      ))}
    </>
  );
}
function ObjectEditor({
  type,
  draft,
  setDraft,
  metadata,
  setNotice,
}: {
  type: PersonalObjectType;
  draft: PersonalDraft;
  setDraft: (draft: PersonalDraft) => void;
  metadata: ReturnType<typeof getPersonalEditorMetadata>;
  setNotice: (message: string) => void;
}) {
  const [editing, setEditing] = useState<JsonObject>();
  const values = objectEntries(draft, type);
  const descriptor = metadata[type];
  const add = () => {
    const id = randomId();
    const next = addPersonalObject(draft, type, id);
    setDraft(next);
    setEditing(
      objectEntries(next, type).find((value) => objectId(type, value) === id)!,
    );
  };
  const saveField = (
    field: string,
    value: string | boolean | readonly string[],
  ) => {
    if (!editing) return;
    const next = patchPersonalObject(draft, type, objectId(type, editing), {
      [field]: value,
    });
    setDraft(next);
    setEditing(
      objectEntries(next, type).find(
        (item) => objectId(type, item) === objectId(type, editing),
      ),
    );
  };
  const secondaryFields = Object.keys(descriptor.fields).filter(
    (fieldName) =>
      fieldName !== descriptor.idField &&
      !PRIMARY_FIELDS[type].includes(fieldName) &&
      !(descriptor.fields as Record<string, { derived: boolean }>)[fieldName]
        ?.derived,
  );
  const remove = (item: JsonObject) => {
    const result = deletePersonalObject(draft, type, objectId(type, item));
    if (!result.deleted) {
      setNotice(`Cannot delete: referenced by ${result.references.join(", ")}`);
      return;
    }
    setDraft(result.draft);
    setEditing(undefined);
  };
  return (
    <section>
      <div className="page-head compact">
        <div>
          <p className="eyebrow">{TITLES[type]}</p>
          <h1>{TITLES[type]}</h1>
          <p>Friendly editing with technical metadata kept under Advanced.</p>
        </div>
        <button className="primary" onClick={add}>
          + Add {TITLES[type].replace(/s$/, "")}
        </button>
      </div>
      {values.length === 0 ? (
        <Empty text={`No ${TITLES[type].toLowerCase()} yet.`} />
      ) : (
        <div className="object-grid">
          {values.map((item) => (
            <article className="object-card" key={objectId(type, item)}>
              <button className="card-main" onClick={() => setEditing(item)}>
                <span className="object-icon">{TITLES[type][0]}</span>
                <span>
                  <strong>{objectLabel(type, item) || `New ${type}`}</strong>
                  <small>
                    {PRIMARY_FIELDS[type]
                      .slice(0, 3)
                      .map((field) => item[field])
                      .filter(Boolean)
                      .join(" · ") || "Needs details"}
                  </small>
                </span>
              </button>
              <button className="danger-link" onClick={() => remove(item)}>
                Delete
              </button>
            </article>
          ))}
        </div>
      )}
      {editing && (
        <div
          className="drawer-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setEditing(undefined);
          }}
        >
          <aside className="drawer" aria-label={`Edit ${type}`}>
            <div className="panel-head">
              <div>
                <p className="eyebrow">Edit {type}</p>
                <h2>{objectLabel(type, editing) || `New ${type}`}</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close editor"
                onClick={() => setEditing(undefined)}
              >
                ×
              </button>
            </div>
            <div className="form-grid">
              {PRIMARY_FIELDS[type].map((fieldName) => (
                <FieldControl
                  key={fieldName}
                  fieldName={fieldName}
                  field={(descriptor.fields as Record<string, any>)[fieldName]}
                  value={editing[fieldName]}
                  draft={draft}
                  onChange={(value) => saveField(fieldName, value)}
                />
              ))}
            </div>
            <details>
              <summary>More options</summary>
              <div className="form-grid">
                {secondaryFields.length ? (
                  secondaryFields.map((fieldName) => (
                    <FieldControl
                      key={fieldName}
                      fieldName={fieldName}
                      field={
                        (descriptor.fields as Record<string, any>)[fieldName]
                      }
                      value={editing[fieldName]}
                      draft={draft}
                      onChange={(value) => saveField(fieldName, value)}
                    />
                  ))
                ) : (
                  <p className="muted">No secondary fields for this item.</p>
                )}
              </div>
            </details>
            <details>
              <summary>Advanced</summary>
              <dl className="advanced-list">
                <dt>{type} ID</dt>
                <dd>{objectId(type, editing)}</dd>
                {Object.entries(descriptor.fields)
                  .filter(([, field]) => field.ref)
                  .map(([name, field]) => (
                    <span key={name}>
                      <dt>{name}</dt>
                      <dd>
                        {String(editing[name] ?? "Not set")}{" "}
                        <small>→ {field.ref}</small>
                      </dd>
                    </span>
                  ))}
              </dl>
            </details>
          </aside>
        </div>
      )}
    </section>
  );
}
function FieldControl({
  fieldName,
  field,
  value,
  draft,
  onChange,
}: {
  fieldName: string;
  field: any;
  value: unknown;
  draft: PersonalDraft;
  onChange: (value: string | boolean | readonly string[]) => void;
}) {
  if (!field || field.derived) return null;
  const label = FIELD_LABELS[fieldName] ?? fieldName.replaceAll("_", " ");
  if (field.type === "boolean")
    return (
      <label className="check">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
        {label}
      </label>
    );
  if (field.enumValues)
    return (
      <label>
        {label}
        <select
          value={String(value ?? "")}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Choose…</option>
          {field.enumValues.map((option: string) => (
            <option key={option} value={option}>
              {option.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
    );
  if (field.ref) {
    const targets = String(field.ref)
      .split("|")
      .filter((target) =>
        PERSONAL_OBJECT_TYPES.includes(target as PersonalObjectType),
      ) as PersonalObjectType[];
    const options = targets.flatMap((target) =>
      objectEntries(draft, target).map((item) => ({
        id: objectId(target, item),
        label: objectLabel(target, item),
      })),
    );
    if (field.type === "uuid[]")
      return (
        <label>
          {label}
          <select
            multiple
            value={Array.isArray(value) ? value.map(String) : []}
            onChange={(event) =>
              onChange(
                Array.from(
                  event.target.selectedOptions,
                  (option) => option.value,
                ),
              )
            }
          >
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label || option.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
      );
    return (
      <label>
        {label}
        <select
          value={String(value ?? "")}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Choose…</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label || option.id.slice(0, 8)}
            </option>
          ))}
        </select>
      </label>
    );
  }
  const inputType = field.type === "date" ? "date" : "text";
  return (
    <label>
      {label}
      <input
        type={inputType}
        value={String(value ?? "")}
        inputMode={
          ["money", "rate", "decimal"].includes(field.type)
            ? "decimal"
            : undefined
        }
        placeholder={field.required ? "Required" : "Optional"}
        onChange={(event) => onChange(event.target.value)}
      />
      {["money", "rate", "decimal"].includes(field.type) && (
        <small>Exact decimal text</small>
      )}
    </label>
  );
}

function DiagnosticList({
  diagnostics,
  fallback,
}: {
  diagnostics: readonly any[];
  fallback?: string;
}) {
  return (
    <div className="capability">
      <strong>Configuration or capability diagnostics</strong>
      {diagnostics.length === 0 ? (
        <p>{fallback ?? "No richer diagnostic is available."}</p>
      ) : (
        diagnostics.map((item, index) => (
          <p key={`${item.code}:${item.entityId ?? index}`}>
            <strong>{item.code}</strong>: {item.message}
            {item.capability ? ` · capability ${item.capability}` : ""}
            {item.entityType
              ? ` · ${item.entityType}${item.entityId ? ` ${item.entityId}` : ""}`
              : ""}
            {item.fieldPath ? ` · field ${item.fieldPath}` : ""}
            {item.relatedIds?.length
              ? ` · related ${item.relatedIds.join(", ")}`
              : ""}
          </p>
        ))
      )}
    </div>
  );
}

function HouseholdPlan({
  draft,
  forecast,
  run,
  error,
  cashFlowExecutionAccountId,
  setCashFlowExecutionAccountId,
  investmentOwnerId,
  setInvestmentOwnerId,
  liabilityConfig,
  setLiabilityConfig,
  retirementBindings,
  setHouseholdExecution,
}: {
  draft: PersonalDraft;
  forecast: PersonalHouseholdForecastReadModel | undefined;
  run: () => void;
  error: string;
  cashFlowExecutionAccountId: string;
  setCashFlowExecutionAccountId: (value: string) => void;
  investmentOwnerId: string;
  setInvestmentOwnerId: (value: string) => void;
  liabilityConfig: LiabilitySessionConfig;
  setLiabilityConfig: React.Dispatch<React.SetStateAction<LiabilitySessionConfig>>;
  retirementBindings: readonly RetirementTerminationBinding[];
  setHouseholdExecution: () => void;
}) {
  const accounts = objectEntries(draft, "Account");
  return (
    <>
      <PageHead
        eyebrow="Plan · Current Plan"
        title="Your reconciled household plan"
        text="One execution carries cash flow, investments, debt, property, and retirement through the same state transition."
      />
      <section className="panel controls" aria-label="Household execution configuration">
        <h2>Household execution configuration</h2>
        <p className="muted">Session-only. These explicit choices are not saved with the canonical model.</p>
        <label>
          Cash-flow execution account
          <select value={cashFlowExecutionAccountId} onChange={(event) => setCashFlowExecutionAccountId(event.target.value)}>
            <option value="">Select funding account</option>
            {accounts.map((account) => <option key={objectId("Account", account)} value={objectId("Account", account)}>{objectLabel("Account", account)}</option>)}
          </select>
        </label>
        <InvestmentExecutionControls draft={draft} ownerId={investmentOwnerId} setOwnerId={setInvestmentOwnerId} />
        <LiabilityExecutionControls draft={draft} liabilityConfig={liabilityConfig} setLiabilityConfig={setLiabilityConfig} />
        <p className="muted">Retirement binding: {retirementBindings.length ? `${retirementBindings.length} explicit binding(s) configured.` : "none configured (optional)."}</p>
        <button className="primary" onClick={setHouseholdExecution}>Apply household execution configuration</button>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Authoritative household forecast</h2>
          <button className="primary" onClick={run}>
            Run household forecast
          </button>
        </div>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        {forecast?.status === "completed" ||
        forecast?.status === "incomplete" ? (
          <HouseholdForecastVisual forecast={forecast} draft={draft} />
        ) : forecast?.status === "unavailable" ? (
          <DiagnosticList
            diagnostics={forecast.diagnostics}
            fallback={forecast.message}
          />
        ) : (
          <Empty text="Run the current household plan." />
        )}
      </section>
    </>
  );
}

function HouseholdForecastVisual({
  forecast,
  draft,
  cashFlowOnly = false,
}: {
  forecast: Extract<
    PersonalHouseholdForecastReadModel,
    { status: "completed" | "incomplete" }
  >;
  draft: PersonalDraft;
  cashFlowOnly?: boolean;
}) {
  const chart = forecast.points.map((point) => ({
    period: point.periodStart.slice(0, 7),
    netWorth: chartNumber(point.netWorth.amount),
    assets: chartNumber(point.totalAssets.amount),
    liabilities: chartNumber(point.totalLiabilities.amount),
    cash: chartNumber(point.cash.amount),
  }));
  return (
    <>
      <div className="boundary-banner">
        <strong>As of {forecast.asOf}</strong>
        <span>No observed history loaded</span>
        <span>
          Requested {forecast.requestedHorizon.start.slice(0, 10)} →{" "}
          {forecast.requestedHorizon.end.slice(0, 10)}
        </span>
        <span>
          {forecast.status === "completed"
            ? `Completed through ${forecast.reachedThrough?.slice(0, 10)}`
            : `Incomplete; stopped at ${forecast.stoppedAt?.slice(0, 10)}`}
        </span>
      </div>
      {forecast.liquidityShortfalls.length > 0 && (
        <div className="stress" role="alert">
          <strong>Financial outcome · Modeled liquidity stress</strong>
          <p>
            {forecast.liquidityShortfalls.length} shortfall(s) were modeled.
            This is not an application error.
          </p>
        </div>
      )}{" "}
      {forecast.retirementMilestones.length > 0 && (
        <section className="panel">
          <h3>Modeled retirement milestone</h3>
          {forecast.retirementMilestones.map((milestone) => (
            <p key={milestone.eventId}>{milestone.label} · {milestone.date}</p>
          ))}
        </section>
      )}
      {!cashFlowOnly && (
        <div className="chart">
          <ResponsiveContainer>
            <LineChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="period" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line dataKey="netWorth" stroke="#26755f" strokeWidth={3} />
              <Line dataKey="assets" stroke="#3e5f8a" />
              <Line dataKey="liabilities" stroke="#c07845" />
              <Line dataKey="cash" stroke="#8b6cab" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="table-scroll">
        <table aria-label="Reconciled household forecast">
          <thead>
            <tr>
              <th>Period</th>
              <th>Income</th>
              <th>Expenses</th>
              <th>Cash</th>
              <th>Investments</th>
              <th>Assets</th>
              <th>Liabilities</th>
              <th>Net worth</th>
              <th>Why?</th>
            </tr>
          </thead>
          <tbody>
            {forecast.points.map((point) => {
              const explanation = resolveHouseholdExplanation(
                draft,
                point.traceRefs,
              );
              return (
                <tr key={point.periodStart}>
                  <td>{point.periodStart.slice(0, 10)}</td>
                  <td>{householdMoney(point.statementIncome)}</td>
                  <td>{householdMoney(point.statementExpenses)}</td>
                  <td>{householdMoney(point.cash)}</td>
                  <td>{householdMoney(point.investmentValue)}</td>
                  <td>{householdMoney(point.totalAssets)}</td>
                  <td>{householdMoney(point.totalLiabilities)}</td>
                  <td>{householdMoney(point.netWorth)}</td>
                  <td>
                    <details>
                      <summary>Explain</summary>
                      <p>
                        Source records carried by this result:{" "}
                        {explanation.sources
                          .map((item) => item.label)
                          .join(", ") || "none resolved"}
                        .
                      </p>
                      <p>
                        Assumptions referenced by the calculation trace:{" "}
                        {explanation.assumptions
                          .map(
                            (item) =>
                              `${item.label}${item.value ? ` (${item.value} ${item.unit ?? ""})` : ""}`,
                          )
                          .join(", ") || "none"}
                        .
                      </p>
                      <p>
                        Rules referenced by the calculation trace:{" "}
                        {explanation.rules
                          .map((item) => item.label)
                          .join(", ") || "none"}
                        .
                      </p>
                      <p>
                        Event references:{" "}
                        {explanation.events
                          .map((item) => item.label)
                          .join(", ") || "none"}
                        .
                      </p>
                      <code>
                        {point.traceRefs.map((ref) => ref.traceId).join("\n")}
                      </code>
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {forecast.diagnostics.length > 0 && (
        <DiagnosticList diagnostics={forecast.diagnostics} />
      )}
    </>
  );
}

function ForecastVisual({ forecast }: { forecast: PersonalForecastReadModel }) {
  // Compiler diagnostics carry an explicit capability discriminator. Engine
  // validation issues (including liquidity shortfalls) describe this run, not
  // the supported surface area of the liability compiler.
  const isCapabilityDiagnostic = (
    value: (typeof forecast.diagnostics)[number],
  ): value is (typeof forecast.diagnostics)[number] & { capability: string } =>
    "capability" in value && typeof value.capability === "string";
  if (forecast.status === "unavailable")
    return (
      <div className="capability">
        <strong>Forecast unavailable for this model</strong>
        <p>{forecast.message}</p>
        <dl className="boundary">
          <dt>As of</dt>
          <dd>{forecast.asOf}</dd>
          <dt>Data cutoff</dt>
          <dd>{forecast.dataCutoff}</dd>
        </dl>
      </div>
    );
  if (forecast.scope === "liabilities") {
    const capabilityDiagnostics = forecast.diagnostics.filter(
      isCapabilityDiagnostic,
    );
    const executionDiagnostics = forecast.diagnostics.filter(
      (item) => !isCapabilityDiagnostic(item),
    );
    return (
      <>
        <div className="boundary-banner">
          <strong>As of {forecast.asOf}</strong>
          <span>Debt-service projection</span>
        </div>
        <div className="table-scroll">
          <table>
            <caption>Detailed liability forecast</caption>
            <thead>
              <tr>
                <th>Scheduled</th>
                <th>Opening principal</th>
                <th>Interest</th>
                <th>Contractual payment</th>
                <th>Scheduled principal</th>
                <th>Extra principal</th>
                <th>Ending principal</th>
                <th>Outstanding interest</th>
                <th>Required funding</th>
                <th>Extra funding</th>
                <th>Why?</th>
              </tr>
            </thead>
            <tbody>
              {forecast.liabilityOccurrences.map((item) => (
                <tr key={`${item.loanId}:${item.scheduledAt}`}>
                  <td>{item.scheduledAt.slice(0, 10)}</td>
                  <td>{item.openingPrincipal.display}</td>
                  <td>{item.currentInterestExpense.display}</td>
                  <td>{item.contractualPayment.display}</td>
                  <td>{item.scheduledPrincipalPaid.display}</td>
                  <td>{item.extraPrincipalPaid.display}</td>
                  <td>{item.endingPrincipal.display}</td>
                  <td>{item.outstandingInterest.display}</td>
                  <td>{item.scheduledFundingStatus}</td>
                  <td>{item.extraFundingStatus ?? "—"}</td>
                  <td>
                    <details>
                      <summary>Explain</summary>
                      <code>
                        {item.traceIds.join("\n") || "No trace metadata"}
                      </code>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {forecast.liabilityPayoffs.length > 0 && (
          <p className="muted">
            Payoff:{" "}
            {forecast.liabilityPayoffs
              .map(
                (item) =>
                  `${item.liabilityId} at ${item.scheduledAt.slice(0, 10)}`,
              )
              .join(", ")}
          </p>
        )}
        {forecast.shortfalls.map((item) => (
          <div
            className="stress-detail"
            key={`${item.period}:${item.entityId}:${item.origin}`}
          >
            <strong>
              {item.period.slice(0, 10)} · {item.unfunded.display} unfunded (
              {item.origin === "required_debt_service"
                ? "required debt service"
                : "optional extra principal"}
              )
            </strong>
            <p>{item.diagnostic}</p>
          </div>
        ))}
        {capabilityDiagnostics.length > 0 && (
          <div className="capability">
            <strong>
              Debt coverage is partial where diagnostics are listed
            </strong>
            {capabilityDiagnostics.map((item, index) => (
              <p key={`${item.code}:${item.entityId ?? index}`}>
                {item.code}: {item.message}
              </p>
            ))}
          </div>
        )}
        {executionDiagnostics.length > 0 && (
          <div className="stress-detail">
            <strong>Forecast diagnostics</strong>
            {executionDiagnostics.map((item, index) => (
              <p key={`${item.code}:${item.entityId ?? index}`}>
                {item.code}: {item.message}
              </p>
            ))}
          </div>
        )}
      </>
    );
  }
  if (forecast.scope === "investments")
    return (
      <>
        <div className="boundary-banner">
          <strong>As of {forecast.asOf}</strong>
          <span>Independent investment projection</span>
        </div>
        <div className="table-scroll">
          <table>
            <caption>Detailed investment forecast</caption>
            <thead>
              <tr>
                <th>Period</th>
                <th>Portfolio</th>
                <th>Contribution principal</th>
                <th>Fees</th>
                <th>Unrealized gain</th>
                <th>Realized gain</th>
                <th>Cash investment income</th>
                <th>Accounts</th>
                <th>Why?</th>
              </tr>
            </thead>
            <tbody>
              {forecast.points.map((point) => (
                <tr key={point.periodStart}>
                  <td>{point.periodStart.slice(0, 10)}</td>
                  <td>{point.portfolioValue.display}</td>
                  <td>{point.contributionPrincipal.display}</td>
                  <td>{point.fees.display}</td>
                  <td>{point.unrealizedGain.display}</td>
                  <td>{point.realizedGain.display}</td>
                  <td>{point.cashInvestmentIncome.display}</td>
                  <td>
                    {point.accountValues
                      .map((item) => `${item.accountId}: ${item.value.display}`)
                      .join("; ")}
                  </td>
                  <td>
                    <details>
                      <summary>Explain</summary>
                      <code>
                        {point.traceIds.join("\n") || "No trace metadata"}
                      </code>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {forecast.diagnostics.length > 0 && (
          <div className="stress-detail">
            <strong>Forecast diagnostics</strong>
            {forecast.diagnostics.map((item, index) => (
              <p key={`${item.code}:${item.entityId ?? index}`}>
                {item.code}: {item.message}
              </p>
            ))}
          </div>
        )}
      </>
    );
  const data = forecast.points.map((point) => ({
    period: point.periodStart.slice(0, 7),
    income: chartNumber(point.income.exact),
    spending: chartNumber(point.spending.exact),
    net: chartNumber(point.netCashFlow.exact),
  }));
  return (
    <>
      <div className="boundary-banner">
        <strong>As of {forecast.asOf}</strong>
        <span>No observed history loaded</span>
        <span>Projected →</span>
      </div>
      {forecast.shortfalls.length > 0 && (
        <div className="stress" role="alert">
          <strong>Financial outcome · Modeled stress</strong>
          <p>
            {forecast.shortfalls.length} period(s) have insufficient liquidity.
            The forecast completed; this is not an application error.
          </p>
        </div>
      )}
      <div className="chart">
        <ResponsiveContainer>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="period" />
            <YAxis />
            <Tooltip />
            <Legend />
            {data[0] && (
              <ReferenceLine x={data[0].period} stroke="#b66a3c" label="asOf" />
            )}
            <Line
              type="monotone"
              dataKey="income"
              stroke="#26755f"
              strokeWidth={3}
            />
            <Line
              type="monotone"
              dataKey="spending"
              stroke="#c07845"
              strokeWidth={3}
            />
            <Line
              type="monotone"
              dataKey="net"
              stroke="#3e5f8a"
              strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="table-scroll">
        <table>
          <caption>Detailed cash-flow forecast</caption>
          <thead>
            <tr>
              <th>Period</th>
              <th>Income</th>
              <th>Spending</th>
              <th>Net cash flow</th>
              <th>Ending cash</th>
              <th>Why?</th>
            </tr>
          </thead>
          <tbody>
            {forecast.points.map((point) => (
              <tr key={point.periodStart}>
                <td>{point.periodStart.slice(0, 10)}</td>
                <td>{point.income.display}</td>
                <td>{point.spending.display}</td>
                <td>{point.netCashFlow.display}</td>
                <td>{point.endingCash.display}</td>
                <td>
                  <details>
                    <summary>Explain</summary>
                    <code>
                      {point.traceIds.join("\n") || "No trace metadata"}
                    </code>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {forecast.shortfalls.map((item) => (
        <div className="stress-detail" key={item.period}>
          <strong>
            {item.period.slice(0, 10)} · {item.unfunded.display} unfunded
          </strong>
          <p>
            Required {item.required.display}; available {item.available.display}
            . {item.diagnostic}
          </p>
          <code>{item.entityId}</code>
        </div>
      ))}
    </>
  );
}
function Portability({
  report,
  fileRef,
  readImport,
  importModel,
  migrate,
  exportModel,
  persistenceMode,
  savedState,
  persistenceError,
  saveToBrowser,
  loadSaved,
  migrateSaved,
  exportSavedBackup,
  deleteSaved,
}: any) {
  return (
    <>
      <PageHead
        eyebrow="Settings · Import / Export"
        title="Keep control of your model"
        text="Compatibility is inspected before import or migration. Local persistence is manual; portable export remains the recommended backup."
      />
      {persistenceMode === "disabled" && (
        <section className="panel compatibility">
          <strong>Public/demo origin</strong>
          <p>
            Local personal-data persistence is intentionally disabled here. Do
            not enter real personal financial information. Import and export
            remain available.
          </p>
        </section>
      )}
      {persistenceError && (
        <p className="field-error" role="alert">
          {persistenceError}
        </p>
      )}
      <section className="action-grid">
        {persistenceMode === "enabled" && (
          <article className="panel">
            <h2>Local browser storage</h2>
            <p>
              Save stores only the canonical portable model. Edits are not saved
              automatically. Browser storage is not encrypted by this app, and
              exported JSON is plaintext.
            </p>
            <div className="row">
              <button className="primary" onClick={() => void saveToBrowser()}>
                Save to this browser
              </button>
              {savedState?.status === "ready" && (
                <button className="secondary" onClick={loadSaved}>
                  Load saved model / Replace current model
                </button>
              )}
              {savedState?.status === "migration_required" && (
                <button
                  className="secondary"
                  onClick={() => void migrateSaved()}
                >
                  Migrate saved model explicitly
                </button>
              )}
            </div>
            {savedState && savedState.status !== "empty" && (
              <div className="compatibility">
                <strong>
                  Saved model: {savedState.status.replaceAll("_", " ")}
                </strong>
                {savedState.status !== "ready" && (
                  <p>
                    This saved data is protected from ordinary Save. Export it
                    for recovery or explicitly delete it.
                  </p>
                )}
                <div className="row">
                  <button className="secondary" onClick={exportSavedBackup}>
                    Export saved backup
                  </button>
                  <button className="ghost" onClick={() => void deleteSaved()}>
                    Delete saved local model
                  </button>
                </div>
              </div>
            )}
          </article>
        )}
        <article className="panel">
          <h2>Export</h2>
          <p>Download the deterministic PR 13 portable model JSON.</p>
          <button className="primary" onClick={exportModel}>
            Export current model
          </button>
        </article>
        <article className="panel">
          <h2>Import</h2>
          <p>
            Choose JSON to inspect locally. Import and migration are separate
            actions.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            onChange={(event) =>
              event.target.files?.[0] && readImport(event.target.files[0])
            }
          />
          {report && (
            <div className="compatibility">
              <strong>
                {report.directlyImportable
                  ? "Compatible and ready to import"
                  : "Review compatibility"}
              </strong>
              <dl>
                <dt>Model format</dt>
                <dd>
                  {report.detectedModelFormatVersion ?? "Unknown"} ·{" "}
                  {report.modelFormatCompatibility ?? "invalid"}
                </dd>
                <dt>Financial spec</dt>
                <dd>
                  {report.detectedFinancialSpecificationVersion ?? "Unknown"} ·{" "}
                  {report.financialSpecificationCompatibility ?? "invalid"}
                </dd>
              </dl>
              {report.issues.map((issue: any) => (
                <p key={issue.code + issue.fieldPath}>{issue.message}</p>
              ))}
              <div className="row">
                {report.directlyImportable && (
                  <button className="primary" onClick={importModel}>
                    Import into session
                  </button>
                )}
                {report.explicitMigrationAvailable && (
                  <button className="secondary" onClick={migrate}>
                    Migrate explicitly
                  </button>
                )}
              </div>
            </div>
          )}
        </article>
      </section>
    </>
  );
}
function Advanced({
  draft,
  issues,
}: {
  draft: PersonalDraft;
  issues: readonly any[];
}) {
  return (
    <>
      <PageHead
        eyebrow="Settings · Advanced"
        title="Technical model details"
        text="IDs, versions, and validation details for diagnostics."
      />
      <section className="panel">
        <dl className="advanced-list">
          <dt>Model ID</dt>
          <dd>{draft.modelId}</dd>
          <dt>Model format version</dt>
          <dd>{draft.modelFormatVersion}</dd>
          <dt>Financial specification version</dt>
          <dd>{draft.financialSpecificationVersion}</dd>
        </dl>
        <h2>Detailed validation</h2>
        {issues.length ? (
          issues.map((issue, index) => (
            <p className="validation" key={index}>
              {issue.objectType} · {issue.field}: {issue.message}
            </p>
          ))
        ) : (
          <p>No editor validation issues.</p>
        )}
      </section>
    </>
  );
}
function Capability({ title, message }: { title: string; message: string }) {
  return (
    <>
      <PageHead eyebrow="Capability" title={title} text={message} />
      <section className="panel capability">
        <strong>Preserved, not guessed</strong>
        <p>{message}</p>
      </section>
    </>
  );
}
function PageHead({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string;
  title: string;
  text: string;
}) {
  return (
    <header className="page-head">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
    </header>
  );
}
function Kpi({ label, value }: { label: string; value: string | undefined }) {
  return (
    <article className="kpi">
      <span>{label}</span>
      <strong>{value ?? "Unavailable"}</strong>
    </article>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <span>◇</span>
      <p>{text}</p>
    </div>
  );
}
