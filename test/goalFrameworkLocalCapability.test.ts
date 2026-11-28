import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync, copyFileSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Ref = { id: string; digest: string };
type Entry<T> = { status: "observed"; reason: null; value: T }
  | { status: "unobserved"; reason: string; value: null };
type Protocol = {
  layout: "schemars-draft7-unions-v1";
  source: "operator-declared-static-export";
  binary: Ref;
  version: string;
  files: Ref[];
  features: Record<"thread_identity_cwd" | "exact_prompt" | "model_effort" | "permissions" | "turn_start"
    | "turn_interrupt" | "terminal" | "usage", boolean>;
};
type Report = {
  schema: "PFM_LOCAL_CAPABILITY_OBSERVATION_V1";
  surface: "local";
  observed_at: string;
  head: string;
  control_revision: string;
  app: Entry<{ version: string; build: string; ref: Ref }>;
  cli: Entry<{ version: string | null; version_source: "operator-declared" | "unobserved";
    platform: "linux" | "darwin"; arch: "x86_64" | "arm64"; ref: Ref }>;
  protocol: Entry<Protocol>;
};
type InputError = { schema: "PFM_LOCAL_CAPABILITY_ERROR_V1"; reason: "invalid-input" };
type Verify = (boundary: string, binding: unknown) => boolean;
type Capability = { status: "verified" | "unsupported" | "unverified"; evidence: Ref[] };
type SupervisorEnvelope = {
  repository: string; id: string; revision: number; created_at: string;
  producer: { role: "supervisor"; actor: string; session: string };
};
type Runner = SupervisorEnvelope & {
  schema: "RUNNER_CAPABILITIES_V1"; surface: "local"; product: "codex"; runtime_version: string | null;
  operations: Record<string, Capability>; authentication_ref: null; tool_version: string | null; references: Ref[];
};
type Runtime = {
  runner: Runner;
  transport: null; runtime: null; config_digest: null; permissions_digest: null; control_revision: null;
  native: Record<string, Capability>;
  resource_profile: null;
};
type HandoffInventory = {
  status: "observed" | "unverified"; trust: "unknown" | "pending" | "observed"; evidence: Ref | null;
};
type Selection = { evidence: Ref; session: Ref; trust: "pending" | "observed"; observed_at: string };
type Request = {
  schema: "PFM_PREPARATION_REQUEST_V1"; id: string; nonce: string; repository: string; goal_issue: number;
  goal_revision: number; goal_control_digest: string; task_issue: number; task_revision: number; lineage_id: string;
  issue_body_digest: string; branch: string; expected_main: string; census: Ref; resource: string; worker: string;
  host_id: string; environment: string; checkout: string; target: string; parser_revision: string;
  parser_digest: string; bootstrap_revision: string; bootstrap_digest: string; host_allowance: Ref;
  cleanup_deadline: string; expires_at: string;
} & ({ mode: "new"; expected_head: null } | { mode: "resume"; expected_head: string });
type Approval = { schema: "PFM_PREPARATION_APPROVAL_V1"; proof: Ref; request_digest: string };
type PreparationInput = { request: Request; approval: Approval } | string;
type Context = {
  envelope: SupervisorEnvelope;
  observation?: { evidence: Ref; observed_at: string } | null;
  now: string; head: string; control_revision: string; host_id: string; environment: string; worker: string;
  config_digest: string; permissions_digest: string; binary_digest: string; tool_version: string;
  app_digest: string | null; verify: Verify;
};
type Advisory = {
  reason: string; report: Ref; runtime: Runtime;
  handoffInventory: (request: Request, selection?: Selection | null) => HandoffInventory;
};
type RunnerHost = {
  inventory: (selection: { surface: "local"; repository: string }) => Runtime;
  verify: Verify; clock: () => string;
  preparation: (selection: { surface: "local"; repository: string; task_issue: number; operation: string }) => never;
  resources: { lookup: (reservation: string) => never }; commitEffect: (intent: unknown) => never;
};
type Gate = {
  request: Request; verify: Verify; gate: Ref; intent: { request_digest: string; evidence: Ref };
};
type Supervisor = {
  withFreshHandoff: <T>(raw: PreparationInput, phase: "handoff" | "prepared", consume: (authority: Gate) => T) => T;
};
type Handoff = {
  schema: "PFM_SUPERVISED_HANDOFF_V1"; request_digest: string; git_ready: Ref; status: "PREPARATION_ONLY";
  trust: HandoffInventory["trust"]; native: "HANDOFF_APPROVAL_REQUIRED" | "HANDOFF_UNAVAILABLE" | "HANDOFF_UNVERIFIED";
  directory: string; head: string; session: null; prompt: string;
};
type HandoffHost = { inventory: (request: Request) => HandoffInventory };

