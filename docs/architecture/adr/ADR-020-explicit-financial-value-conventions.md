# ADR-020: Explicit financial value conventions

- Status: Accepted
- Date: 2026-08-29

## Context

ADR-004 established exact decimal arithmetic and typed financial values, while ADR-005 established half-open temporal intervals. The first implementation left several contracts implicit: generic rates rejected negative values, annual and periodic rate metadata was incomplete, percentage conversion rounded prematurely, currency metadata could be invented by callers, and temporal proration lacked executable conventions.

## Decision

Generic `Rate` values are signed and carry a complete `RateConvention`. Nominal annual rates carry a positive integer compounding frequency, and periodic rates carry their contractual period. Dimensionless proportions use `Ratio`; user-facing percent values use `Percentage` and convert exactly without rounding.

Supported currencies come from an internal authoritative code-to-minor-unit registry. Currency identity is its code. Unsupported codes are rejected rather than assigned guessed metadata.

Rounding policies are supplied by the business context that owns a calculation or posting boundary. Display formatting also requires an explicit policy and does not silently apply settlement rounding.

Civil-date `Duration` and `YearFraction` are first-class values. Executable day-count conventions use precise named variants. The `utcMonth` helper is explicitly limited to UTC fixtures and schedules and rejects years that JavaScript would silently reinterpret.

## Consequences

Callers must provide more semantic metadata and explicit rounding policies. This makes invalid or ambiguous states harder to construct and keeps conversion exact until a declared boundary. Additional currencies, day-count variants, calendar-month behavior, and rate conventions require deliberate registry or contract extensions.

This decision clarifies and extends ADR-004 and ADR-005; it does not supersede them.

## References

- [ADR-004: Exact decimal financial arithmetic and units](ADR-004-exact-decimal-financial-arithmetic-and-units.md)
- [ADR-005: Half-open temporal intervals](ADR-005-half-open-temporal-intervals.md)
- [Executable Financial Semantics Specification](../../personal_finance_executable_financial_semantics_v0.1.md)
- [System and Software Architecture](../system-software-architecture.md)
