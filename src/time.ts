declare const civilDateBrand: unique symbol;
declare const instantBrand: unique symbol;

export type CivilDate = string & { readonly [civilDateBrand]: "CivilDate" };
export type Instant = string & { readonly [instantBrand]: "Instant" };

const CIVIL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const isLeapYear = (year: number): boolean => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

export const civilDate = (value: string): CivilDate => {
  const match = CIVIL_DATE_PATTERN.exec(value);
  if (!match) throw new Error(`Invalid civil date: ${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > (days[month - 1] ?? 0)) throw new Error(`Invalid civil date: ${value}`);
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

export const month = (year: number, month1: number): Period => {
  if (!Number.isSafeInteger(year) || !Number.isSafeInteger(month1) || month1 < 1 || month1 > 12) {
    throw new Error("Invalid calendar month");
  }
  const start = instant(new Date(Date.UTC(year, month1 - 1, 1)).toISOString());
  const end = instant(new Date(Date.UTC(year, month1, 1)).toISOString());
  return period(start, end);
};

export const inPeriod = (value: Instant, target: Period): boolean => value >= target.start && value < target.end;

export const subtractMilliseconds = (value: Instant, milliseconds: number): Instant => {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new Error("Milliseconds must be a non-negative integer");
  return instant(new Date(new Date(value).getTime() - milliseconds).toISOString());
};
