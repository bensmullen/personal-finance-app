#!/usr/bin/env bash
set -euo pipefail
# Unexpected failures must never look like a successful bootstrap.
# Preserve explicit PR_BOOTSTRAP_FAIL diagnostics while also reporting the
# nonzero exit when a command or pipeline fails without a message.
trap 'status=$?; if [ "$status" -ne 0 ]; then printf "PR_BOOTSTRAP_EXIT status=%s line=%s; no PR_WORKTREE_READY; preserve existing work and receipts\n" "$status" "$LINENO" >&2; fi' EXIT

usage() {
  cat >&2 <<'EOF'
usage:
  tools/codex/bootstrap-pr.sh new <codex/...|agent/...> [worktree-path]
  tools/codex/bootstrap-pr.sh resume <codex/...|agent/...> [worktree-path]

new:
  fetches origin, resolves the current origin/main SHA, safely clears only a stale
  unpublished local branch with no unique commits, then creates a linked worktree
  with the feature branch already checked out at that exact remote base.

resume:
  fetches origin, finds the remote feature branch, and reuses or creates a clean
  linked worktree. It fast-forwards a clean behind branch but never discards
  unpushed or divergent local commits.
EOF
  exit 64
}

[ "$#" -ge 2 ] && [ "$#" -le 3 ] || usage
mode="$1"
branch="$2"
target_arg="${3:-}"
supervised="${PFM_SUPERVISOR_BOOTSTRAP:-0}"

supervised_fail() {
  printf 'PR_BOOTSTRAP_FAIL supervised %s\n' "$1" >&2
  exit 1
}

