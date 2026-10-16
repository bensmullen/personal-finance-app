# Level 3 pilot: evidence-based navigation and screen contracts

**Status:** UX planning/design contract for review, not implemented application behavior. Companion to [all Level 3 tasks](user-journey-level3.md) and [interaction traces](level3-interaction-traces.md). Existing authority: PFA-UX-015–023, [financial fact ownership registry](../specs/verification/u1-fact-ownership.json), PFA-PLAN-001–013, PFA-ONB-003–007. Do not treat route design as authorization to edit canonical financial semantics or backend logic.

## 1. Visual evidence, what was actually reviewed, and limitations

**First manual UX capture — verified:** [UX evidence (manual) successful run #38971983269](https://github.com/bensmullen/personal-finance-app/actions/runs/38971983269) on main, 2026-10-16, published [artifact 12076628480](https://github.com/bensmullen/personal-finance-app/actions/runs/38971983269/artifacts/12076628480). Downloaded artifact contains **12 unique PNG screenshots** at 1440px and 390px for Overview, Income, Income edit, Investments & retirement, Debt and Current Plan. Opened screenshot sheets for all 12 and inspected full desktop layouts. Workflow succeeded, establishing reproducible capture and absence of its asserted page/console errors; it does **not** imply usability approval. Full-page heights: desktop 3,069–6,947px; mobile 4,976–10,219px. **Evidence uses the existing synthetic example, not implemented H04/H08 personas.**

**Additional pre-capture visual review:** [GitHub Actions run 38918758001, E2E diagnostics artifact 12053113536](https://github.com/bensmullen/personal-finance-app/actions/runs/38918758001), dated 2026-10-16. Inspected real `holding-activity-1440.png`, `holding-activity-390.png`, and an investment editor failed-test screenshot. Screens capture an *existing imported synthetic financial model*, not the unimplemented H04 or H08 personas. Both full-page captures were >10,000 px tall; that is directly observable image evidence of uncontrolled content height, not a claim that every existing page is this long.

**Observed issues:**

- Above the investments/account task, the page exposes "Household forecast · Needs setup", another large "Needs setup · household forecast not run" region with several source-specific repair links, then a large "Recorded financial facts need attention" list. These displace investment actions below the fold, while duplicated status phrasing and repeated warnings compete for attention.
- At 390px the primary/secondary navigation occupies two scrolling rows; the selected investments subsection is clipped in the available screen width. Requirements need a visible current-page title and recoverable compact section navigation.
- The captured investments view expands extensive holdings, activity forms, help and optional fields repeatedly. Deep legal/transaction details and unrelated warnings dominate a normal first inspection.
- The editor screenshot demonstrates optional and legal fields in a long editing surface. Retain their semantics but show context-specific common fields first; technical classification must be reachable on demand.
- Existing onboarding source code uses `income=6000`, `cash=5000`, `asset=350000`, `debt=235000`, `spending=4200` as wizard defaults; these are **not safe personal facts**. They may appear within a separately chosen synthetic example, but must not be silently treated as a new person's actual recorded balances/income.
- Existing authoring accepts `horizon` 1–40 years and starts with 10; age-90 and age-65 behavior in PR #126 is not implemented.

**Evidence limitations / gate:** The first dedicated manual capture **is complete** and all six screenshot pairs were reviewed. Across all six views, the first screenful is dominated by the same forecast status and repeated missing annual filing/tax coverage details. At 390px even the page-specific body begins far below the fold, the subnavigation scrolls horizontally, and Income editing appears only well down the full-page screenshot. A tall status region is not necessarily a page-specific blocking error; it must not be repeated at full length atop otherwise valid tasks. Screens alone do not prove keyboard focus, screen-reader behavior, correct persistence or whether details are actually usable. No one has visually validated dedicated H04/H08 executable fixtures; #108 is still planning. This defines a **provisional interaction IA** grounded in actual screenshots, not an approved Level 4 visual target or UAT pass. Before PM approval, obtain focused H04/H08 evidence when fixtures are implemented; do not rerun identical generic screenshots or add ordinary CI load.

## 2. Pilot selection and its bounded purpose

**Primary H04 Barlow:** age-45, no investments, mortgage/high-interest debt, wages and spending. End-to-end goal: understand present disposable cash, find a financially feasible first step, understand a forecast to age 90, compare reducing discretionary spending, repaying debt and starting an eligible workplace contribution. No required investment to enter or learn the app.

**Complexity H08 Ortega:** two near-retirement adults, multiple retirement/cash accounts, separately owned dependent-adult needs, healthcare/care spending, survivor and retirement scenarios. End-to-end goal: see whose assets and future cash obligations are included, choose independent 62/65/67 retirement dates, forecast to selected adults' age-90 end date while identifying possible dependent-care tail, and compare only legitimately supported outcomes.

**Later regression H02 Torres:** non-pooled grandparent, rentals, high debt service and property-rich/cash-poor distinctions. **Not** a third full visual-design implementation lane.

**Entry maturity constraint:** Current UI exposes one "Use synthetic example"; eight-persona one-click rich fixtures and truly independent saved comparisons are Issue #108/#105 deliverables. Design may refer to these as targets only; for UAT, use stable manual synthetic fixture imports where available, never pretend the advanced feature already exists.

## 3. Screen inventory: grounded current location and proposed interaction role

"Existing route" below is the current **navigation section**, not a promised URL or new database entity. Each target uses existing primary navigation wherever possible. A contextual repair draws the same authoritative editor in a sheet and returns focus to its origin; full-page route is a fallback.

| Surface | Current navigation or entry | Primary user job and visible above-fold content | Primary action; empty/exception behavior |
| --- | --- | --- | --- |
| S00 Welcome/Resume | Existing first-run guided setup (no main nav until model exists) | Choose synthetic example, personal entry, or load compatible saved household; privacy/save boundaries | Explore / Start mine / Resume; failed load retains original; no prefilled real financial facts |
| S01 Current snapshot | **Overview → How am I doing?** | Selected household, as-of date, 3–5 sourced current metrics, one important question, data-confidence cue | Review cash flow or Complete only relevant setup; a missing forecast does **not** obscure current known values |
| S02 Cash-flow overview | **Money → Cash Flow** | Income actually received, recurring spending, debt service, transfers, net available cash with period/source | Inspect Income / Spending / Accounts; incomplete take-home marked, no net-pay guess |
| S03 Income owner | **Money → Income** | Employers/pay/period/routing, concise amount and source; related payroll assumptions | Add/Edit Income; wage/receiving account repair from other screens uses same editor |
| S04 Spending owner | **Money → Spending** | Monthly essential/discretionary spend, scheduled recurring items, source/date | Add/Edit expense, change classification; transfers/payment principal not reclassified as consumption |
| S05 Cash accounts owner | **Money → Accounts** | Real bank/cash balances and interest, linked funding/receiving account | Add/Edit account; **Net Worth → Cash & bank accounts** is a read-only mirror |
| S06 Debt owner | **Net Worth → Debt** | Principal, contractual payment and rate, account funding, remaining term; distinction from actual forecast payoff | Add/Edit liability, verify funding, explore extra payment; source bank chosen in context |
| S07 Investment owner | **Net Worth → Investments & retirement** | Compact account summaries, holdings when expanded, contextual contribution and activity actions; empty state for H04 | Add account / Manage contributions / Activity; payroll-funded workplace vs bank-funded IRA/brokerage are separate |
| S08 Household owner | **Settings → Household & People** | Named people, relation/ownership, DOB, effective dated status/coverage | Edit relevant person once; never pool separately owned family assets |
| S09 Plan setup | **Plan → Current Plan** | Chosen people, forecast age/date, coverage/ready state, one action; age-90 target and plan horizon live here | Review horizon / Repair prerequisite / Update forecast; never silently shorten when beyond 40-year implementation limit |
| S10 Retirement/life events | **Plan → Life Events** | Each named adult's retirement plan age/date (initially proposed 65 where applicable), effect and linked wage termination status | Edit retirement event per person; missing binding calls exact repair; 65 does not set claiming age |
| S11 Assumption review | **Plan → Assumptions** | Only material accepted scenario assumptions with units, basis and date, linked to plan | Review/change editable 2.5%/3%/5% suggested assumptions if supported, preserve sourced facts |
| S12 Alternative authoring | **Plan → What If?** | Name independent decision variation, selected person/account/period, only changed knobs | Duplicate and edit if #105 supported; otherwise explicit capability boundary, original unchanged |
| S13 Comparison | **Plan → Compare Plans** | Named baseline/alternative, common Forecast Basis, supported deltas/tradeoffs, limitations | Compare / Align basis / Retain; no raw delta for incompatible plans |
| S14 Persistence / imports | **Settings → Import / Export** | Actual local save mode, last saved time, import candidate review, encrypted? (No: current JSON export is plaintext.) | Import review, Save, Export, Load; origin-sensitive no-local-save explanation and data-loss safeguards |
| S15 Insurance/care | **Money → Insurance & coverage** plus **Money → Spending**, **Settings → Household & People** | Named insured/beneficiary, premiums; H08 care is an owned household/dependent expense, not assumed insurance entitlement | Edit actual contract at owner; dependent care expenses edited under Spending; unsupported public benefits not fabricated |
| S16 Source/diagnostic repair | Same owning S03–S15 editor, reachable contextually from any derived/read-only result | One named cause, affected output, current source/date and direct fix; concise accessible help | Save/Cancel returns to original task with preserved filters and focus; technical codes only under **Settings → Technical diagnostics** |

**Home surface principle:** A single clear *task CTA* rather than a second copy of the global editor. The primary navigation groups stay Overview, Money, Net Worth, Plan, Settings; Level 3 proposes contextual links and page headers, NOT a second sitemap or unapproved top-level area.

## 4. Contracted visual hierarchy / responsive behavior

- Each S01–S15 first screenful: specific title, selected owner and as-of/basis, 1–4 understandable summary metrics or short choice prompt, one dominant action, relevant warning count + highest-risk blocking cause. Allow secondary details only by intentional expansion.
- Status hierarchy: highest relevant blocking cause in a **compact** region; remaining related causes grouped by source and scope, no same error repeated as (1) banner (2) list (3) form and (4) technical area. A forecast-specific missing setup cannot displace the unrelated task's primary data editor.
- Editors: focus in overlay on named field; show user term, plain-unit input, conditional financial details, immediate inline validation, explicit Save/Cancel; where a field is derived/read-only, open same owner instead of offering a mirror edit. Esc returns focus, and abandon/cancel discards only the pending editor draft, not verified model.
- Desktop 1440: stable five-area nav, contextual subsections, content cards with low-density, explicit action hierarchy. Mobile 390: current page and section clearly labeled; primary destination and back path are operable without horizontal label clipping; one-column editing and warnings; sticky or easily discoverable Save/Cancel when editor long; never require hover.
- H04 investment empty state: "You don't have any investment accounts in this model" plus a non-coercive first step link; don't render 0-dollar fake account or a disabled contribution wall.
- H08 owner selection: selectable adults and separate dependent-care expenses; do not combine a dependent's assets or benefits automatically; associate expense owner/payor/person and dated scope.
- Accessibility: keyboard/VoiceOver/SR meaningful labels; focus moves to revealed problem and returns; scroll position restored on contextual close; support touch and small viewport, not only mouse hover; compactness may not hide critical caveats.

## 5. Target navigation handoffs (explicit, bidirectional)

| Trigger / entry point | Follow-through navigation or sheet | Return destination and state | Failure handling |
| --- | --- | --- | --- |
| S01 "Where is my money going?" | S02 Cash Flow; supported deeper link S04 Spending | S01 with retained month/owner filter | Missing postings show scope and S03/S05 repair, not "start over" |
| S01 "What should I fix?" | S16 contextual source-owner editor S03/S05/S06/S08 | S01 same metric, refreshed or stale status | Cancel keeps old fact and prior valid result |
| S02 "Change income / category / bank" | S03, S04, S05 authoritative owner editor | S02 same period/selection | Cross-scope conflict requires named source reconciliation |
| S06 debt-to-bank funding | S05 bank-owner editor in-context | S06 same named mortgage editor open | If account missing, present create/choose after user confirms, not fabricated account |
| S07 workplace contribution missing employer pay | S03 Income editor contextual | S07 same account / contribution step | Saved eligibility/year/sponsor mismatch prompts exact dated authority |
| S09 missing DOB for age-90 horizon | S08 person editor contextual | S09 same plan and reference selection | DOB unknown -> ask explicit date without manufacturing age |
| S09 age-65 retirement proposal | S10 Life Events same shared retirement editor | S09 reflects event/binding status | Over-65 or already retired -> no backdated event |
| S09 forecast requires bank owner/tax settlement | S05 / S03 / S08 owner or exact supported authoring | S09 in same readiness section | Unsupported future-law policy -> scoped warning, not false input error |
| S09 "What if I retire earlier?" | S12 independent alternative, then S13 | S09 original baseline is unchanged | #105 unavailable -> disabled explanatory route, not fake compare |
| S13 inspect decision delta | S12 selected alternative event plus S10 shared owner | S13 same baseline/alternative pair | Nonmatching basis -> align/recompute before quantitative delta |
| S14 resume or import | S00 explicit identity → S01 snapshot | S01 selected identity/as-of; no old unsaved changes discarded | Import failure: old model remains; manual save separate |
| S15 dependent-care cost explanation | S04 expense and S08 person context | S15/S09 original scope and help | Government eligibility unknown -> unsupported, not automatic benefit |

**No duplicate write ownership:** even if a screen visually opens S03, S05, S06, S08 or S10 in place, it invokes the same authoritative editor and save handler as the main owning section. The sheet is an entry point, never another source of record.

## 6. Level 3 stage handoffs and gate responsibilities

- **S1 → S2:** user has selected identity and question; data may be sparse; no mandatory all-facts wizard.
- **S2 → S3:** only a user-requested result's missing sources are escalated; sourced current-state information remains visible.
- **S3 → S4:** explicit review of the forecast plan's horizon, age-specific decisions and risk coverage. "Ready" is result-scoped; incompleteness can coexist with valid outcomes.
- **S4 → S5:** independent plans and equal Forecast Basis are required for quantitative scenario deltas; if unavailable, preserve baseline and present a factual note.
- **S5 → S6:** save the selected plan definition and necessary provenance; model "next action" is a reminder/question/decision, **not** financial execution.
- **S6 → S1–S5:** changed or stale *subset* returns to the relevant owner and resumed task, never replays entire setup.

## 7. Visual/UAT gate before Level 4 or implementation

1. **Done:** successful [manual UX capture #38971983269](https://github.com/bensmullen/personal-finance-app/actions/runs/38971983269), with all 12 requested 1440/390 screenshots reviewed. Reuse this exact baseline; no second generic capture unless the UI head materially changes.
2. Obtain targeted *H04* first entry, cash/debt/investment empty, age-90 setup and unsupported long-run states; *H08* household person choice, retirement changes, care, supported/unsupported scenario states. If eight-household fixtures are unavailable, mark fixture gap and use explicitly sourced synthetic model data without claiming fixture coverage.
3. Have PM approve current-screen findings and design target; then create Level 4 annotated before/after reference screens or interactive prototype. Neither screenshots nor this document alone prove novice usability.
4. Before rewriting #120, separately scope the existing 40-year cap and engine/calendar coverage, P1/#105 multi-plan persistence, #108 fixtures and any unsupported legal/benefit consequences. Keep the implementation single-owner for shared authoring code.
