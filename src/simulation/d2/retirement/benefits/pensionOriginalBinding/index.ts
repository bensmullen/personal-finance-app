import { sha256 } from "../../../../../rules/tax/t1b/contentIdentity.js";
import { civilDate } from "../../../../../time/index.js";
import { immutableConfiguration } from "../../../../r3/compiledHousehold.js";
import { canonicalSerialize as key } from "../../../../run.js";
import { calculateQuotedBenefits, type BenefitPeriod, type BenefitSource } from "../index.js";
import { provePensionPayments, type PensionEvidence, type PensionPaymentRequest } from "../pensionPayment/index.js";
import type { PensionBindingCode, PensionBindingRequest, PensionBindingResult, PensionOriginalClaim,
  PensionOriginalInventory, PensionOriginalPin, PensionOriginalProvider, PensionOriginalPublication,
  PensionOriginalReference, PensionOriginalRole } from "./types.js";
export type * from "./types.js";

const roles: readonly PensionOriginalRole[] = ["plan", "bank", "legal", "history"];
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const same = (a: unknown, b: unknown): boolean => key(a) === key(b);
const id = (s: string): boolean => typeof s === "string" && s.trim().length > 0 && s.length <= 256;
class Refused extends Error {
  constructor(readonly code: PensionBindingCode) { super(code); }
}
function need(ok: boolean, code: PensionBindingCode): asserts ok { if (!ok) throw new Refused(code); }
function period(p: BenefitPeriod): void {
  civilDate(p.start); civilDate(p.endExclusive); need(p.start < p.endExclusive, "INVALID_ORIGINAL");
}
// Evidence arrays are sets; retain duplicate occurrences rather than deduping.
function normalized(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalized).sort((a, b) => compare(key(a), key(b)));
  if (v && Object.getPrototypeOf(v) === Object.prototype)
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalized(x)]));
  return v;
}
export const pensionOriginalDigest = (p: PensionOriginalPublication): string =>
  `pension-original/v1:sha256:${sha256(key(normalized(p)))}`;

