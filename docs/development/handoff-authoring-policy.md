# Handoff Authoring Policy

**Status:** required before any `PFM_TASK_V2` implementation/repair handoff  
**Owner:** ChatGPT semantic/architecture planning layer  
**Purpose:** prevent a detailed Codex prompt from omitting contracts that later
produce semantically misleading but CI-green implementations.

## 1. Authoring sequence

Before emitting the Codex handoff, ChatGPT SHALL:

1. inspect the actual current repository plus the narrow authoritative
   specification/roadmap sections needed for the task;
2. resolve semantic/architectural decisions itself rather than delegating them
   to Codex;
3. build a compact requirement → implementation obligation → evidence map;
4. enumerate material failure/partial/unsupported/stale/cancelled/error states
   and state what each means;
5. enumerate every support, coverage, compatibility, performance, completeness,
   or baseline claim the implementation is allowed to make, plus known gaps;
6. identify ownership/boundary/applicability rules for cross-cutting state,
   telemetry, caching, concurrency, persistence, or generated artifacts;
7. choose CI, heavy-validation, and UAT evidence from failure risk rather than
   an arbitrary test count;
8. load `docs/development/agent-lessons.json`, deterministically select every
   active lesson whose applicability matches the task fields, apply its required
   safeguards, and list exactly those IDs in `LESSONS_APPLIED`;
9. perform a contradiction/negative-space audit: what would be misleading if
   implemented using a convenient surrogate, inferred from names/counts, or
   silently treated as success?;
10. collapse the result into the V2 sections. Do not send the full reasoning
   history to Codex.

A handoff is not "resolved" merely because it is long. It is resolved only when
the implementation can satisfy every mapped requirement without inventing a
semantic decision.

## 2. Universal compact sections

### REQUIREMENT_MAP

Map only requirements materially changed by the task:

`requirement/contract -> implementation obligation -> CI/heavy/UAT evidence`

This catches requirements that have an implementation instruction but no proof,
or a proof claim with no implementation owner.

### FAILURE_MODES

Include material non-happy paths. At minimum consider, where applicable:
partial/incomplete, unavailable/unsupported, stale/superseded, cancelled,
failed/error, duplicate/retry, out-of-order completion, and incompatible version
or provenance.

Never let "returned a result" imply "valid/complete/successful."

### CLAIMS_AND_GAPS

`CLAIMS:` names only claims actually supported by fixture/model/request data
and executed evidence.

`KNOWN_GAPS:` explicitly names deferred, unsupported, not-measured, and
not-applicable areas.

`EVIDENCE:` ties every material claim to an executable path, retained artifact,
CI assertion, controlled workflow, or required UAT. Names, labels, entity counts,
or fixture descriptions are not evidence by themselves.

### PROFILE_CONTRACT

Use the selected profile markers below. Keep each marker to one concise line
where possible. A marker may say N/A only when it explains why the concept
cannot apply to the task.

### EVIDENCE_PLAN

- `CI:` ordinary deterministic checks/failure classes.
- `HEAVY:` external engineering-validation profile or none.
- `UAT:` exact human workflow/decision or not_required.

Codex never performs this evidence locally.

### LESSONS_APPLIED

This scalar is `none` or the comma-separated IDs of every active lesson whose
deterministic applicability selectors match the task. It is not a place for
free-form judgment. The policy hook computes the expected set independently and
fails closed on omissions, extras, or missing required lesson markers.

Candidate and retired lessons are never injected into implementation prompts.

## 3. Profile contracts

### tooling
- `POLICY_BOUNDARY:`
- `FAIL_CLOSED:`
- `SELF_TEST:`

### spec
- `NORMATIVE_HOME:`
- `TRACEABILITY:`
- `COMPATIBILITY:`

### deterministic-interactive (R2-class)
- `ASYNC_STATE:` valid state machine/transitions
- `REQUEST_IDENTITY:` request/result correlation
- `STALE_SUPPRESSION:` out-of-order/superseded behavior
- `CACHE_VALIDITY:` exact fingerprint/invalidation basis
- `LAST_GOOD_RESULT:` failure/cancel/replacement preservation

### engine-equivalence (R3-class)
- `REFERENCE_BEHAVIOR:` authoritative pre-change behavior
- `ALLOWED_INTERNAL_CHANGE:` implementation-only degrees of freedom
- `EQUIVALENCE_EVIDENCE:` outputs/order/fingerprints/property/reference proof
- `PERFORMANCE_EVIDENCE:` controlled comparison, never wall-clock correctness

### tax
- `EFFECTIVE_DATES:`
- `JURISDICTION:`
- `ROUNDING:`
- `UNSUPPORTED_COVERAGE:`

