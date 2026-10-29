import { civilDate } from "../../../../../src/time/index.js";
import { money } from "../../../../../src/values/index.js";
import { capacityKey, type PlanFamily, type ScopeKind } from "../../../../../src/simulation/d2/retirement/plans/index.js";
import { canonicalSerialize } from "../../../../../src/simulation/run.js";
import { bindPlanContributionOriginals, planOriginalPin, type BindingRequest, type OriginalPublication,
  type OriginalInventory, type OriginalProvider, type OriginalPublisher, type OriginalRole,
  type MemberIdentity, type PlanMember, type Permission, type LegalPermission, type LegalCapacity,
  type FundingAuthorization, type HistoricalCapacity, type HistoricalOperation } from "../../../../../src/simulation/d2/retirement/plans/originalBinding/index.js";

// Independently authored synthetic sources; these are not IRS limits or actual
// institutions. The publisher seals entire inventories in a private registry.
export const annual = { start: civilDate("2026-01-01"), endExclusive: civilDate("2027-01-01") };
export const asOf = civilDate("2026-02-01");
export const allFamilies = ["401k", "403b", "governmental_457b", "federal_tsp", "sep_ira", "simple_ira"] as const;
export interface Route { family: PlanFamily; person?: string; payer?: "employee" | "employer" }
export const five: Route[] = [
  { family: "403b" }, { family: "federal_tsp" }, { family: "governmental_457b" },
  { family: "sep_ira" }, { family: "simple_ira" },
];
export function scenario(routes: readonly Route[] = five, eventCount = 1) {
  const members: PlanMember[] = [], authorizations: FundingAuthorization[] = [], permissions: LegalPermission[] = [];
  const caps = new Map<string, LegalCapacity>();
  for (const [i, route] of routes.entries()) {
    const personId = route.person ?? "member-a", sponsorId = `sponsor-${i}`;
    const identity: MemberIdentity = { personId, sponsorId, planId: `plan-${i}`, family: route.family,
      destinationAccountId: `${personId}:plan-${i}:owned` };
    const payer = route.payer ?? (route.family === "sep_ira" ? "employer" : "employee");
    const permission: Permission = { payer, taxBucket: "pretax", contributionType: payer === "employee" ? "ordinary_deferral" : "employer_addition",
      compensationTypes: ["eligible_wages"] };
    members.push({ ...identity, ownerPersonId: personId, enrollment: annual, participation: "eligible", permissions: [permission] });
    const scopes: ScopeKind[] = ["compensation"];
    if (["403b", "federal_tsp", "sep_ira"].includes(route.family)) scopes.push("annual_additions");
    if (route.family === "governmental_457b") scopes.push("governmental_457");
    if (payer === "employee" && route.family !== "governmental_457b") scopes.push("aggregate_deferral");
    if (payer === "employer") scopes.push("employer");
    if (route.family === "simple_ira" && payer === "employee") scopes.push("simple_deferral");
    const capacities = scopes.map(kind => {
      const aggregationId = ["aggregate_deferral", "governmental_457", "simple_deferral"].includes(kind) ? "person" : sponsorId;
      const ref = { limitScope: { kind, aggregationId }, ruleSnapshotId: `simulation-law:${kind}:${aggregationId}` };
      const cap: LegalCapacity = { ...ref, personId, maximum: money("1000.00"), effective: annual };
      caps.set(capacityKey(personId, 2026, cap), cap);
      return ref;
    });
    permissions.push({ ...identity, permission, capacities });
    for (let n = 0; n < eventCount; n++) {
      const suffix = `${i}:${String(n).padStart(3, "0")}`;
      authorizations.push({ ...identity, operationId: `operation:${suffix}`, claimId: `claim:${suffix}`,
        sourceReferenceId: `signed-source-item:${suffix}`, authorizationId: `signed-authorization:${suffix}`,
        sourceAccountId: `${sponsorId}:${payer}:source`, effectiveAt: civilDate("2026-02-15"), amount: money("1.01"),
        payer, taxBucket: "pretax", contributionType: permission.contributionType,
        kind: payer === "employee" ? "payroll" : "employer", signedBy: "simulation:funding-publisher",
        compensation: { personId, sponsorId, sourceAccountId: `${sponsorId}:employee:source`, type: "eligible_wages",
          eligibleAmount: money("2000.00"), contributionCap: money("1000.00") } });
    }
  }
  // Independent prior 401(k) employer consumption in the shared deferral book.
  const operations: HistoricalOperation[] = [];
  const histories: HistoricalCapacity[] = [];
  for (const [k, c] of caps) {
    const shared = c.limitScope.kind === "aggregate_deferral";
    const operationId = `prior-401k:${c.personId}`;
    if (shared) operations.push({ operationId, claimId: `${operationId}:claim`, sourceReferenceId: `${operationId}:item`,
      personId: c.personId, sponsorId: "previous-employer", family: "401k", effectiveAt: civilDate("2026-01-15"),
      amount: money("17.25"), capacityKeys: [k] });
    histories.push({ personId: c.personId, limitScope: c.limitScope, ruleSnapshotId: c.ruleSnapshotId,
      used: money(shared ? "17.25" : "0.00"), evidence: shared ? "itemized_consumption" : "confirmed_zero",
      operationIds: shared ? [operationId] : [] });
  }
  const people = [...new Set(members.map(m => m.personId))].map(personId => ({ personId,
    sponsorIds: [...new Set([...members.filter(m => m.personId === personId).map(m => m.sponsorId), "previous-employer"])],
    families: [...allFamilies] }));
  function publication<R extends OriginalRole>(role: R, payload: OriginalPublication<R>["payload"]): OriginalPublication<R> {
    return { role, householdId: "synthetic-household", taxYear: 2026, publisherId: `simulation:${role}-publisher`,
      sourceId: `simulation:${role}-source`, originalId: `simulation:${role}-original`, version: "v1",
      jurisdiction: "US:synthetic", publishedAt: civilDate("2026-01-31"), knownAt: civilDate("2026-01-31"),
      effective: annual, status: "active", revisesOriginalId: null, payload } as OriginalPublication<R>;
  }
  let originals: OriginalPublication[] = [publication("plan", { members }), publication("funding", { authorizations }),
    publication("legal", { permissions, capacities: [...caps.values()] }), publication("history", { people, capacities: histories, operations })];
  const readCounts: Record<OriginalRole, number> = { plan: 0, funding: 0, legal: 0, history: 0 };
  const authCounts: Record<OriginalRole, number> = { plan: 0, funding: 0, legal: 0, history: 0 };
  const sealed = new Set<string>();
  const sourceChanges = new Map<OriginalRole, (book: OriginalInventory, read: number) => OriginalInventory>();
  const transportChanges = new Map<OriginalRole, (book: OriginalInventory) => OriginalInventory>();
  const roles: OriginalRole[] = ["plan", "funding", "legal", "history"];
  const publishers: OriginalPublisher[] = roles.map(role => ({ role, publisherId: `simulation:${role}-publisher`,
    retrieve(query) {
      readCounts[role]++;
      let book: OriginalInventory = { query, publisherId: `simulation:${role}-publisher`, completeThrough: query.dataCutoff,
        coverage: "complete_year_book", originals: originals.filter(o => o.role === role), revisions: [] };
      book = sourceChanges.get(role)?.(book, readCounts[role]) ?? book;
      sealed.add(canonicalSerialize(book));
      return book;
    } }));
  const providers: OriginalProvider[] = publishers.map(p => ({ role: p.role, publisherId: p.publisherId, environment: "simulation",
    readOriginals(query) {
      const book = p.retrieve(query)!;
      return transportChanges.get(p.role)?.(book) ?? book;
    },
    authenticate(book) { authCounts[p.role]++; return sealed.has(canonicalSerialize(book)); } }));
  const request = (): BindingRequest => ({ householdId: "synthetic-household", taxYear: 2026, asOf, dataCutoff: asOf,
    period: annual, operationIds: authorizations.map(a => a.operationId), pins: originals.map(planOriginalPin) });
  return { providers, publishers, readCounts, authCounts, request, sourceChanges, transportChanges,
    get originals() { return originals; },
    edit<R extends OriginalRole>(role: R, change: (o: OriginalPublication<R>) => OriginalPublication<R>) {
      originals = originals.map(o => o.role === role ? change(o as OriginalPublication<R>) : o);
    },
    run(input: BindingRequest = request(), ports: readonly OriginalProvider[] = providers) {
      return bindPlanContributionOriginals(input, ports);
    } };
}
