import { sha256 } from "../../../../../rules/tax/t1b/contentIdentity.js";
import { civilDate, type CivilDate } from "../../../../../time/index.js";
import { money } from "../../../../../values/index.js";
import { canonicalSerialize } from "../../../../run.js";
import { immutableConfiguration } from "../../../../r3/compiledHousehold.js";
import type { TipsOutput, TipsRequest, TipsSource } from "../index.js";
import { bindTipsSources, tipsOriginalDigest, type TipsOriginal, type TipsIdentity } from "../sourceBinding/index.js";
import type { TipsOriginalBinding, TipsOriginalCode, TipsOriginalProviders, TipsOriginalResult, TipsOriginalRole,
  TipsRoleOriginal, TipsOriginalQuery } from "./types.js";
export type * from "./types.js";

const roles = ["security", "terms", "ownership", "basis", "funding", "cpi", "law", "history"] as const;
const outputs: readonly TipsOutput[] = ["indexation", "basis", "computed_coupon", "maturity", "federal_tax", "state_tax", "settlement"];
const cmp = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const same = (a: unknown, b: unknown): boolean => canonicalSerialize(a) === canonicalSerialize(b);
const id = (s: string): boolean => typeof s === "string" && s.trim().length > 0 && s.length <= 200;
const hash = (v: unknown): string => sha256(canonicalSerialize(v));
// Original arrays are inventories; order never conveys precedence.
const normalize = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(normalize).sort((a, b) => cmp(canonicalSerialize(a), canonicalSerialize(b)));
  if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype)
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalize(x)]));
  return v;
};
export const tipsRoleOriginalDigest = <K extends TipsOriginalRole>(o: TipsRoleOriginal<K>): string =>
  `tips-role-original/v1:sha256:${hash(normalize(o))}`;
class Refused extends Error { constructor(readonly code: TipsOriginalCode) { super(code); } }
const need = (ok: boolean, code: TipsOriginalCode): void => { if (!ok) throw new Refused(code); };
const position = (i: TipsIdentity): unknown => [i.householdId, i.personId, i.wrapperId, i.holdingId, i.lotId];
const month = (at: CivilDate, offset: number): CivilDate => {
  const n = Number(at.slice(0, 4)) * 12 + Number(at.slice(5, 7)) - 1 + offset;
  const y = Math.floor(n / 12);
  return civilDate(`${String(y).padStart(4, "0")}-${String(n - y * 12 + 1).padStart(2, "0")}-01`);
};
/** Check unused competing revisions too; verified flags alone are not authentication. */
const dated = (v: unknown, cutoff: CivilDate): void => {
  if (Array.isArray(v)) { for (const x of v) dated(x, cutoff); return; }
  if (!v || typeof v !== "object" || Object.getPrototypeOf(v) !== Object.prototype) return;
  const r = v as Record<string, unknown>;
  if (r.ruleFamily === "tips") {
    const s = v as TipsSource;
    for (const d of [s.start, s.endExclusive, s.publishedAt, s.asOf]) civilDate(d);
    need(s.projectionStatus === "verified" && [s.sourceId, s.version, s.ruleSnapshotId, s.sourcePublication, s.jurisdiction].every(id)
      && s.start < s.endExclusive && s.publishedAt <= s.asOf && s.asOf <= cutoff, "CHRONOLOGY_INVALID");
  }
  for (const x of Object.values(r)) dated(x, cutoff);
};

/** Trusted role registrations supply originals; digests only pin their content.
 * The unchanged source binder alone invokes proposeTips. No economic formulas here. */
