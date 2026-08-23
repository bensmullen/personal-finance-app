# Personal Finance App — Executable Financial Semantics Specification

**Version:** 0.1.0-draft  
**Status:** Draft implementation contract  
**Namespace:** `pfm`  
**Depends on:** `personal_finance_canonical_schema_v1.0.json`, `personal_finance_simulation_interfaces_v1.0.ts`

## 1. Purpose and authority

This specification converts the canonical domain model into an executable mathematical contract. It defines how time, primitive instances, composition, state transitions, dependencies, events, and stochastic state are evaluated by the simulation engine.

The canonical schema remains authoritative for domain vocabulary, object structure, primitive registry membership, and high-level invariants. This document is authoritative for execution semantics where the canonical schema previously described behavior only informally.

A conforming engine MUST produce identical results for identical immutable inputs, specification version, engine version, and random seed. Differences require an explicit specification or engine-version change.

## 2. Mathematical model

A simulation run consists of discrete timesteps indexed by `k = 0 ... N-1`. Let:

- `t_k` = beginning instant of timestep `k`.
- `t_{k+1}` = beginning instant of the next timestep.
- `P_k = [t_k, t_{k+1})` = the half-open simulation period.
- `S_k` = authoritative state at `t_k`.
- `I_k` = immutable inputs applicable to `P_k`.
- `A_k` = assumptions resolved for `P_k`.
- `E_k` = events activated during `P_k`.
- `R_k` = random state/draws for `P_k`.
- `D_k` = dependency graph evaluated for `P_k`.
- `F_k` = generated economic flows.
- `T_k` = posted transactions.
- `S_{k+1}` = state after all postings and end-of-period valuation.

The authoritative transition is:

`S_{k+1} = Transition(S_k, I_k, A_k, E_k, R_k, D_k, F_k, T_k)`

A primitive is a pure or explicitly stateful transformation evaluated inside this transition. No primitive may mutate authoritative state directly; it emits a value, state delta, event activation, constraint, or transaction proposal that is subsequently applied by the appropriate engine subsystem.

## 3. Temporal semantics

### 3.1 Instants and periods

The engine distinguishes an **instant** from a **period**.

An instant is a point on the timeline and is represented by an ISO-8601 timestamp with offset. A period is the half-open interval `[start, end)`.

Date-only model inputs are interpreted in the scenario jurisdiction's calendar/timezone and normalized to a timestamp at the beginning of that civil date unless the object explicitly defines another convention.

Half-open periods prevent double counting at boundaries: an activity at `t_{k+1}` belongs to the next period, not both periods.

### 3.2 State boundaries

`S_k` is the complete authoritative state immediately before any activity whose timestamp lies in `P_k` is processed.

`S_{k+1}` is the complete authoritative state immediately after all activity in `P_k` has been recognized, settled, posted, and the required end-of-period valuation has been performed.

For every state variable `x`:

`x_{k+1} = Apply(x_k, Δ_k)`

where `Δ_k` is the ordered set of state deltas produced during the timestep.

### 3.3 Recognition, accrual, and settlement

These are distinct concepts:

- **Accrual:** economic value becomes attributable to the period.
- **Recognition:** the accrued amount is represented in the appropriate statement/accounting classification.
- **Settlement:** cash or another financial asset actually changes hands.

A model MAY recognize and settle simultaneously, but MUST NOT assume that they are inherently identical.

Example: mortgage interest can accrue during the month, be recognized as expense, and be settled as part of a later payment.

### 3.4 Default timestep convention

The scenario timestep controls evaluation frequency. Supported timesteps are daily, monthly, quarterly, and annual.

A monthly timestep means calendar months, not a fixed 30-day duration. Quarterly means calendar quarters. Annual means calendar years.

When a model has a frequency finer than the scenario timestep, occurrences are aggregated into the containing simulation period. When a model has a frequency coarser than the scenario timestep, its amount is emitted only on its scheduled recognition/settlement period.

### 3.5 Partial periods

The first and last simulation periods MAY be partial periods. Rate-based mechanics MUST use an explicit day-count or period-fraction convention rather than silently treating every partial period as a full period.

Default convention for generic annualized rates is:

`fraction = actual_days / actual_days_in_calendar_year`

