"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { canonicalId, resolveHouseholdScope } from "../src/application/compiler/shared.js";
import { CashChartDetails, CalmAction, CalmDisclosure, CalmMetric, CalmPageHeader, CalmPanel, ContextDisclosure, SharedContextRibbon, forecastContextLabel } from "./calm/CalmPresentation.js";
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
  type ReactNode,
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
import { FinancialFactEditors, AnnualFactsOwner, AnnualFactsReview, AnnualFilingRepair, useAuthoredAnnualFacts } from "./authoring/FinancialFactEditors.js";
import { financialField, fieldProblem, compareDecimal, unvestedProblem, effectiveAnnualReturnProblem, entityField as financialFieldOrUndefined } from "./authoring/fieldContract.js";
import { GuidedFields } from "./authoring/GuidedFields.js";
import { FinancialSection, FieldShell, focusRepair, FinancialInput, commitAtControl } from "./authoring/FieldShell.js";
import { ScheduledActivity } from "./authoring/ScheduledActivity.js";
import { diagnosticTargets, exactDiagnosticTargets, type DiagnosticTarget } from "./authoring/diagnosticTargets.js";
import { diagnosticSummary, primaryForecastDiagnostic } from "./authoring/diagnosticSummary.js";
import {
  createFlagshipHouseholdDraft,
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
  getOpeningContributionReadiness,
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
  resolvePersonalSessionSettings,
  savePersonalModel,
  sessionSettingsFromHorizon,
  validatePersonalDraft,
  validatePersonalModelJson,
  patchPersonalObject,
  addPersonalObject,
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
  createGoldenExampleConfiguration,
} from "../src/application/goldenHousehold.js";
import type { ScenarioChangeIntent } from "../src/application/compiler/scenarios.js";
import type { RetirementTerminationBinding } from "../src/application/compiler/cashFlow.js";
import {
  IndexedDbPersonalModelStore,
  isPersonalPersistenceEnabledOrigin,
} from "./persistence/indexedDbPersonalModelStore.js";

import { useInteractiveForecast, useForecastEvidence, useStandaloneForecast } from "./forecast/useInteractiveForecast.js";
import { EditorHub, canRepairEntityField } from "./EntityEditor.js";
import { mortgageFinalPaymentDate, mortgagePaymentCount } from "../src/application/compiler/liabilities.js";
import { currentPlan, simulationWindowProblem, replaceCurrentPlanHorizon, acceptRetirementProposal } from "../src/application/forecastSetup.js";
import { age90Horizon, retirementProposals, resolveForecastReadiness } from "../src/application/forecastReadiness.js";
import { ForecastSetupSuggestions, PlanningStartingPoints } from "./forecast/ForecastSetupSuggestions.js";
import { LoanSetupSuggestions } from "./forecast/LoanSetupSuggestions.js";
import { authorPayrollWithholding, durablePayrollWithholding } from "../src/application/compiler/payrollWithholding.js";
import { forecastTaxJurisdictions, forecastTaxSetupProblem, type TaxForecastSettlementSetup } from "../src/application/taxForecastSetup.js";
import { TaxSettlementControls } from "./forecast/TaxSettlementControls.js";
import { FieldHelp, PercentageInput } from "./forecast/PercentageInput.js";
import { DomainMechanicsPanel } from "./forecast/DomainMechanicsPanel.js";
import { InsuranceSection, InsuredLifeEvents } from "./authoring/InsuranceSection.js";
import { objectEntries, objectId, objectLabel, referenceLabel, friendlyText, forecastDiagnosticMessage, groupDiagnostics, isCashFlowPaymentAccount, belongsToNetWorthSection, entitySummary, formatExactMoney, percentageToRate, rateToPercentage, type NetWorthSection } from "./entityPresentation.js";
import { calculationFingerprint } from "../src/application/interactiveForecast.js";
import { HouseholdChart } from "./forecast/HouseholdChart.js";
import { MonthlyMoneyPanel } from "./forecast/MonthlyMoneyPanel.js";
import { LiabilityBalanceOutlook, MortgageAmortization } from "./forecast/MortgageAmortization.js";
import { inspectLiabilityBalanceWindow } from "../src/application/mortgageChartData.js";
import { ForecastDetails, LazyExplanation, ExplanationCache } from "./forecast/details.js";
import { ResultExplanationCache } from "./forecast/explanations.js";
import { FINANCIAL_DESTINATIONS, financialDestination } from "./navigation.js";
import type { ForecastView } from "./forecast/controller.js";

