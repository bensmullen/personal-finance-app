import { ValidationError } from "../../diagnostics/index.js";
import { domainId } from "../../identity/index.js";
import type { PortableModelEnvelope } from "../../model/modelVersion.js";
import { createTaxCatalog } from "../../rules/tax/catalog.js";
import { projectedCurrentLawCatalog } from "../../rules/tax/projection.js";
import { alphaStateTaxCatalog, alphaLocalTaxCatalog, federal2024TaxCatalog, federal2026TaxCatalog } from "../../rules/tax/lawCatalog.js";
import type { TaxCoreRule, FilingStatus } from "../../rules/tax/contracts.js";
import { decimal } from "../../values/index.js";
import { Money } from "../../values/index.js";
import { instant } from "../../time/index.js";
import type { FundingPolicy } from "../../funding/index.js";
import type { AccountId } from "../../accounting/index.js";
import { immutableConfiguration } from "../../simulation/r3/compiledHousehold.js";
import { canonicalSerialize } from "../../simulation/run.js";
import { taxDiagnostic, type HouseholdTaxInput, type TaxPaymentInstruction, type TaxSettlementInstruction, type ResidenceTaxPeriod, type WorkTaxAllocation, type TaxEligibilityPeriod } from "../../simulation/tax/contracts.js";
import { canonicalId, objects, resolveHouseholdScope, resolveOwnerScope, utcDate } from "./shared.js";
import type { CanonicalObject } from "./shared.js";
import type { CompileResult } from "./types.js";
import { activeTaxFact as active, resolveTaxEligibility } from "../../simulation/tax/facts.js";
export { activeTaxFact, resolveTaxEligibility } from "../../simulation/tax/facts.js";

export interface HouseholdTaxCompilerRequest {
  readonly projectedCurrentLawThrough?: string;
  readonly catalog?: readonly TaxCoreRule[];
  readonly fundingPolicy?: FundingPolicy;
  readonly refundAccountId?: AccountId;
  readonly payments?: readonly TaxPaymentInstruction[];
  readonly settlements?: readonly TaxSettlementInstruction[];
}
function fail(message: string): never { throw new ValidationError({ severity: "error", code: "TAX_FACT_INVALID", message, entityType: "tax_facts" }); }
const periods = <T extends { readonly effective_date: string; readonly expiration_date?: string }>(object: CanonicalObject, field: string): readonly T[] => {
  const raw = object[field];
  if (raw === undefined || raw === null) return Object.freeze([]);
  if (!Array.isArray(raw)) return fail(`${field} must be an array.`);
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) fail(`${field} entries must be objects.`);
    const entry = item as CanonicalObject;
    const start = utcDate(entry.effective_date), end = entry.expiration_date === undefined ? undefined : utcDate(entry.expiration_date);
    if (!start || (entry.expiration_date !== undefined && !end) || (end !== undefined && end <= start)) fail(`${field} requires increasing half-open date intervals.`);
  }
  return immutableConfiguration(raw as unknown as readonly T[]);
};
const locations = <T extends ResidenceTaxPeriod>(entries: readonly T[]): readonly T[] => {
  for (const item of entries) {
    if (typeof item.state_jurisdiction !== "string" || !item.state_jurisdiction.trim()) fail("A state jurisdiction is required.");
    if (item.state_jurisdiction.toLowerCase() === "remote") fail("Remote is an employment arrangement, not an authoritative physical service jurisdiction.");
    for (const key of ["local_jurisdiction", "municipality", "psd_code"] as const) if (item[key] !== undefined && (typeof item[key] !== "string" || !item[key]!.trim())) fail(`Invalid ${key}.`);
    if (item.psd_code !== undefined && !/^[0-9]{6}$/.test(item.psd_code)) fail("PSD code must contain exactly six digits.");
  }
  return entries;
};
export const validateResidenceTaxPeriods = (entries: readonly ResidenceTaxPeriod[]): void => {
  locations(entries);
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    const a = entries[i]!, b = entries[j]!;
    if (a.effective_date < (b.expiration_date ?? "9999-12-31") && b.effective_date < (a.expiration_date ?? "9999-12-31") &&
      ["state_jurisdiction", "local_jurisdiction", "municipality", "psd_code"].some(key => a[key as keyof ResidenceTaxPeriod] !== b[key as keyof ResidenceTaxPeriod])) fail("Contradictory overlapping residence tax facts.");
  }
};
export const validateWorkTaxAllocations = (entries: readonly WorkTaxAllocation[], start: string, end?: string): void => {
  locations(entries);
  for (const item of entries) {
    if (typeof item.allocation !== "string" || !/^(?:0|1)(?:\.[0-9]+)?$/.test(item.allocation)) fail("Work allocation must be an exact fraction string.");
    const fraction = decimal(item.allocation);
    if (!fraction.isPositive() || fraction.compare(decimal("1")) > 0) fail("Work allocation must be greater than zero and at most one.");
  }
  const boundaries = [...new Set([start, ...entries.flatMap(item => [item.effective_date, ...(item.expiration_date === undefined ? [] : [item.expiration_date])])])].sort();
  for (const at of boundaries) {
    if (at < start || (end !== undefined && at >= end)) continue;
    const applicable = entries.filter(item => active(item, at));
    // Uncovered intervals remain unknown and are diagnosed at execution, not invented.
    if (!applicable.length) continue;
    const total = applicable.reduce((sum, item) => sum.plus(decimal(item.allocation)), decimal("0"));
    if (!total.equals(decimal("1"))) fail("Active service allocations must sum exactly to one.");
  }
};
const eligibility = (object: CanonicalObject): readonly TaxEligibilityPeriod[] => {
  const entries = periods<TaxEligibilityPeriod>(object, "tax_eligibility_periods");
  for (const item of entries) if (typeof item.key !== "string" || !item.key.trim() || typeof item.value !== "boolean") fail("Eligibility requires a stable key and boolean value.");
  return entries;
};

