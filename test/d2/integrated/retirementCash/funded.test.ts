import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cloneAuthoritativeState, createAuthoritativeState } from "../../../../src/state/index.js";
import { instant } from "../../../../src/time/index.js";
import { money } from "../../../../src/values/index.js";
import { attachRetirementCash, attachFundedRetirementCashSchedule, evaluateFundedRmdSatisfaction } from "../../../../src/simulation/d2/integration/retirementCash/index.js";
import { runHouseholdKernel, replayHouseholdForecastWindow, applyHouseholdExecutionOverlay, type HouseholdKernelParticipant } from "../../../../src/simulation/householdExecution.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { d, fixture, ids, source } from "./scenario.js";
import { rmdObligationId, type RmdRequest } from "../../../../src/simulation/d2/retirement/distributions/index.js";
import { funded, sources } from "./fundedScenario.js";
import { canonicalSerialize, createRunContext } from "../../../../src/simulation/run.js";

const execute = (p = funded(), f = fixture()) => runHouseholdKernel({ kernel: attachRetirementCash(f.kernel, p.cash).kernel,
  runContext: f.context, resultTier: "detail" });
const result = (p: ReturnType<typeof funded>, state: ReturnType<typeof execute>["state"], f = fixture()) =>
  evaluateFundedRmdSatisfaction(p.reference, state, f.context, f.context.simulationEnd);