if [ "$supervised" = 1 ]; then
  case "$target_arg" in /*) ;; *) supervised_fail 'explicit absolute target required' ;; esac
  case "${PFM_SUPERVISOR_GIT:-}" in /*) ;; *) supervised_fail 'pinned Git required' ;; esac
  case "${PFM_SUPERVISOR_PYTHON:-}" in /*) ;; *) supervised_fail 'pinned Python required' ;; esac
  [[ "${PFM_RECOVERY_MAIN_SHA:-}" =~ ^[a-f0-9]{40}$ ]] || supervised_fail 'main pin required'
  [[ "${PFM_SUPERVISOR_RECEIPT:-}" =~ ^(absent|[a-f0-9]{64})$ ]] || supervised_fail 'receipt pin required'
  [ -z "${PFM_RECOVERY_HEAD:-}" ] && [ "${PFM_BOOTSTRAP_TEST_ALLOW_ANY_ORIGIN:-0}" = 0 ] ||
    supervised_fail 'incompatible recovery or test environment'
  git() {
    "$PFM_SUPERVISOR_GIT" -c core.hooksPath=/dev/null -c core.fsmonitor=false -c core.untrackedCache=false "$@"
  }
fi

case "$mode" in
  new|resume) ;;
  *) usage ;;
esac

case "$branch" in
  codex/*|agent/*) ;;
  *) printf 'PR_BOOTSTRAP_FAIL invalid approved branch: %s\n' "$branch" >&2; exit 64 ;;
esac

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
  printf 'PR_BOOTSTRAP_FAIL not inside a Git repository\n' >&2
  exit 1
fi
cd "$root"

origin="$(git remote get-url origin 2>/dev/null || true)"
if [ "${PFM_BOOTSTRAP_TEST_ALLOW_ANY_ORIGIN:-0}" != "1" ]; then
  case "$origin" in
    https://github.com/bensmullen/personal-finance-app|https://github.com/bensmullen/personal-finance-app.git|git@github.com:bensmullen/personal-finance-app.git|ssh://git@github.com:bensmullen/personal-finance-app.git) ;;
    *) printf 'PR_BOOTSTRAP_FAIL origin is not bensmullen/personal-finance-app: %s\n' "${origin:-missing}" >&2; exit 1 ;;
  esac
fi

repo_name="$(basename "$root")"
slug="$(printf '%s' "$branch" | tr '/.' '--' | tr -cd 'A-Za-z0-9_-')"
if [ -n "$target_arg" ]; then
  target="$target_arg"
else
  target="$(dirname "$root")/${repo_name}-${slug}"
fi

case "$target" in
  /*) target_abs="$target" ;;
  *)
    target_parent="$(dirname "$target")"
    [ -d "$target_parent" ] || { printf 'PR_BOOTSTRAP_FAIL target parent does not exist: %s\n' "$target_parent" >&2; exit 1; }
    target_abs="$(cd "$target_parent" && pwd -P)/$(basename "$target")"
    ;;
esac

root_abs="$(cd "$root" && pwd -P)"
if [ "$target_abs" = "$root_abs" ]; then
  printf 'PR_BOOTSTRAP_FAIL target worktree is the current/source checkout\n' >&2
  exit 1
fi

printf 'PR_BOOTSTRAP_FETCH origin=%s\n' "$origin"
remote_main="refs/remotes/origin/main"
if [ "$supervised" != 1 ]; then
  git fetch --prune origin
  if ! git show-ref --verify --quiet "$remote_main"; then
    printf 'PR_BOOTSTRAP_FAIL origin/main is unavailable after fetch\n' >&2
    exit 1
  fi
  origin_main="$(git rev-parse "$remote_main")"
  if [ -n "${PFM_RECOVERY_MAIN_SHA:-}" ] && [ "$origin_main" != "$PFM_RECOVERY_MAIN_SHA" ]; then
    printf 'PR_BOOTSTRAP_FAIL origin/main changed during recovery\n' >&2
    exit 1
  fi
fi

branch_owner() {
  # Do not exit awk early: with pipefail, an upstream git worktree producer
  # may receive SIGPIPE (141) before finishing and terminate bootstrap silently.
  git worktree list --porcelain | awk -v target="refs/heads/$branch" '
    /^worktree / { p=substr($0,10) }
    /^branch / { if (substr($0,8)==target && !found) { print p; found=1 } }
  '
}

registered_at_target() {
  # Likewise consume the complete porcelain stream before returning.
  git worktree list --porcelain | awk -v target="$target_abs" '
    /^worktree / { p=substr($0,10) }
    /^$/ {
      if (p==target && !found) { print p; found=1 }
      p=""
    }
    END { if (!found && p==target) print p }
  '
}

prepare_target_path() {
  local registered current_branch
  registered="$(registered_at_target)"
  if [ -n "${PFM_RECOVERY_HEAD:-}" ] && { [ -n "$registered" ] || [ -e "$target_abs" ]; }; then
    printf 'PR_BOOTSTRAP_FAIL recovery target already exists: %s\n' "$target_abs" >&2
    exit 1
  fi
  if [ -n "$registered" ]; then
    if [ "$(receipt_status "$registered")" != absent ]; then
      printf 'PR_BOOTSTRAP_FAIL target worktree has task receipt evidence: %s\n' "$registered" >&2
      exit 1
    fi
    if [ -n "$(git -C "$registered" status --porcelain=v1 --untracked-files=normal)" ]; then
      printf 'PR_BOOTSTRAP_FAIL existing target worktree is dirty: %s\n' "$registered" >&2
      exit 1
    fi
    current_branch="$(git -C "$registered" branch --show-current)"
    if [ -n "$current_branch" ]; then
      printf 'PR_BOOTSTRAP_FAIL existing target worktree owns branch %s: %s\n' "$current_branch" "$registered" >&2
      exit 1
    fi
    git worktree remove "$registered"
  elif [ -e "$target_abs" ]; then
    printf 'PR_BOOTSTRAP_FAIL target path exists but is not a registered worktree: %s\n' "$target_abs" >&2
    exit 1
  fi
  git worktree prune
}

receipt_status() {
  local worktree="$1" pointer="$1/.codex/runtime/latest-task.json" status
  status=absent
  if [ -d "${pointer%/*}" ]; then
    status=malformed-or-tampered
    if command -v python3 >/dev/null 2>&1; then
      status="$(python3 - "$worktree" "$branch" <<'PY' || printf 'malformed-or-tampered'
import hashlib
import json
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
pointer = root / '.codex/runtime/latest-task.json'

if not pointer.exists() and not pointer.is_symlink():
    for candidate in pointer.parent.glob('*.json'):
        try:
            state = json.loads(candidate.read_bytes())
            if state.get('ACTIVE') is True or state.get('PREPARED') is True:
                print('malformed-or-tampered')
                break
        except (OSError, ValueError, AttributeError):
            continue
    else:
        print('absent')
    sys.exit(0)

try:
    receipt = json.loads(pointer.read_bytes())
    name = receipt['path']
    state_path = pointer.parent / name
    if pointer.is_symlink() or Path(name).name != name or state_path == pointer or state_path.is_symlink():
        raise ValueError()
    data = state_path.read_bytes()
    state = json.loads(data)
    if (hashlib.sha256(data).hexdigest() != receipt['sha256'] or
            state.get('WORKTREE') != str(root) or state.get('TARGET_BRANCH') != sys.argv[2] or
            type(state.get('ACTIVE')) is not bool or
            not isinstance(state.get('AUTHORIZATION_ID'), str) or
            not isinstance(state.get('SESSION_ID'), str) or
            type(state.get('PREPARED', False)) is not bool or
            (state['ACTIVE'] and state.get('PREPARED'))):
        raise ValueError()
    print('active-foreign-writer' if state['ACTIVE'] else
          'prepared-non-owning' if state.get('PREPARED') else 'closed')
except (OSError, ValueError, TypeError, KeyError, AttributeError):
    print('malformed-or-tampered')
PY
)"
    else
      status=unverified-python-unavailable
    fi
  fi
  printf '%s' "$status"
}

verify_ready() {
  local path="$1"
  local expected="$2"
  local actual actual_branch dirty git_dir common_dir upstream expected_upstream expected_ref preflight
  actual="$(git -C "$path" rev-parse HEAD)"
  actual_branch="$(git -C "$path" branch --show-current)"
  dirty="$(git -C "$path" status --porcelain=v1 --untracked-files=normal)"
  git_dir="$(git -C "$path" rev-parse --git-dir)"
  common_dir="$(git -C "$path" rev-parse --git-common-dir)"
  upstream="$(git -C "$path" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
  expected_upstream=""
  expected_ref="origin/main"
  if [ "$mode" = "resume" ]; then
    expected_upstream="origin/$branch"
    expected_ref="$expected_upstream"
  fi

  if [ "$actual" != "$expected" ] || [ "$actual_branch" != "$branch" ] || [ -n "$dirty" ] || [ "$git_dir" = "$common_dir" ] || [ "$upstream" != "$expected_upstream" ]; then
    printf 'PR_BOOTSTRAP_FAIL postcondition path=%s branch=%s head=%s dirty=%s\n' \
      "$path" "${actual_branch:-DETACHED}" "$actual" "${dirty:+yes}" >&2
    exit 1
  fi
  local verified_receipt
  if [ "$supervised" = 1 ]; then
    verified_receipt="$(supervised_receipt "$path")"
    supervised_remote
  else
    verified_receipt="$(receipt_status "$path")"
  fi
  printf 'PR_WORKTREE_READY mode=%s path=%s branch=%s head=%s origin_main=%s\n' \
    "$mode" "$path" "$actual_branch" "$actual" "$origin_main"
  printf 'PR_TASK_RECEIPT status=%s path=%s\n' "$verified_receipt" "$path"
  printf '\nOPEN THIS EXACT WORKTREE IN CODEX: %s\n' "$path"
  printf 'Git readiness does not grant receipt ownership or change the folder selected in Codex. Run this read-only preflight from its terminal before submitting TARGET_BRANCH=%s:\n' "$branch"
  preflight='test "$(pwd -P)" = "$(cd -- "$1" && pwd -P)" && test "$(git rev-parse --show-toplevel)" = "$(pwd -P)" && test "$(git branch --show-current)" = "$2" && test "$(git rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>/dev/null || true)" = "$3" && test "$(git rev-parse HEAD)" = "$(git rev-parse "$4")" && test -z "$(git status --porcelain=v1 --untracked-files=normal)" && printf "PREFLIGHT_OK path=%s branch=%s\n" "$(pwd -P)" "$2"'
  printf 'bash -c %q -- %q %q %q %q\n' "$preflight" "$path" "$branch" "$expected_upstream" "$expected_ref"
}

supervised_receipt() {
  "$PFM_SUPERVISOR_PYTHON" -I -B - "$1" "$branch" "$PFM_SUPERVISOR_RECEIPT" <<'PY'
import hashlib
import json
import os
import re
import stat
import sys
from pathlib import Path

root, branch, expected = sys.argv[1:]

def read(path, limit):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as file:
        info = os.fstat(file.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > limit:
            raise ValueError()
        data = file.read(limit + 1)
        if len(data) != info.st_size:
            raise ValueError()
        return data

def unique(pairs):
    obj = dict(pairs)
    if len(obj) != len(pairs):
        raise ValueError()
    return obj

def receipt():
    directory = Path(root)
    for name in ('.codex', 'runtime'):
        directory /= name
        if not os.path.lexists(directory):
            if expected == 'absent':
                return 'absent'
            raise ValueError()
        if not stat.S_ISDIR(directory.lstat().st_mode):
            raise ValueError()
    pointer = directory / 'latest-task.json'
    if expected == 'absent':
        with os.scandir(directory) as entries:
            if any(entry.name != 'policy.lock' for entry in entries):
                raise ValueError()
        return 'absent'
    raw = read(pointer, 1024)
    ref = json.loads(raw, object_pairs_hook=unique)
    name = ref['path']
    if not re.fullmatch(r'[A-Za-z0-9_.-]{1,200}\.json', name) or name == pointer.name:
        raise ValueError()
    data = read(directory / name, 512 * 1024)
    state = json.loads(data, object_pairs_hook=unique)
    if (hashlib.sha256(data).hexdigest() != expected or ref['sha256'] != expected or
            state.get('WORKTREE') != root or state.get('TARGET_BRANCH') != branch or
            state.get('ACTIVE') is not False or state.get('PREPARED', False) is not False or
            not all(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}', state.get(k, ''))
                    for k in ('SESSION_ID', 'AUTHORIZATION_ID')) or read(pointer, 1024) != raw):
        raise ValueError()
    return 'closed'

try:
    print(receipt())
except (OSError, ValueError, TypeError, KeyError, AttributeError, RecursionError):
    sys.exit('PR_BOOTSTRAP_FAIL supervised receipt changed or is ambiguous')
PY
}

supervised_remote() {
  local refs expected
  refs="$(git ls-remote --refs --sort=refname origin refs/heads/main "refs/heads/$branch")"
  expected="$(printf '%s\trefs/heads/main' "$origin_main")"
  if [ "$mode" = resume ]; then
    expected="$(printf '%s\trefs/heads/%s\n%s\n' "$remote_head" "$branch" "$expected")"
  fi
  [ "$refs" = "$expected" ] || supervised_fail 'live remote refs changed'
}

supervised_bootstrap() {
  local owner registered local_ref local_head clean git_dir upstream worktrees keys key
  remote_target="refs/remotes/origin/$branch"
  remote_head="${PFM_SUPERVISOR_EXPECTED_HEAD:-}"
  origin_main="$PFM_RECOVERY_MAIN_SHA"
  [[ "$target_abs" =~ ^/[a-zA-Z0-9_./\ -]+$ ]] &&
    [ "$(cd -- "$(dirname -- "$target_abs")" && pwd -P)/$(basename -- "$target_abs")" = "$target_abs" ] &&
    [ "$target_abs" != "$root_abs" ] && [ ! -L "$target_abs" ] ||
    supervised_fail 'target path alias'
  case "$target_abs/" in "$root_abs/"*) supervised_fail 'target inside the source checkout' ;; esac
  git check-ref-format "refs/heads/$branch" || supervised_fail 'invalid branch'
  [ "$(git remote get-url --all origin)" = "$origin" ] &&
    [ "$(git remote get-url --push --all origin)" = "$origin" ] || supervised_fail 'ambiguous origin'
  # The host independently attests inherited config, executable identities, and
  # isolation. Refuse repository helpers, filters, includes, rewrites or custom
  # transports here as well. The command-line safety overrides above are fixed.
  keys="$(git config --no-includes --local --name-only --list)"
  while IFS= read -r key; do
    case "$key" in
      core.repositoryformatversion|core.filemode|core.bare|core.logallrefupdates|core.ignorecase|core.precomposeunicode|core.symlinks|\
      user.name|user.email|remote.origin.url|remote.origin.fetch|branch.*.remote|branch.*.merge) ;;
      *) supervised_fail 'repository Git configuration outside strict allowlist' ;;
    esac
  done <<< "$keys"
  [ "$(git config --local --get-all remote.origin.fetch)" = '+refs/heads/*:refs/remotes/origin/*' ] ||
    supervised_fail 'unexpected origin ref mapping'

  owner="$(branch_owner)"
  registered="$(registered_at_target)"
  local_ref="refs/heads/$branch"
  if [ "$mode" = new ]; then
    [ -z "$remote_head" ] && [ "$PFM_SUPERVISOR_RECEIPT" = absent ] && [ -z "$owner" ] &&
      [ -z "$registered" ] && [ ! -e "$target_abs" ] &&
      ! git show-ref --verify --quiet "$local_ref" &&
      ! git show-ref --verify --quiet "$remote_target" ||
      supervised_fail 'new branch, worktree or target already exists'
  else
    [[ "$remote_head" =~ ^[a-f0-9]{40}$ ]] || supervised_fail 'resume head pin required'
    if [ -z "$owner" ]; then
      [ -z "$registered" ] && [ ! -e "$target_abs" ] && [ "$PFM_SUPERVISOR_RECEIPT" = absent ] &&
        ! git show-ref --verify --quiet "$local_ref" || supervised_fail 'unowned branch or target needs operator'
    else
      [ "$owner" = "$target_abs" ] && [ "$registered" = "$target_abs" ] ||
        supervised_fail 'worktree at wrong target'
      worktrees="$(git worktree list --porcelain)"
      awk -v path="$target_abs" -v ref="$local_ref" '
        /^worktree / { target=substr($0,10)==path; paths+=target }
        /^branch / { if (substr($0,8)==ref) branches++ }
        /^(locked|prunable)( |$)/ { if (target) unsafe=1 }
        END { exit !(paths==1 && branches==1 && !unsafe) }
      ' <<< "$worktrees" || supervised_fail 'ambiguous or locked worktree'
      [ "$(git -C "$owner" rev-parse --show-toplevel)" = "$owner" ] &&
        [ "$(git -C "$owner" symbolic-ref HEAD)" = "$local_ref" ] || supervised_fail 'worktree identity'
      git_dir="$(git -C "$owner" rev-parse --absolute-git-dir)"
      for name in MERGE_HEAD rebase-merge rebase-apply CHERRY_PICK_HEAD REVERT_HEAD sequencer BISECT_LOG AUTO_MERGE index.lock; do
        [ ! -e "$git_dir/$name" ] && [ ! -L "$git_dir/$name" ] || supervised_fail 'worktree operation in progress'
      done
      clean="$(git -C "$owner" status --porcelain=v1 --untracked-files=all --ignore-submodules=none)"
      [ -z "$clean" ] || supervised_fail 'dirty target'
      upstream="$(git -C "$owner" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
      [ -z "$upstream" ] || [ "$upstream" = "origin/$branch" ] || supervised_fail 'foreign upstream'
      supervised_receipt "$owner" >/dev/null
      local_head="$(git -C "$owner" rev-parse HEAD)"
    fi
  fi

  supervised_remote
  local specs=("+refs/heads/main:$remote_main")
  if [ "$mode" = resume ]; then specs+=("+refs/heads/$branch:$remote_target"); fi
  git fetch --no-prune --no-tags --no-recurse-submodules --no-auto-gc origin "${specs[@]}"
  [ "$(git rev-parse "$remote_main")" = "$origin_main" ] || supervised_fail 'fetched main changed'
  if [ "$mode" = resume ]; then
    [ "$(git rev-parse "$remote_target")" = "$remote_head" ] || supervised_fail 'fetched branch changed'
    if [ -n "$owner" ]; then
      git merge-base --is-ancestor "$local_head" "$remote_head" || supervised_fail 'unpublished or divergent branch'
      supervised_receipt "$owner" >/dev/null
    fi
  fi
  supervised_remote
  if [ "$mode" = new ]; then
    git worktree add --no-track -b "$branch" "$target_abs" "$origin_main"
    verify_ready "$target_abs" "$origin_main"
  else
    if [ -n "$owner" ]; then
      [ "$(git -C "$owner" rev-parse HEAD)" = "$local_head" ] || supervised_fail 'local head changed'
      if [ "$local_head" != "$remote_head" ]; then
        git -C "$owner" -c merge.autostash=false merge --ff-only "$remote_head" >/dev/null
      fi
      git -C "$owner" branch --set-upstream-to="origin/$branch" "$branch" >/dev/null
    else
      git worktree add --track -b "$branch" "$target_abs" "$remote_target"
    fi
    verify_ready "$target_abs" "$remote_head"
  fi
}

if [ "$supervised" = 1 ]; then
  supervised_bootstrap
  exit 0
fi

if [ "$mode" = "new" ]; then
  remote_target="refs/remotes/origin/$branch"
  if git show-ref --verify --quiet "$remote_target"; then
    printf 'PR_BOOTSTRAP_FAIL remote branch already exists: %s head=%s; use resume or choose a new branch\n' \
      "$branch" "$(git rev-parse "$remote_target")" >&2
    exit 1
  fi

  owner="$(branch_owner)"
  if git show-ref --verify --quiet "refs/heads/$branch"; then
    local_head="$(git rev-parse "refs/heads/$branch")"
    if ! git merge-base --is-ancestor "$local_head" "$origin_main"; then
      printf 'PR_BOOTSTRAP_FAIL local branch has unpublished work: %s head=%s\n' "$branch" "$local_head" >&2
      exit 1
    fi
    if [ -n "$owner" ]; then
      if [ "$owner" = "$root_abs" ]; then
        printf 'PR_BOOTSTRAP_FAIL source checkout currently owns stale target branch %s; switch the source checkout deliberately first\n' "$branch" >&2
        exit 1
      fi
      if [ -n "$(git -C "$owner" status --porcelain=v1 --untracked-files=normal)" ]; then
        printf 'PR_BOOTSTRAP_FAIL stale branch worktree is dirty: %s\n' "$owner" >&2
        exit 1
      fi
      if [ "$(receipt_status "$owner")" != absent ]; then
        printf 'PR_BOOTSTRAP_FAIL stale branch worktree has task receipt evidence: %s\n' "$owner" >&2
        exit 1
      fi
      git worktree remove "$owner"
    fi
    git branch -D "$branch" >/dev/null
    printf 'PR_BOOTSTRAP_CLEANED stale_local_branch=%s old_head=%s\n' "$branch" "$local_head"
  fi

  prepare_target_path
  # --no-track: default Git autoSetupMerge may otherwise bind a new task branch to origin/main.
  git worktree add --no-track -b "$branch" "$target_abs" "$origin_main"
  verify_ready "$target_abs" "$origin_main"
  exit 0
fi

remote_target="refs/remotes/origin/$branch"
remote_tracking="origin/$branch"
if ! git show-ref --verify --quiet "$remote_target"; then
  printf 'PR_BOOTSTRAP_FAIL remote branch does not exist: %s\n' "$branch" >&2
  exit 1
fi
remote_head="$(git rev-parse "$remote_target")"
owner="$(branch_owner)"
if [ -n "${PFM_RECOVERY_HEAD:-}" ]; then
  if [ "$remote_head" != "$PFM_RECOVERY_HEAD" ] ||
     [ "$(git ls-remote --heads origin "refs/heads/$branch")" != "$(printf '%s\trefs/heads/%s' "$PFM_RECOVERY_HEAD" "$branch")" ]; then
    printf 'PR_BOOTSTRAP_FAIL recovery branch changed during bootstrap\n' >&2
    exit 1
  fi
  if [ -n "$owner" ] && { [ "$(git -C "$owner" rev-parse HEAD)" != "$PFM_RECOVERY_HEAD" ] ||
                           [ "$(receipt_status "$owner")" != absent ] ||
                           { [ -n "$target_arg" ] && [ "$owner" != "$target_abs" ]; }; }; then
    printf 'PR_BOOTSTRAP_FAIL existing recovery worktree is not the requested receipt-free checkpoint: %s\n' "$owner" >&2
    exit 1
  fi
fi

if [ -n "$owner" ]; then
  owner_receipt="$(receipt_status "$owner")"
  if [ -n "$(git -C "$owner" status --porcelain=v1 --untracked-files=normal)" ]; then
    printf 'PR_BOOTSTRAP_FAIL existing branch worktree is dirty: %s\n' "$owner" >&2
    exit 1
  fi
  local_head="$(git -C "$owner" rev-parse HEAD)"
  if [ "$local_head" = "$remote_head" ]; then
    case "$owner_receipt" in
      absent|closed) git -C "$owner" branch --set-upstream-to="$remote_tracking" "$branch" >/dev/null ;;
    esac
    verify_ready "$owner" "$remote_head"
    exit 0
  fi
  if git merge-base --is-ancestor "$local_head" "$remote_head"; then
    case "$owner_receipt" in
      absent|closed) ;;
      *)
        printf 'PR_BOOTSTRAP_FAIL fast-forward needs receipt ownership diagnosis: path=%s status=%s\n' "$owner" "$owner_receipt" >&2
        exit 1 ;;
    esac
    git -C "$owner" merge --ff-only "$remote_target" >/dev/null
    git -C "$owner" branch --set-upstream-to="$remote_tracking" "$branch" >/dev/null
    verify_ready "$owner" "$remote_head"
    exit 0
  fi
  if git merge-base --is-ancestor "$remote_head" "$local_head"; then
    printf 'PR_BOOTSTRAP_FAIL existing worktree has unpushed local commits: %s local=%s remote=%s\n' "$owner" "$local_head" "$remote_head" >&2
    exit 1
  fi
  printf 'PR_BOOTSTRAP_FAIL local and remote branch diverged: %s local=%s remote=%s\n' "$branch" "$local_head" "$remote_head" >&2
  exit 1
fi

if git show-ref --verify --quiet "refs/heads/$branch"; then
  local_head="$(git rev-parse "refs/heads/$branch")"
  if [ "$local_head" != "$remote_head" ]; then
    if git merge-base --is-ancestor "$local_head" "$remote_head"; then
      git branch -f "$branch" "$remote_tracking" >/dev/null
    elif git merge-base --is-ancestor "$remote_head" "$local_head"; then
      printf 'PR_BOOTSTRAP_FAIL local branch has unpushed commits: %s local=%s remote=%s\n' "$branch" "$local_head" "$remote_head" >&2
      exit 1
    else
      printf 'PR_BOOTSTRAP_FAIL local and remote branch diverged: %s local=%s remote=%s\n' "$branch" "$local_head" "$remote_head" >&2
      exit 1
    fi
  fi
else
  git branch --track "$branch" "$remote_tracking" >/dev/null
fi
git branch --set-upstream-to="$remote_tracking" "$branch" >/dev/null

prepare_target_path
git worktree add "$target_abs" "$branch"
verify_ready "$target_abs" "$remote_head"
