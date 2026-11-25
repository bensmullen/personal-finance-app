import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const { openResourceLedger } = await import(new URL("../tools/codex/goal-framework/resources.mjs", import.meta.url).href);
const { baselineReport, baselineStages, contextDisposition, handoffContext } = await import(
  new URL("../tools/codex/goal-framework/context.mjs", import.meta.url).href
);
const { digest, canonicalJson, validateRecord } = await import(new URL("../tools/codex/goal-framework/contracts.mjs", import.meta.url).href);
const cases = JSON.parse(readFileSync(new URL("./fixtures/goalFramework/resources/cases.json", import.meta.url), "utf8"));
const shippedRegistry = JSON.parse(readFileSync(new URL("../tools/codex/goal-framework/profiles.json", import.meta.url), "utf8"));

const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes)).toISOString();
const ref = (id: string) => ({ id, digest: digest(id) });
const reference = (record: { id: string }) => ({ id: record.id, digest: digest(record) });
const pool = { account_scope: cases.account_scope, pool_id: cases.pool_id, unit: cases.unit };
const actual = { model: "fixture-model", reasoning: "fixture-effort", surface: "local", runtime: "fixture-runtime" };
const profile = { ...actual, id: "fixture-profile", status: "verified", evidence: ref("runtime-probe"),
  max_risk: "cross-cutting", financial_review: true,
  operations: ["implementation", "review", "compaction", "subagent", "diagnostic", "coordination"] };
const registry = { ...shippedRegistry, profiles: [profile] };
const policy = {
  pools: [{ ...pool, ceiling: 100, pilot_ceiling: 20, initial_epoch: 1 }],
  snapshot_max_age_ms: 30 * 60_000,
  pilot_max_ms: 120 * 60_000,
  host: { cpu_millicores: 1000, memory_mib: 1024, processes: 4, disk_mib: 500, ci_minutes: 100, test_slots: 4 },
  goal_calls: { calls: 8, continuations: 3, repairs: 2 },
  task_calls: { calls: 6, continuations: 2, repairs: 2 },
};
const dirs: string[] = [];
const repository = "fixture/pfm";
const producer = { role: "supervisor", actor: "fixture-supervisor", session: "fixture-session" };
const verify = () => true; // All authorities and usage values in these tests are synthetic.

afterEach(() => {
  for (const directory of dirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function ledgerFixture(options: { fault?: (phase: string) => void; verify?: (boundary: string) => boolean;
  registry?: typeof registry; policy?: typeof policy } = {}) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "pfm-resources-")));
  dirs.push(directory);
  let now = at(1);
  const input = { directory, ledgerId: "fixture-ledger", policy, registry, verify, ...options, clock: () => now };
  return {
    directory, ledger: openResourceLedger({ ...input, fault: undefined, initialize: true }),
    reopen: (overrides: { registry?: typeof registry; policy?: typeof policy } = {}) => openResourceLedger({ ...input, ...overrides }),
    time: (minutes: number) => { now = at(minutes); },
  };
}

function envelope(schema: string, id: string) {
  return { schema, id, repository, revision: 1, created_at: at(1), producer, references: [] };
}

function reservation(id: string, goal = 1, estimated = 5, overrides: {
  epoch?: number; issue?: number; lineage?: string; expires?: number; continuations?: number;
  goalCeiling?: number; profile?: typeof profile; deadline?: number;
} = {}) {
  const limits = { ...pool, account_epoch: overrides.epoch ?? 1, account_ceiling: 100,
    goal_ceiling: overrides.goalCeiling ?? 100, task_ceiling: overrides.goalCeiling ?? 100,
    max_model_calls: 8, max_continuations: 4, execution_deadline: at(overrides.deadline ?? 100), cleanup_reserve: 2 };
  return {
    reservation: { ...envelope("BUDGET_RESERVATION_V1", id), goal_issue: goal, goal_revision: 1,
      goal_control_digest: digest("fixture-goal:" + goal), task_issue: overrides.issue ?? 31 + goal,
      task_revision: 1, lineage_id: overrides.lineage ?? "task-" + goal, risk: "cross-cutting",
      runtime_profile_ref: reference(overrides.profile ?? profile), limits, estimated_ceiling: estimated,
      carries: { account_liability: 0, goal_liability: 0, task_liability: 0, model_calls: 0, continuations: 0 },
      max_admitted_model_calls: 1, max_admitted_continuations: overrides.continuations ?? 0, expires_at: at(overrides.expires ?? 10),
      state: "reserved", native_run_id: null, terminal_ack: null },
    operation: "implementation", attempt: "initial", pilot: false, host: cases.host,
    fence: "writer-" + goal, goal_key: "goal-" + goal, parent: null,
  };
}

