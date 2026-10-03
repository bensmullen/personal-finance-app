# Agent Learning Policy

**Status:** repository governance for process learning  
**Owner:** ChatGPT semantic/architecture layer plus framework-only repository changes  
**Purpose:** preserve useful lessons across turns, threads, and PRs without allowing one anomalous failure to rewrite development policy.

## 1. Core model

The learning loop is:

`incident -> candidate -> active lesson -> retired/superseded lesson`

An **incident** is evidence that something happened: CI failure/timeout/cancellation,
a hook block, a STOP, a misleading implementation, a manual recovery, or a
user/ChatGPT correction. An incident is not itself a rule.

A **candidate** is a plausible generalizable lesson selected by the ChatGPT
semantic/architecture layer. Candidates are durably stored as GitHub Issues in
this repository's candidate registry and are never injected automatically into
Codex handoffs.

An **active lesson** is a curated repository rule stored in
`docs/development/agent-lessons.json`. Active lessons guide ChatGPT planning
and framework evolution. They complement, but never override, higher-authority
financial specifications, AGENTS rules, or verification policy.

A **retired** lesson remains in the ledger for history but is no longer applied
because it was superseded, disproven, or permanently codified into a universal
base contract.

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
generalizable.

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

`tools/codex/agent-candidate-key.mjs` is the executable reference.

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
- links to any lesson/framework change that later resolves the candidate.

Allowed dispositions are `pending`, `promoted`, `codified`, `rejected`,
and `duplicate`. Pending candidates have no task-routing effect.

## 3. Promotion is curated

`docs/development/agent-lessons.json` is the curated active/retired ledger.
CI, Codex, hooks, candidate issues, and generated artifacts MUST NOT edit or
promote that ledger.

A framework change may promote a pending candidate only when the evidence shows
the failure is generalizable and the proposed rule is narrower than the problem
it prevents. Repeated failures or a severe safety/resource/process failure may
justify immediate activation when the rule is deterministic and low-risk.

Every active lesson MUST include:
- concrete source evidence;
- narrow applicability selectors;
- the preventive rule;
- explicit `do_not_generalize_to` negative space;
- review/retirement criteria.

Promotion assigns the next curated `AL-NNN` identifier. The source candidate
issue is then updated to `promoted`.

If a framework/base-contract change solves the problem universally, update the
candidate to `codified` and retire any active lesson whose independent
application is no longer needed. Universal safeguards belong in the base
framework, not as repetitive prompt markers.

## 4. Applying active lessons

For Personal Finance App development planning, audits, and Codex handoffs,
ChatGPT SHALL consult the live policy and active lesson ledger before issuing
implementation instructions.

Applicability remains based on the lesson's explicit selectors:
- task kind;
- CI profile;
- heavy-validation profile;
- task continuity.

ChatGPT applies matching lessons to the semantic plan and records meaningful
framework follow-up in the user-facing Process learning line.

The Codex prompt hook does **not** require `LESSONS_APPLIED` or lesson-specific
marker strings. Lesson application is a planning/audit responsibility, not a
transport or task-start gate. This prevents learning governance from making
otherwise safe implementation prompts brittle.

Candidate issues remain excluded from task routing and prompt authorization.

## 5. Conflict, retirement, and overcorrection

A lesson cannot override higher-authority repository policy. If an active lesson
conflicts with a newer base contract, repair the framework and retire/supersede
the lesson.

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
architecture/review layer ends with exactly one concise Process learning line:

- `Process learning: none.`
- `Process learning: candidate recorded — ALC-xxxxxxxxxxxx (#N). Framework action: <review trigger or none>.`
- `Process learning: candidate persistence failed — <short reason>. Framework action: registry write required before this lesson is durable.`
- `Process learning: active — AL-NNN. Framework action: <none or specific follow-up>.`

Do not report `candidate recorded` merely because a lesson was mentioned in
chat. The GitHub issue is the durable candidate record; the active/retired
lesson ledger is the durable policy record.

## 8. Migration and compatibility

Legacy candidate entries remain migrated to GitHub issues. Existing lesson IDs
remain stable.

Legacy `PFM_TASK_V2` handoffs may still be accepted by the hook when they
contain the minimal V3 authorization fields, but new handoffs should use
`PFM_TASK_V3`.
