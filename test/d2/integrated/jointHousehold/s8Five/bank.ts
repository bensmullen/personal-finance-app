import { domainId } from "../../../../../src/identity/index.js";
import { createRunContext, runId, scenarioId } from "../../../../../src/simulation/run.js";
import { registerHouseholdBankOriginalProvider, type HouseholdBankOriginal } from "../../../../../src/simulation/d2/integration/householdBank/index.js";
import type { HouseholdBankEventContext } from "../../../../../src/state/index.js";
import { instant, utcMonthlyPeriods, type Instant } from "../../../../../src/time/index.js";
import { USD } from "../../../../../src/values/index.js";
import { ids as benefitIds } from "../../ssaMedicare/scenario.js";
import { ids as helocIds } from "../../helocServicing/scenario.js";
import { ids as retirementIds } from "../../retirementCash/scenario.js";
import { observe, testId, type Family } from "./sourceMeter.js";

export const ids = { ...benefitIds, alice: domainId("person", testId(101)), bob: benefitIds.person,
  personBank: helocIds.bank, helocPrincipal: helocIds.principal, helocCharges: helocIds.charges,
  ira: retirementIds.ira, expensePayable: domainId("liability", testId(102)) };
export const start = instant("2026-01-01T00:00:00.000Z");
export const openingMonth = instant("2025-12-01T00:00:00.000Z");
export const seenAt = instant("2029-01-01T00:00:00.000Z");
export const known = instant("2025-01-01T00:00:00.000Z");
export const through = instant("2030-01-01T00:00:00.000Z");
const run = runId(testId(103)), scenario = scenarioId(testId(104));
export const context = (months: number) => createRunContext({ runId: run, scenarioId: scenario,
  simulationStart: openingMonth, simulationEnd: utcMonthlyPeriods(start, months).at(-1)!.end, asOf: seenAt, dataCutoff: seenAt, baseCurrency: USD });
export const sameObservation = (event: Pick<HouseholdBankEventContext, "runId" | "asOf" | "dataCutoff">) =>
  event.runId === run && event.asOf === seenAt && event.dataCutoff === seenAt;
export const revision = { status: "active", publishedAt: known, knownAt: known, effectiveFrom: known, effectiveUntil: through } as const;
export const bankPublisher = "s8-five-independent-bank";
const routes = {
  fsaBank: { person: ids.alice, directions: ["debit", "credit"] },
  cardBank: { person: ids.bob, directions: ["debit"] },
  loanBank: { person: ids.alice, directions: ["debit"] },
  ssaBank: { person: ids.bob, directions: ["credit"] },
  wageBank: { person: ids.alice, directions: ["credit"] },
  premiumBank: { person: ids.bob, directions: ["debit"] },
  retirementBank: { person: ids.alice, directions: ["credit"] },
  cmsBank: { person: ids.alice, directions: ["debit"] },
} satisfies Partial<Record<Family, { person: string; directions: string[] }>>;
type Route = keyof typeof routes;
export const bank = (sourceId: Route) => ({ publisherId: bankPublisher, sourceId });
export const bankFault: { route?: Route; at?: Instant;
  mode?: "missing" | "credit-only" | "revoked" | "late" | "wrong-member" | "wrong-owner" | "wrong-account" | "wrong-household" } = {};
export function installBank(): void {
  registerHouseholdBankOriginalProvider({ publisherId: bankPublisher, readOriginals(query) {
    const { context: event, sourceId } = query;
    if (!Object.hasOwn(routes, sourceId) || !sameObservation(event)
      || event.bankAccountId !== ids.bank || event.householdId !== ids.household) return undefined;
    const name = sourceId as Route, rule = routes[name];
    if (event.personId !== rule.person || !rule.directions.includes(event.direction)) return undefined;
    const fault = bankFault.route === name && (!bankFault.at || bankFault.at === event.eventAt) ? bankFault.mode : undefined;
    const published = { ...revision, revisionId: "native-bank-v1" };
    const originals: HouseholdBankOriginal[] = [
      { ...published, kind: "account", sourceId: "shared-bank-deed", bankAccountId: ids.bank, accountKind: "checking",
        owner: fault === "wrong-owner" ? { kind: "person", id: rule.person } : { kind: "household", id: ids.household } },
      { ...published, kind: "household", sourceId: "household-roster", householdId: fault === "wrong-household" ? testId(110) : ids.household },
      { ...published, kind: "membership", sourceId: `member:${rule.person}`, householdId: ids.household, personId: rule.person },
      { ...published, kind: "permission", sourceId: `${name}:${event.direction}`,
        householdId: ids.household, bankAccountId: fault === "wrong-account" ? ids.personBank : ids.bank,
        personId: fault === "wrong-member" ? (rule.person === ids.alice ? ids.bob : ids.alice) : rule.person,
        direction: fault === "credit-only" ? "credit" : event.direction,
        status: fault === "revoked" ? "revoked" : "active",
        knownAt: fault === "late" ? through : published.knownAt },
    ];
    return observe(name, { version: "household-bank-original-inventory/v1", publisherId: bankPublisher,
      query, checkedAt: seenAt, completeThrough: seenAt, completeness: "complete",
      originals: fault === "missing" ? originals.slice(0, 3) : originals } as const);
  } });
}

export function bankEvent(personId: typeof ids.alice, eventId: string, eventAt: Instant,
  direction: HouseholdBankEventContext["direction"]): HouseholdBankEventContext {
  return { runId: run, asOf: seenAt, dataCutoff: seenAt, personId, householdId: ids.household,
    bankAccountId: ids.bank, eventId, eventAt, direction };
}
