# Issue #348: outward-boundary WIP and reference scope gap

## Current repair checkpoint

This checkpoint adds final original-source observation to standalone and
reference VS4, the generic scenario comparison, and application comparison
release. It associates committed source history with the immutable replay
basis, removes duplicate warm restore admissions, separates portable export
from cold-restore publisher counts, and checks custom callback payloads.
Cold restore reconstructs configured source history for the admitted adapters.

The new tests describe the standalone and comparison withdrawal cases, custom
and evidence-worker callbacks, one funded retirement/J1 occurrence, and the
HELOC-specific 1/12/24 source-byte and exact-cent checks. The local bounded
verifier was skipped because Node was unavailable. The combined five-family
1/12/24 independent oracle, complete publisher-byte and history-work census,
and remaining application and replay negatives are open. Treat the new tests
and production changes as unverified until GitHub runs them.

## Earlier checkpoint at `82ec56cb`

This is an incomplete checkpoint, not acceptance evidence or a merge-ready
implementation. The monthly history optimization, combined 1/12/24 source-byte
oracle, full HELOC cross-document admission, occurrence-complete cold replay,
and complete callback coverage have not been implemented. Existing financial
expectations have not been changed.

## Confirmed additional source-bearing owner

`src/simulation/r3/referenceVerticalSlice4.ts` exports a standalone
`runVerticalSlice4`, independently of `referenceHouseholdExecution.ts`.
`test/d2/integrated/fixedLoanOriginalBridge/service.test.ts` imports it as
`referenceVs4` and calls it with genuine lender/BANK originals for mortgage,
auto and student service, required/extra payments, and failed-February prefix
return. This is an existing supported reference evaluator, not a hypothetical
new consumer.

Its `runVerticalSlice4Internal` owns both the successful and ValidationError
incomplete exits. `finish` merely freezes/returns the body. On the incomplete
exit, the last lender query can be the unavailable February original; there is
no subsequent January source observation before returning January state.
The exported standalone wrapper calls this internal function directly and does
not pass through the authorized household reference wrapper.

The independent source in `referenceExit.test.ts` exposes exactly this case:
January is funded by $1 from $100 BANK against $2 principal. February's lender
read withdraws January and reports February unavailable. A qualified January
prefix is now forbidden by ADR-023's full/incomplete outward boundary. The
positive control keeps January available and expects $99 BANK/$1 principal.
No result state, hash or receipt authors either original.

The new negative test is an unexecuted regression specification. The bounded
verifier was SKIP because Node is unavailable; there is no recorded assertion
FAIL or PASS. Static control-flow inspection establishes the missing read.

Required issue amendment: add the exact product path
`src/simulation/r3/referenceVerticalSlice4.ts`. Keep its formulas independent.
The final admission belongs at its standalone outward exits; blindly adding
whole-history admission to every internal one-operation reference invocation
would introduce multiplying history work. Do not redirect this evaluator to
production formulas, edit it under the existing grant, or substitute global
publisher-read caches for the missing lifecycle boundary.

## Reachable sibling disposition

