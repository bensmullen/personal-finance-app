import { describe, expect, it } from "vitest";
import { reconcileAuthoritativeStates, reconcilePrimitiveRuntimeStates } from "../src/application/compiler/householdProjection.js";
import { ValidationError } from "../src/diagnostics/index.js";
import { domainId } from "../src/identity/index.js";
import { createPrimitiveRuntimeStateStore } from "../src/simulation/period.js";
import { createAuthoritativeState } from "../src/state/index.js";
import { money } from "../src/values/index.js";

const accountId = domainId("account", "90000000-0000-4000-8000-000000000001");
const account = (cash: string) => createAuthoritativeState({ accounts: { [accountId]: { id: accountId, kind: "checking", cash: money(cash) } } });

describe("household projection reconciliation", () => {
  it("unifies an economically identical shared account without summing cash", () => {
    const result = reconcileAuthoritativeStates([account("100"), account("100"), account("100")]);
    expect(Object.keys(result.accounts)).toEqual([accountId]);
    expect(result.accounts[accountId]!.cash.equals(money("100"))).toBe(true);
  });

  it("rejects conflicting duplicate authoritative entities", () => {
    expect(() => reconcileAuthoritativeStates([account("100"), account("101")])).toThrow(ValidationError);
  });

  it("set-unions identity registries deterministically", () => {
    const left = createAuthoritativeState({ identities: { postedTransactionIds: ["tx:b" as never] } });
    const right = createAuthoritativeState({ identities: { postedTransactionIds: ["tx:a" as never, "tx:b" as never] } });
    expect(reconcileAuthoritativeStates([left, right]).identities.postedTransactionIds).toEqual(["tx:a", "tx:b"]);
  });

  it("merges primitive runtime state and rejects conflicting checkpoints", () => {
    const left = createPrimitiveRuntimeStateStore({ p: { primitiveId: "P02", state: { executed: false } } });
    const same = createPrimitiveRuntimeStateStore({ p: { primitiveId: "P02", state: { executed: false } } });
    expect(Object.keys(reconcilePrimitiveRuntimeStates([left, same]))).toEqual(["p"]);
    const conflict = createPrimitiveRuntimeStateStore({ p: { primitiveId: "P02", state: { executed: true, occurrenceId: "occurrence:x" as never } } });
    expect(() => reconcilePrimitiveRuntimeStates([left, conflict])).toThrow(ValidationError);
  });
});
