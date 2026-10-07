# D1-C deterministic evidence and UAT handoff

Issue #80; base `7bf4d9c`, including D1-A #83 (`8473595`) and D1-B #86
(`37fcc73`). Schema 1.0.4, executable semantics 0.1.15-draft, portable format
0.2.0-draft remain unchanged. This map reuses merged expected-effect tests;
it is not a claim of verification before GitHub CI passes on the PR head.

## PFA-DET-013 evidence map

Each listed test states opening facts and expected effects. Cases are not
inferred from an aggregate snapshot. File names below are relative to `test/`.

| Case | Expected effect | Existing evidence |
| --- | --- | --- |
| 1 Traditional 401(k) | Payroll cash reduced, position/usage increased; federal deduction distinct from gross recognition | `d1PayrollContributions.test.ts` balances gross salary/four characters; `d1ContributionTax.test.ts` character matrix |
| 2 Roth 401(k) | Payroll-funded owned value, no federal deduction | Same payroll and tax character matrices |
| 3 After-tax 401(k) | Payroll-funded value/basis, additions usage, no second tax on basis conversion | `d1PayrollContributions.test.ts` committed after-tax conversion and character matrix; `d1ContributionTax.test.ts` |
| 4 Employer match/non-elective | Benefit increases value/income without reducing cash pay; shared additions cap | `d1PayrollContributions.test.ts` match, fixed benefit, percentage, annual additions; `d1ContributionExecution.test.ts` contingent ownership |
| 5 Employee payroll HSA | Cash and payroll-tax base decrease; individual/family usage shared correctly | `d1PayrollContributions.test.ts`; `d1ContributionTax.test.ts` employee HSA |
| 6 Employer HSA | Value/usage increase, cash pay unchanged | Same employer HSA character matrices |
| 7 Annual/catch-up limits | Effective 2026 capacities; combined usage; Roth catch-up rules; no invented missing-year law | `d1ContributionLimits.test.ts`, `d1PayrollContributions.test.ts`, `d1OpeningFacts.test.ts` |
| 8 In-plan conversion | Source/destination value transfer; only pre-tax amount taxable; contribution usage unchanged | `d1DomainMechanics.test.ts` 500 conversion with 100 basis; `d1PayrollContributions.test.ts` after-tax conversion; `d1DomainAuthoring.test.ts` same-plan gate |
| 9 Direct pre-tax rollover | Nonrecognition, conserved value/character/basis | `d1DomainMechanics.test.ts` direct rollover; `d1DomainAuthoring.test.ts` eligible Traditional destinations |
| 10 Direct Roth rollover | Nonrecognition and Roth destination preserved | `d1DomainAuthoring.test.ts` eligible Roth path with `d1DomainMechanics.test.ts` transfer economics |
| 11 Mixed rollover | 500 splits into 400 pre-tax + 100 Roth basis; no income or net-worth change | `d1DomainMechanics.test.ts` mixed rollover; `d1DomainAuthoring.test.ts` explicit basis split |
| 12 Indirect 60-day rollover | Gross 1000/withholding 200 distinct from explicit replacement 200; unreplaced amount remains taxable; late redeposit rejected | `d1DomainMechanics.test.ts` full/reduced/late redeposit; `d1DomainAuthoring.test.ts` eligibility/basis gates |
| 13 Traditional IRA | Checking/savings-funded principal, shared IRA capacity, separate eligible deduction | `d1ContributionExecution.test.ts`, `d1ContributionLimits.test.ts`, `d1ContributionTax.test.ts` accrued-tax reversal |
| 14 Roth IRA | Checking/savings principal, no deduction; MAGI/shared-capacity enforcement | `d1ContributionExecution.test.ts`, `d1ContributionLimits.test.ts` |
| 15 Taxable purchase/sale | Bank-funded purchase; authoritative acquired lots consumed; proceeds in wrapper | `d1PersonalPurchases.test.ts`; `d1DomainAuthoring.test.ts` sole ordinary purchase route and shared-kernel sale; `d1DomainMechanics.test.ts` sale |
| 16 Mortgage amortization | Required payment split into interest/principal and declining debt | `d1MortgageLifecycle.test.ts` ordinary VS4; `liabilityPrimitives.test.ts`, `liabilityCompiler.test.ts` |
| 17 Extra principal | Required payment first; principal-only reduction without expense | `d1MortgageLifecycle.test.ts` payoff; `liabilityFinalSemanticRegressions.test.ts` |
| 18 Refinance | Replace post-payment principal, old balance zero; no duplicate loan value; monthly floor | `d1MortgageLifecycle.test.ts` replacement, summary/detail, unfunded and off-cycle gates |
| 19 Bank interest | Exact monthly APY 100 credited, 100 taxable interest, no invented funding | `d1DomainMechanics.test.ts` APY; `householdExecution.test.ts` balance-sensitive interest contention |
| 20 Treasury | Bill 980 principal + 20 interest; note/bond coupon 50; principal not income; state/local interest exemption fact | `d1DomainMechanics.test.ts` maturity/coupon matrix; `d1DomainAuthoring.test.ts` bank acquisition/coupons |
| 21 CD | Coupon/credit 50 plus returned principal 1000, no second income; exact supported term | Same maturity matrix and `d1DomainAuthoring.test.ts` anniversary/term gates |
| 22 Crypto | Bank purchase 200; sale 300; wallet-local basis and 100 short gain | `d1DomainMechanics.test.ts` spot crypto; `d1DomainAuthoring.test.ts` ordinary paths |
| 23 Term life | Premium 50 expense, single excluded 100000 benefit; no second settlement on replay; honest state exclusion gap | `d1DomainMechanics.test.ts`; `d1DomainAuthoring.test.ts` beneficiary account/jurisdiction |
| 24 Bounded option | Long call premium basis, sale/expiration gain/loss; exercise moves premium into stock basis | `d1DomainMechanics.test.ts` long-call cases; `d1DomainAuthoring.test.ts` unsupported products |
| 25 Gain holding period | Sale basis 300/proceeds 750 gives 450 tax gain; exactly one year short, longer long | `d1DomainMechanics.test.ts` holding-period sale matrix/calendar cases |
| 26 Interest/dividend character | One 100 ordinary/qualified/interest fact; Treasury exemption remains separate | `d1DomainMechanics.test.ts` distribution matrix; `t1aTaxCore.test.ts`, `t1aTaxIntegration.test.ts` shared T1A recognition |
| 27 Reinvestment | Income 100 recognized once; wrapper cash 0; one additional unit/basis 100 | `d1DomainMechanics.test.ts` ordinary/qualified reinvestment |
| 28 Source of funds | Payroll only for workplace/HSA; personal bank only; wrapper sources rejected without mutation | `d1PersonalPurchases.test.ts`, `d1PayrollContributions.test.ts`, `d1DomainMechanics.test.ts`, `d1DomainAuthoring.test.ts` |

