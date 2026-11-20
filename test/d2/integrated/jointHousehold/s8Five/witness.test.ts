import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { attachAftertaxPremiums } from "../../../../../src/simulation/d2/integration/aftertaxPremiums/index.js";
import { attachCardBank } from "../../../../../src/simulation/d2/integration/cardBank/index.js";
import { qualifyHelocServicingSource } from "../../../../../src/simulation/d2/integration/helocServicing/index.js";
import { createFundingPolicy, fundingPolicyId } from "../../../../../src/funding/index.js";
import type { PerformanceObserver } from "../../../../../src/diagnostics/index.js";
import { attachSsaMedicare } from "../../../../../src/simulation/d2/integration/ssaMedicare/index.js";
import { applyHouseholdExecutionOverlay, compileHouseholdKernel, replayHouseholdForecastWindow, runHouseholdKernel } from "../../../../../src/simulation/householdExecution.js";
import { runCompiledHouseholdProjection as reference } from "../../../../../src/simulation/r3/referenceHouseholdExecution.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../../../../../src/simulation/r3/replayArtifact.js";
import { canonicalSerialize, runId } from "../../../../../src/simulation/run.js";
import { createAuthoritativeState } from "../../../../../src/state/index.js";
import { civilDate, instant } from "../../../../../src/time/index.js";
import { money } from "../../../../../src/values/index.js";
import { bankFault, context, ids, start } from "./bank.js";
import { publishBenefit, resetBenefits } from "./benefits.js";
import { cashFault, helocReads, publishContendingLoan } from "./cashSources.js";
import { healthFault, publishPremium } from "./healthAndRetirement.js";
import { assertWitness, expectedJournals } from "./oracle.js";
import { household, installPublishers } from "./scenario.js";
import { bytes, reads, testId, type Family, type SourceWork } from "./sourceMeter.js";
import { wageFault } from "./wages.js";

installPublishers();

const detail = ({ kernel, runContext }: ReturnType<typeof household>) => runHouseholdKernel({ kernel, runContext, resultTier: "detail" });
const compact = (period: ReturnType<typeof detail>["periods"][number]) => ({
  period: period.period, cash: period.cash, netWorth: period.netWorth, liabilities: period.liabilities, assets: period.assets,
});

it("matches literal S1–S5 journals and separate BANK balances in one two-person run", () => {
  const witness = household(1), expected = expectedJournals(witness), actual = detail(witness);
  assertWitness(witness, expected, actual);
  const reordered = detail(household(1, { reverse: true }));
  expect(reordered.state).toEqual(actual.state);
  expect(reordered.periods.map(row => row.transactions)).toEqual(actual.periods.map(row => row.transactions));
  const summary = runHouseholdKernel(witness);
  expect(summary.state).toEqual(actual.state);
  expect(summary.periods.map(row => row.netWorth)).toEqual(actual.periods.map(row => row.netWorth));
});

it("checks built-in authenticated VS2 wages and VS4 fixed loans against the frozen reference", () => {
  const witness = household(1);
  // The frozen runner covers built-in cash/loan execution. Native participant
  // parity is unmeasured. Source-specific premium adapters have their own checks.
  const kernel = compileHouseholdKernel(witness.compiled, witness.runContext.simulationStart);
  const actual = runHouseholdKernel({ kernel, runContext: witness.runContext, resultTier: "detail" });
  const expected = reference({ compiled: witness.compiled, runContext: witness.runContext });
  expect(actual.periods).toHaveLength(witness.periods.length);
  expect(expected.periods).toHaveLength(witness.periods.length);
  expect(actual.periods.map(compact)).toEqual(expected.periods.map(compact));
  expect(actual.periods.map(row => row.transactions)).toEqual(expected.periods.map(row => row.transactions));
  expect(actual.state).toEqual(expected.state);
});

