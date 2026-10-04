import { describe, expect, it } from "vitest";
import { CalibrationSnapshotRegistry, CalibrationValidationError, calibrationReference, createCalibrationSet, type CalibrationDraft } from "../src/calibration/index.js";
import { SYNTHETIC_CALIBRATION_BASELINE } from "../src/calibration/baseline.js";
import { canonicalSerialize } from "../src/simulation/run.js";
import { c1CalibrationDraft } from "./fixtures/c1Calibration.js";

const reverseObjectKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseObjectKeys(child)]));
  return value;
};

describe("C1 provider-neutral calibration contract (PFA-CAL-001 through 009)", () => {
  it("provides an explicit synthetic vintage with moments, terms, dependence, and audit metadata", () => {
    const baseline = SYNTHETIC_CALIBRATION_BASELINE;
    expect(baseline.source.kind).toBe("synthetic");
    expect(baseline.schemaVersion).toBe("calibration/v1");
    expect(baseline.id).toBe(baseline.fingerprint);
    expect(baseline.fingerprint).toMatch(/^calibration:fnv1a64:v1:[0-9a-f]{16}$/);
    expect(baseline.baseCurrency).toBe("USD");
    expect(baseline.basis).toBe("nominal");
    expect(baseline.members.length).toBe(3);
    expect(baseline.members.every(member => member.kind === "asset_class")).toBe(true);
    expect(baseline.members.find(member => member.id === "broad_equity")!.terms).toHaveLength(2);
    expect(baseline.source.provenance.attribution).toContain("no institutional research claims");
    expect(createCalibrationSet(c1CalibrationDraft())).toEqual(baseline);
    expect(createCalibrationSet(baseline)).toEqual(baseline);
  });

  it("normalizes object/member/term/matrix ordering and exact decimal spelling", () => {
    const draft = c1CalibrationDraft();
    draft.members.reverse();
    for (const member of draft.members) {
      member.terms.reverse();
      for (const term of member.terms) {
        term.expectedReturn = `+${term.expectedReturn}00`;
        term.volatility = ` ${term.volatility}0 `;
      }
    }
    draft.baseCurrency = " usd ";
    draft.source.id = ` ${draft.source.id} `;
    const order = [2, 0, 1];
    const original = draft.dependence;
    draft.dependence = { kind: original.kind, members: order.map(i => original.members[i]!), matrix: order.map(i => order.map(j => {
      const value = original.matrix[i]![j]!;
      return `${value}${value.includes(".") ? "0" : ".0"}`;
    })) };
    const normalized = createCalibrationSet(reverseObjectKeys(draft) as CalibrationDraft);
    expect(normalized).toEqual(SYNTHETIC_CALIBRATION_BASELINE);
    expect(createCalibrationSet({ ...c1CalibrationDraft(), metadata: undefined } as unknown as CalibrationDraft).fingerprint)
      .toBe(createCalibrationSet((({ metadata: _metadata, ...rest }) => rest)(c1CalibrationDraft())).fingerprint);
  });

  it("collapses economically identical adjacent terms and empty optional metadata", () => {
    const draft = c1CalibrationDraft();
    const bonds = draft.members.find(member => member.id === "broad_bonds")!;
    const term = bonds.terms[0]!;
    bonds.terms = [{ ...term, endMonth: 12 }, { ...term, startMonth: 12 }];
    expect(createCalibrationSet(draft).fingerprint).toBe(SYNTHETIC_CALIBRATION_BASELINE.fingerprint);
    draft.metadata = {};
    const { metadata: _metadata, ...withoutMetadata } = c1CalibrationDraft();
    expect(createCalibrationSet(draft).fingerprint).toBe(createCalibrationSet(withoutMetadata).fingerprint);
  });

  it("uses the existing canonical JSON / UTF-8 FNV convention", () => {
    const { id: _id, fingerprint: _fingerprint, ...economic } = SYNTHETIC_CALIBRATION_BASELINE;
    let hash = 0xcbf29ce484222325n;
    for (const byte of new TextEncoder().encode(canonicalSerialize(economic))) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
    expect(SYNTHETIC_CALIBRATION_BASELINE.fingerprint).toBe(`calibration:fnv1a64:v1:${hash.toString(16).padStart(16, "0")}`);
  });

  const changes: [string, (draft: ReturnType<typeof c1CalibrationDraft>) => void][] = [
    ["expected return", draft => { draft.members[0]!.terms[0]!.expectedReturn = "0.031"; }],
    ["volatility", draft => { draft.members[0]!.terms[0]!.volatility = "0.061"; }],
    ["term boundary", draft => { const m = draft.members.find(m => m.id === "broad_equity")!; m.terms[0]!.endMonth = 48; m.terms[1]!.startMonth = 48; }],
    ["correlation", draft => { draft.dependence.matrix[0]![1] = "0.25"; draft.dependence.matrix[1]![0] = "0.25"; }],
    ["source version", draft => { draft.source.version = "2"; }],
    ["mapping version", draft => { draft.source.mapping.version = "2"; }],
    ["methodology version", draft => { draft.source.methodology.version = "2"; }],
    ["basis", draft => { draft.basis = "real"; }],
    ["currency", draft => { draft.baseCurrency = "EUR"; }],
    ["member definition", draft => { draft.members[0]!.definition += " refined"; }],
    ["regime", draft => { draft.metadata!.regime = "Other explicit synthetic regime"; }],
    ["vintage", draft => { draft.source.dataCutoff = "2025-12-01T00:00:00.000Z"; }],
    ["horizon", draft => { draft.horizon.months = 121; for (const m of draft.members) m.terms[m.terms.length - 1]!.endMonth = 121; }],
  ];
  it.each(changes)("creates a new identity when %s changes", (_label, change) => {
    const draft = c1CalibrationDraft();
    change(draft);
    expect(createCalibrationSet(draft).fingerprint).not.toBe(SYNTHETIC_CALIBRATION_BASELINE.fingerprint);
  });

  it("owns immutable copies and reuses one snapshot across many fingerprint-only run references", () => {
    const registry = new CalibrationSnapshotRegistry();
    const draft = c1CalibrationDraft();
    const first = registry.intern(draft);
    expect(registry.intern(SYNTHETIC_CALIBRATION_BASELINE)).toBe(first);
    for (let i = 0; i < 20; i++) {
      expect(registry.intern(c1CalibrationDraft())).toBe(first);
      expect(registry.resolve(calibrationReference(first))).toBe(first);
    }
    expect(registry.size).toBe(1);
    expect(Object.keys(calibrationReference(first)).sort()).toEqual(["fingerprint", "schemaVersion"]);
    draft.members[0]!.terms[0]!.volatility = "0.07";
    expect(registry.intern(draft)).not.toBe(first);
    expect(registry.size).toBe(2);
    expect(() => registry.intern({ ...first, fingerprint: "forged" } as never)).toThrow(/identity/);
    expect(() => registry.intern({ ...first, basis: "real" })).toThrow(/identity/);
    expect(registry.size).toBe(2);
    const assertFrozen = (value: unknown): void => {
      if (value !== null && typeof value === "object") {
        expect(Object.isFrozen(value)).toBe(true);
        Object.values(value).forEach(assertFrozen);
      }
    };
    assertFrozen(first);
    expect(() => { (first.members[0]!.terms[0] as { volatility: string }).volatility = "1"; }).toThrow(TypeError);
    expect(first.fingerprint).toBe(SYNTHETIC_CALIBRATION_BASELINE.fingerprint);
    expect(() => new CalibrationSnapshotRegistry().resolve(calibrationReference(first))).toThrow(/unavailable/);
    expect(() => registry.resolve({ ...calibrationReference(first), schemaVersion: "other" } as never)).toThrow(/version/);
    expect(() => registry.intern({ ...draft, basis: "ambiguous" } as never)).toThrow(CalibrationValidationError);
    expect(registry.size).toBe(2);
  });

  it.each(["NaN", "Infinity", "-Infinity", "1e-2", "", "not-a-number", NaN, Infinity, 0.1])("rejects malformed or floating parameters: %s", value => {
    const draft = c1CalibrationDraft();
    draft.members[0]!.terms[0]!.expectedReturn = value as string;
    expect(() => createCalibrationSet(draft)).toThrow(CalibrationValidationError);
  });

  const invalidChanges: [string, (draft: ReturnType<typeof c1CalibrationDraft>) => void][] = [
    ["negative volatility", d => { d.members[0]!.terms[0]!.volatility = "-0.01"; }],
    ["impossible simple return", d => { d.members[0]!.terms[0]!.expectedReturn = "-1.01"; }],
    ["duplicate trimmed keys", d => { d.members.push({ ...d.members[0]!, id: ` ${d.members[0]!.id} ` }); }],
    ["unknown member", d => { d.dependence.members[0] = "issuer:unknown"; }],
    ["duplicate matrix key", d => { d.dependence.members[0] = d.dependence.members[1]!; }],
    ["missing matrix row", d => { d.dependence.matrix.pop(); }],
    ["ragged matrix", d => { d.dependence.matrix[0]!.pop(); }],
    ["asymmetry", d => { d.dependence.matrix[0]![1] = "0.3"; }],
    ["non-unit diagonal", d => { d.dependence.matrix[0]![0] = "0.99"; }],
    ["correlation range", d => { d.dependence.matrix[0]![1] = "1.01"; }],
    ["non-PSD matrix", d => { d.dependence.matrix = [["1", "0.9", "0.9"], ["0.9", "1", "-0.9"], ["0.9", "-0.9", "1"]]; }],
    ["zero pivot with residual", d => { d.dependence.matrix = [["1", "1", "0"], ["1", "1", "0.1"], ["0", "0.1", "1"]]; }],
    ["zero horizon", d => { d.horizon.months = 0; }],
    ["fractional horizon", d => { d.horizon.months = 1.5; }],
    ["non-finite horizon", d => { d.horizon.months = Infinity; }],
    ["currency", d => { d.baseCurrency = "BTC"; }],
    ["basis", d => { d.basis = "unspecified" as never; }],
    ["gap", d => { d.members[0]!.terms[0]!.startMonth = 1; }],
    ["overlap", d => { const m = d.members.find(m => m.id === "broad_equity")!; m.terms[1]!.startMonth = 59; }],
    ["incomplete term", d => { d.members[0]!.terms[0]!.endMonth = 119; }],
    ["negative term", d => { d.members[0]!.terms[0]!.startMonth = -1; }],
    ["date", d => { d.source.publishedAt = "2026-02-30T00:00:00.000Z"; }],
    ["future cutoff", d => { d.source.dataCutoff = "2027-01-01T00:00:00.000Z"; }],
    ["missing license", d => { d.source.provenance.license = " "; }],
    ["silent blend", d => { d.source.kind = "blend" as never; }],
    ["unsupported dependence", d => { d.dependence.kind = "copula" as never; }],
  ];
  it.each(invalidChanges)("rejects %s explicitly", (_label, change) => {
    const draft = c1CalibrationDraft();
    change(draft);
    expect(() => createCalibrationSet(draft)).toThrow(CalibrationValidationError);
  });

  it("accepts singular PSD matrices, including an intermediate zero pivot", () => {
    const draft = c1CalibrationDraft();
    for (const matrix of [
      [["1", "1", "1"], ["1", "1", "1"], ["1", "1", "1"]],
      [["1", "1", "0.1"], ["1", "1", "0.1"], ["0.1", "0.1", "1"]],
      [["1", "-1", "0"], ["-1", "1", "0"], ["0", "0", "1"]],
    ]) {
      draft.dependence.matrix = matrix;
      expect(() => createCalibrationSet(draft)).not.toThrow();
    }
  });

  it("validates a four-member PSD matrix beyond an intermediate zero pivot", () => {
    const draft = c1CalibrationDraft();
    draft.members.push({ ...draft.members[0]!, kind: "sector", id: "synthetic_sector" });
    draft.dependence.members.push("sector:synthetic_sector");
    draft.dependence.matrix = [
      ["1", "1", "0.1", "0.2"], ["1", "1", "0.1", "0.2"],
      ["0.1", "0.1", "1", "0.3"], ["0.2", "0.2", "0.3", "1"],
    ];
    expect(() => createCalibrationSet(draft)).not.toThrow();
  });

  it("rejects unsupported/ambiguous mappings rather than inferring issuer returns or blending sources", () => {
    expect(() => createCalibrationSet({ ...c1CalibrationDraft(), analystPriceTarget: "100" } as never)).toThrow(/Unsupported fields/);
    const draft = c1CalibrationDraft();
    Object.assign(draft.members[0]!, { aliases: ["ambiguous-provider-label"] });
    expect(() => createCalibrationSet(draft)).toThrow(/Unsupported fields/);
    expect(() => createCalibrationSet(null as never)).toThrow(CalibrationValidationError);
    const sparse = c1CalibrationDraft();
    delete sparse.members[0];
    expect(() => createCalibrationSet(sparse)).toThrow(/Sparse/);
  });
});
