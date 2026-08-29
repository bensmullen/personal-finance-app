import { type Instant, type Period, inPeriod, subtractMilliseconds } from "./time.js";
import type { DomainId } from "./identity.js";
import {
  type Currency,
  Money,
  Rate,
  RateBasis,
  USD,
  decimal,
  settlementRounding,
  sumMoney,
} from "./values.js";

export { instant, month, period, type Period } from "./time.js";
export { domainId, type DomainId } from "./identity.js";
export { Money, Rate, RateBasis, formatMoney as dollars, money } from "./values.js";

export type HouseholdId = DomainId<"household">;
export type PersonId = DomainId<"person">;
export type AccountId = DomainId<"account">;
export type LiabilityId = DomainId<"liability">;

export interface AccountState {
  id: AccountId;
  ownerId: PersonId;
  kind: "checking" | "retirement";
  cash: Money;
}

export interface LiabilityState { id: LiabilityId; balance: Money; }

export interface Obligation {
  id: string;
  type: "tax_payable";
  originatingRecognitionId: string;
  ownerId: PersonId;
  liabilityId: LiabilityId;
  originalAmount: Money;
  outstandingAmount: Money;
  currency: Currency;
  recognizedAt: Instant;
  settlementIds: string[];
  status: "outstanding" | "partially_settled" | "settled";
}

export interface SliceState {
  accounts: Record<string, AccountState>;
  liabilities: Record<string, LiabilityState>;
  obligations: Record<string, Obligation>;
  postedTransactionIds: string[];
}

export interface RecognitionFact {
  id: string;
  kind: "compensation" | "tax_expense" | "living_expense";
  amount: Money;
  currency: Currency;
  recognizedAt: Instant;
}

export interface SemanticEffect {
  id: string;
  kind: "flow" | "recognition" | "obligation" | "settlement";
  category: "compensation" | "tax" | "retirement_transfer" | "living_expense";
  amount: Money;
  occurredAt: Instant;
  recognitionId?: string;
  obligationId?: string;
}

export interface AccountingLeg {
  posting: "debit" | "credit";
  type: "cash" | "income" | "expense" | "liability";
  amount: Money;
  accountId?: AccountId;
  entityId?: LiabilityId;
}

export interface AccountingTransaction {
  id: string;
  date: Instant;
  type: "income" | "tax_accrual" | "tax_settlement" | "internal_transfer" | "expense";
  cashFlowClass: "operating" | "non_cash";
  legs: AccountingLeg[];
}

export interface VerticalSliceInput {
  householdId: HouseholdId;
  ownerId: PersonId;
  checkingAccountId: AccountId;
  retirementAccountId: AccountId;
  taxLiabilityId: LiabilityId;
  monthlyGrossCompensation: Money;
  taxRate: Rate;
  retirementContribution: Money;
  monthlyLivingExpense: Money;
  settleCurrentTax?: boolean;
  currency?: Currency;
}

export interface TaxSettlementRequest {
  settlementId: string;
  obligationId: string;
  amount: Money;
  date: Instant;
}

export interface VerticalSlicePeriodInput {
  period: Period;
  input: VerticalSliceInput;
  openingState: SliceState;
  taxSettlements?: TaxSettlementRequest[];
}

export interface Statements {
  assets: Money;
  liabilities: Money;
  netWorth: Money;
  income: Money;
  expenses: Money;
  netIncome: Money;
  operatingCashFlow: Money;
}

export interface VerticalSliceResult {
  state: SliceState;
  effects: SemanticEffect[];
  recognitions: RecognitionFact[];
  transactions: AccountingTransaction[];
  dependencyOrder: string[];
  statements: Statements;
  outputs: {
    grossCompensation: Money;
    taxExpense: Money;
    taxPayable: Money;
    retirementContribution: Money;
    livingExpenses: Money;
    checkingCash: Money;
    retirementCash: Money;
    consolidatedCash: Money;
  };
}

const cloneState = (state: SliceState): SliceState => ({
  accounts: Object.fromEntries(Object.entries(state.accounts).map(([key, value]) => [key, { ...value }])),
  liabilities: Object.fromEntries(Object.entries(state.liabilities).map(([key, value]) => [key, { ...value }])),
  obligations: Object.fromEntries(Object.entries(state.obligations).map(([key, value]) => [key, {
    ...value,
    settlementIds: [...value.settlementIds],
  }])),
  postedTransactionIds: [...state.postedTransactionIds],
});