type FinancialExplanation = ReturnType<typeof resolveHouseholdExplanation>;
const FinancialResultModels = createContext<{ model?: PersonalDraft; baseline?: ForecastView; comparison?: ForecastView;
  setupChangesPending?: boolean;
  reviewTarget?: (target: DiagnosticTarget) => void; reviewMortgageFunding?: (liabilityId: string) => void; importCorrection?: () => void;
  reviewContributions?: (investmentId?: string, kind?: "personal" | "payroll") => void;
  reviewInsurance?: (policyId: string) => void;
  reviewMortgageOperations?: () => void;
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
const SUBNAV: Record<Primary, readonly string[]> = {
  Overview: ["How am I doing?"],
  Money: ["Cash Flow", "Income", "Spending", "Accounts", "Insurance & coverage"],
  "Net Worth": ["Overview", "Cash & bank accounts", "Investments & retirement", "Real Estate", "Other Assets", "Property & other assets", "Debt"],
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
  horizon: z.string().regex(/^[1-9]\d*$/, "Choose a positive whole number of years").refine(value => Number(value) <= 150, "Choose at most 150 years"),
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
    if (!/^[1-9]\d*$/.test(profile.totalPayments)) add("totalPayments", "Confirm the original payment count from the dated contract.");
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
  const [insuranceTarget, setInsuranceTarget] = useState<string>();
  const [replacementIdentity, setReplacementIdentity] = useState(0);
  const [newPlanStarters, setNewPlanStarters] = useState(false);
  const browserRequest = useRef<BrowserPerformanceRequest | undefined>(undefined);
  const [explanations] = useState(() => ({ baseline: new ResultExplanationCache<FinancialExplanation>(), comparison: new ResultExplanationCache<FinancialExplanation>() }));
  useEffect(() => { if (browserRequest.current !== undefined) browserRequest.current.active = false; });
  const [primary, setPrimary] = useState<Primary>("Overview");
  const [subnav, setSubnav] = useState("How am I doing?");
  const [cashMonth, setCashMonth] = useState("");
  const [mortgageMonth, setMortgageMonth] = useState("");
  const [mortgageLoan, setMortgageLoan] = useState("");
  const [cashReturn, setCashReturn] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const morePanel = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = moreButton.current?.closest("nav");
    const shell = nav?.parentElement;
    if (!nav || !shell) return;
    // Enlarged labels can reflow the fixed mobile bar. Keep More above its
    // actual height rather than assuming a single line of navigation text.
    const measure = () => shell.style.setProperty("--mobile-nav-height", `${nav.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => { observer.disconnect(); shell.style.removeProperty("--mobile-nav-height"); };
  }, [Boolean(draft)]);
  const destination = financialDestination(primary, subnav);
  useEffect(() => {
    if (!moreOpen) return;
    morePanel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const dismiss = () => { setMoreOpen(false); moreButton.current?.focus(); };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); dismiss(); }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !morePanel.current?.contains(event.target) && !moreButton.current?.contains(event.target)) dismiss();
    };
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !morePanel.current?.contains(event.target) && !moreButton.current?.contains(event.target)) setMoreOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [moreOpen]);
  const [setupStep, setSetupStep] = useState(0);
  const [forecastScope, setForecastScope] =
    useState<ForecastRequest["scope"]>("cash_flow");
  const standalone = useStandaloneForecast();
  const forecast = !standalone.view.pending && !standalone.view.stale ? standalone.view.result : undefined;
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
  const [lawAccepted, setLawAccepted] = useState(false);
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
      income: "",
      cash: "",
      asset: "",
      debt: "",
      spending: "",
      horizon: "",
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
  const executionReady = !!draft && lawAccepted && missingForecastSetup(draft, cashFlowExecutionAccountId, investmentOwnerId, liabilityConfig).length === 0 && !forecastTaxSetupProblem(draft, taxSettlementSetup, sessionSettings.simulationStart, sessionSettings.simulationEnd);
  const interactive = useInteractiveForecast(draft, executionReady ? householdExecution : undefined, sessionSettings, replacementIdentity);
  const readiness = useMemo(() => draft ? resolveForecastReadiness(draft, sessionSettings.asOf, householdExecution) : [], [draft, sessionSettings.asOf, householdExecution]);
  useEffect(() => {
    if (!draft || cashFlowExecutionAccountId) return;
    const derived = readiness.find(field => field.key === "cashAccount" && field.classification === "losslessly_derived");
    if (derived?.value) setCashFlowExecutionAccountId(derived.value);
  }, [draft, readiness, cashFlowExecutionAccountId]);
  useEffect(() => {
    if (!draft || !lawAccepted || missingForecastSetup(draft, cashFlowExecutionAccountId, investmentOwnerId, liabilityConfig).length ||
      resolvePersonalSessionSettings(sessionSettings, "cash_flow").error || simulationWindowProblem(draft, sessionSettings.simulationStart, sessionSettings.simulationEnd) ||
      forecastTaxSetupProblem(draft, taxSettlementSetup, sessionSettings.simulationStart, sessionSettings.simulationEnd)) return;
    setHouseholdExecution(previous => {
      const next: PersonalHouseholdSessionExecutionConfiguration = {
        ...previous, ...sessionSettings, forecastLawPolicy: "projected_current_law",
        ...(taxSettlementSetup === undefined ? {} : { taxSettlementSetup }),
        cashFlowExecutionAccountId, investmentExecutionOwnerId: investmentOwnerId,
        investmentTransferInstructions: previous?.investmentTransferInstructions ?? [], investmentPurchaseInstructions: previous?.investmentPurchaseInstructions ?? [],
        liabilityExecutionOwnerId: liabilityConfig.ownerId,
        liabilityExecutionProfiles: objectEntries(draft, "Liability").filter(item => item.liability_type === "mortgage").map(item => {
          const liabilityId = objectId("Liability", item), profile = liabilityConfig.profiles[liabilityId]!;
          return { liabilityId, kind: "vs4_fixed_monthly_fully_amortizing" as const, paymentAnchor: profile.paymentAnchor, totalPayments: Number(profile.totalPayments), fundingAccountId: profile.fundingAccountId, settlementPriority: Number(profile.settlementPriority), openingContractStatus: "current" as const };
        }), retirementBindings, ...(currentPlan(draft)?.scenario_id ? { selectedRootScenarioId: String(currentPlan(draft)!.scenario_id) } : {}),
      };
      return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
    });
  }, [draft, lawAccepted, sessionSettings, cashFlowExecutionAccountId, investmentOwnerId, liabilityConfig, taxSettlementSetup, retirementBindings]);
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

  useEffect(() => {
    standalone.controller.invalidate();
  }, [draft, sessionSettings, liabilityConfig, investmentOwnerId, retirementBindings, householdExecution, forecastScope, standalone.controller]);

  const invalidateResults = () => {
    standalone.controller.reset();
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
    setNewPlanStarters(false);
    const savedPlan = currentPlan(next);
    if (typeof savedPlan?.start_date === "string" && typeof savedPlan.end_date === "string" && !simulationWindowProblem(next, savedPlan.start_date, savedPlan.end_date)) {
      // Recover the durable plan range as a preview. Lost session-only clock,
      // funding and future-law choices still gate execution below.
      setSessionSettings(previous => ({ ...previous, simulationStart: String(savedPlan.start_date), simulationEnd: String(savedPlan.end_date) }));
    }
    setCashMonth("");
    setCashReturn(false);
    setContributionTarget(undefined);
    setInsuranceTarget(undefined);
    setReplacementIdentity(value => value + 1);
    updateCanonicalModel(next);
    setLiabilityConfig(emptyLiabilityConfig());
    setInvestmentOwnerId("");
    setCashFlowExecutionAccountId("");
    setRetirementBindings([]);
    setHouseholdExecution(undefined);
    setTaxSettlementSetup(undefined);
    setLawAccepted(false);
    setNotice(`${message}. Durable plan dates recovered where supported; review session-only forecast choices before running.`);
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

  const navigate = (next: Primary, section = SUBNAV[next][0]!) => {
    if (moreOpen) requestAnimationFrame(() => document.getElementById("main-content")?.focus());
    setMoreOpen(false);
    setPrimary(next);
    setSubnav(section);
  };
  const navigateFromOverview = (next: Primary, section = SUBNAV[next][0]!) => {
    navigate(next, section);
    requestAnimationFrame(() => document.getElementById("main-content")?.focus());
  };
  const completeSetup = setup.handleSubmit((values) => {
    let next = createGuidedSetupDraft({
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
    const settings = sessionSettingsFromHorizon(values.startDate, Number(values.horizon) * 12);
    next = addPersonalObject(next, "Scenario", randomId(), { name: "Current Plan", start_date: settings.simulationStart, end_date: settings.simulationEnd, enabled: true, timestep: "monthly", stochastic: false, simulation_count: 1, assumption_ids: [], event_ids: [] });
    replaceCanonicalModel(next, "Your starting financial picture is ready");
    setNewPlanStarters(true);
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
          const configuration = createGoldenExampleConfiguration();
          replaceCanonicalModel(
            createFlagshipHouseholdDraft(),
            "Golden Household loaded",
          );
          setSessionSettings({ baseCurrency: configuration.baseCurrency, asOf: configuration.asOf, dataCutoff: configuration.dataCutoff,
            simulationStart: configuration.simulationStart, simulationEnd: configuration.simulationEnd, sameInstantCashFlowOrder: configuration.sameInstantCashFlowOrder });
          setHouseholdExecution(configuration);
          setTaxSettlementSetup(configuration.taxSettlementSetup);
          setLawAccepted(true);
          setCashFlowExecutionAccountId(configuration.cashFlowExecutionAccountId ?? "");
          setInvestmentOwnerId(configuration.investmentExecutionOwnerId);
          setLiabilityConfig({ ownerId: configuration.liabilityExecutionOwnerId, profiles: Object.fromEntries(configuration.liabilityExecutionProfiles.map((profile) => [profile.liabilityId, { paymentAnchor: profile.paymentAnchor, totalPayments: String(profile.totalPayments), fundingAccountId: profile.fundingAccountId, settlementPriority: String(profile.settlementPriority) }])) });
          setRetirementBindings(configuration.retirementBindings);
          navigate("Overview");
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
    standalone.controller.run(
      draft,
      scope === "cash_flow" && householdExecution?.cashFlowExecutionAccountId
        ? { ...request, cashFlowExecutionAccountId: householdExecution.cashFlowExecutionAccountId }
        : request,
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
  if (!lawAccepted) setupMissing.push({ message: "Review and accept the projected current-law scenario in Current Plan.", target: "lawScenario" });
  const settingsProblem = resolvePersonalSessionSettings(sessionSettings, "cash_flow").error ?? (draft ? simulationWindowProblem(draft, sessionSettings.simulationStart, sessionSettings.simulationEnd) : undefined);
  const openForecastSetup = (repair?: SetupRepair) => {
    if (repair?.target === "cashAccount") { navigate("Money"); setSubnav("Income"); }
    else if (repair?.target === "debtOwner" || repair?.target.startsWith("mortgage:")) { navigate("Net Worth"); setSubnav("Debt"); }
    else { navigate("Plan"); setSubnav("Current Plan"); }
    requestAnimationFrame(() => {
      const setup = document.getElementById("forecast-setup");
      const control = repair?.target === "taxSetup"
        ? setup?.querySelector<HTMLElement>('[data-tax-setup] [aria-invalid="true"]') ?? setup?.querySelector<HTMLElement>('[data-tax-setup] input, [data-tax-setup] select')
        : repair ? document.querySelector<HTMLElement>(`[data-repair="${CSS.escape(repair.target)}"]`) : setup;
      focusRepair(control ?? setup);
    });
  };
  const openForecastDates = () => {
    navigate("Plan", "Current Plan");
    requestAnimationFrame(() => focusRepair(document.querySelector<HTMLElement>('[data-authoring-scope="plan-horizon"] [aria-label="Simulation end"]')));
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

  const contextIdentity = sharedContextIdentity(draft, effectiveHouseholdExecution?.selectedRootScenarioId);
  return (
    <FinancialFactEditors draft={draft} setDraft={updateCanonicalModel} openingReference={sessionSettings.asOf || sessionSettings.simulationStart}>
    <FinancialResultModels.Provider value={{ model: draft, baseline: interactive.baseline, comparison: interactive.comparison, explanations, setupChangesPending,
      reviewInsurance: policyId => { if (primary === "Money" && subnav === "Cash Flow") setCashReturn(true); setInsuranceTarget(policyId); navigate("Money"); setSubnav("Insurance & coverage"); requestAnimationFrame(() => focusRepair(document.querySelector<HTMLElement>('[data-authoring-scope="term-life-policy"] select'))); },
      reviewContributions: (investmentId, kind) => {
        if (primary === "Money" && subnav === "Cash Flow") setCashReturn(true);
        setContributionTarget(investmentId && kind ? { investmentId, kind } : undefined);
        navigate("Net Worth"); setSubnav("Investments & retirement");
        requestAnimationFrame(() => focusRepair(document.querySelector<HTMLElement>(investmentId && kind ? `#${kind === "personal" ? "personal-contributions" : "payroll-contributions"} select` : "#investment-contribution-summary")));
      },
      importCorrection: () => { navigate("Settings"); setSubnav("Import / Export"); },
      reviewMortgageFunding: (id) => { navigate("Net Worth"); setSubnav("Debt"); requestAnimationFrame(() => focusRepair(document.querySelector<HTMLElement>(`[data-repair="${CSS.escape(`mortgage:${id}:mortgageFunding`)}"]`))); },
      reviewMortgageOperations: () => { navigate("Net Worth", "Debt"); requestAnimationFrame(() => focusRepair(document.querySelector<HTMLElement>('[aria-label="Mortgage operations"]'))); },
      reviewTarget: (target) => {
        if (primary === "Money" && subnav === "Cash Flow" && (!target.objectType || target.type === "Asset sources")) setCashReturn(true);
        if (target.type === "Asset sources") { navigate("Net Worth", "Property & other assets"); return; }
        if (!target.objectType) { openForecastSetup(target.field ? { target: target.field, message: target.label } : undefined); return; }
        setEntityRepair({ objectType: target.objectType, objectId: target.id, field: target.editable ? target.field ?? "" : "", token: randomId() });
      } }}>
    <BrowserPerformanceScope.Provider value={browserRequest.current?.model === draft && browserRequest.current?.forecast === householdForecast ? browserRequest.current : undefined}>
    <Profiler id="personal-finance-app" onRender={(_id, _phase, duration) => {
      const request = browserRequest.current;
      if (request?.active && request.model === draft && request.forecast === householdForecast) recordBrowserDuration("ui.react_commit", duration, request.context);
    }}>
    <div className={`app-shell${primary === "Overview" ? " calm-shell" : ""}`}>
      <a className="skip-link" href="#main-content">Skip to financial content</a>
      <header className="topbar">
        <button className="brand" onClick={() => navigate("Overview")}>
          <span className="brand-mark">P</span>
          <span>Personal Finance</span>
        </button>
        <SharedContextRibbon
          {...contextIdentity}
          modelStatus={!position ? "Unavailable" : contextIdentity.membershipReview || issues.length || position.status !== "complete" ? "Needs review" : "Ready"}
          modelDetails={<><h2>Recorded model</h2><p>Current position: {position?.status ?? "unavailable"}. {issues.length} recorded fact issues.</p><p>As of {sessionSettings.asOf}; data cutoff {sessionSettings.dataCutoff}. Model readiness is separate from forecast coverage.</p>{contextIdentity.membershipReview && <><p>{contextIdentity.membershipReview}</p><button data-context-route onClick={() => navigate("Settings", "Household & People")}>Review household &amp; people</button></>}<button data-context-route onClick={() => { const panel = document.querySelector<HTMLDetailsElement>(".task-readiness"); if (panel) { panel.open = true; focusRepair(panel); } }}>Review recorded facts</button></>}
          forecast={<div className="context-forecast-region" role="region" aria-label="Requested and modeled coverage"><ForecastStatus label="Household forecast" state={interactive.baseline} ribbon setupChanged={setupChangesPending}
            update={interactive.available && !setupChangesPending ? runHouseholdForecast : undefined}
            coverage={<section className="forecast-coverage" data-requested-end={sessionSettings.simulationEnd} data-modeled-status={interactive.baseline.stale || interactive.baseline.pending ? "stale" : householdForecast?.status ?? "not_run"}>
              <p>Requested: {sessionSettings.simulationStart} → <strong>{sessionSettings.simulationEnd}</strong> (exclusive). Requested coverage is not computed coverage.</p>
              <p>{interactive.baseline.stale || interactive.baseline.pending ? "Updating · retained values are not the current forecast." : householdForecast && householdForecast.status !== "unavailable" ? `Engine status: ${householdForecast.status}. Computed through ${householdForecast.reachedThrough ?? "unavailable"} (exclusive).` : "No supported forecast is available yet."}</p>
              <p>As of {sessionSettings.asOf}; data cutoff {sessionSettings.dataCutoff}. No observed account history is included. Future tax law uses an explicitly accepted nominal carry-forward scenario; benefits, withdrawals and property appreciation are not assumed.</p>
              {draft.modelId === "90000000-0000-4000-8000-000000000001" && <details><summary>Synthetic example scope</summary><p>Recorded bank cash, workplace and taxable holdings, a home at recorded cost and a funded fixed mortgage. Retirement spending uses recorded cash. Salary begins {String(objectEntries(draft, "Income")[0]?.start_date ?? "not recorded")}; no earlier paycheck is assumed. Philadelphia payroll elections and annual filing assumptions are explicitly synthetic. Retirement: {getPersonalRetirementPlans(draft).map(plan => `${plan.label} · ${plan.date}`).join("; ")}.</p></details>}
              {newPlanStarters && <button data-context-route onClick={() => navigateFromOverview("Plan", "Assumptions")}>Review optional starting points</button>}
              {(!interactive.available || setupChangesPending || settingsProblem) && <button data-context-route onClick={() => settingsProblem ? openForecastDates() : openForecastSetup(setupMissing[0])}>{settingsProblem ? "Review forecast dates" : "Review setup"}</button>}
            </section>} /></div>}
          save={() => persistenceMode === "enabled" ? void saveToBrowser() : exportModel()}
          saveLabel={persistenceMode === "enabled" ? "Save" : "Export your model"}
          storage={persistenceMode === "enabled" ? "Trusted origin: Save stores this model locally in this browser/origin, without encryption. Export is the recommended backup; JSON exports are plaintext. No financial model is sent to a service." : "This public/demo origin does not store personal models. Export to keep your changes. Do not enter real personal financial information here."}
          onPeople={() => navigate("Settings", "Household & People")}
          onPerson={id => { navigate("Settings", "Household & People"); setEntityRepair({ objectType: "Person", objectId: id, field: "", token: randomId() }); }}
        />
        <button className="secondary settings-button" onClick={() => navigate("Settings")}>
          Settings
        </button>
      </header>
      <nav className="primary-nav" aria-label="Primary navigation">
        {FINANCIAL_DESTINATIONS.map((item) => (
          <button
            key={item.label}
            className={`${destination === item.label ? "active" : ""} ${["Real Estate", "Other Assets", "Debt"].includes(item.label) ? "desktop-destination" : ""}`}
            aria-current={destination === item.label ? "page" : undefined}
            onClick={() => navigate(item.owner, item.section)}
          >
            {item.label}
          </button>
        ))}
        <button ref={moreButton} className="mobile-more" aria-expanded={moreOpen} aria-controls="more-destinations" onClick={() => setMoreOpen(!moreOpen)}>More</button>
      </nav>
      {moreOpen && <nav ref={morePanel} id="more-destinations" className="more-destinations" aria-label="More destinations">
        {FINANCIAL_DESTINATIONS.filter(item => ["Real Estate", "Other Assets", "Debt"].includes(item.label)).map(item => <button key={item.label} onClick={() => navigate(item.owner, item.section)}>{item.label}</button>)}
        <button onClick={() => navigate("Settings", "Household & People")}>Household &amp; People</button>
        <button onClick={() => { navigate("Settings", "Import / Export"); if (persistenceMode === "enabled") void saveToBrowser(); else exportModel(); }}>Save / Return</button>
        <button onClick={() => navigate("Net Worth", "Property & other assets")}>Property &amp; other assets sources</button>
        <button onClick={() => navigate("Settings", "Model Settings")}>Model Settings</button>
        <button onClick={() => navigate("Settings", "Technical diagnostics")}>Technical Details</button>
        {(["Money", "Plan"] as const).map(owner => <div key={owner}><p className="eyebrow">{owner === "Money" ? "Cash sources" : "Planning tasks"}</p>{SUBNAV[owner].map(section => <button key={section} onClick={() => navigate(owner, section)}>{section}</button>)}</div>)}
        <button onClick={() => navigate("Net Worth", "Investments & retirement")}>Investments &amp; retirement</button>
        <button onClick={() => navigate("Settings", "Import / Export")}>Data Management</button>
      </nav>}
      <div className="workspace">
        <nav className="subnav" aria-label={`${destination} sections`}>
          <p className="eyebrow">{destination}</p>
          {SUBNAV[primary].filter(item => !["Real Estate", "Other Assets", "Debt"].includes(item)).map((item) => (
            <button
              key={item}
              className={subnav === item ? "active" : ""}
              aria-current={subnav === item ? "page" : undefined}
              onClick={() => setSubnav(item)}
            >
              {item}
            </button>
          ))}
        </nav>
        <main id="main-content" tabIndex={-1} style={{ minWidth: 0 }}>
          {primary === "Overview" && <CalmPageHeader title="Know where you stand." description="Focus on what matters today, then build a plan at your pace.">
            <CalmAction primary onClick={() => navigateFromOverview("Plan", "Current Plan")}>Explore your plan</CalmAction>
            <CalmAction onClick={() => navigateFromOverview("Money", "Cash Flow")}>See monthly cash</CalmAction>
          </CalmPageHeader>}
          {primary === "Money" && subnav === "Cash Flow" && <CalmPageHeader eyebrow="Cash · Income & spending" title="Your cash, coming in and going out." description="Follow account balances, income and spending. Gross wages are different from bank deposits.">
            <CalmAction primary onClick={() => { setCashReturn(true); navigate("Money", "Income"); }}>Review income</CalmAction>
            <CalmAction onClick={() => { setCashReturn(true); navigate("Money", "Spending"); }}>Edit spending</CalmAction>
          </CalmPageHeader>}
          {cashReturn && !(primary === "Money" && subnav === "Cash Flow") && <div className="cash-return"><button type="button" onClick={() => { setCashReturn(false); navigate("Money", "Cash Flow"); requestAnimationFrame(() => document.querySelector<HTMLSelectElement>('.monthly-money select')?.focus()); }}>Return to Cash breakdown</button><small>Your selected modeled month is retained.</small></div>}
          {primary === "Overview" && <Overview
            position={position!} forecast={householdForecast} draft={draft} forecastState={interactive.baseline}
            asOf={sessionSettings.asOf} dataCutoff={sessionSettings.dataCutoff}
            onPlan={() => navigateFromOverview("Plan", "Current Plan")}
            onCash={() => navigateFromOverview("Money", "Cash Flow")}
            onDebt={() => navigateFromOverview("Net Worth", "Debt")}
            onAccounts={() => navigateFromOverview("Money", "Accounts")}
            onAssets={() => navigateFromOverview("Net Worth", "Property & other assets")}
            correction={(settingsProblem || issues.length > 0 || !interactive.available || setupChangesPending) && <div className="calm-blocker" role="alert" aria-label="Priority correction">
            <p>{settingsProblem || (issues.length > 0 ? "Recorded facts need attention before you rely on the forecast." : setupMissing[0]?.message ?? "Confirm your forecast setup to see the path ahead.")}</p>
            <CalmAction onClick={() => {
              if (settingsProblem) openForecastDates();
              else if (issues.length > 0) { const panel = document.querySelector<HTMLDetailsElement>(".task-readiness"); if (panel) { panel.open = true; focusRepair(panel); } }
              else openForecastSetup(setupMissing[0]);
            }}>{settingsProblem ? "Review forecast dates" : issues.length > 0 ? "Review recorded facts" : "Review setup"}</CalmAction>
          </div>}
          />}
          {primary !== "Overview" && (settingsProblem || issues.length > 0 || !interactive.available || setupChangesPending) && <div className="calm-blocker" role="alert" aria-label="Priority correction">
            <p>{settingsProblem || (issues.length ? "Recorded facts need attention before you rely on this forecast." : setupMissing[0]?.message ?? "Confirm forecast setup to see the path ahead.")}</p>
            <CalmAction onClick={() => {
              if (settingsProblem) openForecastDates();
              else if (issues.length) { const panel = document.querySelector<HTMLDetailsElement>(".task-readiness"); if (panel) { panel.open = true; focusRepair(panel); } }
              else openForecastSetup(setupMissing[0]);
            }}>{settingsProblem ? "Review forecast dates" : issues.length ? "Review recorded facts" : "Review setup"}</CalmAction>
          </div>}
          {primary !== "Overview" && !settingsProblem && !issues.length && interactive.available && !setupChangesPending && (interactive.baseline.pending || interactive.baseline.stale || ["incomplete", "unsupported", "error", "cancelled"].includes(interactive.baseline.lifecycle)) && <p className="result-warning" role="note">Household forecast: {forecastContextLabel(interactive.baseline)}. {interactive.baseline.pending || interactive.baseline.stale ? "Retained results are not current." : "Some results are unavailable; review Forecast details in the top ribbon before relying on them."}</p>}
          <details className="task-readiness">
          <summary>{issues.length ? "Recorded facts need attention" : setupChangesPending ? "Forecast setup changed" : !interactive.available ? "Forecast needs setup" : taxSetupProblem ? "Tax setup needs attention" : "Forecast actions & setup"}</summary>
          {primary === "Overview" && settingsProblem && <p>{settingsProblem} <button onClick={openForecastDates}>Review forecast dates</button></p>}
          {(!interactive.available || setupChangesPending) && <p>{setupMissing[0]?.message ?? "Apply the household forecast setup in Current Plan."}</p>}
          {setupChangesPending && <section className="forecast-status stale" role="status" aria-label="Forecast setup changes"><strong>Update needed · setup choices changed</strong><span>The retained forecast uses the last applied setup.</span><button onClick={() => openForecastSetup()}>Review &amp; apply setup</button></section>}
          {taxSetupProblem && interactive.available && <section className="panel capability" aria-label="Tax forecast needs setup"><strong>Needs setup · Tax payments &amp; refunds</strong><p>{taxSetupProblem}</p><button onClick={() => openForecastSetup()}>Set up tax payments &amp; refunds</button></section>}
          {(!interactive.available || setupChangesPending) && <section className="panel capability" aria-label="Forecast setup checklist">
            <h2>Needs setup · household forecast not run</h2>
            <p>Loading or importing a model clears session-only forecast choices. Complete these choices to run this household; saved purchases and contributions remain in the plan.</p>
            {setupMissing.length > 0 && <ul>{setupMissing.map(item => <li key={item.target}><button type="button" onClick={() => openForecastSetup(item)}>{item.message}</button></li>)}</ul>}
            {!setupMissing.length && !settingsProblem && <p>Required choices are complete. Apply setup &amp; run forecast in Current Plan.</p>}
            <button className="primary" onClick={() => openForecastSetup()}>Complete forecast setup</button>
          </section>}
          {issues.length > 0 && <section className="repair-summary" role="alert" aria-label="Saved plan needs attention">
            <strong>Recorded financial facts need attention</strong>
            <ul>{Array.from(new Map(issues.map(issue => [`${issue.objectType}:${issue.objectId}:${issue.field}`, issue])).values()).map((issue, index) => {
              const presentation = issue.field ? financialFieldOrUndefined(issue.field, issue.objectType) : undefined;
              const type = issue.objectType;
              const item = type ? objectEntries(draft, type).find(value => objectId(type, value) === issue.objectId) : undefined;
              const name = type && item ? objectLabel(type, item) : "Saved plan";
              const repairable = type && item && issue.field && canRepairEntityField(type, issue.field, Object.entries(metadata[type].fields).find(([name]) => name === issue.field)?.[1], item[issue.field], draft);
              return <li key={index}>{name} · {presentation?.label ?? "Recorded relationship"}: {repairable ? "Review this fact before relying on the forecast." : "This recorded fact needs correction. Import corrected records; it cannot be edited here."}
                {!repairable && <button onClick={() => { navigate("Settings"); setSubnav("Import / Export"); }}>Import corrected records</button>}
                {repairable && presentation && type && issue.objectId && <button onClick={() => {
                  setEntityRepair({ objectType: type, objectId: issue.objectId!, field: issue.field!, token: randomId() });
                }}>Review {presentation.label.toLowerCase()}</button>}
              </li>;
            })}</ul>
            <details><summary>Technical saved-fact details</summary><pre>{JSON.stringify(issues, null, 2)}</pre></details>
          </section>}
          </details>
          {primary === "Plan" && subnav === "Compare Plans" && <ForecastStatus label="Household comparison" state={interactive.comparison} />}

          {notice && (
            <div className="notice" role="status">
              <span>{notice}</span>
              <button aria-label="Dismiss" onClick={() => setNotice("")}>
                ×
              </button>
            </div>
          )}
          {primary === "Net Worth" && subnav === "Real Estate" && <MortgageOutlook draft={draft} forecast={householdForecast} property currency={sessionSettings.baseCurrency} asOf={sessionSettings.asOf} selectedMonth={mortgageMonth} selectMonth={setMortgageMonth} selectedLoan={mortgageLoan} selectLoan={setMortgageLoan} />}
          {primary === "Net Worth" && (subnav === "Real Estate" || subnav === "Other Assets") && <AssetSection draft={draft} property={subnav === "Real Estate"} edit={(type, id) => setEntityRepair({ objectType: type, objectId: id, field: "", token: randomId() })} />}
          {primary === "Net Worth" && subnav === "Investments & retirement" && <section className="panel section-outlook" aria-label="Investing outlook"><p className="eyebrow">Investing</p><h1>Your investments</h1><p>{objectEntries(draft, "Investment").length ? "Recorded holdings are listed by account below. Performance attribution is not available in this view." : "No investment holdings recorded. Add only accounts and holdings you own; no returns or contributions are assumed."}</p><p className="chart-placeholder">Account outlook · no supported attribution chart yet</p><a href="#investment-sources">Review investment sources</a></section>}
          {primary === "Net Worth" && subnav === "Debt" && <MortgageOutlook draft={draft} forecast={householdForecast} currency={sessionSettings.baseCurrency} asOf={sessionSettings.asOf} selectedMonth={mortgageMonth} selectMonth={setMortgageMonth} selectedLoan={mortgageLoan} selectLoan={setMortgageLoan} />}
          {primary === "Money" && subnav === "Cash Flow" && (
            <CashFlow
              position={position!}
              asOf={sessionSettings.asOf}
              forecast={householdForecast}
              draft={draft}
              run={runHouseholdForecast}
              pending={interactive.baseline.pending}
              error={runSettingsError}
              selectedMonth={cashMonth}
              selectMonth={setCashMonth}
              openOwner={section => { setCashReturn(true); navigate("Money", section); requestAnimationFrame(() => document.getElementById("main-content")?.focus()); }}
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
            <div id="debt-sources">
              <MonthlyEvidence draft={draft} forecast={householdForecast} mode="debt" />
              <EditorHub
                currency={sessionSettings.baseCurrency}
                types={EDITORS.Debt!}
                draft={draft}
                setDraft={updateCanonicalModel}
                metadata={metadata}
                setNotice={setNotice}
              />
              <DebtExecutionPanel
                draft={draft}
                asOf={sessionSettings.asOf}
                setDraft={updateCanonicalModel}
                liabilityConfig={liabilityConfig}
                setLiabilityConfig={setLiabilityConfig}
                run={() => runForecast("liabilities")}
                forecast={forecast}
                error={runSettingsError}
              />
              <StandaloneStatus view={standalone.view} cancel={() => standalone.controller.cancel()} />
            </div>
          )}
          {primary === "Plan" && subnav === "Current Plan" && (
            <>
              <section className="panel section-outlook" aria-label="Planning outlook"><p className="eyebrow">Planning</p><h1>Your current plan</h1><p>Projection dates: {String(currentPlan(draft)?.start_date ?? "Not recorded")} → {String(currentPlan(draft)?.end_date ?? "Not recorded")} (exclusive end). Source: Current Plan.</p><p className="chart-placeholder">Retirement income composition · chart not yet available; no benefits or withdrawals assumed</p><a href="#forecast-setup">Review forecast setup</a></section>
              <HouseholdPlan
                draft={draft}
                readiness={readiness}
                settings={sessionSettings}
                setSettings={value => { setRunSettingsError(""); setSessionSettings(value); }}
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
                lawAccepted={lawAccepted}
                setLawAccepted={setLawAccepted}
                setHouseholdExecution={(bindings) => {
                  const mortgages = objectEntries(draft, "Liability").filter((item) => item.liability_type === "mortgage");
                  const missing = setupMissing.filter(item => item.target !== "lawScenario");
                  if (missing.length || settingsProblem) return setRunSettingsError([...missing.map(item => item.message), ...(settingsProblem ? [settingsProblem] : [])].join(" "));
                  setLawAccepted(true);
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

              <details className="panel">
              <summary>Expert standalone forecasts</summary>
              <p>Inspect a supported scope independently. These results are separate from the reconciled household outlook.</p>
              <section aria-label="Standalone forecast drill-down">
                <StandaloneStatus view={standalone.view} cancel={() => standalone.controller.cancel()} />
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
              <div id={subnav === "Investments & retirement" ? "investment-sources" : undefined}>
              <EditorHub
                currency={sessionSettings.baseCurrency}
                types={EDITORS[subnav]!}
                section={primary === "Money" && subnav === "Accounts" ? "Cash & bank accounts" : primary === "Net Worth" ? subnav as NetWorthSection : undefined}
                mirror={subnav === "Assumptions" || primary === "Net Worth" && subnav === "Cash & bank accounts"}
                onOpenOwner={(type, id) => setEntityRepair({ objectType: type, objectId: id, field: "", token: randomId() })}
                selectedScenarioId={effectiveHouseholdExecution?.selectedRootScenarioId}
                onContributions={(investmentId, kind) => {
                  setContributionTarget({ investmentId, kind });
                  navigate("Net Worth"); setSubnav("Investments & retirement");
                  requestAnimationFrame(() => focusRepair(document.querySelector<HTMLElement>(`#${kind === "personal" ? "personal-contributions" : "payroll-contributions"} select`)));
                }}
                draft={draft}
                setDraft={updateCanonicalModel}
                metadata={metadata}
                setNotice={setNotice}
              />
              </div>
            )}
          {primary === "Money" && subnav === "Income" && <><IncomeReceivingAccount draft={draft} value={cashFlowExecutionAccountId} onChange={setCashFlowExecutionAccountId} /><PaycheckAuthoring draft={draft} setDraft={updateCanonicalModel} /><AnnualFactsOwner draft={draft} owner="income" /></>}
          {primary === "Plan" && subnav === "Assumptions" && newPlanStarters && <PlanningStartingPoints model={draft} apply={updateCanonicalModel} dismiss={() => setNewPlanStarters(false)} />}
          {primary === "Settings" && subnav === "Household & People" && <AnnualFactsOwner draft={draft} owner="people" />}
          {primary === "Money" && subnav === "Spending" && <MonthlyEvidence draft={draft} forecast={householdForecast} mode="spending" />}
          {primary === "Net Worth" && subnav === "Investments & retirement" && <>
            <section className="panel" id="investment-contribution-summary" tabIndex={-1}>
              <h2>Contributions in your accounts</h2><p>Choose Manage contributions on a holding above to review its funding and future activity.</p>
            </section>
            <FinancialSection title="IRA & brokerage contributions" open={contributionTarget?.kind === "personal"}><PersonalPurchaseAuthoring key={`personal:${contributionTarget?.kind === "personal" ? contributionTarget.investmentId : "overview"}`} draft={draft} setDraft={updateCanonicalModel} initialInvestmentId={contributionTarget?.kind === "personal" ? contributionTarget.investmentId : undefined} /></FinancialSection>
            <FinancialSection title="Workplace & HSA contributions" open={contributionTarget?.kind === "payroll"}><PayrollContributionAuthoring key={`payroll:${contributionTarget?.kind === "payroll" ? contributionTarget.investmentId : "overview"}`} draft={draft} setDraft={updateCanonicalModel} initialInvestmentId={contributionTarget?.kind === "payroll" ? contributionTarget.investmentId : undefined} /></FinancialSection>
            <FinancialSection title="Contributions already made this year"><OpeningContributionUsageAuthoring draft={draft} setDraft={updateCanonicalModel} /></FinancialSection>
            <AnnualFactsOwner draft={draft} owner="investment" />
            <FinancialSection title="Annual contribution allowance"><ContributionCapacityPanel draft={draft} forecast={householdForecast} /></FinancialSection>
          </>}
          {primary === "Money" && subnav === "Insurance & coverage" && <InsuranceSection key={insuranceTarget ?? "insurance-overview"} initialPolicyId={insuranceTarget} draft={draft} setDraft={updateCanonicalModel} />}
          {primary === "Plan" && subnav === "Life Events" && <><RetirementDateAuthoring draft={draft} setDraft={updateCanonicalModel} asOf={sessionSettings.asOf} /><InsuredLifeEvents draft={draft} setDraft={updateCanonicalModel} /></>}
          {primary === "Plan" &&
            subnav === "Life Events" &&
            !EDITORS[subnav] && (
              <Capability
                title="Life events"
                message="Retirement can execute only with an explicit binding to one income-termination event and changes that stop date only. Marriage, childbirth, home purchase, disability, and other event types are preserved but have no modeled consequences yet."
              />
            )}
          {entityRepair && <EditorHub contextOnly repairTarget={entityRepair} types={[entityRepair.objectType]} draft={draft} setDraft={updateCanonicalModel} metadata={metadata} setNotice={setNotice} currency={sessionSettings.baseCurrency} selectedScenarioId={effectiveHouseholdExecution?.selectedRootScenarioId} onClose={() => setEntityRepair(undefined)} />}
        </main>
      </div>
    </div>
    </Profiler>
    </BrowserPerformanceScope.Provider>
    </FinancialResultModels.Provider>
    </FinancialFactEditors>
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

export function sharedContextIdentity(draft: PersonalDraft, selectedRootScenarioId?: string) {
  const households = objectEntries(draft, "Household");
  const household = draft.objects.Household?.length === 1 && households.length === 1 && canonicalId(households[0]!, "household_id") ? households[0] : undefined;
  // Reuse canonical validation and UUID normalization; never invent an execution
  // scope when recorded membership is contradictory or identity is ambiguous.
  const scope = resolveHouseholdScope(draft);
  const people = scope.status === "compiled" ? scope.value.memberIds
    .map(id => scope.value.peopleById.get(id)!)
    .filter(person => canonicalId(person, "household_id") === scope.value.householdId) : [];
  const membershipReview = !household
    ? "A single household with a valid identity is required."
    : scope.status !== "compiled" || people.length !== objectEntries(draft, "Person").length
      ? "Some recorded member identities or household links are missing, invalid or inconsistent."
      : undefined;
  const labels = people.map(person => objectLabel("Person", person).trim() || "Unnamed person");
  const labelCounts = new Map<string, number>();
  for (const label of labels) labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  const selected = objectEntries(draft, "Scenario").find(item => objectId("Scenario", item) === selectedRootScenarioId && item.enabled === true && item.base_scenario_id == null);
  const saved = currentPlan(draft);
  return {
    household: household ? typeof household.name === "string" && household.name.trim() ? household.name : "Unnamed household" : "Household unavailable",
    ...(membershipReview ? { membershipReview } : {}),
    people: people.map((person, index) => ({ id: objectId("Person", person), label: labelCounts.get(labels[index]!)! > 1 ? `${labels[index]} · ID ${objectId("Person", person)}${person.date_of_birth ? ` · born ${person.date_of_birth}` : ""}` : labels[index]! })),
    plan: selected ? objectLabel("Scenario", selected) : saved ? `${objectLabel("Scenario", saved)} · saved plan (execution not selected)` : "No active plan",
  };
}

function ForecastStatus({ label, state, compact = false, setupChanged = false, update, ribbon = false, coverage }: { label: string; state: ForecastView; compact?: boolean; setupChanged?: boolean; update?: () => void; ribbon?: boolean; coverage?: ReactNode }) {
  const { model: currentModel, reviewMortgageOperations } = useContext(FinancialResultModels);
  const diagnosticModel = state.latestResult?.status === "unavailable" ? currentModel : state.resultModel;
  const diagnostics = (state.latestResult ?? state.lastGoodResult)?.diagnostics ?? [];
  const firstDiagnostic = primaryForecastDiagnostic(diagnostics);
  const blocked = state.lifecycle === "unsupported";
  // Partial execution can omit only one unsupported payroll source; retain the
  // established Income-field repair action without calling the whole run unsupported.
  const repairablePayroll = state.lifecycle === "incomplete" && firstDiagnostic?.entityType === "tax_capability" && "category" in firstDiagnostic && firstDiagnostic.category === "payroll_source_unsupported";
  const summary = firstDiagnostic && diagnosticSummary(firstDiagnostic, diagnosticModel);
  const content = <>
    <strong>{label} · {state.pending ? "Running" : state.lifecycle === "error" ? "Failed" : state.stale || setupChanged ? "Update needed" : state.lifecycle === "completed" ? "Ready" : state.lifecycle === "incomplete" ? "Partially modeled" : state.lifecycle === "unsupported" ? "Unsupported" : state.lifecycle === "idle" ? "Needs setup" : forecastContextLabel(state)}</strong>
    {state.pending && <span>{state.lastGoodResult ? "Recalculating" : "Running"} {compact ? "your forecast" : "deterministic forecast"}…</span>}
    {(state.stale || setupChanged) && <span>Old result — inputs changed; these numbers are not current.</span>}
    {!state.pending && !state.stale && !setupChanged && state.cacheState === "hit" && <span>Current result reused</span>}
    {!compact && !state.pending && !state.stale && !setupChanged && state.lifecycle === "completed" && state.cacheState !== "hit" && <span>Current result</span>}
    {!state.pending && !state.stale && !setupChanged && state.lifecycle === "incomplete" && <><span>Some outputs are incomplete; after-tax totals may be unavailable.</span>
      </>}
    {blocked && !summary && <span>Review the guidance below, correct the supported setup or import a supported model, then Update forecast.</span>}
    {state.message && !(blocked && summary) && (!compact || state.lifecycle === "error") && <span>{friendlyText(state.message)}</span>}
    {firstDiagnostic && summary && !state.pending && (!compact || blocked) && <div className="forecast-primary-guidance">
      <p>{summary.problem}</p>
      {(blocked || repairablePayroll) && <>
        <p>{summary.remedy}</p>
        {firstDiagnostic.code === "MORTGAGE_REFINANCE_UNSUPPORTED"
          ? <button type="button" onClick={reviewMortgageOperations}>Review saved refinance</button>
          : <>{diagnosticModel && <DiagnosticReferences targets={diagnosticTargets(diagnosticModel, firstDiagnostic)} />}
            {("category" in firstDiagnostic && (firstDiagnostic.category === "payment_funding" || firstDiagnostic.category === "settlement_timing")) && <ForecastSetupLink target="taxSetup" />}</>}
      </>}
    </div>}
    {diagnostics.length > 0 && <details className="forecast-guidance"><summary>Review forecast limitations</summary><DiagnosticList diagnostics={diagnostics} model={diagnosticModel} /></details>}
    <details><summary>Technical forecast details</summary>
      {compact && state.message && <p>{friendlyText(state.message)}</p>}
      <dl><dt>Lifecycle</dt><dd>{state.lifecycle}</dd><dt>Request</dt><dd>{state.requestId ?? "Not submitted"}</dd>
        <dt>Cache</dt><dd>{state.cacheState ?? "Not applicable"}</dd>
        <dt>Requested fingerprint</dt><dd>{state.fingerprint ?? "Not submitted"}</dd>
        <dt>Result source fingerprint</dt><dd>{state.resultFingerprint ?? "No result"}</dd>
        <dt>Result run window (exclusive end)</dt><dd>{state.resultRequest?.compiler.cashFlow?.simulationStart ?? "Unavailable"} → {state.resultRequest?.compiler.cashFlow?.simulationEnd ?? "Unavailable"}</dd>
        {state.message && !state.latestResult?.diagnostics?.length && <><dt>Original diagnostic</dt><dd>{state.message}</dd></>}
      </dl>
    </details>
    {coverage}
    {!ribbon && update && <CalmAction onClick={update}>Update forecast</CalmAction>}
  </>;
  return <section className={`forecast-status ${state.stale || setupChanged ? "stale" : ""} ${compact ? "calm-status" : ""} ${ribbon ? "context-forecast" : ""}`} role="status" aria-live={ribbon ? "off" : undefined} aria-label={`${label} status`}
    data-lifecycle={state.lifecycle} data-pending={state.pending} data-fingerprint={state.fingerprint} data-request-id={state.requestId}
    data-result-fingerprint={state.resultFingerprint} data-cache-state={state.cacheState}
    data-requested-start={state.resultRequest?.compiler.cashFlow?.simulationStart} data-requested-end={state.resultRequest?.compiler.cashFlow?.simulationEnd}
    data-modeled-periods={state.lastGoodResult && "points" in state.lastGoodResult ? state.lastGoodResult.points.length : undefined}
    data-reached-through={state.lastGoodResult && "reachedThrough" in state.lastGoodResult ? state.lastGoodResult.reachedThrough : undefined}>
    {ribbon ? <ContextDisclosure title={`Forecast: ${forecastContextLabel(state, setupChanged)}`}>{content}</ContextDisclosure> : content}
    {ribbon && update && <CalmAction onClick={update}>Update forecast</CalmAction>}
  </section>;
}

function MortgageOutlook({ draft, forecast, property = false, currency, selectedMonth, selectMonth, selectedLoan, selectLoan }: {
  draft: PersonalDraft; forecast: PersonalHouseholdForecastReadModel | undefined; property?: boolean;
  currency: string; asOf: string;
  selectedMonth: string; selectMonth: (month: string) => void; selectedLoan: string; selectLoan: (loan: string) => void;
}) {
  const models = useContext(FinancialResultModels);
  const current = !!models.baseline && models.baseline.lastGoodResult === forecast && models.baseline.resultModel === draft &&
    !models.baseline.pending && !models.baseline.stale && !models.setupChangesPending;
  const loans = objectEntries(draft, "Liability").filter(value => value.liability_type === "mortgage");
  const selected = loans.find(value => value.liability_id === selectedLoan) ?? loans[0];
  const liabilityId = selected ? objectId("Liability", selected) : "";
  const points = forecast && forecast.status !== "unavailable" ? forecast.points : [];
  const selectedIndex = Math.max(0, points.findIndex(point => point.periodStart === selectedMonth));
  const startIndex = Math.floor(selectedIndex / 12) * 12;
  const selectedStart = points[selectedIndex]?.periodStart ?? "";
  const liabilityData = useMemo(() => current && forecast && points.length ? inspectLiabilityBalanceWindow(forecast, startIndex) : undefined, [current, forecast, points.length, startIndex]);
  const active = useForecastEvidence(forecast, draft, current && !!liabilityId, { operation: "mortgage_evidence", startIndex, liabilityId });
  const review = (id: string) => models.reviewTarget?.({ id, type: "Liability", objectType: "Liability", label: referenceLabel(draft, "Liability", id), editable: false });
  const setup = () => models.reviewTarget?.({ id: "", type: "Forecast setup", label: "Forecast setup", editable: false });
  return <section className="panel section-outlook mortgage-outlook" aria-label={property ? "Property mortgage outlook" : "Debt outlook"}
    data-evidence-state={!loans.length ? "unavailable" : models.baseline?.pending ? "pending" : models.baseline?.lifecycle === "error" ? "error" : models.baseline?.lifecycle === "unsupported" ? "unsupported" : !forecast ? "unavailable" : !current ? "stale" : !points.length ? "unavailable" : active?.error ? "error" : active?.window?.status ?? "loading"}>
    <p className="eyebrow">{property ? "Real Estate" : "Debt"}</p><h1>{property ? "Your property" : "Your borrowing"}</h1>
    <details aria-label="Evidence phase timings"><summary>Evidence loading details</summary>
      <ul>{active.diagnostics.map((record, index) => <li key={index}>Request {record.requestId} · {record.phase} · {record.pointCount} selected periods · {Math.round(record.elapsedMs)} ms since selection</li>)}</ul>
    </details>
    {!property && (liabilityData ? <>
      <LiabilityBalanceOutlook data={liabilityData} selectedStart={selectedStart} selectMonth={selectMonth} />
      <div className="mortgage-window-controls" aria-label="Household liability chart window">
        <label>Liability window starting<select aria-label="Liability window starting" value={points[startIndex]!.periodStart} onChange={event => selectMonth(event.target.value)}>
          {points.filter((_point, index) => index % 12 === 0).map(point => <option key={point.periodStart} value={point.periodStart}>{point.periodStart.slice(0, 10)}</option>)}
        </select></label>
        <button disabled={startIndex === 0} onClick={() => selectMonth(points[Math.max(0, startIndex - 12)]!.periodStart)}>Previous liability months</button>
        <button disabled={startIndex + 12 >= points.length} onClick={() => selectMonth(points[startIndex + 12]!.periodStart)}>Next liability months</button>
      </div>
    </> : <section aria-label="Household liability balance outlook" data-evidence-state={models.baseline?.pending ? "pending" : models.baseline?.lifecycle === "error" ? "error" : !forecast || forecast.status === "unavailable" || current && !points.length ? "unavailable" : "stale"}>
      <h2>Household liability balance outlook</h2><p role="status">{models.baseline?.pending ? "Updating forecast · liability balances pending." : models.baseline?.lifecycle === "error" ? "Forecast failed · liability balances unavailable." : !current ? "Update the forecast to view current modeled household liabilities." : "Liability forecast unavailable for the current source coverage."}</p><button onClick={setup}>Review liability forecast setup</button>
    </section>)}
    <p>See how funded payments reduce one named mortgage. Recorded current balances and modeled future principal have different dates.</p>
    {!!loans.length && <label>Mortgage<select aria-label="Mortgage" value={liabilityId} onChange={event => selectLoan(event.target.value)}>{loans.map(loan => <option key={objectId("Liability", loan)} value={objectId("Liability", loan)}>{objectLabel("Liability", loan)}</option>)}</select></label>}
    {!loans.length ? <p>No mortgage recorded. Add a mortgage through Net Worth → Debt; other debt is listed separately.</p> : <>
      <p>{objectLabel("Liability", selected!)} · recorded current principal: {typeof selected!.current_balance === "string" ? formatExactMoney(selected!.current_balance, currency) : "Not recorded"}. Balance observation date not supplied here. Source: Net Worth → Debt.</p>
      <button type="button" onClick={() => review(liabilityId)}>Review mortgage source</button>
      {!current || !points.length ? <><p role="status">{models.baseline?.pending ? "Updating forecast · mortgage evidence is pending." : models.baseline?.lifecycle === "error" ? "Forecast failed · update needed before mortgage evidence can be shown." : models.baseline?.lifecycle === "unsupported" ? "Mortgage forecast unsupported · review the forecast setup and source guidance." : !forecast || current && !points.length ? "Mortgage evidence unavailable · no successfully modeled months. Review forecast limitations and setup." : "Out of date · update needed before retained mortgage evidence can be shown."}</p><button onClick={setup}>Review forecast setup</button></>
        : <><div className="mortgage-window-controls" aria-label="Mortgage chart window">
          <button disabled={startIndex === 0} onClick={() => selectMonth(points[Math.max(0, startIndex - 12)]!.periodStart)}>Previous 12 months</button>
          <span>{points[startIndex]?.periodStart.slice(0, 10)} → {points[Math.min(points.length - 1, startIndex + 11)]?.periodEnd.slice(0, 10)} (exclusive)</span>
          <button disabled={startIndex + 12 >= points.length} onClick={() => selectMonth(points[startIndex + 12]!.periodStart)}>Next 12 months</button>
        </div>
        {forecast?.status === "incomplete" && <p>Partial forecast horizon · only successfully modeled periods are available.</p>}
        {selectedMonth && !points.some(point => point.periodStart === selectedMonth) && <p>The previously selected month is outside this forecast. Showing the first supported month.</p>}
        {points.slice(startIndex, startIndex + 12).length < 12 && <p>Partial window at the forecast boundary · no months beyond the supported result are assumed.</p>}
        {active?.error ? <><p role="alert">{active.error}</p><button onClick={active.refresh}>Retry mortgage evidence</button><button onClick={setup}>Review forecast setup</button></>
          : active?.window ? <MortgageAmortization window={active.window} loanName={objectLabel("Liability", selected!)} selectedStart={selectedStart} selectMonth={selectMonth} /> : <p role="status">Loading bounded mortgage evidence…</p>}
        </>}
      {property && <p>{selected?.collateral_id && objectEntries(draft, "Asset").some(asset => asset.asset_id === selected.collateral_id && asset.asset_type === "real_estate")
        ? `Linked property: ${referenceLabel(draft, "Asset", String(selected.collateral_id))}.` : "No matching property collateral is recorded for this mortgage."} Current equity cannot be reconciled without a compatible current valuation and all linked liens at the same date and currency.</p>}
    </>}
    {!property && <section aria-label="Other debt sources"><h2>Other borrowing</h2>{objectEntries(draft, "Liability").filter(value => value.liability_type !== "mortgage").map(value => <p key={objectId("Liability", value)}>{objectLabel("Liability", value)} · current recorded balance {typeof value.current_balance === "string" ? formatExactMoney(value.current_balance, currency) : "unavailable"} · observation date not supplied here · {String(value.liability_type).replaceAll("_", " ")}. Mortgage amortization unavailable for this debt type. <button onClick={() => review(objectId("Liability", value))}>Review {objectLabel("Liability", value)}</button></p>)}</section>}
    {property ? <AssetOwnerLink /> : <a href="#debt-sources">Review loan sources &amp; payment setup</a>}
  </section>;
}

function AssetSection({ draft, property, edit }: { draft: PersonalDraft; property: boolean; edit: (type: PersonalObjectType, id: string) => void }) {
  const assets = objectEntries(draft, "Asset").filter(item => belongsToNetWorthSection(draft, "Asset", item, "Property & other assets") && (item.asset_type === "real_estate") === property);
  const title = property ? "Real Estate" : "Other Assets";
  return <section className="panel section-outlook" aria-label={`${title} outlook`}>
    <p className="eyebrow">{title}</p>{property ? <h2>Property sources</h2> : <h1>Your other assets</h1>}
    {!property && <p className="chart-placeholder">{assets.length ? "Recorded assets available · historical value and attribution chart not yet supported" : "No other assets recorded · no chart data"}</p>}
    <p>Source: Net Worth → Property &amp; other assets. Recorded acquisition cost is not current market value or home equity.</p>
    {assets.length ? <ul className="asset-sources">{assets.map(item => <li key={objectId("Asset", item)}><strong>{objectLabel("Asset", item)}</strong><p>{entitySummary("Asset", item, draft)}</p>
      {property && <p>Recorded acquisition cost: {typeof item.acquisition_cost === "string" ? item.acquisition_cost : "Unavailable"}; acquisition date: {String(item.acquisition_date ?? "Not recorded")}. Current market value and home equity are unavailable from this cost source.</p>}
      <button onClick={() => edit("Asset", objectId("Asset", item))}>Edit {objectLabel("Asset", item)}</button>
      {property && objectEntries(draft, "Liability").filter(debt => debt.collateral_id === item.asset_id).map(debt => <p key={objectId("Liability", debt)}>Secured debt: {objectLabel("Liability", debt)} <button onClick={() => edit("Liability", objectId("Liability", debt))}>Review loan</button></p>)}
    </li>)}</ul> : <p>Add a supported source asset in the owner editor when you have its facts.</p>}
    <AssetOwnerLink />
  </section>;
}
function AssetOwnerLink() {
  const { reviewTarget } = useContext(FinancialResultModels);
  return <button onClick={() => reviewTarget?.({ id: "", type: "Asset sources", label: "Property & other assets", editable: false })}>Open asset sources</button>;
}

function Overview({
  position,
  forecast,
  forecastState,
  draft,
  onPlan,
  asOf,
  dataCutoff,
  onCash,
  onDebt,
  onAccounts,
  onAssets,
  correction,
}: {
  position: NonNullable<ReturnType<typeof getCurrentPosition>>;
  forecast: PersonalHouseholdForecastReadModel | undefined;
  forecastState: ForecastView;
  draft: PersonalDraft;
  onPlan: () => void;
  asOf: string;
  dataCutoff: string;
  onCash: () => void;
  onDebt: () => void;
  onAccounts: () => void;
  onAssets: () => void;
  correction: ReactNode;
}) {
  const additional = [
    ["Cash inside investment accounts", position.wrapperCash],
    ["Unvested employer plan value (contingent)", position.contingentPlanValue],
    ["Monthly income from recorded sources", position.monthlyIncome],
    ["Monthly spending from recorded sources", position.monthlySpending],
    ["Monthly cash flow from recorded sources", position.monthlyCashFlow],
  ] as const;
  const supported = forecast?.status === "completed" || forecast?.status === "incomplete";
  const current = <section aria-label="Your finances today" className="calm-current">
        <h2>Your finances today</h2>
        {position.status !== "complete" && <p className="calm-caption">Some recorded information is missing or unsupported. Unavailable values have not been estimated; see data coverage below.</p>}
        <div className="calm-metrics">
          <CalmMetric label="Cash and savings" value={position.cash?.display} source={`Recorded cash accounts · as of ${asOf}`} explanation="Household cash accounts only; excludes cash inside investment accounts." />
          <CalmMetric label="Outstanding debt" value={position.liabilities?.display} source={`Recorded liabilities · as of ${asOf}`} explanation="Recorded borrowing balances, separate from future payments." />
          <CalmMetric label="Net worth" value={position.netWorth?.display} source={`Recorded assets less liabilities · as of ${asOf}`} explanation="Includes supported recorded holdings and assets; not all available to spend." />
        </div>
      </section>;
  return (
    <div className="calm-overview">
      <CalmPanel title="Your money over time" className="calm-outlook">
        {supported ? <HouseholdForecastVisual forecast={forecast} draft={draft} calm /> : (
          <div className="calm-empty">
            <strong>{forecastState.pending ? "Calculating your forecast…" : forecastState.lifecycle === "error" ? "Your forecast could not be calculated" : forecast?.status === "unavailable" ? "Your forecast is unavailable" : "Your forecast is not ready yet"}</strong>
            <p>No future path has been calculated. Your recorded finances are still available below.</p>
            {correction || status}
          </div>
        )}
        {supported && correction}
      </CalmPanel>
      {current}
      <div className="calm-lower-grid">
        <CalmPanel title="Where should we start?">
          <p className="calm-caption">Choose a question to explore.</p>
          <div className="calm-questions">
            <CalmAction onClick={onCash}>Where does my money go? <span aria-hidden="true">→</span></CalmAction>
            <CalmAction onClick={onDebt}>What do I owe? <span aria-hidden="true">→</span></CalmAction>
            <CalmAction onClick={onPlan}>How is my plan looking? <span aria-hidden="true">→</span></CalmAction>
          </div>
        </CalmPanel>
        <CalmPanel title="What these numbers include">
          <p className="calm-caption">Recorded facts and future assumptions have different scopes.</p>
          <CalmDisclosure title="How this is calculated / data coverage">
            <p>Current-position values use this household’s recorded accounts, holdings, assets and liabilities. Data cutoff: {dataCutoff}. The graph uses the separately applied forecast, not observed history.</p>
            <p>Investment-account cash is separate from household cash. Account containers and their holdings are not counted twice. Acquisition cost is not a current property valuation. Unvested employer value is contingent.</p>
            <p>Monthly values describe supported recorded income and spending; they are not verified take-home pay or bank deposits.</p>
            {position.diagnostics.length > 0 ? <DiagnosticList diagnostics={position.diagnostics} /> : <p>Current-position sources are supported.</p>}
            <CalmAction onClick={onAccounts}>Review accounts</CalmAction>{" "}<CalmAction onClick={onDebt}>Review debt</CalmAction>{" "}<CalmAction onClick={onAssets}>Review asset sources</CalmAction>
          </CalmDisclosure>
        </CalmPanel>
      </div>
      <CalmDisclosure title="More about your finances · Current position details">
        <dl className="calm-additional-values">{additional.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value?.display ?? "Unavailable"}</dd></div>)}</dl>
        <p>These values come from current recorded sources, separate from forecast-period results. Monthly cash flow is supported monthly income less spending, not a bank cash balance or an after-tax spending allowance.</p>
      </CalmDisclosure>
    </div>
  );
}
function MonthlyEvidence({ draft, forecast, mode, selectedMonth, selectMonth }: { draft: PersonalDraft; forecast?: PersonalHouseholdForecastReadModel | undefined; mode: "paycheck" | "debt" | "spending"; selectedMonth?: string | undefined; selectMonth?: ((month: string) => void) | undefined }) {
  const models = useContext(FinancialResultModels);
  const current = !!models.baseline && models.baseline.lastGoodResult === forecast && models.baseline.resultModel === draft && !models.baseline.pending && !models.baseline.stale && !models.setupChangesPending;
  return <MonthlyMoneyPanel draft={models.baseline?.resultModel ?? draft} forecast={forecast} current={current} mode={mode} selectedMonth={selectedMonth} selectMonth={selectMonth}
    setup={() => models.reviewTarget?.({ id: "", type: "Forecast setup", label: "Forecast setup", editable: false })}
    coverageSetup={() => models.reviewTarget?.({ id: "", type: "Forecast setup", label: "Tax coverage & setup", field: "taxSetup", editable: false })}
    review={(type, id) => {
      if (type === "Insurance") models.reviewInsurance?.(id);
      else if (type === "Investment") {
        const holding = objectEntries(draft, "Investment").find(item => item.investment_id === id);
        const account = objectEntries(draft, "Account").find(item => item.account_id === holding?.account_id);
        models.reviewContributions?.(id, ["traditional_401k", "roth_401k", "hsa", "hsa_investment"].includes(String(account?.account_type)) ? "payroll" : "personal");
      } else models.reviewTarget?.({ id, type, objectType: type, label: referenceLabel(draft, type, id), editable: false });
    }} />;
}
function CashFlow({
  position,
  asOf,
  forecast,
  run,
  pending,
  draft,
  error,
  selectedMonth,
  selectMonth,
  openOwner,
}: {
  position: ReturnType<typeof getCurrentPosition>;
  asOf: string;
  forecast: PersonalHouseholdForecastReadModel | undefined;
  run: () => void;
  pending: boolean;
  draft: PersonalDraft;
  error: string;
  selectedMonth: string;
  selectMonth: (month: string) => void;
  openOwner: (section: string) => void;
}) {
  const cashSources = <CalmDisclosure title="Recorded cash sources and limitations">
    <p>Recorded balances are as of {asOf}. Forecast cash includes bank and investment-account cash. Neither is a take-home paycheck estimate.</p>
    {position.diagnostics.length > 0 && <DiagnosticList diagnostics={position.diagnostics} />}
    <CalmAction onClick={() => openOwner("Accounts")}>Review account balances</CalmAction>
  </CalmDisclosure>;
  return (
    <div className="calm-cash">
      <nav className="cash-tasks" aria-label="Cash tasks">
        {(["Income", "Spending", "Accounts", "Insurance & coverage"] as const).map(section => <button key={section} type="button" aria-label={`Review ${section} sources`} onClick={() => openOwner(section)}>{section}</button>)}
      </nav>
      <section className="calm-cash-current" aria-label="Recorded cash today">
        <article aria-label="Bank cash and savings"><p><strong>Bank cash and savings</strong> · <span className="calm-metric-value">{position.cash?.display ?? "Unavailable"}</span></p><small>Recorded bank accounts · as of {asOf}</small></article>
        <article aria-label="Cash inside investment accounts"><p><strong>Cash inside investment accounts</strong> · <span className="calm-metric-value">{position.wrapperCash?.display ?? "Unavailable"}</span></p><small>Recorded investment accounts · as of {asOf}</small></article>
      </section>
      <section aria-label="How your cash may change" className="calm-panel calm-cash-charts">
        <button type="button" className="calm-action" onClick={run} disabled={pending}>Run cash-flow forecast</button>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        {forecast && forecast.status !== "unavailable" && <>
          {forecast.stoppedAt && <p className="chart-qualification" role="status">Forecast stopped at {forecast.stoppedAt.slice(0, 10)}; requested end {forecast.requestedHorizon.end.slice(0, 10)}.</p>}
          {forecast.liquidityShortfalls.length > 0 && <p className="chart-qualification" role="alert">Modeled liquidity stress · {forecast.liquidityShortfalls.length} funding shortfalls. Review funding sources in Chart Details.</p>}
        </>}
        {forecast?.status === "completed" ||
        forecast?.status === "incomplete" ? (
          <HouseholdForecastVisual
            forecast={forecast}
            draft={draft}
            cashFlowOnly
            calm
            cashSources={cashSources}
          />
        ) : forecast?.status === "unavailable" ? (
          <><p className="calm-empty" role="status">No supported cash trajectory is available. Recorded balances are shown above.</p><CashChartDetails title="Total modeled cash"><CalmDisclosure title="Why this forecast is unavailable"><DiagnosticList
            diagnostics={forecast.diagnostics}
            fallback={forecast.message}
          /></CalmDisclosure>{cashSources}</CashChartDetails></>
        ) : (
          <><Empty text="No supported cash forecast yet. Run the household forecast to see its cash trend; no deposits or spending are inferred." /><CashChartDetails title="Total modeled cash">{cashSources}</CashChartDetails></>
        )}
      <MonthlyEvidence draft={draft} forecast={forecast} mode="paycheck" selectedMonth={selectedMonth} selectMonth={selectMonth} />
      </section>
    </div>
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
function StandaloneStatus({ view, cancel }: { view: import("./forecast/controller.js").StandaloneView; cancel: () => void }) {
  return <section aria-label="Standalone calculation status" data-state={view.pending ? "running" : view.error ? "error" : view.cancelled ? "cancelled" : view.stale ? "stale" : view.result?.status ?? "idle"}>
    {view.pending && <><p role="status">Calculating standalone forecast in a worker…</p><button onClick={cancel}>Cancel standalone forecast</button></>}
    {view.stale && <p role="status">The retained standalone result is out of date. Run the forecast to refresh it.</p>}
    {view.cancelled && <p role="status">Standalone forecast cancelled. Run the forecast to try again.</p>}
    {view.error && <p role="alert">{view.error}</p>}
    {view.durationMs !== undefined && !view.pending && !view.stale && <details><summary>Standalone execution timing</summary><p>Worker calculation: {Math.round(view.durationMs)} ms</p></details>}
  </section>;
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
          asOf={settings.asOf}
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
      {!ownerId && people.length === 1 && <button type="button" onClick={() => setOwnerId(objectId("Person", people[0]!))}>Accept named investment owner · {objectLabel("Person", people[0]!)}</button>}
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
  asOf,
  liabilityConfig,
  setLiabilityConfig,
  setDraft,
}: {
  draft: PersonalDraft;
  asOf: string;
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
      {!liabilityConfig.ownerId && people.length === 1 && <button type="button" onClick={() => setLiabilityConfig(previous => ({ ...previous, ownerId: objectId("Person", people[0]!) }))}>Accept named debt execution owner · {objectLabel("Person", people[0]!)}</button>}
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
            <LoanSetupSuggestions firstPayment={profile.paymentAnchor} maturity={String(mortgage.maturity_date ?? "")} origination={String(mortgage.origination_date ?? "")} asOf={asOf} count={profile.totalPayments} confirm={value => updateProfile(id, "totalPayments", value)} />
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
            
            {!suggestedCount && String(mortgage.origination_date) >= asOf && !profile.totalPayments && <button type="button" onClick={() => updateProfile(id, "totalPayments", "360")}>Suggest illustrative new-loan term · 30 years monthly (original count; confirm the contract)</button>}
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
function IncomeReceivingAccount({ draft, value, onChange }: { draft: PersonalDraft; value: string; onChange: (value: string) => void }) {
  return <GuidedFields scope="cash" required={["cashAccount"]}><section className="panel" aria-label="Income deposit routing"><h2>Income receiving account</h2><small>This is the fallback bank for supported income without its own durable paycheck routing. Source-bound paycheck elections retain their explicitly authorized receiving bank.</small>
    {!value && objectEntries(draft, "Account").filter(isCashFlowPaymentAccount).length === 1 && <button type="button" onClick={() => onChange(objectId("Account", objectEntries(draft, "Account").filter(isCashFlowPaymentAccount)[0]!))}>Accept named receiving bank · {objectLabel("Account", objectEntries(draft, "Account").filter(isCashFlowPaymentAccount)[0]!)}</button>}
    <label>Income receiving account<select aria-label="Income receiving account" data-repair="cashAccount" {...requiredCue(!value)} value={value} onChange={event => onChange(event.target.value)}><option value="">Choose bank account</option>{objectEntries(draft, "Account").filter(isCashFlowPaymentAccount).map(account => <option key={objectId("Account", account)} value={objectId("Account", account)}>{objectLabel("Account", account)}</option>)}</select></label>
  </section></GuidedFields>;
}
function PaycheckAuthoring({ draft, setDraft }: { draft: PersonalDraft; setDraft: (model: PersonalDraft) => void }) {
  const salaries = objectEntries(draft, "Income").filter(item => item.income_type === "salary");
  const [incomeId, setIncomeId] = useState(""), [accountId, setAccountId] = useState(""), [jurisdiction, setJurisdiction] = useState("");
  const [start, setStart] = useState(""), [end, setEnd] = useState(""), [provenance, setProvenance] = useState("");
  const [method, setMethod] = useState<"fixed" | "percent_gross">("fixed"), [amount, setAmount] = useState("");
  const [confirmed, setConfirmed] = useState(false), [error, setError] = useState("");
  const [editing, setEditing] = useState<string>();
  const salary = salaries.find(item => item.income_id === incomeId);
  const banks = objectEntries(draft, "Account").filter(account => isCashFlowPaymentAccount(account) && account.owner_id === salary?.owner_id && account.currency === "USD");
  const saved = useMemo(() => { try { return { plans: durablePayrollWithholding(draft), error: "" }; } catch (failure) { return { plans: [], error: failure instanceof Error ? failure.message : "Review payroll evidence." }; } }, [draft]);
  const field = (label: string, binding: string, format: "text" | "date" | "money" | "choice" | "percent", unit: string) => ({ ...financialField("setupIncome"), label, format, unit, example: format === "date" ? "2026-01-01" : format === "money" ? "300.00" : "Recorded paycheck evidence", semanticFamily: "income.pay_contract", semanticBinding: `payroll-withholding/v1:${binding}`, semanticScope: `Income ${incomeId || "not selected"}; ${start || "start required"} through ${end || "open end"}`, source: "User-confirmed paycheck or employer election", description: "Source-bound monthly paycheck evidence; no rate or legal withholding amount is inferred.", why: "Reconciles gross income, withheld tax credits and the actual net bank deposit." });
  return <section className="panel" aria-label="Source-bound paycheck withholding"><h2>Paycheck withholding</h2><p>Record each jurisdiction from your paycheck or employer election. The supported monthly gross-salary path deposits net pay and reconciles paid tax credits. Other pay frequencies and net-to-gross reconstruction remain unsupported.</p>
    <FieldShell fieldKey="setupIncome" presentation={field("Salary source", "income_id", "choice", "income identity")} required><select value={incomeId} onChange={event => { setIncomeId(event.target.value); setAccountId(""); setConfirmed(false); setEditing(undefined); }}><option value="">Choose salary</option>{salaries.map(income => <option key={String(income.income_id)} value={String(income.income_id)}>{String(income.source)} · {referenceLabel(draft, "Person", String(income.owner_id))}</option>)}</select></FieldShell>
    <FieldShell fieldKey="setupIncome" presentation={field("Net paycheck receiving bank", "deposit_account_id", "choice", "USD bank")} required><select value={accountId} onChange={event => { setAccountId(event.target.value); setConfirmed(false); }}><option value="">Choose the named bank</option>{banks.map(bank => <option key={String(bank.account_id)} value={String(bank.account_id)}>{String(bank.name)}</option>)}</select></FieldShell>
    <FieldShell fieldKey="setupIncome" presentation={field("Withholding jurisdiction", "jurisdiction", "choice", "recorded tax jurisdiction")} required><select value={jurisdiction} onChange={event => { setJurisdiction(event.target.value); setConfirmed(false); }}><option value="">Choose jurisdiction</option>{forecastTaxJurisdictions(draft).map(value => <option key={value} value={value}>{value}</option>)}</select></FieldShell>
    <FieldShell fieldKey="setupIncome" presentation={field("Paycheck evidence starts", "start_date", "date", "inclusive date")} required><input type="date" value={start} onChange={event => { setStart(event.target.value); setConfirmed(false); }} /></FieldShell>
    <FieldShell fieldKey="setupIncome" presentation={field("Paycheck evidence ends", "end_date", "date", "exclusive date; optional")}><input type="date" value={end} onChange={event => { setEnd(event.target.value); setConfirmed(false); }} /></FieldShell>
    <FieldShell fieldKey="setupIncome" presentation={field("Withholding method", "calculation.kind", "choice", "per-paycheck basis")} required><select value={method} onChange={event => { setMethod(event.target.value as "fixed" | "percent_gross"); setAmount(""); setConfirmed(false); }}><option value="fixed">Fixed dollars per paycheck</option><option value="percent_gross">Percentage of gross pay</option></select></FieldShell>
    <FieldShell fieldKey="setupIncome" presentation={field("Withholding per paycheck", "calculation", method === "fixed" ? "money" : "percent", method === "fixed" ? "USD" : "% of gross paycheck")} required><input value={amount} onChange={event => { setAmount(event.target.value); setConfirmed(false); }} /></FieldShell>
    <FieldShell fieldKey="setupIncome" presentation={field("Paycheck source reference", "provenance", "text", "source and effective period")} required><input value={provenance} onChange={event => { setProvenance(event.target.value); setConfirmed(false); }} /></FieldShell>
    <FieldShell fieldKey="taxConfirm" required presentation={{ ...field("Confirm paycheck evidence", "userConfirmed", "choice", "explicit acceptance"), key: "taxConfirm" }}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /></FieldShell>
    <button type="button" disabled={!confirmed || !salary || !accountId || !jurisdiction || !start || !amount || !provenance.trim()} onClick={() => {
      try { const next = authorPayrollWithholding(draft, { id: editing ?? randomId(), incomeId, ownerId: String(salary!.owner_id), employerId: String(salary!.source), depositAccountId: accountId, jurisdiction, effectiveDate: start, ...(end ? { expirationDate: end } : {}), provenance, userConfirmed: true,
        calculation: method === "fixed" ? { kind: "fixed", amount } : { kind: "percent_gross", rate: percentageToRate(amount) } }); setDraft(next); setConfirmed(false); setError(""); setEditing(undefined);
      } catch (failure) { setError(failure instanceof Error ? failure.message : "Review paycheck evidence."); }
    }}>Save accepted paycheck evidence</button>
    {(error || saved.error) && <p role="alert">{error || saved.error}</p>}
    <ul>{saved.plans.map(plan => <li key={plan.id}>{referenceLabel(draft, "Income", plan.incomeId)} · {plan.jurisdiction} · {plan.calculation.kind === "fixed" ? `${plan.calculation.amount.amount.toString()} USD` : `${rateToPercentage(plan.calculation.rate)}% of gross`} · {referenceLabel(draft, "Account", String(plan.depositAccountId))} · {plan.start.slice(0, 10)} → {plan.end?.slice(0, 10) ?? "open"}. Source: {plan.provenance} <button type="button" onClick={() => { setEditing(plan.id); setIncomeId(plan.incomeId); setAccountId(String(plan.depositAccountId)); setJurisdiction(plan.jurisdiction); setStart(plan.start.slice(0, 10)); setEnd(plan.end?.slice(0, 10) ?? ""); setMethod(plan.calculation.kind); setAmount(plan.calculation.kind === "fixed" ? plan.calculation.amount.amount.toString() : rateToPercentage(plan.calculation.rate)); setProvenance(plan.provenance); setConfirmed(false); }}>Review or edit paycheck evidence</button></li>)}</ul>
  </section>;
}
function DebtExecutionPanel({
  draft,
  asOf,
  setDraft,
  liabilityConfig,
  setLiabilityConfig,
  run,
  forecast,
  error,
}: {
  draft: PersonalDraft;
  asOf: string;
  setDraft: (draft: PersonalDraft) => void;
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
        asOf={asOf}
        setDraft={setDraft}
        liabilityConfig={liabilityConfig}
        setLiabilityConfig={setLiabilityConfig}
      />
      <FinancialSection title="Extra mortgage payments & refinancing"><DomainMechanicsPanel scope="mortgage" draft={draft} setDraft={setDraft} /></FinancialSection>
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
              disabled={!investmentId || !householdExecution?.investmentExecutionOwnerId || !!effectiveAnnualReturnProblem(rate)}
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
            {effectiveAnnualReturnProblem(rate) && <p role="alert">{effectiveAnnualReturnProblem(rate)}</p>}
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
  editable = false,
}: {
  settings: PersonalSessionSettings;
  setSettings: Dispatch<SetStateAction<PersonalSessionSettings>>;
  error: string;
  draft: PersonalDraft;
  editable?: boolean;
}) {
  const update = (field: keyof PersonalSessionSettings, value: string) =>
    setSettings((current) => ({ ...current, [field]: value }));
  const resolved = resolvePersonalSessionSettings(settings, "cash_flow");
  return (
<GuidedFields scope="forecast-dates">
    <>
      <PageHead
        eyebrow={editable ? "Plan · Current Plan" : "Settings · Model Settings"}
        title="Dates and conventions"
        text="Model dates are explicit; wall-clock today is never authoritative."
      />
      {!editable && <PlanHorizonSettings draft={draft} settings={settings} />}
      {!editable && <ForecastSetupLink target="simulationStart" />}
      <section className="panel form-grid">
        <label>
          Base currency
          <input
            aria-label="Base currency"
            value={settings.baseCurrency}
            readOnly={!editable}
            onChange={(event) => update("baseCurrency", event.target.value)}
          />
        </label>
        <label>
          As of
          <input
            type="date"
            value={settings.asOf}
            readOnly={!editable}
            onChange={(event) => update("asOf", event.target.value)}
          />
        </label>
        <label>
          Data cutoff
          <input
            type="date"
            value={settings.dataCutoff}
            readOnly={!editable}
            onChange={(event) => update("dataCutoff", event.target.value)}
          />
        </label>
        {!editable && <>        <label>
          Simulation start
          <input
            type="date"
            value={settings.simulationStart}
            readOnly
            onChange={(event) => update("simulationStart", event.target.value)}
          />
        </label>
        <label>
          Simulation end
          <input
            type="date"
            value={settings.simulationEnd}
            readOnly
            onChange={(event) => update("simulationEnd", event.target.value)}
          />
        </label>
</>}
        <label>
          Same-time cash-flow order
          <select
            disabled={!editable}
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
    {setDraft && setSettings && <ForecastSetupSuggestions key={String(plan?.scenario_id)} model={draft} settings={settings} apply={(next, end) => { setDraft(next); setSettings(previous => ({ ...previous, simulationEnd: end })); }} />}
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

/** Keep large provenance payloads available without serializing closed disclosures. */
function DeferredDisclosure({ summary, children }: { summary: ReactNode; children: () => ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  return <details onToggle={event => { if (event.target === event.currentTarget) setExpanded(event.currentTarget.open); }}>
    <summary>{summary}</summary>{expanded && children()}
  </details>;
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
  const performanceScope = useContext(BrowserPerformanceScope);
  const groups = useMemo(() => {
    const started = browserNow();
    try { return groupDiagnostics(diagnostics).sort((left, right) => Number("severity" in right.diagnostic && right.diagnostic.severity === "error") - Number("severity" in left.diagnostic && left.diagnostic.severity === "error")); }
    finally {
      const ended = browserNow();
      if (performanceScope?.active && started !== undefined && ended !== undefined) recordBrowserDuration("ui.diagnostic_grouping", ended - started, performanceScope.context);
    }
  }, [diagnostics, performanceScope?.context.runId]);
  const summaries = useMemo(() => [...new Map(groups.map(group => [forecastDiagnosticMessage(group.diagnostic, model ?? currentModel), group])).entries()], [groups, model, currentModel]);
  return (
    <div className="capability">
      <strong>{diagnostics.length > 0 && diagnostics.every(item => item.entityType === "tax_capability") ? "Partially modeled · tax limitations" : "Forecast needs attention"}</strong>
      {diagnostics.length === 0 ? (
        <p>The forecast is unavailable. Review the original explanation in Technical diagnostic details; no more specific editor remedy is available.</p>
      ) : (
        summaries.slice(0, 1).map(([_message, group]) => (
          <div key={group.key} data-diagnostic-root={group.key}>
            <p>{diagnosticSummary(group.diagnostic, model ?? currentModel).problem}</p>
            <p>{diagnosticSummary(group.diagnostic, model ?? currentModel).remedy}</p>
            {(model ?? currentModel) && group.diagnostic.category?.startsWith("filing_status") && group.diagnostic.entityId && group.diagnostic.taxYear && <AnnualFilingRepair draft={(model ?? currentModel)!} personId={group.diagnostic.entityId} year={group.diagnostic.taxYear} />}
            {(group.diagnostic.category === "payment_funding" || group.diagnostic.category === "settlement_timing") && <ForecastSetupLink target="taxSetup" />}
            {(model ?? currentModel) && <DiagnosticReferences targets={diagnosticTargets((model ?? currentModel)!, group.diagnostic)} />}
          </div>
        ))
      )}
      {summaries.length > 1 && <details><summary>Review {summaries.length - 1} more scoped limitations</summary>{summaries.slice(1).map(([_message, group]) => <section key={group.key} data-diagnostic-root={group.key}>
        <p>{diagnosticSummary(group.diagnostic, model ?? currentModel).problem}</p><p>{diagnosticSummary(group.diagnostic, model ?? currentModel).remedy}</p>
        {(model ?? currentModel) && group.diagnostic.category?.startsWith("filing_status") && group.diagnostic.entityId && group.diagnostic.taxYear && <AnnualFilingRepair draft={(model ?? currentModel)!} personId={group.diagnostic.entityId} year={group.diagnostic.taxYear} />}
        {(group.diagnostic.category === "payment_funding" || group.diagnostic.category === "settlement_timing") && <ForecastSetupLink target="taxSetup" />}
        {(model ?? currentModel) && <DiagnosticReferences targets={diagnosticTargets((model ?? currentModel)!, group.diagnostic)} />}
      </section>)}</details>}
      <DeferredDisclosure summary="Technical diagnostic details">{() => <>
        {groups.map(group => <DeferredDisclosure key={group.key} summary={<>{group.diagnostic.code} · {group.diagnostic.category ?? group.diagnostic.entityType ?? "execution"} · {group.diagnostic.jurisdiction ?? "household"} · {group.occurrences} occurrences · {group.affectedOutputs.length} affected outputs</>}>{() => <>
          <p>{forecastDiagnosticMessage(group.diagnostic, model ?? currentModel)}</p>
          {(model ?? currentModel) && <DiagnosticReferences targets={diagnosticTargets((model ?? currentModel)!, group.diagnostic)} />}
          <pre>{JSON.stringify({ diagnostic: group.diagnostic, originalMessages: group.messages, affectedOutputs: group.affectedOutputs,
            recordIds: [...new Set(diagnostics.filter(item => groupDiagnostics([item])[0]?.key === group.key).map(item => item.entityId).filter(Boolean))] }, null, 2)}</pre>
        </>}</DeferredDisclosure>)}
        {!groups.length && <pre>{fallback ?? "No richer diagnostic is available."}</pre>}
      </>}</DeferredDisclosure>
    </div>
  );
}

function ForecastSetupLink({ target }: { target?: string }) {
  const { reviewTarget } = useContext(FinancialResultModels);
  return <button type="button" onClick={() => reviewTarget?.({ id: "", type: "Forecast setup", label: "Forecast setup", ...(target ? { field: target } : {}), editable: false })}>Review forecast setup</button>;
}
function DiagnosticReferences({ targets }: { targets: readonly DiagnosticTarget[] }) {
  const { reviewTarget, importCorrection } = useContext(FinancialResultModels);
  if (!targets.length) return null;
  return <ul className="diagnostic-references">{targets.map(target => <li key={`${target.type}:${target.id}`}><strong>{target.type} · {target.label}</strong>{target.context && <span> · {target.context}</span>}
    {target.objectType && reviewTarget && <button type="button" onClick={() => reviewTarget(target)}>{target.editable ? `Review ${financialFieldOrUndefined(target.field!, target.objectType)?.label ?? "field"}` : "Open record"}</button>}
    {target.type === "Event" && reviewTarget && <button type="button" onClick={() => reviewTarget(target)}>Review saved plan activity</button>}
    {!target.editable && <small> {target.type === "Event" ? "Recorded activity is read-only here; review Current Plan or import corrected activity." : target.objectType ? "Recorded or managed facts may require corrected-model import." : "This reference cannot be edited here. Import corrected records or recreate the missing relationship through a supported authoring path."}</small>}
    {!target.editable && importCorrection && <button type="button" onClick={importCorrection}>Import corrected records</button>}
  </li>)}</ul>;
}

function AuthoringError({ reason, route }: { reason: string; route: "personal" | "payroll" }) {
  const root = useRef<HTMLDivElement>(null);
  const [repairTarget, setRepairTarget] = useState<string>();
  const target = /UNVESTED/.test(reason) ? "unvested" : /VESTING/.test(reason) ? "vested" : /RATE/.test(reason) ? "payrollRate" : /AMOUNT/.test(reason) ? route === "personal" ? "purchaseAmount" : "payrollAmount" : /CURRENCY|CHECKING|SAVINGS/.test(reason) ? "purchaseFunding" : /OWNER|DESTINATION/.test(reason) ? route === "personal" ? "purchaseInvestment" : "payrollSalary" : /DATE|SCHEDULE/.test(reason) ? "purchaseDate" : /ORDER|PRIORITY/.test(reason) ? route === "personal" ? "purchaseOrder" : "payrollPriority" : /FACT|COMPENSATION|ELIGIB/.test(reason) ? route === "personal" ? "taxableCompensation" : "taxYear" : undefined;
  useEffect(() => {
    const region = root.current?.closest("section");
    const candidate = target && region?.querySelector(`[data-financial-field="${target}"] :is(input, select)`) ? target : route === "personal" ? "purchaseInvestment" : "payrollDestination";
    setRepairTarget(region?.querySelector(`[data-financial-field="${candidate}"] :is(input, select)`) ? candidate : undefined);
  }, [target, route, reason]);
  return <div ref={root}><p role="alert">{authoringFailure(new Error(reason))}</p>{repairTarget && <button type="button" onClick={() => focusRepair(root.current?.closest("section")?.querySelector<HTMLElement>(`[data-financial-field="${repairTarget}"] :is(input, select)`))}>Review {financialField(repairTarget).label.toLowerCase()}</button>}<details><summary>Technical details</summary><pre>{reason}</pre></details></div>;
}
function PersonalPurchaseAuthoring({ draft, setDraft, initialInvestmentId }: { draft: PersonalDraft; setDraft: (draft: PersonalDraft) => void; initialInvestmentId?: string }) {
  const annualFacts = useAuthoredAnnualFacts(draft);
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
  return <GuidedFields scope="personal-contributions" errors={purchaseProblems} required={["purchaseInvestment", "purchaseFunding", "purchaseAmount", "purchaseDate", "purchaseFrequency", "purchaseOrder", ...(ira ? ["excess"] : [])]}><section className="panel" id="personal-contributions" aria-label="Saved investment purchases">
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
    {ira && <><AnnualFactsReview draft={draft} character={String(destination?.account_type)} scope={{ personId: String(destination?.owner_id ?? ""), householdId: String(objectEntries(draft, "Person").find(person => person.person_id === destination?.owner_id)?.household_id ?? ""), taxYear: Number(date.slice(0, 4)) }} />
      <label>Excess contribution policy<select aria-label="Excess contribution policy" value={excessPolicy} onChange={event => setExcessPolicy(event.target.value === "auto_cap" ? "auto_cap" : "reject")}><option value="reject">Reject excess</option><option value="auto_cap">Explicitly cap to available capacity</option></select></label></>}
    <button type="button" disabled={!investmentId || !bankId || purchaseInvalid} onClick={() => {
      const selected = investments.find(investment => objectId("Investment", investment) === investmentId);
      try {
        setDraft(authorPersonalPurchasePlan(draft, { primitiveId: typeof selected?.contribution_model_id === "string" ? selected.contribution_model_id : randomId(), investmentId, sourceCashAccountId: bankId, amount, date, frequency, order: Number(order), ...(ira ? { excessPolicy, contributionFacts: annualFacts(String(destination?.account_type), { personId: String(destination?.owner_id ?? ""), householdId: String(objectEntries(draft, "Person").find(person => person.person_id === destination?.owner_id)?.household_id ?? ""), taxYear: Number(date.slice(0, 4)) }) } : {}) }));
        setError("");
      } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    }}>Save investment purchase</button>
    {error && <AuthoringError reason={error} route="personal" />}
    {savedPurchases.error && <AuthoringError reason={savedPurchases.error} route="personal" />}
    {savedPurchases.plans.map(plan => <p key={plan.id}>Saved purchase: {objectLabel("Investment", investments.find(investment => objectId("Investment", investment) === plan.investmentId) ?? {})} — {plan.amount} {String(banks.find(bank => objectId("Account", bank) === plan.sourceCashAccountId)?.currency ?? "")} {plan.schedule.kind === "utc_monthly" ? "monthly" : "one time"} from {objectLabel("Account", banks.find(bank => objectId("Account", bank) === plan.sourceCashAccountId) ?? {})}.</p>)}
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
  const annualFacts = useAuthoredAnnualFacts(draft);
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
  return <GuidedFields scope="payroll-contributions" errors={payrollProblems} required={["payrollDestination", "payrollSalary", "character", "method", "taxYear", "payrollPriority", "excess", ...(character.endsWith("_hsa") ? [] : ["planKey", "unvested"]), ...(kind === "fixed" ? ["payrollAmount"] : [])]}><section className="panel" id="payroll-contributions" aria-label="Saved payroll contributions"><h2>Payroll and employer contributions</h2>
    <p>Employee contributions reduce take-home cash. Employer contributions add plan value.</p>
    <label>Payroll destination<select aria-label="Payroll destination" value={investmentId} onChange={event => setInvestmentId(event.target.value)}><option value="">Choose holding</option>{destinations.map(item => <option key={String(item.investment_id)} value={String(item.investment_id)}>{objectLabel("Investment", item)}</option>)}</select></label>
    <FieldHelp label="Payroll destination">Choose the investment holding in the workplace account receiving contributions. This tells the forecast where to buy units. For example choose RETIREMENT-DEMO in Workplace retirement for the employee 401(k) contribution; employer matching may use a separate holding in the same plan.</FieldHelp>
    <label>Payroll salary<select aria-label="Payroll salary" value={incomeId} onChange={event => setIncomeId(event.target.value)}><option value="">Choose gross salary</option>{compatibleIncomes.map(item => <option key={String(item.income_id)} value={String(item.income_id)}>{objectLabel("Income", item)}</option>)}</select></label>
    <FieldHelp label="Payroll salary">Choose the gross salary that funds this workplace contribution. The forecast needs the paycheck amount before deductions. For example choose Example salary for that employer’s 401(k); checking and savings cannot fund payroll-only contributions.</FieldHelp>
    <label>Payroll contribution character<select aria-label="Payroll contribution character" value={character} onChange={event => { const value = event.target.value; if (value === "traditional_401k" || value === "roth_401k" || value === "after_tax_401k" || value === "employee_hsa" || value === "employer_401k" || value === "employer_hsa") setCharacter(value); }}>{characters.map(value => <option key={value} value={value}>{({ traditional_401k: "Traditional 401(k)", roth_401k: "Roth 401(k)", after_tax_401k: "After-tax 401(k)", employee_hsa: "Employee HSA", employer_401k: "Employer 401(k)", employer_hsa: "Employer HSA" })[value]}</option>)}</select></label>
    <label>Payroll contribution method<select aria-label="Payroll contribution method" value={kind} onChange={event => setKind(event.target.value === "fixed" ? "fixed" : event.target.value === "match" ? "match" : "percent")}><option value="fixed">Fixed amount per payroll</option><option value="percent">Percentage of gross pay</option>{employer && <option value="match">Employer match of employee contribution</option>}</select></label>
    <FieldHelp label="Payroll contribution method">Choose a dollar amount per paycheck, a percentage of gross pay, or an employer match. The forecast needs this to calculate each contribution. For example, 5% of a $9,000 paycheck contributes $450; a 100% match matches the eligible employee contribution dollar for dollar.</FieldHelp>
    {kind === "fixed" ? <label>Payroll contribution amount<input aria-label="Payroll contribution amount" value={amount} onChange={event => setAmount(event.target.value)} /><small>Dollars per paycheck, for example 450.00.</small></label> : <PercentageInput label="Payroll contribution rate" required value={rate} onChange={setRate} error={payrollProblems.payrollRate} />}
    {kind === "match" && <PercentageInput label="Match compensation cap rate" required value={capRate} onChange={setCapRate} error={payrollProblems.matchCap} />}
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
    <FinancialSection title="Annual eligibility facts" open={!!investmentId}>{input("taxYear", "Payroll contribution year")}
      <AnnualFactsReview draft={draft} character={character} scope={{ personId: String(destinationAccount?.owner_id ?? ""), householdId: String(objectEntries(draft, "Person").find(person => person.person_id === destinationAccount?.owner_id)?.household_id ?? ""), taxYear: Number(fields.taxYear), ...(planKey ? { sponsorId: planKey } : {}) }} />
    </FinancialSection>
    <label>When a contribution exceeds the limit<select aria-label="When a contribution exceeds the limit" value={excessPolicy} onChange={event => setExcessPolicy(event.target.value === "auto_cap" ? "auto_cap" : "reject")}><option value="reject">Stop and report the excess</option><option value="auto_cap">Reduce to the remaining allowance</option></select></label>
    <FieldHelp label="When a contribution exceeds the limit">Payroll excess policy chooses whether to reject an over-limit contribution or reduce it to the known remaining allowance. For example, if $100 remains and $150 is requested, reducing contributes $100. Missing eligibility facts still stay incomplete.</FieldHelp>
    <button type="button" disabled={!investmentId || !incomeId || payrollInvalid || !characters.includes(character) || (!character.endsWith("_hsa") && !planKey)} onClick={() => {
      try { const investment = destinations.find(item => item.investment_id === investmentId)!;
        const existing = saved.plans.find(item => item.allocation.positionId === investmentId);
        setDraft(authorPayrollContributionPlan(draft, { primitiveId: typeof investment.contribution_model_id === "string" ? investment.contribution_model_id : randomId(), investmentId, incomeId, priority: Number(priority), character, calculation: kind === "fixed" ? { kind, amount } : kind === "percent" ? { kind, rate } : { kind, rate, compensationCapRate: capRate }, planKey, vestedFraction: character === "employer_401k" ? vested : "1", excessPolicy, ...(!character.endsWith("_hsa") ? { openingUnvestedQuantity: openingUnvested } : {}),
          contingentEvents: character !== "employer_401k" ? [] : [...(vestDate ? [{ eventId: existing?.events.find(event => event.kind === "vest")?.eventId ?? randomId(), kind: "vest" as const, date: vestDate }] : []), ...(forfeitDate ? [{ eventId: existing?.events.find(event => event.kind === "forfeit")?.eventId ?? randomId(), kind: "forfeit" as const, date: forfeitDate }] : [])],
          facts: annualFacts(character, { personId: String(destinationAccount?.owner_id ?? ""), householdId: String(objectEntries(draft, "Person").find(person => person.person_id === destinationAccount?.owner_id)?.household_id ?? ""), taxYear: Number(fields.taxYear), ...(planKey ? { sponsorId: planKey } : {}) }) })); setError("");
      } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    }}>Save payroll contribution</button>
    {(error || saved.error) && <AuthoringError reason={error || saved.error} route="payroll" />}
    {saved.plans.map(item => <p key={item.allocation.id}>Saved payroll: {item.allocation.policy.character.replaceAll("_", " ")} to {objectLabel("Investment", destinations.find(destination => destination.investment_id === item.allocation.positionId) ?? {})}.</p>)}
  </section></GuidedFields>;
}

function HistoricalContributionScopeAuthoring({ draft, setDraft }: { draft: PersonalDraft; setDraft: (draft: PersonalDraft) => void }) {
  const annualFacts = useAuthoredAnnualFacts(draft);
  const accounts = objectEntries(draft, "Account").filter(item => ["traditional_401k", "roth_401k", "traditional_ira", "roth_ira", "hsa", "hsa_investment"].includes(String(item.account_type)));
  const holdings = objectEntries(draft, "Investment").filter(item => accounts.some(account => account.account_id === item.account_id));
  const [investmentId, setInvestmentId] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({ taxYear: "2026" });
  const [planKey, setPlanKey] = useState(""), [error, setError] = useState(""), [success, setSuccess] = useState("");
  const saved = useMemo(() => { try { return getHistoricalContributionScopes(draft); } catch { return []; } }, [draft]);
  const holding = holdings.find(item => item.investment_id === investmentId);
  const account = accounts.find(item => item.account_id === holding?.account_id);
  const hsa = String(account?.account_type).startsWith("hsa"), ira = String(account?.account_type).endsWith("_ira");
  useEffect(() => {
    const scope = saved.find(item => item.investmentId === investmentId);
    setFields(scope ? Object.fromEntries(Object.entries(scope.policy.facts).map(([key, value]) => [key, typeof value === "object" ? value.amount.toString() : String(value)])) : { taxYear: "2026" });
    setPlanKey(scope?.policy.limits.find(item => item.kind === "401k_additions")?.bucketKey.slice("401k_additions:".length) ?? "");
    setError(""); setSuccess("");
  }, [investmentId]);
  const input = (key: string, label: string) => <div><label>{label}<input value={fields[key] ?? ""} onChange={event => setFields({ ...fields, [key]: event.target.value })} /></label><FieldHelp label={label}>{contributionFieldHelp(key)}</FieldHelp></div>;
  const booleanInput = (key: string, label: string) => <div><label>{label}<select value={fields[key] ?? ""} onChange={event => setFields({ ...fields, [key]: event.target.value })}><option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option></select></label><FieldHelp label={label}>{contributionFieldHelp(key)}</FieldHelp></div>;
  return <GuidedFields scope="contribution-history" required={["historicalHolding", "taxYear", ...(!hsa && !ira && investmentId ? ["planKey"] : [])]}><fieldset id="historical-eligibility"><legend>Historical account or employer plan</legend>
    <p>Record contributions already made this year, including contributions to a former employer’s plan. Add that account and holding first if it is missing.</p>
    <FieldHelp label="Prior contribution history">The forecast needs earlier contributions to know how much annual allowance remains. Enter each account’s contribution year and eligibility facts, then its year-to-date dollar amounts below. Use a separate employer/plan group for a former employer, for example Former Employer, so its employer limit remains separate from the active employer. This records prior usage without adding forecast cash or changing opening balances.</FieldHelp>
    <label>Historical holding<select aria-label="Historical holding" value={investmentId} onChange={event => setInvestmentId(event.target.value)}><option value="">Choose holding</option>{holdings.map(item => <option key={String(item.investment_id)} value={String(item.investment_id)}>{objectLabel("Investment", item)}</option>)}</select></label>
    {input("taxYear", "Historical contribution year")}
    {investmentId && !hsa && !ira && <label>Historical employer / plan group<input value={planKey} onChange={event => setPlanKey(event.target.value)} /></label>}
    {investmentId && <AnnualFactsReview draft={draft} character={hsa ? "employee_hsa" : ira ? String(account?.account_type) : "traditional_401k"} scope={{ personId: String(account?.owner_id ?? ""), householdId: String(objectEntries(draft, "Person").find(person => person.person_id === account?.owner_id)?.household_id ?? ""), taxYear: Number(fields.taxYear), ...(planKey ? { sponsorId: planKey } : {}) }} />}
    <button type="button" disabled={!investmentId} onClick={event => {
      try {
        const facts = annualFacts(hsa ? "employee_hsa" : ira ? String(account?.account_type) : "traditional_401k", { personId: String(account?.owner_id ?? ""), householdId: String(objectEntries(draft, "Person").find(person => person.person_id === account?.owner_id)?.household_id ?? ""), taxYear: Number(fields.taxYear), ...(planKey ? { sponsorId: planKey } : {}) });
        const next = authorHistoricalContributionScope(draft, { id: saved.find(item => item.investmentId === investmentId && item.policy.facts.taxYear === facts.taxYear)?.id ?? randomId(), investmentId, facts, ...(!hsa && !ira ? { planKey } : {}) });
        commitAtControl(event.currentTarget, () => { setDraft(next); setError(""); setSuccess(`Historical eligibility saved for ${objectLabel("Investment", holding ?? {})} · ${facts.taxYear}. Review and confirm prior totals below.`); });
      } catch (failure) { setError(failure instanceof Error ? failure.message : "Historical scope could not be saved"); }
    }}>Save historical scope</button>{success && <p role="status">{success}</p>}{error && <><p role="alert">{authoringFailure(new Error(error))}</p><details><summary>Technical details</summary><pre>{error}</pre></details></>}
  </fieldset></GuidedFields>;
}

function OpeningContributionUsageAuthoring({ draft, setDraft }: { draft: PersonalDraft; setDraft: (draft: PersonalDraft) => void }) {
  const saved = useMemo(() => { try { return getOpeningContributionUsage(draft); } catch { return undefined; } }, [draft]);
  const available = useMemo(() => { try { return { options: getOpeningContributionOptions(draft), error: "" }; } catch (failure) { return { options: [], error: failure instanceof Error ? failure.message : "Historical scopes unavailable" }; } }, [draft]);
  const options = available.options;
  const [date, setDate] = useState(saved?.asOf ?? "");
  const [fields, setFields] = useState<Record<string, { amount: string; ordinary: string }>>(() => Object.fromEntries((saved?.entries ?? []).map(entry => [`${saved!.asOf.slice(0, 4)}:${entry.investmentId}:${entry.character}`, { amount: entry.amount, ordinary: entry.ordinaryAmount ?? entry.amount }])));
  const [confirmed, setConfirmed] = useState(false), [error, setError] = useState(""), [success, setSuccess] = useState(""), [scopeNotice, setScopeNotice] = useState("");
  const scopeIdentity = options.map(option => `${option.investmentId}:${option.character}:${Object.entries(option.policy.facts).map(([key, value]) => `${key}=${typeof value === "object" ? value.amount.toString() : String(value)}`).sort().join(";")}:${option.policy.limits.map(limit => limit.bucketKey).sort().join(";")}`).sort().join("|");
  const previousScope = useRef(scopeIdentity);
  useEffect(() => {
    if (previousScope.current !== scopeIdentity) { setConfirmed(false); setScopeNotice("Eligibility scopes changed. Your totals are preserved; review the named scopes and confirm all prior usage again."); previousScope.current = scopeIdentity; }
  }, [scopeIdentity]);
  const readiness = getOpeningContributionReadiness(draft, date);
  const prerequisite = available.error || readiness.reason;
  const matching = options.filter(option => option.policy.facts.taxYear === Number(date.slice(0, 4)));
  const amountsInvalid = matching.some(option => {
    const value = fields[`${option.policy.facts.taxYear}:${option.investmentId}:${option.character}`] ?? { amount: "0", ordinary: "0" };
    return !!fieldProblem(financialField("ytdTotal"), value.amount, true) || compareDecimal(value.amount, "0") === -1 || !!fieldProblem(financialField("ytdOrdinary"), value.ordinary, true) || compareDecimal(value.ordinary, "0") === -1 || compareDecimal(value.ordinary, value.amount) === 1;
  });
  const nextStep = prerequisite ? authoringFailure(new Error(prerequisite)) : amountsInvalid ? "Review the prior totals. Amounts must be nonnegative; the portion excluding catch-up cannot exceed the total." : !confirmed ? "Confirm all prior usage, including known zero amounts, before saving." : "Ready to save prior usage for this boundary.";
  return <GuidedFields scope="contribution-history" required={["ytdDate", "ytdTotal", "ytdOrdinary", "ytdConfirmed"]}><section className="panel" aria-label="Prior year-to-date contributions"><h2>Prior year-to-date contributions</h2>
    <HistoricalContributionScopeAuthoring draft={draft} setDraft={setDraft} />
    {scopeNotice && <p role="status">{scopeNotice}</p>}
    <p>Enter contributions already made before the forecast start, across every account sharing these limits, including employer amounts. These facts consume annual capacity without adding cash flow or changing opening balances. Include any other prior contributions in the same scope; omitted categories are confirmed as zero.</p>
    <label>YTD forecast boundary<input type="date" value={date} onChange={event => { setDate(event.target.value); setConfirmed(false); setError(""); setSuccess(""); }} /></label>
    {matching.map(option => { const key = `${option.policy.facts.taxYear}:${option.investmentId}:${option.character}`, value = fields[key] ?? { amount: "0", ordinary: "0" };
      const split = option.character === "traditional_401k" || option.character === "roth_401k" || option.character.endsWith("_hsa") && option.policy.facts.hsaCoverage === "family";
      const label = `${objectLabel("Investment", objectEntries(draft, "Investment").find(item => item.investment_id === option.investmentId) ?? {})} — ${option.character.replaceAll("_", " ")} · ${option.policy.facts.taxYear}`;
      return <fieldset key={key}><legend>{label}</legend><label>Prior YTD total<input aria-label={`${label} prior YTD total`} value={value.amount} onChange={event => { setFields({ ...fields, [key]: { ...value, amount: event.target.value } }); setConfirmed(false); }} /></label>
        {split && <label>Prior YTD amount excluding catch-up<input aria-label={`${label} prior YTD amount excluding catch-up`} value={value.ordinary} onChange={event => { setFields({ ...fields, [key]: { ...value, ordinary: event.target.value } }); setConfirmed(false); }} /></label>}</fieldset>;
    })}
    <label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I confirm all prior YTD usage in these shared scopes is known, including zero for omitted categories.</label>
    <p id="prior-usage-next-step" role={prerequisite ? "alert" : "note"}>{nextStep}{readiness.missingAccountIds.length > 0 && ` Accounts: ${readiness.missingAccountIds.map(id => referenceLabel(draft, "Account", id)).join(", ")}.`}</p>
    {prerequisite && <button type="button" onClick={() => focusRepair(document.querySelector<HTMLElement>('#historical-eligibility [data-financial-field="historicalHolding"] select'))}>Review historical eligibility</button>}
    {prerequisite && <details><summary>Technical details</summary><pre>{prerequisite}</pre></details>}
    <button type="button" aria-describedby="prior-usage-next-step" disabled={!confirmed || !date || !!prerequisite || amountsInvalid} onClick={event => {
      try { const next = authorOpeningContributionUsage(draft, { asOf: date, allPriorUsageKnown: true, entries: options.filter(option => option.policy.facts.taxYear === Number(date.slice(0, 4))).map(option => {
        const key = `${option.policy.facts.taxYear}:${option.investmentId}:${option.character}`, value = fields[key] ?? { amount: "0", ordinary: "0" };
        const prior = saved?.entries.find(item => item.investmentId === option.investmentId && item.character === option.character);
        return { id: prior?.id ?? randomId(), investmentId: option.investmentId, character: option.character, amount: value.amount, ordinaryAmount: value.ordinary };
      }) }); commitAtControl(event.currentTarget, () => { setDraft(next); setError(""); setSuccess(`Prior usage saved for ${date.slice(0, 4)} before ${date} across ${matching.length} contribution categories. Save the model to keep it in this browser.`); }); } catch (failure) { setSuccess(""); setError(failure instanceof Error ? failure.message : "Prior usage could not be saved"); }
    }}>Save prior YTD usage</button>{success && <p role="status">{success}</p>}{error && <><p role="alert">{authoringFailure(new Error(error))}</p><details><summary>Technical details</summary><pre>{error}</pre></details></>}
    {saved && <details><summary>Saved prior usage · {saved.asOf.slice(0, 4)}</summary><p>Before {saved.asOf}; all prior usage confirmed, including zero for omitted categories.</p><ul>{saved.entries.map(entry => <li key={entry.id}>{referenceLabel(draft, "Investment", entry.investmentId)} · {entry.character.replaceAll("_", " ")} · {entry.amount} USD{entry.ordinaryAmount !== undefined && ` (${entry.ordinaryAmount} excluding catch-up)`}</li>)}</ul></details>}
  </section></GuidedFields>;
}

function ContributionCapacityPanel({ draft, forecast }: { draft: PersonalDraft; forecast: PersonalHouseholdForecastReadModel | undefined }) {
  const { baseline } = useContext(FinancialResultModels);
  const currentForecast = baseline && baseline.resultModel === draft && !baseline.pending && !baseline.stale ? forecast : undefined;
  let rows: ReturnType<typeof getContributionCapacities>;
  try { rows = currentForecast && currentForecast.status !== "unavailable" ? currentForecast.contributionCapacities : getContributionCapacities(draft); } catch (failure) { return <AuthoringError reason={failure instanceof Error ? failure.message : "Contribution capacity is unavailable"} route="payroll" />; }
  return <section className="panel" aria-label="Contribution capacity"><h2>Annual contribution capacity</h2><p>Modeled YTD combines authoritative opening usage and committed forecast contributions across every account sharing a bucket.</p>
    <div className="table-scroll"><table><thead><tr><th>Account / year</th><th>Shared categories</th><th>Annual USD limit</th><th>Opening YTD</th><th>Forecast usage</th><th>Modeled YTD</th><th>Remaining</th></tr></thead><tbody>{rows.map(row => <tr key={`${row.accountId}:${row.bucketIdentity}`}><td>{objectLabel("Account", objectEntries(draft, "Account").find(item => item.account_id === row.accountId) ?? {})} / {row.year}{row.provenance === "projected_current_law" && <p>Projected current law · {row.lawVersion}</p>}</td><td>{row.categories.map(value => value.replaceAll("_", " ")).join(", ")}</td><td>{row.annualLimit ?? "Incomplete"}{row.diagnostics.length > 0 && <p role="status">{"Annual capacity needs more recorded facts."}</p>}</td><td>{row.openingUsage ?? "Unknown"}</td><td>{row.forecastUsage ?? "Run plan"}</td><td>{row.yearToDate ?? "Incomplete"}</td><td>{row.remaining ?? "Incomplete"}</td></tr>)}</tbody></table></div>
    {!currentForecast && forecast && <p>Forecast usage will appear when a forecast reflects the current plan. The limits and opening usage shown here use your current saved facts.</p>}
    {currentForecast && currentForecast.status !== "unavailable" && currentForecast.contingentPositions.map(item => <p key={item.positionId}>Unvested contingent plan value: {item.value.amount} {item.value.currency}; excluded from owned net worth.</p>)}
  </section>;
}

function RetirementStartingPoint({ draft, proposal, apply }: { draft: PersonalDraft; proposal: ReturnType<typeof retirementProposals>[number]; apply: (model: PersonalDraft) => void }) {
  const [date, setDate] = useState(proposal.date), [dismissed, setDismissed] = useState(false), [error, setError] = useState("");
  if (dismissed) return <p>{proposal.name}'s age-65 retirement suggestion dismissed for this session. <button type="button" onClick={() => setDismissed(false)}>Review suggestion</button></p>;
  return <section className="starting-points" aria-label={`${proposal.name} retirement proposal`}><h3>{proposal.name} · age 65 on {proposal.date}</h3>
    <p>Suggested starting point — edit or dismiss. Accepting stops only this person's supported salary streams at the selected date. It does not claim benefits or authorize withdrawals.</p>
    <FinancialInput fieldKey="retirementDate" value={date} onChange={setDate} required />
    <button type="button" onClick={() => { try { apply(acceptRetirementProposal(draft, proposal.personId, date, proposal.incomeIds.map(() => randomId()))); setError(""); } catch (failure) { setError(failure instanceof Error ? failure.message : "Review Current Plan dates first."); } }}>Accept {proposal.name}'s retirement proposal</button>
    <button type="button" onClick={() => setDismissed(true)}>Dismiss {proposal.name}'s retirement proposal</button>{error && <p role="alert">{error}</p>}
  </section>;
}

function RetirementDateAuthoring({ draft, setDraft, asOf }: { draft: PersonalDraft; setDraft: (draft: PersonalDraft) => void; asOf: string }) {
  const plans = getPersonalRetirementPlans(draft);
  const [incomeId, setIncomeId] = useState("");
  const selected = plans.find(plan => plan.incomeId === incomeId) ?? (plans.length === 1 ? plans[0] : undefined);
  const [date, setDate] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { setDate(selected?.date ?? ""); setError(""); }, [selected?.incomeId, selected?.date]);
  return <GuidedFields scope="retirement"><section className="panel" aria-label="Saved retirement plan">
    <h2>Planned retirement date</h2>
    {retirementProposals(draft, asOf).map(proposal => <RetirementStartingPoint key={proposal.personId} draft={draft} proposal={proposal} apply={setDraft} />)}
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
  readiness,
  settings,
  setSettings,
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
  lawAccepted,
  setLawAccepted,
  setHouseholdExecution,
}: {
  draft: PersonalDraft;
  readiness: ReturnType<typeof resolveForecastReadiness>;
  settings: PersonalSessionSettings;
  setSettings: Dispatch<SetStateAction<PersonalSessionSettings>>;
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
  lawAccepted: boolean;
  setLawAccepted: (value: boolean) => void;
  setHouseholdExecution: (bindings?: readonly RetirementTerminationBinding[]) => void;
}) {
  const { reviewContributions } = useContext(FinancialResultModels);
  const accounts = objectEntries(draft, "Account");
  const incomes = objectEntries(draft, "Income");
  const events = ((draft.objects as Record<string, readonly JsonObject[]>).Event ?? []).filter((event) => event.event_type === "retirement" && event.enabled === true && event.trigger_type === "scheduled");
  const [retirementIncomeId, setRetirementIncomeId] = useState(retirementBindings[0]?.incomeId ?? "");
  const [retirementEventId, setRetirementEventId] = useState(retirementBindings[0]?.canonicalEventId ?? "");
  const [retirementDate, setRetirementDate] = useState(retirementBindings[0]?.baselineDate ?? "");
  const [terminationEventId] = useState(() => retirementBindings[0]?.terminationEventId ?? randomId());
  // The example/import path can install authoritative accepted bindings after
  // Current Plan first mounts; never leave its local selects silently blank.
  useEffect(() => {
    setRetirementIncomeId(retirementBindings[0]?.incomeId ?? "");
    setRetirementEventId(retirementBindings[0]?.canonicalEventId ?? "");
    setRetirementDate(retirementBindings[0]?.baselineDate ?? "");
  }, [retirementBindings]);
  return (
    <>
      <PageHead
        eyebrow="Plan · Current Plan"
        title="Your reconciled household plan"
        text="Review your planning period, scheduled contributions, and forecast."
      />
      <PlanHorizonSettings draft={draft} settings={settings} setSettings={setSettings} setDraft={setDraft} retirementDates={retirementBindings.map(binding => binding.baselineDate)} />
      <FinancialSection title="Forecast clock & conventions"><ModelSettings editable draft={draft} settings={settings} setSettings={setSettings} error={error} /></FinancialSection>
      <section className="panel" id="forecast-setup" tabIndex={-1}>
      <h2>Forecast setup</h2>
      <details><summary>Known facts, derived values and decisions</summary><ul>{readiness.map(field => <li key={field.key}><strong>{field.key}</strong> · {field.classification.replaceAll("_", " ")} · {field.value ?? "Not recorded"}. {field.reason}<details><summary>Source and scope</summary><p>{field.sources.join(", ")} · scope {field.scope} · {field.asOf}</p></details></li>)}</ul></details>
      <section className="controls" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)" }} aria-label="Household execution configuration">
        <h3>Cash &amp; funding</h3>
        <p>Choose income and payment accounts. Loading or importing retains durable payroll and contribution facts; session-only funding, execution and tax choices require renewed acceptance.</p>
        <p>Income receiving account: {cashFlowExecutionAccountId ? referenceLabel(draft, "Account", cashFlowExecutionAccountId) : "Not selected"}.</p>
        <ForecastSetupLink target="cashAccount" />
        <FinancialSection title="Investments" attention={!objectEntries(draft, "Person").some(item => item.person_id === investmentOwnerId)}><InvestmentExecutionControls draft={draft} ownerId={investmentOwnerId} setOwnerId={setInvestmentOwnerId} /></FinancialSection>
        <section aria-label="Mortgage setup summary"><h3>Debt & mortgage</h3><p>Payment accounts and contract schedules belong to your debts.</p><ForecastSetupLink target="debtOwner" /></section>
        <FinancialSection title="Tax payments & refunds" attention={!!forecastTaxSetupProblem(draft, taxSettlementSetup, settings.simulationStart, settings.simulationEnd)}><TaxSettlementControls start={settings.simulationStart} end={settings.simulationEnd} accounts={accounts.filter(account => ["checking", "savings"].includes(String(account.account_type))).map(account => ({ id: objectId("Account", account), label: objectLabel("Account", account) }))} jurisdictions={forecastTaxJurisdictions(draft)} value={taxSettlementSetup} onChange={setTaxSettlementSetup} /></FinancialSection>
        <p>Future tax limits use projected current law without inflation indexing. Annual contribution facts resolve by year from their recorded sources; unknown years stay incomplete.</p>
        <FieldShell fieldKey="taxConfirm" repairKey="lawScenario" required presentation={{ ...financialField("taxConfirm"), label: "Use projected current-law scenario", semanticFamily: "plan.assumption_index", semanticBinding: "forecastLawPolicy", description: "Explicitly select nominal current-law carry-forward for the requested period. Future law is assumed, not verified; genuine financial capability gaps remain incomplete.", source: "Current Plan scenario choice" }}><input type="checkbox" checked={lawAccepted} onChange={event => setLawAccepted(event.target.checked)} /></FieldShell>
        <details><summary>Technical retirement binding override</summary><fieldset>
          <legend>Baseline retirement binding (session-only)</legend>
          <select aria-label="Baseline retirement income" value={retirementIncomeId} onChange={(event) => setRetirementIncomeId(event.target.value)}><option value="">No retirement binding</option>{incomes.map((income) => <option key={objectId("Income", income)} value={objectId("Income", income)}>{objectLabel("Income", income)}</option>)}</select>
          <select aria-label="Baseline canonical retirement event" value={retirementEventId} onChange={(event) => { setRetirementEventId(event.target.value); const selected = events.find((item) => String(item.event_id) === event.target.value); if (typeof selected?.start_date === "string") setRetirementDate(selected.start_date); }}><option value="">No canonical event</option>{events.map((event) => <option key={String(event.event_id)} value={String(event.event_id)}>{friendlyText(event.name ?? "Unnamed retirement event")}</option>)}</select>
          <input aria-label="Baseline retirement date" type="date" value={retirementDate} onChange={(event) => setRetirementDate(event.target.value)} />
          <button type="button" onClick={() => setRetirementBindings(!retirementIncomeId || !retirementDate ? [] : [{ incomeId: retirementIncomeId, terminationEventId, baselineDate: retirementDate, ...(retirementEventId ? { canonicalEventId: retirementEventId } : {}) }])}>Apply retirement binding</button>
        </fieldset></details>
        <button className="primary" disabled={!lawAccepted || missingForecastSetup(draft, cashFlowExecutionAccountId, investmentOwnerId, liabilityConfig).length > 0 || !!simulationWindowProblem(draft, settings.simulationStart, settings.simulationEnd) || !!forecastTaxSetupProblem(draft, taxSettlementSetup, settings.simulationStart, settings.simulationEnd)} onClick={() => setHouseholdExecution(!retirementIncomeId || !retirementDate ? retirementBindings : [{ incomeId: retirementIncomeId, terminationEventId, baselineDate: retirementDate, ...(retirementEventId ? { canonicalEventId: retirementEventId } : {}) }])}>Apply setup &amp; run forecast</button>
        <p>After applying setup, economic edits automatically refresh the forecast. Update forecast is also available beside the global status.</p>
      </section>
      </section>
      <p>Retirement date: review your saved activity in Life Events.</p>
      <section className="panel" aria-label="Planned contributions"><h2>Planned contributions</h2>
        <ScheduledActivity draft={draft} onContributions={reviewContributions} />
        <button type="button" onClick={() => reviewContributions?.()}>Review or edit contributions</button>
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

function ForecastCutoff({ forecast, draft }: { forecast: Extract<PersonalHouseholdForecastReadModel, { status: "completed" | "incomplete" }>; draft: PersonalDraft }) {
  const diagnostic = forecast.diagnostics.find(item => "severity" in item && item.severity === "error") ?? forecast.diagnostics.find(item => item.entityType !== "tax_capability") ?? forecast.diagnostics[0];
  const summary = diagnostic ? diagnosticSummary(diagnostic, draft) : undefined;
  return <section className="stress" role="alert" aria-label="Forecast stopped early">
    <strong>Last modeled boundary: {(forecast.reachedThrough ?? forecast.requestedHorizon.start).slice(0, 10)} (exclusive).</strong>
    <p>{summary?.problem ?? "The forecast could not model activity from the stopping date."}</p>
    <p>{summary?.remedy ?? "Use the earlier results and retry the forecast; no specific input repair was identified."}</p>
    {diagnostic && <DiagnosticReferences targets={diagnosticTargets(draft, diagnostic)} />}
    {diagnostic && /HORIZON|MONTHS_MISMATCH|PROFILE|OWNER|MATURITY/.test(diagnostic.code ?? "") && <ForecastSetupLink target={/HORIZON|MONTHS_MISMATCH/.test(diagnostic.code ?? "") ? "simulationStart" : "debtOwner"} />}
    <details><summary>Technical cutoff details</summary><pre>{JSON.stringify({ stoppedAt: forecast.stoppedAt, reachedThrough: forecast.reachedThrough, diagnostic }, null, 2)}</pre></details>
  </section>;
}
function HouseholdForecastVisual({
  forecast,
  draft,
  cashFlowOnly = false,
  calm = false,
  cashSources,
}: {
  forecast: Extract<
    PersonalHouseholdForecastReadModel,
    { status: "completed" | "incomplete" }
  >;
  draft: PersonalDraft;
  cashFlowOnly?: boolean;
  calm?: boolean;
  cashSources?: React.ReactNode;
}) {
  const request = useContext(BrowserPerformanceScope);
  const models = useContext(FinancialResultModels);
  const financialModel = models.baseline?.lastGoodResult === forecast ? models.baseline.resultModel ?? draft : draft;
  const cache = useMemo(() => models.explanations?.baseline.forResult(forecast) ?? new ExplanationCache<FinancialExplanation>(), [forecast, models.explanations]);
  const context = models.baseline?.performanceContext;
  const scope = context && models.baseline?.lastGoodResult === forecast
    ? { active: true, context: { ...context, executionLocation: "browser_main" as const }, model: financialModel, forecast } : request;
  const projectedLawCoverage = <ul>{[...new Map((forecast.projectedLaw ?? []).map(item => [`${item.jurisdiction}:${item.baseYear}:${item.from}:${item.until}`, item])).values()].map(item => <li key={`${item.jurisdiction}:${item.from}`}>{item.jurisdiction}: {item.baseYear} source rules projected from {item.from.slice(0, 10)} through {item.until.slice(0, 10)} (exclusive).</li>)}</ul>;
  const supporting = <>
      {calm && forecast.stoppedAt && <ForecastCutoff forecast={forecast} draft={financialModel} />}
      <p className="muted">{forecast.stoppedAt
        ? `Incomplete; stopped at ${forecast.stoppedAt.slice(0, 10)}`
        : `Completed through ${forecast.reachedThrough?.slice(0, 10)}${forecast.status === "incomplete" ? " · Some outputs are partially modeled" : ""}`}</p>
      {!!forecast.projectedLaw?.length && <section className={calm ? "calm-law-basis" : "capability"} aria-label="Projected law forecast basis">
        <strong>Projected current law · forecast assumptions</strong>
        <p>Future statutory limits use explicitly projected current law where verified coverage ends. Personal filing, income and coverage facts need their own annual sources; they are not carried forward. Later verified rules supersede projections.</p>
        {calm ? <CalmDisclosure title="Projected law coverage dates">{projectedLawCoverage}</CalmDisclosure> : projectedLawCoverage}
        <details><summary>Projected source rule identities</summary><ul>{forecast.projectedLaw.map(item => <li key={`${item.baseRuleId}:${item.from}`}>{item.jurisdiction} · {item.baseRuleId} · base year {item.baseYear}</li>)}</ul></details>
      </section>}
      {forecast.liquidityShortfalls.length > 0 && (
        <div className="stress" role="alert">
          <strong>Financial outcome · Modeled liquidity stress</strong>
          <p>
            {forecast.liquidityShortfalls.length} shortfall(s) were modeled.
            This is not an application error.
          </p>
          {forecast.liquidityShortfalls.filter(item => item.mortgageFunding).map(item => <MortgageShortfall key={`${item.fundingPolicyId}:${item.evaluatedAt}`} draft={financialModel} funding={item.mortgageFunding} date={item.evaluatedAt} required={householdMoney(item.requestedAmount)} available={householdMoney(item.fundedAmount)} />)}
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
    </>;
  return <>
    {!calm && forecast.stoppedAt && <ForecastCutoff forecast={forecast} draft={financialModel} />}
    <Profiler id="forecast-chart" onRender={(_id, _phase, duration) => {
      if (scope?.active) recordBrowserDuration("ui.chart_render", duration, scope.context);
    }}><HouseholdChart forecast={forecast} cashFlowOnly={cashFlowOnly} calm={calm}
      stale={!models.baseline || models.baseline.lastGoodResult !== forecast || models.baseline.resultModel !== draft || models.baseline.pending || models.baseline.stale || !!models.setupChangesPending}
      sourceFingerprint={models.baseline?.lastGoodResult === forecast ? models.baseline.resultFingerprint : undefined}
      supporting={calm ? <>{cashSources}<CalmDisclosure title="Forecast assumptions and supporting details">{supporting}</CalmDisclosure></> : undefined} /></Profiler>
    {calm && forecast.liquidityShortfalls.length > 0 && <p className="stress" role="alert">The forecast includes {forecast.liquidityShortfalls.length} cash shortfall(s). Some payments could not be fully funded. Review the payment accounts in forecast details before relying on this plan.</p>}
    {!calm && supporting}
  </>;
}

function MortgageShortfall({ draft, funding, date, required, available, isolated = false }: { draft: PersonalDraft; funding?: import("../src/application/compiler/mortgageFundingPresentation.js").MortgageFundingContext; date: string; required: string; available: string; isolated?: boolean }) {
  const { reviewMortgageFunding } = useContext(FinancialResultModels);
  return <section aria-label="Mortgage funding explanation"><p>{funding ? referenceLabel(draft, "Liability", funding.liabilityId) : "Mortgage payment"} · {date.slice(0, 10)} · Required {required}; available from the evaluated funding sources {available}.</p>
    {funding && <p>Payment account: {funding.fundingAccountIds.map(id => referenceLabel(draft, "Account", id)).join(", ")}{funding.settlementPriority !== undefined && ` · Same-day mortgage order ${funding.settlementPriority}`}.</p>}
    <p>{isolated ? "Salary deposits are excluded from this isolated report. Run the reconciled household forecast to include income, spending and debt together." : "Review the payment account and competing activity on this date. Cash in other accounts cannot fund this payment without an explicitly modeled transfer."}</p>
    {funding && reviewMortgageFunding && <button type="button" onClick={() => reviewMortgageFunding(funding.liabilityId)}>Review mortgage payment account</button>}
  </section>;
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
          <span>Isolated liabilities forecast</span>
        </div>
        <p role="note">This report pays debt from its chosen account’s opening cash. It does not include salary or spending. A standalone cash-flow result does not fund this report; use the reconciled household forecast to evaluate them together.</p>
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
            <MortgageShortfall draft={draft} funding={item.mortgageFunding} date={item.evaluatedAt ?? item.period} required={item.required.display} available={item.available.display} isolated />
            <details><summary>Technical diagnostic details</summary><p>{item.diagnostic}</p></details>
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
        <span>Standalone cash-flow forecast · no mortgage execution</span>
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
  const [lookup, setLookup] = useState("");
  const [traceTargets, setTraceTargets] = useState<readonly DiagnosticTarget[]>([]), [traceMessage, setTraceMessage] = useState("");
  const { baseline } = useContext(FinancialResultModels);
  const result = baseline?.lastGoodResult;
  const knownRefs = result && "points" in result ? result.points.flatMap(point => point.traceRefs).filter(ref => ref.traceId === lookup.trim()) : [];
  const targets = lookup.trim() ? exactDiagnosticTargets(draft, lookup.trim()) : [];
  return (
    <>
      <PageHead
        eyebrow="Settings · Technical diagnostics"
        title="Technical model details"
        text="IDs, versions, and validation details for diagnostics."
      />
      <section className="panel">
        <label htmlFor="diagnostic-id-search">Find a record by exact ID</label><input id="diagnostic-id-search" value={lookup} onChange={event => { setLookup(event.target.value); setTraceTargets([]); setTraceMessage(""); }} placeholder="Paste the complete record ID" />
        {lookup.trim() && (targets.length === 1 ? <DiagnosticReferences targets={targets} /> : <p role="status">{targets.length ? "More than one record uses this ID. Import corrected identities; no unique navigation target exists." : "No exact record matches this ID. Trace IDs belong to a particular forecast; open that result’s explanation to review its source records. Missing model records require corrected-model import."}</p>)}
        {knownRefs.length > 0 && <button type="button" onClick={() => {
          try {
            const explanation = resolveHouseholdExplanation(baseline?.resultModel ?? draft, knownRefs);
            const ids = [...new Set([...explanation.sources.map(source => source.objectId), ...explanation.assumptions.map(source => source.assumptionId), ...explanation.events.map(source => source.eventId), ...explanation.rules.map(source => source.ruleId)])];
            setTraceTargets(ids.flatMap(id => exactDiagnosticTargets(draft, id))); setTraceMessage(ids.length ? "Named sources carried by this forecast trace; review their current recorded facts below." : "This trace has no editable source record. Review its forecast explanation or import a corrected supported model.");
          } catch { setTraceMessage("This trace’s saved explanation is unavailable. Update the forecast and review its new explanation; no record was changed."); }
        }}>Review known forecast trace sources</button>}
        {traceMessage && <p role="status">{traceMessage}</p>}<DiagnosticReferences targets={traceTargets} />
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
