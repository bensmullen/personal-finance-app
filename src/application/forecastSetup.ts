import type { PersonalDraft, JsonObject } from "./personalMvp.js";
import { utcDate, UUID } from "./compiler/shared.js";

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

/** Creation-time Scenario dates are changed only by creating a replacement root. */
export function replaceCurrentPlanHorizon(model: PersonalDraft, replacementId: string, start: string, end: string, window: { start: string; end: string }, retirementDates: readonly string[] = []): PersonalDraft {
  const plan = currentPlan(model);
  if (!plan) throw new Error("Choose one enabled Current Plan first.");
  if (!UUID.test(replacementId) || (model.objects.Scenario ?? []).filter(isObject).some(item => typeof item.scenario_id === "string" && item.scenario_id.toLowerCase() === replacementId.toLowerCase())) throw new Error("Replacement plan requires a new identity.");
  if (!utcDate(start) || !utcDate(end) || start >= end) throw new Error("Current Plan requires valid increasing dates.");
  if (!utcDate(window.start) || !utcDate(window.end) || window.start >= window.end || window.start < start || window.end > end) throw new Error("Correct Simulation dates to fit the proposed Current Plan before applying plan dates.");
  const oldId = plan.scenario_id;
  const belongs = (value: unknown) => typeof value === "string" && typeof oldId === "string" && value.toLowerCase() === oldId.toLowerCase();
  if ((model.objects.Scenario ?? []).filter(isObject).some(item => belongs(item.base_scenario_id))) throw new Error("This plan has alternatives. Remove or export those alternatives before changing Current Plan dates; their horizons cannot be changed in place.");
  const dates = [...retirementDates, ...(model.objects.Event ?? []).filter(isObject).filter(item => belongs(item.scenario_id) && item.enabled === true && item.event_type === "retirement").map(item => String(item.start_date))];
  if (dates.some(date => date < start || date >= end)) throw new Error("Correct retirement dates to fit the proposed Current Plan before applying plan dates.");
  const replacement = { ...plan, scenario_id: replacementId.toLowerCase(), start_date: start, end_date: end };
  const objects = Object.fromEntries(Object.entries(model.objects).map(([type, entries]) => [type, entries.map(item => {
    if (!isObject(item)) return item;
    if (type === "Scenario") return item === plan ? { ...item, enabled: false, assumption_ids: [], event_ids: [] } : item;
    return belongs(item.scenario_id) ? { ...item, scenario_id: replacement.scenario_id } : item;
  })]));
  return { ...model, objects: { ...objects, Scenario: [...objects.Scenario ?? [], replacement] } };
}
