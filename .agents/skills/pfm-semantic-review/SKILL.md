---
name: pfm-semantic-review
description: Perform a focused financial-semantics and invariant review of an implementation or diff. Use for merge-readiness or semantic audits, not normal implementation.
---

# PFM Semantic Review

Review the requested diff or changed files first.

Use `$pfm-spec-scope` only for financial concepts whose governing rule must be
verified.

Check specifically for:

- recognition versus settlement duplication;
- invalid authoritative-state mutation;
- failed-run atomicity;
- implicit funding;
- accounting imbalance;
- account/position double counting;
- currency or unit loss;
- binary floating-point financial arithmetic;
- implicit temporal assumptions;
- unstable occurrence/idempotency identity;
- observed/modelled provenance confusion;
- non-deterministic behavior;
- incorrect golden-test changes.

Do not perform an unrelated repository-wide refactor review.

Report only actionable findings. For each finding give:

- severity;
- file/symbol;
- violated invariant or specification rule;
- concrete failure mode;
- required correction.

If no material issue is found, say so directly.
