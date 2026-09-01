import {
  accountingTransactionId,
  createAccountingLeg,
  createAccountingTransaction,
  type AccountingLegDraft,
  type AccountingTransaction,
  type AccountId,
  type PositionId,
} from "../accounting/index.js";
import { ValidationError, failValidation, issueCodes, type ValidationIssue } from "../diagnostics/index.js";
import { domainId, generatedOccurrenceKey, type DomainId, type GeneratedOccurrenceKey } from "../identity/index.js";
import { calculationTraceId, calculationTraceRef, freezeTraceRefs, type CalculationTraceRef } from "../lineage/index.js";
import { createFactProvenance, type ModelGeneratedFactProvenance } from "../model/provenance.js";
import { effectiveCompoundingPeriodReturn, type CompoundingReturnBasis } from "../primitives/index.js";
import { createSemanticEffect, semanticEffectId, type SemanticEffect } from "../semantics/index.js";
import {
  applyPositionPriceAtomically,
  assertAuthoritativeStateCurrency,
  cloneAuthoritativeState,
  type AuthoritativeState,
} from "../state/index.js";
import { deriveStatements, type Statements } from "../statements/index.js";
import { inPeriod, subtractMilliseconds, utcMonthDifference, utcMonthlyOccurrences, utcMonthlyPeriods, type Instant, type Period } from "../time/index.js";
import { accountValueFromState, positionMarketValue, totalPositionMarketValue } from "../valuation/index.js";
import { Money, Quantity, RoundingPolicy, sumMoney, type Currency, type Rate } from "../values/index.js";
import { createInputFingerprint, createRunMetadata, type RunContext, type RunMetadata } from "./run.js";
import { createPrimitiveRuntimeStateStore, runPeriod, type PeriodWork, type PrimitiveRuntimeStateStore } from "./period.js";

export type HouseholdId = DomainId<"household">;
export type PersonId = DomainId<"person">;
export type TransferId = DomainId<"transfer">;
export type PurchaseId = DomainId<"investment-purchase">;
export type InvestmentFeeId = DomainId<"investment-fee">;
export type PrimitiveInstanceId = DomainId<"primitive-instance">;

export type InvestmentSchedule =
  | { readonly kind: "explicit_instants"; readonly instants: readonly Instant[] }
  | { readonly kind: "utc_monthly"; readonly anchor: Instant; readonly invalidDayPolicy: "skip" };

interface ScheduledOperation {
  readonly schedule: InvestmentSchedule;
  /** Explicitly resolves economically dependent operations at the same instant. */
  readonly order: number;
  readonly schedulePrimitiveId: PrimitiveInstanceId;
}

export interface OwnedCashTransfer extends ScheduledOperation {
  readonly id: TransferId;
  readonly sourceAccountId: AccountId;
  readonly destinationAccountId: AccountId;
  readonly amount: Money;
}

export interface InvestmentPurchase extends ScheduledOperation {
  readonly id: PurchaseId;
  readonly sourceCashAccountId: AccountId;
  readonly destinationAccountId: AccountId;
  readonly targetPositionId: PositionId;
  readonly amount: Money;
  readonly quantityRounding: RoundingPolicy;
}

export interface InvestmentFee extends ScheduledOperation {
  readonly id: InvestmentFeeId;
  readonly cashAccountId: AccountId;
  readonly amount: Money;
}

export interface DeterministicPositionReturn {
  readonly targetPositionId: PositionId;
  readonly accountId: AccountId;
  readonly rate: Rate;
  readonly returnBasis: CompoundingReturnBasis;
  /** This slice supports a closing-price return applied to the period's closing quantity. */
  readonly timing: "end_of_period_on_closing_quantity";
  readonly priceRounding: RoundingPolicy;
  readonly primitiveIds: {
    readonly compounding: PrimitiveInstanceId;
    readonly markToMarket: PrimitiveInstanceId;
  };
}

export interface VerticalSlice3Input {
  readonly householdId: HouseholdId;
  readonly ownerId: PersonId;
  readonly baseCurrency: Currency;
  readonly transfers: readonly OwnedCashTransfer[];
  readonly purchases: readonly InvestmentPurchase[];
  readonly fees?: readonly InvestmentFee[];
  readonly returns: readonly DeterministicPositionReturn[];
}

export interface VerticalSlice3RunInput {
  readonly runContext: RunContext;
  readonly openingState: AuthoritativeState;
  readonly input: VerticalSlice3Input;
  readonly months?: number;
  readonly primitiveState?: PrimitiveRuntimeStateStore;
}

