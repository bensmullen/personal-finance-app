# Handoff Authoring Policy

**Status:** required for Personal Finance App implementation/repair handoffs  
**Owner:** ChatGPT semantic/architecture planning layer  
**Purpose:** give Codex enough resolved product/architecture context to implement correctly without turning the prompt into a brittle machine protocol.

## 1. Separate authorization from semantics

A Codex handoff has two layers:

1. a compact machine-enforced `PFM_TASK_V3` authorization; and
2. a human/model-readable semantic implementation brief.

The hook validates only the authorization layer. The semantic brief is still
authoritative implementation guidance, but it is not rejected because a
particular heading, marker, evidence phrase, or profile field is missing.

This is deliberate. Hooks protect unsafe actions and edit scope; ChatGPT
planning plus CI/audit protect semantic completeness.

## 2. Required V3 authorization

Every mutation-capable handoff starts with:

```
PFM_TASK_V3
TASK_KIND: product|framework|repair
TARGET_BRANCH: codex/...|agent/...
DEPENDENCY_POLICY: locked|manifest_edit

ALLOWED_PATHS:
- <authorized path>
- <authorized subtree/**>

OBJECTIVE:
<concise outcome>

ACCEPTANCE:
<concise completion conditions>
```

Nothing else is machine-required.

### Preferred transport for long/cross-cutting tasks

When the semantic brief is long enough that Codex Desktop may transform pasted
content, ChatGPT SHALL create a repository GitHub Issue whose body starts with
the complete V3 authorization above and then contains the audited semantic
contract. The Codex composer receives only:

```
PFM_TASK_ISSUE: <issue-number>
```

The UserPromptSubmit hook fetches that open issue from
`bensmullen/personal-finance-app`, validates the V3 authorization, binds the
resolved contract to the task state, and injects the complete issue body into
Codex context. The issue pointer is the machine transport; the issue body is the
repository-owned handoff.

Do not use candidate/learning issues as task authorization. A task issue is a
purpose-built transport artifact and does not become normative product
documentation.

Simple short tasks may still use inline V3 authorization. Generated attachment
transport remains compatibility fallback, not the preferred path for a long
handoff.

Do not put a starting SHA or worktree policy in the task authorization. Git
initialization is owned by `tools/codex/bootstrap-pr.sh`, which resolves fresh
remote state before Codex starts.

Do not put read paths in the authorization. Codex may inspect implementation
resources needed to execute the resolved task; only writes are hard-scoped.

## 3. Authoring sequence

Before emitting an implementation/repair handoff, ChatGPT SHALL:

1. inspect the current repository and the narrow authoritative specification or
   roadmap material needed for the task;
2. consult `docs/development/agent-learning-policy.md` and the active lesson
   ledger before issuing implementation instructions;
3. consult the live issue-to-milestone register at `docs/development/milestone-issue-register.json` and its policy, reconcile current GitHub issue statuses, and verify that the task's owner stage/dependencies/mandatory closeout gate are allocated; do not silently skip an unresolved required issue or treat a planning backlog entry as V3 task authorization;
4. resolve material semantic/architectural decisions rather than delegating
   those decisions to Codex;
5. identify the smallest defensible `ALLOWED_PATHS`;
6. state the objective and acceptance conditions clearly enough that Codex can
   tell whether implementation is complete;
7. describe material failure/partial/unsupported/stale/cancelled/error behavior
   when relevant;
8. distinguish supported claims from deferred/not-measured/not-applicable areas;
9. keep expensive representative/stress/scaling/convergence/provider evidence
   outside ordinary CI unless the repository verification policy explicitly
   assigns a bounded correctness workload to CI;
10. perform a contradiction/negative-space review before handing off, including all
    material control-flow branches for cross-cutting or source-qualified financial
    work. Use a compact path-closure matrix (entry/branch, source/cutoff,
    original evaluator, actual posting, archive/replay, allowed file, test)
    before finalizing ALLOWED_PATHS. Never assume a call site covers an adjacent
    no-option/no-election branch; require actual posted proof for each accepted
    path. Apply this targeted check at the ORIGINAL handoff, not only after a
    blocker; do not require repo-wide call-graph scans for unrelated tasks.
11. preview how the proposed edits affect selected GitHub CI gates and
    existing test expectations, including type/build, accessible selectors,
    state transitions, fixtures, viewports, integration boundaries, and
    independently runnable acceptance journeys where relevant. Trace any new
    exact pixel/layout/test threshold to an approved requirement or defensible
    domain invariant; do not invent stricter numeric acceptance gates from
    qualitative product language. Identify potentially obsolete tests for
    reviewer classification rather than letting Codex silently delete them.
