# Post-PR21 Implementation Roadmap

**Version:** 0.1.0-draft
**Status:** Controlled implementation plan
**Requirement policy:** none

## 1. Purpose

This roadmap controls the stabilization and forecasting work after PR21 and before private-alpha infrastructure. Milestone IDs are stable planning identities; GitHub PR numbers may differ.

The sequence intentionally measures and improves the current deterministic path before multiplying it through stochastic simulation.

## 2. Dependency sequence

~~~text
R0  Specification decomposition and traceability  [this change]
 |
R1  Performance instrumentation + benchmark fixtures
 |
R2  Interactive execution foundation
 |   fast current snapshot, worker execution, forecast lifecycle,
 |   cache/supersession, bounded rendering
 |
R3  Profile-driven deterministic engine optimization
 |   + reusable compiled-plan seam
 |
 +--------------------------+
 |                          |
R4  UX/editor cleanup       T1  Tax-engine maturation may proceed in parallel
 |                          |   once deterministic execution seams are stable
 +-------------+------------+
               |
R5  Stochastic runtime foundation
 |
R6  Monte Carlo orchestration + streaming aggregation/convergence
 |
R7  Baseline probabilistic household model
 |
R8  Market/economic calibration adapters
 |
R9  Concentrated issuer + equity-compensation modeling
 |
R10 Probabilistic decision UX and scenario comparison refinement
 |
R11 Personal-use stabilization gate
 |
Private-alpha infrastructure sequence
~~~

## 3. R1 — Performance instrumentation and baselines

Implement PFA-PERF-001 through PFA-PERF-004 first.

Deliver:

- phase timers across application/engine/UI boundaries;
- a developer performance dashboard with live latest/rolling measurements;
- Golden, realistic-large, and stress synthetic performance fixtures;
- repeatable benchmark capture;
- explicit attribution of engine, worker/application, serialization, React, chart, and explanation/render cost;
- baseline measurements before optimization.

Do not set hard latency budgets until the baseline data exists.

## 4. R2 — Interactive execution foundation

Deliver the highest-value UAT responsiveness fixes:

- fast reconciled current snapshot that does not run the full forecast;
- explicit forecast state machine: idle/running/stale/completed/incomplete/unsupported/error;
- Web Worker or equivalent off-main-thread long forecast execution;
- request identity and stale-response suppression;
- meaningful edit commit/debounce behavior rather than heavy work on each keystroke;
- automatic baseline forecast when valid execution configuration exists;
- in-memory deterministic result cache using an application-owned calculation fingerprint;
- lazy explanation resolution;
- bounded/virtualized/collapsed detailed tables;
- summary-first chart rendering.

Persistent derived caching may be added later behind a discardable/versioned cache boundary.

## 5. R3 — Deterministic engine optimization

Use R1 measurements to rank work. Likely candidates include:

- contention/linearization enumeration;
- repeated authoritative-state/primitive-state cloning;
- repeated filtering/sorting and object lookup;
- repeated canonical serialization/fingerprinting;
- trace materialization;
- recompilation of invariant schedules/dependency metadata.

Do not optimize semantic ordering by assumption. Scheduler or execution changes must demonstrate equivalence against the current authoritative semantics with reference/property tests.

R3 SHALL create the immutable compiled-plan/reusable execution boundary required by PFA-PERF-011 before R6 high-count orchestration.

## 6. R4 — UX/editor cleanup

May overlap R2/R3 because it is independently valuable for UAT.

Implement PFA-UX with emphasis on:

- friendly entity labels and relationship resolution;
- no duplicate title/name summaries;
- no primary raw UUID display;
- removal/replacement of Choose-only unsupported reference controls;
- domain-oriented editing instead of primitive/rule IDs;
- structured advanced/expert/technical drill-down;
- improved charts/status states and novice-first information hierarchy;
- component decomposition where it reduces rerender coupling.

## 7. R5 — Stochastic runtime foundation

Implement the existing higher-authority stochastic semantics before Monte Carlo orchestration:

- seeded RandomSource/RandomStream implementation;
- stable process identities/substreams;
- P31 probabilistic and P33 correlated-process executable support needed by the initial model;
- immutable stochastic run configuration;
- one reproducible stochastic household realization;
- explicit rejection of unsupported distributions/dependencies.

Do not add high realization counts until one realization is semantically complete and reproducible.

## 8. R6 — Monte Carlo orchestration

Add:

- compile-once/many-realization execution;
- worker pool or bounded parallel batches;
- deterministic realization identity independent of scheduling;
- streaming/online distribution aggregation;
- bounded memory;
- progressive refinement;
- convergence/sampling metadata;
- representative-path capture;
- paired realization IDs for scenario comparison where valid;
- stochastic performance telemetry.

Initial path counts and convergence budgets shall be established empirically.

## 9. R7 — Baseline probabilistic household model

Introduce uncertainty incrementally:

1. broad asset-class returns and correlations;
2. inflation;
3. material interest-rate processes;
4. income/salary uncertainty;
5. expense variability;
6. later employment, longevity, major expense, real-estate, and other life-event processes.

User decisions remain explicit scenario controls unless behavioral uncertainty is intentionally enabled.

## 10. R8 — Market/economic calibration

Implement the normalized CalibrationSet boundary and one or more provider adapters.

Prefer established market/sector/asset-class assumptions with explicit provenance, horizon, volatility/dependence, and version pinning. Do not silently blend institutions.

Company-specific data is added only where exposure is material or explicitly requested.

## 11. R9 — Concentration and equity compensation

Resolve the canonical representation of equity awards, then add:

- material issuer-concentration detection;
- sector/issuer factor refinement;
- RSU vesting/forfeiture/withholding lifecycle;
- employer-stock and human-capital correlation;
- concentrated-tail outputs and hold/sell/diversify scenario support.

Do not model unvested RSUs as ordinary liquid investments.

## 12. R10 — Probabilistic decision UX

Make probability/distribution outputs the primary future-outlook experience:

- percentile fan/range charts;
- threshold probabilities;
- liquidity-shortfall probability;
- scenario probability deltas;
- calibration/model-assumption disclosure;
- drill-down to deterministic representative paths/explanations.

Retain deterministic baseline views for audit and explanation, but do not present them as the single expected future.

## 13. T1 — Tax parallel track

After R2/R3 execution seams are stable, comprehensive tax work may progress in parallel with R5-R9.

The tax engine remains deterministic per realization, effective-dated, explainable, and instrumented. Stochastic simulation may initially use the currently supported tax subset, with capability diagnostics for unsupported tax semantics.

## 14. R11 — Personal-use stabilization gate

Before private-alpha infrastructure:

- performance budgets are documented and met for supported realistic use;
- current-state UI is responsive;
- deterministic forecasts do not block the UI;
- probabilistic forecasts are reproducible and convergence metadata is interpretable;
- major UAT editor/UX defects are resolved;
- caching cannot make stale results look current;
- supported equity concentration/equity-comp cases are financially coherent;
- privacy/persistence boundaries remain suitable for personal use.

Private-alpha PR A-H remains governed by the system/software architecture and begins after this gate.
