import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface IssueRow {
  issue_number: number;
  owner_stage: string;
  blocking_gate: string;
  depends_on: number[];
  spec_requirement_ids: string[];
  scope: string;
}
const registry = JSON.parse(readFileSync(new URL("../docs/development/milestone-issue-register.json", import.meta.url), "utf8")) as {
  schema_version: number;
  stage_gates: Record<string, { stage: string; blocking_transition: string; required_issue_numbers: number[] }>;
  issues: IssueRow[];
  legacy_open_task_reconciliation: { issue_numbers: number[] };
};
const roadmap = readFileSync(new URL("../docs/specs/roadmap/post-pr21-implementation-roadmap.md", import.meta.url), "utf8");
const watchWorkflow = readFileSync(new URL("../.github/workflows/issue-milestone-traceability.yml", import.meta.url), "utf8");
const liveCheck = readFileSync(new URL("../tools/roadmap/verify-issue-stage-register.mjs", import.meta.url), "utf8");

describe("issue-backed roadmap traceability", () => {
  it("registers each private-alpha/U1 issue exactly once with a stable mandatory stage", () => {
    expect(registry.schema_version).toBe(1);
    const ids = registry.issues.map(item => item.issue_number);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [94, 99, 100, 101, 102, 103, 104, 105]) expect(ids).toContain(id);
    for (const row of registry.issues) {
      expect(Number.isSafeInteger(row.issue_number) && row.issue_number > 0).toBe(true);
      expect(row.owner_stage.trim()).not.toBe("");
      expect(row.scope.trim()).not.toBe("");
      expect(row.spec_requirement_ids.length).toBeGreaterThan(0);
      expect(Object.hasOwn(registry.stage_gates, row.blocking_gate)).toBe(true);
      for (const d of row.depends_on) expect(ids).toContain(d);
      expect(row.depends_on).not.toContain(row.issue_number);
    }
  });
  it("keeps issue-to-gate relationships bidirectional, nonduplicated and acyclic", () => {
    for (const [gate, rule] of Object.entries(registry.stage_gates)) {
      expect(rule.stage).not.toBe("");
      expect(rule.blocking_transition).not.toBe("");
      expect(new Set(rule.required_issue_numbers).size).toBe(rule.required_issue_numbers.length);
      expect(rule.required_issue_numbers.slice().sort((a,b) => a-b)).toEqual(registry.issues.filter(x => x.blocking_gate === gate).map(x => x.issue_number).sort((a,b) => a-b));
    }
    const lookup = new Map(registry.issues.map(x => [x.issue_number, x]));
    const visit = (id: number, active: Set<number>, complete: Set<number>) => {
      if (complete.has(id)) return;
      expect(active.has(id), `Dependency cycle involving #${id}`).toBe(false);
      active.add(id);
      for (const d of lookup.get(id)?.depends_on ?? []) visit(d, active, complete);
      active.delete(id);
      complete.add(id);
    };
    const complete = new Set<number>();
    for (const row of registry.issues) visit(row.issue_number, new Set<number>(), complete);
  });
  it("watches live GitHub issue creation and avoids silently missing new product issues", () => {
    expect(watchWorkflow).toContain("types: [opened, reopened, edited]");
    expect(watchWorkflow).toContain("issues: read");
    expect(watchWorkflow).toContain("schedule:");
    expect(watchWorkflow).toContain("verify-issue-stage-register.mjs");
    expect(liveCheck).toContain("state=open&per_page=100");
    expect(liveCheck).toContain("missing");
    expect(liveCheck).toContain("[agent-candidate]");
  });
  it("records the planned live gate in the controlled roadmap and keeps historical cleanup separate", () => {
    expect(roadmap).toContain("docs/development/milestone-issue-register.json");
    for (const gate of ["D1_U1", "D2", "R11"]) expect(roadmap).toContain(gate);
    for (const n of registry.issues.map(row=>row.issue_number)) expect(roadmap).toContain(`#${n}`);
    const historic = registry.legacy_open_task_reconciliation.issue_numbers;
    expect(new Set(historic).size).toBe(historic.length);
    for (const number of historic) expect(registry.issues.map(item => item.issue_number)).not.toContain(number);
  });
});
