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
const providerShape = JSON.parse(raw("test/fixtures/goalFramework/evidence/ordinary-pr.json").toString("utf8")) as {
  skipped_matrix_name: string; checkout_step: string[]; timeout: string; assertion: string;
};
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const repo = "bensmullen/personal-finance-app";
const branch = "codex/fixture-evidence";
const issueBody = [
  "PFM_TASK_V3", "TASK_KIND: framework", "TARGET_BRANCH: " + branch, "DEPENDENCY_POLICY: locked",
  "ALLOWED_PATHS:", "- tools/ci/goal-framework-evidence.mjs", "OBJECTIVE:", "Synthetic fixture",
  "ACCEPTANCE:", "Exact evidence fixture",
].join("\n");
const goalBody = "Synthetic goal authority";
const base = "1".repeat(40), head = "2".repeat(40), merge = "3".repeat(40);
const now = Date.parse("2026-01-02T00:00:00Z");
const registry = "docs/development/goal-framework/households.json";
const spec = "e2e/framework-household-readiness.spec.ts";
const workflow = { id: 19, path: ".github/workflows/engineering-validation.yml",
  digest: hash(raw(".github/workflows/engineering-validation.yml")), ref: "refs/heads/review/merge-candidate" };
const ordinary = { id: 20, path: ".github/workflows/test.yml", digest: hash(raw(".github/workflows/test.yml")) };
const registryData = JSON.parse(raw(registry).toString("utf8")) as {
  applicable: { id: string; evidence: { path: string; oracle: string; fixtures: string[]; cases: string[] }[] }[];
};
const pins = [...new Set([
  "package-lock.json", "playwright.config.ts", "tools/ci/verification-plan.mjs",
  "tools/ci/plan-test-shards.mjs", "tools/ci/collect-test-durations.mjs",
  "tools/codex/quiet-playwright.mjs", "tools/codex/quiet-vitest.mjs", registry, spec,
  "test/fixtures/goalFramework/households/guided.json", "test/d2/integrated/jointHousehold/s8Five/oracle.ts",
  ...registryData.applicable.flatMap(({ evidence }) => evidence.flatMap(({ path, oracle, fixtures }) => [path, oracle, ...fixtures])),
])].map((path) => ({ path, digest: hash(raw(path)) }));
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
const ordinaryJobs = ["verification-plan", "spec", "architecture", "codex-tooling", "typecheck", "build",
  "forecast-feasibility", "test", "deploy",
  ...[1, 2, 3].map((index) => `unit (shard ${index}/3)`),
  ...[1, 2, 3, 4].map((index) => `e2e (shard ${index}/4)`)];
