# Semantic Kernel v0.1

This milestone establishes the first executable runtime boundary for the financial semantics specification. The implementation is deliberately small: it provides exact cent-based monetary values, half-open calendar periods, deterministic dependency ordering, balanced accounting transactions, cloned state transitions, typed statement derivation, and a reusable golden-runner boundary.

## Lifecycle

A run clones the opening state, builds a zero-lag dependency DAG, evaluates events in deterministic topological order, validates each event's period/date and balanced transaction, applies the transaction to the cloned state, and derives closing statements. If execution fails, the opening state remains unchanged because all mutations occur on the clone.

The intended production lifecycle remains the specification's semantic-barrier sequence: establish period context → resolve inputs → activate events → build/validate dependencies → evaluate primitives → generate flows/recognition → generate obligations/settlements → translate to transactions → post/apply state → closing valuation/outputs → validate/commit. v0.1 supplies the executable boundary for the dependency/effect/transaction/state portion; richer primitive evaluation and obligation identity remain subsequent work.

## State ownership

`SimulationState` owns account cash, investment positions, and liabilities. Derived statement values are computed from the resulting state and typed accounting legs rather than persisted as authoritative state. Event definitions cannot directly mutate the runner's state.

## Temporal model

`Period` is `[start,end)`. `utcMonth()` constructs boundaries only for fixtures and explicitly UTC schedules; it is not a household calendar-month API. `SemanticRunner` rejects events at or after the period end. This explicitly tests the half-open execution boundary.

## Dependencies

`DependencyGraph` uses deterministic Kahn topological sorting with lexicographic tie-breaking. Zero-lag cycles fail explicitly. Nonzero-lag edges are accepted without adding a same-period dependency and remain the responsibility of the higher-level planner to expand into prior-state dependencies.

## Accounting

`posting()` and `assertBalanced()` require debit total to equal credit total. Transactions are explicit typed legs. Cash flow is derived from cash legs, while income, expense, and gain totals are derived from their accounting side rather than free-form effect descriptions.

The v0.1 scenarios include explicit recognition, settlement, internal transfer, purchase, mark-to-market, and sale transactions. The full recognition → obligation/right → settlement identity and duplicate-recognition controls are intentionally reserved for the next kernel increment.

## Monetary arithmetic

Posted monetary amounts use `bigint` cents. This avoids binary floating-point representation for ledger amounts. Mortgage payment calculation currently uses floating-point only for the amortization formula and rounds the result to cents; the next financial-math increment should replace rate arithmetic with decimal/rational operations throughout.

## Golden harness

Golden scenarios live in `test/golden.test.ts`. They now construct typed events and transactions and execute them through `SemanticRunner`; they do not directly mutate the runner's authoritative state. The suite covers salary/tax/retirement/expenses, internal transfer/purchase/mark-to-market, tax accrual/settlement, mortgage fixed-payment/reset mechanics, investment mark-to-market/sale, deterministic dependency ordering, and the half-open/atomic state boundary.

Run locally with:

```text
npm install
npm test
npm run typecheck
```
