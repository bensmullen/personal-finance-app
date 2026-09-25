# Market & Economic Calibration

**Version:** 0.1.0-draft
**Status:** Post-PR21 capability outline
**Requirement prefix:** PFA-CAL

## 1. Purpose

This specification defines the normalized assumptions/calibration boundary used by probabilistic forecasting. It allows the engine to stand on established institutional research without coupling financial semantics to any one provider.

## 2. Normative requirements

### PFA-CAL-001 — Provider-neutral calibration contract

The financial engine SHALL consume a normalized versioned CalibrationSet or equivalent application-boundary contract and SHALL NOT depend directly on a named research/data provider.

### PFA-CAL-002 — Provenance and methodology identity

Every external calibration SHALL retain provider/source identity, publication/observation date, data cutoff, methodology/version where available, forecast horizon, currency, nominal/real basis, applicable asset/sector/issuer definitions, and licensing/provenance metadata sufficient for audit and reproducibility.

### PFA-CAL-003 — Distribution inputs, not only means

Where probabilistic investment modeling depends on them, calibration SHALL represent the distribution/dependence information actually required by the stochastic model, such as expected return or term structure, volatility, correlations/dependence parameters, and regime/scenario metadata. A single average-return number SHALL NOT masquerade as a complete stochastic calibration.

### PFA-CAL-004 — Explicit provider mapping

Provider adapters SHALL validate and explicitly map external definitions into internal asset-class, sector, factor, issuer, horizon, currency, and return-basis concepts. Unsupported or ambiguous mappings SHALL fail or remain unavailable rather than being silently coerced.

### PFA-CAL-005 — No silent provider averaging

Forecasts from different institutions SHALL NOT be silently averaged or blended. A blended calibration requires an explicit methodology, component identities/weights, version, and rationale so it is reproducible and distinguishable from each source profile.

### PFA-CAL-006 — Hierarchical specificity

Default calibration SHOULD use broad market/asset-class assumptions. Sector/factor assumptions MAY refine material exposures. Issuer-specific assumptions SHOULD be introduced only when a position or compensation exposure is materially concentrated or the user explicitly requests that detail.

### PFA-CAL-007 — Version pinning and freshness

A forecast SHALL identify the calibration version used. Updating external forecasts SHALL create a new calibration identity/version rather than silently changing the inputs of a previously reproducible result. Freshness/staleness policy SHALL be explicit.

### PFA-CAL-008 — Licensed and auditable acquisition

External forecast data SHALL be acquired through permitted public/licensed interfaces and SHALL preserve terms/provenance needed for lawful reuse. The system SHALL NOT depend on brittle scraping of research content or imply an institutional source supplied a statistic it did not publish.

## 3. Initial provider strategy

Early work should support interchangeable profiles sourced from established institutions when their published/licensed data is suitable. Asset-class and sector assumptions are preferred before company-specific forecasts.

Issuer-specific analyst estimates, price targets, earnings forecasts, or fundamentals are not automatically stock-return distributions. If used, their transformation into an issuer-return process belongs to an explicit calibrated model with provenance.

## 4. Calibration object outline

A future contract will likely need:

- calibration_id and version;
- source/provider/methodology identity;
- observed_at, published_at, data_cutoff;
- horizon/term structure;
- base currency;
- real versus nominal basis;
- asset-class/sector/factor/issuer identifiers;
- marginal distribution parameters;
- dependence/correlation data;
- macro/regime assumptions;
- confidence/coverage metadata where objectively supplied by the source;
- license/provenance metadata.

Exact canonical versus application-only persistence is deferred to a focused design decision.
