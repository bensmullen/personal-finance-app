import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The tooling is dependency-free ESM. Keep this import consistent with other CI tooling tests.
const url = new URL("../tools/codex/goal-framework/contracts.mjs", import.meta.url).href;
const {
  canonicalJson, digest, goalControlDigest, inspectV3Body, planAlignedTask, proposeTaskTransition,
  readTaskMetadata, reservationDisposition, validateApproval, validateCheckpoint, validateExecutionGrant,
  validateGoal, validatePath, validateRecord, validateScopeCensus, validateVerificationEvidence,
} = await import(url);
const schemaUrl = new URL("../tools/codex/goal-framework/schemas/v1.mjs", import.meta.url).href;
const { censusBoundaries, schemas } = await import(schemaUrl);
const cases = JSON.parse(readFileSync(new URL("./fixtures/goalFramework/contracts/cases.json", import.meta.url), "utf8")) as {
  unsafe_paths: string[];
  scope_alternatives: string[];
  sizing: { independentOutcome: boolean; coherent: boolean; relatedBatch: boolean; risk: string; expected: string }[];
};

const repository = "fixture/pfm";
const created = "2026-01-01T00:00:00Z";
const now = "2026-01-01T01:00:00Z";
const expires = "2026-01-01T02:00:00Z";
const deadline = "2026-01-01T03:00:00Z";
const branch = "codex/fixture-contract";
const head = "1".repeat(40);
const published = "2".repeat(40);
const base = "3".repeat(40);
const writePath = "src/example.ts";
const worker = { actor: "writer", session: "worker-session", role: "worker" };
const pm = { actor: "operator", session: "operator-session", role: "pm" };
const reviewer = { actor: "qa", session: "qa-session", role: "reviewer" };
const supervisor = { actor: "supervisor", session: "supervisor-session", role: "supervisor" };

function envelope(schema: string, producer = supervisor) {
  return { schema, repository, id: schema.toLowerCase(), revision: 1, created_at: created, producer, references: [] };
}

const reference = (record: { id: string }) => ({ id: record.id, digest: digest(record) });
const artifact = (id: string) => ({ id, digest: digest(id) });
const decision = { id: "definition", domain: "financial", digest: digest("settled-definition") };
const limits = {
  pool_id: "pool", account_scope: "account", account_epoch: 1, unit: "messages",
  account_ceiling: 100, goal_ceiling: 40, task_ceiling: 20, max_model_calls: 5, max_continuations: 2,
  execution_deadline: deadline, cleanup_reserve: 3,
};
const allowedAttestations = new Set([
  "live_goal_control", "saved_open_v3_actual_parser", "live_workspace_receipt", "independent_scope_review",
  "resolved_workspace_scope", "live_runner_profile", "live_budget_reservation", "terminal_run", "live_execution_grant",
  "live_runner_resource_profile_binding",
  "exact_candidate_checks", "independent_verification_review", "live_checkpoint_authority", "stopped_checkpoint_writer",
  "task_event", "task_transition_evidence", "complete_publication", "native_start_acknowledgement",
  "actual_merge_confirmation", "complete_acceptance_criteria",
]);

