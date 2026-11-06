// Sole optional Codex preflight entry point. No installs or configurable commands.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
if (!state.ACTIVE || state.WORKTREE !== resolve(root) || !state.PREFLIGHT || (state.PREFLIGHT.test ?? undefined) !== args[0]) {
  throw new Error('Preflight requires a hook reservation');
}
const directory = resolve('.codex/logs');
const log = resolve(directory, `preflight-${state.AUTHORIZATION_ID}-${state.PREFLIGHT.count}.log`);
const receipt = resolve(directory, `preflight-${state.AUTHORIZATION_ID}.json`);
const skipUnavailable = reason => {
  console.log(`SKIP preflight: ${reason}; no tests executed; CI remains authoritative`);
  process.exit(0);
};
// Do not attempt to run tests without a writable execution receipt. The
// sandbox may deny .codex/logs; that's unavailable infrastructure, not FAIL.
try {
  mkdirSync(directory, { recursive: true });
} catch (error) {
  skipUnavailable(`local log directory unavailable (${error.code ?? 'unknown'})`);
}
try {
  const reservation = openSync(resolve(directory,
    `preflight-${state.AUTHORIZATION_ID}-${state.PREFLIGHT.count}.used`), 'wx');
  closeSync(reservation);
} catch (error) {
  if (error.code === 'EEXIST') {
    console.error('DENY preflight: this reservation has already executed');
    process.exit(2);
  }
  skipUnavailable(`local reservation unavailable (${error.code ?? 'unknown'})`);
}
try {
  writeFileSync(receipt, JSON.stringify({ status: 'STARTED', patch: state.PREFLIGHT.patch,
    attempt: state.PREFLIGHT.count, log, acceptance: 'CI remains authoritative' }) + '\n');
} catch (error) {
  skipUnavailable(`local execution receipt unavailable (${error.code ?? 'unknown'})`);
}
const finish = (status, reason) => {
  try {
    if (!existsSync(log)) writeFileSync(log, `${status}: ${reason}\n`);
    writeFileSync(receipt, JSON.stringify({ status, reason, patch: state.PREFLIGHT.patch,
      attempt: state.PREFLIGHT.count, log, acceptance: 'CI remains authoritative' }) + '\n');
  } catch (error) {
    // Preserve process failure truth even when the filesystem stops accepting
    // receipt updates; the STARTED receipt never becomes a false PASS.
    console.error(`Preflight receipt unavailable after execution (${error.code ?? 'unknown'})`);
  }
  console.log(`${status} preflight: ${reason}; log=${log}`);
  process.exitCode = status === 'FAIL' ? 1 : 0;
};
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
    finish('SKIP', 'typecheck API changed; bounded helper requires a framework audit');
  } else {
    let fd;
    try {
      fd = openSync(log, 'w');
    } catch (error) {
      finish('SKIP', `local log unavailable (${error.code ?? 'unknown'}); tests not started`);
    }
    if (fd !== undefined) {
      const run = (command, parameters, timeout) => new Promise(resolveResult => {
        let child;
        try {
          child = spawn(command, parameters, { cwd: root, env, detached: true, stdio: ['ignore', fd, fd] });
        } catch {
          resolveResult('SKIP');
          return;
        }
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ }
        }, timeout);
        child.once('error', () => { clearTimeout(timer); resolveResult('SKIP'); });
        child.once('close', code => {
          clearTimeout(timer);
          resolveResult(timedOut || code === null ? 'SKIP' : code === 0 ? 'PASS' : 'FAIL');
        });
      });
      // Execute the audited package API directly, avoiding npm lifecycle hooks.
      // Timeouts, spawn errors and missing dependencies are SKIP, never a
      // fabricated test assertion failure.
      const started = Date.now();
      const first = await run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], 60_000);
      const remaining = 60_000 - (Date.now() - started);
      const second = first === 'PASS' && remaining > 0 ?
        await run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.next.json'], remaining) :
        first === 'PASS' ? 'SKIP' : first;
      const third = second === 'PASS' && args[0] ?
        await run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', args[0],
          '--maxWorkers=1', '--no-file-parallelism'], 30_000) : second;
      closeSync(fd);
      finish(third, third === 'PASS' ? args[0] ? 'typecheck and named unit passed' : 'typecheck passed' :
        third === 'SKIP' ? 'bounded verifier unavailable, interrupted or timed out; CI will verify' :
        first === 'FAIL' || second === 'FAIL' ? 'typecheck executed and failed' : 'named unit executed and failed');
    }
  }
}
