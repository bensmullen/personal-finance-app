import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const repository = 'bensmullen/personal-finance-app';
export const origin = `https://github.com/${repository}.git`;
const quoted = (text) => "'" + text.replaceAll("'", "'\\''") + "'";
const tool = (name) => realpathSync(execFileSync('which', [name], { encoding: 'utf8' }).trim());

// The checked-in bootstrap and read-only preflight see the real canonical URL.
// Only the disposable fixture's trusted Git transport routes fetch/ls-remote
// to its own bare repo. The production port has no test origin override.
export function disposableGit(directory) {
  const realGit = tool('git');
  const bash = tool('bash');
  const python = tool('python3');
  const git = join(directory, 'fixture-git');
  const remote = join(directory, 'remote.git');
  const checkout = join(directory, 'source');
  const env = { LC_ALL: 'C', PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const run = (cwd, ...args) => execFileSync(realGit, args, { cwd, env, encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 }).trim();
  const read = (cwd, ...args) => spawnSync(realGit, args, { cwd, env, encoding: 'utf8', timeout: 5000 });
  writeFileSync(git, `#!${bash}
for arg in "$@"; do
  case "$arg" in
    fetch|ls-remote)
      exec ${quoted(realGit)} -c ${quoted(`url.${remote}.insteadOf=${origin}`)} "$@" ;;
  esac
done
exec ${quoted(realGit)} "$@"
`, { mode: 0o700 });
  run(directory, 'init', '--bare', remote);
  run(directory, '--git-dir', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  mkdirSync(checkout);
  run(checkout, 'init', '-b', 'main');
  run(checkout, 'config', 'user.name', 'PFM Fixture');
  run(checkout, 'config', 'user.email', 'pfm@example.invalid');
  run(checkout, 'remote', 'add', 'origin', origin);
  writeFileSync(join(checkout, '.gitignore'), '.codex/runtime/\n');
  mkdirSync(join(checkout, 'src'));
  writeFileSync(join(checkout, 'src', 'primary.ts'), 'original\n');
  run(checkout, 'add', '.');
  run(checkout, 'commit', '-m', 'base');
  run(checkout, 'push', remote, 'HEAD:refs/heads/main');
  const main = run(checkout, 'rev-parse', 'HEAD');

  function invoke({ executable, argv, cwd, env: invocationEnv, timeout_ms, output_limit }, bytes) {
    return spawnSync(executable, argv, { cwd, env: invocationEnv, input: bytes, timeout: timeout_ms,
      maxBuffer: output_limit, killSignal: 'SIGKILL' });
  }

  function strict(bytes, mode, branch, target, expectedHead = '', receipt = 'absent', expectedMain = main) {
    return invoke({ executable: bash, argv: ['--noprofile', '--norc', '-s', '--', mode, branch, target],
      cwd: checkout, env: { ...env, PFM_SUPERVISOR_BOOTSTRAP: '1', PFM_RECOVERY_MAIN_SHA: expectedMain,
        PFM_SUPERVISOR_EXPECTED_HEAD: expectedHead, PFM_SUPERVISOR_RECEIPT: receipt,
        PFM_SUPERVISOR_GIT: git, PFM_SUPERVISOR_PYTHON: python }, timeout_ms: 5000, output_limit: 16 * 1024 }, bytes);
  }
  return { run, read, strict, invoke, git, realGit, bash, python, env, remote, checkout, main };
}
