import { failValidation, issueCodes, type ValidationIssue } from "../diagnostics/index.js";
import { domainId, type DomainId } from "../identity/index.js";
import { calculationTraceId, calculationTraceRef, mergeTraceRefs, type CalculationTraceRef } from "../lineage/index.js";
import type { AssumptionId, ScenarioDefinition, ScenarioEventId, ScenarioId } from "../model/scenario.js";
import { effectiveCompoundingPeriodReturn } from "../primitives/index.js";
import { resolveEffectiveRule, validateRuleBinding, type FinancialRuleId } from "../rules/index.js";
import type { AuthoritativeState } from "../state/index.js";
import { instant, subtractMilliseconds, utcMonthDifference, utcMonthlyOccurrences, utcMonthlyPeriods, type Instant, type Period } from "../time/index.js";
import { createFundingPolicy, type FundingPolicy } from "../funding/index.js";
import type { Money, Rate } from "../values/index.js";
import { canonicalSerialize, createRunContext, type RunContext, type RunId, type RunMetadata } from "./run.js";
import { runVerticalSlice2, type EventId, type ExpenseId, type IncomeId, type RecurringExpenseStream, type RecurringIncomeStream, type ScheduledCashFlowEvent, type VerticalSlice2Input, type VerticalSlice2PeriodResult, type VerticalSlice2RunResult } from "./verticalSlice2.js";
import { runVerticalSlice3, type DeterministicPositionReturn, type InvestmentFeeId, type InvestmentPurchase, type PurchaseId, type VerticalSlice3Input, type VerticalSlice3PeriodResult, type VerticalSlice3RunResult } from "./verticalSlice3.js";
import { runVerticalSlice4, type ExtraPrincipalPayment, type ExtraPrincipalPaymentId, type LoanContractId, type VerticalSlice4Input, type VerticalSlice4PeriodResult, type VerticalSlice4RunResult } from "./verticalSlice4.js";

type PositionId = DomainId<"position">;
export type ScenarioOperation = "add" | "replace" | "remove";

export type ScenarioChange =
  | { readonly kind: "income_growth"; readonly incomeId: IncomeId; readonly rate: Rate; readonly assumptionId: AssumptionId }
  | { readonly kind: "expense_inflation"; readonly expenseId: ExpenseId; readonly rate: Rate; readonly assumptionId: AssumptionId }
  | { readonly kind: "investment_return"; readonly positionId: PositionId; readonly rate: Rate; readonly assumptionId: AssumptionId }
  | { readonly kind: "retirement_date"; readonly targetEventId: EventId; readonly effectiveAt: Instant; readonly eventId: ScenarioEventId }
  | { readonly kind: "investment_purchase"; readonly operation: ScenarioOperation; readonly purchaseId: PurchaseId; readonly eventId: ScenarioEventId; readonly purchase?: InvestmentPurchase }
  | { readonly kind: "extra_principal_payment"; readonly operation: ScenarioOperation; readonly loanId: LoanContractId; readonly paymentId: ExtraPrincipalPaymentId; readonly eventId: ScenarioEventId; readonly payment?: ExtraPrincipalPayment }
  | { readonly kind: "expense_funding_policy"; readonly expenseId: ExpenseId; readonly fundingPolicy: FundingPolicy; readonly assumptionId: AssumptionId }
  | { readonly kind: "loan_funding_policy"; readonly loanId: LoanContractId; readonly fundingPolicy: FundingPolicy; readonly assumptionId: AssumptionId }
  | { readonly kind: "fee_rule_binding"; readonly feeId: InvestmentFeeId; readonly feeRuleIds: readonly FinancialRuleId[]; readonly assumptionId: AssumptionId };

export type ExecutableScenario = ScenarioDefinition<ScenarioChange>;

export interface ResolvedScenario {
  readonly scenario: ExecutableScenario;
  readonly rootScenarioId: ScenarioId;
  readonly layers: readonly ExecutableScenario[];
  readonly effectiveChanges: Readonly<Record<string, { readonly layerScenarioId: ScenarioId; readonly change: ScenarioChange }>>;
}

type EffectiveScenarioChange = { readonly layerScenarioId: ScenarioId; readonly change: ScenarioChange };

const scenarioFailure = (code: string, message: string, fieldPath?: string, relatedIds?: readonly string[]): never => failValidation({
  severity: "error",
  code,
  message,
  entityType: "scenario",
  ...(fieldPath === undefined ? {} : { fieldPath }),
  ...(relatedIds === undefined ? {} : { relatedIds }),
});

export const scenarioSemanticTarget = (change: ScenarioChange): string => {
  switch (change.kind) {
    case "income_growth": return `income:${change.incomeId}:growth-rate`;
    case "expense_inflation": return `expense:${change.expenseId}:inflation-rate`;
    case "investment_return": return `position:${change.positionId}:deterministic-return`;
    case "retirement_date": return `event:${change.targetEventId}:effective-at`;
    case "investment_purchase": return `investment-purchase:${change.purchaseId}`;
    case "extra_principal_payment": return `loan:${change.loanId}:extra-principal:${change.paymentId}`;
    case "expense_funding_policy": return `expense:${change.expenseId}:funding-policy`;
    case "loan_funding_policy": return `loan:${change.loanId}:funding-policy`;
    case "fee_rule_binding": return `investment-fee:${change.feeId}:rule-binding`;
  }
};