## Added integration proof

`fixtures/d1IntegratedHousehold.ts` extends the Golden builder with a one-month
2026 household. Actual durable payroll, ordinary purchase and domain-operation
authors feed the existing reconciled compiler/kernel. No alternate calculator
or tax accumulator is introduced. Zero linked rates isolate exact arithmetic.

`d1IntegratedCloseout.test.ts` states the bank and wrapper balances, each owned
position, five contribution entries, home, mortgage, federal liability/payment,
statement income/expense/gains and net worth. It checks the complete economic
state and shared period summaries across fast/detail, model save/export/import
and fresh rerun, explicit portable replay, irrelevant collection reversal,
policy identity, and atomic failed-period rollback.

Beginning: cash 35000, positions 150000, home 350000, mortgage 225669.71,
net worth 309330.29. Ending: checking 19594.71, savings 115500, wrapper cash
1400, owned positions 151400, home 350000, mortgage 225331.72, supported federal
payable 180.85 after explicit estimated payment 500, net worth 412382.14.
Income 109370 + gains 200 - expenses 6518.15 reconciles the change 103051.85.

NY 2026 final law and term-life state exclusion remain catalog limitations,
not zero state tax. Current position and statement income remain complete;
tax-affected forecast amounts are marked incomplete. Federal base-deduction-only
eligibility is explicit. FICA is 680.85 on 8900 wages after payroll HSA; the
short horizon remains below the 16100 standard deduction. Final settlement is
authored for December 31, outside this bounded January proof. No rule catalog
is expanded to conceal unsupported law.

Isolated existing cases retain options, conversion/rollover, refinance, CD,
bank interest and annual edges instead of turning this into a mega-household.

## Integration repairs exposed by the combined proof

- Normal-created holdings resolve ownership through their Account, as the
  canonical Investment contract requires. Payroll and household compilation
  no longer require a non-schema Investment owner extension. Account ownership
  remains authoritative even when legacy owner data is present; matching legacy
  owners preserve economics, conflicting valid owners fail with
  `INVESTMENT_LEGACY_OWNER_CONFLICT`, and malformed/unresolved owners retain
  explicit reference diagnostics. The integrated regressions cover a linked
  Asset whose conflicting legacy owner is a valid outside Person.
- Portable replay explicitly loads all four built-in participant codecs at its
  composition boundary. Fresh-module regressions reset the Vitest module cache
  after JSON serialization and import replay before any compiler. The integrated
  domain/workplace/tax case and the two-month mortgage refinance case compare
  full state, primitive state, period economics, metadata and aligned window
  replay with their original execution.
