# Personal Finance App — System / Software Architecture Specification

**Version:** 1.1.0-draft  
**Status:** Architecture baseline  
**Namespace:** `pfm`  
**Applies to:** Prototype → Personal MVP → Private Alpha  
**Primary repository:** `bensmullen/personal-finance-app`

---

# 1. Purpose

This document defines the software architecture, repository organization, technology direction, engineering standards, validation strategy, data-boundary rules, and implementation sequence for the Personal Finance App.

The architecture is explicitly built upon the existing:

- Personal Financial Modeling Canonical Schema;
- executable financial-semantics specification;
- P01–P34 time-series primitive model;
- financial-variable-to-primitive mappings;
- simulation-engine interfaces;
- semantic kernel;
- golden test harness;
- Vertical Slice 1 implementation contract; and
- first-pass GitHub Pages UI.

The immediate objective is **not** to build the final commercial platform.

The immediate objective is to evolve the existing walking skeleton into a deterministic, explainable, comprehensively tested financial-modeling engine and then into a useful personal finance application for the developer's own use.

The system SHALL evolve through controlled maturity stages:

1. executable financial-model prototype;
2. useful personal application;
3. private multi-user application;
4. production public application;
5. optionally, commercial personal-finance service.

Architecture SHALL enable later stages without forcing infrastructure intended for those stages into the current prototype.

---

# 2. Architectural priorities

Priorities, in order:

1. **Financial correctness**
2. **Determinism and reproducibility**
3. **Semantic clarity**
4. **Explainability and auditability**
5. **Testability**
6. **User usefulness**
7. **Security and privacy**
8. **Maintainability**
9. **Developer velocity**
10. **Performance**
11. **Infrastructure scalability**

The project SHALL optimize the current stage for correctness, explainability, and iteration rather than speculative scale.

---

# 3. Source-of-truth hierarchy

The project currently contains several representations of overlapping financial concepts. They SHALL have an explicit authority hierarchy.

## 3.1 Normative authority

Highest to lowest:

### Level 1 — Canonical financial specification

Defines:

- domain vocabulary;
- objects;
- attributes;
- enum membership;
- relationships;
- primitive identities;
- financial-variable mappings;
- canonical invariants.

The canonical schema is authoritative for **what the financial model means**.

### Level 2 — Executable financial semantics

Defines:

- temporal semantics;
- financial state;
- flows;
- recognition;
- obligations/rights;
- settlements;
- transactions;
- accounting behavior;
- dependency semantics;
- semantic barriers;
- valuation;
- statement derivation;
- determinism;
- period atomicity.

This specification is authoritative for **how the model behaves during execution**.

### Level 3 — Vertical-slice specifications

Define implementation contracts for individual end-to-end capabilities.

A slice may specialize the canonical model but SHALL NOT contradict Levels 1–2.

### Level 4 — Architecture Decision Records

Define software choices such as:

- runtime representation;
- repository structure;
- database technology;
- UI framework;
- persistence strategy;
- authentication strategy.

ADRs SHALL NOT redefine financial semantics.

### Level 5 — Executable implementation

Production code SHALL conform to Levels 1–4.

### Level 6 — Generated artifacts

Examples:

- TypeScript interfaces;
- JSON Schema;
- SQL DDL;
- API schemas;
- documentation tables.

Generated artifacts are derived outputs and SHALL NOT independently become authoritative.

---

# 4. Specification conformance and drift control

A financial concept SHALL NOT be independently maintained in multiple locations indefinitely.

Long-term direction:

```text
Canonical specification
        │
        ├── generated validation schemas
        ├── generated or validated TypeScript contracts
        ├── generated database mappings
        └── executable conformance tests
```

Where automatic generation is impractical, CI SHALL verify that manually maintained derived artifacts conform to the canonical specification.

## 4.1 Specification manifest

The repository SHALL introduce a machine-readable specification manifest during architecture consolidation.

It SHOULD identify at minimum:

```text
canonical_schema_version
model_format_version
executable_semantics_version
engine_contract_version
generated_artifact_versions
```

The manifest SHALL define which artifact versions are intended to be mutually compatible.

## 4.2 Derived-artifact status

Until formally reconciled and covered by conformance checks, the existing generated PostgreSQL DDL and generated simulation TypeScript interfaces SHALL be treated as **design/reference artifacts**, not executable production authority.

A generated artifact that conflicts with the canonical financial specification SHALL be considered wrong until the specification is explicitly amended.

## 4.3 CI conformance gate

Architecture consolidation SHALL introduce:

```text
npm run spec:validate
```

Initial checks SHOULD include:

- expected specification versions are known;
- P01–P34 identities match across relevant artifacts;
- model fixtures validate against the model schema;
- money/rate generated mappings do not silently use binary floating point as authoritative financial representations;
- closed enum membership has not drifted accidentally;
- derived artifact headers identify their source/version.

---

# 5. System architecture style

The application SHALL use a **modular monolith with a pure financial engine and ports/adapters around it**.

Microservices SHALL NOT be introduced during the personal-MVP or private-alpha stages unless a concrete operational requirement demands them.

Conceptually:

```text
┌──────────────────────────────────────────────┐
│                 User Interface               │
└──────────────────────┬───────────────────────┘
                       │
┌──────────────────────▼───────────────────────┐
│              Application Services            │
│                                              │
│ Run forecast                                 │
│ Compare scenarios                            │
│ Edit household model                         │
│ Import/export data                           │
└──────────────────────┬───────────────────────┘
                       │
┌──────────────────────▼───────────────────────┐
│            Financial Modeling Engine         │
│                                              │
│ Domain model                                 │
│ Values / units / time                        │
│ Rules / policies                             │
│ Time-series primitives                       │
│ Dependencies                                 │
│ Events                                       │
│ Recognition                                  │
│ Obligations / settlements                    │
│ Funding / constraints                        │
│ Accounting                                   │
│ State transitions                            │
│ Valuation                                    │
│ Statements                                   │
│ Simulation                                   │
│ Calculation lineage                         │
└──────────────────────┬───────────────────────┘
                       │ ports
         ┌─────────────┼──────────────┐
         │             │              │
         ▼             ▼              ▼
     Persistence    External Data    Reporting
```

The financial engine SHALL NOT depend on:

- React;
- Next.js;
- browser APIs;
- PostgreSQL;
- authentication providers;
- hosting providers;
- Plaid or other aggregators;
- OpenAI APIs;
- DOM APIs.

---

# 6. Core architectural rule

> Financial calculations SHALL live in the financial-modeling engine, not in the user interface, persistence layer, API handlers, or AI layer.

The same engine SHALL eventually be usable by:

- browser application;
- server application;
- CLI;
- tests;
- batch simulation;
- scenario engine;
- future mobile application;
- future AI interface.

---

# 7. Canonical execution pipeline

The engine SHALL preserve the existing semantic barrier architecture.

For each simulation period:

```text
1. Establish run + period context
       ↓
2. Resolve model/external/stochastic inputs
       ↓
3. Activate events and policy/rule changes
       ↓
4. Build + validate dependency graph
       ↓
5. Evaluate primitive compositions
       ↓
6. Generate flows + recognition facts
       ↓
7. Generate obligations / rights / settlement proposals
       ↓
8. Resolve funding constraints and accept/reject/partially satisfy proposals
       ↓
9. Translate accepted effects into transactions
       ↓
10. Post transactions + transition owned state
       ↓
11. Perform closing valuation
       ↓
12. Derive statements + metrics + lineage references
       ↓
13. Validate invariants
       ↓
14. Commit period result
```

Partially mutated state SHALL NOT be exposed as an undeclared dependency.

If a period experiences a hard semantic failure before commit, the opening committed state SHALL remain unchanged.

Valid financial stress outcomes, such as insufficient liquidity, SHALL be represented according to explicit funding/constraint semantics and SHALL NOT automatically be treated as engine corruption.

---

# 8. Authoritative versus derived information

The system SHALL distinguish at least:

| Concept | Authority |
|---|---|
| User-entered domain facts | Authoritative input |
| External verified facts | Authoritative input with provenance |
| Scenario assumptions | Authoritative scenario input |
| Primitive outputs | Derived |
| Recognition facts | Generated authoritative semantic records |
| Obligations / rights | Authoritative lifecycle state |
| Settlements | Authoritative generated events |
| Posted transactions | Authoritative accounting history |
| Account / position / liability state | Authoritative economic state |
| Statements | Derived |
| Metrics | Derived |
| Charts | Derived |
| Forecast summaries | Derived |
| Calculation traces | Derived explanation/audit metadata |

A closing balance SHALL NOT be accepted as the mechanism for creating the financial activity that caused the balance.