export interface VerticalSlice3PeriodResult {
  readonly period: Period;
  readonly transactions: readonly AccountingTransaction[];
  readonly effects: readonly SemanticEffect[];
  readonly statements: Statements;
  readonly accountValues: Readonly<Record<string, Money>>;
  readonly portfolioValue: Money;
  readonly contributionPrincipal: Money;
  readonly fees: Money;
  readonly unrealizedGain: Money;
  readonly realizedGain: Money;
  readonly cashInvestmentIncome: Money;
  readonly traceRefs: readonly CalculationTraceRef[];
}

export interface VerticalSlice3RunResult {
  readonly status: "completed" | "incomplete";
  readonly runMetadata: RunMetadata;
  readonly requestedHorizon: Period;
  readonly reachedThrough?: Instant;
  readonly stoppedAt?: Instant;
  readonly state: AuthoritativeState;
  readonly primitiveState: PrimitiveRuntimeStateStore;
  readonly periods: readonly VerticalSlice3PeriodResult[];
  readonly diagnostics: readonly ValidationIssue[];
}

const invalidInput = (message: string, fieldPath: string): never => failValidation({
  severity: "error",
  code: issueCodes.verticalSlice3InputInvalid,
  message,
  entityType: "vertical_slice_3",
  fieldPath,
});

const occurrences = (schedule: InvestmentSchedule, target: Period): readonly Instant[] => schedule.kind === "explicit_instants"
  ? Object.freeze([...schedule.instants].filter((at) => inPeriod(at, target)).sort())
  : utcMonthlyOccurrences(schedule.anchor, target, schedule.invalidDayPolicy);

const traceRefs = (positionId: PositionId, period: Period): readonly CalculationTraceRef[] => freezeTraceRefs([
  calculationTraceRef(calculationTraceId(`vs3:return:${positionId}:${period.start}`)),
  calculationTraceRef(calculationTraceId(`vs3:valuation:${positionId}:${period.end}`)),
])!;

const transaction = (
  id: string,
  date: Instant,
  type: string,
  legs: readonly AccountingLegDraft[],
  refs: readonly CalculationTraceRef[],
): AccountingTransaction => createAccountingTransaction({
  id: accountingTransactionId(id),
  date,
  type,
  legs: legs.map((leg) => createAccountingLeg({ ...leg, traceRefs: leg.traceRefs ?? refs })),
  traceRefs: refs,
});

const generatedProvenance = (
  request: VerticalSlice3RunInput,
  primitiveInstanceId: PrimitiveInstanceId,
  at: Instant,
  semanticEffectType: string,
  economicTargetId: DomainId<string>,
): ModelGeneratedFactProvenance & { readonly generatedOccurrenceKey: GeneratedOccurrenceKey } => {
  const key = generatedOccurrenceKey({ scenarioId: request.runContext.scenarioId, primitiveInstanceId, scheduledAt: at, semanticEffectType, economicTargetId });
  return createFactProvenance({ factKind: "model_generated", sourceType: "model", sourceId: primitiveInstanceId, effectiveAt: at, generatedOccurrenceKey: key }) as ModelGeneratedFactProvenance & { readonly generatedOccurrenceKey: GeneratedOccurrenceKey };
};

const validateSchedule = (schedule: InvestmentSchedule, fieldPath: string): void => {
  if (schedule.kind === "explicit_instants" && new Set(schedule.instants).size !== schedule.instants.length) invalidInput("Schedule instants must be unique", fieldPath);
};

const canonicalInputForFingerprint = (input: VerticalSlice3Input): unknown => {
  const normalizeSchedule = (schedule: InvestmentSchedule): InvestmentSchedule => schedule.kind === "explicit_instants"
    ? Object.freeze({ ...schedule, instants: Object.freeze([...schedule.instants].sort()) })
    : schedule;
  const byId = <T extends { readonly id: string }>(values: readonly T[]): readonly T[] => [...values].sort((left, right) => left.id.localeCompare(right.id));
  return Object.freeze({
    ...input,
    transfers: Object.freeze(byId(input.transfers).map((item) => Object.freeze({ ...item, schedule: normalizeSchedule(item.schedule) }))),
    purchases: Object.freeze(byId(input.purchases).map((item) => Object.freeze({ ...item, schedule: normalizeSchedule(item.schedule) }))),
    fees: Object.freeze(byId(input.fees ?? []).map((item) => Object.freeze({ ...item, schedule: normalizeSchedule(item.schedule) }))),
    returns: Object.freeze([...input.returns].sort((left, right) => left.targetPositionId.localeCompare(right.targetPositionId))),
  });
};

