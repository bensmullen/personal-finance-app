import { type Instant, type Period, inPeriod, subtractMilliseconds } from "../time/index.js";
import { domainId, generatedOccurrenceKey, type DomainId, type GeneratedOccurrenceKey } from "../identity/index.js";
import {
  accountingTransactionId,
  createAccountingLeg,
  createAccountingTransaction,
  type AccountingLegDraft,
  type AccountingTransaction,
} from "../accounting/index.js";
import { failValidation, issueCodes, type ValidationIssue } from "../diagnostics/index.js";
import {
  isAcceptedFundingResolution,
  resolveFunding,
  type ConstraintOutcome,
  type FundingPolicy,
  type LiquidityShortfall,
} from "../funding/index.js";
import {
  applySettlement,
  claimId,
  createObligation,
  createRecognitionFact,
  createSemanticEffect,
  createSettlement,
  createSettlementProposal,
  recognitionId,
  semanticEffectId,
  settlementId,
  settlementProposalId,
  type Obligation,
  type RecognitionFact,
  type SemanticEffect,
  type Settlement,
  type SettlementProposal,
} from "../semantics/index.js";
import {
  applyAccountingTransactionAtomically,
  assertAuthoritativeStateCurrency,
  cloneAuthoritativeState,
  createAuthoritativeState,
  registerAuthoritativeIdentity,
  type AccountState,
  type AuthoritativeState,
  type LiabilityState,
} from "../state/index.js";
import {
  assertObservedFactWithinDataCutoff,
  assertRunContext,
  createInputFingerprint,
  createRunMetadata,
  type RunContext,
  type RunMetadata,
} from "./run.js";
import {
  createFactProvenance,
  isObservedFact,
  type FactProvenance,
  type ModelGeneratedFactProvenance,
} from "../model/provenance.js";
import {
  type Currency,
  Money,
  RoundingPolicy,
  USD,
  sumMoney,
} from "../values/index.js";
import { evaluatePrimitive } from "../primitives/index.js";
import { freezeTraceRefs, type CalculationTraceRef } from "../lineage/index.js";
import {
  calculateProportionalTax,
  evaluateAnnualContributionLimit,
  evaluateProductOperationEligibility,
  resolveEffectiveRule,
  type ContributionLimitDecision,
  type FinancialRuleId,
  type ProductEligibilityDecision,
  type RuleApplication,
  type RuleCatalog,
} from "../rules/index.js";
import { deriveVerticalSliceStatements, type VerticalSliceStatements } from "../statements/index.js";

export { instant, period, utcMonth, type Period } from "../time/index.js";
export { domainId, type DomainId } from "../identity/index.js";
export { Money, Percentage, Ratio, RoundingPolicy, formatMoney, money } from "../values/index.js";
export { claimStatus } from "../semantics/claim.js";
export { summarizeCashFlowClass } from "../accounting/index.js";
export { createFundingPolicy, fundingPolicyId } from "../funding/index.js";
export type { ValidationIssue } from "../diagnostics/index.js";
export type { FundingPolicy, ConstraintOutcome, LiquidityShortfall } from "../funding/index.js";
export type { RecognitionFact, Obligation, SettlementProposal, Settlement, SemanticEffect } from "../semantics/index.js";
export type { AccountingTransaction } from "../accounting/index.js";
export { createRunContext, runId, scenarioId } from "./run.js";
export type { RunContext, RunMetadata } from "./run.js";
export type { FactProvenance } from "../model/provenance.js";
export type { AccountState, LiabilityState, AuthoritativeState } from "../state/index.js";

export type HouseholdId = DomainId<"household">;
export type PersonId = DomainId<"person">;
export type AccountId = DomainId<"account">;
export type LiabilityId = DomainId<"liability">;

export type SliceState = AuthoritativeState;

export interface VerticalSliceInput {
  readonly householdId: HouseholdId;
  readonly ownerId: PersonId;
  readonly checkingAccountId: AccountId;
  readonly retirementAccountId: AccountId;
  readonly taxLiabilityId: LiabilityId;
  readonly monthlyGrossCompensation: Money;
  readonly ruleCatalog: RuleCatalog;
  readonly incomeTaxRuleIds: readonly FinancialRuleId[];
  readonly retirementContribution: Money;
  readonly retirementEligibilityRuleIds: readonly FinancialRuleId[];
  readonly retirementContributionLimitRuleIds: readonly FinancialRuleId[];
  readonly retirementContributionUsage: { readonly calendarYear: number; readonly usedBeforePeriod: Money };
  readonly monthlyLivingExpense: Money;
  readonly taxFundingPolicy: FundingPolicy;
  readonly settleCurrentTax?: boolean;
  readonly currency?: Currency;
}

