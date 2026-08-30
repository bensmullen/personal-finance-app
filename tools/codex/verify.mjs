import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "../..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const git = process.platform === "win32" ? "git.exe" : "git";
const quietVitest = path.join(root, "tools", "codex", "quiet-vitest.mjs");
const maxFailureOutput = 8 * 1024;

const gates = [
  { label: "spec", command: npm, args: ["run", "spec:validate"] },
  { label: "architecture", command: npm, args: ["run", "architecture:validate"] },
  { label: "typecheck", command: npm, args: ["run", "typecheck"] },
  { label: "tests", command: process.execPath, args: [quietVitest], compactOutput: true },
  { label: "web-build", command: npm, args: ["run", "build:web"] },
  { label: "diff-check", command: git, args: ["diff", "--check", "HEAD"] },
];

const clip = (value) => {
  const text = String(value ?? "").trim();
  return text.length <= maxFailureOutput
    ? text
    : `${text.slice(0, maxFailureOutput)}\n… output clipped …`;
};

for (const gate of gates) {
  const result = spawnSync(gate.command, gate.args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();

  if (result.status !== 0) {
    console.error(`FAIL ${gate.label}`);
    if (output) console.error(clip(output));
    else if (result.error) console.error(clip(result.error.stack || result.error.message));
    console.error("\nVerification stopped.");
    process.exit(1);
  }

  if (gate.compactOutput && output.startsWith("PASS vitest — ")) {
    console.log(`PASS tests — ${output.slice("PASS vitest — ".length)}`);
  } else {
    console.log(`PASS ${gate.label}`);
  }
}

console.log("\nVERIFIED");
