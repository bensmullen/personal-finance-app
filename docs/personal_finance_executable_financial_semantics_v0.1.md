# Personal Finance App — Executable Financial Semantics Specification

**Version:** 0.1.1-draft  
**Status:** Draft implementation contract  
**Namespace:** `pfm`  
**Depends on:** `personal_finance_canonical_schema_v1.0.json`, `personal_finance_model.schema.json`, `personal_finance_simulation_interfaces_v1.0.ts`

## 1. Purpose and authority

This specification defines executable behavior for the personal-finance simulation engine. It closes the semantic gaps between the canonical domain model and an implementation that must produce deterministic, financially coherent state transitions.

The canonical schema remains authoritative for domain vocabulary, objects, enum membership, and canonical primitive identities. This document is authoritative for runtime semantics where the canonical schema previously described behavior only informally.

A conforming engine MUST produce the same observable result when given the same:

- model inputs;
- scenario and assumptions;
- initial state;
- specification version;
- engine version;
- stochastic realization/seed.

The engine MUST NOT rely on incidental implementation ordering, floating-point map iteration, or hidden mutable state to determine financial results.

## 2. Foundational semantic model

The system distinguishes five different kinds of information:

1. **State** — a point-in-time condition that persists between timesteps.
2. **Flow** — an economic quantity accumulated or recognized over a period.
3. **Effect** — an attempted change to state, a recognition, a settlement, or another executable consequence.
4. **Transaction** — a realized accounting event that posts one or more balanced accounting legs.
5. **Event** — a discrete occurrence that changes future behavior or state.

A primitive evaluation does not directly mutate authoritative state. It produces values and/or effects. The transition engine validates and applies those effects.

The authoritative timestep transition is:

`S_{k+1} = Commit( S_k, E_k, R_k, D_k, F_k, T_k )`

where:

- `S_k` = beginning-of-period authoritative state;
- `E_k` = event activations/effects during the period;
- `R_k` = stochastic realization values for the period;
- `D_k` = dependency resolutions;
- `F_k` = generated economic flows and recognized facts;
- `T_k` = transactions accepted for posting;
- `S_{k+1}` = committed end-of-period state.

The state transition is atomic at the timestep boundary.

## 3. Temporal semantics

### 3.1 Instants, dates, and periods

An **instant** is a point in time and is represented internally as an instant with timezone/offset information.

A **calendar date** is a civil date in the applicable jurisdiction/calendar.

A **simulation period** is a half-open interval:

`P_k = [t_k, t_{k+1})`

The start belongs to the period. The end does not.

All internally represented temporal intervals MUST be half-open. Object-level date fields that historically imply an inclusive final calendar date are converted into a half-open interval at the calendar boundary.

Example:

`start_date = 2026-01-01`, `end_date = 2026-01-31`

means active calendar dates January 1 through January 31 inclusive, represented internally as:

`[2026-01-01 00:00, 2026-02-01 00:00)` in the relevant timezone.

This rule applies uniformly to employment, expenses, insurance coverage, primitive duration, and similar calendar-date behavior.

### 3.2 Simulation timestep

A scenario declares a timestep of daily, monthly, quarterly, or annual.

Calendar-based timesteps are used:

- monthly = calendar month;
- quarterly = calendar quarter;
- annual = calendar year.

A simulation period is never assumed to equal a fixed number of days unless the specific financial rule explicitly declares a fixed-day convention.

### 3.3 State boundaries

`S_begin` is the complete committed state immediately before processing any activity in the period.

`S_end` is the complete committed state after all applicable activity, postings, state transitions, and required closing valuations are complete.

A calculation MUST identify whether it consumes:

- `opening_state` = `S_begin`;
- `intraperiod_value` = a value resolved earlier in the current period;
- `closing_state` = `S_end`;
- `prior_state` = an explicitly lagged state such as `S_{k-1}`.

The engine MUST NOT expose partially updated mutable state as an implicit dependency.

### 3.4 Economic time versus accounting time

A modeled quantity may have up to four distinct times:

- **occurrence/effective time** — when an economic fact becomes true;
- **accrual time** — when value becomes attributable to a period;
- **recognition time** — when the fact is recorded for statement/accounting purposes;
- **settlement time** — when cash or another financial instrument changes hands.

They MAY be equal, but the engine MUST NOT assume that they are equal.

Transactions MUST retain the applicable times/provenance even when the current canonical persistence model later stores them in a normalized representation.

### 3.5 Same-time ordering

There is no universal "tax before contribution" or "investment before expense" economic ordering. Instead, the engine uses **semantic barriers plus dependency ordering**.

The global barriers are:

1. establish period/timeline context;
2. sample/resolve external stochastic inputs;
3. activate events at their effective times;
4. apply event modifications that change the effective model;
5. construct/validate the dependency graph;
6. evaluate nodes whose prerequisites are satisfied;
7. generate economic flows and recognition facts;
8. generate settlement/transaction proposals;
9. post transactions and commit state deltas;
10. perform closing valuation and derived-output calculation;
11. validate invariants.

Within barriers 6–8, **dependency topology, temporal basis, and explicit priority** determine order.

A calculation MUST declare its inputs rather than relying on the global phase list to imply them.

### 3.6 Stable ordering

When multiple eligible operations are otherwise independent, stable ordering is:

1. explicit dependency priority, descending;
2. semantic barrier/phase;
3. stable object/node identifier ascending;
4. primitive instance identifier ascending;
5. generated occurrence sequence ascending.

Stable ordering is for deterministic evaluation only. It MUST NOT change economic meaning when dependencies are correctly declared.

### 3.7 Partial periods

Every primitive that depends on elapsed time or accrued amount MUST declare a temporal measurement mode:

- `instantaneous`;
- `occurrence_based`;
- `period_based`;
- `elapsed_time`;
- `calendar_fraction`;
- `boundary_state`;
- `explicit_timestamp_schedule`.

Where elapsed-time prorating is required, the primitive MUST declare its day-count basis. Supported bases include actual/actual, actual/365, actual/360, 30/360, and calendar-month fraction.

The default generic annualized-rate convention is **actual/actual** only when explicitly selected by the model. The engine MUST NOT silently choose a basis for a financial product.

### 3.8 Frequency conversion

Amounts and rates are distinct.

An amount specified as `$1,000 per occurrence` remains `$1,000` per occurrence regardless of simulation timestep.

Rates MUST declare their basis:

- per-period;
- nominal annual;
- effective annual;
- continuous;
- other explicit basis.

For effective annual rate `r` over fraction `f` of a year:

`r_f = (1+r)^f - 1`

For nominal annual rate `r_nom` with `m` contractual compounding periods per year:

`r_p = r_nom / m`

No rate conversion may be inferred from a field name alone.

## 4. Economic flow, recognition, settlement, and transaction semantics

### 4.1 Flow

A flow is an economic magnitude assigned to a period. Examples include salary earned, interest incurred, investment return, and consumption.

A flow does not necessarily change cash.

### 4.2 Recognition fact

A recognition fact assigns a flow to an accounting or tax period. It may create an asset, liability, income, expense, gain/loss, or other accounting effect.

Recognition MUST NOT be inferred solely from transaction type.

### 4.3 Settlement

Settlement is the exchange of cash or another financial instrument to satisfy a recognized obligation/right.

Settlement MUST reference the economic/recognition fact it settles.

A settlement transaction MUST NOT recognize the underlying income/expense a second time merely because cash moved.

### 4.4 Accrual obligation

When an accrued amount is not immediately settled, the system MUST represent the resulting obligation/right explicitly.

For example, accrued but unpaid tax is:

`Tax expense -> Tax payable`

and later:

`Tax payable -> Cash`

The later settlement MUST consume the payable rather than creating a second tax expense.

Similarly, accrued interest MAY be represented as an interest payable/accrued liability rather than silently increasing debt principal. Capitalization into principal is permitted only when explicitly modeled.

### 4.5 Effects versus transactions

A primitive may emit:

- value output;
- state delta proposal;
- flow proposal;
- recognition fact;
- settlement proposal;
- event activation;
- dependency invalidation;
- constraint/diagnostic.

Only the accounting/transaction subsystem may create authoritative posted accounting legs.

## 5. Primitive execution contract

Every primitive instance is evaluated conceptually as:

`evaluate(context, inputs, parameters, priorPrimitiveState, randomContext) -> PrimitiveEvaluation`

A primitive evaluation contains:

- `outputs`;
- `stateUpdates` for state owned by the primitive;
- `effects`;
- `diagnostics`.

A primitive MUST declare:

1. identity;
2. input bindings;
3. parameter definitions;
4. units/domains;
5. owned state;
6. initialization;
7. evaluation equation;
8. state transition;
9. temporal basis;
10. accounting effects;
11. tax facts, if any;
12. event interactions;
13. dependency requirements;
14. constraints;
15. failure conditions;
16. composition type signature.

## 6. Typed primitive composition

Primitive composition is a **typed semantic pipeline**, not unrestricted mathematical function composition.

Each primitive has a conceptual signature:

`Primitive<InputType, OutputType, StateType, EffectType>`

and a declared operating domain:

- scalar value;
- rate;
- index;
- schedule;
- flow;
- state;
- activation predicate;
- transaction proposal;
- other explicitly named domain.

A composition `A -> B` is valid only when:

1. `A.output_type` is accepted by `B.input_type`;
2. units are compatible or an explicit conversion exists;
3. temporal domains are compatible or an explicit temporal adapter exists;
4. currency domains are compatible or an explicit FX transformation exists;
5. state ownership is unambiguous;
6. dependency direction is acyclic after lag expansion;
7. effect types are compatible with downstream consumers.

Temporal operators such as `one_time`, `recurring`, `finite_duration`, and `perpetual` operate primarily on **activation/schedule domains**. Functional operators operate on values. Financial-mechanics operators operate on flows/state. Event operators operate on activation and modification domains.

The engine MUST reject incompatible compositions during model validation.

### 6.1 Typed adapters

Where composition requires conversion, it MUST use an explicit adapter. Examples include:

- annual rate -> monthly effective rate;
- calendar schedule -> timestep aggregate;
- price series -> market value via quantity;
- nominal salary -> recognized gross income;
- recognized expense -> cash settlement.

There is no implicit coercion between economically different concepts.

## 7. Primitive semantics P01–P34

### P01 — static

Represents a configured value that is not intrinsically time-varying.

`X_k = c`

State: none.

An event modification creates a new effective parameter from its effective time onward; it does not rewrite completed history.

### P02 — one_time

For occurrence instant `τ` and output `V`:

`X(P_k) = V` iff `τ ∈ P_k` and the primitive has not already executed.

Execution status is committed only after the emitted effect is successfully committed. A failed/rolled-back timestep MUST NOT consume the one-time execution.

No retroactive execution occurs when a simulation starts after `τ` unless explicit catch-up semantics are configured.

### P03 — recurring

For recurrence set `C` and per-occurrence amount/value `A`:

`X(P_k) = Σ_{τ∈C∩P_k} A`

Each occurrence receives a stable occurrence identity.

The primitive does not assume that one occurrence equals one timestep. Multiple occurrences in a timestep remain separately identifiable before aggregation.

### P04 — finite_duration

All internal duration intervals are half-open:

`X_t = f(t)` for `start <= t < end`.

For date-only end dates, the effective end instant is the beginning of the following calendar date, giving intuitive inclusive calendar-date behavior.

The wrapper suppresses evaluation outside its active interval without changing the wrapped primitive's internal math.

### P05 — perpetual

`X_t=f(t)` for all `t >= start` until an explicit terminating condition, entity inactivity, or scenario boundary.

There is no implicit finite horizon other than the simulation itself.

### P06 — constant

A functional value generator:

`X_t=c`

`constant` is an operator over a declared temporal domain; `static` is a configured non-temporal input/fact. They are therefore distinct by **type and purpose**, not by numerical output.

### P07 — linear

`X(t)=X0+slope*n(t)`

`n(t)` MUST be explicitly declared as elapsed periods or elapsed fractional time.

### P08 — geometric_growth

Growth operates recursively over an explicitly declared rate basis.

For per-period rate `g_k`:

`X_{k+1}=X_k(1+g_k)`

For effective annual rate `g` over elapsed fraction `f`:

`X(t+f)=X(t)(1+g)^f`

The primitive MUST distinguish growth of a **stock** from growth of a **per-occurrence flow amount**. A salary growing 5% annually and paying monthly is modeled as an annual level transition plus a monthly recurring schedule, not as six percent-plus monthly compounding by accident.

### P09 — geometric_decline

`X_{k+1}=X_k(1-d_k)`

For standard decline, `0 <= d_k <= 1`. Nonlinear decline requires an explicit function rather than overloading the standard equation.

### P10 — stepwise

Given breakpoints `(τ_i,L_i)`, the active level is the most recent breakpoint at or before the evaluation instant.

Breakpoints at the same instant require explicit priority or are invalid.

Step transitions are instantaneous unless explicitly combined with a ramp/proration operator.

### P11 — piecewise

Exactly one segment should apply at a given evaluation point unless explicit priority resolves overlap.

If no segment matches, the primitive uses a declared default or raises a validation error.

### P12 — periodic

For period `p`, phase `φ`, and indexed value sequence `V`:

`X_k = V[(k-φ) mod p]`

`p` and `φ` are measured in the primitive's declared temporal units.

### P13 — inflation_linked

Inflation linking is defined through an explicit price index by default.

For base amount `X_base` at base index `I_base`:

`X_t = X_base * I_t/I_base`

The base date/index MUST be explicit.

When inflation is supplied as period rates `π_k`, the index evolves as:

`I_{k+1}=I_k(1+π_k)`

A time-varying base series MUST declare whether each observation is already nominal or is expressed in base-period purchasing power. The engine MUST reject an ambiguous basis.

### P14 — index_linked

For quantity `X_base` referenced to index `I_base`:

`X_t=X_base*(I_t/I_base)`

`I_base != 0`.

The primitive links to the supplied index and does not independently compound.

### P15 — balance_dependent

`X_k=f(B_k)` where `B_k` is an explicitly bound balance.

Default basis for same-period activity is `opening_state`.

If ending balance or an intraperiod state is required, that dependency MUST identify the earlier effect/order or declare a lag. Same-period circular dependencies are invalid unless a mathematically solved rule explicitly replaces the cycle.

### P16 — income_dependent

`X_k=f(I_k)` where `I_k` is an explicitly bound income node.

Current-period income is available only after its upstream dependencies have resolved. A dependency on an after-tax quantity MUST explicitly name the after-tax node rather than assuming that generic income is synonymous with disposable income.

### P17 — age_dependent

`X_k=f(age(t))`

Age evaluation convention MUST be one of:

- exact elapsed age;
- completed calendar years;
- period-start age;
- period-end age;
- event-instant age.

The chosen convention is part of the primitive configuration.

### P18 — account_dependent

`X_k=f(A_k)` where `A_k` is a specific account state or balance component.

For policies that determine activity within the same period, `A_k` defaults to opening state. Closing-state use requires explicit declaration.

### P19 — market_dependent

Consumes an explicitly bound market variable/process with declared observation timestamp, units, currency, and missing-data policy.

Market observation generation precedes dependent valuation calculations, but the dependency graph determines exact consumer order.

### P20 — tax_dependent

`T_k=TaxRule(B_k)`

The taxable base MUST be fully resolved before the tax rule executes.

Tax calculation may consume:

- recognized income;
- deductions;
- credits;
- taxable investment realizations;
- contribution facts;
- withdrawal facts;
- other explicitly modeled tax inputs.

Tax treatment is determined by the TaxRule, not by transaction labels alone.

### P21 — dependency_driven

`X_k=f(X_{1,k},...,X_{n,k})`

All dependencies are explicit. The engine MUST reject unresolved nodes and same-period algebraic cycles that are not solved by an explicit rule.

### P22 — amortization

Amortization separates four concepts:

`contract_rate -> interest_amount`

`payment_rule -> scheduled_payment`

`scheduled_payment + other payments -> principal_reduction`

`principal_reduction -> ending_balance`

For beginning balance `B_k` and periodic rate `r_k`:

`Interest_k = accrual(B_k, r_k, temporal_basis)`

For fixed-payment fully amortizing loans with remaining payment count `n_k` and periodic rate `r_k != 0`:

`PMT_k=B_k*r_k*(1+r_k)^{n_k}/((1+r_k)^{n_k}-1)`

If `r_k=0`:

`PMT_k=B_k/n_k`

Principal reduction from contractual payment:

`Principal_k=max(0,PMT_k-Interest_k)`

Additional principal payments are applied separately according to prepayment rules.

Ending balance:

`B_{k+1}=B_k-NewPrincipalPaid_k+NewDraws_k+CapitalizedInterest_k`

where `CapitalizedInterest_k` is zero unless explicitly permitted by the contract.

The primitive MUST separately represent:

- rate determination;
- interest accrual basis;
- payment determination;
- reset/recast policy;
- fees;
- extra principal;
- maturity/final payment;
- negative amortization, if allowed.

For variable-rate debt, the rate process and payment process are independent declared rules. A rate reset does not automatically imply a payment reset.

### P23 — compounding

Compounding is a balance-update operator, not a cash-flow timing assumption.

For a return rate `r_k` applied over a declared exposure interval:

`V_after_return=V_before_return*(1+r_k)`

Contributions and withdrawals are applied at explicitly declared timestamps or timing conventions.

For a contribution `C` at the beginning of the period:

`V_end=(V_begin+C)*(1+r)`

For a contribution at the end:

`V_end=V_begin*(1+r)+C`

For continuous or multiple intraperiod cash flows, the cash-flow timestamps MUST be available to the valuation rule.

The primitive MUST NOT silently combine return, contribution, and withdrawal effects into an indistinguishable net change.

### P24 — accrual

Accrual produces an economic/recognition amount for a period without requiring immediate settlement.

Generic form:

`F_k = accrual(base_k, rate_k, temporal_basis_k)`

and, where an explicit accrued balance exists:

`Accrued_{k+1}=Accrued_k+F_k-Settled_k`

Accrual does not itself settle cash.

### P25 — depreciation

Economic/book depreciation reduces carrying value according to a declared method.

Straight-line:

`Dep_k=min(RemainingDepreciableBasis, (Cost-Salvage)/RemainingUsefulPeriods)`

Declining balance:

`Dep_k=min(V_k-Salvage, V_k*d_k)`

