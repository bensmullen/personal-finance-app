import { getPersonalEditorMetadata, PERSONAL_OBJECT_TYPES, type PersonalDraft, type PersonalObjectType } from "../../src/application/personalMvp.js";
import { objectEntries, objectId, objectLabel, referenceLabel, type DisplayDiagnostic } from "../entityPresentation.js";
import { canRepairEntityField } from "../EntityEditor.js";
import { investmentFieldApplies } from "./investmentFields.js";

export interface DiagnosticTarget { id: string; type: string; label: string; context?: string; objectType?: PersonalObjectType; field?: string; editable: boolean; }
/** Exact IDs only: no substrings, inferred UUID lineage or first ambiguous match. */
export function exactDiagnosticTargets(draft: PersonalDraft, id: string, fieldPath?: string): readonly DiagnosticTarget[] {
  const metadata = getPersonalEditorMetadata();
  const matches: DiagnosticTarget[] = [];
  for (const type of PERSONAL_OBJECT_TYPES) {
    for (const item of objectEntries(draft, type).filter(item => objectId(type, item) === id)) {
      const field = fieldPath && Object.prototype.hasOwnProperty.call(metadata[type].fields, fieldPath) ? fieldPath : undefined;
      const descriptor = field ? (metadata[type].fields as Record<string, Parameters<typeof canRepairEntityField>[2]>)[field] : undefined;
      matches.push({ id, type, objectType: type, label: objectLabel(type, item), ...(field ? { field } : {}),
        ...(item.account_id ? { context: referenceLabel(draft, "Account", item.account_id) } : item.owner_id ? { context: referenceLabel(draft, "Person|Household", item.owner_id) } : {}),
        editable: !!field && canRepairEntityField(type, field, descriptor, item[field], draft) && (type !== "Investment" || investmentFieldApplies(field, item)) });
    }
  }
  for (const [type, key] of [["Event", "event_id"], ["PrimitiveInstance", "primitive_instance_id"], ["TaxRule", "tax_rule_id"]] as const) {
    for (const item of draft.objects[type] ?? []) if (item && typeof item === "object" && !Array.isArray(item) && item[key] === id) matches.push({ id, type, label: typeof item.name === "string" ? item.name : type === "Event" ? "Saved plan activity" : type === "TaxRule" ? "Recorded tax rule" : "Managed calculation relationship", editable: false });
  }
  return matches;
}
export function diagnosticTargets(draft: PersonalDraft, diagnostic: DisplayDiagnostic): readonly DiagnosticTarget[] {
  const ids = [...new Set([diagnostic.entityId, ...(diagnostic.relatedIds ?? [])].filter((id): id is string => !!id))];
  return ids.flatMap(id => {
    const targets = exactDiagnosticTargets(draft, id, id === diagnostic.entityId ? diagnostic.fieldPath : undefined);
    if (targets.length === 1) return targets;
    return [{ id, type: "Unresolved reference", label: targets.length ? "Ambiguous recorded reference" : "Reference unavailable in this model", editable: false }];
  });
}
