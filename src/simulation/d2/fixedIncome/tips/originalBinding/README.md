# TIPS original qualification — conditional evidence only

`bindTipsOriginals` implements the source-only B2 boundary of #147 under
PFA-DET-021 §5.6/§5.11, PFA-INV-027 and PFA-TAX-015. Eight independently
registered capabilities supply security terms, indexing/coupon/floor rules,
beneficial ownership, committed basis, actual acquisition funding, scoped CPI
revisions, dated law, and complete prior recognition/claim histories.

Registrations belong to a trusted composition root, never a consumer request.
Producer IDs and full-original SHA-256 pins are consistency witnesses, not proof
of publisher authenticity. The host must authenticate/register each publisher
and return its latest exhaustive original at both reads, including competing
versions, pending claims and withdrawals. No Treasury, brokerage or IRS connector
is implemented or claimed. These private ports do not authorize shared source
authentication or settlement interfaces owned by #149.

Each versioned immutable event binds household/person/wrapper/holding/lot/
security/issue/basis, month, operation, claim, period and event/data cutoffs.
The event cutoff bounds evidence even when a later data cutoff is supplied.
Only ordinary issuance-at-par lots are admitted by the existing calculator.
Funding must reconcile the actual posted acquisition; independent recognition
history must reconcile the committed opening. Prior redemption, same coupon,
claim reuse, overlapping batch intervals and changed basis cannot become new
independent economic events. All competing batch candidates are gated together.

The adapter reconstructs `TipsRequest`, then calls unchanged `bindTipsSources`,
which calls `proposeTips` once. It performs no CPI interpolation, coupon, floor
or tax calculation. All mandatory publishers are re-read after evaluation,
including incomplete evaluation and unused observations. CPI queries identify
only opening/event reference months; publishers must index their inventories
and include every competing revision for those months. Missing observations
remain typed incomplete and are never replaced by a zero inflation assumption.

Results retain compact economics, calculation operation/claim identities and
role source/version/SHA-256 references. They contain no original documents,
CPI histories, funding books or law catalogs. Funding, physical settlement and
tax liability remain incomplete; `committed` and `postable` remain false.

Synthetic tests provide fixed $40/$10.40 accretion/coupon and -$150/$9.50/
$1,000 deflation/coupon/floor oracles, negative provenance/replay cases, and
1/12/120-event byte/read bounds (16 publisher reads and four CPI observation
visits per event). These are conditional tests, not integrated settlement or
production-source evidence. CI and external exact-head financial/provenance/
replay/size review remain required. PM owns merge; #147, D2 and R5 stay open.
