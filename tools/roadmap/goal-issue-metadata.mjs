import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { canonicalJson, readTaskMetadata, validateRecord } from "../codex/goal-framework/contracts.mjs";

const marker = "<!-- PFM_TASK_META_V1";
const markerFamily = /^\s*<!--\s*PFM_TASK_META(?:\b|_)/mu;
const maxIssues = 4_000;
const maxBodyBytes = 256 * 1024;
const maxBatch = 64;
const candidatePrefix = "[agent-candidate]";
const sha = /^[a-f0-9]{64}$/u;
const repositoryName = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9_.-]*$/u;
const identity = (value) => Number.isSafeInteger(value) && value > 0;
const nonempty = (value) => typeof value === "string" && value.trim().length > 0;
export const bodyDigest = (body) => createHash("sha256").update(body, "utf8").digest("hex");

function requireMetadata(condition, message) {
  if (!condition) throw new Error(message);
}

function byNumber(rows) {
  requireMetadata(Array.isArray(rows) && rows.length <= maxIssues, "Issue inventory bound");
  const index = new Map();
  for (const row of rows) {
    requireMetadata(identity(row?.issue_number) && !index.has(row.issue_number), "Invalid or duplicate issue identity");
    index.set(row.issue_number, row);
  }
  return index;
}

function uniqueList(value, accepts) {
  return Array.isArray(value) && value.length === new Set(value).size && value.every(accepts);
}

function allocation(record) {
  return {
    owner_stage: record.owner_stage, blocking_gate: record.blocking_gate,
    depends_on: record.depends_on, spec_requirement_ids: record.requirement_ids,
  };
}

function checkGraph(rows, gates) {
  const index = byNumber(rows);
  // Remove satisfied edges from the validation graph only. Issue closure is irrelevant.
  const dependents = new Map(rows.map(row => [row.issue_number, []]));
  const pending = new Map();
  for (const row of rows) {
    const { issue_number: number, owner_stage, blocking_gate, depends_on, spec_requirement_ids, scope } = row;
    requireMetadata(nonempty(owner_stage) && nonempty(scope) && Object.hasOwn(gates, blocking_gate)
      && uniqueList(depends_on, identity) && uniqueList(spec_requirement_ids, nonempty) && spec_requirement_ids.length,
    `Invalid allocation #${number}`);
    pending.set(number, depends_on.length);
    for (const dependency of depends_on) {
      requireMetadata(dependency !== number && index.has(dependency), `Unknown or self dependency #${number}`);
      dependents.get(dependency).push(number);
    }
  }
  const ready = [...pending].filter(([, count]) => count === 0).map(([number]) => number);
  for (const number of ready) {
    for (const dependent of dependents.get(number)) {
      const count = pending.get(dependent) - 1;
      pending.set(dependent, count);
      if (count === 0) ready.push(dependent);
    }
  }
  requireMetadata(ready.length === rows.length, "Issue dependency cycle");
  return index;
}

function checkRegister(registry) {
  requireMetadata(registry?.schema_version === 1 && registry.stage_gates
    && nonempty(registry.legacy_open_task_reconciliation?.handling)
    && registry.excluded_from_product_gates?.class === candidatePrefix, "Invalid register version or classification");
  const rows = checkGraph(registry.issues, registry.stage_gates);
  for (const [gate, rule] of Object.entries(registry.stage_gates)) {
    const expected = registry.issues.filter(row => row.blocking_gate === gate).map(row => row.issue_number);
    requireMetadata(nonempty(rule.stage) && nonempty(rule.blocking_transition)
      && uniqueList(rule.required_issue_numbers, identity) && expected.length === rule.required_issue_numbers.length
      && rule.required_issue_numbers.every(number => rows.get(number)?.blocking_gate === gate), `Gate inventory mismatch ${gate}`);
  }
  const historical = registry.legacy_open_task_reconciliation.issue_numbers;
  requireMetadata(uniqueList(historical, identity) && historical.length <= maxIssues, "Invalid administrative issue inventory");
  const consolidated = byNumber(registry.closed_consolidations);
  byNumber([...registry.issues, ...historical.map(issue_number => ({ issue_number })), ...registry.closed_consolidations]);
  for (const row of consolidated.values()) {
    requireMetadata(["duplicate", "superseded"].includes(row.closed_as) && nonempty(row.retained_requirement),
      `Invalid consolidation #${row.issue_number}`);
    const visited = new Set([row.issue_number]);
    let owner = row.consolidated_into;
    while (!rows.has(owner)) {
      requireMetadata(!visited.has(owner) && consolidated.has(owner), `Unresolved consolidation #${row.issue_number}`);
      visited.add(owner);
      owner = consolidated.get(owner).consolidated_into;
    }
    requireMetadata(rows.get(owner).blocking_gate === row.original_gate, `Consolidation gate changed #${row.issue_number}`);
  }
}

