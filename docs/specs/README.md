# Personal Finance App — Specification Tree

This directory is the decomposed specification tree below the top-level architecture and the existing canonical/executable financial authorities.

## Retrieval rule

Start with docs/spec-manifest.json. Select specifications by domain/keyword and follow parent_spec_ids only as far as the task requires. For requirement-level work, use verification/requirements-index.json to find ownership, planned verification, and implementation scope.

Do not preload every specification for routine work.

## Authority summary

- Canonical financial schema: authoritative financial vocabulary and invariants.
- Executable financial semantics: authoritative runtime/economic behavior.
- Capability specifications in this tree: bounded requirements that refine but cannot contradict the two authorities above.
- Vertical-slice/milestone specifications: implementation increments.
- ADRs: implementation choices.
- Code and generated artifacts: conforming implementations/derivations.

The architecture/governance documents control decomposition and retrieval but do not redefine financial meaning.

## Current capability outlines

- capabilities/performance-and-execution.md
- capabilities/probabilistic-forecasting.md
- capabilities/market-economic-calibration.md
- capabilities/portfolio-concentration-and-equity-compensation.md
- capabilities/application-ux.md
- capabilities/tax-engine.md

## Planning and verification

- roadmap/post-pr21-implementation-roadmap.md
- verification/requirements-index.json

These outlines deliberately identify unresolved design decisions instead of inventing financial behavior. Detailed implementation specifications may refine them before code is written.
