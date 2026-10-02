import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const policy = path.join(root, ".codex", "hooks", "pfm-policy.py");
const stateShell = path.join(root, "tools", "codex", "state.sh");
const envDoctor = path.join(root, "tools", "codex", "env-doctor.sh");
const lessonsValidator = path.join(root, "tools", "codex", "validate-agent-lessons.mjs");

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const run = (command, args = [], options = {}) => spawnSync(command, args, {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, ...options.env },
  input: options.input ?? "",
});

for (const [command, args] of [
  ["python3", ["-c", 'import ast,pathlib,sys; ast.parse(pathlib.Path(sys.argv[1]).read_text())', policy]],
  ["bash", ["-n", stateShell]],
  ["bash", ["-n", envDoctor]],
  ["bash", [envDoctor]],
  ["node", [lessonsValidator]],
]) {
  const result = run(command, args);
  assert(result.status === 0, `${command} ${args.join(" ")} failed: ${result.stderr}`);
}

const head = run("git", ["rev-parse", "HEAD"]).stdout.trim();
assert(/^[0-9a-f]{40}$/.test(head), "unable to resolve HEAD");

const sessionId = "policy-self-test";
const turnId = "turn-1";
const hook = (event, extra = {}, env = {}) => {
  const payload = JSON.stringify({
    session_id: sessionId,
    turn_id: turnId,
    cwd: root,
    hook_event_name: event,
    permission_mode: "default",
    ...extra,
  });
  const result = run("python3", [policy], { input: payload, env });
  assert(result.status === 0, `${event} hook failed: ${result.stderr}`);
  return JSON.parse(result.stdout || "{}");
};

const malformed = hook("UserPromptSubmit", { prompt: "PFM_TASK_V2\nMODE: local" });
assert(malformed.decision === "block", "malformed V2 prompt should be blocked");

const prompt = `PFM_TASK_V2
TASK_KIND: framework
MODE: local
SEMANTICS: resolved
REPAIR_ROUND: 0
TASK_CONTINUITY: existing_pr
TARGET_BRANCH: agent/policy-self-test
WORKTREE_POLICY: current
EXPECTED_HEAD: ${head}
DEPENDENCY_POLICY: manifest_edit
DISCOVERY_POLICY: implementation_only
LOCAL_EXECUTION_POLICY: no_tests
CI_PROFILE: tooling
HEAVY_VALIDATION_PROFILE: none
UAT: not_required
LESSONS_APPLIED: none

READ_PATHS:
- package.json
- tools/codex/**
- .codex/**
- tools/ci/**

ALLOWED_PATHS:
- tools/codex/**
- .codex/**
- tools/ci/**

OBJECTIVE:
Exercise the repository policy hook without modifying the tree.

RESOLVED_DECISIONS:
The hook contract is already resolved.

REQUIREMENT_MAP:
- POLICY-V2 -> validate task envelope and resource guardrails -> codex-tooling self-test

FAILURE_MODES:
- Malformed envelopes and unsafe actions are blocked before repository mutation.

CLAIMS_AND_GAPS:
CLAIMS: The self-test covers the guarded V2 lifecycle.
KNOWN_GAPS: It does not prove application financial behavior.
EVIDENCE: codex-tooling CI executes the policy self-test.

PROFILE_CONTRACT:
POLICY_BOUNDARY: Project-local Codex implementation and publication behavior only.
FAIL_CLOSED: Unsafe mutation/publication and malformed contracts are denied.
SELF_TEST: The codex-tooling job exercises the policy decisions.

EVIDENCE_PLAN:
CI: codex-tooling plus conservative routed framework gates.
HEAVY: none.
UAT: not_required.

ACCEPTANCE:
Policy events return the expected decisions.

OUT_OF_SCOPE:
Application changes.

STOP:
Stop on any policy mismatch.
`;

const policyTestEnv = {
  PFM_POLICY_TEST_BRANCH: "agent/policy-self-test",
  PFM_POLICY_TEST_ORIGIN: "https://github.com/bensmullen/personal-finance-app.git",
  PFM_POLICY_TEST_LINKED_WORKTREE: "1",
};

