#!/usr/bin/env bash
# Operator-only crash recovery: preserve a clean local WIP checkpoint and
# continue from a DIFFERENT feature branch/worktree, never the orphaned receipt.
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: PFM_CRASH_RECOVERY_CONFIRMED=1 PFM_CRASH_RECOVERY_ISSUE=<issue-number> \
  bash tools/codex/recover-interrupted-task.sh \
  <interrupted-worktree> <interrupted-branch> <recovery-branch> <expected-checkpoint-SHA> [recovery-worktree]

First close/stop the old Codex writer (or confirm its process ended after a crash).
Run from the canonical checkout OUTSIDE any Codex task, after verifying the
task issue authorizes the recovery branch. This does not modify task receipts.
EOF
  exit 64
}
[ "$#" -ge 4 ] && [ "$#" -le 5 ] || usage
[ "${PFM_CRASH_RECOVERY_CONFIRMED:-}" = 1 ] || {
  echo "CRASH_RECOVERY_FAIL confirm the old Codex writer has stopped; set PFM_CRASH_RECOVERY_CONFIRMED=1" >&2
  exit 1
}
old_dir="$1"
old_branch="$2"
new_branch="$3"
expected="$4"
target="${5:-}"
issue="${PFM_CRASH_RECOVERY_ISSUE:-}"
case "$issue" in
  ''|*[!0-9]*) echo "CRASH_RECOVERY_FAIL set PFM_CRASH_RECOVERY_ISSUE to the original issue number" >&2; exit 64 ;;
