# Probabilistic Forecasting

**Version:** 0.1.1-draft
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

A persisted stochastic forecast SHALL reference the exact canonical/model calculation fingerprint, stochastic configuration, and immutable calibration content fingerprint that produced it. By default, the application SHALL persist only bounded aggregate/summary results needed to restore the latest successful forecast for a saved scenario/configuration; it SHALL NOT persist every Monte Carlo path or every intermediate rerun.

When inputs change, the prior successful stochastic result MAY remain visible only as explicitly stale. Triggering a replacement run SHALL NOT destroy the last successful result. The prior result is replaced atomically only after the new run completes successfully. Failed, cancelled, or superseded runs SHALL NOT replace the last successful result. The product MAY later support user-pinned historical forecast snapshots as an explicit feature.

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
- exact bounded-retention/garbage-collection policy for superseded unpinned result summaries.
