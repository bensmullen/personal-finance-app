# Goal-driven development framework

**Decision:** four-phase direction and authority model approved by the PM.  
**Delivery owner:** [goal #362](https://github.com/bensmullen/personal-finance-app/issues/362).  
**Status:** implementation reference, not an enabled runtime or a declaration of readiness.  
**Planning baseline:** `528520738a46c8f4d117990e5c421908fcb47b8c`, recorded 2026-11-24.

## Purpose and authority

Deliver autonomous creation and launch of bounded tasks inside approved goals, verified hybrid local/cloud execution, safe parallel development, independent QA, and eventually delegated eligible merges. Optimize accepted capability delivery per total coordinator and worker usage while reducing routine PM work. Financial correctness, provenance, privacy and human UAT authority remain stronger constraints than throughput.

This package defines implementation requirements; current `AGENTS.md`, handoff, verification and learning policies remain operative until reviewed changes implement the relevant transition. The PM's approval of this direction is not a command to enable Goals, subagents, unattended bootstrap or automatic merging immediately. No API-billed fallback, real financial data, unconditional write grant or self-approved weakening of controls is authorized.

Repository financial/capability specifications retain precedence. This is a separate engineering track: existing D1, D2 and private-alpha gates are neither changed nor blocked by this framework project.

## Where information lives

| Information | Authoritative location | Update trigger |
| --- | --- | --- |
| Stable outcome, requirements and phase exits | This package and `plan.json` | Approved scope/interface change, not every task turn |
| Current task authorization and acceptance | Original child GitHub issue | Initial handoff, scope correction, substantive audit |
| Goal progress, phase decisions and current blockers | #362 | Phase exit, meaningful blocker, pilot or activation change |
| Change and execution evidence | Exact PR/commit, CI jobs and bounded artifacts | Actual execution; preserve SHA and coverage |
| Usage/performance observations | Versioned metric artifacts linked from #362 | Baseline, pilot, material experiment; unknown is not zero |
| Stage/dependency allocation | Existing milestone issue register, then GF-02's validated migration | Delivery-graph change; never duplicate live completion status |
| Historical investigations | Linked issue comments/artifacts | Superseded operative context |

The issue/PR state is live; this document is not a second status spreadsheet. A merged technical PR is not necessarily accepted phase or goal completion. Dot memory is a convenience, never the source of approval, financial truth or execution ownership.

## Implementation sequence

| Package | Issue | Phase | Prerequisites | Coherent deliverable |
| --- | --- | --- | --- | --- |
| GF-01 | [#363](https://github.com/bensmullen/personal-finance-app/issues/363) | P1 | Merged planning package | Goal/authority/APIV and versioned pure contracts |
| GF-02 | [#364](https://github.com/bensmullen/personal-finance-app/issues/364) | P2 | GF-01 | GitHub operational metadata migration with equivalence and rollback |
| GF-03 | [#365](https://github.com/bensmullen/personal-finance-app/issues/365) | P2 | GF-01 | Idempotent lifecycle, scope reauthorization and workspace safety |
| GF-04 | [#366](https://github.com/bensmullen/personal-finance-app/issues/366) | P2 | GF-01 | Exact-head evidence and applicable-household pre-UAT gate |
| GF-05 | [#367](https://github.com/bensmullen/personal-finance-app/issues/367) | P2 | GF-01 | Usage, reservations, model profiles and safe compact context |
| GF-06 | [#368](https://github.com/bensmullen/personal-finance-app/issues/368) | P3 | GF-02–05 and accepted P2 | Certified local/cloud adapters and bounded continuation |
| GF-07 | [#369](https://github.com/bensmullen/personal-finance-app/issues/369) | P3 | GF-06 | Parallel scheduler and supervised multi-task pilot |
| GF-08 | [#370](https://github.com/bensmullen/personal-finance-app/issues/370) | P4 | Accepted GF-07/P3 | Disabled-by-default merge/UAT controller |
| GF-09 | [#371](https://github.com/bensmullen/personal-finance-app/issues/371) | P4 | GF-07 and GF-08 | Measured optimization, mutation assurance and final rollout pilot |

GF-02–05 have separate primary write ownership and can be planned in parallel after GF-01. Start with at most two implementation writers; choose lanes using live file AND interface/state/fixture ownership, not filenames alone. Shared control changes serialize. GF-06 waits for P2 and owns integration into the existing hooks/configuration; GF-08 follows the supervised pilot; GF-09 follows the earlier verification-workflow changes. Product D2 work may continue on genuinely disjoint ownership. No child depends on its parent issue: parenthood is containment, not a cyclic execution dependency.

Each issue contains its actual V3 contract, bounded paths, acceptance, negatives, exclusions and requirements/test IDs. One issue normally owns one independently reviewable PR outcome, with coherent repair turns on that same issue. Read-only discovery and internal steps do not automatically create extra issues. A large known path inventory is preferable to repeated undiscovered callers; unrelated outcomes still split.

## Phase exits and permissions

### P1 — authority and contracts

Deliver tested schemas/validators, APIV inheritance, decision classes, scope-census and evidence identities. Exit requires positive and adversarial cases for stale/revoked approval, invalid transitions, missing branches and unauthorized writes. Alignment and planning are goal-level reusable decisions, not four expensive agent ceremonies on every edit. No autonomous execution is enabled.

### P2 — deterministic coordination and assurance

Deliver metadata migration, event/lifecycle/workspace controls, evidence/household applicability registry, resource/context policy and initial measurable baseline. Exit requires preserved existing stage obligations; denied dirty/foreign/stale grants; duplicate/crash recovery; missing or wrong-head evidence rejection; household/visual blockers refusing UAT readiness; and honest unknown quota/metrics handling. Offline tests must be cheap and network/model-free. Live migration occurs only after shadow equivalence and independent review; ordinary task assignment then needs no register-only PR. No native launch is enabled by passing unit tests.

### P3 — verified hybrid orchestration

Deliver certified adapters and a supervised real pilot with at least two coherent verified PR outcomes, a safe parallel pair and a meaningful failure/dependency recovery. Prove actual local and cloud control compatibility separately. Unsupported/unavailable native features remain explicitly blocked; mocks cannot certify them. Model/effort and quota/context telemetry are capability probes, not assumed product promises. PM still merges. The goal may proceed in a documented local-only mode while cloud is unavailable, but full hybrid P3 acceptance remains unmet.

### P4 — controlled delivery and improvement

Deliver independently audited merge/UAT gates, targeted mutation assurance, matched-cohort efficiency evidence, a fault-injected multi-PR final pilot, explicit activation and kill-switch/manual-V3 rollback. Demonstrate both an eligible merge and a correctly held UAT-required merge. All applicable supported households must have financial and real-UI evidence before PM UAT. Zero unauthorized writes/merges or UAT bypass is mandatory; target efficiency improvements cannot excuse safety failures. Final phase/goal acceptance remains separate from a PR's technical completion.

## Runtime decision boundaries

Autonomous after implementation/certification: prioritize approved work, prepare bounded child contracts, do read-only discovery, resolve implementation details, make justified same-issue Level-1 scope corrections, launch certified writers, diagnose all sibling failures and perform bounded repairs. Initial defaults are two implementation writers, two justified read-only workers, a configurable 20% allowance reserve and at most two unchanged-root-cause repair attempts before a different diagnostic approach or escalation.

PM-owned: material financial/product/privacy/security decisions, changed release commitments, actual required UAT and rollout activation. Delegated merge eligibility requires independent exact-head evidence, current authorization, safe integration state and no outstanding PM gate. Agents cannot approve or merge a change weakening their own governing controls. While one PM decision is pending, continue independent approved work rather than invent the missing decision.

## Dispatch and maintenance protocol

Before any implementation: confirm the planning PR and dependencies are merged and accepted, refresh the live issue and scope census, validate saved bytes with the actual V3 parser, check live branch/PR ownership, then obtain the real operator `PR_WORKTREE_READY`. A parser pass is not worktree readiness. The current operator-owned bootstrap remains until a certified supervisor replaces that role under GF-06.

After a substantive audit, update the original issue with accepted/unmet criteria, exact PR/head/checks/artifacts, classified defects and next authorized action. Archive old narrative in comments. Re-fetch and revalidate changed contracts. Update #362 at meaningful phase events only. Use compact summaries with verified references; do not duplicate logs, financial proofs or fixture catalogs into every task.

Read [requirements](requirements.md), [interfaces](interfaces.md), and [verification/metrics](verification-and-metrics.md) for the implementation/test reference. The machine [plan](plan.json) maps all owners, dependencies, requirements and verification cases. The lightweight plan checker validates this mapping; its success is not implementation, native compatibility or financial acceptance.
