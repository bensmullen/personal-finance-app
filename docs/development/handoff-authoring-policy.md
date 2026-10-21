# Handoff Authoring Policy

**Status:** required for Personal Finance App implementation/repair handoffs  
**Owner:** ChatGPT semantic/architecture planning layer  
**Purpose:** give Codex enough resolved product/architecture context to implement correctly without turning the prompt into a brittle machine protocol.

## 1. Separate authorization from semantics

A Codex handoff has two layers:

1. a compact machine-enforced `PFM_TASK_V3` authorization; and
2. a human/model-readable semantic implementation brief.

The hook validates only the authorization layer. The semantic brief is still
authoritative implementation guidance, but it is not rejected because a
particular heading, marker, evidence phrase, or profile field is missing.

This is deliberate. Hooks protect unsafe actions and edit scope; ChatGPT
planning plus CI/audit protect semantic completeness.

## 2. Required V3 authorization

Every mutation-capable handoff starts with:

```
PFM_TASK_V3
TASK_KIND: product|framework|repair
TARGET_BRANCH: codex/...|agent/...
DEPENDENCY_POLICY: locked|manifest_edit

ALLOWED_PATHS:
- <authorized path>
- <authorized subtree/**>

OBJECTIVE:
<concise outcome>

ACCEPTANCE:
<concise completion conditions>
```

Nothing else is machine-required.

### Preferred transport for long/cross-cutting tasks

When the semantic brief is long enough that Codex Desktop may transform pasted
content, ChatGPT SHALL create a repository GitHub Issue whose body starts with
the complete V3 authorization above and then contains the audited semantic
contract. The Codex composer receives only:

```
PFM_TASK_ISSUE: <issue-number>
```

The UserPromptSubmit hook fetches that open issue from
`bensmullen/personal-finance-app`, validates the V3 authorization, binds the
resolved contract to the task state, and injects the complete issue body into
Codex context. The issue pointer is the machine transport; the issue body is the
repository-owned handoff.

Do not use candidate/learning issues as task authorization. A task issue is a
purpose-built transport artifact and does not become normative product
documentation.

Simple short tasks may still use inline V3 authorization. Generated attachment
transport remains compatibility fallback, not the preferred path for a long
handoff.

Do not put a starting SHA or worktree policy in the task authorization. Git
initialization is owned by `tools/codex/bootstrap-pr.sh`, which resolves fresh
remote state before Codex starts.

Do not put read paths in the authorization. Codex may inspect implementation
resources needed to execute the resolved task; only writes are hard-scoped.

## 3. Authoring sequence

Before emitting an implementation/repair handoff, ChatGPT SHALL:

1. inspect the current repository and the narrow authoritative specification or
   roadmap material needed for the task;
2. consult `docs/development/agent-learning-policy.md` and the active lesson
   ledger before issuing implementation instructions;
3. consult the live issue-to-milestone register at `docs/development/milestone-issue-register.json` and its policy, reconcile current GitHub issue statuses, and verify that the task's owner stage/dependencies/mandatory closeout gate are allocated; do not silently skip an unresolved required issue or treat a planning backlog entry as V3 task authorization;
4. resolve material semantic/architectural decisions rather than delegating
   those decisions to Codex;
5. identify the smallest defensible `ALLOWED_PATHS`;
6. state the objective and acceptance conditions clearly enough that Codex can
   tell whether implementation is complete;
7. describe material failure/partial/unsupported/stale/cancelled/error behavior
   when relevant;
8. distinguish supported claims from deferred/not-measured/not-applicable areas;
9. keep expensive representative/stress/scaling/convergence/provider evidence
   outside ordinary CI unless the repository verification policy explicitly
   assigns a bounded correctness workload to CI;
10. perform a contradiction/negative-space review before handing off.
11. preview how the proposed edits affect selected GitHub CI gates and
    existing test expectations, including type/build, accessible selectors,
    state transitions, fixtures, viewports, integration boundaries, and
    independently runnable acceptance journeys where relevant. Trace any new
    exact pixel/layout/test threshold to an approved requirement or defensible
    domain invariant; do not invent stricter numeric acceptance gates from
    qualitative product language. Identify potentially obsolete tests for
    reviewer classification rather than letting Codex silently delete them.

For a repair caused by CI, include the classified root cause and any
sibling or downstream tests vulnerable to the same issue, so that a patch
addresses the complete failure class rather than only the first failing
assertion. Do not use extra required task-envelope fields or a blanket E2E
execution requirement for this preview.

The brief should be as short as the task allows. Complexity belongs in the
semantic decisions themselves, not in mandatory envelope ceremony.

### Live issue readiness gate before recommending Codex (mandatory)

