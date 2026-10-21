# B3-2 conditional beneficiary Roth transfer — #147

`propose529RothTransfers` implements a private `d2-shared/v1` proposal under
PFA-DET §5.7/§5.11, PFA-INV-028 and PFA-TAX-015. It consumes B3-1
`EducationPlan`/`EducationSource` identities read-only and preserves the A2 S5
person/year/legal-scope/capacity-version key convention. It does not invoke or
modify `propose529Distribution`. IRA-specific scopes are private logical inputs;
#149 must adapt the authoritative A2/A3/shared capacity owner, not reinterpret an
employer-plan scope as IRA room.

Every fact must be independently verified, available by the event, scoped to
the actual household/owner/beneficiary/plan/provider and denominated in exact
nonnegative cents. Current identity, balances, complete history, destination,
authorization, current lot allocation and usage require event-date evidence.
Legal and funded-history evidence may have an earlier as-of date if its effective
half-open period covers the event. Sources cannot disagree under one source ID.
Amounts are `Money`; no floating-point monetary arithmetic or embedded statutory
thresholds, presumed exceptions, or external law lookup is used.

The legal source owner supplies applicable direct-trustee treatment, a positive
integer calendar-year minimum age, the permitted age start, inclusive first
excluded contribution date, exclusion of allocable earnings, beneficiary lifetime
maximum, and independent annual/compensation rule versions. Aged history must be
complete since inception. Beneficiary/plan changes require source-qualified legal
continuity under the applicable 529 rule snapshot, including the current
beneficiary's start event. Unsupported calendar anniversaries (including an
invalid leap-day anniversary) remain incomplete rather than inventing an aging
exception. No sourced law means no candidate.

The beneficiary must own the receiving Roth IRA. The destination and exact
authorization identify the receiving trustee, holding and source cash; bank
routes, parent Roths, conversions and regular-contribution labels fail closed.
Source evidence attests each enclosing fact, including these account identities.
Plan container, holding and cash identities are distinct. This module supports
the B3-1 nonnegative ordinary plan model only, not loss/special allocation models.

All current lots, including zero-balance historical lots, must match the funded
contribution lot/basis IDs. Their remaining basis and **allocable earnings** must
reconcile current plan basis/earnings/value. Funded principal less ordinary
distribution basis and posted same-plan Roth-transfer basis must independently
reconcile current basis. Recent lots' entire remaining basis and earnings are
excluded. This is a sourced current-lot partition, not an invented aggregate
earnings ratio or a proposed final transfer-basis allocation. #149 must determine
and reconcile the actual transferred basis/earnings before settlement.

An explicit exhaustive register covers this beneficiary's lifetime 529-to-Roth
transfers across every owner/plan/provider plus all current-year IRA usage and
independently authorized pending claims. Empty arrays alone prove nothing.
Posted transfers already reduced the current plan balances and are not charged
again. Pending same-plan Roth claims additionally bound source cash/eligible
assets; current snapshot cash must be supplied before those itemized pending
Roth claims (other encumbrances must already be excluded). Pending later dates
in the same year count; unsupported future-year reservations fail closed.
Regular IRA usage reduces annual/compensation room, never 529 basis or lifetime
usage. Each independent IRA capacity attests recipient, tax year, scope/version,
complete current usage, sourced applicable maximum and exact used amount. Both
capacity usage totals must reconcile the exhaustive current-year register.

The exact permitted bound is the minimum of requested/authorized amount,
current value, remaining liquid/eligible source, annual room, compensation room
and beneficiary lifetime room. If a request exceeds it, `bounds` preserves the
requested and permitted amounts, all outputs are incomplete, and no proposal is
emitted. The module never silently reduces the request or creates a sale.

Operation/claim/history/lot identities are unique and observed replay fails.
Conservative batch admission rejects **all** requests sharing a beneficiary,
plan, cash account, holding or destination, even if their combined amounts could
fit. Shared allocation/precedence belongs to #149. Disjoint requests can produce
sorted independent candidates; batch/input order never chooses a winner. Input
size is bounded (oversized batches raise `RangeError`); returned containers are
deeply cloned/frozen without freezing caller containers. Reordered lots/usage
produce the same output.

Candidates include exact requested amount, source lineage, original balances,
eligible/excluded basis/earnings, available annual/compensation/lifetime room and
proposed capacity increments. Both capacity constraints describe the **same**
transfer; they are not two IRA deposits. Every candidate is `committed:false`,
`postable:false`, `physicalTransfer:"not_applied"`. No cash/basis/asset/IRA usage,
lifetime usage, tax, wage income or entitlement is posted or reserved. S7 funding,
settlement and federal/state/local tax outputs remain incomplete even for a
positive conditional candidate. #149 must recheck all source, identity and shared
capacity facts atomically; #101 owns tax characterization. No integrated runtime,
semantic merge readiness or B3 closeout is claimed.

## Synthetic independent exact-cent oracles

The adjacent tests use invented values and publications, not actual law:

| Oracle | Independent expected result |
| --- | --- |
| $800.05 basis + $200 earnings, including recent $200.02 basis/$49.98 earnings | $750.05 eligible, $250 excluded |
| $500.07 annual maximum less $100.02 usage | $400.05 annual room |
| $450.03 sourced compensation capacity less $100.02 usage | $350.01 compensation room |
| $1,000 lifetime maximum less $600.04 from another owner's plan | $399.96 lifetime room |
| Requested $350.01 with $900 liquid source | Exact $350.01 conditional candidate |
| Requested $350.02 | $350.01 diagnostic bound; no candidate |
| Additional $50.01 pending same-year transfer | $300 remaining compensation room; original request rejected |
| Recent boundary on lot funding date | Both its basis and earnings excluded |

Negative oracles cover wrong beneficiary/trustee/kind, missing/stale/unavailable
sources, continuity, exact age/year/lookback boundaries, incomplete/duplicate
usage, mismatched capacity, basis/earnings/lot reconciliation, currency/cents,
input immutability, deterministic ordering and batch collision/replay.
GitHub CI owns unit/typecheck/build/architecture/four E2E gates. No local tests,
builds, validators or package installation run in this implementation turn.
Reviewer audits the published head and updates #147; PM merge approval remains
external to this conditional implementation.
