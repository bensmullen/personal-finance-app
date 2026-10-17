# Level 4 UX pilot — reviewable design target and sign-off criteria

**Status:** Calm style approved; final chart placement, section-label replacements and histogram spacing implemented and browser-smoke-tested on 2026-10-17. PM final corrected visual approval and production financial UAT are still pending. The browser checks cover synthetic design interactions only. Date: 2026-10-16. Non-normative design reference only; do not implement from this draft until PM explicitly approves the chosen visual/interaction direction. Existing authoritative specs and source-of-truth registry remain unchanged.

## References and scope

- Source Level 3: [33 interaction traces](level3-interaction-traces.md), [navigation/evidence baseline](level3-visual-baseline-navigation.md), [pilot state matrix](level3-pilot-state-matrix.md).
- Observed pre-design baseline: [first successful manual UX evidence run #38971983269](https://github.com/bensmullen/personal-finance-app/actions/runs/38971983269), 12 existing-demo screenshots (1440px/390px) across Overview, Income, Income edit, Investments & retirement, Debt, Current Plan. Actual flaws: repetitive top-of-page forecast/tax diagnostics displacing unrelated tasks, excessive expanded form density, mobile secondary navigation clipping.
- **Executable Level 4 reference:** [self-contained interactive H04/H08 prototype](prototypes/level4-h04-h08-pilot.html). It has no network requests, real imports, live financial accounts, backend calculation, or persistent storage. Fictional household data are from H04/H08 alpha blueprints or explicitly labeled mock choices. The three visual treatments are preview-only, not separately approved production themes.
- **Pilot lenses:** H04 Barlow (novice, empty investments, 45→90 horizon, debt/cash-flow) and H08 Ortega (two planning adults, $5m opening net worth including home, Avery separately owned adult-dependent facts, individual retirement dates, dependent-care and benefits limitation).

## Visual directions available in the prototype

| Direction | Character | Strength | Concern | Recommendation |
| --- | --- | --- | --- | --- |
| **Calm editorial** (initial preview) | Deep muted teal navigation, restrained cream/white surfaces, green emphasis, measured whitespace and compact detailed summaries | Highest alignment with PFA-UX-015: capable, trustworthy, clean, low-jargon; strong status distinction | Further test data density and color contrast during production UAT | **Preferred for PM selection** |
| **Focus compact** | Straighter corners and tighter financial-information density | Good for repeat/advanced users who navigate many accounts | May reintroduce wall-of-data fatigue for H04 | Alternative, not a separate engineering lane |
| **Studio soft** | Cooler lavender/navy palette with same interaction skeleton | Differentiate editorial brand feel | Less neutral for financial uncertainty/error semantics | Alternative aesthetic; needs PM preference |

**PM visual choice:** **Calm is approved**. Focus and Studio remain discarded comparison variants. See [Level 4 financial visualization and revised section taxonomy](level4-financial-visualizations.md) for chart requirements and the now corrected section-first design reference. The focused design render and automated browser interaction pass are complete; owner review of those screens remains the last Level 4 chart-design signoff.

## Main navigation and screen specification (production target)

The visible design uses seven user-facing financial areas while retaining the 62 authoritative financial fact writers. The display labels and route grouping do not change the underlying canonical fact editors. Every task action must reveal the correct owner, not a schema editor or a duplicate mutation point.

| User goal / prototype destination | Canonical production owner / view | First-screenful required content and primary action | Interactive and recovery pattern |
| --- | --- | --- | --- |
| Understand present finances — Overview | Overview → How am I doing? | Identity/as-of; 3–5 sourced values; one valuable question; compact status | One click to Cash Flow, Debt, Investments or Current Plan; missing forecast never pushes current metrics off-screen |
| Understand money — Cash flow | Money → Cash Flow; source via Money → Income/Spending/Accounts | Gross vs *known* take-home, categorized expense, debt principal, transfers distinctly; one source action | Missing withholding/unknown spending remains unknown, not zero; contextual same owner editor; Save/Cancel returns to period |
| Understand obligations — Assets & debt | Net Worth → Overview, Debt; checking in Money → Accounts | Home/available bank cash/actual liability values distinct; named current loan | Source review in Debt or Accounts; don't double count property equity or principal |
| Invest, or start from none | Net Worth → Investments & retirement | Account-first summary; H04 honest empty state; H08 separate plan owners | First contribution requires real employer plan/payroll or bank funding facts; no automatic enrollment |
| Configure horizon & retirement | Plan → Current Plan (horizon), Plan → Life Events (per-person retirement) | Selected adults, editable age 90/date, retirement age 65 proposal per eligible worker, one Update forecast action and precise coverage | DOB repair with Settings → Household & People editor, preserved user override, no silent >40-year truncation or assumed death/claiming |
| Compare alternatives | Plan → What If? / Compare Plans | Baseline vs named alternative, changed decision, compatible Forecast Basis, only supported metrics | Until #105 independent plan semantics: explicit unavailable comparison; no fabricated delta or saved plan |
| Verify people/source/provenance | Settings → Household & People, Money/Net Worth owner sections | Person/sponsor/period and source; read-only derived mirrors; concise task repair | Conflicts show both named sources/date/period, explicit choice or defer; unsupported law does not masquerade as invalid input |
| Save/leave/return | Settings → Import / Export (current origin-specific local persistence) | Draft vs saved model vs plan/result, as-of and privacy; one Save or return task | Cancel stays in context; failed Save never claims success; real plaintext export caveat; demo reset never touches personal model |

## Approved-for-review interaction patterns (proposal)

1. **Compact relevant status:** replace repeated long annual filing/tax diagnostics atop every page with a single status summary. Current financial facts remain visible even if a forecast is unsupported. One relevant blocking reason and remedy is always visible; all underlying diagnostics remain accessible under task-focused review and opt-in technical details.
2. **One primary task per entry:** every main view shows a meaningful current summary, one primary next action and one source/help affordance. Unrelated nested forms start collapsed. No dead fields or unsupported false buttons.
3. **Same-authority contextual correction:** a chart/source repair opens the exact canonical writer (Income, Spending, Accounts, Debt, Investments, Household & People, Life Events or Current Plan); return to original task, selected period, owner and focus. One Save/Cancel path, with immediate scoped validation. No copied writable mirror.
4. **Age-based planning:** new plan proposes through age 90, editable earlier/later, source DOB/person-scoped. Per working adult, proposed retirement age 65 editable via Life Events, not automatically a payroll termination or Social Security claiming choice. Multi-adult end-date semantics follow PFA-UX-019. Explicit missing/future-law/long-run compute limitations remain visible, not silently clipped.
5. **Outlook meaning:** distinguish current known values, accepted planning assumptions, completed result, partially supported domains, unsupported law, running, failed, canceled and stale prior output. The prototype's Run action is a UI lifecycle simulation and must never be copied as a financial computation.
6. **Distinct plan identity:** comparing alternatives requires #105; the preview offers qualitative understanding without claiming independent persistence, computed delta or real-world execution. Original observed facts remain unchanged.
7. **Safe re-entry:** reuse validated same-scope facts, do not repeat entry. Distinguish session-only draft from actual persisted personal financial model and acknowledge origin privacy restrictions; do not mimic a cloud save that doesn't exist.
8. **Responsive navigation:** at 1440px a seven-section sidebar; at 390px Overview / Cash / Investing / Planning and a **More** menu exposing Real Estate, Other Assets, Debt, Household & People and Save, no clipped required route. The selected canonical editor remains the same at both sizes. Touch and keyboard accessible; overlay has Escape, Save/Cancel and focus return.

## Representative pilot screens and states

- **H04:** Overview → Cash Flow → Debt → Investments empty → Current Plan age 90/retirement 65 → blocked/qualified long-horizon forecast → What If choices → Save/return. Force unknown take-home, invalid age, unknown employer match, failed import, unsupported 45-year compute, Cancel, stale result and failed persistence.
- **H08:** Overview → Household persons/ownership (Marisol, James, Avery separate) → Investments and mortgages → Current Plan later spouse age-90 end → independent retirement 62/67 choice → care expense and future unsupported benefits → incomplete forecast → non-comparable plan fallback → Save/return. Force owner conflict, missing care-year authority, longer dependent horizon and unsupported Medicare/benefit rule.
- **Precision:** 18-year-old age-90 (approximately 72-year) test remains a required post-U1 long-horizon regression even though H05 is not the pilot. Current 40-year input ceiling must be addressed by a **separate, model-aware implementation authorization**, not by changing UI labels alone.

## Final corrected chart placement — rendered and tested

The [H04/H08 interactive reference](prototypes/level4-h04-h08-pilot.html) now has **seven directly named financial sections**: Overview, Cash, Investing, Real Estate, Other Assets, Debt, and Planning. All valid charts are **first-class content inside their own section** — **no chart-only page**. Overview leads with the net-worth/assets/liabilities full-horizon line graph; Cash leads with balance-plus-signed-change, income/expenses, and selected-period gross-income allocation; Real Estate leads with a monthly mortgage-interest/principal/extra-principal stack; Debt leads with liability balance; Planning leads with retirement income composition; Investing places the explicitly capability-gated attribution view before account detail when applicable; Other Assets uses an honest empty-state visualization when values are unavailable.

Histogram gap reductions: income/spending paired columns now use 17px per bar on 40px period bands; mortgage 25px on 29.4px; retirement 41px on 49px; signed cash-change bars increased in width too. These refer to design SVG coordinates only and shall translate to responsive production bands rather than rigid CSS pixel contracts.

**Browser smoke verification completed:** H04 and H08 × 1440px/390px × seven user financial sections = **28 screen states**, with correct section titles and available chart-first layouts. Mobile More revealed all non-tab locations. Month selection on the income histogram revealed **the allocation chart on the same Cash page**; the allocation month dropdown and mortgage +$500/mo illustrative extra-payment re-render also passed. No page-script errors or page-level horizontal overflow. The responsive graph itself can scroll horizontally within its frame on narrow devices. Empty Investment and Other Asset views remain honest, and all displayed graph data are fictional demonstration values, not engine calculations.

**Remaining approval and validation:** product manager visually approves these revised screens and merges PR #127 when ready. Codex Phase A then implements source-safe navigation/shell changes on current main via Issue #120; B–E chart implementations remain serial with actual read-model checks. Browser smoke tests do not establish full accessibility, forecast accuracy, financial-model support, CI status or uncoached production UAT.

## Verification already performed / remaining

**Performed:** self-contained HTML rendered in headless Chromium at **1440 × 900 and 390 × 844**. Checked H04 → Plan, drawer edit ending age 90→94, apply, alternative selection, persona switch to H08, independent James age 65→67, and option selection; no page script errors in those paths. Visually inspected first-screenful Overview and Plan and mobile displays, corrected household-specific help and mobile More reachability.

**Not verified / cannot be claimed:** full accessibility audit, cross-browser behavior, PM usability acceptance, persistent financial model lifecycle, real amount/postings/forecast semantics, implemented #105 plan cloning, implemented #108 households, all 33 task paths end-to-end, performance for >40-year runs. Level 4 UAT still requires product-manager interaction review and later genuine implemented H04/H08 fixture runs. Prototype is a design aid, not a truthful financial engine.

## Approval checkpoint and implementation handoff

**Decision state:** PM has chosen **Calm** and clarified the top-level areas as **Overview / Cash / Investing / Real Estate / Other Assets / Debt / Planning**, together with the new chart stack, are now authored in [the chart-aware Level 4 design contract](level4-financial-visualizations.md). The first implementation authorization remains phase-scoped in [Issue #120](https://github.com/bensmullen/personal-finance-app/issues/120). **All seven requested chart concepts now have **embedded section-first** prototype presentations in the existing HTML (the asset-class attribution is deliberately illustrative and tagged data-contract pending), tested in Chromium at 1440px and 390px for both H04 and H08. PM chart-specific approval is still needed before activating phases B–E. #105 and #108 remain independent dependency gates.

**Calm direction approval does not mean product-owner merge/UAT acceptance.** Chart design, full age-90 model execution, and future tax-law simulation remain separate gates. No Codex implementation turn was started here.
