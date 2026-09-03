# Personal Finance App — Executable Financial Semantics Specification

**Version:** 0.1.8-draft
**Status:** Draft implementation contract  
**Namespace:** `pfm`  
**Depends on:** `personal_finance_canonical_schema_v1.0.json`, `personal_finance_model.schema.json`, `personal_finance_simulation_interfaces_v1.0.ts`

## 1. Purpose and authority

This specification defines executable behavior for the personal-finance simulation engine. It closes the semantic gaps between the canonical domain model and an implementation that must produce deterministic, financially coherent state transitions.

The canonical schema remains authoritative for domain vocabulary, objects, enum membership, and canonical primitive identities. This document is authoritative for runtime semantics where the canonical schema previously described behavior only informally.

A conforming engine MUST produce the same observable result when given the same model inputs, scenario and assumptions, initial state, specification version, engine version, and stochastic realization/seed.

## 2. Foundational semantic model

The system distinguishes:

1. **State** — a point-in-time condition that persists between timesteps.
2. **Flow** — an economic quantity accumulated or recognized over a period.
3. **Effect** — an attempted state change, recognition, settlement, valuation, event, or other executable consequence.
4. **Recognition fact** — an accounting/tax statement that a flow or event belongs to a period.
5. **Obligation/right** — an outstanding amount created by recognition but not yet settled.
6. **Settlement** — satisfaction of an outstanding obligation/right by transfer of cash or another instrument.
7. **Transaction** — a realized accounting event that posts one or more balanced accounting legs.
8. **Event** — a discrete occurrence that changes future behavior or state.

The fundamental economic pipeline is:

`Economic occurrence → Flow/value → Recognition (if applicable) → Obligation/right (if unsettled) → Settlement (if applicable) → Accounting posting → State update`

These stages MUST remain distinguishable even when several happen at the same instant.

A primitive evaluation does not directly mutate authoritative state. It produces values and/or effects. The transition engine validates and applies those effects.

## 3. Temporal semantics

### 3.1 Instants, dates, and periods

An **instant** is a point in time represented internally with timezone/offset context.

A **calendar date** is a civil date in the applicable jurisdiction/calendar.

A **simulation period** is a half-open interval:

`P_k = [t_k, t_{k+1})`

All internally represented temporal intervals MUST be half-open.

For date-only objects whose user-facing semantics are naturally inclusive, the engine maps the inclusive final calendar date to the beginning of the next calendar date internally.

Example:

`start_date = 2026-01-01`, `end_date = 2026-01-31`

means active dates January 1–31 inclusive and is represented internally as:

`[2026-01-01T00:00, 2026-02-01T00:00)`.

### 3.2 State boundaries

`S_begin` is the complete committed state before any activity in the period is processed.

`S_end` is the complete committed state after all applicable activity, postings, state transitions, and closing valuations are complete.

A calculation MUST identify whether it consumes `opening_state`, `intraperiod_value`, `closing_state`, or `prior_state`.

The engine MUST NOT expose partially updated authoritative state as an implicit dependency.

The authoritative state contract contains account, position, liability, and
obligation/right lifecycle state plus persistent identity registries for posted
transactions, recognitions, settlements, generated occurrences, and external
idempotency keys. Kernel and vertical-slice execution MUST use this same state
authority rather than maintain independently authoritative state shapes.
Record keys MUST equal their contained canonical entity IDs, every position MUST
reference an account in the same state, and prohibited negative cash,
liability, quantity, or carrying-value balances invalidate opening state before
execution. Claim lifecycle history is reconciled into global identity authority:
every originating recognition and historical settlement remains replay-protected.
Two claims MUST NOT assert the same originating recognition or settlement ID.
Every contained claim MUST also satisfy its semantic lifecycle invariants,
including kind/category validity, positive original amount, currency agreement,
bounded non-negative outstanding amount, and unique settlement IDs within the
claim. Structural TypeScript compatibility alone is not authoritative validity.

Committed opening state is immutable to a run. Execution occurs on private
working/candidate state. Only a validated accepted transition becomes closing
state; a hard failure exposes no candidate mutation as committed state.

### 3.2.1 Run temporal context and fact boundary

Every run MUST identify `runId`, `scenarioId`, `asOf`, `dataCutoff`,
`simulationStart`, `simulationEnd`, and base currency. `simulationStart` MUST
precede `simulationEnd`, and `dataCutoff` MUST NOT be later than `asOf`.
These invariants, supported runtime versions, and canonical base currency MUST
be revalidated wherever a structurally reconstructable `RunContext` or
`RunMetadata` is consumed; construction-time validation alone is insufficient.

For observed external facts, `observedAt` is the information-availability time
and MUST be no later than `dataCutoff`. `effectiveAt` is distinct economic-effect
timing and is governed by the applicable domain/event rules; it does not decide
whether information was available at the cutoff. `importedAt` remains ingestion
and audit metadata for this milestone. Provenance classification is
authoritative: timestamps alone MUST NOT reclassify model-generated forecast
facts as observed history.

### 3.3 Economic, recognition, and settlement timing

An economic occurrence has up to four distinct times:

- **occurrence time** — the economic fact occurs;
- **effective time** — a resulting rule/behavior becomes active;
- **recognition time** — the amount is assigned to accounting/tax statements;
- **settlement time** — cash or another instrument changes hands.

