import { canonicalJson, digest, validateRecord } from '../contracts.mjs';
import { requireResource, resourceAttest, resourceRef, resourceTime } from '../resources.mjs';
import { schemas } from '../schemas/v1.mjs';
import { exactFields, preparationHead } from './bootstrap-host.mjs';

const reportSchema = 'PFM_LOCAL_CAPABILITY_OBSERVATION_V1';
const reportBytes = 4096;
const freshnessMs = 10 * 60_000;
const sha = /^[a-f0-9]{40}$/;
const hash = /^[a-f0-9]{64}$/;
const id = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
const version = /^[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}(?:-[a-z0-9]+(?:\.[a-z0-9]+){0,4})?$/;
const reasons = ['missing', 'denied', 'unobserved', 'unsupported', 'malformed', 'oversized', 'unsafe-path',
  'changed', 'binding-mismatch', 'deadline', 'not-selected'];
const schemaFiles = ['ClientRequest.json', 'ServerNotification.json'];
const features = ['thread_identity_cwd', 'exact_prompt', 'model_effort', 'permissions', 'turn_start', 'turn_interrupt',
  'terminal', 'usage'];
const nativeControls = ['hard_ceiling', 'deadline_watchdog', 'host_isolation', 'foreground_capacity', 'kill_switch',
  'publication_fence', 'late_usage', 'artifact_retention', 'credential_separation', 'native_identity'];
const unknownHandoff = Object.freeze({ status: 'unverified', trust: 'unknown', evidence: null });

const matches = (pattern, value) => typeof value === 'string' && pattern.exec(value)?.[0] === value;
const pinVersion = (value) => matches(version, value) && value.length <= 64;
const fields = (value, keys) => exactFields(value, keys, 'LOCAL_CAPABILITY_FIELDS');

function checkRef(ref, expected) {
  resourceRef(ref);
  requireResource(ref.id === expected && matches(hash, ref.digest), 'LOCAL_CAPABILITY_REFERENCE');
}

function observation(raw, check) {
  const entry = fields(raw, ['status', 'reason', 'value']);
  if (entry.status === 'observed') {
    requireResource(entry.reason === null, 'LOCAL_CAPABILITY_OBSERVATION');
    check(entry.value);
  } else {
    requireResource(entry.status === 'unobserved' && reasons.includes(entry.reason) && entry.value === null,
      'LOCAL_CAPABILITY_OBSERVATION');
  }
}

export function readLocalCapability(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    requireResource(raw.length <= reportBytes + 1 && Buffer.byteLength(raw) <= reportBytes + 1, 'LOCAL_CAPABILITY_BOUND');
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error('LOCAL_CAPABILITY_JSON');
    }
  }
  const canonical = canonicalJson(data, reportBytes);
  if (typeof raw === 'string') {
    requireResource(raw === canonical || raw === canonical + '\n', 'LOCAL_CAPABILITY_NONCANONICAL');
  }
  const report = JSON.parse(canonical);
  if (report?.schema === 'PFM_LOCAL_CAPABILITY_ERROR_V1') {
    fields(report, ['schema', 'reason']);
    requireResource(report.reason === 'invalid-input', 'LOCAL_CAPABILITY_ERROR');
    return report;
  }
  fields(report, ['schema', 'surface', 'observed_at', 'head', 'control_revision', 'app', 'cli', 'protocol']);
  requireResource(report.schema === reportSchema && report.surface === 'local'
    && matches(sha, report.head) && matches(sha, report.control_revision)
    && matches(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/, report.observed_at), 'LOCAL_CAPABILITY_IDENTITY');
  resourceTime(report.observed_at);
  observation(report.app, (app) => {
    fields(app, ['version', 'build', 'ref']);
    requireResource(pinVersion(app.version) && matches(/^[0-9]{1,12}(?:\.[0-9]{1,12}){0,2}$/, app.build),
      'LOCAL_CAPABILITY_APP');
    checkRef(app.ref, 'desktop-plist');
  });
  observation(report.cli, (cli) => {
    fields(cli, ['version', 'version_source', 'platform', 'arch', 'ref']);
    requireResource((cli.version === null && cli.version_source === 'unobserved'
      || pinVersion(cli.version) && cli.version_source === 'operator-declared')
      && ['darwin', 'linux'].includes(cli.platform) && ['x86_64', 'arm64'].includes(cli.arch), 'LOCAL_CAPABILITY_CLI');
    checkRef(cli.ref, 'cli-binary');
  });
  observation(report.protocol, (protocol) => {
    fields(protocol, ['layout', 'source', 'binary', 'version', 'files', 'features']);
    checkRef(protocol.binary, 'cli-binary');
    requireResource(protocol.layout === 'schemars-draft7-unions-v1'
      && protocol.source === 'operator-declared-static-export' && pinVersion(protocol.version)
      && protocol.version === report.cli.value?.version && protocol.binary.digest === report.cli.value?.ref.digest
      && Array.isArray(protocol.files) && protocol.files.length === schemaFiles.length, 'LOCAL_CAPABILITY_PROTOCOL');
    schemaFiles.forEach((name, index) => checkRef(protocol.files[index], name));
    fields(protocol.features, features);
    requireResource(features.every((name) => typeof protocol.features[name] === 'boolean'), 'LOCAL_CAPABILITY_FEATURES');
  });
  return report;
}

