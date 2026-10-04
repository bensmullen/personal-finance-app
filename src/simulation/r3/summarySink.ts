import type { AccountingTransaction } from "../../accounting/index.js";
import type { CalculationTraceRef } from "../../lineage/index.js";
import { mergeTraceRefs } from "../../lineage/index.js";
import { createStatementFlowAccumulator, type StatementFlows } from "../../statements/index.js";
import type { Currency } from "../../values/index.js";
import { canonicalSerialize } from "../run.js";

/** A current-operation sink. No accounting or semantic objects survive consumption. */
export class SummaryOperationSink {
  readonly #flows: ReturnType<typeof createStatementFlowAccumulator>;
  readonly #witnesses: string[] = [];
  readonly #sources = new Map<string, CalculationTraceRef>();
  readonly #rules = new Set<NonNullable<CalculationTraceRef["ruleIds"]>[number]>();
  readonly #assumptions = new Set<NonNullable<CalculationTraceRef["assumptionIds"]>[number]>();
  readonly #events = new Set<NonNullable<CalculationTraceRef["eventIds"]>[number]>();
  constructor(currency: Currency) { this.#flows = createStatementFlowAccumulator(currency); }
  transaction(value: AccountingTransaction): void {
    this.#flows.add(value);
    // Exact ordered accounting witnesses are needed only by current-instant
    // contention comparison. They are released at the period boundary.
    this.#witnesses.push(canonicalSerialize({ id: value.id, type: value.type, date: value.date, legs: value.legs }));
    this.traces(value.traceRefs ?? []);
  }
  traces(refs: readonly CalculationTraceRef[]): void {
    for (const ref of refs) {
      if (String(ref.traceId).startsWith("compiler:canonical:") || /:[^:]+-assumption$/.test(String(ref.traceId))) this.#sources.set(ref.traceId,
        mergeTraceRefs(this.#sources.has(ref.traceId) ? [this.#sources.get(ref.traceId)!] : [], [ref])![0]!);
      for (const id of ref.ruleIds ?? []) this.#rules.add(id);
      for (const id of ref.assumptionIds ?? []) this.#assumptions.add(id);
      for (const id of ref.eventIds ?? []) this.#events.add(id);
    }
  }
  snapshot(): SummaryAccountingEvidence {
    return Object.freeze({ flows: this.#flows.snapshot(), witnesses: Object.freeze(this.#witnesses),
      sources: Object.freeze([...this.#sources.values()].sort((a, b) => a.traceId.localeCompare(b.traceId))), rules: Object.freeze([...this.#rules].sort()),
      assumptions: Object.freeze([...this.#assumptions].sort()), events: Object.freeze([...this.#events].sort()) });
  }
}

export interface SummaryAccountingEvidence {
  readonly flows: StatementFlows;
  readonly witnesses: readonly string[];
  /** Actual compiler sources and static assumption addresses, without occurrence trace unions. */
  readonly sources: readonly CalculationTraceRef[];
  readonly rules: NonNullable<CalculationTraceRef["ruleIds"]>;
  readonly assumptions: NonNullable<CalculationTraceRef["assumptionIds"]>;
  readonly events: NonNullable<CalculationTraceRef["eventIds"]>;
}

/** Preserve financial validation of ephemeral values, while disabling audit retention. */
export const evidenceBuffer = <T>(summary: SummaryOperationSink | undefined, consume?: (value: T) => void): T[] => {
  const values: T[] = [];
  if (summary !== undefined) Object.defineProperty(values, "push", { value: (...items: T[]): number => {
    for (const item of items) consume?.(item);
    return 0;
  } });
  return values;
};
