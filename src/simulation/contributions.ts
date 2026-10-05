import { accountingTransactionId, createAccountingLeg, createAccountingTransaction, type AccountingLegDraft, type AccountingTransaction, type AccountId, type PositionId } from "../accounting/index.js";
import { failValidation, issueCodes } from "../diagnostics/index.js";
import { domainId } from "../identity/index.js";
import { calculationTraceId, calculationTraceRef } from "../lineage/index.js";
import { deriveD1ContributionCapacity, D1_CONTRIBUTION_LAW_2026, contributionCharacters, type ContributionCharacter, type D1CapacityKind, type D1ContributionFacts } from "../rules/contribution2026.js";
import { contributionBucketIdentity, evaluateContributionBuckets, type ContributionBucketDecision } from "../rules/contribution.js";
import { resolveContributionLimitBindings } from "../rules/resolver.js";
import type { AnnualContributionLimitRule, RuleTarget } from "../rules/contracts.js";
import { applyAccountingTransactionAtomically, cloneAuthoritativeState, validateAuthoritativeState, type AuthoritativeState, type ContributionState } from "../state/index.js";
import { instant, type Instant } from "../time/index.js";
import { Money, Quantity, RoundingPolicy, decimal } from "../values/index.js";

export type { ContributionCharacter } from "../rules/contribution2026.js";
export interface ContributionLimitBinding {
  readonly ruleId: string;
  readonly kind: D1CapacityKind;
  readonly target: RuleTarget & { readonly targetType: "account" | "person" | "household" };
  readonly bucketKey: string;
  readonly includedCharacters: readonly string[];
}
export interface ContributionPolicy {
  readonly character: ContributionCharacter;
  readonly personId: string;
  readonly householdId: string;
  readonly facts: D1ContributionFacts;
  readonly limits: readonly ContributionLimitBinding[];
  readonly excessPolicy: "reject" | "auto_cap";
}
const invalid = (message: string): never => failValidation({ severity: "error", code: issueCodes.ruleInputInvalid, message, entityType: "contribution" });
const usage = (state: AuthoritativeState) => Object.values(state.contributions ?? {}).flatMap(entry => entry.buckets.map(bucket => ({ contributionId: entry.id, bucketIdentity: bucket.identity, character: entry.character, amount: bucket.amount })));

