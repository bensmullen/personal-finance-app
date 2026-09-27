# Probabilistic Forecasting

**Version:** 0.1.2-draft
**Status:** Post-PR21 capability outline
**Requirement prefix:** PFA-PROB

## 1. Purpose

This specification defines multi-realization financial forecasting and probabilistic result semantics. It builds on P31 probabilistic, P33 correlated_random_process, RandomStream semantics, scenario semantics, and the authoritative household state-transition engine already defined by higher-level financial specifications.

The purpose is not to create a second approximate financial engine. Each realization is the same financial model evaluated with one explicit realization of uncertain inputs.

## 2. Normative requirements

### PFA-PROB-001 — Same financial engine per realization

A stochastic realization SHALL use the same authoritative accounting, funding, tax/rule, event, liability, investment, valuation, and household state-transition semantics as a deterministic forecast. Randomness SHALL enter only through explicit stochastic inputs/processes.

### PFA-PROB-002 — Reproducible random streams

Every realization SHALL be reproducible from immutable run configuration including master seed, stochastic cohort identity, scenario identity, realization identity, stochastic-process identities, immutable calibration identity/content fingerprint, and applicable specification/engine versions. Scenario identity and stochastic cohort identity SHALL remain distinct. Unrelated process insertion or worker/batch ordering SHALL NOT perturb existing named random streams.

### PFA-PROB-003 — Choices versus uncertainty

User-controlled decisions such as savings rate, retirement date, planned purchase, or debt-payment policy SHOULD remain explicit scenario decisions unless the user intentionally models behavioral uncertainty. Exogenous or partially controllable uncertainty SHALL be represented as explicit stochastic processes rather than hidden noise.

### PFA-PROB-004 — Correlated uncertainty

The probabilistic model SHALL preserve material dependencies among uncertain variables using the existing correlated-process semantics or an explicitly superseding higher-authority rule. Market, sector, issuer, inflation, rate, income, expense, and employer-risk processes SHALL NOT be assumed independent when a material modeled dependency exists.

### PFA-PROB-005 — Compile once, execute many

Multi-realization orchestration SHALL reuse realization-independent compiled work in accordance with PFA-PERF-011 and SHALL support batching/parallel execution without changing the result associated with any realization identity.

### PFA-PROB-006 — Bounded aggregation

The default Monte Carlo path SHALL aggregate distributions incrementally and SHALL NOT retain full period-by-period transactions, traces, and read models for every realization when aggregate statistics suffice. Detailed paths MAY be retained for diagnostics, representative outcomes, or explicit user inspection.

### PFA-PROB-007 — Distribution outputs

Probabilistic results SHALL support at minimum percentile/quantile values, threshold probabilities, modeled liquidity-shortfall probability, and distribution summaries over time for material household metrics such as net worth, cash/liquidity, and cash flow. The UI SHALL distinguish these from deterministic point forecasts.

### PFA-PROB-008 — Convergence and sampling metadata

A probabilistic result SHALL record realization count, seed/configuration identity, aggregation method, and sufficient convergence/sampling metadata to avoid presenting an unstable estimate as precise. Tail-statistic and convergence conventions SHALL be defined before they become user-facing guarantees.

### PFA-PROB-009 — Paired scenario comparison

When two scenarios differ in decisions rather than stochastic-model identity, the comparison SHALL use the same master seed, stochastic cohort, realization identities, and applicable stochastic-process/calibration configuration so the scenarios see the same modeled futures. Scenario identities remain distinct. If a scenario intentionally changes the stochastic model/calibration itself, the result SHALL identify that difference and SHALL NOT claim an apples-to-apples common-random-number comparison.

### PFA-PROB-010 — Conditional probability language

User-facing probabilities SHALL be presented as modeled estimates conditional on the stated assumptions/calibration, not as certain physical probabilities. The system SHALL expose the calibration source/version and material model limitations needed to interpret the result.

### PFA-PROB-011 — Bounded stochastic-result persistence

A persisted stochastic forecast SHALL reference the exact canonical/model calculation fingerprint, stochastic configuration, and immutable calibration content fingerprint that produced it. By default, the application SHALL persist only bounded aggregate/summary results needed to restore the latest successful forecast for a saved scenario/configuration plus, at most, one immediately preceding successful aggregate for change explanation/comparison. It SHALL NOT persist every Monte Carlo path or every intermediate rerun. Older unpinned aggregates SHALL be eligible for deletion.

When inputs change, the latest successful stochastic result MAY remain visible only as explicitly stale. Triggering a replacement run SHALL NOT destroy the last successful result. The new result becomes current atomically only after successful completion; failed, cancelled, or superseded runs SHALL NOT replace it. After success, the former current result MAY become the one bounded predecessor. The product MAY support user-pinned historical forecast snapshots as an explicit feature; pinned results are outside the automatic two-generation retention limit.

### PFA-PROB-012 — Forecast Basis identity

