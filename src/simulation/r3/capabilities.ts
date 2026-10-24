import type { TaxOutputCapabilities } from "../tax/contracts.js";
import { createTaxDiagnosticKey, isTaxDiagnosticSnapshot } from "../tax/contracts.js";
import { immutableConfiguration } from "./compiledHousehold.js";
import type { PerformanceSession } from "../../diagnostics/performance.js";
import { PersistentStringIndex } from "../../state/index.js";

type Capability = TaxOutputCapabilities[string];

/** Exact first-appearance order and diagnostic equality, local to one run. */
export const createOutputCapabilityMerger = (performance?: PerformanceSession) => {
  type Entry = { readonly key: string; readonly value: Capability["diagnostics"][number] };
  type Sequence = {
    readonly entry: Entry | undefined;
    readonly previous: Sequence | undefined;
    readonly jumps: readonly Sequence[];
    readonly index: PersistentStringIndex<Entry>;
    readonly size: number;
  };
  const empty: Sequence = Object.freeze({ entry: undefined, previous: undefined, jumps: Object.freeze([]), index: new PersistentStringIndex<Entry>(), size: 0 });
  const sequences = new WeakMap<Capability, Sequence>();
  // Canonical cons nodes compare exact parent and exact interned entry identity.
  // Weak edges share live prefixes without retaining every historical branch.
  const children = new WeakMap<Sequence, WeakMap<Entry, WeakRef<Sequence>>>();
  const values = new WeakMap<Sequence, Map<string, Capability>>();
  const diagnosticKey = createTaxDiagnosticKey();
  const keys = new WeakMap<Capability["diagnostics"][number], string>();
  const diagnosticsByKey = new Map<string, Entry>();
  const diagnosticKeyLimit = 262144, arraySlotLimit = 4096;
  let diagnosticKeySize = 0, arraySlots = 0;
  const arrays = new Map<Sequence, Capability["diagnostics"]>();

  const append = (prior: Sequence, entry: Entry): Sequence => {
    if (prior.index.has(entry.key)) return prior;
    let next = children.get(prior);
    if (next === undefined) { next = new WeakMap<Entry, WeakRef<Sequence>>(); children.set(prior, next); }
    const cached = next.get(entry)?.deref();
    if (cached !== undefined) return cached;
    const index = prior.index.fork();
    index.set(entry.key, entry);
    const jumps: Sequence[] = [prior];
    for (let bit = 1; ; bit++) {
      const ancestor = jumps[bit - 1]!.jumps[bit - 1];
      if (ancestor === undefined) break;
      jumps.push(ancestor);
    }
    const sequence: Sequence = Object.freeze({ entry, previous: prior, jumps: Object.freeze(jumps), index, size: prior.size + 1 });
    // A diagnostic may stay in the bounded key cache after this branch dies.
    // Its key must not keep an otherwise unused child sequence alive.
    next.set(entry, new WeakRef(sequence));
    performance?.counters({ capabilitySequenceNodesCreated: 1 });
    return sequence;
  };
  const atDepth = (sequence: Sequence, depth: number): Sequence => {
    let result = sequence, distance = sequence.size - depth, bit = 0;
    while (distance > 0) {
      if (distance % 2 === 1) result = result.jumps[bit]!;
      distance = Math.floor(distance / 2); bit++;
      performance?.counters({ capabilityPrefixSearchSteps: 1 });
    }
    return result;
  };
  const commonPrefix = (left: Sequence, right: Sequence): Sequence => {
    let a = atDepth(left, Math.min(left.size, right.size));
    let b = atDepth(right, Math.min(left.size, right.size));
    if (a === b) return a;
    for (let bit = a.jumps.length - 1; bit >= 0; bit--) {
      const nextA = a.jumps[bit], nextB = b.jumps[bit];
      if (nextA !== undefined && nextB !== undefined && nextA !== nextB) { a = nextA; b = nextB; }
      performance?.counters({ capabilityPrefixSearchSteps: 1 });
    }
    return a.previous!;
  };
  const suffix = (sequence: Sequence, prefix: Sequence): Entry[] => {
    const entries: Entry[] = [];
    for (let node = sequence; node !== prefix; node = node.previous!) entries.push(node.entry!);
    return entries.reverse();
  };
  const materialize = (sequence: Sequence): Capability["diagnostics"] => {
    const cached = arrays.get(sequence);
    if (cached !== undefined) { arrays.delete(sequence); arrays.set(sequence, cached); return cached; }
    const result = Object.freeze(suffix(sequence, empty).map(entry => entry.value));
    performance?.counters({ capabilityDiagnosticArraysMaterialized: 1, capabilityMaterializationEntries: sequence.size });
    const slots = sequence.size + 1;
    if (slots <= arraySlotLimit) {
      while (arraySlots + slots > arraySlotLimit) {
        const oldest = arrays.keys().next().value!;
        arraySlots -= oldest.size + 1; arrays.delete(oldest);
      }
      arrays.set(sequence, result); arraySlots += slots;
    }
    performance?.counters({ capabilityDiagnosticArrayCacheSlots: arraySlots }, "max");
    return result;
  };
  const publish = (dependency: Capability["dependency"], status: Capability["status"], sequence: Sequence): Capability => {
    let variants = values.get(sequence);
    if (variants === undefined) { variants = new Map<string, Capability>(); values.set(sequence, variants); }
    const variant = `${dependency}:${status}`;
    let value = variants.get(variant);
    if (value === undefined) {
      value = Object.freeze({ dependency, status, get diagnostics() { return materialize(sequence); } });
      sequences.set(value, sequence); variants.set(variant, value);
      performance?.counters({ capabilityPublishedValuesCreated: 1 });
    }
    // Publishing is constant work: no full-history traversal or string signature.
    performance?.counters({ capabilityPublishCalls: 1 });
    return value;
  };
  const intern = (source: Capability): Capability => {
    let sequence = empty;
    for (const diagnostic of source.diagnostics) {
      // Memoize only deep snapshots created here. Shallow caller freezes do
      // not establish immutable nested source/provenance evidence.
      let equalityKey = keys.get(diagnostic);
      if (equalityKey === undefined) {
        equalityKey = diagnosticKey(diagnostic);
        if (isTaxDiagnosticSnapshot(diagnostic)) keys.set(diagnostic, equalityKey);
        performance?.counters({ capabilityDiagnosticKeysComputed: 1 });
      }
      let entry = diagnosticsByKey.get(equalityKey);
      if (entry === undefined) {
        const snapshot = immutableConfiguration(diagnostic);
        keys.set(snapshot, equalityKey);
        entry = Object.freeze({ key: equalityKey, value: snapshot });
        if (equalityKey.length <= diagnosticKeyLimit) {
          while (diagnosticKeySize + equalityKey.length > diagnosticKeyLimit) {
            const oldest = diagnosticsByKey.keys().next().value!;
            diagnosticKeySize -= oldest.length; diagnosticsByKey.delete(oldest);
          }
          diagnosticsByKey.set(equalityKey, entry); diagnosticKeySize += equalityKey.length;
        }
      } else { diagnosticsByKey.delete(equalityKey); diagnosticsByKey.set(equalityKey, entry); }
      sequence = append(sequence, entry);
      performance?.counters({ capabilityDiagnosticsVisited: 1 });
    }
    performance?.counters({ capabilityDiagnosticCacheKeyChars: diagnosticKeySize }, "max");
    return publish(source.dependency, source.status, sequence);
  };
  return (inputs: readonly (TaxOutputCapabilities | undefined)[]): TaxOutputCapabilities | undefined => {
    const result: Record<string, Capability> = {};
    const snapshots = new WeakMap<Capability, Capability>();
    const combined = new WeakMap<Capability, WeakMap<Capability, Capability>>();
    for (const input of inputs) for (const [field, source] of Object.entries(input ?? {})) {
      let value = snapshots.get(source);
      if (value === undefined) {
        value = sequences.has(source) ? source : performance === undefined ? intern(source) : performance.measure("engine.capabilities.normalize", () => intern(source));
        snapshots.set(source, value);
      }
      const prior = result[field];
      if (prior === undefined || prior === value) { result[field] = value; continue; }
      let nextForPrior = combined.get(prior);
      if (nextForPrior === undefined) { nextForPrior = new WeakMap<Capability, Capability>(); combined.set(prior, nextForPrior); }
      let merged = nextForPrior.get(value);
      if (merged === undefined) {
        const previous = sequences.get(prior)!, incoming = sequences.get(value)!;
        // Canonical prefixes allow unchanged/growing histories to skip all
        // shared diagnostics. Divergent histories still deduplicate exactly.
        const entries = suffix(incoming, commonPrefix(previous, incoming));
        let sequence = previous;
        for (const entry of entries) sequence = append(sequence, entry);
        performance?.counters({ capabilityMergeSuffixVisited: entries.length });
        merged = publish(prior.dependency === "tax_affected" || value.dependency === "tax_affected" ? "tax_affected" : "tax_independent",
          prior.status === "incomplete" || value.status === "incomplete" ? "incomplete" : "complete", sequence);
        nextForPrior.set(value, merged);
      }
      result[field] = merged;
    }
    return Object.keys(result).length === 0 ? undefined : Object.freeze(result);
  };
};

export const mergeOutputCapabilities = (inputs: readonly (TaxOutputCapabilities | undefined)[]): TaxOutputCapabilities | undefined =>
  createOutputCapabilityMerger()(inputs);
