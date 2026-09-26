# Personal Finance App — Agent Rules

## Purpose and authority

This repository implements a deterministic, explainable personal-finance
engine and applications around it. Financial correctness, specification
conformance, determinism, and explainability take priority over convenience.

Authority for financial/implementation meaning:

1. Canonical financial specification
2. Executable financial semantics
3. Relevant capability specification
4. Relevant vertical-slice / milestone specification
5. Architecture Decision Records
6. Executable implementation
7. Generated artifacts

Do not silently change financial meaning to simplify implementation. When a
normative rule is unclear, use `$pfm-spec-scope` to locate the smallest
authoritative section needed; do not preload large specifications for routine
work.

## Architecture and financial invariants

Dependencies point inward:

UI → application/slice → simulation → engine modules → values/time/identity

- Engine modules must not depend on UI/browser, database, authentication,
  hosting, or external-service code.
- Lower engine modules must not import `simulation/`.
- Root compatibility facades are re-export surfaces only; engine
  implementation must not use them as dependency shortcuts.
- Financial formulas belong in the engine, never the UI.
- Primitive evaluation must not directly post transactions or mutate
  authoritative financial state.
- Do not use JavaScript floating point for authoritative money calculations.
- Do not introduce bare number-based financial rates; keep currency, units,
  rate basis, and rounding explicit.
- Internal periods are half-open: `[start, end)`. Never infer timezone,
  day-count basis, proration basis, or rate basis.
- Identical deterministic inputs must produce identical observable results;
  financial primitives must not call `Math.random()`.
- Failed or uncommitted execution must not mutate committed opening state.
- Never infer economic precedence from module order, request-array order,
  object iteration order, or function-call order.
- Stable tie-breaking is non-economic only. Same-instant constrained-resource
  contention that can change authoritative outcomes requires explicit
  dependency/contention semantics or must fail validation.
- Do not invent funding, borrowing, transfers, sales, or overdraft behavior.
- Every posted transaction must balance by currency.
- Settlement must not re-recognize the underlying income or expense.
- Internal owned-account transfers must preserve consolidated net worth.
- Do not double-count account containers and underlying positions/assets.

Preserve stable domain identity, deterministic occurrence/idempotency identity,
provenance, and the observed-versus-modeled data boundary. Never commit real
personal financial data, secrets, or logs/screenshots containing financial
information. Test fixtures must remain synthetic. Do not silently reinterpret
old portable-model versions.

## Implementation workflow

Implement only the requested milestone or patch and prefer the smallest
defensible diff that fully completes it. If financial behavior is undefined,
surface the ambiguity rather than inventing semantics. Never change golden
expectations merely to make a test pass.

For PR handoffs using the standard `MODE:/PR:/EXPECTED_HEAD:` envelope, use
`$pfm-pr-task`. Treat resolved architecture/semantics in that handoff as
authoritative unless repository evidence directly contradicts them.

Search before opening broad files. Prefer symbols, changed files, targeted
`rg`, and narrow ranges. Do not reread PR history or large specifications for
reassurance. Do not spawn subagents for routine implementation; use at most one
for a clearly separable read-only/mechanical task.

## Verification budget

During implementation run only the smallest directly relevant check. Prefer
`npm run codex:test -- <target>` or `npm run codex:e2e -- <target>` so passing
output stays compact. Do not rerun a passing check unless relevant code changed.

GitHub CI is the authoritative broad pre-merge verification gate. Full suites,
full E2E, build, typecheck, architecture validation, and specification
validation are not routine local completion rituals. Use `$pfm-verify` only
when explicitly requested, CI is unavailable/failing and needs local
reproduction, or a broad change cannot be established with focused checks.

Repository hooks block broad verification unless a concrete reason is stated
and the single command is prefixed with `CODEX_ALLOW_BROAD_VERIFY=1`.

## Loop breaker and repository state

Repository state is a machine fact, not conversational memory. When a handoff
supplies `EXPECTED_HEAD`, run:

`npm run codex:state -- --expected-head <sha> --require-clean`

before editing. Stop instead of guessing if the expected head does not match or
the working tree is unexpectedly dirty.

For one PR/failure lineage, perform at most two autonomous repair rounds. Stop
and notify the user before a third repair attempt, or immediately when:

- the same CI gate fails again for the same underlying reason after two repairs;
- no new commit/SHA progress was produced;
- local/remote branch provenance cannot be reconciled;
- the required fix crosses the stated architectural scope;
- the governing specification is genuinely ambiguous; or
- roadmap-defined user acceptance validation is required.

## Code Review Rules

- Flag changes that silently alter authoritative financial meaning, introduce
  floating-point money/rates, invent funding behavior, or permit partial
  committed-state mutation.
- Flag outcome-affecting ordering that relies on incidental iteration/module
  order instead of explicit dependency/contention semantics.
- Flag UI/cache behavior that can present a stale derived forecast as current
  after authoritative inputs change.
