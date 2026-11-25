import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, statfsSync } from 'node:fs';
import { mkdtemp, open, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { crc32, inflateRawSync } from 'node:zlib';
import { digest, inspectV3Body, validateRecord } from '../codex/goal-framework/contracts.mjs';
import { root, validatePartition } from './plan-test-shards.mjs';
import { playwrightResults, validatePlaywright, validateVitest } from './collect-test-durations.mjs';

const repository = 'bensmullen/personal-finance-app';
const apiOrigin = 'https://api.github.com';
const sha = /^[a-f0-9]{40}$/;
const hash = /^[a-f0-9]{64}$/;
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/;
const workflowEvents = new Map([
  ['.github/workflows/test.yml', 'pull_request'],
  ['.github/workflows/engineering-validation.yml', 'workflow_dispatch'],
]);
const householdRunTitle = 'engineering-validation / household-readiness';
const householdLimits = Object.freeze({
  deadlineMs: 300_000, readinessMs: 120_000, diskBytes: 4 * 1024 ** 3, artifactBytes: 12 * 1024 ** 2,
  files: 12, retentionMs: 7 * 86_400_000, logBytes: 32 * 1024,
});
const householdCaptures = ['progress.jsonl', 'report.json', 'guided-trace.zip', 'guided-desktop.png', 'guided-mobile-200.png'];
const householdReasons = ['running', 'browser-exit', 'server-startup-exit', 'server-exit', 'readiness-timeout',
  'deadline', 'disk-budget', 'interrupted', 'supervisor-error'];
const otherManualTitles = new Set(['performance', 'forecast-scaling', 'stochastic', 'onboarding', 'provider']
  .map((profile) => 'engineering-validation / ' + profile));
const limits = Object.freeze({
  requests: 240, deadlineMs: 90_000, apiBytes: 16 * 1024 ** 2,
  jobLogBytes: 4 * 1024 ** 2, totalJobLogBytes: 32 * 1024 ** 2,
  archiveBytes: 16 * 1024 ** 2, totalArchiveBytes: 64 * 1024 ** 2,
  unpackedBytes: 32 * 1024 ** 2, totalUnpackedBytes: 128 * 1024 ** 2,
  files: 128, fileBytes: 8 * 1024 ** 2, retentionMs: 30 * 86_400_000,
});
const bytesDigest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const validOrdinaryBrowserCount = (count) => positive(count) && count <= 10_000;
const codeOf = (error) => error instanceof EvidenceError ? error.message : 'PROVIDER_UNAVAILABLE';
function attested(verify, boundary, binding) {
  try { return verify?.(boundary, binding) === true; } catch { return false; }
}
class EvidenceError extends Error {}
function requireEvidence(condition, code) {
  if (!condition) throw new EvidenceError(code);
}

export function parseEvidenceJson(bytes) {
  let json;
  let data;
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    data = JSON.parse(json);
  } catch {
    throw new EvidenceError('INVALID_JSON');
  }
  const stack = [];
  let tokens = 0;
  for (const [token, key] of json.matchAll(/("(?:[^"\\]|\\.)*")[ \t\r\n]*:|"(?:[^"\\]|\\.)*"|[{}\[\]]/gu)) {
    requireEvidence(++tokens <= 250_000 && stack.length <= 48, 'JSON_LIMIT');
    if (key !== undefined) {
      const name = JSON.parse(key);
      const current = stack.at(-1);
      requireEvidence(current instanceof Set && !current.has(name), 'DUPLICATE_JSON_KEY');
      current.add(name);
    } else if (token === '{' || token === '[') {
      stack.push(token === '{' ? new Set() : null);
    } else if (token === '}' || token === ']') {
      stack.pop();
    }
  }
  return data;
}

function safePath(path) {
  return typeof path === 'string' && path.length <= 240 &&
    path.split('/').every((part) => /^[A-Za-z0-9_.-]{1,120}$/.test(part) &&
      !part.endsWith('.') && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}

function validateZipExtras(zip, start, length) {
  const end = start + length;
  for (let at = start; at < end;) {
    requireEvidence(at + 4 <= end && zip.readUInt16LE(at) === 0x5455, 'ZIP_EXTRA');
    at += 4 + zip.readUInt16LE(at + 2);
    requireEvidence(at <= end, 'ZIP_EXTRA');
  }
}

// Parse in memory. GitHub ZIP files may use a data descriptor. Central and
// local metadata must describe one contiguous, single-disk archive.
export function inspectEvidenceZip(zip, maxUnpacked = limits.unpackedBytes, observeJson = () => {},
  observeFile = () => {}, reserveUnpacked = () => {}) {
  const end = zip.length - 22;
  requireEvidence(end >= 0 && zip.length <= limits.archiveBytes, 'ZIP_SIZE');
  const u16 = (at) => zip.readUInt16LE(at);
  const u32 = (at) => zip.readUInt32LE(at);
  requireEvidence(u32(end) === 0x06054b50 && u32(end + 4) === 0 && u16(end + 20) === 0, 'ZIP_END');
  const count = u16(end + 10);
  const start = u32(end + 16);
  requireEvidence(count > 0 && count <= limits.files && u16(end + 8) === count &&
    start + u32(end + 12) === end, 'ZIP_DIRECTORY');
  const names = new Set();
  const entries = [];
  let unpacked = 0;
  let at = start;
  for (let i = 0; i < count; i++) {
    requireEvidence(at + 46 <= end && u32(at) === 0x02014b50, 'ZIP_ENTRY');
    const flags = u16(at + 8), method = u16(at + 10), crc = u32(at + 16);
    const compressed = u32(at + 20), size = u32(at + 24);
    const length = u16(at + 28), extra = u16(at + 30), comment = u16(at + 32);
    const attributes = u32(at + 38), offset = u32(at + 42);
    const fileType = (attributes >>> 16) & 0xf000;
    const next = at + 46 + length + extra + comment;
    requireEvidence(next <= end && u16(at + 34) === 0 && (flags & ~0x0808) === 0 &&
      (method === 0 || method === 8) && (fileType === 0 || fileType === 0x8000) &&
      (attributes & 0x10) === 0, 'ZIP_FILE_TYPE');
    const rawName = zip.subarray(at + 46, at + 46 + length);
    const name = rawName.toString('latin1');
    requireEvidence(safePath(name) && !names.has(name.toLowerCase()), 'ZIP_PATH');
    names.add(name.toLowerCase());
    validateZipExtras(zip, at + 46 + length, extra);
    unpacked += size;
    requireEvidence(size <= limits.fileBytes && unpacked <= maxUnpacked, 'ZIP_UNPACKED_LIMIT');
    requireEvidence(offset + 30 <= start && u32(offset) === 0x04034b50 &&
      u16(offset + 6) === flags && u16(offset + 8) === method && u16(offset + 26) === length &&
      rawName.equals(zip.subarray(offset + 30, offset + 30 + length)), 'ZIP_LOCAL');
    const body = offset + 30 + length + u16(offset + 28);
    let nextOffset = body + compressed;
    requireEvidence(nextOffset <= start, 'ZIP_LOCAL');
    validateZipExtras(zip, offset + 30 + length, u16(offset + 28));
    if (flags & 8) {
      requireEvidence(nextOffset + 12 <= start, 'ZIP_DESCRIPTOR');
      if (u32(nextOffset) === 0x08074b50) nextOffset += 4;
      requireEvidence(nextOffset + 12 <= start && u32(nextOffset) === crc &&
        u32(nextOffset + 4) === compressed && u32(nextOffset + 8) === size, 'ZIP_DESCRIPTOR');
      nextOffset += 12;
    } else {
      requireEvidence(u32(offset + 14) === crc && u32(offset + 18) === compressed &&
        u32(offset + 22) === size, 'ZIP_LOCAL');
    }
    entries.push({ name, offset, nextOffset, body, compressed, size, method, crc });
    at = next;
  }
  requireEvidence(at === end, 'ZIP_DIRECTORY');
  let nextOffset = 0;
  for (const entry of entries.sort((a, b) => a.offset - b.offset)) {
    requireEvidence(entry.offset === nextOffset, 'ZIP_OVERLAP_OR_GAP');
    nextOffset = entry.nextOffset;
  }
  requireEvidence(nextOffset === start, 'ZIP_OVERLAP_OR_GAP');
  reserveUnpacked(unpacked);
  const files = entries.map(({ name, body, compressed, size, method, crc }) => {
    const payload = zip.subarray(body, body + compressed);
    let decoded;
    try {
      decoded = method === 0 ? payload : inflateRawSync(payload, { maxOutputLength: Math.max(1, size), info: true });
    } catch {
      throw new EvidenceError('ZIP_DEFLATE');
    }
    if (method === 8) {
      requireEvidence(decoded.engine.bytesWritten === compressed, 'ZIP_DEFLATE');
      decoded = decoded.buffer;
    }
    requireEvidence(decoded.length === size && crc32(decoded) === crc, 'ZIP_INTEGRITY');
    if (name.toLowerCase().endsWith('.json')) observeJson(name, parseEvidenceJson(decoded));
    observeFile(name, decoded);
    return { name, size, digest: bytesDigest(decoded) };
  });
  return { files, unpacked };
}

async function readBounded(response, maxBytes, charge) {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    await response.body?.cancel();
    throw new EvidenceError('DOWNLOAD_LIMIT');
  }
  requireEvidence(response.body, 'MISSING_BODY');
  const chunks = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, total);
      total += value.byteLength;
      charge(value.byteLength);
      requireEvidence(total <= maxBytes, 'DOWNLOAD_LIMIT');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
}

function storageUrl(location) {
  let url;
  try { url = new URL(location); } catch { throw new EvidenceError('ARTIFACT_ORIGIN'); }
  requireEvidence(url.protocol === 'https:' && !url.port && !url.username && !url.password && !url.hash &&
    /^productionresultssa[0-9]*\.blob\.core\.windows\.net$/.test(url.hostname), 'ARTIFACT_ORIGIN');
  return url;
}

