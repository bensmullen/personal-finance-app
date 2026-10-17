import type { Money } from "../../../values/index.js";
import type { TaxCoreResult } from "../contracts.js";
import type { CapitalResult } from "./capital.js";
import type { LossSale, Replacement, WashResult } from "./wash.js";
import { canonical, complete, contextIssues, day, diagnostic, incomplete, ruleFingerprint, sum, trace, validMoney, type Context, type Outcome, type Predicate } from "./common.js";

export interface HarvestProposal {
  readonly id: string;
  readonly sales: readonly LossSale[];
  readonly replacements: readonly Replacement[];
  readonly grossProceeds: Money;
  readonly disposalCosts: Money;
  readonly replacementCosts: Money;
  readonly exposureChange: string;
  readonly exposureAcknowledged: Predicate;
}
/** Adapter contract: caller supplies authoritative evaluated results, never rates. */
export interface AuthoritativeEvaluation {
  readonly resultId: string;
  readonly complete: boolean;
  readonly tax: Pick<TaxCoreResult, "totalLiability" | "catalogFingerprint" | "appliedRules" | "traceRefs">;
  readonly capital: Outcome<CapitalResult>;
  readonly context: Context;
  readonly periodStart: string;
  readonly periodEndExclusive: string;
  readonly horizonEndExclusive: string;
  readonly evaluatedThrough: string;
  readonly inputCoverageFingerprint: string;
  readonly unchangedFactsFingerprint: string;
  readonly scenarioId: string;
  readonly activityFingerprint: string;
  /** Authoritative engine receipt binding the capital state used for liability. */
  readonly capitalResultIdentity: string;
  readonly sources: readonly string[];
}
export interface HarvestInput {
  readonly context: Context;
  readonly proposal: HarvestProposal;
  readonly wash: Outcome<WashResult>;
  readonly baseline: AuthoritativeEvaluation;
  readonly candidate: AuthoritativeEvaluation;
  readonly expectedBaselineActivityFingerprint: string;
  readonly expectedBaselineScenarioId: string;
  readonly expectedCandidateScenarioId: string;
  readonly householdCoverageFingerprint: string;
}
export interface HarvestResult {
  readonly proposalId: string;
  readonly grossProceeds: Money;
  readonly netDisposalProceeds: Money;
  readonly eligibleCurrentLoss: Money;
  readonly blockedCurrentLoss: Money;
  readonly realizedShort: Money;
  readonly realizedLong: Money;
  readonly transactionCosts: Money;
  readonly currentYearTaxReduction: Money;
  readonly currentYearReductionAfterCosts: Money;
  readonly baselineCarryover: CapitalResult["closing"];
  readonly candidateCarryover: CapitalResult["closing"];
  readonly futureValue: "unvalued_requires_future_authoritative_gains_and_tax_evaluation";
  readonly exposureChange: string;
  readonly evaluationIds: readonly string[];
}
export const harvestActivityFingerprint = (proposal: HarvestProposal): string => `t1b:proposal:${canonical(proposal)}`;

