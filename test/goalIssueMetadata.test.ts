import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const modulePath = new URL("../tools/roadmap/goal-issue-metadata.mjs", import.meta.url).href;
const tracePath = new URL("../tools/roadmap/verify-issue-stage-register.mjs", import.meta.url).href;
const { bodyDigest, compareLiveShadow, exportLegacy, metadataBody, observeInventory, parseIssueMetadata,
  planMigrationBatch, projectMetadata, restoreLegacy, resumeMigrationBatch, shadowReport, transitionMetadata } = await import(modulePath);
const { readIssueInventory, traceability } = await import(tracePath);
const repository = "bensmullen/personal-finance-app";
const register = JSON.parse(readFileSync(new URL("../docs/development/milestone-issue-register.json", import.meta.url), "utf8"));
const imported = exportLegacy(register, repository);
const source = "Synthetic issue prose with no authorization.";
const timestamp = "2026-11-25T12:00:00.000Z";
const approval = { id: "approval", digest: "a".repeat(64) };

function issue(number: number, body = source, state = "open", title = "Synthetic issue") {
  return { number, title, body, state, html_url: `https://github.com/${repository}/issues/${number}` };
}

function record(number: number, blocking_gate = "D1_U1", depends_on: number[] = [], goal_issue = 3900) {
  return {
    schema: "PFM_TASK_META_V1", id: `task-${number}`, repository, revision: 1, created_at: timestamp,
    producer: { role: "coordinator", actor: "test-actor", session: "test-session" },
    references: [approval], goal_issue, work_package: "approved-work", approved_goal_revision: 2,
    owner_stage: blocking_gate === "D2" ? "D2-A" : "U1", blocking_gate, depends_on,
    requirement_ids: [blocking_gate === "D2" ? "PFA-DET-023" : "PFA-UX-015"],
  };
}

type RecordFixture = ReturnType<typeof record>;
function issueWith(number: number, meta: RecordFixture, state = "open") {
  const original = issue(number, source, state);
  return { ...original, body: metadataBody(original, repository, meta) };
}

function decisions(records: [number, RecordFixture][]) {
  const trusted = new Map(records.map(([number, meta]) => [number, {
    ...approval, goal_issue: meta.goal_issue, task_issue: number, revision: meta.approved_goal_revision,
    metadata_revision: meta.revision, work_package: meta.work_package, owner_stage: meta.owner_stage,
    blocking_gate: meta.blocking_gate, requirement_ids: meta.requirement_ids, depends_on: meta.depends_on,
    legacy_dependencies: [120, 146],
  }]));
  return ({ number }: { number: number }) => trusted.get(number);
}

function inventory(extra: ReturnType<typeof issue>[] = []) {
  const legacy = imported.obligations.map(({ row }: { row: { issue_number: number } }) => issue(row.issue_number, source, "closed"));
  return observeInventory([...legacy, issue(3900, source, "closed"), ...extra], repository);
}

describe("legacy issue metadata shadow", () => {
  it("round-trips every registered, administrative and consolidated obligation with gates and provenance", () => {
    expect(restoreLegacy(imported)).toEqual(register);
    const report = shadowReport(register, imported);
    expect(report.issues.map(({ issue: number }: { issue: number }) => number)).toEqual([
      ...register.issues.map(({ issue_number }: { issue_number: number }) => issue_number),
      ...register.legacy_open_task_reconciliation.issue_numbers,
      ...register.closed_consolidations.map(({ issue_number }: { issue_number: number }) => issue_number),
    ]);
    expect(JSON.stringify(report)).not.toContain(source);
    const changed = structuredClone(imported);
    changed.obligations.find(({ row }: { row: { issue_number: number } }) => row.issue_number === 120).row.spec_requirement_ids.pop();
    expect(() => shadowReport(register, changed)).toThrow();
  });

  it("covers historical closed issues, excludes candidates and fails on missing obligations or open coverage", () => {
    const observations = inventory([issue(4000, "", "open", "[agent-candidate] unrelated"), issue(4001)]);
    expect(compareLiveShadow(register, imported, observations).uncovered_open).toEqual([4001]);
    expect(traceability({ registry: register, imported, observations }).coverage).toBe("incomplete");
    observations.delete(99);
    expect(() => compareLiveShadow(register, imported, observations)).toThrow("Missing legacy issue #99");
  });

  it("keeps harmless label and status edits outside the full-body revision", () => {
    const original = issueWith(4001, record(4001));
    const edited = { ...original, state: "closed", updated_at: timestamp, labels: [{ name: "D2" }] };
    expect(parseIssueMetadata(edited, repository)).toEqual(parseIssueMetadata(original, repository));
  });

  it("rejects duplicate blocks, keys, alternate versions, malformed JSON and foreign identity", () => {
    const original = issueWith(4001, record(4001));
    for (const body of [
      original.body + "\n<!-- PFM_TASK_META_V1\n{}\n-->",
      original.body.replace('"revision":1', '"revision":1,"revision":2'),
      original.body.replace("PFM_TASK_META_V1", "PFM_TASK_META_V2"),
      original.body.replace('"revision":1', '"revision":'),
      original.body.replace(repository, "other/repo"),
    ]) {
      expect(() => parseIssueMetadata({ ...original, body }, repository)).toThrow();
    }
  });
});

