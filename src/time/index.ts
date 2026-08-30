import { DecimalAmount, RoundingPolicy, decimal } from "../values/index.js";

declare const civilDateBrand: unique symbol;
declare const instantBrand: unique symbol;

export type CivilDate = string & { readonly [civilDateBrand]: "CivilDate" };
export type Instant = string & { readonly [instantBrand]: "Instant" };

const CIVIL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

interface CivilDateParts { readonly year: number; readonly month: number; readonly day: number; }

const isLeapYear = (year: number): boolean => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
const daysInYear = (year: number): number => isLeapYear(year) ? 366 : 365;

const parseCivilDate = (value: string): CivilDateParts => {
  const match = CIVIL_DATE_PATTERN.exec(value);
  if (!match) throw new Error(`Invalid civil date: ${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > (days[month - 1] ?? 0)) throw new Error(`Invalid civil date: ${value}`);
  return { year, month, day };
};

// Proleptic Gregorian day number; only differences are observable.
const civilDayNumber = ({ year, month, day }: CivilDateParts): number => {
  const adjustedYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const adjustedMonth = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * adjustedMonth + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra;
};

const paddedYear = (year: number): string => year.toString().padStart(4, "0");

export const civilDate = (value: string): CivilDate => {
  parseCivilDate(value);
  return value as CivilDate;
};

export const instant = (value: string): Instant => {
  const epochMilliseconds = Date.parse(value);
  if (!INSTANT_PATTERN.test(value) || !Number.isFinite(epochMilliseconds) || new Date(epochMilliseconds).toISOString() !== value) {
    throw new Error(`Invalid UTC instant: ${value}`);
  }
  return value as Instant;
};

export interface Period {
  readonly start: Instant;
  readonly end: Instant;
}

export const period = (start: Instant, end: Instant): Period => {
  if (start >= end) throw new Error("Period must be a non-empty half-open interval");
  return Object.freeze({ start, end });
};

/** UTC-only helper for fixtures and explicitly UTC schedules; not a household calendar-month constructor. */
export const utcMonth = (year: number, month1: number): Period => {
  if (!Number.isSafeInteger(year) || year < 100 || year > 9998) throw new Error("UTC month year must be from 0100 through 9998");
  if (!Number.isSafeInteger(month1) || month1 < 1 || month1 > 12) throw new Error("Invalid UTC calendar month");
  const start = instant(new Date(Date.UTC(year, month1 - 1, 1)).toISOString());
  const end = instant(new Date(Date.UTC(year, month1, 1)).toISOString());
  return period(start, end);
};

export const inPeriod = (value: Instant, target: Period): boolean => value >= target.start && value < target.end;

export const subtractMilliseconds = (value: Instant, milliseconds: number): Instant => {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new Error("Milliseconds must be a non-negative integer");
  return instant(new Date(new Date(value).getTime() - milliseconds).toISOString());
};

export class Duration {
  constructor(readonly days: bigint) { Object.freeze(this); }
  isNegative(): boolean { return this.days < 0n; }
  toJSON(): { days: string } { return { days: this.days.toString() }; }
}

export const durationBetween = (start: CivilDate, end: CivilDate): Duration =>
  new Duration(BigInt(civilDayNumber(parseCivilDate(end)) - civilDayNumber(parseCivilDate(start))));

export enum DayCountConvention {
  ActualActualISDA = "actual_actual_isda",
  Actual365Fixed = "actual_365_fixed",
  Actual360 = "actual_360",
  ThirtyE360 = "30e_360",
}

export class YearFraction {
  constructor(readonly value: DecimalAmount, readonly convention: DayCountConvention) {
    if (value.isNegative()) throw new Error("Year fraction cannot be negative");
    Object.freeze(this);
  }
  toJSON(): { value: string; convention: DayCountConvention } {
    return { value: this.value.toString(), convention: this.convention };
  }
}

const fraction = (days: bigint, denominator: number, policy: RoundingPolicy): DecimalAmount =>
  decimal(days.toString()).dividedBy(decimal(denominator.toString()), policy);

const actualActualISDA = (start: CivilDateParts, end: CivilDateParts, policy: RoundingPolicy): DecimalAmount => {
  if (start.year === end.year) {
    return fraction(BigInt(civilDayNumber(end) - civilDayNumber(start)), daysInYear(start.year), policy);
  }

  const startYearEnd = parseCivilDate(`${paddedYear(start.year + 1)}-01-01`);
  let result = fraction(BigInt(civilDayNumber(startYearEnd) - civilDayNumber(start)), daysInYear(start.year), policy);
  for (let year = start.year + 1; year < end.year; year += 1) result = result.plus(decimal("1"));
  const endYearStart = parseCivilDate(`${paddedYear(end.year)}-01-01`);
  return result.plus(fraction(BigInt(civilDayNumber(end) - civilDayNumber(endYearStart)), daysInYear(end.year), policy));
};

export const yearFraction = (
  start: CivilDate,
  end: CivilDate,
  convention: DayCountConvention,
  divisionPolicy: RoundingPolicy,
): YearFraction => {
  const startParts = parseCivilDate(start);
  const endParts = parseCivilDate(end);
  const actualDays = durationBetween(start, end);
  if (actualDays.isNegative()) throw new Error("Year-fraction end must not precede start");

  const value = (() => {
    switch (convention) {
      case DayCountConvention.ActualActualISDA:
        return actualActualISDA(startParts, endParts, divisionPolicy);
      case DayCountConvention.Actual365Fixed:
        return fraction(actualDays.days, 365, divisionPolicy);
      case DayCountConvention.Actual360:
        return fraction(actualDays.days, 360, divisionPolicy);
      case DayCountConvention.ThirtyE360: {
        const days = 360 * (endParts.year - startParts.year)
          + 30 * (endParts.month - startParts.month)
          + Math.min(endParts.day, 30) - Math.min(startParts.day, 30);
        return fraction(BigInt(days), 360, divisionPolicy);
      }
    }
  })();
  return new YearFraction(value, convention);
};
