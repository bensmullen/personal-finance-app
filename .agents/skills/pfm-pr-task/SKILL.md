---
name: pfm-pr-task
description: Execute a scope-guarded PFM_TASK_V3 implementation or repair handoff. Git bootstrap establishes remote-backed branch state; hooks enforce allowed edits, publication safety, and completion.
---

# PFM PR Task V3

Use this skill for repository implementation or repair.

## Before the Codex turn

Git bootstrap is an **operator-only pre-turn action**. Codex must not invoke the
bootstrap helper from inside an active implementation turn.

Prepare shared Git state from the remote repository.

New PR:

```bash
bash tools/codex/bootstrap-pr.sh new codex/<branch> [worktree-path]
```

Existing PR:

```bash
bash tools/codex/bootstrap-pr.sh resume codex/<branch> [worktree-path]
```

Use `agent/<branch>` when resuming a ChatGPT-created PR.

Open the exact worktree path printed by `PR_WORKTREE_READY`. Do not ask Codex
to create/switch worktrees or branches inside the implementation turn.

When SessionStart reports a clean linked `codex/` or `agent/` feature
worktree and UserPromptSubmit accepts a task whose `TARGET_BRANCH` equals the
current branch, preparation is already satisfied. Proceed with implementation;
do **not** rerun `bootstrap-pr.sh` merely because this skill documents the
pre-turn bootstrap procedure.

## Required authorization

```text
PFM_TASK_V3
TASK_KIND: product | framework | repair
TARGET_BRANCH: <approved codex/ or agent/ branch>
DEPENDENCY_POLICY: locked | manifest_edit

ALLOWED_PATHS:
- <exact file or cohesive subtree/**>

OBJECTIVE:
<implementation outcome>

ACCEPTANCE:
<conditions that must be true before completion>
```

Only these fields are machine-required.

For long/cross-cutting Desktop work, store the V3 authorization plus semantic
contract in an open repository task issue and send only:

```text
PFM_TASK_ISSUE: <issue-number>
```

The policy hook validates and injects the issue body directly; do not paste the
long handoff again.

The remainder of the handoff is normal semantic implementation guidance. For
complex work, include resolved decisions, failure states, requirement/evidence
mapping, performance or concurrency boundaries, UAT, exclusions, and lookup
conditions when useful. Their exact headings are not parser requirements.

## Execution rules

- Stay on `TARGET_BRANCH`.
- Edit only `ALLOWED_PATHS`.
- Use `apply_patch` for repository content edits. Authorized `mkdir -p` is
  allowed for a new subtree.
- Do not edit framework-control files from a product/repair task.
- Do not install packages or switch package managers.
- Do not run tests, typecheck, builds, validators, E2E, benchmarks, dev servers,
  performance captures, or other verification locally.
- GitHub CI owns ordinary verification.
- Resolve implementation questions from repository authority: canonical financial
  specification, executable financial semantics, capability/slice specifications,
  ADRs, then implementation. Choose the smallest architecture-consistent option
  inside ALLOWED_PATHS when it does not change user-visible financial meaning.
  Do not escalate type shapes, accumulators, module placement, or code structure
  merely because the handoff does not prescribe them.
- Escalate only unresolved product/financial meaning, unavailable external facts,
  missing authorization, unsafe prerequisites, or alternatives that materially
  change user-visible economic behavior. Use the PM-oriented block below.

## Interrupted task continuation

Resubmit the same task issue (or the identical inline/attachment contract) in the
same worktree and branch after a usage-limit/manual interruption. UserPromptSubmit
uses a durable active-task receipt to prove provenance, checks both prior and
incoming authorization, and checkpoints/pushes eligible dirty work before setting
the new BASE_HEAD. No Stop event is required. A failed checkpoint push preserves
the local commit and can be retried by resubmitting the same task.

Unknown, unrelated, out-of-scope, protected, dependency-violating, conflicted, or
ambiguous Git state blocks recovery with `STATE_RECOVERY_REQUIRED`. Preserve work
and report the exact reason. Do not reset, clean, stash, switch branches, amend,
rebase, force-push, or rerun bootstrap to bypass recovery checks.

For a normal valid BLOCKED/LOOKUP_REQUIRED stop, the hook checkpoints eligible
dirty paths and pushes them before permitting the stop. WIP checkpoints preserve
work; they are not implementation acceptance, verified evidence, or merge-ready
commits and cannot alone satisfy COMPLETE.

## Product-manager escalation

Before escalating, inspect the narrow authoritative sources and state the actual
user/financial decision first. Include this block with BLOCKED and the precise
LOOKUP_REQUIRED/BLOCKER reason:

```text
DECISION_NEEDED: <one sentence stating the product decision or missing fact>
PRODUCT_IMPACT: <effect on users or financial behavior>
OPTIONS: <only materially different choices>
RECOMMENDATION: <preferred option, or why no preference is supportable>
TECHNICAL_REASON: <short explanation>
```

For authorization-only requests, give the exact additional scope path needed.
Do not ask a product owner to select implementation mechanics. Hooks do not call
ChatGPT/OpenAI automatically; the block is suitable for a human relay to ChatGPT.

Refinance timing is a genuine product decision, even though it arises from engine
constraints. For the D1-B private-alpha floor, use this form:

```text
DECISION_NEEDED: For the private-alpha refinance floor, should users be able to refinance only on a scheduled monthly mortgage payment date, or on any calendar date?
PRODUCT_IMPACT: Payment-date-only refinancing is narrower but deterministic with the existing mortgage model; arbitrary dates are more realistic but require new partial-month interest semantics.
OPTIONS: (A) scheduled payment dates only; (B) arbitrary dates with new stub/per-diem interest support.
RECOMMENDATION: A for D1-B; defer arbitrary-date refinance to a later mortgage capability.
TECHNICAL_REASON: the current authoritative mortgage engine models whole contractual months only.
```

## Publication

Commit the complete implementation and push it to the authorized feature branch.
Use `git push -u origin <branch>` on the first push so the tracking branch is
explicit.

If `gh` is available, PR creation may use:

```bash
gh pr create --repo bensmullen/personal-finance-app --base main --head <branch> ...
```

If `gh` is unavailable after the branch is successfully pushed, report
`PUBLICATION_PENDING: GH_UNAVAILABLE`. ChatGPT can create the PR through the
GitHub connector.

## Completion

A successful final response includes:

```text
TASK_STATUS: COMPLETE
ACCEPTANCE_STATUS: SATISFIED
```

The Stop hook checks that:
- the correct branch is still active;
- the tree is clean;
- an implementation commit exists after task start;
- every changed/untracked path is authorized;
- dependency policy still holds;
- the branch tracks and equals its pushed origin branch.

If the task cannot finish safely:

```text
TASK_STATUS: BLOCKED
BLOCKER: <specific reason>
```

or:

```text
TASK_STATUS: BLOCKED
LOOKUP_REQUIRED: <exact missing fact>
```

Blocked partial commits must be pushed. Eligible dirty work is checkpointed by the
Stop hook. If checkpoint/push fails, preserve all local work and report the precise
recovery condition; never discard or rewrite history automatically. Issue-specific
CI/audit acceptance gates must also pass before reporting COMPLETE.

## Compatibility

Legacy V2 handoffs may still be accepted when they contain the minimal V3
authorization fields, but new work should use V3.
