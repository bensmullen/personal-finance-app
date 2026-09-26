# Specification Architecture & Traceability

**Version:** 1.0.1-draft
**Status:** Architecture baseline
**Requirement prefix:** PFA-SPEC

## 1. Purpose

This specification defines how Personal Finance App requirements are decomposed, identified, discovered, traced, verified, and consumed by human engineers and coding agents.

It is a governance specification. It does not redefine financial concepts owned by the canonical schema or executable financial semantics.

## 2. Specification tree

The controlled hierarchy is:

~~~text
System / software architecture and specification governance
  |
  +-- Canonical financial specification
  |     |
  |     +-- Executable financial semantics
  |            |
  |            +-- Capability specifications
  |                   |
  |                   +-- Vertical-slice / milestone specifications
  |
  +-- Interface / architecture specifications
  +-- ADRs
  +-- Verification artifacts
~~~

Financial authority follows the hierarchy defined by the system/software architecture. Structural parent/child metadata exists to aid decomposition and allocation; cross-capability dependency metadata is separate. Neither relation permits a lower-level document to override a higher financial authority.

## 3. Normative requirements

### PFA-SPEC-001 — Manifest entry point

docs/spec-manifest.json SHALL be the machine-readable discovery entry point for controlled specifications and SHALL include each registered specification's path, version, status, authority, parent_spec_ids, depends_on_spec_ids, requirement-ID policy, domains, keywords, and applicability metadata.

### PFA-SPEC-002 — One normative home

A requirement or semantic rule SHALL have one normative home. Child or sibling specifications MAY reference and refine an allocated requirement but SHALL NOT duplicate it as an independently maintained rule.

### PFA-SPEC-003 — Stable requirement IDs

New decomposed normative requirements SHALL use stable IDs in the PFA-<DOMAIN>-NNN form. Wording changes SHALL NOT change an ID unless the requirement identity itself changes. Retired IDs SHALL NOT be reused for a different requirement.

### PFA-SPEC-004 — Traceability index

docs/specs/verification/requirements-index.json SHALL map each controlled requirement ID to its owning specification, applicable parent requirement IDs, cross-requirement dependencies, requirement status, verification methods/state, verification owners, verification references, and implementation scope.

### PFA-SPEC-005 — Minimal agent retrieval

Agents SHALL begin specification discovery from the manifest and requirement index and SHALL read only the smallest relevant specification set needed for the task. Broad architecture/specification reads require a concrete cross-cutting or normative reason.

### PFA-SPEC-006 — Automated consistency

CI SHALL reject unresolved parent/dependency specification IDs, parent cycles, duplicate controlled requirement IDs, conflicting required prefixes, traceability entries owned by unknown specifications, unresolved parent/dependency requirement IDs, controlled requirement IDs missing from the traceability index, and traceability IDs absent from their declared owning specification.

### PFA-SPEC-007 — Incremental migration

Existing large/legacy normative specifications MAY remain in their current paths and MAY use the legacy requirement-ID policy until materially decomposed. Reorganization SHALL be incremental and SHALL avoid path churn that does not clarify authority or retrieval.

### PFA-SPEC-008 — Derived artifacts remain derived

Registration in the manifest or traceability index SHALL NOT elevate implementation code, generated schemas, generated interfaces, database DDL, reports, or verification artifacts above their declared authority.

### PFA-SPEC-009 — Verification integrity and user validation

Traceability SHALL distinguish automated verification from inspection/analysis and user acceptance validation. A requirement SHALL NOT be marked fully verified merely because a command ran when that command does not establish the requirement. Objective correctness/invariants SHOULD be automated wherever practical.

Every major implementation milestone SHALL explicitly state whether user validation is required. When it is required, the milestone closeout SHALL provide concise validation steps and expected outcomes. User validation SHALL focus on usability, workflow acceptance, and observable product behavior; it SHALL NOT substitute for automatable financial invariants or correctness tests.

## 4. Manifest metadata

Registered specifications should use:

- id: stable machine-readable identity;
- path: repository-relative canonical path;
- version: version declared by the file;
- status: current lifecycle status;
- authority: governance, level-1, level-2, level-3, level-4, planning, or derived-reference as applicable;
- parent_spec_ids: structural decomposition/allocation parents only;
- depends_on_spec_ids: cross-specification prerequisites/references that are not decomposition;
- requirement_id_policy: required, legacy, or none;
- requirement_prefix: required when policy is required;
- domains: broad functional areas;
- keywords: retrieval terms;
- applies_to: maturity stages or runtime surfaces.

## 5. Traceability model

The traceability index is intentionally lightweight. It is not a hand-maintained VCRM/RVTM spreadsheet. CI validates identity and ownership, while test/benchmark references can be populated as implementation matures.

Parent requirement IDs are reserved for true requirement decomposition/allocation. Cross-capability prerequisites use depends_on_requirement_ids and SHALL NOT be represented as parentage.

Verification methods are inspection, analysis, test, benchmark, or demonstration and MAY be multiple per requirement. Verification owners distinguish automated checks, agent/human engineering review, and user acceptance validation. Verification state distinguishes planned, partial, and implemented coverage.

A requirement may have multiple implementation surfaces and verification references. Automated checks SHALL be credited only for the behavior they actually establish.

## 6. Decomposition guidance

Create a child capability specification when a subject has its own terminology, lifecycle, interfaces, validation rules, verification strategy, or independent implementation sequence.

Do not create a child document merely to shorten a file. Decomposition must improve ownership and retrieval.

Examples of appropriate child specifications include performance/observability, probabilistic forecasting, market/economic calibration, tax, equity compensation, persistence, and application UX.

## 7. Agent workflow

For a routine patch:

1. inspect the prompt and changed symbols;
2. query the manifest by domain/keyword;
3. read the owning requirement(s) from the narrow capability specification;
4. follow parent requirements for decomposition/allocation and dependency links for cross-capability prerequisites only as needed;
5. implement and run focused verification.

For cross-cutting or semantic changes, traverse the relevant parent chain and update traceability when requirements change.

## 8. Change control

Changing a capability requirement requires updating the owning specification and its traceability entry in the same change. Moving a normative rule between specifications requires preserving its requirement ID when the requirement identity is unchanged and updating ownership atomically.
