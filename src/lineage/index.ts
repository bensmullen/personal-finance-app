declare const calculationTraceIdBrand: unique symbol;

export type CalculationTraceId = string & {
  readonly [calculationTraceIdBrand]: "CalculationTraceId";
};

export interface CalculationTraceRef {
  readonly traceId: CalculationTraceId;
  readonly ruleIds?: readonly import("../identity/index.js").DomainId<"tax-rule">[];
}

export const calculationTraceId = (value: string): CalculationTraceId => {
  if (value.trim().length === 0) throw new Error("Calculation trace identity cannot be empty");
  return value as CalculationTraceId;
};

export const calculationTraceRef = (traceId: CalculationTraceId, ruleIds?: readonly import("../identity/index.js").DomainId<"tax-rule">[]): CalculationTraceRef => {
  const normalizedRuleIds = ruleIds === undefined ? undefined : Object.freeze([...new Set(ruleIds)].sort());
  return Object.freeze({ traceId, ...(normalizedRuleIds === undefined || normalizedRuleIds.length === 0 ? {} : { ruleIds: normalizedRuleIds }) });
};

export const freezeTraceRefs = (
  refs: readonly CalculationTraceRef[] | undefined,
): readonly CalculationTraceRef[] | undefined => refs === undefined
  ? undefined
  : Object.freeze(refs.map((ref) => calculationTraceRef(ref.traceId, ref.ruleIds)));
