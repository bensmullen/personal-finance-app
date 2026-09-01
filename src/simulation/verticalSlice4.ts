import { accountingTransactionId, createAccountingLeg, createAccountingTransaction, type AccountingLegDraft, type AccountingTransaction, type LiabilityId } from "../accounting/index.js";
import { ValidationError, failValidation, issueCodes, validationIssue, type ValidationIssue } from "../diagnostics/index.js";
import { createFundingPolicy, isAcceptedFundingResolution, resolveFunding, type ConstraintOutcome, type FundingPolicy, type LiquidityShortfall } from "../funding/index.js";
import { domainId, generatedOccurrenceKey, type DomainId, type GeneratedOccurrenceKey } from "../identity/index.js";
import { calculationTraceId, calculationTraceRef, freezeTraceRefs, type CalculationTraceRef } from "../lineage/index.js";
import { createFactProvenance, type ModelGeneratedFactProvenance } from "../model/provenance.js";
import { createSemanticEffect, type SemanticEffect } from "../semantics/effect.js";
import { applySettlement, claimId, createObligation, createRecognitionFact, createSettlement, createSettlementProposal, recognitionId, semanticEffectId, settlementId, settlementProposalId, type Obligation, type RecognitionFact, type Settlement, type SettlementProposal } from "../semantics/index.js";
import { applyAccountingTransactionAtomically, assertAuthoritativeStateCurrency, cloneAuthoritativeState, registerAuthoritativeIdentity, type AuthoritativeState } from "../state/index.js";
import { deriveStatements, type Statements } from "../statements/index.js";
import { utcMonthDifference, utcMonthlyOccurrences, utcMonthlyPeriods, type Instant, type Period } from "../time/index.js";
import { Money, RateBasis, RoundingPolicy, sumMoney, type Currency, type Rate } from "../values/index.js";
import { createPrimitiveRuntimeStateStore, runPeriod, type PeriodWork, type PrimitiveRuntimeStateStore } from "./period.js";
import { createInputFingerprint, createRunMetadata, type RunContext, type RunMetadata } from "./run.js";

export type HouseholdId = DomainId<"household">;
export type PersonId = DomainId<"person">;
export type LoanContractId = DomainId<"loan-contract">;
export type ExtraPrincipalPaymentId = DomainId<"extra-principal-payment">;
export type PrimitiveInstanceId = DomainId<"primitive-instance">;

export interface ExtraPrincipalPayment {
  readonly id: ExtraPrincipalPaymentId;
  readonly scheduledAt: Instant;
  readonly amount: Money;
  readonly fundingPolicy: FundingPolicy;
  readonly primitiveInstanceId: PrimitiveInstanceId;
}

export interface FixedAmortizingLoan {
  readonly id: LoanContractId;
  readonly ownerId: PersonId | HouseholdId;
  readonly principalLiabilityId: LiabilityId;
  readonly interestPayableLiabilityId: LiabilityId;
  readonly originalPrincipal: Money;
  readonly annualRate: Rate;
  readonly totalPayments: number;
  readonly rateType: "fixed";
  readonly paymentFrequency: "monthly";
  readonly interestConvention: "nominal_annual_12";
  readonly amortization: "fully_amortizing";
  readonly paymentResetPolicy: "fixed_no_recast";
  readonly interestCapitalization: "none";
  readonly partialPaymentPolicy: "all_or_nothing";
  readonly paymentSchedule: { readonly kind: "utc_monthly"; readonly anchor: Instant; readonly invalidDayPolicy: "skip" };
  readonly fundingPolicy: FundingPolicy;
  readonly settlementPriority: number;
  readonly extraPrincipalPayments?: readonly ExtraPrincipalPayment[];
  readonly postingRounding: RoundingPolicy;
  readonly primitiveIds: { readonly schedule: PrimitiveInstanceId; readonly amortization: PrimitiveInstanceId; readonly accrual: PrimitiveInstanceId };
}

