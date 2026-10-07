import { accountingTransactionId, createAccountingLeg, createAccountingTransaction, type AccountId, type PositionId, type AccountingLegDraft } from "../accounting/index.js";
import { failValidation, issueCodes } from "../diagnostics/index.js";
import { cloneAuthoritativeState, applyAccountingTransactionAtomically, type AuthoritativeState } from "../state/index.js";
import type { Instant } from "../time/index.js";
import { domainId, type DomainId } from "../identity/index.js";
import { calculationTraceId, calculationTraceRef } from "../lineage/index.js";
import { Money, Quantity, RoundingPolicy, decimal } from "../values/index.js";
import { decideContribution, recordContribution, employerContributionCandidate, type ContributionPolicy } from "./contributions.js";
import { contributionPolicyAt, projectedContributionDiagnostics } from "./contributionProjection.js";
import type { TaxCapabilityDiagnostic } from "./tax/contracts.js";

export interface PayrollContributionAllocation {
  readonly id: string;
  readonly priority: number;
  readonly accountId: AccountId;
  readonly positionId: PositionId;
  readonly policy: ContributionPolicy;
  readonly calculation: { readonly kind: "fixed"; readonly amount: Money } | { readonly kind: "percent"; readonly rate: string } | { readonly kind: "match"; readonly rate: string; readonly compensationCapRate: string };
  readonly vestedFraction: string;
}
const invalid = (message: string): never => failValidation({ severity: "error", code: issueCodes.ruleInputInvalid, message, entityType: "payroll_contribution" });
const percent = (rate: string) => {
  const value = decimal(rate);
  if (value.isNegative() || value.compare(decimal("1")) > 0) return invalid("Payroll percentage must be between zero and one");
  return value;
};

