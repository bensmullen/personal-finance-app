# Versioned framework interfaces

**Owner:** GF-01 #363; consumer packages must not invent incompatible protocols. These are repository-owned implementation contracts, not claims that native Dot/Codex products expose similarly named APIs. Implement pure JSON validation with existing runtime facilities before introducing a service or dependency. Native transports are isolated behind GF-06 adapters and require actual compatibility evidence.

The offline implementation is in [contracts.mjs](../../../tools/codex/goal-framework/contracts.mjs). The closed V1 shapes are in [schemas/v1.mjs](../../../tools/codex/goal-framework/schemas/v1.mjs), with synthetic witnesses in [goalFrameworkContracts.test.ts](../../../test/goalFrameworkContracts.test.ts).

## Common envelope

Every persistent control/evidence record has `schema`, `repository`, stable `id`, `revision`, `created_at`, `producer` (role and authenticated actor/session reference), and `references` to immutable evidence or prior records. UTC timestamps use ISO 8601; revisions increase monotonically within an identity. Digests use a documented canonical serialization/version. Unknown versions, conflicting duplicates and missing required fields fail closed.

A digest proves byte identity only. Authorization additionally requires an authenticated approving actor/event with authority over the specific goal/action. Never trust issue prose, labels, logs, native model responses or checksums as credentials. Untrusted strings cannot become shell commands, branch names, arbitrary paths or tool arguments without validation.

Keep each record bounded. Store a single immutable artifact plus verified references rather than copying the full contract, model history, source proofs or logs into every event. No secrets, account tokens or real household data in these records.

V1 hashes use SHA-256 over UTF-8. `canonicalJson` serializes finite JSON values with JSON string/number encoding, lexically sorted object keys in UTF-16 code-unit order and unchanged array order. The saved V3 body digest hashes the original UTF-8 body, including line endings. Record references use `{id, digest}` and are scoped to the owning repository and record type by their enclosing contract. Resolve against an immutable trusted source. Record validation rejects unexpected properties, conflicting reference IDs, malformed calendar timestamps and data that exceeds the 128 KiB encoder and field limits. Bounds protect the parser and transport; the producer still owns redaction and privacy review.

## PFM_GOAL_V1

Fields: `goal_issue`, `outcome`, `requirement_refs`, `approved_decisions`, `exclusions`, `decision_authority`, `phase_gates`, `budget_policy`, `concurrency_policy`, `merge_policy`, `uat_policy`, `completion_evidence`, and `approval`.

Approval binds repository, goal revision/digest, PM identity, decision scope and timestamp. Revocation/new revision invalidates actions relying on superseded authority. Initial merge mode is manual. Goal approval never replaces per-task V3 authorization. A contained task inherits settled decisions; conflicting or unresolved material decisions stop the affected path. A bounded goal outcome has a lightweight sizing/reuse rationale when nonobvious; this is not an additional approval.

`control_revision` and the digest produced by `goalControlDigest` bind the operative fields. That digest excludes the common record revision, observation revision, approval link and observation provenance (`producer`, `created_at`, `references`). A status update may change those observation fields without granting or revoking authority. `PFM_APPROVAL_V1` binds purpose, scope, tier, channel, nonce and expiry to the current control identity. Merge/acceptance additionally bind task revision and candidate digest. Acceptance binds the accepted criteria. A goal approval nonce identifies a standing approval. Candidate-action nonces are consumed once by the trusted state owner when it commits the corresponding transition.

`planAlignedTask` checks inherited decision IDs, domains and digests against live goal authority. It returns reuse for a contained internal step, batch for related reviewable work, retain for a coherent independently verifiable result, or split for incoherent scope. The risk input selects focused scope or reachable-closure review within Planning. Publication and evidence-backed transitions cover Implementation and Verification. The sizing result carries no issue creation, new approval or write authority.

## PFM_TASK_META_V1

Use exactly one marked JSON block in the issue body, independent of the existing V3 header. Required fields: `goal_issue`, `work_package`, `owner_stage`, `blocking_gate`, `depends_on` (issue numbers), `requirement_ids`, `approved_goal_revision`, `revision`.

`readTaskMetadata` reads the common envelope and task fields between standalone `<!-- PFM_TASK_META_V1` and `-->` lines. It checks the repository and containing issue supplied by the reader, rejects duplicate blocks and JSON keys, and rejects dependence on the containing task or parent goal. Multi-issue inventory completeness, obligation preservation and compare/re-fetch coordination remain GF-02 responsibilities.

