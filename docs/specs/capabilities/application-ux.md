# Application UX & Financial Comprehension

**Version:** 0.1.7-draft
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

### PFA-UX-021 — One authoritative financial fact and one natural editor

Before U1/D1 user acceptance, the product SHALL implement the canonical normal-user **financial fact ownership registry** at `docs/specs/verification/u1-fact-ownership.json`. Its versioned registered fact families are a signed-off **product architecture inventory**, not evidence that the application has been migrated. The registry assigns one naturally located **normal-user write owner** per materially distinct semantic identity, plus explicit read-only mirror surfaces, source/provenance, dependency/derivation, resolution rules and delivery gates. All supported rendered normal-user controls SHALL be covered by a registry family. New controls without one unambiguous owner or an approved conditional/unsupported status SHALL fail UI contract verification.

**Semantic identity is more than a field name.** Keys SHALL distinguish person or filing unit, employer/sponsor and actual retirement-plan identity, legal bucket and contribution character, effective tax year/as-of/coverage interval, asset/account/holding/event/scenario ID, and source/provenance where it can alter meaning. Distinct years, employers, plan terms, prior actual contribution usage and proposed future schedules SHALL NOT be coalesced. Source facts are persisted once per true scope; derived/forecast values are computed for that scope, not independent editable canonical facts. Audit and preserved import source records may remain as immutable provenance—not second normal-user edit authorities.

**Adjacent ownership, not forced cross-page repairs:** all salary amount, frequency, growth and take-home deposit routing live together on **Money → Income**; personal/retirement account settings, employer-plan terms, their contributions, prior YTD usage and annual capacity appear in **Net Worth → Investments & retirement**; mortgage contract, scheduled payment, chosen bank funding, extra principal and refinance live in **Net Worth → Debt**; checking/savings and their interest live in **Money → Accounts**; ordinary spending and its growth/funding live in **Money → Spending**; person DOB/residence, household relationship and dated tax/health eligibility live with the person/household; retirement-event date lives in **Plan → Life Events**; planned scenarios/horizon and true execution choices live in **Plan → Current Plan**. The future Taxes workspace (#102) may assume tax profile/settlement ownership only in a **controlled handover** with its former editor removed. An old navigation menu cannot remain a competing save route because a new page has a nicer label.

**U1 financial-operation and insurance ownership (registry extension):** Investment purchases and contributions retain their existing account/holding entry points; **sales, lot elections, option exercises, dividends/interest, reinvestment, in-plan conversions, direct/split rollovers and linked indirect distribution/60-day deposits** are individually scoped operations edited under **Net Worth → Investments & retirement → affected account/holding → Activity & transfers**. The transaction owner is an executed or scheduled Event/Effect/PrimitiveInstance with source/destination identities, date, character and relevant funding—not a duplicate Investment holding fact, ordinary Income/Expense line, or a second contribution. Opening acquisition lot/basis remains with the holding. Qualified dividend character, rollover acceptance, exercise terms, tax basis, withholding and deadline must be sourced or explicitly confirmed only when authoritative; do not invent facts or silently classify retirement transfers as earnings/expenses. Link both accounts in transfer operations, and reuse their single owner editor from all summary/cash-flow/plan displays.

**Insurance is not an investment account or a duplicate expense entry.** A dedicated **Money → Insurance & coverage** subsection SHALL own supported personally held **term-life Insurance policy contracts**, including owner, insured person, one beneficiary, coverage dates, contracted premium and source bank, benefit face amount and beneficiary settlement account together in one policy-context editor. Premiums appear read-only in Spending/Cash Flow and are posted only once through D1; a life benefit does NOT appear as current net worth or forecast cash unless its contingency executes. A **scheduled insured death** is a separate scenario/event assumption owned by **Plan → Life Events**, not an intrinsic policy term. Insurance SHALL show and open the same Life Events editor inline/contextually so the user can configure a coverage stress case without page hunting or a second independently editable death date. Legacy policies that reference previously authored death events SHALL preserve those IDs and links. A new policy can exist *without* an automatically invented death event; unsupported cash-value/claim families remain gated. The registry splits contract sources from calculated/conditional claim output, preventing face value from being confused with a paid benefit. The investment-operation and insurance families are U1 **existing-control ownership**, not new D1 financial execution formulas.

**Mirrors** (Money Cash Flow, Overview, plan summaries, Net Worth dashboards, global assumptions, counterparties) SHALL display the same resolved value, provenance, effective date and direct Open/Edit owner action; no copy-edit or second save. Editing a named entity opens the correct panel with related source facts, affected derived results and immediately adjacent repair controls. **When a derived field's single owner belongs to another screen, use the same underlying owner editor in a contextual drawer/sheet on the current page where feasible** (for example, edit the named employer's income contract directly from a 401(k) eligibility conflict). The action must share the exact same save authority and validation as the owner's normal page, not duplicate field state, and offer a direct full-page route only as a fallback. A missing employer, account, spouse, or filing status SHALL NOT send users through unrelated pages to repeat the same value. Context-specific exceptions must be obvious from the exact missing authority, not vaguely labeled “eligibility facts.”

