import { accountingTransactionId, createAccountingLeg, createAccountingTransaction, type AccountingLegDraft, type AccountingTransaction, type AccountId, type PositionId } from "../accounting/index.js";
import { ValidationError, failValidation, issueCodes, type ValidationIssue } from "../diagnostics/index.js";
import { domainId, generatedOccurrenceKey, type DomainId, type GeneratedOccurrenceKey } from "../identity/index.js";
import { calculationTraceId, calculationTraceRef, freezeTraceRefs, mergeTraceRefs, type CalculationTraceRef } from "../lineage/index.js";
import { createFactProvenance, type ModelGeneratedFactProvenance } from "../model/provenance.js";
import { type CompoundingReturnBasis } from "../primitives/index.js";
import { createSemanticEffect, semanticEffectId, type SemanticEffect } from "../semantics/index.js";
import { applyPositionValuationAtomically, assertAuthoritativeStateCurrency, cloneAuthoritativeState, type AuthoritativeState } from "../state/index.js";
import { deriveStatements, type Statements } from "../statements/index.js";
import { subtractMilliseconds, utcMonthDifference, utcMonthlyOccurrences, utcMonthlyPeriods, type Instant, type Period } from "../time/index.js";
import { accountValueFromState, positionMarketValue, totalPositionMarketValue } from "../valuation/index.js";
import { Money, Quantity, RateBasis, RoundingPolicy, type Currency, type Rate } from "../values/index.js";
import { evaluateFixedFee, resolveEffectiveRule, validateRuleBinding, validateRuleCatalog, type FinancialRuleId, type RuleApplication, type RuleCatalog } from "../rules/index.js";
import { createPrimitiveRuntimeStateStore, runPeriod, type PeriodWork, type PrimitiveRuntimeStateStore } from "./period.js";
import { createInputFingerprint, createRunMetadata, type RunContext, type RunMetadata } from "./run.js";
import { executeVerticalSlice2PeriodCandidate, type VerticalSlice2Input, type VerticalSlice2PeriodResult, type VerticalSlice2RunInput } from "./verticalSlice2.js";
import type { HouseholdWorkDescriptor } from "./intraperiodScheduler.js";

export type HouseholdId = DomainId<"household">;
export type PersonId = DomainId<"person">;
export type TransferId = DomainId<"transfer">;
export type PurchaseId = DomainId<"investment-purchase">;
export type InvestmentFeeId = DomainId<"investment-fee">;
export type PrimitiveInstanceId = DomainId<"primitive-instance">;
export type InvestmentSchedule = { readonly kind: "explicit_instants"; readonly instants: readonly Instant[] } | { readonly kind: "utc_monthly"; readonly anchor: Instant; readonly invalidDayPolicy: "skip" };
interface ScheduledOperation { readonly eligibilitySchedule: InvestmentSchedule; readonly executionTiming: "end_of_period"; readonly order: number; readonly schedulePrimitiveId: PrimitiveInstanceId; readonly sourceTraceRefs?: readonly CalculationTraceRef[]; }
export interface OwnedCashTransfer extends ScheduledOperation { readonly id: TransferId; readonly sourceAccountId: AccountId; readonly destinationAccountId: AccountId; readonly amount: Money; }
export interface InvestmentPurchase extends ScheduledOperation { readonly id: PurchaseId; readonly sourceCashAccountId: AccountId; readonly destinationAccountId: AccountId; readonly targetPositionId: PositionId; readonly amount: Money; readonly quantityRounding: RoundingPolicy; }
export interface InvestmentFee extends ScheduledOperation { readonly id: InvestmentFeeId; readonly cashAccountId: AccountId; readonly feeRuleIds: readonly FinancialRuleId[]; }
export interface DeterministicPositionReturn { readonly targetPositionId: PositionId; readonly accountId: AccountId; readonly rate: Rate; readonly returnBasis: CompoundingReturnBasis; readonly timing: "end_of_period_on_opening_quantity"; readonly priceRounding: RoundingPolicy; readonly primitiveIds: { readonly compounding: PrimitiveInstanceId; readonly markToMarket: PrimitiveInstanceId }; readonly sourceTraceRefs?: readonly CalculationTraceRef[]; }
export interface VerticalSlice3Input {
  readonly householdId: HouseholdId; readonly ownerId: PersonId; readonly baseCurrency: Currency;
  /** Economic price/value changes only; no cash or accounting gain leg. */
  readonly valuationAccountingPolicy: "economic_only";
  readonly cashFlowInput?: VerticalSlice2Input;
  readonly ruleCatalog: RuleCatalog; readonly transfers: readonly OwnedCashTransfer[]; readonly purchases: readonly InvestmentPurchase[]; readonly fees?: readonly InvestmentFee[]; readonly returns: readonly DeterministicPositionReturn[];
}
/**
 * Composition seam for a cash-flow period. Household orchestration supplies
 * this from its shared candidate stream; standalone VS3 retains the VS2
 * implementation as its compatibility default.
 */
export type VerticalSlice3CashFlowPeriodExecutor = (input: {
  readonly runContext: RunContext;
  readonly input: VerticalSlice2Input;
  readonly period: Period;
  readonly openingState: AuthoritativeState;
  readonly primitiveState: PrimitiveRuntimeStateStore;
}) => { readonly state: AuthoritativeState; readonly primitiveState: PrimitiveRuntimeStateStore; readonly period: VerticalSlice2PeriodResult };

