---
name: pfm-verify
description: Full local repository verification for the Personal Finance App. Use only when explicitly requested, when CI is unavailable or failing, or when a broad/cross-cutting change cannot be adequately checked with focused verification. Do not invoke for routine localized patches.
---

# PFM Verification

This is an escalation skill, not a normal completion step.

Before invoking it, identify the concrete reason full local verification is
necessary. Routine patch completion is not sufficient; GitHub CI is the
authoritative broad pre-merge gate.

During implementation, prefer the smallest relevant Vitest or Playwright
target and do not rerun a passing check unless relevant code changed.

When full local verification is justified:

1. Do not rerun a check already proven by an identical final tree unless there
   is a concrete reason.
2. Run `CODEX_ALLOW_BROAD_VERIFY=1 npm run codex:verify`.
3. If it passes, do not inspect stored test logs.
4. If it fails, inspect only the reported failing checks/tests first.
5. Open a full stored log only when the concise failure output is insufficient
   to diagnose the problem.
6. Never modify golden expectations solely to obtain a passing result.
7. Do not repeatedly run the full suite while iterating.

Report only:

- why full local verification was necessary;
- PASS/FAIL for each verification gate;
- failed tests or diagnostics if any;
- whether the final tree was fully verified.
