import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const load = (name: string) => import(new URL(`../tools/codex/goal-framework/${name}.mjs`, import.meta.url).href);
const { canonicalJson, digest } = await load("contracts");
const { parseBootstrapOutput, createBootstrapHost } = await load("adapters/bootstrap-host");
const { createSupervisedPreparation, readPreparationRequest } = await load("adapters/supervised-preparation");
const { openPreparationJournal } = await load("adapters/preparation-journal");
const { sha256: digestRaw } = await load("authorization");
const { journalWitness } = await import(new URL("./fixtures/goalFramework/supervisor/disposable-git.mjs",
  import.meta.url).href);

const ref = (id: string) => ({ id, digest: digest(id) as string });
const head = "a".repeat(40);
const otherHead = "b".repeat(40);
const bodyDigest = digest("saved-body") as string;
const request = {
  schema: "PFM_PREPARATION_REQUEST_V1", id: "request-1", nonce: digest("nonce-1") as string,
  repository: "bensmullen/personal-finance-app", goal_issue: 362, goal_revision: 1, goal_control_digest: digest("goal"),
  task_issue: 368, task_revision: 1, lineage_id: "lineage", issue_body_digest: bodyDigest,
  branch: "codex/supervised", mode: "new", expected_main: head, expected_head: null as string | null,
  census: ref("independent-census"), resource: "register", worker: "worker",
  host_id: "dedicated-host", environment: "private-host", checkout: "/approved/source", target: "/approved/work tree",
  parser_revision: head, parser_digest: digest("merged-parser"), bootstrap_revision: head,
  bootstrap_digest: digest("merged-bootstrap"), host_allowance: ref("host-allowance"),
  cleanup_deadline: "2026-01-01T00:02:00Z", expires_at: "2026-01-01T00:01:00Z",
};
const envelope = (payload = request) => ({ request: payload, approval: {
  schema: "PFM_PREPARATION_APPROVAL_V1", proof: ref("pm-task-signature"), request_digest: digest(payload),
} });

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function journalFixture() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "pfm-preparation-")));
  roots.push(directory);
  let release = false;
  let acquired = false;
  let writeFault: string | null = null;
  const gate = ref("global-gate");
  const evidence = ref("terminal-cleanup-evidence");
  const lock = ref("supervisor-lock");
  const currentState = journalWitness(digest);
  const options = { directory, key: Buffer.alloc(32, 7), hostId: request.host_id,
    currentState, fault: (phase: string) => {
      if (phase === writeFault) throw Object.assign(new Error(phase), { code: "ENOSPC" });
    },
    withLock: <T>(_directory: string, action: (proof: typeof lock) => T) => {
      if (acquired) throw new Error("lock already held");
      acquired = true;
      try {
        return action(lock);
      } finally {
        acquired = false;
      }
    },
    verify: (boundary: string, value: unknown) => {
      if (boundary === "preparation_journal_current") return currentState.verify(value);
      if (boundary !== "preparation_capacity_release") return true;
      const observed = value as { evidence: typeof evidence; gate: typeof gate };
      return release && observed.evidence.digest === evidence.digest && observed.gate.digest === gate.digest;
    },
  };
  const journal = openPreparationJournal({ ...options, initialize: true });
  const binding = (index = 1) => readPreparationRequest(envelope({
    ...request, id: `request-${index}`, nonce: digest(`nonce-${index}`),
  })).binding;
  return { journal, reopen: () => openPreparationJournal(options), options, binding, gate, evidence, currentState,
    failWrite: (phase: string) => { writeFault = phase; },
    file: join(directory, "preparations.json"), staged: join(directory, "preparations.next"),
    allowRelease: () => { release = true; } };
}

