# User journey audit and Level 3 interaction contracts

**Status:** non-normative product/UX design proposal, **not** implementation permission or proof of rendered UX. 2026-10-16.

**Detailed Level 3 expansion:** [reviewed visual baseline, chosen H04/H08 pilot, route and screen ownership](level3-visual-baseline-navigation.md) and [33 stepwise user/system/decision/recovery interaction traces with six task diagrams](level3-interaction-traces.md). This file remains the compact stage/use-case index, **not** the entire Level 3 design. The dedicated six-view manual screenshot run is still missing and is an explicit Level 4 visual-review gate; existing E2E screenshots are partial evidence only. Traces to [six-stage discovery](user-journey-discovery.md), the [eight fictional household blueprints](household-blueprints.md), Issue #108, and PFA-UX-015–023. Specific default values and ownership remain governed by PFA-UX-016/019/021/022. These interactions define intended tasks and recovery states; **they are not screen layouts, routes, or executable financial formulas**. Implementation authorization and U1B #120 restructuring happen after visual pilot approval.

## A. Independent Level 2 audit: gaps, remedies, and readiness

The six stages are a useful organizing model, but the prior Level 2 mapping cannot yet be treated as a screen-design acceptance contract. Fix the following **systemic** holes rather than adding one-off per-page exceptions:

| Severity | Gap in prior flows | Corrected interaction contract |
| --- | --- | --- |
| Critical | Plan ends as an arbitrary number of years; an 18-year-old needs ~72 years to age 90, while current UI accepts only 1–40 years | Age-based new-plan horizon defaults to 90 for the selected planning adult(s), manually editable both directions; extended execution capacity and performance are a separate implementation dependency, never silently cap to 40 years |
| Critical | Retirement is conflated with employment termination, Social Security claiming, Medicare, or a real fact | Age 65 is a **visible, editable retirement-plan assumption** for a working adult, not evidence of actual retirement or a default claiming age; execute an income termination only when a valid retirement-event binding exists |
| Critical | Multi-person households have no authoritative horizon rule | Use explicitly selected planning adults (spouses/partners use the later 90th birthday for the default), not arbitrary co-residents, grandchildren or dependent adults. Flag care extending beyond the selected horizon; allow tailored extension |
| High | Weak demo/personal separation and consent | No implicit external financial account connection, no real financial data in screenshots, no overwrite across profiles and no hidden export or destructive reset |
| High | Incomplete/privacy-unsafe onboarding or imported candidate facts | Review imported/linking candidates by source/owner/scope; prevent silent authoritative mutation and duplicate postings; connection failures have manual/demo fallback |
| High | Returning user's unsaved work or snapshots may appear persisted/current | Distinguish dirty session draft, persisted fact/model, saved plan, and dated calculated result; protect on exit/switch/delete |
| High | Partial result can look like complete retirement/tax advice | Show result coverage, basis, provenance, explicit unsupported domains and whether a decision conclusion is trustworthy; never replace missing with zero |
| High | Forecast and scenario operations may be long, cancelled or superseded | Async progress and request identity; old valid results retained with stale label; no resurrecting obsolete completion |
| High | Comparisons might pit nonmatching periods/law/source snapshots against each other | Compare only a compatible Forecast Basis; offer aligned recomputation or explicit 'not comparable', never fake decision deltas |
| High | Need to distinguish advice from model evaluation | Identify assumptions, goals and tradeoffs; suggestions do not modify financial accounts, place trades or guarantee outcomes |
| High | Errors, permission and device constraints omit accessibility/escape routes | Keyboard/touch/screen reader repair, draft protection, readable narrow layouts, clear permission denial and local-only limitations |
| Medium | No explicit route for a user who has no investments, cannot connect, has just one available result or returns years later | Allow sparse models and honest bounded insights; revisit only dated/changed facts; avoid 'complete everything' gates |

### Shared state invariants

