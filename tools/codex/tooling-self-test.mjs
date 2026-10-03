import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
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
mustRun("git", ["remote", "add", "origin", "https://github.com/bensmullen/personal-finance-app.git"], { cwd: hookRepo });
mustRun("git", ["add", "."], { cwd: hookRepo });
mustRun("git", ["commit", "-m", "base"], { cwd: hookRepo });
mustRun("git", ["switch", "-c", "codex/policy-self-test"], { cwd: hookRepo });
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
  const result = run("python3", [policy], { cwd: hookRepo, input: payload, env });
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
  "",
  "OBJECTIVE:",
  "Change the authorized implementation only.",
  "",
  "ACCEPTANCE:",
  "Authorized changes are committed and pushed.",
  "",
].join("\n");

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

fs.writeFileSync(path.join(hookRepo, "src", "allowed.ts"), "export const value = 3;\n");
const dirtyBlocked = hook("Stop", {
  last_assistant_message: "TASK_STATUS: BLOCKED\nBLOCKER: external semantic decision required",
  stop_hook_active: false,
});
assert(
  dirtyBlocked.decision === "block" && String(dirtyBlocked.reason).includes("working tree is dirty"),
  "BLOCKED must leave a clean/shared state",
);
mustRun("git", ["restore", "src/allowed.ts"], { cwd: hookRepo });

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
  "PASS codex tooling — V3 scope authorization, completion enforcement, untracked scope detection, publication safety, robust attachment transport, and origin-based PR bootstrap",
);
