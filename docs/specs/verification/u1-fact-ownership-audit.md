# U1 financial fact ownership — independent architecture and current-code gap audit

**Audit date:** 2026-10-11  
**Reviewed implementation:** PR #98, `38b033f04cf3d4721a06d5f0b64f5fbb19b2f6bb` (draft, not merged)  
**Architecture revision under audit:** `docs/specs/verification/u1-fact-ownership.json`, PFA-UX-021–023, roadmap section 8A.  
**Verdict:** **Architectural fact ownership design is internally consistent; actual UI/source-of-truth implementation is NOT accepted.** No repository code implementation is claimed by this documentation PR. A clean registry is necessary but insufficient evidence that the shipped application has no redundant writable fields.

## Audit method and result

1. Read the live PR #98 UI routes and editing surfaces (`ui/PersonalFinanceApp.tsx`, `ui/EntityEditor.tsx`, `ui/authoring/FieldShell.tsx`, `ui/authoring/EligibilitySummary.tsx`, historical/future contribution adapters, `src/application/monthlyMoney.ts`) and controlled UX, D1, and tax specs.
2. Classified **50 U1 normal-user financial fact and output families** as source, decision, assumption, derived, conditional, or external; assigned the natural edit surface, exact semantic scope, currently known canonical authority, cross-surface read-only mirrors, automatic-resolution boundary and first delivery gate.
3. Independently verified **50/50 distinct family IDs, nonempty ownership and semantic scope, 0 missing source references, 0 dependency cycles, 0 self-mirrors, and all three new requirement-index entries present once.** `test/u1FactOwnershipContract.test.ts` permanently asserts these properties.
4. Verified the design against the false-equivalence list below. **Twenty-one families** are derived/conditional; their output must not become independent editable inputs. Other source/decision/assumption families are not necessarily derivable or universally single-valued across different periods.
5. **Not claimed:** a crawler/complete rendered-control scan, production-browser UAT, an engine migration, proof of correct real-world tax law, or a functional audit of all past and future asset/product tiers. Codex must inventory all actually rendered inputs, reconcile gaps to the registry, and demonstrate one editor per scoped fact with browser, integration, import and regression tests before U1/D1 can close.

## Confirmed current PR #98 redundancy / ownership defects and required disposition

| Observed area and technical origin | Current status in PR #98 | Required action and sole normal-user edit location |
| --- | --- | --- |
| `Money → Accounts` and `Net Worth → Cash & bank accounts` both use `EDITORS` with Account type | **Second editable account entry point persists.** | **Money → Accounts** for checking/savings; Net Worth bank summary read-only; other tax-wrapped accounts in Investments & retirement |
| `Plan → Assumptions` exposes Assumption editor, while Salary, Expense and Investment link those growth/return assumptions | **Separate generic edit route exists.** | Linked salary growth under **Money → Income**; expense inflation under **Money → Spending**; holding returns under **Investments & retirement**; Plan assumptions list read-only linked index |
| Plan → Current Plan has mortgage start/duration/payment bank/order while Debt owns contract fields | **Split normal mortgage workflow.** | **Net Worth → Debt** shared mortgage contract, first payment, funding, priority and refinances; Current Plan shows only named status and links, keeps true global simulation settings |
| `ModelSettings` and `PlanHorizonSettings` expose overlapping session/projection dates | **Two normal editing routes for related run/window settings** (plan horizon versus simulation bounds are distinct meanings). | **Plan → Current Plan → Forecast period** groups both while labelling their difference; Settings is read-only model/debug or routes to same editor |
| `PersonalPurchaseAuthoring`, `PayrollContributionAuthoring`, `HistoricalContributionScopeAuthoring` each ask annual age/year/compensation/coverage facts | **Duplicate and materially ambiguous normal inputs remain.** | **Person DOB** in Household & People; scoped salary/employer facts near Income; plan eligibility/plan Roth terms with workplace account; historical contribution amounts with account. Other views derive/read and offer same in-context owner sheet |
| Future contribution facts and historical P03 policy snapshots are compared as whole policies in `openingContributionOptions` | **Real `HISTORICAL_SCOPE_CONFLICT` can be triggered by non-equivalent stored policy snapshots.** | One fact resolver by person/year/sponsor/legal bucket, ignore nonsemantic snapshot differences, lossless dedupe, safe saved-historical usage; only material differences require one named reconciliation dialog |
| Personal IRA eligible wages, Roth MAGI and workplace eligible plan compensation entered as free numbers alongside linked salary | **May duplicate values without tax/plan basis and remain stale when salary grows.** | Derive only when complete legally applicable wage/tax/plan rules exist; otherwise *one* dated attested fact at Income or Household Tax/coverage source with provenance and links, never salary substitution |
| Prior sponsor wages and Roth-plan-availability values copied in payroll and historical scopes | **Plan terms and previous-year employer pay repeat.** | One plan-level fact in workplace retirement account; prior-year employer wages derive from same-employer completed historical pay (or one actual recorded wage fact in Income) |
| Annual `confirmed_nominal_carry_forward` checkbox reused in IRA and workplace authoring | **Future annual wages/MAGI/plan values may remain nominal even as earnings grow.** | Remove blanket checkbox; supported per-year derivations, explicit dated user assumptions only for genuinely non-derived legal facts; honest unsupported future-year status |
| Current Plan contribution editors | **Already relocated to Investments & retirement at PR head.** | Preserve this correct migration; Current Plan read-only summaries and context links; do not redo |
| Account-scoped investments/holdings and instrument-specific controls | **Already implemented in PR #98.** | Preserve; only one account/holding editor, compatible quantity/price/basis/valuation time, no double-entered position valuation |
| Mortgage scheduled payment Debt/Spending | **Shared monthly replay adapter exists, but month data requires manual Review selected month and an eligible household forecast.** | One read-only mortgage payment sourced from loan execution, show naturally on Debt and payment cash use under Spending; never create separate expense record |
| “Your Paycheck” monthly allocation | **Two visual categories only** (employee contributions and “Not yet reconciled”); taxes/other expenses and income-funded transfers are not attributed to paycheck. | Source-qualified read-only multi-category output from immutable postings only; no guessed wage withholding, no claims savings-funded transfers consumed this month's salary; #101 dependency stays explicit |
| Ordinary historical scope errors and forecast diagnostics | **A friendly message mapping exists but actual raw-code rendering remains reported; owner cannot identify the two conflicting fields.** | One shared cause/remedy/field-source resolution contract; original code in technical details only; same in-context repair editor as owner |
| Initial guided setup household numbers | **One-time synthetic/create input**, not an enduring second editor if disabled after creation. | Preserve as initial creation adapter; post-creation corrections route to the owning ordinary editor; never expose both editable creation and ongoing values as peers |
| Workplace/HSA future contribution and historical usage vs actual bank transactions | **Separate facts with different time/financial meaning.** | Retain separate events; YTD uses observed historical amounts, not projected future purchases; show transfers without consumption double-count |

