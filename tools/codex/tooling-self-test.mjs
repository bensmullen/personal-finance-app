import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { candidateKey } from "./agent-candidate-key.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const policy = path.join(root, ".codex", "hooks", "pfm-policy.py");
const bootstrap = path.join(root, "tools", "codex", "bootstrap-pr.sh");
const prepareWorktree = path.join(root, "tools", "codex", "prepare-linked-worktree.sh");
const setupEnvironment = path.join(root, "tools", "codex", "setup-local-environment.sh");

const run = (command, args = [], options = {}) =>
  spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    input: options.input,
    env: { ...process.env, ...(options.env ?? {}) },
  });

const mustRun = (command, args = [], options = {}) => {
  const result = run(command, args, options);
  if (result.status !== 0) {
    throw new Error(
      command + " " + args.join(" ") + " failed\nstdout:\n" + result.stdout + "\nstderr:\n" + result.stderr,
    );
  }
  return result;
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

mustRun("python3", [
  "-c",
  "import ast,pathlib; ast.parse(pathlib.Path(" + JSON.stringify(policy) + ").read_text())",
]);
for (const script of [bootstrap, prepareWorktree, setupEnvironment]) {
  mustRun("bash", ["-n", script]);
}

const candidateA = {
  rule: " Diagnose pre-agent failures before blaming the envelope. ",
  applicability: {
    task_kinds: ["product", "framework"],
    ci_profiles: ["tooling", "*"],
    heavy_validation_profiles: ["none", "*"],
    task_continuities: ["new_pr"],
  },
  do_not_generalize_to: "If the hook returned an explicit envelope error, use that evidence.",
};
const candidateB = {
  rule: "Diagnose   pre-agent failures before blaming the envelope.",
  applicability: {
    task_kinds: ["framework", "product", "product"],
    ci_profiles: ["*", "tooling"],
    heavy_validation_profiles: ["*", "none"],
    task_continuities: ["NEW_PR"],
  },
  do_not_generalize_to: " If the hook returned an explicit envelope error, use that evidence. ",
};
assert(candidateKey(candidateA) === candidateKey(candidateB), "candidate identity normalization regressed");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pfm-tooling-v3-"));
const hookRepo = path.join(temp, "hook-repo");
fs.mkdirSync(path.join(hookRepo, ".codex", "runtime"), { recursive: true });
fs.mkdirSync(path.join(hookRepo, "src"), { recursive: true });
fs.writeFileSync(path.join(hookRepo, ".gitignore"), ".codex/runtime/\n");
fs.writeFileSync(path.join(hookRepo, "src", "allowed.ts"), "export const value = 1;\n");
fs.writeFileSync(path.join(hookRepo, "src", "outside.ts"), "export const outside = 1;\n");
fs.writeFileSync(
  path.join(hookRepo, "package.json"),
  JSON.stringify({ name: "hook-test", dependencies: {}, devDependencies: {} }, null, 2) + "\n",
);

mustRun("git", ["init", "-b", "main"], { cwd: hookRepo });
mustRun("git", ["config", "user.name", "PFM Test"], { cwd: hookRepo });
mustRun("git", ["config", "user.email", "pfm@example.test"], { cwd: hookRepo });
const hookRemote = path.join(temp, "hook-remote.git");
mustRun("git", ["init", "--bare", hookRemote]);
mustRun("git", ["remote", "add", "origin", hookRemote], { cwd: hookRepo });
mustRun("git", ["add", "."], { cwd: hookRepo });
mustRun("git", ["commit", "-m", "base"], { cwd: hookRepo });
mustRun("git", ["switch", "-c", "codex/policy-self-test"], { cwd: hookRepo });
mustRun("git", ["push", "origin", "codex/policy-self-test"], { cwd: hookRepo });
const baseHead = mustRun("git", ["rev-parse", "HEAD"], { cwd: hookRepo }).stdout.trim();

const sessionId = "policy-self-test";
const turnId = "turn-1";
const hook = (event, extra = {}, env = {}) => {
  const payload = JSON.stringify({
    session_id: sessionId,
    turn_id: turnId,
    cwd: hookRepo,
    hook_event_name: event,
    permission_mode: "default",
    ...extra,
  });
  const result = run("python3", [policy], { cwd: hookRepo, input: payload,
    env: { PFM_POLICY_TEST_ORIGIN: "https://github.com/bensmullen/personal-finance-app.git", ...env } });
  assert(result.status === 0, event + " hook failed: " + result.stderr);
  return JSON.parse(result.stdout || "{}");
};

const session = hook("SessionStart");
assert(
  session?.continue === true
    && String(session?.hookSpecificOutput?.additionalContext ?? "").includes("branch=codex/policy-self-test"),
  "SessionStart should expose repository state without requiring local verification tools",
);

const readOnly = hook("UserPromptSubmit", { prompt: "Please inspect the code." });
assert(
  String(readOnly?.hookSpecificOutput?.additionalContext ?? "").includes("read-only"),
  "non-task prompts should remain read-only",
);

const prompt = [
  "PFM_TASK_V3",
  "TASK_KIND: product",
  "TARGET_BRANCH: codex/policy-self-test",
  "DEPENDENCY_POLICY: locked",
  "",
  "ALLOWED_PATHS:",
  "- src/allowed.ts",
  "- src/new/**",
  "- package.json",
  "",
  "OBJECTIVE:",
  "Change the authorized implementation only.",
  "",
  "ACCEPTANCE:",
  "Authorized changes are committed and pushed.",
  "",
].join("\n");

const issueFixture = path.join(temp, "task-issue-49.md");
fs.writeFileSync(
  issueFixture,
  prompt + "\n## Semantic detail\nIssue-based semantic contract was injected by the policy hook.\n",
);
const issueAccepted = hook(
  "UserPromptSubmit",
  { prompt: "Please execute PFM_TASK_ISSUE: 49. Do not rely on multiline prompt transport." },
  { PFM_POLICY_TEST_ISSUE_BODY_FILE: issueFixture },
);
assert(
  String(issueAccepted?.hookSpecificOutput?.additionalContext ?? "").includes("repository GitHub issue #49")
    && String(issueAccepted?.hookSpecificOutput?.additionalContext ?? "").includes("Issue-based semantic contract was injected"),
  "one-line task issue pointer should validate and inject the repository-owned contract",
);

const issueAmbiguous = hook(
  "UserPromptSubmit",
  { prompt: "PFM_TASK_ISSUE: 49 and PFM_TASK_ISSUE: 50" },
  { PFM_POLICY_TEST_ISSUE_BODY_FILE: issueFixture },
);
assert(
  issueAmbiguous.decision === "block" && String(issueAmbiguous.reason).includes("TASK_ISSUE_AMBIGUOUS"),
  "multiple task issue pointers must fail closed",
);

const accepted = hook("UserPromptSubmit", { prompt });
assert(
  String(accepted?.hookSpecificOutput?.additionalContext ?? "").includes("task authorization accepted"),
  "valid V3 task should be accepted",
);

const wrongBranch = hook(
  "UserPromptSubmit",
  { prompt },
  { PFM_POLICY_TEST_BRANCH: "main" },
);
assert(
  wrongBranch.decision === "block" && String(wrongBranch.reason).includes("TASK_BRANCH_MISMATCH"),
  "task should fail clearly when Codex is bound to the wrong branch/root",
);

const pre = (command) =>
  hook("PreToolUse", {
    tool_name: "Bash",
    tool_use_id: "tool-bash",
    tool_input: { command },
  });

for (const command of ["npm test", "npm run typecheck", "npm ci", "git switch main", "touch src/allowed.ts"]) {
  const result = pre(command);
  assert(
    result?.hookSpecificOutput?.permissionDecision === "deny",
    command + " should be denied",
  );
}

const mkdirAllowed = pre("mkdir -p src/new");
assert(JSON.stringify(mkdirAllowed) === "{}", "mkdir should be allowed only for an authorized subtree");

const mkdirBlocked = pre("mkdir -p src/not-allowed");
assert(
  mkdirBlocked?.hookSpecificOutput?.permissionDecision === "deny",
  "mkdir outside ALLOWED_PATHS should be denied",
);

const allowedPatch = hook("PreToolUse", {
  tool_name: "apply_patch",
  tool_use_id: "patch-allowed",
  tool_input: {
    command: "*** Begin Patch\n*** Update File: src/allowed.ts\n@@\n-export const value = 1;\n+export const value = 2;\n*** End Patch",
  },
});
assert(JSON.stringify(allowedPatch) === "{}", "authorized apply_patch should pass");

const blockedPatch = hook("PreToolUse", {
  tool_name: "apply_patch",
  tool_use_id: "patch-outside",
  tool_input: {
    command: "*** Begin Patch\n*** Update File: src/outside.ts\n@@\n-export const outside = 1;\n+export const outside = 2;\n*** End Patch",
  },
});
assert(
  blockedPatch?.hookSpecificOutput?.permissionDecision === "deny"
    && String(blockedPatch?.hookSpecificOutput?.permissionDecisionReason ?? "").includes("Out-of-scope"),
  "out-of-scope apply_patch should be blocked before mutation",
);

fs.writeFileSync(path.join(hookRepo, "src", "allowed.ts"), "export const value = 2;\n");
const allowedPost = hook("PostToolUse", {
  tool_name: "apply_patch",
  tool_use_id: "post-allowed",
  tool_input: { command: "allowed test mutation" },
  tool_response: {},
});
assert(JSON.stringify(allowedPost) === "{}", "authorized changed path should pass post-tool scope check");

fs.writeFileSync(path.join(hookRepo, "untracked-outside.txt"), "unexpected\n");
const untrackedPost = hook("PostToolUse", {
  tool_name: "Bash",
  tool_use_id: "post-untracked",
  tool_input: { command: "python helper" },
  tool_response: {},
});
assert(
  untrackedPost?.continue === false && String(untrackedPost?.stopReason ?? "").includes("SCOPE_VIOLATION"),
  "untracked out-of-scope files must be detected",
);
fs.rmSync(path.join(hookRepo, "untracked-outside.txt"));

fs.writeFileSync(
  path.join(hookRepo, "package.json"),
  JSON.stringify({ name: "hook-test", dependencies: { x: "1.0.0" }, devDependencies: {} }, null, 2) + "\n",
);
const dependencyPost = hook("PostToolUse", {
  tool_name: "Bash",
  tool_use_id: "post-dependency",
  tool_input: { command: "python helper" },
  tool_response: {},
});
assert(
  dependencyPost?.continue === false
    && String(dependencyPost?.stopReason ?? "").includes("DEPENDENCY_POLICY_VIOLATION"),
  "locked dependency declaration changes must be detected",
);
mustRun("git", ["restore", "package.json"], { cwd: hookRepo });

const safePush = hook("PermissionRequest", {
  tool_name: "Bash",
  tool_input: { command: "git push -u origin codex/policy-self-test" },
});
assert(
  safePush?.hookSpecificOutput?.decision?.behavior === "allow",
  "approved feature-branch push should be allowed",
);

const unsafePush = hook("PermissionRequest", {
  tool_name: "Bash",
  tool_input: { command: "git push --force origin main" },
});
assert(
  unsafePush?.hookSpecificOutput?.decision?.behavior === "deny",
  "force/main push should be denied",
);

mustRun("git", ["add", "src/allowed.ts"], { cwd: hookRepo });
mustRun("git", ["commit", "-m", "implementation"], { cwd: hookRepo });
const implementationHead = mustRun("git", ["rev-parse", "HEAD"], { cwd: hookRepo }).stdout.trim();

const incompleteStop = hook("Stop", {
  last_assistant_message: "TASK_STATUS: COMPLETE\nACCEPTANCE_STATUS: SATISFIED",
  stop_hook_active: false,
});
assert(
  incompleteStop.decision === "block"
    && String(incompleteStop.reason).includes("origin tracking branch"),
  "COMPLETE must be rejected until implementation is pushed/shared",
);

mustRun("git", ["update-ref", "refs/remotes/origin/codex/policy-self-test", implementationHead], { cwd: hookRepo });
mustRun("git", ["config", "branch.codex/policy-self-test.remote", "origin"], { cwd: hookRepo });
mustRun("git", ["config", "branch.codex/policy-self-test.merge", "refs/heads/codex/policy-self-test"], { cwd: hookRepo });

const completeStop = hook("Stop", {
  last_assistant_message: "TASK_STATUS: COMPLETE\nACCEPTANCE_STATUS: SATISFIED",
  stop_hook_active: false,
});
assert(completeStop?.continue === true, "mechanically complete/pushed task should be allowed to stop");

const missingStatus = hook("Stop", {
  last_assistant_message: "Finished.",
  stop_hook_active: false,
});
assert(
  missingStatus.decision === "block" && String(missingStatus.reason).includes("TASK_STATUS: BLOCKED"),
  "Stop hook should require explicit completion or blocker status",
);

const blockedStop = hook("Stop", {
  last_assistant_message: "TASK_STATUS: BLOCKED\nBLOCKER: external semantic decision required",
  stop_hook_active: false,
});
assert(blockedStop?.continue === true, "explicit clean BLOCKED state should be allowed");

hook("UserPromptSubmit", { prompt });
fs.writeFileSync(path.join(hookRepo, "src", "allowed.ts"), "export const value = 3;\n");
const dirtyBlocked = hook("Stop", {
  last_assistant_message: "TASK_STATUS: BLOCKED\nBLOCKER: external semantic decision required",
  stop_hook_active: false,
});
assert(
  dirtyBlocked.continue === true
    && mustRun("git", ["status", "--porcelain"], { cwd: hookRepo }).stdout === ""
    && mustRun("git", ["log", "-1", "--format=%B"], { cwd: hookRepo }).stdout.includes("PFM-Checkpoint: true")
    && mustRun("git", ["rev-parse", "HEAD"], { cwd: hookRepo }).stdout
      === mustRun("git", ["rev-parse", "@{u}"], { cwd: hookRepo }).stdout,
  "normal BLOCKED must checkpoint authorized work and push it",
);
const checkpointComplete = hook("Stop", {
  last_assistant_message: "TASK_STATUS: COMPLETE\nACCEPTANCE_STATUS: SATISFIED",
});
assert(checkpointComplete.decision === "block" && checkpointComplete.reason.includes("no implementation commit"),
  "checkpoint alone must never satisfy COMPLETE");

// Each recovery scenario has an isolated local bare origin; no network publication.
const realGit = mustRun("sh", ["-c", "command -v git"]).stdout.trim();
let recoveryIndex = 0;
const recoveryFixture = () => {
  const directory = path.join(temp, "recovery-" + ++recoveryIndex);
  const repository = path.join(directory, "repo");
  const remote = path.join(directory, "remote.git");
  fs.mkdirSync(directory);
  mustRun("git", ["clone", "--branch", "codex/policy-self-test", hookRepo, repository]);
  const git = (...args) => mustRun("git", args, { cwd: repository }).stdout.trim();
  git("config", "user.name", "PFM Test");
  git("config", "user.email", "pfm@example.test");
  mustRun("git", ["init", "--bare", remote]);
  git("remote", "set-url", "origin", remote);
  git("push", "-u", "origin", "codex/policy-self-test");
  const bin = path.join(directory, "bin");
  const log = path.join(directory, "git-calls.txt");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "git"),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$PFM_TEST_GIT_LOG"\nexec "' + realGit + '" "$@"\n', { mode: 0o755 });
  const issue = path.join(directory, "issue.md");
  fs.writeFileSync(issue, prompt);
  const invoke = (event, extra = {}, env = {}) => {
    const result = mustRun("python3", [policy], { cwd: repository,
      input: JSON.stringify({ cwd: repository, session_id: "recovery", turn_id: "first",
        hook_event_name: event, ...extra }),
      env: { PFM_POLICY_TEST_ORIGIN: "https://github.com/bensmullen/personal-finance-app.git",
        PFM_POLICY_TEST_ISSUE_BODY_FILE: issue, PFM_TEST_GIT_LOG: log,
        PATH: bin + path.delimiter + process.env.PATH, ...env } });
    return JSON.parse(result.stdout);
  };
  const start = (extra = {}) => invoke("UserPromptSubmit", { prompt: "PFM_TASK_ISSUE: 85", ...extra });
  const accepted = start();
  assert(accepted.hookSpecificOutput?.additionalContext.includes("authorization accepted"), "clean starts unchanged");
  const dirty = () => fs.appendFileSync(path.join(repository, "src/allowed.ts"), "// interrupted work\n");
  const snapshot = () => ({ head: git("rev-parse", "HEAD"), status: git("status", "--porcelain=v1"),
    diff: git("diff"), staged: git("diff", "--cached") });
  const assertNoUnsafeCommands = () => {
    const calls = fs.readFileSync(log, "utf8").split("\n");
    assert(!calls.some((line) => /^(reset|clean|stash|checkout|switch|rebase|merge |cherry-pick|restore)\b/.test(line)
      || /--force|--amend|--delete/.test(line)), "recovery must not discard/rewrite/force work");
  };
  return { repository, remote, git, invoke, start, dirty, snapshot, issue, assertNoUnsafeCommands };
};

