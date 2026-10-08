# Application UX & Financial Comprehension

**Version:** 0.1.5-draft
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

When valid execution configuration exists, the deterministic baseline forecast SHOULD load automatically and refresh after validated meaningful changes using debounce/supersession/caching. The UI SHALL visibly indicate running/recalculating state and SHOULD retain the previous valid result marked stale while a replacement is computed.

### PFA-UX-007 — Bounded detailed rendering

Primary forecast views SHALL emphasize clear charts, key metrics, ranges, and decisions. Large monthly tables, complete trace metadata, and row-by-row explanation SHALL be secondary drill-down and SHALL follow the bounded-rendering requirements of PFA-PERF-008.

### PFA-UX-008 — Probabilistic-first future outlook

Once probabilistic forecasting is supported, the primary long-term outlook SHALL emphasize distributions, percentile ranges, modeled threshold probabilities, downside/liquidity risk, and scenario deltas rather than presenting a single deterministic future as the expected truth.

### PFA-UX-009 — Accessible and responsive presentation

Financial charts, tables, forms, status messages, and drill-down interactions SHALL be keyboard-accessible, semantically labeled, responsive across supported layouts, and understandable without relying solely on color.

### PFA-UX-010 — Separate deterministic and stochastic refresh lifecycles

The product SHALL distinguish a fast deterministic preview from the higher-cost stochastic forecast. Deterministic results SHOULD refresh automatically after validated committed/debounced edits. A stochastic rerun SHALL require an explicit user action against the confirmed/saved model state rather than firing on every field edit.

The forecast visualization SHALL allow the user to inspect deterministic and probabilistic views of the same material metrics, whether as separate modes, overlays, or another comparably clear presentation. If model inputs have changed since the last stochastic run, that stochastic result MAY remain visible only with an explicit stale/out-of-date state and its source model/calibration metadata. The last successful result SHALL remain visible while a replacement run executes and SHALL be replaced only after successful completion.

### PFA-UX-011 — Forecast Basis comparability

The product SHALL visibly distinguish controlled apples-to-apples scenario comparisons from historical snapshots calculated under different assumptions. When compared results do not share the required Forecast Basis, the UI SHALL identify the material basis differences (for example calibration date/version, tax-rule set, data cutoff, or horizon) and SHALL NOT present the raw delta as though only the user's decision changed.

For decision comparison, the product SHOULD offer an action to rerun selected saved plan/scenario definitions under one common current or explicitly selected Forecast Basis. Historical "what did my forecast show then?" views MAY remain available but SHALL be labeled as historical/non-normalized comparisons.

### PFA-UX-012 — Saved forecast management

The UI SHALL distinguish saved plan/scenario definitions from saved stochastic forecast snapshots. A plan may remain saved even when its derived forecast expires or is deleted.

User-facing forecast-snapshot quotas SHOULD be expressed as a simple saved-snapshot count. Recovery-window results SHALL be distinguishable from explicitly pinned/saved snapshots, and the UI SHOULD provide a straightforward restore action during the recovery period. Storage-byte quotas and deduplication are backend safeguards and SHOULD NOT be exposed as the primary user mental model unless a product plan later requires it.

### PFA-UX-013 — Strategy tradeoffs and recommendation transparency

When planning strategies or modeled recommendations are shown, the UI SHALL identify the material decision differences, relevant goals/constraints, Forecast Basis/evaluation fidelity, and materially important capability limitations. It SHALL present tradeoffs rather than an unexplained universal score and SHALL distinguish a bounded modeled recommendation from a guarantee or exhaustive proof of optimality.

### PFA-UX-014 — Semantic authoring integrity

For private-alpha financial inputs, the normal editor SHALL expose only controls whose financial meaning and executable behavior are defined for the supported product scope.

The application SHALL:

- distinguish account containers, investment positions, and standalone property/assets in user language;
- respect creation-only/immutable versus editable versus derived fields;
- prevent known-invalid funding-source choices before forecast execution where the valid set is known;
- not expose a standalone expected-return, volatility, or similar field as executable when the current engine requires a different explicit assumption/model contract;
- show rate basis, frequency, and units when they materially affect meaning;
- derive redundant values when the authoritative inputs make the result unambiguous rather than requiring duplicate entry; and
- translate capability diagnostics into actionable user guidance while retaining technical codes/IDs only in technical detail.

An editor that appears to accept a value which the canonical model silently refuses or the forecast necessarily rejects does not satisfy this requirement.

### PFA-UX-015 — Calm, high-information presentation

Normal-user screens SHALL be clean, scannable, visually consistent, and detailed **without being verbose or crowded**. The first view of an account, plan, or forecast SHALL foreground a small set of meaningful values, status, future activity, and next actions. Secondary financial detail SHALL be revealed through clearly named expandable sections, drill-downs, or contextual help; technical details SHALL remain opt-in.