export interface VerticalSlice3RunInput { readonly runContext: RunContext; readonly openingState: AuthoritativeState; readonly input: VerticalSlice3Input; readonly months?: number; readonly primitiveState?: PrimitiveRuntimeStateStore; readonly cashFlowPeriodExecutor?: VerticalSlice3CashFlowPeriodExecutor; }
export interface VerticalSlice3PeriodResult { readonly period: Period; readonly transactions: readonly AccountingTransaction[]; readonly effects: readonly SemanticEffect[]; readonly statements: Statements; readonly accountValues: Readonly<Record<string, Money>>; readonly portfolioValue: Money; readonly contributionPrincipal: Money; readonly fees: Money; readonly unrealizedGain: Money; readonly realizedGain: Money; readonly cashInvestmentIncome: Money; readonly ruleApplications: readonly RuleApplication<Money>[]; readonly traceRefs: readonly CalculationTraceRef[]; readonly cashFlowPeriod?: VerticalSlice2PeriodResult; }
export interface VerticalSlice3RunResult { readonly status: "completed" | "incomplete"; readonly runMetadata: RunMetadata; readonly requestedHorizon: Period; readonly reachedThrough?: Instant; readonly stoppedAt?: Instant; readonly state: AuthoritativeState; readonly primitiveState: PrimitiveRuntimeStateStore; readonly periods: readonly VerticalSlice3PeriodResult[]; readonly diagnostics: readonly ValidationIssue[]; }

export type PreparedVerticalSlice3Operation =
  | { readonly kind: "valuation"; readonly descriptor: HouseholdWorkDescriptor; readonly returnConfiguration: DeterministicPositionReturn; readonly closingPrice: Money; readonly marketValue: Money }
  | { readonly kind: "transfer"; readonly descriptor: HouseholdWorkDescriptor; readonly operation: OwnedCashTransfer }
  | { readonly kind: "purchase"; readonly descriptor: HouseholdWorkDescriptor; readonly operation: InvestmentPurchase; readonly closingPrice: Money }
  | { readonly kind: "fee"; readonly descriptor: HouseholdWorkDescriptor; readonly operation: InvestmentFee };
type PreparedVerticalSlice3ScheduledOperation = Exclude<PreparedVerticalSlice3Operation, { readonly kind: "valuation" }>;

export interface PreparedVerticalSlice3Period {
  readonly period: Period;
  /** State and primitive runtime after deterministic return/valuation preparation. */
  readonly state: AuthoritativeState;
  readonly primitiveState: PrimitiveRuntimeStateStore;
  readonly closingPrices: Readonly<Record<string, Money>>;
  readonly descriptors: readonly HouseholdWorkDescriptor[];
  readonly operations: readonly PreparedVerticalSlice3Operation[];
  readonly traceRefs: readonly CalculationTraceRef[];
}

export interface ExecutedVerticalSlice3Operation {
  readonly state: AuthoritativeState;
  readonly primitiveState: PrimitiveRuntimeStateStore;
  readonly effects: readonly SemanticEffect[];
  readonly transactions: readonly AccountingTransaction[];
  readonly contributionPrincipal: Money;
  readonly fees: Money;
  readonly ruleApplications: readonly RuleApplication<Money>[];
  readonly unrealizedGain: Money;
}

const invalid = (message: string, fieldPath: string): never => failValidation({ severity: "error", code: issueCodes.verticalSlice3InputInvalid, message, entityType: "vertical_slice_3", fieldPath });
const closeAt = (period: Period): Instant => subtractMilliseconds(period.end, 1);
const selected = (schedule: InvestmentSchedule, period: Period): readonly Instant[] => schedule.kind === "explicit_instants" ? Object.freeze(schedule.instants.filter((at) => at >= period.start && at < period.end).sort()) : utcMonthlyOccurrences(schedule.anchor, period, schedule.invalidDayPolicy);
const traceRefs = (item: DeterministicPositionReturn, period: Period): readonly CalculationTraceRef[] => mergeTraceRefs([calculationTraceRef(calculationTraceId(`vs3:return:${item.targetPositionId}:${period.start}`)), calculationTraceRef(calculationTraceId(`vs3:valuation:${item.targetPositionId}:${period.end}`))], item.sourceTraceRefs)!;
const generated = (request: VerticalSlice3RunInput, primitiveInstanceId: PrimitiveInstanceId, at: Instant, semanticEffectType: string, target: DomainId<string>): ModelGeneratedFactProvenance & { readonly generatedOccurrenceKey: GeneratedOccurrenceKey } => {
  const key = generatedOccurrenceKey({ scenarioId: request.runContext.scenarioId, primitiveInstanceId, scheduledAt: at, semanticEffectType, economicTargetId: target });
  return createFactProvenance({ factKind: "model_generated", sourceType: "model", sourceId: primitiveInstanceId, effectiveAt: at, generatedOccurrenceKey: key }) as ModelGeneratedFactProvenance & { readonly generatedOccurrenceKey: GeneratedOccurrenceKey };
};
const transaction = (id: string, date: Instant, type: string, legs: readonly AccountingLegDraft[], refs: readonly CalculationTraceRef[]): AccountingTransaction => createAccountingTransaction({ id: accountingTransactionId(id), date, type, legs: legs.map((leg) => createAccountingLeg({ ...leg, traceRefs: leg.traceRefs ?? refs })), traceRefs: refs });
const targets = (item: OwnedCashTransfer | InvestmentPurchase | InvestmentFee): readonly string[] => "sourceAccountId" in item ? [`account:${item.sourceAccountId}`, `account:${item.destinationAccountId}`] : "sourceCashAccountId" in item ? [`account:${item.sourceCashAccountId}`, `position:${item.targetPositionId}`] : [`account:${item.cashAccountId}`];

