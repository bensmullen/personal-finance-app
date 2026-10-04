import { createCalibrationSet } from "./index.js";
import type { CalibrationDraft } from "./types.js";

/** Maintained synthetic engineering vintage. These are invented fixture inputs,
 * not observations, an investment forecast, or a user recommendation. */
const baselineDraft: CalibrationDraft = {
  source: {
    kind: "synthetic", id: "pfa:synthetic-broad-market", version: "1",
    methodology: { id: "pfa:engineering-moments", version: "1" },
    mapping: { id: "pfa:synthetic-member-definitions", version: "1" },
    publishedAt: "2026-01-01T00:00:00.000Z", observedAt: "2026-01-01T00:00:00.000Z",
    dataCutoff: "2026-01-01T00:00:00.000Z", freshness: "fixed_vintage",
    provenance: {
      reference: "repository:src/calibration/baseline.ts",
      license: "Repository-authored synthetic engineering data; no external source license asserted",
      attribution: "Personal Finance App engineering fixtures; no institutional research claims",
    },
  },
  horizon: { unit: "month", months: 120 }, baseCurrency: "USD", basis: "nominal",
  returnConvention: "annual_arithmetic_simple_total_return",
  members: [
    { kind: "asset_class", id: "broad_equity", definition: "Synthetic diversified broad equity total return in USD",
      terms: [
        { startMonth: 0, endMonth: 60, expectedReturn: "0.06", volatility: "0.18" },
        { startMonth: 60, endMonth: 120, expectedReturn: "0.055", volatility: "0.17" },
      ] },
    { kind: "asset_class", id: "broad_bonds", definition: "Synthetic diversified broad bond total return in USD",
      terms: [{ startMonth: 0, endMonth: 120, expectedReturn: "0.03", volatility: "0.06" }] },
    { kind: "asset_class", id: "cash", definition: "Synthetic USD cash total return with small nonzero volatility",
      terms: [{ startMonth: 0, endMonth: 120, expectedReturn: "0.02", volatility: "0.01" }] },
  ],
  dependence: {
    kind: "pearson_simple_return",
    members: ["asset_class:broad_equity", "asset_class:broad_bonds", "asset_class:cash"],
    matrix: [["1", "0.2", "0"], ["0.2", "1", "0.1"], ["0", "0.1", "1"]],
  },
  metadata: { coverage: "Three synthetic asset classes; no sector, factor, or issuer calibration", regime: "Fixed engineering baseline; no inferred market regime" },
};

export const SYNTHETIC_CALIBRATION_BASELINE = createCalibrationSet(baselineDraft);
