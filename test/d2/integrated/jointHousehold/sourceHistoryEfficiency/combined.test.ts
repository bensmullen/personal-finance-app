import { describe, expect, it } from "vitest";
import { accountingTransactionId } from "../../../../../src/accounting/index.js";
import { domainId } from "../../../../../src/identity/index.js";
import { createAuthoritativeState, type AuthoritativeState, type HouseholdBankEventContext } from "../../../../../src/state/index.js";
import { civilDate, instant, utcMonthlyPeriods } from "../../../../../src/time/index.js";
import { Money, money } from "../../../../../src/values/index.js";
import { applyHouseholdExecutionOverlay, replayHouseholdForecastWindow, runHouseholdKernel,
  type HouseholdForecastSummaryResult } from "../../../../../src/simulation/householdExecution.js";
import type { PerformanceObserver } from "../../../../../src/diagnostics/index.js";
import { canonicalSerialize, createInputFingerprint } from "../../../../../src/simulation/run.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact,
  type ReplayExportMeasurement, type ReplayRestoreMeasurement } from "../../../../../src/simulation/r3/replayArtifact.js";
import { attachFsaCash, fsaCashSourceFingerprint, registerFsaCashSourceProvider, type FsaCashSource } from "../../../../../src/simulation/d2/integration/fsaCash/index.js";
import { depositOperationId, originalOperationId } from "../../../../../src/simulation/d2/integration/fsaCash/source.js";
import { attachCardBank, registerCardBankSourcePort, type CardBankDocument } from "../../../../../src/simulation/d2/integration/cardBank/index.js";
import { attachHelocServicing } from "../../../../../src/simulation/d2/integration/helocServicing/index.js";
import { registerHouseholdBankOriginalProvider } from "../../../../../src/simulation/d2/integration/householdBank/index.js";
import { registerFixedLoanOriginalProvider, type FixedLoanContractOriginal, type FixedLoanPaymentOriginal } from "../../../../../src/simulation/d2/integration/fixedLoanOriginalBridge/source.js";
import { attachRetirementCash, evaluateFundedRmdSatisfaction } from "../../../../../src/simulation/d2/integration/retirementCash/index.js";
import { fsaScopeId } from "../../../../../src/simulation/d2/health/fsa/index.js";
import { document, fixture as cardFixture, ids as cardIds } from "../../cardBank/scenario.js";
import { fixture as fsaFixture, provenance, source, ids as fsaIds } from "../../fsaCash/scenario.js";
import { fixture as loanFixture } from "../../fixedLoanOriginalBridge/scenario.js";
import { originalFacts, ids as bankIds } from "../../householdBankAuthority/scenario.js";
import { documents, ids as helocIds, publisher, registerPublisher } from "../../helocServicing/scenario.js";
import { funded, sources as retirementSources } from "../../retirementCash/fundedScenario.js";
import { fixture as retirementFixture, ids as retirementIds } from "../../retirementCash/scenario.js";
import { attachSsaMedicare, registerNativeSsaMedicareOriginalProviders, registerSsaMedicareOriginalSources,
  type NativeSsaMedicareOccurrence } from "../../../../../src/simulation/d2/integration/ssaMedicare/index.js";
import type { MedicareInstallmentOriginal, SsaInstallmentOriginal } from "../../../../../src/simulation/d2/integration/ssaMedicare/nativeHouseholdOriginalBridge/index.js";
import { irmaaOriginalDigest, proposeOriginalIrmaa } from "../../../../../src/simulation/d2/health/medicare/originalBinding/index.js";
import { ssaOriginalDigest } from "../../../../../src/simulation/d2/retirement/benefits/ssaOriginalBinding/index.js";
import { cutoff as publicationDate, originalPayment, providers as domainPublishers, control as ssaPublisher,
  resetSources } from "../../ssaMedicare/originalScenario.js";
import { fixture as ssaFixture, ids } from "../../ssaMedicare/scenario.js";

