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
type Runtime = {
  runner: { operations: Record<string, Capability>; authentication_ref: null; tool_version: string | null };
  native: Record<string, Capability>;
  resource_profile: null;
};
type HandoffInventory = {
  status: "observed" | "unverified"; trust: "unknown" | "pending" | "observed"; evidence: Ref | null;
};
type Selection = { evidence: Ref; session: Ref; trust: "pending" | "observed"; observed_at: string };
type Request = {
  repository: string; host_id: string; environment: string; worker: string; parser_revision: string;
  expected_main: string; expected_head: null; mode: "new"; task_issue: number; target: string;
};
type Context = {
  envelope: { repository: string; id: string; revision: number; created_at: string;
    producer: { role: "supervisor"; actor: string; session: string } };
  observation?: { evidence: Ref; observed_at: string };
  now: string; head: string; control_revision: string; host_id: string; environment: string; worker: string;
  config_digest: string; permissions_digest: string; binary_digest: string; tool_version: string;
  app_digest: string | null; verify: Verify;
};
type Advisory = {
  reason: string; report: Ref; runtime: Runtime;
  handoffInventory: (request: Request, selection?: Selection | null) => HandoffInventory;
};
type RunnerHost = {
  inventory: () => Runtime; verify: Verify; clock: () => string; preparation: () => never;
  resources: { lookup: () => never }; commitEffect: () => never;
};
type Gate = {
  request: Request; verify: Verify; gate: Ref; intent: { request_digest: string; evidence: Ref };
};
type Supervisor = {
  withFreshHandoff: <T>(raw: Request, phase: "handoff" | "prepared", consume: (authority: Gate) => T) => T;
};
type Handoff = { status: string; trust: string; native: string; session: null };
type HandoffHost = { inventory: (request: Request) => HandoffInventory };

const load = (name: string) => import(new URL(`../tools/codex/goal-framework/${name}.mjs`, import.meta.url).href);
const { canonicalJson, digest }: { canonicalJson: (data: unknown) => string; digest: (data: unknown) => string } =
  await load("contracts");
