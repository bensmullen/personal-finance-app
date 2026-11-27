import { canonicalJson, digest, validateRecord } from '../contracts.mjs';
import { requireResource, resourceAttest, resourceRef, resourceTime } from '../resources.mjs';

const copy = (value) => JSON.parse(canonicalJson(value));
const hash = /^[a-f0-9]{64}$/;
const sha = /^[a-f0-9]{40}$/;
const testFile = /^test\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.test\.ts$/;
const outcomes = ['PASS', 'FAIL', 'TIMEOUT', 'SKIP', 'INCOMPLETE'];
const noSelection = [
  'documentation-only', 'ci-sufficient', 'benefit-unknown', 'environment-unavailable', 'environment-unverified',
  'workspace-unverified', 'host-budget-denied', 'execution-unavailable', 'no-matching-unit', 'patch-unverified',
];
const typecheckMs = 60_000;
const unitMs = 30_000;
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const ref = (value) => ({ id: value.id, digest: digest(value) });

// This is a read-only port. The observation is independently authenticated
// against the worktree and toolchain the supervisor would actually use.
export function probeLocalPreflight(workspace, { inspectEnvironment, verify }) {
  const receipt = validateRecord(workspace, 'WORKSPACE_RECEIPT_V1');
  const binding = ref(receipt);
  const unknown = { schema: 'PFM_LOCAL_PREFLIGHT_CAPABILITY_V1', workspace: binding,
    state: 'unverified', toolchain: null, evidence: null };
  const value = inspectEnvironment(binding);
  if (value == null) return unknown;
  const observation = copy(value);
  resourceRef(observation.evidence);
  requireResource(digest(observation.workspace) === digest(binding), 'PREFLIGHT_ENVIRONMENT_WORKSPACE');
  resourceAttest(verify, 'local_preflight_environment', observation);
  const { node_major, npm_major, dependencies, toolchain, merged_tools } = observation;
  requireResource([node_major, npm_major].every((version) => version === null || positive(version))
    && [dependencies, merged_tools].every((status) => ['verified', 'unavailable', 'unverified'].includes(status)),
  'PREFLIGHT_ENVIRONMENT');
  if (toolchain !== null) resourceRef(toolchain);
  const unavailable = dependencies === 'unavailable' || merged_tools === 'unavailable'
    || node_major !== null && node_major !== 22 || npm_major !== null && npm_major !== 10;
  const verified = node_major === 22 && npm_major === 10 && dependencies === 'verified'
    && merged_tools === 'verified' && toolchain !== null;
  return { ...unknown, evidence: observation.evidence, toolchain,
    state: unavailable ? 'unavailable' : verified ? 'verified' : 'unverified' };
}