function quota(remaining: number | null, observed = 1, epoch = 1, reset = 20) {
  return { ...pool, remaining, account_epoch: epoch, observed_at: at(observed), reset_at: at(reset),
    source: "native-counter", quality: remaining === null ? "unknown" : "observed",
    coverage: remaining === null ? "unknown" : "complete", reason: remaining === null ? "provider-unavailable" : null,
    evidence: ref("quota-" + observed) };
}

function usage(run: ReturnType<typeof reservation>, value: number | null, observed = 1, unit: string = pool.unit) {
  const { id, goal_issue, goal_revision, goal_control_digest, task_issue, task_revision, lineage_id, limits } = run.reservation;
  return { usage: { ...envelope("USAGE_OBSERVATION_V1", "usage-" + [id, observed, unit, value].join("-")), goal_issue, goal_revision,
    goal_control_digest, task_issue, task_revision, lineage_id, ...pool, unit, account_epoch: limits.account_epoch,
    source: "meter", value, quality: value === null ? "unknown" : "observed", coverage: value === null ? "unknown" : "complete",
    observed_at: at(observed), reset_at: null, model: actual.model, reasoning: actual.reasoning, role: "coordinator", run_id: id },
    canonical_billing: value !== null && unit === pool.unit, reason: value === null ? "not-visible" : null };
}

const acknowledge = (reservation_id: string) => ({ reservation_id, actual, evidence: ref("start-" + reservation_id),
  native_run_id: "native-" + reservation_id });
const noStart = (reservation_id: string) => ({ reservation_id, native_run_id: null, outcome: "not_started", evidence: ref("no-start") });
const stopped = (reservation_id: string) => ({ reservation_id, native_run_id: "native-" + reservation_id,
  outcome: "stopped", evidence: ref("proved-stopped") });

