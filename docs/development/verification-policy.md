# Verification Policy

**Status:** repository-enforced  
**Purpose:** choose verification from failure risk and changed surface without spending Codex runtime supervising tests.

## 1. Responsibility boundary

Codex implementation and repair turns may optionally use the sole audited
bounded helper after #218 merges (PM approval 2026-10-21):
`node tools/codex/limited-local-verification.mjs`, optionally followed by one
directly affected tracked `test/name.test.ts`. The hook verifies the named file
contains tests and either changed itself or directly imports changed source.
It runs the complete package typecheck API (`tsc --noEmit` then
`tsc -p tsconfig.next.json`) within 60 seconds total, then that unit file within
30 seconds. It invokes local binaries directly, avoiding npm lifecycle hooks.
One simple tool call per coherent patch; at most one correction retry after
FAIL, requiring changed content and the same test. PASS/SKIP cannot authorize
retry. Reservations count even if interrupted; logs and compact PASS/FAIL/SKIP
receipts live in ignored `.codex/logs`. No flags, wrappers, shell chaining,
arbitrary test selection, installers or alternate runners. The helper must
match merged `origin/main`; it is prohibited in its own implementation turn.
Missing Node/npm/node_modules causes a clear SKIP (no startup requirement).
PASS is feedback only and never sets acceptance status.

All other local tests, builds, validators, benchmarks, dev servers,
stochastic/convergence runs, onboarding dry runs and package installation remain
prohibited. Consequently Node/npm and
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

**Static type-contract prevention:** Before handing off typed fixtures or overloaded simulation interfaces, review called signatures and `exactOptionalPropertyTypes`. Record expected API shapes. Optional bounded preflight offers early feedback; CI typecheck remains independently authoritative and parallel with spec, architecture, tooling, unit and build.

**Quiet runner failure truth:** Unit runs must fail if either Vitest's process exits nonzero or its JSON report reports failure. When those disagree, preserve the nonzero failure and emit the process exit code, signal, spawn error and human reporter output in CI artifacts. Never convert `0 failed tests` into a green status without confirming clean process exit.

