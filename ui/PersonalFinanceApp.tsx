"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
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
  createGuidedSetupDraft,
  createSyntheticPersonalDraft,
  deletePersonalObject,
  exportPersonalModelJson,
  getCurrentPosition,
  getPersonalEditorMetadata,
  importPersonalModelJson,
  migratePersonalModelVersion,
  patchPersonalObject,
  comparePersonalCashFlowPlans,
  runPersonalForecast,
  resolvePersonalSessionSettings,
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
} from "../src/application/personalMvp.js";

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
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a start date"),
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
  const [sessionSettings, setSessionSettings] =
    useState<PersonalSessionSettings>(() =>
      sessionSettingsFromHorizon("2026-01-01", 12),
    );
  const [runSettingsError, setRunSettingsError] = useState("");
  const [fileReport, setFileReport] =
    useState<ReturnType<typeof validatePersonalModelJson>>();
  const [pendingJson, setPendingJson] = useState("");
  const [notice, setNotice] = useState("");
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
    () => (draft ? getCurrentPosition(draft) : undefined),
    [draft],
  );
  const issues = useMemo(
    () => (draft ? validatePersonalDraft(draft) : []),
    [draft],
  );

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
    setDraft(next);
    setSessionSettings(
      sessionSettingsFromHorizon(values.startDate, Number(values.horizon) * 12),
    );
    setNotice("Your starting financial picture is ready");
    navigate("Overview");
  });

  if (!draft)
    return (
      <SetupWizard
        form={setup}
        step={setupStep}
        setStep={setSetupStep}
        complete={completeSetup}
        loadExample={() => {
          setDraft(createSyntheticPersonalDraft());
          setSessionSettings(sessionSettingsFromHorizon("2026-01-01", 120));
          setNotice("Synthetic example loaded");
        }}
      />
    );

  const runForecast = () => {
    const resolved = resolvePersonalSessionSettings(
      sessionSettings,
      forecastScope,
    );
    if (!resolved.request) {
      setRunSettingsError(resolved.error ?? "Run settings are not valid.");
      return;
    }
    setRunSettingsError("");
    setForecast(runPersonalForecast(draft, resolved.request));
  };
  const runComparison = () => {
    const resolved = resolvePersonalSessionSettings(
      sessionSettings,
      "cash_flow",
    );
    if (!resolved.request) {
      setRunSettingsError(resolved.error ?? "Run settings are not valid.");
      navigate("Settings");
      setSubnav("Model Settings");
      return;
    }
    setRunSettingsError("");
    setComparison(
      comparePersonalCashFlowPlans(draft, resolved.request, "0.03"),
    );
    navigate("Plan");
    setSubnav("Compare Plans");
  };
  const exportModel = () => {
    const blob = new Blob([exportPersonalModelJson(draft)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "personal-finance-model.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("Model exported to a local file");
  };
  const readImport = async (file: File) => {
    const json = await file.text();
    setPendingJson(json);
    setFileReport(validatePersonalModelJson(json));
  };
  const importModel = () => {
    setDraft(importPersonalModelJson(pendingJson));
    setNotice("Model imported into this session");
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
          <strong>Session only</strong> — changes are not saved.{" "}
          <button onClick={exportModel}>Export your model</button> to preserve
          them.
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
              forecast={forecast}
              onPlan={() => {
                navigate("Plan");
                setSubnav("Current Plan");
              }}
            />
          )}
          {primary === "Money" && subnav === "Cash Flow" && (
            <CashFlow
              position={position!}
              forecast={forecast}
              run={() => {
                setForecastScope("cash_flow");
                runForecast();
              }}
            />
          )}
          {primary === "Net Worth" && subnav === "Overview" && (
            <NetWorthOverview position={position!} draft={draft} />
          )}
          {primary === "Plan" && subnav === "Current Plan" && (
            <Plan
              forecastScope={forecastScope}
              setScope={setForecastScope}
              run={runForecast}
              forecast={forecast}
              settings={sessionSettings}
              error={runSettingsError}
            />
          )}
          {primary === "Plan" && subnav === "Compare Plans" && (
            <ComparePlans comparison={comparison} onRun={runComparison} />
          )}
          {primary === "Settings" && subnav === "Model Settings" && (
            <ModelSettings
              settings={sessionSettings}
              setSettings={setSessionSettings}
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
            />
          )}
          {primary === "Settings" && subnav === "Advanced" && (
            <Advanced draft={draft} issues={issues} />
          )}
          {primary === "Plan" && subnav === "What If?" && (
            <WhatIfStarter onCompare={runComparison} />
          )}
          {EDITORS[subnav] && (
            <EditorHub
              types={EDITORS[subnav]!}
              draft={draft}
              setDraft={setDraft}
              metadata={metadata}
              setNotice={setNotice}
            />
          )}
          {primary === "Plan" &&
            subnav === "Life Events" &&
            !EDITORS[subnav] && (
              <Capability
                title="Life events"
                message="Canonical events are preserved on import. Event types without existing execution semantics are marked not currently executable."
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
}: {
  form: UseFormReturn<SetupValues>;
  step: number;
  setStep: (value: number) => void;
  complete: () => void;
  loadExample: () => void;
}) {
  const steps = [
    { title: "About you", field: "name", label: "Household name" },
    { title: "Income", field: "income", label: "Monthly income" },
    {
      title: "Accounts & investments",
      field: "cash",
      label: "Opening cash balance",
    },
    { title: "Home & other assets", field: "asset", label: "Asset value" },
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
        <p className="privacy">
          Session only — nothing is saved or transmitted.
        </p>
      </section>
    </main>
  );
}

function Overview({
  position,
  forecast,
  onPlan,
}: {
  position: NonNullable<ReturnType<typeof getCurrentPosition>>;
  forecast: PersonalForecastReadModel | undefined;
  onPlan: () => void;
}) {
  const cards = [
    ["Net worth", position.netWorth],
    ["Cash", position.cash],
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
      <section className="kpi-grid">
        {cards.map(([label, value]) => (
          <article className="kpi" key={label}>
            <span>{label}</span>
            <strong>{value?.display ?? "Unavailable"}</strong>
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
        {forecast?.status === "completed" ? (
          <ForecastVisual forecast={forecast} />
        ) : (
          <div className="capability">
            <strong>
              Household-wide reconciled projection is not yet available
            </strong>
            <p>
              Run a scope-specific cash-flow, investment, or liability forecast
              in Plan. Independent slices are never added into a fabricated
              household total.
            </p>
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
    </>
  );
}
function CashFlow({
  position,
  forecast,
  run,
}: {
  position: ReturnType<typeof getCurrentPosition>;
  forecast: PersonalForecastReadModel | undefined;
  run: () => void;
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
        {forecast ? (
          <ForecastVisual forecast={forecast} />
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
}: {
  position: ReturnType<typeof getCurrentPosition>;
  draft: PersonalDraft;
}) {
  const data =
    position.assets && position.liabilities
      ? [
          { name: "Assets", value: chartNumber(position.assets.exact) },
          {
            name: "Liabilities",
            value: chartNumber(position.liabilities.exact),
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
        <Kpi label="Net worth" value={position.netWorth?.display} />
        <Kpi label="Total assets" value={position.assets?.display} />
        <Kpi label="Total liabilities" value={position.liabilities?.display} />
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
            <strong>Current composition is unavailable</strong>
            <p>
              The portable asset and investment records cannot be reconciled
              into the shared valuation state without additional executable
              configuration.
            </p>
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
}: {
  forecastScope: ForecastRequest["scope"];
  setScope: (scope: ForecastRequest["scope"]) => void;
  run: () => void;
  forecast: PersonalForecastReadModel | undefined;
  settings: PersonalSessionSettings;
  error: string;
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
function WhatIfStarter({ onCompare }: { onCompare: () => void }) {
  return (
    <>
      <PageHead
        eyebrow="Plan · What If?"
        title="Explore a what-if"
        text="Start with a supported deterministic change. Technical scenario metadata stays below."
      />
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>What if income grows 3% per year?</h2>
            <p>
              Uses the existing cash-flow scenario engine and an exact
              effective-annual rate.
            </p>
          </div>
          <button className="primary" onClick={onCompare}>
            Compare this plan
          </button>
        </div>
        <p className="muted">
          Other supported scenario changes remain editable as canonical plan
          data; execution is capability-gated unless they translate
          unambiguously to the selected scope.
        </p>
      </section>
    </>
  );
}

function ComparePlans({
  comparison,
  onRun,
}: {
  comparison: PersonalScenarioComparisonReadModel | undefined;
  onRun: () => void;
}) {
  return (
    <>
      <PageHead
        eyebrow="Plan · Compare Plans"
        title="Compare your current plan"
        text="Configuration differences remain explicit; only an executable scope may produce deltas."
      />
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Current plan vs alternatives</h2>
            <p>
              Cash-flow comparison can run only after the current plan is
              executable.
            </p>
          </div>
          <button className="primary" onClick={onRun}>
            Compare supported what-if
          </button>
        </div>
        {comparison?.status === "completed" ? (
          <>
            <div className="scope-badge">Active scope: cash flow</div>
            <div className="chart">
              <ResponsiveContainer>
                <LineChart
                  data={comparison.points.map((point) => ({
                    period: point.period.slice(0, 7),
                    baseline: chartNumber(point.baseline.exact),
                    alternative: chartNumber(point.alternative.exact),
                    delta: chartNumber(point.delta.exact),
                  }))}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line dataKey="baseline" stroke="#3e5f8a" strokeWidth={2} />
                  <Line
                    dataKey="alternative"
                    stroke="#26755f"
                    strokeWidth={3}
                  />
                  <Line
                    dataKey="delta"
                    stroke="#c07845"
                    strokeDasharray="5 4"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="table-scroll">
              <table>
                <caption>
                  Current plan, alternative, and alternative-minus-current delta
                </caption>
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Current plan</th>
                    <th>Alternative</th>
                    <th>Delta</th>
                    <th>Why?</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.points.map((point) => (
                    <tr key={point.period}>
                      <td>{point.period.slice(0, 10)}</td>
                      <td>{point.baseline.display}</td>
                      <td>{point.alternative.display}</td>
                      <td>{point.delta.display}</td>
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
            <div className="capability">
              <strong>Configuration differences</strong>
              {comparison.configurationDifferences.map((difference) => (
                <p key={difference.target}>
                  {difference.kind.replaceAll("_", " ")} · {difference.target} ·{" "}
                  {difference.assumptionIds.join(", ")}
                </p>
              ))}
              <p>
                Applied rules:{" "}
                {comparison.appliedRuleDifferences.alternativeOnly.length ||
                comparison.appliedRuleDifferences.baselineOnly.length
                  ? "differences shown in trace details"
                  : "no applied-rule difference"}
              </p>
            </div>
          </>
        ) : (
          <Empty
            text={
              comparison?.message ??
              "No executable comparison is available yet."
            }
          />
        )}
      </section>
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

function ForecastVisual({ forecast }: { forecast: PersonalForecastReadModel }) {
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
}: any) {
  return (
    <>
      <PageHead
        eyebrow="Settings · Import / Export"
        title="Keep control of your model"
        text="Files stay in your browser. Compatibility is inspected before any import or explicit migration."
      />
      <section className="action-grid">
        <article className="panel">
          <h2>Export</h2>
          <p>Download the deterministic PR 13 portable model JSON.</p>
          <button className="primary" onClick={exportModel}>
            Export model
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
