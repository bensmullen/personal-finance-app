import type { D2Case } from "../fixtures/d2/schema.js";

// Test-only accounting assertions for the 24 authored conditional projections.
// This deliberately does not calculate statutory benefits, limits or tax law,
// amortize a loan, select funding, or execute a household operation.
export const conditionalCases = [
  "ss_retirement", "ss_spousal", "ss_survivor", "pension_quote",
  "ira_roth_conversion", "mega_backdoor_inplan", "529_plan_rollover",
  "auto_zero_rate", "auto_final_interest", "student_standard", "consumer_extra_payoff",
  "credit_card_revolve", "heloc_draw", "debt_unfunded", "tips_coupon",
  "ee_redemption_quote", "529_contribution", "health_after_tax",
  "medicare_part_a", "medicare_part_b", "medicare_part_d", "medicare_advantage",
  "medicare_medigap", "premium_end_exclusive",
] as const;

export function verifyEconomicContract(item: D2Case) {
  const effects = item.expected.effects;
  const conditional = (conditionalCases as readonly string[]).includes(item.id);
  if (conditional !== Boolean(effects)) throw new Error("conditional effect coverage mismatch");
  if (!effects) return;
  const { amounts, terms, roles, accounts } = item.input;
  const amount = (name: string) => {
    if (amounts[name] === undefined) throw new Error(`missing economic amount ${name}`);
    return BigInt(amounts[name]);
  };
  const check = (condition: boolean) => { if (!condition) throw new Error("input economic contract mismatch"); };
  const opening = (id: string, value: bigint) => check(accounts.find(account => account.id === id)?.openingCents === value.toString());
  const fact = (name: string, value: bigint | string) => check(effects.facts[name] === value.toString());
  type Transaction = NonNullable<D2Case["expected"]["effects"]>["transactions"][number];
  const transactions: Transaction[] = [];
  const leg = (account: string, side: "debit" | "credit", cents: bigint) => ({ account, side, cents: cents.toString() });
  const post = (id: string, legs: Transaction["legs"]) => transactions.push({ id, date: terms.eventDate!, legs: legs.filter(entry => entry.cents !== "0") });
  check(terms.eventDate! >= item.period.start && terms.eventDate! < item.period.endExclusive);

  switch (item.id) {
    case "ss_retirement": case "ss_spousal": case "ss_survivor": case "pension_quote": {
      const gross = amount("quotedGrossCents"), withheld = amount("authoredWithholdingCents");
      check(gross >= withheld);
      check(terms[item.id === "pension_quote" ? "commencement" : "startDate"] === terms.eventDate);
      check(terms.frequency === "monthly");
      post("quoted_payment", [leg(roles.destination, "debit", gross - withheld), leg("withholding", "debit", withheld), leg(roles.source, "credit", gross)]);
      fact("grossBenefitCents", gross); fact("withholdingCents", withheld);
      break;
    }
    case "ira_roth_conversion": case "mega_backdoor_inplan": case "529_plan_rollover": {
      const transfer = amount(item.id === "ira_roth_conversion" ? "requestedCents" : "transferCents");
      post("owned_transfer", [leg(roles.source, "credit", transfer), leg(roles.destination, "debit", transfer)]);
      fact("transferCents", transfer);
      if (item.id === "mega_backdoor_inplan") {
        // Executable semantics §21: this exact single-holding, at-par example
        // has exact integer basis allocation; no new rounding rule is supplied.
        const fairValue = amount("ownedFairValueCents"), basis = amount("previouslyTaxedBasisCents");
        opening(roles.source, fairValue);
        check(fairValue > 0n && basis <= fairValue && transfer <= fairValue);
        check((transfer * basis) % fairValue === 0n);
        const recovered = transfer * basis / fairValue;
        fact("recoveredBasisCents", recovered); fact("remainingSourceBasisCents", basis - recovered);
        fact("destinationBasisCents", transfer); fact("taxableConversionCents", transfer - recovered);
        fact("contributionUsageDeltaCents", 0n); fact("withholdingCents", 0n);
        check(terms.acceptance === "explicit true" && terms.newContribution === "none in this conversion case");
      }
      // IRA aggregation values intentionally do not imply a taxable amount.
      break;
    }
    case "auto_zero_rate": case "auto_final_interest": case "student_standard": case "consumer_extra_payoff": {
      // Pin the existing P22 examples rather than duplicate amortization.
      // The explicit service quote must match these particular scenario facts.
      const final = item.id === "auto_final_interest";
      check(amount("principalCents") === 100000n && terms.annualRate === (final ? "0.12" : "0") && terms.remainingPayments === (final ? "1" : "2"));
      check(terms.capitalization === "none");
      if (terms.frequency !== undefined) check(terms.frequency === "monthly");
      if (terms.rounding !== undefined) check(terms.rounding === "USD cents half_up");
      check(terms.rateConvention === (final ? "nominal annual / 12; simple contractual month" : "nominal annual / 12"));
      const principal = amount("quotedScheduledPrincipalCents"), interest = amount("quotedScheduledInterestCents");
      check(principal === (final ? 100000n : 50000n) && interest === (final ? 1000n : 0n));
      opening(roles.source, amount("cashCents")); opening(roles.destination, amount("principalCents"));
      check(terms.funding === (item.id === "consumer_extra_payoff" ? "required service before voluntary extra; all-or-nothing" : "cash, all-or-nothing"));
      post(final ? "payoff" : "service", [leg(roles.source, "credit", principal + interest), leg(roles.destination, "debit", principal), leg("interest", "debit", interest)]);
      let totalPrincipal = principal;
      if (item.id === "consumer_extra_payoff") {
        const extra = amount("extraCents");
        check(extra <= amount("principalCents") - principal);
        post("extra", [leg(roles.source, "credit", extra), leg(roles.destination, "debit", extra)]);
        totalPrincipal += extra;
      }
      fact("principalPaidCents", totalPrincipal); fact("interestPaidCents", interest);
      if (effects.facts.remainingPrincipalCents !== undefined) fact("remainingPrincipalCents", amount("principalCents") - totalPrincipal);
      break;
    }
    case "credit_card_revolve": {
      const payment = amount("authoredPaymentCents"), interest = amount("statementInterestCents");
      check(payment >= interest && payment - interest <= amount("openingPrincipalCents"));
      opening(roles.destination, amount("openingPrincipalCents"));
      check(terms.allocation === "contract quote: pay stated interest first" && terms.funding === "cash");
      post("card_service", [leg(roles.source, "credit", payment), leg(roles.destination, "debit", payment - interest), leg("interest", "debit", interest)]);
      fact("principalPaidCents", payment - interest); fact("interestPaidCents", interest);
      break;
    }
    case "heloc_draw": {
      const draw = amount("drawCents");
      check(terms.draw === "explicit authorized draw, not invented funding");
      post("draw", [leg(roles.destination, "debit", draw), leg(roles.source, "credit", draw)]);
      fact("newDrawCents", draw);
      break;
    }
    case "debt_unfunded": {
      opening(roles.source, amount("cashCents")); opening(roles.destination, amount("principalCents"));
      check(amount("cashCents") < amount("requiredServiceCents") && amount("requestedExtraCents") > 0n);
      // Exact zero-rate, two-payment P22 example. Do not generalize this quote.
      check(terms.annualRate === "0" && terms.remainingPayments === "2" && amount("principalCents") === 2n * amount("requiredServiceCents"));
      check(terms.funding === "all-or-nothing; required before extra; no borrowing fallback");
      fact("fundingOutcome", "required_unfunded"); fact("extraOutcome", "ineligible"); fact("committedMutation", "none");
      break;
    }
    case "tips_coupon": {
      const coupon = amount("quotedCouponCents");
      // Adjusted principal is a separate quote, NOT a coupon formula input.
      check(amount("quotedAdjustedPrincipalCents") > 0n);
      check(terms.settlement === "wrapper cash; no implicit transfer to checking");
      post("coupon", [leg(roles.destination, "debit", coupon), leg("income", "credit", coupon)]);
      fact("couponCents", coupon); fact("destination", "wrapper_cash");
      break;
    }
    case "ee_redemption_quote": {
      const purchase = amount("purchaseCents"), redemption = amount("quotedRedemptionCents");
      check(terms.valuation === "explicit quote; carrying value remains purchase cost in this accounting-only scenario");
      check(redemption >= purchase && terms.issueDate! <= terms.purchaseDate! && terms.purchaseDate! <= terms.redemptionDate! && terms.redemptionDate === terms.eventDate);
      opening(roles.source, purchase);
      post("redemption", [leg(roles.destination, "debit", redemption), leg(roles.source, "credit", purchase), leg("income", "credit", redemption - purchase)]);
      fact("grossInterestCents", redemption - purchase);
      break;
    }
    case "529_contribution": {
      const contribution = amount("contributionCents");
      check(terms.valuation === "purchase at par; no fees/growth" && terms.funding === "owned cash");
      post("contribution", [leg(roles.source, "credit", contribution), leg(roles.destination, "debit", contribution)]);
      fact("contributionCents", contribution); fact("contributedBasisCents", contribution);
      break;
    }
    case "health_after_tax": case "medicare_part_a": case "medicare_part_b": case "medicare_part_d": case "medicare_advantage": case "medicare_medigap": {
      const health = item.id === "health_after_tax";
      const premium = amount(health ? "householdShareCents" : "authoredPremiumCents");
      if (health) {
        check(amount("grossPremiumCents") === amount("employerShareCents") + premium);
        check(amount("employerShareCents") === 0n);
        check(terms.effectiveStart! <= terms.eventDate! && terms.eventDate! < terms.effectiveEndExclusive!);
        check(terms.funding === "owned cash after tax");
      } else {
        check(terms.schedule === `authored quote on ${terms.eventDate}`);
        check(terms.funding === "owned cash, separate from benefit withholding in this case");
      }
      post("premium_payment", [leg(roles.source, "credit", premium), leg(roles.destination, "debit", premium)]);
      fact("premiumCents", premium); fact("fundingCharacter", "after_tax");
      break;
    }
    case "premium_end_exclusive": {
      check(terms.effectiveStart! < terms.effectiveEndExclusive! && terms.candidatePayment === terms.eventDate && terms.candidatePayment! >= terms.effectiveEndExclusive!);
      check(amount("authoredPremiumCents") > 0n);
      fact("scheduledInsideCoverage", "false");
      break;
    }
    default: throw new Error("missing conditional economic assertion");
  }
  // Match operation identity, authored date, economic account, side and amount;
  // inventory ordering is not economic precedence. Transaction order is kept.
  const normalize = (values: Transaction[]) => values.map(transaction => ({ ...transaction, legs: [...transaction.legs].sort((a, b) => {
    const left = `${a.account}/${a.side}`, right = `${b.account}/${b.side}`;
    return left < right ? -1 : left > right ? 1 : 0;
  }) }));
  check(JSON.stringify(normalize(transactions)) === JSON.stringify(normalize(effects.transactions)));
}
