import type { Money } from "../../../values/index.js";
import type { FilingStatus } from "../contracts.js";
import { canonical, complete, contextIssues, diagnostic, incomplete, law, min, positive, ruleFingerprint, trace, validMoney, zero, type Context, type Outcome, type Predicate } from "./common.js";

export interface CarryoverState {
  readonly forTaxYear: number;
  readonly owner: Context["owner"];
  readonly filingStatus: FilingStatus;
  readonly shortLoss: Money;
  readonly longLoss: Money;
  readonly ruleFingerprint: string;
  readonly priorResultIdentity: string;
  readonly lineage: readonly string[];
}
export interface CapitalInput {
  readonly context: Context;
  readonly filingStatus: FilingStatus;
  readonly opening: CarryoverState | undefined;
  readonly shortRealized: Money;
  readonly longRealized: Money;
  readonly returnContext: {
    /** Form 1040 line 15 BEFORE zero floor, AFTER Schedule D line 21 deduction. */
    readonly signedTaxableIncomeAfterDeduction: Money;
    readonly authoritativeResultId: string;
    readonly ordinaryCategoriesOnly: Predicate;
    readonly noNolOrDebtAttributeReduction: Predicate;
    readonly ownershipAndFilingAllocationUnchanged: Predicate;
    readonly finalReturn: Predicate;
  } | undefined;
}
export interface CapitalResult {
  readonly taxYear: number;
  readonly shortRealized: Money;
  readonly longRealized: Money;
  readonly opening: CarryoverState;
  readonly netShort: Money;
  readonly netLong: Money;
  readonly totalNet: Money;
  readonly taxableShortGain: Money;
  readonly taxableLongGain: Money;
  readonly scheduledDeduction: Money;
  readonly lossConsumed: Money;
  readonly shortDeductionConsumed: Money;
  readonly longDeductionConsumed: Money;
  readonly closing: CarryoverState;
  readonly resultIdentity: string;
}
export const openingCapitalState = (context: Context, filingStatus: FilingStatus, source: string): CarryoverState => ({
  forTaxYear: context.taxYear, owner: context.owner, filingStatus, shortLoss: zero, longLoss: zero,
  ruleFingerprint, priorResultIdentity: source, lineage: [source],
});

/** Pub. 550 worksheet 4-1 lines 1–13; never computes annual liability. */
export const evaluateCapitalLoss = (input: CapitalInput): Outcome<CapitalResult> => {
  const t = trace(input.context, input, "capital");
  const issues = contextIssues(input.context);
  const { opening: o, returnContext: r } = input;
  if (!o) issues.push(diagnostic("OPENING_CARRYOVER_REQUIRED", "carryover"));
  if (!r) issues.push(diagnostic("SIGNED_TAXABLE_INCOME_REQUIRED", "carryover"));
  if (!["single", "married_joint", "married_separate", "head_of_household", "qualifying_surviving_spouse"].includes(input.filingStatus)) issues.push(diagnostic("FILING_STATUS_INVALID", "carryover", "invalid"));
  if (o && (o.forTaxYear !== input.context.taxYear || o.owner !== input.context.owner || o.filingStatus !== input.filingStatus || o.ruleFingerprint !== ruleFingerprint || !o.priorResultIdentity || o.lineage.length === 0)) issues.push(diagnostic("OPENING_STATE_BOUNDARY_MISMATCH", "carryover"));
  if (!validMoney([input.shortRealized, input.longRealized, ...(o ? [o.shortLoss, o.longLoss] : []), ...(r ? [r.signedTaxableIncomeAfterDeduction] : [])]) || (o && (o.shortLoss.isNegative() || o.longLoss.isNegative()))) issues.push(diagnostic("MONEY_INVALID", "capital", "invalid"));
  if (r) {
    for (const [key, fact] of Object.entries({ ordinaryCategoriesOnly: r.ordinaryCategoriesOnly, noNolOrDebtAttributeReduction: r.noNolOrDebtAttributeReduction, ownershipAndFilingAllocationUnchanged: r.ownershipAndFilingAllocationUnchanged })) {
      if (fact.value !== true || fact.evidence.length === 0) issues.push(diagnostic(`RETURN_CONTEXT_${key}`, "carryover", fact.value === false ? "unsupported" : "legal_unknown"));
    }
    if (r.finalReturn.value !== false || r.finalReturn.evidence.length === 0) issues.push(diagnostic("FINAL_RETURN_OR_UNKNOWN", "carryover", r.finalReturn.value === true ? "unsupported" : "legal_unknown"));
    if (!r.authoritativeResultId) issues.push(diagnostic("RETURN_RESULT_ID_REQUIRED", "carryover"));
  }
  if (issues.length || !o || !r) return incomplete(t, issues);
  const ns = input.shortRealized.minus(o.shortLoss), nl = input.longRealized.minus(o.longLoss);
  const total = ns.plus(nl);
  const cap = input.filingStatus === "married_separate" ? law.separateLossCap : law.annualLossCap;
  const scheduled = min(positive(total.negated()), cap);
  const consumed = min(scheduled, positive(r.signedTaxableIncomeAfterDeduction.plus(scheduled)));
  const shortLoss = positive(ns.negated()), longLoss = positive(nl.negated());
  const shortCarry = positive(shortLoss.minus(consumed).minus(positive(nl)));
  const longConsumed = positive(consumed.minus(shortLoss));
  const longCarry = positive(longLoss.minus(positive(ns)).minus(longConsumed));
  const resultIdentity = `t1b:capital:${canonical({ input, ruleFingerprint })}`;
  return complete(t, {
    taxYear: input.context.taxYear, shortRealized: input.shortRealized, longRealized: input.longRealized,
    opening: { ...o, lineage: [...o.lineage] }, netShort: ns, netLong: nl, totalNet: total,
    taxableShortGain: positive(ns.minus(longLoss)), taxableLongGain: positive(nl.minus(shortLoss)),
    scheduledDeduction: scheduled, lossConsumed: consumed,
    shortDeductionConsumed: min(consumed, positive(shortLoss.minus(positive(nl)))), longDeductionConsumed: longConsumed,
    closing: { forTaxYear: input.context.taxYear + 1, owner: o.owner, filingStatus: input.filingStatus,
      shortLoss: shortCarry, longLoss: longCarry, ruleFingerprint, priorResultIdentity: resultIdentity,
      lineage: [...o.lineage, r.authoritativeResultId, resultIdentity] }, resultIdentity,
  });
};
