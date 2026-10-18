import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { accountingTransactionId } from "../../../../src/accounting/index.js";
import { domainId, idempotencyKey } from "../../../../src/identity/index.js";
import { createAuthoritativeState } from "../../../../src/state/index.js";
import { civilDate, instant, utcMonthlyPeriods } from "../../../../src/time/index.js";
import { money, USD } from "../../../../src/values/index.js";
import { applyHouseholdExecutionOverlay, compileHouseholdKernel, exportHouseholdReplayCheckpoints,
  replayHouseholdForecastWindow, runHouseholdKernel } from "../../../../src/simulation/householdExecution.js";
import { createPrimitiveRuntimeStateStore } from "../../../../src/simulation/period.js";
import { canonicalSerialize, createRunContext, runId, scenarioId } from "../../../../src/simulation/run.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { proposeHeloc, type HelocRequest, type PrincipalEvent, type Source } from "../../../../src/simulation/d2/debt/heloc/index.js";
import { attachHelocDraws, createHelocDrawParticipant, runHelocDraws, type HelocDrawInput } from "../../../../src/simulation/d2/integration/helocDraws/index.js";
import { scenario as premiumScenario } from "../jointHousehold/scenario.js";
import { catalogSchema } from "../../../fixtures/d2/schema.js";

