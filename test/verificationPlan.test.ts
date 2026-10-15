import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const planner = fileURLToPath(new URL("../tools/ci/verification-plan.mjs", import.meta.url));
const workflow = readFileSync(new URL("../.github/workflows/test.yml", import.meta.url), "utf8");
type Gates = Record<"spec" | "architecture" | "tooling" | "typecheck" | "unit" | "build" | "e2e", boolean>;

function execute(cwd: string, executable: string, args: string[], env?: NodeJS.ProcessEnv): string {
  const result = spawnSync(executable, args, { cwd, encoding: "utf8", env });
  if (result.status !== 0) throw new Error(String(result.stderr || result.stdout || executable + " failed"));
  return result.stdout.trim();
}
function planFor(changedPath: string, mainPush = false): Gates {
  const directory = mkdtempSync(join(tmpdir(), "pfm-verification-plan-"));
  try {
    execute(directory, "git", ["init", "-q"]);
    writeFileSync(join(directory, "baseline.txt"), "baseline\n");
    execute(directory, "git", ["add", "."]);
    execute(directory, "git", ["-c", "user.name=PFM Test", "-c", "user.email=pfm@example.test", "commit", "-qm", "baseline"]);
    const base = execute(directory, "git", ["rev-parse", "HEAD"]);
    const filepath = join(directory, changedPath);
    mkdirSync(dirname(filepath), { recursive: true });
    writeFileSync(filepath, "updated\n");
    execute(directory, "git", ["add", "."]);
    execute(directory, "git", ["-c", "user.name=PFM Test", "-c", "user.email=pfm@example.test", "commit", "-qm", "change"]);
    const head = execute(directory, "git", ["rev-parse", "HEAD"]);
    const output = execute(directory, process.execPath, [planner, "--base", base, "--head", head], {
      ...process.env,
      GITHUB_EVENT_NAME: mainPush ? "push" : "pull_request",
      GITHUB_REF: mainPush ? "refs/heads/main" : "refs/pull/1/merge",
      GITHUB_OUTPUT: "",
    });
    return (JSON.parse(output) as { gates: Gates }).gates;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
function planForManifestChange(before: object, after: object): Gates {
  const directory = mkdtempSync(join(tmpdir(), "pfm-verification-manifest-"));
  try {
    execute(directory, "git", ["init", "-q"]);
    const filepath = join(directory, "docs/spec-manifest.json");
    mkdirSync(dirname(filepath), { recursive: true });
    writeFileSync(filepath, JSON.stringify(before, null, 2) + "\n");
    execute(directory, "git", ["add", "."]);
    execute(directory, "git", ["-c", "user.name=PFM Test", "-c", "user.email=pfm@example.test", "commit", "-qm", "baseline"]);
    const base = execute(directory, "git", ["rev-parse", "HEAD"]);
    writeFileSync(filepath, JSON.stringify(after, null, 2) + "\n");
    execute(directory, "git", ["add", "."]);
    execute(directory, "git", ["-c", "user.name=PFM Test", "-c", "user.email=pfm@example.test", "commit", "-qm", "change"]);
    const head = execute(directory, "git", ["rev-parse", "HEAD"]);
    const output = execute(directory, process.execPath, [planner, "--base", base, "--head", head], {
      ...process.env,
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_REF: "refs/pull/1/merge",
      GITHUB_OUTPUT: "",
    });
    return (JSON.parse(output) as { gates: Gates }).gates;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
const roadmapManifest = {
  manifest_version: "1.2.0",
  canonical_schema_version: "1.0.4",
  specifications: [
    { id: "post-pr21-implementation-roadmap", authority: "planning", path: "docs/specs/roadmap/post-pr21-implementation-roadmap.md", version: "0.6.9-draft", keywords: ["U1"] },
    { id: "tax-engine", authority: "level-2", path: "docs/specs/capabilities/tax-engine.md", version: "1.0", keywords: ["tax"] },
  ],
};

describe("selective verification and main deployment", () => {
  it("routes roadmap version and keywords in the manifest to specs only", () => {
    const changed = structuredClone(roadmapManifest);
    changed.specifications[0]!.version = "0.6.10-draft";
    changed.specifications[0]!.keywords.push("U1B");
    const gates = planForManifestChange(roadmapManifest, changed);
    expect(gates.spec).toBe(true);
    for (const name of ["architecture", "tooling", "typecheck", "unit", "build", "e2e"] as const) expect(gates[name], name).toBe(false);
  });
  it("keeps full runtime checks for a changed manifest engine version", () => {
    const changed = { ...roadmapManifest, canonical_schema_version: "2.0.0" };
    const gates = planForManifestChange(roadmapManifest, changed);
    expect(gates.spec && gates.typecheck && gates.unit && gates.build && gates.e2e).toBe(true);
  });
  it("keeps full runtime checks when the roadmap record changes authority or path", () => {
    const changed = structuredClone(roadmapManifest);
    changed.specifications[0]!.path = "src/new-file.ts";
    const gates = planForManifestChange(roadmapManifest, changed);
    expect(gates.e2e && gates.unit && gates.typecheck && gates.spec).toBe(true);
  });
  it("keeps full runtime checks for other controlled spec versions", () => {
    const changed = structuredClone(roadmapManifest);
    changed.specifications[1]!.version = "2.0";
    expect(planForManifestChange(roadmapManifest, changed).e2e).toBe(true);
  });
  it("runs two independent Playwright CI shards and preserves aggregate gating", () => {
    expect(workflow).toContain("shard: [1, 2]");
    expect(workflow).toContain("npm run codex:e2e -- --shard=${{ matrix.shard }}/2");
    expect(workflow).toContain("name: e2e-diagnostics-${{ matrix.shard }}");
    expect(workflow).toContain("require_gate e2e");
  });
  it("keeps non-normative documentation-only PRs inexpensive", () => {
    const gates = planFor("docs/meeting-notes.md");
    expect(Object.values(gates).every(enabled => !enabled)).toBe(true);
  });
  it("builds on a main push even when only documentation changed", () => {
    const gates = planFor("docs/meeting-notes.md", true);
    expect(gates.build).toBe(true);
    expect(gates.unit).toBe(false);
  });
  it("routes executable financial semantics to specification validation", () => {
    expect(planFor("docs/personal_finance_executable_financial_semantics_v0.1.md").spec).toBe(true);
  });
  it("runs issue-register structural checks when the register changes", () => {
    expect(planFor("docs/development/milestone-issue-register.json").unit).toBe(true);
  });
  it("validates nested AGENTS governance with the tooling gate", () => {
    expect(planFor("docs/AGENTS.md").tooling).toBe(true);
  });
  it("runs relevant UI checks for app shell changes", () => {
    const gates = planFor("app/page.tsx");
    expect(gates.typecheck && gates.unit && gates.build && gates.e2e).toBe(true);
  });
  it("requires the aggregate CI gate and built artifact for main deployment", () => {
    expect(workflow).toContain("if: ${{ always() && github.event_name == 'push' && github.ref == 'refs/heads/main' && needs.test.result == 'success' && needs.build.result == 'success' }}");
  });
});
