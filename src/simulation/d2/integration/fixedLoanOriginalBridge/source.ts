import { failValidation } from "../../../../diagnostics/index.js";
import { sha256 } from "../../../../rules/tax/t1b/contentIdentity.js";
import { registerFixedLoanPostingAuthority } from "../../../../state/index.js";
import { instant, utcMonthlyOccurrences, type Instant } from "../../../../time/index.js";
import { Money, USD } from "../../../../values/index.js";
import { immutableConfiguration } from "../../../r3/compiledHousehold.js";
import { canonicalSerialize, runId, scenarioId, type RunContext } from "../../../run.js";
import type { ExtraPrincipalPayment, FixedAmortizingLoan, VerticalSlice4Input } from "../../../verticalSlice4.js";
import { checkHouseholdBankDebitAdmission } from "../householdBank/index.js";
import { observeFixedLoanOriginal } from "./observation.js";

export interface FixedLoanOriginalReference {
  readonly version: "fixed-loan-original-reference/v1";
  readonly publisherId: string;
  readonly lenderId: string;
  readonly lenderAccountId: string;
  readonly contractSourceId: string;
}

export interface FixedLoanOriginalQuery {
  readonly reference: FixedLoanOriginalReference;
  readonly runId: RunContext["runId"];
  readonly scenarioId: RunContext["scenarioId"];
  readonly asOf: Instant;
  readonly dataCutoff: Instant;
  readonly eventAt: Instant;
}

interface Revision {
  readonly revisionId: string;
  readonly publishedAt: Instant;
  readonly knownAt: Instant;
  readonly effectiveFrom: Instant;
  readonly effectiveUntil: Instant;
}

type HistoryEntry<T> = Revision & (
  | { readonly status: "active"; readonly original: T }
  | { readonly status: "withdrawn" }
);

export interface FixedLoanContractOriginal {
  readonly reference: FixedLoanOriginalReference;
  readonly householdId: VerticalSlice4Input["householdId"];
  readonly borrowerId: VerticalSlice4Input["ownerId"];
  readonly loanId: FixedAmortizingLoan["id"];
  readonly legalOwnerId: FixedAmortizingLoan["ownerId"];
  readonly principalLiabilityId: FixedAmortizingLoan["principalLiabilityId"];
  readonly interestPayableLiabilityId: FixedAmortizingLoan["interestPayableLiabilityId"];
  readonly debtFamily: NonNullable<FixedAmortizingLoan["debtFamily"]>;
  readonly originalPrincipal: Money;
  readonly annualRate: FixedAmortizingLoan["annualRate"];
  readonly totalPayments: number;
  readonly paymentSchedule: FixedAmortizingLoan["paymentSchedule"];
}

export interface FixedLoanPaymentOriginal {
  readonly sourceId: string;
  readonly contractSourceId: string;
  readonly eventAt: Instant;
  readonly taxYear: number;
  readonly contractualPayment: Money;
  readonly currentInterest: Money;
  readonly interestDue: Money;
  readonly principalDue: Money;
  readonly bank: { readonly publisherId: string; readonly sourceId: string; readonly accountId: string };
  readonly extra?: { readonly instructionId: string; readonly authorizedAmount: Money };
}

export interface FixedLoanOriginalInventory {
  readonly version: "fixed-loan-original-inventory/v1";
  readonly query: FixedLoanOriginalQuery;
  readonly checkedAt: Instant;
  readonly completeThrough: Instant;
  readonly completeness: "complete";
  readonly contractHistory: readonly HistoryEntry<FixedLoanContractOriginal>[];
  readonly paymentHistory: readonly HistoryEntry<FixedLoanPaymentOriginal>[];
}

export interface FixedLoanOriginalProvider {
  readonly publisherId: string;
  readonly readOriginals: (query: FixedLoanOriginalQuery) => FixedLoanOriginalInventory | undefined;
}

