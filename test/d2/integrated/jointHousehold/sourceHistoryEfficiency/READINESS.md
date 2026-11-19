# Issue #348: outward-boundary WIP and reference scope gap

## Current 27-path repair: implementation WIP and protected-test conflict

This continuation implements factory-private WeakSet ownership for Medicare,
aftertax premiums, all three retirement factories (including their v1 children),
and HELOC draws. FSA/card/HELOC servicing register their existing ownership
predicates through the bounded state composition ports. Household execution
consumes that inward port instead of importing those three integration factories;
the three reported reverse value-import edges are removed. Clones and matching
IDs/codecs do not pass the actual installed predicates. Duplicate/unknown owner
registration is rejected. These ports, like the existing source-authority ports,
are composition-root registration, not a caller callback or publisher credential.

FSA now constructs the branded household/person scope with `domainId` at its
plan-history lookup, without an authority cast. Outward state observation and
portable replay now require an independently qualified retirement original even
for the supported person-owned funded distribution. Structural retirement
validation retains its legacy default; outward observation explicitly requests
the stronger check. No retirement evaluator, publisher protocol, tax law or
HELOC issuer format changed. New ownership tests cover original versus cloned
objects, direct/restored guards and retirement v1/v2/v3, and rejected predicate
replacement. The funded release test also covers a forged callback withdrawing
its original without mutating the committed opening state.

Verification: the sole requested bounded verifier was rejected by the repository
hook with `SKIP bounded preflight: node unavailable; no installation required`.
There is no executed PASS or FAIL. A request to read the previously completed CI
failure log was also denied by the publication-only GitHub CLI hook; no CI
polling, installation or alternate verification was performed.

### Confirmed contract conflict; do not waive source admission

