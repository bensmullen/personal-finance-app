import type { JsonValue, PortableModelEnvelope } from "../../model/modelVersion.js";
import { domainId } from "../../identity/index.js";
import { createAuthoritativeState, type AccountKind, type AuthoritativeState } from "../../state/index.js";
import { Currency, decimal, money, Quantity, RoundingPolicy, SHARE } from "../../values/index.js";
import { instant, utcMonthlyOccurrences } from "../../time/index.js";
import { createDomainMechanicsParticipant, type DomainHolding, type DomainLot, type DomainMechanicsInput, type DomainOperation, type DomainOperationKind } from "../../simulation/domainMechanics.js";
import type { HouseholdKernelParticipant } from "../../simulation/householdExecution.js";
import { canonicalId, capability, EXACT_DECIMAL, objects, preflightCanonicalCollections, resolveHouseholdScope, UUID, utcDate, type CanonicalObject } from "./shared.js";
import { selectScenario } from "./scenarioSelection.js";
import type { CompileResult } from "./types.js";

const ADAPTER = "d1-domain-operation/v1";
const record = (value: unknown): value is Readonly<Record<string, JsonValue>> => typeof value === "object" && value !== null && !Array.isArray(value);
const required = (value: unknown, message: string): string => {
  if (typeof value !== "string" || !value.length) throw new Error(message); return value;
};
const exact = (value: unknown, message: string): string => {
  const result = required(value, message); if (!EXACT_DECIMAL.test(result) || decimal(result).isNegative()) throw new Error(message); return result;
};
const date = (value: unknown, message: string): string => {
  const result = required(value, message); if (!utcDate(result)) throw new Error(message); return result;
};
export interface DomainCompilerRequest { readonly baseCurrency: string; readonly asOf: string; readonly simulationStart: string; readonly simulationEnd: string; readonly executionOwnerId: string; readonly scenarioId?: string }
export interface CompiledDomainMechanics { readonly openingState: AuthoritativeState; readonly input: DomainMechanicsInput; readonly participant: HouseholdKernelParticipant }
const accountKinds: Readonly<Record<string, AccountKind>> = { checking: "checking", savings: "savings", cash: "cash", taxable_brokerage: "brokerage", traditional_401k: "retirement", roth_401k: "retirement", traditional_ira: "retirement", roth_ira: "retirement", "403b": "retirement", "457b": "retirement" };
const kinds: readonly DomainOperationKind[] = ["purchase", "sale", "ordinary_dividend", "qualified_dividend", "interest", "reinvest_dividend", "call_exercise", "conversion", "direct_rollover", "mixed_rollover", "indirect_distribution", "indirect_deposit"];
const subtypeKinds = new Set(["treasury_bill", "treasury_note", "treasury_bond", "cd", "long_equity_call"]);
export const hasDomainMechanics = (model: PortableModelEnvelope): boolean =>
  objects(model, "PrimitiveInstance").some(item => record(item.parameters) && item.parameters.adapter === ADAPTER && item.enabled === true) ||
  objects(model, "Account").some(item => item.interest_rate != null) || objects(model, "Investment").some(item => item.instrument_subtype != null) || objects(model, "Insurance").length > 0;