const validateInput = (request: VerticalSlice3RunInput, periods: readonly Period[]): void => {
  const { input, openingState, runContext } = request;
  if (!input.baseCurrency.equals(runContext.baseCurrency)) invalidInput("Slice currency must match the run context", "input.baseCurrency");
  assertAuthoritativeStateCurrency(openingState, input.baseCurrency);
  if (periods[0]!.start !== runContext.simulationStart || periods[periods.length - 1]!.end !== runContext.simulationEnd) invalidInput("Monthly periods must exactly cover the run horizon", "months");
  const stableIds = [
    ...input.transfers.flatMap((item) => [item.id, item.schedulePrimitiveId]),
    ...input.purchases.flatMap((item) => [item.id, item.schedulePrimitiveId]),
    ...(input.fees ?? []).flatMap((item) => [item.id, item.schedulePrimitiveId]),
    ...input.returns.flatMap((item) => [item.primitiveIds.compounding, item.primitiveIds.markToMarket]),
  ];
  if (new Set(stableIds).size !== stableIds.length) invalidInput("Operation and primitive identities must be unique", "input");
  const ownedAccount = (id: AccountId, fieldPath: string) => {
    const account = openingState.accounts[id];
    if (account === undefined) return invalidInput(`Account ${id} is missing`, fieldPath);
    if (account.ownerId !== input.ownerId) invalidInput(`Account ${id} is not owned by the configured household owner`, fieldPath);
    return account;
  };
  const operations = [...input.transfers, ...input.purchases, ...(input.fees ?? [])];
  for (const item of operations) {
    validateSchedule(item.schedule, `${item.id}.schedule`);
    if (!Number.isSafeInteger(item.order) || item.order < 0) invalidInput(`Operation ${item.id} requires a non-negative integer order`, `${item.id}.order`);
    if (item.amount.isNegative() || !item.amount.currency.equals(input.baseCurrency) || !item.amount.amount.fitsScale(input.baseCurrency.minorUnitScale)) invalidInput(`Operation ${item.id} amount is invalid`, `${item.id}.amount`);
  }
  const occurrenceOrderKeys = operations.flatMap((item) => periods.flatMap((target) => occurrences(item.schedule, target).map((at) => `${at}:${item.order}`)));
  if (new Set(occurrenceOrderKeys).size !== occurrenceOrderKeys.length) invalidInput("Same-instant operations require distinct explicit order values", "input");
  for (const item of input.transfers) {
    ownedAccount(item.sourceAccountId, `${item.id}.sourceAccountId`);
    ownedAccount(item.destinationAccountId, `${item.id}.destinationAccountId`);
    if (item.sourceAccountId === item.destinationAccountId) invalidInput("Transfer source and destination must differ", `${item.id}.destinationAccountId`);
  }
  for (const item of input.purchases) {
    ownedAccount(item.sourceCashAccountId, `${item.id}.sourceCashAccountId`);
    ownedAccount(item.destinationAccountId, `${item.id}.destinationAccountId`);
    const position = openingState.positions[item.targetPositionId];
    if (position === undefined || position.accountId !== item.destinationAccountId) invalidInput(`Purchase ${item.id} target position/account is invalid`, `${item.id}.targetPositionId`);
  }
  for (const item of input.fees ?? []) ownedAccount(item.cashAccountId, `${item.id}.cashAccountId`);
  const returnPositions = new Set<string>();
  for (const item of input.returns) {
    if (returnPositions.has(item.targetPositionId)) invalidInput(`Position ${item.targetPositionId} has more than one return configuration`, "input.returns");
    returnPositions.add(item.targetPositionId);
    const position = openingState.positions[item.targetPositionId];
    if (position === undefined || position.accountId !== item.accountId) invalidInput(`Return target ${item.targetPositionId} is invalid`, "input.returns");
    ownedAccount(item.accountId, "input.returns.accountId");
    if (item.timing !== "end_of_period_on_closing_quantity") invalidInput("Unsupported return timing", "input.returns.timing");
    if (item.returnBasis.kind === "periodic"
      && (item.returnBasis.period.unit !== "calendar_month" || item.returnBasis.period.count.toString() !== "1")) invalidInput("Monthly VS3 periods require a one-calendar-month periodic return", "input.returns.returnBasis");
    if (item.returnBasis.kind === "effective_annual"
      && (item.returnBasis.yearFraction.numerator !== 1 || item.returnBasis.yearFraction.denominator !== 12)) invalidInput("Monthly VS3 effective-annual returns require an explicit 1/12 year fraction", "input.returns.returnBasis");
    if (item.returnBasis.kind === "nominal_annual" && item.returnBasis.compoundingPeriods !== 1) invalidInput("Monthly VS3 nominal returns require one contractual compounding period per simulation period", "input.returns.returnBasis");
    effectiveCompoundingPeriodReturn(item.rate, item.returnBasis);
  }
  for (const purchase of input.purchases) if (!returnPositions.has(purchase.targetPositionId)) invalidInput(`Purchased position ${purchase.targetPositionId} requires a return/valuation configuration`, "input.purchases");
};

