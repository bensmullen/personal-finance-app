---
name: pfm-pr-task
description: Execute a machine-guarded PFM_TASK_V2 implementation or repair handoff. Repository mutation requires a valid V2 envelope; Codex edits code but does not run local verification.
---

# PFM PR Task V2

Use this skill for every repository implementation or repair.

## Required envelope

```text
PFM_TASK_V2
TASK_KIND: product | framework | repair
MODE: surgical | local | cross-cutting
SEMANTICS: resolved | lookup_required
REPAIR_ROUND: 0 | 1 | 2
TASK_CONTINUITY: new_pr | existing_pr
TARGET_BRANCH: <approved codex/ or agent/ branch>
WORKTREE_POLICY: isolated | current
EXPECTED_HEAD: <full 40-char SHA>
DEPENDENCY_POLICY: locked | manifest_edit
DISCOVERY_POLICY: implementation_only | targeted_lookup
LOCAL_EXECUTION_POLICY: no_tests
CI_PROFILE: <risk/surface profile>
HEAVY_VALIDATION_PROFILE: none | performance | stochastic | onboarding | provider
UAT: required | not_required
LESSONS_APPLIED: none | <comma-separated active lesson IDs>

READ_PATHS:
- <exact file or bounded subtree Codex may inspect>

ALLOWED_PATHS:
- <exact file or bounded subtree Codex may modify>

OBJECTIVE:
<one implementation outcome>

RESOLVED_DECISIONS:
<implementation/semantic decisions already resolved by ChatGPT>

REQUIREMENT_MAP:
- <requirement ID/contract> -> <implementation obligation> -> <CI/heavy/UAT evidence>

FAILURE_MODES:
- <material failure/partial/unsupported/stale/cancelled/error case and required behavior>

CLAIMS_AND_GAPS:
CLAIMS: <support/coverage/performance/compatibility claims Codex may make>
KNOWN_GAPS: <explicit unsupported/deferred/not-applicable areas>
EVIDENCE: <how every claim is proven; never infer coverage from names or counts alone>

PROFILE_CONTRACT:
<compact profile-specific markers from the Handoff Authoring Policy; use N/A only when the selected profile has no required markers>

EVIDENCE_PLAN:
CI: <ordinary GitHub gates/failure classes>
HEAVY: <manual engineering-validation profile or none>
UAT: <required walkthrough/decision or not_required>

ACCEPTANCE:
<observable implementation conditions>

OUT_OF_SCOPE:
<explicit exclusions>

STOP:
<task-specific stop conditions>
```

Hooks validate this envelope before the model may mutate the repository.

### Long pasted handoffs

Codex Desktop may convert a long pasted request into an auto-generated text
attachment instead of leaving the full text in the prompt field. The policy
hook supports that transport only when all of these conditions hold:

- the user-prompt wrapper references exactly one generated task file named
  `pasted-text.txt` or `writing-block.md`;
- the canonical file is a regular UTF-8 file beneath
  `$CODEX_HOME/attachments`, or `~/.codex/attachments` when `CODEX_HOME`
  is unset;
- the file is no larger than 256 KiB and its path contains no symlink escape;
- the file itself contains the complete `PFM_TASK_V2` envelope.

The attachment contents are validated with the same V2 validator used for an
inline handoff. Inline and attachment fields are never merged. A valid inline
envelope remains authoritative. When an attachment-backed task is accepted, the
hook binds the active task to that file's SHA-256 digest and fails closed before
repository mutation or publication if the file changes or disappears.

Arbitrary attachments, transcript scraping, multiple candidate task files, and
files outside the trusted Codex attachment root are not accepted as task
authority.

## Semantic status

### resolved

The handoff is sufficient implementation authority.

- Do not reopen normative specifications, architecture, PR history, or broad
  repository resources.
- Stay within `READ_PATHS`.
- If a missing fact blocks correctness, STOP exactly with
  `LOOKUP_REQUIRED: <missing fact>`.
- Do not silently expand discovery.

### lookup_required

Only use the explicitly authorized narrow lookup surface. The task should
normally return to ChatGPT for semantic resolution rather than turning Codex
into the architecture/research agent.

## Implementation scope

- `ALLOWED_PATHS` is a hard edit boundary.
- Product/repair tasks cannot modify agent-control files.
- `DEPENDENCY_POLICY=locked` permits package scripts/config edits when
  authorized, but dependency/version declarations must remain unchanged.
- `DEPENDENCY_POLICY=manifest_edit` must be explicit before dependency
  declarations change.
- Make no unrelated cleanup changes.