describe("GF-06 supervised preparation protocol", () => {
  it("accepts canonical transport and rejects duplicate, unknown and malformed request fields", () => {
    const raw = canonicalJson(envelope());
    expect(readPreparationRequest(raw).binding.request_digest).toBe(digest(request));
    expect(() => readPreparationRequest(raw.replace('"request":{', '"request":{},"request":{'))).toThrow("PREPARATION_NONCANONICAL");
    expect(() => readPreparationRequest(JSON.stringify(envelope()))).toThrow("PREPARATION_NONCANONICAL");
    expect(() => readPreparationRequest({ ...envelope(), prompt: "foreign prompt" })).toThrow("PREPARATION_ENVELOPE");
    expect(() => readPreparationRequest(envelope({ ...request, nonce: "short" }))).toThrow("PREPARATION_REQUEST_IDENTITY");
    expect(() => readPreparationRequest(envelope({ ...request, branch: "codex/main..backup" }))).toThrow("PREPARATION_REQUEST_IDENTITY");
    expect(() => readPreparationRequest(envelope({ ...request, target: "/approved/../target" }))).toThrow("SUPERVISOR_PATH");
    expect(() => readPreparationRequest(envelope({ ...request, target: "/approved/source/inside" }))).toThrow("PREPARATION_REQUEST_BOUNDS");
    expect(() => readPreparationRequest(envelope({ ...request, target: "worktree" }))).toThrow("SUPERVISOR_PATH");
    expect(() => readPreparationRequest({ ...envelope(), request: { ...request, issue_body_digest: digest("edited") } }))
      .toThrow("PREPARATION_APPROVAL_BINDING");
    expect(() => readPreparationRequest(envelope({ ...request, mode: "resume" }))).toThrow("PREPARATION_REQUEST_IDENTITY");
    expect(() => readPreparationRequest(envelope({ ...request, expected_head: otherHead }))).toThrow("PREPARATION_REQUEST_IDENTITY");
  });

  it("checks all bootstrap output fields in sequence and never treats stdout as preflight", () => {
    const ready = `PR_WORKTREE_READY mode=new path=${request.target} branch=${request.branch} head=${head} origin_main=${head}`;
    const receipt = `PR_TASK_RECEIPT status=absent path=${request.target}`;
    const open = `OPEN THIS EXACT WORKTREE IN CODEX: ${request.target}`;
    const output = [ready, receipt, open, "bash -c ignored", ""].join("\n");
    expect(parseBootstrapOutput(Buffer.from(output), request, "absent")).toBe(digestRaw(output));
    for (const invalid of [ready + "\n", output.replace(head, otherHead), output.replace("mode=new", "mode=resume"),
      output.replace("status=absent", "status=closed"), output.replace(open, open + "-wrong"),
      output.replace(ready, ready + "\n" + ready), [receipt, ready, open, ""].join("\n"), output.trimEnd()]) {
      expect(() => parseBootstrapOutput(Buffer.from(invalid), request, "absent")).toThrow(/BOOTSTRAP_OUTPUT_/);
    }
    expect(() => parseBootstrapOutput(Buffer.alloc(16 * 1024 + 1), request, "absent")).toThrow("BOOTSTRAP_OUTPUT_BOUND");
    const disabled = createBootstrapHost({ verify: () => true, clock: () => request.expires_at });
    expect(() => disabled.inspect(request, [], "framework", "before", ref("gate"))).toThrow("BOOTSTRAP_HOST_UNAVAILABLE");
  });

  it("survives restart and blocks new work until authenticated resolution of a missing effect acknowledgement", () => {
    const { journal, reopen, binding, gate, evidence, allowRelease } = journalFixture();
    const first = binding();
    const original = journal.begin(first, gate);
    expect(original).toMatchObject({ created: true, intent: { status: "unresolved", evidence: null } });
    const restarted = reopen();
    expect(restarted.begin(first, gate)).toEqual({ created: false, intent: original.intent });
    expect(() => restarted.begin(binding(2), gate)).toThrow("PREPARATION_CAPACITY_UNAVAILABLE");
    expect(() => restarted.begin({ ...first, id: "foreign-id" }, gate)).toThrow("PREPARATION_REQUEST_CONFLICT");
    expect(() => restarted.begin({ ...first, nonce_digest: digest("wrong-nonce") }, gate)).toThrow("PREPARATION_REQUEST_CONFLICT");
    expect(() => restarted.observe({ ...first, approval_digest: digest("forged-approval") })).toThrow("PREPARATION_REQUEST_CONFLICT");
    expect(() => restarted.observe({ ...first, host_id: "foreign-host" })).toThrow("PREPARATION_JOURNAL_BINDING");
    for (let read = 0; read < 4; read++) expect(restarted.reserveRead(first, gate)).toBe(true);
    expect(reopen().reserveRead(first, gate)).toBe(false);
    expect(() => restarted.finish(first, "cleaned", evidence, gate)).toThrow("preparation_capacity_release");
    allowRelease();
    expect(restarted.finish(first, "cleaned", evidence, gate)).toMatchObject({ status: "cleaned", evidence });
    expect(reopen().begin(first, gate)).toMatchObject({ created: false, intent: { status: "cleaned" } });
    expect(reopen().begin(binding(2), gate).created).toBe(true);
  });

  it("retains committed intent and surviving staging bytes after a partial write", () => {
    const { journal, reopen, binding, gate, evidence, file, staged, allowRelease } = journalFixture();
    const first = binding();
    const before = journal.begin(first, gate);
    writeFileSync(staged, '{"state":', { mode: 0o600 });
    expect(reopen().observe(first)).toEqual(before.intent);
    allowRelease();
    expect(() => reopen().finish(first, "nonstart", evidence, gate)).toThrow("PREPARATION_JOURNAL_RECOVERY");
    expect(() => reopen().begin(binding(2), gate)).toThrow("PREPARATION_JOURNAL_RECOVERY");
    expect(readFileSync(staged, "utf8")).toBe('{"state":');
    writeFileSync(file, readFileSync(file, "utf8").replace('"status":"unresolved"', '"status":"cleaned"'));
    expect(() => reopen()).toThrow("PREPARATION_JOURNAL_STATE");
  });

  it("refuses an older authenticated snapshot and a visible rename without confirmed durability", () => {
    const rollback = journalFixture();
    const old = readFileSync(rollback.file);
    rollback.journal.begin(rollback.binding(), rollback.gate);
    writeFileSync(rollback.file, old);
    expect(() => rollback.reopen()).toThrow("PREPARATION_JOURNAL_COMMIT_UNKNOWN");
    const uncertain = journalFixture();
    const item = uncertain.binding();
    uncertain.journal.begin(item, uncertain.gate);
    uncertain.allowRelease();
    uncertain.currentState.fault("before");
    expect(() => uncertain.journal.finish(item, "git-ready", uncertain.evidence, uncertain.gate))
      .toThrow("fixture durability unconfirmed");
    expect(readFileSync(uncertain.file, "utf8")).toContain('"status":"git-ready"');
    expect(() => uncertain.reopen()).toThrow("PREPARATION_JOURNAL_COMMIT_UNKNOWN");
    expect(() => uncertain.journal.begin(uncertain.binding(2), uncertain.gate)).toThrow("PREPARATION_JOURNAL_COMMIT_UNKNOWN");
  });

  it("reopens a durable intent after a lost commit response without creating a second effect", () => {
    const { journal, reopen, currentState, binding, gate } = journalFixture();
    currentState.fault("after");
    expect(() => journal.begin(binding(), gate)).toThrow("fixture lost commit acknowledgement");
    expect(reopen().begin(binding(), gate)).toMatchObject({ created: false, intent: { status: "unresolved" } });
  });

  it("binds the gate reply to its completed callback and closes the callback on return", () => {
    const { journal, binding, gate } = journalFixture();
    const { intent } = journal.begin(binding(), gate);
    const bootstrap = { run: () => { throw new Error("unexpected bootstrap"); } };
    type Action = (proof: typeof gate) => unknown;
    const supervisor = (withGate: (action: Action) => unknown, verify = () => true) => createSupervisedPreparation({
      journal, bootstrap, host: { withGate: (_request: unknown, _operation: string, action: Action) => withGate(action), verify },
    });
    const expected = supervisor((action) => JSON.parse(canonicalJson(action(gate)))).prepare(envelope());
    expect(expected).toMatchObject({ status: "unresolved", effect_id: intent.effect_id });
    const forged = { ...expected, status: "git-ready" };
    let delayed: Action | undefined;
    expect(() => supervisor((action) => { delayed = action; return forged; }).prepare(envelope()))
      .toThrow("PREPARATION_GATE_UNAVAILABLE");
    expect(() => delayed!(gate)).toThrow("PREPARATION_GATE_REPLAY");
    expect(() => supervisor((action) => { action(gate); return forged; }).prepare(envelope()))
      .toThrow("PREPARATION_GATE_RESULT");
    expect(() => supervisor((action) => { action(gate); return undefined; }).prepare(envelope())).toThrow("JSON_TYPE");
    expect(() => supervisor((action) => Promise.resolve(action(gate))).prepare(envelope())).toThrow("PREPARATION_PORT_ASYNC");
    expect(() => supervisor((action) => { action(gate); return new Map(); }).prepare(envelope())).toThrow("JSON_OBJECT");
    expect(() => supervisor((action) => {
      const reply = action(gate);
      try { action(gate); } catch { /* simulate a wrapper swallowing the rejection */ }
      return reply;
    }).prepare(envelope())).toThrow("PREPARATION_GATE_REPLAY");
    expect(() => supervisor((action) => {
      try { action(gate); } catch { /* simulate a wrapper swallowing the rejection */ }
      return forged;
    }, () => false).prepare(envelope())).toThrow("preparation_global_gate");
    expect(journal.observe(binding())).toEqual(intent);
  });

  it("binds journal lock replies and recovers the durable result of an uncertain reply", () => {
    const { options, binding, gate, reopen } = journalFixture();
    type Action = (proof: ReturnType<typeof ref>) => unknown;
    const lock = ref("supervisor-lock");
    let reply = (action: Action) => action(lock);
    const journal = openPreparationJournal({ ...options, withLock: (_directory: string, action: Action) => reply(action) });
    let late: Action | undefined;
    reply = (action) => { late = action; return { created: true }; };
    expect(() => journal.begin(binding(), gate)).toThrow("PREPARATION_JOURNAL_LOCK_UNAVAILABLE");
    expect(() => late!(lock)).toThrow("PREPARATION_JOURNAL_LOCK_REPLAY");
    expect(reopen().observe(binding())).toBeNull();
    reply = (action) => {
      action(lock);
      return { created: true, intent: { status: "git-ready" } };
    };
    expect(() => journal.begin(binding(), gate)).toThrow("PREPARATION_JOURNAL_LOCK_RESULT");
    const actual = reopen().begin(binding(), gate);
    expect(actual).toMatchObject({ created: false, intent: { status: "unresolved" } });
    reply = (action) => JSON.parse(canonicalJson(action(lock)));
    expect(journal.observe(binding())).toEqual(actual.intent);
    reply = (action) => {
      const result = action(lock);
      try { action(lock); } catch { /* simulate a wrapper swallowing the rejection */ }
      return result;
    };
    expect(() => journal.observe(binding())).toThrow("PREPARATION_JOURNAL_LOCK_REPLAY");
    reply = (action) => {
      try { action(lock); } catch { /* simulate a wrapper swallowing the rejection */ }
      return true;
    };
    expect(() => journal.begin(binding(2), gate)).toThrow("PREPARATION_CAPACITY_UNAVAILABLE");
    reply = (action) => Promise.resolve(action(lock));
    expect(() => journal.observe(binding())).toThrow("PREPARATION_PORT_ASYNC");
    expect(reopen().observe(binding(2))).toBeNull();
  });

  it("requires a closed synchronous current-state witness and authenticated matching commit readback", () => {
    const { options, binding, gate, currentState, reopen } = journalFixture();
    const original = currentState.read();
    for (const invalid of [undefined, {}, { ...original, extra: true }, { ...original, generation: 0 },
      { ...original, digest: "invalid" }, Promise.resolve(original)]) {
      expect(() => openPreparationJournal({ ...options, currentState: { ...currentState, read: () => invalid } }))
        .toThrow(/JSON_TYPE|PREPARATION_JOURNAL_WITNESS|PREPARATION_PORT_ASYNC/);
    }
    for (const stale of [null, { ...original, generation: original.generation + 1 }, { ...original, digest: digest("stale") }]) {
      expect(() => openPreparationJournal({ ...options, currentState: { ...currentState, read: () => stale },
        verify: (boundary: string, value: unknown) => boundary === "preparation_journal_current" || options.verify(boundary, value),
      })).toThrow("PREPARATION_JOURNAL_COMMIT_UNKNOWN");
    }
    const commit = (...args: Parameters<typeof currentState.commit>) => {
      currentState.commit(...args);
      return Promise.resolve(undefined);
    };
    const asynchronous = openPreparationJournal({ ...options, currentState: { ...currentState, commit } });
    expect(() => asynchronous.begin(binding(), gate)).toThrow("PREPARATION_PORT_ASYNC");
    expect(reopen().begin(binding(), gate)).toMatchObject({ created: false, intent: { status: "unresolved" } });
    expect(() => reopen().begin(binding(2), gate)).toThrow("PREPARATION_CAPACITY_UNAVAILABLE");
  });

  it.each(["after-write", "after-file-sync", "after-rename", "after-directory-sync"])(
    "holds capacity across the %s journal failure",
    (phase) => {
      const { journal, reopen, binding, gate, evidence, failWrite, allowRelease } = journalFixture();
      const item = binding();
      const { intent } = journal.begin(item, gate);
      allowRelease();
      failWrite(phase);
      expect(() => journal.finish(item, "git-ready", evidence, gate)).toThrow(phase);
      if (phase === "after-write" || phase === "after-file-sync") {
        const restarted = reopen();
        expect(restarted.observe(item)).toEqual(intent);
        expect(() => restarted.begin(binding(2), gate)).toThrow("PREPARATION_JOURNAL_RECOVERY");
      } else {
        expect(() => reopen()).toThrow("PREPARATION_JOURNAL_COMMIT_UNKNOWN");
      }
    },
  );

  it("bounds reference-only journal growth at 1, 10 and 100 tombstones", () => {
    const { journal, binding, gate, evidence, file, allowRelease } = journalFixture();
    allowRelease();
    let firstRecordSize = 0;
    const headerSize = readFileSync(file).length;
    for (let index = 1; index <= 100; index++) {
      const item = binding(index);
      journal.begin(item, gate);
      journal.finish(item, "nonstart", evidence, gate);
      if (index === 1) firstRecordSize = readFileSync(file).length - headerSize;
      if (index === 10 || index === 100) {
        const bytes = readFileSync(file);
        expect(bytes.length - headerSize).toBeLessThanOrEqual(index * (firstRecordSize + 5));
        expect(bytes.toString()).not.toContain(request.target);
      }
    }
    expect(() => journal.begin(binding(101), gate)).toThrow("PREPARATION_CAPACITY_UNAVAILABLE");
    expect(journal.begin(binding(1), gate).created).toBe(false);
  });
});

