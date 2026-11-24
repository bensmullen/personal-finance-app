import { createHash } from 'node:crypto';
import { open, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { crc32, inflateRawSync } from 'node:zlib';
import { digest, validateRecord } from '../codex/goal-framework/contracts.mjs';
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
const otherManualTitles = new Set(['performance', 'forecast-scaling', 'stochastic', 'onboarding', 'provider']
  .map((profile) => 'engineering-validation / ' + profile));
const limits = Object.freeze({
  requests: 240, deadlineMs: 90_000, apiBytes: 16 * 1024 ** 2,
  archiveBytes: 16 * 1024 ** 2, totalArchiveBytes: 64 * 1024 ** 2,
  unpackedBytes: 32 * 1024 ** 2, totalUnpackedBytes: 128 * 1024 ** 2,
  files: 128, fileBytes: 8 * 1024 ** 2, retentionMs: 30 * 86_400_000,
});
const bytesDigest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const codeOf = (error) => error instanceof EvidenceError ? error.message : 'PROVIDER_UNAVAILABLE';
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
export function inspectEvidenceZip(zip, maxUnpacked = limits.unpackedBytes, observeJson = () => {}) {
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
    return { name, size, digest: bytesDigest(decoded) };
  });
  return { files, unpacked };
}

async function readBounded(response, maxBytes) {
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
  let requests = 0, apiBytes = 0, archiveBytes = 0;
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
    const bytes = await readBounded(response, Math.min(2 * 1024 ** 2, limits.apiBytes - apiBytes));
    apiBytes += bytes.length;
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
  return {
    json, list,
    async download(id) {
      requireEvidence(positive(id), 'ARTIFACT_ID');
      const response = await request(endpoint('/actions/artifacts/' + id + '/zip'), true);
      await response.body?.cancel();
      requireEvidence(response.status === 302, 'ARTIFACT_REDIRECT');
      const blob = await request(storageUrl(response.headers.get('location')), false);
      if (!blob.ok) {
        await blob.body?.cancel();
        throw new EvidenceError('ARTIFACT_DOWNLOAD');
      }
      const bytes = await readBounded(blob, Math.min(limits.archiveBytes, limits.totalArchiveBytes - archiveBytes));
      archiveBytes += bytes.length;
      return bytes;
    },
    measurements: () => ({ requests, api_bytes: apiBytes, archive_bytes: archiveBytes }),
  };
}

const unique = (values) => new Set(values).size === values.length;
const knownFields = (value, fields) => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && Object.keys(value).every((key) => fields.includes(key));
const safeJob = (name) => typeof name === 'string' && /^[A-Za-z0-9 ()_./-]{1,96}$/.test(name);
const revisions = ['goal_issue', 'goal_revision', 'task_issue', 'task_revision'];
const identityPaths = [
  'package-lock.json', 'playwright.config.ts', 'tools/ci/verification-plan.mjs',
  'tools/ci/plan-test-shards.mjs', 'tools/ci/collect-test-durations.mjs',
  'tools/codex/quiet-playwright.mjs', 'tools/codex/quiet-vitest.mjs',
  'docs/development/goal-framework/households.json', 'e2e/framework-household-readiness.spec.ts',
  'test/fixtures/goalFramework/households/guided.json', 'test/d2/integrated/jointHousehold/s8Five/oracle.ts',
];
const shardJob = /^(unit|e2e) \(shard (\d)\/(3|4)\)$/;
const ordinaryJobs = ['verification-plan', 'spec', 'architecture', 'codex-tooling', 'typecheck', 'build',
  'forecast-feasibility', 'test', 'deploy', ...[1, 2, 3].map((i) => 'unit (shard ' + i + '/3)'),
  ...[1, 2, 3, 4].map((i) => 'e2e (shard ' + i + '/4)')];

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
    workflows.every((workflow) => knownFields(workflow, ['id', 'path', 'digest']) &&
      positive(workflow.id) && workflowEvents.has(workflow.path) && hash.test(workflow.digest)), 'WORKFLOW_PIN');
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
      const shard = check.job.match(shardJob);
      if (shard && check.selection === 'selected') {
        requireEvidence(check.required && check.artifact_required &&
          check.artifact === shard[1] + '-diagnostics-' + shard[2] + '-' + candidate.merge_candidate_sha,
        'SHARD_ARTIFACT_PLAN');
      }
      if (check.job === 'household-readiness') {
        requireEvidence(check.artifact_required && check.artifact === 'household-readiness-{run}-{attempt}' &&
          ['inventory.json', 'report.json', 'resources.json', 'resources.txt', 'guided-desktop.png',
            'guided-mobile-200.png', 'guided-trace.zip'].every((file) => check.files?.includes(file)),
        'HOUSEHOLD_ARTIFACT_PLAN');
      }
    }
  }
  requireEvidence(Array.isArray(inputs) && inputs.length >= identityPaths.length && inputs.length <= 24 &&
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
  return pr.base.repo.id;
}