// Imported legacy authority has no invented goal ID, work package or approval.
// Ordering is retained so even the gate lists and provenance fields round-trip.
export function exportLegacy(registry, repository) {
  checkRegister(registry);
  requireMetadata(repositoryName.test(repository), "Invalid repository");
  const { issues, closed_consolidations, legacy_open_task_reconciliation, ...header } = structuredClone(registry);
  const { issue_numbers, ...administrative } = legacy_open_task_reconciliation;
  return {
    version: 1, repository, header, administrative,
    obligations: [
      ...issues.map(row => ({ kind: "allocation", row })),
      ...issue_numbers.map(issue_number => ({ kind: "administrative", row: { issue_number } })),
      ...closed_consolidations.map(row => ({ kind: "consolidation", row })),
    ],
  };
}

export function restoreLegacy(imported) {
  requireMetadata(imported?.version === 1 && repositoryName.test(imported.repository), "Unknown legacy import");
  const { header, administrative, obligations } = structuredClone(imported);
  const issues = [], issue_numbers = [], closed_consolidations = [];
  for (const { kind, row } of obligations) {
    if (kind === "allocation") issues.push(row);
    else if (kind === "administrative") issue_numbers.push(row.issue_number);
    else if (kind === "consolidation") closed_consolidations.push(row);
    else throw new Error("Unknown legacy obligation");
  }
  const restored = { ...header, issues, legacy_open_task_reconciliation: { ...administrative, issue_numbers }, closed_consolidations };
  checkRegister(restored);
  return restored;
}

export function shadowReport(registry, imported) {
  const restored = restoreLegacy(imported);
  requireMetadata(isDeepStrictEqual(restored, registry), "Legacy shadow differs from original register");
  const issues = imported.obligations.map(({ kind, row }) => ({
    issue: row.issue_number, kind, obligation_sha256: bodyDigest(canonicalJson(row)),
  }));
  const header = Object.entries(imported.header).map(([key, value]) => ({
    key, sha256: bodyDigest(canonicalJson(value)),
  }));
  return { status: "LEGACY_SHADOW_EQUIVALENT_NON_AUTHORIZING", repository: imported.repository,
    header, administrative_sha256: bodyDigest(canonicalJson(imported.administrative)), issues };
}

function issueObservation(issue, repository) {
  requireMetadata(identity(issue?.number) && typeof issue.title === "string"
    && ["open", "closed"].includes(issue.state) && issue.html_url === `https://github.com/${repository}/issues/${issue.number}`
    && typeof issue.body === "string" && Buffer.byteLength(issue.body) <= maxBodyBytes, "Invalid issue observation");
  return { number: issue.number, body_sha256: bodyDigest(issue.body) };
}

export function parseIssueMetadata(issue, repository) {
  const observation = issueObservation(issue, repository);
  function parse() {
    requireMetadata([...issue.body.matchAll(/<!--\s*PFM_TASK_META(?:_\w+)?\b/gu)].length === 1
      && issue.body.includes(marker), "Unknown or duplicate metadata marker");
    return readTaskMetadata(issue.body, { repository, taskIssue: issue.number });
  }
  // Fail closed on unknown versions and malformed markers that resemble one.
  const metadata = markerFamily.test(issue.body) ? parse() : null;
  return { ...observation, metadata };
}

// Label edits and open/closed transitions neither add nor discharge an obligation.
export function observeInventory(issues, repository) {
  requireMetadata(Array.isArray(issues) && issues.length <= maxIssues, "Issue inventory bound");
  const observations = new Map();
  const candidateIssues = new Set();
  for (const issue of issues) {
    if (Object.hasOwn(issue, "pull_request")) continue;
    const observation = issueObservation(issue, repository);
    requireMetadata(!observations.has(issue.number) && !candidateIssues.has(issue.number), "Duplicate issue observation");
    if (issue.title.startsWith(candidatePrefix)) candidateIssues.add(issue.number);
    else observations.set(issue.number, { issue, ...observation });
  }
  return observations;
}

