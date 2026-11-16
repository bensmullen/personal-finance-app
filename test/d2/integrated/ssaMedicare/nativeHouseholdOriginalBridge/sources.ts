import { createAuthoritativeState } from "../../../../../src/state/index.js";
import { domainId } from "../../../../../src/identity/index.js";
import { civilDate, instant } from "../../../../../src/time/index.js";
import { Money, money } from "../../../../../src/values/index.js";
import { registerHouseholdBankOriginalProvider, type HouseholdBankOriginal } from "../../../../../src/simulation/d2/integration/householdBank/index.js";
import { attachSsaMedicare, registerNativeSsaMedicareOriginalProviders, registerSsaMedicareOriginalSources,
  type NativeSsaMedicareOccurrence } from "../../../../../src/simulation/d2/integration/ssaMedicare/index.js";
import { irmaaOriginalDigest, proposeOriginalIrmaa, type IrmaaOriginals } from "../../../../../src/simulation/d2/health/medicare/originalBinding/index.js";
import { ssaOriginalDigest } from "../../../../../src/simulation/d2/retirement/benefits/ssaOriginalBinding/index.js";
import { coordinateSocialSecurity } from "../../../../../src/simulation/d2/retirement/benefits/coordination/index.js";
import type { MedicareInstallmentOriginal, SsaInstallmentOriginal } from "../../../../../src/simulation/d2/integration/ssaMedicare/nativeHouseholdOriginalBridge/index.js";
import type { HouseholdBankEventContext } from "../../../../../src/state/index.js";
import { control, cutoff, originalPayment, providers, resetSources, second } from "../originalScenario.js";
import { fixture, ids } from "../scenario.js";

type Part = "part_b" | "part_d";
const ssaPublisherId = "synthetic:installment";
const medicarePublisherId = "synthetic:medicare-inventory";
const bankPublisherId = "synthetic:household-bank";
const documents = new Map<string, { ssa: SsaInstallmentOriginal; medicare: MedicareInstallmentOriginal }>();
// Duration cases share one independently held long-lived SSA document.
export const extendAward = { enabled: false };
function extend<T>(value: T): T {
  const visit = (item: unknown): unknown => {
    if (item === "2028-01-01") return "2029-01-01";
    if (item instanceof Money) return item;
    if (Array.isArray(item)) return item.map(visit);
    return item !== null && typeof item === "object"
      ? Object.fromEntries(Object.entries(item).map(([key, field]) => [key, visit(field)])) : item;
  };
  return visit(value) as T;
}
const ssaOriginals = providers.ssa.map(provider => ({ ...provider, readOriginals: (query: Parameters<typeof provider.readOriginals>[0]) => {
  const inventory = provider.readOriginals(query);
  return inventory && extendAward.enabled ? { ...inventory, originals: inventory.originals.map(extend) } : inventory;
} }));
const elections = new Map<string, readonly Part[]>();
const electionKey = (personId: string, month: string) => JSON.stringify([personId, month]);
const irmaa: IrmaaOriginals = { ...providers.irmaa, enrollments(query) {
  const inventory = providers.irmaa.enrollments(query);
  const elected = elections.get(electionKey(query.personId, query.period.start));
  return inventory && elected !== undefined ? { ...inventory, originals: inventory.originals.map(original => ({ ...original,
    value: { ...original.value, enrollment: { ...original.value.enrollment, elected } } })) } : inventory;
} };
export const faults = { unavailable: "", withdrawn: "", incomplete: "", race: "", reads: 0 };
const publicationAt = instant("2025-12-01T00:00:00.000Z");
const bankStart = instant("2026-01-01T00:00:00.000Z");
const bankEnd = instant("2029-01-01T00:00:00.000Z");
const publication = { revisionId: "1", publishedAt: publicationAt, knownAt: publicationAt, effectiveFrom: bankStart,
  effectiveUntil: bankEnd, status: "active" as const };
const bank: readonly HouseholdBankOriginal[] = [
  { ...publication, sourceId: "bank-account", kind: "account", bankAccountId: ids.bank, owner: { kind: "household", id: ids.household }, accountKind: "checking" },
  { ...publication, sourceId: "bank-household", kind: "household", householdId: ids.household },
  { ...publication, sourceId: "bank-member", kind: "membership", householdId: ids.household, personId: ids.person },
  { ...publication, sourceId: "bank-permission", kind: "permission", householdId: ids.household, personId: ids.person, bankAccountId: ids.bank, direction: "credit" },
];
const secondBank = bank.map(original => {
  if (original.kind === "account") return { ...original, bankAccountId: second.bank };
  if (original.kind === "membership") return { ...original, personId: second.person };
  if (original.kind === "permission") return { ...original, bankAccountId: second.bank, personId: second.person };
  return original;
});

