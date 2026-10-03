#!/usr/bin/env python3
import fnmatch
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path

APPROVED_REPOSITORY = "bensmullen/personal-finance-app"
APPROVED_BRANCH_PREFIXES = ("codex/", "agent/")
CONTROL_PATHS = (
    "AGENTS.md", ".codex/", ".agents/", ".github/workflows/", "tools/codex/", "tools/ci/",
    "docs/development/handoff-authoring-policy.md", "docs/development/verification-policy.md",
    "docs/development/agent-",
)
TASK_MARKERS = ("PFM_TASK_V3", "PFM_TASK_V2")
TASK_ATTACHMENT_NAMES = {"pasted-text.txt", "writing-block.md"}
TASK_ATTACHMENT_MAX_BYTES = 256 * 1024
REQUIRED_SCALARS = ("TASK_KIND", "TARGET_BRANCH", "DEPENDENCY_POLICY")
REQUIRED_SECTIONS = ("ALLOWED_PATHS", "OBJECTIVE", "ACCEPTANCE")


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


def current_branch(root):
    override = os.environ.get("PFM_POLICY_TEST_BRANCH")
    if override is not None:
        return override
    return git_value(["symbolic-ref", "--quiet", "--short", "HEAD"], root)


def origin_url(root):
    return os.environ.get("PFM_POLICY_TEST_ORIGIN") or git_value(["remote", "get-url", "origin"], root)


def is_linked_worktree(root):
    git_dir = git_value(["rev-parse", "--git-dir"], root)
    common_dir = git_value(["rev-parse", "--git-common-dir"], root)
    if not git_dir or not common_dir:
        return False

    def absolute(value):
        path = Path(value)
        return path.resolve() if path.is_absolute() else (root / path).resolve()

    return absolute(git_dir) != absolute(common_dir)


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
    match = re.search(
        rf"(?ms)^{re.escape(key)}:\s*\n(.*?)(?=^[A-Z][A-Z0-9_]*:\s*(?:\n|$)|\Z)",
        prompt,
    )
    return match.group(1).strip() if match else ""


def list_section(prompt, key):
    return [
        match.group(1).strip()
        for match in re.finditer(r"(?m)^\s*-\s+(.+?)\s*$", section(prompt, key))
    ]


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
        if pattern.endswith("/**"):
            prefix = pattern[:-3].rstrip("/")
            if path == prefix or path.startswith(prefix + "/"):
                return True
        if not any(ch in pattern for ch in "*?[") and (
            path == pattern or path.startswith(pattern.rstrip("/") + "/")
        ):
            return True
    return False


def is_control_path(path):
    path = normalize(path)
    return any(path == item.rstrip("/") or path.startswith(item) for item in CONTROL_PATHS)


def validate_task(prompt):
    errors = []
    values = {key: scalar(prompt, key) for key in REQUIRED_SCALARS}
    for key, value in values.items():
        if not value:
            errors.append(f"missing {key}")
    for key in REQUIRED_SECTIONS:
        if not section(prompt, key):
            errors.append(f"missing/empty {key}")

    writes = list_section(prompt, "ALLOWED_PATHS")
    if not writes:
        errors.append("ALLOWED_PATHS must contain at least one entry")

    if values.get("TASK_KIND") not in {"product", "framework", "repair"}:
        errors.append("TASK_KIND must be product, framework, or repair")

    target = values.get("TARGET_BRANCH") or ""
    if not target.startswith(APPROVED_BRANCH_PREFIXES) or not re.fullmatch(r"[A-Za-z0-9._/-]+", target):
        errors.append("TARGET_BRANCH must be an approved codex/ or agent/ branch")

    if values.get("DEPENDENCY_POLICY") not in {"locked", "manifest_edit"}:
        errors.append("DEPENDENCY_POLICY must be locked or manifest_edit")

    if values.get("TASK_KIND") != "framework":
        protected = [path for path in writes if is_control_path(path.replace("**", ""))]
        if protected:
            errors.append("product/repair task may not authorize control paths: " + ", ".join(protected))

    return errors, values, writes


class TaskAttachmentError(ValueError):
    pass


def codex_attachments_root():
    home = Path(os.environ.get("CODEX_HOME") or str(Path.home() / ".codex")).expanduser()
    return home / "attachments"


