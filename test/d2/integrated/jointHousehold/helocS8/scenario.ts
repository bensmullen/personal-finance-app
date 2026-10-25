import { domainId } from "../../../../../src/identity/index.js";
import { createAuthoritativeState } from "../../../../../src/state/index.js";
import { civilDate, instant } from "../../../../../src/time/index.js";
import { Money, money } from "../../../../../src/values/index.js";
import { applyHouseholdExecutionOverlay, runHouseholdKernel } from "../../../../../src/simulation/householdExecution.js";
import { proposeHeloc, type HelocRequest } from "../../../../../src/simulation/d2/debt/heloc/index.js";
import type { PostedPrincipal } from "../../../../../src/simulation/d2/debt/heloc/phaseServicing.js";
import { createHelocDrawParticipant } from "../../../../../src/simulation/d2/integration/helocDraws/index.js";
import { attachHelocServicing, registerHelocServicingSourcePorts, type HelocServiceDocument,
  type HelocBankDebit } from "../../../../../src/simulation/d2/integration/helocServicing/index.js";
import { attachFsaCash, fsaCashSourceFingerprint } from "../../../../../src/simulation/d2/integration/fsaCash/index.js";
import { documents, ids as isolated, withProvenance } from "../../helocServicing/scenario.js";
import { ids as joint, publishers, cardSource, medicalSource } from "../combinedScenario.js";
import { fundedHousehold, resetSources } from "../fundedScenario.js";

export const ids = { ...joint,
  heloc: domainId("liability", "14940000-0000-4000-8000-000000000001"),
  charges: domainId("liability", "14940000-0000-4000-8000-000000000002") };
export type DocumentPair = { issuer: HelocServiceDocument; bank: HelocBankDebit };

/** Documentary builders only: preserve value classes and bind every ownership
 * reference before authentication; never import an isolated opening state. */
export function mapFacts<T>(value: T, replacements: ReadonlyMap<string, string>): T {
  const visit = (v: unknown): unknown => {
    if (typeof v === "string") {
      let result = v;
      for (const [from, to] of replacements) result = result.replaceAll(from, to);
      return result;
    }
    if (Array.isArray(v)) return v.map(visit);
    if (v && !(v instanceof Money) && Object.getPrototypeOf(v) === Object.prototype)
      return Object.fromEntries(Object.entries(v).map(([k, child]) => [k, visit(child)]));
    return v;
  };
  return visit(value) as T;
}
const scope = <T>(v: T): T => mapFacts(v, new Map([
  [isolated.household, ids.household], [isolated.person, ids.member], [isolated.bank, ids.bank],
  [isolated.principal, ids.heloc], [isolated.charges, ids.charges],
  ["synthetic-line", "s8-4-line"], ["month:", "s8-4-month:"],
]));

export const archive = new Map<string, HelocServiceDocument>();
export const debits = new Map<string, HelocBankDebit>();
export const reads = { issuer: 0, bank: 0 };
// Exactly once per process, with separately authenticated issuer/BANK readers.
registerHelocServicingSourcePorts({ issuer: { read: id => { reads.issuer++; return archive.get(id); } },
  bank: { read: id => { reads.bank++; return debits.get(id); } } });
export function reset(): void { resetSources(); archive.clear(); debits.clear(); reads.issuer = 0; reads.bank = 0; }
export function publish(pairs: readonly DocumentPair[]): void {
  archive.clear(); debits.clear();
  for (const p of pairs) { archive.set(p.issuer.sourceId, p.issuer); debits.set(p.bank.id, p.bank); }
}

// Literal S8-3 month-end BANK balances before HELOC service. November's final
// auto payment is $294.93; December has no remaining auto principal. No
// calculator, forecast output or portable record supplies these facts.
export const baselineBank = ["1900", "2900", "3100", "3300", "3500", "3700", "3900",
  "4100", "4300", "4500", "4905.07", "5605.07", "6605.07"] as const;
export const principalAmounts = ["100", "100", ...Array<string>(11).fill("10")];
export const interestAmounts = ["5.10", "4.14", ...Array<string>(11).fill("1")];