describe("shared resource ledger", () => {
  it("serializes concurrent goals and combines Work and Codex in the same headroom calculation", () => {
    let contender: (() => void) | undefined;
    const f = ledgerFixture({ verify: (boundary) => {
      if (boundary === "foreground_capacity") contender?.();
      return true;
    } });
    const first = f.ledger;
    const second = f.reopen();
    const a = reservation("a", 1, 5);
    const b = reservation("b", 2, 7);
    first.snapshot("available", quota(20)); // floor(20 × 80%) = 16
    contender = () => expect(() => second.reserve("race", b)).toThrow("EEXIST");
    expect(first.reserve("reserve-a", a).disposition).toBe("committed");
    contender = undefined;
    expect(second.reserve("reserve-b", b).disposition).toBe("committed");
    expect(first.lookup("b").reservation.carries.account_liability).toBe(7);
    expect(() => second.reserve("reserve-c", reservation("c", 3, 1))).toThrow("BUDGET_EXHAUSTED");
    expect(first.reserve("reserve-a", a).disposition).toBe("duplicate");
    expect(() => first.reserve("reserve-a", b)).toThrow("RESOURCE_EVENT_CONFLICT");
    expect(second.summary().pools[0]).toMatchObject({ lifetime_liability: 16, active: 2 });
  });

  it("fails closed on stale quota, external activity, unit mixing, clock rollback and unproven reset", () => {
    const f = ledgerFixture();
    const { ledger } = f;
    ledger.snapshot("initial", quota(50));
    const run = reservation("a", 1, 5, { goalCeiling: 12, expires: 18 });
    ledger.reserve("r", run);
    f.time(2);
    ledger.snapshot("external", quota(8, 2));
    expect(() => ledger.begin("start", "a")).toThrow("BUDGET_EXHAUSTED");
    f.time(3);
    ledger.snapshot("higher", quota(100, 3));
    expect(ledger.summary().pools[0].provider_remaining).toBe(8);
    expect(() => ledger.observe("wrong-unit", { ...usage(run, 5, 3, "tokens"), canonical_billing: true })).toThrow("BILLING_OBSERVATION");
    ledger.observe("separate-unit", usage(run, 500, 3, "tokens"));
    expect(ledger.lookup("a").liability).toBe(7);
    expect(() => ledger.snapshot("old", quota(50, 2))).toThrow("STALE_QUOTA");
    expect(() => ledger.snapshot("early-reset", quota(50, 3, 2, 40))).toThrow("STALE_QUOTA");
    f.time(2);
    expect(() => ledger.begin("start", "a")).toThrow("CLOCK_ROLLBACK");
    f.time(21);
    expect(ledger.summary().pools[0].provider_remaining).toBeNull();
    expect(() => ledger.begin("start", "a")).toThrow("START_INELIGIBLE");
    ledger.snapshot("reset", quota(100, 21, 2, 40));
    const replacement = reservation("b", 1, 5, { goalCeiling: 12, epoch: 2, expires: 30, issue: 90 });
    expect(() => ledger.reserve("replaced", replacement)).toThrow("BUDGET_EXHAUSTED");
    ledger.terminal("no-start", noStart("a"));
    ledger.settle("settled", { ...noStart("a"), billed: 0 });
    expect(ledger.reserve("replaced", replacement).disposition).toBe("committed");
  });

  it("keeps a known zero after staleness and a low bound after degraded or unknown telemetry", () => {
    const exhausted = ledgerFixture();
    exhausted.ledger.snapshot("zero", quota(0, 1, 1, 70));
    exhausted.time(32);
    expect(exhausted.reopen().summary().pools[0].provider_remaining).toBeNull();
    expect(() => exhausted.reopen().reserve("pilot", {
      ...reservation("a", 1, 1, { expires: 40 }), pilot: true,
    })).toThrow("BUDGET_EXHAUSTED");

    const low = ledgerFixture();
    low.ledger.snapshot("low", quota(6));
    low.time(2);
    low.ledger.snapshot("partial", { ...quota(85, 2), coverage: "partial" });
    low.time(3);
    low.ledger.snapshot("missing", quota(null, 3));
    low.time(4);
    low.ledger.snapshot("estimated", { ...quota(90, 4), quality: "estimated" });
    expect(low.reopen().summary().pools[0].provider_remaining).toBeNull();
    expect(() => low.reopen().reserve("pilot-too-high", {
      ...reservation("b", 2, 3), pilot: true,
    })).toThrow("BUDGET_EXHAUSTED");
    expect(low.reopen().reserve("pilot-fits", { ...reservation("b", 2, 2), pilot: true }).disposition).toBe("committed");
  });

  it("authenticates account rollover and carries unsettled, then late, old-epoch bills", () => {
    let allowRollover = false;
    const f = ledgerFixture({ verify: (boundary) => boundary !== "account_pool_rollover" || allowRollover });
    const { ledger } = f;
    const old = reservation("old");
    ledger.snapshot("original", quota(30));
    ledger.reserve("reserve-old", old);
    ledger.begin("begin-old", "old");
    ledger.terminal("stop-old", stopped("old"));
    f.time(2);
    ledger.snapshot("exhausted", quota(0, 2));
    f.time(21);
    expect(() => ledger.snapshot("rollover", quota(15, 21, 2, 40))).toThrow("account_pool_rollover");
    allowRollover = true;
    expect(() => ledger.snapshot("unknown-rollover", quota(null, 21, 2, 40))).toThrow("QUOTA_ROLLOVER_COVERAGE");
    ledger.snapshot("rollover", quota(15, 21, 2, 40)); // 12 after headroom
    const next = reservation("next", 2, 4, { epoch: 2, expires: 30 });
    expect(() => f.reopen().reserve("reserve-next", next)).toThrow("BUDGET_EXHAUSTED");
    ledger.settle("final-old", { ...stopped("old"), billed: 1 });
    ledger.reserve("reserve-next", next);
    expect(ledger.lookup("next").reservation.carries.account_liability).toBe(1);
    f.time(22);
    ledger.observe("late-old", usage(old, 7, 22));
    expect(() => f.reopen().begin("begin-next", "next")).toThrow("BUDGET_EXHAUSTED");
    expect(ledger.lookup("old")).toMatchObject({ liability: 7, billed: 1, status: "terminal" });
  });

  it("quarantines lost starts and cancellation through late usage and idempotent settlement", () => {
    const f = ledgerFixture();
    const { ledger } = f;
    const run = reservation("a");
    ledger.snapshot("quota", quota(100));
    ledger.reserve("reserve", run);
    ledger.begin("intent", "a");
    expect(f.reopen().begin("intent", "a").disposition).toBe("duplicate");
    expect(() => ledger.begin("second-intent", "a")).toThrow("START_INELIGIBLE");
    ledger.requestStop("cancel", "a");
    ledger.started("late-ack", acknowledge("a"));
    expect(ledger.lookup("a")).toMatchObject({ status: "stop_requested", actual, liability: 7, billed: null });
    f.time(11);
    ledger.observe("continued", usage(run, 8, 11));
    const replacement = reservation("b", 1, 5, { expires: 18 });
    expect(() => ledger.reserve("fallback", replacement)).toThrow("WRITER_QUARANTINED");
    const settlement = { ...stopped("a"), billed: 8 };
    expect(() => ledger.settle("final", settlement)).toThrow("SETTLEMENT_BINDING");
    ledger.terminal("terminal", stopped("a"));
    expect(ledger.reserve("fallback", replacement).disposition).toBe("committed");
    expect(ledger.settle("final", settlement).disposition).toBe("committed");
    expect(ledger.settle("final", settlement).disposition).toBe("duplicate");
    ledger.settle("same-bill-different-event", settlement);
    f.time(12);
    ledger.observe("late", usage(run, 12, 12));
    ledger.observe("out-of-order", usage(run, 9, 11));
    expect(() => ledger.settle("regression", { ...settlement, billed: 10 })).toThrow("SETTLEMENT_BINDING");
    expect(ledger.lookup("a").liability).toBe(12);
    expect(ledger.summary().pools[0].lifetime_liability).toBe(19);
  });

  it("reconciles configuration after terminal proof without reopening the fence or settling the bill", () => {
    const f = ledgerFixture();
    const { ledger } = f;
    ledger.snapshot("quota", quota(100));
    ledger.reserve("reserve", reservation("a"));
    ledger.begin("intent", "a");
    ledger.terminal("finished", stopped("a"));
    expect(f.reopen().lookup("a")).toMatchObject({
      status: "terminal", actual: null, actual_profile_status: "unknown", liability: 7, billed: null,
    });
    ledger.reserve("same-fence", reservation("b"));
    expect(ledger.lookup("b").reservation.carries.goal_liability).toBe(7);
    expect(() => ledger.started("wrong-run", { ...acknowledge("a"), native_run_id: "other" })).toThrow("START_ACK");
    const late = { ...acknowledge("a"), actual: { ...actual, reasoning: "unexpected" } };
    const noInstalledProfile = f.reopen({ registry: shippedRegistry });
    expect(noInstalledProfile.started("late-ack", late).disposition).toBe("committed");
    expect(noInstalledProfile.started("late-ack", late).disposition).toBe("duplicate");
    expect(ledger.lookup("a")).toMatchObject({
      status: "terminal", actual: late.actual, actual_profile_status: "mismatch", liability: 7, billed: null,
    });
    ledger.settle("billing", { ...stopped("a"), billed: 4 });
    expect(ledger.lookup("a")).toMatchObject({ actual_profile_status: "mismatch", liability: 4, billed: 4 });
    ledger.begin("intent-b", "b");
    ledger.terminal("finished-b", { ...stopped("b"), actual });
    expect(ledger.lookup("b")).toMatchObject({ actual_profile_status: "matches", actual, billed: null });
    expect(() => ledger.started("conflicting-ack", { ...acknowledge("b"), actual: late.actual })).toThrow("ACTUAL_PROFILE");
    ledger.started("matching-ack", acknowledge("b"));
    expect(f.reopen().lookup("b")).toMatchObject({ status: "terminal", actual_profile_status: "matches", liability: 7 });
  });

  it("reserves nested agents and host resources independently and requires a stopped child", () => {
    let busy = false;
    const f = ledgerFixture({ verify: (boundary) => boundary !== "foreground_capacity" || !busy });
    const { ledger } = f;
    ledger.snapshot("quota", quota(100));
    const parent = reservation("parent");
    ledger.reserve("allocate-parent", parent);
    busy = true;
    expect(() => ledger.begin("intent-parent", "parent")).toThrow("foreground_capacity");
    busy = false;
    ledger.begin("intent-parent", "parent");
    ledger.started("start-parent", acknowledge("parent"));
    const nested = { ...reservation("child"), operation: "subagent", parent: "parent", fence: "nested-worker" };
    expect(() => ledger.reserve("missing-parent", { ...nested, parent: "unknown" })).toThrow("NESTED_RESERVATION");
    expect(() => ledger.reserve("oversize", { ...nested, host: { ...cases.host, processes: 4 } })).toThrow("HOST_EXHAUSTED");
    ledger.reserve("allocate-child", nested);
    expect(ledger.lookup("child").reservation.carries.model_calls).toBe(1);
    ledger.requestStop("stop-parent", "parent");
    expect(() => ledger.begin("launch-child", "child")).toThrow("NESTED_RESERVATION");
    expect(() => ledger.terminal("lost-parent", stopped("parent"))).toThrow("NESTED_RUN_ACTIVE");
    ledger.terminal("never-child", noStart("child"));
    ledger.terminal("lost-parent", stopped("parent"));
  });

  it("bounds pilots and rejects unsupported or insufficient review profiles", () => {
    const f = ledgerFixture();
    expect(() => f.ledger.reserve("unobserved", reservation("a"))).toThrow("QUOTA_UNKNOWN");
    const noAttestation = ledgerFixture({ verify: (boundary) => boundary !== "resource_mode" });
    expect(() => noAttestation.ledger.reserve("pilot-unapproved", { ...reservation("a"), pilot: true })).toThrow("resource_mode");
    const noProfiles = ledgerFixture({ registry: shippedRegistry });
    expect(() => noProfiles.ledger.reserve("unsupported", { ...reservation("a"), pilot: true })).toThrow("PROFILE_UNAVAILABLE");
    const weak = { ...profile, financial_review: false };
    const weakProfile = ledgerFixture({ registry: { ...registry, profiles: [weak] } });
    expect(() => weakProfile.ledger.reserve("weak-review", {
      ...reservation("a", 1, 5, { profile: weak }), operation: "review", pilot: true,
    })).toThrow("PROFILE_UNAVAILABLE");
    const run = { ...reservation("a", 1, 14), pilot: true };
    f.ledger.reserve("pilot", run);
    f.ledger.observe("missing-usage", usage(run, null));
    expect(() => f.ledger.reserve("expensive-pilot", { ...reservation("b", 2, 5), pilot: true })).toThrow("PILOT_EXHAUSTED");
    f.ledger.begin("intent", "a");
    f.ledger.started("mismatch", { ...acknowledge("a"), actual: { ...actual, reasoning: "unexpected" } });
    expect(f.ledger.lookup("a")).toMatchObject({ status: "stop_requested", actual: { reasoning: "unexpected" } });
  });

  it("keeps attempts on goal and task lineage across fresh issues and renamed errors", () => {
    const { ledger } = ledgerFixture();
    ledger.snapshot("quota", quota(100));
    for (let index = 0; index < 2; index++) {
      const id = "repair-" + index;
      ledger.reserve(id, { ...reservation(id, 1, 4, { issue: 40 + index }), attempt: "repair" });
      ledger.terminal("no-start-" + id, noStart(id));
      ledger.settle("zero-" + id, { ...noStart(id), billed: 0 });
    }
    expect(() => ledger.reserve("escaped", { ...reservation("fresh", 1, 4, { issue: 90 }), attempt: "repair" })).toThrow("REPAIR_EXHAUSTED");
    const diagnostic = { ...reservation("diag"), attempt: "reassessment", operation: "diagnostic" };
    ledger.reserve("diag", diagnostic);
    ledger.terminal("no-diagnostic", noStart("diag"));
    expect(() => ledger.reserve("second-diagnostic", { ...diagnostic, reservation: reservation("another").reservation }))
      .toThrow("REASSESSMENT_EXHAUSTED");
    for (const id of ["compaction-one", "compaction-two"]) {
      ledger.reserve(id, { ...reservation(id, 1, 1, { continuations: 1 }), operation: "compaction", attempt: "continuation" });
      ledger.terminal("no-start-" + id, noStart(id));
    }
    expect(() => ledger.reserve("third-session", {
      ...reservation("third-session", 1, 1, { issue: 95, continuations: 1 }), attempt: "continuation",
    })).toThrow("CALL_EXHAUSTED");
  });

  it("pins cumulative budgets across sessions and issues and carries spend into an authenticated revision", () => {
    const alternate = { ...profile, id: "different-profile", reasoning: "alternate-effort" };
    let allowRevision = false;
    const f = ledgerFixture({ registry: { ...registry, profiles: [profile, alternate] },
      verify: (boundary) => boundary !== "resource_budget_revision" || allowRevision });
    const original = reservation("a", 1, 3, { goalCeiling: 12, deadline: 20, continuations: 1 });
    const originalLimits = { ...original.reservation.limits, task_ceiling: 9, max_model_calls: 2, max_continuations: 1 };
    original.reservation.limits = originalLimits;
    f.ledger.snapshot("quota", quota(100));
    f.ledger.reserve("original", original);
    f.ledger.terminal("stopped", noStart("a"));
    const fresh = reservation("fresh", 1, 2, { issue: 95, profile: alternate });
    fresh.reservation.producer = { ...producer, session: "fresh-thread" };
    fresh.reservation.revision = 2; // Observation revision leaves operative control intact.
    for (const delta of [
      { goal_ceiling: 20 }, { task_ceiling: 12 }, { execution_deadline: at(100) },
      { max_model_calls: 8 }, { max_continuations: 4 },
    ]) {
      fresh.reservation.limits = { ...originalLimits, ...delta };
      expect(() => f.reopen().reserve("fresh", { ...fresh, budget_revision: ref("status-only") })).toThrow("BUDGET_REVISION_REQUIRED");
    }
    fresh.reservation.limits = originalLimits;
    expect(() => f.reopen().reserve("fresh", {
      ...fresh, reservation: { ...fresh.reservation, estimated_ceiling: 3 },
    })).toThrow("BUDGET_EXHAUSTED");
    expect(() => f.reopen().reserve("fresh", {
      ...fresh, reservation: { ...fresh.reservation, max_admitted_continuations: 1 },
    })).toThrow("CALL_EXHAUSTED");

    const revised = reservation("revised", 1, 4);
    revised.reservation.goal_revision = 2;
    revised.reservation.goal_control_digest = digest("revised-goal-control");
    revised.reservation.limits = { ...originalLimits, goal_ceiling: 20, task_ceiling: 16 };
    expect(() => f.reopen().reserve("revised", revised)).toThrow("BUDGET_REVISION_REQUIRED");
    const approved = { ...revised, budget_revision: ref("approved-revision") };
    expect(() => f.reopen().reserve("revised", approved)).toThrow("resource_budget_revision");
    allowRevision = true;
    expect(f.reopen().reserve("revised", approved).disposition).toBe("committed");
    expect(f.reopen().lookup("revised").reservation.carries)
      .toMatchObject({ goal_liability: 5, task_liability: 5, model_calls: 1, continuations: 1 });
    expect(() => f.reopen().reserve("old-budget", fresh)).toThrow("BUDGET_REVISION_REQUIRED");
    f.ledger.terminal("revised-no-start", noStart("revised"));
    expect(() => f.reopen().reserve("extra-call", {
      ...approved, reservation: { ...revised.reservation, id: "extra-call", estimated_ceiling: 1 },
    })).toThrow("CALL_EXHAUSTED");
  });

  it("binds the cumulative repair caps to the ledger policy", () => {
    const f = ledgerFixture({ policy: { ...policy, task_calls: { ...policy.task_calls, repairs: 1 } } });
    f.ledger.snapshot("quota", quota(100));
    f.ledger.reserve("first", { ...reservation("a"), attempt: "repair" });
    f.ledger.terminal("no-start", noStart("a"));
    expect(() => f.reopen().reserve("new-thread", { ...reservation("b", 1, 5, { issue: 90 }), attempt: "repair" }))
      .toThrow("REPAIR_EXHAUSTED");
    expect(() => f.reopen({ policy }).summary()).toThrow("LEDGER_IDENTITY");
  });

  it("rejects malformed and oversized input without leaving an unreadable journal or lock", () => {
    const f = ledgerFixture();
    const run = reservation("a");
    const huge = "é".repeat(70_000);
    expect(() => f.ledger.snapshot("quota", { ...quota(100), reason: huge })).toThrow("JSON_BOUND");
    expect(() => f.ledger.snapshot("quota", { ...quota(100), reason: 12 })).toThrow("QUOTA_SNAPSHOT");
    expect(() => f.ledger.snapshot("quota", { ...quota(100), payload: "unexpected" })).toThrow("QUOTA_SNAPSHOT");
    f.ledger.snapshot("quota", quota(100));
    f.ledger.reserve("reserve", run);
    expect(() => f.ledger.observe("usage", { ...usage(run, 2), reason: huge })).toThrow("JSON_BOUND");
    expect(() => f.ledger.observe("usage", { ...usage(run, 2), reason: "x".repeat(97) })).toThrow("USAGE_BINDING");
    expect(() => f.ledger.observe("usage", { ...usage(run, 2), payload: huge })).toThrow("JSON_BOUND");
    expect(() => f.ledger.observe("usage", { ...usage(run, 2), payload: "unexpected" })).toThrow("USAGE_BINDING");
    expect(f.reopen().summary().records).toBe(2);
    expect(f.reopen().observe("usage", usage(run, 2)).disposition).toBe("committed");
    expect(f.reopen().summary().records).toBe(3);
    expect(f.reopen().lookup("a").liability).toBe(7);
  });

  it.each(cases.storage_faults as string[])("preserves quarantine on persistence failure at %s", (phase) => {
    const f = ledgerFixture({ fault: (current) => {
      if (current === phase) throw Object.assign(new Error("disk-full"), { code: "ENOSPC" });
    } });
    f.ledger.snapshot("quota", quota(100));
    f.ledger.reserve("reserve", reservation("a"));
    expect(() => f.reopen().begin("intent", "a")).toThrow("disk-full");
    expect(() => f.ledger.begin("replacement", "a")).toThrow("EEXIST");
    const names = readdirSync(f.directory);
    expect(names).toContain(".lock");
    expect(names).toContain(phase === "after-rename" ? "000000000003.json" : ".pending");
    expect(names).toContain("000000000002.json");
  });

  it("rejects partial committed data and measures journal growth at 1/10/100 records", () => {
    const f = ledgerFixture();
    const sizes = new Map<number, number>();
    for (let index = 1; index <= 100; index++) {
      f.time(index);
      f.ledger.snapshot("snapshot-" + index, quota(100, index, 1, 200));
      if (cases.sizes.includes(index)) {
        const bytes = readdirSync(f.directory).reduce((sum, name) => sum + statSync(join(f.directory, name)).size, 0);
        sizes.set(index, bytes);
      }
    }
    const one = sizes.get(1);
    const ten = sizes.get(10);
    const hundred = sizes.get(100);
    if (one === undefined || ten === undefined || hundred === undefined) throw new Error("Missing journal growth sample");
    expect(hundred).toBeLessThan(11 * ten);
    expect(ten).toBeLessThan(11 * one);
    expect(f.ledger.summary().records).toBe(100);
    writeFileSync(join(f.directory, "000000000100.json"), "{");
    expect(() => f.reopen().summary()).toThrow();
    expect(() => f.ledger.snapshot("more", quota(80, 101, 1, 200))).toThrow("EEXIST");
  });
});

