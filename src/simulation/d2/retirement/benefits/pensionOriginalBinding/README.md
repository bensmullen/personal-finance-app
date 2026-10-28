# Pension original qualification

Issue #146, PFA-DET-016 §5.1/§5.11, PFA-TAX-015; conditional evidence only.
`bindPensionOriginals(request, providers)` qualifies four mandatory source books:
plan award/elected form, payer BANK signed gross/net confirmations, legal
payment instructions/ownership, and complete since-commencement installment
history. Each role is independently addressable by publisher. Plan and BANK
publishers and source publications must differ. The composition root must
independently authenticate publishers, verify payer signatures over the complete
confirmation record and retrieve exhaustive original/revision inventories.
This port is an injection/trust boundary, not a real pension or BANK integration.
A consumer pin, digest, signature label or conditional verifier input is never
sufficient authentication. The tests use an independently authored synthetic book.

Pins bind publisher/source/version/original identity and a full-record SHA-256
witness. The claim separately pins household, worker, participant, sponsor,
plan, pension, entitlement and beneficiary. Full-record witnesses include exact
amounts, elected form, continuation percent, event dates, legal accounts/owners,
withholding, complete quote/COLA calendars and paid/unpaid/exhausted history.
Arrays are evidence sets: order is immaterial, duplicates remain observable.
Provider queries select entitlement/role inventories, never a consumer-selected
version. Missing, competing, withdrawn, replaced, delayed-known amended or
unauthenticated sources fail closed. A history may conservatively reject its
whole claim; no competing candidate wins through source iteration order.

Publication metadata dates the original source catalog. Each signed BANK record
also carries its own published/known dates, checked against its installment and
simulation cutoff. The source book may be retrieved later without pretending
that a later-known record was available at an earlier economic event. Plan,
legal and history evidence must be available at the evaluated installment.
Every earlier installment must appear, including unpaid ones; extra, duplicate,
substituted or conflicting rows invalidate the claim. Reuse of payment/receipt/
confirmation/funding identities rejects all relevant claims, including conflicts
in an otherwise invalid history. A single BANK/history corroboration of the
same historic payment is permitted; the unchanged verifier prevents repaying it.

Only independently retrieved records construct `PensionPaymentRequest`.
`calculateQuotedBenefits` and `provePensionPayments` remain unchanged: the former
owns quoted whole-installment and sourced continuation economics, the latter
owns exact gross/net, route, election, temporal and conditional payment checks.
No actuarial election reduction or pension formula is implemented here.
Historic employee basis and unsupported contract taxation remain incomplete.

The binder evaluates one history calendar per source inventory and invokes the
existing conditional verifier once for the combined request. After evaluation,
all four mandatory originals are independently fetched and requalified again;
any failed second read discards that claim. There are eight provider calls per
qualified claim, independent of months. There are no annual provider rescans.
The unchanged verifier still performs its existing per-installment history
checks/calculations; this binder makes no new runtime-complexity claim about it.
Bounds are 64 claims, 64 competing originals and 1,200 revision/history/payment
records per source; full history calendar evaluation retains the existing
1,200-month evaluator bound. Synthetic 1/12/120 tests bound provider calls and
serialized output size without heavy benchmarks or new dependencies.

Output retains existing intent claim/operation/payment/receipt/entitlement IDs,
due dates, exact gross/net cents and compact source references. One source
reference catalog is returned; original calendars/histories are never copied
into each installment. Coverage preserves distinct event occurrences and typed
diagnostics. All outputs are immutable, `committed:false`, `postable:false`,
with incomplete tax and BANK settlement. No income, cash, asset, contract basis,
withholding credit, physical transaction or retirement adapter is created.
#149 owns eventual integration. This does not close pensions/SSA settlement,
owner #146, D2 or R5. Exact-head selected CI, independent semantic/provenance/
multi-case/size audit and PM approval remain required before merge.
