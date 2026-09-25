# Application UX & Financial Comprehension

**Version:** 0.1.0-draft
**Status:** Post-PR21 capability outline
**Requirement prefix:** PFA-UX

## 1. Purpose

This specification defines the user-facing product principles needed for a financially inexperienced user to understand the household quickly while preserving deep inspectability for advanced users.

## 2. Normative requirements

### PFA-UX-001 — Progressive disclosure

Primary screens SHALL answer common financial questions with concise current-state and outlook information. Advanced calculations, raw traces, IDs, and model internals SHALL remain accessible through deliberate drill-down rather than dominating the default experience.

### PFA-UX-002 — Human-readable entity identity

Entity cards, selectors, relationships, and explanations SHALL prefer colloquial/user-facing names and meaningful financial attributes. Raw UUIDs SHALL NOT be primary labels and SHALL be confined to technical diagnostics/details unless identity debugging explicitly requires them.

### PFA-UX-003 — No dead schema controls

The editor SHALL NOT expose reference dropdowns that cannot be populated or understood merely because the canonical schema contains a field. Unsupported/system-managed/internal primitive/rule references SHALL be hidden, read-only with explanation, or replaced by a domain-specific editor.

### PFA-UX-004 — Structured advanced information

Advanced information SHALL distinguish additional financial details, expert calculation/model details, and technical diagnostics. A generic Advanced section containing unexplained raw IDs SHALL NOT be the main expert interface.

### PFA-UX-005 — Immediate current-state answers

Current net worth, cash, liabilities, and other supported opening metrics SHALL load through the fast current-state path independently of long-horizon forecast completion. Loading, unsupported, invalid, stale, and unavailable states SHALL be distinguishable.

### PFA-UX-006 — Forecast lifecycle visibility

When valid execution configuration exists, baseline forecasts SHOULD load automatically and refresh after meaningful changes using debounce/supersession/caching. The UI SHALL visibly indicate running/recalculating state and SHOULD retain the previous valid result marked stale while a replacement is computed.

### PFA-UX-007 — Bounded detailed rendering

Primary forecast views SHALL emphasize clear charts, key metrics, ranges, and decisions. Large monthly tables, complete trace metadata, and row-by-row explanation SHALL be secondary drill-down and SHALL follow the bounded-rendering requirements of PFA-PERF-008.

### PFA-UX-008 — Probabilistic-first future outlook

Once probabilistic forecasting is supported, the primary long-term outlook SHALL emphasize distributions, percentile ranges, modeled threshold probabilities, downside/liquidity risk, and scenario deltas rather than presenting a single deterministic future as the expected truth.

### PFA-UX-009 — Accessible and responsive presentation

Financial charts, tables, forms, status messages, and drill-down interactions SHALL be keyboard-accessible, semantically labeled, responsive across supported layouts, and understandable without relying solely on color.

## 3. Near-term cleanup scope

The post-PR21 cleanup includes:

- remove duplicate names and raw IDs from entity-card summaries;
- resolve relationships to friendly names;
- replace empty Choose-only reference controls;
- add field descriptions/units and appropriate money/rate formatting;
- split normal, expert, and technical details;
- improve forecast loading/stale/error messaging;
- improve chart proportions, axes, tooltips, summaries, and default data density;
- move complete tables/traces behind drill-down;
- decompose the large UI component opportunistically by feature boundary to reduce rerender coupling.

## 4. Product language

Future probability statements should use language such as modeled probability or under these assumptions. The UI SHALL avoid false precision and SHALL expose material calibration/model assumptions in a way an advanced user can inspect.
