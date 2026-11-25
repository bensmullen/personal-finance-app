import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const load = (name: string) => import(new URL(`../tools/codex/goal-framework/${name}.mjs`, import.meta.url).href);
const { canonicalJson, digest, goalControlDigest, inspectV3Body, proposeTaskTransition } = await load("contracts");
const { censusBoundaries, schemas } = await load("schemas/v1");
const { createRunnerAdapter } = await load("adapters/runner");
const { levelOneBody, pinnedV3Parser, sha256 } = await load("authorization");
const { openLifecycle } = await load("lifecycle");
const { openResourceLedger } = await load("resources");
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
const pool = { pool_id: limits.pool_id, account_scope: limits.account_scope, unit: limits.unit };
const hostEstimate = { cpu_millicores: 100, memory_mib: 128, processes: 1, disk_mib: 10, ci_minutes: 0, test_slots: 0 };
const actual = { model: "fixture-model", reasoning: "fixture-effort", surface: "local", runtime: "fixture-runtime" };
const profile = { ...actual, id: "fixture-profile", status: "verified", evidence: ref("runtime-probe"),
  max_risk: "cross-cutting", financial_review: true, operations: ["implementation"] };
const cloudProfile = { ...profile, id: "fixture-cloud-profile", surface: "cloud", runtime: "fixture-cloud-runtime" };
const registry = { ...JSON.parse(readFileSync(new URL("../tools/codex/goal-framework/profiles.json", import.meta.url), "utf8")), profiles: [profile, cloudProfile] };
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

