# Personal Finance App — Personal MVP → Private Alpha Roadmap

**Status:** Normative architecture roadmap amendment  
**Applies after:** PR 14 — Personal MVP UI  
**Parent architecture:** `docs/architecture/system-software-architecture.md`  
**Purpose:** Correct the post-PR14 implementation sequence based on the actual merged engine/application state.

> This roadmap supersedes the post-PR14 ordering in Sections 48, 53, 54, and 62 of the parent architecture until the same text is folded into that document. The parent architecture remains authoritative for all other architectural rules.

## 1. Architectural finding after PR 14

PRs 8–12 built materially more engine capability than the Personal-MVP application can currently execute from the canonical portable model. PR 14 correctly avoided inventing translation semantics, so many visible UI surfaces are capability-gated even though corresponding VS2/VS3/VS4 engine functionality exists.

The missing architectural layer is an **Executable Model Compiler** inside the application boundary:

```text
Canonical portable personal model
              │
              ▼
┌─────────────────────────────────────┐
│       Executable Model Compiler     │
│                                     │
│ canonical validation               │
│ reference resolution                │
│ exact value / unit translation      │
│ assumption / primitive binding      │
│ capability diagnostics              │
│                                     │
│ cash-flow compiler ─────────→ VS2   │
│ investment compiler ────────→ VS3   │
│ liability compiler ─────────→ VS4   │
└─────────────────────────────────────┘
              │
              ▼
       Existing financial engine
```

The compiler is an **application-layer adapter**, not a second financial engine. It SHALL NOT contain independent financial formulas. It SHALL compile canonical user-authored semantics faithfully into existing executable contracts or return precise typed capability diagnostics.

The governing rule is:

> **Compile faithfully or capability-gate. Never guess, silently discard authored semantics, or fabricate defaults.**

The UI SHALL continue to depend only on application use cases. The compiler MAY depend on canonical model/value/time/rule contracts and public engine/simulation contracts. Engine modules SHALL NOT depend on the compiler or UI.

## 2. Personal-MVP completion strategy

The next development sequence SHALL prioritize making already-built engine capability reachable from the canonical Personal Model before adding substantial new UI or multi-user infrastructure.

Persistence remains a near-term Personal-MVP requirement, but SHALL follow the first executable-model compiler milestones so the app does not merely persist a model whose primary forecast surfaces remain unavailable.

The sequence is:

```text
PR 15  Executable-model compiler foundation + cash/current-position parity
PR 16  Canonical liability compiler → VS4
PR 17  Canonical investment compiler → VS3
PR 18  Personal persistence
PR 19  Broader executable scenarios and life-event bindings
PR 20  Reconciled household projection/orchestrator
PR 21  Personal-MVP stabilization, explanation, and golden household

THEN

Personal-use stabilization with real personal data

THEN

Private-alpha infrastructure
```

## 3. PR 15 — Executable-model compiler foundation

**Goal:** establish one authoritative canonical-model → executable-engine translation layer and remove the largest false-unavailability gaps in cash flow and current position.

### 3.1 Compiler architecture

Create an application-layer compiler boundary, naming as appropriate, with typed results conceptually like:

```ts
type CompileResult<T> =
  | { status: "compiled"; value: T; diagnostics: readonly Diagnostic[] }
  | { status: "unsupported"; diagnostics: readonly CapabilityDiagnostic[] }
  | { status: "invalid_model"; diagnostics: readonly ValidationIssue[] };
```

Compiler responsibilities:

- canonical structural/referential validation needed for execution;
- reference resolution;
- exact Money/Rate/Quantity/Time construction;
- canonical primitive/assumption/event binding where semantics are already defined;
- conversion to existing VS2/VS3/VS4 input contracts;
- stable source/trace references;
- typed capability diagnostics for unsupported canonical configurations.

Compiler non-responsibilities:

- inventing financial formulas;
- changing funding policy;
- silently choosing accounts or owners;
- assuming currency, rate basis, timezone, recurrence, event meaning, or tax treatment;
- modifying the portable model to fit an engine slice;
- combining independent slice outputs into a reconciled household forecast.

