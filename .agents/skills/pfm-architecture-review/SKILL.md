---
name: pfm-architecture-review
description: Review a Personal Finance App change for module-boundary, dependency-direction, facade, and scope violations. Use for requested architecture audits or merge-readiness checks, not routine surgical or local implementation patches.
---

# PFM Architecture Review

Review changed files first.

Verify:

- engine code does not depend on UI/browser infrastructure;
- lower modules do not depend on simulation;
- compatibility facades remain re-export-only;
- engine implementation does not import root compatibility facades;
- runtime imports remain acyclic;
- financial logic has not leaked into presentation code;
- generated artifacts have not become independent financial authority;
- substantial immutable catalogs, proofs, snapshots, and diagnostics have
  one source owner and are not repeated per period/entity across read models,
  worker/API messages, caches, or persistence. Check the actual serialized
  boundary, validated scoped references, bounded growth, and provenance;
  small justified duplication is acceptable, not full-catalog amplification;
- the change remains inside the requested milestone.

Run the existing architecture validator when execution is appropriate.

Use `$pfm-spec-scope` only if an architecture rule is genuinely ambiguous.

Do not suggest unrelated cleanup.

Return actionable findings only, ordered by severity.
