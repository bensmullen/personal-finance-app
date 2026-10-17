import type { Money } from "../../../values/index.js";
import type { FilingStatus } from "../contracts.js";
import { complete, contentIdentity, contextIssues, diagnostic, freeze, incomplete, law, min, positive, ruleFingerprint, trace, validMoney, zero, type Context, type Outcome, type Predicate, type Trace } from "./common.js";

export interface CarryoverState {
  readonly forTaxYear: number;
  readonly owner: Context["owner"];
  readonly filingStatus: FilingStatus;
  readonly shortLoss: Money;
  readonly longLoss: Money;
  readonly ruleFingerprint: string;
  readonly priorResultIdentity: string;
  /** Root source and immediate predecessor/return/result references, never history. */
  readonly lineage: readonly string[];
  readonly predecessor?: {
    readonly trace: Trace;
    readonly openingStateIdentity: string;
    readonly openingResultIdentity: string;
    readonly returnResultIdentity: string;
  };
  readonly stateIdentity: string;
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
const sealState = (state: Omit<CarryoverState, "stateIdentity">): CarryoverState => freeze({
  ...state, stateIdentity: contentIdentity("t1b:capital:state", state),
});
const resultReference = (inputIdentity: string): string => contentIdentity("t1b:capital:result", { inputIdentity, ruleFingerprint });
export const openingCapitalState = (context: Context, filingStatus: FilingStatus, source: string): CarryoverState => sealState({
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
  if (o) {
    const { stateIdentity, ...facts } = o;
    const p = o.predecessor;
    if (stateIdentity !== contentIdentity("t1b:capital:state", facts)
      || (p ? (p.trace.context.taxYear !== o.forTaxYear - 1 || p.trace.context.owner !== o.owner
        || p.trace.context.jurisdiction !== input.context.jurisdiction || p.trace.fingerprint !== ruleFingerprint
        || p.trace.ruleId !== `${law.id}:capital` || p.trace.version !== law.version
        || !p.trace.context.sources.length || !p.trace.sources.length || !p.openingStateIdentity || !p.openingResultIdentity || !p.returnResultIdentity
        || o.priorResultIdentity !== resultReference(p.trace.inputIdentity)
        || o.lineage.length !== 4 || o.lineage[1] !== p.openingResultIdentity
        || o.lineage[2] !== p.returnResultIdentity || o.lineage[3] !== o.priorResultIdentity)
        : (o.lineage.length !== 1 || o.lineage[0] !== o.priorResultIdentity))) {
      issues.push(diagnostic("OPENING_STATE_PROVENANCE_MISMATCH", "carryover", "invalid"));
    }
  }
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
  const resultIdentity = resultReference(t.inputIdentity);
  return complete(t, {
    taxYear: input.context.taxYear, shortRealized: input.shortRealized, longRealized: input.longRealized,
    opening: { ...o, lineage: [...o.lineage] }, netShort: ns, netLong: nl, totalNet: total,
    taxableShortGain: positive(ns.minus(longLoss)), taxableLongGain: positive(nl.minus(shortLoss)),
    scheduledDeduction: scheduled, lossConsumed: consumed,
    shortDeductionConsumed: min(consumed, positive(shortLoss.minus(positive(nl)))), longDeductionConsumed: longConsumed,
    closing: sealState({ forTaxYear: input.context.taxYear + 1, owner: o.owner, filingStatus: input.filingStatus,
      shortLoss: shortCarry, longLoss: longCarry, ruleFingerprint, priorResultIdentity: resultIdentity,
      lineage: [o.lineage[0]!, o.priorResultIdentity, r.authoritativeResultId, resultIdentity],
      predecessor: { trace: t, openingStateIdentity: o.stateIdentity, openingResultIdentity: o.priorResultIdentity,
        returnResultIdentity: r.authoritativeResultId } }), resultIdentity,
  });
};
