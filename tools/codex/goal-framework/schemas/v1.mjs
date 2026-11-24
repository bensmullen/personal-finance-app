// Closed, bounded JSON shapes. Cross-record and trust checks live in contracts.mjs.
const string = (maxLength, pattern) => ({ type: 'string', minLength: 1, maxLength, pattern });
const integer = (minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => ({ type: 'integer', minimum, maximum });
const enumeration = (...values) => ({ enum: values });
const array = (items, minItems = 0, maxItems = 64) => ({ type: 'array', items, minItems, maxItems, uniqueItems: true });
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const object = (properties, optional = []) => ({
  type: 'object', properties, required: Object.keys(properties).filter((key) => !optional.includes(key)),
  additionalProperties: false,
});

const id = string(96, /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
const text = string(512);
const path = string(240);
const time = { ...string(24), format: 'utc' };
const counter = integer();
const revision = integer(1);
const digest = string(64, /^[a-f0-9]{64}$/);
const sha = string(40, /^[a-f0-9]{40}$/);
const repository = string(160, /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9_.-]*$/);
const ref = object({ id, digest });
const refs = array(ref);
const actor = object({ actor: id, session: id, role: enumeration('pm', 'reviewer', 'coordinator', 'worker', 'observer', 'provider', 'supervisor') });
const decision = enumeration('financial', 'product', 'privacy', 'security', 'release', 'uat', 'activation', 'implementation');
const approvalDecision = enumeration('financial', 'product', 'privacy', 'security', 'release', 'uat', 'activation', 'implementation', 'merge', 'acceptance');
const tier = enumeration('manual', 'delegated');
const quantity = { type: 'number', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const pool = { pool_id: id, account_scope: id, account_epoch: revision, unit: id };
const limits = object({
  ...pool, account_ceiling: counter, goal_ceiling: counter, task_ceiling: counter,
  max_model_calls: counter, max_continuations: counter, execution_deadline: time, cleanup_reserve: counter,
});
const candidate = object({
  pr: revision, head_sha: sha, base_sha: sha, merge_candidate_sha: nullable(sha), verification_plan_digest: digest,
});
const verificationStatus = enumeration('PASS', 'FAIL', 'SKIP', 'TIMEOUT', 'INCOMPLETE', 'NOT_APPLICABLE');
const check = object({ id, required: { type: 'boolean' }, run_id: id, attempt: revision, outcome: verificationStatus, artifacts: refs });
const capability = object({ status: enumeration('verified', 'unsupported', 'unverified'), evidence: refs });
const capabilities = [
  'probe', 'prepare', 'launch', 'observe', 'checkpoint', 'stop', 'resume', 'hook_events',
  'pre_write_scope', 'post_write_scope', 'recovery', 'model_effort', 'usage', 'context',
  'artifacts', 'budget_enforcement', 'terminal_acknowledgement', 'separate_credentials', 'writer_fencing',
];
const branch = string(200, /^(codex|agent)\/[A-Za-z0-9_.\/-]+$/);
const risk = enumeration('simple', 'standard', 'cross-cutting');
const v3 = string(32, /^PFM_TASK_V3$/);
const decisionBinding = object({ id, domain: decision, digest });

const common = { repository, id, revision, created_at: time, producer: actor, references: refs };
const record = (schema, fields, optional) => object({ ...common, schema: { const: schema }, ...fields }, optional);

export const censusBoundaries = Object.freeze([
  'original_source', 'run_context', 'evaluator', 'selected_writer', 'journal', 'rollback', 'archive',
  'cold_replay', 'warm_replay', 'reference', 'application', 'worker', 'ui', 'fixtures', 'siblings',
]);
export const censusAlternatives = Object.freeze(['primary', 'optional', 'empty', 'no_election', 'fallback', 'cached', 'incomplete', 'callback']);
const boundary = object({ disposition: enumeration('covered', 'not_applicable', 'unknown'), detail: text });
const row = object({
  id, entry: id, alternative: enumeration(...censusAlternatives), guard: text, path, symbol: text,
  boundaries: object(Object.fromEntries(censusBoundaries.map((name) => [name, boundary]))),
  ownership: enumeration('task_write', 'test_migration', 'framework_dependency', 'read_only', 'unknown'),
  positive_evidence: refs, negative_evidence: refs,
});

export const taskStates = Object.freeze([
  'PLANNED', 'READY', 'RUNNING', 'PUBLISHED', 'VERIFYING', 'MERGE_READY', 'MERGED', 'ACCEPTED',
  'BLOCKED', 'REPAIR_REQUIRED', 'PM_DECISION_REQUIRED', 'UAT_PENDING', 'PAUSED', 'FAILED', 'CANCELLED',
]);
const acknowledgement = object({ native_run_id: id, outcome: enumeration('completed', 'stopped', 'failed', 'not_started'), observed_at: time, evidence: ref });
const goalRevision = { goal_issue: revision, goal_revision: revision, goal_control_digest: digest };
const taskRevision = { ...goalRevision, task_issue: revision, task_revision: revision };
const taskIdentity = { ...taskRevision, lineage_id: id };

export const schemas = Object.freeze({
  PFM_GOAL_V1: record('PFM_GOAL_V1', {
    goal_issue: revision, control_revision: revision, observation_revision: counter,
    outcome: text, requirement_refs: array(id, 1), approved_decisions: array(decisionBinding), exclusions: array(text),
    decision_authority: object({
      financial: { const: 'pm' }, product: { const: 'pm' }, privacy: { const: 'pm' }, security: { const: 'pm' },
      release: { const: 'pm' }, uat: { const: 'pm' }, activation: { const: 'pm' }, implementation: { const: 'task' },
    }),
    phase_gates: object({ alignment: id, planning: id, implementation: id, verification: id }),
    budget_policy: limits,
    concurrency_policy: object({ implementation_writers: integer(0, 2), read_only_workers: integer(0, 2), review_backlog: integer(1, 2) }),
    merge_policy: object({ tier }), uat_policy: enumeration('required', 'not_required'),
    completion_evidence: array(id, 1), approval: ref,
  }),
  PFM_APPROVAL_V1: record('PFM_APPROVAL_V1', {
    ...goalRevision, decision_scope: array(approvalDecision, 1), merge_tier: tier,
    purpose: enumeration('goal', 'merge', 'acceptance'), candidate_digest: nullable(digest),
    task_issue: nullable(revision), task_revision: nullable(revision), criteria: array(id),
    channel: id, nonce: id, expires_at: time,
  }),
  PFM_TASK_META_V1: record('PFM_TASK_META_V1', {
    goal_issue: revision, work_package: id, owner_stage: id, blocking_gate: id,
    depends_on: array(revision), requirement_ids: array(id, 1), approved_goal_revision: revision,
  }),
  SCOPE_CENSUS_V1: record('SCOPE_CENSUS_V1', {
    ...goalRevision, task_issue: revision, baseline_sha: sha, risk, rows: array(row, 1, 128),
    required_write_paths: array(path, 0, 128), read_only_exclusions: array(path, 0, 128),
    unresolved: array(text), review: nullable(ref),
  }),
  WORKSPACE_RECEIPT_V1: record('WORKSPACE_RECEIPT_V1', {
    task_issue: revision, issue_body_digest: digest, directory: path, environment: id,
    origin_repository: repository, branch, head_sha: sha, upstream_head_sha: nullable(sha),
    state: enumeration('ready', 'dirty', 'conflicted', 'diverged', 'unknown'),
    receipt_owner: id, writer_fence: revision, ready_proof: nullable(ref),
  }),
  EXECUTION_GRANT_V1: record('EXECUTION_GRANT_V1', {
    ...taskIdentity, issue_body_digest: digest, branch, head_sha: sha, v3_marker: v3,
    workspace_receipt_ref: ref, scope_census_ref: ref, runtime_profile_ref: ref, budget_reservation_ref: ref,
    writer_fence: revision, authorization_id: id, expires_at: time, revocation_ref: nullable(ref),
  }),
  RUNNER_CAPABILITIES_V1: record('RUNNER_CAPABILITIES_V1', {
    surface: enumeration('local', 'cloud'), product: id, runtime_version: nullable(id), tool_version: nullable(id),
    authentication_ref: nullable(ref), operations: object(Object.fromEntries(capabilities.map((name) => [name, capability]))),
  }),
  VERIFICATION_EVIDENCE_V1: record('VERIFICATION_EVIDENCE_V1', {
    ...taskRevision, candidate, checks: array(check, 0, 128), capability_versions: array(id), fixture_versions: array(id),
    disposition: enumeration('pending', 'approved', 'changes_required'), reviewer_evidence: nullable(ref),
  }),
  USAGE_OBSERVATION_V1: record('USAGE_OBSERVATION_V1', {
    ...taskIdentity, ...pool, source: id, value: nullable(quantity), quality: enumeration('observed', 'estimated', 'unknown'),
    coverage: enumeration('complete', 'partial', 'unknown'), observed_at: time, reset_at: nullable(time),
    model: nullable(id), reasoning: nullable(id), role: actor.properties.role, run_id: id,
  }),
  BUDGET_RESERVATION_V1: record('BUDGET_RESERVATION_V1', {
    ...taskIdentity, risk, runtime_profile_ref: ref, limits, estimated_ceiling: counter,
    carries: object({ account_liability: counter, goal_liability: counter, task_liability: counter, model_calls: counter, continuations: counter }),
    max_admitted_model_calls: counter, max_admitted_continuations: counter, expires_at: time,
    state: enumeration('reserved', 'started', 'ambiguous', 'stop_requested', 'terminal'),
    native_run_id: nullable(id), terminal_ack: nullable(acknowledgement),
  }),
  CONTEXT_CHECKPOINT_V1: record('CONTEXT_CHECKPOINT_V1', {
    ...taskIdentity, branch, head_sha: sha, workspace_receipt_ref: ref, artifacts: refs,
    settled_decisions: array(decisionBinding), unresolved_criteria: array(id), blockers: array(id),
    stopped_writer_ack: ref, next_action: id,
  }),
  PFM_TASK_EVENT_V1: record('PFM_TASK_EVENT_V1', {
    ...taskRevision, event_id: id, source: id, expected_revision: revision, head_sha: sha,
    kind: enumeration(...taskStates.filter((state) => state !== 'PLANNED')), payload_ref: ref, observed_at: time,
  }),
});

function freezeChildren(value) {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object') freezeChildren(child);
  }
  Object.freeze(value);
}

freezeChildren(schemas);
