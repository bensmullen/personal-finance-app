# Opt-in SSA / Medicare same-event settlement

Issue #149's bounded physical slice consumes one actual A1 coordinated monthly
SSA installment and one complete C2 member-month. Positive deductions are full
Part B/D obligations; independently sourced zero other Parts create no claim.
`attachSsaMedicare` is the household entry point. No shared editor or automatic
source discovery is enabled.

The adapter recalculates `coordinateSocialSecurity` and
`composeMedicareObligations`, binds exact award, recipient, worker, entitlement,
coverage, provider, plan, route, month, base, surcharge and legal source lineage,
and obtains `prepareSsaMedicareDeductionProposals` approval. Explicit effective,
published and known verified-zero withholding is mandatory. All source facts
must also be available by the run data cutoff.

State owns one source-specific atomic candidate transition. A single registered
inward-facing source qualification port makes that transition and receipt import
re-evaluate A1/C2 without a state-to-simulation import. Conditional proposals,
caller-supplied receipts and completeness flags never authorize posting. The
ordinary bank-funded settlement API is unchanged.

For the synthetic $1,500 gross / $80 B / $120 D example, the sole journal debits
the existing owned BANK $1,300 and Medicare expense $200 and credits SSA gross
income $1,500. Opening BANK $2,000 becomes $3,300. Three positive same-event
claims have three distinct recognition identities and three separate full
settlement identities. A fully deducted installment omits the zero cash leg.
Preaccrued premiums and partially settled SSA rights require a separate clearing
contract and are rejected.

The optional `ssaMedicarePayments` record stores versioned private source inputs,
explicit zero withholding, source-consumption identities, the actual canonical
journal, recognition facts and distinct claim/settlement histories. It is created
only with successful posting. Import validates the complete receipt against the
posted identity registry, exact journal, claims and freshly qualified sources.
An identical completed receipt suppresses repeated participant execution;
changed evidence fails closed. Source evidence is the same trusted external-input
boundary as A1/C2; replay fingerprints do not authenticate SSA/CMS publications.

Descriptors declare the actual payment instant and BANK production. Preparation
rejects unproven built-in contention; the existing candidate observer seam also
rejects unproven peer-participant BANK work. A direct successor dependency after
the payment is supported. No scheduler priorities are inferred.

Detail and summary use the same transaction and state transition. The existing
portable codec seam restores immutable inputs in a fresh process. Sparse v3
checkpoints retain receipts and reject invalid receipt removals; older v1/v2/v3
artifacts retain exact absence when this optional record is missing.

Social Security provisional-income treatment, Medicare deductibility and
projected tax remain incomplete. Executed gross income, premium expense and
verified-zero withholding are reported separately; no tax credit is fabricated.

CI oracles are in `test/d2/integrated/ssaMedicare/settlement.test.ts`, with a
separate fresh-process replay worker and synthetic source fixtures. They cover
the exact journal and statements, independent claims, reversed request order,
two payment months, 13/24 monthly detail/summary runs, portable checkpoint resume,
legacy absence, full deduction, duplicates, source/identity/withholding failures,
preaccrual/partial-right rejection, forged histories, tampered deltas and BANK
contention rollback. Source-owner installment boundaries are covered in the
existing C2 coordination regression file. Codex does not run these tests locally;
GitHub Actions, independent semantic audit and PM merge approval remain gates.

## Optional original-source admission

`originalSources.mode = "ssa-medicare-originals/v1"` requires a composition root
to register one immutable `SsaMedicareOriginalAdapter`. Its independent SSA
publisher/revision inventories feed `bindSsaOriginals`; its independent CMS/SSA
and IRS inventories feed `proposeOriginalIrmaa`. No production provider or
authentication is supplied here. Compact pins and hashes witness changes;
they cannot authenticate client-authored awards, complete flags or returns.

Original admission binds the exact consumed A1 recipient and installment, and
C2 enrollment, rule, return or granted determination inputs. It also matches
each original surcharge result to the actual composed obligation's member,
coverage, plan, month, tier, determination and tax years. C1 base premium and
exclusive SSA deduction authority still come from the existing composition.
Nonzero IRMAA remains part of each premium, with no additional transaction.

Every qualification freezes independent source reads and repeats them after
financial computation. Attach, event preparation, atomic state admission,
receipt history validation and portable codec restoration use that same path.
Missing sources in a fresh process refuse import; raw original documents never
become portable credentials. Existing source inputs carry only the additional
compact original pins, queries and candidate digests. Legacy payments without
this mode preserve v1 semantics and gain no original-source assurance.

