# Level 4 → Codex implementation contracts (review drafts only)

> **2026-10-16 chart-aware plan supersession:** PM approved the **Calm** visual direction. For the current, updated scoped implementation sequence, see [Level 4 financial visualizations — Section 5](level4-financial-visualizations.md) and [Issue #120](https://github.com/bensmullen/personal-finance-app/issues/120). The three phases A–C below are **historical draft contracts**, not current Codex authorization. They were superseded by **A shell/navigation; B core charts; C cash-flow/allocation; D real estate/mortgage; E retirement/planning; F asset attribution deferred**. Do not paste or activate their older V3 blocks.

**Status:** **Superseded draft V3 contracts, NOT current Codex issue authorization**. PM has selected Calm; chart placements and detailed visualization semantics require review. Current phase scope lives only in Issue #120. The existing task issue [#120](https://github.com/bensmullen/personal-finance-app/issues/120) remains U1B/D1_U1's single owner; do **not** create one new issue per screen or independently authorize overlapping changes to `ui/PersonalFinanceApp.tsx`. Source prototype: [HTML Level 4 pilot](prototypes/level4-h04-h08-pilot.html); [design decision/acceptance review](level4-pilot-design-review.md).

**Live source check (2026-10-16):** #120 is an open `PFM_TASK_V3` implementation issue; current allowed paths: `ui/**`, `app/globals.css`, `e2e/**`, `test/**`. #105 is an open planning/UX backlog issue, **not** a V3 authorization. #108 is an open R11/O1 fixture-planning issue, not an executable task. The milestone register assigns #120 to U1 with D1_U1 closeout, #105 to P1 planning UX (depends on #120), and #108 to O1 fixtures (depends on #103/#105/#120). No active agent lessons in the current `agent-lessons.json`. Do not alter stage gates or duplicate their ownership casually.

## 1. Release sequence and governance

**Before any Codex turn:** PM selects and approves a chosen Level 4 treatment and interaction scheme; merge this design-reference PR into main after its CI passes; source app/branch operator bootstrap runs outside Codex; issue #120 is updated to contain **exactly the current approved phase** as its V3 top-level authorization (record completed earlier phases and latest verified evidence in an appended implementation-history section). Then send only `PFM_TASK_ISSUE: 120` to Codex. After each PR, independently audit semantics/visuals, synchronize #120, and merge before the next overlapping UI phase. Do not have Codex render/check screenshots, run local browser servers, or poll GitHub CI.

**Why serial:** navigation, page rendering, source-owner editor composition, and forecast display share the current `ui/PersonalFinanceApp.tsx` and `app/globals.css` hotspots. Even apparently independent Money/Plan tasks would conflict across these shared interfaces. Permissible parallel work remains limited to separate D2/domain fixtures/backends with stable published interfaces and disjoint write ownership.

**Phase order:** A shared navigation/diagnostic shell → B current task-centered source surfaces → C age-based plan setup and truthful forecast display → independent UAT/audit patches → #105 after safe plan identity and #120 UX closeout → #108 synthetic persona library when D2/#105 gates satisfied. The age-90 backend execution/cost/tax-law work is a separately scoped architecture/roadmap decision, not a CSS-only U1B change.

## 2. Proposed Issue #120 Phase A: shared shell, overview and diagnostic density

```text
PFM_TASK_V3
TASK_KIND: product
TARGET_BRANCH: codex/u1b-a-navigation-diagnostics
DEPENDENCY_POLICY: locked

ALLOWED_PATHS:
- ui/**
- app/globals.css
- e2e/**
- test/**

OBJECTIVE:
Implement the approved Level 4 shared visual/navigation shell, Overview first-screenful, compact issue presentation and source-edit return pattern on top of the U1A financial-authoring foundation. Preserve existing five primary navigation areas, canonical fact owners and every authoritative financial operation.

ACCEPTANCE:
At 1440px and 390px, an uncoached user sees named current household/as-of, three to five *sourced* current-state metrics, one clear primary question/action and a concise relevant status before long forecast detail. Mobile always exposes the current destination and a discoverable More path to all major task sections. One semantic cause appears as one short actionable diagnosis with its correct owner source and one targeted Fix action; technical rule IDs remain opt-in. A missing/incomplete/unsupported forecast cannot push valid current Income/Investments/Debt task content several screenfuls down. Contextual owner edit Save/Cancel/focus returns to original task without duplicate writer, lost selected period or unintended model mutation. Explicit loading, empty, blocking, warning, stale and unsupported presentation; keyboard/touch responsive. Existing source and forecast semantics remain unchanged; no rebuilt financial formulas. Tests for these paths pass in GitHub; PM uncoached UAT is pending independent review.
```

**Additional implementation decisions (not delegated):** reference [chosen Level 4 prototype](prototypes/level4-h04-h08-pilot.html) and [Level 3 pilot state matrix](level3-pilot-state-matrix.md); focus on the page *structure and behavior*, not matching mock figures. Keep five existing product areas, not the prototype's shortcut-only flattened IA. Expandable groups start closed for advanced details but never hide the highest-risk actionable blocker. Contextual sheet reuses existing `FieldShell`, `GuidedFields`, `EditorHub` and source repair logic; no second state authority. No blanket large-CSS migration. Preserve existing e2e acceptance and add minimal relevant tests; do not use 8-persona #108 as a prerequisite for shell work. **Review gate:** latest-head CI, independent current-head screenshot comparison, PM feedback, semantic check of posted assets/loans/tax statuses; then synchronize #120 for phase B.

## 3. Proposed Issue #120 Phase B: cash, debt and investment tasks

```text
PFM_TASK_V3
TASK_KIND: product
TARGET_BRANCH: codex/u1b-b-financial-task-surfaces
DEPENDENCY_POLICY: locked

ALLOWED_PATHS:
- ui/**
- app/globals.css
- e2e/**
- test/**

OBJECTIVE:
Complete Level 4 task-first current-position, Cash Flow, Income, Spending, Accounts, Debt, Investments & retirement, and Insurance & coverage views using the reviewed shell from phase A. Reduce exposed schema detail and unrelated forecast noise without changing the one-writer ontology or financial operations.

ACCEPTANCE:
H04 can start with no investments, trace recorded cash, wages and debt, identify an unknown take-home deposit as incomplete rather than invented net pay, distinguish transfers/loan principal from spending, find a contextual payroll-funded 401(k) contribution action without silent enrollment, and return from a targeted source repair to the originating question. H08 can read separately owned 401(k)s/IRAs/brokerage, accessible cash, home equity, mortgage, care spending and household person ownership without double counting or pooled dependent assets. Account-first sections show concise summaries and only relevant next actions, advanced details expandable. Mortgage contract/payment/funding and insurance premium/conditional benefit semantics remain exactly those established in U1A/D1. Changing and cancelling an authoritative editor preserve one source and correct dates. Desktop/mobile tests include empty, partially reconciled, source-conflict, save-failure and owner-navigation states. No formulas or tax law altered; if a required new economic fact/adapter is absent, report a scoped blocker instead of guessing.
```

**Scope and seams:** this remains #120; never create independent concurrent Money/Net Worth tickets that would edit the same UI shell/stylesheet. Reuse existing source-owned panels/registry. No new import/parser capability, portfolio optimizer, automatic institution connection, or #108 whole-fixture work. **Review gate:** independent user-visible financial semantics, responsive screenshots, latest-head CI and bounded PM task UAT. Synchronize #120 before phase C.

## 4. Proposed Issue #120 Phase C: safe defaults, timeline and forecast interpretation

```text
PFM_TASK_V3
TASK_KIND: product
TARGET_BRANCH: codex/u1b-c-age-forecast-ux
DEPENDENCY_POLICY: locked

ALLOWED_PATHS:
- ui/**
- app/globals.css
- e2e/**
- test/**

OBJECTIVE:
Deliver clear new-plan and saved-plan forecast setup in the approved Level 4 Plan interaction pattern, including editable age-90 horizon, independent age-65 retirement proposals, scoped numeric planning presets, outcome coverage and compact forecast lifecycle feedback. Reuse actual canonical Current Plan and Life Events authorities. Do not reengineer long-horizon runtime or future tax-law execution in this UI task.

ACCEPTANCE:
New eligible plan proposes forecast through age 90 (with displayed linked calendar date), overrideable earlier/later, and age 65 editable retirement *decision* per eligible working adult, not an implied death/claiming/Medicare choice or wage termination without a supported binding. Existing saved plan settings always prevail. H08 can choose separate retirement decisions for Marisol and James; selected planning adults define later-spouse default horizon, and Avery's care-tail is warned without automatically pooling assets or assuming public benefits. Numerical 2.5% expense-price, 3% wage, 5% generic nominal portfolio-return and 6-month reserve values are clearly labeled optional planning assumptions, not recorded actual facts; explicit setup approval and per-value changes supported. Missing DOB, past retirement age, incompatible binding, unavailable future law and the current 40-year execution limit have distinct, named states. Do not silently cap, coerce or save a shorter horizon. A prior valid result can remain visibly stale during an updated run; a superseded/failed/cancelled run cannot overwrite current result. Partial after-tax/care outcomes are conspicuously qualified or withheld. Screens and narrow viewport UAT correspond to H04/H08 Level 4 reference. No new engine laws, optimized plans, real Social Security claim ages, or fake numeric scenario deltas.
```

**Critical dependency and stop condition:** the existing `setupSchema` only accepts horizon 1–40 years, and current app session defaults are not age-based. UI can propose, edit and **retain** age 90, but it must not claim validated long-horizon execution where backend support or tax/benefit coverage is missing. If an unrepresented longer age cannot be stored in existing canonical plan authority without changing model/contracts, Codex must stop and report a narrow scoped architecture blocker rather than a UI-only fake. PM must decide the long-horizon execution/cost/legal-rule implementation separately; it cannot be hand-waved as part of U1B. Acceptance of full age-90 forecast execution remains outstanding until its own gate.

## 5. Future backlog contract drafts (not yet actionable)

**#105 independently saved plans:** after #120 and a resolved scenario-versus-plan identity trade study, promote the **existing** issue #105 to its own V3 authorization (do not create duplicate). One user-visible Duplicate action, new persisted independent identity, shared immutable observed source snapshot, distinct dated decision overlay, no silent copied forecast results, compatible Forecast Basis, safe clone/rename/delete/reload, and uncomputed/incomparable states. Scope actual affected planning/application ownership and UI/tests **only after the existing model identity and file boundaries are confirmed**; don't assign the unresolved backend/data semantics to Codex.

**#108 synthetic library:** remains R11/O1 with D2/#103, #105 and #120 prerequisites. The **prototype H04/H08 switcher is not proof that eight canonical executable fixtures exist**. Production fixtures must be sourced, deterministic, account/benefit-complete to supported floors, and tested for separate owner economics. Write ownership must not overlap U1B source editors until stable interfaces and dependencies are merged.

**Age-90 execution seam:** a distinct planning decision is required before opening an implementation task: horizon/time representation for 45–72+ years, inclusive end-date conventions, runtime memory/compute budgets and finite unsupported future-law/tax/benefit periods. Verify whether supported engine can execute without implicit truncation and avoid cost regressions. No assumption that 90 is a death event or that a deterministic 90-year result is certain. Don't create a parallel UI+engine Codex PR across an unresolved plan-window interface.

## 6. Post-implementation independent audit and gates

- Reviewer compares 1440/390 implemented states to *the single PM-approved direction* and this repo prototype (not aesthetic preference only).
- Financial semantics: gross/net vs bank deposit, transfers/debt principal, salary termination, plan owner identity, conditional insurance, separately owned adult dependent assets, source/audit provenance and date-scoped tax facts remain correct.
- Failure cases: unknown values remain unknown, true conflicts retain both sources, errors focus one proper owner, Cancel preserves last verified data, last good forecast shows stale, failed save has no false success, unsupported engine rule never shown as user typo.
- E2E/browser: no console errors, navigation including mobile More, context focus and keyboard, 390/1440 responsive, no full-page repetitive global tax diagnostic stack.
- CI performance: rely on GitHub checks; do not have Codex poll the Actions run or capture screenshots itself. A bounded UAT screenshot workflow remains separate from routine tests.
- **#120 closure:** latest-head CI, independent semantic/visual audit, owner uncoached UAT, all inherited U1/D1 acceptance (including mortgage funding), synchronized issue body and explicit PM merge acceptance. Green CI alone is not acceptance.

**Activation note:** these are full task-contract drafts, but the approved version must be placed at the **top of GitHub Issue #120** one phase at a time, preserving achieved acceptance, dependencies and remaining work. Until PM approves the Level 4 design and that issue update occurs, do not send `PFM_TASK_ISSUE: 120` to Codex on the authority of this document.