// At prepare, the approved profile is consulted before any future patch or
// writer is required. This is eligibility only. The caller repeats the same
// checks with a fresh host observation at the exact-patch selection boundary.
export function assessLocalPreflight({ workspace, capability, policy, allowance }, { verify, now }) {
  const receipt = validateRecord(workspace, 'WORKSPACE_RECEIPT_V1');
  for (const reference of [policy.profile, policy.evidence, allowance.evidence]) resourceRef(reference);
  requireResource(positive(policy.task_revision) && positive(policy.goal_issue) && positive(policy.goal_revision)
    && hash.test(policy.goal_control_digest) && ['simple', 'standard', 'cross-cutting'].includes(policy.risk)
    && ['documentation-only', 'ci-sufficient', 'worthwhile', 'unknown'].includes(policy.expected_benefit)
    && typeof policy.bound_hook_execution === 'boolean', 'PREFLIGHT_POLICY');
  requireResource(capability.schema === 'PFM_LOCAL_PREFLIGHT_CAPABILITY_V1'
    && ['verified', 'unavailable', 'unverified'].includes(capability.state)
    && digest(capability.workspace) === digest(ref(receipt))
    && (capability.state !== 'verified' || capability.evidence !== null && capability.toolchain !== null),
  'PREFLIGHT_CAPABILITY_BINDING');
  if (capability.evidence !== null) resourceRef(capability.evidence);
  if (capability.toolchain !== null) resourceRef(capability.toolchain);
  resourceAttest(verify, 'local_preflight_profile', { receipt, policy });
  resourceAttest(verify, 'local_preflight_capability', capability);
  resourceAttest(verify, 'local_preflight_resource_allowance', { receipt, policy: policy.profile, allowance, now });
  const budgetReady = allowance.granted === true && allowance.deadline !== null
    && resourceTime(allowance.deadline) - resourceTime(now) >= typecheckMs + unitMs
    && ['cpu_millicores', 'memory_mib', 'processes', 'disk_mib'].every((key) => positive(allowance[key]))
    && allowance.test_slots === 1 && allowance.foreground_idle === true;
  const reason = ['documentation-only', 'ci-sufficient'].includes(policy.expected_benefit) ? policy.expected_benefit
    : policy.expected_benefit === 'unknown' ? 'benefit-unknown'
      : receipt.state !== 'ready' || !receipt.ready_proof ? 'workspace-unverified'
        : capability.state !== 'verified' ? 'environment-' + capability.state
          : !budgetReady ? 'host-budget-denied'
            : !policy.bound_hook_execution ? 'execution-unavailable' : null;
  return { schema: 'PFM_LOCAL_PREFLIGHT_ELIGIBILITY_V1', workspace: ref(receipt),
    state: reason === null ? 'eligible' : 'ineligible', reason };
}

export function planLocalPreflight(preparation, raw, host) {
  const { workspace, capability, policy, allowance } = preparation;
  const eligibility = assessLocalPreflight(preparation, host);
  const candidate = copy(raw);
  requireResource(typeof candidate.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/.test(candidate.id)
    && sha.test(candidate.base_sha) && candidate.head_sha === workspace.head_sha
    && (candidate.patch_digest === null || hash.test(candidate.patch_digest))
    && (candidate.tool_digest === null || hash.test(candidate.tool_digest))
    && (candidate.lockfile_digest === null || hash.test(candidate.lockfile_digest))
    && Array.isArray(candidate.units) && candidate.units.length <= 64, 'PREFLIGHT_CANDIDATE');
  resourceRef(candidate.evidence);
  if (candidate.active_authorization !== null) resourceRef(candidate.active_authorization);
  resourceAttest(host.verify, 'local_preflight_patch_and_coverage', { candidate, workspace, profile: policy.profile });
  const units = candidate.units.filter((unit) => unit.tracked === true && unit.directly_affected === true);
  requireResource(candidate.units.every(({ path }) => typeof path === 'string' && path.length <= 200 && testFile.test(path))
    && new Set(candidate.units.map(({ path }) => path)).size === candidate.units.length, 'PREFLIGHT_UNIT_INVENTORY');
  const patchReady = candidate.patch_digest !== null && candidate.tool_digest !== null && candidate.lockfile_digest !== null
    && candidate.active_authorization !== null;
  const reason = eligibility.reason ?? (!patchReady ? 'patch-unverified' : units.length === 0 ? 'no-matching-unit' : null);
  return {
    schema: 'LOCAL_PREFLIGHT_DECISION_V1', authority: 'ADVISORY', id: candidate.id,
    repository: workspace.repository, goal_issue: policy.goal_issue, goal_revision: policy.goal_revision,
    goal_control_digest: policy.goal_control_digest, task_issue: workspace.task_issue, task_revision: policy.task_revision,
    issue_body_digest: workspace.issue_body_digest, branch: workspace.branch, workspace: eligibility.workspace,
    active_authorization: candidate.active_authorization,
    base_sha: candidate.base_sha, head_sha: candidate.head_sha, patch_digest: candidate.patch_digest,
    profile: policy.profile, policy_evidence: policy.evidence,
    tool_digest: candidate.tool_digest, lockfile_digest: candidate.lockfile_digest,
    toolchain: capability.toolchain, evidence: candidate.evidence, environment: capability.evidence,
    budget: { ref: allowance.evidence, deadline: allowance.deadline, typecheck_ms: typecheckMs, unit_ms: unitMs },
    selection: reason === null ? 'SELECTED' : 'NOT_SELECTED', reason: reason ?? 'bounded-typecheck-and-direct-unit',
    unit: reason === null ? units.map(({ path }) => path).sort()[0] : null,
  };
}

