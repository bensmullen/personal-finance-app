import { civilDate, instant } from "../../../../src/time/index.js";
import { Money, money } from "../../../../src/values/index.js";
import { immutableConfiguration } from "../../../../src/simulation/r3/compiledHousehold.js";
import { ssaOriginalDigest, type SsaOriginalHistory, type SsaOriginalPublication } from "../../../../src/simulation/d2/retirement/benefits/ssaOriginalBinding/index.js";
import { irmaaOriginalDigest, proposeOriginalIrmaa, type Original, type OriginalInventory, type OriginalQuery,
  type IrmaaOriginals, type OriginalRule, type OriginalEnrollment, type OriginalReturn, type OriginalDetermination } from "../../../../src/simulation/d2/health/medicare/originalBinding/index.js";
import { registerSsaMedicareOriginalSources, type ConfirmedSsaMedicarePayment } from "../../../../src/simulation/d2/integration/ssaMedicare/index.js";
import { ids, payment, uuid } from "./scenario.js";
import { coordinateSocialSecurity } from "../../../../src/simulation/d2/retirement/benefits/coordination/index.js";

export const cutoff = instant("2026-01-01T00:00:00.000Z");
export const second = { person: uuid(22), bank: uuid(23) };
/** Independently authored provider book uses the accepted producer fixture,
 * never the submitted payment, pin, digest or query's economic values. */
export function forMember<T>(value: T, member = ids.person as string): T {
  if (member === ids.person) return value;
  const map = (v: unknown): unknown => {
    if (v instanceof Money) return v;
    if (typeof v === "string") {
      const scoped = v.replaceAll(ids.person, member).replaceAll(ids.bank, second.bank);
      return /^(ssa-recognition:|ssa-settlement:|medicare-recognition:|medicare-settlement:|premium:|authorization:|receipt:)/.test(scoped)
        ? `${scoped}:${member}` : scoped;
    }
    if (Array.isArray(v)) return v.map(map);
    if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, map(x)]));
    return v;
  };
  return map(value) as T;
}
function withGross(q: ConfirmedSsaMedicarePayment, gross: string): ConfirmedSsaMedicarePayment {
  const a1 = { ...q.a1, recipients: q.a1.recipients.map(r => ({ ...r, quotes: r.quotes.map(v => ({ ...v,
    award: { ...v.award, quote: { ...v.award.quote!, grossAmount: money(gross) } } })) })) };
  const award = coordinateSocialSecurity(a1).proposals[0]!;
  return { ...q, a1, award, c2: { ...q.c2, awards: [award.quotedAward] }, payable: { ...q.payable, grossPayable: money(gross) } };
}
const original = (person: string, gross = "1500"): SsaOriginalPublication => ({ publisherId: "synthetic:ssa", sourceId: `ssa:${person}`,
  version: "v1", originalId: `award-original:${person}`, householdId: ids.household, kind: "original", revisesOriginalId: null,
  status: "active", publishedAt: civilDate("2025-12-01"), knownAt: civilDate("2025-12-01"), asOf: civilDate("2025-12-01"),
  eventPeriod: { start: civilDate("2026-01-01"), endExclusive: civilDate("2028-01-01") },
  recipient: forMember(withGross(payment(), gross).a1.recipients[0]!, person) });
const doc = <T>(issuer: Original<T>["issuer"], value: T, sourceId: string): Original<T> => ({ issuer, value, sourceId,
  version: "synthetic-v1", claimId: `${issuer}:${sourceId}`, publishedAt: cutoff, knownAt: cutoff,
  publication: `Provider-held synthetic original ONLY ${"publisher-original-payload".repeat(100)}`, supersedes: [] });
const surchargedRule = (rule: OriginalRule["rule"]): OriginalRule["rule"] => ({ ...rule,
  tables: rule.tables.map(t => ({ ...t, tiers: t.tiers.map(tier => ({ ...tier,
    partBMonthly: money("10"), partDMonthly: money("20") })) })) });
