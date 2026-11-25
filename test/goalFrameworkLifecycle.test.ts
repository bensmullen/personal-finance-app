import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const load = (name: string) => import(new URL(`../tools/codex/goal-framework/${name}.mjs`, import.meta.url).href);
const { canonicalJson, digest, goalControlDigest, inspectV3Body } = await load("contracts");
const { censusBoundaries } = await load("schemas/v1");
const { levelOneBody, pinnedV3Parser, sha256 } = await load("authorization");
const { openLifecycle } = await load("lifecycle");
const { inspectWorkspace, resolveScopedPaths } = await load("workspace");

const repository = "fixture/pfm";
const origin = "https://github.com/fixture/pfm.git";
const branch = "codex/lifecycle";
const head = "a".repeat(40);
const nextHead = "b".repeat(40);
const ref = (id: string) => ({ id, digest: digest(id) });
const recordRef = (record: { id: string }) => ({ id: record.id, digest: digest(record) });
const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes)).toISOString();
const worker = "local-turn";
const primary = "src/primary.ts";
const sibling = "src/sibling.ts";
const scope = [primary, sibling];
const producer = { role: "supervisor", actor: "fixture-supervisor", session: "supervisor-session" };
const decision = { id: "settled-definition", domain: "financial", digest: digest("unchanged-definition") };
const limits = { pool_id: "fixture-pool", account_scope: "fixture-account", unit: "messages", account_epoch: 1,
  account_ceiling: 100, goal_ceiling: 40, task_ceiling: 20, max_model_calls: 8, max_continuations: 5,
  execution_deadline: at(100), cleanup_reserve: 2 };
const root = readFileSync(new URL("../.codex/hooks/pfm-policy.py", import.meta.url), "utf8");
const roots: string[] = [];

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { force: true, recursive: true });
});

function temporary() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "pfm-lifecycle-")));
  roots.push(directory);
  return directory;
}

function body(paths = [primary], target = branch, eol = "\n") {
  return ["PFM_TASK_V3", "TASK_KIND: product", `TARGET_BRANCH: ${target}`, "DEPENDENCY_POLICY: locked", "",
    "ALLOWED_PATHS:", ...paths.map((path) => `- ${path}`), "", "OBJECTIVE:", "Keep the original objective.", "",
    "ACCEPTANCE:", "Independent witness.", "", "READINESS:", "Keep the original readiness.", "",
    "<!-- PFM_TASK_META_V1", '{"opaque":"preserve every byte"}', "-->", ""].join(eol);
}

function envelope(schema: string, id = schema.toLowerCase()) {
  return { schema, repository, id, revision: 1, created_at: at(0), producer, references: [] };
}