def task_attachment_candidates(prompt):
    candidates = []
    for line in prompt.splitlines():
        if not any(name in line.lower() for name in TASK_ATTACHMENT_NAMES):
            continue
        for match in re.finditer(r"(/[^\n\r\t`\"']+?(?:pasted-text\.txt|writing-block\.md))", line, flags=re.I):
            candidates.append(match.group(1).strip())
        if ": " in line:
            tail = line.rsplit(": ", 1)[1].strip().strip("`").strip('"').strip("'")
            if Path(tail).name.lower() in TASK_ATTACHMENT_NAMES:
                candidates.append(tail)

    unique = []
    for candidate in candidates:
        if candidate not in unique:
            unique.append(candidate)
    return unique


def read_task_attachment(prompt):
    candidates = task_attachment_candidates(prompt)
    if not candidates:
        return None, None
    if len(candidates) != 1:
        raise TaskAttachmentError(
            f"TASK_ATTACHMENT_AMBIGUOUS: expected one generated task attachment, found {len(candidates)}."
        )

    raw = Path(candidates[0]).expanduser()
    if not raw.is_absolute():
        raise TaskAttachmentError("TASK_ATTACHMENT_PATH_INVALID: task attachment path must be absolute.")

    root_path = codex_attachments_root()
    if root_path.is_symlink():
        raise TaskAttachmentError("TASK_ATTACHMENT_ROOT_INVALID: Codex attachments root may not be a symlink.")
    try:
        trusted_root = root_path.resolve(strict=True)
        resolved = raw.resolve(strict=True)
    except Exception:
        raise TaskAttachmentError("TASK_ATTACHMENT_MISSING: task attachment does not exist.")

    try:
        if os.path.commonpath([str(trusted_root), str(resolved)]) != str(trusted_root):
            raise TaskAttachmentError("TASK_ATTACHMENT_OUTSIDE_ROOT: task attachment is outside the Codex attachments root.")
    except ValueError:
        raise TaskAttachmentError("TASK_ATTACHMENT_OUTSIDE_ROOT: task attachment is outside the Codex attachments root.")

    current = raw
    while True:
        if current.is_symlink():
            raise TaskAttachmentError("TASK_ATTACHMENT_SYMLINK: task attachment path may not contain symlinks.")
        if current == trusted_root or current == current.parent:
            break
        current = current.parent

    if not resolved.is_file():
        raise TaskAttachmentError("TASK_ATTACHMENT_NOT_FILE: task attachment must be a regular file.")
    data = resolved.read_bytes()
    if len(data) > TASK_ATTACHMENT_MAX_BYTES:
        raise TaskAttachmentError(
            f"TASK_ATTACHMENT_TOO_LARGE: task attachment exceeds {TASK_ATTACHMENT_MAX_BYTES} bytes."
        )
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise TaskAttachmentError("TASK_ATTACHMENT_ENCODING: task attachment must be UTF-8 text.")

    return text, {
        "path": str(resolved),
        "root": str(trusted_root),
        "sha256": hashlib.sha256(data).hexdigest(),
    }


def attachment_integrity_error(state):
    metadata = state.get("TASK_ATTACHMENT")
    if not metadata:
        return None
    try:
        path = Path(metadata["path"])
        trusted_root = Path(metadata["root"])
        expected = str(metadata["sha256"])
        if path.is_symlink():
            return "TASK_ATTACHMENT_INTEGRITY: validated attachment became a symlink."
        resolved = path.resolve(strict=True)
        if str(resolved) != str(path):
            return "TASK_ATTACHMENT_INTEGRITY: validated attachment path changed."
        if os.path.commonpath([str(trusted_root), str(resolved)]) != str(trusted_root):
            return "TASK_ATTACHMENT_INTEGRITY: validated attachment escaped its trusted root."
        data = resolved.read_bytes()
    except Exception:
        return "TASK_ATTACHMENT_INTEGRITY: validated attachment is missing or unreadable."
    if len(data) > TASK_ATTACHMENT_MAX_BYTES:
        return "TASK_ATTACHMENT_INTEGRITY: validated attachment now exceeds the size limit."
    if hashlib.sha256(data).hexdigest() != expected:
        return "TASK_ATTACHMENT_INTEGRITY: validated attachment changed after authorization."
    return None