These MAY be identical, but they MUST be independently representable.

### 3.4 Intraperiod evaluation

There is no universal ordering such as "tax before contribution" or "investment before expense." The engine uses semantic barriers plus dependency topology.

Global barriers are:

1. establish period context;
2. resolve external inputs and stochastic realization;
3. activate events and determine effective modifications;
4. construct and validate the dependency graph;
5. evaluate eligible dependency nodes and primitive compositions;
6. generate flows and recognition facts;
7. generate obligation/right and settlement proposals;
8. translate accepted effects into accounting transactions;
9. post transactions and apply owned state transitions;
10. perform closing valuation and derived-output calculation;
11. validate invariants and commit the period.

Within barriers 5–8, declared dependency topology, temporal basis, and explicit priority determine order.

An implementation MUST NOT impose an economic ordering merely because two calculations are in the same barrier.

### 3.5 Stable ordering

When eligible operations are otherwise independent, stable ordering is:

1. explicit dependency priority, descending;
2. semantic barrier;
3. stable node identifier ascending;
4. primitive instance identifier ascending;
5. generated occurrence sequence ascending.

Stable ordering is deterministic bookkeeping only and MUST NOT substitute for an omitted economic dependency.

### 3.6 Partial-period temporal modes

Every primitive depending on elapsed time or accrued amount MUST declare a temporal measurement mode:

- `instantaneous`;
- `occurrence_based`;
- `period_based`;
- `elapsed_time`;
- `calendar_fraction`;
- `boundary_state`;
- `explicit_timestamp_schedule`.

When elapsed-time proration is required, the primitive MUST declare its complete day-count convention. Supported conventions are Actual/Actual ISDA, Actual/365 Fixed, Actual/360, and 30E/360. Labels such as `actual/actual` and `30/360` are incomplete and MUST NOT be used without their named variant.

Calendar-month fraction is not a generic day-count convention. A primitive that uses it MUST declare its schedule, calendar, timezone, and stub-period behavior explicitly.

The engine MUST NOT silently infer a basis.

### 3.7 Frequency conversion

An amount per occurrence is not an annualized rate and MUST NOT be rescaled merely because the simulation timestep differs.

Rates MUST declare their basis: periodic, nominal annual, effective annual, continuous, or another explicit basis. A periodic rate MUST identify its contractual period. A nominal annual rate MUST carry its positive integer contractual compounding frequency `m`.

For effective annual rate `r` over year fraction `f`:

`r_f=(1+r)^f-1`

For nominal annual rate `r_nom` with `m` contractual compounding periods:

`r_p=r_nom/m`

No rate conversion may be inferred from a field name alone.

## 4. Economic flow, recognition, obligation, settlement, and transaction semantics

### 4.1 Economic flow

A flow is an economic magnitude attributable to a period. A flow does not inherently imply cash movement.

### 4.2 Recognition fact

A recognition fact assigns a flow to an accounting and/or tax period. Recognition may create or modify an asset, liability, income, expense, gain/loss, equity, or memo fact.

Recognition is not inferred solely from transaction type.

### 4.3 Obligation/right

If a recognized amount has not been settled, the system MUST represent the resulting receivable, payable, accrued balance, deferred item, or other obligation/right explicitly.

An obligation/right has:

- unique identity;
- originating recognition fact;
- original amount;
- remaining outstanding amount;
- creation/recognition time;
- optional due date;
- optional settlement constraints;
- settlement history.

### 4.4 Settlement

Settlement satisfies an outstanding obligation/right and changes cash or another financial instrument.

A settlement proposal MUST reference the obligation/right it settles.

A settlement MUST reduce the outstanding balance of the referenced obligation/right by the amount settled, subject to explicit fees, penalties, or write-offs.

A settlement MUST NOT re-recognize the underlying income/expense/gain/loss merely because cash moved.

### 4.4.1 Settlement proposals, funding, and constraint outcomes

A `SettlementProposal` is a valid proposed economic settlement referencing one
identified obligation/right. It is not authoritative accounting history. Its
requested amount MUST be positive, use the claim currency, not exceed the
outstanding claim amount, and not precede recognition unless a separate
prepayment semantic explicitly permits that behavior.

Every funding attempt MUST use an explicit `FundingPolicy`. A policy identifies
ordered permitted sources, whether partial funding is allowed, and the explicit
behavior when permitted liquidity is insufficient. No source may be inferred
from account type, household contents, or an undeclared fallback. The initial
supported source is an explicitly identified household cash account.

Funding resolution is pure. It evaluates a proposal, claim, policy, and
available balances without mutating claim or account state and without creating
accounting history, transfers, borrowing, overdraft, or asset sales.
`availableBalances` MUST represent permitted liquidity as of the funding
evaluation time. The evaluation MUST NOT precede the proposal, and a future
cash movement MUST NOT fund an earlier proposal.

`ConstraintOutcome` has exactly these statuses:

- `fully_satisfied` — accepted amount equals the proposal's requested amount;
- `partially_satisfied` — explicit partial-funding policy accepts more than zero
  but less than the requested amount;
- `deferred` — the valid settlement is intentionally postponed and no
  settlement occurs now;
- `unfunded` — the valid settlement is attempted now, but permitted sources
  provide insufficient liquidity and zero is accepted;
- `rejected` — an explicit non-liquidity policy/rule refuses an otherwise valid
  proposal;
