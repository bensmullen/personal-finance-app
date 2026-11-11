import type { RecurringIncomeStream } from "../../../verticalSlice2.js";
import type { AccountState } from "../../../../state/index.js";
import { canonicalSerialize, type RunContext } from "../../../run.js";
import { sha256 } from "../../../../rules/tax/t1b/contentIdentity.js";
import { evaluatePrimitive, primitiveEvaluationContext } from "../../../../primitives/index.js";
import { generatedOccurrenceKey } from "../../../../identity/index.js";
import { utcCalendarMonthDifference, type Instant, type Period } from "../../../../time/index.js";
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
  readonly runId?: string;
  readonly dataCutoff?: string;
}
const issuers = new Map<string, (key: string) => ModeledPayrollBinding | undefined>();
export const modeledPayrollKey = (binding: unknown): string => `sha256:${sha256(canonicalSerialize(binding))}`;
export const withoutModeledPayroll = ({ modeledPayroll: _ref, ...stream }: RecurringIncomeStream) => stream;
const reject = (): never => failValidation({ severity: "error", code: issueCodes.verticalSlice2InputInvalid,
  entityType: "vertical_slice_2", message: "MODELED_PAYROLL_NOT_ADMITTED" });

/** Internal compiler composition seam, deliberately absent from public barrels.
 * Only the compiler closure can add bindings to its registered inventory. */
export function registerModeledPayrollCompiler(issuer: "canonical-cash-flow/v1" | "canonical-household/v1" | "canonical-forecast/v1",
  read: (key: string) => ModeledPayrollBinding | undefined): void {
  if (!["canonical-cash-flow/v1", "canonical-household/v1", "canonical-forecast/v1"].includes(issuer) || issuers.has(issuer)) return reject();
  issuers.set(issuer, read);
}

export function qualifyModeledPayroll(stream: RecurringIncomeStream, householdId: string,
  bank: AccountState | undefined, context: RunContext): void {
  const ref = stream.modeledPayroll;
  const binding = ref?.version === "modeled-payroll/v1" ? issuers.get(ref.issuer)?.(ref.key) : undefined;
  if (!binding || !bank || stream.householdWageSource !== undefined ||
    binding.householdId !== householdId || stream.ownerId === householdId ||
    !["cash", "checking", "savings"].includes(bank.kind) ||
    canonicalSerialize(binding.bank) !== canonicalSerialize({ id: bank.id, kind: bank.kind, ownerId: bank.ownerId }) ||
    canonicalSerialize(binding.stream) !== canonicalSerialize(withoutModeledPayroll(stream)) ||
    binding.asOf !== context.asOf || binding.scenarioId !== context.scenarioId ||
    binding.runId !== undefined && binding.runId !== context.runId ||
    binding.dataCutoff !== undefined && binding.dataCutoff !== context.dataCutoff ||
    context.dataCutoff > context.asOf || context.simulationStart < binding.start || context.simulationEnd > binding.end)
    reject();
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
// Tokens are local to one evaluated occurrence. References survive snapshots;
// VS2 must qualify them again before evaluating and admitting another paycheck.
const occurrences = new WeakSet<object>();
export function modeledPayrollOccurrence(binding: ModeledPayrollOccurrence, bank: AccountState | undefined): ModeledPayrollOccurrence {
  qualifyModeledPayroll(binding.stream, binding.householdId, bank, binding.context);
  const { stream, context, at, period } = binding;
  if (at < stream.start || stream.end !== undefined && at >= stream.end || at < stream.recurrence.anchor ||
    at.slice(8) !== stream.recurrence.anchor.slice(8) || period.start > at || period.end <= at ||
    period.start < context.simulationStart || period.end > context.simulationEnd) reject();
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
  const token = Object.freeze(binding); occurrences.add(token); return token;
}
export function assertModeledPayrollOccurrence(token: ModeledPayrollOccurrence, bank: AccountState | undefined,
  expected: { id: string; incomeId: string; ownerId?: string; depositAccountId: string; at: string; occurrenceId?: string; gross: import("../../../../values/index.js").Money;
    allocations: unknown; withholding?: unknown; taxCreditAccountId?: string }): void {
  if (!occurrences.has(token)) reject();
  qualifyModeledPayroll(token.stream, token.householdId, bank, token.context);
  if (expected.id !== `tx:recognition:income:${token.stream.id}:${token.at}` || token.stream.id !== expected.incomeId || token.stream.ownerId !== expected.ownerId || token.stream.depositAccountId !== expected.depositAccountId ||
    token.at !== expected.at || token.occurrenceId !== expected.occurrenceId || !token.gross.equals(expected.gross) ||
    canonicalSerialize(token.stream.payrollContributions ?? []) !== canonicalSerialize(expected.allocations) ||
    canonicalSerialize(token.stream.payrollWithholding ?? null) !== canonicalSerialize(expected.withholding ?? null) ||
    token.stream.payrollTaxCreditAccountId !== expected.taxCreditAccountId) reject();
}