const d = civilDate;
const uuid = (n: number) => `149d0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ids = { household: domainId("household", uuid(1)), person: domainId("person", uuid(2)),
  bank: domainId("account", uuid(3)), liability: domainId("liability", uuid(4)), line: uuid(5) };
const start = instant("2026-01-01T00:00:00.000Z");
const source = (): Source => ({ householdId: ids.household, personId: ids.person, lineId: ids.line,
  bankAccountId: ids.bank, liabilityAccountId: ids.liability,
  start: d("2024-01-01"), endExclusive: d("2036-01-01"), ruleSnapshotId: "synthetic:#149:heloc-issuer-v1",
  jurisdiction: "US-test", sourcePublication: "Synthetic issuer and borrower confirmation; not market terms",
  publishedAt: d("2025-12-01"), asOf: d("2025-12-01"), version: "1", projectionStatus: "verified" });
const draw = (operationId = "source:draw-500", date = "2026-01-10", sequence = 0): PrincipalEvent => ({
  operationId, authorizationId: `borrower-authorized:${operationId}`, kind: "draw", effectiveAt: d(date), sequence,
  actorId: ids.person, bankAccountId: ids.bank, authorized: true, amount: money("500"), source: source(), funding: null,
});
const request = (): HelocRequest => ({
  householdId: ids.household, ownerId: ids.person, borrowerId: ids.person, lineId: ids.line,
  liabilityAccountId: ids.liability, bankAccountId: ids.bank,
  period: { start: d("2026-01-01"), endExclusive: d("2026-02-01") }, evaluatedAsOf: d("2025-12-31"),
  source: source(), currency: USD, creditLimit: money("1000"), openingPrincipal: money("0"),
  openedAt: d("2024-01-01"), closedAt: d("2030-01-01"), maturityAt: d("2035-01-01"),
  drawWindow: { start: d("2024-01-01"), endExclusive: d("2030-01-01") }, revokedAt: null,
  phases: [{ start: d("2024-01-01"), endExclusive: d("2030-01-01"), kind: "interest_only_draw" },
    { start: d("2030-01-01"), endExclusive: d("2035-01-01"), kind: "amortizing" }],
  rate: { source: source(), indexId: "synthetic-issuer-index", spreadPpm: 20000n, lookbackDays: 2,
    resetIntervalDays: 31, priorResetAt: d("2026-01-01"), priorRatePpm: 60000n, nextResetOrdinal: 2,
    roundingIncrementPpm: 1000n, rounding: "half_up", initialCapPpm: 20000n, recurringCapPpm: 10000n,
    lifetimeFloorPpm: 30000n, lifetimeCeilingPpm: 120000n, legalMaximum: null, resets: [], observations: [] },
  interest: { source: source(), dayCount: "actual_365_fixed", compounding: "simple",
    posting: "period_end_after_daily_activity", rounding: "half_up", dueAt: d("2026-02-10") }, events: [draw()],
});
function input(r = request()): HelocDrawInput {
  const proposal = proposeHeloc(r).proposals[0]!;
  let cash = money("2000");
  const before = Object.fromEntries((proposal?.movements ?? []).map(m => {
    const entry = [m.operationId, cash] as const; cash = cash.plus(m.cashDelta); return entry;
  }));
  return { householdId: ids.household, personId: ids.person, quotes: [{ request: r, proposal,
    openingBankCash: money("2000"), bankCashBeforeDraw: before,
    bank: { classification: "BANK", accountId: ids.bank, householdId: ids.household, personId: ids.person, evidence: source() } }] };
}
function fixture(months = 1) {
  const opening = createAuthoritativeState({ accounts: { [ids.bank]: { id: ids.bank, kind: "checking", ownerId: ids.person, cash: money("2000") } },
    liabilities: { [ids.liability]: { id: ids.liability, balance: money("0") } } });
  const end = utcMonthlyPeriods(start, months).at(-1)!.end;
  const context = createRunContext({ runId: runId(uuid(6)), scenarioId: scenarioId(uuid(7)),
    asOf: instant("2025-12-31T00:00:00.000Z"), dataCutoff: instant("2025-12-31T00:00:00.000Z"),
    simulationStart: start, simulationEnd: end, baseCurrency: USD });
  const kernel = compileHouseholdKernel({ reconciledOpeningState: opening, reconciledPrimitiveState: createPrimitiveRuntimeStateStore(),
    scenarioIdentity: context.scenarioId, executionMonths: months, scenarioBindings: { syntheticEvidence: "#149 actual HELOC draw execution" } }, start);
  return { kernel, opening, context };
}
const execute = (i = input(), f = fixture()) => runHelocDraws({ kernel: f.kernel, input: i, runContext: f.context });
const reject = (i: HelocDrawInput, code: string, f = fixture()) => {
  const snapshot = canonicalSerialize({ opening: f.opening, i });
  const out = execute(i, f).result;
  expect(out.status).toBe("incomplete");
  expect(out.diagnostics.map(diagnostic => diagnostic.code)).toContain(code);
  expect(out.periods).toEqual([]);
  expect(out.state).toEqual(f.kernel.executable.reconciledOpeningState);
  expect(canonicalSerialize({ opening: f.opening, i })).toBe(snapshot);
};

describe("#149 actual draw-only household execution", () => {
  it("posts one balanced financing transaction with no income, gain, interest or tax", () => {
    const f = fixture(); const i = input(); const before = canonicalSerialize({ f, i });
    const out = execute(i, f);
    expect(out.coverage).toBe("incomplete");
    expect(out.diagnostics.map(diagnostic => diagnostic.affectedOutput)).toEqual([
      "heloc_interest", "heloc_interest_payment", "heloc_principal_repayment",
    ]);
    const result = out.result;
    expect(result.status, JSON.stringify(result.diagnostics)).toBe("incomplete");
    expect(result.periods).toHaveLength(1);
    const p = result.periods[0]!;
    expect([p.cash, p.liabilities, p.netWorth].map(m => m.amount.toString())).toEqual(["2500", "500", "2000"]);
    expect(result.state.accounts[ids.bank]!.cash.equals(money("2500"))).toBe(true);
    expect(result.state.liabilities[ids.liability]!.balance.equals(money("500"))).toBe(true);
    expect([p.statements.income, p.statements.expenses, p.statements.gains].every(m => m.isZero())).toBe(true);
    expect(p.statements.financingCashFlow.equals(money("500"))).toBe(true);
    expect(p.transactions).toHaveLength(1);
    const tx = p.transactions[0]!;
    expect(tx.id).toBe(i.quotes[0]!.proposal.movements[0]!.operationId);
    expect(tx.legs.map(l => [l.posting, l.type, l.amount.amount.toString()])).toEqual([
      ["debit", "cash", "500"], ["credit", "liability", "500"],
    ]);
    expect(tx.traceRefs?.some(t => t.traceId === source().ruleSnapshotId)).toBe(true);
    expect(result.state.identities.postedTransactionIds).toEqual([tx.id]);
    expect(result.state.identities.externalIdempotencyKeys).toHaveLength(3);
    expect(result.state.identities.recognitionIds).toEqual([]);
    expect(result.state.identities.settlementIds).toEqual([]);
    expect(result.state.obligations).toEqual({});
    expect(result.outputCapabilities?.helocPrincipalTransfer?.status).toBe("complete");
    expect(result.outputCapabilities?.helocInterest?.status).toBe("incomplete");
    expect(result.outputCapabilities?.netWorth?.status).toBe("incomplete");
    expect(i.quotes[0]!.proposal.interestExpenseProposal.amount.isPositive()).toBe(true);
    expect(canonicalSerialize({ f, i })).toBe(before);
    // Re-created participants own a new prepare callback; callback identity is
    // not an economic outcome. Compare the actual replayed state and evidence.
    const repeated = execute(i, f);
    expect(repeated.result.state).toEqual(result.state);
    expect(repeated.result.periods).toEqual(result.periods);
    expect(repeated.result.outputCapabilities).toEqual(result.outputCapabilities);
    expect(repeated.diagnostics).toEqual(out.diagnostics);
    const participant = createHelocDrawParticipant(i);
    const prepared = participant.prepare(f.context, p.period, { state: f.opening, primitiveState: {} });
    const operation = prepared.operations.find(o => o.descriptor.operationClass === "liabilities:heloc_draw")!;
    expect(operation.descriptor.domain).toBe("liabilities");
    expect(operation.descriptor.resourceAccesses).toEqual([{ kind: "account_cash", accountId: ids.bank, mode: "produce" }]);
    expect(Object.isFrozen(participant.economicInputs)).toBe(true);
  });

  it("matches summary, detail and portable sparse checkpoint continuation without phantom interest cash", () => {
    const f = fixture(13); const attached = attachHelocDraws(f.kernel, input());
    const forecast = runHouseholdKernel({ kernel: attached.kernel, runContext: f.context });
    const detail = execute(input(), f).result;
    expect(forecast.status, JSON.stringify(forecast.diagnostics)).toBe("incomplete");
    expect(forecast.periods).toHaveLength(13);
    expect(forecast.state).toEqual(detail.state);
    expect(forecast.periods.map(p => p.statements)).toEqual(detail.periods.map(p => p.statements));
    expect(forecast.periods.map(p => p.cash.amount.toString())).toEqual(Array(13).fill("2500"));
    expect(exportHouseholdReplayCheckpoints(forecast)).toHaveLength(1);
    expect(exportHouseholdReplayCheckpoints(forecast)[0]!.state.identities.externalIdempotencyKeys).toHaveLength(3);
    // This participant carries bigint index/spread/rate evidence. Portable
    // replay must preserve the exact value rather than losing its precision.
    const artifact = createPortableHouseholdReplayArtifact(forecast);
    let restored: ReturnType<typeof restorePortableHouseholdReplayArtifact>;
    try { restored = restorePortableHouseholdReplayArtifact(JSON.parse(JSON.stringify(artifact))); }
    catch (error) {
      // Preserve the domain-specific root cause concealed by the public
      // replay-basis protection, for the narrowly-scoped integration test.
      const cause = error instanceof Error ? error.cause : undefined;
      throw new Error(`HELOC_PORTABLE_ROOT_CAUSE: ${cause instanceof Error ? cause.message : String(cause ?? error)}`, { cause: error });
    }
    for (const selected of [detail.periods[0]!, detail.periods[12]!]) {
      const resumed = replayHouseholdForecastWindow(restored, selected.period);
      expect(resumed.periods).toEqual([selected]);
      expect(resumed.state).toEqual(detail.state);
      expect(replayHouseholdForecastWindow(forecast, selected.period)).toEqual(resumed);
    }
    expect(detail.periods.flatMap(p => p.transactions)).toHaveLength(1);
    expect(detail.state.identities.recognitionIds).toEqual([]);
  });

  it("does not post an identical draw twice when its committed receipt is supplied as opening state", () => {
    const f = fixture(); const first = execute(input(), f);
    const kernel = applyHouseholdExecutionOverlay(f.kernel, { reconciledOpeningState: first.result.state });
    const repeated = execute(input(), { ...f, kernel }).result;
    expect(repeated.status).toBe("incomplete");
    expect(repeated.state).toEqual(first.result.state);
    expect(repeated.periods[0]!.transactions).toEqual([]);
    expect(attachHelocDraws(first.kernel, input()).kernel).toBe(first.kernel);
    const changed = input(); const q = changed.quotes[0]!;
    expect(() => attachHelocDraws(first.kernel, { ...changed, quotes: [{ ...q, openingBankCash: money("2001") }] }))
      .toThrow(/different source version/);
  });

  it("posts two source-sequenced same-day draws cumulatively to the line cap", () => {
    const r = { ...request(), events: [draw("b", "2026-01-10", 2), draw("a")] };
    const out = execute(input(r)).result;
    expect(out.status, JSON.stringify(out.diagnostics)).toBe("incomplete");
    expect(out.periods).toHaveLength(1);
    expect(out.periods[0]!.cash.equals(money("3000"))).toBe(true);
    expect(out.state.liabilities[ids.liability]!.balance.equals(money("1000"))).toBe(true);
    expect(out.state.identities.externalIdempotencyKeys).toHaveLength(6);
    expect(out.periods[0]!.transactions.map(t => t.id)).toEqual(["a", "b"]);
    const i = input(r);
    reject({ ...i, quotes: [i.quotes[0]!, i.quotes[0]!] }, "HOUSEHOLD_CONTENTION_UNRESOLVED");
  });

  it("rolls back the first draw too when the second draw has a stale quoted bank balance", () => {
    const i = input({ ...request(), events: [draw("a"), draw("b", "2026-01-11", 2)] });
    const q = i.quotes[0]!;
    reject({ ...i, quotes: [{ ...q, bankCashBeforeDraw: { ...q.bankCashBeforeDraw, b: money("2000") } }] }, "HELOC_STALE_BALANCE");
  });

  it.each([
    ["unsigned", (r: HelocRequest) => ({ ...r, events: [{ ...draw(), authorized: false }] })],
    ["negative", (r: HelocRequest) => ({ ...r, events: [{ ...draw(), amount: money("-500") }] })],
    ["fractional cent", (r: HelocRequest) => ({ ...r, events: [{ ...draw(), amount: money("0.001") }] })],
    ["used credit", (r: HelocRequest) => ({ ...r, openingPrincipal: money("1000") })],
    ["cumulative cap", (r: HelocRequest) => ({ ...r, events: [draw("a"), draw("b", "2026-01-11", 1), draw("c", "2026-01-12", 2)] })],
    ["missing rate", (r: HelocRequest) => ({ ...r, rate: null })],
    ["wrong borrower", (r: HelocRequest) => ({ ...r, borrowerId: uuid(90) })],
    ["closed draw window", (r: HelocRequest) => ({ ...r, revokedAt: d("2026-01-10") })],
    ["duplicate auth", (r: HelocRequest) => ({ ...r, events: [draw(), { ...draw("other", "2026-01-11", 1), authorizationId: draw().authorizationId }] })],
    ["ambiguous sequence", (r: HelocRequest) => ({ ...r, events: [draw("a"), draw("b")] })],
    ["future event source", (r: HelocRequest) => ({ ...r, events: [{ ...draw(), source: { ...source(), asOf: d("2026-01-11") } }] })],
    ["missing issuer", (r: HelocRequest) => ({ ...r, source: { ...source(), sourcePublication: "" } })],
  ] as const)("atomically rejects %s with a typed source diagnostic", (_label, change) => {
    const original = input(); const q = original.quotes[0]!;
    reject({ ...original, quotes: [{ ...q, request: change(q.request) }] }, "HELOC_QUOTE_INCOMPLETE");
  });

  it("rejects an unknown future index instead of treating missing interest as zero", () => {
    const i = input(); const q = i.quotes[0]!; const r = q.request;
    const rate = { ...r.rate!, priorResetAt: d("2025-12-15"), resets: [{ effectiveAt: d("2026-01-15"), sequence: 2, source: source() }] };
    reject({ ...i, quotes: [{ ...q, request: { ...r, rate } }] }, "HELOC_QUOTE_INCOMPLETE");
    reject({ ...i, quotes: [{ ...q, request: { ...r, evaluatedAsOf: d("2026-01-15") } }] }, "HELOC_SOURCE_UNAVAILABLE");
  });

  it.each(["owner", "kind", "missing", "bank balance", "loan balance"])("rejects invalid opening %s without history mutation", variant => {
    const f = fixture(); const state = createAuthoritativeState(f.opening);
    if (variant === "owner") state.accounts[ids.bank] = { ...state.accounts[ids.bank]!, ownerId: domainId("person", uuid(99)) };
    if (variant === "kind") state.accounts[ids.bank] = { ...state.accounts[ids.bank]!, kind: "retirement" };
    if (variant === "missing") delete state.accounts[ids.bank];
    if (variant === "bank balance") state.accounts[ids.bank]!.cash = money("1999");
    if (variant === "loan balance") state.liabilities[ids.liability]!.balance = money("1");
    const kernel = applyHouseholdExecutionOverlay(f.kernel, { reconciledOpeningState: state });
    reject(input(), variant.endsWith("balance") ? "HELOC_STALE_BALANCE" : "HELOC_RESOURCE_INVALID", { ...f, kernel });
  });

  it("rejects a prior charge with the same source operation ID and no matching receipt", () => {
    const f = fixture(); const state = createAuthoritativeState({ ...f.opening,
      identities: { postedTransactionIds: [accountingTransactionId(draw().operationId)] } });
    reject(input(), "HELOC_STALE_OR_DUPLICATE", { ...f, kernel: applyHouseholdExecutionOverlay(f.kernel, { reconciledOpeningState: state }) });
  });

  it("rejects a consumed authorization, a changed receipt and an invalid destination confirmation", () => {
    const f = fixture(); const i = input(); const q = i.quotes[0]!;
    const state = createAuthoritativeState({ ...f.opening, identities: {
      externalIdempotencyKeys: [idempotencyKey("d2:authorization", draw().authorizationId)],
    } });
    reject(i, "HELOC_STALE_OR_DUPLICATE", { ...f, kernel: applyHouseholdExecutionOverlay(f.kernel, { reconciledOpeningState: state }) });
    const committed = execute(i, f).result.state;
    const changed = { ...i, quotes: [{ ...q, bank: { ...q.bank, evidence: { ...q.bank.evidence, version: "2" } } }] };
    reject(changed, "HELOC_STALE_OR_DUPLICATE", { ...f, kernel: applyHouseholdExecutionOverlay(f.kernel, { reconciledOpeningState: committed }) });
    reject({ ...i, quotes: [{ ...q, bank: { ...q.bank, personId: uuid(99) } }] }, "HELOC_IDENTITY_MISMATCH");
    const forged = { ...q.proposal, movements: q.proposal.movements.map(m => ({ ...m, destinationAccountId: uuid(99) })) };
    reject({ ...i, quotes: [{ ...q, proposal: forged }] }, "HELOC_QUOTE_INCOMPLETE");
  });

  it("does not execute a fully sourced B1 principal repayment", () => {
    const e = draw();
    const r: HelocRequest = { ...request(), openingPrincipal: money("500"), events: [{ ...e, kind: "principal_repayment",
      funding: { fundingId: "synthetic:repayment-only", effectiveAt: e.effectiveAt, amount: e.amount, source: source() } }] };
    reject(input(r), "HELOC_DRAW_ONLY");
  });

  it("posts an admitted C1 premium with the independent $2200 bank / $500 debt / $1700 net-worth oracle", () => {
    const p = premiumScenario(); const q = input().quotes[0]!;
    const r: HelocRequest = { ...q.request, householdId: p.ids.household, ownerId: p.ids.member, borrowerId: p.ids.member,
      bankAccountId: p.ids.bank, liabilityAccountId: p.ids.principal };
    const bind = (s: Source): Source => ({ ...s, householdId: r.householdId, personId: r.borrowerId,
      bankAccountId: r.bankAccountId, liabilityAccountId: r.liabilityAccountId });
    const bound: HelocRequest = { ...r, source: bind(r.source), interest: { ...r.interest, source: bind(r.interest.source) },
      rate: { ...r.rate!, source: bind(r.rate!.source) },
      events: [{ ...draw(), actorId: r.borrowerId, bankAccountId: r.bankAccountId, source: bind(source()) }] };
    const i: HelocDrawInput = { householdId: r.householdId, personId: r.borrowerId, quotes: [{ ...q, request: bound,
      proposal: proposeHeloc(bound).proposals[0]!, bank: { classification: "BANK", accountId: r.bankAccountId,
        householdId: r.householdId, personId: r.borrowerId, evidence: bind(source()) } }] };
    const state = createAuthoritativeState(p.opening); state.liabilities[p.ids.principal]!.balance = money("0");
    const kernel = applyHouseholdExecutionOverlay(p.attached.kernel, { liabilityInput: undefined,
      cashFlowInput: { ...p.attached.kernel.cash!.input, incomes: [] }, reconciledOpeningState: state });
    const out = runHelocDraws({ kernel, input: i, runContext: p.context }).result;
    expect(out.status, JSON.stringify(out.diagnostics)).toBe("incomplete");
    expect(out.periods).toHaveLength(1);
    const period = out.periods[0]!;
    expect([period.cash, period.liabilities, period.netWorth].map(m => m.amount.toString())).toEqual(["2200", "500", "1700"]);
    expect(period.statements.expenses.equals(money("300"))).toBe(true);
    expect(period.statements.income.isZero()).toBe(true);
    expect(period.transactions.map(t => t.type).sort()).toEqual(["expense_recognition", "expense_settlement", "heloc_draw"]);
    expect(out.state.identities.recognitionIds).toHaveLength(1);
    expect(out.state.identities.settlementIds).toHaveLength(1);
    expect(Object.values(out.state.obligations)).toHaveLength(1);
    expect(Object.values(out.state.obligations)[0]!.outstandingAmount.isZero()).toBe(true);
    expect(out.state.identities.postedTransactionIds).toHaveLength(3);
    const forecast = runHouseholdKernel({ kernel: attachHelocDraws(kernel, i).kernel, runContext: p.context });
    expect(forecast.periods[0]!.statements).toEqual(period.statements);
    expect(replayHouseholdForecastWindow(forecast, period.period).periods).toEqual(out.periods);
    // The same-day premium, loan service and wage case uses the existing actual
    // sources; this adapter must not inherit S8-1's synthetic domain priorities.
    const joint = premiumScenario({ wageDay: "15" });
    const sameDayRequest = { ...bound, events: [{ ...bound.events[0]!, effectiveAt: d("2026-01-15") }] };
    const sameDayInput = { ...i, quotes: [{ ...i.quotes[0]!, request: sameDayRequest, proposal: proposeHeloc(sameDayRequest).proposals[0]! }] };
    const jointOpening = createAuthoritativeState(joint.opening); jointOpening.liabilities[joint.ids.principal]!.balance = money("0");
    const jointKernel = applyHouseholdExecutionOverlay(joint.attached.kernel, { reconciledOpeningState: jointOpening });
    const rejected = runHelocDraws({ kernel: jointKernel, input: sameDayInput, runContext: joint.context }).result;
    expect(rejected.status).toBe("incomplete");
    expect(rejected.diagnostics.map(x => x.code)).toContain("HOUSEHOLD_CONTENTION_UNRESOLVED");
    expect(rejected.state).toEqual(jointOpening);
    expect(rejected.periods).toEqual([]);
  });

  it("retains conditional prep evidence without promoting the catalog", () => {
    const catalog = catalogSchema.parse(JSON.parse(readFileSync(new URL("../../../fixtures/d2/catalog.json", import.meta.url), "utf8")));
    for (const id of ["heloc_draw", "heloc_reset"]) {
      const anchor = catalog.cases.find(c => c.id === id)!;
      expect(anchor.expected.integratedRuntimeEvidence).toBe(false);
      expect(anchor.expected.capability).toBe("decision_required");
    }
  });
});