Immediately **before** telling the product manager to bootstrap, resume, restart, or submit `PFM_TASK_ISSUE: N` to Codex, ChatGPT SHALL:

1. Re-fetch the **live GitHub issue** (body, state, target branch and `PFM_TASK_V3` envelope) and the associated live PR/branch after all planned issue mutations. Do not rely on earlier reads, old conversation summaries, or Codex's self-reported completion.
2. Confirm that the issue remains open, is a valid implementation task, contains an actionable **current** self-contained repair contract and `ALLOWED_PATHS`, and identifies a concrete Codex-owned next step. Verify dependencies/required product decisions are resolved, relevant evidence and scope are current, and there is no pending reviewer-/PM-owned CI, benchmark, external lookup, approval or worktree operation **declared as a prerequisite to starting Codex**.
3. Search the **entire issue body**, not just its newest checkpoint, for contradictory instructions such as `do not restart`, `blocked`, `wait for measurements`, `may proceed`, obsolete branch/bootstrap gates or mutually exclusive acceptance claims. Consolidate or explicitly supersede historical gates in the GitHub issue **before** recommending restart. Re-read the resulting saved body; do not assume the write succeeded. Historical evidence belongs in issue comments, not conflicting live instructions (AL-002).
4. Confirm Git branch and worktree prerequisites separately: no unmerged prerequisite branch or competing shared-file writer, verify `main` integration where necessary, and direct Git synchronization **outside** Codex's active task. Never infer that remote readiness proves the user's local checkout is clean.
5. Give a **positive Codex-ready verdict** only when all above pass, including a verified latest issue update and a specific `PFM_TASK_ISSUE: N` target. Otherwise **do not instruct the PM to resume Codex**: state the exact outstanding non-Codex action, perform any reviewer-owned action available, and keep the issue explicitly marked not start-ready until its preconditions are satisfied.

This is a ChatGPT planning/handoff requirement, not a new V3 parser marker or Codex hook, and does not authorize polling CI inside Codex. A future CI verification requirement may remain as a **post-push merge gate** when it is not a prerequisite for the next implementation turn. State clearly which applies.

## 4. Recommended semantic brief

For simple tasks, objective + acceptance + a few implementation constraints may
be sufficient.

For cross-cutting or financially sensitive tasks, include the useful concepts
from the previous V2 framework, but as prose rather than parser requirements:

- resolved decisions and authoritative ownership;
- requirement → implementation → evidence mapping;
- failure modes and state transitions;
- claims and known gaps;
- concurrency/cache/persistence/performance boundaries;
- CI versus heavy-validation ownership;
- UAT when a human workflow must be validated;
- explicit out-of-scope items;
- exact stop/lookup conditions.

These sections are planning aids. Hooks do not require their names or syntax.

**Type-contract preflight (read-only, without running local commands):** When the change creates or alters typed test fixtures, compiler adapters, overloaded function calls or optional-field overrides, read the target signatures and the repository's strict TypeScript configuration before specifying/issuing the implementation handoff. Explicitly check literal overload dispatch, exact optional-property semantics, required-field preservation, replay input/result tier and test-assertion provenance. Record expected typecheck risks in the task issue. Codex performs this as static code inspection while editing, not a typecheck command. GitHub-hosted typecheck remains the first automated authority. Do not reroute all CI behind typecheck: independent gates remain parallel.

## 5. Edit-scope design

`ALLOWED_PATHS` remains the strongest task-specific guardrail.

Choose paths narrowly enough to prevent unrelated cleanup but broadly enough to
avoid needless framework repairs. Prefer a cohesive subtree when several files
within that subtree are expected to change.

Product/repair handoffs must not authorize framework-control paths. A task that
needs to modify agent policy, hooks, CI orchestration, or agent-learning policy
is a framework task.

Adding a required file outside the authorized scope is not permission for Codex
to broaden the task. Codex reports a blocker/lookup need; ChatGPT issues a new
authorization if the scope change is justified.

### Parallel Codex development preflight

When multiple tasks could run concurrently, ChatGPT SHALL first check that
their architectural decisions are resolved and their prerequisites are satisfied.
Prefer parallel issues/branches only when interfaces are stable, edit ownership
is clear, and independently testable scopes minimize conflict. Identify shared
files/contracts, integration ownership, and merge order explicitly. Do not split
a coherent task solely to create parallelism, and do not start dependent tasks
from an unmerged prerequisite. This is planning guidance, not a new V3 parser
field or a requirement for every one-file repair.

Independent CI checks should remain parallel under the verification planner.
Do not duplicate expensive checks in Codex turns or move heavy workloads into
ordinary CI to obtain parallelism.


