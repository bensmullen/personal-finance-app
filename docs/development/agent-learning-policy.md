# Agent Learning Policy

**Status:** repository-enforced governance for process learning  
**Owner:** ChatGPT semantic/architecture layer plus framework-only repository changes  
**Purpose:** preserve useful lessons across turns, threads, and PRs without allowing a single anomalous failure to rewrite development policy.

## 1. Core model

The learning loop is:

`incident -> candidate -> active lesson -> retired/superseded lesson`

An **incident** is evidence that something happened: CI failure/timeout/cancellation,
a hook block, a STOP, a misleading implementation, a manual recovery, or a
user/ChatGPT correction. An incident is not itself a rule.

A **candidate** is a plausible generalizable lesson selected by the ChatGPT
semantic/architecture layer. Candidates are durably stored as GitHub Issues in
this repository's candidate registry and are never injected into Codex handoffs.

An **active lesson** is a curated repository rule stored in
`docs/development/agent-lessons.json`. It has deterministic applicability
selectors and is enforced by the PFM hook. Active lessons complement, but never
override, higher-authority financial specifications, AGENTS rules, or
verification policy.

A **retired** lesson remains in the lesson ledger for history but is no longer
injected because it was superseded, disproven, or permanently codified into a
higher-level base contract.

## 2. Candidate capture is automatic; activation is curated

When the ChatGPT semantic/architecture layer concludes that an incident or
correction represents a candidate lesson, persistence is part of the same
review turn. The candidate MUST be written to the GitHub candidate registry
before the response may say that the candidate was recorded.

Candidate persistence SHALL:

1. normalize the candidate's proposed rule, applicability selectors, and
   `do_not_generalize_to` boundary;
2. compute the deterministic key described below;
3. search open and closed repository issues for that key;
4. create one issue when the key is new, or update the existing issue when the
   same lesson recurs;
5. retain concrete evidence, first/last-seen context, and recurrence count;
6. report the issue/key in the user-facing Process learning line.

If GitHub persistence fails, the response MUST say
`candidate persistence failed`; it must not imply the lesson is durable.

Raw incidents MUST NOT automatically become candidates. CI, Codex, hooks, and
generated artifacts may record incident evidence, but only the ChatGPT
semantic/architecture layer classifies whether evidence is plausibly
generalizable. Codex may report a concise process signal for later review; it
does not create, promote, reject, or activate candidate lessons.

### Candidate identity

The canonical identity input is JSON with exactly these keys:

- `rule`: whitespace-collapsed rule text;
- `applicability`: each of `task_kinds`, `ci_profiles`,
  `heavy_validation_profiles`, and `task_continuities` normalized to sorted,
  unique lowercase strings;
- `do_not_generalize_to`: whitespace-collapsed negative-space text.

Serialize those keys in the order above with compact JSON encoding, SHA-256 the
UTF-8 bytes, and use the first 12 lowercase hex characters:

`ALC-<12 hex>`

`tools/codex/agent-candidate-key.mjs` is the executable reference for this
normalization. The deterministic key prevents recurrence from creating duplicate
candidate records merely because the supporting incident text changed.

### Candidate issue contract

Candidate issues use the title:

`[agent-candidate][ALC-xxxxxxxxxxxx] <short title>`

and retain:

- candidate key and disposition;
- severity;
- proposed rule;
- applicability selectors;
- `do_not_generalize_to`;
- concrete evidence;
- first-seen and last-seen context;
- recurrence count;
- review criteria;
- links to any active lesson/framework change that later resolves the candidate.

Allowed dispositions are `pending`, `promoted`, `codified`, `rejected`,
and `duplicate`. Pending candidates have no effect on task routing or prompt
validation.

## 3. Promotion is curated

`docs/development/agent-lessons.json` is the curated active/retired policy
ledger. CI, Codex, hooks, candidate issues, and generated artifacts MUST NOT edit
or promote that ledger.

A framework change may promote a pending candidate only when the evidence shows
the failure is generalizable and the proposed rule is narrower than the problem
it prevents. Normally a one-off issue remains pending. Repeated failures or a
severe safety/resource/process failure may justify immediate activation when the
rule is deterministic and low-risk.

Every active lesson MUST include:
- concrete source evidence, including the candidate issue when applicable;
- narrow applicability selectors;
- the preventive rule;
- explicit `do_not_generalize_to` negative space;
- review/retirement criteria;
- any prompt markers the hook can verify.

Promotion assigns the next curated `AL-NNN` identifier. The source candidate
issue is then updated to `promoted`. If a framework/base-contract change solves
the problem without requiring an active lesson, update the candidate disposition
to `codified`. Rejection or duplicate disposition likewise requires an explicit
reason; no counter or score may make that decision automatically.

## 4. Deterministic active-lesson applicability

Applicability is computed only from task-envelope fields:
- `TASK_KIND`;
- `CI_PROFILE`;
- `HEAVY_VALIDATION_PROFILE`;
- `TASK_CONTINUITY`.

Each selector is an explicit list; `*` means any value. The hook computes the
matching active IDs and requires `LESSONS_APPLIED` to match exactly. It also
requires every active lesson's `required_markers` to be present in the handoff.

Candidate issues are deliberately excluded from applicability computation. The
implementation model does not reread or reinterpret candidates.

## 5. Conflict, retirement, and overcorrection

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

## 6. Incident evidence

Ordinary CI and heavy engineering validation may write a structured
`engineering-validation-artifacts/agent-incident.json` containing:
- schema version;
- surface/profile;
- repository, run ID, event, and head SHA;
- selected gate conclusions;
- recording timestamp.

This artifact contains process evidence only. It does not classify root cause,
create a candidate, or recommend a policy change.

## 7. User-facing reporting

After Personal Finance App implementation/audit/planning turns, the
architecture/review layer should end with exactly one concise Process learning
line:

- `Process learning: none.`
- `Process learning: candidate recorded — ALC-xxxxxxxxxxxx (#N). Framework action: <review trigger or none>.`
- `Process learning: candidate persistence failed — <short reason>. Framework action: registry write required before this lesson is durable.`
- `Process learning: active — AL-NNN. Framework action: <none or specific follow-up>.`

Do not report `candidate recorded` merely because a lesson was mentioned in
chat. The GitHub issue is the durable candidate record; the active/retired lesson
ledger is the durable policy record.

## 8. Migration

Legacy candidate entries that predate this policy are migrated to candidate
issues. After migration, `docs/development/agent-lessons.json` contains only
active and retired lessons. Existing active lesson IDs remain stable.
