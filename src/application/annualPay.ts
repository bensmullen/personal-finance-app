import type { CompiledCashFlow } from "./compiler/cashFlow.js";
import type { PortableModelEnvelope } from "../model/modelVersion.js";
import { evaluatePrimitive, primitiveEvaluationContext } from "../primitives/index.js";
import { domainId } from "../identity/index.js";
import { instant, utcCalendarMonthDifference } from "../time/index.js";
import { Money, RateBasis, RoundingPolicy } from "../values/index.js";
import { monthlyOccurrences, objects } from "./compiler/shared.js";

/** Reuse D1 recurrence and P08 growth; this read model posts no money or usage. */
export function projectAnnualPay(model: PortableModelEnvelope, input: CompiledCashFlow["input"], personId: string, year: number, sponsorId?: string) {
  const start = instant(`${year}-01-01T00:00:00.000Z`), end = instant(`${year + 1}-01-01T00:00:00.000Z`);
  const salaries = input.incomes.filter(stream => stream.ownerId === personId && objects(model, "Income").some(source => source.income_id === stream.id && source.income_type === "salary" && source.gross_or_net !== "net") &&
    (sponsorId === undefined || stream.payrollContributions?.some(allocation => allocation.policy.limits.some(binding => binding.kind === "401k_additions" && binding.bucketKey === `401k_additions:${sponsorId}`))));
  let total = Money.zero(input.baseCurrency);
  const occurrences: { incomeId: string; date: string; amount: string; sourceIds: readonly string[] }[] = [];
  for (const stream of salaries) {
    const stop = stream.terminationEventId && input.events.find(event => event.id === stream.terminationEventId)?.effectiveAt;
    const activate = stream.activationEventId && input.events.find(event => event.id === stream.activationEventId)?.effectiveAt;
    for (const date of monthlyOccurrences(stream.recurrence.anchor, stream.end, start, end)) {
      if (date < stream.start || stop && date >= stop || activate && date < activate) continue;
      const months = utcCalendarMonthDifference(stream.growthBaseAt, date);
      const context = primitiveEvaluationContext({ period: { start, end }, evaluationInstant: date,
        scenarioId: domainId("scenario", String(objects(model, "Scenario").find(item => item.enabled === true && item.base_scenario_id == null)?.scenario_id)),
        primitiveInstanceId: stream.primitiveIds.growth, economicTargetId: stream.id, semanticEffectType: "annual-pay-read-model", traceRefs: stream.sourceTraceRefs ?? [] });
      const growth = evaluatePrimitive({ primitiveId: "P08", input: { initial: stream.baseMonthlyAmount, rate: stream.growthRate }, priorState: null,
        parameters: { category: "recurring_occurrence_amount", timeBasis: stream.growthRate.convention.basis === RateBasis.Periodic ? { kind: "per_period", periods: months }
          : { kind: "effective_annual", yearFraction: { numerator: months, denominator: 12 }, calculationRounding: new RoundingPolicy(18, "half_even") } }, context });
      const amount = growth.output.value.round(RoundingPolicy.currency(input.baseCurrency.minorUnitScale, "half_even"));
      if (!amount.isPositive()) continue;
      total = total.plus(amount);
      occurrences.push({ incomeId: String(stream.id), date, amount: amount.amount.toString(), sourceIds: [String(stream.id), String(stream.primitiveIds.growth), String(stream.primitiveIds.recurrence)] });
    }
  }
  return Object.freeze({ personId, year, ...(sponsorId === undefined ? {} : { sponsorId }), status: salaries.length ? "derived" as const : "missing" as const,
    ...(salaries.length ? { amount: total.amount.toString() } : {}), currency: input.baseCurrency.code,
    basis: "modeled_gross_salary_occurrences" as const, ruleVersion: "D1:P03:P08:monthly/v1", occurrences: Object.freeze(occurrences) });
}
