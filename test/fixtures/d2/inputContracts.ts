import { z } from "zod";
import { centsSchema, type D2Case } from "./schema.js";

// Authored required input vocabulary, independent of the catalog at test time.
// These describe synthetic scenarios, not statutory support or a public API.
// No balances are invented for symbolic account/plan references.
export const inputContracts: Record<string, {
  amounts: readonly string[];
  terms: readonly string[];
  roles: readonly string[];
  sourceType: string;
  destinationType: string;
}> = {
  "social_security/retirement": { amounts: ["quotedGrossCents","authoredWithholdingCents"], terms: ["estimate","claimant","beneficiary","startDate","frequency","cola","coordination","eventDate"], roles: ["owner","source","destination","beneficiary"], sourceType: "income", destinationType: "bank_cash" },
  "social_security/spousal": { amounts: ["quotedGrossCents","authoredWithholdingCents"], terms: ["estimate","claimant","beneficiary","startDate","frequency","cola","coordination","eventDate"], roles: ["owner","source","destination","beneficiary"], sourceType: "income", destinationType: "bank_cash" },
  "social_security/survivor": { amounts: ["quotedGrossCents","authoredWithholdingCents"], terms: ["estimate","claimant","beneficiary","startDate","frequency","cola","coordination","eventDate"], roles: ["owner","source","destination","beneficiary"], sourceType: "income", destinationType: "bank_cash" },
  "social_security/cola_coordination": { amounts: ["priorQuoteCents"], terms: ["claimDate","colaRule","spousalOwnBenefit"], roles: ["owner","source","destination","beneficiary"], sourceType: "income", destinationType: "bank_cash" },
  "pension/quoted_payment": { amounts: ["quotedGrossCents","authoredWithholdingCents"], terms: ["participant","survivor","commencement","frequency","cola","election","eventDate"], roles: ["owner","source","destination","beneficiary","plan"], sourceType: "income", destinationType: "bank_cash" },
  "pension/survivor_termination": { amounts: ["participantQuoteCents"], terms: ["participantDeath","election","endExclusive"], roles: ["owner","source","destination","beneficiary","plan"], sourceType: "income", destinationType: "bank_cash" },
  "403b/contribution": { amounts: ["authoredContributionCents","grossCompensationCents"], terms: ["employeeEmployerCharacter","planIdentity","taxYear","effectiveRule","source","contributionSource"], roles: ["owner","source","destination","plan","employer"], sourceType: "payroll", destinationType: "403b" },
  "403b/distribution_rollover": { amounts: ["requestedCents"], terms: ["source","destination","owner","acceptance","planIdentity"], roles: ["owner","source","destination","plan","employer"], sourceType: "403b", destinationType: "traditional_ira" },
  "governmental_457b/contribution": { amounts: ["authoredContributionCents","grossCompensationCents"], terms: ["employeeEmployerCharacter","planIdentity","taxYear","effectiveRule","source","contributionSource"], roles: ["owner","source","destination","plan","employer"], sourceType: "payroll", destinationType: "governmental_457b" },
  "governmental_457b/distribution_rollover": { amounts: ["requestedCents"], terms: ["source","destination","owner","acceptance","planIdentity"], roles: ["owner","source","destination","plan","employer"], sourceType: "governmental_457b", destinationType: "traditional_ira" },
  "tsp/contribution": { amounts: ["authoredContributionCents","grossCompensationCents"], terms: ["employeeEmployerCharacter","planIdentity","taxYear","effectiveRule","source","contributionSource"], roles: ["owner","source","destination","plan","employer"], sourceType: "payroll", destinationType: "tsp" },
  "tsp/distribution_rollover": { amounts: ["requestedCents"], terms: ["source","destination","owner","acceptance","planIdentity"], roles: ["owner","source","destination","plan","employer"], sourceType: "tsp", destinationType: "traditional_ira" },
  "sep_ira/contribution": { amounts: ["authoredContributionCents","grossCompensationCents"], terms: ["employeeEmployerCharacter","planIdentity","taxYear","effectiveRule","source","contributionSource"], roles: ["owner","source","destination","plan","employer"], sourceType: "bank_cash", destinationType: "sep_ira" },
  "sep_ira/distribution_rollover": { amounts: ["requestedCents"], terms: ["source","destination","owner","acceptance","planIdentity"], roles: ["owner","source","destination","plan","employer"], sourceType: "sep_ira", destinationType: "traditional_ira" },
  "simple_ira/contribution": { amounts: ["authoredContributionCents","grossCompensationCents"], terms: ["employeeEmployerCharacter","planIdentity","taxYear","effectiveRule","source","contributionSource"], roles: ["owner","source","destination","plan","employer"], sourceType: "payroll", destinationType: "simple_ira" },
  "simple_ira/distribution_rollover": { amounts: ["requestedCents"], terms: ["source","destination","owner","acceptance","planIdentity"], roles: ["owner","source","destination","plan","employer"], sourceType: "simple_ira", destinationType: "traditional_ira" },
  "roth_paths/ira_conversion": { amounts: ["requestedCents","aggregateIraValueCents","aggregateBasisCents"], terms: ["source","destination","ownership","contributionCharacter","eventDate"], roles: ["owner","source","destination"], sourceType: "traditional_ira", destinationType: "roth_ira" },
  "roth_paths/backdoor": { amounts: ["nondeductibleContributionCents","traditionalIraCents","sepIraCents","simpleIraCents","openingBasisCents"], terms: ["steps","aggregation","contributionEligibility"], roles: ["owner","source","destination"], sourceType: "traditional_ira", destinationType: "roth_ira" },
  "roth_paths/mega_inplan": { amounts: ["transferCents","ownedFairValueCents","previouslyTaxedBasisCents"], terms: ["plan","acceptance","newContribution","annualAdditions","eventDate"], roles: ["owner","source","destination","plan"], sourceType: "after_tax_401k", destinationType: "roth_401k" },
  "roth_paths/mega_rollover": { amounts: ["afterTaxContributionCents"], terms: ["source","destination","acceptance","basis"], roles: ["owner","source","destination","plan"], sourceType: "after_tax_401k", destinationType: "roth_ira" },
  "retirement_distributions/ordinary": { amounts: ["requestedCents","openingRetirementCents"], terms: ["existingIssue","source","destination","withholding","distributionKind"], roles: ["owner","source","destination"], sourceType: "retirement_account", destinationType: "bank_cash" },
  "retirement_distributions/rmd": { amounts: ["requestedCents","openingRetirementCents"], terms: ["existingIssue","source","destination","withholding","distributionKind"], roles: ["owner","source","destination"], sourceType: "retirement_account", destinationType: "bank_cash" },
  "auto_loan/scheduled_payment": { amounts: ["principalCents","cashCents","quotedScheduledPrincipalCents","quotedScheduledInterestCents"], terms: ["annualRate","rateConvention","remainingPayments","frequency","capitalization","funding","rounding","eventDate"], roles: ["owner","source","destination"], sourceType: "bank_cash", destinationType: "auto_loan" },
  "auto_loan/final_payment": { amounts: ["principalCents","cashCents","quotedScheduledPrincipalCents","quotedScheduledInterestCents"], terms: ["annualRate","rateConvention","remainingPayments","capitalization","funding","rounding","eventDate"], roles: ["owner","source","destination"], sourceType: "bank_cash", destinationType: "auto_loan" },
  "student_loan/scheduled_payment": { amounts: ["principalCents","cashCents","quotedScheduledPrincipalCents","quotedScheduledInterestCents"], terms: ["annualRate","rateConvention","remainingPayments","frequency","capitalization","funding","specialPrograms","eventDate"], roles: ["owner","source","destination"], sourceType: "bank_cash", destinationType: "student_loan" },
  "auto_loan/extra_payoff": { amounts: ["principalCents","cashCents","extraCents","quotedScheduledPrincipalCents","quotedScheduledInterestCents"], terms: ["annualRate","rateConvention","remainingPayments","funding","capitalization","eventDate"], roles: ["owner","source","destination"], sourceType: "bank_cash", destinationType: "auto_loan" },
  "credit_card/statement_payment": { amounts: ["openingPrincipalCents","statementInterestCents","authoredPaymentCents"], terms: ["interest","allocation","minimumPayment","funding","eventDate"], roles: ["owner","source","destination"], sourceType: "bank_cash", destinationType: "credit_card" },
  "heloc/draw": { amounts: ["drawCents"], terms: ["draw","destination","rateType","reset","eventDate"], roles: ["owner","source","destination"], sourceType: "heloc", destinationType: "bank_cash" },
  "heloc/variable_reset": { amounts: ["openingPrincipalCents"], terms: ["resetDate","index","spread","capsFloors","paymentReset"], roles: ["owner","source","destination"], sourceType: "bank_cash", destinationType: "heloc" },
  "auto_loan/unfunded_required": { amounts: ["cashCents","principalCents","requiredServiceCents","requestedExtraCents"], terms: ["annualRate","remainingPayments","funding","eventDate"], roles: ["owner","source","destination"], sourceType: "bank_cash", destinationType: "auto_loan" },
  "tips/inflation_accretion": { amounts: ["originalPrincipalCents"], terms: ["indexBase","deflationFloor","taxCharacter"], roles: ["owner","source","destination"], sourceType: "tips", destinationType: "wrapper_cash" },
  "tips/quoted_coupon": { amounts: ["quotedAdjustedPrincipalCents","quotedCouponCents"], terms: ["coupon","settlement","eventDate"], roles: ["owner","source","destination"], sourceType: "tips", destinationType: "wrapper_cash" },
  "tips/maturity": { amounts: ["originalPrincipalCents"], terms: ["maturity","adjustedPrincipal","floor"], roles: ["owner","source","destination"], sourceType: "tips", destinationType: "wrapper_cash" },
  "series_ee/redemption": { amounts: ["purchaseCents","quotedRedemptionCents"], terms: ["issueDate","purchaseDate","redemptionDate","valuation","elections","eventDate"], roles: ["owner","source","destination"], sourceType: "series_ee", destinationType: "bank_cash" },
  "series_ee/accrual_maturity": { amounts: ["purchaseCents"], terms: ["issueDate","accrualRule","redemptionRestrictions"], roles: ["owner","source","destination"], sourceType: "series_ee", destinationType: "bank_cash" },
  "education_529/contribution": { amounts: ["contributionCents"], terms: ["owner","beneficiary","funding","valuation","jurisdiction","eventDate"], roles: ["owner","source","destination","beneficiary","plan"], sourceType: "bank_cash", destinationType: "education_529" },
  "education_529/qualified_distribution": { amounts: ["requestedCents","balanceCents","contributedBasisCents"], terms: ["owner","beneficiary","distributionCharacter","expenseEvidence","settlement"], roles: ["owner","source","destination","beneficiary","plan"], sourceType: "education_529", destinationType: "bank_cash" },
  "education_529/nonqualified_distribution": { amounts: ["requestedCents","balanceCents","contributedBasisCents"], terms: ["owner","beneficiary","distributionCharacter","expenseEvidence","settlement"], roles: ["owner","source","destination","beneficiary","plan"], sourceType: "education_529", destinationType: "bank_cash" },
  "education_529/plan_rollover": { amounts: ["transferCents"], terms: ["owner","beneficiary","eligibility","jurisdictions","valuation","eventDate"], roles: ["owner","source","destination","beneficiary","plan","destinationPlan"], sourceType: "education_529", destinationType: "education_529" },
  "education_529/beneficiary_change": { amounts: ["balanceCents"], terms: ["oldBeneficiary","newBeneficiary","relationship","owner"], roles: ["owner","source","destination","beneficiary","plan","previousBeneficiary"], sourceType: "education_529", destinationType: "education_529" },
  "education_529/roth_rollover": { amounts: ["requestedCents","priorLifetimeRolloversCents","currentIraUsageCents"], terms: ["accountOpened","beneficiary","destinationOwner","holdingEvidence","statutoryRule"], roles: ["owner","source","destination","beneficiary","plan"], sourceType: "education_529", destinationType: "roth_ira" },
  "health_insurance/after_tax_premium": { amounts: ["grossPremiumCents","employerShareCents","householdShareCents"], terms: ["coveredMembers","effectiveStart","effectiveEndExclusive","frequency","funding","eventDate"], roles: ["owner","source","destination","plan","coveredMembers"], sourceType: "bank_cash", destinationType: "expense" },
  "health_insurance/pretax_employer_share": { amounts: ["grossPremiumCents","employerShareCents","employeeShareCents","grossWagesCents"], terms: ["coveredMembers","funding","effectiveStart","effectiveEndExclusive","frequency"], roles: ["owner","source","destination","plan","coveredMembers","employer"], sourceType: "payroll", destinationType: "expense" },
  "medicare/part_a": { amounts: ["authoredPremiumCents"], terms: ["electedPart","coveredMember","eligibility","schedule","funding","eventDate"], roles: ["owner","source","destination","plan","coveredMembers"], sourceType: "bank_cash", destinationType: "expense" },
  "medicare/part_b": { amounts: ["authoredPremiumCents"], terms: ["electedPart","coveredMember","eligibility","schedule","funding","eventDate"], roles: ["owner","source","destination","plan","coveredMembers"], sourceType: "bank_cash", destinationType: "expense" },
  "medicare/part_d": { amounts: ["authoredPremiumCents"], terms: ["electedPart","coveredMember","eligibility","schedule","funding","eventDate"], roles: ["owner","source","destination","plan","coveredMembers"], sourceType: "bank_cash", destinationType: "expense" },
  "medicare/advantage": { amounts: ["authoredPremiumCents"], terms: ["electedPart","coveredMember","eligibility","schedule","funding","eventDate"], roles: ["owner","source","destination","plan","coveredMembers"], sourceType: "bank_cash", destinationType: "expense" },
  "medicare/medigap": { amounts: ["authoredPremiumCents"], terms: ["electedPart","coveredMember","eligibility","schedule","funding","eventDate"], roles: ["owner","source","destination","plan","coveredMembers"], sourceType: "bank_cash", destinationType: "expense" },
  "medicare/irmaa": { amounts: ["authoredBasePremiumCents"], terms: ["incomeReference","lookback","filingStatus","surchargeRule"], roles: ["owner","source","destination","plan","coveredMembers"], sourceType: "bank_cash", destinationType: "expense" },
  "health_fsa/payroll_contribution": { amounts: ["annualElectionCents","payrollContributionCents","requestedReimbursementCents"], terms: ["planYearStart","planYearEndExclusive","owner","availableBalance","settlement","yearEndTerms"], roles: ["owner","source","destination","plan","employer"], sourceType: "payroll", destinationType: "bank_cash" },
  "health_fsa/reimbursement": { amounts: ["annualElectionCents","payrollContributionCents","requestedReimbursementCents"], terms: ["planYearStart","planYearEndExclusive","owner","availableBalance","settlement","yearEndTerms"], roles: ["owner","source","destination","plan","employer"], sourceType: "payroll", destinationType: "bank_cash" },
  "health_fsa/carryover": { amounts: ["annualElectionCents","payrollContributionCents","requestedReimbursementCents"], terms: ["planYearStart","planYearEndExclusive","owner","availableBalance","settlement","yearEndTerms"], roles: ["owner","source","destination","plan","employer"], sourceType: "payroll", destinationType: "bank_cash" },
  "health_fsa/grace_period": { amounts: ["annualElectionCents","payrollContributionCents","requestedReimbursementCents"], terms: ["planYearStart","planYearEndExclusive","owner","availableBalance","settlement","yearEndTerms"], roles: ["owner","source","destination","plan","employer"], sourceType: "payroll", destinationType: "bank_cash" },
  "health_fsa/forfeiture": { amounts: ["annualElectionCents","payrollContributionCents","requestedReimbursementCents"], terms: ["planYearStart","planYearEndExclusive","owner","availableBalance","settlement","yearEndTerms"], roles: ["owner","source","destination","plan","employer"], sourceType: "payroll", destinationType: "bank_cash" },
  "health_insurance/end_boundary": { amounts: ["authoredPremiumCents"], terms: ["effectiveStart","effectiveEndExclusive","candidatePayment","frequency","funding","eventDate"], roles: ["owner","source","destination","plan","coveredMembers"], sourceType: "bank_cash", destinationType: "expense" },
};