export const calculateTax = (base: Money, taxRate: Rate): Money => {
  if (taxRate.basis !== RateBasis.Proportion || taxRate.value.compare(decimal("1")) > 0) {
    throw new Error("Tax rate must be a proportion from 0 to 1");
  }
  if (base.isNegative()) throw new Error("Tax base cannot be negative");
  return new Money(base.amount.times(taxRate.value).round(settlementRounding(base.currency)), base.currency);
};

export const assertBalanced = (transaction: AccountingTransaction): void => {
  const currency = transaction.legs[0]?.amount.currency ?? USD;
  for (const leg of transaction.legs) {
    if (!leg.amount.amount.equals(leg.amount.amount.round(settlementRounding(leg.amount.currency)))) {
      throw new Error(`Posted amount in ${transaction.id} exceeds ${leg.amount.currency.code} settlement precision`);
    }
  }
  const debits = sumMoney(transaction.legs.filter((leg) => leg.posting === "debit").map((leg) => leg.amount), currency);
  const credits = sumMoney(transaction.legs.filter((leg) => leg.posting === "credit").map((leg) => leg.amount), currency);
  if (!debits.equals(credits)) throw new Error(`Unbalanced transaction ${transaction.id}: ${debits.amount} != ${credits.amount}`);
};

const validateState = (state: SliceState, input: VerticalSliceInput): void => {
  const checking = state.accounts[input.checkingAccountId];
  const retirement = state.accounts[input.retirementAccountId];
  if (!checking || !retirement) throw new Error("Required cash accounts are missing");
  if (!state.liabilities[input.taxLiabilityId]) throw new Error("Required tax liability is missing");
  if (checking.ownerId !== input.ownerId || retirement.ownerId !== input.ownerId) {
    throw new Error("Retirement transfer requires common household ownership");
  }
  const currency = input.currency ?? USD;
  for (const amount of [input.monthlyGrossCompensation, input.retirementContribution, input.monthlyLivingExpense]) {
    if (amount.isNegative()) throw new Error("Domain amounts cannot be negative");
    if (!amount.currency.equals(currency)) throw new Error("Input money must use the model currency");
    if (!amount.amount.equals(amount.amount.round(settlementRounding(currency)))) {
      throw new Error("Vertical Slice 1 posted inputs must use currency settlement precision");
    }
  }
  calculateTax(Money.zero(currency), input.taxRate);
};

const post = (state: SliceState, transaction: AccountingTransaction): void => {
  assertBalanced(transaction);
  if (state.postedTransactionIds.includes(transaction.id)) throw new Error(`Duplicate transaction ${transaction.id}`);

  for (const leg of transaction.legs) {
    if (leg.type === "cash") {
      if (!leg.accountId) throw new Error(`Missing cash account in ${transaction.id}`);
      const account = state.accounts[leg.accountId];
      if (!account) throw new Error(`Unknown account ${leg.accountId}`);
      account.cash = leg.posting === "debit" ? account.cash.plus(leg.amount) : account.cash.minus(leg.amount);
      if (account.cash.isNegative()) throw new Error(`Insufficient cash in ${account.id}`);
    } else if (leg.type === "liability") {
      if (!leg.entityId) throw new Error(`Missing liability in ${transaction.id}`);
      const liability = state.liabilities[leg.entityId];
      if (!liability) throw new Error(`Unknown liability ${leg.entityId}`);
      liability.balance = leg.posting === "credit" ? liability.balance.plus(leg.amount) : liability.balance.minus(leg.amount);
      if (liability.balance.isNegative()) throw new Error(`Negative liability balance in ${liability.id}`);
    }
  }
  state.postedTransactionIds.push(transaction.id);
};

const createTaxObligation = (state: SliceState, recognition: RecognitionFact, input: VerticalSliceInput): Obligation => {
  const id = `obligation:${recognition.id}`;
  if (state.obligations[id]) throw new Error(`Duplicate recognition ${recognition.id}`);
  const obligation: Obligation = {
    id,
    type: "tax_payable",
    originatingRecognitionId: recognition.id,
    ownerId: input.ownerId,
    liabilityId: input.taxLiabilityId,
    originalAmount: recognition.amount,
    outstandingAmount: recognition.amount,
    currency: input.currency ?? USD,
    recognizedAt: recognition.recognizedAt,
    settlementIds: [],
    status: "outstanding",
  };
  state.obligations[id] = obligation;
  return obligation;
};

