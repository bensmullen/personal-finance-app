import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  evaluateIraConversionYear, type IraAccount, type IraConversionRequest,
  type IraDistribution, type IraSource, type IraYearInput,
} from "../../../../src/simulation/d2/retirement/conversions/index.js";
import { civilDate } from "../../../../src/time/index.js";
import { Currency, money, Money, USD } from "../../../../src/values/index.js";
import { catalogSchema } from "../../../fixtures/d2/schema.js";

const date = civilDate;
const source = (id: string, accountId: string | null = null, personId = "person", taxYear = 2026): IraSource => ({
  sourceId: id, sourcePublication: "Synthetic Form-8606 convention, NOT an IRS law snapshot", personId, accountId,
  taxYear, asOf: date("2027-01-02"), ruleSnapshotId: "synthetic:8606:2026:v1", verification: "verified", projectionStatus: "observed",
});
const account = (id: string, family: IraAccount["family"], value: string, personId = "person"): IraAccount => ({
  accountId: id, ownerId: personId, family, source: source(`identity:${id}`, id, personId),
  ...(family !== "roth_ira" && family !== "workplace_plan" ? {
    december31Value: { amount: money(value), at: date("2026-12-31"), source: source(`value:${id}`, id, personId) },
  } : {}),
});
const request = (id: string, src = "traditional", gross = "100", personId = "person"): IraConversionRequest => ({
  operationId: id, transactionId: `tx:${id}`, personId, sourceAccountId: src, destinationAccountId: "roth",
  effectiveAt: date("2026-02-01"), gross: money(gross), kind: "ira_roth_conversion", source: source(`conversion:${id}`, src, personId),
  authorization: { permitted: "yes", effectivePeriod: { start: date("2026-01-01"), endExclusive: date("2027-01-01") }, source: source(`permission:${id}`, src, personId) },
});
const distribution = (r: IraConversionRequest): IraDistribution => ({
  operationId: r.operationId, transactionId: r.transactionId, sourceAccountId: r.sourceAccountId, effectiveAt: r.effectiveAt,
  gross: r.gross, kind: "ira_roth_conversion", source: source(`distribution:${r.operationId}`, r.sourceAccountId, r.personId),
});
const fixture = (personId = "person"): IraYearInput => {
  const r = request("convert", "traditional", "100", personId);
  return {
    personId, taxYear: 2026, currency: USD, asOf: date("2027-01-03"), knownAt: date("2027-01-03"), filingStatus: "synthetic_single", stateJurisdiction: "synthetic_state",
    rules: { source: source("rule", null, personId), jurisdiction: "US:synthetic", version: "synthetic-v1", ruleFamily: "form_8606",
      effectivePeriod: { start: date("2026-01-01"), endExclusive: date("2027-01-01") }, filingStatus: "synthetic_single",
      model: "aggregate_basis_over_year_end_plus_distributions", ratio: "exact_capped_at_one", annualRounding: "half_even", allocation: "largest_remainder_operation_id" },
    accounts: [account("traditional", "traditional_ira", "900", personId), account("roth", "roth_ira", "0", personId)],
    requests: [r], distributions: [distribution(r)],
    openingBasis: { amount: money("200"), priorTaxYear: 2025, returnStatus: "verified_return", source: source("prior_return", null, personId, 2025) },
    basisAdditions: [], closeout: { source: source("closeout", null, personId), eligibleAccountIds: ["traditional"],
      distributionOperationIds: ["convert"], basisAdditionOperationIds: [], inventory: "complete", distributions: "complete", basisAdditions: "complete",
      legalBasisModel: "supported_without_special_adjustments", outstandingRollovers: "none", otherAdjustments: "none" },
  };
};
const denial = (input: IraYearInput, code: string): void => {
  const before = JSON.stringify(input);
  const result = evaluateIraConversionYear(input);
  expect(result.yearStatus).toBe("incomplete");
  expect(result.proposals).toEqual([]); expect(result.basisProposals).toEqual([]);
  expect(result.diagnostics[0]!.diagnosticCode).toBe(code);
  expect(result.diagnostics[0]!.sourceEntityPath.length).toBeGreaterThan(0);
  expect(result.accountYearCoverage.every(c => c.iraCharacter === "incomplete" && c.federalTax === "incomplete" && c.funding === "incomplete")).toBe(true);
  expect(JSON.stringify(input)).toBe(before);
};
const withRequests = (f: IraYearInput, rs: readonly IraConversionRequest[]): IraYearInput => ({ ...f, requests: rs,
  distributions: rs.map(distribution), closeout: { ...f.closeout!, distributionOperationIds: rs.map(r => r.operationId) } });

