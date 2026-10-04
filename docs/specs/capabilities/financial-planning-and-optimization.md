# Financial Planning & Decision Optimization

**Version:** 0.2.0-draft
**Status:** Post-PR21 capability outline
**Requirement prefix:** PFA-PLAN

## 1. Purpose

This specification defines the planning layer that evaluates alternative household decisions against explicit goals and constraints. It extends forecasting into decision support without creating a second financial engine.

The planning layer may generate, screen, rank for presentation, or compare candidate strategies, but financially authoritative outcomes remain governed by the canonical financial schema, executable financial semantics, and applicable domain capabilities such as tax, investments, and insurance.

This specification does not choose a particular optimization algorithm and does not make all long-term planning capabilities prerequisites for private alpha.

## 2. Core planning model

Planning SHALL distinguish:

- **facts** — authoritative current or historical household information;
- **assumptions** — modeled future conditions that are not controlled decisions;
- **decisions** — actions or policies the household can choose;
- **goals** — desired outcomes or planning targets;
- **constraints** — unacceptable, infeasible, legal, liquidity, risk, or user-imposed boundaries;
- **strategies** — identified combinations of decisions/policies;
- **outcomes** — results produced by evaluating a strategy through the authoritative financial engine.

Representation of Goal, Strategy, Recommendation, OptimizationProblem, or similar concepts in the Level-1 canonical schema remains a separate domain decision. This capability SHALL NOT add those concepts to the canonical schema by implication.

## 3. Normative requirements

### PFA-PLAN-001 — Explicit planning semantics

Planning inputs SHALL preserve the distinction among facts, assumptions, decisions, goals, constraints, strategies, and outcomes. The system SHALL NOT silently reinterpret an assumption as a household decision or a modeled outcome as an authoritative fact.

### PFA-PLAN-002 — One authoritative financial evaluator

Candidate strategies SHALL be evaluated through the same authoritative financial semantics used by ordinary deterministic and stochastic household forecasts. The planner/optimizer SHALL NOT maintain independent tax, accounting, funding, investment-return, liability, or cash-flow formulas that can diverge from the authoritative engine.

### PFA-PLAN-003 — Explicit objectives and constraints

Optimization objectives, goals, tradeoff preferences, and hard constraints SHALL be explicit planning configuration. The system SHALL NOT embed a universal hidden objective such as maximizing terminal net worth.

### PFA-PLAN-004 — Multi-objective tradeoffs

The planning layer SHALL support decisions where no single strategy dominates every relevant objective. User-facing comparisons SHALL expose material tradeoffs such as spending, liquidity, risk, taxes, debt, insurance cost/coverage, retirement security, and legacy outcomes when those dimensions are supported rather than collapsing them into an unexplained score.

### PFA-PLAN-005 — Strategy identity and reproducibility

A saved or reported strategy evaluation SHALL identify the decision configuration and enough model, Forecast Basis, rule, calibration, horizon, objective/constraint, engine, and evaluation-fidelity metadata to reproduce or explain the comparison where the underlying artifacts remain available.

### PFA-PLAN-006 — Deterministic planning before stochastic optimization

The architecture SHALL permit deterministic strategy evaluation before probabilistic optimization is complete. Deterministic results SHALL remain identifiable as deterministic and SHALL NOT be presented as uncertainty-aware optimality evidence.

### PFA-PLAN-007 — Comparable stochastic strategy evaluation

When stochastic forecasts are used to compare strategies, materially comparable candidates SHALL use a common Forecast Basis and common-random-number cohorts where applicable so that decision deltas are not unnecessarily obscured by unrelated random draws.

### PFA-PLAN-008 — Progressive-fidelity evaluation

Large strategy spaces SHALL support progressive evaluation: inexpensive feasibility/rule screening and deterministic evaluation may narrow candidates before lower-cost stochastic evaluation and higher-confidence finalist evaluation. Lower-fidelity screening SHALL be identified as such and SHALL NOT replace authoritative finalist evaluation for a user-facing strategy recommendation.

### PFA-PLAN-009 — Search claims match search evidence