const attachmentHome = fs.mkdtempSync(path.join(os.tmpdir(), "pfm-policy-attachments-"));
const attachmentRoot = path.join(attachmentHome, "attachments", "self-test");
fs.mkdirSync(attachmentRoot, { recursive: true });
const attachmentEnv = { ...policyTestEnv, CODEX_HOME: attachmentHome };
const attachmentWrapper = (entries) => "# Files mentioned by the user:\n\n"
  + entries.map(({ label, file }) => "## " + label + ": " + file).join("\n\n")
  + "\n\nThe attached pasted text file(s) contain the user's request. Read and act on that content.\n\n## My request for Codex:\n";
const writeAttachment = (directory, name, content) => {
  const targetDir = path.join(attachmentRoot, directory);
  fs.mkdirSync(targetDir, { recursive: true });
  const target = path.join(targetDir, name);
  fs.writeFileSync(target, content);
  return target;
};

const accepted = hook("UserPromptSubmit", { prompt }, policyTestEnv);
assert(
  accepted?.hookSpecificOutput?.hookEventName === "UserPromptSubmit",
  "valid V2 prompt was not accepted",
);

const pastedTextPath = writeAttachment("valid-pasted", "pasted-text.txt", prompt);
const pastedAccepted = hook("UserPromptSubmit", {
  prompt: attachmentWrapper([{ label: "Pasted task", file: pastedTextPath }]),
}, attachmentEnv);
assert(
  pastedAccepted?.hookSpecificOutput?.additionalContext?.includes("trusted Codex long-paste attachment"),
  "valid pasted-text.txt V2 envelope was not accepted",
);

const writingBlockPath = writeAttachment("valid-writing", "writing-block.md", prompt);
const writingAccepted = hook("UserPromptSubmit", {
  prompt: attachmentWrapper([{ label: "Writing block", file: writingBlockPath }]),
}, attachmentEnv);
assert(
  writingAccepted?.hookSpecificOutput?.additionalContext?.includes("trusted Codex long-paste attachment"),
  "valid writing-block.md V2 envelope was not accepted",
);

const inlinePrefixAccepted = hook("UserPromptSubmit", {
  prompt: attachmentWrapper([{ label: "PFM_TASK_V2", file: pastedTextPath }]),
}, attachmentEnv);
assert(
  inlinePrefixAccepted?.hookSpecificOutput?.additionalContext?.includes("trusted Codex long-paste attachment"),
  "inline PFM_TASK_V2 prefix plus attachment should fall back to the complete attachment",
);

const ambiguous = hook("UserPromptSubmit", {
  prompt: attachmentWrapper([
    { label: "First pasted task", file: pastedTextPath },
    { label: "Second pasted task", file: writingBlockPath },
  ]),
}, attachmentEnv);
assert(
  ambiguous.decision === "block" && String(ambiguous.reason).includes("TASK_ATTACHMENT_AMBIGUOUS"),
  "multiple generated task attachments should be blocked",
);

const outsideDir = path.join(attachmentHome, "outside");
fs.mkdirSync(outsideDir, { recursive: true });
const outsideFile = path.join(outsideDir, "pasted-text.txt");
fs.writeFileSync(outsideFile, prompt);
const traversalPath = attachmentRoot + path.sep + ".." + path.sep + ".." + path.sep + "outside" + path.sep + "pasted-text.txt";
const outsideAttachment = hook("UserPromptSubmit", {
  prompt: attachmentWrapper([{ label: "PFM_TASK_V2", file: traversalPath }]),
}, attachmentEnv);
assert(
  outsideAttachment.decision === "block" && String(outsideAttachment.reason).includes("TASK_ATTACHMENT_OUTSIDE_ROOT"),
  "traversal/outside-root task attachment should be blocked",
);

const symlinkTarget = writeAttachment("symlink-target", "target.txt", prompt);
const symlinkDir = path.join(attachmentRoot, "symlink-case");
fs.mkdirSync(symlinkDir, { recursive: true });
const symlinkPath = path.join(symlinkDir, "pasted-text.txt");
fs.symlinkSync(symlinkTarget, symlinkPath);
const symlinked = hook("UserPromptSubmit", {
  prompt: attachmentWrapper([{ label: "PFM_TASK_V2", file: symlinkPath }]),
}, attachmentEnv);
assert(
  symlinked.decision === "block" && String(symlinked.reason).includes("TASK_ATTACHMENT_SYMLINK"),
  "symlinked task attachment should be blocked",
);

