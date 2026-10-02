# Agent Learning Policy

**Status:** repository-enforced governance for process learning  
**Owner:** ChatGPT semantic/architecture layer plus framework-only repository changes  
**Purpose:** preserve useful lessons across turns, threads, and PRs without allowing a single anomalous failure to rewrite development policy.

## 1. Core model

The learning loop is:

`incident -> candidate lesson -> active lesson -> retired/superseded lesson`

An **incident** is evidence that something happened: CI failure/timeout/cancellation,
a hook block, a STOP, a misleading implementation, a manual recovery, or a
user/ChatGPT correction. An incident is not itself a rule.

A **candidate** records a plausible generalizable lesson but is never injected
into implementation prompts.

An **active** lesson has deterministic applicability selectors and is enforced
by the PFM hook. Active lessons complement, but never override, higher-authority
financial specifications, AGENTS rules, or verification policy.

A **retired** lesson is no longer injected because it was superseded, disproven,
or permanently codified into a higher-level base contract.

## 2. Promotion is curated

CI, Codex, hooks, and generated artifacts MUST NOT edit or promote
`docs/development/agent-lessons.json`.

ChatGPT may recommend promotion during an audit. A framework change may promote a
lesson only when the evidence shows the failure is generalizable and the proposed
rule is narrower than the problem it prevents. Normally a one-off issue remains a
candidate. Repeated failures or a severe safety/resource/process failure may
justify immediate activation when the rule is deterministic and low-risk.

Every active lesson MUST include:
- concrete source evidence;
- narrow applicability selectors;
- the preventive rule;
- explicit `do_not_generalize_to` negative space;
- review/retirement criteria;
- any prompt markers the hook can verify.

## 3. Deterministic applicability

Applicability is computed only from task-envelope fields:
- `TASK_KIND`;
- `CI_PROFILE`;
- `HEAVY_VALIDATION_PROFILE`;
- `TASK_CONTINUITY`.

Each selector is an explicit list; `*` means any value. The hook computes the
matching active IDs and requires `LESSONS_APPLIED` to match exactly. It also
requires every active lesson's `required_markers` to be present in the handoff.

The implementation model does not reread or reinterpret the ledger.

## 4. Conflict, retirement, and overcorrection

A lesson cannot override higher-authority repository policy. If an active lesson
conflicts with a newer base contract, fail closed and repair the framework.

Lessons should be reviewed when:
- the same incident recurs despite application;
- a rule creates repeated unnecessary friction or blocks valid work;
- the underlying environment/architecture changes;
- the safeguard has been permanently encoded in a higher-level policy/self-test.

Retirement records why the lesson no longer applies and, when applicable,
`superseded_by`. Successful PRs alone do not prove a lesson caused success;
counters and automatic scoring MUST NOT promote or retire policy.

## 5. Incident evidence

Ordinary CI and heavy engineering validation may write a structured
`engineering-validation-artifacts/agent-incident.json` containing:
- schema version;
- surface/profile;
- repository, run ID, event, and head SHA;
- selected gate conclusions;
- recording timestamp.

This artifact contains process evidence only. It does not edit the ledger,
classify root cause, or recommend a policy change.

## 6. User-facing reporting

After implementation/audit turns, the architecture/review layer should end with
one concise line:

- `Process learning: none.`
- or `Process learning: candidate/active — <one sentence>. Framework action: <none or specific follow-up>.`

This report is explanatory; the repository ledger remains the durable source of
process lessons.

## 7. Initial lessons

The initial ledger intentionally contains one active lesson from PR #32's
expensive-CI failure and two candidates from the browser fault-injection and hook
runtime-compatibility incidents. Candidate status is deliberate: it preserves the
evidence without turning isolated failures into global prohibitions.