{
  const f = recoveryFixture();
  f.dirty();
  const dirtySession = f.invoke("SessionStart");
  assert(dirtySession.hookSpecificOutput?.additionalContext.includes("dirty=yes"), "interrupted session exposes dirty state");
  f.git("add", "src/allowed.ts");
  f.dirty();
  fs.mkdirSync(path.join(f.repository, "src/new"), { recursive: true });
  fs.writeFileSync(path.join(f.repository, "src/new", "space and\nnewline.ts"), "// preserved\n");
  const resumed = f.start({ session_id: "after-limit", turn_id: "second" });
  assert(resumed.hookSpecificOutput?.additionalContext.includes("authorization accepted"),
    "matching issue provenance must recover without any Stop event");
  const state = JSON.parse(fs.readFileSync(path.join(f.repository, ".codex/runtime/after-limit-second.json")));
  assert(state.BASE_HEAD === f.git("rev-parse", "HEAD") && f.git("status", "--porcelain") === "",
    "new BASE_HEAD must be checkpoint HEAD with a clean tree");
  assert(f.git("rev-parse", "HEAD") === f.git("rev-parse", "@{u}"), "checkpoint must be pushed");
  assert(f.git("log", "-1", "--format=%B").includes("WIP: checkpoint blocked PFM task #85"), "checkpoint label");
  const stop = f.invoke("Stop", { session_id: "after-limit", turn_id: "second",
    last_assistant_message: "TASK_STATUS: COMPLETE\nACCEPTANCE_STATUS: SATISFIED" });
  assert(stop.decision === "block" && stop.reason.includes("no implementation commit"),
    "recovery checkpoint cannot become the next turn's implementation");
  f.assertNoUnsafeCommands();
}

