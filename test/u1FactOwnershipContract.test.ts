import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Kind = "source" | "conditional" | "derived" | "assumption" | "decision" | "external";
type Row = {
  id: string; label: string; kind: Kind; owner_surface: string;
  semantic_scope: string; canonical_authority: string;
  derives_from: string[]; read_only_surfaces: string[];
  resolution_policy: string; delivery_gate: string;
};
const reg = JSON.parse(readFileSync(new URL("../docs/specs/verification/u1-fact-ownership.json", import.meta.url), "utf8")) as {
  schema_version: number; records: Row[]; status: string;
};
const ux = readFileSync(new URL("../docs/specs/capabilities/application-ux.md", import.meta.url), "utf8");
const roadmap = readFileSync(new URL("../docs/specs/roadmap/post-pr21-implementation-roadmap.md", import.meta.url), "utf8");
const index = JSON.parse(readFileSync(new URL("../docs/specs/verification/requirements-index.json", import.meta.url), "utf8")) as {
  requirements: { id: string; spec_id: string }[];
};

describe("U1 financial fact single-owner architecture", () => {
  it("declares exactly one meaningful, context-local write owner for each fact family", () => {
    expect(reg.schema_version).toBe(1);
    expect(reg.status).toMatch(/implementation not yet complete/);
    expect(reg.records.length).toBeGreaterThanOrEqual(50);
    const ids = reg.records.map(f => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const row of reg.records) {
      expect(row.id).toMatch(/^[a-z]+\.[a-z_]+$/);
      expect(["source", "conditional", "derived", "assumption", "decision", "external"]).toContain(row.kind);
      for (const val of [row.label, row.owner_surface, row.semantic_scope, row.canonical_authority, row.resolution_policy]) {
        expect(val.trim().length, row.id).toBeGreaterThan(3);
      }
      expect(new Set(row.read_only_surfaces).size, row.id).toBe(row.read_only_surfaces.length);
      expect(row.read_only_surfaces).not.toContain(row.owner_surface);
      expect(["U1", "#101", "#102"]).toContain(row.delivery_gate);
    }
  });

  it("requires every modeled derivation to have a valid acyclic authority chain", () => {
    const byId = new Map(reg.records.map(row => [row.id, row]));
    const done = new Set<string>();
    const visit = (id: string, pending: Set<string>) => {
      expect(pending.has(id), `derivation cycle: ${[...pending, id].join(" → ")}`).toBe(false);
      if (done.has(id)) return;
      pending.add(id);
      const row = byId.get(id)!;
      if (row.kind === "derived" || row.kind === "conditional") expect(row.derives_from.length, row.id).toBeGreaterThan(0);
      for (const dep of row.derives_from) {
        expect(byId.has(dep), `missing source ${dep} for ${row.id}`).toBe(true);
        visit(dep, pending);
      }
      pending.delete(id);
      done.add(id);
    };
    for (const row of reg.records) visit(row.id, new Set());
  });

  it("keeps actual-vs-forecast, economic-vs-cash, and legal-scope distinctions", () => {
    const f = (id: string) => reg.records.find(row => row.id === id)!;
    for (const id of ["person.birthdate", "person.age_year_end", "income.pay_contract", "income.growth", "income.prior_sponsor_wages", "income.ira_compensation", "tax.roth_magi", "tax.filing_status", "health.coverage", "employer.plan_terms", "employer.eligible_pay", "investment.past_usage", "investment.contribution_projection", "bank.cash_account", "debt.mortgage_contract", "debt.mortgage_schedule", "plan.horizon", "money.paycheck_view"]) {
      expect(f(id), id).toBeDefined();
    }
    expect(f("person.age_year_end").kind).toBe("derived");
    expect(f("income.ira_compensation").kind).toBe("conditional");
    expect(f("tax.roth_magi").kind).toBe("conditional");
    expect(f("investment.past_usage").kind).toBe("source");
    expect(f("investment.contribution_projection").kind).toBe("conditional");
    expect(f("money.paycheck_view").kind).toBe("derived");
    expect(f("income.pay_contract").owner_surface).toBe("Money → Income");
    expect(f("income.growth").owner_surface).toBe(f("income.pay_contract").owner_surface);
    expect(f("debt.mortgage_contract").owner_surface).toBe(f("debt.mortgage_funding").owner_surface);
    expect(f("investment.payroll").owner_surface).toBe(f("investment.purchase").owner_surface);
    expect(f("investment.past_usage").owner_surface).toBe(f("investment.purchase").owner_surface);
    expect(f("bank.cash_account").owner_surface).toBe("Money → Accounts");
    expect(f("tax.withholding").delivery_gate).toBe("#101");
    expect(f("tax.settlement").delivery_gate).toBe("#102");
  });

  it("keeps requirements, controlled UX spec and D1/U1 roadmap in agreement", () => {
    for (const id of ["PFA-UX-021", "PFA-UX-022", "PFA-UX-023"]) {
      expect(ux).toContain(`### ${id}`);
      expect(index.requirements.filter(row => row.id === id && row.spec_id === "application-ux").length).toBe(1);
    }
    expect(ux).toContain("u1-fact-ownership.json");
    expect(roadmap).toContain("u1-fact-ownership.json");
    expect(roadmap).toContain("Issue #94 / PR #98");
  });
});