/** All applicable scope buckets are resolved before any financial candidate is posted. */
export const decideContribution = (state: AuthoritativeState, policy: ContributionPolicy, accountId: string, at: Instant, requested: Money): ContributionBucketDecision => {
  if (state.accounts[accountId]?.ownerId !== policy.personId) return invalid("Contribution must reach its contributor's own account");
  if (policy.facts.taxYear !== Number(at.slice(0, 4))) return invalid("Contribution facts do not cover this UTC year");
  const needed: D1CapacityKind[] = policy.character.endsWith("_ira") ? ["ira_shared", ...(policy.character === "roth_ira" ? ["roth_ira" as const] : [])]
    : policy.character.includes("401k") ? ["401k_additions", ...(["traditional_401k", "roth_401k"].includes(policy.character) ? ["401k_elective" as const] : [])]
      : ["hsa_individual", ...(policy.facts.hsaCoverage === "family" ? ["hsa_family" as const] : [])];
  if (needed.some(kind => !policy.limits.some(binding => binding.kind === kind))) return invalid("Required statutory contribution bucket is missing");
  const catalog: AnnualContributionLimitRule[] = policy.limits.filter(binding => binding.includedCharacters.includes(policy.character)).map(binding => {
    if (!binding.bucketKey.trim()) return invalid("Contribution scope key is required");
    if (binding.kind !== "401k_additions" && binding.bucketKey !== binding.kind) return invalid("Statutory participant/household scope keys cannot vary between accounts");
    if (binding.kind === "401k_additions" && (!binding.bucketKey.startsWith("401k_additions:") || !binding.bucketKey.slice("401k_additions:".length).trim() || binding.target.targetType !== "person" || binding.target.targetId !== policy.personId)) return invalid("Annual additions require an explicit participant and plan/sponsor aggregation key");
    const characters = contributionCharacters(binding.kind);
    if (binding.includedCharacters.length !== characters.length || characters.some(character => !binding.includedCharacters.includes(character))) return invalid("Statutory bucket must include all legally shared contribution characters");
    if (["ira_shared", "roth_ira", "401k_elective", "hsa_individual"].includes(binding.kind) && (binding.target.targetType !== "person" || binding.target.targetId !== policy.personId)) return invalid("Participant statutory bucket must target the contributor");
    if (binding.kind === "hsa_family" && (binding.target.targetType !== "household" || binding.target.targetId !== policy.householdId)) return invalid("Family HSA bucket must target the household");
    const capacity = deriveD1ContributionCapacity(binding.kind, policy.facts);
    if (capacity.status !== "complete") return invalid(capacity.diagnostics.join(", "));
    const bucket = `${binding.target.targetType}:${binding.target.targetId}:${binding.bucketKey}:${policy.facts.taxYear}`;
    if (Object.values(state.contributions ?? {}).some(entry => entry.buckets.some(prior => prior.identity === bucket && !prior.annualLimit.equals(capacity.capacity)))) return invalid("Conflicting annual facts for the same committed statutory bucket");
    return { id: domainId("tax-rule", binding.ruleId), kind: "annual_contribution_limit", target: binding.target, bucketKey: binding.bucketKey, includedCharacters: binding.includedCharacters,
      effectiveFrom: instant(`${policy.facts.taxYear}-01-01T00:00:00.000Z`), effectiveUntil: instant(`${policy.facts.taxYear + 1}-01-01T00:00:00.000Z`), calendarYear: policy.facts.taxYear, calendar: "utc", annualLimit: capacity.capacity,
      capacityFacts: { lawVersion: D1_CONTRIBUTION_LAW_2026.version, kind: binding.kind,
        ...Object.fromEntries(Object.entries(policy.facts).filter(([, value]) => value !== undefined).map(([key, value]) => [key, typeof value === "boolean" ? value : value instanceof Money ? `${value.amount.toString()} ${value.currency.code}` : String(value)])) } };
  });
  const resolved = resolveContributionLimitBindings(catalog, catalog.map(rule => rule.id), [
    { targetType: "account", targetId: domainId("account", accountId) }, { targetType: "person", targetId: domainId("person", policy.personId) }, { targetType: "household", targetId: domainId("household", policy.householdId) },
  ], at);
  const committed = usage(state);
  const used = (rule: AnnualContributionLimitRule) => committed.filter(entry => entry.bucketIdentity === contributionBucketIdentity(rule)).reduce((sum, entry) => sum.plus(entry.amount), Money.zero(requested.currency));
  const remaining = (capacity: Money, prior: Money) => prior.compare(capacity) >= 0 ? Money.zero(capacity.currency) : capacity.minus(prior);
  const min = (a: Money, b: Money) => a.compare(b) < 0 ? a : b;
  const qualifications: Record<string, { maximumAccepted: Money; qualifyingCeiling: Money }> = {};
  const elective = catalog.find(rule => rule.capacityFacts?.kind === "401k_elective");
  if (elective) {
    const capacity = deriveD1ContributionCapacity("401k_elective", policy.facts);
    if (capacity.status !== "complete") return invalid("Elective-deferral facts are incomplete");
    const priorElective = Object.values(state.contributions ?? {}).filter(entry => entry.buckets.some(bucket => bucket.identity === contributionBucketIdentity(elective)));
    const ordinaryUsed = priorElective.reduce((sum, entry) => sum.plus(entry.buckets.find(bucket => bucket.identity.includes(":401k_additions:"))?.amount ?? entry.amount), Money.zero(requested.currency));
    const ordinaryRemaining = remaining(capacity.ordinaryCapacity, ordinaryUsed);
    const catchupRemaining = remaining(capacity.catchupCapacity, used(elective).minus(ordinaryUsed));
    for (const rule of catalog.filter(rule => rule.capacityFacts?.kind === "401k_additions")) {
      const additionsRemaining = remaining(rule.annualLimit, used(rule));
      const nonCatchup = min(additionsRemaining, ordinaryRemaining);
      const mandatoryRoth = capacity.rothCatchupRequired && policy.character === "traditional_401k";
      if (mandatoryRoth && policy.excessPolicy === "reject" && requested.compare(nonCatchup) > 0) return invalid("Applicable catch-up deferrals must be Roth");
      qualifications[rule.id] = { maximumAccepted: min(requested, mandatoryRoth ? nonCatchup : nonCatchup.plus(catchupRemaining)), qualifyingCeiling: nonCatchup };
    }
  }
  const individual = catalog.find(rule => rule.capacityFacts?.kind === "hsa_individual");
  const family = catalog.find(rule => rule.capacityFacts?.kind === "hsa_family");
  if (individual && family) {
    const capacity = deriveD1ContributionCapacity("hsa_individual", policy.facts);
    if (capacity.status !== "complete") return invalid("HSA eligibility facts are incomplete");
    const own = Object.values(state.contributions ?? {}).filter(entry => entry.personId === policy.personId && entry.at.slice(0, 4) === at.slice(0, 4) && entry.character.endsWith("_hsa"));
    const familyKey = contributionBucketIdentity(family);
    const ordinaryUsed = own.flatMap(entry => entry.buckets.filter(bucket => bucket.identity === familyKey)).reduce((sum, bucket) => sum.plus(bucket.amount), Money.zero(requested.currency));
    const catchupUsed = used(individual).minus(ordinaryUsed);
    const ordinaryAvailable = min(remaining(capacity.ordinaryCapacity, ordinaryUsed), remaining(family.annualLimit, used(family)));
    qualifications[family.id] = { maximumAccepted: min(requested, ordinaryAvailable.plus(remaining(capacity.catchupCapacity, catchupUsed))), qualifyingCeiling: ordinaryAvailable };
  }
  return evaluateContributionBuckets(resolved, requested, policy.character, committed, policy.excessPolicy, qualifications);
};

