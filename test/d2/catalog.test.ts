import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catalogSchema, type D2Catalog } from "../fixtures/d2/schema.js";
import { reconcileStatedEffects, verifyCatalog } from "./verifyCatalog.js";

const raw: unknown = JSON.parse(readFileSync(new URL("../fixtures/d2/catalog.json", import.meta.url), "utf8"));
const catalog = catalogSchema.parse(raw);
const clone = (): D2Catalog => structuredClone(catalog);

// This independently maintained list prevents dropping a mandated family or
// replacing ordinary mechanics with only a specialty/capability-boundary case.
const requiredVariants: Record<string, readonly string[]> = {
  social_security: ["retirement", "spousal", "survivor", "cola_coordination"],
  pension: ["quoted_payment", "survivor_termination"],
  "403b": ["contribution", "distribution_rollover"],
  governmental_457b: ["contribution", "distribution_rollover"],
  tsp: ["contribution", "distribution_rollover"],
  sep_ira: ["contribution", "distribution_rollover"],
  simple_ira: ["contribution", "distribution_rollover"],
  roth_paths: ["ira_conversion", "backdoor", "mega_inplan", "mega_rollover"],
  retirement_distributions: ["ordinary", "rmd"],
  auto_loan: ["scheduled_payment", "final_payment", "extra_payoff", "unfunded_required"],
  student_loan: ["scheduled_payment"],
  credit_card: ["statement_payment"],
  heloc: ["draw", "variable_reset"],
  tips: ["inflation_accretion", "quoted_coupon", "maturity"],
  series_ee: ["redemption", "accrual_maturity"],
  education_529: ["contribution", "qualified_distribution", "nonqualified_distribution", "plan_rollover", "beneficiary_change", "roth_rollover"],
  health_insurance: ["after_tax_premium", "pretax_employer_share", "end_boundary"],
  medicare: ["part_a", "part_b", "part_d", "advantage", "medigap", "irmaa"],
  health_fsa: ["payroll_contribution", "reimbursement", "carryover", "grace_period", "forfeiture"],
};
const authorityPaths = new Set([
  "docs/specs/capabilities/deterministic-household-financial-semantics.md",
  "docs/specs/capabilities/portfolio-planning.md",
  "docs/specs/capabilities/tax-engine.md",
  "docs/specs/capabilities/insurance-planning.md",
  "docs/personal_finance_executable_financial_semantics_v0.1.md",
]);

