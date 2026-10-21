import type { TaxOutputCapabilities } from "../tax/contracts.js";
import { createTaxDiagnosticKey } from "../tax/contracts.js";
import { immutableConfiguration } from "./compiledHousehold.js";
import type { PerformanceSession } from "../../diagnostics/performance.js";
import { PersistentStringIndex } from "../../state/index.js";

type Capability = TaxOutputCapabilities[string];

/**
 * Merge exactly as before (first appearance orders keys; last value wins), but preserve
 * one immutable value/diagnostic array for fields sharing the same inputs.
 * Payroll and annual-tax projections often expose the same diagnostic set
 * across dozens of affected outputs; separately serializing and allocating
 * that set for every field on every month exhausts long-horizon forecasts.
 *
 * Caches are local to this calculation. No cross-run mutable identity or capability
 * state is retained; published results remain frozen and structurally equal.
 */
export const createOutputCapabilityMerger = (performance?: PerformanceSession) => {
  const published = new WeakSet<Capability>();
  const diagnosticKey = createTaxDiagnosticKey();
  const keys = new WeakMap<Capability["diagnostics"][number], string>();
  const key = (diagnostic: Capability["diagnostics"][number]) => {
    let value = keys.get(diagnostic);
    // Only our own deep snapshots are safe to memoize. A frozen outer object
    // alone does not prove that its caller-owned nested provenance is immutable.
    if (value === undefined) value = diagnosticKey(diagnostic);
    return value;
  };
  // Repeated annual projections create equal objects with different identities.
  // Pairwise WeakMap hits alone cannot share those histories across months.
  // Intern by exact equality, including complete provenance, within this run.
  type InternedDiagnostic = { readonly id: number; readonly key: string; readonly value: Capability["diagnostics"][number] };
  type Node = { readonly entry: InternedDiagnostic; readonly previous: Node | undefined };
  type Sequence = { readonly tail: Node | undefined; readonly index: PersistentStringIndex<InternedDiagnostic>; readonly size: number };
  const sequences = new WeakMap<Capability, Sequence>();
  const empty: Sequence = { tail: undefined, index: new PersistentStringIndex<InternedDiagnostic>(), size: 0 };
  const entriesOf = (sequence: Sequence): InternedDiagnostic[] => {
    const entries: InternedDiagnostic[] = [];
    for (let node = sequence.tail; node !== undefined; node = node.previous) entries.push(node.entry);
    return entries.reverse();
  };
  const extend = (prior: Sequence, entries: readonly InternedDiagnostic[]): Sequence => {
    let tail = prior.tail, index = prior.index, size = prior.size;
    for (const entry of entries) {
      if (index.has(entry.key)) continue;
      if (index === prior.index) index = prior.index.fork();
      index.set(entry.key, entry);
      tail = Object.freeze({ entry, previous: tail });
      size++;
      performance?.counters({ capabilitySequenceNodesCreated: 1 });
    }
    return size === prior.size ? prior : Object.freeze({ tail, index, size });
  };
  const diagnosticsByKey = new Map<string, InternedDiagnostic>();
  const histories = new Map<string, Capability>();
  // Bound retained cache work by size, not just entry count: unique growing
  // prefixes otherwise retain a quadratic number of diagnostic references.
  // Eviction affects sharing only; published periods keep every diagnostic.
  const historySlotLimit = 4096, diagnosticKeyLimit = 262144;
  let historySlots = 0, diagnosticKeySize = 0, nextId = 0;
  const arrays = new Map<Sequence, Capability["diagnostics"]>();
  let arraySlots = 0;
  const materialize = (sequence: Sequence): Capability["diagnostics"] => {
    const cached = arrays.get(sequence);
    if (cached !== undefined) {
      arrays.delete(sequence); arrays.set(sequence, cached);
      return cached;
    }
    const value = Object.freeze(entriesOf(sequence).map(entry => entry.value));
    performance?.counters({ capabilityDiagnosticArraysMaterialized: 1 });
    const slots = sequence.size + 1;
    if (slots <= historySlotLimit) {
      while (arraySlots + slots > historySlotLimit) {
        const oldest = arrays.keys().next().value!;
        arraySlots -= oldest.size + 1;
        arrays.delete(oldest);
      }
      arrays.set(sequence, value);
      arraySlots += slots;
    }
    performance?.counters({ capabilityDiagnosticArrayCacheSlots: arraySlots }, "max");
    return value;
  };
  const report = () => performance?.counters({
    capabilityHistoryCacheSlots: historySlots,
    capabilityDiagnosticCacheKeyChars: diagnosticKeySize,
  }, "max");
  const publish = (dependency: Capability["dependency"], status: Capability["status"], sequence: Sequence): Capability => {
    const signature = JSON.stringify([dependency, status, entriesOf(sequence).map(entry => entry.id)]);
    let value = histories.get(signature);
    if (value === undefined) {
      // Growing periods share persistent nodes and membership indexes. The
      // public property is still a complete frozen array, materialized only
      // at read/serialization boundaries with bounded optional array caching.
      value = Object.freeze({ dependency, status, get diagnostics() { return materialize(sequence); } });
      published.add(value);
      sequences.set(value, sequence);
      const slots = sequence.size + 1;
      if (slots <= historySlotLimit) {
        while (historySlots + slots > historySlotLimit) {
          const oldest = histories.keys().next().value!;
          historySlots -= sequences.get(histories.get(oldest)!)!.size + 1;
          histories.delete(oldest);
        }
        histories.set(signature, value);
        historySlots += slots;
      }
    } else {
      histories.delete(signature);
      histories.set(signature, value);
    }
    report();
    return value;
  };
  const intern = (dependency: Capability["dependency"], status: Capability["status"], diagnostics: Capability["diagnostics"]): Capability => {
    const distinct = new Map<string, InternedDiagnostic>();
    for (const diagnostic of diagnostics) {
      const equalityKey = key(diagnostic);
      let entry = diagnosticsByKey.get(equalityKey);
      if (entry === undefined) {
        // Compare before copying. Repeated annual projections share exact
        // source/provenance snapshots rather than cloning a growing history.
        const snapshot = immutableConfiguration(diagnostic);
        keys.set(snapshot, equalityKey);
        entry = { id: nextId++, key: equalityKey, value: snapshot };
        if (equalityKey.length <= diagnosticKeyLimit) {
          while (diagnosticKeySize + equalityKey.length > diagnosticKeyLimit) {
            const oldest = diagnosticsByKey.keys().next().value!;
            diagnosticKeySize -= oldest.length;
            diagnosticsByKey.delete(oldest);
          }
          diagnosticsByKey.set(equalityKey, entry);
          diagnosticKeySize += equalityKey.length;
        }
      } else {
        diagnosticsByKey.delete(equalityKey);
        diagnosticsByKey.set(equalityKey, entry);
      }
      distinct.set(equalityKey, entry);
    }
    performance?.counters({ capabilityDiagnosticsVisited: diagnostics.length });
    return publish(dependency, status, extend(empty, [...distinct.values()]));
  };
  return (inputs: readonly (TaxOutputCapabilities | undefined)[]): TaxOutputCapabilities | undefined => {
    const result: Record<string, Capability> = {};
    const snapshots = new WeakMap<Capability, Capability>();
    // Pair reuse is useful across fields within a merge, not a reason to keep
    // every pair of historical prefixes alive for the lifetime of a run.
    const combined = new WeakMap<Capability, WeakMap<Capability, Capability>>();
    for (const input of inputs) for (const [field, source] of Object.entries(input ?? {})) {
      let value = snapshots.get(source);
      if (value === undefined) {
        value = published.has(source) ? source : intern(source.dependency, source.status, source.diagnostics);
        snapshots.set(source, value);
      }
      const prior = result[field];
      if (prior === undefined) {
        result[field] = value;
      } else if (prior === value) {
        result[field] = prior;
      } else {
        let nextForPrior = combined.get(prior);
        if (nextForPrior === undefined) {
          nextForPrior = new WeakMap<Capability, Capability>();
          combined.set(prior, nextForPrior);
        }
        let merged = nextForPrior.get(value);
        if (merged === undefined) {
          const priorSequence = sequences.get(prior)!, nextSequence = sequences.get(value)!;
          merged = publish(
            prior.dependency === "tax_affected" || value.dependency === "tax_affected" ? "tax_affected" : "tax_independent",
            prior.status === "incomplete" || value.status === "incomplete" ? "incomplete" : "complete",
            extend(priorSequence, entriesOf(nextSequence)),
          );
          nextForPrior.set(value, merged);
        }
        result[field] = merged;
      }
    }
    return Object.keys(result).length === 0 ? undefined : Object.freeze(result);
  };
};

export const mergeOutputCapabilities = (inputs: readonly (TaxOutputCapabilities | undefined)[]): TaxOutputCapabilities | undefined =>
  createOutputCapabilityMerger()(inputs);
