import { spawnSync } from "node:child_process";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "../..");
const hookPath = path.join(root, ".codex", "hooks", "quiet-test.mjs");
const quietVitestPath = path.join(root, "tools", "codex", "quiet-vitest.mjs");
const smokeTestPath = path.join(root, "test", ".codex-quiet-smoke.test.ts");
const logsDirectory = path.join(root, ".codex", "logs");

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const runNode = (script, args = [], input = "") => spawnSync(
  process.execPath,
  [script, ...args],
  {
    cwd: root,
    encoding: "utf8",
    input,
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  },
);

const hookPayload = (command) => JSON.stringify({
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_input: { command, timeout: 123 },
});

const hookResult = (input) => {
  const result = runNode(hookPath, [], input);
  assert(result.status === 0, `hook exited ${result.status}: ${result.stderr}`);
  return JSON.parse(result.stdout || "{}");
};

for (const command of ["npm test", "npm run test"]) {
  const output = hookResult(hookPayload(command));
  const updated = output?.hookSpecificOutput?.updatedInput;
  assert(updated?.command === "npm run codex:test", `${command} was not rewritten`);
  assert(updated?.timeout === 123, `${command} rewrite did not preserve tool input`);
  assert(output?.hookSpecificOutput?.permissionDecision === "allow", `${command} was not explicitly allowed`);
}

assert(
  JSON.stringify(hookResult(hookPayload("npx vitest run test/state.test.ts"))) === "{}",
  "targeted Vitest command should remain unchanged",
);
assert(JSON.stringify(hookResult("not-json")) === "{}", "malformed hook input should fail open quietly");

await mkdir(path.dirname(smokeTestPath), { recursive: true });

try {
  await writeFile(
    smokeTestPath,
    'import { expect, test } from "vitest";\ntest("quiet pass", () => expect(2 + 2).toBe(4));\n',
    "utf8",
  );
  const passing = runNode(quietVitestPath, ["test/.codex-quiet-smoke.test.ts"]);
  assert(passing.status === 0, `quiet Vitest pass case failed: ${passing.stderr}`);
  assert(/^PASS vitest — \d+\/\d+ tests \/ \d+ files\s*$/.test(passing.stdout), "quiet pass output was not compact");
  assert(!passing.stderr.trim(), "quiet pass unexpectedly wrote stderr");

  await writeFile(
    smokeTestPath,
    'import { expect, test } from "vitest";\ntest("quiet failure", () => expect("actual").toBe("expected"));\n',
    "utf8",
  );
  const failing = runNode(quietVitestPath, ["test/.codex-quiet-smoke.test.ts"]);
  assert(failing.status !== 0, "quiet Vitest failure case unexpectedly passed");
  assert(failing.stderr.startsWith("FAIL vitest — "), "quiet failure did not emit the compact failure header");
  assert(failing.stderr.includes("Full report: .codex/logs/"), "quiet failure did not retain a report path");
  assert(failing.stderr.includes("Full log: .codex/logs/"), "quiet failure did not retain a log path");
  assert(failing.stderr.length <= 12 * 1024, `quiet failure output exceeded bound: ${failing.stderr.length} bytes`);

  for (const prefix of ["Full report: ", "Full log: "]) {
    const line = failing.stderr.split(/\r?\n/).find((entry) => entry.startsWith(prefix));
    const relativePath = line?.slice(prefix.length).trim();
    assert(relativePath, `missing retained path for ${prefix.trim()}`);
    await access(path.join(root, relativePath));
  }
} finally {
  await rm(smokeTestPath, { force: true });
  await rm(logsDirectory, { recursive: true, force: true });
}

console.log("PASS codex tooling — hook rewrite and quiet Vitest pass/fail paths");
