// Sole optional Codex preflight. The Bash sandbox may read .codex/runtime
// but cannot write .codex. PostToolUse owns authoritative receipt publication.
// This process writes only disposable, ignored diagnostic logs/progress.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, lstatSync, openSync, closeSync, fstatSync, readFileSync, readSync, writeFileSync, writeSync, appendFileSync, constants } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
if (args.length > 1 || (args[0] && !/^test\/[A-Za-z0-9_/-]+\.test\.ts$/.test(args[0]))) {
  console.error('FAIL invalid bounded preflight arguments');
  process.exit(2);
}
const root = process.cwd();
const latest = JSON.parse(readFileSync('.codex/runtime/latest-task.json', 'utf8'));
if (!/^[A-Za-z0-9_.-]+\.json$/.test(latest.path)) throw new Error('Invalid receipt path');
const data = readFileSync(resolve('.codex/runtime', latest.path), 'utf8');
if (createHash('sha256').update(data).digest('hex') !== latest.sha256) throw new Error('Receipt hash mismatch');
const state = JSON.parse(data);
const attempt = state.PREFLIGHT;
if (!state.ACTIVE || state.WORKTREE !== resolve(root) || !attempt ||
    (attempt.test ?? undefined) !== args[0] || !Number.isInteger(attempt.count) ||
    !/^[a-f0-9]{64}$/.test(attempt.patch) ||
    !/^[A-Za-z0-9_.-]{1,128}$/.test(state.AUTHORIZATION_ID) ||
    !/^[a-f0-9]{32}$/.test(attempt.nonce)) {
  throw new Error('Preflight requires a hash-bound active hook reservation');
}

let logPath;
let progressPath;
let fd;
const maxLogBytes = 1024 * 1024;
const maxProgressBytes = 512 * 1024;
const openedAt = performance.now();
let logged = 0;

function validProgressEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return false;
  const { phase, id, status, stage, offset_ms, elapsed_ms } = event;
  const stageKnown = ['typescript', 'typescript-next', 'unit'].includes(stage);
  const caseKnown = typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
  switch (phase) {
    case 'stage-start':
      return stageKnown && Number.isSafeInteger(offset_ms) && offset_ms >= 0 && Object.keys(event).length === 3;
    case 'stage-end':
      return stageKnown && Number.isSafeInteger(elapsed_ms) && elapsed_ms >= 0 && Object.keys(event).length === 4
        && ['PASS', 'FAIL', 'SKIP', 'TIMEOUT', 'INCOMPLETE'].includes(status);
    case 'start':
      return caseKnown && Object.keys(event).length === 2;
    case 'end':
      return caseKnown && Object.keys(event).length === 3
        && ['passed', 'failed', 'skipped', 'todo', 'timed_out', 'incomplete'].includes(status);
    case 'case-limit':
      return Object.keys(event).length === 1;
    case 'run-outcome':
    case 'case-overflow-outcome':
      return ['failed', 'timed_out'].includes(status) && Object.keys(event).length === 2;
    case 'cases-complete':
      return ['passed', 'failed'].includes(status) && Object.keys(event).length === 2;
    default:
      return false;
  }
}

function readProgress() {
  const file = openSync(progressPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(file);
    if (!before.isFile()) throw new Error('nonregular progress');
    const buffer = Buffer.alloc(maxProgressBytes + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const count = readSync(file, buffer, bytes, buffer.length - bytes, null);
      if (count === 0) break;
      bytes += count;
    }
    const after = fstatSync(file);
    const lines = buffer.toString('utf8', 0, bytes).split('\n');
    const trailing = lines.pop();
    let complete = bytes <= maxProgressBytes && bytes === before.size && bytes === after.size
      && before.mtimeMs === after.mtimeMs && trailing === '';
    const events = [];
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (validProgressEvent(event)) events.push(event);
        else complete = false;
      } catch {
        complete = false;
      }
    }
    return { events, complete };
  } finally {
    closeSync(file);
  }
}

function phaseEvent(event) {
  try {
    appendFileSync(progressPath, JSON.stringify(event) + '\n', { flag: constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW | constants.O_NONBLOCK });
  } catch { /* phase progress is private diagnostic evidence only */ }
}

