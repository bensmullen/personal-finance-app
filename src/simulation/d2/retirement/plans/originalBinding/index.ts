import { sha256 } from "../../../../../rules/tax/t1b/contentIdentity.js";
import { civilDate } from "../../../../../time/index.js";
import { Money } from "../../../../../values/index.js";
import { immutableConfiguration as freeze } from "../../../../r3/compiledHousehold.js";
import { canonicalSerialize as key } from "../../../../run.js";
import { capacityKey, evaluatePlanContributions, type ContributionRequest, type PlanEvaluation,
  type PlanPeriod, type PlanSource, type PriorCapacity } from "../index.js";
import type { BindingCode, BindingRequest, BindingResult, MemberIdentity, OriginalInventory,
  OriginalPin, OriginalProvider, OriginalPublication, OriginalRole, Permission } from "./types.js";
export type * from "./types.js";

const roles: readonly OriginalRole[] = ["plan", "funding", "legal", "history"];
const families = ["401k", "403b", "federal_tsp", "governmental_457b", "sep_ira", "simple_ira"];
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const same = (a: unknown, b: unknown): boolean => key(a) === key(b);
const id = (s: string): boolean => typeof s === "string" && s.trim().length > 0 && s.length <= 256;
const unique = (xs: readonly string[]): boolean => xs.every(id) && new Set(xs).size === xs.length;
class Refused extends Error { constructor(readonly code: BindingCode) { super(code); } }
function need(ok: boolean, code: BindingCode): asserts ok { if (!ok) throw new Refused(code); }
function period(p: PlanPeriod): void {
  civilDate(p.start); civilDate(p.endExclusive); need(p.start < p.endExclusive, "INVALID_ORIGINAL");
}
const inside = (d: string, p: PlanPeriod): boolean => d >= p.start && d < p.endExclusive;
const identity = (m: MemberIdentity): string => key([m.personId, m.sponsorId, m.planId, m.family, m.destinationAccountId]);
const permissionKey = (p: Pick<ContributionRequest, "payer" | "taxBucket" | "contributionType">): string =>
  key([p.payer, p.taxBucket, p.contributionType]);
const scopeKey = (p: { personId: string; limitScope: { kind: string; aggregationId: string } }): string =>
  key([p.personId, p.limitScope.kind, p.limitScope.aggregationId]);
/** Array order is part of the full signed original; presentation order of
 * requests never changes a witness or chooses between competing originals. */
export const planOriginalDigest = (o: OriginalPublication): string => `plan-original/v1:sha256:${sha256(key(o))}`;
export const planOriginalPin = (o: OriginalPublication): OriginalPin => ({ role: o.role,
  publisherId: o.publisherId, sourceId: o.sourceId, originalId: o.originalId, version: o.version,
  digest: planOriginalDigest(o) });

function read(role: OriginalRole, request: BindingRequest, providers: readonly OriginalProvider[]): {
  original: OriginalPublication; inventoryWitness: string; environment: OriginalProvider["environment"];
} {
  const pins = request.pins.filter(p => p.role === role);
  need(pins.length === 1, "INVALID_ORIGINAL");
  const pin = pins[0]!;
  need([pin.publisherId, pin.sourceId, pin.originalId, pin.version].every(id) &&
    /^plan-original\/v1:sha256:[a-f0-9]{64}$/.test(pin.digest), "INVALID_ORIGINAL");
  const ports = providers.filter(p => p.role === role && p.publisherId === pin.publisherId);
  need(ports.length === 1, "MISSING_PROVIDER");
  const port = ports[0]!;
  need(["institution", "simulation"].includes(port.environment), "UNAUTHENTICATED_SOURCE");
  const query = freeze({ role, householdId: request.householdId, taxYear: request.taxYear,
    knownAt: request.asOf, dataCutoff: request.dataCutoff });
  let book: OriginalInventory;
  try {
    const fetched = port.readOriginals(query);
    need(Boolean(fetched), "UNAVAILABLE_SOURCE");
    book = freeze(fetched!);
    need(port.authenticate(book) === true, "UNAUTHENTICATED_SOURCE");
  } catch (e) { throw e instanceof Refused ? e : new Refused("UNAUTHENTICATED_SOURCE"); }
  need(same(book.query, query) && book.publisherId === pin.publisherId &&
    book.completeThrough === request.dataCutoff && book.coverage === "complete_year_book" &&
    book.originals.length <= 64 && book.revisions.length <= 2048, "INCOMPLETE_INVENTORY");
  for (const r of book.revisions) {
    civilDate(r.knownAt); period(r.effective);
    need(id(r.originalId) && id(r.revisionId), "INVALID_ORIGINAL");
    need(r.knownAt > request.dataCutoff, "KNOWN_REVISION");
  }
  // Never select a winner from competing IDs, versions or withdrawals.
  need(book.originals.length === 1, "COMPETING_ORIGINALS");
  const o = book.originals[0]!;
  period(o.effective); civilDate(o.publishedAt); civilDate(o.knownAt);
  need(o.role === role && o.householdId === request.householdId && o.taxYear === request.taxYear &&
    o.publisherId === pin.publisherId && id(o.jurisdiction), "IDENTITY_CONFLICT");
  need(o.publishedAt <= o.knownAt && o.knownAt <= request.dataCutoff &&
    o.status === "active" && o.revisesOriginalId === null, "UNAVAILABLE_SOURCE");
  // Bound books before hashing; no event row retains these payloads.
  if (o.role === "plan") need(o.payload.members.length <= 256, "INVALID_ORIGINAL");
  if (o.role === "funding") need(o.payload.authorizations.length <= 256, "INVALID_ORIGINAL");
  if (o.role === "legal") need(o.payload.permissions.length <= 2048 && o.payload.capacities.length <= 2048, "INVALID_ORIGINAL");
  if (o.role === "history") need(o.payload.people.length <= 256 && o.payload.capacities.length <= 2048 &&
    o.payload.operations.length <= 10000, "INVALID_ORIGINAL");
  need(same(planOriginalPin(o), pin), "ORIGINAL_CHANGED");
  return { original: o, inventoryWitness: sha256(key(book)), environment: port.environment };
}