export function bindTipsOriginals(input: readonly TipsOriginalBinding[], providers: TipsOriginalProviders): TipsOriginalResult {
  if (input.length > 256) throw new RangeError("TIPS_ORIGINAL_BATCH_LIMIT");
  const bindings = immutableConfiguration(input);
  const occurrences: TipsOriginalResult["occurrences"][number][] = [];
  const diagnostics: TipsOriginalResult["diagnostics"][number][] = [];
  const keys = (b: TipsOriginalBinding): string[] => [
    [b.identity.householdId, "event", b.event.occurrenceId], [b.identity.householdId, "operation", b.event.operationId],
    [b.identity.householdId, "claim", b.event.claimId], [position(b.identity), b.event.effectiveAt],
  ].map(canonicalSerialize);
  const counts = new Map<string, number>();
  for (const b of bindings) for (const k of keys(b)) counts.set(k, (counts.get(k) ?? 0) + 1);
  for (const b of [...bindings].sort((a, c) => cmp(canonicalSerialize(a), canonicalSerialize(c)))) {
    try {
      const e = b.event, i = b.identity;
      need(b.contractVersion === "tips-original-binding/v1" && [...Object.values(i), e.occurrenceId, e.operationId, e.claimId].every(id), "INVALID_BINDING");
      for (const d of [e.effectiveAt, e.knownAt, e.period.start, e.period.endExclusive]) civilDate(d);
      need(e.effectiveMonth === e.effectiveAt.slice(0, 7) && e.effectiveAt <= e.knownAt
        && e.period.start < e.effectiveAt && e.effectiveAt < e.period.endExclusive, "INVALID_BINDING");
      need(keys(b).every(k => counts.get(k) === 1) && !bindings.some(other => other !== b
        && same(position(other.identity), position(i)) && other.event.period.start < e.effectiveAt
        && e.period.start < other.event.effectiveAt), "DUPLICATE_CLAIM");
      for (const role of roles) {
        const p = providers[role];
        need(Boolean(p && p.authority === role && p.producerId === b.originals[role]?.producerId), "PROVIDER_REQUIRED");
      }
      need(new Set(roles.map(r => providers[r]!.producerId)).size === roles.length
        && new Set(roles.map(r => providers[r]!.read)).size === roles.length, "INDEPENDENT_PROVIDER_REQUIRED");
      let cpiScope: TipsOriginalQuery["cpiScope"] = null;
      const read = <K extends TipsOriginalRole>(role: K): TipsRoleOriginal<K> => {
        const pin = b.originals[role], provider = providers[role]!;
        need([pin.producerId, pin.sourceId, pin.version].every(id) && /^tips-role-original\/v1:sha256:[a-f0-9]{64}$/.test(pin.digest), "INVALID_BINDING");
        let fetched: TipsRoleOriginal<K> | undefined;
        try { fetched = provider.read(immutableConfiguration({ identity: i, event: e, sourceId: pin.sourceId, cpiScope: role === "cpi" ? cpiScope : null })); }
        catch { throw new Refused("ORIGINAL_UNAVAILABLE"); }
        need(fetched !== undefined && fetched.status === "active", "ORIGINAL_UNAVAILABLE");
        const o = immutableConfiguration(fetched!);
        need(o.contractVersion === "tips-role-original/v1" && o.role === role && o.producerId === provider.producerId
          && o.sourceId === pin.sourceId && o.version === pin.version && tipsRoleOriginalDigest(o) === pin.digest, "ORIGINAL_CHANGED");
        need(same(o.identity, i) && same(o.event, e), "ORIGINAL_SCOPE_MISMATCH");
        for (const d of [o.publishedAt, o.knownAt, o.asOf, o.start, o.endExclusive]) civilDate(d);
        need(o.publishedAt <= o.knownAt && o.knownAt <= e.effectiveAt && o.knownAt <= e.knownAt
          && o.publishedAt <= o.asOf && o.asOf === e.effectiveAt && o.start <= e.effectiveAt && e.effectiveAt < o.endExclusive, "CHRONOLOGY_INVALID");
        dated(o.payload, e.effectiveAt);
        return o;
      };
      const security = read("security").payload, terms = read("terms").payload;
      const owned = read("ownership").payload, basis = read("basis").payload;
      const funding = read("funding").payload, law = read("law").payload, history = read("history").payload;
      need(security.complete === true && terms.complete === true && security.issues.length === 1 && terms.rules.length === 1, "ISSUER_CONFLICT");
      const issue = security.issues[0]!, rule = terms.rules[0]!, lot = { ...owned.lot, ...issue, opening: basis.opening };
      need(issue.securityId === i.securityId && issue.issueId === i.issueId && rule.issueId === i.issueId
        && same(Object.fromEntries(Object.keys(i).map(k => [k, lot[k as keyof typeof lot]])), i)
        && owned.beneficialOwnerId === i.personId && owned.floorEligible === true, "OWNERSHIP_MISMATCH");
      need(basis.status === "committed" && id(basis.checkpointId) && history.checkpointId === basis.checkpointId
        && same(history.opening, basis.opening), "BASIS_CONFLICT");
      need(funding.complete === true && funding.entries.length === 1, "FUNDING_UNPAID");
      const f = funding.entries[0]!;
      need(id(f.operationId) && same(f.identity, i) && f.accountId === lot.fundingAccountId && f.status === "posted"
        && f.fundedAt === lot.purchaseDate && f.fundedAt <= basis.opening.at
        && f.debit.equals(lot.fundingCost) && f.acquisitionCredit.equals(lot.parAmount), "FUNDING_UNPAID");
      need(law.authority === "enacted" && id(law.legalSourceId) && law.taxRules.length > 0, "LEGAL_AUTHORITY_REQUIRED");
      need(history.complete === "since_inception_including_pending" && history.entries.length <= 10000, "INVENTORY_INCOMPLETE");
      const historyOps = new Set<string>(), historyClaims = new Set<string>();
      let recognized = money("0");
      for (const h of history.entries) {
        for (const d of [h.start, h.effectiveAt]) civilDate(d);
        need(same(h.identity, i) && lot.issueDate <= h.start && h.start <= h.effectiveAt && h.effectiveAt <= e.effectiveAt
          && ["coupon", "indexation", "redemption", "basis_recognition", "claim_use"].includes(h.kind)
          && h.basisDelta.currency.code === "USD" && h.basisDelta.amount.fitsScale(2) && id(h.operationId) && id(h.claimId)
          && !historyOps.has(h.operationId) && !historyClaims.has(h.claimId), "HISTORY_CONFLICT");
        historyOps.add(h.operationId); historyClaims.add(h.claimId);
        need(h.operationId !== e.operationId && h.claimId !== e.claimId && h.kind !== "redemption"
          && !(["coupon", "claim_use"].includes(h.kind) && h.effectiveAt === e.effectiveAt)
          && !(["indexation", "basis_recognition"].includes(h.kind) && h.effectiveAt > basis.opening.at), "DUPLICATE_CLAIM");
        if (h.kind === "basis_recognition") recognized = recognized.plus(h.basisDelta);
      }
      const priorCoupons = history.entries.filter(h => h.kind === "coupon");
      const priorCouponDates = new Set(priorCoupons.map(h => h.effectiveAt));
      need(priorCouponDates.size === priorCoupons.length
        && priorCoupons.every(h => lot.couponDates.includes(h.effectiveAt))
        && lot.couponDates.filter(at => at <= basis.opening.at).every(at => priorCouponDates.has(at)), "HISTORY_CONFLICT");
      // Accretion and its basis recognition are different ledger facts of one
      // economic occurrence. Reconcile their intervals/amounts without taxing twice.
      const paired = new Map<string, { indexation: number; basis_recognition: number }>();
      for (const h of history.entries) if (h.kind === "indexation" || h.kind === "basis_recognition") {
        const key = canonicalSerialize([h.start, h.effectiveAt, h.basisDelta]);
        const counts = paired.get(key) ?? { indexation: 0, basis_recognition: 0 };
        counts[h.kind]++; paired.set(key, counts);
      }
      need([...paired.values()].every(c => c.indexation === 1 && c.basis_recognition === 1), "HISTORY_CONFLICT");
      need(recognized.equals(basis.opening.cumulativeIndexation), "BASIS_CONFLICT");
      need(Number.isSafeInteger(rule.lagMonths) && rule.lagMonths >= 0 && rule.lagMonths <= 120, "INVALID_BINDING");
      const months = [...new Set([basis.opening.at, e.effectiveAt].flatMap(at => [month(at, -rule.lagMonths),
        ...(at.endsWith("-01") ? [] : [month(at, 1 - rule.lagMonths)])]))].sort(cmp);
      cpiScope = { seriesId: rule.seriesId, months };
      const cpi = read("cpi").payload;
      need(cpi.complete === true && cpi.seriesId === rule.seriesId && same([...cpi.months].sort(cmp), months)
        && cpi.observations.length <= 64 && cpi.observations.every(p => p.seriesId === rule.seriesId && months.includes(p.month)), "INVENTORY_INCOMPLETE");
      const request: TipsRequest = { lot, rule, observations: cpi.observations, taxRules: law.taxRules,
        period: e.period, effectiveAt: e.effectiveAt, knownAt: e.knownAt, action: "scheduled_observation" };
      const original: TipsOriginal = { sourceId: `assembled:${hash([i, e.occurrenceId])}`, version: "v1", status: "active",
        openingCommit: { checkpointId: basis.checkpointId, status: "committed" }, request };
      const result = bindTipsSources([{ occurrenceId: e.occurrenceId, sourceId: original.sourceId, sourceVersion: original.version,
        digest: tipsOriginalDigest(original), identity: i, period: e.period, effectiveAt: e.effectiveAt, knownAt: e.knownAt,
        action: "scheduled_observation" }], () => original);
      // Visit all mandatory publishers after evaluation, even if another has changed.
      let rereadFailure: unknown;
      for (const role of roles) { try { read(role); } catch (error) { rereadFailure ??= error; } }
      if (rereadFailure) throw rereadFailure;
      const occurrence = result.occurrences[0];
      if (!occurrence) {
        const coverage = result.diagnostics.flatMap(d => d.outputs ?? []);
        diagnostics.push({ occurrenceId: e.occurrenceId, code: "EVALUATION_INCOMPLETE", coverage: "incomplete",
          affectedOutputs: coverage.length ? coverage.filter(c => c.coverage === "incomplete").map(c => c.affectedOutput) : outputs, outputs: coverage });
        continue;
      }
      const { original: _assembled, ...compact } = occurrence;
      occurrences.push({ ...compact, contractVersion: "tips-original-binding/v1", originals: b.originals, operationId: e.operationId, claimId: e.claimId });
    } catch (error) {
      diagnostics.push({ occurrenceId: b.event.occurrenceId, code: error instanceof Refused ? error.code : "INVALID_BINDING",
        coverage: "incomplete", affectedOutputs: outputs });
    }
  }
  return immutableConfiguration({ occurrences, diagnostics });
}