/** Returns a fresh committed ledger; rejected or failed financial work never calls this. */
export const recordContribution = (state: AuthoritativeState, policy: ContributionPolicy, accountId: string, id: string, at: Instant, decision: ContributionBucketDecision, incomeId?: string): AuthoritativeState => {
  if (state.contributions?.[id]) return invalid("Duplicate contribution identity");
  if (decision.accepted.isZero()) return state;
  let eligibleDeduction: Money | undefined;
  if (policy.character === "traditional_ira") {
    const deduction = deriveD1ContributionCapacity("traditional_ira_deduction", policy.facts);
    if (deduction.status === "complete") {
      const prior = Object.values(state.contributions ?? {}).filter(entry => entry.personId === policy.personId && entry.at.slice(0, 4) === at.slice(0, 4)).reduce((sum, entry) => sum.plus(entry.eligibleDeduction ?? Money.zero(decision.accepted.currency)), Money.zero(decision.accepted.currency));
      const remaining = prior.compare(deduction.capacity) >= 0 ? Money.zero(prior.currency) : deduction.capacity.minus(prior);
      eligibleDeduction = remaining.compare(decision.accepted) < 0 ? remaining : decision.accepted;
    }
  }
  const entry: ContributionState = Object.freeze({ id, at, personId: policy.personId, accountId, character: policy.character, amount: decision.accepted, requested: decision.requested, excess: decision.excess,
    ...(incomeId === undefined ? {} : { incomeId }), ...(eligibleDeduction === undefined ? {} : { eligibleDeduction }),
    buckets: Object.freeze(decision.buckets.map(bucket => Object.freeze({ identity: bucket.bucketIdentity, amount: bucket.consumedAmount ?? decision.accepted, annualLimit: bucket.annualLimit, usedBefore: bucket.usedBefore, remainingBefore: bucket.remainingBefore, facts: bucket.facts, ruleIds: Object.freeze([String(bucket.ruleId)]) }))) });
  const next = cloneAuthoritativeState(state);
  next.contributions = { ...state.contributions, [id]: entry };
  validateAuthoritativeState(next);
  return next;
};

