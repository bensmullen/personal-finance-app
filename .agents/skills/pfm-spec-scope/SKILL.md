---
name: pfm-spec-scope
description: Locate the smallest authoritative Personal Finance App specification sections required to resolve a financial-semantic or architectural question. Do not use for routine code-only edits.
---

# PFM Specification Scoping

Use this skill when implementation or review depends on normative project
meaning.

1. Identify the exact concepts in question.
2. Respect this authority order: canonical schema → executable semantics →
   slice specification → ADR.
3. Search `docs/` for those concepts before opening documents broadly.
4. Read only matching sections plus the minimum surrounding context needed to
   interpret them safely.
5. Follow cross-references only when the current section does not resolve the
   question.
6. Stop reading once the governing rule is unambiguous.
7. Do not load an entire canonical schema, architecture specification, or
   executable-semantics document merely because it is authoritative.
8. Distinguish clearly between explicit specification, reasonable
   implementation inference, and an actual specification gap.
9. Do not implement while performing specification scoping unless the parent
   task explicitly asks for implementation.

Return a compact list of the authority sections consulted and the rule each
one establishes.