- `contract_default` — an explicit product/contract rule defines the
  non-settlement as default.

Generic low cash MUST NOT infer `contract_default` or `rejected`. When partial
funding is forbidden and available liquidity is insufficient, the accepted
amount is zero; the engine MUST NOT partially consume a source and label the
proposal `unfunded`.

Funding outcome and claim lifecycle status are distinct. A fully funded `$500`
proposal against a `$2,000` claim has funding status `fully_satisfied` while the
updated claim status is `partially_settled`. A `$2,000` proposal accepting only
`$500` under an explicit partial-funding policy has funding status
`partially_satisfied` and also leaves the claim `partially_settled`.

Insufficient permitted liquidity produces an immutable `LiquidityShortfall`
identifying proposal, claim, funding policy, requested amount, fundable amount,
shortfall amount, and evaluation time. Requested amount MUST equal funded plus
shortfall amount, and shortfall MUST be positive. A normal liquidity shortfall
is modeled financial stress and a nonblocking warning, not a hard validation or
accounting failure.

Only a positive amount accepted by funding/constraints creates a `Settlement`.
The accepted funding result is authoritative for the settlement amount and
funding allocations; settlement identity, time, and trace metadata supplied by
a caller cannot override those economic values. Unfunded, deferred,
contract-default, rejected, and zero-amount outcomes cannot authorize a
settlement. A settlement cannot precede its proposal or funding evaluation.
Only accepted settlements flow into accounting. If an already-accepted posted
transaction creates prohibited negative cash, the accounting/state boundary
MUST fail a hard invariant. Accounting MUST NOT interpret that failure as a
request to invent funding.

### 4.5 Accrual and capitalization

Accrued interest, tax, wages, or expenses MAY remain outstanding after recognition.

Capitalization into principal or another balance is a separate explicit state transition. Accrual MUST NOT implicitly capitalize into principal.

Example:

`Interest expense recognition → Interest payable +$100`

and later:

`Interest payable settlement → Cash -$100, Interest payable -$100`

Capitalized-interest behavior instead explicitly performs:

`Interest expense recognition → Loan principal +$100`

when the contract permits capitalization.

### 4.6 Effects versus transactions

Primitives may emit values, state-delta proposals, flows, recognition facts, obligation/right proposals, settlement proposals, event activations, dependency invalidations, constraints, and diagnostics.

Only the accounting/transaction subsystem may create authoritative posted accounting legs.

## 5. Account, position, and asset hierarchy

### 5.1 Account as container

An `Account` is a financial container and bookkeeping boundary. It is not automatically an additional economic asset beyond its contents.

An account MUST conceptually distinguish at minimum:

- `cash_balance` — cash held by the account;
- `positions` — investment/other economic positions held in the account;
- `total_value` — derived aggregate value, if needed.

`total_value` is:

`cash_balance + Σ(position.market_value) + other explicitly owned in-account economic values`

and MUST NOT itself be aggregated again as an asset when its contents are aggregated separately.

### 5.2 Investment position

An `Investment` is an economic position held inside an `Account`. Its market value is independently measurable:

`market_value = quantity × price`

unless an explicit valuation rule defines otherwise.

A position may reference an `Asset` for instrument/entity metadata, but the same economic value MUST NOT simultaneously be counted as both a standalone asset and an in-account position.

### 5.3 Consolidated asset aggregation

The canonical household asset aggregation MUST use exactly one representation of each economic resource.

Conceptually:

`TotalAssets = standalone_asset_values + Σ(account.cash_balance) + Σ(position.market_value) + other explicitly non-overlapping asset classes`

`Account.total_value` is a reporting convenience and is excluded from the consolidation formula when its contents are separately included.

The engine MUST detect duplicate economic-resource identities or overlapping aggregation paths as validation errors.

### 5.4 Account transfers

A pure transfer between owned accounts moves cash or positions without changing consolidated household assets or net worth.

### 5.5 Initial effective-dated rule subsystem

Each executable financial rule version MUST use the existing canonical `TaxRule` identity family and MUST declare its rule kind, explicit economic target, `effectiveFrom`, and optional `effectiveUntil`. Runtime effectiveness is the half-open interval `[effectiveFrom, effectiveUntil)`; an omitted end is open-ended. Empty or inverted finite intervals are invalid.

A required policy binding MUST list explicit candidate rule-version identities. Candidate identities are unique, every identity resolves, and every candidate matches the required kind and target. At the evaluation instant exactly one candidate MUST be active. Zero active candidates and multiple active candidates are validation errors. Catalog or binding array order conveys no precedence; implementations MUST NOT select a first, last, or implicitly most-recent entry.

Rule evaluators MUST consume a resolver-produced resolved rule tied to that exact evaluation instant; arbitrary raw rule definitions are not valid evaluator inputs. Calculation lineage attached to a generated claim MUST persist through later settlement of that claim.

Every application records the exact rule identity, kind, target, evaluation instant, decision/calculated value, and calculation trace references. Trace references MUST carry applied rule identities as machine-readable data, and influenced effects and transactions MUST propagate them. Rules are pure policy/calculation code: they neither mutate authoritative financial state nor directly post accounting transactions.

The initial supported methods are deliberately narrow:

- proportional income tax is `round(taxableBase × effectiveRate)` using nonnegative `Money`, a `Ratio` from zero through one, and explicit posting rounding;
- an annual contribution-limit rule targets one account and one UTC civil year whose effective range is exactly `[Jan 1 00:00Z, next Jan 1 00:00Z)`. For nonnegative requested and prior-used amounts, `remaining=max(limit-used,0)`, `accepted=min(requested,remaining)`, and `excess=requested-accepted`;
- a product eligibility rule explicitly allows or rejects a named operation for one account or liability. A valid deny rule is a modeled decision, not malformed input;
- a fixed-fee rule targets one account and assesses a nonnegative `Money` amount. A zero fee is valid and produces a recorded application but no posting.

Contribution-limit and product-eligibility rejections are policy outcomes separate from funding outcomes. They MUST NOT be classified as liquidity failures, defaults, or accounting invariant failures. Comprehensive tax law, shared cross-account contribution limits, and percentage/tiered fees are outside this version.

## 6. Typed primitive composition

Each primitive has a conceptual signature:

`Primitive<InputType, OutputType, StateType, EffectType>`

and an operating domain such as value, rate, index, schedule, flow, state, activation predicate, or transaction proposal.

Composition `A -> B` is valid only if output type, units, temporal domain, currency, state ownership, dependency direction, and effect contract are compatible.

Conversions between economically different concepts require explicit typed adapters.

Examples:

- annual effective rate → monthly effective rate;
- schedule → period occurrence set;
- quantity + price → market value;
- recognized obligation → settlement proposal.

The engine MUST reject incompatible compositions during model validation.

## 7. Primitive semantics P01–P34

### P01 — static

A configured non-temporal input/fact:

`X=c`

Events may create a new effective value from a declared boundary without rewriting historical values.

### P02 — one_time

A one-time occurrence emits once for an occurrence instant `τ` falling in the current period and only if the primitive has not previously committed execution.

Execution status is committed only with the successful atomic timestep commit. Rollback leaves it unexecuted.

### P03 — recurring

For recurrence set `C`:

`X(P_k)=Σ_{τ∈C∩P_k}A_τ`

Each occurrence has a stable identity before period aggregation.

### P04 — finite_duration

All internal duration intervals are half-open:

`X_t=f(t)` for `start <= t < end`.

For date-only end dates, the effective end instant is the beginning of the following calendar date.

### P05 — perpetual

`X_t=f(t)` for `t >= start` until explicit termination, entity inactivity, or simulation boundary.

### P06 — constant

A functional generator:

`X_t=c`

`static` is a configured non-temporal fact; `constant` is a function over an explicit temporal domain. They are distinct by type and purpose even when numerically identical.

### P07 — linear

`X(t)=X0+slope*n(t)` where `n(t)` is explicitly declared.

### P08 — geometric_growth

For per-period growth:

`X_{k+1}=X_k(1+g_k)`

For effective annual growth over fraction `f`:

`X(t+f)=X(t)(1+g)^f`

The primitive MUST identify whether it grows a stock, a recurring occurrence amount, or another series quantity.

### P09 — geometric_decline

`X_{k+1}=X_k(1-d_k)` for standard decay. Nonlinear decay requires an explicit function.

### P10 — stepwise

The active level is the most recent breakpoint at or before the evaluation instant. Same-instant breakpoints require priority or are invalid.

### P11 — piecewise

Exactly one segment SHOULD apply. Overlap requires explicit priority. No-match requires an explicit default or validation failure.

### P12 — periodic

`X_k=V[(k-φ) mod p]`

`p` and `φ` use declared temporal units.

### P13 — inflation_linked

Default inflation linkage uses an explicit price index:

`X_t=X_base*(I_t/I_base)`

The base date/index MUST be explicit.

When the index is generated from period inflation rates:

`I_{k+1}=I_k(1+π_k)`

A time-varying base must declare whether observations are nominal or expressed in base-period purchasing power. Ambiguous bases are invalid.

### P14 — index_linked

`X_t=X_base*(I_t/I_base)` with `I_base != 0`.

The primitive does not independently compound beyond the supplied index.

### P15 — balance_dependent

`X_k=f(B_k)` where `B_k` is explicitly bound. Default same-period basis is `opening_state`.

Intraperiod/closing-state dependencies require explicit ordering or lag.

### P16 — income_dependent

`X_k=f(I_k)` using an explicitly bound income node. After-tax/disposable quantities MUST be represented by explicit downstream nodes rather than inferred from generic income.

### P17 — age_dependent

`X_k=f(age(t))` using an explicitly configured age convention.

### P18 — account_dependent

`X_k=f(A_k)` using an explicitly bound account state. Default same-period basis is `opening_state` unless intraperiod dependency is explicitly declared.

### P19 — market_dependent

Consumes a declared market observation/process. Observation timing, valuation convention, unit, currency, and missing-data policy MUST be explicit.

### P20 — tax_dependent

`T_k=TaxRule(B_k)` after all prerequisite taxable inputs are resolved. P20 consumes the resolved proportional-income-tax rule, delegates to the authoritative proportional-tax implementation, and returns both the calculated tax and exact applied rule identity. Its trace references MUST carry that identity.

### P21 — dependency_driven

`X_k=f(X_{1,k},...,X_{n,k})` from explicit graph bindings only. Unresolved nodes or invalid cycles are errors.

### P22 — amortization