const output = (status, reason, timeoutObserved, retryEligible) => {
  // Only this exact command's host-returned output may be promoted by
  // PostToolUse into the protected receipt. Disposable files never grant PASS.
  const report = {
    schema: 2, authorization: state.AUTHORIZATION_ID,
    attempt: attempt.count, patch: attempt.patch, nonce: attempt.nonce,
    test: args[0] ?? null, status, reason, timeoutObserved, retryEligible,
    ...(logPath && progressPath ? { log: relative(root, logPath), progress: relative(root, progressPath) } : {}),
  };
  console.log('PFM_PREFLIGHT_RESULT ' + JSON.stringify(report));
  process.exitCode = status === 'FAIL' ? 1 : 0;
};
const finish = (status, reason, timeoutObserved = false, retryEligible = false) => {
  if (fd !== undefined) {
    try { closeSync(fd); } catch { /* diagnostic output only */ }
    fd = undefined;
  }
  // Retain each already-completed case even if the overall unit process timed
  // out. Never infer a PASS from a partial progress stream.
  if (progressPath) {
    try {
      let started = 0;
      let completed = 0;
      for (const event of readProgress().events) {
        if (event.phase === 'start') started += 1;
        if (event.phase === 'end') completed += 1;
      }
      if (logPath) writeFileSync(logPath + '.summary.json', JSON.stringify({
        status, reason, startedCases: started, completedCases: completed,
        progress: relative(root, progressPath),
      }) + '\n', { flag: 'wx', mode: 0o600 });
    } catch { /* missing/corrupt diagnostics do not change execution truth */ }
  }
  output(status, reason, timeoutObserved, retryEligible);
};

try {
  const directory = resolve('.pfm-preflight');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory()) {
    throw new Error('unsafe diagnostic directory');
  }
  const subdir = resolve(directory, `preflight-${state.AUTHORIZATION_ID}-${attempt.count}`);
  if (!subdir.startsWith(directory + sep)) throw new Error('unsafe diagnostic path');
  // Exclusive directory creation prevents accidental repeated execution using
  // the same reservation, even when a call bypasses a test harness's hook.
  mkdirSync(subdir, { mode: 0o700 });
  logPath = resolve(subdir, 'runner.log');
  progressPath = resolve(subdir, 'progress.jsonl');
  fd = openSync(logPath, 'wx', 0o600);
  closeSync(openSync(progressPath, 'wx', 0o600));
} catch (error) {
  finish('SKIP', `sandbox diagnostic directory unavailable (${error.code ?? 'unknown'}); no tests executed`);
}

