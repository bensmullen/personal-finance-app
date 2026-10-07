import type { FilingStatus } from "./tax/contracts.js";
import { Money, money, decimal, RoundingPolicy, USD } from "../values/index.js";

/** Published effective-dated parameters, never account-specific UI constants. */
export const D1_CONTRIBUTION_LAW_2026 = Object.freeze({
  version: "2026.1", effectiveFrom: "2026-01-01", effectiveUntil: "2027-01-01",
  elective401k: "24500", catchup401k: "8000", higherCatchup401k: "11250", additions401k: "72000", rothCatchupWageThreshold: "150000",
  ira: "7500", iraCatchup: "1100", hsaSelf: "4400", hsaFamily: "8750", hsaCatchup: "1000",
  rothPhaseout: Object.freeze({ joint: Object.freeze(["242000", "252000"]), single: Object.freeze(["153000", "168000"]), separateWithSpouse: Object.freeze(["0", "10000"]) }),
  deductionPhaseout: Object.freeze({ jointCovered: Object.freeze(["129000", "149000"]), singleCovered: Object.freeze(["81000", "91000"]), separateCovered: Object.freeze(["0", "10000"]), jointSpouseCovered: Object.freeze(["242000", "252000"]) }),
  sources: Object.freeze(["https://www.irs.gov/irb/2025-49_IRB", "https://www.irs.gov/publications/p590a", "https://www.irs.gov/irb/2025-21_IRB", "https://www.irs.gov/publications/p969"]),
});

export interface D1ContributionFacts {
  /** Explicit user assumption for supplied annual facts, separate from projected law. */
  readonly annualFactProjection?: "confirmed_nominal_carry_forward";
  readonly lawProjection?: "projected_current_law";
  readonly taxYear: number;
  readonly ageAtYearEnd?: number;
  readonly taxableCompensation?: Money;
  readonly eligiblePlanCompensation?: Money;
  readonly filingStatus?: FilingStatus;
  readonly rothMagi?: Money;
  readonly deductionMagi?: Money;
  readonly livesWithSpouse?: boolean;
  readonly workplacePlanCovered?: boolean;
  readonly spouseWorkplacePlanCovered?: boolean;
  readonly priorYearSponsorWages?: Money;
  readonly planHasRoth?: boolean;
  readonly hsaFullYearEligible?: boolean;
  readonly hsaCoverage?: "self" | "family";
  /** Explicit ordinary family allocation for this individual; excludes individual catch-up. */
  readonly hsaFamilyAllocation?: Money;
}
export type D1CapacityKind = "401k_elective" | "401k_additions" | "ira_shared" | "roth_ira" | "traditional_ira_deduction" | "hsa_individual" | "hsa_family";
export type ContributionCharacter = "traditional_ira" | "roth_ira" | "traditional_401k" | "roth_401k" | "after_tax_401k" | "employee_hsa" | "employer_401k" | "employer_hsa";
export const contributionCharacters = (kind: D1CapacityKind): readonly ContributionCharacter[] => kind === "ira_shared" ? ["traditional_ira", "roth_ira"] : kind === "roth_ira" ? ["roth_ira"] : kind === "401k_elective" ? ["traditional_401k", "roth_401k"] : kind === "401k_additions" ? ["traditional_401k", "roth_401k", "after_tax_401k", "employer_401k"] : ["employee_hsa", "employer_hsa"];
export type D1Capacity =
  | { readonly status: "incomplete"; readonly kind: D1CapacityKind; readonly diagnostics: readonly string[] }
  | { readonly status: "complete"; readonly kind: D1CapacityKind; readonly capacity: Money; readonly ordinaryCapacity: Money; readonly catchupCapacity: Money; readonly rothCatchupRequired?: boolean; readonly lawVersion: string; readonly facts: D1ContributionFacts };
const min = (a: Money, b: Money): Money => a.compare(b) < 0 ? a : b;
const zero = () => Money.zero(USD);
const amount = (value: string) => money(value, USD);
const validMoney = (value: Money | undefined): value is Money => value instanceof Money && value.currency.equals(USD) && !value.isNegative();

