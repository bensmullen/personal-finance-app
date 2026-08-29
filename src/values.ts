const DECIMAL_PATTERN = /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/;

const powerOfTen = (exponent: number): bigint => {
  if (!Number.isSafeInteger(exponent) || exponent < 0) throw new Error(`Invalid decimal scale: ${exponent}`);
  return 10n ** BigInt(exponent);
};

const normalize = (coefficient: bigint, scale: number): readonly [bigint, number] => {
  if (!Number.isSafeInteger(scale) || scale < 0) throw new Error(`Invalid decimal scale: ${scale}`);
  if (coefficient === 0n) return [0n, 0] as const;
  let normalized = coefficient;
  let normalizedScale = scale;
  while (normalizedScale > 0 && normalized % 10n === 0n) {
    normalized /= 10n;
    normalizedScale -= 1;
  }
  return [normalized, normalizedScale] as const;
};

export type RoundingMode =
  | "half_up"
  | "half_even"
  | "toward_zero"
  | "away_from_zero"
  | "floor"
  | "ceiling";

export class RoundingPolicy {
  constructor(
    readonly scale: number,
    readonly mode: RoundingMode,
  ) {
    if (!Number.isSafeInteger(scale) || scale < 0) throw new Error("Rounding scale must be a non-negative integer");
    Object.freeze(this);
  }

  static currency(scale: number, mode: RoundingMode): RoundingPolicy {
    return new RoundingPolicy(scale, mode);
  }
}

const roundedQuotient = (numerator: bigint, denominator: bigint, mode: RoundingMode): bigint => {
  if (denominator === 0n) throw new Error("Division by zero");
  const negative = (numerator < 0n) !== (denominator < 0n);
  const absoluteNumerator = numerator < 0n ? -numerator : numerator;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = absoluteNumerator / absoluteDenominator;
  const remainder = absoluteNumerator % absoluteDenominator;
  if (remainder === 0n) return negative ? -quotient : quotient;

  const twiceRemainder = remainder * 2n;
  const increment = (() => {
    switch (mode) {
      case "half_up": return twiceRemainder >= absoluteDenominator;
      case "half_even": return twiceRemainder > absoluteDenominator || (twiceRemainder === absoluteDenominator && quotient % 2n !== 0n);
      case "toward_zero": return false;
      case "away_from_zero": return true;
      case "floor": return negative;
      case "ceiling": return !negative;
    }
  })();
  const magnitude = quotient + (increment ? 1n : 0n);
  return negative ? -magnitude : magnitude;
};

/** Exact, arbitrary-precision base-10 value. Division always requires a rounding policy. */
export class DecimalAmount {
  readonly #coefficient: bigint;
  readonly #scale: number;

