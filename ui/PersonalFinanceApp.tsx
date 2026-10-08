"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Profiler,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { PERFORMANCE_PHASES, applicationPerformanceRegistry, type PerformanceContext, type PerformancePhase } from "../src/application/performance.js";
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
import { payrollCharacters, authoringFailure } from "./authoring/contributionChoices.js";
import { financialField, fieldProblem, compareDecimal, unvestedProblem, entityField as financialFieldOrUndefined } from "./authoring/fieldContract.js";
import { GuidedFields } from "./authoring/GuidedFields.js";
import { FinancialSection, focusRepair, FinancialInput } from "./authoring/FieldShell.js";
import {
  createGoldenHouseholdExampleDraft,
  editPersonalRetirementDate,
  getPersonalRetirementPlans,
  authorPersonalPurchasePlan,
  getPersonalPurchasePlans,
  authorPayrollContributionPlan,
  getPayrollContributionPlans,
  getPayrollOpeningUnvestedUnits,
  getContributionCapacities,
  authorOpeningContributionUsage,
  getOpeningContributionUsage,
  getOpeningContributionOptions,
  authorHistoricalContributionScope,
  getHistoricalContributionScopes,
  type PayrollContributionPlan,
  createGuidedSetupDraft,
  createSyntheticPersonalDraft,
  deletePersistedPersonalModel,
  exportPersonalModelJson,
  getCurrentPosition,
  getPersonalEditorMetadata,
  importPersonalModelJson,
  inspectPersistedPersonalModel,
  isForecastStartDate,
  migratePersonalModelVersion,
  migratePersistedPersonalModel,
  comparePersonalScenarios,
  runPersonalForecast,
  resolvePersonalSessionSettings,
  savePersonalModel,
  sessionSettingsFromHorizon,
  validatePersonalDraft,
  validatePersonalModelJson,
  patchPersonalObject,
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
  type comparePersonalHouseholdMajorAssetDebtAddition,
  createHouseholdForecastRequest,
  resolveHouseholdExplanation,
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

import { useInteractiveForecast } from "./forecast/useInteractiveForecast.js";
import { EditorHub, canRepairEntityField } from "./EntityEditor.js";
import { mortgageFinalPaymentDate, mortgagePaymentCount } from "../src/application/compiler/liabilities.js";
import { currentPlan, simulationWindowProblem, replaceCurrentPlanHorizon } from "../src/application/forecastSetup.js";
import { forecastTaxJurisdictions, forecastTaxSetupProblem, type TaxForecastSettlementSetup } from "../src/application/taxForecastSetup.js";
import { TaxSettlementControls } from "./forecast/TaxSettlementControls.js";
import { FieldHelp, PercentageInput } from "./forecast/PercentageInput.js";
import { DomainMechanicsPanel } from "./forecast/DomainMechanicsPanel.js";
import { objectEntries, objectId, objectLabel, referenceLabel, friendlyText, forecastDiagnosticMessage, groupDiagnostics, isCashFlowPaymentAccount, type NetWorthSection } from "./entityPresentation.js";
import { calculationFingerprint } from "../src/application/interactiveForecast.js";
import { HouseholdChart } from "./forecast/HouseholdChart.js";
import { ForecastDetails, LazyExplanation, ExplanationCache } from "./forecast/details.js";
import { ResultExplanationCache } from "./forecast/explanations.js";
import type { ForecastView } from "./forecast/controller.js";

type FinancialExplanation = ReturnType<typeof resolveHouseholdExplanation>;
const FinancialResultModels = createContext<{ model?: PersonalDraft; baseline?: ForecastView; comparison?: ForecastView;
  explanations?: { baseline: ResultExplanationCache<FinancialExplanation>; comparison: ResultExplanationCache<FinancialExplanation> } }>({});

type Primary = "Overview" | "Money" | "Net Worth" | "Plan" | "Settings";
interface BrowserPerformanceRequest {
  active: boolean;
  readonly context: PerformanceContext;
  readonly model: PersonalDraft;
  readonly forecast: PersonalHouseholdForecastReadModel;
}
const BrowserPerformanceScope = createContext<BrowserPerformanceRequest | undefined>(undefined);
const browserNow = (): number | undefined => {
  try { const value = performance.now(); return Number.isFinite(value) ? value : undefined; } catch { return undefined; }
};
const recordBrowserDuration = (phase: PerformancePhase, durationMs: number, context?: PerformanceContext) => {
  if (context === undefined || !Number.isFinite(durationMs) || durationMs < 0) return;
  try { applicationPerformanceRegistry.record({ phase, availability: "measured", durationMs, context }); } catch { /* Diagnostic-only. */ }
};
const resolveExplanationMeasured = (scope: BrowserPerformanceRequest | undefined, ...args: Parameters<typeof resolveHouseholdExplanation>) => {
  const started = scope?.active ? browserNow() : undefined;
  try { return resolveHouseholdExplanation(...args); }
  finally {
    const ended = started === undefined ? undefined : browserNow();
    if (scope?.active && started !== undefined && ended !== undefined) recordBrowserDuration("ui.explanation_resolution", ended - started, scope.context);
  }
};
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
  "Net Worth": ["Overview", "Cash & bank accounts", "Investments & retirement", "Property & other assets", "Debt"],
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
    "Technical diagnostics",
  ],
};
const EDITORS: Record<string, readonly PersonalObjectType[]> = {
  Income: ["Income"],
  Spending: ["Expense"],
  Accounts: ["Account"],
  "Cash & bank accounts": ["Account"],
  "Investments & retirement": ["Account", "Investment"],
  "Property & other assets": ["Asset"],
  Debt: ["Liability"],
  Assumptions: ["Assumption"],
  "What If?": ["Scenario"],
  "Household & People": ["Household", "Person"],
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

type SetupRepair = { readonly message: string; readonly target: string };
function missingForecastSetup(draft: PersonalDraft, cashAccount: string, investmentOwner: string, liability: LiabilitySessionConfig): SetupRepair[] {
  const people = objectEntries(draft, "Person").map(item => objectId("Person", item));
  const banks = objectEntries(draft, "Account").filter(isCashFlowPaymentAccount).map(item => objectId("Account", item));
  const missing: SetupRepair[] = [];
  if (!banks.includes(cashAccount)) missing.push({ target: "cashAccount", message: "Income receiving account: choose where household income arrives." });
  if (!people.includes(investmentOwner)) missing.push({ target: "investmentOwner", message: "Investment owner: choose a household person." });
  if (!people.includes(liability.ownerId)) missing.push({ target: "debtOwner", message: "Debt owner: choose a household person." });
  for (const mortgage of objectEntries(draft, "Liability").filter(item => item.liability_type === "mortgage")) {
    const id = objectId("Liability", mortgage);
    const profile = liability.profiles[id] ?? EMPTY_LIABILITY_SESSION_PROFILE;
    const name = objectLabel("Liability", mortgage);
    const add = (key: string, message: string) => missing.push({ target: `mortgage:${id}:${key}`, message: `${name}: ${message}` });
    if (!mortgageFinalPaymentDate(profile.paymentAnchor, "1")) add("paymentAnchor", "Enter the first monthly payment date.");
    if (!/^[1-9]\d*$/.test(profile.totalPayments)) add("totalPayments", "Enter the number of monthly payments, for example 360.");
    if (!banks.includes(profile.fundingAccountId)) add("mortgageFunding", "Choose the mortgage payment account.");
    if (!/^\d+$/.test(profile.settlementPriority)) add("settlementPriority", "Enter same-day mortgage order; lower numbers first.");
    const final = mortgageFinalPaymentDate(profile.paymentAnchor, profile.totalPayments);
    if (final && mortgage.maturity_date != null && mortgage.maturity_date !== final) add("totalPayments", `Schedule differs from recorded maturity. Review calculated final payment ${final}.`);
  }
  return missing;
}
const requiredCue = (missing: boolean) => ({ "aria-invalid": missing, style: missing ? { border: "2px solid #a32929" } : {} });

export function PersonalFinanceApp() {
  const [draft, setDraft] = useState<PersonalDraft | undefined>();
  const [entityRepair, setEntityRepair] = useState<import("./EntityEditor.js").EntityRepair>();
  const [contributionTarget, setContributionTarget] = useState<{ investmentId: string; kind: "personal" | "payroll" }>();
  const [replacementIdentity, setReplacementIdentity] = useState(0);
  const browserRequest = useRef<BrowserPerformanceRequest | undefined>(undefined);
  const [explanations] = useState(() => ({ baseline: new ResultExplanationCache<FinancialExplanation>(), comparison: new ResultExplanationCache<FinancialExplanation>() }));
  useEffect(() => { if (browserRequest.current !== undefined) browserRequest.current.active = false; });
  const [primary, setPrimary] = useState<Primary>("Overview");
  const [subnav, setSubnav] = useState("How am I doing?");
  const [setupStep, setSetupStep] = useState(0);
  const [forecastScope, setForecastScope] =
    useState<ForecastRequest["scope"]>("cash_flow");
  const [forecast, setForecast] = useState<PersonalForecastReadModel>();
  const [comparison, setComparison] =
    useState<PersonalScenarioComparisonReadModel>();
  const [householdExecution, setHouseholdExecution] =
    useState<PersonalHouseholdSessionExecutionConfiguration>();
  const [sessionSettings, setSessionSettings] =
    useState<PersonalSessionSettings>(() =>
      sessionSettingsFromHorizon("2026-01-01", 12),
    );
  const [runSettingsError, setRunSettingsError] = useState("");
  const [taxSettlementSetup, setTaxSettlementSetup] = useState<TaxForecastSettlementSetup>();
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
    () => {
      if (!draft) return undefined;
      const context: PerformanceContext = Object.freeze({ runId: `current:${draft.modelId}:${sessionSettings.asOf}`, dataClassification: "user", modelCounts: Object.freeze(Object.fromEntries(Object.entries(draft.objects).map(([name, values]) => [name, values.length]))), modelVersion: draft.modelFormatVersion, specificationVersion: draft.financialSpecificationVersion, engineVersion: "0.1.0", executionLocation: "browser_main", runtime: "browser", browser: typeof navigator === "undefined" ? "unavailable" : navigator.userAgent, cacheState: "not_applicable" });
      const started = browserNow();
      try { return getCurrentPosition(draft, { baseCurrency: sessionSettings.baseCurrency, asOf: sessionSettings.asOf }); }
      finally { const ended = browserNow(); if (started !== undefined && ended !== undefined) recordBrowserDuration("current_snapshot.total", ended - started, context); }
    },
    [draft, sessionSettings.baseCurrency, sessionSettings.asOf],
  );
  const interactive = useInteractiveForecast(draft, householdExecution, sessionSettings, replacementIdentity);
  const householdForecast = interactive.baseline.lastGoodResult && "scope" in interactive.baseline.lastGoodResult
    ? interactive.baseline.lastGoodResult as PersonalHouseholdForecastReadModel : undefined;
  const householdComparison = interactive.comparison.lastGoodResult && "alternatives" in interactive.comparison.lastGoodResult
    ? interactive.comparison.lastGoodResult as PersonalHouseholdScenarioComparisonReadModel : undefined;
  if (householdForecast && interactive.baseline.performanceContext && browserRequest.current?.forecast !== householdForecast) {
    browserRequest.current = { active: true, model: draft!, forecast: householdForecast,
      context: { ...interactive.baseline.performanceContext, executionLocation: "browser_main", status: householdForecast.status } };
  }
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
    setRunSettingsError("");
  };

  const updateCanonicalModel = (next: PersonalDraft) => {
    const nextRoot = currentPlan(next)?.scenario_id;
    if (draft && typeof nextRoot === "string" && nextRoot !== currentPlan(draft)?.scenario_id) setHouseholdExecution(prior => prior === undefined ? undefined : { ...prior, selectedRootScenarioId: nextRoot });
    setDraft(next);
    invalidateResults();
  };

  const replaceCanonicalModel = (next: PersonalDraft, message: string) => {
    setContributionTarget(undefined);
    setReplacementIdentity(value => value + 1);
    updateCanonicalModel(next);
    setLiabilityConfig(emptyLiabilityConfig());
    setInvestmentOwnerId("");
    setCashFlowExecutionAccountId("");
    setRetirementBindings([]);
    setHouseholdExecution(undefined);
    setTaxSettlementSetup(undefined);
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
          const configuration = createGoldenHouseholdSessionConfiguration();
          replaceCanonicalModel(
            createGoldenHouseholdExampleDraft(),
            "Golden Household loaded",
          );
          setSessionSettings(sessionSettingsFromHorizon("2026-01-01", 120));
          setHouseholdExecution({ ...configuration, forecastLawPolicy: "projected_current_law" });
          setCashFlowExecutionAccountId(configuration.cashFlowExecutionAccountId ?? "");
          setInvestmentOwnerId(configuration.investmentExecutionOwnerId);
          setLiabilityConfig({ ownerId: configuration.liabilityExecutionOwnerId, profiles: Object.fromEntries(configuration.liabilityExecutionProfiles.map((profile) => [profile.liabilityId, { paymentAnchor: profile.paymentAnchor, totalPayments: String(profile.totalPayments), fundingAccountId: profile.fundingAccountId, settlementPriority: String(profile.settlementPriority) }])) });
          setRetirementBindings(configuration.retirementBindings);
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
    const configuration = householdExecution;
    if (configuration === undefined) {
      setRunSettingsError(
        "Configure cash-flow account, investment owner, liability owner, and each mortgage profile in Current Plan before comparing a household what-if.",
      );
      return;
    }
    const bindings = retirementBinding === undefined
      ? effectiveHouseholdExecution!.retirementBindings
      : [...effectiveHouseholdExecution!.retirementBindings.filter((binding) => binding.incomeId !== retirementBinding.incomeId), retirementBinding];
    const configured = { ...effectiveHouseholdExecution!, retirementBindings: bindings };
    if (!interactive.input) return;
    const request = createHouseholdForecastRequest(configured, randomId());
    const intents = [{ scenarioId: whatIfIds.alternativeScenarioId, name: "What-if alternative", changes: [change] }];
    interactive.compare({ ...interactive.input, operation: "scenario_comparison", request, intents,
      fingerprint: calculationFingerprint("scenario_comparison", draft, request, intents),
      performanceContext: { ...interactive.input.performanceContext, runId: request.runIdentity },
    });
    navigate("Plan");
    setSubnav("Compare Plans");
  };
  const effectiveHouseholdExecution = interactive.effectiveConfiguration;
  const setupMissing = missingForecastSetup(draft, cashFlowExecutionAccountId, investmentOwnerId, liabilityConfig);
  const setupChangesPending = !!householdExecution && (householdExecution.cashFlowExecutionAccountId !== cashFlowExecutionAccountId || householdExecution.investmentExecutionOwnerId !== investmentOwnerId || householdExecution.liabilityExecutionOwnerId !== liabilityConfig.ownerId || JSON.stringify(householdExecution.taxSettlementSetup) !== JSON.stringify(taxSettlementSetup) || householdExecution.liabilityExecutionProfiles.some(profile => { const choice = liabilityConfig.profiles[profile.liabilityId]; return !choice || choice.paymentAnchor !== profile.paymentAnchor || choice.totalPayments !== String(profile.totalPayments) || choice.fundingAccountId !== profile.fundingAccountId || choice.settlementPriority !== String(profile.settlementPriority); }));
  const taxSetupProblem = forecastTaxSetupProblem(draft, taxSettlementSetup, sessionSettings.simulationStart, sessionSettings.simulationEnd);
  if (taxSetupProblem) setupMissing.push({ message: taxSetupProblem, target: "taxSetup" });
  const settingsProblem = resolvePersonalSessionSettings(sessionSettings, "cash_flow").error ?? (draft ? simulationWindowProblem(draft, sessionSettings.simulationStart, sessionSettings.simulationEnd) : undefined);
  const openForecastSetup = (repair?: SetupRepair) => {
    navigate("Plan"); setSubnav("Current Plan");
    requestAnimationFrame(() => {
      const setup = document.getElementById("forecast-setup");
      const control = repair?.target === "taxSetup"
        ? setup?.querySelector<HTMLElement>('[data-tax-setup] [aria-invalid="true"]') ?? setup?.querySelector<HTMLElement>('[data-tax-setup] input, [data-tax-setup] select')
        : repair ? setup?.querySelector<HTMLElement>(`[data-repair="${CSS.escape(repair.target)}"]`) : setup;
      focusRepair(control ?? setup);
    });
  };
  const runHouseholdForecast = () => {
    const resolved = resolvePersonalSessionSettings(sessionSettings, "cash_flow");
    if (!resolved.request) { setRunSettingsError(resolved.error ?? "Run settings are not valid."); return; }
    if (!interactive.available || setupChangesPending) {
      setRunSettingsError(setupMissing.length ? setupMissing.map(item => item.message).join(" ") : "Apply forecast setup in Current Plan to run this model.");
      openForecastSetup();
      return;
    }
    setRunSettingsError("");
    interactive.recalculate();
  };
  const runMajorAssetDebtComparison = (addition: Parameters<typeof comparePersonalHouseholdMajorAssetDebtAddition>[2]) => {
    if (!interactive.available) {
      setRunSettingsError("Configure reconciled household execution in Current Plan before comparing a major asset/debt addition.");
      return;
    }
    interactive.compareInputs("major_asset_debt_comparison", addition);
    navigate("Plan"); setSubnav("Compare Plans");
  };
  const exportModel = () => {
    const json = exportPersonalModelJson(draft);
    downloadJson(json, "personal-finance-model.json");
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
    <FinancialResultModels.Provider value={{ model: draft, baseline: interactive.baseline, comparison: interactive.comparison, explanations }}>
    <BrowserPerformanceScope.Provider value={browserRequest.current?.model === draft && browserRequest.current?.forecast === householdForecast ? browserRequest.current : undefined}>
    <Profiler id="personal-finance-app" onRender={(_id, _phase, duration) => {
      const request = browserRequest.current;
      if (request?.active && request.model === draft && request.forecast === householdForecast) recordBrowserDuration("ui.react_commit", duration, request.context);
    }}>
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to financial content</a>
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
        <button className="avatar" aria-label="Open model settings" onClick={() => { navigate("Settings"); setSubnav("Model Settings"); }}>
          ME
        </button>
      </header>
      <nav className="primary-nav" aria-label="Primary navigation">
        {NAV.map((item) => (
          <button
            key={item}
            className={primary === item ? "active" : ""}
            aria-current={primary === item ? "page" : undefined}
            onClick={() => navigate(item)}
          >
            {item}
          </button>
        ))}
      </nav>
      <div className="workspace">
        <nav className="subnav" aria-label={`${primary} sections`}>
          <p className="eyebrow">{primary}</p>
          {SUBNAV[primary].map((item) => (
            <button
              key={item}
              className={subnav === item ? "active" : ""}
              aria-current={subnav === item ? "page" : undefined}
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
        </nav>
        <main id="main-content" tabIndex={-1} style={{ minWidth: 0 }}>
          <ForecastStatus label="Household forecast" state={interactive.baseline} />
          {setupChangesPending && <section className="forecast-status stale" role="status" aria-label="Forecast setup changes"><strong>Update needed · setup choices changed</strong><span>The retained forecast uses the last applied setup.</span><button onClick={() => openForecastSetup()}>Review &amp; apply setup</button></section>}
          {taxSetupProblem && interactive.available && <section className="panel capability" aria-label="Tax forecast needs setup"><strong>Needs setup · Tax payments &amp; refunds</strong><p>{taxSetupProblem}</p><button onClick={() => openForecastSetup()}>Set up tax payments &amp; refunds</button></section>}
          {interactive.available && !setupChangesPending ? <button className="primary" onClick={runHouseholdForecast}>Update forecast</button> : <section className="panel capability" aria-label="Forecast setup checklist">
            <h2>Needs setup · household forecast not run</h2>
            <p>Loading or importing a model clears session-only forecast choices. Complete these choices to run this household; saved purchases and contributions remain in the plan.</p>
            {setupMissing.length > 0 && <ul>{setupMissing.map(item => <li key={item.target}><button type="button" onClick={() => openForecastSetup(item)}>{item.message}</button></li>)}</ul>}
            {settingsProblem && <p role="alert">{settingsProblem} <button onClick={() => { navigate("Settings"); setSubnav("Model Settings"); }}>Review forecast dates</button></p>}
            {!setupMissing.length && !settingsProblem && <p>Required choices are complete. Apply setup &amp; run forecast in Current Plan.</p>}
            <button className="primary" onClick={() => openForecastSetup()}>Complete forecast setup</button>
          </section>}
          {issues.length > 0 && <section className="repair-summary" role="alert" aria-label="Saved plan needs attention">
            <strong>Recorded financial facts need attention</strong>
            <ul>{issues.map((issue, index) => {
              const presentation = issue.field ? financialFieldOrUndefined(issue.field, issue.objectType) : undefined;
              const type = issue.objectType;
              const item = type ? objectEntries(draft, type).find(value => objectId(type, value) === issue.objectId) : undefined;
              const name = type && item ? objectLabel(type, item) : "Saved plan";
              const repairable = type && item && issue.field && canRepairEntityField(type, issue.field, Object.entries(metadata[type].fields).find(([name]) => name === issue.field)?.[1], item[issue.field], draft);
              return <li key={index}>{name} · {presentation?.label ?? "Recorded relationship"}: {repairable ? "Review this fact before relying on the forecast." : "This recorded fact needs correction. Import corrected records; it cannot be edited here."}
                {!repairable && <button onClick={() => { navigate("Settings"); setSubnav("Import / Export"); }}>Import corrected records</button>}
                {repairable && presentation && type && issue.objectId && <button onClick={() => {
                  const location: Record<PersonalObjectType, [Primary, string]> = { Household: ["Settings", "Household & People"], Person: ["Settings", "Household & People"], Account: ["Money", "Accounts"], Income: ["Money", "Income"], Expense: ["Money", "Spending"], Investment: ["Net Worth", "Investments & retirement"], Asset: ["Net Worth", "Property & other assets"], Liability: ["Net Worth", "Debt"], Assumption: ["Plan", "Assumptions"], Scenario: ["Plan", "What If?"] };
                  const [page, section] = location[type]; navigate(page); setSubnav(section);
                  setEntityRepair({ objectType: type, objectId: issue.objectId!, field: issue.field!, token: randomId() });
                }}>Review {presentation.label.toLowerCase()}</button>}
              </li>;
            })}</ul>
          </section>}
          {primary === "Plan" && subnav === "Compare Plans" && <ForecastStatus label="Household comparison" state={interactive.comparison} />}

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
                repairTarget={entityRepair}
                currency={sessionSettings.baseCurrency}
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
                settings={sessionSettings}
                setSettings={setSessionSettings}
                contributionTarget={contributionTarget}
                setDraft={updateCanonicalModel}
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
                setRetirementBindings={setRetirementBindings}
                taxSettlementSetup={taxSettlementSetup}
                setTaxSettlementSetup={setTaxSettlementSetup}
                setHouseholdExecution={(bindings) => {
                  const mortgages = objectEntries(draft, "Liability").filter((item) => item.liability_type === "mortgage");
                  if (setupMissing.length || settingsProblem) return setRunSettingsError([...setupMissing.map(item => item.message), ...(settingsProblem ? [settingsProblem] : [])].join(" "));
                  const appliedBindings = bindings ?? retirementBindings;
                  setRetirementBindings(appliedBindings);
                  setHouseholdExecution({
                    forecastLawPolicy: "projected_current_law", ...(taxSettlementSetup === undefined ? {} : { taxSettlementSetup }),
                    baseCurrency: sessionSettings.baseCurrency, asOf: sessionSettings.asOf, dataCutoff: sessionSettings.dataCutoff,
                    simulationStart: sessionSettings.simulationStart, simulationEnd: sessionSettings.simulationEnd,
                    sameInstantCashFlowOrder: sessionSettings.sameInstantCashFlowOrder,
                    cashFlowExecutionAccountId, investmentExecutionOwnerId: investmentOwnerId,
                    investmentTransferInstructions: householdExecution?.investmentTransferInstructions ?? [], investmentPurchaseInstructions: householdExecution?.investmentPurchaseInstructions ?? [],
                    liabilityExecutionOwnerId: liabilityConfig.ownerId,
                    liabilityExecutionProfiles: mortgages.map((mortgage) => {
                      const id = objectId("Liability", mortgage); const profile = liabilityConfig.profiles[id]!;
                      return { liabilityId: id, kind: "vs4_fixed_monthly_fully_amortizing" as const, paymentAnchor: profile.paymentAnchor, totalPayments: Number(profile.totalPayments), fundingAccountId: profile.fundingAccountId, settlementPriority: Number(profile.settlementPriority), openingContractStatus: "current" as const };
                    }), retirementBindings: appliedBindings,
                    ...(householdExecution?.contentionPolicy === undefined ? {} : { contentionPolicy: householdExecution.contentionPolicy }),
                  });
                  setRunSettingsError("");
                }}
              />
              <FinancialSection title="Investment activity & extra mortgage payments"><DomainMechanicsPanel draft={draft} setDraft={updateCanonicalModel} /></FinancialSection>
              <details className="panel">
              <summary>Expert standalone forecasts</summary>
              <p>Inspect a supported scope independently. These results are separate from the reconciled household outlook.</p>
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
              </details>
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
            />
          )}
          {primary === "Settings" && subnav === "Model Settings" && (
            <ModelSettings
              draft={draft}
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
          {primary === "Settings" && subnav === "Technical diagnostics" && (
            <TechnicalDiagnostics draft={draft} issues={issues} />
          )}
          {primary === "Plan" && subnav === "What If?" && (
            <WhatIfStarter
              draft={draft}
              householdExecution={effectiveHouseholdExecution}
              runtimeIds={whatIfIds}
              onCompare={runComparison}
              onMajorAssetDebt={runMajorAssetDebtComparison}
            />
          )}
          {EDITORS[subnav] &&
            !(primary === "Net Worth" && subnav === "Debt") && (
              <EditorHub
                repairTarget={entityRepair}
                currency={sessionSettings.baseCurrency}
                types={EDITORS[subnav]!}
                section={primary === "Net Worth" ? subnav as NetWorthSection : undefined}
                selectedScenarioId={effectiveHouseholdExecution?.selectedRootScenarioId}
                onContributions={(investmentId, kind) => {
                  setContributionTarget({ investmentId, kind });
                  navigate("Plan"); setSubnav("Current Plan");
                  requestAnimationFrame(() => focusRepair(document.querySelector<HTMLElement>(`#${kind === "personal" ? "personal-contributions" : "payroll-contributions"} select`)));
                }}
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
    </Profiler>
    </BrowserPerformanceScope.Provider>
    </FinancialResultModels.Provider>
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
  const setupFieldKeys: Record<keyof SetupValues, string> = { name: "setupName", income: "setupIncome", cash: "setupCash", asset: "setupAsset", debt: "setupDebt", spending: "setupSpending", horizon: "setupHorizon", startDate: "setupStart" };
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
          Start with household amounts. Some opening facts become read-only after creation.
        </p>
        <FinancialInput fieldKey={setupFieldKeys[current.field]} value={form.watch(current.field)} required error={error ? String(error) : undefined} onChange={value => form.setValue(current.field, value, { shouldValidate: true, shouldDirty: true })} />
        {"extraField" in current && <FinancialInput fieldKey="setupStart" value={form.watch(current.extraField)} required error={form.formState.errors[current.extraField]?.message ? String(form.formState.errors[current.extraField]?.message) : undefined} onChange={value => form.setValue(current.extraField, value, { shouldValidate: true, shouldDirty: true })} />}
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
            <button className="primary" onClick={() => { void form.trigger(current.field).then(valid => { if (valid) setStep(step + 1); }); }}>
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

function ForecastStatus({ label, state }: { label: string; state: ForecastView }) {
  return <section className={`forecast-status ${state.stale ? "stale" : ""}`} role="status" aria-label={`${label} status`}
    data-lifecycle={state.lifecycle} data-pending={state.pending} data-fingerprint={state.fingerprint} data-request-id={state.requestId}>
    <strong>{label} · {state.pending ? "Running" : state.stale ? "Update needed" : state.lifecycle === "completed" ? "Ready" : state.lifecycle === "incomplete" ? "Partially modeled" : state.lifecycle === "unsupported" ? "Unsupported" : state.lifecycle === "idle" ? "Needs setup" : "Update needed"}</strong>
    {state.pending && <span>{state.lastGoodResult ? "Recalculating" : "Running"} deterministic forecast…</span>}
    {state.stale && <span>Old result — inputs changed; these numbers are not current. Update forecast or complete setup below.</span>}
    {!state.pending && !state.stale && state.lifecycle === "completed" && <span>Current result</span>}
    {!state.pending && !state.stale && state.lifecycle === "incomplete" && <><span>Forecast ran. Some outputs are incomplete; review the scoped reasons below before using after-tax totals.</span>
      {state.lastGoodResult && <DiagnosticList diagnostics={state.lastGoodResult.diagnostics ?? []} model={state.resultModel} />}</>}
    {state.lifecycle === "unsupported" && <span>Review the guidance below, correct the supported setup or import a supported model, then Update forecast.</span>}
    {state.message && <span>{state.lifecycle === "unsupported" && state.latestResult?.status === "unavailable" && state.latestResult.diagnostics.length > 0 ? "Review the forecast guidance below." : friendlyText(state.message)}</span>}
    {state.lifecycle === "unsupported" && state.latestResult?.status === "unavailable" && state.latestResult.diagnostics.length > 0 && <DiagnosticList diagnostics={state.latestResult.diagnostics} />}
    <details><summary>Technical forecast details</summary>
      <dl><dt>Lifecycle</dt><dd>{state.lifecycle}</dd><dt>Request</dt><dd>{state.requestId ?? "Not submitted"}</dd>
        <dt>Cache</dt><dd>{state.cacheState ?? "Not applicable"}</dd>
        {state.message && !state.latestResult?.diagnostics?.length && <><dt>Original diagnostic</dt><dd>{state.message}</dd></>}
      </dl>
    </details>
  </section>;
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
  const cards = [
    ["Net worth", position.netWorth],
    ["Household cash", position.cash],
    ["Cash inside investment accounts", position.wrapperCash],
    ["Unvested employer plan value (contingent)", position.contingentPlanValue],
    ["Monthly cash flow", position.monthlyCashFlow],
    ["Debt", position.liabilities],
  ] as const;
  return (
    <>
      <PageHead
        eyebrow="Overview"
        title="How am I doing?"
        text="A clear view of your current position and the modeled path ahead."
      />
      <p className="scope-badge">Current position · {position.status}</p>
      <section className="kpi-grid">
        {cards.map(([label, value]) => (
          <article className="kpi" key={label}>
            <span>{label}</span>
            <strong>
              {value?.display ?? "Unavailable"}
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
              : position.diagnostics.length > 0 ? "The monthly summary is unavailable. Review Model check for the limitation before changing your recorded income or spending." : "Add monthly income and spending to understand your cash flow."}
          </p>
        </article>
        <article className="panel">
          <h3>Model check</h3>
          {position.diagnostics.length > 0 ? <DiagnosticList diagnostics={position.diagnostics} /> : <p>Your current-position inputs are ready.</p>}
        </article>
      </section>
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
  const data = [
    ...(position.assets ? [{ name: "Assets", value: chartNumber(position.assets.exact) }] : []),
    ...(position.liabilities ? [{ name: "Liabilities", value: chartNumber(position.liabilities.exact) }] : []),
  ];
  return (
    <>
      <PageHead
        eyebrow="Net Worth"
        title="What do I own and owe?"
        text="Current values only—no cross-slice projection is implied."
      />
      <p className="scope-badge">Current position · {position.status}</p>
      {position.diagnostics.length > 0 && <DiagnosticList diagnostics={position.diagnostics} />}
      <section className="kpi-grid three">
        <Kpi label="Net worth" value={position.netWorth?.display ?? "Unavailable"} />
        <Kpi
          label="Total assets"
          value={position.assets?.display ?? "Unavailable"}
        />
        <Kpi
          label="Total liabilities"
          value={position.liabilities?.display ?? "Unavailable"}
        />
      </section>
      <section className="panel">
        <h2>Current assets vs liabilities</h2>
        {data.length ? (
          <div className="chart">
            <ResponsiveContainer>
              <BarChart data={data} accessibilityLayer>
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
              Current composition is unavailable for these inputs
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
              <td>{position.assets?.exact ?? "Unavailable"}</td>
            </tr>
            <tr>
              <td>Liabilities</td>
              <td>{position.liabilities?.exact ?? "Unavailable"}</td>
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
        text="Choose which part of your plan to forecast."
      />
      <section className="panel controls">
        <label>
          Forecast scope
          <select
            aria-label="Forecast scope"
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
          <ForecastVisual forecast={forecast} draft={draft} />
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
<GuidedFields scope="investments" aliases={{ "Execution owner": "investmentOwner" }} required={["investmentOwner"]}>
    <section className="panel controls">
      <h2>Investments</h2>
      <p className="muted">
        Choose the person whose investments to forecast. This choice is session-only.
      </p>
      <label>
        Execution owner
        <select
          {...requiredCue(!ownerId)}
          data-repair="investmentOwner"
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
    </GuidedFields>
  );
}
function LiabilityExecutionControls({
  draft,
  liabilityConfig,
  setLiabilityConfig,
  setDraft,
}: {
  draft: PersonalDraft;
  liabilityConfig: LiabilitySessionConfig;
  setLiabilityConfig: React.Dispatch<
    React.SetStateAction<LiabilitySessionConfig>
  >;
  setDraft?: (draft: PersonalDraft) => void;
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
<GuidedFields scope="mortgages" aliases={{ "Execution owner": "debtOwner", "Funding account": "mortgageFunding" }} required={["debtOwner", "paymentAnchor", "totalPayments", "mortgageFunding", "settlementPriority"]}>
    <section className="panel controls">
      <h2>Mortgage terms & funding</h2>
      <p className="muted">
        Choose the debt owner and enter the mortgage contract terms. These session choices tell the forecast which bank pays each mortgage; they do not change your saved debt.
      </p>
      <label>
        Execution owner
        <select
          {...requiredCue(!liabilityConfig.ownerId)}
          data-repair="debtOwner"
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
        const finalPayment = mortgageFinalPaymentDate(profile.paymentAnchor, profile.totalPayments);
        const suggestedCount = typeof mortgage.maturity_date === "string" ? mortgagePaymentCount(profile.paymentAnchor, mortgage.maturity_date) : undefined;
        const mismatch = finalPayment && mortgage.maturity_date != null && mortgage.maturity_date !== finalPayment;
        return (
          <fieldset key={id}>
            <legend>{objectLabel("Liability", mortgage)}</legend>
            <p>Loan start / origination: {String(mortgage.origination_date)}. Contractual final payment / maturity: {String(mortgage.maturity_date ?? "Not recorded")}.</p>
            <p>The first scheduled payment is a separate contract fact; it is not inferred from loan start. Extra principal changes projected payoff, while contractual maturity stays fixed.</p>
            <label>
              Payment anchor
              <input
                {...requiredCue(!profile.paymentAnchor)}
                type="date"
                data-repair={`mortgage:${id}:paymentAnchor`}
                value={profile.paymentAnchor}
                onChange={(event) =>
                  updateProfile(id, "paymentAnchor", event.target.value)
                }
              />
            </label>
            
            <label>
              Total payment count
              <input
                {...requiredCue(!/^[1-9]\d*$/.test(profile.totalPayments) || !!mismatch)}
                type="number"
                min="1"
                step="1"
                data-repair={`mortgage:${id}:totalPayments`}
                value={profile.totalPayments}
                onChange={(event) =>
                  updateProfile(id, "totalPayments", event.target.value)
                }
              />
            </label>
            
            {suggestedCount && suggestedCount !== profile.totalPayments && <button type="button" onClick={() => updateProfile(id, "totalPayments", suggestedCount)}>Calculate schedule: use {suggestedCount} payments from first payment through recorded maturity</button>}
            {finalPayment && <p>Calculated final scheduled payment: <strong>{finalPayment}</strong> · {profile.totalPayments} monthly payments starting {profile.paymentAnchor}. Months without the payment day are skipped under this contract.</p>}
            {mismatch && <p className="field-error" role="alert">Schedule mismatch: recorded maturity {String(mortgage.maturity_date)} differs from calculated final payment {finalPayment}. Confirm the first payment and count, then correct contractual maturity to {finalPayment}.</p>}
            {finalPayment && (mismatch || mortgage.maturity_date == null) && setDraft && <button type="button" onClick={() => setDraft(patchPersonalObject(draft, "Liability", id, { maturity_date: finalPayment }))}>Use calculated contractual maturity {finalPayment}</button>}
            <label>
              Funding account
              <select
                aria-label="Mortgage payment account"
                {...requiredCue(!accounts.filter(isCashFlowPaymentAccount).some(item => item.account_id === profile.fundingAccountId))}
                data-repair={`mortgage:${id}:mortgageFunding`}
                value={profile.fundingAccountId}
                onChange={(event) =>
                  updateProfile(id, "fundingAccountId", event.target.value)
                }
              >
                <option value="">Select funding account</option>
                {accounts.filter(isCashFlowPaymentAccount).map((account) => (
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
                {...requiredCue(!/^\d+$/.test(profile.settlementPriority))}
                type="number"
                min="0"
                step="1"
                data-repair={`mortgage:${id}:settlementPriority`}
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
    </GuidedFields>
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
        text="Review loan balances, scheduled payments, and the bank account paying each mortgage."
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
          <ForecastVisual forecast={forecast} draft={draft} />
        ) : (
          <Empty text="Enter explicit execution configuration and run the liability forecast." />
        )}
      </section>
    </>
  );
}
function WhatIfStarter({
  draft,
  householdExecution,
  runtimeIds,
  onCompare,
  onMajorAssetDebt,
}: {
  draft: PersonalDraft;
  householdExecution: PersonalHouseholdSessionExecutionConfiguration | undefined;
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
  const [retirementPlanId, setRetirementPlanId] = useState("");
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
  const rootScenarios = objectEntries(draft, "Scenario").filter((item) => item.enabled === true && !item.parent_scenario_id);
  const rootId = householdExecution?.selectedRootScenarioId ?? (rootScenarios.length === 1 ? objectId("Scenario", rootScenarios[0]!) : undefined);
  const root = objectEntries(draft, "Scenario").find((item) => item.scenario_id === rootId);
  const retirementPlans = incomes.flatMap((income) => {
    const incomeId = objectId("Income", income);
    const existing = householdExecution?.retirementBindings.find((binding) => binding.incomeId === incomeId);
    const eventId = existing?.canonicalEventId ?? income.related_event_id;
    const event = retirementEvents.find((item) => item.event_id === eventId && item.scenario_id === rootId &&
      Array.isArray(root?.event_ids) && root.event_ids.includes(String(item.event_id)));
    if (!event || typeof event.start_date !== "string" || event.probability_model_id != null || event.trigger_condition != null ||
      (Array.isArray(event.effect_ids) && event.effect_ids.length > 0) || (Array.isArray(event.dependencies) && event.dependencies.length > 0) ||
      event.duration_days != null || event.end_date != null || (event.precedence != null && event.precedence !== 0)) return [];
    return [{ income, event, binding: { incomeId, canonicalEventId: String(event.event_id), baselineDate: event.start_date,
      terminationEventId: existing?.terminationEventId ?? runtimeIds.terminationEventId } }];
  });
  const retirementPlan = retirementPlans.find((plan) => plan.binding.incomeId === retirementPlanId) ??
    (retirementPlans.length === 1 ? retirementPlans[0] : undefined);
  const runRetirement = () => {
    if (!retirementPlan) return;
    const binding = retirementPlan.binding;
    onCompare(
      "cash_flow",
      {
        kind: "retirement_date",
        incomeId: binding.incomeId,
        targetEventId: binding.terminationEventId,
        baselineDate: binding.baselineDate,
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
            aria-label="Income target"
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
            aria-label="Expense target"
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
        <PercentageInput label="Annual growth / return" value={rate} onChange={setRate} />
        {!exactRate && (
          <p className="field-error" role="alert">
            Enter a percentage, such as 5 for 5%.
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
            <PercentageInput label="Major debt annual rate" value={majorRate} onChange={setMajorRate} />
            <input aria-label="Major debt payment anchor" type="date" value={majorAnchor} onChange={(event) => setMajorAnchor(event.target.value)} />
            <input aria-label="Major debt total payments" type="number" value={majorPayments} onChange={(event) => setMajorPayments(event.target.value)} />
            <select aria-label="Major debt funding account" value={majorFunding} onChange={(event) => setMajorFunding(event.target.value)}><option value="">Select funding account</option>{accounts.map((item) => <option key={objectId("Account", item)} value={objectId("Account", item)}>{objectLabel("Account", item)}</option>)}</select>
            <input aria-label="Major debt settlement priority" type="number" value={majorPriority} onChange={(event) => setMajorPriority(event.target.value)} />
            <button className="primary" disabled={!majorOwnerId || !majorName || !majorValue || !majorDebt || !majorRate || !majorAnchor || !majorPayments || !majorFunding || !majorPriority} onClick={() => onMajorAssetDebt({
              asset: { asset_id: runtimeIds.majorAssetId, name: majorName, asset_type: "real_estate", owner_id: majorOwnerId, acquisition_cost: majorValue, current_value: majorValue, valuation_method: "cost", liquidity_class: "illiquid" },
              liability: { liability_id: runtimeIds.majorLiabilityId, name: `${majorName} debt`, liability_type: "mortgage", owner_id: majorOwnerId, principal: majorDebt, current_balance: majorDebt, interest_rate: majorRate, rate_type: "fixed", payment_frequency: "monthly", origination_date: majorAnchor, collateral_id: runtimeIds.majorAssetId },
              profile: { liabilityId: runtimeIds.majorLiabilityId, kind: "vs4_fixed_monthly_fully_amortizing", paymentAnchor: majorAnchor, totalPayments: Number(majorPayments), fundingAccountId: majorFunding, settlementPriority: Number(majorPriority), openingContractStatus: "current" },
            })}>Compare major asset/debt</button>
          </article>
          <article className="object-card">
            <h2>Retire earlier/later</h2>
            <p>Compare a different stop date for the income linked to your retirement plan. Your baseline plan stays intact.</p>
            <select
              aria-label="Retirement plan"
              value={retirementPlan?.binding.incomeId ?? ""}
              onChange={(event) => setRetirementPlanId(event.target.value)}
            >
              <option value="">Choose income and retirement plan</option>
              {retirementPlans.map((plan) => (
                <option
                  key={plan.binding.incomeId}
                  value={plan.binding.incomeId}
                >
                  {objectLabel("Income", plan.income)} · {friendlyText(plan.event.name ?? "Retirement")}
                </option>
              ))}
            </select>
            {retirementPlan ? <p>Current planned retirement date: <strong>{retirementPlan.binding.baselineDate}</strong> for {objectLabel("Income", retirementPlan.income)}.</p> :
              <p role="note">{retirementPlans.length > 0 ? "Choose the income and retirement plan you want to compare." : "No supported income/retirement relationship is available in the current plan. Review Plan → Current Plan → Forecast setup for existing retirement relationships. Creating retirement events is not supported here; import a model with a supported scheduled retirement event linked to income."}</p>}
            <input
              aria-label="New retirement date"
              type="date"
              value={retirementDate}
              onChange={(event) => setRetirementDate(event.target.value)}
            />
            <button
              className="primary"
              disabled={!retirementPlan || !retirementDate}
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
              Reruns the authoritative reconciled household projection.
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
              disabled={!investmentId || !householdExecution?.investmentExecutionOwnerId || !exactRate}
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
            {(!householdExecution?.investmentExecutionOwnerId || investments.length === 0) && (
              <p className="capability">
                {investments.length === 0
                  ? "No executable investment target exists."
                  : "Apply a household investment execution owner first."}
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
                !householdExecution?.liabilityExecutionOwnerId ||
                !householdExecution.liabilityExecutionProfiles.some((profile) => profile.liabilityId === liabilityId)
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
            {(!householdExecution?.liabilityExecutionOwnerId ||
              !householdExecution.liabilityExecutionProfiles.some((profile) => profile.liabilityId === liabilityId)) && (
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
                  (!householdExecution?.liabilityExecutionOwnerId ||
                    !householdExecution.liabilityExecutionProfiles.some(
                      (profile) => profile.liabilityId === fundingTargetId,
                    )))
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
          Supported comparisons deterministically rerun the authoritative
          reconciled household projection. Investment purchases mean modeled
          investment-position purchases only.
        </p>
      </section>
    </>
  );
}

function ComparePlans({
  comparison,
  legacyComparison,
  draft,
  retirementBindings,
}: {
  comparison: PersonalHouseholdScenarioComparisonReadModel | undefined;
  legacyComparison: PersonalScenarioComparisonReadModel | undefined;
  draft: PersonalDraft;
  retirementBindings: readonly RetirementTerminationBinding[];
}) {
  const resultModels = useContext(FinancialResultModels);
  const comparisonState = resultModels.comparison;
  const financialModel = comparisonState && comparisonState.lastGoodResult === comparison ? comparisonState.resultModel ?? draft : draft;
  const explanationCache = useMemo(() => comparison ? resultModels.explanations?.comparison.forResult(comparison) ?? new ExplanationCache<FinancialExplanation>() : new ExplanationCache<FinancialExplanation>(), [comparison, resultModels.explanations]);
  const resultBindings = resultModels.comparison?.resultRequest?.compiler.cashFlow?.retirementBindings ?? retirementBindings;
  const canonicalEvents =
    ((financialModel.objects as Record<string, readonly JsonObject[]>).Event ?? []);
  const legacyRows = legacyComparison?.status === "completed" || legacyComparison?.status === "incomplete"
    ? legacyComparison.points.flatMap((point) => Object.entries(point.metrics ?? {
      primary: { baseline: point.baseline, alternative: point.alternative, delta: point.delta },
    }).map(([metric, values]) => ({ point, metric, values }))) : [];
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
        </div>
        {comparison?.status === "completed" ||
        comparison?.status === "incomplete" ? (
          <>
            {comparison.alternatives.map((alternative) => (
              <section key={alternative.name}>
                <h3>
                  {alternative.name} · {alternative.status}
                </h3>
                <p>Compared through {alternative.comparedThrough?.slice(0, 10) ?? "Unavailable"} · Ending net worth difference: {householdMoney(alternative.points.at(-1)?.deltas.netWorth)}</p>
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
                <details>
                <summary>Expert comparison details</summary>
                {alternative.configurationDifferences.map((difference) => {
                  const explicitBinding = resultBindings.find((binding) =>
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
                      {referencedIds.length > 0
                        ? ` · events ${referencedIds
                            .map((id) => {
                              const event = canonicalEvents.find(
                                (candidate) =>
                              String(candidate.event_id) === id,
                              );
                            return event ? friendlyText(event.name ?? "Unnamed event") : "Unavailable event reference";
                            })
                            .join(", ")}`
                        : ""}
                    </p>
                  );
                })}
                </details>
                <details><summary>Technical comparison details</summary>
                <pre>{JSON.stringify(alternative.configurationDifferences, null, 2)}</pre>
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
                </details>
                <ForecastDetails result={comparison} rows={alternative.points} label={`${alternative.name} comparison details`}>
                  {(rows) => (
                <div className="table-scroll" role="region" aria-label="Scrollable financial table" tabIndex={0}>
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
                      {rows.map((point) => {
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
                              <LazyExplanation cache={explanationCache} rowId={`${alternative.name}:${point.periodStart}`}
                                resolve={() => resolveHouseholdExplanation(financialModel, point.traceRefs)}
                                differences={point.relatedDifferenceIds}
                                traceIds={point.traceRefs.map((ref) => ref.traceId)} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                  )}
                </ForecastDetails>
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
          <ForecastDetails result={legacyComparison} rows={legacyRows} label="scope comparison details">
            {(rows) => (
          <div className="table-scroll" role="region" aria-label="Scrollable financial table" tabIndex={0}>
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
                {rows.map(({ point, metric, values }) => (
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
                ))}
              </tbody>
            </table>
          </div>
            )}
          </ForecastDetails>
          <details>
            <summary>Technical scope comparison details</summary>
            {legacyComparison.configurationDifferences.map((difference) => (
              <p key={difference.target}>
                {difference.kind.replaceAll("_", " ")} · {difference.target} ·
                layer {difference.scenarioLayerId}
              </p>
            ))}
          </details>
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
  draft,
}: {
  settings: PersonalSessionSettings;
  setSettings: Dispatch<SetStateAction<PersonalSessionSettings>>;
  error: string;
  draft: PersonalDraft;
}) {
  const update = (field: keyof PersonalSessionSettings, value: string) =>
    setSettings((current) => ({ ...current, [field]: value }));
  const resolved = resolvePersonalSessionSettings(settings, "cash_flow");
  return (
<GuidedFields scope="forecast-dates">
    <>
      <PageHead
        eyebrow="Settings · Model Settings"
        title="Dates and conventions"
        text="Model dates are explicit; wall-clock today is never authoritative."
      />
      <PlanHorizonSettings draft={draft} settings={settings} />
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
        {(error || resolved.error || simulationWindowProblem(draft, settings.simulationStart, settings.simulationEnd)) && (
          <p className="field-error full" role="alert">
            {error || resolved.error || simulationWindowProblem(draft, settings.simulationStart, settings.simulationEnd)}
          </p>
        )}
        <p className="muted full">
          These choices configure your forecast. Saved financial plans remain separate.
        </p>
      </section>
    </>
    </GuidedFields>
  );
}


function PlanHorizonSettings({ draft, settings, setSettings, setDraft, retirementDates = [] }: { draft: PersonalDraft; settings: PersonalSessionSettings; setSettings?: Dispatch<SetStateAction<PersonalSessionSettings>>; setDraft?: (draft: PersonalDraft) => void; retirementDates?: readonly string[] }) {
  const plan = currentPlan(draft);
  const [start, setStart] = useState(String(plan?.start_date ?? ""));
  const [end, setEnd] = useState(String(plan?.end_date ?? ""));
  const [error, setError] = useState("");
  useEffect(() => { setStart(String(plan?.start_date ?? "")); setEnd(String(plan?.end_date ?? "")); }, [plan?.scenario_id]);
  const problem = simulationWindowProblem(draft, settings.simulationStart, settings.simulationEnd);
  const proposedProblem = fieldProblem(financialField("planStart"), start, true) ?? fieldProblem(financialField("planEnd"), end, true) ?? (start >= end ? "Current plan end must be after start." : undefined);
  return <GuidedFields scope="plan-horizon" required={["planStart", "planEnd", "simulationStart", "simulationEnd"]} errors={{ simulationEnd: problem, planEnd: proposedProblem ?? (error || undefined) }}><section className="panel" aria-label="Current Plan horizon" id="plan-horizon">
    <h2>Current Plan dates</h2><p>Your saved plan defines the available planning range. Simulation dates select a run window within it. Retirement must be within the plan, but may fall outside a run window.</p>
    <label>Current plan start<input aria-label="Current plan start" type="date" value={start} readOnly={!setDraft} onChange={event => setStart(event.target.value)} /></label>
    <label>Current plan end<input aria-label="Current plan end" type="date" value={end} readOnly={!setDraft} onChange={event => setEnd(event.target.value)} /></label>
    {setDraft ? <button disabled={!!proposedProblem} onClick={() => { try { setDraft(replaceCurrentPlanHorizon(draft, randomId(), start, end, { start: settings.simulationStart, end: settings.simulationEnd }, retirementDates)); setError(""); } catch (error) { setError(error instanceof Error ? error.message : "Plan dates could not be applied."); } }}>Apply Current Plan dates</button> : <p>Change plan dates under Plan → Current Plan.</p>}
    <p>Extending your plan makes a longer simulation window available. Simulation end remains your choice.</p>
    {error && <p role="alert">{error}</p>}
    <p>Available simulation range: {String(plan?.start_date)} → {String(plan?.end_date)} (exclusive end).</p>
    {setSettings && <><label>Simulation start<input aria-label="Simulation start" type="date" value={settings.simulationStart} onChange={event => setSettings(prior => ({ ...prior, simulationStart: event.target.value }))} /></label>
      <label>Simulation end<input aria-label="Simulation end" type="date" value={settings.simulationEnd} onChange={event => setSettings(prior => ({ ...prior, simulationEnd: event.target.value }))} /></label></>}
  </section></GuidedFields>;
}

function DiagnosticList({
  diagnostics,
  fallback,
  model,
}: {
  diagnostics: readonly any[];
  fallback?: string;
  model?: PersonalDraft;
}) {
  const currentModel = useContext(FinancialResultModels).model;
  const groups = groupDiagnostics(diagnostics);
  const summaries = [...new Map(groups.map(group => [forecastDiagnosticMessage(group.diagnostic, model ?? currentModel), group])).entries()];
  return (
    <div className="capability">
      <strong>{diagnostics.every(item => item.entityType === "tax_capability") ? "Partially modeled · tax limitations" : "Forecast needs attention"}</strong>
      {diagnostics.length === 0 ? (
        <p>The forecast is unavailable. Review the original explanation in Technical diagnostic details; no more specific editor remedy is available.</p>
      ) : (
        summaries.map(([message, group]) => (
          <p key={group.key} data-diagnostic-root={group.key}>
            {message}
          </p>
        ))
      )}
      <details><summary>Technical diagnostic details</summary>
        {groups.map(group => <details key={group.key}><summary>{group.diagnostic.code} · {group.diagnostic.category ?? group.diagnostic.entityType ?? "execution"} · {group.diagnostic.jurisdiction ?? "household"} · {group.occurrences} occurrences · {group.affectedOutputs.length} affected outputs</summary>
          <pre>{JSON.stringify({ diagnostic: group.diagnostic, originalMessages: group.messages, affectedOutputs: group.affectedOutputs,
            recordIds: [...new Set(diagnostics.filter(item => groupDiagnostics([item])[0]?.key === group.key).map(item => item.entityId).filter(Boolean))] }, null, 2)}</pre>
        </details>)}
        {!groups.length && <pre>{fallback ?? "No richer diagnostic is available."}</pre>}
      </details>
    </div>
  );
}

function AuthoringError({ reason }: { reason: string }) {
  return <div><p role="alert">{authoringFailure(new Error(reason))}</p><details><summary>Technical details</summary><pre>{reason}</pre></details></div>;
}
function PersonalPurchaseAuthoring({ draft, setDraft, initialInvestmentId }: { draft: PersonalDraft; setDraft: (draft: PersonalDraft) => void; initialInvestmentId?: string }) {
  const banks = objectEntries(draft, "Account").filter(account => ["checking", "savings"].includes(String(account.account_type)));
  const brokerageIds = new Set(objectEntries(draft, "Account").filter(account => ["taxable_brokerage", "traditional_ira", "roth_ira"].includes(String(account.account_type))).map(account => objectId("Account", account)));
  const investments = objectEntries(draft, "Investment").filter(investment => brokerageIds.has(String(investment.account_id)));
  const [investmentId, setInvestmentId] = useState(initialInvestmentId ?? "");
  const [bankId, setBankId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [frequency, setFrequency] = useState<"once" | "monthly">("monthly");
  const [order, setOrder] = useState("10");
  const [error, setError] = useState("");
  const [age, setAge] = useState("");
  const [compensation, setCompensation] = useState("");
  const [rothMagi, setRothMagi] = useState("");
  const [deductionMagi, setDeductionMagi] = useState("");
  const [filingStatus, setFilingStatus] = useState<"" | "single" | "married_joint" | "married_separate" | "head_of_household" | "qualifying_surviving_spouse">("");
  const [covered, setCovered] = useState("");
  const [spouseCovered, setSpouseCovered] = useState("");
  const [livesWithSpouse, setLivesWithSpouse] = useState("");
  const [projectAnnualFacts, setProjectAnnualFacts] = useState(false);
  const [excessPolicy, setExcessPolicy] = useState<"reject" | "auto_cap">("reject");
  const selectedInvestment = investments.find(item => objectId("Investment", item) === investmentId);
  const destination = objectEntries(draft, "Account").find(item => objectId("Account", item) === selectedInvestment?.account_id);
  const ira = destination?.account_type === "traditional_ira" || destination?.account_type === "roth_ira";
  const savedPurchases = useMemo(() => {
    try { return { plans: getPersonalPurchasePlans(draft), error: "" }; }
    catch (failure) { return { plans: [], error: failure instanceof Error ? failure.message : "Saved purchase policy is unsupported" }; }
  }, [draft]);
  useEffect(() => {
    const plan = savedPurchases.plans.find(item => item.investmentId === investmentId);
    if (!plan) { setBankId(""); setAmount(""); setDate(""); setOrder("10"); setFrequency("monthly"); setAge(""); setCompensation(""); setRothMagi(""); setDeductionMagi(""); setFilingStatus(""); setCovered(""); setSpouseCovered(""); setLivesWithSpouse(""); setProjectAnnualFacts(false); setError(""); return; }
    setBankId(plan.sourceCashAccountId); setAmount(plan.amount); setOrder(String(plan.order));
    setFrequency(plan.schedule.kind === "utc_monthly" ? "monthly" : "once");
    setDate(plan.schedule.kind === "utc_monthly" ? plan.schedule.anchor : plan.schedule.dates[0] ?? "");
    const facts = plan.contribution?.facts;
    setProjectAnnualFacts(facts?.annualFactProjection === "confirmed_nominal_carry_forward");
    setAge(facts?.ageAtYearEnd === undefined ? "" : String(facts.ageAtYearEnd));
    setCompensation(facts?.taxableCompensation?.amount.toString() ?? ""); setRothMagi(facts?.rothMagi?.amount.toString() ?? ""); setDeductionMagi(facts?.deductionMagi?.amount.toString() ?? "");
    setFilingStatus(facts?.filingStatus ?? ""); setCovered(facts?.workplacePlanCovered === undefined ? "" : String(facts.workplacePlanCovered)); setSpouseCovered(facts?.spouseWorkplacePlanCovered === undefined ? "" : String(facts.spouseWorkplacePlanCovered));
    setLivesWithSpouse(facts?.livesWithSpouse === undefined ? "" : String(facts.livesWithSpouse)); setExcessPolicy(plan.contribution?.excessPolicy ?? "reject");
  }, [investmentId]);
  const purchaseProblems = {
    purchaseAmount: fieldProblem(financialField("purchaseAmount"), amount, true) ?? (compareDecimal(amount, "0") !== undefined && compareDecimal(amount, "0") !== 1 ? "Enter a purchase amount greater than zero." : undefined),
    purchaseDate: fieldProblem(financialField("purchaseDate"), date, true) ?? (date && currentPlan(draft) && (date < String(currentPlan(draft)!.start_date) || date >= String(currentPlan(draft)!.end_date)) ? "Choose a purchase date within Current Plan." : undefined),
    purchaseFunding: bankId && !banks.some(item => item.account_id === bankId && item.currency === destination?.currency) ? "Choose checking or savings in the destination currency." : undefined,
    purchaseOrder: fieldProblem(financialField("purchaseOrder"), order, true),
  };
  const purchaseInvalid = Object.values(purchaseProblems).some(Boolean);
  return <GuidedFields scope="personal-contributions" errors={purchaseProblems} required={["purchaseInvestment", "purchaseFunding", "purchaseAmount", "purchaseDate"]}><section className="panel" id="personal-contributions" aria-label="Saved investment purchases">
    <h2>Investment purchases</h2>
    <p>Schedule a one-time or monthly purchase from checking or savings. IRA eligibility needs annual facts.</p>
    <label>Purchase investment<select aria-label="Purchase investment" value={investmentId} onChange={event => setInvestmentId(event.target.value)}><option value="">Choose holding</option>{investments.map(investment => <option key={objectId("Investment", investment)} value={objectId("Investment", investment)}>{objectLabel("Investment", investment)}</option>)}</select></label>
    <label>Purchase funding account<select aria-label="Purchase funding account" value={bankId} onChange={event => setBankId(event.target.value)}><option value="">Choose bank account</option>{banks.filter(bank => !destination || bank.currency === destination.currency).map(bank => <option key={objectId("Account", bank)} value={objectId("Account", bank)}>{objectLabel("Account", bank)}</option>)}</select></label>
    <label>Purchase amount<input value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" /></label>
    <label>Purchase start date<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
    <label>Purchase frequency<select aria-label="Purchase frequency" value={frequency} onChange={event => setFrequency(event.target.value === "once" ? "once" : "monthly")}><option value="once">One time</option><option value="monthly">Monthly</option></select></label>
    <details><summary>Advanced same-day purchase ordering</summary>
      <label>Purchase execution order<input type="number" min="0" step="1" value={order} onChange={event => setOrder(event.target.value)} /></label>
      <FieldHelp label="Purchase execution order">Controls which saved purchase runs first when purchases compete for the same bank cash on the same day. Enter a nonnegative whole number; lower numbers run first. For example, order 10 runs before order 20. It does not create extra funding.</FieldHelp>
    </details>
    {ira && <FinancialSection title="IRA eligibility & tax facts" open><fieldset><legend>Contribution facts for {date.slice(0, 4) || "the contribution year"}</legend>
      <label>Age at year end<input type="number" min="0" value={age} onChange={event => setAge(event.target.value)} /></label>
      <label>Annual taxable compensation<input inputMode="decimal" value={compensation} onChange={event => setCompensation(event.target.value)} /></label>
      <label>Contribution filing status<select aria-label="Contribution filing status" value={filingStatus} onChange={event => { const value = event.target.value; if (value === "" || value === "single" || value === "married_joint" || value === "married_separate" || value === "head_of_household" || value === "qualifying_surviving_spouse") setFilingStatus(value); }}><option value="">Unknown</option><option value="single">Single</option><option value="married_joint">Married filing jointly</option><option value="married_separate">Married filing separately</option><option value="head_of_household">Head of household</option><option value="qualifying_surviving_spouse">Qualifying surviving spouse</option></select></label>
      {destination?.account_type === "roth_ira" && <label>Roth IRA MAGI<input inputMode="decimal" value={rothMagi} onChange={event => setRothMagi(event.target.value)} /></label>}
      {destination?.account_type === "traditional_ira" && <label>Traditional IRA deduction MAGI<input inputMode="decimal" value={deductionMagi} onChange={event => setDeductionMagi(event.target.value)} /></label>}
      {[["Workplace plan coverage", covered, setCovered], ["Spouse workplace plan coverage", spouseCovered, setSpouseCovered], ["Lived with spouse during the year", livesWithSpouse, setLivesWithSpouse]].map(([label, value, setter]) => <label key={String(label)}>{String(label)}<select aria-label={String(label)} value={String(value)} onChange={event => { if (typeof setter === "function") setter(event.target.value); }}><option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option></select></label>)}
      <label>Excess contribution policy<select aria-label="Excess contribution policy" value={excessPolicy} onChange={event => setExcessPolicy(event.target.value === "auto_cap" ? "auto_cap" : "reject")}><option value="reject">Reject excess</option><option value="auto_cap">Explicitly cap to available capacity</option></select></label>
      <AnnualContributionAssumption confirmed={projectAnnualFacts} onChange={setProjectAnnualFacts} />
    </fieldset></FinancialSection>}
    <button type="button" disabled={!investmentId || !bankId || purchaseInvalid} onClick={() => {
      const selected = investments.find(investment => objectId("Investment", investment) === investmentId);
      try {
        setDraft(authorPersonalPurchasePlan(draft, { primitiveId: typeof selected?.contribution_model_id === "string" ? selected.contribution_model_id : randomId(), investmentId, sourceCashAccountId: bankId, amount, date, frequency, order: Number(order), ...(ira ? { excessPolicy, contributionFacts: { taxYear: Number(date.slice(0, 4)), ...(projectAnnualFacts ? { annualFactProjection: "confirmed_nominal_carry_forward" as const } : {}), ...(age === "" ? {} : { ageAtYearEnd: Number(age) }), ...(compensation === "" ? {} : { taxableCompensation: compensation }), ...(filingStatus === "" ? {} : { filingStatus }), ...(rothMagi === "" ? {} : { rothMagi }), ...(deductionMagi === "" ? {} : { deductionMagi }), ...(covered === "" ? {} : { workplacePlanCovered: covered === "true" }), ...(spouseCovered === "" ? {} : { spouseWorkplacePlanCovered: spouseCovered === "true" }), ...(livesWithSpouse === "" ? {} : { livesWithSpouse: livesWithSpouse === "true" }) } } : {}) }));
        setError("");
      } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    }}>Save investment purchase</button>
    {error && <AuthoringError reason={error} />}
    {savedPurchases.error && <AuthoringError reason={savedPurchases.error} />}
    {savedPurchases.plans.map(plan => <p key={plan.id}>Saved purchase: {objectLabel("Investment", investments.find(investment => objectId("Investment", investment) === plan.investmentId) ?? {})} — {plan.amount} {String(banks.find(bank => objectId("Account", bank) === plan.sourceCashAccountId)?.currency ?? "")} {plan.schedule.kind === "utc_monthly" ? "monthly" : "one time"} from {objectLabel("Account", banks.find(bank => objectId("Account", bank) === plan.sourceCashAccountId) ?? {})}.</p>)}
  </section></GuidedFields>;
}

function AnnualContributionAssumption({ confirmed, onChange }: { confirmed: boolean; onChange: (value: boolean) => void }) {
  return <GuidedFields scope="annual-assumption"><section aria-label="Annual contribution forecast assumption">
    <label><input type="checkbox" checked={confirmed} onChange={event => onChange(event.target.checked)} />Assume these annual personal facts stay unchanged in future years</label>
    <small>Unconfirmed future-year facts remain incomplete; affected contributions are skipped.</small>
    <details><summary>What carries forward?</summary><p>Supplied compensation, MAGI, filing status, prior employer wages, plan features, workplace coverage and HSA facts stay nominal. Age advances each year. Salary growth does not change these facts. This assumption is separate from projected current law.</p></details>
  </section></GuidedFields>;
}

function contributionFieldHelp(key: string): string {
  const help: Record<string, string> = {
    taxYear: "The calendar year of these contributions, used to choose that year’s limits. Enter four digits, for example 2026.",
    ageAtYearEnd: "Your age on December 31 of the contribution year. The app needs it for catch-up limits. Enter whole years, for example 36, rather than a birth date.",
    eligiblePlanCompensation: "Annual eligible plan compensation is the year’s pay counted by this employer’s retirement plan, used for the combined employee/employer limit. Enter dollars without commas, for example 108000.00; use the plan’s definition of eligible pay.",
    priorYearSponsorWages: "Prior-year wages with this sponsor means wages paid by this same employer last calendar year. This determines whether catch-up contributions must be Roth. Enter dollars, for example 108000.00 for last year’s pay; do not include another employer’s wages.",
    planHasRoth: "Does the employer plan allow Roth contributions? This is needed for the Roth catch-up requirement. Select Yes or No from the plan documents; for example Yes for a plan offering a Roth 401(k).",
    taxableCompensation: "Annual earned pay eligible for IRA contributions, used to limit contributions. Enter dollars for the full year, for example 108000.00; investment income is not compensation.",
    rothMagi: "Modified adjusted gross income for Roth IRA eligibility. This is used for income phase-outs. Enter the annual dollar amount, for example 108000.00, using the Roth IRA tax worksheet rather than gross pay.",
    hsaFullYearEligible: "Were you eligible to contribute to an HSA for the entire year? This bounded model needs full-year eligibility. Choose Yes only when coverage and other eligibility requirements are established, for example qualifying coverage throughout 2026.",
    hsaFamilyAllocation: "Your share of the ordinary family HSA annual limit, excluding catch-up, after any spouse allocation. Enter dollars, for example 4000.00. The app needs this to avoid giving both spouses the full family allowance.",
    livesWithSpouse: "Whether you lived with your spouse during this contribution year, used for married-filing-separately IRA eligibility. Select Yes or No, for example Yes if you shared a home during any part of the year.",
  };
  return help[key] ?? "Use the recorded annual contribution fact in the displayed unit. The app needs this to apply the correct eligibility limit; unknown facts remain incomplete. For example select Single only when that is the established filing status for the contribution year.";
}

function PayrollContributionAuthoring({ draft, setDraft, initialInvestmentId }: { draft: PersonalDraft; setDraft: (draft: PersonalDraft) => void; initialInvestmentId?: string }) {
  const accounts = objectEntries(draft, "Account").filter(item => ["traditional_401k", "roth_401k", "hsa", "hsa_investment"].includes(String(item.account_type)));
  const destinations = objectEntries(draft, "Investment").filter(item => accounts.some(account => account.account_id === item.account_id));
  const incomes = objectEntries(draft, "Income").filter(item => item.income_type === "salary" && item.gross_or_net !== "net");
  const [investmentId, setInvestmentId] = useState(initialInvestmentId ?? ""); const [incomeId, setIncomeId] = useState("");
  const [character, setCharacter] = useState<PayrollContributionPlan["character"]>("traditional_401k");
  const [kind, setKind] = useState<"fixed" | "percent" | "match">("percent");
  const [amount, setAmount] = useState(""); const [rate, setRate] = useState(""); const [capRate, setCapRate] = useState("");
  const [priority, setPriority] = useState("10"); const [planKey, setPlanKey] = useState(""); const [vested, setVested] = useState("1");
  const [openingUnvested, setOpeningUnvested] = useState("0");
  const [vestDate, setVestDate] = useState(""); const [forfeitDate, setForfeitDate] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({ taxYear: "2026" });
  const [excessPolicy, setExcessPolicy] = useState<"reject" | "auto_cap">("reject"); const [error, setError] = useState("");
  const saved = useMemo(() => { try { return { plans: getPayrollContributionPlans(draft), error: "" }; } catch (failure) { return { plans: [], error: failure instanceof Error ? failure.message : "Unsupported saved payroll policy" }; } }, [draft]);
  useEffect(() => {
    setOpeningUnvested(getPayrollOpeningUnvestedUnits(draft, investmentId));
    const plan = saved.plans.find(item => item.allocation.positionId === investmentId); if (!plan) { setIncomeId(""); setAmount(""); setRate(""); setCapRate(""); setPriority("10"); setPlanKey(""); setVested("1"); setVestDate(""); setForfeitDate(""); setFields({ taxYear: "2026" }); setError(""); return; }
    const allocation = plan.allocation; setIncomeId(plan.incomeId); setCharacter(allocation.policy.character === "traditional_ira" || allocation.policy.character === "roth_ira" ? "traditional_401k" : allocation.policy.character);
    setKind(allocation.calculation.kind); setAmount(allocation.calculation.kind === "fixed" ? allocation.calculation.amount.amount.toString() : ""); setRate(allocation.calculation.kind === "fixed" ? "" : allocation.calculation.rate); setCapRate(allocation.calculation.kind === "match" ? allocation.calculation.compensationCapRate : "");
    setPriority(String(allocation.priority)); setPlanKey(allocation.policy.limits.find(item => item.kind === "401k_additions")?.bucketKey.slice("401k_additions:".length) ?? ""); setVested(allocation.vestedFraction); setExcessPolicy(allocation.policy.excessPolicy);
    setVestDate(plan.events.find(event => event.kind === "vest")?.at.slice(0, 10) ?? ""); setForfeitDate(plan.events.find(event => event.kind === "forfeit")?.at.slice(0, 10) ?? "");
    setFields(Object.fromEntries(Object.entries(allocation.policy.facts).map(([key, value]) => [key, typeof value === "object" ? value.amount.toString() : String(value)])));
  }, [investmentId]);
  const destinationAccount = accounts.find(account => account.account_id === destinations.find(item => item.investment_id === investmentId)?.account_id);
  const characters = payrollCharacters(destinationAccount?.account_type);
  const employer = character.startsWith("employer_");
  const compatibleIncomes = incomes.filter(item => !destinationAccount || item.owner_id === destinationAccount.owner_id);
  useEffect(() => {
    if (characters.length && !characters.includes(character)) setCharacter(characters[0]!);
    if (!character.startsWith("employer_") && kind === "match") setKind("percent");
  }, [investmentId, character, kind, destinationAccount?.account_type]);
  const payrollProblems = {
    payrollSalary: incomeId && !compatibleIncomes.some(item => item.income_id === incomeId) ? "Choose gross salary belonging to the destination account owner." : undefined,
    character: investmentId && !characters.includes(character) ? "Choose a contribution type compatible with this account." : undefined,
    method: kind === "match" && !employer ? "Only employer contributions can use matching." : undefined,
    payrollAmount: kind === "fixed" ? fieldProblem(financialField("payrollAmount"), amount, true) ?? (compareDecimal(amount, "0") === -1 ? "Enter a nonnegative payroll contribution amount." : undefined) : undefined,
    payrollRate: kind !== "fixed" ? fieldProblem(financialField("payrollRate"), rate, true) ?? (compareDecimal(rate, "0") === -1 || compareDecimal(rate, "1") === 1 ? "Enter a contribution rate from 0 to 100%." : undefined) : undefined,
    matchCap: kind === "match" ? fieldProblem(financialField("matchCap"), capRate, true) ?? (compareDecimal(capRate, "0") === -1 || compareDecimal(capRate, "1") === 1 ? "Enter a cap from 0 to 100%." : undefined) : undefined,
    vested: character === "employer_401k" && (compareDecimal(vested, "0") === -1 || compareDecimal(vested, "1") === 1) ? "Enter an owned share from 0 to 100%." : undefined,
    unvested: !character.endsWith("_hsa") ? fieldProblem(financialField("unvested"), openingUnvested, true) ?? unvestedProblem(openingUnvested, String(destinations.find(item => item.investment_id === investmentId)?.quantity ?? "0")) : undefined,
    vestDate: fieldProblem(financialField("vestDate"), vestDate) ?? (vestDate && currentPlan(draft) && (vestDate < String(currentPlan(draft)!.start_date) || vestDate >= String(currentPlan(draft)!.end_date)) ? "Choose a vesting date within Current Plan." : undefined),
    forfeitDate: fieldProblem(financialField("forfeitDate"), forfeitDate) ?? (forfeitDate && vestDate && forfeitDate === vestDate ? "Vesting and forfeiture cannot occur on the same date." : forfeitDate && currentPlan(draft) && (forfeitDate < String(currentPlan(draft)!.start_date) || forfeitDate >= String(currentPlan(draft)!.end_date)) ? "Choose a forfeiture date within Current Plan." : undefined),
    payrollPriority: fieldProblem(financialField("payrollPriority"), priority, true) ?? (saved.plans.some(plan => plan.incomeId === incomeId && plan.allocation.positionId !== investmentId && String(plan.allocation.priority) === priority) ? "Use a distinct order for contributions sharing this salary." : undefined),
    taxYear: fieldProblem(financialField("taxYear"), fields.taxYear, true),
  };
  const payrollInvalid = Object.values(payrollProblems).some(Boolean);
  const input = (key: string, label: string) => <div key={key}><label>{label}<input value={fields[key] ?? ""} onChange={event => setFields({ ...fields, [key]: event.target.value })} /></label><FieldHelp label={label}>{contributionFieldHelp(key)}</FieldHelp></div>;
  const booleanInput = (key: string, label: string) => <div key={key}><label>{label}<select aria-label={label} value={fields[key] ?? ""} onChange={event => setFields({ ...fields, [key]: event.target.value })}><option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option></select></label><FieldHelp label={label}>{contributionFieldHelp(key)}</FieldHelp></div>;
  return <GuidedFields scope="payroll-contributions" errors={payrollProblems} required={["payrollDestination", "payrollSalary", "planKey"]}><section className="panel" id="payroll-contributions" aria-label="Saved payroll contributions"><h2>Payroll and employer contributions</h2>
    <p>Employee contributions reduce take-home cash. Employer contributions add plan value.</p>
    <label>Payroll destination<select aria-label="Payroll destination" value={investmentId} onChange={event => setInvestmentId(event.target.value)}><option value="">Choose holding</option>{destinations.map(item => <option key={String(item.investment_id)} value={String(item.investment_id)}>{objectLabel("Investment", item)}</option>)}</select></label>
    <FieldHelp label="Payroll destination">Choose the investment holding in the workplace account receiving contributions. This tells the forecast where to buy units. For example choose RETIREMENT-DEMO in Workplace retirement for the employee 401(k) contribution; employer matching may use a separate holding in the same plan.</FieldHelp>
    <label>Payroll salary<select aria-label="Payroll salary" value={incomeId} onChange={event => setIncomeId(event.target.value)}><option value="">Choose gross salary</option>{compatibleIncomes.map(item => <option key={String(item.income_id)} value={String(item.income_id)}>{objectLabel("Income", item)}</option>)}</select></label>
    <FieldHelp label="Payroll salary">Choose the gross salary that funds this workplace contribution. The forecast needs the paycheck amount before deductions. For example choose Example salary for that employer’s 401(k); checking and savings cannot fund payroll-only contributions.</FieldHelp>
    <label>Payroll contribution character<select aria-label="Payroll contribution character" value={character} onChange={event => { const value = event.target.value; if (value === "traditional_401k" || value === "roth_401k" || value === "after_tax_401k" || value === "employee_hsa" || value === "employer_401k" || value === "employer_hsa") setCharacter(value); }}>{characters.map(value => <option key={value} value={value}>{({ traditional_401k: "Traditional 401(k)", roth_401k: "Roth 401(k)", after_tax_401k: "After-tax 401(k)", employee_hsa: "Employee HSA", employer_401k: "Employer 401(k)", employer_hsa: "Employer HSA" })[value]}</option>)}</select></label>
    <label>Payroll contribution method<select aria-label="Payroll contribution method" value={kind} onChange={event => setKind(event.target.value === "fixed" ? "fixed" : event.target.value === "match" ? "match" : "percent")}><option value="fixed">Fixed amount per payroll</option><option value="percent">Percentage of gross pay</option>{employer && <option value="match">Employer match of employee contribution</option>}</select></label>
    <FieldHelp label="Payroll contribution method">Choose a dollar amount per paycheck, a percentage of gross pay, or an employer match. The forecast needs this to calculate each contribution. For example, 5% of a $9,000 paycheck contributes $450; a 100% match matches the eligible employee contribution dollar for dollar.</FieldHelp>
    {kind === "fixed" ? <label>Payroll contribution amount<input aria-label="Payroll contribution amount" value={amount} onChange={event => setAmount(event.target.value)} /><small>Dollars per paycheck, for example 450.00.</small></label> : <PercentageInput label="Payroll contribution rate" value={rate} onChange={setRate} error={payrollProblems.payrollRate} />}
    {kind === "match" && <PercentageInput label="Match compensation cap rate" value={capRate} onChange={setCapRate} error={payrollProblems.matchCap} />}
    <details><summary>Advanced payroll ordering</summary><label>Payroll allocation priority<input type="number" value={priority} onChange={event => setPriority(event.target.value)} /></label>
      <FieldHelp label="Payroll allocation priority">Controls the order of contributions sharing one paycheck. Enter distinct whole numbers; lower numbers run first. Employee contributions must precede employer matches, for example employee 10, employer 20. This makes competing contributions deterministic.</FieldHelp>
    </details>
    {!character.endsWith("_hsa") && <><label>Employer / plan group<input value={planKey} onChange={event => setPlanKey(event.target.value)} list="employer-plan-groups" /></label>
      <datalist id="employer-plan-groups">{[...new Set(saved.plans.flatMap(plan => plan.allocation.policy.limits.filter(limit => limit.kind === "401k_additions").map(limit => limit.bucketKey.slice("401k_additions:".length))))].map(key => <option key={key} value={key} />)}</datalist>
      <FieldHelp label="Employer / plan group">Give related contributions the same employer/plan name so they share the employer’s annual limit. For example use Example Employer for both employee and employer contributions to that plan, and Former Employer for a different employer. This name is also the stable shared plan/sponsor key; changing it changes which limits are shared.</FieldHelp></>}
    {character === "employer_401k" && <PercentageInput label="Owned share of future employer contributions" value={vested} onChange={setVested} error={payrollProblems.vested} />}
    {!character.endsWith("_hsa") && <FinancialSection title="Employer vesting"><label>Opening unvested employer units<input aria-label="Opening unvested employer units" value={openingUnvested} onChange={event => setOpeningUnvested(event.target.value)} /><small>Subset of this holding's total opening units funded by the employer and still unvested. Employee-funded units remain fully owned.</small></label></FinancialSection>}
    {!character.endsWith("_hsa") && <FieldHelp label="Opening unvested employer units">Enter the number of existing investment units funded by the employer that you do not yet own under the vesting schedule. For example enter 100 when 100 of the holding’s opening units are unvested. This excludes contingent employer value from owned net worth; enter units, not dollars or a percentage.</FieldHelp>}
    {character === "employer_401k" && <fieldset><legend>Optional full contingent reclassification</legend><p>These dates reclassify all then-current unvested value in this holding. Complex schedules and partial forfeiture are unsupported. A forfeiture date does not infer a salary end date; author the employment-income end separately.</p><label>Full vesting date<input type="date" value={vestDate} onChange={event => setVestDate(event.target.value)} /></label><label>Full contingent forfeiture date<input type="date" value={forfeitDate} onChange={event => setForfeitDate(event.target.value)} /></label></fieldset>}
    <FinancialSection title="Annual eligibility facts" open={!!investmentId}><fieldset><legend>Contribution eligibility</legend>{input("taxYear", "Payroll contribution year")}{input("ageAtYearEnd", "Payroll age at year end")}
      {character.endsWith("_hsa") ? <>{booleanInput("hsaFullYearEligible", "HSA eligible for the full year")}<label>HSA coverage<select aria-label="HSA coverage" value={fields.hsaCoverage ?? ""} onChange={event => setFields({ ...fields, hsaCoverage: event.target.value })}><option value="">Unknown</option><option value="self">Self only</option><option value="family">Family</option></select></label><FieldHelp label="HSA coverage">Choose self-only or family qualifying health coverage. This determines the annual HSA limit. For example select Family for eligible family coverage; do not infer eligibility from owning an HSA.</FieldHelp>{fields.hsaCoverage === "family" && input("hsaFamilyAllocation", "Your share of the family HSA limit")}</> : <>{input("eligiblePlanCompensation", "Annual pay eligible for this plan")}{booleanInput("planHasRoth", "Plan has a Roth feature")}{input("priorYearSponsorWages", "Last year’s pay from this employer")}</>}
      <AnnualContributionAssumption confirmed={fields.annualFactProjection === "confirmed_nominal_carry_forward"} onChange={confirmed => setFields({ ...fields, annualFactProjection: confirmed ? "confirmed_nominal_carry_forward" : "" })} />
    </fieldset></FinancialSection>
    <label>When a contribution exceeds the limit<select aria-label="When a contribution exceeds the limit" value={excessPolicy} onChange={event => setExcessPolicy(event.target.value === "auto_cap" ? "auto_cap" : "reject")}><option value="reject">Stop and report the excess</option><option value="auto_cap">Reduce to the remaining allowance</option></select></label>
    <FieldHelp label="When a contribution exceeds the limit">Payroll excess policy chooses whether to reject an over-limit contribution or reduce it to the known remaining allowance. For example, if $100 remains and $150 is requested, reducing contributes $100. Missing eligibility facts still stay incomplete.</FieldHelp>
    <button type="button" disabled={!investmentId || !incomeId || payrollInvalid || !characters.includes(character) || (!character.endsWith("_hsa") && !planKey)} onClick={() => {
      try { const investment = destinations.find(item => item.investment_id === investmentId)!;
        const existing = saved.plans.find(item => item.allocation.positionId === investmentId);
        setDraft(authorPayrollContributionPlan(draft, { primitiveId: typeof investment.contribution_model_id === "string" ? investment.contribution_model_id : randomId(), investmentId, incomeId, priority: Number(priority), character, calculation: kind === "fixed" ? { kind, amount } : kind === "percent" ? { kind, rate } : { kind, rate, compensationCapRate: capRate }, planKey, vestedFraction: character === "employer_401k" ? vested : "1", excessPolicy, ...(!character.endsWith("_hsa") ? { openingUnvestedQuantity: openingUnvested } : {}),
          contingentEvents: character !== "employer_401k" ? [] : [...(vestDate ? [{ eventId: existing?.events.find(event => event.kind === "vest")?.eventId ?? randomId(), kind: "vest" as const, date: vestDate }] : []), ...(forfeitDate ? [{ eventId: existing?.events.find(event => event.kind === "forfeit")?.eventId ?? randomId(), kind: "forfeit" as const, date: forfeitDate }] : [])],
          facts: { taxYear: Number(fields.taxYear), ...(fields.annualFactProjection === "confirmed_nominal_carry_forward" ? { annualFactProjection: "confirmed_nominal_carry_forward" as const } : {}), ...(fields.ageAtYearEnd ? { ageAtYearEnd: Number(fields.ageAtYearEnd) } : {}), ...(fields.eligiblePlanCompensation ? { eligiblePlanCompensation: fields.eligiblePlanCompensation } : {}), ...(fields.priorYearSponsorWages ? { priorYearSponsorWages: fields.priorYearSponsorWages } : {}), ...(fields.planHasRoth ? { planHasRoth: fields.planHasRoth === "true" } : {}), ...(fields.hsaFullYearEligible ? { hsaFullYearEligible: fields.hsaFullYearEligible === "true" } : {}), ...(fields.hsaCoverage === "self" || fields.hsaCoverage === "family" ? { hsaCoverage: fields.hsaCoverage } : {}), ...(fields.hsaFamilyAllocation ? { hsaFamilyAllocation: fields.hsaFamilyAllocation } : {}) } })); setError("");
      } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    }}>Save payroll contribution</button>
    {(error || saved.error) && <AuthoringError reason={error || saved.error} />}
    {saved.plans.map(item => <p key={item.allocation.id}>Saved payroll: {item.allocation.policy.character.replaceAll("_", " ")} to {objectLabel("Investment", destinations.find(destination => destination.investment_id === item.allocation.positionId) ?? {})}.</p>)}
  </section></GuidedFields>;
}

function HistoricalContributionScopeAuthoring({ draft, setDraft }: { draft: PersonalDraft; setDraft: (draft: PersonalDraft) => void }) {
  const accounts = objectEntries(draft, "Account").filter(item => ["traditional_401k", "roth_401k", "traditional_ira", "roth_ira", "hsa", "hsa_investment"].includes(String(item.account_type)));
  const holdings = objectEntries(draft, "Investment").filter(item => accounts.some(account => account.account_id === item.account_id));
  const [investmentId, setInvestmentId] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({ taxYear: "2026" });
  const [planKey, setPlanKey] = useState(""), [error, setError] = useState("");
  const saved = useMemo(() => { try { return getHistoricalContributionScopes(draft); } catch { return []; } }, [draft]);
  const holding = holdings.find(item => item.investment_id === investmentId);
  const account = accounts.find(item => item.account_id === holding?.account_id);
  const hsa = String(account?.account_type).startsWith("hsa"), ira = String(account?.account_type).endsWith("_ira");
  useEffect(() => {
    const scope = saved.find(item => item.investmentId === investmentId);
    setFields(scope ? Object.fromEntries(Object.entries(scope.policy.facts).map(([key, value]) => [key, typeof value === "object" ? value.amount.toString() : String(value)])) : { taxYear: "2026" });
    setPlanKey(scope?.policy.limits.find(item => item.kind === "401k_additions")?.bucketKey.slice("401k_additions:".length) ?? "");
  }, [saved, investmentId]);
  const input = (key: string, label: string) => <div><label>{label}<input value={fields[key] ?? ""} onChange={event => setFields({ ...fields, [key]: event.target.value })} /></label><FieldHelp label={label}>{contributionFieldHelp(key)}</FieldHelp></div>;
  const booleanInput = (key: string, label: string) => <div><label>{label}<select value={fields[key] ?? ""} onChange={event => setFields({ ...fields, [key]: event.target.value })}><option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option></select></label><FieldHelp label={label}>{contributionFieldHelp(key)}</FieldHelp></div>;
  return <GuidedFields scope="contribution-history" required={investmentId ? ["historicalHolding", "taxYear"] : []}><fieldset><legend>Historical account or employer plan</legend>
    <p>Record contributions already made this year, including contributions to a former employer’s plan. Add that account and holding first if it is missing.</p>
    <FieldHelp label="Prior contribution history">The forecast needs earlier contributions to know how much annual allowance remains. Enter each account’s contribution year and eligibility facts, then its year-to-date dollar amounts below. Use a separate employer/plan group for a former employer, for example Former Employer, so its employer limit remains separate from the active employer. This records prior usage without adding forecast cash or changing opening balances.</FieldHelp>
    <label>Historical holding<select aria-label="Historical holding" value={investmentId} onChange={event => setInvestmentId(event.target.value)}><option value="">Choose holding</option>{holdings.map(item => <option key={String(item.investment_id)} value={String(item.investment_id)}>{objectLabel("Investment", item)}</option>)}</select></label>
    {input("taxYear", "Historical contribution year")}{input("ageAtYearEnd", "Your age at the end of that year")}
    {investmentId && (hsa ? <>{booleanInput("hsaFullYearEligible", "Historical HSA full-year eligibility")}<label>Historical HSA coverage<select value={fields.hsaCoverage ?? ""} onChange={event => setFields({ ...fields, hsaCoverage: event.target.value })}><option value="">Unknown</option><option value="self">Self only</option><option value="family">Family</option></select></label>{input("hsaFamilyAllocation", "Historical individual family HSA allocation")}</> : ira ? <>{input("taxableCompensation", "Historical annual taxable compensation")}{account?.account_type === "roth_ira" && <>{input("rothMagi", "Historical Roth IRA MAGI")}<label>Historical filing status<select value={fields.filingStatus ?? ""} onChange={event => setFields({ ...fields, filingStatus: event.target.value })}><option value="">Unknown</option><option value="single">Single</option><option value="married_joint">Married jointly</option><option value="married_separate">Married separately</option><option value="head_of_household">Head of household</option><option value="qualifying_surviving_spouse">Qualifying surviving spouse</option></select></label>{booleanInput("livesWithSpouse", "Historical lived with spouse")}</>}</> : <><label>Historical employer / plan group<input value={planKey} onChange={event => setPlanKey(event.target.value)} /></label><FieldHelp label="Historical employer / plan group">Use the same employer name for contributions sharing that employer’s limit. For example Former Employer groups that employer’s employee and employer contributions separately from your current employer. This name is the historical plan/sponsor key used to track shared annual usage.</FieldHelp>{input("eligiblePlanCompensation", "Historical annual pay eligible for this plan")}{booleanInput("planHasRoth", "Historical plan has Roth feature")}{input("priorYearSponsorWages", "Historical last year’s pay from this employer")}</>)}
    <button type="button" disabled={!investmentId} onClick={() => {
      try {
        const facts: PayrollContributionPlan["facts"] = { taxYear: Number(fields.taxYear), ...(fields.ageAtYearEnd ? { ageAtYearEnd: Number(fields.ageAtYearEnd) } : {}), ...(fields.taxableCompensation ? { taxableCompensation: fields.taxableCompensation } : {}), ...(fields.eligiblePlanCompensation ? { eligiblePlanCompensation: fields.eligiblePlanCompensation } : {}), ...(fields.rothMagi ? { rothMagi: fields.rothMagi } : {}), ...(fields.filingStatus === "single" || fields.filingStatus === "married_joint" || fields.filingStatus === "married_separate" || fields.filingStatus === "head_of_household" || fields.filingStatus === "qualifying_surviving_spouse" ? { filingStatus: fields.filingStatus } : {}), ...(fields.livesWithSpouse ? { livesWithSpouse: fields.livesWithSpouse === "true" } : {}), ...(fields.priorYearSponsorWages ? { priorYearSponsorWages: fields.priorYearSponsorWages } : {}), ...(fields.planHasRoth ? { planHasRoth: fields.planHasRoth === "true" } : {}), ...(fields.hsaFullYearEligible ? { hsaFullYearEligible: fields.hsaFullYearEligible === "true" } : {}), ...(fields.hsaCoverage === "self" || fields.hsaCoverage === "family" ? { hsaCoverage: fields.hsaCoverage } : {}), ...(fields.hsaFamilyAllocation ? { hsaFamilyAllocation: fields.hsaFamilyAllocation } : {}) };
        setDraft(authorHistoricalContributionScope(draft, { id: saved.find(item => item.investmentId === investmentId)?.id ?? randomId(), investmentId, facts, ...(!hsa && !ira ? { planKey } : {}) })); setError("");
      } catch (failure) { setError(failure instanceof Error ? failure.message : "Historical scope could not be saved"); }
    }}>Save historical scope</button>{error && <p role="alert">{error}</p>}
  </fieldset></GuidedFields>;
}

function OpeningContributionUsageAuthoring({ draft, setDraft }: { draft: PersonalDraft; setDraft: (draft: PersonalDraft) => void }) {
  const saved = useMemo(() => { try { return getOpeningContributionUsage(draft); } catch { return undefined; } }, [draft]);
  const available = useMemo(() => { try { return { options: getOpeningContributionOptions(draft), error: "" }; } catch (failure) { return { options: [], error: failure instanceof Error ? failure.message : "Historical scopes unavailable" }; } }, [draft]);
  const options = available.options;
  const [date, setDate] = useState(saved?.asOf ?? "");
  const [fields, setFields] = useState<Record<string, { amount: string; ordinary: string }>>({});
  const [confirmed, setConfirmed] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    setDate(saved?.asOf ?? ""); setConfirmed(false);
    setFields(Object.fromEntries(options.map(option => {
      const entry = saved?.entries.find(item => item.investmentId === option.investmentId && item.character === option.character);
      return [`${option.investmentId}:${option.character}`, { amount: entry?.amount ?? "0", ordinary: entry?.ordinaryAmount ?? entry?.amount ?? "0" }];
    })));
  }, [saved, options]);
  return <GuidedFields scope="contribution-history" required={["ytdDate"]}><section className="panel" aria-label="Prior year-to-date contributions"><h2>Prior year-to-date contributions</h2>
    <HistoricalContributionScopeAuthoring draft={draft} setDraft={setDraft} />
    {available.error && <p role="alert">{available.error}</p>}
    <p>Enter contributions already made before the forecast start, across every account sharing these limits, including employer amounts. These facts consume annual capacity without adding cash flow or changing opening balances. Include any other prior contributions in the same scope; omitted categories are confirmed as zero.</p>
    <label>YTD forecast boundary<input type="date" value={date} onChange={event => { setDate(event.target.value); setConfirmed(false); }} /></label>
    {options.map(option => { const key = `${option.investmentId}:${option.character}`, value = fields[key] ?? { amount: "0", ordinary: "0" };
      const split = option.character === "traditional_401k" || option.character === "roth_401k" || option.character.endsWith("_hsa") && option.policy.facts.hsaCoverage === "family";
      const label = `${objectLabel("Investment", objectEntries(draft, "Investment").find(item => item.investment_id === option.investmentId) ?? {})} — ${option.character.replaceAll("_", " ")}`;
      return <fieldset key={key}><legend>{label}</legend><label>Prior YTD total<input aria-label={`${label} prior YTD total`} value={value.amount} onChange={event => { setFields({ ...fields, [key]: { ...value, amount: event.target.value } }); setConfirmed(false); }} /></label>
        {split && <label>Prior YTD amount excluding catch-up<input aria-label={`${label} prior YTD amount excluding catch-up`} value={value.ordinary} onChange={event => { setFields({ ...fields, [key]: { ...value, ordinary: event.target.value } }); setConfirmed(false); }} /></label>}</fieldset>;
    })}
    <label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I confirm all prior YTD usage in these shared scopes is known, including zero for omitted categories.</label>
    <button type="button" disabled={!confirmed || !date || !!available.error} onClick={() => {
      try { setDraft(authorOpeningContributionUsage(draft, { asOf: date, allPriorUsageKnown: true, entries: options.filter(option => option.policy.facts.taxYear === Number(date.slice(0, 4))).map(option => {
        const key = `${option.investmentId}:${option.character}`, value = fields[key] ?? { amount: "0", ordinary: "0" };
        const prior = saved?.entries.find(item => item.investmentId === option.investmentId && item.character === option.character);
        return { id: prior?.id ?? randomId(), investmentId: option.investmentId, character: option.character, amount: value.amount, ordinaryAmount: value.ordinary };
      }) })); setError(""); } catch (failure) { setError(failure instanceof Error ? failure.message : "Prior usage could not be saved"); }
    }}>Save prior YTD usage</button>{error && <p role="alert">{error}</p>}
  </section></GuidedFields>;
}

function ContributionCapacityPanel({ draft, forecast }: { draft: PersonalDraft; forecast: PersonalHouseholdForecastReadModel | undefined }) {
  const { baseline } = useContext(FinancialResultModels);
  const currentForecast = baseline && baseline.resultModel === draft && !baseline.pending && !baseline.stale ? forecast : undefined;
  let rows: ReturnType<typeof getContributionCapacities>;
  try { rows = currentForecast && currentForecast.status !== "unavailable" ? currentForecast.contributionCapacities : getContributionCapacities(draft); } catch (failure) { return <p role="alert">{failure instanceof Error ? failure.message : "Contribution capacity is unavailable"}</p>; }
  return <section className="panel" aria-label="Contribution capacity"><h2>Annual contribution capacity</h2><p>Modeled YTD combines authoritative opening usage and committed forecast contributions across every account sharing a bucket.</p>
    <div className="table-scroll"><table><thead><tr><th>Account / year</th><th>Shared categories</th><th>Annual USD limit</th><th>Opening YTD</th><th>Forecast usage</th><th>Modeled YTD</th><th>Remaining</th></tr></thead><tbody>{rows.map(row => <tr key={`${row.accountId}:${row.bucketIdentity}`}><td>{objectLabel("Account", objectEntries(draft, "Account").find(item => item.account_id === row.accountId) ?? {})} / {row.year}{row.provenance === "projected_current_law" && <p>Projected current law · {row.lawVersion}</p>}</td><td>{row.categories.map(value => value.replaceAll("_", " ")).join(", ")}</td><td>{row.annualLimit ?? "Incomplete"}{row.diagnostics.length > 0 && <p role="status">{"Annual capacity needs more recorded facts."}</p>}</td><td>{row.openingUsage ?? "Unknown"}</td><td>{row.forecastUsage ?? "Run plan"}</td><td>{row.yearToDate ?? "Incomplete"}</td><td>{row.remaining ?? "Incomplete"}</td></tr>)}</tbody></table></div>
    {!currentForecast && forecast && <p>Forecast usage will appear when a forecast reflects the current plan. The limits and opening usage shown here use your current saved facts.</p>}
    {currentForecast && currentForecast.status !== "unavailable" && currentForecast.contingentPositions.map(item => <p key={item.positionId}>Unvested contingent plan value: {item.value.amount} {item.value.currency}; excluded from owned net worth.</p>)}
  </section>;
}

function RetirementDateAuthoring({ draft, setDraft }: { draft: PersonalDraft; setDraft: (draft: PersonalDraft) => void }) {
  const plans = getPersonalRetirementPlans(draft);
  const [incomeId, setIncomeId] = useState("");
  const selected = plans.find(plan => plan.incomeId === incomeId) ?? (plans.length === 1 ? plans[0] : undefined);
  const [date, setDate] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { setDate(selected?.date ?? ""); setError(""); }, [selected?.incomeId, selected?.date]);
  return <GuidedFields scope="retirement"><section className="panel" aria-label="Saved retirement plan">
    <h2>Planned retirement date</h2>
    <p>This edits your saved baseline plan. Use What If? to compare an alternative date.</p>
    <label>Retirement income<select value={selected?.incomeId ?? ""} onChange={event => setIncomeId(event.target.value)}>
      <option value="">Choose income</option>{plans.map(plan => <option key={plan.incomeId} value={plan.incomeId}>{plan.label}</option>)}
    </select></label>
    <label>Planned retirement date<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
    <button type="button" disabled={!selected || !date || date === selected.date} onClick={() => {
      if (!selected) return;
      try { setDraft(editPersonalRetirementDate(draft, selected.incomeId, date)); setError(""); }
      catch (failure) { setError(failure instanceof Error ? failure.message : "Retirement date could not be updated"); }
    }}>Save planned retirement date</button>
    {!plans.length && <p>No supported scheduled retirement event is linked to income in the baseline plan.</p>}
    {error && <p role="alert">{error}</p>}
  </section></GuidedFields>;
}

function HouseholdPlan({
  draft,
  settings,
  setSettings,
  contributionTarget,
  setDraft,
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
  setRetirementBindings,
  taxSettlementSetup,
  setTaxSettlementSetup,
  setHouseholdExecution,
}: {
  draft: PersonalDraft;
  settings: PersonalSessionSettings;
  setSettings: Dispatch<SetStateAction<PersonalSessionSettings>>;
  contributionTarget?: { investmentId: string; kind: "personal" | "payroll" };
  setDraft: (draft: PersonalDraft) => void;
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
  setRetirementBindings: (value: readonly RetirementTerminationBinding[]) => void;
  taxSettlementSetup: TaxForecastSettlementSetup | undefined;
  setTaxSettlementSetup: (value: TaxForecastSettlementSetup) => void;
  setHouseholdExecution: (bindings?: readonly RetirementTerminationBinding[]) => void;
}) {
  const accounts = objectEntries(draft, "Account");
  const incomes = objectEntries(draft, "Income");
  const events = ((draft.objects as Record<string, readonly JsonObject[]>).Event ?? []).filter((event) => event.event_type === "retirement" && event.enabled === true && event.trigger_type === "scheduled");
  const [retirementIncomeId, setRetirementIncomeId] = useState(retirementBindings[0]?.incomeId ?? "");
  const [retirementEventId, setRetirementEventId] = useState(retirementBindings[0]?.canonicalEventId ?? "");
  const [retirementDate, setRetirementDate] = useState(retirementBindings[0]?.baselineDate ?? "");
  const [terminationEventId] = useState(() => retirementBindings[0]?.terminationEventId ?? randomId());
  return (
    <>
      <PageHead
        eyebrow="Plan · Current Plan"
        title="Your reconciled household plan"
        text="Review your planning period, scheduled contributions, and forecast."
      />
      <PlanHorizonSettings draft={draft} settings={settings} setSettings={setSettings} setDraft={setDraft} retirementDates={retirementBindings.map(binding => binding.baselineDate)} />
      <section className="panel" id="forecast-setup" tabIndex={-1}>
      <h2>Forecast setup</h2>
      <section className="controls" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)" }} aria-label="Household execution configuration">
        <h3>Cash &amp; funding</h3>
        <p>Choose income and payment accounts. Loading or importing clears these forecast choices; saved contribution plans remain.</p>
        <GuidedFields scope="cash" required={["cashAccount"]}><label>
          Income receiving account
          <select aria-label="Income receiving account" data-repair="cashAccount" {...requiredCue(!cashFlowExecutionAccountId)} value={cashFlowExecutionAccountId} onChange={(event) => setCashFlowExecutionAccountId(event.target.value)}>
            <option value="">Select funding account</option>
            {accounts.filter(isCashFlowPaymentAccount).map((account) => <option key={objectId("Account", account)} value={objectId("Account", account)}>{objectLabel("Account", account)}</option>)}
          </select>
        </label>
        </GuidedFields>
        <FinancialSection title="Investments" attention={!objectEntries(draft, "Person").some(item => item.person_id === investmentOwnerId)}><InvestmentExecutionControls draft={draft} ownerId={investmentOwnerId} setOwnerId={setInvestmentOwnerId} /></FinancialSection>
        <FinancialSection title="Debt & mortgage" attention={missingForecastSetup(draft, cashFlowExecutionAccountId, investmentOwnerId, liabilityConfig).some(item => item.target === "debtOwner" || item.target.startsWith("mortgage:"))}><LiabilityExecutionControls draft={draft} setDraft={setDraft} liabilityConfig={liabilityConfig} setLiabilityConfig={setLiabilityConfig} /></FinancialSection>
        <FinancialSection title="Tax payments & refunds" attention={!!forecastTaxSetupProblem(draft, taxSettlementSetup, settings.simulationStart, settings.simulationEnd)}><TaxSettlementControls start={settings.simulationStart} end={settings.simulationEnd} accounts={accounts.filter(account => ["checking", "savings"].includes(String(account.account_type))).map(account => ({ id: objectId("Account", account), label: objectLabel("Account", account) }))} jurisdictions={forecastTaxJurisdictions(draft)} value={taxSettlementSetup} onChange={setTaxSettlementSetup} /></FinancialSection>
        <p>Future tax rules use projected current law without inflation indexing. Contribution facts carry forward only when explicitly confirmed; age advances.</p>
        <details><summary>Technical retirement binding override</summary><fieldset>
          <legend>Baseline retirement binding (session-only)</legend>
          <select aria-label="Baseline retirement income" value={retirementIncomeId} onChange={(event) => setRetirementIncomeId(event.target.value)}><option value="">No retirement binding</option>{incomes.map((income) => <option key={objectId("Income", income)} value={objectId("Income", income)}>{objectLabel("Income", income)}</option>)}</select>
          <select aria-label="Baseline canonical retirement event" value={retirementEventId} onChange={(event) => { setRetirementEventId(event.target.value); const selected = events.find((item) => String(item.event_id) === event.target.value); if (typeof selected?.start_date === "string") setRetirementDate(selected.start_date); }}><option value="">No canonical event</option>{events.map((event) => <option key={String(event.event_id)} value={String(event.event_id)}>{friendlyText(event.name ?? "Unnamed retirement event")}</option>)}</select>
          <input aria-label="Baseline retirement date" type="date" value={retirementDate} onChange={(event) => setRetirementDate(event.target.value)} />
          <button type="button" onClick={() => setRetirementBindings(!retirementIncomeId || !retirementDate ? [] : [{ incomeId: retirementIncomeId, terminationEventId, baselineDate: retirementDate, ...(retirementEventId ? { canonicalEventId: retirementEventId } : {}) }])}>Apply retirement binding</button>
        </fieldset></details>
        <button className="primary" disabled={missingForecastSetup(draft, cashFlowExecutionAccountId, investmentOwnerId, liabilityConfig).length > 0 || !!simulationWindowProblem(draft, settings.simulationStart, settings.simulationEnd) || !!forecastTaxSetupProblem(draft, taxSettlementSetup, settings.simulationStart, settings.simulationEnd)} onClick={() => setHouseholdExecution(!retirementIncomeId || !retirementDate ? retirementBindings : [{ incomeId: retirementIncomeId, terminationEventId, baselineDate: retirementDate, ...(retirementEventId ? { canonicalEventId: retirementEventId } : {}) }])}>Apply setup &amp; run forecast</button>
        <p>After applying setup, economic edits automatically refresh the forecast. Update forecast is also available beside the global status.</p>
      </section>
      </section>
      <RetirementDateAuthoring draft={draft} setDraft={setDraft} />
      <FinancialSection title="IRA & brokerage contributions" open={contributionTarget?.kind === "personal"}><PersonalPurchaseAuthoring key={`personal:${contributionTarget?.investmentId ?? "overview"}`} draft={draft} setDraft={setDraft} initialInvestmentId={contributionTarget?.kind === "personal" ? contributionTarget.investmentId : undefined} /></FinancialSection>
      <FinancialSection title="Workplace & HSA contributions" open={contributionTarget?.kind === "payroll"}><PayrollContributionAuthoring key={`payroll:${contributionTarget?.investmentId ?? "overview"}`} draft={draft} setDraft={setDraft} initialInvestmentId={contributionTarget?.kind === "payroll" ? contributionTarget.investmentId : undefined} /></FinancialSection>
      <FinancialSection title="Contributions already made this year"><OpeningContributionUsageAuthoring draft={draft} setDraft={setDraft} /></FinancialSection>
      <FinancialSection title="Annual contribution allowance"><ContributionCapacityPanel draft={draft} forecast={forecast} /></FinancialSection>
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
  const request = useContext(BrowserPerformanceScope);
  const models = useContext(FinancialResultModels);
  const financialModel = models.baseline?.lastGoodResult === forecast ? models.baseline.resultModel ?? draft : draft;
  const cache = useMemo(() => models.explanations?.baseline.forResult(forecast) ?? new ExplanationCache<FinancialExplanation>(), [forecast, models.explanations]);
  const context = models.baseline?.performanceContext;
  const scope = context && models.baseline?.lastGoodResult === forecast
    ? { active: true, context: { ...context, executionLocation: "browser_main" as const }, model: financialModel, forecast } : request;
  const ending = forecast.points.at(-1);
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
          {forecast.stoppedAt
            ? `Incomplete; stopped at ${forecast.stoppedAt.slice(0, 10)}`
            : `Completed through ${forecast.reachedThrough?.slice(0, 10)}${forecast.status === "incomplete" ? " · Some outputs are partially modeled" : ""}`}
        </span>
      </div>
      {forecast.stoppedAt && <section className="stress" role="alert" aria-label="Forecast stopped early">
        <strong>The requested forecast did not complete. Results end at {forecast.stoppedAt.slice(0, 10)}.</strong>
        <p>{forecast.diagnostics.filter(item => item.entityType !== "tax_capability").map(item => forecastDiagnosticMessage(item, financialModel)).filter((message, index, messages) => messages.indexOf(message) === index).join(" ") || "Review the forecast limitations above for the stopping dependency."}</p>
        <p>Later dates have no modeled results. Extend verified coverage or choose a supported shorter window before relying on this plan.</p>
      </section>}
      {!!forecast.projectedLaw?.length && <section className="capability" aria-label="Projected law forecast basis">
        <strong>Projected current law · forecast assumptions</strong>
        <p>From 2027-01-01, future tax and contribution outputs use nominal carry-forward where verified coverage has ended. No inflation indexing or future legislation is inferred. Future contribution eligibility and annual amounts carry forward authored plan facts; age advances by year. Later verified rules supersede projections.</p>
        <ul>{[...new Map(forecast.projectedLaw.map(item => [`${item.jurisdiction}:${item.baseYear}:${item.from}:${item.until}`, item])).values()].map(item => <li key={`${item.jurisdiction}:${item.from}`}>{item.jurisdiction}: {item.baseYear} source rules projected from {item.from.slice(0, 10)} through {item.until.slice(0, 10)} (exclusive).</li>)}</ul>
        <details><summary>Projected source rule identities</summary><ul>{forecast.projectedLaw.map(item => <li key={`${item.baseRuleId}:${item.from}`}>{item.jurisdiction} · {item.baseRuleId} · base year {item.baseYear}</li>)}</ul></details>
      </section>}
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
            <p key={milestone.eventId}>{friendlyText(milestone.label)} · {milestone.date}</p>
          ))}
        </section>
      )}
      {!cashFlowOnly && forecast.debtPayoffs.length > 0 && <section className="panel" aria-label="Projected mortgage payoff"><h3>Projected payoff date</h3>
        {forecast.debtPayoffs.map(payoff => <p key={payoff.loanId}>{payoff.scheduledAt.slice(0, 10)} · Contractual maturity is unchanged. Technical loan reference is available in forecast details.</p>)}
      </section>}
      {!cashFlowOnly && (
        <section className="kpi-grid">
          <Kpi label="Ending net worth" value={householdMoney(ending?.netWorth)} />
          <Kpi label="Ending cash" value={householdMoney(ending?.cash)} />
          <Kpi label="Ending assets" value={householdMoney(ending?.totalAssets)} />
          <Kpi label="Ending liabilities" value={householdMoney(ending?.totalLiabilities)} />
        </section>
      )}
      <div>
          <Profiler id="forecast-chart" onRender={(_id, _phase, duration) => {
            if (scope?.active) recordBrowserDuration("ui.chart_render", duration, scope.context);
          }}><HouseholdChart forecast={forecast} cashFlowOnly={cashFlowOnly} /></Profiler>
        </div>
      <ForecastDetails result={forecast} rows={forecast.points} label="forecast details">
        {(rows) => (
      <div className="table-scroll" role="region" aria-label="Scrollable financial table" tabIndex={0}>
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
            {rows.map((point) => {
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
                    <LazyExplanation cache={cache} rowId={point.periodStart}
                      resolve={() => resolveExplanationMeasured(scope, financialModel, point.traceRefs)}
                      traceIds={point.traceRefs.map((ref) => ref.traceId)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
        )}
      </ForecastDetails>
      {forecast.diagnostics.length > 0 && (
        <p role="note">Forecast limitations are grouped beside the global forecast status above. Review them before relying on tax-dependent totals.</p>
      )}
    </>
  );
}

function ForecastVisual({ forecast, draft }: { forecast: PersonalForecastReadModel; draft: PersonalDraft }) {
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
        <DiagnosticList diagnostics={forecast.diagnostics} fallback={forecast.message} model={draft} />
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
        <ForecastDetails result={forecast} rows={forecast.liabilityOccurrences} label="debt forecast details">
          {(rows) => (
        <div className="table-scroll" role="region" aria-label="Scrollable financial table" tabIndex={0}>
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
              {rows.map((item) => (
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
          )}
        </ForecastDetails>
        {forecast.liabilityPayoffs.length > 0 && (
          <p className="muted">
            Projected payoff date (contractual maturity unchanged):{" "}
            {forecast.liabilityPayoffs
              .map(
                (item) =>
                  `${referenceLabel(draft, "Liability", item.liabilityId)} at ${item.scheduledAt.slice(0, 10)}`,
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
            <p>{friendlyText(item.diagnostic)}</p>
          </div>
        ))}
        {capabilityDiagnostics.length > 0 && (
          <div className="capability">
            <strong>
              Debt coverage is partial where diagnostics are listed
            </strong>
            {capabilityDiagnostics.map((item, index) => (
              <p key={`${item.code}:${item.entityId ?? index}`}>
                {forecastDiagnosticMessage(item, draft)}
              </p>
            ))}
          </div>
        )}
        {executionDiagnostics.length > 0 && (
          <div className="stress-detail">
            <strong>Forecast diagnostics</strong>
            {executionDiagnostics.map((item, index) => (
              <p key={`${item.code}:${item.entityId ?? index}`}>
                {forecastDiagnosticMessage(item, draft)}
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
        <ForecastDetails result={forecast} rows={forecast.points} label="investment forecast details">
          {(rows) => (
        <div className="table-scroll" role="region" aria-label="Scrollable financial table" tabIndex={0}>
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
              {rows.map((point) => (
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
                      .map((item) => `${referenceLabel(draft, "Account", item.accountId)}: ${item.value.display}`)
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
          )}
        </ForecastDetails>
        {forecast.diagnostics.length > 0 && <DiagnosticList diagnostics={forecast.diagnostics} model={draft} />}
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
          <LineChart data={data} accessibilityLayer>
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
      <ForecastDetails result={forecast} rows={forecast.points} label="cash-flow forecast details">
          {(rows) => (
        <div className="table-scroll" role="region" aria-label="Scrollable financial table" tabIndex={0}>
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
            {rows.map((point) => (
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
          )}
        </ForecastDetails>
      {forecast.shortfalls.map((item) => (
        <div className="stress-detail" key={item.period}>
          <strong>
            {item.period.slice(0, 10)} · {item.unfunded.display} unfunded
          </strong>
          <p>
            Required {item.required.display}; available {item.available.display}
            . {friendlyText(item.diagnostic)}
          </p>
          <details><summary>Technical diagnostic details</summary><code>{item.entityId} · {item.diagnostic}</code></details>
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
function TechnicalDiagnostics({
  draft,
  issues,
}: {
  draft: PersonalDraft;
  issues: readonly any[];
}) {
  return (
    <>
      <PageHead
        eyebrow="Settings · Technical diagnostics"
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
        <h2>Performance diagnostics</h2>
        <p>In-memory measurements only. No telemetry is persisted or transmitted; unavailable phases are shown as N/A. Percentiles pool up to 100 measured records; each sample's interpretation context is retained.</p>
        <div className="table-scroll" role="region" aria-label="Scrollable performance diagnostics" tabIndex={0}>
        <table aria-label="Performance diagnostics">
          <thead><tr><th>Phase</th><th>Latest</th><th>p50</th><th>p95</th><th>Max</th><th>Samples</th><th>Availability</th><th>Interpretation context</th></tr></thead>
          <tbody>
            {PERFORMANCE_PHASES.map((phase) => {
              const summary = applicationPerformanceRegistry.summary(phase);
              const latest = applicationPerformanceRegistry.latest(phase);
              const value = (amount: number | undefined) => amount === undefined ? "N/A" : `${amount.toFixed(2)} ms`;
              return <tr key={phase}><th>{phase}</th><td>{value(latest?.availability === "measured" ? latest.durationMs : undefined)}</td><td>{value(summary?.p50)}</td><td>{value(summary?.p95)}</td><td>{value(summary?.max)}</td><td>{summary?.count ?? 0}</td><td>{latest?.availability ?? "not_measured"}</td><td>{latest === undefined ? "unavailable" : <details><summary>{latest.context.executionLocation} · {latest.context.status ?? "unavailable"}</summary><pre>{JSON.stringify({ ...latest.context, fixtureId: latest.context.fixtureId ?? "not_applicable", horizon: latest.context.horizon ?? "not_applicable", status: latest.context.status ?? "unavailable", reachedThrough: latest.context.reachedThrough ?? "unavailable", runtime: latest.context.runtime ?? "unavailable", browser: latest.context.browser ?? "not_applicable", sampleContexts: summary?.contexts ?? [] }, null, 2)}</pre></details>}</td></tr>;
            })}
          </tbody>
        </table>
        </div>
        <p>Execution placement: browser Worker financial execution and browser main thread interaction; local Node is captured by the benchmark command; server/cloud is not implemented and not measured. Local/browser execution is not metered.</p>
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
