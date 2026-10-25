import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { money } from "../../../../src/values/index.js";
import { instant } from "../../../../src/time/index.js";
import { sha256 } from "../../../../src/rules/tax/t1b/contentIdentity.js";
import { attachRetirementCash, createRetirementCashParticipant, createReferencedRetirementCashParticipant,
  evaluateFundedRmdSatisfaction, type FundedRetirementCashReferences } from "../../../../src/simulation/d2/integration/retirementCash/index.js";
import { retirementRawSourceDigest, qualifyRetirementRecordedSource, type RetirementRawSource } from "../../../../src/simulation/d2/integration/retirementCash/source.js";
import { applyHouseholdExecutionOverlay, runHouseholdKernel, replayHouseholdForecastWindow } from "../../../../src/simulation/householdExecution.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { portableHouseholdParticipant, restoreHouseholdParticipant } from "../../../../src/simulation/r3/participantCodec.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { funded, sources } from "./fundedScenario.js";
import { fixture, ids } from "./scenario.js";

// Independent pre-migration normalization, retained to verify the original proof.
const originalWitness = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(originalWitness).sort((a, b) => {
    const left = canonicalSerialize(a), right = canonicalSerialize(b); return left < right ? -1 : left > right ? 1 : 0;
  });
  if (value && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, originalWitness(v)]));
  return value;
};