function unverified(names) {
  return Object.fromEntries(names.map((name) => [name, { status: 'unverified', evidence: [] }]));
}

function matchesHost(report, context) {
  const now = resourceTime(context.now);
  const observed = resourceTime(report.observed_at);
  return observed <= now && now - observed <= freshnessMs
    && report.head === context.head && report.control_revision === context.control_revision
    && matches(id, context.host_id) && matches(id, context.environment) && matches(id, context.worker)
    && matches(hash, context.config_digest) && matches(hash, context.permissions_digest)
    && matches(hash, context.binary_digest) && context.binary_digest === report.cli.value?.ref.digest
    && pinVersion(context.tool_version) && context.tool_version === report.cli.value?.version
    && context.app_digest === (report.app.value?.ref.digest ?? null);
}

// Context, clock, envelope, verifier and external proof must come from the
// supervisor. The producer report is only data. No observation installs a port.
export function localCapabilityInventory(raw, context) {
  const report = readLocalCapability(raw);
  const reportRef = { id: 'local-capability-observation', digest: digest(report) };
  resourceRef(reportRef);
  const envelope = fields(context.envelope, ['repository', 'id', 'revision', 'created_at', 'producer']);
  requireResource(envelope.producer?.role === 'supervisor', 'LOCAL_CAPABILITY_SUPERVISOR');
  const proof = context.observation ?? null;
  let binding = null;
  let reason = report.schema === reportSchema ? 'external-observation-required' : 'invalid-input';
  if (report.schema === reportSchema && proof !== null) {
    fields(proof, ['evidence', 'observed_at']);
    resourceRef(proof.evidence);
    const proofTime = resourceTime(proof.observed_at);
    if (matchesHost(report, context) && proofTime >= resourceTime(report.observed_at)
        && proofTime <= resourceTime(context.now) && proof.evidence.digest !== reportRef.digest) {
      binding = { report: reportRef, evidence: proof.evidence, observed_at: proof.observed_at,
        repository: envelope.repository, head: context.head, control_revision: context.control_revision,
        host_id: context.host_id, environment: context.environment, worker: context.worker,
        config_digest: context.config_digest, permissions_digest: context.permissions_digest,
        binary_digest: context.binary_digest, tool_version: context.tool_version, app_digest: context.app_digest };
      resourceAttest(context.verify, 'local_capability_host_observation', binding);
      reason = 'native-enforcement-unverified';
    } else {
      reason = 'stale-or-mismatched-observation';
    }
  }

  const runner = validateRecord({ ...envelope, schema: 'RUNNER_CAPABILITIES_V1', surface: 'local', product: 'codex',
    runtime_version: binding ? report.app.value?.version ?? null : null,
    tool_version: binding ? report.cli.value.version : null,
    authentication_ref: null, references: binding ? [reportRef, binding.evidence] : [],
    operations: unverified(Object.keys(schemas.RUNNER_CAPABILITIES_V1.properties.operations.properties)),
  }, 'RUNNER_CAPABILITIES_V1');
  const runtime = { runner, transport: null, runtime: null, config_digest: null, permissions_digest: null,
    control_revision: null, resource_profile: null, native: unverified(nativeControls) };

  // The existing handoff also authenticates the returned inventory under its
  // current gate. This earlier review pins UI trust to a specific request and
  // selection, before the narrow {status, trust, evidence} port is populated.
  function handoffInventory(request, selection = null) {
    if (binding === null || request.repository !== binding.repository || request.host_id !== binding.host_id
        || request.environment !== binding.environment || request.worker !== binding.worker
        || request.parser_revision !== binding.control_revision || preparationHead(request) !== binding.head) {
      return unknownHandoff;
    }
    if (selection === null) return { status: 'observed', trust: 'unknown', evidence: binding.evidence };
    fields(selection, ['evidence', 'session', 'trust', 'observed_at']);
    resourceRef(selection.evidence);
    resourceRef(selection.session);
    const time = resourceTime(selection.observed_at);
    requireResource(['pending', 'observed'].includes(selection.trust) && time >= resourceTime(binding.observed_at)
      && time <= resourceTime(context.now) && selection.evidence.digest !== reportRef.digest
      && selection.evidence.digest !== binding.evidence.digest, 'LOCAL_CAPABILITY_TRUST');
    resourceAttest(context.verify, 'local_capability_hook_trust', { host: binding, request_digest: digest(request), selection });
    return { status: 'observed', trust: selection.trust, evidence: selection.evidence };
  }

  return { reason, report: reportRef, runtime, handoffInventory };
}