Every retained or compared forecast SHALL identify a deterministic Forecast Basis fingerprint representing the common exogenous/modeling basis under which scenario decisions are evaluated. The Forecast Basis SHALL include, where applicable: opening authoritative-state/model snapshot identity, asOf/data cutoff, horizon/period structure, base currency, immutable market/economic calibration fingerprint, tax-rule-set fingerprints, non-scenario assumptions/policies, stochastic-process configuration, master seed, stochastic cohort/realization-set identity, and engine/spec/model-format versions.

Scenario decision overlays SHALL remain separate from the Forecast Basis. A change to retirement date, contribution rate, purchase decision, debt-payment decision, or another user-controlled scenario choice does not by itself create a different Forecast Basis.

### PFA-PROB-013 — Comparable versus historical scenario comparisons

A scenario comparison SHALL be labeled apples-to-apples only when the compared runs share the required Forecast Basis and, for stochastic comparisons, the common-random-number cohort required by PFA-PROB-009. If retained historical results use different calibration, tax rules, data cutoffs, horizons, or other Forecast Basis inputs, the product MAY display them as historical snapshots but SHALL NOT present their raw delta as a controlled decision comparison.

To compare two saved plan/scenario definitions under current assumptions, the application SHALL support rerunning both definitions against one selected common Forecast Basis. The resulting normalized comparison is distinct from a historical "what did the system show then versus now" comparison.

### PFA-PROB-014 — Recovery window and retained-result quotas

Superseded unpinned stochastic aggregate results SHOULD remain recoverable for a short grace period before garbage collection. The initial product policy SHOULD use a seven-day grace period, configurable without changing financial semantics. Failed, cancelled, or superseded-in-flight runs do not become retained successful results.

User-facing limits on explicitly saved/pinned stochastic forecast snapshots SHOULD be expressed primarily as a simple count rather than storage bytes. The persistence layer SHALL also enforce a backend byte/storage quota as a safety/abuse bound and SHALL deduplicate identical retained artifacts by deterministic content/result fingerprints where practical. Exact count and byte quotas are deployment/product policy and remain TBD until representative result sizes are measured.

### PFA-PROB-015 — Persist aggregates, not the realization warehouse

A retained stochastic result SHALL normally store only the information needed to reconstruct the user-facing forecast and prove/reproduce its basis: per-period aggregate distributions/percentiles for supported metrics, threshold/event probabilities, liquidity-shortfall statistics, selected decision metrics, realization count, convergence/sampling metadata, stochastic configuration/cohort identities, Forecast Basis fingerprint, calculation/model fingerprint, calibration/tax-rule fingerprints, scenario identity, and engine/spec versions.

The system SHALL NOT persist every realization's full monthly state, transactions, accounting postings, or calculation traces by default. Full realization data is ephemeral working data and SHOULD be discarded after bounded aggregation unless an explicit diagnostic workflow requires temporary retention.

The system MAY retain identities and compact summaries for a small number of representative realizations (for example downside/central/upside paths). When the compatible engine, referenced Forecast Basis, and calibration/rule artifacts remain available, detailed representative paths SHOULD be regenerated on demand from their deterministic realization identities rather than permanently storing all details. A pinned long-lived result MAY retain a compact representative-path summary when needed to remain understandable after an old engine version is no longer executable.

### PFA-PROB-016 — Plan definitions are durable; forecast results are derived

A saved plan/scenario definition SHALL be persisted independently from any stochastic result produced from it. Deleting, expiring, or replacing a derived forecast result SHALL NOT delete the user's plan/scenario definition.

This separation SHALL allow a saved plan to be rerun later under a new common Forecast Basis without mutating the historical plan definition, and SHALL allow multiple retained forecast snapshots to reference the same plan definition without duplicating the plan configuration.

## 3. Initial modeling scope

The first useful probabilistic layer should prioritize:

1. correlated broad asset-class returns;
2. inflation;
3. interest-rate processes where they materially affect modeled liabilities/cash;
4. income/salary and expense variability after market mechanics are stable;
5. later employment, longevity, health/major-expense, home-value, issuer, and other life-event uncertainties.

The exact distributions and calibration sources are owned by the Market & Economic Calibration specification, not this document.

## 4. Result examples

The product should be able to answer questions such as:

- modeled median and 10th/25th/75th/90th percentile net worth at a future date;
- modeled probability net worth exceeds a stated threshold;
- modeled probability liquid cash remains above a threshold;
- modeled probability of at least one liquidity shortfall before a date;
- change in those distributions/probabilities when a user changes a decision.

A single binary success probability SHALL NOT be the only probabilistic outcome.

## 5. Deferred design decisions

Before implementation reaches production use, define:

- initial Monte Carlo realization counts and progressive-refinement behavior;
- convergence/error criteria by metric and quantile;
- representative-path selection;
- permitted variance-reduction/quasi-random techniques;
- incomplete/invalid realization aggregation rules;
- final production recovery-window duration and saved-snapshot count/byte quotas after representative storage measurements;
- representative-path selection and long-lived pinned-summary policy when historical engine versions are no longer executable.
