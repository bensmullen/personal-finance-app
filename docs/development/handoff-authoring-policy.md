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
3. resolve material semantic/architectural decisions rather than delegating
   those decisions to Codex;
4. identify the smallest defensible `ALLOWED_PATHS`;
5. state the objective and acceptance conditions clearly enough that Codex can
   tell whether implementation is complete;
6. describe material failure/partial/unsupported/stale/cancelled/error behavior
   when relevant;
7. distinguish supported claims from deferred/not-measured/not-applicable areas;
8. keep expensive representative/stress/scaling/convergence/provider evidence
   outside ordinary CI unless the repository verification policy explicitly
   assigns a bounded correctness workload to CI;
9. perform a contradiction/negative-space review before handing off.

The brief should be as short as the task allows. Complexity belongs in the
semantic decisions themselves, not in mandatory envelope ceremony.

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

## 6. Git handoff lifecycle

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
whose `TARGET_BRANCH` matches the prepared branch.

## 7. Completion protocol

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
