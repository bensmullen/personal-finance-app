import { lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, normalize } from 'node:path';
import { performance } from 'node:perf_hooks';
import { sha256 } from '../authorization.mjs';
import { canonicalJson, digest } from '../contracts.mjs';
import { requireResource, resourceAttest, resourceRef, resourceTime } from '../resources.mjs';
import { inspectWorkspace, readBoundedFile, resolveScopedPaths, sha } from '../workspace.mjs';

const outputLimit = 16 * 1024;
const hash = /^[a-f0-9]{64}$/;
const decoder = new TextDecoder('utf-8', { fatal: true });

export function exactFields(value, fields, code) {
  const copy = JSON.parse(canonicalJson(value));
  requireResource(copy !== null && !Array.isArray(copy) && typeof copy === 'object'
    && Object.keys(copy).length === fields.length && fields.every((field) => Object.hasOwn(copy, field)), code);
  return copy;
}

export function approvedPath(path) {
  requireResource(typeof path === 'string' && path.length <= 500 && isAbsolute(path) && normalize(path) === path
    && path !== '/' && !path.endsWith('/') && /^[A-Za-z0-9_/ .-]+$/.test(path), 'SUPERVISOR_PATH');
  return path;
}

export function preparationHead(request) {
  return request.mode === 'new' ? request.expected_main : request.expected_head;
}

export function parseBootstrapOutput(stdout, request, receipt) {
  requireResource(Buffer.isBuffer(stdout) && stdout.length <= outputLimit, 'BOOTSTRAP_OUTPUT_BOUND');
  const text = decoder.decode(stdout);
  requireResource(text.endsWith('\n') && !/[^\x20-\x7e\n]/.test(text), 'BOOTSTRAP_OUTPUT_FORMAT');
  const lines = text.split('\n');
  requireResource(!lines.some((line) => /^PR_BOOTSTRAP_(?:FAIL|EXIT)|^PREFLIGHT_OK/.test(line)), 'BOOTSTRAP_OUTPUT_IDENTITY');
  const expected = [
    ['PR_WORKTREE_READY', `PR_WORKTREE_READY mode=${request.mode} path=${request.target} branch=${request.branch} head=${preparationHead(request)} origin_main=${request.expected_main}`],
    ['PR_TASK_RECEIPT', `PR_TASK_RECEIPT status=${receipt} path=${request.target}`],
    ['OPEN THIS EXACT WORKTREE IN CODEX', `OPEN THIS EXACT WORKTREE IN CODEX: ${request.target}`],
  ];
  let previous = -1;
  for (const [prefix, line] of expected) {
    const matches = lines.flatMap((candidate, index) => candidate.startsWith(prefix) ? [index] : []);
    requireResource(matches.length === 1 && matches[0] > previous && lines[matches[0]] === line, 'BOOTSTRAP_OUTPUT_IDENTITY');
    previous = matches[0];
  }
  return sha256(stdout);
}