export interface TaxSettlementRequest {
  readonly settlementId: string;
  readonly proposalId?: string;
  readonly obligationId: string;
  readonly amount: Money;
  readonly date: Instant;
  readonly fundingPolicy?: FundingPolicy;
  readonly provenance?: FactProvenance;
}

export interface VerticalSlicePeriodInput {
  readonly period: Period;
  readonly input: VerticalSliceInput;
  readonly openingState: SliceState;
  readonly runContext: RunContext;
  readonly taxSettlements?: readonly TaxSettlementRequest[];
}

export type Statements = VerticalSliceStatements;

export interface VerticalSliceResult {
  readonly status: "completed";
  readonly runMetadata: RunMetadata;
  readonly requestedHorizon: Period;
  readonly reachedThrough: Instant;
  readonly state: SliceState;
  readonly effects: readonly SemanticEffect[];
  readonly recognitions: readonly RecognitionFact[];
  readonly settlementProposals: readonly SettlementProposal[];
  readonly settlements: readonly Settlement[];
  readonly constraintOutcomes: readonly ConstraintOutcome[];
  readonly liquidityShortfalls: readonly LiquidityShortfall[];
  readonly transactions: readonly AccountingTransaction[];
  readonly diagnostics: readonly ValidationIssue[];
  readonly dependencyOrder: readonly string[];
  readonly statements: Statements;
  readonly outputs: {
    readonly grossCompensation: Money;
    readonly taxExpense: Money;
    readonly taxPayable: Money;
    readonly retirementContribution: Money;
    readonly retirementContributionUsageAfterPeriod: Money;
    readonly livingExpenses: Money;
    readonly checkingCash: Money;
    readonly retirementCash: Money;
    readonly consolidatedCash: Money;
  };
  readonly ruleApplications: readonly RuleApplication<Money | ContributionLimitDecision | ProductEligibilityDecision>[];
  readonly traceRefs: readonly CalculationTraceRef[];
}

export const verticalSlicePostingRounding = (currency: Currency): RoundingPolicy =>
  RoundingPolicy.currency(currency.minorUnitScale, "half_up");

export const calculateTax = calculateProportionalTax;

const validateState = (state: SliceState, input: VerticalSliceInput): void => {
  const checking = state.accounts[input.checkingAccountId];
  const retirement = state.accounts[input.retirementAccountId];
  if (!checking || !retirement) throw new Error("Required cash accounts are missing");
  if (!state.liabilities[input.taxLiabilityId]) throw new Error("Required tax liability is missing");
  if (checking.ownerId !== input.ownerId || retirement.ownerId !== input.ownerId) throw new Error("Retirement transfer requires common household ownership");
  const currency = input.currency ?? USD;
  for (const amount of [input.monthlyGrossCompensation, input.retirementContribution, input.retirementContributionUsage.usedBeforePeriod, input.monthlyLivingExpense]) {
    if (amount.isNegative()) throw new Error("Domain amounts cannot be negative");
    if (!amount.currency.equals(currency)) throw new Error("Input money must use the model currency");
    if (!amount.amount.fitsScale(currency.minorUnitScale)) throw new Error("Vertical Slice 1 posted inputs must use currency settlement precision");
  }
  if (!Number.isSafeInteger(input.retirementContributionUsage.calendarYear)) throw new Error("Contribution usage requires an explicit calendar year");
};

const transaction = (id: string, date: Instant, type: string, legs: readonly AccountingLegDraft[], traceRefs?: readonly CalculationTraceRef[]): AccountingTransaction =>
  createAccountingTransaction({ id: accountingTransactionId(id), date, type, legs: legs.map((leg) => createAccountingLeg({ ...leg, ...(traceRefs === undefined ? {} : { traceRefs: leg.traceRefs ?? traceRefs }) })), ...(traceRefs === undefined ? {} : { traceRefs }) });

