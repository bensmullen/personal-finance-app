import { describe, expect, it, vi } from "vitest";

const load = (name: string) => import(new URL(`../tools/codex/goal-framework/${name}.mjs`, import.meta.url).href);
const { digest } = await load("contracts");
const { createRunnerAdapter } = await load("adapters/runner");
const { assessLocalPreflight, localPreflightAdvisory, planLocalPreflight, probeLocalPreflight,
  recheckLocalPreflight } = await load("adapters/preflight");

const repository = "fixture/pfm";
const now = "2026-01-01T00:00:00Z";
const deadline = "2026-01-01T00:02:00Z";
const head = "a".repeat(40);
const profileRef = (id: string) => ({ id, digest: digest(id) });
const envelope = (schema: string) => ({ schema, id: schema.toLowerCase(), repository, revision: 1, created_at: now,
  producer: { actor: "host", session: "trusted-supervisor", role: "supervisor" }, references: [] });
const workspace = { ...envelope("WORKSPACE_RECEIPT_V1"), task_issue: 368, issue_body_digest: digest("saved"),
  directory: "/fixture/worktree", environment: "local", origin_repository: repository, branch: "codex/fixture",
  head_sha: head, upstream_head_sha: head, state: "ready", receipt_owner: "fixture-turn",
  writer_fence: 4, ready_proof: profileRef("worktree") };
const verify = () => true; // Synthetic supervisor only.
const workspaceRef = { id: workspace.id, digest: digest(workspace) };
const env = { workspace: workspaceRef, node_major: 22, npm_major: 10, dependencies: "verified",
  merged_tools: "verified", toolchain: profileRef("node-and-npm"), evidence: profileRef("environment") };
const candidate = {
  id: "candidate-0", base_sha: "b".repeat(40), head_sha: head, patch_digest: digest("patch"),
  tool_digest: digest("tool"), lockfile_digest: digest("lock"), active_authorization: profileRef("active-receipt"),
  units: [{ path: "test/z.test.ts", directly_affected: true, tracked: true },
    { path: "test/a.test.ts", directly_affected: true, tracked: true },
    { path: "test/0.test.ts", directly_affected: false, tracked: true }],
  evidence: profileRef("read-only-coverage"),
};

function preflightFixture(observation: Partial<typeof env> | null = {}) {
  const capability = probeLocalPreflight(workspace, {
    inspectEnvironment: () => observation === null ? null : { ...env, ...observation }, verify,
  });
  const policy = { risk: "standard", expected_benefit: "worthwhile", profile: profileRef("approved-selection-profile"),
    evidence: profileRef("policy"), bound_hook_execution: true, goal_issue: 362, goal_revision: 3,
    goal_control_digest: digest("goal"), task_revision: 6 };
  const allowance = { granted: true, deadline, cpu_millicores: 100, memory_mib: 128, processes: 2, disk_mib: 8,
    foreground_idle: true, test_slots: 1, evidence: profileRef("gf05-allowance") };
  return { workspace, capability, policy, allowance };
}