The strict supported-funded release requirement conflicts with protected existing
acceptance expectations, not just a source-read counter. The exact same funded
v1 distribution is expected both to fail on source withdrawal at an outward
boundary (#348) and to remain exportable/restorable/replayable after withdrawal
in existing tests. The 27-path grant permits none of these legacy migrations:

| Exact path | Confirmed disposition |
| --- | --- |
| `test/d2/integrated/retirementCash/funded.test.ts` | Lines 241–261 require fresh-process success for absent/tampered publishers and export+restore+replay after `sources.delete`. This directly conflicts with final independent observation, including the one-funded/J1 witness; no recurring-retirement protocol is involved. Reviewer-approved bounded migration is required, or an explicit different archived-only release contract. |
| `test/d2/integrated/retirementCash/portableWorker.ts` | Lines 23–44 intentionally remove/amend the publisher, then restore/replay without a supported rejection branch. Migrate together with its launcher; keep independent reconstruction and exact positive cash/J1 checks. |
| `test/d2/integrated/jointHousehold/fundedReplay.test.ts` | Lines 108–115 require restored original cash on absent/tampered funded source. Same source-observation contradiction in the combined wage/FSA/card/fixed-loan route. |
| `test/d2/integrated/jointHousehold/fundedPortableWorker.ts` | Lines 19–37 remove/amend the funded original but catch restore failure only for wage-source negatives. Migrate supported rejection alongside the launcher, without weakening the positive independently authored journal. |
| `test/d2/integrated/retirementJournal/replay.test.ts` | Lines 91–101 require identical replay cash when a real journal exists but the source owner is unavailable in the child. Needs explicit legacy-structural disposition; a blanket exception in the shared outward observer would undermine #348. |
| `test/d2/integrated/retirementJournal/portableWorker.ts` | Conditionally registers the authority only when `sources` is true, then restores/replays unconditionally. Reconcile with the structural test above. |

### Reachable sibling closure for this conflict

| Route | Disposition |
| --- | --- |
| `state/index.ts` accounting writer and structural validation | Authorized. Selected funding, journal/idempotency and source checks stay intact. Structural validation alone still does not claim observed publisher validity. |
| Retirement `index.ts` v1/v2/v3 and child participants | Ownership changes only, within narrow authorization. Their original source and J1 calculations are unchanged. |
| Retirement `source.ts`, `satisfaction.ts` | Read-only independent raw original and J1 qualification. Their existing missing/tampered outcomes already explain the protected worker expectations; no protocol change is needed to establish the conflict. |
| `householdExecution.ts` summary/detail/custom callbacks/opening/resume/replay/checkpoints/final result | Authorized shared outward admission. Suppressing retirement qualification here would leak the very funded result that the new observer negative must reject. |
| `r3/replayArtifact.ts` warm/cold/terminal/export | Authorized, shares the strict retirement observation at release. Missing publisher must not be promoted from a receipt or matching closing cash. No fresh-process runtime cause was measured locally. |
| `retirementCash/compactReference.test.ts`, `jointHousehold/funded.test.ts` | Read-only. Their post-withdrawal assertions inspect already-returned immutable historical state and incomplete J1, rather than newly releasing a source-qualified replay. Preserve these assertions; no confirmed migration needed. |
| `householdBankRetirementMedicare/settlement.test.ts` | Read-only native sibling explicitly requires child rejection without sources (225–231), consistent with strict release; retain read/time bounds and native ownership/BANK checks. |
| FSA/card/SSA/HELOC and fixed-loan source/index/posting routes | Existing authorized/read-only split remains as recorded below. The retirement conflict supplies no exemption from their selected original/BANK or final history checks. |
| Standalone production/reference VS4, household reference and `scenario.ts` | Authorized release owners; keep independent formulas and failed-period prefix qualification. No retirement-specific rewrite is justified. |
| Application projection/comparison, evidence readers and `ui/forecast/execute.ts` | Authorized callers of the same history admission. They cannot safely turn a newly withdrawn original into success after sink, phase, progress or clock callbacks. |
| Worker protocol/postMessage, manual CI tools, benchmarks and E2E | Read-only transport/consumers; no new source ownership or atomic delivery guarantee. No additional confirmed mutation path for this retirement conflict. |

This is a static second-pass disposition, not a claim of zero future blockers.
Remaining original acceptance work includes the independent combined five-family
1/12/24 exact-cent/read/returned-and-validated-byte/history-work oracle, actual
selected CI/type/build/architecture/unit results, true child-worker replay causes,
and the complete application/callback negative matrix. The patch is WIP and must
not be treated as acceptance complete. Reconcile all six protected legacy paths
in the same issue (or explicitly define a distinct archived-only boundary) before
another implementation grant; do not weaken source qualification to make the old
success expectations green.

## November 18 continuation: callback ownership blocker

Started at clean/upstream-synchronized head
`1c8f2d1c2a14d1c718cd6dbe3dd22b4c5e9a3996` under the live 23-path
grant. This is static evidence, not implementation acceptance. All six current
issue failure classes remain unresolved; no local verification was run.

### Confirmed multiplying path

`householdExecution.ts:417` recognizes only FSA, card, HELOC servicing and SSA
factory ownership. Every other participant enters `externalParticipants`.
Before its prepare (508), operation execute (528), and every observe (678),
the kernel reads the complete committed source history. Line 678 is inside
both the operation loop and the loop over all observing participants, including
participants with no active operations. Arbitrary custom callbacks can withdraw
publishers, so their payload admissions cannot simply be removed or cached.

`householdBankRetirementMedicare/settlement.test.ts:263` attaches one Medicare
guard per month and requires at most `months * 32` expense publisher reads for
1/12/24 actual months. At 24 months all 24 guards receive every observation,
each preceded by a growing historical admission. This establishes an avoidable
multiplying path consistent with the reported 7,404-read CI failure; no new
runtime count was measured here.

The private `medicareBank/sourceGuard` factory creates its callbacks at line
162 without any object-identity ownership predicate. Codec registration only
stores restore factories; immutable configuration only freezes data. Neither
authenticates directly created callbacks. IDs, versions, codec strings and
economic inputs are reproducible by custom participants. Replacing caller
callbacks with reconstructed ones would change the public participant contract.

### Second-pass path disposition

| Path / route | Disposition and evidence |
| --- | --- |
| `src/simulation/d2/integration/medicareBank/index.ts` | **Additional scope required:** private `sourceGuard` prepare/execute/observe at 162 and codec restore at 196 need genuine factory ownership registration. Direct `attachMedicareBank` and restored objects must agree. Preserve premium/BANK source checks, overlap and legacy direct-person behavior. |
| `src/simulation/d2/integration/aftertaxPremiums/index.ts` | **Additional scope required:** private `premiumGuard` at 167 has prepare/observe; codec restore at 216 shares it. Joint-household and householdBankCardAftertax scenarios attach it. Empty-operation prepare still leaves an observer receiving canonical payroll proofs/context. Preserve premium/payroll overlap and no-election branches. |
| `src/simulation/d2/integration/retirementCash/index.ts` | **Additional narrow scope required:** inline v1, schedule v2 and referenced v3 factories create prepare/execute/observe without ownership predicates. Direct attach and all three codec restores must register actual objects. Factory ownership only; recurring original protocol/scalability remains #350. |
| `src/simulation/d2/integration/helocDraws/index.ts` | **Additional narrow scope required:** `createHelocDrawParticipant` at 96 and codec restore at 218 lack ownership registration. `jointHousehold/helocS8/scenario.ts:83` installs it in the known replay sibling. Preserve draw economics/source semantics; a codec string is not callback ownership. |
| `src/state/index.ts` | Authorized inward registration/attempt seam and structural indexes. Callback ownership grants no publisher authority; retain final independent reads and canonical journal validation. |
| `src/simulation/householdExecution.ts` | Authorized summary/detail, speculation/rollback, resume, external callback payloads and final release. Consume genuine ownership; keep custom callbacks external. Remove reported value-import cycles via an inward seam. |
| FSA/card/SSA/HELOC servicing `index.ts` | Authorized. Existing WeakSets/SSA predicate establish genuine ownership for these families. Keep current selected issuer/BANK checks, standalone admission and HELOC historical continuity. FSA's raw identity argument remains a branded-binding defect; no authority cast is justified. |
| `src/simulation/r3/participantCodec.ts`, `compiledHousehold.ts` | Read-only. Inspected registry and snapshot construction; neither authenticates directly created callbacks. No edit needed here if factories register through state. |
| `src/simulation/r3/replayArtifact.ts` | Authorized cold/warm/checkpoint/terminal/export admission and callbacks. Factory ownership must cover restored objects. The v3 wrapper retains `cause`, but this static audit has **not** established the child-worker inner exception. No source-auth exception is justified. |
| Production/reference VS4, reference household, `scenario.ts` | Authorized complete/incomplete and comparison exits. Preserve independent formulas, required/extra funding, opening-source and failed-prefix checks. Do not claim frozen-reference extension-participant parity. |
| Fixed-loan bridge `source.ts` | Authorized lender reconstruction; BANK/posting/observation ports stay read-only. No additional missing context producer was confirmed in this delta audit. |
| `householdProjection.ts`, `interactiveForecast.ts` | Authorized read-model/artifact creation, buffered sink, comparison, clock and worker baseline release. No additional application owner was established. |
| `mortgageChartData.ts`, `monthlyMoney.ts`, `ui/forecast/execute.ts` | Authorized cached replay/qualification, projected progress, final clock and evidence release. Internal ownership optimization must retain these outward admissions. |
| `ui/forecast/household.worker.ts`, `protocol.ts` | Read-only transport; no jointly atomic physical-delivery guarantee. |
| Retirement `source.ts`/`satisfaction.ts`; HELOC servicing `source.ts`/B1 `phaseServicing.ts` | Read-only. Original protocols/formulas are not the ownership fix. Keep single funded/J1 evidence, incomplete tax and intrinsic HELOC 66/276 historical rows separate from avoidable rereads. |
| Existing portable workers and combined/funded/retirement replay tests | Read-only independent source and 13/25-month witnesses. `combinedScenario.ts` also has a genuinely custom structural J1 participant; it must remain external. |
| `sourceHistoryEfficiency/**`, five individually authorized legacy tests | Authorized evidence. Five-family 1/12/24 oracle and full source/callback negatives remain missing. Legacy migration stays within the existing narrow limits. |
| `tools/ci/`, benchmarks, E2E | Read-only. Targeted constructor searches found no additional direct ownership-producing calls here. No probes, benchmark, build, test, validator or CI polling was run. |

### Reviewer handoff

Reconcile the four confirmed factory paths together in the SAME issue #348
before reauthorization. This proposes a Level-1 implementation path amendment,
not permission to edit those files now. Preserve PR #357, branch, receipts,
all source/financial/replay requirements and read/time bounds. No framework,
manifest, milestone or financial-specification change is requested.

Residual unknowns include the actual child-worker replay cause. Remaining
known work includes funded/J1 post-observer withdrawal rejection, all CI failure
classes, the combined five-family oracle and full callback/source negatives.
Legacy portable cash when a retirement publisher is absent must be reconciled
with the supported funded-source release branch, without blanket exceptions.
This scope proposal alone does not prove full acceptance closure.

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
