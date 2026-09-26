# Performance, Observability & Deterministic Execution

**Version:** 0.1.4-draft
**Status:** Post-PR21 capability outline
**Requirement prefix:** PFA-PERF

## 1. Purpose

This specification governs measurement and improvement of deterministic execution and interactive responsiveness, and defines the performance gate that must be satisfied before stochastic multi-realization simulation is scaled.

Financial correctness, deterministic ordering, accounting authority, and executable financial semantics remain higher authority than optimization.

## 2. Normative requirements

### PFA-PERF-001 — Phase-level timing

The application SHALL measure component-level elapsed time for material forecast work, including at minimum model validation/compilation, opening-state reconciliation, scheduling/contention resolution, period execution, statement/metric derivation, trace/read-model construction, worker transfer where applicable, and UI render work.

### PFA-PERF-002 — Observational instrumentation

Performance instrumentation SHALL be observational only. Timing, telemetry, sampling, and benchmark collection SHALL NOT alter financial results, ordering, random streams, authoritative state, fingerprints, or reproducibility.

### PFA-PERF-003 — Measurement context

Each benchmark/performance record SHALL identify enough context to interpret the number, including fixture/model identity, entity counts or model-size summary, horizon, engine/spec versions, runtime/browser where applicable, cache state, and stochastic realization count when applicable.

### PFA-PERF-004 — Controlled fixtures and regression history

Performance verification SHALL include Golden Household, a realistic-large synthetic household, and a stress-scale synthetic fixture. CI or a controlled benchmark workflow SHALL retain or compare measurements sufficiently to detect material regressions without making correctness tests timing-flaky.

### PFA-PERF-005 — Fast current-state path

Current financial position / reconciled opening metrics SHALL be computable without executing the entire long-horizon household forecast. Overview and Net Worth current-state answers SHALL not depend on completion of a multi-year simulation.

### PFA-PERF-006 — Non-blocking long execution

Long-running household forecasts and future Monte Carlo realization batches SHALL execute outside the browser UI thread. The UI SHALL expose explicit idle/running/stale/completed/incomplete/unsupported/error states and SHALL remain responsive while execution is in progress.

### PFA-PERF-007 — Bounded recomputation

Editing SHALL avoid unnecessary canonical recompilation and forecast execution on every keystroke. Form-local draft state, meaningful commit boundaries, debounce/supersession, or equivalent mechanisms SHALL prevent obsolete work from becoming visible.

### PFA-PERF-008 — Bounded rendering

Forecast presentation SHALL avoid eager work proportional to every detailed period when that detail is not visible. Explanation resolution SHALL be lazy or memoized; long tables SHALL be collapsed, paginated, virtualized, or otherwise bounded; chart sampling/aggregation SHALL be display-only and SHALL NOT alter engine results.

### PFA-PERF-009 — Derived-result caching

Deterministic forecast/read-model results MAY be cached using a calculation fingerprint based on canonical financial inputs, scenario/configuration, horizon, as-of/data-cutoff, versions, and applicable policies. Non-economic run identity and wall-clock time SHALL NOT force a cache miss. Cached results remain derived and discardable.

### PFA-PERF-010 — Profile-driven engine optimization

Deterministic engine optimization SHALL be driven by measurements. Candidate areas include scheduler linearization/contention analysis, authoritative-state cloning, repeated filtering/sorting/index lookup, canonical serialization, trace construction, and repeated compilation. Any optimization that changes execution strategy SHALL prove semantic equivalence against the authoritative ordering/financial semantics with focused and property/reference tests as appropriate.

### PFA-PERF-011 — Reusable compiled execution plan

Before high-count stochastic orchestration, the architecture SHALL provide a reusable immutable compiled-plan boundary so invariant canonical validation, model translation, schedules, dependency metadata, and other realization-independent work are not repeated for every realization unless semantics require it.

### PFA-PERF-012 — Stochastic readiness gate

Production-scale stochastic simulation SHALL NOT be layered directly on the current unmeasured synchronous path. Before multi-realization implementation is treated as interactive-product ready, PFA-PERF-001 through PFA-PERF-011 applicable foundations SHALL exist, baseline timings SHALL be recorded, and stochastic timing SHALL separately report sampling, realization execution, aggregation, transfer/serialization, and rendering.

### PFA-PERF-013 — Stochastic resource-cost accounting

Stochastic benchmarks SHALL record realization count, wall-clock duration, aggregate CPU/execution time where measurable, worker concurrency, paths per second, peak/representative memory where measurable, and execution location (browser/local/server). If execution later incurs metered service cost, the benchmark/result telemetry SHOULD expose the provider-neutral billing units needed to calculate per-run cost without embedding a provider price in financial semantics.

### PFA-PERF-014 — Accuracy-constrained compute budget

A routine stochastic forecast SHALL be treated as a budgeted computation: it must satisfy both an explicitly defined statistical/convergence target and an explicitly defined resource/cost budget. The orchestration layer SHALL support stopping, progressive refinement, or additional sampling based on convergence evidence rather than relying on a fixed high realization count by default.