const validateDefinition = (scenario: ExecutableScenario): void => {
  try { domainId("scenario", scenario.scenarioId); if (scenario.baseScenarioId !== undefined) domainId("scenario", scenario.baseScenarioId); } catch { scenarioFailure(issueCodes.scenarioDefinitionInvalid, "Scenario identities must be canonical UUID-backed identities", "scenarioId"); }
  if (typeof scenario.name !== "string" || scenario.name.trim().length === 0 || (scenario.description !== undefined && typeof scenario.description !== "string") || scenario.horizon === undefined || typeof scenario.horizon.start !== "string" || typeof scenario.horizon.end !== "string" || scenario.horizon.start >= scenario.horizon.end || !Array.isArray(scenario.changes) || typeof scenario.enabled !== "boolean" || typeof scenario.stochastic !== "boolean") scenarioFailure(issueCodes.scenarioDefinitionInvalid, `Scenario ${scenario.scenarioId} has an invalid definition`);
  try { instant(scenario.horizon.start); instant(scenario.horizon.end); } catch { scenarioFailure(issueCodes.scenarioDefinitionInvalid, `Scenario ${scenario.scenarioId} has an invalid horizon`, "horizon"); }
  if (scenario.timestep !== "monthly") scenarioFailure(issueCodes.scenarioDefinitionInvalid, `Scenario ${scenario.scenarioId} uses an unsupported timestep`, "timestep");
  if (!Number.isSafeInteger(scenario.simulationCount) || scenario.simulationCount <= 0) scenarioFailure(issueCodes.scenarioDefinitionInvalid, `Scenario ${scenario.scenarioId} has an invalid simulation count`, "simulationCount");
  if (scenario.baseScenarioId === scenario.scenarioId) scenarioFailure(issueCodes.scenarioDefinitionInvalid, `Scenario ${scenario.scenarioId} cannot inherit from itself`, "baseScenarioId");
  const targets = scenario.changes.map(scenarioSemanticTarget);
  const duplicate = targets.find((target, index) => targets.indexOf(target) !== index);
  if (duplicate !== undefined) scenarioFailure(issueCodes.scenarioOverlayConflict, `Scenario ${scenario.scenarioId} changes ${duplicate} more than once in one layer`, "changes", [duplicate]);
};

const immutableChange = (change: ScenarioChange): ScenarioChange => {
  if (change.kind === "fee_rule_binding") return Object.freeze({ ...change, feeRuleIds: Object.freeze([...change.feeRuleIds]) });
  if (change.kind === "investment_purchase" && change.purchase !== undefined) return Object.freeze({ ...change, purchase: Object.freeze({ ...change.purchase, eligibilitySchedule: change.purchase.eligibilitySchedule.kind === "explicit_instants" ? Object.freeze({ ...change.purchase.eligibilitySchedule, instants: Object.freeze([...change.purchase.eligibilitySchedule.instants]) }) : Object.freeze({ ...change.purchase.eligibilitySchedule }) }) });
  if (change.kind === "extra_principal_payment" && change.payment !== undefined) return Object.freeze({ ...change, payment: Object.freeze({ ...change.payment }) });
  return Object.freeze({ ...change });
};
const immutableScenario = (scenario: ExecutableScenario): ExecutableScenario => Object.freeze({ ...scenario, horizon: Object.freeze({ ...scenario.horizon }), changes: Object.freeze(scenario.changes.map(immutableChange)) });

const isListChange = (change: ScenarioChange): change is Extract<ScenarioChange, { readonly kind: "investment_purchase" | "extra_principal_payment" }> => change.kind === "investment_purchase" || change.kind === "extra_principal_payment";
const withOperation = <T extends Extract<ScenarioChange, { readonly kind: "investment_purchase" | "extra_principal_payment" }>>(change: T, operation: ScenarioOperation): T => Object.freeze({ ...change, operation }) as T;
const resolveListHistory = (target: string, history: readonly EffectiveScenarioChange[]): EffectiveScenarioChange | undefined => {
  const first = history[0]!;
  const initial = first.change;
  if (!isListChange(initial)) return history[history.length - 1];
  let exists = initial.operation !== "remove";
  let last = first;
  for (let index = 1; index < history.length; index += 1) {
    const entry = history[index]!;
    const change = entry.change;
    if (!isListChange(change)) return entry;
    if (change.operation === "add") {
      if (exists) scenarioFailure(issueCodes.scenarioOverlayConflict, `Scenario add requires an absent inherited target for ${target}`, "changes", [target]);
      exists = true;
    } else {
      if (!exists) targetMissing(target);
      exists = change.operation !== "remove";
    }
    last = entry;
  }
  if (initial.operation === "add") {
    if (!exists) return undefined;
    return Object.freeze({ layerScenarioId: last.layerScenarioId, change: withOperation(last.change as typeof initial, "add") });
  }
  if (!exists) return Object.freeze({ layerScenarioId: last.layerScenarioId, change: withOperation(last.change as typeof initial, "remove") });
  return Object.freeze({ layerScenarioId: last.layerScenarioId, change: withOperation(last.change as typeof initial, "replace") });
};

