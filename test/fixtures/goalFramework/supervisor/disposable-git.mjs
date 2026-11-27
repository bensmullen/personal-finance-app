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
  const hookBin = join(directory, 'hook-bin');
  const remote = join(directory, 'remote.git');
  const checkout = join(directory, 'source');
  const env = { LC_ALL: 'C', PATH: '/usr/bin:/bin', HOME: directory, GIT_ALLOW_PROTOCOL: 'file',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' };
  const run = (cwd, ...args) => execFileSync(realGit, args, { cwd, env, encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 }).trim();
  const read = (cwd, ...args) => spawnSync(realGit, args, { cwd, env, encoding: 'utf8', timeout: 5000 });
  writeFileSync(git, `#!${bash}
export GIT_ALLOW_PROTOCOL=file
for arg in "$@"; do
  case "$arg" in
    fetch)
      if [ -n "${'$'}{PFM_FIXTURE_DIRTY_AFTER_FETCH:-}" ]; then
        ${quoted(realGit)} -c ${quoted(`url.${remote}.insteadOf=${origin}`)} "$@" || exit $?
        printf 'fixture drift\n' > "$PFM_FIXTURE_DIRTY_AFTER_FETCH"
        exit $?
      fi
      exec ${quoted(realGit)} -c ${quoted(`url.${remote}.insteadOf=${origin}`)} "$@" ;;
    ls-remote)
      exec ${quoted(realGit)} -c ${quoted(`url.${remote}.insteadOf=${origin}`)} "$@" ;;
  esac
done
exec ${quoted(realGit)} "$@"
`, { mode: 0o700 });
  mkdirSync(hookBin);
  writeFileSync(join(hookBin, 'git'), `#!${bash}
export GIT_ALLOW_PROTOCOL=file
if [ "$1" = ls-remote ]; then
  if [ "$#" = 4 ] && [ "$2" = --exit-code ] && [ "$3" = origin ] &&
      [[ "$4" =~ ^refs/heads/(codex|agent)/[A-Za-z0-9_./-]+$ ]]; then
    exec ${quoted(realGit)} -c ${quoted(`url.${remote}.insteadOf=${origin}`)} "$@"
  fi
  exit 126
fi
case "$1" in
  --no-optional-locks) [ "$2" = status ] || exit 126 ;;
  rev-parse|symbolic-ref|status|diff|diff-tree|ls-files|show|log|merge-base|worktree)
    if [ "$1" = worktree ] && [ "$2" != list ]; then exit 126; fi ;;
  remote) [ "$2" = get-url ] || exit 126 ;;
  *) exit 126 ;;
esac
exec ${quoted(realGit)} "$@"
`, { mode: 0o700 });
  const hookEnv = { ...env, PATH: hookBin + ':/usr/bin:/bin' };
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
    return spawnSync(executable, argv, { cwd, env: { ...invocationEnv, HOME: directory, GIT_ALLOW_PROTOCOL: 'file' }, input: bytes, timeout: timeout_ms,
      maxBuffer: output_limit, killSignal: 'SIGKILL' });
  }

  function strict(bytes, mode, branch, target, expectedHead = '', receipt = 'absent', expectedMain = main, fetchDriftFile = '') {
    const local = read(checkout, 'rev-parse', '--verify', `refs/heads/${branch}`);
    return invoke({ executable: bash, argv: ['--noprofile', '--norc', '-s', '--', mode, branch, target],
      cwd: checkout, env: { ...env, PFM_SUPERVISOR_BOOTSTRAP: '1', PFM_RECOVERY_MAIN_SHA: expectedMain,
        PFM_SUPERVISOR_EXPECTED_HEAD: expectedHead, PFM_SUPERVISOR_RECEIPT: receipt,
        PFM_SUPERVISOR_LOCAL_HEAD: local.status === 0 ? local.stdout.trim() : 'absent',
        PFM_SUPERVISOR_GIT: git, PFM_SUPERVISOR_PYTHON: python, PFM_FIXTURE_DIRTY_AFTER_FETCH: fetchDriftFile },
      timeout_ms: 5000, output_limit: 16 * 1024 }, bytes);
  }
  return { run, read, strict, invoke, git, realGit, bash, python, env, hookEnv, remote, checkout, main };
}

// Simulates independent host authority across journal reopens. It never
// derives the current witness from the journal bytes supplied by the caller.
export function journalWitness(digest) {
  let bound = null;
  let current = null;
  let commitFault = null;
  return {
    read: () => current,
    commit(identity, expected, next, lock) {
      const binding = digest(identity);
      if (!lock || (bound !== null && bound !== binding) || digest(expected) !== digest(current)
          || next.generation !== (current?.generation ?? 0) + 1) throw new Error('fixture current-state conflict');
      if (commitFault === 'before') throw new Error('fixture durability unconfirmed');
      bound = binding;
      current = Object.freeze({ ...next });
      if (commitFault === 'after') throw new Error('fixture lost commit acknowledgement');
    },
    verify({ identity, current: observed, lock }) {
      return Boolean(lock && (bound === null || bound === digest(identity)) && digest(observed) === digest(current));
    },
    fault: (phase) => { commitFault = phase; },
  };
}
