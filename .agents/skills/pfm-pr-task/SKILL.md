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
`PR_TASK_RECEIPT` reports the separate ownership state. Run the printed
read-only preflight in that worktree before submitting the task.

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
- Prompt acceptance prepares a non-owning receipt. The first permitted
  repository mutation claims the writer under the policy lock. The bounded
  preflight can run after writer admission. A fresh authenticated turn may
  supersede an unused prepared receipt at a proven clean checkpoint.
- Until the first admitted edit, use simple read-only shell commands such as
  `git status`, `git show HEAD:path`, `rg -n 'pattern' path`, or `cat path`.
  Use separate calls for inspection. Shell wrappers, substitutions, pipelines,
  redirection, and unrecognized Git options are denied without an active grant.
  Unexpected drift from a prepared checkpoint requires operator diagnosis.
- Edit only `ALLOWED_PATHS`.
- Before writing any high-cardinality/periodic diagnostic, worker/API payload,
  saved result, cached snapshot, or read model, inspect how much large identical
  content would be repeated. Keep one immutable run-/source-scoped copy and
  validated typed references where material; retain occurrence identities,
  financial provenance and replay proof. Do not place a whole source catalog
  in a field labeled fingerprint, or assume UI grouping avoids transfer cost.
  Include a small synthetic fixture for reference validation and non-amplifying
  serialized size when this risk is present. See the architecture invariant
  and verification policy; no local heavy benchmark is authorized.
- Use `apply_patch` for repository content edits. Authorized `mkdir -p` is
  allowed for a new subtree.
- Do not edit framework-control files from a product/repair task.
- Do not install packages or switch package managers.
- A separately approved read-only Node probe is available as the exact
  `python3 tools/codex/node-environment-diagnostic.py` command on worktrees
  containing the merged diagnostic guard. It does not require an active task,
  perform verification, install packages, mutate task receipts or consume a
  preflight attempt. Never use it as a substitute for CI or to rerun SKIP.
- Optional bounded local verification: invoke exactly
  `python3 tools/codex/limited-local-verification-launcher.py` or append one
  directly affected tracked `test/name.test.ts`. This audited launcher finds
  existing Node 22 (including `/usr/local/bin/node` and common macOS managers)
  without installing it, and runs the same bounded helper. The original direct
  `node tools/codex/limited-local-verification.mjs` command is still supported
  only when Node is already visible in Codex's PATH. Never work around the
  hook's exact-command guard using shell aliases, PATH wrappers or chaining.
  Use one simple tool call. The audited helper runs the complete typecheck (60s total), then the named unit
  (30s); no flags, chaining, wrappers, installs or prerequisites. A missing
  environment yields SKIP. The sandboxed helper writes bounded logs and
  per-case progress only to ignored `.pfm-preflight/`; protected hook state
  records the actual PostToolUse outcome. Process and individual test-case
  timeouts are TIMEOUT/INCOMPLETE (mixed assertion failure retains FAIL and
  timeout evidence), with Vitest's own retries disabled, and
  must never cause a local retry, even after other tests completed. Missing
  results, interrupted execution, SKIP and PASS also never permit a local
  retry. Only one changed-patch correction retry after an observed FAIL with
  the same test is allowed. A known FAIL blocks ordinary push/COMPLETE until
  corrected and followed by a PASS or genuine unavailable-environment SKIP.
  A timed-out/unobserved correction does not clear the original FAIL: report
  BLOCKED and preserve WIP; do not rerun locally. Do not deliberately skip failing tests or
  weaken expectations. FAIL outside authorized scope requires BLOCKED
  disclosure and WIP preservation, not arbitrary file edits. PASS never grants
  acceptance.
- All other local tests, builds, validators, E2E, benchmarks, dev servers and
  performance captures remain prohibited. Do not run the helper during its own framework implementation turn; the hook
  requires launcher, helper and reporter to match a complete, identical version from
  either the branch's unique merged-main ancestor or current merged main tip.
  Mixed versions and unmerged task edits are denied. An older worktree may
  receive the complete latest merged hook/helper/reporter as a separately
  reviewed operator-owned framework-only synchronization, before fresh task
  authorization; ordinary `resume` does not update main's tooling.
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

Only the owning session may resume an active receipt. A different session,
including the same task issue in another chat, is an active foreign writer until
the owning session stops. Activation is blocked before checkpoint or receipt
replacement. Same-session sequential turns may resume; stale turns cannot edit
or publish. Never infer that clean/upstream-synchronized Git proves ownership
has ended. With ambiguous receipt ownership, preserve receipts and work, inspect
the read-only diagnostic, and let the operator prepare a fresh isolated
worktree plus authorized new task after proving clean/synchronized state.

Unknown, unrelated, out-of-scope, protected, dependency-violating, conflicted, or
ambiguous Git state blocks recovery with `STATE_RECOVERY_REQUIRED`. Preserve work
and report the exact reason. Do not reset, clean, stash, switch branches, amend,
rebase, force-push, or rerun bootstrap to bypass recovery checks.

For a normal valid BLOCKED/LOOKUP_REQUIRED stop, the hook checkpoints eligible
dirty paths and pushes them before permitting the stop. WIP checkpoints preserve
work; they are not implementation acceptance, verified evidence, or merge-ready
commits and cannot alone satisfy COMPLETE.

