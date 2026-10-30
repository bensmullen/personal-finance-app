import { readFileSync } from "node:fs";
import { createAuthoritativeState, restoreAuthoritativeCheckpointDelta, requalifyD2SettlementReceiptHistory,
  requalifyRetirementDistributionHistory, type AuthoritativeStateDraft, type AuthoritativeCheckpointDelta } from "../../../../src/state/index.js";
import { canonicalSerialize } from "../../../../src/simulation/run.js";
import { Currency, Money } from "../../../../src/values/index.js";
import { context, install } from "./scenario.js";

const path = process.env.PFM_NATIVE_BANK_PAYLOAD;
if (!path) throw new Error("MISSING_SYNTHETIC_NATIVE_PAYLOAD");
const payload = JSON.parse(readFileSync(path, "utf8"), (_key, v: unknown) => v && typeof v === "object" && "amount" in v && "currency" in v &&
  typeof v.amount === "string" && typeof v.currency === "string" ? Money.parse(v.amount, Currency.of(v.currency)) : v) as {
  sources: boolean; state: AuthoritativeStateDraft; delta: AuthoritativeCheckpointDelta;
};
if (payload.sources) install();
try {
  const imported = createAuthoritativeState(payload.state), checkpoint = restoreAuthoritativeCheckpointDelta(createAuthoritativeState(), payload.delta);
  for (const state of [imported, checkpoint]) {
    requalifyD2SettlementReceiptHistory(state, context);
    requalifyRetirementDistributionHistory(state, context);
  }
  process.stdout.write(JSON.stringify({ imported: canonicalSerialize(imported) === canonicalSerialize(payload.state),
    checkpoint: canonicalSerialize(checkpoint) === canonicalSerialize(payload.state) }));
} catch (error) {
  if (payload.sources) throw error;
  process.stdout.write(JSON.stringify({ rejected: true }));
}