describe("reviewed metadata projection", () => {
  const d1 = record(4001, "D1_U1", [120]);
  const d2 = record(4002, "D2", [146, 4001]);
  const resolveDecision = decisions([[4001, d1], [4002, d2]]);
  const read = () => inventory([issueWith(4001, d1), issueWith(4002, d2, "closed")]);

  it("allocates D1 and D2 directly from authenticated issue metadata without a register row", () => {
    const report = traceability({ imported, observations: read(), authority: "issue_metadata", resolveDecision, admitted: new Map() });
    expect(report.status).toBe("LIVE_METADATA_TRACEABILITY_NON_AUTHORIZING");
    expect(report.snapshot.registry.stage_gates.D1_U1.required_issue_numbers).toEqual([120, 4001]);
    expect(report.snapshot.registry.stage_gates.D2.required_issue_numbers).toEqual([
      ...register.stage_gates.D2.required_issue_numbers, 4002,
    ]);
    expect(register.issues.some(({ issue_number }: { issue_number: number }) => issue_number === 4001)).toBe(false);
  });

  it("rejects missing metadata, a forged decision, and a gate downgrade", () => {
    expect(() => projectMetadata(imported, inventory([issue(4005)]), resolveDecision, new Map())).toThrow("Missing metadata");
    expect(() => projectMetadata(imported, read(), () => null, new Map())).toThrow("Unapproved");
    expect(() => projectMetadata(imported, inventory([issueWith(4001, { ...d1, blocking_gate: "D2" })]), resolveDecision, new Map()))
      .toThrow("Unapproved");
  });

  it("rejects a dependency cycle and cross-goal dependency or reassignment", () => {
    const cycle = { ...d1, depends_on: [4002] };
    expect(() => projectMetadata(imported, inventory([issueWith(4001, cycle), issueWith(4002, d2)]),
      decisions([[4001, cycle], [4002, d2]]), new Map())).toThrow("cycle");
    const foreign = { ...d2, goal_issue: 3901 };
    expect(() => projectMetadata(imported, inventory([issue(3901, "", "closed"), issueWith(4001, d1), issueWith(4002, foreign)]),
      decisions([[4001, d1], [4002, foreign]]), new Map())).toThrow("Unapproved dependency");
    const moved = { ...d1, goal_issue: 3901, revision: 2 };
    expect(() => projectMetadata(imported, inventory([issue(3901, "", "closed"), issueWith(4001, { ...moved, revision: 1 })]),
      decisions([[4001, { ...moved, revision: 1 }]]), new Map([[4001, d1]]))).toThrow("Previously admitted");
  });

  it("requires reviewed reconciliation of changed bodies and preserves new closed obligations on rollback", () => {
    const exported = inventory([issue(4001)]);
    const current = inventory([issueWith(4001, d1)]);
    const cutover = { direction: "cutover", imported, exported, current, admitted: new Map(), resolveDecision,
      verifyFreeze: () => true };
    expect(() => transitionMetadata({ ...cutover, verifyFreeze: () => false })).toThrow("freeze");
    expect(() => transitionMetadata(cutover)).toThrow("Unreconciled edit");
    exported.get(4001).reconciled_body_sha256 = current.get(4001).body_sha256;
    expect(transitionMetadata(cutover).authority).toBe("issue_metadata");
    const rollback = { ...cutover, direction: "rollback", exported: current, current: read(),
      admitted: new Map([[4001, d1], [4002, d2]]) };
    const result = transitionMetadata(rollback);
    expect(result.authority).toBe("legacy_register");
    expect(result.registry.issues.slice(-2)).toMatchObject([
      { issue_number: 4001, blocking_gate: "D1_U1", depends_on: [120], spec_requirement_ids: ["PFA-UX-015"] },
      { issue_number: 4002, blocking_gate: "D2", depends_on: [146, 4001], spec_requirement_ids: ["PFA-DET-023"] },
    ]);
    expect(result.registry.closed_consolidations).toEqual(register.closed_consolidations);
    rollback.current.set(4002, inventory([issue(4002, "", "closed")]).get(4002));
    expect(() => transitionMetadata(rollback)).toThrow("Previously admitted");
  });
});