---

# 9. Canonical runtime values, units, and precision

The exact-value foundation is an immediate architecture dependency and SHALL be introduced before further engine expansion.

## 9.1 Money

Bare JavaScript `number` SHALL NOT be used for authoritative monetary calculations in engine code.

The canonical value model SHALL distinguish:

```text
DecimalAmount
Money
Currency
Rate
RateBasis
Quantity
Unit
Percentage
RoundingPolicy
```

`Money` SHALL include or be associated with currency identity.

Serialized financial decimals SHALL use decimal strings rather than IEEE floating-point JSON numbers where precision may be lost.

Example:

```json
{
  "amount": "12345.6700",
  "currency": "USD"
}
```

## 9.2 Precision

Canonical persistence remains compatible with:

```text
Money       NUMERIC(19,4)
Rates       NUMERIC(19,10)
Quantities  appropriate explicit decimal scale
```

Runtime arithmetic SHALL use an arbitrary-precision decimal abstraction.

The specific decimal library SHALL be encapsulated behind project value types so the domain model does not expose a vendor-library class as a public contract.

## 9.3 Currency

The personal MVP MAY initially operate only in USD, but currency identity SHALL remain explicit in financial value and accounting contracts.

The engine SHALL NOT silently combine amounts in different currencies.

Currency conversion, when introduced, SHALL require an explicit rate, observation time, and provenance.

## 9.4 Rates

A rate SHALL specify its basis.

Examples:

```text
EffectiveAnnualRate
NominalAnnualRate
PeriodicRate
ContinuousRate
```

A bare `0.07` without rate basis SHALL not be considered a complete financial value.

Rate conversion SHALL require explicit temporal and compounding semantics.

## 9.5 Quantities and units

Quantities such as investment shares SHALL not be represented as money.

Primitive composition SHALL reject incompatible units unless an explicit adapter/conversion exists.

## 9.6 Rounding

Financial calculations MAY retain precision beyond a currency's settlement precision.

At an actual posted monetary boundary, an explicit rounding policy SHALL be applied.

The following SHALL always be specified:

- rounding mode;
- currency precision;
- point at which rounding occurs.

Rounding SHALL never occur implicitly because a value happens to be displayed.

## 9.7 Transitional bigint-cent implementation

The current bigint-cent implementation is an acceptable Vertical Slice 1 prototype representation for two-decimal posted amounts, but it SHALL NOT be promoted into a shared long-term architecture and then replaced later.

Architecture consolidation SHALL migrate both existing executable paths directly to the canonical exact-value foundation in the first shared-values milestone.

The transition SHALL preserve existing valid golden economic results.

---

# 10. Temporal architecture and actual/forecast boundary

The existing half-open interval convention SHALL remain canonical:

```text
[start, end)
```

Core engine code SHALL distinguish:

```text
CivilDate
Instant
Period
Duration / year fraction
```

User-facing inclusive end dates SHALL be translated to half-open internal periods.

No calculation SHALL silently infer:

- timezone;
- day-count basis;
- compounding frequency;
- proration basis.

Direct manipulation of JavaScript `Date` SHALL be isolated behind temporal utilities.

## 10.1 `asOf` boundary

Every personal-model projection SHALL have an explicit `asOf` boundary separating observed/current facts from modeled future values.

Conceptually:

```text
Historical / observed
────────────┬──────────── Forecast / modeled
            │
           asOf
```

A run context SHOULD include at minimum:

```text
asOf
simulationStart
simulationEnd
scenarioId
baseCurrency
dataCutoff
```

Actual/observed facts SHALL remain distinguishable from forecasted/model-generated facts in both internal state and user-facing outputs.

No model run SHALL silently treat a forecast value as an observed historical fact.

---

# 11. Identity, generated occurrence keys, and idempotency

Canonical persistent financial entities SHALL use stable UUID identities.

Human-readable keys MAY be used in fixtures and prototypes but SHALL not become production primary identity.

Three distinct identity concerns SHALL be modeled separately.

## 11.1 Persistent domain identity

Examples:

- person ID;
- household ID;
- account ID;
- liability ID;
- scenario ID;
- primitive-instance ID.

These SHALL use stable persistent identities.

## 11.2 Deterministic generated occurrence identity

Generated simulation occurrences SHALL have deterministic occurrence keys sufficient to identify the same economic occurrence across retries/re-evaluations.

A generated key SHOULD derive from stable inputs such as:

```text
scenario identity
primitive instance identity
scheduled occurrence identity/time
semantic effect type
economic target
```

Generated semantic records SHALL have stable unique identities sufficient to detect:

- duplicate recognition;
- duplicate transactions;
- duplicate settlements;
- duplicate one-time execution;
- duplicate generated occurrences.

## 11.3 External/import idempotency identity

Imported actual facts SHALL preserve source-system identity or another deterministic idempotency key.

Re-importing the same external fact SHALL NOT create a second authoritative transaction merely because the import operation is repeated.

The CSV/bank-import implementation may be deferred; the identity contract SHALL not be deferred.

---

# 12. Data provenance

Imported and observed data SHALL retain provenance.

Recommended metadata includes:

```text
source_type
source_id
observed_at
imported_at
effective_at
confidence
original_external_id
```

Possible source types:

```text
user
historical_import
financial_institution
market_data
model
system
```

Forecasted/model-generated values SHALL remain distinguishable from actual observed financial facts.

A model value that was entered manually MAY still be authoritative user input while remaining distinguishable from institution-observed actual data.

---

# 13. Calculation lineage and explainability

Explainability SHALL be an architectural capability of the financial engine, not a UI-only afterthought.

The engine SHALL be able to associate important derived outputs with the inputs and operations that produced them.

A calculation trace MAY conceptually contain:

```ts
interface CalculationTrace {
  traceId: string;
  outputKey: string;
  primitiveInstanceId?: string;
  sourceEntityIds: string[];
  dependencyNodeIds: string[];
  assumptionIds: string[];
  eventIds: string[];
  ruleIds: string[];
  inputTraceIds: string[];
}
```

Exact structure is implementation-specific, but the engine architecture SHALL permit trace propagation through primitive composition and statement/metric derivation.

Lineage SHALL support future questions such as:

```text
Why is projected net worth $X?
Which assumption changed this scenario result?
Which primitive produced this value?
Which tax rule was effective?
Which source fact funded this balance?
```

Trace persistence MAY be optional and MAY be disabled for performance, but the calculation contracts SHALL not prevent trace generation.

---

# 14. Liquidity, funding, insufficient-funds, and constraint semantics

This is an immediate semantic requirement for multi-period forecasting.

A lack of liquid cash can be a valid financial outcome and SHALL NOT automatically be treated as an invalid model.

## 14.1 No implicit funding

The engine SHALL NOT silently:

- borrow money;
- move cash from another account;
- sell investments;
- use overdraft;
- draw a line of credit;
- skip a liability;
- create an undeclared negative cash balance.

Any such behavior requires an explicit funding or contract rule.

## 14.2 Funding policy

Where a settlement requires a funding source, the model SHALL identify an explicit funding policy or account.

A future policy may define an ordered funding chain such as:

```text
checking
→ savings
→ taxable brokerage liquidation
→ HELOC
```

No default chain SHALL be inferred from account type alone.

## 14.3 Settlement versus recognition

Insufficient liquidity SHALL NOT erase or undo an otherwise valid economic recognition.

Where economically appropriate:

```text
expense/income/tax recognized
        ↓
obligation/right exists
        ↓
settlement attempted
        ↓
funding insufficient
        ↓
obligation remains outstanding
+ explicit liquidity/constraint result
```

## 14.4 Constraint outcome

The engine SHALL model a structured result for a settlement/funding constraint, conceptually including outcomes such as:

```text
fully_satisfied
partially_satisfied
deferred
rejected
unfunded
contract_default
```

Exact enum membership requires semantic-specification review before implementation.

## 14.5 Negative balances

Whether a financial balance may become negative SHALL be determined by the account/product contract, not by inconsistent generic engine behavior.

Examples:

- checking may disallow negative balance unless overdraft is explicitly modeled;
- credit-card liability may increase through additional borrowing;
- an unsecured liability cannot become negative through overpayment without explicit policy;
- forecast liquidity shortfall may be represented as a diagnostic/constraint event rather than negative checking cash.

The current inconsistent prototype behavior SHALL be unified before multi-period simulation becomes authoritative.

---

# 15. Run outcome, failure, and partial-horizon semantics

Period atomicity and run-level completion are distinct concerns.

A simulation run SHALL return an explicit completion status.

Conceptually:

```ts
type SimulationRunResult =
  | {
      status: "completed";
      periods: PeriodResult[];
    }
  | {
      status: "incomplete";
      periods: PeriodResult[];
      stoppedAt: string;
      reason: ValidationIssue;
    }
  | {
      status: "invalid_model";
      issues: ValidationIssue[];
    };
```

The exact interface may evolve, but these semantics SHALL hold:

- a structurally/semantically invalid model SHALL be distinguishable from a valid model experiencing financial stress;
- a hard error in a period SHALL not commit that period's partial authoritative state;
- previously committed successful periods MAY be returned for diagnosis;
- an incomplete projection SHALL never be presented as if it reached the requested horizon;
- warnings and modeled shortfalls SHALL not automatically terminate a run unless policy requires termination.

---

# 16. Domain boundaries

The financial engine SHALL internally maintain the following conceptual modules.

## 16.1 Model

Responsible for:

- Person
- Household
- Account
- Asset
- Liability
- Income
- Expense
- Transaction domain records
- Event
- Scenario
- Assumption
- Investment
- Insurance
- TaxRule
- primitive instances
- dependency definitions
- model format metadata

## 16.2 Values

Responsible for:

- DecimalAmount
- Money
- Currency
- Rate
- RateBasis
- Quantity
- Unit
- RoundingPolicy

## 16.3 Time

Responsible for:

- CivilDate
- Instant
- Period
- year fractions/day-count conventions
- recurrence/schedule temporal helpers
- `asOf` and run temporal boundaries

## 16.4 Identity

Responsible for:

- persistent IDs
- generated occurrence keys
- idempotency keys
- stable identity helpers

## 16.5 Rules and policies

Responsible for executable effective-dated rules such as:

- tax;
- contribution limits;
- withdrawal restrictions;
- eligibility;
- fees;
- product rules;
- settlement/funding policy.

Rules SHALL have explicit identity and effective periods where results depend on rule version.

A primitive MAY depend on a rule engine but SHALL NOT embed unrelated jurisdiction/product policy as ad-hoc formula code.

## 16.6 Primitives

Responsible for executable P01–P34 behavior.

Primitives SHALL:

- consume declared inputs;
- consume explicit prior state where required;
- emit values or semantic effects;
- propagate lineage references where enabled;
- never directly modify authoritative financial state;
- never directly post accounting transactions.

## 16.7 Dependency engine

Responsible for:

- nodes;
- edges;
- lags;
- priority;
- cycle detection;
- stable ordering.

Zero-lag cycles SHALL fail unless an explicitly specified solved operator exists.

Lagged dependencies SHALL consume explicitly identified prior state.

## 16.8 Semantic lifecycle

Responsible for:

- economic occurrences;
- flows;
- recognition;
- obligations;
- rights;
- settlement proposals;
- accepted settlements;
- generated effects.

## 16.9 Funding and constraints

Responsible for:

- settlement funding selection;
- available-liquidity checks;
- explicit funding chains;
- constraint outcomes;
- partial funding where contracts permit;
- liquidity-shortfall diagnostics.

Funding rules SHALL NOT create accounting history directly; accepted funding/settlement effects flow through the accounting subsystem.

## 16.10 Accounting

Responsible for:

- typed accounting legs;
- debit/credit validation;
- transaction identity;
- cash-flow classification;
- posting.

Only this module SHALL post authoritative accounting legs.

## 16.11 State transition

Responsible for applying validated postings and explicit state transitions to a cloned opening state.

## 16.12 Valuation

Responsible for:

- position market value;
- asset valuation;
- liability valuation;
- closing account value.

## 16.13 Statements

Responsible for:

- balance sheet;
- income statement;
- cash-flow statement;
- household net worth;
- derived metrics.

Statements SHALL be recomputable from authoritative inputs/state/history.

## 16.14 Simulation

Responsible for:

- run context;
- period planning;
- semantic barriers;
- engine orchestration;
- multi-period execution;
- deterministic runs;
- stochastic runs;
- run metadata;
- completion status;
- diagnostics.

## 16.15 Lineage

Responsible for optional calculation/explanation traces connecting derived outputs to source facts, assumptions, rules, primitive instances, and dependency nodes.

---

# 17. Scenario architecture

A scenario SHALL define an alternate future without destructively altering the baseline model.

Conceptually:

```text
Base financial model
       │
       ├── Baseline scenario
       ├── Retirement-early scenario
       ├── Buy-home scenario
       └── Lower-return scenario
```

Scenario inheritance MAY use `base_scenario_id`.

A scenario SHOULD primarily contain overrides or additions to:

- assumptions;
- planned events;
- policy choices;
- primitive configurations.

Historical actual facts SHALL not be rewritten merely because a forecast scenario changes.

Scenario comparison SHALL preserve enough metadata to identify which assumptions/events/rules differ between compared runs.

---

# 18. Determinism and randomness

## 18.1 Determinism

A deterministic run SHALL satisfy:

```text
same canonical model
+ same initial state
+ same scenario
+ same assumptions
+ same asOf/data cutoff
+ same engine version
+ same specification versions
+ same effective rule versions
+ same seed / stochastic realization
=
same observable result
```

Simulation results SHALL record enough metadata to reproduce a run.

## 18.2 Randomness

Randomness SHALL only enter through an explicit `RandomSource`.

No primitive SHALL directly call:

```text
Math.random()
```

Stochastic simulations SHALL accept a seed.

Independent stochastic processes SHOULD have stable process identities to prevent unrelated implementation-order changes from altering random streams.

---

# 19. User identity, household membership, and economic ownership

Authentication identity and financial-domain ownership are distinct concepts.

The architecture SHALL distinguish:

```text
Application User
Person
HouseholdMembership
Economic Ownership
```

An application user's permission to access a household SHALL NOT imply that the user economically owns every financial object in that household.

Examples:

```text
Application User U1
      │
      └── HouseholdMembership
                │
                └── Household H1

Person P1 owns IRA A1
Person P2 owns 401(k) A2
Household/joint ownership applies to home A3
```

Authentication-provider subject IDs SHALL never be reused as canonical financial ownership IDs.

This distinction SHALL be preserved even before authentication is implemented so that the domain schema does not require a future ownership rewrite.

---

# 20. Personal financial data boundary

Before the application is used with real personal financial information, the following rules become mandatory.

Real personal financial information SHALL NOT be:

- committed to Git;
- embedded in repository fixtures;
- included in Golden Household test data;
- placed in URLs/query strings;
- printed to routine browser/server logs;
- included in screenshots or CI artifacts without explicit sanitization;
- copied into public issue or PR descriptions;
- stored in committed `.env` files.

Golden/test households SHALL use synthetic data only.

## 20.1 Personal-MVP persistence choice

Before implementing personal persistence, an explicit ADR SHALL state which persistence mode is being used, for example:

```text
ephemeral browser state
local browser storage
local file
local encrypted file
server persistence
```

Persistence SHALL NOT be introduced accidentally by individual UI components.

## 20.2 Public GitHub Pages

The current GitHub Pages deployment is suitable for the synthetic Vertical Slice 1 demo.

Real personal financial data SHALL NOT be embedded into the deployed static bundle or repository.

If the personal MVP uses browser-local storage on a publicly served static application, the threat/privacy model SHALL be documented before real data is entered.

## 20.3 Telemetry

Third-party analytics, session replay, or telemetry that could capture personal financial content SHALL be disabled by default during personal-MVP development unless explicitly reviewed and approved.

---

# 21. Repository architecture

Do not immediately rewrite the repository into dozens of packages.

The next architecture increment SHOULD establish the following target progressively:

```text
personal-finance-app/
│
├── apps/
│   └── web/
│
├── packages/
│   ├── model/
│   │   └── src/
│   │
│   ├── engine/
│   │   └── src/
│   │       ├── values/
│   │       ├── time/
│   │       ├── identity/
│   │       ├── rules/
│   │       ├── primitives/
│   │       ├── dependencies/
│   │       ├── semantics/
│   │       ├── funding/
│   │       ├── accounting/
│   │       ├── state/
│   │       ├── valuation/
│   │       ├── statements/
│   │       ├── lineage/
│   │       └── simulation/
│   │
│   ├── application/
│   │   └── src/
│   │
│   └── testing/
│       ├── fixtures/
│       └── golden/
│
├── docs/
│   ├── architecture/
│   │   ├── system-software-architecture.md
│   │   └── adr/
│   │
│   ├── slices/
│   └── generated/
│
├── tools/
├── .github/
│   └── workflows/
├── AGENTS.md
├── package.json
└── README.md
```

Use plain npm workspaces initially.

Do NOT introduce Turborepo, Nx, Bazel, or other monorepo orchestration until build complexity justifies it.

---

# 22. Near-term repository migration