function fixture(uatPolicy = "not_required") {
  const control = {
    ...envelope("PFM_GOAL_V1"), goal_issue: 100, control_revision: 1, observation_revision: 0,
    outcome: "Review one independently verifiable result.", requirement_refs: ["GF-R01"],
    approved_decisions: [decision], exclusions: ["unrelated readers"],
    decision_authority: {
      financial: "pm", product: "pm", privacy: "pm", security: "pm", release: "pm", uat: "pm",
      activation: "pm", implementation: "task",
    },
    phase_gates: { alignment: "aligned", planning: "scoped", implementation: "published", verification: "accepted" },
    budget_policy: limits,
    concurrency_policy: { implementation_writers: 2, read_only_workers: 2, review_backlog: 2 },
    merge_policy: { tier: "manual" }, uat_policy: uatPolicy, completion_evidence: ["plan-evidence"],
    approval: artifact("placeholder"),
  };
  const goalKeys = {
    repository, goal_issue: 100, goal_revision: 1, goal_control_digest: goalControlDigest(control),
  };
  const approval = {
    ...envelope("PFM_APPROVAL_V1", pm), ...goalKeys, decision_scope: uatPolicy === "required"
      ? ["product", "financial", "uat"] : ["product", "financial"],
    purpose: "goal", merge_tier: "manual", candidate_digest: null, task_issue: null, task_revision: null,
    criteria: [], channel: "human-channel", nonce: "goal-nonce", expires_at: deadline,
  };
  const approvedEvents = new Set([digest(approval)]);
  const denied = new Set<string>();
  const authority = {
    now, consumedNonces: new Set<string>(),
    verify(kind: string, value: unknown) {
      if (denied.has(kind)) return false;
      if (kind === "human_approval") return approvedEvents.has(digest(value));
      return allowedAttestations.has(kind);
    },
  };
  const goal = { ...control, approval: reference(approval) };
  const task = { ...goalKeys, task_issue: 101, task_revision: 1 };
  const savedBody = [
    "PFM_TASK_V3", "TASK_KIND: product", "TARGET_BRANCH: " + branch, "DEPENDENCY_POLICY: locked",
    "", "ALLOWED_PATHS:", "- " + writePath, "", "OBJECTIVE:", "Bounded fixture.",
    "", "ACCEPTANCE:", "Independent witness.",
  ].join("\n");
  const v3 = inspectV3Body(savedBody);
  const workspace = {
    ...envelope("WORKSPACE_RECEIPT_V1"), task_issue: task.task_issue, issue_body_digest: v3.issueBodyDigest,
    directory: "/fixture/worktree", environment: "fixture-host", origin_repository: repository, branch,
    head_sha: head, upstream_head_sha: head, state: "ready", receipt_owner: worker.session,
    writer_fence: 1, ready_proof: artifact("workspace-proof"),
  };
  const runner = {
    ...envelope("RUNNER_CAPABILITIES_V1"), surface: "local", product: "synthetic-runner",
    runtime_version: "1.0", tool_version: "2.0", authentication_ref: artifact("auth-proof"),
    operations: Object.fromEntries(Object.keys(schemas.RUNNER_CAPABILITIES_V1.properties.operations.properties)
      .map((operation) => [operation, { status: "verified", evidence: [artifact(operation)] }])),
  };
  const rowEvidence = { positive_evidence: [artifact("positive")], negative_evidence: [artifact("negative")] };
  const scopeRequirements = cases.scope_alternatives.map((alternative) => ({ entry: "route", alternative }));
  const census = {
    ...envelope("SCOPE_CENSUS_V1"), ...goalKeys, task_issue: task.task_issue, baseline_sha: head,
    risk: "cross-cutting", review: artifact("scope-review"), unresolved: [], required_write_paths: [writePath],
    read_only_exclusions: ["test/fixtures/reader.json"],
    rows: scopeRequirements.map((route) => ({
      ...route, ...rowEvidence, id: route.alternative, guard: "Reviewed route guard",
      path: route.alternative === "callback" ? "test/fixtures/reader.json" : writePath,
      symbol: "fixtureRoute", ownership: route.alternative === "callback" ? "read_only" : "task_write",
      boundaries: Object.fromEntries((censusBoundaries as string[]).map((name) =>
        [name, { disposition: "covered", detail: "Independent synthetic witness for " + name }])),
    })),
  };
  const resourceProfile = { id: "fixture-resource-profile", status: "verified", surface: "local", runtime: "fixture-runtime",
    model: "fixture-model", reasoning: "fixture-effort", operations: ["implementation"], max_risk: "cross-cutting",
    evidence: artifact("profile") };
  const runtimeIdentity = { surface: runner.surface, runtime: resourceProfile.runtime, product: runner.product,
    runtime_version: runner.runtime_version, tool_version: runner.tool_version, authentication_ref: runner.authentication_ref,
    transport: "fixture-transport", config_digest: digest("fixture-config"), permissions_digest: digest("fixture-permissions"),
    control_revision: base, resource_profile: reference(resourceProfile) };
  const reservation = {
    ...envelope("BUDGET_RESERVATION_V1"), ...task, lineage_id: "original-task", risk: census.risk,
    runtime_profile_ref: reference(resourceProfile), limits, estimated_ceiling: 8,
    carries: { account_liability: 20, goal_liability: 12, task_liability: 2, model_calls: 2, continuations: 1 },
    max_admitted_model_calls: 3, max_admitted_continuations: 1, expires_at: expires,
    state: "reserved", native_run_id: null, terminal_ack: null,
  };
  const unboundGrant = {
    ...envelope("EXECUTION_GRANT_V1"), ...task, lineage_id: reservation.lineage_id,
    issue_body_digest: v3.issueBodyDigest, branch, head_sha: head, v3_marker: "PFM_TASK_V3",
    workspace_receipt_ref: reference(workspace), scope_census_ref: reference(census), runtime_profile_ref: reference(runner),
    budget_reservation_ref: reference(reservation), writer_fence: 1, authorization_id: "v3-authorization", expires_at: expires,
    revocation_ref: null,
  };
  const runnerBinding = {
    ...envelope("RUNNER_PROFILE_BINDING_V1"), ...task, lineage_id: reservation.lineage_id,
    runner_ref: reference(runner), resource_profile_ref: reference(resourceProfile),
    budget_reservation_ref: reference(reservation), workspace_receipt_ref: reference(workspace),
    grant_id: unboundGrant.id, authorization_id: unboundGrant.authorization_id, writer_fence: workspace.writer_fence,
    surface: runner.surface, transport: runtimeIdentity.transport, config_digest: runtimeIdentity.config_digest,
    permissions_digest: runtimeIdentity.permissions_digest, control_revision: base,
    runtime: resourceProfile.runtime, model: resourceProfile.model, reasoning: resourceProfile.reasoning,
    expires_at: expires, revocation_ref: null,
  };
  const grant = { ...unboundGrant, references: [reference(runnerBinding)] };
  const taskAlignment = {
    approved_goal_revision: task.goal_revision, goal_control_digest: task.goal_control_digest, decisions: [decision],
    unresolved: [], risk: census.risk, independentOutcome: true, coherent: true, relatedBatch: false,
  };
  const grantInputs = { goal, approval, savedBody, workspace, census, scopeRequirements, runner, reservation,
    taskAlignment, resourceProfile, runnerBinding, runtimeIdentity };

  const plan = [
    { id: "unit-1", required: true, artifact_required: true },
    { id: "unit-2", required: true, artifact_required: true },
    { id: "optional", required: false, artifact_required: false },
  ];
  const candidate = { pr: 11, head_sha: published, base_sha: base, merge_candidate_sha: null, verification_plan_digest: digest(plan) };
  const evidence = {
    ...envelope("VERIFICATION_EVIDENCE_V1", reviewer), ...task, candidate, capability_versions: ["witness-v1"],
    fixture_versions: ["synthetic-v1"], disposition: "approved", reviewer_evidence: artifact("review"),
    checks: plan.map(({ id, required }) => ({
      id, required, run_id: "ci-run", attempt: 1, outcome: required ? "PASS" : "SKIP",
      artifacts: required ? [artifact(id)] : [],
    })),
  };
  const checkpoint = {
    ...envelope("CONTEXT_CHECKPOINT_V1"), ...task, lineage_id: reservation.lineage_id, branch, head_sha: head,
    workspace_receipt_ref: reference(workspace), artifacts: [artifact("handoff")], settled_decisions: [decision],
    unresolved_criteria: ["pre-uat"], blockers: ["waiting-for-review"], stopped_writer_ack: artifact("stop"), next_action: "review",
  };
  return {
    authority, denied, approvedEvents, goal, approval, task, savedBody, v3, scopeRequirements, census, workspace,
    runner, reservation, grant, grantInputs, plan, candidate, evidence, checkpoint,
  };
}

