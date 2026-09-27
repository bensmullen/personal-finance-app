# Documentation and specification guidance

These rules apply to work under `docs/`.

- Use `docs/spec-manifest.json` first to identify the narrowest governing spec.
- Use `docs/specs/verification/requirements-index.json` only when
  requirement-level traceability is relevant.
- `parent_spec_ids` represent decomposition/allocation; `depends_on_spec_ids`
  represent cross-capability prerequisites. Do not conflate them.
- Keep one normative home per controlled requirement. Reference requirement IDs
  instead of copying normative text across specs.
- Governance specifications control decomposition, retrieval, dependency
  direction, and maturity gates; they do not outrank canonical schema or
  executable financial semantics.
- A documentation/spec-only patch normally needs only the directly relevant
  spec/traceability validation, not application tests.