export function jointHeloc({ months = 3, payments = 2, service = true } = {}) {
  if (payments < 1 || payments > 13) throw new Error("S8_4_PAYMENT_BOUND");
  const s = fundedHousehold({ months });
  const state = createAuthoritativeState({ ...s.opening, liabilities: { ...s.opening.liabilities,
    [ids.heloc]: { id: ids.heloc, balance: money("900") },
    [ids.charges]: { id: ids.charges, balance: money("0") } },
    accounts: { ...s.opening.accounts, [ids.bank]: { ...s.opening.accounts[ids.bank]!, cash: money("1900") } } });
  const template = scope(documents(1, false, true)[0]!.issuer.request.line);
  const period = { start: civilDate("2025-12-01"), endExclusive: civilDate("2026-01-01") };
  const draw: HelocRequest = { ...template, period, evaluatedAsOf: civilDate("2025-12-31"), openingPrincipal: money("900"),
    rate: { ...template.rate!, priorResetAt: period.start }, interest: { ...template.interest, dueAt: period.endExclusive },
    events: [{ operationId: "s8-4:actual-draw", authorizationId: "s8-4:draw-authorization", kind: "draw",
      effectiveAt: civilDate("2025-12-15"), sequence: 0, actorId: ids.member, bankAccountId: ids.bank,
      authorized: true, amount: money("100"), source: template.source, funding: null }] };
  const proposal = proposeHeloc(draw);
  if (proposal.coverage !== "complete" || !proposal.proposals[0]) throw new Error("S8_4_DRAW_UNQUALIFIED");
  const quote = { request: draw, proposal: proposal.proposals[0], openingBankCash: money("1900"),
    bankCashBeforeDraw: { "s8-4:actual-draw": money("1900") },
    bank: { classification: "BANK" as const, accountId: ids.bank, householdId: ids.household,
      personId: ids.member, evidence: template.source } };
  const participant = createHelocDrawParticipant({ householdId: ids.household, personId: ids.member, quotes: [quote] });
  const context = { ...s.context, simulationStart: instant("2025-12-01T00:00:00.000Z"), simulationEnd: instant("2026-01-01T00:00:00.000Z") };
  const candidate = { state, primitiveState: s.kernel.executable.reconciledPrimitiveState, runtime: {} };
  // Match the accepted original-draw oracle: only the admitted draw operation
  // supplies the opening receipt; unsupported December interest is excluded.
  const operations = participant.prepare(context, { start: context.simulationStart, end: context.simulationEnd }, candidate).operations
    .filter(o => o.descriptor.operationClass === "liabilities:heloc_draw");
  if (operations.length !== 1) throw new Error("S8_4_DRAW_OPERATION_MISSING");
  const opening = operations[0]!.execute(candidate, new Map()).state;
  const drawHistory: PostedPrincipal = { postingId: "s8-4:actual-draw", operationId: "s8-4:actual-draw",
    authorizationId: "s8-4:draw-authorization", claimId: "s8-4:draw-history", fundingId: "s8-4:draw-funding",
    effectiveAt: civilDate("2025-12-15"), sequence: 0, kind: "draw", principal: money("100"),
    interest: money("0"), cash: money("100"), source: template.source, evidenceKind: "canonical_posting" };
  let principal = money("1000"), cumulative = money("0");
  const history: PostedPrincipal[] = [drawHistory];
  const pairs = scope(documents(payments, true)).map((pair, i): DocumentPair => {
    const r = pair.issuer.request, paid = money(principalAmounts[i]!), interest = money(interestAmounts[i]!);
    const total = paid.plus(interest), closing = principal.minus(paid), t = r.terms!;
    const issuer = withProvenance({ ...pair.issuer, priorDraws: [quote], request: { ...r,
      line: { ...r.line, openingPrincipal: principal },
      checkpoint: { ...r.checkpoint, originalPrincipal: money("900"), history: [...history], closingPrincipal: principal },
      terms: { ...t, openingPrincipal: principal, closingPrincipal: closing, total,
        allocation: { ...t.allocation!, principal: paid, interest },
        issuerQuote: { ...t.issuerQuote!, openingPrincipal: principal, closingPrincipal: closing, principal: paid, interest, total } },
      payment: { ...r.payment, amount: total, funding: { ...r.payment.funding!, amount: total } } } });
    const bank = { ...pair.bank, amount: total, bankCashBefore: money(baselineBank[i]!).minus(cumulative) };
    history.push({ postingId: `heloc-service-posting:${r.payment.operationId}`, operationId: r.payment.operationId,
      authorizationId: r.payment.authorization!.authorizationId, claimId: r.payment.claimId,
      fundingId: r.payment.funding!.fundingId, effectiveAt: r.payment.effectiveAt, sequence: 0,
      kind: "principal_repayment", principal: paid, interest, cash: total, source: r.line.source, evidenceKind: "canonical_posting" });
    principal = closing; cumulative = cumulative.plus(total);
    return { issuer, bank };
  });
  publish(pairs);
  // February service precedes the card payment/FSA refund. Only their authored
  // intermediate BANK confirmations change; original economic facts do not.
  const card = cardSource(), medical = medicalSource(), debit = service ? money("105.10") : money("0");
  publishers.card = () => ({ ...card, payment: { ...card.payment, bankCashBefore: money("2100").minus(debit) } });
  const fsa = { ...medical, deposit: { ...medical.deposit, bankCashBefore: money("1900").minus(debit) } };
  publishers.fsa = () => fsa;
  // Rebind the actual FSA participant to these distinct documentary BANK facts.
  // The v2 reference pins the full independent evidence by compact SHA-256;
  // no medical/plan/BANK originals enter participant configuration.
  const withoutFsa = applyHouseholdExecutionOverlay(s.kernel, { reconciledOpeningState: opening,
    participants: s.kernel.executable.participants!.filter(p => p.id !== "d2_fsa_cash") });
  const base = attachFsaCash(withoutFsa, { sources: [{ sourceId: fsa.sourceId, expectedSource: fsaCashSourceFingerprint(fsa) }] });
  const kernel = attachHelocServicing(base, { sourceIds: service ? pairs.map(p => p.issuer.sourceId) : [] });
  return { ...s, opening, kernel, pairs, quote, drawOperations: operations, base,
    run: () => runHouseholdKernel({ kernel, runContext: s.context, resultTier: "detail" }) };
}