- **Fact:** scoped by owner, source, effective interval and authoritative editor; prior confirmed source persists unchanged.
- **Suggested default:** explicitly labeled, scoped and editable; common UI preferences can prefill automatically, economic scenario assumptions must not masquerade as observed facts.
- **Draft:** distinguish unsaved in-session edits from durable persisted model and from immutable source provenance; failed import/save/reset may not overwrite successful state.
- **Plan:** identified independent saved decision/assumption configuration; duplication never mutates the baseline.
- **Result:** immutable calculation identity, source snapshot, horizon, model/rule version, Forecast Basis, coverage and lifecycle (running/current/stale/incomplete/unsupported/failed/cancelled).
- **Recovery:** for any input or computation failure name the cause, scope and next supported action, allow retry once cause changes, and do not loop indefinitely.
- **Accessibility:** every key action, error, focus target, disclosure and modal works at 390px and 1440px with touch, keyboard, and labels.
- **Financial ownership:** salary in Income, retirement event in Life Events, plan horizon in Current Plan, retirement-account operations under the owning Investments & retirement account. No secondary writable mirrors.
- **Bounded evaluation:** one relevant synthetic/persona fixture per scenario for design evidence, only the two target viewports and affected states; reuse existing CI and staged PM UAT.

### Stage handoffs

S1→S2 establishes identity and question, *not* complete financial data. S2↔S3 allows a bounded overview before complete import. S3→S4 means a **specific requested result** has sufficient authoritative inputs, not that all profile fields are complete. S4→S5 requires supported plan persistence/comparability. S5→S6 carries decisions/questions, not an actual trade or guarantee. Returners can enter any stage; do not mandate replay of a wizard.

## B. Stage 1 — Explore without commitment

**Goal:** see useful example/personal starting point, preserve agency and know what is and isn't stored.

| ID | Trigger and user action | System response / happy path | Branches, exceptions and recovery | Exit |
| --- | --- | --- | --- | --- |
| E1 Demo exploration | Choose Explore, browse 8 recognizable household stories, select one | Preview questions and scopes; load an isolated, resettable synthetic example with no data entry | Fixture absent/broken → explain, offer retry/other persona; never show stale prior persona as if newly loaded | Clear household identity and relevant question |
| E2 Personal start | Choose My finances and preferred available connection, file or guided manual method | Explain permission and data retention, start only after affirmative action; present reviewable candidate data | Provider/permission/parser unavailable → no partial commit; choose another supported input route or explore demo; no forced account link | An editable personal-model draft with understood provenance |
| E3 Resume | Choose existing saved model, review identity/last save and resume | Load compatible model with existing source facts, plans and distinguish retained results | Corrupt/older/unsupported schema → preserve original, explain exactly what cannot open, offer supported recovery/import; never overwrite | Trusted identity and resumable context |
| E4 Change example/reset | Select a different demo or request reset | Clearly label target, keep demos separate from personal models; confirm only destructive/dirty changes | Unsaved draft or pending computation → cancel/switch/back; never silently discard or cross-write data | Isolated selected model |
| E5 Capabilities | Explore a suggested household question, tap What's modeled? | Show applicable supported, incomplete, and unavailable domains with concise examples | Asked for unsupported estate/disability/multi-state/RSU rules → keep exploratory facts, withhold claims and route to supported question | An honest useful first task |

~~~mermaid
flowchart TD
 A["Choose entry: demo, personal or resume"] --> B{"Entry type?"}
 B -->|Demo| C["Select synthetic household"]
 B -->|Personal| D["Consent and choose supported data method"]
 B -->|Resume| E["Choose saved model"]
 C --> F{"Loaded safely?"}
 D --> F
 E --> F
 F -->|Yes| G["Explain source, ownership and capabilities"]
 F -->|No| H["Retain prior state; retry or alternate path"]
 H --> B
 G --> I{"Switch or reset with unsaved work?"}
 I -->|Yes| J["Warn; keep, save or explicitly discard"]
 J --> G
 I -->|No| K["Choose first financial question"]
 K --> L["S2: current financial position"]
~~~

## C. Stage 2 — Understand today's finances

**Goal:** read current state before building a perfect long-term model. A user may arrive here with very sparse data.

