#!/usr/bin/env bash
set -euo pipefail

expected=""
require_clean=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --expected-head)
      expected="${2:-}"
      shift 2
      ;;
    --require-clean)
      require_clean=1
      shift
      ;;
    *)
      printf 'STATE_ERROR unknown_arg=%s\n' "$1" >&2
      exit 64
      ;;
  esac
done

head="$(git rev-parse HEAD)"
branch="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || printf DETACHED)"
upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || printf none)"
dirty="$(git status --porcelain=v1 --untracked-files=normal | awk 'NF{n++} END{print n+0}')"

ahead=na
behind=na
if [ "$upstream" != none ]; then
  counts="$(git rev-list --left-right --count "$upstream...HEAD")"
  behind="$(printf '%s' "$counts" | awk '{print $1}')"
  ahead="$(printf '%s' "$counts" | awk '{print $2}')"
fi

receipt="branch=$branch head=$head upstream=$upstream ahead=$ahead behind=$behind dirty=$dirty"

if [ -n "$expected" ] && [ "$head" != "$expected" ]; then
  printf 'STATE_MISMATCH %s expected_head=%s\n' "$receipt" "$expected" >&2
  exit 2
fi
if [ "$require_clean" -eq 1 ] && [ "$dirty" -ne 0 ]; then
  printf 'STATE_DIRTY %s\n' "$receipt" >&2
  exit 3
fi
printf 'STATE %s\n' "$receipt"