export const evaluateHarvest = (input: HarvestInput): Outcome<HarvestResult> => {
  const t = trace(input.context, input, "harvest"), issues = contextIssues(input.context);
  const { baseline: b, candidate: c, proposal: p, wash: w } = input;
  if (!p.id || !p.sales.length || !p.exposureChange || p.exposureAcknowledged.value !== true || !p.exposureAcknowledged.evidence.length) issues.push(diagnostic("PROPOSAL_OR_EXPOSURE_INCOMPLETE", "harvest"));
  if (!validMoney([p.grossProceeds, p.disposalCosts, p.replacementCosts], true)) issues.push(diagnostic("PROPOSAL_MONEY_INVALID", "harvest", "invalid"));
  if (new Set(p.sales.map(s => s.id)).size !== p.sales.length || new Set(p.sales.map(s => s.lot)).size !== p.sales.length) issues.push(diagnostic("SELECTED_LOT_DUPLICATE", "harvest", "invalid"));
  for (const e of [b, c]) {
    if (!e.complete || e.capital.status !== "complete" || !e.resultId || !e.tax.catalogFingerprint || !e.tax.appliedRules.length || !e.tax.traceRefs.length || !e.sources.length) issues.push(diagnostic("AUTHORITATIVE_TAX_RESULT_INCOMPLETE", "tax_delta"));
    if (canonical(e.context) !== canonical(input.context) || !validMoney([e.tax.totalLiability], true)) issues.push(diagnostic("TAX_CONTEXT_MISMATCH", "tax_delta"));
    if (e.periodStart !== `${input.context.taxYear}-01-01` || e.periodEndExclusive !== `${input.context.taxYear + 1}-01-01`) issues.push(diagnostic("TAX_PERIOD_STALE", "tax_delta"));
    if (e.inputCoverageFingerprint !== input.householdCoverageFingerprint || !e.inputCoverageFingerprint || !e.unchangedFactsFingerprint) issues.push(diagnostic("INPUT_COVERAGE_MISMATCH", "tax_delta"));
    if (e.capital.status === "complete" && (e.capital.value.taxYear !== input.context.taxYear || canonical(e.capital.trace.context) !== canonical(input.context))) issues.push(diagnostic("CAPITAL_CONTEXT_MISMATCH", "tax_delta"));
    if (e.capital.status === "complete" && e.capitalResultIdentity !== e.capital.value.resultIdentity) issues.push(diagnostic("CAPITAL_RESULT_RECEIPT_MISMATCH", "tax_delta"));
    if (e.capital.trace.fingerprint !== ruleFingerprint) issues.push(diagnostic("CAPITAL_RULE_MISMATCH", "tax_delta"));
    try {
      const end = day(e.horizonEndExclusive);
      if (end < day(e.periodEndExclusive) || day(e.periodStart) >= day(e.periodEndExclusive)) issues.push(diagnostic("HORIZON_INVALID", "tax_delta", "invalid"));
      for (const s of p.sales) if (day(e.evaluatedThrough) < day(s.date) + 30 || day(s.date) < day(e.periodStart) || day(s.date) >= day(e.periodEndExclusive)) issues.push(diagnostic("TAX_RESULT_STALE_FOR_ACTIVITY", "tax_delta"));
    } catch { issues.push(diagnostic("DATE_INVALID", "tax_delta", "invalid")); }
  }
  if (b.tax.catalogFingerprint !== c.tax.catalogFingerprint || canonical(b.tax.appliedRules) !== canonical(c.tax.appliedRules) || b.horizonEndExclusive !== c.horizonEndExclusive || b.unchangedFactsFingerprint !== c.unchangedFactsFingerprint) issues.push(diagnostic("TAX_RESULTS_NOT_COMPARABLE", "tax_delta"));
  if (!input.expectedBaselineActivityFingerprint || b.activityFingerprint !== input.expectedBaselineActivityFingerprint || c.activityFingerprint !== harvestActivityFingerprint(p) || b.scenarioId !== input.expectedBaselineScenarioId || c.scenarioId !== input.expectedCandidateScenarioId || !b.scenarioId || !c.scenarioId || b.scenarioId === c.scenarioId || b.resultId === c.resultId) issues.push(diagnostic("SCENARIO_OR_ACTIVITY_MISMATCH", "tax_delta"));
  if (w.status !== "complete") issues.push(diagnostic("WASH_RESULT_INCOMPLETE", "eligible_loss"));
  if (w.status === "complete") {
    if (w.trace.fingerprint !== ruleFingerprint || w.value.state.ruleFingerprint !== ruleFingerprint) issues.push(diagnostic("WASH_RULE_MISMATCH", "eligible_loss"));
    if (canonical(w.trace.context) !== canonical(input.context)) issues.push(diagnostic("WASH_CONTEXT_MISMATCH", "eligible_loss"));
    for (const s of p.sales) if (!w.value.state.sales.some(a => canonical(a) === canonical(s))) issues.push(diagnostic("WASH_SALE_FACT_MISMATCH", s.id));
    for (const a of p.replacements) if (!w.value.state.acquisitions.some(r => canonical(r) === canonical(a))) issues.push(diagnostic("WASH_REPLACEMENT_FACT_MISMATCH", a.id));
  }
  if (issues.length || w.status !== "complete" || b.capital.status !== "complete" || c.capital.status !== "complete") return incomplete(t, issues);
  const net = p.grossProceeds.minus(p.disposalCosts);
  if (!sum(p.sales.map(s => s.netProceeds)).equals(net)) return incomplete(t, [diagnostic("DISPOSAL_PROCEEDS_DO_NOT_RECONCILE", "harvest", "invalid")]);
  const selected = w.value.sales.filter(s => p.sales.some(l => l.id === s.saleId));
  for (const character of ["short", "long"] as const) {
    const realized = sum(p.sales.filter(s => s.character === character).map(s => s.netProceeds.minus(s.basis)))
      .plus(sum(selected.filter(s => s.character === character).map(s => s.disallowedLoss)));
    const key = character === "short" ? "shortRealized" : "longRealized";
    if (!c.capital.value[key].equals(b.capital.value[key].plus(realized))) return incomplete(t, [diagnostic("CANDIDATE_REALIZATION_MISMATCH", "tax_delta")]);
  }
  if (canonical(b.capital.value.opening) !== canonical(c.capital.value.opening)) return incomplete(t, [diagnostic("CANDIDATE_OPENING_STATE_MISMATCH", "tax_delta")]);
  const delta = b.tax.totalLiability.minus(c.tax.totalLiability), costs = p.disposalCosts.plus(p.replacementCosts);
  // No new tax liability calculation, marginal rate, or future benefit estimate.
  return complete(t, { proposalId: p.id, grossProceeds: p.grossProceeds, netDisposalProceeds: net,
    eligibleCurrentLoss: sum(selected.map(s => s.eligibleLoss)), blockedCurrentLoss: sum(selected.map(s => s.disallowedLoss)),
    realizedShort: sum(p.sales.filter(s => s.character === "short").map(s => s.netProceeds.minus(s.basis))),
    realizedLong: sum(p.sales.filter(s => s.character === "long").map(s => s.netProceeds.minus(s.basis))),
    transactionCosts: costs, currentYearTaxReduction: delta, currentYearReductionAfterCosts: delta.minus(costs),
    baselineCarryover: { ...b.capital.value.closing, lineage: [...b.capital.value.closing.lineage] },
    candidateCarryover: { ...c.capital.value.closing, lineage: [...c.capital.value.closing.lineage] },
    futureValue: "unvalued_requires_future_authoritative_gains_and_tax_evaluation", exposureChange: p.exposureChange,
    evaluationIds: [b.resultId, c.resultId, w.value.state.resultIdentity] });
};
