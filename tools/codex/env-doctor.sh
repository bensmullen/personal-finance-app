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

if command -v node >/dev/null 2>&1; then
  version="$(node -p 'process.versions.node' 2>/dev/null || true)"
  case "$version" in
    22.*) ;;
    *) printf 'ENV_FAIL Node 22 required; found %s\n' "${version:-unknown}" >&2; fail=1 ;;
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
