# Original SSA evidence qualification

Implements #146 D2-A A1 original qualification under PFA-DET-016 §5.1/§5.11
and PFA-TAX-015. This isolated module produces conditional gross installments.
It does not establish integrated runtime, bank settlement, tax, Medicare or
withholding evidence. #149 owns physical integration.

`bindSsaOriginals(request, providers)` accepts consumer pins and separately
injected publisher ports. A port must independently retrieve authenticated
original awards, quotes, legal/election/relationship/death findings and complete
publication/revision inventories for the exact household, recipient and data
cutoff. Inventory completeness covers every source ID for the publisher and
recipient, so omitting a conflicting publication's pin cannot hide it.
The embedding composition root owns publisher authentication; this
module supplies no production SSA adapter. A digest, `VerifiedAward`, eligible
flag or consumer-authored determination alone cannot supply that trust. Tests
use a separately authored synthetic book, explicitly not real SSA evidence.

Pins bind publisher/source/version/original identity, SHA-256 full-publication
content, household/recipient/workers, award/entitlement/election identities,
claiming months, event period and data cutoff. The versioned digest canonicalizes
all evidence arrays as sets while retaining duplicates. It includes full quote,
calendar, COLA, legal, death and inactive inventory content, not just selected
payable amounts. It is a change witness, not authentication.

The provider's revision inventory is complete through `dataCutoff` and checked
at `knownAt`. Known amendments, corrections, supersessions or withdrawals
published through cutoff refuse the original-only path, including delayed
amendments discovered during replay. Missing, unverified, competing, withdrawn
or changed originals fail closed. Overlapping recipient, award, entitlement or
election pins reject every competitor, including unavailable candidates; an
unrelated member still qualifies. Any overlap rejects the entire conflicting
publication candidate conservatively, rather than choosing individual winners.
Disjoint original event periods permit independently sourced elections.

The complete publication is checked once against cutoff; source availability
is also checked at each installment. Only actual at-claim dollars are admitted.
FRA dollars require a future supported coordination contract; this binding
never calculates an age adjustment. The unchanged `coordinateSocialSecurity`
owns legal coordination, installment timing and effective-period checks, using
`calculateQuotedBenefits` for gross dollars. It is called once per qualifying
publication for the intersection of the requested horizon and original event
period. The new binding does not repeat full-horizon calculations per month.
Source calls are two per evaluated publication, independent of installment
count: the second fetch repeats full inventory/digest qualification after
evaluation. A changed second read discards the whole candidate's results.

Returned installments are immutable, `committed:false`, `postable:false`, with
`bankSettlement:incomplete` and `taxLiability:incomplete`. Gross is never checking
cash. Each installment carries an operation ID derived solely from the existing
stable claim ID (not the forecast horizon or publication digest), exact gross
money, an original reference and affected-output coverage. One source reference
catalog retains original IDs/digests and distinct trace identities; publications
and derived quoted awards are never copied into installment output. Coverage
retains each recipient/month occurrence, including incomplete gaps. Bounds are
64 pins, 64 originals per lookup, 64 quotes/determinations per original and
1,200 months; synthetic size/call tests exercise 1/12/120 installments.

No shared scheduler, state, source registry, tax engine or SSA law is added.
GitHub CI and independent financial/provenance review remain merge gates.