## False duplicates that MUST NOT be collapsed

- **Loan origination principal, opening/current balance, scheduled next payment and actual posted payment** describe distinct dates/claims and need separate provenance; no reconstructing missing history from current value.
- **Income gross salary, employee take-home, plan-eligible compensation, IRA-eligible compensation, Roth/deductible MAGI, payroll withholding and annual tax liability** are not equal by default; only derive when each applicable contract is complete.
- **Different employment sponsors/plans, past observed contributions, current elections, and distinct legal years** are separately scoped; no arbitrary last-write-wins migration.
- **Household bank cash opening balance, future bank balance, financial net worth, monthly paycheck remainder and a purchase funded from savings** are different accounting concepts.
- **Mortgage principal/interest components, IRA/brokerage transfers and employee/employer contributions** may share cash-display context but not consumption classification.
- **Saved scenario dates, selected forecast interval, data cutoff/as-of and source effective dates** are distinct, even when displayed together for context.
- **Property original purchase basis and market value, or holding quantity/quote-derived price and independent recorded value**, differ by valuation time/source; only one applicable valuation method is authorable per valuation.
- **Actual historical insurance/filing facts versus future coverage/status assumptions** differ by year and source; no silent projection from an account balance or marital label.

## Codex verification contract and release gating

- Include a rendered-control inventory (every normal and advanced UI field by business role) linked to one registry `id`, its actual owner component and source adapter, its derived/conditional/technical state, and a list of removed duplicate edit routes.
- Enforce a one-writer contract **by semantic identity** (not just route or label), automatically dedupe identical same-scope material inputs and explain names/values of real conflicting sources in the same drawer. Build both happy-path and contradictory-import scenarios for IRA, 401(k), HSA, prior YTD, salary changes, pay/expense growth, mortgage schedules, tax coverage and alternate account routes.
- If a fully correct resolution needs new canonical dated tax/sponsor facts, a law-year model or new engine semantics beyond Issue #94, report `LOOKUP_REQUIRED` with the precise new source shape and acceptance truth table; never treat unknown as a guessed calculated value. Register missing interface authority under #94 and keep U1/D1 blocked **now** until a narrow authorization is approved.
- Owner UAT must be uncoached: edit salary growth from Income, correct plan eligibility from the account, repair historical YTD from the same panel, change mortgage payment bank from Debt, and navigate across read-only mirrors with no stale contradictory values or page-hopping.

**Audit verdict: architecture consistency verified; current app still has redundant editors/ambiguous sources and owner-reported errors.** Codex implementation and independent post-implementation audit are required. A passing PR containing only this register/test/specs cannot be described as a completed single-source-of-truth UI.

## 2026-10-14 controlled registry extension — existing investment operations and term-life insurance

