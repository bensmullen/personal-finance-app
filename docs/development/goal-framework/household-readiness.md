# Exact-candidate household evidence

GF-04 #366 implements the collection and refusal boundary for GF-R13, GF-R15
and GF-R16. The [household registry](households.json) records the current
applicability inventory and its original requirements. The supported
no-investments state and the later #108 alpha persona of similar shape have
different acceptance criteria. The #108 gate retains all eight households and
four independently saved plans per household under #105.

## Collect completed evidence

Run the collector once from a trusted, reviewed tooling checkout outside the
Codex implementation turn. Use a read-only GitHub credential for Actions,
checks, issues, contents and pull requests. Obtain the open PR, current base and
provider merge commit from GitHub. The collector rechecks the PR after
collection, verifies the live V3 issue digest and proves the merge commit's
ordered parents. A newer candidate
requires its own collection and review. The latest commit on a feature branch
is insufficient if the integration check applies to different bytes.

Prepare a trusted selection JSON with the following fields. Pin raw Git blob
SHA-256 digests from independently reviewed artifacts and the exact candidate.
Apply the reviewed router to the candidate to determine the selected gates.
Select manual evidence only from the approved engineering workflow. The
collector does not execute the router, PR code, artifact contents or commands
from the selection.

| Field | Required identity |
| --- | --- |
| `task` | Repository, `goal_issue`, `goal_revision`, `goal_control_digest`, `task_issue`, `task_revision` and saved `issue_body_digest`. |
| `implementer` | Trusted `actor` and `session` for independence checks. |
| `candidate` | PR number, `head_sha`, `base_sha`, `merge_candidate_sha` and `verification_plan_digest` using the GF-01 canonical digest of the ordered plan. |
| `workflows` | GitHub workflow numeric `id`, repository `path` and trusted raw-byte `digest` for the ordinary and/or manual workflow. |
| `inputs` | Candidate `path` and raw-byte `digest` for the lockfile, Playwright config, router, shard planner, diagnostic reporter and quiet wrappers, registry, manual spec, guided inputs and S8-5A oracle. Include any additional source or configuration material to the particular decision. |
| `plan` | One row per workflow job, keyed by globally unique `id`, with numeric `workflow`, exact `job` name, `selection` (`selected` or `excluded`), `required` and `artifact_required`. Specify the exact `artifact` name and optionally required `files` when an artifact is required. |

The ordinary inventory is verification-plan, spec, architecture, codex-tooling,
typecheck, build, forecast-feasibility, test, deploy, all three unit shards
and all four E2E shards. Mark workflow-proven omissions explicitly. Selected
unit and browser shards require their existing exact-merge-SHA diagnostics.
The manual inventory is validate, household-readiness and agent-incident.
The selected manual row uses ID `household-readiness` and artifact
`household-readiness-{run}-{attempt}` with `inventory.json`, `report.json`,
`resources.json`, `resources.txt`, `guided-desktop.png`,
`guided-mobile-200.png` and `guided-trace.zip`. Incident execution is a
failure observation.

`node tools/ci/goal-framework-evidence.mjs collect TRUSTED_SELECTION.json docs/development/goal-framework/households.json`
writes the compact collection and `UAT_READINESS_V1` to standard output.
Complete provider observations also include a pending `VERIFICATION_EVIDENCE_V1`
draft compatible with GF-01. Exit
status 2 is the refusal or pending-review outcome. The CLI has no authenticated
review channel. A trusted coordinator can call `householdReadiness` with
independently authenticated semantic and visual reviews. Each review binds
the complete candidate, current collection, registry, every applicable household
and corresponding artifact references. PM acceptance is a separate
authenticated decision.

GitHub must authenticate the selected job through its Actions check suite at
the exact integration SHA. A job with the right title, or a success JSON
downloaded without the correct provider record and archive digest, cannot close
the check. If GitHub only exposes a PR-head check with no integration-bound
check, record the integration evidence as incomplete. Older shard names can be
overwritten on reruns. Their historical attempt association is unknown and
blocks reuse. The collector retains every provider attempt and bounded
test-level failures or retries it can verify. Later green results do not clear
earlier defects or failure evidence. Candidate changes, uncertain pagination
and missing, expired or over-budget data require a new determination by the
reviewer. Collection never dispatches or polls a job.

The collector retains compact run, check, disposition, checksum, capture and
expiration metadata. It follows one allowlisted HTTPS storage redirect without
forwarding GitHub credentials. It bounds requests, compressed bytes, inflated
files and total inflated bytes. It rejects unsafe ZIP paths and file types,
ambiguous ZIP metadata, invalid checksums and duplicate JSON keys. It does not
extract archives to disk. Nested Playwright traces are opaque attachments
bound by checksum for independent review. Keep durable acceptance attestations
and references to the original immutable artifact. An expired artifact is
unknown for a new review even if an earlier decision retained its reference.

## Run the manual Chromium profile

After selected ordinary CI, a reviewer can schedule the
`engineering-validation / household-readiness` profile once on an authorized
ref that points to the exact integration commit. A run dispatched on a feature
ref resolves that ref's commit and can provide diagnostic evidence. Only a run
at the integration SHA satisfies exact-candidate collection.

The workflow first compares ordinary discovery, exclusive household discovery
and the existing UX opt-in. Ordinary tests retain their existing identities.
The four normal-user cases use one Chromium worker and no Playwright retries.
They cover initialization, exact input/export amounts, accessible income
navigation, keyboard entry, edit/cancel/discard, saved reload on desktop,
mobile with 200% text, and fresh household/plan stores in both fixture orders.
The guided fixture verifies stored inputs and ownership. The registry points
to the existing real compiler, worker, chart-period, stale/rerun, partial/error
and source-qualified replay witnesses for the different runtime boundaries.

A single repository-wide profile concurrency group, a 12-minute runner
timeout, five-minute browser process deadline, 2 GiB Node heap, process and
file limits, 12 MiB upload budget and seven-day retention bound the profile.
The dedicated hosted runner keeps expensive execution away from foreground
development and UAT. The artifact includes Node and configured limits plus
elapsed time, CPU and peak RSS reported by GNU time for the measured command.
That RSS figure does not measure simultaneous process-tree peak, runner idle
cost or host-wide memory. No baseline CPU, memory, browser or CI timing
measurements were available in this implementation checkout. Existing S8-5A
source cohorts remain the separate resource witness for issuer reads and source
bytes. The 12- and 24-installment HELOC fixtures carry 66 and 276 prior
repayment rows respectively, which describes fixture size rather than measured
runner cost.

## Baseline readiness observation

The implementation worktree began at
`b9bd4024f42792da13d4e8ab25c3cdb42250e5c0`. At that exact checkout, source
inspection identified the merged S8-5A witness from PR #361 and the ordinary
browser evidence definitions listed in the registry. The task hooks supplied
the live V3 authorization and blocked direct GitHub CLI evidence reads.
The baseline therefore has no authenticated PR integration candidate, artifact
IDs, runtime measurements or independent visual review available to this turn.
Its pre-UAT disposition is **NOT_READY**. The tracked definitions establish
which evidence to request and which gaps to report.

The outstanding product boundaries include readable V6 retirement income
sources and guided source-to-forecast proof under #120, and end-to-end
source-qualified application composition under #149. The test-only #331
witness supports the original issuer, exact posting and replay boundaries in
its declared scope. Screenshots require independent review in the real
application against the approved visual target, along with the remaining
financial discrepancies. PM questions become eligible after those reviews
and required capability coverage are complete.
