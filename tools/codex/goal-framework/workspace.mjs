import { spawnSync } from 'node:child_process';
import { closeSync, constants, fstatSync, lstatSync, opendirSync, openSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { digest, validatePath, validateRecord } from './contracts.mjs';
import { sha256 } from './authorization.mjs';
import { requireResource, resourceAttest, resourceRef } from './resources.mjs';

export const sha = /^[a-f0-9]{40}$/;
export const identifier = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
const pathOutputLimit = 128 * 1024;
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export function readBoundedFile(path, limit) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = fstatSync(fd);
    requireResource(info.isFile() && info.size <= limit, 'FILE_BOUND');
    const buffer = Buffer.alloc(info.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const count = readSync(fd, buffer, offset, buffer.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    requireResource(offset === info.size, 'FILE_CHANGED');
    return buffer.subarray(0, offset);
  } finally {
    closeSync(fd);
  }
}

function stat(path) {
  return lstatSync(path, { throwIfNoEntry: false });
}

function receiptAt(directory, branch) {
  const codex = join(directory, '.codex');
  if (!stat(codex)) return { status: 'absent' };
  requireResource(stat(codex)?.isDirectory(), 'WORKTREE_RECEIPT_PATH');
  const runtime = join(codex, 'runtime');
  if (!stat(runtime)) return { status: 'absent' };
  requireResource(stat(runtime)?.isDirectory(), 'WORKTREE_RECEIPT_PATH');
  const latest = join(runtime, 'latest-task.json');
  // A missing pointer beside runtime state is ambiguous. A lock file alone is
  // routine, but an interrupted pointer replacement requires operator diagnosis.
  if (!stat(latest)) {
    const entries = openDirBounded(runtime);
    requireResource(entries.every((entry) => entry === 'policy.lock'), 'WORKTREE_RECEIPT_MISSING');
    return { status: 'absent' };
  }
  const pointerBytes = readBoundedFile(latest, 1024);
  const pointer = JSON.parse(textDecoder.decode(pointerBytes));
  requireResource(typeof pointer.path === 'string' && /^[A-Za-z0-9_.-]{1,200}\.json$/.test(pointer.path)
    && pointer.path !== 'latest-task.json', 'WORKTREE_RECEIPT_POINTER');
  const bytes = readBoundedFile(join(runtime, pointer.path), 512 * 1024);
  requireResource(sha256(bytes) === pointer.sha256, 'WORKTREE_RECEIPT_DIGEST');
  const receipt = JSON.parse(textDecoder.decode(bytes));
  requireResource(receipt.WORKTREE === directory && receipt.TARGET_BRANCH === branch
    && typeof receipt.ACTIVE === 'boolean' && [undefined, false, true].includes(receipt.PREPARED)
    && !(receipt.ACTIVE && receipt.PREPARED) && identifier.test(receipt.AUTHORIZATION_ID ?? '')
    && identifier.test(receipt.SESSION_ID ?? ''), 'WORKTREE_RECEIPT_IDENTITY');
  requireResource(readBoundedFile(latest, 1024).equals(pointerBytes), 'WORKTREE_RECEIPT_CHANGED');
  return { status: receipt.ACTIVE ? 'active' : receipt.PREPARED ? 'prepared' : 'closed',
    owner: receipt.SESSION_ID, authorization_id: receipt.AUTHORIZATION_ID, digest: pointer.sha256,
    issue: receipt.TASK_ISSUE?.number ?? null, body_digest: receipt.TASK_ISSUE?.sha256 ?? null };
}

// Runtime directories have only small, regular receipt histories. Check one
// directory incrementally so an oversized directory cannot amplify a read.
function openDirBounded(directory) {
  const handle = opendirSync(directory);
  const entries = [];
  try {
    for (let entry = handle.readSync(); entry !== null; entry = handle.readSync()) {
      requireResource(entries.length < 256, 'WORKTREE_RECEIPT_BOUND');
      entries.push(entry.name);
    }
    return entries;
  } finally {
    handle.closeSync();
  }
}

function gitReader(git, directory) {
  return (args, allowedExit = [0], input = '') => {
    const result = spawnSync(git, ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
      '-C', directory, ...args], {
      env: { LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
      input, timeout: 1000, killSignal: 'SIGKILL', maxBuffer: pathOutputLimit,
    });
    requireResource(!result.error && allowedExit.includes(result.status), 'WORKTREE_GIT_READ');
    return result.status === 0 ? textDecoder.decode(result.stdout) : '';
  };
}

export function resolveScopedPaths(directory, paths, taskKind) {
  requireResource(isAbsolute(directory) && realpathSync(directory) === directory, 'WORKTREE_ROOT');
  for (const path of paths) {
    validatePath(path, { taskKind });
    const lower = path.toLowerCase();
    requireResource(!/^\.codex\/logs(?:\/|$)/.test(lower), 'PROTECTED_RUNTIME_PATH');
    requireResource(taskKind === 'framework' || !/^(?:test\/goalframework|test\/fixtures\/goalframework\/|test\/goalissuemetadata\.|test\/milestoneissueregister\.|tools\/roadmap\/|docs\/development\/milestone-issue-)/.test(lower), 'FRAMEWORK_SCOPE');
    let current = directory;
    const parts = path.split('/');
    for (let index = 0; index < parts.length; index++) {
      current = join(current, parts[index]);
      const info = stat(current);
      if (!info) break;
      const typeMatches = index === parts.length - 1 ? info.isFile() && info.nlink === 1 : info.isDirectory();
      requireResource(typeMatches && realpathSync(current) === current, 'WORKTREE_PATH_ALIAS');
    }
  }
}

// Git observation is local and read-only. The host separately attests actual
// provider refs, worktree/bootstrap evidence and runtime ownership.
function originAliases(repository) {
  return [`https://github.com/${repository}`, `https://github.com/${repository}.git`,
    `git@github.com:${repository}.git`, `ssh://git@github.com/${repository}.git`];
}

export function inspectWorkspace({ directory, git, environment, repository, base, additionalPaths = [], verify }) {
  requireResource(isAbsolute(directory) && realpathSync(directory) === directory && isAbsolute(git)
    && identifier.test(environment ?? '') && /^[a-z0-9-]+\/[a-z0-9_.-]+$/.test(repository)
    && sha.test(base) && Array.isArray(additionalPaths) && additionalPaths.length <= 256, 'WORKTREE_INPUT');
  resourceAttest(verify, 'readonly_git_environment', { directory, git, environment, repository });
  const read = gitReader(git, directory);
  const get = (args, exits) => read(args, exits).trimEnd();
  requireResource(get(['rev-parse', '--show-toplevel']) === directory, 'WORKTREE_ROOT');
  const branch = get(['symbolic-ref', '-q', '--short', 'HEAD'], [0, 1]);
  requireResource(/^(codex|agent)\/[A-Za-z0-9._/-]{1,190}$/.test(branch), 'WORKTREE_BRANCH');
  const head = get(['rev-parse', '--verify', 'HEAD']);
  const origin = get(['remote', 'get-url', '--all', 'origin']);
  requireResource(originAliases(repository).includes(origin)
    && origin === get(['remote', 'get-url', '--push', '--all', 'origin']), 'WORKTREE_ORIGIN');
  const upstream = get(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], [0, 128]) || null;
  const upstreamHead = upstream ? get(['rev-parse', '--verify', '@{u}']) : null;
  const gitDir = get(['rev-parse', '--absolute-git-dir']);
  const common = get(['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const linked = gitDir !== common;
  read(['merge-base', '--is-ancestor', base, head]);
  const conflicted = ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'sequencer',
    'BISECT_LOG', 'AUTO_MERGE', 'index.lock'].some((name) => stat(join(gitDir, name))) || read(['ls-files', '-u', '-z']) !== '';
  const dirty = read(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none']) !== '';
  // Include paths from earlier task commits even if later commits revert them.
  const commits = get(['rev-list', '--max-count=129', `${base}..${head}`]).split('\n').filter(Boolean);
  requireResource(commits.length <= 128 && commits.every((commit) => sha.test(commit)), 'WORKTREE_HISTORY_BOUND');
  const raw = commits.length === 0 ? '' : read(['diff-tree', '--stdin', '--no-commit-id', '--no-renames',
    '--raw', '-r', '-m', '-z'], [0], commits.join('\n') + '\n');
  const history = raw === '' ? [] : raw.split('\0').slice(0, -1);
  const historicalPaths = [];
  const unusual = new Set();
  requireResource((raw === '' || raw.endsWith('\0')) && history.length % 2 === 0, 'WORKTREE_HISTORY_FORMAT');
  for (let index = 0; index < history.length; index += 2) {
    const modes = /^:([0-7]{6}) ([0-7]{6}) [a-f0-9]+ [a-f0-9]+ [A-Z]$/.exec(history[index]);
    requireResource(modes !== null, 'WORKTREE_HISTORY_FORMAT');
    const path = history[index + 1];
    historicalPaths.push(path);
    if (modes.slice(1, 3).some((mode) => ['120000', '160000'].includes(mode))) unusual.add(path);
  }
  const pathLists = [
    read(['diff', '--no-ext-diff', '--no-renames', '--name-only', '-z', '--']),
    read(['diff', '--no-ext-diff', '--no-renames', '--name-only', '-z', '--cached', '--']),
    read(['ls-files', '--others', '--exclude-standard', '-z']),
  ];
  const paths = [...new Set([...historicalPaths, ...pathLists.flatMap((list) => list.split('\0').filter(Boolean)), ...additionalPaths])].sort();
  requireResource(paths.length <= 256, 'WORKTREE_CHANGED_PATHS');
  for (const path of paths) validatePath(path, { write: false });
  const ancestry = new Set(paths.flatMap((path) => path.split('/').map((_, index, parts) => parts.slice(0, index + 1).join('/'))));
  const pathspecs = [...new Set(paths.map((path) => path.split('/')[0]))];
  const modes = pathspecs.length === 0 ? [] : [read(['ls-files', '--stage', '-z', '--', ...pathspecs]),
    read(['ls-tree', '-r', '-z', base, '--', ...pathspecs]), read(['ls-tree', '-r', '-z', head, '--', ...pathspecs])];
  for (const list of modes) {
    for (const entry of list.split('\0')) {
      const tab = entry.indexOf('\t');
      if (tab > 0 && /^(120000|160000) /.test(entry)) unusual.add(entry.slice(tab + 1));
    }
  }
  requireResource([...ancestry].every((path) => !unusual.has(path)), 'WORKTREE_CHANGED_PATHS');
  requireResource(get(['rev-parse', '--verify', 'HEAD']) === head && get(['symbolic-ref', '-q', '--short', 'HEAD'], [0, 1]) === branch,
    'WORKTREE_CHANGED_DURING_READ');
  return { directory, environment, branch, head, origin, upstream, upstream_head: upstreamHead, linked, conflicted, dirty,
    paths, base, receipt: receiptAt(directory, branch) };
}

export function reviewWorkspace(workspace, observation, remote, identity, { verify, phase, paths, taskKind }) {
  const receipt = validateRecord(workspace, 'WORKSPACE_RECEIPT_V1');
  const { repository, task_issue, body_digest, branch, head_sha } = identity;
  const { directory, environment } = receipt;
  resourceRef(receipt.ready_proof);
  requireResource(receipt.repository === repository && receipt.origin_repository === repository
    && receipt.task_issue === task_issue && receipt.issue_body_digest === body_digest && receipt.branch === branch
    && receipt.head_sha === head_sha && receipt.state === 'ready' && directory === observation.directory
    && environment === observation.environment && receipt.upstream_head_sha === observation.upstream_head
    && observation.branch === branch && observation.head === head_sha && observation.linked === true
    && observation.dirty === false && observation.conflicted === false && originAliases(repository).includes(observation.origin), 'WORKSPACE_IDENTITY');
  requireResource(['checkpoint', 'unpublished-stop'].includes(phase) || observation.base === head_sha, 'WORKSPACE_BASELINE');
  resourceRef(remote.evidence);
  requireResource(remote.repository === repository && remote.branch === branch, 'REMOTE_IDENTITY');
  const published = remote.head === head_sha && observation.upstream === `origin/${branch}`
    && observation.upstream_head === head_sha;
  const fresh = ['prepare', 'claim', 'unpublished-stop'].includes(phase)
    && remote.head === null && remote.base === head_sha && observation.upstream === null
    && observation.upstream_head === null;
  requireResource(published || fresh, 'UNSHARED_CHECKPOINT');
  const owner = observation.receipt;
  const sameIssue = owner.issue === task_issue && owner.body_digest === body_digest;
  requireResource(phase === 'claim' ? owner.status === 'prepared' && sameIssue && owner.owner === receipt.receipt_owner
    : ['checkpoint', 'unpublished-stop'].includes(phase) ? owner.status === 'closed' && sameIssue
      : ['absent', 'prepared', 'closed'].includes(owner.status), 'WORKSPACE_WRITER');
  resourceAttest(verify, 'observed_workspace_and_remote', { identity, receipt, observation, remote, phase });
  requireResource(observation.paths.every((path) => paths.includes(path)), 'WORKSPACE_SCOPE');
  resolveScopedPaths(directory, paths, taskKind);
  return { reference: { id: receipt.id, digest: digest(receipt) }, ready_proof: receipt.ready_proof,
    environment, directory, owner: receipt.receipt_owner, origin: observation.origin, branch, head_sha,
    upstream: observation.upstream, upstream_head: observation.upstream_head, clean: true, receipt_status: owner.status,
    receipt_digest: owner.digest ?? null, authorization_id: owner.authorization_id ?? null };
}
