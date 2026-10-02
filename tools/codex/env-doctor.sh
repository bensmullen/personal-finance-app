#!/usr/bin/env bash
set -euo pipefail

mode="implementation"
case "${1:-}" in
  "") ;;
  --verification) mode="verification" ;;
  --publication) mode="publication" ;;
  --all) mode="all" ;;
  *) printf 'ENV_FAIL unknown mode: %s\n' "$1" >&2; exit 64 ;;
esac

fail=0
check() {
  if ! "$@" >/dev/null 2>&1; then
    printf 'ENV_FAIL %s\n' "$*" >&2
    fail=1
  fi
}

check command -v git
check command -v python3

origin="$(git remote get-url origin 2>/dev/null || true)"
case "$origin" in
  *bensmullen/personal-finance-app*) ;;
  "") ;;
  *) printf 'ENV_FAIL unexpected origin: %s\n' "$origin" >&2; fail=1 ;;
esac

if [ "$mode" = verification ] || [ "$mode" = all ]; then
  check command -v node
  check command -v npm
  if command -v node >/dev/null 2>&1; then
    version="$(node -p 'process.versions.node' 2>/dev/null || true)"
    case "$version" in
      22.*) ;;
      *) printf 'ENV_FAIL Node 22 required for local verification; found %s\n' "${version:-unknown}" >&2; fail=1 ;;
    esac
  fi
  if command -v npm >/dev/null 2>&1; then
    npm_version="$(npm --version 2>/dev/null || true)"
    case "$npm_version" in
      10.*) ;;
      *) printf 'ENV_FAIL npm 10 required for local verification; found %s\n' "${npm_version:-unknown}" >&2; fail=1 ;;
    esac
  fi
  if [ ! -d node_modules ] || [ ! -x node_modules/.bin/tsc ]; then
    printf 'ENV_FAIL local verification dependencies are not installed\n' >&2
    fail=1
  fi
fi

if [ "$mode" = publication ] || [ "$mode" = all ]; then
  check command -v gh
  if command -v gh >/dev/null 2>&1 && ! gh auth status >/dev/null 2>&1; then
    printf 'ENV_FAIL GitHub CLI is not authenticated\n' >&2
    fail=1
  fi
fi

if [ "$fail" -ne 0 ]; then
  exit 1
fi

printf 'ENV_READY mode=%s\n' "$mode"
