import { accountingTransactionId, createAccountingLeg, createAccountingTransaction, type AccountingLegDraft } from "../../../../src/accounting/index.js";
import { generatedOccurrenceKey } from "../../../../src/identity/index.js";
import { calculationTraceId, calculationTraceRef, freezeTraceRefs } from "../../../../src/lineage/index.js";
import { createAuthoritativeState } from "../../../../src/state/index.js";
import { instant, utcMonthlyPeriods, type Instant } from "../../../../src/time/index.js";
import { money } from "../../../../src/values/index.js";
import { compileHouseholdKernel } from "../../../../src/simulation/householdExecution.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { registerHouseholdBankOriginalProvider, type HouseholdBankOriginalInventory } from "../../../../src/simulation/d2/integration/householdBank/index.js";
import { registerHouseholdExpenseOriginalProvider, type HouseholdExpenseOriginal } from "../../../../src/simulation/d2/integration/householdBank/expenses.js";
import { attachRetirementCash, registerRetirementRawSourcePort, type RetirementCashInput, type RetirementRawSource } from "../../../../src/simulation/d2/integration/retirementCash/index.js";
import { retirementRawSourceDigest } from "../../../../src/simulation/d2/integration/retirementCash/source.js";
import { attachMedicareBank, type ConfirmedMedicareBankPremium } from "../../../../src/simulation/d2/integration/medicareBank/index.js";
import { fixture as retirementFixture, input as retirementInput, rmdInput, ids, source as withdrawalSource } from "../retirementCash/scenario.js";
import { request as medicareRequest, confirmations, person, payable } from "../medicareBank/scenario.js";
import type { MedicareCoordinationRequest } from "../../../../src/simulation/d2/health/medicare/coordination/index.js";
import { sha256 as digestText } from "../../../../src/rules/tax/t1b/contentIdentity.js";

export { ids };
export const bob = ids.other;
const originalMedicare = medicareRequest(), sourceContext = retirementFixture().context;
export const control: { bankReads: number; retirementReads: number; expenseReads: number;
  bank?: (v: HouseholdBankOriginalInventory) => HouseholdBankOriginalInventory | undefined;
  retirement?: (v: RetirementRawSource) => RetirementRawSource | undefined;
  expense?: (v: HouseholdExpenseOriginal) => HouseholdExpenseOriginal | undefined } = { bankReads: 0, retirementReads: 0, expenseReads: 0 };
export function reset() { control.bankReads = control.retirementReads = control.expenseReads = 0;
  delete control.bank; delete control.retirement; delete control.expense; }
const bankAddress = { publisherId: "stage-c-bank", sourceId: "shared-bank" };
// Provider-owned synthetic fixtures are reconstructed independently of candidate/portable bytes.
export function retirementOriginal(rmd = false, month = "2026-06"): RetirementRawSource {
  const f = retirementFixture(1, undefined, month), i = retirementInput(f, `${month}:${rmd ? "rmd" : "plain"}`);
  const requests = i.withdrawals.requests.map(r => ({ ...r, bank: { ...r.bank, ownerId: ids.household,
    householdDestination: { personId: ids.person, source: withdrawalSource(ids.person, ids.person, r.effectiveAt, `membership:${month}`) } } }));
  let cash: RetirementCashInput = { ...i, householdBank: bankAddress, withdrawals: { ...i.withdrawals, requests } };
  const binding = rmdInput(cash);
  if (rmd) cash = { ...cash, withdrawals: binding.withdrawals };
  return { sourceId: `retirement:${month}:${rmd ? "rmd" : "plain"}`, sourceVersion: "v1", cash,
    binding: rmd ? binding : { ...binding, withdrawals: cash.withdrawals, allocations: [], rmd: { ...binding.rmd, requests: [] } },
    priorOperationIds: [], availability: requests.map(r => ({ operationId: r.operationId,
      publishedAt: instant("2025-01-01T00:00:00.000Z"), knownAt: instant(`${r.effectiveAt}T00:00:00.000Z`) })) };
}
export const retirementPlan = (rmd = false) => {
  const raw = retirementOriginal(rmd), ref = { sourceId: raw.sourceId, sourceVersion: raw.sourceVersion, contentDigest: retirementRawSourceDigest(raw) };
  return { ...raw.cash, ...(rmd ? { fundedRmd: { ...ref, horizon: { start: retirementFixture().context.simulationStart,
    end: retirementFixture().context.simulationEnd } } } : { originalSource: ref }) };
};

