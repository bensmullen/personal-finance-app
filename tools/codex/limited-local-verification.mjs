// Sole optional Codex preflight. The Bash sandbox may read .codex/runtime
// but cannot write .codex. PostToolUse owns authoritative receipt publication.
// This process writes only disposable, ignored diagnostic logs/progress.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, lstatSync, openSync, closeSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
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
const output = (status, reason) => {
  // Only this exact command's host-returned output may be promoted by
  // PostToolUse into the protected receipt. Disposable files never grant PASS.
  const report = {
    schema: 1, authorization: state.AUTHORIZATION_ID,
    attempt: attempt.count, patch: attempt.patch, nonce: attempt.nonce,
    test: args[0] ?? null, status, reason,
    ...(logPath ? { log: relative(root, logPath) } : {}),
    ...(progressPath ? { progress: relative(root, progressPath) } : {}),
  };
  console.log('PFM_PREFLIGHT_RESULT ' + JSON.stringify(report));
  process.exitCode = status === 'FAIL' ? 1 : 0;
};
const finish = (status, reason) => {
  if (fd !== undefined) {
    try { closeSync(fd); } catch { /* diagnostic output only */ }
    fd = undefined;
  }
  // Retain each already-completed case even if the overall unit process timed
  // out. Never infer a PASS from a partial progress stream.
  if (progressPath) {
    try {
      const cases = readFileSync(progressPath, 'utf8').split('\n').filter(Boolean);
      let started = 0;
      let completed = 0;
      for (const line of cases) {
        const event = JSON.parse(line);
        if (event.phase === 'start') started += 1;
        if (event.phase === 'end') completed += 1;
      }
      if (logPath) writeFileSync(logPath + '.summary.json', JSON.stringify({
        status, reason, startedCases: started, completedCases: completed,
        progress: relative(root, progressPath),
      }) + '\n', { flag: 'wx', mode: 0o600 });
    } catch { /* missing/corrupt diagnostics do not change execution truth */ }
  }
  output(status, reason);
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
      const run = (command, parameters, timeout, additionalEnv = {}) => new Promise(resolveResult => {
        let child;
        let timedOut = false;
        let finished = false;
        let spawnError = false;
        let logged = 0;
        const maxLogBytes = 1024 * 1024;
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
          resolveResult('SKIP');
          return;
        }
        child.stdout.on('data', capture);
        child.stderr.on('data', capture);
        const timer = setTimeout(() => {
          timedOut = true;
          try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ }
        }, timeout);
        const complete = result => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          resolveResult(result);
        };
        child.once('error', () => { spawnError = true; complete('SKIP'); });
        child.once('close', (code, signal) => complete(timedOut ? 'TIMEOUT' :
          spawnError || signal || code === null ? 'SKIP' : code === 0 ? 'PASS' : 'FAIL'));
      });

      const started = Date.now();
      const first = await run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], 60_000);
      const remaining = 60_000 - (Date.now() - started);
      const second = first === 'PASS' && remaining > 0
        ? await run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.next.json'], remaining)
        : first === 'PASS' ? 'TIMEOUT' : first;
      const third = second === 'PASS' && args[0]
        ? await run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', args[0],
          '--maxWorkers=1', '--no-file-parallelism',
          '--reporter=default', '--reporter=./tools/codex/local-preflight-progress-reporter.mjs'], 30_000,
          { PFM_PREFLIGHT_PROGRESS: progressPath })
        : second;
      finish(third, third === 'PASS'
        ? args[0] ? 'typecheck and selected unit passed' : 'typecheck passed'
        : third === 'TIMEOUT' ? 'bounded execution timed out; incomplete, no local retry'
          : third === 'SKIP' ? 'bounded verifier unavailable or interrupted; unverified, no local retry'
            : first === 'FAIL' || second === 'FAIL' ? 'typecheck executed and failed' : 'selected unit executed and failed');
    }
  }
}
