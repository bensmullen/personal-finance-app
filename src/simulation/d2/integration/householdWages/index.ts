import type { AccountingTransaction } from "../../../../accounting/index.js";
import { failValidation, issueCodes } from "../../../../diagnostics/index.js";
import { registerHouseholdEconomicOriginalAuthority, type HouseholdBankEventContext, type HouseholdDomainPostingEvidence,
  type HouseholdEconomicOriginalReference } from "../../../../state/index.js";
import { instant, type Instant, type Period } from "../../../../time/index.js";
import type { Money } from "../../../../values/index.js";
import { sha256 } from "../../../../rules/tax/t1b/contentIdentity.js";
import { immutableConfiguration } from "../../../r3/compiledHousehold.js";
import { canonicalSerialize } from "../../../run.js";
import { qualifyHouseholdBankRoute } from "../householdBank/index.js";
import type { RecurringIncomeStream } from "../../../verticalSlice2.js";
export type WageStreamOriginal = Omit<RecurringIncomeStream, "householdWageSource">;
export const wageStreamOriginal = ({ householdWageSource: _source, ...stream }: RecurringIncomeStream): WageStreamOriginal => stream;

export interface HouseholdWageSourceRef {
  readonly version: "household-wage-source/v1";
  readonly bank: { readonly publisherId: string; readonly sourceId: string };
  readonly original: HouseholdEconomicOriginalReference;
}
/** Reconstructed by the independent employer archive, including the complete
 * signed journal. No caller amount or transaction is sent to the publisher. */
export interface HouseholdWageOriginal {
  readonly stream: WageStreamOriginal;
  readonly sourceId: string; readonly revisionId: string;
  readonly publishedAt: Instant; readonly knownAt: Instant;
  readonly effectiveFrom: Instant; readonly effectiveUntil: Instant;
  readonly status: "active" | "withdrawn";
  readonly employerId: string; readonly householdId: string; readonly personId: string;
  readonly incomeId: string; readonly occurrenceId: string;
  readonly period: Period; readonly gross: Money;
  readonly bankAccountId: string; readonly transaction: AccountingTransaction;
}
export interface HouseholdWageOriginalProvider {
  readonly publisherId: string;
  readonly readOriginals: (query: { readonly sourceId: string; readonly context: HouseholdBankEventContext }) => {
    readonly version: "household-wage-inventory/v1";
    readonly publisherId: string; readonly sourceId: string;
    readonly context: HouseholdBankEventContext;
    readonly checkedAt: Instant; readonly completeThrough: Instant; readonly completeness: "complete";
    readonly originals: readonly HouseholdWageOriginal[];
  } | undefined;
}
const providers = new Map<string, HouseholdWageOriginalProvider>();
const same = (a: unknown, b: unknown) => canonicalSerialize(a) === canonicalSerialize(b);
const invalid = (): never => failValidation({ severity: "error", code: issueCodes.verticalSlice2InputInvalid,
  entityType: "vertical_slice_2", fieldPath: "incomes.householdWageSource", message: "HOUSEHOLD_WAGE_ORIGINAL_NOT_ADMITTED" });
function need(ok: boolean): asserts ok { if (!ok) invalid(); }
function sourceRead<T>(fn: () => T): T { try { return fn(); } catch { return invalid(); } }
/** Stable publication commitment. Distinct installment journals are freshly
 * reconstructed by the registered archive, never copied into every period. */
export const householdWageOriginalDigest = ({ transaction: _tx, gross: _gross, occurrenceId: _occurrence,
  period: _period, ...publication }: HouseholdWageOriginal): string => `sha256:${sha256(canonicalSerialize(publication))}`;
