# Post-PR21 Implementation Roadmap

**Version:** 0.6.25-draft
**Status:** Controlled implementation plan
**Requirement policy:** none

## 1. Purpose

This roadmap controls stabilization, forecasting, and the foundations of financial-planning/decision support after PR21. R11 is the gate before private-alpha infrastructure; explicitly identified planning/optimization tracks may continue beyond that gate. Milestone IDs are planning identities; GitHub PR numbers may differ.

The sequence intentionally measures and improves the current deterministic path before multiplying it through stochastic simulation or strategy search. Calibration, onboarding, and deterministic planning foundations may develop in parallel where their boundaries are isolated, but stochastic household runtime implementation does not begin until the D1 and D2 deterministic gates are complete. User-facing outputs remain capability-gated until their required tax, investment, insurance, calibration, and other semantics are ready.

The long-term architecture is a comprehensive financial-planning system, not only a forecast viewer. Forecasting remains the authoritative evaluation engine; planning layers define decisions, goals, constraints, candidate strategies, and comparisons without duplicating financial formulas.

A routine stochastic forecast or strategy evaluation is a budgeted computation product. Accuracy/convergence and compute cost are joint requirements. The implementation SHALL preserve local execution where it is efficient enough and SHALL remain portable to server/cloud workers when local execution cannot meet latency, memory, device, or product-service constraints. Routine forecasts or planning reruns that require multi-dollar cloud compute per user action are not an acceptable steady-state design; exact budgets are established from measured R1/R6/planning data.

### Parallel engineering framework reliability gate