const missingPath = path.join(attachmentRoot, "missing", "pasted-text.txt");
const missing = hook("UserPromptSubmit", {
  prompt: attachmentWrapper([{ label: "PFM_TASK_V2", file: missingPath }]),
}, attachmentEnv);
assert(
  missing.decision === "block" && String(missing.reason).includes("TASK_ATTACHMENT_MISSING"),
  "missing task attachment should be blocked",
);

const nonUtf8Path = writeAttachment("non-utf8", "pasted-text.txt", Buffer.from([0xff, 0xfe, 0xfd]));
const nonUtf8 = hook("UserPromptSubmit", {
  prompt: attachmentWrapper([{ label: "PFM_TASK_V2", file: nonUtf8Path }]),
}, attachmentEnv);
assert(
  nonUtf8.decision === "block" && String(nonUtf8.reason).includes("TASK_ATTACHMENT_ENCODING"),
  "non-UTF8 task attachment should be blocked",
);

const oversizePath = writeAttachment("oversize", "pasted-text.txt", Buffer.alloc(256 * 1024 + 1, 0x61));
const oversize = hook("UserPromptSubmit", {
  prompt: attachmentWrapper([{ label: "PFM_TASK_V2", file: oversizePath }]),
}, attachmentEnv);
assert(
  oversize.decision === "block" && String(oversize.reason).includes("TASK_ATTACHMENT_TOO_LARGE"),
  "oversized task attachment should be blocked",
);

const malformedPath = writeAttachment("malformed", "pasted-text.txt", "PFM_TASK_V2\nMODE: local\n");
const malformedAttachment = hook("UserPromptSubmit", {
  prompt: attachmentWrapper([{ label: "Pasted task", file: malformedPath }]),
}, attachmentEnv);
assert(
  malformedAttachment.decision === "block" && String(malformedAttachment.reason).includes("Invalid attachment-backed PFM_TASK_V2 envelope"),
  "malformed attachment-backed envelope should be blocked by normal V2 validation",
);

const mutablePath = writeAttachment("mutable", "pasted-text.txt", prompt);
const mutableAccepted = hook("UserPromptSubmit", {
  prompt: attachmentWrapper([{ label: "Pasted task", file: mutablePath }]),
}, attachmentEnv);
assert(
  mutableAccepted?.hookSpecificOutput?.additionalContext?.includes("trusted Codex long-paste attachment"),
  "mutable attachment fixture should initially be accepted",
);
fs.appendFileSync(mutablePath, "\n# changed after validation\n");
const mutatedPreTool = hook("PreToolUse", {
  tool_name: "apply_patch",
  tool_use_id: "attachment-integrity",
  tool_input: { command: "*** Begin Patch\n*** Update File: tools/codex/state.sh\n*** End Patch" },
}, attachmentEnv);
assert(
  mutatedPreTool?.hookSpecificOutput?.permissionDecision === "deny"
    && String(mutatedPreTool?.hookSpecificOutput?.permissionDecisionReason ?? "").includes("TASK_ATTACHMENT_INTEGRITY"),
  "changed task attachment should be denied before repository mutation",
);

const publishPath = writeAttachment("publish-mutable", "pasted-text.txt", prompt);
const publishAccepted = hook("UserPromptSubmit", {
  prompt: attachmentWrapper([{ label: "Pasted task", file: publishPath }]),
}, attachmentEnv);
assert(
  publishAccepted?.hookSpecificOutput?.additionalContext?.includes("trusted Codex long-paste attachment"),
  "publication integrity fixture should initially be accepted",
);
fs.appendFileSync(publishPath, "\n# changed before publication\n");
const mutatedPublication = hook("PermissionRequest", {
  tool_name: "Bash",
  tool_input: { command: "git push -u origin agent/policy-self-test" },
}, attachmentEnv);
assert(
  mutatedPublication?.hookSpecificOutput?.decision?.behavior === "deny"
    && String(mutatedPublication?.hookSpecificOutput?.decision?.message ?? "").includes("TASK_ATTACHMENT_INTEGRITY"),
  "changed task attachment should be denied before publication",
);

