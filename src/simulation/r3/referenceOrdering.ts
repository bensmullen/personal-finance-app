import type { HouseholdWorkDescriptor } from "../intraperiodScheduler.js";
import type { OrderingEdge } from "./ordering.js";

/** Bounded test oracle only. Production must use analytical proofs / reachable states. */
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
