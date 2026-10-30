import { beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { idempotencyKey } from "../../../../src/identity/index.js";
import { Money, money } from "../../../../src/values/index.js";
import { applySsaMedicarePaymentAtomically, createAuthoritativeState, createIndexedExecutionState,
  type AuthoritativeState, type SsaMedicarePaymentRecord } from "../../../../src/state/index.js";
import { qualifySsaMedicarePayment } from "../../../../src/simulation/d2/integration/ssaMedicare/index.js";
import { canonicalSerialize, createInputFingerprint } from "../../../../src/simulation/run.js";
import { runHouseholdKernel, replayHouseholdForecastWindow } from "../../../../src/simulation/householdExecution.js";
import { attachSsaMedicare } from "../../../../src/simulation/d2/integration/ssaMedicare/index.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../../../../src/simulation/r3/replayArtifact.js";
import { fixture, ids, input, payment } from "./scenario.js";
import { control, originalPayment, register, resetSources } from "./originalScenario.js";

register();
beforeEach(resetSources);
// Independent historical v1 normalization oracle; Node crypto separately
// checks the v2 digest against the exact same historical tuple bytes.
const historicalValue = (v: unknown): unknown => typeof v === "bigint" ? ["bigint", v.toString()]
  : v instanceof Money ? ["USD-money", v.currency.code, v.amount.toString()]
  : Array.isArray(v) ? v.map(historicalValue)
  : v !== null && typeof v === "object"
    ? "toJSON" in v && typeof v.toJSON === "function" ? historicalValue(v.toJSON())
      : Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, historicalValue(x)])) : v;
const tuple = (r: SsaMedicarePaymentRecord) => JSON.stringify(historicalValue({ payable: r.payable, right: r.right,
  requests: r.requests, bankAccountId: r.bankAccountId, bankCashBefore: r.bankCashBefore,
  rightSettlementId: r.rightSettlementId, sourceInputs: r.sourceInputs }));
const sourceKeys = (s: AuthoritativeState) => s.identities.externalIdempotencyKeys.filter(k => k.includes("ssa-medicare:source-binding"));
const posted = (q = originalPayment()) => {
  const state = createIndexedExecutionState(fixture().state);
  const receipt = applySsaMedicarePaymentAtomically(state, qualifySsaMedicarePayment(q, ids.household, ids.person));
  return { state, receipt };
};
// Reconstruct an archive in the historical format, without changing any
// financial field or importing it through new-event admission.
const historicalArchive = () => {
  const { state, receipt } = posted();
  const v1 = { ...receipt, version: "ssa-medicare-payment/v1" as const };
  return { ...state, ssaMedicarePayments: { [receipt.id]: v1 }, identities: { ...state.identities,
    externalIdempotencyKeys: state.identities.externalIdempotencyKeys.map(k => sourceKeys(state).includes(k)
      ? idempotencyKey("ssa-medicare:source-binding", tuple(v1)) : k).sort() } };
};

