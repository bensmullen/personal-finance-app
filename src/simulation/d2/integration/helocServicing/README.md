# Physical HELOC servicing

Issue #149 provides an opt-in household participant and portable source-ID
codec for original amortizing and final-balloon HELOC installments. It does not
complete tax, unsourced future servicing, all-domain D2 integration, UI or UAT.

## Composition and authority

`registerHelocServicingSourcePorts` installs separate authenticated issuer and
BANK readers once at composition, also in each independent cold process. The
portable participant stores source lookup IDs only. Readers must retrieve raw
original terms/history and actual BANK debits independently; neither a receipt,
its hash, a B1 proposal, nor a document's paid-status text authenticates them.
Original documents and full history stay at the publisher. The reused SHA
utility provides compact content addressing only, with no tax-law authority.

`qualifyHelocServicingSource` regenerates B1 and both signed journals.
`createHelocServicingParticipant` checks prior repayments and original principal
continuity against independently requalified actual canonical receipts. Prior
draws require the original B1 quote and the exact producer posting,
authorization and quote-receipt keys. Missing or altered proof fails closed.
Only `applyD2HelocOriginalAtomically` and `applyD2SettlementAtomically` write
servicing balances and journals; no second calculator or ledger is introduced.

The daily seam requires actual BANK debit/publication/knowledge at the due-date
UTC boundary. Missing/stale authority is S7 incomplete. Insufficient cash or
conflicting same-instant resources fails the whole affected period; previously
committed periods survive. Principal-only service has one journal. Nonzero
interest and supported final service fees use a separate existing payable,
cleared exactly once by settlement. Tax and unsourced future coverage remain
incomplete. Same-instant independent lines require source-approved BANK order.

## Bounded producer identity compatibility

The original draw producer preserves `operationId` as its accounting journal ID.
B1 permits that specific within-one-historical-draw posting/operation alias
while remaining conditional and unpostable. It still reserves the identity
against every distinct occurrence and every other role, including later
payment, claim, authorization and funding identities. Repayment aliases and
other within-record aliases remain rejected. Separate posting/operation IDs
remain supported. The consumer independently authenticates actual posting;
this B1 compatibility exception is not authority to trust claimed history.

## Replay and test evidence

The synthetic integration suite exercises an actual draw producer executable,
then two computed installments: BANK $500 -> $394.90 -> $290.76 and principal
$1,000 -> $900 -> $800, with expenses $5.10 and $4.14 recognized once. It also
covers issuer-only quotes, principal-only service, a full balloon with supported
fee, already recognized charges, insufficient cash by one cent, source/history
and identity negatives, approved two-line order and participant-order contention.
The 25-month fixture posts thirteen installments and exports a 24-month portable
checkpoint, exercising split/full and fresh-process replay without duplication.
Portable source data stays reference-sized; raw documents are not transported.

The earlier failing line 287 was a changed-publisher assertion on the *same
already restored artifact object*, before the three tampering replacements.
The generic replay adapter can return a private warm basis at restore time.
The repaired test requests a fresh object for cold publisher rejection and
separately proves warm **financial replay** requalifies before financial reuse.
No shared cache/replay change is required. Each of the original first-substring
tampering cases now has a named assertion, plus an exact wire-record field edit:
signed payment journal `type`, source `paymentApprovalId`, and `historyVersion`.
Transport integrity is recomputed in every case; authoritative proofs must
still be rejected. The first approval/history substrings may be inside the
redundant source fingerprint; exact field edits target their actual source
binding, rather than relying on that string location.

The optional bounded local preflight was skipped by the policy hook because
Node is unavailable. Tests/typecheck for this repair have not run locally.
GitHub CI and independent financial/replay audit at the pushed head remain
required before PM merge. No dependencies, existing draw producer, shared
state/tax/scheduler/replay, other domain, UI, or framework files are changed.