Labels/Projects may display this data but are not competing authorities. Metadata updates use expected revision/body digest and re-fetch verification; if the provider cannot atomically compare revisions, serialize writes through one authorized coordinator and detect conflicting changes before any dispatch. No last-writer-wins approval assumption. Validate complete paginated inventories, acyclic dependencies and preservation of mandatory obligations.

Legacy register remains authoritative until GF-02 exports all obligations, proves shadow equivalence and records reviewed cutover. Generated snapshots after cutover include origin/freshness and cannot authorize execution when live state is unavailable. Canonical specs/roadmap continue to own supported behavior and release commitments.

## SCOPE_CENSUS_V1

Fields: `task_issue`, `baseline_sha`, `goal_revision`, `risk`, `rows`, `required_write_paths`, `read_only_exclusions`, `unresolved`, `review`. Task complexity/cohort and one-line reuse/batch/split choice are optional planning/metric annotations, not machine write permissions or extra agent phases.

Each row names an entry/guard/alternative; original source and run/as-of/cutoff authority; evaluator/selected writer; actual journal/claim/rollback; archive/replay; reference/application/worker/UI final observable boundary; path/symbol; proposed write ownership; and positive/negative test/evidence. Include empty/no-election/fallback/cached/incomplete paths and existing probes/fixtures where relevant. A short isolated task can have one row; cross-cutting work cannot declare completeness by listing one happy path. A file requiring protected framework ownership is a separate dependency, not a blanket product path.

Read-only Codex discovery is advisory. Independent coordinator review resolves all confirmed required paths and semantic questions before granting writes. The same affected closure is revisited after a first blocker; no repeated one-file restart loop.

`validateScopeCensus` requires a separate independently reviewed entry/alternative inventory and compares it against the supplied rows. Each row gives a disposition and reason for every named boundary, with positive and negative evidence references. Use `not_applicable` only with a reviewed reason. Required write paths must match the row ownership, fit the saved V3 list and avoid read-only exclusions. Framework dependencies require separate resolution evidence. Unknown ownership or boundaries block admission for this census. Confirmed unrelated work can retain its own census.

## EXECUTION_GRANT_V1 and workspace receipt

Fields: `task_issue`, `issue_body_digest`, `goal_revision`, `branch`, `head_sha`, `workspace_receipt_ref`, `scope_census_ref`, `runtime_profile_ref`, `budget_reservation_ref`, `writer_fence`, `authorization_id`, `expires_at` and `revocation_ref` where present.

The existing V3 issue remains the task contract. The actual hook parser validates its saved body. Workspace receipt records verified absolute directory/environment identity, repository/origin, branch, HEAD/upstream, clean/conflict state and current receipt owner. GitHub-ready is not PR_WORKTREE_READY. A fence rejects stale writers after ownership changes; expiry alone does not establish that a process has stopped. Dirty/diverged/ambiguous work remains preserved for read-only diagnosis. No reset, clean, stash, force-push or receipt deletion is an orchestration shortcut.

`inspectV3Body` provides an additional offline restriction. It requires one leading V3 marker, unique headers, exact file paths or a final `/**` on a narrow subtree, and denies protected runtime paths for every task kind. Product/repair writes also deny framework tools, the goal-framework specification and contract test surfaces. The grant validator requires current Alignment for a standalone or batched result, a trusted result from the actual saved-open-issue parser and a separately verified live workspace, including canonical resolved paths. Future mutation enforcement must repeat origin, owner/fence and real-path checks at the write boundary and compare actual changed/untracked/deleted paths. The current general-purpose hook already protects `tools/codex/` and still needs explicit coverage for the goal-framework specification and contract test surfaces. Existing manual V3 continues under its operative hooks. Live grant consumers must close that coverage gap before activation.

## RUNNER_CAPABILITIES_V1, RUNNER_PROFILE_BINDING_V1 and adapter boundary

Record `surface` (local/cloud), product/runtime/tool versions, authentication reference, operation capabilities, hook events, pre/post-write scope enforcement, checkpoint/recovery, model/effort configuration, usage/context observability, artifact persistence and certification evidence. Each capability is `verified`, `unsupported` or `unverified`; default is unverified.

For live grant validation and READY, the grant's `runtime_profile_ref` names the runner capability record and the reservation's `runtime_profile_ref` names the distinct GF-05 resource registry record. The grant pins a closed `RUNNER_PROFILE_BINDING_V1` by ID and digest in `references`. The binding carries the task/control revisions and lineage, references to the runner, resource profile, workspace receipt and reservation, plus grant ID, authorization ID, fence, surface, transport, config and permission digests, trusted merged control SHA, exact GF-05 runtime/model/effort, expiry and revocation reference. The binding uses the grant ID so the reference graph is acyclic. Older grants remain shape-readable and require fresh issuance before live admission.

