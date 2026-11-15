import { beforeAll, describe, expect, it } from "vitest";
import { accountingTransactionId, createAccountingLeg, createAccountingTransaction, type AccountingLegDraft } from "../../../../src/accounting/index.js";
import { domainId, generatedOccurrenceKey } from "../../../../src/identity/index.js";
import { calculationTraceId, calculationTraceRef, freezeTraceRefs } from "../../../../src/lineage/index.js";
import { canonicalSerialize, createInputFingerprint, createRunContext, runId, scenarioId } from "../../../../src/simulation/run.js";
import { createPrimitiveRuntimeStateStore } from "../../../../src/simulation/period.js";
import { compileHouseholdKernel, replayHouseholdForecastWindow, runCompiledHouseholdProjection, runHouseholdForecastSummary } from "../../../../src/simulation/householdExecution.js";
import { runCompiledHouseholdProjection as runReference } from "../../../../src/simulation/r3/referenceHouseholdExecution.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { applyHouseholdExecutionOverlay } from "../../../../src/simulation/r3/compiledHousehold.js";
import { SummaryOperationSink } from "../../../../src/simulation/r3/summarySink.js";
import { registerHouseholdBankOriginalProvider } from "../../../../src/simulation/d2/integration/householdBank/index.js";
import { aftertaxPremiumOriginalDigest, attachAftertaxPremiums, registerAftertaxPremiumSourcePort, type AftertaxPremiumOriginal } from "../../../../src/simulation/d2/integration/aftertaxPremiums/index.js";
import { proposePremiums } from "../../../../src/simulation/d2/health/premiums/index.js";
import { registerHouseholdPayrollHealthProvider, type HouseholdPayrollHealthOriginal } from "../../../../src/simulation/d2/health/premiums/payrollBinding/index.js";
import { householdWageOriginalDigest, registerHouseholdWageOriginalProvider, type HouseholdWageOriginal } from "../../../../src/simulation/d2/integration/householdWages/index.js";
import { payrollContributionCandidate, type PayrollContributionAllocation } from "../../../../src/simulation/payrollContributions.js";
import { contributionCharacters, type D1CapacityKind } from "../../../../src/rules/contribution2026.js";
import { stableContributionRuleId } from "../../../../src/application/compiler/contributionAuthoring.js";
import { taxBalanceIds, type PayrollWithholdingElection } from "../../../../src/simulation/tax/contracts.js";
import { createHouseholdTaxParticipant } from "../../../../src/simulation/tax/participant.js";
import { createFundingPolicy, fundingPolicyId } from "../../../../src/funding/index.js";
import { attachFsaCash, registerFsaCashSourceProvider, type FsaCashSource } from "../../../../src/simulation/d2/integration/fsaCash/index.js";
import { depositOperationId, originalOperationId, originalTransaction, qualifyFsaCashSource } from "../../../../src/simulation/d2/integration/fsaCash/source.js";
import { admitS4OpeningSources, applyD2SettlementAtomically, createAuthoritativeState, householdPayrollHealthPostingEvidence, type HouseholdBankEventContext } from "../../../../src/state/index.js";
import { civilDate, instant } from "../../../../src/time/index.js";
import { Money, money, Quantity, Rate, rateConvention, Ratio, SHARE, Unit, USD } from "../../../../src/values/index.js";
import { coverage, payroll, scenario, household, person, bank, source as premiumEvidence } from "../../health/premiums/payrollBinding/fixtures.js";
import { fixture as fsaFixture, ids as fsaIds, input as fsaInput, legacyParticipant, source as fsaSource } from "../fsaCash/scenario.js";
import { confirmation as aftertaxConfirmation } from "../householdBankCardAftertax/scenario.js";
import { taxRule } from "../../../fixtures/t1aTaxRules.js";
import { employerWage } from "../../../fixtures/employerWage.js";

const expenseId = domainId("expense", "27900000-0000-4000-8000-000000000001");
const primitive = domainId("primitive-instance", "27900000-0000-4000-8000-000000000002");
const growth = domainId("primitive-instance", "27900000-0000-4000-8000-000000000006");
const payable = domainId("liability", "27900000-0000-4000-8000-000000000007");
const payday = instant("2026-01-15T17:00:00.000Z");
const healthRef = { version: "household-payroll-health-source/v1", publisherId: "health-archive", sourceId: `original:A:${payday}` } as const;
const bankRef = { publisherId: "s4-bank", sourceId: "bank-control" } as const;
const healthPeriod = { start: instant("2026-01-01T00:00:00.000Z"), end: instant("2026-02-01T00:00:00.000Z") };
const cutoff = instant("2025-12-31T00:00:00.000Z");
const context = createRunContext({
  asOf: cutoff, dataCutoff: cutoff, runId: runId("27900000-0000-4000-8000-000000000003"),
  scenarioId: scenarioId("27900000-0000-4000-8000-000000000004"),
  simulationStart: healthPeriod.start, simulationEnd: healthPeriod.end, baseCurrency: USD,
});
const amended = instant("2026-01-20T00:00:00.000Z");
let health: HouseholdPayrollHealthOriginal | undefined;
let wage: HouseholdWageOriginal | undefined;
let fsa: FsaCashSource | undefined;
let premium: AftertaxPremiumOriginal | undefined;
let healthReads = 0;
let withdrawOnRead = Number.POSITIVE_INFINITY;
let amendedHealth = false;