export interface VerticalSlice4Input { readonly householdId: HouseholdId; readonly ownerId: PersonId; readonly baseCurrency: Currency; readonly loans: readonly FixedAmortizingLoan[]; }
export interface LiabilityPeriodResult { readonly loanId: LoanContractId; readonly occurrenceId: GeneratedOccurrenceKey; readonly scheduledAt: Instant; readonly openingPrincipal: Money; readonly contractualPayment: Money; readonly currentInterest: Money; readonly scheduledPayment: Money; readonly scheduledPrincipalPaid: Money; readonly extraPrincipalPaid: Money; readonly endingPrincipal: Money; readonly outstandingInterest: Money; readonly scheduledFundingStatus: ConstraintOutcome["status"]; readonly extraFundingStatus?: ConstraintOutcome["status"]; }
export interface VerticalSlice4PeriodResult { readonly period: Period; readonly liabilities: readonly LiabilityPeriodResult[]; readonly interestExpense: Money; readonly principalReduction: Money; readonly endingPrincipal: Money; readonly outstandingInterest: Money; readonly transactions: readonly AccountingTransaction[]; readonly recognitions: readonly RecognitionFact[]; readonly settlementProposals: readonly SettlementProposal[]; readonly settlements: readonly Settlement[]; readonly effects: readonly SemanticEffect[]; readonly constraintOutcomes: readonly ConstraintOutcome[]; readonly liquidityShortfalls: readonly LiquidityShortfall[]; readonly statements: Statements; readonly diagnostics: readonly ValidationIssue[]; readonly traceRefs: readonly CalculationTraceRef[]; }
export interface VerticalSlice4RunInput { readonly runContext: RunContext; readonly openingState: AuthoritativeState; readonly input: VerticalSlice4Input; readonly months?: number; readonly primitiveState?: PrimitiveRuntimeStateStore; }
export interface VerticalSlice4RunResult { readonly status: "completed" | "incomplete"; readonly runMetadata: RunMetadata; readonly requestedHorizon: Period; readonly reachedThrough?: Instant; readonly stoppedAt?: Instant; readonly state: AuthoritativeState; readonly primitiveState: PrimitiveRuntimeStateStore; readonly periods: readonly VerticalSlice4PeriodResult[]; readonly diagnostics: readonly ValidationIssue[]; }

const invalid = (message: string, fieldPath: string, unsupported = false): never => failValidation({ severity: "error", code: unsupported ? issueCodes.liabilityConfigurationUnsupported : issueCodes.verticalSlice4InputInvalid, message, entityType: "vertical_slice_4", fieldPath });
const transaction = (id: string, date: Instant, type: string, legs: readonly AccountingLegDraft[], traceRefs: readonly CalculationTraceRef[]): AccountingTransaction => createAccountingTransaction({ id: accountingTransactionId(id), date, type, legs: legs.map((leg) => createAccountingLeg({ ...leg, traceRefs: leg.traceRefs ?? traceRefs })), traceRefs });
const refs = (loan: FixedAmortizingLoan, at: Instant): readonly CalculationTraceRef[] => freezeTraceRefs([calculationTraceRef(calculationTraceId(`vs4:loan:${loan.id}:opening-principal:${at}`)), calculationTraceRef(calculationTraceId(`vs4:loan:${loan.id}:interest-accrual:${at}`)), calculationTraceRef(calculationTraceId(`vs4:loan:${loan.id}:amortization:${at}`)), calculationTraceRef(calculationTraceId(`vs4:loan:${loan.id}:funding:${at}`))])!;
const provenance = (loan: FixedAmortizingLoan, at: Instant, occurrenceId: GeneratedOccurrenceKey): ModelGeneratedFactProvenance => createFactProvenance({ factKind: "model_generated", sourceType: "model", sourceId: loan.primitiveIds.schedule, effectiveAt: at, generatedOccurrenceKey: occurrenceId }) as ModelGeneratedFactProvenance;
const balances = (state: AuthoritativeState): Readonly<Record<string, Money>> => Object.fromEntries(Object.entries(state.accounts).map(([id, account]) => [id, account.cash]));

const canFullyFund = (policy: FundingPolicy, requestedAmount: Money, state: AuthoritativeState): boolean => {
  let remaining = requestedAmount;
  for (const source of policy.orderedSources) {
    const account = state.accounts[source.accountId] ?? invalid(`Funding source account ${source.accountId} is missing`, `fundingPolicy.${policy.id}.orderedSources`);
    if (!account.cash.currency.equals(requestedAmount.currency)) invalid(`Funding source account ${source.accountId} has the wrong currency`, `fundingPolicy.${policy.id}.orderedSources`);
    if (remaining.isZero() || account.cash.isZero()) continue;
    const amount = account.cash.compare(remaining) >= 0 ? remaining : account.cash;
    remaining = remaining.minus(amount);
  }
  return remaining.isZero();
};
const zeroBalances = (policy: FundingPolicy, currency: Currency): Readonly<Record<string, Money>> => Object.fromEntries(policy.orderedSources.map((source) => [source.accountId, Money.zero(currency)]));
const validatePolicy = (policy: FundingPolicy, openingState: AuthoritativeState, currency: Currency, path: string): void => { createFundingPolicy(policy); if (policy.allowPartial || policy.insufficientFundsBehavior !== "unfunded") invalid("PR 10 supports only all-or-nothing unfunded mortgage funding", path, true); for (const source of policy.orderedSources) { const account = openingState.accounts[source.accountId] ?? invalid(`Funding source ${source.accountId} does not exist`, path); if (!account.cash.currency.equals(currency)) invalid(`Funding source ${source.accountId} currency does not match the run`, path); } };
const canonicalInput = (input: VerticalSlice4Input): unknown => Object.freeze({ ...input, loans: Object.freeze([...input.loans].sort((a, b) => a.id.localeCompare(b.id)).map((loan) => Object.freeze({ ...loan, extraPrincipalPayments: Object.freeze([...(loan.extraPrincipalPayments ?? [])].sort((a, b) => a.id.localeCompare(b.id))) }))) });