describe("P3 complete-original retirement references", () => {
  it("pins the complete original, canonicalizes independent evidence and emits no raw catalog", () => {
    const f = fixture(), p = funded(f, "pin", ["500", "200"]);
    const participant = createRetirementCashParticipant(p.cash);
    const config = participant.economicInputs as FundedRetirementCashReferences;
    expect(participant.portableCodec).toBe("d2-retirement-cash/v3");
    expect(config.plans[0]!.contentDigest).toBe(`retirement-raw/v2:sha256:${sha256(canonicalSerialize(originalWitness(p.raw)))}`);
    expect(retirementRawSourceDigest({ ...p.raw, availability: [...p.raw.availability].reverse(),
      cash: { ...p.raw.cash, confirmations: [...p.raw.cash.confirmations].reverse() } })).toBe(retirementRawSourceDigest(p.raw));
    const encoded = canonicalSerialize(portableHouseholdParticipant(participant));
    for (const marker of ["withdrawals", "grossAmount", "factors", "priorValue", "sourcePublication", "bankCashBefore"])
      expect(encoded).not.toContain(marker);
    const duplicate = { ...config, plans: [...config.plans, config.plans[0]!] };
    expect(() => createReferencedRetirementCashParticipant(duplicate)).toThrow("Distinct dated events");
    expect(() => createReferencedRetirementCashParticipant({ ...config, horizon: { ...config.horizon, end: config.horizon.start } })).toThrow();
    const out = runHouseholdKernel({ kernel: attachRetirementCash(f.kernel, p.cash).kernel, runContext: f.context, resultTier: "detail" });
    expect(out.periods, JSON.stringify(out.diagnostics)).toHaveLength(1);
    expect(out.state.accounts[ids.ira]!.cash.equals(money("300"))).toBe(true);
    expect(out.state.accounts[ids.bank]!.cash.equals(money("900"))).toBe(true);
    const records = Object.values(out.state.retirementDistributionAllocations!);
    expect(records.map(d => d.source.ruleVersion)).toEqual([config.plans[0]!.contentDigest, config.plans[0]!.contentDigest]);
    expect(records.every(d => !d.sourceEvidenceFingerprint.includes("withdrawals"))).toBe(true);
    expect(evaluateFundedRmdSatisfaction({ ...config.annualSource, horizon: config.horizon }, out.state, f.context, f.context.simulationEnd)
      .annual!.obligations[0]!.satisfied.equals(money("700"))).toBe(true);
  });

  it.each(["cent", "approval", "cash", "prior", "late", "version", "owner", "withdrawn"])("does not post from a changed full original: %s", mode => {
    const f = fixture(), p = funded(f, `changed:${mode}`), kernel = attachRetirementCash(f.kernel, p.cash).kernel;
    const participant = kernel.executable.participants![0]!, config = participant.economicInputs as FundedRetirementCashReferences;
    let raw: RetirementRawSource = p.raw;
    if (mode === "cent") {
      const withdrawals = { ...raw.cash.withdrawals, requests: raw.cash.withdrawals.requests.map(r => ({ ...r,
        grossAmount: money("500.01"), authorization: { ...r.authorization!, grossAmount: money("500.01") } })) };
      raw = { ...raw, cash: { ...raw.cash, withdrawals }, binding: { ...raw.binding, withdrawals } };
    }
    if (mode === "approval") raw = { ...raw, binding: { ...raw.binding, allocations: raw.binding.allocations.map(({ approval: _approval, ...a }) => a) } };
    if (mode === "cash") raw = { ...raw, cash: { ...raw.cash, confirmations: raw.cash.confirmations.map(q => ({ ...q, sourceCashBefore: money("999.99") })) } };
    if (mode === "prior") raw = { ...raw, priorOperationIds: ["missing-original"] };
    if (mode === "late") raw = { ...raw, availability: raw.availability.map(a => ({ ...a, knownAt: instant("2026-06-15T00:00:00.001Z") })) };
    if (mode === "version") raw = { ...raw, sourceVersion: "v2" };
    if (mode === "owner") raw = { ...raw, cash: { ...raw.cash, members: raw.cash.members.map(m => ({ ...m, personId: ids.other })) } };
    if (mode === "withdrawn") sources.delete(raw.sourceId); else sources.set(raw.sourceId, raw);
    const out = runHouseholdKernel({ kernel, runContext: f.context, resultTier: "detail" });
    expect(out.periods).toEqual([]); expect(out.state).toEqual(f.state);
    expect(evaluateFundedRmdSatisfaction({ ...config.annualSource, horizon: config.horizon }, out.state, f.context, f.context.simulationEnd).coverage).toBe("incomplete");
  });

  it("bounds configuration, receipt and artifact growth for 1/2/13 actual withdrawals without original marker strings", () => {
    const sizes = [1, 2, 13].map(count => {
      const f = fixture(), p = funded(f, `growth:${count}`, Array<string>(count).fill("50"));
      const marker = "UNIQUE_FULL_ORIGINAL_RETIREMENT_CATALOG_".repeat(256);
      const cash = { ...p.raw.cash, members: p.raw.cash.members.map(m => ({ ...m, source: { ...m.source, sourcePublication: marker } })) };
      const raw = { ...p.raw, cash }; sources.set(raw.sourceId, raw);
      const kernel = attachRetirementCash(f.kernel, { ...cash, fundedRmd: p.reference }).kernel;
      const out = runHouseholdKernel({ kernel, runContext: f.context });
      expect(out.periods, JSON.stringify(out.diagnostics)).toHaveLength(1);
      expect(Object.keys(out.state.retirementDistributionAllocations!)).toHaveLength(count);
      const config = canonicalSerialize(kernel.executable.participants![0]!.economicInputs);
      const receipts = canonicalSerialize(Object.values(out.state.retirementDistributionAllocations!));
      const artifact = createPortableHouseholdReplayArtifact(out);
      for (const value of [config, receipts, artifact.encoded]) expect(value).not.toContain("UNIQUE_FULL_ORIGINAL_RETIREMENT_CATALOG_");
      expect(Object.values(out.state.retirementDistributionAllocations!).every(d => d.source.ruleVersion.length === 89)).toBe(true);
      expect(replayHouseholdForecastWindow(restorePortableHouseholdReplayArtifact(JSON.parse(JSON.stringify(artifact))), f.period).state).toEqual(out.state);
      return { config: config.length, receipts: receipts.length, artifact: artifact.encoded.length };
    });
    for (const field of ["config", "receipts", "artifact"] as const) {
      expect(sizes[1]![field]).toBeLessThan(sizes[0]![field] * 3);
      expect(sizes[2]![field]).toBeLessThan(sizes[0]![field] * 16);
    }
  });

  it("requalifies legacy June and compact July together without rewriting the paid June journal", () => {
    const june = fixture(), first = funded(june, "mixed:june");
    const legacy = restoreHouseholdParticipant({ id: "d2_retirement_cash", version: "funded-account-rmd/v1",
      codec: "d2-retirement-cash/v1", economicInputs: first.cash });
    const paid = runHouseholdKernel({ kernel: applyHouseholdExecutionOverlay(june.kernel, { participants: [legacy] }), runContext: june.context });
    expect(paid.periods).toHaveLength(1);
    const old = Object.values(paid.state.retirementDistributionAllocations!)[0]!;
    const originalProof = canonicalSerialize(paid.state.d2PostedTransactions![old.transactionId]);
    const july = fixture(1, paid.state, "2026-07"), next = funded(july, "mixed:july", ["200"]);
    const r = first.raw.cash.withdrawals.requests[0]!, a = first.raw.binding.allocations[0]!;
    const withdrawals = { ...next.raw.cash.withdrawals,
      cash: next.raw.cash.withdrawals.cash.map(c => ({ ...c, liquidity: { ...c.liquidity!, available: money("500") } })),
      usage: { ...next.raw.cash.withdrawals.usage, operationIds: [r.operationId], withdrawalIds: [r.withdrawalId],
        authorizationIds: [r.authorization!.id, ...r.withholding!.instructions.map(w => w.authorizationId)] } };
    const cash = { ...next.raw.cash, withdrawals, confirmations: next.raw.cash.confirmations.map(q => ({ ...q,
      sourceCashBefore: money("500"), bankCashBefore: money("700") })) };
    const raw = { ...next.raw, cash, priorOperationIds: [r.operationId], binding: { ...next.raw.binding, withdrawals,
      usage: { ...next.raw.binding.usage, allocationIds: [a.allocationId], approvalIds: [a.approval!.id] } } };
    sources.set(raw.sourceId, raw);
    const kernel = attachRetirementCash(july.kernel, { ...cash, fundedRmd: next.reference }).kernel;
    const out = runHouseholdKernel({ kernel, runContext: july.context });
    expect(out.periods, JSON.stringify(out.diagnostics)).toHaveLength(1);
    expect(out.state.accounts[ids.ira]!.cash.equals(money("300"))).toBe(true);
    expect(out.state.accounts[ids.bank]!.cash.equals(money("900"))).toBe(true);
    expect(out.state.retirementDistributionAllocations![old.transactionId]).toEqual(old);
    expect(canonicalSerialize(out.state.d2PostedTransactions![old.transactionId])).toBe(originalProof);
    expect(evaluateFundedRmdSatisfaction(next.reference, out.state, july.context, july.context.simulationEnd)
      .annual!.obligations[0]!.satisfied.equals(money("700"))).toBe(true);
    sources.delete(first.raw.sourceId);
    expect(evaluateFundedRmdSatisfaction(next.reference, out.state, july.context, july.context.simulationEnd).coverage).toBe("incomplete");
    expect(out.state.accounts[ids.bank]!.cash.equals(money("900"))).toBe(true);
    sources.set(first.raw.sourceId, first.raw);
    // Reusing the paid legacy operation under v3 cannot silently replace its
    // legacy receipt key or journal. Preserve the original paid cash frontier.
    const conflict = runHouseholdKernel({ kernel: attachRetirementCash(fixture(1, paid.state).kernel, first.cash).kernel, runContext: june.context });
    expect(conflict.periods).toEqual([]); expect(conflict.state).toEqual(paid.state);
  });

  it.each([1, 2])("restores historical funded v%i with original economic/receipt proof in a fresh process", version => {
    const f = fixture(13), p = funded(f, `legacy-v${version}`, ["700"]);
    const participant = restoreHouseholdParticipant({ id: "d2_retirement_cash", version: `funded-account-rmd/v${version}`,
      codec: `d2-retirement-cash/v${version}`, economicInputs: version === 1 ? p.cash
        : { plans: [p.cash], annualSource: p.reference, horizon: p.reference.horizon } });
    const out = runHouseholdKernel({ kernel: applyHouseholdExecutionOverlay(f.kernel, { participants: [participant] }), runContext: f.context });
    expect(out.periods, JSON.stringify(out.diagnostics)).toHaveLength(13);
    const record = Object.values(out.state.retirementDistributionAllocations!)[0]!;
    expect(record.source.ruleVersion).toBe(canonicalSerialize(originalWitness(p.raw)));
    expect(record.gross.equals(money("700"))).toBe(true);
    expect(record.transactionId).toBe(`withdraw:legacy-v${version}:0`);
    expect(record.originalPostingProofId).toBe(record.transactionId);
    expect(record.allocations[0]!.amount.equals(money("700"))).toBe(true);
    expect(out.state.accounts[ids.ira]!.cash.equals(money("300"))).toBe(true);
    expect(out.state.accounts[ids.bank]!.cash.equals(money("900"))).toBe(true);
    expect(qualifyRetirementRecordedSource(p.raw, record.operationId, f.context, record.source.ruleVersion).status).toBe("qualified");
    const artifact = createPortableHouseholdReplayArtifact(out), selected = out.periods.at(-1)!.period;
    const expected = replayHouseholdForecastWindow(out, selected);
    const directory = mkdtempSync(join(tmpdir(), "pfm-legacy-retirement-"));
    try {
      const path = join(directory, "payload.json");
      writeFileSync(path, JSON.stringify({ artifact, selected, fundedPlan: { months: 13, label: `legacy-v${version}`, amounts: ["700"] } }));
      const child = spawnSync(process.execPath, [fileURLToPath(new URL("../../../../node_modules/vite-node/vite-node.mjs", import.meta.url)),
        fileURLToPath(new URL("./portableWorker.ts", import.meta.url))], { encoding: "utf8", timeout: 30_000, maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, PFM_RETIREMENT_CASH_TEST_PAYLOAD: path } });
      expect(child.error).toBeUndefined(); expect(child.status, child.stderr).toBe(0);
      const restored = JSON.parse(child.stdout);
      expect(restored.state).toBe(canonicalSerialize(expected.state)); expect(restored.periods).toBe(canonicalSerialize(expected.periods));
      expect(restored.satisfaction.satisfied).toEqual([canonicalSerialize(money("700"))]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  // One bounded cold source reinstall per historical codec; no stress forecast.
  }, 40_000);
});
