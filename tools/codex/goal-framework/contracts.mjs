import { createHash } from 'node:crypto';
import { censusAlternatives, schemas, taskStates } from './schemas/v1.mjs';

const recordBytes = 128 * 1024;
const issueBytes = 256 * 1024;
const metadataStart = '<!-- PFM_TASK_META_V1';
const metadataEnd = '-->';

function requireContract(condition, code) {
  if (!condition) throw new Error(code);
}

// This serialization only accepts bounded JSON data, including when called on untrusted JS input.
// Object keys use JavaScript's UTF-16 order. Array order is significant.
export function canonicalJson(value, maxBytes = recordBytes) {
  let nodes = 0;
  let bytes = 0;
  function encode(input, depth) {
    requireContract(++nodes <= 24_000 && depth <= 16, 'JSON_BOUND');
    if (input === null || typeof input === 'boolean' || typeof input === 'number' || typeof input === 'string') {
      requireContract(typeof input !== 'number' || Number.isFinite(input), 'JSON_NUMBER');
      requireContract(typeof input !== 'string' || input.length <= maxBytes, 'JSON_BOUND');
      const encoded = JSON.stringify(input);
      bytes += Buffer.byteLength(encoded) + 1;
      requireContract(bytes <= maxBytes, 'JSON_BOUND');
      return encoded;
    }
    requireContract(input !== null && typeof input === 'object', 'JSON_TYPE');
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (Array.isArray(input)) {
      requireContract(input.length <= 256 && Reflect.ownKeys(descriptors).length === input.length + 1, 'JSON_ARRAY');
      return '[' + Array.from({ length: input.length }, (_, index) => {
        const entry = descriptors[index];
        requireContract(entry?.enumerable && Object.hasOwn(entry, 'value'), 'JSON_ARRAY');
        return encode(entry.value, depth + 1);
      }).join(',') + ']';
    }
    requireContract(Object.getPrototypeOf(input) === Object.prototype || Object.getPrototypeOf(input) === null, 'JSON_OBJECT');
    const keys = Reflect.ownKeys(descriptors);
    requireContract(keys.length <= 128 && keys.every((key) => typeof key === 'string' && key.length <= 128), 'JSON_OBJECT');
    return '{' + keys.sort().map((key) => {
      const entry = descriptors[key];
      requireContract(entry.enumerable && Object.hasOwn(entry, 'value'), 'JSON_OBJECT');
      return encode(key, depth + 1) + ':' + encode(entry.value, depth + 1);
    }).join(',') + '}';
  }
  const json = encode(value, 0);
  requireContract(Buffer.byteLength(json) <= maxBytes, 'JSON_BOUND');
  return json;
}

