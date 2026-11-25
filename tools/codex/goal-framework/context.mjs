import { canonicalJson, digest, validateCheckpoint } from './contracts.mjs';
import { requireResource, resourceAttest, resourceRef, resourceTime } from './resources.mjs';

function refs(values) {
  requireResource(Array.isArray(values) && values.length <= 64, 'REFERENCE_INVENTORY');
  for (const value of values) resourceRef(value);
  requireResource(new Set(values.map(({ id }) => id)).size === values.length, 'REFERENCE_CONFLICT');
  return values.map(({ id, digest }) => ({ id, digest }));
}

function sameInventory(left, right) {
  return canonicalJson(left.map(canonicalKey).sort()) === canonicalJson(right.map(canonicalKey).sort());
}

const canonicalKey = (value) => canonicalJson(value);

// Time and pressure prompt a checkpoint, never authority to rotate. Unknown
// telemetry keeps the same fixed elapsed-session deadline, including on resume.
export function contextDisposition({ session, telemetry, now, verify }) {
  const checkedAt = resourceTime(now);
  const opened = resourceTime(session.opened_at);
  const deadline = resourceTime(session.deadline);
  requireResource(opened <= checkedAt && deadline > opened && deadline < resourceTime(session.lineage_deadline), 'CONTEXT_WINDOW');
  resourceAttest(verify, 'bounded_context_session', session);
  if (checkedAt >= deadline) return { disposition: 'checkpoint_required', pressure: null, reason: 'session-deadline' };
  const observed = telemetry?.quality === 'observed' && telemetry.coverage === 'complete'
    && Number.isSafeInteger(telemetry.used) && Number.isSafeInteger(telemetry.capacity)
    && telemetry.used >= 0 && telemetry.capacity > 0 && telemetry.unit === session.unit
    && Number.isSafeInteger(session.telemetry_max_age_ms) && session.telemetry_max_age_ms > 0
    && resourceTime(telemetry.observed_at) >= Math.max(opened, checkedAt - session.telemetry_max_age_ms)
    && resourceTime(telemetry.observed_at) <= checkedAt;
  if (!observed) return { disposition: 'bounded_session', pressure: null, reason: 'context-telemetry-unavailable' };
  resourceAttest(verify, 'live_context_telemetry', { telemetry, session });
  requireResource(Number.isSafeInteger(session.checkpoint_percent) && session.checkpoint_percent > 0
    && session.checkpoint_percent <= 100, 'CONTEXT_THRESHOLD');
  const high = BigInt(telemetry.used) * 100n >= BigInt(telemetry.capacity) * BigInt(session.checkpoint_percent);
  return { disposition: high ? 'checkpoint_required' : 'bounded_session',
    pressure: { used: telemetry.used, capacity: telemetry.capacity, unit: telemetry.unit }, reason: high ? 'context-pressure' : null };
}

// The host re-fetches live control and a receipt on every invocation, including
// at resume. Authenticated status observations are intentionally outside the
// control identity used by validateCheckpoint.
export function handoffContext({ checkpoint, loadLive, verify, compaction }) {
  requireResource(typeof loadLive === 'function', 'CHECKPOINT_LIVE_FETCH');
  const { current, receipt } = loadLive();
  const validated = validateCheckpoint(checkpoint, { current, receipt, verify });
  const evidence = refs(validated.artifacts);
  const gates = refs(current.open_gates);
  requireResource(sameInventory(evidence, refs(current.required_artifacts)), 'CHECKPOINT_ARTIFACTS');
  requireResource(compaction && ['deterministic', 'metered'].includes(compaction.kind), 'COMPACTION_ACCOUNTING');
  if (compaction.kind === 'metered') resourceRef(compaction.reservation);
  resourceAttest(verify, 'checkpoint_gate_inventory', { checkpoint: validated, gates, evidence });
  resourceAttest(verify, 'checkpoint_compaction_accounting', { checkpoint: validated, compaction });
  const handoff = {
    schema: 'PFM_RESOURCE_HANDOFF_V1',
    repository: validated.repository,
    goal_issue: validated.goal_issue,
    goal_revision: validated.goal_revision,
    goal_control_digest: validated.goal_control_digest,
    task_issue: validated.task_issue,
    task_revision: validated.task_revision,
    issue_body_digest: receipt.issue_body_digest,
    lineage_id: validated.lineage_id,
    branch: validated.branch,
    head_sha: validated.head_sha,
    workspace_receipt: validated.workspace_receipt_ref,
    checkpoint: { id: validated.id, digest: digest(validated) },
    stopped_writer: validated.stopped_writer_ack,
    settled_decisions: validated.settled_decisions,
    unresolved_criteria: validated.unresolved_criteria,
    blockers: validated.blockers,
    open_gates: gates,
    evidence,
    compaction: compaction.kind === 'metered' ? { kind: 'metered', reservation: compaction.reservation } : { kind: 'deterministic' },
    next_action: validated.next_action,
  };
  return JSON.parse(canonicalJson(handoff));
}

const complexities = ['simple', 'standard', 'cross-cutting'];
const outcomes = ['clean-first-pass', 'blocked-repaired', 'incomplete'];
export const baselineStages = Object.freeze([
  'apiv-scope', 'bootstrap', 'coding', 'ci', 'independent-review', 'routine-pm', 'necessary-pm',
]);
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;

