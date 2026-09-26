# Hybrid ChatGPT + Codex Development Framework

**Status:** implemented framework specification  
**Scope:** pre-private-alpha development efficiency and accuracy  
**Last reviewed:** 2026-09-26

## 1. Goal

Use normal ChatGPT for high-value planning/semantic auditing, local Codex for
implementation, and GitHub Actions for broad verification. Keep the user out of
the loop except for merge decisions, roadmap-defined UAT, genuine specification
ambiguity, or an automated repair-loop stop condition.

This framework optimizes for financial/architectural correctness, low Codex
context and verification cost, deterministic repository provenance, fast CI
wall-clock time, reproducible PR handoffs, and bounded autonomous repair loops.

It does not attempt to make normal ChatGPT and local Codex one unattended
background system. Local implementation remains a distinct Codex execution
surface; GitHub/CI state is the durable handoff boundary.

## 2. Responsibility split

| Stage | Default owner | Guidance |
| --- | --- | --- |
| PR interpretation / semantic design | normal ChatGPT | use strong reasoning only where architecture/financial semantics require it |
| initial implementation | local Codex | default project model/reasoning; worktree per PR |
| mechanical/surgical patch | local Codex | explicitly select a cheaper model when adequate |
| focused during-edit verification | local Codex | one compact targeted check |
| broad verification | GitHub Actions | parallel deterministic gates |
| serious generic PR review | GitHub Codex Review | optional automatic review |
| financial/architecture merge audit | normal ChatGPT | inspect open PR + CI evidence |
| user acceptance | user | only roadmap-defined milestone behavior |
| merge | user | explicit human gate |

## 3. Model-routing policy

Use the cheapest model/reasoning level that reliably satisfies the task:

- first-pass financial/cross-cutting implementation: GPT-5.6 Sol, Medium;
- narrow mechanical patches: Terra, Medium;
- fully diagnosed surgical patches: Luna or Terra, Medium;
- semantic/merge-readiness audit in normal ChatGPT: GPT-5.6 Sol, High when the
  diff is financially or architecturally material.

Do not ask an implementation model to re-derive architecture that the handoff
already resolved.

## 4. Worktree and repository-state policy

Create one Codex worktree/chat per PR. Reuse that worktree for initial
implementation and closely related fixes. A cheaper patch chat may use another
worktree based on the PR branch.

Worktree setup should install dependencies only. Recommended desktop Local
Environment setup command:

`npm ci --prefer-offline --no-audit --no-fund`

Do not run build/full tests/typecheck in worktree setup.

Every cross-thread handoff records the expected remote PR head SHA. Before
editing, Codex runs:

`npm run codex:state -- --expected-head <sha> --require-clean`

The receipt is intentionally one line:

`STATE branch=<branch> head=<sha> upstream=<ref|none> ahead=<n|na> behind=<n|na> dirty=<n>`

A mismatch/dirty receipt is a stop condition, not an invitation to guess which
tree is correct.

## 5. Standard PR handoff contract

Use `$pfm-pr-task` with this envelope:

```text
MODE: surgical | local | cross-cutting
REPO: bensmullen/personal-finance-app
PR: #__
EXPECTED_HEAD: <sha>
REPAIR_ROUND: 0 | 1 | 2

OBJECTIVE:
<one outcome>

AUTHORITATIVE_REQUIREMENTS:
<requirement IDs / exact governing rules>

EVIDENCE:
<CI failure, audit finding, reproduction, exact symbol>

ACCEPTANCE:
<observable completion conditions>

EXPECTED_SURFACE:
<files/subsystem likely to change>

OUT_OF_SCOPE:
<explicit exclusions>

VERIFY:
<one focused check, or CI-only when appropriate>

DONE:
commit + push + report new SHA, changed files, focused verification

STOP:
spec ambiguity; unexpected dirty/mismatched tree; scope expansion; same
underlying failure persists after repair round 2; no SHA progress; required UAT
```

The handoff should contain resolved semantics, not a dump of architecture
documents or chat history.

## 6. Verification policy

Codex implementation uses compact wrappers:

- `npm run codex:test -- <target>`
- `npm run codex:e2e -- <target>`

Repository hooks rewrite common focused raw Vitest/Playwright commands through
those wrappers. Passing output is intentionally tiny. Failure output is clipped
to the first useful diagnostics while full local logs stay under
`.codex/logs/`.