const validate = (request: VerticalSlice4RunInput, periods: readonly Period[]): void => {
  const { input, openingState, runContext } = request;
  if (!input.baseCurrency.equals(runContext.baseCurrency)) invalid("Slice currency must match the run context", "input.baseCurrency"); assertAuthoritativeStateCurrency(openingState, input.baseCurrency);
  if (input.loans.length === 0) invalid("At least one loan is required", "input.loans");
  if (periods.length === 0 || periods[0]!.start !== runContext.simulationStart || periods[periods.length - 1]!.end !== runContext.simulationEnd) invalid("Monthly periods must exactly cover the run horizon", "months");
  const stableIds: string[] = [];
  for (const loan of input.loans) {
    stableIds.push(loan.id, loan.primitiveIds.schedule, loan.primitiveIds.amortization, loan.primitiveIds.accrual, ...(loan.extraPrincipalPayments ?? []).flatMap((extra) => [extra.id, extra.primitiveInstanceId]));
    const principal = openingState.liabilities[loan.principalLiabilityId] ?? invalid(`Principal liability ${loan.principalLiabilityId} is missing`, `loans.${loan.id}.principalLiabilityId`); const payable = openingState.liabilities[loan.interestPayableLiabilityId] ?? invalid(`Interest-payable liability ${loan.interestPayableLiabilityId} is missing`, `loans.${loan.id}.interestPayableLiabilityId`); if (loan.principalLiabilityId === loan.interestPayableLiabilityId) invalid("Principal and interest payable require distinct liability state targets", `loans.${loan.id}.interestPayableLiabilityId`);
    if (!principal.balance.currency.equals(input.baseCurrency) || !payable.balance.currency.equals(input.baseCurrency) || !loan.originalPrincipal.currency.equals(input.baseCurrency)) invalid("Loan Money values must use the run base currency", `loans.${loan.id}`); if (loan.originalPrincipal.isNegative() || principal.balance.isNegative() || payable.balance.isNegative()) invalid("Loan opening balances cannot be negative", `loans.${loan.id}`);
    if (loan.rateType !== "fixed" || loan.paymentFrequency !== "monthly" || loan.interestConvention !== "nominal_annual_12" || loan.amortization !== "fully_amortizing" || loan.paymentResetPolicy !== "fixed_no_recast" || loan.interestCapitalization !== "none" || loan.partialPaymentPolicy !== "all_or_nothing") invalid("Unsupported loan product configuration", `loans.${loan.id}`, true);
    if (loan.annualRate.convention.basis !== RateBasis.NominalAnnual || loan.annualRate.convention.compoundingPeriodsPerYear !== 12 || loan.annualRate.value.isNegative()) invalid("Loan rate must be a non-negative explicit nominal annual Rate with 12 compounding periods", `loans.${loan.id}.annualRate`, true);
    if (!Number.isSafeInteger(loan.totalPayments) || loan.totalPayments <= 0) invalid("Loan totalPayments must be a positive safe integer", `loans.${loan.id}.totalPayments`); if (!Number.isSafeInteger(loan.settlementPriority) || loan.settlementPriority < 0) invalid("Loan settlementPriority must be a non-negative safe integer", `loans.${loan.id}.settlementPriority`); if (loan.paymentSchedule.kind !== "utc_monthly" || loan.paymentSchedule.invalidDayPolicy !== "skip") invalid("Only deterministic UTC monthly payment schedules are supported", `loans.${loan.id}.paymentSchedule`, true); if (loan.postingRounding.scale !== input.baseCurrency.minorUnitScale) invalid("Loan posting rounding must use currency settlement precision", `loans.${loan.id}.postingRounding`);
    validatePolicy(loan.fundingPolicy, openingState, input.baseCurrency, `loans.${loan.id}.fundingPolicy`);
    const allOccurrences = periods.flatMap((period) => utcMonthlyOccurrences(loan.paymentSchedule.anchor, period, loan.paymentSchedule.invalidDayPolicy)).slice(0, loan.totalPayments); const occurrenceSet = new Set(allOccurrences);
    for (const extra of loan.extraPrincipalPayments ?? []) { if (!extra.amount.isPositive() || !extra.amount.currency.equals(input.baseCurrency) || !extra.amount.amount.fitsScale(input.baseCurrency.minorUnitScale)) invalid("Extra principal must be positive posted Money", `loans.${loan.id}.extraPrincipalPayments.${extra.id}.amount`); if (!occurrenceSet.has(extra.scheduledAt)) invalid("Extra principal must coincide with a scheduled debt-service occurrence", `loans.${loan.id}.extraPrincipalPayments.${extra.id}.scheduledAt`); validatePolicy(extra.fundingPolicy, openingState, input.baseCurrency, `loans.${loan.id}.extraPrincipalPayments.${extra.id}.fundingPolicy`); }
    if (new Set((loan.extraPrincipalPayments ?? []).map((extra) => extra.scheduledAt)).size !== (loan.extraPrincipalPayments ?? []).length) invalid("A loan may have at most one extra-principal instruction per occurrence", `loans.${loan.id}.extraPrincipalPayments`);
  }
  if (new Set(stableIds).size !== stableIds.length) invalid("Loan, payment, extra-payment, and primitive identities must be unique", "input.loans");
  const liabilityTargets = input.loans.flatMap((loan) => [loan.principalLiabilityId, loan.interestPayableLiabilityId]);
  if (new Set(liabilityTargets).size !== liabilityTargets.length) invalid("Each loan balance requires distinct authoritative principal and interest-payable targets", "input.loans");
  for (const period of periods) { const active = input.loans.flatMap((loan) => utcMonthlyOccurrences(loan.paymentSchedule.anchor, period, loan.paymentSchedule.invalidDayPolicy).map((at) => ({ loan, at }))); for (let l = 0; l < active.length; l += 1) for (let r = l + 1; r < active.length; r += 1) { const a = active[l]!; const b = active[r]!; const shared = a.at === b.at && a.loan.fundingPolicy.orderedSources.some((source) => b.loan.fundingPolicy.orderedSources.some((other) => other.accountId === source.accountId)); if (shared && a.loan.settlementPriority === b.loan.settlementPriority) invalid("Same-instant loans sharing liquidity require distinct settlement priorities", "input.loans.settlementPriority"); } }
};
const totalLiability = (state: AuthoritativeState, loans: readonly FixedAmortizingLoan[], selector: "principal" | "interest", currency: Currency): Money => sumMoney(loans.map((loan) => state.liabilities[selector === "principal" ? loan.principalLiabilityId : loan.interestPayableLiabilityId]!.balance), currency);

