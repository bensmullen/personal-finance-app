import { addPersonalObject, type PersonalDraft, type JsonObject } from "./personalMvp.js";
import { utcDate, UUID } from "./compiler/shared.js";
import { decimal } from "../values/index.js";

const isObject = (value: unknown): value is JsonObject => value !== null && typeof value === "object" && !Array.isArray(value);

/** Explicit acceptance in Life Events, one event and binding per salary. */
export function acceptRetirementProposal(model: PersonalDraft, personId: string, date: string, eventIds: readonly string[]): PersonalDraft {
  const plan = currentPlan(model);
  if (!plan || !utcDate(date) || date < String(plan.start_date) || date >= String(plan.end_date)) throw new Error("Choose a retirement date within Current Plan dates.");
  const incomes = (model.objects.Income ?? []).filter(isObject).filter(income => income.owner_id === personId && income.income_type === "salary");
  if (!incomes.length || incomes.some(income => income.related_event_id != null || income.end_date != null || date <= String(income.start_date)) || eventIds.length !== incomes.length || new Set(eventIds).size !== eventIds.length || eventIds.some(id => !UUID.test(id) || (model.objects.Event ?? []).filter(isObject).some(event => event.event_id === id))) throw new Error("Review existing income end dates and retirement decisions first.");
  let next = model;
  next = { ...next, objects: { ...next.objects, Event: [...(next.objects.Event ?? []), ...incomes.map((income, index) => ({
    event_id: eventIds[index]!, name: `Accepted retirement · ${String(income.source)}`, event_type: "retirement", start_date: date, trigger_type: "scheduled", enabled: true,
    effect_ids: [], dependencies: [], precedence: 0, scenario_id: plan.scenario_id!,
  }))] } };
  return { ...next, objects: { ...next.objects,
    Income: (next.objects.Income ?? []).map(value => {
      if (!isObject(value)) return value;
      const index = incomes.findIndex(income => income.income_id === value.income_id);
      return index < 0 ? value : { ...value, related_event_id: eventIds[index]! };
    }),
    Scenario: (next.objects.Scenario ?? []).map(value => isObject(value) && value.scenario_id === plan.scenario_id ? { ...value, event_ids: [...(Array.isArray(value.event_ids) ? value.event_ids : []), ...eventIds] } : value),
  } };
}

export interface PlanningStarters { inflation?: string; wages?: string; portfolio?: string; reserveMonths?: string }
/** Called only after acceptance for a new plan. Existing links/categories win. */
export function acceptPlanningStarters(model: PersonalDraft, values: PlanningStarters, id: () => string): PersonalDraft {
  const plan = currentPlan(model);
  if (!plan) throw new Error("Create Current Plan dates before accepting starting points.");
  let next = model;
  for (const [key, category, collection, link, primitive] of [
    ["inflation", "inflation", "Expense", "growth_model_id", "P08"],
    ["wages", "salary_growth", "Income", "growth_model_id", "P08"],
    ["portfolio", "market_return", "Investment", "return_model_id", "P23"],
    ["reserveMonths", "other", "", "", ""],
  ] as const) {
    const value = values[key];
    if (value === undefined) continue;
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) || (key === "reserveMonths" ? !/^\d+$/.test(value) : decimal(value).compare(decimal("-1")) <= 0)) throw new Error("Use an exact annual rate greater than -100%, or a whole nonnegative number of reserve months.");
    if ((next.objects.Assumption ?? []).filter(isObject).some(item => item.scenario_id === plan.scenario_id && (key === "reserveMonths" ? item.name === "Essential-expense reserve goal" : item.category === category))) continue;
    const assumptionId = id(), primitiveId = id();
    next = addPersonalObject(next, "Assumption", assumptionId, { name: key === "reserveMonths" ? "Essential-expense reserve goal" : `Accepted starting point · ${category}`, category, value,
      unit: key === "reserveMonths" ? "months of essential expenses (goal only; no transfers)" : "effective annual rate", scenario_id: plan.scenario_id!, start_date: plan.start_date! });
    next = { ...next, objects: { ...next.objects,
      Scenario: (next.objects.Scenario ?? []).map(item => isObject(item) && item.scenario_id === plan.scenario_id ? { ...item, assumption_ids: [...(Array.isArray(item.assumption_ids) ? item.assumption_ids : []), assumptionId] } : item),
    } };
    if (!collection) continue;
    if (!UUID.test(primitiveId) || (next.objects.PrimitiveInstance ?? []).filter(isObject).some(item => item.primitive_instance_id === primitiveId)) throw new Error("Starting point requires a unique primitive identity.");
    next = { ...next, objects: { ...next.objects, PrimitiveInstance: [...(next.objects.PrimitiveInstance ?? []), { primitive_instance_id: primitiveId, primitive_id: primitive, input_bindings: { rate: assumptionId }, parameters: {}, scenario_id: plan.scenario_id!, enabled: true }] } };
    next = { ...next, objects: { ...next.objects,
      [collection]: (next.objects[collection] ?? []).map(item => isObject(item) && item[link] == null && (collection !== "Income" || item.income_type === "salary") && (collection !== "Investment" || item.investment_type === "fund") ? { ...item, [link]: primitiveId } : item),
    } };
  }
  return next;
}

