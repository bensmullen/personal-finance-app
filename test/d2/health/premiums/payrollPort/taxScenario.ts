import { createHouseholdTaxParticipant, taxBalanceIds } from "../../../../../src/simulation/tax/participant.js";
import { payrollContributionCandidate } from "../../../../../src/simulation/payrollContributions.js";
import type { PayrollWithholdingEvidence } from "../../../../../src/simulation/tax/contracts.js";
import { SummaryOperationSink } from "../../../../../src/simulation/r3/summarySink.js";
import { createPrimitiveRuntimeStateStore } from "../../../../../src/simulation/period.js";
import { instant, utcMonthlyPeriods } from "../../../../../src/time/index.js";
import { money, Ratio, USD } from "../../../../../src/values/index.js";
import { taxHouseholdFixture } from "../../../../fixtures/t1aTaxHouseholds.js";
import { taxRule } from "../../../../fixtures/t1aTaxRules.js";
import { paycheckFixture, wageBase, ids } from "./scenario.js";

export function healthTaxFixture(key = "tax") {
  const regimes = ["US:FEDERAL", "US:NY", "US:NY:NYC"];
  const federal = taxRule(1, { jurisdiction: regimes[0]!, income: { ...taxRule().income!, standardDeduction: money("0") },
    payroll: [{ key: "synthetic-payroll", rate: Ratio.parse("0.1"), basis: "per_employee", threshold: money("0") }] });
  const state = taxRule(2, { jurisdiction: regimes[1]!, income: { ...federal.income! } });
  const local = taxRule(3, { jurisdiction: regimes[2]!, income: { ...federal.income! } });
  const bases = [wageBase(regimes[0]!, "income", String(federal.id)), wageBase(regimes[0]!, "payroll", String(federal.id), "100"),
    wageBase(regimes[1]!, "income", String(state.id), "0"), wageBase(regimes[2]!, "income", String(local.id), "75")];
  const paycheck = paycheckFixture(key, { bases, jurisdictions: regimes });
  const fixture = taxHouseholdFixture({ input: { catalog: [federal, state, local], payrollWithholding: paycheck.input.withholding,
    incomes: [{ id: ids.income, ownerId: ids.person, employerId: "synthetic-job-A", incomeType: "salary", taxCharacter: "ordinary", grossOrNet: "gross", start: "2024-01-01",
      residence: [{ state_jurisdiction: "US:NY", local_jurisdiction: "US:NY:NYC", effective_date: "2024-01-01" }],
      work: [{ state_jurisdiction: "US:NY", local_jurisdiction: "US:NY:NYC", allocation: "1", effective_date: "2024-01-01" }], eligibility: [] }],
    settlements: regimes.map((jurisdiction, priority) => ({ id: `final:${jurisdiction}`, jurisdiction, taxYear: "2024", at: instant("2024-12-31T23:59:59.999Z"), priority })) } });
  const execute = (receiptTransform: (r: PayrollWithholdingEvidence) => readonly PayrollWithholdingEvidence[] = r => [r]) => {
    const paid = payrollContributionCandidate(paycheck.opening, paycheck.input);
    const participant = createHouseholdTaxParticipant(fixture.input);
    const runtime = participant.observe!({ id: `income:${ids.income}:${paycheck.input.at}`, domain: "cash_flow", operationClass: "cash_income_settlement",
      sequencingInstant: paycheck.input.at, dependsOn: [], resourceAccesses: [], traceRefs: [] }, { summary: { evidence: new SummaryOperationSink(USD).snapshot(), cash: {
      recurringIncomeRecognized: money("1000"), recurringExpenseRecognized: money("0"), expenseCashSettlement: money("0"), outstandingExpenseObligations: money("0"),
      constraintOutcomes: [], liquidityShortfalls: [], diagnostics: [], payrollWithholding: receiptTransform(paid.withholdingEvidence!),
    } } }, {});
    const opening = { state: paid.state, primitiveState: createPrimitiveRuntimeStateStore(), runtime };
    const prepared = participant.prepare(fixture.context, utcMonthlyPeriods(fixture.context.simulationStart, 1)[0]!, opening);
    const result = prepared.operations[0]!.execute(opening, new Map());
    return { paid, result, total: (jurisdiction: string) => {
      const id = taxBalanceIds(jurisdiction, "2024").liabilityId;
      return result.state.liabilities[id]?.balance ?? money("0");
    } };
  };
  return { ...paycheck, ...fixture, bases, execute };
}