The primitive MUST distinguish economic depreciation from tax depreciation. Tax depreciation is a tax-rule effect, not an automatic consequence of economic depreciation.

### P26 — mark_to_market

For a position with quantity `Q_t` and price `P_t`:

`MarketValue_t=Q_t*P_t`

unless an explicit valuation function exists.

The valuation change is recognized as unrealized gain/loss or another declared valuation effect according to the accounting convention. It does not produce cash.

If the same economic position is represented by an `Investment` and linked `Asset`, they MUST NOT both contribute independently to consolidated asset totals. See Section 10.

### P27 — event_trigger

An event trigger converts an event predicate into activation of another behavior.

Activation is edge-triggered by default. A condition that remains true does not repeatedly fire unless repeating behavior is explicitly declared.

### P28 — conditional

`X_k = Y_k` when `C_k=true`, otherwise `Z_k`.

The condition MUST be dependency-visible.

Only the selected branch is evaluated when branches have stateful side effects or stochastic draws, unless explicit eager evaluation is requested.

### P29 — event_modification

For effective modification time `τ`:

`Y_t=X_t` for `t<τ`

`Y_t=M(X_t,eventState_t)` for `t>=τ`

The modification MUST identify its target, precedence, duration, reversibility, and whether it changes a parameter, schedule, activation predicate, or formula.

Event modifications are model transformations, not unrestricted direct mutation.

### P30 — event_termination

For termination effective time `τ`:

`Y_t=X_t` for `t<τ`

`Y_t=0` for `t>=τ`

Termination is idempotent. Surviving obligations after termination must be modeled explicitly rather than assumed to disappear.

### P31 — probabilistic

`X_k~D(θ_k)`

Each stochastic variable has a stable identity. Random draws are derived conceptually from:

`RandomDraw = H(seed, scenarioId, realizationId, processId, timestep, drawIndex)`

where `H` is a deterministic keyed random-stream mechanism.

Adding an unrelated stochastic process MUST NOT alter existing process draws.

### P32 — scenario_dependent

`X_k=f_s(k)` for active scenario `s`.

Scenario inheritance resolves from base to child. Child configuration overrides inherited values explicitly.

Scenario selection is not itself a random event.

### P33 — correlated_random_process

The canonical implementation uses a **Gaussian copula / correlated latent-normal construction** unless a different joint model is explicitly declared.

For `n` variables:

1. validate correlation matrix `Σ` as symmetric positive semidefinite;
2. generate `Z ~ N(0,Σ)`;
3. transform `U_i=Φ(Z_i)`;
4. transform each `U_i` through the inverse CDF of marginal distribution `D_i`.

This produces marginals `D_i` with the specified latent Gaussian dependence structure.

A correlation matrix that is not mathematically admissible is a hard validation error unless an explicit numerical-repair policy is configured. If repaired, the repair method and final matrix MUST be recorded.

A correlated process has one stable group identity and one realization per timestep. Member variables reference the same group/process state rather than independently resampling correlation.

### P34 — path_dependent

`X_k=f(H_{0:k-1},S_k)`

The primitive may consume explicitly retained history but MUST NOT read future values or incompletely evaluated same-period values.

The history window and sufficient state required to reproduce it MUST be explicit.

## 8. Dependency-resolution semantics

### 8.1 Graph

The dependency graph is a typed directed graph over inputs, state, flows, events, rules, derived values, and simulation outputs.

Edges identify:

- reads;
- writes;
- modifies;
- triggers;
- constrains;
- aggregates.

### 8.2 Evaluation order

The graph, not a global financial-category order, is authoritative for calculation ordering.

The engine first creates semantic barriers and then performs a topological sort within each barrier.

A dependency may be:

- current-period;
- prior-state;
- lagged;
- event-driven;
- stochastic;
- closing-state.

### 8.3 Cycles

After expanding lagged/state-mediated edges, any remaining zero-lag algebraic cycle is invalid unless an explicit analytical solver/rule declares a unique solution.

Valid example:

`DebtBalance_k -> Interest_k -> Payment_k -> DebtBalance_{k+1}`

Invalid example:

`Tax_k -> DisposableIncome_k -> Tax_k`

unless the tax calculation is defined as a solved function whose root/solution is unambiguously specified.

### 8.4 Stateful feedback

State recurrence is represented across timestep boundaries.

The preferred representation is:

`S_k -> Flow_k -> S_{k+1}`

rather than creating same-period writes back into `S_k`.

### 8.5 Conflicting writes

Writes MUST identify their operation class:

- additive;
- replacing;
- constrained additive;
- mergeable;
- mutually exclusive.

Additive effects MAY be combined without priority when their algebra is commutative and their target semantics are additive.

Replacing/conflicting effects require explicit priority or merge semantics.