export function compareLiveShadow(registry, imported, observations) {
  const report = shadowReport(registry, imported);
  const known = new Map(imported.obligations.map(obligation => [obligation.row.issue_number, obligation]));
  const issueEvidence = report.issues.map(entry => {
    const observation = observations.get(entry.issue);
    requireMetadata(observation, `Missing legacy issue #${entry.issue}`);
    const { metadata, body_sha256 } = parseIssueMetadata(observation.issue, imported.repository);
    const original = known.get(entry.issue).row;
    if (metadata !== null) {
      requireMetadata(entry.kind === "allocation"
        && isDeepStrictEqual(allocation(metadata), allocation({
          ...original, requirement_ids: original.spec_requirement_ids,
        })), `Live shadow allocation differs #${entry.issue}`);
    }
    return { ...entry, body_sha256, source: metadata === null ? "legacy_import" : "matching_issue_block" };
  });
  const uncoveredOpen = [...observations.values()].filter(({ issue }) => issue.state === "open" && !known.has(issue.number))
    .map(({ number }) => number);
  return { ...report, status: "LIVE_SHADOW_COMPARED_NON_AUTHORIZING", issues: issueEvidence,
    uncovered_open: uncoveredOpen };
}

// The callback resolves a scoped, authenticated decision from outside the issue.
// The returned rule must come from the verified goal/control revision, never from
// issue fields, labels, a reported actor name, or a digest match alone.
export function projectMetadata(imported, observations, resolveDecision, admitted) {
  requireMetadata(admitted instanceof Map, "Authenticated admission inventory required");
  const registry = restoreLegacy(imported);
  const shadow = compareLiveShadow(registry, imported, observations);
  const importedNumbers = new Set(shadow.issues.map(entry => entry.issue));
  const tasks = new Map();
  const recordIds = new Set();
  for (const { issue } of [...observations.values()].sort((a, b) => a.number - b.number)) {
    const { metadata, body_sha256 } = parseIssueMetadata(issue, imported.repository);
    if (metadata === null) {
      requireMetadata(importedNumbers.has(issue.number) || issue.state === "closed", `Missing metadata #${issue.number}`);
      continue;
    }
    requireMetadata(typeof resolveDecision === "function", "Authenticated control resolver required");
    const decision = resolveDecision({ repository: imported.repository, number: issue.number, metadata, body_sha256 });
    const { goal_issue, approved_goal_revision, work_package, owner_stage, blocking_gate, requirement_ids } = metadata;
    requireMetadata(decision?.goal_issue === goal_issue && decision.revision === approved_goal_revision
      && decision.task_issue === issue.number && decision.work_package === work_package
      && decision.owner_stage === owner_stage && decision.blocking_gate === blocking_gate
      && decision.metadata_revision === metadata.revision && isDeepStrictEqual(decision.depends_on, metadata.depends_on)
      && sha.test(decision.digest) && metadata.references.some(ref => ref.id === decision.id && ref.digest === decision.digest)
      && Array.isArray(decision.requirement_ids) && requirement_ids.every(id => decision.requirement_ids.includes(id)),
    `Unapproved metadata allocation #${issue.number}`);
    requireMetadata(observations.has(goal_issue), `Missing goal issue #${goal_issue}`);
    requireMetadata(!recordIds.has(metadata.id), `Duplicate metadata identity #${issue.number}`);
    recordIds.add(metadata.id);
    tasks.set(issue.number, { metadata, decision, body_sha256 });
    if (importedNumbers.has(issue.number)) continue;
    const row = { issue_number: issue.number, ...allocation(metadata), scope: "Operational task metadata" };
    requireMetadata(Object.hasOwn(registry.stage_gates, blocking_gate), `Unknown mandatory gate #${issue.number}`);
    registry.stage_gates[blocking_gate].required_issue_numbers.push(issue.number);
    registry.issues.push(row);
  }
  for (const [number, { metadata, decision }] of tasks) {
    for (const dependency of metadata.depends_on) {
      requireMetadata(tasks.get(dependency)?.metadata.goal_issue === metadata.goal_issue
        || (importedNumbers.has(dependency) && decision.legacy_dependencies?.includes(dependency)),
      `Unapproved dependency #${number} -> #${dependency}`);
    }
  }
  for (const [number, prior] of admitted) {
    const latest = tasks.get(number)?.metadata;
    requireMetadata(latest && latest.id === prior.id && latest.goal_issue === prior.goal_issue
      && latest.work_package === prior.work_package && latest.revision >= prior.revision
      && isDeepStrictEqual(allocation(latest), allocation(prior)), `Previously admitted obligation changed or disappeared #${number}`);
  }
  checkRegister(registry);
  return { registry, tasks };
}