const canonicalPolicyInput = (input: VerticalSliceInput): unknown => Object.freeze({
  ...input,
  ruleCatalog: Object.freeze([...input.ruleCatalog].sort((left, right) => left.id.localeCompare(right.id))),
  incomeTaxRuleIds: Object.freeze([...input.incomeTaxRuleIds].sort()),
  retirementEligibilityRuleIds: Object.freeze([...input.retirementEligibilityRuleIds].sort()),
  retirementContributionLimitRuleIds: Object.freeze([...input.retirementContributionLimitRuleIds].sort()),
});

const projectedBalancesFrom = (state: SliceState): Record<string, Money> =>
  Object.fromEntries(Object.entries(state.accounts).map(([id, account]) => [id, account.cash]));

interface PeriodAction {
  readonly at: Instant;
  readonly stableKey: string;
  readonly execute: () => void;
}

const primitiveInstanceIds = Object.freeze({
  compensation: domainId("primitive-instance", "10000000-0000-4000-8000-000000000001"),
  taxRecognition: domainId("primitive-instance", "10000000-0000-4000-8000-000000000002"),
  taxSettlement: domainId("primitive-instance", "10000000-0000-4000-8000-000000000003"),
  retirement: domainId("primitive-instance", "10000000-0000-4000-8000-000000000004"),
  livingExpense: domainId("primitive-instance", "10000000-0000-4000-8000-000000000005"),
});

