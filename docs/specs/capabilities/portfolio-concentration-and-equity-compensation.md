# Portfolio Concentration & Equity Compensation

**Version:** 0.1.1-draft
**Status:** Post-PR21 capability outline
**Requirement prefix:** PFA-EQ

## 1. Purpose

This specification covers concentrated individual-security exposure and employer equity compensation such as RSUs. It exists because a diversified asset-class model is insufficient when household wealth and human capital are materially exposed to the same issuer.

## 2. Normative requirements

### PFA-EQ-001 — Materiality-driven issuer modeling

The default portfolio model SHALL NOT require issuer-specific forecasting for every security. Issuer/sector-specific stochastic refinement SHALL be triggered by an explicit materiality policy or user-selected analysis, with the threshold/policy defined before implementation.

### PFA-EQ-002 — Concentration is a household risk

Concentration analysis SHALL consider the household's total economic exposure to an issuer, including vested holdings and material contingent employer-equity exposure, rather than evaluating each account in isolation.

### PFA-EQ-003 — Employer-risk correlation

When the same issuer materially drives investment wealth and employment compensation, the stochastic model SHALL be capable of correlating issuer outcomes with salary/bonus progression, employment interruption, future grant/vesting outcomes, and other explicitly modeled employer-dependent cash flows. These risks SHALL NOT default to independence.

### PFA-EQ-004 — Unvested awards are not ordinary liquid investments

Unvested RSUs or similar contingent awards SHALL NOT be treated as owned assets, ordinary Investment positions, current owned net worth, or liquid assets. Before vesting they MAY be shown separately as contingent future compensation/economic exposure governed by explicit vesting/forfeiture assumptions. When a modeled vesting event actually occurs and its conditions are satisfied, the resulting shares/cash and compensation/tax effects enter owned household state through the normal recognition/settlement/posting semantics.

### PFA-EQ-005 — Equity-award domain decision before schema mutation

Before implementing RSU/option/ESPP mechanics, the project SHALL decide whether a first-class EquityCompensationAward concept is required or whether existing canonical objects can represent the semantics without ambiguity. Code SHALL NOT invent an ad-hoc award representation ahead of that decision.

### PFA-EQ-006 — Award lifecycle requirements

Any supported equity-award representation SHALL preserve issuer, grant identity/date, award type, units, vesting schedule, vested/unvested state, employment/forfeiture conditions, settlement method, sale/restriction policy, tax treatment/withholding policy, and provenance needed for deterministic replay.

### PFA-EQ-007 — Vesting and taxation remain explicit

Vesting, compensation recognition, withholding/tax, share receipt, and later sale SHALL remain distinct economic/tax/accounting events according to the applicable executable semantics and tax specification. Vesting SHALL NOT be modeled as a simple market-value edit.

### PFA-EQ-008 — Concentrated probabilistic outputs

Probabilistic results for materially concentrated households SHOULD expose the effect of issuer concentration on distribution/tail outcomes and scenario alternatives such as hold/sell/diversify, without presenting company-specific forecasts as certain predictions.

### PFA-EQ-009 — Private-alpha safe degradation

Full issuer-specific stochastic/RSU modeling is not an unconditional private-alpha gate. Before private alpha, the application SHALL nevertheless detect or accept declared material concentration, SHALL NOT silently model a materially concentrated individual security as if it were a diversified holding, and SHALL expose a clear capability diagnostic when full issuer/employer-risk modeling is unavailable.

A limited private-alpha mode MAY provide deterministic concentration totals and explicit price/stress scenarios without claiming issuer-specific probability calibration. If a planned alpha participant requires concentrated-stock or RSU planning, the applicable support SHALL be implemented or the affected outputs SHALL be capability-gated before that participant is onboarded. Full correlated issuer/employer-risk modeling remains a tracked required capability if deferred.

## 3. Modeling hierarchy

Preferred refinement order:

~~~text
broad asset class
  -> sector/factor
     -> issuer-specific factor
        -> correlated employer/human-capital exposure
~~~

This preserves a scalable default for diversified users while supporting edge cases where one employer stock dominates wealth.

## 4. Deferred decisions

- issuer-exposure materiality thresholds;
- canonical award object versus composition;
- valuation of unvested contingent awards;
- treatment of options/ESPPs and blackout windows;
- issuer-risk calibration methodology;
- employment-event process and correlation strength;
- tax-jurisdiction coverage.
