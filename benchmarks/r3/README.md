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
constructs detailed period objects before summary extraction; replay evaluates
the full horizon and has no sparse intermediate checkpoint; full-state/history
materialization at output boundaries, rich cash/debt period assembly, complete
final audit retention remain. Contention
signatures still serialize full candidate state/history during previews. Broader
structural counters, sparse checkpoints and application defaults are pending.
Static-entity currency/runtime consistency checks still traverse whole entity or
primitive collections inside preparation/work evaluation. Cash local-order
construction still uses repeated stream/occurrence searches, and household
overlap-component discovery still uses pairwise resource comparisons. These
remain operation/entity-count scaling risks even though candidate forks no
longer copy growing historical state. No near-linear operation-count claim is
made for this intermediate stage.
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
Fallback signatures still include full historical state, and accumulated outcome
order can inhibit merging. No worst-case polynomial bound or measured fallback
frequency is claimed. Common-path analytical coverage and heavy fixture evidence
remain required before R3 closeout.
