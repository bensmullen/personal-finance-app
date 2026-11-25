# Roadmap Issue Traceability Policy

**Status:** required project planning discipline  
**Owner:** ChatGPT product architecture / milestone review layer  
**Allocation authority during shadow:** `docs/development/milestone-issue-register.json`  
**Controlled milestone authority:** `docs/specs/roadmap/post-pr21-implementation-roadmap.md`

## Purpose

An open backlog issue is not a guaranteed future deliverable merely because its GitHub text says “before private alpha.” Every work issue needs one explicit milestone owner and a **first mandatory stage gate**. The roadmap defines sequencing; the issue register maps GitHub IDs to that sequencing. GitHub's live issue/PR state is authoritative for completion; the register is a planning index, not a copied status database.

**Authority boundary:** The register stores stable delivery metadata and a concise success intent, **not** Codex `ALLOWED_PATHS`, exhaustive implementation callers, a dated blocker log, current branch/PR state, or a second V3 contract. The original implementation issue owns those details and its hook-enforced write authorization. The roadmap owns milestone sequencing and product/architecture commitments rather than per-file repair history. Avoid testing that a registry description names individual source files.

## Issue lifecycle

1. **At creation,** the ChatGPT planning layer classifies each new non-learning issue as an in-scope task, planned feature, investigation, deferred conditional feature, or administrative cleanup. It records the issue number, owner stage, first mandatory gate, dependency IDs, relevant controlled requirement IDs and concise success intent in the register, and links the stage in the issue body. These updates should be in the same planning change; if a repository PR is needed, publish it immediately and keep the gate pending until merged.
2. **Before a milestone handoff or closeout,** re-read the **live** GitHub open/closed status for that stage's listed issues, inspect current roadmap and requirement authority, reconcile issue/PR closure, and check that no newly opened non-learning issue is missing from the register. Do not let a stage complete with an unresolved mandatory item unless the product owner explicitly changes the stage/gate in the controlled roadmap. An investigation is complete only when the cause and any necessary repair follow-up have a linked resolution.
3. **Classify a change by authority before editing planning files:**
   - **Task-local (Level 1):** A justified `ALLOWED_PATHS` addition, bounded test/acceptance clarification, or repair within the *already approved* financial/product semantics, issue owner, stage/gate, dependency graph and controlled requirements belongs in the **same live V3 issue only**. Reviewer re-fetches and validates the actual V3 parser, reachable caller/issuer/posting/replay coverage and receipt/branch state before the next Codex grant. No scope-only register/roadmap/test PR, new patch issue or additional PM approval is needed. Do not rewrite an active task grant, weaken selected-path financial safety, or assume a changed file list is evidence of changed milestone scope.
   - **Delivery graph (Level 2):** A new mandatory non-learning issue, changed first mandatory gate/owner, dependency, consolidation or requirement allocation requires a register update with an independently reviewable PR and the normal live-issue traceability check. Update the roadmap **when the change affects milestone sequencing, commitments or release gates**, not just because a register row changed. Keep both aligned when those shared facts change.
   - **Product/architecture authority (Level 3):** A change to supported financial meaning, provenance/source authority, tax/legal rules, key public interfaces, user commitments or release acceptance needs a resolved PM decision and the applicable canonical spec, ADR and/or controlled roadmap update. Also change the register only if its delivery graph or requirement ownership changes. Never relabel this as a path-only repair.
   Preserve existing first mandatory gates; never silently downgrade “before private alpha,” waive original-source evidence, or delete a mandatory row. An autonomous coordinator may classify Level 1 from verified evidence, but cannot override PM decisions, one-writer hooks, real external provider contracts, exact-head CI or independent QA.
4. **When work is completed,** close the corresponding issue against merged and audited evidence, and keep the historical register record as an auditable link (the item need not remain open). Do not mistake “PR merged” for completion of a distinct human-UAT or financial-readiness gate.
   Before closing or re-handing off an implementation issue, apply the current audit-checkpoint and scope-reconciliation rules in `docs/development/handoff-authoring-policy.md` §10; a stale original contract is not sufficient next-turn authorization.
5. **When an issue is consolidated into another,** copy its complete acceptance criteria into the surviving open issue, then close the superseded issue as duplicate with a direct link. Remove the closed issue from the active gate list, keep a `closed_consolidations` historical row pointing to the survivor and original gate, and verify the surviving stage still blocks on the moved work. This is not product completion.
6. **When a candidate/agent-lesson issue is created,** use the separate `agent-learning-policy.md` candidate registry and dispositions, not this product-stage gate.

## Stage-gate preflight

- **U1/D1**: verify current final owner #120 uncoached UAT AND inherited mortgage funding reconciliation (formerly #99/#94). D1-C PR #89 and U1B phases already merged are not, by themselves, D1 acceptance.
- **D2/R5**: #103's entire unimplemented withdrawal/RMD scope is administratively consolidated into D2-A #146. Verify all consolidated owners #146/#147/#148 and shared-seam/integrated closeout #149, plus completed prep #114. Domain backend and early interface work may run during U1 #120 after approved financial contracts; final D2-D needs accepted U1 UAT and combined household integration.
- **R11/private alpha**: verify BOTH dividend reinvestment and personally funded contribution scheduling in #100 (former #104), plus #101, #102 and #105, plus every other normative R11 checklist item; a completed issue register does not replace R11's wider requirements.
- **Legacy administrative queue**: reconcile the nine historical open implementation issues in the register using merged-PR evidence; do not infer unfinished functionality merely from their open issue state.

## Verification limits

`test/milestoneIssueRegister.test.ts` validates static register identity, gate mapping, dependency consistency and roadmap linkage in ordinary CI. The separate GitHub Action `.github/workflows/issue-milestone-traceability.yml` also checks **live** open non-learning issues when an issue opens/reopens/is edited, when the register/check changes in a PR, and weekly. The live script fails with the exact missing GitHub issue numbers; new issues are not silently ignored. The workflow is active on main; its status must be checked when a new issue is created or the register changes. Candidate issues remain covered by their separate learning registry. Before every milestone handoff and closeout, human/ChatGPT reviewers must still inspect live issue state and substantive acceptance evidence; a green coverage check alone cannot prove that an issue is complete.

Codex needs its separate valid `PFM_TASK_V3` issue contract and merged prerequisites. Live-issue coverage, dependency-cycle checks, independent financial semantics/replay review and PM UAT remain mandatory.

## Metadata shadow and reviewed cutover

During shadow, continue the issue lifecycle and register requirements above. The live workflow publishes a read-only comparison of the register, its lossless import and the observed GitHub issues. Historical and consolidated records remain in the comparison after closure. Labels and Projects can display the allocation.

After independent review and explicit PM approval of a coordinated cutover, assign ordinary tasks within approved goal, stage, first gate and requirement boundaries through a validated `PFM_TASK_META_V1` block on the live issue. Existing controlled commitments still require their applicable review and canonical updates. The register becomes a generated snapshot for offline planning, including source and freshness. Live metadata coverage and the re-fetched V3 parser check remain required at dispatch. Issue closure still requires separate acceptance evidence.

The [migration runbook](goal-framework/metadata-migration.md) records the rollout, the write boundary and the rollback inventory.
