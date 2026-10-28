import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { money } from "../../../../src/values/index.js";
import { instant } from "../../../../src/time/index.js";
import { domainId } from "../../../../src/identity/index.js";
import { createAuthoritativeState, applySsaMedicarePaymentAtomically } from "../../../../src/state/index.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { runHouseholdKernel, replayHouseholdForecastWindow } from "../../../../src/simulation/householdExecution.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { attachSsaMedicare, createSsaMedicareParticipant, qualifySsaMedicarePayment,
  validateSsaMedicareSourceHistory, type ConfirmedSsaMedicarePayment } from "../../../../src/simulation/d2/integration/ssaMedicare/index.js";
import { fixture, ids, input, payment } from "./scenario.js";
import { control, originalPayment, register, resetSources, second } from "./originalScenario.js";
import type { OriginalRule } from "../../../../src/simulation/d2/health/medicare/originalBinding/index.js";

register();

const qualify = (q: ConfirmedSsaMedicarePayment) => qualifySsaMedicarePayment(q, ids.household, q.payable.recipientId);
const execute = (q = originalPayment()) => {
  const f = fixture();
  return runHouseholdKernel({ kernel: attachSsaMedicare(f.kernel, input([q])), runContext: f.context, resultTier: "detail" });
};
beforeEach(resetSources);

