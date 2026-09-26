# Tax Engine Capability

**Version:** 0.1.2-draft
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

Supported RSU/options/ESPP mechanics SHALL integrate vesting/exercise/sale recognition and withholding with the tax engine according to PFA-EQ and SHALL NOT use an unrelated shortcut calculation.

### PFA-TAX-008 — Output-level tax completeness

Missing tax capability SHALL gate outputs at the smallest materially affected boundary. A derived metric/result that can be materially changed by unsupported tax recognition, liability, withholding, settlement, or tax-driven funding behavior SHALL NOT be presented as a complete household forecast. The result SHALL be blocked or explicitly scoped as incomplete with machine-readable missing-capability diagnostics.

Outputs whose dependency/lineage is demonstrably unaffected by the missing tax capability MAY remain available. The application SHALL NOT globally suppress tax-independent outputs merely because another household output is tax-affected.

### PFA-TAX-009 — Target-cohort tax floor

Before a probabilistic result is exposed as a complete user-facing household forecast, the implemented tax subset SHALL cover the tax semantics materially relevant to that target household and output. The application MAY develop/test stochastic infrastructure against a narrower synthetic tax subset, but production/alpha results SHALL remain capability-gated until the applicable tax floor is satisfied.

### PFA-TAX-010 — Private-alpha core tax coverage

The private-alpha tax floor SHALL target ordinary salaried/investor households rather than exhaustive tax-law coverage. For an alpha household/output, the supported floor SHALL include every materially applicable item from the following set:

- federal ordinary income tax with filing status and progressive brackets;
- the standard deduction and basic deduction mechanics required by the target household;
- employee payroll taxes, including Social Security and Medicare where applicable;
- state income tax for jurisdictions represented by the alpha cohort;
- local income tax where materially applicable to an alpha household;
- taxable interest and ordinary dividends;
- qualified-dividend treatment where modeled;
- short-term and long-term capital gains for modeled realized sales/liquidations;
- basic traditional retirement-account contribution/withdrawal tax treatment;
- basic Roth contribution/withdrawal tax treatment;
- NIIT where the target household/output can materially encounter it;
- withholding/estimated-payment/settlement behavior sufficient for the supported after-tax cash-flow outputs; and
- RMD or other retirement-distribution tax mechanics when the person's age/horizon makes them material to the output.

Property tax MAY remain an explicit household expense when no tax-rule interaction is needed. Sales tax MAY remain embedded in spending assumptions unless separately modeled.

Self-employment/business taxation, AMT, complex credits/phaseouts, rental/pass-through taxation, foreign tax, estate/gift tax, and equity-compensation-specific taxation MAY remain T1B capability-gated unless an intended alpha household requires them. If such a household is admitted, the applicable mechanic becomes part of that household's required tax floor before affected outputs are presented as complete.

### PFA-TAX-011 — Shared versioned tax-rule catalog

Canonical TaxRule remains the semantic shape for an effective-dated tax rule, but common tax-law definitions SHALL be stored as a reusable versioned rule catalog rather than duplicated into each household. The catalog SHALL support immutable rule/version/content identities, jurisdiction/effective dates, provenance/source metadata, and deterministic content fingerprints sufficient to reproduce a forecast basis.

During the personal/local stage, the rule catalog MAY be version-controlled application data shipped with the app. Before/within private-alpha shared persistence, common rule definitions SHOULD be stored once per effective rule version/content fingerprint in shared persistence. Household/scenario data SHALL store the facts, elections, overrides, and rule references needed to resolve applicable rules, not full duplicate copies of common law data.

Executable algorithms belong in the rules engine and SHALL remain separate from the versioned rule data they evaluate. Forecast results and Forecast Basis metadata SHALL reference the exact resolved tax-rule-set fingerprints used.

Portable export/import SHALL preserve enough rule identity/fingerprint information to detect whether the referenced rule set is available and compatible. Whether exports embed a referenced rule bundle or rely on a resolvable catalog is a later transport/persistence decision; silent substitution with a newer rule set is forbidden.

## 3. Planned decomposition

Later tax specifications may be split by federal, state/local, payroll, investment/capital-gains, retirement, equity-compensation, and estate/gift domains when actual implementation breadth justifies that decomposition.

## 4. Output availability during incomplete tax coverage

Generally tax-independent outputs can include observed current balances/current net worth, contractual debt schedules, gross income/expense schedules, and explicitly pre-tax quantities when no downstream tax-dependent funding/state transition feeds back into them.

Generally tax-affected outputs include after-tax/disposable cash flow, forecast cash/liquidity, savings capacity, liquidation proceeds, retirement-withdrawal outcomes, realized taxable investment outcomes, RSU/equity-compensation outcomes, tax-sensitive scenario comparisons, and any future net-worth/goal/liquidity probability whose path depends materially on those taxes.

These are examples, not a hard-coded list. Runtime output validity SHOULD be driven by dependency/lineage and capability diagnostics so the system blocks only what is actually affected.

## 5. Sequencing

Comprehensive tax implementation need not block the stochastic runtime foundation, but stochastic architecture SHALL leave a deterministic per-realization tax seam. A common-household/target-cohort tax floor (T1A in the roadmap) SHALL mature in parallel with deterministic optimization and stochastic infrastructure and SHALL be complete before tax-affected probabilistic outputs are presented as complete. T1A SHALL implement PFA-TAX-010 for the actual private-alpha cohort and PFA-TAX-011's reusable catalog boundary. Advanced tax domains (T1B), including specialized business, retirement, equity-compensation, estate/gift, foreign, and other complex cases, gate only the outputs that depend on them.

Tax performance must be measured before high-realization-count production forecasts rely on it.
