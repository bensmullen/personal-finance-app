import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const gates = {};
for (const [key, value] of Object.entries(process.env)) {
  if (!key.startsWith("INCIDENT_GATE_") || !value) continue;
  gates[key.slice("INCIDENT_GATE_".length).toLowerCase()] = value;
}
const incident = {
  schema_version: 1,
  recorded_at: new Date().toISOString(),
  surface: process.env.INCIDENT_SURFACE || "unknown",
  profile: process.env.INCIDENT_PROFILE || "unknown",
  repository: process.env.INCIDENT_REPOSITORY || "unknown",
  run_id: process.env.INCIDENT_RUN_ID || "unknown",
  event: process.env.INCIDENT_EVENT || "unknown",
  head_sha: process.env.INCIDENT_HEAD || "unknown",
  gates,
};
const dir = path.join(root, "engineering-validation-artifacts");
fs.mkdirSync(dir, { recursive: true });
const target = path.join(dir, "agent-incident.json");
fs.writeFileSync(target, JSON.stringify(incident, null, 2) + "\n");
console.log(`WROTE ${path.relative(root, target)}`);
