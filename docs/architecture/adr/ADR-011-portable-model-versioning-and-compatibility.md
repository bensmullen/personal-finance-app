# ADR-011: Portable model versioning and compatibility

- Status: Accepted
- Date: 2026-08-29

## Context

The repository already has `docs/personal_finance_model.schema.json` as the
model-instance serialization direction, but its original root exposed one
ambiguous `specification_version`. The architecture requires model serialization
compatibility to evolve independently from financial meaning and prohibits
silent reinterpretation of older personal data.

## Decision

The existing model JSON Schema remains the basis of the portable model. The
portable envelope contains:

```text
model_format_version
financial_specification_version
model_id
objects
```

`model_format_version` governs the envelope/object serialization contract.
`financial_specification_version` identifies the financial semantics under
which the model was authored. Neither substitutes for the other.
Model-format compatibility is not financial-semantics compatibility. A current
serialization shape does not authorize reinterpretation under current financial
semantics: direct execution requires both versions to be explicitly supported.

Compatibility is explicitly classified as `supported_directly`, `migratable`,
`read_only_legacy`, or `unsupported`. A migratable classification requires a
registered deterministic migration chain whose every step identifies migration
ID, source version, target version, and transformation. Missing gaps are not
inferred or skipped. Unknown/newer versions are unsupported rather than loaded
as current.

A format migration changes only serialization unless its separately reviewed
contract explicitly declares a financial-semantics migration. It MUST preserve
`financial_specification_version` by default and MUST NOT silently imply that
financial meaning was migrated.

The former `0.1.0-draft` envelope is read-only legacy. Its
`specification_version` field did not unambiguously say whether the value was a
model-format version or a financial-specification version, so no migration may
guess the missing meaning.

The portable document remains independent of UI and future persistence choices.
Import/export application workflows are deferred; this ADR establishes their
version and compatibility foundation.

## Consequences

- Model serialization and financial semantics can version independently.
- Current documents round-trip without losing either version.
- Legacy ambiguity remains visible and safe instead of being silently rewritten.
- Future migrations require explicit reviewed code and test vectors.
- The unreconciled object mappings in the reference schema remain declared debt;
  this decision reconciles only the PR 4 envelope/compatibility boundary.

## References

- [System and Software Architecture](../system-software-architecture.md), Sections 4, 25, and PR 4
- [Executable Financial Semantics Specification](../../personal_finance_executable_financial_semantics_v0.1.md), Section 16.3
- `docs/personal_finance_model.schema.json`
- `docs/spec-manifest.json`
