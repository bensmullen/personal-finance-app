# Personal Finance App — Vertical Slice 1 Formal Specification

**Version:** 1.0.3-draft
**Status:** Reviewable implementation contract  
**Namespace:** `pfm`  
**Slice:** Employment Compensation → Tax Obligation → Retirement Transfer → Spending  
**Baseline:** Semantic Kernel v0.1 on `main`

## 1. Purpose

This document defines the smallest complete vertical slice that exercises the semantic pipeline from domain inputs through primitive evaluation, flows, recognition, obligations/rights, settlement, accounting transactions, authoritative state transition, closing valuation, financial statements, and time-series outputs.

It is an extension contract over the existing canonical domain/schema and executable-semantic specifications. It does not replace them. Where this document is silent, the canonical specifications remain authoritative.

The canonical semantic pipeline is:

`Economic occurrence → Flow/value → Recognition → Obligation/right (if unsettled) → Settlement (if applicable) → Accounting posting → State update`

The executable v0.1 specification already requires these stages to remain distinguishable even when several occur at the same instant, and states that primitive evaluation produces effects rather than directly mutating authoritative state. The transaction subsystem is the only authority for posted accounting legs. 

## 2. Scope

### 2.1 Implemented

This slice implements one deterministic monthly household scenario containing:

1. recurring gross employment compensation;
2. a simple tax calculation driven by an explicit tax policy;
3. tax recognition and creation of a first-class tax obligation;
4. settlement of that obligation, including the ability to defer settlement to a later period;
5. a retirement contribution represented as a transfer between two household-owned accounts;
6. recurring ordinary living-expense recognition and settlement;
7. typed accounting transaction generation;
8. atomic state transition on cloned state;
9. balance-sheet, income-statement, and cash-flow derivation;
10. period and event time-series outputs;
11. validation of obligation, accounting, temporal, dependency, determinism, and internal-transfer invariants.

### 2.2 Explicitly not implemented

The slice does **not** implement:

- full federal, state, or local tax law;
- payroll withholding mechanics, employer-side taxes, tax refunds, or filing reconciliation;
- tax lots or brokerage taxation;
- investment returns;
- debt or mortgage mechanics;
- stochastic employment or expense behavior;
- external account aggregation;
- UI or persistence infrastructure beyond existing model concepts;
- foreign exchange;
- tax deductions/credits beyond what is necessary to define a simple tax rule;
- generic obligation classes beyond the minimum obligation/right contract;
- generalized multi-currency settlement;
- cancellation/write-off/forgiveness workflows except where needed to reject invalid input.

### 2.3 Existing mechanisms reused

The slice reuses:

- canonical object vocabulary and UUID identity;
- half-open temporal intervals;
- primitive registry P01–P34;
- dependency-node/edge model;
- deterministic topological ordering;
- zero-lag cycle detection;
- cloned opening state and failure isolation;
- typed accounting legs;
- balanced transaction validation;
- transaction-driven state transitions;
- statement derivation;
- bigint-cent ledger representation at the v0.1 execution boundary;
- the existing golden-runner concept.

### 2.4 New semantic capabilities

The slice adds first-class runtime representations for:

- domain facts and policy inputs distinct from posted transactions;
- typed recognition facts;
- first-class obligation/right identities and outstanding balances;
- typed settlement proposals referencing obligations/rights;
- semantic effects that can be translated into transactions;
- obligation lifecycle validation;
- explicit consolidated-vs-account-level cash-flow classification;
- domain-input golden scenarios that do not directly assign closing balances.

## 3. Authoritative semantic layers

The engine MUST maintain the following distinction:

| Layer | Meaning | Authoritative? |
|---|---|---|
| Domain object/fact | User/model description of financial reality or policy | Yes, as input |
| Primitive output | Value/flow derived from inputs | No; derived |
| Recognition fact | Assignment of a flow/event to accounting/tax period | Yes as generated semantic fact |
| Obligation/right | Outstanding recognized amount | Yes as lifecycle state |
| Settlement | Satisfaction of an identified obligation/right | Yes as generated event |
| Accounting transaction | Realized balanced accounting posting | Yes for accounting history |
| Account/liability state | Point-in-time economic balance | Yes for state |
| Statement/metric | Derived reporting result | No; recomputed |

A scenario MUST never provide a closing account balance, liability balance, statement amount, or transaction as a substitute for the domain facts that cause it.

Vertical Slice 1 consumes the repository-wide `AuthoritativeState` contract:
accounts, positions, liabilities, obligations, and persistent identity
registries. Its result keeps authoritative closing state, emitted semantic and
accounting history, derived statements/outputs, and diagnostics as distinct
contracts.
Opening authoritative state is normalized before execution: record keys equal
contained IDs, positions reference present accounts, prohibited negative
balances are rejected, and claim recognition/settlement history is unioned into
the global replay registries while contradictory claim history is rejected.

