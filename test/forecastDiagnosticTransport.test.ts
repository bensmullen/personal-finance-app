import { describe, expect, it } from "vitest";
import { createForecastDiagnosticTransport, forecastDiagnosticBytes, rehydrateForecastLaw, validateForecastCatalogTable, validateForecastDiagnostics,
  type ForecastCatalogRef } from "../src/application/forecastDiagnosticTransport.js";
import { taxDiagnostic, taxOutputCapabilities, type ProjectedCurrentLawAssumption, type TaxCapabilityDiagnostic } from "../src/simulation/tax/contracts.js";
import { instant } from "../src/time/index.js";
import { forecastResultCatalogsValid } from "../src/application/interactiveForecast.js";

const source = { runId: "synthetic-run", inputFingerprint: "original-engine-input" };
const content = JSON.stringify({ rules: ["exact catalog 😀", "é"], version: "test/v1" });
const assumption: ProjectedCurrentLawAssumption = { version: "projected-current-law/v1", selection: "projectedCurrentLawThrough",
  modelId: "model", householdId: "household", through: "2029-01-01", catalogFingerprint: content };
const warning: TaxCapabilityDiagnostic = { ...taxDiagnostic("projected_current_law", "Future law is an assumption", "US:FEDERAL"), taxYear: "2027",
  projectedLaw: { assumption, catalogFingerprint: content, ruleId: "projected-rule", ruleVersion: "projected/v1", baseRuleId: "source-rule",
    baseRuleVersion: "source/v1", baseYear: 2026, effectiveFrom: instant("2027-01-01T00:00:00.000Z"), effectiveUntil: instant("2029-01-01T00:00:00.000Z") } };

