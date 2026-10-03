---
name: pfm-pr-task
description: Execute a scope-guarded PFM_TASK_V3 implementation or repair handoff. Git bootstrap establishes remote-backed branch state; hooks enforce allowed edits, publication safety, and completion.
---

# PFM PR Task V3

Use this skill for repository implementation or repair.

## Before the Codex turn

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
- Read implementation resources as needed. If a missing semantic decision makes
  correct implementation impossible, stop with `LOOKUP_REQUIRED:`.

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

Blocked partial commits must be pushed; otherwise restore them so the shared Git
state remains understandable.

## Compatibility

Legacy V2 handoffs may still be accepted when they contain the minimal V3
authorization fields, but new work should use V3.
