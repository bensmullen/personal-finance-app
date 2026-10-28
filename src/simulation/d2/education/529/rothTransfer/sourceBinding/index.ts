import { sha256 } from "../../../../../../rules/tax/t1b/contentIdentity.js";
import { civilDate } from "../../../../../../time/index.js";
import { canonicalSerialize } from "../../../../../run.js";
import { immutableConfiguration } from "../../../../../r3/compiledHousehold.js";
import { propose529RothTransfers, type RothTransferRequest as Request, type RothProposal, type RothCoverage, type RothTransferResult } from "../index.js";

export interface RothOriginalPayloads {
  readonly plan: Pick<Request, "plan" | "history" | "holdings">;
  readonly trustee: Pick<Request, "destination" | "authorization">;
  readonly law: { readonly rules: NonNullable<Request["rules"]> };
  readonly annual: { readonly capacity: Request["annualCapacity"]; readonly usage: Request["usage"] };
  readonly compensation: { readonly capacity: Request["compensationCapacity"]; readonly usage: Request["usage"] };
}
export type RothOriginalRole = keyof RothOriginalPayloads;
export interface RothBindingIdentity {
  readonly householdId: string; readonly ownerId: string; readonly beneficiaryId: string;
  readonly planId: string; readonly providerId: string; readonly planAccountId: string;
  readonly sourceAccountId: string; readonly holdingId: string; readonly destinationAccountId: string;
  readonly receivingTrusteeId: string;
}
export interface RothBindingEvent {
  readonly eventId: string; readonly operationId: string; readonly claimId: string;
  readonly effectiveAt: Request["effectiveAt"]; readonly knownAt: Request["knownAt"]; readonly taxYear: number;
}
export interface RothOriginal<K extends RothOriginalRole> {
  readonly role: K; readonly providerId: string; readonly sourceId: string; readonly version: string;
  readonly status: "active" | "withdrawn" | "refused";
  readonly publishedAt: Request["effectiveAt"]; readonly cutoff: Request["effectiveAt"];
  readonly identity: RothBindingIdentity; readonly event: RothBindingEvent;
  readonly payload: RothOriginalPayloads[K];
}
export interface RothOriginalPin {
  readonly providerId: string; readonly sourceId: string; readonly version: string; readonly digest: string;
}
/** Trusted producer ports, never a caller request/digest verification callback.
 * #149 supplies authentic person/year capacity and exhaustive current use.
 * No production capacity provider is implemented or inferred here. */
export type RothOriginalPorts = { readonly [K in RothOriginalRole]?:
  (pin: RothOriginalPin, cutoff: Request["effectiveAt"]) => RothOriginal<K> | undefined };
export interface RothSourceBinding {
  readonly identity: RothBindingIdentity; readonly event: RothBindingEvent;
  readonly originals: { readonly [K in RothOriginalRole]: RothOriginalPin };
}
export type RothBindingCode = "INVALID_BINDING" | "ORIGINAL_UNAVAILABLE" | "ORIGINAL_CHANGED"
  | "ORIGINAL_SCOPE_MISMATCH" | "ORIGINAL_AFTER_EVENT" | "INDEPENDENT_CAPACITY_REQUIRED"
  | "CAPACITY_USAGE_CONFLICT" | "CONTESTED_CLAIM" | "EVALUATION_INCOMPLETE";
export type RothCompactCoverage = Pick<RothCoverage, "affectedOutput" | "coverage" | "diagnosticCode" | "missingFacts" | "ruleSnapshotId">;
export type RothCompactEconomics = Pick<RothProposal, "grossAmount" | "eligibleAmount" | "excludedAmount"
  | "eligibleBasis" | "eligibleEarnings" | "excludedBasis" | "excludedEarnings"
  | "availableAnnualRoom" | "availableCompensationRoom" | "availableLifetimeRoom" | "proposedLifetimeIncrement">;
