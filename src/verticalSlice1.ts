export type Money = bigint;

export const money = (value: string): Money => {
  const raw = value.trim();
  const sign = raw.startsWith("-") ? -1n : 1n;
  const unsigned = raw.replace(/^[+-]/, "");
  const [whole = "", fraction = ""] = unsigned.split(".");
  if (!/^\d+$/.test(whole) || !/^\d{0,2}$/.test(fraction)) throw new Error(`Invalid money: ${value}`);
  return sign * (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0")));
};

export const dollars = (value: Money): string => {
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}$${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
};

export interface Period { start: string; end: string; }

export const month = (year: number, month1: number): Period => ({
  start: new Date(Date.UTC(year, month1 - 1, 1)).toISOString(),
  end: new Date(Date.UTC(year, month1, 1)).toISOString(),
});

export const inPeriod = (instant: string, period: Period): boolean => instant >= period.start && instant < period.end;

export interface AccountState {
  id: string;
  ownerId: string;
  kind: "checking" | "retirement";
  cash: Money;
}

export interface LiabilityState { id: string; balance: Money; }

export interface Obligation {
  id: string;
  type: "tax_payable";
  originatingRecognitionId: string;
  ownerId: string;
  liabilityId: string;
  originalAmount: Money;
  outstandingAmount: Money;
  currency: string;
  recognizedAt: string;
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
  currency: string;
  recognizedAt: string;
}

export interface SemanticEffect {
  id: string;
  kind: "flow" | "recognition" | "obligation" | "settlement";
  category: "compensation" | "tax" | "retirement_transfer" | "living_expense";
  amount: Money;
  occurredAt: string;
  recognitionId?: string;
  obligationId?: string;
}

export interface AccountingLeg {
  posting: "debit" | "credit";
  type: "cash" | "income" | "expense" | "liability";
  amount: Money;
  accountId?: string;
  entityId?: string;
}

export interface AccountingTransaction {
  id: string;
  date: string;
  type: "income" | "tax_accrual" | "tax_settlement" | "internal_transfer" | "expense";
  cashFlowClass: "operating" | "non_cash";
  legs: AccountingLeg[];
}

export interface VerticalSliceInput {
  householdId: string;
  ownerId: string;
  checkingAccountId: string;
  retirementAccountId: string;
  taxLiabilityId: string;
  monthlyGrossCompensation: Money;
  taxRateBasisPoints: number;
  retirementContribution: Money;
  monthlyLivingExpense: Money;
  settleCurrentTax?: boolean;
  currency?: string;
}

export interface TaxSettlementRequest {
  settlementId: string;
  obligationId: string;
  amount: Money;
  date: string;
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

const sum = (values: Money[]): Money => values.reduce((a, b) => a + b, 0n);
const clone = <T>(value: T): T => structuredClone(value);

const atEndMinus = (period: Period, milliseconds: number): string =>
  new Date(new Date(period.end).getTime() - milliseconds).toISOString();

export const calculateTax = (base: Money, rateBasisPoints: number): Money => {
  if (!Number.isInteger(rateBasisPoints) || rateBasisPoints < 0 || rateBasisPoints > 10000) {
    throw new Error("Tax rate basis points must be an integer from 0 to 10000");
  }
  if (base < 0n) throw new Error("Tax base cannot be negative");
  return (base * BigInt(rateBasisPoints) + 5000n) / 10000n;
};

export const assertBalanced = (transaction: AccountingTransaction): void => {
  const debits = sum(transaction.legs.filter((leg) => leg.posting === "debit").map((leg) => leg.amount));
  const credits = sum(transaction.legs.filter((leg) => leg.posting === "credit").map((leg) => leg.amount));
  if (debits !== credits) throw new Error(`Unbalanced transaction ${transaction.id}: ${debits} != ${credits}`);
};

const validateState = (state: SliceState, input: VerticalSliceInput): void => {
  const checking = state.accounts[input.checkingAccountId];
  const retirement = state.accounts[input.retirementAccountId];
  if (!checking || !retirement) throw new Error("Required cash accounts are missing");
  if (!state.liabilities[input.taxLiabilityId]) throw new Error("Required tax liability is missing");
  if (checking.ownerId !== input.ownerId || retirement.ownerId !== input.ownerId) {
    throw new Error("Retirement transfer requires common household ownership");
  }
  if ([input.monthlyGrossCompensation, input.retirementContribution, input.monthlyLivingExpense].some((amount) => amount < 0n)) {
    throw new Error("Domain amounts cannot be negative");
  }
  calculateTax(0n, input.taxRateBasisPoints);
};

const post = (state: SliceState, transaction: AccountingTransaction): void => {
  assertBalanced(transaction);
  if (state.postedTransactionIds.includes(transaction.id)) throw new Error(`Duplicate transaction ${transaction.id}`);

  for (const leg of transaction.legs) {
    if (leg.type === "cash") {
      if (!leg.accountId) throw new Error(`Missing cash account in ${transaction.id}`);
      const account = state.accounts[leg.accountId];
      if (!account) throw new Error(`Unknown account ${leg.accountId}`);
      account.cash += leg.posting === "debit" ? leg.amount : -leg.amount;
      if (account.cash < 0n) throw new Error(`Insufficient cash in ${account.id}`);
    } else if (leg.type === "liability") {
      if (!leg.entityId) throw new Error(`Missing liability in ${transaction.id}`);
      const liability = state.liabilities[leg.entityId];
      if (!liability) throw new Error(`Unknown liability ${leg.entityId}`);
      liability.balance += leg.posting === "credit" ? leg.amount : -leg.amount;
      if (liability.balance < 0n) throw new Error(`Negative liability balance in ${liability.id}`);
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
    currency: input.currency ?? "USD",
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
  if (settlement.amount <= 0n) throw new Error("Settlement must be positive");
  if (settlement.amount > obligation.outstandingAmount) throw new Error("Settlement exceeds outstanding obligation");
  if (obligation.settlementIds.includes(settlement.settlementId)) throw new Error(`Duplicate settlement ${settlement.settlementId}`);
  if (settlement.date < obligation.recognizedAt) throw new Error("Settlement cannot precede recognition");

  obligation.outstandingAmount -= settlement.amount;
  obligation.settlementIds.push(settlement.settlementId);
  obligation.status = obligation.outstandingAmount === 0n ? "settled" : "partially_settled";
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
  const state = clone(request.openingState);
  const input = request.input;
  const currency = input.currency ?? "USD";
  validateState(state, input);

  const compensationAt = atEndMinus(request.period, 5);
  const taxRecognitionAt = atEndMinus(request.period, 4);
  const taxSettlementAt = atEndMinus(request.period, 3);
  const retirementAt = atEndMinus(request.period, 2);
  const livingExpenseAt = atEndMinus(request.period, 1);

  const effects: SemanticEffect[] = [];
  const recognitions: RecognitionFact[] = [];
  const transactions: AccountingTransaction[] = [];
  let taxAmount = 0n;
  let currentTaxObligation: Obligation | undefined;

  if (input.monthlyGrossCompensation > 0n) {
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

    taxAmount = calculateTax(input.monthlyGrossCompensation, input.taxRateBasisPoints);
    if (taxAmount > 0n) {
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

  if (input.retirementContribution > 0n) {
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

  if (input.monthlyLivingExpense > 0n) {
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

  transactions.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  for (const transaction of transactions) {
    if (!inPeriod(transaction.date, request.period)) throw new Error(`Transaction ${transaction.id} is outside period`);
    post(state, transaction);
  }

  const assets = sum(Object.values(state.accounts).map((account) => account.cash));
  const liabilities = sum(Object.values(state.liabilities).map((liability) => liability.balance));
  const income = sum(transactions.flatMap((tx) => tx.legs.filter((leg) => leg.type === "income" && leg.posting === "credit").map((leg) => leg.amount)));
  const expenses = sum(transactions.flatMap((tx) => tx.legs.filter((leg) => leg.type === "expense" && leg.posting === "debit").map((leg) => leg.amount)));
  const operatingCashFlow = sum(
    transactions
      .filter((tx) => tx.cashFlowClass === "operating")
      .flatMap((tx) => tx.legs.filter((leg) => leg.type === "cash").map((leg) => leg.posting === "debit" ? leg.amount : -leg.amount)),
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
    statements: { assets, liabilities, netWorth: assets - liabilities, income, expenses, operatingCashFlow },
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

export const canonicalOpeningState = (input: VerticalSliceInput): SliceState => ({
  accounts: {
    [input.checkingAccountId]: { id: input.checkingAccountId, ownerId: input.ownerId, kind: "checking", cash: 0n },
    [input.retirementAccountId]: { id: input.retirementAccountId, ownerId: input.ownerId, kind: "retirement", cash: 0n },
  },
  liabilities: { [input.taxLiabilityId]: { id: input.taxLiabilityId, balance: 0n } },
  obligations: {},
  postedTransactionIds: [],
});