const resolveEffectiveChanges = (layers: readonly ExecutableScenario[]): Readonly<Record<string, EffectiveScenarioChange>> => {
  const histories = new Map<string, EffectiveScenarioChange[]>();
  for (const layer of layers) for (const change of [...layer.changes].sort((a, b) => scenarioSemanticTarget(a).localeCompare(scenarioSemanticTarget(b)))) {
    const target = scenarioSemanticTarget(change);
    const history = histories.get(target) ?? [];
    history.push(Object.freeze({ layerScenarioId: layer.scenarioId, change }));
    histories.set(target, history);
  }
  const effective: Record<string, EffectiveScenarioChange> = {};
  for (const target of [...histories.keys()].sort()) {
    const history = histories.get(target)!;
    const resolved = isListChange(history[0]!.change) ? resolveListHistory(target, history) : history[history.length - 1]!;
    if (resolved !== undefined) effective[target] = resolved;
  }
  return Object.freeze(effective);
};
const effectiveEntries = (resolved: ResolvedScenario): readonly EffectiveScenarioChange[] => Object.freeze(Object.keys(resolved.effectiveChanges).sort().map((target) => resolved.effectiveChanges[target]!));

export const resolveScenario = (catalog: readonly ExecutableScenario[], selectedScenarioId: ScenarioId, requestedRealizations = 1): ResolvedScenario => {
  if (!Number.isSafeInteger(requestedRealizations) || requestedRealizations <= 0) scenarioFailure(issueCodes.scenarioDefinitionInvalid, "Requested realization count must be a positive safe integer", "realizationCount");
  const byId = new Map<ScenarioId, ExecutableScenario>();
  for (const scenario of catalog) {
    validateDefinition(scenario);
    if (byId.has(scenario.scenarioId)) scenarioFailure(issueCodes.scenarioDefinitionInvalid, `Duplicate scenario identity ${scenario.scenarioId}`, "scenarioId", [scenario.scenarioId]);
    byId.set(scenario.scenarioId, immutableScenario(scenario));
  }
  for (const scenario of byId.values()) if (scenario.baseScenarioId !== undefined && !byId.has(scenario.baseScenarioId)) scenarioFailure(issueCodes.scenarioReferenceNotFound, `Base scenario ${scenario.baseScenarioId} was not found`, "baseScenarioId", [scenario.scenarioId, scenario.baseScenarioId]);
  const visit = (scenario: ExecutableScenario, visiting: Set<ScenarioId>, visited: Set<ScenarioId>): void => {
    if (visiting.has(scenario.scenarioId)) scenarioFailure(issueCodes.scenarioInheritanceCycle, `Scenario inheritance cycle includes ${scenario.scenarioId}`, "baseScenarioId", [...visiting, scenario.scenarioId].sort());
    if (visited.has(scenario.scenarioId)) return;
    visiting.add(scenario.scenarioId);
    if (scenario.baseScenarioId !== undefined) visit(byId.get(scenario.baseScenarioId)!, visiting, visited);
    visiting.delete(scenario.scenarioId); visited.add(scenario.scenarioId);
  };
  const visited = new Set<ScenarioId>();
  for (const scenario of [...byId.values()].sort((a, b) => a.scenarioId.localeCompare(b.scenarioId))) visit(scenario, new Set(), visited);
  const selected = byId.get(selectedScenarioId) ?? scenarioFailure(issueCodes.scenarioReferenceNotFound, `Scenario ${selectedScenarioId} was not found`, "scenarioId", [selectedScenarioId]);
  const layers: ExecutableScenario[] = []; let cursor: ExecutableScenario | undefined = selected;
  while (cursor !== undefined) { layers.unshift(cursor); cursor = cursor.baseScenarioId === undefined ? undefined : byId.get(cursor.baseScenarioId); }
  const disabled = layers.find((layer) => !layer.enabled);
  if (disabled !== undefined) scenarioFailure(issueCodes.scenarioDefinitionInvalid, `Disabled scenario ${disabled.scenarioId} cannot be selected for execution`, "enabled", [disabled.scenarioId]);
  const nondeterministic = layers.find((layer) => layer.stochastic || layer.simulationCount > 1);
  if (nondeterministic !== undefined || requestedRealizations > 1) scenarioFailure(issueCodes.scenarioStochasticUnsupported, `Scenario ${nondeterministic?.scenarioId ?? selectedScenarioId} requests unsupported stochastic or multi-realization execution`, "stochastic", [nondeterministic?.scenarioId ?? selectedScenarioId]);
  const effective = resolveEffectiveChanges(layers);
  return Object.freeze({ scenario: selected, rootScenarioId: layers[0]!.scenarioId, layers: Object.freeze(layers), effectiveChanges: Object.freeze(effective) });
};

