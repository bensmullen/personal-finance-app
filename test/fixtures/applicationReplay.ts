import type { HouseholdProjectionCompilerRequest } from "../../src/application/compiler/householdProjection.js";
import { runPersonalHouseholdForecast } from "../../src/application/householdProjection.js";
import type { PortableModelEnvelope } from "../../src/model/modelVersion.js";
import { householdEvidenceProof } from "../../src/application/mortgageChartData.js";
import type { RunContext } from "../../src/simulation/run.js";

export function applicationReplayArtifact(model: PortableModelEnvelope, compiler: HouseholdProjectionCompilerRequest, context: RunContext) {
  const read = runPersonalHouseholdForecast(model, {
    compiler, runIdentity: context.runId,
    asOf: context.asOf.slice(0, 10), dataCutoff: context.dataCutoff.slice(0, 10),
  });
  if (read.status === "unavailable") throw new Error(JSON.stringify(read.diagnostics));
  const proof = householdEvidenceProof(read.points);
  if (proof === undefined) throw new Error("Expected application-issued replay evidence");
  return proof;
}