beforeAll(() => {
  registerHouseholdBankOriginalProvider({ publisherId: bankRef.publisherId, readOriginals: query => {
    const event = query.context;
    const base = { revisionId: "1", publishedAt: instant("2023-01-01T00:00:00.000Z"),
      knownAt: instant("2023-01-01T00:00:00.000Z"), effectiveFrom: instant("2023-01-01T00:00:00.000Z"),
      effectiveUntil: instant("2035-01-01T00:00:00.000Z"), status: "active" as const };
    if (query.sourceId !== bankRef.sourceId ||
        !((event.householdId === household && event.bankAccountId === bank && event.personId === person) ||
          (event.householdId === fsaIds.household && event.bankAccountId === fsaIds.bank && event.personId === fsaIds.person)))
      return undefined;
    return { version: "household-bank-original-inventory/v1", publisherId: bankRef.publisherId, query,
      checkedAt: event.asOf, completeThrough: event.dataCutoff, completeness: "complete", originals: [
        { ...base, kind: "account", sourceId: "deed", bankAccountId: event.bankAccountId,
          accountKind: "checking", owner: { kind: "household", id: event.householdId } },
        { ...base, kind: "household", sourceId: "household", householdId: event.householdId },
        { ...base, kind: "membership", sourceId: "membership", householdId: event.householdId, personId: event.personId },
        { ...base, kind: "permission", sourceId: "permission", householdId: event.householdId,
          personId: event.personId, bankAccountId: event.bankAccountId, direction: event.direction },
      ] };
  } });
  registerHouseholdWageOriginalProvider({ publisherId: "s4-wages", readOriginals: query => {
    if (!wage || query.sourceId !== wage.sourceId) return undefined;
    return { version: "household-wage-inventory/v1", publisherId: "s4-wages", sourceId: query.sourceId,
      context: query.context, checkedAt: query.context.asOf, completeThrough: query.context.dataCutoff,
      completeness: "complete", originals: [wage] };
  } });
  registerHouseholdPayrollHealthProvider({ publisherId: healthRef.publisherId, readActiveOriginal: query => {
    if (!health || query.sourceId !== health.payroll.source.sourceId || ++healthReads >= withdrawOnRead) return undefined;
    return { context: query.context, completeThrough: query.context.dataCutoff,
      original: amendedHealth && query.context.dataCutoff >= amended ? { ...health, revisionId: "2" } : health };
  } });
  registerFsaCashSourceProvider({ lookup: id => fsa?.sourceId === id ? fsa : undefined }, "s4-fsa");
  registerAftertaxPremiumSourcePort({ publisherId: "s4-aftertax", readOriginal: ref =>
    ref.sourceId === premium?.original.witness.original.sourceId ? premium : undefined });
});

