import { patchPersonalObject, type PersonalDraft, type JsonObject } from "./personalMvp.js";

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

export function editCurrentPlanHorizon(model: PersonalDraft, start: string, end: string): PersonalDraft {
  const plan = currentPlan(model);
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!plan || !validDate(start) || !validDate(end) || start >= end) throw new Error("Enter increasing Current Plan dates.");
  const retirement = (model.objects.Event ?? []).filter(isObject).find(item => item.event_type === "retirement" && item.enabled === true && item.scenario_id === plan.scenario_id && typeof item.start_date === "string" && (item.start_date < start || item.start_date >= end));
  if (retirement) throw new Error("The planned retirement date must remain within the Current Plan horizon. Extend the plan to include it; it may be outside the simulation window.");
  return patchPersonalObject(model, "Scenario", String(plan.scenario_id), { start_date: start, end_date: end });
}
