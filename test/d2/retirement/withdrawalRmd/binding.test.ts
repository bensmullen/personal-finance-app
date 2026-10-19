import { describe, expect, it } from "vitest";
import { evaluateWithdrawalRmd, type AllocationInstruction, type AllocationTerms, type WithdrawalRmdInput } from "../../../../src/simulation/d2/retirement/withdrawalRmd/index.js";
import { rmdObligationId, type RmdRequest, type RmdSource } from "../../../../src/simulation/d2/retirement/distributions/index.js";
import { type WithdrawalCash, type WithdrawalRequest, type WithdrawalSource } from "../../../../src/simulation/d2/retirement/withdrawals/index.js";
import { civilDate as date } from "../../../../src/time/index.js";
import { Currency, money, USD } from "../../../../src/values/index.js";

// Synthetic evidence, ages, divisors and jurisdictions; never statutory IRS data.
const at = date("2027-03-01");
const ws = (resourceId: string, personId = "person"): WithdrawalSource => ({
  id: `w:${resourceId}`, resourceId, personId, householdId: "home", ruleSnapshotId: `snapshot:${resourceId}`,
  jurisdiction: "US:synthetic", ruleFamily: "synthetic", sourcePublication: "Synthetic only", version: "v1",
  publishedAt: date("2025-01-01"), asOf: at, effectiveFrom: date("2025-01-01"), endExclusive: date("2030-01-01"), projectionStatus: "verified",
});
const rs = (id: string, accountId: string | null = null): RmdSource => ({
  id: `r:${id}`, accountId, personId: "person", publication: "Synthetic only", version: "v1", status: "verified",
  publishedAt: date("2025-01-01"), asOf: at, effectiveFrom: date("1900-01-01"), effectiveUntil: date("2030-01-01"),
});
function annual(year = 2026): RmdRequest {
  return { personId: "person", birthDate: date("1956-01-01"), personSource: rs("person"), taxYear: year,
    accounts: [{ id: "ira", ownerId: "person", beneficiaryId: null, family: "traditional_ira", bucket: "pretax", source: rs("ira", "ira"),
      priorValue: { at: date(`${year - 1}-12-31`), amount: money("1400"), source: rs(`value:${year}`, "ira") } }],
    rule: { snapshotId: `rule:${year}`, jurisdiction: "US:synthetic", source: rs(`rule:${year}`), family: "traditional_ira", bucket: "pretax", model: "owner_balance_divisor",
      bornFrom: date("1950-01-01"), bornUntil: date("1960-01-01"), startAge: 70, ageConvention: "age_at_year_end", rounding: "half_even",
      aggregationCalculation: "sum_account_rounded_amounts", factors: [{ ruleSnapshotId: `rule:${year}`, age: year - 1956,
        beneficiaryStatus: "owner_no_spouse", spouseId: null, spouseBirthDate: null, divisor: "2", source: rs(`factor:${year}`) }],
      originalDue: date(`${year}-12-31`), deferredDue: date(`${year + 1}-04-01`), earliestSatisfaction: date(`${year}-01-01`), stillWorkingException: "not_permitted" },
    beneficiary: { status: "owner_no_spouse", spouseId: null, spouseBirthDate: null, source: rs("beneficiary") },
    election: year === 2026 ? "defer" : "original", electionSource: rs("election"), stillWorking: null, aggregation: null };
}
const cash = (id = "ira"): WithdrawalCash => ({ accountId: id, ownerId: "person", householdId: "home", instrumentFamily: "traditional_ira", taxBucket: "pretax",
  beneficiaryId: null, eligibility: "eligible_ordinary_cash", unsupportedRules: [], eligibilitySource: ws(id),
  liquidity: { kind: "available_unencumbered_account_cash", available: money("1000"), at, settledAt: at,
    contention: "complete_external_reservations", source: { ...ws(id), id: `w:cash:${id}` } } });