function inventory<K extends "ssa" | "medicare">(context: HouseholdBankEventContext, family: K) {
  const { eventId, eventAt, personId, householdId, asOf, dataCutoff } = context;
  const document = documents.get(eventId)?.[family];
  if (!document || faults.unavailable === eventId) return undefined;
  const revision = faults.race === eventId && family === "medicare" && ++faults.reads % 2 === 0 ? "2" : "1";
  const original = { id: `${family}:${eventId}`, revision, issuer: family === "ssa" ? "SSA" : "CMS",
    publishedAt: cutoff, knownAt: cutoff, status: "active" as const, document };
  const originals = faults.withdrawn === eventId ? [original, { ...original, revision: "2", status: "withdrawn" as const,
    publishedAt: instant("2026-02-01T00:00:00.000Z"), knownAt: instant("2026-02-01T00:00:00.000Z") }] : [original];
  return { event: { eventId, eventAt, personId, householdId }, checkedAt: asOf, completeThrough: dataCutoff,
    completeness: faults.incomplete === eventId ? "unknown" as const : "complete" as const, originals };
}

export function registerTestOriginals(): void {
  registerSsaMedicareOriginalSources({ ssa: ssaOriginals, irmaa });
  registerHouseholdBankOriginalProvider({ publisherId: bankPublisherId, readOriginals: query => query.sourceId === "bank-permission" ? {
    version: "household-bank-original-inventory/v1", publisherId: bankPublisherId, query, completeness: "complete",
    checkedAt: query.context.asOf, completeThrough: query.context.dataCutoff,
    originals: query.context.personId === second.person ? secondBank : bank,
  } : undefined });
  registerNativeSsaMedicareOriginalProviders({
    ssa: { publisherId: ssaPublisherId, readOriginals: context => inventory(context, "ssa") },
    medicare: { publisherId: medicarePublisherId, readOriginals: context => inventory(context, "medicare") },
  });
}

export function resetNativeSources(): void {
  resetSources(); documents.clear(); elections.clear();
  extendAward.enabled = false;
  faults.unavailable = ""; faults.withdrawn = ""; faults.incomplete = ""; faults.race = ""; faults.reads = 0;
}

// Publish the individual synthetic documents. Production supplies the
// payable, claims, settlements, transaction and state original authorities.
export function publish(month: string, elected: readonly Part[], missingExclusion = false, personId = ids.person as string): NativeSsaMedicareOccurrence {
  const seed = originalPayment(month, money("2000"), personId);
  const { a1, c2, payable } = seed;
  const pins = seed.originalSources!;
  const current = ssaOriginals[0]!.readOriginals({ sourceId: pins.ssa.sourceId,
    householdId: ids.household, recipientPersonId: personId, knownAt: a1.knownAt, dataCutoff: pins.ssa.dataCutoff })!.originals[0]!;
  const includes = (part: string) => elected.some(value => part === value);
  elections.set(electionKey(personId, c2.premiums.period.start), elected);
  const queries = pins.irmaa.filter(item => includes(item.query.part)).map(item => item.query);
  const candidates = proposeOriginalIrmaa({ events: queries, originals: irmaa, deaths: [] }).candidates;
  const surchargeOriginals = queries.map(query => ({ query, candidateDigest: irmaaOriginalDigest(candidates.find(row => row.part === query.part)!) }));
  const coverages = c2.premiums.coverages.filter(item => includes(item.medicare!.premiumFor))
    .map(item => ({ ...item, medicare: { ...item.medicare!, elected } }));
  const eventId = `ssa-medicare:${payable.paymentId}`;
  documents.set(eventId, {
    ssa: { recipient: current.recipient, award: { ...pins.ssa, digest: ssaOriginalDigest(current), eventPeriod: current.eventPeriod }, payableSource: payable.source,
      withholding: { awardId: payable.awardId, workerRecordId: payable.workerRecordId, entitlementId: payable.entitlementId,
        amount: money("0"), source: payable.taxWithholding.source }, bank: { publisherId: bankPublisherId, sourceId: "bank-permission" } },
    medicare: {
      premiums: { ...c2.premiums, coverages, coordination: coverages.length < 2 ? [] : c2.premiums.coordination },
      inventories: c2.inventories.map(row => ({ ...row,
        parts: row.parts.flatMap(item => item.status === "excluded" || includes(item.part) ? [item]
          : missingExclusion ? [] : [{ part: item.part, status: "excluded" as const, source: item.source, reason: "No enrollment" }]),
        surcharges: row.surcharges.map(item => includes(item.part) ? item : { ...item, status: "not_applicable", reason: "No enrollment" }),
      })),
      irmaa: { ...c2.irmaa, enrollments: c2.irmaa.enrollments.filter(item => includes(item.part)).map(item => ({ ...item, elected })),
        rules: elected.length ? c2.irmaa.rules : [], histories: elected.length ? c2.irmaa.histories : [] },
      surchargeOriginals,
      deductionTerms: c2.deductionTerms.filter(item => includes(item.part)),
      instructions: seed.deductions.filter(item => includes(item.terms.premium.part)).map(item => ({
        part: item.terms.premium.part as Part, premiumSource: item.terms.premium.source, authorizationSource: item.terms.source,
      })),
    },
  });
  return { eventId, eventAt: payable.paymentAt, personId: domainId("person", personId),
    bankAccountId: seed.bank.accountId, ssaPublisherId, medicarePublisherId };
}

