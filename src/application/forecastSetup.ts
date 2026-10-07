import type { PersonalDraft, JsonObject } from "./personalMvp.js";

const isObject = (value: unknown): value is JsonObject => value !== null && typeof value === "object" && !Array.isArray(value);

export function currentPlan(model: PersonalDraft): JsonObject | undefined {
  const roots = (model.objects.Scenario ?? []).filter(isObject).filter(item => item.enabled === true && item.base_scenario_id == null);
  return roots.length === 1 ? roots[0] : undefined;
}

export function simulationWindowProblem(model: PersonalDraft, start: string, end: string): string | undefined {
  const plan = currentPlan(model);
  if (!plan) return "Choose one enabled Current Plan before configuring the simulation window.";
  if (typeof plan.start_date === "string" && start < plan.start_date)
    return `Simulation start ${start} is before Current plan start ${plan.start_date}. Extend the Current Plan or choose a later simulation start.`;
  if (typeof plan.end_date === "string" && end > plan.end_date)
    return `Simulation end ${end} exceeds Current plan end ${plan.end_date}. Extend Current plan end to include the requested simulation window.`;
  return undefined;
}