| ID | Trigger and user action | System response / happy path | Branches, exceptions and recovery | Exit |
| --- | --- | --- | --- | --- |
| P1 Scope/ownership | Select which people/household accounts to view; inspect shared vs separately held | Show who owns/controls each source; aggregate only authorized economic units | Missing or contradictory ownership/beneficial-interest → exclude or qualify, launch one owner fact correction; don't silently pool grandma/independent child |
| P2 Income/spending | Open cash-flow summary; change month/year; drill into income, bills and contributions | Reconcile gross-to-net payroll, spending, transfer, debt principal, interest and contributions using sourced postings | No withholding/account coverage, double-count/uncategorized posting → label actual vs estimated and missing period; open exact originating source without inventing payroll |
| P3 Net worth | Explore assets/debts, expand account/loan/holding summary | Show cash separately from holdings, dates, basis and obligations when supported | Stale price, unknown loan principal, duplicated account → quarantine affected subtotal, show explicit caveat and source repair |
| P4 Pressures | Ask What's important?, inspect cash runway, debt load or portfolio concentration | Rank explainable, supported observations by urgency *without hidden universal risk score* | Insufficient observed history, missing payment calendar or unsupported analysis → show evidence-backed subset or 'cannot assess yet'; invite minimum follow-up |
| P5 Inspect/edit source | Open a metric, view source date and choose Review/Edit | Same authoritative owner editor (possibly a contextual drawer); save recomputes dependent reads | Read-only/immutable source → review import correction; error/conflict → direct field focus; retained current value never changes on canceled save |

~~~mermaid
flowchart TD
 A["Choose people, period and financial question"] --> B["Load current authoritative snapshot"]
 B --> C{"Coverage sufficient for chosen question?"}
 C -->|Yes| D["Show reconciled income, cash, assets, debts"]
 C -->|Partial| E["Show known subset + missing basis"]
 C -->|No| F["Minimum relevant setup in S3"]
 D --> G["Inspect pressure, trend or number"]
 E --> G
 G --> H{"Source disputed or result unclear?"}
 H -->|Yes| I["Show provenance, owner and effective date"]
 I --> J["Open same owner editor / review candidate"]
 J --> F
 H -->|No| K["Choose next insight, S3 or baseline S4"]
~~~

## D. Stage 3 — Establish trust and forecast readiness

**Goal:** obtain *enough* reliable data for the requested result, with no duplicates, unsafe defaults or forced all-fields setup.

| ID | Trigger and user action | System response / happy path | Branches, exceptions and recovery | Exit |
| --- | --- | --- | --- | --- |
| R1 Input source | Choose connect, import, guided entry or existing model | Explain origin, permission, scope, supported types, historical vs current vs future planning, estimated effort | Denied connection, provider outage, invalid file, unsafe extraction → preserve current model; explain supported fallback and no automatic candidate commit |
| R2 Reuse | Open existing fact/forecast setup, change period | Resolve known/derived same-scope values without transcription; single authoritative editor | Old or unrelated-year/employer/account fact → show original scope and ask only the missing current fact, not full re-entry |
| R3 Default review | See prefilled field or proposed assumption, inspect help and change if desired | UI choice defaults are safe and editable; forecast planning proposals labeled and attributable | Missing basis, mistaken default or conflict → explicit unknown or correction; no salary, account balance, filing or eligibility inferred from averages |
| R4 Reconcile sources | Review an import comparison or conflict badge | Lossless exact duplicates collapse; different valid scoped facts coexist; explicit choice resolves genuine same-scope conflict | User cannot adjudicate → preserve both inputs + provenance, mark affected outputs incomplete and let user defer without secret precedence |
| R5 Readiness | Select target task/forecast and run setup check | Check only required source/plan coverage, show ordered direct-repair controls and allowed partial calculations | Unsupported engine/law, incomplete tax horizon, invalid funding/binding → distinguish capability block from editable fact and offer correct owner route |
| R6 Save/recover | Save personal model/plan or import reviewed data | Confirm persistence destination, snapshot/plan identity and saved timestamp; allow reload | Save failure, permission denial, interrupted import or logout → retain draft/previous verified version, show explicit retry/export within supported privacy mode; don't claim auto-save |

~~~mermaid
flowchart TD
 A["Choose desired result"] --> B["Resolve existing same-scope facts"]
 B --> C{"Critical inputs missing?"}
 C -->|Yes| D["Choose source and review candidates"]
 D --> E{"Validated, authorized and conflict-free?"}
 E -->|No| F["Explain conflict, missing law or invalid fact"]
 F --> G{"Resolvable now?"}
 G -->|Yes| D
 G -->|No| H["Save pending state; qualify affected result"]
 E -->|Yes| I["Commit to single owner; persist and verify"]
 C -->|No| J["Check exact forecast readiness"]
 I --> J
 H --> J
 J --> K{"Result supported?"}
 K -->|Yes| L["S4: baseline forecast"]
 K -->|Partial| M["Show limited scope and missing result"]
 K -->|Blocked| N["Named repair or capability gap"]
 N --> D
 M --> L