function fixture() {
  const journal = temporary();
  const firstDirectory = temporary();
  const otherDirectory = temporary();
  let now = at(1);
  let phaseFault: string | null = null;
  const denied = new Set<string>();
  const humanEvents = new Set<string>();
  const verify = (boundary: string, value: unknown) => !denied.has(boundary)
    && (boundary !== "human_approval" || humanEvents.has(digest(value)));
  const parseSaved = (issue: { body: string }) => ({ ...inspectV3Body(issue.body),
    parser_revision: "c".repeat(40), parser_digest: sha256(root) });
  const resourceRuns = new Map<string, unknown>();
  const options = { directory: journal, ledgerId: "fixture-lifecycle", verify, parseSaved,
    resources: { lookup: (id: string) => resourceRuns.get(id) }, consumedNonces: new Set<string>(), clock: () => now };
  const ledger = openLifecycle({ ...options, initialize: true });
  const reopen = () => openLifecycle({ ...options, fault: (phase: string) => {
    if (phase === phaseFault) throw Object.assign(new Error("simulated disk-full"), { code: "ENOSPC" });
  } });
  const goalControl = { ...envelope("PFM_GOAL_V1"), goal_issue: 362, control_revision: 1, observation_revision: 0,
    outcome: "One reviewable lifecycle result.", requirement_refs: ["GF-R07"], approved_decisions: [decision], exclusions: [],
    decision_authority: { financial: "pm", product: "pm", privacy: "pm", security: "pm", release: "pm", uat: "pm", activation: "pm", implementation: "task" },
    phase_gates: { alignment: "aligned", planning: "planned", implementation: "written", verification: "checked" },
    budget_policy: limits, concurrency_policy: { implementation_writers: 2, read_only_workers: 2, review_backlog: 2 },
    merge_policy: { tier: "manual" }, uat_policy: "not_required", completion_evidence: ["review"], approval: ref("pending") };
  const goalKeys = { goal_issue: 362, goal_revision: 1, goal_control_digest: goalControlDigest(goalControl) };
  const approval = { ...envelope("PFM_APPROVAL_V1"), ...goalKeys,
    producer: { role: "pm", actor: "operator", session: "human-session" }, purpose: "goal", merge_tier: "manual",
    decision_scope: ["product", "financial"], candidate_digest: null, task_issue: null, task_revision: null,
    criteria: [], channel: "human-approval", nonce: "approval", expires_at: at(90) };
  humanEvents.add(digest(approval));
  const goal = { ...goalControl, approval: recordRef(approval) };

  function prepare({ issueNumber = 365, fence = 1, directory = firstDirectory, environment = "local",
    target = branch, base = head, paths = [primary], issueBody = body(paths, target), taskRevision = 1,
    upstream = true, resource = "shared-register", attempt = "initial" } = {}) {
    const issue = { repository, number: issueNumber, body: issueBody, kind: "issue", state: "open", evidence: ref("saved-issue") };
    const bodyDigest = sha256(issueBody);
    const workspace = { ...envelope("WORKSPACE_RECEIPT_V1"), task_issue: issueNumber, directory, environment,
      origin_repository: repository, branch: target, issue_body_digest: bodyDigest, head_sha: base,
      upstream_head_sha: upstream ? base : null, state: "ready", receipt_owner: worker, ready_proof: ref("bootstrap-preflight"), writer_fence: fence };
    const receipt = { status: "prepared", owner: worker, authorization_id: `grant-${fence}`, digest: digest(`grant-${fence}`),
      issue: issueNumber, body_digest: bodyDigest };
    const observation = { directory, environment, branch: target, head: base, base, origin, linked: true,
      upstream: upstream ? `origin/${target}` : null, upstream_head: upstream ? base : null, conflicted: false, dirty: false,
      receipt, paths: [] as string[] };
    const remote = { repository, branch: target, base, head: upstream ? base : null, evidence: ref("remote-head") };
    const routes = paths.map((_, index) => ({ entry: `route-${index}`, alternative: index === 0 ? "primary" : "fallback" }));
    const boundaries = Object.fromEntries((censusBoundaries as string[]).map((name) =>
      [name, { disposition: "covered", detail: "Independent synthetic witness" }]));
    const census = { ...envelope("SCOPE_CENSUS_V1"), ...goalKeys, task_issue: issueNumber, baseline_sha: base,
      risk: "cross-cutting", review: ref("scope-review"), unresolved: [], required_write_paths: paths, read_only_exclusions: [],
      rows: routes.map((route, index) => ({ ...route, id: `row-${index}`, guard: "Fixture guard", path: paths[index],
        symbol: "writer", ownership: "task_write", boundaries, positive_evidence: [ref("positive")], negative_evidence: [ref("negative")] })) };
    const lineage_id = `lineage-${issueNumber}`;
    const reservation = { ...envelope("BUDGET_RESERVATION_V1", `reservation-${fence}`), ...goalKeys,
      task_issue: issueNumber, task_revision: taskRevision, lineage_id, limits, risk: "cross-cutting",
      runtime_profile_ref: ref("profile"), estimated_ceiling: 2,
      carries: { account_liability: 0, goal_liability: 0, task_liability: 0, model_calls: 0, continuations: 0 },
      max_admitted_model_calls: 1, max_admitted_continuations: 0, expires_at: at(40),
      state: "reserved", native_run_id: null, terminal_ack: null };
    resourceRuns.set(reservation.id, { reservation, status: "reserved" });
    return { issue, goal, approval, workspace, observation, remote, census, routes, lineage_id, resource, attempt,
      task_revision: taskRevision, budget: recordRef(reservation), audit: ref("full-audit"),
      alignment: { approved_goal_revision: 1, goal_control_digest: goalKeys.goal_control_digest, decisions: [decision],
        unresolved: [], risk: "cross-cutting", independentOutcome: true, coherent: true, relatedBatch: false } };
  }

  function event(kind: string, id: string, expected_revision: number, input: unknown, task_issue = 365, head_sha = head) {
    return { event_id: id, source: "fixture-provider", repository, goal_issue: 362, goal_revision: 1, task_issue,
      expected_revision, head_sha, kind, observed_at: now, payload_ref: { id: `payload-${id}`, digest: sha256(canonicalJson(input, 1024 * 1024)) } };
  }

  function submit(kind: string, id: string, revision: number, input: unknown, issue = 365, base = head) {
    return ledger.submit(event(kind, id, revision, input, issue, base), input);
  }

  function claimed(input = prepare()) {
    submit("prepare", "prepare", 0, input);
    submit("claim", "claim", 1, input);
    return input;
  }

  function withContext<T extends { workspace: ReturnType<typeof prepare>["workspace"]; terminal: ReturnType<typeof ref> }>(
    input: T, taskRevision = 1,
  ) {
    const { workspace, terminal } = input;
    const current_context = { settled_decisions: [decision], unresolved_criteria: ["independent-review"], blockers: [] };
    const context_checkpoint = { ...envelope("CONTEXT_CHECKPOINT_V1"), ...goalKeys, ...current_context,
      task_issue: workspace.task_issue, task_revision: taskRevision, lineage_id: `lineage-${workspace.task_issue}`,
      branch: workspace.branch, head_sha: workspace.head_sha, workspace_receipt_ref: recordRef(workspace),
      artifacts: [ref("retained-checkpoint")], stopped_writer_ack: terminal, next_action: "review" };
    return { ...input, current_context, context_checkpoint };
  }

  function closeUnpublished(input = prepare()) {
    claimed(input);
    const stop = withContext({ fence: input.workspace.writer_fence, workspace: input.workspace,
      observation: { ...input.observation, receipt: { ...input.observation.receipt, status: "closed" } },
      remote: input.remote, terminal: ref("stopped-owner") });
    submit("acknowledge-stop", "stop", 2, stop);
    return stop;
  }

  return { journal, ledger, prepare, claimed, closeUnpublished, withContext, event, submit, reopen, denied, otherDirectory,
    fault: (phase: string | null) => { phaseFault = phase; }, time: (minutes: number) => { now = at(minutes); } };
}

