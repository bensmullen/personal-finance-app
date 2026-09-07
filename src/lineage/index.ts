declare const calculationTraceIdBrand: unique symbol;

export type CalculationTraceId = string & {
  readonly [calculationTraceIdBrand]: "CalculationTraceId";
};

export interface CalculationTraceRef {
  readonly traceId: CalculationTraceId;
  readonly ruleIds?: readonly import("../identity/index.js").DomainId<"tax-rule">[];
  readonly assumptionIds?: readonly import("../identity/index.js").DomainId<"assumption">[];
  readonly eventIds?: readonly import("../identity/index.js").DomainId<"event">[];
}

export const calculationTraceId = (value: string): CalculationTraceId => {
  if (value.trim().length === 0) throw new Error("Calculation trace identity cannot be empty");
  return value as CalculationTraceId;
};

const normalizedIds = <T extends string>(ids: readonly T[] | undefined): readonly T[] | undefined => {
  if (ids === undefined) return undefined;
  const values = [...new Set(ids)].sort();
  return values.length === 0 ? undefined : Object.freeze(values);
};

export const calculationTraceRef = (
  traceId: CalculationTraceId,
  ruleIds?: readonly import("../identity/index.js").DomainId<"tax-rule">[],
  assumptionIds?: readonly import("../identity/index.js").DomainId<"assumption">[],
  eventIds?: readonly import("../identity/index.js").DomainId<"event">[],
): CalculationTraceRef => {
  const normalizedRuleIds = ruleIds === undefined ? undefined : Object.freeze([...new Set(ruleIds)].sort());
  const normalizedAssumptionIds = normalizedIds(assumptionIds);
  const normalizedEventIds = normalizedIds(eventIds);
  return Object.freeze({
    traceId,
    ...(normalizedRuleIds === undefined || normalizedRuleIds.length === 0 ? {} : { ruleIds: normalizedRuleIds }),
    ...(normalizedAssumptionIds === undefined ? {} : { assumptionIds: normalizedAssumptionIds }),
    ...(normalizedEventIds === undefined ? {} : { eventIds: normalizedEventIds }),
  });
};

/** Deterministically unions all lineage dimensions for each trace identity. */
export const mergeTraceRefs = (
  ...groups: readonly (readonly CalculationTraceRef[] | undefined)[]
): readonly CalculationTraceRef[] | undefined => {
  const byTraceId = new Map<CalculationTraceId, { rules: import("../identity/index.js").DomainId<"tax-rule">[]; assumptions: import("../identity/index.js").DomainId<"assumption">[]; events: import("../identity/index.js").DomainId<"event">[] }>();
  for (const ref of groups.flatMap((group) => group ?? [])) {
    const entry = byTraceId.get(ref.traceId) ?? { rules: [], assumptions: [], events: [] };
    entry.rules.push(...(ref.ruleIds ?? []));
    entry.assumptions.push(...(ref.assumptionIds ?? []));
    entry.events.push(...(ref.eventIds ?? []));
    byTraceId.set(ref.traceId, entry);
  }
  if (byTraceId.size === 0) return undefined;
  return Object.freeze([...byTraceId.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([traceId, ids]) => calculationTraceRef(traceId, ids.rules, ids.assumptions, ids.events)));
};

export const freezeTraceRefs = (
  refs: readonly CalculationTraceRef[] | undefined,
): readonly CalculationTraceRef[] | undefined => refs === undefined ? undefined : (mergeTraceRefs(refs) ?? Object.freeze([]));
