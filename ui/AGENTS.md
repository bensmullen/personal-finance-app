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

## User-experience design and review

- For substantial changes to whole journeys, financial forms, navigation or forecast comprehension, use `.agents/skills/pfm-ux-review/SKILL.md` and an approved task/visual reference **before** Codex implementation. Preserve the canonical single-writer financial ownership contract.
- Apply short labels, contextual accessible help and task-first progressive disclosure; do not hide blocking errors or invent unmodeled financial results. A passing field metadata check is not a usability finding.
- Screen/interaction screenshots are captured outside Codex implementation turns in the bounded UX evidence workflow. Compare changed views to the approved target and require uncoached owner UAT when specified. No local browser/server exception is granted to Codex.
- Minor local copy/spacing corrections do not need a new prototype. Repeated cross-workflow failures require a single journey-level root-cause/design review, not a series of uncoordinated field patches.