/** Worksheet arithmetic is exact until the required upward rounding to $10. */
const phaseout = (base: Money, magi: Money, bounds: readonly string[]): Money => {
  const lower = amount(bounds[0]!), upper = amount(bounds[1]!);
  if (magi.compare(upper) >= 0) return zero();
  if (magi.compare(lower) <= 0) return base;
  const numerator = base.amount.times(upper.minus(magi).amount);
  const denominator = upper.minus(lower).amount.times(decimal("10"));
  const reduced = new Money(numerator.dividedBy(denominator, new RoundingPolicy(0, "ceiling")).times(decimal("10")), USD);
  return min(base, reduced.isPositive() && reduced.compare(amount("200")) < 0 ? amount("200") : reduced);
};

export const deriveD1ContributionCapacity = (kind: D1CapacityKind, facts: D1ContributionFacts, sharedIraUsed = zero()): D1Capacity => {
  const incomplete = (...diagnostics: string[]): D1Capacity => Object.freeze({ status: "incomplete", kind, diagnostics: Object.freeze(diagnostics) });
  if (facts.taxYear !== 2026 && !(facts.taxYear > 2026 && facts.lawProjection === "projected_current_law")) return incomplete("CONTRIBUTION_LAW_YEAR_UNAVAILABLE");
  if (kind !== "401k_additions" && kind !== "hsa_family" && (!Number.isSafeInteger(facts.ageAtYearEnd) || facts.ageAtYearEnd! < 0)) return incomplete("CONTRIBUTION_AGE_REQUIRED");
  for (const value of [facts.taxableCompensation, facts.eligiblePlanCompensation, facts.rothMagi, facts.deductionMagi, facts.priorYearSponsorWages, facts.hsaFamilyAllocation])
    if (value !== undefined && !validMoney(value)) return incomplete("CONTRIBUTION_FACT_MONEY_INVALID");
  if (!validMoney(sharedIraUsed)) return incomplete("IRA_USAGE_INVALID");
  const age = facts.ageAtYearEnd!;
  const complete = (ordinaryCapacity: Money, catchupCapacity = zero(), rothCatchupRequired?: boolean): D1Capacity => Object.freeze({ status: "complete", kind, capacity: ordinaryCapacity.plus(catchupCapacity), ordinaryCapacity, catchupCapacity,
    ...(rothCatchupRequired === undefined ? {} : { rothCatchupRequired }), lawVersion: facts.taxYear === 2026 ? D1_CONTRIBUTION_LAW_2026.version : `${D1_CONTRIBUTION_LAW_2026.version}:projected_current_law:nominal-v1`, facts: Object.freeze({ ...facts }) });
  if (kind === "401k_additions") {
    if (!validMoney(facts.eligiblePlanCompensation)) return incomplete("PLAN_COMPENSATION_REQUIRED");
    return complete(min(amount(D1_CONTRIBUTION_LAW_2026.additions401k), facts.eligiblePlanCompensation));
  }
  if (kind === "401k_elective") {
    const catchup = age < 50 ? zero() : amount(age >= 60 && age <= 63 ? D1_CONTRIBUTION_LAW_2026.higherCatchup401k : D1_CONTRIBUTION_LAW_2026.catchup401k);
    if (catchup.isPositive() && (facts.planHasRoth === undefined || facts.planHasRoth && !validMoney(facts.priorYearSponsorWages))) return incomplete("ROTH_CATCHUP_PLAN_AND_PRIOR_WAGES_REQUIRED");
    return complete(amount(D1_CONTRIBUTION_LAW_2026.elective401k), catchup, catchup.isPositive() && facts.planHasRoth === true && facts.priorYearSponsorWages!.compare(amount(D1_CONTRIBUTION_LAW_2026.rothCatchupWageThreshold)) > 0);
  }
  if (kind.startsWith("hsa_")) {
    if (facts.hsaFullYearEligible !== true || facts.hsaCoverage === undefined) return incomplete("HSA_FULL_YEAR_ELIGIBILITY_AND_COVERAGE_REQUIRED");
    if (kind === "hsa_family") {
      if (facts.hsaCoverage !== "family") return incomplete("HSA_FAMILY_COVERAGE_REQUIRED");
      return complete(amount(D1_CONTRIBUTION_LAW_2026.hsaFamily));
    }
    const ordinary = facts.hsaCoverage === "self" ? amount(D1_CONTRIBUTION_LAW_2026.hsaSelf) : facts.hsaFamilyAllocation;
    if (!validMoney(ordinary)) return incomplete("HSA_FAMILY_ALLOCATION_REQUIRED");
    if (facts.hsaCoverage === "family" && ordinary.compare(amount(D1_CONTRIBUTION_LAW_2026.hsaFamily)) > 0) return incomplete("HSA_FAMILY_ALLOCATION_EXCESS");
    return complete(ordinary, age >= 55 ? amount(D1_CONTRIBUTION_LAW_2026.hsaCatchup) : zero());
  }
  if (!validMoney(facts.taxableCompensation)) return incomplete("IRA_TAXABLE_COMPENSATION_REQUIRED");
  const iraMaximum = min(amount(D1_CONTRIBUTION_LAW_2026.ira).plus(age >= 50 ? amount(D1_CONTRIBUTION_LAW_2026.iraCatchup) : zero()), facts.taxableCompensation);
  if (kind === "ira_shared") {
    const ordinary = min(amount(D1_CONTRIBUTION_LAW_2026.ira), facts.taxableCompensation);
    return complete(ordinary, iraMaximum.minus(ordinary));
  }
  if (facts.filingStatus === undefined) return incomplete("IRA_FILING_STATUS_REQUIRED");
  if (kind === "roth_ira") {
    if (!validMoney(facts.rothMagi)) return incomplete("ROTH_MAGI_REQUIRED");
    if (facts.filingStatus === "married_separate" && facts.livesWithSpouse === undefined) return incomplete("IRA_SPOUSE_RESIDENCE_REQUIRED");
    const bounds = ["married_joint", "qualifying_surviving_spouse"].includes(facts.filingStatus) ? D1_CONTRIBUTION_LAW_2026.rothPhaseout.joint
      : facts.filingStatus === "married_separate" && facts.livesWithSpouse ? D1_CONTRIBUTION_LAW_2026.rothPhaseout.separateWithSpouse : D1_CONTRIBUTION_LAW_2026.rothPhaseout.single;
    const remaining = sharedIraUsed.compare(iraMaximum) >= 0 ? zero() : iraMaximum.minus(sharedIraUsed);
    return complete(min(phaseout(iraMaximum, facts.rothMagi, bounds), remaining));
  }
  if (facts.workplacePlanCovered === undefined) return incomplete("IRA_WORKPLACE_COVERAGE_REQUIRED");
  if (facts.filingStatus === "married_separate" && facts.livesWithSpouse === undefined) return incomplete("IRA_MFS_DEDUCTION_RESIDENCE_REQUIRED");
  if (!facts.workplacePlanCovered && ["married_joint", "married_separate"].includes(facts.filingStatus) && facts.spouseWorkplacePlanCovered === undefined) return incomplete("IRA_SPOUSE_WORKPLACE_COVERAGE_REQUIRED");
  const spouseCoveredPhaseout = !facts.workplacePlanCovered && facts.spouseWorkplacePlanCovered === true && (facts.filingStatus === "married_joint" || facts.filingStatus === "married_separate" && facts.livesWithSpouse);
  if (!facts.workplacePlanCovered && !spouseCoveredPhaseout) return complete(iraMaximum);
  if (!validMoney(facts.deductionMagi)) return incomplete("IRA_DEDUCTION_MAGI_REQUIRED");
  const bounds = facts.filingStatus === "married_separate" && facts.livesWithSpouse ? D1_CONTRIBUTION_LAW_2026.deductionPhaseout.separateCovered
    : !facts.workplacePlanCovered ? D1_CONTRIBUTION_LAW_2026.deductionPhaseout.jointSpouseCovered
      : ["married_joint", "qualifying_surviving_spouse"].includes(facts.filingStatus) ? D1_CONTRIBUTION_LAW_2026.deductionPhaseout.jointCovered : D1_CONTRIBUTION_LAW_2026.deductionPhaseout.singleCovered;
  return complete(phaseout(iraMaximum, facts.deductionMagi, bounds));
};