// Evidence is a catalog outside the report. Input is one measured cohort window
// with a predeclared metric inventory, including dimensions known to be missing.
export function baselineReport({ records, metrics, dataset, window, verify }) {
  requireResource(['manual-v3', 'synthetic'].includes(dataset) && resourceTime(window.start) < resourceTime(window.end)
    && Array.isArray(records) && records.length <= 256 && Array.isArray(metrics) && metrics.length <= 64, 'BASELINE_WINDOW');
  requireResource(new Set(metrics.map(({ id }) => id)).size === metrics.length
    && baselineStages.every((stage) => metrics.some((metric) => metric.stage === stage)), 'BASELINE_METRIC_INVENTORY');
  for (const metric of metrics) {
    requireResource(baselineStages.includes(metric.stage)
      && [metric.id, metric.unit, metric.source].every((key) => typeof key === 'string' && keyPattern.test(key))
      && (metric.pool === null || typeof metric.pool === 'string' && keyPattern.test(metric.pool)), 'BASELINE_METRIC');
  }
  const taskIds = new Set();
  const accepted = new Set();
  const rows = new Map();
  const recordDigests = [];
  for (const raw of records) {
    const record = JSON.parse(canonicalJson(raw));
    const { task, complexity, outcome, classified_at, started_at, outcome_at, acceptance, observations } = record;
    resourceRef(record.classification);
    resourceRef(record.disposition);
    const start = resourceTime(started_at);
    requireResource(typeof task === 'string' && keyPattern.test(task) && !taskIds.has(task)
      && complexities.includes(complexity) && outcomes.includes(outcome) && resourceTime(classified_at) < start
      && start >= resourceTime(window.start) && start < resourceTime(window.end)
      && resourceTime(outcome_at) >= start && resourceTime(outcome_at) <= resourceTime(window.end)
      && Array.isArray(observations) && observations.length === metrics.length, 'BASELINE_TASK');
    taskIds.add(task);
    if (acceptance !== null) {
      resourceRef(acceptance.evidence);
      requireResource(outcome !== 'incomplete' && typeof acceptance.capability === 'string'
        && keyPattern.test(acceptance.capability) && !accepted.has(acceptance.capability), 'BASELINE_ACCEPTANCE');
      accepted.add(acceptance.capability);
    }
    resourceAttest(verify, 'baseline_existing_evidence', { dataset, record });
    recordDigests.push(digest(record));
    const cohort = complexity + '/' + outcome;
    if (!rows.has(cohort)) rows.set(cohort, []);
    rows.get(cohort).push({ acceptance, observations: new Map(observations.map((value) => [value.metric, value])) });
    for (const metric of metrics) {
      const matches = observations.filter((entry) => entry.metric === metric.id);
      requireResource(matches.length === 1, 'BASELINE_MEASUREMENT_INVENTORY');
      const [{ value, quality, coverage, evidence, reason }] = matches;
      const missing = quality === 'unknown';
      requireResource(['observed', 'estimated', 'unknown'].includes(quality)
        && ['complete', 'partial', 'unknown'].includes(coverage)
        && (missing ? value === null && typeof reason === 'string' && keyPattern.test(reason)
          : Number.isFinite(value) && value >= 0 && coverage !== 'unknown' && reason === null)
        && (missing || evidence !== null), 'BASELINE_MEASUREMENT');
      if (evidence !== null) resourceRef(evidence);
    }
  }
  const cohorts = [];
  for (const complexity of complexities) {
    for (const outcome of outcomes) {
      const items = rows.get(complexity + '/' + outcome) ?? [];
      cohorts.push({ complexity, outcome, n: items.length, accepted: items.filter((item) => item.acceptance !== null).length,
        metrics: metrics.map((metric) => {
          const observations = items.map((item) => item.observations.get(metric.id));
          const measured = observations.filter(({ quality, coverage }) => quality === 'observed' && coverage === 'complete');
          const values = measured.map(({ value }) => value).sort((left, right) => left - right);
          const middle = Math.floor(values.length / 2);
          const median = values.length === 0 ? null : values.length % 2 === 1 ? values[middle] : values[middle - 1] / 2 + values[middle] / 2;
          const sum = values.reduce((total, value) => total + value, 0);
          requireResource(Number.isFinite(sum), 'BASELINE_MEASUREMENT_OVERFLOW');
          return { metric: metric.id, complete_observed: values.length, denominator: items.length,
            estimated: observations.filter(({ quality }) => quality === 'estimated').length,
            partial_observed: observations.filter(({ quality, coverage }) => quality === 'observed' && coverage === 'partial').length,
            missing: observations.filter(({ quality }) => quality === 'unknown').length,
            observed_sum: values.length ? sum : null, median, range: values.length ? [values[0], values.at(-1)] : null,
            reason: values.length ? null : items.length ? 'no-complete-observed-values' : 'no-tasks-in-cohort' };
        }) });
    }
  }
  return { schema: 'PFM_MANUAL_V3_BASELINE_V1', dataset, window, metrics, status: records.length ? 'collected' : 'not-measured',
    n: records.length, accepted: accepted.size, records_digest: digest(recordDigests.sort()), cohorts };
}