12. for any feature that generates many records/periods or moves, stores, or
    caches derived data, check whether sizable identical content is duplicated
    across records or layers *before* implementation. Identify ownership,
    canonical source and lifetime (run/version/tenant), serialized boundary,
    expected record count, and the smallest correct representation: one
    immutable source plus validated references or lossless aggregation. Keep
    occurrence identity and provenance, authoritative proofs, exact semantics,
    and fail-closed recovery; distinguish a true fixed-size digest from a
    serialized catalog. Require a bounded fixture demonstrating no proportional
    growth from repeated identical content, plus payload-size evidence when
    warranted. Avoid global dedup machinery and heavyweight CI jobs without
    evidence of need.

For a repair caused by CI, include the classified root cause and any
sibling or downstream tests vulnerable to the same issue, so that a patch
addresses the complete failure class rather than only the first failing
assertion. Do not use extra required task-envelope fields or a blanket E2E
execution requirement for this preview.

### First implementation blocker: reachable-contract closure audit (mandatory)

On the **first Codex BLOCKED/LOOKUP_REQUIRED for an implementation task**, ChatGPT
owns a proactive, **whole-task semantic closure audit before another Codex
authorization**. Do not merely authorize the named file and send Codex back.
This also applies to unblocked portions of that task, known sibling failures,
and the already approved product scope; no separate user request is needed.

1. **Classify and preserve** the reported blocker, original task/issue, latest
   Git branch/PR, receipts and clean/upstream status. Do not override a Codex
   stop, invent external original-source authority, reset a worktree, or restart
   while the old writer is active.
2. **Trace all acceptance paths end-to-end:** enumerate each relevant entry
   point, public contract/type, original-source evaluator, publisher/provider
   and revision/completeness boundary, adapters, state/write/archive validator,
   checkpoint/cold replay, downstream UI/output, and tests. For **each required
   observable behavior**, enumerate all executable alternatives selected by
   guards, optional inputs, empty inventories, fallbacks, early returns, and
   direct-versus-adapter posting. A passing path does not prove its sibling
   path works. Trace EVERY applicable path from entry/context through actual
   committed journal and replay; a source check in an unexecuted branch does
   not satisfy the requirement. Map each path to specific authorized write
   files and at least one positive/negative regression; inspect all sibling
   branches, not just the first reported failing line. Resolve any issue prose
   that prohibits modification of a path required by its own acceptance.
   Do not issue repeated one-caller-only permissions when the requirement
   spans several entrypoints.
   **Trace every required authorization datum upstream to its real producing caller**:
   household/person identity, run `asOf`, `dataCutoff`, event instant, original
   publisher and completeness, plus every type/interface by which it reaches the
   validator. Verify the *actual invocation supplies the values*; an interface
   or registered provider alone does not prove that run context is available.
   If a required caller is outside `ALLOWED_PATHS` or expressly forbidden by the
   issue, resolve that contradiction before restarting. Never substitute event
   time, a provider-selected cutoff, or a consumer-asserted flag for missing
   original run context.
   For every required step, map *path + symbol + invariant + write permission +
   available evidence*; separately mark independent out-of-scope capabilities.
   Where repository search is incomplete, explicitly state the coverage gap.
3. **Resolve decisions and access up front:** reconcile authoritative
   specifications, versions/migrations, legacy behavior, typed interfaces,
   source-of-truth identity, route permissions, currency/funding, time/ordering,
   idempotency, provenance, source races, and data-size growth. Confirm every
   required write target is legal in `ALLOWED_PATHS`; account for transitive
   tests/fixtures and concurrent branch ownership. Do not widen to unrelated
   modules merely because they contain similar checks.
4. **Repair the existing GitHub issue in one cohesive pass:** authorize every
   confirmed mandatory path, make additive version/migration choices and
   negative-space exclusions explicit, align tests/acceptance with original
   scope, and move superseded checkpoints to linked issue comments. If any
   mandatory decision or required path cannot safely be resolved, mark the
   handoff **not Codex-ready** and escalate the complete gap instead of
   dispatching a partial patch.
5. **Independently recheck before dispatch:** re-fetch the saved issue and
   relevant live PR/branch, run the exact V3 parser/readiness/contradiction
   checks, reread changed interfaces and one-pass producer→consumer→archive
   contract closure, and state the residual risks. Share a concise
   path-by-capability closure matrix and precise next action; only then ask
   the PM for a fresh Codex turn. New blockers trigger another delta audit
   plus reassessment of why the previous review missed them.

**Repeated no-progress STOP escalation:** If the same task has **two or more
immediate BLOCKED returns without code changes after a claimed full closure
review**, do not recommend another one-line scope amendment or Codex restart.
Instead identify the reviewer-planning failure explicitly, re-evaluate task
size and immutable shared interfaces, and replace contradictory line-level
constraints with a bounded whole-behavior contract plus executable-path
matrix. Reconcile missing proof serialization, conditional paths and original
sources. If unresolved, keep the task not start-ready or split a truly stable,
independent prerequisite; never send Codex an unresolved architectural choice.
This escalation is reviewer-only and requires no automatic full-repo scan,
new hook schema, local test loop or product-manager ceremony.

