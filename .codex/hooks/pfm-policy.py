#!/usr/bin/env python3
import fnmatch
import json
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path

APPROVED_BRANCH_PREFIXES = ("codex/", "agent/")
CONTROL_PATHS = ("AGENTS.md", ".codex/", ".agents/", ".github/workflows/", "tools/codex/", "tools/ci/")
NORMATIVE_MARKERS = ("docs/specs/", "docs/architecture/", "docs/spec-manifest.json", "requirements-index.json", "system-software-architecture")
REQUIRED_SCALARS = ("TASK_KIND", "MODE", "SEMANTICS", "REPAIR_ROUND", "EXPECTED_HEAD", "DEPENDENCY_POLICY", "DISCOVERY_POLICY", "LOCAL_EXECUTION_POLICY", "CI_PROFILE", "HEAVY_VALIDATION_PROFILE", "UAT")
REQUIRED_SECTIONS = ("READ_PATHS", "ALLOWED_PATHS", "OBJECTIVE", "ACCEPTANCE", "OUT_OF_SCOPE", "STOP")

def emit(value):
    sys.stdout.write(json.dumps(value, separators=(",", ":")))

def run_git(args, cwd):
    return subprocess.run(["git", *args], cwd=cwd, text=True, capture_output=True)

def git_value(args, cwd):
    result = run_git(args, cwd)
    return result.stdout.strip() if result.returncode == 0 else ""

def repo_root(cwd):
    value = git_value(["rev-parse", "--show-toplevel"], cwd)
    return Path(value) if value else None

def state_path(root, payload):
    sid = re.sub(r"[^A-Za-z0-9_.-]", "_", str(payload.get("session_id") or "session"))
    tid = re.sub(r"[^A-Za-z0-9_.-]", "_", str(payload.get("turn_id") or "turn"))
    directory = root / ".codex" / "runtime"
    directory.mkdir(parents=True, exist_ok=True)
    return directory / f"{sid}-{tid}.json"

def load_state(root, payload):
    path = state_path(root, payload)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except Exception:
        return None

def scalar(prompt, key):
    match = re.search(rf"(?m)^{re.escape(key)}:\s*(.+?)\s*$", prompt)
    return match.group(1).strip() if match else None

def section(prompt, key):
    match = re.search(rf"(?ms)^{re.escape(key)}:\s*\n(.*?)(?=^[A-Z][A-Z0-9_]*:\s*(?:\n|$)|\Z)", prompt)
    return match.group(1).strip() if match else ""

def list_section(prompt, key):
    return [m.group(1).strip() for m in re.finditer(r"(?m)^\s*-\s+(.+?)\s*$", section(prompt, key))]

def normalize(value):
    value = value.strip().replace("\\", "/")
    if value.startswith("./"):
        value = value[2:]
    return value.rstrip("/") or "."

def allowed(path, patterns):
    path = normalize(path)
    for raw in patterns:
        pattern = normalize(raw)
        if pattern == "." or fnmatch.fnmatch(path, pattern):
            return True
        if pattern.endswith("/**") and (path == pattern[:-3].rstrip("/") or path.startswith(pattern[:-3])):
            return True
        if not any(ch in pattern for ch in "*?[") and (path == pattern or path.startswith(pattern.rstrip("/") + "/")):
            return True
    return False

def is_control_path(path):
    path = normalize(path)
    return any(path == item.rstrip("/") or path.startswith(item) for item in CONTROL_PATHS)

