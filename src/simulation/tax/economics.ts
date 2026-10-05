import { PersistentStringIndex } from "../../state/index.js";
import { canonicalSerialize } from "../run.js";
import { immutableConfiguration } from "../r3/compiledHousehold.js";
import type { RecognizedTaxEconomics } from "./contracts.js";

/** Persistent annual recognition index: observation copies a logarithmic path, not the prior year. */
export class TaxEconomicLedger {
  readonly #index: PersistentStringIndex<RecognizedTaxEconomics>;
  declare readonly canonicalEntries: readonly RecognizedTaxEconomics[];
  private constructor(index: PersistentStringIndex<RecognizedTaxEconomics>) {
    this.#index = index;
    // Canonical serialization sees sorted economic values, independent of operation order.
    Object.defineProperty(this, "canonicalEntries", { enumerable: true, get: () => [...this] });
    Object.freeze(this);
  }
  static empty(): TaxEconomicLedger { return new TaxEconomicLedger(new PersistentStringIndex<RecognizedTaxEconomics>()); }
  get size(): number { return this.#index.size; }
  with(entries: readonly RecognizedTaxEconomics[]): TaxEconomicLedger {
    const next = this.#index.fork();
    for (const entry of entries) {
      const key = canonicalSerialize({ source: entry.sourceId, at: entry.at, facts: entry.facts, allocation: entry.allocation });
      next.set(key, immutableConfiguration(entry));
    }
    return new TaxEconomicLedger(next);
  }
  *[Symbol.iterator](): IterableIterator<RecognizedTaxEconomics> { for (const [, value] of this.#index.entries()) yield value; }
  some(predicate: (entry: RecognizedTaxEconomics) => boolean): boolean { for (const entry of this) if (predicate(entry)) return true; return false; }
}