/** One balanced, isolated employer-benefit posting; the full benefit is recognized once. */
export const employerContributionCandidate = (state: AuthoritativeState, input: {
  readonly id: string; readonly at: Instant; readonly accountId: AccountId; readonly positionId: PositionId;
  readonly requested: Money; readonly vestedFraction: string; readonly policy: ContributionPolicy; readonly quantityRounding: RoundingPolicy;
}): { readonly state: AuthoritativeState; readonly transaction: AccountingTransaction; readonly decision: ContributionBucketDecision } => {
  if (input.policy.character !== "employer_401k" && input.policy.character !== "employer_hsa") return invalid("Employer contribution character required");
  const fraction = decimal(input.vestedFraction);
  if (fraction.isNegative() || fraction.compare(decimal("1")) > 0 || input.policy.character === "employer_hsa" && !fraction.equals(decimal("1"))) return invalid("Unsupported employer vesting fraction");
  const decision = decideContribution(state, input.policy, input.accountId, input.at, input.requested);
  if (decision.accepted.isZero()) return invalid("Employer contribution exceeds capacity");
  const position = state.positions[input.positionId];
  if (!position || position.accountId !== input.accountId || !position.price.isPositive()) return invalid("Employer destination requires a positive executable position price");
  const owned = decision.accepted.times(fraction).round(RoundingPolicy.currency(decision.accepted.currency.minorUnitScale, "half_even"));
  const contingent = decision.accepted.minus(owned);
  const legs: AccountingLegDraft[] = [];
  for (const [type, amount] of [["asset", owned], ["contingent", contingent]] as const) if (amount.isPositive()) {
    const quantity = new Quantity(amount.amount.dividedBy(position.price.amount, input.quantityRounding), position.quantity.unit);
    if (!position.price.times(quantity.amount).round(RoundingPolicy.currency(amount.currency.minorUnitScale, "half_even")).equals(amount)) return invalid("Employer units do not reconcile to posted benefit");
    legs.push({ type, posting: "debit", amount, entityId: input.positionId, quantity });
  }
  legs.push({ type: "income", posting: "credit", amount: decision.accepted });
  const transaction = createAccountingTransaction({ id: accountingTransactionId(input.id), date: input.at, type: "employer_retirement_contribution", legs: legs.map(createAccountingLeg),
    traceRefs: [calculationTraceRef(calculationTraceId(`contribution:${input.id}`), input.policy.limits.map(binding => domainId("tax-rule", binding.ruleId)))] });
  const candidate = cloneAuthoritativeState(state);
  applyAccountingTransactionAtomically(candidate, transaction);
  const committed = recordContribution(candidate, input.policy, input.accountId, input.id, input.at, decision);
  committed.contributions![input.id] = Object.freeze({ ...committed.contributions![input.id]!, employerBenefit: Object.freeze({ positionId: input.positionId, vestedAtContribution: owned, contingentAtContribution: contingent }) });
  return { state: committed, transaction, decision };
};

/** Full supported vesting/forfeiture reclassifies then-current contingent value only. */
export const contingentReclassificationCandidate = (state: AuthoritativeState, positionId: PositionId, id: string, at: Instant, kind: "vest" | "forfeit") => {
  const entry = state.contingentPositions?.[positionId], position = state.positions[positionId];
  if (!entry || !position || !entry.quantity.amount.isPositive()) return invalid("No contingent position is available");
  const value = position.price.times(entry.quantity.amount).round(RoundingPolicy.currency(position.price.currency.minorUnitScale, "half_even"));
  const candidate = cloneAuthoritativeState(state);
  // Carrying value is rebased to current supported value without income or owned gain.
  candidate.contingentPositions![positionId] = { ...entry, carryingValue: value };
  const debit: AccountingLegDraft = kind === "vest" ? { type: "asset", posting: "debit", amount: value, entityId: positionId, quantity: entry.quantity } : { type: "equity", posting: "debit", amount: value };
  const legs: AccountingLegDraft[] = [debit, { type: "contingent", posting: "credit", amount: value, entityId: positionId, quantity: entry.quantity }];
  const transaction = createAccountingTransaction({ id: accountingTransactionId(id), date: at, type: kind === "vest" ? "workplace_vesting" : "workplace_forfeiture", legs: legs.map(createAccountingLeg) });
  applyAccountingTransactionAtomically(candidate, transaction);
  return { state: candidate, transaction, value };
};