function read(pin: PensionOriginalPin, claim: PensionOriginalClaim, request: PensionBindingRequest,
  providers: readonly PensionOriginalProvider[]): PensionOriginalPublication {
  const ports = providers.filter(p => p.role === pin.role && p.publisherId === pin.publisherId);
  need(ports.length > 0, "MISSING_PROVIDER"); need(ports.length === 1, "UNQUALIFIED_INVENTORY");
  const query = immutableConfiguration({ role: pin.role, householdId: request.householdId,
    entitlementId: claim.identity.entitlementId, knownAt: request.knownAt, dataCutoff: request.dataCutoff });
  let fetched: PensionOriginalInventory | undefined;
  try { fetched = ports[0]!.readOriginals(query); } catch { throw new Refused("ORIGINAL_UNAVAILABLE"); }
  need(Boolean(fetched), "ORIGINAL_UNAVAILABLE");
  const h = immutableConfiguration(fetched!);
  need(h.publisherId === pin.publisherId && same(h.query, query) &&
    h.authentication === "authenticated_publisher" && h.completeness === "complete_since_commencement" &&
    h.completeThrough === request.dataCutoff && h.checkedAt === request.knownAt &&
    h.originals.length <= 64 && h.revisions.length <= 1200, "UNQUALIFIED_INVENTORY");
  for (const r of h.revisions) {
    civilDate(r.publishedAt); civilDate(r.knownAt);
    need(id(r.originalId) && id(r.revisionId) && r.publishedAt <= r.knownAt, "UNQUALIFIED_INVENTORY");
    // Delayed corrections published through cutoff invalidate replay too.
    need(r.knownAt > request.knownAt || r.publishedAt > request.dataCutoff, "KNOWN_REVISION");
  }
  need(h.originals.length > 0, "ORIGINAL_UNAVAILABLE");
  for (const o of h.originals) {
    period(o.eventPeriod); civilDate(o.publishedAt); civilDate(o.knownAt);
    need(o.role === pin.role && o.publisherId === pin.publisherId &&
      o.identity.householdId === request.householdId && o.identity.entitlementId === claim.identity.entitlementId,
    "IDENTITY_MISMATCH");
  }
  // Never pick a current version or hide an inactive competitor.
  need(h.originals.length === 1, "COMPETING_ORIGINALS");
  const o = h.originals[0]!;
  // Bound source-owned arrays before hashing and before retaining partially
  // retrieved books for symmetric conflict detection.
  if (o.role === "bank") need(Array.isArray(o.payload.confirmations) &&
    o.payload.confirmations.length <= 1200 && o.payload.confirmations.every(c => Boolean(c) && typeof c === "object"), "INVALID_ORIGINAL");
  if (o.role === "history") need(Array.isArray(o.payload.installments) &&
    o.payload.installments.length <= 1200 && o.payload.installments.every(row => Boolean(row) && typeof row === "object"), "INVALID_ORIGINAL");
  if (o.role === "legal") need(Array.isArray(o.payload.instructions) && o.payload.instructions.length <= 1200, "INVALID_ORIGINAL");
  if (o.role === "plan") need(Array.isArray(o.payload.award.cola?.changes) &&
    o.payload.award.cola!.changes.length <= 1200, "INVALID_ORIGINAL");
  need(o.sourceId === pin.sourceId && o.version === pin.sourceVersion && o.originalId === pin.originalId &&
    pensionOriginalDigest(o) === pin.digest, "ORIGINAL_CHANGED");
  need(o.kind === "original" && o.revisesOriginalId === null && o.status === "active", "ORIGINAL_UNAVAILABLE");
  need(same(o.identity, claim.identity), "IDENTITY_MISMATCH");
  need(o.publishedAt <= o.knownAt && o.knownAt <= request.dataCutoff && o.knownAt <= request.knownAt,
    "UNAVAILABLE_EVIDENCE");
  return o;
}
function source(s: BenefitSource, o: PensionOriginalPublication): void {
  civilDate(s.asOf);
  need([s.ruleSnapshotId, s.jurisdiction, s.ruleFamily, s.sourcePublication, s.version].every(id) &&
    s.projectionStatus === "verified" && s.asOf <= o.knownAt, "UNAVAILABLE_EVIDENCE");
}
function evidence(o: PensionOriginalPublication): PensionEvidence {
  source(o.source, o);
  need(o.source.sourcePublication === o.sourceId && o.source.version === o.version, "IDENTITY_MISMATCH");
  return { evidenceId: o.originalId, publishedAt: o.publishedAt, knownAt: o.knownAt,
    effective: o.eventPeriod, source: o.source, verified: true };
}
interface Qualified {
  readonly claim: PensionOriginalClaim;
  readonly request: PensionPaymentRequest;
}
function derive(claim: PensionOriginalClaim, publications: readonly PensionOriginalPublication[],
  request: PensionBindingRequest): Qualified {
  const plan = publications.find(p => p.role === "plan")!;
  const bank = publications.find(p => p.role === "bank")!;
  const legal = publications.find(p => p.role === "legal")!;
  const history = publications.find(p => p.role === "history")!;
  need(plan.role === "plan" && bank.role === "bank" && legal.role === "legal" && history.role === "history", "INVALID_ORIGINAL");
  need(plan.publisherId !== bank.publisherId && plan.sourceId !== bank.sourceId &&
    plan.originalId !== bank.originalId && bank.payload.signedBy === bank.publisherId, "UNQUALIFIED_INVENTORY");
  const a = plan.payload.award, identity = claim.identity;
  need(a.benefitKind === "pension" && a.householdId === identity.householdId && a.entitlementId === identity.entitlementId &&
    a.sponsorId === identity.sponsorId && a.recipientPersonId === identity.participantPersonId &&
    a.workerRecordPersonId === identity.workerRecordPersonId && (a.beneficiaryId ?? null) === identity.beneficiaryId &&
    (a.election?.beneficiaryId ?? null) === identity.beneficiaryId && a.quote?.basis === "post_election", "IDENTITY_MISMATCH");
  need(a.quote!.source.sourcePublication === plan.sourceId && a.quote!.source.version === plan.version, "IDENTITY_MISMATCH");
  need(Boolean(a.cola) && a.cola!.changes.length <= 1200 && bank.payload.confirmations.length <= 1200 &&
    legal.payload.instructions.length <= 1200 && history.payload.installments.length <= 1200, "INVALID_ORIGINAL");
  for (const s of [a.calendarSource, a.quote!.source, a.cola!.source, a.election!.source,
    ...a.cola!.changes.map(c => c.source), ...(a.election!.continuation ? [a.election!.continuation.source] : []),
    ...(a.withholding ? [a.withholding.source] : [])]) source(s, plan);
  for (const o of publications) {
    evidence(o);
    need(o.eventPeriod.start <= a.commencement && o.eventPeriod.endExclusive >= request.horizon.endExclusive,
      "UNAVAILABLE_EVIDENCE");
  }
  const matches = (v: { pensionId: string; planId: string; sponsorId: string; entitlementId: string }): boolean =>
    v.pensionId === identity.pensionId && v.planId === identity.planId && v.sponsorId === identity.sponsorId &&
    v.entitlementId === identity.entitlementId;
  for (const c of bank.payload.confirmations) {
    civilDate(c.publishedAt); civilDate(c.knownAt);
    need(matches(c) && c.route.institutionId === bank.payload.institutionId, "IDENTITY_MISMATCH");
    need(c.publishedAt <= c.knownAt && c.knownAt <= bank.knownAt && c.knownAt <= c.effectiveAt &&
      c.knownAt <= request.dataCutoff && bank.source.asOf <= c.knownAt, "UNAVAILABLE_EVIDENCE");
  }
  for (const i of legal.payload.instructions) {
    need(matches(i) && i.householdId === request.householdId && i.workerRecordPersonId === identity.workerRecordPersonId &&
      i.beneficiaryId === identity.beneficiaryId && i.ownerPersonIds.length > 0 &&
      new Set(i.ownerPersonIds).size === i.ownerPersonIds.length && i.ownerPersonIds.every(id) &&
      i.ownerPersonIds.includes(i.recipientPersonId), "IDENTITY_MISMATCH");
    for (const c of bank.payload.confirmations.filter(c => c.instructionId === i.instructionId))
      need(same([...c.route.ownerPersonIds].sort(compare), [...i.ownerPersonIds].sort(compare)), "IDENTITY_MISMATCH");
  }
  const h = history.payload;
  period(h.covered);
  need(h.entitlementId === identity.entitlementId && h.covered.start <= a.commencement &&
    h.covered.endExclusive >= request.horizon.endExclusive, "CONFLICTING_HISTORY");
  // One complete calendar evaluation per inventory, including history outside
  // the display horizon. The unchanged verifier owns per-installment economics.
  const calendar = calculateQuotedBenefits({ householdId: request.householdId,
    horizon: { start: a.commencement, endExclusive: h.covered.endExclusive }, awards: [a] });
  need(calendar.diagnostics.length === 0, "INVALID_ORIGINAL");
  const schedule = new Map(calendar.proposals.map(p => [p.effectiveAt, p]));
  const seen = new Set<string>();
  for (const row of h.installments) {
    const p = schedule.get(row.effectiveAt);
    need(Boolean(p) && !seen.has(row.effectiveAt) && row.claimId === p!.claimId &&
      row.recipientPersonId === p!.actorId && ["unpaid", "paid", "exhausted"].includes(row.status) &&
      (row.status === "unpaid" ? row.paymentId === undefined && row.receiptId === undefined :
        id(row.paymentId ?? "") && id(row.receiptId ?? "")), "CONFLICTING_HISTORY");
    seen.add(row.effectiveAt);
  }
  const last = [...bank.payload.confirmations].sort((x, y) => compare(x.effectiveAt, y.effectiveAt)).at(-1)?.effectiveAt;
  for (const p of calendar.proposals) if (last && p.effectiveAt < last)
    need(seen.has(p.effectiveAt), "CONFLICTING_HISTORY");
  return { claim, request: { householdId: request.householdId, knownAt: request.knownAt, horizon: request.horizon,
    awards: [a], originals: [{ pensionId: identity.pensionId, planId: identity.planId, sponsorId: identity.sponsorId,
      entitlementId: identity.entitlementId, award: a, employeeBasis: plan.payload.employeeBasis,
      paymentMethod: plan.payload.paymentMethod, evidence: evidence(plan) }],
    confirmations: bank.payload.confirmations.map(c => ({ ...c, evidence: { ...evidence(bank),
      publishedAt: c.publishedAt, knownAt: c.knownAt } })),
    instructions: legal.payload.instructions.map(i => ({ ...i, evidence: evidence(legal) })),
    history: [{ ...h, exhaustive: true, evidence: evidence(history) }] } };
}