The goal is **preventable-blocker reduction and fewer wasted Codex turns**,
not an unsupported promise that static review guarantees no runtime, external
source, integration, or CI blocker. This is a ChatGPT-owned review gate; it
does not create extra Codex envelope fields, require Codex to run a broad
scan, weaken the hook, or authorize framework-control files in a product task.

### Evidence-complete UI CI repair handoff (mandatory)

For every CI-red UI/interaction PR, **ChatGPT owns the full audit before
authorizing another Codex patch**. Using the exact PR head and selected CI
workflow, it SHALL:

1. **Inventory all errors:** inspect every failed/cancelled/timed-out selected
   gate, every failing E2E case across all shards and retries, plus diagnostics
   and relevant evidence. Count *failed tests*, not just red shards. Compare the
   previous head to distinguish newly failing, recurring and resolved cases.
2. **Audit the entire affected journey for every failing case:** read its full
   setup, sequence and assertions **after the first failure**, including
   unreachable branches, recovery, source/financial checks and the relevant
   desktop/mobile, touch, keyboard, loading/stale/error variants. Inspect
   related tests and changed UI ownership to anticipate failures hidden by an
   early assertion. Distinguish passed evidence from **not executed**.
3. **Prove the cause before delegating:** classify each error as a production
   defect, invalid expectation, fixture/timing issue or CI environment failure.
   Trace it to the narrow owning code and artifact. Use logs/reports alone for
   obvious cases; escalate ambiguous behavior to screenshots, traces and DOM
   measurements *in the reviewer workflow*, not open-ended Codex diagnosis.
   Mark any unproven mechanism as unresolved, never as a confirmed cause.
4. **Prepare one complete, decision-closed patch:** cover **every currently
   known CI failure** plus identified downstream/sibling risks in the same
   coherent PR continuation. For each failure class, specify evidence, owning
   paths, **one resolved correction**, observable expected behavior,
   preserved assertions and negative cases. Record a compact failure matrix
   (test/gate → cause/evidence → masked checks → authorized fix → verification).
   Check required ALLOWED_PATHS, compatibility and financial meaning *before*
   instructing Codex. Do **not** dispatch a subset while other known errors
   remain outside the handoff; resolve missing authorization or product
   decisions first, or declare the handoff **not Codex-ready**.
5. **Verify completeness externally:** after Codex publishes, independently
   inspect the next exact-head full selected CI, every originally failed case,
   newly unmasked assertions and semantic/UX behavior before another handoff.
   No green-only patch or claim of guaranteed future CI success.

This is **reviewer-owned**, not a new Codex envelope field, local Playwright
permission, mandatory trace download, or additional CI job. Reuse available
diagnostic artifacts and cite compact evidence in the existing implementation
issue. If distinct independent work genuinely needs separate authorization,
resolve that ownership with the PM **before** a partial handoff; never silently
exclude a known failed gate. Codex still performs one scoped implementation
push and stops without CI monitoring (AL-003).

The brief should be as short as the task allows. Complexity belongs in the
semantic decisions themselves, not in mandatory envelope ceremony.

### Machine-contract preflight after every GitHub task-issue edit (mandatory)

**A semantic brief that reads correctly is not necessarily valid PFM_TASK_V3.**
Before asking the PM to start/resume/restart Codex, ChatGPT SHALL verify the
**saved, live issue body**, not the planned text or a prior issue snapshot, with
the exact task parser contract in `.codex/hooks/pfm-policy.py`:

1. Fetch the newly saved, **open GitHub Issue** and its current target PR. The
   body must start with `PFM_TASK_V3` and contain valid required scalar lines
   (`TASK_KIND`, `TARGET_BRANCH`, `DEPENDENCY_POLICY`). The only required
   machine-section headings are **exactly** `ALLOWED_PATHS:`, `OBJECTIVE:`,
   and `ACCEPTANCE:` on their own lines, each with nonempty content; the paths
   section must have at least one legal authorized write path. **Never append
   descriptive text to these heading lines** (for example,
   `ACCEPTANCE — UAT corrections:` is invalid). Put any subtitle on the
   *following line* or in a separate Markdown heading.
2. **Validate with the hook's actual `validate_task` semantics**, including
   its `section()` matching and restricted paths. When a local reviewer runtime
   is available, use the repository's parser directly. In a GitHub-connector
   review, inspect the current hook implementation and apply the same exact
   parsing to the freshly fetched body; **keyword presence or a subjective
   "contract looks complete" inspection is not sufficient**. Explicitly
   confirm the saved `ACCEPTANCE` and `OBJECTIVE` sections are nonempty and
   `ALLOWED_PATHS` is parsed as authorized write paths.