const canonicalInputForFingerprint = (input: VerticalSlice3Input): unknown => {
  const schedule = (value: InvestmentSchedule): InvestmentSchedule => value.kind === "explicit_instants"
    ? Object.freeze({ ...value, instants: Object.freeze([...value.instants].sort()) })
    : value;
  const byId = <T extends { readonly id: string; readonly eligibilitySchedule: InvestmentSchedule }>(values: readonly T[]): readonly T[] => Object.freeze([...values].sort((left, right) => left.id.localeCompare(right.id)).map((value) => Object.freeze({ ...value, eligibilitySchedule: schedule(value.eligibilitySchedule) })));
  return Object.freeze({ ...input, ruleCatalog: Object.freeze([...input.ruleCatalog].sort((left, right) => left.id.localeCompare(right.id))), transfers: byId(input.transfers), purchases: byId(input.purchases), fees: Object.freeze(byId(input.fees ?? []).map((fee) => Object.freeze({ ...fee, feeRuleIds: Object.freeze([...fee.feeRuleIds].sort()) }))), returns: Object.freeze([...input.returns].sort((left, right) => left.targetPositionId.localeCompare(right.targetPositionId))) });
};

const validate = (request: VerticalSlice3RunInput, periods: readonly Period[]): void => {
  const { input, openingState, runContext } = request;
  if (!input.baseCurrency.equals(runContext.baseCurrency)) invalid("Slice currency must match run context", "input.baseCurrency");
  if (input.valuationAccountingPolicy !== "economic_only") invalid("Only economic_only valuation accounting is supported", "input.valuationAccountingPolicy");
  assertAuthoritativeStateCurrency(openingState, input.baseCurrency);
  validateRuleCatalog(input.ruleCatalog);
  if (periods[0]!.start !== runContext.simulationStart || periods[periods.length - 1]!.end !== runContext.simulationEnd) invalid("Monthly periods must exactly cover the requested run horizon", "months");
  const ids = [...input.transfers.flatMap((x) => [x.id, x.schedulePrimitiveId]), ...input.purchases.flatMap((x) => [x.id, x.schedulePrimitiveId]), ...(input.fees ?? []).flatMap((x) => [x.id, x.schedulePrimitiveId]), ...input.returns.flatMap((x) => [x.primitiveIds.compounding, x.primitiveIds.markToMarket])];
  if (new Set(ids).size !== ids.length) invalid("Operation and primitive identities must be unique", "input");
  const owned = (id: AccountId, path: string): void => { const account = openingState.accounts[id]; if (account === undefined || account.ownerId !== input.ownerId) invalid(`Account ${id} must exist and belong to the configured owner`, path); };
  const operations = [...input.transfers, ...input.purchases, ...(input.fees ?? [])];
  for (const item of operations) {
    if (item.executionTiming !== "end_of_period") invalid("VS3 operations execute only at end_of_period", `${item.id}.executionTiming`);
    if (!Number.isSafeInteger(item.order) || item.order < 0) invalid("Operation order must be a non-negative integer", `${item.id}.order`);
    if ("amount" in item && (!item.amount.isPositive() || !item.amount.currency.equals(input.baseCurrency) || !item.amount.amount.fitsScale(input.baseCurrency.minorUnitScale))) invalid("Operation amount must be strictly positive posted money", `${item.id}.amount`);
    if ("feeRuleIds" in item) {
      const feeRules = validateRuleBinding(input.ruleCatalog, item.feeRuleIds, "fixed_fee", { targetType: "account", targetId: item.cashAccountId });
      for (const rule of feeRules) if (!rule.amount.currency.equals(input.baseCurrency) || !rule.amount.amount.fitsScale(input.baseCurrency.minorUnitScale)) invalid("Fee rule amount must use posted base-currency precision", `${rule.id}.amount`);
    }
    for (const period of periods) { if (item.eligibilitySchedule.kind === "explicit_instants" && new Set(item.eligibilitySchedule.instants).size !== item.eligibilitySchedule.instants.length) invalid("Schedule instants must be unique", `${item.id}.eligibilitySchedule`); if (selected(item.eligibilitySchedule, period).length > 1) invalid("An operation may occur at most once per month", `${item.id}.eligibilitySchedule`); }
  }
  for (const item of input.transfers) { owned(item.sourceAccountId, `${item.id}.sourceAccountId`); owned(item.destinationAccountId, `${item.id}.destinationAccountId`); if (item.sourceAccountId === item.destinationAccountId) invalid("Transfer endpoints must differ", `${item.id}.destinationAccountId`); }
  for (const item of input.purchases) { owned(item.sourceCashAccountId, `${item.id}.sourceCashAccountId`); owned(item.destinationAccountId, `${item.id}.destinationAccountId`); const position = openingState.positions[item.targetPositionId]; if (position === undefined || position.accountId !== item.destinationAccountId) invalid("Purchase target position/account is invalid", `${item.id}.targetPositionId`); }
  for (const item of input.fees ?? []) owned(item.cashAccountId, `${item.id}.cashAccountId`);
  const configuredReturns = new Set<string>();
  for (const item of input.returns) {
    if (configuredReturns.has(item.targetPositionId)) invalid("Each position requires one return configuration", "input.returns"); configuredReturns.add(item.targetPositionId);
    const position = openingState.positions[item.targetPositionId]; if (position === undefined || position.accountId !== item.accountId) invalid("Return target position/account is invalid", "input.returns"); owned(item.accountId, "input.returns.accountId");
    if (item.timing !== "end_of_period_on_opening_quantity") invalid("Returns must precede period-end purchases", "input.returns.timing");
    if (item.returnBasis.kind === "periodic" && (item.rate.convention.basis !== RateBasis.Periodic || item.returnBasis.period.unit !== "calendar_month" || item.returnBasis.period.count.toString() !== "1" || item.rate.convention.period.unit !== item.returnBasis.period.unit || item.rate.convention.period.count.compare(item.returnBasis.period.count) !== 0)) invalid("Monthly periodic return must match a one-calendar-month periodic Rate", "input.returns.returnBasis");
    if (item.returnBasis.kind === "effective_annual" && (item.rate.convention.basis !== RateBasis.EffectiveAnnual || item.returnBasis.yearFraction.numerator !== 1 || item.returnBasis.yearFraction.denominator !== 12)) invalid("Monthly effective annual return requires an effective annual Rate and explicit 1/12", "input.returns.returnBasis");
    if (item.returnBasis.kind === "nominal_annual" && (item.rate.convention.basis !== RateBasis.NominalAnnual || item.returnBasis.compoundingPeriods !== 1 || item.rate.convention.compoundingPeriodsPerYear !== 12)) invalid("Monthly nominal annual return requires monthly contractual compounding", "input.returns.returnBasis");
  }
  for (const item of input.purchases) if (!configuredReturns.has(item.targetPositionId)) invalid("Purchased positions require return/valuation configuration", "input.purchases");
  if (input.cashFlowInput !== undefined) {
    if (input.cashFlowInput.householdId !== input.householdId || input.cashFlowInput.ownerId !== input.ownerId || !input.cashFlowInput.baseCurrency.equals(input.baseCurrency)) invalid("VS2 configuration must match VS3 household, owner, and currency", "input.cashFlowInput");
    const vs2Ids = new Set([input.cashFlowInput.cashAccountId, input.cashFlowInput.expensePayableLiabilityId, ...input.cashFlowInput.events.map((event) => event.id), ...input.cashFlowInput.incomes.flatMap((item) => [item.id, item.primitiveIds.growth, item.primitiveIds.recurrence, item.primitiveIds.activation, item.primitiveIds.termination]), ...input.cashFlowInput.expenses.flatMap((item) => [item.id, item.primitiveIds.indexGrowth, item.primitiveIds.inflationLink, item.primitiveIds.recurrence, item.primitiveIds.activation, item.primitiveIds.termination])].filter((id) => id !== undefined).map((id) => String(id)));
    const vs3Ids = new Set<string>([...input.transfers.flatMap((item) => [item.id, item.schedulePrimitiveId]), ...input.purchases.flatMap((item) => [item.id, item.schedulePrimitiveId]), ...(input.fees ?? []).flatMap((item) => [item.id, item.schedulePrimitiveId]), ...input.returns.flatMap((item) => [item.primitiveIds.compounding, item.primitiveIds.markToMarket])]);
    if ([...vs3Ids].some((id) => vs2Ids.has(id))) failValidation({ severity: "error", code: issueCodes.duplicateStableIdentity, message: "VS2 and VS3 stable identities must not collide", entityType: "vertical_slice_3", fieldPath: "input.cashFlowInput" });
  }
  for (const period of periods) {
    const grouped = new Map<string, (typeof operations)[number][]>();
    for (const item of operations.filter((x) => selected(x.eligibilitySchedule, period).length === 1)) for (const target of targets(item)) grouped.set(target, [...(grouped.get(target) ?? []), item]);
    for (const items of grouped.values()) if (new Set(items.map((x) => x.order)).size !== items.length) invalid("Same-target period-end operations require distinct order", "input");
  }
};