def find_task_prompt(prompt):
    inline_has_marker = any(marker in prompt for marker in TASK_MARKERS)
    if inline_has_marker:
        errors, _, _ = validate_task(prompt)
        if not errors:
            return prompt, None

    try:
        attached, metadata = read_task_attachment(prompt)
    except TaskAttachmentError:
        raise

    if attached is not None and any(marker in attached for marker in TASK_MARKERS):
        return attached, metadata

    if inline_has_marker:
        errors, _, _ = validate_task(prompt)
        raise ValueError("Invalid PFM task contract: " + "; ".join(errors))

    return None, None


def changed_paths(root, base_head):
    paths = set()
    for args in (
        ["diff", "--name-only", f"{base_head}..HEAD"],
        ["diff", "--name-only"],
        ["diff", "--cached", "--name-only"],
        ["ls-files", "--others", "--exclude-standard"],
    ):
        result = run_git(args, root)
        if result.returncode == 0:
            paths.update(line.strip() for line in result.stdout.splitlines() if line.strip())
    return sorted(paths)


def dependency_declarations_changed(root, base_head):
    current = root / "package.json"
    base = run_git(["show", f"{base_head}:package.json"], root)
    if not current.exists() or base.returncode != 0:
        return False
    try:
        before = json.loads(base.stdout)
        after = json.loads(current.read_text())
    except Exception:
        return True
    keys = ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "packageManager")
    return any(before.get(key) != after.get(key) for key in keys)


def tokens(command):
    try:
        return shlex.split(command)
    except Exception:
        return command.split()


def patch_paths(command):
    found = []
    for pattern in (
        r"(?m)^\*\*\* (?:Update|Add|Delete) File:\s*(.+?)\s*$",
        r"(?m)^diff --git a/(.+?) b/(.+?)$",
    ):
        for match in re.finditer(pattern, command):
            found.append(match.group(match.lastindex))
    return found


def tool_paths(value):
    found = []
    if isinstance(value, dict):
        for key, item in value.items():
            if str(key).lower() in {"path", "file_path", "filepath", "paths", "files"}:
                if isinstance(item, str):
                    found.append(item)
                elif isinstance(item, list):
                    found.extend(value for value in item if isinstance(value, str))
            elif isinstance(item, (dict, list)):
                found.extend(tool_paths(item))
    elif isinstance(value, list):
        for item in value:
            found.extend(tool_paths(item))
    return found


def likely_shell_write(command):
    pattern = (
        r"(^|\s)(rm|mv|cp|touch|mkdir|tee|truncate|chmod|chown)(\s|$)"
        r"|(^|[^<])>{1,2}\s*\S"
        r"|(^|\s)sed\s+[^;&|]*\s-i(?:\s|$)"
    )
    return bool(re.search(pattern, command.strip()))


def safe_mkdir(command, patterns):
    if any(token in command for token in ("&&", "||", ";", "|", ">", "<")):
        return False
    parts = tokens(command)
    if not parts or parts[0] != "mkdir":
        return False
    paths = [part for part in parts[1:] if not part.startswith("-")]
    return bool(paths) and all(allowed(path, patterns) for path in paths)