**Balanced complete inventories (#224):** selected unit/property tests run in
three independent matrix jobs, retaining Vitest's threads pool and
`fileParallelism:false`. Each runner discovers the complete tracked Vitest file
inventory at its checkout, then runs only its exact include list. Selected E2E
runs in four independent jobs. Each discovers all ordinary Playwright cases via
the pinned reporter API, preserving the config's manual UX-spec exclusion.
Playwright resolves the assigned `--test-list` again before browser startup;
ordinary `--shard` must not be combined with these lists. Exact result identities
must match the assignment after execution too. New and renamed tests always
enter discovery; timing data never selects coverage.

`tools/ci/plan-test-shards.mjs` packs longest estimated duration first with
code-point identity/group ordering and lowest-index shard tie-breaking. Serial
Playwright suites conservatively keep their entire project/file together. The
pinned 1.63 reporter's internal suite mode is guarded; API drift fails discovery
instead of silently splitting a serial suite. Non-ASCII titles are preserved.
The planner rejects duplicate identities, invalid costs, incomplete unions,
split serial groups and empty selected shards. Per-runner assignment artifacts
include the inventory, all lists, counts, estimates and immutable checkout SHA;
the aggregate compares their full partitions to detect cross-runner drift.

`tools/ci/test-duration-baseline.json` is a version-controlled, non-sensitive
synthetic seed. Its initial 30s/file and 120s/case unknown costs and heavier
Golden estimates are conservative scheduling estimates, **not measured
performance claims**. Historical PR #207's unit job was 5m35s, E2E jobs 1/2
3m18s/2m17s, with jobs 3/4 cancelled at 20m. These job times do not provide
per-case measurements. A reviewer may explicitly update exact identities and
positive millisecond costs using retained evidence; CI never commits timing
data. Stale keys are ignored and unseen identities receive the unknown cost.

Four-way inter-runner parallelism is retained, with **one Playwright worker per
runner**. `fullyParallel:CI`, retries=1, the real browser Worker and `next dev`
webServer remain. #207's Node 649-month evidence measured ~1.17 GB post-run heap,
not browser peak memory. Combined with two opaque 20-minute cancellations, this
supports a conservative contention bound, not a claim of measured browser
speedup. Browser CPU/peak memory and critical-path improvement remain reviewer
measurements. Do not split journeys or repeat expensive fixture computations
to improve estimated balance.

**Durable diagnostics and failure truth:** quiet wrappers spawn asynchronously
and stream bounded output to an on-disk log (8 MiB maximum), with progressive
identity/start/completion/retry/status events in `progress.jsonl` and compact
named progress in Actions logs. An execution receipt exists before discovery;
a hard kill leaves an explicitly incomplete receipt and the last known case.
The runner sends SIGTERM to the process group after at most 15 minutes of test
execution, or minute 18 of the job budget including setup/discovery, whichever
comes first, then SIGKILL after ten seconds if needed. The unchanged 20-minute
job limit leaves upload headroom where infrastructure permits. Cancellation
and deadline expiry are hard failures even if reported assertions passed.
Infrastructure killing the entire job can still prevent uploads; no receipt
or missing artifacts can prove success.

Per-file unit and per-test E2E `durations.json` records identities, durations,
attempt and status; `execution.json` includes exit/signal, cancellation/deadline
context, run attempt, timestamps, exact SHA and structured-report validity.
Progress contains only timing/identity/status. Raw reports/logs and retained
failure traces are synthetic CI diagnostics; do not run these workflows on
personal financial data or add financial values/secrets to timing baselines.
Each shard uploads diagnostics using `always()`, distinct shard/SHA names and
seven-day retention, including successful measurements. Browser failure traces
are separate artifacts. Missing reports, empty execution, partial workers,
unexpected/skipped browser results, report/assignment mismatch, unhandled
runner errors and nonzero/signal process outcomes cannot become success.

The selected matrix result must succeed and the aggregate additionally requires
one exact-SHA passed, clean-exit, valid-report receipt from **each** of the three
unit/four E2E children. Missing, cancelled, failed or unexecuted children fail
the branch-protected `test` gate and block deployment.

Before merge, the independent reviewer must inspect exact-head selected CI,
complete inventory counts and union/dedup evidence, all four successful E2E
children, negative gate coverage, maximum job wall time and total runner-minutes
against the historical baseline above. Improvements are targets, never grounds
to waive assertions. A single full-horizon Golden case exceeding containment
is a product/performance blocker on #181, not CI success. Framework #224 does
not repair or approve PR #207; reintegration and its exact-head gates belong to
the reviewer after this framework merges.

The four shards wait for successful selected typecheck, build and forecast
feasibility jobs. `always()` handles optional skipped upstream jobs; cancellation
or any selected failure/skipped result prevents browser startup. The aggregate
still requires every selected gate, including feasibility and all four shards.
Docs and tooling-only paths select no E2E. No fast check runs inside shards.

**Early forecast feasibility:** hot-path/horizon changes select one parallel
job with 8- and 20-month synthetic forecasts, no warmups or ratio assertions.
Each subprocess has a 30s ceiling and 512 MiB V8 heap cap; the job has a 4-minute
ceiling including setup/install/artifact overhead (at most four added runner
minutes; two probes consume at most one minute). This is damage containment,
not an absolute performance SLA or a total-RSS guarantee. Disabled selection
starts no runner and costs zero additional runner minutes. UI-only and docs
changes do not select it; unknown/toolchain policy changes conservatively do.
Artifacts record exact checkout head, runtime, process outcome, wall/sample heap,
real status/period count, capability diagnostics and existing phase counters.
Unavailable worker/reference measurements remain `not measured`. A failed
smaller probe stops progression and blocks E2E; diagnostics are retained even
on failure. No 120/360/649 probe enters ordinary CI.

The aggregate job remains named `test` for branch protection.

### Prevention-first CI and test-contract review

Before authorizing a product or repair implementation, the ChatGPT planning layer
performs a **targeted CI-impact preview**, using the proposed edit paths, current
verification routing, affected existing tests, shared selectors/fixtures, and
the actual product/specification contract. The handoff identifies expected CI
gates and likely incompatibilities (typing/build, navigation/accessible names,
layout/viewport, state/ownership, financial meaning, persistence, and async
readiness) when relevant. Anticipate a coordinated test update **only** when the
approved behavior changes; preserve tests for unchanged behavior. Record
non-obvious risks briefly in the issue, not in repetitive global boilerplate.
This is a pre-handoff reasoning check, not an additional runner or Codex gate.

**Large-payload redundancy prevention and semantic audit:** For changed
multi-period, high-cardinality, cached, persisted, API/worker or diagnostic
representations, the author and independent ChatGPT reviewer SHALL check for
repeated sizable identical content *before* it is multiplied across records or
sent to a different process. Inspect the producing and receiving boundary,
not only the grouped UI. Require a synthetic bounded test of one source reused
by many records (including tampered/missing reference negatives), and confirm
serialization/persisted-byte growth tracks the true unique content plus
lightweight occurrences, not the full content times occurrence count.
Compare relevant before/after byte counts and counts of records, unique
sources, and repeated identities when material. Preservation of every
occurrence, provenance, exact qualification/replay proof and unchanged
financial outputs is a correctness gate. A compact hash must not masquerade as
full original content, and digest collision/trust/immutability scope must be
addressed. A deliberate repeated copy is permissible only if demonstrably
small/bounded and the design rationale is documented. Do not log raw catalogs,
financial inputs, portable proofs or personal data. Distinguish uncompressed
wire/test serialization from heap, retained storage and disk; measure those
separately rather than relabeling. Use a baseline or workload-specific budget
approved by the owner; do not invent a universal byte cap or relax tests to
avoid finding duplicate payloads. Tiny deterministic regression fixtures
belong in ordinary CI; representative long-horizon/peak-heap measurement is
reviewer-owned heavy validation, not a Codex local test or extra default E2E.

**Acceptance assertion provenance:** Behavioral, accessibility, financial,
boundary, error-state, and meaningful responsive-layout invariants belong in
automated tests. Every new or changed exact numerical geometry constraint,
string/casing assertion, DOM/selector dependency, or screenshot pixel comparison
must have a product/specification/accessibility invariant or a documented
measurement rationale. Do not turn a qualitative request such as "bars close
together" into an unapproved `<= 1px` gap gate. Prefer relative layout
properties, observable functionality and accessible roles/labels over arbitrary
pixel-perfect or implementation-coupled checks. Exact mathematical alignments
(e.g. positive/negative bars originating at a true zero baseline), precision
boundaries and explicitly approved visual constraints remain legitimate: measure
in the correct coordinate system and justify any tolerance without masking
real defects.

Use independently runnable E2E acceptance flows for unrelated outcomes, with
bounded reusable fixtures, while preserving at least one holistic journey and
the full aggregate CI gate (active AL-004). A test that fails on an old UI label,
hidden DOM structure, or obsolete navigation is **not automatically obsolete**:
first determine whether its underlying user-facing requirement still applies.
For a real obsolete assertion, record the superseded requirement, remove or
rewrite the assertion, and preserve equivalent surviving financial, workflow,
accessibility and error-recovery coverage. Do not silently skip, weaken, or
delete an inconvenient failing test.

**CI/test grooming:** Trigger a targeted review after a repeated same-cause
CI failure or a changed user journey invalidates existing tests. Also review
recent failure clusters and test age/ownership opportunistically about monthly
or after roughly ten substantive UI PRs, whichever comes first; this is an
owner/reviewer checklist, **not** a scheduled GitHub test run or mandatory merge
barrier. Inspect only frequent offenders/changed surfaces first. Classify each
case as real regression, obsolete expectation, brittle assertion/locator,
unstable fixture/readiness, or workflow/environment issue. Resolve the
smallest evidence-backed cluster, benchmark runner-minutes and shard critical
path, and avoid churn in stable tests. CI incident artifacts are inputs, not
automatic deletion or autonomous repair authorization.


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
- `forecast-scaling` → bounded progressive 8/20/120/360/649 probes (120s and
  2048 MiB V8 heap per probe; stop at the first failure). Each success records
  repeat-execution equality of the full read model without retaining financial
  values, plus compiled-kernel summary/frozen-reference equality of status,
  horizon, state, primitive state, metadata, diagnostics and summarized periods
  using the existing R3 contract. Application tax-participant and worker
  equality remain explicitly unmeasured and separately owned by #181.
  Full 649-month success and financial equality remain mandatory #181 evidence;
  neither feasibility nor an `incomplete` full-horizon result closes that gate;
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

This prevention implements the bounded static-check direction in candidate
[#134](https://github.com/bensmullen/personal-finance-app/issues/134) and ownership
direction in [#217](https://github.com/bensmullen/personal-finance-app/issues/217).
ChatGPT reviews #134's state after merged green evidence; candidate curation and
the lesson ledger remain unchanged by Codex. Active AL-002 keeps task bodies
compact, AL-003 requires one push then end without CI supervision, and AL-004
preserves independent acceptance flows plus holistic integration coverage.

**Receipt integrity:** `save_state()` publishes one hash-bound latest receipt;
Stop compares that receipt's authorization with the current turn. Previously
any activation could replace it. #181's clean synchronized `da610a3` does not
prove why replacement occurred; another session remains a hypothesis because
local runtime evidence was unavailable. Activation now rejects active foreign
sessions and invalid receipts before any checkpoint/write. Same-session resume
retains provenance/scope checks; stale Stop never succeeds or replaces an owner.
The diagnostic reports exact worktree/branch/session and read-only inspection
commands. Preserve receipts, dirty files and unpushed commits. Have the owning
session stop normally; ambiguous ownership requires a fresh operator-bootstrap
worktree and authorized new task after proving clean/upstream-synchronized
state. Never delete latest-task.json, force-push, reset or rebase as recovery.

Initial implementation is followed by GitHub CI and ChatGPT review.

When CI or semantic audit finds a defect, ChatGPT first inventories **all
failed selected gates and failing test cases across every CI shard/retry** for
the exact head. For each UI E2E failure it reviews the **entire affected
journey**, including setup, branches, every assertion blocked by the first
failure, recovery, related desktop/mobile and keyboard/touch variants, and
shared financial/source semantics. Classify causes with relevant Playwright
reports, traces, screenshots or DOM evidence as needed, distinguishing
confirmed defects, unproven hypotheses, invalid/obsolete expectations,
fixtures/timing and environment/CI failures. A red shard is not a failed-test
count; an unexecuted downstream check is not a pass.

ChatGPT's **single Codex repair handoff MUST cover every currently known CI
failure and identified related latent assertion** in the coherent PR scope:
cause/evidence, narrow authorized path, exact correction, observable acceptance
and original tests/financial invariants preserved. It MUST NOT send a
subset-of-failures patch while other known errors remain unaddressed; first
resolve any missing scope or PM-owned decision, or declare **not Codex-ready**.
Do not ask Codex to choose a root cause from ambiguous possibilities: finish
reviewer-owned diagnosis or provide a narrow evidence-based decision tree whose
outcomes and permitted correction are already decided. After the push,
independently check the next complete exact-head CI and newly exposed failures.
Review CI once per head rather than directing Codex to poll; no green-only
patch, weakened assertions, extra blanket E2E runs, or autonomous scope
expansion. See the evidence-complete UI CI repair handoff in
`docs/development/handoff-authoring-policy.md`.

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
