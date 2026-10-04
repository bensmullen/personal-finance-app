# Deterministic Household Financial Semantics Readiness

**Version:** 0.2.0-draft  
**Status:** Pre-stochastic/private-alpha gate  
**Requirement prefix:** PFA-DET

## 1. Purpose

This specification defines the deterministic household-financial behaviors that must be complete, user-authorable, and independently testable before stochastic household modeling begins.

It is a cross-domain readiness contract, not a replacement for the canonical schema or executable financial semantics. Exact accounting, timing, funding, tax, and state-transition behavior remains owned by the higher-authority financial specifications and the applicable tax, investment, insurance, and liability capabilities.

The product SHALL prove these behaviors deterministically first so Monte Carlo execution does not multiply ambiguous inputs, unsupported fields, or incorrect financial relationships across thousands of realizations.

## 2. Core readiness principles

### PFA-DET-001 — User concept to executable calculation contract

Every normal-user financial input exposed for the private-alpha deterministic model SHALL map to a defined executable financial meaning.

For each material field or authoring action, the implementation SHALL identify whether the value is:

- an authoritative household fact;
- a planning assumption;
- an explicit decision/policy;
- a creation-time immutable fact;
- a derived value; or
- an unsupported capability.

A normal editor SHALL NOT expose a field as freely editable when the engine ignores it, rejects it, silently preserves another value, or requires an undeclared rate/frequency/timing basis.

Derived values SHOULD be calculated rather than redundantly requested when the necessary authoritative inputs already exist and the derivation is unambiguous.

### PFA-DET-002 — Funding-source semantics are explicit

Transfers, contributions, purchases, debt payments, premiums, and other cash-consuming operations SHALL identify their authoritative funding source and SHALL NOT be modeled as generic expenses merely because cash leaves one account.

For the initial private-alpha supported authoring contract:

- employee traditional 401(k), Roth 401(k), after-tax 401(k), and HSA contributions are payroll-sourced only;
- IRA contributions, taxable-brokerage purchases, Treasury purchases, CD purchases, and other ordinary personally funded investments are funded only from explicitly selected checking or savings accounts;
- unsupported funding sources or rollover/conversion paths SHALL be rejected or capability-gated rather than inferred.

These are product-scope constraints for the initial alpha, not claims that other real-world funding paths never exist.

### PFA-DET-003 — Workplace retirement and HSA contribution mechanics

The deterministic household model SHALL support payroll-sourced employee contributions to:

- traditional/pre-tax 401(k);
- Roth 401(k);
- after-tax 401(k); and
- HSA accounts.

Contribution amount/rate, payroll timing/frequency, applicable limits/rules, cash-pay reduction, account increase, tax recognition, and lineage SHALL remain distinct.

Traditional/pre-tax, Roth, and after-tax contribution character SHALL remain distinct through payroll and tax calculation. The engine SHALL NOT assume that all retirement contributions reduce the same taxable bases. Any applicable income-tax versus payroll-tax treatment must come from the authoritative tax rules for that contribution type.

A contribution SHALL NOT be double-counted as both household spending and an investment purchase.

Employer 401(k) matching/non-elective contributions and employer HSA contributions SHALL be modeled as employer-funded allocations: they increase the destination account/position without reducing employee cash pay, while still participating in the applicable combined statutory limits and tax characterization.

Applicable effective-dated employee, employer+employee, HSA, and IRA contribution limits/catch-ups SHALL be calculated from authoritative rule data and household facts rather than manually entered as magic constants.

### PFA-DET-004 — Retirement-account conversions and IRA semantics

The deterministic model SHALL support:

- traditional IRA accounts;
- Roth IRA accounts;
- user-funded IRA contributions from checking/savings under the private-alpha funding contract;
- traditional/Roth withdrawal and distribution distinctions where material;
- in-plan conversion of eligible traditional/after-tax 401(k) balances to Roth 401(k) as an explicit conversion event/operation; and
- associated tax recognition and basis/character tracking required by the supported tax rules.

A conversion is not household consumption and SHALL NOT be represented as an ordinary expense. Asset movement, tax recognition, and any cash tax settlement SHALL remain separate.

D1 SHALL also support a bounded but advanced rollover contract covering eligible direct trustee-to-trustee/plan-to-plan rollovers, pre-tax versus Roth destination compatibility, preservation/splitting of after-tax basis, and supported indirect-rollover timing/withholding/frequency restrictions. A rollover is not household consumption or earned income. Unsupported plan-specific/inherited/RMD/corrective/other specialized cases SHALL produce explicit capability diagnostics.

