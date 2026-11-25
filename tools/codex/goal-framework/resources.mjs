import {
  closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  readdirSync, realpathSync, renameSync, rmdirSync, writeFileSync,
} from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { canonicalJson, digest, validateRecord } from './contracts.mjs';

const identifier = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
const hex = /^[a-f0-9]{64}$/;
const dimensions = ['cpu_millicores', 'memory_mib', 'processes', 'disk_mib', 'ci_minutes', 'test_slots'];
const attempts = ['initial', 'continuation', 'repair', 'reassessment'];
const operations = ['planning', 'discovery', 'implementation', 'review', 'subagent', 'escalation',
  'compaction', 'cleanup', 'coordination', 'diagnostic'];
const risks = ['simple', 'standard', 'cross-cutting'];
const poolFields = ['account_scope', 'pool_id', 'unit'];
const actualFields = ['model', 'reasoning', 'surface', 'runtime'];
const taskFields = ['repository', 'goal_issue', 'goal_revision', 'goal_control_digest',
  'task_issue', 'task_revision', 'lineage_id'];
const goalBudgetFields = ['account_ceiling', 'goal_ceiling', 'execution_deadline', 'max_model_calls', 'max_continuations'];
const taskBudgetFields = ['task_ceiling'];
const ledgerPayloadBytes = 128 * 1024;
const version = 'PFM_RESOURCE_LEDGER_V1';

export function requireResource(condition, code) {
  if (!condition) throw new Error(code);
}

export function resourceTime(value) {
  requireResource(typeof value === 'string', 'RESOURCE_TIME');
  const parsed = Date.parse(value);
  requireResource(Number.isFinite(parsed)
    && new Date(parsed).toISOString().replace(/\.000Z$/, 'Z') === value.replace(/\.000Z$/, 'Z'), 'RESOURCE_TIME');
  return parsed;
}

export function resourceRef(value) {
  requireResource(value && Object.keys(value).length === 2
    && typeof value.id === 'string' && identifier.test(value.id)
    && typeof value.digest === 'string' && hex.test(value.digest), 'RESOURCE_REFERENCE');
}

export function resourceAttest(verify, boundary, binding) {
  requireResource(typeof verify === 'function' && verify(boundary, copy(binding)) === true,
    'UNAUTHENTICATED ' + boundary);
}

function copy(value) {
  return JSON.parse(canonicalJson(value));
}

function fieldsMatch(left, right, fields) {
  return fields.every((field) => left[field] === right[field]);
}

