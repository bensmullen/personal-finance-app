# Issuer-quoted card interest and funded BANK repayment

Opt-in runtime adapter for [#203](https://github.com/bensmullen/personal-finance-app/issues/203),
using the canonical posting archive and atomic receipts owned by #149. It does
not register itself in the application compiler or replace the B1/C2 evaluators.

At process composition, call `registerCardBankSourcePort` once with a read-only
publisher service returning independently authenticated, immutable raw
`CardBankDocument` records. The service must authenticate issuer identity, account
ownership, signed payer authorization, quote version and validity, the exact
approved allocation, complete activity, and instant-valued publication/knowledge
provenance. A receipt store, supplied hash, copied portable configuration, or
observed BANK `posted` flag is not that service. There is no bundled provider
or authentication bypass. Tests reconstruct synthetic raw issuer documents
independently rather than using a map of purported receipts.

Call `attachCardBank(kernel, { sourceIds })` to include the participant. Only
lookup IDs enter portable configuration. Every preparation, event, and historical
receipt requalification reads the publisher again and runs the complete raw
request through B1 `proposeCreditCardStatements`. Optional C2
`reconcileCreditCardCycles` proof must reproduce the original raw statement and
qualify matching owner/card/issuer/payment history; documentary confirmations
never move engine cash.

This first adapter admits a principal-only opening with no intervening purchase,
refund or payment activity, and a source-approved interest/ordinary-fee charge
event with explicit posting IDs and one actual economic instant. Different charge
dates and general revolving activity remain S7 incomplete. No APR, grace-period,
minimum-payment or fee formula is introduced. Missing independent timestamp
provenance remains typed S7 incomplete; civil `asOf` and publication text are
never converted into invented midnight instants.

The charge posts expense debit / issuer-liability credit through
`applyAccountingTransactionAtomically`, with the D2 original registration on
that first posting. The separate on-time authorized payment requires that exact
immutable archived journal and uses `applyD2SettlementAtomically` to post
liability debit / owned checking-or-savings BANK credit. It creates no income,
tax characterization, additional expense or funding. Legacy transaction IDs,
balances and `already_recognized` flags do not replace the journal. Fixed-loan
VS4 dual registration is rejected by attachment.

For the synthetic oracle, BANK $500 / liability $1000 becomes BANK $500 /
liability $1020 after $20 issuer interest. A separately approved $200 payment
($20 interest, $180 principal, $0 fees) leaves BANK $300 / liability $820. Net
worth falls $20 across both events. Insufficient actual BANK cash leaves the
prior charge and unpaid minimum intact, without a fabricated penalty or partial
payment. Funding contention and stale opening balances fail atomically.

Participant descriptors declare BANK consumption. Shared-instant internal BANK
payments need distinct independently authenticated sequence positions, translated
into dependency edges; array order is never payment priority. Unresolved external
BANK work and concurrent writes to one card fail closed. Canonical period
rollback preserves the prior committed journal, receipts, balances and identities.

Independent portable replay processes must import this module for its codec and
register their own source port before restoring. Receipt history is requalified
by the shared APIs; the participant also compares archived card journals against
the independently regenerated originals/payments. Include the complete historical
card source set in `sourceIds`. Summary and detail consume the same transactions,
with no participant-owned balance ledger or hidden state record.

Tests under `test/d2/integrated/cardBank/` cover the economic oracle, prior-month
recognition, insufficient BANK, legacy/mismatched evidence, raw source/time and
allocation conflicts, owner isolation, explicit ordering, idempotency, rollback,
and 13/25-month independent-process replay. They are authored for GitHub CI;
no local installs, tests, builds or validators are run in the Codex turn.
Independent exact-head CI and semantic review remain required before merge.