def is_local_verification(command):
    patterns = (
        r"(^|\s)(npm|pnpm|yarn|bun)\s+(run\s+)?(test|test:e2e|codex:test|codex:e2e|codex:verify|typecheck|build:web|architecture:validate|spec:validate|perf:capture|benchmark|stochastic:validate|onboarding:dry-run)(\s|$)",
        r"(^|\s)(npx\s+)?(vitest|playwright|jest|mocha|tsc)(\s|$)",
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


def is_repository_mutation(command):
    return bool(
        likely_shell_write(command)
        or re.search(
            r"(^|\s)git\s+(add|commit|push|switch|checkout|reset|merge|rebase|cherry-pick|clean|worktree|pull|restore|mv|rm|update-index)(\s|$)",
            command,
        )
        or re.search(r"(^|\s)git\s+branch\s+(-d|-D|-f|--delete|--force)(\s|$)", command)
        or re.search(r"(^|\s)gh\s+pr\s+create(\s|$)", command)
    )


def is_forbidden_git_state_change(command):
    return bool(
        re.search(
            r"(^|\s)git\s+(switch|checkout|reset|merge|rebase|cherry-pick|clean|worktree|pull|restore|mv|rm)(\s|$)",
            command,
        )
        or re.search(r"(^|\s)git\s+branch\s+(-d|-D|-f|--delete|--force)(\s|$)", command)
    )


def safe_update_index(command, patterns):
    parts = tokens(command)
    if len(parts) < 4 or parts[0:2] != ["git", "update-index"]:
        return False
    if not any(part.startswith("--chmod=") for part in parts[2:]):
        return False
    paths = [part for part in parts[2:] if not part.startswith("-")]
    return bool(paths) and all(allowed(path, patterns) for path in paths)


def safe_push(command, root, expected_branch):
    parts = tokens(command)
    try:
        index = parts.index("git")
    except ValueError:
        return False, "push must invoke git directly"
    args = parts[index + 1:]
    if not args or args[0] != "push":
        return False, "not a git push"
    if any(
        arg in {"-f", "--force", "--force-with-lease", "--delete"} or arg.startswith("--force=")
        for arg in args
    ):
        return False, "force/delete pushes are forbidden"

    branch = current_branch(root)
    if branch != expected_branch:
        return False, f"current branch {branch or 'DETACHED'} does not match task branch {expected_branch}"
    if not branch.startswith(APPROVED_BRANCH_PREFIXES):
        return False, "current branch is not approved"

    valid_origins = {
        "https://github.com/bensmullen/personal-finance-app",
        "https://github.com/bensmullen/personal-finance-app.git",
        "git@github.com:bensmullen/personal-finance-app.git",
        "ssh://git@github.com/bensmullen/personal-finance-app.git",
    }
    if origin_url(root) not in valid_origins:
        return False, "origin is not the approved repository"

    positional = [arg for arg in args[1:] if not arg.startswith("-")]
    if positional and positional[0] == "origin":
        positional = positional[1:]
    for refspec in positional:
        if ":" in refspec:
            source, destination = refspec.split(":", 1)
            if source not in {branch, "HEAD"} or destination not in {branch, f"refs/heads/{branch}"}:
                return False, "push refspec must target the current task branch"
        elif refspec not in {branch, "HEAD"}:
            return False, "push may target only the current task branch"

    return True, branch


def safe_pr_create(command, root, expected_branch):
    parts = tokens(command)
    if len(parts) < 3 or parts[0:3] != ["gh", "pr", "create"]:
        return False, "not a gh pr create command"
    if current_branch(root) != expected_branch:
        return False, "current branch does not match task branch"
    if origin_url(root) and APPROVED_REPOSITORY not in origin_url(root):
        return False, "origin is not the approved repository"

    def option(name):
        if name not in parts:
            return None
        index = parts.index(name)
        return parts[index + 1] if index + 1 < len(parts) else ""

    if option("--repo") not in {None, APPROVED_REPOSITORY}:
        return False, "PR repository is not approved"
    if option("--base") != "main":
        return False, "PR creation must explicitly target --base main"
    if option("--head") != expected_branch:
        return False, f"PR creation must explicitly use --head {expected_branch}"
    return True, expected_branch


def deny(reason):
    emit(
        {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason,
            }
        }
    )


def session_start(payload, root):
    origin = origin_url(root)
    if origin and APPROVED_REPOSITORY not in origin:
        emit(
            {
                "continue": False,
                "stopReason": "ENV_NOT_READY: origin is not the Personal Finance App repository.",
                "systemMessage": "PFM repository preflight failed.",
            }
        )
        return

    branch = current_branch(root) or "DETACHED"
    head = git_value(["rev-parse", "HEAD"], root) or "unknown"
    dirty = bool(git_value(["status", "--porcelain=v1", "--untracked-files=normal"], root))
    linked = "yes" if is_linked_worktree(root) else "no"
    context = (
        f"PFM repo state: root={root} branch={branch} head={head} "
        f"dirty={'yes' if dirty else 'no'} linked_worktree={linked}. "
        "Use tools/codex/bootstrap-pr.sh before implementation to establish the correct feature branch from remote state. "
        "Node/npm/dependencies are not implementation-start requirements; GitHub CI owns verification."
    )
    emit(
        {
            "continue": True,
            "hookSpecificOutput": {
                "hookEventName": "SessionStart",
                "additionalContext": context,
            },
        }
    )


