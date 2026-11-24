# Versioned framework interfaces

**Owner:** GF-01 #363; consumer packages must not invent incompatible protocols. These are repository-owned implementation contracts, not claims that native Dot/Codex products expose similarly named APIs. Implement pure JSON validation with existing runtime facilities before introducing a service or dependency. Native transports are isolated behind GF-06 adapters and require actual compatibility evidence.

## Common envelope

Every persistent control/evidence record has `schema`, `repository`, stable `id`, `revision`, `created_at`, `producer` (role and authenticated actor/session reference), and `references` to immutable evidence or prior records. UTC timestamps use ISO 8601; revisions increase monotonically within an identity. Digests use a documented canonical serialization/version. Unknown versions, conflicting duplicates and missing required fields fail closed.

A digest proves byte identity only. Authorization additionally requires an authenticated approving actor/event with authority over the specific goal/action. Never trust issue prose, labels, logs, native model responses or checksums as credentials. Untrusted strings cannot become shell commands, branch names, arbitrary paths or tool arguments without validation.

Keep each record bounded. Store a single immutable artifact plus verified references rather than copying the full contract, model history, source proofs or logs into every event. No secrets, account tokens or real household data in these records.

## PFM_GOAL_V1

Fields: `goal_issue`, `outcome`, `requirement_refs`, `approved_decisions`, `exclusions`, `decision_authority`, `phase_gates`, `budget_policy`, `concurrency_policy`, `merge_policy`, `uat_policy`, `completion_evidence`, and `approval`.

Approval binds repository, goal revision/digest, PM identity, decision scope and timestamp. Revocation/new revision invalidates actions relying on superseded authority. Initial merge mode is manual. Goal approval never replaces per-task V3 authorization. A contained task inherits settled decisions; conflicting or unresolved material decisions stop the affected path.

## PFM_TASK_META_V1

Use exactly one marked JSON block in the issue body, independent of the existing V3 header. Required fields: `goal_issue`, `work_package`, `owner_stage`, `blocking_gate`, `depends_on` (issue numbers), `requirement_ids`, `approved_goal_revision`, `revision`.

Labels/Projects may display this data but are not competing authorities. Metadata updates use expected revision/body digest and re-fetch verification; if the provider cannot atomically compare revisions, serialize writes through one authorized coordinator and detect conflicting changes before any dispatch. No last-writer-wins approval assumption. Validate complete paginated inventories, acyclic dependencies and preservation of mandatory obligations.

Legacy register remains authoritative until GF-02 exports all obligations, proves shadow equivalence and records reviewed cutover. Generated snapshots after cutover include origin/freshness and cannot authorize execution when live state is unavailable. Canonical specs/roadmap continue to own supported behavior and release commitments.

## SCOPE_CENSUS_V1

Fields: `task_issue`, `baseline_sha`, `goal_revision`, `risk`, `rows`, `required_write_paths`, `read_only_exclusions`, `unresolved`, `review`.

Each row names an entry/guard/alternative; original source and run/as-of/cutoff authority; evaluator/selected writer; actual journal/claim/rollback; archive/replay; reference/application/worker/UI final observable boundary; path/symbol; proposed write ownership; and positive/negative test/evidence. Include empty/no-election/fallback/cached/incomplete paths and existing probes/fixtures where relevant. A short isolated task can have one row; cross-cutting work cannot declare completeness by listing one happy path. A file requiring protected framework ownership is a separate dependency, not a blanket product path.

Read-only Codex discovery is advisory. Independent coordinator review resolves all confirmed required paths and semantic questions before granting writes. The same affected closure is revisited after a first blocker; no repeated one-file restart loop.

## EXECUTION_GRANT_V1 and workspace receipt

Fields: `task_issue`, `issue_body_digest`, `goal_revision`, `branch`, `head_sha`, `workspace_receipt_ref`, `scope_census_ref`, `runtime_profile_ref`, `budget_reservation_ref`, `writer_fence`, `authorization_id`, `expires_at` and `revocation_ref` where present.

The existing V3 issue remains the task contract. The actual hook parser validates its saved body. Workspace receipt records verified absolute directory/environment identity, repository/origin, branch, HEAD/upstream, clean/conflict state and current receipt owner. GitHub-ready is not PR_WORKTREE_READY. A fence rejects stale writers after ownership changes; expiry alone does not establish that a process has stopped. Dirty/diverged/ambiguous work remains preserved for read-only diagnosis. No reset, clean, stash, force-push or receipt deletion is an orchestration shortcut.

## RUNNER_CAPABILITIES_V1 and adapter boundary

