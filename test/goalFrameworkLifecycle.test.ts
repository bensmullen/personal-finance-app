import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
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
const { openResourceLedger, resourceAttest } = await load("resources");
const { inspectWorkspace, resolveScopedPaths } = await load("workspace");
const { createBootstrapHost } = await load("adapters/bootstrap-host");
const { openPreparationJournal } = await load("adapters/preparation-journal");
const { createSupervisedPreparation, readPreparationRequest } = await load("adapters/supervised-preparation");
const { supervisedHandoff, reviewHookPreparedForAdmission } = await load("adapters/supervised-handoff");

const repository = "bensmullen/personal-finance-app";
const origin = `https://github.com/${repository}.git`;
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
const parserRevision = "c".repeat(40);
const roots: string[] = [];

type Invocation = {
  executable: string; argv: string[]; cwd: string; env: Record<string, string>; timeout_ms: number; output_limit: number;
};
type GitFixture = {
  main: string; realGit: string; git: string; bash: string; python: string; checkout: string; remote: string;
  env: Record<string, string>;
  hookEnv: Record<string, string>;
  run: (cwd: string, ...args: string[]) => string;
  read: (cwd: string, ...args: string[]) => SpawnSyncReturns<string>;
  invoke: (invocation: Invocation, bytes: Buffer) => SpawnSyncReturns<Buffer>;
};
const { disposableGit, journalWitness } = await import(new URL("./fixtures/goalFramework/supervisor/disposable-git.mjs",
  import.meta.url).href) as { disposableGit: (directory: string) => GitFixture; journalWitness: (hash: typeof digest) => {
    verify: (value: unknown) => boolean;
  } };

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

type PrepareOptions = {
  issueNumber?: number;
  fence?: number;
  directory?: string;
  environment?: string;
  target?: string;
  base?: string;
  paths?: string[];
  issueBody?: string;
  taskRevision?: number;
  upstream?: boolean;
  resource?: string;
  attempt?: "initial" | "continuation" | "repair" | "reassessment";
  goalIssue?: number;
  reviewLimit?: number;
  expires?: number;
  selectedProfile?: typeof profile;
  continuationSlots?: number;
};

