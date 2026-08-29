import { type Instant, type Period, inPeriod, subtractMilliseconds } from "./time.js";
import type { DomainId } from "./identity.js";
import {
  accountingTransactionId,
  cashFlowAmount,
  createAccountingLeg,
  createAccountingTransaction,
  type AccountingLegDraft,
  type AccountingTransaction,
} from "./accounting.js";
import { failValidation, issueCodes, type ValidationIssue } from "./diagnostics.js";
import {
  resolveFunding,
  type ConstraintOutcome,
  type FundingPolicy,
  type LiquidityShortfall,
} from "./funding.js";
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
} from "./semantics.js";
import {
  type Currency,
  Money,
  Ratio,
  RoundingPolicy,
  USD,
  decimal,
  sumMoney,
} from "./values.js";

export { instant, period, utcMonth, type Period } from "./time.js";
export { domainId, type DomainId } from "./identity.js";
export { Money, Percentage, Ratio, RoundingPolicy, formatMoney, money } from "./values.js";
export { claimStatus } from "./semantics.js";
export { summarizeCashFlowClass } from "./accounting.js";
export { createFundingPolicy, fundingPolicyId } from "./funding.js";
export type { ValidationIssue } from "./diagnostics.js";
export type { FundingPolicy, ConstraintOutcome, LiquidityShortfall } from "./funding.js";
export type { RecognitionFact, Obligation, SettlementProposal, Settlement, SemanticEffect } from "./semantics.js";
export type { AccountingTransaction } from "./accounting.js";

export type HouseholdId = DomainId<"household">;
export type PersonId = DomainId<"person">;
export type AccountId = DomainId<"account">;
export type LiabilityId = DomainId<"liability">;

export interface AccountState {
  readonly id: AccountId;
  readonly ownerId: PersonId;
  readonly kind: "checking" | "retirement";
  cash: Money;
}

export interface LiabilityState { readonly id: LiabilityId; balance: Money; }

export interface SliceState {
  accounts: Record<string, AccountState>;
  liabilities: Record<string, LiabilityState>;
  obligations: Record<string, Obligation>;
  postedTransactionIds: string[];
}

export interface VerticalSliceInput {
  readonly householdId: HouseholdId;
  readonly ownerId: PersonId;
  readonly checkingAccountId: AccountId;
  readonly retirementAccountId: AccountId;
  readonly taxLiabilityId: LiabilityId;
  readonly monthlyGrossCompensation: Money;
  readonly taxRate: Ratio;
  readonly retirementContribution: Money;
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
}

export interface VerticalSlicePeriodInput {
  readonly period: Period;
  readonly input: VerticalSliceInput;
  readonly openingState: SliceState;
  readonly taxSettlements?: readonly TaxSettlementRequest[];
}

export interface Statements {
  readonly assets: Money;
  readonly liabilities: Money;
  readonly netWorth: Money;
  readonly income: Money;
  readonly expenses: Money;
  readonly netIncome: Money;
  readonly operatingCashFlow: Money;
}

export interface VerticalSliceResult {
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
    readonly livingExpenses: Money;
    readonly checkingCash: Money;
    readonly retirementCash: Money;
    readonly consolidatedCash: Money;
  };
}

const cloneState = (state: SliceState): SliceState => ({
  accounts: Object.fromEntries(Object.entries(state.accounts).map(([key, value]) => [key, { ...value }])),
  liabilities: Object.fromEntries(Object.entries(state.liabilities).map(([key, value]) => [key, { ...value }])),
  obligations: { ...state.obligations },
  postedTransactionIds: [...state.postedTransactionIds],
});

export const verticalSlicePostingRounding = (currency: Currency): RoundingPolicy =>
  RoundingPolicy.currency(currency.minorUnitScale, "half_up");

export const calculateTax = (base: Money, taxRate: Ratio, postingRounding: RoundingPolicy): Money => {
  if (taxRate.value.isNegative() || taxRate.value.compare(decimal("1")) > 0) throw new Error("Tax ratio must be from 0 to 1");
  if (base.isNegative()) throw new Error("Tax base cannot be negative");
  return new Money(base.amount.times(taxRate.value).round(postingRounding), base.currency);
};