export interface RothBoundOccurrence {
  readonly contractVersion: "529-roth-source-binding/v1";
  readonly identity: RothBindingIdentity; readonly event: RothBindingEvent;
  readonly originals: RothSourceBinding["originals"];
  readonly committed: false; readonly postable: false; readonly physicalTransfer: "not_applied";
  readonly capacityReservation: "incomplete"; readonly taxLiability: "incomplete";
  readonly economics: RothCompactEconomics | null;
  readonly bound: RothTransferResult["bounds"][number] | null;
  readonly coverage: readonly RothCompactCoverage[];
}
export interface RothBindingResult {
  readonly occurrences: readonly RothBoundOccurrence[];
  readonly diagnostics: readonly { readonly eventId: string; readonly operationId: string;
    readonly coverage: "incomplete"; readonly code: RothBindingCode; readonly missingPort: RothOriginalRole | null }[];
}
const roles = ["plan", "trustee", "law", "annual", "compensation"] as const;
const hash = (v: unknown): string => sha256(canonicalSerialize(v));
const same = (a: unknown, b: unknown): boolean => canonicalSerialize(a) === canonicalSerialize(b);
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const id = (v: string): boolean => typeof v === "string" && v.trim().length > 0 && v.length <= 200;
export const rothOriginalDigest = <K extends RothOriginalRole>(o: RothOriginal<K>): string =>
  `529-roth-original/v1:sha256:${hash(o)}`;
class Refused extends Error {
  constructor(readonly code: RothBindingCode, readonly port: RothOriginalRole | null = null) { super(code); }
}
const need = (ok: boolean, code: RothBindingCode): void => { if (!ok) throw new Refused(code); };
const compactEconomics = (p: RothProposal): RothCompactEconomics => ({
  grossAmount: p.grossAmount, eligibleAmount: p.eligibleAmount, excludedAmount: p.excludedAmount,
  eligibleBasis: p.eligibleBasis, eligibleEarnings: p.eligibleEarnings, excludedBasis: p.excludedBasis,
  excludedEarnings: p.excludedEarnings, availableAnnualRoom: p.availableAnnualRoom,
  availableCompensationRoom: p.availableCompensationRoom, availableLifetimeRoom: p.availableLifetimeRoom,
  proposedLifetimeIncrement: p.proposedLifetimeIncrement,
});
const compactPin = ({ providerId, sourceId, version, digest }: RothOriginalPin): RothOriginalPin =>
  ({ providerId, sourceId, version, digest });

/** Conditional producer→consumer boundary. Pins contain no caller-authored economics;
 * SHA-256 establishes content identity, not source authority. */