function withdrawal(id = "one", amount = "500", targets = [rmdObligationId(annual())], account = "ira"): WithdrawalRequest {
  return { operationId: `op:${id}`, withdrawalId: `withdrawal:${id}`, householdId: "home", personId: "person", sourceAccountId: account,
    taxBucket: "pretax", kind: "ordinary", effectiveAt: at, grossAmount: money(amount), targetObligationIds: targets,
    bank: { id: "bank", ownerId: "person", householdId: "home", kind: "checking", source: ws("bank") },
    withholding: { id: `wh:${id}`, completeness: "verified_complete", source: ws(`wh:${id}`), instructions: [{
      id: `tax:${id}`, jurisdiction: "US:synthetic", amount: money("0"), authorizationId: `remit:${id}`, authorizationSource: ws(`remit:${id}`),
      destinationId: "tax", beneficiaryPersonId: "person", route: "qualified_tax_payment", source: ws(`tax:${id}`) }] },
    authorization: { id: `auth:${id}`, operationId: `op:${id}`, withdrawalId: `withdrawal:${id}`, sourceAccountId: account, bankId: "bank",
      withholdingId: `wh:${id}`, grossAmount: money(amount), effectiveAt: at, routing: "cash_only_all_or_none", source: ws(`auth:${id}`) } };
}
function allocation(w = withdrawal(), r = annual(), amount = "500", id = "a"): AllocationInstruction {
  const terms: AllocationTerms = { withdrawalId: w.withdrawalId, authorizationId: w.authorization!.id, allocationId: id, rmdObligationId: rmdObligationId(r),
    householdId: w.householdId, personId: w.personId, taxYear: r.taxYear, sourceAccountId: w.sourceAccountId, effectiveAt: w.effectiveAt,
    amount: money(amount), ruleSnapshotId: r.rule!.snapshotId };
  return approve(terms);
}
function approve(terms: AllocationTerms): AllocationInstruction {
  const id = `approve:${terms.allocationId}`;
  return { ...terms, approval: { id, terms: { ...terms }, source: ws(id), rmdSource: rs(id, terms.sourceAccountId) } };
}
function fixture(wsInput = [withdrawal()], requests = [annual()], allocations = [allocation()]): WithdrawalRmdInput {
  return { withdrawals: { householdId: "home", knownAt: at, cash: [cash()], requests: wsInput,
    usage: { status: "verified_complete", operationIds: [], withdrawalIds: [], authorizationIds: [], source: ws("home", "*") } },
    rmd: { currency: USD, asOf: at, knownAt: at, requests, distributions: [] }, allocations,
    usage: { status: "verified_complete", allocationIds: [], approvalIds: [], source: { ...ws("home", "*"), id: "w:binding-usage" } } };
}
function denied(input: WithdrawalRmdInput, code?: string): void {
  const result = evaluateWithdrawalRmd(input);
  expect(result.bundle).toBeNull(); expect(result.bindingStatus).toBe("incomplete");
  expect(result.diagnostics.length).toBeGreaterThan(0);
  expect(result.committed).toBe(false); expect(result.postable).toBe(false); expect(result.rmdSatisfaction).toBe("not_applied");
  expect(result.rmd.obligations.every(o => o.satisfied.isZero())).toBe(true);
  if (code) expect(result.diagnostics.some(d => d.diagnosticCode === code)).toBe(true);
  expect(result.diagnostics.every(d => d.seam === "S7" && d.coverage === "incomplete" && d.period && d.missingFacts.length && d.affectedOutput && d.sourceEntityPath)).toBe(true);
}

