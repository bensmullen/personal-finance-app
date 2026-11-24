import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { crc32 } from "node:zlib";
import { expect, it } from "vitest";

const {
  browserInventory, collectGoalEvidence, githubEvidenceProvider, householdReadiness, inspectEvidenceZip, parseEvidenceJson,
  verificationDraft,
} = await import(new URL("../tools/ci/goal-framework-evidence.mjs", import.meta.url).href);
const { digest } = await import(new URL("../tools/codex/goal-framework/contracts.mjs", import.meta.url).href);
const refusals = JSON.parse(readFileSync(new URL("./fixtures/goalFramework/evidence/refusals.json", import.meta.url), "utf8")) as {
  unsafe_zip_paths: string[];
  provider_outcomes: { conclusion: string; outcome: string }[];
};
const raw = (path: string) => readFileSync(new URL("../" + path, import.meta.url));
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const repo = "bensmullen/personal-finance-app";
const issueBody = "PFM_TASK_V3\nSynthetic evidence test authorization";
const base = "1".repeat(40), head = "2".repeat(40), merge = "3".repeat(40);
const now = Date.parse("2026-01-02T00:00:00Z");
const registry = "docs/development/goal-framework/households.json";
const spec = "e2e/framework-household-readiness.spec.ts";
const workflow = { id: 19, path: ".github/workflows/engineering-validation.yml",
  digest: hash(raw(".github/workflows/engineering-validation.yml")) };
const pins = [
  "package-lock.json", "playwright.config.ts", "tools/ci/verification-plan.mjs",
  "tools/ci/plan-test-shards.mjs", "tools/ci/collect-test-durations.mjs",
  "tools/codex/quiet-playwright.mjs", "tools/codex/quiet-vitest.mjs", registry, spec,
  "test/fixtures/goalFramework/households/guided.json", "test/d2/integrated/jointHousehold/s8Five/oracle.ts",
].map((path) => ({ path, digest: hash(raw(path)) }));
const files = ["inventory.json", "report.json", "resources.json", "resources.txt", "guided-desktop.png",
  "guided-mobile-200.png", "guided-trace.zip"];
const plan = [
  { id: "household-readiness", workflow: workflow.id, job: "household-readiness", required: true,
    artifact_required: true, selection: "selected", artifact: "household-readiness-{run}-{attempt}", files },
  ...["validate", "agent-incident"].map((job) =>
    ({ id: job, workflow: workflow.id, job, required: false, artifact_required: false, selection: "excluded" })),
];
const selection = {
  task: { repository: repo, goal_issue: 362, goal_revision: 1, task_issue: 366, task_revision: 1,
    goal_control_digest: "a".repeat(64), issue_body_digest: hash(Buffer.from(issueBody)) },
  candidate: { pr: 51, head_sha: head, base_sha: base, merge_candidate_sha: merge, verification_plan_digest: digest(plan) },
  implementer: { actor: "writer", session: "writer-session" }, plan, workflows: [workflow], inputs: pins,
};

