import { civilDate, instant } from "../../../../src/time/index.js";

export const householdId = "synthetic-household";
export const personId = "person";
// One UTC observation boundary. CivilDate consumers receive its calendar date;
// FSA receives the explicit Instant, with no inferred paycheck cadence.
export const cutoff = civilDate("2040-06-01");
export const cutoffInstant = instant("2040-06-01T00:00:00.000Z");
export const rawMarker = "ORIGINAL_DOCUMENT_APPENDIX_ONLY:" + "synthetic appendix ".repeat(80);

export const freeze = (value: unknown): void => {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.values(value).forEach(freeze);
  Object.freeze(value);
};
