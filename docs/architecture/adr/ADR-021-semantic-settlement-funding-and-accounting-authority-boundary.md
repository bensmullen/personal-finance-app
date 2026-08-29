# ADR-021: Semantic settlement, funding, and accounting authority boundary

- Status: Accepted
- Date: 2026-08-29

## Context

Recognition, claim lifecycle, liquidity resolution, accounting history, and
state transition are distinct authorities. The prototypes previously combined
some of these stages and disagreed about insufficient cash and negative
balances. The executable-semantics specification now defines the reviewed
funding and constraint outcomes.

## Decision

The engine preserves this authority sequence:

```text
recognition
→ claim
→ settlement proposal
→ funding/constraints
→ accepted settlement
→ accounting
→ state
```

Funding resolution is pure: it does not mutate claims or balances and cannot
create accounting history. Insufficient liquidity is a modeled constraint
outcome rather than an accounting failure by itself. Only a positive accepted
settlement reaches accounting.

Only accounting-module factories create authoritative accounting legs and
transactions. Accounting validates balance independently by currency and
cannot invent funding, borrowing, transfers, overdraft, or asset sales.

Cash-flow classification is authoritative on cash legs. Transaction-level
labels, including a presentation-only `mixed` summary, are derived from those
cash legs.

If an accepted posting creates prohibited negative cash, the accounting/state
boundary raises a hard invariant violation. It does not reinterpret the
failure as a funding request.

## Consequences

- Recognition and outstanding claims survive ordinary liquidity shortfalls.
- Proposal funding outcome remains distinct from claim lifecycle status.
- Funding policies and permitted source order are explicit and testable.
- Accounting records cannot be bypassed with freely constructed authoritative
  legs or transactions.
- Future mixed-class payments can classify each cash component without one
  lossy transaction-wide classification.

## References

- [Executable Financial Semantics Specification](../../personal_finance_executable_financial_semantics_v0.1.md), Section 4.4.1
- [System and Software Architecture](../system-software-architecture.md), Sections 7, 14, 38, 40, and PR 3
- [Vertical Slice 1 Specification](../../vertical-slice-1-specification.md), Section 8.3
