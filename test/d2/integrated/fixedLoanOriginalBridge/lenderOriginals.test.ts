import { describe, expect, it } from "vitest";
import { domainId } from "../../../../src/identity/index.js";
import {
  qualifyFixedLoanOriginal, registerFixedLoanOriginalProvider,
  type FixedLoanContractOriginal, type FixedLoanOriginalInventory, type FixedLoanOriginalQuery,
} from "../../../../src/simulation/d2/integration/fixedLoanOriginalBridge/source.js";
import { runId, scenarioId } from "../../../../src/simulation/run.js";
import { instant } from "../../../../src/time/index.js";
import { money, Rate, rateConvention } from "../../../../src/values/index.js";

const asOf = instant("2026-01-10T00:00:00.000Z");
const due = instant("2026-01-15T00:00:00.000Z");
const publishedAt = instant("2025-12-01T00:00:00.000Z");
const effectiveUntil = instant("2027-01-01T00:00:00.000Z");
const fixtureId = (suffix: number) => `9f739593-ee76-4823-ae43-${String(suffix).padStart(12, "0")}`;

const query: FixedLoanOriginalQuery = {
  reference: { version: "fixed-loan-original-reference/v1", publisherId: "fixed-loan-lender-fixture",
    lenderId: "synthetic-lender", lenderAccountId: "synthetic-loan-account", contractSourceId: "contract.original" },
  runId: runId(fixtureId(1)), scenarioId: scenarioId(fixtureId(2)), asOf, dataCutoff: asOf, eventAt: due,
};
const contract: FixedLoanContractOriginal = {
  reference: query.reference, householdId: domainId("household", fixtureId(3)), borrowerId: domainId("person", fixtureId(4)),
  loanId: domainId("loan-contract", fixtureId(5)), legalOwnerId: domainId("person", fixtureId(4)),
  principalLiabilityId: domainId("liability", fixtureId(6)), interestPayableLiabilityId: domainId("liability", fixtureId(7)),
  debtFamily: "auto", originalPrincipal: money("100"), annualRate: Rate.fromDecimal("0.12", rateConvention.nominalAnnual(12)),
  totalPayments: 1, paymentSchedule: { kind: "utc_monthly", anchor: due, invalidDayPolicy: "skip" },
};
const revision = { effectiveFrom: publishedAt, effectiveUntil, publishedAt, knownAt: publishedAt, status: "active" } as const;
const payment = { sourceId: "installment.original", contractSourceId: "contract.original", eventAt: due, taxYear: 2026,
  contractualPayment: money("101"), currentInterest: money("1"), interestDue: money("1"), principalDue: money("100"),
  bank: { publisherId: "synthetic-bank-publisher", sourceId: "bank-member-permission", accountId: fixtureId(8) } };
const baseline: FixedLoanOriginalInventory = { version: "fixed-loan-original-inventory/v1", query,
  checkedAt: asOf, completeThrough: asOf, completeness: "complete",
  contractHistory: [{ ...revision, revisionId: "contract-1", original: contract }],
  paymentHistory: [{ ...revision, revisionId: "payment-1", original: payment }],
};

let response: FixedLoanOriginalInventory | undefined;
registerFixedLoanOriginalProvider({ publisherId: query.reference.publisherId, readOriginals: () => response });

describe("fixed loan lender original inventory", () => {
  it("pins complete revisions in publication order and detects a publisher amendment on re-read", () => {
    response = baseline;
    const first = qualifyFixedLoanOriginal(query);
    const amendment = { ...baseline.paymentHistory[0]!, status: "active" as const, original: payment,
      revisionId: "payment-2", publishedAt: asOf, knownAt: asOf };
    response = { ...baseline, paymentHistory: [...baseline.paymentHistory, amendment] };
    const second = qualifyFixedLoanOriginal(query);
    expect(second.payment.revisionId).toBe("payment-2");
    expect(second.digest).not.toBe(first.digest);
    response = { ...response, paymentHistory: [...response.paymentHistory].reverse() };
    expect(qualifyFixedLoanOriginal(query).digest).toBe(second.digest);
  });

  it("fails closed if the publisher disappears, withdraws payment or publishes an applicable late revision", () => {
    response = undefined;
    expect(() => qualifyFixedLoanOriginal(query)).toThrow("Lender originals unavailable");
    const withdrawn = { ...revision, revisionId: "payment-2", status: "withdrawn" as const, publishedAt: asOf, knownAt: asOf };
    response = { ...baseline, paymentHistory: [...baseline.paymentHistory, withdrawn] };
    expect(() => qualifyFixedLoanOriginal(query)).toThrow("Missing, expired or withdrawn original");
    response = { ...baseline, paymentHistory: [...baseline.paymentHistory, { ...withdrawn, knownAt: due }] };
    expect(() => qualifyFixedLoanOriginal(query)).toThrow("Applicable original revision was late-known");
  });

  it("rejects an unscoped inventory or ambiguous publications", () => {
    response = { ...baseline, query: { ...query, runId: runId(fixtureId(9)) } };
    expect(() => qualifyFixedLoanOriginal(query)).toThrow("Lender originals do not cover the exact run observation");
    response = { ...baseline, paymentHistory: [...baseline.paymentHistory, { ...baseline.paymentHistory[0]!, revisionId: "duplicate-publication" }] };
    expect(() => qualifyFixedLoanOriginal(query)).toThrow("Invalid or ambiguous original revision history");
  });
});