The product SHALL NOT claim that a strategy is globally optimal, best, or uniquely preferred unless the search method and evaluated domain justify that claim. When search is bounded, heuristic, approximate, or incomplete, user-facing output SHALL describe the bounded comparison rather than imply exhaustive optimization.

### PFA-PLAN-010 — Reusable decision overlays

Where financial semantics permit, changing a planning decision or scenario overlay SHOULD reuse invariant compiled household structures rather than recompiling unrelated facts, schedules, relationships, and rules. Reuse SHALL NOT bypass validation or materially applicable semantic dependencies.

### PFA-PLAN-011 — Planning explanation

A strategy comparison or recommendation SHALL be explainable in terms of material decision differences, assumptions, constraints, applicable rules, and outcome tradeoffs. The system SHOULD support drill-down from a high-level comparison to representative authoritative forecast paths or calculation lineage where useful.

### PFA-PLAN-012 — Capability-aware recommendations

A planning result SHALL identify materially relevant unsupported or incomplete domain semantics. The product SHALL NOT present an integrated recommendation as complete when a missing tax, investment, insurance, legal/product-rule, or stochastic capability could materially change that recommendation.

### PFA-PLAN-013 — User-controlled decision support

The product MAY surface modeled recommendations or candidate strategies, but SHALL preserve user control, distinguish modeled analysis from guarantees, and expose material assumptions and constraints. Planning output SHALL not silently mutate authoritative household facts or execute external financial actions.

### PFA-PLAN-014 — Optimization implementation neutrality

Search/optimization algorithms, local versus server execution, and acceleration technology are implementation choices behind stable planning and simulation boundaries. An optimizer implementation SHALL NOT redefine financial semantics, result meaning, or reproducibility requirements.


### PFA-PLAN-015 — Deterministic portfolio optimization may precede stochastic modeling

After the deterministic D1 financial-semantic gate and the applicable tax floor are complete, the planning layer SHALL be able to implement a bounded deterministic portfolio optimizer before Monte Carlo/stochastic simulation exists.

That optimizer MAY generate and rank candidate contribution, allocation, rebalancing, and supported account-location strategies using:
- explicit deterministic return assumptions;
- authoritative contribution limits/employer-match rules;
- authoritative funding/liquidity/accounting semantics;
- applicable authoritative tax evaluation;
- explicit user goals, target allocations/ranges, and hard constraints.

Its claims SHALL match its evidence. Deterministic portfolio optimization may identify the best strategy among the bounded alternatives under the stated deterministic assumptions, but SHALL NOT be presented as uncertainty-aware risk optimization, sequence-risk optimization, or globally optimal asset allocation.

### PFA-PLAN-016 — Stochastic portfolio optimization upgrades deterministic planning

After the required probabilistic market/household semantics exist, P2 SHALL extend supported portfolio optimization with uncertainty-aware comparisons such as downside risk, dispersion, sequence risk, probability of goal success, and other supported distribution-sensitive objectives.

The stochastic optimizer SHALL reuse the same decision semantics as PFA-PLAN-015 rather than redefining contributions, allocation, rebalancing, taxes, or account location. Deterministic portfolio optimization remains useful for preview, explanation, screening, and cases whose conclusion does not materially depend on uncertainty.

## 4. Initial scope

The first planning milestone SHALL establish the deterministic strategy-definition/evaluation contract and the bounded deterministic portfolio-optimization floor required by PFA-INV-024. It should prove strategy identity, comparable evaluation, explanations, capability diagnostics, compiled-plan reuse, contribution/account constraints, and bounded candidate generation before broad stochastic search is introduced.

Later milestones add stochastic candidate evaluation, progressive uncertainty-aware optimization, and broader integrated decision domains. Full cross-domain optimization is not a prerequisite for private alpha, but the bounded deterministic portfolio optimizer is.

## 5. Deferred representation decisions

Before introducing new Level-1 model objects, explicitly decide whether goals, strategies, recommendations, and optimization configurations are:

- canonical financial-domain objects;
- scenario/planning configuration;
- application-layer durable configuration;
- derived artifacts; or
- a combination with clear authority boundaries.

No new canonical object should be added solely because an optimizer implementation finds it convenient.