describe("#149 versioned source consumption identities", () => {
  it("keeps historical original-backed v1 byte-exact across cold imports and still requalifies originals", () => {
    const archive = historicalArchive(), before = canonicalSerialize(archive), keys = [...sourceKeys(archive)];
    resetSources();
    const restored = createAuthoritativeState(archive);
    expect(control.ssaCalls).toBeGreaterThanOrEqual(3);
    expect(control.calls).toBeGreaterThanOrEqual(24);
    expect(canonicalSerialize(restored)).toBe(before);
    expect(canonicalSerialize(archive)).toBe(before);
    expect(sourceKeys(restored)).toEqual(keys);
    expect(keys[0]!.length).toBeGreaterThan(10_000);
    control.missing = true;
    expect(() => createAuthoritativeState(archive)).toThrow();
  });

  it("keeps plain v1 posting/import exact without upgrading original-source assurance", () => {
    control.missing = true;
    const { state, receipt } = posted(payment());
    expect(receipt.version).toBe("ssa-medicare-payment/v1");
    expect(sourceKeys(state)).toEqual([idempotencyKey("ssa-medicare:source-binding", tuple(receipt))]);
    expect(receipt.sourceInputs).not.toHaveProperty("originalSources");
    const archive = { ...state };
    expect(canonicalSerialize(createAuthoritativeState(archive))).toBe(canonicalSerialize(archive));
    expect(control.ssaCalls).toBe(0);
    expect(control.calls).toBe(0);
  });

  it("emits fixed-size SHA-256 identities checked by an independent implementation", () => {
    const lengths = [];
    for (const size of [0, 10_000]) {
      const q = { ...originalPayment(), syntheticAnnotation: "x".repeat(size) };
      const { state, receipt } = posted(q);
      expect(receipt.version).toBe("ssa-medicare-payment/v2");
      const expected = idempotencyKey("ssa-medicare:source-binding/v2", `sha256:${createHash("sha256").update(tuple(receipt)).digest("hex")}`);
      expect(sourceKeys(state)).toEqual([expected]);
      expect(expected).not.toContain("syntheticAnnotation");
      lengths.push(new TextEncoder().encode(expected).byteLength);
      expect(canonicalSerialize(createAuthoritativeState({ ...state }))).toBe(canonicalSerialize(state));
    }
    expect(lengths[0]).toBe(lengths[1]);
    expect(lengths[0]).toBeLessThan(160);
  });

  it.each(["missing", "copied", "algorithm", "format", "version", "downgrade", "provenance", "right", "account", "request"])
    ("rejects a cold v2 archive with changed %s despite otherwise valid history", kind => {
      const { state, receipt } = posted();
      let changed = { ...receipt };
      const keys = [...state.identities.externalIdempotencyKeys], key = sourceKeys(state)[0]!;
      const at = keys.indexOf(key);
      if (kind === "missing") keys.splice(at, 1);
      if (kind === "copied") keys[at] = sourceKeys(posted(originalPayment("2026-07")).state)[0]!;
      if (kind === "algorithm") keys[at] = key.replace("sha256:", "fnv256:") as typeof key;
      if (kind === "format") keys[at] = key.slice(0, -1) as typeof key;
      if (kind === "version") changed = { ...changed, version: "ssa-medicare-payment/v9" as typeof receipt.version };
      if (kind === "downgrade") changed = { ...changed, version: "ssa-medicare-payment/v1" };
      if (kind === "provenance") changed = { ...changed, sourceInputs: { ...(receipt.sourceInputs as object), syntheticAnnotation: "altered" } };
      if (kind === "right") changed = { ...changed, rightSettlementId: "changed" as typeof receipt.rightSettlementId };
      if (kind === "account") changed = { ...changed, bankCashBefore: money("2000.01") };
      if (kind === "request") changed = { ...changed, requests: [...changed.requests].reverse() };
      const archive = { ...state, ssaMedicarePayments: { [receipt.id]: changed }, identities: { ...state.identities, externalIdempotencyKeys: keys } };
      expect(() => createAuthoritativeState(archive)).toThrow();
    });

  it("rejects v2 second-read original revision races during cold import", () => {
    const archive = { ...posted().state };
    resetSources();
    control.changeSsa = (h, call) => call < 3 ? h : { ...h, originals: h.originals.map(o => ({ ...o, status: "withdrawn" })) };
    expect(() => createAuthoritativeState(archive)).toThrow();
  });

  it("cold-replays a mixed original v1/v2 household in an independent process", () => {
    const archive = historicalArchive(), before = canonicalSerialize(archive);
    const f = fixture(13, createAuthoritativeState(archive), "2026-07");
    const next = originalPayment("2026-07", money("3300"));
    const kernel = attachSsaMedicare(f.kernel, input([next]));
    const detail = runHouseholdKernel({ kernel, runContext: f.context, resultTier: "detail" });
    const summary = runHouseholdKernel({ kernel, runContext: f.context });
    expect(detail.periods, JSON.stringify(detail.diagnostics)).toHaveLength(13);
    expect(canonicalSerialize(summary.state)).toBe(canonicalSerialize(detail.state));
    expect(Object.values(summary.state.ssaMedicarePayments!).map(r => r.version).sort())
      .toEqual(["ssa-medicare-payment/v1", "ssa-medicare-payment/v2"]);
    expect(summary.state.accounts[ids.bank]!.cash.equals(money("4600"))).toBe(true);
    expect(Object.keys(summary.state.obligations)).toHaveLength(6);
    expect(canonicalSerialize(archive)).toBe(before);
    const artifact = createPortableHouseholdReplayArtifact(summary), selected = detail.periods.at(-1)!.period;
    const restored = restorePortableHouseholdReplayArtifact(artifact);
    expect(canonicalSerialize(replayHouseholdForecastWindow(restored, selected).state)).toBe(canonicalSerialize(detail.state));
    // An intact outer checksum cannot make an altered digest authentic.
    const encoded = artifact.encoded.replace(/(ssa-medicare:source-binding\/v2:71:sha256:)[a-f0-9]{64}/g,
      (_match, prefix: string) => `${prefix}${"0".repeat(64)}`);
    expect(encoded).not.toBe(artifact.encoded);
    expect(() => restorePortableHouseholdReplayArtifact({ ...artifact, encoded,
      integrity: createInputFingerprint({ runContext: f.context, openingState: encoded }) })).toThrow();
    const directory = mkdtempSync(join(tmpdir(), "pfm-mixed-ssa-"));
    try {
      const payload = join(directory, "replay.json");
      writeFileSync(payload, JSON.stringify({ artifact, selected }));
      for (const availability of ["available", "missing", "unregistered"]) {
        const child = spawnSync(process.execPath, [fileURLToPath(new URL("../../../../node_modules/vite-node/vite-node.mjs", import.meta.url)),
          fileURLToPath(new URL("./originalPortableWorker.ts", import.meta.url))], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
          env: { ...process.env, PFM_SSA_MEDICARE_TEST_PAYLOAD: payload, PFM_ORIGINALS_UNAVAILABLE: availability } });
        expect(child.status, child.stderr).toBe(0);
        expect(JSON.parse(child.stdout)).toEqual(availability === "available" ? {
          state: canonicalSerialize(detail.state), periods: canonicalSerialize(detail.periods.slice(-1)),
        } : { refused: true });
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 60_000);
});
