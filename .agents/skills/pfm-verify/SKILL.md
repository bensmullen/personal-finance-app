---
name: pfm-verify
description: Verify a completed Personal Finance App code change with minimal output. Use once near completion, after targeted tests have passed.
---

# PFM Verification

During implementation, prefer the smallest relevant Vitest files.

At completion:

1. Do not rerun a check already proven by an identical final tree unless there
   is a concrete reason.
2. Run the repository Codex verification wrapper: `npm run codex:verify`.
3. If it passes, do not inspect stored test logs.
4. If it fails, inspect only the reported failing checks/tests first.
5. Open a full stored log only when the concise failure output is insufficient
   to diagnose the problem.
6. Never modify golden expectations solely to obtain a passing result.
7. Do not repeatedly run the full suite while iterating.

Report only:

- PASS/FAIL for each verification gate;
- failed tests or diagnostics if any;
- whether the final tree was fully verified.
