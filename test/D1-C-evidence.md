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
  no longer require a non-schema Investment owner extension; explicit legacy
  owner facts retain their validation.
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
It attaches the synthetic exported UAT model to the Playwright test output.
Successful CI does not currently publish E2E attachments; the same model can
be exported during the product-owner walkthrough. No private data is needed.

After CI and ChatGPT semantic audit, product-owner UAT should use this synthetic
household and the existing Golden example. Import/save/reload and configure
January 2026 through February 1, Taylor Example as execution owner, Everyday
checking as cash/debt source, mortgage anchor 2022-02-01/360 payments/priority 1,
and the Planned retirement binding. Check grouping, return edits, payroll
and personal contributions/capacity, retirement What-If, one supported
rollover/conversion, mortgage extra principal/refinance, bank interest and
Treasury/CD maturity, taxable sale/reinvestment/crypto/long call, and term life.
Unsupported variants must show understandable boundaries. The scheduled death
is a synthetic counterfactual, not a prediction. UAT is not self-accepted here.

Overall D1 remains gated on green CI, ChatGPT semantic audit, accepted owner UAT
and merge. R5 household stochastic work remains gated until all four occur.