**Scope of this addendum:** Latest reviewed U1 draft PR #98, commit `7149798c3158eef925ed963210ee19aa3c6148ba`, `ui/forecast/DomainMechanicsPanel.tsx` and `TermLifeEditor`, with authoritative PFA-DET-002/004/005/009/010/011, PFA-INS-001–005/012 and PFA-INV-015/022. The initial 50-family audit above was correct for its time and **not** an exhaustive UI inventory. The controlled registry now includes **62 total families** (12 added), with exact D1 operation-kind mapping and owner-level conditional field binding metadata.

### Approved current-U1 classification

| D1 authoring controls / operations | Registry owner family | Sole natural normal editor | Important semantic boundary |
| --- | --- | --- | --- |
| `purchase` for supported crypto/long call | `investment.purchase` (existing) | Investments & retirement → selected holding | Ordinary planned purchase is not a sale, dividend or cash expense |
| `sale` and optional tax-lot selection | `investment.sale` | Investments & retirement → holding → Activity & transfers | Opening tax lots are `investment.holding`; disposition creates one realized transaction, no manual gain |
| `call_exercise` | `investment.option_exercise` | Same holding activity panel | Contract multiplier/strike/basis come from qualified holding facts, not duplicate event inputs |
| `ordinary_dividend`, `qualified_dividend`, `interest` | `investment.income_distribution` | Same holding activity panel | Qualifying tax character cannot be assumed; no additional editable Income row |
| `reinvest_dividend` | `investment.dividend_reinvestment` | Same holding activity panel | One saved instruction executes *income recognition + linked purchase*; no duplicate dividend or transfer |
| `conversion` | `investment.retirement_conversion` | Investments & retirement → affected retirement plan and source/destination holdings | Same-plan Roth conversion distinct from rollover, distribution and annual contribution |
| `direct_rollover`, `mixed_rollover` | `investment.retirement_rollover` | Investments & retirement → Transfers & rollovers | Source/destination and split-basis tax character explicit; second Roth destination field only when split |
| `indirect_distribution`, `indirect_deposit` | `investment.indirect_rollover` | Investments & retirement → Transfers & rollovers | One linked **two-event** 60-day workflow; withholding and replacement cash separately preserved, not an ordinary contribution |
| `mortgage_extra`, `refinance` | `debt.extra_refinance` (existing) | Net Worth → Debt | Already owned; do not create new competing operation owner |
| Term-life owner, insured, beneficiary, effective coverage | `insurance.term_life_policy` | **Money → Insurance & coverage** → policy | A contract is protection, not an investment asset |
| Term-life monthly premium and account | `insurance.term_life_premium` | **Same policy editor** | Mirrors to Spending/Cash Flow only; never a second editable Expense or twice-posted debit |
| Face amount and benefit deposit account | `insurance.term_life_benefit` | **Same policy editor** | Beneficiary is reused from policy once; contract face amount is not currently paid cash |
| Executed covered death benefit | `insurance.benefit_payout` (derived/conditional) | Read-only in policy | Recognized only on qualifying D1 claim/event, not independently editable |
| Insured death date, scenario, enabled | `life.death_event` | **Plan → Life Events**; open same editor inline from policy | Policy may exist without a forecast death scenario; event is separate but can be configured adjacently |

**Source-code implementation gap at this head:** `DomainMechanicsPanel` currently bundles all investment operations and the nested `TermLifeEditor` under Investments & retirement. It also creates a scheduled death event when a term-life policy is saved. Neither behavior satisfies the separated, intuitive single owner described above: Codex must move/reuse the policy editor under Money Insurance & coverage, make the death event independently optional and owned by Life Events, preserve the legacy `Insurance.death_event_id`/Event/Scenario references, and route the contextual "simulate death" action through the SAME Life Events editor. A new policy must not require an invented date of death; insurance premiums/benefits must retain exact existing D1 semantics.

**Source and conditional editor integrity:** The new registry records `authored_domain_operation_kinds` and `ui_fact_bindings`. The independently added unit guard checks the **14 existing supported** investment/debt operation kinds each have exactly one mapped registry owner, conditional split-rollover and linked indirect deposit fields are scoped, and insurance policy/benefit/event ownership is disjoint. These checks are *architecture contract tests*, not proof that actual live UI was migrated or that user-facing forms have no remaining duplicate data. They do not validate D1 cash/tax execution outcomes by themselves.

**Closeout remains blocked until:** real rendered-field → exact registry family → sole editor mapping is exhaustive; UI sections navigate directly to an affected holding/policy; no duplicate insurance premium or dividend-income writer; no automatic death assumption; exact D1 cash basis/tax/lot/rollover/payout regression parity; browser UAT for a term policy without a death event and the separate covered-death scenario; original U1 owner tests, CI and independent semantic audit. Do not mark U1 accepted from a registry-only PR.

