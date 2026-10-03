#!/usr/bin/env bash
set -euo pipefail

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
git fetch --prune origin

remote_main="refs/remotes/origin/main"
if ! git show-ref --verify --quiet "$remote_main"; then
  printf 'PR_BOOTSTRAP_FAIL origin/main is unavailable after fetch\n' >&2
  exit 1
fi
origin_main="$(git rev-parse "$remote_main")"

branch_owner() {
  git worktree list --porcelain | awk -v target="refs/heads/$branch" '
    /^worktree / { p=substr($0,10) }
    /^branch / { if (substr($0,8)==target) { print p; exit } }
  '
}

registered_at_target() {
  git worktree list --porcelain | awk -v target="$target_abs" '
    /^worktree / { p=substr($0,10) }
    /^branch / { b=substr($0,8) }
    /^$/ {
      if (p==target) { print p; found=1; exit }
      p=""; b=""
    }
    END { if (!found && p==target) print p }
  '
}

prepare_target_path() {
  local registered current_branch
  registered="$(registered_at_target)"
  if [ -n "$registered" ]; then
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

verify_ready() {
  local path="$1"
  local expected="$2"
  local actual actual_branch dirty git_dir common_dir
  actual="$(git -C "$path" rev-parse HEAD)"
  actual_branch="$(git -C "$path" branch --show-current)"
  dirty="$(git -C "$path" status --porcelain=v1 --untracked-files=normal)"
  git_dir="$(git -C "$path" rev-parse --git-dir)"
  common_dir="$(git -C "$path" rev-parse --git-common-dir)"

  if [ "$actual" != "$expected" ] || [ "$actual_branch" != "$branch" ] || [ -n "$dirty" ] || [ "$git_dir" = "$common_dir" ]; then
    printf 'PR_BOOTSTRAP_FAIL postcondition path=%s branch=%s head=%s dirty=%s\n' \
      "$path" "${actual_branch:-DETACHED}" "$actual" "${dirty:+yes}" >&2
    exit 1
  fi
  printf 'PR_WORKTREE_READY mode=%s path=%s branch=%s head=%s origin_main=%s\n' \
    "$mode" "$path" "$actual_branch" "$actual" "$origin_main"
}

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
      git worktree remove "$owner"
    fi
    git branch -D "$branch" >/dev/null
    printf 'PR_BOOTSTRAP_CLEANED stale_local_branch=%s old_head=%s\n' "$branch" "$local_head"
  fi

  prepare_target_path
  git worktree add -b "$branch" "$target_abs" "$origin_main"
  verify_ready "$target_abs" "$origin_main"
  exit 0
fi

remote_target="refs/remotes/origin/$branch"
if ! git show-ref --verify --quiet "$remote_target"; then
  printf 'PR_BOOTSTRAP_FAIL remote branch does not exist: %s\n' "$branch" >&2
  exit 1
fi
remote_head="$(git rev-parse "$remote_target")"
owner="$(branch_owner)"

if [ -n "$owner" ]; then
  git -C "$owner" branch --set-upstream-to="$remote_target" "$branch" >/dev/null 2>&1 || true
  if [ -n "$(git -C "$owner" status --porcelain=v1 --untracked-files=normal)" ]; then
    printf 'PR_BOOTSTRAP_FAIL existing branch worktree is dirty: %s\n' "$owner" >&2
    exit 1
  fi
  local_head="$(git -C "$owner" rev-parse HEAD)"
  if [ "$local_head" = "$remote_head" ]; then
    verify_ready "$owner" "$remote_head"
    exit 0
  fi
  if git merge-base --is-ancestor "$local_head" "$remote_head"; then
    git -C "$owner" merge --ff-only "$remote_target" >/dev/null
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
      git branch -f "$branch" "$remote_target" >/dev/null
    elif git merge-base --is-ancestor "$remote_head" "$local_head"; then
      printf 'PR_BOOTSTRAP_FAIL local branch has unpushed commits: %s local=%s remote=%s\n' "$branch" "$local_head" "$remote_head" >&2
      exit 1
    else
      printf 'PR_BOOTSTRAP_FAIL local and remote branch diverged: %s local=%s remote=%s\n' "$branch" "$local_head" "$remote_head" >&2
      exit 1
    fi
  fi
else
  git branch --track "$branch" "$remote_target" >/dev/null
fi
git branch --set-upstream-to="$remote_target" "$branch" >/dev/null

prepare_target_path
git worktree add "$target_abs" "$branch"
verify_ready "$target_abs" "$remote_head"
