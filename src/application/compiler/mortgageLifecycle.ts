import type { JsonValue, PortableModelEnvelope } from "../../model/modelVersion.js";
import { createMortgageLifecycleParticipant, type MortgageRefinance } from "../../simulation/mortgageLifecycle.js";
import type { HouseholdKernelParticipant } from "../../simulation/householdExecution.js";
import type { VerticalSlice4Input } from "../../simulation/verticalSlice4.js";
import { instant, utcMonthlyOccurrences, utcMonthlyPeriods } from "../../time/index.js";
import { decimal } from "../../values/index.js";
import { EXACT_DECIMAL, UUID, capability, generatedCompilerIds, objects, utcDate } from "./shared.js";
import type { CompileResult } from "./types.js";

const record = (value: unknown): value is Readonly<Record<string, JsonValue>> => typeof value === "object" && value !== null && !Array.isArray(value);
export interface AuthoredRefinance { readonly eventId: string; readonly effectId: string; readonly primitiveId: string; readonly liabilityId: string; readonly date: string; readonly annualRate: string; readonly totalPayments: number }
export interface AuthoredMortgageExtra extends Omit<AuthoredRefinance, "annualRate" | "totalPayments"> { readonly amount: string; readonly fundingAccountId: string }
export const authorMortgageExtra = (model: PortableModelEnvelope, plan: AuthoredMortgageExtra): PortableModelEnvelope => {
  if (!UUID.test(plan.fundingAccountId) || !EXACT_DECIMAL.test(plan.amount) || !decimal(plan.amount).isPositive()) throw new Error("Enter positive extra principal and an explicit checking/savings source.");
  const saved = authorMortgageRefinance(model, { ...plan, annualRate: "0", totalPayments: 1 });
  return { ...saved, objects: { ...saved.objects,
    Event: objects(saved, "Event").map(item => item.event_id === plan.eventId ? { ...item, name: "Mortgage extra principal" } : item),
    EventEffect: objects(saved, "EventEffect").map(item => item.event_effect_id === plan.effectId ? { ...item, operation: "d1_mortgage_extra" } : item),
    PrimitiveInstance: objects(saved, "PrimitiveInstance").map(item => item.primitive_instance_id === plan.primitiveId ? { ...item, parameters: { adapter: "d1-mortgage-extra/v1", liabilityId: plan.liabilityId, amount: plan.amount, fundingAccountId: plan.fundingAccountId } } : item),
  } };
};
export const durableMortgageExtras = (model: PortableModelEnvelope, scenarioId: string): readonly { readonly liabilityId: string; readonly id: string; readonly scheduledAt: string; readonly amount: string; readonly fundingAccountId: string }[] => objects(model, "Event").flatMap(event => {
  if (event.enabled !== true || event.scenario_id !== scenarioId || !Array.isArray(event.effect_ids)) return [];
  const effectIds = event.effect_ids;
  return effectIds.flatMap(effectId => {
    const effect = objects(model, "EventEffect").find(item => item.event_effect_id === effectId);
    if (effect?.operation !== "d1_mortgage_extra") return [];
    const primitive = objects(model, "PrimitiveInstance").find(item => item.primitive_instance_id === effect.primitive_instance_id), terms = primitive?.parameters;
    if (!primitive || primitive.enabled !== true || primitive.scenario_id !== scenarioId || !record(terms) || terms.adapter !== "d1-mortgage-extra/v1" || event.trigger_type !== "scheduled" || event.trigger_condition != null || event.probability_model_id != null || event.end_date != null || effectIds.length !== 1 || !utcDate(event.start_date) || typeof terms.liabilityId !== "string" || effect.target_entity_id !== terms.liabilityId || typeof terms.amount !== "string" || typeof terms.fundingAccountId !== "string") throw new Error("Extra principal requires one scheduled mortgage operation with explicit amount and bank funding.");
    return [{ liabilityId: terms.liabilityId, id: String(event.event_id), scheduledAt: String(event.start_date), amount: terms.amount, fundingAccountId: terms.fundingAccountId }];
  });
});
export const authorMortgageRefinance = (model: PortableModelEnvelope, plan: AuthoredRefinance): PortableModelEnvelope => {
  if (![plan.eventId, plan.effectId, plan.primitiveId, plan.liabilityId].every(id => UUID.test(id)) || !utcDate(plan.date) || !EXACT_DECIMAL.test(plan.annualRate) || decimal(plan.annualRate).isNegative() || !Number.isSafeInteger(plan.totalPayments) || plan.totalPayments <= 0) throw new Error("REFINANCE_TERMS_INVALID");
  const roots = objects(model, "Scenario").filter(item => item.enabled === true && item.base_scenario_id == null);
  if (roots.length !== 1) throw new Error("REFINANCE_ROOT_REQUIRED");
  for (const [type, field, id] of [["Event", "event_id", plan.eventId], ["EventEffect", "event_effect_id", plan.effectId], ["PrimitiveInstance", "primitive_instance_id", plan.primitiveId]] as const)
    if (objects(model, type).some(item => item[field] === id)) throw new Error("REFINANCE_ID_COLLISION");
  return { ...model, objects: { ...model.objects,
    Event: [...objects(model, "Event"), { event_id: plan.eventId, name: "Mortgage refinance", event_type: "other", start_date: plan.date, trigger_type: "scheduled", effect_ids: [plan.effectId], dependencies: [], precedence: 0, scenario_id: String(roots[0]!.scenario_id), enabled: true }],
    EventEffect: [...objects(model, "EventEffect"), { event_effect_id: plan.effectId, target_entity_type: "Liability", target_entity_id: plan.liabilityId, operation: "d1_refinance", primitive_instance_id: plan.primitiveId }],
    PrimitiveInstance: [...objects(model, "PrimitiveInstance"), { primitive_instance_id: plan.primitiveId, primitive_id: "P22", enabled: true, scenario_id: String(roots[0]!.scenario_id), input_bindings: {}, parameters: { adapter: "d1-refinance/v1", liabilityId: plan.liabilityId, annualRate: plan.annualRate, totalPayments: plan.totalPayments } }],
    Scenario: objects(model, "Scenario").map(item => item === roots[0] ? { ...item, event_ids: [...new Set([...(Array.isArray(item.event_ids) ? item.event_ids : []), plan.eventId])] } : item),
  } };
};