export function githubEvidenceProvider(token, fetcher = fetch) {
  requireEvidence(typeof token === 'string' && token.length > 0 && !/\s/.test(token), 'GITHUB_TOKEN_REQUIRED');
  const root = '/repos/' + repository;
  const signal = AbortSignal.timeout(limits.deadlineMs);
  let requests = 0, apiBytes = 0, archiveBytes = 0, logBytes = 0;
  async function request(url, authenticated) {
    requireEvidence(!signal.aborted && ++requests <= limits.requests, 'REQUEST_LIMIT');
    return fetcher(url, {
      signal, redirect: 'manual',
      headers: authenticated ? {
        authorization: 'Bearer ' + token, accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      } : {},
    });
  }
  const endpoint = (route) => apiOrigin + root + route;
  async function json(route) {
    const response = await request(endpoint(route), true);
    if (!response.ok) {
      await response.body?.cancel();
      throw new EvidenceError('GITHUB_RESPONSE');
    }
    const bytes = await readBounded(response, Math.min(2 * 1024 ** 2, limits.apiBytes - apiBytes),
      (size) => { apiBytes += size; });
    return parseEvidenceJson(bytes);
  }
  async function list(route, field) {
    const items = [];
    for (let page = 1; page <= 4; page++) {
      const separator = route.includes('?') ? '&' : '?';
      const response = await json(route + separator + 'per_page=50&page=' + page);
      const entries = response[field];
      requireEvidence(Array.isArray(entries) && entries.length <= 50 &&
        Number.isSafeInteger(response.total_count) && response.total_count <= 200, 'PAGE_LIMIT');
      items.push(...entries);
      requireEvidence(items.length <= response.total_count, 'PAGE_INVENTORY');
      if (items.length === response.total_count) return items;
      requireEvidence(entries.length === 50, 'PAGE_INVENTORY');
    }
    throw new EvidenceError('PAGE_LIMIT');
  }
  async function download(route, maxBytes, charge) {
    const response = await request(endpoint(route), true);
    await response.body?.cancel();
    requireEvidence(response.status === 302, 'ARTIFACT_REDIRECT');
    const blob = await request(storageUrl(response.headers.get('location')), false);
    if (!blob.ok) {
      await blob.body?.cancel();
      throw new EvidenceError('ARTIFACT_DOWNLOAD');
    }
    return readBounded(blob, maxBytes, charge);
  }
  return {
    json, list,
    async download(id) {
      requireEvidence(positive(id), 'ARTIFACT_ID');
      return download('/actions/artifacts/' + id + '/zip',
        Math.min(limits.archiveBytes, limits.totalArchiveBytes - archiveBytes), (size) => { archiveBytes += size; });
    },
    async jobLog(id) {
      requireEvidence(positive(id), 'JOB_ID');
      return download('/actions/jobs/' + id + '/logs',
        Math.min(limits.jobLogBytes, limits.totalJobLogBytes - logBytes), (size) => { logBytes += size; });
    },
    measurements: () => ({ requests, api_bytes: apiBytes, archive_bytes: archiveBytes, job_log_bytes: logBytes }),
  };
}

const unique = (values) => new Set(values).size === values.length;
const knownFields = (value, fields) => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && Object.keys(value).every((key) => fields.includes(key));
const skippedMatrixNames = new Map(['unit', 'e2e'].flatMap((kind, index) =>
  [kind, kind + ' (shard /' + (index + 3) + ')', kind + ' (shard ${{ matrix.shard }}/' + (index + 3) + ')']
    .map((name) => [name, kind])));
const safeJob = (name) => typeof name === 'string' && (/^[A-Za-z0-9 ()_./-]{1,96}$/.test(name) ||
  skippedMatrixNames.has(name));
const revisions = ['goal_issue', 'goal_revision', 'task_issue', 'task_revision'];
const identityPaths = [
  'package-lock.json', 'playwright.config.ts', 'tools/ci/verification-plan.mjs',
  'tools/ci/plan-test-shards.mjs', 'tools/ci/collect-test-durations.mjs',
  'tools/codex/quiet-playwright.mjs', 'tools/codex/quiet-vitest.mjs',
  'docs/development/goal-framework/households.json', 'e2e/framework-household-readiness.spec.ts',
  'test/fixtures/goalFramework/households/guided.json', 'test/d2/integrated/jointHousehold/s8Five/oracle.ts',
];
const shardJob = /^(unit|e2e) \(shard (\d)\/(3|4)\)$/;
const ordinaryBrowserJobs = [1, 2, 3, 4].map((i) => 'e2e (shard ' + i + '/4)');
const ordinaryJobs = ['verification-plan', 'spec', 'architecture', 'codex-tooling', 'typecheck', 'build',
  'forecast-feasibility', 'test', 'deploy', ...[1, 2, 3].map((i) => 'unit (shard ' + i + '/3)'),
  ...ordinaryBrowserJobs];