3. On *any* parser error, **repair the same GitHub Issue immediately**, re-fetch
   and revalidate until it passes. Do not claim Codex readiness, publish
   bootstrap/restart instructions, or shift this authoring problem to Codex.
   If validation cannot be performed, state that handoff validation is
   incomplete and do not authorize a new Codex turn.

This check applies to **every** task-issue creation or amendment, particularly
UAT/CI repair rewrites that replace an existing V3 envelope. It is a
**ChatGPT-owned pre-handoff gate**, not a new Codex task field, CI-wide E2E
requirement, task-hook retry, or PM manual validation step. The existing hook
continues to reject invalid contracts; the purpose of this gate is to catch
them *before* the PM spends another Codex turn on a preventable refusal.
The tooling regression fixture must cover a descriptive `ACCEPTANCE` heading
that would otherwise look valid to a human.

### Computer crash and active-receipt recovery

An abrupt laptop shutdown can leave a valid `ACTIVE:true` task receipt
bound to the old Codex session, plus a clean but unpublished WIP commit.
This is a **recoverable operator Git/session state**, not permission for
ChatGPT/Codex to overwrite task receipts, to assume the prior writer is dead,
or to tell Codex to restart on an empty feature branch.

When a new session receives `STATE_RECOVERY_REQUIRED: Active foreign writer`
after a reported computer crash, ChatGPT SHALL:

1. Verify the live original GitHub issue, task branch, PR, and published SHA.
   Distinguish an already-published exact checkpoint from a local-only one.
   A self-reported checkpoint cannot establish the local Git state; require an
   operator read-only branch, HEAD, cleanliness, upstream, origin, and
   SHA-bound receipt inspection before publication.
2. Resolve a **distinct recovery branch** using the existing open issue (never
   an unrelated new implementation issue), retaining the current V3 acceptance
   scope. Update its `TARGET_BRANCH` only after documenting the exact
   checkpoint prerequisite. Mark the new authorization **not ready** until the
   separate branch is published at the same verified checkpoint SHA. The old
   branch and receipt remain untouched historical evidence.
3. If the checkpoint is already on GitHub, ChatGPT may create its distinct
   recovery branch from the immutable SHA. Otherwise the operator must prove
   and non-force-publish the exact clean local commit first. Never force,
   delete/replace receipts, reset, clean, stash, rebase, or infer that a lost
   session permits rewriting active task ownership.
4. Use the audited operator-only
   `tools/codex/recover-interrupted-task.sh` when available, or its documented
   equivalent exact-SHA/non-force push then `bootstrap-pr.sh resume` sequence.
   Once the **recovery** branch's remote SHA, Git issue target and fresh
   worktree are all verified, start a new Codex chat with the **same** issue
   pointer. Codex must finish the original acceptance, including any
   previously incomplete tests, and produce a fresh implementation commit;
   a WIP checkpoint does not satisfy COMPLETE.
5. Independently test the failure modes of this workflow: source/worktree
   mismatch, dirty tree, unexpected checkpoint, conflicting remote, stale old
   receipt, wrong GUI folder and default branch tracking. Keep only bounded
   synthetic Git fixture checks in ordinary tooling CI.

This preserves single-writer protection across a genuine crash while avoiding
the common **no upstream → no PR → foreign receipt** dead-end. A normal
same-session interruption retains the existing guarded continuation path;
neither path silently relaxes scope, financial provenance or review gates.

### Live issue readiness gate before recommending Codex (mandatory)

Immediately **before** telling the product manager to bootstrap, resume, restart, or submit `PFM_TASK_ISSUE: N` to Codex, ChatGPT SHALL:

1. Re-fetch the **live GitHub issue** (body, state, target branch and `PFM_TASK_V3` envelope) and the associated live PR/branch after all planned issue mutations. Do not rely on earlier reads, old conversation summaries, or Codex's self-reported completion.
2. Confirm that the issue remains open, is a valid implementation task, contains an actionable **current** self-contained repair contract and `ALLOWED_PATHS`, and identifies a concrete Codex-owned next step. Verify dependencies/required product decisions are resolved, relevant evidence and scope are current, and there is no pending reviewer-/PM-owned CI, benchmark, external lookup, approval or worktree operation **declared as a prerequisite to starting Codex**.
3. Search the **entire issue body**, not just its newest checkpoint, for contradictory instructions such as `do not restart`, `blocked`, `wait for measurements`, `may proceed`, obsolete branch/bootstrap gates or mutually exclusive acceptance claims. Consolidate or explicitly supersede historical gates in the GitHub issue **before** recommending restart. Re-read the resulting saved body; do not assume the write succeeded. Historical evidence belongs in issue comments, not conflicting live instructions (AL-002).
4. Confirm Git branch and worktree prerequisites separately: no unmerged prerequisite branch or competing shared-file writer, verify `main` integration where necessary, and direct Git synchronization **outside** Codex's active task. Never infer that remote readiness proves the user's local checkout is clean.
5. Give a **positive Codex-ready verdict** only when all above pass, including a verified latest issue update and a specific `PFM_TASK_ISSUE: N` target. Otherwise **do not instruct the PM to resume Codex**: state the exact outstanding non-Codex action, perform any reviewer-owned action available, and keep the issue explicitly marked not start-ready until its preconditions are satisfied.