it("grows native wages, FSA, card, SSA/CMS, fixed loans and HELOC through 1/12/24 observations", () => {
  const growing: readonly Family[] = ["wage", "wageBank", "fsa", "fsaBank", "card", "cardBank", "lender", "loanBank",
    "ssaAward", "irmaa", "ssaInstallment", "medicareInstallment", "ssaBank", "helocBank"];
  const baseline = new Map<string, SourceWork>();
  const structuralAt12 = new Map<string, number>();
  let portableAt12 = 0;
  const report = (count: number, phase: string, fixture: ReturnType<typeof household>) => {
    for (const family of growing) {
      const observed = reads.get(family);
      expect(observed?.count, `${phase} ${family}`).toBeGreaterThanOrEqual(count);
      expect(observed?.consumedEnvelopeBytes, `${phase} ${family}`).toBeGreaterThan(0);
      const key = `${phase}:${family}`;
      if (count === 12) baseline.set(key, { ...observed! });
      if (count === 24) for (const measure of ["count", "bytes", "consumedEnvelopeBytes"] as const)
        expect(observed![measure], `${key} ${measure}`).toBeLessThanOrEqual(2.5 * baseline.get(key)![measure]);
    }
    const issuerSize = fixture.sources.helocs.reduce((total, item) => total + bytes(item.issuer), 0);
    const issuerRows = fixture.sources.helocs.reduce((total, item) => total + item.issuer.request.checkpoint.history.length, 0);
    const issuer = reads.get("helocIssuer")!;
    expect(issuerRows).toBe(count === 24 ? 276 : count === 12 ? 66 : 0);
    expect(issuer.count).toBeGreaterThanOrEqual(count);
    const passes = phase === "cold" ? 25 : 14;
    expect(issuer.count).toBeLessThanOrEqual(passes * count);
    expect(issuer.bytes).toBeLessThanOrEqual(passes * issuerSize);
    expect(helocReads.historyRows).toBeLessThanOrEqual(passes * issuerRows);
    expect(helocReads.consumedRows).toBe(helocReads.historyRows);
    expect(reads.get("premium")?.count).toBeGreaterThan(0);
    expect(reads.get("premiumBank")?.count).toBeGreaterThan(0);
    // Raw issuer checkpoint bytes/rows count validation and hashing inputs,
    // separately from avoidable archive rereads. The complete original may
    // be checked before and after each selected financial write.
    console.info("S8-5A source work", JSON.stringify({ count, phase, issuerRows, issuerSize, readIssuerRows: helocReads.historyRows,
      consumedIssuerRows: helocReads.consumedRows,
      aftertaxOccurrences: 1, recurringAftertaxScalability: "unmeasured", sources: Object.fromEntries(reads) }));
  };
  const clear = () => { reads.clear(); helocReads.historyRows = 0; helocReads.consumedRows = 0; };
  for (const count of [1, 12, 24] as const) {
    const witness = household(count), expected = expectedJournals(witness);
    clear();
    let beforeRelease: { reads: Record<string, SourceWork>; issuerRows: number } | undefined;
    const counters = new Map<string, number>();
    const observer: PerformanceObserver = { clock: { now: () => performance.now() },
      context: { runId: witness.runContext.runId, dataClassification: "synthetic", modelCounts: { installments: count },
        executionLocation: "local_node", cacheState: "not_applicable" },
      sink: { record: measurement => {
        beforeRelease ??= { reads: Object.fromEntries([...reads].map(([family, work]) => [family, { ...work }])),
          issuerRows: helocReads.consumedRows };
        for (const name of ["stateCurrencyEntriesChecked", "stateCurrencyIndexNodesVisited"]) {
          counters.set(name, Math.max(counters.get(name) ?? 0, measurement.resources?.structuralCounters?.[name] ?? 0));
        }
      } },
    };
    const full = runHouseholdKernel({ ...witness, resultTier: "detail" }, observer);
    assertWitness(witness, expected, full);
    report(count, "detail", witness);
    expect(beforeRelease).toBeDefined();
    const release = Object.fromEntries([...reads].map(([family, work]) => {
      const earlier = beforeRelease!.reads[family];
      return [family, { count: work.count - (earlier?.count ?? 0), bytes: work.bytes - (earlier?.bytes ?? 0),
        consumedEnvelopeBytes: work.consumedEnvelopeBytes - (earlier?.consumedEnvelopeBytes ?? 0) }];
    }));
    expect(release.helocIssuer?.count).toBeGreaterThanOrEqual(count);
    expect(release.helocBank?.count).toBeGreaterThanOrEqual(count);
    for (const [name, measured] of counters) {
      expect(measured, name).toBeGreaterThan(0);
      if (count === 12) structuralAt12.set(name, measured);
      if (count === 24) expect(measured, name).toBeLessThanOrEqual(3 * structuralAt12.get(name)!);
    }
    console.info("S8-5A outward source observations", JSON.stringify({ count, release, counters: Object.fromEntries(counters),
      issuerRowsAtRelease: helocReads.consumedRows - beforeRelease!.issuerRows }));
    clear();
    const summary = runHouseholdKernel(witness);
    expect(summary.state).toEqual(full.state);
    expect(summary.periods.map(row => row.netWorth)).toEqual(full.periods.map(row => row.netWorth));
    report(count, "summary", witness);
    clear();
    const artifact = createPortableHouseholdReplayArtifact(summary);
    expect(artifact.version).toBe("household-replay/v3");
    report(count, "export", witness);
    const wire = JSON.stringify(artifact);
    if (count === 12) portableAt12 = wire.length;
    if (count === 24) expect(wire.length).toBeLessThanOrEqual(2.5 * portableAt12);
    clear();
    const portable: unknown = JSON.parse(wire);
    const restored = restorePortableHouseholdReplayArtifact(portable);
    report(count, "cold", witness);
    expect(restored.periods).toEqual(summary.periods);
    const tail = replayHouseholdForecastWindow(restored, witness.periods.at(-1)!);
    expect(tail.state).toEqual(summary.state);
    expect(tail.periods[0]!.transactions).toEqual(full.periods.at(-1)!.transactions);
  }
}, 120_000);

