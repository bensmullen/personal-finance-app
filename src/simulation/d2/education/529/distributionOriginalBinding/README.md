# Conditional original distribution proof (#147)

`bind529DistributionOriginals` retrieves independently owned versioned originals
through nine trusted producer ports: plan/current lots, since-inception funded
BANK history, tuition receipts, adjustments/benefits, payments/recognition,
effective law/qualification, exhaustive household cross-plan usage, trustee
instruction, and independently observed destination route. Nonqualified events
require the six non-tuition ports and never manufacture a receipt. Bank-paid
tuition requires a posted debit matching the original bill; direct institution
payment instead requires an independently sourced outstanding claim. Recognition
remains a distinct economic event with its own stable identity.

These are dependency-injected repository boundaries, not an authentication service.
The composition owner must wire actual trusted repositories, not user callbacks
that echo pins or fabricate evidence. Distinct producer IDs enforce separation
of the supplied ports; IDs, verified flags and SHA-256 do not prove authority.
The synthetic tests explicitly simulate producers and claim no live university,
IRS, custodian or BANK integration. No mandatory existing production port is
replaced or expanded. Production retrieval/wiring and physical settlement remain
#149-owned and absent from this source-only module.

Each producer returns a complete original envelope and inventory for the bound
event and household/plan context. Its latest-original lookup must return amended,
withdrawn or later-known records even if the caller requests a historical pinned
version; an archival lookup that always echoes the old version cannot meet this
contract. Publication, issuance, known-at, as-of and half-open effective dates are
checked. This bounded adapter supports an event-date data cutoff, matching the
evaluator's mandatory current snapshot/usage observations. Future-known facts
cannot qualify earlier events. Full SHA-256 digests cover all original content,
including extensions, as change witnesses only.

The original plan reconciles its current lot basis/earnings to its snapshot;
every since-inception contribution must match an independently posted BANK debit
and plan credit. The supported complete lot inventory retains original lot/basis
identities, including exhausted lots with zero current balances. This is evidence
reconciliation, not another earnings-ratio or cash-availability engine. Independent
adjustment totals pass to the unchanged evaluator for reconciliation and legal
qualification. Cross-plan usage is attested by the independent household register:
entry plan/provider fields retain the actual consuming plan; entry source metadata
attests the register's consumer-plan context as required by `EducationRequest`.
Unrelated beneficiaries are filtered only after household claim checks. The law
producer owns qualification; no bill or caller eligibility flag substitutes for it.

Batch admission includes unavailable candidates and rejects all contenders sharing
an event, operation, claim, paid expense, economic recognition, or same-date plan
snapshot/cash source within a household. It never chooses a winner by iteration
order. Historical partial use is retained for the unchanged evaluator's remaining
expense calculation. Pins and producer envelopes bind owner/beneficiary/provider,
school/student/term/paid/economic expense, source/destination/payee, operation,
claim, kind, date/cutoff and authorized gross. Event IDs are supplied, preserved
across forecast horizons and never regenerated. Separate invocations reserve no
claim; #149 must perform durable source/claim admission atomically before posting.

After exactly one evaluator call per admitted candidate, every mandatory original
is independently retrieved again, even if evaluation or another re-read fails.
Entire inventories, including unused competing receipts, adjustments and usage,
are re-read. Amendment or withdrawal suppresses the occurrence. Evaluation-level
incompleteness retains compact coverage with null economics; original-source
failure emits only a compact diagnostic. The adapter freezes its output and
copies only exact proposed economic effects, tax character, fixed-size coverage
and original references. No `fundingProof`, raw source document, lot/history array,
catalog, adjustment array or usage array is copied per occurrence.

Every occurrence remains `committed:false`, `postable:false`,
`physicalDistribution:not_applied`, `settlement:incomplete`, with tax liability and
penalty incomplete. `planAssetDelta` and `bankReceiptCharacter` are proposed
effects, not stock changes or BANK postings. The evaluator's federal character
and incomplete state/local/penalty outputs are retained without a second tax
engine. #101 and #149 retain their tax and settlement authority.

Authority: PFA-DET-022 §5.7/§5.11, PFA-INV-028, PFA-TAX-015. Independent synthetic
literal oracles cover tuition/nonqualified cents, adjustment/use, institution
claims and separate recognition, unavailable originals, metadata, ownership,
contradictions, replay, second-read races, sibling/household isolation, and
1/12/120 proposals with observed cents/read counts and proportional output size.
These are conditional isolated fixtures. Latest-head CI, independent semantic
audit, PM merge approval and the integrated D2/R5 gates remain external.
