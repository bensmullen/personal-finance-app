# Verification Policy

**Status:** repository-enforced  
**Purpose:** choose verification from failure risk and changed surface without spending Codex runtime supervising tests.

## 1. Responsibility boundary

Codex implementation and repair turns edit code only. They do not run tests,
typecheck, builds, validators, benchmarks, dev servers, stochastic/convergence
runs, onboarding dry runs, or package installation. Consequently Node/npm and
installed dependencies are not implementation-start prerequisites. A desktop
Local Environment may prepare them for developer convenience, but GitHub Actions
remains the verification authority.

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

**Roadmap metadata exception (narrow and fail-closed):** the manifest also contains
non-executable roadmap record metadata. If the **only** changes to
`docs/spec-manifest.json` are the `version` and `keywords` of the existing
`post-pr21-implementation-roadmap` planning record, after checking both Git
revisions, run spec/traceability validation without treating that as a runtime
contract change. The separately changed issue register and unit tests still run
their normal unit/typecheck gates. Any other manifest change, unreadable base,
missing metadata, or changed runtime version conservatively selects the full
runtime matrix. No change to a tax/model/financial specification is exempt.

**Parallel E2E:** real runtime/UI/E2E changes run the full Playwright suite in
two independent GitHub-hosted shards. A failed or cancelled shard fails the
aggregate `test` job; each shard uploads distinct failure artifacts. This
reduces elapsed test time without dropping cases. The existing 20-minute per-job
ceiling remains damage containment, not a performance allowance.

The aggregate job remains named `test` for branch protection.

Ordinary unit and E2E jobs have explicit 20-minute damage-containment ceilings.
These are not performance budgets and must never be used as correctness
thresholds. A timeout is process evidence requiring diagnosis, not permission to
raise the ceiling or weaken the workload blindly.


### Independent UX evidence (manual, not a new required CI gate)

For substantial journey/interaction changes, ChatGPT or a separate reviewer may use `.github/workflows/ux-evidence.yml` (**Actions → UX evidence (manual) → Run workflow**, select the exact PR branch/head). It runs `e2e/ux-evidence.spec.ts` only under `PFM_UX_EVIDENCE=1`, using an isolated synthetic example and fixed 1440px/390px captures of overview, income/edit, investments, debt and plan. The workflow is single-worker, retry-free, time-bounded and uploads 14-day screenshot/diagnostic artifacts on success or failure. Ordinary selected Playwright E2E remains unchanged; the manual spec is skipped in ordinary CI. A workflow update itself still gets the existing conservative CI routing.

Capture a baseline before UX design and a changed-head comparison after implementation when warranted. The screenshots are review evidence, not automated proof of usability, accessibility, financial correctness or PM acceptance; browser interaction and uncoached UAT remain independently necessary. Do not capture users' real models, live connected financial accounts, secrets or external source records. Capture once per meaningful version, avoid repeated runs/polling, and document exact commit/ref reviewed. Codex must not start a browser/dev server or monitor this workflow during its implementation turn. If the manual workflow cannot access a needed state, state the limitation and use a separate authorized reviewer rather than relaxing the Codex execution policy.

## 3. Task risk profiles

ChatGPT may describe a semantic/risk profile in the handoff when it helps Codex
and later audit understand expected failure classes. Profiles are planning
vocabulary, not prompt-hook syntax requirements. CI remains independently
conservative based on changed surfaces.

Useful profiles include:
- `docs-only`: non-normative documentation;
- `tooling`: hooks/skills/agent/CI tooling;
- `spec`: normative specification/traceability;
- `deterministic`: deterministic engine/application behavior;
- `deterministic-interactive`: worker/cache/UI state and E2E concerns;
- `engine-equivalence`: optimization requiring result/order/fingerprint equivalence;
- `tax`: effective-dated rule/boundary/invariant behavior;
- `stochastic-foundation`: seeded single-realization reproducibility;
- `stochastic-orchestration`: scheduling-independent identities, bounded aggregation and cancellation;
- `onboarding`: extraction/provenance/conflict/privacy plus UAT;
- `provider-adapter`: fixture/replay mapping/provenance and controlled live evidence;
- `probabilistic-ux`: stochastic/deterministic basis/freshness E2E plus UAT;
- `full`: conservative fallback.

Test counts are never selected merely because a profile exists. Tests arise from
changed semantics, failure modes, and affected surfaces.

## 4. Heavy engineering evidence

Use `.github/workflows/engineering-validation.yml` manually after ordinary CI
is green.

Profiles:
- `performance` → `perf:capture`;
- `stochastic` → `stochastic:validate`;
- `onboarding` → `onboarding:dry-run`;
- `provider` → `calibration:integration`.

A profile fails clearly when its script has not yet been implemented.

The CI/heavy boundary is a **base repository rule**, not an active-lesson marker
that every prompt must repeat:

- ordinary CI may run bounded deterministic correctness work;
- full representative, stress, scaling, convergence, onboarding, or live-provider
  workloads belong to engineering-validation when those workloads are selected
  as heavy evidence;
- heavy workloads must not silently migrate into ordinary unit/E2E jobs merely
  because a specification requires the evidence to exist somewhere;
- bounded representative correctness smoke tests remain allowed when their work
  is explicitly constrained and correctness genuinely requires them.

For a task that needs heavy evidence, the semantic handoff should state the
ordinary-CI boundary and the heavy workload clearly enough for audit, but the
prompt hook does not require specific marker strings.

Performance repetition counts and stochastic realization counts must be chosen
from the measurement/convergence objective and observed variance, not from a
permanent arbitrary global count. Expensive reruns remain outside the
coding-model turn.

## 5. Repair loop

Initial implementation is followed by GitHub CI and ChatGPT review.

When CI or semantic audit finds a defect, ChatGPT issues a focused repair
handoff containing the exact failure evidence, authorized edit scope, and
acceptance criteria. Codex does not autonomously broaden the repair or redefine
acceptance.

The task hook does not require a numeric repair-round field. Repair sequencing
is a planning/audit concern; safety continues to come from branch state,
`ALLOWED_PATHS`, dependency policy, and completion enforcement.

## 6. Process-learning incidents

Selected ordinary gates that fail, time out, or are cancelled produce a
structured `agent-incident` artifact from the aggregate CI job when execution
reaches that job. Heavy-validation failures write the same evidence shape into
`engineering-validation-artifacts/`.

An incident is evidence only. CI, Codex, and hooks MUST NOT modify or promote
`docs/development/agent-lessons.json`. ChatGPT reviews evidence under
`docs/development/agent-learning-policy.md`. When that review classifies a
plausibly generalizable candidate, it persists the candidate to the GitHub
candidate registry. Candidate persistence has no direct effect on task
authorization.

## 7. UAT

Automated verification must be green before roadmap-required UAT begins. UAT
validates user comprehension/workflow, not financial arithmetic that can be
tested deterministically.
