# Post-PR21 Implementation Roadmap

**Version:** 0.1.5-draft
**Status:** Controlled implementation plan
**Requirement policy:** none

## 1. Purpose

This roadmap controls stabilization and forecasting work after PR21 and before private-alpha infrastructure. Milestone IDs are planning identities; GitHub PR numbers may differ.

The sequence intentionally measures and improves the current deterministic path before multiplying it through stochastic simulation. It also separates engineering enablement from user-facing completeness: stochastic infrastructure may be developed against synthetic calibration and a narrow tax subset, while affected user-facing outputs remain capability-gated until their required calibration/tax semantics are ready.

A routine stochastic forecast is a budgeted computation product. Accuracy/convergence and compute cost are joint requirements. The implementation SHALL preserve local execution where it is efficient enough and SHALL remain portable to server/cloud workers when local execution cannot meet latency, memory, device, or product-service constraints. Routine forecasts that require multi-dollar cloud compute per user rerun are not an acceptable steady-state design; exact budgets are established from measured R1/R6 data.

## 2. Dependency sequence

~~~text
R0  Specification decomposition and traceability  [this change]
 |
R1  Performance instrumentation + benchmark fixtures
 |
R2  Interactive deterministic execution foundation
 | | +--> R4  UX/editor cleanup -----------------------------+
 | |       |
 | |       +--> O1  Assisted onboarding/import foundation ---+
 |                                                       |
 +--> R3  Profile-driven deterministic optimization       |
      |    + reusable compiled-plan seam                  |
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
      |        v
      |     R8  Institutional market/sector calibration adapters
      |        |
      |        +--> R10 Probabilistic decision UX
      |                         |
      +--> T1A Target-cohort tax floor (parallel) --------+
      |                         |
      +--> A1  Private-alpha concentration safeguard -----+
      |                         |
      +-------------------------+--> O1 dry-run target/coverage gate
                                |
                     R11 Private-alpha readiness /
                         stabilization-exit gate

R9  Full issuer/RSU/employer-risk stochastic modeling is conditional
    before private alpha: required if the target cohort needs it; otherwise
    it remains an explicit tracked post-alpha capability.

T1B Advanced/specialized tax domains progress with the capabilities that need
    them and gate only affected outputs.
~~~

## 3. R1 — Performance instrumentation and baselines

Implement PFA-PERF-001 through PFA-PERF-004 and PFA-PERF-013 through PFA-PERF-017 foundations first.

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
- initial comparison of feasible local/browser execution versus server/cloud execution on representative devices.

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

## 5. R3 — Deterministic engine optimization

Use R1 measurements to rank work. Likely candidates include:

- contention/linearization enumeration;
- repeated authoritative-state/primitive-state cloning;
- repeated filtering/sorting and object lookup;
- repeated canonical serialization/fingerprinting;
- trace materialization;
- recompilation of invariant schedules/dependency metadata.

Do not optimize semantic ordering by assumption. Scheduler/execution changes must demonstrate equivalence against authoritative semantics with reference/property tests.

R3 SHALL create the immutable compiled-plan/reusable execution boundary required by PFA-PERF-011 before high-count orchestration.

**User validation:** not normally required unless a user-visible behavior changes. Financial/result equivalence and performance improvement are primarily automated/engineering verification.

## 6. C1 — Calibration contract before stochastic implementation

Before stochastic runtime code hard-codes any distribution/provider shape:

- define the provider-neutral normalized CalibrationSet boundary;
- define immutable normalized calibration snapshots/content fingerprints;
- provide a synthetic/internal baseline calibration for tests and engineering development;
- ensure the same calibration snapshot can be reused across many forecast runs;
- ensure a forecast references the calibration fingerprint rather than duplicating calibration data per run.

C1 is the early contract half of the former R8 work. It prevents rework without prematurely choosing external providers.

**User validation:** not required.

## 7. R4 — UX/editor cleanup

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

## 8. O1 — Assisted onboarding and import foundation

O1 begins after the R2/R4 interaction foundations are stable enough to support a guided workflow and may proceed in parallel with R3/C1/R5-R10.

Implement PFA-ONB with emphasis on:

- a minimum viable household model that reaches useful current-state and forecast outputs before optional detail is requested;
- privacy-safe instrumentation for time to first useful forecast, manual-entry burden, completion/abandonment, corrections, import success, unsupported formats, and source-path mix;
- a typed candidate-fact boundary for document/CSV/conversational extraction;
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

## 9. T1A/T1B — Tax development track

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

## 10. R5 — Stochastic runtime foundation

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

## 11. R6 — Monte Carlo orchestration

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

## 12. R7 — Baseline probabilistic household engine

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

## 13. R8 — Institutional market/economic calibration adapters

R8 is now only the provider-adapter/data half of calibration work because C1 defined the internal contract earlier.

Implement one or more institution/provider adapters using explicit provenance, horizon, return basis, volatility/dependence, mapping methodology, licensing, version pinning, and immutable normalized content fingerprints. Do not silently blend providers.

Company-specific data is added only where exposure is material or explicitly requested.

**User validation:** required before institutional calibration becomes the default basis for user-facing stochastic results. The user should verify source/date disclosure, refresh behavior, and understandable distinction between assumptions and guarantees; numerical ingestion/mapping correctness should be automated.

## 14. A1/R9 — Concentrated positions and equity compensation

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

## 15. R10 — Probabilistic decision UX

Implement PFA-UX-010 through PFA-UX-012 and make probability/distribution outputs understandable:

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
- drill-down to regenerated or retained representative deterministic paths/explanations.

Retain deterministic views for immediacy, audit, and explanation; do not present them as the single expected future.

**User validation:** required. Closeout instructions SHALL cover comprehension of deterministic versus stochastic views, stale/rerun behavior, probability language, scenario comparison, and whether the result supports an actual planning decision.

## 16. R11 — Private-alpha readiness / stabilization-exit gate

This is the exit gate from the post-PR21 personal-use stabilization period, not the beginning of stabilization.

Before private-alpha infrastructure:

- O1 onboarding dry runs establish and meet an explicit pre-infrastructure time-to-first-useful-forecast/manual-effort target using the intended onboarding paths, and the workflow does not require burdensome field-by-field transcription of the household;
- the assisted-input architecture preserves candidate-fact review, provenance, ambiguity handling, idempotency, and the privacy boundary required by PFA-ONB;
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
- full R9 is completed if the initial alpha cohort requires it, otherwise it remains an explicit tracked TODO;
- privacy/persistence boundaries remain suitable for personal use.

**User validation:** required. The milestone closeout SHALL provide a focused end-to-end private-alpha readiness checklist. Automated CI/financial verification SHALL pass before asking the user to perform UAT.

Private-alpha infrastructure remains governed by the system/software architecture and begins after this gate. The private-alpha launch itself remains blocked until the O1 onboarding pipeline is wired through the secured shared-service authentication/persistence/privacy boundary and an end-to-end onboarding dry run confirms that the launch target still holds with the deployed architecture.

## 17. Explicit deferred-capability/TODO register

The following item SHALL remain visible until closed:

- **Full concentrated issuer + RSU/employer-risk stochastic modeling (R9):** conditional pre-alpha, but mandatory future capability if not completed before alpha. Trigger earlier if an intended participant has material concentrated stock or equity compensation.

Additional deferred capabilities may be added here only with an owner/trigger or planned milestone; deferral SHALL NOT silently erase a requirement.
