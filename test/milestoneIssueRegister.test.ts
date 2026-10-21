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
  closed_consolidations: {
    issue_number: number;
    consolidated_into: number;
    closed_as: string;
    original_gate: string;
    retained_requirement: string;
  }[];
};
const roadmap = readFileSync(new URL("../docs/specs/roadmap/post-pr21-implementation-roadmap.md", import.meta.url), "utf8");
const watchWorkflow = readFileSync(new URL("../.github/workflows/issue-milestone-traceability.yml", import.meta.url), "utf8");
const liveCheck = readFileSync(new URL("../tools/roadmap/verify-issue-stage-register.mjs", import.meta.url), "utf8");

describe("issue-backed roadmap traceability", () => {
  it('keeps reliability #218 independent of product and candidate gates', () => {
    const task = registry.issues.find(row => row.issue_number === 218)!;
    expect(task.owner_stage).toBe('engineering-framework-reliability');
    expect(task.blocking_gate).toBe('FRAMEWORK_RELIABILITY');
    expect(task.depends_on).toEqual([]);
    expect(registry.stage_gates.FRAMEWORK_RELIABILITY?.required_issue_numbers).toEqual([218]);
    for (const row of registry.issues) expect(row.depends_on).not.toContain(218);
    for (const candidate of [134, 217]) expect(registry.issues.map(row => row.issue_number)).not.toContain(candidate);
  });
  it("registers each private-alpha/U1 issue exactly once with a stable mandatory stage", () => {
    expect(registry.schema_version).toBe(1);
    const ids = registry.issues.map(item => item.issue_number);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [100, 101, 102, 105, 120, 146, 147, 148, 149]) expect(ids).toContain(id);
    for (const id of [94, 99, 103, 104]) expect(ids).not.toContain(id);
    expect(registry.stage_gates.D1_U1?.required_issue_numbers).toEqual([120]);
    expect(registry.stage_gates.D2?.required_issue_numbers).toEqual([114, 146, 147, 148, 149, 202, 203, 204]);
    for (const id of [146, 147, 148]) expect(registry.issues.find(row => row.issue_number === id)?.depends_on).not.toContain(120);
    expect(registry.issues.find(row => row.issue_number === 149)?.depends_on).toContain(120);
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
  it("keeps consolidated historical issues linked to surviving gate owners", () => {
    const merges = new Map(registry.closed_consolidations.map(x => [x.issue_number, x.consolidated_into]));
    // Preserve historical provenance while resolving through superseded owners.
    expect(merges.get(99)).toBe(94);
    expect(merges.get(94)).toBe(120);
    expect(merges.get(104)).toBe(100);
    expect(merges.get(103)).toBe(146);
    const ids = new Set(registry.issues.map(x => x.issue_number));
    expect(merges.size).toBe(registry.closed_consolidations.length);
    for (const merger of registry.closed_consolidations) {
      expect(["duplicate", "superseded"]).toContain(merger.closed_as);
      if (merger.issue_number === 94) expect(merger.closed_as).toBe("superseded");
      expect(ids.has(merger.issue_number)).toBe(false);
      expect(merger.retained_requirement.trim()).not.toBe("");
      const visited = new Set<number>([merger.issue_number]);
      let owner = merger.consolidated_into;
      while (!ids.has(owner)) {
        expect(visited.has(owner), `Consolidation cycle involving #${owner}`).toBe(false);
        visited.add(owner);
        expect(merges.has(owner), `No surviving gate owner for #${merger.issue_number}`).toBe(true);
        owner = merges.get(owner)!;
      }
      expect(registry.issues.find(x => x.issue_number === owner)?.blocking_gate).toBe(merger.original_gate);
      expect(roadmap).toContain(`#${merger.issue_number}`);
      expect(roadmap).toContain(`#${merger.consolidated_into}`);
      expect(roadmap).toContain(`#${owner}`);
    }
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
