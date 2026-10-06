import type { JsonValue, PortableModelEnvelope } from "../../model/modelVersion.js";
import { domainId } from "../../identity/index.js";
import { createAuthoritativeState, type AccountKind, type AuthoritativeState } from "../../state/index.js";
import { Currency, decimal, money, Quantity, RoundingPolicy, SHARE } from "../../values/index.js";
import { instant, utcMonthlyOccurrences } from "../../time/index.js";
import { createDomainMechanicsParticipant, type DomainHolding, type DomainLot, type DomainMechanicsInput, type DomainOperation, type DomainOperationKind } from "../../simulation/domainMechanics.js";
import type { HouseholdKernelParticipant } from "../../simulation/householdExecution.js";
import { canonicalId, capability, EXACT_DECIMAL, objects, preflightCanonicalCollections, resolveHouseholdScope, UUID, utcDate, type CanonicalObject } from "./shared.js";
import { selectScenario } from "./scenarioSelection.js";
import { resolveTaxEligibility } from "../../simulation/tax/facts.js";
import type { TaxEligibilityPeriod } from "../../simulation/tax/contracts.js";
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
export const authorOpeningInvestmentLot = (model: PortableModelEnvelope, investmentId: string, lot: DomainLot): PortableModelEnvelope => {
  if (!UUID.test(lot.id) || !utcDate(lot.acquired) || !EXACT_DECIMAL.test(lot.quantity) || !decimal(lot.quantity).isPositive() || !EXACT_DECIMAL.test(lot.basis) || decimal(lot.basis).isNegative()) throw new Error("Enter a valid acquisition date, positive units and nonnegative exact lot basis.");
  const investment = objects(model, "Investment").find(item => item.investment_id === investmentId);
  if (!investment) throw new Error("Choose an investment for this opening lot.");
  const prior = Array.isArray(investment.tax_lots) ? investment.tax_lots : [];
  if (prior.some(item => record(item) && item.id === lot.id)) throw new Error("Opening lot identity already exists.");
  return { ...model, objects: { ...model.objects, Investment: objects(model, "Investment").map(item => item === investment ? { ...item, tax_lots: [...prior, { ...lot }] } : item) } };
};
const accountKinds: Readonly<Record<string, AccountKind>> = { checking: "checking", savings: "savings", cash: "cash", taxable_brokerage: "brokerage", traditional_401k: "retirement", roth_401k: "retirement", traditional_ira: "retirement", roth_ira: "retirement", "403b": "retirement", "457b": "retirement" };
const kinds: readonly DomainOperationKind[] = ["purchase", "sale", "ordinary_dividend", "qualified_dividend", "interest", "reinvest_dividend", "call_exercise", "conversion", "direct_rollover", "mixed_rollover", "indirect_distribution", "indirect_deposit"];
const subtypeKinds = new Set(["treasury_bill", "treasury_note", "treasury_bond", "cd", "long_equity_call"]);
export const hasDomainMechanics = (model: PortableModelEnvelope): boolean =>
  objects(model, "PrimitiveInstance").some(item => record(item.parameters) && item.parameters.adapter === ADAPTER && item.enabled === true) ||
  objects(model, "Account").some(item => item.interest_rate != null) || objects(model, "Investment").some(item => item.instrument_subtype != null || ["crypto", "option", "bond"].includes(String(item.investment_type))) || objects(model, "Insurance").length > 0;