def validate_envelope(prompt):
    errors = []
    values = {key: scalar(prompt, key) for key in REQUIRED_SCALARS}
    for key, value in values.items():
        if not value:
            errors.append(f"missing {key}")
    for key in REQUIRED_SECTIONS:
        if not section(prompt, key):
            errors.append(f"missing/empty {key}")
    reads = list_section(prompt, "READ_PATHS")
    writes = list_section(prompt, "ALLOWED_PATHS")
    if not reads:
        errors.append("READ_PATHS must contain at least one entry")
    if not writes:
        errors.append("ALLOWED_PATHS must contain at least one entry")
    if values.get("TASK_KIND") not in {"product", "framework", "repair"}:
        errors.append("TASK_KIND must be product, framework, or repair")
    if values.get("MODE") not in {"surgical", "local", "cross-cutting"}:
        errors.append("MODE must be surgical, local, or cross-cutting")
    if values.get("SEMANTICS") not in {"resolved", "lookup_required"}:
        errors.append("SEMANTICS must be resolved or lookup_required")
    if values.get("REPAIR_ROUND") not in {"0", "1", "2"}:
        errors.append("REPAIR_ROUND must be 0, 1, or 2")
    if values.get("DEPENDENCY_POLICY") not in {"locked", "manifest_edit"}:
        errors.append("DEPENDENCY_POLICY must be locked or manifest_edit")
    if values.get("DISCOVERY_POLICY") not in {"implementation_only", "targeted_lookup"}:
        errors.append("DISCOVERY_POLICY must be implementation_only or targeted_lookup")
    if values.get("LOCAL_EXECUTION_POLICY") != "no_tests":
        errors.append("LOCAL_EXECUTION_POLICY must be no_tests")
    if values.get("UAT") not in {"required", "not_required"}:
        errors.append("UAT must be required or not_required")
    ci_profiles = {"docs-only", "tooling", "spec", "deterministic", "deterministic-interactive", "engine-equivalence", "tax", "stochastic-foundation", "stochastic-orchestration", "onboarding", "provider-adapter", "probabilistic-ux", "full"}
    if values.get("CI_PROFILE") not in ci_profiles:
        errors.append("CI_PROFILE is not a recognized verification profile")
    if values.get("HEAVY_VALIDATION_PROFILE") not in {"none", "performance", "stochastic", "onboarding", "provider"}:
        errors.append("HEAVY_VALIDATION_PROFILE is not recognized")
    if values.get("SEMANTICS") == "resolved" and values.get("DISCOVERY_POLICY") != "implementation_only":
        errors.append("resolved semantics require DISCOVERY_POLICY=implementation_only")
    if values.get("SEMANTICS") == "lookup_required" and values.get("DISCOVERY_POLICY") != "targeted_lookup":
        errors.append("lookup_required semantics require DISCOVERY_POLICY=targeted_lookup")
    if values.get("TASK_KIND") == "repair" and values.get("REPAIR_ROUND") not in {"1", "2"}:
        errors.append("repair tasks require REPAIR_ROUND 1 or 2")
    if values.get("TASK_KIND") != "repair" and values.get("REPAIR_ROUND") != "0":
        errors.append("non-repair tasks require REPAIR_ROUND 0")
    if not re.fullmatch(r"[0-9a-fA-F]{40}", values.get("EXPECTED_HEAD") or ""):
        errors.append("EXPECTED_HEAD must be a full 40-character SHA")
    return errors, values, reads, writes

def changed_paths(root, expected):
    paths = set()
    for args in (["diff", "--name-only", f"{expected}...HEAD"], ["diff", "--name-only"], ["diff", "--cached", "--name-only"]):
        result = run_git(args, root)
        if result.returncode == 0:
            paths.update(line.strip() for line in result.stdout.splitlines() if line.strip())
    return sorted(paths)

def dependency_declarations_changed(root, expected):
    current = root / "package.json"
    base = run_git(["show", f"{expected}:package.json"], root)
    if not current.exists() or base.returncode != 0:
        return False
    try:
        before = json.loads(base.stdout)
        after = json.loads(current.read_text())
    except Exception:
        return True
    keys = ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "packageManager")
    return any(before.get(key) != after.get(key) for key in keys)

def patch_paths(command):
    found = []
    for pattern in (r"(?m)^\*\*\* (?:Update|Add|Delete) File:\s*(.+?)\s*$", r"(?m)^diff --git a/(.+?) b/(.+?)$"):
        for match in re.finditer(pattern, command):
            found.append(match.group(match.lastindex))
    return found

def tokens(command):
    try:
        return shlex.split(command)
    except Exception:
        return command.split()