if (fd !== undefined) {
  const env = Object.fromEntries(['PATH', 'HOME', 'SystemRoot', 'TMPDIR'].filter(key => process.env[key])
    .map(key => [key, process.env[key]]));
  env.CI = 'true';
  const npm = spawnSync('npm', ['--version'], { env, timeout: 2000, stdio: 'ignore' });
  if (Number(process.versions.node.split('.')[0]) !== 22 || npm.status !== 0 ||
      !existsSync('node_modules/typescript/bin/tsc') || !existsSync('node_modules/vitest/vitest.mjs')) {
    finish('SKIP', 'Node 22/npm/node_modules unavailable; no installation attempted');
  } else {
    const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
    if (scripts.typecheck !== 'tsc --noEmit && tsc -p tsconfig.next.json') {
      finish('SKIP', 'typecheck API changed; bounded helper requires framework audit');
    } else {
      const run = (stage, command, parameters, deadline, additionalEnv = {}) => new Promise(resolveResult => {
        let child;
        let timedOut = false;
        let teardown;
        let exitCode = null;
        let finished = false;
        const started = performance.now();
        if (started >= deadline) {
          resolveResult({ status: 'TIMEOUT', timeout: true });
          return;
        }
        phaseEvent({ phase: 'stage-start', stage, offset_ms: Math.ceil(started - openedAt) });
        const capture = chunk => {
          if (logged >= maxLogBytes) return;
          const piece = chunk.subarray(0, maxLogBytes - logged);
          try { writeSync(fd, piece); logged += piece.length; }
          catch { /* logging failure is observable only as incomplete diagnostics */ }
        };
        try {
          child = spawn(command, parameters, { cwd: root, env: { ...env, ...additionalEnv },
            detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
        } catch {
          phaseEvent({ phase: 'stage-end', stage, status: 'SKIP', elapsed_ms: Math.ceil(performance.now() - started) });
          resolveResult({ status: 'SKIP', timeout: false });
          return;
        }
        child.stdout.on('data', capture);
        child.stderr.on('data', capture);
        const complete = (status, timeout = false) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          clearTimeout(teardown);
          phaseEvent({ phase: 'stage-end', stage, status, elapsed_ms: Math.ceil(performance.now() - started) });
          resolveResult({ status, timeout });
        };
        const timer = setTimeout(() => {
          timedOut = true;
          try { process.kill(-child.pid, 'SIGKILL'); } catch { /* terminal proof still required */ }
          teardown = setTimeout(() => {
            child.stdout.destroy();
            child.stderr.destroy();
            child.unref();
            complete(exitCode !== null && exitCode !== 0 ? 'FAIL' : 'INCOMPLETE', true);
          }, 1000);
        }, Math.max(0, deadline - performance.now()));
        child.once('exit', code => { exitCode = code; });
        child.once('error', () => complete(child.pid === undefined ? 'SKIP' : 'INCOMPLETE', timedOut));
        child.once('close', (code, signal) => {
          const timeout = timedOut || performance.now() >= deadline;
          complete(code !== null && code !== 0 ? 'FAIL' : timeout ? 'TIMEOUT'
            : signal || code === null ? 'INCOMPLETE' : 'PASS', timeout);
        });
      });

      const typecheckDeadline = performance.now() + 60_000;
      const first = await run('typescript', process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], typecheckDeadline);
      const second = first.status === 'PASS'
        ? await run('typescript-next', process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.next.json'], typecheckDeadline)
        : first;
      const unitStarted = second.status === 'PASS' && Boolean(args[0]);
      const result = unitStarted
        ? await run('unit', process.execPath, ['node_modules/vitest/vitest.mjs', 'run', args[0],
          '--maxWorkers=1', '--no-file-parallelism', '--retry=0',
          '--reporter=default', '--reporter=./tools/codex/local-preflight-progress-reporter.mjs'], performance.now() + 30_000,
          { PFM_PREFLIGHT_PROGRESS: progressPath })
        : second;
      let { status: third, timeout: timeoutObserved } = result;
      let completeCaseEvidence = !unitStarted;
      if (unitStarted && third !== 'SKIP') {
        try {
          const { events, complete } = readProgress();
          const cases = events.filter(({ phase }) => !phase.startsWith('stage-'));
          const outcomes = cases.filter(({ phase }) => ['end', 'case-overflow-outcome', 'run-outcome'].includes(phase));
          const caseTimeout = outcomes.some(({ status }) => status === 'timed_out');
          const knownFailure = outcomes.some(({ status }) => status === 'failed');
          const ending = cases.at(-1);
          const completedIds = new Set(outcomes.filter(({ phase }) => phase === 'end').map(({ id }) => id));
          const inventoryComplete = cases.some(({ phase }) => phase === 'case-limit')
            || cases.every(({ phase, id }) => phase !== 'start' || completedIds.has(id));
          completeCaseEvidence = complete && ending?.phase === 'cases-complete'
            && ending.status === (third === 'PASS' ? 'passed' : 'failed')
            && inventoryComplete
            && cases.filter(({ phase }) => phase === 'cases-complete').length === 1
            && outcomes.every(({ status }) => ['passed', 'failed', 'skipped', 'todo', 'timed_out'].includes(status));
          timeoutObserved ||= caseTimeout;
          if (knownFailure) third = 'FAIL';
          else if (caseTimeout && completeCaseEvidence && !result.timeout && third !== 'INCOMPLETE') third = 'TIMEOUT';
        } catch { /* retain an actual nonzero exit or process timeout */ }
        if (third === 'PASS' && !completeCaseEvidence) third = 'INCOMPLETE';
      }
      const retryEligible = third === 'FAIL' && result.status === 'FAIL' && !timeoutObserved && completeCaseEvidence;
      finish(third, third === 'PASS'
        ? args[0] ? 'typecheck and selected unit passed' : 'typecheck passed'
        : third === 'TIMEOUT' ? 'bounded execution timed out; incomplete, no local retry'
          : third === 'SKIP' ? 'bounded verifier unavailable; no local retry'
            : third === 'INCOMPLETE' ? 'bounded verification interrupted or case evidence incomplete; no local retry'
              : timeoutObserved ? 'bounded checks failed with timeout; no local retry'
                : !completeCaseEvidence ? 'selected unit failed with incomplete case evidence; no local retry'
                  : unitStarted ? 'selected unit executed and failed' : 'typecheck executed and failed',
      timeoutObserved, retryEligible);
    }
  }
}
