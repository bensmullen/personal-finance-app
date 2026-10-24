import { civilDate, type CivilDate } from "../../../../time/index.js";
import { Currency, DecimalAmount, Money, USD } from "../../../../values/index.js";
import { evaluateRothOrder, type RothOrderInput, type RothProposal } from "../rothOrder/index.js";
import type { WithdrawalCash, WithdrawalInput, WithdrawalRequest, WithdrawalSource } from "../withdrawals/index.js";

type Withholding = NonNullable<WithdrawalRequest["withholding"]>;
export type RothRemittanceTerms = Omit<Withholding["instructions"][number], "source" | "authorizationSource">;
export type RothBank = WithdrawalRequest["bank"] & { readonly institutionId: string };
export interface RothCashSource extends WithdrawalCash {
  readonly holdingId: string;
  /** Documentary binding of the actual cash holding to its original account. */
  readonly holdingSource: WithdrawalSource;
}
export interface RothCashRequest extends Omit<WithdrawalRequest, "bank" | "authorization"> {
  readonly batchId: string;
  readonly instructionId: string;
  /** Proposed receipt identity; never evidence of a posted bank deposit. */
  readonly receiptId: string;
  readonly sourceHoldingId: string;
  readonly bank: RothBank;
  readonly instructionSource: WithdrawalSource;
  readonly authorization?: NonNullable<WithdrawalRequest["authorization"]> & {
    readonly batchId: string;
    readonly instructionId: string;
    readonly receiptId: string;
    readonly sourceHoldingId: string;
    readonly bankInstitutionId: string;
    readonly bankKind: RothBank["kind"];
    readonly withholdingTerms: readonly RothRemittanceTerms[];
  };
}
export interface RothWithdrawalInput {
  /** Complete, unchanged A3-2 owner/year/window contract, including requests. */
  readonly order: RothOrderInput;
  readonly batchId: string;
  readonly cash: readonly RothCashSource[];
  readonly banks: readonly RothBank[];
  readonly requests: readonly RothCashRequest[];
  /** Exhaustive owner Roth usage as of the SAME opening snapshot. */
  readonly usage: WithdrawalInput["usage"] & {
    readonly instructionIds: readonly string[];
    readonly receiptIds: readonly string[];
    readonly batchIds: readonly string[];
  };
}
export interface RothWithdrawalCandidate {
  readonly kind: "ordinary_owner_roth_cash_withdrawal_candidate";
  readonly committed: false;
  readonly postable: false;
  readonly operationId: string;
  readonly claimId: string;
  readonly authorizationId: string;
  readonly batchId: string;
  readonly instructionId: string;
  readonly receiptId: string;
  readonly householdId: string;
  readonly actorId: string;
  readonly sourceAccountId: string;
  readonly sourceHoldingId: string;
  readonly destinationAccountId: string;
  readonly destinationInstitutionId: string;
  readonly effectiveAt: CivilDate;
  readonly grossAmount: Money;
  readonly netAmount: Money;
  readonly withholdingAmount: Money;
  readonly openingAvailableCash: Money;
  /** One unchanged proposal for this SAME gross, never another allocation. */
  readonly rothOrder: RothProposal;
  readonly intents: readonly {
    readonly kind: "source_retirement_cash_decrease" | "owned_bank_cash_increase" | "withheld_tax_advance_payment_credit";
    readonly resourceId: string;
    readonly amount: Money;
    readonly jurisdiction: string | null;
    readonly beneficiaryPersonId: string;
    readonly instructionId: string;
    readonly authorizationId: string;
  }[];
  readonly incrementalEconomicIncome: Money;
  readonly incrementalEconomicExpense: Money;
  readonly principalTransfer: "net_worth_neutral";
  readonly taxCompleteness: "incomplete";
  readonly executionCondition: "149_atomic_funding_routing_usage_revalidation";
  readonly traceRefs: readonly string[];
}
export interface RothWithdrawalDiagnostic {
  readonly seam: "S7";
  readonly diagnosticCode: string;
  readonly sourceEntityPath: string;
  readonly coverage: "incomplete";
  readonly affectedOutput: "roth_withdrawal_candidate";
  readonly traceRefs: readonly string[];
}
export interface RothWithdrawalEvaluation {
  readonly contract: "d2-shared/v1";
  readonly committed: false;
  readonly postable: false;
  readonly coverage: "conditional" | "incomplete";
  readonly candidates: readonly RothWithdrawalCandidate[];
  readonly diagnostics: readonly RothWithdrawalDiagnostic[];
  readonly funding: "incomplete";
  readonly bankSettlement: "incomplete";
  readonly tax: "incomplete";
  readonly penalties: "incomplete";
  readonly withholdingCreditSettlement: "incomplete";
  readonly futureLaw: "incomplete";
}
const flags = { contract: "d2-shared/v1", committed: false, postable: false, funding: "incomplete", bankSettlement: "incomplete",
  tax: "incomplete", penalties: "incomplete", withholdingCreditSettlement: "incomplete", futureLaw: "incomplete" } as const;
