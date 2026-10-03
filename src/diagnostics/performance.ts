export const PERFORMANCE_PHASES = Object.freeze([
  "current_snapshot.total",
  "forecast.total",
  "compile.model_and_slices",
  "compile.opening_reconciliation",
  "compile.household_invariants",
  "engine.compile_invariants",
  "engine.fingerprint",
  "engine.prepare",
  "engine.schedule_contention",
  "engine.execute",
  "engine.statements_metrics",
  "engine.trace_result",
  "application.read_model",
  "transport.serialization",
  "ui.react_commit",
  "ui.chart_render",
  "ui.explanation_resolution",
] as const);

export type PerformancePhase = (typeof PERFORMANCE_PHASES)[number];
export type PerformanceAvailability = "measured" | "unavailable" | "not_applicable" | "not_implemented" | "not_measured";
export type ExecutionLocation = "browser_main" | "browser_worker" | "local_node" | "server" | "cloud";

export interface PerformanceContext {
  readonly runId: string;
  readonly fixtureId?: string;
  readonly dataClassification: "synthetic" | "user";
  readonly modelCounts: Readonly<Record<string, number>>;
  readonly horizon?: Readonly<{ readonly start: string; readonly end: string }>;
  readonly modelVersion?: string;
  readonly specificationVersion?: string;
  readonly engineVersion?: string;
  readonly executionLocation: ExecutionLocation;
  readonly runtime?: string;
  readonly browser?: string;
  readonly cacheState: "not_applicable" | "hit" | "miss";
  readonly workerConcurrency?: number;
  readonly stochasticRealizations?: number;
  readonly status?: "completed" | "incomplete" | "unavailable" | "error";
  readonly reachedThrough?: string;
  readonly scalingDimensions?: Readonly<{ horizonMonths: number; recurringOperationCount: number; modelEntityCount: number }>;
}

export interface PerformanceResources {
  /** Aggregate diagnostic execution CPU where measurable, never authoritative. */
  readonly cpuTimeMs?: number;
  /** Absolute representative/sampled heap; a signed delta belongs in memoryDeltaBytes. */
  readonly memoryBytes?: number;
  readonly memoryDeltaBytes?: number;
  readonly concurrency?: number;
  readonly throughputPerSecond?: number;
  readonly billingUnits?: Readonly<Record<string, string>>;
  readonly metering: "not_metered" | "metered" | "unavailable";
}

export interface PerformanceRecord {
  readonly phase: PerformancePhase;
  readonly availability: PerformanceAvailability;
  readonly durationMs?: number;
  readonly context: PerformanceContext;
  readonly resources?: PerformanceResources;
  readonly completedAt?: string;
}

export interface PerformanceClock { now(): number }
export interface PerformanceSink { record(measurement: PerformanceRecord): void }
export interface PerformanceObserver {
  readonly clock: PerformanceClock;
  readonly sink: PerformanceSink;
  readonly context: PerformanceContext;
}

export interface PerformanceSession {
  measure<T>(phase: PerformancePhase, operation: () => T): T;
  add(phase: PerformancePhase, durationMs: number): void;
  finish(resources?: PerformanceResources): void;
}

const safeNow = (clock: PerformanceClock): number | undefined => {
  try {
    const value = clock.now();
    return Number.isFinite(value) ? value : undefined;
  } catch { return undefined; }
};

export const createPerformanceSession = (observer?: PerformanceObserver): PerformanceSession => {
  const totals = new Map<PerformancePhase, number>();
  const attempted = new Set<PerformancePhase>();
  const unavailable = new Set<PerformancePhase>();
  let finished = false;
  const add = (phase: PerformancePhase, durationMs: number): void => {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    const total = (totals.get(phase) ?? 0) + durationMs;
    if (Number.isFinite(total)) totals.set(phase, total);
    else unavailable.add(phase);
  };
  return Object.freeze({
    measure<T>(phase: PerformancePhase, operation: () => T): T {
      if (observer === undefined) return operation();
      attempted.add(phase);
      const started = safeNow(observer.clock);
      try { return operation(); }
      finally {
        const ended = safeNow(observer.clock);
        if (started !== undefined && ended !== undefined && ended >= started) add(phase, ended - started);
        else unavailable.add(phase);
      }
    },
    add,
    finish(resources?: PerformanceResources): void {
      if (finished || observer === undefined) return;
      finished = true;
      for (const phase of new Set([...attempted, ...totals.keys()])) {
        const durationMs = unavailable.has(phase) ? undefined : totals.get(phase);
        try {
          observer.sink.record(Object.freeze({
            phase,
            availability: durationMs === undefined ? "unavailable" : "measured",
            ...(durationMs === undefined ? {} : { durationMs }),
            context: observer.context,
            ...(resources === undefined ? {} : { resources }),
          }));
        } catch { /* Diagnostics must never enter financial control flow. */ }
      }
    },
  });
};

export interface PerformanceSummary {
  readonly latest: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  readonly count: number;
  readonly context: PerformanceContext;
  readonly contexts: readonly PerformanceContext[];
}

export class PerformanceRegistry implements PerformanceSink {
  readonly #limit: number;
  readonly #records = new Map<PerformancePhase, PerformanceRecord[]>();
  constructor(limit = 100) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Performance registry limit must be positive.");
    this.#limit = limit;
  }
  record(measurement: PerformanceRecord): void {
    const current = this.#records.get(measurement.phase) ?? [];
    current.push(Object.freeze({ ...measurement }));
    if (current.length > this.#limit) current.splice(0, current.length - this.#limit);
    this.#records.set(measurement.phase, current);
  }
  latest(phase: PerformancePhase): PerformanceRecord | undefined {
    return this.#records.get(phase)?.at(-1);
  }
  records(phase: PerformancePhase): readonly PerformanceRecord[] {
    return Object.freeze([...(this.#records.get(phase) ?? [])]);
  }
  summary(phase: PerformancePhase): PerformanceSummary | undefined {
    const measured = (this.#records.get(phase) ?? []).filter((record) => record.availability === "measured" && record.durationMs !== undefined && Number.isFinite(record.durationMs) && record.durationMs >= 0);
    const values = measured.map((record) => record.durationMs!);
    if (values.length === 0) return undefined;
    const sorted = [...values].sort((a, b) => a - b);
    const percentile = (ratio: number) => sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)]!;
    return Object.freeze({ latest: values.at(-1)!, p50: percentile(0.5), p95: percentile(0.95), max: sorted.at(-1)!, count: values.length, context: measured.at(-1)!.context, contexts: Object.freeze(measured.map((record) => record.context)) });
  }
  clear(): void { this.#records.clear(); }
}

export const createUnavailablePerformanceRecord = (
  phase: PerformancePhase,
  availability: Exclude<PerformanceAvailability, "measured">,
  context: PerformanceContext,
): PerformanceRecord => Object.freeze({ phase, availability, context });
