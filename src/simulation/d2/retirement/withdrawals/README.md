# A4-2 authorized ordinary cash distribution candidates

`evaluateWithdrawals` implements the isolated authorization boundary of
PFA-DET §5.4/S1–S8 and PFA-TAX-015. It accepts exact gross USD Money and emits
conditional `d2-shared/v1` economic intents. No runtime adapter imports this
module. All outputs are uncommitted and non-postable. No balances, claims,
transactions, tax liabilities, basis, or RMD allocations are written.

Admission requires owner/person/household and account/bucket identities,
effective verified eligibility, separately sourced workplace plan permission,
observed settled unencumbered account CASH at the payment date after complete
external reservations, owned checking/savings routing, exact distribution
authorization, complete historical identity usage, and complete applicable
jurisdictional withholding instructions. Every jurisdiction supplies an explicit
amount, including zero, a qualified tax-payment route and taxpayer beneficiary,
and independently sourced remittance authorization. No rate or withholding law
is calculated. A complete instruction snapshot attests to the exhaustive
jurisdiction list; the module does not infer a jurisdiction from residence.

Sources include immutable snapshot IDs, scope, publication, version, knowledge
date, verification/projection status, and effective half-open dates. The #149
adapter must authenticate this evidence and preserve immutable snapshot payloads:
an ID cannot be reused for revised amount, beneficiary, eligibility, jurisdiction,
or routing terms. Authorization sources attest the exact terms in their containing
snapshot, not just the presence of an arbitrary authorization string. Usage
evidence is household-scoped (`personId="*"`, `resourceId=householdId`) and must
include historical/pending operations, underlying withdrawal IDs and all consumed
distribution/remittance authorization IDs. No identity or evidence is discovered
by this private module.

The supported family is owner pre-tax Traditional/SEP/SIMPLE IRA and independently
eligible workplace plan cash. Roth, after-tax and mixed buckets, inherited
accounts, in-kind payments, conversions, rollovers, QCDs and unresolved statutory
or penalty rules are typed incomplete. Invested value is never liquidity and
this phase does not issue a sale. Missing rules are distinct from explicitly
projected future law and unsupported variants. Unknown withholding never becomes
a full gross bank payout. S7 diagnostics identify the affected operation, payment
day, missing fact, rule snapshot and source trace.

Every successful candidate has ordered economic directions: one gross source
cash decrease, net owned bank cash increase, then jurisdiction-sorted withheld
tax advance-payment credits. These are not ledger debit/credit conventions.
Gross equals net plus every withholding amount to exact cents; zero instructions
are retained as evidence. A tax credit is a pending advance payment, not another
expense or retirement withdrawal. Incremental economic income/expense is zero;
taxable distribution character and basis remain unresolved for #101.

Requests sharing a source use a single account cash snapshot and aggregate gross
capacity. No partial authorization or iteration-order priority is invented. Any
invalid, duplicate, unsupported, incomplete or over-capacity request rejects the
whole batch, leaving zero candidates. Sorting is presentation only. Snapshot
capacity is not a reservation: #149 must atomically revalidate usage, authorization,
payment-date funding, routing and all batch capacity against concurrent operations
before posting. Separate successful evaluations cannot be executed independently
to bypass that check. Output objects/arrays are frozen and caller inputs remain
unchanged; evaluation is replacement/replay, never incremental usage consumption.

`claimId` preserves the stable underlying withdrawal identity for later #149
admission; it creates no second distribution claim. RMD target IDs are nonbinding
metadata only. The merged A4-1 obligation/satisfaction module requires independently
verified ACTUAL `posted_funded` transactions and explicit unique allocation IDs.
These candidates cannot be used as those receipts. Deferred first-year and next
annual obligations keep distinct IDs even when referenced by split payments.

Synthetic tests cover 50,000 gross cents = 43,000 bank + 5,000 federal + 2,000
state advance-payment credits; verified zero; missing instructions; liquidity and
batch contention; duplicate historical/proposed identities; owner and routing
mismatches; expired/future/unknown sources; unsupported variants; large exact
money; immutable replay and order; and unchanged RMD satisfaction. Original
`retirement_ordinary` and `retirement_rmd` prep fixtures are read unchanged with
50,000 requested/100,000 opening cents, absent withholding and `decision_required`.
They remain conditional, never integrated runtime evidence.

No local verification or package installation is performed. GitHub CI and
independent semantic review remain required. This phase leaves #146 open; #149
owns actual postings, shared funding, contention reservations, rollback and the
final integrated gate; #101 owns law, tax character, withholding and liability;
#120 owns U1. No R5 readiness claim is made.
