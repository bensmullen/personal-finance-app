# Post-PR21 Implementation Roadmap

**Version:** 0.2.0-draft
**Status:** Controlled implementation plan
**Requirement policy:** none

## 1. Purpose

This roadmap controls stabilization, forecasting, and the foundations of financial-planning/decision support after PR21 and before private-alpha infrastructure. Milestone IDs are planning identities; GitHub PR numbers may differ.

The sequence intentionally measures and improves the current deterministic path before multiplying it through stochastic simulation or strategy search. It also separates engineering enablement from user-facing completeness: stochastic infrastructure and planning infrastructure may develop against synthetic calibration and bounded domain coverage, while affected user-facing outputs remain capability-gated until their required tax, investment, insurance, calibration, and other semantics are ready.

The long-term architecture is a comprehensive financial-planning system, not only a forecast viewer. Forecasting remains the authoritative evaluation engine; planning layers define decisions, goals, constraints, candidate strategies, and comparisons without duplicating financial formulas.

A routine stochastic forecast or strategy evaluation is a budgeted computation product. Accuracy/convergence and compute cost are joint requirements. The implementation SHALL preserve local execution where it is efficient enough and SHALL remain portable to server/cloud workers when local execution cannot meet latency, memory, device, or product-service constraints. Routine forecasts or planning reruns that require multi-dollar cloud compute per user action are not an acceptable steady-state design; exact budgets are established from measured R1/R6/planning data.

## 2. Dependency sequence

~~~text
R0  Specification decomposition and traceability  [complete]
 |
R1  Performance instrumentation + benchmark fixtures
 |
R2  Interactive deterministic execution foundation
 | | +--> R4  UX/editor cleanup -----------------------------+
 | |       |
 | |       +--> O1  Assisted onboarding/import foundation ---+
 |                                                       |
 +--> R3  High-throughput deterministic simulation kernel |
      |    + reusable compiled household                 |
      |    + decision/scenario overlay seam               |
      |    + measured scaling behavior                    |
      |                                                   |
      +--> P1  Deterministic planning/strategy foundation |
      |                                                   |
      +--> C1  Provider-neutral calibration contract      |
      |        + synthetic/internal baseline calibration  |
      |                                                   |
      +--> R5  Stochastic runtime foundation <------------+
      |        |
      |        v
      |     R6  Monte Carlo orchestration
      |        |
      |        v
      |     R7  Baseline probabilistic household engine
      |        |
      |        +--> P2  Stochastic strategy evaluation /
      |        |        progressive optimization
      |        |
      |        v
      |     R8  Institutional market/sector calibration adapters
      |        |
      |        +--> R10 Probabilistic + planning decision UX
      |                         |
      +--> T1A Target-cohort tax floor (parallel) --------+
      |                         |
      +--> A1  Private-alpha concentration safeguard -----+
      |                         |
      +-------------------------+--> O1 + P1 alpha coverage gate
                                |
                     R11 Private-alpha readiness /
                         stabilization-exit gate

P3  Integrated cross-domain optimization (tax + portfolio + insurance +
    retirement/debt/liquidity as supported) follows P1 and the applicable
    domain capabilities; stochastic automated optimization additionally
    requires P2. It is not a blanket private-alpha prerequisite.

R9  Full issuer/RSU/employer-risk stochastic modeling is conditional
    before private alpha: required if the target cohort needs it; otherwise
    it remains an explicit tracked post-alpha capability.

T1B Advanced/specialized tax domains progress with the capabilities that need
    them and gate only affected outputs.
~~~

## 3. R1 — Performance instrumentation and baselines

Implement PFA-PERF-001 through PFA-PERF-004 and PFA-PERF-013 through PFA-PERF-018 foundations first.

Deliver:

- phase timers across application/engine/UI boundaries;
- a developer performance dashboard with latest/rolling measurements;
- three maintained synthetic fixture classes: Golden Household, realistic household forecast, and computationally complex/stress household;
- a lightweight coverage inventory for the realistic and complex fixtures showing which important canonical objects, primitives, rules, events, scenarios, and execution mechanics are exercised;
- repeatable benchmark capture;
- explicit attribution of engine, application/worker, serialization, React/chart, and explanation/render cost;
- baseline measurements before optimization;
- provider-neutral CPU/worker/memory/throughput accounting suitable for estimating local or cloud execution cost;
- cost-per-rerun measurement/estimation plumbing that can translate metered provider units into currency once a deployed provider exists;
- initial comparison of feasible local/browser execution versus server/cloud execution on representative devices;
- scaling-shape measurements that vary horizon and representative model/operation counts so later R3 work can distinguish fixed overhead from growth-rate problems.

Before R1 closeout, any engineering-reference baseline captured outside the repository-supported Node 22/npm 10 runtime SHALL be recaptured on the supported runtime before it is promoted to an approved budget or used as the authoritative R3 comparison baseline. Older measurements may remain labeled as reference-only evidence.

Do not set hard latency or currency-cost budgets until baseline data exists. After R1/R6 measurements exist, define explicit p50/p95 latency, convergence, memory, and per-run compute-cost budgets. Before private alpha, every enabled stochastic execution placement must have measured or defensible estimated marginal currency cost per rerun for the representative fixtures/quality levels, and metered paths must report representative/p50/p95 cost where sample volume permits.

If the realistic and/or computationally complex/stress household materially miss the approved local execution budgets on representative supported hardware, R1/R6 closeout SHALL explicitly review whether further local optimization, cloud/server execution, or a hybrid placement policy is appropriate. The review must include cost-per-rerun and privacy/operational tradeoffs; it must not assume cloud execution is automatically the answer.

**User validation:** not normally required. Objective timing and correctness are automated/engineering verification.

## 4. R2 — Interactive deterministic execution foundation

Deliver the highest-value UAT responsiveness fixes:

- fast reconciled current snapshot that does not run the full forecast;
- explicit forecast state machine: idle/running/stale/completed/incomplete/unsupported/error;
- Web Worker or equivalent off-main-thread long forecast execution;
- request identity and stale-response suppression;
- meaningful edit commit/debounce behavior rather than heavy work on each keystroke;
- automatic deterministic baseline forecast when valid execution configuration exists;
- in-memory deterministic result cache using an application-owned calculation fingerprint;
- lazy explanation resolution;
- bounded/virtualized/collapsed detailed tables;
- summary-first chart rendering.

Persistent derived caching may be added later behind a discardable/versioned cache boundary.

**User validation:** required at milestone closeout. Closeout instructions SHALL ask the user to verify current-state responsiveness, edit/recalculate behavior, running/stale/error states, and preservation of the last valid result while a replacement is executing.

## 5. R3 — High-throughput deterministic simulation kernel

R3 is a computational-architecture milestone, not ordinary cleanup. Use R1 measurements and scaling-shape data to transform the correctness-oriented reference execution path into the reusable simulation foundation for deterministic forecasts, stochastic realizations, and planning-candidate evaluation.

Use measurements to rank work. Likely candidates include:

- contention/linearization enumeration;
- repeated authoritative-state/primitive-state cloning;
- repeated filtering/sorting and object lookup;
- repeated canonical serialization/fingerprinting;
- trace materialization;
- recompilation of invariant schedules/dependency metadata;
- repeated invocation of complete vertical-slice/sub-simulation runners for already-prepared individual operations;
- runtime structures whose cost grows unnecessarily with accumulated historical identities, obligations, transactions, or prior periods.

R3 SHALL:

- create the immutable compiled-household/reusable execution boundary required by PFA-PERF-011;
- establish lightweight shared operation/execution kernels so domain slices remain semantically modular without forcing full sub-simulation overhead for each operation;
- pre-resolve/index stable relationships, schedules, dependencies, supported rule bindings, and hot lookups where semantics allow;
- provide a scenario/decision overlay seam so a localized planning change can reuse unrelated compiled household structure;
- reduce avoidable whole-state/history copying and repeated scans/serialization in hot paths while preserving authoritative snapshots at required boundaries;
- support bounded execution-level lineage with richer explanation materialization only where needed;
- measure scaling versus horizon/model size/history/operation count, not just one absolute benchmark;
- preserve an implementation-neutral simulation interface so a later Rust/WebAssembly/native/server acceleration spike can target measured hotspots without changing financial semantics.

