import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "..");
const manifestPath = path.join(root, "docs/spec-manifest.json");
const allowedVerificationMethods = new Set(["inspection", "analysis", "test", "benchmark", "demonstration"]);

const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));
const isRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const errors = [];
const fail = (message) => errors.push(message);

const manifest = await readJson(manifestPath);

if (manifest.manifest_version !== "1.1.0") fail("traceability validator requires manifest_version 1.1.0");
if (typeof manifest.traceability_index_path !== "string" || manifest.traceability_index_path.length === 0) {
  fail("manifest.traceability_index_path must be a non-empty string");
}

const specs = Array.isArray(manifest.specifications) ? manifest.specifications : [];
const byId = new Map();
const prefixes = new Map();

for (const spec of specs) {
  if (!isRecord(spec) || typeof spec.id !== "string") continue;
  if (byId.has(spec.id)) fail(`duplicate specification id: ${spec.id}`);
  byId.set(spec.id, spec);
  const parents = Array.isArray(spec.parent_spec_ids) ? spec.parent_spec_ids : [];
  if (parents.includes(spec.id)) fail(`specification cannot parent itself: ${spec.id}`);
  if (spec.requirement_id_policy === "required") {
    if (typeof spec.requirement_prefix !== "string" || !/^PFA-[A-Z]+$/.test(spec.requirement_prefix)) {
      fail(`invalid/missing requirement_prefix for ${spec.id}`);
    } else if (prefixes.has(spec.requirement_prefix)) {
      fail(`duplicate requirement prefix ${spec.requirement_prefix}: ${prefixes.get(spec.requirement_prefix)} and ${spec.id}`);
    } else {
      prefixes.set(spec.requirement_prefix, spec.id);
    }
  }
}

for (const spec of specs) {
  if (!isRecord(spec) || typeof spec.id !== "string") continue;
  for (const parent of Array.isArray(spec.parent_spec_ids) ? spec.parent_spec_ids : []) {
    if (!byId.has(parent)) fail(`unknown parent specification ${parent} for ${spec.id}`);
  }
}

const visiting = new Set();
const visited = new Set();
const visit = (id, stack = []) => {
  if (visiting.has(id)) {
    fail(`specification parent cycle: ${[...stack, id].join(" -> ")}`);
    return;
  }
  if (visited.has(id)) return;
  visiting.add(id);
  const spec = byId.get(id);
  for (const parent of Array.isArray(spec?.parent_spec_ids) ? spec.parent_spec_ids : []) {
    visit(parent, [...stack, id]);
  }
  visiting.delete(id);
  visited.add(id);
};
for (const id of byId.keys()) visit(id);

let index;
try {
  index = await readJson(path.resolve(root, manifest.traceability_index_path ?? ""));
} catch (error) {
  fail(`traceability index unreadable: ${error.message}`);
}
const entries = Array.isArray(index?.requirements) ? index.requirements : [];
const entryById = new Map();

for (const entry of entries) {
  if (!isRecord(entry) || typeof entry.id !== "string") {
    fail("traceability entries require a string id");
    continue;
  }
  if (entryById.has(entry.id)) fail(`duplicate traceability requirement id: ${entry.id}`);
  entryById.set(entry.id, entry);
  const spec = byId.get(entry.spec_id);
  if (!spec) {
    fail(`traceability requirement ${entry.id} owns unknown specification ${entry.spec_id}`);
    continue;
  }
  if (spec.requirement_id_policy !== "required") {
    fail(`traceability requirement ${entry.id} is owned by non-controlled spec ${entry.spec_id}`);
  }
  if (typeof spec.requirement_prefix === "string" && !entry.id.startsWith(`${spec.requirement_prefix}-`)) {
    fail(`traceability requirement ${entry.id} does not match prefix ${spec.requirement_prefix}`);
  }
  if (!allowedVerificationMethods.has(entry.verification_method)) {
    fail(`traceability requirement ${entry.id} has invalid verification_method ${entry.verification_method}`);
  }
  if (!Array.isArray(entry.parent_requirement_ids)) fail(`traceability requirement ${entry.id} parent_requirement_ids must be an array`);
  if (!Array.isArray(entry.verification_refs)) fail(`traceability requirement ${entry.id} verification_refs must be an array`);
  if (!Array.isArray(entry.implementation_scope)) fail(`traceability requirement ${entry.id} implementation_scope must be an array`);
}

for (const entry of entries) {
  for (const parent of Array.isArray(entry.parent_requirement_ids) ? entry.parent_requirement_ids : []) {
    if (!entryById.has(parent)) fail(`unknown parent requirement ${parent} for ${entry.id}`);
  }
}

for (const spec of specs.filter((s) => s?.requirement_id_policy === "required")) {
  let content = "";
  try {
    content = await readFile(path.resolve(root, spec.path), "utf8");
  } catch (error) {
    fail(`controlled spec unreadable ${spec.id}: ${error.message}`);
    continue;
  }
  const ids = new Set(content.match(/\bPFA-[A-Z]+-\d{3}\b/g) ?? []);
  for (const id of ids) {
    const entry = entryById.get(id);
    if (!entry) fail(`controlled requirement missing from traceability index: ${id}`);
    else if (entry.spec_id !== spec.id) fail(`requirement ${id} found in ${spec.id} but index owner is ${entry.spec_id}`);
  }
  for (const entry of entries.filter((e) => e.spec_id === spec.id)) {
    if (!ids.has(entry.id)) fail(`traceability requirement absent from owning spec ${spec.id}: ${entry.id}`);
  }
}

if (errors.length > 0) {
  console.error(`Specification traceability validation failed:\n${[...new Set(errors)].sort().map((e) => `- ${e}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Specification traceability validation passed: ${byId.size} specifications, ${entryById.size} controlled requirements.`);
}
