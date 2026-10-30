import { accountingTransactionId, createAccountingLeg, createAccountingTransaction, type AccountingTransaction } from "../../../../src/accounting/index.js";
import { domainId } from "../../../../src/identity/index.js";
import { calculationTraceId } from "../../../../src/lineage/index.js";
import { createObligation, createRight } from "../../../../src/semantics/claim.js";
import { recognitionId, settlementId } from "../../../../src/semantics/identity.js";
import { createAuthoritativeState, d2SettlementSourceFingerprint, registerD2SettlementSourceAuthority,
  registerHouseholdBankRouteAuthority, registerHouseholdEconomicOriginalAuthority, registerRetirementDistributionSourceAuthority,
  registerSsaMedicareSourceAuthority, retirementDistributionSourceFingerprint,
  type D2SettlementReceipt, type HouseholdBankEventContext, type HouseholdEconomicFamily,
  type D2FsaSettlementReceipt, type D2CardSettlementReceipt,
  type HouseholdEconomicWitness, type NativeHouseholdPostingAttachment, type RetirementDistributionRecord,
  type SsaMedicarePaymentInput } from "../../../../src/state/index.js";
import { instant } from "../../../../src/time/index.js";
import { Money, money } from "../../../../src/values/index.js";
import { fsa, card, ids as baseIds } from "../sharedReceipts/scenario.js";
import { payment, ids as ssaIds } from "../ssaMedicare/scenario.js";

export const ids = { ...baseIds, bob: domainId("person", "28500000-0000-4000-8000-000000000001"),
  ira: domainId("account", "28500000-0000-4000-8000-000000000002") };
export const context = { asOf: instant("2027-12-31T00:00:00.000Z"), dataCutoff: instant("2027-12-31T00:00:00.000Z") };
const known = instant("2025-12-01T00:00:00.000Z");
export const control = { bankReads: 0, economicReads: 0, nativeReads: 0, bankFailAt: 0, economicFailAt: 0, nativeFailAt: 0,
  revoked: false, withdrawn: false, missingNative: false, deniedBob: false };
export const reset = () => Object.assign(control, { bankReads: 0, economicReads: 0, nativeReads: 0,
  bankFailAt: 0, economicFailAt: 0, nativeFailAt: 0, revoked: false, withdrawn: false, missingNative: false, deniedBob: false });
export const opening = (cash = "1500", owner: typeof ids.household | typeof ids.person = ids.household) => createAuthoritativeState({ accounts: {
  [ids.bank]: { id: ids.bank, ownerId: owner, kind: "checking", cash: money(cash) },
  [ids.ira]: { id: ids.ira, ownerId: ids.person, kind: "retirement", cash: money("20000") },
}, liabilities: { [ids.liability]: { id: ids.liability, balance: money("1000") } } });
export type Family = NativeHouseholdPostingAttachment["family"];
type FsaOrCardReceipt = D2FsaSettlementReceipt | D2CardSettlementReceipt;
const key = (family: Family, n: number) => `${family}:${n}`;
const actor = (n: number) => n % 2 === 0 ? ids.person : ids.bob;
const legalActor = (family: Family, n: number) => family === "retirement" || family === "card" && n >= 100 ? ids.person : actor(n);
const pin = { version: "household-bank-route/v1" as const, accountKind: "checking" as const,
  publisherId: "synthetic-bank", sourceId: "shared-bank", revisionId: "deed/v1", digest: "synthetic-independent-deed" };

/** Pure provider-owned fixtures, reconstructed from lookup IDs. The registered
 * authorities never return a caller's journal, digest, receipt or context. */
