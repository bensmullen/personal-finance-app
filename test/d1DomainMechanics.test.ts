import { describe, expect, it } from "vitest";
import { assertBalanced } from "../src/accounting/index.js";
import { domainId } from "../src/identity/index.js";
import { createAuthoritativeState } from "../src/state/index.js";
import { createPrimitiveRuntimeStateStore } from "../src/simulation/period.js";
import { executeDomainOperation, domainCashAccesses, longTermHolding, type DomainHolding, type DomainMechanicsInput, type DomainOperation } from "../src/simulation/domainMechanics.js";
import type { OperationState } from "../src/simulation/r3/operations.js";
import { decimal, money, quantity, SHARE, USD } from "../src/values/index.js";
import { instant } from "../src/time/index.js";

const id = (suffix: number) => `d1b10000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const bank = id(1), wrapper = id(2), person = id(3), position = id(4), destination = id(5), roth = id(6);
const facts: DomainOperation["taxFacts"] = { residenceJurisdictions: ["US:PA"], workJurisdictions: [], eligibility: {} };
const holding = (kind: DomainHolding["kind"] = "equity", acquired = "2024-01-01", basis = "600"): DomainHolding => ({ id: position, accountId: wrapper, kind, afterTaxBasis: "200", lots: [{ id: "opening", acquired, quantity: "10", basis }] });
const input = (source = holding()): DomainMechanicsInput => ({ currency: "USD", holdings: [source, { id: destination, accountId: wrapper, kind: "equity", afterTaxBasis: "0", lots: [] }, { id: roth, accountId: wrapper, kind: "equity", afterTaxBasis: "0", lots: [] }], operations: [] });
const opening = (): OperationState => ({ primitiveState: createPrimitiveRuntimeStateStore(), state: createAuthoritativeState({
  contributions: { "prior-ytd": { source: "opening", id: "prior-ytd", at: instant("2026-01-01T00:00:00.000Z"), personId: person, accountId: wrapper, character: "traditional_401k", amount: money("5000", USD), buckets: [{ identity: "402g:person:2026", amount: money("5000", USD), annualLimit: money("24500", USD), ruleIds: ["statutory-capacity"] }] } },
  accounts: {
    [bank]: { id: domainId("account", bank), kind: "checking", ownerId: domainId("person", person), cash: money("10000", USD) },
    [wrapper]: { id: domainId("account", wrapper), kind: "brokerage", ownerId: domainId("person", person), cash: money("0", USD) },
  }, positions: Object.fromEntries([position, destination, roth].map((value, index) => [value, { id: domainId("position", value), accountId: domainId("account", wrapper), quantity: quantity(index === 0 ? "10" : "0", SHARE), price: money("100", USD), carryingValue: money(index === 0 ? "1000" : "0", USD) }])) }),
});
const operation = (kind: DomainOperation["kind"], terms: Partial<DomainOperation> = {}): DomainOperation => ({ id: id(10), at: "2026-01-10T00:00:00.000Z", order: 10, kind, amount: "100", ...(["cash_interest", "insurance_premium", "death_benefit", "indirect_deposit"].includes(kind) ? {} : { holdingId: position }), taxFacts: facts, ...terms });
const netWorth = (candidate: OperationState) => Object.values(candidate.state.accounts).reduce((sum, account) => sum.plus(account.cash.amount), decimal("0"))
  .plus(Object.values(candidate.state.positions).reduce((sum, item) => sum.plus(item.carryingValue.amount), decimal("0")))
  .minus(Object.values(candidate.state.liabilities).reduce((sum, item) => sum.plus(item.balance.amount), decimal("0"))).toString();
const amounts = (candidate: ReturnType<typeof executeDomainOperation>) => ({ bank: candidate.state.accounts[bank]!.cash.amount.toString(), wrapper: candidate.state.accounts[wrapper]!.cash.amount.toString(), units: candidate.state.positions[position]!.quantity.amount.toString(), carrying: candidate.state.positions[position]!.carryingValue.amount.toString(), netWorth: netWorth(candidate) });
const taxes = (candidate: ReturnType<typeof executeDomainOperation>) => Object.fromEntries(Object.entries(candidate.facts.taxEconomics?.[0]?.income ?? {}).filter(([, value]) => !value.isZero()).map(([key, value]) => [key, value.amount.toString()]));
const statements = (candidate: ReturnType<typeof executeDomainOperation>) => Object.fromEntries(["income", "expense", "gain", "loss"].map(type => [type,
  (candidate.facts.transactions ?? []).flatMap(tx => tx.legs).filter(leg => leg.type === type).reduce((sum, leg) => sum.plus(leg.posting === (type === "expense" || type === "loss" ? "debit" : "credit") ? leg.amount.amount : leg.amount.amount.negated()), decimal("0")).toString()]));
const balanced = (candidate: ReturnType<typeof executeDomainOperation>) => { for (const tx of candidate.facts.transactions ?? []) assertBalanced(tx); };

describe("D1-B independent financial effects (opening bank 10000, wrapper 0, holding 1000)", () => {
  it.each([
    ["2024-01-01", { longTermGains: "450" }], ["2025-01-10", { shortTermGains: "450" }],
  ])("sells five units with basis 300, recognizes correct holding-period gain, and preserves wrapper cash (%s)", (acquired, tax) => {
    const before = opening(), result = executeDomainOperation(before, input(holding("equity", acquired as string)), operation("sale", { amount: "750", quantity: "5" }));
    expect(amounts(result)).toEqual({ bank: "10000", wrapper: "750", units: "5", carrying: "500", netWorth: "11250" });
    expect(taxes(result)).toEqual(tax); expect(statements(result)).toEqual({ income: "0", expense: "0", gain: "250", loss: "0" }); balanced(result);
    expect(before.state.positions[position]!.quantity.amount.toString()).toBe("10");
    expect(netWorth(before)).toBe("11000");
  });
  it.each(["ordinary_dividend", "qualified_dividend", "interest"] as const)("recognizes %s once, settles 100 in wrapper cash, and leaves checking untouched", kind => {
    const result = executeDomainOperation(opening(), input(), operation(kind));
    expect(amounts(result)).toEqual({ bank: "10000", wrapper: "100", units: "10", carrying: "1000", netWorth: "11100" });
    expect(taxes(result)).toEqual({ [kind === "interest" ? "taxableInterest" : kind === "qualified_dividend" ? "qualifiedDividends" : "ordinaryDividends"]: "100" });
    expect(statements(result)).toEqual({ income: "100", expense: "0", gain: "0", loss: "0" }); balanced(result);
  });
  it.each(["ordinary", "qualified"] as const)("reinvests a %s dividend as linked income and purchase with no bank funding", dividendCharacter => {
    const result = executeDomainOperation(opening(), input(), operation("reinvest_dividend", { quantity: "1", dividendCharacter }));
    expect(amounts(result)).toEqual({ bank: "10000", wrapper: "0", units: "11", carrying: "1100", netWorth: "11100" });
    expect(taxes(result)).toEqual({ [dividendCharacter === "ordinary" ? "ordinaryDividends" : "qualifiedDividends"]: "100" });
    expect(result.facts.transactions).toHaveLength(2); expect(statements(result).income).toBe("100"); balanced(result);
  });
  it.each(["conversion", "direct_rollover", "mixed_rollover"] as const)("moves 500 of retirement value with pro-rata basis 100 (%s), without changing contribution state or bank cash", kind => {
    const before = opening(), result = executeDomainOperation(before, input(), operation(kind, { amount: "500", destinationHoldingId: destination, rothHoldingId: roth }));
    expect(amounts(result)).toEqual({ bank: "10000", wrapper: "0", units: "5", carrying: "500", netWorth: "11000" });
    expect(result.state.positions[destination]!.carryingValue.amount.toString()).toBe(kind === "mixed_rollover" ? "400" : "500");
    expect(result.state.positions[roth]!.carryingValue.amount.toString()).toBe(kind === "mixed_rollover" ? "100" : "0");
    expect(taxes(result)).toEqual(kind === "conversion" ? { traditionalDistributions: "400" } : {});
    expect(result.state.contributions).toEqual(before.state.contributions); expect(statements(result)).toEqual({ income: "0", expense: "0", gain: "0", loss: "0" }); balanced(result);
  });
  it("preserves 20% withholding as a credit and redeposits gross principal using explicit replacement cash", () => {
    const configuration = input({ ...holding(), afterTaxBasis: "0" }), before = opening();
    const receipt = executeDomainOperation(before, configuration, operation("indirect_distribution", { amount: "1000", cashAccountId: bank }));
    expect(receipt.state.accounts[bank]!.cash.amount.toString()).toBe("10800");
    expect(receipt.state.positions[position]!.carryingValue.amount.toString()).toBe("0");
    expect(Object.values(receipt.state.positions).filter(item => item.carryingValue.amount.toString() === "200")).toHaveLength(1);
    expect(netWorth(receipt)).toBe("11000"); expect(taxes(receipt)).toEqual({ traditionalDistributions: "1000" }); balanced(receipt);
    const deposit = executeDomainOperation(receipt, configuration, operation("indirect_deposit", { id: id(11), at: "2026-03-01T00:00:00.000Z", amount: "1000", linkedOperationId: id(10), cashAccountId: bank, sourceAccountId: bank, replacementAmount: "200", destinationHoldingId: destination }));
    expect(deposit.state.accounts[bank]!.cash.amount.toString()).toBe("9800");
    expect(deposit.state.positions[destination]!.carryingValue.amount.toString()).toBe("1000");
    expect(netWorth(deposit)).toBe("11000"); expect(taxes(deposit)).toEqual({ traditionalDistributions: "-1000" });
    expect(deposit.facts.resolvedTaxDiagnosticSourceIds).toEqual([id(10)]); balanced(deposit);
    expect(deposit.state.contributions).toEqual(before.state.contributions);
  });
  it("keeps unreplaced indirect principal taxable and marks additional-tax coverage incomplete", () => {
    const configuration = input({ ...holding(), afterTaxBasis: "0" });
    const receipt = executeDomainOperation(opening(), configuration, operation("indirect_distribution", { amount: "1000", cashAccountId: bank }));
    const deposit = executeDomainOperation(receipt, configuration, operation("indirect_deposit", { id: id(11), amount: "800", linkedOperationId: id(10), destinationHoldingId: destination }));
    expect(deposit.state.accounts[bank]!.cash.amount.toString()).toBe("10000"); expect(netWorth(deposit)).toBe("11000");
    expect(taxes(deposit)).toEqual({ traditionalDistributions: "-800" }); expect(deposit.facts.taxDiagnostics?.[0]?.category).toBe("early_distribution_additional_tax"); balanced(deposit);
  });
  it("does not move late rollover cash or erase the original distribution", () => {
    const configuration = input({ ...holding(), afterTaxBasis: "0" });
    const receipt = executeDomainOperation(opening(), configuration, operation("indirect_distribution", { amount: "1000", cashAccountId: bank }));
    const result = executeDomainOperation(receipt, configuration, operation("indirect_deposit", { id: id(11), at: "2026-03-12T00:00:00.000Z", amount: "1000", linkedOperationId: id(10), destinationHoldingId: destination, sourceAccountId: bank, replacementAmount: "200" }));
    expect(amounts(result)).toEqual(amounts(receipt)); expect(result.facts.transactions).toHaveLength(0); expect(result.facts.taxDiagnostics?.[0]?.category).toBe("rollover_deadline");
    expect(result.facts.resolvedTaxDiagnosticSourceIds).toEqual([id(10)]);
  });
  it("credits monthly APY interest without floating-point money", () => {
    const result = executeDomainOperation(opening(), input(), operation("cash_interest", { cashAccountId: bank, amount: "0", annualEffectiveRate: "0.126825030131969720661201" }));
    expect(amounts(result)).toEqual({ bank: "10100", wrapper: "0", units: "10", carrying: "1000", netWorth: "11100" });
    expect(taxes(result)).toEqual({ taxableInterest: "100" }); expect(statements(result).income).toBe("100"); balanced(result);
  });
  it("repays a bill's 980 principal and recognizes only 20 Treasury interest at 1000 maturity", () => {
    const before = opening(); before.state.positions[position] = { ...before.state.positions[position]!, quantity: quantity("1", SHARE), price: money("980", USD), carryingValue: money("980", USD) };
    const result = executeDomainOperation(before, input({ ...holding("treasury_bill"), lots: [{ id: "bill", acquired: "2026-01-01", quantity: "1", basis: "980" }] }), operation("maturity", { amount: "1000", cashAccountId: bank }));
    expect(netWorth(before)).toBe("10980"); expect(amounts(result)).toEqual({ bank: "11000", wrapper: "0", units: "0", carrying: "0", netWorth: "11000" });
    expect(taxes(result)).toEqual({ taxableInterest: "20" }); expect(result.facts.taxEconomics?.[0]?.exemptStateLocalInterest?.amount.toString()).toBe("20"); expect(statements(result).income).toBe("20"); balanced(result);
  });
  it.each(["treasury_note", "treasury_bond", "cd"] as const)("recognizes a 50 coupon/credit and returns 1000 principal with no second income (%s)", kind => {
    const configuration = input(holding(kind)), coupon = executeDomainOperation(opening(), configuration, operation(kind === "cd" ? "interest" : "treasury_interest", { amount: "50" }));
    const result = executeDomainOperation(coupon, configuration, operation("maturity", { id: id(11), amount: "1000", cashAccountId: bank }));
    expect(amounts(result)).toEqual({ bank: "11000", wrapper: "50", units: "0", carrying: "0", netWorth: "11050" });
    expect(taxes(coupon)).toEqual({ taxableInterest: "50" }); expect(taxes(result)).toEqual({});
    expect(coupon.facts.taxEconomics?.[0]?.exemptStateLocalInterest?.amount.toString()).toBe(kind === "cd" ? undefined : "50");
    expect(statements(result).income).toBe("0"); balanced(coupon); balanced(result);
  });
  it("buys and sells spot crypto with wallet-local lot basis and short-term gain", () => {
    const configuration = input(holding("crypto", "2025-12-01", "1000")), before = opening();
    const bought = executeDomainOperation(before, configuration, operation("purchase", { amount: "200", quantity: "2", cashAccountId: bank }));
    expect(amounts(bought)).toEqual({ bank: "9800", wrapper: "0", units: "12", carrying: "1200", netWorth: "11000" }); expect(taxes(bought)).toEqual({});
    const sold = executeDomainOperation(bought, configuration, operation("sale", { id: id(11), amount: "300", quantity: "2" }));
    expect(amounts(sold)).toEqual({ bank: "9800", wrapper: "300", units: "10", carrying: "1000", netWorth: "11100" });
    expect(taxes(sold)).toEqual({ shortTermGains: "100" }); balanced(bought); balanced(sold);
  });
  it.each(["sale", "call_expiration"] as const)("closes long calls with a capitalized premium and capital gain/loss (%s)", kind => {
    const configuration = input({ ...holding("long_equity_call", "2025-12-01", "1000"), expiration: "2026-01-10", strike: "10", multiplier: "100", underlyingId: destination });
    const result = executeDomainOperation(opening(), configuration, operation(kind, { amount: kind === "sale" ? "1200" : "0", quantity: "10" }));
    expect(amounts(result)).toEqual({ bank: "10000", wrapper: kind === "sale" ? "1200" : "0", units: "0", carrying: "0", netWorth: kind === "sale" ? "11200" : "10000" });
    expect(taxes(result)).toEqual({ shortTermGains: kind === "sale" ? "200" : "-1000" }); balanced(result);
  });
  it("exercises one call: 100 shares have 1100 basis, premium is carried into stock, no call gain recognized", () => {
    const configuration = input({ ...holding("long_equity_call", "2025-12-01", "1000"), expiration: "2026-02-01", strike: "10", multiplier: "100", underlyingId: destination });
    const result = executeDomainOperation(opening(), configuration, operation("call_exercise", { amount: "1000", quantity: "1", cashAccountId: bank }));
    expect(amounts(result)).toEqual({ bank: "9000", wrapper: "0", units: "9", carrying: "900", netWorth: "11000" });
    expect(result.state.positions[destination]!.quantity.amount.toString()).toBe("100"); expect(result.state.positions[destination]!.carryingValue.amount.toString()).toBe("1100");
    expect(taxes(result)).toEqual({}); expect(statements(result)).toEqual({ income: "0", expense: "0", gain: "0", loss: "0" }); balanced(result);
  });
  it("pays a 50 insurance expense and receives one excluded 100000 death benefit, without earned income", () => {
    const paid = executeDomainOperation(opening(), input(), operation("insurance_premium", { amount: "50", cashAccountId: bank }));
    expect(paid.state.accounts[bank]!.cash.amount.toString()).toBe("9950"); expect(statements(paid).expense).toBe("50"); expect(taxes(paid)).toEqual({});
    const terms = operation("death_benefit", { id: id(11), amount: "100000", cashAccountId: bank });
    const result = executeDomainOperation(paid, input(), terms);
    expect(amounts(result)).toEqual({ bank: "109950", wrapper: "0", units: "10", carrying: "1000", netWorth: "110950" }); expect(taxes(result)).toEqual({}); expect(statements(result).income).toBe("100000");
    expect(result.facts.taxEconomics?.[0]?.excludedFederalTermLifeBenefit?.amount.toString()).toBe("100000");
    expect(result.facts.taxDiagnostics?.[0]?.category).toBe("term_life_state_exclusion");
    const replay = executeDomainOperation(result, input(), terms); expect(netWorth(replay)).toBe("110950"); expect(replay.facts.transactions).toBeUndefined(); balanced(paid); balanced(result);
  });
  it.each(["crypto", "long_equity_call", "treasury_bill", "cd"] as const)("rejects wrapper-funded %s purchases atomically", kind => {
    const before = opening();
    expect(() => executeDomainOperation(before, input(holding(kind)), operation("purchase", { cashAccountId: wrapper, quantity: "1" }))).toThrow();
    expect(netWorth(before)).toBe("11000"); expect(before.state.identities.postedTransactionIds).toHaveLength(0);
  });
  it("rejects unavailable/contingent units, invalid lot selection and an inferred household sale destination", () => {
    const before = opening();
    for (const terms of [{ quantity: "11" }, { quantity: "1", lotIds: ["another-wallet"] }, { quantity: "1", cashAccountId: bank }]) expect(() => executeDomainOperation(before, input(), operation("sale", terms))).toThrow();
    expect(netWorth(before)).toBe("11000"); expect(before.state.identities.postedTransactionIds).toHaveLength(0);
  });
  it("cannot roll over contingent employer value excluded from the owned source", () => {
    const before = opening();
    before.state.positions[position] = { ...before.state.positions[position]!, quantity: quantity("5", SHARE), carryingValue: money("500", USD) };
    before.state.contingentPositions = { [position]: { positionId: domainId("position", position), quantity: quantity("5", SHARE), carryingValue: money("500", USD) } };
    for (const kind of ["conversion", "direct_rollover"] as const) expect(() => executeDomainOperation(before, input(), operation(kind, { amount: "600", destinationHoldingId: destination }))).toThrow("owned and vested");
    expect(before.state.positions[position]!.carryingValue.amount.toString()).toBe("500"); expect(before.state.contingentPositions[position]!.carryingValue.amount.toString()).toBe("500"); expect(netWorth(before)).toBe("10500");
    expect(before.state.contributions!["prior-ytd"]!.amount.amount.toString()).toBe("5000");
  });
  it("identifies holding period across calendar years and leap years", () => {
    expect(longTermHolding("2025-01-10", "2026-01-10")).toBe(false);
    expect(longTermHolding("2025-01-10", "2026-01-11")).toBe(true);
    expect(longTermHolding("2024-02-29", "2025-03-01")).toBe(true);
  });
  it.each([["200", "500", "7.5", "1500", "450"], ["50", "500", "0", "0", "300"]] as const)("moves fair value at price %s while preserving book balances and owned net worth", (price, amount, remaining, ownedValue, taxable) => {
    const before = opening(); before.state.positions[position] = { ...before.state.positions[position]!, price: money(price, USD) };
    const result = executeDomainOperation(before, input(), operation("conversion", { amount, destinationHoldingId: destination }));
    expect(result.state.positions[position]!.quantity.amount.toString()).toBe(remaining);
    expect(result.state.positions[position]!.price.times(result.state.positions[position]!.quantity.amount).amount.toString()).toBe(ownedValue);
    expect(result.state.positions[destination]!.price.times(result.state.positions[destination]!.quantity.amount).amount.toString()).toBe(amount);
    expect(netWorth(result)).toBe(netWorth(before)); expect(taxes(result)).toEqual({ traditionalDistributions: taxable });
    expect(statements(result)).toEqual({ income: "0", expense: "0", gain: "0", loss: "0" });
    expect(result.state.contributions).toEqual(before.state.contributions); balanced(result);
  });
  it.each([["after_tax_401k", undefined, "200"], ["roth_401k", undefined, "200"], ["traditional_401k", undefined, "0"], ["traditional_ira", "50", "150"], ["traditional_ira", "200", "0"]] as const)("updates previously taxed basis from committed %s facts once", (character, deduction, expectedBasis) => {
    const before = opening();
    before.state.contributions = { ...before.state.contributions, current: { id: "current", at: instant("2026-01-05T00:00:00.000Z"), personId: person, accountId: wrapper, character, amount: money("200", USD), buckets: [], ...(deduction === undefined ? {} : { eligibleDeduction: money(deduction, USD) }) } };
    // Owned current position includes the earlier funded contribution; opening basis is zero.
    const configuration = input({ ...holding(), afterTaxBasis: "0" });
    const result = executeDomainOperation(before, configuration, operation("conversion", { amount: "1000", destinationHoldingId: destination }));
    expect(taxes(result)).toEqual({ traditionalDistributions: money("1000", USD).minus(money(expectedBasis, USD)).amount.toString() });
    expect(result.state.contributions).toEqual(before.state.contributions);
    const replay = executeDomainOperation(result, configuration, operation("conversion", { amount: "1000", destinationHoldingId: destination }));
    expect(replay.runtime).toEqual(result.runtime); balanced(result);
  });
  it("permits a partial transfer within owned value despite contingent employer units", () => {
    const before = opening();
    before.state.contingentPositions = { [position]: { positionId: domainId("position", position), quantity: quantity("5", SHARE), carryingValue: money("500", USD) } };
    const result = executeDomainOperation(before, input(), operation("direct_rollover", { amount: "500", destinationHoldingId: destination }));
    expect(result.state.positions[position]!.quantity.amount.toString()).toBe("5");
    expect(result.state.contingentPositions).toEqual(before.state.contingentPositions); expect(netWorth(result)).toBe("11000");
    expect(taxes(result)).toEqual({}); balanced(result);
  });
  it("declares proceeds as production and real funding/balance reads as consumption", () => {
    expect(domainCashAccesses(input(), operation("ordinary_dividend"))).toEqual([{ kind: "account_cash", accountId: wrapper, mode: "produce" }]);
    expect(domainCashAccesses(input(), operation("purchase", { cashAccountId: bank }))).toEqual([{ kind: "account_cash", accountId: bank, mode: "consume" }]);
    expect(domainCashAccesses(input(), operation("cash_interest", { cashAccountId: bank }))).toEqual([{ kind: "account_cash", accountId: bank, mode: "consume" }]);
    expect(domainCashAccesses(input(), operation("conversion", { destinationHoldingId: destination }))).toEqual([]);
  });
  it("keeps missing IRA deduction facts scoped to retirement movement rather than unrelated bank interest", () => {
    const before = opening();
    before.state.contributions = { ira: { id: "ira", at: instant("2026-01-05T00:00:00.000Z"), personId: person, accountId: wrapper, character: "traditional_ira", amount: money("200", USD), buckets: [] } };
    const interest = executeDomainOperation(before, input(), operation("cash_interest", { cashAccountId: bank, amount: "0", annualEffectiveRate: "0.126825030131969720661201" }));
    expect(interest.state.accounts[bank]!.cash.amount.toString()).toBe("10100");
    expect(() => executeDomainOperation(before, input(), operation("direct_rollover", { amount: "1000", destinationHoldingId: destination }))).toThrow("Authoritative IRA deduction facts");
    expect(before.state.positions[position]!.quantity.amount.toString()).toBe("10");
  });
});