Every execution supplies a `RunContext` with run/scenario identities, `asOf`,
`dataCutoff`, the single-period simulation horizon, base currency, and supported
runtime versions. Successful results report `completed` and expose deterministic
run metadata including the input fingerprint. General multi-period execution is
not part of this slice.

## 4. Domain objects in scope

### 4.1 Person

Reuse canonical `Person`.

Relevant attributes:

- `person_id: UUID` — required, immutable identity;
- `household_id: UUID?` — optional relationship to `Household`;
- `employment_status: EmploymentStatus` — required, `employed` for canonical scenario;
- `residence_jurisdiction: Jurisdiction` — required;
- `filing_status` — derived/annual or event-driven; not directly authoritative for this slice.

The slice requires one employed person. The person supplies ownership and tax-jurisdiction context but does not itself carry a salary balance.

### 4.2 Household

Reuse canonical `Household`.

Relevant attributes:

- `household_id: UUID` — required;
- `members: UUID[]` — at least one;
- `primary_jurisdiction: Jurisdiction` — required;
- derived household income, expenses, and net worth are outputs, not scenario inputs.

### 4.3 Income

Reuse canonical `Income` as the employment income source.

Relevant attributes:

- `income_id: UUID`;
- `owner_id: UUID`;
- `income_type = salary`;
- `amount` — monthly gross compensation amount for the simple fixed-compensation instance;
- `frequency = monthly`;
- `start_date` and optional `end_date`;
- `tax_character = ordinary`;
- `gross_or_net = gross`.

`amount` is an authoritative domain input. The monthly flow produced from it is derived by the compensation primitive.

### 4.4 Account

Reuse canonical `Account`.

Two accounts are required:

- `checking`: liquid cash account;
- `retirement`: retirement account containing cash for this slice.

Relevant attributes:

- identity, owner, currency, opening date;
- opening balance is authoritative initial state;
- current balance is transaction-driven derived state;
- account type distinguishes checking from retirement.

At the v0.1 execution boundary, the cash-bearing state is represented by account cash. The canonical `Account.current_balance` is the corresponding domain-level derived balance.

### 4.5 TaxRule

Reuse canonical `TaxRule`.

For this slice the rule is intentionally simple:

- `tax_rule_id`;
- jurisdiction;
- `tax_type` (for the canonical scenario, a generic income-tax rule is sufficient);
- `effective_date`;
- `calculation_method = proportional` or `flat`;
- an explicit effective rate of `20%` represented as a fraction `0.20`.

The rule is not a simulation output. It is an authoritative policy input.

The slice treats the rule as a withholding/tax-estimation policy, not as an assertion of complete real-world tax law.

### 4.6 Expense

Reuse canonical `Expense`.

Relevant attributes:

- `expense_id`;
- `owner_id`;
- `category = living`;
- `amount = $4,000` monthly;
- `frequency = monthly`;
- `start_date`;
- `payment_account_id = checking`.

The amount and schedule are authoritative domain inputs. The recognized expense and settlement are derived events.

### 4.7 Liability

The canonical `Liability` object remains the persistent liability abstraction, but the slice introduces a separate **obligation/right identity** for recognition-to-settlement lifecycle semantics.

A tax obligation references:

- `obligation_id`;
- `obligation_type = tax_payable`;
- `originating_recognition_id`;
- `owner_id`;
- `liability_id` for the corresponding tax liability state, when represented in the canonical model;
- original amount;
- outstanding amount;
- recognition time;
- optional due date;
- settlement IDs.

The obligation is not reducible to a bare liability balance because settlement must identify the exact recognized claim being consumed.

### 4.8 Event / financial fact

The existing `Event` object represents discrete occurrences and dependencies. For this slice, generated semantic facts/effects are typed runtime records rather than free-form descriptions.

The runtime must distinguish at least:

- compensation occurrence;
- compensation recognition;
- tax calculation result;
- tax recognition;
- tax obligation creation;
- tax settlement;
- retirement transfer;
- expense recognition;
- expense settlement.

These are semantic categories, not user-entered description strings.

## 5. Domain input vocabulary

A canonical domain scenario contains only authoritative inputs such as:

```yaml
employment:
  grossMonthlyCompensation: $10000

taxPolicy:
  effectiveRate: 20%

retirementPolicy:
  contribution: $2000

livingExpenseSchedule:
  monthlyAmount: $4000
```

Plus opening state:

```yaml
checkingOpening: $0
retirementOpening: $0
taxPayableOpening: $0
```

The engine derives the $2,000 tax amount, $2,000 retirement movement, $4,000 expense occurrence, transactions, and closing balances.

The canonical scenario MUST NOT contain:

- `checkingClosing = $2,000`;
- `retirementClosing = $2,000`;
- `netWorth = $4,000`;
- preconstructed accounting legs;
- a tax liability balance of `$2,000` as the mechanism for creating the obligation.

## 6. Primitive contracts

### 6.1 P03 recurring + P06 constant: compensation schedule

For a monthly fixed compensation source:

`GrossCompensation(P_k) = $10,000 × N_monthly_occurrences(P_k)`

For the canonical January period, `N = 1`, so:

`GrossCompensation = $10,000`.

Inputs:

- gross monthly amount;
- recurrence frequency;
- active start/end dates.

Output:

- a gross compensation flow with occurrence identity and occurrence timestamp.

Temporal mode:

- `occurrence_based`;
- monthly recurrence;
- period aggregation by occurrence timestamps.

No primitive directly mutates cash or income state.

### 6.2 P20 tax_dependent: tax calculation

For the deliberately simple proportional policy:

`TaxAmount = round_to_cent(TaxableBase × EffectiveRate)`

Canonical case:

`$10,000 × 0.20 = $2,000`.

Inputs:

- recognized/eligible gross compensation flow;
- explicit `TaxRule`;
- tax basis binding;
- currency.

Outputs:

- tax flow/calculation fact;
- rule identity;
- tax basis;
- calculated amount.

The calculation itself does **not** reduce cash and does **not** by itself constitute settlement.

Rounding:

- ledger monetary outputs are exact cents;
- calculation must round deterministically to the nearest cent using one explicitly implemented rule;
- the initial slice may use half-up cent rounding;
- no binary floating-point value may enter authoritative ledger arithmetic.

### 6.3 Retirement contribution primitive

The slice supports:

`ContributionAmount = fixed amount`

with an extension-compatible policy shape:

`ContributionAmount = fixed_amount` **or** `ContributionAmount = gross_compensation × contribution_rate`.

Only the fixed amount form is required for implementation.

Canonical amount:

`$2,000`.

Output:

- internal transfer flow;
- source account = checking;
- destination account = retirement;
- household ownership validation result.

It is neither an expense nor consolidated household cash consumption.

### 6.4 P03 recurring: ordinary expense generation

For the canonical monthly expense:

`LivingExpense(P_k) = $4,000 × N_monthly_occurrences(P_k)`.

The generated expense flow is attributable to the period and is associated with the configured payment account.

### 6.5 Settlement

Settlement is a semantic operation, not a generic cash-flow label.

For obligation `O` and settlement amount `q`:

`O_outstanding' = O_outstanding - q`

subject to:

`0 < q ≤ O_outstanding`.

A settlement references the obligation explicitly and produces the transaction that moves cash.

### 6.6 Expense settlement

For an ordinary expense that is immediately paid, recognition and settlement may occur in the same period and may occur at the same timestamp, but they remain distinct semantic facts.

If expense recognition creates an expense payable, a later settlement may consume that payable. The canonical slice may use immediate recognition-and-settlement without introducing an additional living-expense obligation because that is not needed to demonstrate the target lifecycle.

## 7. Recognition semantics

### 7.1 Compensation recognition

The compensation occurrence generates a recognition fact assigning `$10,000` of gross compensation income to January.

For the canonical same-period cash-payment convention, compensation recognition and compensation settlement occur in the same period. They are not required to share the same timestamp.

Accounting effect:

```text
Dr Cash                         $10,000
Cr Compensation Income         $10,000
```

This transaction is operating cash flow.

### 7.2 Tax recognition

Tax calculation produces `$2,000`.

Tax recognition creates:

- tax expense recognition of `$2,000` in the recognition period;
- tax payable obligation of `$2,000`;
- no cash movement solely from recognition.

Canonical accrual transaction:

```text
Dr Tax Expense                  $2,000
Cr Tax Payable                  $2,000
```

This transaction is non-cash.

### 7.3 Tax settlement

Tax settlement consumes the identified tax obligation:

```text
Dr Tax Payable                  $2,000
Cr Cash                          $2,000
```

It reduces cash but does not create a second `$2,000` tax expense.

If settlement occurs in April for a January obligation, April contains the settlement cash flow and no April tax expense from that January obligation.

### 7.4 Retirement contribution

The retirement contribution is an internal movement of an economic resource already owned by the household:

```text
Dr Retirement Cash              $2,000
Cr Checking Cash                $2,000
```

It does not create:

- a household expense;
- a new liability;
- a consolidated asset change;
- a consolidated cash outflow.

At account level, checking cash decreases and retirement cash increases.

### 7.5 Living expense

Living expense recognition creates a period expense of `$4,000`.

When paid immediately:

```text
Dr Living Expense               $4,000
Cr Checking Cash                $4,000
```

It is an operating cash outflow and a period expense.

## 8. First-class obligation/right contract

### 8.1 Obligation structure

Minimum runtime fields:

```text
obligationId
obligationType
originatingRecognitionId
ownerId
liabilityId?
originalAmount
outstandingAmount
currency
recognizedAt
dueAt?
settlementIds[]
status
```

`status` is derived from lifecycle state and may be:

- `outstanding`;
- `partially_settled`;
- `settled`.

### 8.2 Lifecycle invariant

For each obligation:

`Outstanding_(t+1) = Outstanding_t + Recognition_t - Settlement_t`

where recognition creates or increases the obligation and settlement consumes it.

For a newly recognized obligation:

`Outstanding_after_recognition = OriginalAmount`.

### 8.3 Settlement constraints

