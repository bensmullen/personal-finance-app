# Verification Policy

**Status:** repository-enforced  
**Purpose:** choose verification from failure risk and changed surface without spending Codex runtime supervising tests.

## 1. Responsibility boundary

Codex implementation and repair turns edit code only. They do not run tests,
typecheck, builds, validators, benchmarks, dev servers, stochastic/convergence
runs, onboarding dry runs, or package installation.

GitHub Actions owns ordinary verification. The manually triggered
`engineering-validation` workflow owns expensive evidence. User acceptance
testing remains an explicit human milestone gate where the roadmap requires it.

## 2. Ordinary CI routing

`tools/ci/verification-plan.mjs` conservatively maps changed files to gates.
Unknown/toolchain/CI changes default to the full safe matrix.

- non-normative docs: plan + aggregate gate only;
- agent framework: Codex-tooling policy tests;
- normative specs/schema: spec/traceability/editor checks, with runtime gates
  when canonical/generated contracts can affect execution;
- runtime `src/`: architecture + typecheck + unit/property + build + E2E;
- `ui/`: typecheck + unit + build + E2E;
- `test/`: typecheck + unit/property;
- `e2e/`: typecheck + build + E2E;
- unknown/package/toolchain/workflow changes: full matrix.

The aggregate job remains named `test` for branch protection.

Ordinary unit and E2E jobs have explicit 20-minute damage-containment ceilings.
These are not performance budgets and must never be used as correctness
thresholds. A timeout is process evidence requiring diagnosis, not permission to
raise the ceiling or weaken the workload blindly.

## 3. Task CI profiles

The audited ChatGPT handoff selects the closest semantic profile. This describes
expected failure classes; CI remains independently conservative. The handoff
must also carry the corresponding compact `PROFILE_CONTRACT` markers defined
by `docs/development/handoff-authoring-policy.md`; these capture semantic risks
that path-based CI routing cannot infer.

- `docs-only`: non-normative documentation.
- `tooling`: hooks/skills/agent/CI tooling.
- `spec`: normative specification/traceability.
- `deterministic`: deterministic engine/application behavior.
- `deterministic-interactive`: deterministic behavior plus worker/cache/UI
  state and E2E concerns (for example R2).
- `engine-equivalence`: engine optimization requiring financial/result
  equivalence/property coverage (R3).
- `tax`: effective-dated rule/boundary/invariant behavior.
- `stochastic-foundation`: seeded single-realization reproducibility (R5).
- `stochastic-orchestration`: scheduling-independent identities, bounded
  aggregation/cancellation plus separate convergence/resource evidence (R6).
- `onboarding`: extraction/provenance/conflict/privacy plus UAT (O1).
- `provider-adapter`: fixture/replay mapping/provenance; live-provider evidence
  only in an approved secret boundary (R8).
- `probabilistic-ux`: stochastic/deterministic basis/freshness E2E plus UAT.
- `full`: conservative fallback.

Test counts are never selected merely because a profile exists. Tests arise from
the failure modes and semantics being changed.

## 4. Heavy engineering evidence

Use `.github/workflows/engineering-validation.yml` manually after ordinary CI
is green.

Profiles:
- `performance` → `perf:capture`;
- `stochastic` → `stochastic:validate`;
- `onboarding` → `onboarding:dry-run`;
- `provider` → `calibration:integration`.

A profile fails clearly when its script has not yet been implemented.

Whenever a heavy profile is selected, the audited handoff must define both an
ordinary-CI work boundary and a heavy-work boundary. Full representative,
stress, scaling, convergence, onboarding, or provider workloads assigned to the
heavy profile must not migrate into ordinary unit/E2E gates merely because a
specification requires that evidence to exist somewhere.

Performance repetition counts and stochastic realization counts must be chosen
from the measurement/convergence objective and observed variance, not from a
permanent arbitrary global count. A milestone may define an initial engineering
protocol, but expensive reruns remain outside the coding-model turn.

## 5. Repair loop

Initial implementation is round 0. CI failures are interpreted by ChatGPT.
Every repair gets a new V2 prompt with exact failure evidence and round 1 or 2.
Codex cannot advance the round internally. There is no autonomous round 3.

## 6. Process-learning incidents

Selected ordinary gates that fail, time out, or are cancelled produce a
structured `agent-incident` artifact from the aggregate CI job when execution
reaches that job. Heavy-validation failures write the same evidence shape into
`engineering-validation-artifacts/`.

An incident is evidence only. CI, Codex, and hooks MUST NOT modify or promote
`docs/development/agent-lessons.json`. ChatGPT reviews the evidence under
`docs/development/agent-learning-policy.md`; lesson promotion/retirement is a
separate framework decision.

## 7. UAT

Automated verification must be green before roadmap-required UAT begins. UAT
validates user comprehension/workflow, not financial arithmetic that can be
tested deterministically.