function relabel(value: unknown): unknown {
  if (typeof value === "string") return value.replaceAll(person(), bob).replaceAll(originalMedicare.premiums.householdId, ids.household)
    .replaceAll(originalMedicare.banks[0]!.accountId, ids.bank);
  if (Array.isArray(value)) return value.map(relabel);
  if (value && Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, relabel(v)]));
  return value;
}
export const request = (month = "2026-06") => relabel(medicareRequest(month)) as MedicareCoordinationRequest;
export const premiums = (month = "2026-06"): readonly ConfirmedMedicareBankPremium[] => confirmations(request(month)).map((b, n) => ({
  ...b, settlementPriority: n + 1, bank: { ...b.bank, accountId: ids.bank, payerId: bob },
  payable: { ...b.payable, liabilityId: payable(n === 0 ? "part_b" : "part_d"), payerId: bob },
  householdExpenseSource: { version: "household-expense-source/v1", bank: bankAddress, beneficiary: bob,
    original: { version: "household-economic-original/v1", family: "medicare", publisherId: "stage-c-CMS",
      sourceId: `CMS:${month}:${b.obligation.part}`, revisionId: "v1", digest: `synthetic-legal:${month}:${b.obligation.part}` } },
}));

/** Reconstruct exact VS2 trace and journals from CMS/enrollment/IRMAA originals. */
export function expenseOriginal(month: string, part: string): HouseholdExpenseOriginal {
  const b = premiums(month).find(b => b.obligation.part === part)!, o = b.obligation;
  const eventAt = instant(`${o.effectiveAt}T00:00:00.000Z`), span = utcMonthlyPeriods(instant(`${month}-01T00:00:00.000Z`), 1)[0]!;
  // This is a source-owned exact journal oracle, not the stream/candidate writer.
  const bindingTrace = `d2:medicare-bank-binding:sha256:${digest(b)}`;
  const refs = [`vs2:expense:${b.expenseId}:base`, `vs2:expense:${b.expenseId}:inflation-assumption`, `vs2:expense:${b.expenseId}:inflation-index:0`,
    ...[...new Set([`d2:medicare-bank-key:${o.claimId}`, bindingTrace, ...o.traceRefs, o.claimId,
      b.bank.evidence.ruleSnapshotId, b.payable.evidence.ruleSnapshotId])].sort(),
    `vs2:expense:${b.expenseId}:inflation-linked`, `vs2:expense:${b.expenseId}:recurrence`];
  const traceRefs = freezeTraceRefs(refs.map(s => calculationTraceRef(calculationTraceId(s))))!;
  const claimId = `obligation:recognition:expense:${b.expenseId}:${eventAt}`;
  const tx = (id: string, type: string, legs: AccountingLegDraft[]) => createAccountingTransaction({ id: accountingTransactionId(id), type,
    date: eventAt, traceRefs, legs: legs.map(l => createAccountingLeg({ ...l, traceRefs })) });
  return { version: "household-expense-original/v1", context: { asOf: sourceContext.asOf, dataCutoff: sourceContext.dataCutoff,
    runId: sourceContext.runId, eventId: `settlement:${claimId}`, eventAt, householdId: ids.household, personId: bob, bankAccountId: ids.bank, direction: "debit" },
    checkedAt: sourceContext.asOf, completeThrough: sourceContext.dataCutoff, completeness: "complete", expenseId: b.expenseId,
    occurrenceId: generatedOccurrenceKey({ scenarioId: sourceContext.scenarioId, primitiveInstanceId: b.primitiveIds.recurrence,
      scheduledAt: eventAt, semanticEffectType: "expense-recognition", economicTargetId: b.expenseId }), claimId, period: span,
    witness: { original: b.householdExpenseSource!.original, source: { kind: "organization", id: `CMS:${o.recipientId}` },
      payer: { kind: "person", id: bob }, beneficiary: bob },
    recognition: tx(`tx:recognition:recognition:expense:${b.expenseId}:${eventAt}`, "expense_recognition", [
      { type: "expense", posting: "debit", amount: o.memberObligation }, { type: "liability", posting: "credit", entityId: b.payable.liabilityId, amount: o.memberObligation }]),
    settlement: tx(`tx:settlement:${claimId}`, "expense_settlement", [
      { type: "liability", posting: "debit", entityId: b.payable.liabilityId, amount: o.memberObligation },
      { type: "cash", posting: "credit", accountId: ids.bank, amount: o.memberObligation, cashFlowClass: "operating" }]) };
}
const sourceSet = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(sourceSet).sort((a, b) => canonicalSerialize(a).localeCompare(canonicalSerialize(b)));
  if (v && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sourceSet(x)]));
  return v;
};
const digest = (v: unknown) => digestText(canonicalSerialize(sourceSet(v)));

