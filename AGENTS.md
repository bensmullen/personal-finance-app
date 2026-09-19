# Personal Finance App — Agent Rules

## Purpose

This repository implements a deterministic, explainable personal-finance
modeling engine and applications around it.

Financial correctness, specification conformance, determinism, and
explainability take priority over implementation convenience.

## Authority

Authority order:

1. Canonical financial specification
2. Executable financial semantics
3. Relevant vertical-slice specification
4. Architecture Decision Records
5. Executable implementation
6. Generated artifacts

Do not silently change financial meaning to simplify implementation.

Authoritative documents are sources to consult, not context to preload.
Search for the relevant concept first and read only the smallest sections
needed to resolve the task. Do not read an entire large specification for a
routine patch unless the task explicitly requires a whole-document review.

When normative interpretation is required, use `$pfm-spec-scope`.

## Architecture

Dependencies point inward:

UI → application/slice → simulation → engine modules → values/time/identity

Engine modules must not depend on UI/browser, database, authentication,
hosting, or external-service code.

Lower engine modules must not import `simulation/`.

Root compatibility facades are external/legacy re-export surfaces. They must
not contain independent runtime logic, and engine implementation files must
not use them as dependency shortcuts.

Financial formulas belong in the engine, never the UI.

Primitive evaluation may produce values, state proposals, semantic effects,
diagnostics, and lineage references. It must not directly post transactions
or mutate authoritative financial state.

## Financial invariants

- Do not use JavaScript floating point for authoritative money calculations.
- Do not introduce bare number-based financial rates.
- Currency, units, rate basis, and rounding must remain explicit.
- Internal periods are half-open: `[start, end)`.
- Do not infer timezone, day-count basis, proration basis, or rate basis.
- Identical deterministic inputs must produce identical observable results.
- Financial primitives must not call `Math.random()`.
- Failed or uncommitted execution must not mutate committed opening state.
- Do not infer economic precedence from vertical-slice/module order, request-array order, object iteration order, or function-call order.
- Stable tie-breaking is non-economic only; same-instant constrained-resource contention that can change authoritative outcomes requires explicit dependency/contention semantics or must fail validation.
- Do not invent funding, borrowing, transfers, sales, or overdraft behavior.
- Every posted transaction must balance by currency.
- Settlement must not re-recognize the underlying income or expense.
- Internal owned-account transfers must preserve consolidated net worth.
- Do not double-count account containers and underlying positions/assets.

## Identity, provenance, and data

Preserve stable domain identity, deterministic occurrence/idempotency
identity, provenance, and the observed-versus-modeled data boundary.

Never commit real personal financial data, secrets, or logs/screenshots
containing financial information. Test fixtures must remain synthetic.

Do not silently reinterpret old portable-model versions.

## Change discipline

Implement only the requested milestone or patch.

Prefer the smallest defensible diff. Do not combine architectural
restructuring, financial semantic changes, UI redesign, and persistence work
unless explicitly required.

If required financial behavior is undefined, do not invent it. Locate the
governing specification or surface the ambiguity.

Never change golden expectations merely to make a test pass.

## Context discipline

Search before opening broad files.

Prefer symbols, changed files, targeted `rg` searches, and narrow file ranges
over repository-wide reading.

Do not inspect PR history or reread large specifications unless the current
task requires them.

Do not spawn subagents for routine implementation. Use at most one subagent at
a time, and only for a clearly separable read-only or mechanical task.

## Task sizing and context budget

A task is **surgical** when its prompt supplies a concrete diagnosis, expected
behavior, and narrow implementation surface. Treat that contract as
authoritative: inspect the named symbol/file and nearest tests first; normally
start with no more than two production files and one relevant test file. Do
not inspect architecture/specification documents, PR history, or invoke
`$pfm-semantic-review`, `$pfm-architecture-review`, or `$pfm-spec-scope` for
reassurance. Do not spawn a subagent. Stop discovery when the requested change
is clear and run only focused verification.

A **local** task affects one subsystem but needs discovery. Start with targeted
symbol/search queries, then read only directly relevant implementation and
tests. Use `$pfm-spec-scope` only for an unclear governing semantic rule;
expand into adjacent files only for a concrete dependency. Do not automatically
perform architecture or semantic audits.

A task is **cross-cutting** only when it crosses architectural boundaries,
changes financial semantics, or has unresolved normative questions. Only then
do broader specification lookup or architecture/semantic review routinely fit.

Fresh threads should use committed `AGENTS.md`, skills, and specifications as
durable context rather than reconstructing chat history. In an existing thread,
the current explicit task supersedes stale exploratory plans. Reread a file
only when the task needs it or it changed. Before expanding scope, identify the
missing fact and perform the smallest lookup that answers it. Prefer symbols
and narrow ranges; do not restate large architecture/specification sections in
notes or final responses. When architecture or semantics are resolved in the
prompt, implement them rather than re-deriving them.

## Verification discipline

Verification must be proportional to the change. Token and context cost are
part of the engineering constraint: do not run broad checks merely because a
task is ending.

During implementation:

- Run the smallest directly relevant test or check for the changed behavior.
- Prefer one focused Vitest file/test name over a suite. Prefer one focused
  Playwright file/test name only when browser behavior cannot be established
  more cheaply.
- Do not rerun a passing check unless code relevant to that check changed
  afterward.
- Documentation, agent-instruction, and configuration-only changes normally do
  not require application tests. If Codex tooling itself changes, run only its
  tooling self-test.
- Run typecheck only when TypeScript APIs/types/import relationships changed or
  a focused test exposes a type problem.
- Run architecture/spec validation only when the relevant architecture/spec
  surface changed.
- Run a web build only when build configuration, exports, framework
  integration, or compile-time UI integration changed.
- Stop after one successful focused verification command unless a concrete
  remaining risk justifies another check.

Do not invoke `$pfm-verify`, the full Vitest suite, full Playwright, build,
typecheck, architecture validation, or specification validation as a routine
completion ritual.

GitHub CI is the authoritative broad pre-merge verification gate after push.
Leave full-suite and full-E2E verification to CI unless:

- the user explicitly requests full local verification;
- CI is unavailable;
- CI failed and the failing gate must be reproduced locally; or
- the change is broad/cross-cutting enough that focused verification cannot
  establish basic correctness.

Repository hooks guard broad verification commands. Before running a guarded
broad command, state the concrete reason in the working notes and prefix that
single command with `CODEX_ALLOW_BROAD_VERIFY=1`. Never use the override merely
to satisfy task completion.

Examples of preferred focused commands:

- `npm run codex:test -- test/scenarioCompilerBridge.test.ts`
- `npx vitest run test/scenarioCompilerBridge.test.ts -t "specific behavior"`
- `npm run test:e2e -- e2e/personal-mvp.spec.ts`

Use `$pfm-verify` only as the explicit full-local-verification escalation
path described by that skill.

Keep the final report concise: changed files, material decisions, and
verification status.