describe("optional shadow preflight", () => {
  const host = { verify, now };
  it("assesses prepare before a writer or candidate exists and selects one direct tracked test", () => {
    const fixture = preflightFixture();
    expect(assessLocalPreflight(fixture, host)).toMatchObject({ state: "eligible", reason: null });
    const decision = planLocalPreflight(fixture, candidate, host);
    expect(decision).toMatchObject({ selection: "SELECTED", authority: "ADVISORY", unit: "test/a.test.ts",
      budget: { typecheck_ms: 60_000, unit_ms: 30_000 } });
    expect(recheckLocalPreflight(decision, fixture, candidate, host)).toMatchObject({ unit: "test/a.test.ts" });
    for (const change of [{ patch_digest: digest("changed") }, { tool_digest: digest("upgraded") },
      { lockfile_digest: digest("new-lock") }, { active_authorization: profileRef("replaced") }]) {
      expect(() => recheckLocalPreflight(decision, fixture, { ...candidate, ...change }, host)).toThrow("STALE");
    }
    expect(() => recheckLocalPreflight(decision, fixture, candidate, { ...host,
      verify: (boundary: string) => boundary !== "local_preflight_active_grant_and_exact_hook" })).toThrow("UNAUTHENTICATED");
  });

  it.each([
    [null, "environment-unverified"],
    [{ npm_major: null }, "environment-unverified"],
    [{ npm_major: 9 }, "environment-unavailable"],
    [{ dependencies: "unavailable" }, "environment-unavailable"],
    [{ merged_tools: "unavailable" }, "environment-unavailable"],
  ] as const)("keeps unavailable and unknown environments distinct %#", (observation, reason) => {
    expect(planLocalPreflight(preflightFixture(observation as Partial<typeof env> | null), candidate, host))
      .toMatchObject({ selection: "NOT_SELECTED", reason, unit: null });
  });

  it("records finite reasons for CI, foreground load, absent unit coverage and missing patch evidence", () => {
    const fixture = preflightFixture();
    for (const expected_benefit of ["documentation-only", "ci-sufficient"]) {
      expect(planLocalPreflight({ ...fixture, policy: { ...fixture.policy, expected_benefit } }, candidate, host).reason)
        .toBe(expected_benefit);
    }
    expect(planLocalPreflight({ ...fixture, allowance: { ...fixture.allowance, foreground_idle: false } }, candidate, host).reason)
      .toBe("host-budget-denied");
    expect(planLocalPreflight({ ...fixture, policy: { ...fixture.policy, bound_hook_execution: false } }, candidate, host).reason)
      .toBe("execution-unavailable");
    expect(planLocalPreflight(fixture, { ...candidate, units: [] }, host).reason).toBe("no-matching-unit");
    expect(planLocalPreflight(fixture, { ...candidate, patch_digest: null }, host).reason).toBe("patch-unverified");
    const notSelected = planLocalPreflight(fixture, { ...candidate, units: [] }, host);
    const readAttempt = vi.fn(() => null);
    expect(localPreflightAdvisory(notSelected, { verify, readAttempt }).outcome).toBe("NOT_ATTEMPTED");
    expect(readAttempt).not.toHaveBeenCalled();
    expect(() => localPreflightAdvisory({ ...notSelected, reason: "made-up" }, { verify, readAttempt })).toThrow("SELECTION_REASON");
    const { reason: _reason, ...missing } = notSelected;
    expect(() => localPreflightAdvisory(missing, { verify, readAttempt })).toThrow("SELECTION_REASON");
  });

  it("reports only host-bound observations and retains mixed timeout and failure", () => {
    const decision = planLocalPreflight(preflightFixture(), candidate, host);
    const sealed = { decision: { id: decision.id, digest: digest(decision) }, patch_digest: decision.patch_digest,
      active_authorization: decision.active_authorization, tool_digest: decision.tool_digest, unit: decision.unit,
      receipt: profileRef("protected-post-tool-use"), host_observed: true, outcome: "FAIL", timeout_observed: true };
    expect(localPreflightAdvisory(decision, { verify, readAttempt: () => null }).outcome).toBe("NOT_ATTEMPTED");
    expect(localPreflightAdvisory(decision, { verify, readAttempt: () => ({ ...sealed, host_observed: false }) }).outcome)
      .toBe("NOT_OBSERVED");
    for (const outcome of ["PASS", "FAIL", "TIMEOUT", "SKIP", "INCOMPLETE"]) {
      const observed = { ...sealed, outcome, timeout_observed: ["FAIL", "TIMEOUT"].includes(outcome) };
      expect(localPreflightAdvisory(decision, { verify, readAttempt: () => observed }))
        .toMatchObject({ outcome, timeout_observed: observed.timeout_observed, receipt: sealed.receipt });
    }
    expect(() => localPreflightAdvisory(decision, { verify, readAttempt: () => ({ ...sealed, patch_digest: digest("stale") }) }))
      .toThrow("ATTEMPT_BINDING");
    expect(() => localPreflightAdvisory(decision, { readAttempt: () => sealed,
      verify: (boundary: string) => boundary !== "local_preflight_hash_bound_hook_attempt" })).toThrow("UNAUTHENTICATED");
  });

  it.each([1, 10, 100])("keeps %i advisory records proportional and referential", (count) => {
    const records = Array.from({ length: count }, (_, index) => {
      const decision = planLocalPreflight(preflightFixture(), { ...candidate, id: `candidate-${index}` }, host);
      return localPreflightAdvisory(decision, { verify, readAttempt: () => null });
    });
    expect(new Set(records.map(({ decision }: { decision: { id: string } }) => decision.id)).size).toBe(count);
    expect(Buffer.byteLength(JSON.stringify(records))).toBeLessThan(count * 420);
    expect(JSON.stringify(records)).not.toContain(workspace.directory);
  });
});

const operations = ["probe", "prepare", "launch", "observe", "checkpoint", "stop", "resume", "hook_events",
  "pre_write_scope", "post_write_scope", "recovery", "model_effort", "usage", "context", "artifacts",
  "budget_enforcement", "terminal_acknowledgement", "separate_credentials", "writer_fencing"];
const extras = ["hard_ceiling", "deadline_watchdog", "host_isolation", "foreground_capacity", "kill_switch",
  "publication_fence", "late_usage", "artifact_retention", "credential_separation", "native_identity"];
const reservation = { id: "reservation-1", repository, task_issue: 368 };
const binding = { task_issue: 368, reservation: { id: reservation.id, digest: digest(reservation) },
  native_run_id: null, fence: 4 };