The current repository SHALL be migrated incrementally.

Do not perform a single massive restructuring PR.

Recommended migration:

```text
Current
src/kernel.ts
src/verticalSlice1.ts
src/webApp.ts

        ↓

Step 1
architecture/governance baseline

        ↓

Step 2
canonical exact values + time + units + identity

        ↓

Step 3
shared semantic/accounting/funding contracts

        ↓

Step 4
authoritative state + run context + versioning

        ↓

Step 5
engine module boundaries

        ↓

Step 6
primitive runtime + multi-period engine

        ↓

Step 7
npm workspaces when module boundaries justify them

        ↓

Step 8
apps/web + packages/*
```

Every behavior-preserving refactor SHALL preserve existing valid golden behavior.

Do not first extract the current bigint-cent implementation as the long-term shared `Money` abstraction and then immediately replace it in a later milestone.

---

# 23. Web architecture

The current GitHub Pages UI SHALL remain a valid walking skeleton during engine development.

The UI correctly follows an important architectural rule:

```text
UI inputs
   ↓
financial engine
   ↓
result
   ↓
rendering
```

The UI SHALL NOT recreate financial calculations.

## 23.1 Current stage

Continue using the existing minimal browser UI while the engine architecture stabilizes.

Only synthetic/demo data SHALL be embedded into the public static application.

## 23.2 Personal-MVP stage

At the UI modernization milestone, adopt a typed React application.

Default target:

```text
React
+
a mature TypeScript full-stack web framework
```

The default architectural direction is Next.js unless a later ADR identifies a compelling reason for an alternative.

The core engine SHALL remain framework-independent.

## 23.3 UI responsibilities

UI is responsible for:

- input collection;
- validation presentation;
- editing financial objects;
- scenario configuration;
- displaying forecasts;
- charts;
- tables;
- explanations/lineage visualization.

UI is NOT responsible for:

- tax formulas;
- amortization;
- accounting;
- settlement funding rules;
- statement reconciliation;
- primitive evaluation;
- investment-return calculations.

---

# 24. Application layer

The UI SHALL interact with application-level use cases rather than low-level engine internals.

Examples:

```text
CreateHouseholdModel
UpdateIncome
UpdateExpense
RunProjection
CompareScenarios
ImportModel
ExportModel
GetNetWorthSeries
GetCashFlowSeries
ExplainProjectionValue
```

This layer provides a stable boundary between the financial engine and any delivery mechanism.

Application use cases SHALL validate/normalize boundary input before passing canonical values into the engine.

---

# 25. Model document, versioning, and compatibility

The repository already contains a model-instance schema and specification-version metadata. The architecture SHALL formalize and extend that existing model format rather than invent a second unrelated `pfm-model-v1` format later.

The portable model envelope SHALL distinguish at minimum:

```text
model_format_version
financial_specification_version
model_id
objects
```

Simulation/run output SHALL separately identify:

```text
engine_version
result_schema_version
financial_specification_version
model_format_version
run_id
scenario_id
seed (if applicable)
asOf
dataCutoff
input fingerprint
```

## 25.1 Compatibility policy

The application SHALL define whether a model version is:

```text
supported directly
migratable
read-only legacy
unsupported
```

Loading an older personal model SHALL not silently reinterpret fields according to newer semantics.

Explicit migration functions SHALL be used when model-format changes require transformation.

A user's complete model SHALL remain exportable independently of the UI implementation.

---

# 26. Persistence phases

Persistence SHALL be introduced in stages.

## Phase A — Engine prototype

No production database.

Inputs live in:

- test fixtures;
- typed objects;
- validated JSON model files.

## Phase B — Personal MVP

Support:

- validated model import;
- validated model export;
- explicit chosen local persistence if useful;
- model-version migration where required.

This permits real personal usage before introducing a server.

## Phase C — Private alpha

Introduce PostgreSQL.

PostgreSQL is the canonical persistence technology unless an ADR changes this decision.

The existing PostgreSQL document SHALL be reconciled against the canonical model before becoming an executable migration.

It SHALL NOT simply be applied to a production database in its current generated form.

---

# 27. PostgreSQL strategy

Production schema SHALL be managed through versioned migrations.

Preferred implementation direction:

```text
PostgreSQL
+
thin TypeScript data-access layer
+
SQL-oriented migration tooling
```

A SQL-oriented TypeScript tool such as Drizzle is preferable to allowing a high-level ORM schema to become the new financial source of truth.

Database types SHALL follow canonical precision.

Financially authoritative historical records SHOULD favor append-only or immutable semantics.

Schema migration/version identity SHALL remain distinct from financial model-format version identity.

---

# 28. Persistence model

Persistence SHALL distinguish:

## 28.1 Model configuration

Examples:

- people;
- households;
- accounts;
- income definitions;
- expense definitions;
- liabilities;
- assumptions;
- planned events;
- tax rules.

## 28.2 Actual historical facts

Examples:

- imported transactions;
- observed balances;
- actual market observations;
- actual employment payments.

Actual historical facts SHALL retain provenance and idempotency/source identity where available.

## 28.3 Accounting history

Posted transactions and legs.

## 28.4 Simulation configuration

Scenario and primitive instances.

## 28.5 Simulation results

Simulation runs MAY be stored for:

- reproducibility;
- comparison;
- performance;
- audit/debugging.

Derived statements SHOULD generally remain reproducible and cacheable rather than canonical.

Optional calculation traces MAY be stored separately or regenerated when practical.

---

# 29. Database-state philosophy

The application SHALL NOT adopt indiscriminate event sourcing.

It SHALL use:

- immutable/append-oriented financial history where appropriate;
- explicit effective-dated model facts;
- derived current-state views;
- optional snapshots or caches for performance.

The accounting ledger may naturally be append-only without requiring the entire application to become an event-sourced system.

---

# 30. Authentication and multi-user architecture

Authentication SHALL NOT be introduced solely to complete the financial engine.

It becomes mandatory before use by friends or family through a shared deployed service.

The private-alpha data model SHALL introduce:

```text
User
   ↓
HouseholdMembership
   ↓
Household
   ↓
Financial data
```

This authorization graph SHALL remain separate from domain economic ownership as defined in Section 19.

Financial objects SHALL be scoped to a household or another explicit authorization boundary.

Never assume:

```text
User = Household
User = Person
User = economic owner
```

---

# 31. Authorization

Before private-alpha deployment:

Every query and mutation SHALL be authorization-scoped.

Database-level row-security policies SHOULD provide defense in depth when the selected PostgreSQL platform supports them.

Automated tests SHALL prove:

```text
User A cannot read Household B
User A cannot update Household B
User A cannot infer Household B through identifiers
```

This is a release-blocking invariant.

---

# 32. Secrets

Secrets SHALL never enter:

- repository source;
- browser bundles;
- fixture files;
- screenshots;
- committed `.env` files.

CI and deployment secrets SHALL use platform secret storage.

---

# 33. Bank connectivity

Bank aggregation SHALL NOT be implemented in the current engine stage.

Recommended sequence:

```text
Manual input
    ↓
Validated model import/export
    ↓
CSV transaction import
    ↓
Personal usefulness validation
    ↓
Bank aggregation
```

Bank integrations introduce an independent complexity domain:

- OAuth;
- token lifecycle;
- institution outages;
- transaction reconciliation;
- pending/posted states;
- duplicates;
- account matching;
- webhooks;
- security requirements.

The identity/provenance contracts needed for eventual imports SHALL be established early even though the integrations themselves are deferred.

---

# 34. AI architecture

AI SHALL remain outside the deterministic financial engine.

Correct architecture:

```text
Natural-language request
        ↓
AI interpretation
        ↓
Structured financial-model or scenario operation
        ↓
Deterministic financial engine
        ↓
Structured result + lineage
        ↓
AI explanation
```

Incorrect architecture:

```text
LLM
 ↓
invent final retirement number
```

AI MAY assist with:

- categorization;
- model entry;
- natural-language queries;
- scenario creation;
- result explanation.

AI SHALL NOT become the source of authoritative financial arithmetic.

Where AI explains a numeric result, the explanation SHOULD be grounded in deterministic engine outputs and available calculation lineage.

---

# 35. Technology baseline

## Retain now

- TypeScript
- strict TypeScript compiler configuration
- ES modules
- Vitest
- npm lockfile
- GitHub Actions
- GitHub Pages walking skeleton

## Add during architecture consolidation

- canonical arbitrary-precision decimal abstraction
- canonical time/value/unit/identity modules
- ESLint
- formatter
- property-testing library
- specification-conformance checks
- typed diagnostics

Add npm workspaces only when module boundaries have stabilized enough to justify package extraction.

## Add for personal MVP