A financial mechanic may override this with a declared convention such as monthly periodic rate, 30/360, or another rule.

### 3.6 Frequency conversion

For an amount `A` specified per occurrence, the engine MUST NOT infer a different occurrence amount merely because the simulation timestep differs.

For a rate `r` expressed per annum, conversion to a period rate requires an explicit compounding convention. Under nominal periodic compounding with `m` periods per year:

`r_p = r / m`

Under effective annual compounding for a fractional period `f`:

`r_p = (1+r)^f - 1`

The primitive or rule MUST identify which convention it uses.

### 3.7 Same-timestamp ordering

When multiple activities share an effective timestamp, the engine orders them by the following precedence classes:

1. Structural/state-opening and account availability changes.
2. External inputs and stochastic sampling.
3. Event activation.
4. Event modifications and policy changes.
5. Accrual and valuation calculations.
6. Income and expense recognition.
7. Tax calculation based on recognized activity.
8. Contributions, withdrawals, debt draws, and scheduled payments.
9. Transfers and investment trades.
10. Settlement transactions.
11. End-of-period mark-to-market and derived-state calculations.
12. Invariant validation.

Within a precedence class, explicit dependency edges and then explicit priority determine order. Equal-priority conflicting writes are invalid.

This ordering is a default semantic order, not an implementation detail. The engine MUST expose it in diagnostics.

## 4. Primitive execution contract

Every `PrimitiveInstance` is evaluated through the following conceptual interface:

`evaluate(context, inputs, parameters, priorState, randomState) -> PrimitiveResult`

A `PrimitiveResult` contains:

- `value`: current output value or series element.
- `stateDelta`: state to carry into the next timestep, if stateful.
- `emissions`: zero or more flow/event/transaction proposals.
- `constraints`: validity constraints applicable to the result.
- `diagnostics`: warnings or informational metadata.

A primitive MUST declare:

- input bindings;
- parameters;
- units and domains;
- initialization rule;
- evaluation equation;
- state transition, if any;
- whether it samples randomness;
- whether it reads prior-period state;
- composition behavior;
- failure conditions.

### 4.1 Composition model

Primitive composition is function composition over a common temporal domain.

For primitives `P` and `Q`, where `P` produces a series accepted by `Q`:

`Y_t = Q(P(X))_t`

Composition is valid only when units, domains, temporal scope, and state requirements are compatible.

A temporal primitive normally acts as a domain operator, while a functional/dependency/mechanics primitive transforms values on that domain.

A composition graph MUST be acyclic unless a stateful primitive explicitly consumes prior-period state. Same-period circular composition is invalid.

### 4.2 State ownership

A stateful primitive owns only its declared internal state. It MUST NOT silently infer state from mutable object fields unless those fields are explicitly bound as state inputs.

State is initialized once at simulation start or primitive activation, then updated once per timestep.

## 5. Primitive semantics

### P01 — static

**Purpose:** retain a fixed configured value.

`X_k = c`

Inputs: none. Parameter: `value = c`. State: none. Randomness: none.

Initialization and evaluation are identical. If an event modifies the configured value, the modification creates a new effective parameter from the event boundary onward; historical values are unchanged.

Failure: none beyond domain/unit validation.

### P02 — one_time

For trigger instant `τ` and value `V`:

`X(P_k) = V` iff `τ ∈ P_k`; otherwise `0`.

The trigger is emitted exactly once. If the simulation starts after `τ`, the event is not retroactively emitted unless the instance explicitly declares catch-up behavior.

### P03 — recurring

A recurrence calendar defines a set of occurrence instants `C`. For amount `A`:

`X(P_k) = Σ_{τ∈C∩P_k} A`

Recurrence generation is calendar-aware. Biweekly recurrence is 14-day based; semimonthly is calendar-day based. Recurrence must preserve its anchor date.

### P04 — finite_duration

For base series `f(t)` and inclusive date interval `[a,b]`:

`X_t = f(t)` when `a <= t <= b`; otherwise `0`.

At timestep resolution, inclusion is determined by overlap with the active interval. End-date settlement may occur on the end date even though subsequent periods are inactive.

### P05 — perpetual

For start `a`:

`X_t = f(t)` for `t >= a`; otherwise `0`.

There is no implicit termination date.

### P06 — constant