const sourceRef = (layerScenarioId: ScenarioId, change: ScenarioChange): readonly CalculationTraceRef[] => {
  const assumptionIds = "assumptionId" in change ? [change.assumptionId] : undefined;
  const eventIds = "eventId" in change ? [change.eventId] : undefined;
  return [calculationTraceRef(calculationTraceId(`scenario:${layerScenarioId}:${scenarioSemanticTarget(change)}`), undefined, assumptionIds, eventIds)];
};
const withSource = <T extends { readonly sourceTraceRefs?: readonly CalculationTraceRef[] }>(value: T, refs: readonly CalculationTraceRef[]): T => Object.freeze({ ...value, sourceTraceRefs: mergeTraceRefs(value.sourceTraceRefs, refs)! });
const targetMissing = (target: string): never => scenarioFailure(issueCodes.scenarioOverlayTargetNotFound, `Scenario target ${target} was not found`, "changes", [target]);
const unsupported = (kind: ScenarioChange["kind"], adapter: string): never => scenarioFailure(issueCodes.scenarioChangeUnsupported, `Scenario change ${kind} is unsupported by ${adapter}`, "changes", [kind, adapter]);
const futureAt = (runContext: ScenarioRunContextTemplate): Instant => runContext.asOf > runContext.simulationStart ? runContext.asOf : runContext.simulationStart;
const assertFuture = (at: Instant, runContext: ScenarioRunContextTemplate, target: string): void => { if (at < futureAt(runContext)) scenarioFailure(issueCodes.scenarioDefinitionInvalid, `Scenario modification ${target} is before the forecast boundary`, "effectiveAt", [target]); };
const sameConvention = (left: Rate, right: Rate): boolean => canonicalSerialize(left.convention) === canonicalSerialize(right.convention);
const validateOverlay = <T>(target: string, fieldPath: string, validate: () => T): T => {
  try { return validate(); } catch { return scenarioFailure(issueCodes.scenarioDefinitionInvalid, `Scenario overlay ${target} is incompatible with the existing executable contract`, fieldPath, [target]); }
};
const onlyEffectiveChange = (resolved: ResolvedScenario, entry: EffectiveScenarioChange): ResolvedScenario => Object.freeze({ ...resolved, effectiveChanges: Object.freeze({ [scenarioSemanticTarget(entry.change)]: entry }) });

export interface ScenarioRunContextTemplate extends Omit<RunContext, "runId" | "scenarioId"> {}

export const applyVerticalSlice2Scenario = (base: VerticalSlice2Input, resolved: ResolvedScenario, runContext: ScenarioRunContextTemplate): VerticalSlice2Input => {
  let input: VerticalSlice2Input = Object.freeze({ ...base, incomes: Object.freeze([...base.incomes]), expenses: Object.freeze([...base.expenses]), events: Object.freeze([...base.events]) });
  for (const { layerScenarioId, change } of effectiveEntries(resolved)) {
    const refs = sourceRef(layerScenarioId, change);
    if (change.kind === "income_growth") {
      const current = input.incomes.find((item) => item.id === change.incomeId) ?? targetMissing(scenarioSemanticTarget(change));
      if (!sameConvention(current.growthRate, change.rate)) scenarioFailure(issueCodes.scenarioDefinitionInvalid, `Income growth rate basis is incompatible for ${change.incomeId}`, "rate", [change.incomeId]);
      input = Object.freeze({ ...input, incomes: Object.freeze(input.incomes.map((item) => item.id === change.incomeId ? withSource({ ...item, growthRate: change.rate }, refs) : item)) });
    } else if (change.kind === "expense_inflation") {
      const current = input.expenses.find((item) => item.id === change.expenseId) ?? targetMissing(scenarioSemanticTarget(change));
      if (!sameConvention(current.inflationRate, change.rate)) scenarioFailure(issueCodes.scenarioDefinitionInvalid, `Expense inflation rate basis is incompatible for ${change.expenseId}`, "rate", [change.expenseId]);
      input = Object.freeze({ ...input, expenses: Object.freeze(input.expenses.map((item) => item.id === change.expenseId ? withSource({ ...item, inflationRate: change.rate }, refs) : item)) });
    } else if (change.kind === "retirement_date") {
      assertFuture(change.effectiveAt, runContext, scenarioSemanticTarget(change));
      if (change.effectiveAt >= runContext.simulationEnd) scenarioFailure(issueCodes.scenarioDefinitionInvalid, `Retirement event ${change.targetEventId} must fall within the current VS2 horizon`, "effectiveAt", [change.targetEventId]);
      const event = input.events.find((item) => item.id === change.targetEventId) ?? targetMissing(scenarioSemanticTarget(change));
      if (event.kind !== "termination" || !input.incomes.some((income) => income.id === event.targetId && income.terminationEventId === event.id)) targetMissing(scenarioSemanticTarget(change));
      input = Object.freeze({ ...input, events: Object.freeze(input.events.map((item) => item.id === change.targetEventId ? withSource({ ...item, effectiveAt: change.effectiveAt }, refs) : item)) });
    } else if (change.kind === "expense_funding_policy") {
      input.expenses.find((item) => item.id === change.expenseId) ?? targetMissing(scenarioSemanticTarget(change));
      const policy = validateOverlay(scenarioSemanticTarget(change), "changes.expense_funding_policy.fundingPolicy", () => createFundingPolicy(change.fundingPolicy));
      input = Object.freeze({ ...input, expenses: Object.freeze(input.expenses.map((item) => item.id === change.expenseId ? withSource({ ...item, fundingPolicy: policy }, refs) : item)) });
    } else unsupported(change.kind, "vertical_slice_2");
  }
  return input;
};

const applyListOperation = <T extends { readonly id: string }>(items: readonly T[], operation: ScenarioOperation, id: string, payload: T | undefined, target: string): readonly T[] => {
  const index = items.findIndex((item) => item.id === id);
  if (operation === "add") {
    if (index >= 0 || payload === undefined || payload.id !== id) scenarioFailure(issueCodes.scenarioOverlayConflict, `Scenario add requires absent target and matching payload for ${target}`, "changes", [target]);
    const added = payload as T;
    return Object.freeze([...items, added]);
  }
  if (index < 0) targetMissing(target);
  if (operation === "remove") return Object.freeze(items.filter((_, itemIndex) => itemIndex !== index));
  if (payload === undefined || payload.id !== id) scenarioFailure(issueCodes.scenarioDefinitionInvalid, `Scenario replace requires a matching payload for ${target}`, "changes", [target]);
  const replacement = payload as T;
  return Object.freeze(items.map((item, itemIndex) => itemIndex === index ? replacement : item));
};