function read(ref: HouseholdEconomicOriginalReference, context: HouseholdBankEventContext) {
  instant(context.asOf); instant(context.dataCutoff); instant(context.eventAt);
  need(ref.version === "household-economic-original/v1" && ref.family === "wage" && context.direction === "credit" && context.dataCutoff <= context.asOf);
  const provider = providers.get(ref.publisherId);
  need(provider !== undefined);
  const h = immutableConfiguration(sourceRead(() => provider.readOriginals(immutableConfiguration({ sourceId: ref.sourceId, context }))));
  need(h !== undefined && h.version === "household-wage-inventory/v1" && h.publisherId === ref.publisherId && h.sourceId === ref.sourceId &&
    same(h.context, context) && h.completeness === "complete" && h.checkedAt === context.asOf && h.completeThrough === context.dataCutoff &&
    h.originals.length > 0 && h.originals.length <= 1200 && new Set(h.originals.map(o => o.revisionId)).size === h.originals.length);
  for (const o of h.originals) {
    instant(o.publishedAt); instant(o.knownAt); instant(o.effectiveFrom); instant(o.effectiveUntil);
    need(o.sourceId === ref.sourceId && o.revisionId.trim().length > 0 && o.publishedAt <= o.knownAt && o.effectiveFrom < o.effectiveUntil);
  }
  const eligible = h.originals.filter(o => o.publishedAt <= context.asOf && o.knownAt <= context.dataCutoff && o.effectiveFrom <= context.eventAt)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const publication = eligible[0];
  need(publication !== undefined && publication.status === "active" && publication.revisionId === ref.revisionId &&
    (eligible[1] === undefined || eligible[1].publishedAt !== publication.publishedAt) && publication.effectiveUntil > context.eventAt &&
    householdWageOriginalDigest(publication) === ref.digest);
  const original = publication;
  need(original.stream.id === original.incomeId && original.stream.ownerId === original.personId && original.stream.depositAccountId === original.bankAccountId &&
    original.householdId === context.householdId && original.personId === context.personId &&
    original.bankAccountId === context.bankAccountId && original.employerId.trim().length > 0 && original.personId !== original.householdId &&
    original.period.start <= context.eventAt && context.eventAt < original.period.end &&
    original.transaction.id === `tx:recognition:income:${original.incomeId}:${context.eventAt}` && original.transaction.id === context.eventId &&
    original.transaction.date === context.eventAt && ["income", "payroll_income"].includes(original.transaction.type) &&
    original.gross.isPositive() && original.gross.amount.fitsScale(2));
  const credits = original.transaction.legs.filter(l => l.type === "income"), cash = original.transaction.legs.filter(l => l.type === "cash");
  need(credits.length === 1 && credits[0]!.posting === "credit" && credits[0]!.amount.equals(original.gross) && cash.length <= 1 &&
    cash.every(l => l.posting === "debit" && l.accountId === context.bankAccountId && l.cashFlowClass === "operating") &&
    original.transaction.legs.every(l => !l.amount.isNegative() && l.amount.amount.fitsScale(2) && l.amount.currency.equals(original.gross.currency)));
  if (original.transaction.type === "income") need(original.transaction.legs.length === 2 && cash.length === 1 && cash[0]!.amount.equals(original.gross));
  return { original, witness: { original: ref, source: { kind: "organization" as const, id: original.employerId },
    payer: { kind: "organization" as const, id: original.employerId }, beneficiary: context.personId } };
}
export function registerHouseholdWageOriginalProvider(provider: HouseholdWageOriginalProvider): void {
  need(provider.publisherId.trim().length > 0 && !providers.has(provider.publisherId));
  const registered = Object.freeze({ publisherId: provider.publisherId, readOriginals: provider.readOriginals.bind(provider) });
  registerHouseholdEconomicOriginalAuthority("wage", provider.publisherId, { qualify: (ref, context) => {
    try { const { original, witness } = read(ref, context);
      return { witness, transaction: original.transaction, context, requiredFamilies: ["wage"] };
    } catch { return undefined; }
  } });
  providers.set(provider.publisherId, registered);
}
export function qualifyHouseholdWage(source: HouseholdWageSourceRef, context: HouseholdBankEventContext,
  expected: { readonly stream: WageStreamOriginal; readonly incomeId: string; readonly occurrenceId: string; readonly period: Period; readonly gross: Money; readonly transaction: AccountingTransaction },
): HouseholdDomainPostingEvidence {
  need(source.version === "household-wage-source/v1");
  const { original, witness } = read(source.original, context);
  need(same({ stream: original.stream, incomeId: original.incomeId, occurrenceId: original.occurrenceId, period: original.period, gross: original.gross, transaction: original.transaction }, expected));
  return immutableConfiguration({ version: "household-domain-posting/v1", context,
    route: qualifyHouseholdBankRoute(source.bank.publisherId, source.bank.sourceId, context), originals: [witness] });
}

/** Exclusivity admission uses employer publications, never stream labels or
 * trace references. Actual wage execution still checks its entire journal. */
export function qualifyDistinctWage(source: HouseholdWageSourceRef, stream: WageStreamOriginal, context: HouseholdBankEventContext): void {
  need(source.version === "household-wage-source/v1" && source.original.family === "wage");
  const provider = providers.get(source.original.publisherId);
  need(provider !== undefined);
  const h = immutableConfiguration(sourceRead(() => provider.readOriginals({ sourceId: source.original.sourceId, context })));
  need(h !== undefined && h.publisherId === source.original.publisherId && h.sourceId === source.original.sourceId && same(h.context, context) &&
    h.checkedAt === context.asOf && h.completeThrough === context.dataCutoff && h.completeness === "complete");
  const known = h.originals.filter(o => o.knownAt <= context.dataCutoff && o.publishedAt <= context.asOf &&
    o.effectiveFrom <= context.eventAt).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const doc = known[0];
  need(doc !== undefined && doc.status === "active" && doc.incomeId === stream.id && same(doc.stream, stream) && doc.personId === context.personId &&
    doc.householdId === context.householdId && doc.bankAccountId === context.bankAccountId);
  need(doc.period.start <= context.eventAt && context.eventAt < doc.period.end);
  const actual = { ...context, eventAt: doc.transaction.date, eventId: doc.transaction.id };
  const admitted = read(source.original, actual);
  need(admitted.original.incomeId === stream.id && same(admitted.original.stream, stream));
  qualifyHouseholdBankRoute(source.bank.publisherId, source.bank.sourceId, actual);
}