export const runVerticalSlice4 = (request: VerticalSlice4RunInput): VerticalSlice4RunResult => {
  const months = request.months ?? utcMonthDifference(request.runContext.simulationStart, request.runContext.simulationEnd); const periods = utcMonthlyPeriods(request.runContext.simulationStart, months); validate(request, periods);
  const requestedHorizon = Object.freeze({ start: periods[0]!.start, end: periods[periods.length - 1]!.end }); const runMetadata = createRunMetadata(request.runContext, createInputFingerprint({ runContext: request.runContext, openingState: request.openingState, model: canonicalInput(request.input), executionPlan: { months } }));
  let state = cloneAuthoritativeState(request.openingState); let primitiveState = createPrimitiveRuntimeStateStore(request.primitiveState); const committed: VerticalSlice4PeriodResult[] = []; const runDiagnostics: ValidationIssue[] = [];
  for (const period of periods) try {
    const candidateState = cloneAuthoritativeState(state); let candidatePrimitiveState = createPrimitiveRuntimeStateStore(primitiveState); const loanResults: LiabilityPeriodResult[] = []; const transactions: AccountingTransaction[] = []; const recognitions: RecognitionFact[] = []; const proposals: SettlementProposal[] = []; const settlements: Settlement[] = []; const effects: SemanticEffect[] = []; const outcomes: ConstraintOutcome[] = []; const shortfalls: LiquidityShortfall[] = []; const diagnostics: ValidationIssue[] = []; const periodRefs: CalculationTraceRef[] = []; let interestExpense = Money.zero(request.input.baseCurrency); let principalReduction = Money.zero(request.input.baseCurrency);
    const scheduled = request.input.loans.flatMap((loan) => { const prior = candidatePrimitiveState[loan.primitiveIds.amortization]; const evaluations = prior?.primitiveId === "P22" ? prior.state.evaluations : 0; if (evaluations >= loan.totalPayments) return []; return utcMonthlyOccurrences(loan.paymentSchedule.anchor, period, loan.paymentSchedule.invalidDayPolicy).map((at) => ({ loan, at })); }).sort((a, b) => a.at.localeCompare(b.at) || a.loan.settlementPriority - b.loan.settlementPriority || a.loan.id.localeCompare(b.loan.id));
    for (const { loan, at } of scheduled) {
      const openingPrincipal = candidateState.liabilities[loan.principalLiabilityId]!.balance; if (openingPrincipal.isZero()) continue; const traceRefs = refs(loan, at); const occurrenceId = generatedOccurrenceKey({ scenarioId: request.runContext.scenarioId, primitiveInstanceId: loan.primitiveIds.schedule, scheduledAt: at, semanticEffectType: "liability-payment", economicTargetId: loan.principalLiabilityId }); const generatedProvenance = provenance(loan, at, occurrenceId);
      const p24Work: PeriodWork[] = [{ id: `accrual:${loan.id}:${at}`, kind: "primitive", request: { primitiveId: "P24", input: { balance: openingPrincipal, rate: loan.annualRate }, parameters: { basis: "nominal_annual_monthly", postingRounding: loan.postingRounding }, context: { evaluationInstant: at, scenarioId: request.runContext.scenarioId, primitiveInstanceId: loan.primitiveIds.accrual, economicTargetId: loan.principalLiabilityId, semanticEffectType: "interest-accrual", traceRefs } } }]; const p24 = runPeriod({ period, runContext: request.runContext, openingState: candidateState, primitiveState: candidatePrimitiveState, work: p24Work }); candidatePrimitiveState = p24.primitiveState; const currentInterest = (p24.primitiveOutputs[0]!.output as { readonly accruedAmount: Money }).accruedAmount;
      const extraInstruction = (loan.extraPrincipalPayments ?? []).find((extra) => extra.scheduledAt === at); const p22Work: PeriodWork[] = [{ id: `amortization:${loan.id}:${at}`, kind: "primitive", request: { primitiveId: "P22", input: { openingPrincipal, currentInterest, ...(extraInstruction === undefined ? {} : { extraPrincipal: extraInstruction.amount }) }, parameters: { originalPrincipal: loan.originalPrincipal, annualRate: loan.annualRate, totalPayments: loan.totalPayments, postingRounding: loan.postingRounding }, context: { evaluationInstant: at, scenarioId: request.runContext.scenarioId, primitiveInstanceId: loan.primitiveIds.amortization, economicTargetId: loan.principalLiabilityId, semanticEffectType: "amortization", traceRefs } } }]; const p22 = runPeriod({ period, runContext: request.runContext, openingState: candidateState, primitiveState: candidatePrimitiveState, work: p22Work }); candidatePrimitiveState = p22.primitiveState; const amortization = p22.primitiveOutputs[0]!.output as { readonly contractualPayment: Money; readonly scheduledPayment: Money; readonly scheduledPrincipal: Money; readonly extraPrincipalAccepted: Money };
      registerAuthoritativeIdentity(candidateState.identities, "generatedOccurrenceKeys", occurrenceId);
      periodRefs.push(...traceRefs);
      let interestObligation: Obligation | undefined;
      let interestProposal: SettlementProposal | undefined;
      if (currentInterest.isPositive()) {
        const recognition = createRecognitionFact({ id: recognitionId(`recognition:mortgage-interest:${loan.id}:${at}`), category: "mortgage_interest_expense", amount: currentInterest, recognizedAt: at, sourceOccurrenceKey: occurrenceId, provenance: generatedProvenance, traceRefs }, candidateState.identities.recognitionIds);
        registerAuthoritativeIdentity(candidateState.identities, "recognitionIds", recognition.id);
        recognitions.push(recognition);
        interestObligation = createObligation({ id: claimId(`obligation:mortgage-interest:${loan.id}:${at}`), category: "mortgage_interest_payable", originatingRecognitionId: recognition.id, economicOwnerId: loan.ownerId, balanceEntityId: loan.interestPayableLiabilityId, originalAmount: currentInterest, recognizedAt: at, dueAt: at, traceRefs }, Object.values(candidateState.obligations));
        candidateState.obligations[interestObligation.id] = interestObligation;
        interestProposal = createSettlementProposal({ id: settlementProposalId(`proposal:${interestObligation.id}`), claimId: interestObligation.id, requestedAmount: currentInterest, requestedAt: at, fundingPolicyId: loan.fundingPolicy.id, provenance: generatedProvenance, traceRefs }, interestObligation);
        proposals.push(interestProposal);
        effects.push(
          createSemanticEffect({ id: semanticEffectId(`effect:${recognition.id}`), kind: "recognition", category: "mortgage_interest_expense", amount: currentInterest, occurredAt: at, sourceOccurrenceKey: occurrenceId, recognitionId: recognition.id, provenance: generatedProvenance, traceRefs }),
          createSemanticEffect({ id: semanticEffectId(`effect:${interestObligation.id}`), kind: "claim", category: "mortgage_interest_payable", amount: currentInterest, occurredAt: at, sourceOccurrenceKey: occurrenceId, recognitionId: recognition.id, claimId: interestObligation.id, provenance: generatedProvenance, traceRefs }),
        );
        const tx = transaction(`tx:recognition:mortgage-interest:${loan.id}:${at}`, at, "mortgage_interest_recognition", [{ posting: "debit", type: "expense", amount: currentInterest }, { posting: "credit", type: "liability", amount: currentInterest, entityId: loan.interestPayableLiabilityId }], traceRefs);
        applyAccountingTransactionAtomically(candidateState, tx);
        transactions.push(tx);
        interestExpense = interestExpense.plus(currentInterest);
      }

      const principalRecognition = createRecognitionFact({ id: recognitionId(`recognition:mortgage-principal-due:${loan.id}:${at}`), category: "mortgage_principal_due", amount: amortization.scheduledPrincipal, recognizedAt: at, sourceOccurrenceKey: occurrenceId, provenance: generatedProvenance, traceRefs }, candidateState.identities.recognitionIds);
      registerAuthoritativeIdentity(candidateState.identities, "recognitionIds", principalRecognition.id);
      recognitions.push(principalRecognition);
      const principalObligation = createObligation({ id: claimId(`obligation:mortgage-principal:${loan.id}:${at}`), category: "mortgage_principal_due", originatingRecognitionId: principalRecognition.id, economicOwnerId: loan.ownerId, balanceEntityId: loan.principalLiabilityId, originalAmount: amortization.scheduledPrincipal, recognizedAt: at, dueAt: at, traceRefs }, Object.values(candidateState.obligations));
      candidateState.obligations[principalObligation.id] = principalObligation;
      const principalProposal = createSettlementProposal({ id: settlementProposalId(`proposal:${principalObligation.id}`), claimId: principalObligation.id, requestedAmount: amortization.scheduledPrincipal, requestedAt: at, fundingPolicyId: loan.fundingPolicy.id, provenance: generatedProvenance, traceRefs }, principalObligation);
      proposals.push(principalProposal);
      effects.push(
        createSemanticEffect({ id: semanticEffectId(`effect:${principalRecognition.id}`), kind: "recognition", category: "mortgage_principal_due", amount: amortization.scheduledPrincipal, occurredAt: at, sourceOccurrenceKey: occurrenceId, recognitionId: principalRecognition.id, provenance: generatedProvenance, traceRefs }),
        createSemanticEffect({ id: semanticEffectId(`effect:${principalObligation.id}`), kind: "claim", category: "mortgage_principal_due", amount: amortization.scheduledPrincipal, occurredAt: at, sourceOccurrenceKey: occurrenceId, recognitionId: principalRecognition.id, claimId: principalObligation.id, provenance: generatedProvenance, traceRefs }),
      );

      const scheduledIsFunded = canFullyFund(loan.fundingPolicy, amortization.scheduledPayment, candidateState);
      const resolutionBalances = scheduledIsFunded ? balances(candidateState) : zeroBalances(loan.fundingPolicy, request.input.baseCurrency);
      const interestFunding = interestObligation === undefined || interestProposal === undefined ? undefined : resolveFunding(interestProposal, interestObligation, loan.fundingPolicy, resolutionBalances, at);
      if (interestFunding !== undefined) {
        outcomes.push(interestFunding.outcome);
        if (interestFunding.liquidityShortfall !== undefined) shortfalls.push(interestFunding.liquidityShortfall);
      }
      const principalFunding = resolveFunding(principalProposal, principalObligation, loan.fundingPolicy, scheduledIsFunded ? balances(candidateState) : resolutionBalances, at);
      outcomes.push(principalFunding.outcome);
      if (principalFunding.liquidityShortfall !== undefined) shortfalls.push(principalFunding.liquidityShortfall);
      if (!scheduledIsFunded) diagnostics.push(validationIssue({ severity: "warning", code: issueCodes.liquidityShortfall, message: `Scheduled debt service could not be funded in full for loan ${loan.id}`, entityType: "loan_contract", entityId: loan.id, relatedIds: [loan.fundingPolicy.id] }));

      let scheduledPrincipalPaid = Money.zero(request.input.baseCurrency);
      let extraPrincipalPaid = Money.zero(request.input.baseCurrency);
      let extraFundingStatus: ConstraintOutcome["status"] | undefined;
      if (scheduledIsFunded) {
        if (interestFunding !== undefined) {
          if (!isAcceptedFundingResolution(interestFunding) || interestObligation === undefined) throw new Error("Scheduled interest funding preflight disagrees with settlement funding");
          const accepted = createSettlement({ id: settlementId(`settlement:${interestObligation.id}`), settledAt: at, provenance: generatedProvenance, traceRefs }, interestFunding, interestObligation, candidateState.identities.settlementIds);
          registerAuthoritativeIdentity(candidateState.identities, "settlementIds", accepted.id);
          settlements.push(accepted);
          candidateState.obligations[interestObligation.id] = applySettlement(interestObligation, accepted) as Obligation;
          effects.push(createSemanticEffect({ id: semanticEffectId(`effect:${accepted.id}`), kind: "settlement", category: "mortgage_interest_payable", amount: accepted.amount, occurredAt: at, claimId: accepted.claimId, settlementId: accepted.id, provenance: generatedProvenance, traceRefs }));
          const tx = transaction(`tx:settlement:mortgage-interest:${loan.id}:${at}`, at, "mortgage_interest_settlement", [{ posting: "debit", type: "liability", amount: accepted.amount, entityId: loan.interestPayableLiabilityId }, ...interestFunding.fundingAllocations.map((allocation): AccountingLegDraft => ({ posting: "credit", type: "cash", amount: allocation.amount, accountId: allocation.accountId, cashFlowClass: "operating" }))], traceRefs);
          applyAccountingTransactionAtomically(candidateState, tx);
          transactions.push(tx);
        }
        const actualPrincipalFunding = resolveFunding(principalProposal, principalObligation, loan.fundingPolicy, balances(candidateState), at);
        if (!isAcceptedFundingResolution(actualPrincipalFunding)) throw new Error("Scheduled principal funding preflight disagrees with settlement funding");
        const principalSettlement = createSettlement({ id: settlementId(`settlement:${principalObligation.id}`), settledAt: at, provenance: generatedProvenance, traceRefs }, actualPrincipalFunding, principalObligation, candidateState.identities.settlementIds);
        registerAuthoritativeIdentity(candidateState.identities, "settlementIds", principalSettlement.id);
        settlements.push(principalSettlement);
        candidateState.obligations[principalObligation.id] = applySettlement(principalObligation, principalSettlement) as Obligation;
        effects.push(createSemanticEffect({ id: semanticEffectId(`effect:${principalSettlement.id}`), kind: "settlement", category: "mortgage_principal_due", amount: principalSettlement.amount, occurredAt: at, claimId: principalSettlement.claimId, settlementId: principalSettlement.id, provenance: generatedProvenance, traceRefs }));
        const principalTx = transaction(`tx:settlement:mortgage-principal:${loan.id}:${at}`, at, "mortgage_principal_payment", [{ posting: "debit", type: "liability", amount: principalSettlement.amount, entityId: loan.principalLiabilityId }, ...actualPrincipalFunding.fundingAllocations.map((allocation): AccountingLegDraft => ({ posting: "credit", type: "cash", amount: allocation.amount, accountId: allocation.accountId, cashFlowClass: "financing" }))], traceRefs);
        applyAccountingTransactionAtomically(candidateState, principalTx);
        transactions.push(principalTx);
        scheduledPrincipalPaid = principalSettlement.amount;
        principalReduction = principalReduction.plus(scheduledPrincipalPaid);

        if (extraInstruction !== undefined && amortization.extraPrincipalAccepted.isPositive() && !candidateState.liabilities[loan.principalLiabilityId]!.balance.isZero()) {
          const extraOccurrenceId = generatedOccurrenceKey({ scenarioId: request.runContext.scenarioId, primitiveInstanceId: extraInstruction.primitiveInstanceId, scheduledAt: at, semanticEffectType: "extra-principal-payment", economicTargetId: loan.principalLiabilityId });
          registerAuthoritativeIdentity(candidateState.identities, "generatedOccurrenceKeys", extraOccurrenceId);
          const extraProvenance = createFactProvenance({ factKind: "model_generated", sourceType: "model", sourceId: extraInstruction.primitiveInstanceId, effectiveAt: at, generatedOccurrenceKey: extraOccurrenceId });
          const extraRecognition = createRecognitionFact({ id: recognitionId(`recognition:extra-principal-due:${extraInstruction.id}:${at}`), category: "mortgage_extra_principal_due", amount: amortization.extraPrincipalAccepted, recognizedAt: at, sourceOccurrenceKey: extraOccurrenceId, provenance: extraProvenance, traceRefs }, candidateState.identities.recognitionIds);
          registerAuthoritativeIdentity(candidateState.identities, "recognitionIds", extraRecognition.id);
          recognitions.push(extraRecognition);
          const extraObligation = createObligation({ id: claimId(`obligation:extra-principal:${extraInstruction.id}:${at}`), category: "mortgage_extra_principal_due", originatingRecognitionId: extraRecognition.id, economicOwnerId: loan.ownerId, balanceEntityId: loan.principalLiabilityId, originalAmount: amortization.extraPrincipalAccepted, recognizedAt: at, dueAt: at, traceRefs }, Object.values(candidateState.obligations));
          candidateState.obligations[extraObligation.id] = extraObligation;
          const extraProposal = createSettlementProposal({ id: settlementProposalId(`proposal:${extraObligation.id}`), claimId: extraObligation.id, requestedAmount: amortization.extraPrincipalAccepted, requestedAt: at, fundingPolicyId: extraInstruction.fundingPolicy.id, provenance: extraProvenance, traceRefs }, extraObligation);
          proposals.push(extraProposal);
          effects.push(
            createSemanticEffect({ id: semanticEffectId(`effect:${extraRecognition.id}`), kind: "recognition", category: "mortgage_extra_principal_due", amount: amortization.extraPrincipalAccepted, occurredAt: at, sourceOccurrenceKey: extraOccurrenceId, recognitionId: extraRecognition.id, provenance: extraProvenance, traceRefs }),
            createSemanticEffect({ id: semanticEffectId(`effect:${extraObligation.id}`), kind: "claim", category: "mortgage_extra_principal_due", amount: amortization.extraPrincipalAccepted, occurredAt: at, sourceOccurrenceKey: extraOccurrenceId, recognitionId: extraRecognition.id, claimId: extraObligation.id, provenance: extraProvenance, traceRefs }),
          );
          const extraFunding = resolveFunding(extraProposal, extraObligation, extraInstruction.fundingPolicy, balances(candidateState), at);
          outcomes.push(extraFunding.outcome);
          diagnostics.push(...extraFunding.issues);
          if (extraFunding.liquidityShortfall !== undefined) shortfalls.push(extraFunding.liquidityShortfall);
          extraFundingStatus = extraFunding.outcome.status;
          if (isAcceptedFundingResolution(extraFunding)) {
            const extraSettlement = createSettlement({ id: settlementId(`settlement:${extraObligation.id}`), settledAt: at, provenance: extraProvenance, traceRefs }, extraFunding, extraObligation, candidateState.identities.settlementIds);
            registerAuthoritativeIdentity(candidateState.identities, "settlementIds", extraSettlement.id);
            settlements.push(extraSettlement);
            candidateState.obligations[extraObligation.id] = applySettlement(extraObligation, extraSettlement) as Obligation;
            effects.push(createSemanticEffect({ id: semanticEffectId(`effect:${extraSettlement.id}`), kind: "settlement", category: "mortgage_extra_principal_due", amount: extraSettlement.amount, occurredAt: at, sourceOccurrenceKey: extraOccurrenceId, claimId: extraSettlement.claimId, settlementId: extraSettlement.id, provenance: extraProvenance, traceRefs }));
            const extraTx = transaction(`tx:extra-principal:${extraInstruction.id}:${at}`, at, "mortgage_extra_principal", [{ posting: "debit", type: "liability", amount: extraSettlement.amount, entityId: loan.principalLiabilityId }, ...extraFunding.fundingAllocations.map((allocation): AccountingLegDraft => ({ posting: "credit", type: "cash", amount: allocation.amount, accountId: allocation.accountId, cashFlowClass: "financing" }))], traceRefs);
            applyAccountingTransactionAtomically(candidateState, extraTx);
            transactions.push(extraTx);
            extraPrincipalPaid = extraSettlement.amount;
            principalReduction = principalReduction.plus(extraPrincipalPaid);
          }
        }
      }
      const endingPrincipal = candidateState.liabilities[loan.principalLiabilityId]!.balance;
      loanResults.push(Object.freeze({ loanId: loan.id, occurrenceId, scheduledAt: at, openingPrincipal, contractualPayment: amortization.contractualPayment, currentInterest, scheduledPayment: amortization.scheduledPayment, scheduledPrincipalPaid, extraPrincipalPaid, endingPrincipal, outstandingInterest: candidateState.liabilities[loan.interestPayableLiabilityId]!.balance, scheduledFundingStatus: scheduledIsFunded ? "fully_satisfied" : "unfunded", ...(extraFundingStatus === undefined ? {} : { extraFundingStatus }) }));
    }
    const result: VerticalSlice4PeriodResult = Object.freeze({ period: Object.freeze({ ...period }), liabilities: Object.freeze(loanResults), interestExpense, principalReduction, endingPrincipal: totalLiability(candidateState, request.input.loans, "principal", request.input.baseCurrency), outstandingInterest: totalLiability(candidateState, request.input.loans, "interest", request.input.baseCurrency), transactions: Object.freeze(transactions), recognitions: Object.freeze(recognitions), settlementProposals: Object.freeze(proposals), settlements: Object.freeze(settlements), effects: Object.freeze(effects), constraintOutcomes: Object.freeze(outcomes), liquidityShortfalls: Object.freeze(shortfalls), statements: deriveStatements(candidateState, transactions, request.input.baseCurrency), diagnostics: Object.freeze(diagnostics), traceRefs: freezeTraceRefs([...new Map(periodRefs.map((ref) => [ref.traceId, ref])).values()])! }); state = candidateState; primitiveState = candidatePrimitiveState; committed.push(result); runDiagnostics.push(...diagnostics);
  } catch (error) { if (!(error instanceof ValidationError)) throw error; runDiagnostics.push(...error.issues); return Object.freeze({ status: "incomplete", runMetadata, requestedHorizon, stoppedAt: period.start, ...(committed.length === 0 ? {} : { reachedThrough: committed[committed.length - 1]!.period.end }), state, primitiveState, periods: Object.freeze(committed), diagnostics: Object.freeze(runDiagnostics) }); }
  return Object.freeze({ status: "completed", runMetadata, requestedHorizon, reachedThrough: requestedHorizon.end, state, primitiveState, periods: Object.freeze(committed), diagnostics: Object.freeze(runDiagnostics) });
};
export const createVerticalSlice4Id = <Kind extends string>(kind: Kind, value: string): DomainId<Kind> => domainId(kind, value);