const ordinaryPlan = ordinaryJobs.map((job, index) => {
  const shard = /^(unit|e2e) \(shard (\d)/.exec(job);
  const required = job !== "deploy";
  return { id: "ordinary-" + index, workflow: ordinary.id, job, required, artifact_required: !!shard,
    selection: required ? "selected" : "excluded",
    ...(shard ? { artifact: shard[1] + "-diagnostics-" + shard[2] + "-" + merge } : {}) };
});
function ordinarySelection(browser = true, manual = false) {
  const selected = ordinaryPlan.map((check) => !browser && check.job.startsWith("e2e ") ?
    { id: check.id, workflow: ordinary.id, job: check.job, required: false, artifact_required: false, selection: "excluded" } :
    check);
  const entries = manual ? [...plan, ...selected] : selected;
  return { ...selection, plan: entries, workflows: manual ? [ordinary, workflow] : [ordinary],
    candidate: { ...selection.candidate, verification_plan_digest: digest(entries) } };
}
const verifyPlan = (expected: { task: typeof selection.task; candidate: typeof selection.candidate; plan: unknown[] }) =>
  (boundary: string, binding: Record<string, unknown>) => boundary === "live_selected_evidence_plan" &&
    digest(binding.task) === digest(expected.task) && digest(binding.candidate) === digest(expected.candidate) &&
    digest(binding.plan) === digest(expected.plan) && binding.target_branch === branch &&
    binding.goal_issue_body_digest === hash(Buffer.from(goalBody));

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

function browserReport(path: string, titles: string[], variant?: "flaky" | "empty") {
  const file = path.slice(4);
  return {
    config: { rootDir: "/other/host/e2e" }, errors: [],
    stats: { expected: titles.length - Number(variant === "flaky"), skipped: 0, unexpected: 0,
      flaky: Number(variant === "flaky") },
    suites: [{ title: file, specs: titles.map((title, index) => {
      const retry = variant === "flaky" && index === 0;
      const results = retry ? [{ retry: 0, status: "failed" }, { retry: 1, status: "passed" }] :
        [{ retry: 0, status: "passed" }];
      return { title, file, line: index + 1, column: 1,
        tests: [{ status: retry ? "flaky" : "expected", expectedStatus: "passed", results }] };
    }) }],
  };
}

const browserShards = [44, 44, 43, 43].map((count, shard) => {
  const path = shard === 0 ? "e2e/u1b-low-input-forecast.spec.ts" : `e2e/fixture-${shard}.spec.ts`;
  const titles = Array.from({ length: count }, (_, i) => "synthetic browser case " + (i + 1));
  return { path, titles, selected: titles.map((title, i) => ({ id: path + `:${i + 1}:1 › ` + title })) };
});
const browserIds = browserShards.flatMap(({ selected }) => selected.map(({ id }) => id)).sort();

function archive(attempt: number, variant?: "flaky" | "empty", wrongInventory = false) {
  const titles = variant === "empty" ? [] : registryData.applicable
    .flatMap(({ evidence }) => evidence.filter(({ path }) => path === spec).flatMap(({ cases }) => cases));
  const cases = [...new Set(titles)];
  const contents: Record<string, string> = {
    "inventory.json": JSON.stringify({ sha: merge, attempt, ref: workflow.ref, run_id: 23,
      ordinary_count: browserIds.length, ux_count: 175,
      ordinary_digest: wrongInventory ? "9".repeat(64) : hash(Buffer.from(JSON.stringify(browserIds))), ux_digest: "1".repeat(64),
      manual: cases.map((title, index) => spec + `:${index + 1}:1 › ` + title) }),
    "report.json": JSON.stringify(browserReport(spec, cases, variant)),
  };
  return zip(files.map((name) => ({ name, data: contents[name] ?? "{}" })));
}

function shardArchive(kind: string, index: number, failure?: "timeout" | "assertion" | "ambiguous", wrongSha = false) {
  const count = kind === "unit" ? 3 : 4;
  const title = "synthetic test case";
  const shards = kind === "unit" ? Array.from({ length: count }, (_, i) =>
    [{ id: `test/fixture-${i}.test.ts` }]) : browserShards.map(({ selected }) => selected);
  const path = shards[index - 1]![0]!.id.split(":")[0]!;
  const status = failure ? "failed" : "passed";
  const report = kind === "unit" ? {
    success: !failure, numTotalTests: 1, numFailedTests: Number(!!failure),
    testResults: [{ name: "/home/runner/work/personal-finance-app/personal-finance-app/" + path, status,
      assertionResults: [{ title, fullName: title, ancestorTitles: [], status, failureMessages: failure ? ["STACK_TRACE_ERROR"] : [] }] }],
  } : browserReport(path, browserShards[index - 1]!.titles);
  const log = failure && failure !== "ambiguous" ?
    `⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯\n FAIL  ${path} > ${title}\n${providerShape[failure]}\n` : "";
  return zip([
    { name: "assignment.json", data: JSON.stringify({ schema: 1, sha: merge, kind, count, shards, inventory: shards.flat() }) },
    { name: "execution.json", data: JSON.stringify({ schema: 1, sha: wrongSha ? head : merge, kind,
      runAttempt: "1", status, reportValid: !failure, exit: Number(!!failure), signal: null, context: null }) },
    { name: "report.json", data: JSON.stringify(report) }, { name: "runner.log", data: log },
  ]);
}

function provider(options: {
  conclusions?: string[]; forgedApp?: boolean; expired?: boolean; stale?: boolean; missing?: boolean;
  tamper?: boolean; variant?: "flaky" | "empty";
  ordinary?: boolean; noBrowser?: boolean; wrongAssociation?: boolean; wrongCheckout?: boolean;
  forgedCheckHead?: boolean; wrongAttempt?: boolean; wrongShard?: boolean; wrongBranch?: boolean;
  changedGoal?: boolean; omitAggregateProof?: boolean; duplicateCheckout?: boolean; workerCheckout?: boolean;
  wrongBrowserInventory?: boolean;
  unitFailure?: "timeout" | "assertion" | "ambiguous"; ordinaryOutcome?: string; ordinaryAttempts?: number;
} = {}) {
  const conclusions = options.conclusions ?? ["success"];
  const repoData = { id: 99, full_name: repo };
  const run = (number: number) => ({
    id: 23, workflow_id: workflow.id, path: workflow.path, event: "workflow_dispatch", head_sha: merge,
    head_branch: "review/merge-candidate",
    display_title: "engineering-validation / household-readiness",
    repository: repoData, head_repository: repoData, check_suite_id: 17, run_attempt: number,
    status: "completed", conclusion: conclusions[number - 1],
  });
  const step = (name: string, number: number) => ({
    name, number, status: "completed", conclusion: "success",
    started_at: "2026-01-01T00:00:02Z", completed_at: "2026-01-01T00:00:03Z",
  });
  const job = (id: number, runId: number, attempt: number, name: string, conclusion?: string) => ({
    id, run_id: runId, run_attempt: attempt, head_sha: runId === 23 ? merge : head, name,
    check_run_url: "https://api.github.com/repos/" + repo + "/check-runs/" + (1000 + id),
    status: "completed", conclusion,
    steps: conclusion === "skipped" ? [] : name === "test" ? [
      step("Require every selected gate", 2), step("Checkout shard evidence verifier", 3),
      ...(options.omitAggregateProof ? [] : [step("Require exact-head successful receipts from every selected child", 6)]),
    ] : [step("Run actions/checkout@v4", 2)],
  });
  const ordinaryRun = (number: number) => ({
    id: 24, workflow_id: ordinary.id, path: ordinary.path, event: "pull_request", head_sha: head, head_branch: branch,
    pull_requests: [{ number: 51, head: { sha: head, ref: branch, repo: repoData },
      base: { sha: options.wrongAssociation ? head : base, ref: "main", repo: repoData } }],
    repository: repoData, head_repository: repoData, check_suite_id: 18, run_attempt: number,
    status: "completed", conclusion: (options.unitFailure || options.ordinaryOutcome) && number === 1 ? "failure" : "success",
  });
  const rounds = options.ordinaryAttempts ?? 1;
  const jobs = ordinaryJobs.filter((name) => !options.noBrowser || !name.startsWith("e2e "));
  if (options.noBrowser) jobs.push(providerShape.skipped_matrix_name);
  const perAttempt = Array.from({ length: rounds }, (_, round) => jobs.map((name, index) => {
    let conclusion = "success";
    if (name === "deploy" || name === providerShape.skipped_matrix_name) conclusion = "skipped";
    if (round === 0 && name === "unit (shard 2/3)" && options.unitFailure) conclusion = "failure";
    if (round === 0 && name === "typecheck" && options.ordinaryOutcome) conclusion = options.ordinaryOutcome;
    return job(400 + round * 30 + index, 24, options.wrongAttempt ? round + 2 : round + 1, name, conclusion);
  }));
  const manualJobs = conclusions.map((conclusion, i) => job(101 + i, 23, i + 1, "household-readiness", conclusion));
  const archives = conclusions.map((_, i) => archive(i + 1, options.variant, options.wrongBrowserInventory));
  const shardArtifacts = ordinaryPlan.flatMap(({ job: name, artifact }) => {
    const shard = /^(unit|e2e) \(shard (\d)/.exec(name);
    if (!shard || !artifact || (shard[1] === "e2e" && options.noBrowser)) return [];
    const failure = name === "unit (shard 2/3)" ? options.unitFailure : undefined;
    return [{ name: artifact, data: shardArchive(shard[1]!, Number(shard[2]), failure, options.wrongShard) }];
  });
  const artifact = (id: number, name: string, data: Buffer, runId: number) => ({
    id, name, size_in_bytes: data.length, digest: "sha256:" + hash(data), expired: options.expired ?? false,
    created_at: "2026-01-01T00:00:00Z", expires_at: "2026-01-07T00:00:00Z",
    workflow_run: { id: runId, repository_id: 99, head_repository_id: 99, head_sha: runId === 23 ? merge : head },
  });
  return {
    async json(route: string) {
      if (route === "/pulls/51") return {
        number: 51, state: "open", merge_commit_sha: options.stale ? head : merge,
        head: { sha: head, ref: options.wrongBranch ? "codex/other" : branch, repo: repoData },
        base: { ref: "main", sha: base, repo: repoData },
      };
      if (route === "/commits/" + merge) return { sha: merge, parents: [{ sha: base }, { sha: head }] };
      if (route === "/issues/362") return { number: 362, state: "open", body: options.changedGoal ? "Changed goal" : goalBody };
      if (route === "/issues/366") return { number: 366, state: "open", body: issueBody };
      if (route.startsWith("/contents/")) {
        const path = route.slice(10).split("?")[0]!;
        const contents = raw(path);
        return { type: "file", path, size: contents.length, content: contents.toString("base64"), encoding: "base64" };
      }
      if (route === "/actions/workflows/19") return workflow;
      if (route === "/actions/workflows/20") return ordinary;
      if (route === "/actions/runs/23") return run(conclusions.length);
      if (route === "/actions/runs/24") return ordinaryRun(rounds);
      if (route.startsWith("/actions/runs/23/attempts/")) return run(Number(route.split("/").at(-1)));
      if (route.startsWith("/actions/runs/24/attempts/")) return ordinaryRun(Number(route.split("/").at(-1)));
      if (route.startsWith("/check-runs/")) {
        const id = Number(route.split("/").at(-1));
        const observed = [...manualJobs, ...perAttempt.flat()].find((job) => job.id === id - 1000)!;
        return { ...observed, id, head_sha: options.forgedCheckHead ? merge : observed.head_sha,
          details_url: "https://github.com/" + repo + "/actions/runs/" + observed.run_id + "/job/" + observed.id,
          check_suite: { id: observed.run_id === 23 ? 17 : 18 },
          app: { id: options.forgedApp ? 999 : 15368, slug: "github-actions" } };
      }
      throw new Error("Unexpected fixture endpoint " + route);
    },
    async list(route: string, field: string) {
      if (field === "workflow_runs") return route.includes("/20/") ?
        options.ordinary ? [ordinaryRun(rounds)] : [] : [run(conclusions.length)];
      if (field === "jobs") {
        const attempt = Number(route.split("/").at(-2));
        return options.missing ? [] : route.includes("/24/") ? perAttempt[attempt - 1]! : [manualJobs[attempt - 1]!];
      }
      if (field === "artifacts") return route.includes("/24/") ?
        shardArtifacts.map(({ name, data }, i) => artifact(500 + i, name, data, 24)) :
        archives.map((data, i) => artifact(300 + i, "household-readiness-23-" + (i + 1), data, 23));
      throw new Error("Unexpected fixture list " + route);
    },
    async download(id: number) {
      return options.tamper ? Buffer.from("tampered") : id >= 500 ? shardArtifacts[id - 500]!.data : archives[id - 300]!;
    },
    async jobLog(id: number) {
      const name = perAttempt.flat().find((job) => job.id === id)?.name;
      const lines = providerShape.checkout_step.map((line) => line.replace("{checkout}", options.wrongCheckout ? head : merge));
      if (options.duplicateCheckout) lines.splice(1, 0, lines[0]!);
      if (options.workerCheckout) lines.unshift("2026-01-01T00:00:02.0000000Z ##[group]Run node untrusted-worker");
      if (name === "test") lines.unshift('2026-01-01T00:00:01.0001000Z ##[group]Run test "$PLAN" = success');
      return Buffer.from(lines.join("\n") + "\n");
    },
  };
}

it("binds a positive provider observation while household gaps and absent reviews keep UAT pending", async () => {
  const input = ordinarySelection(true, true);
  const result = await collectGoalEvidence(input, provider({ ordinary: true }), now, verifyPlan(input));
  expect(result.complete).toBe(true);
  expect(verificationDraft(result)).toMatchObject({ schema: "VERIFICATION_EVIDENCE_V1", disposition: "pending" });
  expect(result.checks.slice(0, 3).map((check: { outcome: string }) => check.outcome))
    .toEqual(["PASS", "NOT_APPLICABLE", "NOT_APPLICABLE"]);
  expect(result.runs.find((run: { id: number }) => run.id === 24).attempts[0].jobs
    .filter((job: { artifact?: unknown }) => job.artifact)).toHaveLength(7);
  const readiness = householdReadiness({ collection: result, registryBytes: raw(registry), now });
  expect(readiness.disposition).toBe("NOT_READY");
  expect(readiness.browser_artifact.id).toBe("github-artifact:300");
  expect(readiness.captures.map((file: { name: string }) => file.name)).toContain("guided-trace.zip");
  expect(readiness.blockers).toContain("APPLICABLE_TEST_EVIDENCE_MISSING");
  expect(readiness.applicable.find((item: { id: string }) => item.id === "zero-income").missing_evidence).toEqual([]);
  expect(readiness.applicable.find((item: { id: string }) => item.id === "flagship").missing_evidence[0])
    .toMatchObject({ path: "e2e/u1b-low-input-forecast.spec.ts", title: expect.stringContaining("retirement-planning") });
  expect(readiness.review).toEqual({ semantic: "pending", visual: "pending" });
});

it("authenticates the ordinary source head and separate checkout, including a skipped matrix gate", async () => {
  const input = ordinarySelection(false);
  const result = await collectGoalEvidence(input, provider({ ordinary: true, noBrowser: true }), now, verifyPlan(input));
  expect(result.complete).toBe(true);
  expect(result.runs[0].attempts[0].jobs).toEqual(expect.arrayContaining([
    expect.objectContaining({ matrix: "e2e", outcome: "SKIP", check_run_id: expect.any(Number) }),
    expect.objectContaining({ outcome: "PASS", checkout: { sha: merge, step: 3, log_digest: expect.any(String) } }),
  ]));
  expect(result.checks.slice(-4).map((check: { outcome: string }) => check.outcome))
    .toEqual(Array.from({ length: 4 }, () => "NOT_APPLICABLE"));
});

it("refuses a manual discovery digest that disagrees with the exact ordinary assignments", async () => {
  const input = ordinarySelection(true, true);
  const result = await collectGoalEvidence(input, provider({ ordinary: true, wrongBrowserInventory: true }), now, verifyPlan(input));
  expect(result.complete).toBe(false);
  expect(result.issues).toContainEqual({ code: "BROWSER_DISCOVERY_ASSIGNMENT_MISMATCH" });
});

it.each(["wrongAssociation", "wrongCheckout", "forgedCheckHead", "wrongAttempt", "wrongShard", "wrongBranch",
  "changedGoal", "omitAggregateProof", "duplicateCheckout", "workerCheckout"] as const)
  ("refuses ordinary evidence with %s", async (key) => {
    const input = ordinarySelection();
    const result = await collectGoalEvidence(input, provider({ ordinary: true, [key]: true }), now, verifyPlan(input));
    expect(result.complete).toBe(false);
    expect(verificationDraft(result)).toBeNull();
  });

it("requires an independently approved plan and current control identity and rejects manual-only completion", async () => {
  const manual = await collectGoalEvidence(selection, provider(), now, verifyPlan(selection));
  expect(manual.checks[0].outcome).toBe("PASS");
  expect(manual.ordinary_complete).toBe(false);
  expect(manual.complete).toBe(false);
  const input = ordinarySelection();
  const excluded = ordinarySelection(false);
  const result = await collectGoalEvidence(excluded, provider({ ordinary: true, noBrowser: true }), now, verifyPlan(input));
  expect(result.issues).toContainEqual({ code: "UNVERIFIED_LIVE_EVIDENCE_PLAN" });
  const stale = { ...input, task: { ...input.task, task_revision: 2, goal_control_digest: "b".repeat(64) } };
  expect((await collectGoalEvidence(stale, provider({ ordinary: true }), now, verifyPlan(input))).complete).toBe(false);
  let live = true;
  const revoke = (boundary: string, binding: Record<string, unknown>) => {
    const authorized = live && verifyPlan(input)(boundary, binding);
    live = false;
    return authorized;
  };
  expect((await collectGoalEvidence(input, provider({ ordinary: true }), now, revoke)).complete).toBe(false);
});

it.each([
  ["timeout", "TIMEOUT", "TIMEOUT"], ["assertion", "FAIL", "FAIL"], ["ambiguous", "FAIL", "INCOMPLETE"],
] as const)("keeps ordinary %s failures and compact diagnostics", async (unitFailure, disposition, diagnostic) => {
  const input = ordinarySelection();
  const result = await collectGoalEvidence(input, provider({ ordinary: true, unitFailure }), now, verifyPlan(input));
  const job = result.runs[0].attempts[0].jobs.find((item: { check: string }) => item.check === "ordinary-10");
  expect(job.outcome).toBe(disposition);
  expect(job.artifact.failures).toEqual([{ attempt: 0, outcome: diagnostic, test_digest: expect.any(String) }]);
  expect(JSON.stringify(result)).not.toContain("60000ms");
  expect(result.complete).toBe(false);
});

it("refuses to assign legacy shard artifacts to historical attempts and retains provider failures", async () => {
  const input = ordinarySelection();
  const result = await collectGoalEvidence(input,
    provider({ ordinary: true, unitFailure: "assertion", ordinaryAttempts: 2 }), now, verifyPlan(input));
  expect(result.complete).toBe(false);
  expect(result.runs[0].attempts.map((item: { outcome: string }) => item.outcome)).toEqual(["FAIL", "PASS"]);
  expect(result.runs[0].attempts[0].jobs).toContainEqual(expect.objectContaining({
    outcome: "FAIL", artifact_issue: "ARTIFACT_ATTEMPT_UNKNOWN",
  }));
});

it.each([["skipped", "SKIP"], ["cancelled", "INCOMPLETE"]])("blocks a selected ordinary %s job", async (ordinaryOutcome, outcome) => {
  const input = ordinarySelection();
  const result = await collectGoalEvidence(input, provider({ ordinary: true, ordinaryOutcome }), now, verifyPlan(input));
  expect(result.complete).toBe(false);
  expect(result.checks[4].outcome).toBe(outcome);
});

it("requires fresh independent semantic and visual attestations of the complete evidence and case inventory", async () => {
  const input = ordinarySelection(true, true);
  const collection = await collectGoalEvidence(input, provider({ ordinary: true }), now, verifyPlan(input));
  const registryBytes = raw(registry);
  const draft = householdReadiness({ collection, registryBytes, now });
  const signed = { actor: "reviewer", session: "review-session", created_at: new Date(now).toISOString(),
    expires_at: "2026-01-03T00:00:00Z", households: registryData.applicable.map(({ id }) => id),
    disposition: "approved", collection_digest: draft.collection_digest, case_inventory_digest: draft.case_inventory_digest };
  const verify = (boundary: string, binding: { review: typeof signed }) =>
    boundary.startsWith("independent_") && binding.review === signed;
  const reviews = { semantic: signed, visual: signed };
  expect(householdReadiness({ collection, registryBytes, now, reviews, verify })).toMatchObject({
    disposition: "NOT_READY", review: { semantic: "approved", visual: "approved" },
  });
  expect(householdReadiness({ collection, registryBytes, now, reviews }).review.semantic).toBe("pending");
  expect(householdReadiness({ collection, registryBytes, now: Date.parse(signed.expires_at), reviews, verify })
    .review.visual).toBe("pending");
  const altered = structuredClone(collection);
  altered.runs[0].attempts[0].jobs[0].checkout.log_digest = "b".repeat(64);
  expect(householdReadiness({ collection: altered, registryBytes, now, reviews, verify }).review.visual).toBe("pending");
  const self = { ...signed, actor: selection.implementer.actor };
  expect(householdReadiness({ collection, registryBytes, now, reviews: { visual: self }, verify: () => true })
    .review.visual).toBe("pending");
  const beforeCollection = { ...signed, created_at: "2026-01-01T00:00:00Z" };
  expect(householdReadiness({ collection, registryBytes, now, reviews: { visual: beforeCollection }, verify: () => true })
    .review.visual).toBe("pending");
  expect(householdReadiness({ collection, registryBytes, now: Date.parse("2026-01-07T00:00:00Z"), reviews, verify })
    .blockers).toContain("COLLECTION_STALE_OR_EXPIRED");
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
  const shortened = ordinaryJobs.slice(0, -1).map((job, index) => {
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