const rejectedRecovery = (label, arrange, expected, extra = {}, env = {}) => {
  const f = recoveryFixture();
  f.dirty();
  arrange(f);
  const before = f.snapshot();
  const response = f.invoke("UserPromptSubmit", { prompt: "PFM_TASK_ISSUE: 85", turn_id: "next", ...extra }, env);
  assert(response.decision === "block" && response.reason.includes(expected), label + ": " + JSON.stringify(response));
  assert(JSON.stringify(before) === JSON.stringify(f.snapshot()), label + " must not mutate Git/data");
  f.assertNoUnsafeCommands();
};
rejectedRecovery("outside dirty path", (f) => fs.writeFileSync(path.join(f.repository, "outside.txt"), "outside\n"), "outside.txt");
rejectedRecovery("protected product dirt", (f) => fs.writeFileSync(path.join(f.repository, ".codex/control.txt"), "control\n"), ".codex/control.txt");
rejectedRecovery("protected dirt despite broad product scope", (f) => {
  f.git("restore", "src/allowed.ts");
  fs.writeFileSync(f.issue, prompt.replace("- src/allowed.ts", "- ."));
  f.start();
  f.dirty();
  fs.writeFileSync(path.join(f.repository, ".codex/control.txt"), "control\n");
}, "protected control path");
rejectedRecovery("different task issue", () => {}, "provenance", { prompt: "PFM_TASK_ISSUE: 86" });
rejectedRecovery("different task branch", () => {}, "TASK_BRANCH_MISMATCH", {}, { PFM_POLICY_TEST_BRANCH: "codex/other" });
rejectedRecovery("missing prior provenance", (f) => fs.rmSync(path.join(f.repository, ".codex/runtime/latest-task.json")), "provenance");
rejectedRecovery("ambiguous prior provenance", (f) => fs.appendFileSync(path.join(f.repository, ".codex/runtime/recovery-first.json"), " "), "provenance");
rejectedRecovery("different worktree provenance", (f) => {
  const file = path.join(f.repository, ".codex/runtime/recovery-first.json");
  // A copied receipt/state is insufficient even with a valid digest.
  const data = JSON.parse(fs.readFileSync(file));
  data.WORKTREE = path.join(temp, "other-worktree");
  const serialized = JSON.stringify(data);
  fs.writeFileSync(file, serialized);
  fs.writeFileSync(path.join(f.repository, ".codex/runtime/latest-task.json"), JSON.stringify({
    path: "recovery-first.json", sha256: createHash("sha256").update(serialized).digest("hex"),
  }));
}, "provenance");
rejectedRecovery("conflict markers", (f) => fs.appendFileSync(path.join(f.repository, "src/allowed.ts"), "<<<<<<< ours\n=======\n>>>>>>> theirs\n"), "conflict markers");
rejectedRecovery("Git operation", (f) => fs.writeFileSync(path.join(f.repository, ".git/MERGE_HEAD"), f.git("rev-parse", "HEAD")), "MERGE_HEAD");
rejectedRecovery("unmerged index", (f) => {
  const blob = f.git("rev-parse", "HEAD:src/allowed.ts");
  mustRun("git", ["update-index", "--index-info"], { cwd: f.repository,
    input: `0 ${"0".repeat(40)}\tsrc/allowed.ts\n100644 ${blob} 1\tsrc/allowed.ts\n100644 ${blob} 2\tsrc/allowed.ts\n100644 ${blob} 3\tsrc/allowed.ts\n` });
}, "unmerged");
rejectedRecovery("locked dependencies", (f) => {
  fs.writeFileSync(path.join(f.repository, "package.json"), JSON.stringify({ dependencies: { unauthorized: "1.0.0" } }));
}, "locked dependency");
rejectedRecovery("locked staged dependencies", (f) => {
  const file = path.join(f.repository, "package.json");
  const original = fs.readFileSync(file);
  fs.writeFileSync(file, JSON.stringify({ dependencies: { unauthorized: "1.0.0" } }));
  f.git("add", "package.json");
  fs.writeFileSync(file, original);
}, "locked staged dependency");
rejectedRecovery("incoming scope narrower", (f) => fs.writeFileSync(f.issue, prompt.replace("- src/allowed.ts\n", "")), "src/allowed.ts");
rejectedRecovery("prior scope narrower", (f) => {
  fs.writeFileSync(f.issue, prompt.replace("- src/new/**\n", ""));
  // Reauthorize cleanly before interruption under a narrower prior contract.
  f.git("restore", "src/allowed.ts");
  f.start();
  fs.mkdirSync(path.join(f.repository, "src/new"), { recursive: true });
  fs.writeFileSync(path.join(f.repository, "src/new/new.ts"), "// outside prior scope\n");
  fs.writeFileSync(f.issue, prompt);
}, "src/new/new.ts");
rejectedRecovery("wrong origin", () => {}, "origin", {}, { PFM_POLICY_TEST_ORIGIN: "https://github.com/other/repository.git" });
rejectedRecovery("unknown/divergent remote", (f) => {
  const other = path.join(temp, "divergent-peer");
  mustRun("git", ["clone", "--branch", "codex/policy-self-test", f.remote, other]);
  mustRun("git", ["config", "user.name", "PFM Test"], { cwd: other });
  mustRun("git", ["config", "user.email", "pfm@example.test"], { cwd: other });
  fs.appendFileSync(path.join(other, "src/allowed.ts"), "// peer work\n");
  mustRun("git", ["add", "src/allowed.ts"], { cwd: other });
  mustRun("git", ["commit", "-m", "peer work"], { cwd: other });
  mustRun("git", ["push", "origin", "codex/policy-self-test"], { cwd: other });
}, "unknown or divergent");
rejectedRecovery("committed then reverted out-of-scope work", (f) => {
  fs.appendFileSync(path.join(f.repository, "src/outside.ts"), "// unrelated work\n");
  f.git("add", "src/outside.ts");
  f.git("commit", "-m", "unrelated commit");
  fs.writeFileSync(path.join(f.repository, "src/outside.ts"), f.git("show", "HEAD~1:src/outside.ts") + "\n");
  f.git("add", "src/outside.ts");
  f.git("commit", "-m", "undo unrelated work");
}, "src/outside.ts");