- Payroll allocations and domain participant identity/transport inputs are
  canonicalized independently of model collection order. Authored priorities,
  operation dependencies and lot-selection order retain their economic meaning.
- Summary explanation aggregation includes domain extension evidence, using
  the existing compact evidence sink rather than a second financial calculator.
  Detail compaction retains posted payroll rule provenance, and the shared
  investment adapter retains applied contribution-cap rule provenance. Explicit
  replay compares the same explanations across both tiers.
- Off-cycle refinance guidance is visible in the primary forecast explanation,
  including the scheduled-payment-date boundary and normal authoring location.

Observed opening valuation and filing status are explicit synthetic fixture
facts, as in the Golden builder; generic editor patching excludes derived
fields. Employment service facts cover the whole January interval. Employer
priorities follow both employee allocations under the existing payroll contract.

## PFA-DET-014 and focused product-owner UAT

The existing `e2e/personal-mvp.spec.ts` covers cash/investment/property grouping,
linked baseline return, purchase and payroll/IRA authoring, capacity/prior YTD,
baseline retirement and What-If, and supported diagnostic remediation.
The D1-C browser case imports this combined household, authors a sale through
normal controls, saves/exports/reloads, proves session execution data is not
restored, explicitly reconfigures/runs, and diagnoses off-cycle refinancing.
It attaches the synthetic exported model after the additional authored sale to
the Playwright test output. The stable starting household is checked in at
`test/fixtures/d1-integrated-uat-model.json`; select this file directly in the
app's Import flow. `d1IntegratedCloseout.test.ts` asserts exact canonical export
equality with `createD1IntegratedHousehold`, import round-trip equality and
recomputed economic equality. The TypeScript builder remains the source of
truth. The JSON contains synthetic facts only and no execution runtime.

After CI and ChatGPT semantic audit, product-owner UAT should use this synthetic
household and the existing Golden example. Open Settings → Import / Export,
choose `test/fixtures/d1-integrated-uat-model.json`, and click Import into
session. In Model Settings set simulation start/as-of/data cutoff to
2026-01-01 and simulation end to 2026-02-01. Use the prominent Complete forecast
setup action, or Plan → Current Plan → Forecast setup. Select Everyday checking as cash-flow account and
Taylor Example as both investment and debt execution owner. For Example
mortgage set payment anchor 2022-02-01, total payment count 360, funding account
Everyday checking and settlement priority 1. Click Apply setup & run forecast.
Saved canonical retirement relationships are used automatically; no separate
retirement Apply action is required. Save/load preserves the model; reapply this
session configuration after load. Explicit tax payment/settlement and contention
policies in the unit compiler request are execution evidence, not saved model
facts; the browser walkthrough does not promise the unit tax balances.
Check grouping, return edits, payroll
and personal contributions/capacity, retirement What-If, one supported
rollover/conversion, mortgage extra principal/refinance, bank interest and
Treasury/CD maturity, taxable sale/reinvestment/crypto/long call, and term life.
Unsupported variants must show understandable boundaries. The scheduled death
is a synthetic counterfactual, not a prediction. UAT is not self-accepted here.

Overall D1 remains gated on green CI, ChatGPT semantic audit, accepted owner UAT
and merge. R5 household stochastic work remains gated until all four occur.

## Product-owner UAT round 1 repair evidence

`d1UatPresentation.test.ts` covers semantic diagnostic grouping, affected-output
union, exact percentage conversion, known example tax facts and account cash /
holdings presentation. `r2InteractiveExecution.test.ts` adds replacement resets
for both channels, including late worker responses and cache clearing even when
the imported model has the same identity/fingerprint.

The focused “D1 UAT example, import, guided setup, edits and readable account/rate
controls” browser case starts on the landing page, uses the synthetic example,
imports the checked-in D1 model in that same session, checks all required setup
items and empty prior results/diagnostics, completes one final apply/run action,
edits the baseline projected return with normal controls, checks grouped diagnostic roots and no
console/page errors, and exercises percentages/help at 1440 and 390 pixels.
The existing bounded D1-C author/save/reload/run/refinance case is preserved.
CI owns execution of this evidence; these additions are not a local pass claim.

The normal example uses `createGoldenHouseholdExampleDraft`, which supplies
synthetic single filing status, dated New York residence/work facts and explicit
federal base-deduction-only eligibility. The original audited Golden builder and
the D1 integrated builder/export remain unchanged, so no old arithmetic or
unknown-fact expectation is weakened. New York law and local applicability,
unsupported future law years, and session tax payment configuration remain
honestly incomplete. No schema, model-format or financial-semantics version
changes were made.

