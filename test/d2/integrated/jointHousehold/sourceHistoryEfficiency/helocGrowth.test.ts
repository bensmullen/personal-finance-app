import { describe, expect, it } from "vitest";
import { runHouseholdKernel } from "../../../../../src/simulation/householdExecution.js";
import { canonicalSerialize } from "../../../../../src/simulation/run.js";
import { money } from "../../../../../src/values/index.js";
import { qualifyHelocServicingSource } from "../../../../../src/simulation/d2/integration/helocServicing/index.js";
import { documents, fixture, ids, publish, publisher, registerPublisher, withProvenance } from "../../helocServicing/scenario.js";

registerPublisher();

describe("independent HELOC source history work", () => {
  it("rejects changed embedded principal history while the earlier independent document remains byte-identical", () => {
    const [first, second] = documents(2, true);
    const before = canonicalSerialize(first);
    const request = second!.issuer.request;
    const [prior] = request.checkpoint.history;
    const altered = { ...second!, issuer: withProvenance({ ...second!.issuer,
      request: { ...request, checkpoint: { ...request.checkpoint, originalPrincipal: money("999"),
        history: [{ ...prior!, principal: money("9"), cash: money("10") }] } },
    }) };
    publish([first!, altered]);
    const { kernel, context } = fixture(3);
    expect(qualifyHelocServicingSource(altered.issuer.sourceId, context).status).toBe("qualified");
    const result = runHouseholdKernel({ kernel, runContext: context, resultTier: "detail" });
    expect(result.status).toBe("incomplete");
    expect(result.periods).toHaveLength(2);
    expect(result.state.accounts[ids.bank]!.cash.equals(money("489"))).toBe(true);
    expect(result.state.liabilities[ids.principal]!.balance.equals(money("990"))).toBe(true);
    expect(Object.values(result.state.d2SettlementReceipts ?? {})).toHaveLength(1);
    expect(canonicalSerialize(first)).toBe(before);
  });

  it.each([1, 12, 24])("separates original cumulative bytes from publisher rereads for %i actual debits", count => {
    const originals = documents(count, true);
    const issuerById = new Map(originals.map(({ issuer }) => [issuer.sourceId, issuer]));
    const bankById = new Map(originals.map(({ bank }) => [bank.id, bank]));
    const bytes = (value: unknown) => new TextEncoder().encode(canonicalSerialize(value)).byteLength;
    const uniqueIssuerBytes = originals.reduce((total, { issuer }) => total + bytes(issuer), 0);
    const uniqueBankBytes = originals.reduce((total, { bank }) => total + bytes(bank), 0);
    const historyRows = originals.reduce((total, { issuer }) => total + issuer.request.checkpoint.history.length, 0);
    expect(historyRows).toBe(count === 24 ? 276 : count === 12 ? 66 : 0);

    const { kernel, context } = fixture(count + 1, undefined, originals.map(({ issuer }) => issuer.sourceId));
    const expectedBank = money(String(500n - 11n * BigInt(count)));
    const expectedPrincipal = money(String(1000n - 10n * BigInt(count)));
    for (const tier of ["summary", "detail"] as const) {
      const reads = { issuer: 0, bank: 0, issuerBytes: 0, bankBytes: 0 };
      publisher.issuer = id => {
        const original = issuerById.get(id);
        if (original) { reads.issuer++; reads.issuerBytes += bytes(original); }
        return original;
      };
      publisher.bank = id => {
        const original = bankById.get(id);
        if (original) { reads.bank++; reads.bankBytes += bytes(original); }
        return original;
      };
      const result = tier === "summary" ? runHouseholdKernel({ kernel, runContext: context })
        : runHouseholdKernel({ kernel, runContext: context, resultTier: "detail" });
      expect(result.periods).toHaveLength(count + 1);
      expect(result.state.accounts[ids.bank]!.cash.equals(expectedBank)).toBe(true);
      expect(result.state.liabilities[ids.principal]!.balance.equals(expectedPrincipal)).toBe(true);
      expect(result.state.liabilities[ids.charges]!.balance.isZero()).toBe(true);
      expect(result.periods.at(-1)!.netWorth.equals(expectedBank.minus(expectedPrincipal))).toBe(true);
      expect(Object.values(result.state.d2SettlementReceipts ?? {})).toHaveLength(count);
      expect(Object.values(result.state.d2PostedTransactions ?? {})).toHaveLength(2 * count);
      // Catalog, due-period preparation, two current writers with independent
      // admissions, predecessor continuity, and the final outward release.
      expect(reads.issuer).toBeLessThanOrEqual(14 * count);
      expect(reads.bank).toBeLessThanOrEqual(14 * count);
      expect(reads.issuerBytes).toBeLessThanOrEqual(14 * uniqueIssuerBytes);
      expect(reads.bankBytes).toBeLessThanOrEqual(14 * uniqueBankBytes);
      expect(reads.issuerBytes).toBeGreaterThanOrEqual(uniqueIssuerBytes);
      expect(reads.bankBytes).toBeGreaterThanOrEqual(uniqueBankBytes);
    }
  });
});
