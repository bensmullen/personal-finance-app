import crypto from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const collapse = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const normalizeList = (values) =>
  [...new Set((Array.isArray(values) ? values : []).map((value) => collapse(value).toLowerCase()).filter(Boolean))].sort();

export const normalizeCandidateIdentity = (candidate) => ({
  rule: collapse(candidate?.rule),
  applicability: {
    task_kinds: normalizeList(candidate?.applicability?.task_kinds),
    ci_profiles: normalizeList(candidate?.applicability?.ci_profiles),
    heavy_validation_profiles: normalizeList(candidate?.applicability?.heavy_validation_profiles),
    task_continuities: normalizeList(candidate?.applicability?.task_continuities),
  },
  do_not_generalize_to: collapse(candidate?.do_not_generalize_to),
});

export const candidateKey = (candidate) => {
  const normalized = normalizeCandidateIdentity(candidate);
  if (!normalized.rule || !normalized.do_not_generalize_to)
    throw new Error("candidate rule and do_not_generalize_to are required");
  for (const [key, values] of Object.entries(normalized.applicability))
    if (values.length === 0) throw new Error(`candidate applicability.${key} must not be empty`);
  const canonical = JSON.stringify(normalized);
  const digest = crypto.createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 12);
  return `ALC-${digest}`;
};

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  try {
    const input = JSON.parse(fs.readFileSync(0, "utf8"));
    process.stdout.write(candidateKey(input) + "\n");
  } catch (error) {
    console.error(`AGENT_CANDIDATE_KEY_ERROR ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