Do not optimize semantic ordering by assumption. Scheduler/execution changes must demonstrate equivalence against authoritative semantics with reference/property tests. Do not move an inefficient engine to cloud/server execution merely to hide local latency; execution placement is evaluated after measured algorithmic/data-structure optimization.

R3 SHALL implement PFA-PERF-019 through PFA-PERF-023 and satisfy the reusable execution requirements before high-count stochastic orchestration or automated strategy search is treated as production-capable.



**User validation:** not normally required unless a user-visible behavior changes. Financial/result equivalence and performance improvement are primarily automated/engineering verification.

## 6. P1 — Deterministic planning / strategy-evaluation foundation

P1 begins after the R3 reusable compiled-plan/decision-overlay seam exists and may progress in parallel with C1/R5-R7.

Implement the initial PFA-PLAN contract with a deliberately small supported decision set:

- typed separation of facts, assumptions, decisions, goals, constraints, strategies, and outcomes;
- durable/reproducible strategy identity;
- deterministic evaluation of two or more candidate strategies through the authoritative engine;
- explicit objective/constraint configuration without a hidden universal score;
- comparable result summaries and explanation of material decision/outcome differences;
- capability diagnostics when missing tax/investment/insurance/other semantics could materially change a conclusion;
- no automated financial action;
- compiled-plan reuse for localized decision overlays where semantically valid.

P1 does not require automated search, Monte Carlo optimization, a new canonical Goal/Strategy object, or complete portfolio/insurance/tax planning. Its purpose is to establish the stable planning boundary early enough that stochastic and domain work build toward it rather than requiring a later architectural rewrite.

**User validation:** P1 requires focused user validation of whether a supported strategy comparison is understandable and decision-relevant. Financial equivalence and reproducibility remain automated/engineering verification.

## 7. C1 — Calibration contract before stochastic implementation

Before stochastic runtime code hard-codes any distribution/provider shape:

- define the provider-neutral normalized CalibrationSet boundary;
- define immutable normalized calibration snapshots/content fingerprints;
- provide a synthetic/internal baseline calibration for tests and engineering development;
- ensure the same calibration snapshot can be reused across many forecast runs;
- ensure a forecast references the calibration fingerprint rather than duplicating calibration data per run.

C1 is the early contract half of the former R8 work. It prevents rework without prematurely choosing external providers.

**User validation:** not required.

## 8. R4 — UX/editor cleanup

R4 may overlap R2/R3.

Implement PFA-UX with emphasis on:

- friendly entity labels and relationship resolution;
- no duplicate title/name summaries;
- no primary raw UUID display;
- removal/replacement of Choose-only unsupported reference controls;
- domain-oriented editing instead of primitive/rule IDs;
- structured additional/expert/technical drill-down;
- improved charts/status states and novice-first information hierarchy;
- component decomposition where it reduces rerender coupling.

**User validation:** required. Milestone closeout SHALL provide a concise walkthrough covering novice comprehension, entity editing, advanced-detail discoverability, chart readability, and any remaining confusing/dead controls.

## 9. O1 — Assisted onboarding and import foundation

O1 begins after the R2/R4 interaction foundations are stable enough to support a guided workflow and may proceed in parallel with R3/C1/R5-R10.

Implement PFA-ONB with emphasis on:

- a minimum viable household model that reaches useful current-state and forecast outputs before optional detail is requested;
- privacy-safe instrumentation for time to first useful forecast, manual-entry burden, completion/abandonment, corrections, import success, unsupported formats, and source-path mix;
- a typed candidate boundary for document/CSV/conversational extraction that distinguishes factual candidates from goals, constraints, assumptions, decisions, and other planning inputs;
- deterministic validation, provenance, approximate-versus-exact preservation, conflict detection, and user confirmation before authoritative model mutation;
- guided structured onboarding plus at least one bulk/file import or extraction path appropriate to the intended alpha cohort;
- deliberate separation of current snapshot facts, transaction history, and forward-looking planning inputs;
- optional guarded text/voice conversational intake for goals, rough spending, household facts, and high-value missing fields where prototype evidence shows it reduces effort;
- supported-format detection and safe failure rather than partial silent imports;
- synthetic fixtures/documents/conversations for automated testing, with real personal data used only inside the approved privacy boundary;
- progressive completeness guidance that tells the user which missing inputs materially improve supported outputs.

