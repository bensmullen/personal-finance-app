# Framework requirements and traceability

Authority: PM-approved direction tracked by #362; current runtime policy remains until each reviewed activation gate. IDs below describe engineering requirements, not new financial product semantics. The operative write contract remains the original GitHub task. `plan.json` supplies machine-checked owners, dependencies and verification IDs; each GF-V case is defined in verification-and-metrics.md.

| ID | Required behavior and acceptance boundary | Primary package(s) | Verification |
| --- | --- | --- | --- |
| GF-R01 | Approved goal records repository, revision, authoritative requirements, exclusions, decision authority, budget and measurable completion. A goal is not a blanket coding grant. | GF-01 | GF-V01 |
| GF-R02 | Issue metadata owns operational phase/gate/dependencies after lossless shadow-tested migration; labels are projections. Ordinary task assignment needs no PR; changed controlled commitments still do. | GF-02 | GF-V02 |
| GF-R03 | Event/state changes are versioned and idempotent. Publish, verify, ready-to-merge, merged and accepted are distinct. Duplicate, late or lost acknowledgements cannot duplicate effects. | GF-01,03 | GF-V03 |
| GF-R04 | Before cross-cutting writes, independently review source/evaluator → writer/journal → rollback/archive/replay → reference/app/worker/UI outward paths, optional/empty/fallback branches, fixtures and exclusions. Unknowns block only affected work. | GF-01,03 | GF-V04 |
| GF-R05 | Level-1 path/acceptance correction stays on the same issue between closed turns; re-fetch/parser-check and reauthorize. No silent active-grant edits or blanket paths. | GF-03 | GF-V05 |
| GF-R06 | Local/cloud selection uses actual versioned capability evidence. Unsupported native delegation, hooks or telemetry are not assumed; no paid API fallback. | GF-06 | GF-V06 |
| GF-R07 | Actual workspace/origin/branch/head/upstream/receipt and one-writer fencing must be proven before mutation. Preserve dirty/unpushed/crashed work; lease expiry alone does not prove a process stopped. | GF-03,06 | GF-V07 |
| GF-R08 | Prioritize ready critical-path work and safe parallelism with file plus logical-interface/state ownership, dependency and merge order. Start with two writers; avoid starvation and gratuitous rescheduling. | GF-07 | GF-V08 |
| GF-R09 | Subagents are selective, preferably read-only, isolated, budgeted and incapable of escalating parent scope. Independent review is not implementer self-certification. | GF-06,07 | GF-V09 |
| GF-R10 | Budget coordinator and workers together without double-counting shared pools; reserve capacity atomically. Unknown/stale quota is explicit, not unlimited. Exhaustion pauses safely. | GF-05 | GF-V10 |
| GF-R11 | Choose verified available model/effort profiles by risk and measured accepted outcomes, record actual configuration and preserve minimum review quality. No unsupported-model silent fallback. | GF-05 | GF-V11 |
| GF-R12 | Context rotation/compaction occurs at authenticated safe checkpoints, retains unresolved decisions/gates and re-fetches live authority. Dot memory and turn count alone are not readiness. | GF-05,06 | GF-V12 |
| GF-R13 | Inspect all selected exact-head CI jobs/shards and applicable manual evidence. Missing/failed/required-skipped is not success. Codex ends after publication; deterministic coordination waits. | GF-04 | GF-V13 |
| GF-R14 | First blocker triggers full affected-contract/sibling audit; bounded coherent repair reuses the issue. Two same-root-cause attempts trigger changed diagnosis or escalation, never test weakening. | GF-03,07 | GF-V14 |
| GF-R15 | Every applicable synthetic household has independent exact financial expectations and actual supported UI journeys, source/provenance/replay/negative coverage. Future #108 personas are not claimed implemented. | GF-04 | GF-V15 |
| GF-R16 | Pre-UAT evidence includes real screenshots/interaction and independent semantic/visual review, no blocking discrepancy, exact candidate and fixture inventory. Actual required PM UAT remains a separate authenticated acceptance. | GF-04,08 | GF-V16 |
| GF-R17 | Mutation testing is isolated, incremental/targeted and risk-triggered; broader release runs are budgeted. Classify survivors and coverage honestly; scores are not correctness. | GF-09 | GF-V17 |
| GF-R18 | Eligible merges require approved tier, current exact-head/integration evidence, independent review and no PM/UAT blocker; conditional expected-head mutation and post-merge confirmation close races. | GF-08 | GF-V18 |
| GF-R19 | Measure total usage, interventions, lead time, repairs, CI and safety by comparable cohorts with source/unit/coverage. Store compact references; no quadratic repetition of immutable payloads. | GF-05,09 | GF-V19 |
| GF-R20 | Identify recurring inefficiency from event deltas; bounded experiments require a comparison, stop/rollback and independent review. No self-weakening controls or automatic lesson promotion. | GF-09 | GF-V20 |
| GF-R21 | Notify for actionable decisions, genuine UAT readiness, completion or serious failures; suppress unchanged noise. Continue independent approved work when PM is unavailable. | GF-07,09 | GF-V21 |
| GF-R22 | Staged opt-in activation, revocation, kill switch, acknowledged safe stop and manual V3 fallback are proven. Planning approval alone activates nothing. | GF-06,08,09 | GF-V22 |
| GF-R23 | Authenticate actors/events/approval and use least privilege. Issue/log text is untrusted data; hashes are change witnesses, not permission. Never persist credentials or real financial data in artifacts. | GF-01,02,03,06,08 | GF-V23 |
| GF-R24 | Requirements → issues → PRs → checks/artifacts → phase exits remain traceable. Risk-adaptive APIV reuses settled alignment; task/PR count is not accepted goal completion. | GF-01,07,09 | GF-V24 |

