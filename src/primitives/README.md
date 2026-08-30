# Primitive runtime

This module owns the canonical runtime catalog and typed evaluation contracts
for personal-finance primitives.

The catalog registers every canonical identity from P01 through P34 in stable
order. Roadmap PR 6 makes exactly nine identities executable:

- P01 `static`
- P02 `one_time`
- P03 `recurring`
- P04 `finite_duration`
- P05 `perpetual`
- P06 `constant`
- P08 `geometric_growth`
- P13 `inflation_linked`
- P20 `tax_dependent`

The other 25 identities are deliberately `registered_only`. Attempting to
evaluate one fails with `PRIMITIVE_NOT_IMPLEMENTED`; unknown identities fail
separately with `PRIMITIVE_UNKNOWN`.

Evaluation is deterministic and pure with respect to authoritative financial
state. Inputs, parameters, prior primitive state, period/scenario context, and
trace references are explicit. Results carry values, explicit next primitive
state, typed effects where applicable, diagnostics, and copied immutable trace
references. P02 execution state is returned to its caller and is never
committed inside the evaluator, so rollback and retry remain safe.

P03 currently supports explicit UTC instants and an anchored UTC-monthly
schedule with an explicit `skip` policy for months lacking the anchor day. P08
supports periodic integer growth and effective-annual growth over an explicit
rational year fraction. P13 supports deterministic explicit price-index
linkage. P20 supports the existing resolved proportional tax rule.

Primitive evaluation never posts accounting transactions, mutates
`AuthoritativeState`, performs settlement, or imports simulation orchestration.
Roadmap PR 7 will adapt simulation context to this lower-level API and own
multi-period primitive-state commit. Later slices will activate the remaining
registered identities when their complete contracts are exercised.
