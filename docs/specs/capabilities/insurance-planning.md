# Insurance Planning

**Version:** 0.3.0-draft
**Status:** Post-PR21 capability outline
**Requirement prefix:** PFA-INS

## 1. Purpose

This specification defines insurance as a financial-planning and risk-transfer capability rather than merely a static model object. It governs how coverage, premiums, contingent benefits, household exposures, and planning comparisons interact with the authoritative household forecast.

The initial document is intentionally product-neutral. It does not prescribe carriers, quote integrations, underwriting assumptions, or a universal coverage recommendation formula.

## 2. Normative requirements

### PFA-INS-001 — Insurance as explicit risk transfer

Insurance planning SHALL distinguish insured household exposures, retained risk, coverage, premiums, and contingent benefits. Coverage SHALL NOT be represented as an ordinary investment return or unexplained cash-flow adjustment.

### PFA-INS-002 — Effective-dated policy terms

Material policy terms used in a forecast SHALL be effective-dated or otherwise temporally explicit, including supported premium schedules, coverage periods, limits, deductibles/waiting periods, benefit rules, and termination/renewal behavior where applicable.

### PFA-INS-003 — Premiums use authoritative cash-flow semantics

Insurance premiums and other policy costs SHALL enter the household through authoritative cash-flow, funding, settlement, and accounting semantics. The insurance layer SHALL NOT directly mutate account balances.

### PFA-INS-004 — Benefits are contingent financial effects

Insurance benefits SHALL be generated only when modeled covered conditions and policy rules are satisfied. Claim or benefit effects SHALL preserve identity, timing, provenance, and applicable constraints.

### PFA-INS-005 — Coverage ownership and beneficiary semantics are explicit when material

When ownership, insured person/property, beneficiary, or household membership can change economic outcomes, those relationships SHALL be explicit or capability-gated. The insurance capability SHALL NOT infer economically material ownership/beneficiary relationships from application-user identity.

### PFA-INS-006 — Adequacy analysis uses explicit goals and exposures

Coverage-adequacy analysis SHALL be based on explicit household exposures, supported goals, obligations, available assets/income, and planning assumptions. The system SHALL NOT embed one universal coverage multiple as an authoritative rule.

### PFA-INS-007 — Compare risk retention and transfer through the financial engine

Supported insurance choices SHALL be evaluable as explicit planning decisions through the same household engine used for other strategies so that premiums, liquidity, taxes where applicable, and contingent benefits participate in one reconciled outcome.

### PFA-INS-008 — Uncertainty sources are explicit

Probability/severity assumptions used for insurable events SHALL be explicit, versioned or reproducible where applicable, and distinguished from policy contract terms. Unsupported event distributions SHALL not be silently invented.

### PFA-INS-009 — Domain interactions remain authoritative

Tax treatment, investment opportunity cost, debt/liquidity effects, and other cross-domain consequences of insurance decisions SHALL be provided by their owning capabilities rather than duplicated inside insurance-planning formulas.

### PFA-INS-010 — Capability-aware insurance output

If material policy mechanics, underwriting constraints, event models, or household exposures are unsupported, the product SHALL identify the limitation and SHALL NOT present the affected coverage recommendation as comprehensive.

### PFA-INS-011 — Product and provider neutrality

Core insurance-planning semantics SHALL be provider-neutral. Carrier/product adapters, quote services, and underwriting integrations MAY be added later without redefining the financial meaning of coverage, premium, benefit, or planning outcomes.

### PFA-INS-012 — Private-alpha deterministic insurance floor

Before stochastic household modeling and private alpha, the supported household model SHALL be able to represent and test the deterministic insurance effects required by PFA-DET:

- premium/cost schedules funded through authoritative household cash flow;
- policy/coverage effective periods;
- explicitly scheduled or scenario-triggered benefit/payout events for supported stress cases;
- payout settlement to the applicable account/beneficiary; and
- applicable accounting and tax classification.

Probabilistic claim frequency/severity is not required for this gate. Unsupported policy-family or claim mechanics SHALL be capability-gated rather than approximated.

### PFA-INS-013 — Pre-stochastic health-insurance and Medicare premium floor

Before R5 stochastic household runtime begins, the deterministic insurance/health-cost layer SHALL support materially common premium mechanics beyond a generic expense.

For employer or individually purchased health coverage, the supported contract SHALL preserve covered household members, effective coverage period, gross premium, employer subsidy/share where applicable, employee/household share, payment frequency, and pre-tax payroll versus after-tax household funding character.

For Medicare-age households, the supported deterministic cost floor SHALL represent the applicable elected/supported Medicare premium structure, including Part A premium when applicable, Part B, Part D, and explicitly authored Medicare Advantage, Medigap, or other supplemental premiums. Income-related premium adjustments such as IRMAA SHALL use authoritative income/tax facts when materially applicable rather than a hard-coded surcharge.

This requirement does not require medical-claim adjudication, provider-network modeling, prescription formularies, or probabilistic healthcare utilization. Those remain capability-gated until separately implemented.

## 3. Initial scope

The first useful implementation may focus on deterministic premiums/coverage and explicit stress-event comparisons before introducing probabilistic claim-frequency/severity models.

Life, disability, property/casualty, health, long-term-care, annuity, and other product families MAY be introduced incrementally. A product family SHALL be capability-gated until its materially relevant contract and household-effect semantics are defined.

## 4. Canonical representation gate

The existing canonical Insurance object is the starting vocabulary. If richer policy/coverage/beneficiary/claim structures are required, their Level-1 representation SHALL be decided explicitly before schema mutation. This capability outline does not itself redefine the canonical schema.
