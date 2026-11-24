# Audited safety controls and incremental rollout

**Authority:** detailed acceptance for the approved requirements in requirements.md, not a new product capability or runtime activation. Read with interfaces.md and verification-and-metrics.md. Controls below are allocated to the original tasks in plan.json and their saved V3 bodies. Passing the planning checker verifies allocation/syntax, not these future runtime behaviors.

## GF-A01 — Enforceable budgets, not optimistic estimates

Owners: #363, #367, #368. Extend goal/reservation/runner records with an account-wide budget epoch, task lineage, cumulative goal/task ceilings, maximum admitted model calls/continuations, absolute execution deadline, cleanup reserve, native run identity and terminal/cancellation acknowledgement. Every limit must be finite, validated and actually enforceable before unattended admission. A 20% quota reserve or a token estimate is not a hard native spend cap. When the native surface cannot constrain a run or reliably stop it, unattended execution on that surface remains uncertified; only explicitly bounded supervised use is allowed.

Include coordinator wake-ups, planning/discovery, subagents, independent review, model escalation, retries, context summarization, failed launches and checkpoint cleanup in the same account/goal accounting. Different quota pools and units remain separate. Concurrent goals cannot each reserve the full account allowance. Only one trusted supervisor may own the reservation ledger; workers cannot alter it or create authority through issue text. Durable compare-and-set/locking and fencing must survive process restart, partial writes and disk-full failures.

A reservation's TTL prevents a new start after expiry; it NEVER releases the possible liability of an already started or ambiguously acknowledged run. Request stop, retain the reservation/ownership quarantine and reconcile terminal evidence. Do not start a replacement locally or in cloud until the prior run is proven stopped. Settlement is idempotent by reservation/run, includes late usage, and cannot refund the same credit twice. Reset/rollover observations must belong to a newer authenticated epoch; older snapshots, clock skew, external account consumption and missing telemetry cannot replenish spent budget. Goal lifetime ceilings survive provider resets and thread/issue/model changes. Unknown remaining usage is not zero. Pausing should not launch expensive diagnostic agents.

Verification: fake-clock reset/clock-skew, two goals racing, lost launch acknowledgement, continued billing after cancellation, late settlement, expired live reservation, crash/disk-full, automatic compaction and nested-agent costs. A renamed error or fresh thread cannot reset cumulative attempts. Two same-root repair attempts may lead to ONE bounded diagnostic reassessment; all subsequent action still needs remaining lineage budget and material new evidence.

## GF-A02 — Bounded event processing and useful work limits

Owners: #365, #369. Event authentication, repository/goal filtering, durable deduplication, semantic-change detection and backpressure precede any model call. Distinguish control revision/digest from observation/status revision: the coordinator's own status comment or report must not revoke grants, schedule new work or recursively wake itself. Event retention must retain terminal idempotency tombstones for the supported replay window; older events are rejected/reconciled, not replayed as new effects.

Use bounded queue length, payload bytes, pagination, reconciliation duration, retry count and request budget; provider rate-limit/backoff uses deterministic timers and a capped Retry-After, not a model conversation. Repeated authentication/permission failure opens a circuit breaker and sends one actionable notice. Missing events, approval-required workflows and native event suppression require a proven bounded reconciliation/dispatch path; never assume an issue edit or bot push starts downstream CI. Missing required CI blocks acceptance rather than triggering endless reruns.

Initial GLOBAL limits across this supervisor's goals: two implementation writers, two read-only workers, and at most two published outcomes awaiting independent verification. Reserve capacity for review/repair; once that backlog is full, finish verification rather than spawning more implementations. Do not preempt dirty writers to reshuffle priorities. Monitor stalled work once per configured deadline; no-change orchestration invokes no model through this controller. Native platform overhead outside controller visibility remains measured or unknown, never asserted free.

Verification: duplicate/reordered bursts, self-generated edits, a missed completion, rate limits/outage, poison event, expired tombstone, full review queue, repeated same-head failure and two worktrees targeting the same remote branch. Retain one fenced writer per repository/branch and logical shared resource, not merely one per directory.

## GF-A03 — Human approval and supervisor trust boundaries

Owners: #363, #365, #368, #370. A GitHub username is NOT proof of a human action when ChatGPT/Codex can use credentials for that same username. PM/UAT/activation authority requires a trusted human-only approval channel or signed operator acknowledgement unavailable to workers/coordinator tools, binding repository, candidate/control digest, exact decision scope, nonce and expiry. Shared-credential GitHub comments remain untrusted for human approval. Replay, revocation and wrong-candidate cases must fail. An independently authenticated reviewer role/session cannot be self-declared by the implementing worker.

Separate read-only observation, implementation publication, control mutation and merge credentials. Workers cannot write goal approvals, supervisor budgets, trust roots or required checks. No PR-controlled code executes with a privileged merge token; privileged decisions use a reviewed pinned control version and untrusted artifacts are parsed only as bounded data. Content hashes prove identity, not authority. Disallow prompt/command injection, arbitrary artifact fetch origins, credential-bearing redirects and unsafe archive extraction.

