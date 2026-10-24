import { spawn } from 'node:child_process';
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, compare, validatePartition } from './plan-test-shards.mjs';

const relative = file => path.relative(root, file).split(path.sep).join('/');
export function playwrightIdentity(test) {
  const titles = test.titlePath();
  // Reporter titlePath: root, project, file, describes..., test title.
  const project = test.parent.project()?.name ?? '';
  const tail = titles.slice(3);
  const location = `${relative(test.location.file)}:${test.location.line}:${test.location.column}`;
  return `${project ? `[${project}] › ` : ''}${location} › ${tail.join(' › ')}`;
}

export function playwrightInventory(suite) {
  const tests = suite.allTests();
  const serialFiles = new Set();
  const inventory = tests.map(test => {
    let group;
    for (let parent = test.parent; parent; parent = parent.parent) {
      // Playwright's reporter Suite does not expose execution mode publicly.
      // Conservatively keep the entire file together if any ancestor is serial.
      // Pinned Playwright 1.63 supplies _parallelMode; fail closed on API drift.
      if (!['_parallelMode', 'type'].every(key => key in parent) ||
          !['none', 'default', 'serial', 'parallel'].includes(parent._parallelMode)) throw new Error('Unsupported Playwright suite mode API');
      if (parent._parallelMode === 'serial') {
        group = `${test.parent.project()?.name ?? ''}:${relative(test.location.file)}`;
        serialFiles.add(group);
      }
    }
    return { id: playwrightIdentity(test), fileGroup: `${test.parent.project()?.name ?? ''}:${relative(test.location.file)}` };
  });
  return inventory.map(({ id, fileGroup }) => ({ id, ...(serialFiles.has(fileGroup) ? { group: fileGroup } : {}) }));
}

function event(value) {
  if (!process.env.PFM_PROGRESS) return;
  appendFileSync(process.env.PFM_PROGRESS, `${JSON.stringify({ at: new Date().toISOString(), ...value })}\n`);
  console.log(`PFM_EVENT ${JSON.stringify(value)}`);
}

// Both runners use this small reporter. Only identities/timing/status are emitted,
// never stdout, financial assertion values, attachments or model contents.
export default class DurationReporter {
  onBegin(_config, suite) {
    const inventory = playwrightInventory(suite);
    if (process.env.PFM_DISCOVERY) writeFileSync(process.env.PFM_DISCOVERY, JSON.stringify(inventory));
    event({ phase: 'inventory', ids: inventory.map(t => t.id) });
  }
  onTestBegin(test, result) { event({ phase: 'start', id: playwrightIdentity(test), attempt: result.retry }); }
  onTestEnd(test, result) { event({ phase: 'end', id: playwrightIdentity(test), attempt: result.retry,
    durationMs: result.duration, status: result.status }); }
  onError() { event({ phase: 'error', status: 'runner-error' }); }
  onTestModuleStart(module) { event({ phase: 'start', id: relative(module.moduleId) }); }
  onTestModuleEnd(module) { event({ phase: 'end', id: relative(module.moduleId),
    durationMs: module.diagnostic()?.duration ?? 0, status: module.state() }); }
}

export function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return undefined; }
}

export function validateVitest(report, selected) {
  if (!report || report.success !== true || !(report.numTotalTests > 0) ||
      report.numFailedTests !== 0 || report.numRuntimeErrorTestSuites > 0 || report.numUnhandledErrors > 0 ||
      !Array.isArray(report.testResults)) return false;
  const ids = report.testResults.map(file => relative(path.resolve(root, file.name)));
  return ids.length > 0 && new Set(ids).size === ids.length &&
    report.testResults.every(file => file.status === 'passed' && file.assertionResults?.length > 0 &&
      file.assertionResults.every(assertion => ['passed', 'pending', 'todo', 'skipped'].includes(assertion.status))) &&
    report.testResults.reduce((total, file) => total + file.assertionResults.length, 0) === report.numTotalTests &&
    (!selected || sameIds(ids, selected.map(t => t.id)));
}
const sameIds = (a, b) => a.length === b.length &&
  a.sort(compare).every((value, index) => value === [...b].sort(compare)[index]);

export function playwrightResults(report) {
  const tests = [];
  const walk = (suite, titles = []) => {
    const next = suite.title ? [...titles, suite.title] : titles;
    for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) {
      const file = relative(path.resolve(report.config?.rootDir ?? path.join(root, 'e2e'), spec.file));
      const id = `${test.projectName ? `[${test.projectName}] › ` : ''}${file}:${spec.line}:${spec.column} › ${[...next.slice(1), spec.title].join(' › ')}`;
      tests.push({ id, test });
    }
    for (const child of suite.suites ?? []) walk(child, next);
  };
  for (const suite of report?.suites ?? []) walk(suite);
  return tests;
}

export function validatePlaywright(report, selected) {
  if (!report || !report.stats || !Array.isArray(report.errors) || report.errors.length || report.stats.unexpected !== 0 ||
      report.stats.skipped !== 0 || !(report.stats.expected + report.stats.flaky > 0)) return false;
  const tests = playwrightResults(report);
  const ids = tests.map(t => t.id);
  return tests.length > 0 && new Set(ids).size === ids.length && tests.every(({ test }) =>
    ['expected', 'flaky'].includes(test.status) && test.expectedStatus === 'passed' &&
    test.results?.length > 0 && test.results.at(-1).status === 'passed') &&
    tests.length === report.stats.expected + report.stats.flaky &&
    (!selected || sameIds(ids, selected.map(t => t.id)));
}

