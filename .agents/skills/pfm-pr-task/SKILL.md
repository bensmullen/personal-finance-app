---
name: pfm-pr-task
description: Execute a standardized Personal Finance App PR implementation or repair handoff with deterministic repository-state preflight, bounded discovery, focused verification, and a two-round repair loop breaker.
---

# PFM PR Task Execution

Use this skill when the task is supplied as a PR handoff envelope or explicitly
asks to implement/repair one PR.

## Expected envelope

The handoff should provide as many of these fields as apply:

- `MODE`: `surgical`, `local`, or `cross-cutting`
- `REPO`
- `PR`
- `EXPECTED_HEAD`
- `REPAIR_ROUND`: `0` for initial implementation; `1` or `2` for repairs
- `OBJECTIVE`
- `AUTHORITATIVE_REQUIREMENTS`
- `EVIDENCE`
- `ACCEPTANCE`
- `EXPECTED_SURFACE`
- `OUT_OF_SCOPE`
- `VERIFY`
- `DONE`
- `STOP`

Do not expand a precise handoff into a repository-wide rediscovery exercise.

## 1. Preflight repository state

If `EXPECTED_HEAD` is supplied, run:

`npm run codex:state -- --expected-head <EXPECTED_HEAD> --require-clean`

before editing.

- If the expected head mismatches, stop. Fetch/reconcile only when the handoff
  explicitly authorizes it; never assume a different local tree is equivalent.
- If the tree is unexpectedly dirty, stop and report the receipt.
- If the repository/PR identity is inconsistent with the handoff, stop.

Repository state output is authoritative over conversational recollection.

## 2. Bound discovery by MODE

### surgical

The handoff already supplies the diagnosis and expected behavior.

- Start with the named file/symbol and nearest relevant test.
- Normally inspect no more than two production files plus one test file before
  editing.
- Do not read architecture/specification documents or PR history for
  reassurance.
- Do not invoke architecture/semantic review skills or spawn subagents.

### local

The task affects one subsystem but needs discovery.

- Start with targeted symbol/search queries and directly relevant tests.
- Expand only for a concrete dependency or missing fact.
- Use `$pfm-spec-scope` only when a governing semantic rule is actually unclear.

### cross-cutting

Broader reading is justified only when the task crosses architectural
boundaries, changes financial semantics, or has unresolved normative questions.

- Use `$pfm-spec-scope` for the smallest authoritative rules.
- Use architecture/semantic review only when the handoff or risk warrants it.
- Still prefer changed files and targeted sections over whole-document reading.

## 3. Implement the resolved contract

Treat `AUTHORITATIVE_REQUIREMENTS`, `ACCEPTANCE`, and resolved design decisions
in the handoff as the implementation contract unless repository evidence
directly contradicts them.

- Make the smallest defensible diff that fully satisfies the objective.
- Stay inside `EXPECTED_SURFACE` and `OUT_OF_SCOPE`.
- Never invent undefined financial behavior.
- Never change golden expectations solely to make tests pass.
- Do not mix unrelated cleanup into the PR.

## 4. Verification budget

Follow `VERIFY` when supplied. Otherwise run one smallest directly relevant
check.

Preferred commands:

- `npm run codex:test -- <vitest-target> [-- -t ...]`
- `npm run codex:e2e -- <playwright-target> [-- -g ...]`
- a single targeted validator/tooling check when only docs/tooling changed

Do not run a full suite, full E2E, build, typecheck, architecture validation, or
specification validation as a generic completion ritual. GitHub CI owns broad
pre-merge verification.

If CI failed, use its failing gate and concise diagnostic as evidence. Reproduce
locally only when the CI diagnostic is insufficient to patch confidently.

## 5. Repair loop breaker

`REPAIR_ROUND=0` is initial implementation. Autonomous repair rounds are capped
at `1` and `2`.

Stop before attempting a third repair round, and stop immediately if any of the
following occurs:

- the same gate fails again for the same underlying reason after two repairs;
- the attempted repair produces no new commit/SHA progress;
- branch/head provenance cannot be reconciled;
- the fix requires crossing the handoff's architectural scope;
- the authoritative specification is ambiguous or contradictory;
- user acceptance validation is required to determine correctness.

Do not spend additional model/context budget trying variants after a stop
condition. Report the blocker and the exact evidence needed from the user.

## 6. Completion receipt

After the requested changes are committed/pushed, run `npm run codex:state`
again and report only:

- new HEAD SHA and branch;
- changed files;
- material implementation decisions;
- focused verification performed and result;
- CI status if already available;
- any STOP/UAT condition.

Do not restate large specifications or verbose test logs.
