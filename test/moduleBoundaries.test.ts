import { describe, expect, it } from "vitest";
import * as legacyFunding from "../src/funding.js";
import * as legacyKernel from "../src/kernel.js";
import * as legacyRun from "../src/run.js";
import * as legacySemantics from "../src/semantics.js";
import * as legacyState from "../src/state.js";
import * as legacyVerticalSlice from "../src/verticalSlice1.js";
import { type AccountingTransaction } from "../src/accounting/index.js";
import { DependencyGraph } from "../src/dependencies/index.js";
import * as funding from "../src/funding/index.js";
import * as fundingPolicy from "../src/funding/policy.js";
import * as fundingResolution from "../src/funding/resolution.js";
import * as semanticProposal from "../src/semantics/settlementProposal.js";
import * as settlement from "../src/semantics/settlement.js";
import { fixedMortgagePayment } from "../src/rules/index.js";
import * as run from "../src/simulation/run.js";
import * as state from "../src/state/index.js";
import { deriveStatements, deriveVerticalSliceStatements } from "../src/statements/index.js";
import { positionMarketValue } from "../src/valuation/index.js";
import { domainId } from "../src/identity/index.js";
import { quantity, SHARE, money, USD } from "../src/values/index.js";

describe("engine module boundaries", () => {
  it("keeps compatibility paths on the canonical runtime authorities", () => {
    expect(legacySemantics.createSettlementProposal).toBe(semanticProposal.createSettlementProposal);
    expect(legacySemantics.createSettlement).toBe(settlement.createSettlement);
    expect(legacyFunding.createFundingPolicy).toBe(fundingPolicy.createFundingPolicy);
    expect(legacyFunding.resolveFunding).toBe(fundingResolution.resolveFunding);
    expect(funding.resolveFunding).toBe(fundingResolution.resolveFunding);
    expect(legacyState.createAuthoritativeState).toBe(state.createAuthoritativeState);
    expect(legacyRun.createRunContext).toBe(run.createRunContext);
  });

  it("keeps kernel and slice facades on extracted implementations", async () => {
    const kernel = await import("../src/simulation/kernel.js");
    const slice = await import("../src/simulation/verticalSlice1.js");
    expect(legacyKernel.DependencyGraph).toBe(DependencyGraph);
    expect(legacyKernel.SemanticRunner).toBe(kernel.SemanticRunner);
    expect(legacyKernel.fixedMortgagePayment).toBe(fixedMortgagePayment);
    expect(legacyVerticalSlice.runVerticalSlicePeriod).toBe(slice.runVerticalSlicePeriod);
    expect(legacyVerticalSlice.calculateTax).toBe(slice.calculateTax);
  });

  it("preserves deterministic zero-lag ordering and ignores lagged edges", () => {
    const graph = new DependencyGraph();
    graph.addEdge("b", "c");
    graph.addEdge("a", "c");
    graph.addEdge("c", "a", 1);
    expect(graph.topologicalOrder()).toEqual(["a", "b", "c"]);
  });

  it("still rejects zero-lag cycles", () => {
    const graph = new DependencyGraph();
    graph.addEdge("a", "b");
    graph.addEdge("b", "a");
    expect(() => graph.topologicalOrder()).toThrow("Invalid zero-lag dependency cycle");
  });

  it("shares static position valuation across both statement contracts", () => {
    const accountId = domainId("account", "10000000-0000-4000-8000-000000000001");
    const positionId = domainId("position", "10000000-0000-4000-8000-000000000002");
    const position = {
      id: positionId,
      accountId,
      quantity: quantity("2", SHARE),
      price: money("125.00", USD),
      carryingValue: money("200.00", USD),
    };
    const authoritative = state.createAuthoritativeState({
      accounts: { [accountId]: { id: accountId, kind: "brokerage", cash: money("50.00", USD) } },
      positions: { [positionId]: position },
    });
    const transactions: readonly AccountingTransaction[] = [];
    expect(positionMarketValue(position).amount.toString()).toBe("250");
    expect(deriveStatements(authoritative, transactions, USD).assets.amount.toString()).toBe("300");
    expect(deriveVerticalSliceStatements(authoritative, transactions, USD).assets.amount.toString()).toBe("300");
  });
});
