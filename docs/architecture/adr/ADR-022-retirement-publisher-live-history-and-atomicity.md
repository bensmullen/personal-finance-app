# ADR-022: Publisher-authenticated retirement history and atomic source-currentness

- Status: Proposed — PM architecture/source-authority approval required
- Date: 2026-11-18
- Owner: D2-D #350, coordinated by #149
- Scope: repeated **supported** sourced funded retirement cash distributions and account-scoped J1 RMD-usage coverage; **not** #348's combined nonretirement history optimization, and **not** an expansion of supported tax/RMD laws
- Requirement anchors: PFA-DET-017, PFA-DET-023, PFA-TAX-015, PFA-PERF-018/019/021, ADR-008, ADR-011 and ADR-021

## Context: missing information and the cost bound

The existing `RetirementRawSourcePort.read(reference, context)` authenticates one original at a time. `qualifyRetirementPriorHistory` rereads all previous distributions on each selected posting; `retirementCash/index.ts` and its `satisfaction.ts` person-funded fallback also independently reread previous sources to calculate RMD satisfaction. A January distribution may be withdrawn by its publisher immediately before February's selected posting without any change to February's original. No consumer-produced checksum, cached January qualification, unchanged February digest, or February prior-ID array distinguishes that withdrawal. For n independently withdrawable originals, exhaustive point rereads at n selected postings cost at least n(n-1)/2 observations. Current per-date v2 raw inputs also repeat cumulative prior-operation, authorization, withdrawal and RMD usage inventories; batching identical snapshots changes call counts but not necessarily validated bytes or CPU.

The product requirements preserve immediate publisher-source withdrawal validity at selected posting and independently qualified outward publication/replay. We must either obtain an actual publisher-owned, complete and fresh historical view or fail closed. The proposed model is a synchronous, versioned **publisher revision fence with authenticated baseline and complete deltas**. Its use is optional for legacy plans, but **required for any claimed proportional repeated sourced retirement history**. It is not a consumer cache or a time-based lease.

## Proposed decision

### 1. Authority and scoped observation

One separately registered, non-replaceable composition-root `RetirementHistoryAuthorityV1` owns its original ledger, issuance, revision and withdrawals. The application's archive, forecast compiler, source-pin digest and checkpoint are **not** publishers. An authentication claim means an actual call to this trusted owner reconstructs source facts and validates completeness; a digest is only a tamper witness.

A `HistoryScope` binds: publisher identity, household, run and scenario, `asOf`, `dataCutoff`, applicable member/account and full forecast horizon, plus the archive/period publication boundary. `RunContext` supplies run/scenario; the present `D2SettlementSourceContext` carries only asOf/cutoff, so the **real upstream caller must pass the missing values** into a new narrow integration interface. It is forbidden to infer run from `eventAt`, substitute publisher-selected cutoff, reuse a scope from another household, or make state depend on simulation-layer types.

The publisher's authoritative ledger maps each `(publisherId, sourceId, operationId)` to one currently effective original revision or explicit withdrawal/tombstone, including source-known/effective dates. Its monotonically increasing, non-reusable epoch covers **all** original additions, revisions, withdrawals and relevant authorization/usage changes within the specified observation scope. The publisher cannot silently mutate an old original while preserving the epoch. Cross-process re-registration recreates authority from independently supplied source facts, never saved consumer hashes.

### 2. Proposed TypeScript-shaped public protocol (interface sketch, not implementation)

```ts
type RetirementHistoryScope = Readonly<{
  version: "retirement-history-scope/v1";
  publisherId: string;
  householdId: string;
  runId: string;
  scenarioId: string;
  asOf: Instant;
  dataCutoff: Instant;
  horizon: Period;
}>;

type HistoryFrontier = Readonly<{
  version: "retirement-history-frontier/v1";
  publisherId: string;
  scopeDigest: string;   // tamper/scope binding, NOT independent authority
  epoch: string;         // publisher-issued strictly ordered opaque revision
  rootDigest: string;    // exact canonical currently effective set, NOT a signature
  entryCount: number;
}>;

type HistoryChange =
  | Readonly<{ kind: "upsert"; operationId: string; revisionId: string;
               event: RetirementEventOriginalV3 }>
  | Readonly<{ kind: "withdraw"; operationId: string; previousRevisionId: string;
               withdrawnAt: Instant }>;

interface RetirementHistoryAuthorityV1 {
  open(scope: RetirementHistoryScope): {
    frontier: HistoryFrontier;
    completeEvents: readonly RetirementEventOriginalV3[];
    // One publisher-owned complete inventory, once per fresh attempt/restore.
  };
  changesSince(scope: RetirementHistoryScope, frontier: HistoryFrontier): {
    previousEpoch: string;
    frontier: HistoryFrontier;
    changes: readonly HistoryChange[];
    // Complete gap-free ordered sequence through the new epoch, no missing tombstones.
  };
  withCurrentRevision<T>(
    scope: RetirementHistoryScope,
    frontier: HistoryFrontier,
    work: () => T,         // synchronous, no await; real selected canonical candidate/commit
  ): { status: "committed"; result: T; frontier: HistoryFrontier }
     | { status: "incomplete"; reason: "source_changed" | "source_unavailable" };
}
```