This is a ChatGPT planning/handoff requirement, not a new V3 parser marker or Codex hook, and does not authorize polling CI inside Codex. A future CI verification requirement may remain as a **post-push merge gate** when it is not a prerequisite for the next implementation turn. State clearly which applies.

## 4. Recommended semantic brief

For simple tasks, objective + acceptance + a few implementation constraints may
be sufficient.

For cross-cutting or financially sensitive tasks, include the useful concepts
from the previous V2 framework, but as prose rather than parser requirements:

- resolved decisions and authoritative ownership;
- requirement → implementation → evidence mapping;
- failure modes and state transitions;
- claims and known gaps;
- concurrency/cache/persistence/performance boundaries;
- expected data volume and duplicate-content risks at serialization,
  persistence, cache and worker/API/read-model boundaries when material;
- CI versus heavy-validation ownership;
- UAT when a human workflow must be validated;
- explicit out-of-scope items;
- exact stop/lookup conditions.

These sections are planning aids. Hooks do not require their names or syntax.

**Type-contract preflight:** Read signatures and strict TypeScript configuration before handing off typed fixtures, adapters, overloads or optional-field overrides. Check literal dispatch, exact optional properties, required fields, replay tiers and assertion provenance. Record likely risks. After #218 merges, Codex may optionally invoke only `node tools/codex/limited-local-verification.mjs` with at most one directly affected tracked `test/name.test.ts` in one simple tool call: full typecheck 60s, then named unit 30s, one correction retry after FAIL. Missing environment skips; no installs, flags, wrappers or shell chaining. The merged-helper and per-turn hook guards enforce this exception; all other local verification remains prohibited. PASS is not acceptance. Independent CI checks remain parallel; only expensive E2E waits for selected typecheck/build/feasibility success. See verification-policy.md for exact boundaries.

## 5. Edit-scope design

`ALLOWED_PATHS` remains the strongest task-specific guardrail.

Choose paths narrowly enough to prevent unrelated cleanup but broadly enough to
avoid needless framework repairs. Prefer a cohesive subtree when several files
within that subtree are expected to change.

Product/repair handoffs must not authorize framework-control paths. A task that
needs to modify agent policy, hooks, CI orchestration, or agent-learning policy
is a framework task.

Adding a required file outside the authorized scope is not permission for Codex
to broaden the task. Codex reports a blocker/lookup need; ChatGPT issues a new
authorization if the scope change is justified.

### Parallel Codex development preflight

When multiple tasks could run concurrently, ChatGPT SHALL first check that
their architectural decisions are resolved and their prerequisites are satisfied.
Prefer parallel issues/branches only when interfaces are stable, edit ownership
is clear, and independently testable scopes minimize conflict. Identify shared
files/contracts, integration ownership, and merge order explicitly. Do not split
a coherent task solely to create parallelism, and do not start dependent tasks
from an unmerged prerequisite. This is planning guidance, not a new V3 parser
field or a requirement for every one-file repair.

Independent CI checks should remain parallel under the verification planner.
Do not duplicate expensive checks in Codex turns or move heavy workloads into
ordinary CI to obtain parallelism.

One active session owns each linked worktree receipt. A foreign session cannot
activate even the same issue while that owner is active. Resume interruptions
in the same owning session; close normally before handing ownership to another
session. Invalid/missing receipts fail closed. Diagnose with the hook's exact
worktree/session output and read-only Git/receipt inspection; never rewrite or
delete another owner's receipt. For ambiguous ownership preserve all work and
use a fresh operator-bootstrap worktree plus authorized task only after proving
clean/synchronized Git state. This follows candidate #217; candidate #134's
preflight review and both candidates' independent ChatGPT curation remain
separate from #218's FRAMEWORK_RELIABILITY stage. No dependency on #218 is added
to U1B #181 or D2. Keep AL-002 authority compact, end after one push without CI
polling (AL-003), and retain independent E2E flows/all four shards (AL-004).