### PFA-UX-022 — Derive before asking, but never invent legal or accounting facts

The U1 authoring domain SHALL provide a **typed, reusable, deterministic fact resolver**, not a UI-only cache: `resolve(factKind, person/household, sponsor/plan, taxYear, effectiveDate, scenario, inputSources)` returning a value with exact provenance, recognized source, rule version, confidence/status (`known`, `derived`, `explicit_assumption`, `missing_authority`, `true_conflict`, `unsupported`), affected dependencies, and source-owner route. Never use JavaScript floating-point financial approximation as an authoritative derivation. The registry's directed `derives_from` relationships must remain **acyclic**, with supported versioned rule/contract evidence for each derived branch.

Mandatory derivations when qualified: age-at-year-end from date of birth and year; actual monthly posted income/expenses and payments from the correct authorized ledger; account/position/asset values from **compatible** price/quantity/quote date or legitimate recorded valuation method; scheduled mortgage amount from authoritative loan schedule; known prior contributions from reconciled actual posted history; and future **wages** from the dated income/growth/termination model. Pay cadence/event date and funding source remain explicit. A forecast-year deduction or capacity SHALL be recalculated from the resolved inputs for that year and applicable law, not stored as independent user-entered dollars.

**Conditional, not automatic unless the governing authority exists:** plan-eligible compensation may differ from gross wages; previous-year wages must match the **same sponsor** and complete preceding-year income, not the current pay rate; IRA-eligible compensation may have special income/spousal rules; Roth/deductible IRA MAGI is **not** gross salary; filing status is not implied by marital status alone; HSA coverage requires dated eligible coverage; employer Roth plan support is sourced from terms, not a Roth balance; mortgage current principal differs from loan origination principal; annual tax liability differs from payroll withholding; bank-account balance differs from unspent paycheck; investment transfers and loan principal are cash uses but not consumption. Unknown/provisional facts never become implicit zeroes or evergreen carry-forwards.

**Remove the blanket “Assume these annual personal facts stay unchanged in future years” from normal U1 authoring.** Derive the individual future-year facts when support exists and show linked, explicitly named dated assumptions only for facts that are genuinely choices. The existing `confirmed_nominal_carry_forward` executable mechanism must not be used silently to assert salary-driven pay, MAGI, employer previous-year wages or coverage remain fixed. If annual engine projection/law support is not available within U1 authority, surface an exact incomplete boundary, link to its source and return a precise scoped implementation blocker for ChatGPT architecture authorization; do not invent projected facts, change canonical law or silently restrict a valid household to a shorter horizon.

### PFA-UX-023 — Safe conflict elimination, migration and truthful diagnostics

**Automatic resolution is mandatory when deterministic and lossless:** identical same-scope facts are one shared value; raw copied policy-snapshot differences that are not legally material (serialization order, UI labels, ID metadata, unused projection flags) do not make a `HISTORICAL_SCOPE_CONFLICT`; a fully qualified known authoritative source populates read-only mirrors and dependent projections without user transcription. Existing duplicated writable paths SHALL be eliminated or redirected to the sole owner. Historical and future policies may persist as compatibility/audit carriers during migration, but their read views must resolve through one authority; updates must be atomic, stable, reversible where possible, idempotent and verified against the original forecast/postings.

**Never automatically choose between two materially different observations or assertions:** employer plans or tax years legitimately differ; conflicting recorded pay for the same employer/date, contradictory filing status, tax coverage and historical contribution totals require user/source reconciliation. A newer timestamp, importing a CSV, or “most recent save” is *not* a valid universal precedence rule. The product SHALL identify the two **named sources**, precise field/year/plan, why they disagree, and provide one in-context repair dialog that preserves originals and records the explicit reconciliation decision. Underlying policy errors remain in technical details; raw codes must never reach ordinary panels, prior-YTD disabled buttons, import/reload errors, global diagnostics or forecast cutoff explanations. One concise sentence states cause; one states the next supported action.

Each ordinary workflow SHALL demonstrate: one editable source for each registry family, no independently editable mirror, no redundant user-entered derivative, no unsourced auto-fill, no silent overwrites, no broken deep links, and no changing prior usage by projecting future contributions. Unit, integration and browser assertions SHALL cover every registry-owned normal-user field, both valid and genuinely conflicting multi-employer/household years, save/reload/import, year transition, missing authority and preserved economic posting semantics. Tests SHALL **fail when a second writable owner or formerly covered normal field is introduced**. A green suite does not substitute for independent authoring/financial audit and uncoached owner UAT.

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