esac
case "$old_branch:$new_branch" in
  codex/*:codex/*|codex/*:agent/*|agent/*:codex/*|agent/*:agent/*) ;;
  *) echo "CRASH_RECOVERY_FAIL both branches must be codex/* or agent/*" >&2; exit 64 ;;
esac
[ "$old_branch" != "$new_branch" ] || {
  echo "CRASH_RECOVERY_FAIL recovery MUST use a distinct branch" >&2; exit 1
}
git check-ref-format "refs/heads/$old_branch" && git check-ref-format "refs/heads/$new_branch" || usage
case "$expected" in
  *[!0-9a-fA-F]*|"") echo "CRASH_RECOVERY_FAIL expected SHA must be hexadecimal" >&2; exit 64 ;;
esac
[ "${#expected}" -ge 7 ] || { echo "CRASH_RECOVERY_FAIL expected SHA is too short" >&2; exit 64; }

canonical="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "CRASH_RECOVERY_FAIL run from the canonical Git checkout" >&2; exit 1
}
canonical="$(cd "$canonical" && pwd -P)"
old_dir="$(cd "$old_dir" 2>/dev/null && pwd -P)" || {
  echo "CRASH_RECOVERY_FAIL interrupted worktree not found" >&2; exit 1
}
[ "$old_dir" != "$canonical" ] || { echo "CRASH_RECOVERY_FAIL source must be a separate task worktree" >&2; exit 1; }
[ "$(git -C "$old_dir" rev-parse --show-toplevel 2>/dev/null)" = "$old_dir" ] || {
  echo "CRASH_RECOVERY_FAIL source is not its own Git worktree root" >&2; exit 1
}
[ "$(git -C "$old_dir" rev-parse --path-format=absolute --git-common-dir)" = "$(git -C "$canonical" rev-parse --path-format=absolute --git-common-dir)" ] || {
  echo "CRASH_RECOVERY_FAIL source is not linked to the canonical checkout" >&2; exit 1
}
[ "$(git -C "$old_dir" branch --show-current)" = "$old_branch" ] || {
  echo "CRASH_RECOVERY_FAIL interrupted worktree branch mismatch" >&2; exit 1
}
# Only the exact previously reported checkpoint may be published. A WIP commit
# is not an implementation-completion claim.
head="$(git -C "$old_dir" rev-parse --verify HEAD)"
resolved="$(git -C "$old_dir" rev-parse --verify "${expected}^{commit}" 2>/dev/null)" || {
  echo "CRASH_RECOVERY_FAIL expected checkpoint SHA does not resolve" >&2; exit 1
}
[ "$head" = "$resolved" ] || {
  echo "CRASH_RECOVERY_FAIL interrupted worktree changed since reported checkpoint" >&2; exit 1
}
[ -z "$(git -C "$old_dir" status --porcelain=v1 --untracked-files=all)" ] || {
  echo "CRASH_RECOVERY_FAIL interrupted worktree is dirty; preserve and diagnose before publication" >&2; exit 1
}

old_origin="$(git -C "$old_dir" remote get-url origin 2>/dev/null || true)"
canonical_origin="$(git -C "$canonical" remote get-url origin 2>/dev/null || true)"
[ -n "$old_origin" ] && [ "$canonical_origin" = "$old_origin" ] || {
  echo "CRASH_RECOVERY_FAIL checkout and old worktree do not share the expected origin" >&2; exit 1
}
if [ "${PFM_BOOTSTRAP_TEST_ALLOW_ANY_ORIGIN:-0}" != 1 ]; then
  case "$old_origin" in
    https://github.com/bensmullen/personal-finance-app|https://github.com/bensmullen/personal-finance-app.git|git@github.com:bensmullen/personal-finance-app.git|ssh://git@github.com/bensmullen/personal-finance-app.git) ;;
    *) echo "CRASH_RECOVERY_FAIL unexpected origin repository" >&2; exit 1 ;;
  esac
fi
push_urls="$(git -C "$old_dir" remote get-url --push --all origin 2>/dev/null)"
[ "$push_urls" = "$old_origin" ] || {
  echo "CRASH_RECOVERY_FAIL push destination is not exactly the verified origin" >&2; exit 1
}
tracking="$(git -C "$old_dir" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
[ -z "$tracking" ] || [ "$tracking" = "origin/$old_branch" ] || {
  echo "CRASH_RECOVERY_FAIL unexpected upstream; preserve state" >&2; exit 1
}
remote_head() {
  local line
  line="$(git -C "$old_dir" ls-remote --heads origin "refs/heads/$1")" || {
    echo "CRASH_RECOVERY_FAIL cannot verify remote branch $1" >&2; exit 1
  }
  if [ -n "$line" ]; then
    [ "$(printf '%s\n' "$line" | wc -l | tr -d ' ')" = 1 ] || {
      echo "CRASH_RECOVERY_FAIL ambiguous remote branch $1" >&2; exit 1
    }
    printf '%s\n' "${line%%[[:space:]]*}"
  fi
}
for ref in "$old_branch" "$new_branch"; do
  actual="$(remote_head "$ref")"
  [ -z "$actual" ] || [ "$actual" = "$head" ] || {
    echo "CRASH_RECOVERY_FAIL $ref already has different remote history; no push performed" >&2; exit 1
  }
done

# Use only pinned objects from the verified remote, independent of checkout age.
export GIT_NO_REPLACE_OBJECTS=1
git -C "$canonical" fetch --no-tags origin refs/heads/main:refs/remotes/origin/main
main="$(git -C "$canonical" rev-parse --verify refs/remotes/origin/main)"
if [ -n "${PFM_RECOVERY_MAIN_SHA:-}" ] && [ "$main" != "$PFM_RECOVERY_MAIN_SHA" ]; then
  echo "CRASH_RECOVERY_FAIL origin/main changed since the recovery entry was verified" >&2
  exit 1
fi
tmp="$(mktemp -d "${TMPDIR:-/tmp}/pfm-crash-recovery.XXXXXXXX")"
trap 'rm -rf -- "$tmp"' EXIT
extract_helper() {
  local entry="$1" destination="$2" blob
  blob="$(git -C "$canonical" rev-parse --verify "$main:$entry")" &&
    [ "$(git -C "$canonical" cat-file -t "$blob")" = blob ] &&
    git -C "$canonical" cat-file blob "$blob" > "$destination" &&
    [ "$(git -C "$canonical" hash-object --no-filters "$destination")" = "$blob" ] || {
      echo "CRASH_RECOVERY_FAIL cannot verify origin/main helper $entry" >&2; exit 1
    }
}
extract_helper tools/codex/bootstrap-pr.sh "$tmp/bootstrap-pr.sh"
extract_helper .codex/hooks/pfm-policy.py "$tmp/pfm-policy.py"
verify_issue() {
  python3 "$tmp/pfm-policy.py" --recovery-issue "$old_dir" "$old_branch" "$new_branch" "$issue"
}
issue_sha="$(verify_issue)"
case "$issue_sha" in
  ''|*[!0-9a-f]*) echo "CRASH_RECOVERY_FAIL trusted policy did not verify the issue" >&2; exit 1 ;;
esac
[ "${#issue_sha}" = 64 ] || { echo "CRASH_RECOVERY_FAIL invalid issue digest" >&2; exit 1; }
verify_source() {
  [ "$(git -C "$old_dir" branch --show-current)" = "$old_branch" ] &&
    [ "$(git -C "$old_dir" rev-parse HEAD)" = "$head" ] &&
    [ -z "$(git -C "$old_dir" status --porcelain=v1 --untracked-files=all)" ] &&
    [ "$(git -C "$old_dir" remote get-url origin)" = "$old_origin" ] &&
    [ "$(git -C "$canonical" remote get-url origin)" = "$old_origin" ] &&
    [ "$(git -C "$old_dir" remote get-url --push --all origin)" = "$old_origin" ] &&
    [ "$(remote_head main)" = "$main" ] &&
    [ "$(verify_issue)" = "$issue_sha" ] || {
      echo "CRASH_RECOVERY_FAIL source, origin/main or issue changed during recovery" >&2; exit 1
    }
}
verify_source
for ref in "$old_branch" "$new_branch"; do
  actual="$(remote_head "$ref")"
  [ -z "$actual" ] || [ "$actual" = "$head" ] || {
    echo "CRASH_RECOVERY_FAIL $ref changed before publication" >&2; exit 1
  }
done
echo "CRASH_RECOVERY_VERIFIED old_path=$old_dir old_branch=$old_branch checkpoint=$head"
# These are ordinary, non-force pushes. The original checkpoint stays published
# under its historical branch, and recovery has its own independent branch.
git -C "$old_dir" -c remote.origin.mirror=false push --atomic --no-follow-tags origin \
  "$head:refs/heads/$old_branch" "$head:refs/heads/$new_branch"
for ref in "$old_branch" "$new_branch"; do
  [ "$(remote_head "$ref")" = "$head" ] || {
    echo "CRASH_RECOVERY_FAIL post-push branch mismatch; original work preserved" >&2; exit 1
  }
done
verify_source
git -C "$old_dir" branch --set-upstream-to="origin/$old_branch" "$old_branch" >/dev/null
echo "CRASH_RECOVERY_PUBLISHED original=$old_branch recovery=$new_branch head=$head"
cd "$canonical"
args=(resume "$new_branch")
if [ -n "$target" ]; then args+=("$target"); fi
PFM_RECOVERY_MAIN_SHA="$main" PFM_RECOVERY_HEAD="$head" bash "$tmp/bootstrap-pr.sh" "${args[@]}"
echo "CRASH_RECOVERY_NOTE run the printed read-only preflight and verify the LIVE GitHub issue TARGET_BRANCH=$new_branch before submitting PFM_TASK_ISSUE: $issue in a fresh Codex conversation."