**A normal BLOCKED response is terminal, not a paused interactive question.**
Its Stop hook closes the task grant. When the PM answers a product or scope
question and updates the same live issue, open a **fresh Codex chat** in the
original clean, remote-synchronized feature worktree and submit
`PFM_TASK_ISSUE: N` to obtain a *new* issue-hash-bound authorization. A mere
"please continue" in the closed chat is read-only; do not retry stale turns or
change receipt files. No new branch or worktree is needed when the existing one
is verified clean and synced. When a previously closed hash-verified receipt
exists on a clean linked worktree whose local branch is merely behind the
same remote branch by a proven fast-forward, a new-session UserPromptSubmit
may automatically fetch and fast-forward, then reverify exact remote head.
Active writers, detached or dirty worktrees, unrelated/diverged commits and
ambiguous receipts remain blocked for operator-led recovery. The current issue may widen test-only scope, but
the new turn must use its own receipt and all originally approved financial
checks. If a hook blocks even the fresh issue submission, report its exact
error plus read-only branch/HEAD/upstream/receipt evidence; do not bypass it.

This differs from an **abnormal interruption without Stop**, where an
existing *active* owning receipt may be recovered in the same session through
the already guarded checkpoint continuation path.

**Optional-preflight/hook failure preservation:** A rejected or crashed optional
`limited-local-verification` request does **not** invalidate already authorized
product edits. If ordinary authorized editing remains safe, continue the task
without the unavailable preflight and report it as not verified. If a task
explicitly requires stopping, leave authorized working changes **intact** and
report `TASK_STATUS: BLOCKED` plus the exact hook event/error so the normal
Stop hook can checkpoint and push WIP. Never reverse authorized edits with
`apply_patch`, `git restore`, `reset`, `clean`, `stash`, or equivalent
solely because a tool/preflight failed. If the Stop hook cannot checkpoint,
preserve the dirty checkout and report the precise recovery condition; no
false clean/synchronized claim and no new session until ownership is verified.

## Abnormal computer crash: operator-only checkpoint recovery

A computer crash or forced termination can leave the last receipt `ACTIVE:true`
even after no Codex process survives. This is not a product blocker and **must
not** prompt deletion/rewriting of task receipts or blind reauthorization in the
old worktree. The hook intentionally rejects a new session as an active foreign
writer because it cannot prove the old writer has stopped.

**ChatGPT/operator procedure** (outside Codex, with the old Codex writer stopped):

1. Inspect the original task worktree's branch, exact `git rev-parse HEAD`,
   `git status --porcelain=v1`, origin and `@{u}`, plus
   `.codex/runtime/latest-task.json` and the SHA-bound state file read-only.
   A reported clean WIP SHA is evidence only until verified on disk. A task
   without upstream is **not lost** and must not be reset or replaced.
2. Obtain a distinct `codex/...-recovery` branch name; ChatGPT must update the
   **same open GitHub task issue** to use it, preserve its accepted contract and
   explicitly mark old receipt/branch as archival. Do not authorize Codex until
   its live issue and new branch match.
3. From the canonical checkout, use the bounded, operator-only helper below.
   The environment confirmation means **the human has closed/terminated the
   interrupted Codex writer**. The script verifies the exact clean checkpoint,
   origin and push destination, checks both remote refs against the pinned SHA
   **before any push**, publishes the original and recovery branches without
   force, and invokes the ordinary `bootstrap-pr.sh resume` for a fresh,
   differently named worktree. It does not modify the old worktree's task receipt
   or claim WIP implementation acceptance. It verifies the same issue number
   against the old hash-bound active receipt and the live recovery authorization.
   It loads and verifies the bootstrap and policy from fetched origin/main,
   independently of the canonical checkout's working files.

   ```bash
   cd -- "$canonical_checkout" &&
   PFM_CRASH_RECOVERY_CONFIRMED=1 PFM_CRASH_RECOVERY_ISSUE="$issue_number" \
   bash tools/codex/recover-interrupted-task.sh \
     "/absolute/path/to/interrupted-worktree" \
     "codex/original-task-branch" \
     "codex/original-task-branch-recovery" \
     "reported-clean-checkpoint-sha"
   ```

4. Open the **new** `PR_WORKTREE_READY` path and run its printed read-only
   preflight. Start a new Codex conversation with `PFM_TASK_ISSUE: N`. Require
   an actual new implementation commit beyond WIP and full acceptance review
   before COMPLETE. If either branch already contains a different remote commit,
   the original path is dirty, or source SHA/issue is unverified, STOP for
   operator diagnosis, no force/rebase/clean/receipt deletion. Node is optional.

If the canonical checkout's recovery script predates this protocol, load the
current script from trusted origin/main using the pinned-object procedure in
`docs/development/handoff-authoring-policy.md`. If the merged helper is
unavailable, stop at read-only diagnosis and preserve the checkpoint and receipt.

The source and recovery branches are separate by design; this prevents a stale
session from becoming a writer again even when the original receipt remains
active. A legitimate same-session continuation without crash still uses the
existing guarded active-receipt path. This procedure does not grant two writers
ownership of the same branch.

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

Push once and end without watching, polling or waiting for CI (active AL-003).
AL-002 keeps live task authority compact; AL-004 preserves independently runnable
acceptance flows and all four shards. Candidate #134 (bounded static preflight)
and #217 (single-writer ownership) retain independent ChatGPT curation; Codex
does not edit candidate issues or the lesson ledger.

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
recovery condition; never discard or rewrite history automatically. A Codex COMPLETE report means the authorized implementation is committed/pushed
and Codex believes its implementation-level acceptance conditions are fulfilled.
It does **not** mean that CI, ChatGPT's independent semantic audit, product-owner
UAT, or final merge approval has passed. External issue-specific CI/audit/UAT
gates remain required for PR merge or milestone closeout, not for the Stop hook
to accept a mechanically complete implementation.

## Compatibility

Legacy V2 handoffs may still be accepted when they contain the minimal V3
authorization fields, but new work should use V3.