// The summary exists before spawn. A hard job kill leaves a running/incomplete
// receipt and the last durable test event rather than a misleading success.
export async function runCaptured(command, args, options) {
  const { directory, kind, env = {}, graceMs = 10_000 } = options;
  // Budget setup/install/discovery too: stop at minute 18 of the job, or after
  // 15 minutes of execution, whichever comes first. Two minutes remain to upload.
  const jobRemaining = process.env.PFM_JOB_STARTED_MS
    ? Number(process.env.PFM_JOB_STARTED_MS) + 18 * 60_000 - Date.now() : Infinity;
  const deadlineMs = options.deadlineMs ?? Math.max(1, Math.min(15 * 60_000, jobRemaining));
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) throw new Error('Invalid diagnostic deadline');
  mkdirSync(directory, { recursive: true });
  const summaryFile = path.join(directory, 'execution.json');
  const progress = path.join(directory, 'progress.jsonl');
  writeFileSync(progress, '');
  const summary = { schema: 1, sha: process.env.GITHUB_SHA ?? null, kind,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? 'local', started: new Date().toISOString(),
    status: 'running/incomplete', exit: null, signal: null, context: null };
  const save = () => writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
  save();
  const log = openSync(path.join(directory, 'runner.log'), 'w');
  let bytes = 0;
  const child = spawn(command, args, { cwd: options.cwd ?? root,
    env: { ...process.env, ...env, PFM_PROGRESS: progress }, detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'] });
  let pending = '';
  const capture = chunk => {
    const remaining = 8 * 1024 * 1024 - bytes;
    if (remaining > 0) { const piece = chunk.subarray(0, remaining); appendFileSync(log, piece); bytes += piece.length; }
    pending = (pending + chunk.toString('utf8')).slice(-65536);
    const lines = pending.split('\n'); pending = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('PFM_EVENT ')) continue;
      try {
        const value = JSON.parse(line.slice(10));
        if (['start', 'end', 'error'].includes(value.phase)) console.log(
          `${value.phase} ${value.id ?? ''} attempt=${value.attempt ?? 0} durationMs=${value.durationMs ?? ''} status=${value.status ?? ''}`);
      } catch { /* raw output remains on disk */ }
    }
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  let killTimer;
  const signalGroup = signal => {
    try { if (process.platform === 'win32') child.kill(signal); else process.kill(-child.pid, signal); } catch { /* already exited */ }
  };
  const stop = reason => {
    if (summary.context) return;
    summary.context = reason;
    summary.status = 'failed'; save();
    signalGroup('SIGTERM');
    killTimer = setTimeout(() => signalGroup('SIGKILL'), graceMs);
  };
  const terminate = () => stop('cancelled:SIGTERM');
  const interrupt = () => stop('cancelled:SIGINT');
  process.on('SIGTERM', terminate); process.on('SIGINT', interrupt);
  const deadline = setTimeout(() => stop('deadline-exceeded'), deadlineMs);
  await new Promise(resolve => {
    child.on('error', error => { summary.context = `spawn:${error.code ?? 'error'}`; });
    child.on('close', (code, signal) => { summary.exit = code; summary.signal = signal; resolve(); });
  });
  clearTimeout(deadline); clearTimeout(killTimer);
  process.off('SIGTERM', terminate); process.off('SIGINT', interrupt);
  closeSync(log);
  summary.finished = new Date().toISOString();
  summary.status = 'failed'; // wrapper promotes only after structured report validation
  save();
  return { summary, save, ok: summary.exit === 0 && !summary.signal && !summary.context };
}

export function writeMeasurements(directory, kind, report) {
  const measurements = kind === 'unit'
    ? (report?.testResults ?? []).map(file => ({ id: relative(path.resolve(root, file.name)),
      durationMs: Math.max(0, file.endTime - file.startTime), attempt: 0, status: file.status }))
    : playwrightResults(report).flatMap(({ id, test }) => (test.results ?? []).map(result =>
      ({ id, durationMs: result.duration, attempt: result.retry, status: result.status })));
  writeFileSync(path.join(directory, 'durations.json'), JSON.stringify({ schema: 1,
    sha: process.env.GITHUB_SHA ?? null, kind, measurements }, null, 2));
}

export function verifyShardEvidence(directory, kind, count, sha) {
  let canonical;
  for (let index = 1; index <= count; index++) {
    const artifact = path.join(directory, `${kind === 'unit' ? 'unit' : 'e2e'}-diagnostics-${index}-${sha}`);
    const execution = readJson(path.join(artifact, 'execution.json'));
    const proof = readJson(path.join(artifact, 'assignment.json'));
    if (!execution || execution.sha !== sha || execution.status !== 'passed' ||
        execution.exit !== 0 || execution.signal || execution.context || execution.reportValid !== true ||
        !proof || proof.sha !== sha || proof.kind !== kind || proof.count !== count || proof.shards?.length !== count) {
      throw new Error(`Missing/failed/stale ${kind} shard ${index}`);
    }
    validatePartition(proof.inventory, proof.shards);
    if (!proof.shards[index - 1].length) throw new Error('Empty selected shard evidence');
    const serialized = JSON.stringify({ inventory: proof.inventory, shards: proof.shards });
    if (canonical && canonical !== serialized) throw new Error('Cross-runner inventory/assignment drift');
    canonical = serialized;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === '--verify-shards') {
  const [, , , sha, unit, e2e] = process.argv;
  if (!sha) throw new Error('Missing exact checkout SHA');
  if (unit === 'true') verifyShardEvidence('.ci-shard-evidence', 'unit', 3, sha);
  if (e2e === 'true') verifyShardEvidence('.ci-shard-evidence', 'e2e', 4, sha);
}
