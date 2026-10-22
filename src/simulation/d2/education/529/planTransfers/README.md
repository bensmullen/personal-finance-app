# Conditional ordinary 529 trustee continuation — #147 B3-3

`propose529PlanTransfers` consumes the unchanged B3-1 `EducationPlan` and S2
`EducationSource`, plus B3-2's original history, current lot partition and Roth
usage conventions. It prepares private `d2-shared/v1` conditional movements for
ordinary same-owned 529-to-529 trustee transfers, including separately permitted
beneficiary changes. It is distinct from an expense distribution or beneficiary
Roth transfer. No statutory numbers, family relationship inference or IRA limit
calculation is embedded here (PFA-DET-022 §5.7, PFA-INV-028, PFA-TAX-015).

The admitted profile is existing, accessible cash at par, partitioned into all
original contribution lots. The entire wrapped plan value must reconcile to that
cash. Invested/inaccessible holdings, sales and in-kind settlement require another
source-qualified profile; this seam cannot manufacture cash. Original funded lots
less posted distribution and transfer basis reconcile current basis. Posted
history is already reflected in current value and is not subtracted twice.
Pending authorized claims across all household plans are separately sourced and
reduce unencumbered funds. The register includes distributions, plan transfers
and Roth transfers; local Roth entries must reconcile the beneficiary lifetime
history. The source owner attests exhaustive registers, including empty ones.

Every source must identify the household, owner, beneficiary, plan, provider,
currency, version, publication, effective half-open window and observed date.
Historical facts are admitted at their original event, current facts at the
transfer date. Original and receiving trustee confirmations independently bind
the operation, claim, provider transfer identity, amount, actual cash accounts,
both trustees and original snapshot version. Receiving proof uses the receiving
plan/provider/beneficiary context. Both plans' state/local permissions and a
federal election window, amount bound and same-year qualification are mandatory.
Contrary or missing jurisdiction evidence blocks the movement; tax amounts are
still incomplete for #101, never assumed zero.

Whole-plan movement carries exact original per-lot basis and earnings. A partial
transfer needs independently admitted `per_lot_proportional` allocation and a
sourced rounding mode. Multiply each lot's basis and earnings by amount/value,
round each once to cents, and verify the sum equals the requested amount.
Unallocated rounding cents produce `SOURCED_RESIDUAL_ALLOCATION_REQUIRED`; no lot
gets a residual by iteration priority. Outputs include literal remaining source
balances and lot conservation, with no fresh contribution or age reset.

Plan age and 529-to-Roth eligibility continuity require separate explicit sourced
permissions. Historical changes must be verified, and beneficiary-since must
match the latest change. A new beneficiary additionally needs exact old/new
identity, a unique change identity, separate legal and receiving-plan permission,
and the verified original history. No family name authorizes a transfer.
Preserved history and the prospective change are separate, so the prior chain
is not overwritten. Preserved Roth usage remains attributed to its original
beneficiary; it is not new-beneficiary capacity. #149 must join all beneficiary
histories before any later eligibility or capacity decision.

Stable `transferKey` is household/original account/provider transfer ID and does
not contain the request ID. Register and batch replay checks reject renamed
requests reusing that transfer. Multiple requests sharing a source or beneficiary, including
chained incoming/outgoing requests, fail closed together for #149's shared atomic
owner. This bounded seam does not choose legal precedence or reserve a partial
group. Independent evidence arrays are canonically ordered, cloned and frozen;
the caller's objects remain untouched.

S1 identities and S2 sources are carried into S3 stable conditional intents.
S4 movements decrease one wrapped asset and increase another by the same exact
amount; they are not additional postings of both wrapper and underlying cash.
Household BANK cash, consumption and net-worth deltas are zero. S5 preserves
original lot/funding/date/basis/earnings and eligibility provenance. S6 tax
liability and S7 physical funding, registry updates, IRA capacity and settlement
remain explicitly incomplete for #149/#101. Every intent is `committed:false`,
`postable:false`, and `physicalTransfer:not_applied`. No scheduler, state, tax or
application adapter is changed. #149 must atomically recheck the original version,
both trustee confirmations, full claim register, exact funds and all legal
permissions before consuming any source or recording any destination lots.

S8 tests use independent synthetic two-lot whole/partial golden amounts, negative
source/legal/identity/funding cases and deterministic evidence reordering. They
read the unchanged B3-1/B3-2 exports and retained preparation catalog without
promoting it to integrated evidence. GitHub CI owns ordinary verification; #147,
#149, #101 and reviewer/PM merge gates remain open.
