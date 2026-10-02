#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  printf 'usage: %s <worktree-path> [expected-head]\n' "$0" >&2
  exit 64
fi

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
  printf 'WORKTREE_PREP_FAIL not inside a Git repository\n' >&2
  exit 1
fi
cd "$root"

if [ -n "$(git status --porcelain=v1 --untracked-files=normal)" ]; then
  printf 'WORKTREE_PREP_FAIL source checkout is dirty\n' >&2
  exit 1
fi

target="$1"
expected="${2:-$(git rev-parse HEAD)}"
if ! git cat-file -e "$expected^{commit}" 2>/dev/null; then
  printf 'WORKTREE_PREP_FAIL expected commit does not exist: %s\n' "$expected" >&2
  exit 1
fi

case "$target" in
  /*) target_abs="$target" ;;
  *) target_abs="$(cd "$(dirname "$target")" 2>/dev/null && pwd -P)/$(basename "$target")" ;;
esac

root_abs="$(cd "$root" && pwd -P)"
if [ "$target_abs" = "$root_abs" ]; then
  printf 'WORKTREE_PREP_FAIL target worktree is the current/source checkout; run this helper from another stable checkout\n' >&2
  exit 1
fi

registered=""
while IFS= read -r line; do
  case "$line" in
    "worktree "*) current="${line#worktree }" ;;
    "")
      if [ "${current:-}" = "$target_abs" ]; then registered="$current"; break; fi
      current=""
      ;;
  esac
done < <(git worktree list --porcelain; printf '\n')

if [ -n "$registered" ]; then
  if [ -n "$(git -C "$registered" status --porcelain=v1 --untracked-files=normal)" ]; then
    printf 'WORKTREE_PREP_FAIL existing worktree is dirty: %s\n' "$registered" >&2
    exit 1
  fi
  existing_branch="$(git -C "$registered" branch --show-current)"
  if [ -n "$existing_branch" ]; then
    printf 'WORKTREE_PREP_FAIL existing worktree owns branch %s; remove it deliberately instead of replacing it\n' "$existing_branch" >&2
    exit 1
  fi
  git worktree remove "$registered"
elif [ -e "$target_abs" ]; then
  printf 'WORKTREE_PREP_FAIL path exists but is not a registered worktree: %s\n' "$target_abs" >&2
  exit 1
fi

git worktree prune
git worktree add --detach "$target_abs" "$expected"

actual="$(git -C "$target_abs" rev-parse HEAD)"
branch="$(git -C "$target_abs" branch --show-current)"
dirty="$(git -C "$target_abs" status --porcelain=v1 --untracked-files=normal)"

if [ "$actual" != "$expected" ] || [ -n "$branch" ] || [ -n "$dirty" ]; then
  printf 'WORKTREE_PREP_FAIL postcondition mismatch path=%s head=%s branch=%s\n' "$target_abs" "$actual" "${branch:-DETACHED}" >&2
  exit 1
fi

printf 'WORKTREE_READY path=%s head=%s branch=DETACHED\n' "$target_abs" "$actual"