UserPromptSubmit, PreToolUse and Stop serialize through one per-worktree OS
`flock` on `policy.lock`. A collision retries every 50ms for at most 1.5 seconds
using monotonic time. Persistent contention returns event-specific
`POLICY_LOCK_BUSY` (PreToolUse denies; prompt/Stop block). Let the owning hook
finish, then retry that event in its owning conversation. Repeated contention
requires read-only inspection of the owning hook process; it does not establish
receipt corruption. Preserve the lock file and receipts. This #249 implementation
does not curate or close learning candidate #217 and adds no persistent owner,
lease, receipt marker or bypass.


## UX design-ready handoff for substantial user-facing changes

For major changes to navigation, multi-screen authoring, onboarding, complex financial forms, repair flows or forecast interpretation, consult `.agents/skills/pfm-ux-review/SKILL.md` before the Codex implementation handoff. The ChatGPT planning/review layer owns a concise task-first interaction contract and approved reference state (rendered screenshots/prototype where applicable). Product ownership, source-of-truth and financial limitations remain governed by PFA-UX-015–023 and financial specifications. The owner approves material design/experience tradeoffs; do not leave them for Codex to invent.

Visual evidence and interaction diagnosis are collected outside Codex implementation turns using the manual UX evidence workflow or another independent browser review. Codex's ban on local servers, Playwright and CI polling is unchanged. Codex receives the reference/evidence plus scoped acceptance criteria and can implement autonomously within the V3 contract. A small isolated copy, layout or accessibility repair with no altered journey/ownership does **not** need a new design prototype or a product-wide audit. Independent post-implementation visual/semantic review and uncoached human UAT remain separate from CI.

Parallel UX research and backend/D2 work are encouraged when owned paths and stable interfaces do not overlap; explicitly identify prerequisites, shared seam ownership and merge order. Stop repeated cross-journey patch cycles after two failed same-cause repair rounds and return to focused design review rather than widening an implementation issue.

### ChatGPT operator Bash directory anchoring (mandatory)

Every **user-facing Bash/shell command block** ChatGPT supplies for this project
MUST start with an explicit `cd` command to the known intended directory.
Treat each separate command block as independently runnable: never rely on the
terminal's prior working directory, a previous code block, or whichever of
several Codex worktrees happens to be open. Put `cd` before variables, Git
commands, shell subshells, preflight checks or any other executable step.

For a worktree operation, use its **verified absolute worktree path**, not an
inferred branch-name suffix. If that path has not been verified, first `cd` to
the established absolute canonical checkout, locate the *named* branch's
worktree with `git worktree list --porcelain`, reject missing or ambiguous
matches, then `cd` into the resolved absolute path. Before any Git
mutation, verify the current directory resolves to the chosen worktree root,
the exact expected branch and (when relevant) clean/staged state, parent SHA,
upstream and live remote SHA. For canonical bootstrap/recovery operations,
explicitly `cd` to the canonical checkout instead. Do not use
`cd "$(git rev-parse --show-toplevel)"` from an unspecified starting
directory as the only anchor; that merely selects whichever worktree the
terminal already happened to use.

This is a ChatGPT response/handoff requirement, not an additional Codex
task-hook gate. Never invent or silently assume a local path. If the exact
path cannot be established, give an anchored read-only discovery block before
a separate anchored mutation block.

## 6. Git handoff lifecycle

Git bootstrap is an **external operator action performed before the Codex
implementation turn**. A task issue must not instruct Codex to invoke the
bootstrap helper during the implementation turn.

Before the Codex task is submitted, prepare the branch/worktree from remote
state:

New PR:

```
bash tools/codex/bootstrap-pr.sh new codex/<branch> [worktree-path]
```

Existing PR:

```
bash tools/codex/bootstrap-pr.sh resume codex/<branch> [worktree-path]
```

ChatGPT-created PR branches use the same resume flow with `agent/<branch>`.

The bootstrap receipt is the Git-state authority for task initialization.
Because it fetches `origin` first, the handoff does not need an
`EXPECTED_HEAD` field and does not depend on local `main` being current.

Copy the path printed after **OPEN THIS EXACT WORKTREE IN CODEX**. Bootstrap
does not switch the folder selected in the Codex GUI. Open that specific folder;
similar old/recovery suffixes are different worktrees. `resume` can reuse an
existing branch owner at a different path from the requested destination: use
the reported path, not the requested one. Run the printed read-only preflight
in the selected folder's terminal. It checks the repository cwd, exact branch,
cleanliness, HEAD and upstream: `resume` requires `origin/TARGET_BRANCH` at
HEAD; `new` starts at fetched `origin/main` with no feature upstream until the
first push. A failed check requires operator diagnosis before task submission.