## Verification

Codex performs **no local verification** in implementation or repair turns.

Do not run:
- unit/property/E2E tests;
- typecheck/build;
- architecture/spec validators;
- benchmarks/performance capture;
- stochastic/convergence validation;
- onboarding dry runs;
- dev servers;
- package installation.

Commit and push the implementation. GitHub CI chooses ordinary verification
gates from the changed surface. Heavy engineering evidence runs in the manual
engineering-validation workflow after ordinary CI is green.

If CI later fails, ChatGPT supplies a new bounded repair envelope with the exact
failure evidence. Codex does not self-repair from locally generated failures.

## Repair rounds

- Initial implementation: `REPAIR_ROUND: 0`.
- First external repair: `REPAIR_ROUND: 1`.
- Second external repair: `REPAIR_ROUND: 2`.
- There is no autonomous round 3.

Codex may not increment the round itself. A new user/ChatGPT handoff is required
for every repair round.

## Environment, task routing, and state

Session start checks repository identity, not the local verification toolchain.
Node/npm and installed dependencies are not implementation-start requirements
because Codex may not run local verification or install packages. A configured
Local Environment may prepare dependencies for developer convenience, but a
missing Desktop environment binding does not invalidate an otherwise correct
linked worktree.

The V2 validator checks the clean tree, `EXPECTED_HEAD`, target branch,
task continuity, worktree policy, and applicable active lessons.

For `TASK_CONTINUITY: new_pr`, `WORKTREE_POLICY` must be `isolated`.
Use an isolated linked Git worktree at the approved starting commit. It may be
created by Codex Desktop or manually with `git worktree add --detach`; the hook
validates Git worktree isolation, not the Desktop UI that created it. If the
worktree is at the approved starting commit but not yet on `TARGET_BRANCH`, the
hook permits exactly one bootstrap command, `git switch -c <TARGET_BRANCH>`,
before any repository mutation.

For `TASK_CONTINUITY: existing_pr`, the task must already be running on
`TARGET_BRANCH`. If the branch belongs to another worktree, stop with
`WRONG_WORKTREE` and resume that PR's existing thread/worktree. Do not ask the
user to manually check out the branch.

Codex should not spend tool calls rediscovering repository provenance.

## Completion

Commit and push to an approved feature branch. When GitHub CLI is available,
open the PR with an explicit safe command of the form:

`gh pr create --repo bensmullen/personal-finance-app --base main --head <current-branch> --title "<title>" --body "<body>"`

The repository permission hook can auto-approve only that bounded PR creation and
the corresponding safe feature-branch push. If `gh` is unavailable or
unauthenticated after the push, do not treat that as an implementation failure.
Report `PUBLICATION_PENDING: GH_UNAVAILABLE` with branch and HEAD; ChatGPT may
open the PR through the GitHub connector.

Report:
- branch and new HEAD;
- changed files;
- material decisions;
- CI status if available;
- STOP/UAT requirement;
- process signal: `none` or one concise incident/failure pattern for ChatGPT review.

Do not claim verification that GitHub CI has not completed.


## Learning loop and handoff semantic audit

Before a V2 handoff is issued, ChatGPT must follow
`docs/development/handoff-authoring-policy.md` and the active entries in
`docs/development/agent-lessons.json`. The hook independently computes the
active lessons applicable to the task and rejects a handoff whose
`LESSONS_APPLIED` set or required lesson markers are incomplete.

Incidents are evidence, not policy. Codex never creates candidate issues,
promotes, retires, or rewrites lessons during product/repair work. It reports one
concise process signal; the ChatGPT architecture/review layer decides whether it
is a candidate and automatically persists qualifying candidates under
`docs/development/agent-learning-policy.md`. Promotion remains a curated
framework decision.

The hook checks the compact results of the semantic audit; Codex is not asked
to redo it.

The purpose is to prevent a detailed prompt from still being semantically
under-specified. In particular:
- support/coverage claims require executable evidence and explicit known gaps;
- measurement/phase ownership must define what is included and excluded;
- partial/incomplete/unsupported/cancelled/error states need explicit validity
  semantics;
- persisted artifacts/UI summaries must retain the context needed to interpret
  a result;
- defined-but-inapplicable concepts are N/A/not_applicable, never measured using
  a convenient surrogate;
- resource metrics must say what they mean (for example absolute memory versus
  signed delta);
- diagnostics/telemetry/caches remain observational and cannot leak stale
  global context into unrelated operations;
- controlled evidence/history required by a specification must have an external
  workflow/artifact owner rather than an implicit local Codex step.