~~~

## E. Stage 4 — Understand the future baseline

**Goal:** understand a supported future path, key assumptions, person-specific events, age-based horizon and uncertainty limits.

| ID | Trigger and user action | System response / happy path | Branches, exceptions and recovery | Exit |
| --- | --- | --- | --- | --- |
| F1 Planning timeline | Enter Current Plan or request forecast; review proposed end age and retirement age per planning adult | For a new eligible plan derive end through selected planning adult(s) at age **90**, suggest retirement age **65**, show ages and calendar dates and permit earlier/later edits. Existing saved choices win | DOB unknown → request relevant DOB or explicit future date; already past retirement age or 90 → don't insert event in past; multiple adults → show reference people and later 90th date; dependents/children not silently included; separate horizon from death date |
| F2 Execute | Apply supported configuration and request forecast | Validate cash/withdrawal/funding/tax/event binding, run identified deterministic request and show progress | Missing/inconsistent setup → direct owner fix; run fails/cancels/superseded → keep last valid output with stale/result identity and safe retry; no silent 40-year truncate |
| F3 Interpret | Read supported cash, debt, investments, age timeline, retirement and pressure points; request explain | Show units, person, dated assumptions, starting snapshot, source routes and where outcomes change | Confusing chart/negative balance/stale result → show accessible plain-language explanation, period, drivers and traceable source; don't imply predicted certainty |
| F4 Coverage | Ask What's included? or inspect a surprising result | Distinguish calculated metrics, missing facts, incomplete tax/benefits/healthcare/estate and known unsupported rules | Material unsupported outcome → withhold affected conclusion; show capability-specific gap, not a 'bad user data' error |
| F5 Change input | Adjust age/horizon/assumption/life event and apply or cancel | Validate affected dated decisions, reuse single owner, identify changed Forecast Basis and invalidate only dependent calculations | Event outside horizon, invalid funding, new conflicts, slow long-run compute → explain precise issue, allow cancel/revert and retain last valid result; no automatic unrelated edits |

~~~mermaid
flowchart TD
 A["Open baseline setup"] --> B["Propose editable end age 90; retirement age 65"]
 B --> C{"Persons, dates and source facts valid?"}
 C -->|No| D["Select planning adult / repair DOB or binding"]
 D --> B
 C -->|Yes| E["Review full plan horizon and supported domains"]
 E --> F{"Run valid and within supported capacity?"}
 F -->|No| G["Explain constraint; never silently shorten"]
 G --> E
 F -->|Yes| H["Run versioned deterministic forecast"]
 H --> I{"Completed and still latest request?"}
 I -->|Yes| J["Show supported outcomes + coverage"]
 I -->|Partial| K["Qualified visible results + limitations"]
 I -->|No| L["Retain earlier valid result marked stale; retry/cancel"]
 J --> M["Review drivers and optional alternate plan"]
 K --> M
 M --> N["S5: scenario choices"]
~~~

### Horizon and retirement semantics (design decision)

A new personal plan uses **age 90** of the selected planning reference adult. For two selected spouses/partners, default to the *later calendar date* on which either reaches age 90; do not make grandchildren or financially independent adults horizon anchors by implication. A dependent adult can prompt a **separate long-care-tail warning**, extension or an explicit anchor choice, never an assumed lifespan. A forecast terminating at age 90 **does not imply death at 90**.

The new-plan retirement age **65** is a visible editable planning proposal **for each applicable working adult**. It is not a claim that someone is retired, will receive Social Security at 65, qualify for Medicare/pension benefits automatically, or that a retirement event should be injected without valid application binding. If a person is already over 65 or retired, source actual status/ask for a future choice; never backdate salary termination.

Illustrative editable starter *planning assumption suggestions*, not sourced economic predictions: **2.5% annual general cost inflation; 3.0% nominal annual pay growth; 5.0% nominal annual generic diversified portfolio return; emergency reserve goal of 6 months of expenses**. These values are provisional product proposals until PM approval, not silently adopted current-value facts, tax rates, insured/pension terms, or guaranteed returns. Users can review/change per plan, provenance and status stay explicit, and saved user choices always take precedence.

## F. Stage 5 — Compare meaningful choices

