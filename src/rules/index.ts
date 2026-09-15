import {
  type DecimalAmount,
  Money,
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

/**
 * Replays the fixed, no-recast contractual schedule used by P22/VS4 to the
 * opening boundary.  This is deliberately a loop over the public mortgage
 * rules rather than a closed-form balance formula: every posting is rounded
 * exactly as the engine will round it.
 */
export function fixedMortgagePrincipalAfterPayments(
  originalPrincipal: Money,
  annualRate: Rate,
  totalPayments: number,
  completedPayments: number,
  postingRounding: RoundingPolicy,
): Money {
  if (!Number.isSafeInteger(totalPayments) || totalPayments <= 0 || !Number.isSafeInteger(completedPayments) || completedPayments < 0 || completedPayments > totalPayments)
    throw new Error("Invalid fixed mortgage schedule terms");
  let balance = originalPrincipal;
  const contractualPayment = fixedMortgagePayment(originalPrincipal, annualRate, totalPayments, postingRounding);
  for (let paymentNumber = 0; paymentNumber < completedPayments && balance.isPositive(); paymentNumber += 1) {
    const interest = mortgageInterest(balance, annualRate, postingRounding);
    const payment = paymentNumber + 1 === totalPayments
      ? balance.plus(interest)
      : contractualPayment;
    balance = balance.minus(mortgagePrincipal(payment, interest, balance));
  }
  return balance;
}

export * from "./contracts.js";
export * from "./resolver.js";
export * from "./tax.js";
export * from "./contribution.js";
export * from "./product.js";
export * from "./fee.js";