function source(o: OriginalPublication, ruleSnapshotId = o.originalId, effective = o.effective): PlanSource {
  return { ruleSnapshotId, jurisdiction: o.jurisdiction, ruleFamily: `original_plan_${o.role}`,
    sourcePublication: o.sourceId, asOf: o.knownAt, effectiveYear: o.taxYear, effectivePeriod: effective,
    version: o.version, projectionStatus: "verified" };
}
function exact(m: Money): void {
  need(m instanceof Money && !m.isNegative() && m.amount.fitsScale(m.currency.minorUnitScale), "INVALID_ORIGINAL");
}
function derive(request: BindingRequest, originals: readonly OriginalPublication[]): {
  requests: ContributionRequest[]; priorCapacities: PriorCapacity[]; observedOperationIds: string[];
} {
  const plan = originals.find(o => o.role === "plan")!;
  const funding = originals.find(o => o.role === "funding")!;
  const legal = originals.find(o => o.role === "legal")!;
  const history = originals.find(o => o.role === "history")!;
  need(plan.role === "plan" && funding.role === "funding" && legal.role === "legal" && history.role === "history", "INVALID_ORIGINAL");
  need(unique(originals.map(o => o.publisherId)) && unique(originals.map(o => o.originalId)) &&
    unique(originals.map(o => o.sourceId)) && new Set(originals.map(o => o.jurisdiction)).size === 1, "IDENTITY_CONFLICT");
  const members = plan.payload.members, auths = funding.payload.authorizations, laws = legal.payload;
  const h = history.payload;
  need(unique(members.map(identity)) && unique(auths.map(a => a.operationId)) &&
    unique(auths.map(a => a.claimId)) && unique(auths.map(a => a.sourceReferenceId)) &&
    unique(auths.map(a => a.authorizationId)), "REPLAYED_CLAIM");
  for (const m of members) {
    need(Object.values({ person: m.personId, sponsor: m.sponsorId, plan: m.planId, account: m.destinationAccountId }).every(id) &&
      m.ownerPersonId === m.personId && m.permissions.length <= 64, "IDENTITY_CONFLICT");
    period(m.enrollment);
    need(!members.some(other => other.planId === m.planId && (other.sponsorId !== m.sponsorId || other.family !== m.family)) &&
      !members.some(other => other.destinationAccountId === m.destinationAccountId && identity(other) !== identity(m)), "IDENTITY_CONFLICT");
    need(new Set(m.permissions.map(permissionKey)).size === m.permissions.length &&
      m.permissions.every(p => unique(p.compensationTypes)), "INVALID_ORIGINAL");
  }
  need(unique(laws.capacities.map(scopeKey)) && unique(h.capacities.map(scopeKey)) &&
    unique(laws.permissions.map(p => key([identity(p), permissionKey(p.permission)]))), "IDENTITY_CONFLICT");
  need(unique(h.people.map(p => p.personId)) && unique(h.operations.map(o => o.operationId)) &&
    unique(h.operations.map(o => o.claimId)) && unique(h.operations.map(o => o.sourceReferenceId)), "INCOMPLETE_HISTORY");
  for (const p of h.people) need(unique(p.sponsorIds) && unique(p.families) &&
    same([...p.families].sort(compare), [...families].sort(compare)), "INCOMPLETE_HISTORY");
  for (const m of members) need(h.people.some(p => p.personId === m.personId && p.sponsorIds.includes(m.sponsorId)), "INCOMPLETE_HISTORY");
  for (const l of laws.permissions) {
    need(members.some(m => identity(m) === identity(l)) && l.capacities.length > 0 && l.capacities.length <= 32 &&
      unique(l.permission.compensationTypes) && new Set(l.capacities.map(r => key(r.limitScope))).size === l.capacities.length, "IDENTITY_CONFLICT");
    for (const ref of l.capacities) need(laws.capacities.some(c => c.personId === l.personId && same(c.limitScope, ref.limitScope) &&
      c.ruleSnapshotId === ref.ruleSnapshotId), "INCOMPLETE_INVENTORY");
  }
  const capacityIds = new Set(laws.capacities.map(c => capacityKey(c.personId, request.taxYear, c)));
  for (const o of h.operations) {
    civilDate(o.effectiveAt); exact(o.amount);
    need(Number(o.effectiveAt.slice(0, 4)) === request.taxYear && o.amount.isPositive() &&
      h.people.some(p => p.personId === o.personId && p.sponsorIds.includes(o.sponsorId)) && families.includes(o.family) &&
      o.capacityKeys.length > 0 && unique(o.capacityKeys) && o.capacityKeys.every(k => capacityIds.has(k) &&
        laws.capacities.some(c => c.personId === o.personId && capacityKey(c.personId, request.taxYear, c) === k)), "INCOMPLETE_HISTORY");
  }
  const priorCapacities: PriorCapacity[] = [];
  for (const c of laws.capacities) {
    period(c.effective); exact(c.maximum);
    need(h.people.some(p => p.personId === c.personId), "INCOMPLETE_HISTORY");
    const rows = h.capacities.filter(row => scopeKey(row) === scopeKey(c) && row.ruleSnapshotId === c.ruleSnapshotId);
    need(rows.length === 1, "INCOMPLETE_HISTORY");
    const row = rows[0]!, k = capacityKey(c.personId, request.taxYear, c);
    exact(row.used);
    const operations = h.operations.filter(o => o.effectiveAt < request.asOf && o.capacityKeys.includes(k));
    need(unique(row.operationIds) && same([...row.operationIds].sort(compare), operations.map(o => o.operationId).sort(compare)), "INCOMPLETE_HISTORY");
    need(operations.every(o => o.personId === c.personId && o.amount.currency.equals(c.maximum.currency)) &&
      row.used.currency.equals(c.maximum.currency), "INCOMPLETE_HISTORY");
    // Reconcile the authoritative itemization, not contribution/cap arithmetic.
    const total = operations.reduce((sum, o) => sum.plus(o.amount), Money.zero(c.maximum.currency));
    need(total.equals(row.used) && (operations.length === 0 ? row.evidence === "confirmed_zero" : row.evidence === "itemized_consumption"), "INCOMPLETE_HISTORY");
    priorCapacities.push({ personId: c.personId, taxYear: request.taxYear, limitScope: c.limitScope,
      ruleSnapshotId: c.ruleSnapshotId, maximum: c.maximum, used: row.used,
      source: source(legal, c.ruleSnapshotId, c.effective), usageSource: source(history),
      asOf: request.asOf, completeness: "complete" });
  }
  need(h.capacities.length === laws.capacities.length, "INCOMPLETE_HISTORY");
  // Validate the entire funding book, including unused/disputed rows.
  for (const a of auths) {
    civilDate(a.effectiveAt); exact(a.amount); exact(a.compensation.eligibleAmount); exact(a.compensation.contributionCap);
    need(members.some(m => identity(m) === identity(a)) && a.signedBy === funding.publisherId &&
      id(a.sourceAccountId) && a.compensation.personId === a.personId && a.compensation.sponsorId === a.sponsorId &&
      id(a.compensation.sourceAccountId), "IDENTITY_CONFLICT");
    need([plan, funding, legal, history].every(o => inside(a.effectiveAt, o.effective)), "UNAVAILABLE_SOURCE");
    need(!h.operations.some(o => o.operationId === a.operationId || o.claimId === a.claimId ||
      o.sourceReferenceId === a.sourceReferenceId), "REPLAYED_CLAIM");
  }
  const requests = request.operationIds.map(operationId => {
    const a = auths.find(row => row.operationId === operationId);
    need(Boolean(a), "UNAVAILABLE_SOURCE");
    const f = a!, m = members.find(row => identity(row) === identity(f))!;
    const permissions = m.permissions.filter(p => permissionKey(p) === permissionKey(f));
    const legalPermissions = laws.permissions.filter(p => identity(p) === identity(f) && permissionKey(p.permission) === permissionKey(f));
    need(permissions.length === 1 && legalPermissions.length === 1, "INCOMPLETE_INVENTORY");
    const lp = legalPermissions[0]!, pp = permissions[0]!;
    const compensationTypes = pp.compensationTypes.filter(t => lp.permission.compensationTypes.includes(t));
    return { operationId, personId: f.personId, sponsorId: f.sponsorId, planId: f.planId, family: f.family,
      enrollment: m.enrollment, enrollmentSource: source(plan), destinationAccountId: f.destinationAccountId,
      currency: f.amount.currency, taxYear: request.taxYear, effectiveAt: f.effectiveAt, amount: f.amount,
      payer: f.payer, taxBucket: f.taxBucket, contributionType: f.contributionType,
      funding: { kind: f.kind, sourceReferenceId: f.sourceReferenceId, sourceAccountId: f.sourceAccountId,
        personId: f.personId, sponsorId: f.sponsorId, source: source(funding) },
      compensation: { ...f.compensation, taxYear: request.taxYear, source: source(funding) },
      rules: { personId: f.personId, sponsorId: f.sponsorId, planId: f.planId, family: f.family,
        participation: m.participation, source: source(legal), permissions: [{ ...pp, compensationTypes,
          scopeCompleteness: "complete" as const, capacities: lp.capacities }] } };
  });
  return { requests, priorCapacities, observedOperationIds: h.operations.map(o => o.operationId) };
}

