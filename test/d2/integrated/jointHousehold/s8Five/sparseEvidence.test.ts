import { expect, it } from "vitest";
import { accountingTransactionId } from "../../../../../src/accounting/index.js";
import { idempotencyKey } from "../../../../../src/identity/index.js";
import { runHouseholdKernel } from "../../../../../src/simulation/householdExecution.js";
import { createPortableHouseholdReplayArtifact, restorePortableHouseholdReplayArtifact } from "../../../../../src/simulation/r3/replayArtifact.js";
import { canonicalSerialize, createInputFingerprint } from "../../../../../src/simulation/run.js";
import { ids } from "./bank.js";
import { household, installPublishers } from "./scenario.js";

installPublishers();

it("rejects an omitted terminal SSA original and proof with the same committed BANK cash", () => {
  const { kernel, runContext: context, ssa } = household(12);
  const summary = runHouseholdKernel({ kernel, runContext: context });
  expect(summary.periods, JSON.stringify(summary.diagnostics)).toHaveLength(14);
  const artifact = createPortableHouseholdReplayArtifact(summary);
  type Value = null | boolean | number | string | { kind: string; value: unknown };
  const definitions = new Map<number, Value>();
  const wire = JSON.parse(artifact.encoded, (_key, node: unknown): unknown => {
    if (node === null || typeof node !== "object") return node;
    if ("d" in node) {
      const [id, definition] = node.d as [number, Value];
      definitions.set(id, definition);
      return definition;
    }
    if ("r" in node) return definitions.get(node.r as number);
    if ("t" in node) {
      const [kind, value] = node.t as [string, unknown];
      return { kind, value };
    }
    return node;
  }) as Value;
  const rows = (record: Value): [string, Value][] => {
    if (record === null || typeof record !== "object" || record.kind !== "record")
      throw new Error("Expected an encoded replay record");
    return record.value as [string, Value][];
  };
  const field = (record: Value, name: string) => rows(record).find(([key]) => key === name)![1];
  const terminalDelta = field(wire, "terminalDelta");
  const terminal = field(terminalDelta, "records");
  const identities = field(terminalDelta, "identities");
  const cash = canonicalSerialize(field(terminal, "accounts"));
  const restore = () => {
    const encoded = JSON.stringify(wire);
    return restorePortableHouseholdReplayArtifact({ ...artifact, encoded,
      integrity: createInputFingerprint({ runContext: context, openingState: encoded }) });
  };
  expect(restore().periods).toEqual(summary.periods);
  const borrower = field(field(field(terminal, "accounts"), "set"), ids.personBank);
  const owner = rows(borrower).find(([key]) => key === "ownerId")!;
  expect(owner[1]).toBe(ids.bob);
  owner[1] = ids.household;
  expect(() => restore()).toThrow("HOUSEHOLD_REPLAY_BASIS_MISMATCH");
  owner[1] = ids.bob;
  expect(canonicalSerialize(field(terminal, "accounts"))).toBe(cash);
  const remove = (name: string, id: string) => {
    const ledger = field(field(terminal, name), "set");
    if (ledger === null || typeof ledger !== "object") throw new Error("Missing encoded terminal ledger");
    const entries = rows(ledger);
    expect(entries.some(([key]) => key === id)).toBe(true);
    ledger.value = entries.filter(([key]) => key !== id);
  };
  const eventId = accountingTransactionId(ssa.at(-1)!.eventId);
  const receipt = Object.values(summary.state.ssaMedicarePayments!).find(row => row.transaction.id === eventId)!;
  const proof = summary.state.d2PostedTransactions![eventId]!;
  expect(proof.registration).toMatchObject({ kind: "ssa_medicare_payment", paymentKey: receipt.id, operationId: eventId });
  expect(proof.transaction.id).toBe(receipt.transaction.id);
  const added = (kind: string) => {
    const list = field(field(identities, kind), "add");
    if (list === null || typeof list !== "object" || list.kind !== "array")
      throw new Error("Expected encoded terminal identities");
    return list as { kind: "array"; value: string[] };
  };
  const commitmentNamespace = "d2-shared:posted-proof";
  const commitmentPrefix = idempotencyKey(commitmentNamespace, "sentinel").slice(0, -"8:sentinel".length);
  const commitments = added("externalIdempotencyKeys").value.filter(key => {
    if (!key.startsWith(commitmentPrefix)) return false;
    const binding = key.slice(key.indexOf(":", commitmentPrefix.length) + 1);
    if (!binding.startsWith("{") || idempotencyKey(commitmentNamespace, binding) !== key) return false;
    const value = JSON.parse(binding) as { transactionId?: string; writer?: string; registration?: { paymentKey?: string } };
    return value.transactionId === proof.transaction.id && value.writer === proof.writer &&
      value.registration?.paymentKey === receipt.id;
  });
  expect(commitments).toHaveLength(1);
  remove("ssaMedicarePayments", receipt.id);
  remove("d2PostedTransactions", eventId);
  expect(canonicalSerialize(field(terminal, "accounts"))).toBe(cash);
  expect(restore).toThrow(expect.objectContaining({
    message: "HOUSEHOLD_REPLAY_BASIS_MISMATCH: portable checkpoint evidence is invalid or unavailable",
    cause: expect.objectContaining({ message: "Posting commitment exists without its archive",
      issues: [expect.objectContaining({ code: "D2_SETTLEMENT_RECEIPT_INVALID" })] }),
  }));

  const removeIds = (kind: string, keys: readonly string[]) => {
    const list = added(kind);
    for (const key of keys) expect(list.value).toContain(key);
    list.value = list.value.filter(key => !keys.includes(key));
  };
  const claims = [receipt.right, ...receipt.requests.map(request => request.claim)];
  for (const claim of claims) remove("obligations", claim.id);
  removeIds("postedTransactionIds", [eventId]);
  removeIds("recognitionIds", claims.map(claim => claim.originatingRecognitionId));
  removeIds("settlementIds", [receipt.rightSettlementId, ...receipt.requests.map(request => request.draft.id)]);
  const consumptionKeys = added("externalIdempotencyKeys").value.filter(key =>
    /^idempotency:v1:\d+:ssa-medicare:/.test(key));
  expect(consumptionKeys).toContain(idempotencyKey("ssa-medicare:payment", receipt.payable.paymentId));
  expect(consumptionKeys).toHaveLength(2 + 4 * receipt.requests.length);
  removeIds("externalIdempotencyKeys", [...commitments, ...consumptionKeys]);
  expect(canonicalSerialize(field(terminal, "accounts"))).toBe(cash);
  expect(restore).toThrow(expect.objectContaining({
    message: "HOUSEHOLD_REPLAY_BASIS_MISMATCH: portable checkpoint evidence is invalid or unavailable",
    cause: expect.objectContaining({
      message: "Due native SSA installment is missing its exact receipt and dual-original proof",
      issues: [expect.objectContaining({ code: "SSA_CHANGED_PAYMENT" })],
    }),
  }));
}, 90_000);
