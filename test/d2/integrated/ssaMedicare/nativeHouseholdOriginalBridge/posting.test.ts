import { beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { attachSsaMedicare } from "../../../../../src/simulation/d2/integration/ssaMedicare/index.js";
import { replayHouseholdForecastWindow, runHouseholdKernel } from "../../../../../src/simulation/householdExecution.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../../../../../src/simulation/r3/replayArtifact.js";
import { canonicalSerialize, createInputFingerprint } from "../../../../../src/simulation/run.js";
import { applySsaMedicarePaymentAtomically, createAuthoritativeState } from "../../../../../src/state/index.js";
import { instant } from "../../../../../src/time/index.js";
import { money } from "../../../../../src/values/index.js";
import { ValidationError } from "../../../../../src/diagnostics/index.js";
import { expandedWire, replaceWireField, wireField, wireItems } from "../../sharedReceipts/wireFixture.js";
import { fixture, ids, input, payment } from "../scenario.js";
import { originalPayment, second } from "../originalScenario.js";
import { amendMedicare, bankPermission, control, faults, nativeFixture, publish, registerTestOriginals, resetNativeSources } from "./sources.js";

registerTestOriginals();
beforeEach(resetNativeSources);

const cases = [
  [[], "1500", "0", "1500"],
  [["part_b"], "1500", "80", "1420"],
  [["part_d"], "1500", "120", "1380"],
  [["part_b", "part_d"], "1500", "200", "1300"],
  [["part_b", "part_d"], "200", "200", "0"],
] as const;

describe("independent native SSA and Medicare originals", () => {
  it.each(cases)("posts %j once with gross %s, expense %s and net %s", (elected, gross, expense, net) => {
    control.zeroNet = gross === "200";
    const { kernel, context } = nativeFixture(1, 1, elected);
    const detail = runHouseholdKernel({ kernel, runContext: context, resultTier: "detail" });
    expect(detail.periods, JSON.stringify(detail.diagnostics)).toHaveLength(1);
    const period = detail.periods[0]!;
    expect(period.transactions).toHaveLength(1);
    expect(period.transactions[0]!.legs.map(leg => [leg.type, leg.posting, leg.amount.amount.toString()])).toEqual([
      ...(net === "0" ? [] : [["cash", "debit", net]]),
      ...(expense === "0" ? [] : [["expense", "debit", expense]]),
      ["income", "credit", gross],
    ]);
    expect(Object.values(detail.state.obligations)).toHaveLength(elected.length + 1);
    expect(Object.values(detail.state.obligations).every(claim => claim.outstandingAmount.isZero() && claim.settlementIds.length === 1)).toBe(true);
    const [receipt] = Object.values(detail.state.ssaMedicarePayments ?? {});
    expect(receipt?.version).toBe("ssa-medicare-payment/v3");
    expect(receipt?.requests.map(request => request.terms.premium.part)).toEqual(elected);
    expect(receipt?.nativeHousehold?.originals.map(witness => witness.original.family)).toEqual(["ssa", "medicare"]);
    expect(receipt?.nativeHousehold?.context).toMatchObject({ runId: context.runId, asOf: context.asOf, dataCutoff: context.dataCutoff });
    expect(detail.state.d2PostedTransactions?.[receipt!.transaction.id]?.transaction).toEqual(receipt!.transaction);
    expect(detail.state.accounts[ids.bank]!.cash.equals(money("2000").plus(money(net)))).toBe(true);
    expect(period.outputCapabilities?.netIncome?.status).toBe("incomplete");
    const summary = runHouseholdKernel({ kernel, runContext: context });
    expect(summary.state).toEqual(detail.state);
    const artifact = createPortableHouseholdReplayArtifact(summary);
    const restored = restorePortableHouseholdReplayArtifact(JSON.parse(JSON.stringify(artifact)));
    expect(replayHouseholdForecastWindow(restored, period.period).state).toEqual(detail.state);
  });

  it("refuses missing election evidence and unavailable or incomplete originals without a commit", () => {
    const { state, context } = nativeFixture(1);
    const unbound = fixture(1, state, "2026-01").kernel;
    const event = publish("2026-01", [], true);
    const kernel = attachSsaMedicare(unbound, { ...input([]), nativePayments: [event] });
    for (const reject of [() => {}, () => { faults.unavailable = event.eventId; }, () => {
      faults.unavailable = ""; faults.incomplete = event.eventId;
    }]) {
      reject();
      const result = runHouseholdKernel({ kernel, runContext: context, resultTier: "detail" });
      expect(result.periods).toHaveLength(0);
      expect(result.state.accounts[ids.bank]!.cash.equals(money("2000"))).toBe(true);
      expect(Object.values(result.state.ssaMedicarePayments ?? {})).toHaveLength(0);
      expect(Object.values(result.state.d2PostedTransactions ?? {})).toHaveLength(0);
    }
    expect(() => attachSsaMedicare(unbound, { ...input([]), nativePayments: [event, event] })).toThrow();
    expect(() => attachSsaMedicare(unbound, { ...input([payment("2026-01")]), nativePayments: [event] })).toThrow();
  });

  it("refuses a source race, and keeps the prior period when the second source disappears", () => {
    const { kernel, context, events } = nativeFixture(3, 2);
    faults.race = events[0]!.eventId;
    const refused = runHouseholdKernel({ kernel, runContext: context });
    expect(refused.periods).toHaveLength(0);
    expect(refused.state.accounts[ids.bank]!.cash.equals(money("2000"))).toBe(true);
    faults.race = "";
    faults.unavailable = events[1]!.eventId;
    const stopped = runHouseholdKernel({ kernel, runContext: context });
    expect(stopped.periods).toHaveLength(1);
    expect(stopped.state.accounts[ids.bank]!.cash.equals(money("3300"))).toBe(true);
    expect(Object.keys(stopped.state.d2PostedTransactions ?? {})).toEqual([events[0]!.eventId]);
    // The attempted month and the event outside the run have no committed frontier.
    const artifact = createPortableHouseholdReplayArtifact(stopped);
    expect(restorePortableHouseholdReplayArtifact(artifact).periods).toEqual(stopped.periods);
  });

  it("qualifies two members and their own BANK permissions independently", () => {
    const first = publish("2026-01", ["part_b"]), other = publish("2026-01", ["part_d"], false, second.person);
    const state = createAuthoritativeState({ accounts: {
      [ids.bank]: { id: ids.bank, kind: "checking", ownerId: ids.household, cash: money("2000") },
      [other.bankAccountId]: { id: other.bankAccountId, kind: "savings", ownerId: ids.household, cash: money("1000") },
    } });
    // The S1 original for this second account is checking.
    const mismatched = fixture(1, state, "2026-01");
    const attach = (kernel: typeof mismatched.kernel) => attachSsaMedicare(kernel, {
      ...input([]), memberIds: [first.personId, other.personId], nativePayments: [other, first],
    });
    expect(runHouseholdKernel({ kernel: attach(mismatched.kernel), runContext: mismatched.context }).periods).toHaveLength(0);
    state.accounts[other.bankAccountId] = { ...state.accounts[other.bankAccountId]!, kind: "checking" };
    const wrongOwner = fixture(1, state, "2026-01");
    expect(runHouseholdKernel({ kernel: attach(wrongOwner.kernel), runContext: wrongOwner.context }).periods).toHaveLength(0);
    state.accounts[other.bankAccountId] = { ...state.accounts[other.bankAccountId]!, ownerId: second.person };
    const { kernel, context } = fixture(1, state, "2026-01");
    bankPermission.allowSecondCredit = false;
    const refused = runHouseholdKernel({ kernel: attach(kernel), runContext: context });
    expect(refused.periods).toHaveLength(0);
    expect(refused.state.accounts[other.bankAccountId]!.cash.equals(money("1000"))).toBe(true);
    expect(Object.keys(refused.state.d2PostedTransactions ?? {})).toHaveLength(0);
    bankPermission.allowSecondCredit = true;
    const result = runHouseholdKernel({ kernel: attach(kernel), runContext: context });
    expect(result.periods, JSON.stringify(result.diagnostics)).toHaveLength(1);
    expect(result.state.accounts[ids.bank]!.cash.equals(money("3420"))).toBe(true);
    expect(result.state.accounts[other.bankAccountId]!.cash.equals(money("2380"))).toBe(true);
    expect(Object.keys(result.state.d2PostedTransactions ?? {})).toHaveLength(2);
    const secondProof = Object.values(result.state.d2PostedTransactions ?? {}).find(proof => proof.transaction.id === other.eventId);
    expect(secondProof?.registration.nativeHousehold?.route?.personOwnerId).toBe(second.person);
    const artifact = JSON.parse(JSON.stringify(createPortableHouseholdReplayArtifact(result)));
    expect(restorePortableHouseholdReplayArtifact(artifact).periods).toEqual(result.periods);
    bankPermission.allowSecondCredit = false;
    expect(() => restorePortableHouseholdReplayArtifact(JSON.parse(JSON.stringify(artifact)))).toThrow("HOUSEHOLD_REPLAY_BASIS_MISMATCH");
  });

  it("validates nonzero IRMAA and rejects changed same-amount original facts on the next admission", () => {
    control.surcharged = true;
    const { kernel, context, events } = nativeFixture(1);
    const result = runHouseholdKernel({ kernel, runContext: context });
    const [receipt] = Object.values(result.state.ssaMedicarePayments ?? {});
    expect(receipt?.requests.map(request => request.terms.premium.irmaa.amount.toString())).toEqual(["10", "20"]);
    expect(result.state.accounts[ids.bank]!.cash.equals(money("3300"))).toBe(true);
    const artifact = createPortableHouseholdReplayArtifact(result);
    expect(restorePortableHouseholdReplayArtifact(artifact).periods).toEqual(result.periods);
    amendMedicare(events[0]!, original => ({ ...original, irmaa: { ...original.irmaa,
      histories: original.irmaa.histories.map(history => ({ ...history, magi: money("0.01") })) } }));
    expect(() => restorePortableHouseholdReplayArtifact(artifact)).toThrow("HOUSEHOLD_REPLAY_BASIS_MISMATCH");
  });

  it("refuses a forged direct journal source or the wrong writer run before mutating state", () => {
    const { kernel, context, state } = nativeFixture(1);
    const forecast = runHouseholdKernel({ kernel, runContext: context });
    const [receipt] = Object.values(forecast.state.ssaMedicarePayments ?? {});
    expect(receipt).toBeDefined();
    expect(() => applySsaMedicarePaymentAtomically(state, receipt!, { ...context, runId: "different-run" })).toThrow("actual run");
    expect(() => applySsaMedicarePaymentAtomically(state, { ...receipt!, requests: [] }, context)).toThrow();
    expect(state.accounts[ids.bank]!.cash.equals(money("2000"))).toBe(true);
    expect(state.ssaMedicarePayments).toBeUndefined();
  });

  it.each(["excess", "negative", "zero bill", "partial", "duplicate Part", "wrong plan", "wrong issuer", "wrong cutoff"])(
    "refuses %s before any right or deduction settles", fault => {
      control.zeroNet = true;
      const { kernel, context, events } = nativeFixture(1);
      const event = events[0]!;
      if (fault === "wrong issuer") control.changeInventory = (kind, inventory) => kind === "rule"
        ? { ...inventory, originals: inventory.originals.map(original => ({ ...original, issuer: "IRS" })) } : inventory;
      else if (fault !== "wrong cutoff") amendMedicare(event, original => {
        if (fault === "wrong plan") return { ...original, premiums: { ...original.premiums,
          coverages: original.premiums.coverages.map(coverage => ({ ...coverage, planId: "wrong-plan" })) } };
        if (fault === "duplicate Part") return { ...original, instructions: [...original.instructions, original.instructions[0]!] };
        const bill = money(fault === "excess" ? "81" : fault === "negative" ? "-1" : "0");
        return { ...original, deductionTerms: original.deductionTerms.map(terms => terms.part === "part_b"
          ? { ...terms, permittedAmount: fault === "partial" ? money("79.99") : bill } : terms),
          premiums: { ...original.premiums, coverages: original.premiums.coverages.map(coverage =>
            fault !== "partial" && coverage.medicare?.premiumFor === "part_b"
              ? { ...coverage, quote: { ...coverage.quote, gross: bill, member: bill } } : coverage) } };
      });
      const runContext = fault === "wrong cutoff" ? { ...context, dataCutoff: instant("2025-12-31T00:00:00.000Z") } : context;
      const result = runHouseholdKernel({ kernel, runContext, resultTier: "detail" });
      expect(result.periods).toHaveLength(0);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.state.accounts[ids.bank]!.cash.equals(money("2000"))).toBe(true);
      expect(Object.values(result.state.obligations)).toHaveLength(0);
      expect(Object.values(result.state.d2PostedTransactions ?? {})).toHaveLength(0);
    });

  it("checks after the last sparse checkpoint on cold restore, warm return and replay-on-use", () => {
    const { kernel, context, events } = nativeFixture(13);
    const summary = runHouseholdKernel({ kernel, runContext: context });
    expect(summary.periods, JSON.stringify(summary.diagnostics)).toHaveLength(13);
    expect(summary.state.accounts[ids.bank]!.cash.equals(money("18900"))).toBe(true);
    const retained = createPortableHouseholdReplayArtifact(summary, true);
    const portable = JSON.parse(JSON.stringify(retained));
    const restored = restorePortableHouseholdReplayArtifact(portable);
    expect(restorePortableHouseholdReplayArtifact(retained).periods).toEqual(summary.periods);
    const selected = summary.periods[12]!.period;
    expect(replayHouseholdForecastWindow(restored, selected).state).toEqual(summary.state);
    faults.unavailable = events[12]!.eventId;
    expect(() => restorePortableHouseholdReplayArtifact(portable)).toThrow("HOUSEHOLD_REPLAY_BASIS_MISMATCH");
    expect(() => restorePortableHouseholdReplayArtifact(retained)).toThrow("HOUSEHOLD_REPLAY_BASIS_MISMATCH");
    expect(() => replayHouseholdForecastWindow(restored, selected)).toThrow();
  });

  it("preserves an inherited installment and checks later-known source withdrawal", () => {
    const first = nativeFixture(1);
    const posted = runHouseholdKernel({ kernel: first.kernel, runContext: first.context });
    expect(posted.periods).toHaveLength(1);
    const second = fixture(1, posted.state, "2026-02");
    const observed = instant("2026-02-01T00:00:00.000Z");
    const context = { ...second.context, asOf: observed, dataCutoff: observed };
    const kernel = attachSsaMedicare(second.kernel, { ...input([]), nativePayments: first.events });
    const summary = runHouseholdKernel({ kernel, runContext: context });
    expect(summary.periods, JSON.stringify(summary.diagnostics)).toHaveLength(1);
    const artifact = createPortableHouseholdReplayArtifact(summary);
    expect(restorePortableHouseholdReplayArtifact(artifact).periods).toEqual(summary.periods);
    faults.withdrawn = first.events[0]!.eventId;
    expect(() => restorePortableHouseholdReplayArtifact(artifact)).toThrow("HOUSEHOLD_REPLAY_BASIS_MISMATCH");
  });

  it("keeps legacy and no-participant portable runs admissible", () => {
    const { kernel, context } = fixture();
    for (const execution of [kernel, attachSsaMedicare(kernel, input()), attachSsaMedicare(kernel, input([originalPayment()]))]) {
      const forecast = runHouseholdKernel({ kernel: execution, runContext: context });
      expect(forecast.periods).toHaveLength(1);
      expect(restorePortableHouseholdReplayArtifact(createPortableHouseholdReplayArtifact(forecast)).periods).toEqual(forecast.periods);
    }
  });

  it("restores imported proof in a fresh process using independently registered sources", () => {
    const { kernel, context } = nativeFixture(13);
    const detail = runHouseholdKernel({ kernel, runContext: context, resultTier: "detail" });
    const forecast = runHouseholdKernel({ kernel, runContext: context });
    const directory = mkdtempSync(join(tmpdir(), "native-ssa-replay-"));
    try {
      const path = join(directory, "replay.json");
      writeFileSync(path, JSON.stringify({ artifact: createPortableHouseholdReplayArtifact(forecast), selected: forecast.periods[12]!.period }));
      for (const mode of ["available", "unregistered", "withdrawn"]) {
        const child = spawnSync(process.execPath, [
          fileURLToPath(new URL("../../../../../node_modules/vite-node/vite-node.mjs", import.meta.url)),
          fileURLToPath(new URL("./portableWorker.ts", import.meta.url)),
        ], { encoding: "utf8", env: { ...process.env, PFM_NATIVE_SSA_ARTIFACT: path, PFM_NATIVE_SSA_SOURCES: mode } });
        expect(child.status, child.stderr).toBe(0);
        expect(JSON.parse(child.stdout)).toEqual(mode === "available" ? { cash: canonicalSerialize(money("18900")),
          periods: canonicalSerialize(detail.periods.slice(-1)) } : { refused: true });
      }
    } finally { rmSync(directory, { force: true, recursive: true }); }
  }, 60_000);

  it("keeps source documents out of a 25-month portable run and scales with distinct events", () => {
    const sizes: number[] = [];
    for (const count of [1, 12, 24]) {
      const { kernel, context } = nativeFixture(count, count === 24 ? 25 : count);
      const forecast = runHouseholdKernel({ kernel, runContext: context });
      expect(forecast.periods, JSON.stringify(forecast.diagnostics)).toHaveLength(count === 24 ? 25 : count);
      expect(Object.values(forecast.state.ssaMedicarePayments ?? {})).toHaveLength(count);
      const artifact = createPortableHouseholdReplayArtifact(forecast);
      expect(artifact.encoded).not.toContain("publisher-original-payload");
      expect(restorePortableHouseholdReplayArtifact(artifact).periods).toEqual(forecast.periods);
      sizes.push(artifact.encoded.length);
    }
    expect(sizes[2]!).toBeLessThan(3 * sizes[1]!);
    const { kernel, context } = nativeFixture(25);
    const forecast = runHouseholdKernel({ kernel, runContext: context });
    expect(forecast.periods, JSON.stringify(forecast.diagnostics)).toHaveLength(25);
    expect(Object.values(forecast.state.ssaMedicarePayments ?? {})).toHaveLength(25);
    expect(forecast.state.accounts[ids.bank]!.cash.equals(money("34700"))).toBe(true);
    const artifact = createPortableHouseholdReplayArtifact(forecast);
    const restored = restorePortableHouseholdReplayArtifact(artifact);
    expect(replayHouseholdForecastWindow(restored, forecast.periods[24]!.period).state).toEqual(forecast.state);
  }, 60_000);
});