def is_local_verification(command):
    patterns = (
        r"(^|\s)(npm|pnpm|yarn|bun)\s+(run\s+)?(test|test:e2e|codex:test|codex:e2e|codex:verify|typecheck|build:web|architecture:validate|spec:validate|perf:capture|benchmark|stochastic:validate|onboarding:dry-run)(\s|$)",
        r"(^|\s)(node|tsx|vite-node|python3?)\s+[^;&|]*(test|spec|benchmark|benchmarks/|capture|validate)(\.|/|\s|$)",
        r"(^|\s)(bash|sh)\s+[^;&|]*(test|benchmark|capture|validate)(\.|/|\s|$)",
        r"(^|\s)(npx\s+)?(vitest|playwright|jest|mocha|vite-node|tsc)(\s|$)",
        r"(^|\s)\.?/?node_modules/\.bin/(vitest|playwright|tsc|vite-node)(\s|$)",
        r"(^|\s)node\s+tools/(validate|codex/verify)",
        r"(^|\s)(npm|pnpm|yarn|bun)\s+run\s+(dev|start)(\s|$)",
    )
    return any(re.search(pattern, command.strip()) for pattern in patterns)

def is_install(command):
    patterns = (
        r"(^|\s)npm\s+(ci|install|i|update)(\s|$)",
        r"(^|\s)(pnpm|yarn|bun)\s+(install|add|update|up)(\s|$)",
        r"(^|\s)(corepack|npx\s+npm)(\s|$)",
    )
    return any(re.search(pattern, command.strip()) for pattern in patterns)

def safe_pr_create(command, root):
    parts = tokens(command)
    if len(parts) < 3 or parts[0:3] != ["gh", "pr", "create"]:
        return False, "not a gh pr create command"
    branch = os.environ.get("PFM_POLICY_TEST_BRANCH") or git_value(["symbolic-ref", "--quiet", "--short", "HEAD"], root)
    if not branch or branch in {"main", "master"} or not branch.startswith(APPROVED_BRANCH_PREFIXES):
        return False, f"branch {branch or 'DETACHED'} is not an approved feature branch"
    origin = os.environ.get("PFM_POLICY_TEST_ORIGIN") or git_value(["remote", "get-url", "origin"], root)
    if "bensmullen/personal-finance-app" not in origin:
        return False, "origin is not the approved repository"
    def option(name):
        if name not in parts:
            return None
        index = parts.index(name)
        return parts[index + 1] if index + 1 < len(parts) else ""
    repo = option("--repo")
    base = option("--base")
    head = option("--head")
    if repo not in {None, "bensmullen/personal-finance-app"}:
        return False, "PR repository is not approved"
    if base != "main":
        return False, "PR creation must explicitly target --base main"
    if head != branch:
        return False, f"PR creation must explicitly use --head {branch}"
    return True, branch

def safe_push(command, root):
    parts = tokens(command)
    try:
        index = parts.index("git")
    except ValueError:
        return False, "push must invoke git directly"
    args = parts[index + 1:]
    if not args or args[0] != "push":
        return False, "not a git push"
    if any(arg in {"-f", "--force", "--force-with-lease", "--delete"} or arg.startswith("--force=") for arg in args):
        return False, "force/delete pushes are forbidden"
    branch = os.environ.get("PFM_POLICY_TEST_BRANCH") or git_value(["symbolic-ref", "--quiet", "--short", "HEAD"], root)
    if not branch or branch in {"main", "master"} or not branch.startswith(APPROVED_BRANCH_PREFIXES):
        return False, f"branch {branch or 'DETACHED'} is not an approved feature branch"
    origin = os.environ.get("PFM_POLICY_TEST_ORIGIN") or git_value(["remote", "get-url", "origin"], root)
    valid = {
        "https://github.com/bensmullen/personal-finance-app",
        "https://github.com/bensmullen/personal-finance-app.git",
        "git@github.com:bensmullen/personal-finance-app.git",
        "ssh://git@github.com/bensmullen/personal-finance-app.git",
    }
    if origin not in valid:
        return False, "origin is not the approved repository"
    positional = [arg for arg in args[1:] if not arg.startswith("-") and arg != "origin"]
    for refspec in positional:
        destination = refspec.split(":")[-1].removeprefix("refs/heads/")
        if destination not in {branch, "HEAD"}:
            return False, f"destination {destination} does not match {branch}"
    return True, branch