const providers = new Map<string, FixedLoanOriginalProvider["readOriginals"]>();
const named = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const same = (a: unknown, b: unknown): boolean => canonicalSerialize(a) === canonicalSerialize(b);

export function rejectFixedLoanOriginal(message: string): never {
  return failValidation({ severity: "error", code: "FIXED_LOAN_ORIGINAL_NOT_ADMITTED", entityType: "fixed_loan_original", message });
}

function requireOriginal(condition: boolean, message: string): asserts condition {
  if (!condition) rejectFixedLoanOriginal(message);
}

export function registerFixedLoanOriginalProvider(provider: FixedLoanOriginalProvider): void {
  requireOriginal(named(provider.publisherId) && !providers.has(provider.publisherId), "Expected a unique lender original publisher");
  if (providers.size === 0) registerFixedLoanPostingAuthority((e, tx) => {
    const c = e.context;
    const qualified = qualifyFixedLoanOriginal({ reference: e.original, runId: runId(c.runId), scenarioId: scenarioId(c.scenarioId),
      asOf: c.asOf, dataCutoff: c.dataCutoff, eventAt: c.eventAt });
    const contract = qualified.contract.original, payment = qualified.payment.original, k = e.classification;
    if (qualified.digest !== e.inventoryDigest || qualified.contract.revisionId !== e.contractRevisionId ||
        qualified.payment.revisionId !== e.paymentRevisionId || payment.sourceId !== e.paymentSourceId ||
        contract.loanId !== e.loanId || contract.debtFamily !== e.family || contract.legalOwnerId !== e.legalOwnerId ||
        contract.borrowerId !== c.personId || contract.householdId !== c.householdId || payment.bank.accountId !== c.bankAccountId ||
        !utcMonthlyOccurrences(contract.paymentSchedule.anchor, e.period, contract.paymentSchedule.invalidDayPolicy).includes(c.eventAt))
      return false;
    const interest = k.kind === "interest_recognition" || k.kind === "interest_settlement";
    if (e.liabilityId !== (interest ? contract.interestPayableLiabilityId : contract.principalLiabilityId)) return false;
    if (k.kind === "interest_recognition") return e.amount.equals(payment.currentInterest) && e.authorizedTotal.equals(payment.currentInterest);
    if (k.route.publisherId !== payment.bank.publisherId || k.route.sourceId !== payment.bank.sourceId) return false;
    const bank = checkHouseholdBankDebitAdmission(payment.bank.publisherId, payment.bank.sourceId, c);
    if (bank.kind !== "qualified" || bank.inventoryDigest !== k.bankInventoryDigest || !same(bank.pin, k.route)) return false;
    if (k.kind === "extra_principal") return payment.extra !== undefined &&
      c.eventId === `liability-extra:${payment.extra.instructionId}:${e.occurrenceId}` &&
      tx.id === `tx:extra-principal:${payment.extra.instructionId}:${c.eventAt}` &&
      e.claimId === `right:extra-principal:${payment.extra.instructionId}:${c.eventAt}` &&
      e.recognitionId === `recognition:extra-principal-option:${payment.extra.instructionId}:${c.eventAt}` &&
      e.authorizedTotal.equals(payment.extra.authorizedAmount);
    return e.authorizedTotal.equals(interest ? payment.interestDue : payment.principalDue);
  });
  providers.set(provider.publisherId, provider.readOriginals.bind(provider));
}

