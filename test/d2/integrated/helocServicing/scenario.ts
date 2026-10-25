import { domainId } from "../../../../src/identity/index.js";
import { createAuthoritativeState, type AuthoritativeState } from "../../../../src/state/index.js";
import { civilDate, instant, utcMonthlyPeriods } from "../../../../src/time/index.js";
import { money, USD, Money } from "../../../../src/values/index.js";
import { compileHouseholdKernel } from "../../../../src/simulation/householdExecution.js";
import { createPrimitiveRuntimeStateStore } from "../../../../src/simulation/period.js";
import { createRunContext, runId, scenarioId, canonicalSerialize } from "../../../../src/simulation/run.js";
import { attachHelocServicing, registerHelocServicingSourcePorts,
  type HelocServiceDocument, type HelocBankDebit } from "../../../../src/simulation/d2/integration/helocServicing/index.js";
import type { Source } from "../../../../src/simulation/d2/debt/heloc/index.js";
import type { PhaseServicingRequest, PostedPrincipal } from "../../../../src/simulation/d2/debt/heloc/phaseServicing.js";

const uuid = (n: number) => `149c0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const ids = { household: domainId("household", uuid(1)), person: domainId("person", uuid(2)),
  bank: domainId("account", uuid(3)), principal: domainId("liability", uuid(4)), charges: domainId("liability", uuid(5)) };
const at = (d: string) => instant(`${d}T00:00:00.000Z`);
const date = (i: number) => civilDate(`${2026 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}-01`);
export const source: Source = { start: civilDate("2020-01-01"), endExclusive: civilDate("2040-01-01"), householdId: ids.household,
  personId: ids.person, lineId: "synthetic-line", liabilityAccountId: ids.principal, bankAccountId: ids.bank,
  ruleSnapshotId: "synthetic-heloc/v1", jurisdiction: "US:TEST", sourcePublication: "Synthetic signed line contract",
  publishedAt: civilDate("2023-01-01"), asOf: civilDate("2023-01-01"), version: "1", projectionStatus: "verified" };

/** Independently reconstruct original documents; no receipt or artifact inputs. */
export function documents(count = 2, long = false, computed = false): { issuer: HelocServiceDocument; bank: HelocBankDebit }[] {
  const output: { issuer: HelocServiceDocument; bank: HelocBankDebit }[] = [];
  let principal = money("1000"), cash = money("500");
  const history: PostedPrincipal[] = [];
  for (let i = 0; i < count; i++) {
    const key = `month:${i}`, period = { start: date(i), endExclusive: date(i + 1) };
    const phase = { start: date(0), endExclusive: civilDate("2029-01-01"), kind: "amortizing" as const };
    const interest = money(long ? "1" : i === 0 ? "5.10" : "4.14"), paid = money(long ? "10" : "100"), amount = paid.plus(interest);
    const closing = principal.minus(paid), quoteSource = { ...source, sourcePublication: `Synthetic complete original statement:${i}`,
      publishedAt: period.endExclusive, asOf: period.endExclusive };
    const payment = { operationId: `service:${key}`, claimId: `heloc/${source.lineId}/${period.start}/${period.endExclusive}/service`,
      effectiveAt: period.endExclusive, actorId: ids.person, bankAccountId: ids.bank, amount, source, status: "authorized" as const,
      authorization: { authorizationId: `authorization:${key}`, source }, observed: null,
      funding: { fundingId: `funding:${key}`, effectiveAt: period.endExclusive, amount, source } };
    const request: PhaseServicingRequest = { line: { period, evaluatedAsOf: period.endExclusive, householdId: ids.household,
      ownerId: ids.person, borrowerId: ids.person, lineId: source.lineId, liabilityAccountId: ids.principal, bankAccountId: ids.bank,
      currency: USD, source, creditLimit: money("2000"), openingPrincipal: principal, openedAt: civilDate("2024-01-01"),
      closedAt: phase.start, maturityAt: phase.endExclusive, drawWindow: { start: civilDate("2024-01-01"), endExclusive: phase.start },
      revokedAt: null, phases: [{ start: civilDate("2024-01-01"), endExclusive: phase.start, kind: "interest_only_draw" }, phase],
      rate: computed ? { source, indexId: "synthetic-index", spreadPpm: 20000n, lookbackDays: 2, resetIntervalDays: 365,
        priorResetAt: period.start, priorRatePpm: 60000n, nextResetOrdinal: 1, roundingIncrementPpm: 1000n, rounding: "half_up",
        initialCapPpm: 20000n, recurringCapPpm: 10000n, lifetimeFloorPpm: 30000n, lifetimeCeilingPpm: 120000n,
        legalMaximum: null, resets: [], observations: [] } : null,
      interest: { source, dayCount: "actual_365_fixed", compounding: "simple", posting: "period_end_after_daily_activity", rounding: "half_up", dueAt: period.endExclusive }, events: [] },
      checkpoint: { originalAt: civilDate("2024-01-01"), originalPrincipal: money("1000"), originalSource: source,
        closingAt: period.start, closingPrincipal: principal, source, history: [...history] },
      terms: { source, phase, accrualPeriod: period, dueAt: period.endExclusive, convention: "fixed_per_installment",
        method: computed ? "b1_daily_simple" : "issuer_quoted", rounding: "half_up", total: amount,
        openingPrincipal: principal, closingPrincipal: closing, allocation: computed ? null : { interest, principal: paid, source: quoteSource }, finalQuote: null,
        ...(computed ? {} : { issuerQuote: { documentId: `document:${key}`, issuerId: "synthetic-issuer", evidenceKind: "original_complete_issuer_statement" as const,
          source: quoteSource, period, dueAt: period.endExclusive, householdId: ids.household, borrowerId: ids.person,
          lineId: source.lineId, liabilityAccountId: ids.principal, bankAccountId: ids.bank, openingPrincipal: principal,
          closingPrincipal: closing, interest, principal: paid, fees: money("0"), total: amount } }) }, payment };
    const issuer: HelocServiceDocument = { sourceId: key, version: "original/v1", issuerId: "synthetic-issuer", documentId: `document:${key}`,
      documentVersion: "1", sourceApprovalId: `issuer-approval:${key}`, checkpointId: `checkpoint:${key}`, historyVersion: `posted-history:${i}`,
      request, bankDebitId: `bank-debit:${key}`, chargeLiabilityId: ids.charges, feeNature: "none", priorDraws: [], provenance: [] };
    output.push({ issuer: withProvenance(issuer), bank: { id: issuer.bankDebitId, version: "bank/v1", status: "posted", classification: "BANK",
      householdId: ids.household, personId: ids.person, issuerId: issuer.issuerId, lineId: source.lineId, liabilityId: ids.principal,
      bankAccountId: ids.bank, operationId: payment.operationId, authorizationId: payment.authorization.authorizationId,
      fundingId: payment.funding.fundingId, approvalId: `bank-approval:${key}`, settlementId: `settlement:${key}`,
      effectiveAt: at(period.endExclusive), authorizedAt: at(period.start), publishedAt: at(period.endExclusive), knownAt: at(period.endExclusive), amount, bankCashBefore: cash } });
    history.push({ postingId: `heloc-service-posting:${payment.operationId}`, operationId: payment.operationId, authorizationId: payment.authorization.authorizationId,
      claimId: payment.claimId, fundingId: payment.funding.fundingId, effectiveAt: payment.effectiveAt, sequence: 0,
      kind: "principal_repayment", principal: paid, interest, cash: amount, source, evidenceKind: "canonical_posting" });
    principal = closing; cash = cash.minus(amount);
  }
  return output;
}
export function withProvenance(d: HelocServiceDocument): HelocServiceDocument {
  const sources = new Map<string, Source>();
  const visit = (v: unknown): void => {
    if (!v || typeof v !== "object" || v instanceof Money) return;
    if ("sourcePublication" in v && "ruleSnapshotId" in v) { sources.set(canonicalSerialize(v), v as Source); return; }
    for (const child of Object.values(v)) visit(child);
  };
  visit(d.request); visit(d.priorDraws);
  return { ...d, provenance: [...sources.values()].map(s => ({ source: s, publishedAt: at(s.publishedAt), knownAt: at(s.asOf) })) };
}
export const publisher = { issuer: (id: string): HelocServiceDocument | undefined => documents().find(d => d.issuer.sourceId === id)?.issuer,
  bank: (id: string): HelocBankDebit | undefined => documents().find(d => d.bank.id === id)?.bank };
export const registerPublisher = () => registerHelocServicingSourcePorts({ issuer: { read: id => publisher.issuer(id) }, bank: { read: id => publisher.bank(id) } });
export function publish(docs = documents()): void {
  publisher.issuer = id => docs.find(d => d.issuer.sourceId === id)?.issuer;
  publisher.bank = id => docs.find(d => d.bank.id === id)?.bank;
}
export const opening = (cash = "500", principal = "1000"): AuthoritativeState => createAuthoritativeState({
  accounts: { [ids.bank]: { id: ids.bank, ownerId: ids.person, kind: "checking", cash: money(cash) } },
  liabilities: { [ids.principal]: { id: ids.principal, balance: money(principal) }, [ids.charges]: { id: ids.charges, balance: money("0") } } });
export function fixture(months = 3, state = opening(), sourceIds: readonly string[] = documents().map(d => d.issuer.sourceId)) {
  const start = at("2026-01-01"), periods = utcMonthlyPeriods(start, months);
  const context = createRunContext({ runId: runId(uuid(6)), scenarioId: scenarioId(uuid(7)), asOf: at("2029-01-01"),
    dataCutoff: at("2029-01-01"), simulationStart: start, simulationEnd: periods.at(-1)!.end, baseCurrency: USD });
  const kernel = compileHouseholdKernel({ reconciledOpeningState: state, reconciledPrimitiveState: createPrimitiveRuntimeStateStore(),
    scenarioIdentity: context.scenarioId, executionMonths: months, scenarioBindings: { synthetic: "#149 physical HELOC servicing" } }, start);
  return { kernel: attachHelocServicing(kernel, { sourceIds }), context, state, periods };
}
export function zeroCharge(): ReturnType<typeof documents>[number] {
  const { issuer: d, bank } = documents(1)[0]!, r = d.request, t = r.terms!, q = t.issuerQuote!, amount = money("100");
  return { issuer: withProvenance({ ...d, chargeLiabilityId: null, request: { ...r,
    terms: { ...t, total: amount, allocation: { ...t.allocation!, interest: money("0") }, issuerQuote: { ...q, interest: money("0"), total: amount } },
    payment: { ...r.payment, amount, funding: { ...r.payment.funding!, amount } } } }), bank: { ...bank, amount } };
}
export function balloon(): ReturnType<typeof documents>[number] {
  const { issuer: d, bank } = documents(1)[0]!, r = d.request, t = r.terms!, q = t.issuerQuote!;
  const phase = { ...t.phase, kind: "balloon" as const, endExclusive: r.line.period.endExclusive }, total = money("1007.10");
  return { issuer: withProvenance({ ...d, feeNature: "documented_service_expense", request: { ...r,
    line: { ...r.line, maturityAt: phase.endExclusive, phases: [r.line.phases[0]!, phase] },
    terms: { ...t, phase, total, closingPrincipal: money("0"), allocation: { ...t.allocation!, principal: money("1000") },
      issuerQuote: { ...q, principal: money("1000"), closingPrincipal: money("0"), fees: money("2"), total },
      finalQuote: { source, dueAt: t.dueAt, principal: money("1000"), interest: money("5.10"), fee: { amount: money("2"), source } } },
    payment: { ...r.payment, amount: total, funding: { ...r.payment.funding!, amount: total } } } }), bank: { ...bank, amount: total, bankCashBefore: money("2000") } };
}

/** A second independently documented line sharing only BANK/person/household. */
export function secondLine(): ReturnType<typeof documents>[number] {
  const transform = (v: unknown): unknown => {
    if (typeof v === "string") return v.replaceAll("month:0", "other:0")
      .replaceAll("synthetic-line", "synthetic-line-two")
      .replaceAll(ids.principal, "149c0000-0000-4000-8000-000000000014")
      .replaceAll(ids.charges, "149c0000-0000-4000-8000-000000000015");
    if (Array.isArray(v)) return v.map(transform);
    if (v && typeof v === "object" && !(v instanceof Money) && Object.getPrototypeOf(v) === Object.prototype)
      return Object.fromEntries(Object.entries(v).map(([k, child]) => [k, transform(child)]));
    return v;
  };
  return transform(documents(1)[0]!) as ReturnType<typeof documents>[number];
}
