import { registerHouseholdBankRouteAuthority, type HouseholdBankEventContext, type HouseholdBankRoutePin } from "../../../../state/index.js";
import { sha256 } from "../../../../rules/tax/t1b/contentIdentity.js";
import { instant, type Instant } from "../../../../time/index.js";
import { failValidation } from "../../../../diagnostics/index.js";

export type { HouseholdBankEventContext, HouseholdBankRoutePin } from "../../../../state/index.js";

interface Publication {
  readonly sourceId: string;
  readonly revisionId: string;
  readonly publishedAt: Instant;
  readonly knownAt: Instant;
  readonly effectiveFrom: Instant;
  readonly effectiveUntil: Instant;
  readonly status: "active" | "revoked";
}
/** Four independently sourced facts. Neither a household name/roster nor a
 * BANK's owner field establishes membership or permission. */
export type HouseholdBankOriginal = Publication & (
  { readonly kind: "account"; readonly bankAccountId: string; readonly owner: { readonly kind: "household" | "person"; readonly id: string };
    readonly accountKind: "checking" | "savings" | "other" }
  | { readonly kind: "household"; readonly householdId: string }
  | { readonly kind: "membership"; readonly householdId: string; readonly personId: string }
  | { readonly kind: "permission"; readonly householdId: string; readonly personId: string; readonly bankAccountId: string;
    readonly direction: "credit" | "debit" });
export interface HouseholdBankOriginalQuery {
  readonly sourceId: string;
  readonly context: HouseholdBankEventContext;
}
export interface HouseholdBankOriginalInventory {
  readonly version: "household-bank-original-inventory/v1";
  readonly publisherId: string;
  readonly query: HouseholdBankOriginalQuery;
  readonly checkedAt: Instant;
  readonly completeThrough: Instant;
  readonly completeness: "complete";
  /** Complete revision history for the requested facts, including revocations.
   * Complete permission absence requires the explicit scoped attestation below. */
  readonly originals: readonly HouseholdBankOriginal[];
  readonly permissionInventory?: "complete_for_exact_query";
}
export interface HouseholdBankOriginalProvider {
  readonly publisherId: string;
  readonly readOriginals: (query: HouseholdBankOriginalQuery) => HouseholdBankOriginalInventory | undefined;
}
const providers = new Map<string, HouseholdBankOriginalProvider>();
const snapshot = <T>(value: T): T => {
  if (Array.isArray(value)) return Object.freeze(value.map(snapshot)) as T;
  if (value !== null && typeof value === "object")
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([k, v]) => [k, snapshot(v)]))) as T;
  return value;
};
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
};
const token = (s: string): boolean => typeof s === "string" && s.trim().length > 0 && s.length <= 256;
function need(ok: boolean): asserts ok {
  if (!ok) failValidation({ severity: "error", code: "HOUSEHOLD_BANK_ORIGINAL_NOT_ADMITTED",
    entityType: "household_bank_original", message: "HOUSEHOLD_BANK_ORIGINAL_NOT_ADMITTED" });
}
const kinds = ["account", "household", "membership", "permission"] as const;

export type HouseholdBankRouteAdmission =
  | { readonly kind: "qualified"; readonly pin: HouseholdBankRoutePin; readonly inventoryDigest: string }
  | { readonly kind: "debit_permission_denied"; readonly inventoryDigest: string; readonly accountKind: "checking" | "savings" };

function assertDebitHistoryIdentity(original: HouseholdBankOriginal, context: HouseholdBankEventContext): void {
  switch (original.kind) {
    case "account":
      need(original.bankAccountId === context.bankAccountId && original.owner.kind === "household" &&
        original.owner.id === context.householdId && (original.accountKind === "checking" || original.accountKind === "savings"));
      break;
    case "household":
      need(original.householdId === context.householdId);
      break;
    case "membership":
      need(original.householdId === context.householdId && original.personId === context.personId);
      break;
    case "permission":
      need(original.householdId === context.householdId && original.personId === context.personId &&
        original.bankAccountId === context.bankAccountId && (original.direction === "credit" || original.direction === "debit"));
      break;
  }
}