function raw(family: Family, n: number) {
  const person = legalActor(family, n), label = key(family, n);
  if (family === "fsa" || family === "card") {
    const receipt = family === "fsa" ? fsa(label) : card(label);
    const source = { ...receipt.source, personId: person, executionOrder: { sequenceId: "synthetic-bank-order", position: n } };
    return { ...receipt, source, sourceEvidenceFingerprint: d2SettlementSourceFingerprint(source),
      ...(family === "card" && n >= 100 ? { bankCashBefore: money((20000n - 200n * BigInt(n - 100)).toString()),
        liabilityBefore: money((20000n - 180n * BigInt(n - 100)).toString()) } : {}) } as D2SettlementReceipt;
  }
  if (family === "retirement") {
    const txId = accountingTransactionId(`retirement:${n}`);
    const source = { sourceId: label, sourceVersion: "synthetic/v1", ruleVersion: "synthetic/v1", publishedAt: known, knownAt: known,
      householdId: ids.household, personId: person, sourceApprovalId: `source:${label}`, paymentApprovalId: `payment:${label}`,
      executionOrder: { sequenceId: "retirement-order", position: n } };
    const obligation = { personId: person, accountId: ids.ira, taxYear: 2026, ruleSnapshotId: "synthetic-rmd", required: money("500") };
    return { version: "retirement-distribution/v1", transactionId: txId, originalPostingProofId: txId,
      operationId: `op:${label}`, withdrawalId: `withdraw:${label}`, authorizationId: `auth:${label}`,
      householdId: ids.household, personId: person, sourceAccountId: ids.ira, destinationAccountId: ids.bank,
      effectiveAt: instant("2026-06-15T00:00:00.000Z"), taxYear: 2026, gross: money("500"), netBank: money("500"), withholding: money("0"),
      instrumentFamily: "traditional_ira", taxBucket: "pretax", beneficiaryId: null, distributionKind: "ordinary_cash", source,
      sourceEvidenceFingerprint: retirementDistributionSourceFingerprint(source), traceIds: [calculationTraceId(label)],
      allocations: [{ allocationId: `allocation:${label}`, approvalId: `allocation-approval:${label}`,
        obligationId: JSON.stringify([person, 2026, ["account", ids.ira], obligation.ruleSnapshotId]), satisfiesRmdYear: 2026,
        sourceAccountId: ids.ira, amount: money("1"), deadline: instant("2026-12-31T00:00:00.000Z"), firstYear: false, deferred: false,
        ruleVersion: "synthetic/v1", sourceId: `rmd:${label}`, obligation }], rmdSatisfaction: "not_applied", tax: "incomplete" } satisfies RetirementDistributionRecord;
  }
  const periodIndex = n === 24 ? 0 : n;
  const month = `${2026 + Math.floor(periodIndex / 12)}-${String(periodIndex % 12 + 1).padStart(2, "0")}`;
  // Relabel the existing semantic SSA fixture; Money remains exact and claims
  // are independently constructed from the payable/premium originals below.
  const map = (v: unknown): unknown => v instanceof Money ? v : typeof v === "string"
    ? v.replaceAll(ssaIds.household, ids.household).replaceAll(ssaIds.person, person).replaceAll(ssaIds.bank, ids.bank)
    : Array.isArray(v) ? v.map(map) : v !== null && typeof v === "object"
      ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, map(x)])) : v;
  const q = map(payment(month)) as ReturnType<typeof payment>;
  const p = n === 24 ? { ...q.payable, grossPayable: money("200") } : q.payable;
  const right = createRight({ id: p.rightClaimId, category: "ssa_benefit_payable", originatingRecognitionId: recognitionId(p.rightRecognitionId),
    economicOwnerId: person, originalAmount: p.grossPayable, recognizedAt: p.paymentAt, dueAt: p.paymentAt });
  const requests = q.deductions.map(({ terms, draft }) => ({ terms, draft, claim: createObligation({ id: terms.obligationId,
    category: "medicare_premium", originatingRecognitionId: recognitionId(terms.obligationRecognitionId), economicOwnerId: person,
    originalAmount: terms.amount, recognizedAt: p.paymentAt, dueAt: p.paymentAt }) }));
  return { payable: p, right, requests, bankAccountId: ids.bank, bankCashBefore: money((2000n + 1300n * BigInt(periodIndex)).toString()),
    rightSettlementId: settlementId(q.rightSettlementId), sourceInputs: { sourceId: label, originalSources: { mode: "synthetic-source-originals/v2" } } } satisfies SsaMedicarePaymentInput;
}
export const journal = (family: Family, n: number, role: "original" | "settlement" = "original"): AccountingTransaction => {
  const r = raw(family, n);
  if ("originalTransaction" in r) return role === "original" ? r.originalTransaction! : r.paymentTransaction!;
  if ("gross" in r && r.gross && r.netBank && r.transactionId && r.effectiveAt) return createAccountingTransaction({ id: r.transactionId, type: "retirement_cash_transfer", date: r.effectiveAt, legs: [
    createAccountingLeg({ type: "cash", posting: "debit", amount: r.netBank, accountId: ids.bank, cashFlowClass: "investing" }),
    createAccountingLeg({ type: "cash", posting: "credit", amount: r.gross, accountId: ids.ira, cashFlowClass: "investing" }),
  ] });
  if (!("payable" in r) || r.payable === undefined) throw new Error("Native SSA fixture lacks original payable");
  const net = r.payable.grossPayable.minus(money("200"));
  return createAccountingTransaction({ id: accountingTransactionId(`ssa-medicare:${r.payable.paymentId}`), type: "ssa_medicare_same_event", date: r.payable.paymentAt,
    legs: [...(net.isZero() ? [] : [createAccountingLeg({ type: "cash", posting: "debit", amount: net, accountId: ids.bank, cashFlowClass: "operating" })]),
      createAccountingLeg({ type: "expense", posting: "debit", amount: money("200") }),
      createAccountingLeg({ type: "income", posting: "credit", amount: r.payable.grossPayable })] });
};
export function attachment(family: Family, n = 0, role: "original" | "settlement" = "original"): NativeHouseholdPostingAttachment {
  const tx = journal(family, n, role), personId = legalActor(family, n), nonbank = family === "card" && role === "original";
  const c: HouseholdBankEventContext = { ...context, runId: "synthetic-native-run", eventId: `${key(family, n)}:${role}`,
    eventAt: tx.date, householdId: ids.household, personId, bankAccountId: ids.bank,
    direction: family === "ssa" || family === "retirement" || family === "fsa" && role === "settlement" ? "credit" : "debit" };
  const families: HouseholdEconomicFamily[] = family === "ssa" ? ["ssa", "medicare"] : [family];
  const source = family === "retirement" ? { kind: "account" as const, id: ids.ira }
    : { kind: "organization" as const, id: family === "card" ? "synthetic-issuer" : family === "fsa" ? "synthetic-plan" : "synthetic-SSA" };
  const originals: HouseholdEconomicWitness[] = families.map(f => ({ original: { version: "household-economic-original/v1", family: f,
    publisherId: "synthetic-native-originals", sourceId: `${key(family, n)}:${role}`, revisionId: "v1", digest: `synthetic:${f}:${n}:${role}` },
    source, payer: c.direction === "debit" && !nonbank || family === "retirement" ? { kind: "person", id: personId } : source, beneficiary: personId }));
  return { version: "native-household-posting/v1", transactionId: tx.id, family, cashRole: nonbank ? "nonbank" : "bank",
    context: c, ...(nonbank ? {} : { route: pin }), originals };
}
export const ssa = (n = 0): SsaMedicarePaymentInput => ({ ...raw("ssa", n) as SsaMedicarePaymentInput, nativeHousehold: attachment("ssa", n) });
export const retirement = (n = 0): RetirementDistributionRecord => ({ ...raw("retirement", n) as RetirementDistributionRecord,
  version: "retirement-distribution/v2", nativeHousehold: attachment("retirement", n) });
