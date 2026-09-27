import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const policy = path.join(root, ".codex", "hooks", "pfm-policy.py");
const stateShell = path.join(root, "tools", "codex", "state.sh");
const envDoctor = path.join(root, "tools", "codex", "env-doctor.sh");

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
EXPECTED_HEAD: ${head}
DEPENDENCY_POLICY: manifest_edit
DISCOVERY_POLICY: implementation_only
LOCAL_EXECUTION_POLICY: no_tests
CI_PROFILE: tooling
HEAVY_VALIDATION_PROFILE: none
UAT: not_required

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

const accepted = hook("UserPromptSubmit", { prompt });
assert(
  accepted?.hookSpecificOutput?.hookEventName === "UserPromptSubmit",
  "valid V2 prompt was not accepted",
);

const performancePrompt = prompt
  .replace("CI_PROFILE: tooling", "CI_PROFILE: deterministic")
  .replace("HEAVY_VALIDATION_PROFILE: none", "HEAVY_VALIDATION_PROFILE: performance")
  .replace(/PROFILE_CONTRACT:\n[\s\S]*?\nEVIDENCE_PLAN:/, `PROFILE_CONTRACT:
BOUNDARIES: sibling measurements are explicitly non-overlapping.
APPLICABILITY: unavailable transport is not_applicable, never a surrogate duration.
SUCCESS_STATUS: only completed representative runs are valid baseline evidence.
CONTEXT_RETENTION: artifact/UI preserve horizon, versions, runtime, location, cache state, and model counts.
RESOURCE_SEMANTICS: memory/cost fields state absolute/delta/metering semantics.
CONTROLLED_EVIDENCE: full capture runs in engineering-validation, never under Codex.

EVIDENCE_PLAN:`);
const performanceAccepted = hook("UserPromptSubmit", { prompt: performancePrompt });
assert(
  performanceAccepted?.hookSpecificOutput?.hookEventName === "UserPromptSubmit",
  "complete performance profile contract should be accepted",
);

const incompletePerformance = performancePrompt.replace(
  "CONTROLLED_EVIDENCE: full capture runs in engineering-validation, never under Codex.",
  "CONTROLLED EVIDENCE omitted.",
);
const performanceBlocked = hook("UserPromptSubmit", { prompt: incompletePerformance });
assert(performanceBlocked.decision === "block", "incomplete performance profile contract should be blocked");

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
  PFM_POLICY_TEST_BRANCH: "codex/policy-self-test",
  PFM_POLICY_TEST_ORIGIN: "https://github.com/bensmullen/personal-finance-app.git",
};
const safePush = hook("PermissionRequest", {
  tool_name: "Bash",
  tool_input: { command: "git push -u origin codex/policy-self-test" },
}, testEnv);
assert(
  safePush?.hookSpecificOutput?.decision?.behavior === "allow",
  "approved feature-branch push should be auto-allowed",
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

console.log("PASS codex tooling — V2 envelope, environment, execution, read/scope, push, and compaction guards");