def likely_write(command):
    return bool(re.search(r"(^|\s)(git\s+(commit|push|switch|checkout|reset|merge|rebase|cherry-pick|clean)|rm|mv|cp|touch|mkdir|tee|truncate|chmod|chown)(\s|$)|(^|[^<])>{1,2}\s*\S", command.strip()))

def bash_paths(command, root):
    found = []
    for token in tokens(command):
        if token.startswith("-"):
            continue
        cleaned = token.strip("'\"")
        candidate = (root / cleaned).resolve() if not os.path.isabs(cleaned) else Path(cleaned).resolve()
        try:
            relative = candidate.relative_to(root.resolve())
        except Exception:
            continue
        if candidate.exists():
            found.append(str(relative).replace("\\", "/"))
    return found

def tool_paths(value):
    found = []
    if isinstance(value, dict):
        for key, item in value.items():
            if str(key).lower() in {"path", "file_path", "filepath", "paths", "files"}:
                if isinstance(item, str):
                    found.append(item)
                elif isinstance(item, list):
                    found.extend(x for x in item if isinstance(x, str))
            elif isinstance(item, (dict, list)):
                found.extend(tool_paths(item))
    elif isinstance(value, list):
        for item in value:
            found.extend(tool_paths(item))
    return found

def deny(reason):
    emit({"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":reason}})

