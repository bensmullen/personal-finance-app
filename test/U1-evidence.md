# U1 implementation evidence — issue #94

## Ownership-register lookup found during rendered-field audit (2026-10-13)

Final provenance follow-up distinguishes anchored legacy snapshots, recorded
annual observations and explicitly confirmed future-year assumptions. The UI
names that distinction before save, uses ordinary filing-status labels, and
stores the provenance with the original source. Both tax v2 replay and projected
contribution source evidence retain it; no observed history is relabeled. This
follow-up also requires its own latest-head CI.

V2 codec/source selection additionally enforces the recorded household identity
and exact tax year. Added replay transport coverage rejects a filing fact for a
different household and rejects selecting v1 semantics for a v2 annual artifact.

The remaining full migration cannot be truthfully mapped to the controlled
50-family register without a product/specification decision. The actual
`DomainMechanicsPanel` normal/advanced controls include **sales, dividends,
interest distributions, option exercise, in-plan conversion, direct/split
rollover and indirect distribution/deposit**, alongside **TermLifeEditor**'s
policy owner, insured person, beneficiary, premium/benefit accounts and amounts,
coverage dates and scheduled death date. The register has no insurance or
retirement-operation election family. `investment.holding` owns recorded
instrument/units/lots/basis facts; `investment.purchase` owns planned purchases
and cash-funded contributions. Neither authorizes silently equating these
different decisions with a position fact or an annual contribution.

LOOKUP_REQUIRED: supply approved semantic family IDs, sole owner surfaces and
scope/conditional bindings for these existing financial-operation and term-life
inputs in `docs/specs/verification/u1-fact-ownership.json`, with any controlling
PFA-UX change required by that decision. Issue #94 expressly requires controlled
registry classification when a rendered family is missing. These documentation
paths are not authorized by the current product task; no controlled file was
edited. Recommendation: classify the existing investment-operation elections
under Investments & retirement with event/scenario scope; assign term-life
facts explicitly to an approved insurance owner, preserving the existing D1
adapters and financial meaning. A controlled specification/governance PR can
resolve this without a new engine or a new implementation branch.

This blocks the exhaustive rendered-field/zero-duplicate-writer acceptance, not
the independently authorized annual-filing repair. Other current migration gaps
(generic global assumption repair, standalone/session mirror cleanup, and full
browser setup-route migration) remain implementation work after that lookup; no
zero remaining codes/duplicates or completed whole-registry audit is claimed.

### Four reported failures — current disposition

| Failure | Implemented / grounded | Remaining acceptance |
| --- | --- | --- |
| Paycheck discovery/categories | Automatic committed-month comparison; distinct posted workplace, mortgage, living, IRA, brokerage, tax and other amounts; source links; provisional unallocated remainder | Withholding remains not modeled under #101; latest-head browser/visual and uncoached owner acceptance remain pending |
| Historical conflict/message | Same-scope resolver, named annual fact/year conflict, explicit correction preserving original evidence and YTD; compatible policy copies coalesce | Whole-registry owner binding and all affected browser repair paths still need completion |
| Future facts/checkbox | Blanket checkbox removed; annual original sources and DOB age; annual household filing now shared by tax and IRA; missing sources remain incomplete | Qualified legal compensation/MAGI/health derivations remain bounded by their actual authority; no guessed future facts |
| Cross-screen duplicates | Shared annual source dialog; legacy filing input managed/read-only; bank/assumption mirrors; adjacent Income/Spending growth; Model Settings dates read-only | Missing registry families above and remaining known-family owner migrations prevent full compliance |

At implementation commit `a710a84`, GitHub run 38647160353 passed architecture,
codex-tooling and verification-plan. It reported two typing problems and four
unit failures; follow-up changes correct nullable source-array typing, fixture
typing, HSA source-family selection and DOB, annual-status assertions, and compare
legacy replay's deterministic metadata/state/periods/diagnostics separately from
its live kernel object. Financial money assertions are retained. E2E was still
in progress at inspection. Follow-up browser coverage uses the shared annual
owner dialog and the Current Plan date owner, adds 1440/390 filing screenshots,
keyboard/focus/help assertions and saved/exported annual tax-fact checks. These
are authored CI regressions, not locally run or claimed passing evidence.

PR #98 stays draft; #94/D1, independent audit and uncoached owner UAT remain open.

## Annual household filing continuation (2026-10-13) — implementation in progress

Issue #94 now authorizes the three tax participant/contract/codec files. Fresh
compilation transports one immutable household filing-unit record per tax year,
resolved by the same annual source reader used by IRA eligibility. An undated
Household/Person status establishes only the explicit as-of year (or explicit
opening simulation-start year); no wall-clock year or perpetual fallback exists.
Matching authorities coalesce; disagreements require an acknowledged source
correction in the shared Household & People annual editor. Canonical legacy
snapshots and historical contribution money are preserved.

