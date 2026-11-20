import { expect, it } from "vitest";
import { applyD2SettlementAtomically, observeAuthoritativeSourceHistory } from "../../../../../src/state/index.js";
import { money } from "../../../../../src/values/index.js";
import { admit, availability, context, fsa, registerMockAuthorities, state } from "../../sharedReceipts/scenario.js";

registerMockAuthorities();

it("observes the original again and checks nested signed money on every release", () => {
  const opening = state("1500");
  const original = fsa("receipt-observation");
  const [first, ...rest] = original.paymentTransaction.legs;
  const leg = { ...first! };
  const published = admit({ ...original, paymentTransaction: { ...original.paymentTransaction, legs: [leg, ...rest] } });
  expect(applyD2SettlementAtomically(opening, published, context).status).toBe("committed");

  const readsBefore = availability.calls;
  observeAuthoritativeSourceHistory(opening, context);
  expect(availability.calls - readsBefore).toBe(1);

  // A fresh response with reordered fields and equivalent exact money still
  // qualifies against the immutable posting and receipt.
  const { amount, ...otherFields } = leg;
  admit({ ...published, paymentTransaction: { ...published.paymentTransaction, legs: [
    { amount: money(amount.amount.toString()), ...otherFields },
    ...rest,
  ] } });
  observeAuthoritativeSourceHistory(opening, context);

  admit(published);
  leg.amount = money("1.01");
  expect(() => observeAuthoritativeSourceHistory(opening, context)).toThrow("Receipt differs from independently requalified source");
  expect(opening.d2SettlementReceipts?.[published.id]?.paymentTransaction.legs[0]!.amount).toEqual(first!.amount);
});
