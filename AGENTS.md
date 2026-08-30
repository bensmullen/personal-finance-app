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

During implementation, run targeted tests for the behavior being changed.
Before completion, use `$pfm-verify` once for the repository verification gate.

Keep the final report concise: changed files, material decisions, and
verification status.