Record `surface` (local/cloud), product/runtime/tool versions, authentication reference, operation capabilities, hook events, pre/post-write scope enforcement, checkpoint/recovery, model/effort configuration, usage/context observability, artifact persistence and certification evidence. Each capability is `verified`, `unsupported` or `unverified`; default is unverified.

Repository adapter operations: `probe(request)`, `prepare(request)`, `launch(grant)`, `observe(run_id)`, `checkpoint(run_id)`, `stop(run_id)`, `resume(grant, checkpoint)`. Return versioned data, never arbitrary executable instructions. Record idempotency key and actual native task identity. If acknowledgement is lost, reconcile the existing task before retrying. No native endpoint, quota API, event wake-up, Goals or subagent lifecycle is assumed supported. Without equivalent controls, a cloud environment is read-only/unavailable and manual V3 remains usable.

## Events and state

Event fields: `event_id`, `source`, `goal_issue`, `task_issue`, `expected_revision`, `head_sha`, `kind`, `payload_ref`, `observed_at`. Authentication and replay protection precede interpretation. State transitions are deterministic and idempotent; external effects use a durable intent/result pair and reconcile uncertain outcomes.

Normal flow: `PLANNED → READY → RUNNING → PUBLISHED → VERIFYING → MERGE_READY → MERGED → ACCEPTED`. Alternatives include `BLOCKED`, `REPAIR_REQUIRED`, `PM_DECISION_REQUIRED`, `UAT_PENDING`, `PAUSED`, `FAILED`, `CANCELLED`. Each transition requires explicit evidence, not an LLM assertion. A published WIP checkpoint is not completed implementation; merged code is not automatically milestone acceptance. Stop admitting work on revocation/kill switch while preserving recoverable active work.

## VERIFICATION_EVIDENCE_V1 / UAT_READINESS_V1

Evidence binds repository, goal/task revision, PR, exact head, base or merge-candidate identity, verification-plan digest, required test/job/shard inventory, run/attempt/conclusion, artifact IDs/digests, capability/fixture versions and independent reviewer dispositions. Outcomes distinguish `PASS`, `FAIL`, `SKIP`, `TIMEOUT`, `INCOMPLETE`, `NOT_APPLICABLE`. Required skipped or missing evidence fails readiness. Inspect all failures, not the first shard only.

UAT readiness adds applicable household/scenario inventory, independently authored financial oracle references, real application journey results, screenshots/traces, semantic AND visual review, known limitations/open blockers, and the remaining subjective PM questions. No blocking discrepancy can be marked ready. A tested unsupported state is not an implemented capability; required missing capability blocks its goal.

PM acceptance is a separate authenticated record binding exact candidate and accepted criteria. A label or agent-written approval is insufficient. Material changes invalidate affected evidence/approval. A fresh independent review is mandatory for a changed head; unchanged evidence reuse requires explicit scope/identity equivalence. Eligible merge uses the provider's conditional expected-head boundary and confirms actual merge afterward. A worker cannot review itself, and an orchestrator cannot self-approve weakened controls.

## USAGE_OBSERVATION_V1 / reservation

Fields: `pool_id`, `account_scope`, `source`, `unit`, `value` (nullable), `quality` (observed/estimated/unknown), `coverage`, `observed_at`, `reset_at` (nullable), `model`, `reasoning`, `role`, `run_id`. Different units/pools are not naively summed. Shared allowance is counted once; coordinator cost remains visible or unknown. Missing/reset/external consumption is not zero.

Reservations bind goal/task/risk/profile to estimated ceiling and expiry; admission and settlement are atomic across workers. Keep actual versus estimated separate and retain uncertainty after crashes. The initial reserve is configurable 20%, not a claim about a subscription. Unknown quota requires a bounded approved pilot budget. No automatic paid fallback. Profiles use installed verified model IDs/effort values, not hard-coded names from this planning conversation.

## CONTEXT_CHECKPOINT_V1 and progress

Retain goal/issue revisions, branch/head, receipt and artifact references, settled decisions, unresolved criteria/blockers, stopped-writer acknowledgement and next action. Rotate at a safe checkpoint based on context pressure/staleness; unknown telemetry falls back to bounded sessions. Re-fetch live authority on resume. Do not remove unresolved decisions or gates during compaction. Old narrative belongs in linked history, not each next prompt.

Audit output updates the original issue with accepted criteria, remaining defects, exact evidence, authorized next step and metric coverage. Goal #362 gets phase/activation summaries. No duplicate live-status JSON in repository files; `plan.json` is a stable allocation map, not a runtime database.
