import { domainId } from "../../../../src/identity/index.js";
import { createAuthoritativeState, type AuthoritativeState } from "../../../../src/state/index.js";
import { civilDate, instant, utcMonthlyPeriods } from "../../../../src/time/index.js";
import { money, USD } from "../../../../src/values/index.js";
import { compileHouseholdKernel } from "../../../../src/simulation/householdExecution.js";
import { createPrimitiveRuntimeStateStore } from "../../../../src/simulation/period.js";
import { createRunContext, runId, scenarioId } from "../../../../src/simulation/run.js";
import { attachCardBank, registerCardBankSourcePort, type CardBankDocument } from "../../../../src/simulation/d2/integration/cardBank/index.js";
import type { CreditCardStatement, IssuerSource } from "../../../../src/simulation/d2/debt/revolving/index.js";
import type { CreditCardContinuityRequest, CycleRegister, ObservedPosting } from "../../../../src/simulation/d2/debt/revolving/cycles/index.js";

const uuid = (n: number) => `203a0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const ids = { household: domainId("household", uuid(1)), person: domainId("person", uuid(2)),
  bank: domainId("account", uuid(3)), card: domainId("liability", uuid(4)), other: domainId("person", uuid(5)) };
export const sourceId = "synthetic-issuer-dossier";
export function document(): CardBankDocument {
  const source: IssuerSource = { ruleSnapshotId: "synthetic-issuer-quote", issuerId: "synthetic-issuer", personId: ids.person,
    cardAccountId: ids.card, jurisdiction: "US:synthetic", ruleFamily: "issuer_quote", sourcePublication: "Synthetic publisher document, no statutory assumptions",
    asOf: civilDate("2026-01-01"), version: "synthetic/v1", projectionStatus: "verified",
    start: civilDate("2026-01-01"), endExclusive: civilDate("2026-04-01") };
  const cycle = { start: civilDate("2026-01-01"), endExclusive: civilDate("2026-02-01") };
  const c: CreditCardStatement = { instrumentFamily: "credit_card", householdId: ids.household, personId: ids.person,
    issuerId: source.issuerId, cardAccountId: ids.card, currency: USD, statementId: "synthetic-january", cycle,
    statementDate: civilDate("2026-02-01"), dueDate: civilDate("2026-02-25"), statementSource: source,
    openingPrincipal: money("1000"), openingBasis: "principal_only_no_unpaid_charges", statementPrincipal: money("1000"),
    statementInterest: money("20"), statementFees: money("0"), statementTotal: money("1020"), balanceBasis: "principal_plus_itemized_charges",
    interestPolicy: "issuer_statement_quote", charges: [{ postingId: "issuer-interest-january", effectiveAt: civilDate("2026-01-31"),
      sequence: 1, amount: money("20"), source, kind: "interest", recognition: "propose_expense" }], transactions: [],
    postingPolicy: { convention: "posted_date_end_exclusive", completeCycleActivity: true, source },
    minimum: { kind: "issuer_quote", amount: money("25"), source },
    allocationPolicy: { kind: "issuer_order", order: ["interest", "fees", "principal"], source },
    payment: { operationId: "card-payment-february", payerId: ids.person, sourceAccountId: ids.bank,
      effectiveAt: civilDate("2026-02-15"), funding: { kind: "requested", amount: money("200") },
      balanceConvention: "statement_only_no_intervening_activity", source } };
  return { sourceId, version: "synthetic/v1", statementId: c.statementId, quoteId: "issuer-quote-january", sourceApprovalId: "issuer-approval-january",
    request: { period: cycle, cards: [c] }, provenance: [{ source, publishedAt: instant("2026-01-01T12:00:00.000Z"), knownAt: instant("2026-01-01T13:00:00.000Z") }],
    charge: { evidenceId: "issuer-interest-january", postingIds: ["issuer-interest-january"], effectiveAt: instant("2026-01-31T17:00:00.000Z"), operationId: "card-charge-january" },
    payment: { approvalId: "issuer-approved-split", authorizationId: "payer-signature", paymentId: "payment-february", settlementId: "settlement-february",
      effectiveAt: instant("2026-02-15T17:00:00.000Z"), authorizedAt: instant("2026-02-10T14:00:00.000Z"),
      publishedAt: instant("2026-02-10T12:00:00.000Z"), knownAt: instant("2026-02-10T15:00:00.000Z"), expiresAt: instant("2026-02-26T00:00:00.000Z"),
      householdId: ids.household, personId: ids.person, issuerId: c.issuerId, cardAccountId: ids.card, bankAccountId: ids.bank,
      amount: money("200"), allocation: { interest: money("20"), principal: money("180"), fees: money("0") }, bankCashBefore: money("500") } };
}
/** Independent two-cycle documentary proof. Its posted flags never stand in
 * for the canonical BANK debit performed by the adapter. */
export function continuityDocument(): CardBankDocument {
  const d = document(), c = d.request.cards[0]!;
  const first: CreditCardStatement = { ...c, payment: { ...c.payment, effectiveAt: civilDate("2026-02-01") } };
  const s = { ...c.statementSource, ruleSnapshotId: "synthetic-second-cycle" };
  const cycle = { start: civilDate("2026-02-01"), endExclusive: civilDate("2026-03-01") };
  const next: CreditCardStatement = { ...c, statementId: "synthetic-february", cycle, statementDate: cycle.endExclusive,
    dueDate: civilDate("2026-03-25"), openingPrincipal: money("820"), statementPrincipal: money("820"), statementTotal: money("840"),
    statementSource: s, minimum: { ...c.minimum, source: s }, postingPolicy: { ...c.postingPolicy, source: s },
    allocationPolicy: { ...c.allocationPolicy, source: s }, charges: c.charges.map(x => ({ ...x, postingId: "issuer-interest-february",
      effectiveAt: civilDate("2026-02-28"), source: s })),
    payment: { ...c.payment, operationId: "documentary-march-payment", effectiveAt: cycle.endExclusive, source: s } };
  const entry = (card: CreditCardStatement): CreditCardContinuityRequest["cycles"][number] => {
    const at = card.cycle.endExclusive, label = card.statementId;
    const settlement = card === first ? d.payment.settlementId : `documentary-settlement:${label}`;
    const payment: ObservedPosting = { event: { kind: "payment", postingId: `observed:${label}`, effectiveAt: at,
      sequence: 0, amount: money("200"), allocation: d.payment.allocation, source: card.payment.source }, knownAt: at,
      issuerPayment: { operationId: card.payment.operationId, settlementId: settlement,
        sourceAccountId: ids.bank, allocationSource: card.allocationPolicy.source },
      bankConfirmation: { confirmationId: `confirmation:${label}`, settlementId: settlement,
        operationId: card.payment.operationId, householdId: ids.household, personId: ids.person, sourceAccountId: ids.bank,
        cardAccountId: ids.card, issuerId: c.issuerId, effectiveAt: at, knownAt: at, amount: money("200"), status: "posted",
        sourcePublication: "Synthetic independent documentary BANK statement", version: "synthetic/v1",
        authorization: { authorizationId: card === first ? d.payment.authorizationId : `documentary-authorization:${label}`,
          effectiveAt: card === first ? civilDate("2026-01-30") : at, amount: money("200"), sourcePublication: "Synthetic payer authority" } } };
    const register: CycleRegister = { statementId: label, cardAccountId: ids.card, knownAt: at, source: card.statementSource,
      complete: true, activity: card.charges.map(event => ({ event, knownAt: at })),
      opening: { effectiveAt: card.cycle.start, components: { principal: card.openingPrincipal, interest: money("0"), fees: money("0") },
        convention: "principal_only_after_boundary_postings_no_unpaid_charges", source: card.statementSource },
      boundary: { source: card.statementSource, complete: true, payments: [payment] } };
    return { request: { period: card.cycle, cards: [card] }, registers: [register] };
  };
  return { ...d, request: { ...d.request, cards: [first] }, payment: { ...d.payment, effectiveAt: instant("2026-02-01T17:00:00.000Z"),
    authorizedAt: instant("2026-01-30T14:00:00.000Z"), publishedAt: instant("2026-01-30T12:00:00.000Z"), knownAt: instant("2026-01-30T15:00:00.000Z") },
    provenance: [...d.provenance, { source: s, publishedAt: instant("2026-02-01T12:00:00.000Z"), knownAt: instant("2026-02-01T13:00:00.000Z") }],
    continuity: { knownAt: civilDate("2026-03-01"), cycles: [entry(first), entry(next)] },
    continuityProvenance: { publishedAt: instant("2026-03-01T12:00:00.000Z"), knownAt: instant("2026-03-01T13:00:00.000Z") } };
}
/** Independently constructed raw source fixture, never populated from receipts
 * or portable artifacts. Mutable switch exists only for negative source tests. */
export const publisher: { read: (id: string) => CardBankDocument | undefined } = { read: id => id === sourceId ? document() : undefined };
export const registerPublisher = () => registerCardBankSourcePort({ read: id => publisher.read(id) });
export function opening(cash = "500", liability = "1000"): AuthoritativeState {
  return createAuthoritativeState({ accounts: { [ids.bank]: { id: ids.bank, kind: "checking", ownerId: ids.person, cash: money(cash) } },
    liabilities: { [ids.card]: { id: ids.card, balance: money(liability) } } });
}
export function fixture(months = 2, state = opening(), sourceIds: readonly string[] = [sourceId]) {
  const start = instant("2026-01-01T00:00:00.000Z"), periods = utcMonthlyPeriods(start, months);
  const context = createRunContext({ runId: runId(uuid(6)), scenarioId: scenarioId(uuid(7)), asOf: instant("2026-03-02T00:00:00.000Z"),
    dataCutoff: instant("2026-03-02T00:00:00.000Z"), simulationStart: start, simulationEnd: periods.at(-1)!.end, baseCurrency: USD });
  const kernel = compileHouseholdKernel({ reconciledOpeningState: state, reconciledPrimitiveState: createPrimitiveRuntimeStateStore(),
    scenarioIdentity: context.scenarioId, executionMonths: months, scenarioBindings: { synthetic: "#203 issuer interest and funded BANK only" } }, start);
  return { kernel: attachCardBank(kernel, { sourceIds }), context, periods, state };
}