O1 SHALL run representative onboarding dry runs before R11 and use the results to set an explicit time/manual-effort target rather than inventing one in advance. The dry runs should measure whether users can reach a meaningful forecast without transcribing their entire financial life manually.

A production Plaid/bank-aggregation integration is not required for O1 or private alpha if the measured assisted workflow meets the target.

**User validation:** required. Closeout should observe actual onboarding behavior rather than only reviewing screens. The user should verify that the workflow feels substantially faster than manual field-by-field setup and that extracted information is easy to review/correct.

## 10. T1A/T1B — Tax development track

### T1A — Target-cohort/common-household tax floor

Begin after R2 and develop in parallel with R3/C1/R5/R6.

T1A is not “all tax law.” It is the deterministic per-realization tax coverage materially required by the households and outputs targeted for personal use/private alpha. Tax-affected stochastic outputs remain blocked/scoped until their required tax semantics are covered.

For the actual private-alpha cohort, implement the materially applicable subset of PFA-TAX-010: federal ordinary income tax with filing status/progressive brackets, standard/basic deductions, employee payroll taxes, applicable state/local income taxes, taxable interest/dividends including qualified-dividend treatment, realized short/long-term capital gains, basic traditional/Roth retirement tax treatment, NIIT where material, cash-flow-relevant withholding/settlement, and RMD/retirement-distribution mechanics when the age/horizon makes them material.

Property tax may remain a modeled household expense and sales tax may remain embedded in spending assumptions when no separate tax-engine interaction is required. Self-employment/business, AMT, complex credits/phaseouts, rental/pass-through, foreign, estate/gift, and equity-compensation-specific taxation remain T1B unless an alpha participant requires them.

Create the reusable tax-rule catalog boundary from PFA-TAX-011. During personal/local development the catalog may be version-controlled app data. Before/within shared private-alpha persistence, common effective-dated rule definitions should be stored once per version/content fingerprint, while household models store facts/elections/references rather than duplicate copies of tax law. Executable tax algorithms remain in the rules engine.

Examples of tax-independent results may continue to display in accordance with PFA-TAX-008. Objective output validity SHALL be driven by dependencies/capability diagnostics rather than a global all-or-nothing tax switch.

### T1B — Advanced/specialized tax domains

Add specialized capital-gains, retirement, equity-compensation, and other jurisdiction/product mechanics alongside the capabilities that require them. Missing T1B behavior gates only materially affected outputs.

**User validation:** required only when a tax milestone changes user-facing workflows/results. Automated rule/invariant tests remain the correctness authority; user validation checks understandable presentation and expected real-world workflow.

## 11. R5 — Stochastic runtime foundation

Implement the higher-authority stochastic semantics before Monte Carlo orchestration:

- seeded RandomSource/RandomStream implementation;
- distinct stochastic cohort identity and scenario identity;
- stable process identities/substreams;
- P31 probabilistic and P33 correlated-process executable support needed by the initial model;
- immutable stochastic run configuration referencing C1 calibration;
- one reproducible stochastic household realization;
- explicit rejection of unsupported distributions/dependencies.

Do not add high realization counts until one realization is semantically complete and reproducible.

**User validation:** not required.

## 12. R6 — Monte Carlo orchestration

Add:

- compile-once/many-realization execution;
- worker pool or bounded parallel batches;
- deterministic realization identity independent of scheduling;
- common-random-number cohorts for paired scenario comparison;
- streaming/online distribution aggregation;
- bounded memory;
- progressive refinement and stopping based on convergence evidence rather than a permanently fixed high realization count;
- representative-path identity/summary capture;
- stochastic performance/resource-cost telemetry;
- cancellation/supersession;
- provider-neutral execution placement so the same stochastic contract can run locally when practical or on cloud/server workers when required.

