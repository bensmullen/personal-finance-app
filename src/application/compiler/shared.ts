import {
  validationIssue,
  type ValidationIssue,
} from "../../diagnostics/index.js";
import type {
  JsonValue,
  PortableModelEnvelope,
} from "../../model/modelVersion.js";
import {
  nextUtcDateOnlyInstant,
  utcDateOnlyInstant,
  utcMonthlyOccurrences,
  type Instant,
} from "../../time/index.js";
import type { CapabilityDiagnostic, CompileResult } from "./types.js";

export type CanonicalObject = Readonly<Record<string, JsonValue>>;

const PRIMARY_ID_FIELDS = Object.freeze({
  Household: "household_id",
  Person: "person_id",
  Account: "account_id",
  Income: "income_id",
  Expense: "expense_id",
  Scenario: "scenario_id",
  PrimitiveInstance: "primitive_instance_id",
  Assumption: "assumption_id",
  Event: "event_id",
  Transaction: "transaction_id",
  Liability: "liability_id",
  Asset: "asset_id",
  Investment: "investment_id",
} as const);

export type ExecutableCollection = keyof typeof PRIMARY_ID_FIELDS;

/** Reject malformed collection entries and ambiguous identities before semantics. */
export const preflightCanonicalCollections = (
  model: PortableModelEnvelope,
  collections: readonly ExecutableCollection[],
): CompileResult<true> => {
  for (const collection of collections) {
    const seen = new Set<string>();
    const idField = PRIMARY_ID_FIELDS[collection];
    for (const value of model.objects[collection] ?? []) {
      if (typeof value !== "object" || value === null || Array.isArray(value))
        return {
          status: "invalid_model",
          diagnostics: Object.freeze([
            issue(
              "CANONICAL_OBJECT_INVALID",
              `${collection} entries must be canonical objects.`,
              collection,
            ),
          ]),
        };
      const object = value as CanonicalObject;
      const id = canonicalId(object, idField);
      if (!id)
        return {
          status: "invalid_model",
          diagnostics: Object.freeze([
            issue(
              "CANONICAL_ID_INVALID",
              `${collection} ${idField} must be a valid UUID.`,
              collection,
              undefined,
              idField,
            ),
          ]),
        };
      if (seen.has(id))
        return {
          status: "invalid_model",
          diagnostics: Object.freeze([
            issue(
              "DUPLICATE_EXECUTABLE_IDENTITY",
              `Duplicate ${collection} identity ${id}.`,
              collection,
              id,
              idField,
            ),
          ]),
        };
      seen.add(id);
    }
  }
  return { status: "compiled", value: true, diagnostics: Object.freeze([]) };
};

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
  return utcDateOnlyInstant(value);
};

