import { beforeEach, describe, expect, it } from "vitest";
import { sha256 } from "../../../../../src/rules/tax/t1b/contentIdentity.js";
import { createFsaCashParticipant, fsaCashSourceFingerprint, type FsaCashInput } from "../../../../../src/simulation/d2/integration/fsaCash/index.js";
import { runHouseholdKernel, replayHouseholdForecastWindow } from "../../../../../src/simulation/householdExecution.js";
import { canonicalSerialize } from "../../../../../src/simulation/run.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../../../../../src/simulation/r3/replayArtifact.js";
import { fundedHousehold, resetSources } from "../fundedScenario.js";
import { publishers } from "../combinedScenario.js";

beforeEach(resetSources);

describe("#149 S8-4 compact FSA v2 source references", () => {
  it("pins full-source UTF-8 evidence in configuration and portable receipts without copying originals", () => {
    const s = fundedHousehold({ months: 2 });
    const original = publishers.fsa("s8-medical-source")!;
    const fingerprint = fsaCashSourceFingerprint(original);
    expect(fingerprint).toBe(`fsa-cash-source/v2:sha256:${sha256(canonicalSerialize(original))}`);
    const participant = s.kernel.executable.participants!.find(p => p.id === "d2_fsa_cash")!;
    const config = participant.economicInputs as FsaCashInput;
    expect(participant.portableCodec).toBe("d2-fsa-cash/v2");
    expect(config.sources).toEqual([{ sourceId: original.sourceId, expectedSource: fingerprint }]);
    expect(fingerprint).not.toContain("s8-medical-receipt");
    expect(fingerprint).not.toContain("bankCashBefore");
    const out = runHouseholdKernel({ kernel: s.kernel, runContext: s.context });
    expect(out.periods, JSON.stringify(out.diagnostics)).toHaveLength(2);
    const receipt = Object.values(out.state.d2SettlementReceipts!).find(r => r.kind === "fsa_paid_reimbursement")!;
    expect(receipt.source.sourceVersion).toBe(canonicalSerialize({ version: original.version, inputs: fingerprint }));
    expect(receipt.sourceEvidenceFingerprint).not.toContain(canonicalSerialize(original));
    const artifact = createPortableHouseholdReplayArtifact(out);
    const strings: string[] = [];
    const visit = (value: unknown): void => {
      if (typeof value === "string") { strings.push(value); return; }
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (value && typeof value === "object") Object.values(value).forEach(visit);
    };
    visit(JSON.parse(artifact.encoded));
    expect(strings).toContain(fingerprint);
    expect(strings).not.toContain(canonicalSerialize(original));
    expect(artifact.encoded).not.toContain("Fixed artificial plan; not law");
    const restored = restorePortableHouseholdReplayArtifact(JSON.parse(JSON.stringify(artifact)));
    expect(replayHouseholdForecastWindow(restored, out.periods[1]!.period).state).toEqual(out.state);
    // A copied reference cannot authenticate a changed independent original.
    publishers.fsa = () => ({ ...original, deposit: { ...original.deposit, paymentApprovalId: "changed" } });
    expect(() => createFsaCashParticipant(config)).toThrow("Source identity/version or pinned raw facts changed");
    expect(() => restorePortableHouseholdReplayArtifact({ ...artifact })).toThrow();
    publishers.fsa = () => undefined;
    expect(() => restorePortableHouseholdReplayArtifact({ ...artifact })).toThrow();
  });
});