| Owner or route | Disposition |
| --- | --- |
| `src/state/index.ts` | Authorized canonical accounting/proof validation and shared source observation; WIP helper added. |
| `src/simulation/householdExecution.ts` | Authorized production summary/detail, private retention, public replay/checkpoint and custom callback owner. Final-return checks partly added; per-callback and indexed preparation work remains. |
| `src/simulation/verticalSlice4.ts` | Authorized standalone production evaluator; full/incomplete admission still needed. |
| `src/simulation/r3/referenceHouseholdExecution.ts` | Authorized independent household reference; directly calls frozen VS4 prepared operations. Its wrapper cannot guard direct standalone reference calls. |
| `src/simulation/r3/referenceVerticalSlice4.ts` | **Confirmed missing authorization:** existing source-bearing standalone reference outward exits. |
| `src/simulation/d2/integration/fixedLoanOriginalBridge/source.ts` | Authorized independent lender reconstruction and state posting authority. A point-read function lacks the caller's final-return lifecycle; rescanning all prior originals on every read is not the proportional solution. |
| `src/simulation/d2/integration/fixedLoanOriginalBridge/posting.ts`, `bank.ts`, `observation.ts` | Read-only existing selected canonical journal/BANK permission and query observation ports. Preserve their semantics; no confirmed mutation required here. |
| FSA/card/SSA/HELOC integration `index.ts` files in the grant | Authorized preparation, selected writer orchestration and history checks; optimization not yet implemented. |
| HELOC `source.ts` and B1 `phaseServicing.ts` | Read-only publisher formats/formulas. Keep cumulative issuer history; do not change protocol to evade cost. |
| Retirement `index.ts`, `source.ts`, `satisfaction.ts` | Read-only supported funded/J1 witness and account/year reconciliation. Recurring scalability belongs to #350. Callback ownership must not be inferred from a user-supplied participant ID. |
| `src/simulation/r3/replayArtifact.ts` | Authorized warm/cold admission, sparse/terminal reconstruction, portable export callbacks; WIP post-observer checks added. Complete independent occurrence reconciliation remains. |
| `src/application/householdProjection.ts` | Authorized read-model/artifact creation and buffered sink owner; WIP final source checks and original artifact admissions added. Comparison final exits remain to be completed. |
| `src/application/interactiveForecast.ts` | Authorized baseline/comparison packaging and caller clock owner; WIP final packaging check added. |
| `src/application/mortgageChartData.ts`, `monthlyMoney.ts` | Authorized warm/cold derived evidence and phase callback owners; WIP checks added after cache/qualification callbacks. |
| `ui/forecast/execute.ts` | Authorized evidence-worker progress and final clock owner; WIP post-progress/timing check added. |
| `ui/forecast/household.worker.ts`, `protocol.ts` | Read-only transport; no jointly atomic postMessage/delivery guarantee. |
| `src/simulation/scenario.ts` | Read-only generic standalone comparison calls production VS4, then retains baseline while executing alternatives. Whether direct original-backed standalone comparisons are in this release contract needs reviewer disposition; application comparisons have their own authorized owner. Do not silently claim this route is qualified. |
| `src/application/personalMvp.ts` | Read-only standalone application caller and generic comparison caller; canonical compiler-generated modeling path. No source-qualified application release change is established here by this audit. |
| `src/simulation/index.ts`, `src/verticalSlice4.ts` | Read-only reexports, no independent writer or observation lifecycle. |
| `src/lineage/index.ts` | Read-only replay anchor delegation; actual financial replay remains owned by core/application. |
| `test/d2/integrated/fixedLoanOriginalBridge/service.test.ts`, `scenario.ts`, `lenderOriginals.test.ts` | Read-only existing source/reference tests and independent publisher fixtures. New regression is contained in the authorized test subtree. |
| `test/r3HighThroughputKernel.test.ts` | Read-only standalone-reference imports and independent equivalence/scaling checks; do not weaken them. |
| `test/d2/integrated/jointHousehold/helocS8/**`, funded/combined scenarios | Read-only documentary fixtures and combined/replay witnesses; not complete 24-event native-original oracles for this task. |
| `tools/ci/forecast-feasibility.mjs` | Read-only protected manual probe; framework-owned changes require a separate framework grant. Not executed. |
| `benchmarks/r3/captureKernel.ts`, `benchmarks/r3/README.md` | Read-only benchmark consumers; no local capture or benchmark run authorized. |
| `e2e/personal-mvp.spec.ts` | Read-only application/worker consumer; no local E2E execution authorized. |

This is a static caller and exit audit, not proof that every future runtime or
provider blocker is eliminated. Before reauthorization, the reviewer must
reconcile the original issue's complete reachable contract, resolve the generic
standalone comparison disposition, parser-validate the saved live grant, and
verify branch/receipt readiness. No protected tooling or prior receipt changes
are authorized by this checkpoint.
