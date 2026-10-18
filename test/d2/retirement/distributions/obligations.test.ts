import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateRmdObligations, rmdObligationId, type RmdAccount, type RmdDistribution, type RmdInput, type RmdRequest, type RmdSource } from "../../../../src/simulation/d2/retirement/distributions/index.js";
import { civilDate as date } from "../../../../src/time/index.js";
import { Currency, money, USD } from "../../../../src/values/index.js";
import { catalogSchema } from "../../../fixtures/d2/schema.js";

// Deliberately synthetic ages, factors, and deadlines. These are NOT IRS law.
const source = (id: string, accountId: string | null = null, personId = "person"): RmdSource => ({
  id, accountId, personId, publication: "Synthetic dated RMD source; not official IRS data", version: "test-v1", status: "verified",
  publishedAt: date("2024-01-01"), asOf: date("2028-06-01"), effectiveFrom: date("1900-01-01"), effectiveUntil: date("2030-01-01"),
});
const account = (id = "ira", family: RmdAccount["family"] = "traditional_ira", value = "1000", person = "person", year = 2026): RmdAccount => ({
  id, family, ownerId: person, beneficiaryId: null, bucket: "synthetic_pretax", source: source(`account:${id}`, id, person),
  priorValue: { at: date(`${year - 1}-12-31`), amount: money(value), source: source(`value:${id}:${year}`, id, person) },
});
const request = (year = 2026, person = "person", id = "ira"): RmdRequest => ({
  personId: person, taxYear: year, birthDate: date("1956-02-29"), personSource: source(`person:${person}`, null, person),
  accounts: [account(id, "traditional_ira", "1000", person, year)],
  rule: { snapshotId: `synthetic:${year}`, jurisdiction: "US:synthetic", source: source(`rule:${year}`, null, person), family: "traditional_ira", bucket: "synthetic_pretax",
    model: "owner_balance_divisor", bornFrom: date("1950-01-01"), bornUntil: date("1960-01-01"), startAge: 70, ageConvention: "age_at_year_end",
    rounding: "half_even", aggregationCalculation: "sum_account_rounded_amounts",
    factors: [{ ruleSnapshotId: `synthetic:${year}`, age: year - 1956, beneficiaryStatus: "owner_no_spouse", spouseId: null, spouseBirthDate: null, divisor: "3", source: source(`factor:${year}`, null, person) }],
    originalDue: date(`${year}-12-31`), deferredDue: date(`${year + 1}-04-02`), earliestSatisfaction: date(`${year}-01-01`), stillWorkingException: "not_permitted" },
  beneficiary: { status: "owner_no_spouse", spouseId: null, spouseBirthDate: null, source: source("beneficiary", null, person) },
  election: "original", electionSource: source("election", null, person), stillWorking: null, aggregation: null,
});
const input = (requests: readonly RmdRequest[] = [request()], distributions: readonly RmdDistribution[] = []): RmdInput => ({
  currency: USD, asOf: date("2028-06-01"), knownAt: date("2028-06-02"), requests, distributions,
});
const actual = (r: RmdRequest, amount = "100", id = "tx", at = `${r.taxYear}-06-01`): RmdDistribution => ({
  transactionId: id, personId: r.personId, payerOwnerId: r.personId, accountId: r.accounts[0]!.id, at: date(at), gross: money(amount), kind: "rmd",
  funding: "posted_funded", authorized: true, usageRegister: "verified_complete", source: source(`actual:${id}`, r.accounts[0]!.id, r.personId),
  allocations: [{ id: `allocation:${id}`, obligationId: rmdObligationId(r), satisfiesRmdYear: r.taxYear, amount: money(amount), historical: false }],
});
const evaluate = (r: RmdRequest) => evaluateRmdObligations(input([r]));
const denied = (r: RmdRequest, code: string): void => {
  const result = evaluate(r); expect(result.obligations).toEqual([]); expect(result.diagnostics.some(d => d.diagnosticCode === code && d.coverage === "incomplete")).toBe(true);
};
const deniedActual = (r: RmdRequest, d: RmdDistribution, code: string): void => {
  const result = evaluateRmdObligations(input([r], [d]));
  expect(result.obligations[0]!.satisfied.isZero()).toBe(true); expect(result.obligations[0]!.remaining.equals(money("333.33"))).toBe(true);
  expect(result.diagnostics.some(x => x.diagnosticCode === code)).toBe(true);
};

