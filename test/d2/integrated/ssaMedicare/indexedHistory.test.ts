import { beforeEach, describe, expect, it } from "vitest";
import { domainId } from "../../../../src/identity/index.js";
import { money, Currency } from "../../../../src/values/index.js";
import { applySsaMedicarePaymentAtomically, cloneAuthoritativeState, createAuthoritativeState,
  createIndexedExecutionState, snapshotAuthoritativeCheckpoint, validateAuthoritativeState,
  type AuthoritativeState } from "../../../../src/state/index.js";
import { attachSsaMedicare, qualifySsaMedicarePayment } from "../../../../src/simulation/d2/integration/ssaMedicare/index.js";
import { runHouseholdKernel } from "../../../../src/simulation/householdExecution.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { fixture, ids, input, payment, uuid } from "./scenario.js";
import { control, originalPayment, register, resetSources } from "./originalScenario.js";

register();
beforeEach(resetSources);
const reads = () => ({ ssa: control.ssaCalls, inventory: control.calls });
const qualify = (q = originalPayment()) => qualifySsaMedicarePayment(q, ids.household, ids.person);
const opening = () => createIndexedExecutionState(fixture().state);
const committed = () => {
  const state = opening();
  applySsaMedicarePaymentAtomically(state, qualify());
  return state;
};

// Inspect the physical v3 wire without decoding Money or re-encoding history.
// Definitions are retained for byte accounting; references are followed only
// to locate fields. This never treats a checksum as source authentication.
type Wire = null | string | number | boolean | { kind: string; value: unknown };
function checkpointBytes(encoded: string) {
  const root = JSON.parse(encoded) as Wire;
  const definitions = new Map<number, Wire>();
  const visit = (w: unknown): void => {
    if (!w || typeof w !== "object") return;
    if (Array.isArray(w)) { w.forEach(visit); return; }
    const obj = w as { kind?: string; value?: unknown };
    if (obj.kind === "definition") {
      const [id, payload] = obj.value as [number, Wire];
      definitions.set(id, payload);
    }
    Object.values(w).forEach(visit);
  };
  visit(root);
  const resolve = (w: Wire): { kind: string; value: unknown } => {
    if (!w || typeof w !== "object") throw new Error("Expected wire container");
    if (w.kind === "definition") return resolve((w.value as [number, Wire])[1]);
    if (w.kind === "reference") return resolve(definitions.get(w.value as number)!);
    return w;
  };
  const field = (w: Wire, key: string): Wire => (resolve(w).value as [string, Wire][]).find(([k]) => k === key)![1];
  const bytes = (w: Wire) => new TextEncoder().encode(JSON.stringify(w)).byteLength;
  const checkpoints = field(root, "checkpoints"), rows = resolve(checkpoints).value as Wire[];
  return { count: rows.length, encoded: bytes(checkpoints),
    records: rows.reduce<number>((sum, row) => sum + bytes(field(row, "records")), 0),
    identities: rows.reduce<number>((sum, row) => sum + bytes(field(row, "identities")), 0),
    runtime: rows.reduce<number>((sum, row) => sum + bytes(field(row, "runtime")), 0) };
}