interface Action { readonly id: string; readonly at: Instant; readonly order: number; readonly targets: readonly string[]; readonly effect: SemanticEffect; readonly transaction: AccountingTransaction; }
const actionWork = (actions: readonly Action[]): readonly PeriodWork[] => {
  const deps = new Map<string, Set<string>>(actions.map((action) => [action.id, new Set<string>()]));
  for (const target of new Set(actions.flatMap((action) => action.targets))) { const chain = actions.filter((action) => action.targets.includes(target)).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)); for (let i = 1; i < chain.length; i += 1) deps.get(chain[i]!.id)!.add(chain[i - 1]!.id); }
  return Object.freeze(actions.map((action) => Object.freeze({ id: action.id, kind: "semantic" as const, at: action.at, effect: action.effect, transaction: action.transaction, ...(deps.get(action.id)!.size === 0 ? {} : { dependsOn: Object.freeze([...deps.get(action.id)!].sort()) }) })));
};
const householdDescriptor = (value: Omit<HouseholdWorkDescriptor, "dependsOn" | "traceRefs"> & { readonly dependsOn?: readonly string[] }): HouseholdWorkDescriptor =>
  Object.freeze({ ...value, dependsOn: Object.freeze([...(value.dependsOn ?? [])].sort()), traceRefs: Object.freeze([]) });