/** Atomic source-only batch. The unchanged owner is invoked at most once;
 * every mandatory inventory is re-read even if qualification/evaluation fails. */
export function bindPlanContributionOriginals(input: BindingRequest,
  providers: readonly OriginalProvider[] = []): BindingResult {
  const request = freeze(input);
  civilDate(request.asOf); civilDate(request.dataCutoff); period(request.period);
  need(id(request.householdId) && Number.isSafeInteger(request.taxYear) && request.dataCutoff === request.asOf &&
    Number(request.period.start.slice(0, 4)) === request.taxYear &&
    request.period.endExclusive <= `${request.taxYear + 1}-01-01` && request.operationIds.length > 0 &&
    request.operationIds.length <= 256 && request.operationIds.every(id), "INVALID_ORIGINAL");
  const diagnostics: BindingResult["diagnostics"][number][] = [];
  const fail = (code: BindingCode, role: OriginalRole | "batch"): void => { diagnostics.push({ code, role }); };
  const reads = new Map<OriginalRole, ReturnType<typeof read>>();
  if (request.pins.length !== 4 || !unique(request.operationIds)) fail("INVALID_ORIGINAL", "batch");
  for (const role of roles) {
    try { reads.set(role, read(role, request, providers)); }
    catch (e) { fail(e instanceof Refused ? e.code : "INVALID_ORIGINAL", role); }
  }
  let evaluation: PlanEvaluation | undefined;
  if (!diagnostics.length) {
    try {
      const qualified = derive(request, roles.map(r => reads.get(r)!.original));
      evaluation = evaluatePlanContributions({ asOf: request.asOf, period: request.period, ...qualified });
    } catch (e) { fail(e instanceof Refused ? e.code : "INVALID_ORIGINAL", "batch"); }
  }
  for (const role of roles) {
    try {
      const next = read(role, request, providers);
      if (!reads.has(role) || next.inventoryWitness !== reads.get(role)!.inventoryWitness ||
        next.environment !== reads.get(role)!.environment) fail("SOURCE_RACE", role);
    } catch { fail("SOURCE_RACE", role); }
  }
  const originals = roles.filter(r => reads.has(r)).map(role => {
    const r = reads.get(role)!, pin = planOriginalPin(r.original);
    return { ...pin, referenceId: `plan-original-ref/v1:${sha256(key(pin))}`, environment: r.environment };
  }).sort((a, b) => compare(a.referenceId, b.referenceId));
  const sourceRefs = originals.map(o => o.referenceId);
  const admitted = diagnostics.length === 0 && evaluation?.diagnostics.length === 0;
  return freeze({ contract: "plan-original-binding/v1", committed: false, postable: false,
    funding: "incomplete", tax: "incomplete", settlement: "incomplete", originals,
    candidates: admitted ? evaluation!.candidates.map(c => ({ ...c, sourceRefs })) : [],
    capacityProposals: admitted ? evaluation!.capacityProposals : [],
    coverage: [...request.operationIds].sort(compare).map(operationId => ({ operationId, period: request.period,
      sourceEntityPath: key(["plan-contributions", operationId]), affectedOutput: "contribution_capacity",
      coverage: admitted ? "conditional" : "incomplete",
      diagnosticCodes: [...new Set([...diagnostics.map(d => d.code),
        ...(evaluation?.diagnostics.filter(d => d.operationId === operationId).map(d => d.diagnosticCode) ?? []),
        ...(!admitted ? ["ATOMIC_BATCH_REJECTED"] : [])])].sort(compare), traceRefs: sourceRefs })),
    diagnostics: diagnostics.sort((a, b) => compare(key(a), key(b))) });
}