export const nextUtcDate = (value: string): Instant | undefined => {
  return nextUtcDateOnlyInstant(value);
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
  const preflight = preflightCanonicalCollections(model, [
    "Household",
    "Person",
  ]);
  if (preflight.status !== "compiled") return preflight;
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
  for (const [personId, person] of peopleById) {
    if (
      typeof person.household_id === "string" &&
      UUID.test(person.household_id) &&
      person.household_id.toLowerCase() === householdId &&
      !(memberIds as string[]).includes(personId)
    )
      return {
        status: "invalid_model",
        diagnostics: Object.freeze([
          issue(
            "HOUSEHOLD_MEMBERSHIP_CONTRADICTION",
            `Person ${personId} points to Household ${householdId} but is absent from members.`,
            "Person",
            personId,
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

export type OwnerScope = "in_scope" | "out_of_scope";

/** Resolves canonical owners so broken UUIDs cannot be silently omitted. */
export const resolveOwnerScope = (
  model: PortableModelEnvelope,
  owner: JsonValue | undefined,
  scope: HouseholdScope,
  entityType: string,
  entityId: string,
): CompileResult<OwnerScope> => {
  if (typeof owner !== "string" || !UUID.test(owner))
    return {
      status: "invalid_model",
      diagnostics: Object.freeze([
        issue("OWNER_REFERENCE_INVALID", `${entityType} ${entityId} owner_id must be a UUID.`, entityType, entityId, "owner_id"),
      ]),
    };
  const id = owner.toLowerCase();
  const households = objects(model, "Household");
  const people = objects(model, "Person");
  const resolves = households.some((item) => canonicalId(item, "household_id") === id)
    || people.some((item) => canonicalId(item, "person_id") === id);
  if (!resolves)
    return {
      status: "invalid_model",
      diagnostics: Object.freeze([
        issue("OWNER_REFERENCE_NOT_FOUND", `${entityType} ${entityId} owner_id does not resolve.`, entityType, entityId, "owner_id", [id]),
      ]),
    };
  return {
    status: "compiled",
    value: ownerInScope(owner, scope) ? "in_scope" : "out_of_scope",
    diagnostics: Object.freeze([]),
  };
};

export interface AccountBalanceBehavior {
  readonly hasAuthoredBehavior: boolean;
}

export const inspectAccountBalanceBehavior = (
  model: PortableModelEnvelope,
  account: CanonicalObject,
): CompileResult<AccountBalanceBehavior> => {
  const preflight = preflightCanonicalCollections(model, [
    "Account",
    "Transaction",
    ...(account.return_model_id === undefined || account.return_model_id === null
      ? []
      : (["PrimitiveInstance"] as const)),
  ]);
  if (preflight.status !== "compiled") return preflight;
  const accountId = canonicalId(account, "account_id")!;
  const accounts = new Set(
    objects(model, "Account").map((value) => canonicalId(value, "account_id")!),
  );
  const transactions = new Map(
    objects(model, "Transaction").map((value) => [
      canonicalId(value, "transaction_id")!,
      value,
    ]),
  );
  if (account.transaction_ids === null)
    return {
      status: "unsupported",
      diagnostics: Object.freeze([
        capability(
          "TRANSACTION_HISTORY_COMPLETENESS_UNKNOWN",
          `Account ${accountId} transaction_ids is null, so opening-balance authority cannot be proven.`,
          "opening_balance",
          "Account",
          accountId,
          "transaction_ids",
        ),
      ]),
    };
  if (
    account.transaction_ids !== undefined &&
    !Array.isArray(account.transaction_ids)
  )
    return {
      status: "invalid_model",
      diagnostics: Object.freeze([
        issue(
          "TRANSACTION_REFERENCES_INVALID",
          `Account ${accountId} transaction_ids must be an array.`,
          "Account",
          accountId,
          "transaction_ids",
        ),
      ]),
    };
  const listed = new Set<string>();
  for (const raw of (account.transaction_ids ?? []) as readonly JsonValue[]) {
    if (typeof raw !== "string" || !UUID.test(raw))
      return {
        status: "invalid_model",
        diagnostics: Object.freeze([
          issue(
            "TRANSACTION_REFERENCE_INVALID",
            `Account ${accountId} has a malformed transaction reference.`,
            "Account",
            accountId,
            "transaction_ids",
          ),
        ]),
      };
    const id = raw.toLowerCase();
    if (!transactions.has(id))
      return {
        status: "invalid_model",
        diagnostics: Object.freeze([
          issue(
            "TRANSACTION_REFERENCE_NOT_FOUND",
            `Account ${accountId} transaction ${id} does not resolve.`,
            "Account",
            accountId,
            "transaction_ids",
            [id],
          ),
        ]),
      };
    if (listed.has(id))
      return {
        status: "invalid_model",
        diagnostics: Object.freeze([
          issue(
            "DUPLICATE_TRANSACTION_REFERENCE",
            `Account ${accountId} lists transaction ${id} more than once.`,
            "Account",
            accountId,
            "transaction_ids",
            [id],
          ),
        ]),
      };
    listed.add(id);
  }
  let affecting = listed.size > 0;
  for (const [transactionId, transaction] of transactions) {
    for (const field of [
      "source_account_id",
      "destination_account_id",
    ] as const) {
      const raw = transaction[field];
      if (raw === undefined || raw === null || raw === "") continue;
      if (typeof raw !== "string" || !UUID.test(raw))
        return {
          status: "invalid_model",
          diagnostics: Object.freeze([
            issue(
              "TRANSACTION_ACCOUNT_REFERENCE_INVALID",
              `Transaction ${transactionId} ${field} must be a UUID.`,
              "Transaction",
              transactionId,
              field,
            ),
          ]),
        };
      const normalized = raw.toLowerCase();
      if (!accounts.has(normalized))
        return {
          status: "invalid_model",
          diagnostics: Object.freeze([
            issue(
              "TRANSACTION_ACCOUNT_REFERENCE_NOT_FOUND",
              `Transaction ${transactionId} ${field} does not resolve.`,
              "Transaction",
              transactionId,
              field,
              [normalized],
            ),
          ]),
        };
      if (normalized === accountId) affecting = true;
    }
  }
  const returnModel = account.return_model_id;
  if (returnModel !== undefined && returnModel !== null) {
    if (typeof returnModel !== "string" || !UUID.test(returnModel))
      return {
        status: "invalid_model",
        diagnostics: Object.freeze([
          issue(
            "RETURN_MODEL_REFERENCE_INVALID",
            `Account ${accountId} return_model_id must be a UUID.`,
            "Account",
            accountId,
            "return_model_id",
          ),
        ]),
      };
    const normalized = returnModel.toLowerCase();
    if (
      !objects(model, "PrimitiveInstance").some(
        (primitive) =>
          canonicalId(primitive, "primitive_instance_id") === normalized,
      )
    )
      return {
        status: "invalid_model",
        diagnostics: Object.freeze([
          issue(
            "RETURN_MODEL_REFERENCE_NOT_FOUND",
            `Account ${accountId} return_model_id does not resolve.`,
            "Account",
            accountId,
            "return_model_id",
            [normalized],
          ),
        ]),
      };
    affecting = true;
  }
  return {
    status: "compiled",
    value: Object.freeze({ hasAuthoredBehavior: affecting }),
    diagnostics: Object.freeze([]),
  };
};

export const monthlyOccurrences = (
  anchor: Instant,
  end: Instant | undefined,
  horizonStart: Instant,
  horizonEnd: Instant,
): readonly Instant[] =>
  utcMonthlyOccurrences(
    anchor,
    { start: horizonStart, end: horizonEnd },
    "skip",
  ).filter((at) => end === undefined || at < end);
