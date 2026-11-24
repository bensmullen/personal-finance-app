# Goal-driven development framework

**Decision:** four-phase direction and authority model approved by the PM.  
**Delivery owner:** [goal #362](https://github.com/bensmullen/personal-finance-app/issues/362).  
**Status:** implementation reference, not enabled runtime or task readiness.  
**Planning baseline:** `528520738a46c8f4d117990e5c421908fcb47b8c`, recorded 2026-11-24.

## Purpose and authority

Deliver autonomous bounded tasks inside approved goals, verified hybrid local/cloud execution, safe parallel development, independent QA and eventually delegated eligible merges. Optimize accepted capability delivery per TOTAL coordinator/worker usage, without trading financial correctness, privacy or human UAT authority for throughput.

Current AGENTS, handoff, verification and learning policies remain operative until reviewed changes implement the relevant transition. Planning approval enables neither native Goals/subagents, unattended bootstrap nor merges. No paid API fallback, real financial data, blanket paths or self-approved weakening of controls. Existing D1/D2/private-alpha obligations are unchanged; this engineering track is not a new product prerequisite.

Read [requirements](requirements.md), [interfaces](interfaces.md), [verification and metrics](verification-and-metrics.md), and the detailed [audited safety controls and incremental rollout](safety-and-rollout.md). The latter makes budget/cancellation, approval isolation, app performance and rollout edge cases explicit acceptance; it does not replace these requirements. [plan.json](plan.json) maps owners, dependencies, verification and recommended delivery waves.

## Source of truth

| Information | Location | Update trigger |
| --- | --- | --- |
| Stable requirements, interfaces and exits | This package | Approved scope/interface change |
| Current task scope and acceptance | Original child issue | Handoff, cohesive scope correction, substantive audit |
| Progress, blockers and activation | #362 | Accepted increment, phase, pilot or material decision |
| Actual execution evidence | Exact PR/head, all selected CI and bounded artifacts | Execution; preserve provenance and coverage |
| Usage/performance | Compact versioned artifacts linked from #362 | Prospective baseline and each adopted increment |
| Stage allocation | Existing register until GF-02's reviewed migration | Delivery-graph change, never daily status |
| Superseded history | Linked comments/artifacts | Operative context replaced |

Dot memory, issue closure and a merged technical PR are not approval, native compatibility or goal completion. Do not maintain a second status spreadsheet in repository files.

## Implementation contracts and dependencies

| Package | Issue | Phase | Prerequisites | Deliverable |
| --- | --- | --- | --- | --- |
| GF-01 | [#363](https://github.com/bensmullen/personal-finance-app/issues/363) | P1 | Planning PR merged | Pure authority/APIV and versioned contracts |
| GF-02 | [#364](https://github.com/bensmullen/personal-finance-app/issues/364) | P2 | GF-01 | Lossless operational metadata migration |
| GF-03 | [#365](https://github.com/bensmullen/personal-finance-app/issues/365) | P2 | GF-01 | Idempotent lifecycle and workspace safety |
| GF-04 | [#366](https://github.com/bensmullen/personal-finance-app/issues/366) | P2 | GF-01 | Evidence and applicable-household pre-UAT gate |
| GF-05 | [#367](https://github.com/bensmullen/personal-finance-app/issues/367) | P2 | GF-01 | Usage, reservations, models and safe context |
| GF-06 | [#368](https://github.com/bensmullen/personal-finance-app/issues/368) | P3 | GF-02–05; accepted P2 | Certified local/cloud adapters |
| GF-07 | [#369](https://github.com/bensmullen/personal-finance-app/issues/369) | P3 | GF-06 | Parallel scheduler and supervised real pilot |
| GF-08 | [#370](https://github.com/bensmullen/personal-finance-app/issues/370) | P4 | Accepted GF-07/P3 | Disabled-by-default merge/UAT controller |
| GF-09 | [#371](https://github.com/bensmullen/personal-finance-app/issues/371) | P4 | GF-07, GF-08 | Measured optimization, mutation and final pilot |

**Recommended dispatch order:** #363 → #367 + #366 → #365 → #364 → #368 → #369 → #370 → #371. This prioritizes early baseline/cost observation and existing-evidence reuse, then safe operator helpers, before migration and autonomous operation. It is a priority order within the unchanged dependency graph, not additional product gates. Parallel read-only preparation remains useful; actual writers require disjoint files AND logical interfaces/state/fixtures. Start globally with two writers and two read-only workers; pause new implementations when two published outcomes await review.

Do not postpone all benefit until Dot is available: accept independently useful operator-run reports, scope/preflight checks and shadow migration in P2. Record measured friction/cost before wider adoption. Probe unsupported native capabilities read-only in P1; certify paid/native execution only with enforced budgets and stop behavior in P3. Shadow scheduling precedes one live writer, which precedes two. Goals/subagents remain opt-in, not a default fan-out. Detailed increment/canary gates are in safety-and-rollout.md.

One issue normally owns one coherent reviewable PR outcome, including its internal checkpoints and related repairs. Do not create micro-issues, bootstrap tasks or scope PRs for every step. Complete reachable-path discovery beats repeated one-file permission repairs. Parent containment is not a cyclic task dependency.

## Phase exits

**P1:** Tested goal/authority/APIV, scope census and evidence identities; adversarial stale/revoked/ambiguous approval, unsafe scope and invalid transition cases. Read-only compatibility/trust inventory identifies unavailable interfaces before costly integration. No execution activation.

**P2:** Independently useful metric/evidence and supervised workspace tools; complete legacy-obligation migration equivalence and rollback; denied dirty/foreign/stale grants; bounded duplicate/crash recovery; honest quota and context behavior; wrong-head/household/visual gaps refuse UAT. Native execution is not certified by mocks. Only after shadow proof and review does ordinary issue allocation cease requiring register-only PRs.

**P3:** Actual local and cloud certification, then a supervised pilot with at least two coherent verified PR outcomes, safe parallelism and a real blocker/recovery case. Unsupported modes remain explicit; local-only operation can preserve earlier benefits but does not complete hybrid acceptance. PM still merges. Model selection, account quota, event wakeups and stop controls must be verified, not inferred from product names.

**P4:** Independently audited merge/UAT controls, isolated targeted mutation, matched-cohort efficiency evidence and final fault-injected pilot. Prove an eligible canary merge and a correctly held UAT-required merge before broader explicitly approved activation; no circular requirement to enable production merging before testing it. Demonstrate kill switch and manual-V3 rollback. All applicable households and actual UI journeys pass before PM UAT. Zero known authorization/merge/UAT bypass is mandatory.

## Decision, dispatch and maintenance boundaries

Autonomous only after applicable implementation/certification: choose approved ready work; discover scope; resolve implementation details; prepare child contracts; make justified same-issue Level-1 corrections between closed turns; launch certified workers and repair within cumulative budgets. Financial/product/privacy/security decisions, release changes, actual UAT and rollout activation remain PM-owned. A shared GitHub login cannot authenticate a human approval. Independent QA is not implementer self-certification.

Before dispatch, re-read saved V3 and current dependencies, audit affected scope once, validate actual parser, check live branch/PR and real operator PR_WORKTREE_READY. Do not infer local cleanliness from remote fetch. Bootstrap remains operator-owned until a certified supervisor is activated. Native inability to cap/stop a run or fence a merge is a capability blocker, never permission to bypass safety.

After substantive review update the ORIGINAL issue with accepted/unmet criteria, exact PR/head/checks, classified failures, scope provenance and next action; re-fetch/revalidate changed contracts. Preserve compact history by reference. Summarize accepted increments and phase/metric/activation changes on #362, not every poll. The lightweight checker establishes mapping and syntax ONLY; it neither starts tasks nor proves runtime safety or financial completion.