/** Two source reads per qualified publication, independent of month count.
 * The existing verifier remains the conditional economic authority. */
export function bindPensionOriginals(input: PensionBindingRequest,
  providers: readonly PensionOriginalProvider[] = []): PensionBindingResult {
  const request = immutableConfiguration(input);
  civilDate(request.knownAt); civilDate(request.dataCutoff); period(request.horizon);
  need(id(request.householdId) && request.dataCutoff <= request.knownAt && request.claims.length <= 64,
    "INVALID_ORIGINAL");
  const coverage: PensionBindingResult["coverage"][number][] = [];
  const intents: PensionBindingResult["intents"][number][] = [];
  const refs = new Map<string, PensionOriginalReference>();
  const failures = new Map<PensionOriginalClaim, string>();
  const fail = (c: PensionOriginalClaim, code: string): void => { failures.set(c, code); };
  const qualified: Qualified[] = [];
  const observed = new Map<PensionOriginalClaim, readonly PensionOriginalPublication[]>();
  const claims = [...request.claims].sort((a, b) => compare(key(normalized(a)), key(normalized(b))));
  for (const c of claims) {
    try {
      need(Object.values(c.identity).filter(v => v !== null).every(id) && c.identity.householdId === request.householdId &&
        c.pins.length === 4 && roles.every(r => c.pins.filter(p => p.role === r).length === 1), "INVALID_ORIGINAL");
      for (const p of c.pins) need([p.publisherId, p.sourceId, p.sourceVersion, p.originalId].every(id) &&
        /^pension-original\/v1:sha256:[a-f0-9]{64}$/.test(p.digest), "INVALID_ORIGINAL");
      const publications: PensionOriginalPublication[] = [];
      let unavailable: unknown;
      for (const r of roles) {
        try { publications.push(read(c.pins.find(p => p.role === r)!, c, request, providers)); }
        catch (e) { unavailable ??= e; }
      }
      observed.set(c, publications);
      if (unavailable) throw unavailable;
      qualified.push(derive(c, publications, request));
    } catch (e) { fail(c, e instanceof Refused ? e.code : "INVALID_ORIGINAL"); }
  }
  // An unavailable competing pin cannot make another same-entitlement pin win.
  for (let i = 0; i < claims.length; i++) for (let j = i + 1; j < claims.length; j++) {
    const a = claims[i]!, b = claims[j]!;
    if (a.identity.entitlementId === b.identity.entitlementId) {
      fail(a, "COMPETING_ORIGINALS"); fail(b, "COMPETING_ORIGINALS");
    }
  }
  // Symmetric cross-claim/history identity conflicts; no incidental first wins.
  const uses = new Map<string, { claim: PensionOriginalClaim; installment: string; kind: string }[]>();
  const use = (namespace: string, value: string | undefined, c: PensionOriginalClaim, installment: string, kind: string): void => {
    if (!value) return;
    const k = key([namespace, value]), rows = uses.get(k) ?? [];
    rows.push({ claim: c, installment, kind }); uses.set(k, rows);
  };
  for (const [claim, publications] of observed) {
    for (const o of publications) {
      if (o.role === "bank") for (const c of o.payload.confirmations) {
        const installment = key([claim.identity.entitlementId, c.recipientPersonId, c.effectiveAt]);
        for (const field of ["paymentId", "receiptId", "confirmationId", "fundingId"] as const)
          use(field, c[field], claim, installment, "confirmation");
      }
      if (o.role === "history") for (const row of o.payload.installments) {
        const installment = key([claim.identity.entitlementId, row.recipientPersonId, row.effectiveAt]);
        use("paymentId", row.paymentId, claim, installment, "history");
        use("receiptId", row.receiptId, claim, installment, "history");
      }
    }
  }
  for (const rows of uses.values()) if (rows.length > 1) {
    // The same historical payment may appear once in the BANK book and once
    // in history. It is the same occurrence, never another payable installment.
    const corroboration = rows.length === 2 && rows[0]!.claim === rows[1]!.claim &&
      rows[0]!.installment === rows[1]!.installment && rows[0]!.kind !== rows[1]!.kind;
    if (!corroboration) for (const row of rows) fail(row.claim, "CONFLICTING_HISTORY");
  }
  const eligible = qualified.filter(q => !failures.has(q.claim));
  const result = provePensionPayments({ householdId: request.householdId, knownAt: request.knownAt, horizon: request.horizon,
    awards: eligible.flatMap(q => q.request.awards), originals: eligible.flatMap(q => q.request.originals),
    confirmations: eligible.flatMap(q => q.request.confirmations), instructions: eligible.flatMap(q => q.request.instructions),
    history: eligible.flatMap(q => q.request.history) });
  // Re-fetch every mandatory original even after another port has failed.
  for (const q of qualified) for (const p of q.claim.pins) {
    try { read(p, q.claim, request, providers); }
    catch { fail(q.claim, "SOURCE_RACE"); }
  }
  for (const q of eligible.filter(q => !failures.has(q.claim))) {
    const sourceRefs = q.claim.pins.map(p => {
      const referenceId = `pension-original-ref/v1:${sha256(key(p))}`;
      refs.set(referenceId, { ...p, referenceId }); return referenceId;
    }).sort(compare);
    const entitlement = q.claim.identity.entitlementId;
    for (const intent of result.intents.filter(i => i.entitlementId === entitlement)) {
      const { source: _source, ...compact } = intent;
      intents.push({ ...compact, sourceRefs });
      coverage.push({ entitlementId: entitlement, sourceEntityPath: key(["entitlements", entitlement]),
        period: request.horizon, effectiveAt: intent.effectiveAt, affectedOutput: "pension_payment_proof",
        coverage: "conditional", diagnosticCodes: [], missingFacts: [], ruleSnapshotId: intent.ruleSnapshotId, traceRefs: sourceRefs });
    }
    for (const d of result.diagnostics.filter(d => q.request.awards.some(a => d.sourceEntityPath === key(["awards", a.awardId]))))
      coverage.push({ ...d, entitlementId: entitlement, diagnosticCodes: [d.diagnosticCode] });
  }
  for (const c of claims) if (failures.has(c)) coverage.push({ entitlementId: c.identity.entitlementId,
    sourceEntityPath: key(["entitlements", c.identity.entitlementId]), period: request.horizon,
    affectedOutput: "pension_payment_proof", coverage: "incomplete", diagnosticCodes: [failures.get(c)!],
    missingFacts: [failures.get(c)!], ruleSnapshotId: "unavailable", traceRefs: [] });
  return immutableConfiguration({ contract: "pension-original-binding/v1", originals: [...refs.values()].sort((a, b) => compare(a.referenceId, b.referenceId)),
    intents: intents.sort((a, b) => compare(a.operationId, b.operationId)), coverage: coverage.sort((a, b) => compare(key(a), key(b))),
    committed: false, postable: false, tax: "incomplete", bankSettlement: "incomplete" });
}