export const receipt = (family: "fsa" | "card", n = 0): FsaOrCardReceipt => ({ ...raw(family, n) as FsaOrCardReceipt,
  schemaVersion: "d2-shared/settlement-receipt/v2", nativeHousehold: { original: attachment(family, n), settlement: attachment(family, n, "settlement") } });
export const legacy = { ssa: (n = 0) => raw("ssa", n) as SsaMedicarePaymentInput,
  retirement: (n = 0): RetirementDistributionRecord => {
    const r = raw("retirement", n) as RetirementDistributionRecord, source = { ...r.source, sourceVersion: "synthetic-legacy/v1" };
    return { ...r, source, sourceEvidenceFingerprint: retirementDistributionSourceFingerprint(source) };
  },
  receipt: (family: "fsa" | "card", n = 0): FsaOrCardReceipt => {
    const r = raw(family, n) as FsaOrCardReceipt, source = { ...r.source, sourceVersion: "synthetic-legacy/v1" };
    return { ...r, source, sourceEvidenceFingerprint: d2SettlementSourceFingerprint(source) } as FsaOrCardReceipt;
  } };
const parse = (id: string) => /^(ssa|retirement|fsa|card):(\d+)(?::(original|settlement))?$/.exec(id);
export function install(): void {
  registerHouseholdBankRouteAuthority({ qualify: (p, c) => {
    control.bankReads++;
    return !control.revoked && control.bankReads !== control.bankFailAt && (!control.deniedBob || c.personId !== ids.bob) &&
      JSON.stringify(p) === JSON.stringify(pin) && c.householdId === ids.household && [ids.person, ids.bob].includes(c.personId) &&
      c.bankAccountId === ids.bank && c.dataCutoff >= known && c.asOf === context.asOf && c.dataCutoff <= c.asOf;
  } });
  for (const family of ["ssa", "medicare", "retirement", "fsa", "card"] as const) registerHouseholdEconomicOriginalAuthority(family, "synthetic-native-originals", {
    qualify: ref => {
      control.economicReads++;
      if (control.withdrawn || control.economicReads === control.economicFailAt) return undefined;
      const match = parse(ref.sourceId);
      if (!match || !match[3]) return undefined;
      const f = match[1] as Family, n = Number(match[2]), role = match[3] as "original" | "settlement";
      const a = attachment(f, n, role), witness = a.originals.find(w => w.original.family === family);
      const r = raw(f, n);
      const nativeSource = "originalTransaction" in r && r.kind === "fsa_paid_reimbursement"
        ? { kind: r.kind, planId: r.source.planId, planYearId: r.source.planYearId, memberId: r.source.memberId,
          payeeId: r.source.payeeId, medicalReceiptId: r.source.medicalReceiptId, expensePaymentId: r.source.expensePaymentId }
        : "originalTransaction" in r && r.kind === "card_interest_payment"
          ? { kind: r.kind, issuerId: r.source.issuerId, statementId: r.source.statementId, chargeId: r.source.chargeId, liabilityId: r.liabilityId } : undefined;
      return witness ? { witness, transaction: journal(f, n, role), context: a.context, requiredFamilies: a.originals.map(w => w.original.family),
        ...(nativeSource === undefined ? {} : { nativeSource }) } : undefined;
    },
  });
  const available = () => { control.nativeReads++; return !control.missingNative && control.nativeReads !== control.nativeFailAt; };
  registerSsaMedicareSourceAuthority(inputs => {
    if (!available()) throw new Error("SYNTHETIC_SSA_ORIGINAL_WITHDRAWN");
    const match = parse((inputs as { sourceId: string }).sourceId);
    if (!match || match[1] !== "ssa") throw new Error("UNKNOWN_SYNTHETIC_SSA_ORIGINAL");
    const value = ssa(Number(match[2]));
    // Separate legacy source fixture is selected by its original lookup ID.
    return (inputs as { legacy?: boolean }).legacy ? { ...legacy.ssa(Number(match[2])), sourceInputs: inputs } : value;
  });
  registerRetirementDistributionSourceAuthority({ qualify: source => {
    const match = parse(source.sourceId.replace(/^source:/, ""));
    if (!available() || !match || match[1] !== "retirement") return { status: "incomplete", reason: "source_not_qualified" };
    return { status: "qualified", distribution: source.sourceVersion === "synthetic-legacy/v1" ? legacy.retirement(Number(match[2])) : retirement(Number(match[2])) };
  } });
  for (const f of ["fsa", "card"] as const) registerD2SettlementSourceAuthority(f === "fsa" ? "fsa_paid_reimbursement" : "card_interest_payment", {
    qualify: source => {
      const match = parse(source.sourceId.replace(/^source:/, ""));
      if (!available() || !match || match[1] !== f) return { status: "incomplete", reason: "source_not_qualified" };
      return { status: "qualified", receipt: source.sourceVersion === "synthetic-legacy/v1" ? legacy.receipt(f, Number(match[2])) : receipt(f, Number(match[2])) };
    },
  });
}