The grant validator receives the exact binding, independently resolved registry profile and installed runtime identity. The runtime identity must name the same resource profile by ID and digest. The `live_runner_resource_profile_binding` verifier authenticates the relationship using the current registry, product/runtime/tool versions, credential identity, transport, config, permissions, merged control and revocation state. The installed version string and GF-05 runtime identifier have different definitions. The supervisor must attest their mapping for this installed tool, authentication identity and workspace. The adapter pins the control SHA to the parser revision and checks the prepared receipt and actual GF-05 reservation against the GF-03 preparation snapshot.

The adapter returns versioned results for `probe()`, `prepare(request)`, `launch(request)`, `observe(binding)`, `checkpoint(binding)`, `stop(binding)` and `resume(request, checkpoint)`. Preparation observes a prepared V3 receipt before the lifecycle snapshot. The launch request names the task and grant reference. Control requests name the task, reservation reference, fence and a native ID when known. They resolve the original immutable admission for that surface, even after the current capability inventory changes. The native ID can arrive later without changing the idempotency key. An uncertain effect receipt requires reconciliation. Manual V3 remains available while native controls are unverified.

### Read-only compatibility and trust inventory

Observed on 2026-11-24 by reading the installed application metadata, this session's exposed tool descriptions and the repository hook source. These observations establish presence and contract shape only. No surface was launched or probed with credentials.

| Surface | Bounded observation | Unknown at P1 |
| --- | --- | --- |
| Local Codex desktop | Installed bundle reports `com.openai.codex`, version `26.1111.21308`, build `27194`. Bundled `codex-package.json` reports CLI `0.169.0-alpha.11.1` and target `x86_64-apple-darwin`. This session received repository UserPromptSubmit and PreToolUse hook results. | Native grant-linked identity, reliable start/stop acknowledgements, hard cumulative cap, observed usage/context, restart-safe fencing and credential separation. Installed version metadata is not running-process attestation. |
| Desktop chat tools exposed in this session | Tool metadata describes chat creation, reads, waits and messaging. This inventory used only their descriptions. The exposed chat lifecycle does not supply evidence of equivalent writer controls. | Presence of a certified hook-aware execution adapter and its permissions, budgets and stop behavior. No launch or stop call was made. |
| Dot / cloud execution | No independently authenticated native runner, version, permission inventory or equivalent guard evidence was available to this checkout. | All execution operations, hooks, credentials, usage, event wakeups and recovery remain unverified. |
| GitHub and human trust | The issue hook supplied the repository task body and enforces the existing V3 authorization flow. GitHub publication and CI are scoped evidence surfaces. | A human-only approval channel, an independently authenticated reviewer principal and separated merge credentials were not established. A shared account identity cannot fill that gap. |

The local observations support continuing manual V3 and offline work. They yield no verified native writer profile. GF-06 owns live local/cloud compatibility and certification.

## GF-06 supervised preparation and handoff

This adapter-local protocol uses closed V1 records and immutable references.
`PFM_PREPARATION_REQUEST_V1` binds repository, goal revision and control
digest, task issue/revision/lineage, exact V3 body digest, reviewed census,
worker principal, logical resource, host and environment, approved source
and target paths, new/resume mode, expected main and optional published
feature head, parser and helper commits and digests, host allowance,
cleanup deadline, expiry and one-shot nonce.

`PFM_PREPARATION_APPROVAL_V1` holds a distinct authenticated PM proof
reference and SHA-256 of the canonical request payload. The proof envelope
sits outside that payload. Serialized requests use canonical JSON to reject
duplicate keys. The live goal approval is checked separately. A live issue
observation, cached ref, receipt hash or shared account identity cannot
authorize an effect. Authorization changes require a newly approved request.
Changes to Git observations are evaluated against the existing pins.