const testId = (index: number) => `34800000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const bytes = (value: unknown) => new TextEncoder().encode(canonicalSerialize(value)).byteLength;

function mapDocument<T>(value: T, change: (field: string) => string): T {
  const visit = (field: unknown): unknown => {
    if (typeof field === "string") return change(field);
    if (field === null || typeof field !== "object") return field;
    if (Array.isArray(field)) return field.map(visit);
    if (Object.getPrototypeOf(field) !== Object.prototype) return field;
    return Object.fromEntries(Object.entries(field).map(([key, child]) => [key, visit(child)]));
  };
  return visit(value) as T;
}

const scope = (from: { household: string; person: string }, value: string) =>
  value.replaceAll(from.household, ids.household).replaceAll(from.person, ids.person);

const families = ["fsa", "fsaBank", "card", "cardBank", "helocIssuer", "helocBank", "lender", "loanBank",
  "ssaAward", "irmaa", "ssaInstallment", "medicareInstallment", "ssaBank"] as const;
type Family = typeof families[number];
interface SourceWork { count: number; bytes: number; consumedEnvelopeBytes: number }
const reads = new Map<Family, SourceWork>();
function meterEnvelope<T>(original: T, complete: () => void): T {
  let pending = 1;
  function visit(value: unknown): unknown {
    if (value === null || typeof value !== "object" || value instanceof Money ||
        !Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) {
      if (--pending === 0) complete();
      return value;
    }
    const fields = Object.entries(value).filter(([, child]) => child !== undefined);
    pending += fields.length - 1;
    if (pending === 0) complete();
    const copy = Array.isArray(value) ? [...value] : { ...value };
    for (const [field, child] of fields) {
      let consumed = false, result: unknown;
      Object.defineProperty(copy, field, { enumerable: true, get() {
        if (!consumed) {
          consumed = true;
          result = visit(child);
        }
        return result;
      } });
    }
    return copy;
  }
  return visit(original) as T;
}
function observe<T>(family: Family, original: T | undefined): T | undefined {
  if (original === undefined) return undefined;
  const stats = reads.get(family) ?? { count: 0, bytes: 0, consumedEnvelopeBytes: 0 };
  const size = bytes(original);
  stats.count++;
  stats.bytes += size;
  reads.set(family, stats);
  // Each observation gets its own meter. Only a full consumer traversal
  // earns the envelope's bytes. Report the cumulative HELOC issuer payload
  // separately, where per-row meter overhead would dominate the fixture.
  return family === "helocIssuer" ? original : meterEnvelope(original, () => { stats.consumedEnvelopeBytes += size; });
}

const fsa = new Map<string, FsaCashSource>();
const cards = new Map<string, CardBankDocument>();
registerFsaCashSourceProvider({ lookup: id => observe("fsa", fsa.get(id)) }, "348-fsa-plan");
registerCardBankSourcePort({ read: id => observe("card", cards.get(id)), householdPublisherId: "348-card-issuer" });
registerPublisher();
registerSsaMedicareOriginalSources(domainPublishers);

const lenderId = "348-synthetic-lender";
const bankPublisherId = "348-independent-bank";
const bankRoutes = new Map<string, { accountId: string; family: Family; directions: readonly HouseholdBankEventContext["direction"][] }>([
  ["348-loan-bank-route", { accountId: bankIds.bank, family: "loanBank", directions: ["debit"] }],
  ["348-card-bank-route", { accountId: cardIds.bank, family: "cardBank", directions: ["debit"] }],
  ["348-fsa-bank-route", { accountId: fsaIds.bank, family: "fsaBank", directions: ["debit", "credit"] }],
  ["348-ssa-bank-route", { accountId: ids.bank, family: "ssaBank", directions: ["credit"] }],
]);
const publishedAt = instant("2025-01-01T00:00:00.000Z");
const revision = { status: "active", publishedAt, knownAt: publishedAt, effectiveFrom: publishedAt,
  effectiveUntil: instant("2030-01-01T00:00:00.000Z") } as const;
const lender = new Map<string, FixedLoanContractOriginal>();
const installments = new Map<string, FixedLoanPaymentOriginal>();
registerFixedLoanOriginalProvider({ publisherId: lenderId, readOriginals(query) {
  const contract = lender.get(query.reference.contractSourceId);
  const payment = installments.get(query.eventAt);
  if (!contract || !payment) return undefined;
  return observe("lender", { version: "fixed-loan-original-inventory/v1", query,
    checkedAt: query.asOf, completeThrough: query.dataCutoff, completeness: "complete",
    contractHistory: [{ ...revision, revisionId: "contract-v1", original: contract }],
    paymentHistory: [{ ...revision, revisionId: "payment-v1", original: payment }] } as const);
} });
registerHouseholdBankOriginalProvider({ publisherId: bankPublisherId, readOriginals(query) {
  const route = bankRoutes.get(query.sourceId);
  if (!route || query.context.personId !== ids.person || query.context.householdId !== ids.household ||
      query.context.bankAccountId !== route.accountId || !route.directions.some(direction => direction === query.context.direction)) return undefined;
  const originals = mapDocument(originalFacts(query), value =>
    value.replaceAll(bankIds.household, ids.household).replaceAll(bankIds.bank, route.accountId));
  return observe(route.family, { version: "household-bank-original-inventory/v1", publisherId: bankPublisherId,
    query, checkedAt: query.context.asOf, completeThrough: query.context.dataCutoff, completeness: "complete",
    originals } as const);
} });

const ssaPublisherId = "348-ssa-installments";
const medicarePublisherId = "348-cms-installments";
const benefitOriginals = new Map<string, { event: NativeSsaMedicareOccurrence; ssa: SsaInstallmentOriginal;
  medicare: MedicareInstallmentOriginal }>();
let unavailableBenefit = "";

function readBenefit<K extends "ssa" | "medicare">(family: K, context: HouseholdBankEventContext) {
  const issued = benefitOriginals.get(context.eventId);
  if (!issued || unavailableBenefit === context.eventId || issued.event.eventAt !== context.eventAt ||
      issued.event.personId !== context.personId || context.householdId !== ids.household ||
      context.direction !== "credit" || issued.event.bankAccountId !== context.bankAccountId) return undefined;
  const { eventId, eventAt, personId } = issued.event;
  return observe(family === "ssa" ? "ssaInstallment" : "medicareInstallment", {
    event: { eventId, eventAt, personId, householdId: ids.household },
    checkedAt: context.asOf, completeThrough: context.dataCutoff, completeness: "complete" as const,
    originals: [{ id: `${family}:${eventId}`, revision: "1", issuer: family === "ssa" ? "SSA" : "CMS",
      publishedAt: publicationDate, knownAt: publicationDate, status: "active" as const, document: issued[family] }],
  });
}
registerNativeSsaMedicareOriginalProviders({
  ssa: { publisherId: ssaPublisherId, readOriginals: context => readBenefit("ssa", context) },
  medicare: { publisherId: medicarePublisherId, readOriginals: context => readBenefit("medicare", context) },
});

function publishBenefit(month: string, dataCutoff: HouseholdBankEventContext["dataCutoff"]): NativeSsaMedicareOccurrence {
  const { c2, payable, deductions, originalSources } = originalPayment(month);
  const { ssa: award, irmaa } = originalSources!;
  const cutoff = civilDate(dataCutoff.slice(0, 10));
  const history = domainPublishers.ssa.find(publisher => publisher.publisherId === award.publisherId)?.readOriginals({
    sourceId: award.sourceId, householdId: ids.household, recipientPersonId: ids.person, knownAt: cutoff, dataCutoff: cutoff,
  });
  const publication = history?.originals.find(original => original.originalId === award.originalId);
  if (!publication) throw new Error("Combined SSA award original unavailable");
  // Issue both installments against the shared observation cutoff from
  // the independent original book and the real award/surcharge producers.
  const queries = irmaa.map(({ query }) => ({ ...query, knownAt: dataCutoff }));
  const result = proposeOriginalIrmaa({ events: queries, originals: domainPublishers.irmaa, deaths: [] });
  if (result.diagnostics.length || result.candidates.length !== queries.length)
    throw new Error("Combined CMS original inventory did not qualify");
  const event = { eventId: `ssa-medicare:${payable.paymentId}`, eventAt: payable.paymentAt,
    personId: ids.person, bankAccountId: ids.bank, ssaPublisherId, medicarePublisherId };
  benefitOriginals.set(event.eventId, {
    event,
    ssa: { recipient: publication.recipient, award: { ...award, dataCutoff: cutoff, digest: ssaOriginalDigest(publication) },
      payableSource: payable.source, withholding: { awardId: payable.awardId, workerRecordId: payable.workerRecordId,
        entitlementId: payable.entitlementId, amount: money("0"), source: payable.taxWithholding.source },
      bank: { publisherId: bankPublisherId, sourceId: "348-ssa-bank-route" } },
    medicare: { premiums: c2.premiums, inventories: c2.inventories, irmaa: c2.irmaa, deductionTerms: c2.deductionTerms,
      surchargeOriginals: result.candidates.map(candidate => ({
        query: queries.find(query => query.part === candidate.part)!, candidateDigest: irmaaOriginalDigest(candidate),
      })),
      instructions: deductions.map(({ terms }) => ({
        part: terms.premium.part === "part_b" ? "part_b" : "part_d",
        premiumSource: terms.premium.source, authorizationSource: terms.source,
      })),
    },
  });
  return event;
}

function cardOriginal(index: number): CardBankDocument {
  const seed = document(), statement = seed.request.cards[0]!;
  const distinct = new Set([seed.sourceId, seed.statementId, seed.quoteId, seed.sourceApprovalId,
    seed.charge.evidenceId, seed.charge.operationId, statement.statementSource.ruleSnapshotId, statement.payment.operationId,
    seed.payment.approvalId, seed.payment.authorizationId, seed.payment.paymentId, seed.payment.settlementId]);
  return mapDocument(seed, value => {
    if (distinct.has(value)) return `${value}:${index}`;
    if (value === cardIds.card) return testId(index);
    return scope(cardIds, value).replace(/^2026-(\d{2})-(\d{2})/, (_date, month: string, day: string) => {
      const offset = index + Number(month) - 1;
      const last = new Date(Date.UTC(2026, offset + 1, 0)).getUTCDate();
      return new Date(Date.UTC(2026, offset, Math.min(Number(day), last))).toISOString().slice(0, 10);
    });
  });
}

function combined(count: number) {
  resetSources();
  benefitOriginals.clear();
  unavailableBenefit = "";
  fsa.clear(); cards.clear(); lender.clear(); installments.clear(); retirementSources.clear();
  const native = ssaFixture(count + 1, createAuthoritativeState({
    accounts: { [ids.bank]: { id: ids.bank, kind: "checking", ownerId: ids.household, cash: money("2000") } },
  }), "2026-01");
  const context = { ...native.context, asOf: instant("2029-01-01T00:00:00.000Z"),
    dataCutoff: instant("2029-01-01T00:00:00.000Z") };
  const periods = utcMonthlyPeriods(context.simulationStart, count + 1);
  const events = periods.slice(0, count).map(period => publishBenefit(period.start.slice(0, 7), context.dataCutoff));
  const helocs = mapDocument(documents(count, true), value => scope(helocIds, value));
  const issuer = new Map(helocs.map(pair => [pair.issuer.sourceId, pair.issuer]));
  const bank = new Map(helocs.map(pair => [pair.bank.id, pair.bank]));
  publisher.issuer = id => observe("helocIssuer", issuer.get(id));
  publisher.bank = id => observe("helocBank", bank.get(id));
  const loan = loanFixture("auto", "growth", count).input.loans[0]!;
  const originalSource = { ...loan.originalSource!, publisherId: lenderId };
  const fixed = { ...loan, originalSource, ownerId: ids.person };
  lender.set(originalSource.contractSourceId, { reference: originalSource, householdId: ids.household, borrowerId: ids.person,
    loanId: fixed.id, legalOwnerId: fixed.ownerId, principalLiabilityId: fixed.principalLiabilityId,
    interestPayableLiabilityId: fixed.interestPayableLiabilityId, debtFamily: "auto", originalPrincipal: money(String(count)),
    annualRate: fixed.annualRate, totalPayments: count, paymentSchedule: fixed.paymentSchedule });
  for (const [index, period] of periods.slice(0, count).entries()) {
    const month = period.start.slice(0, 7);
    const eventAt = instant(`${month}-15T00:00:00.000Z`);
    installments.set(eventAt, { sourceId: `installment:${month}`, contractSourceId: originalSource.contractSourceId, eventAt,
      taxYear: Number(month.slice(0, 4)), contractualPayment: money("1"), currentInterest: money("0"),
      interestDue: money("0"), principalDue: money("1"),
      bank: { publisherId: bankPublisherId, sourceId: "348-loan-bank-route", accountId: bankIds.bank } });
    // Each synthetic job has a separate health FSA plan and allocation scope.
    const year = month.slice(0, 4);
    const original = source(month, "1000", `${month}-10`, `${month}-16`);
    const originalScope = fsaScopeId(original.request.plan);
    const identity = { householdId: ids.household, personId: ids.person, employerId: `employer:${index}`,
      planId: `plan:${index}`, planYearId: year };
    const planScope = fsaScopeId(identity);
    const datedFields = new Map([
      ["2026-01-01", `${year}-01-01`], ["2027-01-01", `${Number(year) + 1}-01-01`],
      ["2027-04-01", `${Number(year) + 1}-04-01`], ["2026", year],
    ]);
    const raw = mapDocument(original, value => datedFields.get(value) ?? scope(fsaIds, value
      .replaceAll(encodeURIComponent(originalScope), encodeURIComponent(planScope))
      .replaceAll(originalScope, planScope)
      .replaceAll("health_fsa_law:2026", `health_fsa_law:${year}`)
      .replaceAll("synthetic-employer", identity.employerId).replaceAll("synthetic-plan", identity.planId)));
    const card = cardOriginal(index);
    const request: FsaCashSource["request"] = { ...raw.request, receipts: raw.request.receipts.map(receipt => ({ ...receipt,
      destination: { ...receipt.destination!, ownerId: ids.household, householdBank: true },
    })) };
    const fsaEvent = (eventId: string, eventAt: HouseholdBankEventContext["eventAt"],
      direction: HouseholdBankEventContext["direction"]): HouseholdBankEventContext => ({
      runId: context.runId, asOf: context.asOf, dataCutoff: context.dataCutoff,
      householdId: ids.household, personId: ids.person, bankAccountId: fsaIds.bank, eventId, eventAt, direction,
    });
    fsa.set(raw.sourceId, { ...raw, request, provenance: provenance(request), deposit: { ...raw.deposit, ownerId: ids.household },
      householdBank: { bankPublisherId, bankSourceId: "348-fsa-bank-route",
        originalContext: fsaEvent(originalOperationId(raw), raw.original.paidAt, "debit"),
        settlementContext: fsaEvent(depositOperationId(raw), raw.deposit.settledAt, "credit") } });
    cards.set(card.sourceId, { ...card, householdBank: { runId: context.runId,
      bank: { publisherId: bankPublisherId, sourceId: "348-card-bank-route" } }, payment: { ...card.payment,
      bankCashBefore: money(String(6000n - 200n * BigInt(index))) } });
  }
  const retirementBase = retirementFixture(count + 1, undefined, "2026-01");
  const retirement = funded({ ...retirementBase, context }, "348-combined");
  const scopeRetirement = <T>(raw: T) => mapDocument(raw, value => value.replaceAll(retirementIds.household, ids.household)
    .replaceAll(retirementIds.person, ids.person));
  const retirementOriginal = scopeRetirement(retirement.raw);
  retirementSources.set(retirementOriginal.sourceId, retirementOriginal);
  const opening = createAuthoritativeState({ accounts: {
    ...native.state.accounts,
    [retirementIds.ira]: { id: retirementIds.ira, kind: "retirement", ownerId: ids.person, cash: money("1000") },
    [retirementIds.bank]: { id: retirementIds.bank, kind: "checking", ownerId: ids.person, cash: money("200") },
    [fsaIds.bank]: { id: fsaIds.bank, kind: "checking", ownerId: ids.household, cash: money("1500") },
    [cardIds.bank]: { id: cardIds.bank, kind: "checking", ownerId: ids.household, cash: money("6000") },
    [helocIds.bank]: { id: helocIds.bank, kind: "checking", ownerId: ids.person, cash: money("500") },
    [bankIds.bank]: { id: bankIds.bank, kind: "checking", ownerId: ids.household, cash: money("100") },
  }, liabilities: {
    [helocIds.principal]: { id: helocIds.principal, balance: money("1000") },
    [helocIds.charges]: { id: helocIds.charges, balance: money("0") },
    [fixed.principalLiabilityId]: { id: fixed.principalLiabilityId, balance: money(String(count)) },
    [fixed.interestPayableLiabilityId]: { id: fixed.interestPayableLiabilityId, balance: money("0") },
    ...Object.fromEntries([...cards.values()].map(({ payment }) =>
      [payment.cardAccountId, { id: domainId("liability", payment.cardAccountId), balance: money("1000") }])),
  } });
  const benefitKernel = attachSsaMedicare(native.kernel, {
    householdId: ids.household, personId: ids.person, payments: [], nativePayments: events,
  });
  const base = applyHouseholdExecutionOverlay(benefitKernel, { reconciledOpeningState: opening,
    liabilityInput: { householdId: ids.household, ownerId: ids.person, baseCurrency: context.baseCurrency, loans: [fixed] } });
  const servicing = attachHelocServicing(attachCardBank(attachFsaCash(base, {
    sources: [...fsa.values()].map(raw => ({ sourceId: raw.sourceId, expectedSource: fsaCashSourceFingerprint(raw) })),
  }), { sourceIds: [...cards.keys()] }), { sourceIds: [...issuer.keys()] });
  const { kernel } = attachRetirementCash(servicing, scopeRetirement(retirement.cash));
  return { kernel, context, fixed, helocs, periods, retirement, events };
}

function expectCommittedOriginals(state: AuthoritativeState, count: number): void {
  const ids = state.identities;
  const archive = state.d2PostedTransactions!;
  const receipts = Object.values(state.d2SettlementReceipts!);
  for (const receipt of receipts) {
    expect(archive[receipt.originalTransaction.id]?.transaction).toEqual(receipt.originalTransaction);
    expect(archive[receipt.paymentTransaction.id]?.transaction).toEqual(receipt.paymentTransaction);
    expect(ids.postedTransactionIds).toContain(receipt.originalTransaction.id);
    expect(ids.postedTransactionIds).toContain(receipt.paymentTransaction.id);
    expect(ids.recognitionIds).toContain(receipt.recognitionId);
    expect(ids.settlementIds).toContain(receipt.settlementId);
    if (receipt.kind === "fsa_paid_reimbursement") {
      expect(receipt.amount).toEqual(money("1000"));
      expect(receipt.eligibleExpense).toEqual(money("1000"));
      expect(receipt.entitlementConsumed).toEqual(money("1000"));
    } else if (receipt.kind === "card_interest_payment") {
      expect(receipt.amount).toEqual(money("200"));
      expect(receipt.principalAllocation).toEqual(money("180"));
      expect(receipt.interestAllocation).toEqual(money("20"));
      expect(receipt.feeAllocation).toEqual(money("0"));
    } else {
      expect(receipt.amount).toEqual(money("11"));
      expect(receipt.principalPaid).toEqual(money("10"));
      expect(receipt.interest).toEqual(money("1"));
      expect(receipt.fee).toEqual(money("0"));
      expect(receipt.source.method).toBe("issuer_quoted");
      continue;
    }
    expect(receipt.nativeHousehold?.original.originals.map(witness => witness.original.family))
      .toEqual([receipt.kind === "fsa_paid_reimbursement" ? "fsa" : "card"]);
    expect(receipt.nativeHousehold?.settlement.route?.publisherId).toBe(bankPublisherId);
  }
  for (const payment of Object.values(state.ssaMedicarePayments!)) {
    expect(payment.payable.grossPayable).toEqual(money("1500"));
    expect(payment.netBank).toEqual(money("1300"));
    expect(payment.requests.map(request => request.terms.amount)).toEqual([money("80"), money("120")]);
    expect(payment.nativeHousehold?.originals.map(witness => witness.original.family)).toEqual(["ssa", "medicare"]);
    expect(payment.nativeHousehold?.route?.publisherId).toBe(bankPublisherId);
    expect(archive[payment.transaction.id]?.transaction).toEqual(payment.transaction);
    expect(state.obligations[payment.right.id]?.settlementIds).toEqual([payment.rightSettlementId]);
    expect(ids.postedTransactionIds).toContain(payment.transaction.id);
  }
  const fixedProofs = Object.values(archive).flatMap(({ registration }) => registration.kind === "fixed_loan_original" ? [registration.evidence] : []);
  expect(fixedProofs).toHaveLength(count);
  for (const evidence of fixedProofs) {
    expect(evidence.original.publisherId).toBe(lenderId);
    expect(evidence.amount).toEqual(money("1"));
    const posting = evidence.classification;
    expect(posting.kind).toBe("principal_settlement");
    if (posting.kind === "principal_settlement") {
      expect(posting.route.publisherId).toBe(bankPublisherId);
      expect(state.obligations[evidence.claimId]?.settlementIds).toContain(posting.settlementId);
    }
    expect(ids.generatedOccurrenceKeys).toContain(evidence.occurrenceId);
  }
}

describe("combined independent FSA/card/SSA/HELOC/fixed loan original history", () => {
  it("posts 1/12/24 distinct installments with proportional non-HELOC publisher reads and bytes", () => {
    const measuredLinearFamilies = families.filter(family => family !== "helocIssuer");
    const baseline = new Map<string, SourceWork>();
    const structuralAt12 = new Map<string, number>();
    const limitReads = (phase: string, count: number, work: ReadonlyMap<Family, SourceWork> = reads) => {
      for (const family of measuredLinearFamilies) {
        const stats = work.get(family);
        expect(stats?.count, `${phase} ${family}`).toBeGreaterThanOrEqual(count);
        expect(stats?.consumedEnvelopeBytes, `${phase} ${family}`).toBeGreaterThan(0);
        const key = `${phase}:${family}`;
        if (count === 12) baseline.set(key, { ...stats! });
        if (count === 24) {
          expect(stats!.count, key).toBeLessThanOrEqual(2.5 * baseline.get(key)!.count);
          expect(stats!.bytes, key).toBeLessThanOrEqual(2.5 * baseline.get(key)!.bytes);
          expect(stats!.consumedEnvelopeBytes, key).toBeLessThanOrEqual(2.5 * baseline.get(key)!.consumedEnvelopeBytes);
        }
      }
    };
    let bytesAt12 = 0;
    let nodesAt12 = 0;
    const measurements: { count: number; phase: string; cpuMicroseconds: number; wallMs: number }[] = [];
    const measure = <T>(count: number, phase: string, run: () => T): T => {
      const cpuAtStart = process.cpuUsage();
      const started = performance.now();
      const result = run();
      const cpu = process.cpuUsage(cpuAtStart);
      measurements.push({ count, phase, cpuMicroseconds: cpu.user + cpu.system, wallMs: performance.now() - started });
      return result;
    };
    for (const count of [1, 12, 24]) {
      const { kernel, context, fixed, helocs, periods, retirement } = combined(count);
      const n = BigInt(count);
      const expectedCash = [money("1500"), money(String(6000n - 200n * n)), money(String(2000n + 1300n * n)),
        money(String(500n - 11n * n)), money(String(100n - n))];
      const intrinsicRows = helocs.reduce((sum, { issuer }) => sum + issuer.request.checkpoint.history.length, 0);
      const intrinsicBytes = helocs.reduce((sum, { issuer }) => sum + bytes(issuer), 0);
      expect(intrinsicRows).toBe(count === 24 ? 276 : count === 12 ? 66 : 0);
      let summary: HouseholdForecastSummaryResult | undefined;
      for (const tier of ["summary", "detail"] as const) {
        reads.clear();
        ssaPublisher.changeSsa = original => observe("ssaAward", original);
        ssaPublisher.changeInventory = (_family, original) => observe("irmaa", original);
        let beforeRelease: ReadonlyMap<Family, SourceWork> | undefined;
        const structural = new Map<string, number>();
        const observer: PerformanceObserver = { clock: { now: () => performance.now() },
          context: { runId: context.runId, dataClassification: "synthetic", modelCounts: { installments: count },
            executionLocation: "local_node", cacheState: "not_applicable" },
          sink: { record: measurement => {
            beforeRelease ??= new Map([...reads].map(([family, work]) => [family, { ...work }]));
            for (const counter of ["stateCurrencyEntriesChecked", "stateCurrencyIndexNodesVisited"]) {
              structural.set(counter, Math.max(structural.get(counter) ?? 0, measurement.resources?.structuralCounters?.[counter] ?? 0));
            }
          } } };
        const result = tier === "summary"
          ? (summary = measure(count, tier, () => runHouseholdKernel({ kernel, runContext: context }, observer)))
          : measure(count, tier, () => runHouseholdKernel({ kernel, runContext: context, resultTier: "detail" }, observer));
        expect(result.periods, JSON.stringify(result.diagnostics)).toHaveLength(count + 1);
        expect([fsaIds.bank, cardIds.bank, ids.bank, helocIds.bank, bankIds.bank]
          .map(id => result.state.accounts[id]!.cash)).toEqual(expectedCash);
        expect(result.state.liabilities[fixed.principalLiabilityId]!.balance.equals(money("0"))).toBe(true);
        expect(result.state.liabilities[helocIds.principal]!.balance.equals(money(String(1000n - 10n * n)))).toBe(true);
        expect([...cards.values()].map(({ payment }) => result.state.liabilities[payment.cardAccountId]!.balance))
          .toEqual(Array.from({ length: count }, () => money("820")));
        expect(Object.keys(result.state.d2SettlementReceipts ?? {})).toHaveLength(3 * count);
        expect(Object.keys(result.state.ssaMedicarePayments ?? {})).toHaveLength(count);
        expectCommittedOriginals(result.state, count);
        expect(Object.values(result.state.retirementDistributionAllocations ?? {})).toHaveLength(1);
        expect(result.state.accounts[retirementIds.ira]!.cash.equals(money("500"))).toBe(true);
        expect(result.state.accounts[retirementIds.bank]!.cash.equals(money("700"))).toBe(true);
        const j1 = evaluateFundedRmdSatisfaction(retirement.reference, result.state, context, context.simulationEnd);
        expect(j1.annual?.obligations[0]?.satisfied.equals(money("500"))).toBe(true);
        expect(result.outputCapabilities?.retirementTax?.status).toBe("incomplete");
        expect(result.state).toEqual(summary?.state);
        expect(result.periods.at(-1)!.netWorth.equals(money(String(
          11300n + 1088n * n - (1000n - 10n * n) - 820n * n,
        )))).toBe(true);
        for (const [counter, value] of structural) {
          const key = `${tier}:${counter}`;
          expect(value, key).toBeGreaterThan(0);
          if (count === 12) structuralAt12.set(key, value);
          if (count === 24) expect(value, key).toBeLessThanOrEqual(3 * structuralAt12.get(key)!);
        }
        expect(beforeRelease).toBeDefined();
        limitReads(`${tier} execution`, count, beforeRelease);
        const release = new Map<Family, SourceWork>();
        for (const [family, total] of reads) {
          const earlier = beforeRelease!.get(family);
          release.set(family, { count: total.count - (earlier?.count ?? 0), bytes: total.bytes - (earlier?.bytes ?? 0),
            consumedEnvelopeBytes: total.consumedEnvelopeBytes - (earlier?.consumedEnvelopeBytes ?? 0) });
        }
        limitReads(`${tier} release`, count, release);
        limitReads(tier, count);
        expect(reads.get("ssaInstallment")!.count).toBeLessThanOrEqual(20 * count);
        expect(reads.get("medicareInstallment")!.count).toBeLessThanOrEqual(20 * count);
        expect(reads.get("helocIssuer")!.count).toBeLessThanOrEqual(14 * count);
        expect(reads.get("helocIssuer")!.bytes).toBeLessThanOrEqual(14 * intrinsicBytes);
      }
      if (!summary) throw new Error("Summary execution missing");
      let exported: ReplayExportMeasurement | undefined;
      let cold: ReplayRestoreMeasurement | undefined;
      reads.clear();
      const artifact = measure(count, "export", () =>
        createPortableHouseholdReplayArtifact(summary!, false, measurement => { exported = measurement; }));
      limitReads("export", count);
      const wire = JSON.stringify(artifact);
      if (count === 12) bytesAt12 = wire.length;
      if (count === 24) expect(wire.length).toBeLessThanOrEqual(2.5 * bytesAt12);
      const terminal = periods.at(-1)!;
      const transported: unknown = JSON.parse(wire);
      reads.clear();
      const restored = measure(count, "cold restore", () => restorePortableHouseholdReplayArtifact(transported, {
        now: () => performance.now(), record: measurement => { cold = measurement; },
      }));
      limitReads("cold restore", count);
      expect(cold?.cache).toBe("cold");
      expect(cold?.checkpointFullStateMaterializations ?? 0).toBe(0);
      expect(exported?.materializedCheckpointStates).toBe(0);
      if (count === 12) nodesAt12 = (exported?.checkpointIndexNodesVisited ?? 0) + (cold?.checkpointIndexNodesVisited ?? 0);
      if (count === 24) expect((exported?.checkpointIndexNodesVisited ?? 0) + (cold?.checkpointIndexNodesVisited ?? 0))
        .toBeLessThanOrEqual(3 * nodesAt12);
      reads.clear();
      expect(measure(count, "warm restore", () => restorePortableHouseholdReplayArtifact(transported))).toBe(restored);
      limitReads("warm restore", count);
      reads.clear();
      const first = measure(count, "first window", () => replayHouseholdForecastWindow(restored, periods[0]!));
      expect(first.periods.map(period => period.period)).toEqual([periods[0]]);
      expect(first.periods[0]!.netWorth).toEqual(summary.periods[0]!.netWorth);
      limitReads("first window", count);
      reads.clear();
      const latest = measure(count, "terminal window", () => replayHouseholdForecastWindow(restored, terminal));
      limitReads("terminal window", count);
      expect(latest.state).toEqual(summary.state);
      expect(replayHouseholdForecastWindow(restored, terminal)).toEqual(latest);
    }
    console.info("Synthetic combined source history timings", JSON.stringify(measurements));
  }, 60_000);

  it("refuses a committed SSA original withdrawn by a replay-phase callback", () => {
    const { kernel, context, periods, events } = combined(1);
    const summary = runHouseholdKernel({ kernel, runContext: context });
    expect(summary.periods, JSON.stringify(summary.diagnostics)).toHaveLength(2);
    const transported: unknown = JSON.parse(JSON.stringify(createPortableHouseholdReplayArtifact(summary)));
    const restored = restorePortableHouseholdReplayArtifact(transported);
    expect(replayHouseholdForecastWindow(restored, periods[1]!).state).toEqual(summary.state);
    expect(() => replayHouseholdForecastWindow(restored, periods[1]!, undefined, phase => {
      if (phase === "replay_verified") unavailableBenefit = events[0]!.eventId;
    })).toThrow(/SSA|Medicare|original/i);
    expect(unavailableBenefit).toBe(events[0]!.eventId);
    expect(() => restorePortableHouseholdReplayArtifact(transported)).toThrow("HOUSEHOLD_REPLAY_BASIS_MISMATCH");
    expect(() => restorePortableHouseholdReplayArtifact(JSON.parse(JSON.stringify(transported))))
      .toThrow("HOUSEHOLD_REPLAY_BASIS_MISMATCH");
    expect(summary.state.accounts[ids.bank]!.cash.equals(money("3300"))).toBe(true);
  }, 20_000);

  it("rejects an omitted terminal SSA original and proof with the same committed BANK cash", () => {
    const { kernel, context, events } = combined(1);
    const summary = runHouseholdKernel({ kernel, runContext: context });
    expect(summary.periods, JSON.stringify(summary.diagnostics)).toHaveLength(2);
    const artifact = createPortableHouseholdReplayArtifact(summary);
    type Value = null | boolean | number | string | { kind: string; value: unknown };
    const definitions = new Map<number, Value>();
    const wire = JSON.parse(artifact.encoded, (_key, node: unknown): unknown => {
      if (node === null || typeof node !== "object") return node;
      if ("d" in node) {
        const [id, definition] = node.d as [number, Value];
        definitions.set(id, definition);
        return definition;
      }
      if ("r" in node) return definitions.get(node.r as number);
      if ("t" in node) {
        const [kind, value] = node.t as [string, unknown];
        return { kind, value };
      }
      return node;
    }) as Value;
    const rows = (record: Value): [string, Value][] => {
      if (record === null || typeof record !== "object" || record.kind !== "record")
        throw new Error("Expected an encoded replay record");
      return record.value as [string, Value][];
    };
    const field = (record: Value, name: string) => rows(record).find(([key]) => key === name)![1];
    const terminal = field(field(wire, "terminalDelta"), "records");
    const cash = canonicalSerialize(field(terminal, "accounts"));
    const remove = (name: string, id: string) => {
      const ledger = field(field(terminal, name), "set");
      if (ledger === null || typeof ledger !== "object") throw new Error("Missing encoded terminal ledger");
      const entries = rows(ledger);
      expect(entries.some(([key]) => key === id)).toBe(true);
      ledger.value = entries.filter(([key]) => key !== id);
    };
    const [receipt] = Object.values(summary.state.ssaMedicarePayments!);
    remove("ssaMedicarePayments", receipt!.id);
    remove("d2PostedTransactions", events[0]!.eventId);
    expect(canonicalSerialize(field(terminal, "accounts"))).toBe(cash);
    const encoded = JSON.stringify(wire);
    expect(() => restorePortableHouseholdReplayArtifact({ ...artifact, encoded,
      integrity: createInputFingerprint({ runContext: context, openingState: encoded }) }))
      .toThrow(expect.objectContaining({ cause: expect.objectContaining({
        message: "HOUSEHOLD_REPLAY_BASIS_MISMATCH: fixed loan committed history differs from independent execution",
      }) }));
  }, 20_000);

  it("refuses a previously posted Person BANK original before the later settlement exists", () => {
    const medical = source("348-unsettled");
    const card = document();
    fsa.set(medical.sourceId, medical);
    cards.set(card.sourceId, card);
    const medicalRun = fsaFixture(1);
    const cardRun = cardFixture(1);
    const medicalKernel = attachFsaCash(medicalRun.kernel, {
      sources: [{ sourceId: medical.sourceId, expectedSource: fsaCashSourceFingerprint(medical) }],
    });
    const runs = [
      { kernel: medicalKernel, context: medicalRun.context, transactionId: originalOperationId(medical),
        withdraw: () => fsa.delete(medical.sourceId), cashAccount: fsaIds.bank, cash: money("500") },
      { kernel: cardRun.kernel, context: cardRun.context, transactionId: card.charge.operationId,
        withdraw: () => cards.delete(card.sourceId), cashAccount: cardIds.bank, cash: money("500") },
    ];
    for (const run of runs) {
      const summary = runHouseholdKernel({ kernel: run.kernel, runContext: run.context });
      expect(summary.periods, JSON.stringify(summary.diagnostics)).toHaveLength(1);
      expect(summary.state.accounts[run.cashAccount]!.cash).toEqual(run.cash);
      expect(summary.state.d2PostedTransactions?.[accountingTransactionId(run.transactionId)]).toBeDefined();
      expect(Object.keys(summary.state.d2SettlementReceipts ?? {})).toHaveLength(0);
      const artifact = createPortableHouseholdReplayArtifact(summary, true);
      expect(restorePortableHouseholdReplayArtifact(artifact).periods).toEqual(summary.periods);
      expect(run.withdraw()).toBe(true);
      expect(() => createPortableHouseholdReplayArtifact(summary)).toThrow("Person BANK original unavailable at outward observation");
      expect(() => restorePortableHouseholdReplayArtifact(artifact)).toThrow("HOUSEHOLD_REPLAY_BASIS_MISMATCH");
    }
  });
});