export const applyVerticalSlice3Scenario = (base: VerticalSlice3Input, resolved: ResolvedScenario, runContext: ScenarioRunContextTemplate): VerticalSlice3Input => {
  let input: VerticalSlice3Input = Object.freeze({ ...base, transfers: Object.freeze([...base.transfers]), purchases: Object.freeze([...base.purchases]), fees: Object.freeze([...(base.fees ?? [])]), returns: Object.freeze([...base.returns]), ...(base.cashFlowInput === undefined ? {} : { cashFlowInput: Object.freeze({ ...base.cashFlowInput, incomes: Object.freeze([...base.cashFlowInput.incomes]), expenses: Object.freeze([...base.cashFlowInput.expenses]), events: Object.freeze([...base.cashFlowInput.events]) }) }) });
  for (const entry of effectiveEntries(resolved)) {
    const { layerScenarioId, change } = entry;
    const refs = sourceRef(layerScenarioId, change);
    if (["income_growth", "expense_inflation", "retirement_date", "expense_funding_policy"].includes(change.kind)) {
      if (input.cashFlowInput === undefined) targetMissing(scenarioSemanticTarget(change));
      const cashFlowInput = input.cashFlowInput as VerticalSlice2Input;
      input = Object.freeze({ ...input, cashFlowInput: applyVerticalSlice2Scenario(cashFlowInput, onlyEffectiveChange(resolved, entry), runContext) });
    } else if (change.kind === "investment_return") {
      const current = input.returns.find((item) => item.targetPositionId === change.positionId) ?? targetMissing(scenarioSemanticTarget(change));
      validateOverlay(scenarioSemanticTarget(change), "changes.investment_return.rate", () => effectiveCompoundingPeriodReturn(change.rate, current.returnBasis));
      input = Object.freeze({ ...input, returns: Object.freeze(input.returns.map((item) => item.targetPositionId === change.positionId ? withSource({ ...item, rate: change.rate }, refs) : item)) });
    } else if (change.kind === "investment_purchase") {
      const payload = change.purchase === undefined ? undefined : withSource({ ...change.purchase, eligibilitySchedule: change.purchase.eligibilitySchedule.kind === "explicit_instants" ? Object.freeze({ ...change.purchase.eligibilitySchedule, instants: Object.freeze([...change.purchase.eligibilitySchedule.instants]) }) : Object.freeze({ ...change.purchase.eligibilitySchedule }) }, refs);
      for (const at of payload?.eligibilitySchedule.kind === "explicit_instants" ? payload.eligibilitySchedule.instants : []) assertFuture(at, runContext, scenarioSemanticTarget(change));
      input = Object.freeze({ ...input, purchases: applyListOperation(input.purchases, change.operation, change.purchaseId, payload, scenarioSemanticTarget(change)) });
    } else if (change.kind === "fee_rule_binding") {
      const fee = (input.fees ?? []).find((item) => item.id === change.feeId) ?? targetMissing(scenarioSemanticTarget(change));
      validateOverlay(scenarioSemanticTarget(change), "changes.fee_rule_binding.feeRuleIds", () => {
        validateRuleBinding(input.ruleCatalog, change.feeRuleIds, "fixed_fee", { targetType: "account", targetId: fee.cashAccountId });
        for (const period of utcMonthlyPeriods(runContext.simulationStart, utcMonthDifference(runContext.simulationStart, runContext.simulationEnd))) {
          const selected = fee.eligibilitySchedule.kind === "explicit_instants" ? fee.eligibilitySchedule.instants.some((at) => at >= period.start && at < period.end) : utcMonthlyOccurrences(fee.eligibilitySchedule.anchor, period, fee.eligibilitySchedule.invalidDayPolicy).length > 0;
          if (selected) resolveEffectiveRule(input.ruleCatalog, change.feeRuleIds, "fixed_fee", { targetType: "account", targetId: fee.cashAccountId }, subtractMilliseconds(period.end, 1));
        }
      });
      input = Object.freeze({ ...input, fees: Object.freeze((input.fees ?? []).map((item) => item.id === change.feeId ? withSource({ ...item, feeRuleIds: Object.freeze([...change.feeRuleIds]) }, refs) : item)) });
    } else unsupported(change.kind, "vertical_slice_3");
  }
  return input;
};

