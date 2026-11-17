import { describe, expect, it } from "vitest";
import { checkHouseholdBankDebitAdmission, qualifyHouseholdBankRoute, registerHouseholdBankOriginalProvider,
  type HouseholdBankOriginalInventory } from "../../../../src/simulation/d2/integration/householdBank/index.js";
import { instant } from "../../../../src/time/index.js";
import { context, ids, originalFacts } from "../householdBankAuthority/scenario.js";

const debit = { ...context(0, ids.alice, "debit"), direction: "debit" as const };
const identity = (inventory: HouseholdBankOriginalInventory) => inventory;
let transform: (inventory: HouseholdBankOriginalInventory) => HouseholdBankOriginalInventory | undefined = identity;
let reads = 0;
const publisherId = "fixed-loan-bank-admission-fixture";
registerHouseholdBankOriginalProvider({ publisherId, readOriginals(query) {
  reads++;
  return transform({ version: "household-bank-original-inventory/v1", publisherId, query,
    checkedAt: debit.asOf, completeThrough: debit.dataCutoff, completeness: "complete", originals: originalFacts(query) });
} });

const check = () => checkHouseholdBankDebitAdmission(publisherId, "bank-member-route", debit);
const withoutPermission = (inventory: HouseholdBankOriginalInventory) => ({ ...inventory,
  originals: inventory.originals.filter(original => original.kind !== "permission") });

describe("checked S1 debit admission", () => {
  it("uses one original read and preserves the strict positive pin", () => {
    transform = identity;
    const before = reads;
    const result = check();
    expect(reads - before).toBe(1);
    expect(result).toMatchObject({ kind: "qualified", pin: qualifyHouseholdBankRoute(publisherId, "bank-member-route", debit) });
  });

  it("recognizes a valid credit-only route while the strict API rejects it", () => {
    transform = inventory => ({ ...inventory, originals: inventory.originals.map(original =>
      original.kind === "permission" ? { ...original, direction: "credit" } : original) });
    const before = reads;
    expect(check().kind).toBe("debit_permission_denied");
    expect(reads - before).toBe(1);
    expect(() => qualifyHouseholdBankRoute(publisherId, "bank-member-route", debit)).toThrow("HOUSEHOLD_BANK_ORIGINAL_NOT_ADMITTED");
  });

  it("requires an exact-query completeness attestation for authoritative permission absence", () => {
    transform = withoutPermission;
    expect(check).toThrow("HOUSEHOLD_BANK_ORIGINAL_NOT_ADMITTED");
    transform = inventory => ({ ...withoutPermission(inventory), permissionInventory: "complete_for_exact_query" });
    expect(check().kind).toBe("debit_permission_denied");
    expect(() => qualifyHouseholdBankRoute(publisherId, "bank-member-route", debit)).toThrow("HOUSEHOLD_BANK_ORIGINAL_NOT_ADMITTED");
  });

  const invalidInventories: readonly [string, typeof transform][] = [
    ["unavailable publisher response", () => undefined],
    ["incomplete observation", inventory => ({ ...inventory, completeThrough: instant("2026-05-31T00:00:00.000Z") })],
    ["wrong query", inventory => ({ ...inventory, query: { ...inventory.query, sourceId: "wrong-source" } })],
    ["wrong member", inventory => ({ ...inventory, originals: inventory.originals.map(original =>
      original.kind === "permission" ? { ...original, direction: "credit", personId: ids.bob } : original) })],
    ["wrong BANK", inventory => ({ ...inventory, originals: inventory.originals.map(original =>
      original.kind === "permission" ? { ...original, direction: "credit", bankAccountId: "unrelated-bank" } : original) })],
    ["unsupported BANK kind", inventory => ({ ...inventory, originals: inventory.originals.map(original =>
      original.kind === "account" ? { ...original, accountKind: "other" } : original) })],
    ["person owner", inventory => ({ ...inventory, originals: inventory.originals.map(original =>
      original.kind === "account" ? { ...original, owner: { kind: "person", id: ids.alice } } : original) })],
    ["revoked permission", inventory => ({ ...inventory, originals: inventory.originals.map(original =>
      original.kind === "permission" ? { ...original, direction: "credit", status: "revoked" } : original) })],
    ["ambiguous revision", inventory => ({ ...inventory, originals: [...inventory.originals,
      { ...inventory.originals[3]!, revisionId: "conflicting" }] })],
    ["late-known original", inventory => ({ ...inventory, originals: inventory.originals.map(original =>
      original.kind === "permission" ? { ...original, direction: "credit", knownAt: instant("2026-06-02T00:00:00.000Z") } : original) })],
  ];

  it.each(invalidInventories)("rejects %s before policy with one read", (_label, invalid) => {
    transform = invalid;
    const before = reads;
    expect(check).toThrow("HOUSEHOLD_BANK_ORIGINAL_NOT_ADMITTED");
    expect(reads - before).toBe(1);
  });

  it("does not reuse a successful read after the publisher withdraws permission", () => {
    transform = identity;
    expect(check().kind).toBe("qualified");
    transform = inventory => ({ ...inventory, originals: inventory.originals.map(original =>
      original.kind === "permission" ? { ...original, status: "revoked" } : original) });
    const before = reads;
    expect(check).toThrow("HOUSEHOLD_BANK_ORIGINAL_NOT_ADMITTED");
    expect(reads - before).toBe(1);
  });
});