describe("J2-A actual account-scoped RMD satisfaction", () => {
  it("does not latch June's shortfall when a separately sourced July payment actually funds the balance", () => {
    const f = fixture(2), first = funded(f, "dated:first"), second = funded(fixture(1, undefined, "2026-07"), "dated:second", ["200"]);
    const prior = first.raw.cash.withdrawals.requests[0]!, row = first.raw.binding.allocations[0]!;
    const cash = { ...second.raw.cash, withdrawals: { ...second.raw.cash.withdrawals,
      cash: second.raw.cash.withdrawals.cash.map(a => ({ ...a, liquidity: { ...a.liquidity!, available: money("500") } })),
      usage: { ...second.raw.cash.withdrawals.usage, operationIds: [prior.operationId], withdrawalIds: [prior.withdrawalId],
        authorizationIds: [prior.authorization!.id, ...prior.withholding!.instructions.map(i => i.authorizationId)] } },
      confirmations: second.raw.cash.confirmations.map(q => ({ ...q, sourceCashBefore: money("500"), bankCashBefore: money("700") })) };
    const raw = { ...second.raw, cash, priorOperationIds: [prior.operationId], binding: { ...second.raw.binding, withdrawals: cash.withdrawals,
      usage: { ...second.raw.binding.usage, allocationIds: [row.allocationId], approvalIds: [row.approval!.id] } } };
    sources.set(raw.sourceId, raw);
    const horizon = { start: f.context.simulationStart, end: f.context.simulationEnd };
    const kernel = attachFundedRetirementCashSchedule(f.kernel, { horizon, annualSource: second.reference,
      plans: [{ ...first.cash, fundedRmd: { ...first.reference, horizon } }, { ...cash, fundedRmd: { ...second.reference, horizon } }] });
    const context = createRunContext({ ...f.context, asOf: instant("2026-07-28T00:00:00.000Z"), dataCutoff: instant("2026-07-28T00:00:00.000Z") });
    const out = runHouseholdKernel({ kernel, runContext: context, resultTier: "detail" });
    expect(out.periods, JSON.stringify(out.diagnostics)).toHaveLength(2);
    expect(out.periods[0]!.outputCapabilities?.rmdSatisfaction).toBeUndefined();
    expect(out.periods[1]!.outputCapabilities?.rmdSatisfaction?.status).toBe("complete");
    expect(out.state.accounts[ids.ira]!.cash.equals(money("300"))).toBe(true);
    expect(out.state.accounts[ids.bank]!.cash.equals(money("900"))).toBe(true);
    expect(evaluateFundedRmdSatisfaction({ ...second.reference, horizon }, out.state, context, context.simulationEnd)
      .annual!.obligations[0]!.remaining.isZero()).toBe(true);
  });

  it("credits only actual J1 funding: 700 - 500 = 200; a distinct 200 clears the obligation", () => {
    const f = fixture(), p = funded(f, "one"), out = execute(p, f);
    expect(out.periods, JSON.stringify(out.diagnostics)).toHaveLength(1);
    expect(out.state.accounts[ids.ira]!.cash.equals(money("500"))).toBe(true);
    expect(out.state.accounts[ids.bank]!.cash.equals(money("700"))).toBe(true);
    expect(out.periods[0]!.netWorth.equals(money("1200"))).toBe(true);
    expect(out.periods[0]!.transactions).toHaveLength(1);
    expect(Object.values(out.state.retirementDistributionAllocations!)).toHaveLength(1);
    expect(Object.values(out.state.retirementDistributionAllocations!)[0]!.rmdSatisfaction).toBe("not_applied");
    expect(result(p, out.state).annual!.obligations[0]!.remaining.equals(money("200"))).toBe(true);
    const pair = funded(f, "pair", ["500", "200"]), both = execute(pair, f);
    expect(both.periods, JSON.stringify(both.diagnostics)).toHaveLength(1);
    expect(both.periods[0]!.transactions).toHaveLength(2);
    const annual = result(pair, both.state).annual!.obligations[0]!;
    expect(annual.required.equals(money("700"))).toBe(true);
    expect(annual.satisfied.equals(money("700"))).toBe(true);
    expect(annual.remaining.isZero()).toBe(true);
    expect(both.outputCapabilities?.rmdSatisfaction?.status).toBe("complete");
    expect(both.outputCapabilities?.retirementTax?.status).toBe("incomplete");
    const proposed = funded(f, "proposed", ["700"]);
    expect(result(proposed, f.state).annual!.obligations[0]!.remaining.equals(money("700"))).toBe(true);
  });

  it("revokes only RMD credit when the raw publisher withdraws or amends historical evidence", () => {
    const f = fixture(), p = funded(f, "withdraw-source", ["700"]), out = execute(p, f);
    expect(result(p, out.state).coverage).toBe("complete");
    sources.delete(p.raw.sourceId);
    expect(result(p, out.state).coverage).toBe("incomplete");
    expect(out.state.accounts[ids.bank]!.cash.equals(money("900"))).toBe(true);
    sources.set(p.raw.sourceId, { ...p.raw, binding: { ...p.raw.binding, allocations: [] } });
    const changed = result(p, out.state);
    expect(changed.coverage).toBe("incomplete");
    expect(changed.annual!.obligations[0]!.satisfied.isZero()).toBe(true);
    expect(out.state.accounts[ids.bank]!.cash.equals(money("900"))).toBe(true);
  });

  it("requires the independent provider even when portable raw bytes and proofs are present", () => {
    const f = fixture(), p = funded(f, "missing-publisher");
    sources.delete(p.raw.sourceId);
    const out = execute(p, f);
    expect(out.periods).toEqual([]);
    expect(out.state).toEqual(f.state);
    expect(result(p, out.state).coverage).toBe("incomplete");
  });

  it("never retrospectively converts a legacy cash-only posting into RMD credit", () => {
    const f = fixture(), p = funded(f, "legacy-id"), { fundedRmd: _reference, ...cash } = p.cash;
    const legacy = runHouseholdKernel({ kernel: attachRetirementCash(f.kernel, cash).kernel, runContext: f.context, resultTier: "detail" });
    expect(legacy.periods).toHaveLength(1);
    const replay = execute(p, fixture(1, legacy.state));
    expect(replay.periods).toEqual([]);
    expect(replay.state.accounts[ids.bank]!.cash.equals(money("700"))).toBe(true);
    expect(result(p, replay.state).annual!.obligations[0]!.satisfied.isZero()).toBe(true);
  });

  it("rejects same-date BANK contention before the canonical J1 posting", () => {
    const f = fixture(), p = funded(f, "bank-contention"), attached = attachRetirementCash(f.kernel, p.cash).kernel;
    const contender: HouseholdKernelParticipant = { id: "same-date-bank", version: "v1", economicInputs: {},
      prepare: () => ({ id: "same-date-bank", operations: [{ descriptor: { id: "same-date-bank", domain: "cash_flow",
        operationClass: "cash_income_settlement", sequencingInstant: instant("2026-06-15T00:00:00.000Z"), dependsOn: [],
        resourceAccesses: [{ kind: "account_cash", accountId: ids.bank, mode: "produce" }], traceRefs: [] },
        execute: candidate => ({ ...candidate, facts: {} }) }] }) };
    for (const participants of [[...attached.executable.participants!, contender], [contender, ...attached.executable.participants!]]) {
      const out = runHouseholdKernel({ kernel: applyHouseholdExecutionOverlay(attached, { participants }), runContext: f.context, resultTier: "detail" });
      expect(out.periods).toEqual([]);
      expect(out.state).toEqual(f.state);
      expect(result(p, out.state).annual!.obligations[0]!.satisfied.isZero()).toBe(true);
    }
  });

  it("rejects group allocation before any cash posting", () => {
    const f = fixture(), p = funded(f, "group"), r = p.raw.binding.rmd.requests[0]!;
    sources.set(p.raw.sourceId, { ...p.raw, binding: { ...p.raw.binding, rmd: { ...p.raw.binding.rmd,
      requests: [{ ...r, aggregation: { id: "legal-group", ruleSnapshotId: r.rule!.snapshotId,
        accountIds: [ids.ira], permission: "ira_cross_account", source: r.personSource } }] } } });
    const out = execute(p, f);
    expect(out.periods).toEqual([]);
    expect(out.state).toEqual(f.state);
    expect(out.diagnostics.map(d => d.code)).toContain("RETIREMENT_RMD_UNSUPPORTED_GROUP_JOURNAL");
    expect(result(p, out.state).reason).toBe("unsupported_group_journal");
  });

  it.each(["overallocated", "wrong_person", "wrong_account", "missing_prior_value", "missing_election", "future_known",
    "reversed_year", "duplicate_source", "incomplete_usage", "forged_funding"])("never credits %s", kind => {
    const f = fixture(), p = funded(f, kind), a = p.raw.binding.allocations[0]!, r = p.raw.binding.rmd.requests[0]!;
    let raw = p.raw;
    if (kind === "overallocated") raw = { ...raw, binding: { ...raw.binding, allocations: [{ ...a, amount: money("500.01") }] } };
    if (kind === "wrong_person") raw = { ...raw, binding: { ...raw.binding, allocations: [{ ...a, personId: ids.other }] } };
    if (kind === "wrong_account") raw = { ...raw, binding: { ...raw.binding, allocations: [{ ...a, sourceAccountId: ids.bank }] } };
    if (kind === "missing_prior_value") raw = { ...raw, binding: { ...raw.binding, rmd: { ...raw.binding.rmd,
      requests: [{ ...r, accounts: r.accounts.map(({ priorValue: _value, ...account }) => account) }] } } };
    if (kind === "missing_election") raw = { ...raw, binding: { ...raw.binding, rmd: { ...raw.binding.rmd, requests: [{ ...r, election: "undecided" }] } } };
    if (kind === "future_known") raw = { ...raw, availability: raw.availability.map(a => ({ ...a, knownAt: instant("2026-06-15T00:00:00.001Z") })) };
    if (kind === "reversed_year") raw = { ...raw, binding: { ...raw.binding, rmd: { ...raw.binding.rmd, requests: [{ ...r, taxYear: 2025 }] } } };
    if (kind === "duplicate_source") raw = { ...raw, binding: { ...raw.binding, rmd: { ...raw.binding.rmd,
      requests: [{ ...r, accounts: r.accounts.map(account => ({ ...account, source: { ...account.source, id: r.personSource.id } })) }] } } };
    if (kind === "incomplete_usage") raw = { ...raw, binding: { ...raw.binding, usage: { ...raw.binding.usage, status: "unknown" } } };
    if (kind === "forged_funding") raw = { ...raw, binding: { ...raw.binding, rmd: { ...raw.binding.rmd, distributions: [{
      transactionId: "imported-posted-proof", personId: ids.person, payerOwnerId: ids.person, accountId: ids.ira,
      at: a.effectiveAt, gross: money("700"), kind: "ordinary", authorized: true, funding: "posted_funded", usageRegister: "verified_complete",
      source: a.approval!.rmdSource, allocations: [{ id: "forged", obligationId: a.rmdObligationId, satisfiesRmdYear: 2026, amount: money("700"), historical: true }],
    }] } } };
    sources.set(raw.sourceId, raw);
    const out = execute(p, f);
    expect(out.periods).toEqual([]);
    expect(out.state).toEqual(f.state);
    expect(result(p, out.state).annual?.obligations.every(o => o.satisfied.isZero())).not.toBe(false);
  });

  it("rolls back journal and cash together when a later operation has stale BANK cash", () => {
    const f = fixture(), p = funded(f, "rollback", ["500", "200"]);
    const cash = { ...p.raw.cash, confirmations: p.raw.cash.confirmations.map((q, n) => n ? { ...q, bankCashBefore: money("701") } : q) };
    sources.set(p.raw.sourceId, { ...p.raw, cash });
    const out = execute({ ...p, cash: { ...cash, fundedRmd: p.reference } }, f);
    expect(out.periods).toEqual([]);
    expect(out.state).toEqual(f.state);
    expect(out.state.retirementDistributionAllocations).toBeUndefined();
  });

  it.each([false, true])("splits a real 2027 payment between deferred first-year 2026 and separate 2027 obligations (late=%s)", late => {
    const f = fixture(1, undefined, late ? "2027-06" : "2027-04"), p = funded(f, `first-year:${late}`);
    const original = p.raw.binding.rmd.requests[0]!;
    const first: RmdRequest = { ...original, election: "defer" };
    const current: RmdRequest = { ...original, taxYear: 2027,
      accounts: original.accounts.map(a => ({ ...a, priorValue: { ...a.priorValue!, at: d("2026-12-31") } })),
      rule: { ...original.rule!, snapshotId: "synthetic:2027", originalDue: d("2027-12-31"), deferredDue: d("2028-04-01"),
        earliestSatisfaction: d("2027-01-01"), factors: original.rule!.factors.map(factor => ({ ...factor, ruleSnapshotId: "synthetic:2027", age: 71 })) } };
    const row = p.raw.binding.allocations[0]!, { approval: _approval, ...base } = row;
    const terms1 = { ...base, amount: money("300") };
    const terms2 = { ...base, allocationId: "allocation:current-year", taxYear: 2027,
      rmdObligationId: rmdObligationId(current), ruleSnapshotId: "synthetic:2027", amount: money("200") };
    const cash = { ...p.raw.cash, withdrawals: { ...p.raw.cash.withdrawals, requests: p.raw.cash.withdrawals.requests.map(r => ({ ...r,
      targetObligationIds: [rmdObligationId(first), rmdObligationId(current)] })) } };
    let raw = { ...p.raw, cash, binding: { ...p.raw.binding, withdrawals: cash.withdrawals,
      rmd: { ...p.raw.binding.rmd, requests: [first, current] }, allocations: [
        { ...terms1, approval: { ...row.approval!, terms: terms1 } },
        { ...terms2, approval: { ...row.approval!, id: "approval:current-year", terms: terms2,
          source: source("approval:current-year", ids.person, row.effectiveAt) } },
      ] } };
    if (!late) {
      // Synthetic source observations and exact approvals on the inclusive April 1 deadline.
      const retime = (value: unknown): unknown => typeof value === "string" ? value.replace("2027-04-15", "2027-04-01")
        : Array.isArray(value) ? value.map(retime) : value && Object.getPrototypeOf(value) === Object.prototype
          ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, retime(item)])) : value;
      raw = retime(raw) as typeof raw;
    }
    sources.set(raw.sourceId, raw);
    const out = execute({ ...p, cash: { ...raw.cash, fundedRmd: p.reference } }, f);
    expect(out.periods, JSON.stringify(out.diagnostics)).toHaveLength(1);
    expect(out.periods[0]!.transactions).toHaveLength(1);
    const annual = result(p, out.state, f).annual!;
    const deferred = annual.obligations.find(o => o.taxYear === 2026)!;
    const ordinary = annual.obligations.find(o => o.taxYear === 2027)!;
    expect(deferred.required.equals(money("700"))).toBe(true);
    expect(deferred.remaining.equals(money("400"))).toBe(true);
    expect(deferred.satisfiedOnTime.equals(money(late ? "0" : "300"))).toBe(true);
    expect(deferred.satisfiedLate.equals(money(late ? "300" : "0"))).toBe(true);
    expect(deferred.deadlineShortfall.equals(money(late ? "700" : "400"))).toBe(true);
    expect(ordinary.remaining.equals(money("500"))).toBe(true);
    const record = Object.values(out.state.retirementDistributionAllocations!)[0]!;
    expect(record.allocations).toHaveLength(2);
    expect(record.taxYear).toBe(2027);
    expect(record.allocations.find(a => a.satisfiesRmdYear === 2026)!.deferred).toBe(true);
  });

  it.each([13, 25])("keeps %i-month summary/detail and portable replay deterministic with explicit future-law gaps", months => {
    const f = fixture(months), p = funded(f, `portable:${months}`, ["700"]);
    const kernel = attachRetirementCash(f.kernel, p.cash).kernel;
    const summary = runHouseholdKernel({ kernel, runContext: f.context }), detail = execute(p, f);
    expect(summary.periods, JSON.stringify(summary.diagnostics)).toHaveLength(months);
    expect(summary.state).toEqual(detail.state);
    expect(summary.outputCapabilities?.rmdSatisfaction?.status).toBe("incomplete");
    const restored = restorePortableHouseholdReplayArtifact(JSON.parse(JSON.stringify(createPortableHouseholdReplayArtifact(summary))));
    const selected = detail.periods.at(-1)!.period;
    const once = replayHouseholdForecastWindow(restored, selected), twice = replayHouseholdForecastWindow(restored, selected);
    expect(once.state).toEqual(detail.state);
    expect(twice.state).toEqual(once.state);
    expect(once.periods).toEqual(detail.periods.slice(-1));
    const directory = mkdtempSync(join(tmpdir(), "pfm-funded-rmd-"));
    try {
      const payload = join(directory, "payload.json");
      writeFileSync(payload, JSON.stringify({ artifact: createPortableHouseholdReplayArtifact(summary), selected,
        fundedPlan: { months, label: `portable:${months}`, amounts: ["700"] } }));
      const worker = spawnSync(process.execPath, [fileURLToPath(new URL("../../../../node_modules/vite-node/vite-node.mjs", import.meta.url)),
        fileURLToPath(new URL("./portableWorker.ts", import.meta.url))], {
        env: { ...process.env, PFM_RETIREMENT_CASH_TEST_PAYLOAD: payload }, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
      });
      expect(worker.status, worker.stderr).toBe(0);
      expect(JSON.parse(worker.stdout)).toEqual({ state: canonicalSerialize(once.state), periods: canonicalSerialize(once.periods),
        sourceEvidence: { present: true, qualification: "qualified" }, satisfaction: { coverage: "incomplete",
          reason: "source_not_qualified", satisfied: [canonicalSerialize(money("700"))] } });
      for (const sourceMode of ["absent", "tampered"]) {
        writeFileSync(payload, JSON.stringify({ artifact: createPortableHouseholdReplayArtifact(summary), selected,
          fundedPlan: { months, label: `portable:${months}`, amounts: ["700"] }, sourceMode }));
        const unavailable = spawnSync(process.execPath, [fileURLToPath(new URL("../../../../node_modules/vite-node/vite-node.mjs", import.meta.url)),
          fileURLToPath(new URL("./portableWorker.ts", import.meta.url))], {
          env: { ...process.env, PFM_RETIREMENT_CASH_TEST_PAYLOAD: payload }, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
        });
        expect(unavailable.status, `${sourceMode}: ${unavailable.stderr}`).toBe(0);
        const unverified = JSON.parse(unavailable.stdout);
        expect(unverified.state).toBe(canonicalSerialize(once.state));
        expect(unverified.sourceEvidence).toEqual({ present: sourceMode === "tampered",
          qualification: sourceMode === "tampered" ? "incomplete" : "unavailable" });
        expect(unverified.satisfaction).toEqual({ coverage: "incomplete",
          reason: sourceMode === "tampered" ? "source_not_qualified" : "source_unavailable",
          satisfied: sourceMode === "tampered" ? [canonicalSerialize(money("0"))] : null });
        expect(unverified.newPosting).toEqual({ periods: 0, state: canonicalSerialize(f.state) });
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
    sources.delete(p.raw.sourceId);
    const missing = restorePortableHouseholdReplayArtifact(JSON.parse(JSON.stringify(createPortableHouseholdReplayArtifact(summary))));
    expect(replayHouseholdForecastWindow(missing, selected).state.accounts[ids.bank]!.cash.equals(money("900"))).toBe(true);
    expect(result(p, detail.state, f).coverage).toBe("incomplete");
  }, 60_000);

  it("declines omitted history and orphan journal archives", () => {
    const f = fixture(), p = funded(f, "omission", ["700"]), out = execute(p, f);
    expect(result(p, f.state).annual!.obligations[0]!.satisfied.isZero()).toBe(true);
    const state = cloneAuthoritativeState(out.state);
    expect(() => createAuthoritativeState({ ...state, d2PostedTransactions: {} })).toThrow();
    expect(() => createAuthoritativeState({ ...state, d2PostedTransactions: Object.fromEntries(Object.entries(state.d2PostedTransactions!)
      .map(([id, proof]) => [id, { ...proof, registration: { ...proof.registration, role: "settlement" as const } }])) })).toThrow();
    const omitted = createAuthoritativeState({ accounts: state.accounts });
    const unverified = result(p, omitted);
    expect(unverified.coverage).toBe("incomplete");
    expect(unverified.annual!.obligations[0]!.remaining.equals(money("700"))).toBe(true);
  });
});