def session_start(payload, root):
    problems = []
    for command in ("git", "node", "npm"):
        result = subprocess.run(["/usr/bin/env", "bash", "-lc", f"command -v {command}"], cwd=root, text=True, capture_output=True)
        if result.returncode != 0:
            problems.append(f"{command} is not on PATH")
    node = subprocess.run(["/usr/bin/env", "bash", "-lc", "node -p 'process.versions.node'"], cwd=root, text=True, capture_output=True)
    version = node.stdout.strip()
    if node.returncode == 0 and not version.startswith("22."):
        problems.append(f"Node 22 required; found {version or 'unknown'}")
    if not (root / "node_modules").is_dir() or not (root / "node_modules" / ".bin" / "tsc").exists():
        problems.append("dependencies are not installed; select the repository Local Environment so setup runs before Codex")
    if not os.environ.get("CI"):
        gh = subprocess.run(["/usr/bin/env", "bash", "-lc", "command -v gh && gh auth status"], cwd=root, text=True, capture_output=True)
        if gh.returncode != 0:
            problems.append("GitHub CLI is missing or unauthenticated; run gh auth login and gh auth setup-git")
    origin = git_value(["remote", "get-url", "origin"], root)
    if origin and "bensmullen/personal-finance-app" not in origin:
        problems.append("origin is not bensmullen/personal-finance-app")
    if problems:
        emit({"continue":False,"stopReason":"ENV_NOT_READY: " + "; ".join(problems),"systemMessage":"Fix the Personal Finance App Local Environment/Node/npm setup before starting a Codex task. Codex must not repair the environment itself."})
        return
    emit({"continue":True,"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"PFM environment preflight passed: Git, Node 22, npm, and dependencies are ready. Do not reinstall dependencies during the agent phase."}})

def user_prompt(payload, root):
    prompt = str(payload.get("prompt") or "")
    if "PFM_TASK_V2" not in prompt:
        emit({"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"No PFM_TASK_V2 envelope is active. This turn is read-only: do not edit, install, test, validate, build, commit, or push."}})
        return
    errors, values, reads, writes = validate_envelope(prompt)
    if errors:
        emit({"decision":"block","reason":"Invalid PFM_TASK_V2 envelope: " + "; ".join(errors)})
        return
    head = git_value(["rev-parse", "HEAD"], root)
    dirty = git_value(["status", "--porcelain=v1", "--untracked-files=normal"], root)
    if head.lower() != values["EXPECTED_HEAD"].lower():
        emit({"decision":"block","reason":f"STATE_MISMATCH: expected {values['EXPECTED_HEAD']} but checkout is {head or 'unknown'}."})
        return
    if dirty:
        emit({"decision":"block","reason":"STATE_DIRTY: working tree must be clean before a PFM task begins."})
        return
    if values["TASK_KIND"] != "framework":
        bad = [path for path in writes if is_control_path(path.replace("**", ""))]
        if bad:
            emit({"decision":"block","reason":"Product/repair tasks may not authorize agent-control paths: " + ", ".join(bad)})
            return
    state = {**values, "READ_PATHS":reads, "ALLOWED_PATHS":writes}
    state_path(root, payload).write_text(json.dumps(state, indent=2) + "\n")
    emit({"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"PFM_TASK_V2 accepted. Treat the handoff as the resolved implementation contract. Do not run local tests/typecheck/builds/validators/benchmarks/dev servers or install packages. Do not expand beyond READ_PATHS. If information is insufficient, stop with LOOKUP_REQUIRED. GitHub CI owns verification and only an external new handoff may advance REPAIR_ROUND."}})

def pre_tool(payload, root):
    tool = str(payload.get("tool_name") or "")
    tool_input = payload.get("tool_input") or {}
    command = str(tool_input.get("command") or "") if isinstance(tool_input, dict) else ""
    state = load_state(root, payload)
    if tool in {"spawn_agent", "Agent"}:
        deny("Subagents are disabled for PFM implementation turns.")
        return
    if state is None:
        if tool == "apply_patch" or (tool == "Bash" and likely_write(command)):
            deny("No PFM_TASK_V2 envelope is active. Repository mutation is blocked.")
            return
        emit({})
        return
    if tool == "Bash":
        if is_local_verification(command):
            deny("Local tests/validation/builds/benchmarks/dev servers are prohibited in Codex PFM turns. GitHub CI or the manual heavy-validation workflow owns verification.")
            return
        if is_install(command):
            deny("Agent-phase dependency installation/package-manager switching is prohibited. Fix the Local Environment instead.")
            return
        if re.search(r"(^|\s)git\s+push(\s|$)", command):
            ok, reason = safe_push(command, root)
            if not ok:
                deny("Unsafe git push blocked: " + reason)
                return
        if re.search(r"(^|\s)gh\s+pr\s+create(\s|$)", command):
            ok, reason = safe_pr_create(command, root)
            if not ok:
                deny("Unsafe PR creation blocked: " + reason)
                return
        normalized = command.replace("\\", "/")
        if state["SEMANTICS"] == "resolved" and (
            any(marker in normalized for marker in NORMATIVE_MARKERS)
            or re.search(r"(^|\s)git\s+log(\s|$)", command)
            or re.search(r"(^|\s)gh\s+api(\s|$)", command)
            or (re.search(r"(^|\s)gh\s+pr(\s|$)", command) and not re.search(r"(^|\s)gh\s+pr\s+create(\s|$)", command))
        ):
            deny("Resolved task: normative specs/architecture/PR history may not be reread. Stop with LOOKUP_REQUIRED if the handoff is insufficient.")
            return
        if re.search(r"(^|\s)(rg|grep)(\s|$)", command) and not bash_paths(command, root):
            deny("Search commands must name an explicit path within READ_PATHS; repository-wide implicit search is blocked.")
            return
    if tool == "apply_patch":
        for path in patch_paths(command):
            if not allowed(path, state["ALLOWED_PATHS"]):
                deny(f"Out-of-scope edit blocked: {path}")
                return
            if is_control_path(path) and state["TASK_KIND"] != "framework":
                deny(f"Protected agent-control edit blocked: {path}")
                return
    if state["SEMANTICS"] == "resolved":
        serialized = json.dumps(tool_input, sort_keys=True).replace("\\", "/")
        if any(marker in serialized for marker in NORMATIVE_MARKERS):
            deny("Resolved task attempted a normative-resource read. Stop with LOOKUP_REQUIRED instead.")
            return
    for raw in tool_paths(tool_input):
        path = normalize(raw)
        root_text = str(root).replace("\\", "/")
        if path.startswith(root_text):
            path = path[len(root_text):].lstrip("/")
        if path and not allowed(path, state["READ_PATHS"]) and not allowed(path, state["ALLOWED_PATHS"]):
            deny(f"Read outside READ_PATHS blocked: {path}")
            return
    emit({})

def permission_request(payload, root):
    if str(payload.get("tool_name") or "") != "Bash":
        emit({})
        return
    command = str((payload.get("tool_input") or {}).get("command") or "")
    is_push = bool(re.search(r"(^|\s)git\s+push(\s|$)", command))
    is_pr_create = bool(re.search(r"(^|\s)gh\s+pr\s+create(\s|$)", command))
    if not is_push and not is_pr_create:
        emit({})
        return
    if load_state(root, payload) is None:
        emit({"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"No active PFM_TASK_V2 task."}}})
        return
    ok, reason = safe_push(command, root) if is_push else safe_pr_create(command, root)
    label = "push" if is_push else "PR creation"
    decision = {"behavior":"allow"} if ok else {"behavior":"deny","message":f"Unsafe {label} blocked: " + reason}
    emit({"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":decision}})

def post_tool(payload, root):
    state = load_state(root, payload)
    if state is None:
        emit({})
        return
    changed = changed_paths(root, state["EXPECTED_HEAD"])
    bad = [path for path in changed if not allowed(path, state["ALLOWED_PATHS"])]
    if bad:
        emit({"continue":False,"stopReason":"SCOPE_VIOLATION: " + ", ".join(bad),"systemMessage":"PFM scope guard stopped the turn. Do not broaden the task."})
        return
    controls = [path for path in changed if is_control_path(path)]
    if controls and state["TASK_KIND"] != "framework":
        emit({"continue":False,"stopReason":"CONTROL_PATH_VIOLATION: " + ", ".join(controls),"systemMessage":"Product/repair task modified protected agent-control files."})
        return
    if state["DEPENDENCY_POLICY"] == "locked" and dependency_declarations_changed(root, state["EXPECTED_HEAD"]):
        emit({"continue":False,"stopReason":"DEPENDENCY_POLICY_VIOLATION","systemMessage":"Dependency declarations changed under locked policy; use a new authorized task instead."})
        return
    emit({})

def pre_compact(payload, root):
    if load_state(root, payload) is not None and payload.get("trigger") == "auto":
        emit({"continue":False,"stopReason":"CONTEXT_BUDGET_EXCEEDED: automatic compaction is forbidden inside a bounded PFM implementation/repair turn.","systemMessage":"Stop and return a partial receipt; do not compact and continue."})
        return
    emit({"continue":True})

def stop(payload, root):
    state = load_state(root, payload)
    if state is None:
        emit({"continue":True})
        return
    messages = []
    if git_value(["status", "--porcelain=v1", "--untracked-files=normal"], root):
        messages.append("working tree is dirty")
    if git_value(["rev-parse", "HEAD"], root) == state["EXPECTED_HEAD"]:
        messages.append("no implementation commit exists")
    branch = os.environ.get("PFM_POLICY_TEST_BRANCH") or git_value(["symbolic-ref", "--quiet", "--short", "HEAD"], root) or "DETACHED"
    if branch in {"main", "master", "DETACHED"}:
        messages.append(f"final branch is {branch}")
    output = {"continue":True}
    if messages:
        output["systemMessage"] = "PFM completion is incomplete: " + "; ".join(messages) + ". Do not represent the task as fully complete."
    emit(output)

def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        emit({})
        return
    root = repo_root(payload.get("cwd") or os.getcwd())
    if root is None:
        emit({})
        return
    handlers = {"SessionStart":session_start,"UserPromptSubmit":user_prompt,"PreToolUse":pre_tool,"PermissionRequest":permission_request,"PostToolUse":post_tool,"PreCompact":pre_compact,"Stop":stop}
    handler = handlers.get(payload.get("hook_event_name"))
    if handler is None:
        emit({})
        return
    try:
        handler(payload, root)
    except Exception as exc:
        if payload.get("hook_event_name") == "PreToolUse":
            deny(f"PFM policy hook failed closed: {exc}")
        elif payload.get("hook_event_name") == "PermissionRequest":
            emit({"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":f"PFM policy hook failed closed: {exc}"}}})
        else:
            emit({"continue":False,"stopReason":f"PFM policy hook error: {exc}","systemMessage":"Repository policy hook failed; stop and repair the framework."})

if __name__ == "__main__":
    main()
