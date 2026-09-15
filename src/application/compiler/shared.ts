import {
  validationIssue,
  type ValidationIssue,
} from "../../diagnostics/index.js";
import type {
  JsonValue,
  PortableModelEnvelope,
} from "../../model/modelVersion.js";
import { instant, type Instant } from "../../time/index.js";
import type { CapabilityDiagnostic, CompileResult } from "./types.js";

export type CanonicalObject = Readonly<Record<string, JsonValue>>;

export const objects = (
  model: PortableModelEnvelope,
  collection: string,
): readonly CanonicalObject[] =>
  (model.objects[collection] ?? []).filter(
    (value): value is CanonicalObject =>
      typeof value === "object" && value !== null && !Array.isArray(value),
  );

export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const EXACT_DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
export const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const canonicalId = (
  object: CanonicalObject,
  field: string,
): string | undefined => {
  const value = object[field];
  return typeof value === "string" && UUID.test(value)
    ? value.toLowerCase()
    : undefined;
};

export const utcDate = (value: JsonValue | undefined): Instant | undefined => {
  if (typeof value !== "string") return undefined;
  const match = DATE.exec(value);
  if (!match) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== value
  )
    return undefined;
  return instant(date.toISOString());
};

export const nextUtcDate = (value: string): Instant | undefined => {
  const start = utcDate(value);
  if (start === undefined) return undefined;
  const next = new Date(Date.parse(start) + 86_400_000);
  return instant(next.toISOString());
};

export const monthAnchorDay = (date: Instant): number =>
  Number(date.slice(8, 10));

export const issue = (
  code: string,
  message: string,
  entityType?: string,
  entityId?: string,
  fieldPath?: string,
  relatedIds?: readonly string[],
): ValidationIssue =>
  validationIssue({
    severity: "error",
    code,
    message,
    ...(entityType === undefined ? {} : { entityType }),
    ...(entityId === undefined ? {} : { entityId }),
    ...(fieldPath === undefined ? {} : { fieldPath }),
    ...(relatedIds === undefined ? {} : { relatedIds }),
  });

export const capability = (
  code: string,
  message: string,
  capabilityName: string,
  entityType?: string,
  entityId?: string,
  fieldPath?: string,
  relatedIds?: readonly string[],
): CapabilityDiagnostic => ({
  code,
  message,
  capability: capabilityName,
  ...(entityType === undefined ? {} : { entityType }),
  ...(entityId === undefined ? {} : { entityId }),
  ...(fieldPath === undefined ? {} : { fieldPath }),
  ...(relatedIds === undefined ? {} : { relatedIds }),
});

export interface HouseholdScope {
  readonly household: CanonicalObject;
  readonly householdId: string;
  readonly memberIds: readonly string[];
  readonly peopleById: ReadonlyMap<string, CanonicalObject>;
}

export const resolveHouseholdScope = (
  model: PortableModelEnvelope,
): CompileResult<HouseholdScope> => {
  const households = objects(model, "Household");
  if (households.length !== 1)
    return {
      status: "unsupported",
      diagnostics: Object.freeze([
        capability(
          "HOUSEHOLD_SELECTION_AMBIGUOUS",
          `Execution requires exactly one Household; found ${households.length}.`,
          "household_scope",
          "Household",
        ),
      ]),
    };
  const household = households[0]!;
  const householdId = canonicalId(household, "household_id");
  if (!householdId)
    return {
      status: "invalid_model",
      diagnostics: Object.freeze([
        issue(
          "CANONICAL_ID_INVALID",
          "Household household_id must be a valid UUID.",
          "Household",
          undefined,
          "household_id",
        ),
      ]),
    };
  if (!Array.isArray(household.members))
    return {
      status: "invalid_model",
      diagnostics: Object.freeze([
        issue(
          "HOUSEHOLD_MEMBERS_INVALID",
          "Household members must be an array of Person UUIDs.",
          "Household",
          householdId,
          "members",
        ),
      ]),
    };
  const memberIds = household.members.map((value) =>
    typeof value === "string" && UUID.test(value)
      ? value.toLowerCase()
      : undefined,
  );
  if (memberIds.some((value) => value === undefined))
    return {
      status: "invalid_model",
      diagnostics: Object.freeze([
        issue(
          "HOUSEHOLD_MEMBER_REFERENCE_INVALID",
          "Household members contains a malformed Person UUID.",
          "Household",
          householdId,
          "members",
        ),
      ]),
    };
  if (new Set(memberIds).size !== memberIds.length)
    return {
      status: "invalid_model",
      diagnostics: Object.freeze([
        issue(
          "DUPLICATE_EXECUTABLE_IDENTITY",
          "Household members contains duplicate Person identities.",
          "Household",
          householdId,
          "members",
        ),
      ]),
    };
  const peopleById = new Map<string, CanonicalObject>();
  for (const person of objects(model, "Person")) {
    const id = canonicalId(person, "person_id");
    if (!id)
      return {
        status: "invalid_model",
        diagnostics: Object.freeze([
          issue(
            "CANONICAL_ID_INVALID",
            "Person person_id must be a valid UUID.",
            "Person",
            undefined,
            "person_id",
          ),
        ]),
      };
    if (peopleById.has(id))
      return {
        status: "invalid_model",
        diagnostics: Object.freeze([
          issue(
            "DUPLICATE_EXECUTABLE_IDENTITY",
            `Duplicate Person identity ${id}.`,
            "Person",
            id,
            "person_id",
          ),
        ]),
      };
    peopleById.set(id, person);
  }
  for (const memberId of memberIds as string[]) {
    const person = peopleById.get(memberId);
    if (!person)
      return {
        status: "invalid_model",
        diagnostics: Object.freeze([
          issue(
            "HOUSEHOLD_MEMBER_REFERENCE_NOT_FOUND",
            `Household member ${memberId} does not resolve to a Person.`,
            "Household",
            householdId,
            "members",
            [memberId],
          ),
        ]),
      };
    const personHousehold = person.household_id;
    if (
      personHousehold !== undefined &&
      (typeof personHousehold !== "string" ||
        !UUID.test(personHousehold) ||
        personHousehold.toLowerCase() !== householdId)
    )
      return {
        status: "invalid_model",
        diagnostics: Object.freeze([
          issue(
            "HOUSEHOLD_MEMBERSHIP_CONTRADICTION",
            `Person ${memberId} household_id contradicts Household membership.`,
            "Person",
            memberId,
            "household_id",
            [householdId],
          ),
        ]),
      };
  }
  return {
    status: "compiled",
    value: Object.freeze({
      household,
      householdId,
      memberIds: Object.freeze(memberIds as string[]),
      peopleById,
    }),
    diagnostics: Object.freeze([]),
  };
};

export const ownerInScope = (
  owner: JsonValue | undefined,
  scope: HouseholdScope,
) =>
  typeof owner === "string" &&
  UUID.test(owner) &&
  (owner.toLowerCase() === scope.householdId ||
    scope.memberIds.includes(owner.toLowerCase()));

export const monthlyOccurrences = (
  anchor: Instant,
  end: Instant | undefined,
  horizonStart: Instant,
  horizonEnd: Instant,
): readonly Instant[] => {
  const day = monthAnchorDay(anchor);
  const values: Instant[] = [];
  const cursor = new Date(
    Date.UTC(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)) - 1, day),
  );
  while (cursor.toISOString() < horizonEnd) {
    const at = instant(cursor.toISOString());
    if (at >= anchor && at >= horizonStart && (end === undefined || at < end))
      values.push(at);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return Object.freeze(values);
};