export function bind529RothSources(input: readonly RothSourceBinding[], ports: RothOriginalPorts): RothBindingResult {
  if (input.length > 256) throw new RangeError("ROTH_BINDING_BATCH_LIMIT");
  const bindings = immutableConfiguration(input);
  const occurrences: RothBoundOccurrence[] = [], diagnostics: RothBindingResult["diagnostics"][number][] = [];
  // Full-batch admission includes candidates whose originals later fail. No winner by iteration order.
  const keys = (b: RothSourceBinding): string[] => [
    ["event", b.event.eventId], ["operation", b.event.operationId], ["claim", b.event.claimId],
    ["plan", b.identity.householdId, b.identity.planId], ["holding", b.identity.householdId, b.identity.holdingId],
    ["plan-account", b.identity.householdId, b.identity.planAccountId],
    ["cash", b.identity.householdId, b.identity.sourceAccountId],
    ["roth", b.identity.householdId, b.identity.destinationAccountId],
    ["capacity", b.identity.householdId, b.identity.beneficiaryId, b.event.taxYear],
    ...(["annual", "compensation"] as const).map(k => ["capacity-original", b.originals[k].providerId, b.originals[k].sourceId]),
  ].map(canonicalSerialize);
  const counts = new Map<string, number>();
  for (const b of bindings) for (const k of new Set(keys(b))) counts.set(k, (counts.get(k) ?? 0) + 1);
  const ordered = [...bindings].sort((a, b) => compare(canonicalSerialize(a), canonicalSerialize(b)));
  for (const b of ordered) {
    try {
      need([...Object.values(b.identity), b.event.eventId, b.event.operationId, b.event.claimId].every(id), "INVALID_BINDING");
      civilDate(b.event.effectiveAt); civilDate(b.event.knownAt);
      need(b.event.effectiveAt <= b.event.knownAt && Number.isSafeInteger(b.event.taxYear)
        && Number(b.event.effectiveAt.slice(0, 4)) === b.event.taxYear, "INVALID_BINDING");
      need(keys(b).every(k => counts.get(k) === 1), "CONTESTED_CLAIM");
      need(b.originals.plan.providerId !== b.originals.annual.providerId
        && b.originals.plan.providerId !== b.originals.compensation.providerId, "INDEPENDENT_CAPACITY_REQUIRED");
      const read = <K extends RothOriginalRole>(role: K): RothOriginal<K> => {
        const pin = b.originals[role], port = ports[role];
        need([pin.providerId, pin.sourceId, pin.version].every(id)
          && /^529-roth-original\/v1:sha256:[a-f0-9]{64}$/.test(pin.digest), "INVALID_BINDING");
        if (!port) throw new Refused(role === "annual" || role === "compensation"
          ? "INDEPENDENT_CAPACITY_REQUIRED" : "ORIGINAL_UNAVAILABLE", role);
        let fetched: RothOriginal<K> | undefined;
        try { fetched = port(pin, b.event.effectiveAt); } catch { throw new Refused("ORIGINAL_UNAVAILABLE", role); }
        if (!fetched || fetched.status !== "active") throw new Refused("ORIGINAL_UNAVAILABLE", role);
        const o = immutableConfiguration(fetched);
        need(o.role === role && o.providerId === pin.providerId && o.sourceId === pin.sourceId
          && o.version === pin.version && rothOriginalDigest(o) === pin.digest, "ORIGINAL_CHANGED");
        need(same(o.identity, b.identity) && same(o.event, b.event), "ORIGINAL_SCOPE_MISMATCH");
        civilDate(o.publishedAt); civilDate(o.cutoff);
        need(o.publishedAt <= o.cutoff && o.cutoff === b.event.effectiveAt, "ORIGINAL_AFTER_EVENT");
        return o;
      };
      const plan = read("plan"), trustee = read("trustee"), law = read("law"), annual = read("annual"), compensation = read("compensation");
      const p = plan.payload.plan, h = plan.payload.holdings, d = trustee.payload.destination;
      need(same(b.identity, { householdId: p.householdId, ownerId: p.ownerId, beneficiaryId: p.beneficiaryId,
        planId: p.planId, providerId: p.providerId, planAccountId: p.accountId, sourceAccountId: p.cashAccountId,
        holdingId: h.holdingId, destinationAccountId: d.accountId, receivingTrusteeId: d.receivingTrusteeId }), "ORIGINAL_SCOPE_MISMATCH");
      need(same(annual.payload.usage, compensation.payload.usage), "CAPACITY_USAGE_CONFLICT");
      const request: Request = { ...plan.payload, ...trustee.payload, ...law.payload,
        operationId: b.event.operationId, claimId: b.event.claimId, effectiveAt: b.event.effectiveAt,
        knownAt: b.event.effectiveAt, taxYear: b.event.taxYear,
        kind: "529_beneficiary_roth_direct_trustee_transfer", currency: p.source.currency,
        amount: trustee.payload.authorization.amount, usage: annual.payload.usage,
        annualCapacity: annual.payload.capacity, compensationCapacity: compensation.payload.capacity };
      let evaluated: RothTransferResult;
      try { evaluated = propose529RothTransfers([request]); }
      finally {
        // Re-read EVERY mandatory source even after another re-read fails or evaluation throws/is incomplete.
        let race: unknown;
        for (const role of roles) try { read(role); } catch (e) { race ??= e; }
        if (race) throw race;
      }
      const proposal = evaluated.proposals[0];
      occurrences.push({ contractVersion: "529-roth-source-binding/v1", identity: b.identity,
        event: { eventId: b.event.eventId, operationId: b.event.operationId, claimId: b.event.claimId,
          effectiveAt: b.event.effectiveAt, knownAt: b.event.knownAt, taxYear: b.event.taxYear },
        originals: { plan: compactPin(b.originals.plan), trustee: compactPin(b.originals.trustee), law: compactPin(b.originals.law),
          annual: compactPin(b.originals.annual), compensation: compactPin(b.originals.compensation) },
        committed: false, postable: false, physicalTransfer: "not_applied",
        capacityReservation: "incomplete", taxLiability: "incomplete", economics: proposal ? compactEconomics(proposal) : null,
        bound: evaluated.bounds[0] ?? null,
        coverage: evaluated.coverage.map(({ affectedOutput, coverage, diagnosticCode, missingFacts, ruleSnapshotId }) =>
          ({ affectedOutput, coverage, diagnosticCode, missingFacts, ruleSnapshotId })) });
      if (!proposal) throw new Refused("EVALUATION_INCOMPLETE");
    } catch (e) {
      diagnostics.push({ eventId: b.event.eventId, operationId: b.event.operationId, coverage: "incomplete",
        code: e instanceof Refused ? e.code : "INVALID_BINDING", missingPort: e instanceof Refused ? e.port : null });
    }
  }
  return immutableConfiguration({ occurrences, diagnostics });
}