  private constructor(coefficient: bigint, scale: number) {
    [this.#coefficient, this.#scale] = normalize(coefficient, scale);
    Object.freeze(this);
  }

  static parse(serialized: string): DecimalAmount {
    const value = serialized.trim();
    if (!DECIMAL_PATTERN.test(value)) throw new Error(`Invalid decimal amount: ${serialized}`);
    const negative = value.startsWith("-");
    const unsigned = value.replace(/^[+-]/, "");
    const [whole = "0", fraction = ""] = unsigned.split(".");
    const coefficient = BigInt(`${whole}${fraction}`);
    return new DecimalAmount(negative ? -coefficient : coefficient, fraction.length);
  }

  static zero(): DecimalAmount { return new DecimalAmount(0n, 0); }

  plus(other: DecimalAmount): DecimalAmount {
    const scale = Math.max(this.#scale, other.#scale);
    return new DecimalAmount(
      this.#coefficient * powerOfTen(scale - this.#scale) + other.#coefficient * powerOfTen(scale - other.#scale),
      scale,
    );
  }

  minus(other: DecimalAmount): DecimalAmount { return this.plus(other.negated()); }
  negated(): DecimalAmount { return new DecimalAmount(-this.#coefficient, this.#scale); }
  absolute(): DecimalAmount { return this.#coefficient < 0n ? this.negated() : this; }

  times(other: DecimalAmount): DecimalAmount {
    return new DecimalAmount(this.#coefficient * other.#coefficient, this.#scale + other.#scale);
  }

  dividedBy(other: DecimalAmount, policy: RoundingPolicy): DecimalAmount {
    let numerator = this.#coefficient;
    let denominator = other.#coefficient;
    const shift = other.#scale + policy.scale - this.#scale;
    if (shift >= 0) numerator *= powerOfTen(shift);
    else denominator *= powerOfTen(-shift);
    return new DecimalAmount(roundedQuotient(numerator, denominator, policy.mode), policy.scale);
  }

  pow(exponent: number): DecimalAmount {
    if (!Number.isSafeInteger(exponent) || exponent < 0) throw new Error("Decimal exponent must be a non-negative integer");
    const scale = this.#scale * exponent;
    if (!Number.isSafeInteger(scale)) throw new Error("Decimal exponent produces an unsupported scale");
    return new DecimalAmount(this.#coefficient ** BigInt(exponent), scale);
  }

  round(policy: RoundingPolicy): DecimalAmount {
    if (policy.scale >= this.#scale) return this;
    return new DecimalAmount(
      roundedQuotient(this.#coefficient, powerOfTen(this.#scale - policy.scale), policy.mode),
      policy.scale,
    );
  }

  compare(other: DecimalAmount): -1 | 0 | 1 {
    const scale = Math.max(this.#scale, other.#scale);
    const left = this.#coefficient * powerOfTen(scale - this.#scale);
    const right = other.#coefficient * powerOfTen(scale - other.#scale);
    return left < right ? -1 : left > right ? 1 : 0;
  }

  equals(other: DecimalAmount): boolean { return this.compare(other) === 0; }
  isZero(): boolean { return this.#coefficient === 0n; }
  isNegative(): boolean { return this.#coefficient < 0n; }
  isPositive(): boolean { return this.#coefficient > 0n; }
  fitsScale(scale: number): boolean {
    if (!Number.isSafeInteger(scale) || scale < 0) throw new Error("Scale must be a non-negative integer");
    return this.#scale <= scale;
  }

  toString(): string {
    const negative = this.#coefficient < 0n;
    const digits = (negative ? -this.#coefficient : this.#coefficient).toString();
    if (this.#scale === 0) return `${negative ? "-" : ""}${digits}`;
    const padded = digits.padStart(this.#scale + 1, "0");
    return `${negative ? "-" : ""}${padded.slice(0, -this.#scale)}.${padded.slice(-this.#scale)}`;
  }

  toFixed(policy: RoundingPolicy): string {
    const rounded = this.round(policy).toString();
    const negative = rounded.startsWith("-");
    const unsigned = rounded.replace(/^-/, "");
    const [whole = "0", fraction = ""] = unsigned.split(".");
    return `${negative ? "-" : ""}${whole}${policy.scale === 0 ? "" : `.${fraction.padEnd(policy.scale, "0")}`}`;
  }

  toJSON(): string { return this.toString(); }
}

export const decimal = (value: string): DecimalAmount => DecimalAmount.parse(value);

const CURRENCY_MINOR_UNITS = Object.freeze({
  EUR: 2,
  GBP: 2,
  JPY: 0,
  KWD: 3,
  USD: 2,
} as const);

export type SupportedCurrencyCode = keyof typeof CURRENCY_MINOR_UNITS;

export class Currency {
  private constructor(readonly code: SupportedCurrencyCode, readonly minorUnitScale: number) { Object.freeze(this); }

  static of(code: string): Currency {
    const minorUnitScale = CURRENCY_MINOR_UNITS[code as SupportedCurrencyCode];
    if (minorUnitScale === undefined) throw new Error(`Unsupported currency code: ${code}`);
    return new Currency(code as SupportedCurrencyCode, minorUnitScale);
  }

  equals(other: Currency): boolean { return this.code === other.code; }
  toString(): string { return this.code; }
  toJSON(): string { return this.code; }
}

export const USD = Currency.of("USD");

export class Money {
  constructor(readonly amount: DecimalAmount, readonly currency: Currency) { Object.freeze(this); }

  static parse(serialized: string, currency: Currency): Money { return new Money(decimal(serialized), currency); }
  static zero(currency: Currency): Money { return new Money(DecimalAmount.zero(), currency); }

  #assertCurrency(other: Money): void {
    if (!this.currency.equals(other.currency)) throw new Error(`Currency mismatch: ${this.currency.code} and ${other.currency.code}`);
  }

  plus(other: Money): Money { this.#assertCurrency(other); return new Money(this.amount.plus(other.amount), this.currency); }
  minus(other: Money): Money { this.#assertCurrency(other); return new Money(this.amount.minus(other.amount), this.currency); }
  negated(): Money { return new Money(this.amount.negated(), this.currency); }
  times(multiplier: DecimalAmount): Money { return new Money(this.amount.times(multiplier), this.currency); }
  round(policy: RoundingPolicy): Money { return new Money(this.amount.round(policy), this.currency); }
  compare(other: Money): -1 | 0 | 1 { this.#assertCurrency(other); return this.amount.compare(other.amount); }
  equals(other: Money): boolean { return this.currency.equals(other.currency) && this.amount.equals(other.amount); }
  isZero(): boolean { return this.amount.isZero(); }
  isNegative(): boolean { return this.amount.isNegative(); }
  isPositive(): boolean { return this.amount.isPositive(); }

  toJSON(): { amount: string; currency: string } {
    return { amount: this.amount.toString(), currency: this.currency.code };
  }
}

export const money = (value: string, currency: Currency = USD): Money => Money.parse(value, currency);

export const sumMoney = (values: readonly Money[], currency: Currency = USD): Money =>
  values.reduce((total, value) => total.plus(value), Money.zero(currency));

export enum RateBasis {
  EffectiveAnnual = "effective_annual",
  NominalAnnual = "nominal_annual",
  Periodic = "periodic",
  Continuous = "continuous",
}

export class Ratio {
  constructor(readonly value: DecimalAmount) { Object.freeze(this); }
  static parse(value: string): Ratio { return new Ratio(decimal(value)); }
  toJSON(): string { return this.value.toString(); }
}

export class Percentage {
  constructor(readonly value: DecimalAmount) { Object.freeze(this); }
  static parse(value: string): Percentage { return new Percentage(decimal(value)); }
  toRatio(): Ratio { return new Ratio(this.value.times(decimal("0.01"))); }
  toJSON(): { value: string; unit: "percent" } { return { value: this.value.toString(), unit: "percent" }; }
}

export type RatePeriodUnit = "day" | "calendar_month" | "year";

export interface RatePeriod {
  readonly count: DecimalAmount;
  readonly unit: RatePeriodUnit;
}

export type RateConvention =
  | { readonly basis: RateBasis.EffectiveAnnual }
  | { readonly basis: RateBasis.NominalAnnual; readonly compoundingPeriodsPerYear: number }
  | { readonly basis: RateBasis.Periodic; readonly period: RatePeriod }
  | { readonly basis: RateBasis.Continuous };

export const ratePeriod = (count: string, unit: RatePeriodUnit): RatePeriod => {
  const amount = decimal(count);
  if (!amount.isPositive()) throw new Error("Rate period count must be positive");
  return Object.freeze({ count: amount, unit });
};

export const rateConvention = Object.freeze({
  effectiveAnnual: (): RateConvention => Object.freeze({ basis: RateBasis.EffectiveAnnual }),
  nominalAnnual: (compoundingPeriodsPerYear: number): RateConvention => {
    if (!Number.isSafeInteger(compoundingPeriodsPerYear) || compoundingPeriodsPerYear <= 0) {
      throw new Error("Nominal annual rate requires a positive integer compounding frequency");
    }
    return Object.freeze({ basis: RateBasis.NominalAnnual, compoundingPeriodsPerYear });
  },
  periodic: (period: RatePeriod): RateConvention => Object.freeze({ basis: RateBasis.Periodic, period }),
  continuous: (): RateConvention => Object.freeze({ basis: RateBasis.Continuous }),
});

export class Rate {
  constructor(readonly value: DecimalAmount, readonly convention: RateConvention) { Object.freeze(this); }

  static fromDecimal(value: string, convention: RateConvention): Rate { return new Rate(decimal(value), convention); }
  static fromPercentage(value: string | Percentage, convention: RateConvention): Rate {
    const percentage = typeof value === "string" ? Percentage.parse(value) : value;
    return new Rate(percentage.toRatio().value, convention);
  }
  static fromBasisPoints(value: string, convention: RateConvention): Rate {
    return new Rate(decimal(value).times(decimal("0.0001")), convention);
  }

  toJSON(): { value: string; convention: RateConvention } { return { value: this.value.toString(), convention: this.convention }; }
}

const UNIT_PATTERN = /^[a-z][a-z0-9_-]*$/;

export class Unit {
  private constructor(readonly code: string) { Object.freeze(this); }
  static of(code: string): Unit {
    if (!UNIT_PATTERN.test(code)) throw new Error(`Invalid unit: ${code}`);
    return new Unit(code);
  }
  equals(other: Unit): boolean { return this.code === other.code; }
  toString(): string { return this.code; }
  toJSON(): string { return this.code; }
}

export const SHARE = Unit.of("share");

export class Quantity {
  constructor(readonly amount: DecimalAmount, readonly unit: Unit) { Object.freeze(this); }
  static parse(value: string, unit: Unit): Quantity { return new Quantity(decimal(value), unit); }
  static zero(unit: Unit): Quantity { return new Quantity(DecimalAmount.zero(), unit); }

  #assertUnit(other: Quantity): void {
    if (!this.unit.equals(other.unit)) throw new Error(`Unit mismatch: ${this.unit.code} and ${other.unit.code}`);
  }

  plus(other: Quantity): Quantity { this.#assertUnit(other); return new Quantity(this.amount.plus(other.amount), this.unit); }
  minus(other: Quantity): Quantity { this.#assertUnit(other); return new Quantity(this.amount.minus(other.amount), this.unit); }
  compare(other: Quantity): -1 | 0 | 1 { this.#assertUnit(other); return this.amount.compare(other.amount); }
  equals(other: Quantity): boolean { return this.unit.equals(other.unit) && this.amount.equals(other.amount); }
  isNegative(): boolean { return this.amount.isNegative(); }
  toJSON(): { amount: string; unit: string } { return { amount: this.amount.toString(), unit: this.unit.code }; }
}

export const quantity = (value: string, unit: Unit): Quantity => Quantity.parse(value, unit);

export const formatMoney = (value: Money, displayPolicy: RoundingPolicy): string => {
  const formatted = value.amount.toFixed(displayPolicy);
  const sign = formatted.startsWith("-") ? "-" : "";
  const unsigned = formatted.replace(/^-/, "");
  return value.currency.code === "USD" ? `${sign}$${unsigned}` : `${sign}${value.currency.code} ${unsigned}`;
};
