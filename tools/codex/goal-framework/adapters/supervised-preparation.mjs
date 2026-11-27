import { performance } from 'node:perf_hooks';
import { canonicalJson, goalControlDigest, digest, planAlignedTask, validateGoal, validateScopeCensus } from '../contracts.mjs';
import { pinnedV3Parser, savedAuthorization, sha256 } from '../authorization.mjs';
import { requireResource, resourceAttest, resourceRef, resourceTime } from '../resources.mjs';
import { identifier, sha } from '../workspace.mjs';
import { approvedPath, exactFields, parseBootstrapOutput, preparationHead } from './bootstrap-host.mjs';
import { synchronousPreparationCallback } from './preparation-journal.mjs';

const hash = /^[a-f0-9]{64}$/;
const branchName = /^(codex|agent)\/[A-Za-z0-9_-][A-Za-z0-9._/-]{0,189}$/;
const repositoryName = /^[a-z0-9-]{1,64}\/[a-z0-9_.-]{1,96}$/;
const requestFields = [
  'schema', 'id', 'nonce', 'repository', 'goal_issue', 'goal_revision', 'goal_control_digest', 'task_issue',
  'task_revision', 'lineage_id', 'issue_body_digest', 'branch', 'mode', 'expected_main', 'expected_head',
  'census', 'resource', 'worker', 'host_id', 'environment', 'checkout', 'target', 'parser_revision',
  'parser_digest', 'bootstrap_revision', 'bootstrap_digest', 'host_allowance', 'cleanup_deadline', 'expires_at',
];
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const matches = (pattern, value) => typeof value === 'string' && pattern.test(value);
const refMatches = (ref, record) => ref.id === record.id && ref.digest === digest(record);

// The PM proof authenticates this exact digest outside the payload it signs.
// For serialized input require canonical bytes so JSON duplicate keys cannot
// silently change what was approved.
export function readPreparationRequest(raw) {
  const input = typeof raw === 'string' ? JSON.parse(raw.length <= 8192 ? raw : '') : raw;
  const envelope = exactFields(input, ['request', 'approval'], 'PREPARATION_ENVELOPE');
  if (typeof raw === 'string') requireResource(raw === JSON.stringify(envelope), 'PREPARATION_NONCANONICAL');
  const request = exactFields(envelope.request, requestFields, 'PREPARATION_REQUEST_FIELDS');
  const approval = exactFields(envelope.approval, ['schema', 'proof', 'request_digest'], 'PREPARATION_APPROVAL_FIELDS');
  requireResource(request.schema === 'PFM_PREPARATION_REQUEST_V1'
    && ['id', 'lineage_id', 'resource', 'worker', 'host_id', 'environment'].every((key) => matches(identifier, request[key]))
    && matches(hash, request.nonce) && matches(repositoryName, request.repository)
    && ['goal_issue', 'goal_revision', 'task_issue', 'task_revision'].every((key) => positive(request[key]))
    && request.goal_issue !== request.task_issue && matches(branchName, request.branch)
    && !request.branch.includes('..') && request.branch.split('/').every((part) => part && !part.startsWith('.') && !part.endsWith('.lock'))
    && !request.branch.endsWith('.')
    && ['goal_control_digest', 'issue_body_digest', 'parser_digest', 'bootstrap_digest'].every((key) => matches(hash, request[key]))
    && ['expected_main', 'parser_revision', 'bootstrap_revision'].every((key) => matches(sha, request[key]))
    && (request.mode === 'new' && request.expected_head === null || request.mode === 'resume' && matches(sha, request.expected_head)),
  'PREPARATION_REQUEST_IDENTITY');
  approvedPath(request.checkout);
  approvedPath(request.target);
  requireResource(request.checkout !== request.target && !request.target.startsWith(request.checkout + '/')
    && !request.checkout.startsWith(request.target + '/')
    && resourceTime(request.expires_at) <= resourceTime(request.cleanup_deadline), 'PREPARATION_REQUEST_BOUNDS');
  resourceRef(request.census);
  resourceRef(request.host_allowance);
  resourceRef(approval.proof);
  const request_digest = digest(request);
  requireResource(approval.schema === 'PFM_PREPARATION_APPROVAL_V1' && approval.request_digest === request_digest,
    'PREPARATION_APPROVAL_BINDING');
  return { request, approval, binding: { id: request.id, host_id: request.host_id, request_digest, nonce_digest: digest(request.nonce),
    approval_digest: digest(approval), allowance: request.host_allowance,
    resource_digest: digest([request.repository, request.branch, request.resource]) } };
}

