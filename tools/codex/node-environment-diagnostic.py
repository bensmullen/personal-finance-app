#!/usr/bin/env python3
"""Bounded, read-only Codex Node discovery. No tests, installs, or task receipts.

This tool is separately authorized by the V3 PreToolUse hook only if it and
the imported launcher match already-merged main. Never output HOME, PATH,
absolute user directories, environment values, or process stderr.
"""
import importlib.util
import json
import os
import platform
import shutil
import subprocess
import sys
import time
from pathlib import Path

MAX_CANDIDATES = 8
TOTAL_SECONDS = 7.0
PER_CANDIDATE_SECONDS = 2.0


def main():
    if len(sys.argv) != 1:
        return 2
    sys.dont_write_bytecode = True
    launcher = Path("tools/codex/limited-local-verification-launcher.py")
    spec = importlib.util.spec_from_file_location("pfm_node_launcher", str(launcher.resolve()))
    if spec is None or spec.loader is None:
        return 2
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    home = Path.home()
    standard = {
        str(Path("/usr/local/bin/node")): "usr-local",
        str(Path("/opt/homebrew/bin/node")): "homebrew",
        str(home / ".volta/bin/node"): "volta",
        str(home / ".asdf/shims/node"): "asdf",
        str(home / ".local/share/mise/shims/node"): "mise",
        str(home / ".local/bin/node"): "local-bin",
    }
    seen = set()
    candidates = []
    deadline = time.monotonic() + TOTAL_SECONDS
    for candidate in module.candidate_nodes():
        path = str(candidate)
        if path in seen:
            continue
        seen.add(path)
        label = standard.get(path, "nvm" if "/.nvm/versions/node/" in path
                             else "fnm" if "fnm/node-versions/" in path else "path")
        candidates.append((label, candidate))
        if len(candidates) >= MAX_CANDIDATES:
            break
    # Check existence separately for standard hard-coded paths, which are
    # suppressed by launcher.candidate_nodes() when absent/not executable.
    failures = []
    for path, label in standard.items():
        p = Path(path)
        if not p.is_file():
            failures.append({"candidate": label, "result": "missing"})
        elif not os.access(path, os.X_OK):
            failures.append({"candidate": label, "result": "not-executable"})
    checks = []
    for label, path in candidates:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            checks.append({"candidate": label, "result": "budget-exhausted"})
            break
        try:
            outcome = subprocess.run(
                [str(path), "-p", "process.versions.node"],
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                text=True, timeout=min(PER_CANDIDATE_SECONDS, remaining),
                check=False,
            )
            version = outcome.stdout.strip()
            if outcome.returncode != 0:
                category = "nonzero-exit"
            elif version.startswith("22.") and version[3:].replace(".", "").isdigit():
                category = "node22"
            else:
                category = "wrong-or-unreadable-version"
        except subprocess.TimeoutExpired:
            category = "probe-timeout"
        except PermissionError:
            category = "execution-denied"
        except OSError:
            category = "execution-error"
        checks.append({"candidate": label, "result": category})
    result = {
        "schema": 1,
        "platform": platform.system().lower() if platform.system() in ("Darwin", "Linux", "Windows") else "other",
        "node_on_path": bool(shutil.which("node")),
        "npm_on_path": bool(shutil.which("npm")),
        "checks": checks,
        "standard_missing_or_denied": failures,
        "typescript_present": Path("node_modules/typescript/bin/tsc").is_file(),
        "vitest_present": Path("node_modules/vitest/vitest.mjs").is_file(),
        "truncated": len(candidates) >= MAX_CANDIDATES,
    }
    print("PFM_NODE_DIAGNOSTIC " + json.dumps(result, separators=(",", ":"), sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
