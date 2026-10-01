# Portfolio & Investment Planning

**Version:** 0.1.0-draft
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

## 3. Relationship to specialized equity capability

PFA-EQ owns concentrated single-issuer and equity-compensation semantics. This specification owns the broader household portfolio-planning context into which those exposures are integrated.

The system may initially support diversified asset-class planning while capability-gating unsupported issuer-specific behavior. It SHALL NOT silently approximate unsupported concentrated positions as diversified holdings.

## 4. Deferred decisions

Detailed security tax-lot optimization, transaction-cost models, product selection, risk-tolerance elicitation, efficient-frontier methods, and automated trade generation remain future design choices unless a nearer milestone explicitly requires them.