describe("GF-V03, GF-V04, GF-V07 and GF-V23: supervised lifecycle", () => {
  it("authenticates preparation, deduplicates exact events, and leaves status outside control authority", () => {
    const f = fixture();
    const input = f.prepare({ paths: scope });
    expect(() => f.submit("prepare", "incomplete", 0, { ...input, routes: input.routes.slice(0, 1) })).toThrow("SCOPE_CLOSURE");
    expect(() => f.submit("prepare", "forged", 0, { ...input, approval: { ...input.approval, channel: "shared-github" } })).toThrow("human_approval");
    f.denied.add("task_dependencies_satisfied");
    expect(() => f.submit("prepare", "dependency", 0, input)).toThrow("task_dependencies_satisfied");
    f.denied.delete("task_dependencies_satisfied");
    const observedGoal = { ...input.goal, revision: 2, observation_revision: 1 };
    expect(f.submit("prepare", "prepare", 0, { ...input, goal: observedGoal })).toMatchObject({ phase: "prepared", revision: 1 });
    expect(f.submit("prepare", "prepare", 0, { ...input, goal: observedGoal })).toMatchObject({ disposition: "duplicate", permit: null });
    expect(() => f.submit("prepare", "prepare", 0, input)).toThrow("LIFECYCLE_EVENT_CONFLICT");
    expect(f.submit("status", "comment", 0, { source: "shared-github-comment" }).permit).toBeNull();
    expect(() => f.submit("claim", "reordered", 0, input)).toThrow("STALE_LIFECYCLE_EVENT");
    expect(() => f.submit("claim", "wrong-head", 1, input, 365, nextHead)).toThrow("STALE_LIFECYCLE_EVENT");
    expect(() => f.submit("claim", "foreign", 1, { ...input, observation: { ...input.observation,
      receipt: { ...input.observation.receipt, owner: "foreign" } } })).toThrow("WORKSPACE_WRITER");
    expect(f.submit("claim", "write", 1, input).phase).toBe("claimed");
    f.time(24 * 60 + 2);
    expect(() => f.ledger.submit({ ...f.event("claim", "expired", 2, input), observed_at: at(1) }, input)).toThrow("LIFECYCLE_EVENT");
  });

  it("supersedes non-owning preparation and fences the same remote branch and logical resource across environments", () => {
    const f = fixture();
    const a = f.prepare({ upstream: false });
    const b = f.prepare({ issueNumber: 366, fence: 2, directory: f.otherDirectory, environment: "cloud", resource: "other-resource" });
    const unrelatedBranch = f.prepare({ issueNumber: 367, fence: 3, target: "codex/other" });
    f.submit("prepare", "a", 0, a);
    f.submit("prepare", "b", 0, b, 366);
    f.submit("prepare", "other-branch", 0, unrelatedBranch, 367);
    const replacement = f.prepare({ fence: 4, upstream: false });
    f.denied.add("superseded_prepared_receipt");
    expect(() => f.submit("prepare", "denied", 1, replacement)).toThrow("superseded_prepared_receipt");
    f.denied.delete("superseded_prepared_receipt");
    f.submit("prepare", "replacement", 1, replacement);
    expect(() => f.submit("claim", "stale", 2, a)).toThrow("STALE_PREPARATION");
    f.submit("claim", "owner", 2, replacement);
    expect(() => f.reopen().submit(f.event("claim", "same-branch", 1, b, 366), b)).toThrow("WRITER_CONTENTION");
    expect(() => f.submit("claim", "same-resource", 1, unrelatedBranch, 367)).toThrow("WRITER_CONTENTION");
    expect(() => f.ledger.assertWriter({ repository, issue: 365, fence: 1, authorization_id: "grant-1", paths: [primary], evidence: ref("scope") })).toThrow("STALE_WRITER");
    expect(f.ledger.assertWriter({ repository, issue: 365, fence: 4, authorization_id: "grant-4", paths: [primary], evidence: ref("scope") })).toBe(true);
    expect(() => f.ledger.assertWriter({ repository, issue: 365, fence: 4, authorization_id: "grant-4", paths: [sibling], evidence: ref("scope") })).toThrow("WRITER_SCOPE");
  });

  it("retains the fence and budget after failed push, pauses reads, and reconciles a late exact checkpoint", () => {
    const f = fixture();
    const prepared = f.claimed();
    const candidate = { candidate: true, head_sha: nextHead, fence: 1, authorization_id: "grant-1", evidence: ref("candidate"),
      observation: { ...prepared.observation, head: nextHead, paths: [primary], receipt: { ...prepared.observation.receipt, status: "active" } } };
    expect(() => f.submit("begin-checkpoint", "unsafe", 2, { ...candidate, observation: { ...candidate.observation,
      paths: ["ignored/generated.ts"] } })).toThrow("CHECKPOINT_LOCAL_SCOPE");
    expect(f.submit("begin-checkpoint", "push", 2, candidate).permit).toBe("operator-checkpoint");
    expect(f.submit("begin-checkpoint", "push", 2, candidate).permit).toBeNull();
    expect(f.reopen().inspect(repository, 365)).toMatchObject({ phase: "checkpoint-pending", budget: prepared.budget });
    expect(f.submit("observe-intent", "read", 3, { intent_id: "push" }).permit).toBe("one-bounded-read");
    f.submit("reconcile", "failed-push", 4, { intent_id: "push", read_id: "read", outcome: "unavailable", evidence: ref("network-lost") });
    expect(() => f.submit("observe-intent", "breaker", 5, { intent_id: "push" })).toThrow("RECONCILIATION_PAUSED");
    const b = f.prepare({ issueNumber: 366, fence: 2, directory: f.otherDirectory, environment: "cloud" });
    f.time(41);
    expect(() => f.submit("prepare", "takeover", 0, b, 366)).toThrow("WRITER_CONTENTION");
    const result = f.withContext({ intent_id: "push", outcome: "applied", fence: 1, evidence: ref("found-remote-head"), terminal: ref("owner-stop"),
      workspace: { ...prepared.workspace, head_sha: nextHead, upstream_head_sha: nextHead },
      observation: { ...candidate.observation, upstream_head: nextHead, receipt: { ...prepared.observation.receipt, status: "closed" } },
      remote: { ...prepared.remote, head: nextHead } });
    expect(() => f.submit("reconcile", "stale-remote", 5, { ...result, remote: prepared.remote })).toThrow("UNSHARED_CHECKPOINT");
    expect(() => f.submit("reconcile", "active-receipt", 5, { ...result, observation: { ...result.observation,
      receipt: candidate.observation.receipt } })).toThrow("WORKSPACE_WRITER");
    expect(() => f.submit("reconcile", "dropped-criteria", 5, { ...result, context_checkpoint: {
      ...result.context_checkpoint, unresolved_criteria: [] } })).toThrow("CHECKPOINT_DROPPED_unresolved_criteria");
    expect(f.submit("reconcile", "found", 5, result).phase).toBe("published");
    expect(f.submit("review-disposition", "repair", 6, { outcome: "repair", evidence: ref("reviewer-finding") }, 365, nextHead).phase).toBe("closed");
  });

  it("atomically preserves the previous revision on disk-full and never reissues a lost durable permit", () => {
    const f = fixture();
    const input = f.prepare();
    const request = f.event("prepare", "once", 0, input);
    f.fault("before-sync");
    expect(() => f.reopen().submit(request, input)).toThrow("simulated disk-full");
    expect(f.ledger.inspect(repository, 365)).toBeNull();
    f.fault("after-rename");
    expect(() => f.reopen().submit(request, input)).toThrow("simulated disk-full");
    f.fault(null);
    expect(f.reopen().submit(request, input)).toEqual({ disposition: "duplicate", revision: 1, permit: null });
    expect(f.ledger.inspect(repository, 365)).toMatchObject({ phase: "prepared", revision: 1 });
    mkdirSync(join(f.journal, "transaction.lock"));
    expect(f.ledger.inspect(repository, 365).phase).toBe("prepared");
    expect(() => f.submit("claim", "contender", 1, input)).toThrow("EEXIST");
  });

  it("caps provider backoff, pauses on permission failure, and reconciles a cancelled correction", () => {
    const f = fixture();
    const input = f.prepare();
    const stopped = f.closeUnpublished(input);
    f.submit("begin-correction", "plan", 3, { issue: input.issue, expected_body_digest: sha256(input.issue.body),
      replacement: { paths: scope, acceptance: "Independent review of the affected routes." },
      archive: ref("archived"), closed_receipt: stopped.terminal });
    f.submit("observe-intent", "first-read", 4, { intent_id: "plan" });
    f.submit("reconcile", "limited", 5, { intent_id: "plan", read_id: "first-read", outcome: "rate_limit",
      retry_after_ms: 1_000_000, evidence: ref("rate-limit") });
    f.time(2);
    expect(() => f.submit("observe-intent", "early", 6, { intent_id: "plan" })).toThrow("RECONCILIATION_PAUSED");
    f.time(3);
    f.submit("observe-intent", "second-read", 6, { intent_id: "plan" });
    f.submit("reconcile", "permission", 7, { intent_id: "plan", read_id: "second-read", outcome: "permission", evidence: ref("permissions") });
    expect(() => f.submit("observe-intent", "paused", 8, { intent_id: "plan" })).toThrow("RECONCILIATION_PAUSED");
    expect(f.submit("reconcile", "cancelled", 8, { intent_id: "plan", outcome: "abandon", evidence: ref("no-request"),
      issue: input.issue })).toMatchObject({ phase: "closed", intent: null, permit: null });
  });
});

