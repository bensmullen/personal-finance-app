# Physical HELOC servicing — partial implementation, blocked

Issue #149 authorizes this opt-in participant and its source lookup codec. It is
not complete or merge-ready. No shared B1, draw, state, tax, scheduler or replay
file was changed. Local bounded preflight was skipped by the policy hook because
Node is unavailable; none of the new tests or typechecks has been executed.

## Blocking original-draw history interface

The existing `helocDraws` participant posts a draw with
`accountingTransactionId(m.operationId)`. That constructor preserves its input,
so the real canonical posting ID equals the original source operation ID.
`proposeHelocPhaseServicing` reserves `h.postingId` and `h.operationId` in the
same untyped uniqueness set (`phaseServicing.ts`, lines 191–207). An authentic
posted draw therefore yields `DUPLICATE_CLAIM` before a proposal can be admitted.
Inventing a different posting ID would sever the required canonical proof.

The focused test `documents the out-of-scope B1 gate` executes the existing draw
participant's actual canonical writer, obtains its committed posting ID, and
passes that exact identity into B1 principal history. It specifies the current
failure, not successful draw-to-servicing acceptance.

Required follow-up authorization: a narrow correction to
`src/simulation/d2/debt/heloc/phaseServicing.ts` and its directly affected B1
tests, preserving duplicate/reuse rejection between distinct occurrences while
admitting the producer's actual posting/operation identity pairing. #149
explicitly keeps B1 read-only and requires stopping for a missing shared port.
The consumer cannot repair this contract within its two writable subtrees.

## Preserved scoped work

`registerHelocServicingSourcePorts` installs separate authenticated issuer and
BANK readers once at composition, including in a cold process. The portable
participant stores only source lookup IDs. The readers reconstruct raw original
terms/history and exact-date BANK debits independently; a SHA commitment detects
changes but cannot authenticate a publisher. Original documents remain at the
publisher. The synchronous SHA utility is reused as content addressing only;
no tax rules or tax authority are inferred.

`qualifyHelocServicingSource` regenerates unchanged B1 and both signed journals.
`createHelocServicingParticipant` checks actual prior repayments and exact prior
draw receipt keys, schedules separate charge and settlement operations, and
uses only `applyD2HelocOriginalAtomically` / `applyD2SettlementAtomically` to
change state. New service postings have distinct journal/operation IDs so their
own later repayment history can satisfy B1. This cannot repair existing draws.

The daily seam requires actual BANK debit/publication/knowledge at the due-date
UTC boundary. Missing or stale authority is S7 incomplete. Insufficient cash or
conflicting same-instant resources fails the entire affected period; previously
committed periods survive. Principal-only service has one journal. Nonzero
interest and supported final service fees use a separate existing payable,
cleared by settlement. Tax and unsourced future servicing remain incomplete.

The unexecuted synthetic tests specify literal January/February economics,
computed and quoted interest, zero charges, final balloon/service fee, recognized
original pairing, one-cent shortfall rollback, history/source/identity negatives,
two-line approved order and cross-participant contention, thirteen funded
installments, source changes after portable restore, fresh-process replay,
recomputed transport-integrity tampering, and reference-sized payload growth.
They do not establish acceptance evidence until CI and independent audit pass.