describe("GF-V01 / GF-V23 authority and bounded records", () => {
  it("separates observed status updates from approval-bound control and detects revocation", () => {
    const f = fixture();
    expect(validateGoal(f.goal, f.approval, f.authority)).toEqual(f.goal);
    const observed = { ...f.goal, revision: 2, observation_revision: 1, references: [artifact("status-only")] };
    expect(goalControlDigest(observed)).toBe(goalControlDigest(f.goal));
    expect(validateGoal(observed, f.approval, f.authority)).toEqual(observed);
    expect(validateExecutionGrant(f.grant, { ...f.grantInputs, goal: observed }, f.authority)).toEqual(f.grant);
    expect(() => validateGoal({ ...observed, control_revision: 2 }, f.approval, f.authority)).toThrow("APPROVAL_BINDING");
    expect(() => validateGoal({ ...f.goal, repository: "other/pfm" }, f.approval, f.authority)).toThrow("APPROVAL_BINDING");
    expect(() => validateGoal(f.goal, undefined, f.authority)).toThrow();
    expect(() => validateGoal(f.goal, { ...f.approval, producer: worker }, f.authority)).toThrow("APPROVAL_SHAPE");
    const forged = { ...f.approval, channel: "shared-github-comment" };
    expect(() => validateGoal({ ...f.goal, approval: reference(forged) }, forged, f.authority)).toThrow("human_approval");
    f.authority.consumedNonces.add(f.approval.nonce);
    expect(() => validateGoal(f.goal, f.approval, f.authority)).toThrow("APPROVAL_REPLAY");
    f.authority.consumedNonces.clear();
    f.denied.add("human_approval");
    expect(() => validateGoal(f.goal, f.approval, f.authority)).toThrow("human_approval");
  });

  it("checks exact candidate, tier, criteria, and expiry", () => {
    const f = fixture();
    const approved = {
      ...f.approval, ...f.task, purpose: "acceptance", decision_scope: ["acceptance"],
      candidate_digest: digest(f.candidate), criteria: ["criterion"], nonce: "accept-nonce",
    };
    f.approvedEvents.add(digest(approved));
    expect(validateApproval(approved, approved, f.authority)).toEqual(approved);
    for (const mismatch of [
      { candidate_digest: digest("different-pr") }, { task_revision: 2 }, { merge_tier: "delegated" },
      { decision_scope: ["acceptance", "uat"] }, { criteria: ["unapproved-criterion"] },
    ]) expect(() => validateApproval(approved, { ...approved, ...mismatch }, f.authority)).toThrow("APPROVAL_BINDING");
    expect(() => validateApproval(approved, approved, { ...f.authority, now: deadline })).toThrow("APPROVAL_TIME");
  });

  it("rejects version drift, extra payloads, duplicate references and oversized data", () => {
    const f = fixture();
    expect(() => validateRecord({ ...f.goal, schema: "PFM_GOAL_V2" })).toThrow("UNKNOWN_SCHEMA");
    expect(() => validateRecord({ ...f.goal, account_token: "synthetic" })).toThrow("SHAPE");
    expect(() => validateRecord({ ...f.goal, decision_authority: { ...f.goal.decision_authority, financial: "task" } })).toThrow("SHAPE");
    expect(() => validateRecord({ ...f.goal, references: [artifact("same"), { id: "same", digest: digest(1) }] })).toThrow("DUPLICATE_ID");
    expect(() => validateRecord({ ...f.goal, created_at: "2026-02-30T01:00:00Z" })).toThrow("SHAPE");
    expect(() => canonicalJson("x".repeat(129 * 1024))).toThrow("JSON_BOUND");
    expect(canonicalJson({ b: [2, 1], a: 1 })).toBe('{"a":1,"b":[2,1]}');
    expect(digest({ b: 2, a: 1 })).toBe(digest({ a: 1, b: 2 }));
  });

  it("reads one marked metadata block without treating it as V3 or approval", () => {
    const f = fixture();
    const metadata = {
      ...envelope("PFM_TASK_META_V1"), goal_issue: f.task.goal_issue, work_package: "GF-01", owner_stage: "P1",
      blocking_gate: "GOAL_FRAMEWORK_P1", depends_on: [99], requirement_ids: ["GF-R01"], approved_goal_revision: 1,
    };
    const body = (json: string) => f.savedBody + "\n\n<!-- PFM_TASK_META_V1\n" + json + "\n-->";
    const context = { repository, taskIssue: f.task.task_issue };
    expect(readTaskMetadata(body(JSON.stringify(metadata)), context)).toEqual(metadata);
    expect(() => readTaskMetadata(body(JSON.stringify({ ...metadata, depends_on: [101] })), context)).toThrow("TASK_METADATA_IDENTITY");
    expect(() => readTaskMetadata(body(JSON.stringify(metadata)) + "\n<!-- PFM_TASK_META_V1\n{}\n-->", context)).toThrow("METADATA_MARKER");
    expect(() => readTaskMetadata(body(JSON.stringify(metadata).replace('"revision":1', '"revision":1,"revision":2')), context))
      .toThrow("METADATA_DUPLICATE_KEY");
    expect(() => validateExecutionGrant(f.grant, { ...f.grantInputs, savedBody: body(JSON.stringify(metadata)) }, f.authority))
      .toThrow("GRANT_V3_BINDING");
  });

  it("reuses alignment and sizes by coherence and reviewable outcomes", () => {
    const f = fixture();
    for (const { expected, ...sizing } of cases.sizing) {
      const task = { ...sizing, approved_goal_revision: 1, goal_control_digest: f.task.goal_control_digest, decisions: [decision], unresolved: [] };
      expect(planAlignedTask(f.goal, f.approval, task, f.authority)).toMatchObject({
        sizing: expected, phase: expected === "split" ? "Alignment" : "Planning",
      });
      expect(() => planAlignedTask(f.goal, f.approval, { ...task, approved_goal_revision: 0 }, f.authority)).toThrow("STALE_ALIGNMENT");
      if (expected !== "split") {
        expect(() => planAlignedTask(f.goal, f.approval, { ...task, decisions: [{ ...decision, digest: digest("new-meaning") }] }, f.authority))
          .toThrow("UNRESOLVED_OR_CONFLICTING_ALIGNMENT");
        expect(() => planAlignedTask(f.goal, f.approval, { ...task, unresolved: ["pending-financial-choice"] }, f.authority))
          .toThrow("UNRESOLVED_OR_CONFLICTING_ALIGNMENT");
      }
    }
  });
});