describe("#149 trusted indexed SSA receipt lineage", () => {
  it("validates only appended receipts in uninterrupted execution, with independent new-source reads", () => {
    const state = committed();
    const next = qualify(originalPayment("2026-07", money("3300")));
    resetSources();
    validateAuthoritativeState(state);
    const fork = cloneAuthoritativeState(state);
    expect(reads()).toEqual({ ssa: 0, inventory: 0 });
    applySsaMedicarePaymentAtomically(fork, next);
    // New event source qualification at atomic admission and receipt validation.
    expect(reads()).toEqual({ ssa: 6, inventory: 48 });
    expect(Object.keys(state.ssaMedicarePayments!)).toHaveLength(1);
    expect(Object.keys(fork.ssaMedicarePayments!)).toHaveLength(2);
    expect(fork.accounts[ids.bank]!.cash.equals(money("4600"))).toBe(true);
    resetSources();
    validateAuthoritativeState(fork);
    expect(reads()).toEqual({ ssa: 0, inventory: 0 });
  });

  it("does not reuse qualification for untracked, independently constructed or checkpoint roots", () => {
    const state = committed();
    const snapshot = snapshotAuthoritativeCheckpoint(state);
    const cases = [
      () => ({ ...state }),
      () => ({ ...state, ssaMedicarePayments: { ...state.ssaMedicarePayments } }),
      () => snapshot,
      () => createIndexedExecutionState(snapshot),
      () => createAuthoritativeState(state),
    ];
    for (const make of cases) {
      resetSources();
      expect(() => validateAuthoritativeState(make())).not.toThrow();
      expect(control.ssaCalls).toBeGreaterThanOrEqual(3);
      expect(control.calls).toBeGreaterThanOrEqual(24);
      control.missing = true;
      expect(() => validateAuthoritativeState(make())).toThrow();
    }
    // Even a structurally identical plain replacement on the same live root
    // drops the tracked-container proof and must consult sources again.
    resetSources();
    state.ssaMedicarePayments = { ...state.ssaMedicarePayments };
    validateAuthoritativeState(state);
    expect(reads()).toEqual({ ssa: 3, inventory: 24 });
    control.missing = true;
    expect(() => validateAuthoritativeState(state)).toThrow();
  });

  it.each(["delete", "replace", "tamper"])("rejects an earlier receipt %s", mode => {
    const state = committed(), [key, receipt] = Object.entries(state.ssaMedicarePayments!)[0]!;
    if (mode === "delete") delete state.ssaMedicarePayments![key];
    else state.ssaMedicarePayments![key] = { ...receipt,
      ...(mode === "tamper" ? { netBank: money("1300.01") } : {}) };
    expect(() => validateAuthoritativeState(state)).toThrow();
  });

  it.each(["claim", "recognitionIds", "settlementIds", "postedTransactionIds", "externalIdempotencyKeys", "owner", "currency"])
    ("does not skip changed historical %s", kind => {
      const state = committed(), receipt = Object.values(state.ssaMedicarePayments!)[0]!;
      if (kind === "claim") delete state.obligations[receipt.right.id];
      else if (kind === "owner") Object.assign(state.accounts[ids.bank]!, { ownerId: domainId("person", uuid(99)) });
      else if (kind === "currency") state.accounts[ids.bank]!.cash = money("3300", Currency.of("EUR"));
      else {
        const field = kind as keyof AuthoritativeState["identities"];
        Object.assign(state.identities, { [field]: [] });
      }
      expect(() => validateAuthoritativeState(state)).toThrow();
      expect(() => createIndexedExecutionState(state)).toThrow();
      expect(() => cloneAuthoritativeState(state)).toThrow();
    });

  it("rechecks all receipts after an unsupported account-root replacement", () => {
    const state = committed();
    state.accounts = { [ids.bank]: { ...state.accounts[ids.bank]! } };
    resetSources();
    validateAuthoritativeState(state);
    expect(reads()).toEqual({ ssa: 3, inventory: 24 });
    control.missing = true;
    expect(() => validateAuthoritativeState(state)).toThrow();
  });

  it("rejects a source revision on a new event's final reread without committing", () => {
    const state = committed(), next = qualify(originalPayment("2026-07", money("3300")));
    const before = canonicalSerialize(state);
    resetSources();
    control.changeSsa = (h, call) => call < 3 ? h : { ...h, originals: h.originals.map(o => ({ ...o, status: "withdrawn" })) };
    expect(() => applySsaMedicarePaymentAtomically(state, next)).toThrow();
    expect(canonicalSerialize(state)).toBe(before);
  });

  it("preserves legacy v1 receipts without original-provider requirements", () => {
    const state = opening();
    control.missing = true;
    const q = payment();
    applySsaMedicarePaymentAtomically(state, qualifySsaMedicarePayment(q, ids.household, ids.person));
    expect(state.accounts[ids.bank]!.cash.equals(money("3300"))).toBe(true);
    expect(() => validateAuthoritativeState(createAuthoritativeState(state))).not.toThrow();
    expect(reads()).toEqual({ ssa: 0, inventory: 0 });
  });

  it("bounds real entire-run provider reads independently for 1/12/24 detail and summary", () => {
    const measurements = [];
    const detailResults = new Map<number, string>();
    const readCounts: { tier: "detail" | "summary"; counts: ReturnType<typeof reads>[] }[] = [];
    for (const tier of ["detail", "summary"] as const) {
      const counts = [];
      for (const months of [1, 12, 24]) {
        resetSources();
        const f = fixture(months, undefined, "2026-01");
        let cash = money("2000");
        const payments = Array.from({ length: months }, (_, n) => {
          const q = originalPayment(`${2026 + Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, "0")}`, cash);
          cash = cash.plus(money("1300")); return q;
        });
        resetSources();
        const kernel = attachSsaMedicare(f.kernel, input(payments));
        const detail = tier === "detail" ? runHouseholdKernel({ kernel, runContext: f.context, resultTier: "detail" }) : undefined;
        const summary = detail === undefined ? runHouseholdKernel({ kernel, runContext: f.context }) : undefined;
        const out = detail ?? summary!;
        const count = reads(); counts.push(count);
        expect(out.periods, JSON.stringify(out.diagnostics)).toHaveLength(months);
        expect(out.state.accounts[ids.bank]!.cash.equals(cash)).toBe(true);
        expect(Object.keys(out.state.ssaMedicarePayments!)).toHaveLength(months);
        expect(Object.keys(out.state.obligations)).toHaveLength(3 * months);
        expect(out.periods.every(p => p.statements.income.equals(money("1500")) && p.statements.expenses.equals(money("200")))).toBe(true);
        const result = canonicalSerialize({ state: out.state, statements: out.periods.map(p => p.statements) });
        if (detail !== undefined) {
          detailResults.set(months, result);
          expect(detail.periods.every(p => p.transactions.length === 1 && p.transactions[0]!.legs.map(l =>
            `${l.posting}:${l.type}:${l.amount.amount}`).join(",") === "debit:cash:1300,debit:expense:200,credit:income:1500")).toBe(true);
        } else {
          expect(result).toBe(detailResults.get(months));
          const artifact = createPortableHouseholdReplayArtifact(summary!);
          const delta = checkpointBytes(artifact.encoded);
          expect(delta.count).toBe(months === 24 ? 1 : 0);
          expect(artifact.encoded).not.toContain("publisher-original-payload");
          measurements.push({ months, ...count, receiptBytes: new TextEncoder().encode(canonicalSerialize(out.state.ssaMedicarePayments)).byteLength,
            artifactBytes: new TextEncoder().encode(artifact.encoded).byteLength, checkpoint: delta,
            sourceBindingIdentityBytes: out.state.identities.externalIdempotencyKeys.filter(k => k.includes("ssa-medicare:source-binding"))
              .reduce((sum, k) => sum + new TextEncoder().encode(k).byteLength, 0) });
          if (months === 24) {
            control.missing = true;
            expect(() => restorePortableHouseholdReplayArtifact(JSON.parse(JSON.stringify(artifact)))).toThrow();
          }
        }
      }
      readCounts.push({ tier, counts });
    }
    // Emit source-call and checkpoint measurements even if a strict growth
    // assertion fails, so independent CI can diagnose the precise boundary.
    console.info("SSA_MEDICARE_GROWTH", JSON.stringify({ measurements, readCounts }));
    for (const { tier, counts } of readCounts) for (const family of ["ssa", "inventory"] as const) {
      expect(counts[2]![family], `${tier} ${family}: 24m vs 1m`).toBeLessThan(30 * counts[0]![family]);
      expect(counts[2]![family], `${tier} ${family}: 24m vs 12m`).toBeLessThan(3 * counts[1]![family]);
    }
  }, 25_000);
});
