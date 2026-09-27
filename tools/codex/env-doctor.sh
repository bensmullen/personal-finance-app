#!/usr/bin/env bash
set -euo pipefail

fail=0
check() {
  if ! "$@" >/dev/null 2>&1; then
    printf 'ENV_FAIL %s\n' "$*" >&2
    fail=1
  fi
}

check command -v git
check command -v node
check command -v npm
check command -v python3
if [ -z "${CI:-}" ]; then
  check command -v gh
  if command -v gh >/dev/null 2>&1 && ! gh auth status >/dev/null 2>&1; then
    printf 'ENV_FAIL GitHub CLI is not authenticated; run gh auth login and gh auth setup-git\n' >&2
    fail=1
  fi
fi

if command -v node >/dev/null 2>&1; then
  version="$(node -p 'process.versions.node' 2>/dev/null || true)"
  case "$version" in
    22.*) ;;
    *) printf 'ENV_FAIL Node 22 required; found %s\n' "${version:-unknown}" >&2; fail=1 ;;
  esac
fi
if command -v npm >/dev/null 2>&1; then
  npm_version="$(npm --version 2>/dev/null || true)"
  case "$npm_version" in
    10.*) ;;
    *) printf 'ENV_FAIL npm 10 required; found %s\n' "${npm_version:-unknown}" >&2; fail=1 ;;
  esac
fi

if [ ! -d node_modules ] || [ ! -x node_modules/.bin/tsc ]; then
  printf 'ENV_FAIL dependencies missing; configure/select the desktop Local Environment so npm ci runs before Codex\n' >&2
  fail=1
fi

origin="$(git remote get-url origin 2>/dev/null || true)"
case "$origin" in
  *bensmullen/personal-finance-app*) ;;
  "") ;;
  *) printf 'ENV_FAIL unexpected origin: %s\n' "$origin" >&2; fail=1 ;;
esac

if [ "$fail" -ne 0 ]; then
  exit 1
fi

printf 'ENV_READY node=%s npm=%s\n' "$(node -v)" "$(npm -v)"
