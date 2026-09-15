import type { ValidationIssue } from "../../diagnostics/index.js";

export interface CapabilityDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly capability: string;
  readonly entityType?: string;
  readonly entityId?: string;
  readonly fieldPath?: string;
  readonly relatedIds?: readonly string[];
}

export type CompileResult<T> =
  | {
      readonly status: "compiled";
      readonly value: T;
      readonly diagnostics: readonly ValidationIssue[];
    }
  | {
      readonly status: "unsupported";
      readonly diagnostics: readonly CapabilityDiagnostic[];
    }
  | {
      readonly status: "invalid_model";
      readonly diagnostics: readonly ValidationIssue[];
    };

export const capabilityDiagnostic = (
  diagnostic: CapabilityDiagnostic,
): CapabilityDiagnostic =>
  Object.freeze({
    ...diagnostic,
    ...(diagnostic.relatedIds === undefined
      ? {}
      : { relatedIds: Object.freeze([...diagnostic.relatedIds]) }),
  });

export const compiled = <T>(value: T): CompileResult<T> =>
  Object.freeze({ status: "compiled", value, diagnostics: Object.freeze([]) });

export const unsupported = <T>(
  diagnostic: CapabilityDiagnostic,
): CompileResult<T> =>
  Object.freeze({
    status: "unsupported",
    diagnostics: Object.freeze([capabilityDiagnostic(diagnostic)]),
  });

export const invalid = <T>(issue: ValidationIssue): CompileResult<T> =>
  Object.freeze({
    status: "invalid_model",
    diagnostics: Object.freeze([issue]),
  });