describe("GF-V05 and GF-V14: closed-turn correction and bounded repair", () => {
  it("plans an original-issue correction with an exact compare and refetch, then reauthorizes an expanded or narrowed scope", () => {
    const f = fixture();
    const original = f.prepare();
    const stop = f.closeUnpublished(original);
    const replacement = { paths: scope, acceptance: "Review both affected routes." };
    const correction = { issue: original.issue, expected_body_digest: sha256(original.issue.body), replacement,
      archive: ref("archived-original"), closed_receipt: stop.terminal };
    const updated = levelOneBody(original.issue.body, replacement);
    expect(updated).toContain('<!-- PFM_TASK_META_V1\n{"opaque":"preserve every byte"}\n-->');
    expect(updated).toContain("OBJECTIVE:\nKeep the original objective.");
    expect(updated).toContain("READINESS:\nKeep the original readiness.");
    expect(() => f.submit("begin-correction", "conflict", 3, { ...correction, expected_body_digest: digest("old") })).toThrow("CORRECTION_CLOSED_TURN_REQUIRED");
    f.denied.add("closed_turn_level_one_review");
    expect(() => f.submit("begin-correction", "changed-meaning", 3, correction)).toThrow("closed_turn_level_one_review");
    f.denied.delete("closed_turn_level_one_review");
    const event = f.event("begin-correction", "correct", 3, correction);
    f.fault("after-rename");
    expect(() => f.reopen().submit(event, correction)).toThrow("simulated disk-full");
    f.fault(null);
    expect(f.reopen().submit(event, correction).permit).toBeNull();
    expect(() => f.submit("reconcile", "other-editor", 4, { intent_id: "correct", outcome: "applied", evidence: ref("edited"),
      issue: { ...original.issue, body: updated.replace("Keep the original readiness.", "Conflicting editor.") } })).toThrow("CORRECTION_SAVED_BODY_CONFLICT");
    f.submit("observe-intent", "read-correction", 4, { intent_id: "correct" });
    const unseen = { intent_id: "correct", read_id: "read-correction", outcome: "absent", evidence: ref("absent"), issue: original.issue };
    f.denied.add("terminal_absence_and_cancelled_request");
    expect(() => f.submit("reconcile", "maybe-in-flight", 5, unseen)).toThrow("terminal_absence_and_cancelled_request");
    f.denied.delete("terminal_absence_and_cancelled_request");
    f.submit("reconcile", "proved-absent", 5, unseen);
    expect(f.submit("retry-correction", "retry", 6, { intent_id: "correct", issue: original.issue }).permit).toBe("conditional-issue-update");
    expect(() => f.submit("retry-correction", "extra-retry", 7, { intent_id: "correct", issue: original.issue })).toThrow("CORRECTION_RETRY_INELIGIBLE");
    f.submit("reconcile", "read-saved", 7, { intent_id: "correct", outcome: "applied", evidence: ref("saved"), issue: { ...original.issue, body: updated } });
    const expanded = f.prepare({ fence: 2, taskRevision: 2, paths: scope, issueBody: updated, attempt: "continuation" });
    f.submit("resume", "fresh-expanded", 8, expanded);
    expect(() => f.submit("begin-correction", "prepared-edit", 9, correction)).toThrow("CORRECTION_CLOSED_TURN_REQUIRED");
    f.submit("claim", "new-writer", 9, expanded);
    expect(() => f.submit("begin-correction", "active-edit", 10, correction)).toThrow("LIVE_OR_PENDING_GRANT");
    f.submit("acknowledge-stop", "close-expanded", 10, f.withContext({ ...stop, fence: 2, workspace: expanded.workspace,
      observation: { ...expanded.observation, receipt: { ...expanded.observation.receipt, status: "closed" } } }, 2));
    const narrowing = { paths: [primary], acceptance: "Review the retained route." };
    const narrowedBody = levelOneBody(updated, narrowing);
    f.submit("begin-correction", "shrink", 11, { ...correction, issue: expanded.issue, expected_body_digest: sha256(updated), replacement: narrowing });
    f.submit("reconcile", "saved-narrow", 12, { intent_id: "shrink", outcome: "applied", evidence: ref("saved-narrow"),
      issue: { ...expanded.issue, body: narrowedBody } });
    const narrowed = f.prepare({ fence: 3, taskRevision: 3, issueBody: narrowedBody, attempt: "continuation" });
    f.submit("resume", "fresh-narrow", 13, narrowed);
    f.submit("claim", "narrow-writer", 14, narrowed);
    expect(() => f.ledger.assertWriter({ repository, issue: 365, fence: 3, authorization_id: "grant-3", paths: [sibling], evidence: ref("old-path") })).toThrow("WRITER_SCOPE");
  });

  it("freezes admission while settling active work and requires the full audit before two repairs and one reassessment", () => {
    const f = fixture();
    const first = f.prepare();
    f.claimed(first);
    f.denied.add("lifecycle_admissions_open");
    expect(() => f.submit("prepare", "frozen", 0, f.prepare({ issueNumber: 366, fence: 2, target: "codex/other" }), 366)).toThrow("lifecycle_admissions_open");
    const finish = (attempt: ReturnType<typeof f.prepare>) => f.withContext({ fence: attempt.workspace.writer_fence, workspace: attempt.workspace, remote: attempt.remote,
      observation: { ...attempt.observation, receipt: { ...attempt.observation.receipt, status: "closed" } }, terminal: ref("stopped") });
    f.submit("acknowledge-stop", "close", 2, finish(first));
    f.submit("record-blocker", "first-blocker", 3, { root: "same-root", evidence: ref("first-proof") });
    f.denied.delete("lifecycle_admissions_open");
    const repair = f.prepare({ fence: 3, attempt: "repair" });
    f.denied.add("affected_contract_and_sibling_audit");
    expect(() => f.submit("resume", "incomplete-audit", 4, repair)).toThrow("affected_contract_and_sibling_audit");
    f.denied.delete("affected_contract_and_sibling_audit");
    f.submit("resume", "repair-one", 4, repair);
    f.submit("claim", "claim-first-repair", 5, repair);
    f.submit("acknowledge-stop", "close-repair-one", 6, finish(repair));
    const second = f.prepare({ fence: 4, attempt: "repair" });
    f.submit("resume", "repair-two", 7, second);
    f.submit("claim", "claim-second-repair", 8, second);
    f.submit("acknowledge-stop", "close-repair-two", 9, finish(second));
    expect(() => f.submit("record-blocker", "renamed", 10, { root: "new-name", evidence: ref("old-root") })).toThrow("NEW_ROOT_REQUIRES_REVIEW");
    expect(() => f.submit("resume", "third-repair", 10, f.prepare({ fence: 5, attempt: "repair" }))).toThrow("REPAIR_LINEAGE_LIMIT");
    const review = f.prepare({ fence: 5, attempt: "reassessment" });
    expect(f.submit("resume", "one-reassessment", 10, review)).toMatchObject({ phase: "closed", permit: null });
    expect(() => f.submit("claim", "diagnostic-writer", 11, review)).toThrow("STALE_PREPARATION");
    expect(() => f.submit("resume", "second-reassessment", 11, f.prepare({ fence: 6, attempt: "reassessment" }))).toThrow("REPAIR_LINEAGE_LIMIT");
  });
});