**Goal:** evaluate separately preserved decisions on compatible bases when independent plans and required domain execution are available.

| ID | Trigger and user action | System response / happy path | Branches, exceptions and recovery | Exit |
| --- | --- | --- | --- | --- |
| C1 Independent variant | Select Duplicate plan, name the copy, confirm | New independently persisted plan identity with shared source observation and copied supported decision settings; original untouched | Feature not implemented, copy fails, name/ID conflict → no fake alternative, keep original and explain remedy |
| C2 Change decision | Change a supported retirement, debt, housing, contribution or expense choice in alternative | Reveal precise person/account/funding/effective date and what is/ isn't changed; validate and save independently | Unsupported operation, hidden source change, invalid transfer → retain draft/revert, refer to authoritative owner; no direct bank trade/action |
| C3 Align comparison | Select baseline and variant, request compare | Check common source snapshot, dates/horizon, law/calibration/model versions and other Forecast Basis inputs; recalc on compatible basis if authorized | Unalignable or unavailable engine support → mark non-comparable, avoid misleading delta and offer separate descriptive views |
| C4 Tradeoffs | Inspect differing outcomes, toggle detail/explanation | State actual decisions changed; show supported cash, solvency, goals, debt and retirement differences with assumptions and limitations | Incomplete tax/rental/special needs/volatility consequences → omit or explicitly qualify affected metrics; never rank on a missing critical consequence |
| C5 Plan safety | Save, switch, revert to baseline or reopen alternatives | Make active plan explicit, retain independent identity and result age, never silently copy outputs as current | Failed save/rerun, out-of-date result or concurrent edit → keep last verified versions and warn before discarding draft |
| C6 Decision support | Choose an alternative or decide further evidence needed | Show tradeoffs and limitations, allow follow-up question/goal; preserve user choice without financial execution | No clear winner or evidence insufficient → explain rather than auto-select universally 'best' strategy |

~~~mermaid
flowchart TD
 A["Choose consequential financial decision"] --> B{"Independent saved variants available?"}
 B -->|No| C["Explain capability limit; retain original"]
 B -->|Yes| D["Duplicate named baseline"]
 D --> E{"Copy persisted safely?"}
 E -->|No| F["Recover without modifying original"]
 E -->|Yes| G["Change and validate named decision"]
 G --> H{"Scenario supported?"}
 H -->|No| I["Explain missing mechanic; keep plan draft"]
 H -->|Yes| J["Evaluate on compatible Forecast Basis"]
 J --> K{"Comparison and material outputs valid?"}
 K -->|No| L["Align basis or withhold unsupported delta"]
 K -->|Yes| M["Show supported tradeoffs and provenance"]
 M --> N["Retain alternatives; choose next question/action"]
~~~

## G. Stage 6 — Choose actions and revisit

**Goal:** retain useful financial understanding over time, selectively refresh dated information, and never accidentally turn a model into an external transaction.

| ID | Trigger and user action | System response / happy path | Branches, exceptions and recovery | Exit |
| --- | --- | --- | --- | --- |
| A1 Prioritize | Select a next question or supported action hypothesis | Explain what can be changed within plan, what requires external action, what data would inform decision | No supported safe recommendation → propose questions/tradeoffs without a hidden investment allocation or guaranteed advice |
| A2 Persist | Save model and chosen plan/configuration explicitly | Confirm destination, identity, last-save time and whether results are retained and current | Save/unavailable storage/privacy mode → preserve draft or prior saved state, give supported export/backup; do not imply durable save |
| A3 Resume | Reopen previously saved plan and relevant results | Retain unchanged birthdate, source ownership, validated loan terms; display data-as-of, saved result-as-of | Model schema incompatible, saved result stale, missing permissions → explain recovery or supported re-evaluation; no invisible overwrite |
| A4 Life change | Report new job, child, residence, mortgage, health coverage or pay change | Create/modify effective-dated authoritative fact once; link affected planning assumptions without rewriting other scopes | Competing import or overlapping employer, tax year or coverage → name sources and reconcile or defer; don't silently pick latest |
| A5 Reevaluate | Request refresh or inspect change-impact notification | Re-run only affected supported forecast/basis, flag old outputs stale and preserve historical snapshot | Long computation/failure, unsupported new feature, altered law → offer bounded retry or partial qualified result, never relabel stale as current |
| A6 Leave/switch | Exit, delete, switch plan/persona, reset model or disconnect source | Check dirty draft and scope, confirm truly destructive action, preserve separate demo/personal identities and immutable provenance as appropriate | Cancel reset, network failure or no save permission → return safely with retained work, clear next steps |

