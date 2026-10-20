import { ValidationError } from "../../diagnostics/index.js";
import { domainId } from "../../identity/index.js";
import type { JsonValue, PortableModelEnvelope } from "../../model/modelVersion.js";
import { decimal, money } from "../../values/index.js";
import type { PayrollWithholdingElection } from "../../simulation/tax/contracts.js";
import { canonicalId, EXACT_DECIMAL, objects, PAYMENT_FREQUENCIES, resolveHouseholdScope, utcDate, UUID, type CanonicalObject } from "./shared.js";

export const WITHHOLDING_ADAPTER = "payroll-withholding/v1";
const record = (value: JsonValue | undefined): value is CanonicalObject => typeof value === "object" && value !== null && !Array.isArray(value);
function fail(message: string): never { throw new ValidationError({ severity: "error", code: "PAYROLL_WITHHOLDING_INVALID", message, entityType: "Income" }); }

export interface PayrollWithholdingPlan {
  readonly id: string;
  readonly incomeId: string;
  readonly ownerId: string;
  /** Must equal the canonical Income.source employer/job identity. */
  readonly employerId: string;
  readonly depositAccountId: string;
  readonly jurisdiction: string;
  readonly effectiveDate: string;
  readonly expirationDate?: string;
  readonly provenance: string;
  readonly userConfirmed: true;
  readonly calculation: { readonly kind: "fixed"; readonly amount: string } | { readonly kind: "percent_gross"; readonly rate: string };
}

/** Validate Income-linked durable primitives without mutating the source model. */
export const durablePayrollWithholding = (model: PortableModelEnvelope): readonly PayrollWithholdingElection[] => {
  const result: PayrollWithholdingElection[] = [];
  const roots = objects(model, "Scenario").filter(item => item.enabled === true && item.base_scenario_id == null);
  for (const primitive of objects(model, "PrimitiveInstance")) {
    if (!record(primitive.parameters) || primitive.parameters.adapter !== WITHHOLDING_ADAPTER) continue;
    const parameters = primitive.parameters, bindings = primitive.input_bindings;
    const id = canonicalId(primitive, "primitive_instance_id");
    if (!id || objects(model, "PrimitiveInstance").filter(item => canonicalId(item, "primitive_instance_id") === id).length !== 1 || primitive.primitive_id !== "P03" || primitive.enabled !== true || !record(bindings)) fail("Withholding requires a unique enabled Income-linked P03 primitive.");
    if (roots.length !== 1 || primitive.scenario_id !== roots[0]!.scenario_id) fail("Withholding requires the active root scenario.");
    if (Object.keys(parameters).some(key => !["adapter", "ownerId", "employerId", "jurisdiction", "provenance", "userConfirmed", "calculation"].includes(key)) || Object.keys(bindings).some(key => !["income_id", "deposit_account_id"].includes(key))) fail("Unsupported withholding fields.");
    const incomeId = bindings.income_id, accountId = bindings.deposit_account_id;
    if (typeof incomeId !== "string" || !UUID.test(incomeId) || typeof accountId !== "string" || !UUID.test(accountId)) fail("Withholding requires Income and receiving bank identities.");
    const income = objects(model, "Income").find(item => canonicalId(item, "income_id") === incomeId.toLowerCase());
    const account = objects(model, "Account").find(item => canonicalId(item, "account_id") === accountId.toLowerCase());
    if (!income || income.income_type !== "salary" || !["gross", "net"].includes(String(income.gross_or_net)) || !PAYMENT_FREQUENCIES.includes(income.frequency as never)) fail("Withholding requires a canonical salary source with explicit gross/net and frequency facts.");
    if (income.scenario_id != null && income.scenario_id !== primitive.scenario_id) fail("Income and withholding scenarios disagree.");
    if (typeof parameters.ownerId !== "string" || parameters.ownerId !== income.owner_id || !objects(model, "Person").some(person => person.person_id === parameters.ownerId)) fail("Withholding requires the salary's person owner.");
    const scope = resolveHouseholdScope(model);
    if (scope.status !== "compiled" || !scope.value.memberIds.includes(parameters.ownerId)) fail("Withholding owner must belong to the modeled household.");
    if (typeof parameters.employerId !== "string" || !parameters.employerId.trim() || parameters.employerId !== income.source) fail("Withholding employer must match canonical Income.source.");
    if (!account || !["cash", "checking", "savings"].includes(String(account.account_type)) || account.currency !== "USD" || account.owner_id !== income.owner_id) fail("Withholding destination must be the salary owner's USD bank, never an employer account.");
    if (typeof parameters.jurisdiction !== "string" || !/^[A-Z][A-Z0-9]*(?::[A-Z0-9_]+)+$/.test(parameters.jurisdiction)) fail("Withholding requires an explicit tax jurisdiction.");
    if (parameters.userConfirmed !== true || typeof parameters.provenance !== "string" || !parameters.provenance.trim()) fail("Withholding requires an explicit user election and provenance.");
    const start = utcDate(primitive.start_date), end = primitive.end_date == null ? undefined : utcDate(primitive.end_date);
    if (!start || primitive.end_date != null && !end || end !== undefined && end <= start) fail("Withholding requires increasing half-open effective dates.");
    const calculation = parameters.calculation;
    if (!record(calculation)) fail("Withholding calculation is required.");
    let parsed: PayrollWithholdingElection["calculation"];
    if (calculation.kind === "fixed" && Object.keys(calculation).every(key => ["kind", "amount"].includes(key)) && typeof calculation.amount === "string" && EXACT_DECIMAL.test(calculation.amount) && !money(calculation.amount).isNegative() && money(calculation.amount).amount.fitsScale(2)) parsed = { kind: "fixed", amount: money(calculation.amount) };
    else if (calculation.kind === "percent_gross" && Object.keys(calculation).every(key => ["kind", "rate"].includes(key)) && typeof calculation.rate === "string" && EXACT_DECIMAL.test(calculation.rate) && !decimal(calculation.rate).isNegative() && decimal(calculation.rate).compare(decimal("1")) <= 0) parsed = { kind: "percent_gross", rate: calculation.rate };
    else return fail("Withholding requires exact nonnegative USD cents or a fraction of gross wages between zero and one.");
    result.push({ id, version: WITHHOLDING_ADAPTER, incomeId: incomeId.toLowerCase(), ownerId: parameters.ownerId, employerId: parameters.employerId, depositAccountId: domainId("account", accountId.toLowerCase()), jurisdiction: parameters.jurisdiction,
      start, ...(end === undefined ? {} : { end }), provenance: parameters.provenance, userConfirmed: true, calculation: parsed });
  }
  for (let i = 0; i < result.length; i++) for (let j = i + 1; j < result.length; j++) {
    const a = result[i]!, b = result[j]!;
    if (a.incomeId !== b.incomeId) continue;
    if (a.depositAccountId !== b.depositAccountId) fail("One salary must retain one authorized receiving bank across its withholding elections.");
    if (a.jurisdiction === b.jurisdiction && a.start < (b.end ?? "9999-12-31") && b.start < (a.end ?? "9999-12-31")) fail("Overlapping withholding elections for the same Income and jurisdiction.");
  }
  return Object.freeze(result.sort((a, b) => a.id.localeCompare(b.id)));
};