### stochastic-foundation (R5-class)
- `SEEDING:`
- `IDENTITIES:`
- `SUBSTREAMS:`
- `UNSUPPORTED_DISTRIBUTIONS:`
- `REPRODUCIBILITY:`

### stochastic-orchestration (R6-class)
- `SCHEDULING_INDEPENDENCE:`
- `BOUNDED_MEMORY:`
- `CANCELLATION:`
- `CONVERGENCE:`
- `PERSISTENCE:`

### onboarding
- `CANDIDATE_FACTS:`
- `PROVENANCE:`
- `AMBIGUITY:`
- `CONFIRMATION:`
- `PRIVACY:`

### provider-adapter
- `PROVENANCE:`
- `VERSION_PINNING:`
- `NORMALIZATION:`
- `LICENSING:`
- `FAILURE_MODE:`

### probabilistic-ux
- `FORECAST_BASIS:`
- `FRESHNESS:`
- `RERUN_POLICY:`
- `PROBABILITY_LANGUAGE:`
- `COMPARISON_BASIS:`

`deterministic`, `docs-only`, and `full` have no additional CI-profile
markers; their universal sections still apply. Use `full` only as a
conservative verification profile, not as permission for vague semantics.

## 4. Heavy-validation contracts

When `HEAVY_VALIDATION_PROFILE` is not `none`, append these markers to the
same `PROFILE_CONTRACT`.

### performance
- `CI_WORK_BOUNDARY:` maximum representative/scaling work ordinary CI may execute
- `HEAVY_WORK_BOUNDARY:` full workload owned exclusively by engineering-validation
- `BOUNDARIES:` exact included/excluded work; sibling phases do not silently overlap
- `APPLICABILITY:` measured vs unavailable/not_applicable/not_implemented/not_measured
- `SUCCESS_STATUS:` statuses valid for representative/baseline evidence
- `CONTEXT_RETENTION:` context that must survive in-memory → artifact → UI/report transformations
- `RESOURCE_SEMANTICS:` exact memory/cost/runtime meaning; absolute vs delta and metered vs not_metered
- `CONTROLLED_EVIDENCE:` workflow/artifact/history owner and comparison policy

For performance fixtures, `CLAIMS_AND_GAPS` must distinguish model contents
from **exercised** mechanics. A scenario/policy/binding/contention path is covered
only if the request/run/test actually executes it.

### stochastic
- `CONVERGENCE_CRITERION:`
- `RESOURCE_BUDGET:`
- `SAMPLE_RULE:` evidence-driven realization/repetition selection
- `ARTIFACT_CONTEXT:`
- `CONTROLLED_EVIDENCE:`

### onboarding
- `TARGET_METRIC:`
- `DATA_BOUNDARY:`
- `ABANDONMENT_OR_ERROR:`
- `ARTIFACT_CONTEXT:`
- `CONTROLLED_EVIDENCE:`

### provider
- `SECRET_BOUNDARY:`
- `LIVE_VS_FIXTURE:`
- `PROVENANCE:`
- `RETRY_FAILURE:`
- `ARTIFACT_CONTEXT:`

## 5. Cross-cutting audit questions

Before marking `SEMANTICS: resolved`, ChatGPT should be able to answer all
applicable questions:

- Is every named phase/state/capability measuring or owning the thing its name
  says, rather than a convenient adjacent operation?
- Are sibling phases/states mutually intelligible and non-overlapping where the
  specification requires distinction?
- Does N/A remain N/A instead of receiving a synthetic zero or surrogate value?
- Can an incomplete/partial result be mistaken for a complete one?
- Can serialization/summarization/persistence drop context required to interpret
  retained evidence?
- Can module-global/shared mutable context leak attribution into a later,
  unrelated request/render/run?
- Are observers/telemetry/caches truly non-authoritative and failure-isolated?
- Are absolute resource levels distinguished from signed deltas?
- Are fixture coverage claims derived from actual supported content **and**
  executed paths?
- Does a specification require retained/controlled history that a one-off local
  run would fail to provide?
- Is every external/provider/live-data claim separated from synthetic/replayed
  evidence and its secret/privacy boundary?
- Does the verification plan prove the failure modes without making timing,
  randomness, or user judgment into flaky correctness assertions?
- When heavy validation is selected, does the handoff state both the maximum
  work ordinary CI may execute and the full workload owned by heavy validation?

If any applicable answer is unresolved, the handoff must use
`SEMANTICS: lookup_required` or return to ChatGPT for further analysis rather
than sending an ambiguous resolved task to Codex.
