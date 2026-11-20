import { domainId } from "../../../../../src/identity/index.js";
import { attachAftertaxPremiums } from "../../../../../src/simulation/d2/integration/aftertaxPremiums/index.js";
import { attachCardBank } from "../../../../../src/simulation/d2/integration/cardBank/index.js";
import { attachFsaCash } from "../../../../../src/simulation/d2/integration/fsaCash/index.js";
import { attachHelocServicing } from "../../../../../src/simulation/d2/integration/helocServicing/index.js";
import { attachMedicareBank } from "../../../../../src/simulation/d2/integration/medicareBank/index.js";
import { attachRetirementCash } from "../../../../../src/simulation/d2/integration/retirementCash/index.js";
import { attachSsaMedicare } from "../../../../../src/simulation/d2/integration/ssaMedicare/index.js";
import { applyHouseholdExecutionOverlay, compileHouseholdKernel, type ExecutableHouseholdProjection } from "../../../../../src/simulation/householdExecution.js";
import { createPrimitiveRuntimeStateStore } from "../../../../../src/simulation/period.js";
import { createAuthoritativeState } from "../../../../../src/state/index.js";
import { civilDate, utcMonthlyPeriods } from "../../../../../src/time/index.js";
import { money, USD } from "../../../../../src/values/index.js";
import { bankFault, context, ids, installBank, openingMonth, start } from "./bank.js";
import { installBenefits, meterBenefitDomain, publishBenefit, resetBenefits } from "./benefits.js";
import { installCashSources, publishCashSources } from "./cashSources.js";
import { installHealthAndRetirement, publishPremium, publishRetirement, publishStandaloneMedicare, resetHealthFaults } from "./healthAndRetirement.js";
import { installWages, payrollCredit, publishWages } from "./wages.js";

export function installPublishers(): void {
  installBank();
  installWages();
  installBenefits();
  installHealthAndRetirement();
  installCashSources();
}

export function household(count: number, opts: { reverse?: boolean; overlap?: boolean } = {}) {
  delete bankFault.route; delete bankFault.mode; delete bankFault.at;
  resetHealthFaults();
  resetBenefits();
  const runContext = context(count + 1);
  const periods = utcMonthlyPeriods(openingMonth, count + 2);
  const sources = publishCashSources(count);
  const ssa = utcMonthlyPeriods(start, count).map(period => publishBenefit(period.start.slice(0, 7), runContext.dataCutoff));
  meterBenefitDomain();
  const incomes = publishWages(count, opts.overlap);
  const medicare = publishStandaloneMedicare();
  const premium = publishPremium(opts.overlap);
  const retirement = publishRetirement(sources.cash[0]!.retirementBefore, { start: openingMonth, end: runContext.simulationEnd });
  const opening = createAuthoritativeState({ accounts: {
    [ids.bank]: { id: ids.bank, kind: "checking", ownerId: ids.household, cash: money("10000") },
    [ids.personBank]: { id: ids.personBank, kind: "checking", ownerId: ids.bob, cash: money("500") },
    [ids.ira]: { id: ids.ira, kind: "retirement", ownerId: ids.alice, cash: money("1000") },
  }, liabilities: {
    [ids.helocPrincipal]: { id: ids.helocPrincipal, balance: money("1000") },
    ...Object.fromEntries([ids.helocCharges, ids.expensePayable, ...sources.loans.map(loan => loan.interestPayableLiabilityId),
      medicare.confirmed[0]!.payable.liabilityId, premium.confirmed[0]!.payable.liabilityId].map(id => [id, { id, balance: money("0") }])),
    ...Object.fromEntries(sources.loans.map(loan => [loan.principalLiabilityId, { id: loan.principalLiabilityId, balance: loan.originalPrincipal }])),
    ...Object.fromEntries(sources.cards.map(({ payment }) => {
      const id = domainId("liability", payment.cardAccountId);
      return [id, { id, balance: money("1000") }];
    })),
  } });
  const compiled: ExecutableHouseholdProjection = { reconciledOpeningState: opening,
    reconciledPrimitiveState: createPrimitiveRuntimeStateStore(), scenarioIdentity: runContext.scenarioId,
    executionMonths: periods.length, scenarioBindings: { witness: "synthetic S8-5A household", members: [ids.alice, ids.bob] },
    nonInvestmentPositionIds: [payrollCredit],
    cashFlowInput: { householdId: ids.household, ownerId: ids.alice, baseCurrency: USD, cashAccountId: ids.bank,
      expensePayableLiabilityId: ids.expensePayable, incomes, expenses: [], events: [] },
    liabilityInput: { householdId: ids.household, ownerId: ids.alice, baseCurrency: USD, loans: sources.loans },
  };
  const base = compileHouseholdKernel(compiled, openingMonth);
  const cmsAttachment = attachMedicareBank({ kernel: base, request: medicare.request, confirmed: medicare.confirmed,
    asOf: civilDate(runContext.asOf.slice(0, 10)), representations: [] });
  if (cmsAttachment.netCashCoverage !== "complete") throw new Error(JSON.stringify(cmsAttachment.diagnostics));
  const premiumAttachment = attachAftertaxPremiums({ kernel: cmsAttachment.kernel, request: premium.request,
    confirmed: premium.confirmed, runContext, asOf: civilDate(runContext.asOf.slice(0, 10)), representations: [] });
  if (premiumAttachment.admittedOperationIds.length !== 1) throw new Error(JSON.stringify(premiumAttachment.diagnostics));
  const order = <T>(items: readonly T[]) => opts.reverse ? [...items].reverse() : items;
  const benefits = attachSsaMedicare(premiumAttachment.kernel, { householdId: ids.household, personId: ids.bob,
    memberIds: order([ids.alice, ids.bob]), payments: [], nativePayments: order(ssa) });
  const cash = attachHelocServicing(attachCardBank(attachFsaCash(benefits, { sources: order(sources.fsaReferences) }),
    { sourceIds: order(sources.cardSourceIds) }), { sourceIds: order(sources.helocSourceIds) });
  const attached = attachRetirementCash(cash, retirement);
  const kernel = opts.reverse ? applyHouseholdExecutionOverlay(attached.kernel, {
    participants: [...attached.kernel.executable.participants!].reverse(),
  }) : attached.kernel;
  return { kernel, runContext, periods, opening, sources, medicare, premium, retirement, ssa, compiled };
}