describe("GF-V04 / GF-V23 census, V3 and workspace binding", () => {
  it("rejects unsafe patterns, duplicate headers, and product escalation", () => {
    const f = fixture();
    for (const path of cases.unsafe_paths) {
      expect(() => validatePath(path, { pattern: true, taskKind: "framework" }), path).toThrow();
    }
    expect(validatePath("tools/codex/goal-framework/schemas/**", { pattern: true, taskKind: "framework" })).toBeTruthy();
    expect(() => validatePath("docs/development/goal-framework/interfaces.md", { pattern: true, taskKind: "repair" }))
      .toThrow("PROTECTED_FRAMEWORK_PATH");
    expect(() => inspectV3Body(f.savedBody + "\n TASK_KIND: framework")).toThrow("V3_HEADER TASK_KIND");
    expect(() => inspectV3Body(f.savedBody + "\nPFM_TASK_V2")).toThrow("V3_MARKER");
    expect(() => inspectV3Body(f.savedBody.replace(branch, "codex/a.lock"))).toThrow("UNSAFE_BRANCH");
    expect(() => inspectV3Body(f.savedBody.replace(writePath, "src/a/b/**"))).not.toThrow();
  });

  it("checks the reviewed entry alternatives and every named boundary before writes", () => {
    const f = fixture();
    const input = { v3: f.v3, requirements: f.scopeRequirements, implementer: worker.session, verify: f.authority.verify };
    expect(validateScopeCensus(f.census, input)).toEqual(f.census);
    for (const alternate of cases.scope_alternatives) {
      expect(() => validateScopeCensus({ ...f.census, rows: f.census.rows.filter((row) => row.alternative !== alternate) }, input))
        .toThrow("SCOPE_CLOSURE");
    }
    const unknown = f.census.rows.map((row) => ({ ...row, ownership: "unknown" }));
    expect(() => validateScopeCensus({ ...f.census, rows: unknown }, input)).toThrow("UNKNOWN_SCOPE_OWNERSHIP");
    const omitted = f.census.rows.map((row) => {
      const boundaries = { ...row.boundaries };
      delete boundaries.cold_replay;
      return { ...row, boundaries };
    });
    expect(() => validateScopeCensus({ ...f.census, rows: omitted }, input)).toThrow("SHAPE");
    expect(() => validateScopeCensus({ ...f.census, review: null }, input)).toThrow("UNREVIEWED_SCOPE");
    expect(() => validateScopeCensus(f.census, { ...input, v3: { ...f.v3, allowedPaths: [writePath, "src/extra.ts"] } }))
      .toThrow("UNJUSTIFIED_V3_PATH");
  });

  it("requires saved-parser evidence, independently checked real paths, a current fence and a certified runner", () => {
    const f = fixture();
    expect(validateExecutionGrant(f.grant, f.grantInputs, f.authority)).toEqual(f.grant);
    expect(() => validateExecutionGrant(f.goal, f.grantInputs, f.authority)).toThrow("UNKNOWN_SCHEMA");
    const taskAlignment = { ...f.grantInputs.taskAlignment, independentOutcome: false };
    expect(() => validateExecutionGrant(f.grant, { ...f.grantInputs, taskAlignment }, f.authority)).toThrow("GRANT_ALIGNMENT");
    for (const boundary of ["saved_open_v3_actual_parser", "live_workspace_receipt", "resolved_workspace_scope",
      "live_runner_resource_profile_binding", "live_execution_grant"]) {
      f.denied.add(boundary);
      expect(() => validateExecutionGrant(f.grant, f.grantInputs, f.authority)).toThrow(boundary);
      f.denied.delete(boundary);
    }
    expect(() => validateExecutionGrant({ ...f.grant, writer_fence: 2 }, f.grantInputs, f.authority)).toThrow("GRANT_WORKSPACE");
    expect(() => validateExecutionGrant({ ...f.grant, revocation_ref: artifact("revoked") }, f.grantInputs, f.authority)).toThrow("GRANT_INACTIVE");
    const runner = { ...f.runner, operations: { ...f.runner.operations, stop: { status: "unverified", evidence: [] } } };
    expect(() => validateExecutionGrant({ ...f.grant, runtime_profile_ref: reference(runner) }, { ...f.grantInputs, runner }, f.authority))
      .toThrow("UNCERTIFIED_WRITER_CONTROLS");
  });

  it("keeps historical grants shape-readable and rejects substituted runner and resource identities", () => {
    const f = fixture();
    const { runnerBinding, resourceProfile, runtimeIdentity } = f.grantInputs;
    const legacy = { ...f.grant, references: [] };
    expect(validateRecord(legacy)).toEqual(legacy);
    expect(() => validateExecutionGrant(legacy, { ...f.grantInputs, runnerBinding: null }, f.authority))
      .toThrow("GRANT_RUNNER_BINDING_REQUIRED");
    expect(() => validateExecutionGrant(legacy, f.grantInputs, f.authority)).toThrow("GRANT_RUNNER_BINDING");
    for (const patch of [
      { repository: "fixture/other" }, { goal_revision: 2 }, { task_issue: 102 }, { task_revision: 2 },
      { lineage_id: "other-lineage" }, { writer_fence: 3 }, { grant_id: "other-grant" }, { authorization_id: "other-auth" },
      { runner_ref: artifact("foreign-runner") }, { resource_profile_ref: reference(f.runner) },
      { budget_reservation_ref: artifact("wrong-budget") }, { workspace_receipt_ref: artifact("different-workspace") },
      { surface: "cloud" }, { model: "other-model" }, { reasoning: "other-effort" }, { runtime: "other-runtime" },
      { expires_at: now }, { revocation_ref: artifact("revoked") }, { transport: "other-transport" },
      { permissions_digest: digest("changed-permission") }, { control_revision: published },
    ]) {
      const binding = { ...runnerBinding, ...patch };
      expect(() => validateExecutionGrant({ ...f.grant, references: [reference(binding)] },
        { ...f.grantInputs, runnerBinding: binding }, f.authority)).toThrow(/GRANT_(RUNNER_BINDING|RESOURCE_PROFILE|RUNTIME_IDENTITY)/);
    }
    for (const patch of [{ runtime_version: "changed" }, { tool_version: "changed" },
      { authentication_ref: artifact("new-auth") }, { config_digest: digest("changed") },
      { resource_profile: artifact("different-resource-profile") }, { resource_profile: undefined }]) {
      expect(() => validateExecutionGrant(f.grant, { ...f.grantInputs, runtimeIdentity: { ...runtimeIdentity, ...patch } }, f.authority))
        .toThrow("GRANT_RUNTIME_IDENTITY");
    }
    expect(() => validateExecutionGrant(f.grant, { ...f.grantInputs, resourceProfile: { ...resourceProfile,
      evidence: artifact("substituted-same-surface") } }, f.authority)).toThrow("GRANT_RESOURCE_PROFILE");
    const alias = { ...f.reservation, runtime_profile_ref: reference(f.runner) };
    const binding = { ...runnerBinding, resource_profile_ref: reference(f.runner), budget_reservation_ref: reference(alias) };
    expect(() => validateExecutionGrant({ ...f.grant, budget_reservation_ref: reference(alias), references: [reference(binding)] },
      { ...f.grantInputs, reservation: alias, runnerBinding: binding, resourceProfile: f.runner }, f.authority)).toThrow("GRANT_RUNNER_BINDING");
  });

  it.each([1, 10, 100])("stores %i bounded runner bindings as references", (count) => {
    const { runnerBinding } = fixture().grantInputs;
    const bindings = Array.from({ length: count }, (_, index) =>
      validateRecord({ ...runnerBinding, id: `binding-${index}`, grant_id: `grant-${index}` }));
    expect(Buffer.byteLength(canonicalJson(bindings, 256 * 1024))).toBeLessThan(count * 1900);
    expect(JSON.stringify(bindings)).not.toContain("fixture/worktree");
  });
});

