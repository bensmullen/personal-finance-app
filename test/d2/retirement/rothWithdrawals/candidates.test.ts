import { describe, expect, it } from "vitest";
import { civilDate as date } from "../../../../src/time/index.js";
import { Currency, Money, money, USD } from "../../../../src/values/index.js";
import { evaluateRothOrder, type RothOrderInput, type RothRequest, type RothSource, type RothTerms, type RothVintage } from "../../../../src/simulation/d2/retirement/rothOrder/index.js";
import { evaluateRothWithdrawals, type RothCashRequest, type RothWithdrawalInput } from "../../../../src/simulation/d2/retirement/rothWithdrawals/index.js";

// Independent synthetic cent oracles. These sources are not tax law.
const opening = date("2025-12-31"), event = date("2026-01-01");
function source(id: string, resourceId = "person", at = opening): RothSource {
  return { id, resourceId, personId: "person", householdId: "home", ruleSnapshotId: "synthetic-rule", jurisdiction: "US:synthetic",
    ruleFamily: "roth_ira_ordering", sourcePublication: "Synthetic evidence", version: "v1", publishedAt: date("2025-01-01"), asOf: at,
    effectiveFrom: date("2010-01-01"), endExclusive: date("2030-01-01"), projectionStatus: "verified" };
}
function request(amount: string, id: string, sequence: number, at = event): RothRequest {
  const terms: RothTerms = { operationId: `op:${id}`, withdrawalId: `withdrawal:${id}`, authorizationId: `auth:${id}`, personId: "person",
    sourceAccountId: "roth", effectiveAt: at, sequence, gross: money(amount), route: "ordinary_cash" };
  return { ...terms, source: source(`request:${id}`, "roth"), authorization: { terms, permission: "yes", source: source(`order-auth:${id}`, "roth") },
    qualification: { qualifyingCondition: "no", earlyDistribution: "yes", exceptions: "verified_none", source: source(`qualification:${id}`) } };
}
function vintage(id: string, year: number, amount: string): RothVintage {
  return { id, transactionId: `tx:${id}`, accountId: "roth", kind: "conversion", taxYear: year, originatedAt: date(`${year}-06-01`), component: "taxable",
    recaptureStart: date(`${year}-01-01`), recaptureEndExclusive: date(`${year + 5}-01-01`), legalCharacter: "verified_roth_ira_vintage",
    original: money(amount), available: money(amount), source: source(`vintage:${id}`, "roth") };
}
function fixture(amounts = ["100.01"], at = event): RothWithdrawalInput {
  const requests = amounts.map((amount, i) => request(amount, String(i), i, at));
  const order: RothOrderInput = { householdId: "home", personId: "person", taxYear: Number(at.slice(0, 4)), snapshotAt: opening, knownAt: date("2027-01-01"),
    accounts: [{ accountId: "roth", ownerId: "person", family: "roth_ira", taxBucket: "roth", beneficiaryId: null, source: source("account", "roth"),
      cash: { available: money("210.04"), source: source("order-cash", "roth") } }],
    contributions: { original: money("100.01"), available: money("100.01"), source: source("contributions") },
    earnings: { original: money("40.01"), available: money("40.01"), source: source("earnings") },
    vintages: [vintage("old", 2021, "40.01"), vintage("new", 2024, "30.01")], history: [], requests,
    rules: { source: source("rule"), model: "contributions_then_year_fifo_taxable_first_then_earnings", clocks: "independent_five_tax_years",
      qualifiedStart: date("2018-01-01"), qualifiedEndExclusive: date("2023-01-01"), vintageOrder: ["old", "new"] },
    completeness: { source: source("complete"), status: "verified_exhaustive_owner_history", accountIds: ["roth"], vintageIds: ["old", "new"],
      historicalOperationIds: [], historicalWithdrawalIds: [], historicalAuthorizationIds: [], contributions: "verified_actual_regular_basis", earnings: "verified_actual",
      priorConsumption: "verified_complete", cashReservations: "verified_complete", unchangedUntilExclusive: date("2027-01-01"), interveningActivity: "verified_none" } };
  const bank = { id: "bank", institutionId: "institution", ownerId: "person", householdId: "home", kind: "checking" as const, source: source("bank", "bank", at) };
  const routes: RothCashRequest[] = requests.map(r => {
    const id = String(r.sequence), instructionId = `instruction:${id}`, receiptId = `receipt:${id}`, withholdingId = `withholding:${id}`;
    const instructions = ["US:federal", "US:state"].map(jurisdiction => ({ id: `remittance:${id}:${jurisdiction}`, jurisdiction, amount: money("0"),
      authorizationId: `remit-auth:${id}:${jurisdiction}`, destinationId: `tax:${jurisdiction}`, beneficiaryPersonId: "person", route: "qualified_tax_payment" as const,
      source: { ...source(`remittance:${id}:${jurisdiction}`, `remittance:${id}:${jurisdiction}`, at), jurisdiction },
      authorizationSource: { ...source(`remit-auth:${id}:${jurisdiction}`, `remit-auth:${id}:${jurisdiction}`, at), jurisdiction } }));
    return { operationId: r.operationId, withdrawalId: r.withdrawalId, householdId: "home", personId: "person", sourceAccountId: "roth", sourceHoldingId: "cash-holding",
      taxBucket: "roth", kind: "ordinary", effectiveAt: at, grossAmount: r.gross, bank, batchId: "batch", instructionId, receiptId,
      instructionSource: source(instructionId, instructionId, at), targetObligationIds: [],
      withholding: { id: withholdingId, completeness: "verified_complete", source: source(withholdingId, withholdingId, at), instructions },
      authorization: { id: r.authorizationId, operationId: r.operationId, withdrawalId: r.withdrawalId, sourceAccountId: "roth", sourceHoldingId: "cash-holding",
        bankId: "bank", bankInstitutionId: "institution", bankKind: "checking", withholdingId, grossAmount: r.gross, effectiveAt: at,
        routing: "cash_only_all_or_none", source: source(`routing-auth:${id}`, r.authorizationId, at), batchId: "batch", instructionId, receiptId,
        withholdingTerms: instructions.map(({ source: _s, authorizationSource: _a, ...terms }) => terms) } };
  });
  return { order, batchId: "batch", requests: routes, banks: [bank],
    cash: [{ accountId: "roth", holdingId: "cash-holding", holdingSource: source("holding", "cash-holding"), ownerId: "person", householdId: "home",
      instrumentFamily: "roth_ira", taxBucket: "roth", beneficiaryId: null, eligibility: "eligible_ordinary_cash", unsupportedRules: [], eligibilitySource: source("eligibility", "roth"),
      liquidity: { kind: "available_unencumbered_account_cash", available: money("210.04"), at: opening, settledAt: opening,
        contention: "complete_external_reservations", source: source("liquidity", "roth") } }],
    usage: { status: "verified_complete", operationIds: [], withdrawalIds: [], authorizationIds: [], instructionIds: [], receiptIds: [], batchIds: [],
      source: { ...source("usage", "home"), personId: "*" } } };
}
const route = (f: RothWithdrawalInput, patch: Partial<RothCashRequest>, index = 0): RothWithdrawalInput => ({ ...f,
  requests: f.requests.map((r, i) => i === index ? { ...r, ...patch } : r) });
