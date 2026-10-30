import { accountingTransactionId, createAccountingLeg, createAccountingTransaction } from "../../../../src/accounting/index.js";
import { domainId } from "../../../../src/identity/index.js";
import { createAuthoritativeState, registerHouseholdEconomicOriginalAuthority,
  type HouseholdBankEventContext, type HouseholdDomainPostingEvidence, type HouseholdEconomicFamily,
  type HouseholdEconomicOriginalAuthority } from "../../../../src/state/index.js";
import { qualifyHouseholdBankRoute, registerHouseholdBankOriginalProvider,
  type HouseholdBankOriginal, type HouseholdBankOriginalInventory, type HouseholdBankOriginalQuery } from "../../../../src/simulation/d2/integration/householdBank/index.js";
import { instant } from "../../../../src/time/index.js";
import { money } from "../../../../src/values/index.js";

export const ids = {
  household: domainId("household", "27600000-0000-4000-8000-000000000001"),
  alice: domainId("person", "27600000-0000-4000-8000-000000000002"),
  bob: domainId("person", "27600000-0000-4000-8000-000000000003"),
  bank: domainId("account", "27600000-0000-4000-8000-000000000004"),
};
export const boundary = instant("2026-06-01T00:00:00.000Z");
const first = instant("2020-01-01T00:00:00.000Z"), last = instant("2040-01-01T00:00:00.000Z");
export const opening = () => createAuthoritativeState({ accounts: { [ids.bank]: {
  id: ids.bank, ownerId: ids.household, kind: "checking", cash: money("100") } } });
export const context = (n = 0, personId = ids.alice, direction: "credit" | "debit" = "credit"): HouseholdBankEventContext => ({
  runId: "synthetic-run", eventId: `event:${n}`, eventAt: boundary, asOf: boundary, dataCutoff: boundary,
  householdId: ids.household, personId, bankAccountId: ids.bank, direction,
});
export function originalFacts(q: HouseholdBankOriginalQuery): HouseholdBankOriginal[] {
  const c = q.context, base = { revisionId: "original/v1", publishedAt: first, knownAt: first,
    effectiveFrom: first, effectiveUntil: last, status: "active" as const };
  return [
    { ...base, sourceId: "bank-deed", kind: "account", bankAccountId: ids.bank,
      owner: { kind: "household", id: ids.household }, accountKind: "checking" },
    { ...base, sourceId: "household-declaration", kind: "household", householdId: ids.household },
    { ...base, sourceId: `member:${c.personId}`, kind: "membership", householdId: ids.household, personId: c.personId },
    { ...base, sourceId: `permission:${c.personId}:${c.direction}`, kind: "permission", householdId: ids.household,
      personId: c.personId, bankAccountId: ids.bank, direction: c.direction },
  ];
}
export const control: {
  bankReads: number; economicReads: number;
  bankChange?: (h: HouseholdBankOriginalInventory) => HouseholdBankOriginalInventory | undefined;
  economicChange?: (v: NonNullable<ReturnType<HouseholdEconomicOriginalAuthority["qualify"]>>) => ReturnType<HouseholdEconomicOriginalAuthority["qualify"]>;
} = { bankReads: 0, economicReads: 0 };
export function reset(): void {
  control.bankReads = 0; control.economicReads = 0;
  delete control.bankChange; delete control.economicChange;
}
/** Synthetic domain-owned source archive. It reconstructs rather than accepting
 * caller transaction/economic party inputs. Larger source appendices stay here. */
export function reconstruct(n = 0, personId = ids.alice, direction: "credit" | "debit" = "credit",
  families: readonly HouseholdEconomicFamily[] = ["wage"]) {
  const c = context(n, personId, direction), amount = money("1");
  const transaction = createAccountingTransaction({ id: accountingTransactionId(`posting:${n}`), type: "synthetic_domain_original", date: boundary,
    legs: [createAccountingLeg({ type: "cash", posting: direction === "credit" ? "debit" : "credit", accountId: ids.bank, amount, cashFlowClass: "operating" }),
      createAccountingLeg({ type: direction === "credit" ? "income" : "expense", posting: direction === "credit" ? "credit" : "debit", amount })] });
  const originals = families.map(family => ({
    original: { version: "household-economic-original/v1" as const, family, publisherId: "synthetic-employer",
      sourceId: `domain:${n}:${personId}:${direction}:${families.join("+")}`, revisionId: "v1", digest: `synthetic-event:${n}` },
    source: { kind: "organization" as const, id: "synthetic-domain-source" },
    payer: { kind: "organization" as const, id: "synthetic-payer" }, beneficiary: personId,
  }));
  return { c, transaction, originals };
}
export function install(): void {
  registerHouseholdBankOriginalProvider({ publisherId: "synthetic-bank", readOriginals: query => {
    control.bankReads++;
    const value: HouseholdBankOriginalInventory = { version: "household-bank-original-inventory/v1", publisherId: "synthetic-bank",
      query, checkedAt: query.context.asOf, completeThrough: query.context.dataCutoff, completeness: "complete", originals: originalFacts(query) };
    return control.bankChange ? control.bankChange(value) : value;
  } });
  for (const family of ["wage", "payroll_health"] as const) registerHouseholdEconomicOriginalAuthority(family, "synthetic-employer", {
    qualify: (ref, c) => {
      control.economicReads++;
      const match = /^domain:(\d+):(.+):(credit|debit):(.+)$/.exec(ref.sourceId);
      if (!match) return undefined;
      const n = Number(match[1]), person = match[2] === ids.alice ? ids.alice : match[2] === ids.bob ? ids.bob : undefined;
      if (!person) return undefined;
      const r = reconstruct(n, person, match[3] as "credit" | "debit", match[4]!.split("+") as HouseholdEconomicFamily[]);
      const witness = r.originals.find(o => o.original.family === family);
      if (!witness) return undefined;
      const value = { witness, transaction: r.transaction, context: r.c,
        requiredFamilies: r.originals.map(o => o.original.family) };
      return control.economicChange ? control.economicChange(value) : value;
    },
  });
}
export function event(n = 0, personId = ids.alice, direction: "credit" | "debit" = "credit",
  families: readonly HouseholdEconomicFamily[] = ["wage"]) {
  const r = reconstruct(n, personId, direction, families);
  const evidence: HouseholdDomainPostingEvidence = { version: "household-domain-posting/v1", context: r.c,
    route: qualifyHouseholdBankRoute("synthetic-bank", "household-bank", r.c), originals: r.originals };
  return { transaction: r.transaction, evidence };
}