After that preflight, submit the handoff
whose `TARGET_BRANCH` matches the prepared branch. Once Codex is running in a
clean linked feature worktree on that branch, bootstrap is satisfied for that
turn. SessionStart and task instructions must say so rather than directing Codex
to rerun bootstrap from inside the prepared worktree.

## 7. Completion protocol

### Continuation and preservation

Usage-limit/manual interruptions may bypass Stop. Resubmitting the same task issue
in the same worktree/branch permits guarded recovery only with a persisted active
task receipt. Inline/attachment continuations require an identical contract hash.
The most recent receipt is bound to the worktree and task state; missing, stale,
closed, or ambiguous provenance does not authorize inherited dirty work.

All dirty and prior committed paths must satisfy both prior and incoming scope,
TASK_KIND control-path rules, and dependency policy. Detached/drifted branches,
unmerged/conflict-marker state, active Git operations, or unknown/divergent remote
state block recovery. The hook stages only verified dirty paths, creates a labeled
WIP checkpoint, pushes ordinarily to the authorized origin branch, and verifies
cleanliness and remote/tracking equality. Recovery sets BASE_HEAD after the
checkpoint so preservation cannot satisfy the next turn's implementation guard.

Normal BLOCKED/LOOKUP_REQUIRED stops use the same checkpoint safety checks for
eligible dirty work. Checkpoints never imply acceptance or verified/merge-ready
work. Failed staging, commits, or pushes preserve data and give an actionable
STATE_RECOVERY_REQUIRED reason. No automatic stash, reset, clean, branch switch,
force push, amend, rebase, or history rewrite is permitted.

**PM answer / scope-expansion continuation after BLOCKED (mandatory):**
A successful terminal BLOCKED Stop sets the old grant inactive, even if its
checkpoint was pushed and the chat remains open. This is **not** the interrupted
active-receipt path above. After ChatGPT updates and re-reads the original live
implementation issue, verify its current exact ALLOWED_PATHS, the open PR head,
one-writer ownership and the local worktree's clean/live-remote-synchronized
branch. Then the operator opens a **new Codex conversation bound to that same
worktree**, submitting only `PFM_TASK_ISSUE: N`. The fresh
`UserPromptSubmit` must fetch the new issue body, produce a new authorization
ID/receipt and visibly confirm the current path set. Do **not** ask Codex to
continue in the closed chat, repeatedly prompt it with the task pointer after
it reports stale authorization, delete receipts, bypass hooks, or run an
implementation bootstrap to repair provenance. If the new chat still cannot
activate, stop for read-only exact hook/session/branch/receipt diagnosis.
The new conversation must have a **new session ID**, not just a new turn in
the old chat. Submitting valid revised authorization from the closed session
is refused with "start a NEW Codex conversation in the verified worktree"
before checkpointing, saving state or changing the hash-bound receipt. The
same-session continuation path applies only to a still-active interrupted
task with valid task/scope provenance. Before opening the new chat, copy the
bootstrap-reported exact folder and run its cwd/branch/upstream/clean preflight;
never repair a closed-session refusal by editing receipts or reusing the old GUI
folder merely because its name resembles the recovery folder.
This keeps fail-closed scope/ownership enforcement; there is no implicit
interactive task-grant widening or hidden PM approval within a Codex turn.

**Preflight / hook fault handling (mandatory):** Treat optional preflight as
non-essential to implementation authorization. A failed or unavailable
preflight never authorizes a bypass of path/single-writer safeguards, but it
must not prompt the agent to undo valid in-progress work. If permitted
implementation can proceed, continue with the preflight reported as unavailable
and leave acceptance to CI; if issue-specific instructions require stopping,
report BLOCKED without first reverting authorized edits. The Stop hook
checkpoints eligible WIP; if the hook itself cannot close safely, preserve the
checkout, receipt, and all edits and require operator recovery. Handoffs must
never tell Codex to clean/undo partial edits after an optional check fails.
Framework regression tests must exercise a directly affected import on the
minimum supported Python runtime and verify blocked-work preservation.

### Escalation boundary

Codex SHALL self-resolve implementation-only choices using repository authority
and the smallest architecture-consistent implementation inside ALLOWED_PATHS,
provided the choice does not change user-visible financial meaning. Code structure,
type shapes, accumulators, and module placement are not product-owner decisions.

LOOKUP_REQUIRED/BLOCKED is appropriate for unresolved product/financial semantics,
unavailable external authoritative facts, additional authorization, unsafe
prerequisite state, or materially different user-visible economic outcomes.
Inspect the relevant authority before escalating; then provide:

```text
DECISION_NEEDED: <one sentence describing the product decision>
PRODUCT_IMPACT: <what changes for users or financial behavior>
OPTIONS: <only materially different choices>
RECOMMENDATION: <preferred option when supportable>
TECHNICAL_REASON: <short explanation>
```