export const applyVerticalSlice4Scenario = (base: VerticalSlice4Input, resolved: ResolvedScenario, runContext: ScenarioRunContextTemplate): VerticalSlice4Input => {
  let input: VerticalSlice4Input = Object.freeze({ ...base, loans: Object.freeze(base.loans.map((loan) => Object.freeze({ ...loan, extraPrincipalPayments: Object.freeze([...(loan.extraPrincipalPayments ?? [])]) }))) });
  for (const { layerScenarioId, change } of effectiveEntries(resolved)) {
    const refs = sourceRef(layerScenarioId, change);
    if (change.kind === "loan_funding_policy") {
      input.loans.find((loan) => loan.id === change.loanId) ?? targetMissing(scenarioSemanticTarget(change));
      const policy = validateOverlay(scenarioSemanticTarget(change), "changes.loan_funding_policy.fundingPolicy", () => createFundingPolicy(change.fundingPolicy));
      input = Object.freeze({ ...input, loans: Object.freeze(input.loans.map((loan) => loan.id === change.loanId ? withSource({ ...loan, fundingPolicy: policy }, refs) : loan)) });
    } else if (change.kind === "extra_principal_payment") {
      const loan = input.loans.find((item) => item.id === change.loanId) ?? targetMissing(scenarioSemanticTarget(change));
      if (change.payment !== undefined) assertFuture(change.payment.scheduledAt, runContext, scenarioSemanticTarget(change));
      const payload = change.payment === undefined ? undefined : withSource({ ...change.payment, fundingPolicy: validateOverlay(scenarioSemanticTarget(change), "changes.extra_principal_payment.payment.fundingPolicy", () => createFundingPolicy(change.payment!.fundingPolicy)) }, refs);
      const payments = applyListOperation(loan.extraPrincipalPayments ?? [], change.operation, change.paymentId, payload, scenarioSemanticTarget(change));
      input = Object.freeze({ ...input, loans: Object.freeze(input.loans.map((item) => item.id === change.loanId ? Object.freeze({ ...item, extraPrincipalPayments: payments }) : item)) });
    } else unsupported(change.kind, "vertical_slice_4");
  }
  return input;
};

export interface ScenarioConfigurationDifference {
  readonly differenceId: string;
  readonly semanticTarget: string;
  readonly changeKind: ScenarioChange["kind"];
  readonly scenarioLayerId: ScenarioId;
  readonly before: unknown;
  readonly after: unknown;
  readonly assumptionIds: readonly AssumptionId[];
  readonly eventIds: readonly ScenarioEventId[];
  readonly configuredRuleIds: readonly FinancialRuleId[];
}
export interface ScenarioSeriesPoint {
  readonly period: Period;
  readonly metrics: Readonly<Record<string, Money>>;
  readonly traceRefs: readonly CalculationTraceRef[];
  readonly ruleIds: readonly FinancialRuleId[];
}
export interface ScenarioSeries {
  readonly scenarioId: ScenarioId;
  readonly status: "completed" | "incomplete";
  readonly metadata: RunMetadata;
  readonly points: readonly ScenarioSeriesPoint[];
  readonly diagnostics: readonly ValidationIssue[];
}
export interface ScenarioDeltaPoint extends ScenarioSeriesPoint { readonly relatedDifferenceIds: readonly string[]; }
export interface ScenarioAlternativeComparison {
  readonly scenario: ScenarioSeries;
  readonly differences: readonly ScenarioConfigurationDifference[];
  readonly appliedRuleDifferences: { readonly baselineOnly: readonly FinancialRuleId[]; readonly alternativeOnly: readonly FinancialRuleId[] };
  readonly deltas: readonly ScenarioDeltaPoint[];
  readonly comparedThrough?: Instant;
}
export interface ScenarioComparisonResult { readonly baseline: ScenarioSeries; readonly alternatives: readonly ScenarioAlternativeComparison[]; }

type AnyPeriodResult = VerticalSlice2PeriodResult | VerticalSlice3PeriodResult | VerticalSlice4PeriodResult;
type AnyRunResult = VerticalSlice2RunResult | VerticalSlice3RunResult | VerticalSlice4RunResult;
type Metrics<T extends AnyPeriodResult> = (period: T) => Readonly<Record<string, Money>>;

export interface ScenarioComparisonRequest<Input> {
  readonly scenarios: readonly ExecutableScenario[];
  readonly baselineScenarioId: ScenarioId;
  readonly alternativeScenarioIds: readonly ScenarioId[];
  readonly runIds: Readonly<Record<string, RunId>>;
  readonly runContext: ScenarioRunContextTemplate;
  readonly openingState: AuthoritativeState;
  readonly input: Input;
  readonly months?: number;
  readonly realizationCount?: number;
}

