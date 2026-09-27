# UI guidance

These rules apply to work under `ui/`.

- Financial formulas and authoritative financial decisions belong in the
  engine/application layer, not presentation components.
- Preserve the distinction between current authoritative inputs, derived
  deterministic results, stochastic results, stale results, and errors.
- Never make a cached or superseded forecast appear current after inputs change.
- Display-only chart sampling/aggregation must not change engine results.
- Keep user-facing explanations tied to engine diagnostics/lineage instead of
  reconstructing financial semantics independently in the UI.
- Prefer focused component/browser verification; leave broad E2E to CI.
