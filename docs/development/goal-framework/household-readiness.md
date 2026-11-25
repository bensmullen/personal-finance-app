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
provider merge commit from GitHub. The collector rechecks the PR and live
issues after collection, parses the saved V3 grant, checks its target branch,
and proves the merge commit's ordered parents. A newer candidate requires its
own collection and review.

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
| `workflows` | GitHub workflow numeric `id`, repository `path` and trusted raw-byte `digest` for the ordinary and manual workflows. Use a fully qualified integration `ref` for the manual workflow. |
| `inputs` | Candidate `path` and raw-byte `digest` for the lockfile, Playwright config, router, shard planner, diagnostic reporter and quiet wrappers, registry and all tests, fixtures and oracle paths named by the registry. Include any additional source or configuration material to the particular decision. |
| `plan` | One row per workflow job, keyed by globally unique `id`, with numeric `workflow`, exact `job` name, `selection` (`selected` or `excluded`), `required` and `artifact_required`. Specify the exact `artifact` name and optionally required `files` when an artifact is required. |

The ordinary inventory is verification-plan, spec, architecture, codex-tooling,
typecheck, build, forecast-feasibility, test, deploy, all three unit shards
and all four E2E shards. Mark workflow-proven omissions explicitly. Selected
unit and browser shards require their existing exact-merge-SHA diagnostics.
The manual inventory is validate, household-readiness and agent-incident.
The selected manual row uses ID `household-readiness` and artifact
`household-readiness-{run}-{attempt}` with `inventory.json`, `execution.json`,
`server.log`, `progress.jsonl`, `report.json`, `resources.json`, `resources.txt`, `guided-desktop.png`,
`guided-mobile-200.png` and `guided-trace.zip`. Incident execution is a
failure observation.

`node tools/ci/goal-framework-evidence.mjs collect TRUSTED_SELECTION.json docs/development/goal-framework/households.json`
writes a diagnostic collection and `UAT_READINESS_V1` to standard output with
exit status 2. A trusted coordinator calls
`collectGoalEvidence(input, provider, now, verify)` with the GF-01 verifier
boundary. At `live_selected_evidence_plan`, verify the exact independently
reviewed selection against current goal approval, live goal and task controls,
the saved V3 issue and branch, the candidate, workflow and input pins,
implementer and currently authorized reviewer. The binding includes the live
goal issue body digest for comparison with the host's own authority. Only the
trusted host can supply `verify` and determine freshness and revocation.
Authenticated complete ordinary observations can produce a pending
`VERIFICATION_EVIDENCE_V1` draft. Manual-only observations cannot satisfy
ordinary verification.

The coordinator supplies independently authenticated semantic and visual
attestations to `householdReadiness`. Each attestation names the complete
collection and case/oracle inventory digests, applicable household IDs,
reviewer actor/session, disposition, creation time and expiration. The
trusted verifier checks the authenticated review event, current authority and
revocation at review time. Expired artifacts or attestations block readiness.
PM acceptance requires its own authenticated decision.

GitHub ordinary PR checks attach to the source head. Authenticate the exact
PR/repository/head/base association, workflow, attempt, job and GitHub Actions
check suite there. Separately verify the tested merge SHA from the job's
pinned checkout step in a bounded provider log. For the aggregate `test` job,
also require its successful shard receipt verification step. Manual runs bind
the integration ref and SHA through the run, checkout and profile inventory.
The job title and artifact success JSON cannot establish these identities.
Older shard names can be
overwritten on reruns. Their historical attempt association is unknown and
blocks reuse. The collector retains every provider attempt and bounded
test-level failures or retries it can verify. For a sanitized Vitest failure,
the artifact's bounded runner log can corroborate a timeout on the same
case. An ambiguous test diagnosis stays incomplete. Later green results do
not clear earlier defects or failure evidence. Candidate changes, uncertain pagination
and missing, expired or over-budget data require a new determination by the
reviewer. Collection never dispatches or polls a job.

The collector retains compact run, check, disposition, checksum, capture and
expiration metadata. It follows one allowlisted HTTPS storage redirect per download without
forwarding GitHub credentials. It bounds requests, compressed bytes, inflated
files, total inflated bytes and per-job and total job-log bytes. It rejects unsafe ZIP paths and file types,
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
and the existing UX opt-in. The collector requires the manual run's ordinary
discovery count and identity digest to match the coherent assignment inventory
from all four selected, passing ordinary E2E shards for the same integration
SHA. The count must be a positive safe integer at most 10,000. Missing or
divergent assignments block household readiness. A workflow-proven E2E
exclusion can still satisfy ordinary verification on its own.
The four normal-user cases use one Chromium worker and no Playwright retries.
They cover initialization, exact input/export amounts, accessible income
navigation, keyboard entry, edit/cancel/discard, saved reload on desktop,
mobile with 200% text, and fresh household/plan stores in both fixture orders.
The guided fixture verifies stored inputs and ownership. The registry points
to the existing real compiler, worker, chart-period, stale/rerun, partial/error
and source-qualified replay witnesses for the different runtime boundaries.