Broad local verification is exceptional. GitHub Actions is the authoritative
pre-merge broad gate.

## 7. Parallel CI topology

The workflow starts these jobs independently:

- spec + traceability + editor descriptor consistency;
- architecture;
- Codex tooling;
- TypeScript typecheck;
- unit tests;
- web build;
- Playwright E2E (with CI-only intra-file parallelism for isolated tests).

A final lightweight job named `test` requires every parallel gate to succeed.
Keeping the aggregate `test` name preserves a stable branch-protection target.
On main pushes, Pages deployment waits for both the aggregate gate and build
artifact.

Unit/E2E use the compact wrappers; full diagnostic files are uploaded only on
failure. `concurrency.cancel-in-progress` remains enabled so superseded commits
do not waste CI time.

## 8. Repair-loop policy

Initial implementation is repair round 0. ChatGPT may issue at most two
autonomous repair handoffs (rounds 1 and 2) for the same underlying PR/failure
lineage.

Stop and involve the user before a third repair, or immediately when:

- the same underlying CI failure survives two repair attempts;
- an attempted patch produces no new commit;
- repository provenance cannot be reconciled;
- the fix would cross the agreed architectural scope;
- the governing specification is ambiguous/contradictory;
- correctness depends on user acceptance validation.

Do not keep trying variants simply because more tokens remain.

## 9. Desktop settings checklist

These settings are intentionally user-controlled rather than enforced in the
repository.

### Codex project/session

- Open the repository as the primary Codex project folder.
- Prefer **Worktree** for PR implementation; choose the PR/base branch
  explicitly when starting the chat.
- Trust the project so `.codex/config.toml`, hooks, and project skills load.
- Confirm `/status` shows the intended model, reasoning effort, workspace root,
  and permission mode; use `/debug-config` if the active config source is unclear.
- Confirm `/debug-config` shows this repository's `.codex/config.toml`.
- Keep memories off for this project; specifications/Git are durable context.
- Keep IDE context off unless currently open editor files materially help.
- Use `/plan` only for genuinely multi-step/cross-cutting tasks, not surgical
  patches.
- Keep Fast mode off by default for this project; enable it only when lower
  latency is worth its higher usage multiplier.

### Permissions

For lowest usage, use **Ask for approval** (workspace-write + on-request).
For lowest interruption, **Approve for me** can route eligible boundary
approvals to Auto-review, but that adds reviewer-model calls and therefore can
consume additional Codex usage. Do not use Full Access/dangerous bypass as a
standing default. If you intentionally enable workspace network access to avoid
routine network prompts, treat that as a security tradeoff rather than a token
optimization.

### Local Environment

Create/select a local environment for this repo with:

`npm ci --prefer-offline --no-audit --no-fund`

Do not put build, unit, E2E, or typecheck in the setup script.

### Git / review

- Keep force-push disabled unless intentionally rewriting history.
- Install/authenticate GitHub CLI (`gh auth login`) so the desktop review pane
  can load PR context and comments.
- In Settings > Git, use detached review delivery so `/review` does not
  consume/perturb the implementation thread's context.
- Connect the repository to Codex cloud and enable GitHub Code Review if you
  want automatic P0/P1 review on every PR.
- Treat automatic Codex review as an extra safety net, not the final financial
  semantic audit.

### Browser developer mode

Leave full CDP access off by default. Enable it only when
browser/performance debugging needs DevTools-level access.

## 10. Agent-framework optimization PR specification

### Files and required changes

- `AGENTS.md`
  - keep universal authority, financial invariants, scope discipline,
    verification budget, state receipt, loop-breaker, and high-signal review
    rules;
  - route reusable workflow detail to skills instead of always-loaded context;
  - require one targeted read of the nearest nested `AGENTS.md` when a root-started
    session is scoped to that subtree.
- `docs/AGENTS.md`
  - localize specification/traceability editing rules.
- `ui/AGENTS.md`
  - localize UI stale-state/formula/explanation rules.
- `.agents/skills/pfm-pr-task/SKILL.md`
  - define the standardized handoff envelope, task sizing, state preflight,
    verification budget, completion receipt, and two-repair cap.
