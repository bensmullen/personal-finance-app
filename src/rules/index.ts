import {
  type DecimalAmount,
  Money,
  Ratio,
  Rate,
  RateBasis,
  RoundingPolicy,
  decimal,
} from "../values/index.js";

const divisionPrecision = new RoundingPolicy(30, "half_even");

const monthlyNominalRate = (annualRate: Rate): DecimalAmount => {
  if (annualRate.convention.basis !== RateBasis.NominalAnnual || annualRate.convention.compoundingPeriodsPerYear !== 12) {
    throw new Error("Monthly mortgage rate requires nominal annual convention with 12 contractual compounding periods");
  }
  return annualRate.value.dividedBy(decimal(annualRate.convention.compoundingPeriodsPerYear.toString()), divisionPrecision);
};

export function fixedMortgagePayment(principal: Money, annualRate: Rate, remainingPayments: number, postingRounding: RoundingPolicy): Money {
  if (!Number.isSafeInteger(remainingPayments) || remainingPayments <= 0 || principal.isNegative()) throw new Error("Invalid mortgage terms");
  const periodicRate = monthlyNominalRate(annualRate);
  const unrounded = periodicRate.isZero()
    ? principal.amount.dividedBy(decimal(remainingPayments.toString()), divisionPrecision)
    : (() => {
        const factor = decimal("1").plus(periodicRate).pow(remainingPayments);
        return principal.amount.times(periodicRate).times(factor).dividedBy(factor.minus(decimal("1")), divisionPrecision);
      })();
  return new Money(unrounded.round(postingRounding), principal.currency);
}

export function mortgageInterest(principal: Money, annualRate: Rate, accrualRounding: RoundingPolicy): Money {
  return new Money(principal.amount.times(monthlyNominalRate(annualRate)).round(accrualRounding), principal.currency);
}

export function mortgagePrincipal(payment: Money, interest: Money, balance: Money): Money {
  const principal = payment.minus(interest);
  return principal.compare(balance) > 0 ? balance : principal;
}

export const calculateProportionalTax = (base: Money, taxRate: Ratio, postingRounding: RoundingPolicy): Money => {
  if (taxRate.value.isNegative() || taxRate.value.compare(decimal("1")) > 0) throw new Error("Tax ratio must be from 0 to 1");
  if (base.isNegative()) throw new Error("Tax base cannot be negative");
  return new Money(base.amount.times(taxRate.value).round(postingRounding), base.currency);
};