describe("D2 preparation catalog (no integrated runtime claims)", () => {
  it("validates exact units, identities, dates, balances and conditional financial invariants", () => {
    expect(verifyCatalog(raw)).toEqual(catalog);
    expect(catalog.cases).toHaveLength(55);
  });

  it("covers every required ordinary family and references real normative anchors", () => {
    for (const [family, variants] of Object.entries(requiredVariants)) {
      const cases = catalog.cases.filter(item => item.family === family);
      expect(cases.map(item => item.variant).sort()).toEqual([...variants].sort());
    }
    const requirements = new Set(catalog.cases.flatMap(item => item.requirements));
    for (const suffix of ["015", "016", "017", "018", "019", "020", "021", "022"]) expect(requirements.has(`PFA-DET-${suffix}`)).toBe(true);
    for (const id of ["PFA-TAX-015", "PFA-INV-025", "PFA-INV-026", "PFA-INV-027", "PFA-INV-028", "PFA-INS-013"]) expect(requirements.has(id)).toBe(true);
    // The integrated DET-023 obligation stays in the D2-D plan, not prep evidence.
    expect(requirements.has("PFA-DET-023")).toBe(false);
    for (const item of catalog.cases) {
      for (const ref of item.authority) {
        expect(authorityPaths.has(ref.path)).toBe(true);
        const text = readFileSync(new URL(`../../${ref.path}`, import.meta.url), "utf8");
        expect(text).toContain(ref.anchor);
      }
      for (const id of item.requirements) expect(item.authority.some(ref => ref.anchor === id)).toBe(true);
      const det = item.requirements.find(id => /^PFA-DET-0(1[6-9]|2[0-2])$/.test(id));
      expect(det).toBeDefined();
      expect(item.lane).toBe(det === "PFA-DET-020" ? "D2-C" : ["PFA-DET-019", "PFA-DET-021", "PFA-DET-022"].includes(det!) ? "D2-B" : "D2-A");
    }
    expect(catalog.cases.filter(item => item.family === "retirement_distributions").every(item => item.input.terms.existingIssue === "103")).toBe(true);
  });

  it("reproduces reconciliation without mutating inputs or depending on account/leg inventory order", () => {
    const before = JSON.stringify(catalog);
    for (const item of catalog.cases) {
      const reordered = structuredClone(item);
      reordered.input.accounts.reverse();
      reordered.expected.effects?.transactions.forEach(transaction => transaction.legs.reverse());
      expect(reconcileStatedEffects(reordered)).toEqual(reconcileStatedEffects(item));
      expect(reconcileStatedEffects(item)).toEqual(reconcileStatedEffects(structuredClone(item)));
    }
    expect(JSON.stringify(catalog)).toBe(before);
  });

  it("keeps unknown legal effects absent and rejects a false supported-capability claim", () => {
    for (const item of catalog.cases) {
      expect(item.expected.integratedRuntimeEvidence).toBe(false);
      expect(item.expected.unknownOutputs.length).toBeGreaterThan(0);
    }
    for (const id of ["backdoor_aggregate_basis", "retirement_rmd", "tips_accretion", "529_roth_rollover", "medicare_irmaa", "fsa_reimbursement"]) {
      expect(catalog.cases.find(item => item.id === id)!.expected.effects).toBeUndefined();
    }
    const altered = clone();
    Object.assign(altered.cases[0]!.expected, { capability: "supported" });
    expect(() => verifyCatalog(altered)).toThrow();
  });

  it("pins withholding as an asset, conversion as non-consumption, payoff, failed funding and period exclusion", () => {
    const find = (id: string) => catalog.cases.find(item => item.id === id)!.expected.effects!;
    expect(find("ss_retirement").closingCents).toEqual({ cash: "90000", withholding: "10000", benefit: "100000" });
    expect(find("ss_retirement").recognition).toEqual({ incomeCents: "100000", expenseCents: "0" });
    expect(find("mega_backdoor_inplan").facts).toMatchObject({ taxableConversionCents: "40000", recoveredBasisCents: "10000", contributionUsageDeltaCents: "0", withholdingCents: "0" });
    expect(find("ira_roth_conversion").netWorthDeltaCents).toBe("0");
    expect(find("auto_final_interest").closingCents).toEqual({ cash: "99000", principal: "0", interest: "1000" });
    expect(find("debt_unfunded").transactions).toEqual([]);
    expect(find("premium_end_exclusive").transactions).toEqual([]);
    for (const id of ["health_after_tax", "health_pretax_employer"]) {
      const amounts = catalog.cases.find(item => item.id === id)!.input.amounts;
      expect(BigInt(amounts.grossPremiumCents!)).toBe(BigInt(amounts.employerShareCents!) + BigInt((amounts.employeeShareCents ?? amounts.householdShareCents)!));
    }
  });

  it.each([
    ["duplicate case", (value: D2Catalog) => value.cases.push(structuredClone(value.cases[0]!))],
    ["unknown posting account", (value: D2Catalog) => { value.cases[0]!.expected.effects!.transactions[0]!.legs[0]!.account = "missing"; }],
    ["unbalanced transaction", (value: D2Catalog) => { value.cases[0]!.expected.effects!.transactions[0]!.legs[0]!.cents = "89999"; }],
    ["closing balance mismatch", (value: D2Catalog) => { value.cases[0]!.expected.effects!.closingCents.cash = "90001"; }],
    ["expected effect mismatch", (value: D2Catalog) => { value.cases[0]!.expected.effects!.netWorthDeltaCents = "90000"; }],
    ["transaction outside half-open period", (value: D2Catalog) => { value.cases[0]!.expected.effects!.transactions[0]!.date = "2026-02-01"; }],
    ["unknown account owner", (value: D2Catalog) => { value.cases[0]!.input.accounts[0]!.owner = "missing"; }],
    ["duplicate account", (value: D2Catalog) => { value.cases[0]!.input.accounts.push(structuredClone(value.cases[0]!.input.accounts[0]!)); }],
    ["duplicate transaction", (value: D2Catalog) => { value.cases[0]!.expected.effects!.transactions.push(structuredClone(value.cases[0]!.expected.effects!.transactions[0]!)); }],
    ["empty or reversed period", (value: D2Catalog) => { value.cases[0]!.period.endExclusive = value.cases[0]!.period.start; }],
    ["duplicate identity", (value: D2Catalog) => { value.cases[0]!.input.identities.push("claimant"); }],
    ["negative financial balance", (value: D2Catalog) => { value.cases[0]!.input.accounts[0]!.openingCents = "-100000"; }],
  ] as const)("rejects %s", (message, change) => {
    const altered = clone();
    change(altered);
    expect(() => verifyCatalog(altered)).toThrow(message);
  });

  it("rejects floating money, invalid dates, omitted uncertainty and undeclared fields", () => {
    const numeric = clone();
    Object.assign(numeric.cases[0]!.input.amounts, { quotedGrossCents: 100000 });
    expect(() => verifyCatalog(numeric)).toThrow();
    const invalidDate = clone();
    invalidDate.cases[0]!.period.start = "2026-02-30";
    expect(() => verifyCatalog(invalidDate)).toThrow();
    const omitted = clone();
    omitted.cases[0]!.expected.unknownOutputs = [];
    expect(() => verifyCatalog(omitted)).toThrow();
    const extra = clone();
    Object.assign(extra.cases[0]!.expected, { taxLiabilityCents: "0" });
    expect(() => verifyCatalog(extra)).toThrow();
    const fractionalFact = clone();
    fractionalFact.cases[0]!.expected.effects!.facts.withholdingCents = "10000.5";
    expect(() => verifyCatalog(fractionalFact)).toThrow();
  });
});