const applySettlementLifecycle = (state: SliceState, settlement: TaxSettlementRequest): Obligation => {
  const obligation = state.obligations[settlement.obligationId];
  if (!obligation) throw new Error(`Missing obligation ${settlement.obligationId}`);
  if (!settlement.amount.isPositive()) throw new Error("Settlement must be positive");
  if (settlement.amount.compare(obligation.outstandingAmount) > 0) throw new Error("Settlement exceeds outstanding obligation");
  if (obligation.settlementIds.includes(settlement.settlementId)) throw new Error(`Duplicate settlement ${settlement.settlementId}`);
  if (settlement.date < obligation.recognizedAt) throw new Error("Settlement cannot precede recognition");

  obligation.outstandingAmount = obligation.outstandingAmount.minus(settlement.amount);
  obligation.settlementIds.push(settlement.settlementId);
  obligation.status = obligation.outstandingAmount.isZero() ? "settled" : "partially_settled";
  return obligation;
};

const taxSettlementTransaction = (
  settlement: TaxSettlementRequest,
  input: VerticalSliceInput,
): AccountingTransaction => ({
  id: `tx:tax-settlement:${settlement.settlementId}`,
  date: settlement.date,
  type: "tax_settlement",
  cashFlowClass: "operating",
  legs: [
    { posting: "debit", type: "liability", amount: settlement.amount, entityId: input.taxLiabilityId },
    { posting: "credit", type: "cash", amount: settlement.amount, accountId: input.checkingAccountId },
  ],
});

