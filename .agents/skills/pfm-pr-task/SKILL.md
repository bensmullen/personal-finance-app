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
EXPECTED_HEAD: <full 40-char SHA>
DEPENDENCY_POLICY: locked | manifest_edit
DISCOVERY_POLICY: implementation_only | targeted_lookup
LOCAL_EXECUTION_POLICY: no_tests
CI_PROFILE: <risk/surface profile>
HEAVY_VALIDATION_PROFILE: none | performance | stochastic | onboarding | provider
UAT: required | not_required

READ_PATHS:
- <exact file or bounded subtree Codex may inspect>

ALLOWED_PATHS:
- <exact file or bounded subtree Codex may modify>

OBJECTIVE:
<one implementation outcome>

RESOLVED_DECISIONS:
<implementation/semantic decisions already resolved by ChatGPT>

ACCEPTANCE:
<observable implementation conditions>

OUT_OF_SCOPE:
<explicit exclusions>

STOP:
<task-specific stop conditions>
```

Hooks validate this envelope before the model may mutate the repository.

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

## Environment and state

Environment readiness is checked at session start. Missing/wrong Node/npm or
missing dependencies is `ENV_NOT_READY`; do not troubleshoot or install
packages.

The V2 prompt validator itself checks the clean tree and `EXPECTED_HEAD`;
Codex should not spend tool calls rediscovering repository provenance.

## Completion

Commit and push to an approved feature branch. Report:
- branch and new HEAD;
- changed files;
- material decisions;
- CI status if available;
- STOP/UAT requirement.

Do not claim verification that GitHub CI has not completed.
