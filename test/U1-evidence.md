# U1 implementation evidence — issue #94

## Owner follow-up inventory (2026-10-10; UAT not accepted)

| Surface | Common | Advanced | Technical / preserved | Dependencies |
| --- | --- | --- | --- | --- |
| Investments | Account totals, cash, expand holdings, Edit account / Edit holding, contributions | Relevant instrument terms only; saved activity | Incompatible stored instrument terms, IDs | Holding → account; instrument type + subtype |
| Annual eligibility | Named person, year, account and employer scope | Current contribution facts; distinct prior-history facts | Original adapter failure | Existing personal/payroll/history policy identity; no scope merging |
| Prior YTD | Boundary, totals, explicit known-zero confirmation, save result | Ordinary/catch-up split; saved usage review | Original scope/eligibility failure | Year + holding + character; deliberate date changes reset confirmation |
| Diagnostics | Named exact targets and truthful repair route | Related record context | Exact-ID lookup, UUIDs, traces | Descriptor editability; no guessed ID matches |
| Mortgage reports | Explicit isolated/reconciled scope, funding account and payment date | Required/available funding and order where reported | Original execution evidence | Existing liability and household execution read models |

Shared required/optional cues follow descriptor/workflow requirements, with
read-only/derived state separate. No new eligibility requirement or financial
formula is authorized. CI observations are recorded below by revision; external
audit/UAT must not be inferred from automated regressions or source review.

| Owner repair | Implementation / source authority | Added CI regression |
| --- | --- | --- |
| Section purposes and required/optional cues | Shared FieldShell/GuidedFields, explicit workflow requirements; confirmations differ from ordinary false boolean facts | Rendered red cue, italic optional cue, label association and geometry at 1440/390; known-zero checkbox save |
| Account-first holdings | Holdings nested in their own expandable account; separate named account/holding edit actions | Keyboard expansion, unrelated-account isolation, width assertions, subtype editor paths |
| Product-specific editor | D1 supported equity/fund/crypto, long call, Treasury/CD boundary; incompatible stored terms preserved read-only | Unit product matrix; rendered fund, missing call subtype, call, CD, crypto controls |
| Entity IDs | Only the bottom entity side-sheet accordion renamed | Existing side-sheet identity/focus regressions updated |
| Named diagnostics | Exact entity/related-ID resolution, descriptor-based editability, canonical trace sources from a known forecast only | Multi-record invalid spending funding with direct field focus; ID lookup, immutable correction, unknown ID; unit exact matching |
| Prior YTD | Stable year/holding/character draft identity; scope changes announced; application read model delegates readiness to existing D1 prerequisites | Scope → boundary → totals/confirmation → unchanged scope save → usage save → inline result → reload, with focus/viewport assertion; incomplete/year/conflict unit cases |
| Repeated eligibility facts | Existing future-plan editor is primary; account/holding summaries are linked read-only; historical policy/year/employer scopes remain explicit and independent | Save age in primary IRA editor and inspect account summary; distinct historical/future employer conflict remains blocked |
| Saved activity | Existing personal/payroll adapters plus recognized stored D1 event adapters; contributions editable via their existing path, other operations inspectable/read-only | Two actions on brokerage, account isolation, revised purchase amount after reload; no fake event editor |
| Mortgage funding | Snapshot exact compiled policy → mortgage/account/order binding; retain execution-provided required/available amounts and evaluation date | Golden 24-month standalone liability / standalone cash / reconciled comparison; posted-account cash oracle, transaction balance, summary/detail/replay parity; separately funded bank account cannot cover mortgage; rendered scope/account/date/funding navigation |

The mortgage fixture is synthetic Golden evidence, not the owner's particular
model. `test/u1MortgageReportScopes.test.ts` deliberately fails if a reconciled
payment lacks adequate cash in its designated account or if another account is
implicitly pooled. It preserves frozen D1 formulas. No formula repair was made.
The known all-or-nothing shortfall's `fundedAmount` is potential source cash
(`src/funding/resolution.ts`), not a posted partial payment; it is displayed as
available funding only in the shortfall context. Successful payments retain
their original accounting behavior. Independent re-audit and owner acceptance
are not self-attested here.

### Observed GitHub verification (2026-10-10)

