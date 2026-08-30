---
name: pfm-architecture-review
description: Review a Personal Finance App change for module-boundary, dependency-direction, facade, and scope violations. Use for architecture audits or merge-readiness checks.
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
- the change remains inside the requested milestone.

Run the existing architecture validator when execution is appropriate.

Use `$pfm-spec-scope` only if an architecture rule is genuinely ambiguous.

Do not suggest unrelated cleanup.

Return actionable findings only, ordered by severity.