export function fixture(cash = "200", months = 1, retirementCash = "1000", sourceOwner = ids.person) {
  const base = retirementFixture(months), state = createAuthoritativeState({ accounts: {
    [ids.ira]: { id: ids.ira, ownerId: sourceOwner, kind: "retirement", cash: money(retirementCash) },
    [ids.bank]: { id: ids.bank, ownerId: ids.household, kind: "checking", cash: money(cash) },
  }, liabilities: Object.fromEntries(["part_b", "part_d"].map(p => [payable(p), { id: payable(p), balance: money("0") }])) });
  const kernel = compileHouseholdKernel({ reconciledOpeningState: state, reconciledPrimitiveState: {}, scenarioBindings: {},
    executionMonths: months, scenarioIdentity: base.context.scenarioId, cashFlowInput: { householdId: ids.household, ownerId: ids.person,
      cashAccountId: ids.bank, expensePayableLiabilityId: payable("part_b"), baseCurrency: base.context.baseCurrency, incomes: [], expenses: [], events: [] } }, base.context.simulationStart);
  return { ...base, state, kernel };
}
export function attached(options: { retirement?: boolean; rmd?: boolean; medicare?: boolean; cash?: string; months?: number } = {}) {
  const f = fixture(options.cash ?? (options.retirement === false || options.medicare === false ? "200" : "400"), options.months);
  let kernel = f.kernel;
  if (options.medicare !== false) kernel = attachMedicareBank({ kernel, request: request(), confirmed: premiums(),
    asOf: request().premiums.period.start, representations: [] }).kernel;
  if (options.retirement !== false) kernel = attachRetirementCash(kernel, retirementPlan(options.rmd)).kernel;
  return { ...f, kernel };
}
export function install() {
  registerHouseholdBankOriginalProvider({ publisherId: bankAddress.publisherId, readOriginals: query => {
    control.bankReads++;
    if (query.sourceId !== bankAddress.sourceId || ![ids.person, bob].includes(query.context.personId)) return undefined;
    const c = query.context, common = { revisionId: "v1", publishedAt: instant("2025-01-01T00:00:00.000Z"), knownAt: instant("2025-01-01T00:00:00.000Z"),
      effectiveFrom: instant("2025-01-01T00:00:00.000Z"), effectiveUntil: instant("2030-01-01T00:00:00.000Z"), status: "active" as const };
    const v: HouseholdBankOriginalInventory = { version: "household-bank-original-inventory/v1", publisherId: bankAddress.publisherId,
      query, checkedAt: c.asOf, completeThrough: c.dataCutoff, completeness: "complete", originals: [
        { ...common, kind: "account", sourceId: "deed", bankAccountId: ids.bank, owner: { kind: "household", id: ids.household }, accountKind: "checking" },
        { ...common, kind: "household", sourceId: "household", householdId: ids.household },
        { ...common, kind: "membership", sourceId: "member", householdId: ids.household, personId: c.personId },
        { ...common, kind: "permission", sourceId: "permission", householdId: ids.household, personId: c.personId, bankAccountId: ids.bank, direction: c.direction }] };
    return control.bank ? control.bank(v) : v;
  } });
  registerRetirementRawSourcePort({ read: ref => {
    control.retirementReads++;
    const m = /^retirement:(\d{4}-\d{2}):(plain|rmd)$/.exec(ref.sourceId);
    if (!m) return undefined;
    const raw = retirementOriginal(m[2] === "rmd", m[1]);
    return control.retirement ? control.retirement(raw) : raw;
  } });
  registerHouseholdExpenseOriginalProvider({ family: "medicare", publisherId: "stage-c-CMS", readOriginal: ref => {
    control.expenseReads++;
    const m = /^CMS:(\d{4}-\d{2}):(part_b|part_d)$/.exec(ref.sourceId);
    if (!m) return undefined;
    const v = expenseOriginal(m[1]!, m[2]!);
    return control.expense ? control.expense(v) : v;
  } });
}