For settlement amount `q`:

`0 < q ≤ Outstanding_before_settlement`.

The engine MUST reject:

- settlement of a missing obligation;
- settlement with a non-positive amount;
- settlement exceeding outstanding amount;
- duplicate settlement of the same settlement identity;
- duplicate consumption of the same obligation amount;
- settlement whose currency differs from the obligation currency;
- settlement dated before recognition unless an explicit prepayment/advance semantic exists, which this slice does not implement.

Tax settlement additionally requires an explicit `FundingPolicy` identifying
the ordered household cash-account sources that may fund it. Funding resolution
precedes accepted settlement and is pure. Insufficient liquidity leaves tax
recognition, the tax liability, and the obligation intact and produces a
`ConstraintOutcome` plus `LiquidityShortfall` warning; it does not post a tax
settlement transaction or recognize tax expense again.

Permitted balances are evaluated as of the proposal's evaluation timestamp.
Generated and externally requested actions execute in chronological order with
a deterministic stable tie-break, independent of request-array order. Future
income or other cash movements cannot fund an earlier proposal; earlier cash
expenses reduce liquidity available to a later proposal.

An accepted funding result is the sole authority for settlement amount and
allocations. Caller-provided settlement identity, timestamp, and trace metadata
cannot substitute different economics, and a settlement cannot precede its
proposal or funding evaluation.

If partial funding is disabled, insufficient liquidity accepts zero. If partial
funding is enabled, the accepted settlement equals available permitted
liquidity and the obligation carries the remainder. An explicitly requested
`$500` payment that is fully funded is `fully_satisfied` even when it leaves a
`$2,000` obligation `partially_settled`.

### 8.4 Partial settlement

For obligation `$2,000`, settlement `$500`:

`Outstanding = $1,500`.

A second settlement of `$1,500` fully settles it.

### 8.5 Full settlement

For obligation `$2,000`, settlement `$2,000`:

`Outstanding = $0`, status = `settled`.

### 8.6 Duplicate settlement

The same settlement identity MUST be idempotently rejected rather than posted twice. A second distinct settlement is allowed only if outstanding amount remains sufficient. The shared authoritative identity registry is the global duplicate authority across claims and state rollover; `claim.settlementIds` separately preserves the lifecycle relationship.

### 8.7 Recognition duplication

The same recognition identity MUST NOT create the same obligation twice. A duplicate recognition submission is a validation error unless the source explicitly represents a separate economic occurrence with a distinct identity.

### 8.8 Period crossing

Recognition and settlement need not occur in the same period.

Example:

```text
January:
  recognition = $2,000
  settlement = $0
  ending payable = $2,000

April:
  recognition from January = $0
  settlement = $2,000
  ending payable = $0
```

April does not recognize the January tax expense again.

## 9. Accounting transaction mapping

Transactions are generated from typed semantic facts. The scenario does not author these legs.

### 9.1 Compensation cash receipt

Transaction type: `income`  
Cash-flow class: `operating`

```text
Dr Cash / checking              $10,000
Cr Income / compensation        $10,000
```

### 9.2 Tax accrual

Transaction type: `tax`  
Cash-flow class: `non_cash`

```text
Dr Expense / tax                 $2,000
Cr Liability / tax payable       $2,000
```

### 9.3 Tax settlement

Transaction type: `tax`  
Cash-flow class: `operating`

```text
Dr Liability / tax payable       $2,000
Cr Cash / checking               $2,000
```

The settlement references `obligationId`.

### 9.4 Retirement transfer

Transaction type: `contribution` or canonical `transfer`, with explicit semantic subtype `internal_account_transfer`.  
Cash-flow class for consolidated reporting: `non_cash`.

```text
Dr Cash / retirement             $2,000
Cr Cash / checking               $2,000
```

### 9.5 Living expense

Transaction type: `expense`  
Cash-flow class: `operating`

```text
Dr Expense / living              $4,000
Cr Cash / checking                $4,000
```

### 9.6 Typed transaction metadata

Every generated transaction MUST carry enough typed references to identify:

- transaction identity;
- transaction date;
- transaction type;
- semantic source fact/effect;
- scenario identity;
- currency;
- affected account/entity IDs;
- obligation ID for obligation settlement;
- accounting legs;
- cash-flow class.

Free-form `description` may be present for human readability but MUST NOT determine semantic behavior.

## 10. State-transition equations

Every accounting transaction is applied to isolated candidate state. All legs
are evaluated, final account/liability/position invariants are validated, and
only then are both the complete balance transition and transaction identity
committed. Temporary leg order cannot decide acceptance. Rejection commits no
leg and no identity.

Let:

- `C_0` = checking opening cash;
- `R_0` = retirement opening cash;
- `T_0` = tax payable opening balance;
- `G` = compensation cash settlement;
- `T_rec` = tax recognition;
- `T_set` = tax settlement;
- `R` = retirement transfer;
- `E` = living expense settlement.

### 10.1 Checking

`C_1 = C_0 + G - R - T_set - E`

Canonical:

`0 + 10,000 - 2,000 - 2,000 - 4,000 = 2,000`.

### 10.2 Retirement

`R_1 = R_0 + R`

Canonical:

`0 + 2,000 = 2,000`.

### 10.3 Tax payable

`T_1 = T_0 + T_rec - T_set`

Canonical:

`0 + 2,000 - 2,000 = 0`.

### 10.4 Consolidated assets

For this slice, the household has two cash accounts and no other economic resources:

`Assets = CheckingCash + RetirementCash`

Canonical:

`2,000 + 2,000 = 4,000`.

The account container itself is not an additional asset. This follows the canonical account/asset hierarchy and avoids double counting.

### 10.5 Liabilities

`Liabilities = TaxPayable`

Canonical:

`0`.

### 10.6 Net worth

`NetWorth = Assets - Liabilities`

Canonical:

`4,000 - 0 = 4,000`.

## 11. Statement semantics

### 11.1 Balance sheet

Point-in-time at period end.

Canonical January:

| Item | Amount |
|---|---:|
| Checking cash | $2,000 |
| Retirement cash | $2,000 |
| Total assets | $4,000 |
| Tax payable | $0 |
| Total liabilities | $0 |
| Net worth | $4,000 |

### 11.2 Income statement

Period recognition basis.

Canonical January:

| Item | Amount |
|---|---:|
| Compensation income | $10,000 |
| Tax expense | $2,000 |
| Living expense | $4,000 |
| Total expenses | $6,000 |
| Net income | $4,000 |

`NetIncome = Income - Expenses = 10,000 - 6,000 = 4,000`.

Tax is an expense in this slice because tax recognition creates a tax expense. The later cash settlement does not create another expense.

### 11.3 Consolidated cash-flow statement

The consolidated household cash-flow statement includes actual external cash movement attributable to the household during the period.

Canonical January:

| Operating cash flow component | Amount |
|---|---:|
| Compensation receipt | +$10,000 |
| Tax settlement | -$2,000 |
| Living expense payment | -$4,000 |
| Internal retirement transfer | $0 consolidated |
| **Net operating cash flow** | **+$4,000** |

The retirement transfer is excluded from consolidated household cash flow because it moves resources between two accounts owned by the same household.

At account level, the transfer is not neutral:

- checking: `-$2,000`;
- retirement: `+$2,000`.

At consolidated level:

`-$2,000 + $2,000 = $0`.

Therefore:

`ConsolidatedCashEnd - ConsolidatedCashOpen = 4,000`.

The canonical result is **$4,000**, not $2,000. The checking account alone ends at $2,000; the household owns an additional $2,000 in retirement cash.

## 12. Time-series semantics

| Variable | Type | Timing basis | State/flow | Authority |
|---|---|---|---|---|
| Gross compensation | money | occurrence/period | flow | derived from Income + primitive |
| Tax calculation | money | after compensation dependency | flow | derived |
| Tax expense | money | recognition date | flow | derived recognition fact |
| Tax payable | money | end-of-period state | stock | authoritative lifecycle state |
| Retirement contribution | money | contribution occurrence | flow | derived |
| Living expense | money | expense occurrence/recognition | flow | derived |
| Checking cash | money | end-of-period | stock | authoritative state |
| Retirement cash | money | end-of-period | stock | authoritative state |
| Total assets | money | end-of-period | derived stock | derived |
| Total liabilities | money | end-of-period | derived stock | derived |
| Net worth | money | end-of-period | derived stock | derived |
| Operating cash flow | money | period | flow | derived from settlement transactions |

Recognition and settlement timestamps MUST remain available even when period-level aggregation combines them.

## 13. Temporal semantics

### 13.1 Half-open periods

All simulation periods use:

`[start, end)`.

For January 2026:

`[2026-01-01T00:00:00, 2026-02-01T00:00:00)`.

An event at `2026-02-01T00:00:00` is outside January.

### 13.2 Canonical January event sequence

A representative sequence is:

```text
2026-01-31 12:00  compensation occurrence/recognition/settlement
2026-01-31 12:01  tax calculation/recognition → obligation
2026-01-31 12:02  tax settlement
2026-01-31 12:03  retirement transfer
2026-01-31 12:04  living expense recognition/settlement
```

Exact timestamps are deterministic fixture data; semantic correctness does not depend on these particular minutes.

All same-period generated and externally supplied actions are interleaved by
effective timestamp before evaluation. Equal timestamps use a deterministic
semantic key, so reversing an input request array cannot change economics.

### 13.3 Period-end exclusion

An event at `period.end` does not execute in that period. It belongs to the next period.

### 13.4 Future settlement

A settlement dated after recognition is eligible in its own period if the obligation exists in carried state.

### 13.5 Prior-period obligation

A later-period settlement consumes the carried obligation but does not recreate prior-period recognition or expense.

## 14. Dependency semantics

The canonical dependency graph is:

```text
Gross Compensation
        ├──────────────→ Tax Calculation
        │                      ↓
        │                Tax Recognition
        │                      ↓
        │                Tax Obligation
        │                      ↓
        │                Tax Settlement
        │
        └──────────────→ Retirement Contribution

Living Expense Schedule ─────→ Expense Generation ─→ Expense Settlement
```

The transaction/state/reporting layer then depends on the semantic facts generated above.

### 14.1 Same-period dependencies

- compensation → tax calculation;
- compensation → retirement contribution;
- tax recognition → tax obligation;
- tax obligation → same-period tax settlement when configured;
- expense generation → expense recognition/settlement.

### 14.2 State-mediated dependency

A later-period tax settlement reads carried tax-obligation state from the prior period. It is not a zero-lag dependency back into January tax calculation.

### 14.3 Settlement reference

`settlement.obligationId` is an explicit identity reference, not an inferred dependency from account or transaction type.

### 14.4 Cycle rules

Any zero-lag cycle in the non-stateful graph is invalid. Stateful recurrence across periods requires an explicit prior-state/lifecycle boundary.

## 15. Semantic invariants

### I1 — Accounting balance

For every transaction and currency:

`Σ debits = Σ credits`.

### I2 — Net worth identity

`NetWorth = Assets - Liabilities`.

### I3 — Obligation integrity

`0 ≤ Outstanding` and every settlement satisfies:

`Settlement ≤ Outstanding_before_settlement`.

### I4 — No duplicate settlement

A settlement identity can be posted at most once.

### I5 — Internal transfer neutrality

For a pure household-owned account transfer:

`ΔConsolidatedAssets = 0`;

`ΔConsolidatedNetWorth = 0`;

`ΔConsolidatedCashFlow = 0`.

### I6 — State isolation

A failed run MUST NOT modify the caller's authoritative opening state.

### I7 — Temporal boundary

An event at `period.end` is excluded from `[start,end)`.

### I8 — Determinism

Same opening state, same domain inputs, same specification version, and same engine version produce the same observable result.

### I9 — No semantic double counting

A pure internal transfer MUST NOT be simultaneously classified as a consolidated cash outflow and an independent expense.

### I10 — No settlement re-recognition

Settlement of an existing obligation does not create another income/expense recognition fact for the underlying event.

### I11 — Recognition idempotence

A recognition fact with an already-committed identity cannot create a second equivalent obligation.

### I12 — Authoritative-state discipline

Derived balances, statements, and metrics cannot be direct user-authored closing-state inputs.

### I13 — Persistent identity authority

Posted transaction, recognition, settlement, and generated occurrence
identities survive state rollover. Replaying any committed identity is rejected.
Claim settlement references remain lifecycle relationships rather than the
global duplicate registry.

### I14 — Run boundary and provenance

`dataCutoff ≤ asOf`, the simulation interval is non-empty, and observed input
whose information-availability time `observedAt` is after `dataCutoff` is
rejected. Economic `effectiveAt` remains a separate domain timing boundary and
does not establish availability. Model-generated facts remain distinguishable
from observed and user-entered facts after result construction/serialization.

### I15 — Base-currency and shared-state derivation

The run base currency MUST equal the Vertical Slice input currency and every
aggregated state/transaction Money currency; no FX conversion is implicit.
`consolidatedCash` sums account cash only. Statement assets additionally include
existing positions at static market value (`price × quantity`), so positions in
authoritative state cannot disappear from assets or net worth.

## 16. Canonical end-to-end scenario

### 16.1 Opening state

```text
checking = $0
retirement = $0
tax payable = $0
```

### 16.2 Domain inputs

```text
gross monthly compensation = $10,000
tax policy effective rate = 20%
retirement fixed contribution = $2,000
living expense monthly amount = $4,000
```

### 16.3 Derived semantic lifecycle

```text
Compensation occurrence
    ↓
Gross compensation flow = $10,000
    ↓
Compensation recognition
    ↓
Compensation settlement
    ↓
Checking +$10,000

Compensation flow
    ↓
Tax calculation = $10,000 × 20% = $2,000
    ↓
Tax recognition
    ↓
Tax obligation created = $2,000
    ↓
Tax settlement = $2,000
    ↓
Tax payable = $0
Checking -$2,000

Compensation flow
    ↓
Retirement contribution = $2,000
    ↓
Internal transfer
    ↓
Checking -$2,000
Retirement +$2,000

Living expense schedule
    ↓
Expense = $4,000
    ↓
Recognition + settlement
    ↓
Checking -$4,000
```

### 16.4 Expected outputs

```text
checking = $2,000
retirement = $2,000
tax payable = $0

assets = $4,000
liabilities = $0
net worth = $4,000

income = $10,000
expenses = $6,000
net income = $4,000

consolidated operating cash flow = $4,000
```

These values are assertions, not inputs.

## 17. Adversarial scenarios

### A1 — Tax accrual without settlement

Input:

- compensation recognition creates `$2,000` tax expense;
- settlement disabled.

Expected:

- tax expense = `$2,000`;
- tax payable = `$2,000`;
- checking cash unchanged by tax recognition;
- no tax settlement cash flow.