it("replays earliest, sparse and terminal windows in a fresh publisher process", () => {
  const fixture = household(12), summary = runHouseholdKernel(fixture);
  expect(summary.periods).toHaveLength(14);
  const artifact = createPortableHouseholdReplayArtifact(summary);
  const windows = [fixture.periods[0]!, fixture.periods[12]!, fixture.periods.at(-1)!];
  const full = windows.map(window => replayHouseholdForecastWindow(summary, window));
  expect(full.at(-1)!.state).toEqual(summary.state);
  const folder = mkdtempSync(join(tmpdir(), "pfm-s8-five-"));
  try {
    const payload = join(folder, "portable.json");
    writeFileSync(payload, JSON.stringify({ artifact, windows }));
    const run = (mode: string) => spawnSync(process.execPath, [
      fileURLToPath(new URL("../../../../../node_modules/vite-node/vite-node.mjs", import.meta.url)),
      fileURLToPath(new URL("./portableWorker.ts", import.meta.url)), payload, mode,
    ], { encoding: "utf8", timeout: 90_000, maxBuffer: 12_000_000 });
    const cold = run("available");
    expect(cold.status, cold.stderr).toBe(0);
    expect(JSON.parse(cold.stdout)).toEqual(full.map(value => canonicalSerialize({ state: value.state, periods: value.periods })));
    const withdrawn = run("withdrawn");
    expect(withdrawn.status, withdrawn.stderr).toBe(0);
    expect(JSON.parse(withdrawn.stdout)).toEqual({ rejected: true });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}, 120_000);

it("retains the preceding committed month when an elected source or a later active BANK payment fails", () => {
  const fixture = household(1);
  const summary = runHouseholdKernel(fixture);
  const before = replayHouseholdForecastWindow(summary, fixture.periods[0]!).state;
  for (const mode of ["employer", "member", "late", "duplicate", "withdrawn", "missing", "health"] as const) {
    wageFault.event = "2026-01-05T17:00:00.000Z";
    wageFault.mode = mode;
    const rejected = detail(fixture);
    expect(rejected.periods).toHaveLength(1);
    expect(rejected.state).toEqual(before);
  }
  delete wageFault.mode;
  for (const mode of ["wrong-member", "wrong-owner", "wrong-account", "wrong-household", "late", "revoked", "missing"] as const) {
    bankFault.route = "cardBank";
    bankFault.at = instant("2026-02-15T17:00:00.000Z");
    bankFault.mode = mode;
    // Card issuer authority authenticates the future payment when its prior
    // charge is selected, so loss cannot preserve a fictional pending charge.
    const rejected = detail(fixture);
    expect(rejected.status).toBe("incomplete");
    expect(Object.values(rejected.state.d2SettlementReceipts ?? {}).some(row => row.kind === "card_interest_payment")).toBe(false);
  }
});

it("rejects mismatched run observation, a duplicate source, and a same-amount wrong issuer", () => {
  const fixture = household(1);
  for (const runContext of [
    { ...fixture.runContext, runId: runId(testId(710)) },
    { ...fixture.runContext, asOf: instant("2029-01-02T00:00:00.000Z") },
    { ...fixture.runContext, dataCutoff: instant("2028-12-31T00:00:00.000Z") },
  ]) {
    const result = detail({ ...fixture, runContext });
    expect(result.periods).toEqual([]);
    expect(result.state).toEqual(fixture.opening);
  }
  const sourceId = fixture.sources.cardSourceIds[0]!;
  expect(() => attachCardBank(fixture.kernel, { sourceIds: [sourceId, sourceId] })).toThrow(/Unique source lookup IDs/);
  cashFault.card = row => ({ ...row, payment: { ...row.payment, issuerId: "different-issuer-same-amount" } });
  const rejected = detail(fixture);
  expect(rejected.status).toBe("incomplete");
  const card = fixture.sources.cards[0]!;
  expect(rejected.state.d2PostedTransactions?.[card.charge.operationId]).toBeUndefined();
  expect(rejected.state.liabilities[card.payment.cardAccountId]?.balance).toEqual(money("1000"));
  expect(Object.values(rejected.state.d2SettlementReceipts ?? {}).some(row => row.kind === "card_interest_payment")).toBe(false);
});

it("rolls back when two distinct issuer originals consume the same payment authorization", () => {
  const fixture = household(12);
  const [first, second] = fixture.sources.cards;
  cashFault.card = row => row.sourceId !== second!.sourceId ? row : { ...row, payment: {
    ...row.payment, authorizationId: first!.payment.authorizationId,
  } };
  const rejected = detail(fixture);
  expect(rejected.diagnostics.some(issue => issue.message.includes("Duplicate issuer evidence"))).toBe(true);
  expect(rejected.periods).toHaveLength(0);
  expect(rejected.state).toEqual(fixture.opening);
});

it("rejects overlapping Section 125 and aftertax coverage with the entire elected period rolled back", () => {
  const fixture = household(1, { overlap: true });
  const result = detail(fixture);
  expect(result.diagnostics.some(issue => issue.message.includes("DUPLICATE_PREMIUM_PAYROLL_ROUTE"))).toBe(true);
  expect(result.periods).toHaveLength(1);
  expect(result.state.accounts[ids.bank]!.cash).toEqual(money("9880"));
  expect(result.state.positions).toEqual({});
  expect(result.state.retirementDistributionAllocations).toBeUndefined();
});

it("reauthenticates warm replay against the live payroll insurer and medical originals", () => {
  const fixture = household(1), summary = runHouseholdKernel(fixture);
  expect(summary.periods).toHaveLength(3);
  const wire = JSON.parse(JSON.stringify(createPortableHouseholdReplayArtifact(summary)));
  const restored = restorePortableHouseholdReplayArtifact(wire);
  expect(replayHouseholdForecastWindow(restored, fixture.periods.at(-1)!).state).toEqual(summary.state);
  healthFault.premium = true;
  expect(() => restorePortableHouseholdReplayArtifact(wire)).toThrow();
  expect(() => replayHouseholdForecastWindow(restored, fixture.periods[1]!)).toThrow();
  delete healthFault.premium;
  const missing = fixture.sources.medical[0]!.sourceId;
  cashFault.missing = missing;
  expect(() => restorePortableHouseholdReplayArtifact(wire)).toThrow();
  delete cashFault.missing;
});

it("rejects a household-owned account on the legacy HELOC route", () => {
  const fixture = household(1);
  const opening = createAuthoritativeState({ ...fixture.opening, accounts: { ...fixture.opening.accounts,
    [ids.personBank]: { ...fixture.opening.accounts[ids.personBank]!, ownerId: ids.household },
  } });
  const kernel = applyHouseholdExecutionOverlay(fixture.kernel, { reconciledOpeningState: opening });
  const result = detail({ ...fixture, kernel });
  expect(result.status).toBe("incomplete");
  expect(Object.values(result.state.d2SettlementReceipts ?? {}).some(receipt => receipt.kind === "heloc_phase_service")).toBe(false);
  expect(result.state.accounts[ids.personBank]?.cash).toEqual(money("500"));
  expect(result.state.liabilities[ids.helocPrincipal]?.balance).toEqual(money("1000"));
  const valid = detail(fixture).state;
  expect(() => createAuthoritativeState({ ...valid, accounts: { ...valid.accounts,
    [ids.personBank]: { ...valid.accounts[ids.personBank]!, ownerId: ids.household },
  } })).toThrow();
  cashFault.heloc = row => ({ ...row, request: { ...row.request, line: { ...row.request.line, ownerId: ids.household } } });
  expect(qualifyHelocServicingSource(fixture.sources.helocSourceIds[0]!, fixture.runContext).status).toBe("incomplete");
});

it("rejects an independently qualified later HELOC checkpoint that changes a committed prior row", () => {
  const fixture = household(12), summary = runHouseholdKernel(fixture);
  expect(summary.periods).toHaveLength(14);
  const preceding = replayHouseholdForecastWindow(summary, fixture.periods[2]!).state;
  const [first, second] = fixture.sources.helocs;
  const firstBytes = canonicalSerialize(first);
  cashFault.heloc = row => row.sourceId !== second!.issuer.sourceId ? row : {
    ...row, request: { ...row.request, checkpoint: { ...row.request.checkpoint, originalPrincipal: money("999"),
      history: row.request.checkpoint.history.map(prior => ({ ...prior, principal: money("9"), cash: money("10") })) } },
  };
  expect(qualifyHelocServicingSource(second!.issuer.sourceId, fixture.runContext).status).toBe("qualified");
  const result = detail(fixture);
  expect(result.periods).toHaveLength(3);
  expect(result.state).toEqual(preceding);
  expect(canonicalSerialize(first)).toBe(firstBytes);
}, 45_000);

it("uses explicit policy when approved loan service and the insurer compete for the shared BANK", () => {
  household(1); // Re-establish all independent issuer books and permissions.
  const premium = publishPremium(), loan = publishContendingLoan();
  const runContext = { ...context(1), simulationStart: start };
  const opening = createAuthoritativeState({ accounts: {
    [ids.bank]: { id: ids.bank, kind: "checking", ownerId: ids.household, cash: money("300.37") },
    [ids.personBank]: { id: ids.personBank, kind: "checking", ownerId: ids.bob, cash: money("500") },
  }, liabilities: {
    [loan.principalLiabilityId]: { id: loan.principalLiabilityId, balance: money("99.01") },
    [loan.interestPayableLiabilityId]: { id: loan.interestPayableLiabilityId, balance: money("0") },
    [premium.confirmed[0]!.payable.liabilityId]: { id: premium.confirmed[0]!.payable.liabilityId, balance: money("0") },
  } });
  const base = compileHouseholdKernel({ reconciledOpeningState: opening, reconciledPrimitiveState: {},
    executionMonths: 1, scenarioIdentity: runContext.scenarioId, scenarioBindings: {},
    cashFlowInput: { householdId: ids.household, ownerId: ids.alice, cashAccountId: ids.bank,
      expensePayableLiabilityId: premium.confirmed[0]!.payable.liabilityId, baseCurrency: runContext.baseCurrency,
      incomes: [], expenses: [], events: [] },
    liabilityInput: { householdId: ids.household, ownerId: ids.alice, baseCurrency: runContext.baseCurrency, loans: [loan] },
  }, start);
  const attached = attachAftertaxPremiums({ kernel: base, runContext, asOf: civilDate(runContext.asOf.slice(0, 10)),
    request: premium.request, confirmed: premium.confirmed, representations: [] });
  expect(attached.admittedOperationIds).toHaveLength(1);
  const expenseFirst = { before: "cash_expense_settlement", after: "liability_required_service" } as const;
  const loanFirst = { before: "liability_required_service", after: "cash_expense_settlement" } as const;
  const execute = (rules: readonly (typeof expenseFirst | typeof loanFirst)[]) => {
    const kernel = applyHouseholdExecutionOverlay(attached.kernel, { contentionPolicy: { id: "s8-five-authored-policy", version: "1", rules } });
    return runHouseholdKernel({ kernel, runContext, resultTier: "detail" });
  };
  const paidPremium = execute([expenseFirst]), paidLoan = execute([loanFirst]);
  expect(paidPremium.periods, JSON.stringify(paidPremium.diagnostics)).toHaveLength(1);
  expect(paidPremium.state.accounts[ids.bank]?.cash).toEqual(money("0"));
  expect(paidPremium.state.liabilities[loan.principalLiabilityId]?.balance).toEqual(money("99.01"));
  expect(paidPremium.state.liabilities[loan.interestPayableLiabilityId]?.balance).toEqual(money("0.99"));
  expect(paidPremium.state.d2PostedTransactions?.[premium.original.settlement.id]?.transaction).toEqual(premium.original.settlement);
  expect(paidLoan.periods, JSON.stringify(paidLoan.diagnostics)).toHaveLength(1);
  expect(paidLoan.state.accounts[ids.bank]?.cash).toEqual(money("200.37"));
  expect(paidLoan.state.liabilities[loan.principalLiabilityId]?.balance).toEqual(money("0"));
  expect(paidLoan.state.liabilities[premium.confirmed[0]!.payable.liabilityId]?.balance).toEqual(money("300.37"));
  expect(paidLoan.state.d2PostedTransactions?.[premium.original.settlement.id]).toBeUndefined();
  expect(paidPremium.state.accounts[ids.personBank]).toEqual(opening.accounts[ids.personBank]);
  expect(paidLoan.state.accounts[ids.personBank]).toEqual(opening.accounts[ids.personBank]);
  for (const [rules, error] of [[[], "HOUSEHOLD_CONTENTION_UNRESOLVED"],
    [[expenseFirst, loanFirst], "HOUSEHOLD_CONTENTION_POLICY_CYCLE"]] as const) {
    const rejected = execute(rules);
    expect(rejected.diagnostics.map(row => row.code)).toContain(error);
    expect(rejected.state).toEqual(opening);
  }
  bankFault.route = "loanBank";
  bankFault.mode = "credit-only";
  expect(execute([expenseFirst]).state).toEqual(paidPremium.state);
  const selectedUnauthorized = execute([loanFirst]);
  expect(selectedUnauthorized.diagnostics.map(row => row.code)).toContain("FIXED_LOAN_DEBIT_PERMISSION_DENIED");
  expect(selectedUnauthorized.state).toEqual(opening);
  delete bankFault.mode;
  const split = createFundingPolicy({ id: fundingPolicyId("s8-five-split"), orderedSources: [
    { kind: "cash_account", accountId: ids.bank }, { kind: "cash_account", accountId: ids.personBank },
  ], allowPartial: true, insufficientFundsBehavior: "unfunded" });
  const unsupported = applyHouseholdExecutionOverlay(attached.kernel, {
    liabilityInput: { ...attached.kernel.executable.liabilityInput!, loans: [{ ...loan, fundingPolicy: split }] },
  });
  const rejectedSplit = runHouseholdKernel({ kernel: unsupported, runContext, resultTier: "detail" });
  expect(rejectedSplit.state).toEqual(opening);
  expect(rejectedSplit.periods).toEqual([]);
});

it.each([false, true])("posts the sourced SSA zero-net/one-cent boundary (one cent %s)", oneCent => {
  resetBenefits(true);
  const runContext = { ...context(1), simulationStart: start };
  const base = compileHouseholdKernel({ reconciledOpeningState: createAuthoritativeState({ accounts: {
    [ids.bank]: { id: ids.bank, kind: "checking", ownerId: ids.household, cash: money("100") },
  } }), reconciledPrimitiveState: {}, scenarioBindings: {}, executionMonths: 1, scenarioIdentity: runContext.scenarioId }, start);
  const event = publishBenefit("2026-01", runContext.dataCutoff, oneCent);
  const kernel = attachSsaMedicare(base, { householdId: ids.household, personId: ids.bob, payments: [], nativePayments: [event] });
  const result = runHouseholdKernel({ kernel, runContext, resultTier: "detail" });
  const net = oneCent ? "0.01" : "0";
  expect(result.periods, JSON.stringify(result.diagnostics)).toHaveLength(1);
  expect(result.periods[0]!.transactions).toHaveLength(1);
  expect(result.periods[0]!.transactions[0]!.legs.map(leg => [leg.type, leg.posting, leg.amount.amount.toString()])).toEqual([
    ...(oneCent ? [["cash", "debit", "0.01"]] : []),
    ["expense", "debit", oneCent ? "199.99" : "200"], ["income", "credit", "200"],
  ]);
  const [receipt] = Object.values(result.state.ssaMedicarePayments!);
  expect(receipt?.netBank).toEqual(money(net));
  expect(result.state.accounts[ids.bank]?.cash).toEqual(money(oneCent ? "100.01" : "100"));
});
