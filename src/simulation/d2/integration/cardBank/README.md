# Issuer statement interest / BANK payment — blocked preflight

Issue [#203](https://github.com/bensmullen/personal-finance-app/issues/203), under
shared execution owner [#149](https://github.com/bensmullen/personal-finance-app/issues/149).
This is a static source assessment. Physical settlement and historical paid-state
characterization remain unimplemented.

## Entry gate

PR #200 merged as `013d3c3888b470c2c3b19bf5f4f185358bac90e7` and registration
PR #205 merged as `de0a56b106ca65de9741476a5c26be547e488a6f`. Both are present
in fetched `origin/main` at the latter commit. Single latest-head check snapshots
for `e5e91042c5f8d6f00448233a75bc12be118eea13` and
`2180790c8d26034e8768908882e09c16a3f58228` respectively showed applicable checks
successful, with other checks skipped. No local verification was run.

## Exact blocker

The shared state has atomic balanced posting and identity uniqueness, but no
card-specific durable proof binding actual interest recognition and funded
repayment to the original issuer statement, owner, authorization, BANK account,
event time and principal/interest/fee allocation. Current balances and operation
IDs cannot authenticate that history after other activity or independent restore.

Source evidence at the task-start commit:

- `src/state/index.ts`: `LiabilityState` stores typed liability ID, balance and
  optional rate. `AuthoritativeIdentityRegistry` retains transaction, recognition,
  settlement, occurrence and external-idempotency IDs, not their economic payloads.
  `applyAccountingTransactionAtomically` applies balanced legs and registers the
  transaction ID; it does not retain the transaction or issuer source receipt.
- `src/semantics/claim.ts`: `ClaimBase` retains owner, amount, balance target,
  originating recognition ID and settlement IDs. It does not authenticate the
  issuer source, BANK debit or exact allocation behind those identities.
- The optional `ssaMedicarePayments` state record and
  `applySsaMedicarePaymentAtomically` provide a source-requalified receipt for
  SSA/Medicare only. That authority is not a card payment port.
- `src/simulation/r3/replayArtifact.ts`: the explicit `recordKeys` list includes
  that SSA receipt but no card receipt. Arbitrary participant-owned state fields
  are not a supported persistence extension.
- B1 `proposeCreditCardStatements` returns uncommitted expense/payment proposals.
  C2 `reconcileCreditCardCycles` explicitly returns `committed: false`,
  `postable: false` and `physicalBankSettlement: "not_applied"`. Its
  `BankConfirmation.status: "posted"` is documentary evidence, not proof of engine
  execution.

The merged [journal design](../../../../../docs/development/d2-prep/rmd-transaction-allocation-journal-design.md)
explicitly directs #203 to stop when a new durable shared receipt port is needed.
It rejects transaction-ID-only proof, JSON idempotency payloads and a shadow ledger.
Encoding a statement in trace references or participant configuration would also
preserve an assertion without authenticating actual posted history.

## Static type and accounting preflight

The later adapter must use existing typed `AccountId`, `LiabilityId`, recognition
and settlement IDs. Source strings must bind existing resources. Checking/savings
needs an explicit matching `ownerId` (optional on `AccountState`). `LiabilityState`
has no owner/issuer field, so source-qualified identity binding is also required.
No simultaneous VS4 representation of this card is admissible.

`Money` arithmetic must preserve exact currency minor units. The state writer adds
cash debits and subtracts liability debits. The oracle therefore requires expense
debit / liability credit $20, then liability debit / BANK cash credit $200:
liability $1000 becomes $1020 then $820; BANK $500 becomes $300. Net worth moves
from -$500 to -$520. Payment recognizes no expense. With an issuer interest-first
allocation for this quote, repayment is $20 interest, $180 principal and $0 fees;
that order must be sourced, never treated as universal policy.

`RunContext` supplies instant-valued `asOf` and `dataCutoff`. Raw B1 `IssuerSource`
supplies civil-date `asOf` and textual `sourcePublication`, with no typed publication
timestamp. Admission must prove event-known publication/source availability rather
than treating publication text as a timestamp. Re-evaluate the complete raw B1
request; accept a C2 bundle only from matching requalification. A conditional
remaining balance or `already_recognized` cannot authenticate prior recognition.
Undefined optional state/evidence must remain unavailable.

`HouseholdKernelParticipant.prepare` receives `RunContext`, `Period`, opening
`OperationState`, optional existing work and optional detail/summary tier.
`registerHouseholdParticipantCodec` restores configuration, not historical posting
authority. The eventual shared receipt must survive state construction,
clone/index, candidate commit and portable restore, reject changed sources/reused
authorization, and roll back with transactions when a later operation fails.

## Required follow-up

DECISION_NEEDED: Authorize a separately scoped #149 shared card receipt foundation
before resuming physical card settlement in #203.

PRODUCT_IMPACT: Proposals remain conditional; authenticated card repayment,
recognized-interest history and satisfied minimums remain unavailable.

OPTIONS: Build the approved shared receipt foundation, or defer this adapter.

RECOMMENDATION: Design and authorize the foundation under #149, then resume #203.

TECHNICAL_REASON: Existing identities and balances do not preserve source-bound
posting/allocation proof through independent restore. Minimum newly needed source
scope is `src/state/**` and `src/simulation/r3/replayArtifact.ts`, with dedicated
shared receipt tests in a separate authorization. These paths are excluded here.

The resumed task still needs actual funded/unfunded oracle tests, exact-cent and
large-money cases, multi-owner isolation, changed/repeated evidence, same-date
BANK contention, second-transaction rollback, no-op reattachment, and 13+ month
independent portable detail/summary evidence. This assessment supplies none of
that runtime acceptance evidence and does not close #203 or D2.