function selectRevision<T>(history: readonly HistoryEntry<T>[], query: FixedLoanOriginalQuery): HistoryEntry<T> & { readonly status: "active" } {
  requireOriginal(Array.isArray(history) && history.length > 0, "Missing original revision history");
  const revisions = new Set<string>(), publications = new Set<Instant>();
  let latest: HistoryEntry<T> | undefined;
  for (const entry of history) {
    requireOriginal(named(entry.revisionId) && !revisions.has(entry.revisionId) && !publications.has(entry.publishedAt) &&
      (entry.status === "active" || entry.status === "withdrawn") &&
      [entry.publishedAt, entry.knownAt, entry.effectiveFrom, entry.effectiveUntil].every(at => instant(at) === at) &&
      entry.publishedAt <= entry.knownAt && entry.effectiveFrom < entry.effectiveUntil, "Invalid or ambiguous original revision history");
    revisions.add(entry.revisionId);
    publications.add(entry.publishedAt);
    if (entry.effectiveFrom > query.eventAt) continue;
    requireOriginal(entry.publishedAt <= query.asOf && entry.knownAt <= query.dataCutoff, "Applicable original revision was late-known");
    if (latest === undefined || latest.publishedAt < entry.publishedAt) latest = entry;
  }
  requireOriginal(latest?.status === "active" && query.eventAt < latest.effectiveUntil, "Missing, expired or withdrawn original");
  return latest;
}

const postedUsd = (amount: Money): boolean => amount instanceof Money && amount.currency.equals(USD) &&
  !amount.isNegative() && amount.amount.fitsScale(USD.minorUnitScale);

export function qualifyFixedLoanOriginal(query: FixedLoanOriginalQuery) {
  const { reference } = query;
  requireOriginal(reference.version === "fixed-loan-original-reference/v1" &&
    [reference.publisherId, reference.lenderId, reference.lenderAccountId, reference.contractSourceId, query.runId, query.scenarioId].every(named) &&
    [query.eventAt, query.asOf, query.dataCutoff].every(at => instant(at) === at) && query.dataCutoff <= query.asOf,
  "Invalid fixed loan original query");
  const read = providers.get(reference.publisherId);
  requireOriginal(read !== undefined, "Lender original publisher unavailable");
  let fetched: FixedLoanOriginalInventory | undefined;
  try {
    fetched = read(immutableConfiguration(query));
  } catch {
    return rejectFixedLoanOriginal("Lender original publisher read failed");
  }
  requireOriginal(fetched !== undefined, "Lender originals unavailable");
  const inventory = immutableConfiguration(fetched);
  requireOriginal(inventory.version === "fixed-loan-original-inventory/v1" && inventory.completeness === "complete" &&
    inventory.checkedAt === query.asOf && inventory.completeThrough === query.dataCutoff && same(inventory.query, query),
  "Lender originals do not cover the exact run observation");
  const contract = selectRevision(inventory.contractHistory, query);
  const payment = selectRevision(inventory.paymentHistory, query);
  for (const revision of inventory.contractHistory) {
    if (revision.status === "withdrawn") continue;
    requireOriginal(same(revision.original, contract.original), "Contract history changed fixed loan identity or terms");
  }
  const scheduled = payment.original;
  for (const revision of inventory.paymentHistory) {
    if (revision.status === "withdrawn") continue;
    const original = revision.original;
    requireOriginal(original.sourceId === scheduled.sourceId && original.contractSourceId === reference.contractSourceId &&
      original.eventAt === query.eventAt && original.taxYear === Number(query.eventAt.slice(0, 4)), "Payment history includes a different occurrence or tax year");
    requireOriginal([original.bank.publisherId, original.bank.sourceId, original.bank.accountId].every(named) &&
      [original.contractualPayment, original.currentInterest, original.interestDue, original.principalDue].every(postedUsd) &&
      (original.extra === undefined || named(original.extra.instructionId) && postedUsd(original.extra.authorizedAmount) &&
        original.extra.authorizedAmount.isPositive()), "Invalid lender payment revision");
  }
  requireOriginal(same(contract.original.reference, reference) && named(scheduled.sourceId) &&
    postedUsd(contract.original.originalPrincipal) && contract.original.originalPrincipal.isPositive() &&
    Number.isSafeInteger(contract.original.totalPayments) && contract.original.totalPayments > 0,
  "Invalid lender contract or payment identity");
  const byPublication = <T>(a: HistoryEntry<T>, b: HistoryEntry<T>): number => a.publishedAt < b.publishedAt ? -1 : 1;
  const digest = `sha256:${sha256(canonicalSerialize({
    contract: [...inventory.contractHistory].sort(byPublication), payment: [...inventory.paymentHistory].sort(byPublication),
  }))}`;
  observeFixedLoanOriginal(`lender:${canonicalSerialize(query)}`, digest);
  return Object.freeze({ contract, payment, digest });
}