/** One event/effect/primitive is one economic operation, including a linked rollover deposit. */
export interface AuthoredDomainOperation {
  readonly eventId: string; readonly effectId: string; readonly primitiveId: string; readonly name: string; readonly date: string;
  readonly kind: DomainOperationKind; readonly amount: string; readonly order: number;
  readonly holdingId?: string; readonly destinationHoldingId?: string; readonly rothHoldingId?: string;
  readonly cashAccountId?: string; readonly sourceAccountId?: string; readonly quantity?: string;
  readonly linkedOperationId?: string; readonly replacementAmount?: string; readonly lotIds?: readonly string[];
  readonly eligibility?: "eligible_owned_direct" | "eligible_owned_participant"; readonly destinationAcceptance?: boolean;
}
export const authorDomainOperation = (model: PortableModelEnvelope, plan: AuthoredDomainOperation): PortableModelEnvelope => {
  for (const id of [plan.eventId, plan.effectId, plan.primitiveId]) if (!UUID.test(id)) throw new Error("DOMAIN_OPERATION_ID_INVALID");
  if (!kinds.includes(plan.kind) || !utcDate(plan.date) || !Number.isSafeInteger(plan.order) || plan.order < 0 || !EXACT_DECIMAL.test(plan.amount)) throw new Error("DOMAIN_OPERATION_INPUT_INVALID");
  const roots = objects(model, "Scenario").filter(item => item.enabled === true && item.base_scenario_id == null);
  if (roots.length !== 1) throw new Error("DOMAIN_ROOT_REQUIRED");
  const priorEvent = objects(model, "Event").find(item => item.event_id === plan.eventId);
  if (priorEvent && (!Array.isArray(priorEvent.effect_ids) || priorEvent.effect_ids.length !== 1 || priorEvent.effect_ids[0] !== plan.effectId)) throw new Error("DOMAIN_OPERATION_ID_COLLISION");
  for (const [collection, idField, id] of [["EventEffect", "event_effect_id", plan.effectId], ["PrimitiveInstance", "primitive_instance_id", plan.primitiveId]] as const) {
    if (!priorEvent && objects(model, collection).some(item => item[idField] === id)) throw new Error("DOMAIN_OPERATION_ID_COLLISION");
  }
  const parameters: Record<string, JsonValue> = { adapter: ADAPTER, kind: plan.kind, amount: plan.amount, order: plan.order };
  for (const [key, value] of Object.entries(plan)) if (!["eventId", "effectId", "primitiveId", "date", "name"].includes(key) && value !== undefined) parameters[key] = value as JsonValue;
  const event: Record<string, JsonValue> = { event_id: plan.eventId, name: plan.name, event_type: "other", start_date: plan.date, trigger_type: "scheduled", effect_ids: [plan.effectId], dependencies: [], precedence: plan.order, scenario_id: String(roots[0]!.scenario_id), enabled: true };
  const effect: Record<string, JsonValue> = { event_effect_id: plan.effectId, target_entity_type: plan.holdingId ? "Investment" : "Account", target_entity_id: plan.holdingId ?? plan.cashAccountId ?? plan.destinationHoldingId ?? plan.eventId, operation: "d1_domain", primitive_instance_id: plan.primitiveId };
  const primitive: Record<string, JsonValue> = { primitive_instance_id: plan.primitiveId, primitive_id: "P27", enabled: true, scenario_id: String(roots[0]!.scenario_id), input_bindings: {}, parameters };
  const replace = (collection: string, field: string, item: CanonicalObject) => [...objects(model, collection).filter(old => old[field] !== item[field]), item];
  return { ...model, objects: { ...model.objects, Event: replace("Event", "event_id", event), EventEffect: replace("EventEffect", "event_effect_id", effect), PrimitiveInstance: replace("PrimitiveInstance", "primitive_instance_id", primitive),
    Scenario: objects(model, "Scenario").map(item => item === roots[0] ? { ...item, event_ids: [...new Set([...(Array.isArray(item.event_ids) ? item.event_ids : []), plan.eventId])] } : item) } };
};

