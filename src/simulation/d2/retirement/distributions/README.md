# A4-1 annual RMD obligation proposals

`evaluateRmdObligations` implements the isolated annual obligation and actual
satisfaction boundary of PFA-DET §5.4/S1–S8 and PFA-TAX-015. No runtime imports
this module. All results are replacement proposals under `d2-shared/v1`, with
`committed=false` and `postable=false`. No money, securities, basis, tax liability,
withholding, bank deposit or shared state is created or changed.

The caller supplies verified dated official law/plan snapshots and observed
identity, valuation, beneficiary and election evidence. Sources carry identity,
publication date, as-of, effective half-open period, version and verification
status. No IRS tables, cohort ages, deadlines or forward-law defaults ship here.
Synthetic test sources establish isolated arithmetic only.

The restricted admitted rule is an owner lifetime prior-December-31 balance
divided by one sourced positive exact-decimal factor at age attained at year end.
Spouse factor rows must match the supplied spouse identity and birth date.
The statutory/plan owner must explicitly authorize that model and its rounding.
Each account rounds once at currency minor-unit scale; a legal IRA aggregation
group sums those rounded amounts, as expressly authorized by the rule's
`aggregationCalculation`. Other table methods or rounding conventions require a
later capability. Even an explicitly zero balance requires observed evidence.
Workplace accounts additionally require separately sourced account plan terms.

One request is one person, tax year and account or exhaustive authorized IRA
aggregation scope. Overlapping account/year requests are rejected, including
different snapshot IDs or conflicting owners. Rule snapshot IDs and aggregation
scope IDs must be immutable under #149. Separate accounts cannot share withdrawal
satisfaction unless admitted in that legal IRA group. Workplace aggregation is
unsupported. Owner exceptions require sourced lifetime Roth IRA exemption or
annual still-working and ownership eligibility under admitted workplace terms.
Unknown eligibility remains incomplete. Inherited accounts, QCDs, conversions,
rollovers and other specialized methods are explicitly gated.

The sourced cohort/start-age rule determines the supported first obligation year.
First-year deferral requires an explicit election and permissible sourced next-year
deadline. Retirement-triggered first years with other age/deadline conventions
are outside this model. Supply both annual requests to represent two obligations
due in the following calendar year. Their identities include person, obligation
year, account/group and rule snapshot; they never net together. All date windows
are half-open; an actual payment on the inclusive due date is on time.

Satisfaction requires a verified authorized posted/funded actual distribution,
matching payer/owner and source account, with stable transaction and allocation
IDs, explicit `satisfiesRmdYear` per allocation, and an attested complete usage
register. A transaction may allocate to two obligation years explicitly.
Historical allocations and new allocations consume the same gross ceiling.
History for an obligation in this call contributes to its reconstructed satisfied
amount; history outside this call only reserves gross. Re-evaluation replaces
the result rather than incrementing usage. #149 owns register exhaustiveness,
immutable transaction provenance and admission of new allocations into history.

No allocation is automatically chosen or capped. A conflicting, ineligible or
incomplete supplied satisfaction register is rejected atomically, leaving all
obligations in that call unsatisfied and diagnostic. Callers may isolate unrelated
registers in separate evaluations. This conservative behavior prevents implicit
allocation priorities; it does not undo real posted transactions. Late payments
reduce current remaining amounts while `satisfiedLate` and `deadlineShortfall`
retain the missed-deadline evidence. This module calculates no penalties.

S3/S5 obligations carry exact required, satisfied and remaining amounts,
components, deadlines, allocation lineage and source references. S3/S6 intents
describe only a needed gross withdrawal with unresolved tax character. S7
diagnostics distinguish invalid, unsupported, missing balance, law, beneficiary,
deadline, authorization and funding gaps. Successful amount calculation or full
satisfaction never establishes tax, funding or bank-settlement completeness.

The tests cover exact cent/large-value rounding, zero and invalid factors/balances,
sources and temporal boundaries, cohort/election/deferred two-obligation years,
partial/full/unfunded/late actuals, historical usage, duplicate and conflicting
allocations, multiple owners/accounts, sourced IRA groups, workplace separation,
still-working/ownership and Roth exceptions, unsupported beneficiary methods,
leap dates, replay, ordering and input immutability. Both retirement prep fixtures
are read unchanged: their authored 50,000 cents, opening 100,000 cents and missing
withholding remain `decision_required` with `integratedRuntimeEvidence=false`.

No local tests, builds, validators, package installs or CI polling are performed
in the implementation turn. GitHub CI and independent latest-head semantic audit
remain required. #146 stays open for the remaining retirement work; #149 owns
shared state, physical withdrawal/funding/settlement and integration, #101 owns
tax/withholding, and #120 owns U1. This phase does not close R5.