def user_prompt(payload, root):
    prompt = str(payload.get("prompt") or "")
    try:
        task_prompt, attachment_metadata = find_task_prompt(prompt)
    except (TaskAttachmentError, ValueError) as exc:
        emit({"decision": "block", "reason": str(exc)})
        return

    if task_prompt is None:
        emit(
            {
                "hookSpecificOutput": {
                    "hookEventName": "UserPromptSubmit",
                    "additionalContext": (
                        "No PFM task authorization is active. This turn is read-only: "
                        "do not edit, install, test, build, commit, or push."
                    ),
                }
            }
        )
        return

    errors, values, writes = validate_task(task_prompt)
    if errors:
        emit({"decision": "block", "reason": "Invalid PFM task contract: " + "; ".join(errors)})
        return

    dirty = git_value(["status", "--porcelain=v1", "--untracked-files=normal"], root)
    if dirty:
        emit({"decision": "block", "reason": "STATE_DIRTY: task branch must be clean before implementation begins."})
        return

    branch = current_branch(root) or "DETACHED"
    target = values["TARGET_BRANCH"]
    if branch != target:
        emit(
            {
                "decision": "block",
                "reason": (
                    f"TASK_BRANCH_MISMATCH: current branch is {branch}; task requires {target}. "
                    "Prepare/resume the branch with tools/codex/bootstrap-pr.sh and open that worktree."
                ),
            }
        )
        return

    state = {
        **values,
        "ALLOWED_PATHS": writes,
        "BASE_HEAD": git_value(["rev-parse", "HEAD"], root),
        "OBJECTIVE": section(task_prompt, "OBJECTIVE"),
        "ACCEPTANCE": section(task_prompt, "ACCEPTANCE"),
    }
    if attachment_metadata:
        state["TASK_ATTACHMENT"] = attachment_metadata
    state_path(root, payload).write_text(json.dumps(state, indent=2) + "\n")

    source = " from a trusted attachment" if attachment_metadata else ""
    context = (
        f"PFM task authorization accepted{source}. Repository edits are restricted to ALLOWED_PATHS. "
        "Use apply_patch for repository file edits; do not run local tests/builds/validators or install packages. "
        "Before stopping, report either TASK_STATUS: COMPLETE with ACCEPTANCE_STATUS: SATISFIED, "
        "or TASK_STATUS: BLOCKED with BLOCKER:/LOOKUP_REQUIRED:. "
        "COMPLETE is accepted only after the task branch is clean, contains an implementation commit, "
        "and is pushed/up-to-date with its origin tracking branch."
    )
    emit(
        {
            "hookSpecificOutput": {
                "hookEventName": "UserPromptSubmit",
                "additionalContext": context,
            }
        }
    )