export function metadataBody(issue, repository, record) {
  validateRecord(record, "PFM_TASK_META_V1");
  const previous = parseIssueMetadata(issue, repository).metadata;
  const newline = issue.body.includes("\r\n") ? "\r\n" : "\n";
  let body;
  if (previous === null) {
    requireMetadata(record.revision === 1, "New metadata must start at revision 1");
    body = issue.body + newline + newline + marker + newline + canonicalJson(record) + newline + "-->";
  } else {
    requireMetadata(record.revision === previous.revision + 1 && record.id === previous.id
      && record.goal_issue === previous.goal_issue && record.work_package === previous.work_package
      && isDeepStrictEqual(allocation(record), allocation(previous)), "Unsafe metadata revision or allocation change");
    const start = /^<!-- PFM_TASK_META_V1\r?\n/mu.exec(issue.body);
    const payloadStart = start.index + start[0].length;
    const end = /\r?\n-->(?=\r?\n|$)/u.exec(issue.body.slice(payloadStart));
    body = issue.body.slice(0, payloadStart) + canonicalJson(record) + issue.body.slice(payloadStart + end.index);
  }
  parseIssueMetadata({ ...issue, body }, repository);
  return body;
}

// A journal contains no bodies or credentials. A controlled caller retains the
// proposed records and a durable fenced journal, recreating each edit on resume.
export function planMigrationBatch(observations, records, repository) {
  requireMetadata(records instanceof Map && records.size > 0 && records.size <= maxBatch, "Migration batch bound");
  return [...records].map(([number, record]) => {
    const observation = observations.get(number);
    requireMetadata(observation, `Missing migration issue #${number}`);
    return { number, before: observation.body_sha256,
      after: bodyDigest(metadataBody(observation.issue, repository, record)) };
  });
}

// Offline adapter contract. A compare-and-write must atomically fence ALL
// editors, active grants and writer permission. A REST GET followed by PATCH
// cannot implement that contract. No live adapter or credentials are provided.
export async function resumeMigrationBatch({ journal, records, repository, writer, adapter }) {
  requireMetadata(Array.isArray(journal) && journal.length > 0 && journal.length <= maxBatch
    && records instanceof Map && records.size === journal.length && uniqueList(journal.map(e => e.number), identity)
    && journal.every(entry => sha.test(entry.before) && sha.test(entry.after) && entry.before !== entry.after),
  "Invalid migration journal");
  requireMetadata(await adapter.verifyWriter(writer, repository, journal) === true, "Migration writer denied");
  for (const entry of journal) {
    const { number, before, after } = entry;
    requireMetadata(records.has(number), `Missing migration record #${number}`);
    const issue = await adapter.read(number);
    const observed = issueObservation(issue, repository);
    requireMetadata(observed.number === number, "Migration issue identity changed");
    if (observed.body_sha256 === after) {
      requireMetadata(isDeepStrictEqual(parseIssueMetadata(issue, repository).metadata, records.get(number)),
        `Migration plan changed #${number}`);
    } else {
      requireMetadata(observed.body_sha256 === before, `Concurrent body edit #${number}`);
      const body = metadataBody(issue, repository, records.get(number));
      requireMetadata(bodyDigest(body) === after, `Migration plan changed #${number}`);
      requireMetadata(await adapter.compareAndWrite({ writer, repository, number, before, body }) === true,
        `Migration writer, active grant or revision conflict #${number}`);
    }
    const verified = issueObservation(await adapter.read(number), repository);
    requireMetadata(verified.number === number && verified.body_sha256 === after, `Migration readback conflict #${number}`);
  }
}

// Offline authority transition. The caller supplies an authenticated fence
// proving the admission freeze and a fresh complete inventory under that fence.
export function transitionMetadata({ direction, imported, exported, current, admitted, resolveDecision, verifyFreeze }) {
  requireMetadata(direction === "cutover" || direction === "rollback", "Unknown authority transition");
  requireMetadata(admitted instanceof Map && (direction === "rollback" || admitted.size === 0)
    && typeof verifyFreeze === "function"
    && verifyFreeze({ direction, imported, exported, current, admitted }) === true,
    "Reviewed transition and admission freeze required");
  for (const [number, observation] of exported) {
    const latest = current.get(number);
    requireMetadata(latest, `Issue disappeared since export #${number}`);
    if (latest.body_sha256 === observation.body_sha256) continue;
    requireMetadata(observation.reconciled_body_sha256 === latest.body_sha256,
      `Unreconciled edit since export #${number}`);
  }
  const { registry, tasks } = projectMetadata(imported, current, resolveDecision, admitted);
  if (direction === "rollback") {
    for (const number of tasks.keys()) {
      requireMetadata(admitted.has(number), `Unreconciled task at rollback #${number}`);
    }
  }
  return { authority: direction === "cutover" ? "issue_metadata" : "legacy_register",
    status: "OFFLINE_PROJECTION_NON_AUTHORIZING", registry, tasks };
}