`X_t = c` for every evaluated timestep in the primitive's active temporal domain.

Unlike `static`, `constant` is a functional operator and therefore can be composed with another temporal domain.

### P07 — linear

With initial value `X0`, slope `g`, and elapsed basis `n(t)`:

`X_t = X0 + g*n(t)`

`n(t)` MUST be defined by the primitive instance as elapsed periods or elapsed fractional periods. No implicit basis is permitted.

### P08 — geometric_growth

`X_t = X0 * (1+g)^{n(t)}`

`g > -1` for standard real-valued growth. If a rate series is supplied, the equivalent recursive form is:

`X_{k+1}=X_k(1+g_k)`

### P09 — geometric_decline

`X_t = X0 * (1-d)^{n(t)}`

Standard decline requires `0 <= d <= 1`. Negative decline must use growth semantics instead.

### P10 — stepwise

Given ordered breakpoints `(τ_i, L_i)`, the active level is the most recent level whose breakpoint has occurred:

`X_t = L_j` where `τ_j <= t < τ_{j+1}`.

Breakpoints must be strictly ordered. Equal-date breakpoints require explicit priority and cannot silently overwrite each other.

### P11 — piecewise

Given mutually exclusive ordered predicates/segments:

`X_t = f_j(t)` for the unique segment `j` whose predicate is true.

Overlapping segments require explicit priority. If no segment matches, the instance uses its declared default or fails validation; it MUST NOT silently return zero unless zero is explicitly the default.

### P12 — periodic

For period `p` and phase `φ`:

`X_k = V[(k-φ) mod p]`

The period is measured in the primitive's declared timestep units. Phase MUST be normalized into `[0,p-1]`.

### P13 — inflation_linked

For base value `B_k` and inflation series `π_k`:

`X_0 = B_0`

`X_{k+1}=B_{k+1} * Π_{j=0}^{k}(1+π_j)`

If the base is itself time-varying, inflation applies multiplicatively to each base observation according to the declared reference index. The instance MUST declare whether inflation is applied prospectively from the base date or to the entire historical base.

### P14 — index_linked

For index level `I_k` and base index `I_0`:

`X_k = X_0 * I_k/I_0`

`I_0` MUST be nonzero. Index linking preserves proportional exposure; it does not represent compounding independently of the supplied index.

### P15 — balance_dependent

For referenced balance `B_k` and function `f`:

`X_k=f(B_k)`

The default binding is to **beginning-of-period** balance when the output is used to determine activity during the same period. A binding to ending balance MUST declare a lag or otherwise create a same-period dependency that is explicitly resolvable.

This rule prevents ambiguous constructs such as interest simultaneously determining and depending on the ending balance.

### P16 — income_dependent

`X_k=f(I_k)` where `I_k` is the declared income node. If income is produced earlier in the dependency order, current-period income may be used; otherwise the binding MUST specify a lag.

### P17 — age_dependent

`X_k=f(age(t_k))`

Age is measured from date of birth using elapsed calendar time. For annual/monthly models, fractional age MAY be used when explicitly configured; otherwise completed years are used.

### P18 — account_dependent

`X_k=f(A_k)` where `A_k` is the declared account state. The default is beginning-of-period state for policies that determine same-period activity.

### P19 — market_dependent

`X_k=f(M_k)` where `M_k` is a sampled or externally supplied market process. Market observations MUST be generated before dependent investment valuation and MUST use the scenario random seed/process identity.

### P20 — tax_dependent

`T_k = TaxRule(B_k)`

`B_k` is the taxable base after all prerequisite income, deductions, exclusions, and other tax inputs have been resolved. Tax rules are effective-date scoped. A tax calculation MUST identify the exact rule version used.

### P21 — dependency_driven

`X_k=f(X_{1,k},...,X_{n,k})`

Dependencies are explicit graph bindings. The evaluator reads only resolved dependency values and MUST reject unresolved nodes or ambiguous cycles.

### P22 — amortization

For beginning balance `B_k`, periodic rate `r_k`, and remaining payment count `n_k`, fixed-payment amortization uses:

`PMT_k = B_k*r_k*(1+r_k)^{n_k}/((1+r_k)^{n_k}-1)` when `r_k != 0`.

When `r_k = 0`, `PMT_k = B_k/n_k`.

Interest:

`Interest_k = B_k*r_k`

Principal:

`Principal_k = min(B_k, max(0, PMT_k-Interest_k))`

Ending balance:

`B_{k+1}=B_k-Principal_k+NewDraws_k`

The final payment is capped so that principal cannot become negative. Fees and extra payments are separate flows, not silently folded into principal.

### P23 — compounding

`V_{k+1}=V_k(1+r_k)+C_k-W_k`

where `C_k` and `W_k` are contributions and withdrawals explicitly bound to the primitive. Returns and cash contributions MUST remain distinguishable so accounting can classify them separately.

### P24 — accrual

`B_{k+1}=B_k+F_k`

The primitive records economic accumulation without requiring immediate cash settlement. If settlement later occurs, the settlement transaction consumes accrued state rather than re-recognizing the same amount.

### P25 — depreciation

Under declining-balance form:

`V_{k+1}=max(V_floor, V_k*(1-d_k))`

The selected method controls the exact equation. A straight-line method is:

`Dep_k=(Cost-Salvage)/UsefulPeriods`

subject to remaining basis and floor constraints.

### P26 — mark_to_market

`V_k=Q_k*P_k`

Quantity and price must be expressed in compatible units/currencies. Fractional quantities are permitted unless the instrument configuration prohibits them.

A mark-to-market valuation is a state valuation change; it does not automatically create a realized transaction or cash flow.

### P27 — event_trigger

An event is active when its trigger predicate resolves true for the current instant/period. Activation is edge-triggered by default: a scheduled or newly satisfied condition creates one activation at the first qualifying instant.

A level-triggered recurring effect must explicitly use recurring or persistent event semantics.

### P28 — conditional

`X_k = Y_k` if `C_k=true`; otherwise `Z_k`.

The condition is evaluated once after all prerequisite dependencies are resolved. Only the selected branch is evaluated when branch evaluation is stateful or stochastic, unless the instance explicitly requests eager evaluation.

### P29 — event_modification

For base series `X` and event modification operator `M` activated at `τ`:

`Y_t = X_t` for `t < τ`; `Y_t=M(X_t, eventState_t)` for `t >= τ`.

If the modification is a level shift, the shifted level persists until another modification or termination. Historical outputs remain unchanged.

### P30 — event_termination

For termination instant `τ`:

`Y_t=X_t` for `t < τ`; `Y_t=0` for `t >= τ`.

The termination is idempotent. Repeated evaluation after termination does not generate repeated termination transactions.

### P31 — probabilistic

`X_k ~ D(θ_k)`

Each stochastic primitive has a named random-process identity. The engine derives its random stream deterministically from `(simulation_seed, process_id, timestep, draw_index)` so adding an unrelated stochastic process does not silently reorder all existing draws.

Distribution parameters are validated before sampling. A sample outside the primitive's declared domain is an error unless an explicit truncation/transformation rule exists.

### P32 — scenario_dependent

`X_k=f_s(k)` where `s` is the active scenario. Scenario inheritance resolves from base scenario to child scenario, with child values overriding inherited values only when explicitly declared.

A scenario change is configuration-level, not a stochastic draw.

### P33 — correlated_random_process

For marginals `D_1...D_n` and correlation matrix `Σ`, the engine generates a correlated latent vector and transforms it into the requested marginals.

`Σ` MUST be symmetric positive semidefinite. If numerical repair is required, the repair method and resulting matrix MUST be recorded in diagnostics.

The same correlation group uses one shared process realization per timestep. Independent groups MUST use independent random streams.

### P34 — path_dependent

`X_k=f(H_k)` where `H_k` is an explicitly bound history of prior state/output observations.

The current-period output MUST NOT access future values. The history window and ordering are part of the primitive instance. If the function requires a prior value, the prior value is `H_{k-1}`, never an incompletely evaluated current-period value.

## 6. Primitive composition rules

