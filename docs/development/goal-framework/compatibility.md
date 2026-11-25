# GF-06 adapter compatibility

Issue #368 owns this checkpoint. The runner adapter and optional preflight
planner are tooling-only. Continue with operator-run V3 and ordinary GitHub CI.

## Read-only inventory

Observed on 2026-11-25 in the local issue #368 worktree. Installed metadata,
the manual receipt and synthetic tests each describe a different boundary.

| Surface or control | Status | Observation and effect |
| --- | --- | --- |
| Local installation | Verified installation metadata | Desktop bundle version `26.1111.21308`, build `27194`. Bundled CLI metadata `0.169.0-alpha.11.1`, `x86_64-apple-darwin`. Running CLI identity and account binding remain unverified. |
| Local manual V3 | Verified for this worktree | The session hook accepted saved issue #368 for the exact linked branch. Native grant-bound launch, runtime config and tamper-resistant pre-write and post-write enforcement remain unverified. |
| Optional local preflight environment | Unavailable in this worktree | The read-only Node diagnostic found Node 22 and npm on PATH. TypeScript and Vitest were absent. npm 10, installed toolchain integrity, host allowance and a supervisor-bound exact-command path remain unverified. |
| Local native execution | Unverified | No independently authenticated start/terminal identity, separate worker/observer/control/merge credentials, native hard cap, watchdog/host limit, model/effort controls, quota/context coverage, artifact persistence, or late billing evidence. |
| Cloud native execution | Unverified | No authenticated native control/observer transport is exposed to this task. Cloud runtime/configuration, scope fences, credentials, model/effort, quotas, native cap, cancellation and artifact retention need separate evidence. |
| Goals and subagents | Disabled in this profile | V1 exposes no delegation or merge operation. Local project configuration keeps Goals and multi-agent features disabled. |

Documented candidates include [CLI, SDK and app-server](https://developers.openai.com/blog/codex-as-a-platform),
[Goals and continuation](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex),
[Codex Cloud](https://help.openai.com/en/articles/20001545-using-codex-cloud) and
[plan-specific usage limits](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan).
The inventory used no native launch, stop, paid probe or API fallback.

## Supervisor contract

`createRunnerAdapter` returns versioned probe, prepare, launch, observe,
stop, checkpoint and resume results. The inventory port supplies current
read-only observations, pinned configuration, transport and permission
identity, and authenticated capability evidence. Lookup ports read GF-03
lifecycle and GF-05 accounting. The verifier, clock, provider credentials
and durable effect port belong outside the worker context.

A future native effect port must atomically revalidate the current issue,
approved merged control/parser revision, runtime, workspace, head, grant,
scope, reservation, capacity and kill switch while acquiring the global
writer fence. Persist GF-05 admission intent before the native call and
prevent writes until GF-03 binds the actual run and claims the writer.
Reconcile repeated intents. Authenticate observer events against the exact
reservation and native run. Retain possible liability and ownership through
expiry, a cancellation request, credential loss or an offline host. Release
the writer only after independent terminal proof. Reconcile late usage in
GF-05 through settlement. Checkpoint reconciles the current GF-03 publication
intent using its expected-head fence. Resume requires a stopped worker, clean
published checkpoint and fresh grant on the same lineage. Cloud admission
also requires local certification. Runtime, permissions, hook or profile
changes require fresh evidence.

The grant names `RUNNER_CAPABILITIES_V1` and the reservation names the
distinct GF-05 registry profile. The grant pins `RUNNER_PROFILE_BINDING_V1`
to authenticate the two references against the exact installed tool,
runtime identifier, model, effort, credentials, config, permissions,
merged parser/control revision, reservation and workspace fence. GF-05
resolves the registry profile at reserve and begin. Existing unbound grants
require fresh issuance for live use. The synthetic composition fixture uses
both journals and exercises cross-surface resume. Actual native execution
on both surfaces still requires independent certification.

## Optional preflight and next gates

Host prepare can record eligibility before writer admission or a patch.
With a worthwhile approved profile, verified environment, free foreground
capacity and bounded allowance, the planner selects full typecheck and one
directly affected tracked unit. It rechecks the exact patch, active grant,
tool and lockfile before the current hook can reserve an attempt. Optional
dependency preparation belongs to the operator or supervisor on an idle,
clean worktree.

`LOCAL_PREFLIGHT_DECISION_V1` stores the binding and finite reason.
`PFM_LOCAL_PREFLIGHT_ADVISORY_V1` references that decision and the protected
receipt. A never-invoked check is `NOT_ATTEMPTED`. An invocation without
verifiable host evidence is `NOT_OBSERVED`. A matching observed interruption
seals `INCOMPLETE` and its diagnostic references. The
helper keeps the shared 60-second compiler and 30-second unit budgets,
records phase timings and case progress in one private stream, and caps
the aggregate runner log at 1 MiB. The existing hook owns merged-tool
equivalence, attempt reservation and result capture. GF-04's exact-candidate
acceptance inputs are independent.

CI owns the synthetic adapter and hook regressions. A separately authorized
canary on a reviewed trusted revision must establish actual local control
and credential separation, hard resource limits, terminal proof, late
usage and artifact survival within a finite budget including cleanup.
Cloud requires its own evidence, including reconciliation where work
continues after cancellation. GF-06/P3 hybrid acceptance and GF-07 dispatch
require both certifications. GF-09 can compare measured phase time, CI
runner minutes, avoided retries, host cost and acceptance latency before
changing defaults.