async function currentIssues(provider, task) {
  const goal = await provider.json('/issues/' + task.goal_issue);
  const issue = await provider.json('/issues/' + task.task_issue);
  requireEvidence(goal.number === task.goal_issue && goal.state === 'open' && !goal.pull_request &&
    issue.number === task.task_issue && issue.state === 'open' && !issue.pull_request &&
    typeof issue.body === 'string' && bytesDigest(issue.body) === task.issue_body_digest, 'STALE_TASK_AUTHORITY');
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
  const heads = event === 'pull_request' ? [candidate.head_sha, candidate.merge_candidate_sha] : [candidate.merge_candidate_sha];
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

function validateRun(run, original, workflow, repoId) {
  requireEvidence(run.id === original.id && positive(run.run_attempt) && run.run_attempt <= 8 &&
    run.workflow_id === workflow.id && run.path === workflow.path &&
    run.event === workflowEvents.get(workflow.path) && run.head_sha === original.head_sha &&
    (run.event !== 'workflow_dispatch' || run.display_title === householdRunTitle) &&
    run.repository?.id === repoId && run.head_repository?.id === repoId &&
    positive(run.check_suite_id), 'RUN_PROVENANCE');
}

function inspectTestEvidence(check, json, candidate, run, evidencePaths) {
  const shard = check.job.match(shardJob);
  const manual = check.job === 'household-readiness';
  if (!shard && !manual) return {};
  const report = json.get('report.json');
  const execution = json.get('execution.json');
  let selected;
  let assignment_digest;
  if (shard) {
    const [, kind, index, count] = shard;
    const proof = json.get('assignment.json');
    requireEvidence(proof?.schema === 1 && proof.sha === candidate.merge_candidate_sha &&
      proof.kind === kind && proof.count === Number(count) && proof.shards?.length === Number(count) &&
      execution?.sha === candidate.merge_candidate_sha && execution.kind === kind &&
      String(execution.runAttempt) === String(run.run_attempt), 'SHARD_IDENTITY');
    try { validatePartition(proof.inventory, proof.shards); } catch { throw new EvidenceError('SHARD_INVENTORY'); }
    selected = proof.shards[Number(index) - 1];
    requireEvidence(selected.length > 0, 'EMPTY_SHARD');
    assignment_digest = bytesDigest(JSON.stringify({ inventory: proof.inventory, shards: proof.shards }));
  }
  const failures = [];
  const retain = (id, attempt, status) => {
    requireEvidence(failures.length < 128, 'TEST_FAILURE_LIMIT');
    failures.push({ test_digest: bytesDigest(id), attempt, outcome: status });
  };
  let valid;
  let witnessPaths;
  if (shard?.[1] === 'unit') {
    const hostedRoot = '/home/runner/work/personal-finance-app/personal-finance-app/';
    const files = report?.testResults ?? [];
    for (const file of files) {
      requireEvidence(typeof file.name === 'string' && file.name.startsWith(hostedRoot) &&
        safePath(file.name.slice(hostedRoot.length)), 'UNIT_REPORT_PATH');
      file.name = root + '/' + file.name.slice(hostedRoot.length);
    }
    valid = validateVitest(report, selected);
    witnessPaths = files.map((file) => file.name.slice(root.length + 1));
    for (const file of report?.testResults ?? []) {
      for (const test of file.assertionResults ?? []) {
        if (test.status !== 'passed') retain(String(test.fullName), 0,
          ['pending', 'todo', 'skipped'].includes(test.status) ? 'SKIP' : 'FAIL');
      }
    }
  } else {
    const suites = [...(report?.suites ?? [])];
    while (suites.length) {
      const suite = suites.pop();
      requireEvidence((suite.specs ?? []).every(({ file }) => safePath(file)), 'BROWSER_REPORT_PATH');
      suites.push(...(suite.suites ?? []));
    }
    if (report?.config) report.config.rootDir = root + '/e2e';
    valid = validatePlaywright(report, selected);
    const tests = playwrightResults(report);
    witnessPaths = tests.map(({ id }) => id.replace(/^\[[^\]]+\] › /, '').split(':')[0]);
    for (const { id, test } of tests) {
      if (test.expectedStatus !== 'passed' || !test.results?.length) retain(id, 0, 'SKIP');
      for (const result of test.results ?? []) {
        if (result.status !== 'passed') retain(id, result.retry,
          ({ failed: 'FAIL', timedOut: 'TIMEOUT', skipped: 'SKIP' })[result.status] ?? 'INCOMPLETE');
      }
    }
    if (manual) {
      const inventory = json.get('inventory.json');
      requireEvidence(inventory?.sha === candidate.merge_candidate_sha &&
        String(inventory.attempt) === String(run.run_attempt) && Array.isArray(inventory.manual), 'MANUAL_INVENTORY');
      requireEvidence(inventory.manual.length > 0 && unique(inventory.manual) &&
        tests.length === inventory.manual.length && tests.every(({ id }) => inventory.manual.includes(id)) &&
        inventory.manual.every((id) => id.startsWith('e2e/framework-household-readiness.spec.ts:')), 'MANUAL_TEST_COVERAGE');
    }
  }
  const result = worst(failures.map(({ outcome: status }) => status));
  const hasFailures = failures.length > 0;
  const passed = valid && (!shard || (execution.status === 'passed' && execution.reportValid === true &&
    execution.exit === 0 && execution.signal === null && execution.context === null));
  return {
    ...(assignment_digest ? { assignment_digest } : {}), failures,
    witness_paths: passed && !hasFailures ? [...new Set(witnessPaths.filter((path) => evidencePaths.has(path)))].sort() : [],
    outcome: hasFailures ? result : passed ? 'PASS' : execution?.context === 'deadline-exceeded' ? 'TIMEOUT' : 'INCOMPLETE',
  };
}

