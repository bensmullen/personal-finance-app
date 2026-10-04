import { SYNTHETIC_CALIBRATION_BASELINE } from "../../src/calibration/baseline.js";
import type { CalibrationDraft } from "../../src/calibration/index.js";

type Mutable<T> = T extends readonly (infer V)[] ? Mutable<V>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;

/** Fresh mutable synthetic draft for rejection/change tests; never personal financial data. */
export const c1CalibrationDraft = (): Mutable<CalibrationDraft> => {
  const { schemaVersion: _schema, id: _id, fingerprint: _fingerprint, ...draft } = SYNTHETIC_CALIBRATION_BASELINE;
  return JSON.parse(JSON.stringify(draft)) as Mutable<CalibrationDraft>;
};
