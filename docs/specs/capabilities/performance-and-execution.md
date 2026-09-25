# Performance, Observability & Deterministic Execution

**Version:** 0.1.0-draft
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
- future stochastic sampling, paths-per-second, aggregation, and convergence.

The dashboard is a diagnostic surface, not part of normal novice navigation.

## 4. Budget policy

Absolute performance budgets SHALL be set after baseline instrumentation on representative hardware/runtime rather than invented before measurement. The first implementation milestone SHALL record baselines and propose explicit current-snapshot, interactive-forecast, render, and stochastic-throughput budgets in a revision of this specification.

## 5. Verification intent

Performance tests must avoid nondeterministic CI failures. Correctness tests remain timing-independent; controlled benchmarks detect trends and enforce budgets only when the environment and tolerance are appropriate.