1. A primitive may consume another primitive's output only if units and temporal domains are compatible.
2. Temporal restriction operators (`one_time`, `recurring`, `finite_duration`, `perpetual`) define when values exist.
3. Functional operators transform values without creating accounting transactions by themselves.
4. Dependency primitives read explicitly bound nodes.
5. Financial-mechanics primitives may create state deltas and transaction proposals but never post directly.
6. Event/uncertainty primitives may activate behavior or produce sampled values but must route resulting economic activity through normal flow/transaction semantics.
7. A composition cannot create hidden state. Every carried state must be declared.
8. A composition cannot silently change units, currency, or sign convention.
9. A stateful composition requires a well-defined evaluation order and prior-state boundary.
10. If two composed primitives both claim authority over the same state field, the composition is invalid unless one is explicitly a modifier with precedence.

## 7. Evaluation context

Every primitive evaluation receives an immutable `EvaluationContext` containing at minimum:

- scenario ID;
- specification version;
- engine version;
- simulation run ID;
- timestep index;
- period start/end;
- scenario timestep;
- calendar/timezone context;
- current state snapshot;
- prior resolved dependency values;
- active events;
- applicable assumptions;
- random-process context.

Primitive implementations MUST treat the context as read-only.

## 8. Dependency and evaluation semantics

### 8.1 Graph construction

Nodes identify authoritative inputs, state, flows, events, rules, derived values, and simulation outputs. Edges identify reads, writes, modifications, triggers, constraints, and aggregations.

The engine expands lagged edges into prior-state references before cycle detection.

### 8.2 Cycle rule

A zero-lag cycle is invalid unless the cycle contains an explicitly stateful recurrence whose incoming dependency is from a prior timestep. A recurrence must have effective lag >= 1.

Example:

`Balance_t -> Interest_t -> Payment_t -> Balance_{t+1}` is valid.

`Balance_t -> Interest_t -> Payment_t -> Balance_t` is invalid.

### 8.3 Topological evaluation

After lag expansion, the engine performs a stable topological sort. Tie-breaking is:

1. dependency priority descending;
2. semantic phase precedence;
3. deterministic node key ascending.

This guarantees deterministic ordering without relying on hash-map iteration order.

### 8.4 Conflicting writes

Multiple writes to one target are allowed only when all of the following hold:

- the operations are composable;
- their priorities are distinct; or
- an explicit merge operator is declared.

Equal-priority conflicting writes are hard errors.

### 8.5 Derived nodes

Derived nodes are never authoritative write targets. Transactions modify authoritative state/flows; derived values are recomputed from those facts.

## 9. Event semantics

An event has a lifecycle:

`scheduled -> eligible -> activated -> effects_applied -> completed`

A conditional event may remain `eligible` across multiple periods. Activation occurs at the first period in which its trigger is satisfied unless recurring activation is explicitly configured.

Event effects are applied in event precedence order. Event modifications are applied before downstream calculations that depend on modified state.

An event that creates financial activity does so by emitting normal flow or transaction proposals. Event effects must not bypass accounting.

## 10. Flow and transaction boundary

A primitive output becomes a financial transaction only when the model declares that the economic activity is realized.

Examples:

- salary primitive output -> income flow -> salary transaction when paid;
- investment return -> valuation state change when unrealized; realized sale transaction only when sold;
- mortgage interest -> expense/accrual; cash settlement when payment occurs;
- account transfer -> transfer transaction with no consolidated household cash-flow effect.

This separation is required to avoid conflating economic value, accounting recognition, and cash movement.

## 11. State transition semantics

For each timestep, the engine executes:

1. Snapshot beginning state `S_k`.
2. Resolve scenario inputs and applicable assumptions.
3. Sample stochastic processes.
4. Determine active events.
5. Apply event modifications to the effective model.
6. Build/expand dependency graph.
7. Resolve deterministic dependencies in topological order.
8. Evaluate temporal and functional primitives.
9. Evaluate financial mechanics.
10. Generate flows.
11. Calculate taxes from resolved taxable bases.
12. Generate transaction proposals.
13. Validate transaction proposals.
14. Post balanced transactions.
15. Apply state deltas.
16. Perform required end-of-period valuation.
17. Recompute derived outputs.
18. Validate all invariants.
19. Persist timestep result.

If a hard error occurs before posting, no partial authoritative state may be committed for the timestep.

## 12. Atomicity and rollback

A timestep is an atomic simulation unit. The engine may internally use mutable working state for performance, but the externally observable state must satisfy:

`CommittedState_{k+1} = ValidTransition(S_k)`

or, on hard failure, the run records the failure and leaves the last committed state unchanged.

