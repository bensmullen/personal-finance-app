declare const calculationTraceIdBrand: unique symbol;

export type CalculationTraceId = string & {
  readonly [calculationTraceIdBrand]: "CalculationTraceId";
};

export interface CalculationTraceRef {
  readonly traceId: CalculationTraceId;
}

export const calculationTraceId = (value: string): CalculationTraceId => {
  if (value.trim().length === 0) throw new Error("Calculation trace identity cannot be empty");
  return value as CalculationTraceId;
};

export const calculationTraceRef = (traceId: CalculationTraceId): CalculationTraceRef =>
  Object.freeze({ traceId });

export const freezeTraceRefs = (
  refs: readonly CalculationTraceRef[] | undefined,
): readonly CalculationTraceRef[] | undefined => refs === undefined
  ? undefined
  : Object.freeze(refs.map((ref) => Object.freeze({ ...ref })));
