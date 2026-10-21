# Pension original-payment source boundary (#146)

`provePensionPayments` consumes unchanged A1 `calculateQuotedBenefits` results.
It never calculates a parallel pension amount, COLA, election reduction or
survivor percentage. It admits whole quoted installments only. Tests use
synthetic original plan awards and separate exact-cent payer bank documents.

The caller must externally authenticate the original plan/award, payer bank
confirmation, legal payment instruction, destination ownership and exhaustive
payment history. `verified` records that upstream finding; this module neither
authenticates raw uploads nor turns a user-authored assertion into verification.
Copying quote evidence as the independent bank document is rejected. Pending or
unverified documents remain incomplete even when their deposit amount matches.

An original pension binds pension, plan, employer sponsor and entitlement IDs
to the full original A1 award terms. Only `awardId`, the quote-record ID, is
excluded from exact comparison; monetary values and factors compare exactly.
Changed COLA, election, mortality, sponsor or source terms require reconciled
original authority, never an override of the existing evaluator. A quote-record
revision preserves A1 claim identity and the payer's original payment/receipt
identity. Competing current confirmations are rejected together, irrespective
of order. Reuse checks include all supplied history across quote versions and
entitlements, not merely the requested forecast window.

Every due installment needs one posted documentary confirmation and one legal
instruction for A1's actual recipient. Its authorization precedes funding,
funding date equals the supported A1 payment date, and gross and net equal the
A1 exact scheduled amount. Explicit nonempty withholding by named jurisdiction
must contain only zero amounts in the same currency. Omitted withholding is
unknown. Positive withholding, employee basis recovery, formula/proration and
unmapped routes remain typed incomplete. The legal instruction and bank record
must agree on election, form, institution and owned checking/savings destination.
No account or bank number is needed; use canonical opaque IDs and synthetic data.

All evidence is published and known by its effective event and the run cutoff,
and covers that event under a half-open interval. A historical provider can
expire after the event and before the run cutoff. Original award sources must
already exist at the original document's known date. History explicitly covers
commencement through the candidate date, attests completeness, and lists every
earlier A1 installment as unpaid, paid or exhausted with the correct claim and
recipient. Paid/exhausted history carries original payment and receipt IDs.
Missing, duplicate, off-schedule or substituted earlier rows fail closed.
An unpaid history row consumes nothing; it can coexist with an uncommitted
proof for that date. Earlier rejected documentary candidates do not erase a
separately valid later installment when its history is independently complete.

The request admits at most 64 awards/originals/history inventories, 76,800
confirmations/instructions and 1,200 rows per history; A1 retains its 1,200-month
schedule limit. Unsupported or malformed documentary evidence produces S7
diagnostics. Malformed request envelopes throw. Results are sorted, copied and
deeply frozen, with exact immutable `Money` values, source and trace references.
No input or history is mutated and no process-global provider is used.

S1–S3 identity, time, sources and A1 dependency are preserved privately. S4/S6
outputs are conditional intents with `committed:false`, `postable:false`,
`tax:incomplete` and `bankSettlement:incomplete`. No cash/NW delta, recognition
fact, withholding credit, ledger posting, scheduler priority, shared capacity,
tax-basis method or settlement receipt is created. Documentary `posted` cannot
settle or suppress a real separately posted pension. S7 diagnostics carry
affected installment dates, periods, codes and provenance; S8 synthetic tests
exercise exact cents, survivor ownership, replay, source/history rejection and
array-order independence. This is isolated evidence, not integrated D2 or UAT.

#149 owns canonical identity adapters, actual pension BANK funding/posting,
atomic consumption and deduplication against real postings, tax characterization
and read-model integration. This module does not complete #146, D2-A or R5.
GitHub CI owns tests, typecheck, build and architecture verification; no local
verification or package installation is part of this implementation turn.