const operations = (request: VerticalSlice3RunInput, period: Period, state: AuthoritativeState, closing: Readonly<Record<string, Money>>, selectedId?: string): { readonly work: readonly PeriodWork[]; readonly contributionPrincipal: Money; readonly fees: Money; readonly ruleApplications: readonly RuleApplication<Money>[] } => {
  const actions: Action[] = []; const ruleApplications: RuleApplication<Money>[] = []; let contributionPrincipal = Money.zero(request.input.baseCurrency); let fees = Money.zero(request.input.baseCurrency); const at = closeAt(period);
  for (const item of request.input.transfers) if (selected(item.eligibilitySchedule, period).length === 1 && (selectedId === undefined || selectedId === `transfer:${item.id}:${at}`)) { const p = generated(request, item.schedulePrimitiveId, at, "internal-account-transfer", item.destinationAccountId); const refs = freezeTraceRefs([calculationTraceRef(calculationTraceId(`vs3:transfer:${item.id}:${at}`))])!; actions.push({ id: `transfer:${item.id}:${at}`, at, order: item.order, targets: targets(item), effect: createSemanticEffect({ id: semanticEffectId(`effect:transfer:${item.id}:${at}`), kind: "flow", category: "internal_account_transfer", amount: item.amount, occurredAt: at, sourceOccurrenceKey: p.generatedOccurrenceKey, provenance: p, traceRefs: refs }), transaction: transaction(`tx:transfer:${item.id}:${at}`, at, "internal_transfer", [{ posting: "debit", type: "cash", amount: item.amount, accountId: item.destinationAccountId, cashFlowClass: "non_cash" }, { posting: "credit", type: "cash", amount: item.amount, accountId: item.sourceAccountId, cashFlowClass: "non_cash" }], refs) }); }
  for (const item of request.input.purchases) if (selected(item.eligibilitySchedule, period).length === 1 && (selectedId === undefined || selectedId === `purchase:${item.id}:${at}`)) { const price = closing[item.targetPositionId]; const position = state.positions[item.targetPositionId]!; const purchasePrice = price !== undefined && price.isPositive() ? price : invalid("Purchase requires positive P23 closing price", `${item.id}.targetPositionId`); const quantity = new Quantity(item.amount.amount.dividedBy(purchasePrice.amount, item.quantityRounding), position.quantity.unit); if (!purchasePrice.times(quantity.amount).round(RoundingPolicy.currency(request.input.baseCurrency.minorUnitScale, "half_up")).equals(item.amount)) invalid("Purchase quantity rounding does not reconcile to posted amount", `${item.id}.quantityRounding`); const p = generated(request, item.schedulePrimitiveId, at, "investment-purchase", item.targetPositionId); const refs = mergeTraceRefs([calculationTraceRef(calculationTraceId(`vs3:purchase:${item.id}:${at}`))], item.sourceTraceRefs)!; contributionPrincipal = contributionPrincipal.plus(item.amount); actions.push({ id: `purchase:${item.id}:${at}`, at, order: item.order, targets: targets(item), effect: createSemanticEffect({ id: semanticEffectId(`effect:purchase:${item.id}:${at}`), kind: "flow", category: "investment_purchase_principal", amount: item.amount, occurredAt: at, sourceOccurrenceKey: p.generatedOccurrenceKey, provenance: p, traceRefs: refs }), transaction: transaction(`tx:purchase:${item.id}:${at}`, at, "investment_purchase", [{ posting: "debit", type: "asset", amount: item.amount, entityId: item.targetPositionId, quantity }, { posting: "credit", type: "cash", amount: item.amount, accountId: item.sourceCashAccountId, cashFlowClass: "investing" }], refs) }); }
  for (const item of request.input.fees ?? []) if (selected(item.eligibilitySchedule, period).length === 1 && (selectedId === undefined || selectedId === `fee:${item.id}:${at}`)) { const resolved = resolveEffectiveRule(request.input.ruleCatalog, item.feeRuleIds, "fixed_fee", { targetType: "account", targetId: item.cashAccountId }, at); const rule = resolved.rule; if (!rule.amount.currency.equals(request.input.baseCurrency) || !rule.amount.amount.fitsScale(request.input.baseCurrency.minorUnitScale)) invalid("Fee rule amount must use posted base-currency precision", `${rule.id}.amount`); const rawApplication = evaluateFixedFee(resolved); const refs = mergeTraceRefs(rawApplication.traceRefs, item.sourceTraceRefs)!; const application = Object.freeze({ ...rawApplication, traceRefs: refs }); ruleApplications.push(application); if (!application.result.isPositive()) continue; const p = generated(request, item.schedulePrimitiveId, at, "investment-fee", item.cashAccountId); fees = fees.plus(application.result); actions.push({ id: `fee:${item.id}:${at}`, at, order: item.order, targets: targets(item), effect: createSemanticEffect({ id: semanticEffectId(`effect:fee:${item.id}:${at}`), kind: "recognition", category: "investment_fee", amount: application.result, occurredAt: at, sourceOccurrenceKey: p.generatedOccurrenceKey, provenance: p, traceRefs: refs }), transaction: transaction(`tx:fee:${item.id}:${at}`, at, "investment_fee", [{ posting: "debit", type: "expense", amount: application.result }, { posting: "credit", type: "cash", amount: application.result, accountId: item.cashAccountId, cashFlowClass: "operating" }], refs) }); }
  return Object.freeze({ work: actionWork(actions), contributionPrincipal, fees, ruleApplications: Object.freeze(ruleApplications) });
};

const operationTarget = (item: OwnedCashTransfer | InvestmentPurchase | InvestmentFee): readonly string[] => targets(item);
const operationId = (kind: PreparedVerticalSlice3Operation["kind"], id: string, at: Instant): string => `investment-${kind}:${id}:${at}`;