it.each(["2026-01", "2027-01"])("rejects a complete omission of %s while cash and integrity remain valid", month => {
  const event = publish(month, []);
  const state = createAuthoritativeState({ accounts: { [ids.bank]: { id: ids.bank, kind: "checking", ownerId: ids.household, cash: money("2000") } } });
  const { kernel, context } = fixture(13, state, "2026-01");
  const summary = runHouseholdKernel({ kernel: attachSsaMedicare(kernel, { ...input([]), nativePayments: [event] }), runContext: context });
  expect(summary.periods, JSON.stringify(summary.diagnostics)).toHaveLength(13);
  const artifact = createPortableHouseholdReplayArtifact(summary);
  expect(restorePortableHouseholdReplayArtifact(artifact).periods).toEqual(summary.periods);
  const wire = expandedWire(artifact.encoded);
  const checkpoints = wireItems(wireField(wire, "checkpoints"));
  const delta = month === "2026-01" ? checkpoints[0]! : wireField(wire, "terminalDelta");
  const records = wireField(delta, "records"), identities = wireField(delta, "identities");
  for (const name of ["obligations", "ssaMedicarePayments", "d2PostedTransactions"])
    replaceWireField(wireField(records, name), "set", { kind: "record", value: [] });
  for (const name of ["settlementIds", "recognitionIds", "postedTransactionIds", "externalIdempotencyKeys"])
    replaceWireField(wireField(identities, name), "add", { kind: "array", value: [] });
  const encoded = JSON.stringify(wire);
  const integrity = createInputFingerprint({ runContext: context, openingState: encoded });
  expect.assertions(5);
  try {
    restorePortableHouseholdReplayArtifact({ ...artifact, encoded, integrity });
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).cause).toBeInstanceOf(ValidationError);
    expect(((error as Error).cause as ValidationError).issues[0]?.code).toBe("SSA_CHANGED_PAYMENT");
  }
});

