# A3-2 source-qualified Roth IRA ordering

`evaluateRothOrder` is a pure, domain-local `d2-shared/v1` proposal helper for
PFA-DET §5.3/§5.4, PFA-INV-026 and PFA-TAX-015. Nothing imports it into household
execution. Every output is `committed:false`, `postable:false`,
`physicalTransfer:"not_applied"`, `taxSettlement:"incomplete"`. Conditional means
the supplied facts permit ordering arithmetic; it never means funded, posted,
tax paid, RMD satisfied, or a supported integrated household capability.

## Supported source contract

One call covers one owner, one tax year and an explicitly bounded unchanged
inventory window. All of that person's Roth IRAs, including closed/zero accounts
needed to prove historical consumption, must appear in an exhaustive source
inventory. Spouses require separate calls. Accounts must be owned Roth IRAs with
the Roth bucket and no inherited beneficiary. Cash is independently attested
unencumbered cash after external reservations; market value is not available cash.
No plan rollover permission, statutory capacity, sale, or borrowing is inferred.

Inputs use existing immutable exact `Money` (USD cents) and `WithdrawalSource`
provenance. Sources require person/household/resource, publication, verification,
effective half-open dates, knowledge dates, jurisdiction and one consistent rule
snapshot. Sources cannot become available after the event or knowledge cutoff.
Retrospective history evidence may postdate its historical event but must be
available by the opening snapshot. Pool, cash and exhaustive proof sources must
be as of that exact snapshot, preventing stale opening balances. Rules and all
inventory evidence must remain applicable through each requested event.

Regular contribution basis is an explicitly verified actual owner aggregate,
separate from conversion/rollover principal and earnings. Each pool supplies its
original total and independently attested remaining amount. For earnings,
original means the remaining earnings plus previously distributed earnings,
not a second capital account or an assumed lifetime return. Historical actual
distributions include exact gross and verified component consumption. Their
operation, withdrawal and authorization registers must match the exhaustive
proof exactly; subtracting all history must reconcile every remaining pool.
Unknown prior usage is incomplete, including when the desired amount is zero.
The adapter must authenticate historical legal allocations; this module checks
their identities, dates, arithmetic and inventory reconciliation, rather than
recreating historical law from the current rule snapshot.

Vintages preserve originating account, date, tax year, transaction, conversion
versus rollover character, taxable/nontaxable component, and sourced recapture
clock. A transaction can have one taxable and one nontaxable row with consistent
origin and clock facts. Aliasing the same transaction/component is rejected.
Explicit source proofs of exhaustive inventories remain essential: changing an
underlying transaction's identity cannot be detected from anonymous amounts.

## Ordering and clocks

Only an explicitly verified `roth_ira_ordering` rule admitting
`contributions_then_year_fifo_taxable_first_then_earnings` and independent five
tax-year clocks enables calculation. There is no bundled IRS snapshot. The
source supplies an exhaustive vintage order; it must be increasing tax year,
taxable before nontaxable within a year. Same-year tie/rollover treatment must
also be source-admitted, so array order or lexical ID cannot set economic
precedence. Regular contribution basis is consumed first, followed by vintages,
then earnings. Each allocation is the exact cent minimum of remaining gross and
pool balance. No ratios or rounding are needed; sub-cent inputs are rejected.

Qualified-distribution and individual vintage clocks have independently supplied
January-1 starts and five-year end boundaries. The helper validates these dates
without inventing a first Roth year. Conversion clocks start in the supplied
conversion tax year; rollover carryover clocks require explicit legal character
and sourced dates. The qualified clock also requires an explicit non-clock
qualifying condition. Elapsed time alone never invents an age or exception.

Requests have distinct operation/withdrawal/authorization identities, an explicit
approved sequence, and authorization for their exact amount/account/date/route/
sequence. Batches execute hypothetically by event date then that sequence. Each
request consumes only local temporary balances. Across accounts the aggregate
basis is used once, while each source account retains its independent cash cap.
Any failure discards the entire batch's numeric proposals. Re-evaluation returns
replacement proposals with stable identity traces, never incremental usage.

Tax-year components distinguish recovered contribution basis, conversion/rollover
taxable and nontaxable principal, and earnings. Principal is not recognized as new
income. With verified no exceptions and explicit early-distribution predicates,
the helper labels candidate earnings inclusion, early-distribution earnings and
open-clock taxable conversion recapture bases. These are amounts for PFA-TAX to
requalify, not tax rates, liabilities, withholding, payments or final exemptions.
Qualified distributions suppress those candidate bases. Unknown qualification,
exceptions, inherited, QCD and other routes return typed S7 incompleteness.

## Deliberate boundaries and verification

No current/future law, birth cohort, exception permission, special adjustment,
contribution authorization, rollover eligibility or legal clock is guessed.
Inventory changes during the window require a fresh authenticated snapshot.
No accounting transaction, household participant, shared interface, basis
registry, bank movement, tax owner, capacity registry, compiler or UI is written.
Returned containers are detached and deeply frozen; caller containers stay mutable.
First-failure S7 diagnostics include source path, owner/account/year, snapshot and
stable source references; failures contain no fabricated zero-tax proposal.

The synthetic unit cases exercise independent numeric decompositions, historical
usage/reconciliation, cash and basis caps, batch precedence, owner separation,
duplicates, source cutoffs, clock boundaries, rollover character, exact large
cents, deterministic reordering and immutable replay. They are authored here for
GitHub CI; local tests/builds/validators are prohibited in this Codex turn.
Existing code-selected CI owns unit, typecheck, build, architecture and four E2E
shards. Independent actual-head semantic audit and PM approval remain merge gates.
No CI polling or automatic merge is performed.

#149 owns authentication of raw evidence, persistent usage/idempotency, shared
S5 basis state, ledger/funding and source requalification at execution. PFA-TAX
owns law interpretation and authoritative tax liability; #101 retains payroll/
withholding ownership. A green isolated test cannot fund a Roth distribution or
close #146, D2-D, U1 #120 or R5.
