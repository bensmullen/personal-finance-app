# TIPS original-source binding

`bindTipsSources(bindings, lookup)` implements the conditional #147 B2 adapter
for PFA-DET-021 / §5.6. The independent source owner supplies an active full
`TipsOriginal`: issuance/par evidence, owned lot, committed opening checkpoint,
issue-specific conventions, dated CPI publications/revisions, coupon calendar,
optional exact coupon quote and tax-character rules. The binding carries only
source/version/content pins, subject identities and event identity/date/period.
The lookup is parameterized separately and receives the economic event cutoff.
Production source qualification and the physical producer remain #149 work;
wrapping a consumer request in this callback is not original authentication.

The versioned SHA-256 digest covers the entire original including checkpoint
attribution. Evidence sets are canonically sorted, preserving duplicates.
A digest proves content equality only. The adapter independently fetches,
snapshots, validates, calls the unchanged `proposeTips`, and re-reads the original
before admitting economics. Withdrawal, refusal or any content/version amendment
rejects the event. Lot/quote evidence must be available by the event; opening and
rule evidence must also be available at the opening they explain. CPI chronology
is checked separately at opening and event by the evaluator. Tax law is evaluated
at the event cutoff, with missing jurisdiction facts retained as incomplete.

Principal/CPI admission is required for computed indexation/coupons. The unchanged
evaluator may admit a sourced quote alone when CPI is missing, leaving indexation,
basis and dependent tax character incomplete. Quotes never bypass invalid lots,
openings or conflicted CPI. When computation succeeds, a supplied quote must
exactly reconcile to the computed coupon and replaces its route exclusively;
conflicting quotes refuse the event.
An unknown coupon convention or maturity floor retains granular evaluator
incompleteness for that output, without inventing a movement.

Every duplicate submitted occurrence or same-position event is refused, including
aliases across sources, checkpoint variants and quoted/computed coupon routes.
Conflicting openings and overlapping indexation intervals also reject all affected
candidates. Independent events remain conditional, sorted deterministically.
These batch checks are not durable reservations; repeated invocations may return
the same conditional claims. Operation and claim references do not depend on the
forecast horizon. The externally supplied occurrence ID must remain stable too.

Outputs contain one compact source pointer/checkpoint reference per event,
exact-value economics and tax character, shared trace IDs (at most 32, each at
most 200 characters) and output coverage. They omit source catalogs, requests,
legal text, opening history and publication payloads. No shadow positions or
event journal are maintained. All results are immutable, `committed:false`,
`postable:false`, with funding, physical settlement and tax liability incomplete.
Cash/asset/basis deltas are proposals, never funded holdings or posted cash.

Dedicated synthetic tests cover fixed $1,040/$10.40 economics, signed deflation,
the original-par maturity floor, separate federal/state coverage, stale/racing
sources, identity and claim conflicts, chronology and 1/12/120-event payload size.
GitHub CI and independent financial/source audit remain merge gates. This phase
does not close #147 or implement #149 physical settlement.
