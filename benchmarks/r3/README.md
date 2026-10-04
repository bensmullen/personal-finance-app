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

Domain formula internals and their canonical snapshot boundaries remain owned
by VS2/VS3/VS4. Required debt service still delegates to the existing prepared
VS4 operation, including its internal one-month financial runner. This task
does not duplicate that financial implementation across the ownership fence.
State-sensitive preparation is repeated each month/run; it is never cached as
invariant household structure. Full rich user-facing explanations remain an
application concern.
# Issue 68 staged closeout

The summary/replay boundary is a foundation, not a completed performance repair.
`runHouseholdForecastSummary` retains compact household metrics and capability
outcomes. `replayHouseholdForecastWindow` regenerates selected committed periods
from the immutable opening kernel and run context, checking both run metadata and
the displayed compact metrics before returning evidence. Statement flows can be
accumulated without retaining accounting transactions.

Known remaining work: production defaults are still detailed; the evaluator still
constructs detailed period objects before summary extraction; replay evaluates
the full horizon and has no sparse intermediate checkpoint; full-state/history
cloning, historical claim scans, identity sorting, primitive-store rebuilding,
nested runners and exhaustive contention previews remain. This stage does not
meet issue 68 acceptance and supplies no new timing evidence. CI owns bounded
verification; fresh Node 22 engineering-validation remains required for closeout.