function runnerFixture(surface: "local" | "cloud", certified = false) {
  const status = certified ? "verified" : "unverified";
  const capability = { status, evidence: certified ? [profileRef("synthetic-capability")] : [] };
  const runtime = {
    runner: { ...envelope("RUNNER_CAPABILITIES_V1"), surface, product: "fixture",
      runtime_version: "runtime-v1", tool_version: "tool-v1", authentication_ref: profileRef("synthetic-auth"),
      operations: Object.fromEntries(operations.map((name) => [name, { ...capability }])) },
    transport: "fixture-transport", config_digest: digest("config"), permissions_digest: digest("permissions"),
    control_revision: head, resource_profile: profileRef("distinct-gf05-runtime-profile"),
    native: Object.fromEntries(extras.map((name) => [name, { ...capability }])),
  };
  const row: { reservation: typeof reservation; status: string; billed: number | null; liability: number;
    native_run_id: string | null; actual_profile_status: string } = {
    reservation, status: "ambiguous", billed: null, liability: 50, native_run_id: null, actual_profile_status: "unknown",
  };
  const task = { phase: "checkpoint-pending", fence: 4, native_run_id: "native-1", branch: workspace.branch,
    budget: binding.reservation, intent: { kind: "checkpoint", id: "intent-1", expected: head, desired: "c".repeat(40) } };
  const preparation = vi.fn();
  const effects = new Map<string, string>();
  const calls = vi.fn();
  const commitEffect = vi.fn((intent: { idempotency_key: string; operation: string }) => {
    const key = intent.idempotency_key;
    const intentDigest = digest(intent);
    const prior = effects.get(key);
    if (prior !== undefined && prior !== intentDigest) throw new Error("conflict");
    if (!prior) {
      effects.set(key, intentDigest);
      calls(intent);
      if (intent.operation === "stop") {
        row.status = "stop_requested";
        throw new Error("transport timed out after durable intent");
      }
    }
    return { intent_digest: intentDigest, status: prior ? "duplicate" : "recorded", evidence: profileRef("effect") };
  });
  const host = { verify, clock: () => now, inventory: () => runtime, resources: { lookup: () => row }, preparation,
    lifecycle: { inspect: () => task }, commitEffect };
  return { host, runtime, row, task, calls, adapter: createRunnerAdapter({ repository, surface, host }) };
}

describe("local and cloud runner adapters", () => {
  it.each(["local", "cloud"] as const)("keeps %s uncertified inventory separate from dispatch", (surface) => {
    const fixture = runnerFixture(surface);
    expect(fixture.adapter.probe()).toMatchObject({ mode: surface === "local" ? "manual-v3" : "read-only" });
    for (const operation of ["prepare", "launch", "resume"]) {
      expect(fixture.adapter[operation]({ task_issue: 368 }, profileRef("checkpoint")).status).toBe("unavailable");
    }
    expect(fixture.host.preparation).not.toHaveBeenCalled();
    expect(fixture.host.commitEffect).not.toHaveBeenCalled();
  });

  it("fails closed on the GF-01 and GF-05 profile reference conflict even with all synthetic controls", () => {
    const fixture = runnerFixture("local", true);
    expect(fixture.adapter.probe().mode).toBe("controls-observed");
    expect(fixture.adapter.launch({ task_issue: 368 })).toMatchObject({
      status: "unavailable", reason: "canonical-profile-reference-conflict",
    });
    expect(fixture.host.commitEffect).not.toHaveBeenCalled();
    const rejecting = createRunnerAdapter({ repository, surface: "local", host: {
      ...fixture.host, verify: (boundary: string) => boundary !== "adapter_capability",
    } });
    expect(() => rejecting.probe()).toThrow("UNAUTHENTICATED");
    fixture.runtime.runner.operations.separate_credentials!.status = "unverified";
    expect(fixture.adapter.launch({ task_issue: 368 }).reason).toBe("native-profile-uncertified");
  });

  it("quarantines a lost stop acknowledgement and preserves late usage and fence checks", () => {
    const fixture = runnerFixture("local");
    expect(fixture.adapter.observe(binding)).toMatchObject({ status: "ambiguous", liability: 50 });
    expect(fixture.adapter.stop(binding).status).toBe("reconcile");
    expect(fixture.adapter.observe(binding)).toMatchObject({ status: "stop_requested", liability: 50 });
    fixture.row.native_run_id = "native-1";
    fixture.row.liability = 65;
    expect(fixture.adapter.stop({ ...binding, native_run_id: "native-1" }).status).toBe("duplicate");
    expect(fixture.calls).toHaveBeenCalledTimes(1);
    expect(fixture.adapter.observe(binding)).toMatchObject({ native_run_id: "native-1", liability: 65 });
    expect(() => fixture.adapter.observe({ ...binding, native_run_id: "foreign-run" })).toThrow("RUN_BINDING");
    expect(() => fixture.adapter.checkpoint(binding)).toThrow("WORKER_ACTIVE");
    fixture.row.status = "terminal";
    fixture.row.billed = 70;
    expect(fixture.adapter.observe(binding)).toMatchObject({ status: "terminal", billed: 70 });
    expect(() => fixture.adapter.checkpoint({ ...binding, fence: 3 })).toThrow("CHECKPOINT_STALE");
    expect(fixture.adapter.checkpoint(binding).status).toBe("recorded");
    expect(fixture.adapter.checkpoint(binding).status).toBe("duplicate");
    expect(fixture.calls).toHaveBeenCalledTimes(2);
  });
});