function hash(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function digest(value) {
  return hash(canonicalJson(value));
}

function validTime(value) {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === (value.length === 20 ? value.replace('Z', '.000Z') : value);
}

function match(value, schema, field) {
  const expect = (condition) => requireContract(condition, 'SHAPE ' + field);
  if (schema.anyOf) {
    if (value !== null) match(value, schema.anyOf[0], field);
    return;
  }
  if (Object.hasOwn(schema, 'const')) expect(value === schema.const);
  if (schema.enum) expect(schema.enum.includes(value));
  switch (schema.type) {
    case 'object':
      expect(value !== null && typeof value === 'object' && !Array.isArray(value));
      expect(schema.required.every((key) => Object.hasOwn(value, key)));
      for (const [key, child] of Object.entries(value)) {
        expect(Object.hasOwn(schema.properties, key));
        match(child, schema.properties[key], field + '.' + key);
      }
      break;
    case 'array':
      expect(Array.isArray(value) && value.length >= schema.minItems && value.length <= schema.maxItems);
      for (const child of value) match(child, schema.items, field + '[]');
      unique(value, canonicalJson, 'DUPLICATE ' + field);
      if (schema.items.properties?.id?.pattern) {
        unique(value, (child) => child.id, 'DUPLICATE_ID ' + field);
      }
      break;
    case 'string':
      expect(typeof value === 'string' && value.length >= schema.minLength && value.length <= schema.maxLength
        && value.trim() === value && !/[\u0000-\u001f\u007f-\u009f]/u.test(value));
      if (schema.pattern) expect(schema.pattern.test(value));
      if (schema.format === 'utc') expect(validTime(value));
      break;
    case 'integer':
    case 'number':
      expect(typeof value === 'number' && Number.isFinite(value) && value >= schema.minimum && value <= schema.maximum
        && (schema.type === 'number' || Number.isSafeInteger(value)));
      break;
    case 'boolean':
      expect(typeof value === 'boolean');
      break;
  }
}

function unique(items, key, code) {
  requireContract(new Set(items.map((item) => key(item))).size === items.length, code);
}

function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function sameFields(left, right, fields) {
  return fields.every((key) => left[key] === right[key]);
}

function sameSet(left, right) {
  return same([...left].sort(), [...right].sort());
}

function referenceMatches(reference, record) {
  return reference.id === record.id && reference.digest === digest(record);
}

function atOrBefore(left, right) {
  return Date.parse(left) <= Date.parse(right);
}

const protectedPaths = [
  'agents.md', '.agents', '.codex', '.github/workflows', 'tools/codex', 'tools/ci',
  'docs/development/handoff-authoring-policy.md', 'docs/development/verification-policy.md',
  'docs/development/goal-framework', 'test/goalframeworkcontracts.test.ts', 'test/fixtures/goalframework/contracts',
];
const runtimePaths = ['.codex/runtime', '.pfm-preflight', '.aws', 'tools/codex/goal-framework/runtime'];

function containsPath(base, path) {
  return base === path || path.startsWith(base + '/');
}

function relatedPath(base, path) {
  return containsPath(base, path) || containsPath(path, base);
}

function pathParts(path) {
  const parts = path.split('/');
  requireContract(/^[A-Za-z0-9_.\/-]+$/.test(path)
    && parts.every((part) => !['', '.', '..', '.git'].includes(part.toLowerCase()) && !part.endsWith('.')), 'UNSAFE_PATH');
  return parts;
}

export function validatePath(path, { pattern = false, taskKind, write = true } = {}) {
  requireContract(typeof path === 'string' && path.length <= 240, 'UNSAFE_PATH');
  const subtree = pattern && path.endsWith('/**');
  const base = subtree ? path.slice(0, -3) : path;
  const parts = pathParts(base);
  if (pattern) {
    requireContract(subtree ? parts.length >= 3 : parts.at(-1).includes('.') && !parts.at(-1).startsWith('.'), 'UNSAFE_PATTERN');
  }
  if (write) {
    const lower = base.toLowerCase();
    requireContract(!runtimePaths.some((protectedPath) => relatedPath(protectedPath, lower)), 'PROTECTED_RUNTIME_PATH');
    if (taskKind === 'product' || taskKind === 'repair') {
      requireContract(!protectedPaths.some((protectedPath) => relatedPath(protectedPath, lower))
        && !lower.startsWith('docs/development/agent-'), 'PROTECTED_FRAMEWORK_PATH');
    }
  }
  return path;
}

function checkBranch(branch) {
  for (const part of pathParts(branch)) {
    requireContract(!part.startsWith('.') && !part.endsWith('.lock') && !part.includes('..'), 'UNSAFE_BRANCH');
  }
}

function checkLimits(limits) {
  requireContract(limits.cleanup_reserve <= limits.task_ceiling && limits.task_ceiling <= limits.goal_ceiling
    && limits.goal_ceiling <= limits.account_ceiling, 'BUDGET_HIERARCHY');
}

function checkReservation(record) {
  const { limits, carries } = record;
  checkLimits(limits);
  requireContract(record.estimated_ceiling + limits.cleanup_reserve <= Math.min(
    limits.account_ceiling - carries.account_liability, limits.goal_ceiling - carries.goal_liability,
    limits.task_ceiling - carries.task_liability,
  ) && record.max_admitted_model_calls <= limits.max_model_calls - carries.model_calls
    && record.max_admitted_continuations <= limits.max_continuations - carries.continuations, 'CUMULATIVE_BUDGET');
  requireContract(atOrBefore(record.created_at, record.expires_at)
    && atOrBefore(record.expires_at, limits.execution_deadline), 'RESERVATION_WINDOW');
  const ack = record.terminal_ack;
  requireContract((record.state === 'terminal') === (ack !== null), 'TERMINAL_ACK');
  if (record.state === 'reserved') requireContract(record.native_run_id === null, 'RESERVED_RUN');
  if (record.state === 'started') requireContract(record.native_run_id !== null, 'RUN_ID');
  if (ack) {
    requireContract(ack.native_run_id === record.native_run_id && atOrBefore(record.created_at, ack.observed_at), 'TERMINAL_RUN');
  }
}

const semantics = {
  PFM_GOAL_V1(record) {
    requireContract(record.control_revision <= record.revision && record.observation_revision <= record.revision, 'GOAL_REVISION');
    checkLimits(record.budget_policy);
  },
  PFM_APPROVAL_V1(record) {
    const isGoal = record.purpose === 'goal';
    requireContract(record.producer.role === 'pm' && isGoal === (record.candidate_digest === null)
      && isGoal === (record.task_issue === null) && isGoal === (record.task_revision === null)
      && (record.purpose === 'acceptance') === (record.criteria.length > 0)
      && atOrBefore(record.created_at, record.expires_at), 'APPROVAL_SHAPE');
  },
  SCOPE_CENSUS_V1(record) {
    for (const path of record.required_write_paths) validatePath(path);
    for (const path of record.read_only_exclusions) validatePath(path, { write: false });
    for (const row of record.rows) validatePath(row.path, { write: false });
    unique(record.required_write_paths, (path) => path.toLowerCase(), 'DUPLICATE_WRITE_PATH');
    unique(record.read_only_exclusions, (path) => path.toLowerCase(), 'DUPLICATE_EXCLUSION');
    requireContract(record.required_write_paths.every((path) => !record.read_only_exclusions.some((excluded) =>
      relatedPath(excluded.toLowerCase(), path.toLowerCase()))), 'EXCLUDED_WRITE');
  },
  WORKSPACE_RECEIPT_V1(record) {
    checkBranch(record.branch);
    requireContract(/^\/[^\u0000-\u001f\\]+$/.test(record.directory)
      && record.directory.slice(1).split('/').every((part) => part && part !== '.' && part !== '..'), 'WORKSPACE_DIRECTORY');
    requireContract(record.origin_repository === record.repository, 'WORKSPACE_ORIGIN');
    if (record.state === 'ready') requireContract(record.ready_proof !== null
      && (record.upstream_head_sha === null || record.head_sha === record.upstream_head_sha), 'WORKSPACE_READY');
  },
  EXECUTION_GRANT_V1(record) {
    checkBranch(record.branch);
    requireContract(atOrBefore(record.created_at, record.expires_at), 'GRANT_WINDOW');
  },
  RUNNER_CAPABILITIES_V1(record) {
    for (const capability of Object.values(record.operations)) {
      requireContract(capability.status !== 'verified' || (capability.evidence.length > 0
        && record.runtime_version !== null && record.tool_version !== null && record.authentication_ref !== null), 'CAPABILITY_EVIDENCE');
    }
  },
  RUNNER_PROFILE_BINDING_V1(record) {
    requireContract(record.producer.role === 'supervisor'
      && atOrBefore(record.created_at, record.expires_at), 'RUNNER_BINDING_WINDOW_OR_OWNER');
  },
  VERIFICATION_EVIDENCE_V1(record) {
    unique(record.checks, (check) => check.id, 'DUPLICATE_CHECK');
    requireContract(record.disposition !== 'approved' || (record.producer.role === 'reviewer'
      && record.reviewer_evidence !== null), 'REVIEW_EVIDENCE');
  },
  USAGE_OBSERVATION_V1(record) {
    requireContract((record.quality === 'unknown') === (record.value === null)
      && (record.coverage !== 'unknown' || record.quality === 'unknown')
      && (record.reset_at === null || atOrBefore(record.observed_at, record.reset_at)), 'USAGE_COVERAGE');
  },
  BUDGET_RESERVATION_V1: checkReservation,
  CONTEXT_CHECKPOINT_V1(record) { checkBranch(record.branch); },
};

// Shape validation returns detached data. It cannot perform an authority decision by itself.
export function validateRecord(value, expectedSchema) {
  const record = JSON.parse(canonicalJson(value));
  requireContract(record && Object.hasOwn(schemas, record.schema)
    && (expectedSchema === undefined || record.schema === expectedSchema), 'UNKNOWN_SCHEMA');
  match(record, schemas[record.schema], record.schema);
  if (Object.hasOwn(semantics, record.schema)) semantics[record.schema](record);
  return record;
}

function attest(verify, boundary, binding) {
  requireContract(typeof verify === 'function' && verify(boundary, JSON.parse(canonicalJson(binding))) === true,
    'UNAUTHENTICATED ' + boundary);
}

export function goalControlDigest(value) {
  const goal = validateRecord(value, 'PFM_GOAL_V1');
  const { revision, observation_revision, approval, producer, created_at, references, ...control } = goal;
  return digest(control);
}

const goalKeys = ['repository', 'goal_issue', 'goal_revision', 'goal_control_digest'];
const taskKeys = [...goalKeys, 'task_issue', 'task_revision'];

export function validateApproval(value, expected, { now, verify, consumedNonces }) {
  const approval = validateRecord(value, 'PFM_APPROVAL_V1');
  requireContract(validTime(now) && atOrBefore(approval.created_at, now)
    && Date.parse(now) < Date.parse(approval.expires_at), 'APPROVAL_TIME');
  requireContract(sameFields(approval, expected, [...taskKeys, 'merge_tier', 'purpose', 'candidate_digest'])
    && sameSet(approval.decision_scope, expected.decision_scope)
    && sameSet(approval.criteria, expected.criteria), 'APPROVAL_BINDING');
  requireContract(consumedNonces instanceof Set && !consumedNonces.has(approval.nonce), 'APPROVAL_REPLAY');
  // The trust source verifies the whole signed event and current revocation/nonce status.
  attest(verify, 'human_approval', approval);
  return approval;
}

export function validateGoal(value, approval, authority) {
  const goal = validateRecord(value, 'PFM_GOAL_V1');
  const goal_revision = goal.control_revision;
  const goal_control_digest = goalControlDigest(goal);
  requireContract(goal.merge_policy.tier === 'manual', 'MERGE_ACTIVATION_DISABLED');
  const decision_scope = new Set(['product', ...goal.approved_decisions.map((item) => item.domain)]);
  if (goal.uat_policy === 'required') decision_scope.add('uat');
  const approved = validateApproval(approval, {
    repository: goal.repository, goal_issue: goal.goal_issue, goal_revision, goal_control_digest,
    merge_tier: goal.merge_policy.tier, purpose: 'goal', decision_scope, candidate_digest: null,
    task_issue: null, task_revision: null, criteria: [],
  }, authority);
  requireContract(referenceMatches(goal.approval, approved), 'GOAL_APPROVAL_REFERENCE');
  attest(authority.verify, 'live_goal_control', { repository: goal.repository, goal_issue: goal.goal_issue, goal_revision, goal_control_digest });
  return goal;
}

export function planAlignedTask(goalValue, approval, task, authority) {
  const goal = validateGoal(goalValue, approval, authority);
  return alignTask(goal, goalControlDigest(goal), task);
}

function alignTask(goal, controlDigest, task) {
  requireContract(task?.approved_goal_revision === goal.control_revision && task.goal_control_digest === controlDigest,
    'STALE_ALIGNMENT');
  const { decisions, unresolved, risk, independentOutcome, coherent, relatedBatch } = task;
  requireContract(Array.isArray(decisions) && Array.isArray(unresolved) && decisions.length <= 64 && unresolved.length <= 64
    && [independentOutcome, coherent, relatedBatch].every((flag) => typeof flag === 'boolean')
    && ['simple', 'standard', 'cross-cutting'].includes(risk), 'PLANNING_INPUT');
  const sizing = !coherent ? 'split' : !independentOutcome ? 'reuse' : relatedBatch ? 'batch' : 'retain';
  if (sizing === 'split') return { sizing, phase: 'Alignment', disposition: 'split' };
  requireContract(unresolved.length === 0 && decisions.every((entry) =>
    goal.approved_decisions.some((approved) => same(entry, approved))), 'UNRESOLVED_OR_CONFLICTING_ALIGNMENT');
  unique(decisions, (entry) => entry.id, 'DUPLICATE_INHERITED_DECISION');
  return { sizing, phase: 'Planning', disposition: 'aligned', scopeReview: risk === 'cross-cutting' ? 'closure' : 'focused' };
}

function issueLines(body) {
  requireContract(typeof body === 'string' && Buffer.byteLength(body) <= issueBytes, 'ISSUE_BOUND');
  requireContract(!/\r(?!\n)|\u0000/u.test(body), 'ISSUE_LINE_ENDINGS');
  return body.split(/\r?\n/u);
}

// Additional restrictive checks. The hook's actual saved-body parser remains mandatory.
export function inspectV3Body(body) {
  const lines = issueLines(body);
  requireContract(lines[0] === 'PFM_TASK_V3'
    && lines.filter((line) => /^\s*PFM_TASK_V\d+\s*$/.test(line)).length === 1, 'V3_MARKER');
  function header(name, inline) {
    const headerPattern = new RegExp('^\\s*' + name + '\\s*:');
    const entries = lines.flatMap((line, index) => headerPattern.test(line) ? [index] : []);
    requireContract(entries.length === 1 && lines[entries[0]].startsWith(name + ':'), 'V3_HEADER ' + name);
    const index = entries[0];
    const suffix = lines[index].slice(name.length + 1);
    if (inline) {
      requireContract(/^ [^\s]+$/.test(suffix), 'V3_HEADER ' + name);
      return suffix.slice(1);
    }
    requireContract(suffix === '', 'V3_HEADER ' + name);
    const end = lines.findIndex((line, next) => next > index && /^[A-Z][A-Z0-9_]*:\s*$/.test(line));
    const section = lines.slice(index + 1, end === -1 ? undefined : end).join('\n').trim();
    requireContract(section !== '', 'V3_SECTION ' + name);
    return section;
  }
  const taskKind = header('TASK_KIND', true);
  const branch = header('TARGET_BRANCH', true);
  const dependencyPolicy = header('DEPENDENCY_POLICY', true);
  requireContract(['product', 'repair', 'framework'].includes(taskKind)
    && ['locked', 'manifest_edit'].includes(dependencyPolicy)
    && /^(codex|agent)\/[A-Za-z0-9_.\/-]+$/.test(branch) && branch.length <= 200, 'V3_SCALARS');
  checkBranch(branch);
  header('OBJECTIVE');
  header('ACCEPTANCE');
  const allowedPaths = header('ALLOWED_PATHS').split('\n').filter((line) => line.trim() !== '').map((line) => {
    requireContract(/^- \S+$/.test(line), 'V3_PATH_LINE');
    return validatePath(line.slice(2), { pattern: true, taskKind });
  });
  requireContract(allowedPaths.length <= 128, 'V3_PATHS_BOUND');
  unique(allowedPaths, (path) => path.toLowerCase(), 'V3_DUPLICATE_PATH');
  return { taskKind, branch, dependencyPolicy, allowedPaths, issueBodyDigest: hash(body) };
}

// JSON.parse validates syntax first. Walk its tokens once to detect duplicate object keys,
// including when one spelling uses JSON escapes.
function parseUniqueJson(json) {
  let value;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error('METADATA_JSON');
  }
  canonicalJson(value);
  const objects = [];
  const tokens = json.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\]:,]/gu);
  for (const token of tokens) {
    const key = token[0];
    if (key === '{' || key === '[') objects.push(key === '{' ? new Set() : null);
    if (key === '}' || key === ']') objects.pop();
    if (key.startsWith('"') && /^\s*:/.test(json.slice(token.index + key.length))) {
      const decoded = JSON.parse(key);
      const current = objects.at(-1);
      requireContract(!current.has(decoded), 'METADATA_DUPLICATE_KEY');
      current.add(decoded);
    }
  }
  return value;
}