it.each(["receipt", "proof", "wrong run"])("refuses portable history with a changed %s", fault => {
  const { kernel, context } = nativeFixture(1);
  const artifact = createPortableHouseholdReplayArtifact(runHouseholdKernel({ kernel, runContext: context }));
  const wire = expandedWire(artifact.encoded);
  const records = wireField(wireField(wire, "terminalDelta"), "records");
  if (fault === "wrong run") {
    for (const name of ["ssaMedicarePayments", "d2PostedTransactions"]) {
      const row = wireItems(wireField(wireField(records, name), "set"))[0]!;
      if (!Array.isArray(row) || row[1] === undefined) throw new Error("Expected native archive row");
      const entry = name === "d2PostedTransactions" ? wireField(row[1], "registration") : row[1];
      replaceWireField(wireField(wireField(entry, "nativeHousehold"), "context"), "runId", "wrong-run");
      if (name === "ssaMedicarePayments")
        replaceWireField(wireField(wireField(row[1], "sourceInputs"), "context"), "runId", "wrong-run");
    }
  } else {
    const name = fault === "receipt" ? "ssaMedicarePayments" : "d2PostedTransactions";
    replaceWireField(wireField(records, name), "set", { kind: "record", value: [] });
  }
  const encoded = JSON.stringify(wire);
  const integrity = createInputFingerprint({ runContext: context, openingState: encoded });
  expect(() => restorePortableHouseholdReplayArtifact({ ...artifact, encoded, integrity })).toThrow("HOUSEHOLD_REPLAY_BASIS_MISMATCH");
});