### 3.2 Cash-flow compiler parity

Move the PR-14 ad-hoc VS2 translation out of `personalMvp.ts` into the compiler boundary.

Expand canonical → VS2 translation only for semantics already defined by the canonical schema/executable specification and implemented by VS2, including where faithfully representable:

- monthly recurring income/expense;
- start/end dates;
- authored salary/income growth bindings;
- expense inflation/growth bindings;
- supported event-driven start/stop semantics;
- explicit funding-account/policy references;
- exact rate basis and temporal anchors;
- lineage references back to source objects/assumptions/events.

The merged synthetic example SHOULD become executable for cash-flow projection without deleting its authored semantics merely to satisfy the adapter.

Unsupported configurations SHALL still produce typed capability diagnostics.

### 3.3 Current-position compiler

Provide an authoritative current-position read model for supported canonical holdings.

Support, where canonical semantics are sufficient:

- cash/accounts;
- liabilities/current balances;
- current investment positions/values where authoritative current valuation exists;
- other assets with explicit current/valuation values defined by the specification;
- assets;
- liabilities;
- net worth;
- no account/position/asset double-counting.

Do not infer FX. Mixed-currency totals remain unavailable until explicit FX semantics exist.

### 3.4 PR 15 definition of done

- one compiler boundary exists and is architecture-enforced;
- PR-14 cash-flow translation no longer contains independent mapping logic in UI-facing orchestration;
- synthetic example can execute the supported cash-flow semantics it already authors;
- current Assets and Net Worth work for the Golden/Synthetic household where values are semantically available;
- unsupported semantics produce stable typed diagnostics, not generic strings where practical;
- compiler equivalence tests compare compiled runs to direct VS2 fixtures;
- no financial formula is duplicated in the compiler;
- no household-wide cross-slice aggregation is introduced.

## 4. PR 16 — Canonical liability compiler → VS4

**Goal:** make the Personal-MVP Debt surface execute the existing liability engine.

Compile supported canonical `Liability`/related configuration into VS4 `FixedAmortizingLoan` inputs.

Initial supported contract SHOULD include the semantics already implemented by VS4:

- fixed-rate loans;
- monthly payments;
- original/current principal;
- nominal/effective rate semantics only where canonical basis is explicit;
- origination/payment anchor;
- finite term/total payments;
- scheduled contractual payment;
- explicit funding policy/account;
- extra-principal payments;
- all-or-nothing insufficient-funding behavior currently supported by VS4;
- trace/provenance propagation.

Expose application read models sufficient for:

- balance over time;
- contractual payment;
- interest expense;
- scheduled principal;
- extra principal;
- ending principal;
- outstanding interest;
- payoff point;
- funding status and liquidity shortfall;
- explanation/trace refs.

Unsupported liability types/rate structures SHALL capability-gate individually rather than disabling all debt execution.

Do not add variable-rate, refinance, recast, delinquency, or other new debt semantics unless separately specified.

## 5. PR 17 — Canonical investment compiler → VS3

**Goal:** make the Personal-MVP Investments surface execute the existing investment engine.

Compile supported canonical Account/Investment/position/assumption/rule configuration into VS3.

Initial support SHOULD cover existing VS3 contracts where canonical model semantics are sufficient:

- owned cash/investment accounts;
- opening positions/quantities/values;
- internal transfers;
- contributions/purchases;
- deterministic returns;
- market valuation;
- simple fees/rule bindings;
- configured investment funding;
- exact quantity/rate/rounding behavior;
- trace/provenance propagation.

Expose application read models for:

- portfolio value;
- contribution principal;
- fees;
- unrealized gain;
- realized gain;
- cash investment income;
- account values;
- trace references;
- relevant liquidity/funding diagnostics.

Avoid double-counting account containers and their positions.

Do not introduce stochastic/Monte-Carlo returns in this PR.

## 6. PR 18 — Personal persistence

**Goal:** make the Personal MVP durable for actual personal use after its core model can execute meaningfully.

Before implementation, create/approve **ADR-017 — Personal persistence mode**.