// No ambient subprocess fallback. The independently installed host port owns
// private Git/config/credential isolation, process limits and group cleanup.
// It executes exactly this immutable stdin + argv envelope, or rejects it.
export function createBootstrapHost({ verify, clock, operator }) {
  function inspect(request, paths, taskKind, phase, gate) {
    requireResource(operator && typeof operator.observeGit === 'function', 'BOOTSTRAP_HOST_UNAVAILABLE');
    const snapshot = operator.observeGit(request, phase);
    resourceRef(snapshot.evidence);
    resourceAttest(verify, 'supervised_git_observation', { request, phase, snapshot, gate });
    requireResource(snapshot.main === request.expected_main && snapshot.remote_head === request.expected_head
      && snapshot.repository === request.repository && snapshot.checkout === request.checkout
      && snapshot.target === request.target && snapshot.branch === request.branch
      && snapshot.environment === request.environment && snapshot.host_id === request.host_id, 'BOOTSTRAP_GIT_IDENTITY');
    approvedPath(snapshot.git);
    requireResource(realpathSync(request.checkout) === request.checkout
      && realpathSync(dirname(request.target)) === dirname(request.target)
      && realpathSync(snapshot.git) === snapshot.git, 'BOOTSTRAP_HOST_PATH');
    const stat = lstatSync(request.target, { throwIfNoEntry: false });
    if (phase === 'before' && !stat) {
      requireResource(snapshot.local_head === null && snapshot.owner_path === null
        && snapshot.registered_target === false, 'BOOTSTRAP_EXISTING_BRANCH');
      return { snapshot, workspace: null };
    }
    requireResource((phase !== 'before' || request.mode === 'resume') && stat?.isDirectory()
      && snapshot.owner_path === request.target && snapshot.registered_target === true
      && sha.test(snapshot.local_head), 'BOOTSTRAP_TARGET_OWNERSHIP');
    const base = phase === 'before' ? snapshot.local_head : preparationHead(request);
    const workspace = inspectWorkspace({ directory: request.target, git: snapshot.git, environment: request.environment,
      repository: request.repository, base, verify });
    const upstream = request.mode === 'resume' ? `origin/${request.branch}` : null;
    requireResource(workspace.branch === request.branch && workspace.head === snapshot.local_head
      && workspace.linked && !workspace.dirty && !workspace.conflicted
      && (phase === 'before' || (workspace.head === base && workspace.upstream === upstream
        && workspace.upstream_head === request.expected_head))
      && (phase === 'before' || workspace.paths.length === 0), 'BOOTSTRAP_PREFLIGHT');
    const receipt = workspace.receipt;
    requireResource(['absent', 'closed'].includes(receipt.status), 'BOOTSTRAP_EXISTING_WRITER');
    requireResource(phase !== 'before' || workspace.upstream === null || workspace.upstream === upstream,
      'BOOTSTRAP_FOREIGN_UPSTREAM');
    if (receipt.status === 'closed') {
      resourceAttest(verify, 'bootstrap_stopped_published_owner', { request, snapshot, workspace, gate });
    }
    resolveScopedPaths(request.target, paths, taskKind);
    return { snapshot, workspace };
  }

  function run({ request, intent, before, allowance, gate }) {
    requireResource(operator && typeof operator.readMergedBootstrap === 'function'
      && typeof operator.runIsolated === 'function', 'BOOTSTRAP_HOST_UNAVAILABLE');
    const { path, bash, git, python, evidence } = operator.readMergedBootstrap(request);
    resourceRef(evidence);
    for (const executable of [bash, git, python]) {
      approvedPath(executable);
      requireResource(realpathSync(executable) === executable, 'BOOTSTRAP_TOOL_IDENTITY');
    }
    requireResource(git === before.snapshot.git, 'BOOTSTRAP_TOOL_IDENTITY');
    approvedPath(path);
    requireResource(realpathSync(path) === path, 'BOOTSTRAP_PIN_PATH');
    const bytes = readBoundedFile(path, 64 * 1024);
    requireResource(sha256(bytes) === request.bootstrap_digest, 'BOOTSTRAP_PIN_DIGEST');
    resourceAttest(verify, 'merged_supervised_bootstrap', { path, bash, git, python, evidence,
      revision: request.bootstrap_revision, digest: request.bootstrap_digest, host_id: request.host_id });
    const now = resourceTime(clock());
    const timeout = Math.min(allowance.execution_ms, resourceTime(request.expires_at) - now,
      resourceTime(allowance.cleanup_deadline) - now - allowance.cleanup_ms);
    requireResource(timeout > 0, 'BOOTSTRAP_DEADLINE');
    const invocation = {
      effect_id: intent.effect_id, executable: bash, argv: ['--noprofile', '--norc', '-s', '--', request.mode, request.branch, request.target],
      cwd: request.checkout, stdin_digest: request.bootstrap_digest, output_limit: outputLimit, timeout_ms: timeout,
      cleanup_ms: allowance.cleanup_ms,
      env: { LC_ALL: 'C', PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', PFM_SUPERVISOR_BOOTSTRAP: '1',
        PFM_RECOVERY_MAIN_SHA: request.expected_main, PFM_SUPERVISOR_EXPECTED_HEAD: request.expected_head ?? '',
        PFM_SUPERVISOR_GIT: git, PFM_SUPERVISOR_PYTHON: python,
        PFM_SUPERVISOR_RECEIPT: before.workspace?.receipt.digest ?? 'absent' },
    };
    resourceAttest(verify, 'bootstrap_isolated_dispatch', { request, intent, invocation, allowance, gate, evidence });
    const start = performance.now();
    const result = operator.runIsolated(JSON.parse(canonicalJson(invocation)), bytes);
    requireResource(result && Buffer.isBuffer(result.stdout) && Buffer.isBuffer(result.stderr)
      && result.stdout.length <= outputLimit && result.stderr.length <= outputLimit, 'BOOTSTRAP_OUTPUT_BOUND');
    resourceRef(result.terminal);
    const output = { stdout: sha256(result.stdout), stderr: sha256(result.stderr) };
    resourceAttest(verify, 'bootstrap_group_terminal', { invocation, allowance, output, terminal: result.terminal,
      exit_code: result.exit_code, timed_out: result.timed_out });
    requireResource(result.exit_code === 0 && result.timed_out === false && performance.now() - start <= timeout, 'BOOTSTRAP_TERMINAL');
    return { stdout: Buffer.from(result.stdout), terminal: result.terminal, invocation_digest: digest(invocation) };
  }

  return Object.freeze({ inspect, run });
}