describe("GF-V07 and GF-V23: actual legacy parser and Git observations", () => {
  it("pins the actual legacy validator and denies ambiguous or protected V3 paths before any authority is produced", () => {
    const python = execFileSync("which", ["python3"], { encoding: "utf8" }).trim();
    const revision = "c".repeat(40);
    const verify = (boundary: string, binding: { digest: string }) => boundary === "merged_v3_parser" && binding.digest === sha256(root);
    const parse = pinnedV3Parser({ source: root, revision, python, verify });
    expect(parse({ body: body() })).toMatchObject({ branch, allowedPaths: [primary], parser_revision: revision });
    expect(() => parse({ body: body(["tools/roadmap/goal-issue-metadata.mjs"]) })).toThrow("PINNED_PARSER_DISAGREEMENT");
    for (const path of ["/tmp/unsafe.ts", "../escape.ts", "src/./alias.ts", "**", "src/*/escape.ts", ".codex/runtime/latest-task.json"]) {
      expect(() => parse({ body: body([path]) })).toThrow();
    }
    expect(() => parse({ body: body().replace("TASK_KIND: product", "TASK_KIND: product\nTASK_KIND: framework") })).toThrow("V3_HEADER");
    const altered = pinnedV3Parser({ source: root + "\nraise RuntimeError('untrusted branch')\n", revision, python, verify });
    expect(() => altered({ body: body() })).toThrow("merged_v3_parser");
    const windows = body([primary], branch, "\r\n");
    const replaced = levelOneBody(windows, { paths: scope, acceptance: "Witness.\nReview." });
    expect(replaced).toContain("Witness.\r\nReview.\r\n\r\nREADINESS:");
    expect(replaced.split("READINESS:")[1]).toBe(windows.split("READINESS:")[1]);
  });

  it("reads an actual linked worktree and fake remote without changing state, including deleted and untracked paths", () => {
    const directory = temporary();
    const git = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    const run = (cwd: string, ...args: string[]) => execFileSync(git, ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    const local = join(directory, "local");
    const remote = join(directory, "fake-remote");
    const tree = join(directory, "linked");
    run(directory, "init", "--bare", remote);
    run(directory, "init", "-b", "main", local);
    run(local, "config", "user.name", "Fixture");
    run(local, "config", "user.email", "fixture@example.invalid");
    writeFileSync(join(local, "tracked.ts"), "original\n");
    run(local, "add", "tracked.ts");
    run(local, "commit", "-m", "base");
    const base = run(local, "rev-parse", "HEAD");
    run(local, "worktree", "add", "-b", branch, tree);
    run(tree, "remote", "add", "origin", origin);
    const options = { directory: tree, git, environment: "fixture-host", repository, base, verify: () => true };
    expect(inspectWorkspace(options)).toMatchObject({ branch, head: base, linked: true, dirty: false, conflicted: false, receipt: { status: "absent" } });
    run(tree, "remote", "set-url", "--push", "origin", "https://github.com/fixture/different.git");
    expect(() => inspectWorkspace(options)).toThrow("WORKTREE_ORIGIN");
    run(tree, "remote", "set-url", "--push", "origin", origin);
    run(tree, "push", remote, `HEAD:refs/heads/${branch}`);
    const fakeHead = run(remote, "rev-parse", `refs/heads/${branch}`);
    run(tree, "update-ref", `refs/remotes/origin/${branch}`, fakeHead);
    run(tree, "branch", "--set-upstream-to", `origin/${branch}`);
    expect(inspectWorkspace(options).upstream_head).toBe(fakeHead);
    run(tree, "rm", "tracked.ts");
    run(tree, "commit", "-m", "delete tracked file");
    writeFileSync(join(tree, "replacement.ts"), "replacement\n");
    run(tree, "add", "replacement.ts");
    run(tree, "commit", "-m", "second task commit");
    writeFileSync(join(tree, "generated.ts"), "generated\n");
    const observed = inspectWorkspace(options);
    expect(observed).toMatchObject({ dirty: true, upstream_head: fakeHead });
    expect(observed.paths).toEqual(["generated.ts", "replacement.ts", "tracked.ts"]);
    symlinkSync(local, join(tree, "alias"), "dir");
    expect(() => resolveScopedPaths(tree, ["alias/tracked.ts"], "product")).toThrow("WORKTREE_PATH_ALIAS");
    expect(() => resolveScopedPaths(tree, ["test/goalFrameworkLifecycle.test.ts"], "product")).toThrow("FRAMEWORK_SCOPE");
    mkdirSync(join(tree, ".codex", "runtime"), { recursive: true });
    writeFileSync(join(tree, ".codex", "runtime", "turn.json"), "{}");
    expect(() => inspectWorkspace(options)).toThrow("WORKTREE_RECEIPT_MISSING");
    expect(run(tree, "rev-parse", "@{u}")).toBe(fakeHead);
  });
});
