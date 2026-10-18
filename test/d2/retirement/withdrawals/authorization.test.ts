import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateWithdrawals, type WithdrawalCash, type WithdrawalInput, type WithdrawalRequest, type WithdrawalSource } from "../../../../src/simulation/d2/retirement/withdrawals/index.js";
import { evaluateRmdObligations, rmdObligationId, type RmdInput, type RmdRequest, type RmdSource } from "../../../../src/simulation/d2/retirement/distributions/index.js";
import { civilDate as date } from "../../../../src/time/index.js";
import { Currency, money, Money, USD } from "../../../../src/values/index.js";
import { catalogSchema } from "../../../fixtures/d2/schema.js";

// Synthetic quotes, eligibility and jurisdictions; these are NOT statutory rules.
const at = date("2027-03-01");
const source = (resourceId: string, personId = "person", jurisdiction = "US:synthetic"): WithdrawalSource => ({
  id: `source:${resourceId}`, resourceId, personId, householdId: "household", ruleSnapshotId: `snapshot:${resourceId}`,
  jurisdiction, ruleFamily: "synthetic_withdrawal", sourcePublication: "Synthetic evidence only", version: "test-v1",
  publishedAt: date("2026-01-01"), asOf: at, effectiveFrom: date("2026-01-01"), endExclusive: date("2028-01-01"), projectionStatus: "verified",
});
const cash = (amount = "1000"): WithdrawalCash => ({
  accountId: "ira", ownerId: "person", householdId: "household", instrumentFamily: "traditional_ira", taxBucket: "pretax", beneficiaryId: null,
  eligibility: "eligible_ordinary_cash", unsupportedRules: [], eligibilitySource: source("ira"),
  liquidity: { kind: "available_unencumbered_account_cash", available: money(amount), settledAt: date("2027-02-28"), at,
    contention: "complete_external_reservations", source: { ...source("ira"), id: "source:cash" } },
});
const request = (id = "one", amount = "500"): WithdrawalRequest => ({
  operationId: `op:${id}`, withdrawalId: `withdrawal:${id}`, householdId: "household", personId: "person", sourceAccountId: "ira",
  taxBucket: "pretax", kind: "ordinary", effectiveAt: at, grossAmount: money(amount), targetObligationIds: [],
  bank: { id: "bank", ownerId: "person", householdId: "household", kind: "checking", source: source("bank") },
  withholding: { id: `withholding:${id}`, completeness: "verified_complete", source: source(`withholding:${id}`),
    instructions: [["federal", "50"], ["state", "20"]].map(([jurisdiction, amount]) => ({
      id: `${jurisdiction}:${id}`, jurisdiction: `US:${jurisdiction}`, amount: money(amount!), authorizationId: `remit:${jurisdiction}:${id}`,
      authorizationSource: source(`remit:${jurisdiction}:${id}`, "person", `US:${jurisdiction}`),
      destinationId: `tax:${jurisdiction}`, beneficiaryPersonId: "person", route: "qualified_tax_payment" as const,
      source: source(`${jurisdiction}:${id}`, "person", `US:${jurisdiction}`),
    })) },
  authorization: { id: `auth:${id}`, operationId: `op:${id}`, withdrawalId: `withdrawal:${id}`, sourceAccountId: "ira", bankId: "bank",
    withholdingId: `withholding:${id}`, grossAmount: money(amount), effectiveAt: at, routing: "cash_only_all_or_none", source: source(`auth:${id}`) },
});
const input = (requests: readonly WithdrawalRequest[] = [request()], accounts: readonly WithdrawalCash[] = [cash()]): WithdrawalInput => ({
  householdId: "household", knownAt: at, cash: accounts, requests,
  usage: { status: "verified_complete", operationIds: [], withdrawalIds: [], authorizationIds: [], source: source("household", "*") },
});
const denied = (value: WithdrawalInput, code?: string): void => {
  const result = evaluateWithdrawals(value);
  expect(result.candidates).toEqual([]); expect(result.coverage).toBe("incomplete"); expect(result.postable).toBe(false);
  expect(result.diagnostics.length).toBeGreaterThan(0);
  if (code) expect(result.diagnostics.some(d => d.diagnosticCode === code)).toBe(true);
  expect(result.diagnostics.every(d => d.seam === "S7" && d.coverage === "incomplete")).toBe(true);
};
const zero = (r: WithdrawalRequest): WithdrawalRequest => ({ ...r, withholding: { ...r.withholding!,
  instructions: r.withholding!.instructions.map(i => ({ ...i, amount: money("0") })) } });