Amortization is decomposed into five distinct contracts:

1. **rate determination**;
2. **interest accrual**;
3. **payment determination**;
4. **payment allocation**;
5. **balance transition**.

For fixed-rate fully amortizing debt with beginning balance `B_k`, periodic rate `r_k`, and remaining payment count `n_k`:

`Payment_k = B_k*r_k*(1+r_k)^n_k / ((1+r_k)^n_k-1)` for `r_k != 0`.

`Payment_k = B_k/n_k` when `r_k=0`.

Interest:

`Interest_k = Accrual(B_k,r_k,Δt)`

For a simple periodic convention this may be `B_k*r_k`.

Scheduled principal:

`ScheduledPrincipal_k=max(0,Payment_k-Interest_k)`

Actual principal reduction is:

`PrincipalReduction_k=min(B_k, ScheduledPrincipal_k + ExtraPrincipal_k)`

subject to explicit payment/contract constraints.

Ending principal balance:

`B_{k+1}=B_k-PrincipalReduction_k+CapitalizedInterest_k+NewDraws_k`

where `CapitalizedInterest_k` is normally zero and MUST be explicitly enabled when nonzero.

A rate reset MUST be modeled by the rate determination contract. A payment reset is a separate contract and MUST NOT be inferred from a rate reset.

Variable-rate products MUST declare:

- reset schedule;
- rate index/formula;
- spread;
- caps/floors where applicable;
- payment-reset policy;
- remaining-term policy;
- negative-amortization/capitalization policy;
- final-payment policy.

### P23 — compounding

Compounding applies returns/interest to a stock of value. Contributions and withdrawals are separate flows.

For a period with explicitly defined effective return `r_k`:

`V_end = V_base*(1+r_k) + Contribution_effect + Withdrawal_effect`

The instance MUST declare cash-flow timing:

- beginning-of-period;
- end-of-period;
- explicit timestamp;
- continuous/weighted timing.

Beginning-of-period contribution example:

`V_end=(V_begin+C)*(1+r)`

End-of-period contribution example:

`V_end=V_begin*(1+r)+C`

### P24 — accrual

Accrual calculates an economic amount attributable to a period but does not inherently settle it.

A rate-based accrual has the generic form:

`flow=AccrualFactor(base,rate,Δt)`

The resulting recognition and outstanding obligation/right MUST be explicit.

### P25 — depreciation

Depreciation reduces carrying value according to an explicit method. Economic, tax, and statement depreciation MUST remain separately representable when needed.

### P26 — mark_to_market

`Value_t = Quantity_t × Price_t` or an explicit valuation function.

Unrealized valuation changes affect economic/accounting state according to the selected accounting policy but do not themselves create cash settlement.

### P27 — event_trigger

Activation occurs when an event/predicate becomes effective according to its event policy. Edge-triggered activation is the default.

### P28 — conditional

`X_k=Y_k` if condition true; otherwise `Z_k`. Conditions MUST be dependency-visible and free of untracked mutable state.

### P29 — event_modification

A modification has an effective time, target, precedence, duration/reversibility, and provenance.

`Y_t=X_t` before effective time and `Y_t=M(X_t,eventState_t)` after it.

### P30 — event_termination

`Y_t=X_t` before termination and `Y_t=0` at/after termination. Termination is idempotent.

### P31 — probabilistic

`X_k~D(θ_k)` using a named random-process identity and isolated deterministic stream. Invalid domain samples require explicit truncation/transformation or are errors.

### P32 — scenario_dependent

`X_k=f_s(k)` with explicit scenario inheritance/override semantics.

### P33 — correlated_random_process

Default joint construction uses a **Gaussian copula**:

1. validate correlation matrix `Σ` as symmetric positive semidefinite;
2. generate a correlated standard-normal vector `Z` with correlation `Σ`;
3. transform `U_i=Φ(Z_i)`;
4. transform each `U_i` through the inverse marginal CDF `F_i^{-1}`.

The model MUST distinguish the desired copula/rank dependence from linear correlation of transformed non-normal marginals.

Correlation groups share one explicit process realization per timestep. Independent groups use independent deterministic random streams.

### P34 — path_dependent

`X_k=f(H_k)` where history `H_k` contains only declared prior/current information available at evaluation time. Future values are forbidden.

The primitive SHOULD retain sufficient state rather than full raw history where equivalent.

## 8. Event timing and lifecycle

Events have separate occurrence and effect semantics:

`scheduled/eligible → occurred → effect-effective → recognition (if any) → settlement (if any) → completed`

An event may have an occurrence time different from the effective time of its effects.

Example:

`promotion occurs June 15 → salary policy effective June 15 → first payroll settlement June 30`

Event-generated modifications are applied at their effective time, not automatically at the occurrence timestamp.

Events MUST be non-retroactive unless a model explicitly declares a historical restatement feature; such a feature is outside default simulation semantics.

## 9. Dependency semantics

The dependency graph is the primary mechanism determining evaluation order inside a period.

A dependency edge identifies both direction and temporal basis.

Conceptually:

`source@scope → target@scope`

where scope can be current-period, opening-state, intraperiod phase, prior-period, or lagged.

Lagged/state-mediated cycles are valid only when the cycle crosses an explicit prior-state boundary. Zero-lag algebraic cycles are invalid unless the model explicitly supplies a solved mathematical operator with a unique valid solution.

