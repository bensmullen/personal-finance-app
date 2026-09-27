# Agent Framework Hardening V2

**Status:** pre-R1/R2 prerequisite  
**Purpose:** prevent model/runtime waste and make the Hybrid ChatGPT → Codex →
GitHub CI workflow enforceable rather than advisory.

## 1. Core operating model

Normal ChatGPT resolves semantics, architecture, acceptance, read scope, edit
scope, CI profile, heavy-validation needs, UAT, and stop conditions.

Codex receives a `PFM_TASK_V2` implementation contract and edits only. Codex
does not supervise local verification, repair its own environment, or reopen
resolved architecture. GitHub CI verifies. ChatGPT audits/diagnoses CI and
issues at most two bounded repair handoffs.

## 2. Machine-enforced task contract

Repository mutation requires:
- full expected SHA and clean working tree;
- explicit task kind and implementation breadth;
- semantic status;
- external repair round;
- dependency policy;
- discovery policy;
- `LOCAL_EXECUTION_POLICY: no_tests`;
- ordinary CI profile;
- heavy-validation profile;
- UAT status;
- `READ_PATHS` and `ALLOWED_PATHS`;
- objective, resolved decisions, acceptance, exclusions, and stop conditions;
- a requirement → implementation → evidence map;
- material failure/partial-state semantics;
- explicit claims, known gaps, and evidence for those claims;
- a profile-specific semantic contract;
- a CI/heavy/UAT evidence plan.

Read-only prompts remain possible without an envelope, but mutation is blocked.

## 3. Guardrails

The project hook:
- stops a session before inference if Git/Node 22/npm/dependencies are not ready;
- blocks malformed V2 handoffs before the task reaches the agent;
- blocks mutation without a V2 handoff;
- blocks local tests/typecheck/build/validators/benchmarks/dev servers;
- blocks agent-phase dependency installation and package-manager switching;
- blocks normative/spec/architecture/PR-history rereads for resolved tasks;
- enforces declared read/edit paths;
- protects agent-control files from product/repair tasks;
- enforces locked dependency declarations;
- blocks unsafe/force/main pushes and auto-approves only the narrow safe feature
  branch push when Codex asks for permission;
- stops after out-of-scope edits;
- stops automatic context compaction inside a bounded PFM task.

Hooks are guardrails, not the only correctness boundary. GitHub branch
protection/rulesets and CI remain required.

## 4. Environment contract

Repository runtime is Node 22 with npm 10. The checked-in desktop Local Environment at
`.codex/environments/environment.toml` runs only:

`npm ci --prefer-offline --no-audit --no-fund`

before Codex begins. Tests/builds are deliberately absent from setup. In the
desktop app, select the checked-in **Personal Finance App** environment when
starting a Worktree chat.

`.node-version` pins the expected major. `.npmrc` keeps installs
noninteractive and engine-policy friendly. `tools/codex/env-doctor.sh` is the
human-readable readiness check.

Codex must never improvise with pnpm/yarn/bun/internal runtime paths when this
contract fails. Built-in web search, apps/plugins, subagents, Fast mode, and
Codex goal auto-continuation are disabled for project implementation sessions;
missing external information returns to ChatGPT via `LOOKUP_REQUIRED`.

## 5. Publication contract

Approved pushes:
- origin is exactly the Personal Finance App repository;
- current branch starts `codex/` or `agent/`;
- destination is that same feature branch;
- no force/delete;
- never `main`.

A failed authentication/network push ends the Codex task; authentication is a
user/environment concern, not an agent debugging task.

## 6. CI and heavy validation

Ordinary CI first creates a changed-surface verification plan and launches only
the gates required by that risk surface. Unknown/toolchain/CI changes fail safe
to the full matrix.

Expensive performance/stochastic/onboarding/provider evidence lives in the
manual engineering-validation workflow. No LLM remains active while those jobs
run.

Before ChatGPT emits a handoff it follows
`docs/development/handoff-authoring-policy.md`. This is intentionally separate
from Codex execution: ChatGPT resolves requirement ownership, claims/evidence,
partial-state semantics, boundary/applicability rules, persistence/context
requirements, and the selected roadmap profile's risk contract before Codex
sees the prompt.

## 7. Repair contract

Round 0/1/2 are externally assigned. Codex cannot continue from a local failure
into another repair round because local verification is prohibited and the
prompt hook rejects invalid rounds. Automatic compaction also terminates the
turn rather than allowing an unbounded implementation session.

## 8. Manual prerequisites

Before the next Codex implementation:
1. install/activate Node 22 so the desktop integrated terminal sees `node` and
   `npm`;
2. select the checked-in **Personal Finance App** Local Environment;
3. trust the repository and the updated hooks;
4. authenticate GitHub CLI/Git;
5. enable a GitHub main-branch ruleset requiring PRs and the aggregate `test`
   status, blocking force pushes/deletion, and applying to administrators;
6. run `bash tools/codex/env-doctor.sh` in the desktop integrated terminal.

Do not start R2/another product milestone until those checks pass.