describe("budget and checkpoint contracts", () => {
  it("enforces cumulative limits and quarantines expired starts until authenticated terminal reconciliation", () => {
    const f = fixture();
    expect(reservationDisposition(f.reservation, f.authority)).toBe("eligible_for_admission");
    const expired = { ...f.authority, now: expires };
    expect(reservationDisposition(f.reservation, expired)).toBe("reconcile_unstarted");
    const started = { ...f.reservation, state: "started", native_run_id: "native-id" };
    expect(reservationDisposition(started, expired)).toBe("stop_and_reconcile");
    expect(reservationDisposition({ ...f.reservation, state: "ambiguous" }, expired)).toBe("stop_and_reconcile");
    const terminal = {
      ...started, state: "terminal",
      terminal_ack: { native_run_id: "native-id", outcome: "stopped", observed_at: expires, evidence: artifact("ack") },
    };
    expect(reservationDisposition(terminal, expired)).toBe("settlement_required");
    expect(() => reservationDisposition({ ...terminal, terminal_ack: null }, expired)).toThrow("TERMINAL_ACK");
    expect(() => reservationDisposition({ ...terminal, native_run_id: "replacement" }, expired)).toThrow("TERMINAL_RUN");
    f.denied.add("terminal_run");
    expect(() => reservationDisposition(terminal, expired)).toThrow("terminal_run");
    for (const task_ceiling of [null, -1, Infinity, NaN, 1.5]) {
      expect(() => validateRecord({ ...f.reservation, limits: { ...limits, task_ceiling } })).toThrow();
    }
    expect(() => validateRecord({ ...f.reservation, estimated_ceiling: 18 })).toThrow("CUMULATIVE_BUDGET");
    expect(() => validateRecord({ ...f.reservation, max_admitted_model_calls: 4 })).toThrow("CUMULATIVE_BUDGET");
    expect(() => validateRecord({ ...f.reservation, max_admitted_continuations: 2 })).toThrow("CUMULATIVE_BUDGET");
    const nextEpoch = { ...f.reservation, limits: { ...limits, account_epoch: 2 }, max_admitted_continuations: 2 };
    expect(() => validateRecord(nextEpoch)).toThrow("CUMULATIVE_BUDGET");
    const replacement = { ...f.reservation, lineage_id: "new-thread" };
    expect(() => validateExecutionGrant({ ...f.grant, budget_reservation_ref: reference(replacement) },
      { ...f.grantInputs, reservation: replacement }, f.authority)).toThrow("GRANT_RESERVATION");
  });

  it("keeps unknown usage unknown and covers a stopped authoritative checkpoint", () => {
    const f = fixture();
    const usage = {
      ...envelope("USAGE_OBSERVATION_V1"), ...f.task, lineage_id: f.reservation.lineage_id,
      pool_id: limits.pool_id, account_scope: limits.account_scope, account_epoch: 1, unit: limits.unit,
      source: "synthetic", value: null, quality: "unknown", coverage: "unknown", observed_at: now, reset_at: null,
      model: null, reasoning: null, role: "coordinator", run_id: "model-run",
    };
    expect(validateRecord(usage)).toEqual(usage);
    expect(() => validateRecord({ ...usage, value: 0 })).toThrow("USAGE_COVERAGE");
    const input = { current: { ...f.checkpoint, issue_body_digest: f.workspace.issue_body_digest }, receipt: f.workspace, verify: f.authority.verify };
    expect(validateCheckpoint(f.checkpoint, input)).toEqual(f.checkpoint);
    expect(() => validateCheckpoint({ ...f.checkpoint, unresolved_criteria: [] }, input)).toThrow("CHECKPOINT_DROPPED");
    expect(() => validateCheckpoint({ ...f.checkpoint, head_sha: published }, input)).toThrow("STALE_CHECKPOINT");
    f.denied.add("stopped_checkpoint_writer");
    expect(() => validateCheckpoint(f.checkpoint, input)).toThrow("stopped_checkpoint_writer");
  });
});

