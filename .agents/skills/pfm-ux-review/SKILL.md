---
name: pfm-ux-review
description: Scope and review PFM user journeys, interaction contracts, visual evidence and usability acceptance without adding open-ended Codex implementation work.
---

# PFM UX design and review

Use for substantial normal-user navigation, onboarding, authoring, diagnostic, or forecast-presentation changes. Read only the affected UX sections of `docs/specs/capabilities/application-ux.md` (especially PFA-UX-015–023), the 62-family ownership registry when financial inputs are affected, and the relevant journeys. This skill complements, never overrides, canonical financial semantics, V3 authorization, and the existing CI/UAT gates.

## Review modes

**Before implementation (design-ready):**
1. Name the user's goal, initial knowledge, available evidence, desired insight, task completion state and capability limitations. Use realistic synthetic households (Issue #108) as discovery lenses; they are not evidence of empirical user behavior.
2. Inspect the actual current journey using independent browser/screenshots where available (see `docs/development/verification-policy.md` UX evidence). Record only reproducible root-cause findings; never infer visual quality from JSX or a green test.
3. Resolve navigation, single financial write-owner, read-only mirrors, common/advanced/technical disclosure, required/derived/unsupported states, source/period/provenance, focused editing, recovery and help patterns. A design may never invent legal facts or financial calculation rules.
   - Favor safe visible defaults for ordinary interface choices, and reuse previously confirmed, same-scope long-lived facts without repeated entry. Labeled planning suggestions need explicit acceptance; no silent economic/legal facts or unsupported year-to-year assumptions.
4. Supply a compact approved target: affected screens and task boundaries, annotated before/after screenshots or small interactive reference, important interaction/empty/error states, 390px and 1440px expectations, and an objective task-acceptance checklist. Ask the PM only about consequential vision/product tradeoffs; record approval before large visual changes.
5. Hand Codex that resolved target and narrow `PFM_TASK_V3` issue scope. It implements; it must not design an entirely new flow, reinterpret accounting, run browsers/dev servers, or supervise CI.

**After implementation (independent review):**
1. Compare the current PR against the approved target and same synthetic task/viewport evidence. Check task discoverability, comprehension, input ownership, direct repair, clarity of unsupported/partial results, interaction, responsive layout and accessibility.
2. Separate verified functional/financial failures from subjective usability hypotheses; do not claim an AI role-play is real user evidence.
3. Report `merge-ready`, `needs patch`, or `blocked`; list only actionable defects, impacted journeys, exact evidence, and narrow corrections. Synchronize the original task issue per handoff policy. PM uncoached goal-based UAT remains mandatory when specified.

## Minimal cost and stop rules

- **Small isolated fixes** (copy, alignment, clearly bounded help or spacing with unchanged task/ownership) use existing tests/review; no prototype or entire journey redesign.
- For substantial UX, review **one coherent user journey and its shared components at a time**, not all app screens or every financial field. Use existing tests, screenshots and field contracts before adding new tools.
- One targeted visual evidence capture per target/head is the default. Reuse it across ChatGPT and Codex work. Recapture only for a changed UI head, missing state, failed capture, or a materially affected viewport.
- Use a bounded diagnostic pass, a design decision, then a bounded implementation and review pass. No repeated speculative browsing, no open-ended agent debate, no redundant screenshot suites, no CI polling inside Codex. If the same root UX failure survives two repairs, or scope expands across unrelated journeys, stop and return to PM/design review.
- Browser screenshot/interaction runs execute **outside Codex implementation turns**; visual artifacts don't grant financial authority or bypass CI. Synthetic data only; redact/remove secrets and personal models from artifacts.
- Preserve distinct `current`, `stale`, `incomplete`, `unsupported`, `cancelled` and `error` outcomes in design and review.

## Parallelism and ownership

UX planning, synthetic-household journey research, isolated D2 pure helpers/fixtures, and independent backend work can proceed concurrently when financial semantics and owner interfaces are stable. Assign exclusive ownership of shared UI components, financial field registry/resolver and cross-screen routes; use one integration/merge owner for shared seams. Never parallelize two agents editing the same authoring surface or enable a UI whose backend behavior is still unsupported. Identify prerequisite merges, impacted paths, conflict surfaces and explicit deferred integration before sending independent Codex tasks.
