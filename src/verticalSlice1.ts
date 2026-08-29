export type Money = bigint;

export const money = (value: string): Money => {
  const raw = value.trim();
  const sign = raw.startsWith("-") ? -1n : 1n;
  const unsigned = raw.replace(/^[+-]/, "");
  const [whole = "", fraction = ""] = unsigned.split(".");
  if (!/^\d+$/.test(whole) || !/^\d{0,2}$/.test(fraction)) {
    throw new Error(`Invalid money: ${value}`);
  }
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

export const inPeriod = (instant: string, period: Period): boolean =>
  instant >= period.start && instant < period.end;

export type TransactionType =
  | "income"
  | "tax_accrual"
  | "tax_settlement"
  | "internal_transfer"
  | "expense";

export type CashFlowClass = "operating" | "non_cash";
export type Posting = "debit" | "credit";
export type SemanticKind = "flow" | "recognition" | "obligation" | "settlement";

export interface AccountState {
  id: string;
  ownerId: string;
  kind: "checking" | "retirement";
  cash: Money;
}

export interface LiabilityState {
  id: string;
  balance: Money;
}

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
  dueAt?: string;
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
  kind: SemanticKind;
  category: "compensation" | "tax" | "retirement_transfer" | "living_expense";
  amount: Money;
  occurredAt: string;
  recognitionId?: string;
  obligationId?: string;
}

export interface AccountingLeg {
  posting: Posting;
  type: "cash" | "income" | "expense" | "liability";
  amount: Money;
  accountId?: string;
  entityId?: string;
}

export interface AccountingTransaction {
  id: string;
  date: string;
  type: TransactionType;
  cashFlowClass: CashFlowClass;
  legs: AccountingLeg[];
}

export interface VerticalSliceInput {
  householdId: string;
  ownerId: string;
  checkingAccountId: string;
  retirementAccountId: string;
  taxLiabilityId: string;
  monthlyGrossCompensation: Money;
  taxRate: number;
  retirementContribution: Money;
  monthlyLivingExpense: Money;
  currency?: string;
}

