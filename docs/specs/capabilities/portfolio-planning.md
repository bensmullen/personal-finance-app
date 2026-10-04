# Portfolio & Investment Planning

**Version:** 0.4.0-draft
**Status:** Post-PR21 capability outline
**Requirement prefix:** PFA-INV

## 1. Purpose

This specification defines general household investment-planning capability beyond basic investment execution and the specialized concentrated-stock/equity-compensation capability.

It governs allocation, rebalancing, contribution/withdrawal policy, account location, investment costs, liquidity interaction, and planning integration while leaving authoritative market-return semantics to the financial/probabilistic engine and tax consequences to the tax capability.

## 2. Normative requirements

### PFA-INV-001 — Household-level portfolio view

Investment planning SHALL support analysis at the household level while preserving account ownership, tax treatment, liquidity restrictions, and other account-specific constraints. Household aggregation SHALL NOT erase economically material account distinctions.

### PFA-INV-002 — Explicit allocation policy

Target allocation, allocation ranges, or other investment-policy constraints SHALL be explicit planning inputs when used. The system SHALL NOT infer a user's risk tolerance or target allocation from holdings alone.

### PFA-INV-003 — Diversification and exposure integrity

Portfolio analysis SHALL represent supported asset-class, issuer, sector, or other material exposures without silently treating concentrated or unknown holdings as diversified. Specialized single-issuer and employer-equity semantics remain governed by PFA-EQ.

### PFA-INV-004 — Rebalancing as an explicit decision

Rebalancing policy and material buy/sell decisions SHALL be explicit actions or rules with timing and constraints. The planner SHALL distinguish allocation drift from an authored or proposed rebalancing action.

### PFA-INV-005 — Contribution and withdrawal allocation

When supported, the planner SHALL model how new contributions and withdrawals are allocated across accounts/assets as explicit policies or decisions rather than unexplained balance adjustments.

### PFA-INV-006 — Account location and tax interaction

Taxable, tax-deferred, tax-exempt, and other account treatments SHALL remain explicit where material. Tax-aware asset location, realization, withdrawal, or conversion analysis SHALL consume the authoritative tax engine rather than duplicate tax formulas in portfolio logic.

### PFA-INV-007 — Fees, costs, and implementability

Material investment fees, transaction costs, restrictions, minimums, liquidity needs, and other supported implementation constraints SHALL be represented when they can change a strategy comparison. Unsupported material constraints SHALL produce capability diagnostics rather than silent idealization.

### PFA-INV-008 — Liquidity and funding integration

Portfolio decisions that consume or provide cash SHALL pass through authoritative household funding, settlement, and liquidity semantics. Investment planning SHALL NOT assume unlimited external cash or bypass household shortfall constraints.

### PFA-INV-009 — Deterministic and stochastic consistency

Deterministic and stochastic portfolio evaluations SHALL use the same supported portfolio decision semantics. Stochastic analysis changes uncertain outcomes, not the meaning of an allocation, trade, contribution, withdrawal, or policy.

### PFA-INV-010 — Risk and return assumptions remain explicit

Expected return, volatility, correlation, and other probabilistic market assumptions SHALL come from explicit scenario/calibration inputs. The investment planner SHALL NOT hide market forecasts inside optimization code.

### PFA-INV-011 — Explainable portfolio comparisons

A user-facing portfolio strategy comparison SHALL identify the material allocation/policy changes and relevant effects on modeled return, downside/liquidity risk, taxes, costs, and other supported goals. It SHALL identify material unsupported investment semantics that could change the conclusion.

### PFA-INV-012 — Private-alpha account and instrument floor

Before private alpha, deterministic investment execution SHALL support the account/instrument relationships required by PFA-DET, including traditional/Roth/after-tax 401(k) balances, traditional/Roth IRA, HSA, taxable brokerage, checking/savings funding accounts, supported Treasuries/bonds/CDs, cryptocurrency, and a deliberately bounded supported option subset.

Account wrappers, positions, and standalone assets SHALL remain economically distinct so household aggregation does not double-count the same resource.

### PFA-INV-013 — Payroll-funded workplace contributions

For the initial private-alpha supported authoring contract, employee traditional 401(k), Roth 401(k), after-tax 401(k), and HSA contributions SHALL originate from payroll compensation allocation rather than generic spending or an arbitrary account transfer.

The contribution policy SHALL preserve contribution character, payroll timing, cash-pay reduction, destination account/position effects, applicable limits, and tax facts.

### PFA-INV-014 — Personally funded investment contributions

For the initial private-alpha supported authoring contract, IRA contributions, taxable-brokerage purchases, Treasury purchases, CD purchases, and other ordinary personally funded investment purchases SHALL draw from an explicitly selected checking or savings account.

Other real-world funding paths MAY be added later, but they SHALL NOT be inferred or silently accepted before their semantics are implemented.

### PFA-INV-015 — Retirement conversion semantics

Supported in-plan 401(k) Roth conversions and other supported retirement conversions SHALL be explicit non-consumption operations that preserve source/destination identity, converted basis/character, applicable tax recognition, and separate tax settlement.

A conversion SHALL NOT be represented as an ordinary expense, withdrawal-plus-unrelated-deposit shortcut, or unexplained balance edit.

### PFA-INV-016 — Fixed-income, deposit, crypto, and option mechanics

The private-alpha deterministic investment floor SHALL define executable semantics for the supported subset of:

- Treasury bills/bonds and other admitted fixed-income positions, including coupon/interest and principal/maturity behavior;
- CDs, including deposit principal, interest, and maturity;
- cryptocurrency positions, including quantity, price/value, basis, purchases, and disposals; and
- options, with explicit premium/cost, quantity/contract multiplier, underlying, expiration, and the supported sale/exercise/assignment/expiration outcomes.