const cmp = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const text = (s: string): boolean => typeof s === "string" && s.trim().length > 0;
const unique = (ids: readonly string[]): boolean => ids.every(text) && new Set(ids).size === ids.length;
const sameIds = (a: readonly string[], b: readonly string[]): boolean => unique(a) && unique(b) && a.length === b.length && a.every(id => b.includes(id));
function immutable<T>(v: T): T {
  if (v === null || typeof v !== "object" || v instanceof Money || v instanceof Currency || v instanceof DecimalAmount) return v;
  if (Array.isArray(v)) return Object.freeze(v.map(immutable)) as T;
  return Object.freeze(Object.fromEntries(Object.entries(v).map(([k, value]) => [k, immutable(value)]))) as T;
}
class Missing extends Error {
  constructor(readonly code: string, readonly path: string) { super(code); }
}
const need = (ok: boolean, code: string, path: string): void => { if (!ok) throw new Missing(code, path); };
const exact = (m: Money): void => need(m instanceof Money && m.currency.equals(USD) && !m.isNegative() && m.amount.fitsScale(2), "INVALID_EXACT_CENTS", "money");
const date = (d: CivilDate): void => { try { civilDate(d); } catch { throw new Missing("INVALID_DATE", "date"); } };
const remittanceKey = (i: RothRemittanceTerms): string => {
  exact(i.amount);
  return JSON.stringify([i.id, i.jurisdiction, i.amount.toJSON(), i.authorizationId, i.destinationId, i.beneficiaryPersonId, i.route]);
};

/** Pure all-or-none proposal. No calls to pre-tax evaluateWithdrawals, no usage
 * consumption, funding, bank posting, basis persistence or tax calculation. */