describe("GF-V03 / GF-V23 evidence and lifecycle", () => {
  it("rejects wrong head, partial required checks, skipped/failed checks and self-review", () => {
    const f = fixture();
    const input = { task: f.task, candidate: f.candidate, plan: f.plan, implementer: worker, verify: f.authority.verify };
    expect(validateVerificationEvidence(f.evidence, input)).toEqual(f.evidence);
    expect(() => validateVerificationEvidence(f.evidence, { ...input, candidate: { ...f.candidate, head_sha: head } })).toThrow("EVIDENCE_CANDIDATE");
    expect(() => validateVerificationEvidence({ ...f.evidence, checks: f.evidence.checks.slice(0, 2) }, input)).toThrow("MISSING_CHECK");
    for (const outcome of ["SKIP", "FAIL", "NOT_APPLICABLE", "INCOMPLETE", "TIMEOUT"]) {
      const checks = f.evidence.checks.map((check) => check.id === "unit-2" ? { ...check, outcome } : check);
      expect(() => validateVerificationEvidence({ ...f.evidence, checks }, input)).toThrow("REQUIRED_CHECK_NOT_PASSED");
    }
    expect(() => validateVerificationEvidence({ ...f.evidence, producer: { ...reviewer, session: worker.session } }, input))
      .toThrow("INDEPENDENT_REVIEW");
  });

  it("reconciles missing acknowledgements, deduplicates events and requires actual merge and PM acceptance", () => {
    const f = fixture();
    const seenEvents = new Map<string, string>();
    const acceptanceCriteria = ["witness-criterion"];
    const input = {
      ...f, seenEvents, goalApproval: f.approval, implementer: worker, acceptanceCriteria,
    };
    let state = { ...f.task, status: "PLANNED", revision: 1, head_sha: head, candidate_digest: null };
    function event(kind: string, payload = artifact(kind), atHead = state.head_sha) {
      return {
        ...envelope("PFM_TASK_EVENT_V1"), ...f.task, event_id: kind.toLowerCase(), source: "fixture",
        expected_revision: state.revision, head_sha: atHead, kind, payload_ref: payload, observed_at: now,
      };
    }
    function apply(value: ReturnType<typeof event>, extra = {}) {
      const result = proposeTaskTransition(state, value, { ...input, ...extra }, f.authority);
      expect(result.disposition).toBe("applied");
      seenEvents.set(result.receipt.event_id, result.receipt.digest);
      if (result.consumeNonce) f.authority.consumedNonces.add(result.consumeNonce);
      state = result.state;
      return result;
    }
    function pmApproval(purpose: "merge" | "acceptance") {
      const result = {
        ...f.approval, ...f.task, purpose, nonce: purpose + "-nonce", candidate_digest: digest(f.candidate),
        decision_scope: [purpose], criteria: purpose === "acceptance" ? acceptanceCriteria : [],
      };
      f.approvedEvents.add(digest(result));
      return result;
    }
    const legacy = { ...f.grant, references: [] };
    expect(() => proposeTaskTransition(state, event("READY", reference(legacy)), { ...input, grant: legacy }, f.authority))
      .toThrow("GRANT_RUNNER_BINDING");
    expect(() => proposeTaskTransition(state, event("READY", reference(f.grant)), {
      ...input, grantInputs: { ...f.grantInputs,
        runtimeIdentity: { ...f.grantInputs.runtimeIdentity, resource_profile: reference(f.runner) } },
    }, f.authority)).toThrow("GRANT_RUNTIME_IDENTITY");
    expect(state.status).toBe("PLANNED");
    apply(event("READY", reference(f.grant)));
    const start = event("RUNNING");
    f.denied.add("native_start_acknowledgement");
    expect(() => proposeTaskTransition(state, start, input, f.authority)).toThrow("native_start_acknowledgement");
    expect(state.status).toBe("READY");
    f.denied.delete("native_start_acknowledgement");
    apply(start);
    expect(proposeTaskTransition(state, start, input, f.authority).disposition).toBe("duplicate");
    expect(() => proposeTaskTransition(state, { ...start, payload_ref: artifact("conflict") }, input, f.authority))
      .toThrow("EVENT_ID_CONFLICT");
    expect(() => proposeTaskTransition(state, event("ACCEPTED"), input, f.authority)).toThrow("EVENT_TRANSITION");
    const publication = event("PUBLISHED", artifact("publication"), published);
    f.denied.add("complete_publication");
    expect(() => proposeTaskTransition(state, publication, input, f.authority)).toThrow("complete_publication");
    f.denied.delete("complete_publication");
    apply(publication);
    expect(() => proposeTaskTransition(state, event("VERIFYING", artifact("verify"), head), input, f.authority)).toThrow("EVENT_HEAD");
    const verifying = event("VERIFYING");
    expect(() => proposeTaskTransition(state, { ...verifying, expected_revision: verifying.expected_revision - 1 }, input, f.authority))
      .toThrow("EVENT_REVISION");
    apply(verifying);
    apply(event("MERGE_READY", reference(f.evidence)));
    const candidateApproval = pmApproval("merge");
    const merged = event("MERGED");
    f.denied.add("actual_merge_confirmation");
    expect(() => proposeTaskTransition(state, merged, { ...input, candidateApproval }, f.authority)).toThrow("actual_merge_confirmation");
    f.denied.delete("actual_merge_confirmation");
    apply(merged, { candidateApproval });
    expect(state.status).toBe("MERGED");
    const acceptance = pmApproval("acceptance");
    apply(event("ACCEPTED", reference(acceptance)), { candidateApproval: acceptance });
    expect(state.status).toBe("ACCEPTED");
    expect([...f.authority.consumedNonces]).toEqual(["merge-nonce", "acceptance-nonce"]);
  });

  it("holds a UAT-required candidate without independently authenticated human UAT", () => {
    const f = fixture("required");
    const state = { ...f.task, status: "VERIFYING", revision: 2, head_sha: published, candidate_digest: digest(f.candidate) };
    const event = {
      ...envelope("PFM_TASK_EVENT_V1"), ...f.task, event_id: "merge-ready", source: "fixture",
      expected_revision: state.revision, head_sha: published, kind: "MERGE_READY",
      payload_ref: reference(f.evidence), observed_at: now,
    };
    const input = { ...f, seenEvents: new Map(), goalApproval: f.approval, implementer: worker };
    expect(() => proposeTaskTransition(state, event, input, f.authority)).toThrow("human_uat_acceptance");
    expect(proposeTaskTransition(state, { ...event, event_id: "uat-pending", kind: "UAT_PENDING" }, input, f.authority)
      .state.status).toBe("UAT_PENDING");
  });
});