- React-based application shell
- charting library
- structured form validation
- explicit local model persistence/import/export
- browser/end-to-end tests for critical personal workflows

## Add for private alpha

- PostgreSQL
- migration tooling
- managed authentication
- server-side application layer
- comprehensive end-to-end testing
- error monitoring
- structured logging with financial-data redaction
- backups

---

# 36. TypeScript standards

The existing strict settings SHALL remain enabled.

At minimum:

```text
strict
noUncheckedIndexedAccess
exactOptionalPropertyTypes
forceConsistentCasingInFileNames
```

Production engine code SHALL avoid:

- `any`;
- untyped JSON passing through the engine;
- unchecked type assertions;
- bare stringly-typed financial operations;
- bare `number` for authoritative money/rate values.

External data SHALL be validated at system boundaries before entering canonical domain objects.

Serialization contracts SHALL be explicit for decimal financial values, UUIDs, and temporal values.

---

# 37. Dependency rule

Dependencies SHALL point inward.

Conceptually:

```text
UI
 ↓
Application
 ↓
Engine orchestration
 ↓
Financial domain modules
 ↓
Values / time / identity
```

Adapters may depend on engine/application interfaces.

Engine code SHALL never import application/UI/persistence modules.

Rules/policies SHALL be consumed through explicit engine-domain contracts rather than by importing UI or persistence implementations.

---

# 38. Error and diagnostic architecture

Generic error strings SHALL progressively be replaced by typed diagnostic objects.

Example:

```ts
interface ValidationIssue {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  entityType?: string;
  entityId?: string;
  fieldPath?: string;
  period?: string;
  traceId?: string;
}
```

Stable diagnostic codes enable:

- UI presentation;
- automated testing;
- logs;
- analytics;
- future API clients;
- lineage/explanation links.

Diagnostics SHALL distinguish at least:

```text
invalid model/semantic error
modeled financial stress/constraint
warning
informational condition
```

A modeled liquidity shortfall SHALL not be reported with the same semantic category as a corrupted dependency graph.

---

# 39. Validation layers

Validation SHALL occur at multiple layers.

## Structural validation

Is the model syntactically valid?

## Referential validation

Do referenced entities exist?

## Domain validation

Are values financially and contractually meaningful?

## Temporal validation

Are dates and periods coherent?

## Unit/value validation

Are currencies, rates, quantities, and units compatible?

## Dependency validation

Is the execution graph valid?

## Rule validation

Are effective rules/policies applicable and resolvable?

## Funding/constraint validation

Are funding sources/policies valid, and are constraint outcomes handled explicitly?

## Accounting validation

Do postings balance by currency?

## State validation

Are prohibited balances or ownership states created?

## Simulation invariants

Does the period reconcile?

## Model-version validation

Can the model format/specification versions be interpreted by the current engine?

---

# 40. Mandatory financial and execution invariants

Examples include:

```text
Assets - Liabilities = Net Worth
```

```text
Total debits = Total credits
```

per transaction and currency.

```text
Opening committed state + accepted posted effects = Closing committed state
```

Pure owned-account transfers SHALL preserve consolidated household net worth.

Settlement SHALL NOT re-recognize the underlying income or expense.

Outstanding obligation balance SHALL equal:

```text
original recognized amount
- valid settlements
- explicit adjustments/write-offs
```

A failed/uncommitted period SHALL NOT mutate committed opening state.

Identical deterministic inputs SHALL produce identical observable output.

No economic resource SHALL be counted twice through overlapping account/position/asset aggregation.

A generated one-time occurrence SHALL not execute twice under retry/re-evaluation.

An externally imported fact with the same idempotency/source identity SHALL not create duplicate authoritative history.

An incomplete run SHALL not claim to have reached its requested simulation horizon.

No implicit funding SHALL occur without a declared policy.

---

# 41. Testing strategy

Financial testing is a first-class product capability.

## Layer 1 — Value/time/identity tests

Examples:

- decimal arithmetic;
- money parsing;
- currency compatibility;
- rounding;
- rate conversion;
- date periods;
- half-open boundaries;
- deterministic occurrence IDs;
- idempotency keys.

## Layer 2 — Primitive tests

Every P01–P34 primitive SHALL eventually have:

- canonical tests;
- edge cases;
- boundary cases;
- state-transition tests if stateful;
- unit/type compatibility tests;
- lineage propagation tests where appropriate.

## Layer 3 — Accounting tests

Examples:

- balanced transactions;
- transfers;
- recognition;
- settlement;
- valuation;
- gain/loss.

## Layer 4 — Funding/constraint tests

Examples:

- sufficient cash;
- insufficient cash with no funding policy;
- permitted partial settlement;
- explicit savings fallback;
- explicit borrowing fallback;
- prohibited negative cash;
- obligation remains outstanding after failed settlement.

## Layer 5 — Invariant/property tests

Use generative/property testing for invariants.

Examples:

- account transfer preserves consolidated assets;
- zero-rate loan produces principal/term payment;
- settlements cannot exceed outstanding obligations without explicit policy;
- transaction posting preserves debit/credit equality;
- retrying an occurrence does not duplicate recognition;
- incompatible currencies/units cannot be silently combined.

## Layer 6 — Golden scenarios

Maintain complete household scenarios with known expected outcomes.

Existing golden tests SHALL remain.

Golden scenarios SHOULD grow to include:

1. employed single household;
2. dual-income household;
3. homeowner with mortgage;
4. investment-heavy household;
5. retired household;
6. liquidity-shortfall household.

## Layer 7 — Multi-period integration tests

Validate:

- state rollover;
- recurring flows;
- growth;
- inflation;
- amortization;
- annual boundaries;
- scenario changes;
- `asOf` transition;
- incomplete-run behavior;
- funding policies.

## Layer 8 — Model-format/migration tests

Validate:

- model schema;
- old-version migration;
- unsupported-version diagnostics;
- round-trip export/import;
- decimal-string preservation.

## Layer 9 — Persistence integration tests

Once PostgreSQL is introduced:

- migrations;
- repository queries;
- decimal round trips;
- transaction atomicity;
- authorization;
- source/idempotency uniqueness.

## Layer 10 — End-to-end tests

Once personal MVP has a real application shell:

- create model;
- edit model;
- run forecast;
- save/reload;
- export/import;
- compare scenarios;
- inspect explanation/lineage;
- clearly display incomplete projections.

## Layer 11 — Security tests

Before private alpha:

- cross-household access;
- unauthorized mutations;
- session boundaries;
- deletion/export;
- logging/redaction checks.

---

# 42. Golden Household strategy

Maintain deterministic synthetic fixtures under a dedicated testing area.

The principal Golden Household SHALL eventually include:

```text
2 people
employment income
checking
savings
retirement accounts
brokerage
ordinary expenses
home
mortgage
tax
insurance
retirement event
```

Expected checkpoints SHOULD include:

```text
Month 1
Year 1
Year 5
Year 10
Retirement date
Long-term horizon
```

Golden files SHALL test economic outcomes, not incidental internal implementation shape.

Golden households SHALL never contain real personal financial data.

At least one golden scenario SHALL intentionally encounter insufficient liquidity and assert the declared funding/constraint semantics.

---

# 43. Test philosophy

Tests SHALL verify the specification.

Tests SHALL NOT simply snapshot whatever the current implementation happens to produce.

When implementation and a reviewed specification disagree:

1. determine which is wrong;
2. update the wrong artifact;
3. document intentional semantic changes.

Never automatically update golden expected values merely to make CI green.

A behavior-preserving refactor SHALL demonstrate that the observable golden outcomes remain equivalent.

---

# 44. Continuous integration and repository hygiene

The existing sequence:

```text
npm ci
npm run typecheck
npm test
npm run build:web
```

SHALL remain the minimum merge gate until additional scripts are introduced.

Architecture evolution SHOULD add:

```text
npm run lint
npm run format:check
npm run spec:validate
npm run test
npm run test:golden
npm run typecheck
npm run build
```

Once persistence exists:

```text
npm run test:db
```

Once the full UI exists:

```text
npm run test:e2e
```

Deployment SHALL only occur after verification succeeds.

## 44.1 Immediate repository hygiene

The architecture-baseline PR SHALL also direct the following repository cleanup in its implementation checklist:

- add a `.gitignore` appropriate for macOS/Node/build outputs/local secrets;
- remove tracked `.DS_Store` artifacts;
- replace the placeholder README with project/build/architecture guidance;
- remove obsolete CI branch triggers left over from merged feature branches;
- ensure CI remains targeted to `main` and pull requests unless a specific active branch requires otherwise.

These are low-risk foundation tasks and SHOULD occur before agent-assisted implementation expands the repository.