export function readTaskMetadata(body, { repository, taskIssue } = {}) {
  issueLines(body);
  requireContract(body.split(metadataStart).length === 2, 'METADATA_MARKER');
  const lines = body.split(/\r?\n/u);
  const start = lines.indexOf(metadataStart);
  const end = lines.indexOf(metadataEnd, start + 1);
  requireContract(start > 0 && end > start + 1, 'METADATA_MARKER');
  const record = validateRecord(parseUniqueJson(lines.slice(start + 1, end).join('\n')), 'PFM_TASK_META_V1');
  requireContract(record.repository === repository && Number.isSafeInteger(taskIssue) && taskIssue > 0
    && taskIssue !== record.goal_issue && !record.depends_on.includes(taskIssue)
    && !record.depends_on.includes(record.goal_issue), 'TASK_METADATA_IDENTITY');
  return record;
}

export function validateScopeCensus(value, { v3, requirements, implementer, verify }) {
  const census = validateRecord(value, 'SCOPE_CENSUS_V1');
  requireContract(census.review !== null && census.unresolved.length === 0, 'UNREVIEWED_SCOPE');
  const { rows } = census;
  const routeKey = ({ entry, alternative }) => entry + '/' + alternative;
  requireContract(Array.isArray(requirements) && requirements.length >= 1 && requirements.length <= 128, 'SCOPE_INVENTORY');
  for (const route of requirements) {
    requireContract(typeof route?.entry === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/.test(route.entry)
      && censusAlternatives.includes(route.alternative), 'SCOPE_INVENTORY');
  }
  unique(requirements, routeKey, 'DUPLICATE_SCOPE_ROUTE');
  requireContract(sameSet([...new Set(rows.map(routeKey))], requirements.map(routeKey)), 'SCOPE_CLOSURE');
  for (const row of rows) {
    requireContract(row.ownership !== 'unknown' && Object.values(row.boundaries).every((stage) => stage.disposition !== 'unknown'),
      'UNKNOWN_SCOPE_OWNERSHIP');
    requireContract(row.positive_evidence.length > 0 && row.negative_evidence.length > 0, 'SCOPE_ROW_EVIDENCE');
    if (row.ownership === 'read_only') {
      requireContract(census.read_only_exclusions.includes(row.path), 'UNLISTED_READ_ONLY_PATH');
    }
  }
  const writeRows = rows.filter((row) => row.ownership === 'task_write' || row.ownership === 'test_migration');
  requireContract(sameSet([...new Set(writeRows.map((row) => row.path))], census.required_write_paths), 'SCOPE_WRITE_SET');
  for (const path of census.required_write_paths) {
    validatePath(path, { taskKind: v3.taskKind });
    requireContract(v3.allowedPaths.some((pattern) => pattern.endsWith('/**')
      ? path.startsWith(pattern.slice(0, -2)) : path === pattern), 'PATH_OUTSIDE_V3');
  }
  requireContract(v3.allowedPaths.every((pattern) => census.required_write_paths.some((path) => pattern.endsWith('/**')
    ? path.startsWith(pattern.slice(0, -2)) : path === pattern)), 'UNJUSTIFIED_V3_PATH');
  attest(verify, 'independent_scope_review', { census, requirements, implementer, v3 });
  const dependencies = rows.filter((row) => row.ownership === 'framework_dependency');
  if (dependencies.length > 0) {
    attest(verify, 'resolved_framework_dependencies', { census, dependencies });
  }
  return census;
}