## Coverage of the original fourteen considerations

| Consideration | Design disposition |
| --- | --- |
| 1 Subagents | R09: bounded independent discovery/review; no default fan-out |
| 2 Remaining allowance | R10/R19: observed/estimated/unknown telemetry, reservations and coverage |
| 3 Model/reasoning choice | R11: verified profiles and actual outcomes, not guessed cheapest model |
| 4 Coordinator bottleneck | R10/R19/R21: coordinator cost counted; deterministic no-change handling |
| 5 Scope expansion without PRs | R04/R05: complete census then same-issue closed-turn correction |
| 6 D1/D2 issue assignment without PRs | R02: lossless metadata migration; controlled gates preserved |
| 7 Long threads | R12: safe checkpoint/re-fetch; no fixed-turn folklore |
| 8 Mutation testing | R17: targeted material-change and release assurance |
| 9 Existing hooks | R07/R22: preserve V3, receipts and execution controls; certify adapters |
| 10 APIV | R01/R24: align/plan at goal and task risk level, independently verify |
| 11 Borrowed framework practices | R09/R24: role separation, adaptive depth, durable handoffs; no wholesale third-party hierarchy |
| 12 Dot context | R12/R23: GitHub authority and verified context, not memory correctness claims |
| 13 Ideal issue size | R04/R05/R24: coherent verifiable PR outcome; internal steps do not require issues |
| 14 Delegated merges | R16/R18/R22: exact-head evidence, independent review, PM UAT and explicit activation |

Additional approved requirements—safe parallel work, measured process correction, preimplementation path completeness and household readiness—are R08, R20, R04 and R15–16 respectively.

## Change boundaries

An implementation detail within these interfaces is not a new PM decision. A missing actual source contract, changed financial meaning, unsupported runtime capability, permission expansion or revised release/UAT obligation is not an implementation detail. Resolve it at the appropriate authority, preserve the blocked chain and continue independent work. Do not make this reference package override stronger canonical financial specifications.

The child issues are planned bounded contracts, not a guarantee that every future native API or newly added caller is known today. At dispatch refresh the relevant live interface/path census once, resolve all confirmed omissions cohesively and validate the saved body. Preserve requirements and negative cases when the smallest defensible path list changes.
