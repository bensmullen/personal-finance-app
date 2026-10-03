# Personal Finance App — Agent Rules

## Authority and invariants

Financial correctness, specification conformance, determinism, explainability,
and privacy outrank implementation convenience.

Authority order:
1. Canonical financial specification
2. Executable financial semantics
3. Relevant capability specification
4. Relevant milestone/vertical-slice specification
5. ADRs
6. Executable implementation
7. Generated artifacts

Dependencies point inward:

UI → application/slice → simulation → engine modules → values/time/identity

Universal financial constraints:
- never use JavaScript floating point for authoritative money;
- keep rates, units, bases, periods, and rounding explicit;
- internal periods are half-open `[start, end)`;
- identical deterministic inputs produce identical observable results;
- primitives must not invent funding, borrowing, transfers, sales, or overdrafts;
- failed/uncommitted execution cannot mutate committed state;
- economic precedence cannot come from incidental iteration/module/call order;
- every posted transaction balances by currency;
- settlement cannot re-recognize underlying income/expense;
- internal owned-account transfers preserve consolidated net worth;
- do not double-count account containers and their underlying holdings;
- preserve stable identity, idempotency, provenance, and observed-vs-modeled boundaries;
- never commit real personal financial data, secrets, or diagnostic artifacts containing them.

## PFM task authorization

Repository mutation requires a compact `PFM_TASK_V3` authorization. Read-only
questions do not.

The machine-enforced V3 contract is intentionally small:

```
PFM_TASK_V3
TASK_KIND: product|framework|repair
TARGET_BRANCH: codex/...|agent/...
DEPENDENCY_POLICY: locked|manifest_edit

ALLOWED_PATHS:
- <one or more authorized paths>

OBJECTIVE:
<what must be accomplished>

ACCEPTANCE:
<what must be true before COMPLETE>
```

The semantic handoff may contain as much additional product/architecture detail
as the task needs. Hooks do not require that detail to follow a rigid schema.

For long or cross-cutting Codex Desktop tasks, prefer a repository-owned GitHub
Issue whose body begins with the complete PFM_TASK_V3 authorization and then
contains the semantic contract. Submit only:

```
PFM_TASK_ISSUE: <issue-number>
```

The hook fetches the open issue directly from this repository, validates its V3
authorization, and injects the complete issue body into Codex context. This is
the preferred transport when Desktop may rewrite or attach pasted text. The
user does not need to paste the long contract into Codex.

Hard guarantees:
- Codex may edit only `ALLOWED_PATHS`.
- Product/repair tasks may not authorize framework-control paths.
- Locked dependency declarations may not change.
- Local verification/package installation remains prohibited.
- The current branch must already equal `TARGET_BRANCH` before implementation.

Use `apply_patch` for repository content edits so the hook can reject an
out-of-scope path before mutation. Post-tool scope checks also include untracked
files, so alternate write mechanisms cannot silently broaden the diff.

## Git bootstrap and shared state

GitHub remote state is authoritative for task initialization.

For every new PR, prepare the local task branch/worktree with:

```
bash tools/codex/bootstrap-pr.sh new codex/<branch> [worktree-path]
```

The helper fetches/prunes `origin`, resolves the current `origin/main` SHA,
creates the feature branch directly at that commit in a clean linked worktree,
and reports the exact path/head to open in Codex. Local `main` does not need to
be current.

For an existing PR:

```
bash tools/codex/bootstrap-pr.sh resume codex/<branch> [worktree-path]
```

(or `agent/<branch>` when Codex is taking over a ChatGPT-created PR).

Resume uses the fetched remote feature branch as the shared source of truth. It
may fast-forward a clean local branch, but it never discards unpushed or
divergent local commits. Dirty worktrees fail clearly instead of being replaced.

Do not create/switch branches inside an active implementation turn. Branch and
worktree lifecycle belongs to bootstrap; hooks enforce that the task remains on
the authorized branch.

## Implementation discipline

Implement only the requested scope. Prefer the smallest defensible diff that
fully satisfies acceptance. Do not mix cleanup or redesign into a milestone.
Never weaken a financial/golden expectation merely to pass verification.

Product and repair tasks may not edit:
`AGENTS.md`, `.agents/`, `.codex/`, `.github/workflows/`,
`tools/codex/`, `tools/ci/`, `docs/development/handoff-authoring-policy.md`,
`docs/development/verification-policy.md`, or `docs/development/agent-*`.
Those require `TASK_KIND: framework`.

Codex may read implementation resources needed to complete the authorized
objective. If a missing semantic decision prevents correct implementation,
report `LOOKUP_REQUIRED: <exact missing fact>` rather than inventing it.

Subagents are disabled by default.

## No local verification in Codex implementation turns

Codex implementation/repair turns do not run tests, typecheck, builds,
architecture/spec validators, Playwright, benchmarks, performance captures,
stochastic convergence runs, onboarding dry runs, or dev servers.

Codex does not install dependencies or switch package managers during the agent
phase. GitHub Actions owns ordinary verification. Separate manually triggered
engineering-validation workflows own expensive performance, stochastic,
onboarding, and provider evidence.

## Completion contract

Codex must end an authorized implementation turn with one explicit status.

Successful completion:

```
TASK_STATUS: COMPLETE
ACCEPTANCE_STATUS: SATISFIED
```

The Stop hook accepts COMPLETE only when:
- the current branch still equals `TARGET_BRANCH`;
- the working tree is clean;
- at least one implementation commit exists after the task-start commit;
- all committed/uncommitted/untracked changed paths are authorized;
- locked dependency policy still holds;
- the branch tracks `origin/TARGET_BRANCH`;
- local HEAD equals the tracking branch, so implementation work is pushed.

If implementation cannot safely finish, use:

```
TASK_STATUS: BLOCKED
BLOCKER: <specific external/scope/technical blocker>
```

or `LOOKUP_REQUIRED: <exact missing fact>`.

A blocked task must still leave the working tree clean. If partial work was
committed, it must be pushed so the shared Git state remains understandable.
The completion hook gives Codex one continuation opportunity to finish or clean
up before it fails closed rather than allowing a false COMPLETE report.

## Git publication

Feature-branch push is allowed only to the configured
`bensmullen/personal-finance-app` origin, from the authorized `codex/` or
`agent/` branch, without force/delete semantics and without targeting
`main`.

PR creation is auto-approved only for `gh pr create` against this repository
with explicit `--base main` and the current authorized branch as `--head`.

GitHub CLI is publication-only. If `gh` is unavailable after a successful
feature-branch push, report `PUBLICATION_PENDING: GH_UNAVAILABLE`; ChatGPT may
create the PR through the GitHub connector without rerunning implementation.

## Scoped guidance

Nested `AGENTS.md` files may add implementation guidance for their subtree.
They cannot broaden `ALLOWED_PATHS` or override these repository safety rules.