At implementation revision `9c55659d94446ee7058cd5538433a8d694d1c53a`,
[GitHub run 38080463410](https://github.com/bensmullen/personal-finance-app/actions/runs/38080463410)
passed typecheck, build, architecture, specification, codex-tooling, unit, and
verification-plan. Unit success includes the synthetic Golden mortgage
report-scope and per-account posted-cash assertions described above. It does
not reproduce a private owner model or establish browser/UAT acceptance.
Browser CI reported seven failures: nested-card/contribution selector ambiguity,
older YTD label and disabled-save expectations, a missing observed-history
notice, and a diagnostic journey timeout. The follow-up restores the
observed-history notice, scopes account actions to their named contribution
regions, updates YTD selectors with their displayed year, asserts the existing
scope prerequisite before Save, and bounds diagnostic action waits. Financial
and saved/exported-value expectations are preserved. Latest-head browser CI
remains required; earlier passing tests are not whole-suite acceptance.
No local verification or dependency installation was performed.

Eligibility identity inventory: future IRA facts belong to the holding's saved
purchase policy (person + contribution year + character); future workplace/HSA
facts belong to its payroll policy (person + year + employer bucket where
applicable); prior-history facts belong to the independently authored historical
policy (holding + year + employer bucket). Account/holding summaries read those
same policies and never create parallel values. The existing scope-conflict guard
is retained rather than silently merging distinct historical and future policies.

PR #98 remains draft. Issue #94, U1 and D1 remain open. Latest-head CI,
independent ChatGPT audit and uncoached owner UAT are still required.

The machine-readable inventory is `ui/authoring/fieldContract.ts`. Its explicitly
registered fields contain classification, label, meaning, unit, format, example,
state, source, dependencies, and suggestion policy. Rendered required/read-only
state follows the authoritative descriptor or workflow. Schema additions do not
automatically become normal controls. `GuidedFields` rejects unregistered normal
labels, and `PercentageInput` rejects unregistered percentage controls.

| Journey | Shared presentation / authority | CI evidence |
| --- | --- | --- |
| Initial setup, salary and structured facts | FieldShell; staged entity save; immutable facts preserved; structured facts technical/read-only | U1 browser navigation and existing immutable/structured editor coverage |
| Plan and simulation dates | Shared errors; existing horizon replacement adapter; valid half-open monthly run window | U1 field contract and browser horizon/repair assertions |
| Mortgage terms, maturity and extra principal | Existing mortgage schedule suggestions, explicit maturity correction, existing operation adapter and projected-payoff read model | Existing D1 mortgage browser assertions plus U1 contradiction controls |
| IRA / brokerage contributions | Contextual destination; checking/savings selector; existing personal purchase adapter | Existing contextual save/export test and U1 account-path test |
| Workplace / HSA contributions | Compatible destination characters and same-owner gross salaries; employer-only matching; existing payroll adapter | U1 choice contract and account-path browser assertions; existing export assertions |
| Return assumptions | Exact percentage conversion; linked deterministic assumption; collapsed card editor | Existing return/save/rerun browser coverage |
| Tax payments / refunds | Explicit accounts, validated following-year date, confirmation reset on edits | Existing tax setup/export coverage; U1 setup path |
| Invalid inputs and diagnostics | Inline errors, direct repair/focus opening ancestor disclosures, global setup and saved-fact summaries; original engine diagnostic grouping retained | U1 browser focus/disabled-save assertions; existing diagnostic grouping assertions |
| Responsive / accessible help | Shared input geometry, keyboard/click/touch disclosure, label and help relationship | Browser geometry at 1440px / 390px and keyboard-help assertions |
| Save, reload, import | Existing model persistence and D1 adapters; session setup remains explicit | Existing persistence and import/export browser tests adapted to explicit save |

No local tests, typecheck, build, browser run, validators, dev server, or package
installation were performed. Revision-specific GitHub observations are recorded
above. Browser console cleanliness and geometry require browser CI evidence;
passing unit checks alone do not establish them. Independent ChatGPT UX/semantic audit and uncoached product-owner
UAT remain external acceptance gates. This implementation does not close D1.

Product-owner UAT goals: create/edit personal and payroll contributions; configure
and change a mortgage; change planning/forecast dates; run/update a forecast; fix
an incomplete setup; interpret a partially modeled tax result; edit salary and
investment return. Acceptance includes first-impression organization and cognitive
load. These goals deliberately contain no implementation-specific click recipe.

## PR #98 audit repair

| Journey / reported failure | Repair | Regression evidence in GitHub CI |
| --- | --- | --- |
| Treasury maturity used loan guidance; assumption source/category used income/spending meaning | Domain-scoped inventory and metadata; descriptor-based edit state; annual assumption rates use exact percentage entry | Contextual contract assertions and rendered assumption/Treasury browser controls, including advanced help |
| Numerically valid but incompatible financial relationships could save | Exact bounded payroll rate/owned-share and unvested-unit checks; date chronology, salary ownership, saved-contribution account protection and compatible funding currency | Boundary unit cases; payroll >100% and Treasury chronology browser assertions; existing mortgage maturity/schedule journey |
| Escape, Close and Cancel lost staged edits | Explicit Discard changes / Continue editing warning; failed saves retain the form | Salary modify/Escape/Cancel/discard browser journey; purchase precision failure retains unsaved amount |
| A recognized immutable field offered a dead repair link | Repair routing checks descriptor, structured state and relationship availability; non-editable facts offer corrected-model import | Deliberately incomplete imported salary and immutable opening balance browser journey |
| Unrelated saves reset contribution drafts | Load a plan only on intentional destination changes; preserve inputs on saved-plan updates | User-created payroll and brokerage purchase with interleaved saves and dirty-input retention |
| Tests checked choices or unsaved inputs rather than durable authoring | Assert saved-plan summaries, local save/reload, and reloaded IRA and workplace account summaries | IRA edit, new brokerage purchase, employer HSA save, reload and restored amount assertions |
| Unknown exceptions leaked internals or lacked original evidence | Friendly bounded error mapping; original failure inside explicit Technical details | Unknown-exception unit assertions and failed purchase browser journey |

Boundaries remain explicit: complex vesting, unsupported contribution policies,
structured dated tax facts, immutable recorded facts and executable return-model
relationship creation require the supported existing authoring route or corrected
model import. Unknown annual eligibility remains incomplete. Tests and CI do not
establish independent re-audit or product-owner visual/uncoached UAT acceptance.

## Linked-return alternate-route repair (2026-10-09)

Source review confirmed Plan → Assumptions could save a linked P23 return below
−100%, while the holding action rejected it. Both now use the same exact
canonical-rate validation. D1 authority is the effective-annual lower boundary
in `src/primitives/evaluation.ts` and the linked assumption contract in
`src/application/compiler/investments.ts`; no financial formulas changed.

| Route / failure | Repair | Regression evidence |
| --- | --- | --- |
| General assumption editor bypassed the lower boundary | Inline accessible error and disabled Save; staged values retained and committed values preserved | Unit boundaries including −1.000000000000000001; browser reject/discard/reopen, exact −100% save and valid negative save |
| Retyping linked meaning could invalidate forecasting | Validate staged unit, category, dates and plan against the committed executable relationship; retain name/source/value edits | Unit compatibility cases; browser unit/category rejection and restoration |
| Holding action used a separate guard | Shared return validator; FieldShell error and disabled Apply | Browser below-boundary rejection, exact boundary Apply, negative Apply, usable forecast and saved/reloaded return |
| Investment comparison accepted syntactically valid unsupported returns | Same range guard on investment comparison with actionable explanation | Browser invalid/valid comparison availability |

Other percentage surfaces were reviewed at source: payroll contribution, match
cap and vested share already enforce their 0–100% domain; debt nominal rates
and unrelated assumption rates retain separate semantics. The shared What-If
rate also serves income/spending, so the new return restriction applies only to
investment comparison. No blanket prohibition on signed rates was introduced.
The browser regression expects the Golden example's existing tax incompleteness
while asserting a usable reconciled forecast; that limitation is independent of
return validity. No local verification or new ChatGPT interactive test was run.
Latest-head CI, independent ChatGPT re-audit and uncoached owner UAT remain gates;
PR #98 stays draft and Issue #94, U1 and D1 remain open.
