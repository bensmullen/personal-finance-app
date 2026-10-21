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

// The manifest carries both runtime contracts and non-runtime planning metadata.
// Only the two metadata fields of the established roadmap record are safe to
// ignore here. Missing revisions, invalid JSON, or any other change fail closed.
const roadmapMetadataOnly = () => {
  if (!base || /^0+$/.test(base)) return false;
  const read = (rev) => {
    const result = git(["show", `${rev}:docs/spec-manifest.json`]);
    if (result.status !== 0) return null;
    try { return JSON.parse(result.stdout); } catch { return null; }
  };
  const before = read(base), after = read(head);
  if (!before || !after) return false;
  const normalized = (original) => {
    const manifest = structuredClone(original);
    if (!Array.isArray(manifest.specifications)) return null;
    const roadmap = manifest.specifications.find(
      (spec) => spec.id === "post-pr21-implementation-roadmap"
    );
    if (!roadmap ||
        roadmap.authority !== "planning" ||
        roadmap.path !== "docs/specs/roadmap/post-pr21-implementation-roadmap.md") return null;
    delete roadmap.version;
    delete roadmap.keywords;
    return manifest;
  };
  const a = normalized(before), b = normalized(after);
  return a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b);
};

const gates = {
  spec: false,
  architecture: false,
  tooling: false,
  typecheck: false,
  unit: false,
  build: false,
  e2e: false,
  feasibility: false,
};
let reason = new Set();

const full = (why) => {
  for (const key of Object.keys(gates)) gates[key] = true;
  reason.add(why);
};

for (const file of files) {
  if (/^src\/(simulation|primitives|rules|funding|accounting|statements|values|time|application\/compiler)\//.test(file) ||
      /^src\/(kernel|run|state|values|time|funding|accounting)\.ts$/.test(file) ||
      /^src\/application\/(householdProjection|performance)\.ts$/.test(file) ||
      file === 'test/fixtures/performanceHouseholds.ts' ||
      file === 'tools/ci/forecast-feasibility.mjs') {
    gates.feasibility = true;
    reason.add('deterministic forecast hot path/horizon changed');
  }
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
    file.endsWith("/AGENTS.md") ||
    file.startsWith(".codex/") ||
    file.startsWith(".agents/") ||
    file.startsWith("tools/codex/")
  ) {
    gates.tooling = true;
    reason.add("agent framework changed");
    continue;
  }
  if (file === "docs/spec-manifest.json") {
    gates.spec = true;
    if (roadmapMetadataOnly()) {
      reason.add("roadmap version/keywords metadata only");
    } else {
      gates.typecheck = gates.unit = gates.build = gates.e2e = true;
      reason.add("manifest runtime authority changed or not provably metadata-only");
    }
    continue;
  }
  if (
    file.startsWith("docs/specs/") ||
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
  if (
    file === "docs/development/handoff-authoring-policy.md" ||
    file === "docs/development/verification-policy.md" ||
    file.startsWith("docs/development/agent-")
  ) {
    gates.tooling = true;
    reason.add("agent governance changed");
    continue;
  }
  if (
    file === "docs/development/milestone-issue-register.json" ||
    file === "docs/development/milestone-issue-policy.md"
  ) {
    // The register's static dependency/gate/consolidation checks live in Vitest.
    gates.unit = true;
    reason.add("milestone issue/register consistency changed");
    continue;
  }
  if (
    file === "docs/personal_finance_executable_financial_semantics_v0.1.md" ||
    file === "docs/architecture/system-software-architecture.md" ||
    file.startsWith("docs/architecture/adr/") ||
    file === "docs/personal_finance_postgresql_v1.0.sql"
  ) {
    gates.spec = true;
    reason.add("normative financial or architecture documentation changed");
    continue;
  }
  if (
    file === "docs/personal_finance_model.schema.json" ||
    file === "docs/personal_finance_simulation_interfaces_v1.0.ts"
  ) {
    gates.spec = gates.typecheck = gates.unit = gates.build = gates.e2e = true;
    reason.add("generated financial interface or model contract changed");
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
  if (file.startsWith("ui/") || file.startsWith("app/")) {
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

// Every successful main push is deployable, including documentation-only merges.
// The Pages artifact must be built even if PR verification could skip the build.
if (process.env.GITHUB_EVENT_NAME === "push" &&
    process.env.GITHUB_REF === "refs/heads/main") {
  gates.build = true;
  reason.add("main push requires GitHub Pages build");
}

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