/** One event/effect/primitive is one economic operation, including a linked rollover deposit. */
export interface AuthoredDomainOperation {
  readonly eventId: string; readonly effectId: string; readonly primitiveId: string; readonly name: string; readonly date: string;
  readonly kind: DomainOperationKind; readonly amount: string; readonly order: number;
  readonly holdingId?: string; readonly destinationHoldingId?: string; readonly rothHoldingId?: string;
  readonly cashAccountId?: string; readonly sourceAccountId?: string; readonly quantity?: string;
  readonly linkedOperationId?: string; readonly replacementAmount?: string; readonly lotIds?: readonly string[];
  readonly eligibility?: "eligible_owned_direct" | "eligible_owned_participant"; readonly destinationAcceptance?: boolean;
  readonly dividendCharacter?: "ordinary" | "qualified";
  readonly samePlanConfirmed?: boolean;
}
export const authorDomainOperation = (model: PortableModelEnvelope, plan: AuthoredDomainOperation): PortableModelEnvelope => {
  for (const id of [plan.eventId, plan.effectId, plan.primitiveId]) if (!UUID.test(id)) throw new Error("DOMAIN_OPERATION_ID_INVALID");
  if (!kinds.includes(plan.kind) || !utcDate(plan.date) || !Number.isSafeInteger(plan.order) || plan.order < 0 || !EXACT_DECIMAL.test(plan.amount) || decimal(plan.amount).isNegative()) throw new Error("Choose a supported operation, valid date, nonnegative priority and exact nonnegative cash amount.");
  const roots = objects(model, "Scenario").filter(item => item.enabled === true && item.base_scenario_id == null);
  if (roots.length !== 1) throw new Error("Choose one enabled root plan before adding a domain operation.");
  const priorEvent = objects(model, "Event").find(item => item.event_id === plan.eventId);
  if (priorEvent && (!Array.isArray(priorEvent.effect_ids) || priorEvent.effect_ids.length !== 1 || priorEvent.effect_ids[0] !== plan.effectId)) throw new Error("DOMAIN_OPERATION_ID_COLLISION");
  for (const [collection, idField, id] of [["EventEffect", "event_effect_id", plan.effectId], ["PrimitiveInstance", "primitive_instance_id", plan.primitiveId]] as const) {
    if (!priorEvent && objects(model, collection).some(item => item[idField] === id)) throw new Error("DOMAIN_OPERATION_ID_COLLISION");
  }
  const parameters: Record<string, JsonValue> = { adapter: ADAPTER, kind: plan.kind, amount: plan.amount, order: plan.order };
  for (const [key, value] of Object.entries(plan)) if (!["eventId", "effectId", "primitiveId", "date", "name"].includes(key) && value !== undefined) parameters[key] = value as JsonValue;
  const event: Record<string, JsonValue> = { event_id: plan.eventId, name: plan.name, event_type: "other", start_date: plan.date, trigger_type: "scheduled", effect_ids: [plan.effectId], dependencies: [], precedence: plan.order, scenario_id: String(roots[0]!.scenario_id), enabled: true };
  const effect: Record<string, JsonValue> = { event_effect_id: plan.effectId, target_entity_type: plan.holdingId || plan.destinationHoldingId ? "Investment" : "Account", target_entity_id: plan.holdingId ?? plan.destinationHoldingId ?? plan.cashAccountId ?? plan.eventId, operation: "d1_domain", primitive_instance_id: plan.primitiveId };
  const primitive: Record<string, JsonValue> = { primitive_instance_id: plan.primitiveId, primitive_id: "P27", enabled: true, scenario_id: String(roots[0]!.scenario_id), input_bindings: {}, parameters };
  const replace = (collection: string, field: string, item: CanonicalObject) => [...objects(model, collection).filter(old => old[field] !== item[field]), item];
  return { ...model, objects: { ...model.objects, Event: replace("Event", "event_id", event), EventEffect: replace("EventEffect", "event_effect_id", effect), PrimitiveInstance: replace("PrimitiveInstance", "primitive_instance_id", primitive),
    Scenario: objects(model, "Scenario").map(item => item === roots[0] ? { ...item, event_ids: [...new Set([...(Array.isArray(item.event_ids) ? item.event_ids : []), plan.eventId])] } : item) } };
};

