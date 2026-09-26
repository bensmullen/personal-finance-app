---
name: pfm-spec-scope
description: Locate the smallest authoritative Personal Finance App specification sections required to resolve a financial-semantic or architectural question. Do not use for routine code-only edits.
---

# PFM Specification Scoping

Use this skill when implementation or review depends on normative project
meaning.

1. Identify the exact concepts in question.
2. Start with `docs/spec-manifest.json` and, when requirement-level tracing is
   useful, `docs/specs/verification/requirements-index.json`.
3. Respect this financial/implementation authority order: canonical schema →
   executable semantics → relevant capability specification → relevant
   slice/milestone specification → ADR. Governance specifications control
   decomposition/retrieval but do not override canonical or executable
   financial meaning.
4. Use manifest domains/keywords plus dependency metadata to identify the
   smallest applicable specification set before opening documents broadly.
5. Read only matching sections plus the minimum surrounding context needed to
   interpret them safely.
6. Follow `parent_spec_ids` only for actual decomposition/allocation and
   `depends_on_spec_ids` for cross-capability dependencies; do not treat one
   relation as the other.
7. Stop reading once the governing rule is unambiguous.
8. Do not load an entire canonical schema, architecture specification, or
   executable-semantics document merely because it is authoritative.
9. Distinguish clearly between explicit specification, reasonable
   implementation inference, and an actual specification gap.
10. Do not implement while performing specification scoping unless the parent
    task explicitly asks for implementation.

Return a compact list of the authority sections consulted and the rule each
one establishes.