/** Prepares P23/P26 and only the currently eligible end-of-period operations. */
export const prepareVerticalSlice3Period = (
  runContext: RunContext,
  input: VerticalSlice3Input,
  period: Period,
  currentState: AuthoritativeState,
  currentPrimitiveState: PrimitiveRuntimeStateStore = {},
): PreparedVerticalSlice3Period => {
  const scopedContext = Object.freeze({ ...runContext, simulationStart: period.start, simulationEnd: period.end });
  const request: VerticalSlice3RunInput = { runContext: scopedContext, openingState: currentState, input, months: 1, primitiveState: currentPrimitiveState };
  validate(request, [period]);
  const p23Work: PeriodWork[] = input.returns.slice().sort((a, b) => a.targetPositionId.localeCompare(b.targetPositionId)).map((item) => ({ id: `return:${item.targetPositionId}`, kind: "primitive", request: { primitiveId: "P23", input: { baseValue: currentState.positions[item.targetPositionId]!.price, rate: item.rate }, parameters: { returnBasis: item.returnBasis, cashFlowTiming: "end_of_period", postingRounding: item.priceRounding }, context: { evaluationInstant: closeAt(period), scenarioId: scopedContext.scenarioId, primitiveInstanceId: item.primitiveIds.compounding, economicTargetId: item.targetPositionId, semanticEffectType: "investment-return", traceRefs: traceRefs(item, period) } } }));
  const p23 = runPeriod({ period, runContext: scopedContext, openingState: currentState, primitiveState: currentPrimitiveState, work: p23Work });
  const closingPrices = Object.fromEntries(input.returns.map((item) => [item.targetPositionId, (p23.primitiveOutputs.find((output) => output.primitiveInstanceId === item.primitiveIds.compounding)!.output as { readonly closingValue: Money }).closingValue])) as Readonly<Record<string, Money>>;
  const p26Work: PeriodWork[] = input.returns.slice().sort((a, b) => a.targetPositionId.localeCompare(b.targetPositionId)).map((item) => ({ id: `valuation:${item.targetPositionId}`, kind: "primitive", request: { primitiveId: "P26", input: { quantity: currentState.positions[item.targetPositionId]!.quantity, price: closingPrices[item.targetPositionId]! }, parameters: { expectedUnit: currentState.positions[item.targetPositionId]!.quantity.unit, expectedCurrency: input.baseCurrency }, context: { evaluationInstant: closeAt(period), scenarioId: scopedContext.scenarioId, primitiveInstanceId: item.primitiveIds.markToMarket, economicTargetId: item.targetPositionId, semanticEffectType: "mark-to-market", traceRefs: traceRefs(item, period) } } }));
  const p26 = runPeriod({ period, runContext: scopedContext, openingState: currentState, primitiveState: p23.primitiveState, work: p26Work });
  const valuationDescriptors = input.returns.slice().sort((a, b) => a.targetPositionId.localeCompare(b.targetPositionId)).map((item) => householdDescriptor({ id: operationId("valuation", String(item.targetPositionId), closeAt(period)), domain: "investments", sequencingInstant: closeAt(period), resourceAccesses: [], primitiveInstanceId: item.primitiveIds.markToMarket, occurrenceIdentity: generatedOccurrenceKey({ scenarioId: scopedContext.scenarioId, primitiveInstanceId: item.primitiveIds.markToMarket, scheduledAt: closeAt(period), semanticEffectType: "mark-to-market", economicTargetId: item.targetPositionId }) }));
  const operationsPrepared: PreparedVerticalSlice3ScheduledOperation[] = [];
  const operationDescriptors: HouseholdWorkDescriptor[] = [];
  const valuationByTarget = new Map(valuationDescriptors.map((descriptor) => [String(descriptor.id).split(":")[1], descriptor]));
  function addOperation(item: OwnedCashTransfer, kind: "transfer"): void;
  function addOperation(item: InvestmentPurchase, kind: "purchase"): void;
  function addOperation(item: InvestmentFee, kind: "fee"): void;
  function addOperation(item: OwnedCashTransfer | InvestmentPurchase | InvestmentFee, kind: "transfer" | "purchase" | "fee"): void {
    if (selected(item.eligibilitySchedule, period).length !== 1) return;
    const at = closeAt(period); const target = "targetPositionId" in item ? String(item.targetPositionId) : undefined;
    const dependsOn = target === undefined ? valuationDescriptors.map((descriptor) => descriptor.id) : [valuationByTarget.get(target)!.id];
    const resourceAccesses = kind === "transfer"
      ? [{ kind: "account_cash" as const, accountId: (item as OwnedCashTransfer).sourceAccountId, mode: "consume" as const }, { kind: "account_cash" as const, accountId: (item as OwnedCashTransfer).destinationAccountId, mode: "produce" as const }]
      : kind === "purchase"
        ? [{ kind: "account_cash" as const, accountId: (item as InvestmentPurchase).sourceCashAccountId, mode: "consume" as const }]
        : [{ kind: "account_cash" as const, accountId: (item as InvestmentFee).cashAccountId, mode: "consume" as const }];
    const descriptor = householdDescriptor({ id: operationId(kind, String(item.id), at), domain: "investments", operationClass: kind === "transfer" ? "investment_transfer" : kind === "purchase" ? "investment_purchase" : "investment_fee", sequencingInstant: at, dependsOn, resourceAccesses, primitiveInstanceId: item.schedulePrimitiveId, occurrenceIdentity: generatedOccurrenceKey({ scenarioId: scopedContext.scenarioId, primitiveInstanceId: item.schedulePrimitiveId, scheduledAt: at, semanticEffectType: `investment-${kind}`, economicTargetId: (target ?? String(item.id)) as DomainId<string> }) });
    operationDescriptors.push(descriptor);
    if (kind === "transfer") operationsPrepared.push({ kind, descriptor, operation: item as OwnedCashTransfer });
    else if (kind === "purchase") operationsPrepared.push({ kind, descriptor, operation: item as InvestmentPurchase, closingPrice: closingPrices[(item as InvestmentPurchase).targetPositionId]! });
    else operationsPrepared.push({ kind, descriptor, operation: item as InvestmentFee });
  }
  for (const item of input.transfers) addOperation(item, "transfer");
  for (const item of input.purchases) addOperation(item, "purchase");
  for (const item of input.fees ?? []) addOperation(item, "fee");
  const byTarget = new Map<string, PreparedVerticalSlice3ScheduledOperation[]>();
  for (const operation of operationsPrepared) for (const target of operationTarget(operation.operation)) byTarget.set(target, [...(byTarget.get(target) ?? []), operation]);
  for (const chain of byTarget.values()) {
    const sorted = chain.slice().sort((left, right) => (left.operation.order - right.operation.order) || left.descriptor.id.localeCompare(right.descriptor.id));
    for (let index = 1; index < sorted.length; index += 1) {
      const descriptor = sorted[index]!.descriptor;
      const replacement = householdDescriptor({ ...descriptor, dependsOn: [...descriptor.dependsOn, sorted[index - 1]!.descriptor.id] });
      operationDescriptors[operationDescriptors.indexOf(descriptor)] = replacement;
      const operation = operationsPrepared.find((candidate) => candidate.descriptor.id === descriptor.id)!;
      operationsPrepared[operationsPrepared.indexOf(operation)] = { ...operation, descriptor: replacement };
    }
  }
  const preparedValuations = input.returns.slice().sort((a, b) => a.targetPositionId.localeCompare(b.targetPositionId)).map((item) => {
    const descriptor = valuationByTarget.get(String(item.targetPositionId))!;
    const output = p26.primitiveOutputs.find((value) => value.primitiveInstanceId === item.primitiveIds.markToMarket)!.output as { readonly marketValue: Money };
    return { kind: "valuation" as const, descriptor, returnConfiguration: item, closingPrice: closingPrices[item.targetPositionId]!, marketValue: output.marketValue };
  });
  return Object.freeze({ period: Object.freeze({ ...period }), state: p26.closingState, primitiveState: p26.primitiveState, closingPrices, descriptors: Object.freeze([...valuationDescriptors, ...operationDescriptors].sort((a, b) => a.id.localeCompare(b.id))), operations: Object.freeze([...preparedValuations, ...operationsPrepared]), traceRefs: mergeTraceRefs(p23.primitiveOutputs.flatMap((output) => output.traceRefs ?? []), p26.primitiveOutputs.flatMap((output) => output.traceRefs ?? [])) ?? Object.freeze([]) });
};

