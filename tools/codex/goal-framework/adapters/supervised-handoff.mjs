import { join } from 'node:path';
import { reviewPreparation, sha256 } from '../authorization.mjs';
import { canonicalJson, digest } from '../contracts.mjs';
import { requireResource, resourceAttest, resourceRef, resourceTime } from '../resources.mjs';
import { identifier, inspectWorkspace, readBoundedFile, reviewWorkspace } from '../workspace.mjs';
import { approvedPath, exactFields, preparationHead } from './bootstrap-host.mjs';
import { readPreparationRequest } from './supervised-preparation.mjs';

export function supervisedHandoff(raw, supervisor, host) {
  return supervisor.withFreshHandoff(raw, ({ request, intent }) => {
    // Inventory reads installed metadata only. No probe that creates a
    // session, a turn, a receipt or a provider-side reservation.
    const inventory = host.inventory?.(request) ?? { status: 'unverified', evidence: null };
    const { status, evidence } = exactFields(inventory, ['status', 'evidence'], 'HANDOFF_INVENTORY_FIELDS');
    requireResource(['unavailable', 'unverified', 'observed'].includes(status), 'HANDOFF_CAPABILITY');
    if (status !== 'unverified' || evidence !== null) {
      resourceRef(evidence);
      resourceAttest(host.verify, 'handoff_readonly_inventory', { request, inventory });
    }
    return { schema: 'PFM_SUPERVISED_HANDOFF_V1', request_digest: intent.request_digest, git_ready: intent.evidence,
      status: 'PREPARATION_ONLY', native: status === 'unavailable' ? 'HANDOFF_UNAVAILABLE' : 'HANDOFF_UNVERIFIED',
      directory: request.target, head: preparationHead(request), session: null,
      prompt: `PFM_TASK_ISSUE: ${request.task_issue}` };
  });
}

// Read actual UserPromptSubmit output from the protected worktree. A native
// host would have to establish this barrier independently before calling here.
// This port only reviews evidence and has no transition or native call.
export function reviewHookPreparedForAdmission(raw, handoff, target, input, host) {
  const { request, approval, binding } = readPreparationRequest(raw);
  const { verify, git } = host;
  const session = exactFields(target, ['session', 'turn', 'barrier'], 'HANDOFF_SESSION_FIELDS');
  requireResource([session.session, session.turn].every((value) => typeof value === 'string' && identifier.test(value)),
    'HANDOFF_SESSION');
  resourceRef(session.barrier);
  const current = exactFields(handoff, ['schema', 'request_digest', 'git_ready', 'status', 'native',
    'directory', 'head', 'session', 'prompt'], 'HANDOFF_FIELDS');
  resourceRef(current.git_ready);
  const head = preparationHead(request);
  requireResource(current.schema === 'PFM_SUPERVISED_HANDOFF_V1' && current.request_digest === binding.request_digest
    && current.status === 'PREPARATION_ONLY' && current.native === 'HANDOFF_UNVERIFIED' && current.session === null
    && current.directory === request.target && current.head === head && current.prompt === `PFM_TASK_ISSUE: ${request.task_issue}`,
  'HANDOFF_IDENTITY');
  requireResource(resourceTime(host.now) < resourceTime(request.expires_at), 'HANDOFF_EXPIRED');
  resourceAttest(verify, 'pm_exact_preparation_approval', { request, approval, now: host.now });
  resourceAttest(verify, 'handoff_live_nonwriting_barrier', { request, handoff: current, session });
  const identity = { repository: request.repository, goal_issue: request.goal_issue, goal_revision: request.goal_revision,
    task_issue: request.task_issue, head_sha: head };
  const auth = reviewPreparation(identity, input, host);
  requireResource(auth.issueBodyDigest === request.issue_body_digest && auth.branch === request.branch
    && auth.goal_control_digest === request.goal_control_digest && auth.census_digest === request.census.digest
    && input.census.id === request.census.id && auth.parser_revision === request.parser_revision
    && auth.parser_digest === request.parser_digest && input.task_revision === request.task_revision
    && input.lineage_id === request.lineage_id && input.resource === request.resource
    && digest(input.workspace.ready_proof) === digest(current.git_ready), 'HANDOFF_AUTHORITY');
  approvedPath(git);
  const observation = inspectWorkspace({ directory: request.target, environment: request.environment,
    repository: request.repository, git, base: head, verify });
  const receipt = observation.receipt;
  requireResource(receipt.status === 'prepared' && receipt.owner === session.session && receipt.issue === request.task_issue
    && receipt.body_digest === request.issue_body_digest, 'HANDOFF_HOOK_PREPARED');
  const runtime = join(request.target, '.codex', 'runtime');
  const pointerPath = join(runtime, 'latest-task.json');
  const pointerBytes = readBoundedFile(pointerPath, 1024);
  const pointer = JSON.parse(pointerBytes.toString('utf8'));
  requireResource(typeof pointer.path === 'string' && /^[A-Za-z0-9_.-]{1,200}\.json$/.test(pointer.path)
    && pointer.path !== 'latest-task.json' && pointer.sha256 === receipt.digest, 'HANDOFF_HOOK_POINTER');
  const bytes = readBoundedFile(join(runtime, pointer.path), 512 * 1024);
  const state = JSON.parse(bytes.toString('utf8'));
  requireResource(sha256(bytes) === receipt.digest && state.PREPARED === true && state.ACTIVE === false
    && state.SESSION_ID === session.session && state.TURN_ID === session.turn && state.BASE_HEAD === head
    && state.WORKTREE === request.target && state.TARGET_BRANCH === request.branch
    && state.AUTHORIZATION_ID === receipt.authorization_id && state.TASK_ISSUE?.number === request.task_issue
    && state.TASK_ISSUE.sha256 === request.issue_body_digest && state.TASK_KIND === auth.taskKind
    && state.DEPENDENCY_POLICY === auth.dependencyPolicy && canonicalJson(state.ALLOWED_PATHS) === canonicalJson(auth.allowedPaths)
    && readBoundedFile(pointerPath, 1024).equals(pointerBytes), 'HANDOFF_HOOK_BINDING');
  resourceAttest(verify, 'handoff_actual_hook_preparation', { request, handoff: current, session, receipt, identity });
  const workspace = reviewWorkspace(input.workspace, observation, input.remote,
    { ...identity, branch: request.branch, body_digest: request.issue_body_digest },
    { verify, phase: 'claim', paths: auth.required_paths, taskKind: auth.taskKind });
  return { schema: 'PFM_PREPARED_HANDOFF_REVIEW_V1', status: 'HOOK_PREPARED', request_digest: binding.request_digest,
    workspace: workspace.reference, observation_digest: digest(observation), authorization_id: receipt.authorization_id,
    receipt_digest: receipt.digest, session: session.session, turn: session.turn };
}
