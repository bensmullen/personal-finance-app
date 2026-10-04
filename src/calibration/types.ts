export interface CalibrationSource {
  readonly kind: "synthetic" | "internal" | "external";
  readonly id: string;
  readonly version: string;
  readonly methodology: { readonly id: string; readonly version: string };
  readonly mapping: { readonly id: string; readonly version: string };
  readonly publishedAt: string;
  readonly observedAt: string;
  readonly dataCutoff: string;
  readonly freshness: "fixed_vintage";
  readonly provenance: { readonly reference: string; readonly license: string; readonly attribution: string };
}

export interface CalibrationTerm {
  /** Half-open offsets from forecast origin, in months. */
  readonly startMonth: number;
  readonly endMonth: number;
  /** Annual arithmetic expected simple total return, as an exact decimal ratio. */
  readonly expectedReturn: string;
  /** Annual standard deviation of simple total return, as an exact decimal ratio. */
  readonly volatility: string;
}

export interface CalibrationMember {
  readonly kind: "asset_class" | "sector" | "factor" | "issuer";
  /** Case-sensitive internal identifier; no implicit aliases or hierarchy lookup. */
  readonly id: string;
  readonly definition: string;
  readonly terms: readonly CalibrationTerm[];
}

export interface CalibrationCorrelation {
  readonly kind: "pearson_simple_return";
  /** Complete member keys in matrix row/column order. */
  readonly members: readonly string[];
  readonly matrix: readonly (readonly string[])[];
}

export interface CalibrationDraft {
  readonly source: CalibrationSource;
  readonly horizon: { readonly unit: "month"; readonly months: number };
  readonly baseCurrency: string;
  readonly basis: "nominal" | "real";
  readonly returnConvention: "annual_arithmetic_simple_total_return";
  readonly members: readonly CalibrationMember[];
  /** One matrix applies to every term; term-varying dependence is unsupported in C1. */
  readonly dependence: CalibrationCorrelation;
  /** Source-supplied descriptions only; no invented confidence probabilities. */
  readonly metadata?: { readonly confidence?: string; readonly coverage?: string; readonly regime?: string };
}

export type CalibrationFingerprint = string & { readonly __calibrationFingerprint: "CalibrationFingerprint" };
export interface CalibrationSet extends CalibrationDraft {
  readonly schemaVersion: "calibration/v1";
  readonly id: CalibrationFingerprint;
  readonly fingerprint: CalibrationFingerprint;
}
/** Forecasts retain this reference rather than duplicating the payload. */
export interface CalibrationReference {
  readonly schemaVersion: "calibration/v1";
  readonly fingerprint: CalibrationFingerprint;
}
