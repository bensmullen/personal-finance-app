import type { RecurringIncomeStream, VerticalSlice2Input } from "../../../verticalSlice2.js";
import type { AccountState, AuthoritativeState } from "../../../../state/index.js";
import { assertRunContext, canonicalSerialize, runId, type RunContext } from "../../../run.js";
import { sha256 } from "../../../../rules/tax/t1b/contentIdentity.js";
import { evaluatePrimitive, primitiveEvaluationContext } from "../../../../primitives/index.js";
import { generatedOccurrenceKey } from "../../../../identity/index.js";
import { instant, utcCalendarMonthDifference, utcMonthlyOccurrences, type Instant, type Period } from "../../../../time/index.js";
import { Money, RateBasis, RoundingPolicy } from "../../../../values/index.js";
import { failValidation, issueCodes } from "../../../../diagnostics/index.js";

/** Portable address; neither source authentication nor a D2 original. */
export interface ModeledPayrollReference {
  readonly version: "modeled-payroll/v1";
  readonly issuer: string;
  readonly key: string;
}
export interface ModeledPayrollBinding {
  readonly stream: Omit<RecurringIncomeStream, "modeledPayroll">;
  readonly householdId: string;
  readonly bank: { readonly id: AccountState["id"]; readonly kind: AccountState["kind"]; readonly ownerId: AccountState["ownerId"] };
  readonly start: string;
  readonly end: string;
  readonly asOf: string;
  readonly scenarioId: string;
  readonly sourceFingerprint: string;
  readonly nonSalaryType?: string;
  readonly events?: VerticalSlice2Input["events"];
  readonly runId?: string;
  readonly dataCutoff?: string;
}
// The issuer owns a reference-identity-scoped weak inventory. A digest is a
// portable address, never proof that an independently supplied object was issued.
const issuers = new Map<string, (reference: ModeledPayrollReference) => ModeledPayrollBinding | undefined>();
export const modeledPayrollKey = (binding: unknown): string => `sha256:${sha256(canonicalSerialize(binding))}`;
export const withoutModeledPayroll = ({ modeledPayroll: _ref, ...stream }: RecurringIncomeStream) => stream;
const reject = (): never => failValidation({ severity: "error", code: issueCodes.verticalSlice2InputInvalid,
  entityType: "vertical_slice_2", message: "MODELED_PAYROLL_NOT_ADMITTED" });

/** Internal compiler composition seam, deliberately absent from public barrels.
 * Only the compiler closure can add bindings to its registered inventory. */
export function registerModeledPayrollCompiler(issuer: "canonical-cash-flow/v1" | "canonical-household/v1" | "canonical-forecast/v1",
  read: (reference: ModeledPayrollReference) => ModeledPayrollBinding | undefined): void {
  if (!["canonical-cash-flow/v1", "canonical-household/v1", "canonical-forecast/v1"].includes(issuer) || issuers.has(issuer)) return reject();
  issuers.set(issuer, read);
}

export function readModeledIncomeBinding(ref: ModeledPayrollReference | undefined): ModeledPayrollBinding | undefined {
  return ref?.version === "modeled-payroll/v1" ? issuers.get(ref.issuer)?.(ref) : undefined;
}

export function qualifyModeledPayroll(stream: RecurringIncomeStream, householdId: string,
  bank: AccountState | undefined, context: RunContext): ModeledPayrollBinding {
  assertRunContext(context);
  try {
    runId(context.runId);
    instant(context.dataCutoff);
  } catch {
    return reject();
  }
  const binding = readModeledIncomeBinding(stream.modeledPayroll);
  if (!binding || !bank || stream.householdWageSource !== undefined ||
    binding.householdId !== householdId ||
    binding.nonSalaryType === undefined && (stream.ownerId === householdId || context.baseCurrency.code !== "USD") ||
    binding.nonSalaryType !== undefined && Boolean(stream.payrollContributions?.length || stream.payrollWithholding?.length) ||
    !stream.baseMonthlyAmount.currency.equals(context.baseCurrency) || !bank.cash.currency.equals(context.baseCurrency) ||
    !["cash", "checking", "savings"].includes(bank.kind) ||
    canonicalSerialize(binding.bank) !== canonicalSerialize({ id: bank.id, kind: bank.kind, ownerId: bank.ownerId }) ||
    canonicalSerialize(binding.stream) !== canonicalSerialize(withoutModeledPayroll(stream)) ||
    binding.asOf !== context.asOf || binding.scenarioId !== context.scenarioId ||
    binding.runId !== undefined && binding.runId !== context.runId ||
    binding.dataCutoff !== undefined && binding.dataCutoff !== context.dataCutoff ||
    (binding.runId === undefined) !== (binding.dataCutoff === undefined) ||
    context.simulationStart !== binding.start || context.simulationEnd !== binding.end)
    return reject();
  return binding;
}

export interface ModeledPayrollOccurrence {
  readonly householdId: string;
  readonly stream: RecurringIncomeStream;
  readonly context: RunContext;
  readonly at: Instant;
  readonly period: Period;
  readonly occurrenceId: string;
  readonly gross: import("../../../../values/index.js").Money;
}