### A2 — Later tax settlement

January:

- tax recognition `$2,000`;
- no settlement;
- ending payable `$2,000`.

April:

- settlement `$2,000` referencing January obligation.

Expected April:

- payable `$0`;
- checking decreases `$2,000`;
- tax expense attributable to this obligation in April = `$0`.

### A3 — Partial settlement

Recognize `$2,000`; settle `$500`.

Expected:

`Outstanding = $1,500`.

### A4 — Over-settlement

Recognize `$2,000`; attempt settlement `$2,001`.

Expected: hard validation failure; no authoritative state commit.

### A5 — Duplicate settlement

Post `$2,000` settlement successfully; attempt same settlement identity again.

Expected: hard validation failure; no second cash reduction.

### A6 — Internal retirement transfer

Transfer `$2,000` from checking to retirement.

Expected:

- checking `-$2,000`;
- retirement `+$2,000`;
- consolidated assets unchanged;
- consolidated net worth unchanged;
- consolidated cash flow contribution `$0`.

### A7 — Period-end event

Place an event exactly at `period.end`.

Expected: excluded from the period.

### A8 — Dependency cycle

Add zero-lag cycle `tax → retirement → tax`.

Expected: dependency validation failure before execution.

### A9 — Failed transaction sequence

Execute a sequence in which a later transaction is invalid, such as an over-settlement.

Expected:

- caller's opening state unchanged;
- no partial authoritative commit;
- failure identifies the invalid semantic object/transaction.

### A10 — Duplicate recognition

Submit the same tax recognition identity twice.

Expected: second recognition rejected; no second `$2,000` obligation.

## 18. Implementation boundary

The implementation SHOULD expose the following conceptual stages:

```text
DomainInput
    ↓
PrimitiveEvaluator
    ↓
SemanticFactGenerator
    ↓
RecognitionEngine
    ↓
ObligationEngine
    ↓
SettlementEngine
    ↓
TransactionGenerator
    ↓
TransactionValidator
    ↓
StateTransitionEngine
    ↓
StatementEngine
    ↓
TimeSeriesAssembler
```

### 18.1 Domain types

Introduce typed runtime types for:

- `FinancialFact`;
- `CompensationFlow`;
- `TaxCalculation`;
- `RecognitionFact`;
- `Obligation`;
- `Settlement`;
- `SemanticEffect`;
- `TransactionProposal`.

### 18.2 Primitive evaluator

Implement only the primitives required by this slice:

- recurring/constant compensation;
- proportional tax calculation;
- fixed retirement contribution;
- recurring ordinary expense.

Do not implement the complete P01–P34 library in this milestone.

### 18.3 Obligation engine

Implement creation, lookup, partial/full settlement, duplicate detection, and over-settlement protection.

### 18.4 Settlement engine

A settlement MUST:

1. resolve its obligation identity;
2. validate outstanding amount;
3. generate the appropriate semantic consumption effect;
4. generate a balanced transaction proposal;
5. update obligation state only as part of the atomic commit.

### 18.5 Transaction generator

Transaction generation is downstream of semantic facts. It must not be reverse-engineered from human descriptions.

### 18.6 State transition

Apply only validated transactions/effects to a clone of opening state. Commit the resulting state only after all period validation succeeds.

Transaction posting additionally uses a per-transaction candidate and commits
all legs together only after final state invariants succeed.

### 18.7 Statements and time series

Statements and time-series values are recomputed from authoritative state, semantic facts, obligation lifecycle, and posted transactions. They are never directly authored by the scenario fixture.

### 18.8 Run and provenance contracts

The single-period runner accepts canonical `RunContext`, records current engine,
financial-specification, model-format, and result-schema versions, and computes
its input fingerprint from context (excluding `runId`), opening authoritative
state, domain inputs, ordered economic actions, and explicit funding policy.
Generated recognitions/effects retain model provenance and deterministic
occurrence keys. Externally observed settlement facts retain source and
idempotency identity and are admitted only when `observedAt ≤ dataCutoff`;
`effectiveAt` independently governs their economic timing.

## 19. Golden-test contract

The golden test fixture MUST be expressed in domain terms.

### Good

```yaml
employment:
  grossMonthlyCompensation: 10000

taxPolicy:
  effectiveRate: 0.20

retirementPolicy:
  contribution: 2000

livingExpenseSchedule:
  monthlyAmount: 4000
```

### Forbidden

```typescript
state.accounts.checking.cash = money("2000");
state.accounts.retirement.cash = money("2000");
```

The test should invoke the complete semantic pipeline and then assert:

- generated facts;
- obligation lifecycle;
- generated transactions;
- balanced accounting;
- final state;
- statements;
- cash-flow classification;
- invariants.

## 20. Test matrix