async function artifactEvidence(provider, artifacts, name, run, repoId, now, budget, check, candidate, evidencePaths) {
  const matching = artifacts.filter((artifact) => artifact.name === name);
  requireEvidence(matching.length === 1, 'ARTIFACT_MISSING_OR_DUPLICATE');
  const artifact = matching[0];
  const expires = Date.parse(artifact.expires_at), created = Date.parse(artifact.created_at);
  requireEvidence(artifact.expired === false && created <= now && expires > now && expires > created &&
    expires - created <= limits.retentionMs + 1000 && positive(artifact.id) &&
    positive(artifact.size_in_bytes) && artifact.size_in_bytes <= limits.archiveBytes &&
    typeof artifact.digest === 'string' && /^sha256:[a-f0-9]{64}$/.test(artifact.digest) &&
    artifact.workflow_run?.id === run.id && artifact.workflow_run.repository_id === repoId &&
    artifact.workflow_run.head_repository_id === repoId && artifact.workflow_run.head_sha === run.head_sha, 'ARTIFACT_PROVENANCE');
  const zip = await provider.download(artifact.id);
  const checksum = bytesDigest(zip);
  requireEvidence(zip.length === artifact.size_in_bytes && artifact.digest === 'sha256:' + checksum, 'ARTIFACT_DIGEST');
  const wanted = new Set(['execution.json', 'assignment.json', 'report.json', 'inventory.json', 'resources.json']);
  const json = new Map();
  const { files, unpacked } = inspectEvidenceZip(zip, Math.min(budget.remaining, limits.unpackedBytes), (path, data) => {
    if (wanted.has(path)) json.set(path, data);
  });
  budget.remaining -= unpacked;
  requireEvidence((check.files ?? []).every((path) => files.some(({ name, size }) => name === path && size > 0)),
    'ARTIFACT_FILE_MISSING');
  const tests = inspectTestEvidence(check, json, candidate, run, evidencePaths);
  return {
    id: 'github-artifact:' + artifact.id, digest: checksum, expires_at: artifact.expires_at,
    bytes: zip.length, unpacked_bytes: unpacked, file_count: files.length,
    files: files.filter((file) => check.files?.includes(file.name)), ...tests,
  };
}