{
  const f = recoveryFixture();
  // Identical inline contracts have stable identity; different semantics do not.
  f.invoke("UserPromptSubmit", { prompt });
  f.dirty();
  const rejected = f.invoke("UserPromptSubmit", { prompt: prompt.replace("implementation only", "implementation differently"), turn_id: "different" });
  assert(rejected.decision === "block" && rejected.reason.includes("provenance"), "changed inline identity blocks");
  const recovered = f.invoke("UserPromptSubmit", { prompt, turn_id: "same" });
  assert(recovered.hookSpecificOutput?.additionalContext.includes("authorization accepted"), "identical inline task recovers");
  f.assertNoUnsafeCommands();
}

{
  const f = recoveryFixture();
  f.start({ turn_id: "superseding" });
  f.dirty();
  const before = f.snapshot();
  const staleStop = f.invoke("Stop", { last_assistant_message: "TASK_STATUS: BLOCKED\nBLOCKER: external decision" });
  assert(staleStop.decision === "block" && staleStop.reason.includes("superseded"), "old active turns cannot checkpoint a newer turn's work");
  assert(JSON.stringify(before) === JSON.stringify(f.snapshot()), "stale Stop must preserve all work");
  f.assertNoUnsafeCommands();
}

{
  const f = recoveryFixture();
  f.dirty();
  const rejectHook = path.join(f.remote, "hooks/pre-receive");
  fs.writeFileSync(rejectHook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const before = f.git("rev-parse", "HEAD");
  const failed = f.invoke("Stop", { last_assistant_message: "TASK_STATUS: BLOCKED\nLOOKUP_REQUIRED: external product decision" });
  assert(failed.decision === "block" && failed.reason.includes("checkpoint push failed")
    && failed.reason.includes("local commit/data preserved"), "push failure must report recoverable local work");
  const preserved = f.git("rev-parse", "HEAD");
  assert(before !== preserved && f.git("show", "HEAD:src/allowed.ts").includes("interrupted work"), "local checkpoint preserved");
  fs.rmSync(rejectHook);
  const retried = f.start({ turn_id: "retry" });
  assert(retried.hookSpecificOutput?.additionalContext.includes("authorization accepted")
    && f.git("rev-parse", "HEAD") === preserved && f.git("rev-parse", "@{u}") === preserved,
  "same task retries failed checkpoint push without another commit");
  f.assertNoUnsafeCommands();
}

{
  const f = recoveryFixture();
  const closed = f.invoke("Stop", { last_assistant_message: "TASK_STATUS: BLOCKED\nBLOCKER: external decision" });
  assert(closed.continue === true, "clean blocked behavior remains unchanged");
  f.dirty();
  const response = f.start({ turn_id: "after-closed" });
  assert(response.decision === "block" && response.reason.includes("provenance"), "closed old tasks cannot authorize fresh dirt");
  f.assertNoUnsafeCommands();
}

const taskSkill = fs.readFileSync(path.join(root, ".agents/skills/pfm-pr-task/SKILL.md"), "utf8");
const handoffPolicy = fs.readFileSync(path.join(root, "docs/development/handoff-authoring-policy.md"), "utf8");
const refinanceEscalation = [
  "DECISION_NEEDED: For the private-alpha refinance floor, should users be able to refinance only on a scheduled monthly mortgage payment date, or on any calendar date?",
  "PRODUCT_IMPACT: Payment-date-only refinancing is narrower but deterministic with the existing mortgage model; arbitrary dates are more realistic but require new partial-month interest semantics.",
  "OPTIONS: (A) scheduled payment dates only; (B) arbitrary dates with new stub/per-diem interest support.",
  "RECOMMENDATION: A for D1-B; defer arbitrary-date refinance to a later mortgage capability.",
  "TECHNICAL_REASON: the current authoritative mortgage engine models whole contractual months only.",
].join("\n");
assert(taskSkill.includes(refinanceEscalation), "refinance escalation must state product decision before technical constraints");
for (const text of [taskSkill, handoffPolicy]) {
  for (const field of ["DECISION_NEEDED:", "PRODUCT_IMPACT:", "OPTIONS:", "RECOMMENDATION:", "TECHNICAL_REASON:"]) {
    assert(text.includes(field), "PM escalation contract must include " + field);
  }
  assert(text.includes("user-visible financial meaning") && text.includes("ALLOWED_PATHS"),
    "implementation autonomy must preserve financial meaning and authorization");
}

const codexHome = path.join(temp, "codex-home");
const attachmentDir = path.join(codexHome, "attachments", "generated");
fs.mkdirSync(attachmentDir, { recursive: true });
const attachment = path.join(attachmentDir, "writing-block.md");
fs.writeFileSync(attachment, prompt);
const attachmentResult = hook(
  "UserPromptSubmit",
  { prompt: "Generated task transport: " + attachment },
  { CODEX_HOME: codexHome },
);
assert(
  String(attachmentResult?.hookSpecificOutput?.additionalContext ?? "").includes("trusted attachment"),
  "attachment parser should accept wrapper variants without exact heading syntax",
);
fs.appendFileSync(attachment, "\n# changed after authorization\n");
const attachmentMutation = hook(
  "PreToolUse",
  {
    tool_name: "apply_patch",
    tool_use_id: "attachment-mutated",
    tool_input: { command: "*** Begin Patch\\n*** Update File: src/allowed.ts\\n*** End Patch" },
  },
  { CODEX_HOME: codexHome },
);
assert(
  attachmentMutation?.hookSpecificOutput?.permissionDecision === "deny"
    && String(attachmentMutation?.hookSpecificOutput?.permissionDecisionReason ?? "").includes("TASK_ATTACHMENT_INTEGRITY"),
  "attachment-backed authorization must be hash-bound for mutation",
);

const bootstrapRoot = path.join(temp, "bootstrap");
const seed = path.join(bootstrapRoot, "seed");
const remote = path.join(bootstrapRoot, "remote.git");
const source = path.join(bootstrapRoot, "source");
fs.mkdirSync(seed, { recursive: true });
mustRun("git", ["init", "-b", "main"], { cwd: seed });
mustRun("git", ["config", "user.name", "PFM Test"], { cwd: seed });
mustRun("git", ["config", "user.email", "pfm@example.test"], { cwd: seed });
fs.writeFileSync(path.join(seed, "file.txt"), "one\n");
mustRun("git", ["add", "."], { cwd: seed });
mustRun("git", ["commit", "-m", "one"], { cwd: seed });
mustRun("git", ["init", "--bare", remote], { cwd: bootstrapRoot });
mustRun("git", ["remote", "add", "origin", remote], { cwd: seed });
mustRun("git", ["push", "-u", "origin", "main"], { cwd: seed });
mustRun("git", ["--git-dir", remote, "symbolic-ref", "HEAD", "refs/heads/main"], { cwd: bootstrapRoot });
mustRun("git", ["clone", remote, source], { cwd: bootstrapRoot });

const bootstrapEnv = { PFM_BOOTSTRAP_TEST_ALLOW_ANY_ORIGIN: "1" };
const targetOne = path.join(bootstrapRoot, "task-one");
const firstBootstrap = mustRun(
  "bash",
  [bootstrap, "new", "codex/task-one", targetOne],
  { cwd: source, env: bootstrapEnv },
);
assert(firstBootstrap.stdout.includes("PR_WORKTREE_READY mode=new"), "new bootstrap should return a ready receipt");

const linkedSessionPayload = JSON.stringify({
  session_id: "linked-worktree-session",
  turn_id: "linked-worktree-turn",
  cwd: targetOne,
  hook_event_name: "SessionStart",
  permission_mode: "default",
});
const linkedSessionResult = run("python3", [policy], {
  cwd: targetOne,
  input: linkedSessionPayload,
  env: { PFM_POLICY_TEST_ORIGIN: "https://github.com/bensmullen/personal-finance-app.git" },
});
assert(linkedSessionResult.status === 0, "linked worktree SessionStart should succeed");
const linkedSession = JSON.parse(linkedSessionResult.stdout || "{}");
const linkedContext = String(linkedSession?.hookSpecificOutput?.additionalContext ?? "");
assert(
  linkedContext.includes("already a clean linked feature worktree")
    && linkedContext.includes("Treat Git bootstrap as satisfied")
    && linkedContext.includes("Do not run tools/codex/bootstrap-pr.sh inside the implementation turn"),
  "prepared linked worktree must be reported as bootstrap-ready without in-turn bootstrap instructions",
);

const firstBase = mustRun("git", ["-C", targetOne, "rev-parse", "HEAD"]).stdout.trim();
assert(
  firstBase === mustRun("git", ["-C", source, "rev-parse", "origin/main"]).stdout.trim(),
  "new PR must start at fetched origin/main",
);

fs.writeFileSync(path.join(seed, "file.txt"), "two\n");
mustRun("git", ["add", "file.txt"], { cwd: seed });
mustRun("git", ["commit", "-m", "two"], { cwd: seed });
mustRun("git", ["push", "origin", "main"], { cwd: seed });
const staleLocalMain = mustRun("git", ["-C", source, "rev-parse", "main"]).stdout.trim();

const targetTwo = path.join(bootstrapRoot, "task-two");
mustRun("bash", [bootstrap, "new", "codex/task-two", targetTwo], { cwd: source, env: bootstrapEnv });
const secondBase = mustRun("git", ["-C", targetTwo, "rev-parse", "HEAD"]).stdout.trim();
assert(secondBase !== staleLocalMain, "bootstrap must not use stale local main");
assert(
  secondBase === mustRun("git", ["-C", source, "rev-parse", "origin/main"]).stdout.trim(),
  "bootstrap must fetch and pin the current origin/main commit",
);

mustRun("git", ["-C", targetTwo, "config", "user.name", "PFM Test"]);
mustRun("git", ["-C", targetTwo, "config", "user.email", "pfm@example.test"]);
fs.writeFileSync(path.join(targetTwo, "feature.txt"), "feature\n");
mustRun("git", ["-C", targetTwo, "add", "feature.txt"]);
mustRun("git", ["-C", targetTwo, "commit", "-m", "feature"]);
mustRun("git", ["-C", targetTwo, "push", "-u", "origin", "codex/task-two"]);
const remoteFeatureHead = mustRun("git", ["-C", targetTwo, "rev-parse", "HEAD"]).stdout.trim();
mustRun("git", ["-C", source, "worktree", "remove", targetTwo]);

const resumed = path.join(bootstrapRoot, "task-two-resumed");
const resumeResult = mustRun(
  "bash",
  [bootstrap, "resume", "codex/task-two", resumed],
  { cwd: source, env: bootstrapEnv },
);
assert(resumeResult.stdout.includes("PR_WORKTREE_READY mode=resume"), "resume should return a ready receipt");
assert(
  mustRun("git", ["-C", resumed, "rev-parse", "HEAD"]).stdout.trim() === remoteFeatureHead,
  "resume must use the fetched remote feature head",
);

fs.writeFileSync(path.join(resumed, "local-only.txt"), "local\n");
mustRun("git", ["-C", resumed, "add", "local-only.txt"]);
mustRun("git", ["-C", resumed, "commit", "-m", "local only"]);
const unsafeResume = run(
  "bash",
  [bootstrap, "resume", "codex/task-two", resumed],
  { cwd: source, env: bootstrapEnv },
);
assert(
  unsafeResume.status !== 0 && unsafeResume.stderr.includes("unpushed local commits"),
  "resume must never overwrite unpushed local commits",
);

const selfTarget = run(
  "bash",
  [bootstrap, "new", "codex/self-target", source],
  { cwd: source, env: bootstrapEnv },
);
assert(
  selfTarget.status !== 0 && selfTarget.stderr.includes("current/source checkout"),
  "bootstrap must never replace its own source checkout",
);

fs.rmSync(temp, { recursive: true, force: true });
console.log(
  "PASS codex tooling — V3 scope authorization, issue-pointer transport, guarded interruption recovery/checkpoints, PM escalation policy, completion enforcement, untracked scope detection, publication safety, attachment compatibility, and origin-based PR bootstrap",
);
