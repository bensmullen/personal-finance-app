import { PersistentStringIndex } from "../../state/index.js";
import { canonicalSerialize } from "../run.js";
import { immutableConfiguration } from "../r3/compiledHousehold.js";
import type { TaxCapabilityDiagnostic } from "./contracts.js";

/** Capability witnesses share persistent roots just like their recognized sources. */
export class TaxDiagnosticLedger {
  readonly #index: PersistentStringIndex<TaxCapabilityDiagnostic>;
  declare readonly canonicalEntries: readonly TaxCapabilityDiagnostic[];
  private constructor(index: PersistentStringIndex<TaxCapabilityDiagnostic>) {
    this.#index = index;
    Object.defineProperty(this, "canonicalEntries", { enumerable: true, get: () => [...this] });
    Object.freeze(this);
  }
  static empty(): TaxDiagnosticLedger { return new TaxDiagnosticLedger(new PersistentStringIndex<TaxCapabilityDiagnostic>()); }
  get size(): number { return this.#index.size; }
  withoutSources(sourceIds: readonly string[]): TaxDiagnosticLedger {
    const next = this.#index.fork();
    for (const [key, entry] of this.#index.entries()) if (entry.category === "indirect_rollover_pending" && entry.entityId !== undefined && sourceIds.includes(entry.entityId)) next.delete(key);
    return new TaxDiagnosticLedger(next);
  }
  with(entries: readonly TaxCapabilityDiagnostic[]): TaxDiagnosticLedger {
    if (!entries.length) return this;
    const next = this.#index.fork();
    for (const entry of entries) next.set(canonicalSerialize(entry), immutableConfiguration(entry));
    return new TaxDiagnosticLedger(next);
  }
  *[Symbol.iterator](): IterableIterator<TaxCapabilityDiagnostic> { for (const [, value] of this.#index.entries()) yield value; }
}