export function reservationDisposition(value, { now, verify }) {
  const reservation = validateRecord(value, 'BUDGET_RESERVATION_V1');
  requireContract(validTime(now) && atOrBefore(reservation.created_at, now), 'RESERVATION_CLOCK');
  requireContract(reservation.producer.role === 'supervisor', 'RESERVATION_OWNER');
  attest(verify, 'live_budget_reservation', reservation);
  if (reservation.terminal_ack) {
    requireContract(atOrBefore(reservation.terminal_ack.observed_at, now), 'FUTURE_TERMINAL_ACK');
    attest(verify, 'terminal_run', reservation);
    return 'settlement_required';
  }
  const expired = atOrBefore(reservation.expires_at, now);
  if (reservation.state === 'reserved') {
    return expired ? 'reconcile_unstarted' : 'eligible_for_admission';
  }
  return expired || reservation.state === 'stop_requested' || reservation.state === 'ambiguous'
    ? 'stop_and_reconcile' : 'retain_liability';
}

export function validateExecutionGrant(value, input, authority) {
  const grant = validateRecord(value, 'EXECUTION_GRANT_V1');
  const { verify, now } = authority;
  const goal = validateGoal(input.goal, input.approval, authority);
  requireContract(goal.repository === grant.repository && goal.goal_issue === grant.goal_issue
    && goal.control_revision === grant.goal_revision && goalControlDigest(goal) === grant.goal_control_digest, 'GRANT_GOAL');
  const alignment = alignTask(goal, grant.goal_control_digest, input.taskAlignment);
  requireContract(alignment.disposition === 'aligned' && alignment.sizing !== 'reuse', 'GRANT_ALIGNMENT');
  requireContract(grant.revocation_ref === null && atOrBefore(grant.created_at, now)
    && !atOrBefore(grant.expires_at, now), 'GRANT_INACTIVE');
  const v3 = inspectV3Body(input.savedBody);
  requireContract(v3.issueBodyDigest === grant.issue_body_digest && v3.branch === grant.branch, 'GRANT_V3_BINDING');
  attest(verify, 'saved_open_v3_actual_parser', {
    repository: grant.repository, taskIssue: grant.task_issue, taskRevision: grant.task_revision, ...v3,
  });

  const workspace = validateRecord(input.workspace, 'WORKSPACE_RECEIPT_V1');
  requireContract(referenceMatches(grant.workspace_receipt_ref, workspace)
    && workspace.state === 'ready' && sameFields(grant, workspace, [
      'repository', 'task_issue', 'issue_body_digest', 'branch', 'head_sha', 'writer_fence',
    ]), 'GRANT_WORKSPACE');
  attest(verify, 'live_workspace_receipt', workspace);
  const census = validateScopeCensus(input.census, {
    v3, requirements: input.scopeRequirements, implementer: workspace.receipt_owner, verify,
  });
  requireContract(referenceMatches(grant.scope_census_ref, census) && sameFields(grant, census, [...goalKeys, 'task_issue'])
    && grant.head_sha === census.baseline_sha && census.risk === input.taskAlignment.risk, 'GRANT_CENSUS');
  // The actual mutation boundary must repeat this check with resolved paths and current Git state.
  attest(verify, 'resolved_workspace_scope', { workspace, paths: census.required_write_paths, patterns: v3.allowedPaths });

  const runner = validateRecord(input.runner, 'RUNNER_CAPABILITIES_V1');
  requireContract(referenceMatches(grant.runtime_profile_ref, runner) && runner.repository === grant.repository, 'GRANT_RUNNER');
  requireContract([
    'prepare', 'launch', 'observe', 'stop', 'pre_write_scope', 'post_write_scope', 'recovery', 'budget_enforcement',
    'terminal_acknowledgement', 'separate_credentials', 'writer_fencing',
  ].every((operation) => runner.operations[operation].status === 'verified'), 'UNCERTIFIED_WRITER_CONTROLS');
  attest(verify, 'live_runner_profile', runner);
  const reservation = validateRecord(input.reservation, 'BUDGET_RESERVATION_V1');
  requireContract(referenceMatches(grant.budget_reservation_ref, reservation)
    && sameFields(grant, reservation, [...taskKeys, 'lineage_id'])
    && reservation.risk === census.risk
    && atOrBefore(grant.expires_at, reservation.expires_at), 'GRANT_RESERVATION');
  const limits = reservation.limits;
  const policy = goal.budget_policy;
  requireContract(sameFields(limits, policy, ['pool_id', 'account_scope', 'unit'])
    && limits.account_epoch >= policy.account_epoch
    && ['account_ceiling', 'goal_ceiling', 'task_ceiling', 'max_model_calls', 'max_continuations'].every((key) => limits[key] <= policy[key])
    && limits.cleanup_reserve >= policy.cleanup_reserve
    && atOrBefore(limits.execution_deadline, policy.execution_deadline), 'GRANT_BUDGET_POLICY');
  requireContract(reservationDisposition(reservation, authority) === 'eligible_for_admission', 'GRANT_RESERVATION_INACTIVE');
  requireContract(input.runnerBinding != null, 'GRANT_RUNNER_BINDING_REQUIRED');
  const binding = validateRecord(input.runnerBinding, 'RUNNER_PROFILE_BINDING_V1');
  requireContract(grant.references.some((ref) => referenceMatches(ref, binding))
    && grant.references.filter(({ id }) => id === binding.id).length === 1
    && sameFields(grant, binding, [...taskKeys, 'lineage_id', 'authorization_id', 'writer_fence'])
    && same(grant.budget_reservation_ref, binding.budget_reservation_ref)
    && same(grant.workspace_receipt_ref, binding.workspace_receipt_ref)
    && binding.grant_id === grant.id && binding.surface === runner.surface
    && same(binding.runner_ref, grant.runtime_profile_ref)
    && same(binding.resource_profile_ref, reservation.runtime_profile_ref)
    && binding.runner_ref.id !== binding.resource_profile_ref.id
    && binding.runner_ref.digest !== binding.resource_profile_ref.digest, 'GRANT_RUNNER_BINDING');
  requireContract(binding.revocation_ref === null && atOrBefore(binding.created_at, grant.created_at)
    && !atOrBefore(binding.expires_at, now) && atOrBefore(grant.expires_at, binding.expires_at)
    && atOrBefore(binding.expires_at, reservation.expires_at),
  'GRANT_RUNNER_BINDING_INACTIVE');
  const profile = input.resourceProfile;
  const risks = ['simple', 'standard', 'cross-cutting'];
  requireContract(profile?.status === 'verified' && referenceMatches(binding.resource_profile_ref, profile)
    && sameFields(binding, profile, ['surface', 'runtime', 'model', 'reasoning'])
    && Array.isArray(profile.operations) && profile.operations.includes('implementation')
    && risks.indexOf(profile.max_risk) >= risks.indexOf(reservation.risk), 'GRANT_RESOURCE_PROFILE');
  const runtime = input.runtimeIdentity;
  requireContract(runtime && sameFields(binding, runtime, [
    'surface', 'transport', 'config_digest', 'permissions_digest', 'control_revision', 'runtime',
  ]) && runtime.resource_profile != null && same(binding.resource_profile_ref, runtime.resource_profile)
    && sameFields(runner, runtime, ['product', 'runtime_version', 'tool_version'])
    && runtime.authentication_ref != null && same(runner.authentication_ref, runtime.authentication_ref),
  'GRANT_RUNTIME_IDENTITY');
  attest(verify, 'live_runner_resource_profile_binding', { grant, binding, runner, profile, runtime, reservation, workspace });
  attest(verify, 'live_execution_grant', { grant, taskAlignment: input.taskAlignment });
  return grant;
}