| Area | Required tests |
|---|---|
| Compensation primitive | monthly occurrence, inactive period, deterministic amount |
| Tax primitive | proportional calculation, cent rounding, explicit rule identity |
| Retirement primitive | fixed contribution, account ownership validation |
| Expense primitive | recurring monthly expense, inactive period |
| Recognition | income/tax/expense recognition categories |
| Obligation | creation, identity, partial settlement, full settlement |
| Settlement | missing obligation, over-settlement, duplicate settlement, later-period settlement |
| Transactions | generated legs, balance, typed entity references |
| State | checking, retirement, payable roll-forward |
| Statements | balance sheet, income statement, consolidated cash flow |
| Cash-flow semantics | internal transfer neutral at consolidation |
| Temporal | `[start,end)`, period-end exclusion, future settlement |
| Dependency | deterministic order, zero-lag cycle rejection |
| Atomicity | failed sequence leaves opening state unchanged |
| Determinism | repeated identical run produces identical result |
| Identity registry | transaction/recognition/settlement/occurrence replay across rollover |
| Run context | temporal invariants, versions, run/scenario identity, fingerprint |
| Provenance | observed/user/model distinction, cutoff rejection, external idempotency |
| Completion | completed horizon and modeled-stress distinction |
| Golden | canonical end-to-end scenario |

## 21. Known ambiguities resolved by this specification

### 21.1 Gross compensation versus tax withholding

The canonical slice treats `$10,000` as gross compensation and models the `$2,000` tax as a separately recognized tax obligation and settlement. Therefore the compensation receipt is `$10,000`, not `$8,000`.

This is intentional because it exposes the obligation lifecycle. A future payroll-specific slice may model withholding as a source-account allocation, but that is outside this slice.

### 21.2 Retirement contribution is not an expense

The `$2,000` retirement movement changes account allocation but does not consume household resources. It is therefore not included in consolidated expenses or consolidated cash outflow.

### 21.3 Tax recognition and settlement are separate

They may occur in one period or different periods. Recognition affects income/liability state; settlement affects cash/liability state.

### 21.4 Liability versus obligation

A tax liability balance is the balance-sheet representation. The obligation identity is the lifecycle object that explains which recognition created the amount and which settlement consumes it. They are related but not semantically interchangeable.

### 21.5 Account balance versus consolidated household cash

Checking cash is not household cash. Consolidated household cash aggregates non-overlapping household-owned cash resources across accounts.

## 22. Compatibility and architectural constraints

The implementation MUST preserve:

- exact-cent monetary behavior at the ledger boundary;
- deterministic dependency ordering;
- atomic state isolation;
- canonical object vocabulary;
- half-open temporal semantics;
- typed accounting legs;
- double-entry balance;
- derived-output discipline.
- persistent identity registries;
- explicit run/version/fingerprint metadata;
- actual/user/model provenance distinction.

It MUST NOT:

- infer accounting semantics from description text;
- mutate authoritative closing state directly from scenario callbacks;
- treat an obligation as merely an unexplained liability balance;
- classify an internal transfer as household consumption;
- introduce floating-point ledger state;
- make closing statements scenario inputs.

## 23. Acceptance criteria

Vertical Slice 1 is complete only when all of the following hold:

1. `docs/vertical-slice-1-specification.md` is the agreed implementation contract.
2. The canonical domain-input fixture produces the expected `$2,000` checking, `$2,000` retirement, `$0` payable, `$4,000` assets, `$4,000` net worth, `$10,000` income, `$6,000` expenses, and `$4,000` consolidated operating cash flow.
3. Tax accrual without settlement produces a payable without tax-related cash movement.
4. Later settlement consumes the identified obligation without new expense.
5. Partial and full settlements work.
6. Over-settlement and duplicate settlement fail atomically.
7. Internal retirement transfer is neutral in consolidated cash flow and net worth.
8. Period-end events are excluded.
9. Zero-lag cycles fail.
10. Every generated transaction is balanced.
11. Failed execution leaves opening authoritative state unchanged.
12. Same inputs reproduce the same result.
13. CI passes `npm ci`, `npm run typecheck`, and `npm test`.
14. No production shortcut violates the formal semantic layering.
15. Run metadata exposes explicit temporal/version context and a deterministic fingerprint.
16. Committed identities prevent replay across state rollover.

## 24. Canonical numerical reconciliation

The entire canonical scenario reconciles as follows:

```text
Gross compensation                         +$10,000
Tax expense                                 -$2,000
Living expense                              -$4,000
                                             ------
Net income                                  +$4,000

Checking:        +10,000 - 2,000 - 2,000 - 4,000 = $2,000
Retirement:      +2,000                         = $2,000
Tax payable:     +2,000 - 2,000                 = $0

Consolidated assets: 2,000 + 2,000              = $4,000
Net worth:            4,000 - 0                 = $4,000

Operating cash flow:
  +10,000 compensation receipt
   -2,000 tax settlement
   -4,000 living expense
   +0 internal retirement transfer
   ----------------------------------
   +4,000 consolidated operating cash flow
```

The key accounting/economic distinction is that **checking ending cash is $2,000, while consolidated household cash is $4,000**. The retirement contribution changes where the household's cash is held; it does not destroy $2,000 of household cash.