function checkpointFixture() {
  const branch = "codex/fixture-task";
  const head_sha = "1".repeat(40);
  const issue_body_digest = digest("saved-v3");
  const receipt = { ...envelope("WORKSPACE_RECEIPT_V1", "receipt"), task_issue: 15, branch, head_sha,
    issue_body_digest, directory: "/fixture/worktree", environment: "fixture", origin_repository: repository,
    upstream_head_sha: head_sha, state: "ready", receipt_owner: "writer", writer_fence: 1, ready_proof: ref("ready-proof") };
  const evidence = ref("canonical-evidence");
  const checkpoint = { ...envelope("CONTEXT_CHECKPOINT_V1", "checkpoint"), goal_issue: 1, goal_revision: 1,
    goal_control_digest: digest("goal-control"), task_issue: 15, task_revision: 1, lineage_id: "task-15", branch, head_sha,
    workspace_receipt_ref: reference(receipt), artifacts: [evidence], stopped_writer_ack: ref("stopped-writer"),
    settled_decisions: [{ id: "approval", domain: "financial", digest: digest("approval") }],
    unresolved_criteria: ["tax-check"], blockers: ["uat"], next_action: "request-uat" };
  const current = { ...checkpoint, issue_body_digest, open_gates: [ref("pm-decision"), ref("uat"), ref("acceptance")],
    required_artifacts: [evidence], observation_revision: 1 };
  return { receipt, checkpoint, current };
}