/** Gross recognition, employee allocation, and employer benefits share one isolated payroll candidate. */
export const payrollContributionCandidate = (opening: AuthoritativeState, input: {
  readonly id: string; readonly incomeId: string; readonly at: Instant; readonly gross: Money; readonly depositAccountId: AccountId;
  readonly allocations: readonly PayrollContributionAllocation[];
}) => {
  if (new Set(input.allocations.map(item => item.id)).size !== input.allocations.length || new Set(input.allocations.map(item => item.priority)).size !== input.allocations.length) return invalid("Payroll allocations require unique identities and explicit distinct priorities");
  const employees = input.allocations.filter(item => !item.policy.character.startsWith("employer_"));
  if (input.allocations.some(item => item.policy.character.startsWith("employer_") && employees.some(employee => employee.priority >= item.priority))) return invalid("Explicit employer priority must follow employee allocations used for matching and shared capacity");
  const rounding = RoundingPolicy.currency(input.gross.currency.minorUnitScale, "half_even");
  const quantityRounding = new RoundingPolicy(12, "half_even");
  let candidate = cloneAuthoritativeState(opening);
  let employee = Money.zero(input.gross.currency);
  const diagnostics: TaxCapabilityDiagnostic[] = [];
  const appliedRuleIds: DomainId<"tax-rule">[] = [];
  const matchedContributions = new Map<string, Money>();
  const matchKey = (allocation: PayrollContributionAllocation): string => allocation.policy.character.endsWith("_hsa") ? `hsa:${allocation.policy.personId}` : `${allocation.policy.personId}:${allocation.policy.limits.find(binding => binding.kind === "401k_additions")?.bucketKey}`;
  const employeeLegs: AccountingLegDraft[] = [];
  const employers: PayrollContributionAllocation[] = [];
  for (const allocation of [...input.allocations].sort((a, b) => a.priority - b.priority)) {
    if (allocation.policy.character === "employer_401k" || allocation.policy.character === "employer_hsa") { employers.push(allocation); continue; }
    if (!["traditional_401k", "roth_401k", "after_tax_401k", "employee_hsa"].includes(allocation.policy.character) || allocation.vestedFraction !== "1" || allocation.calculation.kind === "match") return invalid("Unsupported employee payroll contribution or vesting");
    const requested = allocation.calculation.kind === "fixed" ? allocation.calculation.amount : input.gross.times(percent(allocation.calculation.rate)).round(rounding);
    const decision = decideContribution(candidate, allocation.policy, allocation.accountId, input.at, requested);
    if (decision.incompleteFacts) { diagnostics.push(...projectedContributionDiagnostics(allocation.policy, input.at)); continue; }
    appliedRuleIds.push(...decision.buckets.flatMap(bucket => [bucket.ruleId, ...(typeof bucket.facts.baseRuleId === "string" ? [domainId("tax-rule", bucket.facts.baseRuleId)] : [])]));
    if (requested.isPositive() && decision.accepted.isZero() && allocation.policy.excessPolicy === "reject") return invalid("Employee payroll contribution exceeds statutory capacity");
    if (decision.accepted.isZero()) continue;
    employee = employee.plus(decision.accepted);
    if (employee.compare(input.gross) > 0) return invalid("Employee contributions exceed gross payroll cash compensation");
    const position = candidate.positions[allocation.positionId];
    if (!position || position.accountId !== allocation.accountId || !position.price.isPositive()) return invalid("Payroll destination requires an executable positive-price position");
    const quantity = new Quantity(decision.accepted.amount.dividedBy(position.price.amount, quantityRounding), position.quantity.unit);
    if (!position.price.times(quantity.amount).round(rounding).equals(decision.accepted)) return invalid("Payroll units do not reconcile to principal");
    employeeLegs.push({ type: "asset", posting: "debit", entityId: allocation.positionId, amount: decision.accepted, quantity });
    candidate = recordContribution(candidate, allocation.policy, allocation.accountId, `${input.id}:${allocation.id}`, input.at, decision, input.incomeId);
    if (allocation.policy.character === "traditional_401k" || allocation.policy.character === "roth_401k" || allocation.policy.character === "employee_hsa") matchedContributions.set(matchKey(allocation), (matchedContributions.get(matchKey(allocation)) ?? Money.zero(input.gross.currency)).plus(decision.accepted));
  }
  const net = input.gross.minus(employee);
  const payrollRuleIds = input.allocations.some(allocation => contributionPolicyAt(allocation.policy, input.at).facts.lawProjection === "projected_current_law") ? appliedRuleIds : input.allocations.flatMap(allocation => allocation.policy.limits.map(binding => domainId("tax-rule", binding.ruleId)));
  const transaction = createAccountingTransaction({ id: accountingTransactionId(input.id), date: input.at, type: "payroll_income", traceRefs: [calculationTraceRef(calculationTraceId(`payroll:${input.id}:gross:${input.incomeId}`), payrollRuleIds)], legs: [
    ...employeeLegs,
    ...(net.isPositive() ? [{ type: "cash" as const, posting: "debit" as const, amount: net, accountId: input.depositAccountId, cashFlowClass: "operating" as const }] : []),
    { type: "income" as const, posting: "credit" as const, amount: input.gross },
  ].map(createAccountingLeg) });
  applyAccountingTransactionAtomically(candidate, transaction);
  const transactions = [transaction];
  for (const allocation of employers) {
    const calculation = allocation.calculation;
    const elective = matchedContributions.get(matchKey(allocation)) ?? Money.zero(input.gross.currency);
    const eligible = calculation.kind === "match" ? input.gross.times(percent(calculation.compensationCapRate)).round(rounding) : input.gross;
    const matched = elective.compare(eligible) < 0 ? elective : eligible;
    const requested = calculation.kind === "fixed" ? calculation.amount : (calculation.kind === "match" ? matched : input.gross).times(percent(calculation.rate)).round(rounding);
    if (!requested.isPositive()) continue;
    const decision = decideContribution(candidate, allocation.policy, allocation.accountId, input.at, requested);
    if (decision.incompleteFacts) { diagnostics.push(...projectedContributionDiagnostics(allocation.policy, input.at)); continue; }
    if (decision.accepted.isZero() && allocation.policy.excessPolicy === "auto_cap") continue;
    const posted = employerContributionCandidate(candidate, { id: `${input.id}:${allocation.id}`, at: input.at, accountId: allocation.accountId, positionId: allocation.positionId, requested, vestedFraction: allocation.vestedFraction, policy: allocation.policy, quantityRounding });
    candidate = posted.state; transactions.push(posted.transaction);
  }
  return { state: candidate, transactions: Object.freeze(transactions), gross: input.gross, employeeContributions: employee, takeHomeCash: net, diagnostics: Object.freeze(diagnostics) };
};
