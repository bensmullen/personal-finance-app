import type { PortableModelEnvelope } from "../../model/modelVersion.js";
import {
  capability,
  canonicalId,
  issue,
  objects,
  preflightCanonicalCollections,
  utcDate,
  UUID,
  type CanonicalObject,
} from "./shared.js";
import type { CompileResult } from "./types.js";

export const SYNTHETIC_ROOT_SCENARIO_ID =
  "f15c0000-0000-4000-8000-000000000001";

export interface SelectedScenario {
  readonly id: string;
  readonly object?: CanonicalObject;
}

export interface ScenarioSelectionContext {
  readonly capabilityName: string;
  readonly executionLabel: string;
  readonly scenarioId?: string;
  readonly simulationStart?: string;
  readonly simulationEnd?: string;
}

const invalid = (
  code: string,
  message: string,
  entityId?: string,
  fieldPath?: string,
  relatedIds?: readonly string[],
): CompileResult<never> => ({
  status: "invalid_model",
  diagnostics: Object.freeze([
    issue(code, message, "Scenario", entityId, fieldPath, relatedIds),
  ]),
});

/** Selects only an executable root. Child alternatives are bound after base compilation. */
export const selectScenario = (
  model: PortableModelEnvelope,
  context: ScenarioSelectionContext = {
    capabilityName: "cash_flow_forecast",
    executionLabel: "Cash-flow",
  },
): CompileResult<SelectedScenario> => {
  const unsupported = (
    code: string,
    message: string,
    entityId?: string,
    fieldPath?: string,
    relatedIds?: readonly string[],
  ): CompileResult<never> => ({
    status: "unsupported",
    diagnostics: Object.freeze([
      capability(
        code,
        message,
        context.capabilityName,
        "Scenario",
        entityId,
        fieldPath,
        relatedIds,
      ),
    ]),
  });
  const preflight = preflightCanonicalCollections(model, [
    "Scenario",
    "Event",
    "Assumption",
  ]);
  if (preflight.status !== "compiled") return preflight;
  const scenarios = objects(model, "Scenario");
  if (scenarios.length === 0) {
    if (context.scenarioId !== undefined)
      return unsupported(
        "SCENARIO_BASE_MISSING",
        `Scenario ${context.scenarioId} was requested but the model has no canonical Scenarios.`,
        context.scenarioId,
        "scenarioId",
      );
    return {
      status: "compiled",
      value: Object.freeze({ id: SYNTHETIC_ROOT_SCENARIO_ID }),
      diagnostics: Object.freeze([]),
    };
  }

  const byId = new Map<string, CanonicalObject>();
  for (const scenario of scenarios) {
    const id = canonicalId(scenario, "scenario_id");
    if (!id)
      return invalid(
        "SCENARIO_ID_INVALID",
        "Scenario identity must be a UUID.",
        undefined,
        "scenario_id",
      );
    if (byId.has(id))
      return invalid(
        "DUPLICATE_EXECUTABLE_IDENTITY",
        `Duplicate Scenario identity ${id}.`,
        id,
        "scenario_id",
      );
    byId.set(id, scenario);
    if (
      typeof scenario.enabled !== "boolean" ||
      typeof scenario.stochastic !== "boolean"
    )
      return invalid(
        "SCENARIO_SELECTION_FIELD_INVALID",
        `Scenario ${id} enabled and stochastic must be booleans.`,
        id,
      );
    if (
      !(["daily", "monthly", "quarterly", "annual"] as const).includes(
        scenario.timestep as never,
      )
    )
      return invalid(
        "SCENARIO_TIMESTEP_INVALID",
        `Scenario ${id} timestep is not a canonical value.`,
        id,
        "timestep",
      );
    if (
      scenario.simulation_count !== undefined &&
      (typeof scenario.simulation_count !== "number" ||
        !Number.isSafeInteger(scenario.simulation_count) ||
        scenario.simulation_count <= 0)
    )
      return invalid(
        "SCENARIO_SIMULATION_COUNT_INVALID",
        `Scenario ${id} simulation_count must be a positive safe integer when present.`,
        id,
        "simulation_count",
      );
    const start = utcDate(scenario.start_date);
    const end = utcDate(scenario.end_date);
    if (!start || !end || start >= end)
      return invalid(
        "SCENARIO_TEMPORAL_INVALID",
        `Scenario ${id} requires valid ordered start_date and end_date.`,
        id,
        "start_date",
      );
    const base = scenario.base_scenario_id;
    if (
      base !== undefined &&
      base !== null &&
      (typeof base !== "string" || !UUID.test(base))
    )
      return invalid(
        "BASE_SCENARIO_REFERENCE_INVALID",
        `Scenario ${id} base_scenario_id must be a UUID.`,
        id,
        "base_scenario_id",
      );
    for (const [field, collection, idField] of [
      ["event_ids", "Event", "event_id"],
      ["assumption_ids", "Assumption", "assumption_id"],
    ] as const) {
      const refs = scenario[field];
      if (refs === null)
        return unsupported(
          `SCENARIO_${field === "event_ids" ? "EVENT" : "ASSUMPTION"}_MEMBERSHIP_UNKNOWN`,
          `Scenario ${id} ${field} membership is unknown.`,
          id,
          field,
        );
      if (refs !== undefined && !Array.isArray(refs))
        return invalid(
          "SCENARIO_REFERENCES_INVALID",
          `Scenario ${id} ${field} must be an array.`,
          id,
          field,
        );
      for (const ref of (refs ?? []) as readonly unknown[]) {
        if (typeof ref !== "string" || !UUID.test(ref))
          return invalid(
            "SCENARIO_REFERENCE_INVALID",
            `Scenario ${id} contains a malformed ${field} reference.`,
            id,
            field,
          );
        if (
          !objects(model, collection).some(
            (item) => canonicalId(item, idField) === ref.toLowerCase(),
          )
        )
          return invalid(
            "SCENARIO_REFERENCE_NOT_FOUND",
            `Scenario ${id} reference ${ref} does not resolve.`,
            id,
            field,
            [ref.toLowerCase()],
          );
      }
    }
  }

  for (const [id, scenario] of byId) {
    if (
      scenario.base_scenario_id === undefined ||
      scenario.base_scenario_id === null
    )
      continue;
    const baseId = String(scenario.base_scenario_id).toLowerCase();
    const parent = byId.get(baseId);
    if (!parent)
      return invalid(
        "BASE_SCENARIO_REFERENCE_NOT_FOUND",
        `Scenario ${id} base_scenario_id does not resolve.`,
        id,
        "base_scenario_id",
        [baseId],
      );
    if (baseId === id)
      return invalid(
        "SCENARIO_SELF_INHERITANCE_INVALID",
        `Scenario ${id} cannot inherit from itself.`,
        id,
        "base_scenario_id",
        [id],
      );
    if (
      scenario.timestep !== parent.timestep ||
      scenario.start_date !== parent.start_date ||
      scenario.end_date !== parent.end_date
    )
      return unsupported(
        "SCENARIO_CHILD_DEFINITION_INCOMPATIBLE",
        `Scenario ${id} horizon and timestep must match its parent ${baseId}.`,
        id,
        "base_scenario_id",
        [baseId],
      );
  }
  for (const id of byId.keys()) {
    const visiting = new Set<string>();
    let cursor: string | undefined = id;
    while (cursor !== undefined) {
      if (visiting.has(cursor))
        return invalid(
          "SCENARIO_INHERITANCE_CYCLE",
          `Scenario inheritance cycle includes ${cursor}.`,
          cursor,
          "base_scenario_id",
          [...visiting, cursor],
        );
      visiting.add(cursor);
      const parent: unknown = byId.get(cursor)?.base_scenario_id;
      cursor = typeof parent === "string" ? parent.toLowerCase() : undefined;
    }
  }

  let selected: CanonicalObject | undefined;
  if (context.scenarioId !== undefined) {
    if (!UUID.test(context.scenarioId))
      return invalid(
        "SCENARIO_BASE_ID_INVALID",
        "Requested base scenarioId must be a UUID.",
        context.scenarioId,
        "scenarioId",
      );
    selected = byId.get(context.scenarioId.toLowerCase());
    if (!selected)
      return unsupported(
        "SCENARIO_BASE_MISSING",
        `Requested base Scenario ${context.scenarioId} does not resolve.`,
        context.scenarioId,
        "scenarioId",
      );
    if (
      selected.base_scenario_id !== undefined &&
      selected.base_scenario_id !== null
    )
      return unsupported(
        "SCENARIO_CHILD_AS_BASE_UNSUPPORTED",
        `Scenario ${context.scenarioId} is a child alternative and cannot be compiled as the authoritative base.`,
        context.scenarioId,
        "base_scenario_id",
      );
    if (selected.enabled !== true)
      return unsupported(
        "SCENARIO_BASE_DISABLED",
        `Scenario ${context.scenarioId} is disabled.`,
        context.scenarioId,
        "enabled",
      );
  } else {
    const roots = scenarios.filter(
      (item) =>
        item.enabled === true &&
        (item.base_scenario_id === undefined || item.base_scenario_id === null),
    );
    if (roots.length !== 1)
      return unsupported(
        roots.length === 0
          ? "SCENARIO_BASE_MISSING"
          : "SCENARIO_BASE_AMBIGUOUS",
        `${context.executionLabel} compilation requires one enabled root Scenario; found ${roots.length}.`,
      );
    selected = roots[0];
  }
  const id = canonicalId(selected!, "scenario_id")!;
  if (selected!.stochastic === true)
    return unsupported(
      "SCENARIO_STOCHASTIC_UNSUPPORTED",
      `Scenario ${id} is stochastic and cannot be executed by ${context.executionLabel}.`,
      id,
      "stochastic",
    );
  if (selected!.timestep !== "monthly")
    return unsupported(
      "SCENARIO_TIMESTEP_UNSUPPORTED",
      `Scenario ${id} timestep ${String(selected!.timestep)} is not supported.`,
      id,
      "timestep",
    );
  if ((selected!.simulation_count ?? 1) !== 1)
    return unsupported(
      "SCENARIO_MULTI_REALIZATION_UNSUPPORTED",
      `Scenario ${id} requests multiple realizations.`,
      id,
      "simulation_count",
    );
  if (
    context.simulationStart !== undefined &&
    context.simulationEnd !== undefined
  ) {
    const requestedStart = utcDate(context.simulationStart);
    const requestedEnd = utcDate(context.simulationEnd);
    const rootStart = utcDate(selected!.start_date)!;
    const rootEnd = utcDate(selected!.end_date)!;
    if (
      requestedStart &&
      requestedEnd &&
      (requestedStart < rootStart || requestedEnd > rootEnd)
    )
      return unsupported(
        "SCENARIO_OUTSIDE_REQUESTED_HORIZON",
        `Requested horizon must be contained by root Scenario ${id}.`,
        id,
        "start_date",
      );
  }
  return {
    status: "compiled",
    value: Object.freeze({ id, object: selected! }),
    diagnostics: Object.freeze([]),
  };
};