describe("A4 source-qualified pre-funding RMD authorization (PFA-DET §5.4/S1–S8)", () => {
  it("conditionally binds $500 of $700, then a separate $200; never posts or satisfies", () => {
    const value = fixture(), before = JSON.stringify(value), first = evaluateWithdrawalRmd(value);
    expect(first.bundle!.obligations[0]!.remainingRequested.equals(money("200"))).toBe(true);
    expect(first.bundle!.obligations[0]!.proposedOnTime.equals(money("500"))).toBe(true);
    expect(first.rmd.obligations[0]!.remaining.equals(money("700"))).toBe(true);
    expect(first.rmd.obligations[0]!.satisfied.isZero()).toBe(true);
    const second = withdrawal("two", "200");
    const result = evaluateWithdrawalRmd(fixture([withdrawal(), second], [annual()], [allocation(), allocation(second, annual(), "200", "b")]));
    expect(result.bundle!.obligations[0]!.remainingRequested.isZero()).toBe(true);
    expect(result.rmd.obligations[0]!.satisfied.isZero()).toBe(true);
    expect(result.rmd.diagnostics.some(d => d.diagnosticCode === "funding")).toBe(true);
    expect(result.funding).toBe("incomplete"); expect(result.bundle!.postable).toBe(false);
    expect(first.withdrawals.candidates[0]!.netAmount.equals(money("500"))).toBe(true);
    expect(first.withdrawals.candidates[0]!.incrementalEconomicIncome.isZero()).toBe(true);
    expect(JSON.stringify(value)).toBe(before); expect(value.withdrawals.cash[0]!.liquidity!.available.equals(money("1000"))).toBe(true);
  });

  it("keeps unrelated withdrawals and target annotations unbound without approval", () => {
    for (const targets of [[], [rmdObligationId(annual())]]) {
      const result = evaluateWithdrawalRmd(fixture([withdrawal("one", "500", targets)], [annual()], []));
      expect(result.bundle!.allocations).toEqual([]);
      expect(result.bundle!.withdrawals[0]!.unallocatedGross.equals(money("500"))).toBe(true);
      expect(result.bundle!.obligations[0]!.remainingRequested.equals(money("700"))).toBe(true);
    }
    const { approval: _approval, ...missing } = allocation();
    denied(fixture(undefined, undefined, [missing]), "authorization");
    denied(fixture([withdrawal("one", "500", [])]), "identity");
  });

  it("splits one withdrawal across first-year deferred and following-year obligations", () => {
    const years = [annual(), annual(2027)], w = withdrawal("one", "700", years.map(rmdObligationId));
    const result = evaluateWithdrawalRmd(fixture([w], years, [allocation(w, years[0]!, "300"), allocation(w, years[1]!, "400", "b")]));
    expect(result.bundle!.obligations.map(o => o.remainingRequested.toJSON().amount)).toEqual(["400", "300"]);
    expect(result.rmd.obligations.map(o => o.due)).toEqual([date("2027-04-01"), date("2027-12-31")]);
    expect(result.rmd.obligations.every(o => o.satisfied.isZero())).toBe(true);
    denied(fixture([w], years, [approve({ ...allocation(w), taxYear: 2027 })]), "identity");
  });

  it("uses sourced legal two-account IRA aggregation and rejects plan cross-allocation", () => {
    const r = annual(), a = r.accounts[0]!;
    const group: RmdRequest = { ...r, accounts: [a, { ...a, id: "ira2", source: rs("ira2", "ira2"),
      priorValue: { ...a.priorValue!, source: rs("value:ira2", "ira2") } }],
      aggregation: { id: "pool", ruleSnapshotId: r.rule!.snapshotId, accountIds: ["ira", "ira2"], permission: "ira_cross_account", source: rs("pool") } };
    const w = withdrawal("one", "500", [rmdObligationId(group)], "ira2");
    const value = fixture([w], [group], [allocation(w, group)]);
    const input = { ...value, withdrawals: { ...value.withdrawals, cash: [cash("ira2")] } };
    expect(evaluateWithdrawalRmd(input).bundle!.obligations[0]!.remainingRequested.equals(money("900"))).toBe(true);
    expect(evaluateWithdrawalRmd({ ...input, rmd: { ...input.rmd, requests: [{ ...group, accounts: [...group.accounts].reverse(),
      aggregation: { ...group.aggregation!, accountIds: [...group.aggregation!.accountIds].reverse() } }] } })).toEqual(evaluateWithdrawalRmd(input));
    denied({ ...input, rmd: { ...input.rmd, requests: [{ ...group, aggregation: null }] } });
    denied({ ...input, rmd: { ...input.rmd, requests: [{ ...group, accounts: [a, { ...group.accounts[1]!, family: "workplace_plan" }] }] } });
  });

  it("describes late proposals without changing statutory deadline shortfall and gates early windows", () => {
    const r = { ...annual(), election: "original" as const }, w = withdrawal();
    const result = evaluateWithdrawalRmd(fixture([w], [r], [allocation(w, r)]));
    expect(result.bundle!.allocations[0]!.proposedLate).toBe(true);
    expect(result.bundle!.obligations[0]!.proposedLate.equals(money("500"))).toBe(true);
    expect(result.rmd.obligations[0]!.deadlineShortfall.equals(money("700"))).toBe(true);
    const early = { ...annual(2027), rule: { ...annual(2027).rule!, earliestSatisfaction: date("2027-04-01") } };
    const ew = withdrawal("one", "500", [rmdObligationId(early)]);
    denied(fixture([ew], [early], [allocation(ew, early)]), "window");
  });

  it("rejects tampered approvals, wrong identities, account/year/household and stale sources", () => {
    const a = allocation();
    for (const change of [{ personId: "worker" }, { householdId: "other" }, { sourceAccountId: "other" }, { taxYear: 2025 },
      { rmdObligationId: "other" }, { ruleSnapshotId: "changed" }, { authorizationId: "other" }, { withdrawalId: "other" }, { effectiveAt: date("2027-03-02") }]) {
      denied(fixture(undefined, undefined, [approve({ ...a, ...change })]));
    }
    denied(fixture(undefined, undefined, [{ ...a, amount: money("499") }]), "authorization");
    for (const source of [{ ...a.approval!.source, householdId: "other" }, { ...a.approval!.source, personId: "other" },
      { ...a.approval!.source, projectionStatus: "unavailable" as const }, { ...a.approval!.source, endExclusive: at },
      { ...a.approval!.source, publishedAt: date("2027-03-02") }, { ...a.approval!.source, resourceId: "other" }]) {
      denied(fixture(undefined, undefined, [{ ...a, approval: { ...a.approval!, source } }]), "source");
    }
    for (const rmdSource of [{ ...a.approval!.rmdSource, status: "projected" as const }, { ...a.approval!.rmdSource, accountId: "other" }]) {
      denied(fixture(undefined, undefined, [{ ...a, approval: { ...a.approval!, rmdSource } }]), "source");
    }
  });

  it("rejects duplicate/reused identities and aggregate over-allocation atomically", () => {
    const a = allocation(), value = fixture();
    denied(fixture(undefined, undefined, [a, a]), "duplicate");
    denied({ ...value, usage: { ...value.usage, allocationIds: [a.allocationId] } }, "duplicate");
    denied({ ...value, usage: { ...value.usage, approvalIds: [a.approval!.id] } }, "duplicate");
    denied({ ...value, usage: { ...value.usage, approvalIds: [withdrawal().authorization!.id] } }, "duplicate");
    denied({ ...value, usage: { ...value.usage, status: "unknown" } }, "source");
    denied(fixture(undefined, undefined, [approve({ ...a, amount: money("500.01") })]), "capacity");
    const w = withdrawal("two", "300");
    const over = fixture([withdrawal(), w], [annual()], [a, allocation(w, annual(), "300", "b")]);
    denied(over, "capacity");
    expect(evaluateWithdrawalRmd({ ...over, allocations: [...over.allocations].reverse() })).toEqual(evaluateWithdrawalRmd(over));
    denied(fixture([withdrawal(), withdrawal()]));
    const large = [withdrawal("one", "600"), withdrawal("two", "600")];
    denied(fixture(large, [annual()], large.map((w, i) => allocation(w, annual(), "300", `large:${i}`))), "source_evaluation");
  });

  it("requires exact positive USD cents and retains gross caps despite withholding", () => {
    const a = allocation();
    for (const amount of [money("0"), money("-1"), money("0.001"), money("500", Currency.of("EUR"))]) {
      denied(fixture(undefined, undefined, [approve({ ...a, amount })]), "invalid");
    }
    const w = withdrawal(), taxed = { ...w, withholding: { ...w.withholding!, instructions: w.withholding!.instructions.map(i => ({ ...i, amount: money("50") })) } };
    const result = evaluateWithdrawalRmd(fixture([taxed]));
    expect(result.bundle!.withdrawals[0]!.netAmount.equals(money("450"))).toBe(true);
    expect(result.bundle!.obligations[0]!.proposedOnTime.equals(money("500"))).toBe(true);
    const cents = withdrawal("one", "500.01"), c = evaluateWithdrawalRmd(fixture([cents], [annual()], [allocation(cents, annual(), "500.01")]));
    expect(c.bundle!.obligations[0]!.remainingRequested.equals(money("199.99"))).toBe(true);
  });

  it("recomputes owner gates for missing withholding, authorization, law, balances and liquidity", () => {
    const value = fixture(), w = withdrawal(), r = annual(), ca = cash();
    const { authorization: _auth, ...noAuth } = w, { withholding: _wh, ...noWh } = w;
    for (const request of [noAuth, noWh, { ...w, personId: "worker" }, { ...w, bank: { ...w.bank, householdId: "other" } },
      { ...w, withholding: { ...w.withholding!, completeness: "unknown" as const } },
      { ...w, kind: "rollover" as const }, { ...w, kind: "conversion" as const }, { ...w, kind: "inherited" as const }]) denied(fixture([request]));
    const { liquidity: _liquidity, ...noCash } = ca;
    for (const account of [noCash, { ...ca, beneficiaryId: "inherited" }, { ...ca, instrumentFamily: "roth_ira" as const },
      { ...ca, ownerId: "other" }, { ...ca, householdId: "other" },
      { ...ca, liquidity: { ...ca.liquidity!, available: money("499") } }, { ...ca, liquidity: { ...ca.liquidity!, contention: "unknown" as const } }]) {
      denied({ ...value, withdrawals: { ...value.withdrawals, cash: [account] } });
    }
    const { rule: _rule, ...noRule } = r, { priorValue: _prior, ...noPrior } = r.accounts[0]!;
    for (const request of [noRule, { ...r, accounts: [noPrior] }, { ...r, beneficiary: { ...r.beneficiary, status: "inherited" as const } },
      { ...r, rule: { ...r.rule!, source: { ...r.rule!.source, status: "projected" as const } } }]) denied({ ...value, rmd: { ...value.rmd, requests: [request] } });
  });

  it("blocks even a forged posted_funded history without consuming satisfaction", () => {
    const value = fixture(), a = allocation();
    denied({ ...value, rmd: { ...value.rmd, distributions: [{ transactionId: "forged", personId: "person", payerOwnerId: "person", accountId: "ira", at,
      gross: money("500"), kind: "ordinary", funding: "posted_funded", authorized: true, usageRegister: "verified_complete", source: rs("forged", "ira"),
      allocations: [{ id: "fake", obligationId: a.rmdObligationId, satisfiesRmdYear: 2026, amount: money("500"), historical: true }] }] } }, "history");
  });

  it("admits separately sourced workplace cash while rejecting a changed account family", () => {
    const base = annual(), a = base.accounts[0]!;
    const r: RmdRequest = { ...base, accounts: [{ ...a, family: "workplace_plan",
      planTerms: { rmdMethod: "owner_balance_divisor", ruleSnapshotId: base.rule!.snapshotId, source: rs("plan-terms", "ira") } }],
      rule: { ...base.rule!, family: "workplace_plan" } };
    const w = withdrawal("one", "500", [rmdObligationId(r)]), value = fixture([w], [r], [allocation(w, r)]);
    const c: WithdrawalCash = { ...cash(), instrumentFamily: "workplace_plan",
      planTerms: { planId: "plan", permission: "ordinary_cash_distribution", source: ws("plan") } };
    expect(evaluateWithdrawalRmd({ ...value, withdrawals: { ...value.withdrawals, cash: [c] } }).bundle).not.toBeNull();
    denied(value, "identity");
    for (const family of ["sep_ira", "simple_ira"] as const) {
      const ira: RmdRequest = { ...base, accounts: [{ ...a, family }], rule: { ...base.rule!, family } };
      const iv = fixture([withdrawal()], [ira], [allocation(withdrawal(), ira)]);
      expect(evaluateWithdrawalRmd({ ...iv, withdrawals: { ...iv.withdrawals, cash: [{ ...cash(), instrumentFamily: family }] } }).bundle).not.toBeNull();
    }
  });

  it("rejects absent source provenance and late-known RMD evidence or changed source identities", () => {
    const value = fixture(), a = allocation();
    denied(fixture(undefined, undefined, [{ ...a, approval: { ...a.approval!, source: { ...a.approval!.source, sourcePublication: "" } } }]), "source");
    const late = date("2027-03-02"), r = annual();
    denied({ ...value, rmd: { ...value.rmd, knownAt: late, asOf: late, requests: [{ ...r,
      rule: { ...r.rule!, source: { ...r.rule!.source, asOf: late, publishedAt: late } } }] } }, "source");
    const w = withdrawal("two", "200"), changed = { ...w, bank: { ...w.bank, source: { ...w.bank.source, version: "changed" } } };
    denied(fixture([withdrawal(), changed], [annual()], [a, allocation(changed, annual(), "200", "b")]), "source");
    denied({ ...value, withdrawals: { ...value.withdrawals, cash: [{ ...cash(), eligibilitySource: { ...cash().eligibilitySource, projectionStatus: "explicit_projected" } }] } });
  });

  it("returns typed incomplete for missing source records and malformed owner money", () => {
    const value = fixture(), a = allocation();
    const { source: _source, ...missing } = a.approval!;
    denied(fixture(undefined, undefined, [{ ...a, approval: missing as NonNullable<AllocationInstruction["approval"]> }]), "source");
    denied(fixture([{ ...withdrawal(), grossAmount: null as unknown as AllocationTerms["amount"] }]), "invalid");
    denied({ ...value, allocations: [approve({ ...a, amount: "500" as unknown as AllocationTerms["amount"] })] }, "invalid");
    denied(fixture(undefined, undefined, [approve({ ...a, effectiveAt: "2027-02-30" as AllocationTerms["effectiveAt"] })]), "invalid");
  });

  it("replays reversed raw inputs and returns an independent deeply immutable clone", () => {
    const years = [annual(), annual(2027)], targets = years.map(rmdObligationId), one = withdrawal("one", "500", targets), two = withdrawal("two", "200", targets);
    const value = fixture([one, two], years, [allocation(one), allocation(two, years[1]!, "200", "b")]);
    const before = JSON.stringify(value), result = evaluateWithdrawalRmd(value);
    expect(result.bundle).not.toBeNull();
    expect(evaluateWithdrawalRmd(value)).toEqual(result);
    expect(evaluateWithdrawalRmd({ ...value, withdrawals: { ...value.withdrawals, requests: [two, one] },
      rmd: { ...value.rmd, requests: [...years].reverse() }, allocations: [...value.allocations].reverse() })).toEqual(result);
    expect(JSON.stringify(value)).toBe(before); expect(Object.isFrozen(value.allocations[0]!.approval!.terms)).toBe(false);
    expect(result.bundle!.requalification).not.toBe(value);
    expect(result.bundle!.allocations[0]!.approval!.terms).not.toBe(value.allocations[0]!.approval!.terms);
    expect(Object.isFrozen(result.bundle!.allocations[0]!.approval!.terms)).toBe(true);
    expect(Object.isFrozen(result.rmd.obligations[0]!.components[0])).toBe(true);
    expect(() => (result.bundle!.allocations as unknown as unknown[]).push({})).toThrow();
  });
});
