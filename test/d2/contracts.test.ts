import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catalogSchema, type D2Case } from "../fixtures/d2/schema.js";
import { inputContracts } from "../fixtures/d2/inputContracts.js";
import { conditionalCases } from "./verifyEconomicContract.js";
import { verifyCatalog } from "./verifyCatalog.js";

const catalog = catalogSchema.parse(JSON.parse(readFileSync(new URL("../fixtures/d2/catalog.json", import.meta.url), "utf8")));
const one = (item: D2Case) => ({ ...catalog, cases: [item] });
const copy = (id: string) => structuredClone(catalog.cases.find(item => item.id === id)!);

describe("D2 bounded input/role and economic contracts", () => {
  it.each(catalog.cases)("admits authored $family/$variant ($id)", item => {
    expect(verifyCatalog(one(item)).cases[0]).toEqual(item);
    if (!item.expected.effects) expect(item.input.accounts).toEqual([]);
  });

  it("has exactly one required input contract per represented family/variant", () => {
    expect(Object.keys(inputContracts).sort()).toEqual(catalog.cases.map(item => `${item.family}/${item.variant}`).sort());
    expect([...conditionalCases].sort()).toEqual(catalog.cases.filter(item => item.expected.effects).map(item => item.id).sort());
    expect(conditionalCases).toHaveLength(24);
  });

  it.each(catalog.cases)("rejects omitted required fields for $id, including decision-pending cases", original => {
    const contract = inputContracts[`${original.family}/${original.variant}`]!;
    for (const name of contract.amounts) {
      const item = structuredClone(original);
      delete item.input.amounts[name];
      expect(() => verifyCatalog(one(item)), `${item.id}: missing amount ${name}`).toThrow();
    }
    for (const name of contract.terms) {
      const item = structuredClone(original);
      delete item.input.terms[name];
      expect(() => verifyCatalog(one(item)), `${item.id}: missing term ${name}`).toThrow();
    }
    for (const name of contract.roles) {
      const item = structuredClone(original);
      Reflect.deleteProperty(item.input.roles, name);
      expect(() => verifyCatalog(one(item)), `${item.id}: missing role ${name}`).toThrow();
    }
  });

  it.each(catalog.cases)("rejects unknown and mistyped role identities for $id", original => {
    for (const name of ["source", "destination", "plan", "owner", "beneficiary", "employer", "destinationPlan"] as const) {
      if (original.input.roles[name] === undefined) continue;
      const unknown = structuredClone(original);
      unknown.input.roles[name] = "missing";
      expect(() => verifyCatalog(one(unknown))).toThrow();
      const mistyped = structuredClone(original);
      const id = mistyped.input.roles[name];
      const identity = mistyped.input.identities.find(entity => entity.id === id)!;
      identity.kind = identity.kind === "person" ? "account" : "person";
      expect(() => verifyCatalog(one(mistyped))).toThrow();
    }
  });

  it.each(catalog.cases)("rejects contradictory reference terms and account ownership for $id", original => {
    for (const key of ["source", "destination", "owner", "ownership", "plan", "planIdentity", "claimant", "participant", "survivor", "beneficiary", "oldBeneficiary", "newBeneficiary", "destinationOwner", "coveredMember"]) {
      if (original.input.terms[key] === undefined) continue;
      const item = structuredClone(original);
      item.input.terms[key] = "missing";
      expect(() => verifyCatalog(one(item)), `${item.id}: term ${key}`).toThrow();
    }
    const item = structuredClone(original);
    item.input.identities.find(entity => entity.id === item.input.roles.source)!.owner = "missing";
    expect(() => verifyCatalog(one(item))).toThrow();
    const wrongType = structuredClone(original);
    const source = wrongType.input.identities.find(entity => entity.id === wrongType.input.roles.source)!;
    source.accountType = source.accountType === "expense" ? "bank_cash" : "expense";
    expect(() => verifyCatalog(one(wrongType))).toThrow("inconsistent family account type");
  });

  const amountMutations: Record<string, string[]> = {
    ss_retirement: ["quotedGrossCents", "authoredWithholdingCents"],
    ss_spousal: ["quotedGrossCents", "authoredWithholdingCents"],
    ss_survivor: ["quotedGrossCents", "authoredWithholdingCents"],
    pension_quote: ["quotedGrossCents", "authoredWithholdingCents"],
    ira_roth_conversion: ["requestedCents"],
    mega_backdoor_inplan: ["transferCents", "ownedFairValueCents", "previouslyTaxedBasisCents"],
    "529_plan_rollover": ["transferCents"],
    auto_zero_rate: ["principalCents", "cashCents", "quotedScheduledPrincipalCents", "quotedScheduledInterestCents"],
    auto_final_interest: ["principalCents", "cashCents", "quotedScheduledPrincipalCents", "quotedScheduledInterestCents"],
    student_standard: ["principalCents", "cashCents", "quotedScheduledPrincipalCents", "quotedScheduledInterestCents"],
    consumer_extra_payoff: ["extraCents", "principalCents", "cashCents", "quotedScheduledPrincipalCents", "quotedScheduledInterestCents"],
    credit_card_revolve: ["authoredPaymentCents", "statementInterestCents", "openingPrincipalCents"],
    heloc_draw: ["drawCents"], debt_unfunded: ["cashCents", "principalCents", "requiredServiceCents"],
    tips_coupon: ["quotedCouponCents"], ee_redemption_quote: ["purchaseCents", "quotedRedemptionCents"],
    "529_contribution": ["contributionCents"], health_after_tax: ["grossPremiumCents", "employerShareCents", "householdShareCents"],
    medicare_part_a: ["authoredPremiumCents"], medicare_part_b: ["authoredPremiumCents"], medicare_part_d: ["authoredPremiumCents"],
    medicare_advantage: ["authoredPremiumCents"], medicare_medigap: ["authoredPremiumCents"],
  };

  it.each(Object.entries(amountMutations))("rejects changed source amounts with untouched expected postings: %s", (id, fields) => {
    for (const field of fields) {
      const item = copy(id);
      item.input.amounts[field] = (BigInt(item.input.amounts[field]!) + 1n).toString();
      expect(() => verifyCatalog(one(item)), `${id}: ${field}`).toThrow("input economic contract mismatch");
    }
  });

  it.each(conditionalCases.filter(id => !["premium_end_exclusive", "debt_unfunded"].includes(id)))("rejects changed authored posting date: %s", id => {
    const item = copy(id);
    item.input.terms.eventDate = "2026-01-16";
    expect(() => verifyCatalog(one(item))).toThrow("input economic contract mismatch");
  });

  it.each([
    ["ss_retirement", "startDate", "2026-01-16"], ["pension_quote", "commencement", "2026-01-16"],
    ["ee_redemption_quote", "redemptionDate", "2026-01-16"],
    ["health_after_tax", "effectiveEndExclusive", "2026-01-15"],
    ["premium_end_exclusive", "effectiveEndExclusive", "2026-01-02"],
    ["premium_end_exclusive", "candidatePayment", "2026-01-02"],
    ["auto_final_interest", "annualRate", "0.13"], ["auto_zero_rate", "remainingPayments", "3"],
    ["mega_backdoor_inplan", "acceptance", "explicit false"],
  ])("rejects a changed economically relevant term: %s/%s", (id, field, value) => {
    const item = copy(id!);
    item.input.terms[field!] = value!;
    expect(() => verifyCatalog(one(item))).toThrow();
  });

  it("checks empty projections against their actual exclusion/failure conditions", () => {
    const funded = copy("debt_unfunded");
    funded.input.amounts.cashCents = "100000";
    funded.input.accounts[0]!.openingCents = "100000";
    funded.expected.effects!.closingCents.cash = "100000";
    expect(() => verifyCatalog(one(funded))).toThrow("input economic contract mismatch");
    const active = copy("premium_end_exclusive");
    active.input.terms.effectiveEndExclusive = "2026-02-01";
    expect(() => verifyCatalog(one(active))).toThrow("input economic contract mismatch");
  });

  it("rejects aliased transfer roles, unknown account plans and wrong plan families", () => {
    const transfer = copy("529_plan_rollover");
    transfer.input.roles.destination = transfer.input.roles.source;
    expect(() => verifyCatalog(one(transfer))).toThrow();
    const unknown = copy("403b_contribution");
    unknown.input.identities.find(entity => entity.id === unknown.input.roles.destination)!.plan = "missing";
    expect(() => verifyCatalog(one(unknown))).toThrow();
    const wrong = copy("tsp_contribution");
    wrong.input.identities.find(entity => entity.id === wrong.input.roles.plan)!.family = "403b";
    expect(() => verifyCatalog(one(wrong))).toThrow();
    const sponsor = copy("simple_ira_contribution");
    sponsor.input.identities.find(entity => entity.id === sponsor.input.roles.plan)!.sponsor = "missing";
    expect(() => verifyCatalog(one(sponsor))).toThrow();
  });

  it.each(["403b", "governmental_457b", "tsp", "sep_ira", "simple_ira"])("pins ordinary contribution-source character for %s", family => {
    const item = copy(`${family}_contribution`);
    item.input.terms.employeeEmployerCharacter = family === "sep_ira" ? "employee" : "employer";
    expect(() => verifyCatalog(one(item))).toThrow();
    const source = copy(`${family}_contribution`);
    source.input.terms.contributionSource = "inferred_bank_debit";
    expect(() => verifyCatalog(one(source))).toThrow();
    const original = copy(`${family}_contribution`);
    expect(original.expected.effects).toBeUndefined();
    expect(original.input.accounts).toEqual([]);
    if (family !== "tsp") expect(original.expected.boundary).not.toContain("TSP");
  });

  it("accepts an independently restated quote and matching literal effects", () => {
    const item = copy("ss_retirement");
    item.input.amounts.quotedGrossCents = "200000";
    const effects = item.expected.effects!;
    effects.transactions[0]!.legs[0]!.cents = "190000";
    effects.transactions[0]!.legs[2]!.cents = "200000";
    effects.closingCents = { cash: "190000", withholding: "10000", benefit: "200000" };
    effects.cashDeltaCents = "190000";
    effects.netWorthDeltaCents = "200000";
    effects.recognition.incomeCents = "200000";
    effects.facts.grossBenefitCents = "200000";
    expect(verifyCatalog(one(item)).cases[0]).toEqual(item);
  });

  it("keeps unresolved tax inputs and excluded amounts separate from asserted effects", () => {
    const ira = copy("ira_roth_conversion");
    ira.input.amounts.aggregateBasisCents = "30000";
    expect(verifyCatalog(one(ira)).cases[0]!.expected.effects).toEqual(ira.expected.effects);
    const excluded = copy("premium_end_exclusive");
    excluded.input.amounts.authoredPremiumCents = "40000";
    expect(verifyCatalog(one(excluded)).cases[0]!.expected.effects!.transactions).toEqual([]);
  });
});