function counter(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function total(values) {
  const sum = values.reduce((result, value) => result + value, 0);
  requireResource(counter(sum), 'RESOURCE_OVERFLOW');
  return sum;
}

function vector(value) {
  requireResource(value && Object.keys(value).length === dimensions.length
    && dimensions.every((key) => counter(value[key])), 'HOST_VECTOR');
}

function actualProfile(actual) {
  requireResource(actual && Object.keys(actual).length === actualFields.length
    && actualFields.every((key) => typeof actual[key] === 'string' && identifier.test(actual[key])), 'ACTUAL_PROFILE');
}

function reasonCode(reason, required, code) {
  requireResource(reason == null ? !required : typeof reason === 'string' && identifier.test(reason), code);
}

function checkExpectedKeys(value, keys, code) {
  requireResource(value && Object.keys(value).every((key) => keys.includes(key)), code);
}

function selectProfile(registry, reference, reservation, operation, verify) {
  resourceRef(reference);
  requireResource(registry.schema === 'PFM_RESOURCE_PROFILES_V1' && Array.isArray(registry.profiles)
    && new Set(registry.profiles.map(({ id }) => id)).size === registry.profiles.length, 'PROFILE_REGISTRY');
  const profile = registry.profiles.find(({ id }) => id === reference.id);
  requireResource(profile && digest(profile) === reference.digest && profile.status === 'verified'
    && [profile.model, profile.reasoning, profile.surface, profile.runtime].every((id) => typeof id === 'string' && identifier.test(id))
    && Array.isArray(profile.operations) && profile.operations.includes(operation)
    && risks.includes(profile.max_risk)
    && risks.indexOf(reservation.risk) <= risks.indexOf(profile.max_risk)
    && (operation !== 'review' || profile.financial_review === true), 'PROFILE_UNAVAILABLE');
  resourceRef(profile.evidence);
  resourceAttest(verify, 'verified_resource_profile', { profile, reservation: reservation.id,
    operation, risk: reservation.risk });
  return profile;
}

// Private, local filesystem root. An abandoned lock requires independent operator
// reconciliation. It never expires based on a PID, timestamp or provider reset.
function syncDirectory(directory) {
  const descriptor = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function encodeEntry(value) {
  return canonicalJson(value, ledgerPayloadBytes) + '\n';
}

function publish(directory, name, encoded, fault) {
  const temporary = join(directory, '.pending');
  const descriptor = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(descriptor, encoded);
    fault?.('before-file-sync');
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, join(directory, name));
  fault?.('after-rename');
  syncDirectory(directory);
}

function readEntry(directory, name) {
  const path = join(directory, name);
  const stat = lstatSync(path);
  requireResource(stat.isFile() && stat.size <= ledgerPayloadBytes + 1, 'LEDGER_FILE');
  const raw = readFileSync(path, 'utf8');
  const value = JSON.parse(raw);
  requireResource(raw === encodeEntry(value), 'LEDGER_FILE');
  return value;
}

const fileName = (sequence) => String(sequence).padStart(12, '0') + '.json';

function replay(directory, header) {
  const names = readdirSync(directory).filter((name) => name !== 'header.json' && name !== '.lock').sort();
  const state = { runs: new Map(), nativeRuns: new Set(), pools: new Map(), observations: new Map(),
    goalBudgets: new Map(), taskBudgets: new Map(),
    eventDigests: new Map(), usageDigests: new Map(), sequence: 0, last: digest(header), now: resourceTime(header.created_at) };
  for (const name of names) {
    const sequence = state.sequence + 1;
    requireResource(name === fileName(sequence), 'LEDGER_SEQUENCE');
    const { hash, ...entry } = readEntry(directory, name);
    requireResource(hash === digest(entry) && entry.previous === state.last && entry.sequence === sequence
      && resourceTime(entry.at) >= state.now, 'LEDGER_CHAIN');
    applyEvent(state, entry.event, entry.at);
    state.sequence = sequence;
    state.last = hash;
    state.now = resourceTime(entry.at);
  }
  return state;
}

function budgetScopes(state, run) {
  return [
    { scope: 'goal', budgets: state.goalBudgets, key: run.goal_key, fields: goalBudgetFields },
    { scope: 'task', budgets: state.taskBudgets,
      key: digest([run.goal_key, run.reservation.lineage_id]), fields: taskBudgetFields },
  ];
}

function checkBudgetRevision(state, run, evidence, verify) {
  const { reservation } = run;
  const revised = [];
  for (const { scope, budgets, key, fields } of budgetScopes(state, run)) {
    const prior = budgets.get(key);
    if (!prior || fieldsMatch(prior.limits, reservation.limits, fields)) continue;
    const scopedReservations = [...state.runs.values()]
      .filter((item) => item.goal_key === run.goal_key && (scope === 'goal' || item.reservation.lineage_id === reservation.lineage_id))
      .map((item) => item.reservation);
    const newGoalControl = reservation.goal_issue === prior.goal_issue && reservation.goal_revision > prior.goal_revision
      && reservation.goal_control_digest !== prior.goal_control_digest
      && scopedReservations.every((item) => item.goal_issue !== reservation.goal_issue
        || item.goal_revision < reservation.goal_revision && item.goal_control_digest !== reservation.goal_control_digest);
    const newTaskControl = reservation.task_issue === prior.task_issue && reservation.task_revision > prior.task_revision
      && scopedReservations.every((item) => item.task_issue !== reservation.task_issue || item.task_revision < reservation.task_revision);
    requireResource(evidence != null && reservation.repository === prior.repository
      && (newGoalControl || scope === 'task' && newTaskControl), 'BUDGET_REVISION_REQUIRED');
    resourceRef(evidence);
    resourceAttest(verify, 'resource_budget_revision', { evidence, scope, goal_key: run.goal_key, prior, reservation });
    revised.push(scope);
  }
  return revised;
}

function applyEvent(state, event, at) {
  const { kind, id, data } = event;
  state.eventDigests.set(id, { kind, input_digest: event.input_digest });
  if (kind === 'snapshot') {
    const prior = state.pools.get(data.pool_id);
    // Derive the bound from the original reports, including older journal entries.
    const resetBound = prior && data.usable && data.account_epoch > prior.account_epoch;
    const previous = resetBound ? null : prior?.remaining ?? null;
    const reported = data.quality === 'observed' ? data.reported_remaining : null;
    const remaining = previous === null ? reported : Math.min(previous, reported ?? previous);
    state.pools.set(data.pool_id, { ...data, remaining });
  } else if (kind === 'observation') {
    const { usage, cumulative_key, billed } = data;
    state.usageDigests.set(digest([usage.repository, usage.id, usage.revision]), event.input_digest);
    if (billed !== null) state.observations.set(cumulative_key, billed);
    state.runs.get(usage.run_id).observed = data.observed;
  } else if (kind === 'reserve') {
    state.runs.set(data.reservation.id, { ...data, status: 'reserved', native: null, final: null, observed: 0 });
    for (const { scope, budgets, key } of budgetScopes(state, data)) {
      if (!budgets.has(key) || data.revised_budget_scopes?.includes(scope)) budgets.set(key, data.reservation);
    }
  } else {
    const run = state.runs.get(data.reservation_id);
    if (kind === 'intent') run.status = 'ambiguous';
    if (kind === 'started') {
      state.nativeRuns.add(data.native_run_id);
      if (run.status !== 'terminal') {
        run.status = data.matches_profile && !data.keep_quarantined ? 'started' : 'stop_requested';
      }
      Object.assign(run, { native: data.native_run_id, actual: data.actual,
        matches_profile: data.matches_profile, start_acknowledged: true });
    }
    if (kind === 'stop') run.status = 'stop_requested';
    if (kind === 'terminal') {
      if (data.native_run_id !== null) state.nativeRuns.add(data.native_run_id);
      Object.assign(run, { status: 'terminal', native: data.native_run_id, outcome: data.outcome,
        actual: data.actual ?? run.actual ?? null, matches_profile: data.matches_profile ?? run.matches_profile ?? null });
    }
    if (kind === 'settle' && run.final !== data.billed) {
      run.final = data.billed;
      run.final_at = at;
    }
  }
}

function liability(run) {
  return Math.max(run.observed, run.final ?? (run.reservation.estimated_ceiling + run.reservation.limits.cleanup_reserve));
}

function checkCapacity(state, run, policy, now, exclude = null) {
  const { reservation, pilot, host } = run;
  const { limits } = reservation;
  const snapshot = state.pools.get(limits.pool_id);
  const pool = policy.pools.find((item) => item.pool_id === limits.pool_id);
  requireResource(pool && fieldsMatch(pool, limits, poolFields)
    && limits.account_epoch === (snapshot?.account_epoch ?? pool.initial_epoch), 'ACCOUNT_POOL');
  const fresh = snapshot?.usable === true && now - resourceTime(snapshot.observed_at) <= policy.snapshot_max_age_ms
    && now < resourceTime(snapshot.reset_at);
  requireResource(pilot || fresh, 'QUOTA_UNKNOWN');
  const runs = [...state.runs.values()].filter((item) => item.reservation.id !== exclude);
  const shared = runs.filter((item) => item.reservation.limits.pool_id === limits.pool_id);
  const goal = runs.filter((item) => item.goal_key === run.goal_key);
  requireResource(goal.every((item) => fieldsMatch(item.reservation.limits, limits, poolFields)), 'GOAL_POOL_CHANGED');
  const task = goal.filter((item) => item.reservation.lineage_id === reservation.lineage_id);
  const active = runs.filter((item) => item.status !== 'terminal');
  const remaining = snapshot?.remaining ?? pool.ceiling;
  const quota = Number(BigInt(remaining) * BigInt(100 - policy.headroom_percent) / 100n);
  const sameEpoch = (item) => item.reservation.limits.account_epoch === limits.account_epoch;
  // Charge the whole epoch conservatively against remaining. Carry unsettled
  // or delayed prior-epoch charges until their coverage is independently established.
  const epochStart = snapshot?.epoch_start ? resourceTime(snapshot.epoch_start) : null;
  const epochRuns = shared.filter((item) => sameEpoch(item) || item.status !== 'terminal' || item.final === null
    || item.observed > item.final || epochStart === null || resourceTime(item.final_at) >= epochStart);
  const accountUsed = total(epochRuns.map(liability));
  const goalUsed = total(goal.map(liability));
  const taskUsed = total(task.map(liability));
  const need = liability(run);
  const ceiling = Math.min(pool.ceiling, limits.account_ceiling, quota);
  requireResource(need <= ceiling - accountUsed
    && need <= limits.goal_ceiling - goalUsed
    && need <= limits.task_ceiling - taskUsed, 'BUDGET_EXHAUSTED');
  if (pilot) {
    requireResource(need <= pool.pilot_ceiling - total(shared.filter((item) => item.pilot).map(liability)), 'PILOT_EXHAUSTED');
  }
  for (const key of dimensions) {
    requireResource(host[key] <= policy.host[key] - total(active.map((item) => item.host[key])), 'HOST_EXHAUSTED');
  }
  requireResource(host.ci_minutes <= policy.host.ci_minutes - total(runs.map((item) => item.host.ci_minutes)), 'CI_EXHAUSTED');
  requireResource(active.every((item) => item.fence !== run.fence), 'WRITER_QUARANTINED');
  if (run.parent !== null) {
    const parent = state.runs.get(run.parent);
    requireResource(parent?.status === 'started' && parent.goal_key === run.goal_key
      && parent.reservation.lineage_id === reservation.lineage_id
      && now < resourceTime(parent.reservation.expires_at)
      && resourceTime(limits.execution_deadline) <= resourceTime(parent.reservation.limits.execution_deadline), 'NESTED_RESERVATION');
  }
  for (const [items, caps] of [[goal, policy.goal_calls], [task, policy.task_calls]]) {
    const calls = total(items.map((item) => item.reservation.max_admitted_model_calls));
    const continuations = total(items.map((item) => item.reservation.max_admitted_continuations));
    requireResource(reservation.max_admitted_model_calls <= Math.min(caps.calls, limits.max_model_calls) - calls
      && reservation.max_admitted_continuations <= Math.min(caps.continuations, limits.max_continuations) - continuations,
    'CALL_EXHAUSTED');
    const count = (attempt) => items.filter((item) => item.attempt === attempt).length;
    if (run.attempt === 'repair') requireResource(count('repair') < caps.repairs, 'REPAIR_EXHAUSTED');
    if (run.attempt === 'reassessment') requireResource(count('repair') >= 2 && count('reassessment') === 0, 'REASSESSMENT_EXHAUSTED');
  }
  return { account_liability: accountUsed, goal_liability: goalUsed, task_liability: taskUsed,
    model_calls: total(goal.map((item) => item.reservation.max_admitted_model_calls)),
    continuations: total(goal.map((item) => item.reservation.max_admitted_continuations)) };
}

function validatePolicy(value) {
  const policy = copy({ headroom_percent: 20, ...value });
  requireResource(counter(policy.headroom_percent) && policy.headroom_percent < 100
    && counter(policy.snapshot_max_age_ms) && policy.snapshot_max_age_ms > 0
    && counter(policy.pilot_max_ms) && policy.pilot_max_ms > 0
    && Array.isArray(policy.pools) && policy.pools.length > 0
    && new Set(policy.pools.map(({ pool_id }) => pool_id)).size === policy.pools.length, 'RESOURCE_POLICY');
  vector(policy.host);
  for (const pool of policy.pools) {
    requireResource(poolFields.every((key) => typeof pool[key] === 'string' && identifier.test(pool[key]))
      && counter(pool.initial_epoch) && pool.initial_epoch > 0
      && counter(pool.ceiling) && counter(pool.pilot_ceiling) && pool.pilot_ceiling <= pool.ceiling, 'POOL_POLICY');
  }
  for (const caps of [policy.goal_calls, policy.task_calls]) {
    requireResource(caps && ['calls', 'continuations', 'repairs'].every((key) => counter(caps[key]))
      && caps.repairs <= 2, 'ATTEMPT_POLICY');
  }
  return policy;
}

// Every mutator is called by the trusted supervisor, never by a worker or from
// issue prose. The verifier establishes live authority and canonical identities.
export function openResourceLedger({ directory, ledgerId, initialize = false, policy: inputPolicy, registry, verify,
  clock = () => new Date().toISOString(), fault }) {
  const policy = validatePolicy(inputPolicy);
  registry = copy(registry);
  requireResource(typeof ledgerId === 'string' && identifier.test(ledgerId)
    && isAbsolute(directory) && realpathSync(directory) === directory, 'LEDGER_DIRECTORY');
  resourceAttest(verify, 'private_resource_ledger', { directory, ledgerId, policy, registry, initialize });
  const lock = join(directory, '.lock');
  const identity = { schema: version, ledger_id: ledgerId, policy_digest: digest(policy) };
  if (initialize) {
    const created_at = clock();
    resourceTime(created_at);
    const encoded = encodeEntry({ ...identity, created_at });
    mkdirSync(lock, { mode: 0o700 });
    syncDirectory(directory);
    if (readdirSync(directory).length !== 1) {
      rmdirSync(lock);
      syncDirectory(directory);
      throw new Error('LEDGER_ALREADY_INITIALIZED');
    }
    publish(directory, 'header.json', encoded, fault);
    rmdirSync(lock);
    syncDirectory(directory);
  }

  function transaction(action) {
    mkdirSync(lock, { mode: 0o700 });
    let release = false;
    try {
      syncDirectory(directory);
      const header = readEntry(directory, 'header.json');
      requireResource(fieldsMatch(header, identity, Object.keys(identity)), 'LEDGER_IDENTITY');
      const state = replay(directory, header);
      release = true;
      const at = clock();
      const now = resourceTime(at);
      requireResource(now >= state.now, 'CLOCK_ROLLBACK');
      resourceAttest(verify, 'resource_clock', { now: at, ledger_high_water_ms: state.now });
      const event = action(state, now);
      if (!event?.kind) return event;
      const entry = { sequence: state.sequence + 1, previous: state.last, at, event };
      const record = { ...entry, hash: digest(entry) };
      const encoded = encodeEntry(record);
      release = false;
      publish(directory, fileName(entry.sequence), encoded, fault);
      release = true;
      return { disposition: 'committed', reference: { id: event.id, digest: record.hash } };
    } finally {
      if (release) {
        rmdirSync(lock);
        syncDirectory(directory);
      }
    }
  }

  function submit(kind, id, data, prepare) {
    requireResource(typeof id === 'string' && identifier.test(id), 'EVENT_ID');
    data = copy(data);
    return transaction((state, now) => {
      const event = { kind, id, data, input_digest: digest(data) };
      const previous = state.eventDigests.get(id);
      if (previous) {
        requireResource(previous.kind === kind && previous.input_digest === event.input_digest, 'RESOURCE_EVENT_CONFLICT');
        return { disposition: 'duplicate' };
      }
      event.data = prepare(state, now, data, event.input_digest);
      if (event.data === null) return { disposition: 'duplicate' };
      return event;
    });
  }

  function checkAdmission(run, now) {
    const profile = selectProfile(registry, run.reservation.runtime_profile_ref, run.reservation, run.operation, verify);
    resourceAttest(verify, 'resource_reservation_authority', run);
    resourceAttest(verify, 'resource_mode', run);
    if (!run.pilot) resourceAttest(verify, 'native_resource_enforcement', run);
    resourceAttest(verify, 'foreground_capacity', { host: run.host, now });
    return profile;
  }

  function profileMatch(run, actual) {
    if (run.expected_actual) return fieldsMatch(actual, run.expected_actual, actualFields);
    const reference = run.reservation.runtime_profile_ref;
    const profile = registry.profiles.find((item) => item.id === reference.id);
    return profile && digest(profile) === reference.digest ? fieldsMatch(actual, profile, actualFields) : null;
  }

  return {
    snapshot(id, input) {
      return submit('snapshot', id, input, (state, now, data) => {
        checkExpectedKeys(data, [...poolFields, 'account_epoch', 'source', 'observed_at', 'reset_at',
          'evidence', 'quality', 'coverage', 'remaining', 'reason'], 'QUOTA_SNAPSHOT');
        reasonCode(data.reason, data.quality === 'unknown', 'QUOTA_SNAPSHOT');
        const pool = policy.pools.find((item) => fieldsMatch(item, data, poolFields));
        resourceRef(data.evidence);
        const observed = resourceTime(data.observed_at);
        requireResource(pool && counter(data.account_epoch) && data.account_epoch >= pool.initial_epoch
          && typeof data.source === 'string' && identifier.test(data.source)
          && observed <= now && ['observed', 'estimated', 'unknown'].includes(data.quality)
          && ['complete', 'partial', 'unknown'].includes(data.coverage)
          && (data.quality === 'unknown' ? data.remaining === null : counter(data.remaining)),
        'QUOTA_SNAPSHOT');
        const prior = state.pools.get(data.pool_id);
        const rollover = data.account_epoch > (prior?.account_epoch ?? pool.initial_epoch);
        requireResource(!prior || (observed > resourceTime(prior.observed_at) && data.account_epoch >= prior.account_epoch
          && (rollover ? prior.reset_at !== null && observed >= resourceTime(prior.reset_at)
            : data.reset_at === prior.reset_at)), 'STALE_QUOTA');
        const reset = data.reset_at === null ? null : resourceTime(data.reset_at);
        requireResource(reset === null || reset > observed, 'QUOTA_RESET');
        resourceAttest(verify, 'account_pool_snapshot', { snapshot: data, previous: prior ?? null });
        const valid = data.quality === 'observed' && data.coverage === 'complete' && reset !== null;
        if (rollover) {
          requireResource(valid, 'QUOTA_ROLLOVER_COVERAGE');
          resourceAttest(verify, 'account_pool_rollover', { snapshot: data, previous: prior ?? null,
            initial_epoch: pool.initial_epoch });
        }
        // An unknown/degraded report freezes this epoch until an authenticated rollover.
        const usable = valid && (!prior || rollover || prior.usable);
        return { pool_id: data.pool_id, account_scope: data.account_scope, unit: data.unit, account_epoch: data.account_epoch, source: data.source,
          observed_at: data.observed_at, reset_at: data.reset_at, evidence: data.evidence, quality: data.quality,
          epoch_start: rollover ? prior?.reset_at ?? null : prior?.epoch_start ?? null,
          coverage: data.coverage, reported_remaining: data.remaining, reason: data.reason ?? null, usable };
      });
    },
    reserve(id, input) {
      return submit('reserve', id, input, (state, now, data) => {
        const reservation = validateRecord(data.reservation, 'BUDGET_RESERVATION_V1');
        const { operation, attempt, pilot, host, parent, fence, goal_key } = data;
        requireResource(!state.runs.has(reservation.id) && reservation.state === 'reserved'
          && operations.includes(operation) && attempts.includes(attempt)
          && typeof pilot === 'boolean' && typeof fence === 'string' && identifier.test(fence)
          && typeof goal_key === 'string' && identifier.test(goal_key)
          && (parent === null || typeof parent === 'string' && identifier.test(parent))
          && (operation === 'subagent') === (parent !== null)
          && (operation === 'diagnostic') === (attempt === 'reassessment')
          && (operation !== 'compaction' || attempt === 'continuation')
          && (attempt !== 'continuation' || reservation.max_admitted_continuations > 0)
          && resourceTime(reservation.created_at) <= now && now < resourceTime(reservation.expires_at), 'RESERVATION_REQUEST');
        const { limits } = reservation;
        requireResource(reservation.estimated_ceiling > 0 && reservation.max_admitted_model_calls > 0
          && limits.cleanup_reserve > 0
          && (!pilot || resourceTime(limits.execution_deadline) - now <= policy.pilot_max_ms), 'RESERVATION_LIMIT');
        vector(host);
        requireResource(host.cpu_millicores > 0 && host.memory_mib > 0 && host.processes > 0 && host.disk_mib > 0, 'HOST_ESTIMATE');
        for (const prior of state.runs.values()) {
          if (prior.reservation.repository !== reservation.repository) continue;
          if (prior.reservation.goal_issue === reservation.goal_issue) {
            requireResource(prior.goal_key === goal_key, 'GOAL_IDENTITY_CHANGED');
          }
          if (prior.reservation.task_issue === reservation.task_issue) {
            requireResource(prior.goal_key === goal_key && prior.reservation.lineage_id === reservation.lineage_id, 'TASK_IDENTITY_CHANGED');
          }
        }
        const run = { reservation, operation, attempt, pilot, host, parent, fence, goal_key, final: null, observed: 0 };
        const profile = checkAdmission(run, now);
        const revised = checkBudgetRevision(state, run, data.budget_revision, verify);
        const carries = checkCapacity(state, run, policy, now);
        return { reservation: validateRecord({ ...reservation, carries }, 'BUDGET_RESERVATION_V1'),
          operation, attempt, pilot, host, parent, fence, goal_key,
          expected_actual: Object.fromEntries(actualFields.map((key) => [key, profile[key]])),
          ...(revised.length ? { budget_revision: data.budget_revision, revised_budget_scopes: revised } : {}) };
      });
    },
    // Persist intent before making a native call. A duplicate is reconciliation
    // only, including after a crash between commit and delivery of this result.
    begin(id, reservationId) {
      return submit('intent', id, { reservation_id: reservationId }, (state, now, data) => {
        const run = state.runs.get(reservationId);
        requireResource(run?.status === 'reserved' && now < resourceTime(run.reservation.expires_at), 'START_INELIGIBLE');
        checkAdmission(run, now);
        checkBudgetRevision(state, run, null, verify);
        checkCapacity(state, run, policy, now, reservationId);
        return data;
      });
    },
    started(id, input) {
      return submit('started', id, input, (state, now, data) => {
        const run = state.runs.get(data.reservation_id);
        requireResource(run && !run.start_acknowledged && typeof data.native_run_id === 'string'
          && identifier.test(data.native_run_id) && (run.status === 'terminal' ? run.native === data.native_run_id
            : ['ambiguous', 'stop_requested'].includes(run.status) && run.native === null
              && !state.nativeRuns.has(data.native_run_id)), 'START_ACK');
        actualProfile(data.actual);
        requireResource(!run.actual || fieldsMatch(data.actual, run.actual, actualFields), 'ACTUAL_PROFILE');
        resourceRef(data.evidence);
        resourceAttest(verify, 'resource_start_ack', { data, run, now });
        return { reservation_id: data.reservation_id, native_run_id: data.native_run_id,
          actual: data.actual, matches_profile: profileMatch(run, data.actual), keep_quarantined: run.status === 'stop_requested'
            || now >= resourceTime(run.reservation.expires_at), evidence: data.evidence };
      });
    },
    requestStop(id, reservationId) {
      return submit('stop', id, { reservation_id: reservationId }, (state, now, data) => {
        const run = state.runs.get(reservationId);
        requireResource(run && run.status !== 'terminal', 'STOP_INELIGIBLE');
        return data;
      });
    },
    terminal(id, input) {
      return submit('terminal', id, input, (state, now, data) => {
        const run = state.runs.get(data.reservation_id);
        resourceRef(data.evidence);
        requireResource(run && run.status !== 'terminal'
          && ['completed', 'stopped', 'failed', 'not_started'].includes(data.outcome)
          && (run.status !== 'reserved' || data.outcome === 'not_started')
          && (run.native === null || run.native === data.native_run_id)
          && (data.outcome === 'not_started' ? data.native_run_id === null
            : typeof data.native_run_id === 'string' && identifier.test(data.native_run_id)
              && (run.native === data.native_run_id || !state.nativeRuns.has(data.native_run_id))), 'TERMINAL_PROOF');
        resourceAttest(verify, 'resource_terminal_ack', { data, run, now });
        requireResource([...state.runs.values()].every((child) => child.parent !== data.reservation_id
          || child.status === 'terminal'), 'NESTED_RUN_ACTIVE');
        if (data.actual != null) {
          actualProfile(data.actual);
          requireResource(data.outcome !== 'not_started'
            && (!run.actual || fieldsMatch(data.actual, run.actual, actualFields)), 'ACTUAL_PROFILE');
        }
        return { reservation_id: data.reservation_id, native_run_id: data.native_run_id, outcome: data.outcome,
          actual: run.actual ? null : data.actual ?? null,
          matches_profile: data.actual == null ? null : profileMatch(run, data.actual), evidence: data.evidence };
      });
    },
    observe(id, input) {
      return submit('observation', id, input, (state, now, data, inputDigest) => {
        checkExpectedKeys(data, ['usage', 'canonical_billing', 'reason'], 'USAGE_BINDING');
        const usage = validateRecord(data.usage, 'USAGE_OBSERVATION_V1');
        reasonCode(data.reason, usage.value === null, 'USAGE_BINDING');
        requireResource(!Object.hasOwn(data, 'canonical_billing') || typeof data.canonical_billing === 'boolean', 'USAGE_BINDING');
        const previous = state.usageDigests.get(digest([usage.repository, usage.id, usage.revision]));
        if (previous) {
          requireResource(previous === inputDigest, 'USAGE_ID_CONFLICT');
          return null;
        }
        const run = state.runs.get(usage.run_id);
        requireResource(run && fieldsMatch(usage, run.reservation, taskFields)
          && usage.account_scope === run.reservation.limits.account_scope
          && resourceTime(usage.observed_at) <= now && resourceTime(usage.observed_at) >= resourceTime(run.reservation.created_at),
        'USAGE_BINDING');
        resourceAttest(verify, 'resource_usage_observation', { usage, run, reason: data.reason ?? null });
        // Billing observations are canonical cumulative run totals. Other sources
        // are preserved as evidence without adding overlapping usage counters.
        const cumulative_key = usage.run_id;
        const prior = state.observations.get(cumulative_key) ?? 0;
        let billed = null;
        if (data.canonical_billing === true) {
          requireResource(usage.quality === 'observed' && counter(usage.value)
            && fieldsMatch(usage, run.reservation.limits, [...poolFields, 'account_epoch']), 'BILLING_OBSERVATION');
          resourceAttest(verify, 'canonical_cumulative_billing', { usage, run });
          billed = Math.max(prior, usage.value);
        }
        return { usage, cumulative_key, billed, observed: billed ?? run.observed, reason: data.reason ?? null };
      });
    },
    settle(id, input) {
      return submit('settle', id, input, (state, now, data) => {
        const run = state.runs.get(data.reservation_id);
        resourceRef(data.evidence);
        requireResource(run?.status === 'terminal' && data.native_run_id === run.native
          && counter(data.billed) && data.billed >= Math.max(run.observed, run.final ?? 0), 'SETTLEMENT_BINDING');
        resourceAttest(verify, 'resource_final_billing', { data, run, now });
        return { reservation_id: data.reservation_id, native_run_id: data.native_run_id, billed: data.billed, evidence: data.evidence };
      });
    },
    lookup(reservationId) {
      return transaction((state) => {
        const run = state.runs.get(reservationId);
        requireResource(run, 'UNKNOWN_RESERVATION');
        const actual_profile_status = run.outcome === 'not_started' ? 'not_started'
          : run.matches_profile === true ? 'matches' : run.matches_profile === false ? 'mismatch' : 'unknown';
        return { reservation: run.reservation, status: run.status, native_run_id: run.native,
          actual: run.actual ?? null, actual_profile_status, billed: run.final, liability: liability(run) };
      });
    },
    summary() {
      return transaction((state, now) => ({
        records: state.sequence,
        pools: policy.pools.map(({ pool_id, unit }) => {
          const snapshot = state.pools.get(pool_id);
          const runs = [...state.runs.values()].filter((run) => run.reservation.limits.pool_id === pool_id);
          const fresh = snapshot?.usable === true && now < resourceTime(snapshot.reset_at)
            && now - resourceTime(snapshot.observed_at) <= policy.snapshot_max_age_ms;
          return { pool_id, unit, account_epoch: snapshot?.account_epoch ?? null,
            provider_remaining: fresh ? snapshot.remaining : null, reason: fresh ? null : 'no-usable-current-snapshot',
            lifetime_liability: total(runs.map(liability)),
            active: runs.filter((run) => run.status !== 'terminal').length,
            unsettled_terminal: runs.filter((run) => run.status === 'terminal' && run.final === null).length,
            reconcile: runs.filter((run) => run.status === 'ambiguous' || run.status === 'stop_requested'
              || run.status !== 'terminal' && now >= resourceTime(run.reservation.expires_at)).length };
        }),
      }));
    },
  };
}