describe("run-owned projected tax diagnostic transport", () => {
  it("retains every occurrence and exact provenance with one immutable exact-content catalog", () => {
    const transport = createForecastDiagnosticTransport(source);
    const original = [warning, { ...warning, taxYear: "2028" }, structuredClone(warning)];
    const before = JSON.stringify(original);
    const compact = original.map(item => transport.diagnostic(item));
    const table = transport.table();
    expect(compact).toHaveLength(3);
    expect(table.entries).toHaveLength(1);
    expect(table.entries[0]!.content).toBe(content);
    expect(Object.isFrozen(table)).toBe(true);
    expect(Object.isFrozen(table.source)).toBe(true);
    expect(Object.isFrozen(table.entries)).toBe(true);
    expect(Object.isFrozen(table.entries[0])).toBe(true);
    compact.forEach((item, index) => {
      expect(item.projectedLaw!.catalogRef).toBe(table.entries[0]!.id);
      expect(item.projectedLaw!.assumption!.catalogRef).toBe(item.projectedLaw!.catalogRef);
      expect("catalogFingerprint" in item.projectedLaw!).toBe(false);
      expect("catalogFingerprint" in item.projectedLaw!.assumption!).toBe(false);
      expect({ ...item, projectedLaw: rehydrateForecastLaw(item.projectedLaw!, table, source, [content]) }).toEqual(original[index]);
    });
    expect(JSON.stringify(original)).toBe(before);
    expect(forecastDiagnosticBytes(compact, table).canonical).toBe(forecastDiagnosticBytes(original, table).compact);
  });

  it("deduplicates by actual content, separates distinct catalogs and run identities", () => {
    const transport = createForecastDiagnosticTransport(source);
    transport.diagnostic(warning);
    transport.diagnostic({ ...warning, projectedLaw: { ...warning.projectedLaw!, assumption: { ...assumption, catalogFingerprint: `${content} ` }, catalogFingerprint: `${content} ` } });
    expect(transport.table().entries.map(entry => entry.content)).toEqual([content, `${content} `]);
    const other = createForecastDiagnosticTransport({ ...source, runId: "another-run" });
    expect(other.diagnostic(warning).projectedLaw!.catalogRef).not.toBe(transport.diagnostic(warning).projectedLaw!.catalogRef);
    expect(() => transport.diagnostic({ ...warning, projectedLaw: { ...warning.projectedLaw!, assumption: { ...assumption, catalogFingerprint: "wrong" } } })).toThrow(/CATALOG_MISMATCH/);
  });

  it("preserves exact tax-output status and affected output identity", () => {
    const transport = createForecastDiagnosticTransport(source);
    const qualified = taxOutputCapabilities([warning], assumption);
    const gap = taxOutputCapabilities([warning, taxDiagnostic("settlement_timing", "Missing settlement")], assumption);
    for (const canonical of [qualified, gap]) {
      const compact = transport.capabilities(canonical);
      for (const [name, output] of Object.entries(canonical)) {
        const actual = compact[name]!;
        expect(actual.status).toBe(output.status);
        expect(actual.dependency).toBe(output.dependency);
        expect(actual.diagnostics.map(item => ({ ...item, ...(item.projectedLaw ? {
          projectedLaw: rehydrateForecastLaw(item.projectedLaw, transport.table(), source, [content]),
        } : {}) }))).toEqual(output.diagnostics);
      }
      validateForecastDiagnostics([], [compact], transport.table(), source);
    }
    expect(transport.capabilities(qualified).cash!.status).toBe(qualified.cash!.status);
    expect(transport.capabilities(gap).cash!.status).toBe("incomplete");
  });

  it("fails closed on missing, duplicate, cross-source and tampered references/content", () => {
    const transport = createForecastDiagnosticTransport(source);
    const compact = transport.diagnostic(warning), table = transport.table(), law = compact.projectedLaw!;
    expect(() => validateForecastDiagnostics([compact], [], undefined)).toThrow(/CATALOG_MISMATCH/);
    expect(() => validateForecastCatalogTable({ ...table, entries: [...table.entries, table.entries[0]!] }, source)).toThrow(/CATALOG_MISMATCH/);
    expect(() => rehydrateForecastLaw(law, table, { ...source, inputFingerprint: "wrong" }, [content])).toThrow(/CATALOG_MISMATCH/);
    expect(() => rehydrateForecastLaw(law, { ...table, entries: [{ ...table.entries[0]!, content: "changed catalog" }] }, source, [content])).toThrow(/CATALOG_MISMATCH/);
    for (const invalid of [
      { ...law, catalogRef: "missing" as ForecastCatalogRef },
      { ...law, assumption: { ...law.assumption!, catalogRef: "another" as ForecastCatalogRef } },
      { ...law, catalogFingerprint: "inline canonical content" },
    ]) {
      expect(() => rehydrateForecastLaw(invalid, table, source, [content])).toThrow(/CATALOG_MISMATCH/);
    }
    const comparison = { status: "completed" as const, baselineName: "Current plan", alternatives: [], diagnostics: [compact], diagnosticCatalogs: [table] };
    expect(forecastResultCatalogsValid(comparison)).toBe(true);
    expect(forecastResultCatalogsValid({ ...comparison, diagnosticCatalogs: [] })).toBe(false);
    expect(forecastResultCatalogsValid({ ...comparison, diagnosticCatalogs: [table, table] })).toBe(false);
  });

  it("reports sharply smaller diagnostic bytes without expanding the repeated catalog", () => {
    const longCatalog = "synthetic exact catalog ".repeat(10_000);
    const transport = createForecastDiagnosticTransport(source);
    const canonical = { ...warning, projectedLaw: { ...warning.projectedLaw!, catalogFingerprint: longCatalog, assumption: { ...assumption, catalogFingerprint: longCatalog } } };
    const originals = Array.from({ length: 24 }, (_, index) => ({ ...canonical, taxYear: String(2027 + index), projectedLaw: { ...canonical.projectedLaw } }));
    const compact = originals.map(item => transport.diagnostic(item));
    const sizes = forecastDiagnosticBytes(compact, transport.table());
    expect(transport.table().entries).toHaveLength(1);
    expect(sizes.compact).toBeLessThan(sizes.canonical / 50);
    expect(sizes.canonical).toBe(forecastDiagnosticBytes(originals, transport.table()).compact);
    expect(transport.diagnostic(originals[0]!)).toBe(compact[0]);
    const capabilities = taxOutputCapabilities([warning], assumption), converted = transport.capabilities(capabilities);
    expect(transport.capabilities(capabilities)).toBe(converted);
    expect(converted.cash).toBe(converted.netWorth);
  });
});
