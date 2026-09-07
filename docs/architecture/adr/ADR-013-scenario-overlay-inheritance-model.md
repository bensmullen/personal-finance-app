# ADR-013: Scenario overlay and inheritance model

- Status: Accepted
- Date: 2026-09-03

## Context

Forecast alternatives must be comparable without rewriting the baseline model,
historical facts, or authoritative opening state. The existing VS2, VS3, and
VS4 runners already own distinct timing, funding, validation, accounting, and
replay semantics. In particular, VS4 obligations can occur within a month, so
running whole slices sequentially would not preserve intraperiod causality.

## Decision

Scenario identity and the generic immutable runtime definition live at the
model layer without a dependency on simulation. Typed executable changes,
inheritance resolution, slice application, and comparison adapters live at the
simulation layer.

Inheritance resolves root to leaf. Same-layer semantic-target duplication is a
hard conflict; a descendant may explicitly override its ancestor. Semantic
target keys are derived from typed change kinds and domain identities, making
resolution independent of catalog and independent-change array order. List
operations require explicit add, replace, or remove intent.

Every comparison executes the baseline and alternatives from independent
clones of one common opening authoritative state and shared economic run
context, with distinct scenario and run identities. Results use common
exact-Money series, exact deltas over the common committed prefix, resolved
configuration differences, and assumption/event/rule calculation lineage.

Scenario support remains coupled neither to UI nor persistence. The adapters
reuse existing slice mechanics for income, expenses, investment returns,
investment-position purchases, fees, debt prepayments, and funding policies.
There is no sequential VS2+VS3+VS4 household compositor.

## Consequences

Baseline inputs and authoritative state remain immutable, retries remain
deterministic, and generated occurrence identity stays scenario-specific.
Unsupported economic behavior fails before execution instead of being inferred.

Future work may add persistence/import-export bindings, stochastic execution,
new authoritative asset or debt-event mechanics, and an integrated scheduler.
Those extensions must preserve this immutable overlay boundary and explicitly
define any new temporal composition semantics.

## References

- [System software architecture](../system-software-architecture.md)
- [Executable financial semantics](../../personal_finance_executable_financial_semantics_v0.1.md)