export function runVerticalSlicePeriod(request: VerticalSlicePeriodInput): VerticalSliceResult {
  assertRunContext(request.runContext);
  if (request.period.start !== request.runContext.simulationStart || request.period.end !== request.runContext.simulationEnd) {
    failValidation({ severity: "error", code: issueCodes.invalidRunContext, message: "Vertical Slice period must match the run context horizon", entityType: "run_context", fieldPath: "simulationStart" });
  }
  const state = cloneAuthoritativeState(request.openingState);
  const input = request.input;
  const currency = input.currency ?? USD;
  if (!currency.equals(request.runContext.baseCurrency)) {
    failValidation({ severity: "error", code: issueCodes.runBaseCurrencyMismatch, message: `Vertical Slice currency ${currency.code} does not match run base currency ${request.runContext.baseCurrency.code}`, entityType: "run_context", fieldPath: "baseCurrency", relatedIds: [currency.code, request.runContext.baseCurrency.code] });
  }
  assertAuthoritativeStateCurrency(state, request.runContext.baseCurrency);
  const inputFingerprint = createInputFingerprint({
    runContext: request.runContext,
    openingState: state,
    scenario: {
      input: canonicalPolicyInput(request.input),
      taxSettlements: [...(request.taxSettlements ?? [])]
        .sort((left, right) => left.date.localeCompare(right.date)
          || left.settlementId.localeCompare(right.settlementId)
          || (left.proposalId ?? "").localeCompare(right.proposalId ?? "")),
    },
  });
  const runMetadata = createRunMetadata(request.runContext, inputFingerprint);
  const postingRounding = verticalSlicePostingRounding(currency);
  validateState(state, input);

  const compensationAt = subtractMilliseconds(request.period.end, 5);
  const taxRecognitionAt = subtractMilliseconds(request.period.end, 4);
  const taxSettlementAt = subtractMilliseconds(request.period.end, 3);
  const retirementAt = subtractMilliseconds(request.period.end, 2);
  const livingExpenseAt = subtractMilliseconds(request.period.end, 1);
  const effects: SemanticEffect[] = [];
  const recognitions: RecognitionFact[] = [];
  const settlementProposals: SettlementProposal[] = [];
  const settlements: Settlement[] = [];
  const constraintOutcomes: ConstraintOutcome[] = [];
  const liquidityShortfalls: LiquidityShortfall[] = [];
  const transactions: AccountingTransaction[] = [];
  const diagnostics: ValidationIssue[] = [];
  const ruleApplications: RuleApplication<Money | ContributionLimitDecision | ProductEligibilityDecision>[] = [];
  const actions: PeriodAction[] = [];
  let taxAmount = Money.zero(currency);
  let retirementContribution = Money.zero(currency);
  let taxTraceRefs: readonly CalculationTraceRef[] = Object.freeze([]);

  const addTransaction = (tx: AccountingTransaction): void => {
    transactions.push(tx);
    applyAccountingTransactionAtomically(state, tx);
  };
  const generatedProvenance = (
    primitiveInstanceId: DomainId<"primitive-instance">,
    at: Instant,
    semanticEffectType: string,
    economicTargetId: DomainId<string>,
  ): ModelGeneratedFactProvenance & { readonly generatedOccurrenceKey: GeneratedOccurrenceKey } => {
    const occurrenceKey = generatedOccurrenceKey({
      scenarioId: request.runContext.scenarioId,
      primitiveInstanceId,
      scheduledAt: at,
      semanticEffectType,
      economicTargetId,
    });
    registerAuthoritativeIdentity(state.identities, "generatedOccurrenceKeys", occurrenceKey);
    return createFactProvenance({
      factKind: "model_generated",
      sourceType: "model",
      sourceId: primitiveInstanceId,
      effectiveAt: at,
      generatedOccurrenceKey: occurrenceKey,
    }) as ModelGeneratedFactProvenance & { readonly generatedOccurrenceKey: GeneratedOccurrenceKey };
  };

  const processTaxSettlement = (
    settlementRequest: TaxSettlementRequest,
    policy: FundingPolicy,
    suppliedProvenance?: FactProvenance,
    ruleTraceRefs?: readonly CalculationTraceRef[],
  ): void => {
    const provenance = createFactProvenance(suppliedProvenance ?? settlementRequest.provenance ?? {
      factKind: "authoritative_input",
      sourceType: "user",
      sourceId: settlementRequest.settlementId,
      effectiveAt: settlementRequest.date,
    });
    assertObservedFactWithinDataCutoff(provenance, request.runContext);
    if (isObservedFact(provenance)) {
      registerAuthoritativeIdentity(state.identities, "externalIdempotencyKeys", provenance.idempotencyKey);
    }
    const obligation = state.obligations[settlementRequest.obligationId];
    if (!obligation) {
      failValidation({ severity: "error", code: issueCodes.settlementClaimNotFound, message: `Missing obligation ${settlementRequest.obligationId}`, entityType: "claim", entityId: settlementRequest.obligationId });
    }
    const claim = obligation as Obligation;
    const balanceEntityId = claim.balanceEntityId;
    if (balanceEntityId === undefined) {
      failValidation({
        severity: "error",
        code: issueCodes.settlementLiabilityTargetInvalid,
        message: `Tax claim ${claim.id} must identify an available liability target`,
        entityType: "claim",
        entityId: claim.id,
        fieldPath: "balanceEntityId",
      });
    }
    const linkedLiability = state.liabilities[balanceEntityId];
    if (linkedLiability === undefined || linkedLiability.id !== balanceEntityId) {
      failValidation({
        severity: "error",
        code: issueCodes.settlementLiabilityTargetInvalid,
        message: `Tax claim ${claim.id} must identify an available liability target`,
        entityType: "claim",
        entityId: claim.id,
        fieldPath: "balanceEntityId",
        relatedIds: [balanceEntityId],
      });
    }
    const liabilityTarget = linkedLiability.id;
    const proposal = createSettlementProposal({
      id: settlementProposalId(settlementRequest.proposalId ?? `proposal:${settlementRequest.settlementId}`),
      claimId: claim.id,
      requestedAmount: settlementRequest.amount,
      requestedAt: settlementRequest.date,
      fundingPolicyId: policy.id,
      provenance,
      ...(ruleTraceRefs === undefined ? {} : { traceRefs: ruleTraceRefs }),
    }, claim);
    settlementProposals.push(proposal);
    const funding = resolveFunding(proposal, claim, policy, projectedBalancesFrom(state), settlementRequest.date);
    constraintOutcomes.push(funding.outcome);
    diagnostics.push(...funding.issues);
    if (funding.liquidityShortfall !== undefined) liquidityShortfalls.push(funding.liquidityShortfall);
    if (!isAcceptedFundingResolution(funding)) return;
    const acceptedSettlement = createSettlement({
      id: settlementId(settlementRequest.settlementId),
      settledAt: settlementRequest.date,
      provenance,
    }, funding, claim, state.identities.settlementIds);
    registerAuthoritativeIdentity(state.identities, "settlementIds", acceptedSettlement.id);
    settlements.push(acceptedSettlement);
    const updated = applySettlement(claim, acceptedSettlement) as Obligation;
    state.obligations[updated.id] = updated;
    effects.push(createSemanticEffect({ id: semanticEffectId(`effect:${acceptedSettlement.id}`), kind: "settlement", category: "tax", amount: acceptedSettlement.amount, occurredAt: acceptedSettlement.settledAt, claimId: acceptedSettlement.claimId, settlementId: acceptedSettlement.id, provenance, ...(ruleTraceRefs === undefined ? {} : { traceRefs: ruleTraceRefs }) }));
    addTransaction(transaction(`tx:tax-settlement:${acceptedSettlement.id}`, acceptedSettlement.settledAt, "tax_settlement", [
      { posting: "debit", type: "liability", amount: acceptedSettlement.amount, entityId: liabilityTarget },
      ...acceptedSettlement.fundingAllocations.map((allocation): AccountingLegDraft => ({ posting: "credit", type: "cash", amount: allocation.amount, accountId: allocation.accountId, cashFlowClass: "operating" })),
    ], ruleTraceRefs));
  };

  actions.push({
    at: compensationAt,
    stableKey: "10:compensation",
    execute: () => {
      if (!input.monthlyGrossCompensation.isPositive()) return;
      const provenance = generatedProvenance(primitiveInstanceIds.compensation, compensationAt, "recognition", input.ownerId);
      const compensationRecognition = createRecognitionFact({ id: recognitionId(`recognition:compensation:${request.period.start}`), category: "compensation", amount: input.monthlyGrossCompensation, recognizedAt: compensationAt, sourceOccurrenceKey: provenance.generatedOccurrenceKey, provenance }, state.identities.recognitionIds);
      registerAuthoritativeIdentity(state.identities, "recognitionIds", compensationRecognition.id);
      recognitions.push(compensationRecognition);
      effects.push(createSemanticEffect({ id: semanticEffectId(`effect:compensation:${request.period.start}`), kind: "recognition", category: "compensation", amount: input.monthlyGrossCompensation, occurredAt: compensationAt, sourceOccurrenceKey: provenance.generatedOccurrenceKey, recognitionId: compensationRecognition.id, provenance }));
      addTransaction(transaction(`tx:compensation:${request.period.start}`, compensationAt, "income", [
        { posting: "debit", type: "cash", amount: input.monthlyGrossCompensation, accountId: input.checkingAccountId, cashFlowClass: "operating" },
        { posting: "credit", type: "income", amount: input.monthlyGrossCompensation },
      ]));
    },
  });

  actions.push({
    at: taxRecognitionAt,
    stableKey: "20:tax-recognition",
    execute: () => {
      const rule = resolveEffectiveRule(input.ruleCatalog, input.incomeTaxRuleIds, "proportional_income_tax", { targetType: "person", targetId: input.ownerId }, taxRecognitionAt);
      const evaluated = evaluatePrimitive({ primitiveId: "P20", input: { taxableBase: input.monthlyGrossCompensation, resolvedRule: rule }, priorState: null, context: { period: request.period, evaluationInstant: taxRecognitionAt, scenarioId: request.runContext.scenarioId, primitiveInstanceId: primitiveInstanceIds.taxRecognition, economicTargetId: input.ownerId, semanticEffectType: "tax-calculation" } });
      const output = evaluated.output;
      taxAmount = output.tax;
      taxTraceRefs = evaluated.traceRefs ?? Object.freeze([]);
      ruleApplications.push(output.application);
      if (!taxAmount.isPositive()) return;
      const provenance = generatedProvenance(primitiveInstanceIds.taxRecognition, taxRecognitionAt, "recognition", input.taxLiabilityId);
      const taxRecognition = createRecognitionFact({ id: recognitionId(`recognition:tax:${request.period.start}`), category: "tax_expense", amount: taxAmount, recognizedAt: taxRecognitionAt, sourceOccurrenceKey: provenance.generatedOccurrenceKey, provenance, traceRefs: taxTraceRefs }, state.identities.recognitionIds);
      registerAuthoritativeIdentity(state.identities, "recognitionIds", taxRecognition.id);
      recognitions.push(taxRecognition);
      const obligation = createObligation({
        id: claimId(`obligation:${taxRecognition.id}`),
        category: "tax_payable",
        originatingRecognitionId: taxRecognition.id,
        economicOwnerId: input.ownerId,
        balanceEntityId: input.taxLiabilityId,
        originalAmount: taxRecognition.amount,
        recognizedAt: taxRecognition.recognizedAt,
      }, Object.values(state.obligations));
      state.obligations[obligation.id] = obligation;
      effects.push(createSemanticEffect({ id: semanticEffectId(`effect:tax-obligation:${request.period.start}`), kind: "claim", category: "tax", amount: taxAmount, occurredAt: taxRecognitionAt, sourceOccurrenceKey: provenance.generatedOccurrenceKey, recognitionId: taxRecognition.id, claimId: obligation.id, provenance, traceRefs: taxTraceRefs }));
      addTransaction(transaction(`tx:tax-accrual:${request.period.start}`, taxRecognitionAt, "tax_accrual", [
        { posting: "debit", type: "tax", amount: taxAmount },
        { posting: "credit", type: "liability", amount: taxAmount, entityId: input.taxLiabilityId },
      ], taxTraceRefs));
    },
  });

  actions.push({
    at: taxSettlementAt,
    stableKey: "30:current-tax-settlement",
    execute: () => {
      if (!taxAmount.isPositive() || input.settleCurrentTax === false) return;
      const provenance = generatedProvenance(primitiveInstanceIds.taxSettlement, taxSettlementAt, "settlement", input.taxLiabilityId);
      processTaxSettlement({
        settlementId: `settlement:tax:${request.period.start}`,
        obligationId: `obligation:recognition:tax:${request.period.start}`,
        amount: taxAmount,
        date: taxSettlementAt,
      }, input.taxFundingPolicy, provenance, taxTraceRefs);
    },
  });

  actions.push({
    at: retirementAt,
    stableKey: "40:retirement",
    execute: () => {
      const eligibilityRule = resolveEffectiveRule(input.ruleCatalog, input.retirementEligibilityRuleIds, "product_operation_eligibility", { targetType: "account", targetId: input.retirementAccountId }, retirementAt);
      if (eligibilityRule.operation !== "contribution") failValidation({ severity: "error", code: issueCodes.ruleTargetMismatch, message: `Rule ${eligibilityRule.id} does not govern contributions`, entityType: "financial_rule", entityId: eligibilityRule.id, fieldPath: "operation" });
      const eligibility = evaluateProductOperationEligibility(eligibilityRule, retirementAt);
      ruleApplications.push(eligibility);
      diagnostics.push(...eligibility.result.diagnostics);
      if (!eligibility.result.allowed) return;
      const limitRule = resolveEffectiveRule(input.ruleCatalog, input.retirementContributionLimitRuleIds, "annual_contribution_limit", { targetType: "account", targetId: input.retirementAccountId }, retirementAt);
      if (input.retirementContributionUsage.calendarYear !== limitRule.calendarYear) failValidation({ severity: "error", code: issueCodes.ruleTargetMismatch, message: "Contribution usage year must match the active annual-limit rule", entityType: "rule_binding", fieldPath: "retirementContributionUsage.calendarYear", relatedIds: [limitRule.id] });
      const limit = evaluateAnnualContributionLimit(limitRule, input.retirementContribution, input.retirementContributionUsage.usedBeforePeriod, retirementAt);
      ruleApplications.push(limit);
      diagnostics.push(...limit.result.diagnostics);
      retirementContribution = limit.result.accepted;
      const contributionTraceRefs = freezeTraceRefs([...eligibility.traceRefs, ...limit.traceRefs])!;
      if (!retirementContribution.isPositive()) return;
      const provenance = generatedProvenance(primitiveInstanceIds.retirement, retirementAt, "flow", input.retirementAccountId);
      effects.push(createSemanticEffect({ id: semanticEffectId(`effect:retirement:${request.period.start}`), kind: "flow", category: "retirement_transfer", amount: retirementContribution, occurredAt: retirementAt, sourceOccurrenceKey: provenance.generatedOccurrenceKey, provenance, traceRefs: contributionTraceRefs }));
      addTransaction(transaction(`tx:retirement:${request.period.start}`, retirementAt, "internal_transfer", [
        { posting: "debit", type: "cash", amount: retirementContribution, accountId: input.retirementAccountId, cashFlowClass: "non_cash" },
        { posting: "credit", type: "cash", amount: retirementContribution, accountId: input.checkingAccountId, cashFlowClass: "non_cash" },
      ], contributionTraceRefs));
    },
  });

  actions.push({
    at: livingExpenseAt,
    stableKey: "50:living-expense",
    execute: () => {
      if (!input.monthlyLivingExpense.isPositive()) return;
      const provenance = generatedProvenance(primitiveInstanceIds.livingExpense, livingExpenseAt, "recognition", input.ownerId);
      const livingRecognition = createRecognitionFact({ id: recognitionId(`recognition:living:${request.period.start}`), category: "living_expense", amount: input.monthlyLivingExpense, recognizedAt: livingExpenseAt, sourceOccurrenceKey: provenance.generatedOccurrenceKey, provenance }, state.identities.recognitionIds);
      registerAuthoritativeIdentity(state.identities, "recognitionIds", livingRecognition.id);
      recognitions.push(livingRecognition);
      effects.push(createSemanticEffect({ id: semanticEffectId(`effect:living:${request.period.start}`), kind: "recognition", category: "living_expense", amount: input.monthlyLivingExpense, occurredAt: livingExpenseAt, sourceOccurrenceKey: provenance.generatedOccurrenceKey, recognitionId: livingRecognition.id, provenance }));
      addTransaction(transaction(`tx:living:${request.period.start}`, livingExpenseAt, "expense", [
        { posting: "debit", type: "expense", amount: input.monthlyLivingExpense },
        { posting: "credit", type: "cash", amount: input.monthlyLivingExpense, accountId: input.checkingAccountId, cashFlowClass: "operating" },
      ]));
    },
  });

  for (const settlementRequest of request.taxSettlements ?? []) {
    if (!inPeriod(settlementRequest.date, request.period)) continue;
    actions.push({
      at: settlementRequest.date,
      stableKey: `60:external-tax-settlement:${settlementRequest.settlementId}:${settlementRequest.proposalId ?? ""}`,
      execute: () => processTaxSettlement(settlementRequest, settlementRequest.fundingPolicy ?? input.taxFundingPolicy),
    });
  }

  actions
    .sort((left, right) => left.at.localeCompare(right.at) || left.stableKey.localeCompare(right.stableKey))
    .forEach((action) => action.execute());

  transactions.sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
  for (const tx of transactions) if (!inPeriod(tx.date, request.period)) throw new Error(`Transaction ${tx.id} is outside period`);

  const consolidatedCash = sumMoney(Object.values(state.accounts).map((account) => account.cash), currency);
  const statements = deriveVerticalSliceStatements(state, transactions, currency);
  const dependencyOrder = Object.freeze(["compensation", "tax_calculation", "tax_recognition", "tax_obligation", "tax_settlement", "retirement_contribution", "available_cash", "living_expense"]);

  return Object.freeze({
    status: "completed",
    runMetadata,
    requestedHorizon: request.period,
    reachedThrough: request.period.end,
    state,
    effects: Object.freeze(effects),
    recognitions: Object.freeze(recognitions),
    settlementProposals: Object.freeze(settlementProposals),
    settlements: Object.freeze(settlements),
    constraintOutcomes: Object.freeze(constraintOutcomes),
    liquidityShortfalls: Object.freeze(liquidityShortfalls),
    transactions: Object.freeze(transactions),
    diagnostics: Object.freeze(diagnostics),
    ruleApplications: Object.freeze(ruleApplications),
    traceRefs: freezeTraceRefs([...new Map(ruleApplications.flatMap((application) => application.traceRefs).map((ref) => [ref.traceId, ref])).values()])!,
    dependencyOrder,
    statements,
    outputs: Object.freeze({
      grossCompensation: input.monthlyGrossCompensation,
      taxExpense: taxAmount,
      taxPayable: state.liabilities[input.taxLiabilityId]!.balance,
      retirementContribution,
      retirementContributionUsageAfterPeriod: input.retirementContributionUsage.usedBeforePeriod.plus(retirementContribution),
      livingExpenses: input.monthlyLivingExpense,
      checkingCash: state.accounts[input.checkingAccountId]!.cash,
      retirementCash: state.accounts[input.retirementAccountId]!.cash,
      consolidatedCash,
    }),
  });
}

export const canonicalOpeningState = (input: VerticalSliceInput): SliceState => {
  const currency = input.currency ?? USD;
  return createAuthoritativeState({
    accounts: {
      [input.checkingAccountId]: { id: input.checkingAccountId, ownerId: input.ownerId, kind: "checking", cash: Money.zero(currency) },
      [input.retirementAccountId]: { id: input.retirementAccountId, ownerId: input.ownerId, kind: "retirement", cash: Money.zero(currency) },
    },
    positions: {},
    liabilities: { [input.taxLiabilityId]: { id: input.taxLiabilityId, balance: Money.zero(currency) } },
    obligations: {},
  });
};