Unsupported instrument features or strategies SHALL be capability-gated rather than approximated.

### PFA-INV-017 — Investment income and reinvestment

Interest, ordinary/non-qualified dividends, qualified dividends when supported, realized gain/loss, unrealized gain/loss, and return of principal SHALL remain distinct economic/tax facts.

Dividend reinvestment SHALL preserve dividend recognition and then execute a linked purchase. Reinvestment SHALL NOT erase income recognition or double-count household cash flow.

### PFA-INV-018 — Deterministic tax-character integration

Supported investment operations SHALL emit the tax-character facts required by PFA-TAX for short/long-term gains, interest, dividends, retirement/HSA activity, fixed-income income/dispositions, cryptocurrency dispositions, and supported option outcomes.

Portfolio logic SHALL NOT duplicate the tax engine's liability calculation.

### PFA-INV-019 — Pre-stochastic deterministic verification

The investment mechanics required by PFA-DET-013 SHALL be verified deterministically before R5 begins. Verification SHALL include funding-source enforcement, account/position/no-double-counting behavior, cash settlement, basis/gain effects, tax-character facts, and ending balances.


### PFA-INV-020 — Employer workplace contributions and matching

Before private alpha, deterministic workplace-plan execution SHALL support explicit employer 401(k) matching/non-elective contributions and employer HSA contributions.

Employer contribution rules SHALL preserve formula, timing, destination, employee-versus-employer character, applicable vesting status when materially modeled, statutory-limit interaction, tax facts, and lineage. Employer-funded amounts SHALL NOT reduce household take-home cash.

### PFA-INV-021 — Automatic tax-advantaged contribution limits

For supported 401(k), HSA, and IRA flows, the product SHALL derive applicable effective-dated statutory contribution limits and catch-up capacity from authoritative rules and household facts.

Employee elective deferrals, combined employer+employee annual additions, HSA combined employer+employee limits, and IRA limits SHALL remain distinct where law distinguishes them. The UI SHALL expose modeled used/remaining capacity and SHALL NOT silently cap an authored contribution unless an explicit user-selected auto-cap policy is active.

### PFA-INV-022 — Retirement rollover integrity

Supported retirement rollovers SHALL be explicit transfer operations preserving source/destination eligibility, ownership, pre-tax/Roth/after-tax character, basis, tax recognition, timing, withholding/cash-replacement effects where applicable, and lineage.

The deterministic private-alpha floor SHALL cover supported direct trustee-to-trustee/plan-to-plan rollovers plus a bounded indirect-rollover path with applicable deadline/frequency restrictions. Unsupported inherited-plan, RMD, corrective-distribution, QDRO, or plan-specific acceptance cases SHALL be capability-gated rather than approximated.


### PFA-INV-023 — Workplace retirement plan loans remain a tracked capability

Workplace retirement plan loans (for example, a participant 401(k) loan) are not required for the initial private-alpha cohort unless an enrolled household actually needs them, but they SHALL remain an explicit tracked product capability and SHALL NOT disappear from the roadmap after alpha.

Before the product claims support for plan loans, the model SHALL define the applicable plan-loan contract rather than approximating the loan as an ordinary withdrawal or ordinary consumer debt. The supported contract must address, where applicable:

- loan origination and participant cash proceeds;
- the plan/account economic effect and any investment displacement or loan-receivable treatment;
- payroll repayment of principal and interest;
- repayment interest returning to the participant's plan/account where applicable;
- statutory/plan borrowing limits and repayment-term constraints;
- employment termination, loan offset, deemed-distribution/default treatment, and applicable tax consequences; and
- lineage sufficient to distinguish plan-loan cash flows from contributions, withdrawals, distributions, and external debt.

Unsupported plan-specific terms SHALL be capability-gated rather than guessed.

### PFA-INV-024 — Private-alpha deterministic portfolio optimization floor

Portfolio optimization is a required private-alpha planning capability, but the first useful version MAY be deterministic.

After PFA-DET is complete, the product SHALL support bounded portfolio strategy generation/evaluation for already-supported investment decisions, including at minimum:

- contribution priority/allocation across eligible supported accounts while respecting contribution limits and employer match opportunities;
- movement toward an explicit user-selected target allocation or allocation range;
- supported rebalancing choices;
- liquidity and funding constraints;
- fees/costs where modeled; and
- tax-aware account/contribution/location decisions only to the extent the authoritative tax engine has complete coverage for the compared strategies.

The deterministic optimizer MAY rank a bounded set of strategies using explicit user goals/constraints and deterministic return assumptions. It SHALL NOT claim uncertainty-aware, risk-adjusted, globally optimal, or efficient-frontier optimality without the stochastic/risk semantics required by PFA-PLAN and PFA-PROB.

## 3. Relationship to specialized equity capability

PFA-EQ owns concentrated single-issuer and equity-compensation semantics. This specification owns the broader household portfolio-planning context into which those exposures are integrated.

The system may initially support diversified asset-class planning while capability-gating unsupported issuer-specific behavior. It SHALL NOT silently approximate unsupported concentrated positions as diversified holdings.

## 4. Deferred decisions

Detailed security tax-lot optimization, product selection, full risk-tolerance elicitation, efficient-frontier/risk-budget methods, plan-loan execution, and automated trade execution remain future design choices unless a nearer milestone explicitly requires them. The bounded deterministic portfolio optimizer in PFA-INV-024 is not deferred.