def pre_tool(payload, root):
    tool = str(payload.get("tool_name") or "")
    tool_input = payload.get("tool_input") or {}
    command = str(tool_input.get("command") or "") if isinstance(tool_input, dict) else ""
    state = load_state(root, payload)

    if tool in {"spawn_agent", "Agent"}:
        deny("Subagents are disabled for PFM implementation turns.")
        return

    if state is None:
        if tool == "apply_patch" or (tool == "Bash" and is_repository_mutation(command)):
            deny("No active PFM task authorization. Repository mutation is blocked.")
            return
        emit({})
        return

    if tool == "apply_patch" or (
        tool == "Bash"
        and (
            likely_shell_write(command)
            or re.search(r"(^|\\s)git\\s+(commit|push|add)(\\s|$)", command)
            or re.search(r"(^|\\s)gh\\s+pr\\s+create(\\s|$)", command)
        )
    ):
        attachment_error = attachment_integrity_error(state)
        if attachment_error:
            deny(attachment_error)
            return

    if current_branch(root) != state["TARGET_BRANCH"]:
        if tool == "apply_patch" or tool == "Bash":
            deny("TASK_BRANCH_DRIFT: current branch no longer matches the authorized task branch.")
            return

    if tool == "Bash":
        if is_local_verification(command):
            deny("Local tests/builds/validators/benchmarks/dev servers are prohibited; GitHub CI owns verification.")
            return
        if is_install(command):
            deny("Dependency installation/package-manager changes are prohibited during implementation.")
            return
        if is_forbidden_git_state_change(command):
            deny("Git branch/worktree/history mutation is blocked inside an active task. Use the bootstrap helper before the task.")
            return
        if re.search(r"(^|\s)git\s+update-index(\s|$)", command):
            if safe_update_index(command, state["ALLOWED_PATHS"]):
                emit({})
                return
            deny("git update-index is allowed only for --chmod on authorized paths.")
            return
        if likely_shell_write(command) and safe_mkdir(command, state["ALLOWED_PATHS"]):
            emit({})
            return
        if likely_shell_write(command) and not re.search(r"(^|\s)git\s+(commit|push|add)(\s|$)", command):
            deny("Repository file edits must use apply_patch so ALLOWED_PATHS can be enforced before mutation.")
            return
        if re.search(r"(^|\s)git\s+push(\s|$)", command):
            ok, reason = safe_push(command, root, state["TARGET_BRANCH"])
            if not ok:
                deny("Unsafe git push blocked: " + reason)
                return
        if re.search(r"(^|\s)gh\s+pr\s+create(\s|$)", command):
            ok, reason = safe_pr_create(command, root, state["TARGET_BRANCH"])
            if not ok:
                deny("Unsafe PR creation blocked: " + reason)
                return

    if tool == "apply_patch":
        for path in patch_paths(command):
            if not allowed(path, state["ALLOWED_PATHS"]):
                deny(f"Out-of-scope edit blocked: {path}")
                return
            if is_control_path(path) and state["TASK_KIND"] != "framework":
                deny(f"Protected framework edit blocked: {path}")
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

    state = load_state(root, payload)
    if state is None:
        emit(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PermissionRequest",
                    "decision": {"behavior": "deny", "message": "No active PFM task authorization."},
                }
            }
        )
        return

    attachment_error = attachment_integrity_error(state)
    if attachment_error:
        emit(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PermissionRequest",
                    "decision": {"behavior": "deny", "message": attachment_error},
                }
            }
        )
        return

    ok, reason = (
        safe_push(command, root, state["TARGET_BRANCH"])
        if is_push
        else safe_pr_create(command, root, state["TARGET_BRANCH"])
    )
    label = "push" if is_push else "PR creation"
    decision = {"behavior": "allow"} if ok else {"behavior": "deny", "message": f"Unsafe {label} blocked: {reason}"}
    emit({"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": decision}})


def post_tool(payload, root):
    state = load_state(root, payload)
    if state is None:
        emit({})
        return

    attachment_error = attachment_integrity_error(state)
    if attachment_error:
        emit(
            {
                "continue": False,
                "stopReason": attachment_error,
                "systemMessage": "PFM attachment integrity guard stopped the turn.",
            }
        )
        return

    changed = changed_paths(root, state["BASE_HEAD"])
    bad = [path for path in changed if not allowed(path, state["ALLOWED_PATHS"])]
    if bad:
        emit(
            {
                "continue": False,
                "stopReason": "SCOPE_VIOLATION: " + ", ".join(bad),
                "systemMessage": "PFM scope guard stopped the turn. Out-of-scope tracked or untracked changes were detected.",
            }
        )
        return

    controls = [path for path in changed if is_control_path(path)]
    if controls and state["TASK_KIND"] != "framework":
        emit(
            {
                "continue": False,
                "stopReason": "CONTROL_PATH_VIOLATION: " + ", ".join(controls),
                "systemMessage": "Product/repair task modified protected framework files.",
            }
        )
        return

    if state["DEPENDENCY_POLICY"] == "locked" and dependency_declarations_changed(root, state["BASE_HEAD"]):
        emit(
            {
                "continue": False,
                "stopReason": "DEPENDENCY_POLICY_VIOLATION",
                "systemMessage": "Dependency declarations changed under locked policy.",
            }
        )
        return

    emit({})