const performancePrompt = prompt
  .replace("TASK_KIND: framework", "TASK_KIND: repair")
  .replace("REPAIR_ROUND: 0", "REPAIR_ROUND: 1")
  .replace("CI_PROFILE: tooling", "CI_PROFILE: deterministic")
  .replace("HEAVY_VALIDATION_PROFILE: none", "HEAVY_VALIDATION_PROFILE: performance")
  .replace("LESSONS_APPLIED: none", "LESSONS_APPLIED: AL-001")
  .replace("READ_PATHS:\n- package.json\n- tools/codex/**\n- .codex/**\n- tools/ci/**", "READ_PATHS:\n- test/**")
  .replace("ALLOWED_PATHS:\n- tools/codex/**\n- .codex/**\n- tools/ci/**", "ALLOWED_PATHS:\n- test/**")
  .replace(/PROFILE_CONTRACT:\n[\s\S]*?\nEVIDENCE_PLAN:/, `PROFILE_CONTRACT:
CI_WORK_BOUNDARY: ordinary CI uses bounded deterministic smoke only.
HEAVY_WORK_BOUNDARY: full representative and scaling workloads run only in engineering-validation.
BOUNDARIES: sibling measurements are explicitly non-overlapping.
APPLICABILITY: unavailable transport is not_applicable, never a surrogate duration.
SUCCESS_STATUS: only completed representative runs are valid baseline evidence.
CONTEXT_RETENTION: artifact/UI preserve horizon, versions, runtime, location, cache state, and model counts.
RESOURCE_SEMANTICS: memory/cost fields state absolute/delta/metering semantics.
CONTROLLED_EVIDENCE: full capture runs in engineering-validation, never under Codex.

EVIDENCE_PLAN:`);
const performanceAccepted = hook("UserPromptSubmit", { prompt: performancePrompt }, policyTestEnv);
assert(
  performanceAccepted?.hookSpecificOutput?.hookEventName === "UserPromptSubmit",
  "complete performance profile contract should be accepted",
);

const incompletePerformance = performancePrompt.replace(
  "CONTROLLED_EVIDENCE: full capture runs in engineering-validation, never under Codex.",
  "CONTROLLED EVIDENCE omitted.",
);
const performanceBlocked = hook("UserPromptSubmit", { prompt: incompletePerformance }, policyTestEnv);
assert(performanceBlocked.decision === "block", "incomplete performance profile contract should be blocked");

const missingLesson = hook("UserPromptSubmit", {
  prompt: performancePrompt.replace("LESSONS_APPLIED: AL-001", "LESSONS_APPLIED: none"),
}, policyTestEnv);
assert(missingLesson.decision === "block", "applicable active lesson omission should be blocked");

const missingLessonMarker = hook("UserPromptSubmit", {
  prompt: performancePrompt.replace("CI_WORK_BOUNDARY:", "CI WORK BOUNDARY omitted:"),
}, policyTestEnv);
assert(missingLessonMarker.decision === "block", "active lesson required marker omission should be blocked");

const wrongWorktreePrompt = prompt.replace("TARGET_BRANCH: agent/policy-self-test", "TARGET_BRANCH: agent/existing-pr");
const wrongWorktree = hook("UserPromptSubmit", { prompt: wrongWorktreePrompt }, {
  ...policyTestEnv,
  PFM_POLICY_TEST_BRANCH: "main",
});
assert(wrongWorktree.decision === "block" && String(wrongWorktree.reason).includes("WRONG_WORKTREE"), "existing PR wrong worktree should be blocked clearly");

const bootstrapPrompt = prompt
  .replace("TASK_CONTINUITY: existing_pr", "TASK_CONTINUITY: new_pr")
  .replace("TARGET_BRANCH: agent/policy-self-test", "TARGET_BRANCH: agent/new-policy-branch")
  .replace("WORKTREE_POLICY: current", "WORKTREE_POLICY: isolated");
const noWorktree = hook("UserPromptSubmit", { prompt: bootstrapPrompt }, {
  ...policyTestEnv,
  PFM_POLICY_TEST_BRANCH: "main",
  PFM_POLICY_TEST_LINKED_WORKTREE: "0",
});
assert(noWorktree.decision === "block" && String(noWorktree.reason).includes("WORKTREE_REQUIRED"), "isolated task should require a linked worktree");