describe("checkpoint and observed context pressure", () => {
  it("bounds elapsed sessions when telemetry is absent and uses authenticated observed pressure", () => {
    const session = { opened_at: at(1), deadline: at(10), lineage_deadline: at(20),
      unit: "tokens", telemetry_max_age_ms: 60_000, checkpoint_percent: 75 };
    expect(contextDisposition({ session, telemetry: null, now: at(2), verify }))
      .toMatchObject({ disposition: "bounded_session", pressure: null });
    expect(contextDisposition({ session, telemetry: null, now: at(10), verify }))
      .toMatchObject({ disposition: "checkpoint_required", reason: "session-deadline" });
    const telemetry = { observed_at: at(2), quality: "observed", coverage: "complete", unit: "tokens", used: 75, capacity: 100 };
    expect(contextDisposition({ session, telemetry, now: at(2), verify }))
      .toMatchObject({ disposition: "checkpoint_required", reason: "context-pressure" });
    expect(contextDisposition({ session, telemetry, now: at(5), verify })).toMatchObject({ pressure: null });
  });

  it("re-fetches control, preserves UAT and blocks dirty, stale, unauthenticated or incomplete checkpoints", () => {
    const { receipt, checkpoint, current } = checkpointFixture();
    let fetched = 0;
    const args = { checkpoint, loadLive: () => { fetched++; return { receipt, current }; }, verify,
      compaction: { kind: "metered", reservation: ref("charged-compaction") } };
    const result = handoffContext(args);
    current.observation_revision++;
    expect(handoffContext(args)).toEqual(result);
    expect(fetched).toBe(2);
    expect(result).toMatchObject({ open_gates: current.open_gates, blockers: ["uat"], evidence: current.required_artifacts });
    expect(() => handoffContext({ ...args, loadLive: () => ({ current, receipt: { ...receipt, state: "dirty" } }) }))
      .toThrow("STALE_CHECKPOINT");
    expect(() => handoffContext({ ...args, loadLive: () => ({ current, receipt: undefined }) })).toThrow();
    expect(() => handoffContext({ ...args, loadLive: () => ({ receipt, current: { ...current, head_sha: "2".repeat(40) } }) }))
      .toThrow("STALE_CHECKPOINT");
    expect(() => handoffContext({ ...args, verify: (boundary: string) => boundary !== "stopped_checkpoint_writer" }))
      .toThrow("stopped_checkpoint_writer");
    expect(() => handoffContext({ ...args, checkpoint: { ...checkpoint, blockers: [] } })).toThrow("CHECKPOINT_DROPPED_blockers");
    expect(() => handoffContext({ ...args, checkpoint: { ...checkpoint, artifacts: [] } })).toThrow("CHECKPOINT_ARTIFACTS");
    expect(() => handoffContext({ ...args, compaction: { kind: "metered" } })).toThrow("RESOURCE_REFERENCE");
  });

  it("keeps immutable handoff history out of 1/10/100 checkpoint payloads", () => {
    const { receipt, checkpoint, current } = checkpointFixture();
    validateRecord(checkpoint, "CONTEXT_CHECKPOINT_V1");
    const artifact = "fixture-private-history".repeat(2_000);
    const evidence = { id: "large-history", digest: digest(artifact) };
    const handoff = (index: number) => handoffContext({
      checkpoint: { ...checkpoint, id: "checkpoint-" + index, artifacts: [evidence] },
      loadLive: () => ({ receipt, current: { ...current, required_artifacts: [evidence] } }),
      verify, compaction: { kind: "deterministic" },
    });
    const sizeFor = (size: number) => Array.from({ length: size }, (_, index) => {
      const payload = canonicalJson(handoff(index));
      expect(payload).not.toContain("fixture-private-history");
      return Buffer.byteLength(payload);
    }).reduce((sum, bytes) => sum + bytes, 0);
    const sizes = new Map((cases.sizes as number[]).map((size) => [size, sizeFor(size)] as const));
    const one = sizes.get(1);
    const ten = sizes.get(10);
    const hundred = sizes.get(100);
    if (one === undefined || ten === undefined || hundred === undefined) throw new Error("Missing handoff growth sample");
    expect(hundred).toBeLessThan(11 * ten);
    expect(ten).toBeLessThan(11 * one);
    expect(hundred + Buffer.byteLength(artifact)).toBeLessThan(100 * Buffer.byteLength(artifact));
  });
});

