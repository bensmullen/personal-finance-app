#!/usr/bin/env bash
set -euo pipefail

add_path() {
  if [ -d "$1" ]; then
    PATH="$1:$PATH"
  fi
}

for dir in \
  /opt/homebrew/bin \
  /opt/homebrew/sbin \
  /usr/local/bin \
  /usr/local/sbin \
  "$HOME/.volta/bin" \
  "$HOME/.asdf/shims" \
  "$HOME/.local/share/mise/shims" \
  "$HOME/.local/bin"
do
  add_path "$dir"
done

for dir in "$HOME"/.nvm/versions/node/v22*/bin; do
  [ -d "$dir" ] && add_path "$dir"
done
for dir in "$HOME"/Library/Application\ Support/fnm/node-versions/v22*/installation/bin; do
  [ -d "$dir" ] && add_path "$dir"
done

export PATH

if ! command -v node >/dev/null 2>&1; then
  printf 'ENV_SETUP_FAIL Node 22 is not installed or discoverable in common local paths.\n' >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  printf 'ENV_SETUP_FAIL npm 10 is not installed or discoverable in common local paths.\n' >&2
  exit 1
fi

node_version="$(node -p 'process.versions.node' 2>/dev/null || true)"
npm_version="$(npm --version 2>/dev/null || true)"
case "$node_version" in
  22.*) ;;
  *) printf 'ENV_SETUP_FAIL Node 22 required; found %s\n' "${node_version:-unknown}" >&2; exit 1 ;;
esac
case "$npm_version" in
  10.*) ;;
  *) printf 'ENV_SETUP_FAIL npm 10 required; found %s\n' "${npm_version:-unknown}" >&2; exit 1 ;;
esac

npm ci --prefer-offline --no-audit --no-fund
printf 'ENV_SETUP_READY node=%s npm=%s\n' "$node_version" "$npm_version"