New artifacts use household-tax/v2; household-tax/v1 retains its historical
fixed-status calculation, participant version and portable input. Annual source
identity/version/status travels in v2 and tax traces. Missing/conflicting years
produce year-specific incompleteness and an in-context filing repair action;
the old canonical filing-status input is now a managed read-only snapshot.

Added `u1AnnualFilingStatus.test.ts` covers anchored/unanchored legacy years,
explicit 2027 status shared with IRA facts, catalog selection, named conflicts,
acknowledged repair, import/reload, new replay parity and unchanged v1 arithmetic.
Existing synthetic catch-up fixtures now supply DOB matching their intended
50/55-year-old participants; their monetary expectations are unchanged.

Starting head `3cbb519` failed GitHub CI (run 38194779215): typecheck, build,
architecture and seven unit cases. This continuation repairs the reported
readonly/optional typing, uses the compiler-owned cash-flow boundary for annual
pay, and limits explicit future fixture facts to their applicable legal family.
No local verification ran. New-head CI is pending. The whole-registry ownership
migration and browser journeys remain active work; this entry claims neither
complete U1 acceptance nor green CI. PR #98 stays draft and #94/D1 remain open.

## October 12 source-owner continuation — partial, blocked at household filing status

This is the current checkpoint and supersedes the older blockers below. The
contribution-year interface and monthly cash-use comparison were authorized by
Issue #94 and are now present. The merged PR #112 register is available. PR #98
remains draft; #94 and D1 remain open. Independent audit remains NEEDS PATCH and
owner UAT remains not accepted.

### Exact new scope boundary

The register requires one dated filing-status authority shared by contributions
and household tax calculation. The new scoped contribution editor can store a
person/household/year filing fact. However, `compileHouseholdTax` reads only the
undated canonical Household/Person `filing_status` values, and
`HouseholdTaxInput` contains a single `filingStatus` for the entire forecast.
The tax participant selects every year's rule with that same value; the portable
codec transports that same fixed input. An application-only change cannot select
a different authoritative filing status in each tax year without changing this
execution contract. The draft UI explicitly discloses this limitation; it does
not claim that saving contribution filing status changes household taxes.

LOOKUP_REQUIRED: authorize `src/simulation/tax/contracts.ts`,
`src/simulation/tax/participant.ts`, and `src/simulation/tax/replayCodec.ts` for
an immutable, source-qualified, year-indexed household filing-status input and
selection before existing rule evaluation. Missing/conflicting year facts must
produce scoped incompleteness, not reuse an unrelated year. Preserve existing
statutory formulas, accounting, settlement, funding and event ordering. Replay
must retain the exact selected year/source and deterministically restore it.
Legacy undated status needs an explicitly approved temporal interpretation; it
must not silently become evidence for every future year. No changes to these
three unauthorized files were made.

DECISION_NEEDED: approve the narrow dated household-tax filing interface and
state which tax year(s), if any, a legacy undated filing status establishes.
PRODUCT_IMPACT: a filing-status correction must affect contribution eligibility
and the same year's household taxes consistently.
OPTIONS: (A) extend the year-qualified tax interface and explicitly scope legacy
records; (B) approve a bounded U1 exception that leaves household filing changes
unsupported and visibly incomplete.
RECOMMENDATION: A; do not introduce a second independently editable tax status.
TECHNICAL_REASON: the current tax participant has one fixed status across all
years, unlike the newly authorized contribution-year interface.

### Implemented source changes; rendered-field audit is still partial