Equal-priority incompatible writes are hard errors.

## 9. Event semantics

Events have distinct times:

- occurrence time;
- effect effective time;
- optional recognition time;
- optional settlement time.

For example, a promotion can occur June 15, change salary effective June 15, be reflected in June 30 payroll, and be settled on June 30.

Event processing is:

`eligible -> activated -> effects_applied -> completed`

A generated event MUST NOT recursively execute indefinitely in the same activation pass. Newly generated events are placed into a deterministic event queue and evaluated according to their effective time and precedence.

An event cannot alter completed prior periods.

## 10. Account, investment, and asset representation

### 10.1 Container versus economic asset

An `Account` is a **financial container**. Its `current_balance` represents the account's cash/subledger balance, not the market value of securities held inside the account.

An `Investment` represents an economic position held inside an account. Its market value contributes to household assets.

Therefore:

`AccountEconomicValue = AccountCashBalance + Σ InvestmentMarketValue`

The Account container itself is not added as another asset on top of its contents.

### 10.2 Standalone assets

A standalone `Asset` represents an economic resource that is not merely the container representation of an Investment position.

Examples:

- home;
- vehicle;
- business interest;
- personal property.

A standalone Asset contributes its carrying/market value to total assets.

### 10.3 Investment-linked Asset

If an `Investment.asset_id` points to an `Asset`, the linked Asset is treated as an underlying/reference representation of the same economic position unless the model explicitly declares separate economic ownership.

The same economic value MUST NOT be counted once through `Investment.market_value` and again through `Asset.current_value`.

### 10.4 Asset aggregation invariant

At a timestep:

`TotalAssets = Σ(AccountCashBalances) + Σ(InvestmentMarketValues) + Σ(StandaloneAssetValues)`

where each economic position belongs to exactly one aggregation bucket.

The engine MUST validate that an economic position is not double-counted.

## 11. Accounting semantics

### 11.1 Accounting equation

At every committed state:

`Assets - Liabilities = NetWorth`

Equity/net-worth is residual, but it must be reproducible from posted accounting facts and state.

### 11.2 Normal balance effects

For standard double-entry behavior:

| Effect | Debit effect | Credit effect |
|---|---|---|
| Asset | increase | decrease |
| Liability | decrease | increase |
| Equity | decrease | increase |
| Income | decrease* | increase* |
| Expense | increase* | decrease* |
| Gain | decrease* | increase* |
| Loss | increase* | decrease* |
| Tax expense | increase* | decrease* |

`*` denotes statement/equity effects rather than a requirement that every income/expense leg itself be a standalone ledger account in the implementation.

The accounting engine MUST translate these effects explicitly; it MUST NOT infer semantics merely from a human-readable transaction label.

### 11.3 Transaction balance

For each transaction and currency:

`Σ Debits = Σ Credits`

All posting legs in a transaction are committed atomically.

### 11.4 Recognition versus settlement templates

#### Salary earned and recognized, unpaid

`Debit WageReceivable / UnpaidCompensation`

`Credit Income`

#### Salary paid

`Debit Cash`

`Credit WageReceivable / UnpaidCompensation`

#### Ordinary expense incurred, unpaid

`Debit Expense`

`Credit Payable`

#### Ordinary expense paid

`Debit Payable`

`Credit Cash`

If an expense is both incurred and paid at the same instant, the payable may be omitted and the expense paid directly from cash.

#### Tax recognized, unpaid

`Debit TaxExpense`

`Credit TaxPayable`

#### Tax paid later

`Debit TaxPayable`

`Credit Cash`

#### Mortgage payment with interest and principal

`Debit Liability` — principal reduction

`Debit InterestExpense` — interest

`Credit Cash` — total payment

If interest was already accrued to a separate payable, settlement uses that payable instead of recognizing interest expense again.

### 11.5 Cash-flow classification

Cash Flow Statement classification belongs to the cash-settlement leg, not merely to the economic recognition effect.

Internal transfers between consolidated household accounts are marked `non_cash` for consolidated reporting even though individual account balances change.

### 11.6 Investment valuation

Unrealized market-value changes:

- change asset/equity or gain/loss presentation according to the declared accounting convention;
- do not create cash flow;
- do not create a realized sale transaction.

A sale creates settlement cash flow and realizes the gain/loss according to basis.

### 11.7 Statement source of truth

Financial statements MUST be generated from the **posted accounting ledger/transaction facts plus authoritative state**, not independently from display-oriented state snapshots.

State snapshots are used to produce point-in-time balances. Posted accounting facts are the authoritative source for period income, expense, gain/loss, tax, and cash-flow classifications.

This prevents statement totals from drifting away from transaction history.

## 12. Financial statement timing and derived metrics

### 12.1 Balance Sheet