function fixture({ realResources = false, parserPython }: { realResources?: boolean; parserPython?: string } = {}) {
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
  const parseSaved = parserPython === undefined
    ? (issue: { body: string }) => ({ ...inspectV3Body(issue.body), parser_revision: parserRevision, parser_digest: sha256(root) })
    : pinnedV3Parser({ source: root, revision: parserRevision, python: parserPython, verify });
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

  function preparationInputs({ issueNumber = 365, target = branch, base = head, paths = [primary],
    issueBody = body(paths, target), taskRevision = 1, resource = "shared-register", goalIssue = 362, reviewLimit = 2,
  }: PrepareOptions = {}) {
    const { goalKeys, goal, approval } = goalAuthority(goalIssue, reviewLimit);
    goalByTask.set(issueNumber, goalKeys);
    const issue = { repository, number: issueNumber, body: issueBody, kind: "issue", state: "open", evidence: ref("saved-issue") };
    const routes = paths.map((_, index) => ({ entry: `route-${index}`, alternative: index === 0 ? "primary" : "fallback" }));
    const boundaries = Object.fromEntries((censusBoundaries as string[]).map((name) =>
      [name, { disposition: "covered", detail: "Independent synthetic witness" }]));
    const census = { ...envelope("SCOPE_CENSUS_V1"), ...goalKeys, task_issue: issueNumber, baseline_sha: base,
      risk: "cross-cutting", review: ref("scope-review"), unresolved: [], required_write_paths: paths, read_only_exclusions: [],
      rows: routes.map((route, index) => ({ ...route, id: `row-${index}`, guard: "Fixture guard", path: paths[index],
        symbol: "writer", ownership: "task_write", boundaries, positive_evidence: [ref("positive")], negative_evidence: [ref("negative")] })) };
    const lineage_id = `lineage-${issueNumber}`;
    return { issue, goal, approval, census, routes, lineage_id, resource, task_revision: taskRevision, audit: ref("full-audit"),
      alignment: { approved_goal_revision: 1, goal_control_digest: goalKeys.goal_control_digest, decisions: [decision],
        unresolved: [] as string[], risk: "cross-cutting", independentOutcome: true, coherent: true, relatedBatch: false } };
  }

  function reserve(input: ReturnType<typeof preparationInputs>,
    { fence = 1, attempt = "initial", expires = 40, selectedProfile = profile,
      continuationSlots = attempt === "continuation" ? 1 : 0 }: PrepareOptions = {}) {
    const { issue, goal, lineage_id, task_revision } = input;
    const goalKeys = { goal_issue: goal.goal_issue, goal_revision: goal.control_revision, goal_control_digest: goalControlDigest(goal) };
    const reservation = { ...envelope("BUDGET_RESERVATION_V1", `reservation-${fence}`), ...goalKeys,
      task_issue: issue.number, task_revision, lineage_id, limits, risk: "cross-cutting",
      runtime_profile_ref: realResources ? recordRef(selectedProfile) : ref("profile"), estimated_ceiling: 2,
      carries: { account_liability: 0, goal_liability: 0, task_liability: 0, model_calls: 0, continuations: 0 },
      max_admitted_model_calls: 1, max_admitted_continuations: continuationSlots, expires_at: at(expires),
      state: "reserved", native_run_id: null, terminal_ack: null };
    let budget = recordRef(reservation);
    if (resourceLedger) {
      resourceLedger.reserve(`reserve-${fence}`, { reservation, operation: "implementation", attempt, pilot: true,
        host: hostEstimate, fence: `writer-${fence}`, goal_key: `goal-${goal.goal_issue}`, parent: null });
      budget = recordRef(resourceLedger.lookup(reservation.id).reservation);
    } else {
      resourceRuns.set(reservation.id, { reservation, status: "reserved" });
    }
    return { budget, attempt };
  }

  function prepare(options: PrepareOptions = {}) {
    const { issueNumber = 365, fence = 1, directory = firstDirectory, environment = "local",
      target = branch, base = head, upstream = true } = options;
    const input = preparationInputs(options);
    const bodyDigest = sha256(input.issue.body);
    const workspace = { ...envelope("WORKSPACE_RECEIPT_V1"), task_issue: issueNumber, directory, environment,
      origin_repository: repository, branch: target, issue_body_digest: bodyDigest, head_sha: base,
      upstream_head_sha: upstream ? base : null, state: "ready", receipt_owner: worker, ready_proof: ref("bootstrap-preflight"), writer_fence: fence };
    const receipt = { status: "prepared", owner: worker, authorization_id: `grant-${fence}`, digest: digest(`grant-${fence}`),
      issue: issueNumber, body_digest: bodyDigest };
    const observation = { directory, environment, branch: target, head: base, base, origin, linked: true,
      upstream: upstream ? `origin/${target}` : null, upstream_head: upstream ? base : null, conflicted: false, dirty: false,
      receipt, paths: [] as string[] };
    const remote = { repository, branch: target, base, head: upstream ? base : null, evidence: ref("remote-head") };
    return { ...input, workspace, observation, remote, ...reserve(input, options) };
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

  return { journal, ledger, resourceLedger, preparationInputs, reserve, prepare, started, claimed, closeUnpublished, withContext, publication, event, submit, reopen, denied, otherDirectory,
    verify, boundaries, parseSaved, clock: () => now,
    fault: (phase: string | null) => { phaseFault = phase; }, time: (minutes: number) => { now = at(minutes); } };
}

describe("GF-06 offline adapter composition", () => {
  function exerciseComposition(targetProfile: typeof profile, quotaRefusal = false, actualHook = false) {
    const gitFixture = actualHook ? disposableGit(temporary()) : null;
    const f = fixture(gitFixture
      ? { realResources: true, parserPython: gitFixture.python } : { realResources: true });
    const resources = f.resourceLedger;
    const admissions = new Map<string, any>();
    const launchIntents = new Map<string, string>();
    const effects = new Map<string, string>();
    const runtimeWorkspaces = new Map<string, { directory: string; environment: string }>();
    const startProofs = new Set<string>();
    const terminalProofs = new Map<string, { digest: string; nativeId: string | null }>();
    const publishedStops = new Map<string, string>();
    let localEvidence = false;
    let killSwitch = false;
    let launchCount = 0;
    let checkpointCount = 0;
    let controlActive = false;
    let previous: any;
    let publication: ReturnType<typeof f.publication>;
    f.boundaries.set("adapter_local_certification_before_cloud", (value) => localEvidence && value.repository === repository);
    f.boundaries.set("resource_start_ack", ({ data }) => startProofs.has(digest(data)));
    f.boundaries.set("resource_terminal_ack", ({ data }) => terminalProofs.get(data.reservation_id)?.digest === digest(data));
    f.boundaries.set("adapter_run_binding", ({ admission }) =>
      digest(admissions.get(admission.reservation.id)) === digest(admission));
    f.boundaries.set("adapter_transfer_stopped_and_published", ({ previous: prior, priorRun, priorAdmission, handoff, task }) =>
      terminalProofs.get(prior.reservation.id)?.nativeId === priorRun.native_run_id
      && publishedStops.get(prior.checkpoint.digest) === digest([prior.reservation, handoff.stopped_writer, priorAdmission.fence])
      && task.fence > priorAdmission.fence);
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
        if (boundary === "live_runner_resource_profile_binding") {
          const mapped = runtimeWorkspaces.get(value.runtime.runtime);
          return mapped?.directory === value.workspace.directory && mapped?.environment === value.workspace.environment
            && digest(value) === expectedBinding;
        }
        if (boundary === "adapter_native_admission") return !killSwitch && readyGrant?.digest === value.grant.digest;
        if (boundary === "adapter_checkpoint_stopped_writer") return value.run.native_run_id != null
          && terminalProofs.get(value.admission.reservation.id)?.nativeId === value.run.native_run_id
          && value.publication.intent_id === publication.result.intent_id;
        if (boundary === "adapter_effect_receipt") return effects.get(value.intent.idempotency_key) === value.observed.intent_digest
          && value.observed.evidence.digest === digest(value.observed.evidence.id)
          && ["effect-replay", "supervisor-effect"].includes(value.observed.evidence.id);
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
      let dropStartAck = true;
      let dropCheckpointAck = true;
      const host = {
        verify, clock: f.clock, parseSaved: f.parseSaved, consumedNonces: new Set(), resources, lifecycle: f.ledger,
        inventory: () => runtime, preparation: () => live,
        resolveResourceProfile: (reference: ReturnType<typeof ref>) => registry.profiles.find((item: typeof profile) =>
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
              if (launchIntents.has(key)) throw new Error("prior admission requires reconciliation");
              launchIntents.set(key, intentDigest);
              if (resources.begin(key, intent.reservation.id).disposition !== "committed") throw new Error("uncertain begin");
              admissions.set(intent.reservation.id, intent);
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
              publishedStops.set(digest(publication.result.context_checkpoint),
                digest([intent.reservation, publication.result.terminal, task.fence]));
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
        return terminal.evidence;
      };
      return { adapter, host, live, runtime, request, run, markReady, start, stop,
        retainAcks() { dropStartAck = false; dropCheckpointAck = false; } };
    }

    const hookFixture = gitFixture && prepareWithActualHook(gitFixture, f);
    const first = hookFixture?.input ?? f.prepare();
    runtimeWorkspaces.set(profile.runtime, { directory: first.workspace.directory, environment: first.workspace.environment });
    const local = configured(first, profile);
    expect(local.adapter.prepare(local.request).status).toBe("observed");
    expect(f.ledger.inspect(repository, 365)).toBeNull();
    f.submit("prepare", "prepare-local", 0, first, 365, first.workspace.head_sha);
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
    runtimeWorkspaces.set(profile.runtime, { directory: f.otherDirectory, environment: "cloud" });
    expect(() => local.adapter.launch(local.request)).toThrow("live_runner_resource_profile_binding");
    runtimeWorkspaces.set(profile.runtime, { directory: first.workspace.directory, environment: first.workspace.environment });
    expect(launchIntents.size).toBe(0);
    expect(launchCount).toBe(0);
    if (quotaRefusal) {
      const quota = (remaining: number) => ({ ...pool, account_epoch: 1, source: "fixture-counter", observed_at: f.clock(),
        reset_at: at(90), evidence: ref(`quota-${remaining}`), quality: "observed", coverage: "complete", remaining });
      f.time(2);
      resources.snapshot("quota-depleted", quota(2));
      f.time(3);
      resources.snapshot("higher-same-epoch-counter", quota(100));
      expect(resources.summary().pools[0].provider_remaining).toBe(2);
      expect(() => resources.begin("independent-begin-check", first.budget.id)).toThrow("BUDGET_EXHAUSTED");
      expect(local.adapter.launch(local.request).status).toBe("reconcile");
      expect(local.adapter.launch(local.request).status).toBe("reconcile");
      expect(launchIntents.size).toBe(1);
      expect(admissions.size).toBe(0);
      expect(effects.size).toBe(0);
      expect(launchCount).toBe(0);
      expect(resources.lookup(first.budget.id)).toMatchObject({ status: "reserved", liability: 4 });
      const terminal = { reservation_id: first.budget.id, native_run_id: null,
        outcome: "not_started", evidence: ref("supervisor-observed-no-native-call") };
      expect(() => resources.terminal("verified-nonstart", terminal)).toThrow("resource_terminal_ack");
      terminalProofs.set(first.budget.id, { digest: digest(terminal), nativeId: null });
      resources.terminal("verified-nonstart", terminal);
      expect(resources.lookup(first.budget.id)).toMatchObject({
        status: "terminal", actual_profile_status: "not_started", liability: 4, billed: null,
      });
      resources.settle("verified-zero-usage", { ...terminal, billed: 0, evidence: ref("supervisor-confirmed-no-usage") });
      expect(resources.lookup(first.budget.id)).toMatchObject({ status: "terminal", billed: 0, liability: 0 });
      return;
    }
    expect(local.adapter.launch(local.request).status).toBe("reconcile");
    expect(local.adapter.launch(local.request).status).toBe("reconcile");
    expect(local.adapter.observe(local.run)).toMatchObject({ status: "ambiguous", liability: 4 });
    expect(launchCount).toBe(1);
    if (hookFixture) {
      const permit = { repository, issue: 365, fence: local.run.fence, native_run_id: `native-${first.budget.id}`,
        authorization_id: first.observation.receipt.authorization_id, paths: [primary], evidence: ref("actual-hook-writer") };
      let revoked = false;
      const guarded = (permissionCheck: () => HookResponse): HookResponse => {
        if (revoked) return { decision: "barrier-deny" };
        try {
          f.ledger.assertWriter(permit);
        } catch {
          return { decision: "barrier-deny" };
        }
        return permissionCheck();
      };
      const mutation = (sessionId = worker, turnId = "hook-turn", path = primary) =>
        guarded(() => hookFixture.mutation(sessionId, turnId, path));
      expect(() => f.ledger.assertWriter(permit)).toThrow();
      expect(mutation()).toEqual({ decision: "barrier-deny" });
      expect(hookFixture.mutationCalls()).toBe(0);
      expect(hookFixture.observe().receipt.status).toBe("prepared");
      local.start();
      expect(() => f.ledger.assertWriter({ ...permit, fence: permit.fence + 1 })).toThrow();
      expect(() => f.ledger.assertWriter({ ...permit, authorization_id: "foreign-authorization" })).toThrow();
      expect(f.ledger.assertWriter(permit)).toBe(true);
      expect(mutation("foreign-session").hookSpecificOutput?.permissionDecision).toBe("deny");
      expect(mutation(worker, "foreign-turn").hookSpecificOutput?.permissionDecision).toBe("deny");
      expect(mutation(worker, "hook-turn", sibling).hookSpecificOutput?.permissionDecision).toBe("deny");
      hookFixture.setRemote(gitFixture!.run(gitFixture!.checkout, "commit-tree", `${first.workspace.head_sha}^{tree}`,
        "-p", first.workspace.head_sha, "-m", "Independently moved published ref"));
      expect(hookFixture.remoteProbe().status).toBe(0);
      expect(mutation().hookSpecificOutput?.permissionDecision).toBe("deny");
      expect(hookFixture.observe().receipt.status).toBe("prepared");
      hookFixture.setRemote(null);
      expect(hookFixture.remoteProbe()).toMatchObject({ status: 2, stdout: "" });
      expect(hookFixture.remoteProbe("unapproved").status).toBe(126);
      expect(guarded(hookFixture.malformedMutation).hookSpecificOutput?.permissionDecision).toBe("deny");
      const admitted = mutation();
      expect(admitted.hookSpecificOutput?.permissionDecision).toBeUndefined();
      expect(Object.keys(admitted)).toEqual([]);
      const active = hookFixture.observe().receipt;
      expect(active).toMatchObject({ status: "active", owner: worker, authorization_id: permit.authorization_id });
      // Repeated hook permission checks preserve the same receipt and writer.
      expect(mutation()).toEqual({});
      expect(hookFixture.observe().receipt).toEqual(active);
      expect(f.ledger.inspect(repository, 365).fence).toBe(permit.fence);
      const permission = guarded(() => hookFixture.permission(worker));
      expect(permission.hookSpecificOutput?.decision?.behavior).toBe("allow");
      expect(guarded(() => hookFixture.permission(worker))).toEqual(permission);
      expect(guarded(() => hookFixture.permission("foreign-session")).hookSpecificOutput?.decision?.behavior).toBe("deny");
      expect(hookFixture.observe().receipt).toEqual(active);
      revoked = true;
      expect(mutation()).toEqual({ decision: "barrier-deny" });
      expect(hookFixture.stop()).toEqual({ continue: true });
      const closed = hookFixture.observe();
      expect(closed.receipt).toMatchObject({ status: "closed", owner: worker, authorization_id: permit.authorization_id });
      expect(mutation()).toEqual({ decision: "barrier-deny" });
      const terminal = local.stop();
      f.boundaries.set("terminal_no_publication_or_live_writer", ({ checkpoint, evidence }) =>
        checkpoint.receipt_digest === closed.receipt.digest && digest(evidence) === digest(terminal));
      const stop = f.withContext({ fence: permit.fence, workspace: first.workspace, observation: closed,
        remote: first.remote, terminal });
      expect(f.submit("acknowledge-stop", "actual-hook-stop", 2, stop, 365, first.workspace.head_sha).phase).toBe("closed");
      expect(() => f.ledger.assertWriter(permit)).toThrow();
      return;
    }
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
    expect(() => f.prepare({ fence: 2, base: nextHead, attempt: "continuation", continuationSlots: 0 }))
      .toThrow("RESERVATION_REQUEST");
    const next = f.prepare({ fence: 2, base: nextHead, attempt: "continuation", selectedProfile: targetProfile,
      ...(targetProfile.surface === "cloud" ? { environment: "cloud", directory: f.otherDirectory } : {}) });
    runtimeWorkspaces.set(targetProfile.runtime, { directory: next.workspace.directory, environment: next.workspace.environment });
    if (targetProfile.surface === "cloud") {
      expect(next.workspace.directory).not.toBe(first.workspace.directory);
      expect(next.workspace.environment).not.toBe(first.workspace.environment);
    }
    expect(next.observation.receipt.authorization_id).not.toBe(first.observation.receipt.authorization_id);
    expect(resources.lookup(next.budget.id).reservation).toMatchObject({
      lineage_id: first.lineage_id, max_admitted_continuations: 1, carries: { model_calls: 1, continuations: 0 },
    });
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
  }

  it.each([profile, cloudProfile])("uses both journals and fresh authority when resuming on $surface", (targetProfile) => {
    exerciseComposition(targetProfile);
  });

  it("reconciles a refused pre-call admission without launching after a higher same-epoch quota report", () => {
    exerciseComposition(profile, true);
  });

  it("composes actual bootstrap and hook preparation with canonical grant and writer admission", () => {
    exerciseComposition(profile, false, true);
  }, 20_000);

  it("resumes an actual closed same-head and behind workspace under fresh stopped-owner authority", () => {
    const git = disposableGit(temporary());
    const f = fixture({ parserPython: git.python });
    const initial = offlineBootstrap(git, f);
    const newResult = initial.supervisor.prepare(initial.envelope);
    expect(newResult.status, initial.diagnostics()).toBe("git-ready");
    const { target, parent, journalOptions } = initial;
    const issueFile = join(parent, "prior-issue.md");
    writeFileSync(issueFile, initial.input.issue.body);
    const hook = actualHook(git, target, issueFile);
    expect(hook("UserPromptSubmit", worker, "prior-turn", { prompt: "PFM_TASK_ISSUE: 365" })
      .hookSpecificOutput?.additionalContext).toContain("authorization accepted");
    expect(hook("Stop", worker, "prior-turn", { last_assistant_message: "TASK_STATUS: BLOCKED\nBLOCKER: disposable witness" }))
      .toEqual({ continue: true });
    const { receipt: prior } = initial.observe();
    expect(prior.status).toBe("closed");
    const pointerPath = join(target, ".codex", "runtime", "latest-task.json");
    const pointerBytes = readFileSync(pointerPath);
    const statePath = join(target, ".codex", "runtime", (JSON.parse(pointerBytes.toString()) as { path: string }).path);
    const stateBytes = readFileSync(statePath);
    const refName = `refs/heads/${branch}`;
    git.run(target, "push", git.remote, `HEAD:${refName}`);
    const sameHead = offlineBootstrap(git, f, undefined, { target, published: git.main, prior }, journalOptions);
    f.denied.add("bootstrap_stopped_published_owner");
    expect(() => sameHead.supervisor.prepare(sameHead.envelope)).toThrow("bootstrap_stopped_published_owner");
    expect(sameHead.effects()).toBe(0);
    f.denied.delete("bootstrap_stopped_published_owner");
    const result = sameHead.supervisor.prepare(sameHead.envelope);
    expect(result.status, sameHead.diagnostics()).toBe("git-ready");
    expect(sameHead.reopen().prepare(sameHead.envelope)).toEqual(result);
    expect(sameHead.effects()).toBe(1);
    expect(sameHead.observe()).toMatchObject({ receipt: prior, upstream: `origin/${branch}`, upstream_head: git.main });
    expect(supervisedHandoff(sameHead.envelope, sameHead.reopen(), {})).toMatchObject({ status: "PREPARATION_ONLY", head: git.main });
    writeFileSync(statePath, Buffer.concat([stateBytes, Buffer.from("\n")]));
    expect(() => supervisedHandoff(sameHead.envelope, sameHead.reopen(), {})).toThrow("WORKTREE_RECEIPT_DIGEST");
    writeFileSync(statePath, stateBytes);

    const published = git.run(git.checkout, "commit-tree", `${git.main}^{tree}`, "-p", git.main, "-m", "Published descendant");
    git.run(git.checkout, "push", git.remote, `${published}:${refName}`);
    expect(() => supervisedHandoff(sameHead.envelope, sameHead.reopen(), {})).toThrow("BOOTSTRAP_GIT_IDENTITY");
    const behind = offlineBootstrap(git, f, undefined, { target, published, prior }, journalOptions);
    const untracked = join(target, "untracked.txt");
    writeFileSync(untracked, "dirty");
    expect(() => behind.supervisor.prepare(behind.envelope)).toThrow("BOOTSTRAP_PREFLIGHT");
    rmSync(untracked);
    git.run(git.checkout, "worktree", "lock", target);
    expect(() => behind.supervisor.prepare(behind.envelope)).toThrow("BOOTSTRAP_TARGET_OWNERSHIP");
    git.run(git.checkout, "worktree", "unlock", target);
    expect(behind.effects()).toBe(0);
    const advanced = behind.supervisor.prepare(behind.envelope);
    expect(advanced.status, behind.diagnostics()).toBe("git-ready");
    expect(behind.reopen().prepare(behind.envelope)).toEqual(advanced);
    expect(behind.effects()).toBe(1);
    expect(behind.observe()).toMatchObject({ receipt: prior, head: published, upstream_head: published });
    expect(readFileSync(pointerPath)).toEqual(pointerBytes);
    expect(readFileSync(statePath)).toEqual(stateBytes);
    expect(supervisedHandoff(behind.envelope, behind.reopen(), {})).toMatchObject({ status: "PREPARATION_ONLY", head: published });
    git.run(git.checkout, "config", "user.name", "Changed fixture operator");
    expect(() => supervisedHandoff(behind.envelope, behind.reopen(), {})).toThrow("PREPARATION_GIT_READY_CHANGED");
  }, 20_000);

  it("requires prior stopped-owner evidence for an absent resume target", () => {
    const git = disposableGit(temporary());
    const f = fixture({ parserPython: git.python });
    git.run(git.checkout, "push", git.remote, `HEAD:refs/heads/${branch}`);
    const target = join(temporary(), "fresh-resume");
    const missing = offlineBootstrap(git, f, undefined, { target, published: git.main });
    expect(() => missing.supervisor.prepare(missing.envelope)).toThrow("BOOTSTRAP_PRIOR_OWNER");
    expect(missing.effects()).toBe(0);
    const prior = { owner: "stopped-principal", authorization_id: "previous-task" };
    const confirmed = offlineBootstrap(git, f, undefined, { target, published: git.main, prior }, missing.journalOptions);
    const result = confirmed.supervisor.prepare(confirmed.envelope);
    expect(result.status, confirmed.diagnostics()).toBe("git-ready");
    expect(confirmed.reopen().prepare(confirmed.envelope)).toEqual(result);
    expect(confirmed.observe()).toMatchObject({ head: git.main, upstream: `origin/${branch}`, receipt: { status: "absent" } });
    expect(supervisedHandoff(confirmed.envelope, confirmed.reopen(), {})).toMatchObject({ status: "PREPARATION_ONLY", directory: target });
    expect(confirmed.effects()).toBe(1);
  }, 10_000);

  it.each(["lost-ack", "timeout", "missing-terminal", "partial-output", "forged-ready", "changed-issue"] as const)(
    "retains the one-shot intent and refuses handoff after %s",
    async (failure) => {
      const git = disposableGit(temporary());
      const f = fixture({ parserPython: git.python });
      const { supervisor, envelope, reopen, effects, timeoutWitness, stages } = offlineBootstrap(git, f, failure);
      const unresolved = supervisor.prepare(envelope);
      expect(unresolved).toMatchObject({ status: "unresolved", evidence: null });
      const reached = {
        "lost-ack": ["terminal:success", "reply:lost"],
        timeout: ["terminal:timeout"],
        "missing-terminal": ["terminal:missing"],
        "partial-output": ["terminal:success", "output:partial", "after:observed"],
        "forged-ready": ["output:forged", "after:target-refused"],
        "changed-issue": ["terminal:success", "live:changed"],
      };
      expect(stages()).toEqual(["dispatch", ...reached[failure]]);
      expect(reopen().prepare(envelope)).toEqual(unresolved);
      expect(await reopen().reconcile(envelope)).toEqual(unresolved);
      expect(() => supervisedHandoff(envelope, reopen(), { verify: f.verify })).toThrow("PREPARATION_GIT_NOT_READY");
      expect(effects()).toBe(1);
      if (failure === "timeout") expect(timeoutWitness()).toMatchObject({
        status: null, signal: "SIGKILL", error: { code: "ETIMEDOUT" },
      });
    },
  );

  it("attests cloned readiness and rejects substituted or missing evidence at both boundaries", () => {
    const git = disposableGit(temporary());
    const f = fixture({ parserPython: git.python });
    const offline = offlineBootstrap(git, f);
    offline.dropNextGateReply();
    expect(() => offline.supervisor.prepare(offline.envelope)).toThrow("fixture lost gate acknowledgement");
    expect(offline.reopen().prepare(offline.envelope).status, offline.diagnostics()).toBe("git-ready");
    expect(supervisedHandoff(offline.envelope, offline.reopen(), {}).status).toBe("PREPARATION_ONLY");
    const { evidence, current } = offline.readyWitnesses;
    if (!evidence || !current) throw new Error("Readiness attestations were not reached");
    const original = offline.loadReady(evidence.evidence);
    expect(original).toEqual(evidence.readiness);
    expect(original).not.toBe(evidence.readiness);
    const readyBoundary = "preparation_git_ready_evidence";
    const currentBoundary = "preparation_git_ready_current";
    resourceAttest(f.verify, readyBoundary, evidence);
    resourceAttest(f.verify, currentBoundary, current);

    const changed = { ...evidence.readiness, receipt: digest("substituted receipt") };
    for (const replacement of [
      { ...evidence, readiness: changed },
      { readiness: changed, evidence: { ...evidence.evidence, digest: digest(changed) } },
      { ...evidence, evidence: { ...evidence.evidence, id: "wrong-reference" } },
    ]) expect(() => resourceAttest(f.verify, readyBoundary, replacement)).toThrow(readyBoundary);
    for (const replacement of [
      { ...current, readiness: changed },
      { ...current, request: { ...current.request, worker: "substituted-worker" } },
      { ...current, request: { ...current.request, task_revision: 2 } },
      { ...current, intent: { ...current.intent, effect_id: digest("substituted intent") } },
      { ...current, observed: { ...current.observed, workspace: { ...current.observed.workspace, dirty: true } } },
      { ...current, intent: { ...current.intent, evidence: { ...evidence.evidence, id: "wrong-reference" } } },
    ]) expect(() => resourceAttest(f.verify, currentBoundary, replacement)).toThrow(currentBoundary);
    offline.clearReady();
    expect(() => resourceAttest(f.verify, readyBoundary, evidence)).toThrow(readyBoundary);
    expect(() => resourceAttest(f.verify, currentBoundary, current)).toThrow(currentBoundary);
    expect(() => supervisedHandoff(offline.envelope, offline.reopen(), {})).toThrow("PREPARATION_GIT_READY_BINDING");
    expect(offline.effects()).toBe(1);
  }, 10_000);

  it("times out a pending reconciliation read, limits its horizon, and accepts separately authenticated late evidence", async () => {
    const git = disposableGit(temporary());
    const f = fixture({ parserPython: git.python });
    const offline = offlineBootstrap(git, f, "timeout");
    const { supervisor, envelope, reopen, effects } = offline;
    const unresolved = supervisor.prepare(envelope);
    const second = offlineBootstrap(git, f, undefined, undefined, offline.journalOptions);
    expect(() => second.supervisor.prepare(second.envelope)).toThrow("PREPARATION_CAPACITY_UNAVAILABLE");
    expect(second.effects()).toBe(0);
    let reads = 0;
    let aborted = false;
    offline.reconcileUsing(({ signal }) => {
      reads++;
      if (reads > 1) return undefined;
      signal.addEventListener("abort", () => { aborted = true; }, { once: true });
      return new Promise(() => {});
    });
    expect(await supervisor.reconcile(envelope)).toEqual(unresolved);
    expect(aborted).toBe(true);
    for (let index = 0; index < 5; index++) expect(await reopen().reconcile(envelope)).toEqual(unresolved);
    expect(reads).toBe(4);
    f.time(6);
    expect(await reopen().reconcile(envelope)).toEqual(unresolved);
    expect(reads).toBe(4);
    const evidence = ref("independent-disposable-terminal");
    f.boundaries.set("preparation_capacity_release", (value) => value.status === "cleaned"
      && digest(value.evidence) === digest(evidence) && value.intent.effect_id === unresolved.effect_id);
    await expect(reopen().reconcile(envelope, { status: "cleaned", evidence: ref("forged-late-outcome") }))
      .rejects.toThrow("preparation_capacity_release");
    await expect(reopen().reconcile(envelope, { status: "cleaned", evidence })).resolves.toMatchObject({ status: "cleaned", evidence });
    expect(effects()).toBe(1);
  }, 10_000);
});

type HookResponse = { continue?: boolean; decision?: string; reason?: string;
  hookSpecificOutput?: { additionalContext?: string; permissionDecision?: string; permissionDecisionReason?: string;
    decision?: { behavior: string } } };

type BootstrapFault = "lost-ack" | "timeout" | "missing-terminal" | "partial-output" | "forged-ready" | "changed-issue";

function offlineBootstrap(git: GitFixture, f: ReturnType<typeof fixture>, fault?: BootstrapFault,
  resume?: { target: string; published: string; prior?: { owner: string; authorization_id: string } },
  journalOptions?: { directory: string; key: Buffer; hostId: string; verify: typeof f.verify;
    currentState: ReturnType<typeof journalWitness>; withLock: <T>(directory: string, action: (proof: ReturnType<typeof ref>) => T) => T }) {
  const parent = temporary();
  const target = resume?.target ?? join(parent, "approved-worktree");
  const base = resume?.published ?? git.main;
  const input = f.preparationInputs({ base });
  const script = realpathSync(new URL("../tools/codex/bootstrap-pr.sh", import.meta.url));
  const allowance = { schema: "PFM_PREPARATION_HOST_ALLOWANCE_V1", id: "fixture-host-allowance",
    repository, host_id: "supervised-host", environment: "local", resource: input.resource,
    nonce: digest([target, base, resume ? "resume" : "new"]), expires_at: at(5), cleanup_deadline: at(6), execution_ms: 5000,
    cleanup_ms: 1000, cpu_millicores: 100, memory_mib: 128, processes: 8, disk_mib: 32 };
  const request = { schema: "PFM_PREPARATION_REQUEST_V1", id: `fixture-${allowance.nonce.slice(0, 24)}`,
    goal_issue: input.goal.goal_issue, goal_revision: input.goal.control_revision, goal_control_digest: goalControlDigest(input.goal),
    repository, task_issue: input.issue.number, task_revision: input.task_revision, lineage_id: input.lineage_id,
    issue_body_digest: sha256(input.issue.body), branch, mode: resume ? "resume" : "new", expected_main: git.main,
    expected_head: resume?.published ?? null,
    census: recordRef(input.census), resource: input.resource, worker: "approved-worker-principal", host_id: allowance.host_id,
    environment: allowance.environment, checkout: git.checkout, target, parser_revision: parserRevision,
    parser_digest: sha256(root), bootstrap_revision: git.main, bootstrap_digest: sha256(readFileSync(script)),
    nonce: allowance.nonce, host_allowance: recordRef(allowance), cleanup_deadline: allowance.cleanup_deadline, expires_at: allowance.expires_at };
  const envelope = { request, approval: { schema: "PFM_PREPARATION_APPROVAL_V1", proof: ref("fixture-independent-pm"),
    request_digest: digest(request) } };
  const approvedRequest = canonicalJson(request);
  const binding = readPreparationRequest(envelope).binding;
  const stages = new Set<string>();
  let effects = 0;
  let timedOut: { status: number | null; signal: string | null; error: { code: string | undefined } } | undefined;
  const observations = new Map<string, string>();
  let afterWorkspace: string | undefined;
  f.boundaries.set("supervised_git_observation", ({ request: current, phase, snapshot }) =>
    canonicalJson(current) === approvedRequest && observations.get(phase) === canonicalJson(snapshot));
  f.boundaries.set("pm_exact_preparation_approval", (proof: { request: unknown; approval: unknown }) =>
    digest(proof.request) === envelope.approval.request_digest && digest(proof.approval) === digest(envelope.approval));
  const observe = () => inspectWorkspace({ directory: target, git: git.realGit, environment: request.environment,
    repository, base, verify: f.verify });
  const priorOwner = resume?.prior && { repository, task_issue: request.task_issue, lineage_id: request.lineage_id,
    branch, published_head: resume.published, resource: request.resource, terminal: ref("prior-terminal"),
    owner: resume.prior.owner, authorization_id: resume.prior.authorization_id };
  f.boundaries.set("bootstrap_stopped_published_owner", ({ priorOwner: observed }) =>
    priorOwner !== undefined && digest(observed) === digest(priorOwner));
  const bootstrapHost = createBootstrapHost({ verify: f.verify, clock: f.clock, operator: {
    observeGit(_request: typeof request, phase: string) {
      const readRef = (refName: string) => {
        const result = git.read(git.checkout, "--git-dir", git.remote, "rev-parse", "--verify", refName);
        return result.status === 0 ? result.stdout.trim() : null;
      };
      const local = git.read(git.checkout, "rev-parse", "--verify", `refs/heads/${branch}`);
      const registered = git.run(git.checkout, "worktree", "list", "--porcelain").split("\n").includes(`worktree ${target}`);
      const snapshot = { repository, main: readRef("refs/heads/main"), remote_head: readRef(`refs/heads/${branch}`),
        branch, target, checkout: git.checkout, environment: allowance.environment, host_id: allowance.host_id,
        git: git.git, local_head: local.status === 0 ? local.stdout.trim() : null, owner_path: registered ? target : null,
        registered_target: registered, evidence: ref(`fixture-git-${phase}`) };
      observations.set(phase, canonicalJson(snapshot));
      return snapshot;
    },
    readPriorOwner: () => priorOwner,
    readMergedBootstrap() {
      return { path: script, git: git.git, bash: git.bash, python: git.python, evidence: ref("fixture-pinned-tools") };
    },
    runIsolated(invocation: Invocation, bytes: Buffer) {
      effects++;
      stages.add("dispatch");
      if (fault === "forged-ready") {
        stages.add("output:forged");
        return { stdout: Buffer.from([
          `PR_WORKTREE_READY mode=new path=${target} branch=${branch} head=${git.main} origin_main=${git.main}`,
          `PR_TASK_RECEIPT status=absent path=${target}`, `OPEN THIS EXACT WORKTREE IN CODEX: ${target}`, "",
        ].join("\n")), stderr: Buffer.alloc(0), exit_code: 0, timed_out: false, terminal: ref("fixture-terminal") };
      }
      const result = fault === "timeout"
        ? spawnSync(git.python, ["-I", "-B", "-c", "import time; time.sleep(30)"], {
          timeout: 100, maxBuffer: invocation.output_limit, killSignal: "SIGKILL",
        })
        : git.invoke(invocation, bytes);
      if (fault === "timeout") {
        timedOut = { status: result.status, signal: result.signal, error: { code: result.error?.code } };
      }
      stages.add(result.error?.code === "ETIMEDOUT" ? "terminal:timeout" : result.status !== 0 ? "terminal:failed"
        : fault === "missing-terminal" ? "terminal:missing" : "terminal:success");
      if (fault === "lost-ack") {
        stages.add("reply:lost");
        throw new Error("fixture lost response");
      }
      if (fault === "changed-issue") live = { ...live, issue: { ...live.issue, body: live.issue.body + "\nChanged" } };
      if (fault === "partial-output") stages.add("output:partial");
      return { stdout: fault === "partial-output" ? Buffer.from("PR_WORKTREE_READY") : result.stdout,
        stderr: result.stderr, exit_code: result.status, timed_out: result.error !== undefined,
        terminal: result.status === 0 && fault !== "missing-terminal" ? ref("fixture-terminal") : null };
    },
  } });
  const bootstrap = { ...bootstrapHost,
    inspect(current: typeof request, paths: string[], taskKind: string, phase: string, gate: ReturnType<typeof ref>) {
      try {
        const observed = bootstrapHost.inspect(current, paths, taskKind, phase, gate);
        if (phase === "after") {
          stages.add("after:observed");
          afterWorkspace = canonicalJson(observed.workspace);
        }
        return observed;
      } catch (error) {
        if (phase === "after") stages.add(error instanceof Error && error.message === "BOOTSTRAP_TARGET_OWNERSHIP"
          ? "after:target-refused" : "after:refused");
        throw error;
      }
    },
  };
  type Locked<T> = (proof: ReturnType<typeof ref>) => T;
  const currentState = journalOptions?.currentState ?? journalWitness(digest);
  f.boundaries.set("preparation_journal_current", currentState.verify);
  const options = journalOptions ?? { directory: temporary(), key: Buffer.alloc(32, 1), hostId: request.host_id,
    verify: f.verify, currentState, withLock: <T>(_directory: string, action: Locked<T>) => action(ref("fixture-lock")) };
  const journal = openPreparationJournal({ ...options, initialize: journalOptions === undefined });
  const baseline = { issue: input.issue, goal: input.goal, goalApproval: input.approval, alignment: input.alignment,
    routes: input.routes, census: input.census, allowance, parser: { source: root, revision: parserRevision, python: git.python },
    task: { repository, task_issue: input.issue.number, task_revision: input.task_revision, lineage_id: input.lineage_id } };
  let live = baseline;
  type Reference = ReturnType<typeof ref>;
  type ReadyIntent = { request_digest: string; effect_id: string; status: string; evidence: Reference | null };
  type ReadyRecord = { intent: ReadyIntent; observation: Reference; workspace: string; receipt: string };
  type EvidenceBinding = { readiness: ReadyRecord; evidence: Reference; gate: Reference };
  type CurrentBinding = { request: typeof request; intent: ReadyIntent; readiness: ReadyRecord;
    observed: { snapshot: { evidence: Reference }; workspace: Record<string, unknown> }; gate: Reference };
  const readyWitnesses: { evidence?: EvidenceBinding; current?: CurrentBinding } = {};
  const readyRecords = new Map<string, { digest: string; bytes: string }>();
  const loadReady = (evidence: Reference) => {
    const stored = readyRecords.get(evidence.id);
    return stored && stored.digest === evidence.digest ? JSON.parse(stored.bytes) as ReadyRecord : undefined;
  };
  const matchesReady = (evidence: Reference, readiness: ReadyRecord) => {
    const stored = evidence && readyRecords.get(evidence.id);
    return Boolean(stored && stored.digest === evidence.digest && stored.bytes === canonicalJson(readiness)
      && stored.digest === digest(readiness));
  };
  let originalIntent: string | undefined;
  f.boundaries.set("preparation_begin_fenced", ({ intent }) => {
    if (intent.request_digest !== envelope.approval.request_digest || intent.approval_digest !== digest(envelope.approval)
      || intent.effect_id !== digest(["bootstrap", request.host_id, envelope.approval.request_digest])) return false;
    originalIntent = canonicalJson(intent);
    return true;
  });
  type ReconcileRead = (limits: { signal: AbortSignal; timeout_ms: number; max_observations: number }) => unknown;
  let readReconciliation: ReconcileRead = () => undefined;
  let dropGateReply = false;
  const host = { verify: f.verify, clock: f.clock, consumedNonces: new Set<string>(),
    withGate: <T>(_request: typeof request, operation: string, action: Locked<T>) => {
      const result = action(ref(`gate-${operation}`));
      if (dropGateReply) {
        dropGateReply = false;
        throw new Error("fixture lost gate acknowledgement");
      }
      return result;
    },
    loadLive: () => {
      if (fault === "changed-issue" && sha256(live.issue.body) !== request.issue_body_digest) stages.add("live:changed");
      return live;
    },
    recordGitReady(proof: ReadyRecord) {
      stages.add("ready:recorded");
      const evidence = { id: "fixture-preflight", digest: digest(proof) };
      readyRecords.set(evidence.id, { digest: evidence.digest, bytes: canonicalJson(proof) });
      return evidence;
    },
    loadGitReady: loadReady,
    reconcileReadOnly: (_intent: unknown, _gate: unknown, limits: Parameters<ReconcileRead>[0]) => readReconciliation(limits),
  };
  f.boundaries.set("preparation_git_ready_current", (proof: CurrentBinding) => {
    const { intent, readiness, observed, request: current, gate } = proof;
    const phase = gate.id === "gate-handoff" ? "handoff" : gate.id === "gate-prepared" ? "prepared" : null;
    if (!phase || digest(gate) !== digest(ref(`gate-${phase}`)) || canonicalJson(current) !== approvedRequest
      || !intent.evidence || !matchesReady(intent.evidence, readiness) || canonicalJson(readiness.intent) !== originalIntent
      || canonicalJson(intent) !== canonicalJson(journal.observe(binding))
      || canonicalJson(observed.snapshot) !== observations.get(phase)
      || canonicalJson(observed.workspace) !== canonicalJson(observe())) return false;
    readyWitnesses.current = proof;
    return true;
  });
  f.boundaries.set("preparation_git_ready_evidence", (proof: EvidenceBinding) => {
    const { readiness, evidence, gate } = proof;
    const after = observations.get("after");
    if (!matchesReady(evidence, readiness) || canonicalJson(readiness.intent) !== originalIntent
      || digest(gate) !== digest(ref("gate-prepare")) || !afterWorkspace || !after
      || canonicalJson(observe()) !== afterWorkspace
      || digest(readiness.observation) !== digest(JSON.parse(after).evidence)) return false;
    const { receipt, ...workspace } = JSON.parse(afterWorkspace);
    const durable = journal.observe(binding);
    if (readiness.workspace !== digest(workspace) || readiness.receipt !== digest(receipt)
      || (canonicalJson(durable) !== originalIntent && canonicalJson(durable) !== canonicalJson({
        ...readiness.intent, status: "git-ready", evidence,
      }))) return false;
    stages.add("ready:attested");
    readyWitnesses.evidence = proof;
    return true;
  });
  const supervisor = createSupervisedPreparation({ journal, bootstrap, host });
  return { supervisor, reopen: () => createSupervisedPreparation({ journal: openPreparationJournal(options), bootstrap, host }),
    baseline, update: (changes: Partial<typeof baseline>) => { live = { ...baseline, ...changes }; },
    envelope, effects: () => effects, observe, input, target, parent, journalOptions: options,
    timeoutWitness: () => timedOut, readyWitnesses, loadReady, clearReady: () => readyRecords.clear(),
    stages: () => [...stages], diagnostics: () => [...stages].join(", "),
    dropNextGateReply: () => { dropGateReply = true; },
    reconcileUsing: (read: ReconcileRead) => { readReconciliation = read; } };
}

function actualHook(git: GitFixture, target: string, issue: string) {
  const policy = realpathSync(new URL("../.codex/hooks/pfm-policy.py", import.meta.url));
  return (hook_event_name: string, session_id: string, turn_id: string, fields: Record<string, unknown>): HookResponse => {
    const stdout = execFileSync(git.python, ["-I", "-B", policy], {
      cwd: target, env: { ...git.hookEnv, PFM_POLICY_TEST_ISSUE_BODY_FILE: issue }, encoding: "utf8", timeout: 5000,
      input: JSON.stringify({ hook_event_name, session_id, turn_id, cwd: target, ...fields }),
    });
    return JSON.parse(stdout) as HookResponse;
  };
}

function prepareWithActualHook(git: GitFixture, f: ReturnType<typeof fixture>) {
  const { supervisor, baseline, update, envelope, effects, observe, input, target, parent, diagnostics } = offlineBootstrap(git, f);
  const { request } = envelope;
  const reject = (changes: Parameters<typeof update>[0], reason: string) => {
    update(changes);
    expect(() => supervisor.prepare(envelope)).toThrow(reason);
    update({});
  };
  expect(() => supervisor.prepare({ ...envelope, approval: { ...envelope.approval, proof: ref("forged") } }))
    .toThrow("pm_exact_preparation_approval");
  expect(() => supervisor.prepare({ ...envelope, approval: input.approval })).toThrow("PREPARATION_APPROVAL_FIELDS");
  reject({ issue: { ...baseline.issue, repository: "foreign/repository" } }, "SAVED_ISSUE_IDENTITY");
  reject({ issue: { ...baseline.issue, number: 999 } }, "SAVED_ISSUE_IDENTITY");
  reject({ issue: { ...baseline.issue, state: "closed" } }, "SAVED_ISSUE_IDENTITY");
  reject({ issue: { ...baseline.issue, body: body([primary], "codex/other") } }, "PREPARATION_V3");
  reject({ parser: { ...baseline.parser, source: root + "\n" } }, "PREPARATION_PARSER_PIN");
  reject({ task: { ...baseline.task, task_revision: 2 } }, "PREPARATION_TASK");
  reject({ task: { ...baseline.task, lineage_id: "foreign-lineage" } }, "PREPARATION_TASK");
  reject({ alignment: { ...baseline.alignment, unresolved: ["missing-decision"] } }, "UNRESOLVED_OR_CONFLICTING_ALIGNMENT");
  reject({ census: { ...baseline.census, id: "foreign-census" } }, "PREPARATION_TASK");
  reject({ allowance: { ...baseline.allowance, processes: 0 } }, "PREPARATION_ALLOWANCE");
  for (const boundary of ["pm_exact_preparation_approval", "preparation_live_control_and_host", "task_dependencies_satisfied",
    "preparation_admissions_open", "preparation_host_allowance", "preparation_global_gate", "bootstrap_readonly_host_isolation",
    "merged_supervised_bootstrap"]) {
    f.denied.add(boundary);
    expect(() => supervisor.prepare(envelope)).toThrow(boundary);
    f.denied.delete(boundary);
  }
  f.time(5);
  expect(() => supervisor.prepare(envelope)).toThrow("PREPARATION_ALLOWANCE");
  f.time(1);
  expect(effects()).toBe(0);
  const readiness = supervisor.prepare(envelope);
  expect(readiness.status, diagnostics()).toBe("git-ready");
  expect(supervisor.prepare(envelope)).toEqual(readiness);
  expect(effects()).toBe(1);
  expect(observe().receipt.status).toBe("absent");
  if (f.resourceLedger) expect(() => f.resourceLedger.lookup("reservation-1")).toThrow("UNKNOWN_RESERVATION");
  expect(f.ledger.inspect(repository, request.task_issue)).toBeNull();
  const handoff = supervisedHandoff(envelope, supervisor, { verify: f.verify });
  expect(handoff).toMatchObject({ status: "PREPARATION_ONLY", native: "HANDOFF_UNVERIFIED", trust: "unknown", session: null, directory: target,
    prompt: "PFM_TASK_ISSUE: 365" });
  expect(() => supervisedHandoff({ ...envelope, approval: { ...envelope.approval, proof: ref("wrong-pm-proof") } },
    supervisor, {})).toThrow("PREPARATION_REQUEST_CONFLICT");
  const config = readFileSync(new URL("../.codex/config.toml", import.meta.url));
  const inventoryEvidence = { id: "fixture-hook-inventory", digest: digest([sha256(root), sha256(config), target]) };
  const inventory = { status: "observed", trust: "observed", evidence: inventoryEvidence };
  const pending = { ...inventory, trust: "pending" };
  f.boundaries.set("handoff_readonly_inventory", ({ request: current, inventory: observed }) =>
    digest(current) === envelope.approval.request_digest && [inventory, pending,
      { status: "unavailable", trust: "unknown", evidence: ref("no-local-handshake") }]
      .some((known) => digest(known) === digest(observed)));
  expect(supervisedHandoff(envelope, supervisor, { inventory: () => pending })).toMatchObject({
    status: "PREPARATION_ONLY", native: "HANDOFF_APPROVAL_REQUIRED", trust: "pending", session: null,
  });
  expect(supervisedHandoff(envelope, supervisor, { inventory: () => inventory })).toMatchObject({
    status: "PREPARATION_ONLY", native: "HANDOFF_UNVERIFIED", trust: "observed", session: null,
  });
  expect(supervisedHandoff(envelope, supervisor, { verify: f.verify, inventory: () => ({
    status: "unavailable", trust: "unknown", evidence: ref("no-local-handshake"),
  }) }).native).toBe("HANDOFF_UNAVAILABLE");
  update({ task: { ...baseline.task, lineage_id: "revised-lineage" } });
  expect(() => supervisedHandoff(envelope, supervisor, { verify: f.verify })).toThrow("PREPARATION_TASK");
  update({});
  const host = { inventory: () => inventory };
  const session = { session: worker, turn: "hook-turn", barrier: ref("fixture-write-barrier") };
  expect(() => reviewHookPreparedForAdmission(envelope, supervisor, handoff, session, input, host)).toThrow("HANDOFF_HOOK_PREPARED");
  const issue = join(parent, "saved-issue.md");
  writeFileSync(issue, input.issue.body);
  const hook = actualHook(git, target, issue);
  const startedSession = hook("SessionStart", worker, "hook-turn", {});
  expect(startedSession.hookSpecificOutput?.additionalContext).toContain(
    `root=${target} branch=${branch} head=${git.main} dirty=no linked_worktree=yes`);
  const submitted = hook("UserPromptSubmit", worker, "hook-turn", { prompt: handoff.prompt });
  expect(submitted.hookSpecificOutput?.additionalContext).toContain("authorization accepted");
  const observation: ReturnType<typeof f.prepare>["observation"] = observe();
  const observedHook = digest([startedSession, submitted, observation.receipt]);
  let configDigest = inventoryEvidence.digest;
  f.boundaries.set("handoff_actual_hook_configuration", (value) => value.inventory.evidence.digest === configDigest);
  f.boundaries.set("handoff_actual_hook_preparation", (value) => observedHook === digest([startedSession, submitted, value.receipt])
    && value.identity.head_sha === git.main);
  f.boundaries.set("handoff_worker_session", (value) => value.worker === request.worker && value.session.session === worker
    && value.session.turn === session.turn && value.workspace.receipt_owner === worker && value.workspace.writer_fence === 1
    && digest(value.receipt) === digest(observation.receipt));
  let barrierAvailable = false;
  f.boundaries.set("handoff_live_nonwriting_barrier", (value) =>
    barrierAvailable && digest(value.session.barrier) === digest(session.barrier));
  const workspace = { schema: "WORKSPACE_RECEIPT_V1", repository, id: "workspace_receipt_v1", revision: 1,
    created_at: at(0), producer, references: [], task_issue: request.task_issue, directory: target,
    environment: observation.environment, origin_repository: repository, branch, issue_body_digest: request.issue_body_digest,
    head_sha: observation.head, upstream_head_sha: observation.upstream_head, state: "ready", receipt_owner: observation.receipt.owner,
    ready_proof: handoff.git_ready, writer_fence: 1 };
  const remote = { repository, branch, base: git.main, head: null, evidence: ref("fixture-git-prepared") };
  const prepared = { ...input, workspace, observation, remote };
  const reviewWith = (candidate = handoff, identity = session, supplied = prepared) =>
    reviewHookPreparedForAdmission(envelope, supervisor, candidate, identity, supplied, host);
  expect(() => reviewWith()).toThrow("handoff_live_nonwriting_barrier");
  barrierAvailable = true;
  configDigest = digest("mismatched-hook-config");
  expect(() => reviewWith()).toThrow("handoff_actual_hook_configuration");
  configDigest = inventoryEvidence.digest;
  expect(() => reviewHookPreparedForAdmission(envelope, supervisor, handoff, session, prepared, { inventory: () => pending }))
    .toThrow("HANDOFF_NATIVE_TRUST");
  for (const invalid of [{ ...session, turn: "wrong-turn" }, { ...session, session: "wrong-session" }]) {
    expect(() => reviewWith(handoff, invalid)).toThrow(/HANDOFF_HOOK_/);
  }
  const forged = ref("copied-substitute-readiness");
  expect(() => reviewWith({ ...handoff, git_ready: forged }, session,
    { ...prepared, workspace: { ...workspace, ready_proof: forged } })).toThrow("HANDOFF_IDENTITY");
  expect(() => reviewWith(handoff, session, { ...prepared, observation: { ...observation, dirty: true } }))
    .toThrow("HANDOFF_OBSERVATION_CHANGED");
  expect(() => reviewWith(handoff, session, { ...prepared, workspace: { ...workspace, writer_fence: 2 } }))
    .toThrow("handoff_worker_session");
  expect(() => reviewWith(handoff, session, { ...prepared, workspace: { ...workspace, receipt_owner: "foreign-owner" } }))
    .toThrow("handoff_worker_session");
  f.denied.add("preparation_admissions_open");
  expect(() => reviewWith()).toThrow("preparation_admissions_open");
  f.denied.delete("preparation_admissions_open");
  const review = reviewWith();
  expect(review).toMatchObject({ status: "HOOK_PREPARED", authorization_id: observation.receipt.authorization_id,
    receipt_digest: observation.receipt.digest, session: worker, turn: "hook-turn" });
  let mutationCalls = 0;
  return { input: { ...prepared, observation: review.observation, remote: review.remote, ...f.reserve(input) }, observe,
    mutationCalls: () => mutationCalls,
    mutation(sessionId: string, turnId: string, path: string) {
      mutationCalls++;
      return hook("PreToolUse", sessionId, turnId, { tool_name: "apply_patch",
        tool_input: { command: `*** Begin Patch\n*** Update File: ${path}\n@@\n-original\n+changed\n*** End Patch` } });
    },
    malformedMutation: () => hook("PreToolUse", worker, "hook-turn", { tool_name: "apply_patch", tool_input: {} }),
    permission: (sessionId: string) => hook("PermissionRequest", sessionId, "hook-turn",
      { tool_name: "Bash", tool_input: { command: `git push origin ${branch}` } }),
    setRemote(sha: string | null) {
      const gitRef = `refs/heads/${branch}`;
      if (sha === null) git.run(git.checkout, "--git-dir", git.remote, "update-ref", "-d", gitRef);
      else git.run(git.checkout, "push", git.remote, `${sha}:${gitRef}`);
    },
    remoteProbe: (remote = "origin") => spawnSync("git", ["ls-remote", "--exit-code", remote, `refs/heads/${branch}`], {
      cwd: target, env: git.hookEnv, encoding: "utf8", timeout: 5000,
    }),
    stop: () => hook("Stop", worker, "hook-turn", { last_assistant_message: "TASK_STATUS: BLOCKED\nBLOCKER: disposable witness" }),
  };
}

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