const dateTerms = new Set(["startDate", "claimDate", "commencement", "participantDeath", "endExclusive", "resetDate", "maturity", "issueDate", "purchaseDate", "redemptionDate", "accountOpened", "effectiveStart", "effectiveEndExclusive", "candidatePayment", "planYearStart", "planYearEndExclusive", "eventDate"]);
const referenceRoles: Record<string, string> = {
  source: "source", destination: "destination", owner: "owner", ownership: "owner",
  claimant: "owner", participant: "owner", survivor: "beneficiary",
  beneficiary: "beneficiary", oldBeneficiary: "previousBeneficiary",
  newBeneficiary: "beneficiary", destinationOwner: "beneficiary",
  coveredMember: "owner", plan: "plan", planIdentity: "plan",
};
const roleKinds: Record<string, string> = {
  owner: "person", beneficiary: "person", previousBeneficiary: "person",
  source: "account", destination: "account", plan: "plan",
  destinationPlan: "plan", employer: "employer",
};

export function verifyFamilyInput(item: D2Case) {
  const contract = inputContracts[`${item.family}/${item.variant}`];
  if (!contract) throw new Error("unknown family/variant");
  const amounts = z.object(Object.fromEntries(contract.amounts.map(name => [name, centsSchema.refine(value => BigInt(value) >= 0n)]))).strict();
  amounts.parse(item.input.amounts);
  for (const name of contract.terms) {
    const value = item.input.terms[name];
    (dateTerms.has(name) ? z.iso.date() : z.string().min(1)).parse(value);
  }
  for (const name of Object.keys(item.input.terms)) {
    if (!contract.terms.includes(name) && !name.endsWith("Description")) throw new Error("unknown family term");
  }
  const ids = new Map(item.input.identities.map(entity => [entity.id, entity]));
  const roles = item.input.roles as Record<string, string | string[] | undefined>;
  for (const name of contract.roles) if (roles[name] === undefined) throw new Error("missing family role");
  for (const name of Object.keys(roles)) if (!contract.roles.includes(name)) throw new Error("unexpected family role");
  for (const [name, id] of Object.entries(roles)) {
    if (name === "coveredMembers") {
      const members = id as string[];
      if (new Set(members).size !== members.length || members.some(member => ids.get(member)?.kind !== "person")) throw new Error("invalid covered members");
    } else if (typeof id !== "string" || ids.get(id)?.kind !== roleKinds[name]) throw new Error("unknown or mistyped role identity");
  }
  for (const entity of ids.values()) {
    if (entity.kind === "account" || entity.kind === "plan") {
      const owner = entity.owner && ids.get(entity.owner);
      if (!owner || !["person", "employer"].includes(owner.kind)) throw new Error("unknown identity owner");
    } else if (entity.owner !== undefined || entity.plan !== undefined) throw new Error("invalid person/employer ownership");
    if (entity.kind !== "plan" && entity.family !== undefined) throw new Error("family belongs to plan identity");
    if (entity.kind === "account" ? entity.accountType === undefined : entity.accountType !== undefined) throw new Error("inconsistent account type declaration");
    if (entity.sponsor !== undefined && (entity.kind !== "plan" || ids.get(entity.sponsor)?.kind !== "employer")) throw new Error("invalid plan sponsor");
    if (entity.plan !== undefined && ids.get(entity.plan)?.kind !== "plan") throw new Error("unknown account plan");
  }
  for (const account of item.input.accounts) {
    const identity = ids.get(account.id);
    if (identity?.kind !== "account" || identity.owner !== account.owner) throw new Error("inconsistent account role owner");
  }
  for (const [name, role] of Object.entries(referenceRoles)) {
    if (item.input.terms[name] !== undefined && item.input.terms[name] !== roles[role]) throw new Error("inconsistent term role reference");
  }
  if (item.input.terms.coveredMembers !== undefined && item.input.terms.coveredMembers !== item.input.roles.coveredMembers?.join(", ")) throw new Error("inconsistent covered members");
  const { owner, source, destination, plan, destinationPlan, beneficiary } = item.input.roles;
  const sourceEntity = ids.get(source)!;
  const destinationEntity = ids.get(destination)!;
  if (sourceEntity.accountType !== contract.sourceType || destinationEntity.accountType !== contract.destinationType) throw new Error("inconsistent family account type");
  const employerSource = item.family === "sep_ira" && item.variant === "contribution";
  if (sourceEntity.owner !== (employerSource ? item.input.roles.employer : owner)) throw new Error("inconsistent source owner");
  if (destinationEntity.owner !== (item.id === "529_roth_rollover" ? beneficiary : owner)) throw new Error("inconsistent destination owner");
  const planFamily = item.family === "roth_paths" ? "401k" : item.family;
  if (plan && (ids.get(plan)?.owner !== owner || ids.get(plan)?.family !== planFamily || ids.get(plan)?.sponsor !== item.input.roles.employer)) throw new Error("inconsistent plan family/owner/sponsor");
  const sourcePlan = item.family === "pension" || item.family === "education_529" && item.variant !== "contribution" || item.family === "roth_paths" && item.variant.startsWith("mega") || item.variant === "distribution_rollover";
  const targetPlan = item.family === "education_529" && ["contribution", "plan_rollover", "beneficiary_change"].includes(item.variant) || item.variant === "mega_inplan" || item.variant === "contribution" && ["403b", "governmental_457b", "tsp", "sep_ira", "simple_ira"].includes(item.family);
  if (sourceEntity.plan !== (sourcePlan ? plan : undefined)) throw new Error("inconsistent source plan");
  if (destinationEntity.plan !== (targetPlan ? destinationPlan ?? plan : undefined)) throw new Error("inconsistent destination plan");
  if (destinationPlan && ids.get(destinationPlan)?.family !== item.family) throw new Error("inconsistent destination plan family");
  if (destinationPlan && (destinationPlan === plan || ids.get(destinationPlan)?.owner !== owner)) throw new Error("inconsistent rollover plan");
  if (item.variant !== "beneficiary_change" && source === destination) throw new Error("source and destination must differ");
  if (item.variant === "beneficiary_change" && item.input.roles.previousBeneficiary === beneficiary) throw new Error("beneficiaries must differ");
  if (item.input.terms.electedPart !== undefined && item.input.terms.electedPart !== item.variant) throw new Error("inconsistent elected part");
  if (item.input.terms.coveredMember !== undefined && !item.input.roles.coveredMembers?.includes(item.input.terms.coveredMember)) throw new Error("covered member absent from coverage");
  if (item.input.terms.distributionKind !== undefined && item.input.terms.distributionKind !== item.variant) throw new Error("inconsistent distribution kind");
  if (item.input.terms.distributionCharacter !== undefined && item.input.terms.distributionCharacter !== item.variant.replace("_distribution", "")) throw new Error("inconsistent distribution character");
  if (item.input.terms.taxYear !== undefined) z.string().regex(/^[0-9]{4}$/).parse(item.input.terms.taxYear);
  if (item.input.terms.remainingPayments !== undefined) z.string().regex(/^[1-9][0-9]*$/).parse(item.input.terms.remainingPayments);
  if (item.input.terms.annualRate !== undefined) z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/).parse(item.input.terms.annualRate);
  if (item.variant === "contribution" && ["403b", "governmental_457b", "tsp", "sep_ira", "simple_ira"].includes(item.family)) {
    const character = item.family === "sep_ira" ? "employer" : "employee";
    const sourceCharacter = item.family === "sep_ira" ? "employer_contribution" : "employee_salary_deferral";
    if (item.input.terms.employeeEmployerCharacter !== character || item.input.terms.contributionSource !== sourceCharacter) throw new Error("inconsistent contribution source character");
  }
}