export const compileDomainMechanics = (model: PortableModelEnvelope, request: DomainCompilerRequest): CompileResult<CompiledDomainMechanics> => {
  const preflight = preflightCanonicalCollections(model, ["Account", "Investment", "Insurance", "Event", "EventEffect", "PrimitiveInstance"]);
  if (preflight.status !== "compiled") return preflight;
  const selected = selectScenario(model, { scenarioId: request.scenarioId, simulationStart: request.simulationStart, simulationEnd: request.simulationEnd });
  if (selected.status !== "compiled") return selected;
  const scope = resolveHouseholdScope(model); if (scope.status !== "compiled") return scope;
  try {
    if (request.baseCurrency !== "USD") throw new Error("D1-B tax character execution currently requires USD.");
    if (request.asOf !== request.simulationStart) throw new Error("D1-B opening economics must be established at the forecast start.");
    const currency = Currency.of(request.baseCurrency), start = utcDate(request.simulationStart)!, end = utcDate(request.simulationEnd)!;
    if (!start || !end || start >= end || !scope.value.memberIds.includes(request.executionOwnerId)) throw new Error("Choose a household-member execution owner and a valid increasing forecast horizon.");
    const accounts = new Map(objects(model, "Account").map(item => [String(item.account_id), item]));
    const investments = new Map(objects(model, "Investment").map(item => [String(item.investment_id), item]));
    const ownedAccounts = new Map([...accounts].filter(([, item]) => item.owner_id === request.executionOwnerId));
    const lookup = (id: unknown, map: ReadonlyMap<string, CanonicalObject>, label: string) => {
      const found = map.get(required(id, label)); if (!found) throw new Error(label); return found;
    };
    const bank = (id: unknown) => {
      const account = lookup(id, ownedAccounts, "Select a checking/savings account owned by the execution person.");
      if (!["checking", "savings"].includes(String(account.account_type))) throw new Error("Personally funded purchases and premiums require checking/savings.");
      return String(account.account_id);
    };
    const accountStates: AuthoritativeState["accounts"] = {};
    for (const [id, account] of ownedAccounts) {
      const kind = accountKinds[String(account.account_type)];
      if (!kind) continue;
      if (account.currency !== currency.code || date(account.opening_date, "Account opening date is required.") > request.simulationStart ||
        account.closing_date != null && date(account.closing_date, "Account closing date is invalid.") < request.simulationEnd) throw new Error("Participating accounts must use the forecast currency and be open throughout the horizon.");
      accountStates[id] = { id: domainId("account", id), ownerId: domainId("person", request.executionOwnerId), kind, cash: money(exact(account.opening_balance, "Exact opening wrapper/bank cash is required."), currency) };
    }
    const person = scope.value.peopleById.get(request.executionOwnerId)!;
    const residence = typeof person.tax_jurisdiction === "string" ? [person.tax_jurisdiction.replace(/^US-/, "US:")] : [];
    const taxFacts = { residenceJurisdictions: residence, workJurisdictions: [], eligibility: {} };
    const holdings: DomainHolding[] = [], operations: DomainOperation[] = [];
    const add = (operation: DomainOperation) => operations.push(operation);
    for (const [id, investment] of investments) {
      if (!ownedAccounts.has(String(investment.account_id))) continue;
      const kind = investment.instrument_subtype ?? investment.investment_type;
      if (!["equity", "fund", "crypto", ...subtypeKinds].includes(String(kind))) continue;
      if (investment.investment_type === "option" && kind !== "long_equity_call" || investment.investment_type === "bond" && !["treasury_bill", "treasury_note", "treasury_bond", "cd"].includes(String(kind))) throw new Error("Only admitted fixed-income products and long listed equity calls are supported.");
      const quantity = exact(investment.quantity, "Holding quantity must be explicit."), lots: DomainLot[] = [];
      if (Array.isArray(investment.tax_lots)) for (const lot of investment.tax_lots) {
        if (!record(lot)) throw new Error("Opening lots require identity, acquisition date, quantity and cost basis.");
        lots.push({ id: required(lot.id, "Lot identity is required."), acquired: date(lot.acquired, "Lot acquisition date is required."), quantity: exact(lot.quantity, "Lot quantity is required."), basis: exact(lot.basis, "Economic lot basis is required.") });
      }
      else if (investment.acquisition_date != null && investment.cost_basis != null && decimal(quantity).isPositive()) lots.push({ id: id + ":opening", acquired: date(investment.acquisition_date, "Acquisition date is required."), quantity, basis: exact(investment.cost_basis, "Economic basis is required.") });
      if (lots.length && (new Set(lots.map(lot => lot.id)).size !== lots.length || !lots.reduce((sum, lot) => sum.plus(decimal(lot.quantity)), decimal("0")).equals(decimal(quantity)))) throw new Error("Opening lot identities must be unique and quantities reconcile to the holding.");
      holdings.push({ id, accountId: String(investment.account_id), kind: kind as DomainHolding["kind"], lots,
        ...(investment.after_tax_basis == null ? {} : { afterTaxBasis: exact(investment.after_tax_basis, "Previously taxed retirement basis must be explicit.") }),
        ...(kind !== "long_equity_call" ? {} : { underlyingId: String(investment.underlying_investment_id), strike: exact(investment.strike_price, "Strike is required."), multiplier: exact(investment.contract_multiplier, "Multiplier is required."), expiration: date(investment.expiration_date, "Expiration is required.") }) });
      if (kind === "long_equity_call") {
        const underlying = lookup(investment.underlying_investment_id, investments, "Choose an underlying equity holding.");
        if (underlying.investment_type !== "equity" || underlying.account_id !== investment.account_id || ownedAccounts.get(String(investment.account_id))!.account_type !== "taxable_brokerage" ||
          !decimal(String(investment.contract_multiplier)).isPositive() || !decimal(quantity).fitsScale(0)) throw new Error("Options require whole long listed equity call contracts in a taxable brokerage wrapper.");
        const expiration = utcDate(investment.expiration_date)!;
        if (start <= expiration && expiration < end) add({ id: id + ":expiration", at: expiration, order: 999999, kind: "call_expiration", holdingId: id, amount: "0", taxFacts });
      }
    }
    const effects = new Map(objects(model, "EventEffect").map(item => [String(item.event_effect_id), item]));
    const primitives = new Map(objects(model, "PrimitiveInstance").map(item => [String(item.primitive_instance_id), item]));
    for (const event of objects(model, "Event")) {
      if (event.enabled !== true || event.scenario_id !== selected.value.id || !Array.isArray(event.effect_ids)) continue;
      const effect = event.effect_ids.length === 1 ? effects.get(String(event.effect_ids[0])) : undefined;
      if (!effect || effect.operation !== "d1_domain") continue;
      if (event.trigger_type !== "scheduled" || event.trigger_condition != null || event.probability_model_id != null || event.end_date != null || Array.isArray(event.dependencies) && event.dependencies.length) throw new Error("Domain operations require a single scheduled event.");
      const primitive = primitives.get(String(effect.primitive_instance_id)), terms = primitive?.parameters;
      if (!primitive || primitive.enabled !== true || primitive.scenario_id !== event.scenario_id || !record(terms) || terms.adapter !== ADAPTER || !kinds.includes(terms.kind as DomainOperationKind)) throw new Error("This operation is unsupported or has incomplete execution terms.");
      const at = utcDate(event.start_date)!; if (!at) throw new Error("Operation date is invalid.");
      if (at < start || at >= end) continue;
      const kind = terms.kind as DomainOperationKind, amount = exact(terms.amount, "Operation cash amount must be explicit."), order = terms.order;
      if (typeof order !== "number" || !Number.isSafeInteger(order) || order < 0) throw new Error("Supply a nonnegative operation priority.");
      const operation: DomainOperation = { id: String(event.event_id), at, order, kind, amount, taxFacts,
        ...Object.fromEntries(["holdingId", "destinationHoldingId", "rothHoldingId", "cashAccountId", "sourceAccountId", "quantity", "linkedOperationId", "replacementAmount", "lotIds"].filter(key => terms[key] != null).map(key => [key, terms[key]])) };
      if (["purchase", "call_exercise"].includes(kind)) bank(terms.cashAccountId);
      if (terms.sourceAccountId != null) bank(terms.sourceAccountId);
      if (kind.includes("rollover") || kind === "conversion" || kind === "indirect_distribution" || kind === "indirect_deposit") {
        if (terms.eligibility !== (kind === "indirect_distribution" || kind === "indirect_deposit" ? "eligible_owned_participant" : "eligible_owned_direct") || terms.destinationAcceptance !== true) throw new Error("Retirement operations require explicit eligibility and plan/destination acceptance; RMD, hardship, inherited, corrective and special distributions are unavailable.");
        const sourceInvestment = kind === "indirect_deposit" ? undefined : lookup(terms.holdingId, investments, "Choose the owned retirement source.");
        const source = sourceInvestment && lookup(sourceInvestment.account_id, ownedAccounts, "Retirement source ownership is required.");
        const destinationInvestment = kind === "indirect_distribution" ? undefined : lookup(terms.destinationHoldingId, investments, "Choose a compatible retirement destination.");
        const destination = destinationInvestment && lookup(destinationInvestment.account_id, ownedAccounts, "Destination ownership is required.");
        if (sourceInvestment && sourceInvestment.after_tax_basis == null) throw new Error("Enter actual previously taxed source basis, including explicit zero; prior-YTD contribution usage is not basis.");
        if (source && [...investments.values()].filter(item => item.account_id === source.account_id && decimal(String(item.quantity)).isPositive()).length !== 1 || source && !decimal(String(source.opening_balance)).isZero()) throw new Error("The admitted rollover source must have one eligible owned holding and no wrapper cash; multi-holding pro-rata allocation is unavailable.");
        const sourceType = String(source?.account_type), destinationType = String(destination?.account_type);
        const directCompatible = sourceType === "traditional_401k" && ["traditional_ira", "traditional_401k"].includes(destinationType) || sourceType === "roth_401k" && destinationType === "roth_ira" || sourceType === "traditional_ira" && destinationType === "traditional_ira";
        if (kind === "direct_rollover" && !directCompatible) throw new Error("Choose a supported direct rollover/trustee transfer with compatible pre-tax/Roth character.");
        if (kind === "conversion" && (sourceType !== "traditional_401k" || destinationType !== "roth_401k" || source!.institution == null || source!.institution !== destination!.institution)) throw new Error("In-plan conversion requires traditional and Roth 401(k) holdings in the same explicitly identified plan.");
        if (kind === "mixed_rollover") {
          const roth = lookup(lookup(terms.rothHoldingId, investments, "Choose the Roth IRA for the after-tax share.").account_id, ownedAccounts, "Roth destination ownership is required.");
          if (sourceType !== "traditional_401k" || destinationType !== "traditional_ira" || roth.account_type !== "roth_ira") throw new Error("Mixed rollover directs the pro-rata pre-tax share to Traditional IRA and after-tax share to Roth IRA.");
        }
        if (kind === "indirect_distribution" && sourceType !== "traditional_401k" || kind === "indirect_deposit" && destinationType !== "traditional_ira") throw new Error("The participant-received floor is an eligible traditional employer-plan distribution to Traditional IRA.");
        if (kind === "indirect_distribution") bank(terms.cashAccountId);
      } else if (operation.holdingId) {
        const holding = lookup(operation.holdingId, investments, "Choose an investment holding."), account = lookup(holding.account_id, ownedAccounts, "Holding owner is unavailable.");
        if (account.account_type !== "taxable_brokerage") throw new Error("Sales, investment purchases, dividends and options require a taxable brokerage wrapper.");
        if (["treasury_bill", "treasury_note", "treasury_bond", "cd"].includes(String(holding.instrument_subtype)) && kind !== "purchase") throw new Error("Fixed-income pre-maturity sales and manual distribution overrides are unavailable.");
        if (holding.investment_type === "option" && kind === "sale" && at.slice(0, 10) >= String(holding.expiration_date)) throw new Error("Close the call before expiration; use its lapse/exercise contract afterwards.");
      }
      add(operation);
    }
    const input: DomainMechanicsInput = { currency: currency.code, holdings, operations };
    return { status: "compiled", value: { input, openingState: createAuthoritativeState({ accounts: accountStates }), participant: createDomainMechanicsParticipant(input) }, diagnostics: [] };
  } catch (error) {
    return { status: "unsupported", diagnostics: [capability("D1B_DOMAIN_UNSUPPORTED", error instanceof Error ? error.message : "Domain terms are incomplete.", "domain_mechanics")] };
  }
};