| Actually rendered fields/output | Semantic ID | Source editor / read-only mirrors | Derivation or remaining exception |
| --- | --- | --- | --- |
| Date of birth / annual age | `person.birthdate` / `person.age_year_end` | Household & People / personal, payroll and history eligibility | December 31 age uses DOB; no separate age input. Existing immutable birth records require corrected import. |
| Annual IRA compensation / prior sponsor wages | `income.ira_compensation` / `income.prior_sponsor_wages` | Shared dated Income fact dialog / contribution summaries | Explicit year-qualified evidence only; no salary-to-IRA or current-to-prior-wage inference. |
| Annual salary read model | `income.annual_pay` | Read-only application reader | Reuses supported monthly recurrence, P08 growth and dated termination; not yet connected to normal UI or a plan compensation definition. |
| Eligible plan compensation / Roth plan availability | `employer.eligible_pay` / `employer.plan_terms` | Shared dated Investments fact dialog / payroll/history summaries | Explicit person/sponsor/year facts; no guessed legal compensation rule. |
| Filing status / spouse residence | `tax.filing_status` | Shared dated Household & People dialog / contribution summaries | Household-tax execution still fixed/undated: BLOCKED as above. |
| Roth and deduction MAGI / workplace coverage | `tax.roth_magi` / `tax.deduction_magi` | Shared Household & People dialog / contribution summaries | Supported explicit yearly facts only; gross salary never substitutes for MAGI. |
| HSA eligibility, coverage and family allocation | `health.coverage` | Shared dated Household & People dialog / payroll/history summaries | Unknown coverage stays unknown; no inference from owning an HSA. Exhaustive household/spouse scope audit remains. |
| Income receiving account | `income.receiving_bank` | Money Income session control / Current Plan summary | One household session route; import/load clears it. Per-income routing unsupported. |
| Bank details | `bank.cash_account` / `bank.interest` | Money Accounts shared entity editor / Net Worth bank mirror | Mirror opens the same contextual editor; investment wrappers filtered from Money Accounts. |
| Mortgage session funding/schedule; extra principal/refinance | Mortgage register families | Net Worth Debt / Current Plan summary | Existing controls moved; payment/maturity semantics unchanged. Remaining browser setup journeys need migration. |
| Plan/forecast dates and clock | `plan.horizon` / run-setting register families | Current Plan / Model Settings read-only mirror | Horizon has one editable control; shared context repair drawer preserves page. |
| Retirement date | `life.retirement` | Life Events / Current Plan summary | Existing canonical retirement adapter retained. |
| Assumptions / holding return | Growth/return register families | Shared owner entity drawer; holding return editor / Plan Assumptions mirror | Income/spending adjacent growth actions and exhaustive contextual ownership bindings remain unfinished. |
| Prior contribution usage | `investment.past_usage` | Investments & retirement / capacities and forecast | Source corrections preserve original adapters, original values and prior YTD totals; changed imports reopen conflicts. |
| Future capacity | `investment.contribution_projection` | Read-only year-qualified schedule / forecast | Source-qualified annual facts, derived DOB age, unchanged nominal statutory law; missing facts do not execute future contributions. No blanket fact carry-forward. |
| Monthly paycheck comparison | `money.paycheck_view` | Money Cash Flow / Debt and Spending evidence | Recorded gross payroll vs actual posted employee, mortgage, living, IRA, brokerage, tax and other uses. Each cash leg counted once; employer assets/internal cash transfers excluded. Receipts and nonpayroll income separate. |

Paycheck widths are presentation-only and capped at the displayed basis; legends
retain full amounts/percentages and additional-funding need. Unallocated is
provisional, never leftover: withholding remains not modeled under #101. Named
source buttons use the shared contextual entity editor. No cash-origin/FIFO
assumption or funding precedence was added.

The matrix is **not** the required exhaustive rendered-field mapping for all 50
registry families. Zero remaining raw normal-user codes and zero duplicate
writable scoped identities have **not** been established. Additional annual pay
UI/qualified plan definitions, conditional field bindings, global growth owner
repair and browser setup-route migration remain unfinished. This checkpoint
preserves partial work, not implementation acceptance.

### Added/updated evidence; no passing result claimed

- `u1AnnualFinancialFacts.test.ts`: acknowledgement-required reconciliation,
  original adapter/cash/holding preservation, changed-import conflict, distinct
  sponsor/year, no nominal carry-forward, exact gross salary/termination reader.
- `u1MonthlyMoney.test.ts`: actual employee/mortgage/IRA/tax categories, unique
  posted legs, savings source retained, employer exclusion and exact comparison.
- `d1ForecastDecisions.test.ts`: synthetic explicit dated future records replace
  the old checkbox fixture; existing ten-year financial/replay assertions stay.
- `u1FactResolution.test.ts`: exact named field/year conflict now raised at
  authoring instead of a vague later historical-scope failure.
- Browser assertions adapt monthly legend, shared historical correction and
  read-only DOB-derived age. The remaining source-owner/setup journeys are not
  represented as complete or CI-green.

Local tests, typecheck, builds, validators, browsers/dev servers and dependency
installation were not run. Current checkpoint CI is pending; prior green CI
belongs to older heads and does not verify these changes or deployment.