Keep authoritative control state outside worker-writable worktrees. Re-certify after relevant runtime, hook, permission, transport or configuration changes. If native separation/fencing cannot be proved, retain manual V3 instead of claiming isolation from advisory prompts. Kill switch blocks new admissions/merges; stop acknowledgement and preserved checkpoints govern active work.

## GF-A04 — No framework overhead in the financial app

Owners: #366, #367, #368, #369, #371. The orchestration system is tooling-only: no production UI/engine import, timer, network poll, financial hot-path hook, user-data access or bundled dependency. Mutation tooling is development-only. Verify import/build boundaries and preserve existing financial/reference/replay and worker/payload tests; this project does not authorize weakening app budgets or fixture expectations.

Budget CPU, memory, disk/artifact volume, process count, CI runner-minutes and test/browser concurrency in addition to model usage. Share host capacity across workers AND their tests. Local development/UAT foreground work takes priority; require an explicit host-capacity/busy signal or a conservative nonconcurrent profile before expensive local evidence runs. Cloud availability is not permission to run every redundant job. Admission uses complete bounded workload estimates, measured results and safe headroom; never increase timeouts to conceal a regression.

Cache only immutable verified evidence keyed by exact code/integration, test/profile/toolchain, fixture and source/config identity; stale/unknown keys miss safely. Keep active control state and acceptance metadata durable, with bounded retention for diagnostics and verified references rather than repeated full payloads. Capacity/disk-pressure failure pauses safely, never removes active receipts or silently drops required evidence. Measure cold and warm paths plus 1/10/100-task record growth; absence of a new production import is necessary but does not prove the shared host remains responsive.

## GF-A05 — Migration must preserve concurrent and new obligations

Owners: #364, #365. Introduce read-only export and shadow comparison before cutover. Do not manufacture PM-approved goals for legacy tasks: preserve their imported authority and historical ownership explicitly; imported metadata alone grants no new autonomy. Issue updates require expected full-body revision/digest, a single authorized writer and verification that unrelated text was preserved; blind last-writer-wins PATCH is insufficient.

Freeze NEW metadata admissions during cutover, reconcile changes since the initial export and preserve active grants without rewriting their contracts. Use a bounded migration journal with per-issue before/after identity and recover interrupted batches idempotently. Rollback must carry forward tasks and obligations created AFTER cutover rather than restore an old snapshot that loses them. Fail on missing pages, duplicate blocks, permission loss, conflicting editors or unresolved identities.

Migrate ALL consumers together: register policy, live traceability workflow/tool, tests, handoff/dispatch and the goal-plan checker. After cutover a generated stale register cannot require a PR for each new issue or overrule live validated metadata; offline snapshots remain explicitly non-authorizing. Before cutover this PR's register checks stay authoritative. Test both modes, new and closed tasks, concurrent edit, interrupted migration and rollback-after-new-task without reducing any D1/D2 gate.

## GF-A06 — Evidence trust and the base-branch merge race

Owners: #366, #370. Pin repository, exact PR head AND integration/base candidate, verification-plan and tool versions, fixture/config digest, workflow/check provenance, required inventory, attempt and independent review. A worker-supplied JSON success report or a check with the right name from the wrong producer is not authoritative. Bound download bytes/unpacked bytes/file count and reject traversal, symlinks, duplicate JSON keys and malformed outcomes. Do not fetch or execute arbitrary URLs/commands from issue/log text.

Required skipped/cancelled/expired/missing evidence blocks; inspect every selected failure and preserve retry/flakiness history. A later green retry does not by itself explain a confirmed earlier defect. Evidence reuse needs matching identity and applicability, not age alone. Preserve compact durable acceptance attestations; if primary evidence expires, mark the new decision unverified rather than repeatedly re-running entire suites without budget.

The GitHub merge `sha` condition pins the PR HEAD, not the target base. A final GET followed by a merge is not an atomic base guard. Delegated merging therefore also requires a verified protected merge queue/integration mechanism or equivalent target-update fence covering ALL target writers; an advisory coordinator-only lock is insufficient. Without that protection, remain manual-only. Verify required checks on the actual merge candidate, invalidated approvals, post-merge identity and lost acknowledgements. Never retroactively call an untested changed-base merge safe.

Provider references (recheck during adapter implementation): https://docs.github.com/en/rest/pulls/pulls and https://docs.github.com/en/actions/concepts/security/github_token . These document provider behavior, not permission to bypass repository controls.

## GF-A07 — Deliver measurable value before adding autonomy

Owners: #363–#371. `delivery_waves` is the recommended dispatch PRIORITY, not a new product gate or change to the recorded dependency graph:

| Wave | Work | Increment accepted before wider use |
| --- | --- | --- |
| 1 | #363 | Pure contracts plus bounded READ-ONLY inventory of installed delegation/model/quota/event capabilities and trust limitations. No paid probe or native launch. Identify unsupported architecture early. |
| 2 | #367 and #366 | Instrument existing operator-run V3 first; collect prospective baseline and reuse existing completed CI/household evidence. Deliver a useful compact report before any autonomous execution. |
| 3 | #365 | Offline failure tests, then supervised use of deterministic contract/workspace checks on an existing approved task. Compare scope/preflight/recovery friction with baseline. No unattended launch. |
| 4 | #364 | Shadow metadata export while the existing register operates; cut over only after preservation/recovery evidence. Measure eliminated register-only PRs. |
| 5 | #368 | Certify one local profile, then cloud; demonstrate watchdog/stop/budget fences before paid smoke work. An unavailable cloud mode must not invalidate already accepted operator tools, but full hybrid P3 acceptance still waits. |
| 6 | #369 | Shadow scheduling decisions, then ONE supervised writer, then two only after duplicate/budget/ownership and review-backlog checks pass. Native Goals/subagents stay disabled until separately evidenced useful and safe. |
| 7 | #370 | Dry-run merge decisions, then separately PM-authorized canary on a disposable/non-UAT candidate; production delegated merge activation remains separate. |
| 8 | #371 | Bounded mutation/optimization experiments and final measured pilot; approve wider activation only after independent evidence and rollback. |

Use the same original issue for these acceptance checkpoints; no micro-issue or scope PR per step. Read-only discovery may run in parallel. Runtime adoption requires merged independently accepted prerequisites, real workspace readiness and finite budgets. Baseline/metric/household tools must remain useful with Dot unavailable; do not wait until P4 to learn whether bookkeeping and scope discovery improved. Keep mandatory tests independent from LLM cost, and record before/after evidence at each adopted increment. No activation just because a feature flag or issue is marked complete.

## GF-A08 — Household and mutation evidence must expose gaps

Owners: #366, #371. Bind applicability to approved required capability, not the implementer's passing subset. Enumerate every applicable supported household/variant; zero discovered tests, missing required fixtures, xfail/quarantine, fixture-order leakage and unknown unsupported behavior cannot pass. Use fresh isolated household/plan stores and independently authored expected values. Prove the real compiled/worker/user path rather than injecting a successful forecast or deriving the oracle from the same calculation. Preserve one holistic journey and separate meaningful failures; inspect actual screenshots without treating screenshot capture as visual approval.

Run original tests successfully BEFORE mutation, record selected mutant inventory, and use a deliberate missed-invariant canary to prove the tool can expose a gap. Equivalent/invalid/uncovered/timed-out mutants stay distinct; sampling is not full assurance. No zero-mutant pass, quiet exclusion, baseline failure, cache-incompatible reuse or new dependency in production bundles. Product defects route to original product owners; do not patch UI/finances or remove a required household under this framework grant.

## GF-A09 — Scope grants and newly introduced control files

Owners: #363, #365. Reject absolute/traversal/noncanonical paths, unsafe globs, symlink escapes, duplicate/contradictory V3 headers and protected runtime-state writes. Revalidate real resolved paths at mutation, not just textual prefixes. A model-proposed scope census cannot grant permission or classify its own financial ambiguity away. Check all entry/optional/cached/incomplete/outward branches and shared seams before implementation; revalidate changed symbols/dependencies rather than repeatedly scanning unchanged repositories.

New framework authority must be protected as it is introduced, including docs/development/goal-framework/, operational metadata/control readers and the trusted supervisor state. Product tasks cannot widen themselves into those files; new paths cannot slip between old prefix checks. Compare actual committed/untracked/deleted paths and generated outputs with the saved grant. Detect upstream policy/tool-version changes before reusing evidence. Keep original task bodies compact without dropping unresolved acceptance or exclusions.

## GF-A10 — Keep verification bounded and incremental

Owners: #364, #369, #371. This PR's checker is read-only, uses stdlib, refuses ambiguous mappings/unsafe contract paths and keeps closed issues explicitly NON-authorizing. It is not a replacement for runtime semantic tests. Saved bodies are re-fetched and parser-validated after edits and again before dispatch. Live reads have byte/request/deadline ceilings, no automatic retries and no arbitrary redirects; PR checks have per-PR cancellation and read-only credentials.

Changes to the checker/hook/reference allocation trigger its small tests. Do not weaken the existing conservative CI router merely to make this planning PR cheaper; consolidate changes into a coherent push and avoid identical manual reruns. At metadata cutover update the checker coherently. Event-driven progress/learning summaries use material deltas and cooldowns; no perpetual monitoring agent, per-turn full-ledger reread or status-only repository commits. Unknown-cost improvements require a bounded experiment, not open-ended framework work that starves the product goal.

## Acceptance and limits

Each owning task implements its allocated controls and positive/negative tests under its existing requirements/verification IDs. GF-A IDs identify audited edge-case groups, not extra product requirements. Parent #362 records actual results, metrics and accepted increments. Static tests and planning approval cannot prove all runtime corner cases absent; runtime certification, independent review, observability and bounded failure containment remain mandatory.