const validateState = (state: SliceState, input: VerticalSliceInput): void => {
  const checking = state.accounts[input.checkingAccountId];
  const retirement = state.accounts[input.retirementAccountId];
  if (!checking || !retirement) throw new Error("Required cash accounts are missing");
  if (!state.liabilities[input.taxLiabilityId]) throw new Error("Required tax liability is missing");
  if (checking.ownerId !== input.ownerId || retirement.ownerId !== input.ownerId) throw new Error("Retirement transfer requires common household ownership");
  const currency = input.currency ?? USD;
  for (const amount of [input.monthlyGrossCompensation, input.retirementContribution, input.monthlyLivingExpense]) {
    if (amount.isNegative()) throw new Error("Domain amounts cannot be negative");
    if (!amount.currency.equals(currency)) throw new Error("Input money must use the model currency");
    if (!amount.amount.fitsScale(currency.minorUnitScale)) throw new Error("Vertical Slice 1 posted inputs must use currency settlement precision");
  }
  if (!input.taxFundingPolicy.orderedSources.some((source) => source.accountId === input.checkingAccountId)) {
    failValidation({ severity: "error", code: issueCodes.fundingPolicyInvalid, message: "Vertical Slice 1 tax policy must explicitly identify the configured checking account when it is intended as a source", entityType: "funding_policy", entityId: input.taxFundingPolicy.id });
  }
  calculateTax(Money.zero(currency), input.taxRate, verticalSlicePostingRounding(currency));
};

const transaction = (id: string, date: Instant, type: string, legs: readonly AccountingLegDraft[]): AccountingTransaction =>
  createAccountingTransaction({ id: accountingTransactionId(id), date, type, legs: legs.map(createAccountingLeg) });

const post = (state: SliceState, tx: AccountingTransaction): void => {
  if (state.postedTransactionIds.includes(tx.id)) {
    failValidation({ severity: "error", code: issueCodes.duplicateTransaction, message: `Duplicate transaction ${tx.id}`, entityType: "accounting_transaction", entityId: tx.id });
  }
  for (const leg of tx.legs) {
    if (leg.type === "cash") {
      const account = state.accounts[leg.accountId];
      if (!account) throw new Error(`Unknown account ${leg.accountId}`);
      account.cash = leg.posting === "debit" ? account.cash.plus(leg.amount) : account.cash.minus(leg.amount);
      if (account.cash.isNegative()) {
        failValidation({ severity: "error", code: issueCodes.negativeCashInvariant, message: `Accepted transaction ${tx.id} creates prohibited negative cash in ${account.id}`, entityType: "account", entityId: account.id, relatedIds: [tx.id] });
      }
    } else if (leg.type === "liability") {
      const liability = state.liabilities[leg.entityId];
      if (!liability) throw new Error(`Unknown liability ${leg.entityId}`);
      liability.balance = leg.posting === "credit" ? liability.balance.plus(leg.amount) : liability.balance.minus(leg.amount);
      if (liability.balance.isNegative()) {
        failValidation({ severity: "error", code: issueCodes.settlementExceedsOutstanding, message: `Accepted transaction ${tx.id} creates a negative liability balance`, entityType: "liability", entityId: liability.id, relatedIds: [tx.id] });
      }
    }
  }
  state.postedTransactionIds.push(tx.id);
};

const projectedBalancesFrom = (state: SliceState): Record<string, Money> =>
  Object.fromEntries(Object.entries(state.accounts).map(([id, account]) => [id, account.cash]));

const applyProjectedCash = (balances: Record<string, Money>, tx: AccountingTransaction): void => {
  for (const leg of tx.legs) {
    if (leg.type !== "cash") continue;
    const balance = balances[leg.accountId];
    if (balance !== undefined) balances[leg.accountId] = leg.posting === "debit" ? balance.plus(leg.amount) : balance.minus(leg.amount);
  }
};