describe("bounded offline migration", () => {
  it("resumes after a lost acknowledgement, preserving original bytes and requiring the same plan", async () => {
    const original = issue(4001, "PFM_TASK_V3\r\nOriginal text\r\n");
    const other = issue(4002);
    const live = new Map([[original.number, original], [other.number, other]]);
    const records = new Map([[4001, record(4001)], [4002, record(4002, "D2")]]);
    const journal = planMigrationBatch(observeInventory([...live.values()], repository), records, repository);
    let lost = true;
    const writes: number[] = [];
    const adapter = {
      verifyWriter: () => true,
      read: (number: number) => live.get(number),
      compareAndWrite: ({ number, before, body }: { number: number; before: string; body: string }) => {
        const value = live.get(number)!;
        if (bodyDigest(value.body) !== before) return false;
        live.set(number, { ...value, body });
        writes.push(number);
        if (lost) {
          lost = false;
          throw new Error("Simulated acknowledgement loss");
        }
        return true;
      },
    };
    const input = { journal, records, repository, writer: "test-fence", adapter };
    await expect(resumeMigrationBatch(input)).rejects.toThrow("acknowledgement loss");
    await resumeMigrationBatch(input);
    expect(writes).toEqual([4001, 4002]);
    expect(live.get(4001)!.body.startsWith(original.body)).toBe(true);
    const before = live.get(4001)!;
    const wrapped = { ...before, body: before.body + "\r\nTrailing unrelated bytes" };
    const revised = metadataBody(wrapped, repository, { ...records.get(4001)!, revision: 2 });
    expect(revised.startsWith(original.body)).toBe(true);
    expect(revised.endsWith("\r\nTrailing unrelated bytes")).toBe(true);
    expect(parseIssueMetadata({ ...wrapped, body: revised }, repository).metadata.revision).toBe(2);
  });

  it("denies lost permission, an active grant, changed readback and a concurrent unrelated edit", async () => {
    const original = issue(4001);
    const records = new Map([[4001, record(4001)]]);
    const journal = planMigrationBatch(observeInventory([original], repository), records, repository);
    const input = { journal, records, repository, writer: "test-fence" };
    const adapter = { read: () => original, verifyWriter: () => true, compareAndWrite: () => false };
    await expect(resumeMigrationBatch({ ...input, adapter: { ...adapter, verifyWriter: () => false } })).rejects.toThrow("writer denied");
    await expect(resumeMigrationBatch({ ...input, adapter })).rejects.toThrow("active grant");
    await expect(resumeMigrationBatch({ ...input, adapter: { ...adapter, compareAndWrite: () => true } })).rejects.toThrow("readback conflict");
    await expect(resumeMigrationBatch({ ...input, adapter: { ...adapter, read: () => ({ ...original, body: "Concurrent edit" }) } }))
      .rejects.toThrow("Concurrent body edit");
  });
});

describe("read-only issue pagination", () => {
  it("reads every page and fails on denied reads, partial pages, missing links and duplicate rows", async () => {
    const first = Array.from({ length: 50 }, (_, index) => issue(index + 1));
    const link = `<https://api.github.com/repos/${repository}/issues?state=all&sort=created&direction=asc&per_page=50&page=2>; rel="next"`;
    const pages = (final: ReturnType<typeof issue>[], status = 200) =>
      (url: string, options: RequestInit) => {
        expect(options.method).toBe("GET");
        expect(options.redirect).toBe("error");
        return new URL(url).searchParams.get("page") === "1"
          ? Response.json(first, { headers: { link } }) : Response.json(final, { status });
      };
    expect((await readIssueInventory({ token: "read-only-test", request: pages([issue(51)]) })).size).toBe(51);
    await expect(readIssueInventory({ token: "read-only-test", request: pages([], 403) })).rejects.toThrow("HTTP 403");
    await expect(readIssueInventory({ token: "read-only-test", request: pages([issue(50)]) })).rejects.toThrow("duplicate");
    await expect(readIssueInventory({ token: "read-only-test", request: () => Response.json(first) })).rejects.toThrow("no pagination proof");
    await expect(readIssueInventory({ token: "read-only-test", request: () => Response.json([], { headers: { link } }) }))
      .rejects.toThrow("Incomplete issue pagination");
  });
});