const load = (name: string) => import(new URL(`../tools/codex/goal-framework/${name}.mjs`, import.meta.url).href);
const { canonicalJson, digest }: { canonicalJson: (data: unknown) => string; digest: (data: unknown) => string } =
  await load("contracts");
const { readLocalCapability, localCapabilityInventory }: {
  readLocalCapability: (raw: unknown) => Report | InputError;
  localCapabilityInventory: (raw: unknown, readSupervisor: () => Context) => Advisory;
} = await load("adapters/local-capability");
const { readPreparationRequest }: {
  readPreparationRequest: (raw: PreparationInput) => { request: Request; approval: Approval;
    binding: { request_digest: string; approval_digest: string; nonce_digest: string; allowance: Ref } };
} = await load("adapters/supervised-preparation");
const { createRunnerAdapter }: {
  createRunnerAdapter: (options: { surface: "local"; repository: string; host: RunnerHost }) => {
    probe: () => { runtime: Runtime; mode: string }; prepare: (request: { task_issue: number }) => unknown;
    launch: (request: { task_issue: number; grant: Ref }) => unknown;
  };
} = await load("adapters/runner");
const { supervisedHandoff, reviewHookPreparedForAdmission }: {
  supervisedHandoff: (raw: PreparationInput, supervisor: Supervisor, host: HandoffHost) => Handoff;
  reviewHookPreparedForAdmission: (raw: PreparationInput, supervisor: Supervisor, handoff: Handoff,
    target: { session: string; turn: string; barrier: Ref }, input: unknown, host: HandoffHost) => unknown;
} = await load("adapters/supervised-handoff");

const probe = fileURLToPath(new URL("../tools/codex/goal-framework/local-capability-probe.py", import.meta.url));
const schemaFiles = ["ClientRequest.json", "ServerNotification.json"] as const;
const schemaFixture = (name: typeof schemaFiles[number]) =>
  fileURLToPath(new URL(`./fixtures/goalFramework/localCapability/${name}`, import.meta.url));
const head = "a".repeat(40);
const control = "b".repeat(40);
const tool = "0.169.0-alpha.11.1";
const app = "26.1111.21308";
const ref = (id: string): Ref => ({ id, digest: digest(id) });
const hashBytes = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const repository = "fixture/pfm";
const unknownInventory: HandoffInventory = { status: "unverified", trust: "unknown", evidence: null };
const request: Request = {
  schema: "PFM_PREPARATION_REQUEST_V1", id: "fixture-preparation", nonce: digest("new-nonce"), repository,
  goal_issue: 362, goal_revision: 2, goal_control_digest: digest("goal"), task_issue: 368, task_revision: 3,
  lineage_id: "fixture-lineage", issue_body_digest: digest("issue-body"), branch: "codex/fixture-branch",
  mode: "new", expected_main: head, expected_head: null, census: ref("fixture-census"), resource: "fixture-lock",
  worker: "fixture-worker", host_id: "mac", environment: "isolated", checkout: "/fixture/source",
  target: "/fixture/worktree", parser_revision: control, parser_digest: digest("parser"), bootstrap_revision: control,
  bootstrap_digest: digest("bootstrap"), host_allowance: ref("fixture-allowance"),
  cleanup_deadline: "2035-01-01T00:02:00Z", expires_at: "2035-01-01T00:01:00Z",
};
const resumeRequest: Request = { ...request, id: "fixture-resume", mode: "resume", expected_main: control,
  expected_head: head, nonce: digest("resume-nonce") };
function preparation(payload: Request): string {
  const approval: Approval = { schema: "PFM_PREPARATION_APPROVAL_V1", proof: ref("fixture-approval"),
    request_digest: digest(payload) };
  return canonicalJson({ request: payload, approval });
}
const plist = `<?xml version="1.0"?><plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.openai.codex</string>
  <key>CFBundleShortVersionString</key><string>${app}</string>
  <key>CFBundleVersion</key><string>27194</string>
  <key>UnexpectedPrivateField</key><string>fixture-secret</string>
</dict></plist>`;

let dir: string;
let appPath: string;
let plistPath: string;
let binary: string;
let binaryDigest: string;
let schema: string;

