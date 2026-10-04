import { PERSONAL_OBJECT_TYPES, type JsonObject, type PersonalDraft, type PersonalObjectType } from "../src/application/personalMvp.js";

export const objectEntries = (draft: PersonalDraft, type: PersonalObjectType): readonly JsonObject[] =>
  (draft.objects[type] ?? []).filter((value): value is JsonObject =>
    typeof value === "object" && value !== null && !Array.isArray(value)) as readonly JsonObject[];
export const objectId = (type: PersonalObjectType, value: JsonObject) => String(value[`${type.toLowerCase()}_id`]);
/** Mirrors the supported payment-account choices for display/authoring only. */
export const isCashFlowPaymentAccount = (account: JsonObject): boolean =>
  ["checking", "savings", "cash"].includes(String(account.account_type));
export function forecastDiagnosticMessage(diagnostic: {
  code?: string; message?: string; entityId?: string; relatedIds?: readonly string[];
}, draft?: PersonalDraft): string {
  const label = (ref: string, id: unknown, fallback: string) => {
    const resolved = draft && id ? referenceLabel(draft, ref, id) : "Unavailable reference";
    return resolved && resolved !== "Unavailable reference" ? resolved : fallback;
  };
  switch (diagnostic.code) {
    case "PAYMENT_ACCOUNT_TYPE_UNSUPPORTED":
      return `${label("Expense", diagnostic.entityId, "This spending item")} uses ${label("Account", diagnostic.relatedIds?.[0], "a non-cash account")} for funding. Under Money → Spending, choose a checking, savings, or cash funding account. Retirement and brokerage accounts cannot pay spending in this forecast.`;
    case "INVESTMENT_EXPECTED_RETURN_UNSUPPORTED":
      return `${label("Investment", diagnostic.entityId, "This investment")} has a stored direct Expected return that the deterministic forecast cannot use. Under Net Worth → Investments → Expert model details, clear the stored Expected return to remove this blocker. For supported return changes, review its existing linked return assumption under Plan → Assumptions, or use Plan → What If? → Change investment returns.`;
    case "INVESTMENT_STOCHASTIC_RETURN_UNSUPPORTED":
      return `${label("Investment", diagnostic.entityId, "This investment")} has stored Volatility. Volatility belongs to future probabilistic forecasting and is not supported in this deterministic forecast. Under Net Worth → Investments → Expert model details, clear the stored Volatility to remove this blocker.`;
    default:
      return friendlyText(diagnostic.message);
  }
}
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Display-only sanitization; original diagnostic text remains in technical disclosure. */
export const friendlyText = (value: unknown): string => String(value ?? "").replace(UUID, "unavailable reference");
export function objectLabel(type: PersonalObjectType, item: JsonObject): string {
  const candidate = type === "Person" ? [item.first_name, item.last_name].filter(Boolean).join(" ")
    : item.name ?? item.source ?? item.category ?? item.symbol;
  return candidate ? friendlyText(candidate) : `Unnamed ${type.toLowerCase()}`;
}
export const referenceTargets = (ref: string): PersonalObjectType[] =>
  ref.split("|").filter((target): target is PersonalObjectType => PERSONAL_OBJECT_TYPES.includes(target as PersonalObjectType));
const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export function referenceLabel(draft: PersonalDraft, ref: string, value: unknown): string {
  if (Array.isArray(value)) return value.map((id) => referenceLabel(draft, ref, id)).join(", ") || "Not set";
  if (!value) return "Not set";
  for (const type of referenceTargets(ref)) {
    const item = objectEntries(draft, type).find((entry) => objectId(type, entry) === String(value));
    if (item) return objectLabel(type, item);
  }
  if (ref.split("|").includes("Event")) {
    const event = (draft.objects.Event ?? []).find((entry): entry is JsonObject =>
      isJsonObject(entry) && String(entry.event_id) === String(value));
    if (event) return friendlyText(event.name ?? "Unnamed event");
  }
  return "Unavailable reference";
}

/** Preserve every supplied decimal digit; this does not round or calculate money. */
export function formatExactMoney(value: unknown, currency: unknown): string {
  const exact = String(value ?? "");
  if (!/^-?\d+(\.\d+)?$/.test(exact)) return "Amount unavailable";
  const [whole = "", fraction] = exact.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction === undefined ? "" : `.${fraction}`} ${String(currency ?? "currency not specified")}`;
}
export function formatRate(value: unknown): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value ?? ""));
  if (!match) return "Rate unavailable";
  const digits = (match[3] ?? "").padEnd(2, "0");
  const whole = (match[2] + digits.slice(0, 2)).replace(/^0+(?=\d)/, "");
  const fraction = digits.slice(2).replace(/0+$/, "");
  return `${match[1]}${whole}${fraction ? `.${fraction}` : ""}%`;
}
export function entitySummary(type: PersonalObjectType, item: JsonObject, draft: PersonalDraft, currency?: string): string {
  const owner = item.owner_id ? referenceLabel(draft, "Person|Household", item.owner_id) : "";
  const money = (field: string) => item[field] === undefined ? "" : formatExactMoney(item[field], item.currency ?? currency);
  const parts: Record<PersonalObjectType, unknown[]> = {
    Household: [item.household_type, item.primary_jurisdiction],
    Person: [referenceLabel(draft, "Household", item.household_id), item.residence_jurisdiction],
    Account: [item.account_type, money("opening_balance"), owner],
    Income: [money("amount"), item.frequency, owner],
    Expense: [money("amount"), item.frequency, referenceLabel(draft, "Account", item.payment_account_id)],
    Asset: [item.asset_type, money("acquisition_cost"), owner],
    Liability: [item.liability_type, money("current_balance"), owner],
    Investment: [item.investment_type, referenceLabel(draft, "Account", item.account_id), item.quantity ? `${item.quantity} units` : ""],
    Assumption: [item.value, item.unit, item.category],
    Scenario: [item.start_date, item.end_date, item.enabled ? "Enabled" : "Disabled"],
  };
  return parts[type].filter(Boolean).map((part) => friendlyText(part).replaceAll("_", " ")).join(" · ") || "Needs details";
}