function fixture({ realResources = false } = {}) {
  const journal = temporary();
  const firstDirectory = temporary();
  const otherDirectory = temporary();
  let now = at(1);
  let phaseFault: string | null = null;
  const denied = new Set<string>();
  const boundaries = new Map<string, (value: any) => boolean>();
  const humanEvents = new Set<string>();
  const runBindings = new Map<string, string>();
  const runBinding = (budget: ReturnType<typeof ref>, fence: number, directory: string, environment: string,
    owner: string, authorizationId: string) => digest([budget, fence, directory, environment, owner, authorizationId]);
  const verify = (boundary: string, value: unknown) => {
    if (denied.has(boundary)) return false;
    if (boundary === "human_approval") return humanEvents.has(digest(value));
    if (boundaries.has(boundary)) return boundaries.get(boundary)!(value);
    if (realResources && boundary === "lifecycle_active_run_binding") {
      const { task, workspace, run } = value as { task: { budget: ReturnType<typeof ref>; fence: number };
        workspace: { directory: string; environment: string; owner: string; authorization_id: string };
        run: { native_run_id: string } };
      return runBindings.get(run.native_run_id) === runBinding(task.budget, task.fence, workspace.directory,
        workspace.environment, workspace.owner, workspace.authorization_id);
    }
    return true;
  };
  const parseSaved = (issue: { body: string }) => ({ ...inspectV3Body(issue.body),
    parser_revision: "c".repeat(40), parser_digest: sha256(root) });
  const resourceRuns = new Map<string, unknown>();
  const resourceLedger = realResources ? openResourceLedger({ directory: temporary(), ledgerId: "fixture-resources",
    initialize: true, verify, clock: () => now, registry, policy: {
      pools: [{ ...pool, ceiling: 100, pilot_ceiling: 20, initial_epoch: 1 }], snapshot_max_age_ms: 90 * 60_000,
      pilot_max_ms: 120 * 60_000,
      host: { cpu_millicores: 1000, memory_mib: 1024, processes: 8, disk_mib: 100, ci_minutes: 0, test_slots: 0 },
      goal_calls: { calls: 8, continuations: 5, repairs: 2 }, task_calls: { calls: 8, continuations: 5, repairs: 2 },
    } }) : null;
  resourceLedger?.snapshot("available", { ...pool, account_epoch: 1, source: "fixture-counter", observed_at: now,
    reset_at: at(90), evidence: ref("quota"), quality: "observed", coverage: "complete", remaining: 100 });
  const options = { directory: journal, ledgerId: "fixture-lifecycle", verify, parseSaved,
    resources: resourceLedger ?? { lookup: (id: string) => resourceRuns.get(id) }, consumedNonces: new Set<string>(), clock: () => now };
  const ledger = openLifecycle({ ...options, initialize: true });
  const reopen = () => openLifecycle({ ...options, fault: (phase: string) => {
    if (phase === phaseFault) throw Object.assign(new Error("simulated disk-full"), { code: "ENOSPC" });
  } });
  function goalAuthority(goal_issue: number, reviewLimit: number) {
    const goalControl = { ...envelope("PFM_GOAL_V1"), goal_issue, control_revision: 1, observation_revision: 0,
      outcome: "One reviewable lifecycle result.", requirement_refs: ["GF-R07"], approved_decisions: [decision], exclusions: [],
      decision_authority: { financial: "pm", product: "pm", privacy: "pm", security: "pm", release: "pm", uat: "pm", activation: "pm", implementation: "task" },
      phase_gates: { alignment: "aligned", planning: "planned", implementation: "written", verification: "checked" },
      budget_policy: limits, concurrency_policy: { implementation_writers: 2, read_only_workers: 2, review_backlog: reviewLimit },
      merge_policy: { tier: "manual" }, uat_policy: "not_required", completion_evidence: ["review"], approval: ref("pending") };
    const goalKeys = { goal_issue, goal_revision: 1, goal_control_digest: goalControlDigest(goalControl) };
    const approval = { ...envelope("PFM_APPROVAL_V1"), ...goalKeys,
      producer: { role: "pm", actor: "operator", session: "human-session" }, purpose: "goal", merge_tier: "manual",
      decision_scope: ["product", "financial"], candidate_digest: null, task_issue: null, task_revision: null,
      criteria: [], channel: "human-approval", nonce: `approval-${goal_issue}`, expires_at: at(90) };
    humanEvents.add(digest(approval));
    return { goalKeys, approval, goal: { ...goalControl, approval: recordRef(approval) } };
  }
  const goalByTask = new Map<number, ReturnType<typeof goalAuthority>["goalKeys"]>();

  function prepare({ issueNumber = 365, fence = 1, directory = firstDirectory, environment = "local",
    target = branch, base = head, paths = [primary], issueBody = body(paths, target), taskRevision = 1,
    upstream = true, resource = "shared-register", attempt = "initial", goalIssue = 362, reviewLimit = 2, expires = 40,
    selectedProfile = profile } = {}) {
    const { goalKeys, goal, approval } = goalAuthority(goalIssue, reviewLimit);
    goalByTask.set(issueNumber, goalKeys);
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
      runtime_profile_ref: realResources ? recordRef(selectedProfile) : ref("profile"), estimated_ceiling: 2,
      carries: { account_liability: 0, goal_liability: 0, task_liability: 0, model_calls: 0, continuations: 0 },
      max_admitted_model_calls: 1, max_admitted_continuations: 0, expires_at: at(expires),
      state: "reserved", native_run_id: null, terminal_ack: null };
    let budget = recordRef(reservation);
    if (resourceLedger) {
      resourceLedger.reserve(`reserve-${fence}`, { reservation, operation: "implementation", attempt, pilot: true,
        host: hostEstimate, fence: `writer-${fence}`, goal_key: `goal-${goalIssue}`, parent: null });
      budget = recordRef(resourceLedger.lookup(reservation.id).reservation);
    } else {
      resourceRuns.set(reservation.id, { reservation, status: "reserved" });
    }
    return { issue, goal, approval, workspace, observation, remote, census, routes, lineage_id, resource, attempt,
      task_revision: taskRevision, budget, audit: ref("full-audit"),
      alignment: { approved_goal_revision: 1, goal_control_digest: goalKeys.goal_control_digest, decisions: [decision],
        unresolved: [], risk: "cross-cutting", independentOutcome: true, coherent: true, relatedBatch: false } };
  }

  function started(input: ReturnType<typeof prepare>) {
    const native_run_id = `native-${input.budget.id}`;
    if (resourceLedger) {
      const { writer_fence, directory, environment, receipt_owner } = input.workspace;
      runBindings.set(native_run_id, runBinding(input.budget, writer_fence, directory, environment, receipt_owner,
        input.observation.receipt.authorization_id));
    } else {
      const run = resourceRuns.get(input.budget.id) as { reservation: unknown };
      resourceRuns.set(input.budget.id, { ...run, status: "started", native_run_id, actual_profile_status: "matches" });
    }
    return { ...input, native_run_id };
  }

  function event(kind: string, id: string, expected_revision: number, input: unknown, task_issue = 365, head_sha = head) {
    return { event_id: id, source: "fixture-provider", repository, goal_issue: goalByTask.get(task_issue)?.goal_issue ?? 362, goal_revision: 1, task_issue,
      expected_revision, head_sha, kind, observed_at: now, payload_ref: { id: `payload-${id}`, digest: sha256(canonicalJson(input, 1024 * 1024)) } };
  }

  function submit(kind: string, id: string, revision: number, input: unknown, issue = 365, base = head) {
    return ledger.submit(event(kind, id, revision, input, issue, base), input);
  }

  function claimed(input = prepare()) {
    submit("prepare", "prepare", 0, input);
    submit("claim", "claim", 1, started(input));
    return input;
  }

  function withContext<T extends { workspace: ReturnType<typeof prepare>["workspace"]; terminal: ReturnType<typeof ref> }>(
    input: T, taskRevision = 1,
  ) {
    const { workspace, terminal } = input;
    const current_context = { settled_decisions: [decision], unresolved_criteria: ["independent-review"], blockers: [] };
    const context_checkpoint = { ...envelope("CONTEXT_CHECKPOINT_V1"), ...goalByTask.get(workspace.task_issue), ...current_context,
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

  function publication(input: ReturnType<typeof prepare>, intent_id: string, desired = nextHead) {
    const fence = input.workspace.writer_fence;
    const observation = { ...input.observation, head: desired, paths: [primary] };
    const candidate = { candidate: true, head_sha: desired, fence, authorization_id: input.observation.receipt.authorization_id,
      evidence: ref("candidate"), observation: { ...observation, receipt: { ...observation.receipt, status: "active" } } };
    const result = withContext({ intent_id, outcome: "applied", fence, evidence: ref("found-remote-head"), terminal: ref("owner-stop"),
      workspace: { ...input.workspace, head_sha: desired, upstream_head_sha: desired }, remote: { ...input.remote, head: desired },
      observation: { ...observation, upstream_head: desired, receipt: { ...observation.receipt, status: "closed" } } });
    return { candidate, result };
  }

  return { journal, ledger, resourceLedger, prepare, started, claimed, closeUnpublished, withContext, publication, event, submit, reopen, denied, otherDirectory,
    verify, boundaries, parseSaved, clock: () => now,
    fault: (phase: string | null) => { phaseFault = phase; }, time: (minutes: number) => { now = at(minutes); } };
}

describe("GF-06 offline adapter composition", () => {
  it.each([profile, cloudProfile])("uses both journals and fresh authority when resuming on $surface", (targetProfile) => {
    const f = fixture({ realResources: true });
    const resources = f.resourceLedger;
    const admissions = new Map<string, any>();
    const effects = new Map<string, string>();
    const startProofs = new Set<string>();
    const terminalProofs = new Map<string, { digest: string; nativeId: string }>();
    let localEvidence = false;
    let killSwitch = false;
    let launchCount = 0;
    let checkpointCount = 0;
    let previous: any;
    let publication: ReturnType<typeof f.publication>;
    f.boundaries.set("adapter_local_certification_before_cloud", (value) => localEvidence && value.repository === repository);
    f.boundaries.set("resource_start_ack", ({ data }) => startProofs.has(digest(data)));
    f.boundaries.set("resource_terminal_ack", ({ data }) => terminalProofs.get(data.reservation_id)?.digest === digest(data));
    f.boundaries.set("adapter_run_binding", ({ admission }) =>
      digest(admissions.get(admission.reservation.id)) === digest(admission));
    f.boundaries.set("lifecycle_admissions_open", () => !killSwitch);
    f.boundaries.set("resource_reservation_authority", (run) => run.operation === "implementation");

    function configured(input: ReturnType<typeof f.prepare>, selected: typeof profile) {
      const receipt = input.observation.receipt;
      const reservation = resources.lookup(input.budget.id).reservation;
      const identity = { repository, goal_issue: reservation.goal_issue, goal_revision: reservation.goal_revision,
        task_issue: reservation.task_issue, head_sha: input.workspace.head_sha };
      const keys = { repository, goal_issue: reservation.goal_issue, goal_revision: reservation.goal_revision,
        goal_control_digest: reservation.goal_control_digest, task_issue: reservation.task_issue,
        task_revision: reservation.task_revision, lineage_id: reservation.lineage_id };
      const capability = { status: "verified", evidence: [ref("fixture-control-observation")] };
      const runner = { ...envelope("RUNNER_CAPABILITIES_V1", `runner-${selected.surface}`),
        surface: selected.surface, product: "synthetic-runner", runtime_version: "installed-version",
        tool_version: "installed-tool", authentication_ref: ref(`fixture-auth-${selected.surface}`),
        operations: Object.fromEntries(Object.keys(schemas.RUNNER_CAPABILITIES_V1.properties.operations.properties)
          .map((name) => [name, capability])) };
      const runtime = { runner, transport: "fixture-transport", config_digest: digest("fixture-config"),
        permissions_digest: digest("fixture-permissions"), control_revision: f.parseSaved(input.issue).parser_revision,
        runtime: selected.runtime, resource_profile: recordRef(selected), native: Object.fromEntries([
          "hard_ceiling", "deadline_watchdog", "host_isolation", "foreground_capacity", "kill_switch", "publication_fence",
          "late_usage", "artifact_retention", "credential_separation", "native_identity",
        ].map((name) => [name, capability])) };
      const metadata = { surface: runner.surface, product: runner.product, runtime_version: runner.runtime_version,
        tool_version: runner.tool_version, authentication_ref: runner.authentication_ref, transport: runtime.transport,
        config_digest: runtime.config_digest, permissions_digest: runtime.permissions_digest,
        control_revision: runtime.control_revision, runtime: runtime.runtime, resource_profile: runtime.resource_profile };
      const grantId = `execution-${receipt.authorization_id}`;
      const workspaceRef = recordRef(input.workspace);
      const runnerBinding = { ...envelope("RUNNER_PROFILE_BINDING_V1", `binding-${receipt.authorization_id}`), ...keys,
        runner_ref: recordRef(runner), resource_profile_ref: recordRef(selected), budget_reservation_ref: input.budget,
        workspace_receipt_ref: workspaceRef, grant_id: grantId, authorization_id: receipt.authorization_id,
        writer_fence: input.workspace.writer_fence, surface: selected.surface, transport: runtime.transport,
        config_digest: runtime.config_digest, permissions_digest: runtime.permissions_digest, control_revision: runtime.control_revision,
        runtime: selected.runtime, model: selected.model, reasoning: selected.reasoning, expires_at: at(30), revocation_ref: null };
      const grant = { ...envelope("EXECUTION_GRANT_V1", grantId), ...keys, references: [recordRef(runnerBinding)],
        issue_body_digest: receipt.body_digest, branch, head_sha: identity.head_sha, v3_marker: "PFM_TASK_V3",
        workspace_receipt_ref: workspaceRef, scope_census_ref: recordRef(input.census), runtime_profile_ref: recordRef(runner),
        budget_reservation_ref: input.budget, writer_fence: input.workspace.writer_fence,
        authorization_id: receipt.authorization_id, expires_at: at(30), revocation_ref: null };
      const context = { telemetry: null, session: { opened_at: at(0), deadline: at(20), lineage_deadline: at(90) } };
      const live = { identity, input, grant, runnerBinding, context };
      const grantInputs = { goal: input.goal, approval: input.approval, taskAlignment: input.alignment,
        savedBody: input.issue.body, census: input.census, scopeRequirements: input.routes, workspace: input.workspace,
        runner, reservation, runtimeIdentity: metadata, runnerBinding, resourceProfile: selected };
      const request = { task_issue: identity.task_issue, grant: recordRef(grant) };
      const run = { task_issue: identity.task_issue, reservation: input.budget,
        fence: input.workspace.writer_fence, native_run_id: null };
      const expectedBinding = digest({ grant, binding: runnerBinding, runner, profile: selected,
        runtime: metadata, reservation, workspace: input.workspace });
      const verify = (boundary: string, value: any) => {
        if (!f.verify(boundary, value)) return false;
        if (boundary === "live_runner_resource_profile_binding") return digest(value) === expectedBinding;
        if (boundary === "adapter_native_admission") return !killSwitch && readyGrant?.digest === value.grant.digest;
        if (boundary === "adapter_checkpoint_stopped_writer") return value.run.native_run_id != null
          && terminalProofs.get(value.admission.reservation.id)?.nativeId === value.run.native_run_id
          && value.publication.intent_id === publication.result.intent_id;
        if (boundary === "adapter_effect_receipt") return effects.get(value.intent.idempotency_key) === value.observed.intent_digest;
        return true;
      };
      let readyGrant: ReturnType<typeof ref> | undefined;
      const markReady = () => {
        const state = { ...keys, status: "PLANNED", revision: 1, head_sha: identity.head_sha, candidate_digest: null };
        const event = { ...envelope("PFM_TASK_EVENT_V1"), ...keys, event_id: `ready-${grantId}`,
          source: "fixture-admission", expected_revision: 1, head_sha: identity.head_sha, kind: "READY",
          payload_ref: request.grant, observed_at: f.clock() };
        const { lineage_id: _lineage, ...eventRecord } = event;
        const proposal = proposeTaskTransition(state, eventRecord, { grant, grantInputs, seenEvents: new Map() },
          { verify, now: f.clock(), consumedNonces: new Set() });
        expect(proposal.state.status).toBe("READY");
        readyGrant = proposal.state.grant_ref;
      };
      let controlActive = false;
      let dropStartAck = true;
      let dropCheckpointAck = true;
      const host = {
        verify, clock: f.clock, parseSaved: f.parseSaved, consumedNonces: new Set(), resources, lifecycle: f.ledger,
        inventory: () => runtime, preparation: () => live,
        resolveResourceProfile: (reference: ReturnType<typeof ref>) => registry.profiles.find((item) =>
          digest(recordRef(item)) === digest(reference)),
        readAdmission: (reference: ReturnType<typeof ref>) => admissions.get(reference.id),
        previousCheckpoint: () => previous,
        commitEffect(intent: any) {
          // One synthetic supervisor serializes and revalidates before either journal can
          // authorize a fake effect. The journals are the real GF-03 and GF-05 implementations.
          const intentDigest = digest(intent);
          const key = intent.idempotency_key;
          const old = effects.get(key);
          if (old) {
            if (old !== intentDigest) throw new Error("conflicting intent");
            return { intent_digest: old, status: "duplicate", evidence: ref("effect-replay") };
          }
          if (controlActive) throw new Error("global supervisor fence unavailable");
          controlActive = true;
          try {
            const task = f.ledger.inspect(repository, identity.task_issue);
            if (intent.operation === "launch" || intent.operation === "resume") {
              if (!verify("adapter_native_admission", intent) || task.phase !== "prepared" || task.fence !== intent.fence
                || task.head_sha !== intent.head_sha || task.workspace.receipt_digest !== receipt.digest
                || digest(recordRef(live.runnerBinding)) !== digest(intent.runner_binding)
                || resources.lookup(intent.reservation.id).status !== "reserved") throw new Error("stale admission");
              admissions.set(intent.reservation.id, intent);
              if (resources.begin(key, intent.reservation.id).disposition !== "committed") throw new Error("uncertain begin");
              effects.set(key, intentDigest);
              launchCount += 1;
              if (dropStartAck) throw new Error("lost start response");
            } else if (intent.operation === "stop") {
              if (digest(admissions.get(intent.reservation.id)) !== intent.admission_digest) throw new Error("wrong admission");
              resources.requestStop(key, intent.reservation.id);
              effects.set(key, intentDigest);
            } else {
              if (task.intent?.id !== intent.publication.intent_id || task.intent.expected !== intent.publication.expected
                || task.intent.desired !== intent.publication.desired || task.fence !== intent.fence
                || resources.lookup(intent.reservation.id).status !== "terminal") throw new Error("stale checkpoint");
              checkpointCount += 1;
              effects.set(key, intentDigest);
              f.submit("reconcile", `reconcile-${grantId}`, task.revision, publication.result, identity.task_issue, task.head_sha);
              if (dropCheckpointAck) throw new Error("lost checkpoint response");
            }
            return { intent_digest: intentDigest, status: "recorded", evidence: ref("supervisor-effect") };
          } finally {
            controlActive = false;
          }
        },
      };
      const adapter = createRunnerAdapter({ surface: selected.surface, repository, host });
      const started = f.started(input);
      const start = () => {
        const { surface, runtime: runtimeId, model, reasoning } = selected;
        const data = { reservation_id: input.budget.id, native_run_id: started.native_run_id,
          actual: { surface, runtime: runtimeId, model, reasoning }, evidence: ref("native-start") };
        startProofs.add(digest(data));
        resources.started(`started-${grantId}`, data);
        const task = f.ledger.inspect(repository, identity.task_issue);
        expect(f.submit("claim", `claim-${grantId}`, task.revision, started, identity.task_issue, task.head_sha).phase).toBe("claimed");
        expect(f.reopen().assertWriter({ repository, issue: identity.task_issue, fence: run.fence,
          authorization_id: receipt.authorization_id, native_run_id: started.native_run_id, paths: [primary],
          evidence: ref("scoped-writer") })).toBe(true);
      };
      const stop = () => {
        expect(adapter.stop(run).status).toBe("recorded");
        const terminal = { reservation_id: input.budget.id, native_run_id: started.native_run_id,
          outcome: "stopped", evidence: ref("native-terminal") };
        expect(() => resources.terminal(`terminal-${grantId}`, terminal)).toThrow("resource_terminal_ack");
        terminalProofs.set(input.budget.id, { digest: digest(terminal), nativeId: terminal.native_run_id });
        resources.terminal(`terminal-${grantId}`, terminal);
        expect(adapter.observe(run)).toMatchObject({ status: "terminal", billed: null, liability: 4 });
        resources.settle(`bill-${grantId}`, { ...terminal, billed: 1 });
        resources.settle(`late-bill-${grantId}`, { ...terminal, billed: 3 });
        expect(adapter.observe(run)).toMatchObject({ status: "terminal", billed: 3, liability: 3 });
      };
      return { adapter, host, live, runtime, request, run, markReady, start, stop,
        retainAcks() { dropStartAck = false; dropCheckpointAck = false; } };
    }

    const first = f.prepare();
    const local = configured(first, profile);
    expect(local.adapter.prepare(local.request).status).toBe("observed");
    expect(f.ledger.inspect(repository, 365)).toBeNull();
    f.submit("prepare", "prepare-local", 0, first);
    expect(() => local.adapter.launch(local.request)).toThrow("adapter_native_admission");
    local.markReady();
    killSwitch = true;
    expect(() => local.adapter.launch(local.request)).toThrow("adapter_native_admission");
    killSwitch = false;
    const trust = local.runtime.control_revision;
    local.runtime.control_revision = nextHead;
    expect(() => local.adapter.launch(local.request)).toThrow("ADAPTER_CONTROL_REVISION");
    local.runtime.control_revision = trust;
    const resolveProfile = local.host.resolveResourceProfile;
    local.host.resolveResourceProfile = () => ({ ...profile, evidence: ref("changed-registry-entry") });
    expect(() => local.adapter.launch(local.request)).toThrow("GRANT_RESOURCE_PROFILE");
    local.host.resolveResourceProfile = resolveProfile;
    local.live.grant.expires_at = at(1);
    expect(() => local.adapter.launch(local.request)).toThrow("GRANT_INACTIVE");
    local.live.grant.expires_at = at(30);
    local.live.context.session.deadline = at(1);
    expect(() => local.adapter.launch(local.request)).toThrow("ADAPTER_CONTEXT");
    local.live.context.session.deadline = at(20);
    const quota = (remaining: number) => ({ ...pool, account_epoch: 1, source: "fixture-counter", observed_at: f.clock(),
      reset_at: at(90), evidence: ref(`quota-${remaining}`), quality: "observed", coverage: "complete", remaining });
    f.time(2);
    resources.snapshot("quota-depleted", quota(2));
    expect(local.adapter.launch(local.request).status).toBe("reconcile");
    expect(resources.lookup(first.budget.id)).toMatchObject({ status: "reserved", liability: 4 });
    f.time(3);
    resources.snapshot("quota-restored", quota(100));
    expect(launchCount).toBe(0);
    expect(local.adapter.launch(local.request).status).toBe("reconcile");
    expect(local.adapter.launch(local.request).status).toBe("reconcile");
    expect(local.adapter.observe(local.run)).toMatchObject({ status: "ambiguous", liability: 4 });
    expect(launchCount).toBe(1);
    local.start();
    publication = f.publication(first, "checkpoint-local");
    f.submit("begin-checkpoint", "checkpoint-local", 2, publication.candidate);
    expect(() => local.adapter.checkpoint(local.run)).toThrow("WORKER_ACTIVE");
    const transport = local.runtime.transport;
    local.runtime.transport = "replacement-after-start";
    local.stop();
    expect(local.adapter.checkpoint(local.run).status).toBe("reconcile");
    const checkpoint = recordRef(publication.result.context_checkpoint);
    expect(local.adapter.checkpoint(local.run)).toMatchObject({ status: "reconcile", checkpoint });
    expect(checkpointCount).toBe(1);
    local.runtime.transport = transport;
    f.submit("review-disposition", "resume-authority", 4, { outcome: "repair", evidence: ref("review") }, 365, nextHead);
    const priorFrom = (result: typeof publication.result, budget: typeof first.budget) => ({
      checkpoint: result.context_checkpoint, reservation: budget,
      live: { receipt: result.workspace, current: { ...result.context_checkpoint,
        issue_body_digest: result.workspace.issue_body_digest,
        required_artifacts: result.context_checkpoint.artifacts, open_gates: [ref("review-gate")] } },
      compaction: { kind: "deterministic" },
    });
    previous = priorFrom(publication.result, first.budget);
    const next = f.prepare({ fence: 2, base: nextHead, attempt: "continuation", selectedProfile: targetProfile });
    const resumed = configured(next, targetProfile);
    f.submit("resume", "prepare-resume", 5, next, 365, nextHead);
    resumed.markReady();
    resumed.retainAcks();
    if (targetProfile.surface === "cloud") {
      expect(() => resumed.adapter.resume(resumed.request, checkpoint)).toThrow("local_certification_before_cloud");
      expect(() => resumed.adapter.stop(local.run)).toThrow("RUN_BINDING");
    }
    localEvidence = true;
    expect(() => resumed.adapter.resume(resumed.request, ref("wrong-checkpoint"))).toThrow("ADAPTER_RESUME_CHECKPOINT");
    expect(resumed.adapter.resume(resumed.request, checkpoint).status).toBe("recorded");
    expect(resumed.adapter.resume(resumed.request, checkpoint).status).toBe("reconcile");
    expect(launchCount).toBe(2);
    resumed.start();
    const finalHead = "d".repeat(40);
    publication = f.publication(next, "checkpoint-resumed", finalHead);
    f.submit("begin-checkpoint", "checkpoint-resumed", 7, publication.candidate, 365, nextHead);
    resumed.stop();
    expect(resumed.adapter.checkpoint(resumed.run).status).toBe("recorded");
    expect(checkpointCount).toBe(2);
    f.submit("review-disposition", "return-authority", 9, { outcome: "repair", evidence: ref("review") }, 365, finalHead);
    previous = priorFrom(publication.result, next.budget);
    const last = f.prepare({ fence: 3, base: finalHead, attempt: "continuation" });
    const returned = configured(last, profile);
    f.submit("resume", "prepare-return", 10, last, 365, finalHead);
    returned.markReady();
    returned.retainAcks();
    expect(returned.adapter.resume(returned.request, recordRef(previous.checkpoint)).status).toBe("recorded");
    returned.start();
    returned.stop();
    expect(launchCount).toBe(3);
  });
});

describe("GF-V03, GF-V04, GF-V07 and GF-V23: supervised lifecycle", () => {
  it("reserves prospective outcomes across goals and retains both slots through publication and journal replay", () => {
    const f = fixture();
    const a = f.prepare();
    const b = f.prepare({ issueNumber: 366, fence: 2, target: "codex/second", resource: "second" });
    const c = f.prepare({ issueNumber: 367, fence: 3, target: "codex/third", resource: "third", goalIssue: 363 });
    f.submit("prepare", "a", 0, a);
    f.submit("prepare", "b", 0, b, 366);
    f.submit("prepare", "c", 0, c, 367);
    f.submit("claim", "writer-a", 1, f.started(a));
    f.submit("claim", "writer-b", 1, f.started(b), 366);
    const first = f.publication(a, "push-a");
    const second = f.publication(b, "push-b");
    f.submit("begin-checkpoint", "push-a", 2, first.candidate);
    f.submit("reconcile", "published-a", 3, first.result);
    const third = f.started(c);
    const claim = f.event("claim", "writer-c", 1, third, 367);
    expect(() => f.reopen().submit(claim, third)).toThrow("REVIEW_BACKLOG");
    expect(f.submit("begin-checkpoint", "push-b", 2, second.candidate, 366).phase).toBe("checkpoint-pending");
    expect(() => f.reopen().submit(claim, third)).toThrow("REVIEW_BACKLOG");
    expect(f.submit("reconcile", "published-b", 3, second.result, 366).phase).toBe("published");
    expect(() => f.reopen().submit(claim, third)).toThrow("REVIEW_BACKLOG");
    const review = { outcome: "review-recorded", evidence: ref("independent-review") };
    f.denied.add("independent_lifecycle_review");
    expect(() => f.submit("review-disposition", "review-a", 4, review, 365, nextHead)).toThrow("independent_lifecycle_review");
    f.denied.delete("independent_lifecycle_review");
    f.submit("review-disposition", "review-a", 4, review, 365, nextHead);
    expect(f.reopen().submit(claim, third).phase).toBe("claimed");
    expect(f.reopen().submit(claim, third)).toEqual({ disposition: "duplicate", revision: 2, permit: null });
  });

  it("applies a one-slot goal limit without blocking another goal from using the spare slot", () => {
    const f = fixture();
    const a = f.prepare({ reviewLimit: 1 });
    const b = f.prepare({ issueNumber: 366, fence: 2, target: "codex/second", resource: "second", reviewLimit: 1 });
    const c = f.prepare({ issueNumber: 367, fence: 3, target: "codex/third", resource: "third", goalIssue: 363 });
    f.submit("prepare", "a", 0, a);
    f.submit("prepare", "b", 0, b, 366);
    f.submit("claim", "writer-a", 1, f.started(a));
    const second = f.started(b);
    expect(() => f.submit("claim", "writer-b", 1, second, 366)).toThrow("REVIEW_BACKLOG");
    const first = f.publication(a, "push-a");
    f.submit("begin-checkpoint", "push-a", 2, first.candidate);
    f.submit("reconcile", "published-a", 3, first.result);
    expect(() => f.submit("claim", "writer-b", 1, second, 366)).toThrow("REVIEW_BACKLOG");
    f.submit("prepare", "c", 0, c, 367);
    expect(f.submit("claim", "writer-c", 1, f.started(c), 367).phase).toBe("claimed");
    f.submit("review-disposition", "review-a", 4, { outcome: "review-recorded", evidence: ref("review") }, 365, nextHead);
    expect(f.submit("claim", "writer-b", 1, second, 366).phase).toBe("claimed");
  });

  it("requires a matching authenticated GF-05 start and retains ownership and liability through stop and reconciliation", () => {
    const f = fixture({ realResources: true });
    const resources = f.resourceLedger;
    const input = f.prepare();
    f.submit("prepare", "prepare", 0, input);
    const started = f.started(input);
    const run = { reservation_id: input.budget.id, native_run_id: started.native_run_id, actual, evidence: ref("start") };
    const claim = f.event("claim", "first-mutation", 1, started);
    expect(() => f.ledger.submit(claim, started)).toThrow("LIFECYCLE_ACTIVE_RUN");
    expect(resources.begin("launch-intent", run.reservation_id).disposition).toBe("committed");
    expect(resources.begin("launch-intent", run.reservation_id).disposition).toBe("duplicate");
    expect(resources.lookup(run.reservation_id).status).toBe("ambiguous");
    expect(() => f.reopen().submit(claim, started)).toThrow("LIFECYCLE_ACTIVE_RUN");
    f.denied.add("resource_start_ack");
    expect(() => resources.started("started", run)).toThrow("resource_start_ack");
    f.denied.delete("resource_start_ack");
    resources.started("started", run);
    expect(resources.started("started", run).disposition).toBe("duplicate");
    expect(() => f.submit("claim", "wrong-run", 1, { ...started, native_run_id: "different-run" })).toThrow("LIFECYCLE_ACTIVE_RUN");
    expect(() => f.submit("claim", "wrong-budget", 1, { ...started, budget: ref("different-budget") })).toThrow("LIFECYCLE_RESERVATION");
    expect(() => f.submit("claim", "wrong-session", 1, { ...started, observation: { ...input.observation,
      receipt: { ...input.observation.receipt, authorization_id: "different-session" } } })).toThrow("lifecycle_active_run_binding");
    expect(f.ledger.submit(claim, started)).toMatchObject({ phase: "claimed", revision: 2 });
    expect(f.reopen().submit(claim, started)).toEqual({ disposition: "duplicate", revision: 2, permit: null });
    const writer = { repository, issue: 365, fence: 1, authorization_id: "grant-1", native_run_id: run.native_run_id,
      paths: [primary], evidence: ref("scoped-mutation") };
    expect(f.reopen().assertWriter(writer)).toBe(true);
    expect(() => f.ledger.assertWriter({ ...writer, native_run_id: "different-run" })).toThrow("STALE_WRITER_RUN");
    expect(() => f.ledger.assertWriter({ ...writer, paths: [sibling] })).toThrow("WRITER_SCOPE");
    f.denied.add("live_budget_reservation");
    expect(() => f.ledger.assertWriter(writer)).toThrow("live_budget_reservation");
    f.denied.delete("live_budget_reservation");
    f.denied.add("lifecycle_active_run_binding");
    expect(() => f.ledger.assertWriter(writer)).toThrow("lifecycle_active_run_binding");
    f.denied.delete("lifecycle_active_run_binding");

    const mismatch = f.prepare({ issueNumber: 366, fence: 2, target: "codex/mismatch", resource: "mismatch" });
    f.submit("prepare", "prepare-mismatch", 0, mismatch, 366);
    const mismatched = f.started(mismatch);
    resources.begin("begin-mismatch", mismatch.budget.id);
    resources.started("start-mismatch", { ...run, reservation_id: mismatch.budget.id, native_run_id: mismatched.native_run_id,
      actual: { ...actual, model: "different-model" } });
    expect(resources.lookup(mismatch.budget.id)).toMatchObject({ status: "stop_requested", actual_profile_status: "mismatch" });
    expect(() => f.submit("claim", "mismatch", 1, mismatched, 366)).toThrow("LIFECYCLE_ACTIVE_RUN");

    const expiring = f.prepare({ issueNumber: 367, fence: 3, target: "codex/expiring", resource: "expiring", expires: 4 });
    f.submit("prepare", "prepare-expiring", 0, expiring, 367);
    const expiringRun = f.started(expiring);
    resources.begin("begin-expiring", expiring.budget.id);
    resources.started("start-expiring", { ...run, reservation_id: expiring.budget.id, native_run_id: expiringRun.native_run_id });
    f.time(4);
    expect(resources.lookup(expiring.budget.id).status).toBe("started");
    expect(() => f.submit("claim", "expired", 1, expiringRun, 367)).toThrow("LIFECYCLE_RESERVATION");

    resources.requestStop("request-stop", run.reservation_id);
    expect(() => f.ledger.assertWriter(writer)).toThrow("LIFECYCLE_ACTIVE_RUN");
    expect(f.ledger.inspect(repository, 365)).toMatchObject({ phase: "claimed", budget: input.budget, fence: 1 });
    const terminal = { reservation_id: run.reservation_id, native_run_id: run.native_run_id, outcome: "stopped", evidence: ref("native-stop") };
    resources.terminal("terminal", terminal);
    expect(() => f.ledger.assertWriter(writer)).toThrow("LIFECYCLE_ACTIVE_RUN");
    const publication = f.publication(input, "push");
    f.submit("begin-checkpoint", "push", 2, publication.candidate);
    const reconcile = f.event("reconcile", "late-publication", 3, publication.result);
    expect(f.reopen().submit(reconcile, publication.result).phase).toBe("published");
    expect(f.reopen().submit(reconcile, publication.result)).toEqual({ disposition: "duplicate", revision: 4, permit: null });
    expect(f.reopen().submit(claim, started).permit).toBeNull();
    expect(() => f.submit("acknowledge-stop", "late-stop", 4, publication.result, 365, nextHead)).toThrow("STALE_WRITER");
    expect(() => f.ledger.assertWriter(writer)).toThrow("STALE_WRITER");
    expect(resources.terminal("terminal", terminal).disposition).toBe("duplicate");
    expect(() => resources.terminal("late-terminal", terminal)).toThrow("TERMINAL_PROOF");
    expect(resources.lookup(run.reservation_id)).toMatchObject({ status: "terminal", liability: 4, billed: null });
    resources.settle("billing", { ...terminal, billed: 1 });
    expect(resources.lookup(run.reservation_id)).toMatchObject({ status: "terminal", liability: 1, billed: 1 });
  });

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
    expect(f.submit("claim", "write", 1, f.started(input)).phase).toBe("claimed");
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
    const started = f.started(replacement);
    f.submit("claim", "owner", 2, started);
    expect(() => f.reopen().submit(f.event("claim", "same-branch", 1, b, 366), b)).toThrow("WRITER_CONTENTION");
    expect(() => f.submit("claim", "same-resource", 1, unrelatedBranch, 367)).toThrow("WRITER_CONTENTION");
    const writer = { repository, issue: 365, fence: 4, authorization_id: "grant-4", native_run_id: started.native_run_id,
      paths: [primary], evidence: ref("scope") };
    expect(() => f.ledger.assertWriter({ ...writer, fence: 1, authorization_id: "grant-1" })).toThrow("STALE_WRITER");
    expect(f.ledger.assertWriter(writer)).toBe(true);
    expect(() => f.ledger.assertWriter({ ...writer, paths: [sibling] })).toThrow("WRITER_SCOPE");
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
    f.submit("claim", "new-writer", 9, f.started(expanded));
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
    const started = f.started(narrowed);
    f.submit("claim", "narrow-writer", 14, started);
    expect(() => f.ledger.assertWriter({ repository, issue: 365, fence: 3, authorization_id: "grant-3",
      native_run_id: started.native_run_id, paths: [sibling], evidence: ref("old-path") })).toThrow("WRITER_SCOPE");
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
    f.submit("claim", "claim-first-repair", 5, f.started(repair));
    f.submit("acknowledge-stop", "close-repair-one", 6, finish(repair));
    const second = f.prepare({ fence: 4, attempt: "repair" });
    f.submit("resume", "repair-two", 7, second);
    f.submit("claim", "claim-second-repair", 8, f.started(second));
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