describe("A4-2 ordinary cash authorization candidates (PFA-DET §5.4/S1–S8, PFA-TAX-015)", () => {
  it("reconciles 50,000 cents into 43,000 bank and 7,000 tax advance payments without posting", () => {
    const opening = cash(), result = evaluateWithdrawals(input([request()], [opening])), c = result.candidates[0]!;
    expect(result.coverage).toBe("complete"); expect(result.diagnostics).toEqual([]);
    expect(c.grossAmount.equals(money("500"))).toBe(true); expect(c.netAmount.equals(money("430"))).toBe(true);
    expect(c.withholdingAmount.equals(money("70"))).toBe(true);
    expect(c.intents.map(i => i.kind)).toEqual(["source_retirement_cash_decrease", "owned_bank_cash_increase", "withheld_tax_advance_payment_credit", "withheld_tax_advance_payment_credit"]);
    expect(c.intents.map(i => i.amount.toJSON().amount)).toEqual(["500", "430", "50", "20"]);
    expect(c.intents.slice(2).map(i => i.authorizationId)).toEqual(["remit:federal:one", "remit:state:one"]);
    expect(c.intents.slice(1).reduce((s, i) => s.plus(i.amount), Money.zero(USD)).equals(c.grossAmount)).toBe(true);
    expect(c.incrementalEconomicIncome.isZero()).toBe(true); expect(c.incrementalEconomicExpense.isZero()).toBe(true);
    expect(c.incomeCharacter).toBe("unresolved_retirement_distribution"); expect(c.taxCompleteness).toBe("incomplete");
    expect(c.committed).toBe(false); expect(c.postable).toBe(false); expect(result.committed).toBe(false);
    expect(result.funding).toBe("incomplete"); expect(result.bankSettlement).toBe("incomplete"); expect(result.tax).toBe("incomplete");
    expect(c.traceRefs).toEqual(["source:auth:one", "source:bank", "source:cash", "source:federal:one", "source:household", "source:ira", "source:remit:federal:one", "source:remit:state:one", "source:state:one", "source:withholding:one"]);
    expect(opening.liquidity!.available.equals(money("1000"))).toBe(true);
  });

  it("admits verified zero withholding but never infers zero from missing facts", () => {
    const r = zero(request()), c = evaluateWithdrawals(input([r])).candidates[0]!;
    expect(c.netAmount.equals(c.grossAmount)).toBe(true); expect(c.withholdingAmount.isZero()).toBe(true);
    const { withholding: _w, ...missing } = r;
    denied(input([missing]), "withholding");
    denied(input([{ ...r, withholding: { ...r.withholding!, completeness: "unknown" } }]), "withholding");
    denied(input([{ ...r, withholding: { ...r.withholding!, instructions: [] } }]), "withholding");
    denied(input([{ ...r, withholding: { ...r.withholding!, instructions: r.withholding!.instructions.map(i => ({ ...i, amount: money("300") })) } }]), "withholding");
  });

  it("rejects partial liquidity, unsettled cash, absent sales and incomplete contention", () => {
    denied(input([request()], [cash("499.99")]), "liquidity");
    const a = cash(), { liquidity: _liquidity, ...investedOnly } = a;
    denied(input([request()], [investedOnly]), "liquidity");
    for (const change of [{ settledAt: date("2027-03-02") }, { at: date("2027-02-28") }, { contention: "unknown" as const }]) {
      denied(input([request()], [{ ...a, liquidity: { ...a.liquidity!, ...change } }]), "liquidity");
    }
    denied(input([request()], [a, a]), "identity");
  });

  it("checks aggregate capacity without picking a winner and rejects incomplete batches atomically", () => {
    const a = request("one", "600"), b = request("two", "600");
    denied(input([a, b]), "liquidity");
    expect(evaluateWithdrawals(input([a, b]))).toEqual(evaluateWithdrawals(input([b, a])));
    const fits = [request("one"), request("two")];
    expect(evaluateWithdrawals(input(fits)).candidates).toHaveLength(2);
    expect(evaluateWithdrawals(input(fits))).toEqual(evaluateWithdrawals(input([...fits].reverse())));
    const { withholding: _w, ...missing } = fits[1]!;
    denied(input([fits[0]!, missing]), "withholding");
  });

  it("rejects duplicate operations, underlying withdrawals, authorizations and remittance sources", () => {
    const a = request(), b = request("two"), initial = input();
    denied(input([a, a]), "duplicate");
    denied(input([a, { ...b, withdrawalId: a.withdrawalId }]), "duplicate");
    denied(input([a, { ...b, authorization: { ...b.authorization!, id: a.authorization!.id } }]), "duplicate");
    denied(input([a, { ...b, withholding: a.withholding! }]), "duplicate");
    for (const key of ["operationIds", "withdrawalIds", "authorizationIds"] as const) {
      const id = key === "operationIds" ? a.operationId : key === "withdrawalIds" ? a.withdrawalId : a.authorization!.id;
      denied({ ...initial, usage: { ...initial.usage, [key]: [id] } }, "duplicate");
    }
    denied({ ...initial, usage: { ...initial.usage, authorizationIds: [a.withholding!.instructions[0]!.authorizationId] } }, "duplicate");
    denied({ ...initial, usage: { ...initial.usage, status: "unknown" } }, "unknown");
  });

  it("rejects incorrect source/destination ownership and unsupported banks/remittances", () => {
    const r = request(), a = cash();
    denied(input([{ ...r, personId: "other" }]), "identity");
    denied(input([r], [{ ...a, ownerId: "other" }]), "identity");
    denied(input([{ ...r, bank: { ...r.bank, ownerId: "other" } }]), "identity");
    denied(input([{ ...r, bank: { ...r.bank, householdId: "other" } }]), "identity");
    denied(input([{ ...r, bank: { ...r.bank, kind: "other" } }]), "routing");
    for (const change of [{ beneficiaryPersonId: "other" }, { destinationId: "bank" }, { route: "unknown" as const }]) {
      denied(input([{ ...r, withholding: { ...r.withholding!, instructions: r.withholding!.instructions.map(i => ({ ...i, ...change })) } }]), "routing");
    }
    denied(input([{ ...r, authorization: { ...r.authorization!, bankId: "other" } }]), "authorization");
    denied(input([{ ...r, authorization: { ...r.authorization!, grossAmount: money("499") } }]), "authorization");
    const { authorization: _auth, ...missing } = r;
    denied(input([missing]), "authorization");
  });

  it("gates unknown/future/expired eligibility and authorization rather than inventing law", () => {
    const r = request(), a = cash();
    denied(input([r], [{ ...a, eligibility: "unknown" }]), "unknown");
    denied(input([r], [{ ...a, eligibility: "unsupported" }]), "unsupported");
    denied(input([r], [{ ...a, unsupportedRules: ["early_distribution_penalty_unresolved"] }]), "unsupported");
    for (const projectionStatus of ["explicit_projected", "unavailable"] as const) {
      denied(input([r], [{ ...a, eligibilitySource: { ...a.eligibilitySource, projectionStatus } }]), projectionStatus === "explicit_projected" ? "future_law" : "unknown");
    }
    denied(input([{ ...r, authorization: { ...r.authorization!, source: { ...r.authorization!.source, endExclusive: at } } }]), "unknown");
    denied(input([{ ...r, authorization: { ...r.authorization!, source: { ...r.authorization!.source, publishedAt: date("2027-03-02") } } }]), "unknown");
    denied(input([{ ...r, bank: { ...r.bank, source: { ...r.bank.source, resourceId: "other" } } }]), "identity");
    denied(input([{ ...r, withholding: { ...r.withholding!, instructions: r.withholding!.instructions.map(i => ({ ...i,
      authorizationSource: { ...i.authorizationSource, projectionStatus: "unavailable" } })) } }]), "unknown");
  });

  it("gates Roth/basis ordering, mixed buckets, beneficiaries and nonordinary operations", () => {
    const r = request(), a = cash();
    for (const kind of ["in_kind", "rollover", "conversion", "qcd", "inherited"] as const) denied(input([{ ...r, kind }]), "unsupported");
    for (const taxBucket of ["roth", "aftertax", "mixed"] as const) denied(input([{ ...r, taxBucket }], [{ ...a, taxBucket }]), "unsupported");
    denied(input([r], [{ ...a, beneficiaryId: "beneficiary" }]), "unsupported");
    denied(input([r], [{ ...a, instrumentFamily: "roth_ira" }]), "unsupported");
    for (const instrumentFamily of ["sep_ira", "simple_ira"] as const) {
      expect(evaluateWithdrawals(input([r], [{ ...a, instrumentFamily }])).candidates).toHaveLength(1);
    }
    denied(input([r], [{ ...a, instrumentFamily: "workplace_plan" }]), "unknown");
    expect(evaluateWithdrawals(input([r], [{ ...a, instrumentFamily: "workplace_plan",
      planTerms: { planId: "plan", permission: "ordinary_cash_distribution", source: source("plan") } }])).candidates).toHaveLength(1);
  });

  it("uses exact arbitrarily large USD amounts and rejects fractional cents/currencies", () => {
    const r = request("huge", "9007199254740993.99");
    const c = evaluateWithdrawals(input([r], [cash("9007199254740993.99")])).candidates[0]!;
    expect(c.netAmount.equals(money("9007199254740923.99"))).toBe(true);
    for (const amount of [money("0"), money("-1"), money("0.001"), money("500", Currency.of("EUR"))]) {
      denied(input([{ ...request(), grossAmount: amount }]), "invalid");
    }
  });

  it("replays immutable snapshots deterministically without mutating or freezing caller input", () => {
    const r = request(), value = input([r]), before = JSON.stringify(value), first = evaluateWithdrawals(value);
    expect(evaluateWithdrawals(value)).toEqual(first); expect(JSON.stringify(value)).toBe(before);
    expect(Object.isFrozen(value)).toBe(false); expect(Object.isFrozen(r.targetObligationIds)).toBe(false);
    expect(Object.isFrozen(first)).toBe(true); expect(Object.isFrozen(first.candidates[0]!.intents[0])).toBe(true);
    const reordered = { ...r, withholding: { ...r.withholding!, instructions: [...r.withholding!.instructions].reverse() } };
    expect(evaluateWithdrawals(input([reordered]))).toEqual(first);
    expect(() => (first.candidates as unknown as unknown[]).push({})).toThrow();
  });

  it("leaves both first-year deferred RMD and next-year obligations unsatisfied across split receipts", () => {
    const stamp = (id: string, accountId: string | null = null): RmdSource => ({ id, accountId, personId: "person",
      publication: "Synthetic, not IRS law", version: "v1", status: "verified", publishedAt: date("2025-01-01"), asOf: at,
      effectiveFrom: date("1900-01-01"), effectiveUntil: date("2030-01-01") });
    const annual = (year: number): RmdRequest => ({ personId: "person", birthDate: date("1956-01-01"), personSource: stamp("person"), taxYear: year,
      accounts: [{ id: "ira", ownerId: "person", beneficiaryId: null, family: "traditional_ira", bucket: "pretax", source: stamp("account", "ira"),
        priorValue: { at: date(`${year - 1}-12-31`), amount: money("1000"), source: stamp("value", "ira") } }],
      rule: { snapshotId: `rule:${year}`, jurisdiction: "US:synthetic", source: stamp("rule"), family: "traditional_ira", bucket: "pretax", model: "owner_balance_divisor",
        bornFrom: date("1950-01-01"), bornUntil: date("1960-01-01"), startAge: 70, ageConvention: "age_at_year_end", rounding: "half_even", aggregationCalculation: "sum_account_rounded_amounts",
        factors: [{ ruleSnapshotId: `rule:${year}`, age: year - 1956, beneficiaryStatus: "owner_no_spouse", spouseId: null, spouseBirthDate: null, divisor: "2", source: stamp("factor") }],
        originalDue: date(`${year}-12-31`), deferredDue: date(`${year + 1}-04-01`), earliestSatisfaction: date(`${year}-01-01`), stillWorkingException: "not_permitted" },
      beneficiary: { status: "owner_no_spouse", spouseId: null, spouseBirthDate: null, source: stamp("beneficiary") },
      election: year === 2026 ? "defer" : "original", electionSource: stamp("election"), stillWorking: null, aggregation: null });
    const years = [annual(2026), annual(2027)], ids = years.map(rmdObligationId);
    const rmdInput: RmdInput = { currency: USD, asOf: at, knownAt: at, requests: years, distributions: [] };
    const before = evaluateRmdObligations(rmdInput);
    expect(before.obligations).toHaveLength(2); expect(new Set(ids).size).toBe(2);
    const proposed = evaluateWithdrawals(input(["partial-a", "partial-b"].map(id => ({ ...request(id, "250"), targetObligationIds: ids }))));
    expect(proposed.candidates).toHaveLength(2);
    expect(proposed.candidates.every(c => c.rmdSatisfaction === "not_applied" && c.targetObligationIds.length === 2)).toBe(true);
    expect(new Set(proposed.candidates.map(c => c.claimId)).size).toBe(2);
    expect(evaluateRmdObligations(rmdInput)).toEqual(before);
    expect(before.obligations.every(o => o.satisfied.isZero() && o.remaining.equals(money("500")))).toBe(true);
  });

  it("reads original ordinary/RMD prep facts unchanged and preserves decision_required", () => {
    const catalog = catalogSchema.parse(JSON.parse(readFileSync(new URL("../../../fixtures/d2/catalog.json", import.meta.url), "utf8")));
    for (const id of ["retirement_ordinary", "retirement_rmd"]) {
      const fixture = catalog.cases.find(c => c.id === id)!;
      expect(fixture.input.amounts.requestedCents).toBe("50000"); expect(fixture.input.amounts.openingRetirementCents).toBe("100000");
      expect(fixture.input.terms.withholding).toBe("not supplied"); expect(fixture.expected.capability).toBe("decision_required");
      expect(fixture.expected.integratedRuntimeEvidence).toBe(false);
      const { withholding: _w, ...missing } = request();
      denied(input([missing]), "withholding");
    }
  });
});