The shape is conceptual, not a promise that any existing external provider already implements it. The authority must guarantee a **linearizable revision fence** across `work`: any withdrawal made effective *before* this commit's linearization point increments the epoch and rejects the stale frontier; no relevant revision can become effective inside the guarded check-and-commit interval. Work is synchronous, bounded and exception-safe; the publisher must not permit reentrant mutation under the guard. Required source reads may be reentrant and must observe the exact guarded revision. The caller must release the guard on throw. Arbitrary networked publishers lacking such an atomic primitive **cannot claim this guarantee** by supplying two ordinary HTTP reads or a cryptographic hash. Their repeated-history capability remains incomplete until an actual coordination or conditional-commit facility is implemented. There is no delayed-revocation lease and no externally chosen grace period.

For a forecast whose source is withdrawn *after* one committed event but *before* the next independently published result, the next result fails source admission. A published result represents its precisely observed frontier; it does not claim permanent validity after publication. Other original publishers (especially the separate S1 BANK route) retain their own independent authority and checks. This retirement-only revision fence **does not purport to atomically transact across unrelated publisher systems**; a multi-publisher linearizability claim would need an additional coordinated design/PM decision.

### 3. Producer original format and bounded usage

Introduce an additive **event-local** `retirement-event-original/v3` with one event's identity/amount/owner, account and BANK destination, source liquidity and reservations, withholding authorization, ordering dependencies, published/known/effective times, member/approval/issuer references and account-scoped J1 obligation/usage changes. Each event carries bounded references to unchanged publisher-owned plan/rule data; each reference is verified within the scope and source revision. Event-local `sourceDigest` must not change merely because another event is appended. Every distinct economic occurrence remains separately identified.

A per-account/year usage index consumes these event deltas exactly once using canonical transaction, approval, claim, allocation and source identities. It records full exact-cent allocations and verifies sum `<=` independently qualified J1 required/capacity under currently supported rules. There is **no parallel satisfaction journal**: only physically funded, canonical posted and independently source-qualified distributions can satisfy a supported J1 account/year obligation. The existing `retirementDistributionAllocations`, actual BANK/retirement journals, posting proofs, identity registry and allocation evidence remain authoritative. Group RMD, unresolved tax characterization, unsupported withheld amounts and other unsupported variants remain `incomplete`, never promoted by the new history protocol.

Do not serialize `priorOperationIds`, all prior source approvals, all past withdrawal requests or complete accumulated RMD usage into every new event. Where a static catalog is shared, retain one immutable canonical catalog and a checked version/digest reference, not n catalog copies. Check cumulative growth in both returned source bytes and validated bytes, and avoid repeatedly calling `canonicalSerialize` on the entire event set.

### 4. Admission/commit/reconciliation state machine

