import { beforeEach, describe, expect, it } from "vitest";
import { sha256 } from "../../../../../src/rules/tax/t1b/contentIdentity.js";
import { createFsaCashParticipant, fsaCashSourceFingerprint, type FsaCashInput } from "../../../../../src/simulation/d2/integration/fsaCash/index.js";
import { canonicalSerialize } from "../../../../../src/simulation/run.js";
import { createPortableHouseholdReplayArtifact } from "../../../../../src/simulation/r3/replayArtifact.js";
import { fundedHousehold, resetSources } from "../fundedScenario.js";
import { publishers } from "../combinedScenario.js";

beforeEach(resetSources);

describe("#149 S8-4 shared source-reference blocker (acceptance 5)", () => {
  it("exposes a complete FSA original in required configuration and portable transport", () => {
    const s = fundedHousehold({ months: 1 });
    const original = publishers.fsa("s8-medical-source")!;
    const fingerprint = fsaCashSourceFingerprint(original);
    // This passing characterization documents a blocker, never satisfaction
    // of the compact-reference acceptance requirement.
    expect(fingerprint).toBe(canonicalSerialize(original));
    const participant = s.kernel.executable.participants!.find(p => p.id === "d2_fsa_cash")!;
    const config = participant.economicInputs as FsaCashInput;
    expect(config.sources[0]!.expectedSource).toBe(fingerprint);
    expect(fingerprint).toContain("s8-medical-receipt");
    expect(fingerprint).toContain("bankCashBefore");
    const out = s.run();
    expect(out.periods, JSON.stringify(out.diagnostics)).toHaveLength(1);
    const artifact = createPortableHouseholdReplayArtifact(out);
    const strings: string[] = [];
    const visit = (value: unknown): void => {
      if (typeof value === "string") { strings.push(value); return; }
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (value && typeof value === "object") Object.values(value).forEach(visit);
    };
    visit(JSON.parse(artifact.encoded));
    expect(strings).toContain(fingerprint);
    // The existing consumer does not accept a digest of the exact same
    // independently published original. A test-only compact substitution
    // would bypass, rather than satisfy, the source-owner contract.
    expect(() => createFsaCashParticipant({ ...config, sources: [{ sourceId: original.sourceId,
      expectedSource: sha256(fingerprint) }] })).toThrow("Source identity/version or pinned raw facts changed");
  });
});