const idsFromRefs = (refs: readonly CalculationTraceRef[]): { rules: FinancialRuleId[]; assumptions: AssumptionId[]; events: ScenarioEventId[] } => ({
  rules: [...new Set(refs.flatMap((ref) => ref.ruleIds ?? []))].sort(), assumptions: [...new Set(refs.flatMap((ref) => ref.assumptionIds ?? []))].sort(), events: [...new Set(refs.flatMap((ref) => ref.eventIds ?? []))].sort(),
});
const configuredValue = (input: unknown, change: ScenarioChange): unknown => {
  const value = input as {
    readonly incomes?: readonly RecurringIncomeStream[]; readonly expenses?: readonly RecurringExpenseStream[]; readonly events?: readonly ScheduledCashFlowEvent[];
    readonly cashFlowInput?: VerticalSlice2Input; readonly returns?: readonly DeterministicPositionReturn[]; readonly purchases?: readonly InvestmentPurchase[]; readonly fees?: readonly { readonly id: InvestmentFeeId; readonly feeRuleIds: readonly FinancialRuleId[] }[];
    readonly loans?: readonly { readonly id: LoanContractId; readonly fundingPolicy: FundingPolicy; readonly extraPrincipalPayments?: readonly ExtraPrincipalPayment[] }[];
  };
  if (value.cashFlowInput !== undefined && ["income_growth", "expense_inflation", "retirement_date", "expense_funding_policy"].includes(change.kind)) return configuredValue(value.cashFlowInput, change);
  switch (change.kind) {
    case "income_growth": return value.incomes?.find((item) => item.id === change.incomeId)?.growthRate ?? null;
    case "expense_inflation": return value.expenses?.find((item) => item.id === change.expenseId)?.inflationRate ?? null;
    case "retirement_date": return value.events?.find((item) => item.id === change.targetEventId)?.effectiveAt ?? null;
    case "expense_funding_policy": return value.expenses?.find((item) => item.id === change.expenseId)?.fundingPolicy ?? null;
    case "investment_return": return value.returns?.find((item) => item.targetPositionId === change.positionId)?.rate ?? null;
    case "investment_purchase": return value.purchases?.find((item) => item.id === change.purchaseId) ?? null;
    case "fee_rule_binding": return value.fees?.find((item) => item.id === change.feeId)?.feeRuleIds ?? null;
    case "loan_funding_policy": return value.loans?.find((item) => item.id === change.loanId)?.fundingPolicy ?? null;
    case "extra_principal_payment": return value.loans?.find((item) => item.id === change.loanId)?.extraPrincipalPayments?.find((item) => item.id === change.paymentId) ?? null;
  }
};
const differences = (baseline: ResolvedScenario, alternative: ResolvedScenario, baselineInput: unknown, alternativeInput: unknown): readonly ScenarioConfigurationDifference[] => {
  const targets = [...new Set([...Object.keys(baseline.effectiveChanges), ...Object.keys(alternative.effectiveChanges)])].sort();
  return Object.freeze(targets.flatMap((target) => {
    const before = baseline.effectiveChanges[target]; const after = alternative.effectiveChanges[target];
    if (canonicalSerialize(before === undefined ? null : before.change) === canonicalSerialize(after === undefined ? null : after.change)) return [];
    const effective = after ?? before!; const change = effective.change;
    const beforeValue = configuredValue(baselineInput, change); const afterValue = configuredValue(alternativeInput, change);
    const configuredRuleIds = change.kind === "fee_rule_binding" ? [...new Set([...(beforeValue as readonly FinancialRuleId[] | null ?? []), ...(afterValue as readonly FinancialRuleId[] | null ?? [])])].sort() : [];
    return [Object.freeze({ differenceId: `scenario-difference:${alternative.scenario.scenarioId}:${target}`, semanticTarget: target, changeKind: change.kind, scenarioLayerId: effective.layerScenarioId, before: beforeValue, after: afterValue, assumptionIds: Object.freeze("assumptionId" in change ? [change.assumptionId] : []), eventIds: Object.freeze("eventId" in change ? [change.eventId] : []), configuredRuleIds: Object.freeze(configuredRuleIds) })];
  }));
};
const series = <T extends AnyPeriodResult>(scenarioId: ScenarioId, result: AnyRunResult, metric: Metrics<T>): ScenarioSeries => Object.freeze({ scenarioId, status: result.status, metadata: result.runMetadata, points: Object.freeze(result.periods.map((raw) => { const period = raw as T; const refs = mergeTraceRefs(period.traceRefs) ?? Object.freeze([]); return Object.freeze({ period: period.period, metrics: metric(period), traceRefs: refs, ruleIds: Object.freeze(idsFromRefs(refs).rules) }); })), diagnostics: result.diagnostics });
const actualRules = (value: ScenarioSeries): readonly FinancialRuleId[] => Object.freeze([...new Set(value.points.flatMap((point) => point.ruleIds))].sort());
const subtractSeries = (baseline: ScenarioSeries, alternative: ScenarioSeries, diffs: readonly ScenarioConfigurationDifference[]): { deltas: readonly ScenarioDeltaPoint[]; comparedThrough?: Instant } => {
  const count = Math.min(baseline.points.length, alternative.points.length); const deltas: ScenarioDeltaPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const left = baseline.points[index]!; const right = alternative.points[index]!;
    if (left.period.start !== right.period.start || left.period.end !== right.period.end) scenarioFailure(issueCodes.scenarioComparisonIncompatible, "Scenario period structures do not match", "horizon");
    const leftKeys = Object.keys(left.metrics).sort(); const rightKeys = Object.keys(right.metrics).sort();
    if (canonicalSerialize(leftKeys) !== canonicalSerialize(rightKeys)) scenarioFailure(issueCodes.scenarioComparisonIncompatible, "Scenario metric structures do not match", "metrics");
    const metrics = Object.freeze(Object.fromEntries(leftKeys.map((key) => [key, right.metrics[key]!.minus(left.metrics[key]!)]).filter(([, value]) => !(value as Money).isZero())));
    const refs = mergeTraceRefs(left.traceRefs, right.traceRefs) ?? Object.freeze([]); const ids = idsFromRefs(refs);
    const related = diffs.filter((difference) => difference.assumptionIds.some((id) => ids.assumptions.includes(id)) || difference.eventIds.some((id) => ids.events.includes(id)) || difference.configuredRuleIds.some((id) => ids.rules.includes(id))).map((difference) => difference.differenceId).sort();
    deltas.push(Object.freeze({ period: left.period, metrics, traceRefs: refs, ruleIds: Object.freeze(ids.rules), relatedDifferenceIds: Object.freeze(related) }));
  }
  return Object.freeze({ deltas: Object.freeze(deltas), ...(count === 0 ? {} : { comparedThrough: baseline.points[count - 1]!.period.end }) });
};