Broader authoring decision for the PM (not required to import/run these valid
synthetic examples):

DECISION_NEEDED: Should normal users author filing status and dated residence/work tax facts through a dedicated tax-facts flow?
PRODUCT_IMPACT: The generic editor currently excludes derived filing status and structured dated facts; users with missing or conflicting tax facts must import corrected data.
OPTIONS: Retain import-only repair, or authorize a dedicated observed-tax-facts authoring contract and UI.
RECOMMENDATION: Authorize the dedicated flow separately; keep Issue #80’s examples valid and explain scoped incompleteness.
TECHNICAL_REASON: The canonical filing-status field is derived; bypassing generic editor protections here would change the authoring contract.

A fresh exact-head ChatGPT audit and product-owner UAT remain required before
merge. This continuation does not self-accept owner UAT.

## Round 2 repair and unresolved product decisions

The existing 28-case evidence map and audited financial expectations are
preserved. Additional focused coverage in `d1UatPresentation.test.ts` and
`d1IntegratedCloseout.test.ts` distinguishes the normal Golden example's
ten-year execution from the integrated household's recurring 2026-only
contribution plans. The latter must stop at the first 2027 period with
`RULE_INPUT_INVALID: Contribution facts do not cover this UTC year`, preserving
the committed 2026 boundary. CI owns confirmation of these assertions.

The browser UAT path now opens Example salary in both models, inspects its
structured dated allocations, checks readable holding summaries at 1440/390px,
shows the immutable Current Plan date boundary, requests a ten-year run,
and updates IRA/HSA plans from account-level contribution actions. Exported
plans must retain one authoritative route per edited holding. Mortgage guidance
derives maturity using the compiler's actual monthly schedule, distinguishes
origination from first payment, offers a confirmed correction for mismatch,
and labels projected payoff separately. Tax summaries collapse equal remedies;
expanded roots include category and jurisdiction as well as counts and outputs.
No local verification was run.

Issue #80 explicitly requires escalation rather than extrapolation at these
remaining boundaries:

DECISION_NEEDED: How should users extend Current Plan dates when canonical Scenario start_date and end_date are creation-time immutable?
PRODUCT_IMPACT: The dates can be shown and simulation windows constrained, but the existing canonical editor cannot save an extended horizon. Appearing to save would silently ignore the change.
OPTIONS: Authorize creation/rebinding of a replacement plan with a new identity; or amend the canonical mutability contract and authorize its migration/implementation separately.
RECOMMENDATION: Resolve the plan authoring contract explicitly before implementing extension; retain read-only dates and a direct path to import a model created with a wider horizon for this partial repair.
TECHNICAL_REASON: docs/personal_finance_canonical_schema_v1.0.json Scenario start_date/end_date both have mutable:false; PFA-UX-014 requires respecting creation-only fields. Issue #80 prohibits schema/spec/product-semantic changes.

DECISION_NEEDED: Forward-law strategy for long-range deterministic planning.
PRODUCT_IMPACT: Decide whether long-range views are horizon-capped, limited to tax-independent outputs, or use explicit projected law.
OPTIONS: (1) cap to verified-law horizon; (2) continue only semantically tax-independent outputs and mark tax-dependent outputs unavailable; (3) introduce an explicit forward-law projection policy with modeled-versus-verified provenance.
RECOMMENDATION: Prefer explicit modeled-versus-verified forward-law policy; keep D1 honest and schedule that policy as the next tax/forecast dependency if it cannot safely be authorized here.
TECHNICAL_REASON: Federal 2026 verified coverage ends 2027-01-01; D1 contribution law and annual eligibility facts are explicitly 2026-only. Reusing them for later contributions violates authority.

DECISION_NEEDED: Define the normal household's tax payment/refund and final settlement authoring contract.
PRODUCT_IMPACT: After-tax cash cannot be called complete without both explicit funding and dated settlement instructions; an account alone cannot resolve this limitation.
OPTIONS: Retain explicitly scoped incomplete after-tax outputs; or authorize a guided flow recording jurisdiction, tax year, payment/refund account, payment instructions and final settlement dates.
RECOMMENDATION: Authorize explicit user-authored instructions using the existing tax participant; never infer filing dates or automatic payment amounts.
TECHNICAL_REASON: `src/simulation/tax/participant.ts` diagnoses both payment_funding and settlement_timing and expressly requires an explicit final settlement/refund date. The session-to-compiler adapter does not expose these inputs yet. Importing durable model data does not restore them.

Round 2 remains blocked pending these product decisions, CI confirmation,
an exact-head semantic audit and fresh product-owner UAT. This evidence does
not assert merge readiness or self-accept UAT.