describe("original-backed same-event physical settlement", () => {
  it("requires external registration and preserves legacy v1 without an assurance upgrade", () => {
    const q = originalPayment();
    control.missing = true;
    expect(() => qualify(q)).toThrow();
    expect(qualify(payment()).sourceInputs).not.toHaveProperty("originalSources");
    resetSources();
    expect(() => register()).toThrow("SSA_MEDICARE_ORIGINAL_ADAPTER_DUPLICATE");
    expect(qualify(q).payable.grossPayable.equals(money("1500"))).toBe(true);
  });

  it("settles an independently sourced exact zero net without a BANK leg", () => {
    control.zeroNet = true;
    const out = execute(originalPayment());
    expect(out.periods, JSON.stringify(out.diagnostics)).toHaveLength(1);
    expect(out.state.accounts[ids.bank]!.cash.equals(money("2000"))).toBe(true);
    expect(out.periods[0]!.transactions[0]!.legs.map(l => [l.posting, l.type, l.amount.amount.toString()]))
      .toEqual([["debit", "expense", "200"], ["credit", "income", "200"]]);
    expect(Object.values(out.state.obligations)).toHaveLength(3);
  });

  it("posts exactly the existing funded journal, separate claims and explicit zero withholding", () => {
    const q = originalPayment(), out = execute(q);
    expect(out.periods, JSON.stringify(out.diagnostics)).toHaveLength(1);
    expect(out.state.accounts[ids.bank]!.cash.equals(money("3300"))).toBe(true);
    expect(out.periods[0]!.transactions).toHaveLength(1);
    expect(out.periods[0]!.transactions[0]!.legs.map(l => [l.posting, l.type, l.amount.amount.toString()]))
      .toEqual([["debit", "cash", "1300"], ["debit", "expense", "200"], ["credit", "income", "1500"]]);
    const receipt = Object.values(out.state.ssaMedicarePayments!)[0]!;
    expect(receipt.version).toBe("ssa-medicare-payment/v1");
    expect(receipt.requests.map(r => [r.terms.premium.part, r.terms.amount.amount.toString()])).toEqual([["part_b", "80"], ["part_d", "120"]]);
    expect(receipt.recognitions).toHaveLength(3);
    expect(receipt.payable.taxWithholding.amount.isZero()).toBe(true);
    expect(Object.values(out.state.obligations)).toHaveLength(3);
    expect(Object.values(out.state.obligations).every(c => c.outstandingAmount.isZero() && c.settlementIds.length === 1)).toBe(true);
    expect(out.state.identities.settlementIds).toHaveLength(3);
    expect(out.periods[0]!.outputCapabilities?.projectedTax?.status).not.toBe("complete");
    expect(() => applySsaMedicarePaymentAtomically(out.state, qualify(q))).toThrow();
  });

  it("rejects mismatched person, worker, quote, C1 flags, C2 filing facts and cutoff without mutation", () => {
    const q = originalPayment();
    const bad: ConfirmedSsaMedicarePayment[] = [
      { ...q, payable: { ...q.payable, recipientId: second.person } },
      { ...q, payable: { ...q.payable, workerRecordId: second.person } },
      { ...q, a1: { ...q.a1, recipients: q.a1.recipients.map(r => ({ ...r, quotes: r.quotes.map(v => ({ ...v,
        award: { ...v.award, quote: { ...v.award.quote!, grossAmount: money("1500.01") } } })) })) } },
      { ...q, c2: { ...q.c2, premiums: { ...q.c2.premiums, coverages: q.c2.premiums.coverages.map(c => ({ ...c,
        quote: { ...c.quote, source: { ...c.quote.source, projectionStatus: "unavailable" } } })) } } },
      { ...q, c2: { ...q.c2, irmaa: { ...q.c2.irmaa, histories: q.c2.irmaa.histories.map(h => ({ ...h, magi: money("0.01") })) } } },
      { ...q, c2: { ...q.c2, irmaa: { ...q.c2.irmaa, histories: [] } } },
      { ...q, originalSources: { ...q.originalSources!, mode: "fake" as "ssa-medicare-originals/v1" } },
      { ...q, originalSources: { ...q.originalSources!, irmaa: q.originalSources!.irmaa.slice(0, 1) } },
      { ...q, payable: { ...q.payable, taxWithholding: { ...q.payable.taxWithholding, amount: money("0.01") } } },
    ];
    for (const candidate of bad) {
      const state = fixture().state, before = canonicalSerialize(state);
      expect(() => qualify(candidate)).toThrow();
      expect(canonicalSerialize(state)).toBe(before);
    }
    expect(() => qualifySsaMedicarePayment(q, ids.household, ids.person, instant("2025-12-31T00:00:00.000Z"))).toThrow();
  });

  it("consumes original nonzero B/D surcharges exactly once within the existing premiums", () => {
    control.surcharged = true;
    const q = originalPayment(), out = execute(q);
    expect(out.periods, JSON.stringify(out.diagnostics)).toHaveLength(1);
    expect(out.periods[0]!.transactions).toHaveLength(1);
    expect(out.state.accounts[ids.bank]!.cash.equals(money("3300"))).toBe(true);
    const receipt = Object.values(out.state.ssaMedicarePayments!)[0]!;
    expect(receipt.requests.map(r => [r.terms.premium.part, r.terms.premium.base.amount.toString(),
      r.terms.premium.irmaa.amount.toString(), r.terms.amount.amount.toString()]))
      .toEqual([["part_b", "70", "10", "80"], ["part_d", "100", "20", "120"]]);
    expect(receipt.recognitions.map(r => r.amount.amount.toString())).toEqual(["1500", "80", "120"]);
    expect(Object.values(out.state.obligations)).toHaveLength(3);
    expect(out.periods[0]!.statements.expenses.equals(money("200"))).toBe(true);
    expect(out.periods[0]!.outputCapabilities?.projectedTax?.status).not.toBe("complete");
    // A pin recomputed from the original producer cannot bless altered raw C2.
    const rawZero = payment().c2.irmaa;
    expect(() => qualify({ ...q, c2: { ...q.c2, irmaa: rawZero } })).toThrow();
    const replayFixture = fixture();
    const replaySummary = runHouseholdKernel({ kernel: attachSsaMedicare(replayFixture.kernel, input([q])), runContext: replayFixture.context });
    expect(replaySummary.state).toEqual(out.state);
    const restored = restorePortableHouseholdReplayArtifact(JSON.parse(JSON.stringify(createPortableHouseholdReplayArtifact(replaySummary))));
    expect(replayHouseholdForecastWindow(restored, out.periods[0]!.period).state).toEqual(out.state);
  });

  it("enforces the original cutoff on C1, BANK and withholding through the state source port", () => {
    const q = originalPayment(), bound = qualify(q), late = instant("2026-02-01T00:00:00.000Z");
    const candidates: ConfirmedSsaMedicarePayment[] = [
      { ...q, bank: { ...q.bank, evidence: { ...q.bank.evidence, knownAt: late } } },
      { ...q, payable: { ...q.payable, taxWithholding: { ...q.payable.taxWithholding,
        source: { ...q.payable.taxWithholding.source, knownAt: late } } } },
      { ...q, c2: { ...q.c2, premiums: { ...q.c2.premiums, coverages: q.c2.premiums.coverages.map(c => ({ ...c,
        quote: { ...c.quote, source: { ...c.quote.source, asOf: "2026-02-01" as typeof c.quote.source.asOf } } })) } } },
    ];
    for (const sourceInputs of candidates) {
      const state = fixture().state, before = canonicalSerialize(state);
      expect(() => applySsaMedicarePaymentAtomically(state, { ...bound, sourceInputs })).toThrow();
      expect(canonicalSerialize(state)).toBe(before);
    }
  });

  it.each(["missing", "withdrawn", "amended", "late", "incomplete", "expired", "race"])("refuses independent SSA %s evidence", mode => {
    const q = originalPayment();
    control.changeSsa = (h, call) => mode === "missing" ? undefined : mode === "incomplete" ? { ...h, completeness: "unknown" }
      : { ...h, originals: h.originals.map(o => mode === "race" && call === 1 ? o : mode === "withdrawn" || mode === "race"
        ? { ...o, status: "withdrawn" } : mode === "amended" ? { ...o, kind: "amended" }
          : mode === "expired" ? { ...o, eventPeriod: { ...o.eventPeriod, endExclusive: o.eventPeriod.start } }
            : { ...o, knownAt: "2026-06-16" as typeof o.knownAt }) };
    expect(() => qualify(q)).toThrow();
  });

  it.each(["missing", "flags", "tier-cent", "late-return", "amended-return", "refused-grant", "race"])("refuses independent IRMAA %s evidence", mode => {
    const q = originalPayment();
    control.changeInventory = (kind, inv, call) => mode === "missing" ? undefined : mode === "flags" ? { ...inv, complete: false }
      : mode === "race" && call > 4 ? { ...inv, complete: false }
        : mode === "tier-cent" && kind === "rule" ? { ...inv, originals: inv.originals.map(d => {
          const value = d.value as OriginalRule;
          return { ...d, value: { ...value, rule: { ...value.rule, tables: value.rule.tables.map(t => ({ ...t,
            tiers: t.tiers.map(tier => ({ ...tier, partBMonthly: money("0.01") })) })) } } };
        }) }
          : mode === "late-return" && kind === "return" ? { ...inv, originals: inv.originals.map(d => ({ ...d, knownAt: instant("2026-06-16T00:00:00.000Z") })) }
            : mode === "amended-return" && kind === "return" ? { ...inv, originals: [...inv.originals, { ...inv.originals[0]!,
              claimId: "amendment", supersedes: [inv.originals[0]!.claimId], knownAt: instant("2026-01-02T00:00:00.000Z") }] }
              : mode === "refused-grant" && kind === "determination" ? { ...inv, originals: [{ issuer: "SSA", sourceId: "refused",
                version: "v1", claimId: "refused-grant", publishedAt: q.originalSources!.dataCutoff, knownAt: q.originalSources!.dataCutoff,
                publication: "refused legal determination", supersedes: [], value: { granted: false } }] } : inv;
    expect(() => qualify(q)).toThrow();
  });

  it("catches a cross-source race on the final physical reread and provider disappearance after qualification", () => {
    const q = originalPayment();
    control.changeInventory = (_kind, inv) => { control.missing = true; return inv; };
    expect(() => qualify(q)).toThrow();
    resetSources();
    const bound = qualify(q), state = fixture().state, before = canonicalSerialize(state);
    control.missing = true;
    expect(() => applySsaMedicarePaymentAtomically(state, bound)).toThrow();
    expect(canonicalSerialize(state)).toBe(before);
    resetSources();
    const out = execute(q);
    control.missing = true;
    expect(() => validateSsaMedicareSourceHistory(out.state)).toThrow();
  });

  it("rejects duplicate input and simultaneous BANK consumers", () => {
    const q = originalPayment(), f = fixture(), participant = createSsaMedicareParticipant(input([q]));
    const opening = { state: f.state, primitiveState: {} }, period = { start: f.context.simulationStart, end: f.context.simulationEnd };
    expect(() => participant.prepare(f.context, period, opening, [{ id: "consumer", domain: "cash_flow",
      sequencingInstant: q.payable.paymentAt, dependsOn: [], traceRefs: [],
      resourceAccesses: [{ kind: "account_cash", accountId: ids.bank, mode: "consume" }] }])).toThrow();
    expect(() => createSsaMedicareParticipant(input([q, q])).prepare(f.context, period, opening)).toThrow();
    expect(f.state.accounts[ids.bank]!.cash.equals(money("2000"))).toBe(true);
  });

  it("settles two independently original-backed members across two months", () => {
    const bank = domainId("account", second.bank), person = domainId("person", second.person), base = fixture().state;
    const state = createAuthoritativeState({ ...base, accounts: { ...base.accounts,
      [bank]: { id: bank, kind: "checking", ownerId: person, cash: money("2000") } } });
    const f = fixture(2, state), payments = [ids.person as string, second.person].flatMap(member =>
      [originalPayment("2026-06", money("2000"), member), originalPayment("2026-07", money("3300"), member)]);
    const kernel = attachSsaMedicare(f.kernel, { ...input(payments), memberIds: [ids.person, second.person] });
    const out = runHouseholdKernel({ kernel, runContext: f.context, resultTier: "detail" });
    expect(out.periods, JSON.stringify(out.diagnostics)).toHaveLength(2);
    expect(out.state.accounts[ids.bank]!.cash.equals(money("4600"))).toBe(true);
    expect(out.state.accounts[bank]!.cash.equals(money("4600"))).toBe(true);
    expect(Object.values(out.state.ssaMedicarePayments!)).toHaveLength(4);
    expect(Object.values(out.state.obligations)).toHaveLength(12);
    const replaySummary = runHouseholdKernel({ kernel, runContext: f.context });
    expect(replaySummary.state).toEqual(out.state);
    const restored = restorePortableHouseholdReplayArtifact(JSON.parse(JSON.stringify(createPortableHouseholdReplayArtifact(replaySummary))));
    expect(replayHouseholdForecastWindow(restored, out.periods[1]!.period).state).toEqual(out.state);
  });

  it.each([13, 24])("preserves detail/summary and cold portable replay for %s months", months => {
    const f = fixture(months, undefined, "2026-01");
    let cash = money("2000");
    const payments = Array.from({ length: months }, (_, n) => {
      const q = originalPayment(`${2026 + Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, "0")}`, cash);
      cash = cash.plus(money("1300")); return q;
    });
    const kernel = attachSsaMedicare(f.kernel, input(payments));
    const detail = runHouseholdKernel({ kernel, runContext: f.context, resultTier: "detail" });
    const summary = runHouseholdKernel({ kernel, runContext: f.context });
    expect(detail.periods, JSON.stringify(detail.diagnostics)).toHaveLength(months);
    expect(summary.state).toEqual(detail.state);
    expect(summary.periods.map(p => p.statements)).toEqual(detail.periods.map(p => p.statements));
    expect(summary.state.accounts[ids.bank]!.cash.equals(cash)).toBe(true);
    const artifact = createPortableHouseholdReplayArtifact(summary), selected = detail.periods.at(-1)!.period;
    const restored = restorePortableHouseholdReplayArtifact(JSON.parse(JSON.stringify(artifact)));
    expect(replayHouseholdForecastWindow(restored, selected).periods).toEqual(detail.periods.slice(-1));
    expect(artifact.encoded).not.toContain("publisher-original-payload");
    control.missing = true;
    expect(() => restorePortableHouseholdReplayArtifact(artifact)).toThrow();
    resetSources();
    const directory = mkdtempSync(join(tmpdir(), "pfm-original-ssa-"));
    try {
      const payload = join(directory, "replay.json"); writeFileSync(payload, JSON.stringify({ artifact, selected }));
      for (const unavailable of ["available", "missing", "unregistered"]) {
        const child = spawnSync(process.execPath, [fileURLToPath(new URL("../../../../node_modules/vite-node/vite-node.mjs", import.meta.url)),
          fileURLToPath(new URL("./originalPortableWorker.ts", import.meta.url))], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
          env: { ...process.env, PFM_SSA_MEDICARE_TEST_PAYLOAD: payload, PFM_ORIGINALS_UNAVAILABLE: String(unavailable) } });
        expect(child.status, child.stderr).toBe(0);
        expect(JSON.parse(child.stdout)).toEqual(unavailable !== "available" ? { refused: true } : {
          state: canonicalSerialize(detail.state), periods: canonicalSerialize(detail.periods.slice(-1)) });
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 60_000);

  it("bounds 1/12/24 source reads and metadata, with provider-held payloads", () => {
    const sizes: number[] = [];
    for (const months of [1, 12, 24]) {
      const payments = Array.from({ length: months }, (_, n) => originalPayment(`${2026 + Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, "0")}`));
      resetSources();
      for (const q of payments) qualify(q);
      expect(control.ssaCalls).toBe(3 * months);
      expect(control.calls).toBe(24 * months);
      const wire = JSON.stringify(payments.map(q => q.originalSources));
      expect(wire).not.toContain("publisher-original-payload");
      expect(wire.length).toBeLessThan(4000 * months);
      sizes.push(wire.length);
    }
    expect(sizes[2]!).toBeLessThan(25 * sizes[0]!);
  });

  it("keeps 1/12/24-month receipts and portable output proportional without original documents", () => {
    const sizes: { receipts: number; artifact: number }[] = [];
    for (const months of [1, 12, 24]) {
      resetSources();
      const f = fixture(months, undefined, "2026-01");
      let cash = money("2000");
      const payments = Array.from({ length: months }, (_, n) => {
        const q = originalPayment(`${2026 + Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, "0")}`, cash);
        cash = cash.plus(money("1300")); return q;
      });
      const out = runHouseholdKernel({ kernel: attachSsaMedicare(f.kernel, input(payments)), runContext: f.context });
      expect(out.periods, JSON.stringify(out.diagnostics)).toHaveLength(months);
      const receipts = canonicalSerialize(out.state.ssaMedicarePayments);
      const artifact = createPortableHouseholdReplayArtifact(out);
      expect(receipts).not.toContain("publisher-original-payload");
      expect(artifact.encoded).not.toContain("publisher-original-payload");
      sizes.push({ receipts: receipts.length, artifact: artifact.encoded.length });
      // History validation must physically consult the providers once per
      // committed payment; no receipt becomes a cached publisher credential.
      resetSources();
      validateSsaMedicareSourceHistory(out.state, f.context.dataCutoff);
      expect(control.ssaCalls).toBe(3 * months);
      expect(control.calls).toBe(24 * months);
      expect(out.state.accounts[ids.bank]!.cash.equals(cash)).toBe(true);
    }
    // Versioned private receipts must grow per event without copying original
    // publisher documents, even when portable replay inserts a checkpoint.
    expect(sizes[1]!.receipts).toBeLessThan(14 * sizes[0]!.receipts);
    expect(sizes[2]!.receipts).toBeLessThan(30 * sizes[0]!.receipts);
    expect(sizes[2]!.receipts).toBeLessThan(3 * sizes[1]!.receipts);
    // The shared v3 replay format has no checkpoint in a terminal 12-month
    // horizon, but a 24-month horizon carries a separate 12-month recovery
    // root. Bound that stepwise overhead without asserting falsely that
    // artifact bytes scale exactly like per-event receipts. The observed
    // first-checkpoint jump needs a separate shared-code size audit.
    expect(sizes[1]!.artifact).toBeLessThan(14 * sizes[0]!.artifact);
    expect(sizes[2]!.artifact).toBeLessThan(80 * sizes[0]!.artifact);
    expect(sizes[2]!.artifact).toBeLessThan(5.5 * sizes[1]!.artifact);
  }, 60_000);
});
