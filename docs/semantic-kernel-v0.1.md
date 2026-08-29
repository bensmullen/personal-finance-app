# Semantic Kernel v0.1

This milestone establishes the first executable runtime boundary for the financial semantics specification. The implementation is deliberately small: it provides exact cent-based monetary values, half-open calendar periods, deterministic dependency ordering, balanced accounting transactions, state snapshots, derived statements, and a reusable golden-runner boundary.

## Lifecycle

A run is evaluated against a cloned opening state for a half-open `Period`. Scenario logic emits effects and proposed transactions, then the runner derives consolidated assets/liabilities and statement totals. The committed result is returned as a new state; the opening state is not mutated.

The intended production lifecycle remains the specification's semantic-barrier sequence: establish period context → resolve inputs → activate events → build/validate dependencies → evaluate primitives → generate flows/recognition → generate obligations/settlements → translate to transactions → post/apply state → closing valuation/outputs → validate/commit.

## State ownership

`SimulationState` owns account cash, investment positions, and liabilities. Derived statement values are computed rather than persisted as authoritative state. `GoldenRunner` clones the opening state before executing a scenario, providing the atomic-run boundary needed for future effect validation and rollback.

## Temporal model

`Period` is `[start,end)`. `month()` constructs calendar-month boundaries in UTC. `inPeriod()` therefore excludes the end boundary, matching the executable semantics specification. Date-only inclusive user semantics must be converted to the following date boundary before reaching this layer.

## Dependencies

`DependencyGraph` uses deterministic Kahn topological sorting with lexicographic tie-breaking. Zero-lag cycles fail explicitly. Lagged/state-mediated edges are accepted as non-current-period edges and are expected to be expanded by the higher-level dependency planner before evaluation.

## Accounting

`posting()` and `assertBalanced()` require debit total to equal credit total. Transactions are represented as explicit legs, and the runner derives cash flow from cash legs rather than treating recognition as cash automatically.

The current prototype intentionally leaves richer recognition/obligation/settlement orchestration to the next kernel increment. The golden scenarios exercise the semantic distinctions numerically and provide the regression boundary for that work.

## Monetary arithmetic

Posted monetary amounts use `bigint` cents. This avoids binary floating-point representation for ledger amounts. Mortgage formula evaluation uses floating-point only for the mathematical amortization formula and rounds the resulting payment to cents at the posting boundary; a production rate engine should replace this with a decimal/rational implementation.

## Golden harness

Golden scenarios live in `test/golden.test.ts`. Each scenario supplies an opening state and deterministic execution callback and asserts state, effects, transaction balance, statements, and key numerical invariants. The harness is intentionally reusable and should grow toward fixture-driven expectations as additional primitive contracts are implemented.

Run locally with:

```text
npm install
npm test
npm run typecheck
```
