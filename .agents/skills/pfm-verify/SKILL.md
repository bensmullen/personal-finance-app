---
name: pfm-verify
description: Interpret GitHub CI/heavy-validation evidence for the Personal Finance App. Local Codex implementation turns do not run verification.
---

# PFM Verification

Verification is external to Codex implementation turns.

## Ordinary verification

GitHub Actions determines required gates from changed paths using the repository
verification planner. It may run specification/traceability/editor checks,
architecture validation, Codex-tooling policy tests, TypeScript typecheck,
unit/property tests, web build, and Playwright E2E.

The aggregate `test` gate is authoritative for ordinary pre-merge verification.

## Heavy engineering validation

Use the manually triggered engineering-validation workflow for expensive work:
- performance/baseline capture;
- stochastic/convergence/resource validation;
- onboarding dry-run instrumentation;
- provider/live-adapter integration when the corresponding script and approved
  secret boundary exist.

Heavy validation never runs inside a Codex coding turn.

Full representative/stress/scaling/convergence/provider workloads assigned to
heavy validation must not silently migrate into ordinary CI. Bounded correctness
smoke coverage remains allowed where explicitly appropriate.

## Failure handling

When a gate fails:
1. inspect the concise CI diagnostic;
2. identify the exact failure class and changed surface;
3. have ChatGPT produce a focused `PFM_TASK_V3` repair handoff with the exact
   failure evidence and narrow `ALLOWED_PATHS`;
4. resume the existing remote PR branch with
   `tools/codex/bootstrap-pr.sh resume <branch>`;
5. do not ask Codex to reproduce the failure locally unless repository policy is
   intentionally changed in a dedicated framework PR.

Never change golden/financial expectations merely to make a gate pass.
