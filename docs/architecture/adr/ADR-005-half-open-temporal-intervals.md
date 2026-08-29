# ADR-005: Half-open temporal intervals

- Status: Accepted
- Date: 2026-08-29

## Context

Financial execution depends on unambiguous period boundaries. The prototype
used ISO strings but created and manipulated dates independently in multiple
engine files.

## Decision

Engine time contracts distinguish validated `CivilDate`, UTC `Instant`, and
`Period` values. Periods are always non-empty and half-open: `[start, end)`.
Calendar and instant parsing/manipulation are isolated in the canonical time
module; engine modules do not perform ad-hoc `Date` arithmetic.

The `asOf` and data-cutoff run boundary remains a later run-context milestone.
This decision establishes the temporal value foundation without inventing that
future contract.

## Consequences

- A value at `period.end` belongs to the following period.
- Invalid civil dates and non-UTC instants fail at construction boundaries.
- User-facing inclusive dates require an explicit adapter into half-open engine
  periods.

## References

- `docs/architecture/system-software-architecture.md`, Sections 10, 16.3, and
  PR 2
- `docs/personal_finance_executable_financial_semantics_v0.1.md`