export function runVerticalSlicePeriod(request: VerticalSlicePeriodInput): VerticalSliceResult {
  if (request.period.start >= request.period.end) throw new Error("Period must be a non-empty half-open interval");
  const state = cloneState(request.openingState);
  const input = request.input;
  const currency = input.currency ?? USD;
  validateState(state, input);

  const compensationAt = subtractMilliseconds(request.period.end, 5);
  const taxRecognitionAt = subtractMilliseconds(request.period.end, 4);
  const taxSettlementAt = subtractMilliseconds(request.period.end, 3);
  const retirementAt = subtractMilliseconds(request.period.end, 2);
  const livingExpenseAt = subtractMilliseconds(request.period.end, 1);

  const effects: SemanticEffect[] = [];
  const recognitions: RecognitionFact[] = [];
  const transactions: AccountingTransaction[] = [];
  let taxAmount = Money.zero(currency);
  let currentTaxObligation: Obligation | undefined;

  if (input.monthlyGrossCompensation.isPositive()) {
    const compensationRecognition: RecognitionFact = {
      id: `recognition:compensation:${request.period.start}`,
      kind: "compensation",
      amount: input.monthlyGrossCompensation,
      currency,
      recognizedAt: compensationAt,
    };
    recognitions.push(compensationRecognition);
    effects.push({
      id: `effect:compensation:${request.period.start}`,
      kind: "recognition",
      category: "compensation",
      amount: input.monthlyGrossCompensation,
      occurredAt: compensationAt,
      recognitionId: compensationRecognition.id,
    });
    transactions.push({
      id: `tx:compensation:${request.period.start}`,
      date: compensationAt,
      type: "income",
      cashFlowClass: "operating",
      legs: [
        { posting: "debit", type: "cash", amount: input.monthlyGrossCompensation, accountId: input.checkingAccountId },
        { posting: "credit", type: "income", amount: input.monthlyGrossCompensation },
      ],
    });

    taxAmount = calculateTax(input.monthlyGrossCompensation, input.taxRate);
    if (taxAmount.isPositive()) {
      const taxRecognition: RecognitionFact = {
        id: `recognition:tax:${request.period.start}`,
        kind: "tax_expense",
        amount: taxAmount,
        currency,
        recognizedAt: taxRecognitionAt,
      };
      recognitions.push(taxRecognition);
      currentTaxObligation = createTaxObligation(state, taxRecognition, input);
      effects.push({
        id: `effect:tax-obligation:${request.period.start}`,
        kind: "obligation",
        category: "tax",
        amount: taxAmount,
        occurredAt: taxRecognitionAt,
        recognitionId: taxRecognition.id,
        obligationId: currentTaxObligation.id,
      });
      transactions.push({
        id: `tx:tax-accrual:${request.period.start}`,
        date: taxRecognitionAt,
        type: "tax_accrual",
        cashFlowClass: "non_cash",
        legs: [
          { posting: "debit", type: "expense", amount: taxAmount },
          { posting: "credit", type: "liability", amount: taxAmount, entityId: input.taxLiabilityId },
        ],
      });

      if (input.settleCurrentTax !== false) {
        const settlement: TaxSettlementRequest = {
          settlementId: `settlement:tax:${request.period.start}`,
          obligationId: currentTaxObligation.id,
          amount: taxAmount,
          date: taxSettlementAt,
        };
        applySettlementLifecycle(state, settlement);
        effects.push({
          id: `effect:${settlement.settlementId}`,
          kind: "settlement",
          category: "tax",
          amount: settlement.amount,
          occurredAt: settlement.date,
          obligationId: settlement.obligationId,
        });
        transactions.push(taxSettlementTransaction(settlement, input));
      }
    }
  }

  if (input.retirementContribution.isPositive()) {
    effects.push({
      id: `effect:retirement:${request.period.start}`,
      kind: "flow",
      category: "retirement_transfer",
      amount: input.retirementContribution,
      occurredAt: retirementAt,
    });
    transactions.push({
      id: `tx:retirement:${request.period.start}`,
      date: retirementAt,
      type: "internal_transfer",
      cashFlowClass: "non_cash",
      legs: [
        { posting: "debit", type: "cash", amount: input.retirementContribution, accountId: input.retirementAccountId },
        { posting: "credit", type: "cash", amount: input.retirementContribution, accountId: input.checkingAccountId },
      ],
    });
  }

  if (input.monthlyLivingExpense.isPositive()) {
    const livingRecognition: RecognitionFact = {
      id: `recognition:living:${request.period.start}`,
      kind: "living_expense",
      amount: input.monthlyLivingExpense,
      currency,
      recognizedAt: livingExpenseAt,
    };
    recognitions.push(livingRecognition);
    effects.push({
      id: `effect:living:${request.period.start}`,
      kind: "recognition",
      category: "living_expense",
      amount: input.monthlyLivingExpense,
      occurredAt: livingExpenseAt,
      recognitionId: livingRecognition.id,
    });
    transactions.push({
      id: `tx:living:${request.period.start}`,
      date: livingExpenseAt,
      type: "expense",
      cashFlowClass: "operating",
      legs: [
        { posting: "debit", type: "expense", amount: input.monthlyLivingExpense },
        { posting: "credit", type: "cash", amount: input.monthlyLivingExpense, accountId: input.checkingAccountId },
      ],
    });
  }

  for (const settlement of request.taxSettlements ?? []) {
    if (!inPeriod(settlement.date, request.period)) continue;
    applySettlementLifecycle(state, settlement);
    effects.push({
      id: `effect:${settlement.settlementId}`,
      kind: "settlement",
      category: "tax",
      amount: settlement.amount,
      occurredAt: settlement.date,
      obligationId: settlement.obligationId,
    });
    transactions.push(taxSettlementTransaction(settlement, input));
  }

  transactions.sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
  for (const transaction of transactions) {
    if (!inPeriod(transaction.date, request.period)) throw new Error(`Transaction ${transaction.id} is outside period`);
    post(state, transaction);
  }

  const assets = sumMoney(Object.values(state.accounts).map((account) => account.cash), currency);
  const liabilities = sumMoney(Object.values(state.liabilities).map((liability) => liability.balance), currency);
  const income = sumMoney(transactions.flatMap((transaction) => transaction.legs
    .filter((leg) => leg.type === "income" && leg.posting === "credit")
    .map((leg) => leg.amount)), currency);
  const expenses = sumMoney(transactions.flatMap((transaction) => transaction.legs
    .filter((leg) => leg.type === "expense" && leg.posting === "debit")
    .map((leg) => leg.amount)), currency);
  const netIncome = income.minus(expenses);
  const operatingCashFlow = sumMoney(
    transactions
      .filter((transaction) => transaction.cashFlowClass === "operating")
      .flatMap((transaction) => transaction.legs
        .filter((leg) => leg.type === "cash")
        .map((leg) => leg.posting === "debit" ? leg.amount : leg.amount.negated())),
    currency,
  );

  const dependencyOrder = [
    "compensation",
    "tax_calculation",
    "tax_recognition",
    "tax_obligation",
    "tax_settlement",
    "retirement_contribution",
    "available_cash",
    "living_expense",
  ];

  return {
    state,
    effects,
    recognitions,
    transactions,
    dependencyOrder,
    statements: { assets, liabilities, netWorth: assets.minus(liabilities), income, expenses, netIncome, operatingCashFlow },
    outputs: {
      grossCompensation: input.monthlyGrossCompensation,
      taxExpense: taxAmount,
      taxPayable: state.liabilities[input.taxLiabilityId]!.balance,
      retirementContribution: input.retirementContribution,
      livingExpenses: input.monthlyLivingExpense,
      checkingCash: state.accounts[input.checkingAccountId]!.cash,
      retirementCash: state.accounts[input.retirementAccountId]!.cash,
      consolidatedCash: assets,
    },
  };
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