const compare = <Input, PeriodResult extends AnyPeriodResult>(request: ScenarioComparisonRequest<Input>, apply: (input: Input, resolved: ResolvedScenario, context: ScenarioRunContextTemplate) => Input, run: (args: { runContext: RunContext; openingState: AuthoritativeState; input: Input; months?: number }) => AnyRunResult, metric: Metrics<PeriodResult>): ScenarioComparisonResult => {
  const requested = request.realizationCount ?? 1;
  const baselineResolved = resolveScenario(request.scenarios, request.baselineScenarioId, requested);
  if (baselineResolved.scenario.baseScenarioId !== undefined) scenarioFailure(issueCodes.scenarioComparisonIncompatible, "Comparison baseline must be a root scenario", "baselineScenarioId", [request.baselineScenarioId]);
  const alternatives = request.alternativeScenarioIds.map((id) => resolveScenario(request.scenarios, id, requested));
  for (const resolved of [baselineResolved, ...alternatives]) if (resolved.rootScenarioId !== baselineResolved.rootScenarioId || resolved.scenario.horizon.start !== request.runContext.simulationStart || resolved.scenario.horizon.end !== request.runContext.simulationEnd || resolved.scenario.horizon.start !== baselineResolved.scenario.horizon.start || resolved.scenario.horizon.end !== baselineResolved.scenario.horizon.end) scenarioFailure(issueCodes.scenarioComparisonIncompatible, `Scenario ${resolved.scenario.scenarioId} is incompatible with the selected baseline`, "horizon", [resolved.scenario.scenarioId]);
  const ids = [baselineResolved.scenario.scenarioId, ...alternatives.map((item) => item.scenario.scenarioId)].map((id) => request.runIds[id] ?? scenarioFailure(issueCodes.scenarioDefinitionInvalid, `Run ID is required for scenario ${id}`, "runIds", [id]));
  if (new Set(ids).size !== ids.length) scenarioFailure(issueCodes.scenarioDefinitionInvalid, "Each compared scenario requires a distinct run ID", "runIds");
  const execute = (resolved: ResolvedScenario, input: Input): ScenarioSeries => {
    const runContext = createRunContext({ ...request.runContext, runId: request.runIds[resolved.scenario.scenarioId]!, scenarioId: resolved.scenario.scenarioId });
    return series(resolved.scenario.scenarioId, run({ runContext, openingState: request.openingState, input, ...(request.months === undefined ? {} : { months: request.months }) }), metric);
  };
  const baselineInput = apply(request.input, baselineResolved, request.runContext);
  const baseline = execute(baselineResolved, baselineInput);
  return Object.freeze({ baseline, alternatives: Object.freeze(alternatives.map((resolved) => { const alternativeInput = apply(request.input, resolved, request.runContext); const alternative = execute(resolved, alternativeInput); const diffs = differences(baselineResolved, resolved, baselineInput, alternativeInput); const delta = subtractSeries(baseline, alternative, diffs); const baselineRules = actualRules(baseline); const alternativeRules = actualRules(alternative); return Object.freeze({ scenario: alternative, differences: diffs, appliedRuleDifferences: Object.freeze({ baselineOnly: Object.freeze(baselineRules.filter((id) => !alternativeRules.includes(id))), alternativeOnly: Object.freeze(alternativeRules.filter((id) => !baselineRules.includes(id))) }), ...delta }); })) });
};

const vs2Metrics = (point: VerticalSlice2PeriodResult): Readonly<Record<string, Money>> => Object.freeze({ recognizedIncome: point.recurringIncomeRecognized, recognizedExpenses: point.recurringExpenseRecognized, expenseCashSettlement: point.expenseCashSettlement, endingCash: point.endingCash, outstandingExpenseObligations: point.outstandingExpenseObligations });
const statementMetrics = (point: VerticalSlice3PeriodResult | VerticalSlice4PeriodResult): Record<string, Money> => ({ assets: point.statements.assets, liabilities: point.statements.liabilities, netWorth: point.statements.netWorth, income: point.statements.income, expenses: point.statements.expenses, gains: point.statements.gains, operatingCashFlow: point.statements.operatingCashFlow, investingCashFlow: point.statements.investingCashFlow, financingCashFlow: point.statements.financingCashFlow });
const vs3Metrics = (point: VerticalSlice3PeriodResult): Readonly<Record<string, Money>> => Object.freeze({ ...statementMetrics(point), portfolioValue: point.portfolioValue, contributionPrincipal: point.contributionPrincipal, fees: point.fees, unrealizedGain: point.unrealizedGain });
const vs4Metrics = (point: VerticalSlice4PeriodResult): Readonly<Record<string, Money>> => Object.freeze({ ...statementMetrics(point), interestExpense: point.interestExpense, principalReduction: point.principalReduction, endingPrincipal: point.endingPrincipal, outstandingInterest: point.outstandingInterest });

export const compareVerticalSlice2Scenarios = (request: ScenarioComparisonRequest<VerticalSlice2Input>): ScenarioComparisonResult => compare(request, applyVerticalSlice2Scenario, runVerticalSlice2, vs2Metrics);
export const compareVerticalSlice3Scenarios = (request: ScenarioComparisonRequest<VerticalSlice3Input>): ScenarioComparisonResult => compare(request, applyVerticalSlice3Scenario, runVerticalSlice3, vs3Metrics);
export const compareVerticalSlice4Scenarios = (request: ScenarioComparisonRequest<VerticalSlice4Input>): ScenarioComparisonResult => compare(request, applyVerticalSlice4Scenario, runVerticalSlice4, vs4Metrics);