function denied(f: RothWithdrawalInput, code?: string): void {
  const before = JSON.stringify(f), result = evaluateRothWithdrawals(f);
  expect(result.coverage).toBe("incomplete"); expect(result.candidates).toEqual([]);
  expect(result.diagnostics).toHaveLength(1); expect(result.diagnostics[0]?.seam).toBe("S7");
  if (code) expect(result.diagnostics[0]?.diagnosticCode).toBe(code);
  expect(result.tax).toBe("incomplete"); expect(result.postable).toBe(false);
  expect(JSON.stringify(f)).toBe(before);
}

describe("A4-3 conditional ordinary owner Roth cash candidates", () => {
  it("recovers exactly 10,001 cents of regular basis with sourced zero withholding and no new economic income", () => {
    const f = fixture(), result = evaluateRothWithdrawals(f), c = result.candidates[0]!;
    expect(result.coverage).toBe("conditional"); expect(result.diagnostics).toEqual([]);
    expect(c.rothOrder).toEqual(evaluateRothOrder(f.order).proposals[0]);
    expect(c.rothOrder.components.map(x => [x.character, x.amount.amount.toString()])).toEqual([["regular_contribution_basis", "100.01"]]);
    expect(c).toMatchObject({ operationId: "op:0", claimId: "withdrawal:0", authorizationId: "auth:0", instructionId: "instruction:0", receiptId: "receipt:0",
      batchId: "batch", householdId: "home", actorId: "person", sourceAccountId: "roth", sourceHoldingId: "cash-holding", destinationAccountId: "bank",
      committed: false, postable: false, principalTransfer: "net_worth_neutral", taxCompleteness: "incomplete" });
    expect(c.grossAmount.equals(money("100.01"))).toBe(true); expect(c.netAmount.equals(c.grossAmount)).toBe(true); expect(c.withholdingAmount.isZero()).toBe(true);
    expect(c.intents[0]!.resourceId).toBe("cash-holding");
    expect(c.intents.slice(1).reduce((sum, i) => sum.plus(i.amount), Money.zero(USD)).equals(c.grossAmount)).toBe(true);
    expect(c.incrementalEconomicIncome.isZero() && c.incrementalEconomicExpense.isZero()).toBe(true);
    expect(result).toMatchObject({ funding: "incomplete", bankSettlement: "incomplete", tax: "incomplete", penalties: "incomplete", withholdingCreditSettlement: "incomplete", futureLaw: "incomplete" });
  });

  it("allocates contributions, two conversion vintages and earnings once across three requests sharing 21,004 cash cents", () => {
    const f = fixture(["80.01", "70.02", "60.01"]), result = evaluateRothWithdrawals(f);
    expect(result.coverage).toBe("conditional");
    expect(result.candidates.map(c => c.rothOrder.components.map(x => [x.character, x.vintageId, x.amount.amount.toString()]))).toEqual([
      [["regular_contribution_basis", null, "80.01"]],
      [["regular_contribution_basis", null, "20"], ["conversion_taxable_basis", "old", "40.01"], ["conversion_taxable_basis", "new", "10.01"]],
      [["conversion_taxable_basis", "new", "20"], ["earnings", null, "40.01"]],
    ]);
    expect(result.candidates.map(c => c.rothOrder)).toEqual(evaluateRothOrder(f.order).proposals);
    expect(result.candidates.reduce((sum, c) => sum.plus(c.grossAmount), money("0")).equals(money("210.04"))).toBe(true);
    expect(result.candidates[2]!.rothOrder.components[1]!.incomeCandidate.equals(money("40.01"))).toBe(true);
    const overdrawn = fixture(["80.01", "70.02", "60.02"]);
    // Raise ONLY attested earnings: the failing resource must be actual cash.
    denied({ ...overdrawn, order: { ...overdrawn.order, earnings: { ...overdrawn.order.earnings, original: money("40.02"), available: money("40.02") } } }, "ROTH_ORDER:HISTORY_OR_BATCH_OVERSPEND");
  });

  it("preserves separate qualification and vintage clocks on both sides of January 1", () => {
    for (const [at, qualified, oldClock] of [[opening, false, "open"], [event, true, "elapsed"]] as const) {
      const f = fixture(["210.04"], at);
      const order = { ...f.order, vintages: f.order.vintages.filter(v => v.id === "new"),
        contributions: { ...f.order.contributions, original: money("140.02"), available: money("140.02") },
        rules: { ...f.order.rules!, qualifiedStart: date("2021-01-01"), qualifiedEndExclusive: date("2026-01-01"), vintageOrder: ["new"] },
        completeness: { ...f.order.completeness!, vintageIds: ["new"] },
        requests: f.order.requests.map(r => ({ ...r, qualification: { ...r.qualification, qualifyingCondition: "yes" as const } })) };
      const c = evaluateRothWithdrawals({ ...f, order }).candidates[0]!;
      expect(c.rothOrder.qualified).toBe(qualified);
      expect(c.rothOrder.components.at(-1)!.clock).toBe(oldClock);
      expect(c.rothOrder.components.at(-1)!.incomeCandidate.equals(money(qualified ? "0" : "40.01"))).toBe(true);
      expect(c.rothOrder.components[1]!.clock).toBe("open");
      expect(c.rothOrder.components[1]!.conversionRecaptureCandidate.equals(money(qualified ? "0" : "30.01"))).toBe(true);
      expect(c.taxCompleteness).toBe("incomplete");
      const independent = fixture(["140.02"], at), p = evaluateRothWithdrawals(independent).candidates[0]!.rothOrder;
      expect(p.qualified).toBe(false); expect(p.components[1]!.clock).toBe(oldClock);
    }
    const f = fixture();
    denied({ ...f, order: { ...f.order, taxYear: 2025 } }, "ROTH_ORDER:UNCOVERED_EVENT_WINDOW");
    denied({ ...f, order: { ...f.order, vintages: f.order.vintages.map(v => ({ ...v, recaptureEndExclusive: date("2029-01-01") })) } }, "ROTH_ORDER:UNSUPPORTED_FIVE_YEAR_CLOCK");
  });

  it("requires contribution history and consistent funded-use registers without inventing zero taxable income", () => {
    const f = fixture();
    denied({ ...f, order: { ...f.order, completeness: { ...f.order.completeness!, contributions: "unknown" } } }, "ROTH_ORDER:UNKNOWN_BASIS_HISTORY_OR_ACTIVITY");
    denied({ ...f, order: { ...f.order, contributions: undefined } } as unknown as RothWithdrawalInput);
    denied({ ...f, usage: { ...f.usage, withdrawalIds: ["previously-funded"] } }, "HISTORY_USAGE_CONFLICT");
    const history = { operationId: "past-op", withdrawalId: "past-withdrawal", authorizationId: "past-auth", accountId: "roth", effectiveAt: date("2025-06-01"),
      gross: money("20.01"), contributions: money("20.01"), earnings: money("0"), vintages: [], source: source("history", "roth") };
    const order = { ...f.order, history: [history], contributions: { ...f.order.contributions, available: money("80") },
      completeness: { ...f.order.completeness!, historicalOperationIds: ["past-op"], historicalWithdrawalIds: ["past-withdrawal"], historicalAuthorizationIds: ["past-auth"] } };
    denied({ ...f, order }, "HISTORY_USAGE_CONFLICT");
    const reconciled = { ...f, order, usage: { ...f.usage, operationIds: ["past-op"], withdrawalIds: ["past-withdrawal"], authorizationIds: ["past-auth"] } };
    expect(evaluateRothWithdrawals(reconciled).candidates[0]!.rothOrder.components.map(c => c.amount.amount.toString())).toEqual(["80", "20.01"]);
    denied({ ...reconciled, order: { ...order, contributions: { ...order.contributions, available: money("100.01") } } }, "ROTH_ORDER:UNRECONCILED_PRIOR_CONSUMPTION");
  });

  it("preserves source-admitted same-year conversion subcomponents and rollover character", () => {
    const f = fixture(["200.04"]), taxable = f.order.vintages[1]!;
    const basis: RothVintage = { ...taxable, id: "new-basis", component: "nontaxable", original: money("10.01"), available: money("10.01"),
      source: source("new-basis", "roth") };
    const rollover: RothVintage = { ...taxable, id: "rollover", transactionId: "rollover-tx", kind: "rollover", original: money("5.01"), available: money("5.01"),
      source: source("rollover", "roth") };
    const order: RothOrderInput = { ...f.order, vintages: [...f.order.vintages, basis, rollover],
      rules: { ...f.order.rules!, vintageOrder: ["old", "new", "rollover", "new-basis"] },
      completeness: { ...f.order.completeness!, vintageIds: ["old", "new", "new-basis", "rollover"] } };
    const c = evaluateRothWithdrawals({ ...f, order }).candidates[0]!;
    expect(c.rothOrder).toEqual(evaluateRothOrder(order).proposals[0]);
    expect(c.rothOrder.components.map(c => [c.character, c.amount.amount.toString()])).toEqual([
      ["regular_contribution_basis", "100.01"], ["conversion_taxable_basis", "40.01"], ["conversion_taxable_basis", "30.01"],
      ["rollover_taxable_basis", "5.01"], ["conversion_nontaxable_basis", "10.01"], ["earnings", "14.99"],
    ]);
    denied({ ...f, order: { ...order, rules: { ...order.rules!, vintageOrder: ["old", "new-basis", "new", "rollover"] } } }, "ROTH_ORDER:NONSTATUTORY_VINTAGE_ORDER");
    denied({ ...f, order: { ...order, vintages: order.vintages.map(v => v.id === "rollover" ? { ...v, legalCharacter: "unknown" } : v) } }, "ROTH_ORDER:UNQUALIFIED_VINTAGE");
  });

  it("rejects absent/unknown withholding and instructions atomically, including missing amounts", () => {
    const f = fixture(["50", "50"]), r = f.requests[1]!;
    const { withholding: _w, ...noWithholding } = r, { authorization: _a, ...noAuth } = r;
    denied({ ...f, requests: [f.requests[0]!, noWithholding] });
    denied({ ...f, requests: [f.requests[0]!, noAuth] });
    denied(route(f, { withholding: { ...r.withholding!, instructions: [] } }, 1), "INCOMPLETE_WITHHOLDING");
    denied(route(f, { withholding: { ...r.withholding!, completeness: "unknown" } }, 1), "INCOMPLETE_WITHHOLDING");
    denied(route(f, { withholding: { ...r.withholding!, instructions: r.withholding!.instructions.map(i => ({ ...i, amount: undefined })) } } as unknown as Partial<RothCashRequest>, 1), "INVALID_EXACT_CENTS");
    denied(route(f, { instructionSource: undefined } as unknown as Partial<RothCashRequest>, 1), "MALFORMED_INPUT");
    denied({ ...f, order: { ...f.order, requests: f.order.requests.map(r => ({ ...r, qualification: { ...r.qualification, qualifyingCondition: "unknown" } })) } }, "ROTH_ORDER:UNKNOWN_QUALIFICATION_OR_EXCEPTION");
  });

  it("binds authorized withholding to exact jurisdictions, cents, beneficiaries and routes", () => {
    const f = fixture(), r = f.requests[0]!;
    const instructions = r.withholding!.instructions.map((i, n) => ({ ...i, amount: money(n === 0 ? "10.01" : "2.02") }));
    const paid = route(f, { withholding: { ...r.withholding!, instructions }, authorization: { ...r.authorization!, withholdingTerms: instructions } });
    const c = evaluateRothWithdrawals(paid).candidates[0]!;
    expect(c.netAmount.equals(money("87.98"))).toBe(true);
    expect(c.withholdingAmount.equals(money("12.03"))).toBe(true);
    expect(c.intents.slice(1).reduce((s, i) => s.plus(i.amount), money("0")).equals(c.grossAmount)).toBe(true);
    denied(route(f, { withholding: { ...r.withholding!, instructions } }), "AUTHORIZATION_TERMS");
    for (const change of [{ beneficiaryPersonId: "spouse" }, { destinationId: "bank" }, { route: "unknown" as const }, { jurisdiction: "wrong" }]) {
      denied(route(f, { withholding: { ...r.withholding!, instructions: r.withholding!.instructions.map(i => ({ ...i, ...change })) } }), "WITHHOLDING_ROUTE");
    }
    denied(route(f, { withholding: { ...r.withholding!, source: { ...r.withholding!.source, asOf: opening } } }), "INCOMPLETE_WITHHOLDING");
  });

  it("rejects double authorization, instruction, receipt and batch reuse", () => {
    const f = fixture(["50", "50"]), a = f.requests[0]!, b = f.requests[1]!;
    denied(route(f, { authorization: { ...b.authorization!, id: a.authorization!.id } }, 1), "REUSED_OR_MISSING_IDENTITY");
    denied(route(f, { receiptId: a.receiptId }, 1), "REUSED_OR_MISSING_IDENTITY");
    denied(route(f, { instructionId: a.instructionId }, 1), "REUSED_OR_MISSING_IDENTITY");
    denied({ ...f, usage: { ...f.usage, authorizationIds: [a.authorization!.id] } }, "REUSED_OR_MISSING_IDENTITY");
    denied({ ...f, usage: { ...f.usage, authorizationIds: [a.withholding!.instructions[0]!.authorizationId] } }, "REUSED_OR_MISSING_IDENTITY");
    denied({ ...f, usage: { ...f.usage, receiptIds: [a.receiptId] } }, "REUSED_OR_MISSING_IDENTITY");
    denied({ ...f, usage: { ...f.usage, batchIds: [f.batchId] } }, "REUSED_BATCH");
    denied(route(f, { receiptId: a.withdrawalId }), "COLLIDING_IDENTITY_ROLES");
    denied({ ...f, order: { ...f.order, requests: [f.order.requests[0]!, { ...f.order.requests[1]!, authorizationId: "auth:0" }] } }, "ROTH_ORDER:REUSED_OPERATION_WITHDRAWAL_OR_AUTHORIZATION");
  });

  it("rejects inaccurate or ambiguous BANK proof, owner/account/date and authorization mismatches", () => {
    const f = fixture(), r = f.requests[0]!;
    denied({ ...f, banks: [r.bank, r.bank] }, "AMBIGUOUS_BANK");
    denied({ ...f, banks: [] }, "UNMAPPED_BANK");
    for (const change of [{ institutionId: "wrong" }, { kind: "other" as const }, { ownerId: "spouse" }]) {
      denied(route(f, { bank: { ...r.bank, ...change } }), "BANK_ROUTE_MISMATCH");
    }
    for (const change of [{ receiptId: "wrong" }, { bankId: "wrong" }, { grossAmount: money("100") }, { effectiveAt: opening }, { sourceHoldingId: "wrong" }]) {
      denied(route(f, { authorization: { ...r.authorization!, ...change } }), "AUTHORIZATION_TERMS");
    }
    for (const change of [{ personId: "spouse" }, { effectiveAt: opening }, { grossAmount: money("100") }, { sourceAccountId: "other" }, { batchId: "wrong" }]) {
      denied(route(f, change), "ORDER_TERMS_MISMATCH");
    }
    denied(route(f, { sourceHoldingId: "other" }), "SOURCE_ACCOUNT_OR_HOLDING");
  });

  it("refuses future sources, wrong buckets, unsupported variants and portfolio value as cash", () => {
    const f = fixture(), r = f.requests[0]!, c = f.cash[0]!;
    for (const change of [{ projectionStatus: "explicit_projected" as const }, { asOf: date("2026-01-02") }, { endExclusive: event }]) {
      denied(route(f, { instructionSource: { ...r.instructionSource, ...change } }), "UNAVAILABLE_SOURCE");
    }
    denied(route(f, { bank: { ...r.bank, source: { ...r.bank.source, version: "conflicting" } } }), "CONFLICTING_SOURCE_ID");
    for (const kind of ["in_kind", "rollover", "conversion", "qcd", "inherited"] as const) denied(route(f, { kind }), "UNSUPPORTED_ROUTE");
    denied(route(f, { kind: "hardship" } as unknown as Partial<RothCashRequest>), "UNSUPPORTED_ROUTE");
    denied(route(f, { kind: "corrective" } as unknown as Partial<RothCashRequest>), "UNSUPPORTED_ROUTE");
    denied(route(f, { taxBucket: "pretax" }), "UNSUPPORTED_ROUTE");
    for (const patch of [{ instrumentFamily: "workplace_plan" as const }, { taxBucket: "mixed" as const }, { beneficiaryId: "heir" }]) {
      denied({ ...f, cash: [{ ...c, ...patch }] }, "SOURCE_ACCOUNT_OR_HOLDING");
    }
    const { liquidity: _l, ...noCash } = c;
    denied({ ...f, cash: [noCash] }, "MISSING_ACTUAL_CASH");
    for (const patch of [{ available: money("210.05") }, { contention: "unknown" as const }, { settledAt: event }, { at: event }]) {
      denied({ ...f, cash: [{ ...c, liquidity: { ...c.liquidity!, ...patch } }] }, "CASH_SNAPSHOT_MISMATCH");
    }
    for (const grossAmount of [money("0.001"), money("-1"), money("1", Currency.of("EUR"))]) denied(route(f, { grossAmount }), "INVALID_EXACT_CENTS");
  });

  it("replays with stable names under independent fact reordering and freezes detached outputs only", () => {
    const f = fixture(["80.01", "70.02", "60.01"]), before = JSON.stringify(f), result = evaluateRothWithdrawals(f);
    expect(evaluateRothWithdrawals(f)).toEqual(result); expect(JSON.stringify(f)).toBe(before);
    const reversed = { ...f, requests: [...f.requests].reverse().map(r => ({ ...r, withholding: { ...r.withholding!, instructions: [...r.withholding!.instructions].reverse() },
      authorization: { ...r.authorization!, withholdingTerms: [...r.authorization!.withholdingTerms].reverse() } })), cash: [...f.cash].reverse(), banks: [...f.banks].reverse(),
      order: { ...f.order, requests: [...f.order.requests].reverse(), vintages: [...f.order.vintages].reverse(),
        completeness: { ...f.order.completeness!, vintageIds: [...f.order.completeness!.vintageIds].reverse() } } };
    expect(evaluateRothWithdrawals(reversed)).toEqual(result);
    expect(Object.isFrozen(f)).toBe(false); expect(Object.isFrozen(f.requests[0]!.bank)).toBe(false);
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.candidates[0]!.rothOrder.components)).toBe(true);
    expect(() => (result.candidates as unknown as unknown[]).push({})).toThrow();
  });
});
