import type { HouseholdWorkDescriptor } from "../intraperiodScheduler.js";
import { firstDependencyOrder, type OrderingEdge } from "./ordering.js";

export interface ReachableStateCounters {
  fallbackInvocations: number;
  distinctStates: number;
  mergedPrefixes: number;
  terminalOutcomes: number;
  maximumComponentSize: number;
}

export const createReachableStateCounters = (): ReachableStateCounters => ({
  fallbackInvocations: 0, distinctStates: 0, mergedPrefixes: 0,
  terminalOutcomes: 0, maximumComponentSize: 0,
});

/**
 * Exact prefix-state DAG, rather than a generator of complete linearizations.
 * The caller's key must establish identical future behavior AND accumulated
 * authoritative outcomes. In particular, balances alone are not a valid key.
 * A completed subtree can be shared only after all its branches succeeded.
 */
export const compareReachableStates = <State>(request: {
  readonly items: readonly HouseholdWorkDescriptor[];
  readonly edges: readonly OrderingEdge[];
  readonly opening: State;
  readonly advance: (state: State, item: HouseholdWorkDescriptor) => State;
  readonly equivalenceKey: (state: State) => string;
  readonly terminalSignature: (state: State) => string;
  readonly counters: ReachableStateCounters;
}): { readonly first: readonly HouseholdWorkDescriptor[] | undefined; readonly differs: boolean } => {
  const first = firstDependencyOrder(request.items, request.edges);
  if (first === undefined) return { first, differs: false };
  request.counters.fallbackInvocations += 1;
  request.counters.maximumComponentSize = Math.max(request.counters.maximumComponentSize, request.items.length);
  const items = [...request.items].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const ids = new Set(items.map(item => item.id));
  const predecessors = new Map<string, string[]>();
  for (const edge of request.edges) {
    if (!ids.has(edge.before) || !ids.has(edge.after)) continue;
    const incoming = predecessors.get(edge.after) ?? [];
    incoming.push(edge.before); predecessors.set(edge.after, incoming);
  }
  const completed = new Map<string, Set<string>>();
  let signature: string | undefined;
  let differs = false;
  const visit = (state: State, remaining: ReadonlySet<string>): void => {
    const subset = JSON.stringify(items.filter(item => remaining.has(item.id)).map(item => item.id));
    const key = request.equivalenceKey(state);
    const keys = completed.get(subset) ?? new Set<string>();
    if (keys.has(key)) { request.counters.mergedPrefixes += 1; return; }
    request.counters.distinctStates += 1;
    if (remaining.size === 0) {
      request.counters.terminalOutcomes += 1;
      const next = request.terminalSignature(state);
      if (signature === undefined) signature = next;
      else if (signature !== next) differs = true;
    } else {
      for (const item of items) {
        if (!remaining.has(item.id) || (predecessors.get(item.id) ?? []).some(id => remaining.has(id))) continue;
        const nextRemaining = new Set(remaining); nextRemaining.delete(item.id);
        visit(request.advance(state, item), nextRemaining);
      }
    }
    // Even after detecting sensitivity, drain distinct branches: the frozen
    // executor gives any dependency-valid hard failure precedence over policy.
    keys.add(key); completed.set(subset, keys);
  };
  visit(request.opening, ids);
  return { first, differs };
};