export const compileHouseholdTax = (model: PortableModelEnvelope, request: HouseholdTaxCompilerRequest = {}): CompileResult<HouseholdTaxInput> => {
  try {
    const scope = resolveHouseholdScope(model);
    if (scope.status !== "compiled") return scope;
    const household = objects(model, "Household").find(item => canonicalId(item, "household_id") === scope.value.householdId)!;
    const people = objects(model, "Person").filter(item => scope.value.memberIds.includes(canonicalId(item, "person_id") ?? ""));
    const statuses = [household, ...people].flatMap(item => item.filing_status == null ? [] : [item.filing_status === "qualifying_widow_er" ? "qualifying_surviving_spouse" : item.filing_status]);
    const diagnostics = [];
    const validStatuses = ["single", "married_joint", "married_separate", "head_of_household", "qualifying_surviving_spouse"];
    if (statuses.some(status => !validStatuses.includes(String(status)))) fail("Noncanonical filing status.");
    if (!statuses.length || new Set(statuses).size !== 1) diagnostics.push(taxDiagnostic("filing_status", "Explicit unambiguous filing status is required."));
    const sharedEligibility = eligibility(household);
    const personEligibility = new Map(people.map(person => [canonicalId(person, "person_id")!, eligibility(person)] as const));
    const residences = new Map(people.map(person => {
      const entries = locations(periods<ResidenceTaxPeriod>(person, "residence_jurisdiction_periods"));
      validateResidenceTaxPeriods(entries);
      return [canonicalId(person, "person_id")!, entries] as const;
    }));
    const incomes = [];
    for (const income of objects(model, "Income")) {
      const id = canonicalId(income, "income_id"); if (!id) continue;
      const owner = resolveOwnerScope(model, income.owner_id, scope.value, "Income", id);
      if (owner.status !== "compiled") return owner;
      if (owner.value !== "in_scope") continue;
      const start = utcDate(income.start_date); if (!start) fail(`Income ${id} requires a valid start_date.`);
      const end = income.end_date == null ? undefined : utcDate(income.end_date);
      if (income.end_date != null && !end) fail(`Income ${id} requires a valid end_date.`);
      const work = locations(periods<WorkTaxAllocation>(income, "work_service_jurisdiction_allocations"));
      const employment = ["salary", "bonus", "commission", "overtime", "severance"].includes(String(income.income_type));
      if (work.length && !employment) fail("Work allocations belong only on employment Income.");
      validateWorkTaxAllocations(work, start, end);
      const ownerId = String(income.owner_id).toLowerCase();
      const personId = residences.has(ownerId) ? ownerId : people.length === 1 ? canonicalId(people[0]!, "person_id") : undefined;
      incomes.push({ id, ownerId, incomeType: String(income.income_type), taxCharacter: String(income.tax_character ?? "ordinary"), grossOrNet: String(income.gross_or_net ?? "gross"), start, ...(end === undefined ? {} : { end }), work,
        residence: personId === undefined ? [] : residences.get(personId)!, eligibility: [...(personId === undefined ? [] : personEligibility.get(personId)!), ...eligibility(income)] });
    }
    // Contradictions within an owner's applicable facts never resolve by object order.
    const allEligibility = [...sharedEligibility, ...incomes.flatMap(income => income.eligibility)];
    for (const at of allEligibility.map(item => item.effective_date)) resolveTaxEligibility(sharedEligibility, at);
    for (const entries of personEligibility.values()) for (const at of [...sharedEligibility, ...entries].map(item => item.effective_date)) resolveTaxEligibility([...sharedEligibility, ...entries], at);
    for (const income of incomes) for (const at of allEligibility.map(item => item.effective_date)) resolveTaxEligibility([...sharedEligibility, ...income.eligibility], at);
    const verified = request.catalog ?? [...federal2024TaxCatalog, ...federal2026TaxCatalog, ...alphaStateTaxCatalog, ...alphaLocalTaxCatalog];
    const catalog = request.projectedCurrentLawThrough === undefined ? createTaxCatalog(verified) : projectedCurrentLawCatalog(verified, request.projectedCurrentLawThrough);
    const accountTaxTreatments: Record<string, string> = {};
    for (const account of objects(model, "Account")) {
      const id = canonicalId(account, "account_id"); if (!id) continue;
      const owner = resolveOwnerScope(model, account.owner_id, scope.value, "Account", id);
      if (owner.status !== "compiled") return owner;
      if (owner.value === "in_scope") accountTaxTreatments[id] = String(account.tax_treatment ?? "taxable");
    }
    const taxRuleReferences = objects(model, "TaxRule").map(rule => {
      const id = canonicalId(rule, "tax_rule_id"), date = utcDate(rule.effective_date), end = rule.expiration_date == null ? undefined : utcDate(rule.expiration_date);
      if (!id || !date || (rule.expiration_date != null && !end) || (end !== undefined && end <= date) || typeof rule.jurisdiction !== "string") fail("Canonical TaxRule references require identity, jurisdiction and increasing effective dates.");
      return { id, jurisdiction: rule.jurisdiction, taxType: String(rule.tax_type), effective_date: date, ...(end === undefined ? {} : { expiration_date: end }), embeddedDefinition: ["brackets", "rates", "deduction_rules", "credit_rules"].some(field => Array.isArray(rule[field]) && (rule[field] as readonly unknown[]).length > 0) };
    });
    const instructions = [...request.payments ?? [], ...request.settlements ?? []];
    if (new Set(instructions.map(item => item.id)).size !== instructions.length) fail("Tax instruction identities must be unique.");
    for (const item of instructions) {
      if (!item.id.trim() || !item.jurisdiction.trim()) fail("Tax instructions require explicit identity and jurisdiction.");
      try { instant(item.at); } catch { fail("Tax instructions require a valid exact UTC instant."); }
      if (item.priority !== undefined && (!Number.isSafeInteger(item.priority) || item.priority < 0)) fail("Tax instruction priority must be a nonnegative safe integer.");
      if ("amount" in item && (!(item.amount instanceof Money) || item.amount.isNegative() || item.amount.currency.code !== "USD" || !item.amount.amount.fitsScale(2))) fail("Tax payments require nonnegative posted USD cents.");
      if ("taxYear" in item && (!/^[0-9]{4}$/.test(item.taxYear) || item.at.slice(0, 4) < item.taxYear)) fail("Tax settlement requires an explicit tax year and cannot precede it.");
    }
    for (const collection of [request.payments ?? [], request.settlements ?? []]) for (const item of collection) {
      const sameInstant = collection.filter(other => other.at === item.at);
      if (sameInstant.length > 1 && (sameInstant.some(other => other.priority === undefined) || new Set(sameInstant.map(other => other.priority)).size !== sameInstant.length)) fail("Competing same-instant tax instructions require explicit distinct priorities.");
    }
    const canonicalOrder = <T>(values: readonly T[]): readonly T[] => [...values].sort((a, b) => canonicalSerialize(a).localeCompare(canonicalSerialize(b)));
    return { status: "compiled", diagnostics: Object.freeze([]), value: immutableConfiguration({ catalog, accountTaxTreatments, taxRuleReferences: canonicalOrder(taxRuleReferences),
      ...(new Set(statuses).size === 1 ? { filingStatus: statuses[0] as FilingStatus } : {}), ownerId: domainId("household", scope.value.householdId), incomes: canonicalOrder(incomes.map(income => ({ ...income, residence: canonicalOrder(income.residence), work: canonicalOrder(income.work), eligibility: canonicalOrder(income.eligibility) }))), eligibility: canonicalOrder(sharedEligibility),
      ...(request.fundingPolicy === undefined ? {} : { fundingPolicy: request.fundingPolicy }), ...(request.refundAccountId === undefined ? {} : { refundAccountId: request.refundAccountId }), payments: request.payments ?? [],
      settlements: request.settlements ?? [], diagnostics }) };
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return { status: "invalid_model", diagnostics: error.issues };
  }
};