export function validateVerificationEvidence(value, { task, candidate, plan, implementer, verify }) {
  const evidence = validateRecord(value, 'VERIFICATION_EVIDENCE_V1');
  requireContract(sameFields(evidence, task, taskKeys) && same(evidence.candidate, candidate), 'EVIDENCE_CANDIDATE');
  requireContract(Array.isArray(plan) && plan.length > 0 && plan.length <= 128
    && digest(plan) === candidate.verification_plan_digest, 'VERIFICATION_PLAN');
  requireContract(plan.every((check) => typeof check?.id === 'string' && typeof check.required === 'boolean'
    && typeof check.artifact_required === 'boolean'), 'CHECK_INVENTORY');
  unique(plan, (check) => check.id, 'DUPLICATE_PLAN_CHECK');
  const expected = new Map(plan.map((check) => [check.id, check]));
  requireContract(evidence.checks.length === expected.size, 'MISSING_CHECK');
  let requiredChecks = 0;
  for (const check of evidence.checks) {
    const planned = expected.get(check.id);
    requireContract(planned && planned.required === check.required, 'CHECK_INVENTORY');
    if (planned.required) {
      requiredChecks++;
      requireContract(check.outcome === 'PASS', 'REQUIRED_CHECK_NOT_PASSED');
    } else {
      requireContract(['PASS', 'SKIP', 'NOT_APPLICABLE'].includes(check.outcome), 'OPTIONAL_CHECK_FAILURE');
    }
    requireContract(check.outcome !== 'PASS' || !planned.artifact_required || check.artifacts.length > 0, 'CHECK_ARTIFACT');
  }
  requireContract(requiredChecks > 0, 'NO_REQUIRED_CHECKS');
  requireContract(evidence.disposition === 'approved' && evidence.producer.actor !== implementer?.actor
    && evidence.producer.session !== implementer?.session && typeof implementer?.actor === 'string'
    && typeof implementer?.session === 'string', 'INDEPENDENT_REVIEW');
  attest(verify, 'exact_candidate_checks', { evidence, plan });
  attest(verify, 'independent_verification_review', { evidence, implementer });
  return evidence;
}

