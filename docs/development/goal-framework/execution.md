# Supervised task lifecycle

GF-03 implements the shadow lifecycle for [#365](https://github.com/bensmullen/personal-finance-app/issues/365). The existing V3 hook, bootstrap and interrupted-task recovery remain the operator path. The controller records authenticated observations and conditional intents. It has no transport that launches a runner, updates an issue, pushes Git, requests CI or merges.

## Start with read-only checks

1. Use an existing approved goal and open V3 issue. Use the actual `PR_WORKTREE_READY` and `PR_TASK_RECEIPT` output from operator bootstrap, followed by the printed read-only preflight in that exact directory. Keep the worktree selected for the conversation. A ready Git worktree and a prepared receipt confer no writer ownership.
2. From a supervisor-controlled installation, read the saved issue and live remote branch with protocol, size and timeout limits. Bind their evidence to the canonical repository, issue and exact branch. Give `pinnedV3Parser` the approved merged hook bytes, commit and interpreter. It runs the hook's actual `validate_task` in isolation and requires agreement with the stricter GF-01 parser. Pin the supervisor modules and the hook source independently from the worker checkout before loading either. An implementation branch's changed hook cannot supply the parser authority.
3. Call `reviewPreparation` with the approved goal, independent route inventory, complete census and evidence of satisfied dependencies. Call `inspectWorkspace` and `reviewWorkspace` to check the corresponding worktree and compare it to the live remote evidence. The Git reader requires an attested read-only environment and uses separate Git time and output limits. Supply ignored generated changes from the trusted mutation monitor through `additionalPaths`. Filesystem and Git observations require an independent authenticated host, including stable directory ownership while checking paths.
4. Record the operator's disposition in the original issue or review evidence. Continue the approved manual V3 turn using its issue pointer after a successful read-only comparison. For dirty, unpushed, divergent, conflicted, foreign or ambiguous state, keep the work and receipts intact and perform operator read-only diagnosis. An elapsed lease, absent notification, cached tracking ref or network error provides no stopped-writer evidence.

Shadow comparison is read-only and confers no lifecycle writer authority. Continue using the existing manual V3 workflow while live human and host authentication or native integration remain unverified. Supervised activation needs an independently accepted control increment and a bounded resource reservation from the merged GF-05 ledger. An external trust implementation must supply each named attestation and authenticate its full binding. A shared GitHub login, worker role string, copied receipt or file checksum cannot satisfy a human approval or reviewer boundary. Keep a single durable supervisor journal and GF-05 ledger across participating environments, outside worker-writable locations. Trust and credential separation must exist before use. Synthetic start acknowledgements and verifier callbacks belong only in offline fixtures.

When the supervised gate is approved, the operator orders the lifecycle as follows.

1. Reserve budget in GF-05 and bind the eligible `reserved` record during `prepare` or `resume`. A prepared receipt holds neither writer ownership nor an outcome slot.
2. The authorized GF-05 integration persists `begin` before launch. Treat the run as ambiguous until GF-05 records an authenticated `started` acknowledgement with the matching actual profile. Reconcile uncertain starts under the existing resource controls.
3. At first mutation, `claim` must use that same reservation and native run ID. The host must authenticate the current admission and bind the run to the exact workspace, session and writer fence via `lifecycle_active_run_binding`. `assertWriter` rechecks these conditions at every scoped mutation boundary. Integration must serialize the check and real mutation with stop, revocation and ownership changes. A reserved, ambiguous, mismatched, expired, revoked, stopping or terminal run confers no write authority.
4. Keep the writer fence and resource reference when mutation authority ends. Reconcile the exact checkpoint or positively prove the owner stopped without publication. GF-05 handles authenticated terminal and billing evidence separately from lifecycle checkpoint reconciliation. A checkpoint or stop replay cannot release GF-05 liability.

## Journal and operator effects

`openLifecycle` uses an explicitly initialized private journal. `submit` takes an authenticated event and its bounded data. The event binds repository, goal and task issue, current goal revision, expected task revision, exact base head, observation time and a payload evidence reference. The payload reference digest is SHA-256 of the canonical JSON input. Persist external evidence in immutable storage outside the worktree. Issue bodies and observations appear in the operation input and the journal retains their identity and evidence references.

| Operation | Checks and effect |
| --- | --- |
| `prepare` / `resume` | Verify current authority, exact issue bytes, scope, readiness and the reservation in the GF-05 ledger. A resume uses a clean, remote-synchronized checkpoint and fresh-turn proof. Explicit prepared supersession requires evidence that the old receipt cannot claim. |
| `claim` | Compare the freshly observed prepared V3 receipt, authorization, exact paths and head. Recheck capacity and the authenticated GF-05 start under the journal lock. Serialize across canonical remote branch and shared logical resource, even for different worktrees or environments. Integration must use the same supervisor fence at the real publication boundary. |
| `begin-checkpoint` | Bind the observed clean candidate and its exact owning receipt before returning an operator permit. The existing human-controlled V3 workflow handles checkpoint publication. Keep the fence and reservation reference through lost or failed acknowledgements. |
| `observe-intent` / `reconcile` | Acquire a bounded read permit and reconcile provider evidence by intent identity. A checkpoint result needs the exact remote branch head, matching local upstream, a clean scoped worktree and acknowledged stopped owner. The GF-01 context checkpoint preserves current decisions, blockers and unresolved criteria. Late authenticated results can settle uncertainty after a pause. An unpublished stop needs positive evidence that both the writer and any outstanding effect are over. |
| `begin-correction` / `retry-correction` | Between safely closed turns, propose a Level-1 change to `ALLOWED_PATHS` and `ACCEPTANCE` in the same issue. Preserve unrelated bytes and archive the prior body by reference. Require independent review of unchanged material meaning and an effective exact-body compare-and-set boundary. Re-fetch and run the pinned parser on the saved result. Retry once only after proving the original request is terminal and that the expected body is still current. |
| `record-blocker` | Bind the first blocker and canonical root. Review the complete reachable contract and siblings before repair. Two repairs at the same root permit one separately budgeted read-only reassessment. A new label, chat or branch cannot reset the cumulative resource lineage. |
| `review-disposition` | Record independent review against an exact published head. Verification, merge and milestone acceptance use their separate evidence gates. |

An exact event replay returns its prior revision without returning a second permit. A reused identifier with different bytes, stale control revision or wrong head fails. Status observations produce no grants or control revision changes. A metadata cutover can freeze admissions using `lifecycle_admissions_open`. Reconciliation remains available for previously admitted work. If the issue adapter cannot provide effective compare-and-set protection against conflicting editors, keep the change proposal in shadow mode and use the existing human issue correction procedure. A GET followed by a blind PATCH does not provide the required boundary.

The journal allows two outcome slots globally and honors any tighter approved per-goal review limit. A claimed or checkpoint-pending writer occupies one slot, as does a published outcome awaiting review. Publication uses the slot already held by the writer, even when all slots are occupied. Independent review or an acknowledged unpublished stop releases the slot. The journal has finite task, event and byte capacity. It retains tombstones for its entire lifetime and rejects events older than 24 hours. Each intent permits four reads over 15 minutes, with a minimum 30-second interval and provider backoff capped at two minutes. Permission failure, outage and conflict pause the intent. A retry or status notice consumes no model call in this controller. The host must enforce request timeouts and response and page limits on its external reads and send any pause notice once.

The journal syncs a private temporary file before atomic replacement, then syncs the directory before issuing any permit. Disk-full before replacement preserves the last committed revision. Lost acknowledgement after replacement requires read-only reconciliation. A process crash may leave the transaction lock. Preserve the lock, committed snapshot and any pending file for diagnosis. A trusted operator must establish the prior lock owner's termination and reconcile any effect before restoring write access. No worker should remove a task receipt, reset, stash, clean, force-push or start a fallback writer. GF-05 retains and settles the associated liability using authenticated terminal and billing evidence.

## External supervised Git preparation

The offline #368 controller is installed outside the worker worktree.
Continue ordinary operator-owned bootstrap and V3 until the external trust
and host gates are independently accepted. The controller needs private,
authenticated provider observations, a PM signature verifier and revocation
source, a shared global gate, and an isolated effect port. The repository
contains no production installation for those services.

1. Re-fetch the live authorization, independently approved scope and current
   host/remote state. Use the actual merged parser for saved V3 and bind the
   census baseline to expected main for new, or the exact published head for
   resume. Resolve source and target in the trusted host.
2. Hold the global writer/capacity fence and persist one intent under a
   separate OS-backed journal lock in a private host directory. The intent
   consumes the exact request. A signed snapshot stores at most 100
   reference-only records, including tombstones. A synced staging file,
   atomic replacement and directory sync precede advancement of the
   independently authenticated generation and digest. Dispatch and readiness
   require a matching current-state witness. Preserve staging or unconfirmed
   visible state after failure for operator diagnosis.
3. Re-fetch authority before effect. Pass reviewed helper bytes on stdin
   to pinned absolute Bash with fixed mode, branch and explicit absolute
   target arguments. Use `PFM_SUPERVISOR_BOOTSTRAP=1`,
   `PFM_RECOVERY_MAIN_SHA`, `PFM_SUPERVISOR_EXPECTED_HEAD` (empty for new),
   `PFM_SUPERVISOR_GIT`, `PFM_SUPERVISOR_PYTHON` and
   `PFM_SUPERVISOR_LOCAL_HEAD` (absent or the exact observed local SHA), plus
   `PFM_SUPERVISOR_RECEIPT` (absent or exact closed receipt SHA-256). These
   are conditions supplied by the trusted host, not credentials. The port
   attests isolation and repo configuration, uses bounded output and a
   monotonic deadline, and proves terminal cleanup for the process group.
   The strict helper rejects stale refs, existing new targets, ambiguous
   ownership and unsafe resume. After fetch it rechecks the registered
   owner, configuration, operation state, clean index and receipt before
   advancing the branch. Ordinary manual and recovery mode keep
   their existing invocation.
4. Independently re-fetch the issue and remote refs, match the three
   bootstrap stdout fields, and inspect the exact linked worktree, scoped
   paths, head/upstream, index and actual receipt. Treat printed shell text
   as data. Git readiness can have an absent receipt or a hash-bound closed
   receipt. Every resume also requires independent evidence of the previous
   stopped owner and exact published checkpoint, including at a fresh target
   with no local receipt. Revalidate again before creating the manual handoff.
   A timeout, missing response or
   partial effect holds the intent until bounded read-only reconciliation
   proves nonstart or terminal cleanup. The journal allows up to four
   reconciliation reads per intent, each capped at two seconds and within the
   cleanup deadline. After that, resolution needs externally
   recorded evidence authenticated by the same capacity-release verifier.
   Never dispatch the same bootstrap
   again or switch to another executor because the response was lost.
5. If authenticated inventory shows project or hook trust review pending,
   return a manual approval-required disposition and preserve the prepared
   worktree. Continue in that worktree after operator review where required.
   The independently verified nonwriting handshake must still authenticate
   SessionStart and the actual UserPromptSubmit receipt before runner admission.
   The offline fixture uses the real hook and parser on disposable Git
   repositories. It exercises GF-03 and GF-05 with synthetic native
   acknowledgements and an external test barrier. Manual V3 remains
   available through the exact worktree and issue pointer.

## Post-merge local capability observation

Use Python 3.8 or later on macOS or Linux. Work from a reviewed merged
checkout and independently verify the exact checkout and control commit.
Set `PFM_REVIEWED_CHECKOUT` to its verified absolute path and
`PFM_REVIEWED_CONTROL` to the independently reviewed full control SHA.
The following collection reads only the default Codex desktop bundle plist
and bundled executable. It launches no child process.

```bash
cd -- "${PFM_REVIEWED_CHECKOUT:?set the verified absolute checkout path}" &&
pfm_reviewed_head="$(git rev-parse --verify HEAD)" &&
python3 tools/codex/goal-framework/local-capability-probe.py \
  --head "$pfm_reviewed_head" --control-revision "${PFM_REVIEWED_CONTROL:?set the reviewed control SHA}"
```

For a nondefault installation add an operator-approved `--app-root` ending
in `Codex.app` or `--cli-path` ending in `codex`. Use their exact canonical
absolute paths on a local disk. The probe rejects symlinks, aliases,
nonregular files, shared-writable locations outside standard sticky temp
ancestors, and unsafe owners. It reads at most one 128 KiB plist, one 256 MiB
thin Mach-O or ELF executable and two 1 MiB JSON schemas. It applies a
7.5-second collection deadline and a ceiling of 2.5 seconds per observation.
Unsupported binary headers or layouts remain unobserved. Capture the
finite failure reason without broadening the path search.

Run the optional export only after independently confirming that the exact
local executable supports the documented offline
`app-server generate-json-schema --out` command. Review version-specific
help or release metadata and match the executable's full version and SHA-256
against the selected binary. Set `PFM_PINNED_CODEX`, `PFM_PINNED_VERSION`
and `PFM_PINNED_SHA256` to those reviewed values. Use a canonical local
temp parent such as `/private/tmp` on macOS, or set
`PFM_LOCAL_TMP` to another reviewed canonical local temp directory.
If version, digest, or static export support cannot be safely confirmed,
use the default static inventory and record the protocol as unverified.
The recognized shape is a self-contained Draft 7 Schemars union in
`ClientRequest.json` and `ServerNotification.json`. Other filenames,
combined bundles, unresolved references, and unknown dialects yield
unobserved coverage. The documented TypeScript export is outside this
diagnostic's input. [App-server documentation](https://learn.chatgpt.com/docs/app-server)

```bash
cd -- "${PFM_REVIEWED_CHECKOUT:?set the verified absolute checkout path}" &&
pfm_reviewed_head="$(git rev-parse --verify HEAD)" &&
(
  set -eu
  umask 077
  pfm_schema_dir="$(mktemp -d "${PFM_LOCAL_TMP:-/private/tmp}/pfm-codex-schema.XXXXXXXX")"
  trap 'rm -rf -- "$pfm_schema_dir"' EXIT
  python3 - "${PFM_PINNED_CODEX:?set the reviewed absolute executable}" \
    "${PFM_PINNED_SHA256:?set the reviewed SHA-256}" "$pfm_schema_dir" <<'PY'
import hashlib
import os
import re
import resource
import stat
import subprocess
import sys

tool, expected, target = sys.argv[1:]
try:
    if not (os.path.isabs(tool) and os.path.realpath(tool) == tool
            and os.path.basename(tool) == "codex" and re.fullmatch("[a-f0-9]{64}", expected)):
        raise ValueError()
    descriptor = os.open(tool, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as selected:
        info = os.fstat(selected.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > 256 * 1024 * 1024:
            raise ValueError()
        checksum = hashlib.sha256()
        remaining = info.st_size
        while remaining:
            chunk = selected.read(min(remaining, 65536))
            if not chunk:
                raise ValueError()
            checksum.update(chunk)
            remaining -= len(chunk)
        if checksum.hexdigest() != expected:
            raise ValueError()
    resource.setrlimit(resource.RLIMIT_FSIZE, (2 * 1024 * 1024, 2 * 1024 * 1024))
    subprocess.run([tool, "app-server", "generate-json-schema", "--out", target],
                   check=True, timeout=10, cwd=target, env={}, stdin=subprocess.DEVNULL,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
except (OSError, ValueError, subprocess.SubprocessError):
    sys.exit("static-export-unverified")
PY
  python3 tools/codex/goal-framework/local-capability-probe.py \
    --head "$pfm_reviewed_head" --control-revision "${PFM_REVIEWED_CONTROL:?set the reviewed control SHA}" \
    --cli-path "$PFM_PINNED_CODEX" --cli-version "${PFM_PINNED_VERSION:?set the reviewed CLI version}" \
    --cli-sha256 "$PFM_PINNED_SHA256" --schema-root "$pfm_schema_dir"
)
```

Keep the output private and share only the sanitized inventory or its
reference. Run the export in a fresh private directory on a reviewed host
with adequate bounded scratch space and no concurrent installer or update
touching the selected path. The reviewed command is an offline schema
export. Do not start app-server, a thread, a turn or a listener. Do not log
in, access auth tokens, download schemas or fall back to a paid operation.

Use one compact reviewer entry per actual observation.

| Report field | Record |
| --- | --- |
| Checked scope | UTC time, reviewed head/control SHA, and sanitized report reference |
| Installed facts | Desktop version/build and metadata ref, CLI version source and binary ref, binary platform/architecture, or each finite unknown reason |
| Static protocol | Layout, compact file refs and observed features, or the bounded export/recognition refusal |
| Phone and trust | Whether the phone offers exact workspace/environment setup without submission, independently reviewed branch/path identity, and pending/observed/unknown project or hook trust |
| Admission and follow-up | Prepared receipt/session evidence, pre-write and pre-charge barrier, enforceable stop and late accounting, or explicit unknowns and manual V3 refusal disposition |

After that entry, select the smallest evidenced native control option or
keep preparation-only. Before a separately scoped PM-approved local canary,
prove external authority, exact new/resumed receipt and session binding,
safe refusal and replay, one writer, GF-03 prepared lifecycle, GF-05
admission and cleanup budget, and real host isolation. Verify stop,
terminal ownership and publication, artifact survival, and late usage and
settlement during actual certification. Cloud needs its own later canary.

## Evidence and rollout

Use the offline witnesses in `goalFrameworkLifecycle.test.ts` and the existing tooling self-test for GF-V03, GF-V04, GF-V05, GF-V07, GF-V14 and GF-V23. The tests exercise the pinned parser, a temporary linked worktree and fake remote, prospective review slots, and a temporary GF-05 ledger driven by synthetic supervisor and provider evidence. Live rollout requirements and safety controls are defined in [interfaces](interfaces.md), [requirements](requirements.md), [verification and metrics](verification-and-metrics.md) and [safety and rollout](safety-and-rollout.md).

The #365 implementation turn began on the exact clean linked `codex/goal-framework-03-lifecycle` branch at `d65ecf323b2b9237de78b4b5d4dcb0e9d3da612d`, with the merged GF-05 baseline. The existing hook accepted the saved #365 contract through its issue pointer. The implementation session did not receive the operator's bootstrap and preflight transcript. Record that evidence from the actual operator output when available. No supervisor pilot ran in this implementation turn.

After independent acceptance of the requisite controls, start with a shadow comparison on one already approved manual V3 task. Record bootstrap/preflight and recovery wall time when observed, branch/receipt dispositions, and the retained checkpoint SHA or explicit absence of a recovery event. Use the existing GF-05 baseline event inventory and classify the outcome after execution. Keep unavailable provider usage and PM time unknown. Record the actual proof in the reviewed increment on #365 before considering any broader use. Unattended execution remains outside this increment.