Exact time, CPU, memory, and metered-cost budgets SHALL be established from R1/R6 benchmark data before production/private-alpha stochastic execution is declared ready. The product architecture SHALL reject a design in which an ordinary user forecast routinely requires multi-dollar cloud compute. Exceptional high-cost analyses, if ever supported, SHALL be explicit opt-in operations rather than the normal refresh path.

### PFA-PERF-015 — Execution-placement portability

The stochastic execution contract SHALL remain provider-neutral and capable of running on a supported local/browser/desktop execution environment or on server/cloud workers without changing financial semantics, realization identity, or aggregate-result meaning. Execution placement MAY be selected using device capability, forecast size, latency target, concurrency, privacy, and measured cost.

The financial engine SHALL NOT require a cloud-only dependency merely to execute stochastic mathematics. Local execution SHOULD be preferred when it meets the applicable latency, memory, thermal/battery, and convergence budgets; cloud execution MAY be used when local execution would violate those budgets or product service requirements.

If the realistic household and/or computationally complex/stress household cannot meet the approved local execution budgets on representative supported hardware, the applicable milestone closeout SHALL trigger an explicit execution-placement design review before private-alpha architecture is frozen. That review SHALL compare continued local optimization with server/cloud execution, including measured latency, concurrency, marginal cost per rerun, privacy/data-transfer implications, operational complexity, and whether a hybrid local/cloud policy is warranted. A slow stress fixture is evidence for the review, not by itself a mandate that ordinary forecasts move to the cloud.

### PFA-PERF-016 — Private-alpha cost-per-rerun measurement

Before private alpha, every supported stochastic execution placement SHALL have a measured or defensible estimated marginal cost per successful rerun for the representative forecast fixtures and supported convergence/quality levels.

For any metered server/cloud execution path, telemetry SHALL translate attributable consumed billing units into currency cost using the deployed provider/pricing configuration and SHALL retain representative and p50/p95 per-rerun cost measurements where sample volume permits. The estimate SHOULD include materially attributable compute, worker/serverless invocation, orchestration, and data-transfer charges; fixed/shared platform costs SHALL be reported separately rather than misleadingly attributed as marginal rerun cost.

For local execution, the system MAY report zero marginal cloud cost but SHALL still record the resource/time measurements required by PFA-PERF-013 through PFA-PERF-015.

Private-alpha readiness SHALL fail if an enabled ordinary stochastic rerun path lacks cost-per-rerun measurement/estimation or cannot demonstrate compliance with the approved routine-run compute budget.

### PFA-PERF-017 — Representative and computationally complex household fixtures

Forecast verification SHALL maintain three distinct synthetic fixture classes:

1. the Golden Household, optimized for understandable financial correctness and stable checkpoints;
2. a realistic household forecast fixture, optimized for representative end-to-end product behavior and broad supported financial-mechanics coverage; and
3. a computationally complex/stress household fixture, optimized for exercising scale, dependency/scheduling complexity, many supported primitives/mechanics, long horizons, scenario execution, and stochastic throughput.

The realistic household SHALL expand as capabilities become supported and SHOULD include multiple people, multiple income/expense streams, cash and retirement/taxable accounts, diversified investments, at least one non-financial asset, debt/mortgage, applicable taxes, funding behavior, material life/retirement events, and multiple scenarios. It SHALL exercise a materially broader set of supported primitives and bindings than the Golden Household rather than being merely a larger copy of it.

The computationally complex fixture SHALL remain financially coherent while deliberately stressing supported execution paths, including many entities/positions/flows/events/dependencies, long horizons, multiple scenarios, tax execution, and stochastic processes/realizations when available. Artificial scale MAY be used, but invalid or economically nonsensical data SHALL NOT be used merely to manufacture load.

Each representative/stress fixture SHALL maintain a lightweight coverage manifest or equivalent machine-readable inventory identifying the important canonical objects, primitives, rules, events, scenarios, and major engine mechanics it exercises. Unsupported future capabilities need not be faked; the inventory SHALL make coverage gaps explicit so they can be expanded as the product grows.

## 3. Initial performance dashboard

A developer/advanced performance surface should report the latest run and rolling p50/p95/max where meaningful for:

- current snapshot;
- deterministic household compilation;
- scheduler/contention work;
- period execution;
- read-model/trace construction;
- worker queue/execution/transfer;
- UI commit/render and chart render;
- cache hit/miss;
- future tax calculation;
- future stochastic sampling, paths-per-second, aggregation, convergence, and marginal cost per rerun where metered.

The dashboard is a diagnostic surface, not part of normal novice navigation.

## 4. Budget policy

Absolute performance and compute-cost budgets SHALL be set after baseline instrumentation on representative hardware/runtime rather than invented before measurement. The first implementation milestones SHALL record baselines and propose explicit current-snapshot, interactive-forecast, render, stochastic-throughput, memory, and provider-neutral compute-unit budgets in a revision of this specification. Before private alpha, any enabled metered execution path SHALL translate those provider-neutral units into observed/estimated currency cost per rerun and track representative/p50/p95 cost alongside latency and convergence in accordance with PFA-PERF-016.

## 5. Verification intent

Performance tests must avoid nondeterministic CI failures. Correctness tests remain timing-independent; controlled benchmarks detect trends and enforce budgets only when the environment and tolerance are appropriate.