describe("A4-1 sourced annual RMD obligations (PFA-DET §5.4/S1–S8, PFA-TAX-015)", () => {
  it("calculates exact cents from previous December 31, with separate uncommitted intents", () => {
    const result = evaluate(request()), o = result.obligations[0]!;
    expect(o.required.equals(money("333.33"))).toBe(true);
    expect(o.components[0]!.priorValue.equals(money("1000"))).toBe(true);
    expect(o.satisfied.isZero()).toBe(true); expect(o.remaining.equals(o.required)).toBe(true);
    expect(o.overdue).toBe(true); expect(o.committed).toBe(false); expect(o.postable).toBe(false);
    expect(result.intents[0]!.grossNeeded.equals(o.required)).toBe(true);
    expect(result.tax).toBe("incomplete"); expect(result.funding).toBe("incomplete"); expect(result.bankSettlement).toBe("incomplete");
    expect(o.traceRefs).toContain("value:ira:2026"); expect(o.traceRefs).toContain("factor:2026");
  });

  it("uses a single exact division, supplied rounding and arbitrary-size decimal money", () => {
    const r = request(), a = r.accounts[0]!;
    const set = (v: string, divisor: string) => ({ ...r, accounts: [{ ...a, priorValue: { ...a.priorValue!, amount: money(v) } }],
      rule: { ...r.rule!, factors: [{ ...r.rule!.factors[0]!, divisor }] } });
    expect(evaluate(set("1.01", "2")).obligations[0]!.required.equals(money("0.50"))).toBe(true);
    expect(evaluate({ ...set("1.01", "2"), rule: { ...set("1.01", "2").rule!, rounding: "half_up" } }).obligations[0]!.required.equals(money("0.51"))).toBe(true);
    expect(evaluate(set("9007199254740993.99", "3")).obligations[0]!.required.equals(money("3002399751580331.33"))).toBe(true);
    const zero = evaluate(set("0", "3")); expect(zero.obligations[0]!.required.isZero()).toBe(true); expect(zero.intents).toEqual([]);
    for (const divisor of ["0", "-1", "bad"]) denied(set("1000", divisor), "invalid");
    for (const v of ["-1", "0.001"]) denied(set(v, "3"), "invalid");
    denied({ ...r, accounts: [{ ...a, priorValue: { ...a.priorValue!, amount: money("1000", Currency.of("EUR")) } }] }, "invalid");
  });

  it("keeps first-year deferred and following annual obligations distinct, with explicit shared-transaction allocations", () => {
    const first = { ...request(), election: "defer" as const }, next = request(2027);
    const d = actual(first, "666.66", "two", "2027-03-01");
    const result = evaluateRmdObligations(input([first, next], [{ ...d, allocations: [
      { ...d.allocations[0]!, amount: money("333.33") },
      { id: "allocation:next", obligationId: rmdObligationId(next), satisfiesRmdYear: 2027, amount: money("333.33"), historical: false },
    ] }]));
    expect(result.obligations).toHaveLength(2);
    expect(new Set(result.obligations.map(o => o.id)).size).toBe(2);
    expect(result.obligations.map(o => o.due)).toEqual([date("2027-04-02"), date("2027-12-31")]);
    expect(result.obligations[0]!.originalDue).toBe(date("2026-12-31"));
    expect(result.obligations.every(o => o.remaining.isZero() && o.satisfiedLate.isZero())).toBe(true);
    expect(result.intents).toEqual([]); expect(result.tax).toBe("incomplete");
    denied({ ...next, election: "defer" }, "deadline");
    denied({ ...first, election: "undecided" }, "deadline");
    denied({ ...first, rule: { ...first.rule!, deferredDue: null } }, "deadline");
  });

  it("retains partial, historical and late payments and unpaid shortfalls explicitly", () => {
    const r = request(), early = actual(r, "100", "early"), late = actual(r, "50", "late", "2027-01-02");
    const result = evaluateRmdObligations(input([r], [{ ...early, allocations: [{ ...early.allocations[0]!, historical: true }] }, late]));
    const o = result.obligations[0]!;
    expect(o.satisfied.equals(money("150"))).toBe(true); expect(o.satisfiedOnTime.equals(money("100"))).toBe(true);
    expect(o.satisfiedLate.equals(money("50"))).toBe(true); expect(o.remaining.equals(money("183.33"))).toBe(true);
    expect(o.overdue).toBe(true); expect(o.allocations[0]!.historical).toBe(true);
    const paid = evaluateRmdObligations(input([r], [actual(r, "333.33")])); expect(paid.obligations[0]!.remaining.isZero()).toBe(true);
    const latePaid = evaluateRmdObligations(input([r], [actual(r, "333.33", "late", "2027-01-01")]));
    expect(latePaid.obligations[0]!.satisfiedLate.equals(money("333.33"))).toBe(true);
    expect(latePaid.obligations[0]!.deadlineShortfall.equals(money("333.33"))).toBe(true);
  });

  it("does not treat ineligible, unverified, unfunded or unauthorized activity as satisfaction", () => {
    const r = request(), d = actual(r);
    for (const kind of ["rollover", "conversion", "qcd", "inherited", "other"] as const) deniedActual(r, { ...d, kind }, "unsupported");
    for (const funding of ["unfunded", "proposed"] as const) deniedActual(r, { ...d, funding }, "funding");
    deniedActual(r, { ...d, authorized: false }, "authorization");
    deniedActual(r, { ...d, usageRegister: "unknown" }, "authorization");
    deniedActual(r, { ...d, payerOwnerId: "wrong" }, "invalid");
    deniedActual(r, { ...d, personId: "wrong", payerOwnerId: "wrong", source: { ...d.source, personId: "wrong" } }, "authorization");
    deniedActual(r, { ...d, accountId: "workplace", source: { ...d.source, accountId: "workplace" } }, "authorization");
    deniedActual(r, { ...d, allocations: [{ ...d.allocations[0]!, satisfiesRmdYear: 2025 }] }, "authorization");
    deniedActual(r, { ...d, at: date("2025-12-31") }, "deadline");
    deniedActual(r, { ...d, at: date("2028-06-02") }, "invalid");
    deniedActual(r, { ...d, source: { ...d.source, status: "projected" } }, "authorization");
    deniedActual(r, { ...d, source: { ...d.source, asOf: date("2025-01-01") } }, "invalid");
  });

  it("rejects duplicate identities, conflicting registers, renamed usage and over-allocation without ordering effects", () => {
    const r = request(), d = actual(r);
    for (const distributions of [[d, d], [d, { ...d, transactionId: "alias" }], [d, actual(r, "300", "too-much")]]) {
      const result = evaluateRmdObligations(input([r], distributions));
      expect(result.obligations[0]!.satisfied.isZero()).toBe(true);
      expect(evaluateRmdObligations(input([r], [...distributions].reverse()))).toEqual(result);
    }
    deniedActual(r, { ...d, gross: money("99") }, "invalid");
    deniedActual(r, { ...d, allocations: [...d.allocations, { id: "old", obligationId: "outside", satisfiesRmdYear: 2025, historical: true, amount: money("1") }] }, "invalid");
    const history = { ...d, gross: money("150"), allocations: [...d.allocations, { id: "old", obligationId: "outside", satisfiesRmdYear: 2025, historical: true, amount: money("50") }] };
    expect(evaluateRmdObligations(input([r], [history])).obligations[0]!.satisfied.equals(money("100"))).toBe(true);
    deniedActual(r, { ...history, allocations: [{ ...history.allocations[1]!, historical: false }] }, "authorization");
    expect(evaluateRmdObligations(input([r, r])).obligations).toEqual([]);
    const overlap = { ...r, rule: { ...r.rule!, snapshotId: "other" } };
    expect(evaluateRmdObligations(input([r, overlap])).obligations).toEqual([]);
  });

  it("supports expressly sourced IRA groups and never transfers workplace satisfaction", () => {
    const r = request(), a = account("sep", "sep_ira", "2000"), b = account("simple", "simple_ira", "3000");
    const grouped: RmdRequest = { ...r, accounts: [a, r.accounts[0]!, b], aggregation: { id: "legal-ira-pool", ruleSnapshotId: r.rule!.snapshotId, accountIds: ["ira", "sep", "simple"], permission: "ira_cross_account", source: source("aggregation") } };
    const result = evaluate(grouped); expect(result.obligations[0]!.required.equals(money("2000"))).toBe(true);
    expect(result.obligations[0]!.components).toHaveLength(3);
    expect(evaluate({ ...grouped, accounts: [...grouped.accounts].reverse(), aggregation: { ...grouped.aggregation!, accountIds: [...grouped.aggregation!.accountIds].reverse() } })).toEqual(result);
    const d = actual(grouped, "2000"); expect(evaluateRmdObligations(input([grouped], [d])).obligations[0]!.remaining.isZero()).toBe(true);
    denied({ ...grouped, aggregation: null }, "law");
    denied({ ...grouped, aggregation: { ...grouped.aggregation!, accountIds: ["ira", "sep"] } }, "law");
    denied({ ...grouped, aggregation: { ...grouped.aggregation!, source: { ...grouped.aggregation!.source, status: "unavailable" } } }, "law");
    const plan = workplace();
    const mixed = { ...grouped, accounts: [...grouped.accounts, plan.accounts[0]!], aggregation: { ...grouped.aggregation!, accountIds: ["ira", "sep", "simple", "plan"] } };
    denied(mixed, "unsupported");
    const p = evaluateRmdObligations(input([r, plan], [actual(plan, "100")]));
    expect(p.obligations.find(o => o.accountIds.includes("ira"))!.satisfied.isZero()).toBe(true);
    expect(p.obligations.find(o => o.accountIds.includes("plan"))!.satisfied.equals(money("100"))).toBe(true);
    deniedActual(r, { ...actual(plan), allocations: [{ ...actual(r).allocations[0]! }] }, "authorization");
  });

  it("gates sourced workplace still-working/ownership eligibility and lifetime Roth rules", () => {
    const r = workplace();
    expect(evaluate(r).obligations).toHaveLength(1);
    const exception = { ...r, rule: { ...r.rule!, stillWorkingException: "verified_plan_eligibility" as const } };
    denied(exception, "law");
    const work = { employed: true, ownershipEligible: true, source: source("employment") };
    expect(evaluate({ ...exception, stillWorking: work }).diagnostics[0]!.coverage).toBe("not_applicable");
    for (const facts of [{ ...work, employed: null }, { ...work, ownershipEligible: null }]) denied({ ...exception, stillWorking: facts }, "law");
    expect(evaluate({ ...exception, stillWorking: { ...work, ownershipEligible: false } }).obligations).toHaveLength(1);
    const { planTerms: _terms, ...missingTerms } = r.accounts[0]!;
    denied({ ...r, accounts: [missingTerms] }, "law");
    const iraRequest = request(); denied({ ...iraRequest, rule: { ...iraRequest.rule!, stillWorkingException: "verified_plan_eligibility" }, stillWorking: work }, "law");
    const roth = { ...iraRequest, accounts: [account("ira", "roth_ira")], rule: { ...iraRequest.rule!, family: "roth_ira" as const, model: "lifetime_roth_exempt" as const } };
    expect(evaluate(roth).diagnostics[0]!.coverage).toBe("not_applicable");
    denied({ ...roth, rule: { ...roth.rule, model: "owner_balance_divisor" } }, "unsupported");
    denied({ ...roth, rule: { ...roth.rule, source: { ...roth.rule.source, status: "projected" } } }, "law");
  });

  it("requires dated observed balances, current sourced law, cohort, beneficiary and deadline decisions", () => {
    const r = request(), a = r.accounts[0]!, rule = r.rule!;
    const { priorValue: _value, ...missing } = a; denied({ ...r, accounts: [missing] }, "missing_prior_balance");
    for (const at of ["2026-12-31", "2025-12-30", "2026-01-01"]) denied({ ...r, accounts: [{ ...a, priorValue: { ...a.priorValue!, at: date(at) } }] }, "missing_prior_balance");
    denied({ ...r, accounts: [{ ...a, priorValue: { ...a.priorValue!, source: { ...a.priorValue!.source, asOf: date("2025-12-30") } } }] }, "missing_prior_balance");
    const { rule: _rule, ...noRule } = r; denied(noRule, "law");
    for (const s of [{ ...rule.source, status: "projected" as const }, { ...rule.source, publishedAt: date("2029-01-01") },
      { ...rule.source, effectiveFrom: date("2027-01-01") }, { ...rule.source, effectiveUntil: date("2026-12-31") }, { ...rule.source, version: "" }]) denied({ ...r, rule: { ...rule, source: s } }, "law");
    denied({ ...r, rule: { ...rule, bornUntil: r.birthDate } }, "law");
    expect(evaluate({ ...r, rule: { ...rule, bornFrom: r.birthDate } }).obligations).toHaveLength(1);
    expect(evaluate({ ...r, rule: { ...rule, startAge: 71 } }).diagnostics[0]!.coverage).toBe("not_applicable");
    for (const status of ["inherited", "unknown"] as const) denied({ ...r, beneficiary: { ...r.beneficiary, status } }, "beneficiary");
    denied({ ...r, beneficiary: { ...r.beneficiary, status: "owner_spouse" } }, "beneficiary");
    const spouse = { ...r.beneficiary, status: "owner_spouse" as const, spouseId: "spouse", spouseBirthDate: date("1960-01-01") };
    denied({ ...r, beneficiary: spouse }, "law");
    expect(evaluate({ ...r, beneficiary: spouse, rule: { ...rule, factors: [{ ...rule.factors[0]!, beneficiaryStatus: "owner_spouse", spouseId: spouse.spouseId, spouseBirthDate: spouse.spouseBirthDate }] } }).obligations).toHaveLength(1);
    denied({ ...r, rule: { ...rule, factors: [] } }, "law");
    denied({ ...r, rule: { ...rule, factors: [{ ...rule.factors[0]!, ruleSnapshotId: "other" }] } }, "law");
    denied({ ...r, rule: { ...rule, factors: [...rule.factors, ...rule.factors] } }, "law");
    denied({ ...r, rule: { ...rule, originalDue: date("2027-01-01") } }, "deadline");
    denied({ ...r, birthDate: "1955-02-29" as RmdRequest["birthDate"] }, "invalid");
    denied({ ...r, accounts: [{ ...a, beneficiaryId: "inherited-owner" }] }, "beneficiary");
    denied({ ...r, accounts: [{ ...a, ownerId: "other" }] }, "invalid");
    denied({ ...r, accounts: [{ ...a, bucket: "unknown" }] }, "invalid");
    denied({ ...r, accounts: [{ ...a, priorValue: { ...a.priorValue!, source: { ...a.priorValue!.source, status: "projected" } } }] }, "missing_prior_balance");
    denied({ ...r, rule: { ...rule, factors: [{ ...rule.factors[0]!, source: { ...rule.factors[0]!.source, status: "unavailable" } }] } }, "law");
  });

  it("isolates people, preserves year/leap boundaries, replay and input immutability", () => {
    const r = request(), spouse = request(2026, "spouse", "spouse-ira"), f = input([r, spouse], [actual(r, "100", "a"), actual(spouse, "200", "b")]);
    const before = JSON.stringify(f), result = evaluateRmdObligations(f);
    expect(result.obligations).toHaveLength(2); expect(result.obligations.map(o => o.satisfied.toJSON().amount)).toEqual(["100", "200"]);
    expect(evaluateRmdObligations(f)).toEqual(result);
    expect(evaluateRmdObligations({ ...f, requests: [...f.requests].reverse(), distributions: [...f.distributions].reverse() })).toEqual(result);
    expect(JSON.stringify(f)).toBe(before);
    const leap = request(2028); expect(evaluateRmdObligations(input([leap], [actual(leap, "100", "leap", "2028-02-29")])).obligations[0]!.satisfied.equals(money("100"))).toBe(true);
    const d = actual(r, "100", "boundary", "2026-12-31"); expect(evaluateRmdObligations(input([r], [d])).obligations[0]!.satisfiedLate.isZero()).toBe(true);
    expect(evaluateRmdObligations(input([r], [actual(r, "100", "boundary", "2027-01-01")])).obligations[0]!.satisfiedLate.equals(money("100"))).toBe(true);
  });

  it("reads unchanged conditional fixtures: authored amount and opening cash do not establish RMD law or tax", () => {
    const catalog = catalogSchema.parse(JSON.parse(readFileSync(new URL("../../../fixtures/d2/catalog.json", import.meta.url), "utf8")));
    for (const id of ["retirement_rmd", "retirement_ordinary"]) {
      const prep = catalog.cases.find(c => c.id === id)!, before = JSON.stringify(prep);
      expect(prep.input.amounts.requestedCents).toBe("50000"); expect(prep.input.amounts.openingRetirementCents).toBe("100000");
      expect(prep.input.terms.withholding).toBe("not supplied"); expect(prep.expected.capability).toBe("decision_required"); expect(prep.expected.integratedRuntimeEvidence).toBe(false);
      const { rule: _rule, ...withoutLaw } = request(); denied(withoutLaw, "law");
      const supplemental = evaluate(request()); expect(supplemental.tax).toBe("incomplete"); expect(supplemental.bankSettlement).toBe("incomplete");
      expect(JSON.stringify(prep)).toBe(before);
    }
  });
});

function workplace(): RmdRequest {
  const r = request(), a = account("plan", "workplace_plan");
  return { ...r, accounts: [{ ...a, planTerms: { rmdMethod: "owner_balance_divisor", ruleSnapshotId: r.rule!.snapshotId, source: source("plan-terms", "plan") } }], rule: { ...r.rule!, family: "workplace_plan" } };
}