export function currentPlan(model: PersonalDraft): JsonObject | undefined {
  const roots = (model.objects.Scenario ?? []).filter(isObject).filter(item => item.enabled === true && item.base_scenario_id == null);
  return roots.length === 1 ? roots[0] : undefined;
}

export function simulationWindowProblem(model: PersonalDraft, start: string, end: string): string | undefined {
  if (!utcDate(start) || !utcDate(end) || start >= end) return "Choose valid Simulation dates with end after start.";
  if (!start.endsWith("-01") || !end.endsWith("-01")) return "Choose Simulation dates on the first day of a month.";
  const plan = currentPlan(model);
  if (!plan) return "Choose one enabled Current Plan before configuring the simulation window.";
  if (typeof plan.start_date === "string" && start < plan.start_date)
    return `Simulation start ${start} is before Current plan start ${plan.start_date}. Extend the Current Plan or choose a later simulation start.`;
  if (typeof plan.end_date === "string" && end > plan.end_date)
    return `Simulation end ${end} exceeds Current plan end ${plan.end_date}. Extend Current plan end to include the requested simulation window.`;
  return undefined;
}

/** Creation-time Scenario dates are changed only by creating a replacement root. */
export function replaceCurrentPlanHorizon(model: PersonalDraft, replacementId: string, start: string, end: string, runWindow: { start: string; end: string }, retirementDates: readonly string[] = []): PersonalDraft {
  const plan = currentPlan(model);
  if (!plan) throw new Error("Choose one enabled Current Plan first.");
  if (!UUID.test(replacementId) || (model.objects.Scenario ?? []).filter(isObject).some(item => typeof item.scenario_id === "string" && item.scenario_id.toLowerCase() === replacementId.toLowerCase())) throw new Error("Replacement plan requires a new identity.");
  if (!utcDate(start) || !utcDate(end) || start >= end) throw new Error("Current Plan requires valid increasing dates.");
  if (!utcDate(runWindow.start) || !utcDate(runWindow.end) || runWindow.start >= runWindow.end || runWindow.start < start || runWindow.end > end) throw new Error("Correct Simulation dates to fit the proposed Current Plan before applying plan dates.");
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


export type Normalization = { readonly ok: true; readonly canonical: string; readonly unit: string } | { readonly ok: false; readonly reason: string };
/** String/decimal arithmetic only. This adapter never edits imported JSON. */
export function normalizePersonalInput(raw: string, kind: "money" | "decimal" | "percent" | "date" | "month", currency?: string): Normalization {
  let text = raw.trim();
  const fail = (reason: string): Normalization => ({ ok: false, reason });
  if (kind === "date" || kind === "month") {
    if (kind === "month") {
      const named = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})$/i.exec(text);
      if (named) text = `${named[2]}-${String(["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].indexOf(named[1]!.toLowerCase()) + 1).padStart(2, "0")}`;
      const numeric = /^(\d{1,2})[/-](\d{4})$/.exec(text);
      if (numeric) text = `${numeric[2]}-${numeric[1]!.padStart(2, "0")}`;
      return /^\d{4}-(0[1-9]|1[0-2])$/.test(text) ? { ok: true, canonical: text, unit: "calendar month" } : fail("Use YYYY-MM, MM/YYYY or a full month name and year.");
    }
    const local = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    if (local) {
      const a = Number(local[1]), b = Number(local[2]);
      if (a <= 12 && b <= 12 && a !== b) return fail("Ambiguous day/month order. Use YYYY-MM-DD.");
      const month = a > 12 ? b : a, day = a > 12 ? a : b;
      text = `${local[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return fail("Use an unambiguous full date, YYYY-MM-DD.");
    const date = new Date(`${text}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? { ok: true, canonical: text, unit: "date" } : fail("This calendar date does not exist.");
  }
  if (kind === "percent" && text.endsWith("%")) text = text.slice(0, -1).trim();
  if (kind === "money") {
    const marker = /^(USD|EUR|GBP|\$|€|£)\s*/.exec(text);
    if (marker) {
      const represented = ({ "$": "USD", "€": "EUR", "£": "GBP" } as Record<string, string>)[marker[1]!] ?? marker[1];
      if (!currency || represented !== currency) return fail("The currency must match the field's explicit currency.");
      text = text.slice(marker[0].length);
    }
  }
  if (text.includes(",")) {
    if (!/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text)) return fail("Ambiguous grouping or decimal separator. Use a decimal point and groups of three digits.");
    text = text.replaceAll(",", "");
  }
  if (!/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) return fail("Use one exact decimal; mixed units and scientific notation are unsupported.");
  try {
    const value = decimal(text);
    if (kind === "money" && !value.fitsScale(2)) return fail("Enter exact cents; extra precision cannot be silently rounded.");
    return { ok: true, canonical: text.startsWith("+") ? text.slice(1) : text, unit: kind === "percent" ? "% (percentage points; canonical rate conversion is unchanged)" : kind === "money" ? currency ?? "recorded currency" : "recorded decimal unit" };
  } catch { return fail("This amount cannot be represented exactly."); }
}