const { readLocalCapability, localCapabilityInventory }: {
  readLocalCapability: (raw: unknown) => Report | InputError;
  localCapabilityInventory: (raw: unknown, context: Context) => Advisory;
} = await load("adapters/local-capability");
const { createRunnerAdapter }: {
  createRunnerAdapter: (options: { surface: "local"; repository: string; host: RunnerHost }) => {
    probe: () => unknown; prepare: (request: { task_issue: number }) => unknown;
    launch: (request: { task_issue: number }) => unknown;
  };
} = await load("adapters/runner");
const { supervisedHandoff, reviewHookPreparedForAdmission }: {
  supervisedHandoff: (raw: Request, supervisor: Supervisor, host: HandoffHost) => Handoff;
  reviewHookPreparedForAdmission: (raw: Request, supervisor: Supervisor, handoff: Handoff,
    target: { session: string; turn: string; barrier: Ref }, input: object, host: HandoffHost) => unknown;
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
const request: Request = { repository, host_id: "mac", environment: "isolated", worker: "fixture-worker",
  parser_revision: control, expected_main: head, expected_head: null, mode: "new", task_issue: 368, target: "/fixture/worktree" };
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
  dir = mkdtempSync(join(realpathSync(tmpdir()), "pfm-capability-"));
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
  const args = [probe, "--head", head, "--control-revision", control, "--app-root", options.appRoot ?? appPath,
    "--cli-path", options.cliPath ?? binary];
  if (options.version !== null) args.push("--cli-version", options.version ?? tool, "--cli-sha256", options.sha256 ?? binaryDigest);
  if (options.schemaRoot !== null) args.push("--schema-root", options.schemaRoot ?? schema);
  const result = spawnSync("python3", [...args, ...(options.extra ?? [])], {
    encoding: "utf8", timeout: 10_000, maxBuffer: 8192, ...(options.uid === undefined ? {} : { uid: options.uid }),
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

function authority(report: Report) {
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
    ["local_capability_hook_trust", digest({ host: hostBinding, request_digest: digest(request), selection })],
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
    const advisory = localCapabilityInventory(raw, { ...context, observation: proof });
    expect(advisory.reason).toBe("native-enforcement-unverified");
    expect(advisory.report.digest).toBe(digest(report));
    expect(localCapabilityInventory(report, { ...context, observation: proof }).runtime).toEqual(advisory.runtime);
    expect(localCapabilityInventory(raw, context)).toMatchObject({ reason: "external-observation-required",
      runtime: { runner: { tool_version: null }, resource_profile: null } });
    expect(advisory.runtime.runner.authentication_ref).toBeNull();
    expect(advisory.runtime.resource_profile).toBeNull();
    expect(Object.keys(advisory.runtime.runner.operations)).toHaveLength(19);
    expect(Object.keys(advisory.runtime.native)).toHaveLength(10);
    for (const capability of [...Object.values(advisory.runtime.runner.operations), ...Object.values(advisory.runtime.native)]) {
      expect(capability).toEqual({ status: "unverified", evidence: [] });
    }
    const outside = vi.fn((): never => { throw new Error("native, reservation or preparation called"); });
    const runner = createRunnerAdapter({ surface: "local", repository, host: {
      inventory: () => advisory.runtime, verify: context.verify, clock: () => context.now,
      commitEffect: outside, resources: { lookup: outside }, preparation: outside,
    } });
    expect(runner.probe()).toMatchObject({ mode: "manual-v3" });
    expect(runner.prepare({ task_issue: 368 })).toMatchObject({ status: "unavailable", reason: "native-profile-uncertified" });
    expect(runner.launch({ task_issue: 368 })).toMatchObject({ status: "unavailable", reason: "native-profile-uncertified" });
    expect(outside).not.toHaveBeenCalled();
    expect(() => createRunnerAdapter({ surface: "local", repository, host: {
      inventory: () => ({ ...advisory.runtime, native: { ...advisory.runtime.native,
        hard_ceiling: { status: "verified", evidence: [proof.evidence] } }),
      verify: context.verify, clock: () => context.now, commitEffect: outside,
      resources: { lookup: outside }, preparation: outside,
    } }).probe()).toThrow("UNAUTHENTICATED adapter_capability");
    for (const count of [1, 10, 100]) {
      const references = Array.from({ length: count }, () => advisory.report);
      expect(Buffer.byteLength(JSON.stringify(references))).toBeLessThan(125 * count);
    }
  });

  it("binds pending or observed UI trust to this request without establishing a receipt or barrier", () => {
    const raw = collect();
    const { context, proof, selection, accepted, hostBinding } = authority(reportOf(raw));
    const advisory = localCapabilityInventory(raw, { ...context, observation: proof });
    const gate = ref("gate");
    const makeSupervisor = (inventory: HandoffInventory): Supervisor => ({
      withFreshHandoff(rawRequest, _phase, consume) {
        return consume({ request: rawRequest, gate, intent: { request_digest: digest(request), evidence: ref("git-ready") },
          verify: (boundary, binding) => boundary === "handoff_readonly_inventory"
            && digest(binding) === digest({ request, inventory, gate }) });
      },
    });
    const check = (selected: Selection | null, trust: string, native: string, expected: HandoffInventory) => {
      const host: HandoffHost = { inventory: (input) => advisory.handoffInventory(input, selected) };
      const supervisor = makeSupervisor(expected);
      const handoff = supervisedHandoff(request, supervisor, host);
      expect(handoff).toMatchObject({ status: "PREPARATION_ONLY", trust, native, session: null, prompt: "PFM_TASK_ISSUE: 368" });
      return { handoff, supervisor, host };
    };
    check(null, "unknown", "HANDOFF_UNVERIFIED", { status: "observed", trust: "unknown", evidence: proof.evidence });
    check(selection, "pending", "HANDOFF_APPROVAL_REQUIRED", { status: "observed", trust: "pending", evidence: selection.evidence });
    const observed: Selection = { ...selection, trust: "observed" };
    accepted.set("local_capability_hook_trust", digest({ host: hostBinding, request_digest: digest(request), selection: observed }));
    const { handoff, supervisor, host } = check(observed, "observed", "HANDOFF_UNVERIFIED",
      { status: "observed", trust: "observed", evidence: observed.evidence });
    expect(() => reviewHookPreparedForAdmission(request, supervisor, handoff,
      { session: "fixture-selection", turn: "fixture-turn", barrier: ref("unproven") }, {}, host))
      .toThrow("UNAUTHENTICATED handoff_actual_hook_configuration");
    for (const change of [{ host_id: "other" }, { worker: "other" }, { environment: "other" }, { parser_revision: head }]) {
      expect(advisory.handoffInventory({ ...request, ...change }, observed))
        .toEqual({ status: "unverified", trust: "unknown", evidence: null });
    }
    expect(() => advisory.handoffInventory({ ...request, target: "/other/worktree" }, observed))
      .toThrow("UNAUTHENTICATED local_capability_hook_trust");
    expect(() => advisory.handoffInventory(request, { ...observed, session: ref("other-session") }))
      .toThrow("UNAUTHENTICATED local_capability_hook_trust");
    expect(() => localCapabilityInventory(raw, { ...context, observation: proof, config_digest: digest("changed") }))
      .toThrow("UNAUTHENTICATED local_capability_host_observation");
    expect(() => localCapabilityInventory(raw, { ...context, observation: proof, verify: () => false }))
      .toThrow("UNAUTHENTICATED local_capability_host_observation");
    for (const change of [{ head: control }, { control_revision: head }, { binary_digest: digest("wrong-binary") },
      { tool_version: app }, { now: new Date(Date.parse(context.now) + 601_000).toISOString() }]) {
      expect(localCapabilityInventory(raw, { ...context, ...change, observation: proof }).reason)
        .toBe("stale-or-mismatched-observation");
    }
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
    chmodSync(plistPath, 0);
    const root = process.getuid?.() === 0;
    expect(reportOf(collect(root ? { uid: 65534 } : {})).app).toMatchObject({ reason: "denied", value: null });
    chmodSync(plistPath, 0o644);
    writeFileSync(plistPath, plist.replace(app, "unknown-version"));
    expect(reportOf(collect()).app).toMatchObject({ reason: "unsupported", value: null });
    const file = join(schema, schemaFiles[0]);
    writeFileSync(file, '{"title":"ClientRequest","oneOf":[]}');
    expect(reportOf(collect()).protocol).toMatchObject({ reason: "unsupported", value: null });
    const schemaText = readFileSync(schemaFixture(schemaFiles[0]), "utf8");
    writeFileSync(file, schemaText.replace('"input": { "type": "array"', '"input": { "type": "string"'));
    expect(reportOf(collect()).protocol).toMatchObject({ status: "observed", value: {
      features: { exact_prompt: false, turn_start: false, turn_interrupt: true },
    } });
    writeFileSync(binary, "fixture-secret");
    expect(reportOf(collect()).cli).toMatchObject({ reason: "unsupported", value: null });
  });

  it("refuses aliases, links, FIFOs and oversized, duplicate or malformed metadata without echoing it", () => {
    expect(reportOf(collect({ schemaRoot: schema + "/../schema" })).protocol.reason).toBe("unsafe-path");
    expect(reportOf(collect({ schemaRoot: schema + "/" })).protocol.reason).toBe("unsafe-path");
    const file = join(schema, schemaFiles[0]);
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
    expect(() => readLocalCapability({ ...report, protocol: { ...report.protocol,
      value: { ...report.protocol.value, binary: { id: "cli-binary", digest: digest("different") } },
    } })).toThrow("LOCAL_CAPABILITY_PROTOCOL");
  });
});
