---
name: pfm-verify
description: Interpret GitHub CI/heavy-validation evidence for the Personal Finance App. Local Codex implementation turns do not run verification.
---

# PFM Verification

Verification is external to Codex implementation turns.

## Ordinary verification

GitHub Actions determines required gates from changed paths using the
repository verification planner. It may run:
- specification/traceability/editor checks;
- architecture validation;
- Codex-tooling policy tests;
- TypeScript typecheck;
- unit/property tests;
- web build;
- Playwright E2E.

The aggregate `test` gate is authoritative for ordinary pre-merge verification.

## Heavy engineering validation

Use the manually triggered engineering-validation workflow for expensive work:
- performance/baseline capture;
- stochastic/convergence/resource validation;
- onboarding dry-run instrumentation;
- provider/live-adapter integration when the corresponding script and approved
  secret boundary exist.

Heavy validation never runs inside a Codex coding turn and does not use an LLM
to supervise long-running computation.

## Failure handling

When a gate fails:
1. inspect the concise CI diagnostic;
2. identify the exact failure class and changed surface;
3. have ChatGPT produce a new `PFM_TASK_V2` repair handoff;
4. increment `REPAIR_ROUND` externally;
5. do not ask Codex to reproduce the failure locally unless repository policy is
   intentionally changed in a dedicated framework PR.

Never change golden/financial expectations merely to make a gate pass.