export function runVerticalSlicePeriod(request: VerticalSlicePeriodInput): VerticalSliceResult {
  const state = cloneState(request.openingState);
  const input = request.input;
  const currency = input.currency ?? USD;
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
  const projectedBalances = projectedBalancesFrom(state);
  let taxAmount = Money.zero(currency);

  const addTransaction = (tx: AccountingTransaction): void => { transactions.push(tx); applyProjectedCash(projectedBalances, tx); };
  const knownRecognitionIds = (): string[] => [
    ...recognitions.map((recognition) => recognition.id),
    ...Object.values(state.obligations).map((obligation) => obligation.originatingRecognitionId),
  ];

  const processTaxSettlement = (settlementRequest: TaxSettlementRequest, policy: FundingPolicy): void => {
    const obligation = state.obligations[settlementRequest.obligationId];
    if (!obligation) {
      failValidation({ severity: "error", code: issueCodes.settlementClaimNotFound, message: `Missing obligation ${settlementRequest.obligationId}`, entityType: "claim", entityId: settlementRequest.obligationId });
    }
    const claim = obligation as Obligation;
    const proposal = createSettlementProposal({
      id: settlementProposalId(settlementRequest.proposalId ?? `proposal:${settlementRequest.settlementId}`),
      claimId: claim.id,
      requestedAmount: settlementRequest.amount,
      requestedAt: settlementRequest.date,
      fundingPolicyId: policy.id,
    }, claim);
    settlementProposals.push(proposal);
    const funding = resolveFunding(proposal, claim, policy, projectedBalances, settlementRequest.date);
    constraintOutcomes.push(funding.outcome);
    diagnostics.push(...funding.issues);
    if (funding.liquidityShortfall !== undefined) liquidityShortfalls.push(funding.liquidityShortfall);
    if (!funding.acceptedAmount.isPositive()) return;
    const acceptedSettlement = createSettlement({
      id: settlementId(settlementRequest.settlementId),
      proposalId: proposal.id,
      claimId: claim.id,
      amount: funding.acceptedAmount,
      settledAt: settlementRequest.date,
      fundingAllocations: funding.fundingAllocations,
    }, proposal, claim, settlements.map((settlement) => settlement.id));
    settlements.push(acceptedSettlement);
    const updated = applySettlement(claim, acceptedSettlement) as Obligation;
    state.obligations[updated.id] = updated;
    effects.push(createSemanticEffect({ id: semanticEffectId(`effect:${acceptedSettlement.id}`), kind: "settlement", category: "tax", amount: acceptedSettlement.amount, occurredAt: acceptedSettlement.settledAt, claimId: acceptedSettlement.claimId, settlementId: acceptedSettlement.id }));
    addTransaction(transaction(`tx:tax-settlement:${acceptedSettlement.id}`, acceptedSettlement.settledAt, "tax_settlement", [
      { posting: "debit", type: "liability", amount: acceptedSettlement.amount, entityId: input.taxLiabilityId },
      ...acceptedSettlement.fundingAllocations.map((allocation): AccountingLegDraft => ({ posting: "credit", type: "cash", amount: allocation.amount, accountId: allocation.accountId, cashFlowClass: "operating" })),
    ]));
  };

  if (input.monthlyGrossCompensation.isPositive()) {
    const compensationRecognition = createRecognitionFact({ id: recognitionId(`recognition:compensation:${request.period.start}`), category: "compensation", amount: input.monthlyGrossCompensation, recognizedAt: compensationAt }, knownRecognitionIds());
    recognitions.push(compensationRecognition);
    effects.push(createSemanticEffect({ id: semanticEffectId(`effect:compensation:${request.period.start}`), kind: "recognition", category: "compensation", amount: input.monthlyGrossCompensation, occurredAt: compensationAt, recognitionId: compensationRecognition.id }));
    addTransaction(transaction(`tx:compensation:${request.period.start}`, compensationAt, "income", [
      { posting: "debit", type: "cash", amount: input.monthlyGrossCompensation, accountId: input.checkingAccountId, cashFlowClass: "operating" },
      { posting: "credit", type: "income", amount: input.monthlyGrossCompensation },
    ]));
    taxAmount = calculateTax(input.monthlyGrossCompensation, input.taxRate, postingRounding);
    if (taxAmount.isPositive()) {
      const taxRecognition = createRecognitionFact({ id: recognitionId(`recognition:tax:${request.period.start}`), category: "tax_expense", amount: taxAmount, recognizedAt: taxRecognitionAt }, knownRecognitionIds());
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
      effects.push(createSemanticEffect({ id: semanticEffectId(`effect:tax-obligation:${request.period.start}`), kind: "claim", category: "tax", amount: taxAmount, occurredAt: taxRecognitionAt, recognitionId: taxRecognition.id, claimId: obligation.id }));
      addTransaction(transaction(`tx:tax-accrual:${request.period.start}`, taxRecognitionAt, "tax_accrual", [
        { posting: "debit", type: "tax", amount: taxAmount },
        { posting: "credit", type: "liability", amount: taxAmount, entityId: input.taxLiabilityId },
      ]));
      if (input.settleCurrentTax !== false) {
        processTaxSettlement({ settlementId: `settlement:tax:${request.period.start}`, obligationId: obligation.id, amount: taxAmount, date: taxSettlementAt }, input.taxFundingPolicy);
      }
    }
  }

  if (input.retirementContribution.isPositive()) {
    effects.push(createSemanticEffect({ id: semanticEffectId(`effect:retirement:${request.period.start}`), kind: "flow", category: "retirement_transfer", amount: input.retirementContribution, occurredAt: retirementAt }));
    addTransaction(transaction(`tx:retirement:${request.period.start}`, retirementAt, "internal_transfer", [
      { posting: "debit", type: "cash", amount: input.retirementContribution, accountId: input.retirementAccountId, cashFlowClass: "non_cash" },
      { posting: "credit", type: "cash", amount: input.retirementContribution, accountId: input.checkingAccountId, cashFlowClass: "non_cash" },
    ]));
  }

  if (input.monthlyLivingExpense.isPositive()) {
    const livingRecognition = createRecognitionFact({ id: recognitionId(`recognition:living:${request.period.start}`), category: "living_expense", amount: input.monthlyLivingExpense, recognizedAt: livingExpenseAt }, knownRecognitionIds());
    recognitions.push(livingRecognition);
    effects.push(createSemanticEffect({ id: semanticEffectId(`effect:living:${request.period.start}`), kind: "recognition", category: "living_expense", amount: input.monthlyLivingExpense, occurredAt: livingExpenseAt, recognitionId: livingRecognition.id }));
    addTransaction(transaction(`tx:living:${request.period.start}`, livingExpenseAt, "expense", [
      { posting: "debit", type: "expense", amount: input.monthlyLivingExpense },
      { posting: "credit", type: "cash", amount: input.monthlyLivingExpense, accountId: input.checkingAccountId, cashFlowClass: "operating" },
    ]));
  }

  for (const settlementRequest of request.taxSettlements ?? []) {
    if (inPeriod(settlementRequest.date, request.period)) processTaxSettlement(settlementRequest, settlementRequest.fundingPolicy ?? input.taxFundingPolicy);
  }

  transactions.sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
  for (const tx of transactions) {
    if (!inPeriod(tx.date, request.period)) throw new Error(`Transaction ${tx.id} is outside period`);
    post(state, tx);
  }

  const assets = sumMoney(Object.values(state.accounts).map((account) => account.cash), currency);
  const liabilities = sumMoney(Object.values(state.liabilities).map((liability) => liability.balance), currency);
  const income = sumMoney(transactions.flatMap((tx) => tx.legs.filter((leg) => leg.type === "income" && leg.posting === "credit").map((leg) => leg.amount)), currency);
  const expenses = sumMoney(transactions.flatMap((tx) => tx.legs.filter((leg) => (leg.type === "expense" || leg.type === "tax") && leg.posting === "debit").map((leg) => leg.amount)), currency);
  const operatingCashFlow = sumMoney(transactions.map((tx) => cashFlowAmount(tx, "operating", currency)), currency);
  const dependencyOrder = Object.freeze(["compensation", "tax_calculation", "tax_recognition", "tax_obligation", "tax_settlement", "retirement_contribution", "available_cash", "living_expense"]);

  return Object.freeze({
    state,
    effects: Object.freeze(effects),
    recognitions: Object.freeze(recognitions),
    settlementProposals: Object.freeze(settlementProposals),
    settlements: Object.freeze(settlements),
    constraintOutcomes: Object.freeze(constraintOutcomes),
    liquidityShortfalls: Object.freeze(liquidityShortfalls),
    transactions: Object.freeze(transactions),
    diagnostics: Object.freeze(diagnostics),
    dependencyOrder,
    statements: Object.freeze({ assets, liabilities, netWorth: assets.minus(liabilities), income, expenses, netIncome: income.minus(expenses), operatingCashFlow }),
    outputs: Object.freeze({
      grossCompensation: input.monthlyGrossCompensation,
      taxExpense: taxAmount,
      taxPayable: state.liabilities[input.taxLiabilityId]!.balance,
      retirementContribution: input.retirementContribution,
      livingExpenses: input.monthlyLivingExpense,
      checkingCash: state.accounts[input.checkingAccountId]!.cash,
      retirementCash: state.accounts[input.retirementAccountId]!.cash,
      consolidatedCash: assets,
    }),
  });
}

export const canonicalOpeningState = (input: VerticalSliceInput): SliceState => {
  const currency = input.currency ?? USD;
  return {
    accounts: {
      [input.checkingAccountId]: { id: input.checkingAccountId, ownerId: input.ownerId, kind: "checking", cash: Money.zero(currency) },
      [input.retirementAccountId]: { id: input.retirementAccountId, ownerId: input.ownerId, kind: "retirement", cash: Money.zero(currency) },
    },
    liabilities: { [input.taxLiabilityId]: { id: input.taxLiabilityId, balance: Money.zero(currency) } },
    obligations: {},
    postedTransactionIds: [],
  };
};