const book = immutableConfiguration([ids.person as string, second.person].flatMap(person => [2026, 2027].map(year => {
  const q = forMember(payment(`${year}-06`), person), raw = q.c2.irmaa;
  return { person, year, ssa: original(person), zeroNetSsa: original(person, "200"), rule: doc<OriginalRule>("CMS", { rule: raw.rules[0]!, permittedLifeEvents: [] }, raw.rules[0]!.source.ruleSnapshotId),
    surchargedRule: doc<OriginalRule>("CMS", { rule: surchargedRule(raw.rules[0]!), permittedLifeEvents: [] }, raw.rules[0]!.source.ruleSnapshotId),
    enrollments: raw.enrollments.map(enrollment => doc<OriginalEnrollment>("CMS", { enrollment,
      birthDate: civilDate("1950-01-01"), eligible: true, eligibility: { start: civilDate("2026-01-01"), endExclusive: civilDate("2028-01-01") } }, enrollment.source.ruleSnapshotId)),
    income: doc<OriginalReturn>("IRS", { income: raw.histories[0]!, filedAt: instant("2025-04-01T00:00:00.000Z"), status: "filed" }, raw.histories[0]!.source.ruleSnapshotId) };
})));
export const control: {
  missing: boolean; zeroNet: boolean; surcharged: boolean; calls: number; ssaCalls: number;
  changeSsa?: (h: SsaOriginalHistory, call: number) => SsaOriginalHistory | undefined;
  changeInventory?: (kind: string, inv: OriginalInventory<unknown>, call: number) => OriginalInventory<unknown> | undefined;
} = { missing: false, zeroNet: false, surcharged: false, calls: 0, ssaCalls: 0 };
export function resetSources(): void {
  control.missing = false; control.zeroNet = false; control.surcharged = false; control.calls = 0; control.ssaCalls = 0;
  delete control.changeSsa; delete control.changeInventory;
}
const lookup = (q: OriginalQuery) => book.find(b => b.person === q.personId && b.year === q.premiumTaxYear)!;
const inv = <T>(kind: string, query: OriginalQuery, originals: readonly Original<T>[]): OriginalInventory<T> | undefined => {
  control.calls++;
  if (control.missing) return undefined;
  const value = { query, originals, complete: true };
  return (control.changeInventory ? control.changeInventory(kind, value, control.calls) : value) as OriginalInventory<T> | undefined;
};
export const providers = {
  ssa: [{ publisherId: "synthetic:ssa", readOriginals: (query: SsaOriginalHistory["query"]): SsaOriginalHistory | undefined => {
    control.ssaCalls++;
    if (control.missing) return undefined;
    const h: SsaOriginalHistory = { query, publisherId: "synthetic:ssa", authority: "verified_original_inventory", completeness: "complete",
      completeThrough: query.dataCutoff, checkedAt: query.knownAt,
      originals: book.filter(b => b.person === query.recipientPersonId && b.year === 2026).map(b => control.zeroNet ? b.zeroNetSsa : b.ssa), revisions: [] };
    return control.changeSsa ? control.changeSsa(h, control.ssaCalls) : h;
  } }],
  irmaa: {
    rules: q => inv("rule", q, [control.surcharged ? lookup(q).surchargedRule : lookup(q).rule]),
    enrollments: q => inv("enrollment", q, lookup(q).enrollments.filter(e => e.value.enrollment.part === q.part)),
    returns: q => inv("return", q, [lookup(q).income]),
    determinations: q => inv<OriginalDetermination>("determination", q, []),
    lifeEvents: q => inv("life", q, []),
  } satisfies IrmaaOriginals,
};
export const register = () => registerSsaMedicareOriginalSources(providers);
export function originalPayment(month = "2026-06", cash = money("2000"), person = ids.person as string): ConfirmedSsaMedicarePayment {
  let q = forMember(withGross(payment(month, cash), control.zeroNet ? "200" : "1500"), person);
  if (control.surcharged) q = { ...q,
    c2: { ...q.c2, irmaa: { ...q.c2.irmaa, rules: q.c2.irmaa.rules.map(surchargedRule) },
      premiums: { ...q.c2.premiums, coverages: q.c2.premiums.coverages.map(c => ({ ...c,
        quote: { ...c.quote, gross: money(c.medicare!.premiumFor === "part_b" ? "70" : "100"),
          member: money(c.medicare!.premiumFor === "part_b" ? "70" : "100") } })) } },
    deductions: q.deductions.map(d => ({ ...d, terms: { ...d.terms, premium: { ...d.terms.premium,
      base: money(d.terms.premium.part === "part_b" ? "70" : "100"),
      irmaa: money(d.terms.premium.part === "part_b" ? "10" : "20") } } })) };
  const entry = book.find(b => b.person === person)!, o = control.zeroNet ? entry.zeroNetSsa : entry.ssa;
  const r = o.recipient, unique = (s: readonly string[]) => [...new Set(s)].sort();
  const queries: OriginalQuery[] = q.c2.irmaa.enrollments.map(e => ({ householdId: ids.household, personId: person,
    birthDate: civilDate("1950-01-01"), coverageId: e.coverageId, part: e.part, premiumTaxYear: Number(month.slice(0, 4)),
    period: q.c2.premiums.period, eventAt: q.payable.paymentAt, knownAt: cutoff }));
  // Actual merged C2 producer output; no fabricated candidate signature.
  const produced = proposeOriginalIrmaa({ events: queries, originals: providers.irmaa, deaths: [] });
  if (produced.candidates.length !== 2) throw new Error("FIXTURE_ORIGINALS_NOT_ADMITTED");
  return { ...q, originalSources: { mode: "ssa-medicare-originals/v1", dataCutoff: cutoff,
    ssa: { publisherId: o.publisherId, sourceId: o.sourceId, sourceVersion: o.version, originalId: o.originalId,
      digest: ssaOriginalDigest(o), householdId: ids.household, recipientPersonId: person,
      workerRecordPersonIds: unique([...r.quotes.map(v => v.award.workerRecordPersonId), ...r.determinations.map(d => d.paymentWorkerRecordPersonId)]),
      entitlementIds: unique([...r.quotes.map(v => v.award.entitlementId), ...r.determinations.map(d => d.paymentEntitlementId)]),
      awardIds: unique([...r.quotes.map(v => v.award.awardId), ...r.determinations.map(d => d.paymentAwardId)]),
      electionIds: unique(r.determinations.map(d => d.electionId)), claimingMonths: [...new Set(r.determinations.map(d => d.claimingMonth))],
      eventPeriod: o.eventPeriod, dataCutoff: civilDate(cutoff.slice(0, 10)) },
    irmaa: queries.map(query => ({ query, candidateDigest: irmaaOriginalDigest(produced.candidates.find(c => c.part === query.part)!) })) } };
}