`originalSettlement.test.ts` and its separate synthetic provider book cover
original-backed journals, nonzero and zero surcharges, two members, multi-month
detail/summary and cold replay, source withdrawal/races and proportional
1/12/24-month receipt and portable output sizes. These synthetic providers do
not establish authentic SSA/CMS connectivity or complete SSA tax treatment.

## Issue #149 indexed-history repair and checkpoint audit

Continuous indexed execution carries a private validated receipt-index root,
append-only consumption/transaction/claim/settlement indexes and exact account,
claim and identity roots. Only identical inherited immutable receipts can reuse
qualification. New receipts still pass the independent source authority at
atomic admission and receipt validation. Changed ownership/currency, changed
claims, untracked containers or identities require full validation; historical
receipt replacement/removal rejects. Checkpoint snapshots do not convey this
live-execution authority. Lineage is published only after whole-state validation.

The separate `indexedHistory.test.ts` exercises real 1/12/24-month detail and
summary runs and emits `SSA_MEDICARE_GROWTH` measurements for each source family,
receipt bytes, total encoded artifact bytes, checkpoint count/encoded bytes,
checkpoint record/identity/runtime bytes, and source-binding identity bytes.
Existing source, journal, portable-replay and size oracles remain unchanged.
These measurements require exact-head CI execution. The current bounded local
preflight failed before typecheck/tests because creating `.codex/logs` returned
EPERM; it was not retried. No measured improvement is claimed from static
inspection alone.

Static producer → consumer → replay evidence for the remaining size decision:

- `src/state/index.ts` `paymentConsumptionKeys` embeds `paymentValue` of the
  complete payable/right/requests/BANK/source-input tuple in the
  `ssa-medicare:source-binding` identity. `src/identity/index.ts` `idempotencyKey`
  length-prefixes that string; it does not hash it. This is existing v1 history.
- Atomic posting registers that key in `externalIdempotencyKeys`; receipt
  validation recomputes the identical key. The receipt separately retains its
  source inputs. Raw publisher-held original documents remain excluded.
- `src/simulation/householdExecution.ts` retains the first nonterminal recovery
  checkpoint after month 12, while a terminal 12-month run has no checkpoint.
  `src/state/index.ts` `authoritativeCheckpointDelta` includes the checkpoint's
  receipt records and identity additions. The first delta starts from empty
  state, as required by the existing v3 replay writer/reader.
- `src/simulation/r3/replayArtifact.ts` `checkpointDeltas` and `encodeValue`
  serialize those full string identities alongside the receipt records.
  Object-content sharing cannot replace embedded substrings inside identities.
  `restoreCheckpointDeltas` restores the identities and receipt validator checks
  the exact existing key again. This is distinct from repeating raw originals.

The previous 24-month artifact measured 1,149,651 bytes, with a 679,524-byte
checkpoint and 595,870 bytes in checkpoint identity additions. Issue #149 K
now approves a source-specific v2 identity: new original-backed payments emit
`ssa-medicare-payment/v2` and an `ssa-medicare:source-binding/v2` key containing
`sha256:` plus the full SHA-256 of the exact historical normalized tuple.
State reuses the synchronous FIPS-180 implementation in `contentIdentity.ts`.
All other receipt fields, journal and identities retain their existing meaning.
Validation selects the algorithm by the persisted receipt version. Historical
original-backed and ordinary v1 receipts keep their exact long identities;
neither source availability nor current admission mode can re-key them.

The remaining repeated provider reads originated in participant preparation:
`householdExecution.preparePeriod` passes a period-scoped context, so comparing
`period.start` to `context.simulationStart` caused exhaustive history reads in
every period. Preparation now uses authoritative state validation, which reuses
only proven unchanged indexed receipt lineage, and explicitly checks historical
source facts against the current cutoff. Independent new-event admission and
final source rereads remain intact. The explicit portable source-history entry
point and cold state import still requalify all originals.

The bounded complete-run test keeps the strict per-family 1/12/24 source-read
limits and emits receipt, persisted binding-key, checkpoint record/identity and
overall artifact byte counts. It compares checkpoint identity bytes with the
previous 595,870-byte observation and requires more than 90% elimination of
that duplication. No wire encoding or existing threshold is relaxed.
`versionedReceipt.test.ts` independently checks SHA-256 with Node crypto,
historical v1 archive equality, plain v1 posting, mixed v1/v2 cold replay in a
fresh process, malformed/copied keys, changed inputs, provider withdrawal and
second-read source revision races. Neither digests nor portable integrity
authenticate publishers. CI and independent audit remain required.