**Urgent compatibility repair — Issue [#231](https://github.com/bensmullen/personal-finance-app/issues/231):** After framework #218's bounded preflight, the Mac Python 3.8 `PreToolUse` hook failed before it could authorize an optional check and the Codex session discarded unfinished work. #231 corrects the older-Python path operations, tests the hook on Python 3.8, and requires non-destructive BLOCKED work checkpoints. Its independent PR #232 must pass framework checks and merge before Codex resumes the affected #181 implementation; it is a *tooling prerequisite only*, not U1/D1/D2 financial functionality.


**FRAMEWORK_RELIABILITY — Issue [#218](https://github.com/bensmullen/personal-finance-app/issues/218):** The product manager approved bounded optional local type/unit preflight, early source-backed scaling feasibility checks, and inexpensive static/type/build gating before four-way browser E2E. The same independent framework task investigates the shared worktree latest-task receipt ambiguity without weakening single-writer/scope protections. #218 must pass its own tooling, CI and hook self-tests before its framework implementation is accepted; it does **not** block U1B #181 or any D1/D2/R11 economic product gate. Framework-control paths remain separate from implementation PRs.

**Closed-task recovery reliability — Issue [#249](https://github.com/bensmullen/personal-finance-app/issues/249):** After #218/#231, harden the Codex hook to refuse reauthorization in a previously closed session *before* changing its receipt, bound transient per-worktree hook lock contention without weakening fail-closed safeguards, and make bootstrap's exact Codex worktree path conspicuous. This is a separate test-backed framework reliability gate, not a D2-A #146 implementation prerequisite. Registration is staged in PR #250; implementation requires its merge and independent CI/semantic audit.

**Circular live-gate resolution for #249 and #252 (2026-10-26):** The live issue-stage watcher checks **all** current open product/framework issues on every governance PR. Framework registration PR #250 therefore records both its owned [#249](https://github.com/bensmullen/personal-finance-app/issues/249) and the already-approved chart [#252](https://github.com/bensmullen/personal-finance-app/issues/252) under the existing U1B_E stage. #252 follows #240 ribbon merge/PM visual UAT and precedes #187 Planning; its full design/UX ownership and companion planning documentation remain in [PR #253](https://github.com/bensmullen/personal-finance-app/pull/253), which must synchronize and deduplicate the registry after #250 merges. This is traceability registration, **not implementation authorization**; #249 Codex work still waits for #250 merge, and #252 Codex waits for #240 and #253.

### Independent CI-efficiency optimization gate

**CI_OPTIMIZATION — Issue [#224](https://github.com/bensmullen/personal-finance-app/issues/224):** PM-approved framework-only three-way parallel unit verification and four deterministic duration-balanced E2E shards, with exact inventory/no-duplicate proof, timeout diagnostics and unchanged fail-closed aggregate `test` and deployment requirements. Acceptance requires its own green CI, audited before/after wall-clock and runner-minute evidence, and preservation of every required financial/649-month browser assertion. This framework improvement neither fixes nor weakens the separate #181/PR #207 full-horizon performance acceptance and does not block D1/U1/D2/R11 product execution. Merge this registration PR before Codex bootstrap for #224.

## 2. Dependency sequence

~~~text
R0  Specification decomposition and traceability  [complete]
 |
R1  Performance instrumentation + benchmark fixtures
 |
R2  Interactive deterministic execution foundation
 | \
 |  +--> R4 UX/editor cleanup
 |        \
 |         +--> O1 foundation work (candidate/import boundary only)
 |
 +--> R3 High-throughput deterministic kernel
      | \
      |  +--> C1 Provider-neutral calibration contract
      |       \
      |        +--> R8 provider-adapter work when C1 is stable
      |
      +--> T1A Phase B household tax integration <--- T1A Phase A
                |
                +----> D1 Deterministic financial semantics <--- R4
                       |   + D1-A authoring/account semantics (Issue #70)
                       |   + D1-B remaining deterministic domain mechanics
                       |   + D1-C combined truth-table + semantic audit (#80)
                       |                  |
                       |                  v
                       |              U1 Guided financial UX (#120)
                       |                  |
                       |                  v
                       |            D1 gate: uncoached UAT accepted
                       |
                       +--> P1 Deterministic planning/strategy foundation
                       |
                       +--> O1 authoritative-model/editor integration
                       |
                       +--> A1 concentration safeguard implementation
                       |
                       +--> D2-A/B/C backend in parallel with U1
                              |  (from merged D1-C + approved contracts;
                              |   D2-D owns shared seams and final U1 handshake)
                              |
                              +--> D2-D + accepted D1/U1 --> R5 <---- C1
                                   |
                                   v
                                R6 Monte Carlo orchestration
                                   |
                                   v
                                R7 Baseline probabilistic household engine
                                   | \
                                   |  +--> P2 Stochastic strategy evaluation /
                                   |       progressive optimization
                                   |
                                   +--> R10 Probabilistic + planning decision UX

D1 (including U1) + D2 + O1 + P1 + T1A target-cohort coverage +
T1B private-alpha tax floor + A1
                         |
                         v
              R11 Private-alpha readiness /
                  stabilization-exit gate

P3  Integrated cross-domain optimization (tax + portfolio + insurance +
    retirement/debt/liquidity as supported) follows P1 and the applicable
    domain capabilities; stochastic automated optimization additionally
    requires P2. It is not a blanket private-alpha prerequisite.

R9  Full issuer/RSU/employer-risk stochastic modeling is conditional
    before private alpha: required if the target cohort needs it; otherwise
    it remains an explicit tracked post-alpha capability.

T1B Advanced/specialized tax domains progress with the capabilities that need
    them. PFA-TAX-016 (wash sale, capital-loss carryforward, tax-loss
    harvesting, and bounded 1031 exchange) is mandatory before private alpha;
    other T1B domains gate only affected outputs unless the cohort requires them.
~~~

### 2.1 Parallel-development coordination contract

Parallel work is allowed only across stable ownership boundaries. The purpose of parallelization is to shorten calendar time without creating sibling branches that redefine the same financial meaning or require manual reconciliation of competing implementations.

The following coordination rules apply to every parallel wave:

- **Merged-main is the integration authority.** Parallel lanes SHALL start from a common merged prerequisite base. A sibling feature branch SHALL NOT become an undeclared dependency of another sibling branch. When one lane changes a public contract needed by another, the dependent lane pauses at that boundary, rebases after the owning change merges, and then continues.
- **One owner for each shared semantic hotspot.** Existing cross-cutting compiler/execution/editor surfaces SHALL have one active implementation owner at a time. Other lanes either consume the merged public contract or restrict themselves to isolated modules, fixtures, adapters, and tests. A second lane SHALL NOT add compatibility shims or duplicate formulas merely to avoid waiting for the owner.
- **Interface changes synchronize before implementation continues.** If parallel work discovers that a frozen boundary is insufficient, use a small dedicated synchronization/specification change first, merge it, and rebase every affected lane. Do not let two branches independently evolve the same interface.
- **Parallel branches may add isolated modules freely, not competing integration paths.** New calibration adapters, import parsers, stochastic process modules, or domain rule modules can develop concurrently when they consume stable contracts. Shared household compilation, execution ordering, authoritative state mutation, funding, tax settlement, and normal-user editor semantics remain single-owner integration surfaces.
- **Every dependent wave starts from audited merged state.** Before a milestone that consumes multiple parallel lanes begins, the prerequisite lanes must be merged, ordinary CI green, and the merged result semantically audited. Green sibling PRs are not equivalent to an audited integrated main branch.

For the currently planned lanes, ownership is:

| Lane | Safe parallel scope | Shared integration boundary |
| --- | --- | --- |
| T1A Phase B | Household tax integration after R3 + Phase A | Owns tax household execution until merged; D1 does not start against an unmerged T1A-B branch |
| D1-C | Original PFA-DET-001–014 financial/combined-household semantics and verification | Owns integrated D1 financial semantics until PR #89 merges; merging the code does not constitute UAT acceptance |
| U1 (#120) | After merged D1-C: visual authoring, charts and diagnostics for existing D1 facts | Sole writer of active `ui/**`, `app/**`, shared editor surfaces and tests; release/freeze a specific UI/read-model seam before D2-D integrates it, without requiring full U1 UAT for other D2 work |
| D2-PREP (#114, merged PR #116) | Complete: 55 synthetic mapping/fixture cases and bounded verification, **not** executable D2 breadth | Historical preparation baseline; do not rerun its V3 implementation or infer integrated D2 completion |
| D2-A #146 / B #147 / C #148 | After merged D1-C and approved *consumed* domain contracts, build disjoint D2 backend/domain implementations **concurrently with U1**, using frozen public interfaces and dedicated test paths | No sibling writes to U1-owned UI/application files, shared compiler/ledger/tax/settlement or to each other's public contracts; a domain change must synchronize through D2-D |
| D2-D #149 | Early shared-contract synchronization may overlap U1 and D2 domain work; later serial integration, combined truth table, UI handshake and final D2 signoff | One shared integration writer for canonical/execution/payroll/settlement/read models; defer only occupied U1 editor paths, then require accepted U1 #120 for final integrated UAT/R5 gate |
| C1 | Normalized calibration contract, immutable fingerprints, synthetic calibration | Must not change household financial semantics or stochastic runtime behavior; safe alongside T1A-B/D1 |
| O1 | During D1: candidate/import schemas, parsers, provenance, idempotency, telemetry, synthetic fixtures | Authoritative model mutation and shared editor/compiler integration wait for D1 merge |
| P1 | Planning-owned orchestration and decision/strategy configuration | Starts after D1; consumes the merged decision-overlay/execution boundary and does not change financial formulas |
| A1 | Before D1 merge: analysis/spec/fixtures only | Executable concentration classification/compiler/UI integration starts after D1 because it shares investment/read-model semantics |
| R5/R6 | Stochastic runtime/orchestration only after D2 + C1 | Own stochastic stream/run/orchestration contracts; D1+D2 deterministic semantics are frozen inputs |
| R7 | After R5/R6 contracts are stable, disjoint stochastic process modules may proceed in parallel | Correlation model, shared process identities, aggregation contracts, and orchestration remain single-owner synchronization surfaces |
| R8 | Provider adapters against the merged C1 boundary | Adapter work may proceed independently; it must not redefine CalibrationSet or silently change user-facing forecast assumptions |
| T1B | Isolated effective-dated rule/catalog work may proceed with consuming capabilities; PFA-TAX-016 is mandatory before R11 | Household/execution integration waits for the consuming domain's stable boundary or uses a dedicated synchronization change |

**D2 physical integration wave (2026-10-19; new explicit D2 gate entries):** The consolidated D2-D owner #149 delegates two **bounded, nonoverlapping physical adapters**: [#202](https://github.com/bensmullen/personal-finance-app/issues/202) source-qualified paired FSA medical-expense/BANK reimbursement (source-only FSA [PR #199](https://github.com/bensmullen/personal-finance-app/pull/199) merged) and [#203](https://github.com/bensmullen/personal-finance-app/issues/203) issuer-quoted card interest/BANK service (only AFTER [PR #200](https://github.com/bensmullen/personal-finance-app/pull/200) merges on green latest-head CI). Their new `src/simulation/d2/integration/{fsaCash,cardBank}/**` adapters and dedicated tests are disjoint, but both MUST fail closed on unsupported shared state/claim identity and may not alter #101 tax/payroll, shared `src/state/**`, `src/simulation/r3/**` or occupied U1 editors. New task issue/CI-gate registrations in `docs/development/milestone-issue-register.json` must merge **before Codex bootstrap**. Parent #149 remains the exclusive shared engine/physical integration owner and final D2 closeout.

**RMD source-authenticated persistence ([#204](https://github.com/bensmullen/personal-finance-app/issues/204)) is a separate architecture gate, not a Codex authorization:** cash-only [PR #201](https://github.com/bensmullen/personal-finance-app/pull/201) must merge; [proposed versioned retirement journal design](../../development/d2-prep/rmd-transaction-allocation-journal-design.md) requires explicit PM approval before J1 shared state/replay foundation and J2 actual cash-integrated RMD allocation. Until then `postedTransactionIds` cannot prove exact gross/annual allocation and `rmdSatisfaction` stays incomplete. These small backend slices do not replace B2 TIPS/EE, B3 529, remaining A/health/debt source and settlement integration, PFA-TAX-015, combined S1–S8 truth-table, or #120 U1 accepted UAT; R5 is still blocked.

This coordination contract controls implementation sequencing only. It does not move financial authority out of the canonical schema, executable financial semantics, or capability specifications.

**2026-10-26 PM-approved U1B refinement (CURRENT for ribbon/chart implementation):** #171 Cash is closed. Complete [#240](https://github.com/bensmullen/personal-finance-app/issues/240) / PR #241 final 2× vertically centered desktop Settings gear and single-line 390px mobile ribbon with icon-only Settings, then [#252](https://github.com/bensmullen/personal-finance-app/issues/252) shared chart presentation (local Chart Details, compact visible-series crosshair, Period label, no line dots, Cash Balance/Change names, truthful discretionary-money coverage), then [#187](https://github.com/bensmullen/personal-finance-app/issues/187) Planning V6 and remaining chart outcomes, then [#120](https://github.com/bensmullen/personal-finance-app/issues/120) final U1B owner UAT. This newer sequence supersedes historical #171→#187 references below. #252 is registered at the first mandatory U1B_E gate and must not start until #240 merged. #249 framework registration is independently owned by existing [PR #250](https://github.com/bensmullen/personal-finance-app/pull/250); do not duplicate those edits here.

**2026-10-30 PM-approved U1B lifetime UX design governance (merged PR #282):** The [five-stage workflow](../../alpha/u1b-five-stage-design-gate.md) is the mandatory substantial-UI progression: comprehensive user-goal/journey inventory and capability mapping → PM-reviewed one-journey-at-a-time visual contract covering hierarchy/density/typography/layout/language/navigation/states/responsiveness at 1440×900 and 390×844 → bounded V3 Codex implementation → independent exact-head real-render visual/semantic QA → uncoached PM UAT. Existing [#187/PR #269](https://github.com/bensmullen/personal-finance-app/pull/269) is a source-bounded technical checkpoint, NOT final UX approval. Parent [#120](https://github.com/bensmullen/personal-finance-app/issues/120) remains OPEN and exclusively owns final integrated D1 + supported D2 normal-user UI/forecast acceptance. [#149](https://github.com/bensmullen/personal-finance-app/issues/149) continues to own D2 shared source/funding/tax/replay/read-model integration and its independent deterministic closeout. The investment purchase/sale/transfer/withdrawal/tax architecture review reuses existing [#100](https://github.com/bensmullen/personal-finance-app/issues/100), [#146](https://github.com/bensmullen/personal-finance-app/issues/146) and #149; it grants no securities execution, new source capability or implementation authorization. Keep current approved seven-route UX contract until the PM explicitly approves a revised goal-based information architecture; existing implementation-stage dependencies remain unchanged. The 2026-10-26 ribbon/chart sequence above is historical task ordering where already completed, not authority to bypass this new design gate for further major UX changes.\n\n### 2.2 Issue-backed milestone and private-alpha gates

**Machine-readable issue-to-stage register:** `docs/development/milestone-issue-register.json` (maintained under `docs/development/milestone-issue-policy.md`). This register assigns each live non-learning product/bug/planning issue a stage owner, mandatory closeout gate, dependencies, and relevant controlled requirements. GitHub remains the live status authority; registration alone does not prove implementation. A new backlog issue cannot be silently left unassigned, and a mandatory stage issue cannot be deferred past its gate without an explicit controlled roadmap change and product-owner decision.

| First mandatory gate | Stage owner | Registered GitHub issue / disposition |
| --- | --- | --- |
| `D1_U1` — D1 completion | U1 UX and funding reconciliation | **#120** final U1/D1 owner-UAT gate, inheriting completed #94 and closed #99 |
| `U1B_B` — production V1–V3 | Merged chart selector/renderer stages | **#129/#136**, both completed in merged PRs #133/#139; no competing PM-UAT owner |
| `U1B_C` — Cash V4 | Cash task navigation and source-backed monthly income-use comparison | **#142**, completed in merged PR #157, owner #120 retains final UAT |
| `U1B_D` — Real Estate/Debt V5 | Actual paid mortgage split and owner-linked equity interpretation | **#161**, active only after D-stage registration PR merges; dependent shared-UI U1B-E remains serial |
| `U1B_UX` — Tax-law scenario completeness prerequisite | Explicit projected current law vs actual missing tax capability at output/run level | **#189** before #181; independent engine contract/CI audit and merge required, without changing #101 or #149 |
| `U1B_UX` — Payroll economic prerequisite | Source-bound gross paycheck → withholding credits + employee contributions → net cash, then incremental tax-year settlement | **#101 engine/authoring contract before #181**, independent CI/semantic audit and merge; #181 owns minimal existing Income UI integration; full tax workspace remains #102 after #120 |
| `U1B_UX` — Verified UI foundation and usable first run | Overview technical foundation, then **one rich flagship** with age-90 requested forecast, editable age-65 retirement proposal and low manual entry, then Cash financial insight parity | **#170 → #181 → #171 → #240** serial shared-UI merges; shared household/person/status ribbon #240 requires exact CI, independent semantic/visual review and PM visual UAT before #187; **final integrated PM UX signoff #120** after U1B-E |\n| `U1B_E` — chart polish then Planning/retirement insight | Existing chart-local details/concise hover/control behavior and Cash labels **#252**, followed by source-backed V6/retirement timeline and Investing/Debt insight **#187**; no false discretionary/net-income amounts | **#252 → #187** serially after #240 PM visual UAT/merge, with chart interaction source integrity and no duplicated long-horizon read-model payload; then integrated #120 owner UAT |
| `D2` — before stochastic R5 | D2 preparation | **#114** complete in merged PR #116; preparation only |
| `D2` — before stochastic R5 | D2-A retirement/benefits | **#146**, consolidating closed **#103** ordinary distributions and RMDs with all retirement and benefit breadth |
| `D2` — before stochastic R5 | D2-B debt/bonds/education | **#147** debt, TIPS/EE and 529; inter-domain Roth capacity handshake at #149 |
| `D2` — before stochastic R5 | D2-C healthcare | **#148** health coverage/Medicare/FSA; payroll/benefit handshake at #149 |
| `D2` — before stochastic R5 | D2-D shared integration/closeout | **#149** versioned S1–S8 interfaces, shared one-writer integration, deferred U1/D2 seams, combined truth table and final PM UAT |
| `R11` — before private alpha | Post-U1 investment activity | **#100** dividend reinvestment AND flexible IRA/brokerage contribution schedules (merged from closed #104) |
| `R11` — before private alpha | Tax/payroll release floor | **#101** remains mandatory through its earlier U1B_UX gate; full Taxes workspace remains #102 |
| `R11` — before private alpha | T1B pure federal rule foundation (not final integration) | **#138** four PFA-TAX-016 tax-rule families, closed and Codex-inaccessible pending PM contract approval/merge; downstream shared-authority integration remains mandatory |
| `R11` — before private alpha | Tax workspace | **#102** user-facing Federal/State/Local taxes, **after #101** |
| `R11` — before private alpha | P1 planning/plan management | **#105** independent plan duplication and comparison after safe scenario/identity semantics are confirmed |
| `R11` — before private alpha | O1 guided exploration | **#108** eight rich linked-family synthetic households, 4+ independently saved plans/persona, resettable demos, reconciled finances and capability-gated outputs |

**State reconciliation:** U1B-C #142/PR #157 completed; new U1B-D #161 owns V5 Real Estate/Debt pending its registration-PR merge, while U1/D1 PM final UAT #120 remains OPEN. D1-C code was merged in PR #89; D1/U1 owner acceptance **#120** is still pending (including inherited #99 mortgage funding). U1B-B #136/PR #139 and U1B-C #142/PR #157 completed; U1B-D #161 now owns the next shared UI implementation slice once its registration PR merges. Existing #103 was closed without verified distribution/RMD implementation, so **all its uncompleted requirements transfer to D2-A #146** and must be audited there; do not reopen #103 or claim it completed. D2-PREP #114/PR #116 is prep complete only. D2 backend may progress from approved contracts before #120 accepts UAT. Neither #100–#105 nor D2 issues authorize editing an actively U1-owned UI file; #105 independently owns plan cloning. D2-D #149 closes interface and U1 handshake gaps before R5.

The full R11 prerequisites in section 18 still apply: the register **adds tracking**, not exceptions to O1, P1, R5–R10, A1, tax-law, performance or user-validation requirements. A lightweight GitHub Action checks newly opened/reopened/edited issues (plus weekly and registry PR changes) against the stage register and fails on omissions. Before every milestone handoff, also fetch live open GitHub issues and reconcile the register; at closeout verify all required issue IDs and financial/UAT evidence. The action detects unregistered issues, not completed UAT or financial correctness. The nine historical implementation issues in the administrative queue require closure/reclassification after merged-PR review; they are not presumed unfinished product features. Agent-learning candidate issues use their separate candidate registry and do not belong to these product gates.

## 3. R1 — Performance instrumentation and baselines

Implement PFA-PERF-001 through PFA-PERF-004 and PFA-PERF-013 through PFA-PERF-018 foundations first.

Deliver:

- phase timers across application/engine/UI boundaries;
- a developer performance dashboard with latest/rolling measurements;
- three maintained synthetic fixture classes: Golden Household, realistic household forecast, and computationally complex/stress household;
- a lightweight coverage inventory for the realistic and complex fixtures showing which important canonical objects, primitives, rules, events, scenarios, and execution mechanics are exercised;
- repeatable benchmark capture;
- explicit attribution of engine, application/worker, serialization, React/chart, and explanation/render cost;
- baseline measurements before optimization;
- provider-neutral CPU/worker/memory/throughput accounting suitable for estimating local or cloud execution cost;
- cost-per-rerun measurement/estimation plumbing that can translate metered provider units into currency once a deployed provider exists;
- initial comparison of feasible local/browser execution versus server/cloud execution on representative devices;
- scaling-shape measurements that vary horizon and representative model/operation counts so later R3 work can distinguish fixed overhead from growth-rate problems.

Before R1 closeout, any engineering-reference baseline captured outside the repository-supported Node 22/npm 10 runtime SHALL be recaptured on the supported runtime before it is promoted to an approved budget or used as the authoritative R3 comparison baseline. Older measurements may remain labeled as reference-only evidence.

Do not set hard latency or currency-cost budgets until baseline data exists. After R1/R6 measurements exist, define explicit p50/p95 latency, convergence, memory, and per-run compute-cost budgets. Before private alpha, every enabled stochastic execution placement must have measured or defensible estimated marginal currency cost per rerun for the representative fixtures/quality levels, and metered paths must report representative/p50/p95 cost where sample volume permits.

If the realistic and/or computationally complex/stress household materially miss the approved local execution budgets on representative supported hardware, R1/R6 closeout SHALL explicitly review whether further local optimization, cloud/server execution, or a hybrid placement policy is appropriate. The review must include cost-per-rerun and privacy/operational tradeoffs; it must not assume cloud execution is automatically the answer.

**User validation:** not normally required. Objective timing and correctness are automated/engineering verification.

## 4. R2 — Interactive deterministic execution foundation

Deliver the highest-value UAT responsiveness fixes:

- fast reconciled current snapshot that does not run the full forecast;
- explicit forecast state machine: idle/running/stale/completed/incomplete/unsupported/error;
- Web Worker or equivalent off-main-thread long forecast execution;
- request identity and stale-response suppression;
- meaningful edit commit/debounce behavior rather than heavy work on each keystroke;
- automatic deterministic baseline forecast when valid execution configuration exists;
- in-memory deterministic result cache using an application-owned calculation fingerprint;
- lazy explanation resolution;
- bounded/virtualized/collapsed detailed tables;
- summary-first chart rendering.

Persistent derived caching may be added later behind a discardable/versioned cache boundary.

**User validation:** required at milestone closeout. Closeout instructions SHALL ask the user to verify current-state responsiveness, edit/recalculate behavior, running/stale/error states, and preservation of the last valid result while a replacement is executing.

## 5. R3 — High-throughput deterministic simulation kernel

R3 is a computational-architecture milestone, not ordinary cleanup. Use R1 measurements and scaling-shape data to transform the correctness-oriented reference execution path into the reusable simulation foundation for deterministic forecasts, stochastic realizations, and planning-candidate evaluation.

Use measurements to rank work. Likely candidates include:

- contention/linearization enumeration;
- repeated authoritative-state/primitive-state cloning;
- repeated filtering/sorting and object lookup;
- repeated canonical serialization/fingerprinting;
- trace materialization;
- recompilation of invariant schedules/dependency metadata;
- repeated invocation of complete vertical-slice/sub-simulation runners for already-prepared individual operations;
- runtime structures whose cost grows unnecessarily with accumulated historical identities, obligations, transactions, or prior periods.

R3 SHALL:

- create the immutable compiled-household/reusable execution boundary required by PFA-PERF-011;
- establish lightweight shared operation/execution kernels so domain slices remain semantically modular without forcing full sub-simulation overhead for each operation;
- pre-resolve/index stable relationships, schedules, dependencies, supported rule bindings, and hot lookups where semantics allow;
- provide a scenario/decision overlay seam so a localized planning change can reuse unrelated compiled household structure;
- reduce avoidable whole-state/history copying and repeated scans/serialization in hot paths while preserving authoritative snapshots at required boundaries;
- support bounded execution-level lineage with richer explanation materialization only where needed;
- measure scaling versus horizon/model size/history/operation count, not just one absolute benchmark;
- preserve an implementation-neutral simulation interface so a later Rust/WebAssembly/native/server acceleration spike can target measured hotspots without changing financial semantics.

Do not optimize semantic ordering by assumption. Scheduler/execution changes must demonstrate equivalence against authoritative semantics with reference/property tests. Do not move an inefficient engine to cloud/server execution merely to hide local latency; execution placement is evaluated after measured algorithmic/data-structure optimization.

R3 SHALL implement PFA-PERF-019 through PFA-PERF-023 and satisfy the reusable execution requirements before high-count stochastic orchestration or automated strategy search is treated as production-capable.



**User validation:** not normally required unless a user-visible behavior changes. Financial/result equivalence and performance improvement are primarily automated/engineering verification.

## 5A. D1 — Deterministic household financial-semantic readiness

D1 is the original deterministic financial-semantic milestone. It implements and verifies PFA-DET-001 through PFA-DET-014 after R3's reusable execution foundation and T1A Phase B's applicable tax integration are available. D1-C computational/financial code is merged, but **D1 acceptance still requires current U1 owner Issue #120 to pass independent ChatGPT review and uncoached normal-user UAT**. D2's *backend implementation* can progress alongside that U1 work from the audited merged D1-C baseline and separately approved domain contracts; D2-D and R5 cannot close ahead of accepted D1/U1. PFA-DET-015 combines the D1 and D2 readiness conditions. R4 was prior editor cleanup, not U1 acceptance.

D1 SHALL complete the deterministic semantic audit from user input through canonical representation, executable behavior, accounting/state effects, tax characterization, and user-visible result for the initial private-alpha scope.

Required deterministic use cases include:

- traditional, Roth, and after-tax 401(k) employee contributions;
- employer 401(k) matching/non-elective contributions and employer HSA contributions;
- automatic effective-dated 401(k)/HSA/IRA contribution-limit and catch-up calculation, including applicable combined employee/employer limits;
- in-plan 401(k) Roth conversions;
- supported direct and indirect retirement rollovers preserving pre-tax/Roth/after-tax basis and tax character;
- traditional and Roth IRA contributions/holdings;
- taxable brokerage funding, purchases, sales, gains/losses, interest/dividends, and dividend reinvestment;
- ordinary mortgage amortization, refinance, and extra principal payments;
- HSA payroll contributions and applicable account/tax behavior;
- checking/savings interest;
- Treasury bill/bond interest/coupon and principal/maturity behavior;
- CDs;
- cryptocurrency positions/disposals;
- a bounded supported deterministic options contract;
- insurance premiums and deterministic payout/stress-event behavior;
- applicable short/long-term capital-gain, interest, dividend, retirement/HSA, fixed-income, crypto, and option tax characterization;
- payroll-only funding for supported 401(k)/HSA employee contributions; and
- checking/savings-only funding for the initial supported IRA/brokerage/Treasury/CD personally funded flows.

D1 SHALL include independent truth-table fixtures for each required case plus at least one combined realistic household. Verification must reconcile cash, account/position/asset state, liabilities, income/expense/gain/tax recognition, transfers/contributions, and ending net worth without double counting.

D1 should be implemented as seam-safe slices rather than one cross-cutting branch:

1. **D1-A — authoring/account semantics.** Issue #70 is the current D1-A slice. It establishes current-position event semantics, cash versus investment/retirement classification, no-double-counting rules, executable baseline return authoring, personally funded contribution paths, employee and employer 401(k)/HSA contribution semantics, automatic statutory contribution-limit calculation, and coherent retirement-date baseline/What-If behavior.
2. **D1-B — remaining deterministic domain mechanics.** After D1-A merges, remaining PFA-DET cases such as advanced direct/indirect retirement rollovers with basis/tax-character preservation, in-plan Roth conversion, mortgage/refinance/extra principal, cash-account interest, Treasury/bond/CD mechanics, cryptocurrency, the bounded option lifecycle, insurance premium/payout behavior, dividend reinvestment, and any still-missing tax characterization may be split into parallel domain slices only where they own disjoint domain modules. Shared compiler/editor/execution integration remains a single integration lane.
3. **D1-C — integrated semantic closeout (Issue #80 / PR #89).** Merge all D1 financial slices, run the combined realistic-household truth table and source-of-funds/no-double-counting checks, and complete semantic audit. The D1-C code may merge to give U1 a stable base without declaring D1 fully accepted.
4. **U1 — guided financial authoring UX (Issue #94).** After audited D1-C merges, implement the cross-screen task-first interface, concise default summaries, organized collapsible financial sections, accessible contextual help, shared field/validation contracts, linked inputs, actionable diagnostics, and uncoached product-owner UAT under PFA-UX-015 through PFA-UX-020. No D1 financial formula redesign. U1's accepted UAT closes the original D1 gate.

Completion of Issue #70 alone SHALL NOT satisfy the D1 gate unless a merged-main audit demonstrates that every original D1 requirement (PFA-DET-001 through PFA-DET-014) and D1 truth-table case is already covered; D2 (PFA-DET-016 through PFA-DET-023) is separately required for R5.

If a named subfeature cannot be supported safely for the initial alpha contract, its exact unsupported boundary must be explicit and the private-alpha scope cannot claim that use case complete.

**D2 handoff (approved sequencing change):** D1 financial **computational** foundation is the merged and semantically audited D1-C; accepted U1 #120 is a *D1 closeout and D2-D final UAT gate*, **not** a prerequisite for disjoint D2-A/B/C backend implementation. Approved, versioned domain contracts and stable merged main remain prerequisites to economic code. D2-D #149 exclusively coordinates changes to shared canonical, compiler, scheduler, accounting/funding, payroll, tax and read-model contracts, one owner at a time. During active U1 #120/#142, D2 implementation MUST NOT write the same UI/application/editor/CSS/test paths; record the blocked seam in #149 and integrate after that specific file/API is released, not necessarily after full U1 UAT. Reject unknown law/plan terms as capability-incomplete rather than permitting domain authors to improvise. Merged D2-PREP #114/PR #116 remains a fixture baseline, not an implementation authorization.

**User validation:** required at U1 acceptance. D1 closeout SHALL use an **uncoached, goal-based** walkthrough proving that users can discover, configure, correct, and understand supported financial inputs/results. A script describing every field and click is not evidence of intuitive UX.


## 5B. D2 — Common-household deterministic breadth before stochastic runtime

D2 is a new hard gate between D1 and R5. It exists because the canonical vocabulary already anticipates several common household instruments/benefits that would materially distort a long-horizon forecast if stochastic simulation began before their deterministic mechanics were trustworthy.

D2 SHALL implement and verify PFA-DET-016 through PFA-DET-023 and the corresponding PFA-INV, PFA-INS, and PFA-TAX requirements. Required pre-stochastic breadth includes:

1. **Social Security retirement, spousal, and survivor benefits** with claiming/start-date, household coordination, COLA, and applicable tax semantics.
2. **Defined-benefit pensions** with basic benefit/formula or quoted-benefit authoring, beneficiary/joint-survivor behavior, commencement, COLA, and applicable tax semantics.
3. **403(b), governmental 457(b), and TSP** ordinary contribution/limit/rollover/distribution mechanics without flattening their legally distinct rules into a generic 401(k).
4. **SEP IRA and SIMPLE IRA** ordinary employee/employer contribution, limit, rollover/distribution, and tax-character mechanics.
5. **Auto loans, student loans, credit-card balances, and HELOCs** with real principal, interest, payment, extra-payment/payoff, and revolving/variable-rate behavior where applicable.
6. **Basic Medicare costs and premiums**, including materially applicable income-related premium adjustments.
7. **Basic health-insurance premium mechanics** with household coverage, employer/employee share, effective dates, and pre-tax versus after-tax funding character.
8. **529 plans**, including contributions, qualified/non-qualified distributions, beneficiary/owner identity, ordinary plan-to-plan rollovers/beneficiary changes, and a bounded 529-to-Roth-IRA rollover path under effective-dated statutory constraints.
9. **Backdoor Roth and mega-backdoor Roth mechanics**, preserving basis, pro-rata treatment, plan eligibility, contribution limits, and conversion/rollover tax character.
10. **TIPS and Series EE savings bonds** with their distinct principal/accrual/redemption and tax-character mechanics.
11. **Health FSA mechanics** with payroll contributions, plan-year limits, reimbursements, and supported carryover/grace/use-it-or-lose-it terms.
12. **Traditional IRA to Roth IRA conversion** as a first-class conversion path with basis/tax recognition and separate settlement.

D2 is not permission to make every rare statutory or plan-specific exception a universal pre-stochastic requirement. The ordinary household contract for each named family must be complete and testable; uncommon variants may be capability-gated only when the boundary is explicit and cannot silently change a supported result.

**D2 implementation now runs in parallel with U1, not behind U1 UAT.** D1-C code (PR #89) is the merged financial base. D2-PREP #114/PR #116 supplied only 55 synthetic cases and contract gaps. The consolidated issues are single domain owners, NOT nine micro-issue branches. Their current planning briefs are **not** V3 Codex authorizations; the PM must first approve affected A1–C3 economics, and D2-D must publish the consumed S1–S8 interface versions on merged main. Authorize bounded coherent phases within each parent issue with exact ALLOWED_PATHS and negative tests.

1. **D2-A #146 — benefits, retirement plans, conversions and distributions.** Own all A1–A4 benefits/pensions, five plan families, Roth/backdoor/mega flows and the **entire original closed #103 distribution/RMD scope**, including liquidity, tax, basis, withholdings and future account-first authoring.
2. **D2-B #147 — consumer debt, indexed/savings bonds and education.** Own B1–B3 fixed/revolving/HELOC, TIPS/EE and 529 including bounded 529-to-Roth.
3. **D2-C #148 — health insurance, Medicare and health FSA.** Own C1–C3 effective coverage, elected premium routing, IRMAA and restricted reimbursement.
4. **D2-D #149 — shared interface owner and final integration.** Early S1–S8 synchronization on main; serialized owner-only shared compiler/ledger/funding/tax/execution/read-model edits; final normal-user authoring and D2-D combined truth-table/UAT on an audited merged branch.

**D2-D mandatory production-stage correction (2026-10-30):** After repeated no-change Codex BLOCKED stops on the monolithic #149 V3, preserve #149 as the **coordination and final S8-5/U1 acceptance owner, NOT the runnable implementation task**. Register five bounded source-to-posting-to-replay children with disjoint edit ownership: **S1 [#276](https://github.com/bensmullen/personal-finance-app/issues/276)** authenticated household BANK/member permissions and versioned state posting/cold-replay proof; **S2 [#277](https://github.com/bensmullen/personal-finance-app/issues/277)** BOTH payroll/election and no-election VS2 wage paths, independent earned-wage original and SSA exclusivity; **S3 [#278](https://github.com/bensmullen/personal-finance-app/issues/278)** funded retirement destination plus standalone non-SSA Medicare; **S4 [#279](https://github.com/bensmullen/personal-finance-app/issues/279)** payroll-health/FSA debit and reimbursement with single transaction proof (serially revisits S2's VS2/payroll files to forward the original health binding); **S5 [#280](https://github.com/bensmullen/personal-finance-app/issues/280)** issuer-card and after-tax premiums. **Start only #276 after registration PR merges**; no #277–#280 Codex bootstrap before S1 is audited and merged and interfaces are stable. Once #276 merges, #277/#278/#280 may execute concurrently on disjoint paths; #279 additionally waits for merged #277, then owns its VS2/payroll changes exclusively. These children do not replace or complete domain owners #146/#147/#148, old #101/Tax/U1 seams, 529-to-Roth capacity, final S8-5 combined-household truth table, source-truthful user authoring, or accepted #120 D1/U1 UAT. Historical #149 contract is archived in its issue comments; no code was implemented from its repeated stopped turns. **No stochastic R5 unlock** until all original normative D2 gates and user acceptance pass.

**Explicit deferred overlap ledger (owned by #149):** (A↔B) aggregate IRA/basis and 529-to-Roth capacity; (A↔C) SSA/Medicare benefit deductions, IRMAA lookback, employee/employer payroll and FSA tax base; (B↔C) competing cash funding, ordering and noncash entitlements; (D2↔#101/#138) gross vs net withholding credit, tax cash settlement, loss/basis state, unique tax-law authority; (D2↔U1 #120) account-first editor paths, navigation, D2 read-only series/diagnostics and in-context repair, save/reload and keyboard/mobile acceptance. D2-D maintains exact interface version, released file owner, dependent domain and test evidence for each seam. Do **not** silently declare a seam complete because a pure domain test passes.

**Concurrency/integration rule:** D2-A/B/C can implement independent economic modules and targeted tests during U1, behind the corresponding approved normative contracts; none may independently mutate `ui/**`, `app/**`, U1-owned `src/application/**`, existing shared editor/E2E tests, common compiler/ledger/execution/funding/payroll/tax paths or competing plan/limit representations. Only #149 coordinates shared patches after contract freeze and audits merged-main integration. A2→A3 and 529 Roth legal-capacity dependencies still serialize within their respective submodules. U1 chart C/D/E remains serial only on its own occupied UI hotspots; D2 economic work does not need completion of those charts.

**Closeout:** User-authoring of D2 features must be complete and usable, and the D2-D combined household must reconcile asset/liability/cash/basis/retirement/benefits/withholding/insurance/FSA/529 and normal U1 source ownership. D2-D final closeout waits for D2-A/B/C integrated verification **and accepted U1 #120 uncoached UAT**, applicable PFA-TAX-015, and all material cross-seams, even though D2 backend work started earlier. No R5 unlock, D1/U1 or private-alpha completion from isolated domain merges.

**R5 gate:** do not begin stochastic household runtime implementation until D1 and D2 are complete on merged main, D2-D integrated verification/UAT is green, the applicable PFA-TAX-015 tax characterization is complete, and C1 is merged.

**User validation:** required at D2 closeout. The user walkthrough SHALL prove the named common-household capabilities are authorable in recognizable financial terms and that unsupported special cases are surfaced before a forecast is trusted.


## 6. P1 — Deterministic planning / strategy-evaluation foundation

P1 begins after D1 confirms that the original deterministic financial mechanics used by private-alpha planning decisions are semantically correct and testable. Because T1A Phase B is already a D1 prerequisite, P1 may use authoritative tax evaluation for supported tax-sensitive decisions. P1 may proceed in parallel with D2 and C1, but it SHALL capability-gate any strategy conclusion that depends on a D2 domain until that domain is merged and verified.

P1 now includes a required **deterministic portfolio-optimization floor for private alpha**. The planning boundary SHALL support explicit capability scope so portfolio-only analysis can remain modular from tax-aware portfolio analysis and later integrated planning. Commercial entitlements are outside financial semantics and may gate access to these capabilities later without changing the correctness of an enabled evaluator.

Implement the initial PFA-PLAN contract with a deliberately bounded supported decision set:

- typed separation of facts, assumptions, decisions, goals, constraints, strategies, and outcomes;
- durable/reproducible strategy identity;
- deterministic evaluation of two or more candidate strategies through the authoritative engine;
- explicit objective/constraint configuration without a hidden universal score;
- comparable result summaries and explanation of material decision/outcome differences;
- capability diagnostics when missing tax/investment/insurance/other semantics could materially change a conclusion;
- no automated financial action;
- compiled-plan reuse for localized decision overlays where semantically valid;
- explicit optimization-scope metadata identifying enabled decision/consequence domains and materially omitted domains;
- bounded deterministic portfolio candidate generation/ranking for supported contribution priority, employer-match capture, contribution allocation, movement toward explicit target allocation/ranges, and rebalancing;
- portfolio-only pre-tax/tax-excluded evaluation where meaningful and clearly scoped; and
- tax-aware account/location and other tax-sensitive decisions only where authoritative tax coverage exists.

P1 does not require Monte Carlo optimization, efficient-frontier/risk-optimal allocation, a new canonical Goal/Strategy object, or complete cross-domain planning. Its deterministic optimizer must disclose that conclusions depend on fixed return assumptions and bounded candidate/search scope. Its purpose is to deliver useful basic portfolio decision support before stochastic work while establishing the stable planning boundary that P2 later upgrades.

**User validation:** P1 requires focused user validation of whether a supported strategy comparison is understandable and decision-relevant. Financial equivalence and reproducibility remain automated/engineering verification.

## 7. C1 — Calibration contract before stochastic implementation

Before stochastic runtime code hard-codes any distribution/provider shape:

- define the provider-neutral normalized CalibrationSet boundary;
- define immutable normalized calibration snapshots/content fingerprints;
- provide a synthetic/internal baseline calibration for tests and engineering development;
- ensure the same calibration snapshot can be reused across many forecast runs;
- ensure a forecast references the calibration fingerprint rather than duplicating calibration data per run.

C1 is the early contract half of the former R8 work. It prevents rework without prematurely choosing external providers.

C1 is the primary implementation lane that may run fully in parallel with T1A Phase B and D1. To preserve that independence, C1 SHALL remain confined to the provider-neutral calibration contract, normalized immutable snapshots/fingerprints, and synthetic/internal calibration. It SHALL NOT change deterministic household economics, tax/account/funding semantics, or stochastic runtime execution merely to make a calibration shape convenient.

**User validation:** not required.

## 8. R4 — UX/editor cleanup

R4 may overlap R2/R3.

Implement PFA-UX with emphasis on:

- friendly entity labels and relationship resolution;
- no duplicate title/name summaries;
- no primary raw UUID display;
- removal/replacement of Choose-only unsupported reference controls;
- domain-oriented editing instead of primitive/rule IDs;
- structured additional/expert/technical drill-down;
- improved charts/status states and novice-first information hierarchy;
- component decomposition where it reduces rerender coupling.

**User validation:** required. Milestone closeout SHALL provide a concise walkthrough covering novice comprehension, entity editing, advanced-detail discoverability, chart readability, and any remaining confusing/dead controls.

## 8A. U1 — Financial authoring technical foundation (#94) and UX acceptance (#120)

**Start condition:** audited D1-C semantic integration (Issue #80 / PR #89) is merged to main. U1 is the **normal-user usability acceptance dependency for D1**, not a new financial domain, a second R4, or the D2 scope.

Implement PFA-UX-015 through PFA-UX-023 as one shared system, rather than repeatedly patching whichever label a reviewer last complained about. The default product view should be **visually detailed but quiet**: scannable account/plan summaries, logical headings and spacing, consistent controls, a small number of primary actions, and organized collapsible sub-sections. Accessible hover/focus/click/touch help exposes additional explanations only when useful; blocking validation and materially important financial limitations must never be hidden behind collapse.

Before implementation, inventory normal-user fields in UAT-critical flows and classify each as common, advanced financial, derived/read-only, technical, or unsupported. A reusable field contract provides meaning, unit, examples, help, dependencies, and error/derived state; supported new controls without metadata fail automated coverage. Related values are linked and cross-validated, with calculation/suggestion only where financial authority permits it. Diagnostic summaries are deduplicated and direct users to the affected controls.

Keep the implementation efficient by reusing D1's authoritative contribution/funding/mortgage/tax-setup contracts, rather than creating new financial calculators or broadening canonical schemas. Implement U1's common field/layout/validation foundation before converting the representative forecast, mortgage, IRA/401(k)/HSA, salary, investment, and tax journeys. CI/browser tests cover missing-field repair, contradictions, accessible help, readable desktop/mobile layouts and console safety.

**Immediate U1 corrective architecture (Issue #94 / PR #98):** the versioned controlled source-of-truth registry at `docs/specs/verification/u1-fact-ownership.json` is mandatory before any U1/D1 acceptance. Source edit ownership is by *business concept*, not by where a related output is viewed: salary and growth in Income; bank accounts in Money/Accounts; ordinary spend in Spending; mortgage contract/funding with Debt; investment/wage-linked contribution and YTD/history facts in Investments & retirement; person/filing/health facts in Household & People; retirement event with Life Events; only forecast horizon/execution setup in Current Plan. Second editors on existing summary pages are replaced by read-only views and an in-context link to the **same shared owner editor**. Fixing a related fact from another view SHOULD open that same editor in a contextual drawer/sheet wherever feasible, rather than requiring a multi-page scavenger hunt. Tax setup editor ownership moves to #102 only after a controlled transition; pay withholding is still blocked by #101.

Deterministic source-qualified derivations (age from DOB, eligible preceding-year wages, modeled pay from dated salary+growth, validated scheduled payments, qualified investment valuation) are required when the support facts and effective rules are complete. Gross salary is not the same as MAGI/plan-eligible pay, mortgage original principal is not present balance, a transfer is not an expense, and historical observations are not projections. Conflicting records for different years/employers are not duplicates. Only lossless same-scope replicas can be auto-reconciled; meaningful contradictions must be named with provenance and a single repair action. The unsupported whole-policy `HISTORICAL_SCOPE_CONFLICT` check, future nominal carry-forward checkbox, incompletely segmented Your Paycheck chart, and redundant cross-screen inputs remain U1 **blocking UAT defects** until actual current-head source, tests, and owner UAT demonstrate repair.

**U1 existing-domain registry completion (2026-10-14):** classify previously omitted term-life policy/premium/benefit/payout and investment sale, lot selection, dividend/interest, reinvestment, call exercise, in-plan conversion, direct/split retirement rollover and linked indirect-distribution/deposit controls as part of U1. Normal writer for supported investment operations is **Net Worth → Investments & retirement**, on the owning account/holding and its dated Activity & transfers; the opening tax lot remains an investment holding fact. Normal writer for the entire supported term-life policy/coverage/premium/beneficiary/benefit destination is **Money → Insurance & coverage**, including contextual bank and insured-person references; insurance premiums and benefit payouts are derived cash-flow views, not duplicate expenses/income/asset values. Scenario death is a distinct **Plan → Life Events** event, exposed by the same shared Life Events editor from the insurance panel. Preserve all original D1 Event/Effect and term-life adapters and IDs, avoid invented death events, and do not expand D1 economic formulas. The controlled registry completion change is merged on main before the owner-resumed #94 branch claims contract-complete UI inventory. This classification is a U1 acceptance prerequisite, not an excuse to defer original deterministic financial flows to D2.

**Implementation seam:** resolve input/fact provenance and build the shared `src/application/**` resolver + single owner-screen hooks in existing PR #98, preserving D1 law/ledger. The registry, PFA-UX-021/022/023 and requirement index arrive through this separate documentation PR on `main`. Codex must sync the merged normative spec through operator-owned bootstrap before claiming complete compliance; do not silently modify frozen financial engine/canonical schema under #94. If a required future-year law or payroll withholding calculation is unavailable within the authorized interface, report the precise missing authority as a release blocker; do not claim a complete forecast with guessed amounts. Browser UAT must exercise every currently rendered normal-user input against its recorded single owner, deep-link sheet, actual source/derived values and unsuppressed exceptions. CI alone cannot prove the current code meets this contract.

**U1 execution handoff (2026-10-15):** Issue #94 / PR #98 is a large, CI-green financial-authoring **implementation checkpoint** (merged head `f978f384`, approximately 49 predecessor implementation commits and 62 files). The product owner explicitly reports the resulting UI remains unacceptable. To avoid inefficient expansion of the original task, Issue **#120** is the designated small **U1B visual/comprehension and owner-UAT successor**. Its Codex implementation uses a new branch from the merged U1A foundation on `main`; do not copy all #94 history or repeat its financial adapters. #120's owner/editor UI work remains governed by the controlled 62-family registry and PFA-UX-015–023, and the owner accepts normal-user readability only after fresh uncoached UAT.

**Technical-baseline landing completed (2026-10-15):** the product manager merged [PR #98](https://github.com/bensmullen/personal-finance-app/pull/98) into `main` (merged head `f978f384`, GitHub merge commit `0c494c1`). Latest-head GitHub CI passed, but no independent full semantic acceptance or uncoached owner UX UAT is claimed. **Issue #94 is closed as superseded technical foundation, not completed U1/D1 acceptance**. [Issue #120](https://github.com/bensmullen/personal-finance-app/issues/120) alone owns the remaining U1B user-facing redesign, usability/semantic audit and owner UAT, including inherited #99 mortgage-account funding expectations. The milestone issue register points the D1_U1 gate and downstream dependencies to #120. The U1B worktree/PR starts clean from post-merge `origin/main`; do not reimplement PR #98's financial adapters. #101 withholding remains a separately gated tax incompleteness.

**U1B chart-data and production visualization gate (2026-10-17; U1B_B):** [Issue #129](https://github.com/bensmullen/personal-finance-app/issues/129) prepares an immutable monthly/annual, per-metric-capability-aware chart read-model adapter from the existing household forecast and opening snapshot. The narrowly scoped implementation owns **only** `src/application/forecastChartData.ts` and `test/forecastChartData.test.ts` and can proceed in a separate Codex worktree alongside U1B-A **after** its architecture/issue-register PR is merged. It does not edit React, global CSS, existing U1 tests, financial compiler, ledger, tax, scenario, or chart presentation. Exact financial safety: year-end balances are *stocks*, annual income/expenses and changes are summed *flows*, tax-incomplete source metrics remain labeled partial, `cash` across all account wrappers must not be called bank-accessible cash, and `statementIncome/statementExpenses` are recognition measures rather than bank cash flow. Later U1B-B UI consumes the merged readout only after U1B-A merges; authoritative bank-cash series, gross-to-net allocation/withholding (#101), amortization paid-detail, retirement-source income and asset attribution require additional verified source contracts. **Milestone register:** **U1B_B now requires [#129](https://github.com/bensmullen/personal-finance-app/issues/129) for the source selector and [#136](https://github.com/bensmullen/personal-finance-app/issues/136) for Phase B production V1–V3 UI**, while **D1_U1 still lists only #120 as final PM owner-UAT issue**. The new chart UI V3 contract is on #136; the original U1B #120 remains the continuing final acceptance and legacy phase history owner. #129 is a disjoint preparatory dependency, not a second chart-UI or D1 acceptance owner. See [chart data contract](../../alpha/u1b-chart-read-model-contract.md).

**U1B-C Cash task-first/V4 allocation (2026-10-17; U1B_C):** [PR #139](https://github.com/bensmullen/personal-finance-app/pull/139) merged (commit `457fe473596e97366d6552f02e05d2d51e70f5a8`), completing [#136](https://github.com/bensmullen/personal-finance-app/issues/136) V1–V3 implementation, while [#120](https://github.com/bensmullen/personal-finance-app/issues/120) remains sole U1/D1 final UAT owner. U1B-C now **COMPLETED**: [Issue #142](https://github.com/bensmullen/personal-finance-app/issues/142) closed after [PR #157](https://github.com/bensmullen/personal-finance-app/pull/157) merged (`c8c41d835184871f31dbde587d1cf3c927017e0c`), with green final branch-head CI and independent scoped semantic audit. That phase provided: compact Cash-section routes to existing income/spending/accounts/insurance owners and an **explicitly partial, selected-month V4 categorized-use comparison** based on existing `inspectMonthlyMoney()` replay-verified evidence. Current salary withholding is `not_modeled`; do not infer complete gross-to-net/disposable income, funding of spending by a particular paycheck, numeric unknown tax, or an unsupported annual 12-month rollup. Distinguish excess posted uses, unavailable funding, partial coverage and source-backed amounts with clear controls. [#101](https://github.com/bensmullen/personal-finance-app/issues/101) remains the separate payroll withholding/net settlement gate; **U1B-D is [Issue #161](https://github.com/bensmullen/personal-finance-app/issues/161)** (separate `U1B_D` milestone gate), serialized after merged C code and after this D-stage issue-register/roadmap registration PR merges. Its approved narrow V5 scope is Real Estate/Debt mortgage amortization using *actual funded* interest/scheduled/extra-principal postings from the authoritative integrated loan replay, with readable unsupported/stale/funding gaps; derive property equity only from coherent same-date linked property/debt facts, never from loan paydown alone. No new mortgage solver or hypothetical extra-payment scenario; replay must be bounded to selected months, not eagerly the horizon. U1B-E remains separately authorized after D merges. Other D2/isolated tax backend lanes remain parallel where edit ownership is disjoint.

**Sequence clarification (2026-10-17):** Completing B/C implementation and advancing to D/E is allowed **before** uncoached U1/D1 PM UAT; #120 is the final acceptance gate, not the serial chart implementation predecessor. D is the single shared-UI writer while its branch is active; disjoint approved D2 backend work may proceed but cannot edit D-owned `ui/**`, `app/**` or `src/application/mortgageChartData.ts` and must coordinate shared interfaces through D2-D #149. The current issue-register is authoritative for the D-specific implementation gate; its planning PR must merge before Codex bootstrap.

**Final U1/D1 acceptance after handoff:** green latest-head CI, ChatGPT UX/financial-semantic audit and uncoached product-owner goal-based UAT on **#120**; no U1 or D1 completion from a foundation-only merge.

**U1B outcome-based scope correction APPROVED by PM (2026-10-19):** UX issues before final D1_U1 gate shall produce a coherent real-world first-run experience, not claim success from chart-SVG existence or visual CSS tests. Latest local PM UAT **rejected** draft PR #176's usefulness despite green selected CI and subsequently successful manually triggered UX evidence. Authoritative UX requirements already require a full **age-90 requested horizon** for eligible sourced DOB(s), visible editable **age-65 retirement suggestion** for working adults, meaningful first-screen visual insight, and safe defaults. Source audit confirmed onboarding hardcoded 10 years, a hidden <=40-year UI limit, and Golden fixture (1990 DOB, 2026–2036 window, 2035 retirement around age45) fails the very retirement-planning example that normal users expect.

**PM-approved tax law completeness prerequisite (2026-10-19):** New [#189](https://github.com/bensmullen/personal-finance-app/issues/189) must independently implement and verify the engine distinction between a computation-complete, explicitly chosen projected-current-law scenario and missing financial capability **before resuming #181**. No auto-consent, fabricated future law, or UI-only `completed` relabeling. #189 changes tax/kernel/compiler capability interfaces, not shared UI/CSS; #181 then supplies explicit synthetic assumption/normal-user acceptance, full age-90 first-run display and remains the single UI/CSS writer. #101 withholding and #149 D2 integration remain separate, and material gaps still block their affected results. The existing serial UI chain and #120 final product UAT remain unchanged.

**Payroll dependency sequencing (controlled proposal, active only upon PM merge; 2026-10-19):** Codex #181 surfaced that #189 deliberately leaves `wage_gross_to_net_withholding` blocking all projected-wage net-cash/net-worth outputs, so a genuinely completed working-to-retirement Golden demonstration is impossible by adjusting only synthetic funding/settlements. **Recommendation: implement #101 source-bound payroll execution before #181**, preserve the fully completed supported-scope first-run requirement, and retain the age-90 *requested* horizon independently of computed coverage. The register previously made #101 depend on final #120 UAT, which is downstream of #181: adding #101 before #181 without removing that edge would create a dependency cycle. This proposal moves #101's *first* mandatory gate to `U1B_UX`, changes its prerequisite from #120 to the merged #189, and adds #101 as a prerequisite for #181. #101 owns **non-UI tax/cash engine + a durable sourced, dated, per-income withholding authoring/compilation contract**. #181 remains the **sole shared UI writer** for minimal normal-user Income/payroll and single-click Golden binding (not a second tax editor); #102 owns a richer federal/state/local Taxes workspace after #120. No phantom withholding from tax liability, no net-to-gross guess, no invented benefit, no silent zero; fixed-per-paycheck or percentage source selection must be explicit, employer/job/jurisdiction scoped, and unsupported frequencies or rules remain incomplete. Existing retirement contribution allocation, payroll-tax/legal-base semantics, true estimated payments, tax-year credit application, year-end net refund/due, ledger/summary-detail/replay and money cents must reconcile. The dependency change takes effect **only upon PM merge of its controlled planning PR**. Separately, #101 remains a non-V3 backlog item until the architecture layer issues an independently authorized implementation handoff; #181 is blocked until #101 implementation is audited and merged. D2/#149 shared-tax interfaces remain separate, and no conflicting tax/kernel writers run in parallel.


**FUTURE_CONDITIONAL (not a release gate, 2026-10-24):** [#235](https://github.com/bensmullen/personal-finance-app/issues/235) dependency-aware incremental forecast recalculation is a post-#207 research/design item; it may proceed only after source-qualified dependency and cross-domain funding/replay correctness review, not as a #120/U1B or private-alpha blocker. [#238](https://github.com/bensmullen/personal-finance-app/issues/238) optional category-specific spending-growth authoring is likewise backlog after #187 and needs PM prioritization and a resolved precedence/migration contract before any Codex V3 handoff. Neither is part of #240 or a new prerequisite to merging its completed code. Both are tracked in the issue register under a conditional future-stage authorization gate, not silently added to the U1B/D1/R11 mandatory release checklist.

**2026-10-24 shared-header dependency amendment (supersedes older #171→#187-only sequences below):** After verified merge and PM Cash UAT of #171/PR #236, issue **#240** / PR #241 owns one persistent canonical household/recorded members/current executable plan with independent Model/Forecast status, source disclosure and Save/Export. #240 shares `ui/PersonalFinanceApp.tsx` and `app/globals.css` with #187; **do not bootstrap #187 until #240 has green selected CI, independent semantic audit, PM desktop/mobile/200%-text visual UAT and merges**. The U1B_UX gate now includes #240 in the [milestone issue register](../../development/milestone-issue-register.json), while #120 remains the only final integrated U1/D1 PM UAT owner. #238 category-inflation authoring is independent. No per-person forecast, multiple-household selector, financial source duplication or new engine. Older archived implementation-order statements are historical and not active Codex authorization.\n\n**Approved implementation/merge order:** (1) #170 / PR #176 **verified technical layout foundation** (selected CI + independent scoped semantic audit + 1440/390 screenshot evidence) may merge WITHOUT implying PM visual acceptance. The original PM UAT rejection stays OPEN under #120; don't call foundation UX complete. (2) **#181** implement exactly **one richly sourced flagship synthetic household**, a genuine worker-driven requested age-90 outlook, age-65 retirement planning controls, previously scoped 2.5/3/5% + 6-month editable starter assumptions, Tesler/Postel safe lower-input authoring and truthful gaps. #181 code/audit must complete before #171; it may not invent tax or benefits or silently keep the old 10-year fixture. (3) **#171** Cash insightful V2/V3/V4 context grounded in that flagship, with source-owning edit actions and known gross/net caveats. (4) **#187 U1B-E** Planning retirement income composition V6 only when underlying source identity supports it, readable age/retirement year progression and remaining Investing/Debt first-screen usefulness; otherwise an explicit source-data blocker returns for architecture. (5) **#120** is the single final uncoached PM U1/D1/U1B UX acceptance owner. All UI writers on `ui/PersonalFinanceApp.tsx` and `app/globals.css` remain serial. Existing D2 non-UI work can proceed in parallel on disjoint sources.

**Release evidence, not design decoration:** flagship first click works without setup loops; DOB-derived later-of-selected-adults age-90 request is stored independent of source-supported forecast coverage; age65 proposal requires acceptance and is never a fabricated Social Security/Medicare claim; charts at 1440x900 and 390x844 tell a recognizable before/after retirement or cash/liability decision with sourced units and selected-year amounts; imported/saved authoring reuses facts and asks only truly indispensable questions; read-only source-owned financial facts remain exact. Record incomplete/unknown years; no fake completion, V6 attribution, returns, asset values, withheld income or bank funding. Keep R11/O1 [#108](https://github.com/bensmullen/personal-finance-app/issues/108) **eight** fully populated personas and 4+ independent saved plans per persona deferred; #181 owns only the one flagship U1B sample. This amendment supersedes earlier statements in this roadmap implying **#170 PM visual approval is required before #181 may start** or that age90/65 proposals wait entirely for U1B-E; #181 owns default behavior and #187 consumes it.

**Mandatory U1B zero-friction forecast and assisted authoring (2026-10-18):** [PFA-UX-024](../capabilities/application-ux.md) requires the **one-click synthetic household** to auto-run an actual **completed supported-scope** deterministic baseline with embedded financial graphs, without any secondary setup action, and requires ordinary households to derive source-backed facts, offer editable prefilled suggestions and request only indispensable authorization/identity facts. The existing `useInteractiveForecast` worker already auto-runs when a valid configuration is present; the Golden button already seeds execution configuration, so first audit what is actually incomplete rather than duplicating execution. Consumer-facing `incomplete` may never be falsely relabeled `completed` nor synthetic values inserted into real customer records. [U1B-UX-C #181](https://github.com/bensmullen/personal-finance-app/issues/181) is a bounded prerequisite **after #170's verified technical Overview foundation merge (without PM visual signoff) and before #171's Cash parity merge** because all three touch shared `ui/PersonalFinanceApp.tsx` / CSS; existing D2 backend can continue with disjoint edit ownership. U1B-E #187 shared UI also waits. The full single-owner user acceptance gate #120 remains OPEN. This is a **before-U1B-completion requirement**, not post-alpha polishing.

**Prototype-to-production Calm UX acceptance correction (2026-10-17):** After PR #157 merged, PM's real local UAT found that required financial data, graphs and Save/persistence worked but Overview and Cash **did not meet approved Calm visual density, progressive-disclosure, information-architecture or everyday-language requirements**. The design reference [Level 4](../../alpha/level4-pilot-design-review.md) and [approved HTML Calm pilot](../../alpha/prototypes/level4-h04-h08-pilot.html) were not previously enforced as actual production screen-comparison acceptance. The controlled [parity matrix](../../alpha/u1b-calm-production-parity.md) and two serial scoped implementation issues address the defect: **[#170](https://github.com/bensmullen/personal-finance-app/issues/170)** reusable Calm presentation components and Overview; **[#171](https://github.com/bensmullen/personal-finance-app/issues/171)** Cash composition, plain language, disclosure using those shared components. U1B-D real estate/mortgage implementation [PR #166](https://github.com/bensmullen/personal-finance-app/pull/166) has merged with green selected CI; its standalone GitHub issue state is tracked separately. Both parity issues are under `U1B_UX` gate and must be **registered by this PR's merge before Codex bootstrap**, and implemented serially due shared `ui/PersonalFinanceApp.tsx` and `app/globals.css`. **U1B-E Planning UI waits until UX-B merges and its first-screenful is visually reviewed**, and should reuse the Calm components. Financial semantics, authoring single-owner registry, D2 backend and full U1/D1 uncoached PM UAT **#120** are unchanged. Green CI/feature correctness without actual production vs prototype screen review does not close the UAT gap.

**Level 4 Calm + chart-aware U1B current status (updated 2026-10-17):** PM-approved [embedded-section visual contract](../../alpha/level4-financial-visualizations.md) retains the seven normal-user financial destinations **Overview / Cash / Investing / Real Estate / Other Assets / Debt / Planning**, each with its relevant chart inside the section (no chart-only page), and the controlled 62-family single writer. Completed implementations: Phase A [PR #128](https://github.com/bensmullen/personal-finance-app/pull/128), B0 chart-data selector [#129/#133](https://github.com/bensmullen/personal-finance-app/pull/133), B production V1–V3 [#136/#139](https://github.com/bensmullen/personal-finance-app/pull/139), C Cash/V4 [#142/#157](https://github.com/bensmullen/personal-finance-app/pull/157). **Active next stage**: D V5 source-backed Real Estate/Debt under [#161](https://github.com/bensmullen/personal-finance-app/issues/161), locked behind merged issue/roadmap registration; E sourced retirement visualization/insight is registered as #187 after #171; age defaults move into #181. **V7** asset-class attribution remains a separately capability-gated P1/R11 candidate. [Design PR #127](https://github.com/bensmullen/personal-finance-app/pull/127) supplied synthetic design snapshots, **not financial evidence or uncoached owner UAT**. **#120 alone** retains U1/D1 normal-user final acceptance, including mortgage source funding and cross-journey semantics. #105 saved plans and #108 household examples remain separately owned.

**Acceptance:** green CI + independent ChatGPT UX/financial-semantic audit + uncoached product-owner goal-based UAT on #120 still gate D1 acceptance and R5. Independently authorized D2 backend financial work under #146/#147/#148 and shared interface synchronization under #149 **may run before this U1 acceptance**, but no D2 branch may write occupied U1 UI/application/editor paths. #149 retains all deferred authoring/chart/diagnostic overlaps for integration and final acceptance.

## 9. O1 — Assisted onboarding and import foundation

O1 begins after the R2/R4 interaction foundations are stable enough to support a guided workflow. Its foundation may proceed in parallel with R3/C1/T1A-B/D1, but O1 is split at the authoritative-mutation seam:

- while D1 is active, O1 may build onboarding-specific candidate/import contracts, parsers/extractors, provenance/idempotency, privacy-safe telemetry, synthetic fixtures, and review workflows in isolated modules;
- O1 SHALL NOT independently redefine shared account classification, contribution/funding semantics, retirement bindings, tax facts, or normal editor/compiler mutation paths owned by D1;
- after D1 merges, O1 integrates confirmed candidates into the authoritative model using the merged D1 authoring semantics and then performs onboarding dry runs.

Implement PFA-ONB with emphasis on:

- a minimum viable household model that reaches useful current-state and forecast outputs before optional detail is requested;
- privacy-safe instrumentation for time to first useful forecast, manual-entry burden, completion/abandonment, corrections, import success, unsupported formats, and source-path mix;
- a typed candidate boundary for document/CSV/conversational extraction that distinguishes factual candidates from goals, constraints, assumptions, decisions, and other planning inputs;
- deterministic validation, provenance, approximate-versus-exact preservation, conflict detection, and user confirmation before authoritative model mutation;
- guided structured onboarding plus at least one bulk/file import or extraction path appropriate to the intended alpha cohort;
- deliberate separation of current snapshot facts, transaction history, and forward-looking planning inputs;
- optional guarded text/voice conversational intake for goals, rough spending, household facts, and high-value missing fields where prototype evidence shows it reduces effort;
- supported-format detection and safe failure rather than partial silent imports;
- synthetic fixtures/documents/conversations for automated testing, with real personal data used only inside the approved privacy boundary;
- progressive completeness guidance that tells the user which missing inputs materially improve supported outputs.

O1 SHALL run representative onboarding dry runs before R11 and use the results to set an explicit time/manual-effort target rather than inventing one in advance. The dry runs should measure whether users can reach a meaningful forecast without transcribing their entire financial life manually.

A production Plaid/bank-aggregation integration is not required for O1 or private alpha if the measured assisted workflow meets the target.

**Alpha exploration dependency (#108):** maintain eight synthetic, heavily populated, family-linked example households as a separate R11 demo-library obligation. Its non-normative authored fixture blueprints live in `docs/alpha/household-blueprints.md` with a monthly expense category matrix and fixture acceptance guidance. Implementation of the eight one-click multi-plan sample experiences follows the audited relevant D1/D2 semantics and reuses the O1 candidate/authoritative-model boundary. Multi-state tax, rental/estate law and incomplete asset domains must show capability limitations, not false complete outputs. Commercial account aggregation remains optional; a future provider evaluation must not stall the demo library. Direct read-only linking is the preferred eventual default for personal-data onboarding; use a narrow evidence-driven CSV/statement fallback, not a universal importer. See `docs/alpha/account-connectivity-evaluation.md`. H01 includes extended adult children/partners/grandchildren with separate economic ownership; H02 includes all six family members; H03 has explicit zero-vs-two-children saved plans; H08 is a Denver couple approaching retirement with a dependent adult child and exactly $5m opening net worth, with long-term support, retirement timing and legal/benefits capability gaps flagged. The sample library does not bypass #105 independent plan semantics.

**User validation:** required. Closeout should observe actual onboarding behavior rather than only reviewing screens. The user should verify that the workflow feels substantially faster than manual field-by-field setup and that extracted information is easy to review/correct.

**Future education-advisor reuse (non-blocking):** The optional [PFA-ADV contextual financial guide](../capabilities/contextual-financial-education-advisor.md) may later reuse O1's confirmed intake/provenance and existing U1/P1 source-backed explanations. Any limited, read-only alpha experiment must be separately privacy-reviewed and feature-gated. The advisor, its user-memory persistence, its AI provider, an orchestration gateway, and MCP are **not R11/private-alpha requirements**; no existing U1/O1/P1 owner or gate changes.

## 10. T1A/T1B — Tax development track

### T1A — Target-cohort/common-household tax floor

T1A Phase A begins after R2 and may develop in parallel with R3/C1. T1A Phase B household integration begins only after R3 and Phase A are merged, and the applicable target-cohort tax integration is a prerequisite to D1 closeout. D2 extends the common-household tax floor through PFA-TAX-015 for its added retirement/benefit/account families. R5/R6 do not begin before D2.

T1A is not “all tax law.” It is the deterministic per-realization tax coverage materially required by the households and outputs targeted for personal use/private alpha. Tax-affected stochastic outputs remain blocked/scoped until their required tax semantics are covered.

For the actual private-alpha cohort, implement the materially applicable subset of PFA-TAX-010: federal ordinary income tax with filing status/progressive brackets, standard/basic deductions, employee payroll taxes, applicable state/local income taxes, taxable interest/dividends including qualified-dividend treatment, realized short/long-term capital gains, basic traditional/Roth retirement tax treatment, NIIT where material, cash-flow-relevant withholding/settlement, and RMD/retirement-distribution mechanics when the age/horizon makes them material.

Property tax may remain a modeled household expense and sales tax may remain embedded in spending assumptions when no separate tax-engine interaction is required. Self-employment/business, AMT, complex credits/phaseouts, rental/pass-through, foreign, estate/gift, and equity-compensation-specific taxation remain T1B unless an alpha participant requires them.

Create the reusable tax-rule catalog boundary from PFA-TAX-011. During personal/local development the catalog may be version-controlled app data. Before/within shared private-alpha persistence, common effective-dated rule definitions should be stored once per version/content fingerprint, while household models store facts/elections/references rather than duplicate copies of tax law. Executable tax algorithms remain in the rules engine.

As tax coverage expands, preserve the optimization-ready composition and multi-period state seams from PFA-TAX-017/018. This reserves future comprehensive applicable-law tax optimization without making exhaustive tax-code encoding part of T1A, D2, or the private-alpha gate.

Examples of tax-independent results may continue to display in accordance with PFA-TAX-008. Objective output validity SHALL be driven by dependencies/capability diagnostics rather than a global all-or-nothing tax switch.

### T1B — Advanced/specialized tax domains

Add specialized capital-gains, retirement, equity-compensation, real-estate, and other jurisdiction/product mechanics alongside the capabilities that require them. T1B now contains one mandatory private-alpha slice under PFA-TAX-016: wash-sale handling, capital-loss netting/carryforward, tax-loss harvesting evaluation, and a bounded Section 1031 real-property exchange contract. These four mechanics SHALL be complete before R11/private alpha. Other T1B behavior gates only materially affected outputs unless the alpha cohort requires it.

**Isolated T1B implementation gate (2026-10-17):** [Issue #138](https://github.com/bensmullen/personal-finance-app/issues/138) is the single consolidated pure-rule preparation owner, closed until this controlled contract is approved and merged. The product manager approved the bounded 1031 scope of one-for-one U.S. non-depreciable investment land on 2026-10-17. That decision does **not** authorize Codex until PR #140 merges and #138 is reopened. Depreciable rental/commercial property exchanges, historical depreciation/basis and Sections 1245/1250 recapture, land/improvement component allocations, subsequent replacement-property depreciation, and their Form 8824/Form 4797 reporting consequences are explicitly **deferred to a later T1B capability**, with isolated supported-result diagnostics for private alpha. The later product decision/issue is triggered when supporting those property classes is prioritized or needed by an admitted cohort; it must have separately approved semantics and authoritative execution ownership, not get folded into #138. After #138 implements and passes semantic audit, a separately authorized shared-household/tax/planning integration is still necessary to satisfy PFA-TAX-016 before R11. This pure tax rules lane is parallel to U1B #136 and isolated D2-A/B/C only while writes remain disjoint.

T1B may parallelize safely at the rule/catalog layer when it adds isolated effective-dated rules behind the existing tax contract. A T1B slice that changes household compilation, recognition ordering, funding/settlement, or shared tax-execution interfaces SHALL wait for the current owner of that shared boundary to merge, or use a dedicated synchronization change before both lanes continue.

**User validation:** required only when a tax milestone changes user-facing workflows/results. Automated rule/invariant tests remain the correctness authority; user validation checks understandable presentation and expected real-world workflow.

## 11. R5 — Stochastic runtime foundation

**Start condition:** the full D1 gate (including U1 accepted UX/UAT) and the full D2 common-household breadth gate are complete on merged main, including D1-C and D2-D integrated truth-table verification, semantic audits, and accepted UAT; PFA-TAX-015 is complete for the admitted D2 scope; and C1's calibration contract is merged. Issue #70/D1-A or D1 by itself is not sufficient. Do not use R5 to discover or patch unresolved ordinary household financial semantics.

Implement the higher-authority stochastic semantics before Monte Carlo orchestration:

- seeded RandomSource/RandomStream implementation;
- distinct stochastic cohort identity and scenario identity;
- stable process identities/substreams;
- P31 probabilistic and P33 correlated-process executable support needed by the initial model;
- immutable stochastic run configuration referencing C1 calibration;
- one reproducible stochastic household realization;
- explicit rejection of unsupported distributions/dependencies.

Do not add high realization counts until one realization is semantically complete and reproducible.

**User validation:** not required.

## 12. R6 — Monte Carlo orchestration

Add:

- compile-once/many-realization execution;
- worker pool or bounded parallel batches;
- deterministic realization identity independent of scheduling;
- common-random-number cohorts for paired scenario comparison;
- streaming/online distribution aggregation;
- bounded memory;
- progressive refinement and stopping based on convergence evidence rather than a permanently fixed high realization count;
- representative-path identity/summary capture;
- stochastic performance/resource-cost telemetry;
- cancellation/supersession;
- provider-neutral execution placement so the same stochastic contract can run locally when practical or on cloud/server workers when required.

Persistence at this stage SHALL be bounded: do not retain every path or every rerun. Persist the current successful aggregate result plus, at most, one immediately preceding successful aggregate per saved scenario/configuration, together with reproducibility metadata. Keep the last good result current until a replacement completes successfully; failed/cancelled runs never evict it.

Superseded unpinned successful aggregates SHOULD enter an initial seven-day recovery grace period before garbage collection. Exact production duration remains configurable. Explicitly pinned/saved stochastic snapshots are retained separately and SHALL be subject to a simple user-facing saved-snapshot count limit plus a backend byte quota. Exact count/byte limits are set after representative storage measurements. Identical artifacts SHOULD be deduplicated by deterministic fingerprints.

Retained stochastic results SHALL store aggregate distributions/percentiles, threshold and liquidity-shortfall probabilities, decision metrics, convergence/sample metadata, and exact model/Forecast Basis/calibration/tax/stochastic/version identities. They SHALL NOT store the full transaction/state/trace history for every realization by default. Detailed representative paths SHOULD be regenerated on demand from retained realization identities when compatible engine/rule/calibration artifacts remain available; pinned long-lived results may additionally retain compact representative-path summaries.

Calibration and tax-rule artifacts are content-addressed/deduplicated separately and retained while referenced or required by retention policy. Saved plan/scenario definitions are durable configuration and SHALL be stored independently of derived forecast results.

Initial path counts, convergence thresholds, and compute/cost budgets shall be established empirically. A routine forecast that cannot meet both statistical and compute budgets SHALL be optimized, progressively refined, narrowed, or capability-gated rather than normalized as an expensive cloud operation.

**User validation:** not normally required; orchestration correctness/reproducibility is automated.

## 13. R7 — Baseline probabilistic household engine

Introduce uncertainty incrementally against C1's synthetic/internal calibration:

1. broad asset-class returns and correlations;
2. inflation;
3. material interest-rate processes;
4. income/salary uncertainty;
5. expense variability;
6. later employment, longevity, major expense, real-estate, and other life-event processes.

After R5/R6 freeze the random-stream, process-identity, correlation, realization, and aggregation contracts, individual R7 process families may be implemented in parallel when they live behind those contracts and do not redefine them. Changes to shared correlation structure, process identity, aggregation/result meaning, or orchestration are synchronization changes and remain single-owner until merged.

User decisions remain explicit scenario controls unless behavioral uncertainty is intentionally enabled.

R7 may expose engineering/developer results before T1A is complete, but a tax-affected result SHALL NOT be presented to a normal user as a complete household probability until PFA-TAX-008/009 are satisfied.

**User validation:** limited/developer validation may occur, but normal-user UAT waits for tax/calibration completeness appropriate to the output.



## 14. P2 — Stochastic strategy evaluation and progressive optimization

After P1 and the required R7 probabilistic semantics exist, add strategy-set stochastic evaluation using PFA-PLAN, PFA-PROB, and PFA-PERF-024. Preserve the declared capability scope from P1 so portfolio-only, tax-aware, and later integrated searches can use the same stochastic evaluation machinery without forcing every domain into every product surface:

- common Forecast Basis and common-random-number cohorts for materially comparable candidates;
- bounded lower-cost stochastic screening followed by higher-confidence evaluation of survivors;
- dominance/tradeoff analysis without forcing all goals into one unexplained scalar score;
- candidate-count, realization-count, convergence, latency, memory, and cost telemetry;
- cancellation/supersession and bounded parallel evaluation;
- explicit disclosure when search is heuristic, bounded, or incomplete;
- authoritative finalist reevaluation at the required tax/investment/insurance/domain completeness level.

P2 may remain post-alpha if the private-alpha product uses only the bounded deterministic portfolio optimizer from P1 and clearly labels its fixed-assumption limitations. If a private-alpha feature presents an uncertainty-aware/risk-optimized recommendation based on stochastic search, the applicable P2 requirements become part of that feature's launch gate.

**User validation:** required before automated stochastic strategy recommendations become a normal-user feature.

## 15. R8 — Institutional market/economic calibration adapters

R8 is now only the provider-adapter/data half of calibration work because C1 defined the internal contract earlier. Adapter implementation may begin after C1 is merged and can run in parallel with D1 or later engine work because it consumes, rather than redefines, the CalibrationSet boundary.

Implement one or more institution/provider adapters using explicit provenance, horizon, return basis, volatility/dependence, mapping methodology, licensing, version pinning, and immutable normalized content fingerprints. Do not silently blend providers. If an adapter exposes a deficiency in the C1 contract, repair/freeze C1 through a dedicated synchronization change before continuing adapter and runtime work; do not fork the calibration model inside an adapter.

Company-specific data is added only where exposure is material or explicitly requested.

**User validation:** required before institutional calibration becomes the default basis for user-facing stochastic results. The user should verify source/date disclosure, refresh behavior, and understandable distinction between assumptions and guarantees; numerical ingestion/mapping correctness should be automated.

## 16. A1/R9 — Concentrated positions and equity compensation

### A1 — Private-alpha concentration safeguard

A1 is required before private alpha even if full R9 is deferred. Because A1 shares investment classification/read-model/editor semantics with D1, executable A1 integration begins after D1 is merged. Analysis, specification refinement, and isolated fixtures may proceed earlier, but a parallel A1 branch SHALL NOT independently change the shared investment/compiler/UI surface while D1 owns it.

- detect or allow declaration of material single-issuer concentration;
- show the concentration clearly;
- never silently treat a concentrated individual stock as diversified;
- provide explicit capability diagnostics;
- optionally provide deterministic hold/sell/diversify or price-shock stress scenarios without pretending those shocks are issuer-specific probabilities.

If an intended alpha participant needs concentrated-stock/RSU planning, implement the necessary safe subset or full R9 before onboarding that participant.

### R9 — Full concentrated issuer/equity-compensation model

Resolve the canonical representation of equity awards, then add:

- issuer/sector stochastic refinement;
- RSU vesting/forfeiture/withholding lifecycle;
- employer-stock and human-capital correlation;
- concentrated-tail outputs;
- hold/sell/diversify probabilistic comparisons.

Unvested RSUs remain contingent compensation until an actual modeled vesting event satisfies the conditions and posts the owned shares/cash.

If R9 is not completed before private alpha because the cohort does not require it, it SHALL remain explicitly listed as an unresolved required capability in this roadmap/TODO register. It must not disappear from planning merely because alpha begins.

### L1 — Workplace retirement plan loans (tracked deferred capability)

401(k)/workplace-plan loan mechanics are not an initial private-alpha gate unless an alpha household actually has a plan loan. They remain an explicit tracked requirement under PFA-INV-023, analogous to deferred full RSU support: alpha may proceed without them only when the cohort does not need them.

Implement L1 after the alpha-critical D1/P1 work, preferably alongside the advanced retirement/T1B domain work whose tax/distribution semantics it depends on, unless a participant need pulls it earlier. Before general product support is claimed, L1 must model origination, plan/account economic effect, payroll principal/interest repayment, statutory/plan limits, employment-termination/default/offset behavior, and applicable tax consequences without disguising the loan as a normal withdrawal or consumer debt.

**User validation:** required if A1/R9 or L1 is used by an alpha participant.

## 17. R10 — Probabilistic and planning decision UX

Implement PFA-UX-010 through PFA-UX-013 and make probability/distribution and strategy-comparison outputs understandable. Planning comparison surfaces in R10 require P1 for the enabled decision set; P2 is required only for an enabled automated stochastic optimization/recommendation surface:

- deterministic and stochastic views of the same material metrics;
- deterministic preview auto-refresh after validated committed/debounced edits;
- stochastic rerun only after explicit user action on confirmed/saved changes;
- percentile fan/range charts;
- threshold probabilities;
- liquidity-shortfall probability;
- scenario probability deltas;
- calibration/model-assumption disclosure;
- explicit stale status when model inputs changed after the last stochastic run;
- Forecast Basis visibility sufficient to distinguish apples-to-apples comparisons from historical snapshots;
- ability to rerun two saved plan/scenario definitions under one selected common Forecast Basis for normalized decision comparison;
- clear distinction between a durable saved plan definition and a pinned stochastic forecast snapshot;
- saved-snapshot/recovery management using a count-oriented user model rather than exposing backend byte accounting;
- drill-down to regenerated or retained representative deterministic paths/explanations;
- strategy views that identify material decision differences, goals/constraints, tradeoffs, evaluation fidelity, and capability limitations rather than presenting an unexplained score;
- explicit distinction between a modeled recommendation, a bounded comparison, and any claim of exhaustive optimality.

Retain deterministic views for immediacy, audit, and explanation; do not present them as the single expected future.



**R10 user validation:** required. Closeout instructions SHALL cover comprehension of deterministic versus stochastic views, stale/rerun behavior, probability language, scenario/strategy comparison, recommendation limitations, and whether the result supports an actual planning decision.

## 18. R11 — Private-alpha readiness / stabilization-exit gate

This is the exit gate from the post-PR21 personal-use stabilization period, not the beginning of stabilization.

Before private-alpha infrastructure:

- O1 onboarding dry runs establish and meet an explicit pre-infrastructure time-to-first-useful-forecast/manual-effort target using the intended onboarding paths, and the workflow does not require burdensome field-by-field transcription of the household;
- the assisted-input architecture preserves factual-versus-planning semantic categories, candidate review, provenance, ambiguity handling, idempotency, and the privacy boundary required by PFA-ONB;
- performance, convergence, memory, and per-run compute-cost budgets are documented and met for supported realistic use, with explicit cost-per-rerun measurement/estimation for every enabled stochastic execution placement;
- Golden, realistic-household, and computationally complex/stress fixtures pass their applicable correctness/performance checks and their coverage inventories show the supported product is exercised materially beyond the simple Golden Household;
- **#108** eight intentionally diverse, synthetic, prepopulated alpha households are independently selectable/resettable with zero manual entry and at least four genuine independently saved comparable alternative plans per model (following #105); their available cash flows, liabilities, holdings and supported forecasts reconcile, and advanced unsupported financial/tax outputs are explicitly gated;
- D1 is complete on merged main: every original PFA-DET deterministic use case has an independently specified truth-table test, the combined realistic household reconciles, source-of-funds constraints are enforced, **U1 guided UX is audited/merged, and uncoached product-owner D1 UAT is accepted**; completion of Issue #70 or PR #89 semantic merge alone does not satisfy this gate;
- D2 is complete on merged main: Social Security/pensions, expanded retirement plans and Roth-conversion paths, common consumer debt, Medicare/health premiums/FSA, TIPS/EE bonds, and 529 plans/rollovers have independent deterministic evidence plus D2-D combined-household reconciliation and accepted UAT;
- current-state UI is responsive;
- deterministic forecasts do not block the UI;
- stochastic forecasts are reproducible and convergence metadata is interpretable;
- common-random-number scenario comparison works where applicable and comparison UX distinguishes shared-Forecast-Basis decision comparisons from non-normalized historical snapshots;
- user-facing stochastic outputs have applicable tax/calibration completeness;
- the mandatory PFA-TAX-016 private-alpha tax slice is complete: wash-sale rules, capital-loss netting/carryforward, tax-loss harvesting evaluation, and bounded 1031 exchange mechanics are authoritative and verified;
- major UAT editor/UX defects are resolved;
- caching/persistence cannot make stale results look current or destroy the last successful result on failed rerun; saved plans are independent from derived results; recovery/grace-period behavior, snapshot limits, deduplication, and aggregate-only stochastic storage are exercised;
- A1 concentration safeguards exist;
- P1 deterministic strategy-evaluation foundation **and the bounded deterministic portfolio optimizer required by PFA-INV-024** are implemented for the supported alpha planning decision set, with understandable tradeoffs and capability diagnostics; stochastic optimization/P2/P3 are not required unless an enabled alpha feature depends on them;
- any enabled portfolio-planning or insurance-planning recommendation surface meets the applicable PFA-INV/PFA-INS requirements, while unsupported domains remain explicitly capability-gated;
- full R9 is completed if the initial alpha cohort requires it, otherwise it remains an explicit tracked TODO;
- workplace retirement plan loans (L1/PFA-INV-023) are implemented if an alpha participant requires them; otherwise they remain an explicit tracked post-alpha TODO and are not silently treated as ordinary debt/withdrawals;
- privacy/persistence boundaries remain suitable for personal use.

**User validation:** required. The milestone closeout SHALL provide a focused end-to-end private-alpha readiness checklist. Automated CI/financial verification SHALL pass before asking the user to perform UAT.

Private-alpha infrastructure remains governed by the system/software architecture and begins after this gate. The private-alpha launch itself remains blocked until the O1 onboarding pipeline is wired through the secured shared-service authentication/persistence/privacy boundary and an end-to-end onboarding dry run confirms that the launch target still holds with the deployed architecture.

## 19. P3 — Integrated cross-domain financial planning and optimization

P3 is the long-term integration track after P1 and the applicable domain capabilities mature; it additionally depends on P2 for stochastic automated optimization. It combines supported planning decisions across portfolio/investments, taxes, insurance, retirement, debt, liquidity, and other future domains without moving their financial formulas into the optimizer.

As tax coverage matures, P3 explicitly includes comprehensive applicable-law tax-strategy optimization across supported federal, state, local, and other tax rules. Tax-sensitive search SHALL remain grounded in the authoritative tax engine's jurisdiction composition, multi-period state, rule versions, and explicit unresolved legal predicates. The planning objective SHALL remain the household's broader supported financial goals rather than tax minimization in isolation.

P3 SHALL remain capability-composable: portfolio-only, tax-aware portfolio, tax-strategy, and broader integrated planning may be exposed independently or together. Future product tiers MAY gate access to larger planning suites, search breadth, or higher-cost evaluation, but commercial entitlements SHALL NOT change authoritative financial semantics or make a lower tier silently less correct within an enabled capability.

P3 SHALL use progressive evaluation rather than brute-force high-fidelity Monte Carlo across every possible combination:

```text
feasibility/rule screening
        ↓
fast deterministic evaluation
        ↓
candidate generation/search
        ↓
bounded stochastic evaluation
        ↓
eliminate dominated/unpromising candidates
        ↓
higher-confidence finalist evaluation
        ↓
explain material tradeoffs and limitations
```

The portfolio capability (PFA-INV) and insurance capability (PFA-INS) may be implemented incrementally as real planning use cases require them. Full P3 is not a blanket R11/private-alpha prerequisite; however, the product SHALL NOT market or present an unsupported domain as part of a comprehensive recommendation.

**User validation:** required for each integrated planning surface introduced to normal users.

## 20. Explicit deferred-capability/TODO register

The following items SHALL remain visible until closed:

- **Full concentrated issuer + RSU/employer-risk stochastic modeling (R9):** conditional pre-alpha, but mandatory future capability if not completed before alpha. Trigger earlier if an intended participant has material concentrated stock or equity compensation.
- **Advanced portfolio-planning depth (PFA-INV):** allocation optimization beyond the required deterministic floor, broad rebalancing policy, account-location optimization, security selection, and other advanced planning may remain incremental. The D1+D2 deterministic account/instrument/contribution/conversion/funding mechanics named by PFA-DET/PFA-INV are **not deferred** and are required before R5.
- **Advanced insurance planning (PFA-INS):** probabilistic claims, coverage optimization, underwriting/product-specific recommendation logic, and unsupported policy families may remain incremental. D1 deterministic premiums/payouts plus D2 health-insurance and Medicare premium mechanics required by PFA-DET/PFA-INS are **not deferred** and are required before R5.
- **Stochastic strategy optimization (P2):** may remain post-alpha if alpha offers explicit scenario/strategy comparison rather than automated optimization; trigger before exposing an automated stochastic strategy recommendation.
- **Integrated cross-domain optimization (P3):** long-term product capability spanning the supported tax, investment, insurance, retirement, debt, liquidity, and future planning domains, including comprehensive applicable-law tax-strategy optimization as rule coverage matures. It is intentionally not a blanket private-alpha prerequisite, and its domain modules remain independently exposable through capability-scoped planning.

- **Contextual education and conversational what-if financial guide (PFA-ADV):** future, optional capability that explains financial concepts and source-backed forecasts *and* helps users create and simulate alternate financial plans from conversation. It asks for missing planning inputs, distinguishes illustrative assumptions, presents editable draft changes, explains comparable tradeoffs, and requires explicit approval before independently saving a plan. **No financial/securities advice, position recommendations, or autonomous authoritative edits.** Depends on existing O1 candidate/provenance semantics, P1 independent plan/scenario management (#105), authoritative simulations, and U1 accessible chart/explanation surfaces. This additional advisor feature is not a P1/#105/R11/private-alpha requirement. **Trigger:** post-alpha gated feature planning after accepted plan authoring and the requisite privacy/provider/tool-boundary review; alpha education-only experiments remain optional.
- **AI tool orchestration gateway (future implementation choice):** evaluate a provider-neutral, read-only-first, typed/permission-controlled gateway for authoritative contextual reads, user-directed candidate-plan authoring, simulation preview/comparison and explicit save approval. The conversational plan workflow is an approved future *product requirement*; its exact gateway architecture is undecided. **Trigger:** stable P1/#105 identity, authoring, preview/run and approval seams with a demonstrated user workflow; not mandatory for O1/P1 or R11.
- **MCP adapter for external AI clients (future idea):** consider an authenticated MCP surface over explicitly reviewed gateway operations so participating external assistants could inspect authorized finance results. Requires cross-household authorization, privacy, provider consent and threat review. **Trigger:** real external-client demand and a secured shared-service architecture; not a substitute for the embedded contextual guide.
- **Optional ChatGPT-plan allowance / API provider path (future idea):** evaluate participating-app Sign in with ChatGPT delegated plan usage, subject to commercial availability/eligibility; retain separately billed API-provider fallback and explicit user-facing usage budgets. **Trigger:** post-alpha cost/privacy/vendor evaluation. Ordinary ChatGPT subscriptions alone do not grant API billing credits.

Additional deferred capabilities may be added here only with an owner/trigger or planned milestone; deferral SHALL NOT silently erase a requirement.