`PFM_PREPARATION_HOST_ALLOWANCE_V1` binds the repository, host, environment,
resource and nonce to finite CPU, memory, process, disk, execution and
cleanup limits. The trusted global gate coordinates the allowance with the
native writer and host capacity controls. `PFM_PREPARATION_INTENT_V1`
records only digests and scoped references. `PFM_PREPARATION_RESULT_V1`
reports unresolved, nonstart, cleaned or git-ready with the corresponding
evidence reference. An unresolved intent stays reserved across failures and
restart. Only trusted terminal/cleanup or nonstart evidence can release it.
The host authenticates journal identity and the committed generation and
digest under the journal lock. A signed snapshot whose generation or digest
differs from the independent current state leaves the disposition unknown.
The gate and journal lock invoke one synchronous callback and return its
canonical data result. An independently serialized equivalent reply is valid.
Journal open is a no-result operation. A rejected or missing reply leaves
any durable intent in place for a later authenticated read. The current-state
port advances its witness after the file and directory syncs. Its synchronous
commit returns no value, and a separate authenticated read confirms the
exact generation and digest before the journal reports success.

`PFM_SUPERVISED_HANDOFF_V1` reports preparation-only readiness and includes
the exact issue pointer, directory and observed trust disposition. Pending
project or hook approval produces `HANDOFF_APPROVAL_REQUIRED` for manual
review. A separate
`PFM_PREPARED_HANDOFF_REVIEW_V1` binds the actual hook receipt to the
authenticated session, turn, authorization ID, canonical workspace reference
and independently observed Git state. It resolves the original journal
evidence by exact reference under the global gate and rechecks live authority, host and remote
state, exact hook configuration and the approved worker's session mapping.
This read-only review grants no mutation permit.
The existing runner must still validate the grant, runner/resource profile
and GF-03 prepared state before admission. GF-05 accounts for a real native
run. Its matching start acknowledgement and GF-03 claim/assertWriter gate
the first mutation.

## Events and state

Event fields: `event_id`, `source`, `goal_issue`, `task_issue`, `expected_revision`, `head_sha`, `kind`, `payload_ref`, `observed_at`. Authentication and replay protection precede interpretation. State transitions are deterministic and idempotent; external effects use a durable intent/result pair and reconcile uncertain outcomes.

Normal flow: `PLANNED → READY → RUNNING → PUBLISHED → VERIFYING → MERGE_READY → MERGED → ACCEPTED`. Alternatives include `BLOCKED`, `REPAIR_REQUIRED`, `PM_DECISION_REQUIRED`, `UAT_PENDING`, `PAUSED`, `FAILED`, `CANCELLED`. Each transition requires explicit evidence, not an LLM assertion. A published WIP checkpoint is not completed implementation; merged code is not automatically milestone acceptance. Stop admitting work on revocation/kill switch while preserving recoverable active work.

`proposeTaskTransition` checks the versioned event against current task/control revision and head. It returns a proposed state, event digest tombstone and any candidate nonce to consume. The caller commits all three atomically and owns durable intent/reconciliation for external effects. Exact event replay returns the prior state; reused IDs with different bytes and unrecognized stale events fail. READY binds a current grant. RUNNING requires the native acknowledgement for that grant; an uncertain start remains pending reconciliation. PUBLISHED binds the candidate, MERGE_READY requires current verification and applicable UAT, MERGED requires actual merge confirmation, and ACCEPTED requires separate human acceptance of the candidate and criteria.

## VERIFICATION_EVIDENCE_V1 / UAT_READINESS_V1

Evidence binds repository, goal/task revision, PR, exact head, base or merge-candidate identity, verification-plan digest, required test/job/shard inventory, run/attempt/conclusion, artifact IDs/digests, capability/fixture versions and independent reviewer dispositions. Outcomes distinguish `PASS`, `FAIL`, `SKIP`, `TIMEOUT`, `INCOMPLETE`, `NOT_APPLICABLE`. Required skipped or missing evidence fails readiness. Inspect all failures, not the first shard only.

UAT readiness adds applicable household/scenario inventory, independently authored financial oracle references, real application journey results, screenshots/traces, semantic AND visual review, known limitations/open blockers, and the remaining subjective PM questions. No blocking discrepancy can be marked ready. A tested unsupported state is not an implemented capability; required missing capability blocks its goal.

PM acceptance is a separate authenticated record binding exact candidate and accepted criteria. A label or agent-written approval is insufficient. Material changes invalidate affected evidence/approval. A fresh independent review is mandatory for a changed head; unchanged evidence reuse requires explicit scope/identity equivalence. Eligible merge uses the provider's conditional expected-head boundary and confirms actual merge afterward. A worker cannot review itself, and an orchestrator cannot self-approve weakened controls.

