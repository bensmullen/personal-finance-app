# Actual HELOC principal draws — #149

`createHelocDrawParticipant` is an opt-in `HouseholdKernelParticipant`.
`attachHelocDraws` returns an immutable kernel overlay plus per-output S7
incompleteness; `runHelocDraws` runs that overlay through the production detailed
household kernel. The same participant supports production summary execution and
the existing portable replay/checkpoint codec registry.

Each confirmation contains the original B1 request, its exact regenerated
`proposeHeloc` proposal, a source-qualified BANK binding, opening bank cash and
cash quoted immediately before each draw. The existing checking/savings account
must belong to the borrower; the existing liability must equal the sourced
opening principal. No account or liability is created. Quotes cover an exact
household period. Source knowledge is bounded by both the run cutoff and the
first admitted draw, including any index observations needed by the entire B1
conditional quote. Missing rate, issuer or interest evidence rejects admission.

One source operation produces one balanced financing transaction: debit the
named bank and credit the named liability. The source operation ID is the posted
transaction ID. Authoritative external idempotency identities retain the source
operation, borrower authorization and exact canonical quote receipt together.
Replay suppresses an identical committed prefix; reused identities with changed
evidence fail. Each draw checks current cash, prior principal and remaining
credit immediately before posting. Registration and posting occur on the
kernel's isolated candidate; a later failure rolls back the whole period.

Descriptors use `liabilities:heloc_draw`, the `liabilities` scheduler domain and
the bank's cash-production resource. B1's sourced within-line dependencies order
multiple draws cumulatively. Overlapping independent line/liability quotes and
same-day shared-bank work without a supported cross-source contract return
`HOUSEHOLD_CONTENTION_UNRESOLVED`. The adapter supplies no domain priority.
Independent later bank expenses use the existing scheduler and cash balance.

Interest, repricing after admission, claims, interest payments, principal
repayment, amortization and balloon do not execute. A nonfinancial coverage
operation carries warnings and incomplete output capabilities through subsequent
periods and receipt-only reruns. Therefore an admitted draw can commit while the
kernel result remains `incomplete`: inspect committed periods and `reachedThrough`
separately from coverage. Only the admitted principal transfer is tax independent;
the future cash/liability/net-worth path is incomplete. The wrapper also returns
separate S7 rows for unposted interest, interest payment and principal repayment.

This slice does not change B1, shared accounting/state/scheduler APIs, catalog
coverage or the normal-user application. Refs #149; remaining D2 execution and
product acceptance stay open.
