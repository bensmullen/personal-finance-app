/** Deterministic zero-lag dependency graph. Lagged edges cross a prior-state boundary. */
export class DependencyGraph {
  private readonly edges = new Map<string, Set<string>>();

  addNode(id: string): void {
    if (!this.edges.has(id)) this.edges.set(id, new Set());
  }

  addEdge(from: string, to: string, lag = 0): void {
    this.addNode(from);
    this.addNode(to);
    if (lag === 0) this.edges.get(from)!.add(to);
  }

  topologicalOrder(): string[] {
    const indegree = new Map([...this.edges.keys()].map((key) => [key, 0]));
    for (const targets of this.edges.values()) {
      for (const target of targets) indegree.set(target, (indegree.get(target) ?? 0) + 1);
    }
    const ready = [...indegree].filter(([, degree]) => degree === 0).map(([key]) => key).sort();
    const output: string[] = [];
    while (ready.length > 0) {
      const node = ready.shift()!;
      output.push(node);
      for (const target of this.edges.get(node)!) {
        const degree = indegree.get(target)! - 1;
        indegree.set(target, degree);
        if (degree === 0) {
          ready.push(target);
          ready.sort();
        }
      }
    }
    if (output.length !== indegree.size) throw new Error("Invalid zero-lag dependency cycle");
    return output;
  }
}