/** Validate the original before a salary activation can stage P27 runtime. */
export function assertModeledSalaryActivation(input: VerticalSlice2Input,
  state: AuthoritativeState, context: RunContext): void {
  for (const event of input.events) {
    if (event.kind !== "activation") continue;
    const stream = input.incomes.find(income => income.id === event.targetId);
    if (stream === undefined) continue;
    const source = qualifyModeledPayroll(stream, input.householdId, state.accounts[stream.depositAccountId], context);
    if (source.nonSalaryType !== undefined || stream.activationEventId !== event.id ||
        canonicalSerialize(source.events ?? []) !== canonicalSerialize(input.events.filter(item => item.targetId === stream.id)))
      reject();
  }
}

// Tokens are local to one evaluated occurrence. References survive snapshots;
// VS2 must qualify them again before evaluating and admitting another paycheck.
const occurrences = new WeakSet<object>();
export function modeledPayrollOccurrence(binding: ModeledPayrollOccurrence, bank: AccountState | undefined,
  events: VerticalSlice2Input["events"]): ModeledPayrollOccurrence | undefined {
  const source = qualifyModeledPayroll(binding.stream, binding.householdId, bank, binding.context);
  const { stream, context, at, period } = binding;
  const incomeEvents = events.filter(event => event.targetId === stream.id);
  if (canonicalSerialize(source.events ?? []) !== canonicalSerialize(incomeEvents) ||
      incomeEvents.some(event => event.kind === "activation" ? at < event.effectiveAt : at >= event.effectiveAt)) reject();
  if (at < stream.start || stream.end !== undefined && at >= stream.end ||
    period.start < context.simulationStart || period.end > context.simulationEnd ||
    !utcMonthlyOccurrences(stream.recurrence.anchor, period, stream.recurrence.invalidDayPolicy).includes(at)) reject();
  const months = utcCalendarMonthDifference(stream.growthBaseAt, at);
  const evaluated = evaluatePrimitive({ primitiveId: "P08", input: { initial: stream.baseMonthlyAmount, rate: stream.growthRate },
    parameters: { category: "recurring_occurrence_amount", timeBasis: stream.growthRate.convention.basis === RateBasis.Periodic
      ? { kind: "per_period", periods: months }
      : { kind: "effective_annual", yearFraction: { numerator: months, denominator: 12 }, calculationRounding: new RoundingPolicy(18, "half_even") } },
    priorState: null, context: primitiveEvaluationContext({ period: { start: context.simulationStart, end: context.simulationEnd },
      evaluationInstant: at, scenarioId: context.scenarioId, primitiveInstanceId: stream.primitiveIds.growth,
      economicTargetId: stream.id, semanticEffectType: "income-growth" }) });
  const gross = new Money(evaluated.output.value.amount.round(RoundingPolicy.currency(context.baseCurrency.minorUnitScale, "half_up")), context.baseCurrency);
  if (!gross.equals(binding.gross) || binding.occurrenceId !== generatedOccurrenceKey({ scenarioId: context.scenarioId,
    primitiveInstanceId: stream.primitiveIds.recurrence, scheduledAt: at, semanticEffectType: "income-recognition", economicTargetId: stream.id })) reject();
  if (source.nonSalaryType !== undefined) return undefined;
  const token = Object.freeze({ ...binding, period: Object.freeze({ ...period }),
    context: Object.freeze({ ...context, versions: Object.freeze({ ...context.versions }) }) });
  occurrences.add(token);
  return token;
}
export function assertModeledPayrollOccurrence(token: ModeledPayrollOccurrence, bank: AccountState | undefined,
  expected: { id: string; incomeId: string; ownerId?: string; depositAccountId: string; at: string; occurrenceId?: string; gross: import("../../../../values/index.js").Money;
    runContext?: RunContext; householdId?: string; allocations: unknown; withholding?: unknown; taxCreditAccountId?: string }): void {
  if (!occurrences.has(token)) reject();
  qualifyModeledPayroll(token.stream, token.householdId, bank, token.context);
  if (expected.householdId !== token.householdId || canonicalSerialize(expected.runContext ?? null) !== canonicalSerialize(token.context) ||
    expected.id !== `tx:recognition:income:${token.stream.id}:${token.at}` || token.stream.id !== expected.incomeId || token.stream.ownerId !== expected.ownerId || token.stream.depositAccountId !== expected.depositAccountId ||
    token.at !== expected.at || token.occurrenceId !== expected.occurrenceId || !token.gross.equals(expected.gross) ||
    canonicalSerialize(token.stream.payrollContributions ?? []) !== canonicalSerialize(expected.allocations) ||
    canonicalSerialize(token.stream.payrollWithholding ?? null) !== canonicalSerialize(expected.withholding ?? null) ||
    token.stream.payrollTaxCreditAccountId !== expected.taxCreditAccountId) reject();
  occurrences.delete(token);
}
