import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ledgerPath = path.join(root, "docs", "development", "agent-lessons.json");
const fail = (message) => { console.error(`AGENT_LESSON_ERROR ${message}`); process.exit(1); };
let data;
try { data = JSON.parse(fs.readFileSync(ledgerPath, "utf8")); }
catch (error) { fail(`unable_to_parse ${error instanceof Error ? error.message : String(error)}`); }
if (data.schema_version !== 1 || !Array.isArray(data.lessons)) fail("invalid_root");
const ids = new Set();
const validStatuses = new Set(["candidate", "active", "retired"]);
const validSeverities = new Set(["low", "medium", "high", "critical"]);
const selectorKeys = ["task_kinds", "ci_profiles", "heavy_validation_profiles", "task_continuities"];
for (const lesson of data.lessons) {
  if (!lesson || typeof lesson !== "object") fail("lesson_not_object");
  if (!/^AL-\d{3}$/.test(lesson.id ?? "")) fail(`invalid_id ${lesson.id ?? "missing"}`);
  if (ids.has(lesson.id)) fail(`duplicate_id ${lesson.id}`);
  ids.add(lesson.id);
  if (!lesson.title || !validStatuses.has(lesson.status) || !validSeverities.has(lesson.severity)) fail(`invalid_metadata ${lesson.id}`);
  if (!Array.isArray(lesson.source_evidence) || lesson.source_evidence.length === 0 || lesson.source_evidence.some((x) => typeof x !== "string" || !x.trim())) fail(`invalid_evidence ${lesson.id}`);
  if (!lesson.applicability || typeof lesson.applicability !== "object") fail(`missing_applicability ${lesson.id}`);
  for (const key of selectorKeys) {
    const values = lesson.applicability[key];
    if (!Array.isArray(values) || values.length === 0 || values.some((x) => typeof x !== "string" || !x.trim())) fail(`invalid_selector ${lesson.id} ${key}`);
  }
  if (!Array.isArray(lesson.required_markers) || lesson.required_markers.some((x) => typeof x !== "string" || !x.trim())) fail(`invalid_markers ${lesson.id}`);
  for (const key of ["rule", "do_not_generalize_to", "review_criteria"]) {
    if (typeof lesson[key] !== "string" || !lesson[key].trim()) fail(`missing_${key} ${lesson.id}`);
  }
  if (lesson.status === "active" && typeof lesson.promotion_reason !== "string") fail(`active_without_promotion_reason ${lesson.id}`);
  if (lesson.superseded_by != null && !/^AL-\d{3}$/.test(lesson.superseded_by)) fail(`invalid_superseded_by ${lesson.id}`);
}
for (const lesson of data.lessons) if (lesson.superseded_by && !ids.has(lesson.superseded_by)) fail(`unknown_superseding_lesson ${lesson.id}`);
console.log(`PASS agent lessons — ${data.lessons.length} entries, ${data.lessons.filter((x) => x.status === "active").length} active`);