function validateSelection(input) {
  const { task, candidate, plan, workflows, inputs, implementer } = input;
  requireEvidence(knownFields(input, ['task', 'candidate', 'plan', 'workflows', 'inputs', 'implementer']), 'SELECTION_FIELDS');
  requireEvidence(knownFields(task, ['repository', 'goal_control_digest', 'issue_body_digest', ...revisions]) &&
    task.repository === repository && revisions.every((key) => positive(task[key])) &&
    hash.test(task.goal_control_digest) && hash.test(task.issue_body_digest), 'TASK_IDENTITY');
  requireEvidence(knownFields(implementer, ['actor', 'session']) && typeof implementer.actor === 'string' && identifier.test(implementer.actor) &&
    typeof implementer?.session === 'string' && identifier.test(implementer.session), 'IMPLEMENTER_IDENTITY');
  requireEvidence(knownFields(candidate, ['pr', 'head_sha', 'base_sha', 'merge_candidate_sha', 'verification_plan_digest']) &&
    positive(candidate.pr) && sha.test(candidate.head_sha) && sha.test(candidate.base_sha) &&
    sha.test(candidate.merge_candidate_sha) && candidate.base_sha !== candidate.head_sha, 'CANDIDATE_IDENTITY');
  requireEvidence(Array.isArray(workflows) && workflows.length > 0 && workflows.length <= 2 &&
    unique(workflows.map(({ path }) => path)) && unique(workflows.map(({ id }) => id)) &&
    workflows.every((workflow) => knownFields(workflow, ['id', 'path', 'digest', 'ref']) &&
      positive(workflow.id) && workflowEvents.has(workflow.path) && hash.test(workflow.digest) &&
      (workflowEvents.get(workflow.path) === 'workflow_dispatch' ?
        safePath(workflow.ref) && /^refs\/(heads|tags)\//.test(workflow.ref) : workflow.ref === undefined)), 'WORKFLOW_PIN');
  requireEvidence(Array.isArray(plan) && plan.length > 0 && plan.length <= 24 &&
    plan.some(({ required }) => required === true) &&
    unique(plan.map(({ id }) => id)) && unique(plan.map(({ workflow, job }) => workflow + ':' + job)) &&
    plan.every((check) => knownFields(check, ['id', 'job', 'workflow', 'required', 'artifact_required', 'selection', 'artifact', 'files']) &&
      identifier.test(check.id) && workflows.some(({ id }) => id === check.workflow) &&
      safeJob(check.job) && typeof check.required === 'boolean' && typeof check.artifact_required === 'boolean' &&
      ['selected', 'excluded'].includes(check.selection) && (!check.required || check.selection === 'selected') &&
      (check.artifact_required ? typeof check.artifact === 'string' && check.artifact.length <= 120 &&
        /^[A-Za-z0-9_.-]+(?:\{run\}-)?(?:\{attempt\})?[A-Za-z0-9_.-]*$/.test(check.artifact) : check.artifact === undefined) &&
      (check.files === undefined || (check.artifact_required && Array.isArray(check.files) && check.files.length <= 24 &&
        unique(check.files) && check.files.every(safePath)))), 'PLAN_INVENTORY');
  requireEvidence(digest(plan) === candidate.verification_plan_digest, 'PLAN_DIGEST');
  for (const workflow of workflows) {
    const selected = plan.filter(({ workflow: id }) => id === workflow.id);
    const ordinary = workflowEvents.get(workflow.path) === 'pull_request';
    const inventory = ordinary ? ordinaryJobs : ['validate', 'household-readiness', 'agent-incident'];
    requireEvidence(selected.length === inventory.length && inventory.every((job) => selected.some((check) => check.job === job)) &&
      (ordinary ? ['verification-plan', 'test'] : ['household-readiness']).every((job) =>
        selected.some((check) => check.job === job && check.required)), 'WORKFLOW_JOB_INVENTORY');
    for (const kind of ['unit', 'e2e']) {
      const shards = selected.filter(({ job }) => job.startsWith(kind + ' (shard '));
      requireEvidence(new Set(shards.map(({ selection }) => selection)).size <= 1, 'PARTIAL_SHARD_PLAN');
    }
    for (const check of selected) {
      requireEvidence(check.selection === 'excluded' || check.required, 'SELECTED_GATE_REQUIRED');
      const shard = check.job.match(shardJob);
      if (shard && check.selection === 'selected') {
        requireEvidence(check.required && check.artifact_required &&
          check.artifact === shard[1] + '-diagnostics-' + shard[2] + '-' + candidate.merge_candidate_sha,
        'SHARD_ARTIFACT_PLAN');
      }
      if (check.job === 'household-readiness') {
        requireEvidence(check.id === 'household-readiness' && check.artifact_required && check.artifact === 'household-readiness-{run}-{attempt}' &&
          ['inventory.json', 'execution.json', 'server.log', 'progress.jsonl', 'report.json', 'resources.json', 'resources.txt', 'guided-desktop.png',
            'guided-mobile-200.png', 'guided-trace.zip'].every((file) => check.files?.includes(file)),
        'HOUSEHOLD_ARTIFACT_PLAN');
      }
    }
  }
  requireEvidence(Array.isArray(inputs) && inputs.length >= identityPaths.length && inputs.length <= 32 &&
    unique(inputs.map(({ path }) => path)) && identityPaths.every((path) => inputs.some((pin) => pin.path === path)) &&
    inputs.every((pin) => knownFields(pin, ['path', 'digest']) && safePath(pin.path) && hash.test(pin.digest)), 'INPUT_PINS');
}

const conclusions = new Map([
  ['success', 'PASS'], ['failure', 'FAIL'], ['startup_failure', 'FAIL'], ['action_required', 'FAIL'],
  ['skipped', 'SKIP'], ['neutral', 'INCOMPLETE'], ['timed_out', 'TIMEOUT'],
  ['cancelled', 'INCOMPLETE'], ['stale', 'INCOMPLETE'],
]);
function outcome(record) {
  return record.status === 'completed' ? conclusions.get(record.conclusion) ?? 'INCOMPLETE' : 'INCOMPLETE';
}
const dispositions = ['FAIL', 'TIMEOUT', 'INCOMPLETE', 'SKIP', 'PASS', 'NOT_APPLICABLE'];
function worst(outcomes) {
  return dispositions.find((status) => outcomes.includes(status)) ?? 'INCOMPLETE';
}

async function exactPull(provider, candidate) {
  const pr = await provider.json('/pulls/' + candidate.pr);
  requireEvidence(pr.number === candidate.pr && pr.state === 'open' && pr.base?.ref === 'main' &&
    pr.base.repo?.full_name === repository && positive(pr.base.repo.id) &&
    pr.head?.repo?.id === pr.base.repo.id && pr.head.sha === candidate.head_sha &&
    pr.base.sha === candidate.base_sha && pr.merge_commit_sha === candidate.merge_candidate_sha, 'STALE_CANDIDATE');
  requireEvidence(typeof pr.head.ref === 'string' && safePath(pr.head.ref), 'PR_HEAD_REF');
  return { repoId: pr.base.repo.id, branch: pr.head.ref };
}

async function currentIssues(provider, task, branch) {
  const goal = await provider.json('/issues/' + task.goal_issue);
  const issue = await provider.json('/issues/' + task.task_issue);
  requireEvidence(goal.number === task.goal_issue && goal.state === 'open' && !goal.pull_request &&
    issue.number === task.task_issue && issue.state === 'open' && !issue.pull_request &&
    typeof goal.body === 'string' && typeof issue.body === 'string' &&
    bytesDigest(issue.body) === task.issue_body_digest, 'STALE_TASK_AUTHORITY');
  let grant;
  try { grant = inspectV3Body(issue.body); } catch { throw new EvidenceError('INVALID_SAVED_V3'); }
  requireEvidence(grant.branch === branch, 'TASK_TARGET_BRANCH');
  return { goal_issue_body_digest: bytesDigest(goal.body), target_branch: branch };
}

async function pinContents(provider, commit, { path, digest: expected }) {
  const content = await provider.json('/contents/' + path + '?ref=' + commit);
  requireEvidence(content.type === 'file' && content.path === path && content.encoding === 'base64' &&
    typeof content.content === 'string' && Number.isSafeInteger(content.size), 'PIN_CONTENT');
  const bytes = Buffer.from(content.content, 'base64');
  requireEvidence(bytes.length === content.size && bytesDigest(bytes) === expected, 'PIN_MISMATCH');
  return bytes;
}

function knownOtherPull(run, candidate) {
  return Array.isArray(run.pull_requests) && run.pull_requests.length > 0 &&
    run.pull_requests.every((pr) => positive(pr.number) && pr.number !== candidate.pr);
}

async function runInventory(provider, workflow, candidate) {
  const base = '/actions/workflows/' + workflow.id + '/runs';
  const event = workflowEvents.get(workflow.path);
  const heads = [event === 'pull_request' ? candidate.head_sha : candidate.merge_candidate_sha];
  const runs = new Map();
  for (const head of heads) {
    const found = await provider.list(base + '?event=' + event + '&head_sha=' + head, 'workflow_runs');
    requireEvidence(unique(found.map(({ id }) => id)), 'DUPLICATE_RUN');
    for (const run of found) {
      requireEvidence(positive(run.id) && run.event === event && run.head_sha === head &&
        run.workflow_id === workflow.id && run.path === workflow.path, 'RUN_LOOKUP_IDENTITY');
      if (event === 'pull_request' && knownOtherPull(run, candidate)) continue;
      if (event === 'workflow_dispatch' && otherManualTitles.has(run.display_title)) continue;
      requireEvidence(!runs.has(run.id) && runs.size < 8, 'RUN_INVENTORY_LIMIT');
      runs.set(run.id, run);
    }
  }
  return [...runs.values()].sort((a, b) => a.id - b.id);
}

function validateRun(run, original, workflow, candidate, pull) {
  const { repoId, branch } = pull;
  requireEvidence(run.id === original.id && positive(run.run_attempt) && run.run_attempt <= 8 &&
    run.workflow_id === workflow.id && run.path === workflow.path &&
    run.event === workflowEvents.get(workflow.path) && run.check_suite_id === original.check_suite_id &&
    run.repository?.id === repoId && run.head_repository?.id === repoId &&
    positive(run.check_suite_id), 'RUN_PROVENANCE');
  if (run.event === 'pull_request') {
    const associations = run.pull_requests;
    requireEvidence(run.head_sha === candidate.head_sha && run.head_branch === branch &&
      Array.isArray(associations) && associations.length === 1 &&
      associations[0].number === candidate.pr && associations[0].head?.sha === candidate.head_sha &&
      associations[0].head.ref === branch && associations[0].head.repo?.id === repoId &&
      associations[0].base?.sha === candidate.base_sha && associations[0].base.ref === 'main' &&
      associations[0].base.repo?.id === repoId, 'RUN_PR_ASSOCIATION');
  } else {
    requireEvidence(run.head_sha === candidate.merge_candidate_sha && run.display_title === householdRunTitle &&
      run.head_branch === workflow.ref.replace(/^refs\/(heads|tags)\//, ''), 'RUN_DISPATCH_REF');
  }
}

const caseKey = (path, title) => digest([path, title]);
const inventoryDigest = (ids) => bytesDigest(JSON.stringify([...ids].sort()));

function unitFailureLog(bytes) {
  const failures = new Map();
  if (!bytes || bytes.length === limits.fileBytes) return failures;
  let key;
  let reporterFailures = false;
  for (const line of bytes.toString('utf8').replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/)) {
    if (/^\s*⎯+ Failed Tests \d+ ⎯+\s*$/.test(line)) reporterFailures = true;
    if (!reporterFailures) continue;
    const header = /^\s*FAIL\s+(test\/[^ >]+)\s+>\s+(.+?)\s*$/.exec(line);
    if (header && header[2].length <= 512 && failures.size < 256) {
      key = caseKey(header[1], header[2].split(' > ').join(' › '));
      failures.set(key, failures.has(key) ? 'INCOMPLETE' : 'FAIL');
    } else if (key) {
      if (/^Error: Test timed out in [1-9]\d{0,7}ms\.?$/.test(line.trim()) && failures.get(key) === 'FAIL') {
        failures.set(key, 'TIMEOUT');
      }
      if (line.trim()) key = undefined;
    }
  }
  return failures;
}

function inspectHouseholdExecution(execution, candidate, run, ref, files) {
  if (!execution) return { reason: 'missing', outcome: 'INCOMPLETE' };
  requireEvidence(execution.schema === 1 && execution.sha === candidate.merge_candidate_sha &&
    String(execution.attempt) === String(run.run_attempt) && String(execution.run_id) === String(run.id) &&
    execution.ref === ref && Number.isSafeInteger(execution.elapsed_ms) && execution.elapsed_ms >= 0 &&
    householdReasons.includes(execution.reason) && typeof execution.ready === 'boolean', 'MANUAL_EXECUTION_IDENTITY');
  const { reason, ready, elapsed_ms } = execution;
  if (reason === 'running') return { reason, ready, elapsed_ms, outcome: 'INCOMPLETE' };
  const processResult = (value) => value === null || (knownFields(value, ['exit', 'signal', 'spawn_error']) &&
    ((Number.isInteger(value.exit) && value.exit >= 0 && value.exit <= 255 && value.signal === null && value.spawn_error === null) ||
      (value.exit === null && /^SIG[A-Z0-9]{1,12}$/.test(value.signal) && value.spawn_error === null) ||
      (value.exit === null && value.signal === null && /^[A-Z0-9_]{1,40}$/.test(value.spawn_error))));
  const { server, browser, cleanup, terminated, log_truncated, captures } = execution;
  requireEvidence(processResult(server) && processResult(browser) &&
    knownFields(terminated, ['server', 'browser']) && processResult(terminated.server) && processResult(terminated.browser) &&
    ['stopped', 'incomplete'].includes(cleanup) && typeof log_truncated === 'boolean' &&
    knownFields(captures, householdCaptures) && householdCaptures.every((name) =>
      ['retained', 'missing', 'truncated', 'invalid'].includes(captures[name]) &&
      (captures[name] === 'retained') === files.some((file) => file.name === name && file.size > 0)) &&
    (reason !== 'browser-exit' || (ready && browser && !server)) &&
    (reason !== 'server-startup-exit' || (!ready && server)) &&
    (reason !== 'server-exit' || (ready && server)) &&
    (reason !== 'readiness-timeout' || !ready), 'MANUAL_EXECUTION_RECORD');
  const outcome = reason === 'deadline' || reason === 'readiness-timeout' ? 'TIMEOUT' :
    ['server-startup-exit', 'server-exit'].includes(reason) || (reason === 'browser-exit' && browser.exit !== 0) ? 'FAIL' :
      reason === 'browser-exit' && cleanup === 'stopped' && terminated.server && !log_truncated &&
        Object.values(captures).every((value) => value === 'retained') ? 'PASS' : 'INCOMPLETE';
  return { reason, ready, elapsed_ms, server, browser, terminated, cleanup, log_truncated, captures, outcome };
}

function householdProgress(bytes, selected) {
  const events = new Map();
  if (!bytes) return events;
  requireEvidence(bytes.length <= householdLimits.logBytes, 'MANUAL_PROGRESS_LIMIT');
  const lines = bytes.toString('utf8').split('\n');
  lines.pop(); // An interruption can leave the final write incomplete.
  requireEvidence(lines.length <= 64, 'MANUAL_PROGRESS_LIMIT');
  for (const line of lines) {
    const { phase, id, attempt, status, ids } = parseEvidenceJson(Buffer.from(line));
    if (phase === 'inventory') {
      requireEvidence(Array.isArray(ids) && ids.length === selected.length &&
        unique(ids) && ids.every((item) => selected.some(({ id }) => id === item)), 'MANUAL_PROGRESS_INVENTORY');
      continue;
    }
    if (phase === 'error') continue;
    requireEvidence(selected.some((item) => item.id === id) && Number.isSafeInteger(attempt) && attempt >= 0 &&
      (phase === 'start' || (phase === 'end' && ['passed', 'failed', 'timedOut', 'skipped', 'interrupted'].includes(status))),
    'MANUAL_PROGRESS_EVENT');
    if (!events.has(id)) events.set(id, new Map());
    const attempts = events.get(id);
    requireEvidence(!attempts.get(attempt), 'MANUAL_PROGRESS_EVENT');
    attempts.set(attempt, phase === 'end' ? status : null);
  }
  return events;
}

function inspectHouseholdEvidence(json, files, progressBytes, candidate, run, witnesses, ref) {
  const inventory = json.get('inventory.json');
  requireEvidence(inventory?.sha === candidate.merge_candidate_sha &&
    String(inventory.attempt) === String(run.run_attempt) && String(inventory.run_id) === String(run.id) &&
    inventory.ref === ref && validOrdinaryBrowserCount(inventory.ordinary_count) &&
    typeof inventory.ordinary_digest === 'string' && hash.test(inventory.ordinary_digest) &&
    inventory.ux_count > inventory.ordinary_count && hash.test(inventory.ux_digest) &&
    Array.isArray(inventory.manual) && inventory.manual.length === 4 && unique(inventory.manual), 'MANUAL_INVENTORY');
  const selected = inventory.manual.map((id) => {
    const title = typeof id === 'string' && id.startsWith(manualFile) &&
      /^\d+:\d+ › (.{1,512})$/.exec(id.slice(manualFile.length))?.[1];
    const key = title && caseKey(manualFile.slice(0, -1), title);
    requireEvidence(key && witnesses.has(key), 'MANUAL_TEST_COVERAGE');
    return { id, key };
  });
  requireEvidence(unique(selected.map(({ key }) => key)), 'MANUAL_TEST_COVERAGE');
  const execution = inspectHouseholdExecution(json.get('execution.json'), candidate, run, ref, files);
  const progress = householdProgress(progressBytes, selected);
  const report = json.get('report.json');
  validateBrowserPaths(report);
  if (report?.config) report.config.rootDir = root + '/e2e';
  const tests = playwrightResults(report);
  requireEvidence(unique(tests.map(({ id }) => id)) &&
    tests.every(({ id }) => selected.some((item) => item.id === id)), 'MANUAL_TEST_COVERAGE');
  const failures = [];
  const resultOutcome = (status) => ({ failed: 'FAIL', timedOut: 'TIMEOUT', skipped: 'SKIP', passed: 'PASS' })[status] ?? 'INCOMPLETE';
  const retain = (test_digest, attempt, outcome, reason) => {
    requireEvidence(failures.length < 128 && Number.isSafeInteger(attempt) && attempt >= 0, 'TEST_FAILURE_LIMIT');
    failures.push({ test_digest, attempt, outcome, reason });
  };
  const case_dispositions = selected.map(({ id }) => {
    const test = tests.find((item) => item.id === id)?.test;
    const results = test?.results ?? [];
    const test_digest = bytesDigest(id);
    const attempts = progress.get(id);
    for (const [attempt, status] of attempts ?? []) {
      if (status !== 'passed' && !results.some((result) => result.retry === attempt)) {
        retain(test_digest, attempt, resultOutcome(status), status ? 'progress-' + status : 'case-interrupted');
      }
    }
    for (const result of results) {
      if (result.status === 'passed') continue;
      const errors = [...(result.errors ?? []), result.error].map((error) => error?.message ?? '');
      const connection = errors.some((message) => /net::ERR_CONNECTION_(?:RESET|REFUSED|CLOSED)/.test(message));
      const assertion = errors.some((message) => /\bexpect\(|\bAssertionError\b/.test(message));
      const reason = assertion ? 'assertion' : connection ? 'server-connection' : result.status === 'failed' ? 'case-failure' :
        result.status === 'timedOut' ? 'case-timeout' : result.status === 'skipped' ? 'case-skipped' : 'case-interrupted';
      retain(test_digest, result.retry, resultOutcome(result.status), reason);
    }
    const failed = failures.filter((failure) => failure.test_digest === test_digest);
    if (failed.length) {
      const outcome = worst(failed.map((failure) => failure.outcome));
      return { test_digest, outcome, reason: failed.find((failure) => failure.outcome === outcome).reason };
    }
    if (!results.length) {
      return attempts?.size === 1 && attempts.get(0) === 'passed' ? { test_digest, outcome: 'PASS', reason: 'progress-passed' } :
        { test_digest, outcome: 'INCOMPLETE', reason: 'unrun' };
    }
    const passed = test.status === 'expected' && test.expectedStatus === 'passed' &&
      results.length === 1 && results[0].retry === 0 && results[0].status === 'passed';
    return { test_digest, outcome: passed ? 'PASS' : 'INCOMPLETE', reason: passed ? 'completed' : 'unexpected-result' };
  });
  const valid = validatePlaywright(report, selected) && selected.every(({ id }) => {
    const attempts = progress.get(id);
    return attempts?.size === 1 && attempts.get(0) === 'passed';
  });
  const outcome = worst([execution.outcome, valid ? 'PASS' : 'INCOMPLETE', ...case_dispositions.map((item) => item.outcome)]);
  return { execution, case_dispositions, failures, outcome,
    ...(execution.outcome === 'TIMEOUT' ? { runner_outcome: 'TIMEOUT' } : {}),
    ordinary_inventory: { count: inventory.ordinary_count, digest: inventory.ordinary_digest },
    witness_cases: outcome === 'PASS' ? selected.map(({ key, id }) => ({ key, test_digest: bytesDigest(id) })) : [] };
}

function validateBrowserPaths(report) {
  const suites = [...(report?.suites ?? [])];
  while (suites.length) {
    const suite = suites.pop();
    requireEvidence((suite.specs ?? []).every(({ file }) => safePath(file)), 'BROWSER_REPORT_PATH');
    suites.push(...(suite.suites ?? []));
  }
}

function inspectTestEvidence(check, json, runnerLog, candidate, run, witnesses) {
  const shard = check.job.match(shardJob);
  if (!shard) return {};
  const report = json.get('report.json');
  const execution = json.get('execution.json');
  let selected;
  let assignment_digest;
  let ordinary_inventory;
  if (shard) {
    const [, kind, index, count] = shard;
    const proof = json.get('assignment.json');
    requireEvidence(proof?.schema === 1 && proof.sha === candidate.merge_candidate_sha &&
      proof.kind === kind && proof.count === Number(count) && proof.shards?.length === Number(count) &&
      execution?.schema === 1 && execution.sha === candidate.merge_candidate_sha && execution.kind === kind &&
      String(execution.runAttempt) === String(run.run_attempt), 'SHARD_IDENTITY');
    if (kind === 'e2e') requireEvidence(validOrdinaryBrowserCount(proof.inventory?.length), 'SHARD_INVENTORY');
    try { validatePartition(proof.inventory, proof.shards); } catch { throw new EvidenceError('SHARD_INVENTORY'); }
    selected = proof.shards[Number(index) - 1];
    requireEvidence(selected.length > 0, 'EMPTY_SHARD');
    assignment_digest = bytesDigest(JSON.stringify({ inventory: proof.inventory, shards: proof.shards }));
    if (kind === 'e2e') ordinary_inventory = { count: proof.inventory.length,
      digest: inventoryDigest(proof.inventory.map(({ id }) => id)) };
  }
  const failures = [];
  const retain = (id, attempt, status) => {
    requireEvidence(failures.length < 128, 'TEST_FAILURE_LIMIT');
    failures.push({ test_digest: bytesDigest(id), attempt, outcome: status });
  };
  let valid;
  const cases = [];
  if (shard?.[1] === 'unit') {
    const hostedRoot = '/home/runner/work/personal-finance-app/personal-finance-app/';
    const files = report?.testResults ?? [];
    for (const file of files) {
      requireEvidence(typeof file.name === 'string' && file.name.startsWith(hostedRoot) &&
        safePath(file.name.slice(hostedRoot.length)), 'UNIT_REPORT_PATH');
      file.name = root + '/' + file.name.slice(hostedRoot.length);
    }
    valid = validateVitest(report, selected);
    const logged = unitFailureLog(runnerLog);
    for (const file of report?.testResults ?? []) {
      for (const test of file.assertionResults ?? []) {
        const path = file.name.slice(root.length + 1);
        const titles = [...(test.ancestorTitles ?? []), test.title];
        requireEvidence(titles.length <= 12 && titles.every((title) => typeof title === 'string' && title.length <= 512),
          'UNIT_CASE_IDENTITY');
        const key = caseKey(path, titles.join(' › '));
        cases.push({ key, id: path + ' › ' + titles.join(' › ') });
        if (test.status !== 'passed') {
          const sanitized = test.failureMessages?.every((message) => message === 'STACK_TRACE_ERROR');
          const status = ['pending', 'todo', 'skipped'].includes(test.status) ? 'SKIP' :
            logged.get(key) ?? (sanitized && test.failureMessages?.length ? 'INCOMPLETE' : 'FAIL');
          retain(key, 0, status);
        }
      }
    }
  } else {
    validateBrowserPaths(report);
    if (report?.config) report.config.rootDir = root + '/e2e';
    valid = validatePlaywright(report, selected);
    const tests = playwrightResults(report);
    for (const { id, test } of tests) {
      const identity = /^(?:\[[^\]]+\] › )?([^:]+):\d+:\d+ › (.+)$/.exec(id);
      requireEvidence(identity && identity[2].length <= 512, 'BROWSER_CASE_IDENTITY');
      cases.push({ key: caseKey(identity[1], identity[2]), id });
      if (test.expectedStatus !== 'passed' || !test.results?.length) retain(id, 0, 'SKIP');
      for (const result of test.results ?? []) {
        if (result.status !== 'passed') retain(id, result.retry,
          ({ failed: 'FAIL', timedOut: 'TIMEOUT', skipped: 'SKIP' })[result.status] ?? 'INCOMPLETE');
      }
    }
  }
  const result = worst(failures.map(({ outcome: status }) => status));
  const hasFailures = failures.length > 0;
  const passed = valid && (!shard || (execution.status === 'passed' && execution.reportValid === true &&
    execution.exit === 0 && execution.signal === null && execution.context === null));
  const matched = cases.filter(({ key }) => witnesses.has(key));
  requireEvidence(unique(matched.map(({ key }) => key)), 'AMBIGUOUS_WITNESS_CASE');
  return {
    ...(assignment_digest ? { assignment_digest } : {}), failures,
    ...(ordinary_inventory ? { ordinary_inventory } : {}),
    ...(execution?.context === 'deadline-exceeded' ? { runner_outcome: 'TIMEOUT' } : {}),
    witness_cases: passed && !hasFailures ? matched.map(({ key, id }) => ({ key, test_digest: bytesDigest(id) })) : [],
    outcome: execution?.context === 'deadline-exceeded' ? worst(['TIMEOUT', ...(hasFailures ? [result] : [])]) :
      hasFailures ? result : passed ? 'PASS' : 'INCOMPLETE',
  };
}

async function artifactEvidence(provider, artifacts, name, run, repoId, now, budget, check, candidate, witnesses, ref) {
  const matching = artifacts.filter((artifact) => artifact.name === name);
  requireEvidence(matching.length === 1, 'ARTIFACT_MISSING_OR_DUPLICATE');
  const artifact = matching[0];
  const manual = check.job === 'household-readiness';
  const expires = Date.parse(artifact.expires_at), created = Date.parse(artifact.created_at);
  requireEvidence(artifact.expired === false && created <= now && expires > now && expires > created &&
    expires - created <= (manual ? householdLimits.retentionMs : limits.retentionMs) + 1000 && positive(artifact.id) &&
    positive(artifact.size_in_bytes) && artifact.size_in_bytes <= limits.archiveBytes &&
    typeof artifact.digest === 'string' && /^sha256:[a-f0-9]{64}$/.test(artifact.digest) &&
    artifact.workflow_run?.id === run.id && artifact.workflow_run.repository_id === repoId &&
    artifact.workflow_run.head_repository_id === repoId && artifact.workflow_run.head_sha === run.head_sha, 'ARTIFACT_PROVENANCE');
  const zip = await provider.download(artifact.id);
  const checksum = bytesDigest(zip);
  requireEvidence(zip.length === artifact.size_in_bytes && artifact.digest === 'sha256:' + checksum, 'ARTIFACT_DIGEST');
  const wanted = new Set(['execution.json', 'assignment.json', 'report.json', 'inventory.json', 'resources.json']);
  const json = new Map();
  let runnerLog;
  let progress;
  const { files, unpacked } = inspectEvidenceZip(zip,
    Math.min(budget.remaining, manual ? householdLimits.artifactBytes : limits.unpackedBytes), (path, data) => {
    if (wanted.has(path)) json.set(path, data);
  }, (path, bytes) => {
    if (path === 'runner.log' && check.job.startsWith('unit (shard ')) runnerLog = bytes;
    if (path === 'progress.jsonl' && manual) progress = bytes;
  }, (size) => { budget.remaining -= size; });
  if (manual) requireEvidence(files.length <= householdLimits.files, 'MANUAL_FILE_LIMIT');
  const tests = manual ? inspectHouseholdEvidence(json, files, progress, candidate, run, witnesses, ref) :
    inspectTestEvidence(check, json, runnerLog, candidate, run, witnesses);
  const missing = (check.files ?? []).filter((path) => !files.some(({ name, size }) => name === path && size > 0));
  return {
    id: 'github-artifact:' + artifact.id, digest: checksum, expires_at: artifact.expires_at,
    bytes: zip.length, unpacked_bytes: unpacked, file_count: files.length,
    files: files.filter((file) => check.files?.includes(file.name)), ...tests,
    ...(missing.length ? { missing_files: missing, outcome: worst([tests.outcome, 'INCOMPLETE']) } : {}),
  };
}

async function checkoutObservation(provider, job, steps, candidate) {
  const name = job.name === 'test' ? 'Checkout shard evidence verifier' : 'Run actions/checkout@v4';
  const checkout = steps.filter((step) => step.name === name);
  const started = Date.parse(checkout[0]?.started_at);
  const ended = Date.parse(checkout[0]?.completed_at);
  requireEvidence(checkout.length === 1 && outcome(checkout[0]) === 'PASS' &&
    Number.isFinite(started) && ended >= started, 'CHECKOUT_STEP');
  if (job.name === 'test' && outcome(job) === 'PASS') {
    const verification = steps.filter((step) => step.name === 'Require exact-head successful receipts from every selected child');
    requireEvidence(verification.length === 1 && verification[0].number > checkout[0].number &&
      outcome(verification[0]) === 'PASS', 'AGGREGATE_SHARD_VERIFICATION');
  }
  const bytes = await provider.jobLog(job.id);
  requireEvidence(Buffer.isBuffer(bytes) && bytes.length <= limits.jobLogBytes, 'JOB_LOG_LIMIT');
  // The reviewed workflows run checkout before any candidate code. For the
  // aggregate, only the pinned inline gate precedes checkout. Ignore the
  // rest of the job, where tests and application code control stdout.
  let marker = 0;
  let command = false;
  const commits = [];
  for (const line of bytes.toString('utf8').split('\n')) {
    const match = /^(\S{20,40}) (.*)\r?$/.exec(line);
    if (!match) continue;
    const time = Date.parse(match[1]);
    const message = match[2].trimEnd();
    if (message.startsWith('##[group]Run ')) {
      if (marker === 1 && message !== '##[group]Run actions/checkout@v4') break;
      if (job.name === 'test' && marker === 0 && message === '##[group]Run test "$PLAN" = success') continue;
      requireEvidence(message === '##[group]Run actions/checkout@v4' &&
        time >= started && time < ended + 1000, 'CHECKOUT_LOG_STEP');
      marker++;
    }
    if (marker !== 1) continue;
    if (!(time >= started && time < ended + 1000)) continue;
    if (command && sha.test(message)) commits.push(message);
    command = message === '[command]/usr/bin/git log -1 --format=%H';
  }
  requireEvidence(marker === 1 && commits.length === 1 && commits[0] === candidate.merge_candidate_sha, 'CHECKOUT_CANDIDATE');
  return { step: checkout[0].number, sha: commits[0], log_digest: bytesDigest(bytes) };
}

async function jobObservation(provider, job, run, candidate) {
  requireEvidence(positive(job.id) && job.run_id === run.id && job.run_attempt === run.run_attempt &&
    job.head_sha === run.head_sha && safeJob(job.name), 'JOB_PROVENANCE');
  // Derive the fixed endpoint from the only accepted URL shape.
  const check = typeof job.check_run_url === 'string' &&
    job.check_run_url.match(/^https:\/\/api\.github\.com\/repos\/bensmullen\/personal-finance-app\/check-runs\/([1-9][0-9]*)$/);
  requireEvidence(check && positive(Number(check[1])), 'CHECK_ADDRESS');
  const record = await provider.json('/check-runs/' + check[1]);
  const details = 'https://github.com/' + repository + '/actions/runs/' + run.id + '/job/' + job.id;
  requireEvidence(record.id === Number(check[1]) && record.name === job.name &&
    record.app?.id === 15368 && record.app.slug === 'github-actions' &&
    record.check_suite?.id === run.check_suite_id && record.head_sha === run.head_sha &&
    [details, details + '?pr=' + candidate.pr].includes(record.details_url) &&
    record.status === job.status && record.conclusion === job.conclusion, 'CHECK_PROVENANCE');
  const steps = job.steps ?? [];
  requireEvidence(Array.isArray(steps) && steps.length <= 64 && unique(steps.map(({ number }) => number)) &&
    steps.every(({ number }) => positive(number)), 'JOB_STEPS');
  let status = outcome(job);
  const adverse = steps.filter((step) => !['PASS', 'SKIP'].includes(outcome(step)));
  if (status === 'PASS' && adverse.length) status = worst(adverse.map(outcome));
  const observation = {
    id: job.id, check_run_id: record.id, outcome: status, conclusion: job.conclusion ?? null,
    steps: adverse.map((step) => ({ number: step.number, outcome: outcome(step) })),
  };
  if (status !== 'SKIP') {
    try {
      observation.checkout = await checkoutObservation(provider, job, steps, candidate);
    } catch (error) {
      observation.checkout_issue = codeOf(error);
      if (status === 'PASS') observation.outcome = 'INCOMPLETE';
    }
  }
  return observation;
}

async function inspectRun(provider, original, workflow, planned, candidate, pull, now, budget, witnesses) {
  const root = '/actions/runs/' + original.id;
  validateRun(original, original, workflow, candidate, pull);
  const attempts = [];
  const issues = [];
  for (let number = 1; number <= original.run_attempt; number++) {
    try {
      const route = root + '/attempts/' + number;
      const attempt = await provider.json(route);
      validateRun(attempt, original, workflow, candidate, pull);
      requireEvidence(attempt.run_attempt === number, 'ATTEMPT_IDENTITY');
      const jobs = await provider.list(route + '/jobs', 'jobs');
      requireEvidence(unique(jobs.map(({ id }) => id)) && unique(jobs.map(({ name }) => name)), 'DUPLICATE_JOB');
      attempts.push({ attempt, jobs });
    } catch (error) {
      issues.push({ attempt: number, code: codeOf(error) });
      attempts.push({ attempt: { run_attempt: number }, jobs: [] });
    }
  }
  try {
    const latest = await provider.json(root);
    validateRun(latest, original, workflow, candidate, pull);
    requireEvidence(latest.run_attempt === original.run_attempt && latest.status === original.status &&
      latest.conclusion === original.conclusion, 'RUN_CHANGED');
  } catch (error) {
    issues.push({ code: codeOf(error) });
  }
  const results = [];
  let artifacts;
  for (const { attempt, jobs } of attempts) {
    const attemptOutcome = outcome(attempt);
    if (attemptOutcome !== 'PASS') issues.push({ attempt: attempt.run_attempt, code: 'ATTEMPT_' + attemptOutcome });
    const entries = [];
    for (const job of jobs) {
      const selected = planned.find(({ job: name }) => name === job.name);
      const matrix = skippedMatrixNames.get(job.name);
      const skippedMatrix = workflowEvents.get(workflow.path) === 'pull_request' && matrix && outcome(job) === 'SKIP' &&
        planned.filter((check) => check.job.startsWith(matrix + ' (shard ')).every(({ selection }) => selection === 'excluded');
      if (!selected && !skippedMatrix) issues.push({ attempt: attempt.run_attempt, code: 'UNPLANNED_JOB', job_id: job.id });
      let result;
      try {
        result = await jobObservation(provider, job, attempt, candidate);
      } catch (error) {
        result = { id: job.id, outcome: 'INCOMPLETE', code: codeOf(error) };
        issues.push({ attempt: attempt.run_attempt, code: 'UNAUTHENTICATED_JOB', job_id: job.id });
      }
      if (selected) {
        if (selected.selection === 'excluded' && result.outcome !== 'SKIP') {
          issues.push({ attempt: attempt.run_attempt, code: 'EXCLUDED_JOB_EXECUTED', check: selected.id });
        }
        if (selected.artifact_required && result.outcome !== 'SKIP') {
          // Legacy shard names are overwritten across attempts. They can
          // identify a single attempt only when there was no rerun.
          try {
            requireEvidence(job.name !== 'household-readiness' || result.checkout, 'MANUAL_CHECKOUT_UNVERIFIED');
            requireEvidence(selected.artifact.includes('{attempt}') || original.run_attempt === 1, 'ARTIFACT_ATTEMPT_UNKNOWN');
            artifacts ??= await provider.list(root + '/artifacts', 'artifacts');
            requireEvidence(unique(artifacts.map(({ id }) => id)), 'DUPLICATE_ARTIFACT_ID');
            const name = selected.artifact.replace('{run}', String(attempt.id)).replace('{attempt}', String(attempt.run_attempt));
            result.artifact = await artifactEvidence(provider, artifacts, name, attempt, pull.repoId, now, budget,
              selected, candidate, witnesses, workflow.ref);
            if (result.artifact.outcome) {
              const observed = result.artifact.outcome;
              result.outcome = result.checkout && result.conclusion === 'failure' && observed === 'TIMEOUT' ?
                'TIMEOUT' : worst([result.outcome, observed]);
            }
          } catch (error) {
            result.artifact_issue = codeOf(error);
            if (result.outcome === 'PASS') result.outcome = 'INCOMPLETE';
          }
        }
      }
      entries.push({ check: selected?.id ?? null, ...(matrix ? { matrix } : {}), ...result });
    }
    for (const check of planned) {
      if (check.selection === 'selected' && !entries.some((job) => job.check === check.id)) {
        issues.push({ attempt: attempt.run_attempt, code: 'MISSING_JOB', check: check.id });
      }
    }
    results.push({ number: attempt.run_attempt, outcome: attemptOutcome, jobs: entries });
  }
  for (const kind of ['unit', 'e2e']) {
    const assignments = results.flatMap(({ jobs }) => jobs.filter(({ check }) =>
      planned.find(({ id }) => check === id)?.job.startsWith(kind + ' (shard ')))
      .map(({ artifact }) => artifact?.assignment_digest).filter(Boolean);
    if (new Set(assignments).size > 1) issues.push({ code: 'SHARD_ASSIGNMENT_DRIFT', kind });
  }
  return { id: original.id, workflow_id: workflow.id, event: original.event, head_sha: original.head_sha,
    check_suite_id: original.check_suite_id, attempts: results, issues };
}

// The selection is an operator-owned input. Provider data alone never grants
// task, plan, workflow-pin or reviewer authority.
export async function collectGoalEvidence(input, provider, now = Date.now(), verify) {
  validateSelection(input);
  const { task, candidate, plan, workflows, inputs, implementer } = input;
  const runs = [];
  const issues = [];
  const witnesses = new Set();
  const budget = { remaining: limits.totalUnpackedBytes };
  let control = null;
  try {
    requireEvidence(Number.isFinite(now), 'OBSERVATION_TIME');
    const pull = await exactPull(provider, candidate);
    const authority = await currentIssues(provider, task, pull.branch);
    control = authority;
    const authenticate = (live) => attested(verify, 'live_selected_evidence_plan', {
      task, candidate, plan, workflows, inputs, implementer, ...live, now: new Date(now).toISOString(),
    });
    if (!authenticate(authority)) issues.push({ code: 'UNVERIFIED_LIVE_EVIDENCE_PLAN' });
    const integration = candidate.merge_candidate_sha;
    const commit = await provider.json('/commits/' + integration);
    requireEvidence(commit.sha === integration && commit.parents?.length === 2 &&
      commit.parents[0].sha === candidate.base_sha && commit.parents[1].sha === candidate.head_sha, 'INTEGRATION_PARENTS');
    for (const pin of inputs) {
      const bytes = await pinContents(provider, integration, pin);
      if (pin.path === registryPath) {
        const registry = readHouseholdRegistry(bytes);
        for (const entry of registry.applicable) for (const evidence of entry.evidence) {
          requireEvidence([evidence.path, ...evidence.fixtures, evidence.oracle].every((path) =>
            inputs.some((pin) => pin.path === path)), 'UNPINNED_HOUSEHOLD_CASE_INPUT');
          for (const title of evidence.cases) witnesses.add(caseKey(evidence.path, title));
        }
      }
    }
    for (const workflow of workflows) {
      try {
        await pinContents(provider, integration, workflow);
        const identity = await provider.json('/actions/workflows/' + workflow.id);
        requireEvidence(identity.id === workflow.id && identity.path === workflow.path, 'WORKFLOW_IDENTITY');
        const planned = plan.filter(({ workflow: id }) => id === workflow.id);
        const originals = await runInventory(provider, workflow, candidate);
        for (const original of originals) {
          try {
            const result = await inspectRun(provider, original, workflow, planned, candidate, pull, now, budget, witnesses);
            if (result) runs.push(result);
          } catch (error) {
            issues.push({ workflow: workflow.id, run: original.id, code: codeOf(error) });
          }
        }
        const after = await runInventory(provider, workflow, candidate);
        const inventory = (items) => items.map((run) => [run.id, run.run_attempt, run.status, run.conclusion]);
        requireEvidence(JSON.stringify(inventory(originals)) === JSON.stringify(inventory(after)), 'RUN_INVENTORY_CHANGED');
      } catch (error) {
        issues.push({ workflow: workflow.id, code: codeOf(error) });
      }
    }
    requireEvidence(digest(await exactPull(provider, candidate)) === digest(pull), 'STALE_CANDIDATE');
    const rechecked = await currentIssues(provider, task, pull.branch);
    control = rechecked;
    if (!authenticate(rechecked) && !issues.some(({ code }) => code === 'UNVERIFIED_LIVE_EVIDENCE_PLAN')) {
      issues.push({ code: 'UNVERIFIED_LIVE_EVIDENCE_PLAN' });
    }
  } catch (error) {
    issues.push({ code: codeOf(error) });
  }
  const checks = plan.map((check) => {
    const observations = runs.filter((run) => run.workflow_id === check.workflow).flatMap((run) =>
      run.attempts.flatMap((attempt) => attempt.jobs.filter((job) => job.check === check.id)
        .map((job) => ({ run_id: String(run.id), attempt: attempt.number, outcome: job.outcome, artifact: job.artifact }))));
    let status = worst(observations.map(({ outcome }) => outcome));
    if (check.selection === 'excluded' && (observations.length === 0 || status === 'SKIP')) status = 'NOT_APPLICABLE';
    const lastRun = runs.filter((run) => run.workflow_id === check.workflow).at(-1);
    const latest = observations.at(-1) ?? (status === 'NOT_APPLICABLE' && lastRun ?
      { run_id: String(lastRun.id), attempt: lastRun.attempts.at(-1).number } : null);
    return {
      id: check.id, required: check.required, outcome: status,
      run_id: latest?.run_id ?? null, attempt: latest?.attempt ?? null,
      artifacts: latest?.artifact ? [{ id: latest.artifact.id, digest: latest.artifact.digest }] : [],
    };
  });
  const workflowComplete = (event) => {
    const workflow = workflows.find(({ path }) => workflowEvents.get(path) === event);
    return Boolean(workflow && !issues.some(({ workflow: id }) => id === undefined || id === workflow.id) &&
      runs.some(({ workflow_id }) => workflow_id === workflow.id) &&
      runs.filter(({ workflow_id }) => workflow_id === workflow.id).every((run) => run.issues.length === 0) &&
      checks.filter((_, index) => plan[index].workflow === workflow.id)
        .every((check) => check.required ? check.outcome === 'PASS' : check.outcome === 'NOT_APPLICABLE'));
  };
  const browserInventories = runs.flatMap(({ attempts }) => attempts.flatMap(({ jobs }) =>
    jobs.filter(({ outcome, artifact }) => outcome === 'PASS' && artifact?.ordinary_inventory)
      .map(({ artifact }) => digest(artifact.ordinary_inventory))));
  if (new Set(browserInventories).size > 1) issues.push({ code: 'BROWSER_DISCOVERY_ASSIGNMENT_MISMATCH' });
  const manualWorkflow = workflows.find(({ path }) => workflowEvents.get(path) === 'workflow_dispatch');
  // Ordinary completion also requires every selected job in each attempt and coherent shard assignments.
  if (manualWorkflow && !ordinaryBrowserJobs.every((job) => plan.some((check, index) =>
    check.job === job && check.selection === 'selected' && checks[index].outcome === 'PASS'))) {
    issues.push({ workflow: manualWorkflow.id, code: 'ORDINARY_BROWSER_ASSIGNMENT_MISSING' });
  }
  const ordinary_complete = workflowComplete('pull_request');
  const complete = ordinary_complete && (!manualWorkflow || workflowComplete('workflow_dispatch'));
  return {
    task, candidate, implementer, observed_at: Number.isFinite(now) ? new Date(now).toISOString() : null,
    selection_digest: digest({ task, candidate, workflows, inputs, implementer }),
    control, inputs, workflows, plan, checks, runs, issues, ordinary_complete, complete,
    resources: { ...provider.measurements?.(), unpacked_bytes: limits.totalUnpackedBytes - budget.remaining },
  };
}

export function verificationDraft(collection) {
  if (!collection.complete || collection.checks.some(({ run_id, attempt }) => !run_id || !attempt)) return null;
  const { task, candidate, checks, observed_at, selection_digest } = collection;
  const artifacts = [...new Map(checks.flatMap(({ artifacts: refs }) => refs).map((ref) => [ref.id, ref])).values()];
  return validateRecord({
    schema: 'VERIFICATION_EVIDENCE_V1', repository, id: 'verification-' + digest({ selection_digest, checks, observed_at }),
    revision: 1, created_at: observed_at,
    producer: { role: 'observer', actor: 'gf04-collector', session: 'collection-' + selection_digest.slice(0, 20) },
    references: artifacts, goal_issue: task.goal_issue, goal_revision: task.goal_revision,
    goal_control_digest: task.goal_control_digest, task_issue: task.task_issue, task_revision: task.task_revision,
    candidate, checks, capability_versions: ['registry-sha256:' + collection.inputs.find(({ path }) => path === registryPath).digest],
    fixture_versions: collection.inputs.filter(({ path }) => path.startsWith('test/')).map(({ digest: pin }) => 'sha256:' + pin),
    disposition: 'pending', reviewer_evidence: null,
  }, 'VERIFICATION_EVIDENCE_V1');
}

const householdCases = [
  'flagship', 'low-input', 'zero-investments', 'zero-income',
  'future-start-income', 'missing-income', 'source-qualified-s8-5a',
];
const registryPath = 'docs/development/goal-framework/households.json';

function readHouseholdRegistry(bytes) {
  const registry = parseEvidenceJson(bytes);
  const gapsValid = (gaps) => Array.isArray(gaps) && gaps.length <= 12 && gaps.every((gap) => identifier.test(gap));
  requireEvidence(registry.schema === 'GF04_HOUSEHOLDS_V1' && registry.revision === 2 && Array.isArray(registry.applicable) &&
    registry.applicable.length === householdCases.length && householdCases.every((key) =>
      registry.applicable.some(({ id }) => id === key)) &&
    registry.applicable.every(({ gaps, unsupported, owner, evidence }) =>
      gapsValid(gaps) && gapsValid(unsupported) && positive(owner) && Array.isArray(evidence) &&
      evidence.length > 0 && evidence.length <= 12 && evidence.every(({ path, fixtures, oracle, kind, cases }) =>
        safePath(path) && safePath(oracle) && Array.isArray(fixtures) && fixtures.length > 0 && fixtures.length <= 12 &&
        unique(fixtures) && fixtures.every(safePath) && ['reconciliation', 'refusal'].includes(kind) &&
        Array.isArray(cases) && cases.length > 0 && cases.length <= 16 && unique(cases) &&
        cases.every((title) => typeof title === 'string' && title.length > 0 && title.length <= 512))) &&
    registry.future_gate?.owner === 108 && registry.future_gate.independently_saved_plans_per_household === 4 &&
    JSON.stringify(registry.future_gate.households) === JSON.stringify(Array.from({ length: 8 }, (_, i) => 'H0' + (i + 1))),
  'HOUSEHOLD_REGISTRY');
  return registry;
}

// The collector only describes provider observations. A trusted coordinator
// authenticates independent reviews at this boundary, using its own authority.
export function householdReadiness({ collection, registryBytes, reviews = {}, verify, now = Date.now() }) {
  const registry = readHouseholdRegistry(registryBytes);
  const registry_digest = bytesDigest(registryBytes);
  const pinned = collection.inputs.some(({ path, digest: pin }) => path === registryPath && pin === registry_digest);
  const blockers = [];
  const evidence = [...new Map(collection.checks.flatMap(({ artifacts }) => artifacts).map((ref) => [ref.id, ref])).values()];
  const household = collection.checks.find(({ id }) => id === 'household-readiness');
  const manualArtifact = household?.outcome === 'PASS' ? household.artifacts[0] ?? null : null;
  const jobArtifacts = collection.runs.flatMap(({ attempts }) => attempts.flatMap(({ jobs }) =>
    jobs.filter(({ outcome: status, artifact }) => status === 'PASS' && artifact).map(({ artifact }) => artifact)));
  const caseIds = new Set(jobArtifacts.flatMap((artifact) => artifact.witness_cases ?? []).map(({ key }) => key));
  const captures = jobArtifacts.find((artifact) => artifact.id === manualArtifact?.id)?.files ?? [];
  if (!pinned || !collection.complete) blockers.push('EXACT_CANDIDATE_EVIDENCE_MISSING');
  if (!collection.ordinary_complete) blockers.push('REQUIRED_ORDINARY_EVIDENCE_MISSING');
  if (!manualArtifact) blockers.push('MANUAL_BROWSER_ARTIFACT_MISSING');
  const observed = Date.parse(collection.observed_at);
  const expires = Math.min(...jobArtifacts.map((artifact) => Date.parse(artifact.expires_at)));
  const fresh = Number.isFinite(now) && observed <= now && now < expires;
  if (!fresh) blockers.push('COLLECTION_STALE_OR_EXPIRED');
  const case_inventory_digest = digest({
    registry_digest, inputs: collection.inputs, households: registry.applicable.map(({ id, evidence }) =>
      ({ id, cases: evidence.flatMap(({ path, cases }) => cases.map((title) => caseKey(path, title))) })),
  });
  const applicable = registry.applicable.map(({ id, owner, gaps, unsupported, evidence: expected }) =>
    ({ id, owner, gaps, unsupported, missing_evidence: expected.flatMap(({ path, cases }) =>
      cases.filter((title) => !caseIds.has(caseKey(path, title))).map((title) => ({ path, title }))) }));
  for (const { id, gaps, unsupported } of applicable) {
    blockers.push(...[...gaps, ...unsupported].map((gap) => id + ':' + gap));
  }
  if (applicable.some(({ missing_evidence }) => missing_evidence.length)) blockers.push('APPLICABLE_TEST_EVIDENCE_MISSING');
  const { runs, ...summary } = collection;
  const collection_digest = digest({
    ...summary, runs: runs.map(({ attempts, issues, ...run }) => digest({
      ...run, issues_digest: bytesDigest(JSON.stringify(issues)),
      attempts: attempts.map(({ jobs, ...attempt }) => digest({ ...attempt, jobs: jobs.map(digest) })),
    })),
  });
  const binding = {
    task: collection.task, candidate: collection.candidate, selection_digest: collection.selection_digest,
    collection_digest, case_inventory_digest, registry_digest, applicable, evidence, browser_artifact: manualArtifact, captures,
  };
  const accepted = {};
  for (const kind of ['semantic', 'visual']) {
    const review = reviews[kind];
    const independent = typeof review?.actor === 'string' && typeof review?.session === 'string' &&
      identifier.test(review.actor) && identifier.test(review.session) &&
      review.actor !== collection.implementer.actor && review.session !== collection.implementer.session;
    const coversInventory = Array.isArray(review?.households) && review.households.length === householdCases.length &&
      householdCases.every((id) => review.households.includes(id));
    const created = Date.parse(review?.created_at), reviewExpires = Date.parse(review?.expires_at);
    const authentic = pinned && collection.complete && manualArtifact && fresh && independent && coversInventory &&
      observed <= created && created <= now && now < reviewExpires && reviewExpires <= expires &&
      review.collection_digest === collection_digest && review.case_inventory_digest === case_inventory_digest &&
      ['approved', 'changes_required'].includes(review.disposition) &&
      attested(verify, 'independent_' + kind + '_review', { binding, review, now: new Date(now).toISOString() });
    accepted[kind] = authentic ? review.disposition : 'pending';
    if (accepted[kind] !== 'approved') blockers.push('INDEPENDENT_' + kind.toUpperCase() + '_REVIEW_MISSING_OR_BLOCKING');
  }
  return {
    schema: 'UAT_READINESS_V1', repository, id: 'household-' + digest({
      binding, accepted, observed_at: collection.observed_at,
    }), revision: 1, created_at: collection.observed_at,
    producer: { role: 'observer', actor: 'gf04-collector', session: 'collection-' + collection.selection_digest.slice(0, 20) },
    references: evidence, ...binding, review: accepted, blockers,
    disposition: blockers.length ? 'NOT_READY' : 'UAT_READY',
    remaining_pm_questions: blockers.length ? [] : registry.subjective_questions,
  };
}

async function readInput(path) {
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    requireEvidence(stat.isFile() && stat.size <= 128 * 1024, 'INPUT_SIZE');
    const buffer = Buffer.alloc(128 * 1024 + 1);
    let length = 0;
    for (;;) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
      requireEvidence(length < buffer.length, 'INPUT_SIZE');
    }
    return buffer.subarray(0, length);
  } finally {
    await file.close();
  }
}

const manualFile = 'e2e/framework-household-readiness.spec.ts:';
const uxFile = 'e2e/ux-evidence.spec.ts:';
export function browserInventory(ordinary, manual, ux) {
  const ids = (entries) => {
    requireEvidence(Array.isArray(entries) && entries.length > 0 &&
      entries.every(({ id }) => typeof id === 'string'), 'EMPTY_BROWSER_INVENTORY');
    const result = entries.map(({ id }) => id);
    requireEvidence(unique(result), 'DUPLICATE_BROWSER_INVENTORY');
    return result.sort();
  };
  const normal = ids(ordinary), profile = ids(manual), optIn = ids(ux);
  requireEvidence(validOrdinaryBrowserCount(normal.length), 'BROWSER_INVENTORY_LIMIT');
  requireEvidence(profile.length === 4, 'MANUAL_DISCOVERY_COUNT');
  requireEvidence(normal.every((id) => !id.includes(manualFile) && !id.includes(uxFile)) &&
    profile.every((id) => id.startsWith(manualFile)) &&
    optIn.every((id) => !id.includes(manualFile)) &&
    optIn.some((id) => id.startsWith(uxFile)) &&
    JSON.stringify(optIn.filter((id) => !id.startsWith(uxFile))) === JSON.stringify(normal), 'BROWSER_INVENTORY_ROUTING');
  return { ordinary_count: normal.length, ordinary_digest: inventoryDigest(normal),
    ux_count: optIn.length, ux_digest: inventoryDigest(optIn), manual: profile };
}

// Use injected observations for deterministic checks of ordering and refusal.
export async function watchHousehold({ launchServer, launchBrowser, probe, hasDisk, elapsed, interrupted, wait }) {
  let server;
  let browser;
  for (;;) {
    const stop = interrupted() ? 'interrupted' : elapsed() >= householdLimits.deadlineMs ? 'deadline' :
      !hasDisk() ? 'disk-budget' : null;
    if (stop) return stop;
    server ??= launchServer();
    if (server.result) return browser ? 'server-exit' : 'server-startup-exit';
    if (browser?.result) return 'browser-exit';
    if (!browser) {
      if (elapsed() >= householdLimits.readinessMs) return 'readiness-timeout';
      if (await probe()) {
        if (server.result) return 'server-startup-exit';
        if (interrupted() || elapsed() >= householdLimits.readinessMs || !hasDisk()) continue;
        browser = launchBrowser();
      }
    }
    await wait();
  }
}

function launchHouseholdChild(args, env, serverLog) {
  const child = spawn(process.execPath, args, { env, detached: true,
    stdio: serverLog ? ['ignore', 'pipe', 'pipe'] : 'ignore' });
  const state = { pid: child.pid, result: null };
  child.once('error', (error) => {
    state.result = { exit: null, signal: null, spawn_error: error.code ?? 'UNKNOWN' };
  });
  child.once('exit', (exit, signal) => { state.result = { exit, signal, spawn_error: null }; });
  if (serverLog) {
    for (const source of ['stdout', 'stderr']) {
      child[source].on('data', (chunk) => {
        const log = serverLog[source];
        const remaining = householdLimits.logBytes - log.bytes.length;
        if (chunk.length > remaining) log.truncated = true;
        if (remaining > 0) log.bytes = Buffer.concat([log.bytes, chunk.subarray(0, remaining)]);
      });
    }
  }
  return state;
}

async function stopHouseholdChildren(children) {
  const groups = children.flatMap((child) => child?.pid ? [-child.pid] : []);
  const signal = (pid, name) => {
    try { process.kill(pid, name); return true; }
    catch (error) { if (error.code !== 'ESRCH') throw error; return false; }
  };
  for (const pid of groups) signal(pid, 'SIGTERM');
  const end = performance.now() + 3000;
  while (groups.some((pid) => signal(pid, 0)) && performance.now() < end) await pause(50);
  for (const pid of groups) signal(pid, 'SIGKILL');
  const reaped = performance.now() + 1000;
  while (children.some((child) => child && !child.result) && performance.now() < reaped) await pause(50);
  return children.every((child) => !child || Boolean(child.result));
}

// Retain only recognized operational messages. Never write raw Next output.
function householdLog(logs) {
  return Object.entries(logs).map(([source, { bytes, truncated }]) => {
    const output = bytes.toString('utf8');
    const markers = [
      [/Ready in /, 'next-ready'], [/Starting\.\.\./, 'next-starting'], [/Compiling /, 'next-compiling'],
      [/GET \/ 200/, 'home-http-200'], [/GET \/ 500/, 'home-http-500'],
      [/heap out of memory/i, 'node-heap-exhaustion'], [/fatal error/i, 'fatal-error'],
      [/SIG(?:KILL|TERM|ABRT|XFSZ)/, 'signal-reported'],
      [/Error|error/, 'error-reported'],
    ].filter(([pattern]) => pattern.test(output)).map(([, label]) => label);
    const codes = [...new Set(output.match(/\b(?:EADDRINUSE|EACCES|EAGAIN|ENOSPC|EMFILE|ENOMEM|ERR_WORKER_OUT_OF_MEMORY|MODULE_NOT_FOUND)\b/g))];
    return { source, captured_bytes: bytes.length, truncated, markers, codes };
  });
}

async function stageHouseholdCaptures(scratch, output) {
  // Reserve 64 KiB for the inventory, receipt, redacted log and resource records.
  let budget = householdLimits.artifactBytes - 64 * 1024;
  const captures = {};
  for (const name of householdCaptures) {
    let file;
    try {
      file = await open(join(scratch, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = await file.stat();
      requireEvidence(stat.isFile() && stat.size > 0, 'invalid');
      const cap = Math.min(budget, name === 'progress.jsonl' ? householdLimits.logBytes : limits.fileBytes);
      requireEvidence(stat.size <= cap, 'truncated');
      const bytes = Buffer.alloc(stat.size + 1);
      let length = 0;
      while (length < bytes.length) {
        const { bytesRead } = await file.read(bytes, length, bytes.length - length, null);
        if (!bytesRead) break;
        length += bytesRead;
      }
      requireEvidence(length === stat.size, 'truncated');
      const capture = bytes.subarray(0, length);
      if (name === 'report.json') parseEvidenceJson(capture);
      await writeFile(join(output, name), capture, { flag: 'wx' });
      budget -= capture.length;
      captures[name] = 'retained';
    } catch (error) {
      captures[name] = error.code === 'ENOENT' ? 'missing' : codeOf(error) === 'truncated' ? 'truncated' : 'invalid';
    } finally {
      await file?.close();
    }
  }
  return captures;
}

async function runHousehold(output) {
  const start = performance.now();
  const elapsed = () => Math.floor(performance.now() - start);
  const identity = { sha: process.env.GITHUB_SHA, attempt: process.env.GITHUB_RUN_ATTEMPT,
    run_id: process.env.GITHUB_RUN_ID, ref: process.env.GITHUB_REF };
  const receipt = async (details) => {
    const pending = join(output, 'execution.pending');
    await writeFile(pending, JSON.stringify({ schema: 1, ...identity, elapsed_ms: elapsed(), ...details }));
    await rename(pending, join(output, 'execution.json'));
  };
  const logs = { stdout: { bytes: Buffer.alloc(0), truncated: false }, stderr: { bytes: Buffer.alloc(0), truncated: false } };
  let server;
  let browser;
  let interrupted = false;
  const interrupt = () => { interrupted = true; };
  process.on('SIGTERM', interrupt);
  process.on('SIGINT', interrupt);
  let scratch;
  let reason = 'supervisor-error';
  try {
    await receipt({ reason: 'running', ready: false });
    await writeFile(join(output, 'resources.json'), JSON.stringify({
      node: process.version, workers: 1, max_node_heap_mib: 2048,
      process_limit: Number(process.env.PFM_HOUSEHOLD_PROCESS_LIMIT), deadline_seconds: householdLimits.deadlineMs / 1000,
      readiness_seconds: householdLimits.readinessMs / 1000, disk_growth_bytes: householdLimits.diskBytes,
      disk_free_floor_bytes: householdLimits.diskBytes,
    }));
    scratch = await mkdtemp(join(tmpdir(), 'pfm-household-'));
    const free = (path) => {
      const { bavail, bsize } = statfsSync(path);
      return bavail * bsize;
    };
    const volumes = [process.cwd(), scratch].map((path) => ({ path, initial: free(path) }));
    const hasDisk = () => volumes.every(({ path, initial }) =>
      free(path) >= Math.max(householdLimits.diskBytes, initial - householdLimits.diskBytes));
    const env = { ...process.env, TMPDIR: scratch };
    reason = await watchHousehold({
      elapsed, hasDisk, interrupted: () => interrupted, wait: () => pause(250),
      launchServer: () => (server = launchHouseholdChild([
        'node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3100',
      ], env, logs)),
      probe: async () => {
        try {
          const response = await fetch('http://127.0.0.1:3100/', { redirect: 'manual', signal: AbortSignal.timeout(1000) });
          await response.body?.cancel();
          return response.ok;
        } catch { return false; }
      },
      launchBrowser: () => (browser = launchHouseholdChild([
        'node_modules/@playwright/test/cli.js', 'test', '--workers=1', '--retries=0', '--trace=off',
        '--reporter=json,./tools/ci/collect-test-durations.mjs', '--output=' + join(scratch, 'test-results'),
      ], { ...env, PFM_HOUSEHOLD_SUPERVISED: '1', PFM_HOUSEHOLD_OUTPUT: scratch,
        PLAYWRIGHT_JSON_OUTPUT_FILE: join(scratch, 'report.json'), PFM_PROGRESS: join(scratch, 'progress.jsonl') })),
    });
  } finally {
    try {
      const observed = { server: server?.result ?? null, browser: browser?.result ?? null };
      const stopped = await stopHouseholdChildren([browser, server]);
      const log = householdLog(logs);
      await writeFile(join(output, 'server.log'), JSON.stringify(log));
      const captures = scratch ? await stageHouseholdCaptures(scratch, output) :
        Object.fromEntries(householdCaptures.map((name) => [name, 'missing']));
      await receipt({ reason, ready: Boolean(browser), ...observed, cleanup: stopped ? 'stopped' : 'incomplete',
        terminated: { server: server?.result ?? null, browser: browser?.result ?? null },
        log_truncated: log.some(({ truncated }) => truncated), captures });
      if (reason !== 'browser-exit' || observed.browser?.exit !== 0 || !stopped ||
          log.some(({ truncated }) => truncated) || Object.values(captures).some((value) => value !== 'retained')) {
        process.exitCode = reason === 'deadline' || reason === 'readiness-timeout' ? 124 : 1;
      }
    } finally {
      process.off('SIGTERM', interrupt);
      process.off('SIGINT', interrupt);
    }
  }
}

async function main(args) {
  if (args[0] === 'household-run' && args.length === 2) {
    await runHousehold(args[1]);
    return;
  }
  if (args[0] === 'browser-inventory' && args.length === 5) {
    const [, normal, manual, ux, output] = args;
    const values = await Promise.all([normal, manual, ux].map(async (file) => parseEvidenceJson(await readInput(file))));
    await writeFile(output, JSON.stringify({
      sha: process.env.GITHUB_SHA, attempt: process.env.GITHUB_RUN_ATTEMPT, run_id: process.env.GITHUB_RUN_ID,
      ref: process.env.GITHUB_REF, ...browserInventory(...values),
    }));
    return;
  }
  requireEvidence(args[0] === 'collect' && args.length === 3, 'USAGE: collect TRUSTED_SELECTION.json HOUSEHOLDS.json');
  const input = parseEvidenceJson(await readInput(args[1]));
  const provider = githubEvidenceProvider(process.env.GH_TOKEN);
  const collection = await collectGoalEvidence(input, provider);
  const readiness = householdReadiness({ collection, registryBytes: await readInput(args[2]) });
  process.stdout.write(JSON.stringify({ collection, verification: verificationDraft(collection), readiness }, null, 2) + '\n');
  if (!collection.complete || readiness.disposition !== 'UAT_READY') process.exitCode = 2;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(codeOf(error) + '\n');
    process.exitCode = 2;
  });
}