function publishEndOfLongHorizon(previous: NativeSsaMedicareOccurrence): NativeSsaMedicareOccurrence {
  const { ssa, medicare } = documents.get(previous.eventId)!;
  const period = { start: civilDate("2028-01-01"), endExclusive: civilDate("2028-02-01") };
  const award = coordinateSocialSecurity({ householdId: ids.household, recipients: [ssa.recipient],
    horizon: period, knownAt: civilDate(cutoff.slice(0, 10)) }).proposals[0]!;
  const event = { ...previous, eventId: `ssa-medicare:${award.claimId}`, eventAt: instant(`${award.effectiveAt}T00:00:00.000Z`) };
  const [inventory] = medicare.inventories;
  documents.set(event.eventId, {
    ssa: { ...ssa, payableSource: { ...extend(ssa.payableSource), scopeId: award.claimId },
      withholding: { ...ssa.withholding, awardId: award.quotedAward.awardId,
        source: { ...extend(ssa.withholding.source), scopeId: award.claimId } } },
    medicare: { premiums: { ...medicare.premiums, period, coverages: [], coordination: [] },
      irmaa: { ...medicare.irmaa, period, taxYear: 2028, rules: [], histories: [], enrollments: [] },
      deductionTerms: [], instructions: [], surchargeOriginals: [],
      inventories: [{ ...extend(inventory!), ...period, eventAt: period.start,
        parts: inventory!.parts.map(entry => ({ part: entry.part, status: "excluded", source: extend(entry.source), reason: "No enrollment" })),
        surcharges: inventory!.surcharges.map(entry => ({ ...extend(entry), status: "not_applicable", reason: "No enrollment" })) }] },
  });
  return event;
}

export function amendMedicare(event: NativeSsaMedicareOccurrence, amend: (original: MedicareInstallmentOriginal) => MedicareInstallmentOriginal): void {
  const source = documents.get(event.eventId)!;
  documents.set(event.eventId, { ...source, medicare: amend(source.medicare) });
}

export function nativeFixture(count: number, months = count, elected: readonly Part[] = ["part_b", "part_d"]) {
  extendAward.enabled = count === 25;
  const dates = Array.from({ length: Math.min(24, count) }, (_, index) => civilDate(new Date(Date.UTC(2026, index, 1)).toISOString().slice(0, 10)).slice(0, 7));
  const events = dates.map(month => publish(month, elected));
  if (count === 25) events.push(publishEndOfLongHorizon(events[23]!));
  const state = createAuthoritativeState({ accounts: { [ids.bank]: { id: ids.bank, kind: "checking", ownerId: ids.household, cash: money("2000") } } });
  const base = fixture(months, state, "2026-01");
  const kernel = attachSsaMedicare(base.kernel, { householdId: ids.household, personId: ids.person, payments: [], nativePayments: events });
  return { ...base, kernel, events };
}

export { control };