def completion_problems(root, state):
    problems = []
    branch = current_branch(root) or "DETACHED"
    head = git_value(["rev-parse", "HEAD"], root)

    if branch != state["TARGET_BRANCH"]:
        problems.append(f"final branch is {branch}, expected {state['TARGET_BRANCH']}")
    if git_value(["status", "--porcelain=v1", "--untracked-files=normal"], root):
        problems.append("working tree is dirty")
    if head == state["BASE_HEAD"]:
        problems.append("no implementation commit exists")

    changed = changed_paths(root, state["BASE_HEAD"])
    bad = [path for path in changed if not allowed(path, state["ALLOWED_PATHS"])]
    if bad:
        problems.append("out-of-scope paths exist: " + ", ".join(bad))

    upstream = git_value(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], root)
    if upstream != f"origin/{state['TARGET_BRANCH']}":
        problems.append("task branch has no matching origin tracking branch")
    else:
        upstream_head = git_value(["rev-parse", "@{u}"], root)
        if upstream_head != head:
            problems.append("task branch is not fully pushed/up-to-date with origin")

    if state["DEPENDENCY_POLICY"] == "locked" and dependency_declarations_changed(root, state["BASE_HEAD"]):
        problems.append("dependency declarations changed under locked policy")

    return problems


def block_or_stop(payload, reason):
    if not payload.get("stop_hook_active"):
        emit({"decision": "block", "reason": reason})
    else:
        emit(
            {
                "continue": False,
                "stopReason": "TASK_INCOMPLETE: " + reason,
                "systemMessage": "PFM completion enforcement stopped the turn rather than allowing a false COMPLETE report.",
            }
        )


def stop(payload, root):
    state = load_state(root, payload)
    if state is None:
        emit({"continue": True})
        return

    message = str(payload.get("last_assistant_message") or "")
    attachment_error = attachment_integrity_error(state)
    if attachment_error:
        block_or_stop(payload, attachment_error)
        return

    complete = "TASK_STATUS: COMPLETE" in message
    blocked = "TASK_STATUS: BLOCKED" in message

    if complete and blocked:
        block_or_stop(payload, "final report contains both COMPLETE and BLOCKED")
        return

    if blocked:
        if "BLOCKER:" not in message and "LOOKUP_REQUIRED:" not in message:
            block_or_stop(payload, "BLOCKED status requires BLOCKER: or LOOKUP_REQUIRED:")
            return
        blocked_problems = []
        if current_branch(root) != state["TARGET_BRANCH"]:
            blocked_problems.append("task branch changed")
        if git_value(["status", "--porcelain=v1", "--untracked-files=normal"], root):
            blocked_problems.append("working tree is dirty")
        head = git_value(["rev-parse", "HEAD"], root)
        if head != state["BASE_HEAD"]:
            upstream = git_value(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], root)
            if upstream != f"origin/{state['TARGET_BRANCH']}" or git_value(["rev-parse", "@{u}"], root) != head:
                blocked_problems.append("partial committed work is not pushed/up-to-date")
        if blocked_problems:
            block_or_stop(payload, "Blocked task must leave shared Git state understandable: " + "; ".join(blocked_problems))
            return
        emit({"continue": True})
        return

    if not complete:
        block_or_stop(
            payload,
            "Finish the authorized task, or report TASK_STATUS: BLOCKED with an explicit BLOCKER:/LOOKUP_REQUIRED: reason.",
        )
        return

    if "ACCEPTANCE_STATUS: SATISFIED" not in message:
        block_or_stop(payload, "COMPLETE requires ACCEPTANCE_STATUS: SATISFIED")
        return

    problems = completion_problems(root, state)
    if problems:
        block_or_stop(payload, "Cannot report COMPLETE: " + "; ".join(problems))
        return

    emit({"continue": True})


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

    handlers = {
        "SessionStart": session_start,
        "UserPromptSubmit": user_prompt,
        "PreToolUse": pre_tool,
        "PermissionRequest": permission_request,
        "PostToolUse": post_tool,
        "Stop": stop,
    }
    handler = handlers.get(payload.get("hook_event_name"))
    if handler is None:
        emit({})
        return

    try:
        handler(payload, root)
    except Exception as exc:
        event = payload.get("hook_event_name")
        if event == "PreToolUse":
            deny(f"PFM policy hook failed closed: {exc}")
        elif event == "PermissionRequest":
            emit(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "PermissionRequest",
                        "decision": {"behavior": "deny", "message": f"PFM policy hook failed closed: {exc}"},
                    }
                }
            )
        else:
            emit(
                {
                    "continue": False,
                    "stopReason": f"PFM policy hook error: {exc}",
                    "systemMessage": "Repository policy hook failed; stop and repair the framework.",
                }
            )


if __name__ == "__main__":
    main()
