import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const planner = fileURLToPath(new URL("../tools/ci/verification-plan.mjs", import.meta.url));
const workflow = readFileSync(new URL("../.github/workflows/test.yml", import.meta.url), "utf8");
type Gates = Record<"spec" | "architecture" | "tooling" | "typecheck" | "unit" | "build" | "e2e" | "feasibility", boolean>;

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
  it('bounds ordinary probes and stops manual progression after failure without reusing stale evidence', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pfm-feasibility-control-'));
    try {
      execute(directory, 'git', ['init', '-q']);
      writeFileSync(join(directory, 'baseline.txt'), 'baseline');
      execute(directory, 'git', ['add', '.']);
      execute(directory, 'git', ['-c', 'user.name=PFM Test', '-c', 'user.email=pfm@example.test', 'commit', '-qm', 'baseline']);
      const head = execute(directory, 'git', ['rev-parse', 'HEAD']);
      mkdirSync(join(directory, 'node_modules/vite-node'), { recursive: true });
      // Process-control double only: actual synthetic execution belongs to the
      // selected feasibility job, not a duplicate forecast inside unit CI.
      writeFileSync(join(directory, 'node_modules/vite-node/vite-node.mjs'), `
        import { writeFileSync } from 'node:fs';
        const months = Number(process.argv.at(-2));
        if (process.env.FAIL_PROBE === String(months)) process.exit(1);
        writeFileSync('engineering-validation-artifacts/forecast-feasibility/' + months + '.json',
          JSON.stringify({ executed: true, months, argv: process.execArgv }));
      `);
      const script = fileURLToPath(new URL('../tools/ci/forecast-feasibility.mjs', import.meta.url));
      const run = (manual: boolean, fail = '') => {
        const processResult = spawnSync(process.execPath, [script, ...(manual ? ['--manual'] : [])], {
          cwd: directory, encoding: 'utf8', env: { ...process.env, FAIL_PROBE: fail },
        });
        const summary = JSON.parse(readFileSync(join(directory,
          'engineering-validation-artifacts/forecast-feasibility/summary.json'), 'utf8')) as {
          capturedHead: string; probes: { months: number; status: string; evidence?: { argv?: string[] } | string }[];
        };
        return { processResult, summary };
      };
      const ordinary = run(false);
      expect(ordinary.processResult.status).toBe(0);
      expect(ordinary.summary.capturedHead).toBe(head);
      expect(ordinary.summary.probes.map(p => p.months)).toEqual([8, 20]);
      expect(ordinary.summary.probes.every(p => typeof p.evidence === 'object' &&
        p.evidence.argv?.includes('--max-old-space-size=512'))).toBe(true);
      expect(run(true).summary.probes.map(p => p.months)).toEqual([8, 20, 120, 360, 649]);
      const failed = run(true, '8');
      expect(failed.processResult.status).not.toBe(0);
      expect(failed.summary.probes.map(p => p.status)).toEqual(['FAIL', 'not measured', 'not measured', 'not measured', 'not measured']);
      expect(failed.summary.probes[0]!.evidence).toBe('not measured');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 20_000);
  it('selects cheap feasibility for forecast hot paths but no docs/tooling/UI-only probes', () => {
    for (const file of ['src/simulation/householdExecution.ts', 'src/application/householdProjection.ts',
      'src/application/forecastReadiness.ts', 'src/application/forecastSetup.ts',
      'src/application/goldenHousehold.ts', 'test/fixtures/performanceHouseholds.ts'])
      expect(planFor(file).feasibility, file).toBe(true);
    for (const file of ['docs/notes.md', 'tools/codex/tooling-self-test.mjs', 'ui/Plan.tsx']) {
      expect(planFor(file).feasibility, file).toBe(false);
    }
    expect(planFor('tools/codex/tooling-self-test.mjs').e2e).toBe(false);
  });
  it('evaluates the actual browser condition and aggregate shell for success/failure/skips/cancellation', () => {
    const section = workflow.split('\n  e2e:\n')[1]!.split('\n  test:\n')[0]!;
    expect(section).toContain('needs: [plan, typecheck, build, feasibility]');
    const expression = section.split('    if: >-\n')[1]!.split('    runs-on:')[0]!.trim();
    const gate = (selected: boolean, result: string) => {
      const needs = { plan: { result: 'success', outputs: { e2e: 'true', typecheck: 'true', build: 'true', feasibility: String(selected) } },
        typecheck: { result: 'success' }, build: { result: 'success' }, feasibility: { result } };
      // Only evaluate a repository-owned expression, with no external input.
      const evaluate = new Function('needs', 'always', 'cancelled', `return (${expression});`) as
        (needs: object, always: () => boolean, cancelled: () => boolean) => boolean;
      return { needs, evaluate };
    };
    const shell = workflow.split('        run: |\n')[1]!.split('      - name: Checkout')[0]!
      .split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n');
    const aggregate = (enabled: boolean, typecheck: string, feasibility: string, e2e: string) => spawnSync('bash', ['-e', '-c', shell], {
      env: { ...process.env, PLAN: 'success', SPEC_ENABLED: 'false', ARCH_ENABLED: 'false', TOOLING_ENABLED: 'false',
        UNIT_ENABLED: 'false', TYPECHECK_ENABLED: 'true', TYPECHECK: typecheck, BUILD_ENABLED: 'true', BUILD: 'success',
        FEASIBILITY_ENABLED: String(enabled), FEASIBILITY: feasibility, E2E_ENABLED: 'true', E2E: e2e }, encoding: 'utf8',
    });
    for (const result of ['success', 'failure', 'skipped', 'cancelled']) {
      const { needs, evaluate } = gate(true, result);
      expect(evaluate(needs, () => true, () => false)).toBe(result === 'success');
      expect(aggregate(true, 'success', result, result === 'success' ? 'success' : 'skipped').status === 0).toBe(result === 'success');
      needs.typecheck.result = result;
      expect(evaluate(needs, () => true, () => false)).toBe(result === 'success');
      expect(aggregate(false, result, 'skipped', result === 'success' ? 'success' : 'skipped').status === 0).toBe(result === 'success');
      needs.typecheck.result = 'success'; needs.build.result = result;
      expect(evaluate(needs, () => true, () => false)).toBe(result === 'success');
    }
    const optional = gate(false, 'skipped');
    expect(optional.evaluate(optional.needs, () => true, () => false)).toBe(true);
    expect(optional.evaluate(optional.needs, () => true, () => true)).toBe(false);
    expect(aggregate(false, 'success', 'skipped', 'success').status).toBe(0);
    expect(aggregate(false, 'success', 'skipped', 'cancelled').status).not.toBe(0);
    for (const job of ['spec', 'architecture', 'tooling', 'typecheck', 'unit', 'build']) {
      expect(workflow.split(`\n  ${job}:\n`)[1]!.split('\n    runs-on:')[0]).toContain('needs: plan');
    }
  });
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
  it("runs four independent Playwright CI shards and preserves aggregate gating", () => {
    expect(workflow).toContain("shard: [1, 2, 3, 4]");
    expect(workflow).toContain("npm run codex:e2e -- --shard=${{ matrix.shard }}/4");
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