beforeEach(() => {
  const temp = process.getuid?.() === 0 ? "/tmp" : tmpdir();
  dir = mkdtempSync(join(realpathSync(temp), "pfm-capability-"));
  appPath = join(dir, "Codex.app");
  plistPath = join(appPath, "Contents", "Info.plist");
  mkdirSync(join(appPath, "Contents"), { recursive: true });
  writeFileSync(plistPath, plist);
  binary = join(dir, "codex");
  const header = Buffer.alloc(64);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]).copy(header);
  header.writeUInt16LE(2, 16);
  header.writeUInt16LE(62, 18);
  writeFileSync(binary, header, { mode: 0o700 });
  binaryDigest = hashBytes(header);
  schema = join(dir, "schema");
  mkdirSync(schema, { mode: 0o700 });
  for (const file of schemaFiles) copyFileSync(schemaFixture(file), join(schema, file));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function collect(options: { cliPath?: string; version?: string | null; sha256?: string; schemaRoot?: string | null;
  appRoot?: string; extra?: string[]; exit?: number; uid?: number } = {}): string {
  const args = [options.uid === undefined ? probe : "-", "--head", head, "--control-revision", control, "--app-root", options.appRoot ?? appPath,
    "--cli-path", options.cliPath ?? binary];
  if (options.version !== null) args.push("--cli-version", options.version ?? tool, "--cli-sha256", options.sha256 ?? binaryDigest);
  if (options.schemaRoot !== null) args.push("--schema-root", options.schemaRoot ?? schema);
  const result = spawnSync("python3", [...args, ...(options.extra ?? [])], {
    encoding: "utf8", timeout: 10_000, maxBuffer: 8192,
    ...(options.uid === undefined ? {} : { uid: options.uid, cwd: dir, input: readFileSync(probe) }),
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(options.exit ?? 0);
  expect(result.stderr).toBe("");
  return result.stdout;
}

function reportOf(raw: string): Report {
  const report = readLocalCapability(raw);
  if (report.schema !== "PFM_LOCAL_CAPABILITY_OBSERVATION_V1") throw new Error("expected producer observation");
  return report;
}

type AuthorityFixture = {
  context: Context; selection: Selection; verify: Verify;
  accepted: Map<string, string>; hostBinding: object; proof: NonNullable<Context["observation"]>;
};

function authority(report: Report, payload: Request = request): AuthorityFixture {
  const time = report.observed_at;
  const context: Context = {
    envelope: { repository, id: "fixture-runner", revision: 1, created_at: time,
      producer: { role: "supervisor", actor: "fixture-supervisor", session: "fixture-authority" } },
    head, control_revision: control, host_id: request.host_id, environment: request.environment, worker: request.worker,
    config_digest: digest("reviewed-config"), permissions_digest: digest("permissions"), binary_digest: binaryDigest,
    tool_version: tool, app_digest: hashBytes(Buffer.from(plist)), now: time, verify: () => false,
  };
  const evidence = ref("external-host-evidence");
  const hostBinding = { repository, head, control_revision: control, host_id: request.host_id,
    environment: request.environment, worker: request.worker, config_digest: digest("reviewed-config"),
    permissions_digest: digest("permissions"), binary_digest: binaryDigest, tool_version: tool,
    app_digest: hashBytes(Buffer.from(plist)), observed_at: time, evidence,
    report: { id: "local-capability-observation", digest: digest(report) } };
  const selection: Selection = { evidence: ref("external-ui-proof"), session: ref("exact-ui-selection"),
    trust: "pending", observed_at: time };
  const accepted = new Map<string, string>([
    ["local_capability_host_observation", digest(hostBinding)],
    ["local_capability_hook_trust", digest({ host: hostBinding, request_digest: digest(payload), selection })],
  ]);
  const verify = vi.fn<Verify>((boundary, binding) => accepted.get(boundary) === digest(binding));
  return { context: { ...context, verify }, selection, verify, accepted, hostBinding,
    proof: { evidence, observed_at: time } };
}

describe("bounded local capability producer and advisory adapter", () => {
  it("passes actual canonical producer bytes to runner probe/prepare/launch without reserving or executing", () => {
    const raw = collect();
    const report = reportOf(raw);
    expect(raw).toBe(canonicalJson(report) + "\n");
    expect(raw).not.toContain(dir);
    expect(raw).not.toContain("fixture-secret");
    expect(report.app).toEqual({ status: "observed", reason: null,
      value: { version: app, build: "27194", ref: { id: "desktop-plist", digest: hashBytes(Buffer.from(plist)) } } });
    expect(report.cli).toEqual({ status: "observed", reason: null, value: { version: tool,
      version_source: "operator-declared", platform: "linux", arch: "x86_64", ref: { id: "cli-binary", digest: binaryDigest } } });
    expect(report.protocol).toMatchObject({ status: "observed", reason: null, value: {
      features: { thread_identity_cwd: true, exact_prompt: true, model_effort: true, permissions: true,
        turn_start: true, turn_interrupt: true, terminal: true, usage: true },
      files: schemaFiles.map((id) => ({ id, digest: hashBytes(readFileSync(schemaFixture(id))) })),
    } });
    const { context, proof } = authority(report);
    const advisory = localCapabilityInventory(raw, () => ({ ...context, observation: proof }));
    expect(advisory.reason).toBe("native-enforcement-unverified");
    expect(advisory.report.digest).toBe(digest(report));
    expect(canonicalJson(localCapabilityInventory(report, () => ({ ...context, observation: proof })).runtime))
      .toBe(canonicalJson(advisory.runtime));
    expect(localCapabilityInventory(raw, () => context)).toMatchObject({ reason: "external-observation-required",
      runtime: { runner: { tool_version: null }, resource_profile: null } });
    expect(advisory.runtime.runner.authentication_ref).toBeNull();
    expect(advisory.runtime.resource_profile).toBeNull();
    const unverified = (names: string[]) => Object.fromEntries(names.map((name) => [name, { status: "unverified", evidence: [] }]));
    const expectedRunner = { ...context.envelope, schema: "RUNNER_CAPABILITIES_V1", surface: "local", product: "codex",
      runtime_version: app, tool_version: tool, authentication_ref: null, references: [advisory.report, proof.evidence],
      operations: unverified(["probe", "prepare", "launch", "observe", "checkpoint", "stop", "resume", "hook_events",
        "pre_write_scope", "post_write_scope", "recovery", "model_effort", "usage", "context", "artifacts",
        "budget_enforcement", "terminal_acknowledgement", "separate_credentials", "writer_fencing"]),
    };
    expect(canonicalJson(advisory.runtime.runner)).toBe(canonicalJson(expectedRunner));
    expect(advisory.runtime.native).toEqual(unverified(["hard_ceiling", "deadline_watchdog", "host_isolation",
      "foreground_capacity", "kill_switch", "publication_fence", "late_usage", "artifact_retention",
      "credential_separation", "native_identity"]));
    const outside = vi.fn((): never => { throw new Error("native, reservation or preparation called"); });
    const runner = createRunnerAdapter({ surface: "local", repository, host: {
      inventory: () => advisory.runtime, verify: context.verify, clock: () => context.now,
      commitEffect: outside, resources: { lookup: outside }, preparation: outside,
    } });
    const inspected = runner.probe();
    expect(inspected).toMatchObject({ mode: "manual-v3" });
    expect(canonicalJson(inspected.runtime)).toBe(canonicalJson(advisory.runtime));
    expect(runner.prepare({ task_issue: 368 })).toMatchObject({ status: "unavailable", reason: "native-profile-uncertified" });
    expect(runner.launch({ task_issue: 368, grant: ref("unadmitted-grant") }))
      .toMatchObject({ status: "unavailable", reason: "native-profile-uncertified" });
    expect(() => createRunnerAdapter({ surface: "local", repository, host: {
      inventory: () => ({ ...advisory.runtime, native: { ...advisory.runtime.native,
        hard_ceiling: { status: "verified", evidence: [proof.evidence] } } }),
      verify: context.verify, clock: () => context.now, commitEffect: outside,
      resources: { lookup: outside }, preparation: outside,
    } }).probe()).toThrow("UNAUTHENTICATED adapter_capability");
    expect(outside).not.toHaveBeenCalled();
    for (const count of [1, 10, 100]) {
      const references = Array.from({ length: count }, () => advisory.report);
      expect(Buffer.byteLength(JSON.stringify(references))).toBeLessThan(125 * count);
    }
  });

  it.each([request, resumeRequest])("keeps $mode handoff preparation-only through the actual consumer", (payload) => {
    const raw = collect();
    const { context, proof, selection, accepted, hostBinding } = authority(reportOf(raw), payload);
    const advisory = localCapabilityInventory(raw, () => ({ ...context, observation: proof }));
    const serialized = preparation(payload);
    const normalized = readPreparationRequest(serialized);
    const requestDigest = digest(payload);
    expect(canonicalJson(normalized.request)).toBe(canonicalJson(payload));
    expect(normalized.binding).toMatchObject({ request_digest: requestDigest, nonce_digest: digest(payload.nonce),
      approval_digest: digest(normalized.approval), allowance: payload.host_allowance });
    expect(() => readPreparationRequest({ request: payload,
      approval: { ...normalized.approval, request_digest: digest("other-request") } }))
      .toThrow("PREPARATION_APPROVAL_BINDING");

    const gate = ref("gate");
    const evidence = ref("git-ready");
    const target = { session: "fixture-selection", turn: "fixture-turn", barrier: ref("unproven") };
    // A refusal-only seam. This authenticates the exact fixture payloads
    // without modeling live PM, receipt, lifecycle or resource authority.
    const makeSupervisor = (inventory: HandoffInventory, hookAllowed = false): Supervisor => ({
      withFreshHandoff(rawRequest, _phase, consume) {
        const { request, binding } = readPreparationRequest(rawRequest);
        if (binding.request_digest !== requestDigest) throw new Error("fixture gate request mismatch");
        const allowed = new Map([["handoff_readonly_inventory", digest({ request: payload, inventory, gate })]]);
        if (hookAllowed) allowed.set("handoff_actual_hook_configuration", digest({ request: payload, inventory, session: target, gate }));
        return consume({ request, gate, intent: { request_digest: binding.request_digest, evidence },
          verify: (boundary, observed) => allowed.get(boundary) === digest(observed) });
      },
    });
    const check = (selected: Selection | null, native: Handoff["native"], expected: HandoffInventory) => {
      const host: HandoffHost = { inventory: (input) => advisory.handoffInventory(input, selected) };
      const handoff = supervisedHandoff(serialized, makeSupervisor(expected), host);
      expect(handoff).toEqual({ schema: "PFM_SUPERVISED_HANDOFF_V1", request_digest: requestDigest, git_ready: evidence,
        status: "PREPARATION_ONLY", trust: expected.trust, native, session: null, prompt: "PFM_TASK_ISSUE: 368",
        directory: payload.target, head });
      return { handoff, host };
    };
    check(null, "HANDOFF_UNVERIFIED", { status: "observed", trust: "unknown", evidence: proof.evidence });
    const pendingInventory: HandoffInventory = { status: "observed", trust: "pending", evidence: selection.evidence };
    const pending = check(selection, "HANDOFF_APPROVAL_REQUIRED", pendingInventory);
    expect(() => reviewHookPreparedForAdmission(serialized, makeSupervisor(pendingInventory), pending.handoff,
      target, {}, pending.host)).toThrow("HANDOFF_NATIVE_TRUST");
    const observed: Selection = { ...selection, trust: "observed" };
    accepted.set("local_capability_hook_trust", digest({ host: hostBinding, request_digest: requestDigest, selection: observed }));
    const inventory: HandoffInventory = { status: "observed", trust: "observed", evidence: observed.evidence };
    const { handoff, host } = check(observed, "HANDOFF_UNVERIFIED", inventory);
    expect(() => supervisedHandoff(serialized, makeSupervisor(pendingInventory), host))
      .toThrow("UNAUTHENTICATED handoff_readonly_inventory");
    expect(() => reviewHookPreparedForAdmission(serialized, makeSupervisor(inventory), handoff, target, {}, host))
      .toThrow("UNAUTHENTICATED handoff_actual_hook_configuration");
    expect(() => reviewHookPreparedForAdmission(serialized, makeSupervisor(inventory, true), handoff,
      { ...target, session: "wrong-session" }, {}, host)).toThrow("UNAUTHENTICATED handoff_actual_hook_configuration");
    expect(() => reviewHookPreparedForAdmission(serialized, makeSupervisor(inventory, true), handoff, target, {}, host))
      .toThrow("UNAUTHENTICATED handoff_live_nonwriting_barrier");

    const wrongHead: Request = payload.mode === "new" ? { ...payload, expected_main: control }
      : { ...payload, expected_head: control };
    for (const wrong of [wrongHead, { ...payload, host_id: "other" }, { ...payload, worker: "other" },
      { ...payload, environment: "other" }, { ...payload, parser_revision: head }, { ...payload, repository: "other/pfm" }]) {
      expect(advisory.handoffInventory(readPreparationRequest(preparation(wrong)).request, observed))
        .toEqual(unknownInventory);
    }
    const otherMode = payload.mode === "new" ? resumeRequest : request;
    for (const replay of [otherMode, { ...payload, target: "/other/worktree" }, { ...payload, task_issue: 369 },
      { ...payload, task_revision: 4 }, { ...payload, branch: "codex/other" }, { ...payload, goal_revision: 3 },
      { ...payload, census: ref("other-census") }, { ...payload, host_allowance: ref("other-allowance") },
      { ...payload, nonce: digest("replayed-under-different-nonce") },
      ...(payload.mode === "resume" ? [{ ...payload, expected_main: head }] : [])]) {
      const replayRequest = readPreparationRequest(preparation(replay)).request;
      expect(() => advisory.handoffInventory(replayRequest, observed)).toThrow("UNAUTHENTICATED local_capability_hook_trust");
    }
  });

  it("re-reads the clock, expected binding and external authority for a retained handoff port", () => {
    const report = reportOf(collect());
    const { context, proof, selection, verify, accepted, hostBinding } = authority(report);
    const original: Context = { ...context, observation: structuredClone(proof) };
    let current = original;
    const adversarialVerifier: Verify = (boundary, binding) => {
      const allowed = verify(boundary, binding);
      if (typeof binding === "object" && binding !== null && "evidence" in binding) {
        Object.assign(binding, { evidence: ref("verifier-mutated-ref") });
      }
      return allowed;
    };
    current = { ...original, verify: adversarialVerifier };
    const advisory = localCapabilityInventory(report, () => current);
    const { handoffInventory } = advisory;
    const normalized = readPreparationRequest(preparation(request)).request;
    const pending: HandoffInventory = { status: "observed", trust: "pending", evidence: { ...selection.evidence } };
    const observed: HandoffInventory = { status: "observed", trust: "unknown", evidence: { ...proof.evidence } };
    expect(handoffInventory(structuredClone(normalized), structuredClone(selection))).toEqual(pending);
    const returnedHost = handoffInventory(normalized, null);
    const returnedSelection = handoffInventory(normalized, selection);
    if (returnedHost.evidence === null || returnedSelection.evidence === null) throw new Error("missing fixture evidence");
    returnedHost.evidence.digest = digest("changed-returned-host");
    returnedSelection.evidence.digest = digest("changed-returned-selection");
    advisory.report.digest = digest("changed-output-report");
    for (const reference of advisory.runtime.runner.references) reference.digest = digest("changed-output-runtime");
    report.head = control;
    expect(handoffInventory(normalized, null)).toEqual(observed);
    expect(handoffInventory(normalized, selection)).toEqual(pending);
    current = { ...original, verify: () => false };
    expect(() => handoffInventory(normalized, null)).toThrow("UNAUTHENTICATED local_capability_host_observation");

    for (const change of [{ config_digest: digest("wrong-config") }, { permissions_digest: digest("wrong-permissions") },
      { host_id: "other-host" }, { worker: "other-worker" }, { environment: "other-environment" },
      { envelope: { ...context.envelope, repository: "other/pfm" } },
      { observation: { ...proof, evidence: ref("substituted-proof") } }]) {
      current = { ...original, ...change };
      expect(() => handoffInventory(normalized, null)).toThrow("UNAUTHENTICATED local_capability_host_observation");
    }
    const at = (offset: number) => new Date(Date.parse(context.now) + offset).toISOString();
    for (const change of [{ head: control }, { control_revision: head }, { binary_digest: digest("wrong-binary") },
      { tool_version: app }, { app_digest: null }, { now: at(600_001) }, { now: at(-1) },
      { observation: { ...proof, observed_at: at(1) } }, { observation: { ...proof, observed_at: at(-1) } },
      { observation: null }]) {
      current = { ...original, ...change };
      expect(handoffInventory(normalized, null)).toEqual(unknownInventory);
      expect(handoffInventory(normalized, selection)).toEqual(unknownInventory);
    }
    current = original;
    if (original.observation == null) throw new Error("missing fixture proof");
    original.observation.evidence.digest = digest("mutated-caller-proof");
    expect(() => handoffInventory(normalized, null)).toThrow("UNAUTHENTICATED local_capability_host_observation");
    original.observation.evidence.digest = proof.evidence.digest;
    for (const altered of [{ ...selection, session: ref("wrong-session") },
      { ...selection, evidence: ref("wrong-selection-proof") }, { ...selection, trust: "observed" as const }]) {
      expect(() => handoffInventory(normalized, altered)).toThrow("UNAUTHENTICATED local_capability_hook_trust");
    }
    for (const time of [at(-600_001), at(1)]) {
      expect(() => handoffInventory(normalized, { ...selection, observed_at: time })).toThrow("LOCAL_CAPABILITY_TRUST");
    }
    expect(handoffInventory(normalized, selection)).toEqual(pending);
    accepted.delete("local_capability_hook_trust");
    expect(() => handoffInventory(normalized, selection)).toThrow("UNAUTHENTICATED local_capability_hook_trust");
    expect(handoffInventory(normalized, null)).toEqual(observed);
    const replacement = { ...proof, evidence: ref("newly-authenticated-proof") };
    const replacementBinding = { ...hostBinding, evidence: replacement.evidence };
    accepted.set("local_capability_host_observation", digest(replacementBinding));
    accepted.set("local_capability_hook_trust", digest({ host: hostBinding, request_digest: digest(normalized), selection }));
    current = { ...original, observation: replacement };
    expect(handoffInventory(normalized, null)).toEqual({ ...observed, evidence: replacement.evidence });
    expect(() => handoffInventory(normalized, selection)).toThrow("UNAUTHENTICATED local_capability_hook_trust");
    accepted.delete("local_capability_host_observation");
    expect(() => handoffInventory(normalized, null)).toThrow("UNAUTHENTICATED local_capability_host_observation");
  });

  it("redacts and distinguishes missing, denied, unavailable, unsupported and mismatched inputs", () => {
    expect(reportOf(collect({ appRoot: join(dir, "absent", "Codex.app"), schemaRoot: null }))).toMatchObject({
      app: { status: "unobserved", reason: "missing", value: null }, protocol: { reason: "not-selected", value: null },
    });
    expect(reportOf(collect({ sha256: "a".repeat(64) }))).toMatchObject({
      cli: { reason: "binding-mismatch", value: null }, protocol: { reason: "binding-mismatch", value: null },
    });
    expect(reportOf(collect({ version: null, schemaRoot: null })).cli).toMatchObject({
      status: "observed", reason: null, value: { version: null, version_source: "unobserved" },
    });
    const root = process.getuid?.() === 0;
    const permissionProbe = root ? { uid: 65534, schemaRoot: null } : { schemaRoot: null };
    if (root) {
      for (const ancestor of [dir, appPath, join(appPath, "Contents")]) chmodSync(ancestor, 0o755);
    }
    chmodSync(plistPath, 0o644);
    expect(reportOf(collect(permissionProbe)).app.status).toBe("observed");
    chmodSync(plistPath, 0);
    expect(reportOf(collect(permissionProbe)).app).toMatchObject({ reason: "denied", value: null });
    chmodSync(plistPath, 0o644);
    writeFileSync(plistPath, plist.replace(app, "unknown-version"));
    expect(reportOf(collect()).app).toMatchObject({ reason: "unsupported", value: null });
    const file = join(schema, schemaFiles[0]);
    writeFileSync(file, '{"title":"ClientRequest","oneOf":[]}');
    expect(reportOf(collect()).protocol).toMatchObject({ reason: "unsupported", value: null });
    writeFileSync(binary, "fixture-secret");
    expect(reportOf(collect()).cli).toMatchObject({ reason: "unsupported", value: null });
  });

  it.each([
    [0, '"RequestId": { "anyOf": [{ "type": "string" }, { "type": "integer", "format": "int64" }] }',
      '"RequestId": { "type": "object" }', ["thread_identity_cwd", "exact_prompt", "model_effort", "permissions", "turn_start", "turn_interrupt"]],
    [0, '"id": { "$ref": "#/definitions/RequestId" }', '"id": { "$ref": "#/definitions/OtherId" }',
      ["thread_identity_cwd", "permissions"]],
    [0, '"params": { "$ref": "#/definitions/ThreadStartParams" }', '"params": { "$ref": "#/definitions/TurnStartParams" }',
      ["thread_identity_cwd", "permissions"]],
    [0, '"cwd": { "type": ["string", "null"] }', '"cwd": { "type": "string", "not": {} }', ["thread_identity_cwd"]],
    [0, '"threadId": { "type": "string" }', '"threadId": { "type": ["string", "null"] }', ["exact_prompt", "model_effort", "turn_start"]],
    [0, '"input": { "type": "array"', '"input": { "type": "array", "maxItems": 0', ["exact_prompt", "model_effort", "turn_start"]],
    [0, '"text": { "type": "string" }', '"text": { "type": ["string", "null"] }', ["exact_prompt", "model_effort", "turn_start"]],
    [0, '"required": ["type", "text"]', '"required": ["type"]', ["exact_prompt", "model_effort", "turn_start"]],
    [0, '"#/definitions/UserInput"', '"#/definitions/MissingInput"', ["exact_prompt", "model_effort", "turn_start"]],
    [0, '"model": { "type": ["string", "null"] }', '"model": { "type": "string", "const": "fixture-secret" }', ["model_effort"]],
    [0, '"enum": ["low", "medium", "high"]', '"enum": ["unknown-effort"]', ["model_effort"]],
    [0, '"type": "string", "enum": ["read-only", "workspace-write"]', '"type": "string"', ["permissions"]],
    [0, '"turnId": { "type": "string" }', '"turnId": { "type": ["string", "null"] }', ["turn_interrupt"]],
    [1, '"type": "string", "enum": ["completed", "interrupted", "failed", "inProgress"]', '"type": "string"', ["terminal"]],
    [1, '"id": { "type": "string" }', '"id": { "type": ["string", "null"] }', ["terminal"]],
    [1, '"required": ["last", "total"]', '"required": []', ["usage"]],
    [1, '"#/definitions/ThreadTokenUsage"', '"#/definitions/Turn"', ["usage"]],
    [1, '"format": "uint64", "minimum": 0', '"format": "uint64", "minimum": 0, "maximum": -1', ["usage"]],
  ] satisfies [0 | 1, string, string, string[]][])("refuses forged declarations in schema %s for %s", (index, before, after, unobserved) => {
    const name = schemaFiles[index];
    const source = readFileSync(schemaFixture(name), "utf8");
    expect(source).toContain(before);
    writeFileSync(join(schema, name), source.replace(before, after));
    const raw = collect();
    expect(raw).not.toContain("fixture-secret");
    const protocol = reportOf(raw).protocol;
    expect(protocol.status).toBe("observed");
    if (protocol.status !== "observed") throw new Error("missing fixture protocol");
    for (const [feature, present] of Object.entries(protocol.value.features)) {
      expect(present, feature).toBe(!unobserved.includes(feature));
    }
  });

  it("refuses aliases, links, FIFOs and oversized, duplicate or malformed metadata without echoing it", () => {
    expect(reportOf(collect({ schemaRoot: schema + "/../schema" })).protocol.reason).toBe("unsafe-path");
    expect(reportOf(collect({ schemaRoot: schema + "/" })).protocol.reason).toBe("unsafe-path");
    const file = join(schema, schemaFiles[0]);
    chmodSync(file, 0o666);
    expect(reportOf(collect()).protocol.reason).toBe("unsafe-path");
    rmSync(file);
    symlinkSync(schemaFixture(schemaFiles[0]), file);
    expect(reportOf(collect()).protocol.reason).toBe("unsafe-path");
    rmSync(file);
    const other = join(dir, "duplicate.json");
    copyFileSync(schemaFixture(schemaFiles[0]), other);
    linkSync(other, file);
    expect(reportOf(collect()).protocol.reason).toBe("unsafe-path");
    rmSync(file);
    const fifo = spawnSync("mkfifo", [file], { encoding: "utf8", timeout: 1000 });
    expect(fifo.status).toBe(0);
    expect(reportOf(collect()).protocol.reason).toBe("unsafe-path");
    rmSync(file);
    for (const [content, reason] of [
      ['{"x":0,"x":"fixture-secret"}', "malformed"], ['{"broken":', "malformed"],
      ["[".repeat(40) + "0" + "]".repeat(40), "oversized"], ["X".repeat(1_048_577), "oversized"],
      [readFileSync(schemaFixture(schemaFiles[0]), "utf8").replace('"oneOf":', '"not": {}, "oneOf":'), "unsupported"],
    ] as const) {
      writeFileSync(file, content);
      const raw = collect();
      expect(raw).not.toContain("fixture-secret");
      expect(reportOf(raw).protocol).toMatchObject({ reason, value: null });
    }
    writeFileSync(plistPath, plist.replace("</dict>", "<key>CFBundleVersion</key><string>2</string></dict>"));
    expect(reportOf(collect()).app).toMatchObject({ reason: "malformed", value: null });
    writeFileSync(plistPath, "<plist><dict>");
    expect(reportOf(collect()).app).toMatchObject({ reason: "malformed", value: null });
    const bad = collect({ extra: ["--head", "fixture-secret"], exit: 2 });
    expect(bad).not.toContain("fixture-secret");
    expect(readLocalCapability(bad)).toEqual({ schema: "PFM_LOCAL_CAPABILITY_ERROR_V1", reason: "invalid-input" });
    for (const options of [{ version: "fixture-secret" }, { sha256: "fixture-secret" }]) {
      const invalid = collect({ ...options, exit: 2 });
      expect(invalid).not.toContain("fixture-secret");
      expect(readLocalCapability(invalid)).toEqual({ schema: "PFM_LOCAL_CAPABILITY_ERROR_V1", reason: "invalid-input" });
    }
  });

  it("rejects forged capabilities, refs, secret fields and noncanonical serialized copies", () => {
    const raw = collect();
    const report = reportOf(raw);
    expect(() => readLocalCapability(raw.replace('"head":', `"head":"${head}","head":`)))
      .toThrow("LOCAL_CAPABILITY_NONCANONICAL");
    expect(() => readLocalCapability(raw.replace('"head":', '"head": '))).toThrow("LOCAL_CAPABILITY_NONCANONICAL");
    expect(() => readLocalCapability(raw.slice(0, -10))).toThrow("LOCAL_CAPABILITY_JSON");
    expect(() => readLocalCapability({ ...report, operations: { launch: { status: "verified" } } }))
      .toThrow("LOCAL_CAPABILITY_FIELDS");
    expect(() => readLocalCapability({ ...report, app: { ...report.app, credential: "fixture-secret" } }))
      .toThrow("LOCAL_CAPABILITY_FIELDS");
    expect(() => readLocalCapability({ ...report, extra: "X".repeat(5000) })).toThrow("JSON_BOUND");
    expect(() => readLocalCapability({ ...report,
      extra: Array.from({ length: 20 }).reduce<unknown>((child) => ({ child }), null),
    })).toThrow("JSON_BOUND");
    if (report.protocol.status !== "observed") throw new Error("expected static schema witness");
    const protocol = report.protocol;
    expect(() => readLocalCapability({ ...report, protocol: { ...report.protocol,
      value: { ...protocol.value, binary: { id: "cli-binary", digest: digest("different") } },
    } })).toThrow("LOCAL_CAPABILITY_PROTOCOL");
    expect(() => readLocalCapability({ ...report, protocol: { ...report.protocol,
      value: { ...protocol.value, files: [{ id: "fixture-secret", digest: digest("wrong-file") }, protocol.value.binary] },
    } })).toThrow("LOCAL_CAPABILITY_REFERENCE");
  });
});