1. **Fresh open:** At the start of each execution attempt or independently restored replay invocation, ask the publisher for one *complete* independently authenticated baseline for the bound scope. Check every source in the baseline (including required absences/withdrawals and configured scheduled originals) against the archived original and actual transaction/proof/claim/identity inventory. No omitted, duplicate, late-known, mismatched-version, out-of-scope or fabricated source is accepted.
2. **Advance:** Before each selected retirement posting, consume the publisher's complete changes since the last admitted frontier. Verify epoch continuity and root/scope changes using actual publisher authority. Apply additions and tombstones to structurally shared, attempt-scoped indexed source state. A withdrawal of any prior **committed** original invalidates historical source qualification immediately; reject selected posting rather than retain a stale prefix. Changes for a new unposted future original must be independently qualified before use.
3. **Guarded selected commit:** Under `withCurrentRevision`, requalify the *selected current* event's original and BANK route, run existing funding/settlement and `applyRetirementDistributionAtomically` on a candidate, compare the exact sourced original and accounting/proof/allocations, update the attempt's usage indexes and publish the candidate only if all checks succeed. If another source changes, abort the entire candidate and reconcile/stop rather than authorize an unqualified debit/credit. A speculative order can inspect privately, but cannot consume the selected guarded commit or decide policy merely from a rejected speculative debit.
4. **Year/account reconciliation:** On relevant year-end or explicitly requested read boundaries, compute annual J1 satisfaction from the **already source-qualified indexed archive plus the real original J1 obligation evaluator**. Native household and person-funded fallback must share the same validated ledger/index contract, while retaining distinct route/funding evidence. Never rerun a full prior-original publisher scan per month or reauthorize an event from consumer-replayed stored bytes.
5. **Outward publication:** Immediately before returning a full/incomplete forecast, externally observable checkpoint, replay window or portable export, advance and re-fence the entire source scope. Reject a newly withdrawn committed January original even if February failed for unrelated reasons. Private monthly accumulator/checkpoint callbacks are not independent outputs; any future truly public monthly streaming interface requires its own supported live publisher currentness guarantee.
6. **Failure:** `source_unavailable`, `history_incomplete`, `source_changed`, `publisher_guard_unsupported` and `posted_journal_unavailable` remain typed, fail-closed outcomes as applicable. External invalidation cannot be represented as source-qualified cash, RMD applied credit, a stale completed result or a supposedly valid incomplete committed prefix.

The guarded source revision and the structurally shared state lineage are **attempt-local**. Clone/replay/cold import does not inherit an authenticated revision from an older process, and an opaque guard token or callback is NEVER included in a portable artifact.

### 5. Additive versions and independent replay

Use new named capabilities rather than reinterpreting old data: `retirement-history-frontier/v1`, `retirement-event-original/v3`, a distinct versioned retirement source binding and distribution record (provisionally `retirement-distribution/v3`), and a new portable participant codec (provisionally `d2-retirement-cash/v4` to follow existing v3). Final literal schema names are subject to an interface compatibility check before implementation. Preserve old `retirement-raw/v2` witness, `RetirementRawSourcePort.read`, and `d2-retirement-cash/v1/v2/v3` interpretation unchanged.

Legacy artifacts with only per-original reads retain their exhaustive requalification and cannot claim proportional repeated-retirement history. New-format portable checkpoint/terminal records retain **bounded per-event source binding and archival change evidence**, not a trusted live snapshot/guard. On cold or warm restore, register independently supplied publisher authority, reconstruct full archive including sparse post-checkpoint and terminal deltas, authenticate the complete current publisher view and compare canonical journals/identities/claims. A forged closing BANK balance, omitted first/last original, or skipped withdrawal cannot pass. No in-memory private optimization may be the sole basis of portable source admission.

### 6. Required source-to-observable closure

| Entry/branch | Publisher + context | Actual posting/archive | Outbound/replay and test |
| --- | --- | --- | --- |
| `retirementCash/source.ts` | new event+frontier registration, complete changes, guarded revision; real run/scenario through caller | reconstruct current A4 original; no self-issued provenance | missing/forked/rollback epoch, stale January, wrong scope |
| `retirementCash/index.ts` inline and referenced dated schedule | current event, account/year usage and J1 source; both native household and person routes | selected `applyRetirementDistributionAtomically`; real BANK/retirement transaction and proofs | one/12/24, no withholding/unsupported branch, duplicated allocation |
| `retirementCash/satisfaction.ts` | same authenticated account/year index, not per-record re-read | derives funded J1 only from posted originals | person-funded fallback, year-end and two-RMD-year boundary |
| `src/state/index.ts` | currently bound context/guard, historical identity/source register | candidate writer, immutable receipts, postings, transactional rollback | old-original withdrawal before or during selected atomic commit |
| `householdExecution.ts` and read models | run/context scoped baseline/advance/terminal fence | no second journal; rejected speculative candidate does not commit | complete/incomplete, private vs observable callback, summary/detail |
| `src/simulation/r3/replayArtifact.ts` | fresh publisher registration, no cached guard | independent sparse and terminal archive parity | warm/cold/fresh-process, missing first/last/terminal, forged same BANK |
| Original publisher fixture and separate regressions | actual independently mutable source ledger with monotone revisions and guarded reads | literal cent-level oracles and named revenue/expense/claim identities | deterministic revoke-in-gap injection, wrong bank/household/issuer |

**Reverse-caller closure is a required preimplementation audit, not an assumed result of this ADR.** Source registration today happens in `retirementCash/source.ts` and test `retirementCash/fundedScenario.ts` registers a Map-backed `read` only. A production-quality fixture must implement the independent monotone source ledger, not just echo consumer archived records. Any required write path outside eventual V3 must be settled before Codex starts; the old #348 write scope grants none of these changes.