The Balance Sheet is point-in-time.

For a period ending at `t_{k+1}`:

`BS_{k+1}=StateSnapshot(t_{k+1})`

and:

`NetWorth_{k+1}=TotalAssets_{k+1}-TotalLiabilities_{k+1}`

### 12.2 Income Statement

The Income Statement covers recognized flows during the period:

`NetIncome_k = RecognizedIncome_k - RecognizedExpenses_k + Gains_k - Losses_k - TaxExpense_k`

Cash settlement timing does not change the period in which an already-recognized accrual belongs.

### 12.3 Cash Flow Statement

The Cash Flow Statement covers actual cash movements during the period:

`NetCashFlow_k = OperatingCF_k + InvestingCF_k + FinancingCF_k`

and:

`EndingCash_k = BeginningCash_k + NetCashFlow_k`

Consolidated internal transfers net to zero.

### 12.4 Disposable income

Disposable income is defined as a **period flow metric**:

`DisposableIncome_k = RecognizedHouseholdIncome_k - RecognizedHouseholdTaxes_k - RecognizedHouseholdConsumptionExpenses_k`

Transfers, investment purchases, principal repayment, and internal account movements are not consumption expenses.

If the model wants after-tax cash available for investment, that is a distinct derived metric and MUST NOT be conflated with disposable income.

### 12.5 Savings

Default savings is:

`Savings_k = DisposableIncome_k - DefinedConsumption_k`

The consumption definition is scenario-configurable. The metric MUST identify its included expense classes.

### 12.6 Savings rate

`SavingsRate_k = Savings_k / GrossIncome_k` when `GrossIncome_k > 0`.

The denominator and numerator are both period flows from the same statement period.

### 12.7 Point-in-time versus period metrics

Metrics MUST declare their temporal type:

- `point_in_time` — e.g. net worth, liquidity balance, debt balance;
- `period_flow` — e.g. income, expenses, savings;
- `rolling_period` — e.g. trailing-12-month spending;
- `rate` — e.g. savings rate;
- `distribution` — e.g. Monte Carlo percentile/probability.

A period flow must not be silently substituted for an ending balance or vice versa.

## 13. State transitions and atomicity

Each timestep is evaluated against an immutable beginning-state snapshot and produces a working state.

Conceptually:

```text
S_begin
  ↓
Event activation/modification
  ↓
Dependency resolution
  ↓
Primitive evaluation
  ↓
Economic effects
  ↓
Recognition / settlement proposals
  ↓
Accounting translation
  ↓
Transaction validation
  ↓
Atomic commit
  ↓
Closing valuation
  ↓
S_end
```

If any hard validation error occurs before commit, the working state and generated transaction batch are discarded and the prior committed state remains authoritative.

A one-time primitive becomes consumed only after the transaction/effect it owns is successfully committed.

## 14. Precision and numerical semantics

Persisted monetary values use decimal/fixed-scale representation. The canonical domain uses four decimal places.

Intermediate calculations SHOULD retain additional precision and MUST NOT round merely because a number crossed a primitive boundary.

Rounding occurs at explicit accounting/settlement/tax boundaries.

Default monetary rounding is half-up to four decimal places unless a governing rule explicitly specifies another mode.

Rates are fractions: `0.05 = 5%`.

Binary floating-point MUST NOT be the authoritative persisted representation of monetary amounts.

## 15. Stochastic reproducibility

The stochastic realization is identified by:

`(seed, scenario_id, realization_id, process_id, timestep, draw_index)`

Process streams are independent by stable process identity.

Correlation groups share the same correlated-process realization rather than drawing independently and attempting to "correct" correlation afterward.

All stochastic run metadata MUST persist the seed, process identities, specification version, engine version, scenario ID, and realization ID.

## 16. Failure semantics

Hard errors include:

- unresolved required dependency;
- invalid temporal interval;
- unresolvable zero-lag cycle;
- incompatible primitive composition;
- conflicting equal-priority writes;
- invalid rate/parameter domain;
- negative liability balance when prohibited;
- invalid correlation matrix;
- duplicate one-time execution;
- currency mismatch without explicit conversion;
- unbalanced transaction;
- unauthorized derived-field mutation;
- economic-position double counting.

Warnings include:

- unusually large but valid values;
- explicit numerical covariance repair;
- optional assumptions missing where defaults are allowed;
- low liquidity where configuration permits it.

The engine MUST NOT silently clamp material invalidity.

## 17. Golden-test requirements

The following tests are required before the first vertical slice is considered semantically sound.

### Time

1. Month-end boundary: an event at `Feb 1 00:00` belongs to February, not January.
2. Inclusive date object: January 1–January 31 remains active through January 31.
3. Mid-month employment start with explicitly selected proration basis.
4. Annual growth transition inside monthly simulation.