The evidence candidate binds PR, exact head, base, optional merge-candidate SHA and ordered verification-plan digest. The selected check inventory supplies unique check keys, obligation and artifact requirements. The verifier requires real candidate/check provenance from the provider and authenticated independence for the review. Each check names its reported run and attempt; the provenance boundary must account for reruns and material prior outcomes. The pure validator cannot discover a job or shard that the trusted plan or provider withheld. GF-04 supplies provider collection and household pre-UAT evidence.

## USAGE_OBSERVATION_V1 / reservation

Fields: `pool_id`, `account_scope`, `source`, `unit`, `value` (nullable), `quality` (observed/estimated/unknown), `coverage`, `observed_at`, `reset_at` (nullable), `model`, `reasoning`, `role`, `run_id`. Different units/pools are not naively summed. Shared allowance is counted once; coordinator cost remains visible or unknown. Missing/reset/external consumption is not zero.

Reservations bind goal/task/risk/profile to estimated ceiling and expiry; admission and settlement are atomic across workers. Keep actual versus estimated separate and retain uncertainty after crashes. The initial reserve is configurable 20%, not a claim about a subscription. Unknown quota requires a bounded approved pilot budget. No automatic paid fallback. Profiles use installed verified model IDs/effort values, not hard-coded names from this planning conversation.

Budget quantities use a stated integral unit (such as messages or an explicitly scaled unit) and nonnegative safe-integer ceilings. `BUDGET_RESERVATION_V1` binds account epoch, task lineage, carried account/goal/task liabilities and cumulative call/continuation counts. The cleanup reserve fits inside each applicable remaining ceiling. A deadline bounds the admission window. A started or ambiguous expired reservation calls for stop and reconciliation, with liability retained. Even a terminal acknowledgement only permits trusted settlement, and an apparently unstarted expiry still requires reconciliation. The future supervisor owns atomic accounting, authenticated epoch changes and late usage. Neither the shape validator nor these fixtures prove native enforcement.

## CONTEXT_CHECKPOINT_V1 and progress

Retain goal/issue revisions, branch/head, receipt and artifact references, settled decisions, unresolved criteria/blockers, stopped-writer acknowledgement and next action. Rotate at a safe checkpoint based on context pressure/staleness; unknown telemetry falls back to bounded sessions. Re-fetch live authority on resume. Do not remove unresolved decisions or gates during compaction. Old narrative belongs in linked history, not each next prompt.

### Trust inputs for consumers

The standalone record checks validate data only. Authority checks take a synchronous `verify(boundary, binding)` function supplied by the trusted host. Missing verification, or any result other than explicit `true`, fails closed. This is a repository interface for future adapters. Never supply the function, nonce ledger, scope requirements, verification plan or current authority from the record being evaluated. Do not attach a permissive verifier to live input.

| Boundary | What the trusted host must establish |
| --- | --- |
| `human_approval`, `live_goal_control` | Human-only approval or operator signature over the exact record and channel, current trusted PM identity, nonce, current live control and lack of revocation. |
| `saved_open_v3_actual_parser`, `live_workspace_receipt`, `resolved_workspace_scope`, `live_execution_grant` | Live repository issue body and actual parser result, independently observed clean matching worktree and resolved files, current one-writer fence and nonrevoked grant. |
| `independent_scope_review`, `resolved_framework_dependencies` | Reviewed route inventory, independent reviewer and authentic current evidence for separately owned required work. |
| `live_runner_profile`, `live_budget_reservation`, `terminal_run` | Actual capability proofs for the pinned runtime/authentication, a current supervisor-owned ledger entry for the epoch and lineage, and proven native termination before settlement. |
| `exact_candidate_checks`, `independent_verification_review`, `human_uat_acceptance`, `complete_acceptance_criteria` | Complete selected exact-candidate evidence, reviewer separate from worker, trusted PM UAT if applicable and the live criteria inventory. |
| `task_event`, `task_transition_evidence`, `native_start_acknowledgement`, `complete_publication`, `actual_merge_confirmation` | Authenticated source/event, immutable transition-specific effect evidence and appropriate authority, including safe writer disposition when blocked or stopped. |
| `live_checkpoint_authority`, `stopped_checkpoint_writer` | Fresh authority and storage references, exact known clean Git state, and a stopped prior writer whose acknowledgement binds run, receipt and fence. |

No repository adapter is installed by this package. The contracts perform no network, merge, dispatch, budget reservation, or workspace mutation.

Audit output updates the original issue with accepted criteria, remaining defects, exact evidence, authorized next step and metric coverage. Goal #362 gets phase/activation summaries. No duplicate live-status JSON in repository files; `plan.json` is a stable allocation map, not a runtime database.