/** Non-UI source authoring seam; portable JSON remains the single persisted input. */
export const authorPayrollWithholding = (model: PortableModelEnvelope, plan: PayrollWithholdingPlan): PortableModelEnvelope => {
  if (!UUID.test(plan.id) || !UUID.test(plan.incomeId) || !UUID.test(plan.depositAccountId)) fail("Withholding identities must be UUIDs.");
  const roots = objects(model, "Scenario").filter(item => item.enabled === true && item.base_scenario_id == null);
  if (roots.length !== 1) fail("Withholding requires one active root scenario.");
  const id = plan.id.toLowerCase();
  const prior = objects(model, "PrimitiveInstance").find(item => item.primitive_instance_id === id);
  if (prior && (!record(prior.parameters) || prior.parameters.adapter !== WITHHOLDING_ADAPTER || !record(prior.input_bindings) || prior.input_bindings.income_id !== plan.incomeId.toLowerCase())) fail("Withholding primitive identity collision.");
  const primitive: CanonicalObject = { primitive_instance_id: id, primitive_id: "P03", enabled: true, scenario_id: roots[0]!.scenario_id!, start_date: plan.effectiveDate,
    ...(plan.expirationDate === undefined ? {} : { end_date: plan.expirationDate }), input_bindings: { income_id: plan.incomeId.toLowerCase(), deposit_account_id: plan.depositAccountId.toLowerCase() },
    parameters: { adapter: WITHHOLDING_ADAPTER, ownerId: plan.ownerId, employerId: plan.employerId, jurisdiction: plan.jurisdiction, provenance: plan.provenance, userConfirmed: plan.userConfirmed, calculation: { ...plan.calculation } } };
  const next = { ...model, objects: { ...model.objects, PrimitiveInstance: [...objects(model, "PrimitiveInstance").filter(item => item.primitive_instance_id !== id), primitive] } };
  durablePayrollWithholding(next);
  return next;
};