export function validateCheckpoint(value, { current, receipt, verify }) {
  const checkpoint = validateRecord(value, 'CONTEXT_CHECKPOINT_V1');
  const workspace = validateRecord(receipt, 'WORKSPACE_RECEIPT_V1');
  requireContract(sameFields(checkpoint, current, [...taskKeys, 'lineage_id', 'branch', 'head_sha'])
    && sameFields(checkpoint, workspace, ['repository', 'task_issue', 'branch', 'head_sha'])
    && current.issue_body_digest === workspace.issue_body_digest
    && workspace.state === 'ready' && referenceMatches(checkpoint.workspace_receipt_ref, workspace), 'STALE_CHECKPOINT');
  for (const key of ['settled_decisions', 'unresolved_criteria', 'blockers']) {
    requireContract(Array.isArray(current[key]) && current[key].length <= 64
      && sameSet(checkpoint[key].map((entry) => canonicalJson(entry)), current[key].map((entry) => canonicalJson(entry))),
    'CHECKPOINT_DROPPED_' + key);
  }
  attest(verify, 'live_checkpoint_authority', { checkpoint, workspace });
  attest(verify, 'stopped_checkpoint_writer', { checkpoint, workspace });
  return checkpoint;
}

const transitions = {
  PLANNED: ['READY', 'BLOCKED', 'PM_DECISION_REQUIRED', 'CANCELLED'],
  READY: ['RUNNING', 'BLOCKED', 'PAUSED', 'PM_DECISION_REQUIRED', 'CANCELLED'],
  RUNNING: ['PUBLISHED', 'BLOCKED', 'PAUSED', 'FAILED', 'CANCELLED'],
  PUBLISHED: ['VERIFYING', 'BLOCKED', 'REPAIR_REQUIRED'],
  VERIFYING: ['MERGE_READY', 'BLOCKED', 'REPAIR_REQUIRED', 'UAT_PENDING', 'PM_DECISION_REQUIRED', 'FAILED'],
  MERGE_READY: ['MERGED', 'BLOCKED', 'REPAIR_REQUIRED', 'UAT_PENDING', 'PM_DECISION_REQUIRED'],
  MERGED: ['ACCEPTED'],
  ACCEPTED: [],
  BLOCKED: ['READY', 'CANCELLED'],
  REPAIR_REQUIRED: ['READY', 'FAILED', 'CANCELLED'],
  PM_DECISION_REQUIRED: ['READY', 'VERIFYING', 'CANCELLED'],
  UAT_PENDING: ['VERIFYING', 'PM_DECISION_REQUIRED', 'CANCELLED'],
  PAUSED: ['READY', 'CANCELLED'],
  FAILED: [],
  CANCELLED: [],
};