For the static Personal MVP, prefer the smallest local-first persistence architecture that satisfies the documented privacy/recovery requirements. The ADR SHALL compare at minimum:

- IndexedDB/browser-local structured persistence;
- local file as primary persistence;
- encrypted local file/storage;
- server persistence.

Unless the ADR finds a concrete reason otherwise, do **not** introduce PostgreSQL, authentication, Supabase, or another server solely for PR 18.

Required capabilities:

- explicit save/load lifecycle;
- automatic or user-visible local persistence according to ADR;
- schema/model-format compatibility check on load;
- explicit migrations through PR-13 migration authority;
- atomic replacement so a failed migration/write does not destroy the last valid model;
- export remains a portable backup/recovery mechanism;
- clear reset/delete-local-data operation;
- session/run settings persistence only if explicitly covered by the ADR;
- no real data in Git, CI, telemetry, URLs, logs, screenshots, or static bundle;
- browser E2E tests for save → reload → recover/export.

Persistence SHALL store the portable canonical model, not engine-specific compiled inputs or derived forecast results as new authority.

## 7. PR 19 — Broader executable scenarios and life-event bindings

**Goal:** connect the scenario engine and canonical model to the friendly `What If?` / life-event UX beyond the current single 3% income-growth example.

Use the compiler boundary established in PR 15 and the VS3/VS4 adapters from PRs 16–17.

Support executable scenario changes already implemented by the scenario engine, where the base model compiles safely:

- income growth;
- expense inflation;
- investment return;
- retirement-date modification;
- investment-purchase add/replace/remove;
- extra-principal-payment add/replace/remove;
- expense funding-policy change;
- loan funding-policy change;
- fee-rule binding.

Translate canonical Event/Scenario/Assumption references only where their semantics are explicit.

The UI SHOULD expose user-language starters such as:

```text
Retire earlier/later
Earn more/less
Spend more/less
Change investment returns
Pay debt faster
Change funding behavior
```

Scenario comparison SHALL preserve configuration/rule/assumption differences and trace refs.

Do not emulate unsupported stochastic scenarios.

## 8. PR 20 — Reconciled household projection/orchestrator

**Goal:** provide one authoritative long-term household projection capable of supporting the Overview financial-outlook and projected-net-worth experience.

This is **not** a UI aggregation PR.

Introduce an engine/application orchestration contract that establishes one authoritative period ordering and state transition across the applicable cash-flow, investment, and liability mechanics.

The orchestrator SHALL define and test:

- one opening authoritative household state;
- one run context and horizon;
- one deterministic period ordering;
- cash-flow recognition/settlement ordering;
- investment transfer/purchase/valuation ordering;
- liability accrual/payment ordering;
- explicit funding interactions across supported sources;
- closing valuation;
- statements/net worth after all accepted effects;
- no double counting of account/position/asset values;
- one completed/incomplete status;
- merged trace references without fabricated causality;
- failed-period atomicity;
- deterministic scenario execution.

Do not obtain household net worth by summing separately executed VS2/VS3/VS4 result tables.

The preferred implementation SHOULD reuse/refactor existing slice period candidates or common orchestration primitives rather than duplicate VS2/VS3/VS4 financial formulas.

Once complete, expose:

- projected household net worth;
- assets and liabilities over time;
- cash/liquidity trajectory;
- investment trajectory;
- debt trajectory;
- major shortfalls/milestones;
- requested-horizon completion;
- actual/forecast boundary;
- scenario comparison of reconciled household metrics.

This PR is the architectural prerequisite for treating the Overview `Financial Outlook` graph as an authoritative household forecast.

## 9. PR 21 — Personal-MVP stabilization and explanation

**Goal:** close the Personal-MVP functional gate before private-alpha infrastructure begins.

Use a comprehensive synthetic Golden Household including, at minimum:

- household + people;
- employment income with growth;
- checking/savings;
- retirement/brokerage investment holdings and contributions;
- ordinary expenses with inflation;
- home/other asset;
- fixed mortgage;
- retirement/life event;
- baseline + at least two alternative scenarios;
- a liquidity-shortfall scenario.

