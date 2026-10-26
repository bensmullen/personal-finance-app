# Series EE original source binding

`bindSeriesEESources(bindings, lookup)` is the isolated #147 B2 source binding
prerequisite under PFA-DET-021 / §5.6, PFA-INV-027 and PFA-TAX-015. It calls
the unchanged `proposeSeriesEE` once per eligible original. It adds no interest
arithmetic, statutory terms, tax liability, BANK cash or physical redemption.

The independent publisher implements `lookup(sourceId)` and returns an active
`EEOriginal` containing the entire immutable original `EERequest`, its publisher
source ID and original version. The callback belongs to the invocation boundary;
it must not be persisted in participant configuration. Production publisher
qualification, issuer approval and authoritative ownership remain #149. Neither
an `official` tag nor this content digest authenticates a publisher. Callers must
not implement lookup by wrapping their own proposal or consumer-authored request.

Consumer pins identify the original issuer/source version, complete original
request digest, exact original lot identity (including purchase/acquisition cost,
face, beneficiary, wrapper, owned cash destination and tax bucket), and observation
action/date/known-at/period. `eeRequestDigest` uses the existing canonical serializer
and pure SHA-256 utility, with fixed format `ee-request/v1:sha256:<64 hex>`.
The digest covers all fields, including full future schedule rows, rule terms,
quotation, opening basis/election and all source chronology/tax facts. Meaningful
array order remains part of original content. Pinning does not permit rewriting
or refreshing the original; a new source version requires a new explicit pin.

The binder snapshots the independently fetched original, checks the pins,
evaluates it once and re-reads the publisher before admitting a conditional
occurrence. Missing, withdrawn, changed, wrong-version or failed lookup returns
typed S7 incompleteness. Rejected evaluation retains output-specific coverage.
Admitted occurrences preserve independent federal/state/local/settlement
coverage, so incomplete tax character never becomes a tax payment or deduction.

Only compact references and economic/character summaries escape. No request,
proposal lot, source publication, monthly schedule or tax-rule catalog is returned.
Trace IDs occur once per occurrence; its output coverage uses that shared trace
set. Tax character carries law version/snapshot identity without copied source
documents. All results are immutable, `committed:false`, `postable:false`, with
`funding:incomplete` and `physicalRedemption:incomplete`.

Every colliding submitted occurrence identity or evaluated claim is rejected;
input order cannot choose a winner. A redemption claim is lot-wide across dates.
This bounded batch check does not reserve claims or prove durable usage. #149
still owns global exclusivity, current checkpoints, funded settlement and posting.
Repeated standalone calls can return the same conditional reference.

The independently authored synthetic tests include monthly accrual, discounted
original cost, penalty, guarantee, prior recognized interest, incomplete law,
identity/content/chronology refusal and deterministic batch ordering. The
1/12/120-distinct-source payload case uses fixed-width identities and a 3% ratio
tolerance for constant JSON framing; literal exclusions prohibit schedules,
publications and nested annual tax catalogs. It is a bounded payload test, not a
stress benchmark. GitHub CI and independent semantic/source/performance audit
remain required. This slice does not complete B2 or close #147.
