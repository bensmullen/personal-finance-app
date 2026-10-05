import { registerHouseholdParticipantCodec } from "../r3/participantCodec.js";
import { createTaxCatalog, taxCatalogFingerprint } from "../../rules/tax/catalog.js";
import { Money } from "../../values/index.js";
import type { HouseholdTaxInput } from "./contracts.js";
import { createHouseholdTaxParticipant } from "./participant.js";

const record = (value: unknown): value is Readonly<Record<string, unknown>> => value !== null && typeof value === "object" && !Array.isArray(value);
const interval = (value: unknown): boolean => record(value) && typeof value.effective_date === "string" && (value.expiration_date === undefined || typeof value.expiration_date === "string");
const eligibility = (value: unknown): boolean => Array.isArray(value) && value.every(item => interval(item) && record(item) && typeof item.key === "string" && typeof item.value === "boolean");
const location = (value: unknown): boolean => interval(value) && record(value) && typeof value.state_jurisdiction === "string" && ["local_jurisdiction", "municipality", "psd_code"].every(key => value[key] === undefined || typeof value[key] === "string");
/** Check transport structure; catalog construction subsequently validates every law definition. */
function taxInputs(value: unknown): value is HouseholdTaxInput & { readonly catalogFingerprint: string } {
  return record(value) && typeof value.ownerId === "string" && typeof value.catalogFingerprint === "string" &&
    (value.filingStatus === undefined || typeof value.filingStatus === "string") &&
    Array.isArray(value.catalog) && value.catalog.every(rule => record(rule) && rule.kind === "tax_core") &&
    Array.isArray(value.incomes) && value.incomes.every(income => record(income) &&
      ["id", "ownerId", "incomeType", "taxCharacter", "start"].every(key => typeof income[key] === "string") &&
      Array.isArray(income.residence) && income.residence.every(location) && Array.isArray(income.work) && income.work.every(work => location(work) && record(work) && typeof work.allocation === "string") && eligibility(income.eligibility)) &&
    eligibility(value.eligibility) && Array.isArray(value.payments) && value.payments.every(payment => record(payment) && typeof payment.id === "string" && typeof payment.jurisdiction === "string" && typeof payment.at === "string" && payment.amount instanceof Money && ["withholding", "estimated"].includes(String(payment.kind))) &&
    (value.settlements === undefined || Array.isArray(value.settlements) && value.settlements.every(item => record(item) && ["id", "jurisdiction", "at", "taxYear"].every(key => typeof item[key] === "string"))) &&
    Array.isArray(value.diagnostics) && value.diagnostics.every(item => record(item) && item.entityType === "tax_capability" && Array.isArray(item.affectedOutputs)) &&
    (value.fundingPolicy === undefined || record(value.fundingPolicy) && typeof value.fundingPolicy.id === "string" && Array.isArray(value.fundingPolicy.orderedSources)) &&
    (value.refundAccountId === undefined || typeof value.refundAccountId === "string");
}
registerHouseholdParticipantCodec({ codec: "household-tax/v1", restore: value => {
  if (!taxInputs(value)) throw new Error("HOUSEHOLD_TAX_REPLAY_INVALID: portable facts are malformed");
  const catalog = createTaxCatalog(value.catalog);
  if (taxCatalogFingerprint(catalog) !== value.catalogFingerprint) throw new Error("HOUSEHOLD_TAX_REPLAY_INVALID: catalog identity changed");
  const { catalogFingerprint: _fingerprint, ...input } = value;
  return createHouseholdTaxParticipant(input);
} });
