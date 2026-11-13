import { compileCashFlow, type RetirementTerminationBinding } from "../../src/application/compiler/cashFlow.js";
import { addPersonalObject, createEmptyPersonalDraft } from "../../src/application/personalMvp.js";
import { authorPayrollWithholding, type PayrollWithholdingPlan } from "../../src/application/compiler/payrollWithholding.js";
import type { RunContext } from "../../src/simulation/run.js";
import type { VerticalSlice2Input } from "../../src/simulation/verticalSlice2.js";

export function compileModeledIncomeFixture(context: RunContext, months: number, fixture: {
  readonly householdId: string;
  readonly personId: string;
  readonly accountId: string;
  readonly accountType: "cash" | "checking" | "savings";
  readonly additionalBank?: { readonly personId: string; readonly accountId: string };
  readonly withholding?: readonly PayrollWithholdingPlan[];
  readonly retirementBindings?: readonly RetirementTerminationBinding[];
  readonly incomes: readonly {
    readonly id: string;
    readonly type: "salary" | "pension";
    readonly amount: string;
    readonly startDate: string;
    readonly personId?: string;
    readonly employer?: string;
    readonly endDate?: string;
    readonly jobChangeEventId?: string;
    readonly growth?: {
      readonly primitiveId: string;
      readonly assumptionId: string;
      readonly value: string;
      readonly unit: "effective annual rate" | "monthly periodic rate";
    };
  }[];
}): VerticalSlice2Input {
  let model = createEmptyPersonalDraft("87200000-0000-4000-8000-000000000001");
  model = addPersonalObject(model, "Household", fixture.householdId, {
    name: "Synthetic household", household_type: "individual", formation_date: "1900-01-01",
    members: [fixture.personId, ...(fixture.additionalBank === undefined ? [] : [fixture.additionalBank.personId])],
    primary_jurisdiction: "US-NY",
  });
  model = addPersonalObject(model, "Person", fixture.personId, {
    first_name: "Synthetic", last_name: "Member", date_of_birth: "1980-01-01",
    household_id: fixture.householdId, residence_jurisdiction: "US-NY",
  });
  model = addPersonalObject(model, "Account", fixture.accountId, {
    name: "Synthetic bank account", account_type: fixture.accountType, owner_id: fixture.personId,
    opening_date: "1900-01-01", opening_balance: "0",
  });
  if (fixture.additionalBank !== undefined) {
    const { personId, accountId } = fixture.additionalBank;
    model = addPersonalObject(model, "Person", personId, {
      first_name: "Synthetic", last_name: "Second member", date_of_birth: "1980-01-01",
      household_id: fixture.householdId, residence_jurisdiction: "US-NY",
    });
    model = addPersonalObject(model, "Account", accountId, {
      name: "Synthetic second bank account", account_type: "checking", owner_id: personId,
      opening_date: "1900-01-01", opening_balance: "0",
    });
  }
  for (const income of fixture.incomes) {
    if (income.jobChangeEventId !== undefined) {
      model = { ...model, objects: { ...model.objects, Event: [...(model.objects.Event ?? []), {
        event_id: income.jobChangeEventId, name: "Synthetic job change", event_type: "job_change",
        trigger_type: "scheduled", start_date: income.startDate, scenario_id: context.scenarioId,
        effect_ids: [], dependencies: [], precedence: 0, enabled: true,
      }] } };
    }
    if (income.growth !== undefined) {
      const { primitiveId, assumptionId, value, unit } = income.growth;
      model = addPersonalObject(model, "Assumption", assumptionId, {
        name: "Synthetic salary growth", category: "salary_growth", value, unit, source: "user", scenario_id: context.scenarioId,
      });
      model = { ...model, objects: { ...model.objects, PrimitiveInstance: [...(model.objects.PrimitiveInstance ?? []), {
        primitive_instance_id: primitiveId, primitive_id: "P08", input_bindings: { rate: assumptionId },
        parameters: {}, scenario_id: context.scenarioId, enabled: true,
      }] } };
    }
    model = addPersonalObject(model, "Income", income.id, {
      owner_id: income.personId ?? fixture.personId, income_type: income.type, source: income.employer ?? "Synthetic income original",
      amount: income.amount, frequency: "monthly", start_date: income.startDate, gross_or_net: "gross",
      ...(income.endDate === undefined ? {} : { end_date: income.endDate }),
      ...(income.jobChangeEventId === undefined ? {} : { related_event_id: income.jobChangeEventId }),
      ...(income.growth === undefined ? {} : { growth_model_id: income.growth.primitiveId }),
    });
  }
  const simulationStart = context.simulationStart.slice(0, 10);
  const simulationEnd = context.simulationEnd.slice(0, 10);
  model = addPersonalObject(model, "Scenario", context.scenarioId, {
    name: "Synthetic forecast", start_date: simulationStart, end_date: simulationEnd,
    timestep: "monthly", enabled: true, stochastic: false, simulation_count: 1,
    assumption_ids: fixture.incomes.flatMap(income => income.growth === undefined ? [] : [income.growth.assumptionId]),
    event_ids: fixture.incomes.flatMap(income => income.jobChangeEventId === undefined ? [] : [income.jobChangeEventId]),
  });
  for (const plan of fixture.withholding ?? []) model = authorPayrollWithholding(model, plan);
  const result = compileCashFlow(model, {
    runContext: context, scenarioId: context.scenarioId, baseCurrency: "USD", asOf: context.asOf.slice(0, 10),
    simulationStart, simulationEnd, months, executionAccountId: fixture.accountId,
    sameInstantCashFlowOrder: "income_before_expense",
    ...(fixture.retirementBindings === undefined ? {} : { retirementBindings: fixture.retirementBindings }),
  });
  if (result.status !== "compiled") throw new Error(JSON.stringify(result.diagnostics));
  return result.value.input;
}
