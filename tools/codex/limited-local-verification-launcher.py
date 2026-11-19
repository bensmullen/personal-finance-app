#!/usr/bin/env python3
"""Trusted Codex preflight launcher: find an existing Node 22 outside a sparse PATH.

This is the ONLY alternative to the audited direct Node preflight. It does not
install dependencies, run extra checks, or change protected task receipts.
The native bounded verifier still owns 60s/30s timeouts and all test results.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

TEST_PATTERN = re.compile(r"test/[A-Za-z0-9_/-]+\.test\.ts\Z")


def emit_unavailable(test):
    """Leave a truthful, authenticated SKIP for PostToolUse, without running tests."""
    reason = "Node 22 executable unavailable in Codex environment; no tests executed"
    try:
        root = Path.cwd().resolve()
        runtime = root / ".codex/runtime"
        pointer = runtime / "latest-task.json"
        if pointer.is_symlink():
            raise ValueError("unsafe receipt pointer")
        metadata = json.loads(pointer.read_text())
        name = metadata["path"]
        if not re.fullmatch(r"[A-Za-z0-9_.-]+\.json", name):
            raise ValueError("unsafe receipt filename")
        receipt = runtime / name
        if receipt.is_symlink():
            raise ValueError("unsafe receipt file")
        data = receipt.read_bytes()
        if hashlib.sha256(data).hexdigest() != metadata["sha256"]:
            raise ValueError("receipt hash mismatch")
        state = json.loads(data)
        attempt = state["PREFLIGHT"]
        if not state.get("ACTIVE") or state.get("WORKTREE") != str(root) or attempt.get("test") != test:
            raise ValueError("preflight not reserved")
        report = {
            "schema": 1, "authorization": state["AUTHORIZATION_ID"],
            "attempt": attempt["count"], "patch": attempt["patch"],
            "nonce": attempt["nonce"], "test": test, "status": "SKIP",
            "reason": reason, "timeoutObserved": False,
        }
        print("PFM_PREFLIGHT_RESULT " + json.dumps(report, separators=(",", ":")))
    except (OSError, ValueError, KeyError, TypeError):
        # Never pretend to have authenticated a result when receipt state is unavailable.
        print("SKIP preflight: " + reason + "; hook result remains INCOMPLETE")
    return 0


def candidate_nodes():
    home = Path.home()
    # Recognized host installations, not arbitrary repository-local executables.
    locations = [
        Path("/usr/local/bin/node"), Path("/opt/homebrew/bin/node"),
        home / ".volta/bin/node", home / ".asdf/shims/node",
        home / ".local/share/mise/shims/node",
        home / ".local/bin/node",
    ]
    locations.extend(sorted(home.glob(".nvm/versions/node/v22*/bin/node")))
    locations.extend(sorted(home.glob(
        "Library/Application Support/fnm/node-versions/v22*/installation/bin/node")))
    found = shutil.which("node")
    if found:
        locations.append(Path(found))
    unique = set()
    for candidate in locations:
        value = str(candidate)
        if not candidate.is_absolute() or value in unique:
            continue
        unique.add(value)
        if candidate.is_file() and os.access(value, os.X_OK):
            yield candidate


def node_major_is_22(candidate):
    try:
        check = subprocess.run(
            [str(candidate), "-p", "process.versions.node"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            universal_newlines=True, timeout=2, check=False,
        )
        return check.returncode == 0 and check.stdout.strip().startswith("22.")
    except (OSError, subprocess.TimeoutExpired):
        return False


def main():
    args = sys.argv[1:]
    if len(args) > 1 or (args and not TEST_PATTERN.fullmatch(args[0])):
        print("FAIL invalid bounded preflight arguments", file=sys.stderr)
        return 2
    root = Path.cwd().resolve()
    # Hook owns branch/worktree authorization; the launcher may not change cwd.
    if not (root / ".codex/runtime/latest-task.json").is_file():
        print("Preflight requires a protected hook reservation", file=sys.stderr)
        return 2
    for candidate in candidate_nodes():
        if not node_major_is_22(candidate):
            continue
        directory = str(candidate.parent)
        env = dict(os.environ)
        env.pop("NODE_OPTIONS", None)
        env.pop("NODE_PATH", None)
        env["PATH"] = directory + os.pathsep + env.get("PATH", "")
        os.execve(str(candidate), [
            str(candidate), "tools/codex/limited-local-verification.mjs", *args,
        ], env)
    return emit_unavailable(args[0] if args else None)


if __name__ == "__main__":
    sys.exit(main())