### Dependencies

5. Salary -> taxable income -> tax -> disposable income -> contribution.
6. Delayed/lagged dependency crossing a timestep boundary.
7. Deliberate zero-lag cycle fails.
8. Equal-priority conflicting writes fail.

### Accrual/settlement

9. Tax recognized in December and paid in April: December tax expense; April cash settlement; no duplicated expense.
10. Accrued interest followed by later payment without duplicate recognition.
11. Capitalized interest behaves differently when explicitly enabled.

### Accounting

12. Salary transaction balances.
13. Ordinary expense balances.
14. Mortgage payment separates principal and interest.
15. Internal transfer leaves consolidated net worth and consolidated cash unchanged.
16. Unrealized investment gain increases net worth without cash flow.
17. Investment sale creates cash flow and realized gain/loss.
18. Balance Sheet, Income Statement, and Cash Flow Statement reconcile.

### Container/position aggregation

19. Brokerage account with cash plus securities does not double count account value.
20. Investment linked to an Asset is counted exactly once.
21. Standalone home value is counted separately from financial-account contents.

### Debt

22. Fixed-rate amortization reaches zero within configured tolerance.
23. Zero-rate amortization works.
24. Variable-rate reset changes interest without automatically changing payment unless payment policy says so.
25. Negative amortization/capitalized interest is allowed only when explicitly configured.

### Stochastic behavior

26. Fixed seed reproduces identical path.
27. Adding an unrelated random variable does not alter an existing process path.
28. Correlated process reproduces identical joint draws.
29. Invalid correlation matrix fails before simulation.

Every golden test MUST specify initial state, exact model inputs, expected transactions/effects, expected state, expected statement outputs, and declared tolerances.

## 18. Canonical semantic laws

### Law 1 — Ownership conservation

A pure internal transfer does not change consolidated household net worth.

### Law 2 — State continuity

Absent an explicit committed transition, state persists.

### Law 3 — Event non-retroactivity

Events cannot alter completed historical periods.

### Law 4 — Dependency visibility

Every current-period derived value has discoverable upstream dependencies.

### Law 5 — No hidden same-period feedback

Same-period feedback is invalid unless solved by an explicit analytical rule.

### Law 6 — Recognition is not settlement

A recognized economic fact does not imply cash movement.

### Law 7 — Settlement is not new recognition

Settling a previously recognized fact does not duplicate its income/expense.

### Law 8 — Accounting closure

Every posted transaction is balanced and every committed state satisfies declared accounting invariants.

### Law 9 — Single economic representation

One economic position contributes to consolidated asset/liability totals exactly once.

### Law 10 — Deterministic reproducibility

Fixed inputs and realization produce identical results.

### Law 11 — State ownership

Only the authoritative owner can commit a state field.

### Law 12 — No silent invalidity

Invalid states/calculations produce explicit validation failures.

## 19. Open decisions deferred beyond this revision

These remain intentionally outside the foundational semantic contract:

- complete US and non-US tax-rule libraries;
- full financial-product taxonomy;
- all business-day calendars by jurisdiction;
- multi-currency FX market models beyond the explicit conversion boundary;
- Monte Carlo confidence-interval/reporting methodology;
- complete insurance claim-cost models;
- persistence format for primitive internal state snapshots;
- expression-language syntax and sandboxing;
- performance/parallel execution architecture;
- UI/product semantics.

Those should be implemented incrementally once the deterministic kernel and golden tests expose concrete requirements.

## 20. Implementation mapping

Implementation types should add execution concepts to the existing TypeScript contracts, including:

- `TemporalContext`
- `EvaluationContext`
- `PrimitiveSignature`
- `PrimitiveEvaluation`
- `PrimitiveState`
- `StateDelta`
- `FlowProposal`
- `RecognitionFact`
- `SettlementProposal`
- `TransactionProposal`
- `AccountingPosting`
- `DependencyEvaluationPlan`
- `RandomProcessContext`
- `EventActivation`
- `Diagnostic`

These are runtime contracts and need not become additional persisted canonical domain objects.

## 21. Readiness criterion

This semantic layer is ready to support the first deterministic vertical slice when the implementation can demonstrate, with golden tests:

- deterministic period construction;
- dependency-driven evaluation rather than rigid financial-category sequencing;
- explicit recognition versus settlement;
- single-count asset aggregation;
- balanced accounting transactions;
- consistent three-statement outputs;
- debt mechanics with explicit rate/payment policies;
- reproducible stochastic primitives;
- complete invariant validation.

At that point implementation should proceed feature-by-feature, using test failures and invariant failures to identify the next semantic refinement rather than attempting to pre-specify the entire financial universe.
