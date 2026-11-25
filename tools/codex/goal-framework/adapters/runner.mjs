import { canonicalJson, digest, validateExecutionGrant, validateRecord } from '../contracts.mjs';
import { reviewPreparation } from '../authorization.mjs';
import { reviewWorkspace } from '../workspace.mjs';
import { contextDisposition, handoffContext } from '../context.mjs';
import { requireResource, resourceAttest, resourceRef, resourceTime } from '../resources.mjs';
import { assessLocalPreflight, probeLocalPreflight } from './preflight.mjs';

const copy = (value) => JSON.parse(canonicalJson(value));
const id = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
const hash = /^[a-f0-9]{64}$/;
const controls = [
  'probe', 'prepare', 'launch', 'observe', 'checkpoint', 'stop', 'resume', 'hook_events',
  'pre_write_scope', 'post_write_scope', 'recovery', 'model_effort', 'usage', 'context',
  'artifacts', 'budget_enforcement', 'terminal_acknowledgement', 'separate_credentials', 'writer_fencing',
];
const nativeControls = [
  'hard_ceiling', 'deadline_watchdog', 'host_isolation', 'foreground_capacity', 'kill_switch',
  'publication_fence', 'late_usage', 'artifact_retention', 'credential_separation', 'native_identity',
];
const reply = (operation, status, fields = {}) => ({
  schema: 'PFM_ADAPTER_RESULT_V1', operation, status, ...fields,
});

function identityOf(runtime) {
  const { product, runtime_version, tool_version, authentication_ref } = runtime.runner;
  return { surface: runtime.runner.surface, product, runtime_version, tool_version, authentication_ref,
    transport: runtime.transport, config_digest: runtime.config_digest, permissions_digest: runtime.permissions_digest,
    control_revision: runtime.control_revision, resource_profile: runtime.resource_profile };
}

function inventory(raw, surface, repository, verify) {
  const input = copy(raw);
  const runner = validateRecord(input.runner, 'RUNNER_CAPABILITIES_V1');
  requireResource(runner.surface === surface && runner.repository === repository, 'ADAPTER_SURFACE');
  requireResource((input.transport === null || id.test(input.transport))
    && [input.config_digest, input.permissions_digest].every((value) => value === null || hash.test(value))
    && (input.control_revision === null || /^[a-f0-9]{40}$/.test(input.control_revision)), 'ADAPTER_RUNTIME_IDENTITY');
  if (input.resource_profile !== null) resourceRef(input.resource_profile);
  const runtime = { runner, transport: input.transport, config_digest: input.config_digest,
    permissions_digest: input.permissions_digest, control_revision: input.control_revision,
    resource_profile: input.resource_profile, native: {} };
  const identity = identityOf(runtime);
  for (const name of nativeControls) {
    const capability = input.native?.[name] ?? { status: 'unverified', evidence: [] };
    requireResource(['verified', 'unsupported', 'unverified'].includes(capability.status)
      && Array.isArray(capability.evidence) && capability.evidence.length <= 4, 'ADAPTER_CAPABILITY');
    capability.evidence.forEach(resourceRef);
    runtime.native[name] = { status: capability.status, evidence: capability.evidence };
  }
  for (const [name, capability] of [...Object.entries(runner.operations), ...Object.entries(runtime.native)]) {
    if (capability.status !== 'unverified') {
      requireResource(capability.evidence.length > 0, 'ADAPTER_CAPABILITY_EVIDENCE');
      resourceAttest(verify, 'adapter_capability', { repository, identity, name, capability });
    }
  }
  return runtime;
}

function certified(runtime) {
  return Object.values(identityOf(runtime)).every((value) => value !== null)
    && controls.every((name) => runtime.runner.operations[name].status === 'verified')
    && nativeControls.every((name) => runtime.native[name].status === 'verified');
}