async function jobObservation(provider, job, run, candidate, repoId) {
  requireEvidence(positive(job.id) && job.run_id === run.id && job.run_attempt === run.run_attempt &&
    job.head_sha === run.head_sha && safeJob(job.name), 'JOB_PROVENANCE');
  // Derive the fixed endpoint from the only accepted URL shape.
  const check = typeof job.check_run_url === 'string' &&
    job.check_run_url.match(/^https:\/\/api\.github\.com\/repos\/bensmullen\/personal-finance-app\/check-runs\/([1-9][0-9]*)$/);
  requireEvidence(check && positive(Number(check[1])), 'CHECK_ADDRESS');
  const record = await provider.json('/check-runs/' + check[1]);
  requireEvidence(record.id === Number(check[1]) && record.name === job.name &&
    record.app?.id === 15368 && record.app.slug === 'github-actions' &&
    record.check_suite?.id === run.check_suite_id && record.head_sha === candidate.merge_candidate_sha &&
    record.status === job.status && record.conclusion === job.conclusion && run.repository.id === repoId, 'CHECK_PROVENANCE');
  const steps = job.steps ?? [];
  requireEvidence(Array.isArray(steps) && steps.length <= 64 && unique(steps.map(({ number }) => number)) &&
    steps.every(({ number }) => positive(number)), 'JOB_STEPS');
  let status = outcome(job);
  const adverse = steps.filter((step) => !['PASS', 'SKIP'].includes(outcome(step)));
  if (status === 'PASS' && adverse.length) status = worst(adverse.map(outcome));
  return {
    id: job.id, check_run_id: record.id, outcome: status, conclusion: job.conclusion ?? null,
    steps: adverse.map((step) => ({ number: step.number, outcome: outcome(step) })),
  };
}

