import type { PortableModelEnvelope } from "../../model/modelVersion.js";
import { canonicalId, objects, preflightCanonicalCollections, utcDate } from "./shared.js";
import type { RetirementTerminationBinding } from "./cashFlow.js";

/** Canonical retirement dates are durable; execution bindings are a derived adapter. */
export const deriveCanonicalRetirementBindings = (model: PortableModelEnvelope, scenarioId: string, prior: readonly RetirementTerminationBinding[] = []): readonly RetirementTerminationBinding[] => {
  const result = new Map(prior.map(binding => [binding.incomeId.toLowerCase(), binding]));
  const scenario = objects(model, "Scenario").find(item => canonicalId(item, "scenario_id") === scenarioId);
  for (const income of objects(model, "Income")) {
    const id = canonicalId(income, "income_id");
    const eventId = canonicalId(income, "related_event_id");
    const event = objects(model, "Event").find(item => canonicalId(item, "event_id") === eventId);
    if (!id || !eventId || !event || event.enabled !== true || event.event_type !== "retirement" || event.trigger_type !== "scheduled" ||
      String(event.scenario_id).toLowerCase() !== scenarioId || !Array.isArray(scenario?.event_ids) || !scenario.event_ids.some(value => typeof value === "string" && value.toLowerCase() === eventId) || !utcDate(event.start_date)) continue;
    const existing = result.get(id);
    if (existing && existing.canonicalEventId?.toLowerCase() !== eventId) continue;
    let hash = 14695981039346656037n;
    for (const character of `${id}:${eventId}`) hash = BigInt.asUintN(64, (hash ^ BigInt(character.codePointAt(0)!)) * 1099511628211n);
    const terminationEventId = existing?.terminationEventId ?? `d1000000-0000-4000-8e01-${(hash & 0xffffffffffffn).toString(16).padStart(12, "0")}`;
    result.set(id, Object.freeze({ incomeId: id, canonicalEventId: eventId, terminationEventId, baselineDate: String(event.start_date) }));
  }
  return Object.freeze([...result.values()].sort((a, b) => a.incomeId.localeCompare(b.incomeId)));
};

export const authorCanonicalRetirementDate = (model: PortableModelEnvelope, incomeId: string, date: string): PortableModelEnvelope => {
  const preflight = preflightCanonicalCollections(model, ["Income", "Event", "Scenario"]);
  if (preflight.status !== "compiled") throw new Error(preflight.diagnostics.map(diagnostic => diagnostic.code).join(","));
  if (!utcDate(date)) throw new Error("RETIREMENT_DATE_INVALID");
  const income = objects(model, "Income").find(item => canonicalId(item, "income_id") === incomeId.toLowerCase());
  const eventId = income && canonicalId(income, "related_event_id");
  const event = objects(model, "Event").find(item => canonicalId(item, "event_id") === eventId);
  if (!event || event.enabled !== true || event.event_type !== "retirement" || event.trigger_type !== "scheduled" ||
    event.probability_model_id != null || event.trigger_condition != null || event.duration_days != null || event.end_date != null ||
    (Array.isArray(event.effect_ids) && event.effect_ids.length) || (Array.isArray(event.dependencies) && event.dependencies.length) || (event.precedence != null && event.precedence !== 0)) throw new Error("RETIREMENT_AUTHORING_UNSUPPORTED");
  if (income?.end_date != null) throw new Error("RETIREMENT_INDEPENDENT_INCOME_END_UNSUPPORTED");
  const roots = objects(model, "Scenario").filter(item => item.enabled === true && item.base_scenario_id == null);
  if (roots.length !== 1 || canonicalId(roots[0]!, "scenario_id") !== String(event.scenario_id).toLowerCase() || !Array.isArray(roots[0]!.event_ids) || !roots[0]!.event_ids.some(value => typeof value === "string" && value.toLowerCase() === eventId)) throw new Error("RETIREMENT_BASELINE_RELATIONSHIP_UNSUPPORTED");
  return Object.freeze({ ...model, objects: Object.freeze({ ...model.objects, Event: Object.freeze(objects(model, "Event").map(item => canonicalId(item, "event_id") === eventId ? Object.freeze({ ...item, start_date: date }) : item)) }) });
};

export const canonicalRetirementPlans = (model: PortableModelEnvelope): readonly { readonly incomeId: string; readonly label: string; readonly date: string }[] => {
  const roots = objects(model, "Scenario").filter(item => item.enabled === true && item.base_scenario_id == null);
  if (roots.length !== 1) return Object.freeze([]);
  const bindings = deriveCanonicalRetirementBindings(model, String(roots[0]!.scenario_id));
  return Object.freeze(bindings.map(binding => {
    const income = objects(model, "Income").find(item => canonicalId(item, "income_id") === binding.incomeId);
    return Object.freeze({ incomeId: binding.incomeId, label: String(income?.source ?? "Income"), date: binding.baselineDate });
  }));
};
