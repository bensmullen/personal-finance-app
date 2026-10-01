# UI guidance

These rules apply under `ui/`.

- Financial formulas and authoritative financial decisions belong in the
  engine/application layer, not presentation components.
- Preserve distinct current-input, deterministic-result, stochastic-result,
  running, stale, incomplete, unsupported, cancelled, and error states.
- Never make a cached, superseded, or historical forecast appear current after
  authoritative inputs or Forecast Basis change.
- Preserve the last successful result while a replacement is running; a failed
  or cancelled replacement must not silently evict it.
- Display-only chart sampling/aggregation must not change engine results.
- Deterministic and stochastic views must identify their basis and freshness;
  probability language must not imply guarantees.
- User-facing explanations come from engine diagnostics/lineage or explicitly
  regenerated representative paths, not reconstructed financial semantics.
- UI edits must not trigger heavy authoritative work on every keystroke; use the
  application commit/debounce/request-identity contract.
- Codex does not run local browser/E2E validation; GitHub CI and milestone UAT
  own verification.
