# Tax Engine Capability

**Version:** 0.1.0-draft
**Status:** Post-PR21 capability outline
**Requirement prefix:** PFA-TAX

## 1. Purpose

This specification reserves the architecture for a comprehensive tax capability while preserving the existing TaxRule identity/effective-dated rule semantics. It prevents future tax work from becoming a separate inconsistent simulation engine.

## 2. Normative requirements

### PFA-TAX-001 — Deterministic rule execution per realization

Tax calculation SHALL be deterministic for a fixed household state, effective rule set, scenario, and stochastic realization. In probabilistic forecasting, the tax engine SHALL execute inside each realization using the same authoritative recognition/obligation/settlement semantics rather than applying a post-hoc tax percentage to aggregate outcomes.

### PFA-TAX-002 — Effective-dated and jurisdiction-aware rules

Comprehensive tax support SHALL preserve jurisdiction, effective dates, filing/status inputs, rule version identity, and data provenance needed to reproduce a calculation for a given tax period.

### PFA-TAX-003 — Recognition and settlement separation

Taxable recognition, tax liability/obligation creation, withholding/estimated payments, settlement, refund/credit, and account/state effects SHALL remain explicitly distinguishable in accordance with executable financial semantics.

### PFA-TAX-004 — Explainable calculations

Material tax outputs SHALL carry calculation lineage sufficient to identify taxable bases, applied rule versions, major deductions/credits/limits, and the financial events that produced the tax result.

### PFA-TAX-005 — Performance instrumentation

Tax execution SHALL participate in PFA-PERF phase timing and benchmark fixtures so stochastic scaling can distinguish tax cost from other engine cost.

### PFA-TAX-006 — Law uncertainty is explicit

Future tax-law uncertainty SHALL be modeled only through explicit scenarios/stochastic policy processes with provenance. The deterministic tax engine SHALL NOT silently guess future law changes.

### PFA-TAX-007 — Equity compensation integration

Supported RSU/options/ESPP mechanics SHALL integrate vesting/exercise/sale recognition and withholding with the tax engine according to PFA-EQ and shall not use an unrelated shortcut calculation.

## 3. Planned decomposition

Later tax specifications may be split by federal, state/local, payroll, investment/capital-gains, retirement, equity-compensation, and estate/gift domains when actual implementation breadth justifies that decomposition.

## 4. Sequencing

Comprehensive tax implementation need not block the stochastic runtime foundation, but stochastic architecture SHALL leave a deterministic per-realization tax seam. Tax performance must be measured before high-realization-count production forecasts rely on it.