Persistence at this stage SHALL be bounded: do not retain every path or every rerun. Persist the current successful aggregate result plus, at most, one immediately preceding successful aggregate per saved scenario/configuration, together with reproducibility metadata. Keep the last good result current until a replacement completes successfully; failed/cancelled runs never evict it.

Superseded unpinned successful aggregates SHOULD enter an initial seven-day recovery grace period before garbage collection. Exact production duration remains configurable. Explicitly pinned/saved stochastic snapshots are retained separately and SHALL be subject to a simple user-facing saved-snapshot count limit plus a backend byte quota. Exact count/byte limits are set after representative storage measurements. Identical artifacts SHOULD be deduplicated by deterministic fingerprints.

Retained stochastic results SHALL store aggregate distributions/percentiles, threshold and liquidity-shortfall probabilities, decision metrics, convergence/sample metadata, and exact model/Forecast Basis/calibration/tax/stochastic/version identities. They SHALL NOT store the full transaction/state/trace history for every realization by default. Detailed representative paths SHOULD be regenerated on demand from retained realization identities when compatible engine/rule/calibration artifacts remain available; pinned long-lived results may additionally retain compact representative-path summaries.

Calibration and tax-rule artifacts are content-addressed/deduplicated separately and retained while referenced or required by retention policy. Saved plan/scenario definitions are durable configuration and SHALL be stored independently of derived forecast results.

Initial path counts, convergence thresholds, and compute/cost budgets shall be established empirically. A routine forecast that cannot meet both statistical and compute budgets SHALL be optimized, progressively refined, narrowed, or capability-gated rather than normalized as an expensive cloud operation.

**User validation:** not normally required; orchestration correctness/reproducibility is automated.

## 13. R7 — Baseline probabilistic household engine

Introduce uncertainty incrementally against C1's synthetic/internal calibration:

1. broad asset-class returns and correlations;
2. inflation;
3. material interest-rate processes;
4. income/salary uncertainty;
5. expense variability;
6. later employment, longevity, major expense, real-estate, and other life-event processes.

User decisions remain explicit scenario controls unless behavioral uncertainty is intentionally enabled.

R7 may expose engineering/developer results before T1A is complete, but a tax-affected result SHALL NOT be presented to a normal user as a complete household probability until PFA-TAX-008/009 are satisfied.

**User validation:** limited/developer validation may occur, but normal-user UAT waits for tax/calibration completeness appropriate to the output.



## 14. P2 — Stochastic strategy evaluation and progressive optimization

After P1 and the required R7 probabilistic semantics exist, add strategy-set stochastic evaluation using PFA-PLAN, PFA-PROB, and PFA-PERF-024:

- common Forecast Basis and common-random-number cohorts for materially comparable candidates;
- bounded lower-cost stochastic screening followed by higher-confidence evaluation of survivors;
- dominance/tradeoff analysis without forcing all goals into one unexplained scalar score;
- candidate-count, realization-count, convergence, latency, memory, and cost telemetry;
- cancellation/supersession and bounded parallel evaluation;
- explicit disclosure when search is heuristic, bounded, or incomplete;
- authoritative finalist reevaluation at the required tax/investment/insurance/domain completeness level.

P2 may remain post-alpha if the private-alpha product does not claim automated stochastic optimization. If a private-alpha feature presents an optimized/recommended strategy based on stochastic search, the applicable P2 requirements become part of that feature's launch gate.

**User validation:** required before automated stochastic strategy recommendations become a normal-user feature.

## 15. R8 — Institutional market/economic calibration adapters

R8 is now only the provider-adapter/data half of calibration work because C1 defined the internal contract earlier.

Implement one or more institution/provider adapters using explicit provenance, horizon, return basis, volatility/dependence, mapping methodology, licensing, version pinning, and immutable normalized content fingerprints. Do not silently blend providers.

Company-specific data is added only where exposure is material or explicitly requested.

