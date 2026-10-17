import { DecimalAmount, Money } from "../../../values/index.js";
import { canonical, compareText, complete, contextIssues, day, decimal, diagnostic, incomplete, law, rounding, ruleFingerprint, sum, trace, validMoney, zero, type AccountId, type Context, type LotId, type Outcome, type OwnerId, type Predicate, type SecurityId } from "./common.js";

export interface SecurityActivity {
  readonly id: string;
  readonly lot: LotId;
  readonly security: SecurityId;
  readonly account: AccountId;
  readonly beneficialOwner: OwnerId;
  readonly economicOwner: OwnerId;
  readonly date: string;
  /** Actual execution order within the date, never an array or lexical tie break. */
  readonly executionOrder: number;
  readonly quantity: DecimalAmount;
  readonly unit: "shares";
  readonly instrument: "stock" | "security" | "verified_option_right" | "dealer" | "short_sale" | "complex_option" | "other";
  readonly sources: readonly string[];
}
export interface LossSale extends SecurityActivity {
  readonly basis: Money;
  readonly netProceeds: Money;
  readonly holdingPeriodDays: number;
  readonly character: "short" | "long";
}
export interface Replacement extends SecurityActivity {
  readonly originalCost: Money;
  readonly accountKind: "taxable" | "ira" | "roth_ira" | "unknown";
  readonly relationship: "same_owner" | "spouse" | "controlled_entity" | "unrelated" | "unknown";
  readonly relationshipVerified: Predicate;
}
export interface Similarity {
  readonly saleId: string;
  readonly acquisitionId: string;
  /** Includes verified option/right coverage when either instrument requires it. */
  readonly substantiallyIdentical: Predicate;
  /** Verifies this acquisition quantity is retained/available as replacement
   * shares for this sale, with no unrepresented prior disposition or encumbrance. */
  readonly replacementEligibility: Predicate;
}
export interface WashInput {
  readonly context: Context;
  readonly sales: readonly LossSale[];
  readonly acquisitions: readonly Replacement[];
  readonly similarity: readonly Similarity[];
  /** All household/spouse/controlled/external accounts through the final +30 day. */
  readonly coverage: Predicate;
  readonly observedThrough: string;
  readonly opening?: WashState;
}
export interface WashMatch {
  readonly saleId: string;
  readonly acquisitionId: string;
  readonly quantity: DecimalAmount;
  readonly disallowedLoss: Money;
  readonly basisIncrease: Money;
  readonly permanentlyDisallowed: Money;
  readonly tackedHoldingDays: number;
}
export interface WashState {
  readonly ruleFingerprint: string;
  readonly owner: OwnerId;
  readonly sales: readonly LossSale[];
  readonly acquisitions: readonly Replacement[];
  readonly similarity: readonly Similarity[];
  readonly adjustments: readonly WashMatch[];
  readonly resultIdentity: string;
}
export interface WashResult {
  readonly sales: readonly { readonly saleId: string; readonly loss: Money; readonly eligibleLoss: Money; readonly disallowedLoss: Money; readonly character: LossSale["character"] }[];
  /** Absolute replacement basis, never incremental commands to apply on replay. */
  readonly replacements: readonly { readonly acquisitionId: string; readonly adjustedBasis: Money; readonly matches: readonly WashMatch[] }[];
  readonly state: WashState;
}
const order = (a: SecurityActivity, b: SecurityActivity): number => compareText(a.date, b.date) || a.executionOrder - b.executionOrder;
const copySimilarity = (s: Similarity): Similarity => ({ ...s,
  substantiallyIdentical: { ...s.substantiallyIdentical, evidence: [...s.substantiallyIdentical.evidence] },
  replacementEligibility: { ...s.replacementEligibility, evidence: [...s.replacementEligibility.evidence] } });