~~~mermaid
flowchart TD
 A["Inspect insight and choose next action"] --> B["Save plan/model explicitly"]
 B --> C{"Persistence confirmed?"}
 C -->|No| D["Keep draft and prior version; retry/export"]
 D --> B
 C -->|Yes| E["Leave, switch or return later"]
 E --> F["Reload named household/plan and freshness"]
 F --> G{"Material changed or out-of-date fact?"}
 G -->|Yes| H["Review only affected source/dated period"]
 H --> I{"Conflict or permission failure?"}
 I -->|Yes| J["Preserve both; specific source repair"]
 J --> H
 I -->|No| K["Update source, invalidate related results"]
 G -->|No| L["Keep valid sources; label retained outputs"]
 K --> M["Re-evaluate supported affected scope"]
 L --> N["Next goal or scenario"]
 M --> N
 N --> O["Enter relevant stage, without restarting onboarding"]
~~~

## H. Persona-specific cross-stage acceptance

| Fixture | First insight → decision path | Must deliberately fail safely |
| --- | --- | --- |
| H01 Vale | Family scope → liquid vs illiquid wealth → estate/gifting alternatives | Adult descendants' holdings pooled, unsupported estate law, survivor horizon beyond reference adult |
| H02 Torres | Monthly liquidity → loans/rentals → sale/paydown options | A child's/grandparent's assets pooled, asset equity treated as liquid, rental tax/HELOC result incomplete |
| H03 Chen | Pay, RSU and concentration → zero vs two children | Inferred RSU tax, children copied into unchanged baseline, incompatible comparison basis |
| H04 Barlow | Debt/reserve and no positions → invest/debt alternatives | Missing investment rows treated as invalid, contribution source without payroll, age-90 horizon greater than present 40-year cap |
| H05 Delgado | Take-home/union/expenses → rent independence and retirement | 18-year-old age-90 horizon (~72 years), contributions counted twice, unsupported benefit/tax rule |
| H06 Bennett | NYC cost/debt → relocation/MBA changes | Dated NYC tax status silently assumed after moving; unverifiable net-pay claim |
| H07 Price | Van costs/remote pay → domicile and purchase/sabbatical | Mailing address assumed tax residency, multi-state taxes projected without rules |
| H08 Ortega | Sources vs owned dependent care → 62/65/67 and survivor alternatives | Dependent adult silently becomes horizon reference or gets pooled assets; care after parents' age 90 not modeled or disclosed |

## I. Verification/rollout and evidence

First, review this document with the PM. Then run baseline GitHub manual UX capture (both viewports) and select a small pilot spanning **H04 first-time authoring** plus one high-complexity path (**H02 or H08**). Make explicit Level 4 clickable screen states and UAT scripts **after** design approval; do not turn these tables into 33 implementation PRs.

Acceptance must cover: (1) effortless first useful demo/personal insight; (2) one writer and source ownership; (3) genuinely partial results and unsupported-domain disclosure; (4) source conflict and broken connection/import; (5) save/resume and destructive protection; (6) retirement and age-90 projection dates with multi-person and >=40-year examples; (7) stale/cancelled forecast; (8) comparison basis and independently saved plans; (9) 390/1440 accessible operation; (10) continuous privacy/consent boundaries.

**Architecture seams before U1B implementation:** current UI accepts 1–40 `horizon` years and contains a 10-year session default; the desired age-90 plan UX requires an explicit longer-run validation, possible execution/performance uplift, model/plan horizon synchronization, and clear data coverage diagnostics across all affected years. The authoritative plan.horizon fact owner stays **Plan → Current Plan**; retirement timing stays **Plan → Life Events**. Do not let a UI-only defaults patch hide required engine capabilities or rewrite financial semantics.

**Next milestone:** approve this non-normative task architecture and the two age defaults, separately decide whether the illustrative extra numeric assumptions should become canonical UX preset values, then implement a Level 4 pilot and only afterward restructure U1B #120 into coherent independent slices with stable backend seams. Changes to executable forecast horizon belong in a scoped implementation task, not this design PR.
