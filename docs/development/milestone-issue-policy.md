# Roadmap Issue Traceability Policy

**Status:** required project planning discipline  
**Owner:** ChatGPT product architecture / milestone review layer  
**Canonical machine register:** `docs/development/milestone-issue-register.json`  
**Controlled milestone authority:** `docs/specs/roadmap/post-pr21-implementation-roadmap.md`

## Purpose

An open backlog issue is not a guaranteed future deliverable merely because its GitHub text says “before private alpha.” Every work issue needs one explicit milestone owner and a **first mandatory stage gate**. The roadmap defines sequencing; the issue register maps GitHub IDs to that sequencing. GitHub's live issue/PR state is authoritative for completion; the register is a planning index, not a copied status database.

## Issue lifecycle

1. **At creation,** the ChatGPT planning layer classifies each new non-learning issue as an in-scope task, planned feature, investigation, deferred conditional feature, or administrative cleanup. It records the issue number, owner stage, first mandatory gate, dependency IDs, relevant controlled requirement IDs and concise success intent in the register, and links the stage in the issue body. These updates should be in the same planning change; if a repository PR is needed, publish it immediately and keep the gate pending until merged.
2. **Before a milestone handoff or closeout,** re-read the **live** GitHub open/closed status for that stage's listed issues, inspect current roadmap and requirement authority, reconcile issue/PR closure, and check that no newly opened non-learning issue is missing from the register. Do not let a stage complete with an unresolved mandatory item unless the product owner explicitly changes the stage/gate in the controlled roadmap. An investigation is complete only when the cause and any necessary repair follow-up have a linked resolution.
3. **When scope changes,** move its milestone/gate in the controlled roadmap and register together, and link the change in the issue; never silently downgrade “before private alpha” to post-alpha or delete a required row.
4. **When work is completed,** close the corresponding issue against merged and audited evidence, and keep the historical register record as an auditable link (the item need not remain open). Do not mistake “PR merged” for completion of a distinct human-UAT or financial-readiness gate.
5. **When an issue is consolidated into another,** copy its complete acceptance criteria into the surviving open issue, then close the superseded issue as duplicate with a direct link. Remove the closed issue from the active gate list, keep a `closed_consolidations` historical row pointing to the survivor and original gate, and verify the surviving stage still blocks on the moved work. This is not product completion.
6. **When a candidate/agent-lesson issue is created,** use the separate `agent-learning-policy.md` candidate registry and dispositions, not this product-stage gate.

## Stage-gate preflight

- **U1/D1**: verify #94 owner UAT AND incorporated mortgage funding reconciliation (formerly #99); D1-C PR #89 is already merged (and Issue #80 administratively closed), but that alone is not D1 acceptance.
- **D2/R5**: verify D2-A #103 alongside the other normative D2 breadth cases in the roadmap.
- **R11/private alpha**: verify BOTH dividend reinvestment and personally funded contribution scheduling in #100 (former #104), plus #101, #102 and #105, plus every other normative R11 checklist item; a completed issue register does not replace R11's wider requirements.
- **Legacy administrative queue**: reconcile the nine historical open implementation issues in the register using merged-PR evidence; do not infer unfinished functionality merely from their open issue state.

## Verification limits

`test/milestoneIssueRegister.test.ts` validates static register identity, gate mapping, dependency consistency and roadmap linkage in ordinary CI. The separate GitHub Action `.github/workflows/issue-milestone-traceability.yml` also checks **live** open non-learning issues when an issue opens/reopens/is edited, when the register/check changes in a PR, and weekly. The live script fails with the exact missing GitHub issue numbers; new issues are not silently ignored. The workflow is effective after this PR merges into main; its status must be checked when a new issue is created. Candidate issues remain covered by their separate learning registry. Before every milestone handoff and closeout, human/ChatGPT reviewers must still inspect live issue state and substantive acceptance evidence; a green coverage check alone cannot prove that an issue is complete.

The register never authorizes Codex to modify an issue's code scope. Codex still needs its separate valid `PFM_TASK_V3` issue contract and merged prerequisites.
