# A3-1 IRA annual pro-rata proposal boundary

`evaluateIraConversionYear` evaluates one person and tax year. Call it separately
for each person; spouses never share a basis pool. Inputs are readonly and money
uses the existing immutable exact-decimal `Money` value. No global runtime imports
this module. It implements PFA-DET §5.3, PFA-INV-026 and the proposal boundary of
PFA-TAX-015, using the private `d2-shared/v1` vocabulary.

The supported convention must be explicitly supplied by a verified effective
Form-8606 rule source: exact capped ratio of available basis to aggregate
December-31 Traditional/SEP/SIMPLE value plus included annual distributions;
one currency-minor-unit annual rounding; proportional allocation of that annual
recovery using largest remainders, with operation ID breaking equal remainders.
There is no built-in IRS law snapshot or default rounding convention. Synthetic
test sources prove this restricted arithmetic, not actual-return law coverage.
Other ratio precision, dollar rounding, special basis adjustments, and outstanding
rollovers return bounded diagnostics. Legal interpretation stays with PFA-TAX.

The closeout source must attest that the restricted legal model applies and that
the inventory, annual distribution register and qualified basis-addition register
are complete. Inventory includes closed and zero-value eligible accounts; every
eligible account needs an explicit December-31 value. Register ID sets must match
the attestation exactly. A conversion request references one annual distribution
row by both operation and transaction identity; it is never added to the annual
denominator twice. Ordinary distributions and RMDs consume the same recovered
basis pool, but RMDs cannot be conversion requests. Direct rollovers, regular
contributions and workplace mega-backdoor movements cannot be conversion requests.
Basis additions are prequalified observed facts, not contribution authorizations.

All sources identify person, account (or explicit person-wide null), tax year,
as-of date, rule snapshot, verification and observed/projected status. Prior-year
return evidence retains its prior tax year while referencing the current
reconciliation snapshot; the adapter must qualify historical carry-forward under
that rule. Missing prior basis is never zero. Explicit zero prior basis still
requires verified return/no-prior-basis evidence. Observed operation sources
cannot predate their operations. Year-closeout evidence must be known after the
year ends; projections cannot finalize an earlier conversion.

Successful results have annual `yearStatus: FINAL` and **uncommitted, non-postable**
S3/S6 conversion-character and S5 aggregate-basis proposals. FINAL qualifies only
the annual arithmetic under supplied sources. Federal/state tax, funding and
posting remain incomplete/not applicable. Replays return the same replacement
proposal for person/year/snapshot, never an incremental basis debit. Errors return
`incomplete`, source-linked diagnostics and no numeric proposals, including no
invented zero basis. One bounded first-failure diagnostic is returned per call.

#149 owns admission, proof that source inventories are exhaustive, shared S5
state, annual reconciliation replacement/idempotency, physical gross transfers,
atomic ledger/funding and tax integration. #101/PFA-TAX owns real Form-8606 law
qualification and tax liability. This module calculates no wage, capital gain,
expense, regular-contribution usage, withholding, tax payment or refund.

The isolated tests cover the issue's synthetic oracle, aggregate multi-account
rounding, SEP/SIMPLE balances, independent persons, closeout gates, zero and missing
basis, ordinary distributions/RMDs, qualified additions, large money, caps,
determinism, immutability and source/ownership/authorization failures. Prep fixtures
are read unchanged and retain `decision_required`/no integrated runtime evidence.
The IRA fixture's 50,000-cent conditional gross transfer supplies no final tax
basis. No tests, builds, validators or CI polling run in the Codex implementation
turn; GitHub CI and an independent semantic audit remain required.

Retained under #146: complete A1 law/tax execution, A2 official limit and funded
plan/payroll execution, funded nondeductible contributions, backdoor/mega paths,
Roth ordering/vintages, ordinary distributions/RMD execution and tax completeness.
Shared integration and joint truth table/UAT remain #149/#101/#120. This phase
does not close #146 or claim full A3 acceptance.
