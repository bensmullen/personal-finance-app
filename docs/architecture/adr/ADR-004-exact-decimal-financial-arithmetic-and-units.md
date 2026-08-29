# ADR-004: Exact decimal financial arithmetic and units

- Status: Accepted
- Date: 2026-08-29

## Context

The prototype used bigint cents for posted money and JavaScript `number` values
for rates. That representation cannot express the canonical decimal scales,
explicit rate bases, or non-money quantities required by the financial
specifications. Mortgage helpers also converted values through binary floating
point.

## Decision

The engine uses an immutable `DecimalAmount` abstraction backed by a signed
arbitrary-precision integer coefficient and a decimal scale. Exact operations
remain exact; division and reduction of scale require an explicit
`RoundingPolicy`.

`Money`, `Rate`, and `Quantity` compose `DecimalAmount` with explicit
`Currency`, `RateBasis`, and `Unit` identities. Money operations reject mixed
currencies, and quantity operations reject mixed units. JSON serialization uses
decimal strings. Posted monetary boundaries use an explicit currency rounding
policy.

The representation is private to the value abstraction. Domain contracts do
not expose coefficient/scale storage and can migrate to another
arbitrary-precision implementation without changing financial contracts.

## Consequences

- Authoritative financial values do not cross through IEEE-754 arithmetic.
- Callers use value methods instead of JavaScript arithmetic operators.
- Rounding decisions are visible and testable.
- The implementation carries responsibility for conformance vectors around
  parsing, arithmetic, rounding, serialization, currency, and unit checks.

## References

- `docs/architecture/system-software-architecture.md`, Sections 9, 16.2, 35,
  36, 52.2, and PR 2
- `docs/personal_finance_executable_financial_semantics_v0.1.md`