A single repository-wide profile concurrency group and a 12-minute isolated
runner bound CI use. The supervisor runs ordinary Next dev on loopback and
starts Chromium after a successful HTTP response from the app. Readiness
has 120 seconds within a 300-second execution deadline. Teardown gives TERM
up to three seconds and polls for up to one more second after KILL. Successful
cleanup requires an observed leader exit and an absence probe for each launched
process group. An unresolved group, a missing leader exit or a signaling error
makes cleanup incomplete and causes a nonzero exit. A 310-second outer timeout
with up to 10 seconds of signal grace backs up the execution deadline.

The 2 GiB Node heap and a 512-task runner-user limit bound process resources.
The task limit includes Linux threads and leaves room for Next compilation,
Chromium and runner overhead. The supervisor checks the workspace and scratch
filesystems before launch and during execution, with a 4 GiB free-space floor
and a 4 GiB net-growth allowance per filesystem. The sampled guard can observe
a write after it crosses the threshold. Next cache and Chromium runtime files
use ordinary filesystem behavior. Only the staged artifact has a 12 MiB total,
12-file limit and seven-day retention. Captures that exceed the staging budget
are omitted and recorded as truncated.

Execution receipt schema 2 binds candidate SHA, ref, run and attempt. It records
readiness, the stop reason, capture dispositions, and each child's PID, stop-time
result, terminal result and process-group observation. The bounded server log
retains only recognized operational markers and error codes from stdout and
stderr. The Playwright progress file preserves case starts and completions if
the final JSON report is interrupted. Passing evidence requires one matching
inventory followed by one ordered start and end for each case at retry zero,
with matching final report results and no runner errors or truncated progress.
The collector authenticates the provider checkout and artifact before
reporting compact dispositions for all four discovered cases. It keeps shared
server failures, case assertions, deadlines, and missing or truncated
evidence distinct, with hashes and dispositions in the summary.

The artifact includes Node and configured limits plus elapsed time, CPU and
peak RSS reported by GNU time for the measured command.
That RSS figure does not measure simultaneous process-tree peak, runner idle
cost or host-wide memory. No baseline CPU, memory, browser or CI timing
measurements were available in this implementation checkout. Existing S8-5A
source cohorts remain the separate resource witness for issuer reads and source
bytes. The 12- and 24-installment HELOC fixtures carry 66 and 276 prior
repayment rows respectively, which describes fixture size rather than measured
runner cost.

## Prior readiness observations

PR #377 manual run 45564323938 attempt 1 tested integration commit
`094e411ef0c01457a8c5368e3a77318c022f7861`. Setup and discovery passed.
Desktop navigation encountered a connection reset and the other three cases
encountered connection refusals before their household assertions. Artifact
14998929069 contains the failure report, trace and resource observation.
Server termination details were unavailable. This candidate remains
**NOT_READY**. [Manual run](https://github.com/bensmullen/personal-finance-app/actions/runs/45564323938)

The #366 reviewer checkpoint for PR #377 recorded source head
`597549c44bad439248904c244619ef8007babef2`, base
`b9bd4024f42792da13d4e8ab25c3cdb42250e5c0` and tested merge
`d0de28ab1b4686f855c717c5c1fb7dfd6d698834`. Ordinary CI run
45504302187 attempt 1 passed the aggregate and all selected gates. The
reviewer matched the seven diagnostic ZIP digests and counted 3,908 unit
tests and 174 browser cases with zero skips or retries. GitHub exposed the
checks on the source head and the checkout and shard receipts on the tested
merge. The checkpoint has no manual Chromium artifacts, measurements or
independent visual disposition. Its pre-UAT disposition is **NOT_READY**.
The repaired candidate needs its own exact observations and reviews.

The outstanding product boundaries include readable V6 retirement income
sources and guided source-to-forecast proof under #120, and end-to-end
source-qualified application composition under #149. The test-only #331
witness supports the original issuer, exact posting and replay boundaries in
its declared scope. The applicability registry pins exact case identities,
fixture paths and independent assertion sources. Refusal cases document
blocked or uncomputed behavior. They cannot fill missing reconciliation
or unsupported capability. Screenshots require independent review in the real
application against the approved visual target, along with the remaining
financial discrepancies. PM questions become eligible after those reviews
and required capability coverage are complete.