function reviewAllowance(raw, request, now, verify) {
  const fields = ['schema', 'id', 'repository', 'host_id', 'environment', 'resource', 'nonce', 'expires_at',
    'cleanup_deadline', 'execution_ms', 'cleanup_ms', 'cpu_millicores', 'memory_mib', 'processes', 'disk_mib'];
  const allowance = exactFields(raw, fields, 'PREPARATION_ALLOWANCE_FIELDS');
  requireResource(allowance.schema === 'PFM_PREPARATION_HOST_ALLOWANCE_V1' && refMatches(request.host_allowance, allowance)
    && ['repository', 'host_id', 'environment', 'resource', 'nonce', 'cleanup_deadline'].every((key) => request[key] === allowance[key])
    && resourceTime(now) < resourceTime(request.expires_at)
    && resourceTime(request.expires_at) <= resourceTime(allowance.expires_at)
    && resourceTime(allowance.expires_at) <= resourceTime(allowance.cleanup_deadline)
    && resourceTime(allowance.cleanup_deadline) - resourceTime(now) <= 10 * 60_000
    && [['execution_ms', 120_000], ['cleanup_ms', 120_000], ['cpu_millicores', 8_000], ['memory_mib', 8192],
      ['processes', 64], ['disk_mib', 65_536]].every(([key, max]) => positive(allowance[key]) && allowance[key] <= max),
  'PREPARATION_ALLOWANCE');
  resourceAttest(verify, 'preparation_host_allowance', { request, allowance });
  return allowance;
}

export function reviewSupervisedPreparation(envelope, live, { verify, now, consumedNonces }, gate) {
  const { request, approval, binding } = envelope;
  const { issue, goal, goalApproval, alignment, routes, parser, task, allowance } = live;
  resourceAttest(verify, 'pm_exact_preparation_approval', { request, approval, now });
  const identity = { repository: request.repository, task_issue: request.task_issue,
    goal_issue: request.goal_issue, goal_revision: request.goal_revision, head_sha: preparationHead(request) };
  requireResource(parser.revision === request.parser_revision && typeof parser.source === 'string'
    && Buffer.byteLength(parser.source) <= 256 * 1024 && sha256(parser.source) === request.parser_digest, 'PREPARATION_PARSER_PIN');
  resourceAttest(verify, 'preparation_live_control_and_host', { request, gate });
  const v3 = savedAuthorization(issue, identity, { parseSaved: pinnedV3Parser({ ...parser, verify }), verify });
  requireResource(v3.branch === request.branch && v3.issueBodyDigest === request.issue_body_digest, 'PREPARATION_V3');
  const authority = { verify, now, consumedNonces };
  const validatedGoal = validateGoal(goal, goalApproval, authority);
  const aligned = planAlignedTask(validatedGoal, goalApproval, alignment, authority);
  requireResource(validatedGoal.repository === request.repository && validatedGoal.goal_issue === request.goal_issue
    && validatedGoal.control_revision === request.goal_revision && goalControlDigest(validatedGoal) === request.goal_control_digest
    && request.nonce !== goalApproval.nonce && approval.proof.digest !== digest(goalApproval)
    && aligned.disposition === 'aligned' && aligned.sizing !== 'reuse', 'PREPARATION_GOAL');
  const census = validateScopeCensus(live.census, { v3, requirements: routes, implementer: request.worker, verify });
  requireResource(refMatches(request.census, census) && census.baseline_sha === identity.head_sha
    && census.risk === alignment.risk && ['repository', 'goal_issue', 'goal_revision', 'goal_control_digest', 'task_issue']
      .every((key) => census[key] === request[key])
    && ['repository', 'task_issue', 'task_revision', 'lineage_id'].every((key) => task?.[key] === request[key]), 'PREPARATION_TASK');
  resourceAttest(verify, 'preparation_live_task_revision', { request, task, gate });
  resourceAttest(verify, 'task_dependencies_satisfied', { ...identity, body_digest: request.issue_body_digest });
  resourceAttest(verify, 'preparation_admissions_open', { request, gate });
  return { allowance: reviewAllowance(allowance, request, now, verify), paths: census.required_write_paths,
    taskKind: v3.taskKind, request_digest: binding.request_digest };
}