export function evaluateRothWithdrawals(input: RothWithdrawalInput): RothWithdrawalEvaluation {
  const refs = new Set<string>(), sources = new Map<string, string>();
  const fail = (code: string, path: string): RothWithdrawalEvaluation => immutable({ ...flags, coverage: "incomplete", candidates: [],
    diagnostics: [{ seam: "S7", diagnosticCode: code, sourceEntityPath: path, affectedOutput: "roth_withdrawal_candidate", coverage: "incomplete", traceRefs: [...refs].sort(cmp) }] });
  try {
    const o = input.order;
    const ordered = evaluateRothOrder(o);
    ordered.proposals.forEach(p => p.traceRefs.forEach(id => refs.add(id)));
    if (ordered.coverage !== "conditional") {
      ordered.diagnostics.forEach(d => d.traceRefs.forEach(id => refs.add(id)));
      return fail(`ROTH_ORDER:${ordered.diagnostics[0]?.diagnosticCode ?? "INCOMPLETE"}`, ordered.diagnostics[0]?.sourceEntityPath ?? "order");
    }
    // Check provenance identity across BOTH seams, including tax jurisdictions.
    const register = (s: WithdrawalSource): void => {
      refs.add(s.id);
      const key = JSON.stringify([s.resourceId, s.personId, s.householdId, s.ruleSnapshotId, s.jurisdiction, s.ruleFamily,
        s.sourcePublication, s.version, s.publishedAt, s.asOf, s.effectiveFrom, s.endExclusive, s.projectionStatus]);
      need(!sources.has(s.id) || sources.get(s.id) === key, "CONFLICTING_SOURCE_ID", s.id);
      sources.set(s.id, key);
    };
    [o.rules!.source, o.completeness!.source, o.contributions.source, o.earnings.source,
      ...o.accounts.flatMap(a => [a.source, a.cash.source]), ...o.vintages.map(v => v.source), ...o.history.map(h => h.source),
      ...o.requests.flatMap(r => [r.source, r.authorization!.source, r.qualification.source])].forEach(register);
    const stamp = (s: WithdrawalSource, resource: string, at: CivilDate, person = o.personId): void => {
      register(s);
      [s.publishedAt, s.asOf, s.effectiveFrom, s.endExclusive].forEach(date);
      need([s.id, s.ruleSnapshotId, s.jurisdiction, s.ruleFamily, s.sourcePublication, s.version].every(text), "MISSING_SOURCE_IDENTITY", resource);
      need(s.householdId === o.householdId && s.personId === person && s.resourceId === resource, "SOURCE_SCOPE", resource);
      need(s.projectionStatus === "verified" && s.publishedAt <= s.asOf && s.asOf <= at && s.asOf <= o.knownAt &&
        s.effectiveFrom <= at && at < s.endExclusive, "UNAVAILABLE_SOURCE", resource);
    };
    need(text(input.batchId) && input.requests.length > 0 && input.requests.length <= 512 && input.banks.length <= 512 && input.cash.length <= 512,
      "INVALID_BATCH", "batchId");
    need(sameIds(input.requests.map(r => r.operationId), o.requests.map(r => r.operationId)), "ORDER_REQUEST_REGISTER", "requests");
    need(sameIds(input.cash.map(c => c.accountId), o.accounts.map(a => a.accountId)) && unique(input.cash.map(c => c.holdingId)), "CASH_REGISTER", "cash");
    need(unique(input.banks.map(b => b.id)), "AMBIGUOUS_BANK", "banks");
    const u = input.usage;
    stamp(u.source, o.householdId, o.snapshotAt, "*");
    need(u.status === "verified_complete" && u.source.asOf === o.snapshotAt, "INCOMPLETE_USAGE", "usage");
    need(sameIds(u.operationIds, o.history.map(h => h.operationId)) && sameIds(u.withdrawalIds, o.history.map(h => h.withdrawalId)) &&
      unique(u.authorizationIds) && o.history.every(h => u.authorizationIds.includes(h.authorizationId)) &&
      unique(u.instructionIds) && unique(u.receiptIds) && unique(u.batchIds), "HISTORY_USAGE_CONFLICT", "usage");
    need(!u.batchIds.includes(input.batchId), "REUSED_BATCH", "batchId");
    const identityRegisters: readonly (readonly [string, readonly string[], readonly string[]])[] = [
      ["instruction", input.requests.map(r => r.instructionId), u.instructionIds],
      ["receipt", input.requests.map(r => r.receiptId), u.receiptIds],
      ["withholding", input.requests.map(r => r.withholding?.id ?? ""), []],
      ["remittance", input.requests.flatMap(r => r.withholding?.instructions.map(i => i.id) ?? []), u.instructionIds],
      ["authorization", input.requests.flatMap(r => [r.authorization?.id ?? "", ...(r.withholding?.instructions.map(i => i.authorizationId) ?? [])]), u.authorizationIds],
    ];
    for (const [name, ids, used] of identityRegisters) need(unique(ids) && ids.every(id => !used.includes(id)), "REUSED_OR_MISSING_IDENTITY", name);
    need(unique(input.requests.flatMap(r => [r.instructionId, ...(r.withholding?.instructions.map(i => i.id) ?? [])])), "REUSED_INSTRUCTION", "requests");
    need(unique([input.batchId, ...input.requests.flatMap(r => [r.operationId, r.withdrawalId, r.instructionId, r.receiptId,
      r.authorization?.id ?? "", r.withholding?.id ?? "", ...(r.withholding?.instructions.flatMap(i => [i.id, i.authorizationId]) ?? [])])]),
    "COLLIDING_IDENTITY_ROLES", "requests");
    const candidates: RothWithdrawalCandidate[] = [];
    // Preserve A3-2's date/explicit-sequence economic ordering.
    for (const p of ordered.proposals) {
      const r = input.requests.find(r => r.operationId === p.operationId)!;
      const path = `requests.${r.operationId}`;
      exact(r.grossAmount);
      need(r.householdId === o.householdId && r.personId === p.personId && r.sourceAccountId === p.sourceAccountId && r.withdrawalId === p.withdrawalId &&
        r.effectiveAt === p.effectiveAt && r.grossAmount.equals(p.gross) && r.grossAmount.isPositive() && r.batchId === input.batchId,
      "ORDER_TERMS_MISMATCH", path);
      need(r.kind === "ordinary" && r.taxBucket === "roth" && r.targetObligationIds.length === 0, "UNSUPPORTED_ROUTE", path);
      stamp(u.source, o.householdId, r.effectiveAt, "*");
      const c = input.cash.find(c => c.accountId === p.sourceAccountId)!;
      const a = o.accounts.find(a => a.accountId === p.sourceAccountId)!;
      need(c.ownerId === p.personId && c.householdId === o.householdId && c.instrumentFamily === "roth_ira" && c.taxBucket === "roth" &&
        c.beneficiaryId === null && c.eligibility === "eligible_ordinary_cash" && c.unsupportedRules.length === 0 && c.holdingId === r.sourceHoldingId &&
        !o.accounts.some(a => a.accountId === c.holdingId), "SOURCE_ACCOUNT_OR_HOLDING", path);
      stamp(c.eligibilitySource, c.accountId, r.effectiveAt); stamp(c.holdingSource, c.holdingId, r.effectiveAt);
      const cash = c.liquidity;
      if (!cash) throw new Missing("MISSING_ACTUAL_CASH", path);
      exact(cash.available); date(cash.at); date(cash.settledAt); stamp(cash.source, c.accountId, r.effectiveAt);
      need(cash.kind === "available_unencumbered_account_cash" && cash.contention === "complete_external_reservations" && cash.at === o.snapshotAt &&
        cash.source.asOf === o.snapshotAt && cash.settledAt <= cash.at && cash.available.equals(a.cash.available), "CASH_SNAPSHOT_MISMATCH", path);
      // A3-2 already applies the cumulative account cash cap against this exact snapshot.
      const b = r.bank, matches = input.banks.filter(bank => bank.id === b.id);
      need(matches.length === 1, "UNMAPPED_BANK", path);
      const bank = matches[0]!;
      stamp(bank.source, bank.id, r.effectiveAt); stamp(b.source, b.id, r.effectiveAt);
      need(text(b.institutionId) && b.institutionId === bank.institutionId && b.kind === bank.kind && b.ownerId === bank.ownerId && b.householdId === bank.householdId &&
        b.source.id === bank.source.id && b.ownerId === p.personId && b.householdId === o.householdId && ["checking", "savings"].includes(b.kind) &&
        !o.accounts.some(a => a.accountId === b.id) && !input.cash.some(c => c.holdingId === b.id), "BANK_ROUTE_MISMATCH", path);
      stamp(r.instructionSource, r.instructionId, r.effectiveAt);
      const w = r.withholding;
      if (!w) throw new Missing("MISSING_WITHHOLDING", path);
      stamp(w.source, w.id, r.effectiveAt);
      need(w.source.asOf === r.effectiveAt && w.completeness === "verified_complete" && w.instructions.length > 0 && unique(w.instructions.map(i => i.jurisdiction)), "INCOMPLETE_WITHHOLDING", path);
      let withheld = Money.zero(USD);
      const instructions = [...w.instructions].sort((a, b) => cmp(a.jurisdiction, b.jurisdiction));
      for (const i of instructions) {
        exact(i.amount); stamp(i.source, i.id, r.effectiveAt); stamp(i.authorizationSource, i.authorizationId, r.effectiveAt);
        need(i.source.jurisdiction === i.jurisdiction && i.authorizationSource.jurisdiction === i.jurisdiction && text(i.destinationId) &&
          !o.accounts.some(a => a.accountId === i.destinationId) && !input.banks.some(b => b.id === i.destinationId) &&
          !input.cash.some(c => c.holdingId === i.destinationId) && i.beneficiaryPersonId === p.personId && i.route === "qualified_tax_payment", "WITHHOLDING_ROUTE", path);
        withheld = withheld.plus(i.amount);
      }
      need(withheld.compare(p.gross) <= 0, "WITHHOLDING_EXCEEDS_GROSS", path);
      const auth = r.authorization;
      if (!auth) throw new Missing("MISSING_AUTHORIZATION", path);
      stamp(auth.source, auth.id, r.effectiveAt); exact(auth.grossAmount);
      need(auth.id === p.authorizationId && auth.operationId === p.operationId && auth.withdrawalId === p.withdrawalId && auth.sourceAccountId === p.sourceAccountId &&
        auth.bankId === b.id && auth.withholdingId === w.id && auth.grossAmount.equals(p.gross) && auth.effectiveAt === p.effectiveAt && auth.routing === "cash_only_all_or_none" &&
        auth.batchId === r.batchId && auth.instructionId === r.instructionId && auth.receiptId === r.receiptId && auth.sourceHoldingId === r.sourceHoldingId &&
        auth.bankInstitutionId === b.institutionId && auth.bankKind === b.kind &&
        sameIds(auth.withholdingTerms.map(remittanceKey), instructions.map(remittanceKey)), "AUTHORIZATION_TERMS", path);
      const net = p.gross.minus(withheld);
      candidates.push({ kind: "ordinary_owner_roth_cash_withdrawal_candidate", committed: false, postable: false, operationId: p.operationId,
        claimId: p.withdrawalId, authorizationId: p.authorizationId, batchId: r.batchId, instructionId: r.instructionId, receiptId: r.receiptId,
        householdId: o.householdId, actorId: p.personId, sourceAccountId: p.sourceAccountId, sourceHoldingId: c.holdingId,
        destinationAccountId: b.id, destinationInstitutionId: b.institutionId, effectiveAt: p.effectiveAt, grossAmount: p.gross,
        netAmount: net, withholdingAmount: withheld, openingAvailableCash: cash.available, rothOrder: p,
        intents: [
          { kind: "source_retirement_cash_decrease", resourceId: c.holdingId, amount: p.gross, jurisdiction: null, beneficiaryPersonId: p.personId, instructionId: r.instructionId, authorizationId: auth.id },
          { kind: "owned_bank_cash_increase", resourceId: b.id, amount: net, jurisdiction: null, beneficiaryPersonId: p.personId, instructionId: r.instructionId, authorizationId: auth.id },
          ...instructions.map(i => ({ kind: "withheld_tax_advance_payment_credit" as const, resourceId: i.destinationId, amount: i.amount,
            jurisdiction: i.jurisdiction, beneficiaryPersonId: p.personId, instructionId: i.id, authorizationId: i.authorizationId })),
        ], incrementalEconomicIncome: Money.zero(USD), incrementalEconomicExpense: Money.zero(USD), principalTransfer: "net_worth_neutral",
        taxCompleteness: "incomplete", executionCondition: "149_atomic_funding_routing_usage_revalidation", traceRefs: [] });
    }
    return immutable({ ...flags, coverage: "conditional", candidates: candidates.map(c => ({ ...c, traceRefs: [...refs].sort(cmp) })), diagnostics: [] });
  } catch (e) {
    if (!(e instanceof Missing) && !(e instanceof TypeError)) throw e;
    return fail(e instanceof Missing ? e.code : "MALFORMED_INPUT", e instanceof Missing ? e.path : "input");
  }
}