Conflicting writes require explicit operation type and priority. Additive effects may merge when target semantics permit; competing replacements require priority; equal-priority incompatible writes are errors.

## 10. State transition and ownership

Each authoritative state variable has exactly one owner. Multiple primitives may propose effects, but only the owner transition commits the resulting value.

For any state variable `x`:

`x_{k+1}=Transition_x(x_k,accepted_effects_k)`

A state transition is atomic with the timestep.

Derived fields are recomputed, never directly authored as authoritative inputs.

## 11. Statement and accounting semantics

### 11.1 Ledger authority

Posted accounting facts are authoritative for accounting-derived statements. State snapshots are authoritative for point-in-time economic balances. Statement generation reconciles the two rather than treating them as independent sources of truth.

### 11.2 Account effects

Every posted accounting leg changes an explicit economic/accounting quantity. For financial statement purposes, the engine MUST classify each leg into the affected balance and/or statement fact rather than infer statement impact from transaction type alone.

### 11.3 Debit/credit semantics

For standard double-entry treatment:

- debit increases assets/expenses and decreases liabilities/equity/income;
- credit increases liabilities/equity/income and decreases assets/expenses.

Exceptions require an explicit specialized accounting rule.

For every transaction and currency:

`Σ debit amounts = Σ credit amounts`

### 11.4 Compensation with non-cash allocation

Recognized compensation MAY settle through multiple channels.

Example:

`Gross compensation = $10,000`

`Cash settlement = $8,000`

`Retirement-account contribution = $2,000`

The accounting representation may be:

`Dr Cash $8,000`

`Dr Retirement Asset $2,000`

`Cr Compensation Income $10,000`

Consolidated operating cash flow includes the $8,000 cash settlement, not the $10,000 recognized income.

### 11.5 Tax recognition versus payment

Tax recognized but unpaid:

`Dr Tax Expense`

`Cr Tax Payable`

Tax settlement later:

`Dr Tax Payable`

`Cr Cash`

The settlement does not create a second tax expense.

### 11.6 Investment purchase

A security purchase transfers cash into an investment position:

`Dr Investment Asset`

`Cr Cash`

It does not itself create income or gain/loss.

### 11.7 Investment sale and realization

A sale MUST separately model:

- quantity sold;
- gross proceeds;
- carrying value removed;
- realized gain/loss;
- transaction costs/fees where applicable;
- cash settlement;
- tax facts where applicable.

For a position with carrying value $100,000 sold for $110,000:

`Dr Cash $110,000`

`Cr Investment Asset $100,000`

`Cr Realized Gain $10,000`

The Cash Flow Statement records $110,000 investing inflow. The income/statement layer records $10,000 gain. The investment asset decreases by $100,000.

### 11.8 Unrealized investment return

If a $100,000 position is revalued to $110,000 without sale:

- asset value increases $10,000;
- unrealized gain/equity effect increases $10,000 according to the selected accounting policy;
- cash flow = $0;
- no realized-gain settlement occurs.

### 11.9 Mortgage payment

For a payment of $1,798.65 consisting of $1,500 interest and $298.65 principal:

`Dr Interest Expense $1,500.00`

`Dr Mortgage Liability $298.65`

`Cr Cash $1,798.65`

Liability reduction is $298.65; expense is $1,500; cash decreases $1,798.65.

### 11.10 Statements and timing

**Balance Sheet:** point-in-time statement at `S_end`. It contains ending economic balances and liabilities.

`NetWorth = TotalAssets - TotalLiabilities`

**Income Statement:** period statement containing amounts recognized during `P_k`, including income, expense, gain/loss, and tax according to the configured accounting convention.

**Cash Flow Statement:** period statement containing actual cash settlements during `P_k`, classified as operating, investing, or financing. Non-cash effects do not themselves create cash flow.

Cash roll-forward:

`EndingCash = BeginningCash + OperatingCF + InvestingCF + FinancingCF + ExplicitFXOrOtherCashEffects`

Internal household transfers between consolidated accounts are excluded from consolidated net cash flow.

### 11.11 Statement reconciliation law

The following relationships MUST hold after each committed period:

`EndingCash - BeginningCash = NetCashFlow`

`EndingNetWorth - BeginningNetWorth = RecognizedNetIncome + OwnerEquityChanges + NonCashValuationAdjustments - ExplicitExcludedItems`

The exact reconciliation mapping for non-cash gains, owner contributions/distributions, and other equity items MUST be explicit in the statement policy. The engine MUST NOT invent a balancing plug.

## 12. Derived metric timing

Each derived metric MUST declare its temporal class:

- `point_in_time` — evaluated from a state boundary;
- `period_flow` — aggregated over a period;
- `rolling_period` — aggregated over a declared lookback interval;
- `rate` — derived from period quantities;
- `distribution` — derived across stochastic realizations.

Examples:

`net_worth` = point_in_time at `S_end`.

`gross_income` = period_flow over recognized income in `P_k`.

`disposable_income` = period_flow:

`recognized_income - recognized_taxes - recognized_expenses`

`savings_rate` = rate using a declared numerator/denominator convention, typically:

`Savings / GrossIncome`

A metric MUST specify whether transfers are excluded and whether employer/non-cash compensation is included.

## 13. Stochastic semantics

A stochastic realization is conceptually:

`ω = RandomStream(seed, scenarioId, realizationId)`

Random streams are isolated by named process identity. Draws MUST be stable under insertion/removal of unrelated processes.

For P33 Gaussian-copula processes, both the copula specification and marginal distributions are part of the immutable run configuration.

## 14. Precision and money

Authoritative monetary values MUST use decimal/fixed-precision representation. Binary floating point MUST NOT be authoritative for persisted posted monetary amounts.

Intermediate calculations MAY use higher precision. Rounding occurs only at explicit boundaries, with declared scale, rounding mode, and application point.

Default domain monetary scale remains four decimal places; jurisdiction/product rules may override.

## 15. Failure and validation semantics

Hard errors include:

- unresolved dependency;
- zero-lag cycle without declared solved operator;
- invalid primitive composition;
- invalid unit/currency conversion;
- duplicate economic-resource aggregation;
- invalid obligation settlement reference;
- settlement exceeding outstanding obligation without explicit overpayment policy;
- unbalanced transaction;
- negative prohibited liability balance;
- invalid stochastic distribution/correlation structure;
- invalid temporal interval;
- unauthorized derived-field write;
- duplicate one-time execution.

Warnings include suspicious assumptions, unusual but valid values, explicit partial-period prorations, and allowed zero-liquidity conditions.

The engine MUST never silently clamp a materially invalid financial result.

## 16. Simulation transaction/period atomicity

Each simulation period is atomic at the authoritative state boundary.

If any hard validation failure occurs before commit, none of the period's state transitions, posted transactions, obligation changes, or primitive execution-state changes become committed.

A transaction itself is atomic: all accounting legs post together or none post.

Transaction posting MUST validate the transaction, apply every leg to isolated
candidate state, validate the resulting state invariants, and only then commit
the candidate. Invariant acceptance MUST depend on the final economic effect,
not transient leg order. A rejected transaction MUST NOT record its transaction
identity or any balance/quantity change.

### 16.1 Run metadata, determinism, and completion

Every authoritative successful run result MUST record engine version, result
schema version, financial-specification version, model-format version, run and
scenario identities, `asOf`, `dataCutoff`, the requested horizon, base currency,
and a deterministic input fingerprint.

The fingerprint is a deterministic reproduction/change identifier, not a
security primitive. It MUST use canonical exact financial serialization, sorted
object keys, semantically meaningful array order, and MUST exclude `runId`,
wall-clock time, and derived results.

Run completion is exactly one of `completed`, `incomplete`, or `invalid_model`.
`completed` reaches the requested horizon. `incomplete` preserves explicit stop
information, requires an error-severity hard-stop condition before the requested
horizon, and MAY expose prior committed period results but MUST NOT claim the
horizon was reached. Warning-level liquidity shortfall and other valid modeled
stress do not automatically imply either failure status. `invalid_model` is
reserved for structural/semantic input invalidity before meaningful execution
and may retain warnings or information alongside at least one error.

### 16.2 Provenance versus calculation lineage

Authoritative/input facts MUST retain typed source provenance sufficient to
distinguish observed external facts, authoritative user input, and
model-generated forecast facts. External facts retain source identity and an
idempotency key when available. Provenance identifies where a fact came from;
calculation lineage separately identifies how a derived result was calculated.

### 16.3 Portable model versions and compatibility

The existing personal model JSON Schema remains the portable-model basis. Its
root envelope distinguishes `model_format_version`,
`financial_specification_version`, `model_id`, and `objects`. Compatibility is
classified as `supported_directly`, `migratable`, `read_only_legacy`, or
`unsupported`. Migrations MUST be explicit deterministic source-to-target
steps, and migration chains MUST NOT infer or skip unsupported gaps.

Model-format compatibility and financial-semantics compatibility are
independent. A current serialization shape does not authorize interpretation
under current financial semantics unless the identified
`financial_specification_version` is also explicitly supported. A model-format
migration MUST NOT claim to migrate financial meaning unless a separately
reviewed semantic migration contract explicitly does so.

The former `0.1.0-draft` root used `specification_version` without
unambiguously identifying whether that value represented financial semantics or
the model serialization format. It is therefore read-only legacy in this
contract; no migration may guess the missing meaning.

## 17. Golden scenarios

These scenarios are normative tests of the semantic contracts.

### Golden 1 — Salary, tax, pre-tax retirement contribution, and expenses

**Initial state**

- Checking: `$0`
- Retirement account: `$0`

**Monthly activity**

- Gross salary: `$10,000`
- Pre-tax retirement contribution: `$2,000`
- Tax expense: `$2,000`
- Living expenses: `$4,000`
- All cash settlements occur during the month.

**Expected accounting/economic results**

Compensation:

`Dr Checking $8,000`

`Dr Retirement Asset $2,000`

`Cr Compensation Income $10,000`

Tax:

`Dr Tax Expense $2,000`

`Cr Cash $2,000`

Expenses:

`Dr Expense $4,000`

`Cr Cash $4,000`

Ending state:

- Checking = `$2,000`
- Retirement = `$2,000`
- Total assets = `$4,000`
- Liabilities = `$0`
- Net worth = `$4,000`

Income statement:

- Income = `$10,000`
- Tax = `$2,000`
- Expenses = `$4,000`
- Net income = `$4,000`

Cash flow:

- Net operating cash flow = **`$2,000`**
- Ending cash = `$2,000`

The $2,000 retirement contribution is a direct non-cash allocation of recognized compensation in this scenario. Therefore it does not enter checking and is not itself a cash outflow in the consolidated Cash Flow Statement.

The test MUST assert that recognized compensation may exceed cash settlement and that statements remain reconciled.

### Golden 2 — Brokerage account, purchase, valuation, and anti-double-counting

Initial state:

- Checking cash = `$100,000`
- Brokerage cash = `$0`
- Stock position = `0`

Transfer `$100,000` to brokerage, then buy `1,000` shares at `$100`.

After purchase:

- Checking cash = `$0`
- Brokerage cash = `$0`
- Position market value = `$100,000`
- Household total assets = `$100,000`
- Household net worth = `$100,000`

The brokerage account's aggregate total value is `$100,000`, but that aggregate MUST NOT be added again when the underlying position is already included.

Then price rises to `$110` without sale:

- Position value = `$110,000`
- Unrealized gain = `$10,000`
- Cash flow = `$0`
- Household net worth = `$110,000`

The test MUST fail validation if the implementation counts brokerage `total_value` plus the same position separately.

### Golden 3 — Accrued tax followed by later settlement

Initial state:

- Checking = `$10,000`
- Tax payable = `$0`

January recognition:

`Dr Tax Expense $1,000`

`Cr Tax Payable $1,000`

After January:

- Checking = `$10,000`
- Tax payable = `$1,000`
- Net worth = `$9,000`

April settlement:

`Dr Tax Payable $1,000`

`Cr Checking $1,000`

After April:

- Checking = `$9,000`
- Tax payable = `$0`
- Net worth = `$9,000`

April must contain `$0` additional tax expense from this settlement.

### Golden 4 — Mortgage amortization and variable-rate reset

Fixed-rate case:

- Principal = `$300,000`
- Annual rate = `6%`
- Term = `30 years`
- Monthly compounding/payment

Expected first-month values:

- Monthly rate = `0.06/12 = 0.005`
- Payment ≈ `$1,798.65`
- Interest = `$1,500.00`
- Principal = `$298.65`
- Ending balance ≈ `$299,701.35`

Expected payment transaction:

`Dr Interest Expense $1,500.00`

`Dr Mortgage Liability $298.65`

`Cr Cash $1,798.65`

Variable-rate subtest:

After 12 months, set rate from `6%` to `7%` through the rate-reset contract.

The test MUST verify that the rate reset does not itself determine a new payment unless the payment-reset policy explicitly says so.

If payment is recast over the remaining 348 months, the new payment is approximately `$1,991.63` and first post-reset interest is approximately `$1,728.51` using the resulting balance and monthly rate. If payment remains fixed, principal reduction is instead approximately `$70.14`. The model MUST produce exactly the result dictated by its declared payment-reset policy.

### Golden 5 — Investment sale and realized gain

Initial position:

- Carrying value = `$100,000`
- Market value = `$110,000`

Prior to sale:

- unrealized gain = `$10,000`
- cash flow = `$0`

Sell for `$110,000`.

Expected accounting:

`Dr Cash $110,000`

`Cr Investment Asset $100,000`

`Cr Realized Gain $10,000`

Expected results:

- Investment asset decreases `$100,000`
- Cash increases `$110,000`
- Realized gain = `$10,000`
- Investing cash flow = `+$110,000`
- Net worth change from the sale transaction itself = `$0` relative to the immediately pre-sale state, because the position was already marked to its `$110,000` fair value.

The test MUST distinguish proceeds from gain and MUST NOT report `$10,000` as the investing cash flow of the sale.

## 18. Additional semantic regression tests

The engine SHOULD also retain tests for:

- half-open boundary behavior;
- annual growth applied to monthly salary without accidental monthly compounding;
- explicit contribution timing in compounding;
- event occurrence/effect/payroll settlement timing;
- zero-lag dependency cycle rejection;
- correlated-process reproducibility under Gaussian copula;
- duplicate asset aggregation rejection;
- settlement overpayment rejection;
- one-time rollback behavior;
- non-cash compensation reconciliation.

## 19. Implementation boundary

Implementation may choose different internal structures, algorithms, caching, persistence, parallelization, or APIs provided observable semantic behavior remains equivalent.

The semantic kernel should expose implementation contracts such as:

- `TemporalContext`;
- `EvaluationContext`;
- `PrimitiveEvaluation`;
- `StateDelta`;
- `FlowProposal`;
- `RecognitionFact`;
- `Obligation`;
- `SettlementProposal`;
- `TransactionProposal`;
- `RandomProcessContext`;
- `DependencyEvaluationPlan`;
- `StatementPolicy`;
- `EvaluationDiagnostic`.

These are implementation concepts and need not become canonical persisted domain objects.

## 20. Remaining v0.2 decisions

The foundational semantic contract is now sufficiently constrained for deterministic-kernel implementation. The following may remain follow-up work:

- exact jurisdiction-specific calendars and business-day rules;
- full tax-rule catalog and filing/settlement mechanics;
- multi-currency/FX implementation details;
- comprehensive insurance mechanics;
- Monte Carlo tail-statistic conventions;
- expression-language grammar and sandboxing;
- performance/parallelization details;
- full chart of accounts taxonomy beyond the semantic classes defined here.