## UX design-ready handoff for substantial user-facing changes

For major changes to navigation, multi-screen authoring, onboarding, complex financial forms, repair flows or forecast interpretation, consult `.agents/skills/pfm-ux-review/SKILL.md` before the Codex implementation handoff. The ChatGPT planning/review layer owns a concise task-first interaction contract and approved reference state (rendered screenshots/prototype where applicable). Product ownership, source-of-truth and financial limitations remain governed by PFA-UX-015–023 and financial specifications. The owner approves material design/experience tradeoffs; do not leave them for Codex to invent.

Visual evidence and interaction diagnosis are collected outside Codex implementation turns using the manual UX evidence workflow or another independent browser review. Codex's ban on local servers, Playwright and CI polling is unchanged. Codex receives the reference/evidence plus scoped acceptance criteria and can implement autonomously within the V3 contract. A small isolated copy, layout or accessibility repair with no altered journey/ownership does **not** need a new design prototype or a product-wide audit. Independent post-implementation visual/semantic review and uncoached human UAT remain separate from CI.

Parallel UX research and backend/D2 work are encouraged when owned paths and stable interfaces do not overlap; explicitly identify prerequisites, shared seam ownership and merge order. Stop repeated cross-journey patch cycles after two failed same-cause repair rounds and return to focused design review rather than widening an implementation issue.

## 6. Git handoff lifecycle

Git bootstrap is an **external operator action performed before the Codex
implementation turn**. A task issue must not instruct Codex to invoke the
bootstrap helper during the implementation turn.

Before the Codex task is submitted, prepare the branch/worktree from remote
state:

New PR:

```
bash tools/codex/bootstrap-pr.sh new codex/<branch> [worktree-path]
```

Existing PR:

```
bash tools/codex/bootstrap-pr.sh resume codex/<branch> [worktree-path]
```

ChatGPT-created PR branches use the same resume flow with `agent/<branch>`.

The bootstrap receipt is the Git-state authority for task initialization.
Because it fetches `origin` first, the handoff does not need an
`EXPECTED_HEAD` field and does not depend on local `main` being current.

After bootstrap, open the reported worktree path in Codex and submit the handoff
whose `TARGET_BRANCH` matches the prepared branch. Once Codex is running in a
clean linked feature worktree on that branch, bootstrap is satisfied for that
turn. SessionStart and task instructions must say so rather than directing Codex
to rerun bootstrap from inside the prepared worktree.

## 7. Completion protocol

### Continuation and preservation

Usage-limit/manual interruptions may bypass Stop. Resubmitting the same task issue
in the same worktree/branch permits guarded recovery only with a persisted active
task receipt. Inline/attachment continuations require an identical contract hash.
The most recent receipt is bound to the worktree and task state; missing, stale,
closed, or ambiguous provenance does not authorize inherited dirty work.

All dirty and prior committed paths must satisfy both prior and incoming scope,
TASK_KIND control-path rules, and dependency policy. Detached/drifted branches,
unmerged/conflict-marker state, active Git operations, or unknown/divergent remote
state block recovery. The hook stages only verified dirty paths, creates a labeled
WIP checkpoint, pushes ordinarily to the authorized origin branch, and verifies
cleanliness and remote/tracking equality. Recovery sets BASE_HEAD after the
checkpoint so preservation cannot satisfy the next turn's implementation guard.

Normal BLOCKED/LOOKUP_REQUIRED stops use the same checkpoint safety checks for
eligible dirty work. Checkpoints never imply acceptance or verified/merge-ready
work. Failed staging, commits, or pushes preserve data and give an actionable
STATE_RECOVERY_REQUIRED reason. No automatic stash, reset, clean, branch switch,
force push, amend, rebase, or history rewrite is permitted.

### Escalation boundary

Codex SHALL self-resolve implementation-only choices using repository authority
and the smallest architecture-consistent implementation inside ALLOWED_PATHS,
provided the choice does not change user-visible financial meaning. Code structure,
type shapes, accumulators, and module placement are not product-owner decisions.

LOOKUP_REQUIRED/BLOCKED is appropriate for unresolved product/financial semantics,
unavailable external authoritative facts, additional authorization, unsafe
prerequisite state, or materially different user-visible economic outcomes.
Inspect the relevant authority before escalating; then provide:

```text
DECISION_NEEDED: <one sentence describing the product decision>
PRODUCT_IMPACT: <what changes for users or financial behavior>
OPTIONS: <only materially different choices>
RECOMMENDATION: <preferred option when supportable>
TECHNICAL_REASON: <short explanation>
```

