#!/usr/bin/env bash
set -euo pipefail

expected=""
target_branch=""
task_continuity=""
require_clean=0
require_linked=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --expected-head) expected="${2:-}"; shift 2 ;;
    --target-branch) target_branch="${2:-}"; shift 2 ;;
    --task-continuity) task_continuity="${2:-}"; shift 2 ;;
    --require-clean) require_clean=1; shift ;;
    --require-linked-worktree) require_linked=1; shift ;;
    *) printf 'STATE_ERROR unknown_arg=%s\n' "$1" >&2; exit 64 ;;
  esac
done

case "$task_continuity" in ""|new_pr|existing_pr) ;; *) printf 'STATE_ERROR reason=invalid_task_continuity\n' >&2; exit 64 ;; esac

head="$(git rev-parse HEAD)"
branch="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || printf DETACHED)"
upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || printf none)"
git_dir="$(git rev-parse --git-dir)"
common_dir="$(git rev-parse --git-common-dir)"
git_dir_abs="$(cd "$(dirname "$git_dir")" 2>/dev/null && pwd -P)/$(basename "$git_dir")"
common_dir_abs="$(cd "$(dirname "$common_dir")" 2>/dev/null && pwd -P)/$(basename "$common_dir")"
linked=no
if [ "$git_dir_abs" != "$common_dir_abs" ]; then linked=yes; fi

dirty="$(git status --porcelain=v1 --untracked-files=normal | awk 'NF{n++} END{print n+0}')"
ahead=na
behind=na
if [ "$upstream" != none ]; then
  counts="$(git rev-list --left-right --count "$upstream...HEAD")"
  behind="$(printf '%s' "$counts" | awk '{print $1}')"
  ahead="$(printf '%s' "$counts" | awk '{print $2}')"
fi
target_owner=none
if [ -n "$target_branch" ]; then
  target_owner="$(git worktree list --porcelain | awk -v target="refs/heads/$target_branch" '
    /^worktree / { p=substr($0,10) }
    /^branch / { if (substr($0,8)==target) { print p; found=1 } }
    END { if (!found) print "none" }
  ')"
fi
receipt="branch=$branch head=$head upstream=$upstream ahead=$ahead behind=$behind dirty=$dirty linked_worktree=$linked target_owner=$target_owner"

if [ -n "$expected" ] && [ "$head" != "$expected" ]; then
  printf 'STATE_MISMATCH %s expected_head=%s\n' "$receipt" "$expected" >&2
  exit 2
fi
if [ "$require_clean" -eq 1 ] && [ "$dirty" -ne 0 ]; then
  printf 'STATE_DIRTY %s\n' "$receipt" >&2
  exit 3
fi
if [ "$task_continuity" = existing_pr ] && [ -n "$target_branch" ] && [ "$branch" != "$target_branch" ]; then
  printf 'STATE_BRANCH_MISMATCH %s target_branch=%s\n' "$receipt" "$target_branch" >&2
  exit 4
fi
if [ "$require_linked" -eq 1 ] && [ "$linked" != yes ]; then
  printf 'STATE_WORKTREE_REQUIRED %s\n' "$receipt" >&2
  exit 5
fi
printf 'STATE %s\n' "$receipt"
