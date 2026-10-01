import { appendFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const base = value("--base");
const head = value("--head") ?? "HEAD";
const output = value("--github-output") ?? process.env.GITHUB_OUTPUT;

const git = (gitArgs) => spawnSync("git", gitArgs, { encoding: "utf8" });
let files = [];
if (base && !/^0+$/.test(base)) {
  const result = git(["diff", "--name-only", `${base}...${head}`]);
  if (result.status === 0) files = result.stdout.split(/\r?\n/).filter(Boolean);
}
if (files.length === 0) {
  const result = git(["diff", "--name-only", "HEAD^", head]);
  if (result.status === 0) files = result.stdout.split(/\r?\n/).filter(Boolean);
}

const gates = {
  spec: false,
  architecture: false,
  tooling: false,
  typecheck: false,
  unit: false,
  build: false,
  e2e: false,
};
let reason = new Set();

const full = (why) => {
  for (const key of Object.keys(gates)) gates[key] = true;
  reason.add(why);
};

for (const file of files) {
  if (/^(package(-lock)?\.json|tsconfig.*\.json|playwright\.config\.ts)$/.test(file)) {
    full("toolchain/config changed");
    continue;
  }
  if (file.startsWith(".github/workflows/") || file.startsWith("tools/ci/")) {
    full("CI policy changed");
    continue;
  }
  if (
    file === "AGENTS.md" ||
    file.startsWith(".codex/") ||
    file.startsWith(".agents/") ||
    file.startsWith("tools/codex/")
  ) {
    gates.tooling = true;
    reason.add("agent framework changed");
    continue;
  }
  if (
    file.startsWith("docs/specs/") ||
    file === "docs/spec-manifest.json" ||
    file === "docs/personal_finance_canonical_schema_v1.0.json" ||
    file.startsWith("tools/validate-spec") ||
    file.startsWith("tools/generate-editor")
  ) {
    gates.spec = true;
    reason.add("specification surface changed");
    if (file.endsWith(".json") && !file.includes("requirements-index")) {
      gates.typecheck = gates.unit = gates.build = gates.e2e = true;
      reason.add("canonical/generated contract may affect runtime");
    }
    continue;
  }
  if (file.startsWith("docs/")) {
    reason.add("non-normative documentation only");
    continue;
  }
  if (file.startsWith("src/")) {
    gates.architecture = gates.typecheck = gates.unit = gates.build = gates.e2e = true;
    reason.add("runtime source changed");
    continue;
  }
  if (file.startsWith("ui/")) {
    gates.typecheck = gates.unit = gates.build = gates.e2e = true;
    reason.add("UI source changed");
    continue;
  }
  if (file.startsWith("test/")) {
    gates.typecheck = gates.unit = true;
    reason.add("unit/property test surface changed");
    continue;
  }
  if (file.startsWith("e2e/")) {
    gates.typecheck = gates.build = gates.e2e = true;
    reason.add("E2E surface changed");
    continue;
  }
  if (file.startsWith("tools/validate-architecture")) {
    gates.architecture = gates.tooling = true;
    reason.add("architecture validator changed");
    continue;
  }
  if (file === ".node-version" || file === ".npmrc") {
    full("runtime/package-manager policy changed");
    continue;
  }
  full(`unknown path changed: ${file}`);
}

if (files.length === 0) full("unable to determine changed files");

const profile =
  gates.e2e ? "full-runtime" :
  gates.unit ? "code-focused" :
  gates.spec && gates.tooling ? "spec+tooling" :
  gates.spec ? "spec" :
  gates.tooling ? "tooling" :
  "docs-only";

const plan = { profile, files, gates, reasons: [...reason] };
console.log(JSON.stringify(plan, null, 2));

if (output) {
  const lines = [
    `profile=${profile}`,
    ...Object.entries(gates).map(([key, enabled]) => `${key}=${enabled}`),
  ];
  await appendFile(output, lines.join("\n") + "\n", "utf8");
}