Authorization-only requests include the exact scope path needed. State product
meaning before implementation vocabulary. The task skill's D1-B refinance example
illustrates a valid decision: scheduled monthly payment dates versus arbitrary
calendar dates requiring partial-month interest semantics. That choice changes
the supported user capability and must not be silently decided as a code detail.
Hooks do not call ChatGPT/OpenAI; the concise block supports human relay.

Acceptance is enforced mechanically where the repository can prove it.

Codex may report:

```
TASK_STATUS: COMPLETE
ACCEPTANCE_STATUS: SATISFIED
```

only after the feature branch is clean, contains implementation commits after
the task-start HEAD, stays within allowed paths, and is pushed/up-to-date with
its tracking branch.

When external information, authorization, or scope prevents safe completion,
Codex reports:

```
TASK_STATUS: BLOCKED
BLOCKER: <specific reason>
```

or `LOOKUP_REQUIRED: <exact missing fact>`.

The Stop hook does not judge financial semantics or substitute for CI. It
prevents false mechanical completion and leaves semantic verification to GitHub
CI, engineering-validation, UAT, and ChatGPT audit.

## 8. Learning-loop interaction

Active lessons are planning inputs, not prompt-parser dependencies.

ChatGPT applies relevant active lessons while constructing the semantic brief.
If a lesson becomes a universal base contract, codify it in the framework and
retire the lesson rather than forcing every future prompt to carry marker text.

Candidate issues never enter Codex prompts automatically.

## 9. Direct ChatGPT GitHub maintenance

When the product manager explicitly authorizes a small documentation,
specification, roadmap, governance or bounded CI-policy correction, ChatGPT may
implement it directly via a focused `agent/` GitHub PR without opening a Codex
implementation task. Inspect current file versions and affected validators,
preserve manifest/requirement and milestone-issue traceability when applicable,
and wait for latest-head selected CI before claiming merge readiness. Keep
substantial application/engine development and unresolved product decisions in
the usual architecture -> V3 issue -> Codex implementation process. A directly
authored PR is still subject to independent review and product-manager merge
approval. The ChatGPT direct-edit path does not loosen Codex mutation hooks.

## 10. Post-implementation audit and issue synchronization

After each substantive Codex implementation/repair audit, ChatGPT SHALL reconcile
the **existing GitHub implementation issue** with the latest observed PR and
requirement state before declaring a repair handoff ready. The issue remains
Codex's authoritative next-turn contract, not just a record of its initial
authorization. Use a short, dated **Current audit checkpoint** in the issue body,
preserving the original V3 authorization at the beginning and historical audit
evidence instead of overwriting earlier claims without explanation.

The current checkpoint SHALL distinguish:

1. **Implementation status:** implemented and evidenced, implemented but
   unverified, partially implemented, not implemented, or blocked. Cite the
   specific PR/commit and latest relevant CI, audit, or UAT evidence. Codex's
   `TASK_STATUS: COMPLETE` does not establish CI success, semantic acceptance,
   merge readiness, or product-owner UAT.
2. **Remaining work:** each material defect or unsatisfied acceptance criterion,
   expected behavior and negative/boundary cases, verification required, and
   whether work is needed before merge or at a later explicitly authorized gate.
3. **Scope additions or corrections:** newly discovered requirements, changed
   acceptance criteria, required `ALLOWED_PATHS`, prerequisites, and exclusions.
   Clearly distinguish **proposed / decision pending** work from **approved**
   Codex authorization. Do not silently widen financial semantics, task scope,
   edit paths, or milestone commitments.
4. **Disposition and next action:** merge-ready, needs patch, or blocked; any
   required product decision; remaining CI/heavy-validation/UAT; and the exact
   existing issue/PR/branch for continuation.

When the audit identifies changes within the original coherent task, amend the
**same open issue** to make the next Codex implementation contract self-contained,
including any approved V3 authorization updates and actionable repair criteria.
Do not create a duplicate patch issue. Open a separate issue only for genuinely
independent work with distinct ownership or timing, and maintain roadmap and
issue-register traceability. Product/repair tasks must still not authorize
framework-control paths.

Never rewrite or broaden an issue's live task authorization while Codex is
executing it. Reconcile the issue between turns; honor the hook's provenance and
continuation safeguards, and use operator-owned remote bootstrap for a resumed
branch when required. Keep completed functionality clearly separated from
remaining repairs so Codex does not reimplement accepted work.

For a fully accepted implementation, record final PR/CI/audit/UAT evidence and
close the issue only when the repository's milestone issue policy permits.
Do not manufacture repeated issue edits when a new audit produces no material
change from an already current checkpoint. If GitHub is unavailable, explicitly
report that issue synchronization is pending; do not imply it was performed.