The UI SHALL NOT make the user scan long instructional paragraphs, repeated field explanations, raw diagnostics, or every canonical field to complete a common task. Collapse is not permission to hide essential actions, blocking problems, financial qualifications, or important assumptions. Default expanded/collapsed states SHALL reflect user goals and severity, not implementation object structure. Visual hierarchy, spacing, grouping, alignment, and consistent input sizing SHALL communicate structure without excessive decoration or competing emphasis.

### PFA-UX-016 — Reusable human-facing field contract

Every normal/advanced financial control in the supported authoring journeys SHALL have a shared field-presentation definition containing, as applicable: concise user-facing label, short meaning, why it matters, unit/frequency/basis, expected format, concrete example, required/optional/derived/read-only state, source of truth, dependencies, validation, and disclosure level.

Common fields SHALL use plain language; legal and calculation-specific names MAY appear in contextual help when financially important. Contextual explanations SHALL be available through accessible hover, focus, click, and touch interactions, including a persistent expanded alternative where needed. Percentages SHALL be understandable in ordinary percent units while preserving authoritative exact-decimal rates. Structured canonical data SHALL use a domain control or safe secondary read-only presentation, never unsafe string coercion or raw JSON as the primary editor.

New supported user-facing controls without the required field metadata SHALL fail automated UI contract verification. Existing user-facing fields within the U1 scope SHALL be inventoried rather than only repairing previously reported labels.

### PFA-UX-017 — Linked financial inputs and contradiction prevention

A common financial relationship SHALL NOT be authored as unrelated conflicting free-entry fields. When existing authoritative facts determine a value unambiguously, the UI SHALL calculate/display it; otherwise it SHALL offer a clearly explained, optional calculated suggestion. Mutability, confirmation, and provenance remain governed by canonical financial semantics.

The UI SHALL provide immediate field- and section-level cross-field validation, valid-option filtering, and explicit dependencies. Examples include mortgage contractual payment schedule versus projected early payoff, Current Plan bounds versus simulation window, eligible contribution funding/destination selection, and payroll- versus bank-funded contributions. Invalid combinations SHALL be prevented or identified before a user trusts the forecast; the UX SHALL NOT create a second financial formula or silently change unrelated canonical facts.

### PFA-UX-018 — Actionable, non-repetitive validation and diagnostics

Every invalid or incomplete normal-user workflow SHALL tell the user what is wrong, why it matters, where it occurs, and the next available action. Blocking input errors SHALL mark the affected control and section visually and accessibly, appear in a concise page-level summary, and provide direct focus/navigation to repair. Warnings, partially modeled/unsupported capabilities, stale output, and blocked execution SHALL have distinguishable meanings, not share an undifferentiated red error treatment.

One semantic cause SHALL produce one primary user-facing diagnosis and remedy, with affected-output scope summarized concisely. Raw codes, rule lineage, UUIDs, occurrence counts, and full diagnostic payloads SHALL remain in deliberately opened technical details. A known unavailable rule SHALL NOT masquerade as a user-input mistake, and an invalid setup SHALL NOT be disguised as normal projected-law uncertainty. Hiding or deduplicating presentation SHALL NOT suppress underlying engine diagnostics or unsupported financial outcomes.

### PFA-UX-019 — Task-first financial navigation and guided setup

Normal financial tasks SHALL begin from financially recognizable objects and intentions, not internal model entities. The account/holding view SHALL make existing future contributions and a contextual contribution action discoverable; personal IRA/brokerage flows SHALL route to the authoritative bank-funded authoring contract, while 401(k)/HSA workplace flows SHALL route to the authoritative payroll contract. Mortgage editing SHALL distinguish contractual maturity from projected payoff.

Forecast Setup SHALL group required data by understandable purpose, visibly list missing prerequisites, link/focus each required control, and offer one prominent apply/run or update action. Where valid configuration exists, the existing automatic deterministic refresh behavior SHALL remain. Source-of-funds, account-owner, tax settlement, and projected-law limitations SHALL be presented in user terms with advanced financial detail available as needed.

### PFA-UX-020 — Uncoached UAT and responsive interaction proof

U1 acceptance SHALL require product-owner task-based UAT without a technical click-by-click instruction script. Representative goals SHALL include authoring personal and payroll contributions, editing income and assumptions, configuring mortgage and horizon, setting up/running a forecast, fixing an invalid input, and interpreting a partially modeled tax result.

Automated browser verification SHALL cover the same normal-user routes, including accessible help, missing-field highlighting and direct repair navigation, cross-field contradiction handling, no unexpected console/page errors, and readable desktop/narrow layouts. Expandable detail controls SHALL be keyboard and touch usable; text SHALL NOT wrap into one-character columns, obscure primary actions, or overflow controls at supported viewport sizes. A green implementation/unit suite alone does not constitute accepted UX.

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