// Ports are installed by the trusted supervisor, outside the worker workspace.
// Only the supervisor effect port may persist or call native operations. It
// consumes intents under the global fence using GF-03/GF-05, not an adapter ledger.
export function createRunnerAdapter({ surface, repository, host }) {
  requireResource(['local', 'cloud'].includes(surface), 'ADAPTER_SURFACE');
  const { verify, clock, resources, lifecycle } = host;
  const loadRuntime = () => inventory(host.inventory({ surface, repository }), surface, repository, verify);

  function ready(taskIssue, operation) {
    const live = host.preparation({ surface, repository, task_issue: taskIssue, operation });
    const { identity, input, grant, grantInput } = live;
    const now = clock();
    requireResource(identity.repository === repository && identity.task_issue === taskIssue, 'ADAPTER_TASK');
    const authority = { verify, now, consumedNonces: host.consumedNonces };
    const auth = reviewPreparation(identity, input, { ...authority, parseSaved: host.parseSaved });
    const workspace = reviewWorkspace(input.workspace, input.observation, input.remote,
      { ...identity, body_digest: auth.issueBodyDigest, branch: auth.branch },
      { verify, phase: operation === 'resume' ? 'resume' : 'prepare', paths: auth.required_paths, taskKind: auth.taskKind });
    return { identity, auth, workspace, authority, live, grant, grantInput };
  }

  function dispatch(operation, request, checkpoint) {
    const runtime = loadRuntime();
    if (!certified(runtime) || typeof host.commitEffect !== 'function') {
      return reply(operation, 'unavailable', { reason: 'native-profile-uncertified' });
    }
    // GF-01 currently requires both references to name the same bytes. GF-05
    // reserves against a distinct closed resource profile. Never alias them.
    if (digest(runtime.resource_profile) !== digest({ id: runtime.runner.id, digest: digest(runtime.runner) })) {
      return reply(operation, 'unavailable', { reason: 'canonical-profile-reference-conflict' });
    }
    if (surface === 'cloud') {
      resourceAttest(verify, 'adapter_local_certification_before_cloud', { repository });
    }
    const { identity, auth, workspace, authority, live, grant, grantInput } = ready(request.task_issue, operation);
    const validated = validateExecutionGrant(grant, {
      ...grantInput, goal: live.input.goal, approval: live.input.approval, taskAlignment: live.input.alignment,
      savedBody: live.input.issue.body, census: live.input.census, scopeRequirements: live.input.routes,
      workspace: live.input.workspace, runner: runtime.runner,
    }, authority);
    const grantRef = { id: validated.id, digest: digest(validated) };
    const budget = validated.budget_reservation_ref;
    requireResource(digest(request.grant) === digest(grantRef)
      && workspace.authorization_id === validated.authorization_id
      && workspace.receipt_status === 'prepared', 'ADAPTER_GRANT_IDENTITY');
    const run = resources.lookup(budget.id);
    requireResource(digest(run.reservation) === budget.digest
      && digest(live.input.budget) === digest(budget) && digest(grantInput.reservation) === budget.digest,
    'ADAPTER_BUDGET_BINDING');
    if (run.status !== 'reserved') return reply(operation, 'reconcile', { reservation: budget });
    requireResource(run.native_run_id === null && run.reservation.estimated_ceiling > 0
      && run.reservation.max_admitted_model_calls > 0 && run.reservation.limits.cleanup_reserve > 0
      && resourceTime(authority.now) < resourceTime(run.reservation.limits.execution_deadline), 'ADAPTER_BUDGET');
    const task = lifecycle.inspect(repository, identity.task_issue);
    requireResource(task?.phase === 'prepared' && task.fence === validated.writer_fence
      && task.head_sha === validated.head_sha && task.body_digest === auth.issueBodyDigest
      && task.census_digest === auth.census_digest && task.parser_revision === auth.parser_revision
      && task.parser_digest === auth.parser_digest && task.lineage_id === validated.lineage_id
      && task.task_revision === validated.task_revision && task.goal_revision === validated.goal_revision
      && task.goal_control_digest === validated.goal_control_digest
      && digest(task.budget) === digest(budget)
      && digest(task.workspace) === digest(workspace), 'ADAPTER_LIFECYCLE_BINDING');
    const context = contextDisposition({ ...live.context, now: authority.now, verify });
    requireResource(context.disposition === 'bounded_session'
      && resourceTime(live.context.session.deadline) < resourceTime(run.reservation.limits.execution_deadline),
    'ADAPTER_CONTEXT');
    let previous = null;
    if (operation === 'resume') {
      resourceRef(checkpoint);
      const prior = host.previousCheckpoint({ repository, task_issue: request.task_issue, checkpoint });
      const handoff = handoffContext({ checkpoint: prior.checkpoint, loadLive: () => prior.live,
        verify, compaction: prior.compaction });
      const priorRun = resources.lookup(prior.reservation.id);
      requireResource(prior.reservation.id !== budget.id && digest(priorRun.reservation) === prior.reservation.digest
        && priorRun.status === 'terminal' && priorRun.reservation.repository === repository
        && priorRun.reservation.task_issue === identity.task_issue && priorRun.reservation.lineage_id === task.lineage_id
        && digest(task.checkpoint) === digest(checkpoint) && digest(handoff.checkpoint) === digest(checkpoint)
        && handoff.head_sha === validated.head_sha && handoff.branch === validated.branch
        && handoff.repository === repository && handoff.task_issue === identity.task_issue
        && handoff.lineage_id === task.lineage_id, 'ADAPTER_RESUME_CHECKPOINT');
      previous = { checkpoint, reservation: prior.reservation, stopped_writer: handoff.stopped_writer };
      resourceAttest(verify, 'adapter_transfer_stopped_and_published', { previous, priorRun, handoff, task });
    } else {
      requireResource(task.checkpoint === null, 'ADAPTER_RESUME_REQUIRED');
    }
    // No Goals, subagent, escalation or merge operation is exposed by V1.
    const intent = { schema: 'PFM_ADAPTER_INTENT_V1', operation, repository, surface, task_issue: task.task_issue,
      idempotency_key: digest(['native-start', repository, budget.id]), grant: grantRef, reservation: budget,
      authority_digest: digest([auth.issueBodyDigest, auth.census_digest, task.parser_digest, task.goal_control_digest]),
      head_sha: task.head_sha, branch: task.branch, fence: task.fence, authorization_id: validated.authorization_id,
      workspace: workspace.reference, runtime_digest: digest(runtime), resource_profile: runtime.resource_profile,
      deadline: live.context.session.deadline, cleanup_reserve: run.reservation.limits.cleanup_reserve, previous,
    };
    resourceAttest(verify, 'adapter_native_admission', intent);
    return effect(intent);
  }

  function current(binding) {
    resourceRef(binding.reservation);
    requireResource(Number.isSafeInteger(binding.task_issue) && binding.task_issue > 0
      && (binding.native_run_id === null || typeof binding.native_run_id === 'string' && id.test(binding.native_run_id)),
    'ADAPTER_RUN_REQUEST');
    const run = resources.lookup(binding.reservation.id);
    requireResource(digest(run.reservation) === binding.reservation.digest
      && run.reservation.repository === repository && run.reservation.task_issue === binding.task_issue
      && (binding.native_run_id === null || run.native_run_id === binding.native_run_id), 'ADAPTER_RUN_BINDING');
    resourceAttest(verify, 'adapter_run_binding', { repository, surface, binding, run });
    return run;
  }

  function effect(intent) {
    // A failed/missing response is ambiguous, including transport cancellation.
    // The host's durable intent is the authority on whether any effect occurred.
    let result;
    try {
      result = host.commitEffect(copy(intent));
    } catch {
      return reply(intent.operation, 'reconcile', { reservation: intent.reservation });
    }
    if (result == null) return reply(intent.operation, 'reconcile', { reservation: intent.reservation });
    const observed = copy(result);
    requireResource(observed.intent_digest === digest(intent)
      && ['recorded', 'duplicate', 'denied', 'unknown'].includes(observed.status), 'ADAPTER_EFFECT_RESULT');
    resourceRef(observed.evidence);
    resourceAttest(verify, 'adapter_effect_receipt', { intent, observed });
    return reply(intent.operation, observed.status === 'unknown' ? 'reconcile' : observed.status,
      { reservation: intent.reservation, evidence: observed.evidence });
  }

  function control(operation, raw) {
    const binding = copy(raw);
    const run = current(binding);
    if (typeof host.commitEffect !== 'function') return reply(operation, 'unavailable');
    let publication = null;
    if (operation === 'checkpoint') {
      requireResource(run.status === 'terminal', 'ADAPTER_CHECKPOINT_WORKER_ACTIVE');
      const task = lifecycle.inspect(repository, binding.task_issue);
      requireResource(task?.phase === 'checkpoint-pending' && task.intent?.kind === 'checkpoint'
        && task.fence === binding.fence && task.native_run_id === run.native_run_id
        && digest(task.budget) === digest(binding.reservation), 'ADAPTER_CHECKPOINT_STALE');
      publication = { intent_id: task.intent.id, fence: task.fence, branch: task.branch,
        expected: task.intent.expected, desired: task.intent.desired };
    } else if (run.status === 'terminal') {
      return reply(operation, 'terminal', { reservation: binding.reservation });
    }
    const intent = { schema: 'PFM_ADAPTER_INTENT_V1', operation, repository, surface,
      task_issue: binding.task_issue, reservation: binding.reservation, publication,
      idempotency_key: digest([operation, repository, binding.reservation.id]),
    };
    resourceAttest(verify, 'adapter_native_control', intent);
    return effect(intent);
  }

  return Object.freeze({
    probe() {
      const runtime = loadRuntime();
      return reply('probe', 'inventory', { runtime, mode: certified(runtime) && host.commitEffect
        ? 'controls-observed' : surface === 'local' ? 'manual-v3' : 'read-only' });
    },
    prepare(raw) {
      const request = copy(raw);
      const runtime = loadRuntime();
      if (!certified(runtime) || typeof host.commitEffect !== 'function') {
        return reply('prepare', 'unavailable', { reason: 'native-profile-uncertified' });
      }
      const { auth, workspace, authority, live } = ready(request.task_issue, 'prepare');
      let preflight = null;
      if (surface === 'local' && typeof host.preflightPreparation === 'function') {
        const receipt = live.input.workspace;
        const capability = probeLocalPreflight(receipt, host);
        const { policy, allowance } = host.preflightPreparation({ workspace: workspace.reference, risk: auth.risk });
        requireResource(policy.risk === auth.risk && policy.goal_control_digest === auth.goal_control_digest
          && policy.goal_issue === live.identity.goal_issue && policy.goal_revision === live.identity.goal_revision
          && policy.task_revision === live.input.task_revision, 'ADAPTER_PREFLIGHT_AUTHORITY');
        preflight = assessLocalPreflight({ workspace: receipt, capability, policy, allowance }, authority);
      }
      return reply('prepare', 'observed', { workspace: workspace.reference, census_digest: auth.census_digest,
        runtime_digest: digest(runtime), preflight });
    },
    launch(raw) {
      return dispatch('launch', copy(raw));
    },
    observe(raw) {
      const binding = copy(raw);
      const run = current(binding);
      // A read of canonical accounting only. The provider/host must append
      // authenticated late usage even after terminal acknowledgement.
      return reply('observe', run.status, { reservation: binding.reservation, native_run_id: run.native_run_id,
        actual_profile_status: run.actual_profile_status, billed: run.billed, liability: run.liability });
    },
    checkpoint(raw) {
      return control('checkpoint', raw);
    },
    stop(raw) {
      return control('stop', raw);
    },
    resume(raw, checkpoint) {
      return dispatch('resume', copy(raw), copy(checkpoint));
    },
  });
}