function result(intent) {
  return { schema: 'PFM_PREPARATION_RESULT_V1', request_digest: intent.request_digest,
    effect_id: intent.effect_id, status: intent.status, evidence: intent.evidence };
}

const workspaceGitDigest = ({ receipt: _receipt, ...git }) => digest(git);

// Synchronous trusted host ports. The same external gate excludes native
// writers, serializes admission and accounts for unresolved preparation.
export function createSupervisedPreparation({ journal, bootstrap, host }) {
  const { verify, clock } = host;

  function underGate(request, operation, action) {
    return synchronousPreparationCallback(
      (callback) => host.withGate(JSON.parse(canonicalJson(request)), operation, callback),
      (gate) => {
        resourceRef(gate);
        resourceAttest(verify, 'preparation_global_gate', { request, operation, gate });
        return action(gate);
      }, 'PREPARATION_GATE');
  }

  function review(envelope, gate) {
    const live = host.loadLive(envelope.request);
    const now = clock();
    return { ...reviewSupervisedPreparation(envelope, live, { verify, now, consumedNonces: host.consumedNonces }, gate),
      live, now };
  }

  return Object.freeze({
    prepare(raw) {
      const envelope = readPreparationRequest(raw);
      const { request, binding } = envelope;
      return underGate(request, 'prepare', (gate) => {
        const prior = journal.observe(binding);
        if (prior) return result(prior);
        const initial = review(envelope, gate);
        bootstrap.inspect(request, initial.paths, initial.taskKind, 'before', gate);
        const { created, intent } = journal.begin(binding, gate);
        if (!created) return result(intent);
        try {
          const current = review(envelope, gate);
          const before = bootstrap.inspect(request, current.paths, current.taskKind, 'before', gate);
          const execution = bootstrap.run({ request, intent, before, allowance: current.allowance, gate });
          const after = review(envelope, gate);
          const observed = bootstrap.inspect(request, after.paths, after.taskKind, 'after', gate);
          const receipt = observed.workspace.receipt;
          requireResource(receipt.status === (before.workspace?.receipt.status ?? 'absent')
            && receipt.digest === before.workspace?.receipt.digest
            && digest(before.priorOwner) === digest(observed.priorOwner), 'PREPARATION_RECEIPT_CHANGED');
          const output_digest = parseBootstrapOutput(execution.stdout, request, receipt.status);
          const readiness = { intent, terminal: execution.terminal, output_digest,
            invocation_digest: execution.invocation_digest, observation: observed.snapshot.evidence,
            workspace: workspaceGitDigest(observed.workspace), git_identity: observed.git_identity,
            receipt: digest(receipt), prior_owner: digest(observed.priorOwner) };
          const evidence = host.recordGitReady(readiness);
          resourceRef(evidence);
          requireResource(evidence.digest === digest(readiness), 'PREPARATION_GIT_READY_BINDING');
          resourceAttest(verify, 'preparation_git_ready_evidence', { readiness, evidence, gate });
          return result(journal.finish(binding, 'git-ready', evidence, gate));
        } catch {
          // Even a thrown/dropped response may follow a committed effect.
          // A later read-only reconciliation must prove nonstart or cleanup.
          return result(intent);
        }
      });
    },
    async reconcile(raw, recordedOutcome) {
      const { request, binding } = readPreparationRequest(raw);
      const reconcile = (gate, intent, outcome) => {
        if (!outcome) return result(intent);
        const { status, evidence } = exactFields(outcome, ['status', 'evidence'], 'PREPARATION_RECONCILIATION_FIELDS');
        requireResource(['nonstart', 'cleaned'].includes(status), 'PREPARATION_RECONCILIATION_STATUS');
        return result(journal.finish(binding, status, evidence, gate));
      };
      const read = underGate(request, 'reconcile', (gate) => {
        const intent = journal.observe(binding);
        requireResource(intent, 'PREPARATION_INTENT_MISSING');
        if (intent.status !== 'unresolved' || recordedOutcome !== undefined) {
          return { result: intent.status === 'unresolved' ? reconcile(gate, intent, recordedOutcome) : result(intent) };
        }
        const timeout = Math.min(2000, resourceTime(request.cleanup_deadline) - resourceTime(clock()));
        if (timeout <= 0 || !journal.reserveRead(binding, gate)) return { result: result(intent) };
        resourceAttest(verify, 'preparation_bounded_read_port', { request, intent, gate, timeout });
        return { intent, gate, timeout };
      });
      if ('result' in read) return read.result;
      const controller = new AbortController();
      const deadline = performance.now() + read.timeout;
      let timer;
      try {
        const outcome = await Promise.race([
          new Promise((resolve) => {
            timer = setTimeout(() => { resolve(undefined); controller.abort(); }, read.timeout);
          }),
          Promise.resolve().then(() => host.reconcileReadOnly(read.intent, read.gate, {
            timeout_ms: read.timeout, max_observations: 4, signal: controller.signal,
          })).catch(() => undefined),
        ]);
        return underGate(request, 'reconcile', (gate) => {
          const intent = journal.observe(binding);
          const inTime = performance.now() <= deadline && resourceTime(clock()) < resourceTime(request.cleanup_deadline);
          return intent.status === 'unresolved' ? reconcile(gate, intent, inTime ? outcome : undefined) : result(intent);
        });
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    },
    withFreshHandoff(raw, phase, consume) {
      const envelope = readPreparationRequest(raw);
      const { request, binding } = envelope;
      requireResource(['handoff', 'prepared'].includes(phase), 'PREPARATION_HANDOFF_PHASE');
      return underGate(request, phase, (gate) => {
        const intent = journal.observe(binding);
        requireResource(intent?.status === 'git-ready', 'PREPARATION_GIT_NOT_READY');
        const current = review(envelope, gate);
        const readiness = host.loadGitReady(intent.evidence);
        requireResource(readiness && intent.evidence.digest === digest(readiness)
          && readiness.intent.effect_id === intent.effect_id && readiness.intent.request_digest === intent.request_digest,
        'PREPARATION_GIT_READY_BINDING');
        const observed = bootstrap.inspect(request, current.paths, current.taskKind, phase, gate);
        requireResource(readiness.workspace === workspaceGitDigest(observed.workspace)
          && readiness.git_identity === observed.git_identity
          && readiness.prior_owner === digest(observed.priorOwner)
          && (phase === 'prepared' || readiness.receipt === digest(observed.workspace.receipt)),
        'PREPARATION_GIT_READY_CHANGED');
        resourceAttest(verify, 'preparation_git_ready_current', { request, intent, readiness, observed, gate });
        return consume({ request, intent, observed, readiness, gate, verify, now: current.now, live: current.live,
          consumedNonces: host.consumedNonces });
      });
    },
  });
}