### 7. Negative, deterministic and proportional acceptance

- Positive exact-cent, independently authored 1/12/24 funded account-scoped originals: same supported timing/funding/withholding and J1 legal facts, ordered source cash debits/net BANK credits, no double tax income or invented RMD paid credit.
- Revocation counterexample: identical February original with January active versus January withdrawn just before February's **selected** guard; reject only the invalid world, with no committed February candidate or stale outward January prefix.
- Race: inject withdrawal between a preliminary observation and guarded commit. The provider either linearizes withdrawal first and rejects, or selected guarded commit first and reports a subsequently changed frontier; never accepts a stale epoch. Test reentrant read during guarded work, thrown work, concurrent worker attempts, and release.
- Missing/duplicate/forked delta, rollback/reused epoch, unknown older tombstone, changed `knownAt` beyond cutoff, wrong publisher/run/scenario/account/year/household, same-amount wrong source/BANK, forged source root without publisher authority, duplicate RMD allocation/approval, forged closing BANK, missing sparse/terminal original, and fresh-process replay lacking the original publisher all fail closed.
- Instrument **all** original publisher reads, baseline/delta/guard calls, actual source bytes returned/validated, source-identity/account-year index nodes visited, full-history canonical serialization, archive replay bytes and comparable throughput. Baseline O(n) once per fresh attempt/restore; changes O(k) across the attempted run, selected checks O(1) or O(log n) per event; indexed posting/reconciliation O(log n) plus bounded affected-year work, no per-month full-history validation. Memory/source payload O(n+k), not O(n²). One/12/24 workloads use similar per-event complexity and demonstrate a defensible 12→24 bound that excludes hidden CPU/bytes; no arbitrary strict wall-time assertion substituted for counters. Longer wall/heap evidence belongs to manual engineering validation, not ordinary CI.

## Rejected alternatives

1. **Per-original cached qualification or a cached digest:** cannot observe independent withdrawal of a prior original.
2. **Batch full original snapshots on every date:** fewer calls but repeated O(n) source data and validation, still quadratic.
3. **Exhaustive prior reads at every selected posting:** preserves existing semantics but violates repeated-retirement proportionality.
4. **Fixed-time lease that postpones revocation:** changes product source timing and lacks PM approval.
5. **Hash/Merkle root without independently trusted complete live owner or commit fence:** integrity, not completeness or freshness.
6. **Two unguarded revision reads:** source may change after the final read and before commit; not a linearizable proof.
7. **Archive-derived provider/status flag:** self-attestation rather than independent original publication.

## Consequences, decisions and delivery gates

The design preserves exact financial meaning and supports proportional repeated original history only when a real publisher can implement the specified conditional atomicity. It adds a narrow source-owner responsibility and a revised event/portable format. External sources without a compatible guarded revision owner remain explicitly **unsupported for this optimized recurring contract**; ordinary legacy one-off/strict reads continue independently. This is a bounded capability boundary, not a quiet source-trust weakening or a promise of multi-provider distributed transactions.

**Approval needed before implementation:** PM accepts (a) the guarded publisher revision contract and source-owner availability boundary, (b) additive event/portable versions (names subject to compatibility audit), and (c) no change to immediate withdrawal semantics or supported RMD/tax scope. The issue owner then enumerates exact producer reverse callers, test fixtures and compatibility readers, freezes types and `ALLOWED_PATHS`, and validates the future V3 issue. #348 must independently merge before the overlapping #350 production writer; #331 is not blocked by #350. Final D2 #149 closeout remains gated on #350's supported implementation, CI and independent semantic/performance/replay audit.

## References

- [#350 — dedicated retirement publisher protocol and proportional RMD scaling](https://github.com/bensmullen/personal-finance-app/issues/350)
- [#348 — separated combined-household source-history prerequisite](https://github.com/bensmullen/personal-finance-app/issues/348)
- [#348 counterexample and previous closure audit](https://github.com/bensmullen/personal-finance-app/issues/348#issuecomment-6969048265)
- [#331 — two-person S8-5A witness](https://github.com/bensmullen/personal-finance-app/issues/331)
- [Deterministic household semantics §5.4](../../specs/capabilities/deterministic-household-financial-semantics.md)
- [Performance and execution §§PFA-PERF-018/019/021](../../specs/capabilities/performance-and-execution.md)
- [ADR-008](ADR-008-identity-and-idempotency-model.md), [ADR-011](ADR-011-portable-model-versioning-and-compatibility.md), [ADR-021](ADR-021-semantic-settlement-funding-and-accounting-authority-boundary.md)