/** Executes one prepared VS3 operation against the supplied shared candidate. */
export const executePreparedVerticalSlice3Operation = (
  prepared: PreparedVerticalSlice3Period,
  operation: PreparedVerticalSlice3Operation,
  state: AuthoritativeState,
  primitiveState: PrimitiveRuntimeStateStore,
  input: VerticalSlice3Input,
  runContext: RunContext,
): ExecutedVerticalSlice3Operation => {
  if (operation.kind === "valuation") {
    const next = cloneAuthoritativeState(state); const before = positionMarketValue(next.positions[operation.returnConfiguration.targetPositionId]!);
    const provenance = generated({ runContext, openingState: state, input, months: 1 }, operation.returnConfiguration.primitiveIds.markToMarket, closeAt(prepared.period), "mark-to-market", operation.returnConfiguration.targetPositionId);
    applyPositionValuationAtomically(next, { positionId: operation.returnConfiguration.targetPositionId, price: operation.closingPrice, generatedOccurrenceKey: provenance.generatedOccurrenceKey });
    const change = operation.marketValue.minus(before); const effect = createSemanticEffect({ id: semanticEffectId(`effect:valuation:${operation.returnConfiguration.targetPositionId}:${prepared.period.end}`), kind: "valuation", category: change.isNegative() ? "unrealized_investment_loss" : "unrealized_investment_gain", amount: change, occurredAt: closeAt(prepared.period), sourceOccurrenceKey: provenance.generatedOccurrenceKey, provenance, description: "Economic-only non-cash mark-to-market", traceRefs: traceRefs(operation.returnConfiguration, prepared.period) });
    return Object.freeze({ state: next, primitiveState, effects: Object.freeze([effect]), transactions: Object.freeze([]), contributionPrincipal: Money.zero(input.baseCurrency), fees: Money.zero(input.baseCurrency), ruleApplications: Object.freeze([]), unrealizedGain: change });
  }
  const filtered: VerticalSlice3Input = Object.freeze({ ...input, transfers: operation.kind === "transfer" ? [operation.operation] : [], purchases: operation.kind === "purchase" ? [operation.operation] : [], fees: operation.kind === "fee" ? [operation.operation] : [], returns: [] });
  const request: VerticalSlice3RunInput = { runContext: Object.freeze({ ...runContext, simulationStart: prepared.period.start, simulationEnd: prepared.period.end }), openingState: state, input: filtered, months: 1, primitiveState };
  const generatedWork = operations(request, prepared.period, state, prepared.closingPrices, operation.descriptor.id.replace("investment-", ""));
  const result = runPeriod({ period: prepared.period, runContext: request.runContext, openingState: state, primitiveState, work: generatedWork.work });
  return Object.freeze({ state: result.closingState, primitiveState: result.primitiveState, effects: result.effects, transactions: result.transactions, contributionPrincipal: generatedWork.contributionPrincipal, fees: generatedWork.fees, ruleApplications: generatedWork.ruleApplications, unrealizedGain: Money.zero(input.baseCurrency) });
};