Required work:

- ensure the synthetic example demonstrates the supported product rather than triggering avoidable capability gates;
- complete Overview/Money/Net Worth/Plan read models against the reconciled projection;
- replace avoidable generic `Unavailable` states with precise capability diagnostics;
- verify current-state and forecast answers required by the Personal-MVP functional gate;
- strengthen user-facing explanation from trace references where the engine already carries source/assumption/rule identity;
- preserve distinction between trace metadata and a future full causal explanation DAG;
- add critical E2E tests for create/load/edit/save/reload/forecast/scenario/explain/export/recover;
- conduct a final privacy review before real personal data is entered.

PR 21 SHALL NOT add PostgreSQL/auth/bank connectivity.

## 10. Personal-use stabilization period

Only after PRs 15–21 satisfy the Personal-MVP gate SHOULD the app be used as the developer's durable real personal-finance model.

During this period:

- do not immediately add multi-user infrastructure;
- use the application with real data only within the persistence/privacy boundary approved by ADR-017;
- keep regular portable exports/backups;
- record unsupported real-world cases and explanation gaps;
- distinguish missing financial semantics from UX inconvenience;
- prioritize bugs affecting financial correctness or recoverability before feature breadth.

Record at minimum:

- missing financial concepts;
- incorrect or surprising forecasts;
- unsupported assets/liabilities/accounts;
- funding/liquidity cases;
- scenario limitations;
- unexplained material outputs;
- persistence/migration/recovery friction;
- performance at realistic horizons;
- confusing workflows.

Private-alpha infrastructure begins only after this usage demonstrates that the Personal MVP is genuinely useful.

## 11. Private-alpha sequence

Retain the existing architecture's private-alpha direction, but begin it only after the stabilization gate:

```text
PR A  Reconciled/versioned PostgreSQL migrations
PR B  Persistence ports/adapters behind application interfaces
PR C  Managed authentication
PR D  HouseholdMembership authorization and tenant isolation
PR E  Security/privacy/redaction integration tests
PR F  Server deployment
PR G  Backup/export/delete lifecycle
PR H  CSV actual-transaction import
```

Bank aggregation remains after CSV/manual actual-data validation unless a later ADR changes that order.

## 12. Updated maturity interpretation

### Stage 1 — Executable engine

The core engine slices now exist for multi-period cash flow, investments, liabilities, and deterministic scenario overlays. Stage 1 is **substantially implemented but not fully integrated from the canonical Personal Model**.

### Stage 2 — Personal MVP

PR 14 supplies the application shell/editor, but Stage 2 is **not complete** until PRs 15–21 satisfy the Personal-MVP functional gate.

In particular, a visually present UI surface SHALL NOT be counted as implemented when its canonical model cannot execute the corresponding engine capability.

### Stage 3 — Private alpha

Unchanged: authentication, server persistence, household authorization, backups, privacy controls, and monitoring are required before friends/family use a shared service.

## 13. Updated immediate milestone

The immediate next milestone after PR 14 is:

> **PR 15 — Executable-model compiler foundation.**

Do not make PostgreSQL, authentication, bank connectivity, another UI redesign, or the reconciled household orchestrator the next change.

First establish the canonical model → engine boundary so subsequent liability, investment, persistence, scenario, and orchestration work builds on one stable application contract.

## 14. Architecture success criterion for the compiler era

The post-PR14 architecture is succeeding when a supported canonical household object can flow through:

```text
User-authored canonical model
        ↓
validation/reference resolution
        ↓
Executable Model Compiler
        ↓
existing engine contracts
        ↓
authoritative state/results/lineage
        ↓
application read models
        ↓
UI
```

without:

- duplicate financial formulas;
- hidden defaults;
- silent semantic loss;
- UI-owned calculations;
- fake cross-slice aggregation;
- currency/rate/time inference;
- discarded source/assumption/rule lineage.

Capability gating remains correct for genuinely unsupported semantics; the objective is to eliminate capability gates caused only by missing translation for semantics the existing engine already supports.
