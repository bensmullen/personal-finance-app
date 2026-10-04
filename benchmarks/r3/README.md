# R3 evidence and execution boundary

The pre-R3 comparison point is the R2-complete merge
`2d10b02e7471c8040e30ff6f4d58917c8f67d3f9`. The historical R1 artifact is
Node 24 evidence, not a valid performance comparison. Its engine execution and
preparation dominance guided operation dispatch and candidate-copy work; its
representative/model-count scaling motivated bounded indexes and avoiding
factorial enumeration of unrelated final-order work. No improvement or budget
is claimed from that historical evidence.

GitHub ordinary CI owns the bounded reference/property cases in
`test/r3HighThroughputKernel.test.ts`. No local verification was performed.
Run the external engineering-validation `performance` profile on Node 22 both
at the pre-R3 comparison point and the R3 candidate before merge-ready closeout.
Retain both artifact heads, runtime, fixture/horizon counts, completion status,
raw phase/resource samples and workload configurations. Compare matching
application samples separately from reusable-kernel samples. The latter omit
application compilation/read-model work by design. Start with zero warmups and
one measured run for the first external smoke.

`captureKernel.ts` adds compile-once/repeated-execution samples to the existing
heavy capture and validates exact requested-horizon completion. Absolute heap
is sampled, not peak memory. Throughput is executions per second for one
synchronous kernel; it is neither a concurrency promise nor an SLA. Rich
application/UI explanations are not constructed by the kernel. Canonical
results and lineage refs are retained for authoritative selected results.

## Requirement/evidence map

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| PFA-PERF-019 | Immutable household kernel, generic prepared operation index, existing domain adapters | Frozen R2 executor equivalence and generic participant CI cases |
| PFA-PERF-020 | Domain-local execution overlays, reusable horizon/schedule/relationship/rule structures | Reference identity and changed-economics overlay CI cases; heavy reuse metadata |
| PFA-PERF-021 | One period dispatch index, isolated candidate ownership, indexed graph/instant/loan lookup, direct first order, streamed contention proofs, precomputed canonical configuration | Ordering properties, dispatch-read counts, rollback and canonical fingerprint CI cases; Node 22 scaling capture |
| PFA-PERF-022 | Existing compact lineage facts; one retained contention signature rather than all rich preview results; unchanged R2 lazy explanations | Full lineage equivalence and additional participant facts CI cases |
| PFA-PERF-023 | Pure engine contracts with versioned economic participant metadata and common state/facts | Generic domain registration CI cases; no browser/server/native assumptions |

Domain formula internals remain owned by VS2/VS3/VS4. The issue 68 stages below
supersede the original nested-runner implementation. State-sensitive preparation
is repeated each month/run; it is never cached as invariant household structure.

## Issue 68 staged closeout

The summary/replay boundary is a foundation, not a completed performance repair.
`runHouseholdForecastSummary` retains compact household metrics and capability
outcomes. `replayHouseholdForecastWindow` regenerates selected committed periods
from the immutable opening kernel and run context, checking both run metadata and
the displayed compact metrics before returning evidence. Statement flows can be
accumulated without retaining accounting transactions.

The second stage extracts shared cash/debt financial evaluators and a period-work
candidate evaluator. Prepared operations no longer call the complete VS2/VS4
forecast wrappers or `runPeriod`; period-work candidates omit standalone
statements/opening snapshots, and valuation makes one candidate instead of two.
The bounded oracle now imports frozen domain/period evaluators so production
refactoring does not also replace the oracle's orchestration.

The third stage uses persistent AVL-backed state/identity indexes and entity
copy-on-write views. Candidate forks share historical values; only changed
entities are copied/validated. Claim duplicate checks use indexed historical
identity membership, while financial claim queries use active category/entity
indexes. Primitive updates share unchanged entries and validate changed entries.
Frozen loan contracts cache exact recurrence membership. Ordinary output state
and primitive objects are materialized at the run boundary for transport.

Known remaining work: production defaults are still detailed; the evaluator still
constructs detailed period objects before summary extraction; full-state/history
materialization at output boundaries, rich cash/debt period assembly, complete
final audit retention remain. Contention
signatures now compare exact shared-root deltas against a fixed instant opening
state for built-in domains. Unchanged historical subtrees are skipped, and
financially equal changed values are compared with authoritative serialization.
Legacy custom-participant comparisons still serialize complete state because
callbacks may replace indexed records or identity ordering. That extension path
remains a history-growth risk. Broader
structural counters and application defaults are pending. Replay now stops at
the requested window end and can resume from private shared-root checkpoints
every twelve periods. A transported compatibility copy can fall back to the
immutable opening basis. Checkpoint spacing and retained reachable-tree memory
still require heavy measurement; these are not flattened full-state copies.
Static-entity currency/runtime consistency checks still traverse whole entity or
primitive collections inside preparation/work evaluation. Cash local-order
construction now uses frozen-input income/expense indexes and appends occurrence
groups without copying each prefix. Household overlap-component discovery still
uses pairwise resource comparisons. These
remain operation/entity-count scaling risks even though candidate forks no
longer copy growing historical state. No near-linear operation-count claim is
made for this intermediate stage.
An additional lifecycle risk remains for a single active claim receiving many
settlements: `applySettlement` checks/copies its complete settlement-ID sequence,
claim normalization validates/copies that sequence, and the indexed claim update
removes/re-adds its settlement ownership entries. With S settlements on one claim,
these updates still do O(S) work per update and can accumulate quadratic work.
The global archived-claim index improvement does not remove this per-claim risk.
An incremental lifecycle/settlement-ownership representation is still required;
financial duplicate, reconciliation and rollback checks must remain exact.
This stage does not
meet issue 68 acceptance and supplies no new timing evidence. CI owns bounded
verification; fresh Node 22 engineering-validation remains required for closeout.