function contribution(priority: number, character: "traditional_401k" | "employee_hsa", amount: string,
  limits: readonly D1CapacityKind[]): PayrollContributionAllocation {
  const id = (n: number) => `27900000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return { id: id(priority), priority, accountId: domainId("account", id(priority + 100)),
    positionId: domainId("position", id(priority + 200)), vestedFraction: "1",
    calculation: { kind: "fixed", amount: money(amount) }, policy: {
      personId: person, householdId: household, character, excessPolicy: "reject",
      facts: { taxYear: 2026, ageAtYearEnd: 36, eligiblePlanCompensation: money("100000"),
        hsaFullYearEligible: true, hsaCoverage: "self" },
      limits: limits.map(kind => ({ kind, ruleId: stableContributionRuleId(person, kind, 2026),
        target: { targetType: "person", targetId: person },
        bucketKey: kind === "401k_additions" ? "401k_additions:employer-A" : kind,
        includedCharacters: contributionCharacters(kind) })),
    } };
}

const federalRule = taxRule(1, {
  jurisdiction: "US:FEDERAL", effectiveFrom: healthPeriod.start, effectiveUntil: instant("2027-01-01T00:00:00.000Z"),
  income: { ...taxRule().income!, standardDeduction: money("0") },
  payroll: [{ key: "synthetic-payroll", rate: Ratio.parse("0.1"), basis: "per_employee", threshold: money("0") }],
});

function paycheck(zeroNet = false, elected = false, withTax = false) {
  healthReads = 0;
  withdrawOnRead = Number.POSITIVE_INFINITY;
  amendedHealth = false;
  const plan = coverage("A", "2026-01-01", "2026-02-01", "2026-01-15");
  const raw = payroll(plan, payday);
  const s = raw.facts.source;
  const gross = zeroNet ? money("200") : money("1000");
  const incomeId = domainId("income", "27900000-0000-4000-8000-000000000005");
  const election: PayrollWithholdingElection = { ...raw.facts.withholding[0]!.election, incomeId };
  const withholding = elected ? [election] : [];
  const allocations = elected ? [contribution(10, "traditional_401k", "50", ["401k_additions", "401k_elective"]),
    contribution(11, "employee_hsa", "20", ["hsa_individual"])] : [];
  const stream = { id: incomeId, ownerId: person, payrollWithholding: withholding, payrollContributions: allocations,
    depositAccountId: bank, baseMonthlyAmount: gross, start: healthPeriod.start, end: healthPeriod.end,
    recurrence: { kind: "utc_monthly", anchor: s.dueAt, invalidDayPolicy: "skip" } as const,
    growthBaseAt: s.dueAt, growthRate: Rate.fromDecimal("0", rateConvention.effectiveAnnual()),
    primitiveIds: { recurrence: primitive, growth } };
  const transactionId = accountingTransactionId(`tx:recognition:income:${stream.id}:${s.dueAt}`);
  const occurrenceId = generatedOccurrenceKey({ scenarioId: context.scenarioId, primitiveInstanceId: primitive,
    scheduledAt: s.dueAt, semanticEffectType: "income-recognition", economicTargetId: stream.id });
  const binding = { ...s, incomeId: stream.id, transactionId, occurrenceId };
  const traceRefs = [calculationTraceRef(calculationTraceId(`payroll:${transactionId}:gross:${stream.id}`),
    allocations.flatMap(item => item.policy.limits.map(limit => domainId("tax-rule", limit.ruleId)))),
    ...withholding.map(row => calculationTraceRef(calculationTraceId(
      `payroll:withholding:${row.id}:income:${incomeId}:owner:${person}:employer:${row.employerId}:occurrence:${occurrenceId}:year:2026:jurisdiction:${row.jurisdiction}:provenance:${row.provenance}`,
    )))];
  const income = createAccountingLeg({ type: "income", posting: "credit", amount: gross });
  const cash = (amount: Money) => createAccountingLeg({ type: "cash", posting: "debit", amount, accountId: bank, cashFlowClass: "operating" });
  const draft = { id: transactionId, date: s.dueAt, type: "payroll_income", traceRefs };
  const creditLegs = withholding.map(row => createAccountingLeg({ type: "asset", posting: "debit",
    entityId: taxBalanceIds(row.jurisdiction, "2026").creditPositionId,
    amount: money("100"), quantity: Quantity.parse("100", Unit.of("usd_tax_credit")) }));
  const signedContributions = allocations.map(item => {
    if (item.calculation.kind !== "fixed") throw new Error("Expected fixed employee contribution");
    return { id: `${transactionId}:${item.id}`, character: item.policy.character, amount: item.calculation.amount };
  });
  const contributionLegs = allocations.map((item, index) => createAccountingLeg({ type: "asset", posting: "debit",
    entityId: item.positionId, amount: signedContributions[index]!.amount, quantity: Quantity.parse(index === 0 ? "0.5" : "0.2", SHARE) }));
  const signedCashBeforeHealth = gross.minus(elected ? money("170") : money("0"));
  const transaction = createAccountingTransaction({ ...draft, legs: [
    ...contributionLegs, ...creditLegs,
    createAccountingLeg({ type: "expense", posting: "debit", amount: money("200"), entityId: expenseId }),
    ...(zeroNet ? [] : [cash(signedCashBeforeHealth.minus(money("200")))]), income,
  ] });
  const legalBases = raw.bases.map(row => {
    const federal = withTax && row.jurisdiction === federalRule.jurisdiction;
    const before = federal ? gross.minus(money(row.regime === "income" ? "70" : "20")) : gross;
    return { ...row, ...(federal ? { ruleId: federalRule.id, ruleVersion: federalRule.version } : {}),
      before, after: before.minus(row.exclusion) };
  });
  health = { revisionId: "1", status: "active", expenseId, transaction, legalBases, premiumRequest: scenario([plan]).request,
    event: { runId: context.runId, eventId: transactionId, eventAt: s.dueAt, asOf: cutoff, dataCutoff: cutoff },
    payroll: { ...raw.facts, source: binding, bankOwnerId: household, gross, contributions: signedContributions,
      requiredBases: legalBases.map(({ jurisdiction, regime, ruleId, ruleVersion }) => ({ jurisdiction, regime, ruleId, ruleVersion })),
      withholding: withholding.map(row => ({ election: row, amount: money("100") })),
      election: { ...raw.facts.election, incomeId: stream.id },
      transaction: createAccountingTransaction({ ...draft, legs: [...contributionLegs, ...creditLegs, cash(signedCashBeforeHealth), income] }) } };
  wage = { health: healthRef, stream, gross, incomeId: stream.id, householdId: household, personId: person,
    bankAccountId: bank, employerId: s.employerId, period: healthPeriod, occurrenceId,
    transaction, sourceId: "employer", revisionId: "1", status: "active", publishedAt: s.publishedAt,
    knownAt: s.knownAt, effectiveFrom: healthPeriod.start, effectiveUntil: healthPeriod.end };
  const event: HouseholdBankEventContext = { runId: context.runId, asOf: context.asOf, dataCutoff: context.dataCutoff,
    eventId: transactionId, eventAt: s.dueAt, personId: person, householdId: household, bankAccountId: bank, direction: "credit" };
  const opening = createAuthoritativeState({ accounts: { [bank]: { id: bank, kind: "checking", ownerId: household, cash: money("100") },
    ...Object.fromEntries(allocations.map(item => [item.accountId, { id: item.accountId, kind: "retirement" as const, ownerId: person, cash: money("0") }])) },
    positions: Object.fromEntries(allocations.map(item => [item.positionId, { id: item.positionId, accountId: item.accountId,
      price: money("100"), quantity: Quantity.parse("0", SHARE), carryingValue: money("0") }])),
    liabilities: { [payable]: { id: payable, balance: money("0") } } });
  const source = { version: "household-wage-source/v1", health: healthRef, bank: bankRef,
    original: { version: "household-economic-original/v1", family: "wage", publisherId: "s4-wages",
      sourceId: "employer", revisionId: "1", digest: householdWageOriginalDigest(wage) } } as const;
  const run = () => payrollContributionCandidate(opening, { runContext: context, id: transactionId, incomeId: stream.id,
    at: s.dueAt, gross, householdId: household, ownerId: person, occurrenceId, depositAccountId: bank,
    allocations, withholding, householdWage: { stream, period: healthPeriod, context: event, source } });
  const cashFlowInput = { householdId: household, ownerId: person, cashAccountId: bank, expensePayableLiabilityId: payable,
    baseCurrency: USD, incomes: [{ ...stream, householdWageSource: source }], expenses: [], events: [] };
  return { opening, run, transaction, cashFlowInput };
}

const emptyRun = (state: ReturnType<typeof createAuthoritativeState>, runContext = context) => ({
  runContext, compiled: { scenarioIdentity: runContext.scenarioId, executionMonths: 1,
    reconciledOpeningState: state, reconciledPrimitiveState: createPrimitiveRuntimeStateStore(), scenarioBindings: {} },
});

function attachPremium(kernel: ReturnType<typeof compileHouseholdKernel>, day: string, plan = "A") {
  const at = instant(`2026-01-${day}T00:00:00.000Z`);
  const rawCoverage = coverage(plan, "2026-01-01", "2026-02-01", civilDate(at.slice(0, 10)));
  const request = scenario([{ ...rawCoverage,
    route: { kind: "aftertax_bank", payerId: person, sourceAccountId: bank, evidence: premiumEvidence },
    quote: { ...rawCoverage.quote, member: money("60"), gross: money("160") },
  }]).request;
  const p = proposePremiums(request).proposals[0]!;
  const base = aftertaxConfirmation();
  const confirmation = { ...base, proposal: p, bank: { ...base.bank, accountId: bank, householdId: household,
    payerId: person, evidence: premiumEvidence }, payable: { ...base.payable, liabilityId: payable,
    householdId: household, payerId: person, coverageId: p.coverageId, evidence: premiumEvidence } };
  const raw = { version: "1", publishedAt: cutoff, knownAt: cutoff, request, confirmation };
  const original = { version: "household-economic-original/v1", family: "health_premium", publisherId: "s4-aftertax",
    sourceId: `premium:${day}:${plan}`, revisionId: raw.version, digest: aftertaxPremiumOriginalDigest(raw) } as const;
  const id = confirmation.expenseId;
  const claimId = `obligation:recognition:expense:${id}:${at}`;
  const eventId = `settlement:${claimId}`;
  const premiumTrace = `d2:aftertax-premium:${canonicalSerialize([p.householdId, p.payerId, p.coverageId, p.planId, p.quoteId, p.effectiveAt, p.source, p.memberIds])}`;
  const traces = freezeTraceRefs([premiumTrace, ...p.traceRefs, premiumEvidence.ruleSnapshotId,
    ...["base", "inflation-assumption", "inflation-index:0", "inflation-linked", "recurrence"].map(s => `vs2:expense:${id}:${s}`)]
    .map(s => calculationTraceRef(calculationTraceId(s))))!;
  const signed = (id: string, type: string, legs: AccountingLegDraft[]) => createAccountingTransaction({
    id: accountingTransactionId(id), date: at, type, traceRefs: traces,
    legs: legs.map(leg => createAccountingLeg({ ...leg, traceRefs: traces })),
  });
  premium = { ...raw, original: { version: "household-expense-original/v1",
    context: { runId: context.runId, asOf: cutoff, dataCutoff: cutoff, householdId: household, personId: person,
      bankAccountId: bank, direction: "debit", eventId, eventAt: at },
    checkedAt: cutoff, completeThrough: cutoff, completeness: "complete", expenseId: id, claimId, period: healthPeriod,
    occurrenceId: generatedOccurrenceKey({ scenarioId: context.scenarioId, primitiveInstanceId: confirmation.primitiveIds.recurrence,
      scheduledAt: at, semanticEffectType: "expense-recognition", economicTargetId: id }),
    witness: { original, source: { kind: "organization", id: p.recipientId }, payer: { kind: "person", id: person }, beneficiary: person },
    recognition: signed(`tx:recognition:recognition:expense:${id}:${at}`, "expense_recognition", [
      { type: "expense", posting: "debit", amount: p.memberAmount },
      { type: "liability", posting: "credit", amount: p.memberAmount, entityId: payable },
    ]),
    settlement: signed(`tx:${eventId}`, "expense_settlement", [
      { type: "liability", posting: "debit", amount: p.memberAmount, entityId: payable },
      { type: "cash", posting: "credit", amount: p.memberAmount, accountId: bank, cashFlowClass: "operating" },
    ]),
  } };
  const result = attachAftertaxPremiums({ kernel, runContext: context, asOf: civilDate(cutoff.slice(0, 10)), request,
    confirmed: [{ ...confirmation, householdExpenseSource: { version: "household-expense-source/v1", bank: bankRef,
      original, beneficiary: person } }], representations: [] });
  expect(result.diagnostics).toEqual([]);
  expect(result.admittedOperationIds).toEqual([p.operationId]);
  return result.kernel;
}

describe("S4 authoritative BANK source admission", () => {
  it.each([false, true])("posts one two-family exact paycheck with zero net = %s", zeroNet => {
    const { run, transaction } = paycheck(zeroNet);
    const result = run();
    expect(result.transactions).toEqual([transaction]);
    expect(result.state.accounts[bank]!.cash.equals(money(zeroNet ? "100" : "900"))).toBe(true);
    const proof = result.state.d2PostedTransactions![transaction.id]!;
    expect(proof.registration.kind).toBe("household_domain");
    expect(householdPayrollHealthPostingEvidence(proof, context)?.deduction).toEqual(result.withholdingEvidence?.healthDeduction);
    expect(runCompiledHouseholdProjection(emptyRun(result.state)).state.accounts[bank]!.cash)
      .toEqual(runReference(emptyRun(result.state)).state.accounts[bank]!.cash);
  });

  it("preflights both household runners without streams or participants", () => {
    const result = paycheck().run();
    const before = canonicalSerialize(result.state);
    const newer = createRunContext({ ...context, asOf: amended, dataCutoff: amended });
    const older = instant("2023-11-30T00:00:00.000Z");
    expect(() => admitS4OpeningSources(result.state, newer)).not.toThrow();
    amendedHealth = true;
    for (const runner of [runCompiledHouseholdProjection, runReference]) {
      expect(() => runner(emptyRun(result.state, newer))).toThrow();
      expect(() => runner(emptyRun(result.state, createRunContext({ ...context, asOf: older, dataCutoff: older })))).toThrow();
    }
    amendedHealth = false;
    const kernel = compileHouseholdKernel(emptyRun(result.state).compiled, context.simulationStart);
    health = undefined;
    for (const runner of [runCompiledHouseholdProjection, runReference])
      expect(() => runner(emptyRun(result.state))).toThrow();
    expect(() => runHouseholdForecastSummary({ kernel, runContext: context })).toThrow();
    expect(canonicalSerialize(result.state)).toBe(before);
  });

  it.each([false, true])("reconciles independently scheduled common-domain paychecks with elections = %s", elected => {
    const { opening, cashFlowInput, transaction } = paycheck(false, elected);
    const base = emptyRun(opening);
    const request = { ...base, compiled: { ...base.compiled, cashFlowInput } };
    const optimized = runCompiledHouseholdProjection(request);
    const reference = runReference(request);
    expect(optimized.status).toBe("completed");
    expect(reference.status).toBe("completed");
    expect(canonicalSerialize(optimized.state)).toEqual(canonicalSerialize(reference.state));
    expect(optimized.state.d2PostedTransactions?.[transaction.id]?.transaction).toEqual(transaction);
    expect(optimized.periods.map(row => row.cash)).toEqual(reference.periods.map(row => row.cash));
    health = undefined;
    for (const runner of [runCompiledHouseholdProjection, runReference]) {
      const rejected = runner(request);
      expect(rejected.status).toBe("incomplete");
      expect(rejected.state.accounts[bank]!.cash).toEqual(opening.accounts[bank]!.cash);
    }
    // Optional tax, after-tax premium and FSA participants are not measured by the frozen reference.
  });

  it("preserves an authenticated wage-only paycheck without requiring a health publisher", () => {
    const { opening, cashFlowInput } = paycheck();
    const signed = employerWage(context, { householdId: household, personId: person,
      bankAccountId: bank, incomeId: cashFlowInput.incomes[0]!.id, employerId: "employer-A",
      firstPayday: "2026-01-15", gross: "1000" });
    health = undefined;
    const base = emptyRun(opening);
    const request = { ...base, compiled: { ...base.compiled, cashFlowInput: { ...cashFlowInput, incomes: [signed.income] } } };
    for (const runner of [runCompiledHouseholdProjection, runReference]) {
      const result = runner(request);
      expect(result.status).toBe("completed");
      expect(result.state.accounts[bank]!.cash).toEqual(money("1100"));
      const entries = Object.values(result.state.d2PostedTransactions ?? {});
      expect(entries).toHaveLength(1);
      expect(entries[0]!.transaction.type).toBe("income");
      expect(entries[0]!.registration).toMatchObject({ kind: "household_domain", evidence: {
        originals: [expect.objectContaining({ original: expect.objectContaining({ family: "wage" }) })],
      } });
    }
  });

  it.each([8, 20, 120, 360, 649])("retains bounded proof references across %i structural occurrences", count => {
    const { run, transaction } = paycheck();
    const proof = run().state.d2PostedTransactions![transaction.id]!;
    const encoded = canonicalSerialize(Array.from({ length: count }, (_, index) => ({ ...proof, occurrence: index })));
    expect(encoded.length).toBeLessThan(4500 * count);
    expect(encoded).not.toContain("premiumRequest");
    expect(encoded).not.toContain("legalBases");
  });

  it("rejects missing legal facts and a publisher that withdraws on the confirmation read", () => {
    const first = paycheck();
    health = { ...health!, legalBases: [] };
    expect(first.run).toThrow();
    const next = paycheck();
    withdrawOnRead = 2;
    const before = canonicalSerialize(next.opening);
    expect(next.run).toThrow();
    expect(canonicalSerialize(next.opening)).toBe(before);
  });

  it.each(["BANK owner", "member", "plan"] as const)("rejects a mismatched payroll %s without posting", mismatch => {
    const fixture = paycheck();
    if (mismatch === "BANK owner") fixture.opening.accounts[bank] = { ...fixture.opening.accounts[bank]!, ownerId: person };
    else {
      const original = health!;
      health = { ...original, payroll: { ...original.payroll, source: { ...original.payroll.source,
        ...(mismatch === "member" ? { ownerId: fsaIds.other } : { planId: "wrong-plan" }),
      } } };
    }
    const before = canonicalSerialize(fixture.opening);
    expect(fixture.run).toThrow();
    expect(canonicalSerialize(fixture.opening)).toBe(before);
  });

  it.each(["10", "20"])("rejects a current duplicate premium scheduled on January %s", day => {
    const { opening, cashFlowInput } = paycheck();
    const kernel = attachPremium(compileHouseholdKernel({ ...emptyRun(opening).compiled, cashFlowInput }, context.simulationStart), day);
    const forecast = runHouseholdForecastSummary({ kernel, runContext: context });
    expect(forecast.status).toBe("incomplete");
    expect(forecast.diagnostics).toContainEqual(expect.objectContaining({ message: "DUPLICATE_PREMIUM_PAYROLL_ROUTE" }));
    expect(canonicalSerialize(forecast.state)).toBe(canonicalSerialize(opening));
  });

  it.each(["A", "B"])("checks the archived composite against after-tax coverage %s", plan => {
    const { run, cashFlowInput } = paycheck();
    const { state } = run();
    const kernel = attachPremium(compileHouseholdKernel({ ...emptyRun(state).compiled,
      cashFlowInput: { ...cashFlowInput, incomes: [] } }, context.simulationStart), "20", plan);
    const forecast = runHouseholdForecastSummary({ kernel, runContext: context });
    if (plan === "A") {
      expect(forecast.status).toBe("incomplete");
      expect(forecast.diagnostics).toContainEqual(expect.objectContaining({ message: "DUPLICATE_PREMIUM_PAYROLL_ROUTE" }));
      expect(canonicalSerialize(forecast.state)).toBe(canonicalSerialize(state));
    } else {
      expect(forecast.status).toBe("completed");
      expect(forecast.state.accounts[bank]!.cash).toEqual(money("840"));
      const debit = premium!.original.settlement;
      expect(forecast.state.d2PostedTransactions?.[debit.id]?.transaction).toEqual(debit);
    }
  });

  it("checks the archive key and signed paycheck before rejecting an overlap", () => {
    const { run, cashFlowInput, transaction } = paycheck();
    const result = run();
    const kernel = attachPremium(compileHouseholdKernel({ ...emptyRun(result.state).compiled,
      cashFlowInput: { ...cashFlowInput, incomes: [] } }, context.simulationStart), "20");
    const guard = kernel.executable.participants![0]!;
    const descriptor = { id: `income:${cashFlowInput.incomes[0]!.id}:${payday}`, domain: "cash_flow",
      operationClass: "cash_income_settlement", sequencingInstant: payday, dependsOn: [], resourceAccesses: [], traceRefs: [] };
    const receipt = result.withholdingEvidence!;
    const facts = (row: typeof receipt) => ({ summary: { evidence: new SummaryOperationSink(USD).snapshot(), cash: {
      recurringIncomeRecognized: money("1000"), recurringExpenseRecognized: money("0"), expenseCashSettlement: money("0"),
      outstandingExpenseObligations: money("0"), constraintOutcomes: [], liquidityShortfalls: [], diagnostics: [], payrollWithholding: [row],
    } } });
    const proof = result.state.d2PostedTransactions![transaction.id]!;
    const forgedId = accountingTransactionId("forged-paycheck");
    expect(() => guard.observe!(descriptor, facts({ ...receipt, transactionId: forgedId }), {}, {
      postingProofs: { [forgedId]: proof }, context,
    })).toThrow("PAYROLL_POSTING_UNAVAILABLE");
    expect(() => guard.observe!(descriptor, facts({ ...receipt, ownerId: fsaIds.other }), {}, {
      postingProofs: { [transaction.id]: proof }, context,
    })).toThrow("PAYROLL_HEALTH_ORIGINAL_UNAVAILABLE");
    expect(() => guard.observe!(descriptor, facts(receipt), {}, {
      postingProofs: { [transaction.id]: proof }, context,
    })).toThrow("DUPLICATE_PREMIUM_PAYROLL_ROUTE");
  });

  it.each([true, false])("requalifies signed Section 125 wage bases when the tax rule matches = %s", matchingLaw => {
    const { opening, cashFlowInput, transaction } = paycheck(false, true, true);
    const stream = cashFlowInput.incomes[0]!;
    const tax = createHouseholdTaxParticipant({
      catalog: [matchingLaw ? federalRule : { ...federalRule, version: "different-rule-version" }],
      filingStatus: "single", ownerId: household, simulationStart: healthPeriod.start,
      incomes: [{ id: stream.id, ownerId: person, employerId: "employer-A", incomeType: "salary", taxCharacter: "ordinary",
        grossOrNet: "gross", start: "2026-01-01", eligibility: [],
        residence: [{ state_jurisdiction: "TEST:RESIDENCE", effective_date: "2026-01-01" }],
        work: [{ state_jurisdiction: "TEST:SERVICE", effective_date: "2026-01-01", allocation: "1" }] }],
      payrollWithholding: stream.payrollWithholding, eligibility: [], diagnostics: [], payments: [], settlements: [],
      fundingPolicy: createFundingPolicy({ id: fundingPolicyId("s4-tax"), orderedSources: [{ kind: "cash_account", accountId: bank }],
        allowPartial: false, insufficientFundsBehavior: "unfunded" }), refundAccountId: bank,
    });
    const { liabilityId, creditPositionId } = taxBalanceIds(federalRule.jurisdiction, "2026");
    const kernel = compileHouseholdKernel({ ...emptyRun(opening).compiled, cashFlowInput, participants: [tax],
      nonInvestmentPositionIds: [creditPositionId] }, context.simulationStart);
    const forecast = runHouseholdForecastSummary({ kernel, runContext: context });
    expect(forecast.status).toBe("incomplete");
    expect(forecast.state.accounts[bank]!.cash).toEqual(money("730"));
    const proof = forecast.state.d2PostedTransactions![transaction.id]!;
    expect(proof.transaction).toEqual(transaction);
    const deduction = householdPayrollHealthPostingEvidence(proof, context)!.deduction;
    expect(deduction.withholding).toEqual([expect.objectContaining({ jurisdiction: federalRule.jurisdiction, amount: money("100") })]);
    expect(deduction.appliedJurisdictionWageBases).toEqual(expect.arrayContaining([
      expect.objectContaining({ jurisdiction: federalRule.jurisdiction, regime: "income", after: money("730") }),
      expect.objectContaining({ jurisdiction: federalRule.jurisdiction, regime: "payroll", after: money("780") }),
    ]));
    // Matching law accrues 73 income tax plus 78 payroll tax, less the single 100 credit.
    expect(forecast.state.liabilities[liabilityId]?.balance).toEqual(money(matchingLaw ? "51" : "0"));
    expect(forecast.state.positions[creditPositionId]?.carryingValue).toEqual(money(matchingLaw ? "0" : "100"));
    expect(forecast.outputCapabilities?.cash).toMatchObject({
      dependency: "tax_affected", status: "incomplete",
      diagnostics: expect.arrayContaining([expect.objectContaining({
        category: matchingLaw ? "settlement_timing" : "legal_base_or_component", jurisdiction: federalRule.jurisdiction,
      })]),
    });
  });

  it("restores a composite paycheck archived before a portable tail checkpoint", () => {
    const { opening, cashFlowInput, transaction } = paycheck(false, true);
    const savedContext = createRunContext({ ...context, simulationEnd: instant("2027-02-01T00:00:00.000Z") });
    const kernel = compileHouseholdKernel({ ...emptyRun(opening).compiled, cashFlowInput, executionMonths: 13 }, context.simulationStart);
    const forecast = runHouseholdForecastSummary({ kernel, runContext: savedContext });
    expect(forecast.status).toBe("completed");
    expect(forecast.periods).toHaveLength(13);
    expect(forecast.state.accounts[bank]!.cash).toEqual(money("730"));
    let checkpointCount: number | undefined;
    const artifact = createPortableHouseholdReplayArtifact(forecast, true, evidence => { checkpointCount = evidence.checkpointCount; });
    expect(checkpointCount).toBe(1);
    expect(forecast.state.d2PostedTransactions?.[transaction.id]?.transaction).toEqual(transaction);
    const cold = JSON.parse(JSON.stringify(artifact));
    for (const saved of [cold, artifact]) {
      const restored = restorePortableHouseholdReplayArtifact(saved);
      expect(restored.replay.runContext).toEqual(savedContext);
      const tail = replayHouseholdForecastWindow(restored, forecast.periods[12]!.period);
      expect(tail.status).toBe("completed");
      expect(tail.periods[0]!.transactions).toEqual([]);
      expect(tail.state.d2PostedTransactions).toEqual(forecast.state.d2PostedTransactions);
      expect(tail.state.accounts[bank]!.cash).toEqual(money("730"));
    }
    const registration = forecast.state.d2PostedTransactions![transaction.id]!.registration;
    if (registration.kind !== "household_domain") throw new Error("Expected composite payroll proof");
    const archivedDigest = registration.evidence.originals.find(row => row.original.family === "payroll_health")!.original.digest;
    const encoded = artifact.encoded.replaceAll(archivedDigest, `sha256:${"0".repeat(64)}`);
    expect(encoded).not.toBe(artifact.encoded);
    expect(() => restorePortableHouseholdReplayArtifact({
      ...artifact, encoded, integrity: createInputFingerprint({ runContext: savedContext, openingState: encoded }),
    })).toThrow();
    health = undefined;
    expect(() => restorePortableHouseholdReplayArtifact(artifact)).toThrow();
    expect(() => restorePortableHouseholdReplayArtifact(JSON.parse(JSON.stringify(artifact)))).toThrow();
  });

  it.each(["v1", "v2"] as const)("restores a person-owned FSA journal through the %s participant codec", version => {
    const fixture = fsaFixture();
    fsa = fsaSource();
    const kernel = version === "v1"
      ? applyHouseholdExecutionOverlay(fixture.kernel, { participants: [legacyParticipant(fsa, fixture.context.simulationEnd)] })
      : attachFsaCash(fixture.kernel, fsaInput(fsa));
    const forecast = runHouseholdForecastSummary({ kernel, runContext: fixture.context });
    const receipt = qualifyFsaCashSource(fsa, fixture.context, version);
    expect(forecast.periods.map(row => row.cash.amount.toString())).toEqual(["500", "1500"]);
    expect(Object.values(forecast.state.d2SettlementReceipts ?? {})).toEqual([receipt]);
    const artifact = createPortableHouseholdReplayArtifact(forecast, true);
    for (const saved of [JSON.parse(JSON.stringify(artifact)), artifact]) {
      const restored = restorePortableHouseholdReplayArtifact(saved);
      expect(restored.replay.kernel.executable.participants?.[0]?.portableCodec).toBe(`d2-fsa-cash/${version}`);
      const replay = replayHouseholdForecastWindow(restored, forecast.periods[1]!.period);
      expect(replay.periods[0]!.cash).toEqual(money("1500"));
      expect(replay.state.d2PostedTransactions).toEqual(forecast.state.d2PostedTransactions);
      expect(replay.state.d2SettlementReceipts).toEqual(forecast.state.d2SettlementReceipts);
    }
  });

  it("posts the independently paid debit and subsequent settled credit, then rechecks native replay", () => {
    const fixture = fsaFixture(2, createAuthoritativeState({ accounts: { [fsaIds.bank]: {
      id: fsaIds.bank, kind: "checking", ownerId: fsaIds.household, cash: money("1500"),
    } } }));
    const raw = fsaSource();
    const event = (eventId: string, eventAt: HouseholdBankEventContext["eventAt"], direction: "debit" | "credit"): HouseholdBankEventContext => ({
      runId: fixture.context.runId, asOf: fixture.context.asOf, dataCutoff: fixture.context.dataCutoff,
      eventId, eventAt, direction, householdId: fsaIds.household, bankAccountId: fsaIds.bank, personId: fsaIds.person,
    });
    fsa = { ...raw, request: { ...raw.request, receipts: raw.request.receipts.map(r => ({
      ...r, destination: { ...r.destination!, ownerId: fsaIds.household, householdBank: true },
    })) }, deposit: { ...raw.deposit, ownerId: fsaIds.household }, householdBank: {
      bankPublisherId: bankRef.publisherId, bankSourceId: bankRef.sourceId,
      originalContext: event(originalOperationId(raw), raw.original.paidAt, "debit"),
      settlementContext: event(depositOperationId(raw), raw.deposit.settledAt, "credit"),
    } };
    const paidAndSettled = fsa;
    fsa = { ...paidAndSettled, deposit: { ...paidAndSettled.deposit, status: "pending" } };
    const pending = runHouseholdForecastSummary({ kernel: attachFsaCash(fixture.kernel, fsaInput(fsa)), runContext: fixture.context });
    expect(pending.status).toBe("incomplete");
    expect(pending.periods.map(row => row.cash.amount.toString())).toEqual(["500", "500"]);
    const debit = originalTransaction(fsa);
    const creditId = accountingTransactionId(depositOperationId(fsa));
    expect(pending.state.d2PostedTransactions?.[debit.id]?.transaction).toEqual(debit);
    expect(pending.state.d2PostedTransactions?.[creditId]).toBeUndefined();
    expect(Object.values(pending.state.d2SettlementReceipts ?? {})).toEqual([]);
    expect(pending.outputCapabilities).toMatchObject({
      fsaCashSettlement: { dependency: "tax_independent", status: "incomplete" },
      fsaPayrollTax: { dependency: "tax_affected", status: "incomplete" },
    });
    fsa = paidAndSettled;
    const receipt = qualifyFsaCashSource(fsa, fixture.context);
    const kernel = attachFsaCash(fixture.kernel, fsaInput(fsa));
    expect(attachFsaCash(kernel, fsaInput(fsa))).toBe(kernel);
    const forecast = runHouseholdForecastSummary({ kernel, runContext: fixture.context });
    expect(forecast.status).toBe("incomplete");
    expect(forecast.periods.map(row => row.cash.amount.toString())).toEqual(["500", "1500"]);
    expect(forecast.outputCapabilities).toMatchObject({
      fsaCashSettlement: { dependency: "tax_independent", status: "complete" },
      fsaPayrollTax: { dependency: "tax_affected", status: "incomplete" },
    });
    expect(Object.values(forecast.state.d2SettlementReceipts ?? {})).toEqual([receipt]);
    expect(forecast.state.d2PostedTransactions?.[debit.id]?.transaction).toEqual(debit);
    expect(forecast.state.d2PostedTransactions?.[creditId]?.transaction).toEqual(receipt.paymentTransaction);
    expect(applyD2SettlementAtomically(forecast.state, receipt, fixture.context).status).toBe("already_committed");
    expect(forecast.state.accounts[fsaIds.bank]!.cash).toEqual(money("1500"));
    const artifact = createPortableHouseholdReplayArtifact(forecast, true);
    const transported = JSON.parse(JSON.stringify(artifact));
    const window = forecast.periods[1]!.period;
    for (const saved of [transported, artifact]) {
      const restored = restorePortableHouseholdReplayArtifact(saved);
      expect(restored.replay.runContext).toEqual(fixture.context);
      const replay = replayHouseholdForecastWindow(restored, window);
      expect(replay.status).toBe("incomplete");
      expect(replay.outputCapabilities).toEqual(forecast.outputCapabilities);
      expect(replay.periods.map(row => row.cash.amount.toString())).toEqual(["1500"]);
      expect(replay.periods.flatMap(row => row.transactions)).toEqual([receipt.paymentTransaction]);
      expect(replay.state.d2PostedTransactions).toEqual(forecast.state.d2PostedTransactions);
      expect(replay.state.d2SettlementReceipts).toEqual(forecast.state.d2SettlementReceipts);
    }
    const tooEarly = instant("2026-02-01T00:00:00.000Z");
    expect(() => admitS4OpeningSources(forecast.state, { asOf: tooEarly, dataCutoff: tooEarly })).toThrow();
    fsa = undefined;
    expect(() => restorePortableHouseholdReplayArtifact(artifact)).toThrow();
    expect(() => restorePortableHouseholdReplayArtifact(JSON.parse(JSON.stringify(artifact)))).toThrow();
  });
});