interface PlannedAction {
  readonly id: string;
  readonly at: Instant;
  readonly order: number;
  readonly effect: SemanticEffect;
  readonly transaction: AccountingTransaction;
}

const planPeriod = (
  request: VerticalSlice3RunInput,
  period: Period,
  openingState: AuthoritativeState,
): {
  readonly work: readonly PeriodWork[];
  readonly closingPrices: Readonly<Record<string, Money>>;
  readonly contributionPrincipal: Money;
  readonly fees: Money;
  readonly openingPortfolio: Money;
  readonly traceRefs: readonly CalculationTraceRef[];
} => {
  const currency = request.input.baseCurrency;
  const actions: PlannedAction[] = [];
  const purchaseQuantities = new Map<string, Quantity>();
  let contributionPrincipal = Money.zero(currency);
  let feeTotal = Money.zero(currency);

  const addAction = (item: PlannedAction): void => { actions.push(Object.freeze(item)); };
  for (const item of request.input.transfers) for (const at of occurrences(item.schedule, period)) {
    const provenance = generatedProvenance(request, item.schedulePrimitiveId, at, "internal-account-transfer", item.destinationAccountId);
    const refs = freezeTraceRefs([calculationTraceRef(calculationTraceId(`vs3:transfer:${item.id}:${at}`))])!;
    addAction({ id: `transfer:${item.id}:${at}`, at, order: item.order, effect: createSemanticEffect({ id: semanticEffectId(`effect:transfer:${item.id}:${at}`), kind: "flow", category: "internal_account_transfer", amount: item.amount, occurredAt: at, sourceOccurrenceKey: provenance.generatedOccurrenceKey, provenance, traceRefs: refs }), transaction: transaction(`tx:transfer:${item.id}:${at}`, at, "internal_transfer", [
      { posting: "debit", type: "cash", amount: item.amount, accountId: item.destinationAccountId, cashFlowClass: "non_cash" },
      { posting: "credit", type: "cash", amount: item.amount, accountId: item.sourceAccountId, cashFlowClass: "non_cash" },
    ], refs) });
  }
  for (const item of request.input.purchases) for (const at of occurrences(item.schedule, period)) {
    const position = openingState.positions[item.targetPositionId]!;
    if (!position.price.isPositive()) invalidInput(`Purchase ${item.id} requires a positive position price`, `${item.id}.targetPositionId`);
    const quantity = new Quantity(item.amount.amount.dividedBy(position.price.amount, item.quantityRounding), position.quantity.unit);
    if (!position.price.times(quantity.amount).round(RoundingPolicy.currency(currency.minorUnitScale, "half_up")).equals(item.amount)) invalidInput(`Purchase ${item.id} quantity rounding does not reconcile to its posted amount`, `${item.id}.quantityRounding`);
    const prior = purchaseQuantities.get(item.targetPositionId) ?? Quantity.zero(position.quantity.unit);
    purchaseQuantities.set(item.targetPositionId, prior.plus(quantity));
    contributionPrincipal = contributionPrincipal.plus(item.amount);
    const provenance = generatedProvenance(request, item.schedulePrimitiveId, at, "investment-purchase", item.targetPositionId);
    const refs = freezeTraceRefs([calculationTraceRef(calculationTraceId(`vs3:purchase:${item.id}:${at}`))])!;
    addAction({ id: `purchase:${item.id}:${at}`, at, order: item.order, effect: createSemanticEffect({ id: semanticEffectId(`effect:purchase:${item.id}:${at}`), kind: "flow", category: "investment_purchase_principal", amount: item.amount, occurredAt: at, sourceOccurrenceKey: provenance.generatedOccurrenceKey, provenance, traceRefs: refs }), transaction: transaction(`tx:purchase:${item.id}:${at}`, at, "investment_purchase", [
      { posting: "debit", type: "asset", amount: item.amount, entityId: item.targetPositionId, quantity },
      { posting: "credit", type: "cash", amount: item.amount, accountId: item.sourceCashAccountId, cashFlowClass: "investing" },
    ], refs) });
  }
  for (const item of request.input.fees ?? []) for (const at of occurrences(item.schedule, period)) {
    feeTotal = feeTotal.plus(item.amount);
    const provenance = generatedProvenance(request, item.schedulePrimitiveId, at, "investment-fee", item.cashAccountId);
    const refs = freezeTraceRefs([calculationTraceRef(calculationTraceId(`vs3:fee:${item.id}:${at}`))])!;
    addAction({ id: `fee:${item.id}:${at}`, at, order: item.order, effect: createSemanticEffect({ id: semanticEffectId(`effect:fee:${item.id}:${at}`), kind: "recognition", category: "investment_fee", amount: item.amount, occurredAt: at, sourceOccurrenceKey: provenance.generatedOccurrenceKey, provenance, traceRefs: refs }), transaction: transaction(`tx:fee:${item.id}:${at}`, at, "investment_fee", [
      { posting: "debit", type: "expense", amount: item.amount },
      { posting: "credit", type: "cash", amount: item.amount, accountId: item.cashAccountId, cashFlowClass: "operating" },
    ], refs) });
  }

  actions.sort((left, right) => left.at.localeCompare(right.at) || left.order - right.order || left.id.localeCompare(right.id));
  const closingPrices: Record<string, Money> = {};
  const primitiveWork: PeriodWork[] = [];
  const allTraceRefs: CalculationTraceRef[] = [];
  const closeAt = subtractMilliseconds(period.end, 1);
  for (const item of [...request.input.returns].sort((left, right) => left.targetPositionId.localeCompare(right.targetPositionId))) {
    const position = openingState.positions[item.targetPositionId]!;
    const refs = traceRefs(item.targetPositionId, period);
    allTraceRefs.push(...refs);
    const effectiveReturn = effectiveCompoundingPeriodReturn(item.rate, item.returnBasis);
    const returnAmount = position.price.times(effectiveReturn).round(item.priceRounding);
    const closingPrice = position.price.plus(returnAmount).round(item.priceRounding);
    if (closingPrice.isNegative()) invalidInput(`Return creates a negative price for ${item.targetPositionId}`, "input.returns.rate");
    closingPrices[item.targetPositionId] = closingPrice;
    const closingQuantity = position.quantity.plus(purchaseQuantities.get(item.targetPositionId) ?? Quantity.zero(position.quantity.unit));
    primitiveWork.push({ id: `return:${item.targetPositionId}`, kind: "primitive", request: { primitiveId: "P23", input: { baseValue: position.price, rate: item.rate }, parameters: { returnBasis: item.returnBasis, cashFlowTiming: "end_of_period", postingRounding: item.priceRounding }, context: { evaluationInstant: closeAt, scenarioId: request.runContext.scenarioId, primitiveInstanceId: item.primitiveIds.compounding, economicTargetId: item.targetPositionId, semanticEffectType: "investment-return", traceRefs: refs } } });
    primitiveWork.push({ id: `valuation:${item.targetPositionId}`, kind: "primitive", dependsOn: [`return:${item.targetPositionId}`], request: { primitiveId: "P26", input: { quantity: closingQuantity, price: closingPrice }, parameters: { expectedUnit: position.quantity.unit, expectedCurrency: currency }, context: { evaluationInstant: closeAt, scenarioId: request.runContext.scenarioId, primitiveInstanceId: item.primitiveIds.markToMarket, economicTargetId: item.targetPositionId, semanticEffectType: "mark-to-market", traceRefs: refs } } });
  }
  const semanticWork: PeriodWork[] = actions.map((action, index) => ({
    id: action.id,
    kind: "semantic",
    at: action.at,
    effect: action.effect,
    transaction: action.transaction,
    ...(index === 0 ? {} : { dependsOn: [actions[index - 1]!.id] }),
  }));
  return Object.freeze({
    work: Object.freeze([...primitiveWork, ...semanticWork]),
    closingPrices: Object.freeze(closingPrices),
    contributionPrincipal,
    fees: feeTotal,
    openingPortfolio: totalPositionMarketValue(Object.values(openingState.positions), currency),
    traceRefs: freezeTraceRefs(allTraceRefs)!,
  });
};