// The supervisor calls this check immediately before using the existing
// exact-command hook. This module neither invokes tests nor reserves attempts.
export function recheckLocalPreflight(decision, preparation, candidate, host) {
  const live = planLocalPreflight(preparation, candidate, host);
  requireResource(live.selection === 'SELECTED' && digest(live) === digest(decision), 'PREFLIGHT_DECISION_STALE');
  resourceAttest(host.verify, 'local_preflight_active_grant_and_exact_hook', live);
  return { schema: 'PFM_LOCAL_PREFLIGHT_SELECTION_V1', decision: ref(live), unit: live.unit };
}

/**
 * @typedef {{schema: 'PFM_LOCAL_PREFLIGHT_ADVISORY_V1', authority: 'ADVISORY',
 * decision: {id: string, digest: string}, selection: 'SELECTED'|'NOT_SELECTED',
 * outcome: 'NOT_ATTEMPTED'|'NOT_OBSERVED'|'PASS'|'FAIL'|'SKIP'|'TIMEOUT'|'INCOMPLETE',
 * reason: string, timeout_observed: boolean, receipt: {id: string, digest: string}|null}} PreflightAdvisory
 */

/** @returns {PreflightAdvisory} */
export function localPreflightAdvisory(raw, host) {
  const decision = copy(raw);
  const selected = decision.selection === 'SELECTED';
  requireResource(decision.schema === 'LOCAL_PREFLIGHT_DECISION_V1' && decision.authority === 'ADVISORY'
    && (selected ? decision.reason === 'bounded-typecheck-and-direct-unit' && testFile.test(decision.unit)
      : decision.selection === 'NOT_SELECTED' && noSelection.includes(decision.reason) && decision.unit === null),
  'PREFLIGHT_SELECTION_REASON');
  const decisionRef = ref(decision);
  resourceRef(decisionRef);
  resourceAttest(host.verify, 'local_preflight_saved_decision', decision);
  const attempt = selected ? host.readAttempt(decisionRef) : null;
  const advisory = (outcome, reason, receipt = null, timeout_observed = false) => ({
    schema: 'PFM_LOCAL_PREFLIGHT_ADVISORY_V1', authority: 'ADVISORY', decision: decisionRef,
    selection: decision.selection, outcome, reason, timeout_observed, receipt,
  });
  if (attempt === null) return advisory('NOT_ATTEMPTED', decision.reason);
  const bound = copy(attempt);
  requireResource(digest(bound.decision) === digest(decisionRef) && bound.patch_digest === decision.patch_digest
    && bound.tool_digest === decision.tool_digest && bound.lockfile_digest === decision.lockfile_digest
    && digest(bound.profile) === digest(decision.profile) && bound.unit === decision.unit
    && digest(bound.active_authorization) === digest(decision.active_authorization), 'PREFLIGHT_ATTEMPT_BINDING');
  resourceRef(bound.receipt);
  resourceAttest(host.verify, 'local_preflight_hash_bound_hook_attempt', bound);
  if (bound.host_observed === false) return advisory('NOT_OBSERVED', 'protected-result-missing', bound.receipt);
  requireResource(bound.host_observed === true && outcomes.includes(bound.outcome)
    && typeof bound.timeout_observed === 'boolean' && (bound.outcome !== 'TIMEOUT' || bound.timeout_observed)
    && (!bound.timeout_observed || ['TIMEOUT', 'FAIL', 'INCOMPLETE'].includes(bound.outcome)), 'PREFLIGHT_OUTCOME');
  return advisory(bound.outcome, 'protected-host-result', bound.receipt, bound.timeout_observed);
}