const bootstrapAccepted = hook("UserPromptSubmit", { prompt: bootstrapPrompt }, {
  ...policyTestEnv,
  PFM_POLICY_TEST_BRANCH: "main",
});
assert(
  bootstrapAccepted?.hookSpecificOutput?.additionalContext?.includes("git switch -c agent/new-policy-branch"),
  "new PR linked worktree should receive exact branch bootstrap",
);
const bootstrapPre = hook("PreToolUse", {
  tool_name: "Bash",
  tool_use_id: "bootstrap",
  tool_input: { command: "git switch -c agent/new-policy-branch" },
}, {
  ...policyTestEnv,
  PFM_POLICY_TEST_BRANCH: "main",
});
assert(JSON.stringify(bootstrapPre) === "{}", "exact new-PR branch bootstrap should be allowed");
const bootstrapPost = hook("PostToolUse", {
  tool_name: "Bash",
  tool_use_id: "bootstrap",
  tool_input: { command: "git switch -c agent/new-policy-branch" },
}, {
  ...policyTestEnv,
  PFM_POLICY_TEST_BRANCH: "agent/new-policy-branch",
});
assert(JSON.stringify(bootstrapPost) === "{}", "successful bootstrap should activate the target branch state");

const pre = (command) => hook("PreToolUse", {
  tool_name: "Bash",
  tool_use_id: "tool-1",
  tool_input: { command },
});

for (const command of [
  "npm test",
  "npm run typecheck",
  "npx vitest run test/state.test.ts",
  "npm ci",
]) {
  const output = pre(command);
  assert(output?.hookSpecificOutput?.permissionDecision === "deny", `${command} should be denied`);
}

const normative = pre("cat docs/specs/roadmap/post-pr21-implementation-roadmap.md");
assert(normative?.hookSpecificOutput?.permissionDecision === "deny", "resolved task should block normative reread");

const outside = pre("cat docs/development/agent-framework-optimization.md");
assert(outside?.hookSpecificOutput?.permissionDecision === "deny", "read outside READ_PATHS should be denied");

assert(JSON.stringify(pre("cat package.json")) === "{}", "allowed read should pass");

const badPatch = hook("PreToolUse", {
  tool_name: "apply_patch",
  tool_use_id: "tool-2",
  tool_input: { command: "*** Begin Patch\n*** Update File: src/index.ts\n*** End Patch" },
});
assert(badPatch?.hookSpecificOutput?.permissionDecision === "deny", "out-of-scope patch should be denied");

const testEnv = {
  ...policyTestEnv,
  PFM_POLICY_TEST_BRANCH: "codex/policy-self-test",
};
const safePush = hook("PermissionRequest", {
  tool_name: "Bash",
  tool_input: { command: "git push -u origin codex/policy-self-test" },
}, testEnv);
assert(
  safePush?.hookSpecificOutput?.decision?.behavior === "allow",
  "approved feature-branch push should be auto-allowed",
);

const safeRefspecPush = hook("PermissionRequest", {
  tool_name: "Bash",
  tool_input: { command: "git push origin codex/policy-self-test:refs/heads/codex/policy-self-test" },
}, testEnv);
assert(
  safeRefspecPush?.hookSpecificOutput?.decision?.behavior === "allow",
  "approved fully-qualified feature-branch refspec should be auto-allowed",
);

const safePr = hook("PermissionRequest", {
  tool_name: "Bash",
  tool_input: { command: 'gh pr create --repo bensmullen/personal-finance-app --base main --head codex/policy-self-test --title "Policy test" --body "Test"' },
}, testEnv);
assert(
  safePr?.hookSpecificOutput?.decision?.behavior === "allow",
  "approved feature-branch PR creation should be auto-allowed",
);

const unsafePush = hook("PermissionRequest", {
  tool_name: "Bash",
  tool_input: { command: "git push --force origin main" },
}, testEnv);
assert(
  unsafePush?.hookSpecificOutput?.decision?.behavior === "deny",
  "force/main push should be denied",
);

const compact = hook("PreCompact", { trigger: "auto" });
assert(compact.continue === false, "automatic compaction should stop an active PFM task");

fs.rmSync(attachmentHome, { recursive: true, force: true });
console.log("PASS codex tooling — V2 envelope, trusted long-paste attachments, environment, execution, read/scope, push, and compaction guards");