### PFA-DET-005 — Taxable brokerage account mechanics

Taxable brokerage accounts SHALL support deterministic:

- cash funding from checking/savings;
- purchases and sales;
- security/position quantity and basis;
- realized gain/loss;
- unrealized valuation changes;
- dividends and interest;
- cash distributions and reinvestment where supported; and
- applicable tax-character facts.

Household aggregation SHALL count each economic resource exactly once and SHALL NOT double-count account totals plus their underlying cash/positions.

### PFA-DET-006 — Cash accounts and deposit interest

Checking and savings accounts SHALL support opening/current cash balances plus deterministic credited interest where configured.

Interest SHALL use an explicit rate basis, compounding/accrual convention, crediting schedule, and tax character. The product SHALL NOT infer a compounding basis from a bare percentage field.

Interest credited to an account increases cash and produces the applicable interest-income/tax recognition rather than being treated as an external transfer.

### PFA-DET-007 — Treasuries, bonds, and certificates of deposit

The deterministic model SHALL support a defined private-alpha subset of fixed-income/deposit instruments covering:

- Treasury bills and supported Treasury/bond positions;
- certificates of deposit;
- purchase/funding;
- principal/par or deposit amount;
- maturity;
- coupon/interest or discount/accretion semantics as applicable;
- scheduled interest/coupon cash settlement;
- principal repayment/redemption at maturity;
- sale before maturity when that instrument path is supported; and
- applicable basis, realized gain/loss, and tax-character facts.

The model SHALL distinguish return of principal from income. Unsupported callability, floating-rate, inflation-linked, default, early-withdrawal, or complex bond features SHALL be capability-gated.

### PFA-DET-008 — Mortgage lifecycle

Private-alpha deterministic liability support SHALL include:

- ordinary fixed-rate mortgage amortization;
- principal and interest separation;
- scheduled payments funded from an explicit cash account;
- extra principal payments;
- payoff behavior; and
- refinance as an explicit transaction/event that closes or replaces the old obligation and establishes the new one without double-counting principal or cash.

Refinance cash-out, points/fees, closing costs, escrow, variable-rate, recast, or other features SHALL be supported explicitly when modeled or capability-gated when omitted.

### PFA-DET-009 — Cryptocurrency and option positions

Cryptocurrency SHALL be representable as an investment asset class with explicit quantity, price/value, purchases, sales/disposals, basis, realized gain/loss, and tax-character facts. It SHALL NOT be silently treated as diversified equity.

Before private alpha, options SHALL have a deliberately bounded deterministic contract. Any supported option position SHALL define the economic meaning of premium/cost, quantity/contract multiplier, underlying reference, expiration, and the supported sale/exercise/assignment/expiration outcomes required for that position type.

Unsupported option strategies or contract mechanics SHALL be rejected/capability-gated rather than approximated.

### PFA-DET-010 — Dividends, interest, gains, and reinvestment

The deterministic investment model SHALL distinguish at minimum:

- interest income;
- ordinary/non-qualified dividends;
- qualified dividends when supported;
- short-term realized capital gain/loss;
- long-term realized capital gain/loss;
- unrealized gain/loss; and
- return of principal/capital where modeled.

Dividend reinvestment SHALL be represented as two linked economic effects: dividend recognition/settlement followed by an investment purchase. Reinvestment SHALL NOT erase income recognition or create duplicate household cash flow.

Holding-period and tax-character decisions SHALL be sourced from explicit transaction/lot/timing facts and applicable tax rules, not inferred from the display label of an investment.

### PFA-DET-011 — Insurance premiums and deterministic benefits

Before stochastic insurance-event modeling, the household engine SHALL support the private-alpha deterministic insurance floor:

- explicit policy premium/cost schedule funded through authoritative household cash flow;
- policy/coverage effective period;
- explicitly scheduled or scenario-triggered benefit/payout events for supported stress cases;
- payout settlement to the appropriate account/beneficiary; and
- applicable tax/cash-flow/accounting classification.

A premium is an expense/cost according to the supported policy contract. A benefit is not ordinary earned income unless the applicable tax/accounting rule says so.

Unsupported claim adjudication, carrier behavior, probabilistic frequency/severity, or policy-family mechanics SHALL be capability-gated.

### PFA-DET-012 — Tax treatment is part of the deterministic truth model

Before stochastic modeling, deterministic fixtures SHALL prove the applicable tax treatment for the supported private-alpha cases, including:

- short-term and long-term realized capital gains/losses;
- taxable interest;
- ordinary and qualified dividends;
- traditional and Roth retirement contributions/distributions;
- supported 401(k) Roth conversions;
- HSA contributions/distributions where material;
- taxable brokerage activity;
- Treasury/bond/CD interest and disposition treatment where supported;
- cryptocurrency dispositions; and
- supported option outcomes.

Tax-dependent outputs SHALL remain incomplete when the applicable target-jurisdiction tax semantics are missing. A missing tax rule SHALL never be treated as zero tax.

### PFA-DET-013 — Deterministic truth-table verification

Each required use case SHALL have deterministic verification with independently stated expected economic effects, not only snapshot or implementation-internal assertions.

The minimum pre-stochastic fixture matrix SHALL include:

1. traditional 401(k) payroll contribution;
2. Roth 401(k) payroll contribution;
3. after-tax 401(k) payroll contribution;
4. employer 401(k) match and non-elective contribution;
5. HSA employee payroll contribution;
6. employer HSA contribution;
7. automatic 401(k)/HSA/IRA annual and catch-up contribution-limit calculation, including applicable combined employee/employer limits;
8. in-plan Roth conversion;
9. direct Traditional/pre-tax retirement rollover;
10. Roth retirement rollover;
11. mixed pre-tax/after-tax rollover preserving basis/character;
12. at least one supported indirect-rollover case;
13. traditional IRA contribution;
14. Roth IRA contribution;
15. taxable brokerage purchase/sale;
16. ordinary mortgage amortization;
17. mortgage extra principal payment;
18. mortgage refinance;
19. checking/savings interest credit;
20. Treasury bill/bond interest plus principal maturity behavior;
21. CD interest plus maturity principal;
22. cryptocurrency purchase/sale;
23. insurance premium plus deterministic payout/stress event;
24. at least one supported deterministic option lifecycle;
25. short-term versus long-term gain treatment;
26. interest and dividend tax-character treatment;
27. dividend reinvestment; and
28. funding-source enforcement proving payroll-only versus checking/savings-only paths.

For each case, verification SHALL reconcile the applicable beginning state, recognized income/expense/gain/tax facts, transfers/contributions, cash settlement, asset/liability change, ending state, and no-double-counting invariants.

At least one combined realistic-household fixture SHALL exercise multiple cases together to detect cross-domain interaction errors that isolated unit tests cannot reveal.

### PFA-DET-014 — User-authoring and diagnostic integrity

Normal authoring SHALL use financially recognizable concepts and SHALL prevent or clearly gate unsupported configurations before the user relies on a forecast.

The UI SHALL:

- distinguish account containers, investment positions, and standalone property/assets;
- prevent unsupported funding-account choices where the valid set is known;
- avoid asking for redundant inputs that can be derived safely;
- expose rate units/bases/frequencies when economically material;
- make creation-only facts explicit rather than pretending later edits will apply;
- explain unsupported capabilities in user-action language; and
- keep compiler codes/UUIDs in technical detail rather than primary guidance.

### PFA-DET-015 — Stochastic and private-alpha gate

R5 stochastic runtime implementation SHALL NOT begin until the deterministic readiness matrix in PFA-DET-013 is complete for the intended initial private-alpha scope, except for isolated infrastructure work that cannot alter or assume unresolved household financial semantics.

R6/R7 probabilistic household results SHALL NOT be treated as product-complete until this deterministic gate remains green.

Private-alpha launch additionally requires these supported use cases to be authorable through the intended onboarding/editor paths and included in representative UAT, with unsupported subfeatures explicitly capability-gated.

## 3. Scope boundary

This gate requires deterministic correctness and authoring for the named household mechanics. It does not require:

- stochastic return distributions or Monte Carlo execution;
- automated portfolio optimization;
- exhaustive security/product coverage;
- every option strategy or bond feature;
- every insurance product family;
- every specialized tax rule; or
- production bank/brokerage aggregation.

Those capabilities may follow only after the deterministic semantic foundation they depend on is explicit and verified.

## 4. Cross-capability ownership

- PFA-INV owns investment/account/instrument planning and execution refinements.
- PFA-TAX owns tax law, characterization, liability, withholding, and settlement.
- PFA-INS owns policy/coverage/benefit semantics.
- PFA-UX owns user comprehension and editing presentation.
- PFA-ONB owns efficient capture/import of the required facts.
- The executable financial semantics own timing, funding, accounting, state, and invariant authority.

This specification owns the readiness gate tying those capabilities into a testable private-alpha household model.