**User validation:** required before institutional calibration becomes the default basis for user-facing stochastic results. The user should verify source/date disclosure, refresh behavior, and understandable distinction between assumptions and guarantees; numerical ingestion/mapping correctness should be automated.

## 16. A1/R9 — Concentrated positions and equity compensation

### A1 — Private-alpha concentration safeguard

A1 is required before private alpha even if full R9 is deferred:

- detect or allow declaration of material single-issuer concentration;
- show the concentration clearly;
- never silently treat a concentrated individual stock as diversified;
- provide explicit capability diagnostics;
- optionally provide deterministic hold/sell/diversify or price-shock stress scenarios without pretending those shocks are issuer-specific probabilities.

If an intended alpha participant needs concentrated-stock/RSU planning, implement the necessary safe subset or full R9 before onboarding that participant.

### R9 — Full concentrated issuer/equity-compensation model

Resolve the canonical representation of equity awards, then add:

- issuer/sector stochastic refinement;
- RSU vesting/forfeiture/withholding lifecycle;
- employer-stock and human-capital correlation;
- concentrated-tail outputs;
- hold/sell/diversify probabilistic comparisons.

Unvested RSUs remain contingent compensation until an actual modeled vesting event satisfies the conditions and posts the owned shares/cash.

If R9 is not completed before private alpha because the cohort does not require it, it SHALL remain explicitly listed as an unresolved required capability in this roadmap/TODO register. It must not disappear from planning merely because alpha begins.

**User validation:** required if A1/R9 is used by an alpha participant.

## 17. R10 — Probabilistic and planning decision UX

Implement PFA-UX-010 through PFA-UX-013 and make probability/distribution and strategy-comparison outputs understandable. Planning comparison surfaces in R10 require P1 for the enabled decision set; P2 is required only for an enabled automated stochastic optimization/recommendation surface:

- deterministic and stochastic views of the same material metrics;
- deterministic preview auto-refresh after validated committed/debounced edits;
- stochastic rerun only after explicit user action on confirmed/saved changes;
- percentile fan/range charts;
- threshold probabilities;
- liquidity-shortfall probability;
- scenario probability deltas;
- calibration/model-assumption disclosure;
- explicit stale status when model inputs changed after the last stochastic run;
- Forecast Basis visibility sufficient to distinguish apples-to-apples comparisons from historical snapshots;
- ability to rerun two saved plan/scenario definitions under one selected common Forecast Basis for normalized decision comparison;
- clear distinction between a durable saved plan definition and a pinned stochastic forecast snapshot;
- saved-snapshot/recovery management using a count-oriented user model rather than exposing backend byte accounting;
- drill-down to regenerated or retained representative deterministic paths/explanations;
- strategy views that identify material decision differences, goals/constraints, tradeoffs, evaluation fidelity, and capability limitations rather than presenting an unexplained score;
- explicit distinction between a modeled recommendation, a bounded comparison, and any claim of exhaustive optimality.

Retain deterministic views for immediacy, audit, and explanation; do not present them as the single expected future.



**R10 user validation:** required. Closeout instructions SHALL cover comprehension of deterministic versus stochastic views, stale/rerun behavior, probability language, scenario/strategy comparison, recommendation limitations, and whether the result supports an actual planning decision.

## 18. R11 — Private-alpha readiness / stabilization-exit gate

This is the exit gate from the post-PR21 personal-use stabilization period, not the beginning of stabilization.

Before private-alpha infrastructure:

- O1 onboarding dry runs establish and meet an explicit pre-infrastructure time-to-first-useful-forecast/manual-effort target using the intended onboarding paths, and the workflow does not require burdensome field-by-field transcription of the household;
- the assisted-input architecture preserves factual-versus-planning semantic categories, candidate review, provenance, ambiguity handling, idempotency, and the privacy boundary required by PFA-ONB;
- performance, convergence, memory, and per-run compute-cost budgets are documented and met for supported realistic use, with explicit cost-per-rerun measurement/estimation for every enabled stochastic execution placement;
- Golden, realistic-household, and computationally complex/stress fixtures pass their applicable correctness/performance checks and their coverage inventories show the supported product is exercised materially beyond the simple Golden Household;
- current-state UI is responsive;
- deterministic forecasts do not block the UI;
- stochastic forecasts are reproducible and convergence metadata is interpretable;
- common-random-number scenario comparison works where applicable and comparison UX distinguishes shared-Forecast-Basis decision comparisons from non-normalized historical snapshots;
- user-facing stochastic outputs have applicable tax/calibration completeness;
- major UAT editor/UX defects are resolved;
- caching/persistence cannot make stale results look current or destroy the last successful result on failed rerun; saved plans are independent from derived results; recovery/grace-period behavior, snapshot limits, deduplication, and aggregate-only stochastic storage are exercised;
- A1 concentration safeguards exist;
- P1 deterministic strategy-evaluation foundation is implemented for the supported alpha planning decision set, with understandable tradeoffs and capability diagnostics; automated search/P2/P3 are not required unless an enabled alpha feature depends on them;
- any enabled portfolio-planning or insurance-planning recommendation surface meets the applicable PFA-INV/PFA-INS requirements, while unsupported domains remain explicitly capability-gated;
- full R9 is completed if the initial alpha cohort requires it, otherwise it remains an explicit tracked TODO;
- privacy/persistence boundaries remain suitable for personal use.

**User validation:** required. The milestone closeout SHALL provide a focused end-to-end private-alpha readiness checklist. Automated CI/financial verification SHALL pass before asking the user to perform UAT.

Private-alpha infrastructure remains governed by the system/software architecture and begins after this gate. The private-alpha launch itself remains blocked until the O1 onboarding pipeline is wired through the secured shared-service authentication/persistence/privacy boundary and an end-to-end onboarding dry run confirms that the launch target still holds with the deployed architecture.

## 19. P3 — Integrated cross-domain financial planning and optimization

P3 is the long-term integration track after P1 and the applicable domain capabilities mature; it additionally depends on P2 for stochastic automated optimization. It combines supported planning decisions across portfolio/investments, taxes, insurance, retirement, debt, liquidity, and other future domains without moving their financial formulas into the optimizer.

P3 SHALL use progressive evaluation rather than brute-force high-fidelity Monte Carlo across every possible combination:

```text
feasibility/rule screening
        ↓
fast deterministic evaluation
        ↓
candidate generation/search
        ↓
bounded stochastic evaluation
        ↓
eliminate dominated/unpromising candidates
        ↓
higher-confidence finalist evaluation
        ↓
explain material tradeoffs and limitations
```

The portfolio capability (PFA-INV) and insurance capability (PFA-INS) may be implemented incrementally as real planning use cases require them. Full P3 is not a blanket R11/private-alpha prerequisite; however, the product SHALL NOT market or present an unsupported domain as part of a comprehensive recommendation.

**User validation:** required for each integrated planning surface introduced to normal users.

## 20. Explicit deferred-capability/TODO register

The following items SHALL remain visible until closed:

- **Full concentrated issuer + RSU/employer-risk stochastic modeling (R9):** conditional pre-alpha, but mandatory future capability if not completed before alpha. Trigger earlier if an intended participant has material concentrated stock or equity compensation.
- **General portfolio-planning depth (PFA-INV):** implement allocation/rebalancing/account-location/contribution-withdrawal planning as product surfaces require it; trigger before presenting portfolio strategy recommendations that depend on those semantics.
- **Insurance planning (PFA-INS):** implement the relevant product-family semantics before presenting coverage recommendations or before onboarding an alpha participant whose planning value materially depends on insurance decisions.
- **Stochastic strategy optimization (P2):** may remain post-alpha if alpha offers explicit scenario/strategy comparison rather than automated optimization; trigger before exposing an automated stochastic strategy recommendation.
- **Integrated cross-domain optimization (P3):** long-term product capability spanning the supported tax, investment, insurance, retirement, debt, liquidity, and future planning domains. It is intentionally not a blanket private-alpha prerequisite.

Additional deferred capabilities may be added here only with an owner/trigger or planned milestone; deferral SHALL NOT silently erase a requirement.