function readAdmission(publisherId: string, sourceId: string, context: HouseholdBankEventContext,
  checkedDebit: boolean): HouseholdBankRouteAdmission {
  instant(context.asOf); instant(context.dataCutoff); instant(context.eventAt);
  need(token(publisherId) && token(sourceId) && context.dataCutoff <= context.asOf);
  const provider = providers.get(publisherId);
  need(provider !== undefined);
  const query = snapshot({ sourceId, context });
  let fetched: HouseholdBankOriginalInventory | undefined;
  try {
    fetched = provider.readOriginals(query);
  } catch (error) {
    if (!checkedDebit) throw error;
    need(false);
  }
  need(fetched !== undefined);
  const h = snapshot(fetched);
  need(h.version === "household-bank-original-inventory/v1" && h.publisherId === publisherId &&
    h.completeness === "complete" && h.checkedAt === context.asOf && h.completeThrough === context.dataCutoff &&
    canonical(h.query) === canonical(query) && Array.isArray(h.originals) && h.originals.length <= 1200);
  const admitsAbsence = checkedDebit && h.permissionInventory === "complete_for_exact_query";
  need(h.originals.length >= (admitsAbsence ? 3 : 4));
  if (checkedDebit) need(h.originals.every(o => (o.status === "active" || o.status === "revoked") &&
    (o.effectiveFrom > context.eventAt || o.publishedAt <= context.asOf && o.knownAt <= context.dataCutoff)));
  const selected: HouseholdBankOriginal[] = [];
  for (const kind of kinds) {
    const revisions = h.originals.filter(o => o.kind === kind);
    if (kind === "permission" && admitsAbsence && revisions.length === 0) continue;
    need(revisions.length > 0 && new Set(revisions.map(o => o.revisionId)).size === revisions.length &&
      new Set(revisions.map(o => o.sourceId)).size === 1);
    for (const o of revisions) {
      instant(o.publishedAt); instant(o.knownAt); instant(o.effectiveFrom); instant(o.effectiveUntil);
      need(token(o.sourceId) && token(o.revisionId) && o.publishedAt <= o.knownAt && o.effectiveFrom < o.effectiveUntil);
      if (checkedDebit) assertDebitHistoryIdentity(o, context);
    }
    if (checkedDebit) need(new Set(revisions.map(o => o.publishedAt)).size === revisions.length);
    // Publication order is source truth; ties are ambiguous, never resolved by
    // iteration, revision-name sort or caller pins. Revisions can revoke or
    // amend retroactively once known at the authentic observation boundary.
    const eligible = revisions.filter(o => o.publishedAt <= context.asOf && o.knownAt <= context.dataCutoff &&
      o.effectiveFrom <= context.eventAt).sort((a, b) => a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0);
    const o = eligible[0];
    need(o !== undefined && (eligible[1] === undefined || eligible[1].publishedAt !== o.publishedAt) &&
      o.status === "active" && context.eventAt < o.effectiveUntil);
    selected.push(o);
  }
  need(h.originals.every(o => kinds.includes(o.kind)));
  const account = selected[0]!, household = selected[1]!, member = selected[2]!, permission = selected[3];
  need(account.kind === "account" && account.bankAccountId === context.bankAccountId &&
    (account.owner.kind === "household" && account.owner.id === context.householdId ||
      account.owner.kind === "person" && account.owner.id === context.personId && context.direction === "credit") &&
    (account.accountKind === "checking" || account.accountKind === "savings"));
  need(household.kind === "household" && household.householdId === context.householdId);
  need(member.kind === "membership" && member.householdId === context.householdId && member.personId === context.personId);
  if (permission !== undefined) need(permission.kind === "permission" && permission.householdId === context.householdId &&
    permission.personId === context.personId && permission.bankAccountId === context.bankAccountId);
  const inventoryDigest = checkedDebit ? `sha256:${sha256(canonical({ ...h, originals: h.originals.map(canonical).sort() }))}` : "";
  if (checkedDebit && (permission === undefined || permission.kind === "permission" && permission.direction === "credit"))
    return Object.freeze({ kind: "debit_permission_denied", inventoryDigest, accountKind: account.accountKind });
  need(permission?.kind === "permission" && permission.direction === context.direction);
  const pin: HouseholdBankRoutePin = Object.freeze({ version: "household-bank-route/v1", accountKind: account.accountKind, publisherId, sourceId, revisionId: permission.revisionId,
    digest: `sha256:${sha256(canonical(selected))}`,
    ...(account.owner.kind === "person" ? { personOwnerId: context.personId } : {}) });
  return Object.freeze({ kind: "qualified", pin, inventoryDigest });
}

function read(publisherId: string, sourceId: string, context: HouseholdBankEventContext): HouseholdBankRoutePin {
  const admission = readAdmission(publisherId, sourceId, context, false);
  need(admission.kind === "qualified");
  return admission.pin;
}

/** Composition root registers independently controlled original publishers.
 * No provider, source inventory or callback travels in state/replay artifacts. */
export function registerHouseholdBankOriginalProvider(provider: HouseholdBankOriginalProvider): void {
  need(token(provider.publisherId) && !providers.has(provider.publisherId));
  if (providers.size === 0) registerHouseholdBankRouteAuthority({ qualify: (pin, context) => {
    try { return canonical(read(pin.publisherId, pin.sourceId, context)) === canonical(pin); } catch { return false; }
  } });
  providers.set(provider.publisherId, Object.freeze({ publisherId: provider.publisherId, readOriginals: provider.readOriginals.bind(provider) }));
}

/** A compact pin derived from a registered original, not caller-authored facts.
 * State re-reads this independently around the actual canonical commit. */
export const qualifyHouseholdBankRoute = (publisherId: string, sourceId: string,
  context: HouseholdBankEventContext): HouseholdBankRoutePin => read(publisherId, sourceId, context);

/** Invalid or indeterminate originals throw. A denial carries no posting pin. */
export function checkHouseholdBankDebitAdmission(publisherId: string, sourceId: string,
  context: HouseholdBankEventContext & { readonly direction: "debit" }): HouseholdBankRouteAdmission {
  need(context.direction === "debit");
  return readAdmission(publisherId, sourceId, context, true);
}
