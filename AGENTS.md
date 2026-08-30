# Personal Finance App — Agent Instructions

## Purpose

This repository implements a deterministic personal-finance modeling and
simulation engine plus applications built around it.

Financial correctness, explainability, and specification conformance take
priority over implementation convenience.

## Sources of truth

Authority order:

1. Canonical financial specification
2. Executable financial-semantics specification
3. Vertical-slice specifications
4. Architecture Decision Records
5. Implementation
6. Generated artifacts

Never silently change financial meaning to make code easier to implement.

## Architecture

Dependencies point inward:

UI → Application/Slice → Simulation → Engine domain modules → Values/Time/Identity

The single-package engine owns explicit modules under `src/` for values, time,
identity, model metadata, rules, primitives, dependencies, semantics, funding,
accounting, state, valuation, statements, lineage, simulation, and diagnostics.
Root compatibility files re-export canonical implementations and must not gain
substantive logic or independent runtime authority. Internal modules should
import direct leaf files where barrel imports would create cycles.
Root compatibility facades are external/legacy surfaces and must never be used
by engine implementation files as internal dependency shortcuts.

Lower engine modules must not import `simulation/`. Engine modules must not
import `webApp.ts`, browser application code, or DOM/browser APIs. Runtime
imports must remain acyclic; type-only imports are excluded from the runtime
cycle check but should still be kept simple.

Financial engine code must not depend on UI, database, auth, hosting, or
external-service libraries.

Financial formulas must not be implemented in UI components.

Primitive evaluation produces values/effects and must not directly mutate
authoritative financial state.

Only the transaction/accounting subsystem creates posted accounting legs.

Statements and metrics are derived and must not be treated as authoritative
inputs.

## Financial arithmetic and units

Do not use JavaScript floating point for authoritative money calculations.

Do not introduce bare number-based financial rates.

Use canonical DecimalAmount, Money, Currency, Rate, RateBasis, Quantity, Unit,
and RoundingPolicy abstractions.

Rounding must be explicit. Do not change rounding policy without tests and
specification review.

## Time

All internal periods are half-open: `[start, end)`.

Do not infer timezone, day-count basis, or rate basis. Use canonical temporal
utilities instead of ad-hoc Date arithmetic in engine modules.

Preserve the explicit `asOf`/data-cutoff boundary between observed and modeled
facts.

## Identity and idempotency

Persistent entities use stable domain identities.

Generated recurring/one-time occurrences require deterministic occurrence
identity sufficient to prevent duplicate recognition/posting on retry.

Imported actual facts must preserve source identity/idempotency when available.

## Determinism

Identical deterministic inputs must produce identical observable results.

Never call `Math.random()` inside financial primitives. Stochastic behavior
must consume the project's seeded RandomSource.

## State and run completion

Period execution occurs on cloned/uncommitted state. A failed or uncommitted
period must not mutate committed opening state.

Do not expose partially updated state as an implicit dependency or present an
incomplete simulation as if it reached the requested horizon.

## Funding and constraints

Never invent cash, borrowing, transfers, asset sales, overdraft, or other
funding behavior. Funding behavior must come from explicit
model/product/funding policy.

Insufficient liquidity can be a valid modeled outcome. Do not erase valid
recognition merely because settlement could not be funded.

## Accounting

Every posted transaction must balance by currency.

Settlement does not re-recognize the underlying income or expense.

Internal transfers between household-owned accounts must not change
consolidated household net worth. Do not double-count account containers and
underlying positions/assets.

## Explainability

Do not discard source, assumption, rule, or primitive identity needed to
explain material derived values. Where calculation lineage is enabled,
propagate trace references through compositions and derived outputs.

## Personal financial data

Never commit real personal financial information to the repository. Golden and
test fixtures must use synthetic data.

Do not place financial data in URLs, routine logs, screenshots, CI artifacts,
or public pull requests/issues. Do not introduce telemetry that may capture
financial content without explicit review.

## Model versioning

Do not silently reinterpret old model files using new semantics. Respect model
format/specification compatibility and use explicit migrations.

## Tests

Before completing a change, run:

```text
npm ci
npm run spec:validate
npm run architecture:validate
npm run typecheck
npm test
npm run build:web
```

Run additional lint, database, or end-to-end commands once those scripts exist.

Every financial semantic change requires tests. Never update golden expected
values solely to make tests pass; determine why the result changed and verify
the specification first.

## Change discipline

Prefer small pull requests with one principal purpose. Do not combine
repository restructuring, financial semantic changes, UI redesign, and
persistence migration in one pull request unless unavoidable.

Preserve existing behavior during refactors unless a reviewed specification
change intentionally changes behavior.

## Specifications

If implementation requires behavior not defined by the specifications, do not
invent it silently. Either implement the existing explicit rule or
update/propose the specification and test the new rule.

## Generated artifacts

Generated SQL, TypeScript, JSON Schema, and documentation are not independent
financial sources of truth. Do not manually create conflicting definitions in
generated and canonical files.

## Security

Never commit secrets or expose private financial data in logs.

Once multi-user persistence exists, all financial reads and writes must be
scoped to an authorized household. Authentication identity must remain separate
from domain economic ownership. Cross-household isolation failures are release
blockers.

## Scope control

Do not introduce microservices, distributed queues, Kubernetes, bank
aggregation, billing, or other production infrastructure unless required by
the current approved milestone.

The present development priority is:

correct engine → useful personal app → secure private alpha → production