// Pure proposal. The caller compares/sets the task revision, event tombstone and any
// consumed nonce atomically. There are no native effects or fallback retries here.
export function proposeTaskTransition(state, value, input, authority) {
  const event = validateRecord(value, 'PFM_TASK_EVENT_V1');
  const { verify, now } = authority;
  requireContract(validTime(now) && atOrBefore(event.created_at, event.observed_at)
    && atOrBefore(event.observed_at, now)
    && sameFields(event, state, [...goalKeys, 'task_issue']) && taskStates.includes(state.status), 'EVENT_TASK');
  attest(verify, 'task_event', event);
  requireContract(input.seenEvents instanceof Map, 'EVENT_RECEIPTS');
  const eventDigest = digest(event);
  if (input.seenEvents.has(event.event_id)) {
    requireContract(input.seenEvents.get(event.event_id) === eventDigest, 'EVENT_ID_CONFLICT');
    return { disposition: 'duplicate', state };
  }
  requireContract(event.expected_revision === state.revision && event.task_revision === state.task_revision
    && Number.isSafeInteger(state.revision) && state.revision > 0 && Number.isSafeInteger(state.revision + 1), 'EVENT_REVISION');
  requireContract(event.head_sha === state.head_sha || event.kind === 'PUBLISHED', 'EVENT_HEAD');
  requireContract(transitions[state.status].includes(event.kind), 'EVENT_TRANSITION');

  let consumeNonce = null;
  let grant_ref = state.grant_ref ?? null;
  if (event.kind === 'READY') {
    const grant = validateExecutionGrant(input.grant, input.grantInputs, authority);
    requireContract(sameFields(grant, state, [...taskKeys, 'head_sha'])
      && referenceMatches(event.payload_ref, grant), 'EVENT_GRANT');
    grant_ref = event.payload_ref;
  }
  if (event.kind === 'RUNNING') {
    requireContract(grant_ref !== null, 'EVENT_GRANT');
    attest(verify, 'native_start_acknowledgement', { event, grant_ref });
  }
  if (event.kind === 'VERIFYING') requireContract(typeof state.candidate_digest === 'string', 'VERIFICATION_WITHOUT_PUBLICATION');
  if (event.kind === 'MERGE_READY' || event.kind === 'MERGED' || event.kind === 'ACCEPTED'
      || event.kind === 'UAT_PENDING') {
    const goal = validateGoal(input.goal, input.goalApproval, authority);
    requireContract(goal.repository === state.repository && goal.goal_issue === state.goal_issue
      && goal.control_revision === state.goal_revision && goalControlDigest(goal) === state.goal_control_digest, 'EVENT_GOAL');
    const candidate = input.candidate;
    requireContract(candidate?.head_sha === state.head_sha && digest(candidate) === state.candidate_digest, 'EVENT_CANDIDATE');
    const evidence = validateVerificationEvidence(input.evidence, {
      task: state, candidate, plan: input.plan, implementer: input.implementer, verify,
    });
    if (event.kind === 'MERGE_READY' || event.kind === 'UAT_PENDING') {
      requireContract(referenceMatches(event.payload_ref, evidence), 'EVENT_EVIDENCE');
    }
    if (goal.uat_policy === 'required' && event.kind !== 'UAT_PENDING') {
      attest(verify, 'human_uat_acceptance', { candidate, evidence, task: state });
    }
    if (event.kind === 'MERGED' || event.kind === 'ACCEPTED') {
      const purpose = event.kind === 'MERGED' ? 'merge' : 'acceptance';
      const decision_scope = purpose === 'acceptance' && goal.uat_policy === 'required'
        ? [purpose, 'uat'] : [purpose];
      const criteria = purpose === 'acceptance' ? input.acceptanceCriteria : [];
      if (purpose === 'acceptance') {
        requireContract(Array.isArray(criteria) && criteria.length > 0 && criteria.length <= 64, 'ACCEPTANCE_CRITERIA');
        attest(verify, 'complete_acceptance_criteria', { task: state, criteria });
      }
      const approval = validateApproval(input.candidateApproval, {
        ...state, purpose, decision_scope, criteria, candidate_digest: state.candidate_digest, merge_tier: goal.merge_policy.tier,
      }, authority);
      if (event.kind === 'ACCEPTED') requireContract(referenceMatches(event.payload_ref, approval), 'EVENT_ACCEPTANCE');
      if (event.kind === 'MERGED') attest(verify, 'actual_merge_confirmation', { event, candidate, approval });
      consumeNonce = approval.nonce;
    }
  }

  // In particular, PUBLISHED requires confirmed complete publication and MERGED
  // an actual provider merge receipt. A lost acknowledgement leaves the prior state.
  attest(verify, 'task_transition_evidence', { from: state, event });
  let candidate_digest = state.candidate_digest;
  if (event.kind === 'PUBLISHED') {
    const candidate = input.candidate;
    requireContract(candidate?.head_sha === event.head_sha, 'PUBLICATION_HEAD');
    match(JSON.parse(canonicalJson(candidate)), schemas.VERIFICATION_EVIDENCE_V1.properties.candidate, 'publication.candidate');
    attest(verify, 'complete_publication', { event, candidate });
    candidate_digest = digest(candidate);
  }
  return {
    disposition: 'applied',
    state: { ...state, status: event.kind, revision: state.revision + 1, head_sha: event.head_sha, candidate_digest, grant_ref },
    receipt: { event_id: event.event_id, digest: eventDigest },
    consumeNonce,
  };
}