export interface VerticalSlicePeriodInput {
  period: Period;
  input: VerticalSliceInput;
  openingState: SliceState;
  taxSettlement?: { obligationId: string; amount: Money; date: string };
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

const clone = <T>(value: T): T => structuredClone(value);
const sum = (values: Money[]): Money => values.reduce((a, b) => a + b, 0n);

export const assertBalanced = (transaction: AccountingTransaction): void => {
  const debits = sum(transaction.legs.filter((l) => l.posting === "debit").map((l) => l.amount));
  const credits = sum(transaction.legs.filter((l) => l.posting === "credit").map((l) => l.amount));
  if (debits !== credits) throw new Error(`Unbalanced transaction ${transaction.id}: ${debits} != ${credits}`);
};

const roundRateToCents = (base: Money, rate: number): Money => {
  if (!Number.isFinite(rate) || rate < 0) throw new Error("Invalid tax rate");
  const cents = Number(base) * rate;
  if (!Number.isSafeInteger(Math.abs(cents))) throw new Error("Tax calculation exceeds safe integer boundary");
  const rounded = Math.round(cents);
  return BigInt(rounded);
};

const validateInitialState = (state: SliceState, input: VerticalSliceInput): void => {
  const checking = state.accounts[input.checkingAccountId];
  const retirement = state.accounts[input.retirementAccountId];
  const liability = state.liabilities[input.taxLiabilityId];
  if (!checking || !retirement) throw new Error("Required cash accounts are missing");
  if (!liability) throw new Error("Required tax liability is missing");
  if (checking.ownerId !== input.ownerId || retirement.ownerId !== input.ownerId) {
    throw new Error("Retirement transfer requires common household ownership");
  }
  if (input.monthlyGrossCompensation < 0n || input.retirementContribution < 0n || input.monthlyLivingExpense < 0n) {
    throw new Error("Domain amounts cannot be negative");
  }
}

const post = (state: SliceState, transaction: AccountingTransaction): void => {
  assertBalanced(transaction);
  if (state.postedTransactionIds.includes(transaction.id)) {
    throw new Error(`Duplicate transaction ${transaction.id}`);
  }

  for (const leg of transaction.legs) {
    if (leg.type === "cash") {
      if (!leg.accountId) throw new Error(`Missing cash account in ${transaction.id}`);
      const account = state.accounts[leg.accountId];
      if (!account) throw new Error(`Unknown account ${leg.accountId}`);
      account.cash += leg.posting === "debit" ? leg.amount : -leg.amount;
      if (account.cash < 0n) throw new Error(`Insufficient cash in ${account.id}`);
    }
    if (leg.type === "liability") {
      if (!leg.entityId) throw new Error(`Missing liability in ${transaction.id}`);
      const liability = state.liabilities[leg.entityId];
      if (!liability) throw new Error(`Unknown liability ${leg.entityId}`);
      liability.balance += leg.posting === "credit" ? leg.amount : -leg.amount;
      if (liability.balance < 0n) throw new Error(`Negative liability balance in ${liability.id}`);
    }
  }

  state.postedTransactionIds.push(transaction.id);
};

const createTaxObligation = (
  state: SliceState,
  recognition: RecognitionFact,
  input: VerticalSliceInput,
): Obligation => {
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

const settleObligation = (state: SliceState, settlement: NonNullable<VerticalSlicePeriodInput["taxSettlement"]>): void => {
  const obligation = state.obligations[settlement.obligationId];
  if (!obligation) throw new Error(`Missing obligation ${settlement.obligationId}`);
  if (settlement.amount <= 0n) throw new Error("Settlement must be positive");
  if (settlement.amount > obligation.outstandingAmount) throw new Error("Settlement exceeds outstanding obligation");
  if (obligation.settlementIds.includes(settlement.obligationId + ":" + settlement.date)) {
    throw new Error("Duplicate settlement");
  }
  const settlementId = settlement.obligationId + ":" + settlement.date;
  if (settlement.date < obligation.recognizedAt) throw new Error("Settlement cannot precede recognition");
  obligation.outstandingAmount -= settlement.amount;
  obligation.settlementIds.push(settlementId);
  obligation.status = obligation.outstandingAmount === 0n ? "settled" : "partially_settled";
};

export function runVerticalSlicePeriod(input: VerticalSlicePeriodInput): VerticalSliceResult {
  const state = clone(input.openingState);
  const domain = input.input;
  const currency = domain.currency ?? "USD";
  validateInitialState(state, domain);

  const occurrence = `${input.period.start}:salary`;
  const compensationAmount = domain.monthlyGrossCompensation;
  const taxAmount = roundRateToCents(compensationAmount, domain.taxRate);
  const recognitionTime = new Date(new Date(input.period.end).getTime() - 1).toISOString();
  if (!inPeriod(recognitionTime, input.period)) throw new Error("Recognition timestamp is outside period");

  const effects: SemanticEffect[] = [];
  const recognitions: RecognitionFact[] = [];
  const transactions: AccountingTransaction[] = [];

  const compensationRecognition: RecognitionFact = {
    id: `recognition:compensation:${input.period.start}`,
    kind: "compensation",
    amount: compensationAmount,
    currency,
    recognizedAt: recognitionTime,
  };
  recognitions.push(compensationRecognition);
  effects.push({ id: occurrence, kind: "recognition", category: "compensation", amount: compensationAmount, occurredAt: recognitionTime, recognitionId: compensationRecognition.id });
  transactions.push({
    id: `tx:compensation:${input.period.start}`,
    date: recognitionTime,
    type: "income",
    cashFlowClass: "operating",
    legs: [
      { posting: "debit", type: "cash", amount: compensationAmount, accountId: domain.checkingAccountId },
      { posting: "credit", type: "income", amount: compensationAmount },
    ],
  });

  const taxRecognition: RecognitionFact = {
    id: `recognition:tax:${input.period.start}`,
    kind: "tax_expense",
    amount: taxAmount,
    currency,
    recognizedAt: recognitionTime,
  };
  recognitions.push(taxRecognition);
  const obligation = createTaxObligation(state, taxRecognition, domain);
  effects.push({ id: `tax:${input.period.start}`, kind: "obligation", category: "tax", amount: taxAmount, occurredAt: recognitionTime, recognitionId: taxRecognition.id, obligationId: obligation.id });
  transactions.push({
    id: `tx:tax-accrual:${input.period.start}`,
    date: recognitionTime,
    type: "tax_accrual",
    cashFlowClass: "non_cash",
    legs: [
      { posting: "debit", type: "expense", amount: taxAmount },
      { posting: "credit", type: "liability", amount: taxAmount, entityId: domain.taxLiabilityId },
    ],
  });

  const retirementTransfer: AccountingTransaction = {
    id: `tx:retirement:${input.period.start}`,
    date: new Date(new Date(input.period.end).getTime() - 2).toISOString(),
    type: "internal_transfer",
    cashFlowClass: "non_cash",
    legs: [
      { posting: "debit", type: "cash", amount: domain.retirementContribution, accountId: domain.retirementAccountId },
      { posting: "credit", type: "cash", amount: domain.retirementContribution, accountId: domain.checkingAccountId },
    ],
  };
  effects.push({ id: `retirement:${input.period.start}`, kind: "flow", category: "retirement_transfer", amount: domain.retirementContribution, occurredAt: retirementTransfer.date });
  transactions.push(retirementTransfer);

  const livingRecognition: RecognitionFact = {
    id: `recognition:living:${input.period.start}`,
    kind: "living_expense",
    amount: domain.monthlyLivingExpense,
    currency,
    recognizedAt: recognitionTime,
  };
  recognitions.push(livingRecognition);
  effects.push({ id: `living:${input.period.start}`, kind: "recognition", category: "living_expense", amount: domain.monthlyLivingExpense, occurredAt: recognitionTime, recognitionId: livingRecognition.id });
  transactions.push({
    id: `tx:living:${input.period.start}`,
    date: recognitionTime,
    type: "expense",
    cashFlowClass: "operating",
    legs: [
      { posting: "debit", type: "expense", amount: domain.monthlyLivingExpense },
      { posting: "credit", type: "cash", amount: domain.monthlyLivingExpense, accountId: domain.checkingAccountId },
    ],
  });

  if (input.taxSettlement) {
    const settlement = input.taxSettlement;
    if (!inPeriod(settlement.date, input.period)) throw new Error("Settlement is outside period");
    if (settlement.obligationId !== obligation.id && !state.obligations[settlement.obligationId]) {
      throw new Error(`Missing obligation ${settlement.obligationId}`);
    }
    const settlementTarget = state.obligations[settlement.obligationId];
    if (!settlementTarget) throw new Error(`Missing obligation ${settlement.obligationId}`);
    const settlementId = settlement.obligationId + ":" + settlement.date;
    settleObligation(state, settlement);
    effects.push({ id: settlementId, kind: "settlement", category: "tax", amount: settlement.amount, occurredAt: settlement.date, obligationId: settlement.obligationId });
    transactions.push({
      id: `tx:tax-settlement:${settlementId}`,
      date: settlement.date,
      type: "tax_settlement",
      cashFlowClass: "operating",
      legs: [
        { posting: "debit", type: "liability", amount: settlement.amount, entityId: domain.taxLiabilityId },
        { posting: "credit", type: "cash", amount: settlement.amount, accountId: domain.checkingAccountId },
      ],
    });
  }

  for (const transaction of transactions) {
    assertBalanced(transaction);
    if (!inPeriod(transaction.date, input.period)) throw new Error(`Transaction ${transaction.id} is outside period`);
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

  return {
    state,
    effects,
    recognitions,
    transactions,
    statements: { assets, liabilities, netWorth: assets - liabilities, income, expenses, operatingCashFlow },
    outputs: {
      grossCompensation: compensationAmount,
      taxExpense: taxAmount,
      taxPayable: state.liabilities[domain.taxLiabilityId]!.balance,
      retirementContribution: domain.retirementContribution,
      livingExpenses: domain.monthlyLivingExpense,
      checkingCash: state.accounts[domain.checkingAccountId]!.cash,
      retirementCash: state.accounts[domain.retirementAccountId]!.cash,
      consolidatedCash: assets,
    },
  };
}

export const canonicalOpeningState = (input: VerticalSliceInput): SliceState => ({
  accounts: {
    [input.checkingAccountId]: { id: input.checkingAccountId, ownerId: input.ownerId, kind: "checking", cash: 0n },
    [input.retirementAccountId]: { id: input.retirementAccountId, ownerId: input.ownerId, kind: "retirement", cash: 0n },
  },
  liabilities: {
    [input.taxLiabilityId]: { id: input.taxLiabilityId, balance: 0n },
  },
  obligations: {},
  postedTransactionIds: [],
});