describe("manual V3 baseline", () => {
  it("separates clean simple, clean complex, rework and censored outcomes with explicit coverage", () => {
    const metrics = (baselineStages as string[]).map((stage) => ({ id: stage, stage, unit: "minutes", source: "existing-events", pool: null }));
    const record = (task: string, complexity: string, outcome: string, value: number | null, accepted = true) => ({
      task, complexity, outcome, classified_at: at(0), started_at: at(1), outcome_at: at(5),
      classification: ref("classification-" + task), disposition: ref("outcome-" + task),
      acceptance: accepted ? { capability: "capability-" + task, evidence: ref("accept-" + task) } : null,
      observations: metrics.map(({ id }) => ({ metric: id, value, quality: value === null ? "unknown" : "observed",
        coverage: value === null ? "unknown" : "complete", evidence: value === null ? null : ref("evidence-" + task),
        reason: value === null ? "provider-missing" : null })),
    });
    const records = [
      record("a", "simple", "clean-first-pass", 2), record("b", "simple", "clean-first-pass", 0),
      record("c", "cross-cutting", "clean-first-pass", null), record("d", "cross-cutting", "blocked-repaired", 50),
      record("e", "standard", "incomplete", null, false),
    ];
    const input = { records, metrics, dataset: cases.dataset, window: { start: at(0), end: at(10) }, verify };
    const result = baselineReport(input);
    expect(result).toMatchObject({ dataset: "synthetic", n: 5, accepted: 4 });
    const cohortFor = (complexity: string, outcome: string) => {
      const cohort = result.cohorts.find(
        (entry: { complexity: string; outcome: string }) => entry.complexity === complexity && entry.outcome === outcome,
      );
      if (cohort === undefined) throw new Error("Missing baseline cohort " + complexity + "/" + outcome);
      return cohort;
    };
    const scopeMetric = (complexity: string, outcome: string) => {
      const metric = cohortFor(complexity, outcome).metrics[0];
      if (metric === undefined || metric.metric !== "apiv-scope") throw new Error("Missing APIV/scope baseline metric");
      return metric;
    };
    expect(scopeMetric("simple", "clean-first-pass")).toMatchObject({ median: 1, range: [0, 2], denominator: 2 });
    expect(scopeMetric("cross-cutting", "clean-first-pass")).toMatchObject({ median: null, missing: 1 });
    expect(scopeMetric("cross-cutting", "blocked-repaired")).toMatchObject({ median: 50 });
    expect(cohortFor("standard", "incomplete")).toMatchObject({ n: 1, accepted: 0 });
    expect(baselineReport({ ...input, dataset: "manual-v3", records: [] })).toMatchObject({ n: 0, status: "not-measured" });
    expect(() => baselineReport({ ...input, records: [{ ...records[0], classified_at: at(2) }] })).toThrow("BASELINE_TASK");
    const [first, second] = records;
    if (first === undefined || second === undefined) throw new Error("Missing baseline acceptance fixtures");
    expect(() => baselineReport({ ...input, records: [first, { ...second, acceptance: first.acceptance }] }))
      .toThrow("BASELINE_ACCEPTANCE");
  });
});
