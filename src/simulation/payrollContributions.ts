import { accountingTransactionId, createAccountingLeg, createAccountingTransaction, type AccountId, type PositionId, type AccountingLegDraft } from "../accounting/index.js";
import { failValidation, issueCodes } from "../diagnostics/index.js";
import { cloneAuthoritativeState, applyAccountingTransactionAtomically, applyPayrollHealthTransactionAtomically, qualifyPayrollHealthSource,
  payrollHealthPostingEvidence, type AuthoritativeState, type PayrollHealthSourceBinding, type D2SettlementSourceContext } from "../state/index.js";
import type { Instant } from "../time/index.js";
import { domainId, type DomainId } from "../identity/index.js";
import { calculationTraceId, calculationTraceRef } from "../lineage/index.js";
import { Money, Quantity, RoundingPolicy, Unit, money, decimal } from "../values/index.js";
import { decideContribution, recordContribution, employerContributionCandidate, type ContributionPolicy } from "./contributions.js";
import { contributionPolicyAt, projectedContributionDiagnostics } from "./contributionProjection.js";
import { taxBalanceIds, type TaxCapabilityDiagnostic, type PayrollWithholdingElection, type PayrollWithholdingEvidence } from "./tax/contracts.js";
import { canonicalSerialize } from "./run.js";

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
  readonly ownerId?: string;
  readonly occurrenceId?: string;
  readonly withholding?: readonly PayrollWithholdingElection[];
  readonly taxCreditAccountId?: AccountId;
  readonly healthPremium?: { readonly source: PayrollHealthSourceBinding; readonly context: D2SettlementSourceContext };
}) => {
  const healthQualification = input.healthPremium === undefined ? undefined : qualifyPayrollHealthSource(input.healthPremium.source, input.healthPremium.context);
  if (healthQualification?.status === "incomplete") return invalid(`Payroll health source incomplete: ${healthQualification.reason}`);
  const health = healthQualification?.deduction;
  if (health !== undefined && (canonicalSerialize(health.source) !== canonicalSerialize(input.healthPremium!.source) ||
      health.source.transactionId !== input.id || health.source.incomeId !== input.incomeId || health.source.ownerId !== input.ownerId ||
      health.source.occurrenceId !== input.occurrenceId || health.source.bankAccountId !== input.depositAccountId ||
      health.at !== input.at || !health.gross.equals(input.gross))) return invalid("Payroll health must bind the exact original wage occurrence");
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
  const executedEmployeeContributions: { id: string; character: string; amount: Money }[] = [];
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
    if (health !== undefined) executedEmployeeContributions.push({ id: `${input.id}:${allocation.id}`, character: allocation.policy.character, amount: decision.accepted });
    if (allocation.policy.character === "traditional_401k" || allocation.policy.character === "roth_401k" || allocation.policy.character === "employee_hsa") matchedContributions.set(matchKey(allocation), (matchedContributions.get(matchKey(allocation)) ?? Money.zero(input.gross.currency)).plus(decision.accepted));
  }
  const elections = (input.withholding ?? []).filter(item => item.start <= input.at && (item.end === undefined || input.at < item.end));
  const creditUnit = Unit.of("usd_tax_credit");
  const bank = candidate.accounts[input.depositAccountId];
  if (elections.length && (!input.ownerId || !input.occurrenceId || !bank || bank.ownerId !== input.ownerId || !["cash", "checking", "savings"].includes(bank.kind) || input.gross.currency.code !== "USD")) return invalid("Withholding requires a source-owned USD receiving bank and occurrence identity");
  if (new Set(elections.map(item => item.jurisdiction)).size !== elections.length) return invalid("Conflicting active withholding elections");
  const creditAccountId = input.taxCreditAccountId ?? input.depositAccountId;
  if (elections.length && (!candidate.accounts[creditAccountId] || input.taxCreditAccountId === undefined && Object.values(candidate.accounts).filter(account => ["cash", "checking", "savings"].includes(account.kind)).length > 1)) return invalid("Multiple receiving banks require the shared tax credit account binding");
  const credits = elections.map(election => {
    if (election.version !== "payroll-withholding/v1" || election.userConfirmed !== true || !election.provenance.trim() || !election.employerId.trim() || election.incomeId !== input.incomeId || election.ownerId !== input.ownerId || election.depositAccountId !== input.depositAccountId || election.end !== undefined && election.end <= election.start) return invalid("Withholding must bind the exact salary source, owner, bank and effective interval");
    const amount = election.calculation.kind === "fixed" ? election.calculation.amount : input.gross.times(percent(election.calculation.rate)).round(rounding);
    if (amount.isNegative() || amount.currency.code !== "USD" || !amount.amount.fitsScale(2)) return invalid("Withholding requires posted nonnegative USD cents");
    const year = input.at.slice(0, 4);
    const traceRefs = [calculationTraceRef(calculationTraceId(`payroll:withholding:${election.id}:income:${input.incomeId}:owner:${election.ownerId}:employer:${election.employerId}:occurrence:${input.occurrenceId}:year:${year}:jurisdiction:${election.jurisdiction}:provenance:${election.provenance}`))];
    return { electionId: election.id, jurisdiction: election.jurisdiction, taxYear: year, amount, traceRefs };
  });
  if (new Set(elections.map(item => item.employerId)).size > 1) return invalid("A paycheck cannot mix employer identities");
  const withheld = credits.reduce((sum, credit) => sum.plus(credit.amount), Money.zero(input.gross.currency));
  const healthExpense = health?.employeeAmount ?? Money.zero(input.gross.currency);
  const net = input.gross.minus(employee).minus(withheld).minus(healthExpense);
  if (net.isNegative()) return invalid("Withholding and employee deductions exceed available gross payroll cash compensation");
  if (health !== undefined) {
    const sort = <T extends { readonly id: string }>(items: readonly T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id));
    if (elections.some(e => e.employerId !== health.source.employerId) ||
        canonicalSerialize(sort(executedEmployeeContributions)) !== canonicalSerialize(sort(health.contributions)) ||
        canonicalSerialize(credits.map(({ electionId, jurisdiction, amount }) => ({ electionId, jurisdiction, amount }))) !== canonicalSerialize(health.withholding))
      return invalid("Payroll health complete contribution/withholding inventory differs from executed paycheck");
  }
  const withholdingLegs: AccountingLegDraft[] = [];
  for (const credit of credits) {
    const { creditPositionId } = taxBalanceIds(credit.jurisdiction, credit.taxYear);
    const existing = candidate.positions[creditPositionId];
    if (existing && (existing.accountId !== creditAccountId || !existing.quantity.unit.equals(creditUnit) || !existing.price.equals(money("1")))) return invalid("Invalid shared paid-tax credit position");
    candidate.positions[creditPositionId] ??= { id: creditPositionId, accountId: creditAccountId, quantity: Quantity.parse("0", creditUnit), price: money("1"), carryingValue: money("0") };
    if (credit.amount.isPositive()) withholdingLegs.push({ type: "asset", posting: "debit", entityId: creditPositionId, amount: credit.amount, quantity: Quantity.parse(credit.amount.amount.toString(), creditUnit) });
  }
  const payrollRuleIds = input.allocations.some(allocation => contributionPolicyAt(allocation.policy, input.at).facts.lawProjection === "projected_current_law") ? appliedRuleIds : input.allocations.flatMap(allocation => allocation.policy.limits.map(binding => domainId("tax-rule", binding.ruleId)));
  const transaction = createAccountingTransaction({ id: accountingTransactionId(input.id), date: input.at, type: "payroll_income", traceRefs: [calculationTraceRef(calculationTraceId(`payroll:${input.id}:gross:${input.incomeId}`), payrollRuleIds), ...credits.flatMap(credit => credit.traceRefs)], legs: [
    ...employeeLegs,
    ...withholdingLegs,
    ...(healthExpense.isPositive() ? [{ type: "expense" as const, posting: "debit" as const, entityId: health!.expenseId, amount: healthExpense }] : []),
    ...(net.isPositive() ? [{ type: "cash" as const, posting: "debit" as const, amount: net, accountId: input.depositAccountId, cashFlowClass: "operating" as const }] : []),
    { type: "income" as const, posting: "credit" as const, amount: input.gross },
  ].map(createAccountingLeg) });
  if (health === undefined) applyAccountingTransactionAtomically(candidate, transaction);
  else applyPayrollHealthTransactionAtomically(candidate, transaction, health, input.healthPremium!.context);
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
  const withholdingEvidence: PayrollWithholdingEvidence | undefined = elections.length === 0 && health === undefined ? undefined : {
    ...(health === undefined ? {} : { healthDeduction: payrollHealthPostingEvidence(candidate, transaction.id, input.healthPremium!.context)! }),
    incomeId: input.incomeId, ownerId: input.ownerId!, employerId: health?.source.employerId ?? elections[0]!.employerId, at: input.at, occurrenceId: input.occurrenceId!, transactionId: transaction.id,
    gross: input.gross, employeeContributions: employee, takeHomeCash: net, depositAccountId: input.depositAccountId, credits: Object.freeze(credits),
  };
  return { state: candidate, transactions: Object.freeze(transactions), gross: input.gross, employeeContributions: employee, takeHomeCash: net, diagnostics: Object.freeze(diagnostics), withholdingEvidence };
};