/** Replays cumulative original facts; closing state is immutable and idempotent. */
export const evaluateWashSales = (input: WashInput): Outcome<WashResult> => {
  const sales = [...input.sales].sort(order), acquisitions = [...input.acquisitions].sort(order);
  const similarity = [...input.similarity].sort((a, b) => compareText(canonical([a.saleId, a.acquisitionId]), canonical([b.saleId, b.acquisitionId])));
  const t = trace(input.context, { ...input, opening: undefined, sales, acquisitions, similarity }, "wash");
  const issues = contextIssues(input.context);
  if (input.coverage.value !== true || input.coverage.evidence.length === 0) issues.push(diagnostic("EXTERNAL_ACCOUNT_COVERAGE_UNKNOWN", "wash", "legal_unknown"));
  try {
    const observed = day(input.observedThrough);
    const activities = [...sales, ...acquisitions];
    if (new Set(activities.map(a => a.id)).size !== activities.length) issues.push(diagnostic("ACTIVITY_ID_DUPLICATE", "wash", "invalid"));
    if (new Set(acquisitions.map(a => a.lot)).size !== acquisitions.length) issues.push(diagnostic("ACQUISITION_LOT_DUPLICATE", "wash", "invalid"));
    for (const collection of [sales, acquisitions]) {
      const keys = collection.map(a => `${a.date}:${a.executionOrder}`);
      if (new Set(keys).size !== keys.length) issues.push(diagnostic("EXECUTION_ORDER_AMBIGUOUS", "wash", "incomplete"));
    }
    for (const a of activities) {
      day(a.date);
      if (!a.id || !a.lot || !a.account || !a.security || !a.beneficialOwner || !a.economicOwner || !a.quantity.isPositive() || a.unit !== "shares" || !Number.isSafeInteger(a.executionOrder) || a.executionOrder < 0 || a.sources.length === 0) issues.push(diagnostic("ACTIVITY_FACT_INVALID", a.id, "invalid"));
      if (!["stock", "security", "verified_option_right"].includes(a.instrument)) issues.push(diagnostic(`INSTRUMENT_${a.instrument}`, a.id, "unsupported"));
    }
    for (const s of sales) {
      if (observed < day(s.date) + law.washDays) issues.push(diagnostic("POST_SALE_WINDOW_UNOBSERVED", s.id));
      const priorSale = input.opening?.sales.some(prior => canonical(prior) === canonical(s));
      if ((Number(s.date.slice(0, 4)) !== input.context.taxYear && !priorSale) || Number(s.date.slice(0, 4)) > input.context.taxYear || s.economicOwner !== input.context.owner) issues.push(diagnostic("SALE_CONTEXT_MISMATCH", s.id, "invalid"));
      if (!validMoney([s.basis, s.netProceeds], true) || !Number.isSafeInteger(s.holdingPeriodDays) || s.holdingPeriodDays < 0 || !["short", "long"].includes(s.character)) issues.push(diagnostic("SALE_VALUE_INVALID", s.id, "invalid"));
    }
    for (const a of acquisitions) {
      if (!validMoney([a.originalCost], true)) issues.push(diagnostic("ACQUISITION_VALUE_INVALID", a.id, "invalid"));
      if (a.accountKind === "unknown" || a.relationship === "unknown" || a.relationshipVerified.value !== true || !a.relationshipVerified.evidence.length) issues.push(diagnostic("REPLACEMENT_CLASSIFICATION_UNKNOWN", a.id, "legal_unknown"));
      if (a.relationship === "same_owner" && (a.economicOwner !== input.context.owner || a.beneficialOwner !== input.context.owner)) issues.push(diagnostic("OWNER_RELATION_MISMATCH", a.id, "invalid"));
    }
    const pairKeys = similarity.map(s => canonical([s.saleId, s.acquisitionId]));
    if (new Set(pairKeys).size !== pairKeys.length) issues.push(diagnostic("SIMILARITY_DUPLICATE", "wash", "invalid"));
    for (const s of sales) for (const a of acquisitions) {
      if (Math.abs(day(s.date) - day(a.date)) > law.washDays || a.relationship === "unrelated" || !s.basis.minus(s.netProceeds).isPositive()) continue;
      if (a.lot === s.lot) continue;
      const pair = similarity.find(p => p.saleId === s.id && p.acquisitionId === a.id);
      const fact = pair?.substantiallyIdentical;
      if (!fact || fact.value === "unknown" || !fact.evidence.length) issues.push(diagnostic("SUBSTANTIAL_IDENTITY_UNKNOWN", canonical([s.id, a.id]), "legal_unknown"));
      if (fact?.value === true && (!pair?.replacementEligibility || pair.replacementEligibility.value === "unknown" || !pair.replacementEligibility.evidence.length)) issues.push(diagnostic("REPLACEMENT_AVAILABILITY_UNKNOWN", canonical([s.id, a.id]), "legal_unknown"));
    }
  } catch {
    issues.push(diagnostic("DATE_INVALID", "wash", "invalid"));
  }
  if (input.opening) {
    const o = input.opening;
    if (o.ruleFingerprint !== ruleFingerprint || o.owner !== input.context.owner) issues.push(diagnostic("WASH_OPENING_MISMATCH", "wash"));
    for (const [old, current] of [[o.sales, sales], [o.acquisitions, acquisitions]] as const) {
      for (const item of old) if (!current.some(a => a.id === item.id && canonical(a) === canonical(item))) issues.push(diagnostic("ORIGINAL_HISTORY_CHANGED", item.id));
    }
    for (const item of o.similarity) if (!similarity.some(s => canonical(s) === canonical(item))) issues.push(diagnostic("LEGAL_HISTORY_CHANGED", "wash"));
  }
  if (issues.length) return incomplete(t, issues);
  const used = new Map<string, DecimalAmount>();
  const matches: WashMatch[] = [];
  const results: WashResult["sales"][number][] = [];
  for (const s of sales) {
    const loss = s.basis.minus(s.netProceeds);
    if (!loss.isPositive()) { results.push({ saleId: s.id, loss: zero, eligibleLoss: zero, disallowedLoss: zero, character: s.character }); continue; }
    let matched = decimal("0"), allocated = zero;
    for (const a of acquisitions) {
      if (Math.abs(day(s.date) - day(a.date)) > law.washDays || a.relationship === "unrelated" || !similarity.some(p => p.saleId === s.id && p.acquisitionId === a.id && p.substantiallyIdentical.value === true && p.replacementEligibility.value === true)) continue;
      if (a.lot === s.lot) continue;
      const remaining = a.quantity.minus(used.get(a.id) ?? decimal("0"));
      const needed = s.quantity.minus(matched);
      const q = remaining.compare(needed) < 0 ? remaining : needed;
      if (!q.isPositive()) continue;
      // Rounded cumulative allocation conserves the sale loss at full matching.
      const cumulative = new Money(loss.amount.times(matched.plus(q)).dividedBy(s.quantity, rounding), loss.currency);
      const adjustment = cumulative.minus(allocated);
      const retirement = a.accountKind === "ira" || a.accountKind === "roth_ira";
      matches.push({ saleId: s.id, acquisitionId: a.id, quantity: q, disallowedLoss: adjustment,
        basisIncrease: retirement ? zero : adjustment, permanentlyDisallowed: retirement ? adjustment : zero,
        tackedHoldingDays: retirement ? 0 : s.holdingPeriodDays });
      used.set(a.id, (used.get(a.id) ?? decimal("0")).plus(q));
      matched = matched.plus(q); allocated = cumulative;
    }
    results.push({ saleId: s.id, loss, eligibleLoss: loss.minus(allocated), disallowedLoss: allocated, character: s.character });
  }
  // A disposition of adjusted replacement shares needs an authoritative re-realized
  // lot input, not an unadjusted paper loss passed through this matcher.
  for (const m of matches) {
    const a = acquisitions.find(a => a.id === m.acquisitionId)!;
    if (m.basisIncrease.isPositive() && sales.some(s => s.lot === a.lot)) return incomplete(t, [diagnostic("CHAINED_REPLACEMENT_DISPOSITION_REQUIRES_RERECOGNITION", a.id, "unsupported")]);
  }
  const resultIdentity = `t1b:wash:${canonical({ facts: t.inputIdentity, matches, ruleFingerprint })}`;
  return complete(t, {
    sales: results,
    replacements: acquisitions.map(a => ({ acquisitionId: a.id, adjustedBasis: a.originalCost.plus(sum(matches.filter(m => m.acquisitionId === a.id).map(m => m.basisIncrease))), matches: matches.filter(m => m.acquisitionId === a.id) })),
    state: { owner: input.context.owner, ruleFingerprint,
      sales: sales.map(s => ({ ...s, sources: [...s.sources] })),
      acquisitions: acquisitions.map(a => ({ ...a, sources: [...a.sources], relationshipVerified: { ...a.relationshipVerified, evidence: [...a.relationshipVerified.evidence] } })),
      similarity: similarity.map(copySimilarity), adjustments: matches, resultIdentity },
  });
};