export const compileDomainMechanics = (model: PortableModelEnvelope, request: DomainCompilerRequest): CompileResult<CompiledDomainMechanics> => {
  const preflight = preflightCanonicalCollections(model, ["Account", "Investment", "Insurance", "Event", "EventEffect", "PrimitiveInstance"]);
  if (preflight.status !== "compiled") return preflight;
  const selected = selectScenario(model, { capabilityName: "domain_mechanics", executionLabel: "Domain mechanics", ...(request.scenarioId === undefined ? {} : { scenarioId: request.scenarioId }), simulationStart: request.simulationStart, simulationEnd: request.simulationEnd });
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
    const policyAccounts = new Set(objects(model, "Insurance").flatMap(item => [String(item.premium_account_id), String(item.benefit_account_id)]));
    const participatingAccounts = new Map([...accounts].filter(([id, item]) => ownedAccounts.has(id) || policyAccounts.has(id) && (scope.value.memberIds.includes(String(item.owner_id)) || item.owner_id === scope.value.householdId)));
    const lookup = (id: unknown, map: ReadonlyMap<string, CanonicalObject>, label: string) => {
      const found = map.get(required(id, label)); if (!found) throw new Error(label); return found;
    };
    const bank = (id: unknown) => {
      const account = lookup(id, ownedAccounts, "Select a checking/savings account owned by the execution person.");
      if (!["checking", "savings"].includes(String(account.account_type))) throw new Error("Personally funded purchases and premiums require checking/savings.");
      return String(account.account_id);
    };
    const accountStates: AuthoritativeState["accounts"] = {};
    for (const [id, account] of participatingAccounts) {
      const kind = accountKinds[String(account.account_type)];
      if (!kind) continue;
      if (account.currency !== currency.code || date(account.opening_date, "Account opening date is required.") > request.simulationStart ||
        account.closing_date != null && date(account.closing_date, "Account closing date is invalid.") < request.simulationEnd) throw new Error("Participating accounts must use the forecast currency and be open throughout the horizon.");
      accountStates[id] = { id: domainId("account", id), ownerId: domainId(account.owner_id === scope.value.householdId ? "household" : "person", String(account.owner_id)), kind, cash: money(exact(account.opening_balance, "Exact opening wrapper/bank cash is required."), currency) };
    }
    const household = objects(model, "Household").find(item => item.household_id === scope.value.householdId)!;
    const taxFactsAt = (at: string, personId = request.executionOwnerId) => {
      const person = scope.value.peopleById.get(personId);
      if (!person) throw new Error("Benefit destination must identify a household member's jurisdictional facts.");
      const residences = (Array.isArray(person.residence_jurisdiction_periods) ? person.residence_jurisdiction_periods.filter(record) : []).filter(item =>
        typeof item.effective_date === "string" && item.effective_date <= at.slice(0, 10) && (item.expiration_date == null || String(item.expiration_date) > at.slice(0, 10)));
      const residence = residences[0];
      const eligibility = [household, person].flatMap(item => Array.isArray(item.tax_eligibility_periods) ? item.tax_eligibility_periods : []) as unknown as readonly TaxEligibilityPeriod[];
      return { residenceJurisdictions: residence ? [String(residence.state_jurisdiction).replace(/^US-/, "US:"), ...(residence.local_jurisdiction == null ? [] : [String(residence.local_jurisdiction)])] : [], workJurisdictions: [],
        eligibility: resolveTaxEligibility(eligibility, at.slice(0, 10)), ...(typeof residence?.municipality === "string" ? { residenceMunicipality: residence.municipality } : {}), ...(typeof residence?.psd_code === "string" ? { residencePsdCode: residence.psd_code } : {}) };
    };
    const taxFacts = taxFactsAt(start);
    const holdings: DomainHolding[] = [], operations: DomainOperation[] = [];
    const add = (operation: DomainOperation) => {
      if (operation.sourceRefs) { operations.push(operation); return; }
      const policy = objects(model, "Insurance").find(item => operation.id.startsWith(String(item.insurance_id) + ":"));
      const source = policy ? "Insurance:" + String(policy.insurance_id) : operation.holdingId ? "Investment:" + operation.holdingId : "Account:" + operation.cashAccountId;
      operations.push({ ...operation, taxFacts: policy ? operation.taxFacts : taxFactsAt(operation.at), generated: true, sourceRefs: ["compiler:canonical:" + source, ...(operation.kind === "death_benefit" ? ["compiler:canonical:Event:" + String(policy!.death_event_id)] : [])] });
    };
    for (const [id, investment] of investments) {
      if (!ownedAccounts.has(String(investment.account_id))) continue;
      const kind = investment.instrument_subtype ?? investment.investment_type;
      if (investment.investment_type === "crypto" && [...investments.values()].some(other => other !== investment && other.investment_type === "crypto" && other.account_id === investment.account_id && other.symbol === investment.symbol)) throw new Error("Represent each spot cryptocurrency once per actual wallet/account so FIFO cannot omit another holding's earlier lots.");
      if (investment.investment_type === "option" && kind !== "long_equity_call" || investment.investment_type === "bond" && !["treasury_bill", "treasury_note", "treasury_bond", "cd"].includes(String(kind))) throw new Error("Only admitted fixed-income products and long listed equity calls are supported.");
      if (investment.investment_type === "crypto" && kind !== "crypto") throw new Error("Only spot investment crypto is supported; mining, staking, DeFi and exchanges are unavailable.");
      if (!["equity", "fund", "crypto", ...subtypeKinds].includes(String(kind))) continue;
      if (["crypto", "long_equity_call"].includes(String(kind)) && investment.return_model_id != null) throw new Error("Crypto and call contracts require their explicit deterministic prices; equity return models are unavailable.");
      const quantity = exact(investment.quantity, "Holding quantity must be explicit."), lots: DomainLot[] = [];
      if (Array.isArray(investment.tax_lots)) for (const lot of investment.tax_lots) {
        if (!record(lot)) throw new Error("Opening lots require identity, acquisition date, quantity and cost basis.");
        lots.push({ id: required(lot.id, "Lot identity is required."), acquired: date(lot.acquired, "Lot acquisition date is required."), quantity: exact(lot.quantity, "Lot quantity is required."), basis: exact(lot.basis, "Economic lot basis is required.") });
      }
      else if (investment.acquisition_date != null && investment.cost_basis != null && decimal(quantity).isPositive()) lots.push({ id: id + ":opening", acquired: date(investment.acquisition_date, "Acquisition date is required."), quantity, basis: exact(investment.cost_basis, "Economic basis is required.") });
      if (lots.length && (new Set(lots.map(lot => lot.id)).size !== lots.length || !lots.reduce((sum, lot) => sum.plus(decimal(lot.quantity)), decimal("0")).equals(decimal(quantity)))) throw new Error("Opening lot identities must be unique and quantities reconcile to the holding.");
      if (lots.some(lot => !decimal(lot.quantity).isPositive() || lot.acquired > request.asOf)) throw new Error("Opening lots require positive owned units and acquisition dates on or before the opening position.");
      holdings.push({ id, accountId: String(investment.account_id), kind: kind as DomainHolding["kind"], lots,
        ...(investment.after_tax_basis == null ? {} : { afterTaxBasis: exact(investment.after_tax_basis, "Previously taxed retirement basis must be explicit.") }),
        ...(kind !== "long_equity_call" ? {} : { underlyingId: String(investment.underlying_investment_id), strike: exact(investment.strike_price, "Strike is required."), multiplier: exact(investment.contract_multiplier, "Multiplier is required."), expiration: date(investment.expiration_date, "Expiration is required.") }) });
      if (kind === "long_equity_call") {
        const underlying = lookup(investment.underlying_investment_id, investments, "Choose an underlying equity holding.");
        if (underlying.investment_type !== "equity" || underlying.account_id !== investment.account_id || ownedAccounts.get(String(investment.account_id))!.account_type !== "taxable_brokerage" ||
          !decimal(String(investment.contract_multiplier)).isPositive() || !decimal(String(investment.contract_multiplier)).fitsScale(0) || !decimal(quantity).fitsScale(0) || decimal(quantity).isPositive() && !lots.length) throw new Error("Options require whole long listed equity call contracts, acquisition dates and premium basis in a taxable brokerage wrapper.");
        const expiration = utcDate(investment.expiration_date)!;
        if (start <= expiration && expiration < end) add({ id: id + ":expiration", at: expiration, order: 999999, kind: "call_expiration", holdingId: id, amount: "0", taxFacts });
      }
      if (["treasury_bill", "treasury_note", "treasury_bond", "cd"].includes(String(kind))) {
        if (ownedAccounts.get(String(investment.account_id))!.account_type !== "taxable_brokerage") throw new Error("Treasury/CD contracts require a taxable brokerage wrapper; retirement funding and distribution semantics are unavailable for this floor.");
        const acquired = date(investment.acquisition_date, "Fixed-income acquisition date is required."), maturity = date(investment.maturity_date, "Maturity is required.");
        const face = money(exact(investment.face_value, "Face/deposit principal is required."), currency);
        const futurePurchase = acquired >= request.simulationStart;
        if (maturity <= acquired || !decimal(quantity).equals(decimal(futurePurchase ? "0" : "1"))) throw new Error("Use one opening contract, or zero opening units for a future bank-funded acquisition.");
        const cost = money(exact(investment.cost_basis, "Purchase/deposit cost is required."), currency), destination = required(investment.settlement_account_id, "Choose a durable maturity settlement destination.");
        if (investment.price !== cost.amount.toString() && (typeof investment.price !== "string" || !money(investment.price, currency).equals(cost))) throw new Error("Held-to-maturity contract price must equal its explicit purchase/deposit cost.");
        const maturityDestination = lookup(destination, ownedAccounts, "Settlement destination must be an owned account.");
        if (destination !== investment.account_id && !["checking", "savings"].includes(String(maturityDestination.account_type))) throw new Error("Maturity settles to the owning wrapper or an explicitly selected checking/savings account; implicit retirement contributions are unavailable.");
        if (!cost.isPositive() || kind === "treasury_bill" && (cost.compare(face) >= 0 || acquired.slice(0, 4) !== maturity.slice(0, 4)) ||
          kind !== "treasury_bill" && !cost.equals(face)) throw new Error("Bills require a same-tax-year discount; notes/bonds/CDs require par/deposit cost. Premium, OID and pre-maturity sales are unavailable.");
        if (investment.return_model_id != null) throw new Error("Held-to-maturity fixed-income contracts cannot use an equity return model.");
        if (kind === "cd" && maturity > String(Number(acquired.slice(0, 4)) + 1).padStart(4, "0") + acquired.slice(4)) throw new Error("The CD floor supports terms of one year or less without long-term OID.");
        if (futurePurchase && utcDate(acquired)! < end) add({ id: id + ":acquisition", at: utcDate(acquired)!, order: 0, kind: "purchase", holdingId: id, cashAccountId: bank(investment.funding_account_id), amount: cost.amount.toString(), quantity: "1", taxFacts });
        if (start <= utcDate(maturity)! && utcDate(maturity)! < end) add({ id: id + ":maturity", at: utcDate(maturity)!, order: 900001, kind: "maturity", holdingId: id, cashAccountId: destination, amount: face.amount.toString(), taxFacts });
        if (kind !== "treasury_bill") {
          const annual = decimal(exact(investment.coupon_rate, "Explicit coupon/CD interest rate is required."));
          if (investment.interest_convention !== "nominal_annual_simple") throw new Error("The fixed-income floor requires explicit nominal annual simple coupon/interest convention.");
          const frequency = investment.crediting_frequency, months = frequency === "monthly" ? 1 : frequency === "semiannual" ? 6 : frequency === "annual" ? 12 : undefined;
          if (!months || kind !== "cd" && months !== 6) throw new Error("Treasury coupons credit semiannually; CDs credit monthly, semiannually or annually.");
          const anchor = date(investment.first_credit_date, "First contractual interest credit date is required.");
          const targetMonth = Number(acquired.slice(0, 4)) * 12 + Number(acquired.slice(5, 7)) - 1 + months;
          const expectedFirstCredit = String(Math.floor(targetMonth / 12)).padStart(4, "0") + "-" + String(targetMonth % 12 + 1).padStart(2, "0") + acquired.slice(7);
          if (anchor !== expectedFirstCredit || !utcDate(expectedFirstCredit)) throw new Error("The first coupon/interest credit must follow one full explicit crediting interval; stub periods are unavailable.");
          const scheduled = utcMonthlyOccurrences(utcDate(anchor)!, { start: utcDate(anchor)!, end: instant(maturity + "T00:00:00.001Z") }, "skip");
          if (anchor <= acquired || scheduled.length === 0 || !scheduled.some(item => item.slice(0, 10) === maturity && (Number(item.slice(0, 4)) * 12 + Number(item.slice(5, 7)) - Number(anchor.slice(0, 4)) * 12 - Number(anchor.slice(5, 7))) % months === 0)) throw new Error("Coupon/interest schedule must end at maturity without an unsupported stub period.");
          const coupon = money(face.amount.times(annual).times(decimal(String(months))).dividedBy(decimal("12"), new RoundingPolicy(2, "half_even")).toString(), currency);
          for (const at of scheduled) {
            const offset = Number(at.slice(0, 4)) * 12 + Number(at.slice(5, 7)) - Number(anchor.slice(0, 4)) * 12 - Number(anchor.slice(5, 7));
            if (offset % months === 0 && start <= at && at < end) add({ id: id + ":coupon:" + at, at, order: 900000, kind: kind === "cd" ? "interest" : "treasury_interest", holdingId: id, cashAccountId: String(investment.account_id), amount: coupon.amount.toString(), taxFacts });
          }
        }
      }
    }
    for (const [id, account] of ownedAccounts) if (account.interest_rate != null) {
      bank(id);
      const rate = exact(account.interest_rate, "Enter the credited annual effective rate.");
      if (account.interest_convention !== "effective_annual_monthly") throw new Error("Cash interest requires explicit effective annual/APY rate with monthly crediting.");
      const anchor = utcDate(date(account.first_credit_date, "Choose the first monthly credit date."))!;
      if (anchor < utcDate(account.opening_date)!) throw new Error("Cash interest cannot credit before the account opens.");
      for (const at of utcMonthlyOccurrences(anchor, { start, end }, "skip")) add({ id: id + ":interest:" + at, at, order: 900010, kind: "cash_interest", cashAccountId: id, amount: "0", annualEffectiveRate: rate, taxFacts });
    }
    for (const policy of objects(model, "Insurance")) {
      const owner = required(policy.owner_id, "Choose the explicit personal policy owner.");
      if (!scope.value.memberIds.includes(owner)) throw new Error("Term-life policies require a household-member personal owner.");
      if (policy.insurance_type !== "life" || policy.policy_family !== "term_life_lump_sum" || policy.premium_frequency !== "monthly" || policy.claim_probability_model_id != null) throw new Error("Only personally owned term life with monthly premiums and lump-sum scheduled death benefits is supported.");
      lookup(policy.insured_person_id, scope.value.peopleById, "Choose the insured household person.");
      const beneficiary = required(policy.beneficiary_id, "Choose an explicit beneficiary.");
      if (beneficiary !== scope.value.householdId && !scope.value.memberIds.includes(beneficiary)) throw new Error("The modeled beneficiary must be this household or one of its people.");
      const sourceAccount = lookup(policy.premium_account_id, participatingAccounts, "Choose the policy owner's premium account."), destinationAccount = lookup(policy.benefit_account_id, participatingAccounts, "Choose the beneficiary's benefit account.");
      if (sourceAccount.owner_id !== owner || ![sourceAccount, destinationAccount].every(item => ["checking", "savings"].includes(String(item.account_type)))) throw new Error("Premium funding must be the policy owner's checking/savings; benefits require explicit checking/savings.");
      if (destinationAccount.owner_id !== beneficiary && beneficiary !== scope.value.householdId) throw new Error("Benefit destination must belong to the beneficiary.");
      const source = String(sourceAccount.account_id), destination = String(destinationAccount.account_id);
      const recipient = beneficiary === scope.value.householdId ? String(destinationAccount.owner_id) : beneficiary;
      if (!scope.value.memberIds.includes(recipient)) throw new Error("A household beneficiary requires an explicit member-owned destination with supported jurisdictional facts.");
      const from = date(policy.start_date, "Policy start is required."), until = date(policy.end_date, "Term policy end is required."), death = objects(model, "Event").find(item => item.event_id === policy.death_event_id);
      if (!death || death.event_type !== "death" || death.enabled !== true || death.scenario_id !== selected.value.id || death.trigger_type !== "scheduled" || death.trigger_condition != null || death.probability_model_id != null) throw new Error("Choose one scheduled death event in the active scenario.");
      const deathDate = date(death.start_date, "Death event date is invalid.");
      if (until <= from || deathDate < from || deathDate >= until) throw new Error("The scheduled death must fall inside the policy's half-open coverage interval.");
      const id = String(policy.insurance_id), premium = exact(policy.premium, "Monthly premium is required."), benefit = exact(policy.coverage_amount, "Lump-sum coverage amount is required.");
      for (const at of utcMonthlyOccurrences(utcDate(from)!, { start, end }, "skip")) if (at.slice(0, 10) < deathDate && at.slice(0, 10) < until) add({ id: id + ":premium:" + at, at, order: 900020, kind: "insurance_premium", cashAccountId: source, amount: premium, taxFacts: taxFactsAt(at, owner) });
      const at = utcDate(deathDate)!; if (start <= at && at < end) add({ id: id + ":benefit", at, order: 900021, kind: "death_benefit", cashAccountId: destination, amount: benefit, taxFacts: taxFactsAt(at, recipient) });
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
      const operation: DomainOperation = { id: String(event.event_id), at, order, kind, amount, taxFacts: taxFactsAt(at), sourceRefs: ["compiler:canonical:Event:" + String(event.event_id), "compiler:canonical:PrimitiveInstance:" + String(primitive.primitive_instance_id)],
        ...Object.fromEntries(["holdingId", "destinationHoldingId", "rothHoldingId", "cashAccountId", "sourceAccountId", "quantity", "linkedOperationId", "replacementAmount", "lotIds", "dividendCharacter"].filter(key => terms[key] != null).map(key => [key, terms[key]])) };
      if (terms.quantity != null) exact(terms.quantity, "Enter nonnegative exact units.");
      if (terms.lotIds != null && (!Array.isArray(terms.lotIds) || terms.lotIds.some(id => typeof id !== "string"))) throw new Error("Lot selection must contain explicit lot identities.");
      if (kind === "reinvest_dividend" && !["ordinary", "qualified"].includes(String(terms.dividendCharacter))) throw new Error("Choose ordinary or qualified dividend character explicitly before reinvesting.");
      if (["purchase", "call_exercise"].includes(kind)) bank(terms.cashAccountId);
      if (terms.sourceAccountId != null) bank(terms.sourceAccountId);
      if (kind.includes("rollover") || kind === "conversion" || kind === "indirect_distribution" || kind === "indirect_deposit") {
        if (terms.eligibility !== (kind === "indirect_distribution" || kind === "indirect_deposit" ? "eligible_owned_participant" : "eligible_owned_direct") || terms.destinationAcceptance !== true) throw new Error("Retirement operations require explicit eligibility and plan/destination acceptance; RMD, hardship, inherited, corrective and special distributions are unavailable.");
        const sourceInvestment = kind === "indirect_deposit" ? undefined : lookup(terms.holdingId, investments, "Choose the owned retirement source.");
        const source = sourceInvestment && lookup(sourceInvestment.account_id, ownedAccounts, "Retirement source ownership is required.");
        const destinationInvestment = kind === "indirect_distribution" ? undefined : lookup(terms.destinationHoldingId, investments, "Choose a compatible retirement destination.");
        const destination = destinationInvestment && lookup(destinationInvestment.account_id, ownedAccounts, "Destination ownership is required.");
        if (sourceInvestment && sourceInvestment.after_tax_basis == null) throw new Error("Enter actual previously taxed source basis, including explicit zero; prior-YTD contribution usage is not basis.");
        if (sourceInvestment && destinationInvestment && sourceInvestment.investment_id === destinationInvestment.investment_id) throw new Error("Choose distinct retirement source and destination holdings.");
        if (source && [...investments.values()].filter(item => item.account_id === source.account_id && decimal(String(item.quantity)).isPositive()).length !== 1 || source && !decimal(String(source.opening_balance)).isZero()) throw new Error("The admitted rollover source must have one eligible owned holding and no wrapper cash; multi-holding pro-rata allocation is unavailable.");
        const sourceType = String(source?.account_type), destinationType = String(destination?.account_type);
        const directCompatible = sourceType === "traditional_401k" && ["traditional_ira", "traditional_401k"].includes(destinationType) || sourceType === "roth_401k" && destinationType === "roth_ira" || sourceType === "traditional_ira" && destinationType === "traditional_ira";
        if (kind === "direct_rollover" && !directCompatible) throw new Error("Choose a supported direct rollover/trustee transfer with compatible pre-tax/Roth character.");
        if (kind === "conversion" && (sourceType !== "traditional_401k" || destinationType !== "roth_401k" || terms.samePlanConfirmed !== true)) throw new Error("Confirm that the eligible traditional and Roth 401(k) holdings belong to the same plan; institution names do not establish plan identity.");
        if (kind === "mixed_rollover") {
          const roth = lookup(lookup(terms.rothHoldingId, investments, "Choose the Roth IRA for the after-tax share.").account_id, ownedAccounts, "Roth destination ownership is required.");
          if (sourceType !== "traditional_401k" || destinationType !== "traditional_ira" || roth.account_type !== "roth_ira") throw new Error("Mixed rollover directs the pro-rata pre-tax share to Traditional IRA and after-tax share to Roth IRA.");
        }
        if (kind === "indirect_distribution" && sourceType !== "traditional_401k" || kind === "indirect_deposit" && destinationType !== "traditional_ira") throw new Error("The participant-received floor is an eligible traditional employer-plan distribution to Traditional IRA.");
        if (kind === "indirect_distribution") bank(terms.cashAccountId);
      } else if (operation.holdingId) {
        const holding = lookup(operation.holdingId, investments, "Choose an investment holding."), account = lookup(holding.account_id, ownedAccounts, "Holding owner is unavailable.");
        if (account.account_type !== "taxable_brokerage") throw new Error("Sales, investment purchases, dividends and options require a taxable brokerage wrapper.");
        if (kind === "purchase" && holding.investment_type !== "crypto" && holding.instrument_subtype !== "long_equity_call") throw new Error("Use Investment purchases for ordinary equity/fund purchases. Domain purchase supports spot crypto and long listed equity-call premiums only.");
        if (["treasury_bill", "treasury_note", "treasury_bond", "cd"].includes(String(holding.instrument_subtype))) throw new Error("Use the instrument's durable acquisition, funding, coupon and maturity terms. Additional purchases, pre-maturity sales and manual distribution overrides are unavailable.");
        if (holding.investment_type === "option" && kind === "sale" && at.slice(0, 10) >= String(holding.expiration_date)) throw new Error("Close the call before expiration; use its lapse/exercise contract afterwards.");
        if (["ordinary_dividend", "qualified_dividend", "reinvest_dividend"].includes(kind) && !["equity", "fund"].includes(String(holding.investment_type))) throw new Error("Dividend character is supported only for equity/fund distributions; crypto income and special option distributions are unavailable.");
        if (kind === "call_exercise" && holding.instrument_subtype !== "long_equity_call") throw new Error("Exercise requires a long listed equity call.");
      }
      add(operation);
    }
    for (const operation of operations) if (operations.some(other => other !== operation && !other.generated && !operation.generated && other.at === operation.at && other.order === operation.order &&
      [operation.holdingId, operation.cashAccountId, operation.sourceAccountId].some(id => id !== undefined && [other.holdingId, other.cashAccountId, other.sourceAccountId].includes(id)))) throw new Error("Operations sharing a holding or cash source on the same date require distinct priorities.");
    // Canonical collections must not make model array order part of run identity.
    // Execution precedence still comes from each operation's instant/order policy.
    const input: DomainMechanicsInput = { currency: currency.code,
      holdings: holdings.sort((a, b) => a.id.localeCompare(b.id)),
      operations: operations.sort((a, b) => a.at.localeCompare(b.at) || a.order - b.order || a.id.localeCompare(b.id)),
    };
    return { status: "compiled", value: { input, openingState: createAuthoritativeState({ accounts: accountStates }), participant: createDomainMechanicsParticipant(input) }, diagnostics: [] };
  } catch (error) {
    return { status: "unsupported", diagnostics: [capability("D1B_DOMAIN_UNSUPPORTED", error instanceof Error ? error.message : "Domain terms are incomplete.", "domain_mechanics")] };
  }
};
