import { PERSONAL_OBJECT_TYPES, getPersonalEditorMetadata, type JsonObject, type PersonalDraft, type PersonalObjectType } from "../src/application/personalMvp.js";
import { isHouseholdCashAccount } from "../src/application/personalMvp.js";

export const objectEntries = (draft: PersonalDraft, type: PersonalObjectType): readonly JsonObject[] =>
  (draft.objects[type] ?? []).filter((value): value is JsonObject =>
    typeof value === "object" && value !== null && !Array.isArray(value)) as readonly JsonObject[];
export const objectId = (type: PersonalObjectType, value: JsonObject) => String(value[`${type.toLowerCase()}_id`]);
/** Mirrors the supported payment-account choices for display/authoring only. */
export const isCashFlowPaymentAccount = (account: JsonObject): boolean =>
  isHouseholdCashAccount(account.account_type);
export type NetWorthSection = "Cash & bank accounts" | "Investments & retirement" | "Property & other assets";
export function belongsToNetWorthSection(draft: PersonalDraft, type: PersonalObjectType, item: JsonObject, section?: NetWorthSection): boolean {
  if (!section) return true;
  if (type === "Account") return section === "Cash & bank accounts" ? isCashFlowPaymentAccount(item) : !isCashFlowPaymentAccount(item);
  if (type === "Asset") return !["cash", "investment"].includes(String(item.asset_type)) && !item.account_id &&
    !objectEntries(draft, "Investment").some((investment) => investment.asset_id === item.asset_id);
  return true;
}
/** Recognize the existing deterministic return contract; never create model links. */
export function linkedReturnAssumption(draft: PersonalDraft, investment: JsonObject, selectedScenarioId?: string): JsonObject | undefined {
  const roots = objectEntries(draft, "Scenario").filter((scenario) => scenario.enabled === true && !scenario.parent_scenario_id);
  const scenarioId = selectedScenarioId ?? (roots.length === 1 ? objectId("Scenario", roots[0]!) : undefined);
  const scenario = objectEntries(draft, "Scenario").find((item) => objectId("Scenario", item) === scenarioId);
  const primitive = (draft.objects.PrimitiveInstance ?? []).filter(isJsonObject).find((item) => item.primitive_instance_id === investment.return_model_id);
  if (!primitive || primitive.enabled !== true || primitive.primitive_id !== "P23" || primitive.scenario_id !== scenarioId ||
    primitive.start_date != null || primitive.end_date != null || !isJsonObject(primitive.parameters) || Object.keys(primitive.parameters).length !== 0 ||
    !isJsonObject(primitive.input_bindings) || Object.keys(primitive.input_bindings).length !== 1) return undefined;
  const assumption = objectEntries(draft, "Assumption").find((item) => item.assumption_id === (primitive.input_bindings as JsonObject).rate);
  if (!assumption || assumption.scenario_id !== scenarioId || !Array.isArray(scenario?.assumption_ids) || !scenario.assumption_ids.includes(String(assumption.assumption_id)) ||
    assumption.category !== "market_return" || assumption.unit !== "effective annual rate" || assumption.start_date != null || assumption.end_date != null ||
    assumption.distribution_type != null || assumption.distribution_parameters != null || assumption.correlation_group != null) return undefined;
  return assumption;
}
export function forecastDiagnosticMessage(diagnostic: {
  code?: string; message?: string; entityType?: string; entityId?: string; fieldPath?: string; relatedIds?: readonly string[];
}, draft?: PersonalDraft): string {
  const label = (ref: string, id: unknown, fallback: string) => {
    const resolved = draft && id ? referenceLabel(draft, ref, id) : "Unavailable reference";
    return resolved && resolved !== "Unavailable reference" ? resolved : fallback;
  };
  switch (diagnostic.code) {
    case "PAYMENT_ACCOUNT_TYPE_UNSUPPORTED":
      return `${label("Expense", diagnostic.entityId, "This spending item")} uses ${label("Account", diagnostic.relatedIds?.[0], "a non-cash account")} for funding. Under Money → Spending, choose a checking, savings, or cash funding account. Retirement and brokerage accounts cannot pay spending in this forecast.`;
    case "INVESTMENT_EXPECTED_RETURN_UNSUPPORTED":
      return `${label("Investment", diagnostic.entityId, "This investment")} has a stored direct Expected return that the deterministic forecast cannot use. Under Net Worth → Investments & retirement → Expert model details, clear the stored Expected return to remove this blocker. For supported return changes, use Projected annual return on its investment card, or Plan → What If? → Change investment returns.`;
    case "INVESTMENT_STOCHASTIC_RETURN_UNSUPPORTED":
      return `${label("Investment", diagnostic.entityId, "This investment")} has stored Volatility. Volatility belongs to future probabilistic forecasting and is not supported in this deterministic forecast. Under Net Worth → Investments & retirement → Expert model details, clear the stored Volatility to remove this blocker.`;
    case "MONTHLY_FLOW_EVENT_SEMANTICS_UNSUPPORTED":
      return "The current monthly summary cannot interpret this linked event or probability behavior. Supported future scheduled retirement events preserve current income; other event behavior requires a separate financial capability. Keep the recorded relationship intact.";
    case "RETIREMENT_BINDING_MISMATCH": {
      const event = draft?.objects.Event?.filter(isJsonObject).find((item) => item.event_id === diagnostic.entityId);
      return `${label("Event", diagnostic.entityId, "The retirement plan")} does not match the selected plan’s retirement date${event?.start_date ? ` (${String(event.start_date)})` : ""}. Under Plan → What If? → Retire earlier/later, choose the income and retirement plan belonging to the current plan, then enter the new date. For imported plans, review Plan → Current Plan → Expert forecast configuration → Baseline canonical retirement event and Baseline retirement date; the date must match the selected event. Event enablement and plan membership cannot be repaired in this editor; an invalid imported relationship needs a corrected model.`;
    }
    case "PAYMENT_ACCOUNT_REQUIRED":
    case "PAYMENT_ACCOUNT_REFERENCE_NOT_FOUND":
      return "A spending item has no usable funding account. Under Money → Spending, open the item and choose Funding account. Create a checking, savings, or cash account under Money → Accounts first if none is available.";
    case "RETIREMENT_BINDING_UNAVAILABLE":
    case "RETIREMENT_BINDING_AMBIGUOUS":
      return "The retirement comparison needs one supported income and retirement plan relationship. Under Plan → What If? → Retire earlier/later, select the intended plan. If none is listed, configure the existing relationship under Plan → Current Plan → Expert forecast configuration; this editor cannot create retirement events.";
    case "ASSUMPTION_VALUE_INVALID":
    case "EXACT_DECIMAL_INVALID":
      return "A forecast input is not a valid exact decimal. Under Plan → Assumptions, review Value for return or growth assumptions (0.08 means 8% effective annual rate). For amounts, review the named item under Money or Net Worth and enter a decimal amount without currency symbols or commas. Original input details are below.";
    case "FORECAST_HORIZON_INVALID":
    case "FORECAST_HORIZON_MONTHLY_INVALID":
    case "FORECAST_MONTHS_MISMATCH":
      return "The forecast dates do not form a supported monthly horizon. Under Settings → Model Settings, choose a Simulation start on the first day of a month and a later Simulation end on the first day of a month.";
    case "RETIREMENT_DATE_INVALID":
      return "The new retirement date is invalid. Under Plan → What If? → Retire earlier/later, enter a valid New retirement date.";
    case "SCENARIO_RATE_INVALID":
    case "SCENARIO_ASSUMPTION_VALUE_INVALID":
      return "The comparison rate is not a valid exact decimal. Under Plan → What If?, review Exact effective annual rate before comparing income, spending, or investment returns. Enter a decimal such as 0.08 = 8%; the baseline plan stays unchanged.";
    case "SCENARIO_FUNDING_POLICY_INCOMPLETE":
    case "SCENARIO_FUNDING_POLICY_INVALID":
      return "The comparison needs a complete ordered funding choice. Under Plan → What If? → Change funding behavior, choose the spending or loan target and add compatible funding accounts in the intended order. Each account must appear only once.";
    case "SCENARIO_TARGET_UNEXECUTABLE":
      return "The selected item cannot execute in the current comparison. Under Plan → What If?, choose a target belonging to the configured household and forecast scope. Review Plan → Current Plan → Expert forecast configuration for the execution account, owner, and debt contract setup; imported unsupported relationships require a corrected model.";
    case "EXECUTION_OWNER_INVALID":
    case "EXECUTION_OWNER_NOT_HOUSEHOLD_MEMBER":
      return "The forecast needs an owner who belongs to the household. Under Plan → Current Plan → Expert forecast configuration → Investment execution configuration, choose Execution owner for investments. For debt, choose Execution owner under Net Worth → Debt → Debt execution configuration, then Apply household execution configuration in Current Plan.";
    case "INVESTMENT_PRICE_REQUIRED":
    case "INVESTMENT_PURCHASE_PRICE_UNSUPPORTED":
      return `${label("Investment", diagnostic.entityId, "This investment")} needs an opening price to value its units. Under Net Worth → Investments & retirement, open the holding and enter Price in money per unit. A purchase needs a positive price; do not invent an observed price merely to run the forecast.`;
    case "INVESTMENT_MARKET_VALUE_INCONSISTENT":
      return `${label("Investment", diagnostic.entityId, "This investment")} has a market value that does not match its recorded quantity and price. Under Net Worth → Investments & retirement, open the holding and reconcile Quantity, Price, and Market value using your source records. The forecast will not approximate inconsistent opening positions.`;
    case "MONTHLY_FLOW_RECURRENCE_UNSUPPORTED":
    case "RECURRENCE_UNSUPPORTED":
      return `${label(diagnostic.entityType ?? "Income|Expense", diagnostic.entityId, "This income or spending item")} has a schedule this monthly forecast cannot execute. Under Money → Income or Money → Spending, review Frequency. If the actual schedule is monthly, choose monthly; other schedules currently require a separate financial capability. Do not change a recorded schedule merely to remove the warning.`;
    case "LIABILITY_PAYMENT_FREQUENCY_UNSUPPORTED":
      return `${label("Liability", diagnostic.entityId, "This debt")} has a payment schedule the fixed monthly debt forecast cannot execute. Under Net Worth → Debt, open the debt and review payment frequency. Choose monthly only if that is the actual contract; other payment schedules are unsupported.`;
    case "LIABILITY_EXECUTION_PROFILE_REQUIRED":
      return `${label("Liability", diagnostic.entityId, "This debt")} needs its contractual payment setup. Under Net Worth → Debt → Debt execution configuration, choose Execution owner and enter the debt’s Payment anchor, Total payment count, Funding account, and Settlement priority. Under Plan → Current Plan → Expert forecast configuration, use Apply household execution configuration. Only the supported fixed monthly mortgage contract can execute.`;
    case "INVESTMENT_RETURN_MODEL_UNSUPPORTED":
    case "INVESTMENT_RETURN_BINDING_UNSUPPORTED":
    case "INVESTMENT_RETURN_ASSUMPTION_UNSUPPORTED":
    case "ASSUMPTION_REFERENCE_NOT_FOUND":
    case "ASSUMPTION_SCENARIO_BINDING_INVALID":
      return "The investment return or income growth relationship is missing or cannot execute in the current plan. Review the linked assumption under Plan → Assumptions. Creating or reconnecting executable model relationships is not supported by this editor; import a model with an existing supported deterministic relationship. Changing a displayed direct return cannot repair it.";
    default: {
      const type = diagnostic.entityType as PersonalObjectType;
      const fieldName = diagnostic.fieldPath ?? "";
      const metadata = getPersonalEditorMetadata() as Record<string, { fields: Record<string, { mutable: boolean; derived: boolean; type: string; ref?: string }> }>;
      const field = metadata[type]?.fields[fieldName];
      const location: Partial<Record<PersonalObjectType, string>> = { Income: "Money → Income", Expense: "Money → Spending", Account: "Money → Accounts", Investment: "Net Worth → Investments & retirement", Asset: "Net Worth → Property & other assets", Liability: "Net Worth → Debt", Assumption: "Plan → Assumptions", Scenario: "Plan → What If?", Person: "Settings → Household & People", Household: "Settings → Household & People" };
      const editable = field && field.mutable && !field.derived && field.type !== "object" && (!field.ref || referenceTargets(field.ref).length > 0);
      if (!diagnostic.code?.includes("UNSUPPORTED") && editable && location[type]) {
        const fieldLabel = ({ payment_account_id: "Funding account", owner_id: "Owner", account_id: "Account", amount: "Amount", value: "Value", frequency: "Frequency", current_balance: "Balance", quantity: "Quantity", price: "Price", market_value: "Market value", interest_rate: "Interest rate" } as Record<string, string>)[fieldName] ?? fieldName.replaceAll("_", " ");
        return `${label(type, diagnostic.entityId, "This item")} has an invalid ${fieldLabel}. Under ${location[type]}, open the item and review ${fieldLabel} in its common, Additional financial details, or Expert model details fields. ${field.ref ? "Choose an existing compatible record; add one in its editor first if none is available." : "Use a valid value in the displayed units; decimal values must contain no currency symbols or commas."}`;
      }
      if (!diagnostic.code?.includes("UNSUPPORTED") && field && !field.mutable && location[type])
        return `${label(type, diagnostic.entityId, "This item")} has an invalid creation-time fact. Under ${location[type]}, review the read-only facts. They cannot be overwritten in this editor; import a corrected model rather than treating this as an editable forecast setting.`;
      const capability = diagnostic.code?.startsWith("RETIREMENT") || diagnostic.code?.startsWith("EVENT") ? "retirement or life-event behavior"
        : diagnostic.code?.includes("GROWTH") || diagnostic.code?.startsWith("ASSUMPTION") ? "growth assumptions"
        : diagnostic.code?.startsWith("INVESTMENT") ? "investment execution"
        : diagnostic.code?.startsWith("ASSET") ? "property valuation or account overlap"
        : diagnostic.code?.startsWith("FX") || diagnostic.code?.includes("CURRENCY") ? "currency conversion"
        : diagnostic.code?.startsWith("LIABILITY") || diagnostic.code?.startsWith("MORTGAGE") ? "debt execution"
        : diagnostic.code?.startsWith("MONTHLY") || diagnostic.code?.startsWith("RECURRENCE") ? "monthly income or spending schedules"
        : "the recorded financial relationships";
      return `The current deterministic forecast cannot use this plan’s ${capability}. There is no supported editor repair for this relationship or capability. Preserve the recorded data; a corrected supported model or a financial calculation change is required. The forecast remains unavailable, with the affected records and original explanation in Technical diagnostic details.`;
    }
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