export const compileMortgageLifecycle = (model: PortableModelEnvelope, input: VerticalSlice4Input | undefined, scenarioId: string, start: string, end: string): CompileResult<HouseholdKernelParticipant | undefined> => {
  try {
    const candidates = objects(model, "Event").flatMap(event => {
      if (event.enabled !== true || event.scenario_id !== scenarioId || !Array.isArray(event.effect_ids)) return [];
      return event.effect_ids.flatMap(id => {
        const effect = objects(model, "EventEffect").find(item => item.event_effect_id === id);
        return effect?.operation === "d1_refinance" ? [{ event, effect }] : [];
      });
    });
    if (!candidates.length) return { status: "compiled", value: undefined, diagnostics: [] };
    if (!input) throw new Error("Configure the old mortgage's scheduled payments before adding a refinance.");
    const slots = candidates.flatMap(({ event }) => ["replacement", "principal", "interest", "schedule", "amortization", "accrual"].map(suffix => String(event.event_id) + ":" + suffix));
    const ids = generatedCompilerIds(model, slots, "f16d0000-0000-4000-8001-");
    if (ids.status !== "compiled") return ids;
    const plans: MortgageRefinance[] = [], sources = new Set<string>();
    for (const { event, effect } of candidates) {
      const terms = objects(model, "PrimitiveInstance").find(item => item.primitive_instance_id === effect.primitive_instance_id);
      const parameters = terms?.parameters, at = utcDate(event.start_date);
      if (!terms || terms.enabled !== true || terms.scenario_id !== scenarioId || !record(parameters) || parameters.adapter !== "d1-refinance/v1" || !Array.isArray(event.effect_ids) || event.effect_ids.length !== 1 || event.trigger_type !== "scheduled" || event.probability_model_id != null || event.trigger_condition != null || event.end_date != null || Array.isArray(event.dependencies) && event.dependencies.length) throw new Error("Refinance requires one deterministic scheduled operation.");
      const loan = input.loans.find(item => item.principalLiabilityId === parameters.liabilityId);
      if (!loan || effect.target_entity_id !== parameters.liabilityId || !at || at < instant(start + "T00:00:00.000Z") || at >= instant(end + "T00:00:00.000Z")) throw new Error("Select an existing supported mortgage and a refinance date within the forecast.");
      if (sources.has(loan.id)) throw new Error("The refinance floor admits one replacement per original mortgage.");
      sources.add(loan.id);
      const firstMonth = instant(loan.paymentSchedule.anchor.slice(0, 8) + "01T00:00:00.000Z");
      const occurrences = utcMonthlyPeriods(firstMonth, loan.totalPayments * 2).flatMap(period => utcMonthlyOccurrences(loan.paymentSchedule.anchor, period, "skip")).slice(0, loan.totalPayments);
      if (!occurrences.includes(at)) throw new Error("Choose a scheduled monthly payment date for refinance. Off-cycle closings require unsupported daily/stub-period interest.");
      if (loan.extraPrincipalPayments?.some(extra => extra.scheduledAt === at)) throw new Error("Choose either extra principal or refinance at this payment occurrence.");
      if (typeof parameters.annualRate !== "string" || !EXACT_DECIMAL.test(parameters.annualRate) || decimal(parameters.annualRate).isNegative() || typeof parameters.totalPayments !== "number" || !Number.isSafeInteger(parameters.totalPayments) || parameters.totalPayments <= 0) throw new Error("Enter a fixed nominal annual rate and positive monthly term.");
      // Preserve the old contract's day, and require the immediately following full calendar month.
      const nextMonth = utcMonthlyPeriods(instant(at.slice(0, 8) + "01T00:00:00.000Z"), 2)[1]!;
      const firstPayment = instant(nextMonth.start.slice(0, 8) + at.slice(8));
      if (Number(firstPayment.slice(5, 7)) !== Number(nextMonth.start.slice(5, 7)) || !utcDate(firstPayment.slice(0, 10))) throw new Error("Choose a payment boundary whose next month supports the same payment day; odd first periods are unavailable.");
      const id = String(event.event_id), generated = (suffix: string) => ids.value.get(id + ":" + suffix)!;
      plans.push({ id, at, oldLoan: loan, annualRate: parameters.annualRate, totalPayments: parameters.totalPayments, firstPayment, replacementId: generated("replacement"), principalId: generated("principal"), interestId: generated("interest"), primitiveIds: { schedule: generated("schedule"), amortization: generated("amortization"), accrual: generated("accrual") } });
    }
    return { status: "compiled", value: createMortgageLifecycleParticipant({ householdId: input.householdId, ownerId: input.ownerId, currency: input.baseCurrency.code, refinances: plans }), diagnostics: [] };
  } catch (error) { return { status: "unsupported", diagnostics: [capability("MORTGAGE_REFINANCE_UNSUPPORTED", error instanceof Error ? error.message : "Refinance terms are incomplete.", "liability_forecast")] }; }
};
