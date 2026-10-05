import type { JsonValue, PortableModelEnvelope } from "../../model/modelVersion.js";
import { UUID } from "./shared.js";
const array = (value: JsonValue): value is readonly JsonValue[] => Array.isArray(value);

/** Additive canonical migration; it never chooses between conflicting rule versions. */
export const normalizeContributionLimitRuleIds = (account: Readonly<Record<string, JsonValue>>): readonly string[] => {
  const plural = account.contribution_limit_rule_ids;
  if (plural != null && !array(plural)) throw new Error("CONTRIBUTION_LIMIT_BINDING_INVALID");
  const entries = [...(plural ?? []), ...(account.contribution_limit_rule_id == null ? [] : [account.contribution_limit_rule_id])];
  if (entries.some(id => typeof id !== "string" || !UUID.test(id))) throw new Error("CONTRIBUTION_LIMIT_BINDING_INVALID");
  return Object.freeze([...new Set(entries.map(id => String(id).toLowerCase()))].sort());
};

const record = (value: JsonValue): value is Readonly<Record<string, JsonValue>> => typeof value === "object" && value !== null && !Array.isArray(value);
export const normalizeModelContributionBindings = (model: PortableModelEnvelope): PortableModelEnvelope => Object.freeze({ ...model,
  objects: Object.freeze({ ...model.objects, ...(model.objects.Account === undefined ? {} : { Account: Object.freeze(model.objects.Account.map(value => {
    if (!record(value) || value.contribution_limit_rule_id == null && value.contribution_limit_rule_ids == null) return value;
    return Object.freeze({ ...value, contribution_limit_rule_ids: normalizeContributionLimitRuleIds(value) });
  })) }) }) });
