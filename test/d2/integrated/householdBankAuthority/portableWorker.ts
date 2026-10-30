import { readFileSync } from "node:fs";
import { createAuthoritativeState, restoreAuthoritativeCheckpointDelta, requalifyD2SettlementReceiptHistory,
  type AuthoritativeStateDraft, type AuthoritativeCheckpointDelta } from "../../../../src/state/index.js";
import { Money, Currency } from "../../../../src/values/index.js";
import { context, install } from "./scenario.js";

const path = process.env.PFM_HOUSEHOLD_BANK_PAYLOAD;
if (!path) throw new Error("MISSING_SYNTHETIC_PAYLOAD");
const payload = JSON.parse(readFileSync(path, "utf8"), (_key, value: unknown) => {
  if (value && typeof value === "object" && "amount" in value && "currency" in value &&
      typeof value.amount === "string" && typeof value.currency === "string") return Money.parse(value.amount, Currency.of(value.currency));
  return value;
}) as { sources: boolean; state: AuthoritativeStateDraft; delta: AuthoritativeCheckpointDelta };
if (payload.sources) install();
try {
  const imported = createAuthoritativeState(payload.state);
  const restored = restoreAuthoritativeCheckpointDelta(createAuthoritativeState(), payload.delta);
  requalifyD2SettlementReceiptHistory(restored, context());
  process.stdout.write(JSON.stringify({ imported: imported.accounts, restored: restored.accounts }));
} catch (error) {
  if (payload.sources) throw error;
  process.stdout.write(JSON.stringify({ rejected: true }));
}
