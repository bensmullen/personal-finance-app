import type { HouseholdWorkDescriptor } from "../intraperiodScheduler.js";
import type { Instant } from "../../time/index.js";

export interface OrderingEdge { readonly before: string; readonly after: string }

/** Contention proofs still visit every valid order, but retain only the current order. */
export function* dependencyOrders(
  items: readonly HouseholdWorkDescriptor[], edges: readonly OrderingEdge[],
): Generator<readonly HouseholdWorkDescriptor[]> {
  const byId = new Map(items.map(item => [item.id, item]));
  const predecessors = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!byId.has(edge.before) || !byId.has(edge.after)) continue;
    const incoming = predecessors.get(edge.after) ?? new Set<string>();
    incoming.add(edge.before); predecessors.set(edge.after, incoming);
  }
  const ids = [...byId.keys()].sort();
  const remaining = new Set(ids);
  const order: HouseholdWorkDescriptor[] = [];
  function* visit(): Generator<readonly HouseholdWorkDescriptor[]> {
    if (remaining.size === 0) { yield Object.freeze([...order]); return; }
    for (const id of ids) {
      if (!remaining.has(id) || [...(predecessors.get(id) ?? [])].some(before => remaining.has(before))) continue;
      remaining.delete(id); order.push(byId.get(id)!);
      yield* visit();
      order.pop(); remaining.add(id);
    }
  }
  yield* visit();
}

/** Adjacency is built once; each source's reachability is memoized for this immutable graph. */
export const indexReachability = (edges: readonly OrderingEdge[]) => {
  const next = new Map<string, string[]>();
  for (const edge of edges) {
    const successors = next.get(edge.before) ?? [];
    successors.push(edge.after); next.set(edge.before, successors);
  }
  const cache = new Map<string, ReadonlySet<string>>();
  return (from: string, to: string): boolean => {
    let reached = cache.get(from);
    if (reached === undefined) {
      const seen = new Set<string>(); const pending = [...(next.get(from) ?? [])];
      while (pending.length > 0) {
        const current = pending.pop()!;
        if (seen.has(current)) continue;
        seen.add(current); pending.push(...(next.get(current) ?? []));
      }
      reached = seen; cache.set(from, reached);
    }
    return reached.has(to);
  };
};

/** Same lexical first topological order as exhaustive enumeration, without enumerating its tail. */
export const firstDependencyOrder = (
  items: readonly HouseholdWorkDescriptor[], edges: readonly OrderingEdge[],
): readonly HouseholdWorkDescriptor[] | undefined => {
  const byId = new Map(items.map(item => [item.id, item]));
  const predecessors = new Map<string, Set<string>>();
  const successors = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!byId.has(edge.before) || !byId.has(edge.after)) continue;
    const before = predecessors.get(edge.after) ?? new Set<string>();
    before.add(edge.before); predecessors.set(edge.after, before);
    const after = successors.get(edge.before) ?? new Set<string>();
    after.add(edge.after); successors.set(edge.before, after);
  }
  const ready = [...byId.keys()].filter(id => (predecessors.get(id)?.size ?? 0) === 0).sort();
  const result: HouseholdWorkDescriptor[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!; result.push(byId.get(id)!);
    for (const after of successors.get(id) ?? []) {
      const incoming = predecessors.get(after)!; incoming.delete(id);
      if (incoming.size === 0) {
        let index = 0;
        while (index < ready.length && ready[index]! < after) index += 1;
        ready.splice(index, 0, after);
      }
    }
  }
  return result.length === items.length ? Object.freeze(result) : undefined;
};

export const indexSequencingInstants = (descriptors: readonly HouseholdWorkDescriptor[]) => {
  const groups = new Map<Instant, HouseholdWorkDescriptor[]>();
  for (const descriptor of descriptors) {
    const group = groups.get(descriptor.sequencingInstant) ?? [];
    group.push(descriptor); groups.set(descriptor.sequencingInstant, group);
  }
  return Object.freeze([...groups.keys()].sort().map(at => Object.freeze({
    at, descriptors: Object.freeze(groups.get(at)!),
  })));
};
