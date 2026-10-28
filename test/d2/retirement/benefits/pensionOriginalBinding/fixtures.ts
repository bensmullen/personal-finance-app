import { civilDate as date } from "../../../../../src/time/index.js";
import { money, Ratio, RoundingPolicy } from "../../../../../src/values/index.js";
import { pensionOriginalDigest, type PensionBindingRequest, type PensionIdentity, type PensionOriginalInventory,
  type PensionOriginalProvider, type PensionOriginalPublication, type PensionOriginalRole }
  from "../../../../../src/simulation/d2/retirement/benefits/pensionOriginalBinding/index.js";
import type { BenefitSource, QuotedBenefit } from "../../../../../src/simulation/d2/retirement/benefits/index.js";

export type Book = { [R in PensionOriginalRole]: PensionOriginalPublication<R> };
export const at = (month: number, day = 15) => date(`${2026 + Math.floor(month / 12)}-${String(month % 12 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
const published = date("2025-12-01");
export const claimId = (entitlement: string, person: string, event: string) =>
  JSON.stringify(["d2-quoted-benefit/v1", "household", entitlement, person, event]);

/** Independently authored synthetic source book. It contains no conditional
 * verifier results or consumer evidence flags. This is not real payer data. */
export function book(months = 2, survivor = false, suffix = ""): Book {
  const person = `participant${suffix}`, beneficiary = `survivor${suffix}`;
  const identity: PensionIdentity = { householdId: "household", participantPersonId: person,
    workerRecordPersonId: person, beneficiaryId: beneficiary, pensionId: `pension${suffix}`,
    planId: `plan${suffix}`, sponsorId: `sponsor${suffix}`, entitlementId: `entitlement${suffix}` };
  const horizon = { start: at(0, 1), endExclusive: at(months, 1) };
  const source = (role: string): BenefitSource => ({ ruleSnapshotId: `synthetic:${role}${suffix}`, jurisdiction: "US",
    ruleFamily: "pension", sourcePublication: `original:${role}${suffix}`, asOf: published,
    version: "1", projectionStatus: "verified" });
  const s = source("plan");
  const award: QuotedBenefit = { awardId: `award${suffix}`, entitlementId: identity.entitlementId,
    householdId: "household", recipientPersonId: person, workerRecordPersonId: person,
    sponsorId: identity.sponsorId, beneficiaryId: beneficiary, benefitKind: "pension",
    claimingMonth: at(0, 1), commencement: at(0), frequency: "monthly", invalidDayPolicy: "skip", calendarSource: s,
    quote: { recipientPersonId: person, workerRecordPersonId: person, claimingMonth: at(0, 1),
      electionId: `election${suffix}`, adjustmentOrder: "claiming_then_cola_then_continuation",
      grossAmount: money("1234.56"), asOf: published, dollarBasisAt: published,
      basis: "post_election", source: s, coveredHorizon: horizon },
    cola: { source: s, coveredHorizon: { ...horizon, start: published }, changes: [] }, election: { electionId: `election${suffix}`,
      form: "joint 50 percent", beneficiaryId: beneficiary, source: s, continuation: { beneficiaryId: beneficiary,
        factor: Ratio.parse("0.5"), rounding: new RoundingPolicy(2, "half_even"), source: s,
        effectiveAt: at(1, 1), coversDeathBeforeCommencement: false } },
    ...(survivor ? { participantDeathDate: at(1, 1) } : {}) };
  const common = <R extends PensionOriginalRole>(role: R) => ({ role, publisherId: `publisher:${role}`,
    sourceId: `original:${role}${suffix}`, version: "1", originalId: `document:${role}${suffix}`, identity,
    kind: "original" as const, revisesOriginalId: null, status: "active" as const,
    publishedAt: published, knownAt: published, eventPeriod: horizon, source: source(role) });
  const recipient = (m: number) => survivor && m >= 1 ? beneficiary : person;
  return {
    plan: { ...common("plan"), payload: { award, employeeBasis: "none", paymentMethod: "quoted_whole_installment" } },
    bank: { ...common("bank"), publishedAt: horizon.endExclusive, knownAt: horizon.endExclusive,
      payload: { signedBy: "publisher:bank", institutionId: "institution", confirmations: Array.from({ length: months }, (_, m) => ({
        pensionId: identity.pensionId, planId: identity.planId, sponsorId: identity.sponsorId,
        entitlementId: identity.entitlementId, confirmationId: `confirmation${suffix}:${m}`,
        paymentId: `payment${suffix}:${m}`, receiptId: `receipt${suffix}:${m}`,
        recipientPersonId: recipient(m), effectiveAt: at(m), authorizedAt: at(m), fundedAt: at(m),
        publishedAt: at(m), knownAt: at(m), authorizationId: `authorization${suffix}:${m}`, fundingId: `funding${suffix}:${m}`,
        instructionId: `instruction:${recipient(m)}`, electionId: `election${suffix}`, electedForm: "joint 50 percent",
        status: "posted" as const, gross: money(survivor && m >= 1 ? "617.28" : "1234.56"),
        net: money(survivor && m >= 1 ? "617.28" : "1234.56"),
        withholding: [{ jurisdiction: "US-federal", amount: money("0.00") }],
        route: { kind: "bank" as const, institutionId: "institution", destinationAccountId: `account:${recipient(m)}`,
          accountKind: "checking" as const, householdId: "household", ownerPersonIds: [recipient(m)] },
      })) } },
    legal: { ...common("legal"), payload: { instructions: [person, beneficiary].map(p => ({
      pensionId: identity.pensionId, planId: identity.planId, sponsorId: identity.sponsorId,
      entitlementId: identity.entitlementId, instructionId: `instruction:${p}`, recipientPersonId: p,
      electionId: `election${suffix}`, electedForm: "joint 50 percent", institutionId: "institution",
      destinationAccountId: `account:${p}`, accountKind: "checking" as const, householdId: "household",
      ownerPersonIds: [p], workerRecordPersonId: person, beneficiaryId: beneficiary,
    })) } },
    history: { ...common("history"), payload: { entitlementId: identity.entitlementId, covered: horizon,
      installments: Array.from({ length: months }, (_, m) => ({ effectiveAt: at(m), recipientPersonId: recipient(m),
        claimId: claimId(identity.entitlementId, recipient(m), at(m)), status: "unpaid" as const })) } },
  };
}
export const requestFor = (books: readonly Book[], months = 2): PensionBindingRequest => ({
  householdId: "household", knownAt: at(120, 1), dataCutoff: at(120, 1),
  horizon: { start: at(0, 1), endExclusive: at(months, 1) }, claims: books.map(b => ({
    identity: b.plan.identity, pins: Object.values(b).map(o => ({ role: o.role, publisherId: o.publisherId,
      sourceId: o.sourceId, sourceVersion: o.version, originalId: o.originalId, digest: pensionOriginalDigest(o) })),
  })),
});
export function ports(books: readonly Book[], change?: (inventory: PensionOriginalInventory, call: number) => PensionOriginalInventory) {
  const calls = new Map<string, number>();
  const payloadBytes = new Map<string, number>();
  const providers: PensionOriginalProvider[] = (["plan", "bank", "legal", "history"] as const).map(role => ({
    role, publisherId: `publisher:${role}`, readOriginals(query) {
      const key = `${role}:${query.entitlementId}`, count = (calls.get(key) ?? 0) + 1;
      calls.set(key, count);
      const originals = books.filter(b => b.plan.identity.entitlementId === query.entitlementId).map(b => b[role]);
      const inventory: PensionOriginalInventory = { query, publisherId: `publisher:${role}`,
        authentication: "authenticated_publisher", completeness: "complete_since_commencement",
        completeThrough: query.dataCutoff, checkedAt: query.knownAt, originals, revisions: [] };
      const result = change ? change(inventory, count) : inventory;
      payloadBytes.set(key, (payloadBytes.get(key) ?? 0) + JSON.stringify(result).length);
      return result;
    },
  }));
  return { providers, calls, payloadBytes };
}
