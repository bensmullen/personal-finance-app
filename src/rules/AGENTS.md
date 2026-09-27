# Rule-engine guidance

These rules apply under `src/rules/`.

- Rule evaluation remains deterministic for a fixed rule catalog, effective
  date, inputs, and execution context.
- Effective dates, jurisdictions, filing/election status, thresholds, units,
  rounding, and dependency/capability diagnostics must be explicit.
- Do not embed tax-law or other authoritative rule formulas in UI/application
  presentation code.
- Shared rule catalogs are versioned/content-addressed definitions; household
  models store household facts/elections/references rather than duplicated
  copies of common law/rules.
- Missing specialized rule coverage gates only materially affected outputs;
  never fake completeness or silently fall back to unrelated rules.
- Boundary/table/rule-invariant verification is owned by CI.