export interface FixedLoanCalculatedService {
  readonly contractualPayment: Money;
  readonly currentInterest: Money;
  readonly interestDue: Money;
  readonly principalDue: Money;
  readonly extraInstruction: ExtraPrincipalPayment | undefined;
}

/** The evaluators calculate these amounts independently before consulting the lender. */
export function qualifyCalculatedFixedLoanService(
  reference: FixedLoanOriginalReference,
  context: RunContext,
  at: Instant,
  input: Pick<VerticalSlice4Input, "householdId" | "ownerId" | "baseCurrency">,
  loan: FixedAmortizingLoan,
  calculated: FixedLoanCalculatedService,
) {
  const original = qualifyFixedLoanTerms(reference, context, at, input, loan);
  const payment = original.payment.original;
  requireOriginal(payment.contractualPayment.equals(calculated.contractualPayment) && payment.currentInterest.equals(calculated.currentInterest) &&
    payment.interestDue.equals(calculated.interestDue) && payment.principalDue.equals(calculated.principalDue),
  "Calculated debt service differs from the lender payment original");
  checkExtraInstruction(payment, calculated.extraInstruction);
  return original;
}

function qualifyFixedLoanTerms(reference: FixedLoanOriginalReference, context: RunContext, at: Instant,
  input: Pick<VerticalSlice4Input, "householdId" | "ownerId" | "baseCurrency">, loan: FixedAmortizingLoan) {
  const original = qualifyFixedLoanOriginal({ reference, eventAt: at, runId: context.runId,
    scenarioId: context.scenarioId, asOf: context.asOf, dataCutoff: context.dataCutoff });
  const contract = original.contract.original;
  requireOriginal(input.baseCurrency.equals(USD) && context.baseCurrency.equals(USD) &&
    contract.householdId === input.householdId && contract.borrowerId === input.ownerId &&
    contract.loanId === loan.id && contract.legalOwnerId === loan.ownerId &&
    contract.principalLiabilityId === loan.principalLiabilityId && contract.interestPayableLiabilityId === loan.interestPayableLiabilityId &&
    contract.debtFamily === (loan.debtFamily ?? "mortgage") && contract.originalPrincipal.equals(loan.originalPrincipal) &&
    same(contract.annualRate, loan.annualRate) && contract.totalPayments === loan.totalPayments && same(contract.paymentSchedule, loan.paymentSchedule),
  "Loan identity or fixed terms differ from the lender original");
  return original;
}

function checkExtraInstruction(payment: FixedLoanPaymentOriginal, instruction: ExtraPrincipalPayment | undefined): void {
  requireOriginal(instruction === undefined ? payment.extra === undefined :
    payment.extra !== undefined && payment.extra.instructionId === instruction.id &&
    payment.extra.authorizedAmount.equals(instruction.amount), "Extra principal instruction differs from the lender authorization");
}

export function qualifyFixedLoanExtra(loan: FixedAmortizingLoan,
  input: Pick<VerticalSlice4Input, "householdId" | "ownerId" | "baseCurrency">, context: RunContext, instruction: ExtraPrincipalPayment) {
  if (loan.originalSource === undefined) return undefined;
  const original = qualifyFixedLoanTerms(loan.originalSource, context, instruction.scheduledAt, input, loan);
  checkExtraInstruction(original.payment.original, instruction);
  return original;
}