describe("source-qualified person/tax-year IRA pro-rata proposals (isolated A3-1)", () => {
  it("uses the explicit synthetic 20,000 / (90,000 + 10,000) cents annual rule", () => {
    const input = fixture(), before = JSON.stringify(input), result = evaluateIraConversionYear(input);
    expect(result.diagnostics).toEqual([]); expect(result.yearStatus).toBe("FINAL");
    const p = result.proposals[0]!, b = result.basisProposals[0]!;
    expect(p.basisRecovered.equals(money("20"))).toBe(true);
    expect(p.taxable.equals(money("80"))).toBe(true);
    expect(p.taxable.plus(p.basisRecovered).equals(p.gross)).toBe(true);
    expect(b.annualDistributions.equals(money("100"))).toBe(true); // not 200: request references register
    expect(b.denominator.equals(money("1000"))).toBe(true);
    expect(b.carryForwardBasis.equals(money("180"))).toBe(true);
    expect(p).toMatchObject({ committed: false, postable: false, incomeCharacter: "ira_roth_conversion", seam: "S3/S6" });
    expect(b).toMatchObject({ committed: false, postable: false, seam: "S5" });
    expect(p.traceRefs).toEqual(expect.arrayContaining(["rule", "prior_return", "value:traditional", "closeout", "permission:convert"]));
    expect(result.accountYearCoverage.every(c => c.federalTax === "incomplete" && c.stateTax === "incomplete" && c.postings === "not_applicable")).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
    expect(evaluateIraConversionYear(input)).toEqual(result);
  });

  it("aggregates Traditional, SEP and SIMPLE, splitting partial conversions by deterministic remainder", () => {
    let f = fixture();
    f = { ...f, openingBasis: { ...f.openingBasis!, amount: money("0.01") },
      accounts: [account("traditional", "traditional_ira", "0"), account("sep", "sep_ira", "0.01"), account("simple", "simple_ira", "0"), account("roth", "roth_ira", "0")],
      closeout: { ...f.closeout!, eligibleAccountIds: ["traditional", "sep", "simple"] } };
    f = withRequests(f, [request("b", "simple", "0.01"), request("a", "traditional", "0.01")]);
    const result = evaluateIraConversionYear(f);
    expect(result.diagnostics).toEqual([]);
    expect(result.basisProposals[0]!.denominator.equals(money("0.03"))).toBe(true);
    expect(result.proposals.map(p => [p.operationId, p.basisRecovered.amount.toString()])).toEqual([["a", "0.01"], ["b", "0"]]);
    expect(result.basisProposals[0]!.carryForwardBasis.isZero()).toBe(true);
    const reversed = { ...f, accounts: [...f.accounts].reverse(), requests: [...f.requests].reverse(), distributions: [...f.distributions].reverse(),
      closeout: { ...f.closeout!, eligibleAccountIds: [...f.closeout!.eligibleAccountIds].reverse(), distributionOperationIds: [...f.closeout!.distributionOperationIds].reverse() } };
    expect(evaluateIraConversionYear(reversed)).toEqual(result);
  });

  it("includes SEP/SIMPLE year-end balances even when neither account converts", () => {
    const f = fixture();
    const result = evaluateIraConversionYear({ ...f,
      accounts: [...f.accounts, account("sep", "sep_ira", "500"), account("simple", "simple_ira", "500")],
      closeout: { ...f.closeout!, eligibleAccountIds: ["traditional", "sep", "simple"] } });
    expect(result.proposals[0]!.basisRecovered.equals(money("10"))).toBe(true);
    expect(result.basisProposals[0]!.december31Value.equals(money("1900"))).toBe(true);
  });

  it("keeps two persons independent and requires explicit zero-basis prior-return evidence", () => {
    const a = fixture("alice"), b = fixture("bob");
    const rb = evaluateIraConversionYear({ ...b, openingBasis: { ...b.openingBasis!, amount: money("0"), returnStatus: "verified_no_prior_basis" } });
    expect(rb.proposals[0]!.taxable.equals(money("100"))).toBe(true);
    expect(rb.proposals[0]!.basisRecovered.isZero()).toBe(true);
    expect(rb.proposals[0]!.personId).toBe("bob");
    expect(evaluateIraConversionYear(a).proposals[0]!.basisRecovered.equals(money("20"))).toBe(true);
    const { openingBasis: _opening, ...missing } = a;
    denial(missing, "MISSING_PRIOR_RETURN_BASIS");
    denial({ ...a, openingBasis: { ...a.openingBasis!, returnStatus: "unknown" } }, "UNQUALIFIED_PRIOR_RETURN_BASIS");
  });

  it("recovers basis across ALL annual distributions, keeping RMD out of conversion", () => {
    const f = fixture();
    const ordinary: IraDistribution = { ...f.distributions[0]!, operationId: "ordinary", transactionId: "tx:ordinary", kind: "ordinary_distribution" };
    const rmd: IraDistribution = { ...ordinary, operationId: "rmd", transactionId: "tx:rmd", kind: "rmd", gross: money("50") };
    const result = evaluateIraConversionYear({ ...f, distributions: [...f.distributions, ordinary, rmd],
      closeout: { ...f.closeout!, distributionOperationIds: ["convert", "ordinary", "rmd"] } });
    expect(result.diagnostics).toEqual([]);
    const b = result.basisProposals[0]!;
    expect(b.annualDistributions.equals(money("250"))).toBe(true);
    expect(b.annualBasisRecovered.equals(money("43.48"))).toBe(true);
    expect(b.allocations.reduce((s, a) => s.plus(a.basisRecovered), Money.zero(USD)).equals(b.annualBasisRecovered)).toBe(true);
    expect(b.carryForwardBasis.equals(money("156.52"))).toBe(true);
    expect(result.proposals).toHaveLength(1);
    denial({ ...f, requests: [{ ...f.requests[0]!, kind: "rmd" }] }, "RMD_NOT_CONVERTIBLE");
  });

  it("adds qualified nondeductible basis once without reserving regular IRA capacity", () => {
    const f = fixture();
    const addition: IraYearInput["basisAdditions"][number] = { operationId: "add", transactionId: "tx:add", accountId: "traditional",
      effectiveAt: date("2026-04-01"), kind: "qualified_nondeductible_regular_contribution", amount: money("100"), source: source("addition", "traditional") };
    const input = { ...f, basisAdditions: [addition], closeout: { ...f.closeout!, basisAdditionOperationIds: ["add"] } };
    const result = evaluateIraConversionYear(input);
    expect(result.basisProposals[0]!.availableBasis.equals(money("300"))).toBe(true);
    expect(result.proposals[0]!.basisRecovered.equals(money("30"))).toBe(true);
    expect(result.basisProposals[0]!.carryForwardBasis.equals(money("270"))).toBe(true);
    denial({ ...input, basisAdditions: [addition, { ...addition, operationId: "renamed" }] }, "DUPLICATE_OR_MISSING_ANNUAL_OPERATION");
  });

  it("accepts deeply frozen inputs and is invariant to basis-addition/register ordering", () => {
    const f = fixture();
    const additions: IraYearInput["basisAdditions"] = ["a", "b"].map(id => ({ operationId: `basis:${id}`, transactionId: `basis-tx:${id}`,
      accountId: "traditional", effectiveAt: date("2026-03-01"), kind: "qualified_nondeductible_regular_contribution", amount: money("0.01"),
      source: source(`basis-source:${id}`, "traditional") }));
    const input = { ...f, basisAdditions: additions, closeout: { ...f.closeout!, basisAdditionOperationIds: additions.map(a => a.operationId) } };
    const freeze = (value: unknown): void => {
      if (typeof value !== "object" || value === null) return;
      Object.values(value).forEach(freeze); Object.freeze(value);
    };
    freeze(input);
    const before = JSON.stringify(input), result = evaluateIraConversionYear(input);
    expect(result.diagnostics).toEqual([]);
    expect(evaluateIraConversionYear({ ...input, basisAdditions: [...additions].reverse(),
      closeout: { ...input.closeout, basisAdditionOperationIds: [...input.closeout.basisAdditionOperationIds].reverse() } })).toEqual(result);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("never finalizes an earlier conversion from current-year forecasts", () => {
    const f = fixture(), { closeout: _close, ...forecast } = f;
    denial(forecast, "MISSING_TAX_YEAR_CLOSEOUT");
    const early = source("early");
    denial({ ...f, closeout: { ...f.closeout!, source: { ...early, asOf: date("2026-12-31") } } }, "TAX_YEAR_NOT_CLOSED");
    denial({ ...f, closeout: { ...f.closeout!, inventory: "unknown" } }, "INCOMPLETE_YEAR_INVENTORY_OR_ACTIVITY");
    denial({ ...f, closeout: { ...f.closeout!, distributions: "unknown" } }, "INCOMPLETE_YEAR_INVENTORY_OR_ACTIVITY");
    expect(evaluateIraConversionYear(f).yearStatus).toBe("FINAL");
    const { rules: _rules, ...noLaw } = f;
    denial({ ...noLaw, taxYear: 2028 }, "MISSING_EFFECTIVE_FORM_8606_RULE");
  });

  it("rejects missing SEP/SIMPLE inventory and absent valuations instead of assuming zero", () => {
    const f = fixture();
    denial({ ...f, closeout: { ...f.closeout!, eligibleAccountIds: ["traditional", "missing_sep", "missing_simple"] } }, "INCOMPLETE_OR_CONFLICTING_CLOSEOUT_REGISTER");
    denial({ ...f, accounts: [...f.accounts, account("simple", "simple_ira", "50")] }, "INCOMPLETE_OR_CONFLICTING_CLOSEOUT_REGISTER");
    const { december31Value: _v, ...withoutValue } = f.accounts[0]!;
    denial({ ...f, accounts: [withoutValue, f.accounts[1]!] }, "MISSING_DECEMBER31_VALUE");
    denial({ ...f, accounts: [{ ...f.accounts[0]!, december31Value: { ...f.accounts[0]!.december31Value!, at: date("2026-11-30") } }, f.accounts[1]!] }, "STALE_OR_WRONG_YEAR_END_VALUE");
  });

  it("bounds unsupported rollovers, adjustments and unproven basis models", () => {
    const f = fixture();
    for (const outstandingRollovers of ["present", "unknown"] as const)
      denial({ ...f, closeout: { ...f.closeout!, outstandingRollovers } }, "UNSUPPORTED_OR_UNKNOWN_YEAR_END_ROLLOVERS");
    denial({ ...f, closeout: { ...f.closeout!, otherAdjustments: "present" } }, "UNSUPPORTED_OR_UNKNOWN_BASIS_ADJUSTMENTS");
    denial({ ...f, closeout: { ...f.closeout!, legalBasisModel: "unknown" } }, "UNPROVEN_LEGAL_BASIS_MODEL");
    denial({ ...f, rules: { ...f.rules!, model: "unsupported" } }, "UNSUPPORTED_FORM_8606_CONVENTION");
    denial({ ...f, distributions: [{ ...f.distributions[0]!, kind: "direct_rollover" }], requests: [] }, "UNSUPPORTED_DISTRIBUTION_CLASS");
    const result = evaluateIraConversionYear({ ...f, closeout: { ...f.closeout!, outstandingRollovers: "present" } });
    expect(result.diagnostics[0]).toMatchObject({ sourceEntityPath: "closeout.outstandingRollovers", ruleSnapshotId: "synthetic:8606:2026:v1" });
    expect(result.diagnostics[0]!.traceRefs).toContain("closeout");
  });

  it("returns incomplete for a zero denominator conflict and preserves basis in idle years", () => {
    const f = fixture();
    const idle = withRequests(f, []);
    denial({ ...idle, accounts: [account("traditional", "traditional_ira", "0"), f.accounts[1]!] }, "ZERO_DENOMINATOR_UNPROVEN_MODEL");
    const result = evaluateIraConversionYear(idle);
    expect(result.yearStatus).toBe("FINAL");
    expect(result.basisProposals[0]!.annualBasisRecovered.isZero()).toBe(true);
    expect(result.basisProposals[0]!.carryForwardBasis.equals(money("200"))).toBe(true);
  });

  it("keeps large cents exact and caps annual recovery at available basis and gross", () => {
    const f = fixture();
    const large = money("900719925474099312345.67");
    const r = { ...f.requests[0]!, gross: large };
    const result = evaluateIraConversionYear({ ...withRequests(f, [r]),
      accounts: [account("traditional", "traditional_ira", "0"), f.accounts[1]!], openingBasis: { ...f.openingBasis!, amount: large } });
    expect(result.proposals[0]!.basisRecovered.equals(large)).toBe(true);
    expect(result.proposals[0]!.taxable.isZero()).toBe(true);
    expect(result.basisProposals[0]!.carryForwardBasis.isZero()).toBe(true);
    const over = evaluateIraConversionYear({ ...f, openingBasis: { ...f.openingBasis!, amount: money("2000") } });
    expect(over.proposals[0]!.basisRecovered.equals(money("100"))).toBe(true);
    expect(over.basisProposals[0]!.carryForwardBasis.equals(money("1900"))).toBe(true);
  });

  it("uses supplied annual rounding before deterministic allocation", () => {
    const f = fixture();
    const tiny = { ...withRequests(f, [request("a", "traditional", "0.01")]),
      accounts: [account("traditional", "traditional_ira", "0.01"), f.accounts[1]!], openingBasis: { ...f.openingBasis!, amount: money("0.01") } };
    expect(evaluateIraConversionYear(tiny).proposals[0]!.basisRecovered.isZero()).toBe(true);
    expect(evaluateIraConversionYear({ ...tiny, rules: { ...tiny.rules!, annualRounding: "half_up" } }).proposals[0]!.basisRecovered.equals(money("0.01"))).toBe(true);
  });

  it("gates owner, source/destination and authorization errors with no partial proposals", () => {
    const f = fixture();
    denial({ ...f, accounts: [f.accounts[0]!, { ...f.accounts[1]!, ownerId: "spouse" }] }, "ACCOUNT_OWNER_MISMATCH");
    denial({ ...f, requests: [{ ...f.requests[0]!, personId: "spouse" }] }, "REQUEST_OWNER_MISMATCH");
    denial({ ...f, requests: [{ ...f.requests[0]!, destinationAccountId: "traditional" }] }, "IMPROPER_CONVERSION_ACCOUNTS");
    denial({ ...f, accounts: [{ ...f.accounts[0]!, family: "workplace_plan" }, f.accounts[1]!] }, "IMPROPER_CONVERSION_ACCOUNTS");
    denial({ ...f, requests: [{ ...f.requests[0]!, authorization: { ...f.requests[0]!.authorization, permitted: "unknown" } }] }, "CONVERSION_AUTHORIZATION_MISSING_OR_DENIED");
    denial({ ...f, requests: [{ ...f.requests[0]!, authorization: { ...f.requests[0]!.authorization,
      effectivePeriod: { start: date("2026-01-01"), endExclusive: f.requests[0]!.effectiveAt } } }] }, "OUTSIDE_CONVERSION_AUTHORIZATION_PERIOD");
    for (const kind of ["regular_ira_contribution", "direct_rollover", "mega_backdoor"] as const)
      denial({ ...f, requests: [{ ...f.requests[0]!, kind }] }, "NOT_AN_IRA_CONVERSION");
    const second = { ...request("second"), authorization: { ...request("second").authorization, permitted: "no" as const } };
    denial(withRequests(f, [f.requests[0]!, second]), "CONVERSION_AUTHORIZATION_MISSING_OR_DENIED");
  });

  it("denies duplicate IDs, transaction aliases and request/register mismatches", () => {
    const f = fixture(), r = f.requests[0]!;
    denial({ ...f, requests: [r, r] }, "DUPLICATE_OR_MISSING_REQUEST");
    denial({ ...f, requests: [r, { ...r, operationId: "alias" }] }, "DUPLICATE_OR_MISSING_REQUEST");
    denial({ ...f, accounts: [...f.accounts, f.accounts[0]!] }, "DUPLICATE_ACCOUNT");
    denial({ ...f, distributions: [...f.distributions, { ...f.distributions[0]!, operationId: "alias" }] }, "DUPLICATE_OR_MISSING_ANNUAL_OPERATION");
    denial({ ...f, requests: [{ ...r, gross: money("99") }] }, "CONVERSION_REGISTER_MISMATCH");
    denial({ ...f, closeout: { ...f.closeout!, distributionOperationIds: [] } }, "INCOMPLETE_OR_CONFLICTING_CLOSEOUT_REGISTER");
    denial({ ...f, requests: [] }, "MISSING_CONVERSION_REQUEST");
  });

  it("gates mixed, stale, projected and uncovered law or fact sources", () => {
    const f = fixture(), r = f.requests[0]!;
    denial({ ...f, requests: [{ ...r, source: { ...r.source, ruleSnapshotId: "stale" } }] }, "MIXED_RULE_SNAPSHOT");
    denial({ ...f, requests: [{ ...r, source: { ...r.source, personId: "other" } }] }, "SOURCE_SCOPE_MISMATCH");
    denial({ ...f, requests: [{ ...r, source: { ...r.source, asOf: date("2026-01-01") } }] }, "OBSERVATION_PRECEDES_OPERATION");
    denial({ ...f, rules: { ...f.rules!, source: { ...f.rules!.source, projectionStatus: "explicit_projected" } } }, "UNVERIFIED_PROJECTED_OR_FUTURE_SOURCE");
    denial({ ...f, rules: { ...f.rules!, source: { ...f.rules!.source, asOf: date("2027-02-01") } } }, "UNVERIFIED_PROJECTED_OR_FUTURE_SOURCE");
    denial({ ...f, rules: { ...f.rules!, effectivePeriod: { ...f.rules!.effectivePeriod, endExclusive: date("2026-12-31") } } }, "UNCOVERED_RULE_PERIOD");
    denial({ ...f, filingStatus: "different" }, "MISSING_OR_MISMATCHED_FILING_CONTEXT");
    denial({ ...f, requests: [{ ...r, effectiveAt: date("2027-01-01") }] }, "OUTSIDE_TAX_YEAR");
    denial({ ...f, requests: [{ ...r, gross: money("1", Currency.of("EUR")) }] }, "CURRENCY_MISMATCH");
    denial({ ...f, requests: [{ ...r, gross: money("0.001") }] }, "INVALID_EXACT_MONEY");
  });

  it("reads conditional prep fixtures without claiming their current-year final tax basis", () => {
    const catalog = catalogSchema.parse(JSON.parse(readFileSync(new URL("../../../fixtures/d2/catalog.json", import.meta.url), "utf8")));
    for (const id of ["ira_roth_conversion", "mega_backdoor_roth_rollover"]) {
      const prep = catalog.cases.find(c => c.id === id)!, before = JSON.stringify(prep);
      expect(prep.expected.capability).toBe("decision_required");
      expect(prep.expected.integratedRuntimeEvidence).toBe(false);
      const f = fixture(), { closeout: _close, ...unqualified } = f;
      const r = { ...request(id, "traditional", "500"), kind: id === "ira_roth_conversion" ? "ira_roth_conversion" as const : "mega_backdoor" as const };
      const withoutCloseout = { ...unqualified, requests: [r], distributions: [distribution(r)] };
      denial(withoutCloseout, id === "ira_roth_conversion" ? "MISSING_TAX_YEAR_CLOSEOUT" : "NOT_AN_IRA_CONVERSION");
      if (id === "ira_roth_conversion") expect(prep.input.amounts.requestedCents).toBe("50000");
      expect(JSON.stringify(prep)).toBe(before);
    }
  });
});