---

# 45. Branch and PR policy

Use:

```text
main
```

as the releasable integration branch.

Use short-lived branches such as:

```text
docs/architecture-baseline
feat/canonical-financial-values
feat/multi-period-engine
feat/investment-slice
refactor/engine-boundaries
```

Prefer small PRs.

A PR SHOULD have one principal architectural or product purpose.

Financial semantic changes SHOULD include:

- specification changes;
- implementation;
- tests;
- golden changes where intentionally required.

Architecture/governance PRs SHOULD avoid unrelated executable financial behavior changes.

---

# 46. Merge policy

Before the project has multiple contributors, heavyweight bureaucracy is unnecessary.

Recommended:

- require CI;
- squash merge feature PRs;
- delete merged branches;
- do not commit unfinished experiments directly to `main`;
- keep `main` continuously usable.

---

# 47. Architecture Decision Records

Create:

```text
docs/architecture/adr/
```

Initial ADRs:

```text
ADR-001  Specification authority hierarchy
ADR-002  Modular monolith architecture
ADR-003  TypeScript financial engine
ADR-004  Exact decimal financial arithmetic and units
ADR-005  Half-open temporal intervals and asOf boundary
ADR-006  Deterministic simulation
ADR-007  Transaction subsystem owns accounting postings
ADR-008  Identity and idempotency model
ADR-009  Liquidity/funding/constraint semantics
ADR-010  Calculation lineage and explainability
ADR-011  Portable model versioning and compatibility
ADR-012  PostgreSQL as future durable store
ADR-013  Scenario overlay/inheritance model
ADR-014  AI outside deterministic financial engine
ADR-015  User/membership identity separate from economic ownership
```

Later:

```text
ADR-016  Web framework
ADR-017  Personal persistence mode
ADR-018  Authentication provider
ADR-019  Database access/migration library
ADR-020  Financial-data aggregation provider
```

Do not prematurely decide later ADRs unless implementation requires them.

---

# 48. Development maturity stages

## Stage 0 — Financial specification

**Current status:** substantially complete but evolving.

Outputs:

- object model;
- primitive model;
- variable mappings;
- executable semantics.

## Stage 1 — Executable engine

**Current status:** in progress.

Goal:

> Given an authoritative household model and scenario, reliably produce deterministic financial state, transactions, statements, explanations, and time-series output.

No production database required.

## Stage 2 — Personal MVP

Goal:

> The developer can model their actual household, preserve/export the model, run a useful long-term projection, inspect/explain results, and compare scenarios.

Required:

- usable model editor;
- multi-period projection;
- investment/debt support;
- explicit personal persistence choice;
- save/load/export;
- charts;
- scenario comparison;
- actual-versus-forecast boundary;
- visible liquidity-shortfall handling;
- model-version compatibility.

Authentication is optional if the app remains strictly local/private and not shared through a multi-user service.

## Stage 3 — Private alpha

Goal:

> Friends and family can each safely maintain their own financial model.

Required:

- authentication;
- PostgreSQL;
- household authorization;
- ownership/access separation;
- backups;
- server-side persistence;
- auditability;
- privacy controls;
- basic monitoring.

## Stage 4 — Public production

Adds:

- hardened security;
- support workflows;
- recovery procedures;
- production observability;
- compliance/legal analysis;
- data lifecycle controls;
- infrastructure reliability.

## Stage 5 — Commercial service

Only then consider:

- subscriptions;
- billing;
- bank aggregation at commercial scale;
- formal compliance programs;
- business analytics;
- customer support tooling.

---

# 49. Personal MVP functional gate

The project SHALL not be considered a usable personal MVP until a household can answer:

## Current state

- What do I own?
- What do I owe?
- What is my net worth?
- What is my cash flow?
- Where is my money?
- What facts are actual as of the current model date?

## Forecast

- What happens if nothing changes?
- How does net worth evolve?
- When/why does liquidity become insufficient?
- How do assets/liabilities evolve?
- What happens around retirement?
- Did the projection actually reach the requested horizon?

## Scenarios

- What if income changes?
- What if expenses change?
- What if returns are lower?
- What if inflation is higher?
- What if retirement occurs earlier?
- What if a major asset/debt is added?

## Explainability

For material outputs, the application SHOULD be able to answer:

- Which assumptions produced this value?
- Which rules were applied?
- Which source facts were used?
- Which scenario difference changed the result?

---

# 50. What NOT to build yet

The current project SHALL avoid premature introduction of:

- microservices;
- Kubernetes;
- Kafka/event buses;
- native mobile clients;
- commercial billing;
- complex RBAC;
- real-time market infrastructure;
- exhaustive tax-law implementation;
- full bank aggregation;
- machine-learning systems;
- elaborate DevOps;
- data warehouses.

The architecture should permit these later without requiring them now.

---

# 51. Immediate architectural findings from the current repository

The current slice demonstrates several correct architectural choices:

- domain inputs drive results;
- financial logic is callable independently of UI;
- state is cloned before mutation;
- transactions are balanced;
- obligations have lifecycle identity;
- statements are derived;
- same-period tests are deterministic;
- deferred settlement works across periods;
- UI uses the same financial logic.

The next work SHOULD preserve these behaviors.

The current repository also exposes immediate contradictions that SHALL be resolved by architecture consolidation:

- `kernel.ts` and `verticalSlice1.ts` duplicate core values/time/accounting/state concepts;
- runtime money/rate representations are inconsistent with the canonical decimal specification;
- mortgage helpers cross through JavaScript floating point;
- cash-insufficiency behavior differs between the two executable paths;
- generated simulation interfaces use `number` for financial values despite canonical exact-decimal requirements;
- generated PostgreSQL remains a design artifact rather than a production migration;
- public GitHub Pages is suitable for synthetic demonstration, not embedded real personal data;
- README/repository hygiene remain minimal.

---

# 52. Immediate technical debt to resolve

Before substantially expanding features, address:

## 52.1 Duplicate core concepts

`kernel.ts` and `verticalSlice1.ts` contain independent definitions of:

- Money;
- Period;
- account state;
- liabilities;
- accounting legs;
- transactions;
- balance validation.

These SHALL converge through the canonical foundation and shared contracts.

## 52.2 Financial numeric inconsistency

Canonical specification uses explicit decimal precision while current generated/runtime TypeScript paths still use bigint cents and/or `number` rates.

The canonical exact-value/rate/unit foundation SHALL be introduced before module expansion.

## 52.3 Floating-point mortgage arithmetic

Mortgage helpers SHALL migrate to the canonical decimal/rate system before becoming production financial mechanics.

## 52.4 Liquidity semantics inconsistency

The existing executable paths disagree about negative cash/insufficient funds.

The unified engine SHALL implement the explicit funding/constraint semantics from Section 14.

## 52.5 Generated PostgreSQL inconsistencies

The existing SQL file SHALL undergo schema reconciliation before executable migrations are created.

## 52.6 Model-format ambiguity

The existing model schema SHALL be formalized as the basis of the portable personal-model format; a second unrelated model format SHALL not be introduced later.

## 52.7 Generated identity/idempotency

Recurring/generated simulation effects SHALL receive deterministic occurrence identity before multi-period execution becomes authoritative.

## 52.8 Explainability gap

Primitive and statement contracts SHALL permit calculation lineage before P01–P34 implementation expands substantially.

## 52.9 Prototype UI coupling

The current browser demo uses fixed demo IDs and a fixed January 2026 period.

This is acceptable for Vertical Slice 1 but SHALL be replaced by application-level use cases before becoming personal-MVP architecture.

---

# 53. Exact implementation sequence

The following order is the recommended Codex execution roadmap.

---

## PR 1 — Architecture and governance baseline

**Goal:** establish governing project instructions without changing executable financial behavior.

Create:

```text
docs/architecture/system-software-architecture.md
docs/architecture/adr/ (initial ADRs may be introduced incrementally)
AGENTS.md
docs/spec-manifest.json (or equivalent)
```

Improve repository hygiene:

```text
README.md
.gitignore
.github/workflows/test.yml
```

Tasks:

- document source-of-truth hierarchy;
- document exact-value/time/identity/funding/lineage requirements;
- document build/test commands;
- document current Vertical Slice 1 usage;
- identify generated artifacts as non-authoritative until reconciled;
- remove tracked `.DS_Store`;
- remove obsolete merged-feature CI branch trigger;
- add specification-conformance scaffold.

**No executable financial behavior changes.**

---

## PR 2 — Canonical value, time, unit, and identity foundation

**Goal:** introduce the final foundational direction once, avoiding a temporary shared bigint-cent architecture followed by a second refactor.

Introduce canonical abstractions for:

```text
DecimalAmount
Money + Currency
Rate + RateBasis
Quantity + Unit
RoundingPolicy
CivilDate
Instant
Period
UUID/domain IDs
GeneratedOccurrenceKey
IdempotencyKey
```

Requirements:

- no bare floating-point money arithmetic;
- no bare floating-point authoritative financial rates;
- deterministic rounding;
- decimal-string serialization;
- half-open temporal boundaries;
- canonical test vectors;
- deterministic identity test vectors.

Migrate both `kernel.ts` and Vertical Slice 1 onto these foundations.

Migrate mortgage helpers off floating point.

Existing valid golden financial outcomes MUST remain equivalent.

---

## PR 3 — Shared semantic, accounting, funding, and diagnostic contracts

Extract and unify:

```text
RecognitionFact
Obligation / Right
SettlementProposal
Settlement
SemanticEffect
AccountingLeg
AccountingTransaction
CashFlowClass
ValidationIssue
FundingPolicy
ConstraintOutcome
LiquidityShortfall
CalculationTrace reference contracts
```

Requirements:

- only accounting subsystem creates authoritative posted accounting legs;
- no silent negative-cash policy;
- insufficient funding follows explicit constraint semantics;
- duplicate transaction/recognition/settlement checks use stable identity;
- Vertical Slice 1 successful-case outcomes remain equivalent.

---

## PR 4 — Authoritative state, run context, model versioning, and provenance

Unify:

```text
accounts
positions
liabilities
obligations
posted transaction identities
generated occurrence identities
```

Separate:

```text
authoritative state
derived outputs
semantic facts
actual/observed facts
model-generated forecast facts
```

Introduce:

```text
asOf
dataCutoff
run ID
engine/spec/model/result versions
input fingerprint
run completion status
partial-horizon result semantics
provenance metadata
```

Formalize the existing model schema as the portable model-format basis and add compatibility/migration contracts.

---

## PR 5 — Engine module boundaries

Refactor monolithic source files into logical internal boundaries:

```text
values/
time/
identity/
model/
rules/
primitives/
dependencies/
semantics/
funding/
accounting/
state/
valuation/
statements/
lineage/
simulation/
```

Do not introduce database functionality.

Do not rewrite the UI except as required to preserve the existing demo.

Existing tests MUST pass.

---

## PR 6 — Primitive runtime registry

Create executable registry for P01–P34.

At minimum fully implement primitives required by existing/current slices.

Each primitive receives:

```text
typed input
typed parameters
explicit state
evaluation context
rule references where applicable
trace context where enabled
```

and returns:

```text
value
next primitive state if applicable
semantic effects
diagnostics
lineage references where enabled
```

Primitive evaluation SHALL NOT directly post transactions or mutate authoritative state.

---

## PR 7 — Multi-period simulation

Build:

```text
runPeriod()
runTimeline()
```

Requirements:

- month-to-month state rollover;
- half-open boundaries;
- explicit `asOf`/forecast boundary;
- deterministic ordering;
- simulation metadata;
- period-level time series;
- failed-period atomicity;
- explicit completed/incomplete/invalid-model outcome;
- deterministic occurrence identity;
- no duplicate one-time/recurring generated effects under retry;
- explicit liquidity/constraint behavior.

Golden scenarios:

```text
12 consecutive normal months
12-month path with a liquidity shortfall
```

---

## PR 8 — Vertical Slice 2: growing household cash flow

Implement:

- recurring income;
- recurring expenses;
- salary growth;
- inflation-adjusted expense growth;
- start/end dates;
- event-driven start/stop;
- multi-year projection;
- actual-versus-forecast display inputs;
- explainability for major projected cash-flow values.

This slice proves the primitive, run, funding, and lineage architecture.

Target useful horizon:

```text
30 years
```

without yet requiring investment/debt complexity.

---

## PR 9 — Vertical Slice 3: savings and investments

Implement:

- cash accounts;
- investment accounts;
- contributions;
- internal transfers;
- positions;
- market valuation;
- deterministic returns;
- fees where simple;
- investment income/gain semantics as defined by specification;
- explicit funding use of savings/investments only when configured.

Validate:

```text
account value
portfolio value
household assets
net worth
```

without double-counting account containers and positions.

---

## PR 10 — Vertical Slice 4: liabilities

Implement:

- loan principal;
- interest accrual;
- fixed-rate amortization;
- scheduled payment;
- extra payment;
- payoff;
- mortgage mechanics;
- contract-driven missed/partial payment behavior where supported.

Add zero-rate, early-payoff, and insufficient-funding property tests.

---

## PR 11 — Rules/policy expansion

Replace prototype/ad-hoc financial policies with explicit rule implementations where needed for personal usefulness.

Initial scope MAY include:

- simplified income tax;
- contribution limits;
- simple account/product rules;
- basic fees.

Rules SHALL be effective-dated and identifiable in calculation lineage.

A comprehensive tax-law engine remains out of scope.

---

## PR 12 — Scenario engine

Implement baseline and scenario overlays.

Support scenario comparison for:

- income growth;
- expense inflation;
- investment returns;
- retirement date;
- large purchases;
- debt changes;
- funding policies where appropriate.

Output comparable time-series structures and identify the assumption/rule differences that explain material result changes.

---

## PR 13 — Personal model import/export and migration

Implement the already-defined portable model envelope in application workflows.

Provide:

```text
validate
import
export
migrate-version
```

A user's complete personal model SHALL be exportable without relying on the UI.

This PR operationalizes the versioning foundation from PR 4; it SHALL NOT invent a second model format.

---

## PR 14 — Personal MVP UI

Replace the demo form with a real model editor.

Implement views for:

```text
Household
People
Accounts
Income
Expenses
Assets
Liabilities
Investments
Assumptions
Scenarios
```

Dashboard:

```text
Net worth
Cash flow
Assets
Liabilities
Forecast
Scenario comparison
Actual vs projected boundary
Liquidity/shortfall indicators
Explanation/lineage drill-down
```

The UI SHALL call application use cases only.

---

## PR 15 — Personal persistence

Choose and document the personal persistence mode via ADR before implementation.

Implement local save/load or equivalent persistence suitable for personal use.

Support explicit full-model export and recovery.

Apply personal-data boundary rules from Section 20.

At this point the application SHOULD be used with real personal data before backend expansion.

---

# 54. Personal-use stabilization period

After PR 15:

Do not immediately add PostgreSQL or bank connectivity.

Use the application with real personal data under the defined privacy boundary.

Record:

- missing financial concepts;
- confusing UX;
- incorrect forecasts;
- unexplained results;
- liquidity/funding cases not handled well;
- slow workflows;
- unsupported real-world cases;
- required reports;
- model migration/recovery friction.

Drive subsequent priorities from actual usage.

---

# 55. Private-alpha implementation sequence

Only after the personal application is genuinely useful:

## PR A — Durable PostgreSQL schema

Reconcile canonical schema and generated DDL.

Create clean versioned migrations.

## PR B — Persistence ports/adapters

Implement repositories behind application interfaces.

## PR C — Authentication

Introduce managed authentication.

## PR D — Household authorization

Introduce HouseholdMembership and tenant isolation without conflating authentication identity with financial ownership.

## PR E — Security integration tests

Prove cross-household isolation and logging/redaction rules.

## PR F — Server deployment

Deploy web/application/database services.

## PR G — Backup/export/delete

Operational data lifecycle.

## PR H — CSV transaction import

Automate actual-data ingestion incrementally using source identity/idempotency and provenance contracts already established by the engine architecture.

Bank connectivity follows only if still valuable.

---

# 56. Definition of done for engine features

A financial-engine feature is complete only when:

- specification exists or has been updated;
- canonical exact value/unit/time types are used;
- financial units are explicit;
- temporal behavior is explicit;
- identity/idempotency behavior is explicit where events are generated/imported;
- funding/constraint behavior is explicit where settlement may fail;
- calculation is deterministic where intended;
- lineage can identify material source dependencies where applicable;
- tests cover normal cases;
- tests cover edge cases;
- invariants pass;
- golden scenarios pass;
- no financial formula is duplicated in UI;
- docs reflect meaningful semantic changes.

---

# 57. Definition of done for application features

An application feature is complete only when:

- application use case exists;
- domain validation exists;
- engine behavior is tested;
- UI handles validation and financial-stress diagnostics distinctly;
- incomplete projections cannot be mistaken for completed ones;
- data can be versioned/serialized if persistent;
- personal-data boundary rules are respected;
- authorization exists if multi-user;
- end-to-end path is tested where appropriate.

---

# 58. `AGENTS.md` specification

The repository SHALL contain an `AGENTS.md` approximately equivalent to the following:

```markdown
# Personal Finance App — Agent Instructions

## Purpose

This repository implements a deterministic personal-finance modeling and
simulation engine plus applications built around it.

Financial correctness, explainability, and specification conformance take
priority over implementation convenience.

## Sources of truth

Authority order:

1. Canonical financial specification
2. Executable financial-semantics specification
3. Vertical-slice specifications
4. Architecture Decision Records
5. Implementation
6. Generated artifacts

Never silently change financial meaning to make code easier to implement.

## Architecture

Dependencies point inward:

UI → Application → Engine → Domain/Values/Time/Identity

Financial engine code must not depend on UI, database, auth, hosting, or
external-service libraries.

Financial formulas must not be implemented in UI components.

Primitive evaluation produces values/effects and must not directly mutate
authoritative financial state.

Only the transaction/accounting subsystem creates posted accounting legs.

Statements and metrics are derived and must not be treated as authoritative
inputs.

## Financial arithmetic and units

Do not use JavaScript floating point for authoritative money calculations.

Do not introduce bare number-based financial rates.

Use canonical DecimalAmount, Money, Currency, Rate, RateBasis, Quantity, Unit,
and RoundingPolicy abstractions.

Rounding must be explicit.

Do not change rounding policy without tests and specification review.

## Time

All internal periods are half-open: [start, end).

Do not infer timezone, day-count basis, or rate basis.

Use canonical temporal utilities instead of ad-hoc Date arithmetic in engine
modules.

Preserve the explicit asOf/data-cutoff boundary between observed and modeled
facts.

## Identity and idempotency

Persistent entities use stable domain identities.

Generated recurring/one-time occurrences require deterministic occurrence
identity sufficient to prevent duplicate recognition/posting on retry.

Imported actual facts must preserve source identity/idempotency when available.

## Determinism

Identical deterministic inputs must produce identical observable results.

Never call Math.random() inside financial primitives.

Stochastic behavior must consume the project's seeded RandomSource.

## State and run completion

Period execution occurs on cloned/uncommitted state.

A failed/uncommitted period must not mutate committed opening state.

Do not expose partially updated state as an implicit dependency.

Do not present an incomplete simulation as if it reached the requested horizon.

## Funding and constraints

Never invent cash, borrowing, transfers, asset sales, overdraft, or other
funding behavior.

Funding behavior must come from explicit model/product/funding policy.

Insufficient liquidity can be a valid modeled outcome. Do not erase valid
recognition merely because settlement could not be funded.

## Accounting

Every posted transaction must balance by currency.

Settlement does not re-recognize the underlying income/expense.

Internal transfers between household-owned accounts must not change
consolidated household net worth.

Do not double-count account containers and underlying positions/assets.

## Explainability

Do not discard source/assumption/rule/primitive identity needed to explain
material derived values.

Where calculation lineage is enabled, propagate trace references through
compositions and derived outputs.

## Personal financial data

Never commit real personal financial information to the repository.

Golden/test fixtures must use synthetic data.

Do not place financial data in URLs, routine logs, screenshots, CI artifacts,
or public PR/issues.

Do not introduce telemetry that may capture financial content without explicit
review.

## Model versioning

Do not silently reinterpret old model files using new semantics.

Respect model-format/specification compatibility and use explicit migrations.

## Tests

Before completing a change run:

npm ci
npm run typecheck
npm test
npm run build:web

Run additional lint/spec/database/e2e commands once those scripts exist.

Every financial semantic change requires tests.

Never update golden expected values solely to make tests pass. Determine why
the result changed and verify the specification first.

## Change discipline

Prefer small PRs with one principal purpose.

Do not combine:
- repository restructuring,
- financial semantic changes,
- UI redesign,
- persistence migration

in one PR unless unavoidable.

Preserve existing behavior during refactors unless a reviewed specification
change intentionally changes behavior.

## Specifications

If implementation requires behavior not defined by the specifications, do not
invent it silently.

Either:
1. implement the existing explicit rule; or
2. update/propose the specification and test the new rule.

## Generated artifacts

Generated SQL, TypeScript, JSON Schema, and documentation are not independent
financial sources of truth.

Do not manually create conflicting definitions in generated and canonical
files.

## Security

Never commit secrets.

Never expose private financial data in logs.

Once multi-user persistence exists, all financial reads/writes must be scoped
to an authorized household.

Authentication identity must remain separate from domain economic ownership.

Cross-household isolation failures are release blockers.

## Scope control

Do not introduce microservices, distributed queues, Kubernetes, bank
aggregation, billing, or other production infrastructure unless required by
the current approved milestone.

The present development priority is:
correct engine → useful personal app → secure private alpha → production.
```

---

# 59. Codex operating procedure

For each implementation milestone, Codex SHOULD receive a bounded task.

Good task:

```text
Implement PR 7: multi-period simulation according to
`docs/architecture/system-software-architecture.md` and the executable
financial-semantics specification.

Requirements:
- preserve half-open periods and explicit asOf boundary;
- carry closing committed state into the next opening state;
- preserve failed-period atomicity;
- return explicit completed/incomplete/invalid-model run status;
- use deterministic generated-occurrence identity;
- apply explicit funding/constraint semantics rather than inventing negative cash;
- add normal and liquidity-shortfall multi-period golden scenarios;
- do not modify the UI except where required for compilation;
- run the full verification suite.
```

Bad task:

```text
Build the rest of the finance app.
```

---

# 60. Codex review procedure

For each PR, use Codex separately for:

1. implementation;
2. specification-conformance review;
3. test-gap review.

Example review prompt:

```text
Review this PR against:
- canonical schema;
- executable financial semantics;
- system/software architecture specification;
- relevant vertical-slice specification;
- AGENTS.md.

Focus on:
financial correctness,
implicit floating-point arithmetic,
unit/currency/rate-basis errors,
state mutation,
temporal/asOf boundary errors,
identity/idempotency errors,
accounting reconciliation,
implicit funding,
duplicate recognition,
scenario determinism,
model-version compatibility,
calculation-lineage loss,
missing edge-case tests,
personal-data leakage.

Do not suggest unrelated refactors.
```

---

# 61. Development loop

Every financial feature follows:

```text
DEFINE
  ↓
SPECIFY
  ↓
WRITE TEST VECTORS / INVARIANTS
  ↓
IMPLEMENT
  ↓
VERIFY
  ↓
INTEGRATE
  ↓
EXPLAIN / TRACE
  ↓
USE WITH REALISTIC SYNTHETIC DATA
  ↓
USE WITH PERSONAL DATA WHEN PRIVACY BOUNDARY IS READY
  ↓
REFINE SPECIFICATION
```

Avoid:

```text
prompt
  ↓
large code generation
  ↓
discover semantics afterward
```

---

# 62. Next recommended milestone

The immediate next milestone SHALL NOT be a database, authentication system, bank connection, or comprehensive UI rewrite.

The immediate next milestone is:

> **Architecture consolidation while preserving Vertical Slice 1 economic behavior.**

Specifically:

```text
PR 1  Architecture/governance baseline
PR 2  Canonical values/time/units/identity
PR 3  Shared semantic/accounting/funding contracts
PR 4  Authoritative state/run/version/provenance model
PR 5  Engine module boundaries
PR 6  Primitive runtime registry
PR 7  Multi-period simulation
```

Only after these foundation steps SHOULD the financial model expand into multi-period Vertical Slice 2.

---

# 63. Architectural success criterion

The architecture is succeeding when a new financial capability can be added by:

1. specifying its semantics;
2. expressing exact values/units/time explicitly;
3. composing or extending primitives;
4. generating semantic effects with stable identity;
5. resolving explicit funding/constraints where settlement applies;
6. translating accepted effects through the common accounting/state pipeline;
7. preserving enough lineage to explain material results;
8. testing the result with invariants and golden households;
9. exposing it through an application use case;
10. adding UI without duplicating financial logic.

The architecture is failing if each new feature requires:

- special-case calculations in the UI;
- direct balance mutation;
- duplicated money/date/identity implementations;
- bare floating-point financial arithmetic;
- implicit negative cash or funding assumptions;
- database-specific financial rules;
- duplicated generated occurrences;
- non-reproducible calculations;
- opaque numbers with no source/assumption lineage;
- silent reinterpretation of old model files;
- unreviewed semantic exceptions.

---

# 64. Governing principle

> Build the financial model as a deterministic, explainable product in its own right.  
> Build the personal application around that engine.  
> Preserve identity, provenance, model compatibility, and privacy before real personal data becomes valuable.  
> Add multi-user infrastructure only after the personal application is useful.  
> Add commercial infrastructure only after the multi-user product is safe and validated.