export const runVerticalSlice3 = (request: VerticalSlice3RunInput): VerticalSlice3RunResult => {
  const months = request.months ?? utcMonthDifference(request.runContext.simulationStart, request.runContext.simulationEnd); const periods = utcMonthlyPeriods(request.runContext.simulationStart, months); validate(request, periods);
  const requestedHorizon = Object.freeze({ start: periods[0]!.start, end: periods[periods.length - 1]!.end }); const runMetadata = createRunMetadata(request.runContext, createInputFingerprint({ runContext: request.runContext, openingState: request.openingState, model: canonicalInputForFingerprint(request.input), executionPlan: { months } }));
  let state = cloneAuthoritativeState(request.openingState); let primitiveState = createPrimitiveRuntimeStateStore(request.primitiveState); const committed: VerticalSlice3PeriodResult[] = []; const diagnostics: ValidationIssue[] = [];
  for (const period of periods) try {
    let candidateState = state; let candidatePrimitiveState = primitiveState; let cashFlowPeriod: VerticalSlice2PeriodResult | undefined;
    if (request.input.cashFlowInput !== undefined) {
      const execute = request.cashFlowPeriodExecutor ?? ((args: Parameters<VerticalSlice3CashFlowPeriodExecutor>[0]) => executeVerticalSlice2PeriodCandidate({ runContext: args.runContext, openingState: args.openingState, primitiveState: args.primitiveState, input: args.input } as VerticalSlice2RunInput, args.period, args.openingState, args.primitiveState));
      const result = execute({ runContext: request.runContext, input: request.input.cashFlowInput, period, openingState: candidateState, primitiveState: candidatePrimitiveState });
      candidateState = result.state; candidatePrimitiveState = result.primitiveState; cashFlowPeriod = result.period;
    }
    const prepared = prepareVerticalSlice3Period(request.runContext, request.input, period, candidateState, candidatePrimitiveState);
    let finalState = prepared.state; let finalPrimitiveState = prepared.primitiveState;
    const executed = new Set<string>(); const effects: SemanticEffect[] = []; const transactions: AccountingTransaction[] = []; const ruleApplications: RuleApplication<Money>[] = [];
    let contributionPrincipal = Money.zero(request.input.baseCurrency); let fees = Money.zero(request.input.baseCurrency); let unrealizedGain = Money.zero(request.input.baseCurrency);
    while (executed.size < prepared.operations.length) {
      const next = prepared.operations.filter((operation) => !executed.has(operation.descriptor.id) && operation.descriptor.dependsOn.every((dependency) => executed.has(dependency))).sort((left, right) => left.descriptor.id.localeCompare(right.descriptor.id))[0];
      if (next === undefined) throw new ValidationError([{ severity: "error", code: issueCodes.verticalSlice3InputInvalid, message: "Prepared VS3 operation dependencies contain a cycle", entityType: "vertical_slice_3", fieldPath: "input" }]);
      const result = executePreparedVerticalSlice3Operation(prepared, next, finalState, finalPrimitiveState, request.input, request.runContext);
      finalState = result.state; finalPrimitiveState = result.primitiveState; effects.push(...result.effects); transactions.push(...result.transactions); ruleApplications.push(...result.ruleApplications); contributionPrincipal = contributionPrincipal.plus(result.contributionPrincipal); fees = fees.plus(result.fees); unrealizedGain = unrealizedGain.plus(result.unrealizedGain); executed.add(next.descriptor.id);
    }
    const allTransactions = Object.freeze([...(cashFlowPeriod?.transactions ?? []), ...transactions]); const allEffects = Object.freeze([...(cashFlowPeriod?.effects ?? []), ...effects]); const accountValues = Object.freeze(Object.fromEntries(Object.keys(finalState.accounts).sort().map((id) => [id, accountValueFromState(finalState, id)])));
    const combinedTraceRefs = mergeTraceRefs(cashFlowPeriod?.traceRefs, prepared.traceRefs, ruleApplications.flatMap((application) => application.traceRefs), allEffects.flatMap((effect) => effect.traceRefs ?? []))!;
    committed.push(Object.freeze({ period, transactions: allTransactions, effects: allEffects, statements: deriveStatements(finalState, allTransactions, request.input.baseCurrency), accountValues, portfolioValue: totalPositionMarketValue(Object.values(finalState.positions), request.input.baseCurrency), contributionPrincipal, fees, unrealizedGain, realizedGain: Money.zero(request.input.baseCurrency), cashInvestmentIncome: Money.zero(request.input.baseCurrency), ruleApplications: Object.freeze(ruleApplications), traceRefs: combinedTraceRefs, ...(cashFlowPeriod === undefined ? {} : { cashFlowPeriod }) }));
    diagnostics.push(...(cashFlowPeriod?.diagnostics ?? []));
    state = finalState; primitiveState = finalPrimitiveState;
  } catch (error) { if (!(error instanceof ValidationError)) throw error; diagnostics.push(...error.issues); return Object.freeze({ status: "incomplete", runMetadata, requestedHorizon, stoppedAt: period.start, ...(committed.length === 0 ? {} : { reachedThrough: committed[committed.length - 1]!.period.end }), state, primitiveState, periods: Object.freeze(committed), diagnostics: Object.freeze(diagnostics) }); }
  return Object.freeze({ status: "completed", runMetadata, requestedHorizon, reachedThrough: requestedHorizon.end, state, primitiveState, periods: Object.freeze(committed), diagnostics: Object.freeze(diagnostics) });
};

/** Executes investment-only VS3 mechanics for one household candidate period. */
export const executeVerticalSlice3PeriodCandidate = (
  request: VerticalSlice3RunInput,
  period: Period,
  openingState: AuthoritativeState,
  primitiveState: PrimitiveRuntimeStateStore,
): { readonly state: AuthoritativeState; readonly primitiveState: PrimitiveRuntimeStateStore; readonly period: VerticalSlice3PeriodResult } => {
  const { cashFlowInput: _embeddedCashFlow, ...investmentOnly } = request.input;
  const result = runVerticalSlice3({
    ...request,
    runContext: Object.freeze({ ...request.runContext, simulationStart: period.start, simulationEnd: period.end }),
    input: Object.freeze(investmentOnly),
    openingState,
    primitiveState,
    months: 1,
  });
  if (result.status === "incomplete") throw new ValidationError(result.diagnostics);
  return Object.freeze({ state: result.state, primitiveState: result.primitiveState, period: result.periods[0]! });
};
export const createVerticalSlice3Id = <Kind extends string>(kind: Kind, value: string): DomainId<Kind> => domainId(kind, value);