- `.codex/config.toml`
  - retain Medium first-pass defaults, memories disabled, one-subagent cap;
  - reduce always-loaded document budget;
  - keep the verification hook enabled.
- `tools/codex/state.mjs`
  - emit deterministic branch/head/upstream/ahead/behind/dirty state;
  - support `--expected-head` and `--require-clean`;
  - return distinct nonzero exits for mismatch and dirty state.
- `.codex/hooks/quiet-test.mjs`
  - continue blocking unjustified broad verification;
  - rewrite focused raw Vitest and Playwright invocations to quiet wrappers;
  - rewrite explicitly authorized broad unit/E2E invocations to quiet wrappers.
- `tools/codex/quiet-playwright.mjs`
  - suppress passing Playwright noise;
  - emit bounded failure diagnostics;
  - retain full local failure report/log paths.
- `tools/codex/tooling-self-test.mjs`
  - verify broad-command blocking, focused rewrites, override behavior,
    state-receipt mismatch behavior, and compact Vitest tooling.
- `package.json`
  - expose `codex:state` and `codex:e2e`.
- `playwright.config.ts`
  - enable Playwright intra-file parallelism only in CI so the repository's single
    E2E spec can use multiple workers without making local debugging noisier.
- `.github/workflows/test.yml`
  - run spec, architecture, tooling, typecheck, unit, build, and E2E in parallel;
  - retain aggregate required gate named `test`;
  - upload diagnostic artifacts only on failures;
  - preserve Pages deployment on successful main pushes.

### Acceptance criteria

1. Root `AGENTS.md` is materially smaller while retaining universal financial
   safety constraints.
2. A standard PR handoff can execute without rereading broad specs when
   semantics are already resolved.
3. `npm run codex:state -- --expected-head <HEAD>` emits one compact success
   line; wrong SHA exits nonzero with `STATE_MISMATCH`.
4. Focused raw Vitest/Playwright commands rewrite to compact wrappers.
5. Broad verification remains blocked without explicit override.
6. Codex tooling self-test passes.
7. CI broad gates start independently, Playwright can parallelize independent
   tests within the single E2E spec, and aggregate `test` fails if any gate fails.
8. Successful unit/E2E jobs emit compact output; failure diagnostics remain
   available as workflow artifacts.
9. Main deployment semantics remain unchanged: deploy only after all gates and
   build succeed.
10. No financial runtime semantics change in this PR.

## 11. Codex implementation prompt

```text
MODE: cross-cutting
REPO: bensmullen/personal-finance-app
PR: new agent-framework optimization PR
EXPECTED_HEAD: <current PR-30 head>
REPAIR_ROUND: 0

OBJECTIVE:
Implement the Hybrid ChatGPT + local Codex + GitHub CI agent framework. Reduce
Codex context/testing cost without weakening financial correctness or
pre-merge verification.

AUTHORITATIVE_REQUIREMENTS:
- Existing AGENTS financial invariants and architecture boundaries remain
  mandatory.
- GitHub CI remains authoritative broad pre-merge verification.
- Project specifications/Git are durable context; Codex memories remain off.
- Automatic repair is capped at two repair rounds before user escalation.

EVIDENCE:
Codex usage is dominated by repeated context rediscovery and local broad test
output. Existing CI is a single serial job, so an early failure hides later
failures and makes each iteration slow.

ACCEPTANCE:
Implement every file/change and acceptance criterion in
docs/development/agent-framework-optimization.md section 10.

EXPECTED_SURFACE:
AGENTS.md; docs/AGENTS.md; ui/AGENTS.md; .agents/skills/pfm-pr-task/;
.codex/config.toml; .codex/hooks/quiet-test.mjs; tools/codex/; package.json;
playwright.config.ts; .github/workflows/test.yml; this framework document.

OUT_OF_SCOPE:
Financial runtime behavior, product UX changes, new dependencies, cloud/API
agent orchestration, automatic merges, weakening tests, changing golden
financial expectations.

VERIFY:
Run only npm run codex:tooling-test locally. Leave the broad matrix to GitHub
CI.

DONE:
Commit and push the branch. Report new SHA, changed files, tooling-test result,
and CI status. Do not merge.

STOP:
Unexpected dirty/mismatched tree; unresolved config/schema ambiguity; a change
would alter financial semantics; same underlying framework/CI failure persists
after repair round 2; no SHA progress.
```
