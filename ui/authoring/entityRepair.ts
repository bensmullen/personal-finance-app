import type { PersonalDraft, PersonalObjectType } from "../../src/application/personalMvp.js";
import { objectEntries, referenceTargets } from "../entityPresentation.js";
import { entityField } from "./fieldContract.js";

export interface EditorField {
  readonly type: string;
  readonly required: boolean;
  readonly derived: boolean;
  readonly mutable: boolean;
  readonly default: unknown;
  readonly ref?: string;
  readonly enumValues?: readonly string[];
}
export function canRepairEntityField(type: PersonalObjectType, name: string, field: EditorField | undefined, value: unknown, draft?: PersonalDraft): boolean {
  return !!field && !!entityField(name, type) && !field.derived && field.type !== "object" &&
    !(field.ref && referenceTargets(field.ref).length === 0) &&
    !field.type.startsWith("object") && !(value !== null && typeof value === "object" && (!Array.isArray(value) || value.some(item => item !== null && typeof item === "object"))) &&
    (!draft || !field.ref || referenceTargets(field.ref).some(target => objectEntries(draft, target).length > 0)) && (field.mutable || value === undefined);
}
