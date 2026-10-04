import { z } from "zod";
import { candidateCategories, sourcePaths } from "./candidates.js";

export const onboardingStages = ["intake", "candidate_review", "minimum_valid_model", "first_useful_forecast", "first_stochastic_forecast"] as const;
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const categoryCounts = z.strictObject({
  current_fact: count, historical_activity: count, goal: count, constraint: count,
  assumption: count, decision_policy: count, planned_event: count, scenario: count,
});
const pathCounts = z.strictObject({ guided_entry: count, file_import: count, conversation: count, portable_model: count });

/** Closed labels and aggregate numbers only. No IDs, free text, or candidate data. */
export const onboardingTelemetrySchema = z.discriminatedUnion("event", [
  z.strictObject({
    event: z.literal("stage_progress"), stage: z.enum(onboardingStages),
    outcome: z.enum(["started", "completed", "abandoned"]), elapsedMs: count,
    manualSteps: count, corrections: count, rejections: count, unresolvedHighImpactItems: count,
  }),
  z.strictObject({
    event: z.literal("candidate_counts"), stage: z.enum(onboardingStages),
    countsByCategory: categoryCounts, countsBySourcePath: pathCounts,
  }).refine(event => candidateCategories.reduce((sum, category) => sum + BigInt(event.countsByCategory[category]), 0n)
    === sourcePaths.reduce((sum, path) => sum + BigInt(event.countsBySourcePath[path]), 0n), { message: "Candidate count totals must agree" }),
  z.strictObject({
    event: z.literal("import_result"), format: z.enum(["pfm-onboarding-synthetic-v1", "unsupported"]),
    status: z.enum(["success", "partial", "unsupported", "invalid"]), elapsedMs: count,
    candidateCount: count, omittedRows: count, unresolvedHighImpactItems: count,
  }),
]);
export type OnboardingTelemetryEvent = z.infer<typeof onboardingTelemetrySchema>;
export type TelemetryValidation =
  | { readonly status: "accepted"; readonly event: OnboardingTelemetryEvent }
  | { readonly status: "rejected"; readonly reason: "invalid_telemetry" };

/** Reject rather than strip extra keys; errors never echo potentially sensitive input. */
export function validateOnboardingTelemetry(input: unknown): TelemetryValidation {
  const result = onboardingTelemetrySchema.safeParse(input);
  return result.success ? { status: "accepted", event: result.data }
    : { status: "rejected", reason: "invalid_telemetry" };
}