A transaction batch is also atomic: either all accounting legs post or none post.

## 13. Accounting interaction

Every realized transaction produces balanced accounting legs. Primitive outputs do not directly alter Balance Sheet, Income Statement, or Cash Flow Statement totals.

For every transaction and currency:

`Σ Debit = Σ Credit`

For household consolidated state:

`Assets_k - Liabilities_k = NetWorth_k`

Cash roll-forward:

`Cash_{k+1}=Cash_k+OperatingCF_k+InvestingCF_k+FinancingCF_k`

Internal transfers are excluded from consolidated household cash flow.

Unrealized mark-to-market changes affect asset/equity or gain/loss presentation according to the selected statement convention but do not create cash flow.

## 14. Failure semantics

Hard errors include:

- unresolved dependency;
- zero-lag cycle;
- invalid primitive parameters;
- invalid units or currency;
- conflicting equal-priority write;
- unbalanced transaction;
- negative liability balance where prohibited;
- invalid stochastic distribution or correlation matrix;
- invalid temporal interval;
- duplicate one-time activation;
- unauthorized write to a derived field.

Warnings include:

- unusual but valid assumptions;
- partial-period calculations using explicit prorating;
- numerical covariance repair;
- models with materially incomplete optional inputs.

Every diagnostic MUST include run ID, timestep, node/primitive ID when applicable, severity, and human-readable explanation.

## 15. Determinism and reproducibility

Deterministic runs require no random draws. Stochastic runs persist:

- simulation seed;
- specification version;
- engine version;
- scenario ID;
- random process identifiers;
- stochastic configuration;
- correlation-group configuration.

Random streams are process-isolated. Randomness MUST NOT depend on incidental iteration order.

## 16. Numerical semantics

Money is modeled as fixed-scale decimal at the domain boundary. Intermediate engine calculations MAY use higher precision but MUST round only at explicitly defined accounting/settlement boundaries.

Default monetary rounding is half-up to four decimal places unless a tax rule, financial product rule, or jurisdiction-specific rule declares another method.

Rates are fractional values, not percentages: `0.05` means 5%.

Floating-point binary representation MUST NOT be used as the authoritative persisted representation of monetary amounts.

## 17. Golden-test requirements

Before implementing broad financial features, the engine MUST pass golden scenarios covering at minimum:

1. Static monthly salary with no growth.
2. Monthly salary with annual step increase.
3. Recurring expense with inflation.
4. Mortgage amortization with interest/principal split.
5. Investment contribution plus deterministic return.
6. Investment sale with realized gain.
7. Account transfer with zero consolidated cash-flow impact.
8. Job-loss event terminating salary and modifying expenses.
9. Conditional contribution based on disposable income.
10. A lagged dependency chain.
11. A deliberate zero-lag cycle that must fail.
12. A balanced transaction and an intentionally unbalanced transaction.
13. A stochastic process reproduced exactly from a fixed seed.
14. Two correlated stochastic processes with deterministic stream identity.

Each golden test should specify initial state, scenario inputs, expected transactions, expected ending state, and expected derived statements/metrics.

## 18. Implementation mapping

The existing TypeScript interfaces remain the external contract for domain objects. This specification adds the missing execution contracts; implementation types should therefore add, rather than replace, concepts such as:

- `TemporalContext`
- `EvaluationContext`
- `PrimitiveResult`
- `StateDelta`
- `FlowProposal`
- `TransactionProposal`
- `RandomProcessContext`
- `DependencyEvaluationPlan`
- `EvaluationDiagnostic`

These are implementation concepts and need not become canonical persisted domain objects.

## 19. Open decisions for v0.2

The following intentionally remain explicit follow-up decisions rather than hidden assumptions:

- exact date/timezone policy for every jurisdiction;
- authoritative day-count conventions by financial mechanic;
- full accounting chart-of-accounts taxonomy;
- tax timing versus filing/settlement timing;
- exact treatment of unrealized gains in personal financial statements;
- multi-currency/FX semantics;
- Monte Carlo confidence/tail metric methodology;
- exact expression language and sandboxing rules;
- persistence format for primitive state snapshots;
- performance strategy for long-horizon, high-frequency simulations.

These decisions should be resolved before the corresponding subsystem becomes production-critical, not before the first deterministic vertical slice.
