import type { JsonValue, PortableModelEnvelope } from "../../model/modelVersion.js";
import { Quantity, SHARE, decimal } from "../../values/index.js";
import { EXACT_DECIMAL, objects, type CanonicalObject } from "./shared.js";

/** Explicit employer-only contingent units are a subset of total opening units. */
const record = (value: JsonValue | undefined): value is CanonicalObject => typeof value === "object" && value !== null && !Array.isArray(value);
export const openingUnvestedQuantity = (model: PortableModelEnvelope, investment: CanonicalObject): Quantity => {
  const primitive = objects(model, "PrimitiveInstance").find(item => item.primitive_instance_id === investment.contribution_model_id);
  const parameters = primitive?.parameters;
  const raw = record(parameters) ? parameters.openingUnvestedQuantity : undefined;
  if (raw === undefined) return Quantity.parse("0", SHARE);
  const account = objects(model, "Account").find(item => item.account_id === investment.account_id);
  if (typeof raw !== "string" || !EXACT_DECIMAL.test(raw) || decimal(raw).isNegative() || typeof investment.quantity !== "string" || !EXACT_DECIMAL.test(investment.quantity) || decimal(raw).compare(decimal(investment.quantity)) > 0 || !["traditional_401k", "roth_401k"].includes(String(account?.account_type))) throw new Error("OPENING_EMPLOYER_UNVESTED_QUANTITY_INVALID");
  return Quantity.parse(raw, SHARE);
};