The updated contention strategy uses a domain-owned analytical certificate and
an exact memoized reachable-prefix-state fallback. A bounded regression
case captures a policy-free accepted overlap with scarce liquidity: an internal
transfer of 5 between two funding-source accounts holding 10 each overlaps a
required mortgage service of 50 using those same sources. Both orders preserve
the funding-group availability of 20, the unfunded service outcome/shortfall,
the claim lifecycle and the transfer postings. Scarcity and overlapping access
therefore cannot justify rejecting this model or adding policy lineage. The
current resolver accepts this case via source-pool conservation without candidate
execution. Funded/partial/cross-pool cases cannot use that certificate. Ambiguous
components advance atomic operations through a prefix-state DAG; identical future
state, primitive state, required-service statuses and accumulated authoritative
outcomes are necessary for merging. Exhaustive complete-order generation is
confined to `referenceOrdering.ts` and the frozen bounded oracle. The fallback
drains distinct branches even after sensitivity is established to preserve the
reference's hard-failure precedence. Counters report analytical hits, fallback
invocations, states, merges, terminal comparisons and maximum ambiguous size.
Accumulated outcome order can inhibit merging. No worst-case polynomial bound or measured fallback
frequency is claimed. A further sufficient certificate accepts a nonnegative
income / required-service pair when opening first-source cash already covers a
conservative service upper bound. It uses the existing posted mortgage interest
and payment rules, includes active arrears, handles final contractual payoff,
and requires disjoint primitive identities. Source allocation then remains
entirely in the first source regardless of income order. Bounded coverage includes
zero and nonzero nominal rates; insufficient margins still use exact search.
Common-path analytical coverage and heavy fixture evidence
remain required before R3 closeout.

The summary-first closeout replaces the prior retention filter. Built-in atomic
evaluators now stream posted accounting into compact flows and release audit
objects; summary mode skips slice and household period warehouses and full
period trace unions. Both ordinary application forecasts/comparisons and the
reusable-kernel capture default to this path. Compact debt balances preserve
payoff transitions. Explanation addresses reconstruct an aligned period through
the existing checkpoint replay, using original artifacts; transported addresses
without those artifacts fail explicitly. Compiler source bindings and applied
rule/assumption/event IDs are compact navigation metadata from actual execution,
not synthetic financial lineage. Detailed compatibility remains explicit.
These changes still require CI equivalence and fresh heavy evidence. Long-lived
claim settlement-history work remains the next code closeout; the operation-count
risks above and exact-search worst cases remain unmeasured.

The settlement-history closeout now uses persistent chronological and membership
AVL roots with readonly array views. Appends visit logarithmic tree paths;
normalization and invariant checks recognize validated roots instead of copying
or scanning preceding IDs. In-place ownership updates preserve recognition and
historical settlement ownership, reconcile only new settlement IDs, and remove
fully settled claims only from the active index. Cold replacements/deletions and
canonical output retain full defensive validation. Exact contention deltas encode
shared claim prefixes relative to the same opening authority, so comparisons of
an incrementally settled claim do not serialize its preceding settlement history.
Bounded tests cover arbitrary identity order, branches, duplicates, materialized
order, active removal and historical replay protection. Counters expose cold
validation, append tree visits and historical entries copied. This supersedes the
per-claim quadratic risk described for the previous intermediate implementation;
timing and current-head CI evidence are still required.

Worker explanation addresses now share one portable opening/configuration and
compact-metrics artifact per forecast. Structured cloning preserves that shared
basis; explicit explanation restores exact financial value types and checks the
selected replay against its fingerprint and displayed metrics. Compiler source
IDs and static assumption addresses remain available to existing navigation.
This does not transport per-period financial warehouses. A portable explanation
without private checkpoints warms from the opening basis; its latency remains
unmeasured. JSON serialization of a read model can duplicate a shared artifact
across addresses, whereas the production Worker uses structured cloning. That
export boundary is not a forecast hot path and should not be used as a timing
proxy for Worker transport.
