import { closeSync, constants, fsyncSync, mkdirSync, openSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { canonicalJson, digest, reservationDisposition, validateCheckpoint } from './contracts.mjs';
import { levelOneBody, reviewPreparation, savedAuthorization, sha256 } from './authorization.mjs';
import { identifier, readBoundedFile, resolveScopedPaths, reviewWorkspace, sha } from './workspace.mjs';
import { requireResource, resourceAttest, resourceRef, resourceTime } from './resources.mjs';

const version = 'PFM_LIFECYCLE_JOURNAL_V1';
const maxBytes = 1024 * 1024;
const maxEvents = 256;
const maxTasks = 64;
const replayMs = 24 * 60 * 60 * 1000;
const reconcileMs = 15 * 60 * 1000;
const maxReads = 4;
const maxDispatches = 2;
const inputHash = (input) => sha256(canonicalJson(input, maxBytes));

function syncDirectory(directory) {
  const fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function save(directory, state, fault) {
  const snapshot = canonicalJson(state, maxBytes - 128);
  const bytes = `{"digest":"${sha256(snapshot)}","state":${snapshot}}`;
  const temporary = join(directory, 'pending.json');
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    try {
      writeFileSync(fd, bytes, 'utf8');
      fault?.('before-sync');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, join(directory, 'state.json'));
    fault?.('after-rename');
    syncDirectory(directory);
  } finally {
    try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function load(directory, ledgerId) {
  const bytes = readBoundedFile(join(directory, 'state.json'), maxBytes);
  const { digest: checksum, state } = JSON.parse(bytes.toString('utf8'));
  const snapshot = canonicalJson(state, maxBytes - 128);
  requireResource(state.version === version && state.ledger_id === ledgerId && checksum === sha256(snapshot)
    && bytes.toString('utf8') === `{"digest":"${checksum}","state":${snapshot}}`, 'LIFECYCLE_STATE_INTEGRITY');
  return state;
}

function checkEvent(event, now) {
  const observed = resourceTime(event.observed_at);
  requireResource(Object.keys(event).length === 11 && identifier.test(event.event_id ?? '')
    && identifier.test(event.source ?? '') && /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9_.-]*$/.test(event.repository)
    && event.repository.length <= 160 && ['goal_issue', 'goal_revision', 'task_issue'].every((field) =>
      Number.isSafeInteger(event[field]) && event[field] > 0) && event.task_issue !== event.goal_issue
    && Number.isSafeInteger(event.expected_revision) && event.expected_revision >= 0 && sha.test(event.head_sha ?? '')
    && typeof event.kind === 'string' && observed <= now && now - observed <= replayMs, 'LIFECYCLE_EVENT');
  resourceRef(event.payload_ref);
}

function taskIdentity(event) {
  const { repository, goal_issue, goal_revision, task_issue, head_sha } = event;
  return { repository, goal_issue, goal_revision, task_issue, head_sha };
}

function branchIdentity(task) {
  return `${task.repository}:${task.branch}`;
}

function requireWriter(task, input) {
  requireResource(task?.phase === 'claimed' && input.fence === task.fence
    && input.authorization_id === task.authorization_id, 'STALE_WRITER');
}

function permitAdmission(state, task, verify, now) {
  resourceAttest(verify, 'lifecycle_admissions_open', { task, now });
  const sameGoal = (prior) => prior.repository === task.repository && prior.goal_issue === task.goal_issue;
  const held = state.tasks.filter((prior) => ['claimed', 'checkpoint-pending'].includes(prior.phase));
  requireResource(held.length < 2 && held.every((prior) => branchIdentity(prior) !== branchIdentity(task)
    && prior.resource !== task.resource) && held.filter(sameGoal).length < task.writer_limit, 'WRITER_CONTENTION');
  const awaiting = state.tasks.filter((prior) => prior.phase === 'published');
  requireResource(awaiting.length < 2 && awaiting.filter(sameGoal).length < task.review_limit, 'REVIEW_BACKLOG');
  requireResource(state.tasks.every((prior) => prior.intent?.kind !== 'correction'
    || (branchIdentity(prior) !== branchIdentity(task) && prior.resource !== task.resource)),
    'CORRECTION_IN_FLIGHT');
}

function checkReservation(input, task, host) {
  resourceRef(input.budget);
  const run = host.resources.lookup(input.budget.id);
  const reservation = run.reservation;
  requireResource(run.status === 'reserved' && digest(reservation) === input.budget.digest
    && ['repository', 'goal_issue', 'goal_revision', 'goal_control_digest', 'task_issue', 'lineage_id'].every((key) =>
      task[key] === reservation[key]) && reservation.task_revision === task.task_revision && reservation.risk === task.risk
    && reservationDisposition(reservation, host) === 'eligible_for_admission', 'LIFECYCLE_RESERVATION');
  const { limits } = reservation;
  const policy = task.budget_policy;
  requireResource(['pool_id', 'account_scope', 'unit'].every((key) => limits[key] === policy[key])
    && ['account_ceiling', 'goal_ceiling', 'task_ceiling', 'max_model_calls', 'max_continuations'].every((key) => limits[key] <= policy[key])
    && limits.account_epoch >= policy.account_epoch && limits.cleanup_reserve >= policy.cleanup_reserve
    && resourceTime(limits.execution_deadline) <= resourceTime(policy.execution_deadline), 'LIFECYCLE_BUDGET_POLICY');
}

function planPreparation(state, event, input, prior, host) {
  const { verify, now } = host;
  const identity = taskIdentity(event);
  requireResource(!prior || ['closed', 'prepared'].includes(prior.phase), 'LIVE_OR_PENDING_GRANT');
  requireResource(!prior?.intent, 'CORRECTION_IN_FLIGHT');
  const authorization = reviewPreparation(identity, input, host);
  const { branch, issueBodyDigest: body_digest, goal_control_digest, required_paths, census_digest, taskKind: task_kind,
    parser_revision, parser_digest, writer_limit, review_limit, risk, budget_policy } = authorization;
  requireResource(identifier.test(input.resource ?? '') && identifier.test(input.lineage_id ?? '')
    && Number.isSafeInteger(input.task_revision) && input.task_revision > 0, 'LIFECYCLE_LINEAGE');
  if (prior) {
    requireResource(prior.phase === 'prepared' || event.kind === 'resume', 'RESUME_REQUIRED');
    requireResource(prior.branch === branch && prior.resource === input.resource && prior.lineage_id === input.lineage_id
      && input.task_revision >= prior.task_revision, 'LIFECYCLE_IDENTITY_CHANGED');
    // Changing saved authority requires a closed-turn correction or a freshly
    // authenticated outside change. A prepared receipt may be superseded only
    // where the host proves the previous receipt can never claim ownership.
    if (prior.body_digest !== body_digest || prior.goal_revision !== event.goal_revision) {
      resourceAttest(verify, 'superseding_task_authority', { prior, identity, body_digest, task_revision: input.task_revision });
      requireResource(input.task_revision > prior.task_revision, 'STALE_TASK_AUTHORITY');
    }
    if (prior.phase === 'prepared') {
      resourceAttest(verify, 'superseded_prepared_receipt', { prior, identity, body_digest });
    }
    requireResource(prior.head_sha === identity.head_sha, 'RESUME_HEAD');
  } else {
    requireResource(event.kind === 'prepare', 'RESUME_MISSING_CHECKPOINT');
  }
  const fence = input.workspace.writer_fence;
  requireResource(Number.isSafeInteger(fence) && fence > state.fence, 'STALE_FENCE');
  const task = { ...identity, branch, body_digest, goal_control_digest, required_paths, census_digest, task_kind,
    parser_revision, parser_digest, writer_limit, review_limit, fence, task_revision: input.task_revision, resource: input.resource,
    lineage_id: input.lineage_id, risk, budget_policy, budget: input.budget, phase: 'prepared', intent: null,
    checkpoint: prior?.checkpoint ?? null, repair: prior?.repair ?? null };
  permitAdmission(state, task, verify, now);
  resourceAttest(verify, 'lifecycle_logical_resource', task);
  checkReservation(input, task, host);
  if (event.kind === 'resume') {
    resourceAttest(verify, 'fresh_turn_from_checkpoint', { task, prior, proof: input.workspace.ready_proof });
  }
  const phase = event.kind === 'resume' ? 'resume' : 'prepare';
  task.workspace = reviewWorkspace(input.workspace, input.observation, input.remote, task,
    { verify, phase, paths: required_paths, taskKind: task_kind });
  state.fence = fence;
  return task;
}

function claim(state, event, input, task, host) {
  const { verify, now } = host;
  requireResource(task.phase === 'prepared' && input.workspace.writer_fence === task.fence, 'STALE_PREPARATION');
  permitAdmission(state, task, verify, now);
  const auth = reviewPreparation(taskIdentity(event), input, host);
  requireResource(auth.issueBodyDigest === task.body_digest && auth.census_digest === task.census_digest
    && auth.parser_digest === task.parser_digest && auth.parser_revision === task.parser_revision, 'PREPARED_AUTHORITY_CHANGED');
  checkReservation({ budget: task.budget }, task, host);
  requireResource(!state.budgets.includes(task.budget.id), 'RESERVATION_ALREADY_CLAIMED');
  const workspace = reviewWorkspace(input.workspace, input.observation, input.remote, task,
    { verify, phase: 'claim', paths: task.required_paths, taskKind: task.task_kind });
  requireResource(['environment', 'directory', 'owner'].every((key) => workspace[key] === task.workspace[key])
    && workspace.authorization_id !== null, 'PREPARED_WORKSPACE_CHANGED');
  resourceAttest(verify, 'first_mutation_fence', { task, workspace, event });
  state.budgets.push(task.budget.id);
  return { ...task, phase: 'claimed', workspace, authorization_id: workspace.authorization_id };
}

function correction(task, input, host) {
  requireResource(task.phase === 'closed' && !task.intent && input.expected_body_digest === task.body_digest,
    'CORRECTION_CLOSED_TURN_REQUIRED');
  const previous = savedAuthorization(input.issue, task, host);
  requireResource(previous.issueBodyDigest === task.body_digest && previous.parser_digest === task.parser_digest
    && previous.parser_revision === task.parser_revision, 'CORRECTION_BODY_CONFLICT');
  const body = levelOneBody(input.issue.body, input.replacement);
  const next = host.parseSaved({ ...input.issue, body });
  requireResource(next.issueBodyDigest === sha256(body) && next.branch === task.branch && next.taskKind === task.task_kind
    && next.parser_digest === task.parser_digest && next.parser_revision === task.parser_revision, 'CORRECTION_PARSER');
  resourceRef(input.archive);
  resourceAttest(host.verify, 'closed_turn_level_one_review', { task, previous, next, archive: input.archive,
    closed_receipt: input.closed_receipt });
  resourceAttest(host.verify, 'level_one_issue_compare_and_set', { task, previous, next });
  return { desired: next.issueBodyDigest, expected: previous.issueBodyDigest, archive: input.archive };
}

function checkpointReference(task, input, head, verify) {
  resourceRef(input.terminal);
  const current = { ...input.current_context, ...task, head_sha: head, issue_body_digest: task.body_digest };
  const checkpoint = validateCheckpoint(input.context_checkpoint, { current, receipt: input.workspace, verify });
  requireResource(digest(checkpoint.stopped_writer_ack) === digest(input.terminal), 'CHECKPOINT_TERMINAL_BINDING');
  return { id: checkpoint.id, digest: digest(checkpoint) };
}

function finishCheckpoint(task, input, verify) {
  requireResource(input.fence === task.fence && sha.test(input.workspace.head_sha)
    && input.workspace.head_sha === task.intent.desired && input.observation.base === task.head_sha
    && input.workspace.writer_fence === task.fence, 'CHECKPOINT_IDENTITY');
  const checkpoint = reviewWorkspace(input.workspace, input.observation, input.remote,
    { ...task, head_sha: task.intent.desired }, { verify, phase: 'checkpoint', paths: task.required_paths, taskKind: task.task_kind });
  requireResource(checkpoint.authorization_id === task.authorization_id && checkpoint.directory === task.workspace.directory
    && checkpoint.environment === task.workspace.environment && checkpoint.owner === task.workspace.owner, 'CHECKPOINT_WRITER');
  const reference = checkpointReference(task, input, task.intent.desired, verify);
  resourceAttest(verify, 'acknowledged_stopped_checkpoint', { task, checkpoint, terminal: input.terminal });
  return { ...task, workspace: checkpoint, head_sha: task.intent.desired, checkpoint: reference,
    phase: task.intent.candidate ? 'published' : 'closed', intent: null };
}

function reconcile(task, event, input, host) {
  const intent = task.intent;
  requireResource(intent && input.intent_id === intent.id, 'UNKNOWN_INTENT');
  resourceRef(input.evidence);
  const now = resourceTime(host.now);
  resourceAttest(host.verify, 'lifecycle_effect_observation', { task, input: inputHash(input), evidence: input.evidence, event });
  if (input.outcome === 'applied') {
    if (intent.kind === 'checkpoint') return finishCheckpoint(task, input, host.verify);
    const saved = savedAuthorization(input.issue, task, host);
    requireResource(saved.issueBodyDigest === intent.desired && saved.parser_digest === task.parser_digest
      && saved.parser_revision === task.parser_revision, 'CORRECTION_SAVED_BODY_CONFLICT');
    return { ...task, body_digest: intent.desired, task_revision: task.task_revision + 1, intent: null };
  }
  if (input.outcome === 'abandon') {
    requireResource(intent.kind === 'correction', 'CHECKPOINT_FENCE_RETAINED');
    const saved = savedAuthorization(input.issue, task, host);
    requireResource(saved.issueBodyDigest === intent.expected, 'CORRECTION_BODY_CONFLICT');
    resourceAttest(host.verify, 'terminal_absence_and_cancelled_request', { task, event, evidence: input.evidence });
    return { ...task, intent: null };
  }
  requireResource(['unavailable', 'permission', 'conflict', 'absent', 'rate_limit'].includes(input.outcome)
    && now <= intent.deadline && intent.read_id !== null && input.read_id === intent.read_id, 'RECONCILIATION_PAUSED');
  requireResource(intent.state === 'open', 'RECONCILIATION_CIRCUIT_OPEN');
  const observed = { ...intent, read_id: null, state: 'paused', last_evidence: input.evidence };
  if (input.outcome === 'rate_limit' && intent.reads < maxReads) {
    const delay = input.retry_after_ms;
    requireResource(Number.isSafeInteger(delay) && delay >= 0, 'RECONCILIATION_BACKOFF');
    observed.state = 'open';
    observed.next_read_at = Math.max(intent.next_read_at, now + Math.min(delay, 120_000));
  }
  if (input.outcome === 'absent' && intent.kind === 'correction' && intent.dispatches < maxDispatches) {
    const saved = savedAuthorization(input.issue, task, host);
    requireResource(saved.issueBodyDigest === intent.expected && saved.parser_digest === task.parser_digest
      && saved.parser_revision === task.parser_revision, 'CORRECTION_BODY_CONFLICT');
    resourceAttest(host.verify, 'terminal_absence_and_cancelled_request', { task, event, evidence: input.evidence });
    observed.state = 'retry';
  }
  return { ...task, intent: observed };
}

function observeIntent(task, event, input, host) {
  const intent = task.intent;
  const now = resourceTime(host.now);
  requireResource(intent && input.intent_id === intent.id && intent.state === 'open'
    && now <= intent.deadline && intent.reads < maxReads && now >= intent.next_read_at, 'RECONCILIATION_PAUSED');
  // Each read permit can produce one result. A lost observation can be read
  // again after the capped delay, but cannot turn into a second mutation.
  const observed = { ...intent, reads: intent.reads + 1, read_id: event.event_id, next_read_at: now + 30_000 };
  return { ...task, intent: observed };
}

function startIntent(kind, event, now, fields) {
  return { id: event.event_id, kind, ...fields, state: 'open', dispatches: 1, reads: 0, read_id: null,
    deadline: now + reconcileMs, next_read_at: now };
}

function beginCheckpoint(task, input, verify) {
  requireWriter(task, input);
  requireResource(typeof input.candidate === 'boolean' && sha.test(input.head_sha ?? '')
    && (!input.candidate || input.head_sha !== task.head_sha), 'CHECKPOINT_CANDIDATE');
  const observed = input.observation;
  requireResource(observed.directory === task.workspace.directory && observed.environment === task.workspace.environment
    && observed.branch === task.branch && observed.origin === task.workspace.origin && observed.head === input.head_sha && observed.base === task.head_sha
    && observed.dirty === false && observed.conflicted === false && observed.receipt.status === 'active'
    && observed.receipt.authorization_id === task.authorization_id && observed.receipt.owner === task.workspace.owner
    && observed.receipt.issue === task.task_issue && observed.receipt.body_digest === task.body_digest
    && observed.paths.every((path) => task.required_paths.includes(path)), 'CHECKPOINT_LOCAL_SCOPE');
  resourceRef(input.evidence);
  resourceAttest(verify, 'candidate_checkpoint_scope_and_provenance', { task, input });
  resolveScopedPaths(observed.directory, observed.paths, task.task_kind);
  return { desired: input.head_sha, candidate: input.candidate, expected: task.head_sha };
}

function stopWithoutPublication(task, input, verify) {
  requireResource(['prepared', 'claimed', 'checkpoint-pending'].includes(task.phase)
    && input.fence === task.fence && input.workspace.writer_fence === task.fence
    && input.observation.base === task.head_sha, 'STALE_WRITER');
  const checkpoint = reviewWorkspace(input.workspace, input.observation, input.remote, task,
    { verify, phase: 'unpublished-stop', paths: task.required_paths, taskKind: task.task_kind });
  requireResource(checkpoint.directory === task.workspace.directory && checkpoint.environment === task.workspace.environment
    && checkpoint.owner === task.workspace.owner && (!task.authorization_id || checkpoint.authorization_id === task.authorization_id), 'STOPPED_WORKSPACE');
  const reference = checkpointReference(task, input, task.head_sha, verify);
  resourceAttest(verify, 'terminal_no_publication_or_live_writer', { task, checkpoint, evidence: input.terminal });
  return { ...task, workspace: checkpoint, phase: 'closed', intent: null, checkpoint: reference };
}

function checkRepair(task, prior, input, host) {
  const { attempt } = input;
  if (!prior) {
    requireResource(attempt === 'initial', 'INITIAL_ATTEMPT');
  } else if (prior.repair) {
    const repair = prior.repair;
    requireResource((attempt === 'repair' && repair.attempts < 2)
      || (attempt === 'reassessment' && repair.attempts === 2 && !repair.reassessed), 'REPAIR_LINEAGE_LIMIT');
    resourceRef(input.audit);
    resourceAttest(host.verify, 'affected_contract_and_sibling_audit', { prior, task, attempt, audit: input.audit });
    task.repair = { ...repair, attempts: repair.attempts + Number(attempt === 'repair'),
      reassessed: attempt === 'reassessment' || repair.reassessed };
    // Reassessment is read-only, and never yields a prepared writer.
    if (attempt === 'reassessment') task.phase = 'closed';
  } else {
    requireResource(attempt === 'continuation' || (attempt === 'initial' && prior.phase === 'prepared'), 'LIFECYCLE_ATTEMPT');
  }
  resourceAttest(host.verify, 'resource_attempt_binding', { task, attempt });
  return task;
}

function updateTask(state, event, input, task, host) {
  const { verify } = host;
  const now = resourceTime(host.now);
  if (['prepare', 'resume'].includes(event.kind)) {
    return { task: checkRepair(planPreparation(state, event, input, task, host), task, input, host) };
  }
  requireResource(task, 'UNKNOWN_LIFECYCLE_TASK');
  switch (event.kind) {
    case 'claim':
      return { task: claim(state, event, input, task, host) };
    case 'begin-correction': {
      requireResource(state.tasks.every((prior) => !(branchIdentity(prior) === branchIdentity(task)
        || prior.resource === task.resource) || !['claimed', 'checkpoint-pending'].includes(prior.phase)), 'LIVE_OR_PENDING_GRANT');
      const plan = correction(task, input, host);
      const intent = startIntent('correction', event, now, plan);
      return { task: { ...task, intent }, permit: 'conditional-issue-update' };
    }
    case 'begin-checkpoint': {
      const plan = beginCheckpoint(task, input, verify);
      const intent = startIntent('checkpoint', event, now, plan);
      return { task: { ...task, intent, phase: 'checkpoint-pending' }, permit: 'operator-checkpoint' };
    }
    case 'observe-intent':
      return { task: observeIntent(task, event, input, host), permit: 'one-bounded-read' };
    case 'reconcile':
      return { task: reconcile(task, event, input, host) };
    case 'retry-correction': {
      const intent = task.intent;
      requireResource(intent?.kind === 'correction' && input.intent_id === intent.id && intent.state === 'retry'
        && intent.dispatches < maxDispatches && now <= intent.deadline, 'CORRECTION_RETRY_INELIGIBLE');
      const saved = savedAuthorization(input.issue, task, host);
      requireResource(saved.issueBodyDigest === intent.expected && saved.parser_digest === task.parser_digest
        && saved.parser_revision === task.parser_revision, 'CORRECTION_BODY_CONFLICT');
      resourceAttest(verify, 'conditional_correction_retry', { task, event, saved });
      return { task: { ...task, intent: { ...intent, dispatches: intent.dispatches + 1, state: 'open' } },
        permit: 'conditional-issue-update' };
    }
    case 'acknowledge-stop':
      return { task: stopWithoutPublication(task, input, verify) };
    case 'record-blocker': {
      requireResource(task.phase === 'closed' && !task.intent && identifier.test(input.root ?? ''), 'BLOCKER_CHECKPOINT');
      resourceRef(input.evidence);
      resourceAttest(verify, 'canonical_root_cause_and_affected_closure', { task, input });
      requireResource(!task.repair || task.repair.root === input.root, 'NEW_ROOT_REQUIRES_REVIEW');
      return { task: { ...task, repair: task.repair ?? { root: input.root, attempts: 0, reassessed: false } } };
    }
    case 'review-disposition':
      requireResource(task.phase === 'published' && ['review-recorded', 'repair'].includes(input.outcome), 'REVIEW_CANDIDATE');
      resourceRef(input.evidence);
      resourceAttest(verify, 'independent_lifecycle_review', { task, input });
      return { task: { ...task, phase: input.outcome === 'repair' ? 'closed' : 'review-recorded' } };
    default:
      throw new Error('UNKNOWN_LIFECYCLE_EVENT');
  }
}

// One private journal covers every participating environment and logical
// resource. Callers are authenticated supervisors. The journal emits no native
// calls, pushes, approvals or GitHub updates.
export function openLifecycle({ directory, ledgerId, initialize = false, verify, parseSaved, resources, consumedNonces,
  clock = () => new Date().toISOString(), fault }) {
  requireResource(isAbsolute(directory) && realpathSync(directory) === directory && identifier.test(ledgerId ?? ''), 'LIFECYCLE_DIRECTORY');
  resourceAttest(verify, 'private_lifecycle_journal', { directory, ledgerId, initialize });
  const lock = join(directory, 'transaction.lock');
  function transaction(action) {
    mkdirSync(lock, { mode: 0o700 });
    try {
      // Seal a prior rename whose acknowledgement was lost before opening the
      // next transaction. Errors never allow an effect to be dispatched.
      syncDirectory(directory);
      return action();
    } finally {
      rmdirSync(lock);
    }
  }
  if (initialize) transaction(() => {
    try {
      readBoundedFile(join(directory, 'state.json'), maxBytes);
      throw new Error('LIFECYCLE_ALREADY_INITIALIZED');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const now = resourceTime(clock());
    save(directory, { version, ledger_id: ledgerId, now, fence: 0, tasks: [], events: [], budgets: [] }, fault);
  });
  return {
    submit(event, input) {
      // Canonicalization rejects getters, oversized values and unstable input
      // before reaching authentication or the private journal.
      event = JSON.parse(canonicalJson(event));
      input = JSON.parse(canonicalJson(input, maxBytes));
      const binding = inputHash(input);
      return transaction(() => {
        const state = load(directory, ledgerId);
        const at = clock();
        const now = resourceTime(at);
        requireResource(now >= state.now, 'LIFECYCLE_CLOCK_ROLLBACK');
        checkEvent(event, now);
        requireResource(event.payload_ref.digest === binding, 'LIFECYCLE_PAYLOAD');
        resourceAttest(verify, 'lifecycle_event', event);
        const eventDigest = digest(event);
        const previous = state.events.find((entry) => entry.id === event.event_id);
        if (previous) {
          requireResource(previous.digest === eventDigest, 'LIFECYCLE_EVENT_CONFLICT');
          return { disposition: 'duplicate', revision: previous.revision, permit: null };
        }
        if (event.kind === 'status') return { disposition: 'observation', permit: null };
        requireResource(state.events.length < maxEvents, 'LIFECYCLE_JOURNAL_CAPACITY');
        const index = state.tasks.findIndex((task) => task.repository === event.repository && task.task_issue === event.task_issue);
        const prior = state.tasks[index];
        requireResource(event.expected_revision === (prior?.revision ?? 0) && (!prior ||
          (event.goal_issue === prior.goal_issue && event.head_sha === prior.head_sha &&
            (event.goal_revision === prior.goal_revision || ['prepare', 'resume'].includes(event.kind)))), 'STALE_LIFECYCLE_EVENT');
        requireResource(prior || state.tasks.length < maxTasks, 'LIFECYCLE_TASK_CAPACITY');
        const next = updateTask(state, event, input, prior, { verify, parseSaved, now: at, resources, consumedNonces });
        const revision = event.expected_revision + 1;
        next.task.revision = revision;
        if (prior) state.tasks[index] = next.task;
        else state.tasks.push(next.task);
        const evidence = { id: event.payload_ref.id, digest: binding };
        state.events.push({ id: event.event_id, digest: eventDigest, revision, kind: event.kind, evidence,
          archive: event.kind === 'begin-correction' ? next.task.intent.archive : null });
        state.now = now;
        save(directory, state, fault);
        return { disposition: 'committed', revision, phase: next.task.phase, intent: next.task.intent,
          fence: next.task.fence, permit: next.permit ?? null };
      });
    },
    inspect(repository, issue) {
      return load(directory, ledgerId).tasks.find((task) => task.repository === repository && task.task_issue === issue) ?? null;
    },
    assertWriter({ repository, issue, fence, authorization_id, paths, evidence }) {
      resourceRef(evidence);
      return transaction(() => {
        const task = load(directory, ledgerId).tasks.find((record) => record.repository === repository && record.task_issue === issue);
        requireWriter(task, { fence, authorization_id });
        requireResource(Array.isArray(paths) && paths.length > 0 && paths.length <= 128
          && paths.every((path) => task.required_paths.includes(path)), 'WRITER_SCOPE');
        resourceAttest(verify, 'live_writer_mutation_boundary', { task, paths, evidence });
        resolveScopedPaths(task.workspace.directory, paths, task.task_kind);
        return true;
      });
    },
  };
}