Published partial implementation checkpoint:
`a37bf58a82373fb33bb59feec6cc871ffec65337`. The Code Review connector observed
`verification-plan` in progress for that exact SHA in
[Actions run 38194706651](https://github.com/bensmullen/personal-finance-app/actions/runs/38194706651).
No successful check or complete suite was reported at that inspection. This
subsequent evidence-only update also requires its own latest-head CI; it does
not inherit a passing result from the implementation checkpoint.

## October 11 continuation after operator synchronization — partial, blocked

This supersedes the missing-registry checkpoint below. PR #112's register and
PFA-UX-021–023 are present at `c3d01f8`. Independent audit remains NEEDS PATCH;
owner UAT remains not accepted. PR #98 stays draft and #94/D1 stay open.

| Reported failure | Implemented this continuation | Remaining release blocker |
| --- | --- | --- |
| Paycheck discovery/category fidelity | Selected committed month loads automatically on Cash Flow, Debt and Spending; failure has Retry and setup actions | Full income-funded categories and withholding are not established; two-segment incomplete view is not owner acceptance |
| Historical scope conflict | One scoped resolver; compatible same-year copies ignore unused annual projection metadata, excess behavior and rule-reference IDs; money formatting normalizes exactly; original historical confirmation and usage retained | Specific conflicting field/source repair dialog and distinct-sponsor YTD routing still needed; true conflicts remain blocked |
| Future facts/checkbox | Blanket checkbox removed; unsupported year-by-year coverage stated; existing imported assumption inspectable and explicitly removable on save; calendar-age derivation available in application layer | Executable annual projection lacks a source-qualified year-indexed facts input; age helper is not yet a complete policy migration |
| Duplicate writable facts | Typed semantic scope includes person/year/household/sponsor/account/holding/scenario/interval/bucket/character, with provenance and owner repair | Whole-registry write bindings and removal of existing editable policy mirrors are not complete |

No local verification ran. Added unit coverage targets deterministic scoped
coalescing, true conflicts, distinct scopes, age derivation, nonzero historical
usage, exact money formatting, import/reload and unchanged accounts/holdings.
Browser assertions now require initial/month-change evidence without a reveal
click and absence of the blanket checkbox; durable saves must leave unsupported
future facts unasserted. Latest-head GitHub CI is pending. These are added
regressions, not claimed passing results or deployment evidence.

### Exact required interface authorization

1. `src/simulation/contributionProjection.ts`, its callers and policy type:
   accept immutable, source-qualified facts keyed by person, year, sponsor/plan,
   legal bucket/character and effective scope. Resolve the requested year before
   capacity/tax evaluation; missing authority must remain incomplete. Preserve
   original observed usage and current projected-law formulas. Application
   resolution must supply qualified facts without serializing new stale policy
   copies. Tests must demonstrate year transitions, growth/termination, distinct
   employers, unavailable MAGI/coverage and summary/detail/replay consistency.
   `D1ContributionFacts` in `src/rules/contribution2026.ts` currently exposes only
   `confirmed_nominal_carry_forward`; any required type change needs explicit
   scope authorization, not inferred permission to redesign statutory formulas.
2. Household/payroll replay contract: provide actual modeled withholding coverage
   and an explicit same-month cash-origin attribution or approved attribution
   semantics distinguishing opening savings, other income, refunds, transfers
   and payroll. Posted cash debits alone prove use, not paycheck origin. #101's
   withholding infrastructure is not implemented by this UI patch. Until this
   contract exists, mortgage/IRA/living cash uses stay separately grounded and
   cannot be promised as reconciled paycheck segments or Leftover.

The out-of-scope financial boundary is reached. No simulation/rules/schema/spec
changes were made. The existing supported-year UI and accounting evidence remain;
this is a BLOCKED partial implementation, not U1 completion or acceptance.

## Source-of-truth repair checkpoint (2026-10-11): blocked before implementation

Source review started at `38b033f04cf3d4721a06d5f0b64f5fbb19b2f6bb`.
This checkpoint supersedes earlier acceptance implications, not existing code or
revision-specific CI evidence. Independent audit is **NEEDS PATCH**; owner UAT
is **not accepted**. PR #98 remains draft; Issue #94/D1 remain open.

The required PR #112 architecture is absent from this checkout:
`docs/specs/verification/u1-fact-ownership.json`, its accompanying
`u1-fact-ownership-audit.md`, and PFA-UX-021–023 in
`docs/specs/capabilities/application-ux.md`. Locally cached `origin/main` is
`1f5c836` (#97); this does not establish current GitHub merge state. Issue #94
requires the approved ownership register as the starting family inventory and
assigns existing-branch synchronization to the operator. No replacement registry,
semantic IDs, controlled-document edits or branch synchronization were introduced.

### Current source inventory (partial; not the exhaustive registry audit)

| Rendered facts / controls | Current source | Required owner from #94 | Exception / boundary |
| --- | --- | --- | --- |
| Salary amount/frequency/growth; incoming bank | Income editor; Current Plan session receiving account | Money → Income | Incoming-bank configuration remains outside the income editor |
| Checking/savings facts | Shared entity editor from Money Accounts and Net Worth bank page | Money → Accounts; shared in-context editor for mirrors | Rendered-route ownership audit pending |
| Spending/growth; investment return | Expense/Assumption editors and contextual return editor | Money → Spending; Investments & retirement | Plan Assumptions remains an edit route |
| Mortgage terms/funding/priority | Liability editor; Current Plan `LiabilityExecutionControls` | Net Worth → Debt | Session funding remains on Current Plan; replay is the single payment source |
| Age/compensation/filing/MAGI/coverage/plan terms | Personal/payroll/historical `AuthoredContributionFacts` snapshots | Household/People or investment plan editor per approved record | Same labels do not establish the same person/year/employer/legal fact |
| Prior YTD and known-history confirmation | Opening usage snapshot and readiness/options adapters | Investments & retirement | Preserve observed totals, known zero and legal capacity scopes; never post cash |
| Future annual facts | `AnnualContributionAssumption`; `parseContributionFacts` | Source-qualified derivation or supported assumption at actual owner | Current authored-fact contract accepts only nominal carry-forward; it does not establish growth-qualified compensation/MAGI/coverage |
| Horizon/simulation/retirement | Current Plan, Model Settings, session retirement override | Current Plan run settings; Life Events retirement | Owner/mirror consolidation pending |
| Paycheck month/basis/categories | Money Cash Flow `MonthlyEvidence`, `MonthlyMoneyPanel`, `inspectMonthlyMoney` | Money → Cash Flow | Explicit review click; employee/unreconciled segments; other cash uses not attributed to pay |

Approved semantic IDs cannot be mapped until the required 50-family register is
available. This partial inventory does not establish exhaustive conditional-field
coverage or zero duplicate writable identities.

### Four reported failures: current completion status

| Failure | Status | Source evidence / required next work |
| --- | --- | --- |
| Paycheck visibility/category fidelity | Supported but incomplete; not accepted | Panel renders only employee/unreconciled segments after review. Replay separately grounds mortgages, purchases and cash uses; withholding is explicitly not modeled. Exact income-funded attribution is not demonstrated. |
| Historical conflict/message | Needs patch | `contributionOpening.ts` keys by holding/character/year and compares almost the entire policy. `u1OwnerRepairs.test.ts` still expects conflict rejection. Approved scoped identity/provenance must precede lossless reconciliation; distinct employers/years stay distinct. |
| Future-year projection/checkbox | Needs patch; engine boundary unresolved | Checkbox carries compensation/MAGI/coverage nominally. Removing it does not create source-qualified annual facts. Inspect approved registry and executable/statutory contracts before requesting any narrow engine delta. |
| Cross-screen redundant fields | Blocked on architecture synchronization | `fieldContract.ts` contains presentation metadata, not a typed ownership resolver. Required registry and PFA-UX-021–023 are absent. |

Unblock by making merged PR #112 architecture available in this existing branch
through the operator-managed synchronization required by Issue #94, then resubmit
`PFM_TASK_ISSUE: 94`. No additional controlled-document write scope is requested.
Any necessary statutory projection/payroll attribution delta must be established
separately after inspecting that authority, rather than invented in React.

This checkpoint changes evidence only. No local tests, builds, validators,
dependency installation, browser runs or dev servers were executed. New CI,
independent semantic audit and explicit uncoached owner UAT remain required;
earlier green CI does not prove these repairs or production deployment.

## Remaining owner requests: implementation inventory

| Surface | Common | Derived / read-only | Boundary |
| --- | --- | --- | --- |
| Money: Your Paycheck | Calendar month, household scope, review month, source links | Posted employee allocations and gross recurring income; unreconciled coverage | Withholding and income attribution unavailable; never label remainder Leftover |
| Debt / Spending | Month, named mortgage, payment account, review funding | Contractual payment, actual principal/interest/extra principal from the same replay | No escrow invention, duplicate payment or principal expense |
| Investments & Retirement | Account-context contribution action and existing editor | Saved activity summary | Existing personal/payroll adapters only |
| Current Plan | Read-only activity and edit links | Existing saved contribution plans | No competing contribution editor |
| Forecast cutoff | Modeled boundary, concise cause/remedy, affected records | Existing diagnostic targets and stoppedAt | Unsupported capability has no invented editor repair |

This inventory precedes the follow-up edits. Month selection is presentation-only;
replay is requested explicitly and cached per immutable result/month. Dollar values
come from posted Money legs, never JavaScript floating-point calculations.

### Owner requests 11–15: current follow-up evidence and limits

- `src/application/monthlyMoney.ts` reads one committed month's immutable replay
  and leaves the result untouched. Debt and Spending share this adapter. It
  distinguishes contractual payment, scheduled amount due, actual principal
  repayment, recognized interest, extra principal and evaluated funding status.
  Posted bank purchases retain source cash account, destination holding and date.
  The date is the actual posted instant: D1 personal purchases select an eligible
  month from the authored schedule and execute at month close. This presentation
  does not introduce same-day purchase execution or new recurrence semantics.
- Money's Your Paycheck uses supported recurring household income before modeled
  employee allocations as its labeled basis. Only employee allocations from
  `payroll_income` are shown as known deductions; employer transactions, investment
  transfers and mortgage payments cannot reduce that denominator twice. The rest
  is explicitly **not yet reconciled**, never Leftover. Separate cash-use detail
  does not attribute savings, benefits, refunds or investment proceeds to pay.
- Withholding is explicitly not modeled; annual tax liability is never spread
  across months. No fully reconciled paycheck breakdown, actual after-tax pay or
  income-funded allocation is claimed. This is the issue's grounded/incomplete
  fallback pending the missing payroll/attribution contracts and #101.
- Contribution editors and annual capacity/history now live in Investments &
  Retirement. Current Plan shows saved activity and account-context edit links.
  The existing specialized investment purchase/transfer editor also moved there;
  Current Plan's operation choices are limited to extra principal/refinancing.
  Existing adapter, persistence and financial semantics remain authoritative.
- Shared diagnostic presentation bounds the default problem/remedy and preserves
  the full mapped explanation and machine evidence in Technical details. Cutoff
  displays the exclusive last modeled boundary; it does not label the first
  unmodeled day as successfully forecast. Existing entity repair routes remain.
- `test/u1MonthlyMoney.test.ts` adds combined-fixture payroll, employer exclusion,
  savings-funded IRA, one mortgage, immutable replay and month-identity assertions.
  Browser coverage adds real navigation, matching Debt/Spending amounts, mobile
  geometry, account editor focus, incomplete coverage and console assertions.
  Existing contribution/history browser journeys follow the relocated controls.

No follow-up checks have been run locally. GitHub CI at `b1066c7` passed all
1,047 unit tests, build, typecheck, architecture, specification and tooling checks.
The new monthly-view browser journey passed; four existing browser assertions
failed on relocated-page navigation or diagnostic visibility/duplication. The
follow-up scopes assertions to visible primary diagnostics, restores the forecast
page before inspecting its table, and preserves the visible volatility cause.
Those corrections passed GitHub Actions [run 38101071410](https://github.com/bensmullen/personal-finance-app/actions/runs/38101071410)
at code revision `ecdc064`: 1,047/1,047 unit tests across 63 files, all 55 browser
tests, build, typecheck, architecture, specification, tooling and verification-plan.
The browser evidence includes desktop/narrow geometry and unexpected console/page
error assertions; it does not establish independent visual or uncoached acceptance.
The following evidence-only commit changes no executable code. Independent audit, owner-specific funding
reproduction if still reported, and uncoached owner UAT remain pending. Debt
monthly evidence currently requires explicit Review selected month after a
current household forecast; unavailable/stale results never display guessed
payments. Full normal-user diagnostic coverage, cutoff attribution across all
capabilities, and the final visual density must still pass the owner gates.
PR #98 stays draft; Issue #94 and D1 remain open.

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
At `f310d1d`, all non-browser checks passed and browser CI narrowed failures to
two selector issues: selecting a contextual account option by its bare name,
and matching three accessible alerts instead of the prerequisite message.
The diagnostic reached the named spending editor and focused its funding field.
Follow-up selectors retain these assertions and select the exact checking ID.
At implementation revision `4f4059ed6c0ccd6ec723e8577308e47535f0db37`,
all GitHub verification checks passed, including `PASS playwright — 54 tests`.
The browser evidence is job `114299600848`; it covers the owner account,
subtype, prior-YTD save/reload/focus, named multi-record repair, saved activity,
linked eligibility, and mortgage explanation/navigation journeys above.
Responsive geometry and console assertions passed within those automated
journeys. This is automated evidence, not an independent ChatGPT audit or
uncoached product-owner UAT. The subsequent evidence-only commit does not
change implementation or test behavior; its own CI remains a separate gate.
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
# October 13 registry continuation — pre-edit source inventory

PR #117 is present in the operator-synchronized branch at `335c8e8`.
This continuation preserves the annual-fact, filing-status and paycheck work.

| Actual control group | Registry owner | Before this continuation | Planned migration / source |
| --- | --- | --- | --- |
| Sale, distribution, reinvestment, exercise, conversion, direct/split/indirect rollover | Subtype-specific `investment.*` family | One global operation panel with unrestricted holding choice | Same D1 operation adapter, instantiated only inside the source holding; conditional controls bound to subtype and event |
| Opening lots | `investment.holding` | Global holding selector and lot editor | Existing opening-lot adapter inside that holding; recorded units/basis remain separate from activity |
| Policy owner/insured/beneficiary/coverage | `insurance.term_life_policy` | Nested under investment operations | Shared Money → Insurance & coverage policy editor |
| Premium amount/monthly cadence/bank | `insurance.term_life_premium` | Same nested policy form | Same canonical Insurance terms; one compiler-generated premium settlement |
| Face amount/benefit bank | `insurance.term_life_benefit` | Policy creation requires death | Policy contract independent of optional event; no posted benefit before trigger |
| Optional death date/scenario/enabled | `life.death_event` | Written implicitly by policy save | One shared Life Events editor, also opened contextually from a saved policy; preserve legacy references |
| Conditional payout | `insurance.benefit_payout` | Compiler rejects policy without event | Existing D1 payout only for a valid linked scenario event; no editable payout |

Common controls: dates, amounts, named relationships and confirmation where
required by D1. Advanced: event ordering, lot selection and recorded opening
lots. Technical/read-only: IDs, adapter lineage and unsupported imported policy
terms. Derived/hidden: policy/event IDs, beneficiary mirror, option strike and
multiplier, linked recognition effects. Unsupported policy families remain
read-only and capability-gated. Latest-head CI and owner UAT remain pending.

| Rendered fields | Semantic family | Sole editor / authoritative adapter | Read-only mirrors / derived exceptions |
| --- | --- | --- | --- |
| Source holding, date, amount, units, optional lot/order | `investment.sale` | Holding → Activity & transfers / `authorDomainOperation` | Saved activity and cash-use reports; lot basis/gain from D1 |
| Call source, date, contracts, bank, optional lot/order | `investment.option_exercise` | Same scoped editor / `authorDomainOperation` | Strike × contracts × multiplier shown as exact calculated exercise cash; funding/settlement remains D1 |
| Distribution kind/date/amount/order | `investment.income_distribution` | Same scoped editor / `authorDomainOperation` | Tax character selected by subtype; no second Income record |
| Dividend amount/units/character/date/order | `investment.dividend_reinvestment` | Same scoped editor / `authorDomainOperation` | D1 recognizes dividend and buys once; no separately authored dividend |
| Date/amount/destination/acceptance/same-plan/order | `investment.retirement_conversion` | Same scoped editor / `authorDomainOperation` | No ordinary consumption or annual contribution |
| Direct/split date/amount/pre-tax destination/acceptance/order; Roth destination only for split | `investment.retirement_rollover` | Same scoped editor / `authorDomainOperation` | Source-specific same-owner/currency/tax-character choices; D1 basis split |
| Distribution date/amount/proceeds bank/acceptance; linked deposit date/amount/destination/replacement cash/bank | `investment.indirect_rollover` | Same source-holding editor / `authorDomainOperation` | Original distribution link retained; deposit not exposed in unrelated holdings |
| Acquisition date/units/basis | `investment.holding` | Holding → Opening investment lots / `authorOpeningInvestmentLot` | No global opening-lot writer; source holding read-only |
| Owner/insured/beneficiary/start/end | `insurance.term_life_policy` | Money → Insurance & coverage / `authorTermLifePolicy` | Saved policy identity and unsupported legacy terms preserved |
| Monthly premium/bank | `insurance.term_life_premium` | Same policy editor / Insurance compiler | Fixed supported monthly cadence; no added Expense or transaction |
| Contract face value/deposit bank | `insurance.term_life_benefit` | Same policy editor / Insurance compiler | Beneficiary read from policy; face value is not current wealth |
| Plan/date/enabled; insured read from selected policy | `life.death_event` | Shared `InsuredDeathEditor` / `authorInsuredDeathScenario` | Plan and contextual Insurance routes instantiate the same editor; Event/Scenario links preserved |
| Conditional posted benefit | `insurance.benefit_payout` | Read-only existing D1 settlement | No death link or disabled event means no benefit; dangling/invalid link remains diagnostic |

`fieldOwnership.ts` binds the existing entity inventory and workflow fields to
the controlled registry. Shared FieldShell rejects a normal control without a
family; browser inventory assertions verify actual rendered family/binding/scope
attributes. Annual-fact editors carry their complete resolved scope. This binding
guard does not itself prove lossless financial-source migration; existing fact
resolution and forecast regressions remain required. New unit evidence is in
`u1InsuranceOwnership.test.ts` and `u1RenderedOwnership.test.ts`; the browser
policy journey covers saved legacy links, no-death policy, shared event route,
save/reload/export, keyboard/touch help and 1440/390 geometry/screenshots.

Pre-continuation GitHub run `38651185425` at `335c8e8` reported a linked-growth
adapter type-narrowing error; it is repaired within the existing UI scope.
No local checks were run. New GitHub results are recorded after publication.

First continuation CI at `d06347a`, run `38654142271`, passed build, unit and
architecture. Typecheck found test-fixture inference errors (not financial
assertion failures); the fixture is now explicitly typed and the event identity
assertion uses canonical object lookup. Browser verification was still running
when the next implementation revision was prepared.

The additional `u1-investment-activity.spec.ts` uses normal import/account/holding
controls to author sale with an opening lot, ordinary/qualified dividends,
self-contained reinvestment, option exercise with calculated strike cash,
conversion, direct/split rollover, and a linked distribution/redeposit. It
asserts durable source/destination/event identities, absence of new Income,
Expense or Transaction records, exact supported compilation, geometry,
screenshots and console cleanliness after save/reload/export. Existing D1
economic tests remain the settlement, basis, annual-limit and replay authority.

Insurance premium presentation now categorizes the original posted bank debit
as insurance spending, links its exact traced policy and bank, and routes repair
to the same Money policy editor. No new debit or Expense is authored. The
monthly replay regression asserts one traced 50 USD premium from checking;
conditional benefits remain separate receipts, never payroll income.

At `c25581b`, run `38654606663`, typecheck, build, architecture and unit passed.
Browser verification remained in progress during the source-preservation
follow-up. That follow-up preserves activity names, event/effect/primitive IDs,
disabled status and plan lineage, checks changed selector compatibility before
save, and uses Activity type / Save activity wording. Registry bindings now
distinguish opening quantity/price from derived valuation, run currency from
bank currency, and annual IRA coverage from employer-plan terms. Annual dialogs
take their family directly from the existing fact resolver's owner contract.
No external audit, production deployment or owner acceptance is inferred.

| Previously reported failure | Current implementation disposition | Remaining acceptance boundary |
| --- | --- | --- |
| Paycheck visibility/categories | Prior default replay-backed income-vs-uses chart preserved | Posted withholding/net pay remains incomplete pending #101; no income-origin claim; owner UAT pending |
| Historical-scope conflict | Prior scoped resolver, source repairs and known-history behavior preserved | Latest-head regression plus independent semantic review |
| Future nominal checkbox | Prior year-qualified fact schedule preserved; no new carry-forward | Unknown legal/tax/coverage facts stay incomplete |
| Duplicate field ownership | Scoped activity and Money insurance replace global writers; registry binding guard added | Full browser evidence, independent audit and uncoached owner acceptance |

PR #98 stays draft; Issue #94 and D1 remain open. CI does not deploy this PR or
establish product-owner acceptance.

# October 11 ownership continuation — pre-edit source inventory

The operator merged main at `c3d01f8`; PR #112's ownership register is present.
This continuation preserves the earlier U1 foundation. This table records the
specific audited sources before edits; it does not attest full migration.

| Rendered field / output | Semantic identity | Sole intended editor / mirrors | Current authority and boundary |
| --- | --- | --- | --- |
| Birthdate / contribution age | `person.birthdate` / `person.age_year_end`, person + year | Household & People / personal, payroll, historical eligibility | Person birthdate; policy ages are compatibility snapshots and may conflict |
| Historical and future annual eligibility | Registry income/tax/health/employer families, person + year + sponsor where material | Registry's natural owner / contribution policy snapshots | Existing D1 policy facts; whole-policy historical equality wrongly includes forecast metadata |
| Historical employer group | `income.employer`, person + plan key + year | Income / history and payroll | Different sponsors are distinct; current YTD entry identifies only holding + character and cannot disambiguate two sponsors on one holding |
| Prior YTD totals and confirmation | `investment.past_usage`, holding + character + year + boundary | Investments & retirement / capacity and forecast | Opening usage adapter; must preserve actual money, ordinary/catch-up split and reconfirmation |
| Future unchanged-facts checkbox | `investment.contribution_projection`, person + year + legal scope | Derived/read-only boundary / saved compatibility assumption | `simulation/contributionProjection.ts` supports nominal carry-forward only; no year-indexed source-qualified fact input |
| Paycheck month and bar | `money.paycheck_view`, household + committed calendar period | Money Cash Flow / Debt and Spending cash evidence | Immutable replay; employee deductions known, withholding and paycheck-origin attribution absent |

The annual-fact projection and reconciled paycheck allocation remain potential
out-of-scope semantic blockers. No gross salary → MAGI, wage → qualified pay,
bank balance → leftover, or savings → current paycheck inference is authorized.
The existing 50-family controlled registry remains read-only. An exhaustive
rendered-field migration and zero duplicate writable identities are not yet proven.