Authorization-only requests include the exact scope path needed. State product
meaning before implementation vocabulary. The task skill's D1-B refinance example
illustrates a valid decision: scheduled monthly payment dates versus arbitrary
calendar dates requiring partial-month interest semantics. That choice changes
the supported user capability and must not be silently decided as a code detail.
Hooks do not call ChatGPT/OpenAI; the concise block supports human relay.

Acceptance is enforced mechanically where the repository can prove it.

Codex may report:

```
TASK_STATUS: COMPLETE
ACCEPTANCE_STATUS: SATISFIED
```

only after the feature branch is clean, contains implementation commits after
the task-start HEAD, stays within allowed paths, and is pushed/up-to-date with
its tracking branch.

When external information, authorization, or scope prevents safe completion,
Codex reports:

```
TASK_STATUS: BLOCKED
BLOCKER: <specific reason>
```

or `LOOKUP_REQUIRED: <exact missing fact>`.

The Stop hook does not judge financial semantics or substitute for CI. It
prevents false mechanical completion and leaves semantic verification to GitHub
CI, engineering-validation, UAT, and ChatGPT audit.

## 8. Learning-loop interaction

Active lessons are planning inputs, not prompt-parser dependencies.

ChatGPT applies relevant active lessons while constructing the semantic brief.
If a lesson becomes a universal base contract, codify it in the framework and
retire the lesson rather than forcing every future prompt to carry marker text.

Candidate issues never enter Codex prompts automatically.

## 9. Direct ChatGPT GitHub maintenance

When the product manager explicitly authorizes a small documentation,
specification, roadmap, governance or bounded CI-policy correction, ChatGPT may
implement it directly via a focused `agent/` GitHub PR without opening a Codex
implementation task. Inspect current file versions and affected validators,
preserve manifest/requirement and milestone-issue traceability when applicable,
and wait for latest-head selected CI before claiming merge readiness. Keep
substantial application/engine development and unresolved product decisions in
the usual architecture -> V3 issue -> Codex implementation process. A directly
authored PR is still subject to independent review and product-manager merge
approval. The ChatGPT direct-edit path does not loosen Codex mutation hooks.

## 10. Post-implementation audit and issue synchronization

After each substantive Codex implementation/repair audit, ChatGPT SHALL reconcile
the **existing GitHub implementation issue** with the latest observed PR and
requirement state before declaring a repair handoff ready. The issue remains
Codex's authoritative next-turn contract, not just a record of its initial
authorization. Use a short, dated **Current audit checkpoint** in the issue body,
preserving the original V3 authorization at the beginning and historical audit
evidence instead of overwriting earlier claims without explanation.

The current checkpoint SHALL distinguish:

1. **Implementation status:** implemented and evidenced, implemented but
   unverified, partially implemented, not implemented, or blocked. Cite the
   specific PR/commit and latest relevant CI, audit, or UAT evidence. Codex's
   `TASK_STATUS: COMPLETE` does not establish CI success, semantic acceptance,
   merge readiness, or product-owner UAT.
2. **Remaining work:** each material defect or unsatisfied acceptance criterion,
   expected behavior and negative/boundary cases, verification required, and
   whether work is needed before merge or at a later explicitly authorized gate.
3. **Scope additions or corrections:** newly discovered requirements, changed
   acceptance criteria, required `ALLOWED_PATHS`, prerequisites, and exclusions.
   Clearly distinguish **proposed / decision pending** work from **approved**
   Codex authorization. Do not silently widen financial semantics, task scope,
   edit paths, or milestone commitments.
4. **Disposition and next action:** merge-ready, needs patch, or blocked; any
   required product decision; remaining CI/heavy-validation/UAT; and the exact
   existing issue/PR/branch for continuation.

When the audit identifies changes within the original coherent task, amend the
**same open issue** to make the next Codex implementation contract self-contained,
including any approved V3 authorization updates and actionable repair criteria.
Do not create a duplicate patch issue. Open a separate issue only for genuinely
independent work with distinct ownership or timing, and maintain roadmap and
issue-register traceability. Product/repair tasks must still not authorize
framework-control paths.

Never rewrite or broaden an issue's live task authorization while Codex is
executing it. Reconcile the issue between turns; honor the hook's provenance and
continuation safeguards, and use operator-owned remote bootstrap for a resumed
branch when required. Keep completed functionality clearly separated from
remaining repairs so Codex does not reimplement accepted work.

For a fully accepted implementation, record final PR/CI/audit/UAT evidence and
close the issue only when the repository's milestone issue policy permits.
Do not manufacture repeated issue edits when a new audit produces no material
change from an already current checkpoint. If GitHub is unavailable, explicitly
report that issue synchronization is pending; do not imply it was performed.