function zip(entries: { name: string; data?: string; type?: number }[]) {
  const local = [], central = [];
  let offset = 0, directorySize = 0;
  for (const { name, data = "{}", type = 0x8000 } of entries) {
    const filename = Buffer.from(name), bytes = Buffer.from(data);
    const checksum = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(bytes.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, bytes);
    const item = Buffer.alloc(46);
    item.writeUInt32LE(0x02014b50);
    item.writeUInt32LE(checksum, 16);
    item.writeUInt32LE(bytes.length, 20);
    item.writeUInt32LE(bytes.length, 24);
    item.writeUInt16LE(filename.length, 28);
    item.writeUInt16LE(type, 40);
    item.writeUInt32LE(offset, 42);
    offset += header.length + filename.length + bytes.length;
    directorySize += item.length + filename.length;
    central.push(item, filename);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directorySize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

function archive(attempt: number, variant?: "flaky" | "empty") {
  const id = spec + ":1:1 › guided trial";
  const results = variant === "flaky" ? [{ retry: 0, status: "failed" }, { retry: 1, status: "passed" }] :
    [{ retry: 0, status: "passed" }];
  const report = {
    config: { rootDir: "/other/host/e2e" }, errors: [],
    stats: { expected: variant ? 0 : 1, skipped: 0, unexpected: 0, flaky: variant === "flaky" ? 1 : 0 },
    suites: variant === "empty" ? [] : [{ title: "framework-household-readiness.spec.ts", specs: [{
      title: "guided trial", file: "framework-household-readiness.spec.ts", line: 1, column: 1,
      tests: [{ status: variant === "flaky" ? "flaky" : "expected", expectedStatus: "passed", results }],
    }] }],
  };
  const contents: Record<string, string> = {
    "inventory.json": JSON.stringify({ sha: merge, attempt, manual: variant === "empty" ? [] : [id] }),
    "report.json": JSON.stringify(report),
  };
  return zip(files.map((name) => ({ name, data: contents[name] ?? "{}" })));
}

function provider(options: {
  conclusions?: string[]; forgedApp?: boolean; expired?: boolean; stale?: boolean; missing?: boolean;
  tamper?: boolean; variant?: "flaky" | "empty";
} = {}) {
  const conclusions = options.conclusions ?? ["success"];
  const repoData = { id: 99, full_name: repo };
  const run = (number: number) => ({
    id: 23, workflow_id: workflow.id, path: workflow.path, event: "workflow_dispatch", head_sha: merge,
    display_title: "engineering-validation / household-readiness",
    repository: repoData, head_repository: repoData, check_suite_id: 17, run_attempt: number,
    status: "completed", conclusion: conclusions[number - 1],
  });
  const job = (number: number) => ({
    id: 100 + number, run_id: 23, run_attempt: number, head_sha: merge, name: "household-readiness",
    check_run_url: "https://api.github.com/repos/" + repo + "/check-runs/" + (200 + number),
    status: "completed", conclusion: conclusions[number - 1], steps: [],
  });
  const archives = conclusions.map((_, i) => archive(i + 1, options.variant));
  return {
    async json(route: string) {
      if (route === "/pulls/51") return {
        number: 51, state: "open", merge_commit_sha: options.stale ? head : merge,
        head: { sha: head, repo: repoData }, base: { ref: "main", sha: base, repo: repoData },
      };
      if (route === "/commits/" + merge) return { sha: merge, parents: [{ sha: base }, { sha: head }] };
      if (route === "/issues/362") return { number: 362, state: "open" };
      if (route === "/issues/366") return { number: 366, state: "open", body: issueBody };
      if (route.startsWith("/contents/")) {
        const path = route.slice(10).split("?")[0]!;
        const contents = raw(path);
        return { type: "file", path, size: contents.length, content: contents.toString("base64"), encoding: "base64" };
      }
      if (route === "/actions/workflows/19") return workflow;
      if (route === "/actions/runs/23") return run(conclusions.length);
      if (route.startsWith("/actions/runs/23/attempts/")) return run(Number(route.split("/").at(-1)));
      if (route.startsWith("/check-runs/")) {
        const id = Number(route.split("/").at(-1));
        return { ...job(id - 200), id, check_suite: { id: 17 }, app: { id: options.forgedApp ? 999 : 15368, slug: "github-actions" } };
      }
      throw new Error("Unexpected fixture endpoint " + route);
    },
    async list(route: string, field: string) {
      if (field === "workflow_runs") return [run(conclusions.length)];
      if (field === "jobs") return options.missing ? [] : [job(Number(route.split("/").at(-2)))];
      if (field === "artifacts") return archives.map((data, i) => ({
        id: 300 + i, name: "household-readiness-23-" + (i + 1), size_in_bytes: data.length,
        digest: "sha256:" + hash(data), expired: options.expired ?? false,
        created_at: "2026-01-01T00:00:00Z", expires_at: "2026-01-07T00:00:00Z",
        workflow_run: { id: 23, repository_id: 99, head_repository_id: 99, head_sha: merge },
      }));
      throw new Error("Unexpected fixture list " + route);
    },
    async download(id: number) { return options.tamper ? Buffer.from("tampered") : archives[id - 300]!; },
  };
}

it("binds a positive provider observation while household gaps and absent reviews keep UAT pending", async () => {
  const result = await collectGoalEvidence(selection, provider(), now);
  expect(result.complete).toBe(true);
  expect(verificationDraft(result)).toMatchObject({ schema: "VERIFICATION_EVIDENCE_V1", disposition: "pending" });
  expect(result.checks.map((check: { outcome: string }) => check.outcome)).toEqual(["PASS", "NOT_APPLICABLE", "NOT_APPLICABLE"]);
  const readiness = householdReadiness({ collection: result, registryBytes: raw(registry) });
  expect(readiness.disposition).toBe("NOT_READY");
  expect(readiness.browser_artifact.id).toBe("github-artifact:300");
  expect(readiness.captures.map((file: { name: string }) => file.name)).toContain("guided-trace.zip");
  expect(readiness.blockers).toContain("APPLICABLE_TEST_EVIDENCE_MISSING");
  expect(readiness.review).toEqual({ semantic: "pending", visual: "pending" });
});

it.each(refusals.provider_outcomes)("preserves a selected $conclusion outcome", async ({ conclusion, outcome }) => {
  const result = await collectGoalEvidence(selection, provider({ conclusions: [conclusion] }), now);
  expect(result.complete).toBe(false);
  expect(result.checks[0].outcome).toBe(outcome);
});

it("retains every failed run attempt and an internal browser retry after a later green", async () => {
  const rerun = await collectGoalEvidence(selection, provider({ conclusions: ["failure", "timed_out", "success"] }), now);
  expect(rerun.complete).toBe(false);
  expect(rerun.runs[0].attempts.map((item: { outcome: string }) => item.outcome)).toEqual(["FAIL", "TIMEOUT", "PASS"]);
  const flaky = await collectGoalEvidence(selection, provider({ variant: "flaky" }), now);
  expect(flaky.complete).toBe(false);
  expect(flaky.runs[0].attempts[0].jobs[0].artifact.failures).toMatchObject([{ attempt: 0, outcome: "FAIL" }]);
});

it.each(["forgedApp", "missing", "expired", "stale", "tamper"] as const)("refuses %s evidence", async (key) => {
  const result = await collectGoalEvidence(selection, provider({ [key]: true }), now);
  expect(result.complete).toBe(false);
  expect(result.checks[0].outcome).toBe("INCOMPLETE");
});

it("refuses zero discovered tests and a mismatched verification plan", async () => {
  const empty = await collectGoalEvidence(selection, provider({ variant: "empty" }), now);
  expect(empty.complete).toBe(false);
  await expect(collectGoalEvidence({ ...selection, plan: plan.slice(1) }, provider(), now)).rejects.toThrow("PLAN_INVENTORY");
});

it("rejects an ordinary plan that quietly omits a shard from its authoritative inventory", async () => {
  const ordinary = { ...workflow, path: ".github/workflows/test.yml", digest: hash(raw(".github/workflows/test.yml")) };
  const names = ["verification-plan", "spec", "architecture", "codex-tooling", "typecheck", "build",
    "forecast-feasibility", "test", "deploy",
    ...[1, 2, 3].map((index) => `unit (shard ${index}/3)`),
    ...[1, 2, 3].map((index) => `e2e (shard ${index}/4)`)];
  const shortened = names.map((job, index) => {
    const required = ["verification-plan", "test"].includes(job);
    return { id: "ordinary-" + index, job, workflow: ordinary.id, required, artifact_required: false,
      selection: required ? "selected" : "excluded" };
  });
  await expect(collectGoalEvidence({ ...selection, workflows: [ordinary], plan: shortened,
    candidate: { ...selection.candidate, verification_plan_digest: digest(shortened) } }, provider(), now))
    .rejects.toThrow("WORKFLOW_JOB_INVENTORY");
});

it("rejects unsafe, duplicate, link, oversized and ambiguous archive data offline", () => {
  for (const name of refusals.unsafe_zip_paths) expect(() => inspectEvidenceZip(zip([{ name }]))).toThrow("ZIP_PATH");
  expect(() => inspectEvidenceZip(zip([{ name: "a.json" }, { name: "A.json" }]))).toThrow("ZIP_PATH");
  expect(() => inspectEvidenceZip(zip([{ name: "link", type: 0xa000 }]))).toThrow("ZIP_FILE_TYPE");
  expect(() => inspectEvidenceZip(zip([{ name: "too-big" }]), 1)).toThrow("ZIP_UNPACKED_LIMIT");
  expect(() => parseEvidenceJson(Buffer.from('{"outcome":1,"outc\\u006fme":2}'))).toThrow("DUPLICATE_JSON_KEY");
  expect(() => inspectEvidenceZip(zip([{ name: "a.json", data: '{"a":1,"a":2}' }]))).toThrow("DUPLICATE_JSON_KEY");
});

it("keeps the token on the API request and rejects untrusted origins and excess bytes", async () => {
  const calls: { url: string; authorization: string | null }[] = [];
  const fetcher = async (url: string | URL, options: RequestInit) => {
    calls.push({ url: String(url), authorization: new Headers(options.headers).get("authorization") });
    return calls.length === 1
      ? new Response(null, { status: 302, headers: { location: "https://productionresultssa7.blob.core.windows.net/fixture" } })
      : new Response("{}", { headers: { "content-length": String(17 * 1024 ** 2) } });
  };
  await expect(githubEvidenceProvider("fixture-token", fetcher).download(5)).rejects.toThrow("DOWNLOAD_LIMIT");
  expect(calls.map(({ authorization }) => authorization)).toEqual(["Bearer fixture-token", null]);
  const redirect = () => Promise.resolve(new Response(null, { status: 302, headers: { location: "https://example.com/fixture" } }));
  await expect(githubEvidenceProvider("fixture-token", redirect).download(5)).rejects.toThrow("ARTIFACT_ORIGIN");
});

it("checks both manual exclusions without changing ordinary Playwright identities", () => {
  const ordinary = [{ id: "e2e/app.spec.ts:1:1 › ordinary" }];
  const manual = [{ id: spec + ":1:1 › manual" }];
  const ux = [...ordinary, { id: "e2e/ux-evidence.spec.ts:1:1 › ux" }];
  expect(browserInventory(ordinary, manual, ux)).toMatchObject({ ordinary_count: 1, ux_count: 2, manual: [manual[0]!.id] });
  expect(() => browserInventory([...ordinary, ...manual], manual, ux)).toThrow("BROWSER_INVENTORY_ROUTING");
  expect(() => browserInventory(ordinary, [], ux)).toThrow("EMPTY_BROWSER_INVENTORY");
  expect(() => browserInventory(ordinary, manual, ux.slice(1))).toThrow("BROWSER_INVENTORY_ROUTING");
});