async function inspectRun(provider, original, workflow, planned, candidate, repoId, now, budget, evidencePaths) {
  const root = '/actions/runs/' + original.id;
  validateRun(original, original, workflow, repoId);
  const attempts = [];
  const issues = [];
  for (let number = 1; number <= original.run_attempt; number++) {
    try {
      const route = root + '/attempts/' + number;
      const attempt = await provider.json(route);
      validateRun(attempt, original, workflow, repoId);
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
    validateRun(latest, original, workflow, repoId);
    requireEvidence(latest.run_attempt === original.run_attempt && latest.status === original.status &&
      latest.conclusion === original.conclusion, 'RUN_CHANGED');
  } catch (error) {
    issues.push({ code: codeOf(error) });
  }
  const results = [];
  const observed = new Set();
  let artifacts;
  for (const { attempt, jobs } of attempts) {
    const attemptOutcome = outcome(attempt);
    if (attemptOutcome !== 'PASS') issues.push({ attempt: attempt.run_attempt, code: 'ATTEMPT_' + attemptOutcome });
    const entries = [];
    for (const job of jobs) {
      const selected = planned.find(({ job: name }) => name === job.name);
      const skippedMatrix = ['unit', 'e2e'].includes(job.name) && outcome(job) === 'SKIP' &&
        planned.filter((check) => check.job.startsWith(job.name + ' (shard ')).every(({ selection }) => selection === 'excluded');
      if (!selected && !skippedMatrix) issues.push({ attempt: attempt.run_attempt, code: 'UNPLANNED_JOB', job_id: job.id });
      let result;
      try {
        result = await jobObservation(provider, job, attempt, candidate, repoId);
      } catch (error) {
        result = { id: job.id, outcome: 'INCOMPLETE', code: codeOf(error) };
        issues.push({ attempt: attempt.run_attempt, code: 'UNAUTHENTICATED_JOB', job_id: job.id });
      }
      if (selected) {
        observed.add(selected.id);
        if (selected.selection === 'excluded' && result.outcome !== 'SKIP') {
          issues.push({ attempt: attempt.run_attempt, code: 'EXCLUDED_JOB_EXECUTED', check: selected.id });
        }
        if (selected.artifact_required && result.outcome !== 'SKIP') {
          // Legacy shard names are overwritten across attempts. They can
          // identify a single attempt only when there was no rerun.
          try {
            requireEvidence(selected.artifact.includes('{attempt}') || original.run_attempt === 1, 'ARTIFACT_ATTEMPT_UNKNOWN');
            artifacts ??= await provider.list(root + '/artifacts', 'artifacts');
            requireEvidence(unique(artifacts.map(({ id }) => id)), 'DUPLICATE_ARTIFACT_ID');
            const name = selected.artifact.replace('{run}', String(attempt.id)).replace('{attempt}', String(attempt.run_attempt));
            result.artifact = await artifactEvidence(provider, artifacts, name, attempt, repoId, now, budget, selected, candidate, evidencePaths);
            if (result.artifact.outcome) result.outcome = worst([result.outcome, result.artifact.outcome]);
          } catch (error) {
            result.artifact_issue = codeOf(error);
            if (result.outcome === 'PASS') result.outcome = 'INCOMPLETE';
          }
        }
      }
      entries.push({ check: selected?.id ?? null, ...result });
    }
    results.push({ number: attempt.run_attempt, outcome: attemptOutcome, jobs: entries });
  }
  for (const check of planned) {
    if (check.selection === 'selected' && !observed.has(check.id)) issues.push({ code: 'MISSING_JOB', check: check.id });
  }
  for (const kind of ['unit', 'e2e']) {
    const assignments = results.flatMap(({ jobs }) => jobs.filter(({ check }) =>
      planned.find(({ id }) => check === id)?.job.startsWith(kind + ' (shard ')))
      .map(({ artifact }) => artifact?.assignment_digest).filter(Boolean);
    if (new Set(assignments).size > 1) issues.push({ code: 'SHARD_ASSIGNMENT_DRIFT', kind });
  }
  return { id: original.id, workflow_id: workflow.id, attempts: results, issues };
}

// The selection is an operator-owned input. Provider data alone never grants
// task, plan, workflow-pin or reviewer authority.
export async function collectGoalEvidence(input, provider, now = Date.now()) {
  validateSelection(input);
  const { task, candidate, plan, workflows, inputs, implementer } = input;
  const runs = [];
  const issues = [];
  const evidencePaths = new Set();
  const budget = { remaining: limits.totalUnpackedBytes };
  try {
    requireEvidence(Number.isFinite(now), 'OBSERVATION_TIME');
    const repoId = await exactPull(provider, candidate);
    await currentIssues(provider, task);
    const integration = candidate.merge_candidate_sha;
    const commit = await provider.json('/commits/' + integration);
    requireEvidence(commit.sha === integration && commit.parents?.length === 2 &&
      commit.parents[0].sha === candidate.base_sha && commit.parents[1].sha === candidate.head_sha, 'INTEGRATION_PARENTS');
    for (const pin of inputs) {
      const bytes = await pinContents(provider, integration, pin);
      if (pin.path === registryPath) {
        const registry = readHouseholdRegistry(bytes);
        for (const entry of registry.applicable) for (const evidence of entry.evidence) evidencePaths.add(evidence.path);
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
            const result = await inspectRun(provider, original, workflow, planned, candidate, repoId, now, budget, evidencePaths);
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
    requireEvidence(await exactPull(provider, candidate) === repoId, 'STALE_CANDIDATE');
    await currentIssues(provider, task);
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
  const complete = issues.length === 0 && runs.every((run) => run.issues.length === 0) &&
    checks.every((check) => check.required ? check.outcome === 'PASS' : ['PASS', 'NOT_APPLICABLE'].includes(check.outcome));
  return {
    task, candidate, implementer, observed_at: Number.isFinite(now) ? new Date(now).toISOString() : null,
    selection_digest: digest({ task, candidate, workflows, inputs, implementer }),
    inputs, workflows, checks, runs, issues, complete,
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
  requireEvidence(registry.schema === 'GF04_HOUSEHOLDS_V1' && Array.isArray(registry.applicable) &&
    registry.applicable.length === householdCases.length && householdCases.every((key) =>
      registry.applicable.some(({ id }) => id === key)) &&
    registry.applicable.every(({ gaps, owner, evidence }) => Array.isArray(gaps) && gaps.length <= 12 &&
      gaps.every((gap) => identifier.test(gap)) && positive(owner) && Array.isArray(evidence) &&
      evidence.length > 0 && evidence.length <= 12 && evidence.every(({ path }) => safePath(path))) &&
    registry.future_gate?.owner === 108 && registry.future_gate.independently_saved_plans_per_household === 4 &&
    JSON.stringify(registry.future_gate.households) === JSON.stringify(Array.from({ length: 8 }, (_, i) => 'H0' + (i + 1))),
  'HOUSEHOLD_REGISTRY');
  return registry;
}

// The collector only describes provider observations. A trusted coordinator
// authenticates independent reviews at this boundary, using its own authority.
export function householdReadiness({ collection, registryBytes, reviews = {}, verify }) {
  const registry = readHouseholdRegistry(registryBytes);
  const registry_digest = bytesDigest(registryBytes);
  const pinned = collection.inputs.some(({ path, digest: pin }) => path === registryPath && pin === registry_digest);
  const blockers = [];
  const evidence = [...new Map(collection.checks.flatMap(({ artifacts }) => artifacts).map((ref) => [ref.id, ref])).values()];
  const household = collection.checks.find(({ id }) => id === 'household-readiness');
  const manualArtifact = household?.outcome === 'PASS' ? household.artifacts[0] ?? null : null;
  const jobArtifacts = collection.runs.flatMap(({ attempts }) => attempts.flatMap(({ jobs }) =>
    jobs.filter(({ outcome: status, artifact }) => status === 'PASS' && artifact).map(({ artifact }) => artifact)));
  const paths = new Set(jobArtifacts.flatMap((artifact) => artifact.witness_paths ?? []));
  const captures = jobArtifacts.find((artifact) => artifact.id === manualArtifact?.id)?.files ?? [];
  if (!pinned || !collection.complete) blockers.push('EXACT_CANDIDATE_EVIDENCE_MISSING');
  if (!manualArtifact) blockers.push('MANUAL_BROWSER_ARTIFACT_MISSING');
  const applicable = registry.applicable.map(({ id, owner, gaps, evidence: expected }) =>
    ({ id, owner, gaps, missing_evidence: expected.map(({ path }) => path).filter((path) => !paths.has(path)) }));
  for (const { id, gaps } of applicable) {
    if (gaps.length) blockers.push(...gaps.map((gap) => id + ':' + gap));
  }
  if (applicable.some(({ missing_evidence }) => missing_evidence.length)) blockers.push('APPLICABLE_TEST_EVIDENCE_MISSING');
  const binding = {
    task: collection.task, candidate: collection.candidate, selection_digest: collection.selection_digest,
    registry_digest, applicable, evidence, browser_artifact: manualArtifact, captures,
  };
  const accepted = {};
  for (const kind of ['semantic', 'visual']) {
    const review = reviews[kind];
    const independent = typeof review?.actor === 'string' && typeof review?.session === 'string' &&
      review.actor !== collection.implementer.actor && review.session !== collection.implementer.session;
    const coversInventory = Array.isArray(review?.households) && review.households.length === householdCases.length &&
      householdCases.every((id) => review.households.includes(id));
    const authentic = pinned && collection.complete && manualArtifact && independent && coversInventory &&
      ['approved', 'changes_required'].includes(review.disposition) &&
      typeof verify === 'function' && verify('independent_' + kind + '_review', { binding, review }) === true;
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
  requireEvidence(normal.every((id) => !id.includes(manualFile) && !id.includes(uxFile)) &&
    profile.every((id) => id.startsWith(manualFile)) &&
    optIn.every((id) => !id.includes(manualFile)) &&
    optIn.some((id) => id.startsWith(uxFile)) &&
    JSON.stringify(optIn.filter((id) => !id.startsWith(uxFile))) === JSON.stringify(normal), 'BROWSER_INVENTORY_ROUTING');
  return { ordinary_count: normal.length, ordinary_digest: bytesDigest(JSON.stringify(normal)),
    ux_count: optIn.length, ux_digest: bytesDigest(JSON.stringify(optIn)), manual: profile };
}

async function main(args) {
  if (args[0] === 'browser-inventory' && args.length === 5) {
    const [, normal, manual, ux, output] = args;
    const values = await Promise.all([normal, manual, ux].map(async (file) => parseEvidenceJson(await readInput(file))));
    await writeFile(output, JSON.stringify({
      sha: process.env.GITHUB_SHA, attempt: process.env.GITHUB_RUN_ATTEMPT, ...browserInventory(...values),
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
