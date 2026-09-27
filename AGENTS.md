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

## PFM_TASK_V2 is mandatory for repository mutation

Any Codex implementation/repair turn that edits, commits, or pushes repository
content MUST begin with a valid `PFM_TASK_V2` envelope. Read-only questions may
run without one. Repository hooks enforce this.

The envelope separates:
- implementation breadth (`MODE`);
- semantic uncertainty (`SEMANTICS`);
- read scope (`READ_PATHS`);
- edit scope (`ALLOWED_PATHS`);
- dependency authority;
- CI/heavy-verification profile;
- UAT requirement;
- externally assigned repair round.

When `SEMANTICS: resolved`, the handoff is the implementation contract. Do not
reread normative specs, architecture, PR history, or broad resources for
reassurance. Do not expand beyond `READ_PATHS`. If a missing fact prevents
correct implementation, STOP with `LOOKUP_REQUIRED: <exact missing fact>`.

Only a new external handoff may advance `REPAIR_ROUND`. Codex must never
self-declare another repair round.

## Implementation discipline

Implement only the requested scope. Prefer the smallest defensible diff that
fully satisfies acceptance. Do not mix cleanup or redesign into a milestone.
Never weaken a financial/golden expectation merely to pass verification.

Product and repair tasks may not edit agent-control surfaces:
`AGENTS.md`, `.agents/`, `.codex/`, `.github/workflows/`,
`tools/codex/`, or `tools/ci/`. Those require `TASK_KIND: framework`.

Subagents are disabled by default. Do not delegate routine work.

## No local verification in Codex product turns

Codex implementation/repair turns do not run tests, typecheck, builds,
architecture/spec validators, Playwright, benchmarks, performance captures,
stochastic convergence runs, onboarding dry runs, or dev servers.

Codex also does not install dependencies or switch package managers during the
agent phase. If Node/npm/dependencies are not ready, STOP with `ENV_NOT_READY`.
The desktop Local Environment owns dependency setup before inference begins.

GitHub Actions owns ordinary verification. Separate manually triggered
engineering-validation workflows own expensive performance, stochastic,
onboarding, and provider-integration evidence. Test selection is risk/surface
driven; never choose arbitrary test counts merely to satisfy a ritual.

## Repository state, scope, and loop breakers

A valid V2 prompt is accepted only when:
- `EXPECTED_HEAD` exactly matches the checkout;
- the working tree is clean;
- required policy fields are valid.

Hooks stop the turn on:
- an out-of-scope edit;
- a locked dependency-manifest change;
- an unauthorized agent-control edit;
- automatic context compaction;
- unsafe push behavior;
- policy-hook failure.

Automatic context compaction during a bounded PFM implementation/repair turn is
a failure signal. Stop instead of compacting and continuing.

## Git publication

Built-in Codex web search is disabled for this project. If an audited resolved handoff lacks external information, STOP with `LOOKUP_REQUIRED` and let ChatGPT resolve it outside the implementation turn.

Feature-branch push is allowed only to the configured
`bensmullen/personal-finance-app` origin, from an approved `codex/` or
`agent/` branch, without force/delete semantics and without targeting
`main`. Direct-main push is forbidden. PR creation is auto-approved only for
`gh pr create` against this repository with explicit `--base main` and the
current approved feature branch as `--head`.

Keep completion reports concise: branch/head, changed files, material decisions,
CI status if already available, and any STOP/UAT condition.

## Scoped guidance

When the task targets a subtree with a nested `AGENTS.md`, read only the
nearest scoped instruction file if it is included in `READ_PATHS`. Do not
scan unrelated instruction files.