export const runVerticalSlice3 = (request: VerticalSlice3RunInput): VerticalSlice3RunResult => {
  const months = request.months ?? utcMonthDifference(request.runContext.simulationStart, request.runContext.simulationEnd);
  const periods = utcMonthlyPeriods(request.runContext.simulationStart, months);
  validateInput(request, periods);
  const requestedHorizon = Object.freeze({ start: periods[0]!.start, end: periods[periods.length - 1]!.end });
  const runMetadata = createRunMetadata(request.runContext, createInputFingerprint({ runContext: request.runContext, openingState: request.openingState, model: canonicalInputForFingerprint(request.input), executionPlan: { months } }));
  let state = cloneAuthoritativeState(request.openingState);
  let primitiveState = createPrimitiveRuntimeStateStore(request.primitiveState);
  const committed: VerticalSlice3PeriodResult[] = [];
  const diagnostics: ValidationIssue[] = [];

  for (const target of periods) {
    try {
      const plan = planPeriod(request, target, state);
      const result = runPeriod({ period: target, runContext: request.runContext, openingState: state, primitiveState, work: plan.work });
      const valuedState = cloneAuthoritativeState(result.closingState);
      const valuationEffects: SemanticEffect[] = [];
      for (const item of [...request.input.returns].sort((left, right) => left.targetPositionId.localeCompare(right.targetPositionId))) {
        const before = positionMarketValue(valuedState.positions[item.targetPositionId]!);
        applyPositionPriceAtomically(valuedState, item.targetPositionId, plan.closingPrices[item.targetPositionId]!);
        const after = positionMarketValue(valuedState.positions[item.targetPositionId]!);
        const change = after.minus(before);
        valuationEffects.push(createSemanticEffect({ id: semanticEffectId(`effect:valuation:${item.targetPositionId}:${target.end}`), kind: "valuation", category: change.isNegative() ? "unrealized_investment_loss" : "unrealized_investment_gain", amount: change, occurredAt: subtractMilliseconds(target.end, 1), description: "Non-cash mark-to-market; no realized gain or settlement", traceRefs: traceRefs(item.targetPositionId, target), provenance: createFactProvenance({ factKind: "model_generated", sourceType: "model", sourceId: item.primitiveIds.markToMarket, effectiveAt: subtractMilliseconds(target.end, 1) }) }));
      }
      const closingPortfolio = totalPositionMarketValue(Object.values(valuedState.positions), request.input.baseCurrency);
      const unrealizedGain = closingPortfolio.minus(plan.openingPortfolio).minus(plan.contributionPrincipal);
      const accountValues = Object.freeze(Object.fromEntries(Object.keys(valuedState.accounts).sort().map((id) => [id, accountValueFromState(valuedState, id)])));
      const effects = Object.freeze([...result.effects, ...valuationEffects]);
      committed.push(Object.freeze({
        period: target,
        transactions: result.transactions,
        effects,
        statements: deriveStatements(valuedState, result.transactions, request.input.baseCurrency),
        accountValues,
        portfolioValue: closingPortfolio,
        contributionPrincipal: plan.contributionPrincipal,
        fees: plan.fees,
        unrealizedGain,
        realizedGain: Money.zero(request.input.baseCurrency),
        cashInvestmentIncome: Money.zero(request.input.baseCurrency),
        traceRefs: plan.traceRefs,
      }));
      state = valuedState;
      primitiveState = result.primitiveState;
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      diagnostics.push(...error.issues);
      return Object.freeze({ status: "incomplete", runMetadata, requestedHorizon, stoppedAt: target.start, ...(committed.length === 0 ? {} : { reachedThrough: committed[committed.length - 1]!.period.end }), state, primitiveState, periods: Object.freeze(committed), diagnostics: Object.freeze(diagnostics) });
    }
  }
  return Object.freeze({ status: "completed", runMetadata, requestedHorizon, reachedThrough: requestedHorizon.end, state, primitiveState, periods: Object.freeze(committed), diagnostics: Object.freeze(diagnostics) });
};

export const createVerticalSlice3Id = <Kind extends string>(kind: Kind, value: string): DomainId<Kind> => domainId(kind, value);
